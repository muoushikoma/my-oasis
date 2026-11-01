// 浏览器里跑：同一组绘制指令分别用 WebGL 和 Canvas2D 画，比较每帧耗时（结果写到 window.__bench）
import { WebGLRenderer } from "../src/render/webgl";
import { Canvas2DRenderer } from "../src/render/canvas2d";
import type { Renderer } from "../src/render/common";

const sheet = document.createElement("canvas"); sheet.width = 128; sheet.height = 32;
{ const x = sheet.getContext("2d")!; ["#e44", "#4e4", "#44e", "#ee4"].forEach((c, i) => { x.fillStyle = c; x.fillRect(i * 32 + 4, 4, 24, 24); x.fillStyle = "#fff"; x.fillText(String(i), i * 32 + 12, 20); }); }
const img = new Image(); img.src = sheet.toDataURL();
await img.decode();
const N = Number(new URLSearchParams(location.search).get("n") ?? 3000);
function cmds(t: number) {
  const c: any[] = [["clear", "#123"], ["camera", Math.sin(t / 1000) * 40, 0, 1]];
  c.push(["tilemap", { tile_size: 32, colors: { "#": "#345", "=": "#553" }, map: ["####################", "#..................#", "#....====.........#", "####################"] }]);
  for (let i = 0; i < N; i++) {
    const x = (i * 37) % 640, y = (i * 53 + t / 10) % 360;
    if (i % 3 === 0) c.push(["rect", x, y, 6, 6, "#f80", { rotation: t / 500 + i, anchor_x: 0.5, anchor_y: 0.5 }]);
    else if (i % 3 === 1) c.push(["circle", x, y, 4, "#0cf", {}]);
    else c.push(["image", "sheet", x, y, 16, 16, { frame_w: 32, frame_h: 32, frame: i % 4, alpha: 0.8 }]);
  }
  c.push(["sprite", "sheet", 300, 150, { frame_w: 32, frame_h: 32, fps: 8, scale: 3, anchor_x: 0.5, anchor_y: 0.5, tint: "#fcc" }]);
  c.push(["particles", "fire", 320, 300, { rate: 200, speed: 80, angle: -90, spread: 50, life_ms: 1200, size: 10, end_size: 2, color: "#fa3", end_color: "#f003", gravity: -20 }]);
  c.push(["circle", 100, 100, 20, "#ff0", { glow: { size: 30 } }]);
  c.push(["line", 0, 0, 640, 360, "#fff", 2]);
  c.push(["rect", 10, 10, 200, 40, "#000a", { fixed: true }], ["text", `帧 ${Math.floor(t)} Hello 你好`, 20, 20, { fixed: true, size: 18, color: "#fff", outline: { color: "#000", width: 2 } }]);
  c.push(["rect", 400, 40, 120, 60, "#f0f", { blend: "add", alpha: 0.5 }]);
  return c;
}
async function run(r: Renderer, frames: number) {
  r.resize(640, 360, 1);
  for (let i = 0; i < 10; i++) r.draw(cmds(i * 16), i * 16, 16);
  const t: number[] = [];
  for (let i = 0; i < frames; i++) { const list = cmds(i * 16); const t0 = performance.now(); r.draw(list, i * 16, 16); (r as any).gl?.finish?.(); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  return { avg: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(3), p95: +t[Math.floor(t.length * 0.95)].toFixed(3), calls: (r as any).calls };
}
const im = (id: string) => (id === "sheet" ? img : undefined);
const gl = WebGLRenderer.create(document.getElementById("gl") as HTMLCanvasElement, im, false)!;
const c2 = new Canvas2DRenderer(document.getElementById("c2") as HTMLCanvasElement, im, false);
const res = { n: N, webgl: gl ? await run(gl, 200) : "unavailable", canvas2d: await run(c2, 200) };
document.getElementById("out")!.textContent = JSON.stringify(res, null, 2);
(window as any).__bench = res;
