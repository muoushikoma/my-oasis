// 把 render 函数给出的绘制指令翻译成后端调用（WebGL 和 Canvas2D 共用同一套语义）
import { num, clamp01, parseColor, blendOf, spriteFrame, lerpColor, ParticleField, type RGBA, type Blend, type ImageSource } from "./common";
import { tiledTile, type TiledMap } from "@my-oasis/schema";

export type Mat = [number, number, number, number, number, number]; // a b c d e f（同 canvas setTransform）
export const I: Mat = [1, 0, 0, 1, 0, 0];
export const mul = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** 每个精灵自己的片元着色器（WebGL 才有；Canvas2D 忽略） */
export interface SpriteFx { shader: string; uniforms: Record<string, any> }
/** 绘制时还需要的外部数据：Tiled 地图、视频元素、画布可见区域（用于地图裁剪） */
export interface WalkExtras { tiled?(id: string): TiledMap | undefined; video?(id: string): HTMLVideoElement | undefined; view?: { w: number; h: number } }
export interface TextStyle { size: number; font: string; bold: boolean; color: string; align: "left" | "center" | "right"; glow?: { color: string; size: number }; stroke?: { color: string; width: number } }
export interface Backend {
  begin(): void;
  clear(color: RGBA | null): void;
  rect(m: Mat, w: number, h: number, c: RGBA, blend: Blend, stroke: number): void;
  circle(m: Mat, r: number, c: RGBA, blend: Blend, stroke: number, glow: number): void;
  line(m: Mat, x1: number, y1: number, x2: number, y2: number, c: RGBA, width: number, blend: Blend): void;
  image(m: Mat, im: HTMLImageElement | ImageBitmap | HTMLVideoElement, sx: number, sy: number, sw: number, sh: number, w: number, h: number, tint: RGBA, blend: Blend, smooth: boolean, fx?: SpriteFx): void;
  text(m: Mat, s: string, st: TextStyle, alpha: number, blend: Blend): void;
  end(): void;
}
export const imgW = (im: any) => im.videoWidth ?? im.naturalWidth ?? im.width, imgH = (im: any) => im.videoHeight ?? im.naturalHeight ?? im.height;
const ready = (im: any) => !!im && (im.readyState === undefined || im.readyState >= 2) && (im.complete === undefined || im.complete) && imgW(im) > 0;
const fxOf = (o: any): SpriteFx | undefined => (typeof o.shader === "string" && o.shader ? { shader: o.shader, uniforms: o.uniforms && typeof o.uniforms === "object" ? o.uniforms : {} } : undefined);
/** 九宫格切片：一个数，或 [上, 右, 下, 左] */
export function sliceOf(v: any): [number, number, number, number] {
  const a = Array.isArray(v) ? v : [v, v, v, v];
  const q = (x: any) => Math.max(0, Math.min(4096, num(x, 0)));
  return [q(a[0]), q(a[1] ?? a[0]), q(a[2] ?? a[0]), q(a[3] ?? a[1] ?? a[0])];
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

export function walk(b: Backend, cmds: any[], img: ImageSource, particles: ParticleField, timeMs: number, smooth: boolean, ex: WalkExtras = {}): number {
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
        b.image(objMat(base, num(c[2]), num(c[3]), w, h, o), im!, f.sx, f.sy, f.sw, f.sh, w, h, [t[0], t[1], t[2], t[3] * alpha], blend, smooth && !o.pixelated, fxOf(o));
        break;
      }
      case "video": {
        // [id, x, y, w?, h?, o]：当前视频帧当作图片画
        const v = ex.video?.(String(c[1])); if (!ready(v)) break;
        const w = c[4] != null ? num(c[4]) : imgW(v), h = c[5] != null ? num(c[5]) : imgH(v);
        const t = o.tint ? parseColor(o.tint) : ([1, 1, 1, 1] as RGBA);
        b.image(objMat(base, num(c[2]), num(c[3]), w, h, o), v!, 0, 0, imgW(v), imgH(v), w, h, [t[0], t[1], t[2], t[3] * alpha], blend, smooth, fxOf(o));
        break;
      }
      case "nine": {
        // [id, x, y, w, h, { slice, sx?, sy?, sw?, sh? }]：四角原样，四边单向拉伸，中间双向拉伸
        const im = img(String(c[1])); if (!ready(im)) break;
        const W = Math.max(0, num(c[4])), H = Math.max(0, num(c[5]));
        const [st, sr, sb, sl] = sliceOf(o.slice ?? 8), k = Math.max(0.01, num(o.slice_scale, 1));
        const ox = num(o.sx), oy = num(o.sy), iw = num(o.sw, imgW(im) - ox), ih = num(o.sh, imgH(im) - oy);
        const m = objMat(base, num(c[2]), num(c[3]), W, H, o), t = o.tint ? parseColor(o.tint) : ([1, 1, 1, 1] as RGBA), col: RGBA = [t[0], t[1], t[2], t[3] * alpha];
        let dl = sl * k, dr = sr * k, dt = st * k, db = sb * k;
        if (dl + dr > W) { const f = W / (dl + dr); dl *= f; dr *= f; } if (dt + db > H) { const f = H / (dt + db); dt *= f; db *= f; }
        const xs = [0, sl, iw - sr, iw], ys = [0, st, ih - sb, ih], dx = [0, dl, W - dr, W], dy = [0, dt, H - db, H];
        for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) {
          const sw = xs[q + 1] - xs[q], sh = ys[r + 1] - ys[r], dw = dx[q + 1] - dx[q], dh = dy[r + 1] - dy[r];
          if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
          b.image(mul(m, [1, 0, 0, 1, dx[q], dy[r]]), im!, ox + xs[q], oy + ys[r], sw, sh, dw, dh, col, blend, smooth);
        }
        n += 8; break;
      }
      case "tiled": {
        // [id, { x?, y?, layers?: [图层名], scale? }]：只画可见的图块层；镜头不旋转时只画屏幕里的格子
        const map = ex.tiled?.(String(c[1])); if (!map) break;
        const ox = num(o.x), oy = num(o.y), want: string[] | null = Array.isArray(o.layers) ? o.layers.map(String) : null;
        const m0 = mul(base, [1, 0, 0, 1, ox, oy]);
        const view = ex.view, noRot = m0[1] === 0 && m0[2] === 0 && m0[0] > 0 && m0[3] > 0;
        for (const l of map.layers) {
          if (l.type !== "tiles" || (want ? !want.includes(l.name) : !l.visible)) continue;
          const la = alpha * l.opacity; if (la <= 0) continue;
          const tw = map.tile_w, th = map.tile_h;
          let x0 = 0, y0 = 0, x1 = l.width, y1 = l.height;
          if (view && noRot) {
            const sx = m0[0], sy = m0[3], tx = m0[4] + l.offset_x * sx, ty = m0[5] + l.offset_y * sy;
            x0 = Math.max(0, Math.floor(-tx / (tw * sx)) - 1); x1 = Math.min(l.width, Math.ceil((view.w - tx) / (tw * sx)) + 1);
            y0 = Math.max(0, Math.floor(-ty / (th * sy)) - 1); y1 = Math.min(l.height, Math.ceil((view.h - ty) / (th * sy)) + 1);
          }
          const col: RGBA = [1, 1, 1, la];
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const g = l.data[y * l.width + x]; if (!g) continue;
            const t = tiledTile(map, g); if (!t || !t.ts.asset) continue;
            const im = img(t.ts.asset); if (!ready(im)) continue;
            const w = t.ts.tile_w, h = t.ts.tile_h;
            // 图块比格子高时底部对齐（Tiled 的规则）
            let mm = mul(m0, [1, 0, 0, 1, l.offset_x + x * tw, l.offset_y + y * th + th - h]);
            // Tiled：先对角翻转（转置），再水平、竖直翻转
            if (t.flipV) mm = mul(mm, [1, 0, 0, -1, 0, h]);
            if (t.flipH) mm = mul(mm, [-1, 0, 0, 1, w, 0]);
            if (t.flipD) mm = mul(mm, [0, 1, 1, 0, 0, 0]);
            b.image(mm, im!, t.sx, t.sy, w, h, w, h, col, "normal", smooth);
            n++;
          }
        }
        break;
      }
      case "post": n--; break; // 后期处理由渲染器在整帧画完后执行
      case "tilemap": {
        const t: any = c[1] ?? {}; const ts = Math.max(1, num(t.tile_size, 16)), cols = Math.max(1, num(t.columns, 1));
        const im = t.tileset ? img(String(t.tileset)) : undefined, ok = ready(im);
        const rows: any[] = Array.isArray(t.map) ? t.map : [];
        const colors: Record<string, string> = t.colors ?? {};
        const ox = num(t.x), oy = num(t.y), white: RGBA = [1, 1, 1, 1];
        for (let y = 0; y < rows.length && y < 1024; y++) {
          const row = typeof rows[y] === "string" ? [...rows[y]] : rows[y]; if (!Array.isArray(row)) continue;
          for (let x = 0; x < row.length && x < 1024; x++) {
            const v = row[x];
            if (v === null || v === undefined || v === -1 || v === "." || v === " ") continue;
            const m: Mat = mul(cam, [1, 0, 0, 1, ox + x * ts, oy + y * ts]);
            const cc = colors[String(v)]; if (cc) { b.rect(m, ts, ts, parseColor(cc), "normal", 0); continue; }
            const i = Number(v); if (!ok || !isFinite(i) || i < 0) continue;
            b.image(m, im!, (i % cols) * ts, Math.floor(i / cols) * ts, ts, ts, ts, ts, white, "normal", smooth);
          }
        }
        break;
      }
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
