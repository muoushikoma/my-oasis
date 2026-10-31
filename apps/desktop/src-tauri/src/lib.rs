//! Tauri 命令层：只做参数转换，逻辑在 oasis-native 里。
//! 前端永远拿不到 API Key 原文：只能“保存 / 是否已保存 / 删除”，以及让 Rust 代发模型请求。
use base64::Engine;
use oasis_native::{llm, package, secrets, store::Store, Error};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_package, library_list, library_put, library_get, library_delete,
            save_write, save_read, save_list, save_delete, export_text, import_text,
            key_set, key_has, key_delete, llm_chat
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
