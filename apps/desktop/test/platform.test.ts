import { describe, it, expect } from "vitest";
import { storyPlatforms, currentPlatform, playableHere, showVirtualControls } from "../src/platform";
import { parseLikes } from "../src/social";

describe("支持平台", () => {
  it("没写时两端都支持", () => {
    expect(storyPlatforms({})).toEqual(["desktop", "mobile"]);
    expect(storyPlatforms({ platforms: ["mobile", "xbox"] })).toEqual(["mobile"]);
  });
  it("判断当前设备", () => {
    expect(currentPlatform({ ua: "Mozilla/5.0 (Windows NT 10.0)" })).toBe("desktop");
    expect(currentPlatform({ ua: "Mozilla/5.0 (Linux; Android 14) Mobile" })).toBe("mobile");
    expect(currentPlatform({ android: true })).toBe("mobile");
    expect(currentPlatform({ search: "?platform=mobile", ua: "Windows" })).toBe("mobile");
  });
  it("只列出本机能玩的", () => {
    expect(playableHere({ platforms: ["mobile"] }, "desktop")).toBe(false);
    expect(playableHere({ platforms: ["mobile"] }, "mobile")).toBe(true);
    expect(playableHere({}, "desktop")).toBe(true);
  });
  it("虚拟摇杆默认电脑上不显示", () => {
    expect(showVirtualControls(undefined, "desktop")).toBe(false);
    expect(showVirtualControls("auto", "mobile")).toBe(true);
    expect(showVirtualControls("on", "desktop")).toBe(true);
    expect(showVirtualControls("off", "mobile")).toBe(false);
  });
});

describe("点赞帖解析", () => {
  it("按标题对应故事，取 👍 数，忽略 PR 和乱标题", () => {
    const m = parseLikes([
      { number: 5, title: "[likes] rainy-bookstore", reactions: { "+1": 7 } },
      { number: 9, title: "[likes] rainy-bookstore", reactions: { "+1": 1 } },
      { number: 6, title: "[likes] other-story", pull_request: {}, reactions: { "+1": 3 } },
      { number: 7, title: "随便聊聊", reactions: { "+1": 2 } },
    ]);
    expect(m.get("rainy-bookstore")).toEqual({ issue: 5, count: 7 });
    expect(m.size).toBe(1);
  });
});
