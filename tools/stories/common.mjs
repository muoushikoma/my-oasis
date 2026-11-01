// 公共工具：读取 stories/<id>/ 下的故事包。只用公开的 schema，不含客户端代码。
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
export const STORIES = path.join(ROOT, "stories");
// 与 packages/schema/src/files.ts 的 LIMITS 保持一致。单个文件必须小于 100 MB（GitHub 硬性限制）。
export const LIMITS = { total: 300 * 1024 * 1024, image: 10 * 1024 * 1024, audio: 30 * 1024 * 1024, text: 2 * 1024 * 1024, files: 2000, file: 100 * 1024 * 1024 - 1 };
export const IMAGE_EXT = [".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif"];
export const AUDIO_EXT = [".ogg", ".mp3", ".m4a", ".wav", ".flac", ".opus"];
export const TEXT_EXT = [".yaml", ".yml", ".json", ".md", ".txt"];
/** 与客户端一致：脚本和字体也可以放进故事包 */
export const SCRIPT_EXT = [".js", ".ts", ".lua", ".py"];
export const FONT_EXT = [".woff2", ".woff", ".ttf", ".otf"];
export const VIDEO_EXT = [".webm", ".mp4"];
export const ID_RE = /^[a-z][a-z0-9-]{2,63}$/;

export function storyDirs() {
  if (!fs.existsSync(STORIES)) return [];
  return fs.readdirSync(STORIES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

export function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push({ rel: path.relative(base, p).split(path.sep).join("/"), size: fs.statSync(p).size, abs: p });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function readStory(dir) {
  for (const n of ["story.yaml", "story.yml", "story.json"]) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, "utf8");
      return { file: n, data: n.endsWith(".json") ? JSON.parse(text) : YAML.parse(text) };
    }
  }
  return null;
}

/** 故事里有没有用到 AI：任何地方出现 content: ai 或 ai 环节，就算需要 AI。 */
export function usesAI(data) {
  if (data?.ai && Object.keys(data.ai).length) return true;
  return /"content":"ai"/.test(JSON.stringify(data ?? {}));
}
