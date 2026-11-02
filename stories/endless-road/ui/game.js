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

// ================= 场景（客户端内置的游戏运行时：PixiJS） =================
// 像素背景 4 层视差、精灵、粒子、天气、按时间的调色（白天 / 黄昏 / 夜晚）、篝火和幽魂的光晕、暗角、
// 受击时的镜头震动与顿帧、攻击的刀光和法术弹道。界面仍然是叠在上面的 HTML。
const SFX = ["dice_roll", "dice_land", "success", "fail", "crit", "fumble", "swing", "hit", "crit_hit", "miss", "hurt", "block", "magic", "charge", "victory", "battle",
  "coin", "levelup", "item", "heal", "click", "step", "card", "camp", "death", "music"];
const Z = { game: null, PIXI: null, tex: {}, frames: {}, ready: false, scale: 1, offY: 0, dx: 0, view: null };
let dispScroll = 0, lastT = performance.now(), sceneTime = 0;
const POS = {};
function sfx(id, o) { try { Z.game && Z.game.audio.play(id, o || {}); } catch (e) { /* 没有声音也能玩 */ } }
function music(on) { try { Z.game && Z.game.audio.music(on ? "music" : null, { volume: 0.45 }); } catch (e) {} }
async function initScene() {
  const rt = window.oasis && window.oasis.game;
  if (!rt) { $("view").classList.add("noruntime"); return; }
  const sounds = {}; for (const n of SFX) sounds[n] = `assets/sfx/${n}.wav`;
  let game;
  try { game = await rt.create({ height: H0, scaleMode: "expand", pixelArt: true, background: 0x0d0a08, input: { actions: {} }, assets: { sounds } }); }
  catch (e) { try { game = await rt.create({ height: H0, scaleMode: "expand", pixelArt: true, background: 0x0d0a08, input: { actions: {} } }); } catch (e2) { $("view").classList.add("noruntime"); return; } }
  const PIXI = (Z.PIXI = rt.PIXI); Z.game = game; Z.view = $("view");
  const cv = game.app.canvas; Z.view.prepend(cv); cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated";
  game.app.resizeTo = Z.view; game.layout = layoutScene;
  // 贴图：直接用页面里预载的图片
  await Promise.all([...document.querySelectorAll("#assets img")].map((im) => im.complete ? 0 : new Promise((ok) => { im.onload = im.onerror = ok; })));
  for (const im of document.querySelectorAll("#assets img")) { const t = PIXI.Texture.from(im); t.source.scaleMode = "nearest"; Z.tex[im.dataset.k] = t; }
  const frameTex = (key, i) => { const m = SPR[key]; const id = key + ":" + i; if (Z.frames[id]) return Z.frames[id]; const base = Z.tex[key]; if (!base) return PIXI.Texture.EMPTY; return (Z.frames[id] = new PIXI.Texture({ source: base.source, frame: new PIXI.Rectangle(i * m[0], 0, m[0], m[1]) })); };
  Z.frameTex = frameTex;
  // 光晕贴图（径向渐变）
  const glow = document.createElement("canvas"); glow.width = glow.height = 64; { const g = glow.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
  Z.glow = PIXI.Texture.from(glow);
  game.camera.x = 0; game.camera.y = 0;
  // 运行时切场景时会清空画面，所以场景里的东西都在 enter 里搭
  game.scene("road", { enter: () => buildGraph(game, PIXI), render: () => drawScene() });
  game.start("road");
  Z.ready = true;
  // 第一次操作后开始放背景音乐
  const startMusic = () => { music(true); removeEventListener("pointerdown", startMusic); removeEventListener("keydown", startMusic); };
  addEventListener("pointerdown", startMusic); addEventListener("keydown", startMusic);
}
function buildGraph(game, PIXI) {
  const W = game.world;
  Z.bandTop = new PIXI.Graphics(); Z.bandBot = new PIXI.Graphics(); W.addChild(Z.bandTop, Z.bandBot);
  Z.layers = LAYERS.map(([name]) => { const t = new PIXI.TilingSprite({ texture: PIXI.Texture.EMPTY, width: 256, height: H0 }); W.addChild(t); return t; });
  Z.prev = new PIXI.Sprite(); Z.cur = new PIXI.Sprite(); Z.dying = new PIXI.Sprite(); Z.hero = new PIXI.Sprite(); Z.shadowL = new PIXI.Container();
  for (const sp of [Z.prev, Z.cur, Z.dying, Z.hero]) { sp.anchor.set(0.5, 1); }
  Z.shadows = new PIXI.Graphics(); W.addChild(Z.shadows);
  W.addChild(Z.prev, Z.cur, Z.dying, Z.hero);
  Z.fxG = new PIXI.Graphics(); Z.fxG.blendMode = "add"; W.addChild(Z.fxG);
  Z.weather = new PIXI.Container(); W.addChild(Z.weather); Z.wp = [];
  Z.lights = new PIXI.Container(); Z.lights.blendMode = "add"; W.addChild(Z.lights);
  Z.flashF = new PIXI.ColorMatrixFilter(); Z.flashF.brightness(2.4, false);
  Z.grade = new PIXI.ColorMatrixFilter(); W.filters = [Z.grade]; Z.gradeCur = [1, 1, 1, 1, 0];
  // 暗角 + 受伤红光（叠在 HUD 层）
  const vg = document.createElement("canvas"); vg.width = 256; vg.height = 144; { const g = vg.getContext("2d"), gr = g.createRadialGradient(128, 72, 40, 128, 72, 160); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.55)"); g.fillStyle = gr; g.fillRect(0, 0, 256, 144); }
  Z.vignette = new PIXI.Sprite(PIXI.Texture.from(vg)); Z.red = new PIXI.Sprite(PIXI.Texture.WHITE); Z.red.tint = 0xff2a1a; Z.red.alpha = 0; Z.red.blendMode = "add";
  game.hud.addChild(Z.vignette, Z.red);
  lightPool.length = 0; Z.wp = [];
  layoutScene();
}
function layoutScene() {
  const g = Z.game; if (!g) return;
  const r = Z.view.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  let s = Math.floor((r.height * dpr) / H0) / dpr; if ((r.height / s) < H0 * 0.98 || s <= 0) s = Math.max(1 / dpr, s - 1 / dpr);
  if (s * dpr < 1) s = r.height / H0;
  g.scale = s; g.width = Math.ceil(r.width / s); g.height = Math.ceil(r.height / s);
  g.root.scale.set(s); g.root.position.set(0, 0); g.root.mask = null;
  Z.offY = Math.floor((g.height - H0) / 2);
  Z.dx = Math.round(g.width * (r.width > r.height * 1.2 ? 0.3 : 0.24)) - HERO_X;
  g.camera.x = g.width / 2; g.camera.y = g.height / 2;
  if (Z.vignette) { Z.vignette.width = Z.red.width = g.width; Z.vignette.height = Z.red.height = g.height; }
  for (const t of Z.layers || []) { t.width = g.width; }
}
const sampled = {};
function bandColors(biome) {
  if (sampled[biome]) return sampled[biome];
  const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d");
  const px = (k, y) => { const im = IMG[k]; if (!im) return 0x0d0a08; x.clearRect(0, 0, 1, 1); x.drawImage(im, 0, y, 1, 1, 0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return (d[0] << 16) | (d[1] << 8) | d[2]; };
  return (sampled[biome] = [px(`${biome}_sky`, 0), px(`${biome}_ground`, H0 - 1)]);
}
// 时间调色：[r, g, b, 亮度, 饱和度偏移]
const GRADE = { day: [1, 1, 1, 1, 0], dusk: [1.12, 0.9, 0.74, 0.96, 0.05], night: [0.62, 0.72, 1.05, 0.62, -0.25] };
function applyGrade(t) {
  const tgt = GRADE[t] || GRADE.day, c = Z.gradeCur, k = 0.04;
  for (let i = 0; i < 5; i++) c[i] += (tgt[i] - c[i]) * k;
  const [r, g, b, br, sat] = c, l = (1 - sat) ; // 简单的颜色矩阵：亮度 × 色偏，再按饱和度混灰
  const m = Z.grade.matrix; const gr = sat < 0 ? -sat : 0, kk = 1 - gr;
  const row = (cr, cg, cb, mul) => [ (0.3 * gr + kk * cr) * mul * br, 0.59 * gr * mul * br, 0.11 * gr * mul * br ];
  const R = row(1, 0, 0, r), G = [0.3 * gr * g * br, (0.59 * gr + kk) * g * br, 0.11 * gr * g * br], B = [0.3 * gr * b * br, 0.59 * gr * b * br, (0.11 * gr + kk) * b * br];
  m[0] = R[0]; m[1] = R[1]; m[2] = R[2]; m[3] = 0; m[4] = 0;
  m[5] = G[0]; m[6] = G[1]; m[7] = G[2]; m[8] = 0; m[9] = 0;
  m[10] = B[0]; m[11] = B[1]; m[12] = B[2]; m[13] = 0; m[14] = 0;
  m[15] = 0; m[16] = 0; m[17] = 0; m[18] = 1; m[19] = 0;
  Z.grade.matrix = m;
}
const lightPool = [];
function light(i, x, y, r, color, a) { let sp = lightPool[i]; if (!sp) { sp = new Z.PIXI.Sprite(Z.glow); sp.anchor.set(0.5); Z.lights.addChild(sp); lightPool[i] = sp; } sp.visible = true; sp.position.set(x, y); sp.width = sp.height = r * 2; sp.tint = color; sp.alpha = a; }
function burst(o) { try { Z.game.particles.burst(o); } catch (e) {} }
let acc = { weather: 0, fire: 0, aura: 0, rune: 0, step: 0 }, lastDying = null, shakeHurt = 0;
function setSprite(sp, key, frame, scale, tint, alpha) {
  const m = SPR[key]; if (!m) { sp.visible = false; return; }
  sp.visible = true; sp.texture = Z.frameTex(key, frame || 0); sp.scale.set(scale || 1); sp.tint = tint == null ? 0xffffff : tint; sp.alpha = alpha == null ? 1 : alpha;
}
const hexTint = (c) => c ? parseInt(c.slice(1), 16) : null;
function drawScene() {
  if (!Z.layers || !Z.shadows) return;
  const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now; sceneTime += dt;
  const V = viewState(), s = V.scene_fx || { scroll: 0, target: 0 }, g = Z.game;
  if (dispScroll < s.scroll - 4 || dispScroll > s.target + 1) dispScroll = s.scroll;
  if (dispScroll < s.target) dispScroll = Math.min(s.target, dispScroll + SPEED * dt);
  const biome = V.biome || "plains", oy = Z.offY, scroll = dispScroll, dx = Z.dx;
  // 上下留白
  const [top, bot] = bandColors(biome);
  Z.bandTop.clear().rect(0, 0, g.width, oy + 1).fill(top); Z.bandBot.clear().rect(0, oy + H0 - 1, g.width, g.height - oy - H0 + 2).fill(bot);
  LAYERS.forEach(([layer, k, lw], i) => { const t = Z.layers[i], tex = Z.tex[`${biome}_${layer}`]; if (tex && t.texture !== tex) t.texture = tex; t.y = oy; t.height = H0; t.tilePosition.x = -Math.round(scroll * k); });
  const sx = (wx) => wx - scroll + dx, base = oy + GROUND + 1;
  const walking = dispScroll < s.target - 0.5;
  Z.shadows.clear();
  if (s.prev) { setSprite(Z.prev, s.prev.sprite, 0, s.prev.scale, hexTint(TINT[s.prev.tint])); Z.prev.position.set(Math.round(sx(s.prev.wx)), base + (SPR[s.prev.sprite][4] || 0) * (s.prev.scale || 1)); } else Z.prev.visible = false;
  let foeX = null, foeTop = null;
  if (s.cur) {
    const c = s.cur, m = SPR[c.sprite] || [20, 20], sc = c.scale || 1;
    let x = sx(c.wx); if (s.fhurt > 0) x += Math.round(Math.sin(s.fhurt / 20) * 3) + 3;
    const fl = m[2] > 1 ? Math.floor(now / 180) % m[2] : 0, flash = s.fhurt > 0 && Math.floor(s.fhurt / 60) % 2 === 0;
    const float = m[3] ? m[3] + Math.round(Math.sin(now / 300) * 2) : 0;
    setSprite(Z.cur, c.sprite, fl, sc, c.pending ? 0x000000 : hexTint(TINT[c.tint]), c.pending ? 0.75 : 1);
    Z.cur.position.set(Math.round(x), base + (m[4] || 0) * sc - float);
    Z.cur.filters = flash ? [Z.flashF] : null;
    foeX = x; foeTop = base - m[1] * sc - float;
    Z.shadows.ellipse(Math.round(x), base - 1, m[0] * sc * 0.42, 2.5).fill({ color: 0x000000, alpha: 0.28 });
    if (c.boss && !c.pending) { acc.aura += dt * 20; while (acc.aura > 1) { acc.aura--; burst({ x: x + (Math.random() - 0.5) * m[0] * sc, y: base - Math.random() * m[1] * sc, count: 1, color: [0xff8a4a, 0xff3a1a], speed: [6, 14], angle: [-110, -70], life: [0.6, 1.2], size: [1, 2] }); } }
    if (!c.pending && c.sprite === "campfire") { acc.fire += dt * 14; while (acc.fire > 1) { acc.fire--; burst({ x: x + 6 + (Math.random() - 0.5) * 6, y: base - 8, count: 1, color: [0xffd06a, 0xff8a2a, 0xff4a1a], speed: [10, 22], angle: [-100, -80], life: [0.4, 0.9], size: [1, 2], gravity: -10 }); } }
    if (!c.pending && c.sprite === "shrine") { acc.rune += dt * 5; while (acc.rune > 1) { acc.rune--; burst({ x: x + (Math.random() - 0.5) * 14, y: base - 18, count: 1, color: [0xc4f2ff, 0x6aa8ff], speed: [4, 10], angle: [-120, -60], life: [1, 1.8], size: 1 }); } }
  } else { Z.cur.visible = false; Z.cur.filters = null; }
  if (s.dying) {
    if (lastDying !== s.dying.t0key) { lastDying = s.dying.t0key; }
    const m = SPR[s.dying.sprite] || [20, 20], k = Math.max(0, s.dying.t / 600);
    setSprite(Z.dying, s.dying.sprite, 0, s.dying.scale, 0xff6a5a, k); Z.dying.position.set(Math.round(sx(s.dying.wx) + (600 - s.dying.t) / 30), base);
  } else Z.dying.visible = false;
  // 主角
  const cls = V.hero_class || "fighter";
  let hx = HERO_X + dx, fr = 0;
  if (walking) fr = 1 + (Math.floor(dispScroll / 7) % 4); else if (s.atk > 0) { fr = 5; hx += 6; }
  if (s.hhurt > 0 || shakeHurt > 0) hx -= Math.round(Math.sin((s.hhurt || shakeHurt * 1000) / 25) * 2) + 2;
  const hurtBlink = (s.hhurt > 0 && Math.floor(s.hhurt / 60) % 2 === 0) || (shakeHurt > 0 && Math.floor(shakeHurt * 16) % 2 === 0);
  setSprite(Z.hero, `hero_${cls}`, fr, 1, hurtBlink ? 0xff7a7a : null, V.hp <= 0 ? 0.4 : 1);
  Z.hero.position.set(hx, base);
  Z.shadows.ellipse(hx, base - 1, 9, 2.5).fill({ color: 0x000000, alpha: 0.3 });
  if (shakeHurt > 0) shakeHurt -= dt;
  // 脚步扬尘与脚步声
  if (walking) { acc.step += dt; if (acc.step > 0.26) { acc.step = 0; burst({ x: hx - 4, y: base - 1, count: 2, color: [0xd8c8a8, 0xb8a888], speed: [6, 14], angle: [180, 250], life: [0.3, 0.5], size: [1, 2] }); sfx("step", { volume: 0.25, rate: 0.9 + Math.random() * 0.2 }); } }
  // 攻击：刀光 / 法术弹道
  if (s.atk > 0 && !Z.lastAtk) sfx(cls === "wizard" ? "magic" : "swing", { volume: 0.6 });
  Z.lastAtk = s.atk > 0;
  Z.fxG.clear();
  if (s.atk > 0 && cls === "wizard" && foeX != null) {
    const k = Math.min(1, 1 - s.atk / 450), bx = hx + 14 + (foeX - hx - 14) * k, by = base - 16 - Math.sin(k * Math.PI) * 8;
    Z.fxG.circle(bx, by, 3).fill({ color: 0xfff2b0, alpha: 0.95 }).circle(bx, by, 6).fill({ color: 0xff8a2a, alpha: 0.35 });
    burst({ x: bx, y: by, count: 2, color: [0xffd06a, 0xff4a1a], speed: [4, 12], life: [0.15, 0.3], size: [1, 2] });
    light(9, bx, by, 26, 0xffa040, 0.6);
  } else if (s.atk > 0) {
    const a = 1 - s.atk / 300, cx = hx + 12, cy = base - 13;
    for (let i = 0; i < 3; i++) Z.fxG.arc(cx, cy, 13 + i * 2, -1.3 + a * 2.2 - 0.9, -1.3 + a * 2.2, false).stroke({ width: 2 - i * 0.5, color: i ? 0xffd890 : 0xffffff, alpha: (1 - a) * (1 - i * 0.3) });
  }
  if (!(s.atk > 0 && cls === "wizard")) lightPool[9] && (lightPool[9].visible = false);
  // 敌人血条
  if (V.phase === "battle" && s.cur && !s.cur.pending && V.foe && V.foe.max_hp && foeX != null) {
    const bw = 30, bx = Math.round(foeX - bw / 2), by = Math.round(foeTop - 7);
    Z.shadows.rect(bx - 1, by - 1, bw + 2, 5).fill(0x1a1420).rect(bx, by, bw, 3).fill(0x4a1410).rect(bx, by, Math.max(0, Math.round(bw * V.foe.hp / V.foe.max_hp)), 3).fill(V.foe.boss ? 0xff7a3a : 0xe2422c);
  }
  // 光源：夜里更明显
  const time = (V.art || {}).time || "day", nightK = time === "night" ? 1 : time === "dusk" ? 0.55 : 0.2;
  let li = 0;
  if (s.cur && !s.cur.pending) {
    const c = s.cur;
    if (c.sprite === "campfire") light(li++, foeX + 6, base - 6, 46 + Math.sin(now / 90) * 3, 0xff9a3a, 0.55 * nightK + 0.15);
    if (c.sprite === "wisp") light(li++, foeX, foeTop + 10, 34, hexTint(TINT[c.tint]) || 0x9ad8ff, 0.5 * nightK + 0.1);
    if (c.sprite === "shrine") light(li++, foeX, base - 16, 30, 0x8ac8ff, 0.4 * nightK + 0.08);
  }
  if (time === "night") light(li++, hx + 2, base - 14, 40, 0xffd8a0, 0.35);
  for (let i = li; i < 8; i++) if (lightPool[i]) lightPool[i].visible = false;
  // 天气
  weather(V, dt, now, scroll);
  applyGrade(time);
  if (Z.red.alpha > 0) Z.red.alpha = Math.max(0, Z.red.alpha - dt * 1.6);
  // 屏幕坐标（给飘字、问号用）
  const css = (wx, wy) => ({ x: (wx + g.world.x) * Z.game.scale, y: (wy + g.world.y) * Z.game.scale });
  POS.hero = css(hx, base - 27); POS.foe = foeX != null ? css(foeX, foeTop) : null; POS.pending = !!(s.cur && s.cur.pending);
  POS.ground = css(g.width / 2, base);
  placeMarks();
}
function weather(V, dt, now, scroll) {
  const w = (V.art || {}).weather || "clear", g = Z.game, PIXI = Z.PIXI;
  const rate = { rain: 160, snow: 40, embers: 22, fireflies: 5, leaves: 8, fog: 0.6 }[w] || 0;
  acc.weather += dt * rate * (g.width / 256);
  while (acc.weather > 1 && Z.wp.length < 500) {
    acc.weather--; const sp = new PIXI.Sprite(w === "fireflies" || w === "fog" || w === "embers" ? Z.glow : PIXI.Texture.WHITE); sp.anchor.set(0.5);
    const p = { sp, w, x: Math.random() * g.width, y: -4, vx: 0, vy: 0, life: 6, t: 0 };
    if (w === "rain") { sp.width = 1; sp.height = 5; sp.tint = 0xa8c8ff; sp.alpha = 0.7; sp.rotation = 0.25; p.vx = -40; p.vy = 240; p.life = 1; }
    else if (w === "snow") { sp.width = sp.height = 1 + Math.round(Math.random()); sp.tint = 0xffffff; p.vx = -6 + Math.random() * 4; p.vy = 18 + Math.random() * 10; p.life = 9; }
    else if (w === "embers") { sp.width = sp.height = 4; sp.tint = Math.random() < 0.5 ? 0xffb03a : 0xff5a1a; sp.blendMode = "add"; p.y = g.height + 2; p.vx = (Math.random() - 0.5) * 10; p.vy = -18 - Math.random() * 10; p.life = 5; }
    else if (w === "fireflies") { sp.width = sp.height = 6; sp.tint = 0xd8ff8a; sp.blendMode = "add"; p.y = Z.offY + GROUND - 10 - Math.random() * 40; p.vx = (Math.random() - 0.5) * 6; p.vy = (Math.random() - 0.5) * 4; p.life = 4; }
    else if (w === "leaves") { sp.width = 2; sp.height = 2; sp.tint = Math.random() < 0.5 ? 0xe8a040 : 0xc25a2a; p.vx = -16 - Math.random() * 8; p.vy = 16 + Math.random() * 8; p.life = 9; }
    else if (w === "fog") { sp.width = 160; sp.height = 30; sp.tint = 0xe8f0ec; sp.alpha = 0; p.x = g.width + 80; p.y = Z.offY + GROUND - 30 + Math.random() * 30; p.vx = -6 - Math.random() * 4; p.life = 40; }
    Z.weather.addChild(sp); Z.wp.push(p);
  }
  for (let i = Z.wp.length - 1; i >= 0; i--) {
    const p = Z.wp[i]; p.t += dt;
    if (p.t > p.life || p.w !== w && p.t > 0.5 || p.y > g.height + 6 || p.x < -120) { p.sp.destroy(); Z.wp.splice(i, 1); continue; }
    if (p.w === "leaves") p.vx += Math.sin(now / 300 + i) * 4 * dt;
    if (p.w === "fireflies") { p.vx += (Math.random() - 0.5) * 10 * dt; p.vy += (Math.random() - 0.5) * 10 * dt; p.sp.alpha = 0.5 + 0.5 * Math.sin(now / 200 + i); }
    if (p.w === "fog") p.sp.alpha = Math.min(0.12, p.t / 6) * Math.min(1, (p.life - p.t) / 6);
    if (p.w === "embers") p.sp.alpha = Math.min(1, (p.life - p.t));
    p.x += p.vx * dt; p.y += p.vy * dt; p.sp.position.set(p.x, p.y);
  }
}
// 受击反馈（由飘字触发）：镜头震动、顿帧、火花、声音
function impact(f) {
  const g = Z.game; if (!g) return;
  const at = f.foe ? POS.foe : POS.hero; const wx = at ? at.x / g.scale - g.world.x : 0, wy = at ? at.y / g.scale - g.world.y + 10 : 0;
  const t = String(f.text);
  if (f.foe && /^\d/.test(t)) {
    const crit = /!$/.test(t) || f.color === "#ffdd44";
    burst({ x: wx, y: wy, count: crit ? 22 : 10, color: crit ? [0xffffff, 0xffdd44, 0xff8a2a] : [0xffffff, 0xffd890], speed: [30, crit ? 110 : 70], life: [0.2, 0.45], size: [1, 2], drag: 3 });
    g.camera.shake(crit ? 3 : 1.5, crit ? 220 : 120); if (crit) g.hitStop(90);
    sfx(crit ? "crit_hit" : "hit", { volume: 0.8 });
  } else if (f.foe && t === "!") { /* 暴击标记：和数字一起处理 */ }
  else if (t === "x" && f.foe) sfx("miss", { volume: 0.6 });
  else if (t === "s") sfx("block", { volume: 0.6 });
  else if (!f.foe && /^-\d/.test(t)) { g.camera.shake(2.5, 200); Z.red.alpha = 0.22; shakeHurt = 0.35; sfx("hurt", { volume: 0.7 }); burst({ x: wx, y: wy, count: 8, color: [0xff5a4a, 0xaa2a2a], speed: [20, 50], life: [0.2, 0.4], size: [1, 2], gravity: 80 }); }
  else if (!f.foe && /^\+\d/.test(t)) { sfx("heal", { volume: 0.6 }); burst({ x: wx, y: wy, count: 12, color: [0x9aff8a, 0xffffff], speed: [8, 24], angle: [-120, -60], life: [0.6, 1], size: [1, 2], gravity: -20 }); }
  else if (t === "h") { sfx("block", { volume: 0.5 }); burst({ x: wx, y: wy, count: 14, color: [0xffd890, 0xffffff], speed: [20, 60], life: [0.3, 0.6], size: 1 }); }
}
// 飘字：每条 fx 只弹一次；骰子落定前先不弹（不剧透）
const seen = new Set();
function popups() {
  if (diceBusy()) return;
  const s = S.scene_fx || {};
  for (const f of s.fx || []) {
    if (!f.id || seen.has(f.id)) continue; seen.add(f.id);
    if (f.text === "v" || (f.text === "x" && !f.foe)) continue;   // 检定的对勾 / 叉由骰子动画表现
    impact(f);
    const at = (f.foe ? POS.foe : POS.hero) || POS.hero; if (!at) continue;
    const map = { x: T("未命中", "MISS"), s: T("闪开", "DODGE"), h: "⚒" };
    const el = document.createElement("div"); el.className = "pop out" + (/!$/.test(f.text) || f.color === "#ffdd44" ? " crit" : ""); el.textContent = map[f.text] || f.text; el.style.color = f.color || "#fff";
    if (map[f.text] && f.text !== "h") el.style.fontSize = "22px";
    el.style.left = `${at.x + (Math.random() - 0.5) * 30}px`; el.style.top = `${at.y - 20}px`;
    $("fx").append(el); setTimeout(() => el.remove(), 1100);
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
  if (pending) return; pending = true; msg = ""; sfx("click", { volume: 0.4 }); render();
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
    h("span", { class: "tip" }, h("b", { style: { color: RK[it.rk] } }, it.name), h("small", {}, `${it.rarity} · ${{ trinket: T("饰品", "Trinket"), consumable: T("消耗品（点击使用）", "Consumable (click to use)"), insight: T("旅途感悟", "Insight") }[it.kind]}`),
      h("span", {}, it.eff), it.curse ? h("span", { class: "cur" }, it.curse) : null, it.desc ? h("i", {}, it.desc) : null))));
}
// 这段旅程独有的玩法
function sysPanel(s) {
  const list = s.sys_ui || []; if (!list.length) return null;
  return h("div", { class: "syspanel" }, list.map((y) => h("div", { class: "sys out" + (y.off ? " off" : "") },
    h("div", { class: "shead", title: `${y.desc}\n\n${y.text}`, onclick: () => { sheet = "trip"; render(); } }, icon(y.icon), h("b", {}, y.name), h("em", {}, y.label || (y.val != null ? `${y.val}/${y.max}` : ""))),
    y.val != null ? h("div", { class: "sbar" }, h("i", { style: { width: `${(100 * y.val) / y.max}%` } })) : null,
    y.spends.length ? h("div", { class: "sbtns" }, y.spends.map((sp) => h("button", { class: "btn sbtn" + (sp.ok ? " ready" : ""), disabled: !sp.ok || busy(), title: `${sp.text}${sp.battle ? T("（战斗中）", " (in battle)") : ""}`, onclick: () => run("invoke", { id: sp.key }) }, sp.name))) : null)));
}
function resBar(s) {
  const r = s.res; if (!r || !r.k) return null;
  const name = { rage: T("怒气", "Rage"), combo: T("连击", "Combo"), mana: T("法力", "Mana"), faith: T("信仰", "Faith") }[r.k];
  return h("div", { class: "rbar out", title: { rage: T("命中 +1、挨打 +1、防御 +1，每场战斗清零", "+1 on hit, when hit or on Defend; resets each fight"), combo: T("命中 +1（暴击 +2），每场战斗清零", "+1 on hit (+2 on crit); resets each fight"), mana: T("每场战斗开始 +1；扎营补满", "+1 at the start of each fight; camping refills it"), faith: T("战斗中每回合 +1，每场至少 2", "+1 every combat turn, at least 2 per fight") }[r.k] },
    h("span", {}, name), h("span", { class: "pips" }, Array.from({ length: r.max }, (_, i) => h("i", { class: i < r.cur ? "on" : "", style: i < r.cur ? { background: RES_COLOR[r.k] } : null }))), h("em", {}, `${r.cur}/${r.max}`));
}
function banner(s) {
  return h("div", { class: "banner" },
    h("div", { class: "region serif out" }, T(...(BIOME[s.biome] || BIOME.plains))),
    h("div", { class: "mile out" }, icon("flag"), T(`第 ${s.distance || 0} 里`, `Mile ${s.distance || 0}`), h("span", { class: "path " + (s.path || "road") }, { road: T("大路", "Highway"), wilds: T("荒野", "Wilds"), shortcut: T("捷径", "Shortcut") }[s.path || "road"])),
    s.omen_ui && s.omen_ui.name ? h("div", { class: "omen out", title: `${s.omen_ui.desc}\n${s.omen_ui.text}` }, h("b", {}, s.omen_ui.name), " ", h("span", {}, (s.omen_ui.text || "").split("\n")[0])) : null,
    s.thread ? h("div", { class: "thread out", title: T("旅途主线", "The journey") }, h("b", {}, "❝ "), s.thread) : null);
}
const tags = (list) => h("div", { class: "tags" }, (list || []).map((t) => h("span", { class: `tag ${t.k}` }, t.t)));
function card(s) {
  if (s.phase === "battle" && s.ui_battle && s.ui_battle.foe) {
    const B = s.ui_battle, f = B.foe, pct = Math.max(0, (100 * f.hp) / f.max), it = f.intent || {};
    return h("div", { class: "paper card battle", key: "battle" }, h("span", { class: "kind" }, icon(f.boss ? "skull" : "sword"), f.boss ? T("守关者", "Warden") : T("战斗", "Battle")),
      h("h2", { class: "serif" }, f.name, f.trait ? h("span", { class: "trait", title: f.trait_desc }, f.trait) : null),
      f.trait_desc ? h("div", { class: "tdesc" }, f.trait_desc) : null,
      f.abil && f.abil.length ? h("div", { class: "abil" }, f.abil.map((a) => h("div", {}, a))) : null,
      h("div", { class: "bar hp foehp" }, h("i", { style: { width: `calc(${pct}% - 4px)` } }), h("b", { class: "out" }, `${f.hp} / ${f.max}`)),
      h("div", { class: "foemeta" }, h("span", {}, icon("shield"), `AC ${f.ac}`), f.block ? h("span", { class: "chip2 def" }, T(`格挡 ${f.block}`, `Block ${f.block}`)) : null,
        f.poison ? h("span", { class: "chip2 poi" }, T(`中毒 ${f.poison}`, `Poison ${f.poison}`)) : null, f.stun ? h("span", { class: "chip2 stun" }, T("眩晕", "Stunned")) : null, f.weak ? h("span", { class: "chip2 def" }, T(`被削弱 -${f.weak}`, `Weakened -${f.weak}`)) : null),
      h("div", { class: `intent ${it.k || "atk"}` }, h("small", {}, T("它的下一步", "Its next move")), h("div", {}, icon(it.icon || "sword", true), h("b", {}, it.text || ""))),
      h("div", { class: "mine" }, B.block ? h("span", { class: "chip2 def" }, icon("shield"), T(`你的格挡 ${B.block}`, `Your block ${B.block}`)) : null, B.evade ? h("span", { class: "chip2 def" }, icon("boot"), T("准备闪避", "Evading")) : null),
      h("div", { class: "hint" }, T("根据它的下一步决定：趁它防御时蓄资源，它蓄力时防御或打断。", "Read its next move: build resources while it guards, block or interrupt when it charges.")));
  }
  const ui = s.ui_card || { mode: "none" };
  if (ui.mode === "none") return s.last_result && s.phase === "none" && s.hp > 0 ? h("div", { class: "paper card", key: "result" }, h("span", { class: "kind" }, T("结果", "Outcome")), resultBox(s.last_result), h("small", { style: { color: "#7a6040" } }, T("按空格继续上路", "Press Space to walk on"))) : null;
  return h("div", { class: "paper card" + (ui.mode === "shop" ? " shop" : "") },
    h("span", { class: "kind" }, ui.kind || ""),
    h("h2", { class: "serif" }, ui.title || ""),
    h("p", { class: "text" + (ui.mode === "loading" ? " loading" : "") }, ui.text || ""),
    s.last_result && s.phase === "card" ? resultBox(s.last_result) : null,
    ui.input ? actBox(ui.input) : null,
    h("div", { class: "opts" + (ui.input ? " small" : "") }, (ui.items || []).map((it, i) => h("button", { class: "btn pape opt", disabled: !!it.disabled || busy(), onclick: () => run(ui.action, { id: it.id }) },
      icon(it.icon || "dice", true), h("span", { class: "label" }, ui.mode === "card" && i < 9 ? `${i + 1}. ${it.text}` : it.text), it.tags && it.tags.length ? tags(it.tags) : h("span", { class: "sub" }, it.sub || "")))));
}
// 自由行动：输入框 + 灵感
let draft = "", draftFocus = false;
function actBox(inp) {
  const send = () => { const t = draft.trim(); if (!t || inp.busy) return; draft = ""; run(inp.act, { text: t }); };
  const ta = h("textarea", { class: "actin", id: "actin", rows: 2, maxlength: 120, placeholder: inp.hint, disabled: inp.busy || busy(),
    oninput: (e) => { draft = e.target.value; }, onfocus: () => { draftFocus = true; }, onblur: () => { draftFocus = false; },
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } } });
  ta.value = inp.busy ? inp.last : draft;
  return h("div", { class: "actbox" },
    h("div", { class: "actrow" }, ta, h("button", { class: "btn gold act send", disabled: inp.busy || busy(), onclick: send }, inp.busy ? T("……", "…") : T("行动", "Act"), h("span", { class: "key" }, T(`第 ${inp.step}/${inp.max} 步 · 回车`, `step ${inp.step}/${inp.max} · Enter`)))),
    inp.busy ? h("div", { class: "judging loading" }, T("命运正在揭晓", "Fate is deciding")) : null,
    inp.stale ? h("div", { class: "judging bad" }, T("什么也没有发生。再试一次，或者换个做法。", "Nothing happens. Try again, or try something else.")) : null,
    inp.ideas && inp.ideas.length && !inp.busy ? h("div", { class: "ideas" }, h("small", {}, T("灵感：", "Ideas: ")), inp.ideas.map((t) => h("button", { class: "idea", onclick: () => { draft = t; render(); setTimeout(() => { const el = document.getElementById("actin"); if (el) { el.focus(); el.setSelectionRange(t.length, t.length); } }, 0); } }, t))) : null);
}
// ================= 掷骰动画 =================
// 骰子从主角手里抛出，划一道弧线落在画面中央，弹两下停住；落定后点数放大，依次显示加值、总计和 DC，
// 最后盖上成败印章（20 金光四射，1 裂开变红）。整段动画结束前，画面上所有数值都保持掷骰前的样子。
let diceSeen = null, diceUntil = 0, diceTimers = [], frozen = null;
const diceBox = document.createElement("div"); diceBox.id = "dice"; $("game").append(diceBox);
diceBox.addEventListener("click", () => endDice());
const DICE_FLY = 1250, DICE_REVEAL = 260, DICE_STAMP = 900, DICE_HOLD = 1500;
function diceBusy() { return Date.now() < diceUntil; }
function viewState() { return diceBusy() && frozen ? frozen : S; }
function endDice() { diceTimers.forEach(clearTimeout); diceTimers = []; diceBox.className = ""; diceBox.replaceChildren(); if (diceUntil) { diceUntil = 0; frozen = null; render(); } }
const FACETS = [
  ["4,26 50,0 50,24", 0.86], ["50,0 96,26 50,24", 0.72], ["4,26 50,24 18,80", 0.62], ["96,26 82,80 50,24", 0.48], ["4,26 18,80 4,86", 0.4], ["96,26 96,86 82,80", 0.3],
  ["18,80 82,80 50,112", 0.36], ["4,86 18,80 50,112", 0.28], ["96,86 50,112 82,80", 0.22], ["50,24 82,80 18,80", 1],
];
function d20svg() {
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "-2 -2 104 116"); svg.setAttribute("class", "d20svg");
  for (const [pts, k] of FACETS) { const pg = document.createElementNS(NS, "polygon"); pg.setAttribute("points", pts); pg.setAttribute("class", "facet"); pg.style.setProperty("--k", k); svg.append(pg); }
  const out = document.createElementNS(NS, "polygon"); out.setAttribute("points", "50,0 96,26 96,86 50,112 4,86 4,26"); out.setAttribute("class", "rim"); svg.append(out);
  const crack = document.createElementNS(NS, "polyline"); crack.setAttribute("points", "30,10 44,40 36,56 54,74 48,100"); crack.setAttribute("class", "crack"); svg.append(crack);
  return svg;
}
function playDice(d) {
  diceTimers.forEach(clearTimeout); diceTimers = [];
  const vr = $("view").getBoundingClientRect(), portrait = vr.height < innerHeight * 0.6;
  const land = { x: vr.width * (portrait ? 0.5 : 0.46), y: vr.height * (portrait ? 0.5 : 0.42) };
  const from = POS.hero ? { x: POS.hero.x + 10, y: POS.hero.y + 10 } : { x: land.x - 260, y: land.y + 60 };
  const size = Math.max(84, Math.min(150, vr.height * 0.17));
  const num = h("b", { class: "dnum" }, "?");
  const die = h("div", { class: "d20 spin", style: { width: `${size}px`, height: `${size * 1.12}px`, fontSize: `${size * 0.36}px` } }, d20svg(), num);
  const wrap = h("div", { class: "dwrap" }, h("div", { class: "drays" }), die);
  const shadow = h("div", { class: "dshadow", style: { width: `${size * 0.9}px` } });
  const label = h("div", { class: "dlabel out" }, d.label || "");
  const math = h("div", { class: "dmath out" });
  const stamp = h("div", { class: "dstamp" });
  const panel = h("div", { class: "dpanel", style: { left: `${land.x}px`, top: `${land.y + size * 0.62}px` } }, math, stamp);
  label.style.left = `${land.x}px`; label.style.top = `${land.y - size * 0.95}px`;
  diceBox.replaceChildren(shadow, wrap, label, panel);
  diceBox.className = "show";
  diceUntil = Date.now() + DICE_FLY + DICE_STAMP + 120;
  sfx("dice_roll", { volume: 0.9 });
  // 弧线 + 两次弹跳（Web Animations）
  const P = (k, x, y, sc) => ({ offset: k, transform: `translate(${x - size / 2}px, ${y - size * 0.56}px) scale(${sc})` });
  const mid = { x: (from.x + land.x) / 2, y: Math.min(from.y, land.y) - vr.height * 0.28 };
  wrap.animate([P(0, from.x, from.y, 0.35), P(0.33, mid.x, mid.y, 0.85), P(0.62, land.x, land.y, 1), P(0.74, land.x + 10, land.y - size * 0.32, 1), P(0.86, land.x + 14, land.y, 1), P(0.93, land.x + 16, land.y - size * 0.1, 1), P(1, land.x + 17, land.y, 1)],
    { duration: DICE_FLY, easing: "linear", fill: "forwards" });
  const groundY = land.y + size * 0.5;
  shadow.animate([{ offset: 0, transform: `translate(${from.x - size * 0.45}px, ${groundY}px) scale(.2)`, opacity: 0 }, { offset: 0.33, transform: `translate(${mid.x - size * 0.45}px, ${groundY}px) scale(.45)`, opacity: 0.25 },
    { offset: 0.62, transform: `translate(${land.x - size * 0.45}px, ${groundY}px) scale(1)`, opacity: 0.6 }, { offset: 0.74, transform: `translate(${land.x + 10 - size * 0.45}px, ${groundY}px) scale(.7)`, opacity: 0.4 },
    { offset: 1, transform: `translate(${land.x + 17 - size * 0.45}px, ${groundY}px) scale(1)`, opacity: 0.6 }], { duration: DICE_FLY, fill: "forwards" });
  // 数字乱跳，越来越慢
  let n = 0, stopped = false; const tumble = () => { if (stopped) return; num.textContent = String(1 + Math.floor(Math.random() * 20)); die.style.setProperty("--shade", String(0.7 + Math.random() * 0.3)); n++; const k = n / 22; if (k < 1) diceTimers.push(setTimeout(tumble, 26 + 70 * k * k)); };
  tumble();
  const landed = (k, power) => diceTimers.push(setTimeout(() => {
    sfx("dice_land", { volume: power, rate: 1 + (1 - power) * 0.3 });
    try { Z.game.camera.shake(power * 2, 120); const g = Z.game; burst({ x: (land.x + (k > 0.7 ? 14 : 0)) / g.scale - g.world.x, y: groundY / g.scale - g.world.y, count: Math.round(10 * power), color: [0xd8c8a8, 0xa89878], speed: [10, 40], angle: [180, 360], life: [0.3, 0.6], size: [1, 2], gravity: 40 }); } catch (e) {}
  }, DICE_FLY * k));
  landed(0.62, 1); landed(0.86, 0.5);
  // 落定
  diceTimers.push(setTimeout(() => {
    stopped = true; num.textContent = String(d.nat);
    die.className = "d20 landed" + (d.nat === 20 ? " crit" : d.nat === 1 ? " fumble" : "");
    if (d.nat === 20) { wrap.classList.add("crit"); sparkles(wrap, size); }
    diceTimers.push(setTimeout(() => {
      const sign = d.mod >= 0 ? "+" : "−";
      math.replaceChildren(h("span", { class: "m1" }, `d20 ${d.nat}`), d.mod ? h("span", { class: "m2" }, `${sign} ${Math.abs(d.mod)}`) : null, h("span", { class: "m3" }, "= ", h("b", {}, String(d.total))),
        h("span", { class: "m4" + (d.ok ? " ok" : " no") }, `${d.total >= d.dc ? "≥" : "<"} DC ${d.dc}`));
      math.classList.add("on");
    }, DICE_REVEAL));
    diceTimers.push(setTimeout(() => {
      stamp.textContent = d.nat === 20 ? T("大成功！", "CRITICAL!") : d.nat === 1 ? T("大失败", "FUMBLE") : d.ok ? T("成功", "SUCCESS") : T("失败", "FAILURE");
      stamp.className = "dstamp on " + (d.ok ? "ok" : "no") + (d.nat === 20 ? " crit" : d.nat === 1 ? " fumble" : "");
      sfx(d.nat === 20 ? "crit" : d.nat === 1 ? "fumble" : d.ok ? "success" : "fail", { volume: 0.9 });
      try { Z.game.camera.shake(d.ok ? 1.5 : 2.5, 160); } catch (e) {}
    }, DICE_STAMP - 120));
    diceTimers.push(setTimeout(() => { frozen = null; render(); }, DICE_STAMP + 140));
    diceTimers.push(setTimeout(() => { diceBox.className = "show fade"; }, DICE_STAMP + DICE_HOLD));
    diceTimers.push(setTimeout(() => { diceBox.className = ""; diceBox.replaceChildren(); }, DICE_STAMP + DICE_HOLD + 450));
  }, DICE_FLY));
}
function sparkles(el, size) {
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3, r = size * (0.8 + Math.random() * 0.7);
    const sp = h("i", { class: "spark", style: { left: `${size / 2}px`, top: `${size * 0.56}px`, "--dx": `${Math.cos(a) * r}px`, "--dy": `${Math.sin(a) * r}px`, animationDelay: `${Math.random() * 120}ms` } });
    el.append(sp);
  }
}
// 声音：按画面上看到的状态变化触发（骰子落定前画面是冻结的，所以声音也会等骰子）
function cues(a, b) {
  if (!a || !b || a === b) return;
  if ((b.gold || 0) > (a.gold || 0)) sfx("coin", { volume: 0.55 });
  if ((b.level || 1) > (a.level || 1)) sfx("levelup", { volume: 0.8 });
  if (b.phase === "battle" && a.phase !== "battle") sfx("battle", { volume: 0.7 });
  if (a.phase === "battle" && b.phase !== "battle" && (a.foe || {}).hp > 0 && b.hp > 0 && (b.kills || 0) > (a.kills || 0)) sfx("victory", { volume: 0.8 });
  if ((b.toast || {}).n && (b.toast || {}).n !== (a.toast || {}).n) sfx("item", { volume: 0.7 });
  if (b.camped && !a.camped) sfx("camp", { volume: 0.7 });
  if (b.hp <= 0 && a.hp > 0) { sfx("death", { volume: 0.9 }); music(false); }
  const ta = (a.ui_card || {}).title, tb = (b.ui_card || {}).title;
  if (tb && tb !== ta && (b.ui_card || {}).mode === "card") sfx("card", { volume: 0.5 });
  if ((b.res || {}).cur < (a.res || {}).cur && b.phase === "battle") sfx("magic", { volume: 0.6 });
}
function resultBox(r) {
  return h("div", { class: "result " + (r.good === true ? "good" : r.good === false ? "bad" : "info") },
    h("div", { class: "you" }, `➤ ${r.text}`),
    r.ruling ? h("div", { class: "ruling" }, r.ruling) : null,
    r.roll ? h("div", { class: "roll" }, r.roll) : null,
    r.narr ? h("div", { class: "narr" }, r.narr) : null,
    r.out ? h("div", { class: "outc" }, (r.good ? "✔ " : r.good === false ? "✘ " : "") + r.out) : null);
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
  let all = s.journal || [];
  const lines = all.slice(journalOpen ? -60 : -7);
  return h("div", { class: "journal" + (journalOpen ? " open" : ""), title: T("点击展开 / 收起日志", "Click to expand / collapse"), onclick: () => { journalOpen = !journalOpen; render(); } }, lines.map((l) => h("div", { class: "out" + (l.charCodeAt(0) === 0x200b ? " ai" : "") }, l)));
}
function menu(s) {
  return h("div", { class: "menu" }, [["char", "person", T("角色", "Hero")], ["pack", "pack", T("行囊", "Pack")], ["relic", "gem", T("道具", "Items")], ["trip", "map", T("世界", "World")], ["log", "scroll", T("日志", "Log")]].map(([id, ic, label]) =>
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
        h("div", {}, h("b", { style: { color: RK[it.rk] } }, it.name), h("small", {}, `${it.rarity} · ${it.eff}`), it.curse ? h("small", { style: { color: "#ff9a7a" } }, it.curse) : null, it.desc ? h("small", { style: { fontStyle: "italic" } }, it.desc) : null))),
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
    ...((s.sys_ui || []).length ? [h("h3", { class: "serif", style: { marginTop: "14px" } }, T("这段旅程的羁绊", "Bonds of this journey")),
      ...(s.sys_ui || []).map((y) => h("div", { class: "slot", style: { gridTemplateColumns: "40px 1fr" } }, icon(y.icon, true), h("div", {}, h("b", {}, `${y.name}${y.label ? " · " + y.label : ""}`), h("small", { style: { fontStyle: "italic" } }, y.desc), h("small", { style: { whiteSpace: "pre-line" } }, y.text))))] : []),
    h("h3", { class: "serif", style: { marginTop: "14px" } }, T(`旅途见闻（${(s.made || []).length}）· 图鉴共 ${s.codex_n || 0} 种`, `Seen on this journey (${(s.made || []).length}) · ${s.codex_n || 0} in your codex`)),
    s.thread ? h("p", { style: { fontStyle: "italic", color: "#f0dcb0" } }, s.thread) : null,
    ...(s.made || []).slice().reverse().map((m) => h("div", { class: "row" }, icon(m.t === "foe" ? "skull" : m.t === "insight" ? "scroll" : "gem"), h("div", { class: "grow" }, h("b", {}, m.n), h("div", { style: { fontSize: "12.5px", color: "#d0bc96" } }, m.e), m.d ? h("div", { style: { fontSize: "12.5px", color: "#a89878", fontStyle: "italic" } }, m.d) : null))),
    (s.made || []).length ? null : h("p", { style: { color: "#9c8c70" } }, T("（一路上遇到的奇物、怪物和感悟会记在这里）", "(Curiosities, creatures and insights you meet will be recorded here)"))];
}
function modal(s) {
  if (!sheet) return null;
  const tabs = [["char", "person", T("角色", "Hero")], ["pack", "pack", T("行囊", "Pack")], ["relic", "gem", T("道具", "Items")], ["trip", "map", T("世界", "World")]];
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
  if (t.n !== toastSeen) { toastSeen = t.n; toastUntil = Date.now() + 5200; setTimeout(render, 5300); }
  if (Date.now() > toastUntil) return null;
  return h("div", { class: "toast wood", style: { borderColor: RK[t.rk] } }, h("small", {}, t.head || T("获得了新的东西", "You found something new"), " · ", h("b", { style: { color: RK[t.rk] } }, t.rarity)),
    h("h3", { class: "serif" }, t.title), h("div", { class: "eff" }, t.eff), t.curse ? h("div", { class: "cur" }, t.curse) : null, t.desc ? h("p", {}, t.desc) : null);
}
let lastShown = null;
function render() {
  const s = viewState();
  cues(lastShown, s); lastShown = s;
  const ui = $("ui");
  const cardKey = s.phase === "battle" ? "battle" : JSON.stringify([(s.ui_card || {}).mode, (s.ui_card || {}).title, s.phase === "none" && !!s.last_result]);
  const kids = [hud(s), banner(s), journal(s), actions(s), menu(s), h("div", { class: "msg out" }, msg)];
  const ib = itemBar(s); if (ib) kids.push(ib);
  const sp = sysPanel(s); if (sp) kids.push(sp);
  const t = toastEl(s); if (t) kids.push(t);
  const c = card(s); if (c) { if (cardKey === lastCardKey) c.style.animation = "none"; kids.push(c); }
  lastCardKey = cardKey;
  if (s.phase === "class") kids.push(title(s));
  if (s.hp <= 0 && s.phase !== "class") kids.push(ending(s));
  const m = modal(s); if (m) kids.push(m);
  ui.replaceChildren(...kids);
  if (draftFocus) { const el = document.getElementById("actin"); if (el && !el.disabled) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
  popups();
}
// 键盘：空格主操作，1–9 选项，Q 药水，C 扎营，F 逃跑，Esc 关闭弹窗
addEventListener("keydown", (e) => {
  if (e.repeat) return; const s = S;
  if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) return;
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
oasis.ready.then((o) => { S = o.state || {}; diceSeen = (S.dice_fx || {}).id || 0; render(); initScene(); });
oasis.onState((s, ch) => {
  const prev = S; S = s;
  const d = s.dice_fx || {};
  if (diceSeen === null) diceSeen = d.id || 0;
  else if (d.id && d.id !== diceSeen) { diceSeen = d.id; frozen = prev; playDice(d); }   // 新的掷骰：画面停在掷骰前，等骰子落定
  // 只有动画状态变了时不重建界面（20 次/秒），只处理飘字
  if (ch && ch.length === 1 && ch[0] === "scene_fx") { popups(); return; }
  render();
});
})();
