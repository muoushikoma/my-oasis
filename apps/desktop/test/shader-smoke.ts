// 浏览器冒烟测试（手动跑）：自定义着色器（逐精灵 + 后期处理）、坏着色器回退、上下文丢失后关闭着色器。
// 用法：在 apps/desktop 下 npx vite，然后打开 /test/shader-smoke.html，结果显示在页面上。
import { WebGLRenderer } from "../src/render/webgl";
const out = document.getElementById("out")!;
const log: string[] = [];
const sheet = document.createElement("canvas"); sheet.width = sheet.height = 16;
{ const x = sheet.getContext("2d")!; x.fillStyle = "#f00"; x.fillRect(0, 0, 16, 16); }
const shaders: Record<string, string> = {
  green: "uniform float u_k;\nvoid main(){ vec4 c = texture2D(uTex, vUv) * vCol; gl_FragColor = vec4(c.g, c.r * u_k, c.b, c.a); }",
  invert: "void main(){ vec4 c = texture2D(uTex, vUv); gl_FragColor = vec4(c.a - c.rgb, c.a); }",
  broken: "void main(){ gl_FragColor = vec4(oops); }",
};
const el = document.createElement("canvas"); el.width = 64; el.height = 64; document.body.append(el);
const errors: string[] = [];
const r = WebGLRenderer.create(el, () => sheet as any, false, { shader: (id) => shaders[id], onShaderError: (id, m) => errors.push(`${id}: ${m}`) })!;
r.resize(64, 64, 1);
const px = (x: number, y: number) => { const gl = el.getContext("webgl2") ?? el.getContext("webgl")!; const p = new Uint8Array(4); gl.readPixels(x, 63 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [...p]; };
const sheetImg = sheet as any; sheetImg.complete = true; sheetImg.naturalWidth = 16; sheetImg.naturalHeight = 16;
r.draw([["clear", "#000"], ["image", "s", 0, 0, 32, 32, {}], ["image", "s", 32, 0, 32, 32, { shader: "green", uniforms: { u_k: 1 } }], ["image", "s", 0, 32, 32, 32, { shader: "broken" }]], 0, 16);
log.push(`plain ${px(8, 8)} | shader ${px(40, 8)} | broken→plain ${px(8, 40)}`);
r.draw([["clear", "#000"], ["image", "s", 0, 0, 32, 32, {}], ["post", "invert", {}]], 16, 16);
log.push(`post invert: red→ ${px(8, 8)} black→ ${px(50, 50)}`);
log.push(`errors: ${errors.join(" / ")}`);
const ok = px(8, 8)[1] === 255 && px(50, 50)[0] === 255 && errors.length === 1;
// 上下文丢失：刚用过自定义着色器 → 恢复后不再用
const ext = (el.getContext("webgl2") ?? el.getContext("webgl")!).getExtension("WEBGL_lose_context")!;
ext.loseContext();
setTimeout(() => {
  ext.restoreContext();
  setTimeout(() => {
    r.draw([["clear", "#000"], ["image", "s", 0, 0, 32, 32, { shader: "green", uniforms: { u_k: 1 } }]], 5000, 16);
    log.push(`after restore: shadersOff=${r.shadersOff} pixel ${px(8, 8)}`);
    const ok2 = ok && r.shadersOff && px(8, 8)[0] === 255;
    log.push(ok2 ? "SMOKE_OK" : "SMOKE_FAIL");
    out.textContent = log.join("\n");
  }, 200);
}, 200);
