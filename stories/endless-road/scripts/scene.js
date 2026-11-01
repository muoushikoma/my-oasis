// 无尽之路 / The Endless Road — 画面合成（2D 横版侧视）
// 画面由模块拼成：地区背景 4 层（天空/远景/中景/地面，视差卷动）+ 主体精灵 + 主角 + 天气粒子 + 时间色调。
// AI 只挑模块（精灵、染色、时间、天气），这里负责画出来；render 只读状态。

export const W = 256, H = 144, GROUND = 118, HERO_X = 58, SUBJECT_X = 176;
export const SPEED = 120; // 走路时每秒卷动的像素
export const SPR = {
  hero_fighter: { w: 24, h: 27, frames: 6 }, hero_rogue: { w: 24, h: 27, frames: 6 }, hero_wizard: { w: 24, h: 27, frames: 6 }, hero_cleric: { w: 24, h: 27, frames: 6 },
  wolf: { w: 37, h: 18 }, spider: { w: 32, h: 18 }, bandit: { w: 20, h: 21 }, skeleton: { w: 20, h: 23 },
  troll: { w: 31, h: 24 }, drake: { w: 34, h: 21 }, ooze: { w: 26, h: 16 }, wisp: { w: 22, h: 20, float: 10 },
  warden: { w: 30, h: 27 },
  chest: { w: 22, h: 14 }, cart: { w: 40, h: 20 }, shrine: { w: 24, h: 19 }, campfire: { w: 36, h: 13, frames: 2 },
  stranger: { w: 16, h: 20 }, rocks: { w: 28, h: 11 }, chasm: { w: 54, h: 11, sink: 3 }, thorns: { w: 35, h: 9 },
  glyphs: { w: 7, h: 9, frames: 19 },
};
// 像素字体：和精灵一样逐像素画的，放大后不会糊（客户端的文字在 256×144 的画布上放大会糊）
const GLYPHS = "0123456789+-!vxshm?";
function pxText(d, str, x, y, o) {
  o = o || {};
  const sc = o.scale || 1, adv = 6 * sc, chars = String(str).split("").filter((c) => GLYPHS.indexOf(c) >= 0);
  let cx = Math.round(o.align === "right" ? x - chars.length * adv : o.align === "center" ? x - (chars.length * adv) / 2 : x);
  for (const c of chars) {
    const opt = { sx: GLYPHS.indexOf(c) * 7, sy: 0, sw: 7, sh: 9, alpha: o.alpha == null ? 1 : o.alpha };
    if (o.tint) opt.tint = o.tint;
    d.image("glyphs", cx, Math.round(y), 7 * sc, 9 * sc, opt);
    cx += adv;
  }
}
const TINT = { none: null, red: "#ff9a8a", green: "#a8ff9a", blue: "#9ac4ff", gold: "#ffe08a", shadow: "#8078a0", pale: "#e8f4ff", purple: "#d4a4ff" };
const LAYERS = [["sky", 0, 256], ["far", 0.15, 256], ["mid", 0.4, 512], ["ground", 1, 512]];

function mod(a, n) { return ((a % n) + n) % n; }

// ---------- 推进（动画计时） ----------
export function tick(api) {
  const s = api.state.get("scene_fx");
  if (!s || !s.busy) return;
  const dt = api.dt;
  let busy = false;
  if (s.scroll < s.target) { s.scroll = Math.min(s.target, s.scroll + (SPEED * dt) / 1000); busy = true; }
  for (const k of ["atk", "fhurt", "hhurt", "fmiss"]) if (s[k] > 0) { s[k] = Math.max(0, s[k] - dt); busy = true; }
  if (s.dying) { s.dying.t -= dt; if (s.dying.t <= 0) s.dying = null; else busy = true; }
  if (s.fx && s.fx.length) { s.fx = s.fx.filter((f) => (f.life -= dt) > 0); busy = busy || s.fx.length > 0; }
  if (s.prev && s.prev.wx - s.scroll < -80) s.prev = null;
  s.busy = busy;
  api.state.set("scene_fx", s);
}

// ---------- 绘制 ----------
function drawSprite(d, name, x, base, o) {
  const m = SPR[name]; if (!m) return;
  const scale = o.scale || 1, w = m.w * scale, h = m.h * scale;
  const frame = o.frame || 0;
  const y = base - h + 1 + (m.sink || 0) * scale - (m.float ? m.float + Math.round(Math.sin((o.t || 0) / 300) * 2) : 0);
  const opt = { sx: frame * m.w, sy: 0, sw: m.w, sh: m.h, flip_x: !!o.flip, alpha: o.alpha == null ? 1 : o.alpha };
  if (o.tint) opt.tint = o.tint;
  d.image(name, Math.round(x - w / 2), Math.round(y), w, h, opt);
  return { x: x - w / 2, y, w, h };
}

export function draw(api) {
  const d = api.draw;
  const st = api.state;
  const s = st.get("scene_fx") || { scroll: 0, target: 0 };
  const art = st.get("art") || {};
  const biome = st.get("biome") || "plains";
  const t = api.time + (api.alpha || 0) * 50;
  // 插值：走路时让卷动按显示帧率平滑
  let scroll = s.scroll;
  if (s.scroll < s.target) scroll = Math.min(s.target, s.scroll + SPEED * (api.alpha || 0) / 20);
  d.clear("#000");
  // 背景四层（中景和地面 512 宽，远景 256 宽，横向循环）
  for (const [layer, k, lw] of LAYERS) {
    const ox = -mod(Math.round(scroll * k), lw);
    for (let x = ox; x < W; x += lw) d.image(`${biome}_${layer}`, x, 0);
  }
  const walking = s.scroll < s.target;
  // 上一个主体（被走过去，从左边离开）
  if (s.prev) drawSprite(d, s.prev.sprite, s.prev.wx - scroll, GROUND, { scale: s.prev.scale, tint: TINT[s.prev.tint], frame: 0, t });
  // 当前主体
  const battle = st.get("phase") === "battle";
  const foe = st.get("foe") || {};
  let box = null;
  if (s.cur) {
    const c = s.cur, m = SPR[c.sprite] || {};
    let x = c.wx - scroll;
    if (s.fhurt > 0) x += Math.round(Math.sin(s.fhurt / 20) * 3) + 3;
    if (c.boss && !c.pending) {
      d.particles("aura", x, GROUND - (m.h || 20) * (c.scale || 1) / 2, { rate: 18, life_ms: 1200, speed: 10, angle: -90, spread: 360, radius: 26, size: 2, end_size: 0, color: "#ff8a4a", end_color: "#ff2a1a", soft: false, max: 80 });
    }
    const flash = s.fhurt > 0 && Math.floor(s.fhurt / 60) % 2 === 0;
    box = drawSprite(d, c.sprite, x, GROUND, {
      scale: c.scale, t,
      frame: m.frames ? Math.floor(t / 180) % m.frames : 0,
      tint: c.pending ? "#000000" : TINT[c.tint],
      alpha: c.pending ? 0.75 : flash ? 0.35 : 1,
    });
    if (c.sprite === "campfire" && !c.pending) d.particles("fire", x + 6 * (c.scale || 1), GROUND - 8, { rate: 14, life_ms: 700, speed: 14, angle: -90, spread: 30, size: 1, end_size: 0, color: "#ffb03a", end_color: "#ff4a1a", gravity: -6, soft: false, max: 60 });
    if (c.sprite === "shrine" && !c.pending) d.particles("rune", x, GROUND - 22, { rate: 6, life_ms: 1600, speed: 8, angle: -90, spread: 120, size: 1, color: "#c4f2ff", end_color: "#4a8aff", soft: false, max: 40 });
    if (c.sprite === "chest" && !c.pending) d.particles("glint", x, GROUND - 14, { rate: 3, life_ms: 900, speed: 4, spread: 360, size: 1, color: "#fff6c0", end_color: "#f2cc54", soft: false, max: 20 });
    if (c.pending) pxText(d, "?", x, box.y - 12 + Math.round(Math.sin(t / 250)), { align: "center", alpha: 0.75 + Math.sin(t / 200) * 0.25 });
  }
  // 倒下的敌人（淡出）
  if (s.dying) drawSprite(d, s.dying.sprite, s.dying.wx - scroll + (600 - s.dying.t) / 30, GROUND, { scale: s.dying.scale, tint: "#ff6a5a", alpha: Math.max(0, s.dying.t / 600), t });
  // 主角
  let hx = HERO_X, frame = 0;
  if (walking) frame = 1 + (Math.floor(scroll / 7) % 4);
  else if (s.atk > 0) { frame = 5; hx += 6; }
  if (s.hhurt > 0) hx -= Math.round(Math.sin(s.hhurt / 25) * 2) + 2;
  const hflash = s.hhurt > 0 && Math.floor(s.hhurt / 60) % 2 === 0;
  const heroCls = st.get("hero_class") || "fighter";
  drawSprite(d, `hero_${heroCls}`, hx, GROUND, { frame, tint: hflash ? "#ff7a7a" : null, alpha: st.get("hp") <= 0 ? 0.4 : 1 });
  // 挥剑的弧光
  if (s.atk > 0 && heroCls === "wizard" && s.cur) {
    // 法师：火焰箭从法杖飞向敌人
    const k = Math.min(1, 1 - s.atk / 450), tx = s.cur.wx - scroll, sx = hx + 14;
    const bx = sx + (tx - sx) * k, by = GROUND - 16 + Math.sin(k * Math.PI) * -6;
    d.particles("bolt", bx, by, { rate: 90, life_ms: 260, speed: 10, spread: 360, size: 2, end_size: 0, color: "#ffd06a", end_color: "#ff4a1a", soft: false, max: 60 });
    d.rect(Math.round(bx) - 2, Math.round(by) - 2, 4, 4, "#fff2b0");
  } else if (s.atk > 0) {
    const a = 1 - s.atk / 300;
    for (let i = 0; i < 6; i++) { const ang = -1.2 + a * 2 + i * 0.12; d.rect(Math.round(hx + 14 + Math.cos(ang) * 14), Math.round(GROUND - 12 + Math.sin(ang) * 14), 2, 2, "#ffffff", { alpha: 0.9 - i * 0.12 }); }
  }
  // 敌人血条
  if (battle && s.cur && !s.cur.pending && box && foe.max_hp) {
    const bw = 30, bx = Math.round(box.x + box.w / 2 - bw / 2), by = Math.round(box.y - 6);
    d.rect(bx - 1, by - 1, bw + 2, 4, "#1a1420");
    d.rect(bx, by, Math.max(0, Math.round(bw * foe.hp / foe.max_hp)), 2, foe.boss ? "#ff7a3a" : "#e2422c");
  }
  // 天气
  const weather = art.weather || "clear";
  if (weather === "rain") d.particles("rain", W / 2, -6, { rate: 200, life_ms: 800, speed: 260, angle: 105, spread: 4, radius: 150, size: 1.5, end_size: 1.5, color: "#a8c8ff", end_color: "#a8c8ff", soft: false, max: 300, blend: "normal" });
  if (weather === "snow") d.particles("snow", W / 2, -4, { rate: 60, life_ms: 6000, speed: 22, angle: 100, spread: 30, radius: 150, size: 2, end_size: 1, color: "#ffffff", end_color: "#e8f0ff", soft: false, max: 300, blend: "normal" });
  if (weather === "embers") d.particles("embers", W / 2, H + 4, { rate: 30, life_ms: 4000, speed: 22, angle: -95, spread: 40, radius: 150, size: 2, end_size: 0, color: "#ffc04a", end_color: "#ff3a1a", soft: false, max: 200 });
  if (weather === "fireflies") d.particles("flies", W / 2, GROUND - 24, { rate: 8, life_ms: 3000, speed: 5, spread: 360, radius: 120, size: 2, end_size: 1, color: "#e8ff8a", end_color: "#6aff6a", soft: false, max: 40 });
  if (weather === "leaves") d.particles("leaves", W / 2, -4, { rate: 10, life_ms: 5000, speed: 22, angle: 115, spread: 30, radius: 150, size: 2, end_size: 2, color: "#e8a040", end_color: "#c25a2a", soft: false, max: 60, blend: "normal" });
  if (weather === "fog") for (let i = 0; i < 4; i++) { const fx = mod(Math.round(i * 90 - t / 60 - scroll * 0.6), W + 120) - 120; d.rect(fx, GROUND - 30 + i * 6, 120, 14, "#dfe8e4", { alpha: 0.13 }); }
  // 时间色调
  const time = art.time || "day";
  if (time === "dusk") { d.rect(0, 0, W, H, "#ff8a4a", { alpha: 0.4, blend: "multiply" }); d.rect(0, 0, W, 70, "#ff6a3a", { alpha: 0.08, blend: "add" }); }
  if (time === "night") { d.rect(0, 0, W, H, "#28366e", { alpha: 0.68, blend: "multiply" }); }
  // 飘字
  for (const f of st.get("hp") > 0 ? s.fx || [] : []) {
    const k = 1 - f.life / 900;
    pxText(d, f.text, f.x, f.y - Math.round(k * 14), { align: "center", tint: f.color, alpha: Math.min(1, f.life / 300) });
  }
  // 里程
  pxText(d, `m${st.get("distance")}`, W - 3, 3, { align: "right", tint: "#fff4dc" });
}
