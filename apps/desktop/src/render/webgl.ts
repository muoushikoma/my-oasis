// WebGL 渲染器：所有图形合批成少量绘制调用（同一张纹理、同一种混合模式的连续图形一次画完）。
// 文字栅格化后缓存成纹理；故事图片上传一次后常驻显存。着色器是写死的字符串，不用 eval，符合客户端 CSP。
import { walk, type Backend, type Mat } from "./walk";
import { ParticleField, type Renderer, type RendererResources, type ImageSource, type RGBA, type Blend } from "./common";
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
// 后期处理：整帧先画进离屏纹理，再用作者的着色器（套在固定模板里，见 @my-oasis/schema 的 buildShader）画到屏幕
const POST_VS = `attribute vec2 aPos; varying vec2 v_uv; void main(){ v_uv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
/** 保护：连续 3 秒低于 20fps 就关掉这个着色器；带着着色器丢失两次 WebGL 上下文就关掉所有自定义着色器 */
const POST_SLOW_MS = 50, POST_SLOW_TOTAL = 3000, POST_MAX_LOSSES = 2;
interface PostProg { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null>; types: Record<string, string> }
type GL = WebGLRenderingContext;

export class WebGLRenderer implements Renderer, Backend {
  readonly kind = "webgl" as const;
  private gl!: GL; private prog!: WebGLProgram; private vbo!: WebGLBuffer; private uRes!: WebGLUniformLocation;
  private data = new Float32Array(MAXQ * 4 * FLOATS); private q = 0;
  private slots: WebGLTexture[] = []; private slot = 0; private blend: Blend = "normal"; private white!: WebGLTexture;
  private texCache = new WeakMap<object, WebGLTexture>(); private textTex = new Map<HTMLCanvasElement, WebGLTexture>();
  private W = 1; private H = 1; private dpr = 1; private lost = false; calls = 0;
  private texts: TextCache; particles = new ParticleField(); res: RendererResources = {};
  private frameNo = 0; private vidStamp = new WeakMap<object, number>();
  private post = new Map<string, PostProg | null>(); private postOff = new Set<string>(); private postSlow = 0; private losses = 0; private allPostOff = false;
  private fbo: WebGLFramebuffer | null = null; private fboTex: WebGLTexture | null = null; private fboW = 0; private fboH = 0; private quadBuf: WebGLBuffer | null = null; private activePost = "";

  static create(el: HTMLCanvasElement, img: ImageSource, pixelated: boolean): WebGLRenderer | null {
    const opts: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false, powerPreference: "high-performance" };
    const gl = (el.getContext("webgl2", opts) ?? el.getContext("webgl", opts)) as GL | null;
    if (!gl) return null;
    try { return new WebGLRenderer(el, gl, img, pixelated); } catch { return null; }
  }
  private constructor(private el: HTMLCanvasElement, gl: GL, private img: ImageSource, private pixelated: boolean) {
    this.texts = new TextCache(400, (t) => { const x = this.textTex.get(t.canvas); if (x) { this.gl.deleteTexture(x); this.textTex.delete(t.canvas); } });
    this.init(gl);
    el.addEventListener("webglcontextlost", (e) => {
      e.preventDefault(); this.lost = true;
      // 着色器太重可能让显卡重置：带着着色器丢失两次就不再用自定义着色器
      if (this.activePost && ++this.losses >= POST_MAX_LOSSES && !this.allPostOff) { this.allPostOff = true; this.res.warn?.("显卡多次重置，已关闭自定义后期着色器（画面照常显示）"); }
    });
    el.addEventListener("webglcontextrestored", () => {
      // 恢复：所有显存资源（纹理、程序、离屏缓冲）重新创建
      this.texCache = new WeakMap(); this.vidStamp = new WeakMap(); this.textTex.clear(); this.texts.clear();
      this.post.clear(); this.fbo = this.fboTex = this.quadBuf = null; this.fboW = this.fboH = 0;
      try { this.init(this.gl); this.lost = false; } catch { /* 恢复失败：保持不画，等下一次恢复 */ }
    });
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
    this.attribs = () => { gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); at("aPos", 2, 0); at("aUv", 2, 2); at("aCol", 4, 4); at("aP", 3, 8); at("aT", 1, 11); };
    this.attribs();
    this.uRes = gl.getUniformLocation(p, "uRes")!;
    gl.uniform1iv(gl.getUniformLocation(p, "uT"), Array.from({ length: SLOTS }, (_, i) => i));
    gl.enable(gl.BLEND); this.applyBlend("normal");
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.white = this.upload(Object.assign(document.createElement("canvas"), { width: 1, height: 1 }), true);
    { const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, 1, 1); gl.bindTexture(gl.TEXTURE_2D, this.white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); }
    this.slots = [];
  }
  private attribs = () => {};
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
    this.particles.advance(dtMs); this.texts.frame++; this.calls = 0; this.frameNo++;
    // 最后一条 post 指令生效
    let post: any[] | undefined;
    for (let i = cmds.length - 1; i >= 0; i--) { const c = cmds[i]; if (Array.isArray(c) && c[0] === "post") { post = c; break; } }
    const pid = post && post[1] && !this.allPostOff && !this.postOff.has(String(post[1])) ? String(post[1]) : "";
    const pp = pid ? this.postProgram(pid) : null;
    if (!pp) { this.activePost = ""; return { drawn: walk(this, cmds, this.img, this.particles, timeMs, !this.pixelated, this.res) }; }
    this.activePost = pid;
    // 帧率保护
    if (dtMs > POST_SLOW_MS) { this.postSlow += dtMs; if (this.postSlow > POST_SLOW_TOTAL) { this.postOff.add(pid); this.postSlow = 0; this.res.warn?.(`着色器「${pid}」太慢（持续低于 20 帧），已关闭`); } }
    else if (dtMs < 34) this.postSlow = Math.max(0, this.postSlow - dtMs);
    const gl = this.gl;
    if (!this.ensureFbo()) return { drawn: walk(this, cmds, this.img, this.particles, timeMs, !this.pixelated, this.res) };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const drawn = walk(this, cmds, this.img, this.particles, timeMs, !this.pixelated, this.res);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.runPost(pp, post![2] ?? {}, timeMs);
    return { drawn: drawn + 1 };
  }
  private ensureFbo(): boolean {
    const gl = this.gl, w = this.el.width, h = this.el.height;
    if (this.fbo && this.fboW === w && this.fboH === h) return true;
    if (this.fboTex) gl.deleteTexture(this.fboTex); if (this.fbo) gl.deleteFramebuffer(this.fbo);
    const t = gl.createTexture(), f = gl.createFramebuffer(); if (!t || !f) return false;
    gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.slots = [];
    if (!ok) { gl.deleteTexture(t); gl.deleteFramebuffer(f); this.fbo = this.fboTex = null; return false; }
    this.fbo = f; this.fboTex = t; this.fboW = w; this.fboH = h; return true;
  }
  /** 编译作者的着色器（只编译一次）；编译失败就记一条警告，之后这个着色器直接跳过，画面照常 */
  private postProgram(id: string): PostProg | null {
    if (this.post.has(id)) return this.post.get(id)!;
    const src = this.res.shader?.(id); const gl = this.gl;
    if (!src) { this.post.set(id, null); this.res.warn?.(`着色器「${id}」不存在或没通过检查`); return null; }
    const fail = (msg: string) => { this.post.set(id, null); this.res.warn?.(`着色器「${id}」编译失败，已跳过：${msg.slice(0, 300)}`); return null; };
    const sh = (t: number, s: string) => { const x = gl.createShader(t); if (!x) return null; gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) { const m = gl.getShaderInfoLog(x) ?? ""; gl.deleteShader(x); throw new Error(m); } return x; };
    try {
      const vs = sh(gl.VERTEX_SHADER, POST_VS), fs = sh(gl.FRAGMENT_SHADER, src.fragment); const p = gl.createProgram();
      if (!vs || !fs || !p) return fail("显卡资源不足");
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return fail(gl.getProgramInfoLog(p) ?? "link");
      const loc: Record<string, WebGLUniformLocation | null> = {};
      for (const k of ["u_scene", "u_resolution", "u_texel", "u_time", ...Object.keys(src.uniforms).map((k) => "u_" + k)]) loc[k] = gl.getUniformLocation(p, k);
      const pp: PostProg = { prog: p, loc, types: src.uniforms }; this.post.set(id, pp); return pp;
    } catch (e: any) { return fail(String(e?.message ?? e)); }
  }
  private runPost(pp: PostProg, vals: any, timeMs: number) {
    const gl = this.gl;
    if (!this.quadBuf) { this.quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW); }
    gl.useProgram(pp.prog); gl.viewport(0, 0, this.el.width, this.el.height);
    gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fboTex); gl.uniform1i(pp.loc.u_scene, 0);
    gl.uniform2f(pp.loc.u_resolution, this.el.width, this.el.height); gl.uniform2f(pp.loc.u_texel, 1 / this.el.width, 1 / this.el.height); gl.uniform1f(pp.loc.u_time, timeMs / 1000);
    let unit = 1;
    for (const [k, t] of Object.entries(pp.types)) {
      const l = pp.loc["u_" + k]; if (!l) continue; const v = vals?.[k];
      if (t === "texture") {
        const im = typeof v === "string" ? this.img(v) : undefined; let tx = this.white;
        if (im && ((im as any).complete !== false) && ((im as any).naturalWidth ?? (im as any).width)) { tx = this.texCache.get(im) ?? this.upload(im as any, false); this.texCache.set(im, tx); }
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform1i(l, unit++); continue;
      }
      const a = (Array.isArray(v) ? v : [v]).map((x: any) => (typeof x === "number" && isFinite(x) ? x : 0));
      if (t === "float") gl.uniform1f(l, a[0] ?? 0); else if (t === "vec2") gl.uniform2f(l, a[0] ?? 0, a[1] ?? 0);
      else if (t === "vec3") gl.uniform3f(l, a[0] ?? 0, a[1] ?? 0, a[2] ?? 0); else gl.uniform4f(l, a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0);
    }
    const loc = gl.getAttribLocation(pp.prog, "aPos");
    // 主程序用了 0~4 号顶点属性；后期程序只用 aPos，其他的先关掉
    for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(loc);
    // 还原主程序状态
    gl.useProgram(this.prog); this.attribs(); gl.enable(gl.BLEND); this.applyBlend(this.blend); this.slots = [];
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
    if (!tx) { this.flush(); tx = this.upload(im, this.pixelated); this.texCache.set(im, tx); if (im.videoWidth) this.vidStamp.set(im, this.frameNo); }
    else if (im.videoWidth && this.vidStamp.get(im) !== this.frameNo) {
      // 视频纹理：每个显示帧最多更新一次
      this.flush(); const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, tx);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); } catch { /* 这一帧还没解码好 */ }
      this.vidStamp.set(im, this.frameNo); this.slots = [];
    }
    this.use(tx, b);
    const iw = im.videoWidth || im.naturalWidth || im.width, ih = im.videoHeight || im.naturalHeight || im.height;
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
  dispose() { this.texts.clear(); this.particles.clear(); this.post.clear(); this.gl.getExtension("WEBGL_lose_context")?.loseContext(); }
}
