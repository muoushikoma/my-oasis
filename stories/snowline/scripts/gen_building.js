// 雪线 · 建筑室内拼接与校验（由 build/split.py 从 gen_src.js 生成，请改源文件）
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

// ───────── 家具目录：占地、功能 ─────────
const FDEF = {
  bed: [1, 2, "bed"], bunk: [1, 2, "bed"], bedroll: [1, 2, "bed"],
  stove: [1, 1, "heat"], barrel_stove: [1, 1, "heat"], fireplace: [2, 1, "heat"],
  cabinet: [1, 1, "cont"], drawer: [1, 1, "cont"], wardrobe: [2, 1, "cont"], kitchen_counter: [2, 1, "cont"], fridge: [1, 1, "cont"],
  table: [2, 1, ""], table_small: [1, 1, ""], desk: [2, 1, "cont"], chair: [1, 1, ""], armchair: [1, 1, ""],
  bookshelf: [2, 1, "cont"], workbench: [2, 1, "bench"], crate: [1, 1, "cont"], locker: [1, 1, "cont"], safe: [1, 1, "cont"],
  sink: [1, 1, "cont"], toilet: [1, 1, ""], bathtub: [1, 2, ""], first_aid: [1, 1, "cont"], barrel: [1, 1, "cont"], bucket: [1, 1, "cont"],
  woodpile: [1, 1, "wood"], pew: [3, 1, ""], altar: [2, 1, "cont"], radio_desk: [2, 1, ""], control_panel: [2, 1, ""],
  rug: [2, 2, "floor"], corpse: [1, 1, "cont"], debris: [1, 1, ""],
};

const MAP_CAP = { knife: 1, hatchet: 1, prybar: 1, bandage: 4, antibiotic: 2, painkiller: 2, tablets: 1, flare: 3, lantern: 1, flashlight: 1, lamp_oil: 2, battery: 2, candle: 4 };
// 区域预算（标准难度，规范 §4）

const BUDGET = { kcal: [4000, 9000], water: [2, 5], matches: [10, 30] };

// 基础物品：保证关键物资一定存在（AI 可以再加带名字的变体）

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

// ───────── 建筑层：模块化拼接（规范 5.3） ─────────
function buildInterior(api, L, b, j, world, depthMul) {
  const defs = itemDefs(api);
  const W = b.w, H = b.h;
  const wall = [], floor = [], open = {};
  for (let y = 0; y < H; y++) { wall.push(new Array(W).fill(false)); floor.push(new Array(W).fill(null)); }
  const rooms = [{ name: "", rect: [0, 0, W, H], floor: "wood" }];
  for (const r of Array.isArray(j && j.rooms) ? j.rooms.slice(0, 8) : []) {
    if (!Array.isArray(r)) continue;
    let [name, x, y, w, h, fl] = r;
    x = clamp(Math.round(num(x, 0)), 0, W - 3); y = clamp(Math.round(num(y, 0)), 0, H - 3);
    w = clamp(Math.round(num(w, 3)), 3, W - x); h = clamp(Math.round(num(h, 3)), 3, H - y);
    rooms.push({ name: str(name, 8), rect: [x, y, w, h], floor: FLOOR[fl] !== undefined ? fl : "wood" });
  }
  if (rooms.length === 1) rooms[0].floor = pick(api, ["wood", "wood", "stone"]);
  for (const r of rooms) { const [x, y, w, h] = r.rect; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { if (xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1) wall[yy][xx] = true; else floor[yy][xx] = r.floor; } }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (wall[y][x] && floor[y][x]) floor[y][x] = null;
  // 墙格如果四周没有地板（多余的厚墙）→ 变地板
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (wall[y][x]) {
    const n = wall[y - 1][x], s = wall[y + 1][x], e = wall[y][x + 1], w = wall[y][x - 1];
    if ((n && s && e && w) && [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([dx, dy]) => wall[y + dy][x + dx])) { wall[y][x] = false; floor[y][x] = floor[y][x - 1] || "wood"; }
  }
  const isW = (x, y) => x >= 0 && y >= 0 && x < W && y < H && wall[y][x];
  const straight = (x, y) => isW(x, y) && ((isW(x - 1, y) && isW(x + 1, y) && !isW(x, y - 1) && !isW(x, y + 1)) || (isW(x, y - 1) && isW(x, y + 1) && !isW(x - 1, y) && !isW(x + 1, y)));
  for (const op of Array.isArray(j && j.open) ? j.open.slice(0, 24) : []) {
    if (!Array.isArray(op)) continue;
    const x = Math.round(num(op[0], -1)), y = Math.round(num(op[1], -1)), k = OPEN_H[op[2]] !== undefined ? op[2] : null;
    if (!k || !straight(x, y)) continue;
    const outer = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    open[x + "," + y] = outer && y !== H - 1 && k.startsWith("door") ? "window" : k; // 外门只能开在正面
  }
  // 正门：必须在区域给的位置
  open[b.door + "," + (H - 1)] = "door";
  for (const k in open) if (open[k] === "door_locked" && k === b.door + "," + (H - 1)) open[k] = "door";
  // 连通：从正门内侧开始，按房间逐个连通
  const walkable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (floor[y][x] || (open[x + "," + y] && open[x + "," + y] !== "window" && open[x + "," + y] !== "window_broken"));
  for (let guard = 0; guard < 10; guard++) {
    const seen = {}, q = [[b.door, H - 2]];
    seen[b.door + "," + (H - 2)] = 1;
    while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + "," + ny; if (seen[k] || !walkable(nx, ny) || (ny === H - 1)) continue; seen[k] = 1; q.push([nx, ny]); } }
    let lone = null;
    for (let y = 1; y < H - 1 && !lone; y++) for (let x = 1; x < W - 1 && !lone; x++) if (floor[y][x] && !seen[x + "," + y]) lone = [x, y];
    if (!lone) break;
    // 找一面直墙：一侧是孤立区域，另一侧已连通
    let done = false;
    for (let y = 1; y < H - 1 && !done; y++) for (let x = 1; x < W - 1 && !done; x++) {
      if (!straight(x, y) || open[x + "," + y]) continue;
      const pairs = isW(x - 1, y) ? [[x, y - 1], [x, y + 1]] : [[x - 1, y], [x + 1, y]];
      const [a, c] = pairs;
      const sa = seen[a[0] + "," + a[1]], sc = seen[c[0] + "," + c[1]];
      if (floor[a[1]] && floor[c[1]] && floor[a[1]][a[0]] && floor[c[1]][c[0]] && (sa ? 1 : 0) + (sc ? 1 : 0) === 1) { open[x + "," + y] = "door_open"; done = true; }
    }
    if (!done) { floor[lone[1]][lone[0]] = null; wall[lone[1]][lone[0]] = true; }
  }
  // 家具
  const occ = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!floor[y][x]) occ[x + "," + y] = 1;
  for (const k in open) { const [x, y] = k.split(",").map(Number); for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) occ[(x + dx) + "," + (y + dy)] = occ[(x + dx) + "," + (y + dy)] || 2; }
  const furn = [];
  const needObj = (b.need || []).slice();
  const fl = Array.isArray(j && j.furn) ? j.furn.slice(0, 30) : [];
  const place = (t, x, y, items) => {
    const d = FDEF[t]; if (!d) return false;
    const [w, h, fn] = d;
    if (!(x >= 1 && y >= 1 && x + w <= W - 1 && y + h <= H - 1)) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (occ[xx + "," + yy] && !(fn === "floor" && occ[xx + "," + yy] === 2 && false)) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) occ[xx + "," + yy] = fn === "floor" ? 0 : 1;
    furn.push({ t, x, y, w, h, fn, items: fn === "cont" ? items || [] : undefined });
    return true;
  };
  for (const f of fl) if (Array.isArray(f) && FDEF[f[0]]) place(f[0], Math.round(num(f[1], -9)), Math.round(num(f[2], -9)), cleanItems(api, f[3], defs));
  // 兜底家具：按建筑类型补齐必需品
  const need = [];
  if (!furn.some((f) => f.fn === "heat") && b.type !== "货运车厢" && b.type !== "残骸") need.push(b.type === "营地帐篷" ? "barrel_stove" : pick(api, ["stove", "fireplace"]));
  if (!furn.some((f) => f.fn === "bed") && ["小屋", "木屋", "农舍", "营地帐篷", "瞭望塔"].includes(b.type)) need.push("bed");
  if (furn.filter((f) => f.fn === "cont").length < 2) need.push(pick(api, ["cabinet", "drawer", "crate"]), pick(api, ["locker", "cabinet", "desk"]));
  for (const o of needObj) if (!furn.some((f) => f.t === o)) need.unshift(o);
  for (const t of need) { for (let tries = 0; tries < 60; tries++) if (place(t, ri(api, 1, W - 2), ri(api, 1, H - 2), [])) break; }
  // 物品预算：这一栋最多能放多少（规范 §4，越远越少）
  const mul = depthMul;
  const cap = { kcal: BUDGET.kcal[1] * mul - L.budget.kcal, water: BUDGET.water[1] * mul - L.budget.water, matches: BUDGET.matches[1] * mul - L.budget.matches };
  const mapCount = {};
  for (const i of L.ix) for (const [id, n] of i.items || []) { const c = (defs[id] || {}).cat; mapCount[c] = (mapCount[c] || 0) + n; }
  const conts = furn.filter((f) => f.fn === "cont");
  for (const f of conts) f.items = (f.items || []).filter(([id, n]) => {
    const d = defs[id]; if (!d) return false;
    const c = d.cat;
    if (MAP_CAP[c] !== undefined && (mapCount[c] || 0) + n > MAP_CAP[c]) return false;
    if ((d.kcal || 0) * n > cap.kcal) return false;
    if (c === "water_safe" && d.water * n > cap.water) return false;
    if (c === "matches" && d.uses * n > cap.matches) return false;
    cap.kcal -= (d.kcal || 0) * n; if (c === "water_safe") cap.water -= d.water * n; if (c === "matches") cap.matches -= d.uses * n;
    mapCount[c] = (mapCount[c] || 0) + n; return true;
  });
  // 线索：塞进本栋（若本区域还有没放的线索）
  if (L.place && L.place.length && conts.length) pick(api, conts).items.push([L.place.shift(), 1]);
  for (const m of Array.isArray(j && j.marks) ? j.marks.slice(0, 3) : []) { // AI 写的痕迹
    if (!Array.isArray(m)) continue;
    const x = Math.round(num(m[0], -1)), y = Math.round(num(m[1], -1)), text = str(m[2], 120);
    if (text && x > 0 && y > 0 && x < W - 1 && y < H - 1 && floor[y][x] && !occ[x + "," + y]) { occ[x + "," + y] = 1; L.ix.push({ k: "mark", t: "mark", x: b.x + x, y: b.y + y, w: 1, h: 1, text, bid: b.id }); }
  }
  // 空容器比例（标准 30–50%）：AI 什么都没放时，规则补一点
  if (!j || !Array.isArray(j.furn)) fillByType(api, b.type, conts, defs, cap);
  // 写回区域地图
  const ox = b.x, oy = b.y;
  const mask = (x, y) => (isW(x, y - 1) ? 1 : 0) | (isW(x + 1, y) ? 2 : 0) | (isW(x, y + 1) ? 4 : 0) | (isW(x - 1, y) ? 8 : 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = ox + x, Y = oy + y;
    const k = open[x + "," + y];
    if (wall[y][x]) {
      const vert = isW(x, y - 1) && isW(x, y + 1);
      const nb = floor[y - 1] && floor[y - 1][x] || floor[y + 1] && floor[y + 1][x] || floor[y][x - 1] || floor[y][x + 1] || "wood";
      L.g[Y][X] = FLOOR[nb];
      if (k) { L.o[Y][X] = (vert ? OPEN_V : OPEN_H)[k]; L.c[Y][X] = k.startsWith("window") ? "#" : k === "door_locked" ? "L" : "f"; }
      else { L.o[Y][X] = mask(x, y); L.c[Y][X] = "#"; }
    } else { L.g[Y][X] = FLOOR[floor[y][x] || "wood"]; L.o[Y][X] = -1; L.c[Y][X] = "f"; }
  }
  for (const f of furn) {
    for (let yy = f.y; yy < f.y + f.h; yy++) for (let xx = f.x; xx < f.x + f.w; xx++) if (f.fn !== "floor") L.c[oy + yy][ox + xx] = "#";
    const e = { k: f.fn === "floor" ? "deco" : f.fn || "deco", t: f.t, x: ox + f.x, y: oy + f.y, w: f.w, h: f.h, bid: b.id };
    if (f.fn === "cont") { e.items = f.items; if (f.t === "safe") e.lock = true; }
    if (f.fn === "heat") { e.fuel = 0; e.temp = 0; b.heat.push([f.x, f.y]); }
    if (f.fn === "wood") e.n = ri(api, 2, 4);
    L.ix.push(e);
  }
  b.ready = true; b.desc = str(j && j.desc, 80);
  b.rooms = rooms.slice(1).map((r) => r.name).filter(Boolean);
  b.shelter = furn.some((f) => f.fn === "heat");
  budgetCount(L, defs, conts.map((f) => f.items).flat());
  // 本区域所有建筑都好了：不够下限就补（规范 §9.3）
  if (L.bld.every((x) => x.ready)) { topUp(api, L, defs, mul); const all = L.ix.filter((i) => i.k === "cont" && i.items); while (L.place && L.place.length && all.length) pick(api, all).items.push([L.place.shift(), 1]); }
}

const LOOT_BY_TYPE = {
  default: [["i_can_beans", 3], ["i_cracker", 2], ["i_match", 3], ["i_cloth", 3], ["i_tinder", 2], ["i_water", 2], ["i_paper", 2], ["i_bandage", 1], ["i_stick", 2], ["i_candle", 1], ["i_oil", 1], ["i_lantern", 0.5]],
  教堂: [["i_cracker", 3], ["i_bandage", 2], ["i_painkiller", 1], ["i_match", 3], ["i_tea", 2], ["i_candle", 3]],
  仓库: [["i_can_beans", 2], ["i_coal", 3], ["i_cloth", 3], ["i_hatchet", 1], ["i_prybar", 1], ["i_match", 2], ["i_lantern", 1], ["i_oil", 1]],
  车站: [["i_soda", 3], ["i_bar", 2], ["i_flare", 2], ["i_match", 2], ["i_paper", 3], ["i_flashlight", 1], ["i_battery", 1]],
  水坝控制室: [["i_can_peach", 2], ["i_antibiotic", 1], ["i_flare", 1], ["i_tablet", 1], ["i_pot", 1], ["i_battery", 1], ["i_flashlight", 1]],
};

function fillByType(api, type, conts, defs, cap) {
  const tbl = LOOT_BY_TYPE[type] || LOOT_BY_TYPE.default;
  for (const f of conts) {
    if (chance(api, 0.4)) continue; // 空容器
    for (let k = ri(api, 1, 2); k > 0; k--) {
      const id = pickW(api, tbl), d = defs[id]; if (!d) continue;
      if ((d.kcal || 0) > cap.kcal) continue;
      cap.kcal -= d.kcal || 0; f.items.push([id, 1]);
    }
  }
}

function pickW(api, tbl) { let t = 0; for (const e of tbl) t += e[1]; let r = rnd() * t; for (const e of tbl) { r -= e[1]; if (r <= 0) return e[0]; } return tbl[0][0]; }

function topUp(api, L, defs, mul) {
  const conts = L.ix.filter((i) => i.k === "cont" && i.items);
  if (!conts.length) return;
  const lo = { kcal: BUDGET.kcal[0] * mul, water: BUDGET.water[0] * mul, matches: BUDGET.matches[0] * mul };
  for (let g = 0; L.budget.kcal < lo.kcal && g < 20; g++) { const id = pick(api, ["i_can_beans", "i_cracker", "i_jerky", "i_bar"]); pick(api, conts).items.push([id, 1]); L.budget.kcal += defs[id].kcal; }
  for (let g = 0; L.budget.water < lo.water && g < 10; g++) { pick(api, conts).items.push(["i_water", 1]); L.budget.water += 0.5; }
  for (let g = 0; L.budget.matches < lo.matches && g < 10; g++) { pick(api, conts).items.push(["i_match", 1]); L.budget.matches += 6; }
}

function fallbackInterior(api, b) {
  const W = b.w, H = b.h, rooms = [], open = [], furn = [];
  if (W >= 9 && H >= 6 && chance(api, 0.8)) {
    const sx = ri(api, Math.floor(W / 2) - 1, Math.floor(W / 2) + 1);
    rooms.push(["主屋", 0, 0, sx + 1, H, pick(api, ["wood", "stone"])], ["里间", sx, 0, W - sx, H, pick(api, ["wood", "carpet", "tile"])]);
    open.push([sx, ri(api, 1, H - 2), "door_open"]);
  }
  open.push([1, 0, "window"], [W - 2, 0, "window"]);
  return { rooms, open, desc: "" };
}

export function run(api) {
  seedFrom(api);
  const [rid, bid] = api.params.id.split("|"), j = parseLoose(api.params.s), world = api.state.get("world");
  const L = getLevel(api, rid); if (!L) return false;
  const b = L.bld.find((x) => x.id === bid); if (!b || b.ready) return false;
  buildInterior(api, L, b, j || fallbackInterior(api, b), world, depthMulOf(world, rid));
  putLevel(api, rid, L);
  return true;
}
