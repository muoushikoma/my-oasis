//! GitHub 登录（OAuth Device Flow）与“上传投稿”。
//! token 由调用方从系统安全存储取出后传入，只在这里使用，绝不返回给前端。
//! 不需要 client secret：Device Flow 只用公开的 Client ID。
use crate::{msg, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

/// 投稿目标仓库（代码与故事同一个公开仓库）
pub const UPSTREAM_OWNER: &str = "muoushikoma";
pub const UPSTREAM_REPO: &str = "my-oasis";
/// OAuth App 的 Client ID（公开信息，不是密钥）。GitHub Bot 登记应用后填入；为空时客户端提示“登录暂未开放”。
pub const CLIENT_ID: &str = match option_env!("OASIS_GITHUB_CLIENT_ID") { Some(s) => s, None => "" };
/// 公开仓库只需 public_repo：用于 fork、建分支、提交 PR
pub const SCOPE: &str = "public_repo";

pub struct Gh { pub api: String, pub web: String, client: reqwest::Client }

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceCode { pub device_code: String, pub user_code: String, pub verification_uri: String, pub expires_in: u64, pub interval: u64 }
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Poll { Pending, SlowDown { interval: u64 }, Ok { token: String }, Denied, Expired }
#[derive(Debug, Deserialize)]
pub struct SubmitFile { pub path: String, pub base64: String }
#[derive(Debug, Serialize)]
pub struct PrInfo { pub number: u64, pub url: String, pub title: String, pub state: String, pub merged: bool, pub checks: String, pub updated_at: String }

/// 故事 id 规则与仓库校验脚本一致
pub fn valid_story_id(id: &str) -> bool {
    let b = id.as_bytes();
    (3..=64).contains(&b.len()) && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}
/// 包内文件路径：相对路径、无 ..、无隐藏文件、无反斜杠
pub fn valid_rel_path(p: &str) -> bool {
    !p.is_empty() && !p.starts_with('/') && !p.contains('\\') && p.split('/').all(|s| !s.is_empty() && s != ".." && !s.starts_with('.'))
}

impl Gh {
    pub fn new() -> Result<Self> { Self::with_base("https://api.github.com", "https://github.com") }
    pub fn with_base(api: &str, web: &str) -> Result<Self> {
        let client = reqwest::Client::builder().user_agent("my-oasis-client").connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(60)).build()?;
        Ok(Self { api: api.trim_end_matches('/').into(), web: web.trim_end_matches('/').into(), client })
    }
    fn need_client_id() -> Result<&'static str> {
        if CLIENT_ID.is_empty() { return msg("GitHub 登录暂未开放（客户端还没配置登录应用）。不登录也可以浏览、下载和游玩。"); }
        Ok(CLIENT_ID)
    }
    pub async fn device_start(&self) -> Result<DeviceCode> {
        let id = Self::need_client_id()?;
        let r = self.client.post(format!("{}/login/device/code", self.web)).header("Accept", "application/json").form(&[("client_id", id), ("scope", SCOPE)]).send().await?;
        let v: Value = r.json().await?;
        if let Some(e) = v.get("error") { return msg(format!("GitHub 登录开始失败：{}", v.get("error_description").unwrap_or(e))); }
        Ok(serde_json::from_value(v)?)
    }
    pub async fn device_poll(&self, device_code: &str) -> Result<Poll> {
        let id = Self::need_client_id()?;
        let r = self.client.post(format!("{}/login/oauth/access_token", self.web)).header("Accept", "application/json")
            .form(&[("client_id", id), ("device_code", device_code), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")]).send().await?;
        let v: Value = r.json().await?;
        if let Some(t) = v.get("access_token").and_then(|t| t.as_str()) { return Ok(Poll::Ok { token: t.into() }); }
        Ok(match v.get("error").and_then(|e| e.as_str()).unwrap_or("") {
            "authorization_pending" => Poll::Pending,
            "slow_down" => Poll::SlowDown { interval: v.get("interval").and_then(|i| i.as_u64()).unwrap_or(10) },
            "access_denied" => Poll::Denied,
            "expired_token" => Poll::Expired,
            e => return msg(format!("GitHub 登录失败：{e}")),
        })
    }

    async fn call(&self, token: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<(u16, Value)> {
        let mut req = self.client.request(method, format!("{}{}", self.api, path)).bearer_auth(token)
            .header("Accept", "application/vnd.github+json").header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(b) = body { req = req.json(&b); }
        let r = req.send().await?;
        let code = r.status().as_u16();
        let text = r.text().await?;
        let v = if text.is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) };
        if code == 401 { return msg("GitHub 登录已失效，请重新登录"); }
        Ok((code, v))
    }
    async fn ok(&self, token: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value> {
        let (c, v) = self.call(token, method, path, body).await?;
        if !(200..300).contains(&c) { return msg(format!("GitHub 请求失败（{c}）：{}", v.get("message").and_then(|m| m.as_str()).unwrap_or(""))); }
        Ok(v)
    }
    pub async fn login(&self, token: &str) -> Result<String> {
        let v = self.ok(token, reqwest::Method::GET, "/user", None).await?;
        v["login"].as_str().map(String::from).ok_or_else(|| crate::Error::Msg("读不到 GitHub 用户名".into()))
    }

    /// 上传投稿：fork（维护者本人则直接在主仓库建分支）→ 建分支 → 写入 stories/<id>/（删除旧版多余文件）→ 提 PR
    pub async fn submit(&self, token: &str, id: &str, files: &[SubmitFile], title: &str, body: &str) -> Result<PrInfo> {
        use reqwest::Method as M;
        if !valid_story_id(id) { return msg("故事 id 只能用小写英文字母、数字和短横线（以字母开头，3~64 个字符）"); }
        if files.is_empty() { return msg("故事包是空的"); }
        for f in files { if !valid_rel_path(&f.path) { return msg(format!("故事包里有不允许的文件路径：{}", f.path)); } }
        let me = self.login(token).await?;
        let up = format!("/repos/{UPSTREAM_OWNER}/{UPSTREAM_REPO}");
        let head_owner = if me.eq_ignore_ascii_case(UPSTREAM_OWNER) { UPSTREAM_OWNER.to_string() } else {
            let f = self.ok(token, M::POST, &format!("{up}/forks"), Some(json!({ "default_branch_only": true }))).await?;
            let full = f["full_name"].as_str().unwrap_or_default().to_string();
            // fork 是异步创建的，等它可用
            let mut ready = false;
            for _ in 0..20 { if self.call(token, M::GET, &format!("/repos/{full}/git/ref/heads/main"), None).await?.0 == 200 { ready = true; break; } tokio::time::sleep(Duration::from_secs(3)).await; }
            if !ready { return msg("GitHub 还在准备你的仓库副本，请过一分钟再点上传"); }
            let _ = self.call(token, M::POST, &format!("/repos/{full}/merge-upstream"), Some(json!({ "branch": "main" }))).await;
            f["owner"]["login"].as_str().unwrap_or(&me).to_string()
        };
        let head = format!("/repos/{head_owner}/{UPSTREAM_REPO}");
        // 以主仓库最新 main 为基础（fork 与主仓库共享对象）
        let base_sha = self.ok(token, M::GET, &format!("{up}/git/ref/heads/main"), None).await?["object"]["sha"].as_str().unwrap_or_default().to_string();
        let base_tree = self.ok(token, M::GET, &format!("{up}/git/commits/{base_sha}"), None).await?["tree"]["sha"].as_str().unwrap_or_default().to_string();
        let prefix = format!("stories/{id}/");
        let mut entries = vec![];
        for f in files {
            let b = self.ok(token, M::POST, &format!("{head}/git/blobs"), Some(json!({ "content": f.base64, "encoding": "base64" }))).await?;
            entries.push(json!({ "path": format!("{prefix}{}", f.path), "mode": "100644", "type": "blob", "sha": b["sha"] }));
        }
        // 更新已上架故事时，删掉新版里没有的旧文件
        let (c, old) = self.call(token, M::GET, &format!("{up}/git/trees/{base_tree}?recursive=1"), None).await?;
        if c == 200 { for e in old["tree"].as_array().into_iter().flatten() {
            let p = e["path"].as_str().unwrap_or_default();
            if e["type"] == "blob" && p.starts_with(&prefix) && !files.iter().any(|f| format!("{prefix}{}", f.path) == p) {
                entries.push(json!({ "path": p, "mode": "100644", "type": "blob", "sha": Value::Null }));
            }
        } }
        let tree = self.ok(token, M::POST, &format!("{head}/git/trees"), Some(json!({ "base_tree": base_tree, "tree": entries }))).await?;
        let commit = self.ok(token, M::POST, &format!("{head}/git/commits"), Some(json!({ "message": format!("投稿：{title}"), "tree": tree["sha"], "parents": [base_sha] }))).await?;
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let branch = format!("story/{id}-{stamp}");
        self.ok(token, M::POST, &format!("{head}/git/refs"), Some(json!({ "ref": format!("refs/heads/{branch}"), "sha": commit["sha"] }))).await?;
        let pr = self.ok(token, M::POST, &format!("{up}/pulls"), Some(json!({ "title": format!("投稿：{title}"), "head": format!("{head_owner}:{branch}"), "base": "main", "body": body, "maintainer_can_modify": true }))).await?;
        self.pr_info(token, pr["number"].as_u64().unwrap_or(0)).await
    }

    pub async fn pr_info(&self, token: &str, number: u64) -> Result<PrInfo> {
        let up = format!("/repos/{UPSTREAM_OWNER}/{UPSTREAM_REPO}");
        let p = self.ok(token, reqwest::Method::GET, &format!("{up}/pulls/{number}"), None).await?;
        let sha = p["head"]["sha"].as_str().unwrap_or_default();
        let checks = match self.call(token, reqwest::Method::GET, &format!("{up}/commits/{sha}/check-runs"), None).await? {
            (200, v) => {
                let runs = v["check_runs"].as_array().cloned().unwrap_or_default();
                if runs.is_empty() { "waiting".into() }
                else if runs.iter().any(|r| r["status"] != "completed") { "running".into() }
                else if runs.iter().all(|r| matches!(r["conclusion"].as_str(), Some("success" | "skipped" | "neutral"))) { "passed".into() }
                else { "failed".into() }
            }
            _ => "unknown".into(),
        };
        Ok(PrInfo { number, url: p["html_url"].as_str().unwrap_or_default().into(), title: p["title"].as_str().unwrap_or_default().into(),
            state: p["state"].as_str().unwrap_or_default().into(), merged: p["merged"].as_bool().unwrap_or(false), checks, updated_at: p["updated_at"].as_str().unwrap_or_default().into() })
    }
    /// 我提交到主仓库的投稿（最近 20 个）
    pub async fn my_prs(&self, token: &str) -> Result<Vec<PrInfo>> {
        let me = self.login(token).await?;
        let q = format!("repo:{UPSTREAM_OWNER}/{UPSTREAM_REPO} is:pr author:{me}");
        let v = self.client.get(format!("{}/search/issues", self.api)).bearer_auth(token).query(&[("q", q.as_str()), ("sort", "updated"), ("per_page", "20")])
            .header("Accept", "application/vnd.github+json").send().await?.json::<Value>().await?;
        let mut out = vec![];
        for it in v["items"].as_array().into_iter().flatten().take(20) { if let Some(n) = it["number"].as_u64() { out.push(self.pr_info(token, n).await?); } }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn id_and_path_rules() {
        assert!(valid_story_id("rainy-bookshop")); assert!(!valid_story_id("Rainy")); assert!(!valid_story_id("1abc")); assert!(!valid_story_id("ab"));
        assert!(valid_rel_path("story.yaml")); assert!(valid_rel_path("assets/bg.webp"));
        for p in ["", "/etc/x", "../x", "a/../b", ".git/config", "a\\b", "a//b"] { assert!(!valid_rel_path(p), "{p}"); }
    }
    #[tokio::test]
    async fn device_flow_requires_client_id() {
        if CLIENT_ID.is_empty() { assert!(Gh::new().unwrap().device_start().await.is_err()); }
    }
}

/// 在线故事库的公开文件下载（https GET，最大 25 MB）。走 Rust 是为了避开网页跨域限制（Release 文件不带跨域头）。
pub async fn public_get(url: &str) -> Result<Vec<u8>> {
    if !url.starts_with("https://") { return msg("只允许 https 地址"); }
    let c = reqwest::Client::builder().user_agent("my-oasis-client").connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(60)).build()?;
    let r = c.get(url).send().await?;
    let code = r.status().as_u16();
    if !(200..300).contains(&code) { return msg(format!("HTTP {code}")); }
    if r.content_length().unwrap_or(0) > 25 * 1024 * 1024 { return msg("文件太大"); }
    let b = r.bytes().await?;
    if b.len() > 25 * 1024 * 1024 { return msg("文件太大"); }
    Ok(b.to_vec())
}
