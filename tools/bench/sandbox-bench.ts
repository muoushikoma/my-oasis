// 沙箱性能基准：pnpm bench（= tsx tools/bench/sandbox-bench.ts）
// 跑 realtime-mini 示例：每帧 1 次 on_tick + 1 次 render，另测一个“重”脚本（每帧 2000 条绘制指令）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateFiles, type Story, type StoryFiles } from "@my-oasis/schema";
import { Game, createQuickJsRunner } from "@my-oasis/engine";

const dir = new URL("../../tests/fixtures/realtime-mini/", import.meta.url).pathname;
const files: StoryFiles = new Map();
const walk = (p: string, rel: string) => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) walk(f, rel + n + "/"); else files.set(rel + n, new Uint8Array(readFileSync(f))); } };
walk(dir, "");
const r = validateFiles(files); if (!r.ok) throw new Error(JSON.stringify(r.issues));
const story = r.story as Story;
const runner = await createQuickJsRunner({ timeScale: 1000 });
const canvas = Object.entries(story.ui?.components ?? {}).find(([, c]: any) => c.type === "canvas")?.[0];

function bench(name: string, frames: number, f: () => void) {
  for (let i = 0; i < 20; i++) f(); // 预热
  const t: number[] = [];
  for (let i = 0; i < frames; i++) { const t0 = performance.now(); f(); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  const avg = t.reduce((a, b) => a + b, 0) / t.length;
  console.log(`${name.padEnd(34)} 平均 ${avg.toFixed(3)} ms   中位 ${t[t.length >> 1].toFixed(3)} ms   p95 ${t[Math.floor(t.length * 0.95)].toFixed(3)} ms`);
}
const g = new Game(story, { seed: 1, files, scripts: runner }); g.start();
bench("realtime-mini tick", 500, () => g.tick(33, { held: { right: true } }));
if (canvas) bench("realtime-mini render", 500, () => g.renderCanvas(canvas));
bench("realtime-mini tick+render (1 帧)", 500, () => { g.tick(33); if (canvas) g.renderCanvas(canvas); });
const heavy = `function render(api){ for (let i=0;i<2000;i++) api.draw.rect(i%320, (i*7)%240, 4, 4, "#f80"); }`;
const host = { call: (m: string) => (m === "params" ? {} : null) };
bench("2000 条绘制指令的 render", 200, () => runner.run("heavy.js", heavy, "render", host, { time_ms: 1000, memory_mb: 32 }));
const tiny = `function f(api){ return 1 }`;
bench("空函数调用（纯开销）", 1000, () => runner.run("tiny.js", tiny, "f", host, { time_ms: 1000, memory_mb: 16 }));
