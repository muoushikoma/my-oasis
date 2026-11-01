// 雪线 · 画面（draw.js）：黑白手绘风。地面与物件用图块地图，家具/角色用精灵图，HUD 用线条手绘。
// 只读状态，不改任何东西。

const T = 64, Z = 0.75;
const INK = "#1b1b1b", PAPER = "#f3efe4", PAPER2 = "#e4ddcc", DIM = "rgba(27,27,27,0.55)";
const FPOS = { bed: [0, 0], bunk: [1, 0], bedroll: [2, 0], stove: [3, 0], fireplace: [4, 0], barrel_stove: [6, 0], cabinet: [7, 0], kitchen_counter: [8, 0], drawer: [10, 0],
  wardrobe: [0, 2], table: [2, 2], table_small: [4, 2], chair: [5, 2], armchair: [6, 2], bookshelf: [7, 2], desk: [9, 2], workbench: [0, 3], crate: [2, 3], locker: [3, 3], safe: [4, 3],
  fridge: [5, 3], sink: [6, 3], toilet: [7, 3], bathtub: [8, 3], first_aid: [9, 3], barrel: [10, 3], woodpile: [11, 3], pew: [0, 5], altar: [3, 5], radio_desk: [5, 5], control_panel: [7, 5],
  rug: [0, 7], corpse: [2, 7], debris: [3, 7], bucket: [4, 7] };
const OUTDOOR_CONT = { crate: [2, 3], corpse: [2, 7] };
const WXNAME = { clear: "晴", overcast: "阴", cloudy: "多云", snow: "小雪", heavy_snow: "大雪", blizzard: "暴风雪", fog: "雾", frigid: "极寒晴夜" };
const OPEN_FRONT = { 16: 52, 17: 53, 18: 52, 19: 49, 20: 50, 21: 50 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 暗度 1–8 级（8 级接近全黑，什么都看不清）
const DARKC = { 1: "rgba(14,16,26,0.11)", 2: "rgba(14,16,26,0.22)", 3: "rgba(14,16,26,0.33)", 4: "rgba(14,16,26,0.45)", 5: "rgba(14,16,26,0.57)", 6: "rgba(14,16,26,0.69)", 7: "rgba(14,16,26,0.81)", 8: "rgba(14,16,26,0.93)" };
function ambientOf(g) {
  const h = (g.clock % 1440) / 60, n = h < 5 ? 1 : h < 7.5 ? (7.5 - h) / 2.5 : h < 17.5 ? 0 : h < 20 ? (h - 17.5) / 2.5 : 1;
  const moon = { clear: 0.32, frigid: 0.32, cloudy: 0.14, overcast: 0.1 }[(g.wxNow || {}).type] || 0.05;
  return g.inside ? 1 - n * (1 - moon * 0.4) : 1 - n * (1 - moon);
}
const hhmm = (m) => { const h = Math.floor((m % 1440) / 60), mm = Math.floor(m % 60); return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm; };

function wrap(s, n) { const out = []; let line = ""; for (const ch of String(s || "")) { if (ch === "\n") { out.push(line); line = ""; continue; } line += ch; if (line.length >= n) { out.push(line); line = ""; } } if (line) out.push(line); return out; }
function panel(d, x, y, w, h, dark) {
  d.rect(x + 3, y + 4, w, h, "rgba(0,0,0,0.12)");
  d.rect(x, y, w, h, dark ? INK : PAPER);
  d.line(x - 2, y + 1, x + w + 2, y - 1, INK, 2.2); d.line(x + w + 1, y - 2, x + w - 1, y + h + 2, INK, 2.2);
  d.line(x + w + 2, y + h, x - 2, y + h + 1, INK, 2.2); d.line(x, y + h + 2, x + 1, y - 2, INK, 2.2);
}
function bar(d, x, y, w, h, v, solid) {
  v = clamp(v, 0, 1);
  d.rect(x, y, w, h, PAPER);
  if (solid) d.rect(x + 2, y + 2, (w - 4) * v, h - 4, INK);
  else { const fw = (w - 4) * v; for (let i = 0; i < fw; i += 5) d.line(x + 2 + i, y + h - 2, x + 2 + Math.min(fw, i + h - 4), y + 2 + Math.max(0, i + h - 4 - fw), INK, 1.3); }
  d.line(x, y, x + w, y + 1, INK, 1.6); d.line(x + w, y, x + w - 1, y + h, INK, 1.6); d.line(x + w, y + h, x, y + h - 1, INK, 1.6); d.line(x, y + h, x + 1, y, INK, 1.6);
}

export function draw(api) {
  const d = api.draw, { width: W, height: H } = api.params;
  const g = api.state.get("g") || {};
  const t = api.time;
  d.clear(PAPER);
  if (g.ph !== "play") return waitScreen(d, g, W, H, t);
  const here = api.state.get("here"), lvl = api.state.get("lvl");
  if (!here || !here.g || !lvl || !lvl.bld) return waitScreen(d, g, W, H, t);

  // ── 世界 ──
  const vw = W / Z, vh = H / Z;
  const cx = clamp(g.pc.x - vw / 2, 0, here.w * T - vw), cy = clamp(g.pc.y - vh / 2, 0, here.h * T - vh);
  d.camera(cx, cy, Z);
  const x0 = Math.max(0, Math.floor(cx / T) - 1), y0 = Math.max(0, Math.floor(cy / T) - 1);
  const x1 = Math.min(here.w, Math.ceil((cx + vw) / T) + 1), y1 = Math.min(here.h, Math.ceil((cy + vh) / T) + 1);
  const slice = (L) => L.slice(y0, y1).map((r) => r.slice(x0, x1));
  d.tilemap({ tileset: "ground", tile_size: T, columns: 8, map: slice(here.g), x: x0 * T, y: y0 * T });
  d.tilemap({ tileset: "objects", tile_size: T, columns: 8, map: slice(here.o), x: x0 * T, y: y0 * T });
  const vis = (x, y, w, h) => x + w >= x0 && x <= x1 && y + h >= y0 && y <= y1;
  // 家具、火堆
  for (const i of lvl.ix) {
    if (!vis(i.x, i.y, i.w, i.h)) continue;
    const fp = FPOS[i.t] || (i.f && OUTDOOR_CONT[i.t]);
    if (fp) d.image("furniture", i.x * T, i.y * T, i.w * T, i.h * T, { sx: fp[0] * T, sy: fp[1] * T, sw: i.w * T, sh: i.h * T });
    const lit = i.k === "heat" && g.fire && g.fire[g.rid + ":" + i.x + "," + i.y];
    if (i.t === "campfire") d.image("objects", i.x * T, i.y * T, T, T, { sx: (lit ? 1 : 2) * T, sy: 5 * T, sw: T, sh: T });
    if (lit) {
      const fx = (i.x + i.w / 2) * T, fy = (i.y + i.h / 2) * T, f = 0.5 + 0.5 * Math.sin(t / 180 + i.x);
      d.circle(fx, fy, 70 + f * 8, "rgba(255,190,110,0.10)"); d.circle(fx, fy, 130 + f * 10, "rgba(255,190,110,0.06)");
      for (let k = 0; k < 3; k++) d.circle(fx, fy, 90 + k * 46, INK, { stroke: true, width: 0.8, alpha: 0.25 });
    }
  }
  // 地面物品
  for (const it of lvl.gi) if (vis(it.x, it.y, 1, 1)) d.image("objects", it.x * T, it.y * T, T, T, { sx: (String(it.id).startsWith("i_note") ? 5 : 4) * T, sy: 7 * T, sw: T, sh: T });
  // 动物
  // 痕迹（AI 写的，可查看）
  for (const i of lvl.ix) if (i.k === "mark" && vis(i.x, i.y, 1, 1)) {
    const mx = (i.x + 0.5) * T, my = (i.y + 0.5) * T, pulse = i.seen ? 0 : 0.5 + 0.5 * Math.sin(t / 300 + i.x);
    d.circle(mx, my, 14 + pulse * 4, INK, { stroke: true, width: 1.4, alpha: i.seen ? 0.35 : 0.8 });
    d.text("…", mx, my - 14, { size: 22, color: INK, align: "center", alpha: i.seen ? 0.4 : 0.9 });
  }
  for (const e of g.ents || []) {
    const fr = e.mv ? Math.floor(t / 140) % 4 : 0;
    if (e.k === "npc") {
      d.image("npc", e.x - 32, e.y - 44, T, T, { sx: (e.mv ? fr : 0) * T, sy: (e.dir || 0) * T, sw: T, sh: T });
      const tag = e.name + (e.doing ? " · " + e.doing : ""), tw = tag.length * 15 + 16;
      d.rect(e.x - tw / 2, e.y - 70, tw, 20, PAPER, { alpha: 0.85 }); d.text(tag, e.x, e.y - 68, { size: 15, color: INK, align: "center" });
      if (e.say && t - (e.sayT || 0) < 8000) { const sw = e.say.length * 16 + 20; panel(d, e.x - sw / 2, e.y - 112, sw, 30); d.text(e.say, e.x, e.y - 105, { size: 15, color: INK, align: "center" }); }
      continue;
    }
    if (e.k === "wolf") d.image("animals", e.x - 48, e.y - 56, 96, 96, { sx: fr * 96, sy: (e.dir > 0 ? 0 : 1) * 96, sw: 96, sh: 96 });
    else if (e.k === "deer") d.image("animals", e.x - 48, e.y - 60, 96, 96, { sx: fr * 96, sy: 192, sw: 96, sh: 96, flip_x: e.dir < 0 });
    else d.image("animals", e.x - 30, e.y - 40, 60, 60, { sx: 0, sy: 288, sw: 96, sh: 96, flip_x: e.dir < 0 });
  }
  // 玩家
  const pc = g.pc, busy = g.busy;
  if (busy && busy.act === "sleep") d.image("player", pc.x - 32, pc.y - 40, T, T, { sx: T, sy: 4 * T, sw: T, sh: T });
  else if (busy && (busy.act === "search" || busy.act === "carcass" || busy.act === "wood")) d.image("player", pc.x - 32, pc.y - 40, T, T, { sx: 2 * T, sy: 4 * T, sw: T, sh: T });
  else if (busy && busy.act === "sit") d.image("player", pc.x - 32, pc.y - 40, T, T, { sx: 0, sy: 4 * T, sw: T, sh: T });
  else d.image("player", pc.x - 32, pc.y - 44, T, T, { sx: (pc.mv ? Math.floor(pc.fr) : 0) * T, sy: pc.dir * T, sw: T, sh: T });
  if (g.flareT && t - g.flareT < 4000) { const a = 1 - (t - g.flareT) / 4000; d.circle(pc.x, pc.y, 220, "rgba(220,40,30," + 0.18 * a + ")"); d.circle(pc.x + 18, pc.y - 30, 7, "rgba(230,40,30," + a + ")"); }
  // 屋顶（玩家在屋里时揭开那一栋）
  for (const b of lvl.bld) {
    if (!vis(b.x, b.y, b.w, b.h)) continue;
    if (g.inside === b.id) { d.rect(b.x * T - 4, b.y * T - 4, b.w * T + 8, b.h * T + 8, INK, { stroke: true, width: 3 }); continue; }
    const style = { plank: 0, metal: 1, shingle: 2 }[b.roof] || 0;
    const rows = [];
    for (let y = 0; y < b.h - 1; y++) { const r = []; const vr = y === 0 ? 0 : y === b.h - 2 ? 2 : 1; for (let x = 0; x < b.w; x++) { const vc = x === 0 ? 0 : x === b.w - 1 ? 2 : 1; r.push(vr * 9 + style * 3 + vc); } rows.push(r); }
    d.tilemap({ tileset: "roofs", tile_size: T, columns: 9, map: rows, x: b.x * T, y: b.y * T });
    d.line(b.x * T + T * 0.6, b.y * T + ((b.h - 1) * T) / 2, (b.x + b.w) * T - T * 0.6, b.y * T + ((b.h - 1) * T) / 2, INK, 3);
    const front = [];
    for (let x = 0; x < b.w; x++) {
      const o = b.ready ? here.o[b.y + b.h - 1][b.x + x] : -1;
      front.push(x === 0 ? 54 : x === b.w - 1 ? 55 : x === b.door ? (b.ready ? 53 : 52) : OPEN_FRONT[o] || 48);
    }
    d.tilemap({ tileset: "objects", tile_size: T, columns: 8, map: [front], x: b.x * T, y: (b.y + b.h - 1) * T });
    for (const [hx, hy] of b.heat || []) {
      d.image("objects", (b.x + hx) * T, (b.y + Math.min(hy, b.h - 2)) * T - 20, T, T, { sx: 1 * T, sy: 7 * T, sw: T, sh: T });
      const lit = Object.values(g.fire || {}).some((f) => f.bid === b.id);
      if (lit) for (let k = 0; k < 3; k++) { const s = ((t / 1600 + k / 3) % 1); d.circle((b.x + hx) * T + 32 + Math.sin(s * 6 + k) * 10, (b.y + Math.min(hy, b.h - 2)) * T - 10 - s * 90, 10 + s * 18, "rgba(243,239,228," + (0.85 - s * 0.8) + ")", { }); }
    }
    if (Math.hypot(pc.x - (b.x + b.w / 2) * T, pc.y - (b.y + b.h) * T) < 7 * T) {
      d.rect((b.x + b.w / 2) * T - 90, (b.y + b.h) * T + 10, 180, 30, PAPER, { alpha: 0.9 });
      d.text(b.name + (b.ready ? "" : " ·未进入"), (b.x + b.w / 2) * T, (b.y + b.h) * T + 15, { size: 18, color: INK, align: "center" });
    }
  }

  // ── 天气、昼夜（屏幕坐标） ──
  d.camera(0, 0, 1);
  const hour = (g.clock % 1440) / 60;
  const wx = g.wxNow || {};
  if (!g.inside) {
    if (wx.type === "fog") d.rect(0, 0, W, H, "rgba(243,239,228,0.45)");
    if (wx.type === "blizzard" || wx.type === "heavy_snow" || wx.type === "snow") {
      const n = wx.type === "blizzard" ? 140 : wx.type === "heavy_snow" ? 80 : 40, k = wx.type === "blizzard" ? 3 : 1;
      if (wx.type === "blizzard") d.rect(0, 0, W, H, "rgba(243,239,228,0.38)");
      for (let i = 0; i < n; i++) { const sx = ((i * 97.13 + t * (0.18 + (i % 5) * 0.03) * k) % (W + 40)) - 20, sy = ((i * 53.7 + t * (0.09 + (i % 3) * 0.02)) % (H + 40)) - 20; d.line(sx, sy, sx - 3 * k, sy + 5, wx.type === "blizzard" ? "rgba(27,27,27,0.5)" : "rgba(27,27,27,0.35)", 1); }
    }
  }
  // 明暗：按半格计算亮度（月光/室内 + 手里的灯 + 火 + 信号弹），画成一层半透明的暗色图块
  const amb = ambientOf(g);
  if (amb < 0.98) {
    const ls = [];
    const L = { lantern: [4.5, 0.95], flashlight: [6.5, 1.0], candle: [2.5, 0.75], torch: [4.2, 0.9] }[(g.lit || {}).kind];
    if (L) ls.push([pc.x, pc.y, L[0] * T, L[1]]);
    for (const f of Object.values(g.fire || {})) if (f.rid === g.rid) ls.push([(f.x + f.w / 2) * T, (f.y + f.h / 2) * T, (2.5 + f.temp / 12) * T, 0.9]);
    if (g.flareT && t - g.flareT < 20000) ls.push([pc.x, pc.y, 8 * T, 1]);
    const C = T / 2, gx0 = Math.floor(cx / C), gy0 = Math.floor(cy / C), gw = Math.ceil(vw / C) + 2, gh = Math.ceil(vh / C) + 2;
    const rows = [];
    for (let j = 0; j < gh; j++) {
      const row = [], y = (gy0 + j + 0.5) * C;
      for (let i = 0; i < gw; i++) {
        const x = (gx0 + i + 0.5) * C; let b = amb;
        for (const l of ls) { const dd = Math.hypot(x - l[0], y - l[1]) / l[2]; if (dd < 1) b = Math.max(b, Math.pow(1 - dd, 0.7) * l[3]); }
        const lv = Math.round((1 - b) * 8); row.push(lv <= 0 ? -1 : Math.min(8, lv));
      }
      rows.push(row);
    }
    d.camera(cx, cy, Z);
    d.tilemap({ tile_size: C, map: rows, x: gx0 * C, y: gy0 * C, colors: DARKC });
    d.camera(0, 0, 1);
  }

  // ── HUD ──
  hud(d, g, W, H, t, api);
  if (g.focus && !g.busy && g.ui.mode === "play") {
    const sx = (pc.x - cx) * Z, sy = (pc.y - cy) * Z - 66;
    const w = Math.max(120, g.focus.l.length * 16 + 50);
    panel(d, sx - w / 2, sy - 16, w, 32);
    d.text("[E] " + g.focus.l, sx, sy - 10, { size: 16, color: INK, align: "center" });
  }
  if (g.busy) {
    const b = g.busy, p = b.need > 9000 ? ((t / 1000) % 1) : clamp(b.done / b.need, 0, 1);
    panel(d, W / 2 - 150, H / 2 - 70, 300, 120);
    d.circle(W / 2, H / 2 - 18, 26, INK, { stroke: true, width: 1 });
    for (let a = 0; a < p * 40; a++) { const an = -Math.PI / 2 + (a / 40) * Math.PI * 2; d.circle(W / 2 + Math.cos(an) * 26, H / 2 - 18 + Math.sin(an) * 26, 3, INK); }
    d.text(b.l, W / 2, H / 2 + 18, { size: 17, color: INK, align: "center" });
    if (b.need < 9000 && !b.real) d.text(Math.round(b.done) + " / " + Math.round(b.need) + " 分钟　[Esc] 中断", W / 2, H / 2 + 38, { size: 12, color: DIM, align: "center" });
  }
  if (g.ui.mode === "talk") {
    panel(d, W / 2 - 250, 110, 500, 52, true);
    d.text("正在和 " + g.ui.name + " 交谈", W / 2, 118, { size: 18, color: PAPER, align: "center", bold: true });
    d.text("在右侧对话框里说话 · 时间暂停 · Esc 结束", W / 2, 140, { size: 12, color: PAPER, align: "center" });
  }
  if (g.ui.mode === "menu") menu(d, g.ui.menu, W, H);
  if (g.ui.mode === "note") note(d, g.ui, W, H);
  if (g.ui.mode === "map") mapView(d, api, g, lvl, W, H);
  if (g.ui.mode === "struggle") {
    d.rect(0, 0, W, H, "rgba(120,10,10,0.25)");
    panel(d, W / 2 - 200, H / 2 - 60, 400, 120);
    d.text("狼扑了上来！连按 E 挣脱！", W / 2, H / 2 - 44, { size: 22, color: INK, align: "center", bold: true });
    bar(d, W / 2 - 170, H / 2, 340, 26, g.ui.meter / 100, true);
    d.text("剩余 " + Math.max(0, 5 - g.ui.t).toFixed(1) + " 秒", W / 2, H / 2 + 34, { size: 13, color: DIM, align: "center" });
  }
}

function hud(d, g, W, H, t, api) {
  const b = g.body;
  panel(d, 12, 12, 250, 158);
  const rows = [["体温", b.warm / 100, Math.round(b.warm) + "%"], ["热量", b.kcal / 2500, Math.round(b.kcal) + ""], ["水分", b.water / 3, b.water.toFixed(1) + "L"], ["疲劳", b.fat / 100, Math.round(b.fat) + "%"], ["状态", b.cond / 100, Math.round(b.cond) + "%"]];
  rows.forEach(([n, v, s], i) => {
    const y = 24 + i * 28, low = v < 0.2 && (Math.floor(t / 400) % 2);
    d.text(n, 24, y, { size: 15, color: low ? "#a01e1e" : INK });
    bar(d, 66, y, 136, 16, v, i === 4);
    d.text(s, 252, y, { size: 12, color: DIM, align: "right" });
  });
  if (b.stam < 99) bar(d, 66, 162, 136, 5, b.stam / 100, true);
  if (g.lit) { const e = (g.inv || []).find((x) => x.id === g.lit.id && (x.u || 0) > 0); const nm = { lantern: "风灯", flashlight: "手电", candle: "蜡烛", torch: "火把" }[g.lit.kind];
    panel(d, 12, 182, 250, 26); d.text("手里：" + nm + (e ? "　还能用 " + Math.round(e.u) + " 分钟" : ""), 24, 188, { size: 13, color: INK }); }
  else if ((g.ambL || 1) < 0.5 && (g.bright || 1) < 0.3) { panel(d, 12, 182, 250, 26, true); d.text("太黑了。打开背包点灯，或者生火。", 24, 188, { size: 13, color: PAPER }); }
  // 右上：地点、时间、天气
  const world = api.state.get("world") || {};
  const R = (world.regions || {})[g.rid] || {};
  panel(d, W - 300, 12, 288, 84);
  d.text((R.name || "") + (g.insideName ? " · " + g.insideName : ""), W - 288, 22, { size: 17, color: INK });
  d.text("第 " + (Math.floor(g.clock / 1440) + 1) + " 天  " + hhmm(g.clock), W - 288, 46, { size: 14, color: INK });
  const wx = g.wxNow || {};
  d.text((WXNAME[wx.type] || "") + "  气温 " + wx.t + "°C  风 " + Math.round(wx.wind) + "  体感 " + Math.round(g.feel) + "°C", W - 288, 68, { size: 13, color: DIM });
  // 伤病
  const a = g.aff, tags = [];
  if (a.hypo) tags.push("失温症"); if (a.bleed) tags.push("流血"); if (a.fp > 0) tags.push("食物中毒"); if (a.dys > 0) tags.push("痢疾"); if (a.sprain > 0) tags.push("扭伤"); if (a.wet > 0) tags.push("浑身湿透");
  if (b.warm <= 0) tags.unshift("冻僵"); if (b.kcal <= 0) tags.push("饥饿"); if (b.water <= 0) tags.push("脱水"); if (b.fat <= 0) tags.push("精疲力竭");
  tags.forEach((s, i) => { panel(d, W - 300 + (i % 3) * 96, 106 + Math.floor(i / 3) * 34, 88, 26, true); d.text(s, W - 300 + (i % 3) * 96 + 44, 111 + Math.floor(i / 3) * 34, { size: 13, color: PAPER, align: "center" }); });
  // 线索
  // AI 设计的结局：当前这一步
  const gn = g.goalNow;
  if (gn) {
    const txt = "目标 " + (gn.i + 1) + "/" + gn.n + "：" + gn.hint + (gn.rname && gn.region !== g.rid ? "（在 " + gn.rname + "）" : "");
    const w = Math.min(560, txt.length * 14 + 28);
    panel(d, W - w - 12, H - 52, w, 30);
    d.text(txt, W - 24, H - 45, { size: 14, color: INK, align: "right" });
  }
  // 提示消息
  const msgs = (g.toast || []).filter((m) => t - m.t < 6000);
  msgs.forEach((m, i) => { const y = H - 150 + i * 30, al = clamp((6000 - (t - m.t)) / 1000, 0, 1); d.rect(14, y, Math.min(420, m.text.length * 15 + 24), 24, PAPER, { alpha: 0.85 * al }); d.text(m.text, 24, y + 4, { size: 14, color: INK, alpha: al }); });
  // AI 叙事
  if (g.narr && t - g.narr.t < 16000) {
    const lines = wrap(g.narr.text, 34).slice(0, 3), al = clamp((16000 - (t - g.narr.t)) / 1500, 0, 1);
    panel(d, W / 2 - 290, H - 20 - lines.length * 24 - 16, 580, lines.length * 24 + 16);
    lines.forEach((l, i) => d.text(l, W / 2 - 274, H - 20 - lines.length * 24 - 6 + i * 24, { size: 16, color: INK, alpha: al }));
  }
  d.text("WASD 移动 · Shift 跑 · E 交互 · Tab 背包 · M 地图 · Esc 返回", 16, H - 22, { size: 11, color: DIM });
}

function menu(d, m, W, H) {
  const n = m.items.length, rowH = 28, h = Math.min(H - 80, 64 + n * rowH), w = 460;
  const x = W / 2 - w / 2, y = H / 2 - h / 2;
  panel(d, x, y, w, h);
  d.text(wrap(m.title, 30)[0], x + 20, y + 16, { size: 18, color: INK, bold: true });
  d.line(x + 16, y + 44, x + w - 16, y + 45, INK, 1.2);
  const maxRows = Math.floor((h - 60) / rowH), start = clamp(m.cur - maxRows + 2, 0, Math.max(0, n - maxRows));
  for (let k = 0; k < Math.min(n, maxRows); k++) {
    const i = start + k, it = m.items[i], yy = y + 54 + k * rowH;
    if (i === m.cur) { d.rect(x + 12, yy - 3, w - 24, rowH - 2, INK); }
    d.text((i === m.cur ? "▶ " : "　") + it.l, x + 22, yy, { size: 15, color: i === m.cur ? PAPER : it.dis ? "rgba(27,27,27,0.35)" : INK });
  }
  d.text("W/S 选择 · E 确定 · Esc 返回", x + w - 16, y + h - 20, { size: 11, color: DIM, align: "right" });
}
function note(d, u, W, H) {
  const lines = wrap(u.text, 24);
  const h = 110 + lines.length * 26, w = 480, x = W / 2 - w / 2, y = H / 2 - h / 2;
  d.rect(x + 6, y + 8, w, h, "rgba(0,0,0,0.15)"); d.rect(x, y, w, h, "#f7f1dc");
  for (let i = 0; i < lines.length + 2; i++) d.line(x + 24, y + 70 + i * 26, x + w - 24, y + 70 + i * 26, "rgba(27,27,27,0.12)", 1);
  d.text(u.title, x + w / 2, y + 24, { size: 20, color: INK, align: "center", bold: true });
  lines.forEach((l, i) => d.text(l, x + 30, y + 52 + i * 26, { size: 17, color: INK }));
  d.text("[E] 收起", x + w - 20, y + h - 24, { size: 12, color: DIM, align: "right" });
}
function mapView(d, api, g, lvl, W, H) {
  d.rect(0, 0, W, H, "rgba(243,239,228,0.96)");
  const world = api.state.get("world");
  const ids = Object.keys(world.regions);
  // 世界层：按 BFS 深度排布
  const depth = {}; const q = [world.start]; depth[world.start] = 0;
  while (q.length) { const a = q.shift(); for (const l of world.links) { const b = l[0] === a ? l[1] : l[1] === a ? l[0] : null; if (b && depth[b] === undefined) { depth[b] = depth[a] + 1; q.push(b); } } }
  const col = {}, pos = {};
  for (const id of ids) { const dd = depth[id] || 0; col[dd] = (col[dd] || 0) + 1; pos[id] = [70 + dd * 70, 90 + (col[dd] - 1) * 70]; }
  d.text("地图", 30, 24, { size: 22, color: INK, bold: true });
  for (const l of world.links) { if (!(g.seen[l[0]] || g.seen[l[1]])) continue; const [a, b] = [pos[l[0]], pos[l[1]]]; d.line(a[0], a[1], b[0], b[1], INK, 1.4); }
  for (const id of ids) {
    const p = pos[id], seen = g.seen[id], near = !seen && world.links.some((l) => (l[0] === id && g.seen[l[1]]) || (l[1] === id && g.seen[l[0]]));
    if (!seen && !near) continue;
    d.circle(p[0], p[1], id === g.rid ? 12 : 8, seen ? INK : PAPER, seen ? {} : { stroke: true, width: 1.5 });
    d.text(seen ? world.regions[id].name : "？", p[0], p[1] + 14, { size: 13, color: INK, align: "center" });
  }
  // 区域层：用碰撞图着色的缩略图
  const s = 6, mx = W - lvl.w * s - 30, my = 70;
  d.text(world.regions[g.rid].name, mx, 40, { size: 18, color: INK });
  d.tilemap({ tile_size: s, map: lvl.c, x: mx, y: my, colors: { ".": "#efe9dc", d: "#e2dbc9", i: "#c9c9c9", t: "#a8a8a8", w: "#5a5a5a", "#": "#2b2b2b", r: "#d3c9b0", B: "#3a3a3a", D: "#777", f: "#cfc3a8", x: "#9a9a9a", L: "#777" } });
  d.rect(mx, my, lvl.w * s, lvl.h * s, INK, { stroke: true, width: 2 });
  for (const e of lvl.ex) { const ex = e.side === "e" ? lvl.w - 1 : e.side === "w" ? 0 : e.a, ey = e.side === "n" ? 0 : e.side === "s" ? lvl.h - 1 : e.a; d.text("→ " + e.label, mx + ex * s + (e.side === "e" ? -4 : 4), my + ey * s - 6, { size: 11, color: INK, align: e.side === "e" ? "right" : "left" }); }
  d.circle(mx + (g.pc.x / T) * s, my + (g.pc.y / T) * s, 5, "#a01e1e");
  d.text("[M] 关闭", W - 30, H - 30, { size: 12, color: DIM, align: "right" });
}
function waitScreen(d, g, W, H, t) {
  d.clear(PAPER);
  for (let i = 0; i < 70; i++) { const x = (i * 137.5) % W, y = H * 0.55 + ((i * 71.3) % (H * 0.45)), s = 0.6 + ((i * 13) % 10) / 12; d.line(x, y - 24 * s, x - 12 * s, y + 6 * s, INK, 1.2); d.line(x, y - 24 * s, x + 12 * s, y + 6 * s, INK, 1.2); d.line(x - 12 * s, y + 6 * s, x + 12 * s, y + 6 * s, INK, 1.2); }
  for (let i = 0; i < 120; i++) { const sx = (i * 97.1 + t * 0.05) % W, sy = (i * 53.3 + t * 0.03) % H; d.line(sx, sy, sx - 2, sy + 5, "rgba(27,27,27,0.4)", 1); }
  d.text("雪线", W / 2, H * 0.22, { size: 64, color: INK, align: "center", bold: true });
  const w = g.wait || { l: "……" };
  d.text(w.l, W / 2, H * 0.22 + 92, { size: 18, color: INK, align: "center" });
  d.text("已等待 " + Math.floor((w.el || 0) / 1000) + " 秒（AI 太慢或不可用时，会自动改用规则生成）", W / 2, H * 0.22 + 124, { size: 13, color: DIM, align: "center" });
  for (let k = 0; k < 12; k++) { const an = (k / 12) * Math.PI * 2 + t / 600; d.circle(W / 2 + Math.cos(an) * 22, H * 0.22 + 180 + Math.sin(an) * 22, k === 0 ? 5 : 2.5, INK); }
}
