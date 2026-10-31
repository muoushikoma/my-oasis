// 生成公开故事发布页（GitHub Pages）：读 index.json，把 site/ 模板和每个故事的 .oasis 包输出到 _site/
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, STORIES } from "./common.mjs";

const OUT = path.join(ROOT, "_site");
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "site"), OUT, { recursive: true });
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "index.json"), "utf8"));
fs.mkdirSync(path.join(OUT, "dl"), { recursive: true });
for (const st of index.stories) {
  // .oasis 就是 zip：根目录直接是 story.yaml 和素材
  execFileSync("zip", ["-qrD", "-X", path.join(OUT, "dl", `${st.id}.oasis`), "."], { cwd: path.join(STORIES, st.id) });
  st.download = `dl/${st.id}.oasis`;
  if (st.cover) { const dst = path.join(OUT, st.cover); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(ROOT, st.cover), dst); }
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
console.log(`发布页：${index.stories.length} 个故事 → _site/`);
