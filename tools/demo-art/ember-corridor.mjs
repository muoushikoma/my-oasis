// 生成示例故事《余烬回廊》的原创像素素材（PNG）和音效（WAV）。全部用代码画/合成，没有外部素材。
// 用法：node tools/demo-art/ember-corridor.mjs  → 写到 examples/ember-corridor/game/
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const OUT = fileURLToPath(new URL("../../examples/ember-corridor/game/", import.meta.url));
mkdirSync(OUT + "art", { recursive: true }); mkdirSync(OUT + "sfx", { recursive: true });

// ---------- PNG ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); }
function png(img) {
  const { w, h, px } = img, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const canvas = (w, h) => ({ w, h, px: Buffer.alloc(w * h * 4) });
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
function set(img, x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= img.w || y >= img.h || !c) return; const i = (y * img.w + x) * 4; const [r, g, b, a] = typeof c === "string" ? hex(c) : c; img.px[i] = r; img.px[i + 1] = g; img.px[i + 2] = b; img.px[i + 3] = a; }
const get = (img, x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? 0 : img.px[(y * img.w + x) * 4 + 3]);
function rect(img, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(img, x + i, y + j, c); }
function line(img, x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (let i = 0; i <= n; i++) set(img, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c); }
function ellipse(img, cx, cy, rx, ry, c) { for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x - cx + 0.5) / rx) ** 2 + ((y - cy + 0.5) / ry) ** 2 <= 1) set(img, x, y, c); }
/** 给一块区域里的图案描黑边（像素风的灵魂） */
function outline(img, x0, y0, w, h, c = "#140c1c") {
  const add = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (!get(img, x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= x0 && ny >= y0 && nx < x0 + w && ny < y0 + h && get(img, nx, ny); })) add.push([x, y]);
  for (const [x, y] of add) set(img, x, y, c);
}
function blit(dst, src, ox, oy, flip = false) { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const i = (y * src.w + (flip ? src.w - 1 - x : x)) * 4; if (src.px[i + 3]) set(dst, ox + x, oy + y, [src.px[i], src.px[i + 1], src.px[i + 2], src.px[i + 3]]); } }
const save = (name, img) => writeFileSync(OUT + "art/" + name, png(img));

// ---------- 主角：守火骑士（32×24 一帧，脚在 y=23，身体中心 x=12，面朝右） ----------
const P = { armor: "#9fb4c8", armorD: "#5d6f86", armorL: "#d8e4ee", cape: "#c23a3a", capeD: "#7c2030", skin: "#f2c79b", visor: "#2a1e3a", sword: "#eef2f8", swordD: "#9aa6b8", hilt: "#d9a83a", slash: "#fff4c0", slash2: "#ffb347" };
function hero({ leg = 0, bob = 0, cape = 0, sword = "down", hurt = false, dead = false, arc = 0 }) {
  const f = canvas(32, 24), y0 = bob;
  if (dead) {
    rect(f, 6, 19, 14, 4, P.armorD); rect(f, 7, 19, 12, 2, P.armor); rect(f, 18, 18, 5, 5, P.armor); rect(f, 20, 19, 2, 2, P.visor); rect(f, 4, 21, 6, 2, P.cape); line(f, 22, 22, 30, 22, P.swordD);
    outline(f, 0, 0, 32, 24); return f;
  }
  // 披风
  rect(f, 8 - cape, 12 + y0, 3, 7 + (cape ? 0 : 1), P.cape); rect(f, 7 - cape, 17 + y0, 2, 2, P.capeD);
  // 腿
  const l1 = leg === 1 ? -2 : leg === 2 ? 1 : leg === 3 ? 2 : 0, l2 = -l1;
  rect(f, 10 + l1, 18, 2, 5, P.armorD); rect(f, 13 + l2, 18, 2, 5, P.armorD);
  rect(f, 10 + l1, 22, 3, 1, P.visor); rect(f, 13 + l2, 22, 3, 1, P.visor);
  // 身体
  rect(f, 10, 12 + y0, 6, 6, P.armor); rect(f, 10, 16 + y0, 6, 1, P.armorD); rect(f, 11, 13 + y0, 2, 2, P.armorL); rect(f, 12, 15 + y0, 3, 1, P.hilt);
  // 头盔
  rect(f, 10, 6 + y0, 6, 6, P.armor); rect(f, 10, 6 + y0, 6, 1, P.armorL); rect(f, 13, 8 + y0, 3, 2, P.visor); set(f, 15, 8 + y0, "#ffd36e"); rect(f, 11, 4 + y0, 2, 2, P.cape); set(f, 12, 3 + y0, P.cape);
  // 手臂 + 剑
  if (sword === "down") { rect(f, 15, 13 + y0, 2, 3, P.armorD); rect(f, 16, 15 + y0, 2, 1, P.hilt); line(f, 17, 16 + y0, 17, 21 + y0, P.sword); }
  else if (sword === "up") { rect(f, 15, 10 + y0, 2, 3, P.armorD); rect(f, 15, 9 + y0, 3, 1, P.hilt); line(f, 14, 8 + y0, 9, 2 + y0, P.sword); line(f, 15, 8 + y0, 10, 2 + y0, P.swordD); }
  else if (sword === "front") { rect(f, 15, 13 + y0, 3, 2, P.armorD); rect(f, 18, 12 + y0, 1, 4, P.hilt); line(f, 19, 13 + y0, 29, 13 + y0, P.sword); line(f, 19, 14 + y0, 28, 14 + y0, P.swordD); }
  else if (sword === "low") { rect(f, 15, 14 + y0, 2, 3, P.armorD); rect(f, 17, 16 + y0, 1, 2, P.hilt); line(f, 18, 18 + y0, 25, 22, P.sword); }
  outline(f, 0, 0, 32, 24);
  // 刀光（不描边）
  if (arc) for (let a = -60; a <= 60; a += 4) { const r = 13 + (arc > 1 ? 1 : 0), rad = (a * Math.PI) / 180; set(f, 17 + Math.cos(rad) * r, 13 + y0 + Math.sin(rad) * r, a % 8 ? P.slash : P.slash2); set(f, 17 + Math.cos(rad) * (r - 1), 13 + y0 + Math.sin(rad) * (r - 1), arc > 1 ? P.slash2 : P.slash); }
  if (hurt) for (let i = 0; i < f.px.length; i += 4) if (f.px[i + 3]) { f.px[i] = Math.min(255, f.px[i] + 90); f.px[i + 1] = f.px[i + 1] * 0.6; f.px[i + 2] = f.px[i + 2] * 0.6; }
  return f;
}
const heroFrames = [
  hero({}), hero({ bob: 1, cape: 1 }),                                              // 0-1 idle
  hero({ leg: 1, cape: 1 }), hero({ leg: 2, bob: 1 }), hero({ leg: 3, cape: 1 }), hero({ leg: 2, bob: 1 }), // 2-5 run
  hero({ leg: 1, cape: 1, sword: "up" }), hero({ leg: 3, sword: "low" }),           // 6 jump, 7 fall
  hero({ sword: "up" }), hero({ sword: "front", arc: 1 }), hero({ sword: "front", arc: 2 }), hero({ sword: "low" }), // 8-11 attack
  hero({ hurt: true, bob: 1 }), hero({ dead: true }),                               // 12 hurt, 13 dead
];
{ const s = canvas(32 * 8, 24 * 2); heroFrames.forEach((f, i) => blit(s, f, (i % 8) * 32, Math.floor(i / 8) * 24)); save("hero.png", s); }

// ---------- 敌人 ----------
function slime(squash, hurt = false, splat = 0) {
  const f = canvas(16, 16), body = hurt ? "#ffffff" : "#5fcf6a", dark = hurt ? "#dddddd" : "#2f8a4a", light = hurt ? "#ffffff" : "#b6f5a6";
  if (splat) { ellipse(f, 8, 14.5, 7 + splat, 2, body); rect(f, 2, 15, 12, 1, dark); outline(f, 0, 0, 16, 16); return f; }
  const ry = 5 - squash, rx = 6 + squash, cy = 15 - ry;
  ellipse(f, 8, cy, rx, ry, body); for (let x = 2; x < 14; x++) if (get(f, x, 15)) set(f, x, 15, dark);
  rect(f, 5, cy - ry + 2, 2, 1, light); set(f, 4, cy - ry + 3, light);
  rect(f, 6, cy, 1, 2, "#140c1c"); rect(f, 10, cy, 1, 2, "#140c1c");
  outline(f, 0, 0, 16, 16); return f;
}
const slimeFrames = [slime(0), slime(1), slime(-1), slime(-2), slime(0, true), slime(0, false, 1), slime(0, false, 2)];
{ const s = canvas(16 * 7, 16); slimeFrames.forEach((f, i) => blit(s, f, i * 16, 0)); save("slime.png", s); }

function bat(wing, hurt = false) {
  const f = canvas(16, 16), body = hurt ? "#ffffff" : "#6b4c9a", wingC = hurt ? "#eeeeee" : "#3d2a63";
  ellipse(f, 8, 8, 3, 3, body); rect(f, 6, 4, 1, 2, body); rect(f, 9, 4, 1, 2, body);
  const wy = wing === 0 ? -3 : wing === 1 ? 0 : 2;
  for (let i = 0; i < 5; i++) { line(f, 5, 8, 1, 8 + wy + (i % 2), wingC); line(f, 10, 8, 14, 8 + wy + (i % 2), wingC); }
  line(f, 5, 7, 1, 7 + wy, wingC); line(f, 10, 7, 14, 7 + wy, wingC);
  set(f, 7, 8, "#ff5050"); set(f, 9, 8, "#ff5050"); set(f, 8, 10, "#f0f0f0");
  outline(f, 0, 0, 16, 16); return f;
}
const batFrames = [bat(0), bat(1), bat(2), bat(1), bat(1, true)];
{ const s = canvas(16 * 5, 16); batFrames.forEach((f, i) => blit(s, f, i * 16, 0)); save("bat.png", s); }

// ---------- 地形：16×16 图块 ----------
function noise(x, y, s = 1) { const n = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return n - Math.floor(n); }
{
  const t = canvas(16 * 4, 16);
  // 0 地面顶（青苔砖） 1 地面砖 2 平台 3 背景墙砖
  const brick = (ox, top, c1, c2, c3) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const row = Math.floor(y / 4), off = row % 2 ? 4 : 0, edge = y % 4 === 3 || (x + off) % 8 === 7; set(t, ox + x, y, edge ? c3 : noise(x, y, ox) > 0.8 ? c2 : c1); } if (top) { rect(t, ox, 0, 16, 3, "#4f8a3a"); for (let x = 0; x < 16; x++) if (noise(x, 0, ox) > 0.5) set(t, ox + x, 3, "#3a6a2c"); rect(t, ox, 0, 16, 1, "#8fd06a"); } };
  brick(0, true, "#6b5b73", "#7d6c86", "#3b2f45"); brick(16, false, "#5a4b62", "#685870", "#33283d");
  brick(32, false, "#8a6a4a", "#9a7a56", "#4a3424"); rect(t, 32, 0, 16, 2, "#c99a5a"); rect(t, 32, 8, 16, 8, [0, 0, 0, 0]); rect(t, 32, 7, 16, 1, "#2a1a14");
  brick(48, false, "#2a2236", "#30283e", "#1c1626");
  save("tiles.png", t);
}
// 火把（两帧）和背景
{
  const t = canvas(16 * 2, 16);
  for (let i = 0; i < 2; i++) { rect(t, i * 16 + 7, 8, 2, 7, "#5a3a24"); rect(t, i * 16 + 6, 7, 4, 2, "#8a6a4a"); ellipse(t, i * 16 + 8, 4 + i, 2.5, 3.5 - i * 0.5, "#ff8a2a"); ellipse(t, i * 16 + 8, 5 + i, 1.5, 2, "#ffe07a"); }
  outline(t, 0, 0, 32, 16); save("torch.png", t);
}
{
  const W = 480, H = 216, b = canvas(W, H);
  for (let y = 0; y < H; y++) { const k = y / H; const c = [Math.round(28 + 40 * k), Math.round(18 + 14 * k), Math.round(44 + 10 * k), 255]; rect(b, 0, y, W, 1, c); }
  // 远处的月亮和废墟剪影
  ellipse(b, 380, 46, 18, 18, "#f5d9a8"); ellipse(b, 386, 42, 15, 15, [60, 36, 70, 255]);
  for (let x = 0; x < W; x++) { const hgt = 60 + Math.round(30 * Math.sin(x / 37) + 18 * Math.sin(x / 13 + 1)); for (let y = H - hgt; y < H; y++) set(b, x, y, "#2b1d3d"); }
  for (let i = 0; i < 7; i++) { const x = 20 + i * 68, w = 18, hgt = 90 + (i % 3) * 18; rect(b, x, H - hgt, w, hgt, "#22172f"); rect(b, x - 3, H - hgt, w + 6, 5, "#22172f"); for (let y = H - hgt + 12; y < H - 20; y += 16) rect(b, x + 7, y, 4, 7, "#ffb347"); }
  for (let i = 0; i < 60; i++) set(b, (noise(i, 1) * W) | 0, (noise(i, 2) * 90) | 0, noise(i, 3) > 0.5 ? "#ffffff" : "#c9b8ff");
  save("backdrop.png", b);
}
// ---------- 界面：九宫格面板、心、标题徽记 ----------
{
  const p = canvas(16, 16);
  rect(p, 0, 0, 16, 16, "#140c1c"); rect(p, 1, 1, 14, 14, "#d9a83a"); rect(p, 2, 2, 12, 12, "#7a5420"); rect(p, 3, 3, 10, 10, "#1e1830"); rect(p, 3, 3, 10, 1, "#2c2446");
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) set(p, x, y, "#fff0b0");
  save("panel.png", p);
}
{
  const h = canvas(9 * 3, 8);
  const heart = (ox, fill) => { const shape = ["01100110", "11111111", "11111111", "11111111", "01111110", "00111100", "00011000", "00000000"]; shape.forEach((r, y) => [...r].forEach((v, x) => { if (v === "1") set(h, ox + x, y, fill === 2 || (fill === 1 && x < 4) ? (y < 2 && x > 0 && x < 3 ? "#ffb0b0" : "#e0434b") : "#3a1f2b"); })); };
  heart(0, 2); heart(9, 1); heart(18, 0); outline(h, 0, 0, 27, 8); save("hearts.png", h);
}

// ---------- 音效（8 位风格合成，WAV 22050Hz 16 位单声道） ----------
const SR = 22050;
function wav(samples) { const d = Buffer.alloc(44 + samples.length * 2); d.write("RIFF", 0); d.writeUInt32LE(36 + samples.length * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(SR, 24); d.writeUInt32LE(SR * 2, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(samples.length * 2, 40); samples.forEach((s, i) => d.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32000 | 0, 44 + i * 2)); return d; }
function synth(sec, fn) { const n = Math.round(sec * SR), out = new Array(n); let ph = 0, seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1; for (let i = 0; i < n; i++) { const t = i / SR, k = t / sec; const { f = 0, v = 0, wave = "sq", duty = 0.5 } = fn(t, k); ph = (ph + f / SR) % 1; out[i] = (wave === "noise" ? rnd() : wave === "tri" ? 1 - 4 * Math.abs(ph - 0.5) : ph < duty ? 1 : -1) * v; } return out; }
const sfx = (name, s) => writeFileSync(OUT + "sfx/" + name, wav(s));
sfx("jump.wav", synth(0.16, (t, k) => ({ f: 300 + 500 * k, v: 0.25 * (1 - k), duty: 0.25 })));
sfx("slash.wav", synth(0.14, (t, k) => ({ wave: "noise", v: 0.35 * (1 - k) ** 2 })));
sfx("hit.wav", synth(0.12, (t, k) => (k < 0.3 ? { wave: "noise", v: 0.5 * (1 - k) } : { f: 120 - 60 * k, v: 0.4 * (1 - k) }))); 
sfx("hurt.wav", synth(0.3, (t, k) => ({ f: 520 - 400 * k, v: 0.3 * (1 - k), duty: 0.3 })));
sfx("pop.wav", synth(0.25, (t, k) => (k < 0.5 ? { f: 700 - 600 * k, v: 0.3 * (1 - k), duty: 0.5 } : { wave: "noise", v: 0.2 * (1 - k) })));
sfx("clear.wav", synth(0.6, (t) => ({ f: [523, 659, 784, 1046][Math.min(3, Math.floor(t / 0.12))], v: 0.22, duty: 0.25 })));
{
  // 背景乐：8 小节小调循环（方波旋律 + 三角波低音）
  const bpm = 132, beat = 60 / bpm, bars = 8, sec = bars * 4 * beat;
  const mel = [69, 72, 76, 72, 74, 72, 71, 67, 69, 72, 76, 79, 77, 76, 74, 72, 69, 72, 76, 72, 74, 76, 77, 79, 81, 79, 77, 76, 74, 71, 69, -1];
  const bass = [45, 45, 41, 41, 43, 43, 40, 40];
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
  const n = Math.round(sec * SR), out = new Array(n).fill(0); let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, b = t / beat, step = Math.floor(b), m = mel[step % mel.length], frac = b - step;
    if (m > 0) { p1 = (p1 + mtof(m) / SR) % 1; out[i] += (p1 < 0.25 ? 1 : -1) * 0.09 * Math.max(0, 1 - frac * 0.9); }
    const bn = bass[Math.floor(b / 4) % bass.length]; p2 = (p2 + mtof(bn) / SR) % 1; out[i] += (1 - 4 * Math.abs(p2 - 0.5)) * 0.14 * (frac < 0.5 ? 1 : 0.6);
    if (frac < 0.05 && step % 2 === 0) out[i] += (Math.random() * 2 - 1) * 0.06 * (1 - frac / 0.05);
  }
  sfx("music.wav", out);
}
console.log("已生成到", OUT);
