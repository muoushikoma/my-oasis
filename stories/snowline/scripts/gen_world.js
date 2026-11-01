// 雪线 · 世界层生成与校验（由 build/split.py 从 gen_src.js 生成，请改源文件）
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

// ───────── 物品类别与数值区间（规范 §3） ─────────
// [字段, 下限, 上限]
const CAT = {
  food_can: { kcal: [200, 600], kg: [0.3, 0.6], water: [0, 0.25] },
  food_bar: { kcal: [150, 350], kg: [0.05, 0.15], water: [0, 0] },
  food_bread: { kcal: [100, 400], kg: [0.1, 0.3], water: [-0.05, 0] },
  food_dried: { kcal: [250, 450], kg: [0.1, 0.3], water: [-0.1, 0] },
  drink: { kcal: [0, 250], kg: [0.3, 0.5], water: [0.25, 0.5] },
  meat_raw: { kcal: [600, 1000], kg: [0.5, 1.5], water: [0, 0], risk: [0.5, 0.75] },
  meat_cooked: { kcal: [600, 1000], kg: [0.5, 1.5], water: [0, 0] },
  fish_raw: { kcal: [150, 600], kg: [0.3, 1.5], water: [0, 0], risk: [0.5, 0.75] },
  fish_cooked: { kcal: [150, 600], kg: [0.3, 1.5], water: [0, 0] },
  water_safe: { water: [0.5, 1.0], kg: [0.5, 1.0] },
  water_unsafe: { water: [0.5, 1.0], kg: [0.5, 1.0], risk: [0.3, 0.6] },
  matches: { uses: [2, 10], kg: [0.03, 0.06] },
  flint: { uses: [20, 100], kg: [0.05, 0.2], malus: [0.1, 0.25] },
  tinder: { kg: [0.05, 0.1], bonus: [0.1, 0.3] },
  fuel_stick: { burn: [8, 12], kg: [0.1, 0.15] },
  fuel_soft: { burn: [40, 60], kg: [0.8, 1.2] },
  fuel_hard: { burn: [60, 90], kg: [0.8, 1.2] },
  fuel_coal: { burn: [60, 90], kg: [0.4, 0.6] },
  hat: { warm: [0.5, 3], wind: [0, 1], kg: [0.1, 0.5] },
  coat: { warm: [1, 6], wind: [0.5, 5], kg: [0.5, 3] },
  shirt: { warm: [0.5, 3], wind: [0, 1], kg: [0.2, 1.2] },
  pants: { warm: [0.5, 3], wind: [0.5, 3], kg: [0.3, 1.5] },
  gloves: { warm: [0.5, 2], wind: [0, 1.5], kg: [0.1, 0.5] },
  boots: { warm: [0.5, 3], wind: [0.5, 2], kg: [0.5, 2] },
  socks: { warm: [0.5, 1.5], wind: [0, 0], kg: [0.05, 0.3] },
  knife: { kg: [0.2, 0.5] }, hatchet: { kg: [0.7, 1.2] }, prybar: { kg: [0.8, 1.5] }, sewing: { kg: [0.05, 0.2], uses: [3, 10] },
  pot: { kg: [0.5, 1.5] }, can_empty: { kg: [0.05, 0.15] },
  bandage: { uses: [1, 3], kg: [0.03, 0.1] }, antibiotic: { uses: [1, 6], kg: [0.02, 0.1] }, painkiller: { uses: [1, 6], kg: [0.02, 0.1] }, tablets: { uses: [5, 20], kg: [0.02, 0.05] },
  flare: { kg: [0.2, 0.4] }, torch: { kg: [0.3, 0.6], uses: [15, 25] },
  // 照明：uses 是剩余可用分钟；燃料类 burn 是能补充的分钟数
  lantern: { kg: [0.8, 1.5], uses: [0, 240] }, lamp_oil: { kg: [0.3, 0.8], burn: [120, 240] },
  flashlight: { kg: [0.2, 0.5], uses: [0, 120] }, battery: { kg: [0.05, 0.1], burn: [60, 180] },
  candle: { kg: [0.05, 0.15], uses: [20, 60] },
  cloth: { kg: [0.1, 0.3] }, hide: { kg: [0.5, 1.5] }, paper: { kg: [0.02, 0.1] },
  note: { kg: [0.01, 0.01] }, misc: { kg: [0.05, 2] },
};
// 每张地图上限（规范 §3.5）

const BIOMES = ["林地河谷", "湖区", "山地", "铁路沿线", "小镇废墟", "水坝峡谷", "海岸"];

const BTYPES = ["小屋", "木屋", "农舍", "教堂", "车站", "水坝控制室", "瞭望塔", "仓库", "营地帐篷", "货运车厢", "残骸", "无线电站"];

const BASE_ITEMS = [
  { id: "i_match", name: "火柴（一盒）", cat: "matches", uses: 6, kg: 0.05, desc: "受潮的盒子里还剩几根。" },
  { id: "i_flint", name: "打火石", cat: "flint", uses: 60, kg: 0.1, malus: 0.15, desc: "能用很久，但不如火柴好点。" },
  { id: "i_tinder", name: "引火物", cat: "tinder", kg: 0.06, bonus: 0.2, desc: "干树皮、纸屑。" },
  { id: "i_stick", name: "细枝", cat: "fuel_stick", burn: 10, kg: 0.12, desc: "烧得很快。" },
  { id: "i_wood", name: "软木柴", cat: "fuel_soft", burn: 50, kg: 1.0, desc: "冷杉劈的柴。" },
  { id: "i_hardwood", name: "硬木柴", cat: "fuel_hard", burn: 75, kg: 1.0, desc: "耐烧的桦木。" },
  { id: "i_coal", name: "煤块", cat: "fuel_coal", burn: 80, kg: 0.5, desc: "黑得发亮。" },
  { id: "i_can_beans", name: "炖豆罐头", cat: "food_can", kcal: 450, kg: 0.45, water: 0.05, desc: "" },
  { id: "i_can_peach", name: "糖水桃罐头", cat: "food_can", kcal: 300, kg: 0.45, water: 0.2, desc: "" },
  { id: "i_bar", name: "能量棒", cat: "food_bar", kcal: 300, kg: 0.1, desc: "" },
  { id: "i_cracker", name: "苏打饼干", cat: "food_bread", kcal: 300, kg: 0.15, water: -0.03, desc: "" },
  { id: "i_jerky", name: "牛肉干", cat: "food_dried", kcal: 350, kg: 0.15, water: -0.05, desc: "" },
  { id: "i_soda", name: "汽水", cat: "drink", kcal: 250, kg: 0.4, water: 0.33, desc: "" },
  { id: "i_tea", name: "罐装红茶", cat: "drink", kcal: 50, kg: 0.4, water: 0.35, desc: "" },
  { id: "i_meat_raw", name: "生鹿肉", cat: "meat_raw", kcal: 800, kg: 1.0, risk: 0.6, desc: "要烤熟。" },
  { id: "i_meat", name: "烤鹿肉", cat: "meat_cooked", kcal: 800, kg: 1.0, desc: "" },
  { id: "i_fish_raw", name: "生鱼", cat: "fish_raw", kcal: 300, kg: 0.6, risk: 0.6, desc: "" },
  { id: "i_fish", name: "烤鱼", cat: "fish_cooked", kcal: 300, kg: 0.6, desc: "" },
  { id: "i_water", name: "瓶装水", cat: "water_safe", water: 0.5, kg: 0.5, desc: "" },
  { id: "i_water_raw", name: "融雪水（未处理）", cat: "water_unsafe", water: 0.5, kg: 0.5, risk: 0.4, desc: "喝了可能闹肚子。" },
  { id: "i_bandage", name: "绷带", cat: "bandage", uses: 1, kg: 0.05, desc: "止血、固定扭伤。" },
  { id: "i_antibiotic", name: "抗生素", cat: "antibiotic", uses: 2, kg: 0.05, desc: "治食物中毒和痢疾。" },
  { id: "i_painkiller", name: "止痛药", cat: "painkiller", uses: 2, kg: 0.05, desc: "缓解扭伤。" },
  { id: "i_tablet", name: "净水药片", cat: "tablets", uses: 10, kg: 0.03, desc: "把未处理的水变得能喝。" },
  { id: "i_flare", name: "信号弹", cat: "flare", kg: 0.3, desc: "点燃后能吓退狼。" },
  { id: "i_torch", name: "火把", cat: "torch", uses: 20, kg: 0.4, desc: "自制。举着能照亮四周，狼不敢靠近；烧二十分钟左右。" },
  { id: "i_lantern", name: "风灯", cat: "lantern", uses: 90, kg: 1.1, desc: "烧灯油，照得稳。提着它的时候腾不出手搏斗。" },
  { id: "i_oil", name: "灯油", cat: "lamp_oil", burn: 180, kg: 0.5, desc: "给风灯加油。" },
  { id: "i_flashlight", name: "手电筒", cat: "flashlight", uses: 45, kg: 0.3, desc: "照得远，但电池不多了。" },
  { id: "i_battery", name: "电池", cat: "battery", burn: 120, kg: 0.06, desc: "给手电换上。" },
  { id: "i_candle", name: "蜡烛", cat: "candle", uses: 40, kg: 0.1, desc: "光很小，烧得也快。" },
  { id: "i_knife", name: "猎刀", cat: "knife", kg: 0.3, desc: "剥取更快，搏斗时更有力。" },
  { id: "i_hatchet", name: "手斧", cat: "hatchet", kg: 1.0, desc: "能劈硬木。" },
  { id: "i_prybar", name: "撬棍", cat: "prybar", kg: 1.2, desc: "撬开上锁的门和保险柜。" },
  { id: "i_sewing", name: "针线包", cat: "sewing", uses: 6, kg: 0.1, desc: "缝制衣物。" },
  { id: "i_pot", name: "铁锅", cat: "pot", kg: 1.0, desc: "一次能烧 1 升水。" },
  { id: "i_can_empty", name: "空罐头", cat: "can_empty", kg: 0.1, desc: "一次能烧 0.5 升水。" },
  { id: "i_cloth", name: "碎布", cat: "cloth", kg: 0.15, desc: "能做绷带、引火物。" },
  { id: "i_hide", name: "鹿皮", cat: "hide", kg: 1.0, desc: "三张能缝一件皮袄。" },
  { id: "i_paper", name: "旧报纸", cat: "paper", kg: 0.05, desc: "能当引火物。" },
  { id: "i_hat", name: "毛线帽", cat: "hat", warm: 1, wind: 0.5, kg: 0.2, desc: "" },
  { id: "i_coat", name: "旧棉外套", cat: "coat", warm: 3.5, wind: 3, kg: 1.5, desc: "" },
  { id: "i_shirt", name: "法兰绒衬衫", cat: "shirt", warm: 1.5, wind: 0.3, kg: 0.4, desc: "" },
  { id: "i_pants", name: "牛仔裤", cat: "pants", warm: 1, wind: 1, kg: 0.8, desc: "" },
  { id: "i_gloves", name: "羊毛手套", cat: "gloves", warm: 0.8, wind: 0.4, kg: 0.15, desc: "" },
  { id: "i_boots", name: "工作靴", cat: "boots", warm: 1.2, wind: 0.8, kg: 1.2, desc: "" },
  { id: "i_socks", name: "羊毛袜", cat: "socks", warm: 0.8, wind: 0, kg: 0.1, desc: "" },
  { id: "i_parka", name: "厚羽绒服", cat: "coat", warm: 5.5, wind: 4, kg: 2.2, desc: "" },
  { id: "i_hidecoat", name: "鹿皮袄", cat: "coat", warm: 4.5, wind: 4.5, kg: 2.5, desc: "自己缝的，很暖。" },
];

// ───────── 物品校验 ─────────
function fixItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const cat = CAT[raw.cat] ? raw.cat : null;
  if (!cat) return null;
  const id = str(raw.id, 40).replace(/[^a-z0-9_]/g, "");
  if (!/^i_[a-z0-9_]{1,36}$/.test(id)) return null;
  const it = { id, name: str(raw.name, 16) || id, cat, desc: str(raw.desc, 60) };
  for (const [k, [lo, hi]] of Object.entries(CAT[cat])) it[k] = r2(clamp(num(raw[k], (lo + hi) / 2), lo, hi));
  if (CAT[cat].uses) it.uses = Math.round(it.uses);
  if (cat === "meat_raw" || cat === "meat_cooked") it.kcal = Math.round(it.kcal * it.kg); // 区间是每 kg
  return it;
}

// ───────── AI 设计的结局：用"步骤积木"拼出通关条件，规则保证能完成 ─────────
const USE_OBJ = ["radio_desk", "control_panel", "altar", "desk", "workbench", "fireplace", "stove", "bed", "bookshelf", "safe"];

const OBJ_HOME = { radio_desk: "无线电站", control_panel: "水坝控制室", altar: "教堂", desk: "小屋", workbench: "仓库", fireplace: "木屋", stove: "小屋", bed: "小屋", bookshelf: "木屋", safe: "车站" };

function fixStory(api, s, out, map) {
  const ids = Object.keys(out.regions), depth = reach(out.links, out.start);
  const far = ids.slice().sort((a, b) => (depth[b] || 0) - (depth[a] || 0));
  const reg = (r, notStart) => { const x = map(r); return x && (!notStart || x !== out.start) ? x : null; };
  const notes = (Array.isArray(s.notes) ? s.notes : Array.isArray(s.clues) ? s.clues : []).slice(0, 5).map((c, i) => ({
    id: "n" + (i + 1), region: reg(c && c.region, true) || ids[1 + (i % (ids.length - 1))],
    title: str(c && c.title, 14) || "一页笔记", text: str(c && c.text, 240) || "字迹被水泡开了，只能认出几个字。" }));
  const keys = (Array.isArray(s.keys) ? s.keys : []).slice(0, 3).map((k, i) => ({
    id: "k" + (i + 1), src: str(k && k.id, 12), name: str(k && k.name, 10) || "旧东西", desc: str(k && k.desc, 60), region: reg(k && k.region, true) || far[Math.min(i + 1, far.length - 1)] }));
  const keyOf = (x) => { const k = keys.find((k) => k.id === x || k.src === x || k.name === x); return k ? k.id : null; };
  const steps = [];
  for (const st of (Array.isArray(s.steps) ? s.steps : []).slice(0, 6)) {
    if (!st || typeof st !== "object") continue;
    const hint = str(st.hint, 28), done = str(st.done, 80);
    if (st.t === "reach" && reg(st.region)) steps.push({ t: "reach", region: reg(st.region), bt: BTYPES.includes(st.building) ? st.building : null, hint, done });
    else if (st.t === "collect" && keyOf(st.key)) steps.push({ t: "collect", key: keyOf(st.key), hint, done });
    else if (st.t === "read" && notes.length) steps.push({ t: "read", n: clamp(Math.round(num(st.n, notes.length)), 1, notes.length), hint, done });
    else if (st.t === "use" && reg(st.region) && USE_OBJ.includes(st.object)) steps.push({ t: "use", region: reg(st.region), object: st.object, label: str(st.label, 14) || "做该做的事",
      min: clamp(Math.round(num(st.minutes, 30)), 5, 240), need: (Array.isArray(st.need) ? st.need : []).map(keyOf).filter(Boolean).slice(0, 3), hint, done });
    else if (st.t === "fire" && reg(st.region)) steps.push({ t: "fire", region: reg(st.region), hint, done });
    else if (st.t === "survive") steps.push({ t: "survive", day: clamp(Math.round(num(st.day, 7)), 2, 30), hint, done });
  }
  // 要用到的关键物品，前面必须有"拿到它"这一步
  for (let i = 0; i < steps.length; i++) if (steps[i].t === "use") for (const k of steps[i].need)
    if (!steps.slice(0, i).some((x) => x.t === "collect" && x.key === k)) { steps.splice(i, 0, { t: "collect", key: k, hint: "找到" + keys.find((x) => x.id === k).name, done: "" }); i++; }
  // 可行性：不能只有"活着"，而且至少要走到离起点 2 条路以外
  const deep = steps.some((x) => x.region && depth[x.region] >= 2) || steps.some((x) => x.t === "survive" && x.day >= 7);
  if (!steps.some((x) => x.t !== "survive") || !deep) {
    if (!keys.length) keys.push({ id: "k1", name: "电台的真空管", desc: "用旧报纸包着。", region: far[Math.min(1, far.length - 1)] });
    steps.length = 0;
    steps.push({ t: "collect", key: keys[0].id, hint: "找到" + keys[0].name, done: "" });
    steps.push({ t: "use", region: far[0], object: "radio_desk", label: "修好电台发报", min: 120, need: [keys[0].id], hint: "去" + out.regions[far[0]].name + "的电台", done: "" });
  }
  for (const st of steps) if (!st.hint) st.hint = st.t === "reach" ? "去" + out.regions[st.region].name : st.t === "collect" ? "找到" + keys.find((k) => k.id === st.key).name : st.t === "read" ? "读到 " + st.n + " 份笔记" : st.t === "use" ? st.label : st.t === "fire" ? "在" + out.regions[st.region].name + "生火" : "活到第 " + st.day + " 天";
  // 规则负责把东西放到位：每个区域要放的物品、要有的家具
  const req = {};
  const need = (r) => (req[r] = req[r] || { items: [], objects: [] });
  for (const n of notes) need(n.region).items.push("i_note_" + n.id);
  for (const k of keys) need(k.region).items.push("i_key_" + k.id);
  for (const st of steps) if (st.t === "use" && !need(st.region).objects.includes(st.object)) need(st.region).objects.push(st.object);
  // 人物：每局 1–3 个，不放在起点区域；AI 没给就从池子里随机拼（名字、身份、性格、行动风格都不同）
  const STYLES = ["谨慎", "冒险", "贪婪", "热心", "多疑", "沉默"];
  let people = (Array.isArray(s.people) ? s.people : []).slice(0, 3).map((p) => ({
    name: str(p && p.name, 6), role: str(p && p.role, 20), look: str(p && p.look, 40), personality: str(p && p.personality, 40), style: STYLES.includes(p && p.style) ? p.style : pick(api, STYLES),
    goal: str(p && p.goal, 60), secret: str(p && p.secret, 80), wants: str(p && p.wants, 30), offers: str(p && p.offers, 30), link: str(p && p.link, 60),
    trust: clamp(Math.round(num(p && p.trust, 0)), -50, 50), region: reg(p && p.region, true) })).filter((p) => p.name);
  if (!people.length) {
    const NAMES = ["老韩", "阿雅", "陈默", "铁柱", "苏青", "老周", "小满", "林叔", "阿娟", "白鹭", "钟伯", "七斤"];
    const ROLES = ["伐木工", "护士", "铁路信号员", "猎户", "气象站学徒", "卡车司机", "小学老师", "退伍兵", "修车铺老板", "邮局职员"];
    const PERS = ["话少，心软", "嘴硬，怕冷", "爱算计，但讲信用", "热情得有点过头", "多疑，总在看你的背包", "沉稳，什么都留一手"];
    const GOALS = ["找到走散的家人", "去南边的火车站", "囤够过冬的柴", "找药治腿伤", "回到自己的小屋", "弄清楚那天晚上发生了什么"];
    const SECRETS = ["偷过别人的物资", "知道一个藏东西的地窖", "其实受了伤", "见过你要找的人", "身上带着一把枪的零件", "在等一个不会来的人"];
    const WANTS = ["抗生素", "罐头", "火柴", "干净的水", "绷带", "一件厚外套"];
    const OFFERS = ["柴火", "肉干", "一张手绘地图上的路", "绷带", "信号弹", "消息"];
    const n = ri(api, 1, 3);
    for (let i = 0; i < n; i++) people.push({ name: NAMES.splice(Math.floor(rnd() * NAMES.length), 1)[0], role: pick(api, ROLES), look: "", personality: pick(api, PERS), style: pick(api, STYLES),
      goal: pick(api, GOALS), secret: pick(api, SECRETS), wants: pick(api, WANTS), offers: pick(api, OFFERS), link: "", trust: ri(api, -20, 20), region: null });
  }
  people = people.map((p, i) => Object.assign(p, { id: "p" + (i + 1), region: p.region || ids[1 + Math.floor(rnd() * (ids.length - 1))] }));
  const e = s.ending || {};
  return { people, who: str(s.who, 80), premise: str(s.premise, 120), missing: str(s.missing, 80), goal: str(s.goal, 80) || steps[0].hint,
    notes, keys, steps, req, ending: { title: str(e.title, 12) || "雪停之后", text: str(e.text, 300) || "" } };
}

// ───────── 世界层 ─────────
function fixWorld(api, j) {
  const out = { regions: {}, links: [], start: "", story: {}, weather: [] };
  const regs = Array.isArray(j && j.regions) ? j.regions.slice(0, 10) : [];
  regs.forEach((r, i) => {
    const id = "r" + (i + 1);
    out.regions[id] = { id, src: str(r && r.id, 12), name: str(r && r.name, 10) || "无名之地" + (i + 1), biome: BIOMES.includes(r && r.biome) ? r.biome : pick(api, BIOMES),
      desc: str(r && r.desc, 80), danger: clamp(Math.round(num(r && r.danger, 1)), 0, 3), nb: clamp(Math.round(num(r && r.buildings, 3)), 2, 6) };
  });
  const ids = Object.keys(out.regions);
  if (ids.length < 5) return null;
  const bySrc = {}; for (const id of ids) bySrc[out.regions[id].src || id] = id;
  const map = (x) => bySrc[x] || (out.regions[x] ? x : null);
  const seen = {};
  for (const l of Array.isArray(j.links) ? j.links : []) {
    const a = map(l && l[0]), b = map(l && l[1]);
    if (!a || !b || a === b) continue;
    const k = [a, b].sort().join("-"); if (seen[k]) continue; seen[k] = 1;
    out.links.push([a, b, str(l[2], 16)]);
  }
  // 度数上限 4（按顺序保留）；再把不连通的区域接上
  const kept = [], dg = {};
  for (const l of out.links) if ((dg[l[0]] || 0) < 4 && (dg[l[1]] || 0) < 4) { kept.push(l); dg[l[0]] = (dg[l[0]] || 0) + 1; dg[l[1]] = (dg[l[1]] || 0) + 1; }
  out.links = kept;
  out.start = map(j.start) || ids[0];
  for (let guard = 0; guard < 12; guard++) {
    const comp = reach(out.links, out.start);
    const lone = ids.find((r) => comp[r] === undefined);
    if (!lone) break;
    // 接到离起点最远、还有空位的已连通区域上（保持"越走越深"）
    const host = ids.filter((r) => comp[r] !== undefined && (dg[r] || 0) < 4).sort((a, b) => comp[b] - comp[a])[0] || out.start;
    out.links.push([host, lone, "小路"]); dg[host] = (dg[host] || 0) + 1; dg[lone] = (dg[lone] || 0) + 1;
  }
  // 故事
  out.story = fixStory(api, j.story || {}, out, map);
  out.weather = fixWeather(api, j.weather);
  return out;
}

const WX = { clear: [-5, -20], overcast: [-5, -18], cloudy: [-5, -18], snow: [-6, -20], heavy_snow: [-8, -22], blizzard: [-10, -25], fog: [-4, -15], frigid: [-15, -30] };

function fixWeather(api, list) {
  const out = []; let lastBliz = -1e9;
  const segs = (Array.isArray(list) ? list : []).slice(0, 40)
    .map((w) => ({ at: (clamp(Math.round(num(w && w.d, 1)), 1, 30) - 1) * 1440 + clamp(Math.round(num(w && w.h, 6)), 0, 23) * 60, len: clamp(Math.round(num(w && w.len, 6)), 1, 24) * 60,
      type: WX[w && w.type] ? w.type : "overcast", t: num(w && w.t, -12), wind: clamp(num(w && w.wind, 5), 0, 25) }))
    .sort((a, b) => a.at - b.at);
  for (const w of segs) {
    let type = w.type, len = w.len;
    if (type === "blizzard") {
      if (w.at < 8 * 60 + 360 || w.at - lastBliz < 72 * 60 - 0) type = "heavy_snow"; // 开局 6 小时内、或 3 天内已有一次 → 降级
      else { len = clamp(len, 180, 720); lastBliz = w.at; }
    }
    const [hi, lo] = WX[type];
    out.push({ at: w.at, len, type, t: clamp(w.t, lo, hi), wind: type === "blizzard" ? clamp(w.wind, 15, 25) : clamp(w.wind, 0, 15) });
  }
  return out;
}

function fallbackWorld(api) {
  const n = ri(api, 6, 8);
  const pre = ["灰松", "鸦鸣", "断桥", "北风", "盐碱", "老熊", "白桦", "铁锈", "霜口", "回声", "黑水", "孤灯", "钟声", "冷杉", "石门", "雾谷"];
  const suf = { 林地河谷: "谷", 湖区: "湖", 山地: "岭", 铁路沿线: "站", 小镇废墟: "镇", 水坝峡谷: "峡", 海岸: "湾" };
  const regs = [];
  for (let i = 0; i < n; i++) { const b = pick(api, BIOMES); const p = pre.splice(Math.floor(rnd() * pre.length), 1)[0]; regs.push({ id: "r" + (i + 1), name: p + suf[b], biome: b, desc: "", danger: ri(api, 0, 2) + (i > 3 ? 1 : 0), buildings: ri(api, 2, 5) }); }
  const links = []; for (let i = 1; i < n; i++) links.push(["r" + (1 + Math.floor(rnd() * Math.min(i, i))), "r" + (i + 1), "小路"]);
  if (n > 4) links.push(["r2", "r" + n, "铁轨"]);
  return fixWorld(api, {
    regions: regs, links, start: "r1",
    story: { who: "你是来北方做冬季勘测的测绘员。", premise: "一场无声的大雪之后，电话、收音机、车子都不响了。", missing: "勘测队的老向导没有回到营地。",
      goal: "沿着向导留下的记号，找到还能发报的电台。",
      notes: [{ region: "r2", title: "向导的便条", text: "电线全断了。我往东去找电台，沿路给你留记号。别在夜里走。" }, { region: "r3", title: "撕下的日记", text: "第三天。狼跟了我一路。电台的真空管我藏在柜子里了，别弄丢。" }],
      keys: [{ id: "tube", name: "电台的真空管", desc: "用旧报纸包着，还完好。", region: "r3" }],
      steps: [{ t: "read", n: 1, hint: "找到向导留下的记号" }, { t: "collect", key: "tube", hint: "找到电台的真空管" }, { t: "use", region: "r" + n, object: "radio_desk", label: "装好真空管发报", minutes: 120, need: ["tube"], hint: "去最远处的电台" }],
      ending: { title: "回应", text: "耳机里传来一个人的声音。有人知道你在这里了。" } },
    weather: [],
  });
}

function applyWorld(api, w, fromAi) {
  const defs = {};
  for (const it of BASE_ITEMS) defs[it.id] = fixItem(it);
  defs.i_meat_raw.kcal = 800; defs.i_meat.kcal = 800;
  for (const c of w.story.notes) defs["i_note_" + c.id] = { id: "i_note_" + c.id, name: c.title, cat: "note", kg: 0.01, desc: "", note: c.id };
  for (const k of w.story.keys) defs["i_key_" + k.id] = { id: "i_key_" + k.id, name: k.name, cat: "key", kg: 0.2, desc: k.desc, key: k.id };
  api.state.set("end_title", w.story.ending.title); api.state.set("end_text", w.story.ending.text);
  // 人物的运行状态（规则管生存数值和背包，AI 管想法）
  const starter = [["i_can_beans", 1], ["i_jerky", 1], ["i_match", 1], ["i_water", 1], ["i_bandage", 1], ["i_cracker", 1], ["i_tea", 1], ["i_flare", 1]];
  api.state.set("npcs", w.story.people.map((p) => ({ id: p.id, name: p.name, rid: p.region, alive: true, cond: 100, kcal: 1800, trust: p.trust, met: false,
    // 开局物资和玩家一样（参照《漫漫长夜》的开局：一身基础衣物、一盒火柴、一点吃的、几根细枝），
    // 外加一样他们在你来之前已经找到的东西
    inv: [["i_match", 1], ["i_stick", 2], ["i_bar", 1], ["i_cloth", 1], starter[ri(api, 0, 7)]],
    water: 2.2, warm: 80, plan: { t: "stay" }, mem: [], gave: -1, home: null })));
  w.itemsAi = 0;
  for (const raw of Array.isArray(w.rawItems) ? w.rawItems.slice(0, 30) : []) {
    const it = fixItem(raw); if (!it || defs[it.id]) continue;
    defs[it.id] = it; w.itemsAi++;
  }
  delete w.rawItems;
  api.state.set("defs", defs);
  w.ai = !!fromAi;
  api.state.set("world", w);
  queue(api, "region", w.start);
}

export function run(api) {
  seedFrom(api);
  const j = parseLoose(api.params.s);
  let w = j ? fixWorld(api, j) : null;
  if (w) w.rawItems = j.items;
  if (!w) { w = fallbackWorld(api); w.rawItems = []; }
  applyWorld(api, w, !!j);
  return true;
}
