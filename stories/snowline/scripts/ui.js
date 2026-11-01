// 雪线 · 交互与界面（ui.js）：菜单、背包、搜索、生火、睡觉、制作、搏斗结算、AI 请求调度。
// 只在玩家按键或动作完成时被 tick.js 调用（低频），所以可以慢一点。

const T = 64, DAY = 1440, RATE = 0.2;
const FNAME = { bed: "床", bunk: "双层床", bedroll: "睡袋", stove: "铁炉", barrel_stove: "油桶炉", fireplace: "壁炉", cabinet: "橱柜", drawer: "抽屉柜", wardrobe: "衣柜",
  kitchen_counter: "厨房台面", fridge: "冰箱", desk: "书桌", bookshelf: "书架", workbench: "工作台", crate: "木箱", locker: "储物柜", safe: "保险柜", sink: "水槽",
  first_aid: "急救箱", barrel: "铁桶", bucket: "水桶", woodpile: "柴堆", altar: "祭坛", radio_desk: "电台", control_panel: "控制台", corpse: "遗体", car: "抛锚的车",
  dead_tree: "枯树", log_pile: "原木堆", carcass: "鹿尸", campfire: "篝火堆" };
const WXNAME = { clear: "晴", overcast: "阴", cloudy: "多云", snow: "小雪", heavy_snow: "大雪", blizzard: "暴风雪", fog: "雾", frigid: "极寒晴夜" };
const SLOTS = { hat: "帽子", coat: "外套", shirt: "上衣", pants: "裤子", gloves: "手套", boots: "靴子", socks: "袜子" };
const FUEL = ["fuel_stick", "fuel_soft", "fuel_hard", "fuel_coal"];
const RECIPES = [
  { id: "bandage", name: "绷带", need: [["cloth", 1]], out: "i_bandage", min: 10 },
  { id: "tinder", name: "引火物", need: [["paper|cloth", 1]], out: "i_tinder", min: 5 },
  { id: "torch", name: "火把", need: [["fuel_stick", 1], ["cloth", 1]], out: "i_torch", min: 10 },
  { id: "hidecoat", name: "鹿皮袄", need: [["hide", 3]], tool: "sewing", bench: true, out: "i_hidecoat", min: 300 },
];
const NEEDNAME = { cloth: "碎布", "paper|cloth": "纸或布", fuel_stick: "细枝", hide: "鹿皮" };
const INSPIRE = [["测绘员", "护林员", "货运司机", "气象站值班员", "退休教师", "兽医", "电工", "捕兽人的女儿", "邮差", "教堂看守", "灯塔看守", "矿工"],
  ["无声的大雪", "极光后的停电", "一列没有到站的火车", "水坝闸门失灵", "镇上的人一夜之间走空", "电台里反复播放的同一段话", "持续三周的极夜", "一场没人预报的寒潮"],
  ["寻找失踪的哥哥", "把药送到山那边", "找到坠落的气象气球", "找回丢失的狗", "完成最后一次巡山", "兑现一个约定", "把一封信交给收信人"]];
const TIMEOUT = { world: 150000, region: 120000, building: 75000 };
const ENTRY = { world: "gen_world", region: "gen_region", building: "gen_building" };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
let _s = 1;
function seedFrom(api) { _s = api.random.int(1, 2147483646) >>> 0; }
function rnd() { _s = (_s + 0x6d2b79f5) >>> 0; let t = _s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (l) => l[Math.floor(rnd() * l.length)];
const hhmm = (m) => { const h = Math.floor((m % DAY) / 60), mm = Math.floor(m % 60); return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm; };
function sfx(api, id, vol) { api.sound.play(id, { volume: vol === undefined ? 0.8 : vol }); }
const LIGHTS = { lantern: 1, flashlight: 1, candle: 1, torch: 1 };
const DARK = 0.3;
function tooDark(api, g, what) { if ((g.bright === undefined ? 1 : g.bright) < DARK) { toast(api, g, "太黑了，" + what + "。先弄点光。"); return true; } return false; }
function hist(g, text) { g.hist = (g.hist || []).concat(["第" + (Math.floor(g.clock / DAY) + 1) + "天" + hhmm(g.clock) + " " + text]).slice(-30); }
function toast(api, g, text) { g.toast = (g.toast || []).filter((m) => api.time - m.t < 6000).concat([{ t: api.time, text }]).slice(-4); }

// ───────── 背包 ─────────
function invKg(g, defs) { let s = 0; for (const e of g.inv) s += ((defs[e.id] || {}).kg || 0) * e.n; for (const k in g.wear) s += ((defs[g.wear[k]] || {}).kg || 0); return s; }
function invHas(g, defs, test) { return g.inv.find((e) => { const d = defs[e.id]; return d && test(d, e); }); }
function invAdd(g, defs, id, n) {
  const d = defs[id]; if (!d) return;
  if (d.uses && d.cat !== "bandage") { for (let i = 0; i < n; i++) g.inv.push({ id, n: 1, u: d.uses }); return; }
  const e = g.inv.find((x) => x.id === id);
  if (e) e.n += n; else g.inv.push({ id, n });
}
function invTake(g, e, n) { e.n -= n || 1; if (e.n <= 0) g.inv.splice(g.inv.indexOf(e), 1); }
function useCharge(g, e) { if (e.u !== undefined) { e.u -= 1; if (e.u <= 0) invTake(g, e, 1); } else invTake(g, e, 1); }
function hasTool(g, defs, cat) { return !!invHas(g, defs, (d) => d.cat === cat); }
function clothing(g, defs) { let w = 0, p = 0; for (const k in g.wear) { const d = defs[g.wear[k]]; if (d) { w += d.warm || 0; p += d.wind || 0; } } return { w, p }; }
// 每帧要用的派生值缓存进 g，让 tick.js 不必每帧读物品表
function recalc(g, defs) {
  g.kg = r1(invKg(g, defs)); g.cw = clothing(g, defs);
  g.tools = { knife: hasTool(g, defs, "knife"), hatchet: hasTool(g, defs, "hatchet"), meat: g.inv.some((e) => /_raw$/.test((defs[e.id] || {}).cat || "")) };
}
function itemLabel(d, e) {
  let s = d.name + (e.n > 1 ? " ×" + e.n : "");
  if (d.kcal) s += "  " + Math.round(d.kcal) + " kcal";
  if (d.water && String(d.cat).startsWith("water")) s += "  " + d.water + " L";
  if (e.u !== undefined && d.cat !== "bandage") s += "  剩" + e.u;
  if (d.warm) s += "  保暖" + d.warm + "°";
  return s;
}

// ───────── 菜单 ─────────
function openMenu(g, title, items, kind, ref) { g.ui = { mode: "menu", menu: { title, items, cur: 0, kind }, ref }; }
function closeUi(g) { g.ui = { mode: "play" }; }
function cellAt(lvl, x, y) { const tx = Math.floor(x / T), ty = Math.floor(y / T); if (tx < 0 || ty < 0 || tx >= lvl.w || ty >= lvl.h) return "#"; return lvl.c[ty][tx]; }
function invMenu(g, defs, lvl) {
  const items = [];
  if (!g.inside && ".dr".includes(cellAt(lvl, g.pc.x, g.pc.y))) items.push({ l: "· 在这里生火", a: "campfire" });
  items.push({ l: "· 制作…", a: "craft_menu" });
  items.push({ l: "· 身上穿着…", a: "wear_menu" });
  if ((g.diary || []).length) items.push({ l: "· 日记（" + g.diary.length + " 篇）", a: "diary" });
  g.inv.forEach((e, k) => { const d = defs[e.id]; if (d) items.push({ l: itemLabel(d, e), a: "item", p: k }); });
  openMenu(g, "背包  " + r1(invKg(g, defs)) + " / 30 kg", items, "inv");
}
function itemMenu(g, defs, idx) {
  const e = g.inv[idx]; if (!e) return;
  const d = defs[e.id], c = d.cat, items = [];
  if (d.kcal !== undefined && c !== "water_safe" && c !== "water_unsafe") items.push({ l: c === "drink" ? "喝掉" : /_raw$/.test(c) ? "生吃（有风险）" : "吃掉", a: "eat", p: idx });
  if (c === "water_safe") items.push({ l: "喝 " + d.water + " L", a: "drink", p: idx });
  if (c === "water_unsafe") { items.push({ l: "直接喝（有风险）", a: "drink", p: idx }); if (hasTool(g, defs, "tablets")) items.push({ l: "用净水药片处理", a: "purify", p: idx }); }
  if (SLOTS[c]) items.push({ l: "穿上（" + SLOTS[c] + "）", a: "wear", p: idx });
  if (c === "note") items.push({ l: "阅读", a: "read", p: idx });
  if (c === "flare") items.push({ l: "点燃（照亮四周、吓退附近的狼）", a: "flare", p: idx });
  if (LIGHTS[c]) {
    const on = g.lit && g.lit.id === e.id;
    if (on) items.push({ l: "熄灭", a: "light_off", p: idx });
    else items.push({ l: (e.u || 0) > 0 ? "点亮（还能用 " + Math.round(e.u) + " 分钟）" + (c === "flashlight" ? "" : "，要用一根火柴") : c === "lantern" ? "没油了" : c === "flashlight" ? "没电了" : "烧完了", a: "light_on", p: idx, dis: !((e.u || 0) > 0) });
    const refill = c === "lantern" ? "lamp_oil" : c === "flashlight" ? "battery" : null;
    const r = refill && invHas(g, defs, (d) => d.cat === refill);
    if (r) items.push({ l: (c === "lantern" ? "加灯油（+" : "换电池（+") + defs[r.id].burn + " 分钟）", a: "refill", p: idx });
  }
  if (["bandage", "antibiotic", "painkiller"].includes(c)) items.push({ l: "使用", a: "med", p: idx });
  if (c !== "note") items.push({ l: "丢掉", a: "drop", p: idx });
  items.push({ l: "返回", a: "inv" });
  openMenu(g, d.name + (d.desc ? "  —— " + d.desc : ""), items, "item");
}
function fireKey(g, i) { return g.rid + ":" + i.x + "," + i.y; }
function fireMenu(g, defs, i) {
  const items = [], f = g.fire[fireKey(g, i)];
  if (f && f.fuel > 0) {
    items.push({ l: "（火还能烧 " + Math.round(f.fuel) + " 分钟）", a: "none" });
    g.inv.forEach((e, k) => { const d = defs[e.id]; if (d && FUEL.includes(d.cat)) items.push({ l: "添 " + d.name + "（+" + d.burn + " 分钟）", a: "addfuel", p: k }); });
    const pot = invHas(g, defs, (d) => d.cat === "pot" || d.cat === "can_empty");
    if (pot) items.push({ l: "烧水（" + (defs[pot.id].cat === "pot" ? "1.0" : "0.5") + " L / 10 分钟）", a: "boil" });
    g.inv.forEach((e, k) => { const d = defs[e.id]; if (d && /_raw$/.test(d.cat) && d.kcal) items.push({ l: "烤 " + d.name + "（15 分钟）", a: "cook", p: k }); });
    items.push({ l: "在火边坐一小时", a: "sit" });
  } else {
    const fuel = invHas(g, defs, (d) => FUEL.includes(d.cat));
    g.inv.forEach((e, k) => { const d = defs[e.id]; if (d && (d.cat === "matches" || d.cat === "flint")) items.push({ l: "用" + d.name + "点火" + (fuel ? "" : "（没有燃料）"), a: "light", p: k, dis: !fuel }); });
    if (!items.length) items.push({ l: "（没有火柴也没有打火石）", a: "none" });
  }
  items.push({ l: "离开", a: "close" });
  openMenu(g, FNAME[i.t] || "火堆", items, "fire", i.x + "," + i.y);
}
function craftMenu(g, defs, atBench) {
  const items = RECIPES.map((r) => {
    const ok = r.need.every(([cats, n]) => g.inv.filter((e) => cats.split("|").includes((defs[e.id] || {}).cat)).reduce((s, e) => s + e.n, 0) >= n) && (!r.tool || hasTool(g, defs, r.tool)) && (!r.bench || atBench);
    return { l: r.name + "（" + r.need.map(([c, n]) => NEEDNAME[c] + "×" + n).join("、") + (r.tool ? "、针线包" : "") + (r.bench ? "，需工作台" : "") + "，" + (r.min >= 60 ? r.min / 60 + " 小时" : r.min + " 分钟") + "）", a: "craft", p: r.id, dis: !ok };
  });
  items.push({ l: "返回", a: "close" });
  openMenu(g, "制作", items, "craft");
}
function lootMenu(g, defs, i) {
  const items = [];
  if (i.items.length > 1) items.push({ l: "全部拿走", a: "takeall" });
  i.items.forEach(([id, n], k) => { const d = defs[id]; if (d) items.push({ l: d.name + (n > 1 ? " ×" + n : "") + (d.kcal ? "  " + Math.round(d.kcal) + " kcal" : ""), a: "take", p: k }); });
  if (!i.items.length) items.push({ l: "（空的）", a: "none" });
  items.push({ l: "离开", a: "close" });
  openMenu(g, i.name || FNAME[i.t] || "容器", items, "loot", i.x + "," + i.y);
}
function findIx(lvl, ref) { const [x, y] = String(ref).split(",").map(Number); return lvl.ix.find((i) => i.x === x && i.y === y); }
function startBusy(g, label, minutes, rate, act, p, extra) { g.busy = Object.assign({ l: label, need: minutes, done: 0, rate, act, p }, extra || {}); closeUi(g); }
function tempOf(d) { return { fuel_stick: 10, fuel_soft: 20, fuel_hard: 30, fuel_coal: 35 }[d.cat] || 10; }

// ───────── 叙事（AI 旁白，异步） ─────────
function narrate(api, g, event, extra) {
  if (api.time - (g.narrT || -99999) < 20000 && !(extra && extra.force)) return;
  g.narrT = api.time;
  const world = api.state.get("world");
  const R = world.regions[g.rid] || {};
  const info = Object.assign({ 事件: event, 地点: (R.name || "") + (g.insideName ? "·" + g.insideName : ""), 时间: "第" + (Math.floor(g.clock / DAY) + 1) + "天 " + hhmm(g.clock), 天气: WXNAME[(g.wxNow || {}).type] || "",
    身体: (g.body.cond < 30 ? "很虚弱" : "还撑得住") + (g.body.warm < 25 ? "，冷得发抖" : ""), 主角: world.story.who }, extra || {});
  delete info.force;
  api.ai.request("narrate", "", { brief: JSON.stringify(info) });
}

// ───────── 入口 ─────────
export function ui(api) {
  seedFrom(api);
  const op = api.params.op;
  const g = api.state.get("g");
  if (op === "dispatch") { dispatch(api, g); api.state.set("g", g); return true; }
  const defs = api.state.get("defs"), lvl = api.state.get("lvl");
  if (op === "recalc") recalc(g, defs);
  else if (op === "goal") goalCheck(api, g, defs, lvl);
  else if (op === "hour") hourly(api, g, defs, lvl, true);
  else if (op === "arrive") hourly(api, g, defs, lvl, false);
  else if (op === "director") directorApply(api, g, defs, lvl, api.params.s);
  else if (op === "diary") { const t = String(api.params.s || "").trim(); g.diary = (g.diary || []).concat([{ day: api.params.v, text: t.slice(0, 600) || ruleDiary(g, api.params.v) }]).slice(-40); toast(api, g, "（日记里多了一篇）"); }
  else if (op === "narrate") { const e = JSON.parse(api.params.s || "{}"); narrate(api, g, e.event, e.extra); }
  else if (op === "input") { if (g.ui.mode === "play") playInput(api, g, defs, lvl); else menuInput(api, g, defs, lvl); recalc(g, defs); }
  else if (op === "busy_done") { finishBusy(api, g, defs, lvl); recalc(g, defs); }
  else if (op === "struggle_end") endStruggle(api, g, api.params.v > 0);
  if (lvl && lvl.dirty) { delete lvl.dirty; api.state.set("lvl", lvl); }
  api.state.set("g", g);
  return true;
}

function playInput(api, g, defs, lvl) {
  const p = api.input.pressed || {};
  if (p.inv) return invMenu(g, defs, lvl);
  if (p.map) { g.ui = { mode: "map" }; return; }
  if (p.use && g.focus) interact(api, g, defs, lvl);
}

function interact(api, g, defs, lvl) {
  const f = g.focus, world = api.state.get("world");
  if (f.k === "gi") {
    const it = lvl.gi[f.ref]; if (!it) return;
    if (invKg(g, defs) + ((defs[it.id] || {}).kg || 0) * it.n > 45) { toast(api, g, "背不动了。"); return; }
    invAdd(g, defs, it.id, it.n); lvl.gi.splice(f.ref, 1); lvl.dirty = true; sfx(api, "pickup", 0.7);
    toast(api, g, "拾取：" + ((defs[it.id] || {}).name || "") + (it.n > 1 ? " ×" + it.n : ""));
    onPickup(api, g, defs, it.id, world);
    return;
  }
  if (f.k === "door") {
    const b = lvl.bld.find((x) => x.id === f.ref);
    if (b && !b.ready) {
      g.doorWait = b.id;
      const q = api.state.get("aiq"), key = g.rid + "|" + b.id;
      if (!q.done["building:" + key] && !q.want.some((w) => w.id === key) && !Object.values(q.pend).some((x) => x.id === key)) { q.want.unshift({ k: "building", id: key }); api.state.set("aiq", q); }
      toast(api, g, "门被冻住了，你用肩膀一下下地撞……");
      startBusy(g, "撞开冻住的门……（AI 正在生成屋内）", 9999, RATE, "enter", null, { real: true });
    }
    return;
  }
  if (f.k === "dark") { toast(api, g, "太黑了，什么也看不清。打开背包，点亮一盏灯或者生火。"); return; }
  if (f.k === "npc") return startTalk(api, g, defs, f.ref);
  if (f.k === "mark") { const m = findIx(lvl, f.ref); if (m) { sfx(api, "page", 0.4); g.ui = { mode: "note", title: "痕迹", text: m.text }; if (!m.seen) { m.seen = true; lvl.dirty = true; hist(g, "看到痕迹：" + m.text.slice(0, 30)); } } return; }
  if (f.k === "goal") {
    const st = world.story.steps[g.goal.i]; if (!st || st.t !== "use") return;
    const miss = st.need.filter((k) => !g.inv.some((e) => e.id === "i_key_" + k));
    if (miss.length) { toast(api, g, "还缺：" + miss.map((k) => (defs["i_key_" + k] || {}).name).join("、")); return; }
    startBusy(g, st.label + "……", st.min, 12, "use", g.goal.i, {}); return;
  }
  if (f.k === "lock") { if (hasTool(g, defs, "prybar")) startBusy(g, "撬门……", 5, 3, "pry_door", f.p); else toast(api, g, "门锁着。需要撬棍。"); return; }
  const i = findIx(lvl, f.ref); if (!i) return;
  switch (i.k) {
    case "cont":
      if (i.lock) { if (hasTool(g, defs, "prybar")) startBusy(g, "撬开" + (FNAME[i.t] || "") + "……", 10, 6, "pry", null, { ref: f.ref }); else toast(api, g, "锁着。需要撬棍。"); return; }
      if (!i.s) { startBusy(g, "搜索" + (i.name || FNAME[i.t] || "") + "……", 1.2, 1, "search", null, { ref: f.ref, real: true }); sfx(api, "rummage", 0.8); }
      else lootMenu(g, defs, i);
      return;
    case "heat": fireMenu(g, defs, i); return;
    case "bed": openMenu(g, "睡多久？", [1, 2, 4, 8, 12].map((h) => ({ l: "睡 " + h + " 小时", a: "sleep", p: h })).concat([{ l: "离开", a: "close" }]), "sleep"); return;
    case "bench": craftMenu(g, defs, true); return;
    case "wood": sfx(api, "snap", 0.8); startBusy(g, "收集柴火……", hasTool(g, defs, "hatchet") ? 20 : 30, 10, "wood", null, { ref: f.ref }); return;
    case "carcass": sfx(api, "rummage", 0.5); startBusy(g, "剥取……", hasTool(g, defs, "knife") ? 40 : hasTool(g, defs, "hatchet") ? 50 : 90, 12, "carcass", null, { ref: f.ref }); return;
  }
}
function onPickup(api, g, defs, id, world) {
  const d = defs[id]; if (!d) return;
  if (d.cat === "note" && d.note && !(g.read || []).includes(d.note) && (g.bright === undefined ? 1 : g.bright) < DARK) { toast(api, g, "纸上有字，可太黑了看不清。有光的时候在背包里读。"); return; }
  if (d.cat === "note" && d.note && !(g.read || []).includes(d.note)) {
    g.read = (g.read || []).concat([d.note]);
    const c = world.story.notes.find((x) => x.id === d.note);
    g.ui = { mode: "note", title: c ? c.title : d.name, text: c ? c.text : "" }; sfx(api, "page", 0.7);
    hist(g, "读到笔记《" + (c ? c.title : "") + "》");
    narrate(api, g, "读到一份笔记：" + (c ? c.title : ""), { 笔记内容: c ? c.text : "", force: true });
  }
  if (d.cat === "key") { hist(g, "找到了" + d.name); toast(api, g, "这就是它：" + d.name); }
  goalCheck(api, g, defs, api.state.get("lvl"));
}

// ───────── AI 设计的结局：按步骤推进（规则判定） ─────────
function goalCheck(api, g, defs, lvl) {
  const world = api.state.get("world"); const steps = world.story.steps;
  g.goal = g.goal || { i: 0, used: -1 };
  for (let guard = 0; guard < 8 && g.goal.i < steps.length; guard++) {
    const st = steps[g.goal.i]; let ok = false;
    if (st.t === "reach") ok = g.rid === st.region && (!st.bt || (g.inside && ((lvl && lvl.bld) || []).some((b) => b.id === g.inside && b.type === st.bt)));
    else if (st.t === "collect") ok = g.inv.some((e) => e.id === "i_key_" + st.key);
    else if (st.t === "read") ok = (g.read || []).length >= st.n;
    else if (st.t === "use") ok = g.goal.used === g.goal.i;
    else if (st.t === "fire") ok = Object.values(g.fire || {}).some((f) => f.rid === st.region);
    else if (st.t === "survive") ok = Math.floor(g.clock / DAY) + 1 >= st.day;
    if (!ok) break;
    toast(api, g, "✓ " + st.hint); hist(g, "完成：" + st.hint); sfx(api, "bell", 0.7);
    if (st.done) g.narr = { t: api.time, text: st.done };
    else narrate(api, g, "完成了一步：" + st.hint, { force: true });
    g.goal.i++;
  }
  if (g.goal.i >= steps.length) { api.state.set("outcome", "fulfilled"); return; }
  const st = steps[g.goal.i];
  g.goalNow = { i: g.goal.i, n: steps.length, hint: st.hint, t: st.t, region: st.region || "", object: st.object || "", label: st.label || "", rname: st.region ? world.regions[st.region].name : "" };
}

// ───────── 交谈 ─────────
function startTalk(api, g, defs, id) {
  const npcs = api.state.get("npcs"), world = api.state.get("world");
  const n = npcs.find((x) => x.id === id); if (!n || !n.alive) return;
  const p = world.story.people.find((x) => x.id === id) || {};
  const lvl = n;
  if (!n.met) { n.met = true; hist(g, "遇见了" + n.name); }
  const lvlBand = (v, a, b) => (v < a ? "很差" : v < b ? "一般" : "还好");
  const ctxText = [
    "【你要扮演的人】" + n.name + "，" + p.role + "。外貌：" + p.look + "。性格：" + p.personality + "。",
    "想要：" + p.goal + "。缺：" + p.wants + "。能拿出来的：" + p.offers + "。秘密（不要轻易说）：" + p.secret + "。和这个故事的关系：" + p.link + "。",
    "【此刻的状态】身体" + lvlBand(n.cond, 30, 70) + "，饥饿" + (n.kcal < 600 ? "很饿" : n.kcal < 1200 ? "有点饿" : "不饿") + "，" + (n.warm < 30 ? "冻得发抖" : "还算暖和") + "。对玩家的信任：" + n.trust + "（−100 到 100）。当前打算：" + n.plan.t + "。",
    "【你身上的东西（物品id=名字×数量）】" + (n.inv.map((e) => e[0] + "=" + ((defs[e[0]] || {}).name || e[0]) + "×" + e[1]).join("，") || "什么都没有"),
    "【玩家身上的东西】" + (g.inv.map((e) => e.id + "=" + ((defs[e.id] || {}).name || e.id) + "×" + e.n).join("，") || "什么都没有"),
    "【你记得的事】" + ((n.mem || []).join("；") || "第一次见到玩家"),
    "【玩家的处境】" + (g.body.cond < 40 ? "看起来很虚弱" : "还撑得住") + "；玩家正在做的事：" + ((g.goalNow || {}).hint || ""),
    "【故事背景】" + world.story.premise,
  ].join("\n");
  api.state.set("talk_npc", id); api.state.set("talk_ctx", ctxText.slice(0, 3000));
  api.state.set("npcs", npcs);
  g.sess = { npc: id, gain: 0, trades: 0 };
  g.ui = { mode: "talk", npc: id, name: n.name };
  toast(api, g, "在右侧对话框里和" + n.name + "说话（Esc 结束）");
}
function endTalk(api, g) { api.state.set("talk_npc", ""); api.state.set("talk_ctx", ""); g.sess = null; closeUi(g); }

// ───────── 每个游戏小时：人物推演、导演、日记、目标 ─────────
function hourly(api, g, defs, lvl, sim) {
  if (sim && g.clock >= (g.nextNpc || 720)) { g.nextNpc = g.clock + 720; api.state.set("g", g); api.actions.call("npc_hour", {}); Object.assign(g, api.state.get("g")); lvl = api.state.get("lvl"); }
  const npcs = api.state.get("npcs") || [];
  // 同一区域的人：生成/同步实体
  for (const n of npcs) {
    const e = g.ents.find((x) => x.id === n.id);
    if (n.alive && n.rid === g.rid) {
      if (!e) {
        const hb = (lvl.bld || []).find((b) => b.id === n.home) || (lvl.bld || [])[0];
        let tx = n.x, ty = n.y;
        if (tx == null && hb && hb.ready) { // 在屋里：站在某件家具旁边
          const fs = lvl.ix.filter((i) => i.bid === hb.id && (i.k === "heat" || i.k === "bed" || i.k === "bench" || i.k === "cont"));
          const f = fs[Math.floor(rnd() * fs.length)];
          for (const [dx, dy] of f ? [[0, f.h], [f.w, 0], [-1, 0], [0, -1]] : []) { const x = f.x + dx, y = f.y + dy; if (lvl.c[y] && lvl.c[y][x] === "f") { tx = x; ty = y; break; } }
        }
        if (tx == null && hb) { tx = hb.x + hb.door; ty = hb.y + hb.h + 1; }
        if (tx == null) { tx = 30; ty = 24; }
        g.ents.push({ k: "npc", id: n.id, name: n.name, doing: n.doing || "", say: n.say || "", sayT: api.time, x: (tx + 0.5) * T, y: (ty + 0.5) * T, hx: (hb ? hb.x + hb.w / 2 : tx) * T, hy: (hb ? hb.y + hb.h / 2 : ty) * T, hr: 3 * T, st: "idle", t: 0, dir: 1 });
      } else { n.x = Math.floor(e.x / T); n.y = Math.floor(e.y / T); e.plan = n.plan.t; }
      const ent = g.ents.find((x) => x.id === n.id);
      ent.plan = n.plan.t;
    } else if (e && (!n.alive || n.rid !== g.rid)) g.ents.splice(g.ents.indexOf(e), 1);
  }
  // 第一次在这片区域碰见某人时，问 AI 一次他在做什么（省算力）
  { const world = api.state.get("world");
    for (const n of npcs) if (n.alive && n.rid === g.rid && n.visit !== g.visitN) { n.visit = g.visitN; mindRequest(api, g, defs, lvl, world, n); } }
  api.state.set("npcs", npcs);
  goalCheck(api, g, defs, lvl);
  if (!sim) return;
  // AI 导演：每 6 个游戏小时
  if (g.clock >= (g.nextDir || 180 + 480)) { g.nextDir = g.clock + 360; director(api, g, defs, npcs); }
  // AI 日记：每天一篇
  const day = Math.floor(g.clock / DAY);
  if (day > (g.diaryDay || 0)) {
    const d0 = g.diaryDay || 0; g.diaryDay = day;
    const events = (g.hist || []).filter((h) => h.startsWith("第" + (d0 + 1) + "天"));
    const req = api.ai.request("diary", "", { brief: JSON.stringify({ 第几天: d0 + 1, 这一天发生的事: events.length ? events : ["没什么特别的，只是活着"], 身体: g.body.cond < 40 ? "很虚弱" : "还撑得住", 主角: api.state.get("world").story.who }) });
    const q = api.state.get("aiq"); q.side = q.side || {}; if (req !== null) { q.side[req] = { k: "diary", day: d0 + 1 }; api.state.set("aiq", q); }
    else g.diary = (g.diary || []).concat([{ day: d0 + 1, text: ruleDiary(g, d0 + 1) }]);
  }
}
function ruleDiary(g, day) { const ev = (g.hist || []).filter((h) => h.startsWith("第" + day + "天")).map((h) => h.replace(/^第\d+天\d\d:\d\d /, "")); return ev.length ? "第" + day + "天。" + ev.join("。") + "。" : "第" + day + "天。风很大，我还活着。"; }
function nextHop(world, from, to) {
  const prev = { [from]: null }, q = [from];
  while (q.length) { const a = q.shift(); if (a === to) break; for (const l of world.links) { const b = l[0] === a ? l[1] : l[1] === a ? l[0] : null; if (b && !(b in prev)) { prev[b] = a; q.push(b); } } }
  if (!(to in prev)) return null; let c = to; while (prev[c] !== from && prev[c] !== null) c = prev[c]; return c;
}

function mindRequest(api, g, defs, lvl, world, n) {
  const p = world.story.people.find((x) => x.id === n.id) || {};
  const here = n.rid === g.rid, L = here ? lvl : api.state.get("c_" + n.rid);
  const conts = L && L.ix ? L.ix.filter((i) => i.k === "cont" && i.items && i.items.length).length : null;
  const info = {
    你是: n.name + "（" + p.role + "，" + p.personality + "，行动风格：" + p.style + "）", 目标: p.goal, 缺: p.wants,
    时间: "第" + (Math.floor(g.clock / DAY) + 1) + "天 " + hhmm(g.clock), 天气: (g.wxNow || {}).type, 气温: (g.wxNow || {}).t,
    所在: (world.regions[n.rid] || {}).name + (n.home ? "，躲在屋里" : "，在外面") + ((n.fireUntil || 0) > g.clock ? "，火在烧" : "，没生火"),
    身体: { 状态: Math.round(n.cond), 热量: Math.round(n.kcal) + "/2500", 水: (n.water || 0).toFixed(1) + "/3L", 体温: Math.round(n.warm || 80) + "%" },
    背包: n.inv.map((e) => e[0] + "=" + ((defs[e[0]] || {}).name || e[0]) + "×" + e[1]),
    周围: { 还有东西的柜子: conts === null ? "不清楚（这片地方你还没细看）" : conts, 有鹿尸: !!(L && L.ix && L.ix.some((i) => i.k === "carcass")), 玩家在附近: here, 玩家手里提着光: !!g.lit, 你对玩家的信任: n.trust },
    相邻区域: world.links.filter((l) => l[0] === n.rid || l[1] === n.rid).map((l) => { const r = l[0] === n.rid ? l[1] : l[0]; return r + "=" + world.regions[r].name; }),
    记得的事: (n.mem || []).slice(-5),
    要你回答: "玩家刚走进这片区域看到你。你此刻在做什么（doing≤12字，例如：在炉子边补靴子）、看到玩家的第一反应（say≤20字）、心情（mood）",
  };
  const req = api.ai.request("npc_mind", "", { brief: JSON.stringify(info) });
  if (req !== null) { const q = api.state.get("aiq"); q.side = q.side || {}; q.side[req] = { k: "mind", id: n.id }; api.state.set("aiq", q); }
}

// ───────── AI 导演：看玩家的处境，决定接下来发生什么（规则限幅） ─────────
function director(api, g, defs, npcs) {
  const world = api.state.get("world");
  const R = world.regions[g.rid] || {};
  const info = {
    时间: "第" + (Math.floor(g.clock / DAY) + 1) + "天 " + hhmm(g.clock), 天气: (g.wxNow || {}).type, 地点: R.name + "（" + R.biome + "，危险" + R.danger + "）",
    玩家: { 状态: Math.round(g.body.cond), 体温: Math.round(g.body.warm), 热量: Math.round(g.body.kcal), 水: g.body.water.toFixed(1), 伤病: Object.keys(g.aff).filter((k) => g.aff[k] && g.aff[k] !== 0 && k !== "freeze" && k !== "hypoOk") },
    目标: (g.goalNow || {}).hint, 进度: (g.goal ? g.goal.i : 0) + "/" + world.story.steps.length, 最近发生的事: (g.hist || []).slice(-8),
    人物: npcs.map((n) => ({ id: n.id, 名字: n.name, 风格: ((api.state.get("world").story.people.find((p) => p.id === n.id)) || {}).style, 活着: n.alive, 在: (world.regions[n.rid] || {}).name, 和玩家同一区域: n.rid === g.rid, 身体: Math.round(n.cond), 饥饿: n.kcal < 800, 信任: n.trust, 打算: n.plan.t, 见过玩家: n.met, 相邻区域: world.links.filter((l) => l[0] === n.rid || l[1] === n.rid).map((l) => (l[0] === n.rid ? l[1] : l[0])) })),
    冷却: { 狼: (g.dcd || {}).wolves > g.clock, 鹿尸: (g.dcd || {}).carcass > g.clock, 物资: (g.dcd || {}).cache > g.clock },
  };
  const req = api.ai.request("director", "", { brief: JSON.stringify(info) });
  if (req !== null) { const q = api.state.get("aiq"); q.side = q.side || {}; q.side[req] = { k: "director" }; api.state.set("aiq", q); }
}
function parseLoose(t) { const a = String(t || "").indexOf("{"), b = String(t || "").lastIndexOf("}"); if (a < 0 || b <= a) return null; try { return JSON.parse(String(t).slice(a, b + 1)); } catch (e) { return null; } }
function freeOutdoor(lvl, g, dmin, dmax) {
  for (let k = 0; k < 120; k++) { const a = rnd() * 6.283, d = dmin + rnd() * (dmax - dmin); const x = Math.floor(g.pc.x / T + Math.cos(a) * d), y = Math.floor(g.pc.y / T + Math.sin(a) * d); if (x > 1 && y > 1 && x < lvl.w - 2 && y < lvl.h - 2 && ".dr".includes(lvl.c[y][x])) return [x, y]; }
  return null;
}
const WXT = { clear: [-5, -20], overcast: [-5, -18], cloudy: [-5, -18], snow: [-6, -20], heavy_snow: [-8, -22], blizzard: [-10, -25], fog: [-4, -15], frigid: [-15, -30] };
function directorApply(api, g, defs, lvl, text) {
  const j = parseLoose(text); if (!j) return;
  const world = api.state.get("world"), npcs = api.state.get("npcs") || [];
  g.dcd = g.dcd || {};
  if (j.line) g.narr = { t: api.time, text: String(j.line).slice(0, 120) };
  const e = j.event || {};
  const R = world.regions[g.rid] || {};
  if (e.t === "weather" && WXT[e.type]) {
    let type = e.type; const hours = clamp(Math.round(Number(e.hours) || 4), 2, 8);
    if (type === "blizzard" && (g.clock < 840 || g.clock - (g.lastBliz || -1e9) < 72 * 60)) type = "heavy_snow";
    if (type === "blizzard") g.lastBliz = g.clock;
    const [hi, lo] = WXT[type];
    g.wx = { type, t: Math.round((hi + lo) / 2), wind: type === "blizzard" ? 18 : type.indexOf("snow") >= 0 ? 8 : 4, until: g.clock + hours * 60, src: "director" };
    hist(g, "天气变成了" + type);
  } else if (e.t === "wolves" && R.danger > 0 && !(g.dcd.wolves > g.clock) && !g.inside) {
    const p = freeOutdoor(lvl, g, 12, 18);
    if (p) { const n = clamp(Math.round(Number(e.n) || 1), 1, 2); for (let k = 0; k < n; k++) g.ents.push({ k: "wolf", x: (p[0] + k) * T, y: p[1] * T, hx: p[0] * T, hy: p[1] * T, hr: 8 * T, st: "stalk", t: 6, dir: 1 }); g.dcd.wolves = g.clock + 12 * 60; }
  } else if (e.t === "carcass" && !(g.dcd.carcass > g.clock)) {
    const p = freeOutdoor(lvl, g, 8, 20);
    if (p) { lvl.ix.push({ k: "carcass", t: "carcass", x: p[0], y: p[1], w: 1, h: 1, n: 1 }); const h = api.state.get("here"); h.o[p[1]][p[0]] = 44; api.state.set("here", h); lvl.dirty = true; g.dcd.carcass = g.clock + 24 * 60; }
  } else if (e.t === "cache" && defs[e.item] && !(g.dcd.cache > g.clock)) {
    const d = defs[e.item]; const n = clamp(Math.round(Number(e.n) || 1), 1, 3);
    const okCat = !["key", "note", "knife", "hatchet", "prybar", "flint"].includes(d.cat) && (d.kcal || 0) * n <= 600 && (d.cat !== "matches" || n === 1);
    const p = okCat && freeOutdoor(lvl, g, 6, 18);
    if (p) { lvl.gi.push({ x: p[0], y: p[1], id: e.item, n, nm: d.name }); if (e.text) lvl.ix.push({ k: "mark", t: "mark", x: p[0], y: Math.min(lvl.h - 2, p[1] + 1), w: 1, h: 1, text: String(e.text).slice(0, 120) }); lvl.dirty = true; g.dcd.cache = g.clock + 24 * 60; }
  } else if ((e.t === "sign" || e.t === "memory") && e.text) {
    if (e.t === "sign") { const p = freeOutdoor(lvl, g, 4, 10); if (p) { lvl.ix.push({ k: "mark", t: "mark", x: p[0], y: p[1], w: 1, h: 1, text: String(e.text).slice(0, 120) }); lvl.dirty = true; } }
    else g.narr = { t: api.time, text: String(e.text).slice(0, 160) };
  }
  // 人物的新打算（AI 决定，规则检查）
  for (const d of Array.isArray(j.npcs) ? j.npcs.slice(0, 3) : []) {
    const n = npcs.find((x) => x.id === d.id); if (!n || !n.alive) continue;
    if (d.trace) n.traceText = (n.traceText || []).concat([String(d.trace).slice(0, 120)]).slice(-3);
    const adj = world.links.some((l) => (l[0] === n.rid && l[1] === d.to) || (l[1] === n.rid && l[0] === d.to));
    if (d.plan === "move" && world.regions[d.to] && d.to !== n.rid && adj) n.plan = { t: "move", to: d.to };
    else if (d.plan === "follow" && n.rid === g.rid && n.trust >= 20) n.plan = { t: "follow" };
    else if (["stay", "avoid", "wait"].includes(d.plan)) n.plan = { t: d.plan };
  }
  api.state.set("npcs", npcs);
}

function menuInput(api, g, defs, lvl) {
  const inp = api.input, p = inp.pressed || {}, j = inp.joystick || { x: 0, y: 0 };
  const jy = j.y > 0.6 ? 1 : j.y < -0.6 ? -1 : 0;
  const jedge = jy !== (g.jy || 0); g.jy = jy;
  if (g.ui.mode === "talk") { if (p.back) endTalk(api, g); return; }
  if (g.ui.mode === "map" || g.ui.mode === "note") { if (p.back || p.map || p.use || p.inv) closeUi(g); return; }
  const m = g.ui.menu; if (!m) { closeUi(g); return; }
  if (p.down || (jedge && jy === 1)) m.cur = (m.cur + 1) % m.items.length;
  if (p.up || (jedge && jy === -1)) m.cur = (m.cur + m.items.length - 1) % m.items.length;
  if (p.back || (p.inv && m.kind === "inv")) { if (m.kind === "item" || m.kind === "wear") invMenu(g, defs, lvl); else closeUi(g); return; }
  if (!p.use) return;
  const it = m.items[m.cur]; if (!it || it.dis) return;
  const ref = g.ui.ref;
  const i = ref ? findIx(lvl, ref) : null;
  switch (it.a) {
    case "close": closeUi(g); break;
    case "none": break;
    case "inv": invMenu(g, defs, lvl); break;
    case "item": itemMenu(g, defs, it.p); break;
    case "craft_menu": craftMenu(g, defs, false); break;
    case "wear_menu": { const c = clothing(g, defs); openMenu(g, "身上穿着（保暖 " + r1(c.w) + "°，防风 " + r1(c.p) + "°）", Object.keys(SLOTS).map((s) => ({ l: SLOTS[s] + "：" + (g.wear[s] ? defs[g.wear[s]].name : "（无）"), a: "unwear", p: s })).concat([{ l: "返回", a: "inv" }]), "wear"); break; }
    case "unwear": { const id = g.wear[it.p]; if (id) { invAdd(g, defs, id, 1); delete g.wear[it.p]; toast(api, g, "脱下了" + defs[id].name); } invMenu(g, defs, lvl); break; }
    case "campfire": {
      if (g.inside) { toast(api, g, "屋里只能在炉子里生火。"); break; }
      const x = Math.floor(g.pc.x / T), y = Math.floor(g.pc.y / T);
      let fire = lvl.ix.find((q) => q.k === "heat" && Math.abs(q.x - x) <= 1 && Math.abs(q.y - y) <= 1);
      if (!fire) { fire = { k: "heat", t: "campfire", x, y, w: 1, h: 1 }; lvl.ix.push(fire); lvl.dirty = true; }
      fireMenu(g, defs, fire); break;
    }
    case "light": startBusy(g, "生火……", 3, 2, "light", it.p, { ref }); break;
    case "addfuel": { const e = g.inv[it.p]; if (e && i) { const d = defs[e.id], k = fireKey(g, i), f = g.fire[k]; invTake(g, e, 1); f.fuel = Math.min(f.fuel + d.burn, 12 * 60); f.temp = Math.max(f.temp, tempOf(d)); toast(api, g, "添了" + d.name + "。"); fireMenu(g, defs, i); } break; }
    case "boil": startBusy(g, "烧水……", 10, 5, "boil", null, { ref }); sfx(api, "boil", 0.6); break;
    case "cook": startBusy(g, "烤……", 15, 5, "cook", it.p, { ref }); break;
    case "sit": startBusy(g, "在火边坐着……", 60, 20, "sit", null, { ref }); break;
    case "sleep": startBusy(g, "睡觉……", it.p * 60, 60, "sleep", null, { bed: true }); break;
    case "craft": { if (tooDark(api, g, "手上的活没法做")) break; const r = RECIPES.find((x) => x.id === it.p); startBusy(g, "制作" + r.name + "……", r.min, r.min > 60 ? 60 : 10, "craft", r.id); break; }
    case "takeall": case "take": {
      if (!i) break;
      const list = it.a === "takeall" ? i.items.slice() : [i.items[it.p]];
      for (const pair of list) {
        const [id, n] = pair;
        if (invKg(g, defs) + ((defs[id] || {}).kg || 0) * n > 45) { toast(api, g, "背不动了。"); break; }
        invAdd(g, defs, id, n); i.items.splice(i.items.indexOf(pair), 1); sfx(api, "pickup", 0.6);
        toast(api, g, "拿走：" + defs[id].name + (n > 1 ? " ×" + n : ""));
        onPickup(api, g, defs, id, api.state.get("world"));
      }
      lvl.dirty = true;
      if (g.ui.mode === "menu") { if (i.items.length) lootMenu(g, defs, i); else closeUi(g); }
      break;
    }
    case "eat": {
      const e = g.inv[it.p]; if (!e) break; const d = defs[e.id];
      if (g.body.kcal >= 2450 && d.kcal > 0) { toast(api, g, "吃不下了。"); break; }
      g.body.kcal = clamp(g.body.kcal + (d.kcal || 0), 0, 2500); g.body.water = clamp(g.body.water + (d.water || 0), 0, 3);
      if (d.risk && rnd() < d.risk) { g.aff.fp = 8 * 60; toast(api, g, "胃里一阵翻搅——食物中毒。"); }
      invTake(g, e, 1); if (d.cat === "food_can") invAdd(g, defs, "i_can_empty", 1);
      sfx(api, "eat", 0.7); toast(api, g, "吃了" + d.name + "（+" + Math.round(d.kcal || 0) + " kcal）"); invMenu(g, defs, lvl); break;
    }
    case "drink": {
      const e = g.inv[it.p]; if (!e) break; const d = defs[e.id];
      if (g.body.water >= 2.95) { toast(api, g, "不渴。"); break; }
      g.body.water = clamp(g.body.water + d.water, 0, 3);
      if (d.risk && rnd() < d.risk) { g.aff.dys = 12 * 60; toast(api, g, "水不干净——痢疾。"); }
      invTake(g, e, 1); sfx(api, "drink", 0.7); toast(api, g, "喝了 " + d.water + " L。"); invMenu(g, defs, lvl); break;
    }
    case "purify": { const e = g.inv[it.p], t = invHas(g, defs, (d) => d.cat === "tablets"); if (e && t) { invTake(g, e, 1); useCharge(g, t); invAdd(g, defs, "i_water", 1); toast(api, g, "水处理好了。"); } invMenu(g, defs, lvl); break; }
    case "wear": { const e = g.inv[it.p]; if (!e) break; const d = defs[e.id]; const old = g.wear[d.cat]; g.wear[d.cat] = e.id; invTake(g, e, 1); if (old) invAdd(g, defs, old, 1); toast(api, g, "穿上了" + d.name); invMenu(g, defs, lvl); break; }
    case "read": {
      if (tooDark(api, g, "看不清字")) break;
      const e = g.inv[it.p]; const d = e && defs[e.id]; const c = d && api.state.get("world").story.notes.find((x) => x.id === d.note);
      if (d && d.note && !(g.read || []).includes(d.note)) { g.read = (g.read || []).concat([d.note]); hist(g, "读到笔记《" + (c ? c.title : "") + "》"); goalCheck(api, g, defs, lvl); }
      g.ui = { mode: "note", title: c ? c.title : d.name, text: c ? c.text : "" }; sfx(api, "page", 0.6); break;
    }
    case "diary": { if (tooDark(api, g, "看不清字")) break; sfx(api, "page", 0.7); const ds = (g.diary || []).slice(-2); g.ui = { mode: "note", title: "日记", text: ds.map((x) => "【第 " + x.day + " 天】" + x.text).join("\n\n") }; break; }
    case "light_on": {
      const e = g.inv[it.p]; if (!e) break; const d = defs[e.id];
      if (d.cat !== "flashlight") { const m = invHas(g, defs, (x) => x.cat === "matches" || x.cat === "flint"); if (!m) { toast(api, g, "没有火柴，点不着。"); break; } useCharge(g, m); sfx(api, "match_lit", 0.6); } else sfx(api, "pickup", 0.4);
      if (d.cat === "candle" || d.cat === "torch") { if (e.n > 1) { e.n -= 1; g.inv.push({ id: e.id, n: 1, u: e.u }); } } // 拿出一根来点
      g.lit = { id: e.id, kind: d.cat }; toast(api, g, "点亮了" + d.name + "。"); closeUi(g); break;
    }
    case "light_off": g.lit = null; toast(api, g, "熄掉了。"); invMenu(g, defs, lvl); break;
    case "refill": {
      const e = g.inv[it.p]; if (!e) break; const d = defs[e.id], need = d.cat === "lantern" ? "lamp_oil" : "battery";
      const r = invHas(g, defs, (x) => x.cat === need); if (!r) break;
      const cap = d.cat === "lantern" ? 240 : 120;
      e.u = Math.min(cap, (e.u || 0) + defs[r.id].burn); invTake(g, r, 1); sfx(api, "pickup", 0.5);
      toast(api, g, d.cat === "lantern" ? "加满了灯油。" : "换上了新电池。"); invMenu(g, defs, lvl); break;
    }
    case "flare": {
      const e = g.inv[it.p]; if (!e) break; invTake(g, e, 1);
      let n = 0; for (const w of g.ents) if (w.k === "wolf" && Math.hypot(w.x - g.pc.x, w.y - g.pc.y) < 12 * T) { w.st = "flee"; w.t = 25; n++; }
      g.flareT = api.time; g.wolfCd = Math.max(g.wolfCd || 0, 60); sfx(api, "flare", 0.9);
      toast(api, g, n ? "红光里，狼退回了林子。" : "火光照亮了雪地。"); closeUi(g); break;
    }
    case "med": {
      const e = g.inv[it.p]; if (!e) break; const d = defs[e.id]; let ok = false;
      if (d.cat === "bandage" && g.aff.bleed) { g.aff.bleed = false; ok = true; toast(api, g, "止住了血。"); }
      else if (d.cat === "bandage" && g.aff.sprain > 0) { g.aff.sprain = Math.min(g.aff.sprain, 60); ok = true; toast(api, g, "把脚踝固定好了。"); }
      else if (d.cat === "antibiotic" && (g.aff.fp > 0 || g.aff.dys > 0)) { g.aff.fp = Math.min(g.aff.fp, 30); g.aff.dys = Math.min(g.aff.dys, 30); ok = true; toast(api, g, "吞下了抗生素。"); }
      else if (d.cat === "painkiller" && g.aff.sprain > 0) { g.aff.sprain = Math.min(g.aff.sprain, 90); ok = true; toast(api, g, "疼痛减轻了。"); }
      if (ok) useCharge(g, e); else toast(api, g, "现在用不上。");
      invMenu(g, defs, lvl); break;
    }
    case "drop": {
      const e = g.inv[it.p]; if (!e) break;
      lvl.gi.push({ x: Math.floor(g.pc.x / T), y: Math.floor(g.pc.y / T), id: e.id, n: e.n, nm: (defs[e.id] || {}).name }); g.inv.splice(it.p, 1); lvl.dirty = true; invMenu(g, defs, lvl); break;
    }
  }
}

function finishBusy(api, g, defs, lvl) {
  const b = g.busy; g.busy = null;
  const i = b.ref ? findIx(lvl, b.ref) : null;
  const here = () => { const h = api.state.get("here"); return h; };
  switch (b.act) {
    case "search": if (i) { i.s = true; lvl.dirty = true; lootMenu(g, defs, i); } break;
    case "pry": if (i) { i.lock = false; lvl.dirty = true; toast(api, g, "撬开了。"); } break;
    case "pry_door": { const [x, y] = b.p; lvl.c[y] = lvl.c[y].slice(0, x) + "f" + lvl.c[y].slice(x + 1); const h = here(); h.o[y][x] = h.o[y][x] === 26 ? 25 : 17; api.state.set("here", h); lvl.dirty = true; toast(api, g, "门被撬开了。"); break; }
    case "wood": if (i) {
      const hatchet = hasTool(g, defs, "hatchet"), n = ri(2, 4);
      if (hatchet && (i.t === "log_pile" || i.t === "woodpile")) invAdd(g, defs, i.hard && rnd() < 0.5 ? "i_hardwood" : "i_wood", ri(1, 2));
      else if (hatchet) invAdd(g, defs, "i_wood", 1);
      invAdd(g, defs, "i_stick", n);
      toast(api, g, "收集到细枝 ×" + n + (hatchet ? "，还劈了些木柴" : ""));
      i.n -= 1;
      if (i.n <= 0 && i.t !== "woodpile") { lvl.ix.splice(lvl.ix.indexOf(i), 1); const h = here(); h.o[i.y][i.x] = 46; api.state.set("here", h); lvl.c[i.y] = lvl.c[i.y].slice(0, i.x) + "." + lvl.c[i.y].slice(i.x + 1); }
      lvl.dirty = true;
    } break;
    case "carcass": if (i) {
      const knife = hasTool(g, defs, "knife"), hat = hasTool(g, defs, "hatchet"), n = knife ? 3 : hat ? 2 : 1;
      invAdd(g, defs, "i_meat_raw", n); if (knife || hat) invAdd(g, defs, "i_hide", 1);
      toast(api, g, "割下生肉 ×" + n + (knife || hat ? "、鹿皮 ×1" : "（没有刀，只撕下来一点）"));
      lvl.ix.splice(lvl.ix.indexOf(i), 1); const h = here(); h.o[i.y][i.x] = -1; api.state.set("here", h); lvl.dirty = true;
    } break;
    case "light": if (i) {
      const e = g.inv[b.p]; if (!e) break;
      const d = defs[e.id], wx = g.wxNow || {};
      let p = d.cat === "matches" ? 0.6 : 0.6 - (d.malus || 0.15);
      const tinder = invHas(g, defs, (x) => x.cat === "tinder" || x.cat === "paper");
      if (tinder) p += defs[tinder.id].bonus || 0.15;
      if (i.t === "campfire") { if (wx.wind > 10) p -= 0.2; if (wx.type === "blizzard") p -= 0.4; }
      useCharge(g, e); if (tinder) invTake(g, tinder, 1);
      const fuel = invHas(g, defs, (x) => x.cat === "fuel_stick") || invHas(g, defs, (x) => FUEL.includes(x.cat));
      if (fuel && rnd() < clamp(p, 0.05, 0.95)) {
        const fd = defs[fuel.id]; invTake(g, fuel, 1);
        g.fire[fireKey(g, i)] = { fuel: fd.burn, temp: tempOf(fd), x: i.x, y: i.y, w: i.w, h: i.h, rid: g.rid, bid: i.bid || null };
        toast(api, g, "火着了。"); sfx(api, "match_lit", 0.9);
        if (!g.firstFire) { g.firstFire = true; narrate(api, g, "第一次生起火", {}); }
        hist(g, "在" + (FNAME[i.t] || "这里") + "生起了火");
        goalCheck(api, g, defs, lvl);
      } else { toast(api, g, "火苗挣扎了几下，灭了。"); sfx(api, "match_fail", 0.9); }
    } break;
    case "boil": { const pot = invHas(g, defs, (d) => d.cat === "pot"); invAdd(g, defs, "i_water", pot ? 2 : 1); toast(api, g, "烧开了 " + (pot ? "1.0" : "0.5") + " L 水。"); break; }
    case "cook": { const e = g.inv[b.p]; if (e) { const d = defs[e.id]; invTake(g, e, 1); invAdd(g, defs, d.cat === "fish_raw" ? "i_fish" : "i_meat", 1); toast(api, g, "烤好了。"); } break; }
    case "craft": {
      const r = RECIPES.find((x) => x.id === b.p);
      for (const [cats, n] of r.need) for (let k = 0; k < n; k++) { const e = invHas(g, defs, (d) => cats.split("|").includes(d.cat)); if (e) invTake(g, e, 1); }
      if (r.tool) { const t = invHas(g, defs, (d) => d.cat === r.tool); if (t) useCharge(g, t); }
      invAdd(g, defs, r.out, 1); toast(api, g, "做好了：" + defs[r.out].name); break;
    }
    case "sleep": toast(api, g, "你醒了。"); hist(g, "睡了一觉"); narrate(api, g, "睡醒", {}); break;
    case "use": {
      const world = api.state.get("world"), st = world.story.steps[b.p];
      if (st) { for (const k of st.need) { const e = g.inv.find((x) => x.id === "i_key_" + k); if (e) invTake(g, e, 1); } g.goal.used = b.p; goalCheck(api, g, defs, lvl); }
      break;
    }
    case "sleep_hist": break;
  }
}

function endStruggle(api, g, won) {
  const dmg = won ? ri(8, 18) : ri(22, 40);
  g.body.cond = clamp(g.body.cond - dmg, 0, 100);
  if (rnd() < (won ? 0.4 : 0.75)) { g.aff.bleed = true; toast(api, g, "你在流血，快包扎！"); }
  if (!won && rnd() < 0.3) g.aff.sprain = 360;
  hist(g, won ? "和狼搏斗，打退了它" : "被狼咬伤");
  toast(api, g, won ? "你把狼打退了。状态 −" + dmg + "%" : "狼撕咬了你一阵才跑开。状态 −" + dmg + "%");
  if (!g.cause && g.body.cond <= 0) g.cause = "死于狼口";
  g.wolfCd = 90; closeUi(g);
  narrate(api, g, "和狼搏斗之后" + (won ? "（打退了）" : "（受了重伤）"), { force: true });
}

// ───────── AI 调度 ─────────
function dispatch(api, g) {
  const q = api.state.get("aiq");
  for (const req in q.pend) { const p = q.pend[req]; if (api.time - p.t > TIMEOUT[p.k]) { api.actions.call("fallback", { k: p.k, id: p.id, req: Number(req) }); return; } }
  if (!q.want.length) return;
  const waiting = g.ph === "wait" && g.wait ? g.wait.k + ":" + g.wait.id : g.doorWait ? "building:" + g.rid + "|" + g.doorWait : "";
  const score = (w) => (waiting === w.k + ":" + w.id ? 100 : 0) + (w.k === "world" ? 50 : 0) + (w.k === "building" && w.id.startsWith(g.rid + "|") ? 20 : 0) + (w.k === "region" ? 5 : 0);
  q.want.sort((a, b) => score(b) - score(a));
  let dirty = false;
  while (q.want.length) {
    const w = q.want[0];
    const brief = makeBrief(api, g, w);
    if (brief === null) { q.want.shift(); dirty = true; continue; }
    const req = api.ai.request(ENTRY[w.k], "", { brief });
    if (req === null) break;
    q.want.shift(); q.pend[req] = { k: w.k, id: w.id, t: api.time }; dirty = true;
  }
  if (dirty) api.state.set("aiq", q);
}
function makeBrief(api, g, w) {
  if (w.k === "world") return JSON.stringify({ 灵感: [pick(INSPIRE[0]), pick(INSPIRE[1]), pick(INSPIRE[2])], 难度: "标准" });
  const world = api.state.get("world"), defs = api.state.get("defs");
  if (!world || !world.regions) return null;
  const items = Object.values(defs).filter((d) => d.cat !== "note").map((d) => d.id + "=" + d.name + "(" + d.cat + ")").join("，");
  if (w.k === "region") {
    const R = world.regions[w.id]; if (!R) return null;
    const exits = world.links.filter((l) => l[0] === w.id || l[1] === w.id).map((l) => { const to = l[0] === w.id ? l[1] : l[0]; return { 通往: to, 名字: world.regions[to].name, 路: l[2] }; });
    return JSON.stringify({ 区域: { id: w.id, 名字: R.name, 地貌: R.biome, 描述: R.desc, 危险: R.danger, 建筑数: R.nb }, 出口: exits, 是起点: world.start === w.id,
      必须有的家具: ((world.story.req || {})[w.id] || {}).objects || [],
      人物: world.story.people.filter((p) => p.region === w.id).map((p) => p.name + "（" + p.role + "）住在这里"),
      故事: world.story.premise + " " + world.story.goal, 可用物品: items });
  }
  const [rid, bid] = w.id.split("|");
  const lvl = api.state.get("lvl");
  const src = lvl && lvl.rid === rid ? lvl : api.state.get("c_" + rid);
  const b = ((src && src.bld) || []).find((x) => x.id === bid); if (!b || b.ready) return null;
  return JSON.stringify({ 建筑: { 类型: b.type, 名字: b.name, 尺寸: [b.w, b.h], 正门: [b.door, b.h - 1], 必须有的家具: b.need || [] },
    在这附近活动的人: world.story.people.filter((p) => p.region === rid).map((p) => p.name + "：" + p.role + "，" + p.personality),
    所在区域: world.regions[rid].name + "（" + world.regions[rid].biome + "）", 故事: world.story.premise, 可用物品: items });
}

// 建筑生成好了：结束"撞门"（定时器每秒检查）；等太久就改用规则生成
export function door_check(api) {
  const g = api.state.get("g");
  if (!g || g.ph !== "play" || !g.doorWait) return;
  const lvl = api.state.get("lvl");
  const b = lvl.bld.find((x) => x.id === g.doorWait);
  if (b && b.ready) { g.doorWait = null; if (g.busy && g.busy.act === "enter") g.busy = null; toast(api, g, "门开了。"); sfx(api, "door", 0.8); }
  else if (g.busy && g.busy.act === "enter" && g.busy.done > 80) { api.actions.call("fallback", { k: "building", id: g.rid + "|" + g.doorWait }); }
  else if (!g.busy || g.busy.act !== "enter") g.doorWait = null;
  api.state.set("g", g);
}
