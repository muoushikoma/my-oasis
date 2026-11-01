// 《无尽之路》游戏画面（自定义组件）：组件里自己画像素场景，界面叠在场景上。
// 只能读玩家可见的状态，只能调用 story.yaml 里给这个组件声明的动作。
(() => {
const T = (zh, en) => (oasis.lang === "en" ? en : zh);
const $ = (id) => document.getElementById(id);
const IMG = {}; for (const im of document.querySelectorAll("#assets img")) IMG[im.dataset.k] = im;
const W0 = 256, H0 = 144, GROUND = 118, HERO_X = 58, SPEED = 120;
const SPR = {
  hero_fighter: [24, 27, 6], hero_rogue: [24, 27, 6], hero_wizard: [24, 27, 6], hero_cleric: [24, 27, 6],
  wolf: [37, 18], spider: [32, 18], bandit: [20, 21], skeleton: [20, 23], troll: [31, 24], drake: [34, 21], ooze: [26, 16], wisp: [22, 20, 1, 10], warden: [30, 27],
  chest: [22, 14], cart: [40, 20], shrine: [24, 19], campfire: [36, 13, 2], stranger: [16, 20], rocks: [28, 11], chasm: [54, 11, 1, 0, 3], thorns: [35, 9],
};
const TINT = { red: "#ff9a8a", green: "#a8ff9a", blue: "#9ac4ff", gold: "#ffe08a", shadow: "#8078a0", pale: "#e8f4ff", purple: "#d4a4ff", black: "#000000", hurt: "#ff7a7a" };
const LAYERS = [["sky", 0, 256], ["far", 0.15, 256], ["mid", 0.4, 512], ["ground", 1, 512]];
const BIOME = { plains: ["风语平原", "Whispering Plains"], forest: ["幽暗森林", "Gloomwood"], hills: ["古冢丘陵", "Barrow Hills"], swamp: ["腐沼泽地", "Rotfen Marsh"], mountains: ["霜脊山道", "Frostspine Pass"], ashlands: ["余烬荒原", "Emberwaste"] };
const mod = (a, n) => ((a % n) + n) % n;
let S = {}; // 最新状态

// ================= 场景 =================
const cv = $("scene"), ctx = cv.getContext("2d");
let scale = 4, worldW = W0, offY = 0, dx = 0, viewW = 0, viewH = 0, dispScroll = 0, lastT = performance.now();
const tintCache = new Map();
function tinted(key, color) {
  const id = key + color; let c = tintCache.get(id); if (c) return c;
  const im = IMG[key]; if (!im || !im.complete) return im;
  c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext("2d"); x.drawImage(im, 0, 0); x.globalCompositeOperation = "multiply"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = "destination-in"; x.drawImage(im, 0, 0); tintCache.set(id, c); return c;
}
function sprite(name, x, base, o) {
  const m = SPR[name]; if (!m) return null; o = o || {};
  const [w, h, frames = 1, float = 0, sink = 0] = m, sc = o.scale || 1;
  const fr = o.frame || 0, y = base - h * sc + 1 + sink * sc - (float ? float + Math.round(Math.sin(performance.now() / 300) * 2) : 0);
  const src = o.tint ? tinted(name, o.tint) : IMG[name]; if (!src) return null;
  ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
  ctx.drawImage(src, fr * w, 0, w, h, Math.round(x - (w * sc) / 2), Math.round(y), w * sc, h * sc);
  ctx.globalAlpha = 1;
  return { x: x - (w * sc) / 2, y, w: w * sc, h: h * sc };
}
// 粒子（纯视觉）
const parts = [];
function emit(n, x, y, o) { for (let i = 0; i < n; i++) { const a = (o.angle ?? -90) * Math.PI / 180 + (Math.random() - 0.5) * (o.spread ?? 360) * Math.PI / 180, sp = (o.speed ?? 20) * (0.5 + Math.random()); parts.push({ x: x + (Math.random() - 0.5) * 2 * (o.r || 0), y: y + (Math.random() - 0.5) * 2 * (o.ry ?? o.r ?? 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: o.g || 0, life: o.life || 1, t: 0, c0: o.c0, c1: o.c1 || o.c0, size: o.size || 1, add: !!o.add }); } }
function stepParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.t += dt; if (p.t >= p.life) { parts.splice(i, 1); continue; } p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  if (parts.length > 900) parts.splice(0, parts.length - 900);
}
function drawParts() {
  for (const p of parts) { const k = p.t / p.life; ctx.globalAlpha = 1 - k * 0.8; ctx.globalCompositeOperation = p.add ? "lighter" : "source-over"; ctx.fillStyle = k < 0.5 ? p.c0 : p.c1; const s = Math.max(1, Math.round(p.size * (1 - k * 0.5))); ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}
let acc = { weather: 0, fire: 0, aura: 0, rune: 0 };
function resize() {
  const r = $("view").getBoundingClientRect(); viewW = Math.max(1, Math.round(r.width)); viewH = Math.max(1, Math.round(r.height));
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(viewW * dpr); cv.height = Math.round(viewH * dpr);
  scale = Math.max(1, Math.floor((viewH * dpr) / H0)); if ((viewH * dpr) / scale < H0 * 0.98) scale = Math.max(1, scale - 1);
  worldW = Math.ceil(cv.width / scale); offY = Math.floor((cv.height / scale - H0) / 2);
  dx = Math.round(worldW * (viewW > viewH * 1.2 ? 0.3 : 0.24)) - HERO_X; // 主角在画面的位置
}
window.addEventListener("resize", resize);
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const s = S.scene_fx || { scroll: 0, target: 0 };
  // 本地插值：朝目标卷动，不落后于规则里的位置
  if (dispScroll < s.scroll - 4 || dispScroll > s.target + 1) dispScroll = s.scroll;
  if (dispScroll < s.target) dispScroll = Math.min(s.target, dispScroll + SPEED * dt);
  draw(s, dt, now);
  requestAnimationFrame(frame);
}
function draw(s, dt, now) {
  if (!viewW) resize();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  const biome = S.biome || "plains";
  // 上下留出的空白：顶部用天空色，底部用泥土色
  ctx.fillStyle = "#0d0a08"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(scale, 0, 0, scale, 0, offY * scale);
  if (offY > 0) { const sky = IMG[`${biome}_sky`]; if (sky) ctx.drawImage(sky, 0, 0, 1, 1, 0, -offY, worldW, offY + 1); const g = IMG[`${biome}_ground`]; if (g) ctx.drawImage(g, 0, H0 - 1, 1, 1, 0, H0 - 1, worldW, offY + 2); }
  const scroll = dispScroll;
  for (const [layer, k, lw] of LAYERS) { const im = IMG[`${biome}_${layer}`]; if (!im) continue; const ox = -mod(Math.round(scroll * k), lw); for (let x = ox; x < worldW; x += lw) ctx.drawImage(im, x, 0); }
  const walking = dispScroll < s.target - 0.5;
  const sx = (wx) => wx - scroll + dx;
  if (s.prev) sprite(s.prev.sprite, sx(s.prev.wx), GROUND, { scale: s.prev.scale, tint: TINT[s.prev.tint], frame: 0 });
  let box = null, foeX = null;
  if (s.cur) {
    const c = s.cur, m = SPR[c.sprite] || [20, 20];
    let x = sx(c.wx); if (s.fhurt > 0) x += Math.round(Math.sin(s.fhurt / 20) * 3) + 3;
    foeX = x;
    if (c.boss && !c.pending) { acc.aura += dt * 24; while (acc.aura > 1) { acc.aura--; emit(1, x, GROUND - m[1] * (c.scale || 1) / 2, { r: 22, speed: 8, life: 1.2, c0: "#ff8a4a", c1: "#ff2a1a", size: 2, add: true }); } }
    const flash = s.fhurt > 0 && Math.floor(s.fhurt / 60) % 2 === 0;
    box = sprite(c.sprite, x, GROUND, { scale: c.scale, frame: m[2] > 1 ? Math.floor(now / 180) % m[2] : 0, tint: c.pending ? TINT.black : TINT[c.tint], alpha: c.pending ? 0.75 : flash ? 0.35 : 1 });
    if (!c.pending && c.sprite === "campfire") { acc.fire += dt * 16; while (acc.fire > 1) { acc.fire--; emit(1, x + 6, GROUND - 8, { r: 2, angle: -90, spread: 30, speed: 14, g: -6, life: 0.7, c0: "#ffb03a", c1: "#ff4a1a", add: true }); } }
    if (!c.pending && c.sprite === "shrine") { acc.rune += dt * 6; while (acc.rune > 1) { acc.rune--; emit(1, x, GROUND - 22, { r: 6, angle: -90, spread: 120, speed: 8, life: 1.6, c0: "#c4f2ff", c1: "#4a8aff", add: true }); } }
  }
  if (s.dying) sprite(s.dying.sprite, sx(s.dying.wx) + (600 - s.dying.t) / 30, GROUND, { scale: s.dying.scale, tint: "#ff6a5a", alpha: Math.max(0, s.dying.t / 600) });
  // 主角
  const cls = S.hero_class || "fighter";
  let hx = HERO_X + dx, fr = 0;
  if (walking) fr = 1 + (Math.floor(dispScroll / 7) % 4); else if (s.atk > 0) { fr = 5; hx += 6; }
  if (s.hhurt > 0) hx -= Math.round(Math.sin(s.hhurt / 25) * 2) + 2;
  const hb = sprite(`hero_${cls}`, hx, GROUND, { frame: fr, tint: s.hhurt > 0 && Math.floor(s.hhurt / 60) % 2 === 0 ? TINT.hurt : null, alpha: S.hp <= 0 ? 0.4 : 1 });
  if (s.atk > 0 && cls === "wizard" && foeX != null) { const k = Math.min(1, 1 - s.atk / 450), bx = hx + 14 + (foeX - hx - 14) * k, by = GROUND - 16 - Math.sin(k * Math.PI) * 6; emit(3, bx, by, { r: 1, speed: 10, life: 0.25, c0: "#ffd06a", c1: "#ff4a1a", size: 2, add: true }); ctx.fillStyle = "#fff2b0"; ctx.fillRect(Math.round(bx) - 2, Math.round(by) - 2, 4, 4); }
  else if (s.atk > 0) { const a = 1 - s.atk / 300; ctx.fillStyle = "#fff"; for (let i = 0; i < 6; i++) { const ang = -1.2 + a * 2 + i * 0.12; ctx.globalAlpha = 0.9 - i * 0.12; ctx.fillRect(Math.round(hx + 14 + Math.cos(ang) * 14), Math.round(GROUND - 12 + Math.sin(ang) * 14), 2, 2); } ctx.globalAlpha = 1; }
  // 敌人血条
  if (S.phase === "battle" && box && S.foe && S.foe.max_hp && s.cur && !s.cur.pending) {
    const bw = 30, bx = Math.round(box.x + box.w / 2 - bw / 2), by = Math.round(box.y - 7);
    ctx.fillStyle = "#1a1420"; ctx.fillRect(bx - 1, by - 1, bw + 2, 5); ctx.fillStyle = "#4a1410"; ctx.fillRect(bx, by, bw, 3);
    ctx.fillStyle = S.foe.boss ? "#ff7a3a" : "#e2422c"; ctx.fillRect(bx, by, Math.max(0, Math.round(bw * S.foe.hp / S.foe.max_hp)), 3);
  }
  // 天气
  const weather = (S.art || {}).weather || "clear", Wd = worldW;
  const rate = { rain: 200, snow: 50, embers: 26, fireflies: 6, leaves: 9 }[weather] || 0;
  acc.weather += dt * rate * (Wd / 256);
  while (acc.weather > 1) { acc.weather--; const x = Math.random() * Wd;
    if (weather === "rain") emit(1, x, -4, { angle: 105, spread: 4, speed: 260, life: 0.7, c0: "#a8c8ff" });
    else if (weather === "snow") emit(1, x, -4, { angle: 100, spread: 30, speed: 20, life: 7, c0: "#ffffff", size: 2 });
    else if (weather === "embers") emit(1, x, H0 + 2, { angle: -95, spread: 40, speed: 20, life: 4, c0: "#ffc04a", c1: "#ff3a1a", size: 2, add: true });
    else if (weather === "fireflies") emit(1, x, GROUND - 20 - Math.random() * 30, { speed: 5, life: 3, c0: "#e8ff8a", c1: "#6aff6a", size: 2, add: true });
    else if (weather === "leaves") emit(1, x, -4, { angle: 115, spread: 30, speed: 22, life: 6, c0: "#e8a040", c1: "#c25a2a", size: 2 }); }
  stepParts(dt); drawParts();
  if (weather === "fog") { ctx.fillStyle = "#dfe8e4"; for (let i = 0; i < 5; i++) { const fx = mod(Math.round(i * 90 - now / 60 - scroll * 0.6), Wd + 120) - 120; ctx.globalAlpha = 0.12; ctx.fillRect(fx, GROUND - 32 + i * 6, 140, 14); } ctx.globalAlpha = 1; }
  // 时间色调（用 CSS 叠加层，过渡更柔和）
  const time = (S.art || {}).time || "day";
  $("tint").style.backgroundColor = time === "night" ? "rgba(40,54,120,.62)" : time === "dusk" ? "rgba(255,140,80,.32)" : "rgba(0,0,0,0)";
  // 记下屏幕位置给界面用（飘字、问号）
  const css = (wx, wy) => ({ x: (wx * scale) / (window.devicePixelRatio || 1), y: ((wy + offY) * scale) / (window.devicePixelRatio || 1) });
  POS.hero = hb ? css(hb.x + hb.w / 2, hb.y) : null; POS.foe = box ? css(box.x + box.w / 2, box.y) : null; POS.pending = !!(s.cur && s.cur.pending);
  placeMarks();
}
const POS = {};
// 飘字：每条 fx 只弹一次
const seen = new Set();
function popups() {
  const s = S.scene_fx || {};
  for (const f of s.fx || []) {
    if (!f.id || seen.has(f.id)) continue; seen.add(f.id);
    const at = (f.foe ? POS.foe : POS.hero) || POS.hero; if (!at) continue;
    const map = { v: "✓", x: T("未命中", "MISS"), s: T("闪开", "DODGE"), h: "⚒" };
    const el = document.createElement("div"); el.className = "pop out"; el.textContent = map[f.text] || f.text; el.style.color = f.color || "#fff";
    if (map[f.text] && f.text !== "v" && f.text !== "h") el.style.fontSize = "22px";
    el.style.left = `${at.x + (Math.random() - 0.5) * 30}px`; el.style.top = `${at.y - 20}px`;
    $("fx").append(el); setTimeout(() => el.remove(), 950);
  }
  if (seen.size > 200) { const keep = [...seen].slice(-50); seen.clear(); keep.forEach((k) => seen.add(k)); }
}
let qmark = null;
function placeMarks() {
  if (POS.pending && POS.foe) { if (!qmark) { qmark = document.createElement("div"); qmark.className = "qmark out"; qmark.textContent = "?"; $("fx").append(qmark); } qmark.style.left = `${POS.foe.x}px`; qmark.style.top = `${POS.foe.y - 46}px`; }
  else if (qmark) { qmark.remove(); qmark = null; }
}

// ================= 界面 =================
let pending = false, msg = "", sheet = null, journalOpen = false;
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k === "class") e.className = v; else if (k === "style") Object.assign(e.style, v); else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v); }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const icon = (n, big) => h("i", { class: `i i-${n}${big ? " x2" : ""}` });
const busy = () => pending || oasis.busy || oasis.ended;
const heroUrl = (c) => (IMG[`hero_${c}`] || IMG.hero_fighter).src;
async function run(action, params) {
  if (pending) return; pending = true; msg = ""; render();
  try { const r = await oasis.action(action, params || {}); if (!r.ok) { msg = r.error || T("现在做不到。", "Can't do that right now."); setTimeout(() => { msg = ""; render(); }, 2600); } }
  finally { pending = false; render(); }
}
function hud(s) {
  const pct = Math.max(0, Math.min(100, (100 * (s.hp || 0)) / (s.max_hp || 1))), xp = Math.min(100, (100 * (s.xp || 0)) / (s.xp_next || 1));
  const g = s.gear || {}, cr = 8 + 4 * (g.pack || 0), cp = 3 + (g.pack || 0);
  return h("div", { class: "hud" + ((s.items_ui || []).length ? " withitems" : "") },
    h("div", { class: "wood face" }, h("div", { class: "spr", style: { backgroundImage: `url(${heroUrl(s.hero_class)})` } })),
    h("div", { class: "stats" },
      h("div", { class: "name serif out" }, s.class_name || T("旅人", "Traveler"), h("small", {}, `${T("等级", "Lv")} ${s.level || 1}`)),
      h("div", { class: "bar hp" }, h("i", { class: "lag", style: { width: `calc(${pct}% - 4px)` } }), h("i", { style: { width: `calc(${pct}% - 4px)` } }), h("b", { class: "out" }, `${s.hp ?? 0} / ${s.max_hp ?? 0}`)),
      h("div", { class: "bar xp" }, h("i", { style: { width: `calc(${xp}% - 4px)` } })),
      resBar(s),
      h("div", { class: "res out" },
        h("span", { title: T("口粮", "Rations") }, icon("ration"), s.rations, h("em", {}, `/${cr}`)), h("span", { title: T("药水", "Potions") }, icon("potion"), s.potions, h("em", {}, `/${cp}`)),
        h("span", { title: T("金币", "Gold") }, icon("coin"), s.gold), h("span", { title: T("铁料", "Iron") }, icon("iron"), s.iron), h("span", { title: T("魔晶", "Essence") }, icon("essence"), s.essence),
        h("span", { title: T("护甲等级", "Armor Class") }, icon("shield"), s.ac),
        h("span", { class: "fat" + ((s.fatigue || 0) >= 9 ? " bad" : (s.fatigue || 0) >= 6 ? " warn" : ""), title: T("疲劳：每里 +1，扎营清零。6 起 d20 -1，9 起 -2，12 起 -3 并掉血", "Fatigue: +1 per mile, camp to clear. d20 -1 at 6, -2 at 9, -3 and HP loss at 12") }, icon("hourglass"), s.fatigue || 0))));
}
const RES_COLOR = { rage: "#ff6a3a", combo: "#ffd84a", mana: "#5ab4ff", faith: "#fff2a8" };
const RK = { common: "#c8c0a8", rare: "#5ab4ff", legendary: "#ffb03a" };
function itemBar(s) {
  const list = s.items_ui || []; if (!list.length) return null;
  return h("div", { class: "itembar" }, list.map((it) => h("button", { class: "slot2 " + it.kind + (it.usable ? " use" : ""), style: { borderColor: RK[it.rk] || "#c8c0a8" }, disabled: it.kind === "consumable" && (!it.usable || busy()),
    onclick: () => { if (it.kind === "consumable" && it.usable) run("use_item", { id: String(it.uid) }); else { sheet = "relic"; render(); } } },
    icon(it.kind === "consumable" ? "potion" : it.kind === "insight" ? "scroll" : "gem"),
    h("span", { class: "tip" }, h("b", { style: { color: RK[it.rk] } }, `✦ ${it.name}`), h("small", {}, `${it.rarity} · ${{ trinket: T("饰品", "Trinket"), consumable: T("消耗品（点击使用）", "Consumable (click to use)"), insight: T("旅途感悟", "Insight") }[it.kind]}`),
      h("span", {}, it.eff), it.curse ? h("span", { class: "cur" }, it.curse) : null, it.desc ? h("i", {}, it.desc) : null))));
}
function resBar(s) {
  const r = s.res; if (!r || !r.k) return null;
  const name = { rage: T("怒气", "Rage"), combo: T("连击", "Combo"), mana: T("法力", "Mana"), faith: T("信仰", "Faith") }[r.k];
  return h("div", { class: "rbar out", title: { rage: T("命中 +1、挨打 +1、防御 +1，每场战斗清零", "+1 on hit, when hit or on Defend; resets each fight"), combo: T("命中 +1（暴击 +2），每场战斗清零", "+1 on hit (+2 on crit); resets each fight"), mana: T("不会自己恢复——只有扎营能补满", "Doesn't regenerate — only camping refills it"), faith: T("战斗中每回合 +1，每场至少 2", "+1 every combat turn, at least 2 per fight") }[r.k] },
    h("span", {}, name), h("span", { class: "pips" }, Array.from({ length: r.max }, (_, i) => h("i", { class: i < r.cur ? "on" : "", style: i < r.cur ? { background: RES_COLOR[r.k] } : null }))), h("em", {}, `${r.cur}/${r.max}`));
}
function banner(s) {
  return h("div", { class: "banner" },
    h("div", { class: "region serif out" }, T(...(BIOME[s.biome] || BIOME.plains))),
    h("div", { class: "mile out" }, icon("flag"), T(`第 ${s.distance || 0} 里`, `Mile ${s.distance || 0}`), h("span", { class: "path " + (s.path || "road") }, { road: T("大路", "Highway"), wilds: T("荒野", "Wilds"), shortcut: T("捷径", "Shortcut") }[s.path || "road"]), s.phase === "none" ? h("span", { class: "ready" + (s.next_ready ? "" : " wait") }, s.next_ready ? T("· 前方已备好", "· ready") : T("· AI 准备中…", "· AI preparing…")) : null),
    s.thread ? h("div", { class: "thread out", title: T("旅途主线：AI 一路写下、一路推进的故事线", "The journey's thread: a storyline the AI keeps weaving as you go") }, h("b", {}, "✦ "), s.thread) : null);
}
const tags = (list) => h("div", { class: "tags" }, (list || []).map((t) => h("span", { class: `tag ${t.k}` }, t.t)));
function card(s) {
  if (s.phase === "battle" && s.ui_battle && s.ui_battle.foe) {
    const B = s.ui_battle, f = B.foe, pct = Math.max(0, (100 * f.hp) / f.max), it = f.intent || {};
    return h("div", { class: "paper card battle", key: "battle" }, h("span", { class: "kind" }, icon(f.boss ? "skull" : "sword"), f.boss ? T("守关者", "Warden") : T("战斗", "Battle")),
      h("h2", { class: "serif" }, f.name, f.trait ? h("span", { class: "trait", title: f.trait_desc }, f.trait) : null),
      f.trait_desc ? h("div", { class: "tdesc" }, f.trait_desc) : null,
      h("div", { class: "bar hp foehp" }, h("i", { style: { width: `calc(${pct}% - 4px)` } }), h("b", { class: "out" }, `${f.hp} / ${f.max}`)),
      h("div", { class: "foemeta" }, h("span", {}, icon("shield"), `AC ${f.ac}`), f.block ? h("span", { class: "chip2 def" }, T(`格挡 ${f.block}`, `Block ${f.block}`)) : null,
        f.poison ? h("span", { class: "chip2 poi" }, T(`中毒 ${f.poison}`, `Poison ${f.poison}`)) : null, f.stun ? h("span", { class: "chip2 stun" }, T("眩晕", "Stunned")) : null),
      h("div", { class: `intent ${it.k || "atk"}` }, h("small", {}, T("它的下一步", "Its next move")), h("div", {}, icon(it.icon || "sword", true), h("b", {}, it.text || ""))),
      h("div", { class: "mine" }, B.block ? h("span", { class: "chip2 def" }, icon("shield"), T(`你的格挡 ${B.block}`, `Your block ${B.block}`)) : null, B.evade ? h("span", { class: "chip2 def" }, icon("boot"), T("准备闪避", "Evading")) : null),
      h("div", { class: "hint" }, T("根据它的下一步决定：趁它防御时蓄资源，它蓄力时防御或打断。", "Read its next move: build resources while it guards, block or interrupt when it charges.")));
  }
  const ui = s.ui_card || { mode: "none" };
  if (ui.mode === "none") return null;
  return h("div", { class: "paper card" + (ui.mode === "shop" ? " shop" : "") },
    h("span", { class: "kind" }, ui.kind || ""), ui.ai ? h("span", { class: "aimark", title: T("这张卡（描述、选项、结果旁白）由 AI 现场写成", "This card — scene, options and outcome narration — was written live by the AI") }, T("✦ AI 写成", "✦ AI-written")) : null,
    h("h2", { class: "serif" }, ui.title || ""),
    h("p", { class: "text" + (ui.mode === "loading" ? " loading" : "") }, ui.text || ""),
    h("div", { class: "opts" }, (ui.items || []).map((it, i) => h("button", { class: "btn pape opt", disabled: !!it.disabled || busy(), onclick: () => run(ui.action, { id: it.id }) },
      icon(it.icon || "dice", true), h("span", { class: "label" }, ui.mode === "card" && i < 9 ? `${i + 1}. ${it.text}` : it.text), it.tags && it.tags.length ? tags(it.tags) : h("span", { class: "sub" }, it.sub || "")))));
}
function actions(s) {
  const ph = s.phase || "none", dead = s.hp <= 0, b = busy();
  const A = (id, ic, label, key, ok, gold) => h("button", { class: `btn act${gold ? " gold" : ""}`, disabled: !ok || dead || b, onclick: () => run(id) }, h("span", {}, icon(ic), " ", label), h("span", { class: "key" }, key));
  if (ph === "battle" && s.ui_battle && s.ui_battle.skills) {
    const B = s.ui_battle;
    return h("div", { class: "actions battle" },
      A("attack", "sword", T("攻击", "Attack"), T("空格", "Space"), true, true),
      h("button", { class: "btn act", disabled: dead || b, onclick: () => run("defend"), title: T("格挡伤害，持续到你下次行动", "Absorb damage until your next action") }, h("span", {}, icon("shield"), " ", T("防御", "Defend")), h("span", { class: "key" }, `D · ${T("格挡", "block")} ${B.defend}`)),
      B.skills.map((k, i) => h("button", { class: "btn act skill", disabled: k.disabled || dead || b, onclick: () => run("skill", { id: k.id }), title: k.sub },
        h("span", {}, icon(k.icon), " ", k.text), h("span", { class: "key" }, h("b", { class: "cost " + ((s.res || {}).k || "") }, k.cost), ` · ${i + 1}`))),
      A("potion", "potion", T("药水", "Potion"), "Q", s.potions > 0 && s.hp < s.max_hp),
      h("button", { class: "btn act", disabled: dead || b, onclick: () => run("flee"), title: T(`敏捷 DC ${B.flee_dc}；失败会挨打`, `DEX DC ${B.flee_dc}; fail and it attacks`) }, h("span", {}, icon("boot"), " ", T("逃跑", "Flee")), h("span", { class: "key" }, `F · DC ${B.flee_dc}`)));
  }
  return h("div", { class: "actions" },
    A("walk", "flag", T("继续前进", "Walk on"), T("空格", "Space"), ph === "none", true),
    A("potion", "potion", T("药水", "Potion"), "Q", s.potions > 0 && s.hp < s.max_hp),
    A("camp", "fire", T("扎营", "Camp"), T(`C · 疲劳 ${s.fatigue || 0}→0`, `C · fatigue ${s.fatigue || 0}→0`), ph === "none" && !s.camped && s.rations > 0));
}
function journal(s) {
  const lines = (s.journal || []).slice(journalOpen ? -60 : -7);
  return h("div", { class: "journal" + (journalOpen ? " open" : ""), title: T("点击展开 / 收起日志", "Click to expand / collapse"), onclick: () => { journalOpen = !journalOpen; render(); } }, lines.map((l) => h("div", { class: "out" + (l.startsWith("✦") ? " ai" : "") }, l)));
}
function menu(s) {
  return h("div", { class: "menu" }, [["char", "person", T("角色", "Hero")], ["pack", "pack", T("行囊", "Pack")], ["relic", "gem", T("道具", "Items")], ["trip", "map", T("造物", "Codex")], ["log", "scroll", T("日志", "Log")]].map(([id, ic, label]) =>
    h("button", { class: "btn", onclick: () => { if (id === "log") journalOpen = !journalOpen; else sheet = id; render(); } }, icon(ic), label)));
}
// 详情弹窗
const ABIL = [["str", "力量", "STR"], ["dex", "敏捷", "DEX"], ["con", "体质", "CON"], ["int", "智力", "INT"], ["wis", "感知", "WIS"], ["cha", "魅力", "CHA"]];
const GEAR = [["weapon", "sword", "武器", "Weapon", 5], ["armor", "shield", "护甲", "Armor", 5], ["pack", "pack", "背包", "Pack", 3], ["kit", "fire", "营具", "Camp kit", 3]];
const STATUS = { blessed: ["祝福", "Blessed"], cursed: ["诅咒", "Cursed"], poisoned: ["中毒", "Poisoned"], exhausted: ["疲惫", "Exhausted"], scouted: ["侦察", "Scouted"] };
function sheetBody(s, id) {
  if (id === "char") {
    const a = s.abil || {}, info = (s.class_info || []).find((c) => c.id === s.hero_class) || {};
    return [h("div", { style: { display: "flex", gap: "14px", alignItems: "center" } }, h("div", { class: "wood face" }, h("div", { class: "spr", style: { backgroundImage: `url(${heroUrl(s.hero_class)})` } })),
        h("div", { style: { flex: 1 } }, h("h3", { class: "serif" }, `${s.class_name || ""} · ${T("等级", "Lv")} ${s.level}`), h("div", {}, `${T("生命", "HP")} ${s.hp}/${s.max_hp} · ${T("护甲等级", "AC")} ${s.ac}`),
          h("div", { class: "bar xp", style: { marginTop: "8px" } }, h("i", { style: { width: `calc(${Math.min(100, (100 * (s.xp || 0)) / (s.xp_next || 1))}% - 4px)` } })), h("small", { style: { color: "#c5b392" } }, `${T("经验", "XP")} ${s.xp} / ${s.xp_next}`))),
      h("div", { class: "grid6" }, ABIL.map(([k, zh, en]) => { const v = a[k] || 10, m = Math.floor((v - 10) / 2); return h("div", { class: "cell" }, h("small", {}, T(zh, en)), h("b", {}, v), h("em", {}, m >= 0 ? `+${m}` : m)); })),
      h("div", { style: { color: "#e2d2b0" } }, info.desc || ""),
      h("h3", { class: "serif", style: { marginTop: "14px" } }, T("天赋", "Talents")),
      h("div", { style: { color: "#e2d2b0", whiteSpace: "pre-line" } }, s.perk_text || "")];
  }
  if (id === "pack") {
    const g = s.gear || {}, cr = 8 + 4 * (g.pack || 0), cp = 3 + (g.pack || 0);
    return [h("h3", { class: "serif" }, T("行囊", "Pack")),
      ...[["ration", T("口粮", "Rations"), `${s.rations} / ${cr}`], ["potion", T("治疗药水", "Healing potions"), `${s.potions} / ${cp}`], ["coin", T("金币", "Gold"), s.gold], ["iron", T("铁料", "Iron"), s.iron], ["essence", T("魔晶", "Essence"), s.essence]].map(([ic, n, v]) => h("div", { class: "row" }, icon(ic), h("span", { class: "grow" }, n), h("b", {}, v))),
      h("h3", { class: "serif", style: { marginTop: "14px" } }, T("强化", "Upgrades")),
      ...GEAR.map(([k, ic, zh, en, max]) => h("div", { class: "row" }, icon(ic), h("span", { class: "grow" }, T(zh, en)), h("span", { class: "pips" }, Array.from({ length: max }, (_, i) => h("i", { class: i < (g[k] || 0) ? "on" : "" }))))),
      h("p", { style: { color: "#c5b392", fontSize: "13px" } }, T("在路上遇到的行商那里强化（金币 + 铁料，高级还要魔晶）。", "Upgrade at peddlers on the road (gold + iron; essence at higher levels)."))];
  }
  if (id === "relic") {
    const its = s.items_ui || [];
    const blk = (kind, title, max) => { const l = its.filter((x) => x.kind === kind); return [h("h3", { class: "serif", style: { marginTop: "10px" } }, title),
      ...l.map((it) => h("div", { class: "slot", style: { boxShadow: `inset 0 0 0 2px ${RK[it.rk]}` } }, icon(kind === "consumable" ? "potion" : kind === "insight" ? "scroll" : "gem", true),
        h("div", {}, h("b", { style: { color: RK[it.rk] } }, `✦ ${it.name}`), h("small", {}, `${it.rarity} · ${it.eff}`), it.curse ? h("small", { style: { color: "#ff9a7a" } }, it.curse) : null, it.desc ? h("small", { style: { fontStyle: "italic" } }, it.desc) : null))),
      max && l.length < max ? h("div", { class: "slot empty" }, icon("gem", true), h("span", {}, T(`空位 ${max - l.length}`, `${max - l.length} empty`))) : null]; };
    const lines = String(s.relic_text || "").split("\n").filter((l) => /[:：]/.test(l)), st = s.status || {}, on = Object.keys(st).filter((k) => st[k] > 0);
    return [...blk("trinket", T("饰品（最多 4 件）", "Trinkets (up to 4)"), 4), ...blk("consumable", T("消耗品（最多 4 件）", "Consumables (up to 4)"), 4), ...(its.some((x) => x.kind === "insight") ? blk("insight", T("旅途感悟", "Insights"), 0) : []),
      h("h3", { class: "serif", style: { marginTop: "10px" } }, T("遗物（最多 3 件）", "Relics (up to 3)")),
      ...[0, 1, 2].map((i) => { const l = lines[i]; if (!l) return h("div", { class: "slot empty" }, icon("gem", true), h("span", {}, T("空位", "Empty slot"))); const [n, ...d] = l.split(/[:：]/); return h("div", { class: "slot" }, icon("gem", true), h("div", {}, h("b", {}, n.trim()), h("small", {}, d.join(":").trim()))); }),
      h("h3", { class: "serif", style: { marginTop: "14px" } }, T("状态", "Status")),
      h("div", {}, on.length ? on.map((k) => h("span", { class: "chip" }, `${T(STATUS[k][0], STATUS[k][1])}${k === "exhausted" ? "" : ` · ${st[k]}${T(" 里", " mi")}`}`)) : h("span", { style: { color: "#9c8c70" } }, T("（无）", "(none)")))];
  }
  return [h("h3", { class: "serif" }, T("旅程", "Journey")),
    ...[["flag", T("已走里程", "Miles walked"), s.distance], ["star", T("最远纪录", "Best record"), s.best], ["skull", T("击败敌人", "Foes defeated"), s.kills]].map(([ic, n, v]) => h("div", { class: "row" }, icon(ic), h("span", { class: "grow" }, n), h("b", {}, v))),
    s.quest && s.quest.due ? h("div", { class: "row" }, icon("scroll"), h("span", { class: "grow" }, T(`委托「${s.quest.title}」`, `Errand "${s.quest.title}"`)), h("b", {}, T(`第 ${s.quest.due} 里`, `mile ${s.quest.due}`))) : null,
    h("p", { style: { color: "#c5b392", fontSize: "13px" } }, T("每 10 里换一个地区，每 25 里有一个守关者。", "The region changes every 10 miles; a warden waits every 25 miles.")),
    h("h3", { class: "serif", style: { marginTop: "14px" } }, T(`✦ 本局 AI 造物（${(s.made || []).length}）· 图鉴共 ${s.codex_n || 0} 种`, `✦ AI creations this run (${(s.made || []).length}) · ${s.codex_n || 0} in your codex`)),
    s.thread ? h("p", { style: { fontStyle: "italic", color: "#f0dcb0" } }, `✦ ${s.thread}`) : null,
    ...(s.made || []).slice().reverse().map((m) => h("div", { class: "row" }, icon(m.t === "foe" ? "skull" : m.t === "insight" ? "scroll" : "gem"), h("div", { class: "grow" }, h("b", {}, m.n), h("div", { style: { fontSize: "12.5px", color: "#d0bc96" } }, m.e), m.d ? h("div", { style: { fontSize: "12.5px", color: "#a89878", fontStyle: "italic" } }, m.d) : null))),
    (s.made || []).length ? null : h("p", { style: { color: "#9c8c70" } }, T("（AI 发明的道具、怪物和感悟会出现在这里）", "(Items, monsters and insights the AI invents will appear here)"))];
}
function modal(s) {
  if (!sheet) return null;
  const tabs = [["char", "person", T("角色", "Hero")], ["pack", "pack", T("行囊", "Pack")], ["relic", "gem", T("道具", "Items")], ["trip", "map", T("造物", "Codex")]];
  return h("div", { class: "modal", onclick: (e) => { if (e.target === e.currentTarget) { sheet = null; render(); } } },
    h("div", { class: "wood sheet" }, h("div", { class: "tabs" }, tabs.map(([id, ic, label]) => h("button", { class: "btn tab" + (id === sheet ? " on" : ""), onclick: () => { sheet = id; render(); } }, icon(ic), label))),
      ...sheetBody(s, sheet), h("div", { class: "close" }, h("button", { class: "btn gold act", onclick: () => { sheet = null; render(); } }, T("关闭", "Close")))));
}
function title(s) {
  return h("div", { class: "title" },
    h("div", { class: "logo" }, h("div", { class: "zh serif" }, T("无尽之路", "THE ENDLESS ROAD")), h("div", { class: "en" }, T("THE ENDLESS ROAD", "无尽之路")), h("div", { class: "sub out" }, T("属性已经掷好——选择你的职业，踏上没有尽头的路。", "Your scores are rolled — choose a class and set out on the road with no end."))),
    h("div", { class: "classes" }, (s.class_info || []).map((c) => h("button", { class: "btn pape cls", disabled: busy(), onclick: () => run("pick_class", { id: c.id }) },
      h("div", { class: "spr", style: { backgroundImage: `url(${heroUrl(c.id)})` } }), h("span", { class: "cname serif" }, c.name), h("span", { class: "cstat" }, `${T("生命", "HP")} ${c.hp} · AC ${c.ac}`), h("span", { class: "cdesc" }, c.desc)))));
}
function ending(s) {
  return h("div", { class: "ending" }, h("div", { class: "wood" }, h("h1", { class: "serif out" }, T("倒在路上", "Fallen on the road")),
    h("div", {}, T(`${s.class_name} · 走了 ${s.distance} 里 · ${s.level} 级 · 击败 ${s.kills} 个敌人`, `${s.class_name} · ${s.distance} miles · level ${s.level} · ${s.kills} foes defeated`)),
    s.epitaph ? h("p", { class: "ep serif" }, s.epitaph) : null, h("p", { style: { color: "#c5b392", fontSize: "13px" } }, T(`最远纪录：${s.best} 里`, `Best record: ${s.best} miles`))));
}
let lastCardKey = "", toastSeen = null, toastUntil = 0;
function toastEl(s) {
  const t = s.toast || {}; if (!t.n) return null;
  if (toastSeen === null) { toastSeen = t.n; return null; }   // 读档时不弹旧提示
  if (t.n !== toastSeen) { toastSeen = t.n; toastUntil = Date.now() + 4200; setTimeout(render, 4300); }
  if (Date.now() > toastUntil) return null;
  return h("div", { class: "toast wood", style: { borderColor: RK[t.rk] } }, h("small", {}, T("✦ AI 发明的新道具", "✦ A new item, invented by the AI"), " · ", h("b", { style: { color: RK[t.rk] } }, t.rarity)),
    h("h3", { class: "serif" }, t.title), h("div", { class: "eff" }, t.eff), t.curse ? h("div", { class: "cur" }, t.curse) : null, t.desc ? h("p", {}, t.desc) : null);
}
function render() {
  const s = S;
  const ui = $("ui");
  const cardKey = s.phase === "battle" ? "battle" : JSON.stringify([(s.ui_card || {}).mode, (s.ui_card || {}).title]);
  const kids = [hud(s), banner(s), journal(s), actions(s), menu(s), h("div", { class: "msg out" }, msg)];
  const ib = itemBar(s); if (ib) kids.push(ib);
  const t = toastEl(s); if (t) kids.push(t);
  const c = card(s); if (c) { if (cardKey === lastCardKey) c.style.animation = "none"; kids.push(c); }
  lastCardKey = cardKey;
  if (s.phase === "class") kids.push(title(s));
  if (s.hp <= 0 && s.phase !== "class") kids.push(ending(s));
  const m = modal(s); if (m) kids.push(m);
  ui.replaceChildren(...kids);
  popups();
}
// 键盘：空格主操作，1–9 选项，Q 药水，C 扎营，F 逃跑，Esc 关闭弹窗
addEventListener("keydown", (e) => {
  if (e.repeat) return; const s = S;
  if (e.key === "Escape") { if (sheet) { sheet = null; render(); } return; }
  if (sheet || s.phase === "class") return;
  if (e.code === "Space") { e.preventDefault(); if (s.phase === "battle") run("attack"); else if (s.phase === "none") run("walk"); }
  else if (s.phase === "battle" && /^[1-3]$/.test(e.key)) { const k = ((s.ui_battle || {}).skills || [])[Number(e.key) - 1]; if (k && !k.disabled) run("skill", { id: k.id }); }
  else if (s.phase === "battle" && (e.key === "d" || e.key === "D")) run("defend");
  else if (/^[1-9]$/.test(e.key)) { const ui = s.ui_card || {}; const it = (ui.items || [])[Number(e.key) - 1]; if (it && !it.disabled) run(ui.action, { id: it.id }); }
  else if (e.key === "q" || e.key === "Q") run("potion");
  else if (e.key === "c" || e.key === "C") run("camp");
  else if (e.key === "f" || e.key === "F") run("flee");
});
function fit() { const sc = S.screen || {}; if (sc.h > 100) oasis.resize(Math.max(320, Math.min(2000, sc.h - 22))); }
oasis.ready.then((o) => { S = o.state || {}; fit(); resize(); render(); requestAnimationFrame(frame); });
let lastH = 0;
oasis.onState((s, ch) => { S = s; if ((s.screen || {}).h !== lastH) { lastH = (s.screen || {}).h; fit(); setTimeout(resize, 50); }
  // 只有动画状态变了时不重建界面（20 次/秒），只处理飘字
  if (ch && ch.length === 1 && ch[0] === "scene_fx") { popups(); return; }
  render(); });
})();
