import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
/** 故事包里的文件：相对路径 → 内容 */
export type StoryFiles = Map<string, Uint8Array>;

export const ALLOWED_EXT = [".yaml", ".yml", ".json", ".md", ".txt", ".js", ".ts", ".lua", ".py", ".webp", ".png", ".jpg", ".jpeg", ".woff2"];
export const LIMITS = { packageBytes: 2 * 1024 * 1024, imageBytes: 500 * 1024, fileCount: 200 };

export function filesFromZip(data: Uint8Array): StoryFiles {
  const raw = unzipSync(data);
  const m: StoryFiles = new Map();
  let entries = Object.entries(raw).filter(([p]) => !p.endsWith("/"));
  // 允许 zip 里多包了一层文件夹
  if (!entries.some(([p]) => p === "story.yaml" || p === "story.json")) {
    const top = entries.find(([p]) => /^[^/]+\/story\.(yaml|json)$/.test(p));
    if (top) { const pre = top[0].split("/")[0] + "/"; entries = entries.filter(([p]) => p.startsWith(pre)).map(([p, d]) => [p.slice(pre.length), d]); }
  }
  for (const [p, d] of entries) m.set(p, d);
  return m;
}
export function filesToZip(files: StoryFiles): Uint8Array {
  return zipSync(Object.fromEntries(files), { level: 9 });
}
export function textFile(files: StoryFiles, p: string): string | undefined {
  const d = files.get(p); return d ? strFromU8(d) : undefined;
}
export function filesFromText(storyYaml: string, extra: Record<string, string> = {}): StoryFiles {
  const m: StoryFiles = new Map([["story.yaml", strToU8(storyYaml)]]);
  for (const [k, v] of Object.entries(extra)) m.set(k, strToU8(v));
  return m;
}
