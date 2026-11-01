import { describe, it, expect } from "vitest";
import { validateFiles, filesFromText, checkShaderSource, parseTiled, tiledSolids, tiledTile } from "../src/index.js";

const base = `spec: oasis/0.4
meta: { id: adv, title: { zh: 测, en: T }, version: 1.0.0, summary: { zh: 测, en: T }, language: zh-CN, rating: all-ages }
realtime: { tick_hz: 30 }
`;
const map = (extra: any = {}) => JSON.stringify({ width: 4, height: 2, tilewidth: 16, tileheight: 16, orientation: "orthogonal",
  tilesets: [{ firstgid: 1, name: "t", image: "../img/tiles.png", tilewidth: 16, tileheight: 16, columns: 4, tilecount: 16 }],
  layers: [{ type: "tilelayer", name: "ground", width: 4, height: 2, data: [0, 0, 0, 0, 1, 2, 0, 3] },
    { type: "tilelayer", name: "walls", properties: [{ name: "collision", type: "bool", value: true }], width: 4, height: 2, data: [1, 1, 0, 0, 0, 0, 0, 2] },
    { type: "objectgroup", name: "things", objects: [{ id: 1, name: "spawn", type: "player", x: 8, y: 8, point: true }] }], ...extra });
const errs = (y: string, files: Record<string, string> = {}) => validateFiles(filesFromText(y, files)).issues.filter((i) => i.level === "error").map((i) => i.code);

describe("着色器检查", () => {
  it("正常着色器通过", () => expect(checkShaderSource("uniform float u_k;\nvoid main(){ vec4 c = texture2D(uTex, vUv); for (int i = 0; i < 8; i++) { c.r += 0.01; } gl_FragColor = c * vCol * u_k; }")).toBeNull());
  it("拒绝 while、过长循环、#extension、重复声明、其它纹理", () => {
    expect(checkShaderSource("void main(){ while(true){} gl_FragColor = vec4(1.0); }")).toMatch(/while/);
    expect(checkShaderSource("void main(){ for (int i = 0; i < 100000; i++) {} gl_FragColor = vec4(1.0); }")).toMatch(/256/);
    expect(checkShaderSource("#extension GL_OES_standard_derivatives : enable\nvoid main(){ gl_FragColor = vec4(1.0); }")).toMatch(/预处理/);
    expect(checkShaderSource("uniform sampler2D uTex;\nvoid main(){ gl_FragColor = vec4(1.0); }")).toBeTruthy();
    expect(checkShaderSource("uniform sampler2D u_other;\nvoid main(){ gl_FragColor = vec4(1.0); }")).toBeTruthy();
    expect(checkShaderSource("x".repeat(40000))).toMatch(/KB/);
  });
});

describe("Tiled 地图", () => {
  it("解析图层、碰撞、对象、图块位置", () => {
    const m = parseTiled(map(), "maps/a.tmj", (p) => (p === "img/tiles.png" ? "tiles" : undefined));
    expect(m.tilesets[0].asset).toBe("tiles");
    expect(m.layers.map((l) => l.name)).toEqual(["ground", "walls", "things"]);
    expect(tiledSolids(m)).toEqual([{ x: 0, y: 0, w: 32, h: 16 }, { x: 48, y: 16, w: 16, h: 16 }]);
    expect(tiledTile(m, 2)).toMatchObject({ sx: 16, sy: 0 });
    expect(tiledTile(m, (2 | 0x80000000) >>> 0)?.flipH).toBe(true);
  });
  it("拒绝无限地图和外部图块集", () => {
    expect(() => parseTiled(map({ infinite: true }))).toThrow(/无限/);
    expect(() => parseTiled(map({ tilesets: [{ firstgid: 1, source: "t.tsj" }] }))).toThrow(/嵌入/);
  });
});

describe("校验：着色器、地图、场景、屏幕控件", () => {
  it("完整写法通过", () => {
    const y = base + `assets:
  tiles: { type: image, path: img/tiles.png }
  wave: { type: shader, path: fx/wave.glsl }
  level: { type: tilemap, path: maps/a.tmj }
scenes:
  start: title
  list:
    title: { script: scenes/title.js }
    play: { script: scenes/play.js }
input:
  controls:
    - { id: jump, type: button, anchor: bottom_right, x: -24, y: -24, label: { zh: 跳, en: Jump } }
    - { id: move, type: joystick, anchor: bottom_left }
ui:
  takeover: true
  layout: { template: custom, grid: ["screen"] }
  components:
    screen: { type: canvas, region: screen, size: fill }
`;
    const files = { "img/tiles.png": "x", "fx/wave.glsl": "void main(){ gl_FragColor = texture2D(uTex, vUv); }", "maps/a.tmj": map(), "scenes/title.js": "", "scenes/play.js": "" };
    expect(errs(y, files)).toEqual([]);
  });
  it("报出坏着色器、未登记的图块图片、错误的场景和控件", () => {
    const y = base + `assets:
  wave: { type: shader, path: fx/wave.glsl }
  level: { type: tilemap, path: maps/a.tmj }
scenes: { start: nope, list: { title: { script: scenes/missing.js } } }
input:
  controls:
    - { id: a, type: button, image: nothing }
    - { id: a, type: dpad }
`;
    const e = errs(y, { "fx/wave.glsl": "void main(){ while(true){} }", "maps/a.tmj": map() });
    for (const c of ["shader_bad", "tilemap_image", "unknown_scene", "missing_file", "duplicate_control", "unknown_asset"]) expect(e).toContain(c);
  });
});
