// 《无尽之路》像素背景：每个地区 4 层（sky 天空 / far 远景 / mid 中景 / ground 地面与路），横向无缝循环
// 画布逻辑尺寸 256×144，地面线 y=118（主角脚底）。

const BW = 256, BH = 144, GROUND = 118;
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function rngB(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class Px {
  constructor(w, h) { this.w = w; this.h = h; this.c = document.createElement("canvas"); this.c.width = w; this.c.height = h; this.x = this.c.getContext("2d"); this.img = this.x.createImageData(w, h); }
  set(x, y, col, a = 255) { x = ((Math.round(x) % this.w) + this.w) % this.w; y = Math.round(y); if (y < 0 || y >= this.h || !col) return; const i = (y * this.w + x) * 4; const c = typeof col === "string" ? hex(col) : col; this.img.data[i] = c[0]; this.img.data[i + 1] = c[1]; this.img.data[i + 2] = c[2]; this.img.data[i + 3] = a; }
  mix(x, y, col, k) { x = ((Math.round(x) % this.w) + this.w) % this.w; y = Math.round(y); if (y < 0 || y >= this.h) return; const i = (y * this.w + x) * 4; const c = hex(col); for (let j = 0; j < 3; j++) this.img.data[i + j] = Math.round(this.img.data[i + j] * (1 - k) + c[j] * k); }
  get(x, y) { x = ((x % this.w) + this.w) % this.w; if (y < 0 || y >= this.h) return 0; return this.img.data[(y * this.w + x) * 4 + 3]; }
  done() { this.x.putImageData(this.img, 0, 0); return this.c; }
  // 按 t∈[0,1] 在调色板里取色，带 Bayer 抖动
  dither(x, y, t, pal) { const n = pal.length - 1; const v = Math.max(0, Math.min(0.9999, t)) * n; const i = Math.floor(v), f = v - i; return f * 16 > BAYER[y & 3][x & 3] + 0.5 ? pal[Math.min(n, i + 1)] : pal[i]; }
  stamp(grid, pal, x0, y0, flip = false) { // y0 = 底部
    const h = grid.length; grid.forEach((row, r) => { for (let k = 0; k < row.length; k++) { const ch = row[flip ? row.length - 1 - k : k]; if (ch !== "." && pal[ch]) this.set(x0 + k, y0 - h + 1 + r, pal[ch]); } });
  }
}
// 周期噪声（保证 x=0 和 x=W 接得上）
function wave(seed, W, comps) { const r = rngB(seed); const cs = comps.map(([k, a]) => ({ k, a, p: r() * Math.PI * 2 })); return (x) => cs.reduce((s, c) => s + Math.sin((x / W) * Math.PI * 2 * c.k + c.p) * c.a, 0); }
// 填充一条山脊：顶部高光一行，往下抖动变暗
function ridgeFill(px, f, pal, opt = {}) {
  for (let x = 0; x < px.w; x++) {
    const top = Math.round(f(x));
    for (let y = Math.max(0, top); y < (opt.bottom ?? px.h); y++) {
      const t = opt.flat ? 0 : (y - top) / (opt.depth ?? 40);
      let col = px.dither(x, y, t, pal.body);
      if (y === top && pal.rim) col = pal.rim;
      px.set(x, y, col);
    }
  }
}

// ---------- 小部件（手绘） ----------
const PROPS = {
  pine: ["....a....", "...aaa...", "...aAa...", "..aaaAa..", "..aaAAa..", ".aaaaAaa.", "...aAA...", "..aaaAaa.", ".aaaaaAAa", "aaaaaaAAa", "..aaaAa..", ".aaaaaAAa", "aaaaaaaAA", "....t....", "....t...."],
  pine_s: ["..a..", ".aaa.", ".aAa.", "aaaAa", ".aAa.", "aaaAA", "aaaaA", "..t.."],
  round: ["...aaaaa...", ".aaaaaaaaa.", "aaaaaaaaaAa", "aaaaaaaaAAa", "aaaaaaaAAAA", ".aaaaaAAAA.", "..AAAAAAA..", "....tT.....", "....tT.....", "....tT.....", "...ttTT...."],
  bush: ["..aaaa..", ".aaaaaa.", "aaaaaaAa", "aaaaaAAA", ".AAAAAA."],
  dead: ["t...t....", ".t.t...t.", "..tt..t..", "..t.tt...", "...tt....", "t..t.....", ".ttt.....", "...t.....", "...t.....", "..tt.....", "..tt.....", ".ttT....."],
  dead_big: ["t.....t.....t", ".t...t.....t.", "..t.t..t..t..", "...tt...tt...", "....t..t.....", "....tt.t.....", ".....tt......", ".....tt......", ".....tt......", ".....tT......", "....ttT......", "....ttT......", "...tttTT....."],
  stone: ["..ss..", ".sssS.", ".sssS.", ".ssSS.", ".ssSS.", "ssSSSS"],
  menhir: [".ss.", "sssS", "sssS", "ssSS", "ssSS", "ssSS", "sSSS", "sSSS"],
  rock: ["..sss...", ".sssssS.", "sssssSSS"],
  reed: ["a.a", "a.a", "aaa", ".a.", ".a.", ".a."],
  tuft: ["a.a.a", ".aaa."],
  flower: ["f", "a"],
  cactus: [".a.", "aa.", "aaa", ".aa", ".a."],
};

// ---------- 地区 ----------
const BIOME_DEF = {
  plains: {
    sky: ["#3e6fb4", "#5a8cc8", "#7eaad8", "#a8c8e2", "#d8e0d0", "#f2dca8"], sun: { x: 180, y: 34, r: 9, col: "#fff4c8", halo: "#f8e4a8" }, clouds: "#f4f6f8",
    far: { body: ["#8eaab8", "#7c9aac"], rim: "#a8c0cc", base: 74, comps: [[2, 6], [5, 3], [9, 1.5]] },
    mid: { body: ["#6e9e5a", "#5c8a4c", "#4c7840"], rim: "#88b866", base: 96, comps: [[3, 5], [7, 2]], props: [["round", 8, { a: "#4e7e3e", A: "#3a6430", t: "#5a3e26", T: "#3e2a1a" }], ["bush", 10, { a: "#5a8c44", A: "#447034" }]] },
    ground: { grass: ["#7cba54", "#64a046", "#4e8838"], road: ["#c09a64", "#a8824e", "#8e6a3e"], dirt: "#6e5034", props: [["tuft", 30, { a: "#4e8838" }], ["flower", 14, { a: "#4e8838", f: "#f2e05a" }], ["flower", 10, { a: "#4e8838", f: "#e86a6a" }], ["rock", 3, { s: "#a8a294", S: "#7a766a" }]] },
  },
  forest: {
    sky: ["#14302c", "#1e4038", "#2c5646", "#3e6e56", "#5c8a68", "#86a882"], rays: "#c8f0b0", clouds: null,
    far: { body: ["#335e4e", "#2a5244"], rim: null, base: 70, comps: [[4, 3], [9, 2]], props: [["pine", 34, { a: "#2e5a4a", A: "#244c3e", t: "#244c3e" }]] },
    mid: { body: ["#1e3c30", "#183428"], rim: null, base: 100, comps: [[3, 3], [8, 2]], props: [["pine", 22, { a: "#24493a", A: "#1a382c", t: "#3a2a1c" }], ["pine_s", 16, { a: "#2a5242", A: "#1e4034", t: "#3a2a1c" }]] },
    ground: { grass: ["#3e6a40", "#2e5434", "#224028"], road: ["#7a6a4e", "#665840", "#504432"], dirt: "#3a3024", props: [["tuft", 26, { a: "#2a4c30" }], ["flower", 8, { a: "#2a4c30", f: "#d8f0a0" }], ["stone", 4, { s: "#6a6e60", S: "#4a4e44" }]] },
  },
  hills: {
    sky: ["#231d3a", "#3a2e54", "#5e4870", "#8e6a84", "#c68e86", "#e8b090"], sun: { x: 60, y: 70, r: 11, col: "#ffd8b0", halo: "#e8a888" }, stars: true,
    far: { body: ["#5e5276", "#524868"], rim: "#7a6a8e", base: 84, comps: [[2, 5], [5, 2]], props: [["menhir", 6, { s: "#4a4260", S: "#3a3450" }]] },
    mid: { body: ["#4a4460", "#3e3a52", "#34304a"], rim: "#625a7a", base: 100, comps: [[2, 4], [6, 3]], props: [["menhir", 5, { s: "#6e6886", S: "#4e4a64" }], ["dead", 4, { t: "#2e2a3c", T: "#22202e" }]] },
    ground: { grass: ["#5e5a6a", "#4c4858", "#3c3a48"], road: ["#8e7a7a", "#76646a", "#5e5056"], dirt: "#3a3240", props: [["tuft", 24, { a: "#3c3a4a" }], ["stone", 4, { s: "#7a7488", S: "#56526a" }], ["flower", 6, { a: "#3c3a4a", f: "#c8a8e8" }]] },
  },
  swamp: {
    sky: ["#1a2418", "#26341e", "#36462a", "#4c5c38", "#6a7a4c", "#8a9864"], sun: { x: 128, y: 52, r: 8, col: "#e8f0c0", halo: "#a8b888" }, fog: "#b8c8a0",
    far: { body: ["#3e4a34", "#36422e"], rim: null, base: 92, comps: [[3, 2], [7, 1]], props: [["dead_big", 9, { t: "#38442e", T: "#2e3826" }], ["dead", 8, { t: "#3a4630", T: "#30392a" }]] },
    mid: { water: ["#4e5c3e", "#44523a", "#3a4632"], body: ["#2e3826", "#263020"], base: 104, comps: [[4, 1.5]], props: [["dead_big", 5, { t: "#1e261a", T: "#161c12" }], ["reed", 20, { a: "#4a5a34" }]] },
    ground: { boardwalk: true, grass: ["#4a5a38", "#3c4a2e", "#2e3a24"], road: ["#7a5e3e", "#644c32", "#4e3a26"], dirt: "#2a3220", props: [["reed", 18, { a: "#5a6e3e" }], ["tuft", 14, { a: "#3a4a2c" }]] },
  },
  mountains: {
    sky: ["#3a5a8a", "#4e72a2", "#6a8eba", "#90b0d0", "#bcd2e4", "#e2ecf4"], sun: { x: 70, y: 28, r: 7, col: "#ffffff", halo: "#d8e8f8" }, clouds: "#eef4fa",
    far: { body: ["#eef3f8", "#c4d2e2", "#8ea2bc", "#6e84a2"], rim: "#ffffff", base: 80, comps: [[3, 9], [7, 4], [13, 2]], jag: true, depth: 34 },
    mid: { body: ["#5a7494", "#4a6282"], rim: "#7a92b0", base: 98, comps: [[4, 4], [9, 2]], props: [["pine", 18, { a: "#2e4a5e", A: "#24394c", t: "#24394c" }], ["pine_s", 14, { a: "#3a566a", A: "#2e475a", t: "#2e475a" }]] },
    ground: { grass: ["#eef3f8", "#d4dee8", "#b8c6d4"], road: ["#a8b2bc", "#8e9aa6", "#76828e"], dirt: "#6a7684", props: [["rock", 6, { s: "#7a8698", S: "#5a6678" }], ["pine_s", 4, { a: "#2e4a5e", A: "#24394c", t: "#3a2a1c" }]] },
  },
  ashlands: {
    sky: ["#1a0c10", "#2e1214", "#4e1c18", "#7a2c1c", "#b4481e", "#e87a2e"], volcano: true, embers: true,
    far: { body: ["#3a1c18", "#301614"], rim: "#5a2a20", base: 88, comps: [[3, 4], [8, 2]], jag: true, depth: 30 },
    mid: { body: ["#2a1412", "#22100e"], rim: "#4a2018", base: 104, comps: [[5, 3], [11, 1.5]], props: [["dead", 6, { t: "#140a08", T: "#0e0606" }], ["rock", 8, { s: "#3a2420", S: "#2a1814" }]] },
    ground: { grass: ["#3a2420", "#2c1a16", "#1e100e"], road: ["#5a3a30", "#4a2e26", "#3a221c"], dirt: "#1a0e0c", lava: true, props: [["rock", 8, { s: "#4a2e28", S: "#30201c" }]] },
  },
};

function makeSky(def, seed) {
  const px = new Px(BW, BH); const r = rngB(seed);
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) px.set(x, y, px.dither(x, y, y / 110, def.sky.map(hex)));
  if (def.stars) for (let i = 0; i < 70; i++) { const y = Math.floor(r() * 60); px.set(r() * BW, y, r() > 0.8 ? "#ffffff" : "#c8c0e0"); }
  if (def.sun) { const s = def.sun; for (let dy = -s.r * 3; dy <= s.r * 3; dy++) for (let dx = -s.r * 3; dx <= s.r * 3; dx++) { const d = Math.hypot(dx, dy); if (d <= s.r) px.set(s.x + dx, s.y + dy, s.col); else if (d <= s.r * 2.6 && ((dx + dy) & 1) === 0 && (d - s.r) / (s.r * 1.6) * 16 < BAYER[(s.y + dy) & 3][(s.x + dx) & 3] + 4) px.set(s.x + dx, s.y + dy, s.halo); } }
  if (def.clouds) {
    for (let i = 0; i < 6; i++) { const cx = r() * BW, cy = 12 + r() * 40, w = 18 + r() * 26; for (let k = 0; k < w; k++) { const hgt = Math.round(Math.sin((k / w) * Math.PI) * (3 + r() * 1.5)); for (let j = 0; j < hgt; j++) px.set(cx + k, cy - j, j === hgt - 1 ? def.clouds : (j === 0 ? "#c8d4e0" : def.clouds)); } }
  }
  if (def.volcano) {
    const vx = 170; for (let y = 40; y < BH; y++) { const half = 6 + (y - 40) * 0.9; for (let x = -half; x <= half; x++) px.set(vx + x, y, px.dither(vx + x, y, (y - 40) / 70, ["#3a1814", "#2a100e"].map(hex))); }
    for (let i = 0; i < 40; i++) { const a = r() * Math.PI, d = r() * 10; px.set(vx + Math.cos(a) * d * 1.6, 40 - Math.sin(a) * d * 0.6, r() > 0.5 ? "#ffb04a" : "#ff6a2a"); }
    for (let i = 0; i < 60; i++) px.set(vx - 4 + r() * 30, 10 + r() * 28, r() > 0.5 ? "#3a2a2a" : "#4a3434");
  }
  if (def.rays) for (let k = 0; k < 4; k++) { const sx = 110 + k * 30, bw = 8 + k * 3; for (let y = 0; y < 118; y++) for (let w = 0; w < bw; w++) { const x = Math.round(sx + w - y * 0.5); const edge = Math.min(w, bw - 1 - w) < 2; px.mix(x, y, def.rays, (edge ? 0.06 : 0.12) * (1 - y / 140)); } }
  return px.done();
}
function makeLayer(L, seed, W, kind) {
  const px = new Px(W, BH); const r = rngB(seed);
  const f0 = wave(seed, W, L.comps.map(([k, a]) => [Math.max(1, Math.round(k * W / BW)), a]));
  const f = L.jag ? (x) => L.base - Math.abs(f0(x)) * 1.6 - Math.abs(Math.sin((x / W) * Math.PI * 2 * Math.round(9 * W / BW))) * 4 : (x) => L.base - f0(x);
  if (L.water) { for (let y = L.base - 2; y < BH; y++) for (let x = 0; x < W; x++) px.set(x, y, px.dither(x, y, (y - L.base) / 20, L.water.map(hex))); for (let i = 0; i < 50; i++) { const y = L.base + Math.floor(r() * 16), x = r() * W, len = 3 + r() * 8; for (let k = 0; k < len; k++) px.set(x + k, y, "#7a8a5e"); } }
  else ridgeFill(px, f, { body: L.body.map(hex), rim: L.rim ? hex(L.rim) : null }, { depth: L.depth ?? 26 });
  for (const [name, count, pal] of L.props ?? []) {
    const g = PROPS[name]; for (let i = 0; i < count; i++) { const x = Math.floor(r() * W); const by = L.water ? L.base + 1 + Math.floor(r() * 6) : Math.round(f(x + 4)) + 2 + Math.floor(r() * 3); px.stamp(g, pal, x, by, r() > 0.5); }
  }
  return px.done();
}
function makeGround(G, seed, W) {
  const px = new Px(W, BH); const r = rngB(seed);
  const top = GROUND - 8; // 草地起点
  const fx = wave(seed, W, [[Math.round(6 * W / BW), 1.2], [Math.round(13 * W / BW), 0.6]]);
  for (let x = 0; x < W; x++) {
    const gt = Math.round(top - 2 + fx(x));
    for (let y = gt; y < BH; y++) {
      let col;
      if (y >= GROUND - 3 && y <= GROUND + 8) { // 路
        if (G.boardwalk) { const plank = (x >> 3) & 1; col = (x % 8 === 0) ? hex("#3a2a1a") : px.dither(x, y, (y - GROUND + 3) / 12 + plank * 0.2, G.road.map(hex)); }
        else col = px.dither(x, y, (y - (GROUND - 3)) / 12, G.road.map(hex));
        if (y === GROUND - 3) col = hex(G.road[0]);
      } else if (y > GROUND + 8) col = px.dither(x, y, (y - GROUND - 8) / 18, [hex(G.dirt), hex(G.grass[2])]);
      else col = px.dither(x, y, (y - gt) / 10, G.grass.map(hex));
      if (y === gt) col = hex(G.grass[0]);
      px.set(x, y, col);
    }
  }
  // 路面细节：石子、车辙
  for (let i = 0; i < W / 6; i++) { const x = r() * W, y = GROUND - 1 + Math.floor(r() * 9); px.set(x, y, G.road[2]); if (r() > 0.6) px.set(x + 1, y, G.road[0]); }
  if (G.lava) for (let i = 0; i < 9; i++) { let x = r() * W, y = GROUND + 10 + Math.floor(r() * 14); for (let k = 0; k < 10; k++) { px.set(x, y, k % 3 ? "#ff7a2a" : "#ffc04a"); x += 1; if (r() > 0.6) y += r() > 0.5 ? 1 : -1; } }
  for (const [name, count, pal] of G.props ?? []) { const g = PROPS[name]; for (let i = 0; i < count * W / BW; i++) { const x = Math.floor(r() * W); const lower = r() > 0.55; const by = lower ? GROUND + 11 + Math.floor(r() * 12) : GROUND - 5 + Math.round(fx(x)) - Math.floor(r() * 3); px.stamp(g, pal, x, by, r() > 0.5); } }
  return px.done();
}

window.BG_ALL = () => {
  const out = {};
  let seed = 100;
  for (const [b, def] of Object.entries(BIOME_DEF)) {
    out[`bg_${b}_sky`] = makeSky(def, seed++);
    out[`bg_${b}_far`] = makeLayer(def.far, seed++, 256, "far");
    out[`bg_${b}_mid`] = makeLayer(def.mid, seed++, 512, "mid");
    out[`bg_${b}_ground`] = makeGround(def.ground, seed++, 512);
  }
  return out;
};
window.BG_CONST = { BW, BH, GROUND };
