// 生成 index.json（合并到 main 后自动运行）。客户端「在线故事库」读的就是这个文件。
import fs from "node:fs";
import path from "node:path";
import { ROOT, STORIES, storyDirs, listFiles, readStory, usesAI } from "./common.mjs";

function coverPath(id, dir, c, data) {
  if (typeof c !== "string") return "";
  if (c.startsWith("asset:")) { const a = data?.assets?.[c.slice(6)]; c = typeof a === "string" ? a : a?.src ?? a?.path ?? ""; }
  if (!c || c.includes("..") || c.startsWith("/")) return "";
  return fs.existsSync(path.join(dir, c)) ? `stories/${id}/${c}` : "";
}
const stories = [];
for (const id of storyDirs()) {
  const dir = path.join(STORIES, id);
  let st; try { st = readStory(dir); } catch { st = null; }
  if (!st) { console.warn(`跳过 ${id}：读不出 story 文件`); continue; }
  const m = st.data?.meta ?? {};
  stories.push({
    id, title: m.title ?? id, summary: m.summary ?? "", author: Array.isArray(m.authors) ? m.authors.join("、") : (m.author ?? ""), version: m.version ?? "",
    rating: m.rating ?? "", language: m.language ?? "",
    languages: Array.isArray(m.languages) && m.languages.length ? m.languages : (typeof m.language === "string" && m.language ? [m.language.split("-")[0]] : []),
    ai_role: m.ai_role ?? "", description: m.description ?? "", est_minutes: m.est_minutes ?? null, est_tokens_per_min: m.est_tokens_per_min ?? null,
    content_warnings: Array.isArray(m.content_warnings) ? m.content_warnings : [], tags: Array.isArray(m.tags) ? m.tags : [],
    platforms: Array.isArray(m.platforms) && m.platforms.length ? m.platforms : ["desktop", "mobile"],
    ai: usesAI(st.data),
    cover: coverPath(id, dir, m.cover, st.data),
    files: listFiles(dir).map((f) => ({ path: `stories/${id}/${f.rel}`, size: f.size })),
  });
}
const out = path.join(ROOT, "index.json");
const old = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
const same = old && JSON.stringify(old.stories) === JSON.stringify(stories);
const index = { format: "oasis-index/1", updated: same ? old.updated : new Date().toISOString(), stories };
fs.writeFileSync(out, JSON.stringify(index, null, 2) + "\n");
console.log(`index.json：${stories.length} 个故事${same ? "（没有变化）" : ""}`);
