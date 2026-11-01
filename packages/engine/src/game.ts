import { parseExpr, evaluate, builtinFuncs, deepEq, DEFAULT_MAX_AUTHORITY, type Node, type Story, type StateDef, type StoryFiles, textFile, normalizeStory, type InputState, type EntryPointDef, type WriteLimit, localizeStory, type Lang } from "@my-oasis/schema";
import { Rng, rollDice } from "./rng.js";
import { FAIL_MARK, ScriptError, type ScriptRunner } from "./script.js";

export type Caller = "player" | "ai" | "rules";
export interface LogEntry { turn: number; kind: "rule" | "random" | "dice" | "event" | "ending" | "error" | "violation" | "action" | "rejected"; text: string; data?: any }
export interface ActionResult { ok: boolean; result?: any; error?: string; changes: Change[]; ending?: string | null }
export interface Change { key: string; before: any; after: any }
export interface Violation { turn: number; entry: string; tool: string; reason: string; args: any }
export interface ToolResult { ok: boolean; result?: any; error?: string; violation?: boolean; changes?: Change[] }
export interface SaveData {
  format: "oasis-save/1"; story: { id: string; version: string; hash: string };
  state: Record<string, any>; rng: number; seed: number; turn: number; fired: string[]; ending: string | null;
  cooldowns: Record<string, number>; log: LogEntry[]; violations: Violation[]; extra: Record<string, any>; savedAt: string;
  /** 防篡改校验：改过存档内容就对不上 */
  check?: string;
}
/** 玩家自由输入的处理结果 */
export interface InputResult { kind: "action" | "to_ai" | "rejected"; text: string; action?: string; result?: ActionResult; allowActions: string[] }

function fnv(s: string, seed = 0x811c9dc5) { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
const SAVE_SALT = "my-oasis/save-check/1";
/** 存档校验码（两轮 FNV，64 位）；只用于发现改动，不是加密 */
export function saveCheck(d: Omit<SaveData, "check">): string {
  const s = SAVE_SALT + JSON.stringify({ ...d, check: undefined });
  return fnv(s).toString(16).padStart(8, "0") + fnv(s, 0x9e3779b9).toString(16).padStart(8, "0");
}
export interface ScreenInfo { width: number; height: number; dpr: number; takeover: boolean }
/** 跨存档的小型本地数据（最高分、解锁、设置），客户端按故事分开保存 */
export interface StoryStorage { get(key: string): any; set(key: string, value: any): void }
/** 把 api.overlay 的界面描述清洗成安全的纯数据：限制层数、节点数、字符串长度；只留白名单字段 */
export function sanitizeOverlay(spec: any): any {
  let n = 0;
  const str = (v: any, max = 2000) => (typeof v === "string" ? v.slice(0, max) : v && typeof v === "object" && !Array.isArray(v) ? { zh: String(v.zh ?? "").slice(0, max), en: String(v.en ?? "").slice(0, max) } : v == null ? undefined : String(v).slice(0, max));
  const numOrPct = (v: any) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?%$/.test(v) ? v : undefined);
  const color = (v: any) => (typeof v === "string" && /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\)|[a-z]{3,20})$/.test(v) ? v : undefined);
  const style = (o: any) => {
    if (!o || typeof o !== "object") return undefined;
    const r: any = {};
    for (const k of ["size", "radius", "padding", "gap", "width", "height", "opacity", "border"]) { const v = numOrPct(o[k]); if (v !== undefined) r[k] = v; }
    for (const k of ["color", "bg", "border_color"]) { const c = color(o[k]); if (c) r[k] = c; }
    if (typeof o.font === "string") r.font = o.font.slice(0, 60).replace(/[^\w\s-]/g, "");
    for (const k of ["bold", "italic", "scroll"]) if (typeof o[k] === "boolean") r[k] = o[k];
    if (["left", "center", "right"].includes(o.align)) r.align = o.align;
    return r;
  };
  const node = (x: any, depth: number): any => {
    if (!x || typeof x !== "object" || depth > 8 || ++n > 300) return null;
    const t = ["text", "rich", "button", "list", "image", "row", "column", "space"].includes(x.type) ? x.type : "text";
    const o: any = { type: t, style: style(x.style ?? x) };
    if (x.id != null) o.id = String(x.id).slice(0, 40);
    if (t === "text" || t === "button") o.text = str(x.text ?? x.label);
    if (t === "button" && typeof x.disabled === "boolean") o.disabled = x.disabled;
    if (t === "rich") o.spans = (Array.isArray(x.spans) ? x.spans : []).slice(0, 100).map((sp: any) => ({ text: str(sp?.text), style: style(sp) }));
    if (t === "list") o.items = (Array.isArray(x.items) ? x.items : []).slice(0, 200).map((it: any) => ({ id: String(it?.id ?? "").slice(0, 40), text: str(it?.text ?? it?.label), sub: str(it?.sub), disabled: !!it?.disabled }));
    if (t === "image") { o.asset = String(x.asset ?? "").slice(0, 40); }
    if (t === "row" || t === "column") o.children = (Array.isArray(x.children) ? x.children : []).map((c: any) => node(c, depth + 1)).filter(Boolean);
    return o;
  };
  const s = spec && typeof spec === "object" ? spec : {};
  const anchors = ["center", "top", "bottom", "left", "right", "top_left", "top_right", "bottom_left", "bottom_right"];
  return {
    x: numOrPct(s.x), y: numOrPct(s.y), w: numOrPct(s.w), h: numOrPct(s.h),
    anchor: anchors.includes(s.anchor) ? s.anchor : "center",
    modal: !!s.modal, z: Math.max(0, Math.min(100, Math.floor(Number(s.z) || 0))),
    style: style(s.style),
    children: (Array.isArray(s.children) ? s.children : []).map((c: any) => node(c, 1)).filter(Boolean),
  };
}
export interface GameOptions { /** 玩家选的语言（zh/en），默认 zh */ lang?: Lang; seed?: number; storage?: StoryStorage; scripts?: ScriptRunner; files?: StoryFiles }

class StepFail extends Error {}
const LIMITS = { callDepth: 8, eventChain: 16, eventRepeat: 10 };

export function storyHash(story: Story): string {
  const s = JSON.stringify(story); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

interface Ctx { params: Record<string, any>; locals: Record<string, any>; out?: any; event?: any; depth: number; caller: Caller; changed: Set<string>; render?: boolean }
/** 实时模式产生的副作用：声音、异步 AI 请求（客户端取走后执行，不阻塞循环） */
export interface SoundEffect { op: "play" | "stop"; id: string | null; volume?: number; loop?: boolean; channel?: string; fade_ms?: number; rate?: number; pan?: number }
/** 客户端原生界面请求：文字输入框（支持中文输入法/安卓软键盘）、全屏视频 */
export type UiEffect =
  | { op: "text.open"; req: number; id: string; title?: any; placeholder?: any; value?: string; multiline?: boolean; max_length: number; ok?: any; cancel?: any }
  | { op: "text.close" }
  | { op: "video.play"; req: number; id: string; loop?: boolean; muted?: boolean; skippable?: boolean; fit?: "contain" | "cover" }
  | { op: "video.stop" }
  | { op: "overlay.show"; id: string; spec: any }
  | { op: "overlay.hide"; id: string | null }
  | { op: "shake"; amount: number; ms: number }
  | { op: "fade"; color: string; out_ms: number; in_ms: number; hold_ms: number }
  | { op: "vibrate"; pattern: number[] }
  | { op: "copy"; text: string }
  | { op: "save"; label: string }
  | { op: "filter"; css: string };
export interface Effects { sounds: SoundEffect[]; ai: { req: number; entry: string; input: string; data: any }[]; ui: UiEffect[] }
export type DrawCmd = any[];

export class Game {
  state: Record<string, any> = {};
  rng: Rng; seed: number;
  turn = 1;
  fired = new Set<string>();
  ending: string | null = null;
  cooldowns: Record<string, number> = {};
  log: LogEntry[] = [];
  violations: Violation[] = [];
  extra: Record<string, any> = {};
  private exprCache = new Map<string, Node>();
  private pending: { hook: string; data?: any }[] = [];
  private started = false;
  /** 本次操作中发生过的事件（供 AI 接入点 trigger: event:xxx 使用） */
  firedHooks: string[] = [];
  drainHooks() { const h = [...new Set(this.firedHooks)]; this.firedHooks = []; return h; }

  /** 作者原始的（可能是双语的）故事；存档校验用它 */
  readonly source: Story;
  readonly lang: Lang;
  constructor(public story: Story, public opts: GameOptions = {}) {
    this.source = story; this.lang = opts.lang === "en" ? "en" : "zh";
    this.story = story = normalizeStory(localizeStory(story, this.lang));
    const seed = opts.seed ?? (typeof story.random?.seed === "number" ? story.random.seed : undefined);
    this.rng = Rng.seed(seed); this.seed = this.rng.s;
    for (const [k, d] of Object.entries(story.state)) this.state[k] = clone(d.init);
  }

  // ---------- 表达式 ----------
  private ast(src: string) { let a = this.exprCache.get(src); if (!a) { a = parseExpr(src); this.exprCache.set(src, a); } return a; }
  eval(src: unknown, ctx?: Partial<Ctx>, allowRandom = false): any {
    if (typeof src !== "string") return src;
    const funcs: Record<string, any> = { ...builtinFuncs };
    void allowRandom; // 作者可以在任何表达式里用随机数（结果按种子可复现、记入日志）
    {
      const rec = (fn: string, args: any[], r: any) => { this.log.push({ turn: this.turn, kind: "random", text: `${fn}(${args.map((a) => JSON.stringify(a)).join(", ")}) = ${JSON.stringify(r)}` }); return r; };
      funcs.rand = () => rec("rand", [], this.rng.next());
      funcs.randint = (a: number, b: number) => rec("randint", [a, b], this.rng.int(a, b));
      funcs.pick = (l: any[]) => rec("pick", [l], this.rng.pick(l));
      funcs.weighted = (m: any) => rec("weighted", [m], this.rng.weighted(m));
      {
        const dice = (expr: string, mode?: "adv" | "dis") => {
          const a = rollDice(this.rng, expr);
          let total = a.total, text = `🎲 ${expr} → [${a.rolls.join(", ")}] = ${a.total}`;
          if (mode) { const b = rollDice(this.rng, expr); total = mode === "adv" ? Math.max(a.total, b.total) : Math.min(a.total, b.total); text = `🎲 ${expr}（${mode === "adv" ? "优势" : "劣势"}）→ ${a.total} / ${b.total}，取 ${total}`; }
          this.log.push({ turn: this.turn, kind: "dice", text, data: { expr, total } });
          return total;
        };
        funcs.roll = (e: string) => dice(e); funcs.roll_adv = (e: string) => dice(e, "adv"); funcs.roll_dis = (e: string) => dice(e, "dis");
      }
    }
    const vars: Record<string, any> = { state: this.state, turn: this.turn, ...(ctx?.locals ?? {}) };
    if (ctx?.params) vars.params = ctx.params;
    if (ctx?.out !== undefined) vars.out = ctx.out;
    if (ctx?.event !== undefined) vars.event = ctx.event;
    return evaluate(this.ast(src), { vars, funcs });
  }

  // ---------- 状态写入（强制类型与约束） ----------
  coerce(key: string, value: any): any {
    const [sid, field] = key.split(".");
    const d: StateDef | undefined = this.story.state[sid];
    if (!d) throw new StepFail(`状态「${sid}」不存在`);
    if (field) {
      const ft = d.fields?.[field]; if (!ft) throw new StepFail(`状态「${sid}」没有字段「${field}」`);
      return this.coerceBasic(key, ft, value);
    }
    switch (d.type) {
      case "number": {
        if (typeof value !== "number" || Number.isNaN(value)) throw new StepFail(`「${key}」只能是数字，收到 ${JSON.stringify(value)}`);
        let v = value; if (d.integer) v = Math.round(v);
        if (d.min !== undefined) v = Math.max(d.min, v); if (d.max !== undefined) v = Math.min(d.max, v);
        return v;
      }
      case "bool": if (typeof value !== "boolean") throw new StepFail(`「${key}」只能是 true/false`); return value;
      case "string": { if (typeof value !== "string") value = String(value); return value.slice(0, d.max_length ?? 2000); }
      case "enum": if (!d.values!.includes(value)) throw new StepFail(`「${key}」只能是 ${d.values!.join("/")}，收到「${value}」`); return value;
      case "list": case "set": {
        if (!Array.isArray(value)) throw new StepFail(`「${key}」应该是列表`);
        let v = value.map((x) => this.coerceBasic(key, d.of!, x));
        if (d.type === "set") v = v.filter((x, i) => v.findIndex((y) => deepEq(x, y)) === i);
        if (d.max_items !== undefined && v.length > d.max_items) throw new StepFail(`「${key}」最多 ${d.max_items} 项`);
        return v;
      }
      case "map": {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new StepFail(`「${key}」应该是 map`);
        return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, this.coerceBasic(key, d.of!, x)]));
      }
      case "json": {
        const t = JSON.stringify(value ?? null);
        if (t.length > 1_000_000) throw new StepFail(`「${key}」太大（超过 1 MB）`);
        return JSON.parse(t);
      }
      case "record": {
        if (!value || typeof value !== "object") throw new StepFail(`「${key}」应该是 record`);
        const o: any = {}; for (const [f, t] of Object.entries(d.fields!)) o[f] = f in value ? this.coerceBasic(`${key}.${f}`, t, value[f]) : this.state[sid]?.[f];
        return o;
      }
    }
  }
  private coerceBasic(key: string, t: string, v: any) {
    const jt = t === "bool" ? "boolean" : t;
    if (typeof v !== jt) throw new StepFail(`「${key}」的元素应是 ${t}，收到 ${JSON.stringify(v)}`);
    return v;
  }
  private write(key: string, value: any, ctx: Ctx) {
    const [sid, field] = key.split(".");
    const v = this.coerce(key, value);
    const before = field ? this.state[sid][field] : this.state[sid];
    if (deepEq(before, v)) return;
    if (field) this.state[sid] = { ...this.state[sid], [field]: v }; else this.state[sid] = v;
    ctx.changed.add(sid);
  }
  private read(key: string) { const [sid, f] = key.split("."); return f ? this.state[sid]?.[f] : this.state[sid]; }

  // ---------- 事务 ----------
  private snap() { return { state: clone(this.state), rng: this.rng.s, fired: [...this.fired], ending: this.ending, cooldowns: { ...this.cooldowns }, log: this.log.length, pending: this.pending.length }; }
  private restore(s: ReturnType<Game["snap"]>) { this.state = s.state; this.rng.s = s.rng; this.fired = new Set(s.fired); this.ending = s.ending; this.cooldowns = s.cooldowns; this.log.length = s.log; this.pending.length = s.pending; }
  private diff(before: Record<string, any>): Change[] {
    return Object.keys(this.state).filter((k) => !deepEq(before[k], this.state[k])).map((k) => ({ key: k, before: before[k], after: clone(this.state[k]) }));
  }

  // ---------- 步骤 ----------
  private runSteps(steps: any[] | undefined, ctx: Ctx) {
    for (const st of steps ?? []) {
      if (this.ending && ctx.caller !== "rules") return;
      const op = Object.keys(st).find((k) => ["set", "inc", "add", "remove", "put", "let", "if", "call", "emit", "end", "fail", "log"].includes(k))!;
      const body = st[op];
      const ev = (x: any) => this.eval(x, ctx, true);
      switch (op) {
        case "set": for (const [k, x] of Object.entries(body)) this.write(k, ev(x), ctx); break;
        case "inc": for (const [k, x] of Object.entries(body)) { const n = ev(x); if (typeof n !== "number") throw new StepFail(`inc「${k}」的值不是数字`); this.write(k, (this.read(k) ?? 0) + n, ctx); } break;
        case "add": for (const [k, x] of Object.entries(body)) this.write(k, [...(this.read(k) ?? []), ev(x)], ctx); break;
        case "remove": for (const [k, x] of Object.entries(body)) { const v = ev(x); this.write(k, (this.read(k) ?? []).filter((y: any) => !deepEq(y, v)), ctx); } break;
        case "put": for (const [k, x] of Object.entries<any>(body)) this.write(k, { ...(this.read(k) ?? {}), [String(ev(x.key))]: ev(x.value) }, ctx); break;
        case "let": for (const [k, x] of Object.entries(body)) ctx.locals[k] = ev(x); break;
        case "if": this.runSteps(ev(body) ? st.then : st.else, ctx); break;
        case "call": {
          const params = Object.fromEntries(Object.entries(st.params ?? {}).map(([k, x]) => [k, ev(x)]));
          if (ctx.depth >= LIMITS.callDepth) throw new StepFail("动作互相调用太深（超过 8 层）");
          const r = this.execAction(body, params, "rules", ctx.depth + 1, ctx.changed);
          if (!r.ok) throw new StepFail(r.error ?? `调用「${body}」失败`);
          break;
        }
        case "emit": this.pending.push({ hook: body, data: Object.fromEntries(Object.entries(st.data ?? {}).map(([k, x]) => [k, ev(x)])) }); break;
        case "end": this.setEnding(body); break;
        case "fail": throw new StepFail(String(body));
        case "log": this.log.push({ turn: this.turn, kind: "rule", text: String(ev(body)) }); break;
      }
    }
  }

  private setEnding(id: string) {
    if (this.ending) return;
    const e = this.story.endings.list.find((x) => x.id === id);
    if (!e) throw new StepFail(`结局「${id}」不存在`);
    this.ending = id;
    this.log.push({ turn: this.turn, kind: "ending", text: `【结局】${e.label}`, data: { id } });
  }

  checkEndings(when: "state_change" | "turn_end" | "manual" = "state_change") {
    if (this.ending) return this.ending;
    const mode = this.story.endings.check_on ?? "state_change";
    if (mode === "manual" || (mode === "turn_end" && when !== "turn_end")) return null;
    if (this.story.endings.script) {
      const id = this.runScript(this.story.endings.script, {}, { params: {}, locals: {}, depth: 0, caller: "rules", changed: new Set() });
      if (typeof id === "string" && id) { this.setEnding(id); return this.ending; }
    }
    for (const e of this.story.endings.list) if (e.when !== undefined && this.eval(e.when)) { this.setEnding(e.id); break; }
    return this.ending;
  }

  // ---------- 事件 ----------
  private dispatch(changed: Set<string>, extra: { hook: string; data?: any }[] = []) {
    for (const k of changed) this.pending.push({ hook: `state:${k}` });
    this.pending.push(...extra);
    let chain = 0; const counts: Record<string, number> = {};
    while (this.pending.length) {
      if (++chain > LIMITS.eventChain * 8) { this.log.push({ turn: this.turn, kind: "error", text: "事件连锁太长，已停止" }); this.pending.length = 0; break; }
      const { hook, data } = this.pending.shift()!;
      if (!hook.includes(":") && !["game_start", "turn_start", "turn_end"].includes(hook)) this.firedHooks.push(`event:${hook}`);
      for (const e of this.story.events ?? []) {
        if (e.hook !== hook) continue;
        if (e.once && this.fired.has(e.id)) continue;
        if ((counts[e.id] = (counts[e.id] ?? 0) + 1) > LIMITS.eventRepeat) { this.log.push({ turn: this.turn, kind: "error", text: `事件「${e.id}」触发次数过多，已跳过` }); continue; }
        const ctx: Ctx = { params: {}, locals: {}, event: data ?? {}, depth: 0, caller: "rules", changed: new Set() };
        const s = this.snap();
        try {
          if (e.when !== undefined && !this.eval(e.when, ctx, true)) { this.restore({ ...s, pending: this.pending.length }); continue; }
          this.runSteps(e.do, ctx);
          if (e.once) this.fired.add(e.id);
          if (e.notify_ai) (this.extra.notices ??= []).push(e.notify_ai);
          this.log.push({ turn: this.turn, kind: "event", text: `事件：${e.id}` });
          this.firedHooks.push(`event:${e.id}`);
          for (const k of ctx.changed) this.pending.push({ hook: `state:${k}` });
        } catch (err: any) {
          this.restore({ ...s, pending: this.pending.length });
          this.log.push({ turn: this.turn, kind: "error", text: `事件「${e.id}」出错，已撤销：${err.message}` });
        }
      }
    }
  }

  // ---------- 动作 ----------
  private execAction(id: string, params: Record<string, any>, caller: Caller, depth: number, outerChanged?: Set<string>): ActionResult & { ctxChanged?: Set<string> } {
    const a = this.story.actions?.[id];
    if (!a) return { ok: false, error: `动作「${id}」不存在`, changes: [] };
    const cb = a.callable_by ?? ["player", "ai", "rules"];
    if (!cb.includes(caller)) return { ok: false, error: `动作「${id}」不允许由${caller === "ai" ? " AI" : caller === "player" ? "玩家" : "规则"}触发`, changes: [] };
    if (this.ending) return { ok: false, error: "故事已经结束", changes: [] };
    // 参数
    const p: Record<string, any> = {};
    for (const [k, d] of Object.entries(a.params ?? {})) {
      let v = params?.[k];
      if (v === undefined) { if (d.required === false) { p[k] = null; continue; } return { ok: false, error: `缺少参数「${k}」`, changes: [] }; }
      if (d.type === "number") { v = typeof v === "string" && v.trim() !== "" ? Number(v) : v; if (typeof v !== "number" || Number.isNaN(v)) return { ok: false, error: `参数「${k}」应是数字`, changes: [] };
        if ((d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) return { ok: false, error: `参数「${k}」应在 ${d.min ?? "-∞"}~${d.max ?? "∞"} 之间`, changes: [] }; }
      if (d.type === "bool") { if (v === "true") v = true; if (v === "false") v = false; if (typeof v !== "boolean") return { ok: false, error: `参数「${k}」应是 true/false`, changes: [] }; }
      if (d.type === "string") v = String(v);
      if (d.type === "enum" && !d.values!.includes(v)) return { ok: false, error: `参数「${k}」只能是 ${d.values!.join("/")}`, changes: [] };
      p[k] = v;
    }
    if (a.cooldown_turns && this.cooldowns[id] !== undefined && this.turn - this.cooldowns[id] < a.cooldown_turns)
      return { ok: false, error: `「${a.label ?? id}」还要等 ${a.cooldown_turns - (this.turn - this.cooldowns[id])} 回合才能再用`, changes: [] };
    const ctx: Ctx = { params: p, locals: {}, depth, caller, changed: outerChanged ?? new Set() };
    const s = this.snap();
    try {
      if (a.require !== undefined && !this.eval(a.require, ctx)) { this.restore(s); return { ok: false, error: a.require_message ?? `现在不能「${a.label ?? id}」`, changes: [] }; }
      let result: any;
      if (a.steps) { this.runSteps(a.steps, ctx); result = a.result !== undefined ? this.eval(a.result, ctx) : true; }
      else result = this.runScript(a.script!, p, ctx);
      if (a.cooldown_turns) this.cooldowns[id] = this.turn;
      if (depth === 0) this.log.push({ turn: this.turn, kind: "action", text: `${a.label ?? id}${Object.keys(p).length ? " " + JSON.stringify(p) : ""}`, data: { id, params: p, result } });
      return { ok: true, result, changes: this.diff(s.state), ctxChanged: ctx.changed };
    } catch (e: any) {
      this.restore(s);
      const msg = e instanceof StepFail || e instanceof ScriptError ? e.message : `规则出错：${e.message}`;
      return { ok: false, error: msg, changes: [] };
    }
  }

  /** 玩家/界面/规则触发动作：动作 + 事件 + 结局判定 */
  doAction(id: string, params: Record<string, any> = {}, caller: Caller = "player"): ActionResult {
    const before = clone(this.state);
    const r = this.execAction(id, params, caller, 0);
    if (!r.ok) return { ok: false, error: r.error, changes: [] };
    this.dispatch(r.ctxChanged ?? new Set(), [{ hook: `action:${id}` }]);
    this.checkEndings();
    return { ok: true, result: r.result, changes: this.diff(before), ending: this.ending };
  }

  // ---------- 回合与开局 ----------
  start() {
    if (this.started) return; this.started = true;
    const ctx: Ctx = { params: {}, locals: {}, depth: 0, caller: "rules", changed: new Set() };
    try { this.runSteps(this.story.start?.do, ctx); } catch (e: any) { this.log.push({ turn: this.turn, kind: "error", text: `开局步骤出错：${e.message}` }); }
    this.dispatch(ctx.changed, [{ hook: "game_start" }, { hook: "turn_start" }]);
    this.checkEndings();
  }
  endTurn() {
    if (this.ending) return;
    this.dispatch(new Set(), [{ hook: "turn_end" }]);
    this.checkEndings("turn_end");
    if (this.ending) return;
    this.turn++;
    this.dispatch(new Set(), [{ hook: "turn_start" }]);
    this.checkEndings();
  }
  takeNotices(): string[] { const n = this.extra.notices ?? []; this.extra.notices = []; return n; }

  // ---------- 脚本 ----------
  private runScript(ref: string, params: Record<string, any>, ctx: Ctx, limits?: { time_ms: number; memory_mb: number }): any {
    const [file, fn] = ref.split("#");
    if (!this.opts.scripts) throw new StepFail("没有可用的脚本运行环境");
    const src = this.opts.files ? textFile(this.opts.files, file) : undefined;
    if (src === undefined) throw new StepFail(`找不到脚本文件「${file}」`);
    const lim = limits ?? { time_ms: this.story.scripts?.limits?.time_ms ?? 50, memory_mb: this.story.scripts?.limits?.memory_mb ?? 16 };
    const host = {
      call: (m: string, a: any[]) => {
        switch (m) {
          case "state.get": return clone(this.read(a[0]));
          case "state.set": this.write(a[0], a[1], ctx); return null;
          case "state.inc": this.write(a[0], (this.read(a[0]) ?? 0) + Number(a[1]), ctx); return null;
          case "state.add": this.write(a[0], [...(this.read(a[0]) ?? []), a[1]], ctx); return null;
          case "state.remove": this.write(a[0], (this.read(a[0]) ?? []).filter((y: any) => !deepEq(y, a[1])), ctx); return null;
          case "params": return params;
          case "random.int": return this.eval("randint(a, b)", { locals: { a: a[0], b: a[1] } }, true);
          case "random.float": return this.eval("rand()", {}, true);
          case "random.pick": return this.eval("pick(l)", { locals: { l: a[0] } }, true);
          case "random.weighted": return this.eval("weighted(m)", { locals: { m: a[0] } }, true);
          case "actions.call": { const r = this.execAction(a[0], a[1], "rules", ctx.depth + 1, ctx.changed); if (!r.ok) throw new Error(r.error); return r.result ?? null; }
          case "events.emit": this.pending.push({ hook: a[0], data: a[1] }); return null;
          case "end": this.setEnding(a[0]); return null;
          case "fail": throw new Error(FAIL_MARK + a[0]);
          case "log": this.log.push({ turn: this.turn, kind: "rule", text: String(a[0]) }); return null;
          case "input": return clone(this.input);
          case "time": return [this.rtDt, this.rtTime, this.rtAlpha];
          case "lang": return this.lang;
          case "screen": return { ...this.screen };
          case "draw.commit": if (!ctx.render) throw new Error("api.draw 只能在画布的 render 函数里用"); this.drawBuf = a[0]; return null;
          case "sound.play": case "sound.stop": {
            if (ctx.render) throw new Error("render 函数里不能播放声音");
            const id = a[0]; if (id !== null && !this.story.assets?.[id]) throw new Error(`素材「${id}」没有登记`);
            const o = a[1] && typeof a[1] === "object" ? a[1] : {};
            const pick: any = {}; for (const k of ["volume", "fade_ms", "rate", "pan"]) if (typeof o[k] === "number" && isFinite(o[k])) pick[k] = o[k];
            if (typeof o.loop === "boolean") pick.loop = o.loop; if (typeof o.channel === "string") pick.channel = o.channel.slice(0, 40);
            if (this.effects.sounds.length < 32) this.effects.sounds.push(m === "sound.play" ? { op: "play", id, ...pick } : { op: "stop", id, ...(pick.fade_ms !== undefined ? { fade_ms: pick.fade_ms } : {}) });
            return null;
          }
          case "textinput.open": {
            if (ctx.render) throw new Error("render 函数里不能打开输入框");
            const o = a[0] && typeof a[0] === "object" ? a[0] : {};
            const txt = (v: any) => (typeof v === "string" ? v.slice(0, 200) : v && typeof v === "object" ? { zh: String(v.zh ?? "").slice(0, 200), en: String(v.en ?? "").slice(0, 200) } : undefined);
            const max = Math.max(1, Math.min(2000, Math.floor(Number(o.max_length) || 200)));
            const req = ++this.uiSeq;
            this.effects.ui = this.effects.ui.filter((u) => u.op !== "text.open"); // 同一时刻只有一个输入框
            this.effects.ui.push({ op: "text.open", req, id: String(o.id ?? "text").slice(0, 40), title: txt(o.title), placeholder: txt(o.placeholder), value: typeof o.value === "string" ? o.value.slice(0, max) : "", multiline: !!o.multiline, max_length: max, ok: txt(o.ok), cancel: txt(o.cancel) });
            return req;
          }
          case "textinput.close": if (ctx.render) throw new Error("render 函数里不能关闭输入框"); this.effects.ui.push({ op: "text.close" }); return null;
          case "video.play": {
            if (ctx.render) throw new Error("render 函数里不能播放视频");
            const id = String(a[0]); const as: any = this.story.assets?.[id];
            if (!as) throw new Error(`素材「${id}」没有登记`);
            if (!/\.(webm|mp4)$/i.test(String(as.path ?? ""))) throw new Error(`素材「${id}」不是视频（webm/mp4）`);
            const o = a[1] && typeof a[1] === "object" ? a[1] : {};
            const req = ++this.uiSeq;
            this.effects.ui.push({ op: "video.play", req, id, loop: !!o.loop, muted: !!o.muted, skippable: o.skippable !== false, fit: o.fit === "cover" ? "cover" : "contain" });
            return req;
          }
          case "overlay.show": {
            if (ctx.render) throw new Error("render 函数里不能改界面");
            const json = JSON.stringify(a[1] ?? {}); if (json.length > 200_000) throw new Error("界面描述太大（最多 200 KB）");
            this.effects.ui.push({ op: "overlay.show", id: a[0].slice(0, 40), spec: sanitizeOverlay(a[1]) }); return null;
          }
          case "overlay.hide": if (ctx.render) throw new Error("render 函数里不能改界面"); this.effects.ui.push({ op: "overlay.hide", id: a[0] }); return null;
          case "scene.go": {
            if (ctx.render) throw new Error("render 函数里不能切换场景");
            if (!this.story.state?.scene) throw new Error("要用 api.scene.go，先在 state 里声明 scene（比如 type: string）");
            this.write("scene", a[0], ctx);
            const o = a[1] || {}; const ms = Math.max(0, Math.min(5000, Number(o.fade_ms ?? 400) || 0));
            if (ms) this.effects.ui.push({ op: "fade", color: typeof o.color === "string" ? o.color.slice(0, 30) : "#000", out_ms: 0, in_ms: ms, hold_ms: 0 });
            return null;
          }
          case "fx.shake": if (ctx.render) throw new Error("render 函数里不能触发特效"); this.effects.ui.push({ op: "shake", amount: Math.max(0, Math.min(64, Number(a[0]) || 0)), ms: Math.max(0, Math.min(5000, Number(a[1]) || 0)) }); return null;
          case "fx.fade": {
            if (ctx.render) throw new Error("render 函数里不能触发特效");
            const o = a[0] || {}; const c = (v: any, d: number) => Math.max(0, Math.min(10000, Number(v ?? d) || 0));
            this.effects.ui.push({ op: "fade", color: typeof o.color === "string" ? o.color.slice(0, 30) : "#000", out_ms: c(o.out_ms, 300), hold_ms: c(o.hold_ms, 0), in_ms: c(o.in_ms, 300) }); return null;
          }
          case "fx.filter": {
            // 整个画面的后期滤镜（模糊、灰度、复古、色相、亮度、对比度、饱和度、反色），只接受数字，拼成 CSS filter
            if (ctx.render) throw new Error("render 函数里不能改滤镜");
            const o = a[0] || {}, parts: string[] = [];
            const F: Record<string, [string, number, number]> = { blur: ["px", 0, 20], grayscale: ["", 0, 1], sepia: ["", 0, 1], hue: ["deg", -360, 360], brightness: ["", 0, 3], contrast: ["", 0, 3], saturate: ["", 0, 5], invert: ["", 0, 1] };
            for (const [k, [u, lo, hi]] of Object.entries(F)) { const v = Number(o[k]); if (o[k] != null && isFinite(v)) parts.push(`${k === "hue" ? "hue-rotate" : k}(${Math.max(lo, Math.min(hi, v))}${u})`); }
            this.effects.ui.push({ op: "filter", css: parts.join(" ") }); return null;
          }
          case "device.vibrate": {
            if (ctx.render) throw new Error("render 函数里不能振动");
            const pat = (Array.isArray(a[0]) ? a[0] : [a[0]]).slice(0, 20).map((x: any) => Math.max(0, Math.min(1000, Math.floor(Number(x) || 0))));
            this.effects.ui.push({ op: "vibrate", pattern: pat }); return null;
          }
          case "device.copy": if (ctx.render) throw new Error("render 函数里不能复制"); this.effects.ui.push({ op: "copy", text: String(a[0]).slice(0, 10000) }); return null;
          case "save.now": if (ctx.render) throw new Error("render 函数里不能存档"); this.effects.ui.push({ op: "save", label: String(a[0]).slice(0, 60) }); return null;
          case "storage.get": { const v = this.opts.storage?.get(String(a[0]).slice(0, 80)); return v === undefined ? null : clone(v); }
          case "storage.set": {
            if (ctx.render) throw new Error("render 函数里不能写本地数据");
            const k = String(a[0]).slice(0, 80), json = JSON.stringify(a[1]);
            if (json && json.length > 64 * 1024) throw new Error("一条本地数据最多 64 KB");
            this.opts.storage?.set(k, a[1]); return null;
          }
          case "video.stop": if (ctx.render) throw new Error("render 函数里不能停止视频"); this.effects.ui.push({ op: "video.stop" }); return null;
          case "ai.request": {
            if (ctx.render) throw new Error("render 函数里不能请求 AI");
            const ep = this.story.ai?.entry_points?.[a[0]];
            if (!ep) throw new Error(`AI 接入点「${a[0]}」不存在`);
            if (ep.trigger !== "script") throw new Error(`AI 接入点「${a[0]}」的 trigger 不是 script，脚本不能调用它`);
            if (this.aiInFlight >= 4) return null; // 同时最多 4 个，超出直接放弃（返回 null）
            this.aiInFlight++;
            const req = ++this.aiSeq; this.effects.ai.push({ req, entry: a[0], input: a[1] ?? "", data: a[2] ?? {} }); return req;
          }
        }
        throw new Error(`未知的 API：${m}`);
      },
    };
    try { return this.opts.scripts.run(file, src, fn, host, lim); }
    catch (e: any) { if (e instanceof ScriptError) throw new StepFail(e.kind === "fail" ? e.message : `${file}：${e.message}`); throw e; }
  }

  // ---------- 实时（oasis/0.4） ----------
  input: InputState = { held: {}, pressed: {}, joystick: { x: 0, y: 0 }, pointer: { x: 0, y: 0, down: false } };
  effects: Effects = { sounds: [], ai: [], ui: [] };
  private uiSeq = 0;
  private rtDt = 0; private rtAlpha = 0; private drawBuf: DrawCmd[] = []; private aiSeq = 0; private aiInFlight = 0; private lastRtError = "";
  /** 客户端可用区域（CSS 像素）与设备像素比；接管模式下就是整个窗口/屏幕 */
  screen: ScreenInfo = { width: 0, height: 0, dpr: 1, takeover: false };
  /** “铺满”画布当前的像素尺寸（客户端每次尺寸变化时告诉引擎） */
  canvasSizes: Record<string, { width: number; height: number }> = {};
  private lastResize = "";
  /** 客户端在窗口大小/旋转变化时调用；下一帧开头会调用 realtime.on_resize */
  setScreen(sc: Partial<ScreenInfo>) {
    const n = (v: any, d: number) => (typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : d);
    this.screen = { width: Math.round(n(sc.width, this.screen.width)), height: Math.round(n(sc.height, this.screen.height)), dpr: n(sc.dpr, this.screen.dpr), takeover: sc.takeover ?? this.screen.takeover };
  }
  setCanvasSize(cid: string, width: number, height: number) { this.canvasSizes[cid] = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }; }
  /** 画布 render 拿到的宽高：铺满模式用实际尺寸，否则用作者写的固定尺寸 */
  canvasSize(cid: string): { width: number; height: number } {
    const c: any = this.story.ui?.components?.[cid] ?? {};
    if (c.size === "fill") return this.canvasSizes[cid] ?? { width: this.screen.width || 320, height: this.screen.height || 240 };
    return { width: c.width ?? 320, height: c.height ?? 240 };
  }
  get rtTime(): number { return this.extra.rt_time ?? 0; }
  get isRealtime() { return !!this.story.realtime; }
  private rtLimits() { return { time_ms: this.story.realtime?.tick_ms ?? 16, memory_mb: this.story.scripts?.limits?.memory_mb ?? 16 }; }
  private rtError(where: string, e: any) {
    const text = `${where}出错：${e?.message ?? e}`;
    if (text !== this.lastRtError) this.log.push({ turn: this.turn, kind: "error", text });
    this.lastRtError = text;
  }
  /** 推进一帧：先触发到点的定时器，再调用 on_tick。出错时撤销这一帧的改动、记一条错误、循环继续。 */
  tick(dtMs: number, input?: Partial<InputState>): { ok: boolean; error?: string } {
    const rt = this.story.realtime;
    if (!rt || this.ending) return { ok: true };
    if (input) this.input = { ...this.input, ...clone(input) };
    const dt = Math.max(0, Math.min(250, Number(dtMs) || 0)); this.rtAlpha = 0;
    const s = this.snap(); const tBefore = this.rtTime, timersBefore = { ...(this.extra.rt_timers ?? {}) };
    const ctx: Ctx = { params: {}, locals: {}, depth: 0, caller: "rules", changed: new Set() };
    const hooks: { hook: string; data?: any }[] = [];
    this.rtDt = dt; this.extra.rt_time = tBefore + dt;
    try {
      const next: Record<string, number> = (this.extra.rt_timers ??= {});
      for (const [id, t] of Object.entries(rt.timers ?? {})) {
        if (next[id] === undefined) next[id] = tBefore + (t.after_ms ?? t.every_ms ?? 0);
        let n = 0;
        while (next[id] !== -1 && this.rtTime >= next[id] && n++ < 4) {
          if (t.action) { const r = this.execAction(t.action, t.params ?? {}, "rules", 1, ctx.changed); if (!r.ok) throw new StepFail(r.error ?? `定时器「${id}」的动作失败`); }
          if (t.emit) hooks.push({ hook: t.emit, data: { timer: id } });
          if (t.script) this.runScript(t.script, { timer: id }, ctx, this.rtLimits());
          next[id] = t.every_ms ? next[id] + t.every_ms : -1;
        }
        if (next[id] !== -1 && this.rtTime >= next[id]) next[id] = this.rtTime + (t.every_ms ?? 0); // 落后太多时不追帧
      }
      const sig = `${this.screen.width}x${this.screen.height}@${this.screen.dpr}`;
      if (rt.on_resize && this.screen.width && sig !== this.lastResize) { this.lastResize = sig; this.runScript(rt.on_resize, { ...this.screen }, ctx, this.rtLimits()); }
      if (rt.on_tick) this.runScript(rt.on_tick, {}, ctx, this.rtLimits());
    } catch (e: any) {
      this.restore(s); this.extra.rt_time = tBefore + dt; this.extra.rt_timers = timersBefore;
      this.rtError("实时循环", e); this.input = { ...this.input, pressed: {} };
      return { ok: false, error: e.message };
    }
    this.input = { ...this.input, pressed: {} };
    this.dispatch(ctx.changed, hooks);
    this.checkEndings();
    return { ok: true };
  }
  /** 画布组件取绘制指令：调用组件的 render 函数；render 里对状态的任何改动都会被撤销 */
  renderCanvas(cid: string, alpha = 0): DrawCmd[] {
    this.rtAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
    const c: any = this.story.ui?.components?.[cid];
    if (!c?.render) return [];
    const s = this.snap(); this.drawBuf = [];
    try { this.runScript(c.render, { ...this.canvasSize(cid), dpr: this.screen.dpr }, { params: {}, locals: {}, depth: 0, caller: "rules", changed: new Set(), render: true }, this.rtLimits()); }
    catch (e: any) { this.restore(s); this.rtError(`画布「${cid}」`, e); return []; }
    this.restore(s);
    return this.drawBuf;
  }
  takeEffects(): Effects { const e = this.effects; this.effects = { sounds: [], ai: [], ui: [] }; return e; }
  /**
   * 原生界面的结果回来后调用：交给 realtime.on_ui。
   * 输入框：{ type: "text", request, id, text, cancelled }；视频：{ type: "video", request, id, ended, skipped }；
   * 界面层：{ type: "button", overlay, id } / { type: "select", overlay, list, id }
   */
  deliverUi(res: Record<string, any> & { type: "text" | "video" | "button" | "select"; id: string }) {
    const on = (this.story.realtime as any)?.on_ui; if (!on || this.ending) return;
    if (res.type === "text" && typeof res.text === "string") res = { ...res, text: res.text.slice(0, 2000) };
    const s = this.snap(); const ctx: Ctx = { params: {}, locals: {}, depth: 0, caller: "rules", changed: new Set() };
    try { this.runScript(on, res, ctx, this.rtLimits()); }
    catch (e: any) { this.restore(s); this.rtError("on_ui", e); return; }
    this.dispatch(ctx.changed); this.checkEndings();
  }
  /** 异步 AI 结果回来后调用：交给 realtime.on_ai（params: request, entry, data, text, error） */
  deliverAi(res: { req: number; entry: string; data?: any; text?: string; error?: string }) {
    this.aiInFlight = Math.max(0, this.aiInFlight - 1);
    const on = this.story.realtime?.on_ai; if (!on || this.ending) return;
    const s = this.snap(); const ctx: Ctx = { params: {}, locals: {}, depth: 0, caller: "rules", changed: new Set() };
    try { this.runScript(on, { request: res.req, entry: res.entry, data: res.data ?? null, text: res.text ?? "", error: res.error ?? null }, ctx, this.rtLimits()); }
    catch (e: any) { this.restore(s); this.rtError("on_ai", e); return; }
    this.dispatch(ctx.changed); this.checkEndings();
  }

  // ---------- 可见状态 ----------
  visibleState(who: "player" | "ai"): Record<string, any> {
    const o: Record<string, any> = {};
    for (const [k, d] of Object.entries(this.story.state)) {
      const v = d.visible ?? "both";
      if (v === "both" || v === who) o[k] = clone(this.state[k]);
    }
    return o;
  }

  // ---------- AI 工具 ----------
  entry(id: string): EntryPointDef { const e = this.story.ai?.entry_points?.[id]; if (!e) throw new Error(`AI 接入点「${id}」不存在`); return e; }
  maxAuthority() { return this.story.ai?.rules?.max_authority ?? DEFAULT_MAX_AUTHORITY; }
  authorityOf(entryId: string) { return Math.min(this.entry(entryId).card.authority, this.maxAuthority()); }

  /** 生成 OpenAI function calling 的 tools 定义（仅任务卡白名单） */
  toolsFor(entryId: string) {
    const ep = this.entry(entryId);
    return Object.keys(ep.card.tools ?? {}).filter((t) => this.story.tools?.[t]).map((tid) => {
      const t = this.story.tools![tid];
      let parameters: any = { type: "object", properties: {}, required: [] as string[], additionalProperties: false };
      if (t.action) {
        for (const [k, d] of Object.entries(this.story.actions?.[t.action]?.params ?? {})) {
          parameters.properties[k] = d.type === "enum" ? { type: "string", enum: d.values, description: d.desc } : { type: d.type === "bool" ? "boolean" : d.type, description: d.desc, ...(d.min !== undefined ? { minimum: d.min } : {}), ...(d.max !== undefined ? { maximum: d.max } : {}) };
          if (d.required !== false) parameters.required.push(k);
        }
      } else if (t.write) {
        const d = this.story.state[t.write];
        parameters.properties.value = d.type === "enum" ? { type: "string", enum: d.values } : { type: d.type === "bool" ? "boolean" : d.type === "list" || d.type === "set" ? "array" : d.type === "map" || d.type === "record" ? "object" : d.type };
        parameters.required.push("value");
      }
      return { type: "function" as const, function: { name: tid, description: t.desc, parameters } };
    });
  }

  /** AI 调用工具：白名单 → 等级 → 范围 → 动作自身校验；越权整体撤销并记录 */
  /** 玩家自由文字当前允许导致的动作（由输入组件的 input.actions 决定）；null = 不是玩家文字触发 */
  inputBound: string[] | null = null;

  /**
   * 处理玩家在输入框 / 对话框里打的字（最高原则 2）。
   * 只能变成组件 input.actions 里的已声明动作，或交给作者指定的 AI 接入点（AI 仍受任务卡限制），否则返回作者写的拒绝回应。
   */
  playerInput(componentId: string, raw: string, opts: { aiAvailable?: boolean } = {}): InputResult {
    const c: any = this.story.ui?.components?.[componentId];
    if (!c || !["text-input", "chat-box"].includes(c.type) || (c.type === "text-input" && c.writes !== undefined)) return { kind: "rejected", text: "这里不能输入文字。", allowActions: [] };
    const cfg = c.input ?? { actions: [], reject: "这里做不到。" }, allow: string[] = (cfg.actions ?? []).filter((a: string) => this.story.actions?.[a]);
    const text = String(raw ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, cfg.max_length ?? 500);
    if (!text) return { kind: "rejected", text: cfg.reject, allowActions: allow };
    for (const [a, words] of Object.entries<string[]>(cfg.words ?? {})) {
      if (!allow.includes(a) || !words.some((w) => text.includes(w))) continue;
      const r = this.doAction(a, {}, "player");
      if (r.ok) return { kind: "action", text, action: a, result: r, allowActions: allow };
    }
    const trig = c.type === "chat-box" ? `ui:${componentId}.send` : null;
    const fed = Object.values<any>(this.story.ai?.entry_points ?? {}).some((e) => e.trigger === trig || e.trigger === `ui:${componentId}.submit` || (c.type === "text-input" && e.trigger === "player_input"));
    if (fed && opts.aiAvailable !== false) return { kind: "to_ai", text, allowActions: allow };
    this.log.push({ turn: this.turn, kind: "rejected", text: cfg.reject, data: { rejected_input: text } });
    return { kind: "rejected", text: cfg.reject, allowActions: allow };
  }

  callTool(entryId: string, toolId: string, args: any): ToolResult {
    const ep = this.entry(entryId);
    const reject = (reason: string): ToolResult => {
      this.violations.push({ turn: this.turn, entry: entryId, tool: toolId, reason, args });
      this.log.push({ turn: this.turn, kind: "violation", text: `AI「${entryId}」越权被拒：${reason}`, data: { tool: toolId, args } });
      return { ok: false, violation: true, error: `被拒绝：${reason}` };
    };
    const tdef: any = this.story.tools?.[toolId];
    if (this.inputBound && tdef?.action && !this.inputBound.includes(tdef.action)) return reject(`玩家这段输入只允许导致这些动作：${this.inputBound.join("、") || "（无）"}`);
    if (this.ending && !ep.after_end) return { ok: false, error: "故事已经结束" };
    const allow = ep.card.tools?.[toolId];
    const t = this.story.tools?.[toolId];
    if (!allow || !t) return reject(`工具「${toolId}」不在这个接入点的白名单里`);
    const level = this.authorityOf(entryId);
    if (t.query !== undefined) {
      try { return { ok: true, result: this.eval(t.query) }; } catch (e: any) { return { ok: false, error: e.message }; }
    }
    if (level === 0) return reject("裁量权 0 级只能叙述，不能改变状态");
    const s = this.snap();
    let r: ActionResult & { ctxChanged?: Set<string> };
    if (t.action) r = this.execAction(t.action, args ?? {}, "ai", 0);
    else {
      const ctx: Ctx = { params: {}, locals: {}, depth: 0, caller: "ai", changed: new Set() };
      try { this.write(t.write!, args?.value, ctx); r = { ok: true, result: true, changes: this.diff(s.state), ctxChanged: ctx.changed }; }
      catch (e: any) { this.restore(s); r = { ok: false, error: e.message, changes: [] }; }
    }
    if (!r.ok) return { ok: false, error: r.error };
    // 范围校验（只看工具本身直接造成的改动）
    const writes = allow.writes;
    for (const c of r.changes) {
      const lim: WriteLimit | undefined = writes?.[c.key];
      if (!lim) {
        if (level === 1 || writes) { this.restore(s); return reject(`不允许改动「${c.key}」`); }
        continue;
      }
      const bad = checkLimit(lim, c.before, c.after);
      if (bad) { this.restore(s); return reject(`「${c.key}」${bad}`); }
    }
    this.dispatch(r.ctxChanged ?? new Set(), t.action ? [{ hook: `action:${t.action}` }] : []);
    this.checkEndings();
    if (this.ending && !s.ending && level < 3) { this.restore(s); return reject(`这次调用会导致结局，但 ${level} 级裁量权不能决定结局`); }
    return { ok: true, result: r.result, changes: this.diff(s.state) };
  }

  /** 把 AI 的结构化输出交回规则（output.then），以规则身份执行 */
  applyAiJson(entryId: string, out: any): ActionResult {
    const ep = this.entry(entryId);
    const s = this.snap();
    const ctx: Ctx = { params: {}, locals: {}, out, depth: 0, caller: "rules", changed: new Set() };
    try { this.runSteps(ep.card.output.then, ctx); }
    catch (e: any) { this.restore(s); return { ok: false, error: e.message, changes: [] }; }
    this.dispatch(ctx.changed); this.checkEndings();
    return { ok: true, changes: this.diff(s.state), ending: this.ending };
  }
  /** AI 文本写入状态（output.to = state:xxx） */
  writeAiText(key: string, text: string) {
    const d = this.story.state[key];
    if (!d || !(d.writable_by ?? []).includes("ai")) throw new Error(`状态「${key}」不允许 AI 写`);
    const ctx: Ctx = { params: {}, locals: {}, depth: 0, caller: "ai", changed: new Set() };
    this.write(key, text, ctx); this.dispatch(ctx.changed); this.checkEndings();
  }

  /** 界面输入框直接填值（只限作者声明了 writes、且状态允许 ui 写的输入框） */
  uiWrite(componentId: string, value: string): ActionResult {
    const c: any = this.story.ui?.components?.[componentId];
    const key = c?.type === "text-input" ? c.writes : undefined, d = key ? this.story.state[key] : undefined;
    if (!d || !(d.writable_by ?? []).includes("ui")) return { ok: false, error: "这里不能填写", changes: [] };
    const ctx: Ctx = { params: {}, locals: {}, depth: 0, caller: "player", changed: new Set() };
    try { this.write(key, String(value).slice(0, 200), ctx); } catch (e: any) { return { ok: false, error: e.message, changes: [] }; }
    this.dispatch(ctx.changed); this.checkEndings();
    return { ok: true, changes: [] };
  }

  // ---------- 存档 ----------
  save(): SaveData {
    const d: SaveData = { format: "oasis-save/1", story: { id: this.story.meta.id, version: this.story.meta.version, hash: storyHash(this.source) },
      state: clone(this.state), rng: this.rng.s, seed: this.seed, turn: this.turn, fired: [...this.fired], ending: this.ending,
      cooldowns: { ...this.cooldowns }, log: clone(this.log), violations: clone(this.violations), extra: clone(this.extra), savedAt: new Date().toISOString() };
    d.check = saveCheck(d);
    return d;
  }
  static load(story: Story, data: SaveData, opts: GameOptions = {}): { game: Game; warnings: string[] } {
    if (data?.format !== "oasis-save/1") throw new Error("这不是“我的绿洲”的存档文件");
    if (!data.check || data.check !== saveCheck(data)) throw new Error("存档文件被改动过或已损坏，不能读取。玩家不能修改存档内容。");
    if (data.story.id !== story.meta.id) throw new Error(`这个存档属于故事「${data.story.id}」，不是「${story.meta.id}」`);
    const warnings: string[] = [];
    if (data.story.hash !== storyHash(story)) warnings.push(`故事内容和存档时不一样（存档版本 ${data.story.version}，当前 ${story.meta.version}），可能出现异常。`);
    const g = new Game(story, { ...opts, seed: data.seed });
    for (const k of Object.keys(story.state)) {
      if (k in data.state) { try { g.state[k] = g.coerce(k, data.state[k]); } catch { warnings.push(`状态「${k}」的存档值不合法，已用初始值。`); } }
      else warnings.push(`存档里没有状态「${k}」，已用初始值。`);
    }
    g.rng.s = data.rng >>> 0; g.turn = data.turn; g.fired = new Set(data.fired); g.ending = data.ending;
    g.cooldowns = data.cooldowns ?? {}; g.log = data.log ?? []; g.violations = data.violations ?? []; g.extra = data.extra ?? {};
    g.started = true;
    return { game: g, warnings };
  }
}

function checkLimit(lim: WriteLimit, before: any, after: any): string | null {
  if (lim === "any") return null;
  if ("delta" in lim) { const d = after - before; return d < lim.delta[0] || d > lim.delta[1] ? `一次只能改变 ${lim.delta[0]}~${lim.delta[1]}，这次改了 ${d}` : null; }
  if ("range" in lim) return after < lim.range[0] || after > lim.range[1] ? `只能在 ${lim.range[0]}~${lim.range[1]} 之间，这次变成了 ${after}` : null;
  if ("values" in lim) return lim.values.some((v) => deepEq(v, after)) ? null : `只能改成 ${lim.values.join("/")}`;
  if ("add_only" in lim) return (before ?? []).every((x: any) => (after ?? []).some((y: any) => deepEq(x, y))) ? null : "只能加入，不能移除";
  return "限制写法不认识";
}
