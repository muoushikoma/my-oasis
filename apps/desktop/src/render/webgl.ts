// WebGL 渲染器：所有图形合批成少量绘制调用（同一张纹理、同一种混合模式的连续图形一次画完）。
// 文字栅格化后缓存成纹理；故事图片上传一次后常驻显存。着色器是写死的字符串，不用 eval，符合客户端 CSP。
import { walk, I, type Backend, type Mat, type SpriteFx, type WalkExtras } from "./walk";
import { checkShaderSource, shaderSource } from "@my-oasis/schema";
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
const ATTRS = ["aPos", "aUv", "aCol", "aP", "aT"]; // 固定的属性位置：内置程序和自定义着色器共用同一份顶点数据
/** 自定义着色器的安全阀：编译超过这么久就不用；每 30 帧测一次显卡耗时，连续两次超过上限就关掉所有自定义着色器 */
const COMPILE_MS = 400, GPU_MS = 120, MAX_CUSTOM = 16, MAX_POST = 4;
interface Custom { prog: WebGLProgram; loc: Map<string, WebGLUniformLocation | null>; uTime: WebGLUniformLocation | null; uRes: WebGLUniformLocation | null; uTexSize: WebGLUniformLocation | null }
export interface WebGLOptions {
  /** 着色器素材 id → 源码（作者写的片元着色器主体） */ shader?(id: string): string | undefined;
  extras?: WalkExtras;
  /** 着色器出错/被关掉时通知（显示在 F3 面板、记到控制台） */ onShaderError?(id: string, msg: string): void;
}

export class WebGLRenderer implements Renderer, Backend {
  readonly kind = "webgl" as const;
  private gl!: GL; private prog!: WebGLProgram; private vbo!: WebGLBuffer; private uRes!: WebGLUniformLocation;
  private data = new Float32Array(MAXQ * 4 * FLOATS); private q = 0;
  private slots: WebGLTexture[] = []; private slot = 0; private blend: Blend = "normal"; private white!: WebGLTexture;
  private texCache = new WeakMap<object, WebGLTexture>(); private textTex = new Map<HTMLCanvasElement, WebGLTexture>();
  private W = 1; private H = 1; private dpr = 1; private lost = false; calls = 0;
  private texts: TextCache; particles = new ParticleField();
  // 自定义着色器
  private customs = new Map<string, Custom | null>(); /** 出问题后本次游玩不再用自定义着色器（画面退回普通效果） */ shadersOff = false;
  private usedCustomAt = -1e9; private now = 0; private frameNo = 0; private strikes = 0; private usedThisFrame = false;
  private fbos: { fb: WebGLFramebuffer; tex: WebGLTexture }[] = []; private fboW = 0; private fboH = 0; private posts: { c: Custom; u: Record<string, any> }[] = [];
  private vidFrame = new WeakMap<object, number>();

  static create(el: HTMLCanvasElement, img: ImageSource, pixelated: boolean, opts: WebGLOptions = {}): WebGLRenderer | null {
    const ca: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false, powerPreference: "high-performance" };
    const gl = (el.getContext("webgl2", ca) ?? el.getContext("webgl", ca)) as GL | null;
    if (!gl) return null;
    try { return new WebGLRenderer(el, gl, img, pixelated, opts); } catch { return null; }
  }
  private constructor(private el: HTMLCanvasElement, gl: GL, private img: ImageSource, private pixelated: boolean, private opts: WebGLOptions) {
    this.texts = new TextCache(400, (t) => { const x = this.textTex.get(t.canvas); if (x) { this.gl.deleteTexture(x); this.textTex.delete(t.canvas); } });
    this.init(gl);
    el.addEventListener("webglcontextlost", (e) => {
      e.preventDefault(); this.lost = true;
      // 刚用过自定义着色器就丢了显卡上下文：多半是着色器把显卡卡住了，恢复后不再用
      if (this.now - this.usedCustomAt < 3000 && !this.shadersOff) { this.shadersOff = true; this.opts.onShaderError?.("*", "显卡上下文丢失，已关闭自定义着色器 / GPU context lost, custom shaders disabled"); }
    });
    el.addEventListener("webglcontextrestored", () => {
      this.texCache = new WeakMap(); this.vidFrame = new WeakMap(); this.textTex.clear(); this.texts.clear(); this.customs.clear(); this.fbos = []; this.fboW = this.fboH = 0;
      try { this.init(this.gl); this.lost = false; } catch { /* 恢复失败就保持空白，玩家仍可用暂停菜单退出 */ }
    });
  }
  private init(gl: GL) {
    this.gl = gl;
    const p = this.link(VS, FS);
    this.prog = p; gl.useProgram(p);
    this.vbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const idx = new Uint16Array(MAXQ * 6); for (let i = 0, v = 0; i < idx.length; i += 6, v += 4) idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const at = (n: string, size: number, off: number) => { const l = ATTRS.indexOf(n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, FLOATS * 4, off * 4); };
    at("aPos", 2, 0); at("aUv", 2, 2); at("aCol", 4, 4); at("aP", 3, 8); at("aT", 1, 11);
    this.uRes = gl.getUniformLocation(p, "uRes")!;
    gl.uniform1iv(gl.getUniformLocation(p, "uT"), Array.from({ length: SLOTS }, (_, i) => i));
    gl.enable(gl.BLEND); this.applyBlend("normal");
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.white = this.upload(Object.assign(document.createElement("canvas"), { width: 1, height: 1 }), true);
    { const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, 1, 1); gl.bindTexture(gl.TEXTURE_2D, this.white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); }
    this.slots = [];
  }
  /** 编译并链接一个程序；属性位置固定（ATTRS），所以切换程序时顶点数据不用重新设置 */
  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (t: number, s: string) => { const x = gl.createShader(t)!; gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(x) ?? "shader"; gl.deleteShader(x); throw new Error(log); } return x; };
    const v = sh(gl.VERTEX_SHADER, vs); let f: WebGLShader;
    try { f = sh(gl.FRAGMENT_SHADER, fs); } catch (e) { gl.deleteShader(v); throw e; }
    const p = gl.createProgram()!; gl.attachShader(p, v); gl.attachShader(p, f);
    ATTRS.forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p); gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(p) ?? "link"; gl.deleteProgram(p); throw new Error(log); }
    return p;
  }
  /** 取（第一次时编译）一个自定义着色器；失败返回 null，之后画面按普通方式画 */
  private custom(id: string): Custom | null {
    if (this.shadersOff || this.lost) return null;
    if (this.customs.has(id)) return this.customs.get(id)!;
    let res: Custom | null = null;
    const fail = (msg: string) => { this.opts.onShaderError?.(id, msg); console.warn(`[shader ${id}] ${msg}`); };
    if (this.customs.size >= MAX_CUSTOM) fail(`自定义着色器最多 ${MAX_CUSTOM} 个 / at most ${MAX_CUSTOM} custom shaders`);
    else {
      const src = this.opts.shader?.(id);
      const err = src === undefined ? "没有这个着色器素材 / shader asset not found" : checkShaderSource(src);
      if (err) fail(err);
      else {
        const t0 = performance.now();
        try {
          const prog = this.link(VS, shaderSource(src!)); const gl = this.gl;
          const ms = performance.now() - t0;
          if (ms > COMPILE_MS) { gl.deleteProgram(prog); fail(`编译用了 ${ms.toFixed(0)} 毫秒，太慢，已跳过 / compile too slow`); }
          else {
            gl.useProgram(prog); gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0); gl.useProgram(this.prog);
            res = { prog, loc: new Map(), uTime: gl.getUniformLocation(prog, "uTime"), uRes: gl.getUniformLocation(prog, "uRes"), uTexSize: gl.getUniformLocation(prog, "uTexSize") };
          }
        } catch (e: any) { fail(`编译失败 / compile error: ${String(e?.message ?? e).slice(0, 300)}`); }
      }
    }
    this.customs.set(id, res); return res;
  }
  /** 用自定义程序画：先把之前的批次画掉，换程序、设 uniform，画 emit 写入的四边形，再换回内置程序 */
  private withCustom(c: Custom, tex: WebGLTexture, tw: number, th: number, uniforms: Record<string, any>, emit: () => void) {
    this.flush();
    const gl = this.gl; gl.useProgram(c.prog);
    gl.uniform2f(c.uRes, this.W, this.H); if (c.uTime) gl.uniform1f(c.uTime, this.now / 1000); if (c.uTexSize) gl.uniform2f(c.uTexSize, tw, th);
    for (const [k, v] of Object.entries(uniforms)) {
      if (!/^u_[a-z0-9_]{1,30}$/.test(k)) continue;
      let l = c.loc.get(k); if (l === undefined) { l = gl.getUniformLocation(c.prog, k); c.loc.set(k, l); } if (!l) continue;
      const a = Array.isArray(v) ? v.map(Number) : [Number(v)]; if (!a.every(isFinite)) continue;
      if (a.length === 1) gl.uniform1f(l, a[0]); else if (a.length === 2) gl.uniform2f(l, a[0], a[1]); else if (a.length === 3) gl.uniform3f(l, a[0], a[1], a[2]); else if (a.length === 4) gl.uniform4f(l, a[0], a[1], a[2], a[3]);
    }
    this.slots = [tex]; this.slot = 0;
    emit(); this.flush();
    this.slots = []; gl.useProgram(this.prog);
    this.usedCustomAt = this.now; this.usedThisFrame = true;
  }
  private ensureFbos() {
    const gl = this.gl, w = this.el.width, h = this.el.height;
    if (this.fbos.length === 2 && this.fboW === w && this.fboH === h) return true;
    for (const f of this.fbos) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); }
    this.fbos = [];
    for (let i = 0; i < 2; i++) {
      const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); return false; }
      this.fbos.push({ fb, tex });
    }
    this.fboW = w; this.fboH = h; return true;
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
    this.particles.advance(dtMs); this.texts.frame++; this.calls = 0; this.now = timeMs; this.frameNo++; this.usedThisFrame = false;
    // 后期处理：收集 post 指令（最多 4 遍），有可用的就先画到离屏纹理
    this.posts = [];
    for (const c of cmds) if (Array.isArray(c) && c[0] === "post" && this.posts.length < MAX_POST) { const k = this.custom(String(c[1])); if (k) this.posts.push({ c: k, u: c[2] && typeof c[2] === "object" ? c[2] : {} }); }
    if (this.posts.length && !this.ensureFbos()) this.posts = [];
    const drawn = walk(this, cmds, this.img, this.particles, timeMs, !this.pixelated, { ...this.opts.extras, view: { w: this.W, h: this.H } });
    this.watchdog();
    return { drawn };
  }
  /** 显卡耗时看门狗：用了自定义着色器的帧，每 30 帧同步一次测耗时 */
  private watchdog() {
    if (!this.usedThisFrame || this.frameNo % 30) return;
    const gl = this.gl, px = new Uint8Array(4), t0 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = performance.now() - t0;
    if (ms > GPU_MS) { if (++this.strikes >= 2) { this.shadersOff = true; this.opts.onShaderError?.("*", `显卡每帧耗时 ${ms.toFixed(0)} 毫秒，已关闭自定义着色器 / shaders too slow, disabled`); } }
    else this.strikes = 0;
  }
  begin() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.posts.length ? this.fbos[0].fb : null);
    gl.viewport(0, 0, this.el.width, this.el.height); gl.useProgram(this.prog); gl.uniform2f(this.uRes, this.W, this.H);
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
  image(m: Mat, im: any, sx: number, sy: number, sw: number, sh: number, w: number, h: number, t: RGBA, b: Blend, _smooth?: boolean, fx?: SpriteFx) {
    let tx = this.texCache.get(im);
    const isVideo = typeof HTMLVideoElement !== "undefined" && im instanceof HTMLVideoElement;
    if (!tx) { this.flush(); tx = this.upload(im, this.pixelated && !isVideo); this.texCache.set(im, tx); if (isVideo) this.vidFrame.set(im, this.frameNo); }
    else if (isVideo && this.vidFrame.get(im) !== this.frameNo) {
      // 视频：每个显示帧最多上传一次当前画面
      this.flush(); const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, tx);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); } catch { /* 跨帧解码失败：沿用上一帧 */ }
      this.vidFrame.set(im, this.frameNo);
    }
    const iw = im.videoWidth ?? im.naturalWidth ?? im.width, ih = im.videoHeight ?? im.naturalHeight ?? im.height;
    const c = fx ? this.custom(fx.shader) : null;
    if (c) {
      this.use(tx, b);
      this.withCustom(c, tx, iw, ih, fx!.uniforms, () => this.quad(m, 0, 0, w, h, sx / iw, sy / ih, (sx + sw) / iw, (sy + sh) / ih, t, 0));
      return;
    }
    this.use(tx, b);
    this.quad(m, 0, 0, w, h, sx / iw, sy / ih, (sx + sw) / iw, (sy + sh) / ih, t, 0);
  }
  text(m: Mat, s: string, st: any, alpha: number, b: Blend) {
    const t = this.texts.get(s, st, Math.max(1, Math.min(4, this.dpr * Math.hypot(m[0], m[1]))));
    let tx = this.textTex.get(t.canvas);
    if (!tx) { this.flush(); tx = this.upload(t.canvas, false); this.textTex.set(t.canvas, tx); }
    this.use(tx, b);
    this.quad(m, t.ox, t.oy, t.ox + t.w, t.oy + t.h, 0, 0, 1, 1, [1, 1, 1, alpha], 0);
  }
  end() {
    this.flush();
    if (!this.posts.length) return;
    // 后期处理：离屏纹理之间来回画，最后一遍画到屏幕
    const gl = this.gl; let cur = 0;
    gl.blendFunc(gl.ONE, gl.ZERO);
    this.posts.forEach((p, i) => {
      const last = i === this.posts.length - 1, dst = last ? null : this.fbos[1 - cur].fb;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst); gl.viewport(0, 0, this.el.width, this.el.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      this.withCustom(p.c, this.fbos[cur].tex, this.el.width, this.el.height, p.u, () => this.quad(I, 0, 0, this.W, this.H, 0, 1, 1, 0, [1, 1, 1, 1], 0));
      cur = 1 - cur;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); this.applyBlend(this.blend);
  }
  dispose() { this.texts.clear(); this.particles.clear(); this.gl.getExtension("WEBGL_lose_context")?.loseContext(); }
}
