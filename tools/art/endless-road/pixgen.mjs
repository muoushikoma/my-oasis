// 生成像素精灵表：每帧加 1px 外描边，帧横向排列。node pixgen.mjs outDir [previewScale]
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); import fs from "node:fs";
const out = process.argv[2]; const scale = Number(process.argv[3] || 6); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent("<body></body>"); await p.addScriptTag({ path: new URL("./pix.js", import.meta.url).pathname });
const res = await p.evaluate((scale) => {
  const OUT = "#1a1420";
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const r = {}; const meta = {};
  const NOSHADE = new Set("#eryziOFRIk".split(""));
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const tone = ([R, G, B], k) => k >= 0 ? [R + (255 - R) * k, G + (255 - G) * k, B + (255 - B) * k].map(clamp) : [R * (1 + k), G * (1 + k), B * (1 + k * 0.85)].map(clamp);
  for (const [name, sp] of Object.entries(SPRITES)) {
    const fw = Math.max(...sp.frames.flatMap((f) => f.map((row) => row.length))) + 2;
    const fh = Math.max(...sp.frames.map((f) => f.length)) + 2;
    const c = document.createElement("canvas"); c.width = fw * sp.frames.length; c.height = fh;
    const x = c.getContext("2d"); const img = x.createImageData(c.width, c.height); const d = img.data;
    sp.frames.forEach((f, fi) => {
      const oy = fh - f.length - 1;
      const at = (cx, cy) => { const row = f[cy - oy]; const ch = row && row[cx - 1]; return ch && ch !== "." ? ch : null; };
      for (let cy = 0; cy < fh; cy++) for (let cx = 0; cx < fw; cx++) {
        const i = ((cy * c.width) + fi * fw + cx) * 4;
        const ch = at(cx, cy);
        let col;
        if (ch) {
          const base = PAL[ch]; if (!base) throw new Error(name + " 未知颜色 " + ch);
          col = hex(base);
          if (!NOSHADE.has(ch)) {
            // 光从左上来：上/左是边缘 → 提亮；下/右是边缘 → 压暗；同色块内部的分界也算边缘
            const same = (dx, dy) => at(cx + dx, cy + dy) === ch;
            const up = !at(cx, cy - 1), lf = !at(cx - 1, cy), dn = !at(cx, cy + 1), rt = !at(cx + 1, cy);
            let k = 0;
            if (up) k += 0.22; else if (!same(0, -1)) k += 0.08;
            if (lf) k += 0.1;
            if (dn) k -= 0.28; else if (!same(0, 1)) k -= 0.1;
            if (rt) k -= 0.14;
            if (!dn && !at(cx, cy + 2)) k -= 0.08;
            col = tone(col, Math.max(-0.4, Math.min(0.32, k)));
          }
        } else {
          // 选择性描边：取相邻像素颜色的深色版
          const nb = [at(cx - 1, cy), at(cx + 1, cy), at(cx, cy - 1), at(cx, cy + 1)].find(Boolean);
          if (nb) { const [R, G, B] = hex(PAL[nb]); col = [R * 0.22 + 10, G * 0.2 + 8, B * 0.24 + 14].map(clamp); }
        }
        if (col) { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; }
      }
    });
    x.putImageData(img, 0, 0);
    r[name] = c.toDataURL("image/png"); meta[name] = { w: fw, h: fh, frames: sp.frames.length };
  }
  // 预览图
  const names = Object.keys(r); const pv = document.createElement("canvas"); pv.width = 1400; pv.height = 1600; const px = pv.getContext("2d");
  px.fillStyle = "#7a9a7a"; px.fillRect(0, 0, pv.width, pv.height); px.imageSmoothingEnabled = false;
  let X = 10, Y = 10, rowH = 0;
  return { r, meta };
}, scale);
for (const [n, url] of Object.entries(res.r)) fs.writeFileSync(`${out}/${n}.png`, Buffer.from(url.split(",")[1], "base64"));
fs.writeFileSync(`${out}/meta.json`, JSON.stringify(res.meta, null, 1));
// 预览：放大排版
const items = Object.entries(res.r).map(([n, url]) => `<div style="display:inline-block;margin:6px;font:11px sans-serif;vertical-align:bottom"><img src="${url}" style="image-rendering:pixelated;height:${res.meta[n].h * scale}px"><br>${n}</div>`).join("");
await p.setViewportSize({ width: 1400, height: 900 });
await p.setContent(`<body style="background:#8aa08a;margin:0">${items}</body>`); await p.screenshot({ path: `${out}/_preview.png`, fullPage: true });
await b.close(); console.log(JSON.stringify(res.meta));
