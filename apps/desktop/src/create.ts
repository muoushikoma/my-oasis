// 创作板块：规范文档阅读/下载、复制给 AI、用已连接的 AI 写故事（草稿 → 校验 → 试玩 → 导出）、导入检查
import { validateFiles, filesToZip, aiFixRequest, type StoryFiles } from "@my-oasis/schema";
import { h, toast } from "./dom";
import { bridge, filesFromSingle } from "./bridge";
import { issuesView, copyText } from "./issues";
import { loadSettings, isLocalUrl } from "./settings";
import { explainError } from "./providers";
import { submitGuide } from "./online";
import { submitView } from "./submit";
import formatMd from "../../../docs/story-format.md?raw";
import guideMd from "../../../docs/ai-authoring-guide.md?raw";
import schemaJson from "../../../docs/schema/story.schema.json?raw";

const enc = new TextEncoder(), dec = new TextDecoder();
export const AUTHOR_PROMPT = (() => { const i = guideMd.indexOf("````text"); const j = guideMd.indexOf("\n````", i + 8); return i >= 0 && j > i ? guideMd.slice(guideMd.indexOf("\n", i) + 1, j).trim() : guideMd; })();
const DOCS = [
  { id: "format", title: "故事交付格式", file: "我的绿洲-故事交付格式.md", text: formatMd, ext: "md" },
  { id: "guide", title: "AI 创作指南", file: "我的绿洲-AI创作指南.md", text: guideMd, ext: "md" },
  { id: "schema", title: "JSON Schema", file: "story.schema.json", text: schemaJson, ext: "json" },
];

// ---------- 极简 Markdown 显示 ----------
function inline(t: string): (Node | string)[] {
  const out: (Node | string)[] = []; const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g; let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    out.push(t.slice(last, m.index)); const s = m[0];
    if (s.startsWith("`")) out.push(h("code", {}, s.slice(1, -1)));
    else if (s.startsWith("**")) out.push(h("b", {}, s.slice(2, -2)));
    else { const [, a] = s.match(/\[([^\]]+)\]/)!; out.push(h("span", { class: "link" }, a)); }
    last = m.index + s.length;
  }
  out.push(t.slice(last)); return out;
}
export function renderMd(md: string): HTMLElement {
  const root = h("div", { class: "md" }); const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = l.match(/^(`{3,})/);
    if (fence) { const buf: string[] = []; i++; while (i < lines.length && !lines[i].startsWith(fence[1])) buf.push(lines[i++]); root.append(h("pre", {}, buf.join("\n"))); continue; }
    const hd = l.match(/^(#{1,4})\s+(.*)/);
    if (hd) { root.append(h(`h${Math.min(hd[1].length + 1, 5)}` as any, {}, ...inline(hd[2]))); continue; }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) { if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim())); i++; }
      i--; root.append(h("table", {}, ...rows.map((r, k) => h("tr", {}, ...r.map((c) => h(k ? "td" : "th", {}, ...inline(c.replace(/\\\|/g, "|"))))))));
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s/.test(l)) { root.append(h("div", { class: "li" }, ...inline(l.trim()))); continue; }
    if (l.startsWith(">")) { root.append(h("blockquote", {}, ...inline(l.replace(/^>\s?/, "")))); continue; }
    if (l.trim() && l.trim() !== "---") root.append(h("p", {}, ...inline(l)));
  }
  return root;
}

// ---------- 草稿 ----------
export interface Draft { id: string; title: string; idea: string; files: Record<string, string>; updated: number; chat: { role: "user" | "assistant"; content: string }[] }
const loadDrafts = (): Draft[] => { try { return JSON.parse(localStorage.getItem("oasis.drafts") ?? "[]"); } catch { return []; } };
const saveDrafts = (d: Draft[]) => localStorage.setItem("oasis.drafts", JSON.stringify(d));
const putDraft = (d: Draft) => { const all = loadDrafts().filter((x) => x.id !== d.id); d.updated = Date.now(); all.unshift(d); saveDrafts(all); };
const draftFiles = (d: Draft): StoryFiles => new Map(Object.entries(d.files).map(([k, v]) => [k, enc.encode(v)]));

/** 从 AI 回复里取出“文件：路径 + 代码块” */
export function parseFiles(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(?:^|\n)\s*(?:\*\*)?文件[:：]\s*`?([^\s`*]+)`?(?:\*\*)?\s*\n+```[^\n]*\n([\s\S]*?)\n```/g; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[1].replace(/^\.?\//, "")] = m[2];
  if (!Object.keys(out).length) { const y = text.match(/```ya?ml\n([\s\S]*?)\n```/); if (y) out["story.yaml"] = y[1]; }
  return out;
}

interface Ctx { play: (id: string, title: string, files: StoryFiles) => void; importFiles: (name: string, files: StoryFiles) => Promise<void> }

export function showCreate(app: HTMLElement, nav: HTMLElement, ctx: Ctx, tab = "write", draftId?: string): void {
  const tabs = [["write", "✍️ 用 AI 写故事"], ["docs", "📘 规范与指南"], ["check", "🔍 导入检查"], ["submit", "📮 投稿到故事库"]];
  const body = h("div", {});
  const page = h("main", { class: "page" }, h("h2", {}, "创作"),
    h("div", { class: "tabs" }, ...tabs.map(([id, t]) => h("button", { class: id === tab ? "on" : "", onclick: () => showCreate(app, nav, ctx, id) }, t))), body);
  app.replaceChildren(nav, page);
  if (tab === "docs") return docsTab(body);
  if (tab === "check") return checkTab(body, ctx);
  if (tab === "submit") { body.replaceChildren(submitView(loadDrafts().map((d) => ({ title: d.title, files: () => draftFiles(d) })), submitGuide)); return; }
  return writeTab(body, ctx, draftId, () => showCreate(app, nav, ctx, "write"), (id) => showCreate(app, nav, ctx, "write", id));
}

function docsTab(body: HTMLElement) {
  let cur = DOCS[0];
  const view = h("div", { class: "doc-view" });
  const draw = () => {
    view.replaceChildren(
      h("div", { class: "row" },
        ...DOCS.map((d) => h("button", { class: d === cur ? "primary" : "", onclick: () => { cur = d; draw(); } }, d.title)),
        h("span", { class: "spacer" }),
        h("button", { onclick: async () => { if (await bridge.exportFile(cur.file, cur.text, cur.ext, cur.title)) toast("已下载"); } }, `下载《${cur.title}》`),
        h("button", { onclick: () => copyText(AUTHOR_PROMPT, "已复制。把它贴给任意聊天 AI，再说出你的故事想法即可") }, "复制给 AI 的说明")),
      cur.ext === "json" ? h("pre", { class: "fixreq" }, cur.text) : renderMd(cur.text));
  };
  draw();
  body.replaceChildren(
    h("div", { class: "card" }, h("p", {}, "不想在客户端里写？点“复制给 AI 的说明”，贴到任何聊天 AI（DeepSeek、Kimi、豆包、ChatGPT 等）里，再告诉它你的故事想法；把它给出的文件存成文件夹或 story.yaml，到“导入检查”里检查。")),
    view);
}

function checkTab(body: HTMLElement, ctx: Ctx) {
  const out = h("div", {});
  let last: { name: string; files: StoryFiles } | null = null;
  const run = (name: string, files: StoryFiles) => {
    last = { name, files }; const res = validateFiles(files);
    out.replaceChildren(h("h3", {}, `检查结果：${name}`), issuesView(res),
      h("div", { class: "row" },
        h("button", { onclick: pick }, "改好了，重新选择文件检查"),
        res.ok ? h("button", { class: "primary", onclick: () => ctx.importFiles(name, files) }, "存入故事库") : null,
        res.ok && res.story ? h("button", { onclick: () => ctx.play(`check-${res.story!.meta.id}`, res.story!.meta.title, files) }, "直接试玩") : null));
  };
  const pick = async () => { try { const p = await bridge.pickPackage(false); if (p) run(p.name, p.files); } catch (e: any) { toast(`读取失败：${e?.message ?? e}`, "err"); } };
  const drop = h("div", { class: "drop" }, h("p", {}, "选择或拖入故事包（.oasis / .zip / story.yaml），只检查、不导入。改完后再检查一次，没问题再存入故事库。"),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: pick }, "选择文件检查")));
  drop.ondragover = (e) => e.preventDefault();
  drop.ondrop = async (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) run(f.name, filesFromSingle(f.name, new Uint8Array(await f.arrayBuffer()))); };
  body.replaceChildren(drop, out);
  void last;
}

function writeTab(body: HTMLElement, ctx: Ctx, draftId: string | undefined, back: () => void, open: (id: string) => void) {
  const drafts = loadDrafts();
  const d = draftId ? drafts.find((x) => x.id === draftId) : undefined;
  if (!d) {
    const idea = h("textarea", { rows: 6, placeholder: "例如：一个下雨的夜晚，你是小镇书店的店员，最后一位客人留下了一本会自己写字的日记。三个结局，玩 15 分钟左右，适合所有年龄。" }) as HTMLTextAreaElement;
    const s = loadSettings();
    body.replaceChildren(
      h("div", { class: "card" }, h("h3", {}, "说出你的故事想法"),
        h("p", { class: "small muted" }, `会用你在“设置”里接好的 AI（${s.model || "未设置"}）按《AI 创作指南》生成完整故事包。生成后自动存成草稿，可以检查、修改、试玩、导出。`),
        idea,
        h("div", { class: "row" }, h("button", { class: "primary", onclick: async () => {
          if (!idea.value.trim()) return toast("先写一句故事想法", "err");
          if (!isLocalUrl(s.base_url) && !(await bridge.keyHas(s.provider).catch(() => false))) return toast("还没有接好 AI：请先到“设置”里选服务商并填 Key", "err");
          const nd: Draft = { id: `d${Date.now().toString(36)}`, title: idea.value.trim().slice(0, 20), idea: idea.value.trim(), files: {}, updated: Date.now(), chat: [] };
          putDraft(nd); open(nd.id); setTimeout(() => document.dispatchEvent(new CustomEvent("oasis-gen", { detail: { id: nd.id, msg: `我的故事想法：\n${nd.idea}\n\n请按要求输出完整的故事包文件。` } })), 50);
        } }, "开始生成"))),
      h("h3", {}, "我的草稿"),
      drafts.length ? h("div", { class: "drafts" }, ...drafts.map((x) => h("div", { class: "draft-row" },
        h("b", {}, x.title), h("span", { class: "muted small" }, new Date(x.updated).toLocaleString("zh-CN")),
        h("button", { onclick: () => open(x.id) }, "打开"),
        h("button", { onclick: () => { if (confirm(`删除草稿「${x.title}」？`)) { saveDrafts(loadDrafts().filter((y) => y.id !== x.id)); back(); } } }, "删除"))))
        : h("p", { class: "muted" }, "还没有草稿。"));
    return;
  }
  draftEditor(body, d, ctx, back);
}

function draftEditor(body: HTMLElement, d: Draft, ctx: Ctx, back: () => void) {
  let cur = Object.keys(d.files).includes("story.yaml") ? "story.yaml" : Object.keys(d.files)[0] ?? "story.yaml";
  let busy = false;
  const live = h("pre", { class: "ai-live" });
  const result = h("div", {});
  const editor = h("textarea", { class: "code", rows: 24, spellcheck: false }) as HTMLTextAreaElement;
  editor.oninput = () => { d.files[cur] = editor.value; putDraft(d); };
  const generate = async (msg: string) => {
    if (busy) return; busy = true; draw();
    const s = loadSettings();
    const messages = [{ role: "system", content: AUTHOR_PROMPT }, ...d.chat.slice(-6), { role: "user", content: msg }];
    live.textContent = "AI 正在写，请稍候（长故事可能要一两分钟）…\n";
    try {
      let acc = "";
      const r = await bridge.chat(s.provider, { base_url: s.base_url, model: s.model }, { messages, temperature: 0.7 }, (t) => { acc += t; live.textContent = acc; live.scrollTop = live.scrollHeight; });
      const text = r.content ?? acc;
      const files = parseFiles(text);
      if (!Object.keys(files).length) { toast("AI 的回复里没找到文件，可以再试一次或换个说法", "err"); }
      else { Object.assign(d.files, files); const t = text.match(/title:\s*(.+)/)?.[1]?.trim(); if (t) d.title = t.replace(/^['"]|['"]$/g, ""); }
      d.chat.push({ role: "user", content: msg }, { role: "assistant", content: text.slice(0, 20000) });
      putDraft(d); cur = files["story.yaml"] !== undefined ? "story.yaml" : cur;
      check();
    } catch (e) { live.textContent += `\n\n❌ ${explainError(e)}`; }
    busy = false; draw();
  };
  const check = () => { const res = validateFiles(draftFiles(d)); result.replaceChildren(issuesView(res)); return res; };
  const onGen = (e: any) => { if (e.detail.id === d.id) generate(e.detail.msg); };
  document.addEventListener("oasis-gen", onGen, { once: true });
  const draw = () => {
    editor.value = d.files[cur] ?? ""; editor.disabled = busy;
    const ask = h("input", { placeholder: "还想改什么？例如：把结局改成四个、加一个会说话的猫 NPC", disabled: busy }) as HTMLInputElement;
    body.replaceChildren(
      h("div", { class: "row" }, h("button", { onclick: back }, "← 草稿列表"), h("b", {}, d.title), h("span", { class: "muted small" }, "草稿自动保存在本机")),
      h("div", { class: "row" },
        h("button", { class: "primary", disabled: busy, onclick: () => { const r = check(); toast(r.ok ? "检查通过" : "有错误，见下方", r.ok ? "ok" : "err"); } }, "校验"),
        h("button", { disabled: busy, onclick: () => { const r = check(); if (!r.ok) return toast("有错误，改完才能试玩", "err"); ctx.play(`draft-${d.id}`, d.title, draftFiles(d)); } }, "试玩"),
        h("button", { disabled: busy, onclick: async () => { const r = check(); if (!r.ok) return toast("有错误，改完才能导出", "err"); if (await bridge.exportFile(`${r.story!.meta.id}.oasis`, filesToZip(draftFiles(d)), "oasis", "故事包")) toast("已导出 .oasis"); } }, "导出 .oasis"),
        h("button", { disabled: busy, onclick: async () => { const r = check(); if (!r.ok) return toast("有错误，改完才能存入故事库", "err"); await ctx.importFiles(`${d.title}`, draftFiles(d)); } }, "存入故事库"),
        h("button", { disabled: busy, onclick: () => { const r = check(); if (r.ok) return toast("没有错误，不需要修"); generate(`${aiFixRequest(r)}\n\n请输出修改后的完整文件。`); } }, "让 AI 修复错误")),
      h("div", { class: "editor" },
        h("div", { class: "files" }, ...Object.keys(d.files).concat(d.files["story.yaml"] === undefined ? ["story.yaml"] : []).map((f) => h("button", { class: f === cur ? "on" : "", onclick: () => { cur = f; draw(); } }, f))),
        editor),
      h("div", { class: "row" }, ask, h("button", { class: "primary", disabled: busy, onclick: () => { if (ask.value.trim()) generate(`${ask.value.trim()}\n\n这是当前的 story.yaml：\n\`\`\`yaml\n${d.files["story.yaml"] ?? ""}\n\`\`\`\n请输出修改后的完整文件。`); } }, "让 AI 修改")),
      d.chat.length || busy ? h("details", { open: busy }, h("summary", {}, "AI 的完整回复"), live) : "",
      result);
    if (!busy && !live.textContent && d.chat.length) live.textContent = d.chat[d.chat.length - 1].content;
  };
  draw(); if (Object.keys(d.files).length) check();
}
