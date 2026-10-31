// 仅 Node 环境使用：从文件夹或 .oasis/.zip 读取故事包
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { filesFromZip, type StoryFiles } from "./files.js";

export function loadFromPath(p: string): StoryFiles {
  const st = statSync(p);
  if (st.isFile()) {
    if (/\.(oasis|zip)$/i.test(p)) return filesFromZip(new Uint8Array(readFileSync(p)));
    if (/\.(ya?ml|json)$/i.test(p)) return new Map([[p.endsWith(".json") ? "story.json" : "story.yaml", new Uint8Array(readFileSync(p))]]);
    throw new Error("只能导入文件夹、.oasis/.zip 文件或 story.yaml");
  }
  const m: StoryFiles = new Map();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n.startsWith(".")) continue;
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else m.set(relative(p, f).split(sep).join("/"), new Uint8Array(readFileSync(f)));
    }
  };
  walk(p);
  return m;
}
