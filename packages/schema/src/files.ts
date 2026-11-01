import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
/** 故事包里的文件：相对路径 → 内容 */
export type StoryFiles = Map<string, Uint8Array>;

export const IMAGE_EXT = [".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif"];
export const AUDIO_EXT = [".ogg", ".mp3", ".m4a", ".wav", ".flac", ".opus"];
export const FONT_EXT = [".woff2", ".woff", ".ttf", ".otf"];
/** 视频：只受单文件 100 MB / 整包 300 MB 限制；用 api.video.play 全屏播放 */
export const VIDEO_EXT = [".webm", ".mp4"];
export const ALLOWED_EXT = [".yaml", ".yml", ".json", ".md", ".txt", ".js", ".ts", ".lua", ".py", ...IMAGE_EXT, ...AUDIO_EXT, ...FONT_EXT, ...VIDEO_EXT];
/** 体积上限（与 tools/stories/common.mjs、Rust package.rs 保持一致）。单个文件必须小于 100 MB（GitHub 硬性限制）。 */
export const LIMITS = { packageBytes: 300 * 1024 * 1024, imageBytes: 10 * 1024 * 1024, audioBytes: 30 * 1024 * 1024, textBytes: 2 * 1024 * 1024, fileCount: 2000, fileBytes: 100 * 1024 * 1024 - 1 };

export function filesFromZip(data: Uint8Array): StoryFiles {
  // 防 zip 炸弹：解压前按中央目录里的原始大小检查，超出上限直接拒绝
  let n = 0, total = 0;
  const raw = unzipSync(data, { filter: (f) => {
    if (++n > LIMITS.fileCount + 50) throw new Error(`压缩包里文件太多（超过 ${LIMITS.fileCount} 个）`);
    if (f.originalSize > LIMITS.fileBytes) throw new Error(`压缩包里的「${f.name}」太大（单个文件必须小于 100 MB）`);
    total += f.originalSize;
    if (total > LIMITS.packageBytes) throw new Error("压缩包解压后超过 300 MB");
    return true;
  } });
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
