import { describe, it, expect } from "vitest";
import { AnimFsm, checkFsm, compileCond, type FsmDef } from "../game-runtime/fsm.js";

const clips = {
  idle: { frames: [0, 1], fps: 10 },
  run: { frames: [2, 3, 4], fps: 10 },
  attack: { frames: [5, 6, 7], fps: 10, loop: false },
};
const def: FsmDef = {
  initial: "idle",
  params: { speed: 0, grounded: true, attack: "trigger" },
  states: { idle: {}, run: { on_enter: "start_run" }, attack: { events: { "1": "hit_on", "2": "hit_off" } } },
  transitions: [
    { from: ["idle", "run"], to: "attack", when: "attack" },
    { from: "attack", to: "idle", on_end: true },
    { from: "idle", to: "run", when: "grounded && speed > 10" },
    { from: "run", to: "idle", when: "speed <= 10" },
  ],
};

describe("动画状态机：条件表达式", () => {
  it("支持比较、与或非、括号；记录用到的参数", () => {
    const { fn, uses } = compileCond("(a > 1 && !b) || c == 3");
    expect(uses.sort()).toEqual(["a", "b", "c"]);
    const v = (o: Record<string, number | boolean>) => (n: string) => o[n] ?? 0;
    expect(fn(v({ a: 2, b: false, c: 0 }))).toBe(true);
    expect(fn(v({ a: 2, b: true, c: 0 }))).toBe(false);
    expect(fn(v({ a: 0, b: true, c: 3 }))).toBe(true);
  });
  it("不接受函数调用、属性访问等代码", () => {
    for (const bad of ["alert(1)", "a.constructor", "a; b", "a = 1", "`x`"]) expect(() => compileCond(bad)).toThrow();
  });
});

describe("动画状态机：切换与帧事件", () => {
  it("按参数切换状态，进入时触发 on_enter", () => {
    const f = new AnimFsm(def, clips), seen: string[] = [];
    f.on((e) => seen.push(e.name));
    f.set("speed", 50); f.update(1 / 60);
    expect(f.state).toBe("run");
    expect(seen).toContain("start_run");
    f.set("speed", 0); f.update(1 / 60);
    expect(f.state).toBe("idle");
  });
  it("触发器只用一次；不循环的动画播完发 <状态>:end 并走 on_end", () => {
    const f = new AnimFsm(def, clips), seen: string[] = [];
    f.on((e) => seen.push(e.name));
    f.trigger("attack"); f.update(0.001);
    expect(f.state).toBe("attack");
    expect(f.get("attack")).toBe(false);
    for (let i = 0; i < 40 && f.state === "attack"; i++) f.update(1 / 60);
    expect(seen).toEqual(expect.arrayContaining(["hit_on", "hit_off", "attack:end"]));
    expect(seen.indexOf("hit_on")).toBeLessThan(seen.indexOf("hit_off"));
    expect(f.state).toBe("idle");
  });
  it("textureIndex 给出图集里的帧号", () => {
    const f = new AnimFsm(def, clips);
    f.set("speed", 50); f.update(0.001); expect(f.textureIndex).toBe(2);
    f.update(0.1); expect(f.textureIndex).toBe(3);
  });
  it("检查出写错的状态、动画和参数", () => {
    const errs = checkFsm({ initial: "nope", params: {}, states: { a: { anim: "missing" } }, transitions: [{ from: "a", to: "b", when: "x > 1" }] }, clips);
    expect(errs.length).toBeGreaterThanOrEqual(3);
    expect(checkFsm(def, clips)).toEqual([]);
  });
  it("min_time：在状态里待够时间才切走", () => {
    const d: FsmDef = { initial: "idle", params: { go: true }, states: { idle: {}, run: {} }, transitions: [{ from: "idle", to: "run", when: "go", min_time: 0.2 }] };
    const f = new AnimFsm(d, clips);
    f.update(0.1); f.update(0.05); expect(f.state).toBe("idle");
    f.update(0.1); f.update(0.01); expect(f.state).toBe("run");
  });
});
