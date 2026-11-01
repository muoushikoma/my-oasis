// 渲染指令翻译（不需要浏览器）：九宫格、Tiled 地图、非正方形图块、画布视频、post 指令不画东西
import { describe, it, expect } from "vitest";
import { walk, type Backend } from "../src/render/walk";
import { ParticleField } from "../src/render/common";

function rec() {
  const calls: any[] = [];
  const b: Backend = {
    begin() {}, end() {}, clear() {}, rect: (...a) => calls.push(["rect", ...a]), circle() {}, line() {}, text() {},
    image: (m, im, sx, sy, sw, sh, w, h) => calls.push(["image", m[4], m[5], (im as any).id, sx, sy, sw, sh, w, h]),
  };
  return { b, calls };
}
const img = (id: string) => ({ id, complete: true, naturalWidth: 64, naturalHeight: 32 }) as any;

describe("walk：高级绘制指令", () => {
  it("九宫格：9 块，四角不拉伸（slice 顺序同 CSS：上 右 下 左）", () => {
    const { b, calls } = rec();
    walk(b, [["nine", "panel", 10, 20, 200, 100, { slice: [4, 8, 4, 8] }]], img, new ParticleField(), 0, true);
    expect(calls).toHaveLength(9);
    expect(calls[0]).toEqual(["image", 10, 20, "panel", 0, 0, 8, 4, 8, 4]); // 左上角原样
    expect(calls[4]).toEqual(["image", 18, 24, "panel", 8, 4, 48, 24, 184, 92]); // 中间拉伸
    expect(calls[8]).toEqual(["image", 202, 116, "panel", 56, 28, 8, 4, 8, 4]); // 右下角原样
  });
  it("tilemap 支持 tile_w/tile_h、margin/spacing、grid", () => {
    const { b, calls } = rec();
    walk(b, [["tilemap", { tileset: "t", tile_w: 16, tile_h: 8, columns: 3, margin: 1, spacing: 2, map: [[4]] }]], img, new ParticleField(), 0, true);
    expect(calls[0]).toEqual(["image", 0, 0, "t", 1 + 1 * 18, 1 + 1 * 10, 16, 8, 16, 8]);
  });
  it("tiled：画可见图层，可以只挑某些图层", () => {
    const map = { layers: [{ name: "a", visible: true, tilemaps: [{ tileset: "t", tile_size: 16, columns: 4, map: [[0, 1]] }] }, { name: "b", visible: false, tilemaps: [{ tileset: "t", tile_size: 16, columns: 4, map: [[2]] }] }] };
    const r1 = rec(); walk(r1.b, [["tiled", "m", {}]], img, new ParticleField(), 0, true, { tiled: () => map });
    expect(r1.calls).toHaveLength(2);
    const r2 = rec(); walk(r2.b, [["tiled", "m", { layers: ["b"], x: 5 }]], img, new ParticleField(), 0, true, { tiled: () => map });
    expect(r2.calls).toEqual([["image", 5, 0, "t", 32, 0, 16, 16, 16, 16]]);
  });
  it("video：解码好了才画（readyState ≥ 2）；post 指令本身不画", () => {
    const v: any = { id: "v", readyState: 1, videoWidth: 320, videoHeight: 180 };
    const { b, calls } = rec();
    const res = { video: () => v };
    walk(b, [["video", "v", 0, 0, null, null, {}], ["post", "fx", {}]], img, new ParticleField(), 0, true, res);
    expect(calls).toHaveLength(0);
    v.readyState = 4;
    walk(b, [["video", "v", 0, 0, null, null, {}], ["post", "fx", {}]], img, new ParticleField(), 0, true, res);
    expect(calls).toEqual([["image", 0, 0, "v", 0, 0, 320, 180, 320, 180]]);
  });
});
