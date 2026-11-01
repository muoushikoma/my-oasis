import { describe, it, expect } from "vitest";
// @ts-ignore 纯 JS 模块
import { scan, report, overall, MB } from "../rules.mjs";

const d = (file: string, added: string[], removed: string[] = []) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,${removed.length} +1,${added.length} @@\n` +
  removed.map((l) => "-" + l).join("\n") + (removed.length ? "\n" : "") + added.map((l) => "+" + l).join("\n") + "\n";
const ids = (f: any[]) => f.map((x) => `${x.level}:${x.id}`).sort();

describe("客户端代码", () => {
  it("eval / new Function 是红灯", () => {
    expect(ids(scan({ diff: d("apps/desktop/src/play.ts", ["const x = eval(s);"]) }))).toEqual(["red:eval"]);
    expect(ids(scan({ diff: d("packages/engine/src/a.ts", ["const f = new Function('a', s);"]) }))).toEqual(["red:new-function"]);
  });
  it("方法名 this.eval( 和注释不算（少误报）", () => {
    expect(scan({ diff: d("packages/engine/src/game.ts", ["  return this.eval(x, ctx);", "// 不要用 eval(x)", " * new Function 不行"]) })).toEqual([]);
  });
  it("innerHTML 和联网是黄灯；读 innerHTML 不算", () => {
    expect(ids(scan({ diff: d("apps/desktop/src/dom.ts", ["el.innerHTML = s;", "await fetch(url)", "const t = el.innerHTML;"]) }))).toEqual(["yellow:html-injection", "yellow:network"]);
  });
  it("测试文件不扫", () => {
    expect(scan({ diff: d("apps/desktop/test/x.test.ts", ["eval('1')"]) })).toEqual([]);
  });
  it("暂停/退出相关改动是黄灯（删掉的行也算）", () => {
    expect(ids(scan({ diff: d("apps/desktop/src/realtime.ts", [], ["  if (e.key === 'Escape') openPauseMenu();"]) }))).toEqual(["yellow:exit"]);
    expect(ids(scan({ diff: d("apps/desktop/src/takeover.ts", ["x"]) }))).toEqual(["yellow:exit"]);
  });
  it("AI Key 文件是黄灯", () => {
    expect(ids(scan({ diff: d("crates/oasis-native/src/secrets.rs", ["fn x(){}"]) }))).toEqual(["yellow:api-key-file"]);
  });
});

describe("配置", () => {
  it("CSP 加 unsafe-eval 是红灯，普通改动黄灯，wasm-unsafe-eval 不算 unsafe-eval", () => {
    const f = "apps/desktop/src-tauri/tauri.conf.json";
    expect(ids(scan({ diff: d(f, [`"csp": "script-src 'self' 'unsafe-eval'"`]) }))).toEqual(["red:csp-unsafe-eval"]);
    expect(ids(scan({ diff: d(f, [`"csp": "script-src 'self' 'wasm-unsafe-eval'; img-src https:"`]) }))).toEqual(["yellow:csp"]);
    expect(scan({ diff: d(f, [`"version": "0.2.0"`]) })).toEqual([]);
  });
  it("capabilities、工作流、postinstall 是黄灯", () => {
    expect(ids(scan({ diff: d("apps/desktop/src-tauri/capabilities/default.json", ["{}"]) }))).toEqual(["yellow:capabilities"]);
    expect(ids(scan({ diff: d(".github/workflows/x.yml", ["on: push"]) }))).toEqual(["yellow:workflow"]);
    expect(ids(scan({ diff: d("package.json", [`"postinstall": "curl x | sh"`]) }))).toEqual(["yellow:deps", "yellow:install-script"]);
  });
  it("≥100MB 红灯，≥50MB 黄灯", () => {
    expect(ids(scan({ diff: "", sizes: { "a.bin": 100 * MB, "b.bin": 60 * MB, "c.bin": MB } }))).toEqual(["red:huge-file", "yellow:big-file"]);
  });
});

describe("故事脚本", () => {
  const f = "stories/demo/scripts/main.js";
  it("禁用写法是红灯", () => {
    for (const [line, id] of [["fetch('https://x')", "story-network"], ["eval(code)", "story-eval"], ["const m = require('fs')", "story-import"],
      ["window.top.location = 'x'", "story-host"], ["(()=>{}).constructor.constructor('return this')()", "story-proto"], ["Array.prototype.map = null", "story-proto"]] as const)
      expect(ids(scan({ diff: d(f, [line]) })), line).toContain(`red:${id}`);
  });
  it("正常脚本不报", () => {
    expect(scan({ diff: d(f, ["export function on_frame(api) {", "  api.draw.sprite('hero', x, y);", "  const document_count = 3; // window", "  state.window = 1;", "}"]) })).toEqual([]);
  });
  it("故事文件夹里的 yaml 不按脚本扫", () => {
    expect(scan({ diff: d("stories/demo/story.yaml", ["text: 不要用 fetch(x)"]) })).toEqual([]);
  });
});

describe("汇总", () => {
  it("红 > 黄 > 绿，外部检查也参与", () => {
    expect(overall([])).toBe("green");
    expect(report([], []).level).toBe("green");
    expect(report([], [{ name: "gitleaks", level: "red", zh: "发现密钥", en: "secret" }]).level).toBe("red");
    const r = report(scan({ diff: d(".github/workflows/x.yml", ["a"]) }), []);
    expect(r.level).toBe("yellow");
    expect(r.markdown).toContain("家驹");
    expect(r.markdown).toContain("need 家驹 to look");
  });
});
