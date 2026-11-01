// 自定义后期着色器（GLSL ES 1.0）：作者只写一个函数 vec4 effect(vec4 color, vec2 uv)，客户端把它套进固定模板。
// 模板提供：u_scene（画面纹理）、u_resolution（像素尺寸）、u_time（秒）、u_texel（1/像素尺寸），以及作者在素材里声明的 uniform。
// uniform 只能是数字（float/vec2/vec3/vec4）或图片素材（texture）；脚本传的值会被清洗成数字或已登记的图片 id。
// 静态检查（复杂度防护）：长度、禁止预处理指令/自己声明 uniform/改写 main/while 循环，for 循环次数和纹理采样次数有上限。
// 着色器源码只交给 WebGL 编译（GPU 代码），不经过 JavaScript 的 eval，不需要改 CSP。
export type UniformType = "float" | "vec2" | "vec3" | "vec4" | "texture";
export const SHADER_LIMITS = { chars: 8000, uniforms: 16, textures: 4, loops: 4, loopIter: 64, samples: 24 };
const SIZES: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
const NAME = /^[a-z][a-z0-9_]{0,23}$/;

export interface ShaderCheck { ok: boolean; errors: string[]; fragment?: string; uniforms: Record<string, UniformType> }

/** 检查作者写的 effect 函数，并生成完整的片元着色器 */
export function buildShader(src: string, decl: Record<string, any> = {}): ShaderCheck {
  const errors: string[] = [];
  const uniforms: Record<string, UniformType> = {};
  const entries = Object.entries(decl && typeof decl === "object" ? decl : {});
  if (entries.length > SHADER_LIMITS.uniforms) errors.push(`uniform 最多 ${SHADER_LIMITS.uniforms} 个`);
  let tex = 0;
  for (const [k, t] of entries.slice(0, SHADER_LIMITS.uniforms)) {
    if (!NAME.test(k)) { errors.push(`uniform 名字「${k}」不对（小写字母开头，只用 a-z 0-9 _，最多 24 个字符）`); continue; }
    if (!["float", "vec2", "vec3", "vec4", "texture"].includes(t)) { errors.push(`uniform「${k}」的类型只能是 float / vec2 / vec3 / vec4 / texture`); continue; }
    if (t === "texture" && ++tex > SHADER_LIMITS.textures) { errors.push(`texture 类型的 uniform 最多 ${SHADER_LIMITS.textures} 个`); continue; }
    uniforms[k] = t as UniformType;
  }
  if (typeof src !== "string") return { ok: false, errors: ["着色器不是文本"], uniforms };
  if (src.length > SHADER_LIMITS.chars) errors.push(`着色器太长（最多 ${SHADER_LIMITS.chars} 个字符）`);
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(src)) errors.push("着色器里只能有英文字符（注释也是）");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  if (/#/.test(code)) errors.push("不能写预处理指令（#define、#extension 等）");
  for (const w of ["uniform", "attribute", "varying", "gl_FragColor", "gl_FragData", "gl_FragCoord", "while", "do", "main", "precision", "invariant", "__"]) {
    if (new RegExp(`\\b${w}\\b`).test(code) || (w === "__" && code.includes("__"))) errors.push(`不能使用「${w}」（模板已经提供需要的东西）`);
  }
  if (!/\bvec4\s+effect\s*\(\s*vec4\s+\w+\s*,\s*vec2\s+\w+\s*\)/.test(code)) errors.push("要写一个函数：vec4 effect(vec4 color, vec2 uv) { ... }");
  const loops = code.match(/\bfor\s*\(/g)?.length ?? 0;
  if (loops > SHADER_LIMITS.loops) errors.push(`for 循环最多 ${SHADER_LIMITS.loops} 个`);
  const re = /\bfor\s*\(\s*int\s+(\w+)\s*=\s*(-?\d+)\s*;\s*\1\s*(<|<=)\s*(\d+)\s*;\s*(\1\s*\+\+|\+\+\s*\1|\1\s*\+=\s*1)\s*\)/g;
  let ok = 0, m: RegExpExecArray | null; let iters = 1;
  while ((m = re.exec(code))) { ok++; const n = +m[4] - +m[2] + (m[3] === "<=" ? 1 : 0); if (n > SHADER_LIMITS.loopIter) errors.push(`for 循环最多 ${SHADER_LIMITS.loopIter} 次（这里是 ${n} 次）`); iters = Math.max(iters, n); }
  if (ok !== loops) errors.push("for 循环要写成 for (int i = 0; i < 常数; i++) 的形式");
  if (loops > 1 && /\bfor\s*\([^)]*\)\s*\{[^{}]*\bfor\s*\(/.test(code)) errors.push("不能嵌套 for 循环");
  const samples = code.match(/\btexture2D\s*\(/g)?.length ?? 0;
  const total = samples * (loops ? iters : 1);
  if (total > SHADER_LIMITS.samples * 4 || samples > SHADER_LIMITS.samples) errors.push(`纹理采样太多（每个像素最多约 ${SHADER_LIMITS.samples} 次）`);
  if (errors.length) return { ok: false, errors, uniforms };
  const decls = Object.entries(uniforms).map(([k, t]) => `uniform ${t === "texture" ? "sampler2D" : t} u_${k};`).join("\n");
  const fragment = `precision mediump float;
uniform sampler2D u_scene; uniform vec2 u_resolution; uniform vec2 u_texel; uniform float u_time;
${decls}
varying vec2 v_uv;
${src}
void main() { gl_FragColor = effect(texture2D(u_scene, v_uv), v_uv); }`;
  return { ok: true, errors, fragment, uniforms };
}

/** 清洗脚本传来的 uniform 值：数字类型只收数字，texture 只收已登记的图片素材 id */
export function cleanUniforms(vals: any, decl: Record<string, UniformType>, isImage: (id: string) => boolean): Record<string, number[] | string> {
  const out: Record<string, number[] | string> = {};
  if (!vals || typeof vals !== "object") return out;
  for (const [k, t] of Object.entries(decl)) {
    const v = vals[k]; if (v === undefined) continue;
    if (t === "texture") { if (typeof v === "string" && isImage(v)) out[k] = v; continue; }
    const arr = (Array.isArray(v) ? v : [v]).slice(0, SIZES[t]).map((x: any) => (typeof x === "number" && isFinite(x) ? Math.max(-1e6, Math.min(1e6, x)) : 0));
    while (arr.length < SIZES[t]) arr.push(0);
    out[k] = arr;
  }
  return out;
}
