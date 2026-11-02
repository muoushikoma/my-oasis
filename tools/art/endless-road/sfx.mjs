// 《无尽之路》的原创音效和背景音乐：全部用代码合成（WAV，22.05 kHz 单声道），没有外部素材。
// 用法：node tools/art/endless-road/sfx.mjs  → 写到 stories/endless-road/assets/sfx/
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const OUT = fileURLToPath(new URL("../../../stories/endless-road/assets/sfx/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const SR = 22050;
function wav(s) {
  const d = Buffer.alloc(44 + s.length * 2);
  d.write("RIFF", 0); d.writeUInt32LE(36 + s.length * 2, 4); d.write("WAVEfmt ", 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22);
  d.writeUInt32LE(SR, 24); d.writeUInt32LE(SR * 2, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write("data", 36); d.writeUInt32LE(s.length * 2, 40);
  s.forEach((v, i) => d.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 30000), 44 + i * 2)); return d;
}
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const buf = (sec) => new Float32Array(Math.round(sec * SR));
const save = (name, s) => { normalize(s, 0.9); writeFileSync(OUT + name, wav(s)); };
function normalize(s, peak) { let m = 0; for (const v of s) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < s.length; i++) s[i] *= peak / m; }
// 基本声音：在 t0 处叠加
function tone(s, t0, dur, f0, f1, vol, { wave = "sine", attack = 0.005, decay = 4, vib = 0 } = {}) {
  const n = Math.round(dur * SR), st = Math.round(t0 * SR); let ph = 0;
  for (let i = 0; i < n && st + i < s.length; i++) {
    const k = i / n, t = i / SR, f = f0 + (f1 - f0) * k + (vib ? Math.sin(t * 30) * vib : 0); ph += f / SR;
    const x = ph % 1; let w = wave === "sine" ? Math.sin(2 * Math.PI * ph) : wave === "tri" ? 1 - 4 * Math.abs(x - 0.5) : wave === "saw" ? 2 * x - 1 : x < 0.5 ? 1 : -1;
    const env = Math.min(1, t / attack) * Math.exp(-decay * k);
    s[st + i] += w * vol * env;
  }
}
function noise(s, t0, dur, vol, { decay = 6, lp = 0.5, attack = 0.002 } = {}) {
  const n = Math.round(dur * SR), st = Math.round(t0 * SR); let y = 0;
  for (let i = 0; i < n && st + i < s.length; i++) { const k = i / n; y += lp * (rnd() - y); s[st + i] += y * vol * Math.min(1, i / SR / attack) * Math.exp(-decay * k); }
}
// 拨弦（Karplus–Strong），给音乐和鲁特琴味的提示音
function pluck(s, t0, f, vol, dur = 1.6, bright = 0.5) {
  const p = Math.max(2, Math.round(SR / f)), ring = new Float32Array(p).map(() => rnd() * bright + rnd() * (1 - bright) * 0.3);
  const n = Math.round(dur * SR), st = Math.round(t0 * SR); let idx = 0;
  for (let i = 0; i < n && st + i < s.length; i++) { const a = ring[idx], b = ring[(idx + 1) % p]; const v = (a + b) * 0.4985; ring[idx] = v; idx = (idx + 1) % p; s[st + i] += a * vol * Math.min(1, i / 40); }
}
const note = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 骰子：在木桌上滚动（越滚越慢的碰撞声），落定时一声脆响
{ const s = buf(1.15); let t = 0.02, gap = 0.035; while (t < 1.02) { noise(s, t, 0.03, 0.5 + Math.random() * 0.3, { decay: 9, lp: 0.7 }); tone(s, t, 0.04, 1800 + Math.random() * 900, 1500, 0.15, { wave: "tri", decay: 12 }); t += gap; gap *= 1.13; } save("dice_roll.wav", s); }
{ const s = buf(0.35); noise(s, 0, 0.08, 0.9, { decay: 10, lp: 0.8 }); tone(s, 0, 0.12, 2400, 2200, 0.35, { wave: "tri", decay: 10 }); tone(s, 0, 0.25, 140, 90, 0.5, { decay: 7 }); save("dice_land.wav", s); }
// 结果
{ const s = buf(1.1); [72, 76, 79, 84].forEach((m, i) => { pluck(s, i * 0.07, note(m), 0.5, 1.0, 0.8); tone(s, i * 0.07, 0.6, note(m + 12), note(m + 12), 0.08, { decay: 5 }); }); save("success.wav", s); }
{ const s = buf(1.0); [55, 51, 48].forEach((m, i) => pluck(s, i * 0.12, note(m), 0.6, 0.9, 0.4)); tone(s, 0.05, 0.8, 90, 60, 0.4, { decay: 4 }); save("fail.wav", s); }
{ const s = buf(2.0); [72, 76, 79, 84, 88, 91].forEach((m, i) => { pluck(s, i * 0.06, note(m), 0.55, 1.4, 0.9); tone(s, i * 0.06, 1.2, note(m + 12), note(m + 12), 0.07, { decay: 3, vib: 4 }); });
  for (let i = 0; i < 18; i++) tone(s, 0.4 + Math.random() * 1.1, 0.25, 2500 + Math.random() * 2500, 3000 + Math.random() * 2000, 0.06, { decay: 8 }); save("crit.wav", s); }
{ const s = buf(1.4); [50, 49, 44].forEach((m, i) => tone(s, i * 0.18, 0.7, note(m), note(m) * 0.94, 0.3, { wave: "saw", decay: 3 })); noise(s, 0, 0.9, 0.3, { decay: 3, lp: 0.08 }); save("fumble.wav", s); }
// 战斗
{ const s = buf(0.22); noise(s, 0, 0.18, 0.6, { decay: 5, lp: 0.25, attack: 0.04 }); save("swing.wav", s); }
{ const s = buf(0.3); noise(s, 0, 0.06, 1, { decay: 12, lp: 0.9 }); tone(s, 0, 0.22, 180, 70, 0.8, { decay: 6 }); tone(s, 0.005, 0.1, 900, 400, 0.2, { wave: "tri", decay: 10 }); save("hit.wav", s); }
{ const s = buf(0.55); noise(s, 0, 0.08, 1, { decay: 10, lp: 1 }); tone(s, 0, 0.4, 220, 60, 1, { decay: 5 }); tone(s, 0, 0.45, 1600, 900, 0.25, { wave: "tri", decay: 6 }); save("crit_hit.wav", s); }
{ const s = buf(0.3); noise(s, 0, 0.26, 0.5, { decay: 4, lp: 0.15, attack: 0.08 }); save("miss.wav", s); }
{ const s = buf(0.4); tone(s, 0, 0.3, 300, 120, 0.6, { wave: "square", decay: 6 }); noise(s, 0, 0.1, 0.5, { decay: 10, lp: 0.6 }); save("hurt.wav", s); }
{ const s = buf(0.5); noise(s, 0, 0.12, 0.6, { decay: 8, lp: 0.5 }); tone(s, 0.02, 0.4, 520, 520, 0.25, { wave: "tri", decay: 7 }); tone(s, 0.02, 0.4, 780, 780, 0.15, { wave: "tri", decay: 7 }); save("block.wav", s); }
{ const s = buf(0.7); for (let i = 0; i < 14; i++) tone(s, i * 0.03, 0.3, 600 + i * 120, 900 + i * 160, 0.12, { decay: 6 }); noise(s, 0, 0.6, 0.25, { decay: 3, lp: 0.2 }); save("magic.wav", s); }
{ const s = buf(0.9); [60, 64, 67].forEach((m, i) => tone(s, 0, 0.8, note(m), note(m + 12), 0.2, { wave: "tri", decay: 4 })); save("charge.wav", s); }
{ const s = buf(1.6); [67, 72, 76, 79].forEach((m, i) => pluck(s, i * 0.11, note(m), 0.55, 1.4, 0.7)); tone(s, 0.33, 1.1, note(84), note(84), 0.1, { decay: 3, vib: 3 }); save("victory.wav", s); }
{ const s = buf(1.0); tone(s, 0, 0.5, 200, 90, 0.7, { wave: "saw", decay: 5 }); tone(s, 0.1, 0.8, note(45), note(44), 0.4, { wave: "saw", decay: 3 }); noise(s, 0, 0.5, 0.4, { decay: 4, lp: 0.1 }); save("battle.wav", s); }
// 收获、升级、道具、界面
{ const s = buf(0.45); tone(s, 0, 0.12, 1975, 1975, 0.4, { wave: "square", decay: 8 }); tone(s, 0.07, 0.35, 2637, 2637, 0.4, { wave: "square", decay: 6 }); save("coin.wav", s); }
{ const s = buf(1.4); [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => tone(s, i * 0.06, 0.6, note(m), note(m), 0.18, { wave: "tri", decay: 4 })); for (let i = 0; i < 12; i++) tone(s, 0.4 + i * 0.05, 0.3, 3000 + i * 150, 3200 + i * 150, 0.05, { decay: 7 }); save("levelup.wav", s); }
{ const s = buf(0.9); for (let i = 0; i < 9; i++) tone(s, i * 0.045, 0.45, note(84 + [0, 4, 7, 12, 7, 12, 16, 19, 24][i]), note(84 + [0, 4, 7, 12, 7, 12, 16, 19, 24][i]), 0.12, { decay: 5 }); save("item.wav", s); }
{ const s = buf(0.6); tone(s, 0, 0.5, note(62), note(74), 0.2, { wave: "tri", decay: 4 }); tone(s, 0.04, 0.5, note(69), note(81), 0.12, { decay: 4 }); save("heal.wav", s); }
{ const s = buf(0.08); noise(s, 0, 0.05, 0.6, { decay: 14, lp: 0.6 }); tone(s, 0, 0.05, 1400, 1100, 0.3, { wave: "tri", decay: 12 }); save("click.wav", s); }
{ const s = buf(0.14); noise(s, 0, 0.1, 0.5, { decay: 10, lp: 0.12 }); tone(s, 0, 0.08, 120, 80, 0.3, { decay: 9 }); save("step.wav", s); }
{ const s = buf(0.7); tone(s, 0, 0.6, note(76), note(76), 0.1, { decay: 3 }); pluck(s, 0, note(64), 0.5, 0.7, 0.6); pluck(s, 0.1, note(71), 0.4, 0.6, 0.6); save("card.wav", s); }
{ const s = buf(1.4); for (let i = 0; i < 40; i++) noise(s, Math.random() * 1.3, 0.03, 0.3 + Math.random() * 0.4, { decay: 10, lp: 0.8 }); noise(s, 0, 1.4, 0.25, { decay: 1, lp: 0.05 }); save("camp.wav", s); }
{ const s = buf(1.6); tone(s, 0, 1.5, note(57), note(52), 0.3, { wave: "tri", decay: 2 }); tone(s, 0.2, 1.3, note(60), note(55), 0.2, { wave: "tri", decay: 2 }); noise(s, 0, 1.5, 0.15, { decay: 2, lp: 0.05 }); save("death.wav", s); }

// 背景音乐：一段 24 秒的旅途小调（拨弦琶音 + 低音 + 风声垫），无缝循环
{
  const bars = 8, beat = 0.375, sec = bars * 8 * beat, s = buf(sec);
  const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59], [57, 60, 64], [50, 53, 57], [52, 56, 59], [57, 60, 64]];
  const pat = [0, 1, 2, 1, 2, 1, 0, 2];
  prog.forEach((ch, b) => {
    const t0 = b * 8 * beat;
    pluck(s, t0, note(ch[0] - 12), 0.55, 3.2, 0.3);
    pat.forEach((pi, j) => pluck(s, t0 + j * beat, note(ch[pi] + 12), 0.22 + (j === 0 ? 0.08 : 0), 1.2, 0.55));
    if (b % 2 === 1) pluck(s, t0 + 6.5 * beat, note(ch[2] + 24), 0.12, 1.0, 0.7);
  });
  // 风声：很轻的低通噪声，首尾交叉淡化保证循环
  let y = 0; for (let i = 0; i < s.length; i++) { y += 0.01 * (rnd() - y); s[i] += y * 0.6 * (0.6 + 0.4 * Math.sin(i / SR * 0.5)); }
  const fade = Math.round(0.4 * SR); for (let i = 0; i < fade; i++) { const k = i / fade; s[i] = s[i] * k + s[s.length - fade + i] * (1 - k); }
  const out = s.slice(0, s.length - fade); normalize(out, 0.55); writeFileSync(OUT + "music.wav", wav(out));
}
console.log("ok");
