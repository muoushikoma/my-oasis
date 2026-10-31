// 游玩页面：按作者的 ui 渲染布局与组件（没写 ui 用简约模板），驱动引擎和 AI。
import { Game, entriesFor, runEntries, parseChoices, createQuickJsRunner, type LLM, type ScriptRunner, type EntryRunResult } from "@my-oasis/engine";
import type { Story, StoryFiles } from "@my-oasis/schema";
import { h, toast, fmtVal } from "./dom";
import { AssetBox } from "./assets";
import { RealtimeDriver } from "./realtime";
import { bridge } from "./bridge";
import { makeLlm } from "./llm";
import { beginSession, sessionUsage, loadUsage, onUsage, fmtNum, fmtCost, zero } from "./usage";
import { explainError } from "./providers";
import { loadSettings, saveSettings, isLocalUrl, type Settings } from "./settings";

interface Feed { id: number; to: string; text: string; kind: "ai" | "rule" | "event" | "ending" | "player" | "reject" | "error" | "dice"; who?: string; streaming?: boolean }

const TEMPLATES: Record<string, { areas: string[]; cols: string; rows: string }> = {
  simple: { areas: ["status", "main", "input"], cols: "1fr", rows: "auto 1fr auto" },
  "two-column": { areas: ["main side", "input side"], cols: "1fr minmax(260px, 32%)", rows: "1fr auto" },
  stage: { areas: ["top top", "main side", "input side"], cols: "1fr minmax(260px, 32%)", rows: "auto 1fr auto" },
};
const THEMES: Record<string, Record<string, string>> = {
  light: { bg: "#f6f7f9", panel: "#ffffff", text: "#1d2330", accent: "#1f8a70" },
  dark: { bg: "#14171f", panel: "#1e2330", text: "#e6e9ef", accent: "#4fd1a5" },
  sepia: { bg: "#efe6d2", panel: "#f8f1e1", text: "#3b2f22", accent: "#9a5b2c" },
};

/** 没写 ui 时的简约默认界面 */
function defaultUi(story: Story): any {
  const comps: Record<string, any> = { log: { type: "text-log", region: "main", content: "ai" } };
  const vis = Object.entries(story.state).filter(([, d]: any) => (d.visible ?? "both") === "both" || d.visible === "player").map(([k]) => k);
  if (vis.length) comps.stats = { type: "stat-list", region: "status", bind: vis };
  if (Object.values(story.ai?.entry_points ?? {}).some((e: any) => e.trigger === "player_input"))
    comps.input = { type: "text-input", region: "input", placeholder: "你要做什么？", input: { actions: Object.keys(story.actions ?? {}), reject: "这里做不到这件事。" } };
  const btns = Object.entries(story.actions ?? {}).filter(([, a]: any) => (a.callable_by ?? ["player", "ai", "rules"]).includes("player") && !Object.keys(a.params ?? {}).length);
  btns.forEach(([id, a]: any, i) => (comps[`btn_${i}`] = { type: "button", region: "input", label: a.label ?? id, action: id }));
  return { layout: { template: "simple" }, components: comps };
}

class Sound {
  music = new Audio(); cur = "";
  constructor(private s: Settings) { this.music.loop = true; }
  setMusic(url: string | undefined, vol = 1) {
    this.music.volume = Math.min(1, vol * this.s.music); this.music.muted = this.s.muted;
    if ((url ?? "") === this.cur) return;
    this.cur = url ?? "";
    if (!url) { this.music.pause(); return; }
    this.music.src = url; this.music.play().catch(() => { /* 等玩家第一次点击后再播放 */ });
  }
  effect(url: string | undefined) {
    if (!url || this.s.muted) return;
    const a = new Audio(url); a.volume = this.s.sfx; a.play().catch(() => {});
  }
  stop() { this.music.pause(); this.music.src = ""; }
}

export class PlaySession {
  game!: Game; ui: any; feed: Feed[] = []; seq = 0; shown = 0; busy = false; debug = false;
  llm?: LLM; scripts?: ScriptRunner; assets: AssetBox; sound: Sound; settings: Settings;
  aiChoices: Record<string, string[]> = {}; lastTools: EntryRunResult["toolLog"] = []; root = h("div", { class: "play" });
  aiNotice = "";
  rt?: RealtimeDriver; private rtEnded = false;

  /** oasis/0.4：有 realtime 的故事启动实时循环 */
  private startRealtime() {
    this.rt?.stop(); this.rt = undefined; this.rtEnded = false;
    if (!this.story.realtime) return;
    const self = this;
    this.rt = new RealtimeDriver({
      get game() { return self.game; }, story: this.story, assets: this.assets, get llm() { return self.llm; },
      muted: () => this.settings.muted, sfx: () => this.settings.sfx,
      onFrame: () => {
        this.flushLog();
        if (this.game.ending && !this.rtEnded) { this.rtEnded = true; void this.afterOp(false); return; }
        this.render();
      },
      onHooks: (hooks) => { for (const hk of hooks) { this.sound.effect(this.effectUrl(hk)); void this.runAi(entriesFor(this.game, hk), ""); } },
    });
  }

  constructor(public story: Story, public files: StoryFiles, public storyId: string, private onExit: () => void) {
    this.settings = loadSettings();
    this.ui = story.ui?.components ? story.ui : { ...defaultUi(story), ...(story.ui ?? {}), components: defaultUi(story).components };
    this.assets = new AssetBox(files, (story as any).assets ?? {});
    this.sound = new Sound(this.settings);
  }

  private offUsage?: () => void;
  /** 顶栏的用量小字：本局 / 这个故事累计（只在本机统计） */
  usageEl() {
    const se = sessionUsage(); const st = loadUsage().stories[this.storyId] ?? zero();
    if (!this.story.ai && !st.calls) return null;
    const est = se.estimatedCalls ? "（估）" : "";
    const cost = fmtCost(se);
    return h("span", { id: "usage-line", class: "muted small usage", title: "AI 用量只记在本机，不上传。详情和清零在“设置 → AI 用量”。" },
      `本局 ${fmtNum(se.input + se.output)} tokens${est}` + (cost && !cost.startsWith("费用") ? ` ${cost}` : "") + ` · 本故事累计 ${fmtNum(st.input + st.output)}`);
  }
  async init(save?: any) {
    beginSession(this.storyId, this.story.meta.title);
    this.offUsage?.(); this.offUsage = onUsage(() => { const el = document.getElementById("usage-line"); const n = this.usageEl(); if (el && n) el.replaceWith(n); });
    try { this.scripts = await createQuickJsRunner(); } catch { /* 没用脚本的故事不需要 */ }
    const s = this.settings;
    if (this.story.ai) {
      const local = isLocalUrl(s.base_url);
      if (local || (await bridge.keyHas(s.provider).catch(() => false))) this.llm = makeLlm(s);
      else this.aiNotice = "还没有填写 API Key：AI 部分会跳过（显示作者写的替代文字）。去“设置”填写后重新开始即可。";
    }
    if (save) {
      const r = Game.load(this.story, save, { files: this.files, scripts: this.scripts });
      this.game = r.game; r.warnings.forEach((w) => toast(w, "err"));
      this.feed = (this.game.extra.ui_feed ?? []) as Feed[]; this.seq = this.feed.length + 1; this.shown = this.game.log.length;
      this.startRealtime(); this.render(); this.rt?.start(); return;
    }
    this.game = new Game(this.story, { files: this.files, scripts: this.scripts });
    this.game.start();
    this.startRealtime();
    if (this.story.start?.intro) this.push("log", this.story.start.intro, "rule");
    this.flushLog(); this.sound.effect(this.effectUrl("game_start"));
    this.render();
    const eps = entriesFor(this.game, "game_start");
    const opening = eps.filter((e) => this.game.entry(e).opening);
    for (const e of opening) this.push(this.game.entry(e).card.output.to ?? "log", this.game.entry(e).opening!, "ai");
    this.rt?.start();
    await this.runAi(eps.filter((e) => !opening.includes(e)), "");
    this.afterOp(false);
  }

  // ---------- 文字流 ----------
  push(to: string, text: string, kind: Feed["kind"], who?: string): Feed {
    const f: Feed = { id: this.seq++, to, text, kind, who }; this.feed.push(f); return f;
  }
  flushLog() {
    for (const l of this.game.log.slice(this.shown)) {
      if (l.kind === "rule" || l.kind === "event" || l.kind === "ending" || l.kind === "error" || l.kind === "dice") this.push("log", l.text, l.kind as any);
    }
    this.shown = this.game.log.length;
  }
  effectUrl(key: string) { return this.assets.url(this.ui.sound?.effects?.[key]); }

  // ---------- AI ----------
  activeEntries(ids: string[]) {
    const off = this.settings.disabledEntries[this.storyId] ?? [];
    return ids.filter((id) => !(this.game.entry(id).optional && off.includes(id)));
  }
  async runAi(ids: string[], input: string, allowActions?: string[]) {
    ids = this.activeEntries(ids);
    if (!ids.length) return;
    const fallback = (id: string) => { const ep = this.game.entry(id); if (ep.fallback) this.push(ep.card.output.to ?? "log", ep.fallback, "ai", this.whoOf(ep.card.output.to)); };
    if (!this.llm) { ids.forEach(fallback); return; }
    const live: Record<string, Feed> = {};
    try {
      const rs = await runEntries(this.game, ids, this.llm, input, undefined, {
        allowActions, merge: this.settings.merge,
        onText: (id, chunk) => {
          const to = this.game.entry(id).card.output.to ?? "log";
          const f = (live[id] ??= Object.assign(this.push(to, "", "ai", this.whoOf(to)), { streaming: true }));
          f.text += chunk; const el = document.getElementById(`feed-${f.id}`); if (el) el.textContent = f.text; else this.render();
        },
      });
      for (const r of rs) {
        const ep = this.game.entry(r.entry);
        this.lastTools = r.toolLog;
        this.flushLog();
        const isChoice = (to: string) => this.ui.components[to.slice(10)]?.type === "choice-buttons";
        if (r.text && !isChoice(r.target)) { const f = live[r.entry]; if (f) { f.text = r.text; f.streaming = false; } else if (!r.target.startsWith("state:") && r.target !== "none") this.push(r.target, r.text, "ai", this.whoOf(r.target)); }
        if (r.sections) for (const [k, v] of Object.entries(r.sections)) { const to = (ep.card.output as any).sections?.[k]; if (v && to && !String(to).startsWith("state:") && !isChoice(String(to))) this.push(to, v, "ai", this.whoOf(to)); }
        // choices 约定：输出到 from_ai 选项按钮的文字，每一行是一个选项（见规范 §13）
        const outs: [string, string][] = [];
        if (r.text) outs.push([r.target, r.text]);
        for (const [k, v] of Object.entries(r.sections ?? {})) outs.push([String((ep.card.output as any).sections?.[k] ?? ""), v]);
        for (const [to, v] of outs) { const cid = to.startsWith("component:") ? to.slice(10) : ""; if (this.ui.components[cid]?.type === "choice-buttons") this.aiChoices[cid] = parseChoices(v); }
        if (r.error) this.push("log", `AI：${r.error}`, "error");
      }
    } catch (e: any) {
      this.push("log", `AI 请求失败：${explainError(e)}`, "error");
      ids.forEach(fallback);
    }
    for (const f of Object.values(live)) f.streaming = false;
  }
  whoOf(to?: string) { const [k, id] = (to ?? "").split(":"); return k === "component" ? this.ui.components[id]?.title : undefined; }

  // ---------- 玩家操作 ----------
  async op(f: () => Promise<boolean | void>) {
    if (this.busy || this.game.ending) return;
    this.busy = true; this.render();
    try { const acted = await f(); if (acted !== false) await this.afterOp(true); }
    catch (e: any) { this.push("log", `出错了：${e?.message ?? e}`, "error"); }
    finally { this.busy = false; this.render(); }
  }
  async afterAction(action: string) {
    this.sound.effect(this.effectUrl(`action:${action}`));
    this.flushLog();
    await this.runAi(entriesFor(this.game, `action:${action}`), "");
  }
  async afterOp(endTurn: boolean) {
    const runHooks = async () => {
      for (const hk of this.game.drainHooks()) { this.sound.effect(this.effectUrl(hk)); await this.runAi(entriesFor(this.game, hk), ""); }
    };
    await runHooks();
    if (endTurn && !this.game.ending) { this.game.endTurn(); this.sound.effect(this.effectUrl("turn_end")); this.flushLog(); await runHooks(); }
    this.flushLog();
    if (this.game.ending) {
      const end = this.story.endings.list.find((e) => e.id === this.game.ending);
      this.sound.effect(this.effectUrl(`ending:${this.game.ending}`) ?? this.effectUrl("game_end"));
      await this.runAi(entriesFor(this.game, "game_end"), "");
      this.push("log", `结局：${end?.label ?? this.game.ending}${end?.text ? `\n${end.text}` : ""}`, "ending");
    }
    await this.autosave();
    this.render();
  }
  doAction(id: string, params: any = {}) {
    return this.op(async () => {
      const r = this.game.doAction(id, params, "player");
      if (!r.ok) { this.push("log", r.error ?? "做不到", "reject"); return false; }
      await this.afterAction(id);
    });
  }
  sendText(cid: string, text: string) {
    const c = this.ui.components[cid];
    if (!text.trim()) return;
    return this.op(async () => {
      if (c.type === "text-input" && c.writes) { const r = this.game.uiWrite(cid, text); if (!r.ok) this.push("log", r.error!, "reject"); return r.ok; }
      this.push(c.type === "chat-box" ? `component:${cid}` : "log", text, "player", "你");
      const r = this.game.playerInput(cid, text, { aiAvailable: !!this.llm });
      if (r.kind === "rejected") { this.push(c.type === "chat-box" ? `component:${cid}` : "log", r.text, "reject", c.title); return false; }
      if (r.kind === "action") { await this.afterAction(r.action!); return; }
      await this.runAi(entriesFor(this.game, c.type === "chat-box" ? `ui:${cid}.send` : "player_input").concat(entriesFor(this.game, `ui:${cid}.submit`)), r.text, r.allowActions);
    });
  }
  click(cid: string) {
    const c = this.ui.components[cid];
    if (c.action) return this.doAction(c.action, c.params ?? {});
    return this.op(async () => { await this.runAi(entriesFor(this.game, `ui:${cid}.click`), ""); });
  }

  // ---------- 存档 ----------
  snapshot() { this.game.extra.ui_feed = this.feed.slice(-300).map(({ streaming, ...f }) => f); return this.game.save(); }
  async autosave() { try { await bridge.saveWrite(this.storyId, "auto", JSON.stringify(this.snapshot())); } catch { /* 自动存档失败不打断游戏 */ } }
  async saveTo(slot: string) { await bridge.saveWrite(this.storyId, slot, JSON.stringify(this.snapshot())); toast(`已存到「${slotName(slot)}」`); }
  async loadFrom(json: string) {
    let data: any; try { data = JSON.parse(json); } catch { toast("这不是有效的存档文件", "err"); return; }
    try {
      const r = Game.load(this.story, data, { files: this.files, scripts: this.scripts });
      this.game = r.game; this.feed = (r.game.extra.ui_feed ?? []) as Feed[]; this.seq = this.feed.length + 1; this.shown = r.game.log.length; this.aiChoices = {};
      r.warnings.forEach((w) => toast(w, "err")); toast("已读档"); this.render();
    } catch (e: any) { toast(e.message, "err"); }
  }
  async savesDialog() {
    const list = await bridge.saveList(this.storyId).catch(() => []);
    const has = (s: string) => list.find((x) => x.slot === s);
    const close = () => m.remove();
    const row = (slot: string) => {
      const info = has(slot);
      return h("div", { class: "save-row" },
        h("b", {}, slotName(slot)), h("span", { class: "muted" }, info?.modified_ms ? new Date(info.modified_ms).toLocaleString("zh-CN") : "空"),
        slot !== "auto" ? h("button", { onclick: async () => { await this.saveTo(slot); close(); } }, "存到这里") : null,
        info ? h("button", { onclick: async () => { await this.loadFrom(await bridge.saveRead(this.storyId, slot)); close(); } }, "读取") : null);
    };
    const m = h("div", { class: "modal", onclick: (e: Event) => e.target === m && close() },
      h("div", { class: "card" }, h("h3", {}, "存档"), ...["auto", "1", "2", "3"].map(row),
        h("div", { class: "row" },
          h("button", { onclick: async () => { if (await bridge.exportText(`${this.storyId}-存档.json`, JSON.stringify(this.snapshot(), null, 1))) toast("已导出"); } }, "导出存档文件"),
          h("button", { onclick: async () => { const t = await bridge.importText(); if (t) { await this.loadFrom(t); close(); } } }, "导入存档文件"),
          h("button", { onclick: close }, "关闭")),
        h("p", { class: "muted small" }, "存档里不含 API Key。存档带校验码，手动改过的存档会被拒绝读取。")));
    this.root.append(m);
  }

  // ---------- 渲染 ----------
  themeVars(): Record<string, string> {
    const t = this.story.ui?.theme ?? {} as any, pick = this.settings.theme === "story" ? (t.base ?? "light") : this.settings.theme;
    const v = { ...THEMES[pick] ?? THEMES.light, ...(this.settings.theme === "story" ? t.colors ?? {} : {}) };
    return { "--bg": v.bg, "--panel": v.panel, "--text": v.text, "--accent": v.accent, "--fs": `${this.settings.fontSize ?? t.font?.size ?? 16}px` };
  }
  background(): string | undefined {
    const bg = this.story.ui?.theme?.background as any;
    if (!bg) return;
    if (typeof bg === "string") return this.assets.url(bg);
    return this.assets.url(bg.images?.[String(this.game.state[bg.bind])] ?? bg.default);
  }
  updateMusic() {
    const m = this.ui.sound?.music; if (!m) return;
    const ref = m.src ?? m.tracks?.[String(this.game.state[m.bind])];
    this.sound.setMusic(this.assets.url(ref), m.volume ?? this.assets.meta(ref)?.volume ?? 1);
  }

  render() {
    const scroll: Record<string, number> = {};
    this.root.querySelectorAll<HTMLElement>("[data-scroll]").forEach((e) => (scroll[e.dataset.scroll!] = e.scrollHeight - e.scrollTop - e.clientHeight));
    const focusId = (document.activeElement as HTMLElement)?.dataset?.cid;
    const draft: Record<string, string> = {};
    this.root.querySelectorAll<HTMLInputElement>("input[data-cid]").forEach((i) => (draft[i.dataset.cid!] = i.value));

    const lay = this.ui.layout ?? { template: "simple" };
    const tpl = lay.template === "custom" ? { areas: lay.grid ?? ["main"], cols: (lay.columns ?? []).join(" ") || "1fr", rows: (lay.rows ?? []).join(" ") || "auto" } : TEMPLATES[lay.template ?? "simple"] ?? TEMPLATES.simple;
    const regions = [...new Set(tpl.areas.join(" ").split(/\s+/).filter((x: any) => x && x !== "."))];
    const hidden = this.settings.hidden[this.storyId] ?? [];
    const grid = h("div", { class: "grid", style: { gridTemplateAreas: tpl.areas.map((a: any) => `"${a}"`).join(" "), gridTemplateColumns: tpl.cols, gridTemplateRows: tpl.rows } });
    for (const r of regions) {
      const cell = h("div", { class: `region region-${r}`, style: { gridArea: r } });
      for (const [cid, c] of Object.entries<any>(this.ui.components)) {
        if (c.region !== r) continue;
        if (c.player_can_hide !== false && hidden.includes(cid)) continue;
        const el = this.component(cid, c); if (el) cell.append(el);
      }
      if (cell.childNodes.length) grid.append(cell);
    }
    const bg = this.background();
    const end = this.game.ending ? this.story.endings.list.find((e) => e.id === this.game.ending) : undefined;
    const bar = h("div", { class: "topbar" },
      h("button", { onclick: () => { this.rt?.stop(); this.sound.stop(); this.assets.dispose(); this.offUsage?.(); this.onExit(); } }, "← 故事库"),
      h("b", { class: "title" }, this.story.meta.title),
      h("span", { class: "muted" }, `第 ${this.game.turn} 回合`),
      this.busy ? h("span", { class: "busy" }, "AI 思考中…") : null,
      this.usageEl(),
      h("span", { class: "spacer" }),
      h("button", { onclick: () => this.savesDialog() }, "存档"),
      h("button", { onclick: () => { this.settings.muted = !this.settings.muted; saveSettings(this.settings); this.sound.music.muted = this.settings.muted; this.render(); } }, this.settings.muted ? "🔇 已静音" : "🔊 声音"),
      h("button", { onclick: () => this.viewDialog() }, "外观"),
      h("button", { onclick: () => { this.debug = !this.debug; this.render(); } }, this.debug ? "关闭调试" : "调试"));
    const page = h("div", { class: "stage", style: bg ? { backgroundImage: `url("${bg}")` } : {} },
      this.aiNotice ? h("div", { class: "notice" }, this.aiNotice) : null,
      grid,
      this.rt?.controlsEl() ?? null,
      end ? h("div", { class: `ending ${end.kind ?? ""}` }, h("h2", {}, `🏁 ${end.label}`), end.text ? h("p", {}, end.text) : null,
        h("div", { class: "row" }, h("button", { onclick: () => this.restart() }, "再玩一次"), h("button", { onclick: () => { this.rt?.stop(); this.sound.stop(); this.offUsage?.(); this.onExit(); } }, "回故事库"))) : null);
    const body = h("div", { class: "play-body" }, page, this.debug ? this.debugPanel() : null);
    this.root.replaceChildren(bar, body);
    for (const [k, v] of Object.entries(this.themeVars())) this.root.style.setProperty(k, v);
    this.updateMusic();

    this.root.querySelectorAll<HTMLElement>("[data-scroll]").forEach((e) => { const d = scroll[e.dataset.scroll!]; if (d === undefined || d < 40) e.scrollTop = e.scrollHeight; });
    this.root.querySelectorAll<HTMLInputElement>("input[data-cid]").forEach((i) => { if (draft[i.dataset.cid!] && !this.lastSent.has(i.dataset.cid!)) i.value = draft[i.dataset.cid!]; });
    this.lastSent.clear();
    if (focusId) this.root.querySelector<HTMLElement>(`input[data-cid="${focusId}"]`)?.focus();
  }
  lastSent = new Set<string>();
  async restart() { this.rt?.stop(); this.sound.stop(); this.feed = []; this.shown = 0; this.aiChoices = {}; await this.init(); }

  feedFor(cid: string, c: any): Feed[] {
    const firstLog = Object.entries<any>(this.ui.components).find(([, x]) => x.type === "text-log")?.[0];
    return this.feed.filter((f) => f.to === `component:${cid}` || (c.type === "text-log" && (f.to === `region:${c.region}` || (f.to === "log" && cid === firstLog))));
  }

  component(cid: string, c: any): HTMLElement | null {
    const vis = this.game.visibleState("player");
    const label = (k: string) => (this.story.state[k] as any)?.label ?? k;
    const box = (...kids: any[]) => h("div", { class: `comp comp-${c.type}`, "data-comp": cid }, c.label && !["button", "text-input"].includes(c.type) ? h("div", { class: "comp-label" }, c.label) : null, ...kids);
    const disabled = this.busy || !!this.game.ending;
    const inputRow = (ph: string) => {
      const i = h("input", { "data-cid": cid, placeholder: ph, maxlength: c.input?.max_length ?? 500, disabled }) as HTMLInputElement;
      const send = () => { const v = i.value; i.value = ""; this.lastSent.add(cid); this.sendText(cid, v); };
      i.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) send(); };
      return h("div", { class: "input-row" }, i, h("button", { class: "primary", onclick: send, disabled }, "发送"));
    };
    const feedEl = (f: Feed) => h("div", { class: `feed feed-${f.kind}`, id: `feed-${f.id}` }, f.who && f.kind !== "rule" ? h("b", {}, `${f.who}：`) : null, f.text);
    switch (c.type) {
      case "text-log": return box(h("div", { class: "log", "data-scroll": cid }, ...this.feedFor(cid, c).map(feedEl)));
      case "text-input": return box(inputRow(c.placeholder ?? "你要做什么？"));
      case "chat-box": {
        const p = this.assets.url(c.portrait);
        return box(h("div", { class: "chat-head" }, p ? h("img", { src: p, class: "portrait", alt: c.title ?? "" }) : null, h("b", {}, c.title ?? "")),
          h("div", { class: "log chat", "data-scroll": cid }, ...this.feedFor(cid, c).map(feedEl)), inputRow("说点什么…"));
      }
      case "button": return h("button", { class: "comp comp-button", disabled, onclick: () => this.click(cid) }, c.label ?? cid);
      case "choice-buttons": {
        const list = c.from_ai ? (this.aiChoices[cid] ?? []).map((t) => ({ label: t, run: () => { const ti = Object.entries<any>(this.ui.components).find(([, x]) => x.type === "text-input" && x.input)?.[0]; if (ti) this.sendText(ti, t); } }))
          : (c.choices ?? []).map((ch: any) => ({ label: ch.label, run: () => this.doAction(ch.action, ch.params ?? {}) }));
        if (!list.length) return null;
        return box(h("div", { class: "choices" }, ...list.map((x: any) => h("button", { disabled, onclick: x.run }, x.label))));
      }
      case "stat-list": return box(h("dl", { class: "stats" }, ...[].concat(c.bind ?? []).filter((k: string) => k in vis).flatMap((k: string) => [h("dt", {}, label(k)), h("dd", {}, fmtVal(vis[k]))])));
      case "stat-bar": {
        const k = Array.isArray(c.bind) ? c.bind[0] : c.bind, d: any = this.story.state[k]; if (!(k in vis)) return null;
        const pct = Math.max(0, Math.min(100, ((vis[k] - d.min) / (d.max - d.min)) * 100));
        return box(h("div", { class: "bar-label" }, `${label(k)} ${vis[k]} / ${d.max}`), h("div", { class: "bar" }, h("div", { style: { width: `${pct}%` } })));
      }
      case "item-list": {
        const k = Array.isArray(c.bind) ? c.bind[0] : c.bind, v = vis[k];
        const items = Array.isArray(v) ? v.map(String) : v && typeof v === "object" ? Object.entries(v).map(([a, b]) => `${a} × ${b}`) : [];
        return box(h("div", { class: "comp-label" }, c.label ?? label(k)), items.length ? h("ul", {}, ...items.map((t) => h("li", {}, t))) : h("p", { class: "muted" }, "（空）"));
      }
      case "text-block": {
        const k = Array.isArray(c.bind) ? c.bind[0] : c.bind;
        return box(h("div", { class: "text-block" }, k ? fmtVal(vis[k]) : c.text ?? ""));
      }
      case "image": {
        let ref: any = c.src;
        if (c.bind) ref = c.images?.[String(this.game.state[c.bind])] ?? c.src;
        if (c.generated) ref = (this.story.ai as any)?.images?.[c.generated]?.fallback; // AI 生图为第二步，先显示作者的替代图
        const u = this.assets.url(ref);
        if (!u) return null;
        return box(h("img", { src: u, alt: this.assets.meta(ref)?.alt ?? c.label ?? "", style: { objectFit: c.fit ?? "cover" } }));
      }
      case "dice-log": return box(h("div", { class: "log small", "data-scroll": cid }, ...this.game.log.filter((l) => l.kind === "dice" || l.kind === "random").slice(-20).map((l) => h("div", {}, l.text))));
      case "canvas": return this.rt ? box(this.rt.canvas(cid, c)) : box(h("p", { class: "muted" }, "（画布需要 realtime 循环）"));
      default: return null;
    }
  }

  viewDialog() {
    const s = this.settings, close = () => { saveSettings(s); m.remove(); this.render(); };
    const hidable = Object.entries<any>(this.ui.components).filter(([, c]) => c.player_can_hide !== false && !["text-log"].includes(c.type));
    const optional = Object.entries<any>(this.story.ai?.entry_points ?? {}).filter(([, e]) => e.optional);
    const hid = (s.hidden[this.storyId] ??= []), off = (s.disabledEntries[this.storyId] ??= []);
    const tog = (arr: string[], id: string) => { const i = arr.indexOf(id); i >= 0 ? arr.splice(i, 1) : arr.push(id); };
    const m = h("div", { class: "modal", onclick: (e: Event) => e.target === m && close() }, h("div", { class: "card" },
      h("h3", {}, "外观（只影响你自己，不会改变故事规则）"),
      h("label", {}, "主题 ", h("select", { onchange: (e: any) => (s.theme = e.target.value) }, ...[["story", "跟随故事"], ["light", "浅色"], ["dark", "深色"], ["sepia", "复古纸张"]].map(([v, t]) => h("option", { value: v, selected: s.theme === v }, t)))),
      h("label", {}, "字号 ", h("input", { type: "range", min: 12, max: 24, value: s.fontSize, oninput: (e: any) => (s.fontSize = Number(e.target.value)) })),
      h("label", {}, "音乐音量 ", h("input", { type: "range", min: 0, max: 1, step: 0.05, value: s.music, oninput: (e: any) => (s.music = Number(e.target.value)) })),
      h("label", {}, "音效音量 ", h("input", { type: "range", min: 0, max: 1, step: 0.05, value: s.sfx, oninput: (e: any) => (s.sfx = Number(e.target.value)) })),
      hidable.length ? h("div", {}, h("p", { class: "muted" }, "隐藏组件"), ...hidable.map(([id, c]) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: hid.includes(id), onchange: () => tog(hid, id) }), c.label ?? c.title ?? id))) : null,
      optional.length ? h("div", {}, h("p", { class: "muted" }, "关闭可选的 AI 功能（关闭后显示作者写的替代文字）"), ...optional.map(([id, e]) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: off.includes(id), onchange: () => tog(off, id) }), e.card.task ?? id))) : null,
      h("div", { class: "row" }, h("button", { class: "primary", onclick: close }, "完成"))));
    this.root.append(m);
  }

  debugPanel() {
    return h("aside", { class: "debug" },
      h("h4", {}, "调试面板（试玩用）"),
      h("p", { class: "small muted" }, `随机种子 ${this.game.seed} · 回合 ${this.game.turn}${this.llm ? ` · 模型 ${this.settings.model}` : " · 未接 AI"}`),
      h("h5", {}, "全部状态（含隐藏）"), h("pre", {}, JSON.stringify(this.game.state, null, 1)),
      h("h5", {}, "最近一次 AI 工具调用"), h("pre", {}, this.lastTools.length ? this.lastTools.map((t) => `${t.tool}(${JSON.stringify(t.args)}) → ${t.result.ok ? "成功" : t.result.error}`).join("\n") : "（无）"),
      h("h5", {}, `越权记录（${this.game.violations.length}）`), h("pre", {}, this.game.violations.slice(-10).map((v) => `第${v.turn}回合 ${v.entry}/${v.tool}：${v.reason}`).join("\n") || "（无）"),
      h("h5", {}, "规则日志"), h("pre", {}, this.game.log.slice(-15).map((l) => `[${l.turn}] ${l.kind}: ${l.text}`).join("\n")));
  }
}
const slotName = (s: string) => (s === "auto" ? "自动存档" : `存档 ${s}`);
