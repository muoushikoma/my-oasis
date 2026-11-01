import { describe, it, expect } from "vitest";
import { InputMap, DEFAULT_BINDINGS } from "../game-runtime/input.js";
import { FixedLoop } from "../game-runtime/loop.js";

describe("统一输入：动作映射", () => {
  it("键盘输入码映射到动作；按下/松开只持续一步", () => {
    const m = new InputMap(DEFAULT_BINDINGS);
    m.codeDown("KeyD"); m.step();
    expect(m.isDown("right")).toBe(true); expect(m.pressed("right")).toBe(true);
    m.step(); expect(m.pressed("right")).toBe(false); expect(m.isDown("right")).toBe(true);
    m.codeUp("KeyD"); m.step(); expect(m.released("right")).toBe(true); expect(m.isDown("right")).toBe(false);
  });
  it("两步之间按下又松开的快速点按也不会丢", () => {
    const m = new InputMap(DEFAULT_BINDINGS);
    m.codeDown("Space"); m.codeUp("Space"); m.step();
    expect(m.pressed("jump")).toBe(true);
    m.step(); expect(m.isDown("jump")).toBe(false);
  });
  it("一个键可对应多个动作（空格 = 跳 + 确认）", () => {
    const m = new InputMap(DEFAULT_BINDINGS);
    m.codeDown("Space"); m.step();
    expect(m.isDown("jump") && m.isDown("confirm")).toBe(true);
  });
  it("改键：替换或追加，getBindings 可存回去", () => {
    const m = new InputMap(DEFAULT_BINDINGS);
    m.rebind("jump", "KeyZ");
    m.codeDown("Space"); m.step(); expect(m.isDown("jump")).toBe(false);
    m.codeDown("KeyZ"); m.step(); expect(m.isDown("jump")).toBe(true);
    m.rebind("jump", ["KeyC"], false);
    expect(m.getBindings().jump).toEqual(["KeyZ", "KeyC"]);
    const copy = new InputMap(m.getBindings()); copy.codeDown("KeyC"); copy.step(); expect(copy.isDown("jump")).toBe(true);
  });
  it("手柄按钮和摇杆（含死区）", () => {
    const m = new InputMap(DEFAULT_BINDINGS);
    m.setPad([0], [-0.9, 0.1]); m.step();
    expect(m.isDown("jump")).toBe(true); expect(m.isDown("left")).toBe(true); expect(m.isDown("down")).toBe(false);
    expect(m.axis("left", "right")).toBe(-1);
    m.setPad([], [0, 0]); m.step(); expect(m.isDown("left")).toBe(false); expect(m.released("jump")).toBe(true);
  });
  it("触屏虚拟按键直接触发动作", () => {
    const m = new InputMap(DEFAULT_BINDINGS);
    m.virtualDown("attack"); m.step(); expect(m.pressed("attack")).toBe(true);
    m.virtualUp("attack"); m.step(); expect(m.released("attack")).toBe(true);
  });
  it("releaseAll 清空（失焦时）", () => {
    const m = new InputMap(DEFAULT_BINDINGS);
    m.codeDown("KeyA"); m.releaseAll(); m.step(); expect(m.isDown("left")).toBe(false);
  });
});

describe("固定步长循环", () => {
  it("按真实时间累计步数，单帧最多 maxSteps 步", () => {
    const l = new FixedLoop(60, 5);
    expect(l.advance(1000 / 60 + 0.01).steps).toBe(1);
    expect(l.advance(200).steps).toBe(5);
  });
  it("顿帧期间不推进；暂停时不推进；timeScale 放慢", () => {
    const l = new FixedLoop(60);
    l.hitStop(50); expect(l.advance(40).steps).toBe(0); expect(l.advance(10 + 1000 / 60 + 0.1).steps).toBe(1);
    l.paused = true; expect(l.advance(100).steps).toBe(0); l.paused = false;
    l.acc = 0; l.timeScale = 0.5; expect(l.advance(1000 / 60).steps).toBe(0); expect(l.advance(1000 / 60 + 0.1).steps).toBe(1);
  });
});
