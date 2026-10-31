import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateFiles, filesFromText, filesToZip, filesFromZip, aiFixRequest, formatIssues, parseExpr, evaluate, builtinFuncs } from "../src/index.js";
import { loadFromPath } from "../src/node.js";

const root = new URL("../../../", import.meta.url).pathname;
const lighthouse = readFileSync(root + "examples/lighthouse-mini/story.yaml", "utf8");
const v = (y: string, extra: Record<string, string> = {}) => validateFiles(filesFromText(y, extra));
const codes = (r: ReturnType<typeof v>) => r.issues.filter((i) => i.level === "error").map((i) => i.code);

describe("示例故事", () => {
  it("两个规范示例都能通过校验", () => {
    for (const p of ["examples/lighthouse-mini", "examples/guess-the-box"]) {
      const r = validateFiles(loadFromPath(root + p));
      expect(r.issues.filter((i) => i.level === "error"), formatIssues(r)).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });
  it("包内 schema 与 docs/schema 一致", () => {
    expect(readFileSync(root + "packages/schema/src/story.schema.json", "utf8")).toBe(readFileSync(root + "docs/schema/story.schema.json", "utf8"));
  });
  it(".oasis（zip）可以读取，且允许多套一层文件夹", () => {
    const files = filesFromText(lighthouse);
    const nested = new Map([["my-story/story.yaml", files.get("story.yaml")!]]);
    expect(validateFiles(filesFromZip(filesToZip(files))).ok).toBe(true);
    expect(validateFiles(filesFromZip(filesToZip(nested))).ok).toBe(true);
  });
});

describe("大白话报错", () => {
  it("文字没加单引号：指出行号并给出写法", () => {
    const y = lighthouse.replace(`steps: [ { set: { location: "params.to" } } ]`, "steps: [ { set: { location: 海滩 } } ]");
    const r = v(y);
    const i = r.issues.find((x) => x.code === "unknown_name")!;
    expect(i).toBeTruthy();
    expect(i.line).toBe(y.split("\n").findIndex((l) => l.includes("location: 海滩")) + 1);
    expect(i.fix).toContain("'海滩'");
    expect(i.where).toContain("动作「move」");
  });
  it("事件写成 on: 时提示改成 hook", () => {
    const r = v(lighthouse.replace("hook: state:day", "on: state:day"));
    expect(r.issues.some((i) => i.message.includes("on") && i.fix?.includes("hook"))).toBe(true);
    expect(codes(r)).not.toContain("schema_required");
  });
  it("裁量权超过全局上限", () => {
    const r = v(lighthouse.replace("max_authority: 2", "max_authority: 1"));
    expect(codes(r)).toContain("authority_exceeds");
  });
  it("没写 max_authority 时默认上限为 1", () => {
    const r = v(lighthouse.replace("    max_authority: 2\n", ""));
    expect(r.issues.find((i) => i.code === "authority_exceeds")?.message).toContain("默认是 1");
  });
  it("引用不存在的状态，给出相近名字", () => {
    const r = v(lighthouse.replace('when: "state.oil <= 0"', 'when: "state.oill <= 0"'));
    const i = r.issues.find((x) => x.code === "unknown_state")!;
    expect(i.message).toContain("oil");
  });
  it("名字用了大写 / 中文", () => {
    const r = v(lighthouse.replace("  oil:      {", "  Oil:      {"));
    const i = r.issues.find((x) => x.code === "schema_pattern" && x.message.includes("Oil"))!;
    expect(i.fix).toContain("oil");
  });
  it("Tab 缩进", () => {
    const r = v("spec: oasis/0.3\nmeta:\n\tid: x\n");
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe("syntax");
  });
  it("缺少必填字段 / 不认识的字段", () => {
    const r = v(lighthouse.replace("  summary: 七夜之内保住灯火，查明失踪船只的真相。\n", "").replace("  language: zh-CN", "  langauge: zh-CN"));
    expect(r.issues.some((i) => i.message.includes("summary"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("langauge") && i.message.includes("language"))).toBe(true);
  });
  it("工具指向的动作 AI 不能调用", () => {
    const r = v(lighthouse.replace("    steps: [ { inc: { oil: -1, day: 1 } } ]\n", "    steps: [ { inc: { oil: -1, day: 1 } } ]\n    callable_by: [player]\n"));
    expect(codes(r)).toContain("not_ai_callable");
  });
  it("没有骰子模板却用 roll()", () => {
    expect(codes(v(lighthouse.replace("uses: [oasis/dice@1]\n", "")))).toContain("dice_needs_template");
  });
  it("脚本文件缺失 / 存在", () => {
    const y = lighthouse.replace("    steps: [ { inc: { oil: -1, day: 1 } } ]\n", "    script: scripts/tend.js#run\n");
    expect(codes(v(y))).toContain("missing_file");
    expect(v(y, { "scripts/tend.js": "export function run(api){}" }).ok).toBe(true);
  });
  it("生成可贴给 AI 的修改请求", () => {
    const r = v(lighthouse.replace("region: side, title", "region: sidebar, title"));
    const t = aiFixRequest(r);
    expect(t).toContain("Oasis Story Format v0.3");
    expect(t).toMatch(/第 \d+ 行/);
    expect(t).toContain("sidebar");
  });
});

describe("表达式", () => {
  const ev = (s: string, vars: any = {}) => evaluate(parseExpr(s), { vars, funcs: builtinFuncs });
  it("运算与优先级", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("!(1 > 2) && 'a' in ['a', 'b']")).toBe(true);
    expect(ev("state.x >= 2 ? 'hi' : 'lo'", { state: { x: 3 } })).toBe("hi");
    expect(ev("len(state.l) + max(1, 5)", { state: { l: [1, 2] } })).toBe(7);
    expect(ev("{ ok: 1 == 1, n: -2 }")).toEqual({ ok: true, n: -2 });
  });
  it("语法错误会被发现", () => {
    expect(() => parseExpr("state.x = 1")).toThrow();
    expect(() => parseExpr("(1 + 2")).toThrow();
  });
});
