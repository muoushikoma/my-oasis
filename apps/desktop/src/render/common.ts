// 渲染器共用：颜色解析、选项读取、精灵帧计算、粒子系统（纯视觉，不影响故事状态）
export type RGBA = [number, number, number, number];
export const num = (v: any, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const colorCache = new Map<string, RGBA>();
let probe: CanvasRenderingContext2D | null | undefined;
/** CSS 颜色 → [r,g,b,a]（0..1），带缓存 */
export function parseColor(c: any, fallback: RGBA = [1, 1, 1, 1]): RGBA {
  if (typeof c !== "string" || !c) return fallback;
  const hit = colorCache.get(c); if (hit) return hit;
  let out: RGBA | undefined;
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (m) {
    let s = m[1];
    if (s.length === 3 || s.length === 4) s = [...s].map((x) => x + x).join("");
    if (s.length === 6 || s.length === 8) out = [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255, s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1];
  }
  if (!out) {
    const r = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c.trim());
    if (r) out = [+r[1] / 255, +r[2] / 255, +r[3] / 255, r[4] === undefined ? 1 : r[4].endsWith("%") ? parseFloat(r[4]) / 100 : +r[4]];
  }
  if (!out) {
    // 颜色名、hsl() 等：交给浏览器解析
    if (probe === undefined) probe = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (probe) { probe.fillStyle = "#000"; probe.fillStyle = c; const v = String(probe.fillStyle); if (v !== c) out = parseColor(v, fallback); }
  }
  out ??= fallback;
  if (colorCache.size > 2000) colorCache.clear();
  colorCache.set(c, out); return out;
}

export type Blend = "normal" | "add" | "multiply" | "screen";
export const blendOf = (o: any): Blend => (["add", "multiply", "screen"].includes(o?.blend) ? o.blend : "normal");

/** 精灵表：按 frame_w/frame_h 切帧；frame 指定帧号，或用 fps 按时间自动播放 */
export function spriteFrame(o: any, iw: number, ih: number, timeMs: number) {
  const fw = num(o.frame_w, 0), fh = num(o.frame_h, 0);
  if (!(fw > 0 && fh > 0)) return { sx: num(o.sx), sy: num(o.sy), sw: num(o.sw, iw), sh: num(o.sh, ih) };
  const cols = Math.max(1, Math.floor(iw / fw)), total = Math.max(1, cols * Math.max(1, Math.floor(ih / fh)));
  const start = Math.max(0, Math.floor(num(o.start, 0))), count = Math.max(1, Math.floor(num(o.frames, total - start)));
  let i: number;
  if (typeof o.frame === "number") i = Math.floor(o.frame);
  else if (num(o.fps) > 0) { const k = Math.floor((timeMs / 1000) * o.fps); i = o.loop === false ? Math.min(k, count - 1) : k % count; }
  else i = 0;
  i = start + ((i % count) + count) % count;
  return { sx: num(o.ox) + (i % cols) * fw, sy: num(o.oy) + Math.floor(i / cols) * fh, sw: fw, sh: fh };
}

// ---------- 粒子 ----------
export interface Particle { x: number; y: number; vx: number; vy: number; age: number; life: number; size0: number; size1: number; rot: number; vr: number }
export class Emitter {
  ps: Particle[] = []; acc = 0; seen = -1; lastSeq: any = undefined; o: any = {}; x = 0; y = 0;
  update(dt: number, active: boolean) {
    const o = this.o, max = Math.min(3000, Math.max(1, num(o.max, 500)));
    if (active) {
      const rate = Math.max(0, num(o.rate, 0));
      this.acc += (rate * dt) / 1000;
      let n = Math.floor(this.acc); this.acc -= n;
      if (o.burst && o.seq !== this.lastSeq) { n += Math.max(0, Math.floor(num(o.burst))); this.lastSeq = o.seq; }
      for (let k = 0; k < n && this.ps.length < max; k++) this.spawn();
    }
    const g = num(o.gravity, 0), drag = num(o.drag, 0), s = dt / 1000;
    let w = 0;
    for (const p of this.ps) {
      p.age += dt; if (p.age >= p.life) continue;
      p.vy += g * s; if (drag) { const f = Math.max(0, 1 - drag * s); p.vx *= f; p.vy *= f; }
      p.x += p.vx * s; p.y += p.vy * s; p.rot += p.vr * s;
      this.ps[w++] = p;
    }
    this.ps.length = w;
  }
  spawn() {
    const o = this.o, deg = Math.PI / 180;
    const a = (num(o.angle, -90) + (Math.random() - 0.5) * num(o.spread, 360)) * deg;
    const sp = num(o.speed, 60) * (1 - num(o.speed_var, 0.3) * Math.random());
    const life = Math.max(16, num(o.life_ms, 800) * (1 - num(o.life_var, 0.3) * Math.random()));
    const r = num(o.radius, 0) * Math.sqrt(Math.random()), ra = Math.random() * Math.PI * 2;
    this.ps.push({ x: this.x + Math.cos(ra) * r, y: this.y + Math.sin(ra) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life, size0: num(o.size, 4), size1: num(o.end_size, num(o.size, 4)), rot: Math.random() * Math.PI * 2, vr: num(o.spin, 0) * deg * (Math.random() - 0.5) * 2 });
  }
}
/** 所有发射器：每帧根据 render 里出现的 particles 指令更新；指令消失后剩余粒子自然消散 */
export class ParticleField {
  em = new Map<string, Emitter>(); frame = 0;
  touch(key: string, x: number, y: number, o: any) {
    let e = this.em.get(key); if (!e) { e = new Emitter(); this.em.set(key, e); if (this.em.size > 64) this.em.delete(this.em.keys().next().value!); }
    e.x = x; e.y = y; e.o = o; e.seen = this.frame; return e;
  }
  /** 推进全部发射器（每个显示帧一次） */
  advance(dt: number) {
    for (const [k, e] of this.em) { e.update(dt, e.seen === this.frame); if (e.seen !== this.frame && !e.ps.length) this.em.delete(k); }
    this.frame++;
  }
  clear() { this.em.clear(); }
}
export const lerpColor = (a: RGBA, b: RGBA, t: number): RGBA => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];

export interface Renderer {
  readonly kind: "webgl" | "canvas2d";
  /** 画一帧：cmds 是 render 函数最近一次给出的指令；timeMs 是显示时钟（驱动精灵动画） */
  draw(cmds: any[], timeMs: number, dtMs: number): { drawn: number };
  resize(w: number, h: number, dpr: number): void;
  dispose(): void;
}
export type ImageSource = (id: string) => HTMLImageElement | ImageBitmap | undefined;
