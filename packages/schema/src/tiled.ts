// Tiled 地图（.tmj，JSON 格式）导入：只做纯数据整理，引擎、客户端和校验器共用。
// 支持：正交地图、多个图块层/对象层/图层组、内嵌图块集、多图块集、翻转标记、CSV 或 base64（含 zlib/gzip 压缩）数据。
// 碰撞：图块层或对象层带自定义属性 collision: true（或名字里有 collision / collide / solid）就算碰撞层。
import { unzlibSync, gunzipSync } from "fflate";

export interface TiledTileset { name: string; firstgid: number; image?: string; asset?: string; tile_w: number; tile_h: number; columns: number; count: number; margin: number; spacing: number; image_w: number; image_h: number }
export interface TiledTileLayer { type: "tiles"; name: string; visible: boolean; opacity: number; offset_x: number; offset_y: number; collision: boolean; width: number; height: number; data: number[]; properties: Record<string, any> }
export interface TiledObject { id: number; name: string; type: string; x: number; y: number; w: number; h: number; rotation: number; gid?: number; ellipse?: boolean; point?: boolean; polygon?: { x: number; y: number }[]; polyline?: { x: number; y: number }[]; properties: Record<string, any> }
export interface TiledObjectLayer { type: "objects"; name: string; visible: boolean; opacity: number; offset_x: number; offset_y: number; collision: boolean; objects: TiledObject[]; properties: Record<string, any> }
export interface TiledMap { width: number; height: number; tile_w: number; tile_h: number; layers: (TiledTileLayer | TiledObjectLayer)[]; tilesets: TiledTileset[]; properties: Record<string, any>; background?: string }

export const TILED_FLIP_H = 0x80000000, TILED_FLIP_V = 0x40000000, TILED_FLIP_D = 0x20000000;
export const TILED_GID_MASK = 0x1fffffff;
const MAX_TILES = 4_000_000, MAX_OBJECTS = 20_000;

const props = (p: any): Record<string, any> => {
  const o: Record<string, any> = {};
  if (Array.isArray(p)) for (const x of p.slice(0, 200)) if (x && typeof x.name === "string") o[x.name.slice(0, 80)] = typeof x.value === "string" ? x.value.slice(0, 2000) : x.value;
  return o;
};
const isCollision = (name: string, pr: Record<string, any>) => pr.collision === true || pr.collision === "true" || (pr.collision === undefined && /collision|collide|solid|碰撞/i.test(name));
const n = (v: any, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);

function decodeData(l: any, count: number): number[] {
  if (Array.isArray(l.data)) return l.data.slice(0, count).map((x: any) => (typeof x === "number" ? x >>> 0 : 0));
  if (typeof l.data === "string" && l.encoding === "base64") {
    const bin = atob(l.data.replace(/\s+/g, ""));
    let bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (l.compression === "zlib") bytes = unzlibSync(bytes);
    else if (l.compression === "gzip") bytes = gunzipSync(bytes);
    else if (l.compression) throw new Error(`不支持的压缩方式「${l.compression}」（请在 Tiled 里选 CSV、Base64、zlib 或 gzip）`);
    const out: number[] = []; const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i + 3 < bytes.length && out.length < count; i += 4) out.push(dv.getUint32(i, true));
    return out;
  }
  throw new Error(`图层「${l.name}」的数据格式看不懂`);
}

/**
 * 解析 .tmj。mapPath 是地图在包里的路径（用来解析图块集图片的相对路径）。
 * resolveImage(包内路径, 图块集名) → 图片素材 id（找不到返回 undefined）。
 * 出错时抛出带中文说明的 Error。
 */
export function parseTiled(text: string, mapPath = "", resolveImage: (path: string, name: string) => string | undefined = () => undefined): TiledMap {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error("地图文件不是合法的 JSON（请在 Tiled 里另存为 .tmj）"); }
  if (!j || typeof j !== "object") throw new Error("地图文件是空的");
  if (j.orientation && j.orientation !== "orthogonal") throw new Error(`只支持正交（orthogonal）地图，这张是「${j.orientation}」`);
  if (j.infinite) throw new Error("不支持无限地图（infinite），请在 Tiled 的地图属性里关掉“无限”");
  const W = Math.floor(n(j.width)), H = Math.floor(n(j.height)), tw = Math.floor(n(j.tilewidth)), th = Math.floor(n(j.tileheight));
  if (!(W > 0 && H > 0 && tw > 0 && th > 0)) throw new Error("地图缺少 width / height / tilewidth / tileheight");
  if (W * H > MAX_TILES) throw new Error(`地图太大（${W}×${H}），最多 ${MAX_TILES} 格`);
  const dir = mapPath.includes("/") ? mapPath.slice(0, mapPath.lastIndexOf("/") + 1) : "";
  const join = (p: string) => { const parts = (dir + p).split("/"); const out: string[] = []; for (const x of parts) { if (x === "..") out.pop(); else if (x && x !== ".") out.push(x); } return out.join("/"); };
  const tilesets: TiledTileset[] = [];
  for (const ts of Array.isArray(j.tilesets) ? j.tilesets.slice(0, 64) : []) {
    if (ts?.source) throw new Error(`图块集「${ts.source}」是外部文件，请在 Tiled 里把图块集“嵌入地图”（Embed Tileset）`);
    const name = String(ts?.name ?? "").slice(0, 80);
    const image = typeof ts?.image === "string" ? join(ts.image) : undefined;
    if (!image && Array.isArray(ts?.tiles) && ts.tiles.some((t: any) => t?.image)) throw new Error(`图块集「${name}」是“图片集合”类型，暂不支持，请改成一整张图`);
    const tsw = Math.floor(n(ts?.tilewidth, tw)), tsh = Math.floor(n(ts?.tileheight, th));
    tilesets.push({ name, firstgid: Math.floor(n(ts?.firstgid, 1)), image, asset: image ? resolveImage(image, name) : undefined, tile_w: tsw, tile_h: tsh,
      columns: Math.max(1, Math.floor(n(ts?.columns, 1))), count: Math.floor(n(ts?.tilecount)), margin: n(ts?.margin), spacing: n(ts?.spacing), image_w: n(ts?.imagewidth), image_h: n(ts?.imageheight) });
  }
  tilesets.sort((a, b) => a.firstgid - b.firstgid);
  const layers: (TiledTileLayer | TiledObjectLayer)[] = [];
  let objCount = 0;
  const walk = (list: any[], ox: number, oy: number, op: number, vis: boolean, depth: number) => {
    if (depth > 8) return;
    for (const l of Array.isArray(list) ? list.slice(0, 256) : []) {
      if (!l || typeof l !== "object") continue;
      const name = String(l.name ?? "").slice(0, 80), pr = props(l.properties);
      const lx = ox + n(l.offsetx) + n(l.x) * tw, ly = oy + n(l.offsety) + n(l.y) * th, lo = op * n(l.opacity, 1), lv = vis && l.visible !== false;
      if (l.type === "group") { walk(l.layers, lx, ly, lo, lv, depth + 1); continue; }
      if (l.type === "tilelayer") {
        if (l.chunks) throw new Error(`图层「${name}」是分块数据（无限地图），不支持`);
        const lw = Math.floor(n(l.width, W)), lh = Math.floor(n(l.height, H));
        layers.push({ type: "tiles", name, visible: lv, opacity: lo, offset_x: lx, offset_y: ly, collision: isCollision(name, pr), width: lw, height: lh, data: decodeData(l, lw * lh), properties: pr });
      } else if (l.type === "objectgroup") {
        const objects: TiledObject[] = [];
        for (const o of Array.isArray(l.objects) ? l.objects : []) {
          if (++objCount > MAX_OBJECTS) throw new Error(`对象太多（最多 ${MAX_OBJECTS} 个）`);
          const pts = (a: any) => (Array.isArray(a) ? a.slice(0, 256).map((p: any) => ({ x: n(p?.x), y: n(p?.y) })) : undefined);
          const ob: TiledObject = { id: Math.floor(n(o?.id)), name: String(o?.name ?? "").slice(0, 80), type: String(o?.type ?? o?.class ?? "").slice(0, 80), x: n(o?.x) + lx, y: n(o?.y) + ly, w: n(o?.width), h: n(o?.height), rotation: n(o?.rotation), properties: props(o?.properties) };
          if (typeof o?.gid === "number") ob.gid = o.gid >>> 0;
          if (o?.ellipse) ob.ellipse = true; if (o?.point) ob.point = true;
          if (o?.polygon) ob.polygon = pts(o.polygon); if (o?.polyline) ob.polyline = pts(o.polyline);
          objects.push(ob);
        }
        layers.push({ type: "objects", name, visible: lv, opacity: lo, offset_x: lx, offset_y: ly, collision: isCollision(name, pr), objects, properties: pr });
      }
      // imagelayer 暂不支持：忽略
    }
  };
  walk(j.layers, 0, 0, 1, true, 0);
  return { width: W, height: H, tile_w: tw, tile_h: th, layers, tilesets, properties: props(j.properties), background: typeof j.backgroundcolor === "string" ? j.backgroundcolor.slice(0, 12) : undefined };
}

/** 找到 gid 所在的图块集与图块在图里的位置 */
export function tiledTile(map: TiledMap, gidRaw: number): { ts: TiledTileset; sx: number; sy: number; flipH: boolean; flipV: boolean; flipD: boolean } | null {
  const gid = gidRaw & TILED_GID_MASK; if (!gid) return null;
  let ts: TiledTileset | undefined;
  for (const t of map.tilesets) { if (t.firstgid <= gid) ts = t; else break; }
  if (!ts) return null;
  const i = gid - ts.firstgid; if (ts.count && i >= ts.count) return null;
  return { ts, sx: ts.margin + (i % ts.columns) * (ts.tile_w + ts.spacing), sy: ts.margin + Math.floor(i / ts.columns) * (ts.tile_h + ts.spacing), flipH: !!(gidRaw & TILED_FLIP_H), flipV: !!(gidRaw & TILED_FLIP_V), flipD: !!(gidRaw & TILED_FLIP_D) };
}

/** 碰撞矩形：碰撞图块层里每一行连续的非空格子合并成一个矩形；碰撞对象层里的矩形对象原样给出，多边形给出 points */
export function tiledSolids(map: TiledMap): { x: number; y: number; w: number; h: number; points?: { x: number; y: number }[]; name?: string; type?: string }[] {
  const out: { x: number; y: number; w: number; h: number; points?: { x: number; y: number }[]; name?: string; type?: string }[] = [];
  for (const l of map.layers) {
    if (!l.collision) continue;
    if (l.type === "tiles") {
      for (let y = 0; y < l.height; y++) {
        let start = -1;
        for (let x = 0; x <= l.width; x++) {
          const v = x < l.width ? l.data[y * l.width + x] & TILED_GID_MASK : 0;
          if (v && start < 0) start = x;
          else if (!v && start >= 0) { out.push({ x: l.offset_x + start * map.tile_w, y: l.offset_y + y * map.tile_h, w: (x - start) * map.tile_w, h: map.tile_h }); start = -1; }
          if (out.length > 50_000) return out;
        }
      }
    } else {
      for (const o of l.objects) {
        if (o.point) continue;
        if (o.polygon) out.push({ x: o.x, y: o.y, w: 0, h: 0, points: o.polygon.map((p) => ({ x: o.x + p.x, y: o.y + p.y })), name: o.name, type: o.type });
        else if (o.w > 0 && o.h > 0) out.push({ x: o.x, y: o.y, w: o.w, h: o.h, name: o.name, type: o.type });
      }
    }
  }
  return out;
}
