//! 读取故事包：文件夹 → 文件列表；.oasis/.zip/story.yaml → 原始字节（解压与校验在前端 TS 里做，与 CLI 共用同一套校验器）。
use crate::{msg, Result};
use base64::Engine;
use serde::Serialize;
use std::path::Path;

pub const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024; // 读取上限（校验器会再按 2 MB 规则报错）
pub const MAX_FILES: usize = 500;

#[derive(Debug, Serialize, PartialEq)]
pub struct PackageFile { pub path: String, pub base64: String }

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RawPackage {
    /// 单个文件（.oasis/.zip 或 story.yaml/json）
    File { name: String, base64: String },
    /// 文件夹里的全部文件（相对路径，正斜杠）
    Folder { name: String, files: Vec<PackageFile> },
}

pub fn read_package(p: &Path) -> Result<RawPackage> {
    let meta = std::fs::metadata(p)?;
    let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let b64 = base64::engine::general_purpose::STANDARD;
    if meta.is_file() {
        let lower = name.to_lowercase();
        if !(lower.ends_with(".oasis") || lower.ends_with(".zip") || lower.ends_with(".yaml") || lower.ends_with(".yml") || lower.ends_with(".json")) {
            return msg("只能导入文件夹、.oasis/.zip 文件或 story.yaml");
        }
        if meta.len() > MAX_TOTAL_BYTES { return msg("文件太大了（超过 20 MB），不像是故事包"); }
        return Ok(RawPackage::File { name, base64: b64.encode(std::fs::read(p)?) });
    }
    let mut files = Vec::new();
    let mut total = 0u64;
    walk(p, p, &mut files, &mut total)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(RawPackage::Folder { name, files })
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<PackageFile>, total: &mut u64) -> Result<()> {
    for e in std::fs::read_dir(dir)? {
        let e = e?;
        let fname = e.file_name().to_string_lossy().to_string();
        if fname.starts_with('.') { continue; }
        let ft = e.file_type()?;
        if ft.is_symlink() { continue; } // 不跟随符号链接，避免读到包外文件
        let path = e.path();
        if ft.is_dir() { walk(root, &path, out, total)?; continue; }
        *total += e.metadata()?.len();
        if *total > MAX_TOTAL_BYTES { return msg("文件夹太大了（超过 20 MB），请确认选的是故事包文件夹"); }
        if out.len() >= MAX_FILES { return msg("文件夹里的文件太多，请确认选的是故事包文件夹"); }
        let rel = path.strip_prefix(root).map_err(|_| crate::Error::Msg("路径错误".into()))?;
        let rel = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/");
        out.push(PackageFile { path: rel, base64: base64::engine::general_purpose::STANDARD.encode(std::fs::read(&path)?) });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_folder_recursively_and_skips_hidden() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("story.yaml"), "spec: oasis/0.3").unwrap();
        std::fs::create_dir(d.path().join("scripts")).unwrap();
        std::fs::write(d.path().join("scripts/a.js"), "x").unwrap();
        std::fs::write(d.path().join(".DS_Store"), "x").unwrap();
        match read_package(d.path()).unwrap() {
            RawPackage::Folder { files, .. } => {
                let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
                assert_eq!(paths, vec!["scripts/a.js", "story.yaml"]);
            }
            _ => panic!("应为文件夹"),
        }
    }
    #[test]
    fn rejects_unknown_file_type() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("x.exe");
        std::fs::write(&f, "x").unwrap();
        assert!(read_package(&f).is_err());
        let ok = d.path().join("a.oasis");
        std::fs::write(&ok, "zip").unwrap();
        assert!(matches!(read_package(&ok).unwrap(), RawPackage::File { .. }));
    }
}
