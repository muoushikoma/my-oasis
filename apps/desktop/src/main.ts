import "./style.css";
import { validateFiles, filesToZip, filesFromZip, type StoryFiles, type ValidationResult } from "@my-oasis/schema";
import { h, toast } from "./dom";
import { bridge, isTauri, filesFromSingle, b64ToBytes } from "./bridge";
import { loadSettings, saveSettings, tr, trList } from "./settings";
import { PlaySession } from "./play";
import { issuesView } from "./issues";
import { providerSetup, showWizard } from "./setup";
import { showCreate } from "./create";
import { onlineView } from "./online";
import { endSession, loadUsage, resetUsage, fmtTokens, fmtCost, loadPrices, savePrices, priceKey, defaultPrice, type Price } from "./usage";

const app = document.getElementById("app")!;
interface Entry { id: string; files: StoryFiles; res: ValidationResult }
let section: "play" | "create" | "set" = "play";

function nav(active: string) {
  return h("header", { class: "nav" }, h("b", { class: "brand" }, "🌴 我的绿洲"),
    h("button", { class: active === "play" ? "on" : "", onclick: () => showLibrary() }, "🎮 游玩"),
    h("button", { class: active === "create" ? "on" : "", onclick: () => openCreate() }, "✍️ 创作"),
    h("span", { class: "spacer" }), !isTauri ? h("span", { class: "muted small" }, "浏览器开发模式") : null,
    h("button", { class: active === "set" ? "on" : "", onclick: () => showSettings() }, "⚙️ 设置"));
}
const createCtx = { play: (id: string, _t: string, files: StoryFiles) => play(id, files, () => openCreate()), importFiles: (n: string, f: StoryFiles) => importFiles(n, f) };
function openCreate(tab?: string) { endSession(); section = "create"; showCreate(app, nav("create"), createCtx, tab); }

async function loadEntries(): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const id of await bridge.libraryList().catch(() => [])) {
    try { const files = filesFromZip(await bridge.libraryGet(id)); out.push({ id, files, res: validateFiles(files) }); } catch { /* 跳过损坏的 */ }
  }
  return out;
}

// ---------- 游玩：故事库 ----------
let playTab: "local" | "online" = "local";
async function showLibrary(tab = playTab) {
  endSession(); section = "play"; playTab = tab;
  const tabs = h("div", { class: "tabs" },
    h("button", { class: tab === "local" ? "on" : "", onclick: () => showLibrary("local") }, "📚 我的故事库"),
    h("button", { class: tab === "online" ? "on" : "", onclick: () => showLibrary("online") }, "🌐 在线故事库"));
  if (tab === "online") {
    app.replaceChildren(nav("play"), h("main", { class: "page" }, h("h2", {}, "游玩"), tabs, onlineView(async (st, files) => { await importFiles(tr(st.title), files); })));
    return;
  }
  const entries = await loadEntries();
  const card = (e: Entry) => {
    const m = e.res.story?.meta;
    const cover = (() => { const ref: any = m?.cover; if (!ref) return; const p = ref.startsWith("asset:") ? (e.res.story as any).assets?.[ref.slice(6)]?.path : ref; const d = p && e.files.get(p); return d ? URL.createObjectURL(new Blob([d as BlobPart])) : undefined; })();
    return h("div", { class: "story-card" },
      cover ? h("img", { src: cover, class: "cover" }) : h("div", { class: "cover ph" }, (tr(m?.title) || "?").slice(0, 1)),
      h("div", { class: "info" },
        h("h3", {}, tr(m?.title) || e.id, e.res.story?.ai ? h("span", { class: "tag ai" }, "需要 AI") : h("span", { class: "tag" }, "纯规则")),
        h("p", { class: "muted" }, tr(m?.summary)), trList(m?.tags).length ? h("p", { class: "small muted" }, trList(m?.tags).join(" · ")) : null,
        h("p", { class: "small muted" }, `版本 ${m?.version ?? "?"}${m?.author ? ` · 作者 ${m.author}` : ""}`),
        e.res.ok ? null : h("p", { class: "err small" }, "这个故事有错误，不能游玩"),
        h("div", { class: "row" },
          h("button", { class: "primary", disabled: !e.res.ok, onclick: () => play(e.id, e.files) }, "开始"),
          h("button", { disabled: !e.res.ok, onclick: () => resume(e) }, "继续"),
          h("button", { onclick: async () => { if (confirm(`删除故事「${tr(m?.title)}」？存档不会删除。`)) { await bridge.libraryDelete(e.id); showLibrary(); } } }, "删除"))));
  };
  const drop = h("div", { class: "drop" }, h("p", {}, "把 .oasis 文件、story.yaml 或故事文件夹拖到这里"),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => importPicked(false) }, "导入故事文件"), isTauri ? h("button", { onclick: () => importPicked(true) }, "导入文件夹") : null),
    h("p", { class: "small muted" }, "还没有故事？到“创作”里让 AI 帮你写一个，或者按《AI 创作指南》自己写。"));
  drop.ondragover = (ev) => { ev.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = async (ev) => { ev.preventDefault(); drop.classList.remove("over"); const f = ev.dataTransfer?.files?.[0]; if (f) await importFiles(f.name, filesFromSingle(f.name, new Uint8Array(await f.arrayBuffer()))); };
  const empty = h("div", { class: "empty" },
    h("h3", {}, "导入你的第一个故事"),
    h("ol", {},
      h("li", {}, "到“创作”里说出故事想法，让已连接的 AI 帮你写；或者照《AI 创作指南》自己写一个故事包（.oasis 文件、story.yaml 或文件夹）。"),
      h("li", {}, "点上面的“导入故事文件”，或者直接把文件拖进来。"),
      h("li", {}, "有错误时会用大白话告诉你哪一行怎么改，还能一键复制给 AI 修改。"),
      h("li", {}, "故事用到 AI 的话，先到“设置”里接好 AI。"),
      h("li", {}, "也可以到上方“在线故事库”下载其他作者投稿的故事。")),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => openCreate("write") }, "去创作"), h("button", { onclick: () => openCreate("docs") }, "看创作指南")));
  app.replaceChildren(nav("play"), h("main", { class: "page" }, h("h2", {}, "游玩"), tabs, drop, entries.length ? h("div", { class: "cards" }, ...entries.map(card)) : empty));
}

async function importPicked(folder: boolean) {
  try { const p = await bridge.pickPackage(folder); if (p) await importFiles(p.name, p.files); }
  catch (e: any) { toast(`读取失败：${e?.message ?? e}`, "err"); }
}
async function importFiles(name: string, files: StoryFiles) {
  const res = validateFiles(files);
  if (!res.ok || !res.story) return showIssues(name, res);
  const id = res.story.meta.id;
  if ((await bridge.libraryList()).includes(id) && !confirm(`故事库里已经有「${tr(res.story.meta.title)}」，要用新版本替换吗？`)) return;
  await bridge.libraryPut(id, filesToZip(files));
  toast(`已导入「${tr(res.story.meta.title)}」${res.issues.length ? `（有 ${res.issues.length} 条提醒）` : ""}`);
  if (res.issues.length) return showIssues(name, res, true);
  showLibrary();
}
function showIssues(name: string, res: ValidationResult, imported = false) {
  app.replaceChildren(nav(section), h("main", { class: "page" },
    h("h2", {}, imported ? `「${name}」已导入，有几条提醒` : `「${name}」不能导入`),
    issuesView(res),
    h("div", { class: "row" }, h("button", { onclick: () => importPicked(false) }, "改好了，重新导入"), h("button", { onclick: () => (section === "create" ? openCreate("check") : showLibrary()) }, "返回"))));
}

// ---------- 游玩 ----------
async function play(id: string, files: StoryFiles, back: () => void = () => showLibrary(), save?: any) {
  const res = validateFiles(files);
  if (!res.ok || !res.story) return showIssues(id, res);
  const s = new PlaySession(res.story, files, id, back);
  app.replaceChildren(s.root);
  try { await s.init(save); } catch (err: any) { toast(err.message, "err"); back(); }
}
async function resume(e: Entry) {
  try { await play(e.id, e.files, undefined, JSON.parse(await bridge.saveRead(e.id, "auto"))); }
  catch { toast("还没有自动存档，从头开始"); play(e.id, e.files); }
}

// ---------- 设置 ----------
function showSettings() {
  section = "set";
  const s = loadSettings();
  const chk = (key: "merge" | "imageGen" | "muted", text: string) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: s[key], onchange: (ev: any) => { s[key] = ev.target.checked; saveSettings({ ...loadSettings(), [key]: ev.target.checked }); } }), text);
  app.replaceChildren(nav("set"), h("main", { class: "page narrow" },
    h("h2", {}, "设置"),
    h("section", { class: "card" }, h("h3", {}, "接 AI 模型"),
      h("p", { class: "small muted" }, "选好服务商后会自动填入接口地址和推荐模型，你只需要照教程拿到 Key 粘贴进来，再点“测试连接”。提醒：ChatGPT Plus 会员不等于 API，API 要在 OpenAI 开发者平台单独充值。"),
      providerSetup()),
    h("section", { class: "card" }, h("h3", {}, "游玩"),
      chk("merge", "同一次操作的多个 AI 环节尽量合并成一次请求（更快、更省）"),
      chk("imageGen", "允许故事使用 AI 生图（尚未开放；关闭时显示故事自带的替代图）"),
      chk("muted", "静音"),
      h("label", {}, "故事语言 / Story language ", h("select", { onchange: (ev: any) => { saveSettings({ ...loadSettings(), lang: ev.target.value }); showSettings(); } },
        h("option", { value: "zh", selected: s.lang === "zh" }, "中文"), h("option", { value: "en", selected: s.lang === "en" }, "English"))),
      h("p", { class: "small muted" }, "故事里的文字和 AI 回复都会用这种语言；作者没写这种语言时显示另一种。"),
      h("div", { class: "row" }, h("button", { onclick: () => showWizard(() => showSettings()) }, "重新打开新手向导"))),
    usageCard(),
    h("p", { class: "small muted" }, "我的绿洲 · 单机版 0.1（内部测试）")));
}

// ---------- AI 用量（只在本机） ----------
function usageCard() {
  const s = loadSettings(); const u = loadUsage();
  const key = priceKey(s.provider, s.model);
  const p: Price = loadPrices()[key] ?? defaultPrice(s.provider) ?? { currency: "¥" };
  const num = (v?: number) => (v === undefined ? "" : String(v));
  const inIn = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "未设置", value: num(p.input) }) as HTMLInputElement;
  const inOut = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "未设置", value: num(p.output) }) as HTMLInputElement;
  const cur = h("select", {}, ...["¥", "$"].map((c) => h("option", { value: c, selected: p.currency === c }, c === "¥" ? "人民币 ¥" : "美元 $"))) as HTMLSelectElement;
  const savePrice = () => {
    const all = loadPrices(); const f = (x: string) => (x.trim() === "" ? undefined : Math.max(0, Number(x)));
    const np: Price = { input: f(inIn.value), output: f(inOut.value), currency: cur.value };
    if (np.input === undefined && np.output === undefined) delete all[key]; else all[key] = np;
    savePrices(all); toast("单价已保存（只影响之后的记录）");
  };
  const stories = Object.entries(u.stories).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));
  const line = (label: string, t: any) => h("div", { class: "usage-row" }, h("b", {}, label), h("span", {}, fmtTokens(t)), h("span", { class: "muted" }, fmtCost(t)));
  return h("section", { class: "card" }, h("h3", {}, "AI 用量"),
    h("p", { class: "small muted" }, "每次 AI 回话用了多少 token 都记在这台设备上，不会上传。服务商没返回用量时按文字长度估算，会标“估算”。费用只是按你填的单价粗算，实际以服务商账单为准。"),
    line("全部累计", u.total),
    h("p", { class: "small muted" }, `从 ${new Date(u.since).toLocaleDateString("zh-CN")} 开始统计，共 ${u.total.calls} 次 AI 调用`),
    stories.length ? h("details", {}, h("summary", {}, "按故事查看"),
      ...stories.map(([id, t]) => h("div", { class: "usage-row" }, h("b", {}, tr(t.title) || id), h("span", {}, fmtTokens(t)), h("span", { class: "muted" }, fmtCost(t)),
        h("button", { class: "small", onclick: () => { if (confirm(`清零《${tr(t.title) || id}》的用量？`)) { resetUsage(id); showSettings(); } } }, "清零")))) : null,
    h("h4", {}, `单价（当前模型：${s.model || "未选择"}）`),
    h("p", { class: "small muted" }, "单位：每 100 万 token 多少钱。默认不预填（各家价格常变、还分档），请照服务商官网价格表自己填；本机模型（Ollama / LM Studio）默认按 0 计算。留空就只记 token 不算钱。"),
    h("div", { class: "row wrap" }, h("label", {}, "输入 ", inIn), h("label", {}, "输出 ", inOut), cur, h("button", { onclick: savePrice }, "保存单价")),
    h("div", { class: "row" }, h("button", { onclick: () => { if (confirm("把所有 AI 用量记录清零？")) { resetUsage(); showSettings(); } } }, "全部清零")));
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
showLibrary().then(() => { if (!loadSettings().onboarded) showWizard(() => showLibrary()); });
