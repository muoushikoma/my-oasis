// 动画状态机（规范 §13.6）：作者在故事包里用 JSON 声明状态、切换条件、帧事件。
// 纯逻辑，不依赖 PixiJS，方便单测；渲染层每个固定步调用 update(dt)，再按 frame 换贴图。

export type ParamValue = number | boolean;
export interface AnimClip { frames: number[]; fps?: number; loop?: boolean }
export interface FsmState {
  /** 用哪段动画（sheet 里 animations 的键）；不写就用状态名 */
  anim?: string;
  /** 覆盖动画的循环设置 */
  loop?: boolean;
  /** 播放速度倍率，默认 1 */
  speed?: number;
  /** 帧事件：动画第 N 帧（从 0 数）开始时触发的事件名，可以是一个或多个 */
  events?: Record<string, string | string[]>;
  /** 进入/离开时触发的事件 */
  on_enter?: string; on_exit?: string;
}
export interface FsmTransition {
  /** 来源状态；"*" 或省略 = 任意状态（除了 to 自己） */
  from?: string | string[];
  to: string;
  /** 条件表达式，例如 "speed > 10 && grounded"；触发器参数直接写名字 */
  when?: string;
  /** 只有当前动画播完（非循环动画）才切换 */
  on_end?: boolean;
  /** 至少在来源状态停留多少秒 */
  min_time?: number;
}
export interface FsmDef {
  initial: string;
  /** 参数：默认值；写 "trigger" 表示触发器（被条件用到后自动清零） */
  params?: Record<string, ParamValue | "trigger">;
  states: Record<string, FsmState>;
  transitions?: FsmTransition[];
}

// ---------- 条件表达式：只支持 参数/数字/true/false、比较、!、&&、||、括号，不用 eval ----------
type Tok = { t: "num" | "id" | "op"; v: string };
function lex(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const two = src.slice(i, i + 2);
    if (["&&", "||", ">=", "<=", "==", "!="].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("()<>!-".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i)); if (num) { out.push({ t: "num", v: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); if (id) { out.push({ t: "id", v: id[0] }); i += id[0].length; continue; }
    throw new Error(`条件里有看不懂的字符「${c}」：${src}`);
  }
  return out;
}
export type Cond = (get: (name: string) => ParamValue) => boolean | number;
/** 把条件编译成函数；同时返回用到的参数名 */
export function compileCond(src: string): { fn: Cond; uses: string[] } {
  const toks = lex(src); let p = 0; const uses = new Set<string>();
  const peek = () => toks[p]?.v, eat = (v?: string) => { const t = toks[p++]; if (!t || (v && t.v !== v)) throw new Error(`条件写错了：${src}`); return t; };
  type N = (g: (n: string) => ParamValue) => any;
  const prim = (): N => {
    if (peek() === "(") { eat("("); const e = or(); eat(")"); return e; }
    if (peek() === "!") { eat("!"); const e = prim(); return (g) => !e(g); }
    if (peek() === "-") { eat("-"); const e = prim(); return (g) => -e(g); }
    const t = eat();
    if (t.t === "num") { const n = Number(t.v); return () => n; }
    if (t.t === "id") { if (t.v === "true") return () => true; if (t.v === "false") return () => false; uses.add(t.v); const k = t.v; return (g) => g(k); }
    throw new Error(`条件写错了：${src}`);
  };
  const cmp = (): N => {
    const a = prim(); const op = peek();
    if (op && [">", "<", ">=", "<=", "==", "!="].includes(op)) {
      eat(); const b = prim();
      switch (op) { case ">": return (g) => a(g) > b(g); case "<": return (g) => a(g) < b(g); case ">=": return (g) => a(g) >= b(g); case "<=": return (g) => a(g) <= b(g); case "==": return (g) => a(g) == b(g); default: return (g) => a(g) != b(g); }
    }
    return a;
  };
  const and = (): N => { let a = cmp(); while (peek() === "&&") { eat(); const l = a, r = cmp(); a = (g) => l(g) && r(g); } return a; };
  const or = (): N => { let a = and(); while (peek() === "||") { eat(); const l = a, r = and(); a = (g) => l(g) || r(g); } return a; };
  const fn = or(); if (p !== toks.length) throw new Error(`条件写错了：${src}`);
  return { fn, uses: [...uses] };
}

/** 检查一份状态机定义；返回问题列表（空 = 没问题） */
export function checkFsm(def: FsmDef, clips?: Record<string, AnimClip>): string[] {
  const errs: string[] = [];
  if (!def || typeof def !== "object" || !def.states || typeof def.states !== "object") return ["状态机缺少 states"];
  const names = Object.keys(def.states);
  if (!names.includes(def.initial)) errs.push(`initial「${def.initial}」不是已声明的状态`);
  for (const [n, s] of Object.entries(def.states)) {
    const a = s.anim ?? n; if (clips && !clips[a]) errs.push(`状态「${n}」用的动画「${a}」不存在`);
    for (const k of Object.keys(s.events ?? {})) if (!/^\d+$/.test(k)) errs.push(`状态「${n}」的帧事件键必须是帧号（数字），现在是「${k}」`);
  }
  (def.transitions ?? []).forEach((t, i) => {
    if (!names.includes(t.to)) errs.push(`第 ${i + 1} 条切换的 to「${t.to}」不是已声明的状态`);
    const froms = t.from === undefined || t.from === "*" ? [] : Array.isArray(t.from) ? t.from : [t.from];
    for (const f of froms) if (!names.includes(f)) errs.push(`第 ${i + 1} 条切换的 from「${f}」不是已声明的状态`);
    if (t.when) { try { const { uses } = compileCond(t.when); for (const u of uses) if (!(u in (def.params ?? {}))) errs.push(`第 ${i + 1} 条切换的条件用了没声明的参数「${u}」`); } catch (e: any) { errs.push(e.message); } }
    if (!t.when && !t.on_end) errs.push(`第 ${i + 1} 条切换既没有 when 也没有 on_end，会一直切换`);
  });
  return errs;
}

export interface FsmEvent { name: string; state: string; frame: number }

/** 状态机实例 */
export class AnimFsm {
  state: string; frame = 0; time = 0; stateTime = 0; done = false;
  private params = new Map<string, ParamValue>(); private triggers = new Set<string>();
  private compiled: { t: FsmTransition; from: Set<string> | null; cond?: Cond; uses: string[] }[];
  private listeners = new Set<(e: FsmEvent) => void>();
  constructor(readonly def: FsmDef, readonly clips: Record<string, AnimClip>) {
    const errs = checkFsm(def, clips); if (errs.length) throw new Error("动画状态机有误：" + errs.join("；"));
    for (const [k, v] of Object.entries(def.params ?? {})) { if (v === "trigger") { this.triggers.add(k); this.params.set(k, false); } else this.params.set(k, v); }
    this.compiled = (def.transitions ?? []).map((t) => {
      const c = t.when ? compileCond(t.when) : undefined;
      const from = t.from === undefined || t.from === "*" ? null : new Set(Array.isArray(t.from) ? t.from : [t.from]);
      return { t, from, cond: c?.fn, uses: c?.uses ?? [] };
    });
    this.state = def.initial;
    this.enter(def.initial, true);
  }
  get clip(): AnimClip { return this.clips[this.def.states[this.state].anim ?? this.state]; }
  /** 当前应显示的贴图帧号（sheet 里的帧索引） */
  get textureIndex(): number { const f = this.clip.frames; return f[Math.min(this.frame, f.length - 1)]; }
  on(cb: (e: FsmEvent) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  set(name: string, v: ParamValue) { if (!this.params.has(name)) throw new Error(`状态机没有参数「${name}」`); this.params.set(name, v); }
  get(name: string): ParamValue { return this.params.get(name) ?? 0; }
  trigger(name: string) { this.set(name, true); }
  private emit(name: string | undefined) { if (!name) return; const e = { name, state: this.state, frame: this.frame }; this.listeners.forEach((l) => l(e)); }
  private frameEvents() { const ev = this.def.states[this.state].events?.[String(this.frame)]; (Array.isArray(ev) ? ev : ev ? [ev] : []).forEach((n) => this.emit(n)); }
  private enter(s: string, first = false) {
    if (!first) this.emit(this.def.states[this.state].on_exit);
    this.state = s; this.frame = 0; this.time = 0; this.stateTime = 0; this.done = false;
    this.emit(this.def.states[s].on_enter); this.frameEvents();
  }
  /** 立刻切到某个状态（脚本强制，比如受伤） */
  play(s: string) { if (!this.def.states[s]) throw new Error(`没有状态「${s}」`); this.enter(s); }
  private looping() { const st = this.def.states[this.state]; return st.loop ?? this.clip.loop ?? true; }
  /** 推进 dt 秒：先检查切换，再推进帧 */
  update(dt: number) {
    this.checkTransitions();
    const st = this.def.states[this.state], clip = this.clip, fps = (clip.fps ?? 10) * (st.speed ?? 1);
    this.stateTime += dt;
    if (this.done || fps <= 0) return;
    this.time += dt;
    const per = 1 / fps;
    while (this.time >= per) {
      this.time -= per;
      if (this.frame + 1 < clip.frames.length) { this.frame++; this.frameEvents(); }
      else if (this.looping()) { this.frame = 0; this.frameEvents(); }
      else { this.done = true; this.emit(`${this.state}:end`); break; }
    }
    if (this.done) this.checkTransitions();
  }
  private checkTransitions() {
    const get = (n: string) => this.params.get(n) ?? 0;
    for (const c of this.compiled) {
      if (c.t.to === this.state && c.from === null) continue;
      if (c.from && !c.from.has(this.state)) continue;
      if (c.t.min_time && this.stateTime < c.t.min_time) continue;
      if (c.t.on_end && !this.done) continue;
      if (c.cond && !c.cond(get)) continue;
      for (const u of c.uses) if (this.triggers.has(u)) this.params.set(u, false); // 触发器用一次就清零
      this.enter(c.t.to); return;
    }
  }
}
