/** 脚本层：统一接口；QuickJS 实现见 createQuickJsRunner */
export interface ScriptHost { call(method: string, args: any[]): any }
export interface ScriptLimits { time_ms: number; memory_mb: number }
export interface ScriptRunner {
  run(file: string, source: string, fn: string, host: ScriptHost, limits: ScriptLimits): any;
}
export class ScriptError extends Error {
  constructor(message: string, public kind: "timeout" | "memory" | "error" | "fail") { super(message); }
}
export const FAIL_MARK = "__OASIS_FAIL__:";
import { PHYSICS_JS } from "./physics-sandbox.js";

const PRELUDE = `
${PHYSICS_JS}
const __c = (m, a) => JSON.parse(__host(m, JSON.stringify(a)));
const api = {
  state: { get: (k) => __c("state.get", [k]), set: (k, v) => __c("state.set", [k, v]), inc: (k, n) => __c("state.inc", [k, n]),
           add: (k, v) => __c("state.add", [k, v]), remove: (k, v) => __c("state.remove", [k, v]) },
  random: { int: (a, b) => __c("random.int", [a, b]), float: () => __c("random.float", []), pick: (l) => __c("random.pick", [l]), weighted: (m) => __c("random.weighted", [m]) },
  actions: { call: (id, p) => __c("actions.call", [id, p || {}]) },
  events: { emit: (n, d) => __c("events.emit", [n, d || {}]) },
  end: (id) => __c("end", [id]),
  fail: (msg) => __c("fail", [String(msg)]),
  log: (msg) => __c("log", [String(msg)]),
  // ---- oasis/0.4 实时 ----
  sound: { play: (id, o) => __c("sound.play", [String(id), o || {}]), stop: (id, o) => __c("sound.stop", [id == null ? null : String(id), o || {}]),
           set: (voice, o) => __c("sound.set", [String(voice), o || {}]), listener: (o) => __c("sound.listener", [o || {}]) },
  controls: { show: (ids) => __c("controls.show", [ids == null ? null : ids]) },
  tiled: { get: (id) => __c("tiled.get", [String(id)]), solids: (id) => __c("tiled.solids", [String(id)]) },
  textinput: { open: (o) => __c("textinput.open", [o || {}]), close: () => __c("textinput.close", []) },
  video: { play: (id, o) => __c("video.play", [String(id), o || {}]), stop: () => __c("video.stop", []), texture: (id, o) => __c("video.texture", [String(id), o || {}]) },
  // ---- 常用引擎工具（纯计算，在沙箱里运行，结果可重现） ----
  ease: (() => {
    const P = Math.PI, b = (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; };
    return {
      linear: (t) => t, in_quad: (t) => t * t, out_quad: (t) => t * (2 - t), in_out_quad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
      in_cubic: (t) => t * t * t, out_cubic: (t) => 1 - Math.pow(1 - t, 3), in_out_cubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      in_sine: (t) => 1 - Math.cos((t * P) / 2), out_sine: (t) => Math.sin((t * P) / 2), in_out_sine: (t) => -(Math.cos(P * t) - 1) / 2,
      out_back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
      out_elastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * 2 * P) / 3) + 1),
      out_bounce: b,
    };
  })(),
  math: {
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), lerp: (a, b, t) => a + (b - a) * t,
    dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1), angle: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1),
    approach: (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step)),
  },
  /** 补间：给定开始时间、时长，按 api.time 算当前值。tween(from, to, start_ms, duration_ms, ease) */
  tween: (from, to, start, dur, e) => { const f = typeof e === "function" ? e : (api.ease[e] || api.ease.linear); const t = dur > 0 ? Math.max(0, Math.min(1, (api.time - start) / dur)) : 1; return from + (to - from) * f(t); },
  collide: {
    rect: (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,
    circle: (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r,
    circle_rect: (c, r) => { const nx = Math.max(r.x, Math.min(c.x, r.x + r.w)), ny = Math.max(r.y, Math.min(c.y, r.y + r.h)); return Math.hypot(c.x - nx, c.y - ny) < c.r; },
    point: (px, py, r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h,
    /** 地图格子：map 是字符串行或数组行，solid 是“算墙”的格子值列表 */
    tile_at: (map, tile, px, py) => { const row = map[Math.floor(py / tile)]; if (row == null) return null; const v = row[Math.floor(px / tile)]; return v === undefined ? null : v; },
  },
  physics: {
    // 刚体物理世界（见 physics-sandbox.ts）：world / add / remove / get / joint / step / touching / at / impulse / vertices
    ...__phys,
    /**
     * 简单平台/俯视物理：按 x、y 分两步移动矩形 body {x,y,w,h}，碰到墙就停。
     * world: { rects?: [{x,y,w,h}], map?, tile?, solid?: [格子值] }。返回 { x, y, hit_x, hit_y, on_ground }
     */
    move: (body, dx, dy, world) => {
      world = world || {}; const rects = world.rects || [], solid = world.solid || ["#", 1], T = world.tile || 16;
      const hits = (bx, by) => {
        for (const r of rects) if (bx < r.x + r.w && bx + body.w > r.x && by < r.y + r.h && by + body.h > r.y) return r;
        if (world.map) { for (let ty = Math.floor(by / T); ty <= Math.floor((by + body.h - 0.001) / T); ty++) for (let tx = Math.floor(bx / T); tx <= Math.floor((bx + body.w - 0.001) / T); tx++) { const row = world.map[ty]; const v = row == null ? undefined : row[tx]; if (v !== undefined && solid.indexOf(v) >= 0) return { x: tx * T, y: ty * T, w: T, h: T }; } }
        return null;
      };
      let x = body.x, y = body.y, hx = false, hy = false;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(1, Math.min(body.w, body.h) / 2)));
      for (let i = 0; i < steps; i++) {
        if (!hx && dx) { const nx = x + dx / steps, r = hits(nx, y); if (r) { hx = true; x = dx > 0 ? r.x - body.w : r.x + r.w; } else x = nx; }
        if (!hy && dy) { const ny = y + dy / steps, r = hits(x, ny); if (r) { hy = true; y = dy > 0 ? r.y - body.h : r.y + r.h; } else y = ny; }
      }
      return { x, y, hit_x: hx, hit_y: hy, on_ground: hy && dy > 0 };
    },
  },
  // ---- 原生界面与设备 ----
  overlay: { show: (id, spec) => __c("overlay.show", [String(id), spec || {}]), hide: (id) => __c("overlay.hide", [id == null ? null : String(id)]) },
  scene: { go: (name, o) => __c("scene.go", [String(name), o || {}]), current: () => __c("scene.current", []) },
  fx: { shake: (amount, ms) => __c("fx.shake", [Number(amount) || 4, Number(ms) || 300]), fade: (o) => __c("fx.fade", [o || {}]), filter: (o) => __c("fx.filter", [o || {}]) },
  device: { vibrate: (p) => __c("device.vibrate", [p]), copy: (text) => __c("device.copy", [String(text)]) },
  save: { now: (label) => __c("save.now", [label == null ? "" : String(label)]) },
  storage: { get: (k) => __c("storage.get", [String(k)]), set: (k, v) => __c("storage.set", [String(k), v === undefined ? null : v]) },
  ai: { request: (id, input, data) => __c("ai.request", [String(id), input == null ? "" : String(input), data || {}]) },
  draw: {
    clear: (color) => __d(["clear", color || null]),
    rect: (x, y, w, h, color, o) => __d(["rect", x, y, w, h, color || "#fff", o || {}]),
    circle: (x, y, r, color, o) => __d(["circle", x, y, r, color || "#fff", o || {}]),
    line: (x1, y1, x2, y2, color, width) => __d(["line", x1, y1, x2, y2, color || "#fff", width || 1]),
    text: (s, x, y, o) => __d(["text", String(s), x, y, o || {}]),
    image: (id, x, y, w, h, o) => __d(["image", String(id), x, y, w == null ? null : w, h == null ? null : h, o || {}]),
    tilemap: (o) => __d(["tilemap", o || {}]),
    camera: (x, y, zoom, o) => __d(["camera", x || 0, y || 0, zoom || 1, o || {}]),
    sprite: (id, x, y, o) => __d(["sprite", String(id), x, y, o || {}]),
    particles: (key, x, y, o) => __d(["particles", String(key), x, y, o || {}]),
    // 自定义着色器后期处理：整个画布画完后再过一遍（最多 4 遍，按顺序）
    post: (shader, uniforms) => __d(["post", String(shader), uniforms || {}]),
    // 九宫格图片：四角不拉伸；slice 是四边留的像素（一个数或 [上, 右, 下, 左]）
    nine: (id, x, y, w, h, o) => __d(["nine", String(id), x, y, w, h, o || {}]),
    // Tiled 地图（type: tilemap 素材）：{ x?, y?, layers?: [图层名], z? }
    tiled: (id, o) => __d(["tiled", String(id), o || {}]),
    // 画布里的视频（先用 api.video.texture 播放）
    video: (id, x, y, w, h, o) => __d(["video", String(id), x, y, w == null ? null : w, h == null ? null : h, o || {}]),
  },
};
let __draw = [];
function __d(c) { if (__draw.length >= 5000) throw new Error("一帧最多 5000 条绘制指令"); __draw.push(c); }
Object.defineProperty(api, "params", { get: () => __c("params", []), enumerable: true });
Object.defineProperty(api, "input", { get: () => __c("input", []) });
Object.defineProperty(api, "screen", { get: () => __c("screen", []) });
Object.defineProperty(api, "lang", { get: () => __c("lang", []) });
Object.defineProperty(api, "dt", { get: () => __c("time", [])[0] });
Object.defineProperty(api, "time", { get: () => __c("time", [])[1] });
Object.defineProperty(api, "alpha", { get: () => __c("time", [])[2] });
Math.random = () => { throw new Error("脚本里不能用 Math.random，请用 api.random"); };
Date.now = () => { throw new Error("脚本里不能读取时间"); };
`;


/**
 * 沙箱运行时（常驻）：每个脚本文件一个常驻 QuickJS 运行时 + 上下文，只在第一次调用时创建并编译，
 * 之后每次调用直接执行已编译好的函数，省掉“新建沙箱 + 解析几千字的前置代码”的开销。
 * 隔离保证不变：
 *  - 每次调用都重新执行一遍脚本文件的顶层代码（包在一个函数里），脚本里的变量不会留到下一次；
 *  - 调用结束后删除脚本新建的全局变量；api 对象被冻结，改不了；
 *  - 状态只能经由 api.state 读写，引擎照常快照/撤销（render 只读的保证在引擎里，不受影响）。
 * 每次调用单独计时（中断处理器的截止时间）、内存上限每次重设；超时/超内存/栈溢出后整个沙箱丢弃重建。
 * 计时只算脚本自己在沙箱里执行的时间，不含宿主 API（state.get 等）耗时。
 * 冷启动（WASM 刚加载、尚未优化）的前几次调用，时间上限至少 COLD_MS，避免慢机器上误杀。
 * timeScale：把所有时间上限乘以这个倍数（测试里用来消除机器速度的影响）。
 */
const COLD_RUNS = 8, COLD_MS = 1000, MAX_SESSIONS = 24;
const SEAL = `
(function(){
  const fr = (o) => { for (const k of Object.keys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (d && "value" in d && d.value && typeof d.value === "object") fr(d.value); } return Object.freeze(o); };
  fr(api);
  const base = new Set(Object.getOwnPropertyNames(globalThis));
  globalThis.__api = api;
  globalThis.__begin = () => { __draw = []; };
  globalThis.__end = (r) => {
    for (const k of Object.getOwnPropertyNames(globalThis)) if (!base.has(k)) { try { delete globalThis[k]; } catch (e) {} }
    if (__draw.length) __c("draw.commit", [__draw]);
    return JSON.stringify(r === undefined ? null : r);
  };
  base.add("__begin"); base.add("__end"); base.add("__api");
})();`;
export async function createQuickJsRunner(opts: { transpileTs?: (src: string) => string; timeScale?: number; coldRuns?: number } = {}): Promise<ScriptRunner> {
  const { getQuickJS } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let runs = 0;
  type Session = { rt: any; vm: any; src: string; fns: Map<string, any>; host: ScriptHost | null; start: number; hostMs: number; budget: number };
  const sessions = new Map<string, Session>();
  const drop = (file: string) => {
    const s = sessions.get(file); if (!s) return; sessions.delete(file);
    try { for (const f of s.fns.values()) f.dispose(); s.vm.dispose(); s.rt.dispose(); } catch { /* 超内存后释放可能失败，忽略 */ }
  };
  const evalOk = (vm: any, code: string, name: string) => {
    const r = vm.evalCode(code, name);
    if (r.error) { const e = vm.dump(r.error); r.error.dispose(); throw new ScriptError(`脚本出错：${String(e?.message ?? e)}`, "error"); }
    return r.value;
  };
  const open = (file: string, src: string): Session => {
    const old = sessions.get(file);
    if (old && old.src === src) { sessions.delete(file); sessions.set(file, old); return old; } // LRU
    if (old) drop(file);
    if (sessions.size >= MAX_SESSIONS) drop(sessions.keys().next().value!);
    const rt = QuickJS.newRuntime();
    rt.setMaxStackSize(256 * 1024);
    const vm = rt.newContext();
    const s: Session = { rt, vm, src, fns: new Map(), host: null, start: Infinity, hostMs: 0, budget: Infinity };
    rt.setInterruptHandler(() => now() - s.start - s.hostMs > s.budget);
    const h = vm.newFunction("__host", (mH: any, aH: any) => {
      const m = vm.getString(mH), a = JSON.parse(vm.getString(aH));
      const t0 = now();
      try { var r = s.host!.call(m, a); } finally { s.hostMs += now() - t0; } // 抛出的错误会变成脚本里的异常
      return vm.newString(JSON.stringify(r === undefined ? null : r));
    });
    vm.setProp(vm.global, "__host", h); h.dispose();
    try { evalOk(vm, PRELUDE + SEAL + ";1", "prelude").dispose(); } catch (e) { vm.dispose(); rt.dispose(); throw e; }
    sessions.set(file, s);
    return s;
  };
  const fail = (e: any, limits: ScriptLimits): ScriptError => {
    const msg = String(e?.message ?? e);
    if (msg.startsWith(FAIL_MARK) || String(e).includes(FAIL_MARK)) return new ScriptError(msg.slice(msg.indexOf(FAIL_MARK) + FAIL_MARK.length), "fail");
    if (/interrupted/i.test(msg) || e?.name === "InternalError" && /interrupt/i.test(msg)) return new ScriptError(`脚本运行超过 ${limits.time_ms} 毫秒，已中止`, "timeout");
    if (/out of memory/i.test(msg) || e === null) return new ScriptError(`脚本内存超过 ${limits.memory_mb} MB，已中止`, "memory");
    return new ScriptError(`脚本出错：${msg}`, "error");
  };
  // 预热一次，让 WASM 编译和初始化发生在游戏开始之前
  try { open("__warmup__", ""); drop("__warmup__"); } catch { /* 预热失败不影响正常运行 */ }
  return {
    run(file, source, fn, host, limits) {
      if (/\.(lua|py)$/.test(file)) throw new ScriptError(`暂不支持 ${file.endsWith(".py") ? "Python（计划 M9）" : "Lua（计划 M8）"} 脚本`, "error");
      let src = file.endsWith(".ts") ? (opts.transpileTs ? opts.transpileTs(source) : (() => { throw new ScriptError("当前环境不能运行 .ts 脚本", "error"); })()) : source;
      src = src.replace(/\bexport\s+default\s+/g, "").replace(/\bexport\s+(?=(async\s+)?function|const|let|var|class)/g, "");
      if (!/^[A-Za-z_]\w*$/.test(fn)) throw new ScriptError(`函数名「${fn}」不合法`, "error");
      const s = open(file, src);
      let dead = false;
      try {
        s.rt.setMemoryLimit(limits.memory_mb * 1024 * 1024);
        s.budget = Infinity; s.start = Infinity; s.hostMs = 0; s.host = host;
        let f = s.fns.get(fn);
        if (!f) {
          // 编译：函数体 = 整个脚本文件 + 调用目标函数。每次调用都重新跑顶层代码，变量不跨调用保留。
          f = evalOk(s.vm, `(function (api) {\n${src}\n;if (typeof ${fn} !== "function") throw new Error("脚本里没有函数 ${fn}");\nreturn ${fn}(api);\n})`, file);
          s.fns.set(fn, f);
        }
        s.budget = Math.max(limits.time_ms, runs++ < (opts.coldRuns ?? COLD_RUNS) ? COLD_MS : 0) * (opts.timeScale ?? 1);
        const vm = s.vm;
        const api = vm.getProp(vm.global, "__api"), begin = vm.getProp(vm.global, "__begin"), end = vm.getProp(vm.global, "__end");
        try {
          vm.callFunction(begin, vm.undefined).value?.dispose();
          s.start = now();
          const res = vm.callFunction(f, vm.undefined, api);
          if (res.error) {
            const e = vm.dump(res.error); res.error.dispose();
            const err = fail(e, limits); if (err.kind === "timeout" || err.kind === "memory") dead = true;
            s.start = Infinity;
            try { const c = vm.callFunction(end, vm.undefined, vm.undefined); c.error ? c.error.dispose() : c.value.dispose(); } catch { dead = true; } // 清理全局变量
            throw err;
          }
          const out = vm.callFunction(end, vm.undefined, res.value); res.value.dispose();
          if (out.error) { const e = vm.dump(out.error); out.error.dispose(); const err = fail(e, limits); if (err.kind !== "error" && err.kind !== "fail") dead = true; throw err; }
          const str = vm.getString(out.value); out.value.dispose();
          return JSON.parse(str);
        } finally { api.dispose(); begin.dispose(); end.dispose(); }
      } catch (e: any) {
        if (e instanceof ScriptError) throw e;
        dead = true;
        const msg = String(e?.message ?? e);
        if (/out of memory|memory/i.test(msg)) throw new ScriptError(`脚本内存超过 ${limits.memory_mb} MB，已中止`, "memory");
        throw new ScriptError(`脚本出错：${msg}`, "error");
      } finally {
        s.start = Infinity; s.host = null;
        if (dead) drop(file);
      }
    },
  };
}
