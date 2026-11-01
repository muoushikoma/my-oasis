import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const strToU8 = (s: string) => new TextEncoder().encode(s);
import { validateFiles, type Story, type StoryFiles } from "@my-oasis/schema";
import { Game, createQuickJsRunner, type ScriptRunner } from "../src/index.js";

const dir = new URL("../../../tests/fixtures/realtime-mini/", import.meta.url).pathname;
function loadDir(d: string): StoryFiles {
  const m: StoryFiles = new Map();
  const walk = (p: string, rel: string) => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) walk(f, rel + n + "/"); else m.set(rel + n, new Uint8Array(readFileSync(f))); } };
  walk(d, ""); return m;
}
let runner: ScriptRunner;
beforeAll(async () => { runner = await createQuickJsRunner({ timeScale: 1000 }); });

function build(extraScript: string, patch: (y: string) => string) {
  const files = loadDir(dir);
  files.set("story.yaml", strToU8(patch(new TextDecoder().decode(files.get("story.yaml")!))));
  files.set("scripts/ui.js", strToU8(extraScript));
  files.set("assets/intro.webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
  const r = validateFiles(files);
  if (!r.ok) throw new Error(JSON.stringify(r.issues.filter((i) => i.level === "error")));
  const g = new Game(r.story as Story, { seed: 1, files, scripts: runner }); g.start(); return g;
}
const script = `
export function ask(api) { api.textinput.open({ id: "name", placeholder: { zh: "名字", en: "Name" }, max_length: 8, multiline: false }); }
export function film(api) { api.video.play("intro", { skippable: true }); }
export function onUi(api) { const p = api.params; if (p.type === "text" && !p.cancelled) api.state.set("comment", p.text); if (p.type === "video") api.state.set("comment", p.skipped ? "skip" : "end"); }
`;
const patch = (y: string) => y
  .replace("  on_ai: scripts/game.js#onAi", "  on_ai: scripts/game.js#onAi\n  on_ui: scripts/ui.js#onUi")
  .replace("actions:\n", "actions:\n  ask: { script: scripts/ui.js#ask }\n  film: { script: scripts/ui.js#film }\n")
  .replace("assets:\n", "assets:\n  intro: { type: video, path: assets/intro.webm, use: other }\n");

describe("原生界面：输入框和视频", () => {
  it("api.textinput.open 产生输入框请求，结果交给 on_ui（截断到 2000 字）", () => {
    const g = build(script, patch);
    expect(g.doAction("ask", {}, "rules").ok).toBe(true);
    const fx = g.takeEffects();
    expect(fx.ui).toHaveLength(1);
    const u: any = fx.ui[0];
    expect(u).toMatchObject({ op: "text.open", id: "name", max_length: 8, multiline: false });
    g.deliverUi({ type: "text", request: u.req, id: "name", text: "小雪", cancelled: false });
    expect(g.state.comment).toBe("小雪");
  });
  it("api.video.play 只接受登记过的视频素材", () => {
    const g = build(script, patch);
    expect(g.doAction("film", {}, "rules").ok).toBe(true);
    const u: any = g.takeEffects().ui[0];
    expect(u).toMatchObject({ op: "video.play", id: "intro", skippable: true });
    g.deliverUi({ type: "video", request: u.req, id: "intro", ended: false, skipped: true });
    expect(g.state.comment).toBe("skip");
    const bad = build(`export function film(api) { api.video.play("pickup"); }`, patch);
    expect(bad.doAction("film", {}, "rules").ok).toBe(false);
  });
});

describe("引擎工具：缓动、碰撞、物理、界面层、场景、本地数据", () => {
  const tools = `
export function run(api) {
  const out = {};
  out.ease = api.ease.out_quad(0.5);
  out.hit = api.collide.rect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 });
  out.miss = api.collide.circle({ x: 0, y: 0, r: 1 }, { x: 5, y: 0, r: 1 });
  out.mv = api.physics.move({ x: 0, y: 0, w: 8, h: 8 }, 30, 0, { map: ["..#"], tile: 16, solid: ["#"] });
  out.fall = api.physics.move({ x: 0, y: 0, w: 8, h: 8 }, 0, 50, { rects: [{ x: 0, y: 20, w: 100, h: 5 }] });
  api.storage.set("best", 42); out.best = api.storage.get("best");
  api.overlay.show("hud", { anchor: "top", children: [{ type: "button", id: "go", text: { zh: "开始", en: "Start" }, onclick: "alert(1)" }, { type: "text", text: "<b>x</b>" }] });
  api.fx.shake(8, 200); api.device.vibrate([50, 9999]);
  api.state.set("comment", JSON.stringify(out));
}`;
  it("工具函数结果正确，界面描述被清洗", () => {
    const mem: Record<string, any> = {};
    const g = build(tools, (y) => y.replace("actions:\n", "actions:\n  run: { script: scripts/ui.js#run }\n"));
    (g.opts as any).storage = { get: (k: string) => mem[k], set: (k: string, v: any) => { mem[k] = v; } };
    expect(g.doAction("run", {}, "rules").ok).toBe(true);
    const out = JSON.parse(g.state.comment);
    expect(out.ease).toBeCloseTo(0.75);
    expect(out.hit).toBe(true); expect(out.miss).toBe(false);
    expect(out.mv).toMatchObject({ x: 24, hit_x: true });
    expect(out.fall).toMatchObject({ y: 12, on_ground: true });
    expect(out.best).toBe(42);
    const ui: any[] = g.takeEffects().ui;
    const ov = ui.find((u) => u.op === "overlay.show");
    expect(ov.spec.children[0]).toMatchObject({ type: "button", id: "go", text: { zh: "开始", en: "Start" } });
    expect(ov.spec.children[0].onclick).toBeUndefined();
    expect(ui.find((u) => u.op === "vibrate").pattern).toEqual([50, 1000]);
  });
  it("api.scene.go 需要声明 scene 状态", () => {
    const g = build(`export function go(api) { api.scene.go("forest", { fade_ms: 200 }); }`, (y) => y.replace("actions:\n", "actions:\n  go: { script: scripts/ui.js#go }\n"));
    expect(g.doAction("go", {}, "rules").ok).toBe(false);
    const g2 = build(`export function go(api) { api.scene.go("forest", { fade_ms: 200 }); }`, (y) => y.replace("actions:\n", "actions:\n  go: { script: scripts/ui.js#go }\n").replace("state:\n", "state:\n  scene: { type: string, init: title, visible: none }\n"));
    expect(g2.doAction("go", {}, "rules").ok).toBe(true);
    expect(g2.state.scene).toBe("forest");
    expect(g2.takeEffects().ui[0]).toMatchObject({ op: "fade", in_ms: 200 });
  });
});
