//! 我的绿洲 客户端本地能力（与 Tauri 解耦，便于单元测试）。
//! 安全原则：API Key 只在本模块里从系统钥匙串读出并用于请求，绝不返回给前端。
pub mod package;
pub mod store;
pub mod sse;
pub mod llm;
pub mod github;
#[cfg(feature = "keychain")]
pub mod secrets;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Msg(String),
    #[error("文件读写失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("数据格式错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("网络请求失败：{0}")]
    Http(#[from] reqwest::Error),
}
pub type Result<T> = std::result::Result<T, Error>;
pub fn msg<T>(s: impl Into<String>) -> Result<T> { Err(Error::Msg(s.into())) }

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> { s.serialize_str(&self.to_string()) }
}
