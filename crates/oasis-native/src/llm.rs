//! 向模型服务商发请求（OpenAI 兼容）。Key 由调用方从钥匙串取出后传入，只在这里使用。
use crate::{msg, sse::{Accumulator, Delta, ToolCallAcc}, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderConfig { pub base_url: String, pub model: String }

#[derive(Debug, Serialize)]
pub struct ChatResult { pub content: Option<String>, pub tool_calls: Vec<ToolCallOut> }
#[derive(Debug, Serialize)]
pub struct ToolCallOut { pub id: String, #[serde(rename = "type")] pub kind: &'static str, pub function: FnOut }
#[derive(Debug, Serialize)]
pub struct FnOut { pub name: String, pub arguments: String }

pub fn validate_base_url(u: &str) -> Result<()> {
    let ok = u.starts_with("https://") || u.starts_with("http://localhost") || u.starts_with("http://127.0.0.1");
    if !ok { return msg("模型地址必须以 https:// 开头（本地模型可用 http://localhost）"); }
    Ok(())
}

/// 流式请求：每段新文字调用 on_text；结束后返回完整内容与工具调用
pub async fn chat_stream(cfg: &ProviderConfig, api_key: Option<&str>, mut body: serde_json::Value, first_token_timeout: Duration, mut on_text: impl FnMut(&str)) -> Result<ChatResult> {
    validate_base_url(&cfg.base_url)?;
    body["model"] = serde_json::Value::String(cfg.model.clone());
    body["stream"] = serde_json::Value::Bool(true);
    let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(15)).build()?;
    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let mut req = client.post(url).json(&body);
    if let Some(k) = api_key { if !k.is_empty() { req = req.bearer_auth(k); } }
    let resp = tokio_timeout(first_token_timeout, req.send()).await??;
    if !resp.status().is_success() {
        let st = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return msg(match st.as_u16() {
            401 | 403 => "API Key 不对或没有权限，请在设置里检查".to_string(),
            404 => format!("找不到模型或地址不对（{}）", t.chars().take(200).collect::<String>()),
            429 => "请求太频繁或额度用完了，请稍后再试".to_string(),
            _ => format!("模型服务返回错误 {st}：{}", t.chars().take(300).collect::<String>()),
        });
    }
    let mut acc = Accumulator::default();
    let mut stream = resp.bytes_stream();
    let mut first = true;
    loop {
        let next = if first { tokio_timeout(first_token_timeout, stream.next()).await? } else { tokio_timeout(Duration::from_secs(60), stream.next()).await? };
        first = false;
        let Some(chunk) = next else { break };
        let chunk = chunk?;
        for d in acc.feed(&String::from_utf8_lossy(&chunk)) {
            match d { Delta::Text(t) => on_text(&t), Delta::Done => {} }
        }
        if acc.done { break; }
    }
    let content = if acc.content.is_empty() { None } else { Some(acc.content.clone()) };
    let tool_calls = acc.tool_calls.into_iter().enumerate().map(|(i, t): (usize, ToolCallAcc)| ToolCallOut {
        id: if t.id.is_empty() { format!("call_{i}") } else { t.id }, kind: "function", function: FnOut { name: t.name, arguments: t.arguments },
    }).collect();
    Ok(ChatResult { content, tool_calls })
}

async fn tokio_timeout<F: std::future::Future>(d: Duration, f: F) -> Result<F::Output> {
    tokio::time::timeout(d, f).await.map_err(|_| crate::Error::Msg("模型响应超时".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base_url_rules() {
        assert!(validate_base_url("https://api.openai.com/v1").is_ok());
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
        assert!(validate_base_url("http://evil.example.com").is_err());
    }
    #[tokio::test]
    async fn streams_from_mock_server() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = vec![0u8; 8192]; let n = s.read(&mut buf).await.unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            assert!(req.contains("authorization: Bearer test-key") || req.contains("Authorization: Bearer test-key"));
            let body = "data: {\"choices\":[{\"delta\":{\"content\":\"潮\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"声\"}}]}\n\ndata: [DONE]\n\n";
            let resp = format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\n\r\n{}", body.len(), body);
            s.write_all(resp.as_bytes()).await.unwrap();
        });
        let cfg = ProviderConfig { base_url: format!("http://127.0.0.1:{port}/v1"), model: "m".into() };
        let mut got = String::new();
        let r = chat_stream(&cfg, Some("test-key"), serde_json::json!({"messages": []}), Duration::from_secs(5), |t| got.push_str(t)).await.unwrap();
        assert_eq!(got, "潮声");
        assert_eq!(r.content.as_deref(), Some("潮声"));
    }
}
