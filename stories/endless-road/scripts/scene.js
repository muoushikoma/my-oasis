// 无尽之路 / The Endless Road — 画面动画的计时（realtime.on_tick）
// 场景本身由自定义组件 ui/game.js 画；这里只推进卷动、受击、攻击、飘字等动画状态（scene_fx）。

export const W = 256, H = 144, GROUND = 118, HERO_X = 58, SUBJECT_X = 176;
export const SPEED = 120; // 走路时每秒卷动的像素
export const SPR = {
  hero_fighter: { w: 24, h: 27, frames: 6 }, hero_rogue: { w: 24, h: 27, frames: 6 }, hero_wizard: { w: 24, h: 27, frames: 6 }, hero_cleric: { w: 24, h: 27, frames: 6 },
  wolf: { w: 37, h: 18 }, spider: { w: 32, h: 18 }, bandit: { w: 20, h: 21 }, skeleton: { w: 20, h: 23 },
  troll: { w: 31, h: 24 }, drake: { w: 34, h: 21 }, ooze: { w: 26, h: 16 }, wisp: { w: 22, h: 20, float: 10 },
  warden: { w: 30, h: 27 },
  chest: { w: 22, h: 14 }, cart: { w: 40, h: 20 }, shrine: { w: 24, h: 19 }, campfire: { w: 36, h: 13, frames: 2 },
  stranger: { w: 16, h: 20 }, rocks: { w: 28, h: 11 }, chasm: { w: 54, h: 11, sink: 3 }, thorns: { w: 35, h: 9 },
};
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
