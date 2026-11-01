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

const PRELUDE = `
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
  sound: { play: (id, o) => __c("sound.play", [String(id), o || {}]), stop: (id, o) => __c("sound.stop", [id == null ? null : String(id), o || {}]) },
  ai: { request: (id, input, data) => __c("ai.request", [String(id), input == null ? "" : String(input), data || {}]) },
  draw: {
    clear: (color) => __d(["clear", color || null]),
    rect: (x, y, w, h, color, o) => __d(["rect", x, y, w, h, color || "#fff", o || {}]),
    circle: (x, y, r, color, o) => __d(["circle", x, y, r, color || "#fff", o || {}]),
    line: (x1, y1, x2, y2, color, width) => __d(["line", x1, y1, x2, y2, color || "#fff", width || 1]),
    text: (s, x, y, o) => __d(["text", String(s), x, y, o || {}]),
    image: (id, x, y, w, h, o) => __d(["image", String(id), x, y, w == null ? null : w, h == null ? null : h, o || {}]),
    tilemap: (o) => __d(["tilemap", o || {}]),
    camera: (x, y, zoom) => __d(["camera", x || 0, y || 0, zoom || 1]),
    sprite: (id, x, y, o) => __d(["sprite", String(id), x, y, o || {}]),
    particles: (key, x, y, o) => __d(["particles", String(key), x, y, o || {}]),
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
