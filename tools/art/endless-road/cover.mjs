import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright"); import fs from "node:fs";
const A = new URL("../../../stories/endless-road/assets", import.meta.url).pathname;
const img = (p) => "data:image/png;base64," + fs.readFileSync(p).toString("base64");
const files = {}; for (const b of ["plains", "mountains"]) for (const l of ["sky", "far", "mid", "ground"]) files[`${b}_${l}`] = img(`${A}/bg/${b}_${l}.png`);
for (const n of ["hero", "wolf", "cart", "campfire"]) files[n] = img(`${A}/sprites/${n}.png`);
const b = await chromium.launch(); const p = await b.newPage(); await p.setContent("<body></body>");
const out = await p.evaluate(async (files) => {
  const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
  const I = {}; for (const [k, u] of Object.entries(files)) I[k] = await load(u);
  const up = (c) => { const o = document.createElement("canvas"); o.width = 768; o.height = 432; const x = o.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, 768, 432); return o.toDataURL("image/png"); };
  const crispText = (x, text, cx, cy, size, color, outline) => {
    const t = document.createElement("canvas"); t.width = 256; t.height = 144; const tx = t.getContext("2d");
    tx.font = `bold ${size}px "Noto Sans CJK SC","Noto Sans SC","WenQuanYi Zen Hei",sans-serif`; tx.textAlign = "center"; tx.textBaseline = "middle"; tx.fillStyle = "#fff"; tx.fillText(text, cx, cy);
    const d = tx.getImageData(0, 0, 256, 144); const m = (X, Y) => X >= 0 && Y >= 0 && X < 256 && Y < 144 && d.data[(Y * 256 + X) * 4 + 3] > 110;
    for (let Y = 0; Y < 144; Y++) for (let X = 0; X < 256; X++) { if (m(X, Y)) { x.fillStyle = color; x.fillRect(X, Y, 1, 1); } else if (m(X - 1, Y) || m(X + 1, Y) || m(X, Y - 1) || m(X, Y + 1) || m(X, Y - 1 + 2)) { x.fillStyle = outline; x.fillRect(X, Y, 1, 1); } }
  };
  // 封面
  let c = document.createElement("canvas"); c.width = 256; c.height = 144; let x = c.getContext("2d");
  for (const l of ["sky", "far", "mid", "ground"]) x.drawImage(I[`plains_${l}`], l === "mid" || l === "ground" ? -60 : 0, 0);
  x.globalCompositeOperation = "multiply"; x.fillStyle = "rgba(255,170,110,0.35)"; x.fillRect(0, 0, 256, 144); x.globalCompositeOperation = "source-over";
  x.drawImage(I.hero, 24 * 2, 0, 24, 23, 60, 96, 24, 23);
  x.drawImage(I.wolf, 0, 0, 37, 18, 190, 101, 37, 18);
  crispText(x, "无尽之路", 128, 34, 26, "#fff4dc", "#3a1c18");
  crispText(x, "THE ENDLESS ROAD", 128, 58, 11, "#ffd890", "#3a1c18");
  const cover = up(c);
  // 远景（AI 生图失败时的替代图）
  c = document.createElement("canvas"); c.width = 256; c.height = 144; x = c.getContext("2d");
  for (const l of ["sky", "far", "mid", "ground"]) x.drawImage(I[`mountains_${l}`], l === "ground" ? -200 : 0, 0);
  x.globalCompositeOperation = "multiply"; x.fillStyle = "rgba(255,150,110,0.45)"; x.fillRect(0, 0, 256, 144); x.globalCompositeOperation = "source-over";
  x.drawImage(I.campfire, 0, 0, 36, 13, 120, 106, 36, 13);
  x.drawImage(I.hero, 0, 0, 24, 23, 96, 96, 24, 23);
  return { cover, vista: up(c) };
}, files);
fs.writeFileSync(`${A}/cover.png`, Buffer.from(out.cover.split(",")[1], "base64"));
fs.writeFileSync(`${A}/vista.png`, Buffer.from(out.vista.split(",")[1], "base64"));
await b.close();
