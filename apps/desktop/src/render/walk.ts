// 把 render 函数给出的绘制指令翻译成后端调用（WebGL 和 Canvas2D 共用同一套语义）
import { num, clamp01, parseColor, blendOf, spriteFrame, lerpColor, ParticleField, type RGBA, type Blend, type ImageSource } from "./common";

export type Mat = [number, number, number, number, number, number]; // a b c d e f（同 canvas setTransform）
export const I: Mat = [1, 0, 0, 1, 0, 0];
export const mul = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

export interface TextStyle { size: number; font: string; bold: boolean; color: string; align: "left" | "center" | "right"; glow?: { color: string; size: number }; stroke?: { color: string; width: number } }
export interface Backend {
  begin(): void;
  clear(color: RGBA | null): void;
  rect(m: Mat, w: number, h: number, c: RGBA, blend: Blend, stroke: number): void;
  circle(m: Mat, r: number, c: RGBA, blend: Blend, stroke: number, glow: number): void;
  line(m: Mat, x1: number, y1: number, x2: number, y2: number, c: RGBA, width: number, blend: Blend): void;
  image(m: Mat, im: HTMLImageElement | ImageBitmap, sx: number, sy: number, sw: number, sh: number, w: number, h: number, tint: RGBA, blend: Blend, smooth: boolean): void;
  text(m: Mat, s: string, st: TextStyle, alpha: number, blend: Blend): void;
  end(): void;
}
const imgW = (im: any) => im.videoWidth || im.naturalWidth || im.width || 0, imgH = (im: any) => im.videoHeight || im.naturalHeight || im.height || 0;
const ready = (im: any) => !!im && (im.complete === undefined || im.complete) && (im.readyState === undefined || im.readyState >= 2) && imgW(im) > 0;
/** 绘制时用到的其他资源：画布里的视频、解析好的 Tiled 地图 */
export interface DrawResources { video?(id: string, o: any): HTMLVideoElement | undefined; tiled?(id: string): any }

/** 图块地图：tile_size（正方形）或 tile_w/tile_h；grid_w/grid_h 是格子间距（默认等于图块尺寸）；margin/spacing 同 Tiled 图块集 */
function drawTilemap(b: Backend, cam: Mat, t: any, img: ImageSource, smooth: boolean, alpha: number, dx = 0, dy = 0) {
  const ts = Math.max(1, num(t.tile_size, 16)), tw = Math.max(1, num(t.tile_w, ts)), th = Math.max(1, num(t.tile_h, ts));
  const gw = Math.max(1, num(t.grid_w, tw)), gh = Math.max(1, num(t.grid_h, th)), cols = Math.max(1, num(t.columns, 1));
  const margin = Math.max(0, num(t.margin, 0)), spacing = Math.max(0, num(t.spacing, 0));
  const im = t.tileset ? img(String(t.tileset)) : undefined, ok = ready(im);
  const rows: any[] = Array.isArray(t.map) ? t.map : [];
  const colors: Record<string, string> = t.colors ?? {};
  const ox = num(t.x) + dx, oy = num(t.y) + dy, a = clamp01(num(t.alpha, 1) * alpha), white: RGBA = [1, 1, 1, a];
  let n = 0;
  for (let y = 0; y < rows.length && y < 1024; y++) {
    const row = typeof rows[y] === "string" ? [...rows[y]] : rows[y]; if (!Array.isArray(row)) continue;
    for (let x = 0; x < row.length && x < 1024; x++) {
      const v = row[x];
      if (v === null || v === undefined || v === -1 || v === "." || v === " ") continue;
      const m: Mat = mul(cam, [1, 0, 0, 1, ox + x * gw, oy + y * gh]);
      const cc = colors[String(v)]; if (cc) { const k = parseColor(cc); b.rect(m, gw, gh, [k[0], k[1], k[2], k[3] * a], "normal", 0); n++; continue; }
      const i = Number(v); if (!ok || !isFinite(i) || i < 0) continue;
      b.image(m, im!, margin + (i % cols) * (tw + spacing), margin + Math.floor(i / cols) * (th + spacing), tw, th, tw, th, white, "normal", smooth); n++;
    }
  }
  return n;
}
/** 九宫格图片：四个角不拉伸，边和中间拉伸。slice: 数字或 [上, 右, 下, 左]（原图像素，顺序同 CSS）；border: 显示的边框大小（默认等于 slice） */
function drawNine(b: Backend, m: Mat, im: any, w: number, h: number, o: any, tint: RGBA, blend: Blend, smooth: boolean) {
  const iw = imgW(im), ih = imgH(im);
  const sl = Array.isArray(o.slice) ? o.slice : [o.slice, o.slice, o.slice, o.slice];
  const [t, r, bt, l] = [0, 1, 2, 3].map((i) => Math.max(0, num(sl[i], num(sl[0], 8))));
  const bd = o.border === undefined ? [t, r, bt, l] : (Array.isArray(o.border) ? o.border : [o.border, o.border, o.border, o.border]).map((v: any) => Math.max(0, num(v, 0)));
  const k = Math.min(1, w / Math.max(1e-6, bd[1] + bd[3]), h / Math.max(1e-6, bd[0] + bd[2])); // 目标太小时等比缩小边框
  const T = bd[0] * k, R = bd[1] * k, B = bd[2] * k, L = bd[3] * k;
  const sx = [0, l, iw - r, iw], sy = [0, t, ih - bt, ih], dx = [0, L, w - R, w], dy = [0, T, h - B, h];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const sw = sx[i + 1] - sx[i], sh = sy[j + 1] - sy[j], dw = dx[i + 1] - dx[i], dh = dy[j + 1] - dy[j];
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
    if (i === 1 && j === 1 && o.center === false) continue;
    b.image(mul(m, [1, 0, 0, 1, dx[i], dy[j]]), im, sx[i], sy[j], sw, sh, dw, dh, tint, blend, smooth);
  }
}

/** 物体变换：位置 (x,y) 是锚点所在处；rotation（弧度）、scale / scale_x / scale_y、anchor_x / anchor_y（0~1）、flip_x / flip_y */
function objMat(base: Mat, x: number, y: number, w: number, h: number, o: any): Mat {
  const rot = num(o.rotation), s = num(o.scale, 1), sx = num(o.scale_x, 1) * s, sy = num(o.scale_y, 1) * s;
  const ax = num(o.anchor_x, 0) * w, ay = num(o.anchor_y, 0) * h;
  let m = mul(base, [1, 0, 0, 1, x, y]);
  if (rot) { const c = Math.cos(rot), sn = Math.sin(rot); m = mul(m, [c, sn, -sn, c, 0, 0]); }
  if (sx !== 1 || sy !== 1) m = mul(m, [sx, 0, 0, sy, 0, 0]);
  if (ax || ay) m = mul(m, [1, 0, 0, 1, -ax, -ay]);
  if (o.flip_x) m = mul(m, [-1, 0, 0, 1, w, 0]);
  if (o.flip_y) m = mul(m, [1, 0, 0, -1, 0, h]);
  return m;
}

export function walk(b: Backend, cmds: any[], img: ImageSource, particles: ParticleField, timeMs: number, smooth: boolean, res: DrawResources = {}): number {
  let cam: Mat = I; let n = 0;
  b.begin();
  // 图层：选项里写 z（数字，越大越靠前）就按 z 排序；z 相同保持原顺序。camera / clear 指令视为 z 跟随所在位置
  if (cmds.some((c) => Array.isArray(c) && typeof c[c.length - 1]?.z === "number")) {
    let lastZ = 0;
    cmds = cmds.map((c, i) => { const z = Array.isArray(c) && typeof c[c.length - 1]?.z === "number" ? c[c.length - 1].z : (c?.[0] === "camera" || c?.[0] === "clear") ? -Infinity : lastZ; if (isFinite(z)) lastZ = z; return { c, z, i }; })
      .sort((a, b) => (a.z === b.z ? a.i - b.i : a.z - b.z)).map((x) => x.c);
  }
  for (const c of cmds) {
    if (!Array.isArray(c)) continue;
    const last = c[c.length - 1];
    const o: any = (typeof last === "object" && last && !Array.isArray(last)) ? last : {};
    const alpha = clamp01(num(o.alpha, 1)), blend = blendOf(o), base = o.fixed ? I : cam;
    const col = (v: any) => { const k = parseColor(v); return alpha === 1 ? k : [k[0], k[1], k[2], k[3] * alpha] as RGBA; };
    n++;
    switch (c[0]) {
      case "clear": b.clear(c[1] ? parseColor(c[1]) : null); break;
      case "camera": {
        // [x, y, zoom, { rotation, center_x, center_y }]：rotation 绕 (center_x, center_y)（画面坐标）旋转
        const z = num(c[3], 1) || 1, co: any = (c[4] && typeof c[4] === "object") ? c[4] : {};
        cam = [z, 0, 0, z, -num(c[1]) * z, -num(c[2]) * z];
        const rot = num(co.rotation); if (rot) { const cx = num(co.center_x), cy = num(co.center_y), cs = Math.cos(rot), sn = Math.sin(rot); cam = mul(mul(mul([1, 0, 0, 1, cx, cy], [cs, sn, -sn, cs, 0, 0]), [1, 0, 0, 1, -cx, -cy]), cam); }
        break;
      }
      case "rect": { const w = num(c[3]), h = num(c[4]); b.rect(objMat(base, num(c[1]), num(c[2]), w, h, o), w, h, col(c[5]), blend, o.stroke ? num(o.width, 1) : 0); break; }
      case "circle": { const r = Math.max(0, num(c[3])); const m = objMat(base, num(c[1]), num(c[2]), 0, 0, o);
        if (o.glow) { const g = typeof o.glow === "object" ? o.glow : {}; const gc = col(g.color ?? c[4]); b.circle(m, r + num(g.size, r), [gc[0], gc[1], gc[2], gc[3] * 0.6], "add", 0, 1); }
        b.circle(m, r, col(c[4]), blend, o.stroke ? num(o.width, 1) : 0, 0); break; }
      case "line": b.line(cam, num(c[1]), num(c[2]), num(c[3]), num(c[4]), col(c[5]), num(c[6], 1), "normal"); break;
      case "text": {
        const st: TextStyle = { size: Math.max(1, Math.min(512, num(o.size, 14))), font: typeof o.font === "string" ? o.font : "sans-serif", bold: !!o.bold, color: String(o.color ?? "#fff"), align: (["left", "center", "right"].includes(o.align) ? o.align : "left") };
        if (o.glow) { const g = typeof o.glow === "object" ? o.glow : {}; st.glow = { color: String(g.color ?? st.color), size: num(g.size, 8) }; }
        if (o.outline) { const g = typeof o.outline === "object" ? o.outline : {}; st.stroke = { color: String(g.color ?? "#000"), width: num(g.width, 2) }; }
        b.text(objMat(base, num(c[2]), num(c[3]), 0, 0, { ...o, anchor_x: 0, anchor_y: 0 }), String(c[1]).slice(0, 500), st, alpha, blend); break;
      }
      case "image": case "sprite": {
        // image: [id, x, y, w, h, o]；sprite: [id, x, y, o]
        const im = img(String(c[1])); if (!ready(im)) break;
        const f = spriteFrame(o, imgW(im), imgH(im), timeMs);
        const w = c[0] === "image" && c[4] != null ? num(c[4]) : num(o.w, f.sw), h = c[0] === "image" && c[5] != null ? num(c[5]) : num(o.h, f.sh);
        const t = o.tint ? parseColor(o.tint) : ([1, 1, 1, 1] as RGBA);
        b.image(objMat(base, num(c[2]), num(c[3]), w, h, o), im!, f.sx, f.sy, f.sw, f.sh, w, h, [t[0], t[1], t[2], t[3] * alpha], blend, smooth && !o.pixelated);
        break;
      }
      case "tilemap": n += drawTilemap(b, cam, c[1] ?? {}, img, smooth, alpha) - 1; break;
      case "tiled": {
        // [id, { layers?: [名字], x, y }]：画 Tiled 地图里可见的图块层（碰撞层默认不画）
        const map = res.tiled?.(String(c[1])); if (!map) break;
        const want: string[] | undefined = Array.isArray(o.layers) ? o.layers.map(String) : undefined;
        for (const L of map.layers ?? []) {
          if (want ? !want.includes(L.name) : !L.visible) continue;
          for (const t of L.tilemaps ?? []) n += drawTilemap(b, base, t, img, smooth, alpha, num(o.x), num(o.y));
        }
        n--; break;
      }
      case "video": {
        // [id, x, y, w, h, o]：视频画进画布（作为纹理），上面还能继续画别的
        const v = res.video?.(String(c[1]), o); if (!ready(v)) break;
        const w = c[4] != null ? num(c[4]) : imgW(v), h = c[5] != null ? num(c[5]) : imgH(v);
        const t = o.tint ? parseColor(o.tint) : ([1, 1, 1, 1] as RGBA);
        b.image(objMat(base, num(c[2]), num(c[3]), w, h, o), v as any, 0, 0, imgW(v), imgH(v), w, h, [t[0], t[1], t[2], t[3] * alpha], blend, smooth);
        break;
      }
      case "nine": {
        const im = img(String(c[1])); if (!ready(im)) break;
        const w = num(c[4]), h = num(c[5]), t = o.tint ? parseColor(o.tint) : ([1, 1, 1, 1] as RGBA);
        drawNine(b, objMat(base, num(c[2]), num(c[3]), w, h, o), im, w, h, o, [t[0], t[1], t[2], t[3] * alpha], blend, smooth && !o.pixelated);
        break;
      }
      case "post": n--; break; // 后期着色器：由渲染器在整帧画完后处理
      case "particles": {
        // [key, x, y, o]：发射器在客户端模拟，纯视觉
        const e = particles.touch(String(c[1]), num(c[2]), num(c[3]), o);
        const c0 = parseColor(o.color ?? "#fff"), c1 = o.end_color ? parseColor(o.end_color) : ([c0[0], c0[1], c0[2], 0] as RGBA);
        const pim = o.image ? img(String(o.image)) : undefined, pok = ready(pim), pb: Blend = o.blend ? blend : "add";
        for (const p of e.ps) {
          const t = p.age / p.life, k = lerpColor(c0, c1, t), sz = p.size0 + (p.size1 - p.size0) * t; k[3] *= alpha;
          if (pok) { const m = mul(mul(mul(base, [1, 0, 0, 1, p.x, p.y]), [Math.cos(p.rot), Math.sin(p.rot), -Math.sin(p.rot), Math.cos(p.rot), 0, 0]), [1, 0, 0, 1, -sz / 2, -sz / 2]); b.image(m, pim!, 0, 0, imgW(pim), imgH(pim), sz, sz, k, pb, smooth); }
          else b.circle(mul(base, [1, 0, 0, 1, p.x, p.y]), sz / 2, k, pb, 0, o.soft === false ? 0 : 1);
        }
        n += e.ps.length;
        break;
      }
      default: n--;
    }
  }
  b.end();
  return n;
}
