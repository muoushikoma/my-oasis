// oasis/0.4 实时循环（客户端）：按 tick_hz 推进引擎、收集键盘/触摸/摇杆输入、把绘制指令画到 canvas、播放声音、异步跑 AI。
import { runEntry, type Game, type DrawCmd } from "@my-oasis/engine";
import type { Story, InputState } from "@my-oasis/schema";
import { h } from "./dom";
import type { AssetBox } from "./assets";
import type { LLM } from "@my-oasis/engine";

export interface RtHost {
  game: Game; story: Story; assets: AssetBox; llm?: LLM;
  muted(): boolean; sfx(): number;
  onFrame(changed: boolean): void; // 每帧之后（节流的 DOM 刷新、结局处理由页面决定）
  onHooks(hooks: string[]): void;
}

/** 把绘制指令画到 2D 画布上（导出给测试/截图用） */
export function paint(ctx: CanvasRenderingContext2D, cmds: DrawCmd[], img: (id: string) => HTMLImageElement | undefined) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  let cam = { x: 0, y: 0, zoom: 1 };
  const apply = (fixed?: boolean) => fixed ? ctx.setTransform(1, 0, 0, 1, 0, 0) : ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  const n = (v: any, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);
  for (const c of cmds) {
    if (!Array.isArray(c)) continue;
    const o: any = (typeof c[c.length - 1] === "object" && c[c.length - 1]) || {};
    ctx.globalAlpha = Math.max(0, Math.min(1, n(o.alpha, 1)));
    switch (c[0]) {
      case "clear": ctx.setTransform(1, 0, 0, 1, 0, 0); if (c[1]) { ctx.fillStyle = String(c[1]); ctx.fillRect(0, 0, W, H); } else ctx.clearRect(0, 0, W, H); break;
      case "camera": cam = { x: n(c[1]), y: n(c[2]), zoom: n(c[3], 1) || 1 }; break;
      case "rect": apply(o.fixed); if (o.stroke) { ctx.strokeStyle = String(c[5]); ctx.lineWidth = n(o.width, 1); ctx.strokeRect(n(c[1]), n(c[2]), n(c[3]), n(c[4])); } else { ctx.fillStyle = String(c[5]); ctx.fillRect(n(c[1]), n(c[2]), n(c[3]), n(c[4])); } break;
      case "circle": apply(o.fixed); ctx.beginPath(); ctx.arc(n(c[1]), n(c[2]), Math.max(0, n(c[3])), 0, Math.PI * 2);
        if (o.stroke) { ctx.strokeStyle = String(c[4]); ctx.lineWidth = n(o.width, 1); ctx.stroke(); } else { ctx.fillStyle = String(c[4]); ctx.fill(); } break;
      case "line": apply(false); ctx.beginPath(); ctx.moveTo(n(c[1]), n(c[2])); ctx.lineTo(n(c[3]), n(c[4])); ctx.strokeStyle = String(c[5]); ctx.lineWidth = n(c[6], 1); ctx.stroke(); break;
      case "text": apply(o.fixed); ctx.fillStyle = String(o.color ?? "#fff"); ctx.font = `${o.bold ? "bold " : ""}${n(o.size, 14)}px ${o.font ?? "sans-serif"}`;
        ctx.textAlign = (["left", "center", "right"].includes(o.align) ? o.align : "left"); ctx.textBaseline = "top"; ctx.fillText(String(c[1]).slice(0, 500), n(c[2]), n(c[3])); break;
      case "image": {
        const im = img(String(c[1])); if (!im?.complete || !im.naturalWidth) break;
        apply(o.fixed);
        const sw = n(o.sw, im.naturalWidth), sh = n(o.sh, im.naturalHeight), w = c[4] ?? sw, hh = c[5] ?? sh;
        ctx.save(); ctx.translate(n(c[2]) + (o.flip_x ? n(w) : 0), n(c[3])); if (o.flip_x) ctx.scale(-1, 1);
        ctx.drawImage(im, n(o.sx), n(o.sy), sw, sh, 0, 0, n(w), n(hh)); ctx.restore(); break;
      }
      case "tilemap": {
        const t: any = c[1] ?? {}; const ts = Math.max(1, n(t.tile_size, 16)), cols = Math.max(1, n(t.columns, 1));
        const im = t.tileset ? img(String(t.tileset)) : undefined;
        const rows: any[][] = Array.isArray(t.map) ? t.map.map((r: any) => (typeof r === "string" ? [...r] : r)) : [];
        const colors: Record<string, string> = t.colors ?? {};
        apply(false);
        rows.forEach((row, y) => row?.forEach?.((v: any, x: number) => {
          const px = n(t.x) + x * ts, py = n(t.y) + y * ts;
          if (v === null || v === undefined || v === -1 || v === "." || v === " ") return;
          if (colors[String(v)]) { ctx.fillStyle = colors[String(v)]; ctx.fillRect(px, py, ts, ts); return; }
          const i = Number(v); if (!im?.complete || !isFinite(i) || i < 0) return;
          ctx.drawImage(im, (i % cols) * ts, Math.floor(i / cols) * ts, ts, ts, px, py, ts, ts);
        }));
        break;
      }
    }
  }
  ctx.globalAlpha = 1; ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export class RealtimeDriver {
  canvases = new Map<string, HTMLCanvasElement>();
  controls?: HTMLElement;
  private raf = 0; private last = 0; private acc = 0; private lastDom = 0; private stateSig = "";
  private input: InputState = { held: {}, pressed: {}, joystick: { x: 0, y: 0 }, pointer: { x: 0, y: 0, down: false } };
  private images = new Map<string, HTMLImageElement>();
  private loops = new Map<string, HTMLAudioElement>();
  private off: (() => void)[] = [];
  constructor(private s: RtHost) {}

  get hz() { return Math.max(1, Math.min(60, this.s.story.realtime?.tick_hz ?? 30)); }

  canvas(cid: string, c: any): HTMLCanvasElement {
    let el = this.canvases.get(cid);
    if (!el) {
      el = h("canvas", { width: c.width ?? 320, height: c.height ?? 240, class: "rt-canvas", "data-canvas": cid, tabindex: 0, style: { imageRendering: c.pixelated ? "pixelated" : "auto" } });
      const pos = (e: PointerEvent) => { const r = el!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * el!.width, y: ((e.clientY - r.top) / r.height) * el!.height }; };
      el.onpointerdown = (e) => { el!.setPointerCapture?.(e.pointerId); this.input.pointer = { ...pos(e), down: true, target: cid }; this.input.pressed.pointer = true; };
      el.onpointermove = (e) => { this.input.pointer = { ...this.input.pointer, ...pos(e), target: cid }; };
      el.onpointerup = el.onpointercancel = (e) => { this.input.pointer = { ...pos(e), down: false, target: cid }; };
      this.canvases.set(cid, el);
    }
    return el;
  }

  /** 屏幕上的虚拟摇杆和按钮（触摸设备；桌面上也可以用鼠标点） */
  controlsEl(): HTMLElement | null {
    const inp: any = this.s.story.input; if (!inp || (!inp.joystick && !inp.buttons?.length)) return null;
    if (this.controls) return this.controls;
    const wrap = h("div", { class: "rt-controls" });
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

  start() {
    const keys: Record<string, string> = (this.s.story.input as any)?.keys ?? {};
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable); };
    const down = (e: KeyboardEvent) => { const k = keys[e.code]; if (!k || typing(e)) return; e.preventDefault(); if (!this.input.held[k]) this.input.pressed[k] = true; this.input.held[k] = true; };
    const up = (e: KeyboardEvent) => { const k = keys[e.code]; if (k) delete this.input.held[k]; };
    const blur = () => { this.input.held = {}; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    this.off.push(() => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); });
    this.last = performance.now(); this.acc = 0;
    const frame = (now: number) => { this.raf = requestAnimationFrame(frame); this.step(now); };
    this.raf = requestAnimationFrame(frame);
  }
  stop() {
    cancelAnimationFrame(this.raf); this.raf = 0; this.off.forEach((f) => f()); this.off = [];
    for (const a of this.loops.values()) a.pause(); this.loops.clear();
  }

  /** 推进若干固定步长（最多 5 步，防止卡顿后“死亡螺旋”） */
  step(now: number) {
    const g = this.s.game; if (g.ending) { this.stop(); this.s.onFrame(true); return; }
    const dtStep = 1000 / this.hz;
    this.acc = Math.min(this.acc + (now - this.last), dtStep * 5); this.last = now;
    let ticked = false;
    while (this.acc >= dtStep) {
      this.acc -= dtStep;
      g.tick(dtStep, this.input); this.input.pressed = {}; ticked = true;
      this.effects();
      const hooks = g.drainHooks(); if (hooks.length) this.s.onHooks(hooks);
      if (g.ending) break;
    }
    if (!ticked) return;
    this.draw();
    const sig = JSON.stringify(g.visibleState("player")) + g.log.length;
    const changed = sig !== this.stateSig;
    if ((changed && now - this.lastDom > 200) || g.ending) { this.stateSig = sig; this.lastDom = now; this.s.onFrame(changed); }
  }

  draw() {
    for (const [cid, el] of this.canvases) {
      if (!el.isConnected) continue;
      const ctx = el.getContext("2d"); if (!ctx) continue;
      ctx.imageSmoothingEnabled = !(this.s.story.ui?.components as any)?.[cid]?.pixelated;
      paint(ctx, this.s.game.renderCanvas(cid), (id) => this.image(id));
    }
  }
  image(id: string) {
    let im = this.images.get(id);
    if (!im) { const u = this.s.assets.url(`asset:${id}`); if (!u) return; im = new Image(); im.src = u; this.images.set(id, im); }
    return im;
  }

  effects() {
    const e = this.s.game.takeEffects();
    for (const snd of e.sounds) {
      if (snd.op === "stop") { for (const [id, a] of this.loops) if (snd.id === null || snd.id === id) { a.pause(); this.loops.delete(id); } continue; }
      if (this.s.muted() || !snd.id) continue;
      const u = this.s.assets.url(`asset:${snd.id}`); if (!u) continue;
      const meta = this.s.assets.meta(`asset:${snd.id}`) ?? {};
      const a = new Audio(u); a.volume = Math.max(0, Math.min(1, (snd.volume ?? meta.volume ?? 1) * this.s.sfx())); a.loop = !!(snd.loop ?? false);
      if (a.loop) { this.loops.get(snd.id)?.pause(); this.loops.set(snd.id, a); }
      a.play().catch(() => {});
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
