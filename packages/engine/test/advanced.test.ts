import { describe, it, expect, beforeAll } from "vitest";
import { validateFiles, type Story, type StoryFiles } from "@my-oasis/schema";
import { Game, createQuickJsRunner, type ScriptRunner, soundOpts, shaderUniforms } from "../src/index.js";
import { PHYSICS_JS } from "../src/physics-sandbox.js";

const enc = (s: string) => new TextEncoder().encode(s);
let runner: ScriptRunner;
beforeAll(async () => { runner = await createQuickJsRunner({ timeScale: 1000 }); });

const head = `spec: oasis/0.4
meta: { id: adv, title: { zh: 测, en: T }, version: 1.0.0, summary: { zh: 测, en: T }, language: zh-CN, rating: all-ages }
`;
function game(yaml: string, files: Record<string, string>, seed = 1) {
  const m: StoryFiles = new Map([["story.yaml", enc(head + yaml)]]);
  for (const [k, v] of Object.entries(files)) m.set(k, enc(v));
  const r = validateFiles(m);
  if (!r.ok) throw new Error(JSON.stringify(r.issues.filter((i) => i.level === "error")));
  const g = new Game(r.story as Story, { seed, files: m, scripts: runner }); g.start(); return g;
}

const physYaml = `state:
  world: { type: json, init: null, visible: none }
  hits: { type: number, init: 0, visible: none }
realtime: { tick_hz: 30, on_tick: scripts/p.js#tick }
ui:
  components:
    c: { type: canvas, region: main, render: scripts/p.js#draw }
`;
const physJs = `
function tick(api) {
  let w = api.state.get("world");
  if (!w) {
    w = api.physics.world({ gravity: [0, 980] });
    api.physics.add(w, { id: "ground", type: "static", x: 160, y: 230, w: 320, h: 20 });
    api.physics.add(w, { id: "ramp", type: "static", shape: "polygon", x: 0, y: 0, points: [[200, 220], [300, 220], [300, 150]] });
    api.physics.add(w, { id: "coin", type: "static", sensor: true, x: 60, y: 200, w: 20, h: 20 });
    for (let i = 0; i < 3; i++) api.physics.add(w, { id: "box" + i, x: 60, y: 209 - i * 21, w: 20, h: 20 });
    api.physics.add(w, { id: "ball", shape: "circle", x: 290, y: 100, r: 6, restitution: 0.2 });
    api.physics.add(w, { id: "bob", shape: "circle", x: 150, y: 60, r: 4 });
    api.physics.joint(w, { type: "pin", a: "bob", x: 120, y: 20 });
  }
  const ev = api.physics.step(w, api.dt);
  for (const e of ev) if (e.type === "begin" && e.sensor) api.state.inc("hits", 1);
  api.state.set("world", w);
}
function draw(api) { const w = api.state.get("world"); if (w) for (const b of w.bodies) { const v = api.physics.vertices(b); if (v) api.draw.rect(b.x, b.y, 2, 2, "#fff"); } }
`;

describe("内置物理（沙箱里运行）", () => {
  it("叠放稳定、球滚下斜坡、传感器报事件、关节保持长度，并且可重现", () => {
    const run = () => { const g = game(physYaml, { "scripts/p.js": physJs }); for (let i = 0; i < 90; i++) { const r = g.tick(1000 / 30); if (!r.ok) throw new Error(r.error); } return g; };
    const g = run(), w = g.state.world;
    const by = (id: string) => w.bodies.find((b: any) => b.id === id);
    expect(Math.abs(by("box2").x - 60)).toBeLessThan(2);
    expect(Math.abs(by("box2").angle)).toBeLessThan(0.05);
    expect(by("ball").x).toBeLessThan(200); // 滚下了斜坡
    expect(g.state.hits).toBeGreaterThan(0);
    const bob = by("bob"); expect(Math.hypot(bob.x - 120, bob.y - 20)).toBeCloseTo(50, 0);
    expect(JSON.stringify(run().state.world)).toBe(JSON.stringify(w));
    expect(g.renderCanvas("c").length).toBeGreaterThan(3);
  });
  it("凹多边形取凸包、参数错误给出说明", () => {
    const P = new Function(PHYSICS_JS + "; return __phys;")();
    const w = P.world({});
    const b = P.add(w, { shape: "polygon", points: [[0, 0], [10, 0], [5, 2], [10, 10], [0, 10]] });
    expect(b.points.length).toBe(4);
    expect(() => P.add(w, { shape: "polygon", points: [[0, 0], [1, 1], [2, 2]] })).toThrow(/直线/);
    expect(() => P.joint(w, { a: "nope" })).toThrow(/不存在/);
  });
});

describe("场景文件", () => {
  const yaml = `state:
  log: { type: list, of: string, init: [], visible: none }
realtime: { tick_hz: 30, on_ui: scripts/main.js#ui }
scenes:
  start: title
  list:
    title: { script: scenes/title.js }
    play: { script: scenes/play.js }
ui:
  components:
    c: { type: canvas, region: main }
`;
  const files = {
    "scripts/main.js": "function ui(api) { api.state.add('log', 'global-ui'); }",
    "scenes/title.js": `function enter(api) { api.state.add("log", "title.enter"); }
function tick(api) { if (api.time >= 100) api.scene.go("play", { data: { level: 3 } }); }
function exit(api) { api.state.add("log", "title.exit:" + api.params.to); }
function render(api) { api.draw.text("TITLE", 0, 0); }`,
    "scenes/play.js": `const enter = (api) => { api.state.add("log", "play.enter:" + api.params.from + ":" + api.params.data.level + ":" + api.scene.current()); };
function ui(api) { api.state.add("log", "play.ui:" + api.params.id); }
function render(api) { api.draw.text("PLAY " + api.params.canvas, 0, 0); }`,
  };
  it("开始场景、enter/exit/tick/render/ui、切换带数据", () => {
    const g = game(yaml, files);
    g.tick(34); expect(g.state.log).toEqual(["title.enter"]);
    expect(g.renderCanvas("c")[0][1]).toBe("TITLE");
    for (let i = 0; i < 3; i++) g.tick(34);
    expect(g.state.log).toEqual(["title.enter", "title.exit:play", "play.enter:title:3:play"]);
    expect(g.extra.rt_scene).toBe("play");
    expect(g.renderCanvas("c")[0][1]).toBe("PLAY c");
    g.deliverUi({ type: "button", id: "ok" });
    expect(g.state.log.slice(-2)).toEqual(["global-ui", "play.ui:ok"]);
  });
  it("切到没声明的场景会报错并撤销这一步", () => {
    const g = game(yaml, { ...files, "scenes/title.js": "function tick(api) { api.state.add('log', 'x'); api.scene.go('nowhere'); }" });
    const r = g.tick(34); expect(r.ok).toBe(false); expect(r.error).toMatch(/nowhere/);
    expect(g.state.log).toEqual([]);
  });
});

describe("Tiled、声音、视频纹理、屏幕控件、着色器参数", () => {
  const tmj = JSON.stringify({ width: 3, height: 2, tilewidth: 8, tileheight: 8, tilesets: [{ firstgid: 1, name: "t", image: "tiles.png", tilewidth: 8, tileheight: 8, columns: 2, tilecount: 4 }],
    layers: [{ type: "tilelayer", name: "solid", width: 3, height: 2, data: [1, 1, 0, 0, 0, 1] }, { type: "objectgroup", name: "obj", objects: [{ id: 7, name: "door", x: 4, y: 4, width: 8, height: 8 }] }] });
  const yaml = `state:
  out: { type: json, init: null, visible: none }
assets:
  tiles: { type: image, path: tiles.png }
  map: { type: tilemap, path: map.tmj }
  boom: { type: audio, path: boom.ogg }
  clip: { type: video, path: clip.webm }
realtime: { tick_hz: 30, on_tick: s.js#tick }
input:
  controls: [ { id: jump, type: button }, { id: move, type: joystick } ]
ui:
  components:
    c: { type: canvas, region: main, render: s.js#draw }
`;
  const s = `function tick(api) {
  const m = api.tiled.get("map");
  api.state.set("out", { solids: api.tiled.solids("map"), layers: m.layers.map((l) => l.name), door: m.layers[1].objects[0].name });
  api.sound.listener({ x: 0, y: 0 });
  api.sound.play("boom", { voice: "v1", x: 100, y: 0, reverb: 2, filter: { type: "lowpass", freq: 99999, q: 2 }, evil: "<script>" });
  api.sound.set("v1", { volume: 0.5, filter: null });
  api.video.texture("clip", { play: true, loop: true, rate: 9 });
  api.controls.show(["jump"]);
}
function draw(api) { api.draw.tiled("map", { x: 0 }); api.draw.post("fx", { u_k: 1 }); api.draw.nine("tiles", 0, 0, 50, 20, { slice: 3 }); api.draw.video("clip", 0, 0, 32, 18); }`;
  it("api.tiled 返回图层与合并后的碰撞矩形；效果都经过清洗", () => {
    const g = game(yaml, { "s.js": s, "map.tmj": tmj, "tiles.png": "x", "boom.ogg": "x", "clip.webm": "x" });
    expect(g.tick(34).ok).toBe(true);
    expect(g.state.out).toEqual({ solids: [{ x: 0, y: 0, w: 16, h: 8 }, { x: 16, y: 8, w: 8, h: 8 }], layers: ["solid", "obj"], door: "door" });
    const fx = g.takeEffects();
    expect(fx.sounds[0]).toEqual({ op: "listener", id: null, x: 0, y: 0 });
    expect(fx.sounds[1]).toEqual({ op: "play", id: "boom", voice: "v1", x: 100, y: 0, reverb: 1, filter: { type: "lowpass", freq: 22000, q: 2 } });
    expect(fx.sounds[2]).toEqual({ op: "set", id: null, voice: "v1", volume: 0.5, filter: null });
    expect(fx.ui).toEqual([{ op: "vtex", id: "clip", play: true, loop: true, rate: 4 }, { op: "controls", visible: ["jump"] }]);
    expect(g.renderCanvas("c").map((c) => c[0])).toEqual(["tiled", "post", "nine", "video"]);
  });
  it("soundOpts / shaderUniforms 只留白名单", () => {
    expect(soundOpts({ filter: { type: "evil", freq: 1 }, volume: "x" })).toEqual({});
    expect(shaderUniforms({ u_a: 1, u_b: [1, 2], u_c: [1], bad: 2, u_d: "x", u_e: [1, 2, 3, 4, 5] })).toEqual({ u_a: 1, u_b: [1, 2] });
  });
});
