import { describe, it, expect } from "vitest";
import { withAi } from "./with-ai.js";
import { readFileSync } from "node:fs";
import { validateFiles, filesFromText, filesToZip, filesFromZip, aiFixRequest, formatIssues, parseExpr, evaluate, builtinFuncs } from "../src/index.js";
import { loadFromPath } from "../src/node.js";
import { zipSync, strToU8 } from "fflate";

const root = new URL("../../../", import.meta.url).pathname;
const lighthouse = readFileSync(root + "examples/lighthouse-mini/story.yaml", "utf8");
const v = (y: string, extra: Record<string, string> = {}) => validateFiles(filesFromText(withAi(y), extra));
const codes = (r: ReturnType<typeof v>) => r.issues.filter((i) => i.level === "error").map((i) => i.code);

describe("示例故事", () => {
  it("两个规范示例都能通过校验", () => {
    for (const p of ["examples/lighthouse-mini", "tests/fixtures/guess-the-box", "tests/fixtures/custom-ui-mini"]) {
      const r = validateFiles(loadFromPath(root + p));
      expect(r.issues.filter((i) => i.level === "error"), formatIssues(r)).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });
  it("包内 schema 与 docs/schema 一致", () => {
    expect(readFileSync(root + "packages/schema/src/story.schema.json", "utf8")).toBe(readFileSync(root + "docs/schema/story.schema.json", "utf8"));
  });
  it(".oasis（zip）可以读取，且允许多套一层文件夹", () => {
    const files = loadFromPath(root + "examples/lighthouse-mini");
    const nested = new Map([...files].map(([k, d]) => [`my-story/${k}`, d] as [string, Uint8Array]));
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
  it("不引用骰子模板也能用 roll()，随机函数可写在任何表达式里", () => {
    expect(v(lighthouse.replace("uses: [oasis/dice@1]\n", "")).ok).toBe(true);
    const y = "spec: oasis/0.3\nmeta: {id: rnd-story, title: t, version: 1.0.0, summary: s, language: zh-CN, rating: teen}\nstate: {x: {type: number, init: 0}}\nactions: {a: {require: \"randint(1, 6) > 0\", steps: [{set: {x: \"roll('1d6')\"}}]}}\nendings: {list: [{id: e, label: 完, when: \"rand() > 2\"}]}\n";
    expect(codes(v(y))).toEqual([]);
  });
  it("没有 state、没有结局也能通过", () => {
    const r = v("spec: oasis/0.3\nmeta: {id: bare-story, title: t, version: 1.0.0, summary: s, language: en, rating: all-ages}\n");
    expect(r.ok).toBe(true);
    expect(r.story!.state).toEqual({});
    expect(r.story!.endings.list).toEqual([]);
  });
  it("脚本文件缺失 / 存在", () => {
    const y = lighthouse.replace("    steps: [ { inc: { oil: -1, day: 1 } } ]\n", "    script: scripts/tend.js#run\n");
    expect(codes(v(y))).toContain("missing_file");
    expect(v(y, { "scripts/tend.js": "export function run(api){}" }).ok).toBe(true);
  });
  it("生成可贴给 AI 的修改请求", () => {
    const r = v(lighthouse.replace("      region: side\n      title: 老守灯人", "      region: sidebar\n      title: 老守灯人"));
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

describe("素材", () => {
  const base = `
spec: oasis/0.3
meta: { id: art-test, title: 素材测试, version: 0.1.0, summary: 测试, language: zh-CN, rating: all-ages }
state:
  place: { type: enum, values: [hall, yard], init: hall }
endings:
  list:
    - { id: done, label: 到了, kind: good, when: "state.place == 'yard'" }
actions:
  go: { params: { to: { type: enum, values: [hall, yard] } }, steps: [ { set: { place: "params.to" } } ] }
assets:
  hall_bg: { type: image, path: art/hall.webp, use: background }
  yard_bg: { type: image, path: art/yard.webp, use: background }
  bgm: { type: audio, path: audio/bgm.ogg, use: music }
ui:
  layout: { template: simple }
  theme: { background: { bind: place, images: { hall: asset:hall_bg, yard: asset:yard_bg } } }
  sound: { music: { src: asset:bgm, volume: 0.5 }, effects: { "action:go": asset:bgm } }
  components:
    log: { type: text-log, region: main }
    pic: { type: image, region: status, bind: place, images: { hall: asset:hall_bg, yard: asset:yard_bg } }
    b: { type: button, region: input, label: 去院子, action: go, params: { to: yard } }
`;
  const bin = { "art/hall.webp": "x", "art/yard.webp": "x", "audio/bgm.ogg": "x" };
  it("登记的素材、状态切换背景和音乐能通过", () => {
    const r = v(base, bin);
    expect(r.issues.filter((i) => i.level === "error"), formatIssues(r)).toEqual([]);
  });
  it("缺文件、类型不符、未登记引用都会报错", () => {
    expect(codes(v(base, { "art/hall.webp": "x", "audio/bgm.ogg": "x" }))).toContain("missing_file");
    expect(codes(v(base.replace("music: { src: asset:bgm", "music: { src: asset:hall_bg"), bin))).toContain("asset_type");
    expect(codes(v(base.replace("pic: { type: image, region: status, bind: place, images: { hall: asset:hall_bg, yard: asset:yard_bg", "pic: { type: image, region: status, bind: place, images: { hall: asset:hall_bg, yard: asset:yard_pic"), bin))).toContain("unknown_asset");
    expect(codes(v(base.replace("path: audio/bgm.ogg", "path: art/hall.webp"), bin))).toContain("asset_format");
  });
  it("图片超过 10 MB 报错，10 MB 以内可以", () => {
    const files = filesFromText(withAi(base), bin);
    files.set("art/hall.webp", new Uint8Array(5 * 1024 * 1024));
    expect(validateFiles(files).issues.map((i) => i.code)).not.toContain("image_too_big");
    files.set("art/hall.webp", new Uint8Array(10 * 1024 * 1024 + 1));
    expect(validateFiles(files).issues.map((i) => i.code)).toContain("image_too_big");
  });
  it("文件数上限 2000", () => {
    const files = filesFromText(withAi(base), bin);
    for (let i = 0; i < 2001; i++) files.set(`notes/n${i}.txt`, new Uint8Array(1));
    expect(validateFiles(files).issues.map((i) => i.code)).toContain("too_many_files");
  });
  it("解压前拦住 zip 炸弹（解压后超过上限）", () => {
    const big = new Uint8Array(301 * 1024 * 1024);
    const z = zipSync({ "story.yaml": strToU8("x"), "a.txt": big }, { level: 9 });
    expect(z.length).toBeLessThan(2 * 1024 * 1024);
    expect(() => filesFromZip(z)).toThrow(/100 MB|300 MB/);
  });
});

describe("最高原则：固定 / AI 处理、玩家边界", () => {
  it("AI 输出到没标 content: ai 的组件或区域会报错", () => {
    expect(codes(v(lighthouse.replace("type: text-log, region: main, content: ai", "type: text-log, region: main")))).toContain("ai_into_fixed");
    expect(codes(v(lighthouse.replace("      content: ai\n      input: { actions: []", "      input: { actions: []")))).toContain("ai_into_fixed");
  });
  it("自由输入不写 input 只提醒（默认不允许任何动作），写了就检查动作存在", () => {
    const y = lighthouse.replace(/      input:\n        actions: \[move[\s\S]*?max_length: 300\n/, "");
    expect(codes(v(y))).not.toContain("free_input_unbounded");
    expect(v(y).issues.some((i) => i.code === "free_input_unbounded" && i.level === "warning")).toBe(true);
    expect(codes(v(lighthouse.replace("actions: [move, search, tend_light]", "actions: [move, fly]")))).toContain("unknown_action");
  });
});

describe("AI 选项按钮", () => {
  it("from_ai 的选项按钮没有来源时提醒", () => {
    const y = lighthouse.replace("  components:\n", "  components:\n    opts: { type: choice-buttons, region: input, from_ai: true }\n");
    expect(v(y).issues.map((i) => i.code)).toContain("choices_no_source");
  });
});

describe("支持平台 meta.platforms", () => {
  const y = (p: string) => `
spec: oasis/0.3
meta: { id: plat-test, title: 平台, version: 0.1.0, summary: 测试, language: zh-CN, rating: all-ages${p} }
state:
  n: { type: number, init: 0 }
endings:
  list:
    - { id: done, label: 完, kind: good, when: "state.n > 0" }
actions:
  add: { steps: [ { set: { n: "state.n + 1" } } ] }
ui:
  layout: { template: simple }
`;
  it("可以不写、写一个或两个", () => {
    expect(v(y("")).ok).toBe(true);
    expect(v(y(", platforms: [mobile]")).ok).toBe(true);
    expect(v(y(", platforms: [desktop, mobile]")).ok).toBe(true);
  });
  it("拒绝未知平台和空列表", () => {
    expect(v(y(", platforms: [console]")).ok).toBe(false);
    expect(v(y(", platforms: []")).ok).toBe(false);
  });
});

describe("必须接 AI", () => {
  const noAi = `
spec: oasis/0.3
meta: { id: no-ai-test, title: 无AI, version: 0.1.0, summary: 测试, language: zh-CN, rating: all-ages }
actions:
  go: { steps: [] }
ui:
  layout: { template: simple }
`;
  const raw = (y: string) => validateFiles(filesFromText(y));
  it("没写 ai 报错", () => { const r = raw(noAi); expect(r.ok).toBe(false); expect(codes(r)).toContain("ai_required"); });
  it("ai 里没有接入点也报错", () => { expect(codes(raw(noAi + "ai: { system: 设定 }\n"))).toContain("ai_required"); });
  it("有接入点就通过", () => { expect(raw(withAi(noAi)).ok).toBe(true); });
});

describe("自定义组件 type: custom（§13.3）", () => {
  const base = `
spec: oasis/0.3
meta: { id: cu-test, title: 自定义, version: 0.1.0, summary: 测试, language: zh-CN, rating: all-ages }
state: { x: { type: number, init: 0 } }
endings:
  list:
    - { id: done, label: 完, kind: good, when: "state.x > 3" }
actions:
  bump: { steps: [ { inc: { x: 1 } } ] }
  secret: { steps: [], callable_by: [ai] }
ui:
  components:
    log: { type: text-log, region: main, content: ai }
    m: { type: custom, region: main, src: ui/m.html, actions: [bump], emits: [opened], fallback: 关闭了 }
`;
  const html = `<link rel="stylesheet" href="m.css"><script src="m.js"></script>`;
  it("文件齐全时通过", () => {
    expect(codes(v(base, { "ui/m.html": html, "ui/m.css": "b{}", "ui/m.js": "1" }))).toEqual([]);
  });
  it("缺 html / 缺引用文件 / 不是 html", () => {
    expect(codes(v(base))).toContain("missing_file");
    expect(codes(v(base, { "ui/m.html": html, "ui/m.css": "" }))).toContain("missing_file");
    expect(codes(v(base.replace("ui/m.html", "ui/m.js"), { "ui/m.js": "1" }))).toContain("custom_src_type");
    expect(codes(v(base.replace("src: ui/m.html, ", "")))).toContain("custom_no_src");
  });
  it("动作必须存在且玩家可调用；ui 触发器必须在 emits 里", () => {
    const f = { "ui/m.html": "<p>hi</p>" };
    expect(codes(v(base.replace("actions: [bump]", "actions: [nope]"), f)).length).toBeGreaterThan(0);
    expect(codes(v(base.replace("actions: [bump]", "actions: [secret]"), f)).length).toBeGreaterThan(0);
    const ok = base + `ai:
  entry_points:
    e:
      kind: narrate
      trigger: "ui:m.opened"
      prompt: hi
      fallback: 好。
      card: { task: 回应, authority: 0, output: { format: text, max_chars: 120 } }
`;
    const bad = base + `ai:
  entry_points:
    e:
      kind: narrate
      trigger: "ui:m.closed"
      prompt: hi
      fallback: 好。
      card: { task: 回应, authority: 0, output: { format: text, max_chars: 120 } }
`;
    expect(codes(v(ok, f))).not.toContain("component_event");
    expect(codes(v(bad, f))).toContain("component_event");
  });
  it("引用外网资源给警告", () => {
    const r = v(base, { "ui/m.html": `<script src="https://x.example/a.js"></script>` });
    expect(r.issues.map((i) => i.code)).toContain("custom_network");
  });
});
