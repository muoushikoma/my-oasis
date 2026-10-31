//! 系统钥匙串（Windows 凭据管理器 / macOS 钥匙串 / Linux Secret Service）
use crate::{Error, Result};
const SERVICE: &str = "my-oasis";
fn entry(account: &str) -> Result<keyring::Entry> { keyring::Entry::new(SERVICE, account).map_err(|e| Error::Msg(format!("无法访问系统钥匙串：{e}"))) }
pub fn set(account: &str, secret: &str) -> Result<()> { entry(account)?.set_password(secret).map_err(|e| Error::Msg(format!("保存 Key 失败：{e}"))) }
pub fn get(account: &str) -> Result<Option<String>> {
    match entry(account)?.get_password() { Ok(s) => Ok(Some(s)), Err(keyring::Error::NoEntry) => Ok(None), Err(e) => Err(Error::Msg(format!("读取 Key 失败：{e}"))) }
}
pub fn delete(account: &str) -> Result<()> {
    match entry(account)?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(e) => Err(Error::Msg(format!("删除 Key 失败：{e}"))) }
}
