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
  params: __c("params", []),
  random: { int: (a, b) => __c("random.int", [a, b]), float: () => __c("random.float", []), pick: (l) => __c("random.pick", [l]), weighted: (m) => __c("random.weighted", [m]) },
  actions: { call: (id, p) => __c("actions.call", [id, p || {}]) },
  events: { emit: (n, d) => __c("events.emit", [n, d || {}]) },
  end: (id) => __c("end", [id]),
  fail: (msg) => __c("fail", [String(msg)]),
  log: (msg) => __c("log", [String(msg)]),
  // ---- oasis/0.4 实时 ----
  sound: { play: (id, o) => __c("sound.play", [String(id), o || {}]), stop: (id) => __c("sound.stop", [id == null ? null : String(id)]) },
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
  },
};
const __draw = [];
function __d(c) { if (__draw.length >= 5000) throw new Error("一帧最多 5000 条绘制指令"); __draw.push(c); }
Object.defineProperty(api, "input", { get: () => __c("input", []) });
Object.defineProperty(api, "dt", { get: () => __c("time", [])[0] });
Object.defineProperty(api, "time", { get: () => __c("time", [])[1] });
Math.random = () => { throw new Error("脚本里不能用 Math.random，请用 api.random"); };
Date.now = () => { throw new Error("脚本里不能读取时间"); };
`;

/** 用 quickjs-emscripten 实现的 JS 沙箱：无网络、无文件；限时、限内存 */
export async function createQuickJsRunner(opts: { transpileTs?: (src: string) => string } = {}): Promise<ScriptRunner> {
  const { getQuickJS, shouldInterruptAfterDeadline } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  return {
    run(file, source, fn, host, limits) {
      if (/\.(lua|py)$/.test(file)) throw new ScriptError(`暂不支持 ${file.endsWith(".py") ? "Python（计划 M9）" : "Lua（计划 M8）"} 脚本`, "error");
      let src = file.endsWith(".ts") ? (opts.transpileTs ? opts.transpileTs(source) : (() => { throw new ScriptError("当前环境不能运行 .ts 脚本", "error"); })()) : source;
      src = src.replace(/\bexport\s+default\s+/g, "").replace(/\bexport\s+(?=(async\s+)?function|const|let|var|class)/g, "");
      if (!/^[A-Za-z_]\w*$/.test(fn)) throw new ScriptError(`函数名「${fn}」不合法`, "error");
      const rt = QuickJS.newRuntime();
      rt.setMemoryLimit(limits.memory_mb * 1024 * 1024);
      rt.setMaxStackSize(256 * 1024);
      rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.time_ms));
      const vm = rt.newContext();
      try {
        const h = vm.newFunction("__host", (mH, aH) => {
          const m = vm.getString(mH), a = JSON.parse(vm.getString(aH));
          const r = host.call(m, a); // 抛出的错误会变成脚本里的异常
          return vm.newString(JSON.stringify(r === undefined ? null : r));
        });
        vm.setProp(vm.global, "__host", h); h.dispose();
        const code = `${PRELUDE}\n${src}\n;if (typeof ${fn} !== "function") throw new Error("脚本里没有函数 ${fn}");\n(() => { const __r = ${fn}(api); if (__draw.length) __c("draw.commit", [__draw]); return JSON.stringify(__r ?? null); })();`;
        const res = vm.evalCode(code, file);
        if (res.error) {
          const e = vm.dump(res.error); res.error.dispose();
          const msg = String(e?.message ?? e);
          if (msg.startsWith(FAIL_MARK) || String(e).includes(FAIL_MARK)) throw new ScriptError(msg.slice(msg.indexOf(FAIL_MARK) + FAIL_MARK.length), "fail");
          if (/interrupted/i.test(msg) || e?.name === "InternalError" && /interrupt/i.test(msg)) throw new ScriptError(`脚本运行超过 ${limits.time_ms} 毫秒，已中止`, "timeout");
          if (/out of memory/i.test(msg) || e === null) throw new ScriptError(`脚本内存超过 ${limits.memory_mb} MB，已中止`, "memory");
          throw new ScriptError(`脚本出错：${msg}`, "error");
        }
        const out = vm.getString(res.value); res.value.dispose();
        return JSON.parse(out);
      } catch (e: any) {
        if (e instanceof ScriptError) throw e;
        const msg = String(e?.message ?? e);
        if (/out of memory|memory/i.test(msg)) throw new ScriptError(`脚本内存超过 ${limits.memory_mb} MB，已中止`, "memory");
        throw new ScriptError(`脚本出错：${msg}`, "error");
      } finally {
        try { vm.dispose(); rt.dispose(); } catch { /* 超内存后释放可能失败，忽略 */ }
      }
    },
  };
}
