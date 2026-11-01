// Tiled 地图导入（.tmj / .json，外部图块集 .tsj）：多图层、碰撞层、对象层。纯数据转换，结果可直接交给 api.draw.tilemap。
// 支持：正交地图、CSV/数组格式的图块数据、多个图块集、图层透明度/偏移/可见性、自定义属性。
// 不支持（会报清楚的错误）：无限地图（chunks）、base64 压缩数据、等距/六边形地图。翻转标志位会被忽略（只取图块编号）。
export interface TiledLayer { name: string; kind: "tiles"; visible: boolean; opacity: number; properties: Record<string, any>; tilemaps: any[] }
export interface TiledObject { id: number; name: string; type: string; x: number; y: number; w: number; h: number; rotation: number; point?: boolean; ellipse?: boolean; polygon?: [number, number][]; polyline?: [number, number][]; properties: Record<string, any>; layer: string }
export interface TiledMap { width: number; height: number; tile_w: number; tile_h: number; pixel_w: number; pixel_h: number; properties: Record<string, any>; layers: TiledLayer[]; collision: { x: number; y: number; w: number; h: number }[]; objects: TiledObject[] }

const FLIP = 0x1fffffff;
const props = (p: any): Record<string, any> => { const o: Record<string, any> = {}; if (Array.isArray(p)) for (const x of p.slice(0, 200)) if (x && typeof x.name === "string") o[x.name.slice(0, 60)] = x.value; return o; };
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
function join(dir: string, rel: string) {
  const out: string[] = [];
  for (const seg of (dir + rel).split("/")) { if (seg === "..") out.pop(); else if (seg && seg !== ".") out.push(seg); }
  return out.join("/");
}

/**
 * json：.tmj 内容；mapPath：地图在故事包里的路径；assetByPath：包内路径 → 素材 id（图块集图片要登记为 image 素材）；
 * readText：读包内其他文本文件（外部 .tsj 图块集）
 */
export function parseTiled(json: any, mapPath: string, assetByPath: (p: string) => string | undefined, readText: (p: string) => string | undefined): TiledMap {
  if (!json || typeof json !== "object") throw new Error("不是 Tiled 地图（JSON）");
  if (json.infinite) throw new Error("不支持无限地图（Tiled 地图属性里关掉 Infinite）");
  if (json.orientation && json.orientation !== "orthogonal") throw new Error(`只支持正交地图，这张是 ${json.orientation}`);
  const W = json.width | 0, H = json.height | 0, tw = json.tilewidth | 0, th = json.tileheight | 0;
  if (!(W > 0 && H > 0 && tw > 0 && th > 0) || W * H > 1024 * 1024) throw new Error("地图尺寸不对（最多 1024×1024 格）");
  const dir = dirOf(mapPath);
  // 图块集
  const sets: { first: number; count: number; columns: number; tw: number; th: number; margin: number; spacing: number; asset?: string; solid: Set<number> }[] = [];
  for (const ts0 of Array.isArray(json.tilesets) ? json.tilesets.slice(0, 64) : []) {
    let ts = ts0, tdir = dir;
    if (typeof ts0?.source === "string") {
      const p = join(dir, ts0.source); const txt = readText(p);
      if (txt === undefined) throw new Error(`找不到外部图块集「${p}」（要用 JSON 格式 .tsj 并放进故事包）`);
      try { ts = { ...JSON.parse(txt), firstgid: ts0.firstgid }; } catch { throw new Error(`图块集「${p}」不是 JSON（.tsx 请在 Tiled 里另存为 .tsj）`); }
      tdir = dirOf(p);
    }
    if (!ts.image) throw new Error(`图块集「${ts.name ?? "?"}」不是单张图片（“图片集合”类型的图块集还不支持）`);
    const ip = join(tdir, String(ts.image)), asset = assetByPath(ip);
    const solid = new Set<number>();
    for (const t of Array.isArray(ts.tiles) ? ts.tiles : []) { const pp = props(t.properties); if (pp.collision === true || pp.solid === true || t.objectgroup?.objects?.length) solid.add(t.id | 0); }
    sets.push({ first: ts.firstgid | 0, count: ts.tilecount | 0, columns: Math.max(1, ts.columns | 0), tw: ts.tilewidth | 0 || tw, th: ts.tileheight | 0 || th, margin: ts.margin | 0, spacing: ts.spacing | 0, asset, solid });
  }
  sets.sort((a, b) => a.first - b.first);
  const setOf = (gid: number) => { let s; for (const x of sets) if (gid >= x.first) s = x; return s; };
  const out: TiledMap = { width: W, height: H, tile_w: tw, tile_h: th, pixel_w: W * tw, pixel_h: H * th, properties: props(json.properties), layers: [], collision: [], objects: [] };
  const solidGrid = new Uint8Array(W * H);
  const visit = (layers: any[], ox: number, oy: number, op: number, vis: boolean, collGroup: boolean) => {
    for (const L of Array.isArray(layers) ? layers.slice(0, 256) : []) {
      const lp = props(L.properties), name = String(L.name ?? "").slice(0, 60);
      const lx = ox + (+L.offsetx || 0), ly = oy + (+L.offsety || 0), lo = op * (typeof L.opacity === "number" ? L.opacity : 1), lv = vis && L.visible !== false;
      const coll = collGroup || lp.collision === true || /^(collision|collisions|solid|walls?|碰撞)$/i.test(name);
      if (L.type === "group") { visit(L.layers, lx, ly, lo, lv, coll); continue; }
      if (L.type === "tilelayer") {
        if (L.chunks) throw new Error(`图层「${name}」是无限地图的分块格式，不支持`);
        if (!Array.isArray(L.data)) throw new Error(`图层「${name}」的数据是 ${L.encoding ?? "?"}${L.compression ? "+" + L.compression : ""} 格式；请在 Tiled 里把图块层格式改成 CSV`);
        const lw = L.width | 0 || W, lh = L.height | 0 || H;
        const per = new Map<any, (number | null)[][]>();
        for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
          const raw = Number(L.data[y * lw + x]) || 0, gid = (raw >>> 0) & FLIP; if (!gid) continue;
          const s = setOf(gid); if (!s) continue;
          const local = gid - s.first;
          if ((coll || s.solid.has(local)) && x < W && y < H) solidGrid[y * W + x] = 1;
          if (coll && lp.visible_collision !== true) continue; // 碰撞层默认不画
          let m = per.get(s); if (!m) { m = Array.from({ length: lh }, () => new Array(lw).fill(null)); per.set(s, m); }
          m[y][x] = local;
        }
        const tilemaps = [...per.entries()].map(([s, map]) => ({ tileset: s.asset, tile_size: s.tw, tile_w: s.tw, tile_h: s.th, grid_w: tw, grid_h: th, columns: s.columns, margin: s.margin, spacing: s.spacing, x: lx, y: ly + (th - s.th), alpha: lo, map }));
        if (!coll || lp.visible_collision === true) out.layers.push({ name, kind: "tiles", visible: lv, opacity: lo, properties: lp, tilemaps });
        continue;
      }
      if (L.type === "objectgroup") {
        for (const o of Array.isArray(L.objects) ? L.objects.slice(0, 5000) : []) {
          const ob: TiledObject = { id: o.id | 0, name: String(o.name ?? "").slice(0, 80), type: String(o.type ?? o.class ?? "").slice(0, 80), x: (+o.x || 0) + lx, y: (+o.y || 0) + ly, w: +o.width || 0, h: +o.height || 0, rotation: +o.rotation || 0, properties: props(o.properties), layer: name };
          if (o.point) ob.point = true; if (o.ellipse) ob.ellipse = true;
          if (Array.isArray(o.polygon)) ob.polygon = o.polygon.slice(0, 64).map((p: any) => [+p.x || 0, +p.y || 0]);
          if (Array.isArray(o.polyline)) ob.polyline = o.polyline.slice(0, 64).map((p: any) => [+p.x || 0, +p.y || 0]);
          if (o.gid) { ob.y -= ob.h; (ob as any).gid = ((o.gid >>> 0) & FLIP); }
          const isColl = coll || ob.properties.collision === true || /^(collision|solid|wall)$/i.test(ob.type);
          if (isColl && !ob.point && !ob.polygon && !ob.polyline && ob.w > 0 && ob.h > 0 && !ob.rotation) out.collision.push({ x: ob.x, y: ob.y, w: ob.w, h: ob.h });
          else out.objects.push(ob);
          if (isColl && (ob.polygon || ob.rotation)) out.objects.push(ob);
        }
      }
      // imagelayer：给出图片路径对应的素材，作者自己画
      if (L.type === "imagelayer") out.objects.push({ id: 0, name, type: "imagelayer", x: lx, y: ly, w: 0, h: 0, rotation: 0, properties: { ...lp, asset: assetByPath(join(dir, String(L.image ?? ""))) }, layer: name });
    }
  };
  visit(json.layers, 0, 0, 1, true, false);
  // 碰撞格子合并成矩形（先横向合并，再把同宽的行竖向合并），减少物体数量
  const rows: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!solidGrid[y * W + x]) { x++; continue; } const x0 = x; while (x < W && solidGrid[y * W + x]) x++; rows.push({ x: x0, y, w: x - x0, h: 1 }); } }
  const merged: typeof rows = [];
  for (const r of rows) { const up = merged.find((m) => m.x === r.x && m.w === r.w && m.y + m.h === r.y); if (up) up.h++; else merged.push({ ...r }); }
  for (const m of merged) out.collision.push({ x: m.x * tw, y: m.y * th, w: m.w * tw, h: m.h * th });
  return out;
}
