// Canvas2D 后备渲染器：设备不支持 WebGL 时使用（tint 和自定义着色器在这里不生效，其余效果一致）
import { walk, type Backend, type Mat, type WalkExtras } from "./walk";
import { ParticleField, type Renderer, type ImageSource, type RGBA, type Blend } from "./common";
import { TextCache } from "./text";

const OP: Record<Blend, GlobalCompositeOperation> = { normal: "source-over", add: "lighter", multiply: "multiply", screen: "screen" };
const css = (c: RGBA) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`;

export class Canvas2DRenderer implements Renderer, Backend {
  readonly kind = "canvas2d" as const;
  private ctx: CanvasRenderingContext2D; private dpr = 1; private W = 0; private H = 0;
  private texts = new TextCache(300); particles = new ParticleField();
  constructor(private el: HTMLCanvasElement, private img: ImageSource, private pixelated = false, private extras: WalkExtras = {}) { this.ctx = el.getContext("2d")!; }
  resize(w: number, h: number, dpr: number) { this.W = w; this.H = h; this.dpr = dpr; }
  draw(cmds: any[], timeMs: number, dtMs: number) {
    this.particles.advance(dtMs); this.texts.frame++;
    return { drawn: walk(this, cmds, this.img, this.particles, timeMs, !this.pixelated, { ...this.extras, view: { w: this.W, h: this.H } }) };
  }
  private set(m: Mat, c: RGBA | null, blend: Blend) {
    const d = this.dpr, x = this.ctx;
    x.setTransform(m[0] * d, m[1] * d, m[2] * d, m[3] * d, m[4] * d, m[5] * d);
    x.globalCompositeOperation = OP[blend]; x.globalAlpha = c ? c[3] : 1;
  }
  begin() { const x = this.ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, this.el.width, this.el.height); x.imageSmoothingEnabled = !this.pixelated; }
  clear(c: RGBA | null) { const x = this.ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; if (c) { x.fillStyle = css(c); x.fillRect(0, 0, this.el.width, this.el.height); } else x.clearRect(0, 0, this.el.width, this.el.height); }
  rect(m: Mat, w: number, h: number, c: RGBA, b: Blend, stroke: number) {
    this.set(m, c, b); const x = this.ctx; const k = css([c[0], c[1], c[2], 1]);
    if (stroke) { x.strokeStyle = k; x.lineWidth = stroke; x.strokeRect(0, 0, w, h); } else { x.fillStyle = k; x.fillRect(0, 0, w, h); }
  }
  circle(m: Mat, r: number, c: RGBA, b: Blend, stroke: number, soft: number) {
    this.set(m, c, b); const x = this.ctx; const k = css([c[0], c[1], c[2], 1]);
    if (soft) { const g = x.createRadialGradient(0, 0, 0, 0, 0, Math.max(0.01, r)); g.addColorStop(0, k); g.addColorStop(1, css([c[0], c[1], c[2], 0])); x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill(); return; }
    x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2);
    if (stroke) { x.strokeStyle = k; x.lineWidth = stroke; x.stroke(); } else { x.fillStyle = k; x.fill(); }
  }
  line(m: Mat, x1: number, y1: number, x2: number, y2: number, c: RGBA, w: number, b: Blend) {
    this.set(m, c, b); const x = this.ctx; x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.strokeStyle = css([c[0], c[1], c[2], 1]); x.lineWidth = w; x.stroke();
  }
  image(m: Mat, im: any, sx: number, sy: number, sw: number, sh: number, w: number, h: number, t: RGBA, b: Blend) {
    this.set(m, t, b); this.ctx.drawImage(im, sx, sy, sw, sh, 0, 0, w, h);
  }
  text(m: Mat, s: string, st: any, alpha: number, b: Blend) {
    const t = this.texts.get(s, st, Math.max(1, this.dpr * Math.hypot(m[0], m[1])));
    this.set(m, [1, 1, 1, alpha], b); this.ctx.drawImage(t.canvas, t.ox, t.oy, t.w, t.h);
  }
  end() { const x = this.ctx; x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.setTransform(1, 0, 0, 1, 0, 0); }
  dispose() { this.texts.clear(); this.particles.clear(); }
}
