// 在线故事库：从公开仓库 muoushikoma/my-oasis-stories 读取 index.json，一键下载
import type { StoryFiles } from "@my-oasis/schema";
import { h, toast } from "./dom";
import { loadSettings, saveSettings } from "./settings";

export interface OnlineStory { id: string; title: string; summary?: string; author?: string; version?: string; rating?: string; language?: string; tags?: string[]; ai?: boolean; files: { path: string; size?: number }[]; updated?: string }
export interface OnlineIndex { format: string; updated?: string; stories: OnlineStory[] }

export const REPO = "muoushikoma/my-oasis-stories";
export const MIRRORS: { id: string; name: string; base: string; note: string }[] = [
  { id: "github", name: "GitHub 直连", base: `https://raw.githubusercontent.com/${REPO}/main`, note: "海外或网络好时用；国内可能很慢或打不开" },
  { id: "jsdelivr", name: "jsDelivr 加速", base: `https://cdn.jsdelivr.net/gh/${REPO}@main`, note: "公共 CDN，国内通常更快；新合并的故事可能有几小时延迟" },
  { id: "custom", name: "自定义镜像/代理", base: "", note: "填写能访问到仓库文件的地址前缀（末尾不加 /），例如自建的代理地址" },
];
export function storeBase(): string {
  const s = loadSettings() as any;
  const m = MIRRORS.find((x) => x.id === (s.storeMirror ?? "jsdelivr")) ?? MIRRORS[1];
  return (m.id === "custom" ? s.storeCustom ?? "" : m.base).replace(/\/+$/, "");
}
async function get(url: string, timeoutMs = 20000): Promise<Response> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: ac.signal, cache: "no-cache" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; }
  catch (e: any) { throw new Error(e?.name === "AbortError" ? "连接超时" : String(e?.message ?? e)); }
  finally { clearTimeout(t); }
}
export async function fetchIndex(): Promise<OnlineIndex> {
  const base = storeBase(); if (!/^https:\/\//.test(base)) throw new Error("在线故事库地址没设置好（必须以 https:// 开头）");
  const j = await (await get(`${base}/index.json`)).json();
  if (!Array.isArray(j?.stories)) throw new Error("故事库目录格式不对");
  return j;
}
export async function downloadStory(st: OnlineStory, onProgress?: (n: number, all: number) => void): Promise<StoryFiles> {
  const base = storeBase(), files: StoryFiles = new Map(), prefix = `stories/${st.id}/`;
  let n = 0;
  for (const f of st.files) {
    if (!f.path.startsWith(prefix) || f.path.includes("..")) throw new Error("故事文件路径不对");
    files.set(f.path.slice(prefix.length), new Uint8Array(await (await get(`${base}/${f.path.split("/").map(encodeURIComponent).join("/")}`)).arrayBuffer()));
    onProgress?.(++n, st.files.length);
  }
  return files;
}

/** 在线故事库页面 */
export function onlineView(onGet: (st: OnlineStory, files: StoryFiles) => Promise<void>): HTMLElement {
  const root = h("div", {});
  const s = loadSettings() as any;
  const mirrorSel = h("select", { onchange: (e: any) => { saveSettings({ ...loadSettings(), storeMirror: e.target.value } as any); load(); } },
    ...MIRRORS.map((m) => h("option", { value: m.id, selected: m.id === (s.storeMirror ?? "jsdelivr") }, m.name)));
  const custom = h("input", { placeholder: "自定义地址前缀，如 https://你的代理/raw/muoushikoma/my-oasis-stories/main", value: s.storeCustom ?? "", onchange: (e: any) => { saveSettings({ ...loadSettings(), storeCustom: e.target.value.trim() } as any); load(); } });
  const list = h("div", {});
  const q = h("input", { placeholder: "搜索标题、简介、标签", oninput: () => draw() }) as HTMLInputElement;
  let idx: OnlineIndex | null = null;
  const draw = () => {
    if (!idx) return;
    const k = q.value.trim();
    const items = idx.stories.filter((x) => !k || [x.title, x.summary, ...(x.tags ?? [])].join(" ").includes(k));
    list.replaceChildren(items.length ? h("div", { class: "cards" }, ...items.map((st) => {
      const btn = h("button", { class: "primary" }, "下载并加入故事库") as HTMLButtonElement;
      btn.onclick = async () => {
        btn.disabled = true;
        try { const f = await downloadStory(st, (n, all) => (btn.textContent = `下载中 ${n}/${all}`)); await onGet(st, f); }
        catch (e: any) { toast(`下载失败：${e.message}。可以在上方换一个线路再试`, "err"); }
        btn.disabled = false; btn.textContent = "下载并加入故事库";
      };
      const size = st.files.reduce((a, f) => a + (f.size ?? 0), 0);
      return h("div", { class: "story-card" }, h("div", { class: "cover ph" }, (st.title.replace(/^[\s(（【\[]*(?:[^)）】\]]*[)）】\]])?\s*/, "") || st.title).slice(0, 1)),
        h("div", { class: "info" },
          h("h3", {}, st.title, st.ai ? h("span", { class: "tag ai" }, "需要 AI") : h("span", { class: "tag" }, "纯规则")),
          h("p", { class: "muted" }, st.summary ?? ""),
          h("p", { class: "small muted" }, `作者 ${st.author ?? "未署名"} · 版本 ${st.version ?? "?"}${size ? ` · ${size < 1048576 ? Math.max(1, Math.round(size / 1024)) + " KB" : (size / 1048576).toFixed(1) + " MB"}` : ""}${st.tags?.length ? ` · ${st.tags.join("、")}` : ""}`),
          h("div", { class: "row" }, btn)));
    })) : h("p", { class: "muted" }, idx.stories.length ? "没有找到匹配的故事。" : "在线故事库里还没有故事。欢迎到“创作 → 投稿”成为第一个投稿的作者！"));
  };
  const load = async () => {
    custom.style.display = (loadSettings() as any).storeMirror === "custom" ? "" : "none";
    list.replaceChildren(h("p", { class: "muted" }, "正在读取在线故事库…"));
    try { idx = await fetchIndex(); draw(); }
    catch (e: any) { idx = null; list.replaceChildren(h("div", { class: "notice" }, `读取失败：${e.message}。国内访问 GitHub 可能较慢，可以在上方换成“jsDelivr 加速”或自定义镜像再试。`), h("div", { class: "row" }, h("button", { onclick: load }, "重试"))); }
  };
  root.append(h("div", { class: "row" }, h("span", {}, "线路："), mirrorSel, custom, h("button", { onclick: load }, "刷新")), h("p", { class: "small muted" }, `故事来自公开仓库 github.com/${REPO}，由投稿者通过 PR 提交、维护者审核后上架。下载的故事和本地导入的一样会先检查格式。`),
    h("div", { class: "row" }, q), list);
  load();
  return root;
}

/** 投稿引导 */
export function submitGuide(): HTMLElement {
  const step = (n: number, title: string, ...kids: any[]) => h("div", { class: "card step" }, h("h3", {}, `第 ${n} 步：${title}`), ...kids);
  return h("div", {},
    h("p", {}, "写好的故事可以投稿到公开的在线故事库，审核通过后所有玩家都能在“游玩 → 在线故事库”里下载。整个过程不需要会编程，只需要一个免费的 GitHub 账号。"),
    h("div", { class: "notice" }, "投稿须知：只收全年龄或青少年级别的内容，不收色情内容；不要包含别人的版权素材、真实个人信息或任何 Key。投稿即表示同意按仓库说明公开分享。"),
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
