// WebGL 渲染器：所有图形合批成少量绘制调用（同一张纹理、同一种混合模式的连续图形一次画完）。
// 文字栅格化后缓存成纹理；故事图片上传一次后常驻显存。着色器是写死的字符串，不用 eval，符合客户端 CSP。
import { walk, type Backend, type Mat } from "./walk";
import { ParticleField, type Renderer, type ImageSource, type RGBA, type Blend } from "./common";
import { TextCache } from "./text";

const SLOTS = 8;
const VS = `attribute vec2 aPos; attribute vec2 aUv; attribute vec4 aCol; attribute vec3 aP; attribute float aT;
uniform vec2 uRes; varying vec2 vUv; varying vec4 vCol; varying vec3 vP; varying float vT;
void main(){ vUv = aUv; vCol = aCol; vP = aP; vT = aT; gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0); }`;
// 一批最多同时用 8 张纹理（按顶点上的编号选），图片、文字、纯色图形交替出现也能合成一批
const FS = `precision mediump float; varying vec2 vUv; varying vec4 vCol; varying vec3 vP; varying float vT; uniform sampler2D uT[${SLOTS}];
vec4 tex(){
  if (vT < 0.5) return texture2D(uT[0], vUv); if (vT < 1.5) return texture2D(uT[1], vUv); if (vT < 2.5) return texture2D(uT[2], vUv); if (vT < 3.5) return texture2D(uT[3], vUv);
  if (vT < 4.5) return texture2D(uT[4], vUv); if (vT < 5.5) return texture2D(uT[5], vUv); if (vT < 6.5) return texture2D(uT[6], vUv); return texture2D(uT[7], vUv);
}
void main(){
  if (vP.x < 0.5) { gl_FragColor = tex() * vCol; return; }
  if (vP.x < 1.5) { gl_FragColor = vCol; return; }
  float d = length(vUv); float aa = vP.y;
  float a = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  if (vP.x > 3.5) { float k = clamp(1.0 - d, 0.0, 1.0); a = k * k; }
  else if (vP.x > 2.5) { a *= smoothstep(vP.z - aa, vP.z, d); }
  gl_FragColor = vCol * a;
}`;
const FLOATS = 12, MAXQ = 8000;
type GL = WebGLRenderingContext;

export class WebGLRenderer implements Renderer, Backend {
  readonly kind = "webgl" as const;
  private gl!: GL; private prog!: WebGLProgram; private vbo!: WebGLBuffer; private uRes!: WebGLUniformLocation;
  private data = new Float32Array(MAXQ * 4 * FLOATS); private q = 0;
  private slots: WebGLTexture[] = []; private slot = 0; private blend: Blend = "normal"; private white!: WebGLTexture;
  private texCache = new WeakMap<object, WebGLTexture>(); private textTex = new Map<HTMLCanvasElement, WebGLTexture>();
  private W = 1; private H = 1; private dpr = 1; private lost = false; calls = 0;
  private texts: TextCache; particles = new ParticleField();

  static create(el: HTMLCanvasElement, img: ImageSource, pixelated: boolean): WebGLRenderer | null {
    const opts: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false, powerPreference: "high-performance" };
    const gl = (el.getContext("webgl2", opts) ?? el.getContext("webgl", opts)) as GL | null;
    if (!gl) return null;
    try { return new WebGLRenderer(el, gl, img, pixelated); } catch { return null; }
  }
  private constructor(private el: HTMLCanvasElement, gl: GL, private img: ImageSource, private pixelated: boolean) {
    this.texts = new TextCache(400, (t) => { const x = this.textTex.get(t.canvas); if (x) { this.gl.deleteTexture(x); this.textTex.delete(t.canvas); } });
    this.init(gl);
    el.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
    el.addEventListener("webglcontextrestored", () => { this.texCache = new WeakMap(); this.textTex.clear(); this.texts.clear(); this.init(this.gl); this.lost = false; });
  }
  private init(gl: GL) {
    this.gl = gl;
    const sh = (t: number, s: string) => { const x = gl.createShader(t)!; gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) ?? "shader"); return x; };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    this.prog = p; gl.useProgram(p);
    this.vbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const idx = new Uint16Array(MAXQ * 6); for (let i = 0, v = 0; i < idx.length; i += 6, v += 4) idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const at = (n: string, size: number, off: number) => { const l = gl.getAttribLocation(p, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, FLOATS * 4, off * 4); };
    at("aPos", 2, 0); at("aUv", 2, 2); at("aCol", 4, 4); at("aP", 3, 8); at("aT", 1, 11);
    this.uRes = gl.getUniformLocation(p, "uRes")!;
    gl.uniform1iv(gl.getUniformLocation(p, "uT"), Array.from({ length: SLOTS }, (_, i) => i));
    gl.enable(gl.BLEND); this.applyBlend("normal");
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.white = this.upload(Object.assign(document.createElement("canvas"), { width: 1, height: 1 }), true);
    { const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, 1, 1); gl.bindTexture(gl.TEXTURE_2D, this.white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); }
    this.slots = [];
  }
  private upload(src: TexImageSource, nearest: boolean): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const f = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  /** 预先把图片上传到显存（加载阶段调用，避免第一次出现时卡顿） */
  warm(im: TexImageSource & object) { if (!this.texCache.has(im)) { this.flush(); this.texCache.set(im, this.upload(im, this.pixelated)); } }
  private applyBlend(b: Blend) {
    const gl = this.gl;
    if (b === "add") gl.blendFunc(gl.ONE, gl.ONE);
    else if (b === "multiply") gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    else if (b === "screen") gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  private use(t: WebGLTexture, b: Blend) {
    if (b !== this.blend) { this.flush(); this.applyBlend(b); this.blend = b; }
    let i = this.slots.indexOf(t);
    if (i < 0) {
      if (this.slots.length >= SLOTS) { this.flush(); this.slots = []; }
      i = this.slots.length; this.slots.push(t);
    }
    this.slot = i;
  }
  private flush() {
    if (!this.q) return;
    const gl = this.gl;
    this.slots.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); });
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.q * 4 * FLOATS));
    gl.drawElements(gl.TRIANGLES, this.q * 6, gl.UNSIGNED_SHORT, 0);
    this.q = 0; this.calls++;
  }
  /** 写一个四边形：局部坐标 (x0,y0)-(x1,y1) 经 m 变换；uv 对应四角；c 为预乘前的颜色 */
  private quad(m: Mat, x0: number, y0: number, x1: number, y1: number, u0: number, v0: number, u1: number, v1: number, c: RGBA, mode: number, p1 = 0, p2 = 0) {
    if (this.q >= MAXQ) this.flush();
    const slot = this.slot, d = this.data; let o = this.q * 4 * FLOATS; const a = c[3], r = c[0] * a, g = c[1] * a, b = c[2] * a;
    const P = (x: number, y: number, u: number, v: number) => {
      d[o] = m[0] * x + m[2] * y + m[4]; d[o + 1] = m[1] * x + m[3] * y + m[5]; d[o + 2] = u; d[o + 3] = v;
      d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a; d[o + 8] = mode; d[o + 9] = p1; d[o + 10] = p2; d[o + 11] = slot; o += FLOATS;
    };
    P(x0, y0, u0, v0); P(x1, y0, u1, v0); P(x1, y1, u1, v1); P(x0, y1, u0, v1);
    this.q++;
  }
  resize(w: number, h: number, dpr: number) { this.W = w; this.H = h; this.dpr = dpr; }
  draw(cmds: any[], timeMs: number, dtMs: number) {
    if (this.lost || this.gl.isContextLost()) return { drawn: 0 };
    this.particles.advance(dtMs); this.texts.frame++; this.calls = 0;
    return { drawn: walk(this, cmds, this.img, this.particles, timeMs, !this.pixelated) };
  }
  begin() {
    const gl = this.gl; gl.viewport(0, 0, this.el.width, this.el.height); gl.useProgram(this.prog); gl.uniform2f(this.uRes, this.W, this.H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); this.q = 0;
  }
  clear(c: RGBA | null) { this.flush(); const gl = this.gl; c ? gl.clearColor(c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]) : gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  rect(m: Mat, w: number, h: number, c: RGBA, b: Blend, stroke: number) {
    this.use(this.white, b);
    if (!stroke) { this.quad(m, 0, 0, w, h, 0, 0, 1, 1, c, 1); return; }
    const s = stroke / 2;
    this.quad(m, -s, -s, w + s, s, 0, 0, 1, 1, c, 1); this.quad(m, -s, h - s, w + s, h + s, 0, 0, 1, 1, c, 1);
    this.quad(m, -s, s, s, h - s, 0, 0, 1, 1, c, 1); this.quad(m, w - s, s, w + s, h - s, 0, 0, 1, 1, c, 1);
  }
  circle(m: Mat, r: number, c: RGBA, b: Blend, stroke: number, soft: number) {
    if (r <= 0) return;
    this.use(this.white, b);
    const px = r * Math.hypot(m[0], m[1]) * this.dpr, aa = Math.min(1, 1.5 / Math.max(0.5, px));
    const R = stroke ? r + stroke / 2 : r, inner = stroke ? Math.max(0, (r - stroke / 2) / R) : 0;
    this.quad(m, -R, -R, R, R, -1, -1, 1, 1, c, soft ? 4 : stroke ? 3 : 2, aa, inner);
  }
  line(m: Mat, x1: number, y1: number, x2: number, y2: number, c: RGBA, w: number, b: Blend) {
    this.use(this.white, b);
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy); if (!L) return;
    const cs = dx / L, sn = dy / L;
    const lm: Mat = [m[0] * cs + m[2] * sn, m[1] * cs + m[3] * sn, -m[0] * sn + m[2] * cs, -m[1] * sn + m[3] * cs, m[0] * x1 + m[2] * y1 + m[4], m[1] * x1 + m[3] * y1 + m[5]];
    this.quad(lm, 0, -w / 2, L, w / 2, 0, 0, 1, 1, c, 1);
  }
  image(m: Mat, im: any, sx: number, sy: number, sw: number, sh: number, w: number, h: number, t: RGBA, b: Blend) {
    let tx = this.texCache.get(im);
    if (!tx) { this.flush(); tx = this.upload(im, this.pixelated); this.texCache.set(im, tx); }
    this.use(tx, b);
    const iw = im.naturalWidth ?? im.width, ih = im.naturalHeight ?? im.height;
    this.quad(m, 0, 0, w, h, sx / iw, sy / ih, (sx + sw) / iw, (sy + sh) / ih, t, 0);
  }
  text(m: Mat, s: string, st: any, alpha: number, b: Blend) {
    const t = this.texts.get(s, st, Math.max(1, Math.min(4, this.dpr * Math.hypot(m[0], m[1]))));
    let tx = this.textTex.get(t.canvas);
    if (!tx) { this.flush(); tx = this.upload(t.canvas, false); this.textTex.set(t.canvas, tx); }
    this.use(tx, b);
    this.quad(m, t.ox, t.oy, t.ox + t.w, t.oy + t.h, 0, 0, 1, 1, [1, 1, 1, alpha], 0);
  }
  end() { this.flush(); }
  dispose() { this.texts.clear(); this.particles.clear(); this.gl.getExtension("WEBGL_lose_context")?.loseContext(); }
}
