//! Tauri 命令层：只做参数转换，逻辑在 oasis-native 里。
//! 前端永远拿不到 API Key 原文：只能“保存 / 是否已保存 / 删除”，以及让 Rust 代发模型请求。
use base64::Engine;
use oasis_native::{github::{self, Gh, SubmitFile}, llm, package, secrets, store::Store, Error};
use serde::Deserialize;
use std::{path::PathBuf, time::Duration};
use tauri::{ipc::Channel, AppHandle, Manager};

type R<T> = Result<T, Error>;

fn store(app: &AppHandle) -> R<Store> {
    let dir = app.path().app_data_dir().map_err(|e| Error::Msg(format!("找不到应用数据目录：{e}")))?;
    Ok(Store::new(dir))
}
fn key_account(provider_id: &str) -> String { format!("provider:{provider_id}") }

#[tauri::command]
fn read_package(path: String) -> R<package::RawPackage> { package::read_package(&PathBuf::from(path)) }

#[tauri::command]
fn library_list(app: AppHandle) -> R<Vec<String>> { store(&app)?.library_list() }
#[tauri::command]
fn library_put(app: AppHandle, id: String, base64: String) -> R<()> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64).map_err(|_| Error::Msg("数据损坏".into()))?;
    store(&app)?.library_put(&id, &bytes)
}
#[tauri::command]
fn library_get(app: AppHandle, id: String) -> R<String> { Ok(base64::engine::general_purpose::STANDARD.encode(store(&app)?.library_get(&id)?)) }
#[tauri::command]
fn library_delete(app: AppHandle, id: String) -> R<()> { store(&app)?.library_delete(&id) }

#[tauri::command]
fn save_write(app: AppHandle, story: String, slot: String, json: String) -> R<()> { store(&app)?.save_write(&story, &slot, &json) }
#[tauri::command]
fn save_read(app: AppHandle, story: String, slot: String) -> R<String> { store(&app)?.save_read(&story, &slot) }
#[tauri::command]
fn save_list(app: AppHandle, story: String) -> R<Vec<oasis_native::store::SaveInfo>> { store(&app)?.save_list(&story) }
#[tauri::command]
fn save_delete(app: AppHandle, story: String, slot: String) -> R<()> { store(&app)?.save_delete(&story, &slot) }

/// 导出存档：路径来自用户在系统“另存为”对话框里的选择
#[tauri::command]
fn export_text(path: String, contents: String) -> R<()> { Ok(std::fs::write(path, contents)?) }
#[tauri::command]
fn export_bytes(path: String, base64: String) -> R<()> {
    let data = base64::engine::general_purpose::STANDARD.decode(base64).map_err(|e| Error::Msg(format!("数据不对：{e}")))?;
    Ok(std::fs::write(path, data)?)
}
#[tauri::command]
fn import_text(path: String) -> R<String> {
    let m = std::fs::metadata(&path)?;
    if m.len() > 10 * 1024 * 1024 { return Err(Error::Msg("文件太大，不像是存档".into())); }
    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command]
fn key_set(provider_id: String, key: String) -> R<()> { secrets::set(&key_account(&provider_id), key.trim()) }
#[tauri::command]
fn key_has(provider_id: String) -> R<bool> { Ok(secrets::get(&key_account(&provider_id))?.is_some()) }
#[tauri::command]
fn key_delete(provider_id: String) -> R<()> { secrets::delete(&key_account(&provider_id)) }

#[derive(Deserialize)]
struct ChatArgs { provider_id: String, config: llm::ProviderConfig, body: serde_json::Value, first_token_timeout_ms: Option<u64> }

/// 代发模型请求：Key 在这里从钥匙串取出，流式文字通过 Channel 推给前端
#[tauri::command]
async fn llm_chat(args: ChatArgs, on_text: Channel<String>) -> R<llm::ChatResult> {
    let key = secrets::get(&key_account(&args.provider_id))?;
    let local = args.config.base_url.starts_with("http://localhost") || args.config.base_url.starts_with("http://127.0.0.1");
    if key.is_none() && !local { return Err(Error::Msg("还没有填写 API Key，请先到设置里填写".into())); }
    let t = Duration::from_millis(args.first_token_timeout_ms.unwrap_or(20_000));
    llm::chat_stream(&args.config, key.as_deref(), args.body, t, |s| { let _ = on_text.send(s.to_string()); }).await
}

// ---------- GitHub 登录与投稿：token 只存在系统安全存储里，前端拿不到 ----------
const GH_ACCOUNT: &str = "github:token";
fn gh_token() -> R<String> { secrets::get(GH_ACCOUNT)?.ok_or_else(|| Error::Msg("请先登录 GitHub".into())) }

#[derive(serde::Serialize)]
struct GhStatus { configured: bool, login: Option<String> }
#[tauri::command]
async fn gh_status() -> R<GhStatus> {
    let configured = !github::CLIENT_ID.is_empty();
    let Some(t) = secrets::get(GH_ACCOUNT)? else { return Ok(GhStatus { configured, login: None }) };
    match Gh::new()?.login(&t).await {
        Ok(l) => Ok(GhStatus { configured, login: Some(l) }),
        Err(e) if e.to_string().contains("失效") => { secrets::delete(GH_ACCOUNT)?; Ok(GhStatus { configured, login: None }) }
        Err(e) => Err(e),
    }
}
#[tauri::command]
async fn gh_device_start() -> R<github::DeviceCode> { Gh::new()?.device_start().await }
/// 轮询一次；成功时把 token 存进安全存储，只把“成功”告诉前端
#[tauri::command]
async fn gh_device_poll(device_code: String) -> R<serde_json::Value> {
    Ok(match Gh::new()?.device_poll(&device_code).await? {
        github::Poll::Ok { token } => { secrets::set(GH_ACCOUNT, &token)?; serde_json::json!({ "status": "ok" }) }
        other => serde_json::to_value(other)?,
    })
}
#[tauri::command]
fn gh_logout() -> R<()> { secrets::delete(GH_ACCOUNT) }
#[tauri::command]
async fn gh_submit(id: String, title: String, body: String, files: Vec<SubmitFile>) -> R<github::PrInfo> { Gh::new()?.submit(&gh_token()?, &id, &files, &title, &body).await }
#[tauri::command]
async fn gh_my_prs() -> R<Vec<github::PrInfo>> { Gh::new()?.my_prs(&gh_token()?).await }

/// 点赞/取消点赞（GitHub 👍 reaction），返回最新点赞数
#[tauri::command]
async fn gh_like(issue: u64, on: bool) -> R<u64> { Gh::new()?.like(&gh_token()?, issue, on).await }

/// 在线故事库下载公开文件（不带任何登录信息）
#[tauri::command]
async fn net_get(url: String) -> R<String> { Ok(base64::engine::general_purpose::STANDARD.encode(github::public_get(&url).await?)) }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    if let Err(e) = secrets::init_android() { eprintln!("{e}"); }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_package, library_list, library_put, library_get, library_delete,
            save_write, save_read, save_list, save_delete, export_text, export_bytes, import_text,
            key_set, key_has, key_delete, llm_chat,
            gh_status, gh_device_start, gh_device_poll, gh_logout, gh_submit, gh_my_prs, gh_like, net_get
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
