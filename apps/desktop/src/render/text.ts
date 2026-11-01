// 文字缓存：同一段文字 + 样式只栅格化一次（离屏 canvas），WebGL 当纹理用、Canvas2D 直接 drawImage
import type { TextStyle } from "./walk";
export interface TextBitmap { canvas: HTMLCanvasElement; w: number; h: number; ox: number; oy: number; key: string; used: number; scale: number }
export class TextCache {
  private map = new Map<string, TextBitmap>(); frame = 0;
  constructor(private max = 400, public onEvict?: (t: TextBitmap) => void) {}
  get(s: string, st: TextStyle, scale: number): TextBitmap {
    const key = `${s}\u0000${st.size}|${st.font}|${st.bold}|${st.color}|${st.align}|${st.glow?.color}|${st.glow?.size}|${st.stroke?.color}|${st.stroke?.width}|${scale}`;
    let t = this.map.get(key);
    if (t) { t.used = this.frame; return t; }
    const font = `${st.bold ? "bold " : ""}${st.size * scale}px ${st.font}`;
    const cv = document.createElement("canvas"), ctx = cv.getContext("2d")!;
    ctx.font = font;
    const pad = Math.ceil(((st.glow?.size ?? 0) + (st.stroke?.width ?? 0)) * scale) + 2;
    const tw = Math.ceil(ctx.measureText(s).width), th = Math.ceil(st.size * scale * 1.3);
    cv.width = Math.max(1, Math.min(4096, tw + pad * 2)); cv.height = Math.max(1, Math.min(4096, th + pad * 2));
    ctx.font = font; ctx.textBaseline = "top"; ctx.textAlign = "left";
    if (st.glow) { ctx.shadowColor = st.glow.color; ctx.shadowBlur = st.glow.size * scale; }
    if (st.stroke) { ctx.lineJoin = "round"; ctx.strokeStyle = st.stroke.color; ctx.lineWidth = st.stroke.width * 2 * scale; ctx.strokeText(s, pad, pad); }
    ctx.fillStyle = st.color; ctx.fillText(s, pad, pad);
    if (st.glow) { ctx.shadowBlur = 0; ctx.fillText(s, pad, pad); }
    const lw = tw / scale;
    t = { canvas: cv, w: cv.width / scale, h: cv.height / scale, ox: -pad / scale - (st.align === "center" ? lw / 2 : st.align === "right" ? lw : 0), oy: -pad / scale, key, used: this.frame, scale };
    this.map.set(key, t);
    if (this.map.size > this.max) {
      // 淘汰最久没用到的四分之一
      const old = [...this.map.values()].sort((a, b) => a.used - b.used).slice(0, this.max >> 2);
      for (const o of old) { this.map.delete(o.key); this.onEvict?.(o); }
    }
    return t;
  }
  clear() { for (const t of this.map.values()) this.onEvict?.(t); this.map.clear(); }
}
