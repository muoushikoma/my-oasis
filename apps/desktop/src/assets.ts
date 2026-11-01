// 故事包内素材 → 浏览器可用的 blob 地址
import type { StoryFiles } from "@my-oasis/schema";
const MIME: Record<string, string> = {
  webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", avif: "image/avif",
  ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac", opus: "audio/ogg",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", webm: "video/webm", mp4: "video/mp4",
};
export type AssetKind = "image" | "audio" | "font" | "video" | "other";
export class AssetBox {
  private urls = new Map<string, string>();
  constructor(private files: StoryFiles, private assets: Record<string, any> = {}) {}
  url(ref: unknown): string | undefined {
    if (typeof ref !== "string" || !ref) return;
    const path = ref.startsWith("asset:") ? this.assets[ref.slice(6)]?.path : ref;
    if (!path) return;
    if (this.urls.has(path)) return this.urls.get(path);
    const d = this.files.get(path); if (!d) return;
    const u = URL.createObjectURL(new Blob([d as BlobPart], { type: MIME[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" }));
    this.urls.set(path, u); return u;
  }
  /** 素材原始字节（WebAudio 解码用） */
  bytes(ref: unknown): Uint8Array | undefined {
    if (typeof ref !== "string" || !ref) return;
    const path = ref.startsWith("asset:") ? this.assets[ref.slice(6)]?.path : ref;
    return path ? (this.files.get(path) as Uint8Array | undefined) : undefined;
  }
  /** 登记过的素材 id 及其类型（按扩展名） */
  list(): { id: string; kind: AssetKind }[] {
    return Object.entries(this.assets).map(([id, a]: [string, any]) => {
      const ext = String(a?.path ?? "").split(".").pop()!.toLowerCase();
      if (["image", "audio", "font", "video"].includes(a?.type)) return { id, kind: a.type };
      const kind: AssetKind = ["png", "webp", "jpg", "jpeg", "gif", "avif"].includes(ext) ? "image" : ["ogg", "mp3", "m4a", "wav", "flac", "opus"].includes(ext) ? "audio"
        : ["woff2", "woff", "ttf", "otf"].includes(ext) ? "font" : ["webm", "mp4"].includes(ext) ? "video" : "other";
      return { id, kind };
    });
  }
  meta(ref: unknown): any { return typeof ref === "string" && ref.startsWith("asset:") ? this.assets[ref.slice(6)] : undefined; }
  dispose() { for (const u of this.urls.values()) URL.revokeObjectURL(u); this.urls.clear(); }
}
