// 生成公开故事发布页（GitHub Pages）：读 index.json，把 site/ 模板和每个故事的 .oasis 包输出到 _site/
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { ROOT, STORIES, listFiles } from "./common.mjs";

const OUT = path.join(ROOT, "_site");
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "site"), OUT, { recursive: true });
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "index.json"), "utf8"));
fs.mkdirSync(path.join(OUT, "dl"), { recursive: true });
// GitHub Pages 整站上限约 1 GB：只给小故事打包放在 Pages；大故事（或总量快满时）改成链接到 GitHub 仓库里的故事文件夹，
// 玩家用客户端「在线故事库」下载（客户端会自动按文件走 GitHub 直连）。与 apps/desktop/src/online.ts 的 PAGES_ZIP_MAX 一致。
const PAGES_ZIP_MAX = 50 * 1024 * 1024, PAGES_BUDGET = 700 * 1024 * 1024;
const REPO_URL = `https://github.com/${process.env.GITHUB_REPOSITORY || "muoushikoma/my-oasis"}`;
let used = 0;
for (const st of index.stories) {
  // .oasis 就是 zip：根目录直接是 story.yaml 和素材
  const size = (st.files ?? []).reduce((a, f) => a + (f.size ?? 0), 0);
  if (size > PAGES_ZIP_MAX || used + size > PAGES_BUDGET) { st.download = `${REPO_URL}/tree/main/stories/${encodeURIComponent(st.id)}`; st.external = true; }
  else {
  used += size;
  const entries = {};
  for (const f of listFiles(path.join(STORIES, st.id))) entries[f.rel] = [new Uint8Array(fs.readFileSync(f.abs)), { mtime: new Date("2000-01-01T00:00:00Z") }];
  fs.writeFileSync(path.join(OUT, "dl", `${st.id}.oasis`), zipSync(entries, { level: 6 }));
  st.download = `dl/${st.id}.oasis`;
  }
  if (st.cover) { const dst = path.join(OUT, st.cover); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(ROOT, st.cover), dst); }
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
console.log(`发布页：${index.stories.length} 个故事 → _site/`);
