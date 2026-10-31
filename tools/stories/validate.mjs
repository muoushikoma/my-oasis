// 校验所有故事（PR 时自动运行）。用法：node tools/stories/validate.mjs [故事id ...]
import fs from "node:fs";
import path from "node:path";
import Ajv2020Mod from "ajv/dist/2020.js";
import { ROOT, STORIES, LIMITS, IMAGE_EXT, AUDIO_EXT, TEXT_EXT, SCRIPT_EXT, FONT_EXT, ID_RE, storyDirs, listFiles, readStory } from "./common.mjs";

const Ajv2020 = Ajv2020Mod.default ?? Ajv2020Mod;
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/schema/story.schema.json"), "utf8"));
const check = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const only = process.argv.slice(2);
const ids = only.length ? only : storyDirs();
let bad = 0;
const files_ok = (dir) => listFiles(dir).length;
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
  if (meta.rating && !["all-ages", "teen"].includes(meta.rating)) fail(id, `故事库只收 all-ages 或 teen 分级的故事（现在是 "${meta.rating}"）`);
  let total = 0;
  for (const f of listFiles(dir)) {
    total += f.size;
    const ext = path.extname(f.rel).toLowerCase();
    if (f.rel.split("/").some((p) => p.startsWith("."))) { fail(id, `不允许隐藏文件：${f.rel}`); continue; }
    if (IMAGE_EXT.includes(ext)) { if (f.size > LIMITS.image) fail(id, `图片太大（超过 1 MB）：${f.rel}`); }
    else if (AUDIO_EXT.includes(ext)) { if (f.size > LIMITS.audio) fail(id, `音频太大（超过 5 MB）：${f.rel}`); }
    else if (FONT_EXT.includes(ext)) { /* 只受整包 20 MB 限制 */ }
    else if (TEXT_EXT.includes(ext) || SCRIPT_EXT.includes(ext)) { if (f.size > LIMITS.text) fail(id, `文本文件太大（超过 2 MB）：${f.rel}`); }
    else fail(id, `不支持的文件类型：${f.rel}（只收 yaml/yml/json/md/txt、js/ts/lua/py、webp/png/jpg/jpeg、ogg/mp3/m4a、woff2）`);
  }
  if (total > LIMITS.total) fail(id, `整个故事包超过 20 MB（现在 ${(total / 1048576).toFixed(1)} MB）`);
  if (bad === before) console.log(`✅ [${id}] 通过`);
}
if (!ids.length) console.log("（目前还没有故事）");
if (bad) { console.log(`\n共 ${bad} 个问题。改好后再推一次，检查会自动重跑。`); process.exit(1); }
