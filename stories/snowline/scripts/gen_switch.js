// 雪线 · 切换区域（由 build/split.py 从 gen_src.js 生成，请改源文件）
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

function exitCell(e, k) {
  if (e.side === "e") return [W_ - 1, e.a + k]; if (e.side === "w") return [0, e.a + k];
  if (e.side === "n") return [e.a + k, 0]; return [e.a + k, H_ - 1];
}

function spawnEnts(api, sp, R) {
  const out = [];
  const okCell = (x, y) => { const tx = Math.floor(x), ty = Math.floor(y); return R && tx > 0 && ty > 0 && tx < R.w - 1 && ty < R.h - 1 && ".dri".indexOf(R.c[ty][tx]) >= 0; };
  for (const s of sp || []) for (let i = 0; i < s.n; i++) {
    let x = s.x, y = s.y;
    for (let t = 0; t < 30; t++) { const a = rnd() * 6.283, d = rnd() * s.r; x = s.x + Math.cos(a) * d; y = s.y + Math.sin(a) * d; if (okCell(x, y)) break; }
    if (!okCell(x, y)) continue; // 找不到能站的地方就不放
    out.push({ k: s.k, x: x * 64, y: y * 64, hx: s.x * 64, hy: s.y * 64, hr: s.r * 64, st: "idle", t: 0, dir: 1, hp: 1, vx: 0, vy: 0 });
  }
  return out;
}

// ───────── 切换区域（tick.js 调用） ─────────
export function switch_region(api) {
  seedFrom(api);
  const to = api.params.to, from = api.params.from && api.params.from !== "null" ? api.params.from : null;
  const cur = api.state.get("lvl");
  const here = api.state.get("here");
  if (cur && cur.rid) api.state.set("c_" + cur.rid, Object.assign({}, cur, { g: enc(here.g), o: enc(here.o) })); // 存回缓存
  const R = api.state.get("c_" + to);
  if (!R || !R.g) return false;
  const lv = Object.assign({}, R); delete lv.g; delete lv.o;
  api.state.set("lvl", lv);
  api.state.set("here", { rid: to, w: R.w, h: R.h, g: dec(R.g), o: dec(R.o) });
  for (const b of R.bld) if (!b.ready) queue(api, "building", to + "|" + b.id); // 只生成当前区域的建筑
  const g = api.state.get("g");
  // 落点：对应出口往里两格；起点区域首次用 start
  let p = R.start || [32, 24];
  const e = from ? R.ex.find((x) => x.to === from) : null;
  if (e) { const [x, y] = exitCell(e, 0); p = [x + (e.side === "w" ? 2 : e.side === "e" ? -2 : 0), y + (e.side === "n" ? 2 : e.side === "s" ? -2 : 0)]; }
  // 落点被挡住时就近找一格能站的
  const ok = (x, y) => x > 0 && y > 0 && x < R.w - 1 && y < R.h - 1 && ".dirf".includes(R.c[y][x]);
  if (!ok(p[0], p[1])) { let best = null; for (let r = 1; r < 12 && !best; r++) for (let dy = -r; dy <= r && !best; dy++) for (let dx = -r; dx <= r && !best; dx++) if (ok(p[0] + dx, p[1] + dy)) best = [p[0] + dx, p[1] + dy]; if (best) p = best; }
  g.rid = to; g.pc.x = (p[0] + 0.5) * 64; g.pc.y = (p[1] + 0.5) * 64;
  g.ents = spawnEnts(api, R.sp, R);
  g.seen = g.seen || {}; const first = !g.seen[to]; g.seen[to] = true;
  api.state.set("g", g);
  const world = api.state.get("world");
  // 预先生成相邻区域（背景）
  for (const l of world.links) { const nb = l[0] === to ? l[1] : l[1] === to ? l[0] : null; if (nb) queue(api, "region", nb); }
  return { first, name: world.regions[to].name, desc: R.desc };
}

