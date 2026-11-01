// 自定义着色器（GLSL）的静态检查：客户端编译前和故事校验器共用。
// 只接受 WebGL1（GLSL ES 1.00）片元着色器的“主体”，客户端补上统一的开头（精度、varying、内置 uniform）。
// 这里只挡掉明显危险或不可移植的写法；真正的编译在显卡驱动里做，客户端另有超时、失败回退和丢失恢复。
export const SHADER_MAX_BYTES = 32 * 1024;
export const SHADER_MAX_LOOPS = 8;
export const SHADER_MAX_LOOP_COUNT = 256;
/** 客户端统一补在作者代码前面的部分（作者不用写，也不能重复声明） */
export const SHADER_HEADER = `precision mediump float;
varying vec2 vUv; varying vec4 vCol;
uniform sampler2D uTex; uniform float uTime; uniform vec2 uRes; uniform vec2 uTexSize;
`;
/** 作者可以传的自定义 uniform 名字 */
export const SHADER_UNIFORM_RE = /^u_[a-z0-9_]{1,30}$/;

/** 返回 null 表示通过；否则返回一句说明（中文） */
export function checkShaderSource(src: string): string | null {
  if (typeof src !== "string" || !src.trim()) return "着色器是空的";
  if (new TextEncoder().encode(src).length > SHADER_MAX_BYTES) return `着色器超过 ${SHADER_MAX_BYTES / 1024} KB`;
  // 去掉注释再检查
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(code)) return "着色器代码只能用英文字符（注释里可以写中文）";
  for (const line of code.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#") && !/^#\s*define\s+[A-Za-z_]\w*(\s|$)/.test(t)) return `不支持预处理指令「${t.slice(0, 40)}」（只能用 #define）`;
  }
  if (/\b(while|do)\b/.test(code)) return "不能用 while / do 循环，请用有固定次数的 for 循环";
  if (/\b(uniform|varying)\s+\w+\s+(uTex|uTime|uRes|uTexSize|vUv|vCol)\b/.test(code)) return "uTex、uTime、uRes、uTexSize、vUv、vCol 已经由客户端声明，不要重复写";
  if (/\bprecision\b/.test(code)) return "不用写 precision，客户端已经写好";
  for (const m of code.matchAll(/\buniform\s+(\w+)\s+(\w+)/g)) {
    if (!["float", "vec2", "vec3", "vec4"].includes(m[1])) return `自定义 uniform「${m[2]}」只能是 float / vec2 / vec3 / vec4`;
    if (!SHADER_UNIFORM_RE.test(m[2])) return `自定义 uniform「${m[2]}」要以 u_ 开头，只用小写字母、数字和下划线`;
  }
  if (/\bsampler(2D|Cube)\b/.test(code.replace(/\buTex\b/g, ""))) return "只能读 uTex 这一张纹理";
  const loops = [...code.matchAll(/\bfor\s*\(([^;]*);([^;]*);/g)];
  if (loops.length > SHADER_MAX_LOOPS) return `for 循环太多（最多 ${SHADER_MAX_LOOPS} 个）`;
  for (const l of loops) {
    const cond = l[2];
    const nums = [...cond.matchAll(/(\d+(\.\d+)?)/g)].map((x) => Number(x[1]));
    if (!nums.length || !/[<>]=?/.test(cond)) return "for 循环的次数要写成固定数字，例如 for (int i = 0; i < 16; i++)";
    if (Math.max(...nums) > SHADER_MAX_LOOP_COUNT) return `for 循环最多 ${SHADER_MAX_LOOP_COUNT} 次`;
  }
  if (!/\bvoid\s+main\s*\(\s*(void)?\s*\)/.test(code)) return "缺少 void main()";
  if (!/\bgl_FragColor\b/.test(code)) return "main 里要给 gl_FragColor 赋值";
  return null;
}
/** 拼出完整的片元着色器 */
export function shaderSource(src: string): string { return SHADER_HEADER + src; }
