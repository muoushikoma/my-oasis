import { describe, it, expect, beforeAll } from "vitest";
import { createQuickJsRunner, ScriptError, type ScriptRunner } from "../src/index.js";

let r: ScriptRunner;
beforeAll(async () => { r = await createQuickJsRunner({ timeScale: 1000 }); });
const host = (calls: string[] = []) => ({ call: (m: string, a: any[]) => { calls.push(m); return m === "params" ? { p: 1 } : null; } });
const lim = { time_ms: 50, memory_mb: 16 };

describe("常驻沙箱：性能优化后隔离保证不变", () => {
  it("脚本变量、隐式全局变量不跨调用保留", () => {
    const src = `let n = 0; function f(api){ n++; leaked = (typeof leaked === "number" ? leaked : 0) + 1; return [n, leaked]; }`;
    expect(r.run("a.js", src, "f", host(), lim)).toEqual([1, 1]);
    expect(r.run("a.js", src, "f", host(), lim)).toEqual([1, 1]);
  });
  it("api 被冻结，改不了；params 每次调用重新读取", () => {
    const src = `function f(api){ api.state = null; api.extra = 1; return [typeof api.state.get, api.extra === undefined, api.params.p]; }`;
    expect(r.run("b.js", src, "f", host(), lim)).toEqual(["function", true, 1]);
  });
  it("超时后沙箱重建，下一次调用正常", async () => {
    const strict = await createQuickJsRunner({ coldRuns: 0 });
    const src = `function loop(){ while(true){} } function ok(){ return 7 }`;
    expect(() => strict.run("c.js", src, "loop", host(), { time_ms: 20, memory_mb: 16 })).toThrow(ScriptError);
    expect(strict.run("c.js", src, "ok", host(), lim)).toBe(7);
  });
  it("脚本内容变了会重新编译", () => {
    expect(r.run("d.js", `function f(){ return 1 }`, "f", host(), lim)).toBe(1);
    expect(r.run("d.js", `function f(){ return 2 }`, "f", host(), lim)).toBe(2);
  });
});

describe("新绘制指令", () => {
  it("sprite / particles 生成指令；api.alpha 可读", () => {
    let drawn: any[] = [];
    const h = { call: (m: string, a: any[]) => { if (m === "draw.commit") drawn = a[0]; if (m === "time") return [16, 100, 0.5]; return m === "params" ? {} : null; } };
    const a = r.run("e.js", `function draw(api){ api.draw.sprite("hero", 1, 2, { frame_w: 16, frame_h: 16, fps: 8 }); api.draw.particles("fx", 3, 4, { rate: 10 }); return api.alpha; }`, "draw", h, lim);
    expect(a).toBe(0.5);
    expect(drawn).toEqual([["sprite", "hero", 1, 2, { frame_w: 16, frame_h: 16, fps: 8 }], ["particles", "fx", 3, 4, { rate: 10 }]]);
  });
});
