import { describe, it, expect } from "vitest";
import { walk, sliceOf, type Backend } from "../src/render/walk";
import { ParticleField } from "../src/render/common";
import { parseTiled } from "@my-oasis/schema";
import { sanitizeOverlay } from "@my-oasis/engine";

function rec() {
  const calls: any[] = [];
  const b: Backend = {
    begin() {}, end() {}, clear() {}, rect() {}, circle() {}, line() {}, text() {},
    image(m, _im, sx, sy, sw, sh, w, h, _t, _b, _s, fx) { calls.push({ m: m.map((x) => Math.round(x * 100) / 100), sx, sy, sw, sh, w, h, fx }); },
  };
  return { b, calls };
}
const im = { complete: true, naturalWidth: 32, naturalHeight: 32 } as any;

describe("绘制：九宫格、Tiled、视频、逐精灵着色器", () => {
  it("九宫格切成 9 块，四角不拉伸", () => {
    const { b, calls } = rec();
    walk(b, [["nine", "p", 10, 20, 100, 50, { slice: 8 }]], () => im, new ParticleField(), 0, true);
    expect(calls.length).toBe(9);
    expect(calls[0]).toMatchObject({ sx: 0, sy: 0, sw: 8, sh: 8, w: 8, h: 8 });
    expect(calls[4]).toMatchObject({ sx: 8, sy: 8, sw: 16, sh: 16, w: 84, h: 34 });
    expect(calls[8].m.slice(4)).toEqual([102, 62]);
    expect(sliceOf([1, 2])).toEqual([1, 2, 1, 2]);
  });
  it("Tiled：按图块集取图、翻转、只画屏幕里的格子", () => {
    const map = parseTiled(JSON.stringify({ width: 100, height: 2, tilewidth: 16, tileheight: 16, tilesets: [{ firstgid: 1, name: "t", image: "t.png", columns: 2, tilecount: 4, tilewidth: 16, tileheight: 16 }],
      layers: [{ type: "tilelayer", name: "a", width: 100, height: 2, data: Array.from({ length: 200 }, (_, i) => (i === 1 ? (2 | 0x80000000) >>> 0 : 1)) }] }), "", () => "tiles");
    const { b, calls } = rec();
    walk(b, [["tiled", "m", {}]], () => im, new ParticleField(), 0, true, { tiled: () => map, view: { w: 64, h: 32 } });
    expect(calls.length).toBeLessThan(20); // 100×2 格只画了屏幕附近的
    const flipped = calls.find((c) => c.sx === 16); expect(flipped.m[0]).toBe(-1);
  });
  it("视频没准备好就跳过；逐精灵 shader 透传给后端；post 不算绘制", () => {
    const { b, calls } = rec();
    const video = { readyState: 1, videoWidth: 0 } as any;
    walk(b, [["video", "v", 0, 0, 10, 10, {}], ["sprite", "s", 0, 0, { shader: "wave", uniforms: { u_k: 2 } }], ["post", "fx", {}]], () => im, new ParticleField(), 0, true, { video: () => video });
    expect(calls.length).toBe(1);
    expect(calls[0].fx).toEqual({ shader: "wave", uniforms: { u_k: 2 } });
  });
  it("界面层九宫格字段经过清洗", () => {
    const o = sanitizeOverlay({ style: { bg_image: "panel", bg_slice: [8, 9999, "x"], bg_repeat: "evil" }, children: [{ type: "image", asset: "p", slice: 12, repeat: "round" }] });
    expect(o.style).toMatchObject({ bg_image: "panel", bg_slice: [8, 1024, 0] });
    expect(o.style.bg_repeat).toBeUndefined();
    expect(o.children[0]).toMatchObject({ slice: [12], repeat: "round" });
    expect(sanitizeOverlay({ style: { bg_image: "url(javascript:1)" } }).style.bg_image).toBeUndefined();
  });
});
