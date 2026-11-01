// 高级引擎功能：后期着色器检查、刚体物理、Tiled 地图、场景、音效参数、触摸按键、画布里的视频/九宫格指令
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateFiles, buildShader, cleanUniforms, parseTiled, type Story, type StoryFiles } from "@my-oasis/schema";
import { Game, createQuickJsRunner, createWorld, addBody, addJoint, stepWorld, getBody, type ScriptRunner } from "../src/index.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dir = new URL("../../../tests/fixtures/realtime-mini/", import.meta.url).pathname;
function loadDir(d: string): StoryFiles {
  const m: StoryFiles = new Map();
  const walk = (p: string, rel: string) => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) walk(f, rel + n + "/"); else m.set(rel + n, new Uint8Array(readFileSync(f))); } };
  walk(d, ""); return m;
}
let runner: ScriptRunner;
beforeAll(async () => { runner = await createQuickJsRunner({ timeScale: 1000 }); });

function build(extra: Record<string, string>, patch: (y: string) => string, expectOk = true) {
  const files = loadDir(dir);
  files.set("story.yaml", enc(patch(new TextDecoder().decode(files.get("story.yaml")!))));
  for (const [k, v] of Object.entries(extra)) files.set(k, enc(v));
  const r = validateFiles(files);
  if (!expectOk) return { r };
  if (!r.ok) throw new Error(JSON.stringify(r.issues.filter((i) => i.level === "error")));
  const g = new Game(r.story as Story, { seed: 1, files, scripts: runner }); g.start(); return { g, r, files };
}
const addAssets = (y: string, s: string) => y.replace("assets:\n", "assets:\n" + s);
const addActions = (y: string, s: string) => y.replace("actions:\n", "actions:\n" + s);

const GOOD = `// vignette + tint
vec4 effect(vec4 color, vec2 uv) {
  float d = distance(uv, vec2(0.5));
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 4; i++) { acc += texture2D(u_scene, uv + vec2(float(i) * u_texel.x, 0.0)); }
  return mix(acc / 4.0, color * u_tint, 0.5) * (1.0 - d * u_strength);
}`;

describe("后期着色器：模板 + 静态检查", () => {
  it("合法的 effect 函数生成完整片元着色器", () => {
    const r = buildShader(GOOD, { tint: "vec4", strength: "float", noise: "texture" });
    expect(r.errors).toEqual([]);
    expect(r.fragment).toContain("uniform vec4 u_tint;");
    expect(r.fragment).toContain("uniform sampler2D u_noise;");
    expect(r.fragment).toContain("gl_FragColor = effect(texture2D(u_scene, v_uv), v_uv);");
  });
  it("拒绝预处理指令、自己声明 uniform、while、改写 main、超长循环、非英文字符", () => {
    const bad = (src: string) => buildShader(src).ok;
    expect(bad("#define X 1\nvec4 effect(vec4 c, vec2 uv) { return c; }")).toBe(false);
    expect(bad("uniform float a; vec4 effect(vec4 c, vec2 uv) { return c; }")).toBe(false);
    expect(bad("vec4 effect(vec4 c, vec2 uv) { while (true) {} return c; }")).toBe(false);
    expect(bad("void main() {} vec4 effect(vec4 c, vec2 uv) { return c; }")).toBe(false);
    expect(bad("vec4 effect(vec4 c, vec2 uv) { for (int i = 0; i < 1000; i++) { c *= 0.99; } return c; }")).toBe(false);
    expect(bad("vec4 effect(vec4 c, vec2 uv) { int n = 3; for (int i = 0; i < n; i++) { c *= 0.9; } return c; }")).toBe(false);
    expect(bad("vec4 effect(vec4 c, vec2 uv) { return c; } // 中文注释")).toBe(false);
    expect(bad("vec3 notEffect(vec3 c) { return c; }")).toBe(false);
    expect(buildShader("vec4 effect(vec4 c, vec2 uv) { return c; }", { "Bad-Name": "float" }).ok).toBe(false);
    expect(buildShader("vec4 effect(vec4 c, vec2 uv) { return c; }", { m: "mat4" }).ok).toBe(false);
  });
  it("uniform 值只收数字或已登记图片", () => {
    const u = cleanUniforms({ tint: [1, "x", 0.5], strength: Infinity, noise: "tiles", other: 5 }, { tint: "vec4", strength: "float", noise: "texture" }, (id) => id === "tiles");
    expect(u).toEqual({ tint: [1, 0, 0.5, 0], strength: [0], noise: "tiles" });
    expect(cleanUniforms({ noise: "<script>" }, { noise: "texture" }, () => false)).toEqual({});
  });
  it("校验器会检查故事包里的着色器；draw.post 指令传到客户端", () => {
    const patch = (y: string) => addAssets(y, "  vignette: { type: shader, path: shaders/v.frag, uniforms: { tint: vec4, strength: float } }\n")
      .replace("render: scripts/game.js#draw", "render: scripts/fx.js#draw");
    const { g } = build({ "shaders/v.frag": GOOD.replace(/, u_scene|u_scene, /g, "u_scene, ").replace("noise", "x"), "scripts/fx.js": `export function draw(api) { api.draw.clear("#000"); api.draw.post("vignette", { strength: 0.8, tint: [1, 0.9, 0.8, 1] }); }` }, patch) as any;
    const cmds = g.renderCanvas("screen");
    expect(cmds.at(-1)).toEqual(["post", "vignette", { strength: 0.8, tint: [1, 0.9, 0.8, 1] }]);
    const { r } = build({ "shaders/v.frag": "#version 300 es\nvoid main(){}" }, patch, false) as any;
    expect(r.ok).toBe(false);
    expect(r.issues.some((i: any) => i.code === "shader_check")).toBe(true);
  });
});

describe("刚体物理（纯引擎模块）", () => {
  const scene = () => {
    const w = createWorld({ gravity: [0, 980] });
    addBody(w, { type: "static", x: 200, y: 300, shape: { type: "box", w: 400, h: 20 } });
    const box = addBody(w, { x: 100, y: 100, shape: { type: "box", w: 20, h: 20 } });
    const ball = addBody(w, { x: 200, y: 50, shape: { type: "circle", r: 10 }, restitution: 0.5 });
    const tri = addBody(w, { x: 300, y: 80, shape: { type: "poly", points: [[0, -12], [12, 10], [-12, 10]] } });
    return { w, box, ball, tri };
  };
  it("物体落到地面上停住（不穿过去）", () => {
    const { w, box, ball, tri } = scene();
    for (let i = 0; i < 180; i++) stepWorld(w, 1000 / 60);
    const b = getBody(w, box)!, c = getBody(w, ball)!, t = getBody(w, tri)!;
    expect(b.y).toBeGreaterThan(275); expect(b.y).toBeLessThan(292); expect(Math.abs(b.vy)).toBeLessThan(30);
    expect(c.y).toBeGreaterThan(275); expect(c.y).toBeLessThan(292);
    expect(t.y).toBeGreaterThan(270); expect(t.y).toBeLessThan(292);
  });
  it("确定性：同样的输入得到一模一样的结果；世界是纯 JSON，存档后接着跑结果不变", () => {
    const a = scene(), b = scene();
    for (let i = 0; i < 90; i++) { stepWorld(a.w, 16.6); stepWorld(b.w, 16.6); }
    expect(JSON.stringify(a.w)).toBe(JSON.stringify(b.w));
    const copy = JSON.parse(JSON.stringify(a.w));
    for (let i = 0; i < 60; i++) { stepWorld(a.w, 16.6); stepWorld(copy, 16.6); }
    expect(JSON.stringify(copy)).toBe(JSON.stringify(a.w));
  });
  it("斜坡：放在倾斜的静态板上的箱子会往下滑", () => {
    const w = createWorld({ gravity: [0, 980] });
    addBody(w, { type: "static", x: 200, y: 200, angle: 0.4, shape: { type: "box", w: 400, h: 20 }, friction: 0.05 });
    const box = addBody(w, { x: 150, y: 150, angle: 0.4, shape: { type: "box", w: 20, h: 20 }, friction: 0.05 });
    const x0 = getBody(w, box)!.x;
    for (let i = 0; i < 120; i++) stepWorld(w, 1000 / 60);
    expect(getBody(w, box)!.x).toBeGreaterThan(x0 + 30);
  });
  it("传感器只报告进入/离开，不推开物体", () => {
    const w = createWorld({ gravity: [0, 980] });
    const s = addBody(w, { type: "static", sensor: true, tag: "coin", x: 100, y: 200, shape: { type: "box", w: 100, h: 20 } });
    const b = addBody(w, { x: 100, y: 100, shape: { type: "circle", r: 5 }, tag: "hero" });
    const begins: any[] = [], ends: any[] = [];
    for (let i = 0; i < 120; i++) { const e = stepWorld(w, 1000 / 60); begins.push(...e.begin); ends.push(...e.end); }
    expect(begins).toContainEqual({ a: s, b, sensor: true, tag_a: "coin", tag_b: "hero" });
    expect(ends).toContainEqual({ a: s, b });
    expect(getBody(w, b)!.y).toBeGreaterThan(250);
  });
  it("距离关节保持长度；铰链把两点连在一起", () => {
    const w = createWorld({ gravity: [0, 980] });
    const anchor = addBody(w, { type: "static", x: 100, y: 50, shape: { type: "circle", r: 2 } });
    const bob = addBody(w, { x: 180, y: 50, shape: { type: "circle", r: 8 } });
    addJoint(w, { type: "distance", a: anchor, b: bob });
    const link = addBody(w, { x: 300, y: 50, shape: { type: "box", w: 40, h: 6 } });
    addJoint(w, { type: "pin", a: anchor, b: link, ax: 200, ay: 0, bx: 0, by: 0 });
    for (let i = 0; i < 120; i++) stepWorld(w, 1000 / 60);
    const p = getBody(w, bob)!; expect(Math.hypot(p.x - 100, p.y - 50)).toBeCloseTo(80, -0.5);
    const l = getBody(w, link)!; expect(Math.hypot(l.x - 300, l.y - 50)).toBeLessThan(3);
  });
  it("拒绝凹多边形和太多物体", () => {
    const w = createWorld();
    expect(() => addBody(w, { shape: { type: "poly", points: [[0, 0], [10, 0], [5, 2], [10, 10], [0, 10]] } })).toThrow(/凸/);
    for (let i = 0; i < 512; i++) addBody(w, { shape: { type: "circle", r: 1 } });
    expect(() => addBody(w, { shape: { type: "circle", r: 1 } })).toThrow(/512/);
  });
  it("沙箱 API：世界在存档里，读存档后接着跑结果一致；出错的一帧撤销物理改动", () => {
    const script = `
export function setup(api) {
  api.physics.world({ gravity: [0, 980] });
  api.physics.add({ type: "static", x: 160, y: 230, shape: { type: "box", w: 320, h: 20 }, tag: "ground" });
  const id = api.physics.add({ x: 160, y: 20, shape: { type: "circle", r: 8 }, tag: "ball" });
  api.state.set("comment", String(id));
}
export function tick(api) {
  const ev = api.physics.step();
  for (const e of ev.begin) if (e.tag_b === "ball" || e.tag_a === "ball") api.state.set("comment", "hit");
  if (api.input.held.boom) { api.physics.impulse(Number(2), 0, -50); throw new Error("boom"); }
}
export function draw(api) { for (const b of api.physics.bodies("ball")) api.draw.circle(b.x, b.y, 8, "#fff"); }`;
    const patch = (y: string) => addActions(y, "  setup: { script: scripts/phys.js#setup }\n").replace("on_tick: scripts/game.js#tick", "on_tick: scripts/phys.js#tick").replace("render: scripts/game.js#draw", "render: scripts/phys.js#draw");
    const { g, files, r } = build({ "scripts/phys.js": script }, patch) as any;
    expect(g.doAction("setup", {}, "rules").ok).toBe(true);
    for (let i = 0; i < 40; i++) g.tick(1000 / 30, {});
    expect(g.state.comment).toBe("hit");
    const before = JSON.stringify(g.extra.physics);
    g.tick(1000 / 30, { held: { boom: true } });
    // 出错的一帧：物理世界恢复原样（时间也没有前进）
    expect(JSON.stringify(g.extra.physics)).toBe(before);
    const save = JSON.parse(JSON.stringify(g.save()));
    const g2 = Game.load(r.story, save, { files, scripts: runner }).game!;
    for (let i = 0; i < 20; i++) { g.tick(1000 / 30, { held: {} }); g2.tick(1000 / 30, { held: {} }); }
    expect(JSON.stringify(g2.extra.physics)).toBe(JSON.stringify(g.extra.physics));
    expect(g.renderCanvas("screen")[0][0]).toBe("circle");
    // render 里不能改物理世界
    const bad = build({ "scripts/phys.js": script.replace("export function draw(api) {", "export function draw(api) { api.physics.step();") }, patch) as any;
    bad.g.doAction("setup", {}, "rules"); expect(bad.g.renderCanvas("screen")).toEqual([]);
  });
});

const TMJ = {
  width: 4, height: 3, tilewidth: 16, tileheight: 16, orientation: "orthogonal", infinite: false,
  tilesets: [{ firstgid: 1, name: "t", image: "../assets/tiles.png", tilewidth: 16, tileheight: 16, columns: 4, tilecount: 8, tiles: [{ id: 5, properties: [{ name: "collision", type: "bool", value: true }] }] }, { firstgid: 9, source: "deco.tsj" }],
  layers: [
    { type: "tilelayer", name: "ground", width: 4, height: 3, visible: true, opacity: 1, data: [1, 2, 3, 4, 0, 0, 0, 0, 6, 6, 6, 6] },
    { type: "group", name: "g", layers: [{ type: "tilelayer", name: "deco", width: 4, height: 3, opacity: 0.5, offsetx: 2, data: [0, 9, 0, 0x8000000a, 0, 0, 0, 0, 0, 0, 0, 0] }] },
    { type: "tilelayer", name: "collision", width: 4, height: 3, data: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0] },
    { type: "objectgroup", name: "things", objects: [{ id: 1, name: "spawn", type: "player", x: 20, y: 10, point: true, properties: [{ name: "hp", type: "int", value: 3 }] }, { id: 2, name: "", type: "solid", x: 0, y: 0, width: 8, height: 8 }] },
  ],
};
describe("Tiled 地图导入", () => {
  const deco = JSON.stringify({ name: "deco", image: "../assets/tiles.png", tilewidth: 16, tileheight: 16, columns: 4, tilecount: 8 });
  it("多图层、多图块集（含外部 .tsj）、碰撞层、对象层", () => {
    const m = parseTiled(TMJ, "maps/a.tmj", (p) => (p === "assets/tiles.png" ? "tiles" : undefined), (p) => (p === "maps/deco.tsj" ? deco : undefined));
    expect(m.pixel_w).toBe(64);
    expect(m.layers.map((l) => l.name)).toEqual(["ground", "deco"]); // 碰撞层不画
    expect(m.layers[0].tilemaps[0]).toMatchObject({ tileset: "tiles", tile_w: 16, columns: 4 });
    expect(m.layers[0].tilemaps[0].map[0]).toEqual([0, 1, 2, 3]);
    expect(m.layers[1]).toMatchObject({ opacity: 0.5 });
    expect(m.layers[1].tilemaps[0].map[0]).toEqual([null, 0, null, 1]); // 翻转标志被去掉
    expect(m.layers[1].tilemaps[0].x).toBe(2);
    // 碰撞：第 2 行的两个格子（碰撞层）+ 第 3 行带 collision 属性的图块（合并成一个长条）+ 对象层里 type: solid 的矩形
    expect(m.collision).toContainEqual({ x: 0, y: 0, w: 8, h: 8 });
    expect(m.collision).toContainEqual({ x: 0, y: 32, w: 64, h: 16 });
    expect(m.collision).toContainEqual({ x: 0, y: 16, w: 16, h: 16 });
    expect(m.objects).toContainEqual(expect.objectContaining({ name: "spawn", type: "player", point: true, properties: { hp: 3 } }));
  });
  it("不支持的格式给出清楚的错误", () => {
    const none = () => undefined;
    expect(() => parseTiled({ ...TMJ, infinite: true }, "a.tmj", none, none)).toThrow(/无限/);
    expect(() => parseTiled({ ...TMJ, layers: [{ type: "tilelayer", name: "x", data: "AAAA", encoding: "base64", compression: "zlib" }] }, "a.tmj", none, () => deco)).toThrow(/CSV/);
    expect(() => parseTiled({ ...TMJ, orientation: "isometric" }, "a.tmj", none, none)).toThrow(/正交/);
  });
  it("api.tiled.load / api.draw.tiled；地图和图块集通过校验", () => {
    const patch = (y: string) => addAssets(y, "  level: { type: map, path: maps/a.tmj }\n")
      .replace("render: scripts/game.js#draw", "render: scripts/map.js#draw").replace("on_tick: scripts/game.js#tick", "on_tick: scripts/map.js#tick");
    const s = `export function tick(api) { const m = api.tiled.load("level"); api.state.set("comment", m.collision.length + ":" + m.objects[0].name); }
export function draw(api) { api.draw.tiled("level", { x: 0 }); }`;
    const { g } = build({ "maps/a.tmj": JSON.stringify(TMJ), "maps/deco.tsj": deco, "scripts/map.js": s }, patch) as any;
    g.tick(33, {});
    expect(g.state.comment).toBe("4:spawn");
    expect(g.renderCanvas("screen")).toEqual([["tiled", "level", { x: 0 }]]);
    const { r } = build({ "maps/a.tmj": JSON.stringify({ ...TMJ, tilesets: [{ ...TMJ.tilesets[0], image: "nope.png" }] }), "scripts/map.js": s }, patch, false) as any;
    expect(r.issues.some((i: any) => i.code === "map_tileset")).toBe(true);
  });
});

describe("场景文件（scenes）", () => {
  const s = `
export function menuEnter(api) { api.state.set("comment", "menu:" + (api.params.from || "")); }
export function menuTick(api) { if (api.input.pressed.dash) api.scene.go("level", { fade_ms: 0 }); }
export function menuExit(api) { api.state.inc("score", 1); }
export function levelEnter(api) { api.state.set("comment", "level:" + api.params.from); }
export function drawMenu(api) { api.draw.text("menu " + api.params.width, 0, 0); }
export function drawLevel(api) { api.draw.text("level " + api.params.width + "x" + api.params.height + " " + api.scene.current(), 0, 0); }`;
  const patch = (y: string) => y
    .replace("realtime:\n  tick_hz: 30", "scenes:\n  menu: { title: { zh: 菜单, en: Menu }, render: scripts/sc.js#drawMenu, on_enter: scripts/sc.js#menuEnter, on_tick: scripts/sc.js#menuTick, on_exit: scripts/sc.js#menuExit }\n  level: { canvas: { width: 640, height: 360 }, render: scripts/sc.js#drawLevel, on_enter: scripts/sc.js#levelEnter }\nrealtime:\n  start_scene: menu\n  tick_hz: 30")
    .replace("screen:  { type: canvas, region: main, width: 320, height: 240, render: scripts/game.js#draw, pixelated: true }", "screen:  { type: canvas, region: main, width: 320, height: 240, scenes: true }");
  it("每个场景有自己的脚本和画布尺寸；切换时调用 on_exit / on_enter；场景存进存档", () => {
    const { g, r, files } = build({ "scripts/sc.js": s }, patch) as any;
    expect(g.currentScene).toBe("menu");
    g.tick(33, {});
    expect(g.state.comment).toBe("menu:");
    expect(g.renderCanvas("screen")[0][1]).toBe("menu 320");
    g.tick(33, { pressed: { dash: true } });
    expect(g.currentScene).toBe("level"); expect(g.state.score).toBe(1);
    g.tick(33, {});
    expect(g.state.comment).toBe("level:menu");
    expect(g.canvasSize("screen")).toEqual({ width: 640, height: 360 });
    expect(g.renderCanvas("screen")[0][1]).toBe("level 640x360 level");
    const g2 = Game.load(r.story, JSON.parse(JSON.stringify(g.save())), { files, scripts: runner }).game!;
    expect(g2.currentScene).toBe("level");
  });
  it("校验：未知的 start_scene、scenes: true 但没有 scenes", () => {
    const { r } = build({ "scripts/sc.js": s }, (y) => patch(y).replace("start_scene: menu", "start_scene: nope"), false) as any;
    expect(r.issues.some((i: any) => i.code === "unknown_scene")).toBe(true);
    const { r: r2 } = build({}, (y) => y.replace("render: scripts/game.js#draw, pixelated: true", "scenes: true"), false) as any;
    expect(r2.issues.some((i: any) => i.code === "canvas_no_scenes")).toBe(true);
  });
});

describe("音效与空间音效、触摸按键、画布视频与九宫格指令", () => {
  const s = `
export function fx(api) {
  api.sound.play("pickup", { lowpass: 800, reverb: 0.4, reverb_s: 2, delay_ms: 200, delay_feedback: 0.3, x: 100, y: 50, spatial: true, evil: "x" });
  api.sound.listener(10, 20); api.sound.listener(30, 40); api.sound.move("pickup", 5, 6);
  api.touch.set("jump", { label: { zh: "跳", en: "Jump" }, visible: false });
}
export function badTouch(api) { api.touch.set("nope", {}); }
export function draw(api) { api.draw.video("pickup", 0, 0, 320, 240, { loop: true }); api.draw.nine("tiles", 10, 10, 100, 40, { slice: [4, 4, 4, 4] }); }`;
  const patch = (y: string) => addActions(y, "  fx: { script: scripts/fx.js#fx }\n  bad_touch: { script: scripts/fx.js#badTouch }\n")
    .replace("  pointer: true", "  pointer: true\n  touch:\n    - { id: jump, type: button, anchor: bottom_right, label: { zh: 跳, en: Jump } }\n    - { id: move, type: stick, anchor: bottom_left, size: 140 }\n    - { id: pad, type: dpad, anchor: left, keys: { up: up, down: down, left: left, right: right } }")
    .replace("render: scripts/game.js#draw", "render: scripts/fx.js#draw");
  it("音效参数只留白名单数字；听者位置同一帧只留最后一次；touch.set 只认声明过的按键", () => {
    const { g } = build({ "scripts/fx.js": s }, patch) as any;
    expect(g.doAction("fx", {}, "rules").ok).toBe(true);
    const e = g.takeEffects();
    expect(e.sounds[0]).toEqual({ op: "play", id: "pickup", lowpass: 800, reverb: 0.4, reverb_s: 2, delay_ms: 200, delay_feedback: 0.3, x: 100, y: 50, spatial: true });
    expect(e.sounds.filter((x: any) => x.op === "listener")).toEqual([{ op: "listener", id: null, x: 30, y: 40 }]);
    expect(e.sounds).toContainEqual({ op: "move", id: "pickup", x: 5, y: 6 });
    expect(e.ui).toContainEqual({ op: "touch.set", id: "jump", visible: false, label: { zh: "跳", en: "Jump" } });
    expect(g.doAction("bad_touch", {}, "rules").ok).toBe(false);
    expect(g.renderCanvas("screen").map((c: any[]) => c[0])).toEqual(["video", "nine"]);
  });
  it("触摸按键放在右上角会被提醒（那里是客户端出口）", () => {
    const { r } = build({ "scripts/fx.js": s }, (y) => patch(y).replace("anchor: bottom_right", "anchor: top_right")) as any;
    expect(r.issues.some((i: any) => i.code === "touch_corner")).toBe(true);
  });
  it("界面层九宫格背景：只收素材 id 和数字", async () => {
    const { sanitizeOverlay } = await import("../src/index.js");
    const o = sanitizeOverlay({ style: { bg_image: "panel", bg_slice: [8, "x", 8], bg_border: 12 }, children: [{ type: "button", text: "OK", style: { bg_image: "url(http://evil)" } }] });
    expect(o.style).toMatchObject({ bg_image: "panel", bg_slice: [8, 0, 8, 8], bg_border: [12, 12, 12, 12] });
    expect(o.children[0].style.bg_image).toBeUndefined();
  });
});
