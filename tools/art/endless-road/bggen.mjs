import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright"); import fs from "node:fs";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent("<body></body>"); await p.addScriptTag({ path: new URL("./bg.js", import.meta.url).pathname });
const files = await p.evaluate(() => Object.fromEntries(Object.entries(BG_ALL()).map(([k, c]) => [k, c.toDataURL("image/png")])));
for (const [k, u] of Object.entries(files)) fs.writeFileSync(`${out}/${k}.png`, Buffer.from(u.split(",")[1], "base64"));
// 预览：每个地区合成一张，配一个主角和一个敌人
const spr = (n) => "data:image/png;base64," + fs.readFileSync(new URL(`out/pix/${n}.png`, import.meta.url)).toString("base64");
const meta = JSON.parse(fs.readFileSync(new URL("out/pix/meta.json", import.meta.url), "utf8"));
const combos = { plains: "bandit", forest: "wolf", hills: "skeleton", swamp: "ooze", mountains: "troll", ashlands: "warden" };
const html = await p.evaluate(async ({ files, combos, meta, imgs }) => {
  const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
  const res = [];
  for (const [bio, foe] of Object.entries(combos)) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 144; const x = c.getContext("2d");
    for (const l of ["sky", "far", "mid", "ground"]) x.drawImage(await load(files[`bg_${bio}_${l}`]), 0, 0);
    const hero = await load(imgs.hero); const m = meta.hero; x.drawImage(hero, 0, 0, m.w, m.h, 70, 118 - m.h + 1, m.w, m.h);
    const fi = await load(imgs[foe]); const fm = meta[foe]; x.drawImage(fi, 0, 0, fm.w, fm.h, 150, 118 - fm.h + 1, fm.w, fm.h);
    res.push(c.toDataURL());
  }
  return res;
}, { files, combos, meta, imgs: Object.fromEntries(["hero", ...Object.values(combos)].map((n) => [n, spr(n)])) });
await p.setViewportSize({ width: 1560, height: 900 });
await p.setContent(`<body style="margin:0;background:#222">${html.map((u) => `<img src="${u}" style="image-rendering:pixelated;width:768px;margin:2px">`).join("")}</body>`);
await p.screenshot({ path: `${out}/_preview.png`, fullPage: true }); await b.close();
