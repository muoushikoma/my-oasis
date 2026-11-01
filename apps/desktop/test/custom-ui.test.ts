import { describe, it, expect } from "vitest";
import { buildFrameHtml, BRIDGE_VERSION, FRAME_CSP } from "../src/custom-ui.js";

const enc = (s: string) => new TextEncoder().encode(s);
const pkg = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, enc(v)]));

describe("自定义组件：拼装沙箱文档", () => {
  it("内联脚本、样式、图片；先放 CSP 和桥接脚本", () => {
    const files = pkg({
      "ui/m.html": `<html><head><link rel="stylesheet" href="s/m.css"></head><body><img src="a.png"><script src="m.js"></script></body></html>`,
      "ui/s/m.css": `b{background:url(../a.png)}`, "ui/m.js": `console.log("</script>")`, "ui/a.png": "PNG",
    });
    const html = buildFrameHtml(files, "ui/m.html");
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<style>"));
    expect(html).toContain(FRAME_CSP);
    expect(html).toContain(BRIDGE_VERSION);
    expect(html).toContain("b{background:url(\"data:image/png;base64,");
    expect(html).toContain(`<img src="data:image/png;base64,`);
    expect(html).toContain(`console.log("<\\/script>")`);
    expect(html).not.toContain(`src="m.js"`);
  });
  it("外网地址和包外路径不会被内联", () => {
    const files = pkg({ "ui/m.html": `<script src="https://x.example/a.js"></script><img src="../../etc/passwd">`, "x": "1" });
    const html = buildFrameHtml(files, "ui/m.html");
    expect(html).toContain(`src="https://x.example/a.js"`);
    expect(html).toContain(`src="../../etc/passwd"`);
  });
  it("没有 head 时补全文档", () => {
    expect(buildFrameHtml(pkg({ "m.html": "<p>hi</p>" }), "m.html")).toMatch(/^<!doctype html><html><head><meta charset/);
  });
});

describe("自定义组件：游戏运行时与包内文件（§13.6）", () => {
  it("files 列表展开文件夹，注入 window.oasis.files，运行时脚本放在桥接脚本之后", async () => {
    const { componentFiles } = await import("../src/custom-ui.js");
    const files = pkg({ "g/main.html": `<html><body><script src="main.js"></script></body></html>`, "g/main.js": "1", "g/art/a.png": "PNG", "g/art/b.png": "PNG", "g/art/.hidden": "x", "other.txt": "t" });
    const list = componentFiles(files, ["g/art/", "other.txt", "missing.png"]);
    expect(list).toEqual(["g/art/a.png", "g/art/b.png", "other.txt"]);
    const html = buildFrameHtml(files, "g/main.html", { runtime: "window.RT=1", files: list });
    expect(html).toContain("window.oasis.files=");
    expect(html).toContain('"g/art/a.png":"data:image/png;base64,');
    const bridge = html.indexOf("window.oasis=api"), files_ = html.indexOf("window.oasis.files="), rt = html.indexOf("window.RT=1"), main = html.lastIndexOf("<script");
    expect(bridge).toBeLessThan(files_); expect(files_).toBeLessThan(rt); expect(rt).toBeLessThan(main);
    expect(FRAME_CSP).toContain("'wasm-unsafe-eval'");
    expect(FRAME_CSP).not.toMatch(/'unsafe-eval'/);
  });
});
