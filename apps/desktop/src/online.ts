// 在线故事库：目录读 Release story-index 的 index.json（读不到就列出 stories/ 现场生成），故事文件读本仓库 main 的 stories/
import { filesFromZip, validateFiles, metaLanguages, type StoryFiles } from "@my-oasis/schema";
import { bridge } from "./bridge";
const dec = new TextDecoder();
import { h, toast } from "./dom";
import { loadSettings, saveSettings, tr, trList } from "./settings";
import type { LocalText } from "@my-oasis/schema";
import { briefCard, openDetail } from "./story-info";
import { playableHere, platformText, currentPlatform, PLATFORM_LABEL } from "./platform";
import { fetchLikes, isFavorite, toggleFavorite, likedLocally, setLike, type LikeInfo } from "./social";

export interface OnlineStory { id: string; title: LocalText; summary?: LocalText; author?: string; version?: string; rating?: string; language?: string; languages?: string[]; description?: LocalText; est_minutes?: number; est_tokens_per_min?: number; ai_role?: LocalText; content_warnings?: LocalText[]; tags?: LocalText[]; platforms?: ("desktop" | "mobile")[]; ai?: boolean; cover?: string; files: { path: string; size?: number }[]; updated?: string }
export interface OnlineIndex { format: string; updated?: string; stories: OnlineStory[] }

export const REPO = "muoushikoma/my-oasis";
/** 故事目录 index.json 挂在固定 Release 上（合并后由工作流覆盖更新），不存进仓库 */
export const RELEASE_INDEX = `https://github.com/${REPO}/releases/download/story-index/index.json`;
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
const JSD = `https://cdn.jsdelivr.net/gh/${REPO}@main`;
const PAGES = "https://muoushikoma.github.io/my-oasis";
export const MIRRORS: { id: string; name: string; note: string }[] = [
  { id: "github", name: "GitHub 直连", note: "海外或网络好时用；国内可能很慢或打不开" },
  { id: "jsdelivr", name: "jsDelivr 加速", note: "公共 CDN，国内通常更快；新合并的故事可能有几小时延迟" },
  { id: "pages", name: "GitHub Pages 发布页", note: "从故事发布页下载整包（需要维护者开启发布页）" },
  { id: "custom", name: "自定义代理", note: "填 GitHub 加速代理的前缀（会把 https://github.com/… 和 raw 地址接在后面），例如 https://你的代理/" },
];

/** 一条线路：目录从哪读、文件从哪下、读不到目录时怎么列出 stories/ */
interface Source { indexUrls: string[]; file: (path: string, size?: number) => string; zip?: (id: string) => string; list: () => Promise<{ path: string; size?: number }[]> }
/** jsDelivr 不接收超过 20 MB 的单个文件；更大的文件自动改走 GitHub 直连 */
export const JSD_FILE_MAX = 20 * 1024 * 1024;
/** 发布页只给不超过这个体积的故事打 .oasis 包（与 tools/stories/build-site.mjs 一致） */
export const PAGES_ZIP_MAX = 50 * 1024 * 1024;
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const mirrorId = () => ((loadSettings() as any).storeMirror ?? "jsdelivr") as string;
export function source(id = mirrorId()): Source {
  const ghList = async () => {
    const j = JSON.parse(dec.decode(await bridge.netGet(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`)));
    return (j.tree ?? []).filter((e: any) => e.type === "blob" && String(e.path).startsWith("stories/")).map((e: any) => ({ path: e.path, size: e.size }));
  };
  if (id === "jsdelivr") return {
    indexUrls: [RELEASE_INDEX], file: (p, size) => (size ?? 0) > JSD_FILE_MAX ? `${RAW}/${enc(p)}` : `${JSD}/${enc(p)}`,
    list: async () => {
      const j = JSON.parse(dec.decode(await bridge.netGet(`https://data.jsdelivr.com/v1/packages/gh/${REPO}@main?structure=flat`)));
      return (j.files ?? []).map((f: any) => ({ path: String(f.name).replace(/^\//, ""), size: f.size })).filter((f: any) => f.path.startsWith("stories/"));
    },
  };
  if (id === "pages") return { indexUrls: [`${PAGES}/index.json`, RELEASE_INDEX], file: (p) => `${RAW}/${enc(p)}`, zip: (sid) => `${PAGES}/dl/${encodeURIComponent(sid)}.oasis`, list: ghList };
  if (id === "custom") {
    const px = String((loadSettings() as any).storeCustom ?? "").trim();
    const pre = px ? (px.endsWith("/") ? px : px + "/") : "";
    return { indexUrls: [pre + RELEASE_INDEX], file: (p) => `${pre}${RAW}/${enc(p)}`, list: ghList };
  }
  return { indexUrls: [RELEASE_INDEX], file: (p) => `${RAW}/${enc(p)}`, list: ghList };
}

/** 没有现成目录时：按 stories/<id>/ 分组，读每个 story 文件生成目录（与仓库里的 build-index 规则一致） */
export async function indexFromListing(files: { path: string; size?: number }[], readText: (path: string) => Promise<string>): Promise<OnlineIndex> {
  const groups = new Map<string, { path: string; size?: number }[]>();
  for (const f of files) { const m = /^stories\/([a-z][a-z0-9-]{2,63})\/(.+)$/.exec(f.path); if (!m || m[2].split("/").some((x) => x.startsWith("."))) continue; (groups.get(m[1]) ?? groups.set(m[1], []).get(m[1])!).push(f); }
  const stories: OnlineStory[] = [];
  for (const [id, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const main = ["story.yaml", "story.yml", "story.json"].map((n) => `stories/${id}/${n}`).find((p) => list.some((f) => f.path === p));
    if (!main) continue;
    let res;
    try { res = validateFiles(new Map([[main.slice(`stories/${id}/`.length), new TextEncoder().encode(await readText(main))]])); } catch { continue; }
    const m: any = (res as any).story?.meta; if (!m) continue;
    const data: any = (res as any).story;
    let cover = typeof m.cover === "string" ? m.cover : "";
    if (cover.startsWith("asset:")) { const a = data?.assets?.[cover.slice(6)]; cover = typeof a === "string" ? a : a?.path ?? a?.src ?? ""; }
    cover = cover && !cover.includes("..") && list.some((f) => f.path === `stories/${id}/${cover}`) ? `stories/${id}/${cover}` : "";
    stories.push({ id, title: m.title ?? id, summary: m.summary ?? "", author: Array.isArray(m.authors) ? m.authors.join("、") : (m.author ?? ""), version: m.version ?? "",
      rating: m.rating ?? "", language: m.language ?? "", languages: metaLanguages(m), est_minutes: m.est_minutes, est_tokens_per_min: m.est_tokens_per_min, ai_role: m.ai_role, description: m.description, content_warnings: Array.isArray(m.content_warnings) ? m.content_warnings : [], tags: Array.isArray(m.tags) ? m.tags : [], platforms: Array.isArray(m.platforms) ? m.platforms : [], ai: !!(data?.ai && Object.keys(data.ai).length) || /"content":"ai"/.test(JSON.stringify(data ?? {})),
      cover, files: [...list].sort((a, b) => a.path.localeCompare(b.path)) });
  }
  return { format: "oasis-index/1", stories };
}

/** 读目录：先读 Release 里的 index.json；读不到就列出 stories/ 现场生成 */
export async function fetchIndex(src = source()): Promise<OnlineIndex & { fallback?: boolean }> {
  if (mirrorId() === "custom" && !/^https:\/\//.test(String((loadSettings() as any).storeCustom ?? ""))) throw new Error("自定义代理地址没设置好（必须以 https:// 开头）");
  let firstErr = "";
  for (const u of src.indexUrls) {
    try { const j = JSON.parse(dec.decode(await bridge.netGet(u))); if (Array.isArray(j?.stories)) return j; firstErr ||= "目录格式不对"; }
    catch (e: any) { firstErr ||= e?.message ?? String(e); }
  }
  try { const idx = await indexFromListing(await src.list(), async (p) => dec.decode(await bridge.netGet(src.file(p)))); return { ...idx, fallback: true }; }
  catch (e: any) { throw new Error(`${firstErr}；直接列出故事也失败：${e?.message ?? e}`); }
}
export async function downloadStory(st: OnlineStory, onProgress?: (n: number, all: number) => void, src = source()): Promise<StoryFiles> {
  const prefix = `stories/${st.id}/`;
  const sizeOf = st.files.reduce((a, f) => a + (f.size ?? 0), 0);
  if (src.zip && sizeOf <= PAGES_ZIP_MAX) { try { onProgress?.(0, 1); const f = filesFromZip(await bridge.netGet(src.zip(st.id))); onProgress?.(1, 1); return f; } catch { /* 发布页没有就逐个下载 */ } }
  const files: StoryFiles = new Map();
  // 进度按字节算（目录里有大小时），大素材也能看出下载到哪了；单个文件断线由 Rust 端自动重试续传
  const all = sizeOf || st.files.length;
  let got = 0;
  onProgress?.(0, all);
  for (const f of st.files) {
    if (!f.path.startsWith(prefix) || f.path.includes("..")) throw new Error("故事文件路径不对");
    let d: Uint8Array | undefined, err: any;
    for (let i = 0; i < 2 && !d; i++) { try { d = await bridge.netGet(src.file(f.path, f.size), 120000); } catch (e) { err = e; } }
    if (!d) throw new Error(`下载 ${f.path} 失败：${err?.message ?? err}`);
    files.set(f.path.slice(prefix.length), d);
    got += sizeOf ? (f.size ?? d.length) : 1;
    onProgress?.(got, all);
  }
  return files;
}

/** 在线故事库页面 */
export function onlineView(onGet: (st: OnlineStory, files: StoryFiles) => Promise<void>): HTMLElement {
  const root = h("div", {});
  const s = loadSettings() as any;
  const mirrorSel = h("select", { onchange: (e: any) => { saveSettings({ ...loadSettings(), storeMirror: e.target.value } as any); load(); } },
    ...MIRRORS.map((m) => h("option", { value: m.id, selected: m.id === (s.storeMirror ?? "jsdelivr") }, m.name)));
  const custom = h("input", { placeholder: "GitHub 加速代理前缀，如 https://你的代理/", value: s.storeCustom ?? "", onchange: (e: any) => { saveSettings({ ...loadSettings(), storeCustom: e.target.value.trim() } as any); load(); } });
  const list = h("div", {});
  const q = h("input", { placeholder: "搜索标题、简介、标签", oninput: () => draw() }) as HTMLInputElement;
  let idx: OnlineIndex | null = null;
  let likes = new Map<string, LikeInfo>(), likesErr = false;
  const favOnly = h("input", { type: "checkbox", onchange: () => draw() }) as HTMLInputElement;
  const draw = () => {
    if (!idx) return;
    const k = q.value.trim();
    const here = idx.stories.filter((x) => playableHere(x));
    const hidden = idx.stories.length - here.length;
    const items = here.filter((x) => !favOnly.checked || isFavorite(x.id)).filter((x) => !k || [x.title, x.summary, ...(x.tags ?? [])].flatMap((v) => (v && typeof v === "object" ? Object.values(v) : [v ?? ""])).join(" ").includes(k));
    list.replaceChildren(items.length ? h("div", { class: "cards" }, ...items.map((st) => {
      const btn = h("button", { class: "primary" }, "下载并加入故事库") as HTMLButtonElement;
      btn.onclick = async () => {
        btn.disabled = true;
        try { const f = await downloadStory(st, (n, all) => (btn.textContent = all > 1048576 ? `下载中 ${(n / 1048576).toFixed(1)}/${(all / 1048576).toFixed(1)} MB（${Math.floor((n / all) * 100)}%）` : `下载中 ${Math.floor((n / Math.max(1, all)) * 100)}%`)); await onGet(st, f); }
        catch (e: any) { toast(`下载失败：${e.message}。可以在上方换一个线路再试`, "err"); }
        btn.disabled = false; btn.textContent = "下载并加入故事库";
      };
      const fav = h("button", { title: "收藏只保存在这台设备上" }, isFavorite(st.id) ? "★ 已收藏" : "☆ 收藏") as HTMLButtonElement;
      fav.onclick = () => { const on = toggleFavorite(st.id); fav.textContent = on ? "★ 已收藏" : "☆ 收藏"; if (favOnly.checked) draw(); };
      const li = likes.get(st.id);
      const like = h("button", { title: li ? "用 GitHub 账号点赞（所有玩家共享计数）" : likesErr ? "点赞数读取失败" : "这个故事的点赞帖还没建好" }) as HTMLButtonElement;
      let liked = likedLocally(st.id);
      const showLike = (n?: number) => (like.textContent = `${liked ? "👍 已赞" : "👍 点赞"}${n != null ? ` ${n}` : ""}`);
      showLike(li?.count); like.disabled = !li;
      like.onclick = async () => {
        if (!li) return; like.disabled = true;
        try { const n = await setLike(st.id, li.issue, !liked); liked = !liked; li.count = n; showLike(n); }
        catch (e: any) { toast(e?.message ?? String(e), "err"); }
        like.disabled = false;
      };
      const size = st.files.reduce((a, f) => a + (f.size ?? 0), 0);
      const ph = h("div", { class: "cover ph" }, (tr(st.title).replace(/^[\s(（【\[]*(?:[^)）】\]]*[)）】\]])?\s*/, "") || tr(st.title)).slice(0, 1));
      const cover = st.cover && /^stories\/[a-z0-9-]+\/[^?#]+$/.test(st.cover) && !st.cover.includes("..") ? (() => { const img = h("img", { class: "cover", alt: "" }) as HTMLImageElement; bridge.netGet(source().file(st.cover!)).then((b) => { img.src = URL.createObjectURL(new Blob([b as BlobPart])); }).catch(() => img.replaceWith(ph)); return img; })() : ph;
      return briefCard(cover, tr(st.title), st, () => openDetail({ title: tr(st.title), cover: cover.cloneNode(true) as HTMLElement, meta: st, storyId: st.id,
        lines: [`作者 ${st.author || "未署名"} · 版本 ${st.version ?? "?"}${size ? ` · ${size < 1048576 ? Math.max(1, Math.round(size / 1024)) + " KB" : (size / 1048576).toFixed(1) + " MB"}` : ""}`],
        buttons: [btn, fav, like] }));
    })) : h("p", { class: "muted" }, idx.stories.length ? (favOnly.checked ? "没有符合条件的收藏。" : "没有找到这台设备能玩的匹配故事。") : "在线故事库里还没有故事。欢迎到“创作 → 投稿”成为第一个投稿的作者！"));
    if (hidden) list.append(h("p", { class: "small muted" }, `另有 ${hidden} 个故事不支持${PLATFORM_LABEL[currentPlatform()]}，已隐藏。`));
  };
  const load = async () => {
    custom.style.display = (loadSettings() as any).storeMirror === "custom" ? "" : "none";
    list.replaceChildren(h("p", { class: "muted" }, "正在读取在线故事库…"));
    fetchLikes().then((m) => { likes = m; likesErr = false; draw(); }).catch(() => { likesErr = true; });
    try { idx = await fetchIndex(); draw(); if ((idx as any).fallback) list.prepend(h("p", { class: "small muted" }, "（没读到现成的故事目录，已直接列出仓库里的故事）")); }
    catch (e: any) { idx = null; list.replaceChildren(h("div", { class: "notice" }, `读取失败：${e.message}。国内访问 GitHub 可能较慢，可以在上方换成“jsDelivr 加速”或自定义代理再试。`), h("div", { class: "row" }, h("button", { onclick: load }, "重试"))); }
  };
  root.append(h("div", { class: "row" }, h("span", {}, "线路："), mirrorSel, custom, h("button", { onclick: load }, "刷新")), h("p", { class: "small muted" }, `故事来自公开仓库 github.com/${REPO}，不用登录就能浏览和下载；投稿经维护者审核合并后才会出现在这里。下载的故事和本地导入的一样会先检查格式。`),
    h("div", { class: "row" }, q, h("label", {}, favOnly, " 只看收藏")), list);
  load();
  return root;
}

/** 投稿引导 */
export function submitGuide(): HTMLElement {
  const step = (n: number, title: string, ...kids: any[]) => h("div", { class: "card step" }, h("h3", {}, `第 ${n} 步：${title}`), ...kids);
  return h("div", {},
    h("p", {}, "写好的故事可以投稿到公开的在线故事库，审核通过后所有玩家都能在“游玩 → 在线故事库”里下载。整个过程不需要会编程，只需要一个免费的 GitHub 账号。"),
    h("div", { class: "notice" }, "投稿须知：只收全年龄的故事，不收色情内容；故事名称、简介和 3 个标签都要同时写中文和英文；不要包含别人的版权素材、真实个人信息或任何 Key。版权归你，投稿即授权本平台公开分发（详见仓库 stories/LICENSE.md）。"),
    step(1, "检查并导出", h("p", {}, "在“用 AI 写故事”的草稿里点“校验”，没有错误后点“导出 .oasis”；或者在“导入检查”里检查你自己写的故事。记下故事的 id（story.yaml 里 meta.id，例如 rainy-bookstore）。")),
    step(2, "注册 GitHub 并 Fork 故事库", h("ol", {},
      h("li", {}, "打开 https://github.com 注册账号（免费）。"),
      h("li", {}, `打开 https://github.com/${REPO} ，点右上角的 “Fork” 按钮，再点 “Create fork”。这样你就有了一份自己的副本。`))),
    step(3, "上传故事文件", h("ol", {},
      h("li", {}, "把 .oasis 文件改名为 .zip 并解压，得到 story.yaml 和素材文件夹。"),
      h("li", {}, "在你 Fork 出来的仓库页面，进入 stories 文件夹，点 “Add file” → “Upload files”。"),
      h("li", {}, "把解压出来的文件拖进去；在页面上方的路径框里，确保文件放在 stories/你的故事id/ 下面（例如 stories/rainy-bookstore/story.yaml）。"),
      h("li", {}, "选 “Create a new branch”，点 “Propose changes”。"))),
    step(4, "提交 PR（投稿申请）", h("ol", {},
      h("li", {}, "页面会跳到 “Open a pull request”。标题写“投稿：故事名”。"),
      h("li", {}, "按模板勾选确认项（全年龄、原创或有授权、已通过校验），点 “Create pull request”。"),
      h("li", {}, "系统会自动检查格式，几分钟后能看到结果；有错误时点进去看大白话说明，改好后在同一个分支再上传一次即可。"),
      h("li", {}, "维护者审核通过并合并后，故事会自动出现在在线故事库里。"))),
    step(5, "更新已上架的故事", h("p", {}, "把 meta.version 改大（例如 1.0.0 → 1.1.0），按同样步骤上传覆盖 stories/你的故事id/ 里的文件，再提一个 PR。")));
}
