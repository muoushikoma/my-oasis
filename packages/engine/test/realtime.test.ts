import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateFiles, filesFromText, type Story, type StoryFiles } from "@my-oasis/schema";
import { Game, runEntry, createQuickJsRunner, type ScriptRunner, type LLM } from "../src/index.js";

const dir = new URL("../../../tests/fixtures/realtime-mini/", import.meta.url).pathname;
function loadDir(d: string): StoryFiles {
  const m: StoryFiles = new Map();
  const walk = (p: string, rel: string) => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) walk(f, rel + n + "/"); else m.set(rel + n, new Uint8Array(readFileSync(f))); } };
  walk(d, ""); return m;
}
const files = loadDir(dir);
const r = validateFiles(files);
if (!r.ok) throw new Error(JSON.stringify(r.issues));
const story = r.story as Story;
let runner: ScriptRunner;
beforeAll(async () => { runner = await createQuickJsRunner(); });
const mk = (seed = 1) => { const g = new Game(story, { seed, files, scripts: runner }); g.start(); return g; };

describe("oasis/0.4 实时：星星收集者", () => {
  it("示例通过校验，0.3 故事仍然兼容", () => {
    expect(story.spec).toBe("oasis/0.4");
    const old = validateFiles(filesFromText(readFileSync(new URL("../../../tests/fixtures/guess-the-box/story.yaml", import.meta.url), "utf8")));
    expect(old.ok).toBe(true);
  });
  it("tick 按输入移动主角，dt 被限制在 250ms 内", () => {
    const g = mk();
    g.tick(100, { held: { right: true } });
    expect(g.state.hero.x).toBeCloseTo(49, 0);
    g.tick(10_000, { held: { right: true } }); // 只按 250ms 算
    expect(g.state.hero.x).toBeCloseTo(49 + 22.5, 0);
    g.tick(100, { held: {}, joystick: { x: 0, y: 1 } });
    expect(g.state.hero.y).toBeCloseTo(49, 0);
    expect(g.rtTime).toBe(450);
  });
  it("定时器：after_ms 首次触发、every_ms 循环；同种子结果相同", () => {
    const a = mk(5), b = mk(5);
    for (let i = 0; i < 70; i++) { a.tick(33); b.tick(33); }
    expect(a.state.time_left).toBe(58);
    expect(a.state.stars.length).toBe(2);
    expect(a.state.stars).toEqual(b.state.stars);
  });
  it("吃到星星：加分、发出声音效果，到 5 分时异步请求 AI", async () => {
    const g = mk();
    g.state.stars = [{ x: 45, y: 40 }]; g.state.score = 4;
    g.tick(16, { held: { right: true } });
    expect(g.state.score).toBe(5);
    const fx = g.takeEffects();
    expect(fx.sounds).toEqual([{ op: "play", id: "pickup", volume: undefined, loop: undefined }]);
    expect(fx.ai).toHaveLength(1);
    expect(g.takeEffects().ai).toHaveLength(0);
    // AI 返回结构化 JSON；在它回来之前循环继续
    const llm: LLM = { async chat() { return { content: JSON.stringify({ line: "太棒了！" }) }; } } as any;
    const p = runEntry(g, fx.ai[0].entry, llm, fx.ai[0].input, fx.ai[0].data);
    g.tick(16);
    const res = await p;
    expect(res.json).toEqual({ line: "太棒了！" });
    g.deliverAi({ req: fx.ai[0].req, entry: fx.ai[0].entry, data: res.json, text: res.text });
    expect(g.state.comment).toBe("太棒了！");
  });
  it("render 产出绘制指令（含相机和图块地图），且不能改状态", () => {
    const g = mk();
    const cmds = g.renderCanvas("screen");
    expect(cmds[0]).toEqual(["clear", "#101418"]);
    expect(cmds.some((c) => c[0] === "camera")).toBe(true);
    const tm = cmds.find((c) => c[0] === "tilemap")!;
    expect(tm[1].map).toHaveLength(22);
    expect(tm[1].tileset).toBe("tiles");
  });
  it("结局：时间耗尽", () => {
    const g = mk();
    for (let i = 0; i < 61 * 4 && !g.ending; i++) g.tick(250);
    expect(g.ending).toBe("timeout");
    const t = g.rtTime; g.tick(100); expect(g.rtTime).toBe(t);
  });
});

describe("oasis/0.4 实时：沙箱与限制", () => {
  const base = (tick: string, extra = "") => {
    const y = `spec: oasis/0.4
meta: { id: rt-x, title: x, version: 1.0.0, summary: x, language: zh-CN, rating: all-ages }
state:
  n: { type: number, init: 0 }
  blob: { type: json, init: null }
realtime: { tick_ms: 20, on_tick: s.js#tick }
${extra}`;
    const f = filesFromText(y, { "s.js": tick });
    const v = validateFiles(f); if (!v.ok) throw new Error(JSON.stringify(v.issues));
    const g = new Game(v.story as Story, { files: f, scripts: runner }); g.start(); return g;
  };
  it("死循环被时间限制打断，这一帧撤销、循环继续", () => {
    const g = base(`export function tick(api){ api.state.inc("n", 1); if (api.time > 20) { while(true){} } }`);
    expect(g.tick(16).ok).toBe(true);
    const t0 = Date.now(); const r = g.tick(16); expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.ok).toBe(false); expect(g.state.n).toBe(1);
    expect(g.log.some((l) => l.kind === "error")).toBe(true);
  });
  it("内存超限被打断", () => {
    const g = base(`export function tick(api){ const a=[]; for(;;) a.push("x".repeat(1e5)); }`);
    expect(g.tick(16).ok).toBe(false);
  });
  it("render 之外不能画；未登记的声音被拒绝；json 状态可写", () => {
    expect(base(`export function tick(api){ api.draw.rect(0,0,1,1); }`).tick(16).ok).toBe(false);
    expect(base(`export function tick(api){ api.sound.play("nope"); }`).tick(16).ok).toBe(false);
    const g = base(`export function tick(api){ api.state.set("blob", { a: [1, 2], b: { c: true } }); }`);
    expect(g.tick(16).ok).toBe(true); expect(g.state.blob).toEqual({ a: [1, 2], b: { c: true } });
  });
  it("0.3 故事使用 0.4 功能会提示改 spec", () => {
    const f = filesFromText(`spec: oasis/0.3
meta: { id: rt-y, title: x, version: 1.0.0, summary: x, language: zh-CN, rating: all-ages }
state: { n: { type: number, init: 0 } }
realtime: { on_tick: s.js#tick }`, { "s.js": "export function tick(){}" });
    const v = validateFiles(f);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === "needs_0_4")).toBe(true);
  });
});
