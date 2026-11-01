// 校验所有故事（PR 时自动运行）。用法：pnpm exec tsx tools/stories/validate.mjs [故事id ...]
// 除了投稿规则，还跑一遍客户端导入时用的完整校验器（packages/schema 的 validateFiles：必须接 AI、动作/结局、自定义组件……），有错误就不通过。
import fs from "node:fs";
import path from "node:path";
import Ajv2020Mod from "ajv/dist/2020.js";
import { ROOT, STORIES, LIMITS, IMAGE_EXT, AUDIO_EXT, TEXT_EXT, SCRIPT_EXT, FONT_EXT, VIDEO_EXT, ID_RE, storyDirs, listFiles, readStory } from "./common.mjs";

let engine;
try {
  engine = { ...(await import("../../packages/schema/src/index.ts")), ...(await import("../../packages/schema/src/node.ts")) };
} catch (e) {
  console.log(`❌ 载入完整校验器失败（需要先 pnpm install，并用 tsx 运行：pnpm exec tsx tools/stories/validate.mjs）：${e.message}`);
  process.exit(1);
}
const Ajv2020 = Ajv2020Mod.default ?? Ajv2020Mod;
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/schema/story.schema.json"), "utf8"));
const check = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const only = process.argv.slice(2);
const ids = only.length ? only : storyDirs();
let bad = 0;
const files_ok = (dir) => listFiles(dir).length;
const isLT = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => (k === "zh" || k === "en") && typeof v[k] === "string");

/** 粗略找出只有一种语言的玩家可见文字（只提醒） */
function singleLangTexts(d) {
  const out = [], KEYS = new Set(["label", "desc", "text", "title", "intro", "placeholder", "reject", "require_message", "opening", "fallback", "alt"]);
  const walk = (o, p) => {
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      const q = p ? `${p}.${k}` : k;
      if (q.startsWith("meta.") || q.startsWith("ai.images") && k === "fallback") continue;
      if (KEYS.has(k) && typeof v === "string" && v.trim() && !(k === "fallback" && /^(asset:|none$)/.test(v))) out.push(q);
      else if (KEYS.has(k) && isLT(v) && !(v.zh && v.en)) out.push(q);
      else if (k !== "steps" || true) walk(v, q);
    }
  };
  walk(d, ""); return out;
}
const fail = (id, msg) => { bad++; console.log(`❌ [${id}] ${msg}`); };

// stories/ 下只允许文件夹（和 .gitkeep）
if (fs.existsSync(STORIES)) for (const e of fs.readdirSync(STORIES, { withFileTypes: true }))
  if (!e.isDirectory() && ![".gitkeep", "LICENSE.md", "README.md"].includes(e.name)) fail(e.name, "stories/ 里只能放故事文件夹，不能直接放文件");

for (const id of ids) {
  const dir = path.join(STORIES, id);
  const before = bad;
  if (!fs.existsSync(dir)) { fail(id, "找不到这个故事文件夹"); continue; }
  if (!ID_RE.test(id)) fail(id, "文件夹名只能用小写英文字母、数字和短横线（以字母开头，3~64 个字符），例如 rainy-bookshop");
  const st = (() => { try { return readStory(dir); } catch (e) { fail(id, `story 文件写法有误，读不出来：${e.message}`); return undefined; } })();
  if (st === null) { fail(id, "文件夹里缺少 story.yaml（或 story.json）"); continue; }
  if (!st) continue;
  if (!check(st.data)) for (const e of check.errors.slice(0, 20)) fail(id, `格式不对：${e.instancePath || "(根)"} ${e.message}`);
  const meta = st.data?.meta ?? {};
  if (meta.id !== id) fail(id, `meta.id 必须和文件夹名一样（现在是 "${meta.id}"）`);
  // 故事库要求（与客户端投稿检查同一份）：中英双语的名称/简介/3 个标签、AI 角色、语言、时长、每分钟 token、全年龄
  for (const p of engine.libraryProblems(st.data)) fail(id, p);
  // 完整校验（和客户端导入时一样）
  try {
    const r = engine.validateFiles(engine.loadFromPath(dir));
    const errs = r.issues.filter((i) => i.level === "error");
    if (errs.length) fail(id, `完整校验没通过：\n${engine.formatIssues({ ...r, issues: errs })}`);
    const warns = r.issues.filter((i) => i.level === "warning").length;
    if (warns) console.log(`⚠️  [${id}] 完整校验有 ${warns} 个警告（不影响通过）`);
  } catch (e) { fail(id, `完整校验出错：${e.message}`); }
  const oneLang = singleLangTexts(st.data);
  if (oneLang.length) console.log(`⚠️  [${id}] 提醒：有 ${oneLang.length} 处玩家可见文字只有一种语言（不影响通过），例如 ${oneLang.slice(0, 5).join("、")}`);
  let total = 0;
  const all = listFiles(dir);
  if (all.length > LIMITS.files) fail(id, `文件太多（${all.length} 个），最多 ${LIMITS.files} 个`);
  for (const f of all) {
    total += f.size;
    if (f.size > LIMITS.file) { fail(id, `文件太大（单个文件必须小于 100 MB，GitHub 限制）：${f.rel}`); continue; }
    const ext = path.extname(f.rel).toLowerCase();
    if (f.rel.split("/").some((p) => p.startsWith("."))) { fail(id, `不允许隐藏文件：${f.rel}`); continue; }
    if (IMAGE_EXT.includes(ext)) { if (f.size > LIMITS.image) fail(id, `图片太大（超过 10 MB）：${f.rel}`); }
    else if (AUDIO_EXT.includes(ext)) { if (f.size > LIMITS.audio) fail(id, `音频太大（超过 30 MB）：${f.rel}`); }
    else if (FONT_EXT.includes(ext) || VIDEO_EXT.includes(ext)) { /* 只受整包 300 MB 和单文件 100 MB 限制 */ }
    else if (TEXT_EXT.includes(ext) || SCRIPT_EXT.includes(ext)) { if (f.size > LIMITS.text) fail(id, `文本文件太大（超过 2 MB）：${f.rel}`); }
    else fail(id, `不支持的文件类型：${f.rel}（只收 yaml/yml/json/md/txt、js/ts/lua/py、html/htm/css（自定义组件）、webp/png/jpg/jpeg/gif/avif、ogg/mp3/m4a/wav/flac/opus、woff2/woff/ttf/otf、webm/mp4）`);
  }
  if (total > LIMITS.total) fail(id, `整个故事包超过 300 MB（现在 ${(total / 1048576).toFixed(1)} MB）`);
  if (bad === before) console.log(`✅ [${id}] 通过`);
}
if (!ids.length) console.log("（目前还没有故事）");
if (bad) { console.log(`\n共 ${bad} 个问题。改好后再推一次，检查会自动重跑。`); process.exit(1); }
