import "./style.css";
import { validateFiles, filesToZip, filesFromZip, aiFixRequest, type StoryFiles, type ValidationResult, type Issue } from "@my-oasis/schema";
import { h, toast } from "./dom";
import { bridge, isTauri, filesFromSingle, b64ToBytes } from "./bridge";
import { PROVIDERS, loadSettings, saveSettings, isLocalUrl } from "./settings";
import { PlaySession } from "./play";
import testStory from "../../../examples/guess-the-box/story.yaml?raw";

const app = document.getElementById("app")!;
const TEST_ID = "__test__";
interface Entry { id: string; files: StoryFiles; res: ValidationResult; test?: boolean }

function nav(active: string) {
  return h("header", { class: "nav" }, h("b", { class: "brand" }, "🌴 我的绿洲"),
    h("button", { class: active === "lib" ? "on" : "", onclick: () => showLibrary() }, "故事库"),
    h("button", { class: active === "set" ? "on" : "", onclick: () => showSettings() }, "设置"),
    h("span", { class: "spacer" }), !isTauri ? h("span", { class: "muted small" }, "浏览器开发模式") : null);
}

async function loadEntries(): Promise<Entry[]> {
  const out: Entry[] = [];
  const tf = new Map([["story.yaml", new TextEncoder().encode(testStory)]]);
  out.push({ id: TEST_ID, files: tf, res: validateFiles(tf), test: true });
  for (const id of await bridge.libraryList().catch(() => [])) {
    try { const files = filesFromZip(await bridge.libraryGet(id)); out.push({ id, files, res: validateFiles(files) }); } catch { /* 跳过损坏的 */ }
  }
  return out;
}

// ---------- 故事库 ----------
async function showLibrary() {
  const entries = await loadEntries();
  const card = (e: Entry) => {
    const m = e.res.story?.meta;
    const cover = (() => { const ref: any = m?.cover; if (!ref) return; const p = ref.startsWith("asset:") ? (e.res.story as any).assets?.[ref.slice(6)]?.path : ref; const d = p && e.files.get(p); return d ? URL.createObjectURL(new Blob([d as BlobPart])) : undefined; })();
    return h("div", { class: "story-card" },
      cover ? h("img", { src: cover, class: "cover" }) : h("div", { class: "cover ph" }, (m?.title ?? "?").slice(0, 1)),
      h("div", { class: "info" },
        h("h3", {}, m?.title ?? e.id, e.test ? h("span", { class: "tag" }, "测试用") : null, e.res.story?.ai ? h("span", { class: "tag ai" }, "需要 AI") : h("span", { class: "tag" }, "纯规则")),
        h("p", { class: "muted" }, m?.summary ?? ""),
        h("p", { class: "small muted" }, `版本 ${m?.version ?? "?"}${m?.author ? ` · 作者 ${m.author}` : ""}`),
        e.res.ok ? null : h("p", { class: "err small" }, "这个故事有错误，不能游玩"),
        h("div", { class: "row" },
          h("button", { class: "primary", disabled: !e.res.ok, onclick: () => play(e) }, "开始"),
          h("button", { disabled: !e.res.ok, onclick: () => resume(e) }, "继续"),
          !e.test ? h("button", { onclick: async () => { if (confirm(`删除故事「${m?.title}」？存档不会删除。`)) { await bridge.libraryDelete(e.id); showLibrary(); } } }, "删除") : null)));
  };
  const drop = h("div", { class: "drop" }, h("p", {}, "把 .oasis 文件、story.yaml 或故事文件夹拖到这里"),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => importPicked(false) }, "导入故事文件"), isTauri ? h("button", { onclick: () => importPicked(true) }, "导入文件夹") : null),
    h("p", { class: "small muted" }, "客户端不带编辑器：故事包可以自己写，也可以让 AI 按《AI 创作指南》生成。"));
  drop.ondragover = (ev) => { ev.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = async (ev) => { ev.preventDefault(); drop.classList.remove("over"); const f = ev.dataTransfer?.files?.[0]; if (f) await importFiles(f.name, filesFromSingle(f.name, new Uint8Array(await f.arrayBuffer()))); };
  app.replaceChildren(nav("lib"), h("main", { class: "page" }, h("h2", {}, "故事库"), drop, h("div", { class: "cards" }, ...entries.map(card))));
}

async function importPicked(folder: boolean) {
  try { const p = await bridge.pickPackage(folder); if (p) await importFiles(p.name, p.files); }
  catch (e: any) { toast(`读取失败：${e?.message ?? e}`, "err"); }
}

async function importFiles(name: string, files: StoryFiles) {
  const res = validateFiles(files);
  if (!res.ok || !res.story) return showIssues(name, res);
  const id = res.story.meta.id;
  if ((await bridge.libraryList()).includes(id) && !confirm(`故事库里已经有「${res.story.meta.title}」，要用新版本替换吗？`)) return;
  await bridge.libraryPut(id, filesToZip(files));
  toast(`已导入「${res.story.meta.title}」${res.issues.length ? `（有 ${res.issues.length} 条提醒）` : ""}`);
  if (res.issues.length) return showIssues(name, res, true);
  showLibrary();
}

// ---------- 大白话报错 ----------
export function issueCard(i: Issue) {
  return h("div", { class: `issue ${i.level}` },
    h("div", { class: "issue-head" }, h("span", { class: "lv" }, i.level === "error" ? "错误" : i.level === "warning" ? "提醒" : "说明"),
      h("b", {}, `${i.file}${i.line ? ` 第 ${i.line} 行` : ""}`), i.where ? h("span", { class: "muted" }, `（${i.where}）`) : null),
    h("p", {}, i.message), i.fix ? h("p", { class: "fix" }, `👉 ${i.fix}`) : null, i.ref ? h("p", { class: "small muted" }, `规范 ${i.ref}`) : null);
}
function showIssues(name: string, res: ValidationResult, imported = false) {
  const errs = res.issues.filter((i) => i.level === "error").length, warns = res.issues.length - errs;
  const fix = aiFixRequest(res);
  app.replaceChildren(nav("lib"), h("main", { class: "page" },
    h("h2", {}, imported ? `「${name}」已导入，有几条提醒` : `「${name}」不能导入`),
    h("p", {}, errs ? `发现 ${errs} 个错误${warns ? `、${warns} 条提醒` : ""}。错误改完才能导入。` : `有 ${warns} 条提醒，不影响游玩。`),
    h("div", { class: "row" },
      fix ? h("button", { class: "primary", onclick: async () => { await navigator.clipboard.writeText(fix).then(() => toast("已复制，粘贴给 AI 让它修改即可"), () => toast("复制失败，请手动选中下方文字", "err")); } }, "复制给 AI 修改") : null,
      h("button", { onclick: () => showLibrary() }, "返回故事库")),
    h("div", { class: "issues" }, ...res.issues.map(issueCard)),
    fix ? h("details", {}, h("summary", {}, "要复制给 AI 的文字"), h("pre", { class: "fixreq" }, fix)) : null));
}

// ---------- 游玩 ----------
async function play(e: Entry, save?: any) {
  const s = new PlaySession(e.res.story!, e.files, e.test ? "guess-the-box-test" : e.id, () => showLibrary());
  app.replaceChildren(s.root);
  try { await s.init(save); } catch (err: any) { toast(err.message, "err"); showLibrary(); }
}
async function resume(e: Entry) {
  const sid = e.test ? "guess-the-box-test" : e.id;
  try { await play(e, JSON.parse(await bridge.saveRead(sid, "auto"))); }
  catch { toast("还没有自动存档，从头开始"); play(e); }
}

// ---------- 设置 ----------
async function showSettings() {
  const s = loadSettings();
  const prov = () => PROVIDERS.find((p) => p.id === s.provider) ?? PROVIDERS[PROVIDERS.length - 1];
  const keyState = h("span", { class: "muted" });
  const refreshKey = async () => { keyState.textContent = isLocalUrl(s.base_url) ? "本机模型不需要 Key" : (await bridge.keyHas(s.provider).catch(() => false)) ? "✅ 已保存在系统钥匙串" : "未填写"; };
  const url = h("input", { value: s.base_url, oninput: (ev: any) => (s.base_url = ev.target.value.trim()) }) as HTMLInputElement;
  const model = h("input", { value: s.model, oninput: (ev: any) => (s.model = ev.target.value.trim()) }) as HTMLInputElement;
  const key = h("input", { type: "password", placeholder: "粘贴 API Key（只存在本机系统钥匙串）", autocomplete: "off" }) as HTMLInputElement;
  const note = h("p", { class: "small muted" }, prov().note ?? "");
  const sel = h("select", { onchange: (ev: any) => { s.provider = ev.target.value; const p = prov(); s.base_url = p.base_url; s.model = p.model; url.value = p.base_url; model.value = p.model; note.textContent = p.note ?? ""; refreshKey(); } },
    ...PROVIDERS.map((p) => h("option", { value: p.id, selected: p.id === s.provider }, p.name)));
  const persist = () => {
    if (!/^https:\/\//.test(s.base_url) && !isLocalUrl(s.base_url)) { toast("模型地址必须以 https:// 开头（本机模型可以用 http://localhost）", "err"); return false; }
    saveSettings(s); return true;
  };
  app.replaceChildren(nav("set"), h("main", { class: "page narrow" },
    h("h2", {}, "设置"),
    h("section", { class: "card" }, h("h3", {}, "AI 模型"),
      h("label", {}, "服务商", sel), note,
      h("label", {}, "接口地址", url),
      h("label", {}, "模型名称", model),
      h("label", {}, "API Key", key),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: async () => { if (!persist()) return; if (key.value.trim()) { try { await bridge.keySet(s.provider, key.value.trim()); key.value = ""; toast("已保存"); } catch (e: any) { toast(`保存 Key 失败：${e?.message ?? e}`, "err"); } } else toast("已保存"); refreshKey(); } }, "保存"),
        h("button", { onclick: async () => { await bridge.keyDelete(s.provider).catch(() => {}); toast("已删除 Key"); refreshKey(); } }, "删除 Key"),
        h("button", { onclick: async () => { if (!persist()) return; await testConnection(s); } }, "测试连接"), keyState),
      h("p", { class: "small muted" }, "Key 只保存在本机系统钥匙串（Windows 凭据管理器），界面拿不到原文，请求由客户端后台代发；不会进存档、不会上传。")),
    h("section", { class: "card" }, h("h3", {}, "游玩"),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.merge, onchange: (ev: any) => { s.merge = ev.target.checked; saveSettings(s); } }), "同一次操作的多个 AI 环节尽量合并成一次请求（更快、更省）"),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.imageGen, onchange: (ev: any) => { s.imageGen = ev.target.checked; saveSettings(s); } }), "允许故事使用 AI 生图（尚未开放；关闭时显示故事自带的替代图）"),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.muted, onchange: (ev: any) => { s.muted = ev.target.checked; saveSettings(s); } }), "静音")),
    h("p", { class: "small muted" }, "我的绿洲 · 单机版 0.1（内部测试）")));
  refreshKey();
}
async function testConnection(s: ReturnType<typeof loadSettings>) {
  try {
    const r = await bridge.chat(s.provider, { base_url: s.base_url, model: s.model }, { messages: [{ role: "user", content: "只回复：好" }], max_tokens: 5 });
    toast(`连接成功：${(r.content ?? "").slice(0, 20)}`);
  } catch (e: any) { toast(`连接失败：${e?.message ?? e}`, "err"); }
}

// Tauri：拖入文件
if (isTauri) {
  import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent(async (ev: any) => {
    if (ev.payload.type !== "drop" || !ev.payload.paths?.length) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const raw: any = await invoke("read_package", { path: ev.payload.paths[0] });
      const files = raw.kind === "folder" ? new Map(raw.files.map((f: any) => [f.path, b64ToBytes(f.base64)])) as StoryFiles : filesFromSingle(raw.name, b64ToBytes(raw.base64));
      await importFiles(raw.name, files);
    } catch (e: any) { toast(`读取失败：${e?.message ?? e}`, "err"); }
  }));
}
showLibrary();
