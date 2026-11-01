// 雪线 · 人物（npc.js）
// 1) hour：每个游戏小时推演一次所有人物的生存——和玩家同一套公式（热量、水分、体温、状态），
//    他们要自己找吃的、生火、搜刮柜子、赶路，会冻死饿死，死后留下遗体和身上的东西。
// 2) 交谈工具：AI 扮演人物说话，只能通过这里的工具改变状态，规则检查公平和可行性。

const DAY = 1440, T = 64;
const BURN = { sleep: 75, idle: 125, walk: 200 };
const CLOTH = { w: 9.8, p: 6 }; // 和玩家开局一样的一身衣服
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const str = (v, n) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, n);
let _s = 1;
function seedFrom(api) { _s = api.random.int(1, 2147483646) >>> 0; }
function rnd() { _s = (_s + 0x6d2b79f5) >>> 0; let t = _s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = (l) => l[Math.floor(rnd() * l.length)];
function toast(api, g, text) { g.toast = (g.toast || []).filter((m) => api.time - m.t < 6000).concat([{ t: api.time, text }]).slice(-4); }

// 物品价值（交易公平性检查用）
function value(d) {
  if (!d) return 0;
  if (d.kcal) return d.kcal / 100;
  return { water_safe: 4, water_unsafe: 1, drink: 3, matches: 6, flint: 12, tinder: 1, fuel_stick: 0.3, fuel_soft: 2, fuel_hard: 3, fuel_coal: 3, bandage: 5, antibiotic: 10, painkiller: 6,
    tablets: 6, flare: 8, torch: 3, knife: 15, hatchet: 15, prybar: 12, sewing: 8, pot: 8, can_empty: 1, cloth: 1, hide: 4, paper: 0.5, misc: 0.5, note: 0, key: 25,
    hat: 5, coat: 12, shirt: 5, pants: 5, gloves: 4, boots: 7, socks: 3 }[d.cat] || 1;
}
const isFood = (d) => d && d.kcal > 0 && !/_raw$/.test(d.cat);
const isWater = (d) => d && (d.cat === "water_safe" || d.cat === "drink");
const isFuel = (d) => d && /^fuel_/.test(d.cat);
function npcHas(n, id) { return n.inv.find((e) => e[0] === id); }
function npcTake(n, id, k) { const e = npcHas(n, id); if (!e) return false; e[1] -= k; if (e[1] <= 0) n.inv.splice(n.inv.indexOf(e), 1); return true; }
function npcAdd(n, id, k) { const e = npcHas(n, id); if (e) e[1] += k; else n.inv.push([id, k]); }
function remember(n, text) { n.mem = (n.mem || []).concat([text]).slice(-8); }

// ───────── 看不见时：每 12 个游戏小时粗算一次（省算力；具体干了什么由 AI 导演编成痕迹） ─────────
export function hour(api) {
  seedFrom(api);
  const npcs = api.state.get("npcs"); if (!npcs || !npcs.length) return true;
  const g = api.state.get("g"), defs = api.state.get("defs"), world = api.state.get("world"), lvl = api.state.get("lvl");
  const dirty = {};
  for (const n of npcs) {
    if (!n.alive) continue;
    const here = n.rid === g.rid;
    const L0 = here ? lvl : api.state.get("c_" + n.rid), L = L0 && L0.c ? L0 : null;
    const style = (world.story.people.find((p) => p.id === n.id) || {}).style || "";
    // 半天的消耗：一份吃的、一份喝的；没有就挨饿受冻（和玩家同样的代价量级）
    const food = n.inv.find((e) => isFood(defs[e[0]])), drink = n.inv.find((e) => isWater(defs[e[0]]));
    if (food) npcTake(n, food[0], 1); else n.cond -= 12;
    if (drink) npcTake(n, drink[0], 1); else n.cond -= 8;
    if (!n.inv.some((e) => /^fuel_/.test((defs[e[0]] || {}).cat || "")) && !n.home) n.cond -= 10; // 没柴又没屋，夜里难熬
    if (food && drink) n.cond = Math.min(100, n.cond + 10);
    n.cond = clamp(n.cond, 0, 100);
    // 找东西：看得见的地图上会真的从柜子里拿（和玩家抢），没生成的地方就碰运气
    const greedy = style === "贪婪" ? 0.8 : style === "谨慎" ? 0.35 : 0.55;
    if (!here && rnd() < greedy) {
      const conts = L && L.ix ? L.ix.filter((i) => i.k === "cont" && i.items && i.items.some((x) => !["key", "note"].includes((defs[x[0]] || {}).cat))) : [];
      if (conts.length) {
        const c = pick(conts), k = c.items.findIndex((x) => !["key", "note"].includes((defs[x[0]] || {}).cat)), [id, cnt] = c.items[k];
        c.items.splice(k, 1); npcAdd(n, id, cnt);
        L.ix.push({ k: "mark", t: "mark", x: c.x, y: c.y + c.h, w: 1, h: 1, text: (n.traceText && n.traceText.shift()) || "柜子被翻过了，有人拿走了东西。" });
        dirty[n.rid] = L;
      } else npcAdd(n, pick(["i_cracker", "i_can_beans", "i_jerky", "i_water", "i_tea", "i_stick", "i_match"]), 1);
    }
    // 换地方：导演安排的，或者饿得待不下去了
    if (!here && n.plan.t === "move" && n.plan.to && n.plan.to !== n.rid) {
      const next = nextHop(world, n.rid, n.plan.to);
      if (next) { n.rid = next; n.home = null; n.x = null; n.y = null; remember(n, "到了" + (world.regions[next] || {}).name); addTrace(api, world, next, n, (n.traceText && n.traceText.shift()) || pick(["雪地上有一圈熄灭的篝火，灰还是温的。", "一串脚印从这里经过，步子很乱。", "树干上用刀刻了一个箭头。"]), g, lvl); }
      if (!next || next === n.plan.to) n.plan = { t: "stay" };
    } else if (!here && n.cond < 40 && !food && n.plan.t !== "follow") {
      const adj = world.links.filter((l) => l[0] === n.rid || l[1] === n.rid).map((l) => (l[0] === n.rid ? l[1] : l[0]));
      if (adj.length) { n.plan = { t: "move", to: pick(adj) }; remember(n, "这里没吃的了"); }
    }
    // 撑不住了：留下遗体（身上的东西都在）
    if (n.cond <= 0) {
      n.alive = false; n.cause = food ? "冻死" : "饿死";
      if (L) { const p = freeSpot(L, n); L.ix.push({ k: "cont", t: "corpse", f: true, name: n.name + "的遗体", x: p[0], y: p[1], w: 1, h: 1, items: n.inv.slice() }); L.c[p[1]] = L.c[p[1]].slice(0, p[0]) + "#" + L.c[p[1]].slice(p[0] + 1); dirty[n.rid] = L; }
      else n.corpsePending = true;
      if (here) g.ents = g.ents.filter((e) => e.id !== n.id);
    }
  }
  for (const rid in dirty) api.state.set(rid === g.rid ? "lvl" : "c_" + rid, dirty[rid]);
  api.state.set("npcs", npcs);
  api.state.set("g", g);
  return true;
}
// 第一次碰见时问 AI 一次：他此刻在做什么、心里在想什么（之后就是静止 + 对话）
export function mind(api) {
  const npcs = api.state.get("npcs"), n = npcs.find((x) => x.id === api.params.id); if (!n || !n.alive) return false;
  const t = String(api.params.s || ""), a = t.indexOf("{"), b = t.lastIndexOf("}");
  let j = null; try { j = a >= 0 ? JSON.parse(t.slice(a, b + 1)) : null; } catch (e) { j = null; }
  if (!j) return false;
  n.doing = str(j.doing, 20); n.say = str(j.say, 40);
  if (j.mood) remember(n, "见到玩家时的心情：" + str(j.mood, 20));
  api.state.set("npcs", npcs);
  const g = api.state.get("g"); const e = (g.ents || []).find((x) => x.id === n.id);
  if (e) { e.doing = n.doing; e.say = n.say; e.sayT = api.time; api.state.set("g", g); }
  return true;
}
function freeSpot(L, n) {
  for (let t = 0; t < 200; t++) { const x = 2 + Math.floor(rnd() * (L.w - 4)), y = 2 + Math.floor(rnd() * (L.h - 4)); if (L.c[y][x] === "." || L.c[y][x] === "f") return [x, y]; }
  return [5, 5];
}
function addTrace(api, world, rid, n, text, g, lvl) {
  const L = rid === g.rid ? lvl : api.state.get("c_" + rid);
  if (!L || !L.c) { n.pendingTraces = (n.pendingTraces || []).concat([{ rid, text }]).slice(-4); return; }
  const p = freeSpot(L, n);
  L.ix.push({ k: "mark", t: "mark", x: p[0], y: p[1], w: 1, h: 1, text });
  api.state.set(rid === g.rid ? "lvl" : "c_" + rid, L);
}
function nextHop(world, from, to) {
  const prev = { [from]: null }, q = [from];
  while (q.length) { const a = q.shift(); if (a === to) break; for (const l of world.links) { const b = l[0] === a ? l[1] : l[1] === a ? l[0] : null; if (b && !(b in prev)) { prev[b] = a; q.push(b); } } }
  if (!(to in prev)) return null;
  let c = to; while (prev[c] !== from && prev[c] !== null) c = prev[c];
  return c;
}

// ───────── 交谈工具（AI 调用；规则检查） ─────────
function ctx(api) {
  const id = api.state.get("talk_npc");
  const npcs = api.state.get("npcs"), g = api.state.get("g"), defs = api.state.get("defs");
  const n = npcs.find((x) => x.id === id);
  if (!n || !n.alive || n.rid !== g.rid || !g.ui || g.ui.mode !== "talk") { api.fail("现在没有在和任何人交谈。"); return null; }
  g.sess = g.sess || { npc: id, gain: 0, trades: 0 };
  return { npcs, n, g, defs };
}
// 每次对话的上限：信任最多 +15，最多成交 3 笔（防止靠嘴刷好感、刷物资）
const SESSION_GAIN = 15, SESSION_TRADES = 3;
function gainTrust(c, up) { const room = Math.max(0, SESSION_GAIN - c.g.sess.gain); const real = up > 0 ? Math.min(up, room) : up; c.g.sess.gain += Math.max(0, real); c.n.trust = clamp(c.n.trust + real, -100, 100); return real; }
function done(api, c, text) { api.state.set("npcs", c.npcs); api.state.set("g", c.g); return text; }
function invCount(g, id) { return g.inv.filter((e) => e.id === id).reduce((s, e) => s + e.n, 0); }
function invRemove(g, id, k) { for (let i = g.inv.length - 1; i >= 0 && k > 0; i--) if (g.inv[i].id === id) { const t = Math.min(k, g.inv[i].n); g.inv[i].n -= t; k -= t; if (g.inv[i].n <= 0) g.inv.splice(i, 1); } }
function invGive(g, defs, id, k) { const d = defs[id]; if (d && d.uses && d.cat !== "bandage") { for (let i = 0; i < k; i++) g.inv.push({ id, n: 1, u: d.uses }); } else { const e = g.inv.find((x) => x.id === id); if (e) e.n += k; else g.inv.push({ id, n: k }); } }

// 以物易物：玩家给 give_item×give_n，换对方的 take_item×take_n
export function trade(api) {
  const c = ctx(api); if (!c) return;
  const p = api.params, gi = str(p.give_item, 40), ti = str(p.take_item, 40), gn = clamp(Math.round(num(p.give_n, 1)), 1, 5), tn = clamp(Math.round(num(p.take_n, 1)), 1, 5);
  const dg = c.defs[gi], dt = c.defs[ti];
  if (!dg || invCount(c.g, gi) < gn) return api.fail("玩家身上没有足够的「" + (dg ? dg.name : gi) + "」。");
  const e = npcHas(c.n, ti);
  if (!dt || !e || e[1] < tn) return api.fail(c.n.name + "身上没有足够的「" + (dt ? dt.name : ti) + "」。");
  if (c.g.sess.trades >= SESSION_TRADES) return api.fail("这次谈话已经交易过 " + SESSION_TRADES + " 次了，" + c.n.name + "不想再换了。");
  if (dg.cat === "note") return api.fail("笔记不能拿来交易。");
  if (dt.cat === "key" && c.n.trust < 40) return api.fail(c.n.name + "还不够信任玩家，不会交出" + dt.name + "。");
  const vg = value(dg) * gn, vt = value(dt) * tn, tol = 1 + c.n.trust / 100;
  if (vt > vg * tol + 1) return api.fail("规则判定：这笔交易对" + c.n.name + "太亏（对方给出价值约 " + Math.round(vt) + "，玩家只给 " + Math.round(vg) + "），对方不会接受。");
  invRemove(c.g, gi, gn); npcAdd(c.n, gi, gn); npcTake(c.n, ti, tn); invGive(c.g, c.defs, ti, tn);
  gainTrust(c, 3); c.g.sess.trades++;
  remember(c.n, "和玩家用" + dg.name + "换了" + dt.name);
  c.g.hist = (c.g.hist || []).concat(["用" + dg.name + "跟" + c.n.name + "换了" + dt.name]).slice(-30);
  toast(api, c.g, "交易：" + dg.name + "×" + gn + " → " + dt.name + "×" + tn);
  return done(api, c, "成交。");
}
// 对方白送（要足够信任，每天最多一次，价值有限）
export function give(api) {
  const c = ctx(api); if (!c) return;
  const id = str(api.params.item, 40), k = clamp(Math.round(num(api.params.n, 1)), 1, 3), d = c.defs[id], e = npcHas(c.n, id);
  if (!d || !e || e[1] < k) return api.fail(c.n.name + "身上没有这个东西。");
  if (c.n.trust < 30) return api.fail("信任不够（" + c.n.trust + "/30），" + c.n.name + "不会白给东西。");
  const day = Math.floor(c.g.clock / DAY);
  if (c.n.gave === day) return api.fail(c.n.name + "今天已经给过东西了。");
  if (value(d) * k > 8 && d.cat !== "key") return api.fail("这份礼太重了，规则不允许白送（价值上限 8）。");
  npcTake(c.n, id, k); invGive(c.g, c.defs, id, k); c.n.gave = day;
  remember(c.n, "送了玩家" + d.name);
  c.g.hist = (c.g.hist || []).concat([c.n.name + "送给你" + d.name]).slice(-30);
  toast(api, c.g, c.n.name + "给了你：" + d.name + (k > 1 ? "×" + k : ""));
  return done(api, c, "给了。");
}
// 玩家送东西给对方
export function receive(api) {
  const c = ctx(api); if (!c) return;
  const id = str(api.params.item, 40), k = clamp(Math.round(num(api.params.n, 1)), 1, 5), d = c.defs[id];
  if (!d || invCount(c.g, id) < k) return api.fail("玩家身上没有足够的这个东西。");
  invRemove(c.g, id, k); npcAdd(c.n, id, k);
  const up = gainTrust(c, Math.min(15, Math.round(value(d) * k * 1.5)));
  remember(c.n, "收到玩家送的" + d.name);
  c.g.hist = (c.g.hist || []).concat(["把" + d.name + "送给了" + c.n.name]).slice(-30);
  toast(api, c.g, "你把" + d.name + "给了" + c.n.name);
  return done(api, c, "收下了，信任 +" + up + "。");
}
// 态度变化（每次 ±10 以内）
export function trust(api) {
  const c = ctx(api); if (!c) return;
  const dlt = gainTrust(c, clamp(Math.round(num(api.params.delta, 0)), -10, 10));
  if (api.params.reason) remember(c.n, str(api.params.reason, 40));
  return done(api, c, "信任现在是 " + c.n.trust + "。");
}
// 改变打算：跟着玩家、躲开、留下、去别的区域
export function plan(api) {
  const c = ctx(api); if (!c) return;
  const t = str(api.params.plan, 10), to = str(api.params.region, 8), world = api.state.get("world");
  if (!["stay", "follow", "avoid", "move", "wait"].includes(t)) return api.fail("打算只能是 stay/follow/avoid/move/wait。");
  if (t === "follow" && c.n.trust < 20) return api.fail("信任不够（" + c.n.trust + "/20），" + c.n.name + "不会跟玩家走。");
  if (t === "move" && !world.regions[to]) return api.fail("没有这个区域。");
  if (t === "move" && to === c.n.rid) return api.fail(c.n.name + "已经在这里了。");
  c.n.plan = t === "move" ? { t, to } : { t };
  remember(c.n, "决定" + { stay: "留在这里", follow: "跟着玩家", avoid: "离玩家远点", move: "去" + (world.regions[to] || {}).name, wait: "在这里等" }[t]);
  return done(api, c, "好。");
}
