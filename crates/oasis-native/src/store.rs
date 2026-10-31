//! 本地数据：已导入故事（.oasis 字节）与存档（JSON）。全部放在应用数据目录下。
use crate::{msg, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub struct Store { root: PathBuf }

#[derive(Debug, Serialize, PartialEq)]
pub struct SaveInfo { pub slot: String, pub size: u64, pub modified_ms: u128 }

fn safe_id(s: &str) -> Result<&str> {
    if s.is_empty() || s.len() > 64 || !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { return msg(format!("名字「{s}」不合法")); }
    Ok(s)
}

impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Self { Self { root: root.into() } }
    fn stories(&self) -> PathBuf { self.root.join("stories") }
    fn saves(&self, story: &str) -> Result<PathBuf> { Ok(self.root.join("saves").join(safe_id(story)?)) }

    pub fn library_put(&self, id: &str, bytes: &[u8]) -> Result<()> {
        std::fs::create_dir_all(self.stories())?;
        atomic_write(&self.stories().join(format!("{}.oasis", safe_id(id)?)), bytes)
    }
    pub fn library_get(&self, id: &str) -> Result<Vec<u8>> { Ok(std::fs::read(self.stories().join(format!("{}.oasis", safe_id(id)?)))?) }
    pub fn library_delete(&self, id: &str) -> Result<()> {
        let p = self.stories().join(format!("{}.oasis", safe_id(id)?));
        if p.exists() { std::fs::remove_file(p)?; }
        Ok(())
    }
    pub fn library_list(&self) -> Result<Vec<String>> {
        let mut v = vec![];
        if let Ok(rd) = std::fs::read_dir(self.stories()) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if let Some(id) = n.strip_suffix(".oasis") { v.push(id.to_string()); }
            }
        }
        v.sort();
        Ok(v)
    }

    pub fn save_write(&self, story: &str, slot: &str, json: &str) -> Result<()> {
        serde_json::from_str::<serde_json::Value>(json)?; // 只接受合法 JSON
        let d = self.saves(story)?; std::fs::create_dir_all(&d)?;
        atomic_write(&d.join(format!("{}.json", safe_id(slot)?)), json.as_bytes())
    }
    pub fn save_read(&self, story: &str, slot: &str) -> Result<String> { Ok(std::fs::read_to_string(self.saves(story)?.join(format!("{}.json", safe_id(slot)?)))?) }
    pub fn save_delete(&self, story: &str, slot: &str) -> Result<()> {
        let p = self.saves(story)?.join(format!("{}.json", safe_id(slot)?));
        if p.exists() { std::fs::remove_file(p)?; }
        Ok(())
    }
    pub fn save_list(&self, story: &str) -> Result<Vec<SaveInfo>> {
        let mut v = vec![];
        if let Ok(rd) = std::fs::read_dir(self.saves(story)?) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if let Some(slot) = n.strip_suffix(".json") {
                    let m = e.metadata()?;
                    let modified_ms = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
                    v.push(SaveInfo { slot: slot.to_string(), size: m.len(), modified_ms });
                }
            }
        }
        v.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
        Ok(v)
    }
}

/// 先写临时文件再改名，避免断电/崩溃时存档损坏
fn atomic_write(p: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, p)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn library_and_saves_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path());
        s.library_put("guess-the-box", b"zip").unwrap();
        assert_eq!(s.library_list().unwrap(), vec!["guess-the-box"]);
        assert_eq!(s.library_get("guess-the-box").unwrap(), b"zip");
        s.save_write("guess-the-box", "auto", r#"{"a":1}"#).unwrap();
        assert_eq!(s.save_read("guess-the-box", "auto").unwrap(), r#"{"a":1}"#);
        assert_eq!(s.save_list("guess-the-box").unwrap().len(), 1);
        s.save_delete("guess-the-box", "auto").unwrap();
        assert!(s.save_list("guess-the-box").unwrap().is_empty());
        s.library_delete("guess-the-box").unwrap();
        assert!(s.library_list().unwrap().is_empty());
    }
    #[test]
    fn rejects_path_tricks_and_bad_json() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path());
        assert!(s.library_put("../x", b"").is_err());
        assert!(s.save_write("ok", "../../etc", "{}").is_err());
        assert!(s.save_write("ok", "slot", "not json").is_err());
    }
}
