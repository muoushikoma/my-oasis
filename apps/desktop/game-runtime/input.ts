// 统一输入（规范 §13.6）：键盘、手柄、触屏虚拟按键都先变成“输入码”，再按作者声明的映射变成“动作”。
// 输入码：键盘用 KeyboardEvent.code（KeyA、Space、ArrowLeft…）；手柄按钮 Pad0–Pad16（标准布局），
// 摇杆 PadAxis0- / PadAxis0+（左摇杆左/右）、PadAxis1- / PadAxis1+（上/下）；触屏虚拟按键直接按动作名触发。
// 纯逻辑部分（InputMap）不碰 DOM，方便单测；bindDom 负责把浏览器事件接进来。

export type Bindings = Record<string, string[]>;
export const AXIS_DEAD = 0.35;

/** 常用的默认映射：作者不写 input.actions 时使用 */
export const DEFAULT_BINDINGS: Bindings = {
  left: ["ArrowLeft", "KeyA", "Pad14", "PadAxis0-"],
  right: ["ArrowRight", "KeyD", "Pad15", "PadAxis0+"],
  up: ["ArrowUp", "KeyW", "Pad12", "PadAxis1-"],
  down: ["ArrowDown", "KeyS", "Pad13", "PadAxis1+"],
  jump: ["Space", "KeyK", "Pad0"],
  attack: ["KeyJ", "KeyX", "Pad2"],
  confirm: ["Enter", "Space", "Pad0"],
  pause: ["KeyP", "Pad9"],
};

export class InputMap {
  private bindings = new Map<string, string[]>();
  private codes = new Set<string>();          // 当前按着的输入码
  private virt = new Set<string>();           // 触屏虚拟按键按着的动作
  private now = new Set<string>(); private prev = new Set<string>();
  private latched = new Set<string>();        // 两次 step 之间按下又松开的动作（快速点按不丢）
  constructor(bindings: Bindings = DEFAULT_BINDINGS) { this.setBindings(bindings); }
  setBindings(b: Bindings) { this.bindings.clear(); for (const [a, codes] of Object.entries(b)) this.bindings.set(a, [...new Set(codes)]); }
  getBindings(): Bindings { return Object.fromEntries([...this.bindings].map(([a, c]) => [a, [...c]])); }
  actions() { return [...this.bindings.keys()]; }
  /** 改一个动作的按键；replace=false 时追加 */
  rebind(action: string, codes: string[] | string, replace = true) {
    const list = Array.isArray(codes) ? codes : [codes];
    const old = replace ? [] : this.bindings.get(action) ?? [];
    this.bindings.set(action, [...new Set([...old, ...list])]);
  }
  /** 哪些动作用到了这个输入码 */
  actionsFor(code: string) { return [...this.bindings].filter(([, c]) => c.includes(code)).map(([a]) => a); }
  codeDown(code: string) { if (this.codes.has(code)) return; this.codes.add(code); for (const a of this.actionsFor(code)) this.latched.add(a); }
  codeUp(code: string) { this.codes.delete(code); }
  virtualDown(action: string) { this.virt.add(action); this.latched.add(action); }
  virtualUp(action: string) { this.virt.delete(action); }
  /** 手柄快照：按钮按下的编号、摇杆数值（-1..1） */
  setPad(buttons: number[], axes: number[]) {
    const want = new Set<string>(buttons.map((i) => `Pad${i}`));
    axes.forEach((v, i) => { if (v <= -AXIS_DEAD) want.add(`PadAxis${i}-`); if (v >= AXIS_DEAD) want.add(`PadAxis${i}+`); });
    for (const c of [...this.codes]) if (c.startsWith("Pad") && !want.has(c)) this.codeUp(c);
    for (const c of want) this.codeDown(c);
  }
  releaseAll() { this.codes.clear(); this.virt.clear(); this.latched.clear(); }
  private rawDown(action: string) {
    if (this.virt.has(action)) return true;
    const codes = this.bindings.get(action); return !!codes && codes.some((c) => this.codes.has(c));
  }
  /** 每个固定步开始时调用一次：算出本步的按下/松开 */
  step() {
    this.prev = this.now; this.now = new Set();
    for (const a of this.bindings.keys()) if (this.rawDown(a) || this.latched.has(a)) this.now.add(a);
    for (const a of this.virt) this.now.add(a);
    this.latched.clear();
  }
  isDown(a: string) { return this.now.has(a); }
  pressed(a: string) { return this.now.has(a) && !this.prev.has(a); }
  released(a: string) { return !this.now.has(a) && this.prev.has(a); }
  /** -1 / 0 / 1 */
  axis(neg: string, pos: string) { return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0); }
}

/** 触屏虚拟按键的声明（作者在 create({ input: { touch } }) 里写，默认不显示任何东西） */
export interface TouchButton { action: string; label?: string; x: number; y: number; r?: number }
export interface TouchConfig {
  /** 虚拟按键；x/y 是相对屏幕的 0–1 位置（负数从右/下数） */
  buttons?: TouchButton[];
  /** 左下角十字键（方向四个动作），默认不显示 */
  dpad?: false | { left: string; right: string; up?: string; down?: string };
  /** "auto"（默认，只在触屏设备显示）| "always" | "never" */
  show?: "auto" | "always" | "never";
}

/** 把键盘、失焦、手柄接到 InputMap；返回解绑函数。外部转发的手柄数据优先（沙箱 iframe 里可能拿不到 Gamepad API） */
export function bindDom(map: InputMap, win: Window, opts: { onEsc?: (down: boolean) => void; preventKeys?: boolean } = {}) {
  const kd = (e: KeyboardEvent) => {
    if (e.code === "Escape") { if (!e.repeat) opts.onEsc?.(true); return; }
    if (opts.preventKeys !== false && map.actionsFor(e.code).length) e.preventDefault();
    if (!e.repeat) map.codeDown(e.code);
  };
  const ku = (e: KeyboardEvent) => { if (e.code === "Escape") { opts.onEsc?.(false); return; } map.codeUp(e.code); };
  const blur = () => map.releaseAll();
  win.addEventListener("keydown", kd); win.addEventListener("keyup", ku); win.addEventListener("blur", blur);
  return () => { win.removeEventListener("keydown", kd); win.removeEventListener("keyup", ku); win.removeEventListener("blur", blur); };
}

/** 读取原生 Gamepad API（拿得到的话） */
export function readNativePad(): { buttons: number[]; axes: number[] } | undefined {
  try {
    const g = [...(navigator.getGamepads?.() ?? [])].find((x) => x && x.connected); if (!g) return;
    return { buttons: g.buttons.map((b, i) => (b.pressed || b.value > 0.5 ? i : -1)).filter((i) => i >= 0), axes: [...g.axes] };
  } catch { return; }
}
