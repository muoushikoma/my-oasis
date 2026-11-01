// 雪线 · 区域地图生成与校验（由 build/split.py 从 gen_src.js 生成，请改源文件）
// 雪线 · 生成与校验（gen.js）
// 职责：接住 AI 的输出（世界 / 区域 / 建筑 / 叙事），按《AI 生成规范》校验、截断、补足，
// 再光栅化成可玩的图块地图；AI 失败或超时时用程序生成兜底。玩家永远不会因为 AI 卡关。
// 本文件只在生成时运行（低频），实时循环见 tick.js，画面见 draw.js。

// ───────── 图块编号（与 assets/ground.png、objects.png、roofs.png 对应） ─────────
const G = { snow: 0, deep: 1, ice: 2, thin: 3, forest: 4, rockg: 5, road_h: 6, road_v: 7, rail_h: 8, rail_v: 9, water: 10, road_x: 11, dirt: 12, tracks: 13, snow2: 15,
  f_wood: 16, f_stone: 17, f_tile: 18, f_dirt: 19, f_metal: 20, f_carpet: 21, f_snow: 22 };

const FLOOR = { wood: G.f_wood, stone: G.f_stone, tile: G.f_tile, dirt: G.f_dirt, metal: G.f_metal, carpet: G.f_carpet };

const O = { pine: 32, pine_dark: 33, dead_tree: 34, bush: 35, rock: 36, log_pile: 37, boulder: 38, birch: 39, drift: 40, cliff: 43, carcass: 44, car: 45, stump: 46 };

const OPEN_H = { door: 16, door_open: 17, door_locked: 18, window: 19, window_broken: 20, breach: 21 };

const OPEN_V = { door: 24, door_open: 25, door_locked: 26, window: 27, window_broken: 28, breach: 29 };

const W_ = 64, H_ = 48; // 区域尺寸（格）

// ───────── 小工具 ─────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

const r2 = (v) => Math.round(v * 100) / 100;
// 本地伪随机（每次调用开头从引擎取一次种子，结果仍按种子可复现；避免几千次跨沙箱调用）

let _s = 1;

function seedFrom(api) { _s = api.random.int(1, 2147483646) >>> 0; }

function rnd() { _s = (_s + 0x6d2b79f5) >>> 0; let t = _s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

function ri(api, a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

function pick(api, l) { return l[Math.floor(rnd() * l.length)]; }

function chance(api, p) { return rnd() < p; }

function parseLoose(t) {
  if (!t || typeof t !== "string") return null;
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}

const str = (v, n) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, n);

function reach(links, from) {
  const d = { [from]: 0 }, q = [from];
  while (q.length) { const a = q.shift(); for (const l of links) { const b = l[0] === a ? l[1] : l[1] === a ? l[0] : null; if (b && d[b] === undefined) { d[b] = d[a] + 1; q.push(b); } } }
  return d;
}

// ───────── 保存/读取关卡（当前区域 ↔ 缓存） ─────────
const enc = (rows) => rows.map((r) => r.map((v) => (v < 0 ? " " : String.fromCharCode(48 + v))).join(""));

const dec = (rows) => rows.map((s) => Array.from(s, (ch) => (ch === " " ? -1 : ch.charCodeAt(0) - 48)));
// 当前区域：lvl（碰撞、物件、建筑表，tick 每帧读）+ here（图块层，只给画面读）；其他区域存在 c_<区域id>

function getLevel(api, rid) {
  const cur = api.state.get("lvl");
  if (cur && cur.rid === rid) {
    const here = api.state.get("here");
    return Object.assign({}, cur, { g: here.g, o: here.o, c: cur.c.map((s) => s.split("")) });
  }
  const R = api.state.get("c_" + rid);
  if (!R || !R.g) return null;
  return Object.assign({}, R, { g: dec(R.g), o: dec(R.o), c: R.c.map((s) => s.split("")) });
}

function metaOf(rid, L) { return { rid, w: L.w, h: L.h, ix: L.ix, gi: L.gi, ex: L.ex, sp: L.sp, start: L.start, budget: L.budget, desc: L.desc, place: L.place || [], bld: L.bld, c: L.c.map((r) => r.join("")) }; }

function putLevel(api, rid, L) {
  const cur = api.state.get("lvl");
  if (cur && cur.rid === rid) {
    api.state.set("lvl", metaOf(rid, L));
    api.state.set("here", { rid, w: L.w, h: L.h, g: L.g, o: L.o });
  } else api.state.set("c_" + rid, Object.assign(metaOf(rid, L), { g: enc(L.g), o: enc(L.o) }));
}

// ───────── AI 请求的组织 ─────────
// aiq: { pend: { 请求号: {k, id, t} }, want: [{k, id}], done: { 'region:r2': true, ... } }
function queue(api, k, id) {
  const q = api.state.get("aiq");
  const key = k + ":" + id;
  if (q.done[key] || q.want.some((w) => w.k + ":" + w.id === key) || Object.values(q.pend).some((p) => p.k + ":" + p.id === key)) return;
  q.want.push({ k, id });
  api.state.set("aiq", q);
}

// 世界生成完成后：写入状态、初始化玩家、排队生成起点区域

function depthMulOf(world, rid) { const d = reach(world.links, world.start)[rid] || 0; return clamp(1 - 0.15 * d, 0.4, 1); }

function itemDefs(api) { return api.state.get("defs") || {}; }

const BTYPES = ["小屋", "木屋", "农舍", "教堂", "车站", "水坝控制室", "瞭望塔", "仓库", "营地帐篷", "货运车厢", "残骸", "无线电站"];

const OBJ_HOME = { radio_desk: "无线电站", control_panel: "水坝控制室", altar: "教堂", desk: "小屋", workbench: "仓库", fireplace: "木屋", stove: "小屋", bed: "小屋", bookshelf: "木屋", safe: "车站" };

// ───────── 区域层：光栅化 ─────────
function blankLevel(rid) {
  const g = [], o = [], c = [];
  for (let y = 0; y < H_; y++) { g.push(new Array(W_).fill(G.snow)); o.push(new Array(W_).fill(-1)); c.push(new Array(W_).fill(".")); }
  return { rid, w: W_, h: H_, g, o, c, bld: [], ix: [], gi: [], ex: [], sp: [], start: null, budget: { kcal: 0, water: 0, matches: 0 }, desc: "" };
}

const inb = (x, y) => x >= 0 && y >= 0 && x < W_ && y < H_;

function setT(L, x, y, g, o, c) { if (!inb(x, y)) return; if (g !== null && g !== undefined) L.g[y][x] = g; if (o !== null && o !== undefined) L.o[y][x] = o; if (c) L.c[y][x] = c; }

function polyCells(pts, cb) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= n; s++) cb(Math.round(x0 + ((x1 - x0) * s) / n), Math.round(y0 + ((y1 - y0) * s) / n), Math.abs(x1 - x0) >= Math.abs(y1 - y0));
  }
}

function pts(v) { return (Array.isArray(v) ? v : []).slice(0, 12).map((p) => [clamp(Math.round(num(p && p[0], 0)), 0, W_ - 1), clamp(Math.round(num(p && p[1], 0)), 0, H_ - 1)]); }

function buildRegion(api, rid, j, world) {
  const R = world.regions[rid];
  const L = blankLevel(rid);
  L.desc = str(j && j.desc, 100) || R.desc;
  const defs = itemDefs(api);
  // 底色：零星变化
  for (let k = 0; k < 180; k++) L.g[Math.floor(rnd() * H_)][Math.floor(rnd() * W_)] = k & 1 ? G.snow2 : G.tracks;
  const feats = Array.isArray(j && j.f) ? j.f.slice(0, 24) : [];
  for (const f of feats) {
    if (!f) continue;
    const cx = clamp(Math.round(num(f.x, 32)), 0, W_ - 1), cy = clamp(Math.round(num(f.y, 24)), 0, H_ - 1);
    if (f.t === "forest") {
      const r = clamp(num(f.r, 6), 2, 14), d = clamp(num(f.d, 0.45), 0.1, 0.8);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (!inb(x, y) || Math.hypot(x - cx, y - cy) > r) continue;
        L.g[y][x] = G.forest;
        if (chance(api, d * 0.55)) { L.o[y][x] = pick(api, [O.pine, O.pine, O.pine_dark, O.birch, O.pine]); L.c[y][x] = "#"; }
        else if (chance(api, 0.03)) { L.o[y][x] = O.dead_tree; L.c[y][x] = "#"; L.ix.push({ k: "wood", t: "dead_tree", x, y, w: 1, h: 1, n: ri(api, 2, 4) }); }
      }
    } else if (f.t === "lake") {
      const rx = clamp(num(f.rx, 8), 3, 18), ry = clamp(num(f.ry, 5), 2, 12), thin = clamp(num(f.thin, 0.15), 0, 0.4);
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
        if (!inb(x, y)) continue; const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2; if (e > 1) continue;
        const isThin = e < thin * 2.2 && chance(api, 0.7);
        setT(L, x, y, isThin ? G.thin : G.ice, -1, isThin ? "t" : "i");
      }
    } else if (f.t === "deep") {
      const r = clamp(num(f.r, 4), 2, 10);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inb(x, y) && Math.hypot(x - cx, y - cy) <= r && L.c[y][x] === ".") { L.g[y][x] = G.deep; L.c[y][x] = "d"; if (chance(api, 0.04)) L.o[y][x] = O.drift; }
    } else if (f.t === "rocks") {
      const r = clamp(num(f.r, 4), 2, 10);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (!inb(x, y) || Math.hypot(x - cx, y - cy) > r) continue;
        L.g[y][x] = G.rockg;
        if (chance(api, 0.18)) { L.o[y][x] = chance(api, 0.5) ? O.rock : O.boulder; L.c[y][x] = "#"; }
      }
    } else if (f.t === "river") {
      const w = clamp(Math.round(num(f.w, 2)), 1, 3);
      polyCells(pts(f.p), (x, y, hz) => { for (let k = 0; k < w; k++) { const xx = hz ? x : x + k, yy = hz ? y + k : y; setT(L, xx, yy, G.water, -1, "w"); } });
    } else if (f.t === "cliff") {
      polyCells(pts(f.p), (x, y) => setT(L, x, y, G.rockg, O.cliff, "#"));
    }
  }
  // 道路和铁轨最后画（可以跨河当桥）
  for (const f of feats) {
    if (!f || (f.t !== "road" && f.t !== "rail")) continue;
    polyCells(pts(f.p), (x, y, hz) => {
      if (!inb(x, y)) return;
      const cur = L.g[y][x];
      const t = f.t === "road" ? (cur === G.road_h || cur === G.road_v ? G.road_x : hz ? G.road_h : G.road_v) : hz ? G.rail_h : G.rail_v;
      setT(L, x, y, t, -1, "r");
    });
  }
  // 建筑
  const bl = Array.isArray(j && j.b) ? j.b.slice(0, 6) : [];
  const want = R.nb;
  let bi = 0;
  const placeB = (b) => {
    const w = clamp(Math.round(num(b.w, 9)), 6, 16), h = clamp(Math.round(num(b.h, 7)), 5, 12);
    let x = clamp(Math.round(num(b.x, 10)), 2, W_ - w - 2), y = clamp(Math.round(num(b.y, 10)), 2, H_ - h - 3);
    // 避免重叠：挪开
    for (let t = 0; t < 30 && L.bld.some((o) => x < o.x + o.w + 2 && x + w + 2 > o.x && y < o.y + o.h + 3 && y + h + 3 > o.y); t++) { x = ri(api, 2, W_ - w - 2); y = ri(api, 2, H_ - h - 3); }
    if (L.bld.some((o) => x < o.x + o.w + 1 && x + w + 1 > o.x && y < o.y + o.h + 2 && y + h + 2 > o.y)) return;
    const id = rid + "b" + ++bi;
    const door = clamp(Math.round(num(b.door, Math.floor(w / 2))), 1, w - 2);
    const type = BTYPES.includes(b.type) ? b.type : "小屋";
    L.bld.push({ id, x, y, w, h, door, type, name: str(b.name, 12) || type, roof: ["plank", "metal", "shingle"].includes(b.roof) ? b.roof : "plank", ready: false, need: [], heat: [] });
    // 清出建筑周边
    for (let yy = y - 1; yy <= y + h + 1; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (inb(xx, yy)) { L.o[yy][xx] = -1; if ("#wtid".includes(L.c[yy][xx])) { L.c[yy][xx] = "."; L.g[yy][xx] = G.snow; } }
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { L.c[yy][xx] = "B"; L.g[yy][xx] = G.snow; }
    L.c[y + h - 1][x + door] = "D";
  };
  for (const b of bl) if (b) placeB(b);
  for (let t = 0; L.bld.length < Math.min(want, 2) && t < 10; t++) placeB({ x: ri(api, 4, 50), y: ri(api, 4, 34), w: ri(api, 7, 11), h: ri(api, 6, 8), type: pick(api, ["小屋", "木屋", "仓库"]), name: "" });
  // 结局要用到的家具：分给合适的建筑（没有就加盖一栋）
  const req = (world.story.req || {})[rid] || { items: [], objects: [] };
  for (const obj of req.objects) {
    let b = L.bld.find((x) => x.type === OBJ_HOME[obj]) || L.bld[L.bld.length - 1];
    if (!b) { placeB({ x: ri(api, 10, 44), y: ri(api, 6, 30), w: 9, h: 7, type: OBJ_HOME[obj] || "小屋", name: OBJ_HOME[obj] || "", roof: "metal" }); b = L.bld[L.bld.length - 1]; }
    if (b) b.need.push(obj);
  }
  // 出口
  const exits = (j && j.exits) || {};
  for (const l of world.links) {
    const to = l[0] === rid ? l[1] : l[1] === rid ? l[0] : null; if (!to) continue;
    const e = exits[to] || exits[world.regions[to].src] || {};
    let side = ["n", "s", "e", "w"].includes(e.side) ? e.side : null;
    if (!side || L.ex.some((x) => x.side === side && Math.abs(x.a - num(e.at, 0)) < 6)) side = ["e", "w", "n", "s"].find((s) => !L.ex.some((x) => x.side === s)) || "e";
    const clash = (sd, a) => L.ex.some((x) => x.side === sd && Math.abs(x.a - a) < 6);
    let lim = side === "e" || side === "w" ? H_ : W_;
    let a = clamp(Math.round(num(e.at, lim / 2)), 4, lim - 5);
    for (let t = 0; t < 8 && clash(side, a); t++) a = ((a + 9 - 4) % (lim - 9)) + 4;
    if (clash(side, a)) { // 这条边挤满了：换出口最少的一边
      side = ["e", "w", "n", "s"].sort((p, q) => L.ex.filter((x) => x.side === p).length - L.ex.filter((x) => x.side === q).length)[0];
      lim = side === "e" || side === "w" ? H_ : W_; a = Math.floor(lim / 2);
      for (let t = 0; t < 8 && clash(side, a); t++) a = ((a + 9 - 4) % (lim - 9)) + 4;
    }
    L.ex.push({ to, side, a, label: l[2] || world.regions[to].name });
  }
  for (const e of L.ex) for (let k = -1; k <= 1; k++) { const [x, y] = exitCell(e, k); L.o[y][x] = -1; L.c[y][x] = "x"; if (L.g[y][x] === G.water) L.g[y][x] = G.road_h; }
  // 室外物件
  for (const ob of Array.isArray(j && j.o) ? j.o.slice(0, 16) : []) {
    if (!ob) continue;
    const x = clamp(Math.round(num(ob.x, 20)), 1, W_ - 2), y = clamp(Math.round(num(ob.y, 20)), 1, H_ - 2);
    if (L.c[y][x] !== "." && L.c[y][x] !== "d" && L.c[y][x] !== "r") continue;
    const items = cleanItems(api, ob.items, defs);
    if (ob.t === "carcass") { L.o[y][x] = O.carcass; L.ix.push({ k: "carcass", t: "carcass", x, y, w: 1, h: 1, n: 1 }); }
    else if (ob.t === "woodpile") { L.o[y][x] = O.log_pile; L.c[y][x] = "#"; L.ix.push({ k: "wood", t: "log_pile", x, y, w: 1, h: 1, n: ri(api, 2, 4), hard: true }); }
    else if (ob.t === "deadfall") { L.o[y][x] = O.dead_tree; L.c[y][x] = "#"; L.ix.push({ k: "wood", t: "dead_tree", x, y, w: 1, h: 1, n: ri(api, 2, 4) }); }
    else if (ob.t === "car") { L.o[y][x] = O.car; L.c[y][x] = "#"; L.ix.push({ k: "cont", t: "car", name: "抛锚的车", x, y, w: 1, h: 1, items }); }
    else if (ob.t === "crate" || ob.t === "corpse") { L.ix.push({ k: "cont", t: ob.t, name: ob.t === "crate" ? "木箱" : "冻僵的遗体", x, y, w: 1, h: 1, items, f: true }); L.c[y][x] = "#"; }
    else if (ob.t === "campfire") { L.ix.push({ k: "heat", t: "campfire", x, y, w: 1, h: 1, fuel: 0, temp: 0 }); }
  }
  // 地面物品
  for (const it of Array.isArray(j && j.loot) ? j.loot.slice(0, 20) : []) {
    if (!Array.isArray(it) || !defs[it[0]]) continue;
    const x = clamp(Math.round(num(it[1], 0)), 1, W_ - 2), y = clamp(Math.round(num(it[2], 0)), 1, H_ - 2);
    if ("#wBD".includes(L.c[y][x])) continue;
    L.gi.push({ x, y, id: it[0], n: clamp(Math.round(num(it[3], 1)), 1, 5) });
  }
  // 动物
  for (const s of Array.isArray(j && j.spawn) ? j.spawn.slice(0, 6) : []) {
    if (!s || !["wolf", "deer", "rabbit"].includes(s.k)) continue;
    L.sp.push({ k: s.k, x: clamp(num(s.x, 30), 2, W_ - 3), y: clamp(num(s.y, 20), 2, H_ - 3), r: clamp(num(s.r, 8), 3, 16), n: clamp(Math.round(num(s.n, 1)), 1, s.k === "wolf" ? 3 : 4) });
  }
  const wantW = [0, 1, 2, 3][R.danger];
  if (wantW === 0) L.sp = L.sp.filter((s) => s.k !== "wolf"); // 危险 0：不放狼（规范 §4）
  const wolves = L.sp.filter((s) => s.k === "wolf").length;
  if (wolves > Math.max(wantW + 1, 1)) L.sp = L.sp.filter((s, i) => s.k !== "wolf" || L.sp.slice(0, i).filter((q) => q.k === "wolf").length < wantW + 1);
  if (wolves < Math.min(wantW, 1) && R.danger > 0) L.sp.push({ k: "wolf", x: ri(api, 10, 54), y: ri(api, 8, 40), r: 10, n: 1 });
  // 起点
  if (world.start === rid) {
    let s = Array.isArray(j && j.start) ? [clamp(Math.round(num(j.start[0], 10)), 1, W_ - 2), clamp(Math.round(num(j.start[1], 10)), 1, H_ - 2)] : null;
    const b0 = L.bld[0];
    // 规范 5.2：起点 2 分钟步行内要有遮蔽 → 起点放到第一栋建筑门口附近
    if (!s || !b0 || Math.hypot(s[0] - (b0.x + b0.door), s[1] - (b0.y + b0.h)) > 18) s = b0 ? [b0.x + b0.door, b0.y + b0.h + 2] : [8, 24];
    if (!inb(s[0], s[1]) || "#wBDt".includes(L.c[s[1]][s[0]])) s = b0 ? [b0.x + b0.door, b0.y + b0.h + 1] : [8, 24];
    L.start = s;
    L.o[s[1]][s[0]] = -1; L.c[s[1]][s[0]] = ".";
  }
  ensureReach(api, L);
  // 线索若在本区域且不在建筑里放 → 先记下，等建筑生成时塞进去（没有建筑就放地上）
  // 笔记、关键物品：等建筑生成时塞进柜子；没有建筑就放地上
  L.place = req.items.slice();
  if (!L.bld.length) while (L.place.length) { const p = freeCell(api, L); L.gi.push({ x: p[0], y: p[1], id: L.place.shift(), n: 1 }); }
  // AI 写的痕迹（可查看）
  for (const m of Array.isArray(j && j.marks) ? j.marks.slice(0, 5) : []) {
    if (!Array.isArray(m)) continue;
    const x = clamp(Math.round(num(m[0], -1)), 1, W_ - 2), y = clamp(Math.round(num(m[1], -1)), 1, H_ - 2), text = str(m[2], 120);
    if (text && ".dr".includes(L.c[y][x])) L.ix.push({ k: "mark", t: "mark", x, y, w: 1, h: 1, text });
  }
  budgetCount(L, defs, L.gi.map((g) => [g.id, g.n]).concat(...L.ix.filter((i) => i.items).map((i) => i.items)));
  for (const x of L.gi) x.nm = (defs[x.id] || {}).name || "东西";
  return L;
}

function exitCell(e, k) {
  if (e.side === "e") return [W_ - 1, e.a + k]; if (e.side === "w") return [0, e.a + k];
  if (e.side === "n") return [e.a + k, 0]; return [e.a + k, H_ - 1];
}

function freeCell(api, L) { for (let t = 0; t < 200; t++) { const x = ri(api, 2, W_ - 3), y = ri(api, 2, H_ - 3); if (L.c[y][x] === "." || L.c[y][x] === "r") return [x, y]; } return [5, 5]; }

// 可达性：起点/任一出口 → 所有门、出口、容器、物品；走不到就开路（规范 5.2）
// （写法刻意朴素：类型化数组 + 整数栈，QuickJS 里也够快）

function ensureReach(api, L) {
  const origin = L.start || (L.ex[0] ? exitCell(L.ex[0], 0) : [32, 24]);
  const targets = [];
  for (const b of L.bld) targets.push(b.x + b.door, b.y + b.h);
  for (const e of L.ex) { const c = exitCell(e, 0); targets.push(c[0], c[1]); }
  for (const i of L.ix) { const c = nearFree(L, i); targets.push(c[0], c[1]); }
  for (const g of L.gi) targets.push(g.x, g.y);
  const ox = origin[0], oy = origin[1];
  for (let pass = 0; pass < 2; pass++) {
    const seen = flood(L, ox, oy);
    let carved = false;
    for (let t = 0; t < targets.length; t += 2) {
      let x = targets[t], y = targets[t + 1];
      if (!inb(x, y) || seen[y * W_ + x]) continue;
      while (x !== ox || y !== oy) { // 从目标往起点开一条 L 形的路
        if (seen[y * W_ + x]) break;
        const ch = L.c[y][x];
        if (ch === "B") break;
        if (ch === "#" || ch === "w" || ch === "t") {
          if (ch === "w") { L.g[y][x] = G.road_h; L.c[y][x] = "r"; }
          else if (ch === "t") { L.g[y][x] = G.ice; L.c[y][x] = "i"; }
          else { L.g[y][x] = G.snow; L.c[y][x] = "."; }
          L.o[y][x] = -1;
          for (let k = L.ix.length - 1; k >= 0; k--) if (L.ix[k].x === x && L.ix[k].y === y && L.ix[k].k === "wood") L.ix.splice(k, 1);
        }
        if (x !== ox && (Math.abs(x - ox) >= Math.abs(y - oy) || y === oy)) x += x < ox ? 1 : -1; else y += y < oy ? 1 : -1;
      }
      carved = true;
    }
    if (!carved) break;
  }
}

function nearFree(L, i) { const d = [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 0]]; for (let k = 0; k < 5; k++) { const x = i.x + d[k][0], y = i.y + d[k][1]; if (inb(x, y) && ".dirfx".indexOf(L.c[y][x]) >= 0) return [x, y]; } return [i.x, i.y + 1]; }

function flood(L, sx, sy) {
  const W = L.w, H = L.h, n = W * H, walk = new Uint8Array(n), seen = new Uint8Array(n), st = new Int32Array(n);
  for (let y = 0; y < H; y++) { const r = L.c[y], o = y * W; for (let x = 0; x < W; x++) { const ch = r[x]; walk[o + x] = ch === "." || ch === "d" || ch === "i" || ch === "r" || ch === "f" || ch === "x" || ch === "D" ? 1 : 0; } }
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return seen;
  let sp = 0; st[sp++] = sy * W + sx; seen[sy * W + sx] = 1;
  while (sp > 0) {
    const c = st[--sp], x = c % W;
    if (x > 0 && !seen[c - 1] && walk[c - 1]) { seen[c - 1] = 1; st[sp++] = c - 1; }
    if (x < W - 1 && !seen[c + 1] && walk[c + 1]) { seen[c + 1] = 1; st[sp++] = c + 1; }
    if (c >= W && !seen[c - W] && walk[c - W]) { seen[c - W] = 1; st[sp++] = c - W; }
    if (c < n - W && !seen[c + W] && walk[c + W]) { seen[c + W] = 1; st[sp++] = c + W; }
  }
  return seen;
}

function cleanItems(api, list, defs) {
  const out = [];
  for (const e of Array.isArray(list) ? list.slice(0, 8) : []) {
    const id = Array.isArray(e) ? e[0] : e && e.item, n = Array.isArray(e) ? e[1] : e && e.count;
    if (!defs[id] || defs[id].cat === "note") continue;
    out.push([id, clamp(Math.round(num(n, 1)), 1, 5)]);
  }
  return out;
}

function budgetCount(L, defs, lists) {
  for (const [id, n] of lists) { const d = defs[id]; if (!d) continue; L.budget.kcal += (d.kcal || 0) * n; L.budget.water += (d.cat === "water_safe" ? d.water : 0) * n; L.budget.matches += (d.cat === "matches" ? d.uses : 0) * n; }
}

function fallbackRegionFill(api, L0, world) {
  const R = world.regions[L0.rid];
  const f = [];
  const nF = ri(api, 3, 6);
  for (let i = 0; i < nF; i++) f.push({ t: "forest", x: ri(api, 4, 60), y: ri(api, 4, 44), r: ri(api, 4, 9), d: 0.3 + rnd() * 0.4 });
  if (R.biome === "湖区" || chance(api, 0.4)) f.push({ t: "lake", x: ri(api, 16, 48), y: ri(api, 12, 36), rx: ri(api, 6, 12), ry: ri(api, 4, 7), thin: 0.2 });
  if (R.biome === "山地" || chance(api, 0.5)) f.push({ t: "rocks", x: ri(api, 6, 58), y: ri(api, 6, 42), r: ri(api, 3, 6) });
  if (R.biome === "林地河谷" || R.biome === "水坝峡谷") f.push({ t: "river", p: [[0, ri(api, 10, 38)], [32, ri(api, 10, 38)], [63, ri(api, 10, 38)]], w: 2 });
  f.push({ t: "deep", x: ri(api, 8, 56), y: ri(api, 8, 40), r: ri(api, 3, 6) });
  const roadY = ri(api, 16, 32);
  f.push({ t: R.biome === "铁路沿线" ? "rail" : "road", p: [[0, roadY], [ri(api, 20, 44), ri(api, 14, 34)], [63, ri(api, 14, 34)]] });
  const b = [];
  for (let i = 0; i < R.nb; i++) b.push({ type: pick(api, ["小屋", "木屋", "农舍", "仓库", "车站", "教堂"]), x: ri(api, 4, 50), y: ri(api, 4, 34), w: ri(api, 7, 11), h: ri(api, 6, 8), roof: pick(api, ["plank", "metal", "shingle"]) });
  const o = [{ t: "carcass", x: ri(api, 6, 58), y: ri(api, 6, 42) }, { t: "deadfall", x: ri(api, 6, 58), y: ri(api, 6, 42) }, { t: "car", x: ri(api, 6, 58), y: roadY, items: [["i_flare", 1]] }];
  const spawn = [{ k: "deer", x: ri(api, 10, 54), y: ri(api, 8, 40), r: 10, n: 2 }, { k: "rabbit", x: ri(api, 10, 54), y: ri(api, 8, 40), r: 6, n: 2 }];
  for (let i = 0; i < [0, 1, 1, 2][R.danger]; i++) spawn.push({ k: "wolf", x: ri(api, 10, 54), y: ri(api, 8, 40), r: 10, n: ri(api, 1, 2) });
  const loot = [["i_stick", ri(api, 5, 58), ri(api, 5, 42), 3], ["i_stick", ri(api, 5, 58), ri(api, 5, 42), 2]];
  const L = buildRegion(api, L0.rid, { f, b, o, spawn, loot, desc: "" }, world);
  Object.assign(L0, L);
}

export function run(api) {
  seedFrom(api);
  const id = api.params.id, j = parseLoose(api.params.s), world = api.state.get("world");
  const L = buildRegion(api, id, j || {}, world);
  if (!j) fallbackRegionFill(api, L, world);
  // 人物在这里留下过的痕迹、死在这里的遗体
  const npcs = api.state.get("npcs") || [];
  for (const n of npcs) {
    for (const t of (n.pendingTraces || []).filter((t) => t.rid === id)) { const p = freeCell(api, L); L.ix.push({ k: "mark", t: "mark", x: p[0], y: p[1], w: 1, h: 1, text: t.text }); }
    n.pendingTraces = (n.pendingTraces || []).filter((t) => t.rid !== id);
    if (n.corpsePending && n.rid === id) { const p = freeCell(api, L); L.ix.push({ k: "cont", t: "corpse", f: true, name: n.name + "的遗体", x: p[0], y: p[1], w: 1, h: 1, items: n.inv.slice() }); L.c[p[1]][p[0]] = "#"; n.corpsePending = false; }
  }
  api.state.set("npcs", npcs);
  api.state.set("c_" + id, Object.assign(metaOf(id, L), { g: enc(L.g), o: enc(L.o) }));
  return true;
}
