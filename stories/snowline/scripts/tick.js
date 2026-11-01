// 雪线 · 实时循环（tick.js）——每秒 20 次，只做每帧必须做的事：
// 时间、天气、火、身体数值、移动碰撞、动物、交互焦点。菜单和交互结算交给 ui.js（按需调用）。
// 身体消耗公式固定在这里（《AI 生成规范》§2），AI 无法修改。

const T = 64, RATE = 0.2, DAY = 1440;
const FNAME = { bed: "床", bunk: "双层床", bedroll: "睡袋", stove: "铁炉", barrel_stove: "油桶炉", fireplace: "壁炉", cabinet: "橱柜", drawer: "抽屉柜", wardrobe: "衣柜",
  kitchen_counter: "厨房台面", fridge: "冰箱", desk: "书桌", bookshelf: "书架", workbench: "工作台", crate: "木箱", locker: "储物柜", safe: "保险柜", sink: "水槽",
  first_aid: "急救箱", barrel: "铁桶", bucket: "水桶", woodpile: "柴堆", altar: "祭坛", radio_desk: "电台", control_panel: "控制台", corpse: "遗体", car: "抛锚的车",
  dead_tree: "枯树", log_pile: "原木堆", carcass: "鹿尸", campfire: "篝火堆" };
const WXNEXT = { clear: [["clear", 4], ["cloudy", 3], ["frigid", 1], ["fog", 1]], cloudy: [["overcast", 3], ["clear", 2], ["snow", 2]], overcast: [["snow", 3], ["overcast", 2], ["cloudy", 2], ["fog", 1]],
  snow: [["snow", 2], ["heavy_snow", 2], ["overcast", 3]], heavy_snow: [["blizzard", 1], ["snow", 3], ["overcast", 2]], blizzard: [["heavy_snow", 3], ["snow", 2]], fog: [["overcast", 3], ["clear", 2]], frigid: [["clear", 3], ["cloudy", 2]] };
const WXT = { clear: [-5, -20], overcast: [-5, -18], cloudy: [-5, -18], snow: [-6, -20], heavy_snow: [-8, -22], blizzard: [-10, -25], fog: [-4, -15], frigid: [-15, -30] };
const BURN = { sleep: 75, idle: 125, walk: 200, run: 400 };
const SOLID = "#wBDL";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function toast(api, g, text) { g.toast = (g.toast || []).filter((m) => api.time - m.t < 6000).concat([{ t: api.time, text }]).slice(-4); }
function sfx(api, id, vol) { api.sound.play(id, { volume: vol === undefined ? 0.8 : vol }); }
// 环境声：屋外按天气换风声，屋里换室内声，靠近燃着的火叠加火声
function ambience(api, g) {
  const wx = g.wxNow || {};
  const want = g.inside ? "amb_indoor" : wx.type === "blizzard" ? "amb_blizzard" : (wx.type === "heavy_snow" || wx.wind > 9) ? "amb_wind_strong" : "amb_wind";
  if (want !== g.amb) { if (g.amb) api.sound.stop(g.amb); api.sound.play(want, { loop: true, volume: want === "amb_indoor" ? 0.35 : 0.5 }); g.amb = want; }
  const nearFire = fireBonus(g) > 3;
  if (nearFire !== !!g.ambFire) { if (nearFire) api.sound.play("amb_fire", { loop: true, volume: 0.6 }); else api.sound.stop("amb_fire"); g.ambFire = nearFire; }
}
function save(api, g) { api.state.set("g", g); }
function call(api, g, op, extra) { save(api, g); api.actions.call("ui", Object.assign({ op }, extra || {})); return api.state.get("g"); }

// ───────── 天气 ─────────
function weather(api, g) {
  if (g.wx && g.clock < g.wx.until) return g.wx;
  const world = api.state.get("world");
  const s = (world.weather || []).find((w) => g.clock >= w.at && g.clock < w.at + w.len);
  if (s) { g.wx = { type: s.type, t: s.t, wind: s.wind, until: s.at + s.len, src: "ai" }; return g.wx; }
  // 剧本之外：规则马尔可夫，每 4 小时变一次（开局 6 小时禁止暴风雪，3 天内最多一次）
  const l = WXNEXT[(g.wx && g.wx.type) || "cloudy"];
  let tot = 0; for (const e of l) tot += e[1];
  let r = api.random.float() * tot, type = l[0][0]; for (const e of l) { r -= e[1]; if (r <= 0) { type = e[0]; break; } }
  if (type === "blizzard" && (g.clock < 480 + 360 || g.clock - (g.lastBliz || -99999) < 72 * 60)) type = "heavy_snow";
  if (type === "blizzard") g.lastBliz = g.clock;
  const [hi, lo] = WXT[type];
  const next = (world.weather || []).find((w) => w.at > g.clock);
  const len = (type === "blizzard" ? 3 + api.random.int(0, 5) : 4) * 60;
  g.wx = { type, t: Math.round(lo + api.random.float() * (hi - lo)), wind: type === "blizzard" ? api.random.int(15, 25) : api.random.int(0, type.indexOf("snow") >= 0 ? 12 : 8), until: Math.min(g.clock + len, next ? next.at : 1e9), src: "rule" };
  return g.wx;
}
function airTemp(g, wx) { const h = (g.clock % DAY) / 60; return wx.t + ((Math.cos(((h - 14) / 24) * 2 * Math.PI) - 1) / 2) * 7; }
function isNight(g) { const h = (g.clock % DAY) / 60; return h < 6.5 || h >= 19; }

// ───────── 光（夜里没光就看不见；规则固定） ─────────
// 手持光源：[照明半径（格）, 亮度]；火把还能让狼不敢靠近
const LIGHT = { lantern: [4.5, 0.95], flashlight: [6.5, 1.0], candle: [2.5, 0.75], torch: [4.2, 0.9] };
function nightF(g) { const h = (g.clock % DAY) / 60; return h < 5 ? 1 : h < 7.5 ? (7.5 - h) / 2.5 : h < 17.5 ? 0 : h < 20 ? (h - 17.5) / 2.5 : 1; }
function ambient(g) {
  const n = nightF(g), wx = (g.wxNow || {}).type;
  const moon = { clear: 0.32, frigid: 0.32, cloudy: 0.14, overcast: 0.1 }[wx] || 0.05; // 晴夜有月光，下雪的夜里几乎全黑
  return g.inside ? 1 - n * (1 - moon * 0.4) : 1 - n * (1 - moon);
}
function lightSources(api, g) {
  const ls = [];
  if (g.lit && LIGHT[g.lit.kind]) ls.push([g.pc.x, g.pc.y, LIGHT[g.lit.kind][0] * T, LIGHT[g.lit.kind][1]]);
  for (const k in g.fire) { const f = g.fire[k]; if (f.rid === g.rid) ls.push([(f.x + f.w / 2) * T, (f.y + f.h / 2) * T, (2.5 + f.temp / 12) * T, 0.9]); }
  if (g.flareT && api.time - g.flareT < 20000) ls.push([g.pc.x, g.pc.y, 8 * T, 1]);
  return ls;
}
function brightAt(ls, amb, x, y) { let b = amb; for (const l of ls) { const d = Math.hypot(x - l[0], y - l[1]) / l[2]; if (d < 1) b = Math.max(b, Math.pow(1 - d, 0.7) * l[3]); } return b; }
const DARK = 0.3; // 低于这个亮度：看不清

// ───────── 身体（规范 §2 的固定公式） ─────────
function fireBonus(g) {
  let best = 0;
  for (const k in g.fire) {
    const f = g.fire[k]; if (f.rid !== g.rid || f.fuel <= 0) continue;
    if (f.bid && f.bid !== g.inside) continue; // 屋里的炉子只暖屋里
    const d = Math.hypot(g.pc.x - (f.x + f.w / 2) * T, g.pc.y - (f.y + f.h / 2) * T) / T;
    if (d < 4) best = Math.max(best, f.temp * clamp(1.15 - d / 4, 0, 1));
  }
  return best;
}
function body(api, g, wx, dtMin, act) {
  const h = dtMin / 60, b = g.body, a = g.aff;
  b.kcal = clamp(b.kcal - BURN[act] * h * (g.kg > 30 ? 1.25 : 1) * (a.fp > 0 ? 1.3 : 1), 0, 2500);
  b.water = clamp(b.water - (act === "sleep" ? 0.056 : 0.083) * h * (a.dys > 0 ? 2 : 1), 0, 3);
  b.fat = clamp(b.fat + (act === "sleep" ? 12.5 : act === "run" ? -10 : act === "walk" ? -5 : -4) * h * (a.fp > 0 && act !== "sleep" ? 1.5 : 1), 0, 100);
  let air = airTemp(g, wx), chill = wx.wind;
  if (g.inside) { air = air * 0.35 - 1; chill = 0; }
  const fb = fireBonus(g);
  const cw = g.cw || { w: 0, p: 0 }, warmC = cw.w * (a.wet > 0 ? 0.3 : 1);
  const f = air + warmC - Math.max(0, chill - cw.p) + fb + (act === "sleep" && g.busy && g.busy.bed ? 5 : 0);
  g.feel = Math.round(f);
  b.warm = clamp(b.warm + (f >= 0 ? Math.min(40, 15 + f * 2) : f * 2.5) * h, 0, 100);
  let dc = 0;
  if (b.warm <= 0) { a.freeze += dtMin; if (a.freeze >= 120 && !a.hypo) { a.hypo = true; toast(api, g, "你患上了失温症。"); } dc -= (a.hypo ? 40 : 20) * h; }
  else a.freeze = Math.max(0, a.freeze - dtMin);
  if (a.hypo) { if (f >= 0) { a.hypoOk += dtMin; if (a.hypoOk >= 24 * 60) { a.hypo = false; toast(api, g, "失温症好了。"); } } else a.hypoOk = 0; }
  if (b.water <= 0) dc -= 2 * h;
  if (b.kcal <= 0) dc -= h;
  if (b.fat <= 0) dc -= h;
  if (a.bleed) dc -= 6 * h;
  if (a.fp > 0) { dc -= h; a.fp -= dtMin; if (a.fp <= 0) toast(api, g, "肚子终于不疼了。"); }
  if (a.dys > 0) { dc -= h; a.dys -= dtMin; if (a.dys <= 0) toast(api, g, "痢疾过去了。"); }
  if (a.sprain > 0) { a.sprain -= dtMin * (act === "sleep" || act === "idle" ? 1 : 0.3); if (a.sprain <= 0) toast(api, g, "脚踝不疼了。"); }
  if (a.wet > 0) a.wet -= dtMin * (fb > 5 ? 4 : g.inside ? 2 : 1);
  if (b.kcal > 0 && b.water > 0 && b.fat > 0 && b.warm > 0 && !a.bleed && a.fp <= 0 && a.dys <= 0) dc += (act === "sleep" ? 1.5 : 0.5) * h;
  b.cond = clamp(b.cond + dc, 0, 100);
  if (b.cond <= 0 && !g.cause) g.cause = b.warm <= 0 ? "冻死" : b.water <= 0 ? "脱水" : b.kcal <= 0 ? "饿死" : a.bleed ? "失血" : "力竭";
}

// ───────── 地图 ─────────
function cell(lvl, x, y) { const tx = Math.floor(x / T), ty = Math.floor(y / T); if (tx < 0 || ty < 0 || tx >= lvl.w || ty >= lvl.h) return "#"; return lvl.c[ty][tx]; }
function blocked(lvl, x, y, r) { return SOLID.indexOf(cell(lvl, x - r, y - r)) >= 0 || SOLID.indexOf(cell(lvl, x + r, y - r)) >= 0 || SOLID.indexOf(cell(lvl, x - r, y + r)) >= 0 || SOLID.indexOf(cell(lvl, x + r, y + r)) >= 0; }
function bldAt(lvl, x, y) { const tx = Math.floor(x / T), ty = Math.floor(y / T); return lvl.bld.find((b) => b.ready && tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h); }

// ───────── 主循环 ─────────
export function tick(api) {
  let g = api.state.get("g");
  if (api.state.get("outcome")) return;
  const dt = Math.min(api.dt, 100) / 1000;
  const inp = api.input || { held: {}, pressed: {}, joystick: { x: 0, y: 0 } };

  if (g.ph === "boot") {
    Object.assign(g, {
      ph: "wait", wait: { k: "world", id: "w", t0: api.time, l: "AI 正在生成这一局的世界……" },
      rid: "", pc: { x: 0, y: 0, dir: 0, fr: 0, mv: false, sx: 0, sy: 0 }, clock: 8 * 60,
      body: { kcal: 1800, water: 2.0, fat: 85, warm: 80, cond: 100, stam: 100 },
      aff: { freeze: 0, hypo: false, hypoOk: 0, fp: 0, dys: 0, bleed: false, sprain: 0, wet: 0 },
      inv: [{ id: "i_match", n: 1, u: 5 }, { id: "i_stick", n: 2 }, { id: "i_bar", n: 1 }, { id: "i_cloth", n: 1 }],
      wear: { hat: "i_hat", coat: "i_coat", shirt: "i_shirt", pants: "i_pants", gloves: "i_gloves", boots: "i_boots", socks: "i_socks" },
      ents: [], fire: {}, ui: { mode: "play" }, busy: null, toast: [], narr: null, clues: [], seen: {}, feel: 0, wolfCd: 0, wxNow: { type: "cloudy", t: -10, wind: 4 }, log: [], kg: 3, cw: { w: 9.8, p: 6 }, tools: {}, goal: { i: 0, used: -1 }, read: [], hist: [], diary: [],
    });
    const q = api.state.get("aiq"); q.want.push({ k: "world", id: "w" }); api.state.set("aiq", q);
    call(api, g, "dispatch");
    return;
  }

  const q = api.state.get("aiq");
  let needDispatch = q.want.length > 0;
  for (const r in q.pend) if (api.time - q.pend[r].t > 60000) needDispatch = true; // 可能超时，交给 ui.js 判断
  if (needDispatch && (!g.lastDisp || api.time - g.lastDisp > 500)) { g.lastDisp = api.time; g = call(api, g, "dispatch"); }

  // 等待生成（开局、走进还没生成好的区域）
  if (g.ph === "wait") {
    const w = g.wait;
    const world = api.state.get("world");
    if (world && world.regions) {
      const target = w.k === "world" ? world.start : w.id;
      if (q.done["region:" + target]) {
        save(api, g);
        const r = api.actions.call("switch_region", w.from ? { to: target, from: w.from } : { to: target });
        g = api.state.get("g");
        g.ph = "play"; g.wait = null;
        g.visitN = (g.visitN || 0) + 1; g = call(api, g, "recalc"); g = call(api, g, "arrive");
        if (w.k === "world") toast(api, g, world.story.goal);
        if (r && r.first) { toast(api, g, "—— " + r.name + " ——"); g = call(api, g, "narrate", { s: JSON.stringify({ event: w.k === "world" ? "开场：主角醒来" : "第一次来到这里", extra: { 区域描述: r.desc, force: true } }) }); }
        save(api, g);
        return;
      }
      if (w.k === "region" && !q.want.some((x) => x.k === "region" && x.id === w.id) && !Object.values(q.pend).some((p) => p.k === "region" && p.id === w.id)) { q.want.push({ k: "region", id: w.id }); api.state.set("aiq", q); }
    }
    g.wait.el = api.time - w.t0;
    save(api, g);
    return;
  }

  // ───── 游玩中 ─────
  const lvl = api.state.get("lvl");
  const wx = weather(api, g);
  g.wxNow = { type: wx.type, t: Math.round(airTemp(g, wx)), wind: wx.wind };
  g.wolfCd = Math.max(0, (g.wolfCd || 0) - dt);
  g.ambL = ambient(g); g.bright = brightAt(lightSources(api, g), g.ambL, g.pc.x, g.pc.y);

  let act = "idle";
  const b = g.busy;
  const talking = g.ui.mode === "talk";
  const dtMin = talking ? 0 : b && !b.real ? dt * b.rate : dt * RATE;
  if (b && b.act === "sleep") act = "sleep";
  const prevDay = Math.floor(g.clock / DAY);
  g.clock += dtMin;
  // 手里的灯：按游戏分钟消耗灯油/电量；蜡烛和火把烧完就没了；大风里蜡烛会被吹灭
  if (g.lit) {
    const e = g.inv.find((x) => x.id === g.lit.id && (x.u || 0) > 0);
    if (!e) g.lit = null;
    else {
      e.u = Math.max(0, e.u - dtMin);
      if (g.lit.kind === "candle" && !g.inside && (g.wxNow.wind || 0) > 8) { g.lit = null; toast(api, g, "风把蜡烛吹灭了。"); }
      else if (e.u <= 0) {
        toast(api, g, { lantern: "灯油烧完了。", flashlight: "手电没电了。", candle: "蜡烛烧完了。", torch: "火把烧完了。" }[g.lit.kind] || "灯灭了。");
        if (g.lit.kind === "candle" || g.lit.kind === "torch") { e.n -= 1; if (e.n <= 0) g.inv.splice(g.inv.indexOf(e), 1); }
        g.lit = null;
      }
    }
  }
  for (const k in g.fire) { const f = g.fire[k]; f.fuel = Math.max(0, f.fuel - dtMin); if (f.fuel <= 0) { if (f.rid === g.rid && Math.hypot(g.pc.x - (f.x + 0.5) * T, g.pc.y - (f.y + 0.5) * T) < 5 * T) toast(api, g, "火熄灭了。"); delete g.fire[k]; } }

  if (b) {
    b.done += b.real ? dt : dtMin;
    const wolf = !g.inside && !b.real && g.ents.find((e) => e.k === "wolf");
    if (wolf && api.random.float() < (dtMin / 60) * 0.12) { // 野外忙碌时狼可能打断
      const a = api.random.float() * 6.283; wolf.x = g.pc.x + Math.cos(a) * 7 * T; wolf.y = g.pc.y + Math.sin(a) * 7 * T; wolf.st = "charge";
      toast(api, g, "有狼！"); g.busy = null;
    } else if (b.act === "sleep" && g.body.warm < 8) { toast(api, g, "你被冻醒了。"); g.busy = null; }
    else if (b.done >= b.need) g = call(api, g, "busy_done");
    else if (inp.pressed.back && b.act !== "repair") { toast(api, g, "中断了。"); g.busy = null; }
  } else if (g.ui.mode === "struggle") {
    const u = g.ui;
    u.t += dt; u.meter = clamp(u.meter - 14 * dt + (inp.pressed.use ? (g.tools.knife || g.tools.hatchet ? 13 : 9) - (g.lit && g.lit.kind === "lantern" ? 3 : 0) : 0), 0, 100);
    if (u.meter >= 100 || u.t > 5) g = call(api, g, "struggle_end", { v: u.meter >= 100 || u.meter > 55 ? 1 : 0 });
  } else if (talking) {
    if (inp.pressed.back) g = call(api, g, "input");
  } else if (g.ui.mode !== "play") {
    const j = inp.joystick || { y: 0 }, jy = j.y > 0.6 ? 1 : j.y < -0.6 ? -1 : 0;
    if (Object.keys(inp.pressed || {}).length || jy !== (g.jy || 0)) g = call(api, g, "input");
  } else {
    act = move(api, g, lvl, inp, dt);
    if (act === "switched") return;
    if (inp.pressed.use || inp.pressed.inv || inp.pressed.map) g = call(api, g, "input");
  }
  if (!g.busy && g.ui.mode !== "struggle" && !talking) ents(api, g, lvl, dt);

  body(api, g, wx, dtMin, act === "switched" ? "walk" : act);
  if (g.body.cond <= 0) { api.state.set("outcome", "died"); api.state.set("cause", g.cause || "力竭"); }
  const day = Math.floor(g.clock / DAY);
  if (day !== prevDay) { toast(api, g, "第 " + (day + 1) + " 天。"); api.state.set("days", day + 1); }
  if (Math.floor(g.clock / 60) !== Math.floor((g.clock - dtMin) / 60) && !api.state.get("outcome")) g = call(api, g, "hour"); // 每个游戏小时

  ambience(api, g);
  // 夜里偶尔从远处传来狼嚎（这片区域有狼时）
  if (isNight(g) && !g.inside && g.ents.some((e) => e.k === "wolf") && api.random.float() < dt / 90) sfx(api, "wolf_howl", 0.5);
  g.focus = g.ui.mode === "play" && !g.busy ? focus(g, api.state.get("lvl")) : null;
  save(api, g);
}

function move(api, g, lvl, inp, dt) {
  const h = inp.held || {}, j = inp.joystick || { x: 0, y: 0 };
  let dx = (h.right ? 1 : 0) - (h.left ? 1 : 0) + j.x, dy = (h.down ? 1 : 0) - (h.up ? 1 : 0) + j.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.15) { g.pc.mv = false; g.body.stam = clamp(g.body.stam + 15 * dt, 0, 100); return "idle"; }
  if (len > 1) { dx /= len; dy /= len; }
  if (g.kg > 45) { if (!g.heavyT || api.time - g.heavyT > 4000) { toast(api, g, "背得太重了，走不动。"); g.heavyT = api.time; } g.pc.mv = false; return "idle"; }
  const running = h.run && g.body.stam > 0 && g.aff.sprain <= 0 && g.body.fat > 5;
  let sp = running ? 4.2 : 2.4;
  const ch = cell(lvl, g.pc.x, g.pc.y);
  if (ch === "d") sp *= 0.6; else if (ch === "r") sp *= 1.1;
  if (g.aff.sprain > 0) sp *= 0.5;
  if (g.kg > 30) sp *= 0.7;
  if (g.body.fat < 10) sp *= 0.7;
  if (g.wxNow.type === "blizzard" && !g.inside) sp *= 0.8;
  g.body.stam = clamp(g.body.stam + (running ? -28 : 8) * dt, 0, 100);
  const vx = dx * sp * T * dt, vy = dy * sp * T * dt, r = 18;
  if (!blocked(lvl, g.pc.x + vx, g.pc.y, r)) g.pc.x += vx;
  if (!blocked(lvl, g.pc.x, g.pc.y + vy, r)) g.pc.y += vy;
  g.pc.mv = true; g.pc.fr = (g.pc.fr + dt * sp * 2.2) % 4;
  g.stepAcc = (g.stepAcc || 0) + sp * dt; // 脚步声：按走过的距离
  if (g.stepAcc > (running ? 1.1 : 0.85)) { g.stepAcc = 0; const c = cell(lvl, g.pc.x, g.pc.y); if (c === "f") sfx(api, "step_wood" + (1 + Math.floor(api.random.float() * 2)), 0.45); else sfx(api, "step_snow" + (1 + Math.floor(api.random.float() * 3)), c === "d" ? 0.7 : 0.5); }
  g.pc.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
  const c2 = cell(lvl, g.pc.x, g.pc.y);
  if (c2 === "t" && api.random.float() < dt * (0.04 + (g.kg > 20 ? 0.04 : 0))) { // 薄冰
    g.aff.wet = 180; g.body.warm = clamp(g.body.warm - 30, 0, 100); g.body.cond = clamp(g.body.cond - 5, 0, 100);
    toast(api, g, "冰裂了！你掉进了冰水里，浑身湿透。"); sfx(api, "ice_crack", 1); g.pc.x = g.pc.sx; g.pc.y = g.pc.sy;
  } else if (c2 !== "t" && c2 !== "i") { g.pc.sx = g.pc.x; g.pc.sy = g.pc.y; }
  const bd = bldAt(lvl, g.pc.x, g.pc.y), was = g.inside;
  g.inside = bd ? bd.id : null; g.insideName = bd ? bd.name : "";
  if (bd && was !== bd.id) { sfx(api, "door", 0.7); Object.assign(g, call(api, g, "goal")); }
  if (bd && was !== bd.id) { g.seenB = g.seenB || {}; if (!g.seenB[bd.id]) { g.seenB[bd.id] = true; Object.assign(g, call(api, g, "narrate", { s: JSON.stringify({ event: "第一次走进建筑", extra: { 建筑: bd.type + "「" + bd.name + "」", 房间: (bd.rooms || []).join("、"), 氛围: bd.desc || "" } }) })); } }
  if (c2 === "x") {
    const tx = Math.floor(g.pc.x / T), ty = Math.floor(g.pc.y / T);
    const e = lvl.ex.find((e) => { const along = e.side === "e" || e.side === "w" ? ty : tx; const edge = e.side === "e" ? tx === lvl.w - 1 : e.side === "w" ? tx === 0 : e.side === "n" ? ty === 0 : ty === lvl.h - 1; return edge && Math.abs(along - e.a) <= 1; });
    if (e) {
      const q = api.state.get("aiq");
      if (q.done["region:" + e.to]) {
        save(api, g);
        const rr = api.actions.call("switch_region", { to: e.to, from: g.rid });
        let g2 = api.state.get("g");
        if (rr && rr.first) { toast(api, g2, "—— " + rr.name + " ——"); g2 = call(api, g2, "narrate", { s: JSON.stringify({ event: "第一次来到这里", extra: { 区域描述: rr.desc, force: true } }) }); }
        g2.visitN = (g2.visitN || 0) + 1; g2 = call(api, g2, "arrive");
        save(api, g2);
        return "switched";
      }
      g.ph = "wait"; g.wait = { k: "region", id: e.to, from: g.rid, t0: api.time, l: "你沿着「" + e.label + "」往前走……（AI 正在生成前方的区域）" };
      g.pc.x -= vx * 3; g.pc.y -= vy * 3;
    }
  }
  return running ? "run" : "walk";
}

function ents(api, g, lvl, dt) {
  const px = g.pc.x, py = g.pc.y, night = isNight(g), meat = g.tools && g.tools.meat;
  const ablock = (x, y) => "#wBDLf".indexOf(cell(lvl, x, y)) >= 0;
  for (const e of g.ents) {
    const d = Math.hypot(e.x - px, e.y - py) / T;
    e.t -= dt;
    let sp = 0, tx = e.tx, ty = e.ty;
    if (e.k === "npc") { // 人物：按 AI 定下的打算实时行动
      // 看得见时基本静止（在屋里或门口做自己的事）；只有答应跟着你才会走
      if ((e.plan || "stay") === "follow" && d > 2.5) { sp = d > 6 ? 3.6 : 2.2; tx = px; ty = py; }
      else if (d < 4) e.dir = Math.abs(px - e.x) > Math.abs(py - e.y) ? (px > e.x ? 2 : 1) : py > e.y ? 0 : 3; // 转头看你
      if (sp > 0 && tx !== undefined) {
        const l = Math.hypot(tx - e.x, ty - e.y) || 1, vx = ((tx - e.x) / l) * sp * T * dt, vy = ((ty - e.y) / l) * sp * T * dt;
        if (!blocked(lvl, e.x + vx, e.y, 16)) e.x += vx; else e.t = 0;
        if (!blocked(lvl, e.x, e.y + vy, 16)) e.y += vy; else e.t = 0;
        if (Math.abs(vx) > Math.abs(vy)) e.dir = vx > 0 ? 2 : 1; else if (Math.abs(vy) > 0.01) e.dir = vy > 0 ? 0 : 3;
        e.mv = true;
      } else e.mv = false;
      continue;
    }
    if (e.k === "wolf") {
      const det = (night ? 10 : 8) + (meat ? 3 : 0);
      if (e.st === "flee") { sp = 4.5; tx = e.x + (e.x - px); ty = e.y + (e.y - py); if (e.t <= 0) e.st = "idle"; }
      else if (g.inside || g.wolfCd > 0) e.st = "idle";
      else if (e.st === "idle" && d < det) { e.st = "stalk"; e.t = 3 + api.random.float() * 3; }
      const scary = (g.lit && g.lit.kind === "torch") || (g.flareT && api.time - g.flareT < 20000);
      if (scary && (e.st === "stalk" || e.st === "charge") && d < 5.5) { e.st = "flee"; e.t = 5; } // 举着火把：狼不敢靠近
      if (e.st === "stalk") { sp = d > 5 ? 2 : 0.4; tx = px; ty = py; if (e.t <= 0 || d < 3) e.st = "charge"; if (d > det + 6) e.st = "idle"; }
      if (e.st === "charge") { sp = 5.2; tx = px; ty = py; if (d < 0.7) { g.ui = { mode: "struggle", t: 0, meter: 20 }; g.busy = null; sfx(api, "wolf_attack", 1); e.st = "flee"; e.t = 30; } if (d > det + 8) e.st = "idle"; }
    } else {
      if (d < (e.k === "deer" ? 6 : 4) && !g.inside) { e.st = "flee"; e.t = 4; }
      if (e.st === "flee") { sp = e.k === "deer" ? 4.8 : 4; tx = e.x + (e.x - px); ty = e.y + (e.y - py); if (e.t <= 0) e.st = "idle"; }
    }
    if (e.st === "idle") {
      sp = e.k === "wolf" ? 1.2 : 0.7;
      if (e.t <= 0 || tx === undefined) { const a = api.random.float() * 6.283, r = api.random.float() * e.hr; e.tx = e.hx + Math.cos(a) * r; e.ty = e.hy + Math.sin(a) * r; e.t = 3 + api.random.float() * 4; tx = e.tx; ty = e.ty; }
      if (Math.hypot(tx - e.x, ty - e.y) < 8) sp = 0;
    }
    if (sp > 0 && tx !== undefined) {
      const l = Math.hypot(tx - e.x, ty - e.y) || 1, vx = ((tx - e.x) / l) * sp * T * dt, vy = ((ty - e.y) / l) * sp * T * dt;
      if (!ablock(e.x + vx, e.y)) e.x += vx; else e.t = 0;
      if (!ablock(e.x, e.y + vy)) e.y += vy; else e.t = 0;
      e.x = clamp(e.x, T, (lvl.w - 1) * T); e.y = clamp(e.y, T, (lvl.h - 1) * T);
      if (Math.abs(vx) > 0.01) e.dir = vx > 0 ? 1 : -1;
      e.mv = true;
    } else e.mv = false;
  }
}

// 太黑时：搜柜子、捡东西、看痕迹、在工作台做东西、完成目标动作都不行（摸黑能生火、睡觉、进门、说话）
function focus(g, lvl) {
  const f = focus0(g, lvl);
  if (!f || (g.bright || 1) >= DARK) return f;
  const i = f.k === "ix" ? lvl.ix.find((x) => x.x + "," + x.y === f.ref) : null;
  if (f.k === "gi" || f.k === "mark" || f.k === "goal" || (i && (i.k === "cont" || i.k === "bench"))) return { k: "dark", l: "太黑了，看不清（需要光）" };
  return f;
}
function focus0(g, lvl) {
  const px = g.pc.x, py = g.pc.y;
  const tx = Math.floor(px / T), ty = Math.floor(py / T);
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { // 门优先
    const x = tx + dx, y = ty + dy; if (x < 0 || y < 0 || x >= lvl.w || y >= lvl.h) continue;
    const ch = lvl.c[y][x];
    if (ch === "D") { const b = lvl.bld.find((b) => x === b.x + b.door && y === b.y + b.h - 1); if (b) return { k: "door", ref: b.id, l: "进入 " + b.name, p: [x, y] }; }
    if (ch === "L") return { k: "lock", ref: x + "," + y, l: "撬开上锁的门", p: [x, y] };
  }
  let best = null, bd = 1e9;
  for (const e of g.ents) if (e.k === "npc") { const d = Math.hypot(e.x - px, e.y - py); if (d < 1.4 * T && d < bd) { bd = d; best = { k: "npc", ref: e.id, l: "和 " + e.name + " 交谈" }; } }
  if (best) return best;
  const gn = g.goalNow;
  lvl.gi.forEach((it, k) => { const d = Math.hypot((it.x + 0.5) * T - px, (it.y + 0.5) * T - py); if (d < 0.9 * T && d < bd) { bd = d; best = { k: "gi", ref: k, l: "拾取 " + (it.nm || "东西") + (it.n > 1 ? " ×" + it.n : "") }; } });
  for (const i of lvl.ix) {
    const goalHit = gn && gn.t === "use" && gn.region === g.rid && i.t === gn.object;
    if (!goalHit && (i.k === "deco" || i.k === "floor")) continue;
    if (goalHit) { const cx = clamp(px, i.x * T, (i.x + i.w) * T), cy = clamp(py, i.y * T, (i.y + i.h) * T); if (Math.hypot(cx - px, cy - py) < 0.75 * T) return { k: "goal", ref: i.x + "," + i.y, l: gn.label || gn.hint }; }
    if (i.k === "mark") { const d = Math.hypot((i.x + 0.5) * T - px, (i.y + 0.5) * T - py); if (d < 0.9 * T && d < bd) { bd = d; best = { k: "mark", ref: i.x + "," + i.y, l: "查看痕迹" }; } continue; }
    const cx = clamp(px, i.x * T, (i.x + i.w) * T), cy = clamp(py, i.y * T, (i.y + i.h) * T), d = Math.hypot(cx - px, cy - py);
    if (d > 0.75 * T || d >= bd) continue;
    bd = d;
    const name = i.name || FNAME[i.t] || "东西", lit = g.fire[g.rid + ":" + i.x + "," + i.y];
    const l = i.k === "cont" ? (i.lock ? "撬开 " + name : i.s ? "翻看 " + name : "搜索 " + name) : i.k === "heat" ? (lit ? name + "（在烧）" : "生火：" + name) : i.k === "bed" ? "睡觉：" + name : i.k === "bench" ? "制作：" + name : i.k === "wood" ? "收集柴火：" + name : i.k === "carcass" ? "剥取 " + name : i.k === "finale" ? "检查 " + name : name;
    best = { k: "ix", ref: i.x + "," + i.y, l };
  }
  return best;
}
