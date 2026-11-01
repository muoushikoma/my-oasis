// oasis/0.4 实时循环（客户端）：按 tick_hz 推进引擎、收集键盘/触摸/摇杆输入、把绘制指令画到 canvas、播放声音、异步跑 AI。
import { runEntry, type Game, type DrawCmd } from "@my-oasis/engine";
import { buildShader, type Story, type InputState, type TouchControlDef } from "@my-oasis/schema";
import { h } from "./dom";
import type { AssetBox } from "./assets";
import type { LLM } from "@my-oasis/engine";
import { type Renderer, type RendererResources } from "./render/common";
import { WebGLRenderer } from "./render/webgl";
import { Canvas2DRenderer } from "./render/canvas2d";
import { AudioEngine } from "./render/audio";
import { NativeUi } from "./native-ui";
import { pollGamepad } from "./gamepad";

export interface RtHost {
  game: Game; story: Story; assets: AssetBox; llm?: LLM;
  muted(): boolean; sfx(): number;
  onFrame(changed: boolean): void; // 每帧之后（节流的 DOM 刷新、结局处理由页面决定）
  onHooks(hooks: string[]): void;
  /** api.save.now：脚本请求存档（客户端写入自动存档槽） */
  onSave?(label: string): void;
}

/** 把绘制指令画到 2D 画布上（兼容旧接口：测试/截图用；游戏里用 WebGL 渲染器） */
export function paint(ctx: CanvasRenderingContext2D, cmds: DrawCmd[], img: (id: string) => HTMLImageElement | undefined) {
  const r = new Canvas2DRenderer(ctx.canvas, img); r.resize(ctx.canvas.width, ctx.canvas.height, 1); r.draw(cmds, 0, 0); r.dispose();
}

interface View { el: HTMLCanvasElement; w: number; h: number; dpr: number; r?: Renderer; cmds: DrawCmd[]; animated: boolean; pixelated: boolean; fixedDpr?: number }
const MAX_DPR = 2;

export class RealtimeDriver {
  canvases = new Map<string, HTMLCanvasElement>();
  controls?: HTMLElement;
  private views = new Map<string, View>();
  private raf = 0; private last = 0; private acc = 0; private lastDom = 0; private lastSig = 0; private stateSig = "";
  private input: InputState = { held: {}, pressed: {}, joystick: { x: 0, y: 0 }, pointer: { x: 0, y: 0, down: false } };
  private images = new Map<string, HTMLImageElement>();
  private audio?: AudioEngine;
  private off: (() => void)[] = [];
  private running = false; private clock = 0;
  // 调试信息（F3 显示）
  private dbg?: HTMLElement; private stats = { frames: 0, since: 0, fps: 0, frameMs: 0, tickMs: 0, renderMs: 0, drawMs: 0, drawn: 0, ticks: 0 };
  /** 原生输入框 / 全屏视频（api.textinput、api.video） */
  ui: NativeUi;
  private fonts: FontFace[] = [];
  private padHeld = new Set<string>(); private padStick = false;
  /** 画进画布的视频（api.draw.video）：每个素材一个 <video>，一段时间没画就暂停 */
  private videos = new Map<string, { el: HTMLVideoElement; seen: number; broken?: boolean }>();
  private shaders = new Map<string, { fragment: string; uniforms: Record<string, string> } | null>();
  private tiledMaps = new Map<string, any>();
  private touchEls = new Map<string, { el: HTMLElement; def: TouchControlDef }>();
  readonly res: RendererResources = {
    video: (id, o) => this.videoFor(id, o),
    tiled: (id) => this.tiledFor(id),
    shader: (id) => this.shaderFor(id),
    warn: (msg) => this.s.game.clientWarn(msg),
  };
  private shakeAmt = 0; private shakeUntil = 0; private shakeMs = 1; private touches = new Map<number, { id: number; x: number; y: number; target?: string }>();
  constructor(private s: RtHost) {
    this.ui = new NativeUi({
      lang: s.game.lang, muted: () => s.muted(), url: (id) => s.assets.url(`asset:${id}`),
      shake: (amount, ms) => { this.shakeAmt = amount; this.shakeUntil = this.clock + ms; this.shakeMs = ms; },
      save: (label) => s.onSave?.(label),
      filter: (css) => { for (const v of this.views.values()) v.el.style.filter = css; },
      deliver: (res) => { s.game.deliverUi(res); this.effects(); const hooks = s.game.drainHooks(); if (hooks.length) s.onHooks(hooks); s.onFrame(true); },
    });
  }

  get hz() { return Math.max(1, Math.min(60, this.s.story.realtime?.tick_hz ?? 30)); }
  get interpolate() { return !!(this.s.story.realtime as any)?.interpolate; }

  canvas(cid: string, c0: any): HTMLCanvasElement {
    let el = this.canvases.get(cid);
    const c = { ...c0, ...this.s.game.canvasConfig(cid) }; // 显示场景的画布：用当前场景的尺寸
    if (!el) {
      const fill = c.size === "fill";
      const w = fill ? 1 : Math.max(1, c.width ?? 320), hh = fill ? 1 : Math.max(1, c.height ?? 240);
      el = h("canvas", { width: w, height: hh, class: `rt-canvas${fill ? " rt-fill" : ""}`, "data-canvas": cid, tabindex: 0, style: { imageRendering: c.pixelated ? "pixelated" : "auto" } });
      // 铺满画布：逻辑尺寸就是画布像素（hidpi 已经乘过设备像素比），渲染器不再额外放大
      const v: View = { el, w, h: hh, dpr: 0, cmds: [], animated: false, pixelated: !!c.pixelated, fixedDpr: fill ? 1 : undefined };
      this.views.set(cid, v);
      const pos = (e: PointerEvent) => { const r = el!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * v.w, y: ((e.clientY - r.top) / r.height) * v.h }; };
      // 多点触控：每根手指一条（api.input.touches）；pointer 仍是“主指针”（鼠标或第一根手指），button：0 左键 1 中键 2 右键
      const syncTouches = () => { this.input.touches = [...this.touches.values()].slice(0, 10).map((t) => ({ ...t })); };
      el.onpointerdown = (e) => {
        el!.setPointerCapture?.(e.pointerId);
        if (e.pointerType === "touch") { this.touches.set(e.pointerId, { id: e.pointerId, ...pos(e), target: cid }); syncTouches(); }
        if (e.isPrimary || e.pointerType === "mouse") { this.input.pointer = { ...this.input.pointer, ...pos(e), down: true, target: cid, button: e.button }; this.input.pressed.pointer = true; if (e.button === 2) this.input.pressed.pointer_right = true; }
      };
      el.onpointermove = (e) => {
        if (this.touches.has(e.pointerId)) { this.touches.set(e.pointerId, { id: e.pointerId, ...pos(e), target: cid }); syncTouches(); }
        if (e.isPrimary || e.pointerType === "mouse") this.input.pointer = { ...this.input.pointer, ...pos(e), target: cid };
      };
      el.onpointerup = el.onpointercancel = (e) => {
        if (this.touches.delete(e.pointerId)) syncTouches();
        if (e.isPrimary || e.pointerType === "mouse") this.input.pointer = { ...this.input.pointer, ...pos(e), down: false, target: cid };
      };
      el.oncontextmenu = (e) => e.preventDefault();
      // 滚轮：每个 tick 累计的滚动量（向下为正，约 100 = 一格）
      el.addEventListener("wheel", (e) => { e.preventDefault(); this.input.pointer = { ...this.input.pointer, wheel: (this.input.pointer.wheel ?? 0) + Math.max(-1000, Math.min(1000, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY)) }; }, { passive: false });
      if (fill && typeof ResizeObserver !== "undefined") {
        // 铺满：画布像素 = 实际显示尺寸（hidpi 时再乘设备像素比）；窗口缩放、手机转屏时自动跟着变
        const cv = el;
        const ro = new ResizeObserver(() => {
          const r = cv.getBoundingClientRect(); if (!r.width || !r.height) return;
          const k = c.hidpi ? (window.devicePixelRatio || 1) : 1;
          const w = Math.max(1, Math.min(8192, Math.round(r.width * k))), hh = Math.max(1, Math.min(8192, Math.round(r.height * k)));
          if (v.w !== w || v.h !== hh) { v.w = w; v.h = hh; v.dpr = 0; if (!v.r) { cv.width = w; cv.height = hh; } }
          this.s.game.setCanvasSize(cid, w, hh); this.draw();
        });
        ro.observe(el); this.off.push(() => ro.disconnect());
      }
      this.canvases.set(cid, el);
    }
    return el;
  }
  /** 第一次画时创建渲染器：优先 WebGL（显卡合批），不支持时用 Canvas2D；按屏幕像素密度提高清晰度 */
  private renderer(v: View): Renderer | undefined {
    const dpr = v.fixedDpr ?? Math.min(MAX_DPR, Math.max(1, globalThis.devicePixelRatio || 1), 4096 / Math.max(v.w, v.h));
    if (!v.r) {
      v.r = (!this.forceCanvas2d && WebGLRenderer.create(v.el, (id) => this.image(id), v.pixelated)) || new Canvas2DRenderer(v.el, (id) => this.image(id), v.pixelated);
      v.r.res = this.res;
    }
    if (dpr !== v.dpr) { v.dpr = dpr; v.el.width = Math.round(v.w * dpr); v.el.height = Math.round(v.h * dpr); v.r.resize(v.w, v.h, dpr); }
    return v.r;
  }
  /** 调试/测试用：强制 Canvas2D（?canvas2d） */
  forceCanvas2d = typeof location !== "undefined" && /[?&]canvas2d\b/.test(location.search);
  get rendererKind() { for (const v of this.views.values()) if (v.r) return v.r.kind; return undefined; }

  /** 屏幕上的虚拟摇杆和按钮（触摸设备；桌面上也可以用鼠标点） */
  controlsEl(): HTMLElement | null {
    const inp: any = this.s.story.input; if (!inp || (!inp.joystick && !inp.buttons?.length && !inp.touch?.length)) return null;
    if (this.controls) return this.controls;
    const wrap = h("div", { class: "rt-controls" });
    if (inp.touch?.length) { wrap.classList.add("has-touch"); wrap.append(this.touchLayer(inp.touch)); }
    if (inp.joystick) {
      const knob = h("div", { class: "rt-knob" }), pad = h("div", { class: `rt-joy ${inp.joystick?.side === "right" ? "right" : ""}` }, knob);
      const set = (e: PointerEvent | null) => {
        if (!e) { this.input.joystick = { x: 0, y: 0 }; knob.style.transform = ""; return; }
        const r = pad.getBoundingClientRect(), R = r.width / 2;
        let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
        this.input.joystick = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }; knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
      };
      pad.onpointerdown = (e) => { pad.setPointerCapture?.(e.pointerId); set(e); };
      pad.onpointermove = (e) => { if (e.buttons || e.pointerType === "touch") set(e); };
      pad.onpointerup = pad.onpointercancel = () => set(null);
      wrap.append(pad);
    }
    if (inp.buttons?.length) {
      const bs = h("div", { class: "rt-buttons" });
      for (const b of inp.buttons) {
        const el = h("button", { class: "rt-btn", "data-btn": b.id }, b.label ?? b.id);
        el.onpointerdown = (e) => { e.preventDefault(); this.input.held[b.id] = true; this.input.pressed[b.id] = true; };
        el.onpointerup = el.onpointerleave = el.onpointercancel = () => { delete this.input.held[b.id]; };
        bs.append(el);
      }
      wrap.append(bs);
    }
    return (this.controls = wrap);
  }

  /**
   * 故事自定义的触摸按键（input.touch）：按钮、摇杆、十字键，位置按屏幕的角/边摆放。
   * 每个按键单独跟踪自己的手指（多点触控）；客户端的“⋯”出口永远在它们上面。
   */
  private touchLayer(defs: TouchControlDef[]): HTMLElement {
    const layer = h("div", { class: "rt-touch" });
    const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
    const label = (l: any) => (l && typeof l === "object" ? (l[this.s.game.lang] ?? l.zh ?? l.en ?? "") : l ?? "");
    let firstStick = true;
    for (const d of defs.slice(0, 16)) {
      const size = d.size ?? (d.type === "button" ? 64 : 120), anchor = d.anchor ?? (d.type === "button" ? "bottom_right" : "bottom_left");
      const pos: Record<string, string> = { width: `${size}px`, height: `${size}px`, opacity: String(d.opacity ?? 0.8) };
      const x = d.x ?? 24, y = d.y ?? 24;
      if (anchor.includes("left")) pos.left = `calc(${x}px + env(safe-area-inset-left))`; else if (anchor.includes("right")) pos.right = `calc(${x}px + env(safe-area-inset-right))`; else { pos.left = `calc(50% + ${x}px)`; pos.marginLeft = `${-size / 2}px`; }
      if (anchor.includes("top")) pos.top = `calc(${y}px + env(safe-area-inset-top))`; else if (anchor.includes("bottom")) pos.bottom = `calc(${y}px + env(safe-area-inset-bottom))`; else { pos.top = `calc(50% + ${y}px)`; pos.marginTop = `${-size / 2}px`; }
      if (d.color) pos.background = d.color;
      const img = d.image ? this.s.assets.url(`asset:${d.image}`) : undefined, imgOn = d.image_pressed ? this.s.assets.url(`asset:${d.image_pressed}`) : undefined;
      if (img) { pos.backgroundImage = `url("${img}")`; pos.backgroundSize = "100% 100%"; }
      const el = h("div", { class: `rt-tc rt-tc-${d.type}`, "data-touch": d.id, style: pos }, d.type === "button" ? label(d.label) : "");
      const press = (on: boolean) => { el.classList.toggle("on", on); if (imgOn) el.style.backgroundImage = `url("${on ? imgOn : img}")`; };
      if (d.show !== "always" && !coarse) el.style.display = "none";
      if (d.visible === false) el.style.display = "none";
      if (d.type === "button") {
        const k = d.key ?? d.id;
        el.onpointerdown = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); if (el.classList.contains("off")) return; if (!this.input.held[k]) this.input.pressed[k] = true; this.input.held[k] = true; press(true); };
        el.onpointerup = el.onpointercancel = () => { delete this.input.held[k]; press(false); };
      } else {
        const knob = h("div", { class: "rt-tc-knob" }); if (d.type === "stick") el.append(knob);
        const main = firstStick && d.type === "stick"; if (d.type === "stick") firstStick = false;
        const keys = { up: d.keys?.up ?? "up", down: d.keys?.down ?? "down", left: d.keys?.left ?? "left", right: d.keys?.right ?? "right" };
        const set = (e: PointerEvent | null) => {
          let vx = 0, vy = 0;
          if (e) { const r = el.getBoundingClientRect(), R = r.width / 2; vx = (e.clientX - r.left - R) / R; vy = (e.clientY - r.top - R) / R; const l = Math.hypot(vx, vy); if (l > 1) { vx /= l; vy /= l; } }
          if (d.type === "stick") {
            const v = { x: Math.round(vx * 100) / 100, y: Math.round(vy * 100) / 100 };
            this.input.sticks = { ...(this.input.sticks ?? {}), [d.id]: v }; if (main) this.input.joystick = v;
            knob.style.transform = e ? `translate(${vx * size * 0.3}px, ${vy * size * 0.3}px)` : "";
          } else {
            const dirs = { up: vy < -0.35, down: vy > 0.35, left: vx < -0.35, right: vx > 0.35 };
            for (const [dir, on] of Object.entries(dirs)) { const k = (keys as any)[dir]; if (on) { if (!this.input.held[k]) this.input.pressed[k] = true; this.input.held[k] = true; } else delete this.input.held[k]; }
            el.dataset.dir = Object.entries(dirs).filter(([, on]) => on).map(([k]) => k).join(" ");
          }
          press(!!e);
        };
        el.onpointerdown = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); if (!el.classList.contains("off")) set(e); };
        el.onpointermove = (e) => { if ((e.buttons || e.pointerType === "touch") && el.classList.contains("on")) set(e); };
        el.onpointerup = el.onpointercancel = () => set(null);
      }
      el.oncontextmenu = (e) => e.preventDefault();
      this.touchEls.set(d.id, { el, def: d }); layer.append(el);
    }
    return layer;
  }
  private touchSet(u: any) {
    const t = this.touchEls.get(u.id); if (!t) return;
    if (typeof u.visible === "boolean") t.el.style.display = u.visible ? "" : "none";
    if (typeof u.disabled === "boolean") t.el.classList.toggle("off", u.disabled);
    if (u.label !== undefined && t.def.type === "button") t.el.textContent = typeof u.label === "object" ? (u.label[this.s.game.lang] ?? u.label.zh ?? "") : String(u.label);
  }

  /** 画布里的视频：第一次画时创建；muted 默认 false（跟随客户端静音），loop 默认 true */
  private videoFor(id: string, o: any): HTMLVideoElement | undefined {
    let v = this.videos.get(id);
    if (!v) {
      const u = this.s.assets.url(`asset:${id}`); if (!u) { this.s.game.clientWarn(`视频素材「${id}」不存在`); return; }
      const el = document.createElement("video"); el.src = u; el.playsInline = true; el.preload = "auto"; el.crossOrigin = "anonymous";
      v = { el, seen: this.clock }; this.videos.set(id, v);
      el.onerror = () => { v!.broken = true; this.s.game.clientWarn(`视频「${id}」无法播放（格式不支持或文件损坏）`); };
    }
    const el = v.el; v.seen = this.clock;
    el.loop = o.loop !== false; el.muted = !!o.muted || this.s.muted();
    if (typeof o.volume === "number") el.volume = Math.max(0, Math.min(1, o.volume));
    if (typeof o.rate === "number") el.playbackRate = Math.max(0.25, Math.min(4, o.rate));
    if (o.paused || this.paused) { if (!el.paused) el.pause(); }
    else if (el.paused && !v.broken && !(el.ended && !el.loop)) el.play().catch(() => { el.muted = true; el.play().catch(() => {}); }); // 不能自动出声时先静音播放
    return el;
  }
  private sweepVideos() { for (const v of this.videos.values()) if (!v.el.paused && this.clock - v.seen > 300) v.el.pause(); }
  private tiledFor(id: string): any {
    if (this.tiledMaps.has(id)) return this.tiledMaps.get(id);
    let m: any = null;
    try { m = this.s.game.tiledMap(id); } catch (e: any) { this.s.game.clientWarn(`地图「${id}」：${e?.message ?? e}`); }
    this.tiledMaps.set(id, m); return m;
  }
  private shaderFor(id: string) {
    if (this.shaders.has(id)) return this.shaders.get(id) ?? undefined;
    const a: any = this.s.assets.meta(`asset:${id}`); let out: { fragment: string; uniforms: Record<string, string> } | null = null;
    if (!a || a.type !== "shader") this.s.game.clientWarn(`着色器「${id}」没有登记（assets 里 type: shader）`);
    else {
      const b = this.s.assets.bytes(`asset:${id}`); const r = buildShader(b ? new TextDecoder().decode(b) : "", a.uniforms ?? {});
      if (r.ok) out = { fragment: r.fragment!, uniforms: r.uniforms }; else this.s.game.clientWarn(`着色器「${id}」没通过检查：${r.errors.join("；")}`);
    }
    this.shaders.set(id, out); return out ?? undefined;
  }

  /** 预加载登记过的图片和声音（显示进度），之后才开始循环，避免开局卡顿和素材“闪现” */
  async preload(onProgress?: (done: number, total: number) => void) {
    const list = this.s.assets.list?.() ?? [];
    this.audio ??= new AudioEngine((id) => this.s.assets.url(`asset:${id}`), (id) => this.s.assets.bytes(`asset:${id}`));
    const jobs = list.filter((a) => a.kind === "image" || a.kind === "audio" || a.kind === "font");
    let done = 0; onProgress?.(0, jobs.length);
    await Promise.all(jobs.map(async (a) => {
      try {
        if (a.kind === "image") { const im = this.image(a.id); if (im && !im.complete) await (im.decode ? im.decode() : new Promise((r) => { im.onload = im.onerror = r; })); }
        else if (a.kind === "font") await this.loadFont(a.id);
        else await this.audio!.load(a.id);
      } catch { /* 坏素材不影响开始 */ }
      onProgress?.(++done, jobs.length);
    }));
  }

  /** 字体素材：以素材 id 为字体名注册，api.draw.text(..., { font: "素材id" }) 即可使用 */
  private async loadFont(id: string) {
    const u = this.s.assets.url(`asset:${id}`); if (!u || typeof FontFace === "undefined") return;
    const f = new FontFace(id, `url(${u})`); await f.load(); (document as any).fonts?.add(f); this.fonts.push(f);
  }

  start() {
    this.running = true;
    const box = h("div", { class: "rt-loading" }, "");
    const host = () => [...this.canvases.values()].find((c) => c.isConnected)?.parentElement;
    const show = (d: number, t: number) => { if (t > 2) { box.textContent = `加载素材 Loading ${d}/${t}`; const p = host(); if (p && !box.isConnected) p.append(box); } };
    void this.preload(show).finally(() => { box.remove(); if (this.running) this.begin(); });
  }
  private begin() {
    const keys: Record<string, string> = (this.s.story.input as any)?.keys ?? {};
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable); };
    const down = (e: KeyboardEvent) => { const k = keys[e.code]; if (!k || typing(e) || this.paused) return; e.preventDefault(); if (!this.input.held[k]) this.input.pressed[k] = true; this.input.held[k] = true; };
    const up = (e: KeyboardEvent) => { const k = keys[e.code]; if (k) delete this.input.held[k]; };
    const blur = () => { this.input.held = {}; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    this.off.push(() => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); });
    // 可用区域尺寸：告诉引擎（api.screen、realtime.on_resize）
    const scr = () => this.s.game.setScreen({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1, takeover: !!(this.s.story.ui as any)?.takeover });
    scr(); window.addEventListener("resize", scr); window.addEventListener("orientationchange", scr);
    this.off.push(() => { window.removeEventListener("resize", scr); window.removeEventListener("orientationchange", scr); });
    this.last = performance.now(); this.acc = 0;
    const f3 = (e: KeyboardEvent) => { if (e.code === "F3") { e.preventDefault(); this.toggleDebug(); } };
    window.addEventListener("keydown", f3); this.off.push(() => window.removeEventListener("keydown", f3));
    if (typeof location !== "undefined" && /[?&]fps\b/.test(location.search)) this.toggleDebug();
    const frame = (now: number) => { this.raf = requestAnimationFrame(frame); this.step(now); };
    this.raf = requestAnimationFrame(frame);
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf); this.raf = 0; this.off.forEach((f) => f()); this.off = [];
    this.audio?.dispose(); this.audio = undefined;
    this.ui.dispose();
    for (const v of this.videos.values()) { v.el.pause(); v.el.removeAttribute("src"); v.el.load(); } this.videos.clear();
    for (const f of this.fonts) (document as any).fonts?.delete(f); this.fonts = [];
    this.dbg?.remove(); this.dbg = undefined;
  }
  /** 作者调试：F3（或网址带 ?fps）显示帧率、每帧耗时、脚本耗时、绘制数量、渲染器类型 */
  toggleDebug() {
    if (this.dbg) { this.dbg.remove(); this.dbg = undefined; return; }
    this.dbg = h("div", { class: "rt-debug" }); document.body.append(this.dbg);
  }
  private updateDebug(now: number) {
    const st = this.stats; st.frames++;
    if (now - st.since < 500) return;
    st.fps = (st.frames * 1000) / (now - st.since); st.frames = 0; st.since = now;
    if (this.dbg) this.dbg.textContent = `${st.fps.toFixed(0)} FPS · 帧 ${st.frameMs.toFixed(1)}ms\ntick ${st.tickMs.toFixed(2)}ms ×${st.ticks} · render ${st.renderMs.toFixed(2)}ms\n绘制 ${st.drawMs.toFixed(2)}ms · ${st.drawn} 个 · ${this.rendererKind ?? "-"} · ${this.hz}Hz${this.interpolate ? " 插值" : ""}`;
  }

  /** 暂停菜单打开时：不推进时间、松开所有按键 */
  paused = false;
  setPaused(p: boolean) { if (p) for (const v of this.videos.values()) v.el.pause(); this.paused = p; this.ui.setPaused(p); this.padHeld.clear(); this.input.held = {}; this.input.pressed = {}; this.input.joystick = { x: 0, y: 0 }; this.input.pointer = { ...this.input.pointer, down: false }; }

  /**
   * 每个显示帧调用一次（跟屏幕刷新率走，通常 60fps 或更高）：
   * 逻辑按 tick_hz 固定步长推进（最多 5 步，防止卡顿后“死亡螺旋”）；
   * 画面每帧都画：精灵动画和粒子按显示帧推进；interpolate 时 render 每帧调用并拿到 api.alpha。
   */
  step(now: number) {
    const g = this.s.game; if (g.ending) { this.stop(); this.s.onFrame(true); return; }
    if (this.paused) { this.last = now; return; }
    const t0 = performance.now(), st = this.stats;
    const dtStep = 1000 / this.hz, frameDt = Math.min(250, Math.max(0, now - this.last));
    this.acc = Math.min(this.acc + frameDt, dtStep * 5); this.last = now; this.clock += frameDt;
    this.pad();
    let ticked = 0;
    while (this.acc >= dtStep) {
      this.acc -= dtStep;
      g.tick(dtStep, this.input); this.input.pressed = {}; this.input.pointer = { ...this.input.pointer, wheel: 0 }; ticked++;
      this.effects();
      const hooks = g.drainHooks(); if (hooks.length) this.s.onHooks(hooks);
      if (g.ending) break;
    }
    const t1 = performance.now();
    if (ticked) { st.tickMs = t1 - t0; st.ticks = ticked; }
    this.applyShake();
    this.draw(!!ticked || this.interpolate, frameDt);
    st.frameMs = performance.now() - t0;
    this.updateDebug(now);
    if (!ticked) return;
    // 页面文字（状态栏、日志）最多每 200ms 刷新一次；状态比较本身也节流，避免每帧序列化整个状态
    if ((now - this.lastSig > 200) || g.ending) {
      this.lastSig = now;
      const sig = JSON.stringify(g.visibleState("player")) + g.log.length;
      const changed = sig !== this.stateSig;
      if ((changed && now - this.lastDom > 200) || g.ending) { this.stateSig = sig; this.lastDom = now; this.s.onFrame(changed); }
    }
  }

  /** 屏幕震动（api.fx.shake）：只移动画面元素，逐渐减弱；纯视觉，不影响逻辑 */
  private applyShake() {
    const left = this.shakeUntil - this.clock;
    for (const v of this.views.values()) {
      if (left > 0) { const k = this.shakeAmt * (left / this.shakeMs); v.el.style.translate = `${(Math.sin(this.clock * 0.09) * k).toFixed(1)}px ${(Math.cos(this.clock * 0.071) * k).toFixed(1)}px`; }
      else if (v.el.style.translate) v.el.style.translate = "";
    }
  }
  /** 手柄：标准布局按键名 Pad0…Pad16 可写进 input.keys；左摇杆（或十字键）驱动 api.input.joystick */
  private pad() {
    const keys: Record<string, string> = (this.s.story.input as any)?.keys ?? {};
    const p = pollGamepad(); if (!p) { if (this.padStick) { this.input.joystick = { x: 0, y: 0 }; this.padStick = false; } return; }
    for (const [code, k] of Object.entries(keys)) {
      if (!code.startsWith("Pad")) continue;
      const on = p.buttons.has(code);
      if (on && !this.padHeld.has(code)) { this.input.pressed[k] = true; this.input.held[k] = true; this.padHeld.add(code); }
      else if (!on && this.padHeld.has(code)) { delete this.input.held[k]; this.padHeld.delete(code); }
    }
    if (p.stick.x || p.stick.y) { this.input.joystick = p.stick; this.padStick = true; }
    else if (this.padStick) { this.input.joystick = { x: 0, y: 0 }; this.padStick = false; }
  }

  /** refresh：重新调用 render 取指令；否则重放上一次的指令（动画、粒子照常推进） */
  draw(refresh = true, frameDt = 1000 / this.hz) {
    const st = this.stats; let renderMs = 0, drawMs = 0, drawn = 0;
    const alpha = this.interpolate ? Math.min(1, this.acc / (1000 / this.hz)) : 0;
    for (const [cid, v] of this.views) {
      if (!v.el.isConnected) continue;
      if (v.fixedDpr === undefined) {
        // 场景切换后画布尺寸可能变了（scenes 里每个场景可以有自己的 width/height）
        const cs = this.s.game.canvasSize(cid);
        if (cs.width !== v.w || cs.height !== v.h) { v.w = cs.width; v.h = cs.height; v.dpr = 0; if (!v.r) { v.el.width = v.w; v.el.height = v.h; } refresh = true; }
      }
      if (refresh) {
        const t = performance.now();
        v.cmds = this.s.game.renderCanvas(cid, alpha);
        v.animated = v.cmds.some((c) => Array.isArray(c) && (c[0] === "particles" || c[0] === "video" || c[0] === "post" || (c[c.length - 1] && typeof c[c.length - 1] === "object" && typeof c[c.length - 1].fps === "number")));
        renderMs += performance.now() - t;
      } else if (!v.animated && !(v.r as any)?.particles?.em.size && v.dpr) continue; // 画面没变，不重画
      const r = this.renderer(v); if (!r) continue;
      const t = performance.now();
      drawn += r.draw(v.cmds, this.clock, frameDt).drawn;
      drawMs += performance.now() - t;
    }
    this.sweepVideos();
    if (refresh) st.renderMs = renderMs;
    if (drawn) { st.drawMs = drawMs; st.drawn = drawn; }
  }
  image(id: string) {
    let im = this.images.get(id);
    if (!im) { const u = this.s.assets.url(`asset:${id}`); if (!u) return; im = new Image(); im.src = u; this.images.set(id, im); }
    return im;
  }

  effects() {
    const e = this.s.game.takeEffects();
    const ui = (e.ui ?? []).filter((u: any) => { if (u.op === "touch.set") { this.touchSet(u); return false; } return true; });
    if (ui.length) this.ui.apply(ui);
    this.audio ??= new AudioEngine((id) => this.s.assets.url(`asset:${id}`), (id) => this.s.assets.bytes(`asset:${id}`));
    this.audio.setMaster(this.s.muted() ? 0 : 1);
    for (const snd of e.sounds) {
      if (snd.op === "stop") { this.audio.stop(snd.id, snd.fade_ms ?? 0); continue; }
      if (snd.op === "listener") { this.audio.listener(snd.x ?? 0, snd.y ?? 0); continue; }
      if (snd.op === "move") { if (snd.id) this.audio.move(snd.id, snd.x ?? 0, snd.y ?? 0); continue; }
      if (this.s.muted() || !snd.id) continue;
      const meta = this.s.assets.meta(`asset:${snd.id}`) ?? {};
      this.audio.play(snd.id, snd, (snd.volume ?? meta.volume ?? 1) * this.s.sfx());
    }
    // AI：不等待，结果回来时交给 realtime.on_ai；游戏循环照常进行
    for (const r of e.ai) {
      const g = this.s.game;
      if (!this.s.llm) { g.deliverAi({ req: r.req, entry: r.entry, error: "没有配置 AI", text: g.entry(r.entry).fallback ?? "" }); continue; }
      runEntry(g, r.entry, this.s.llm, r.input, r.data)
        .then((res) => g.deliverAi({ req: r.req, entry: r.entry, data: res.json, text: res.text, error: res.error }))
        .catch((err) => g.deliverAi({ req: r.req, entry: r.entry, error: String(err?.message ?? err) }));
    }
  }
}
