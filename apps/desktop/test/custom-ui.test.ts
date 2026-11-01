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
