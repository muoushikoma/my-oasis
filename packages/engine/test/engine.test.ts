import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { validateFiles, filesFromText, type Story } from "@my-oasis/schema";
import { Game, runEntry, createQuickJsRunner, type LLM, type ScriptRunner } from "../src/index.js";

const root = new URL("../../../", import.meta.url).pathname;
const load = (y: string, extra: Record<string, string> = {}) => {
  const files = filesFromText(y, extra);
  const r = validateFiles(files);
  if (!r.ok) throw new Error(r.issues.filter((i) => i.level === "error").map((i) => `${i.line}: ${i.message}`).join("\n"));
  return { story: r.story as Story, files };
};
const lighthouseY = readFileSync(root + "examples/lighthouse-mini/story.yaml", "utf8");
const boxY = readFileSync(root + "examples/guess-the-box/story.yaml", "utf8");

describe("纯规则故事《三个箱子》", () => {
  it("同一个种子结果完全一样", () => {
    const { story } = load(boxY);
    const a = new Game(story, { seed: 42 }), b = new Game(story, { seed: 42 });
    a.start(); b.start();
    expect(a.state.answer).toBe(b.state.answer);
    expect(a.state.answer).toBeGreaterThanOrEqual(1);
    expect(a.state.answer).toBeLessThanOrEqual(3);
  });
  it("能玩到结局，结局后不能再操作", () => {
    const { story } = load(boxY);
    const g = new Game(story, { seed: 7 }); g.start();
    const ans = g.state.answer;
    const wrong = [1, 2, 3].find((n) => n !== ans)!;
    expect(g.doAction("open_box", { n: wrong }).ok).toBe(true);
    expect(g.state.chances).toBe(2);
    const r = g.doAction("open_box", { n: ans });
    expect(r.ending).toBe("win");
    expect(g.doAction("open_box", { n: 1 }).ok).toBe(false);
  });
  it("参数超范围被拒绝且不改状态", () => {
    const { story } = load(boxY);
    const g = new Game(story, { seed: 1 }); g.start();
    const r = g.doAction("open_box", { n: 9 });
    expect(r.ok).toBe(false);
    expect(g.state.chances).toBe(3);
  });
});

describe("《守灯人》规则", () => {
  it("前提条件、enum 校验、数值截断", () => {
    const { story } = load(lighthouseY);
    const g = new Game(story, { seed: 3 }); g.start();
    expect(g.doAction("search", {}, "ai").error).toBe("灯塔里已经没什么可找的");
    expect(g.doAction("move", { to: "月球" }).ok).toBe(false);
    expect(g.doAction("move", { to: "灯塔" }).error).toBe("你已经在这里了");
    expect(g.doAction("move", { to: "海滩" }).ok).toBe(true);
    expect(g.state.location).toBe("海滩");
  });
  it("callable_by：change_trust 只允许 AI；search 会掷骰", () => {
    const { story } = load(lighthouseY);
    const g = new Game(story, { seed: 3 }); g.start();
    g.doAction("move", { to: "海滩" });
    expect(g.doAction("change_trust", { amount: 1 }, "player").ok).toBe(false);
    expect(g.doAction("change_trust", { amount: 1 }, "ai").ok).toBe(true);
    expect(g.doAction("search", {}, "ai").ok).toBe(true);
    expect(g.log.some((l) => l.kind === "dice")).toBe(true);
  });
  it("第 4 天的暴风雨事件只触发一次，灯油耗尽进入结局", () => {
    const { story } = load(lighthouseY);
    const g = new Game(story, { seed: 3 }); g.start();
    g.doAction("tend_light"); g.doAction("tend_light"); // day 3, oil 1
    expect(g.state.day).toBe(3);
    const r = g.doAction("tend_light");                  // day 4 → 暴风雨 oil -1
    expect(g.fired.has("storm")).toBe(true);
    expect(g.state.oil).toBe(0);
    expect(r.ending).toBe("darkness");
    expect(g.takeNotices()[0]).toContain("暴风雨");
  });
});

describe("AI 任务卡与裁量权", () => {
  it("白名单外的工具被拒绝并记录", () => {
    const { story } = load(lighthouseY);
    const g = new Game(story, { seed: 1 }); g.start();
    const r = g.callTool("keeper", "move", { to: "海滩" });
    expect(r.violation).toBe(true);
    expect(g.violations).toHaveLength(1);
    expect(g.state.location).toBe("灯塔");
  });
  it("1 级：只能在 writes 范围内小幅调整", () => {
    const { story } = load(lighthouseY.replace("    params: { amount: { type: number, min: -1, max: 1 } }", "    params: { amount: { type: number, min: -3, max: 3 } }"));
    const g = new Game(story, { seed: 1 }); g.start();
    expect(g.callTool("keeper", "trust", { amount: 1 }).ok).toBe(true);
    expect(g.state.keeper_trust).toBe(1);
    const r = g.callTool("keeper", "trust", { amount: 2 });
    expect(r.violation).toBe(true);
    expect(g.state.keeper_trust).toBe(1);
  });
  it("2 级：不能导致结局，调用整体撤销", () => {
    const { story } = load(lighthouseY);
    const g = new Game(story, { seed: 1 }); g.start();
    g.doAction("tend_light"); g.doAction("tend_light"); // oil 1
    const r = g.callTool("narrator", "tend", {});
    expect(r.violation).toBe(true);
    expect(r.error).toContain("结局");
    expect(g.ending).toBeNull();
    expect(g.state.oil).toBe(1);
    expect(g.state.day).toBe(3);
  });
  it("3 级：可以导致结局", () => {
    const { story } = load(lighthouseY.replace("max_authority: 2", "max_authority: 3").replace("authority: 2\n", "authority: 3\n"));
    const g = new Game(story, { seed: 1 }); g.start();
    g.doAction("tend_light"); g.doAction("tend_light");
    expect(g.callTool("narrator", "tend", {}).ok).toBe(true);
    expect(g.ending).toBe("darkness");
  });
  it("0 级：只能查询", () => {
    const y = lighthouseY.replace("authority: 1\n", "authority: 0\n").replace("tools: { trust: { writes: { keeper_trust: { delta: [-1, 1] } } } }", "tools: { trust: {}, look: {} }")
      .replace("  trust:  { action: change_trust", "  look:   { query: \"state.location\", desc: 看看在哪 }\n  trust:  { action: change_trust");
    const { story } = load(y);
    const g = new Game(story, { seed: 1 }); g.start();
    expect(g.callTool("keeper", "look", {}).result).toBe("灯塔");
    expect(g.callTool("keeper", "trust", { amount: 1 }).violation).toBe(true);
  });
  it("runEntry：工具循环、越权反馈给 AI、输出文字", async () => {
    const { story, files } = load(lighthouseY);
    const g = new Game(story, { seed: 5, files }); g.start();
    const seen: any[] = [];
    let step = 0;
    const fake: LLM = {
      async chat(req) {
        seen.push(req);
        step++;
        if (step === 1) return { content: null, tool_calls: [{ id: "a", function: { name: "move", arguments: '{"to":"海滩"}' } }, { id: "b", function: { name: "trust", arguments: '{"amount":1}' } }] };
        if (step === 2) return { content: null, tool_calls: [{ id: "c", function: { name: "search", arguments: "{}" } }] };
        return { content: "你来到海滩，潮水退去。" };
      },
    };
    const r = await runEntry(g, "narrator", fake, "去海滩找找");
    expect(g.state.location).toBe("海滩");
    expect(r.text).toBe("你来到海滩，潮水退去。");
    expect(r.toolLog.map((t) => t.tool)).toEqual(["move", "trust", "search"]);
    expect(r.toolLog[1].result.violation).toBe(true);
    expect(seen[0].tools.map((t: any) => t.function.name).sort()).toEqual(["move", "search", "tend"]);
    expect(seen[0].messages[0].content).toContain("我的绿洲");
    expect(seen[0].messages[1].content).toContain("去海滩找找");
    expect(g.extra.history.narrator).toHaveLength(2);
  });
  it("json 输出交回规则执行（then）", async () => {
    const y = lighthouseY.replace("    keeper:\n", `    judge_bold:
      kind: judge
      trigger: game_start
      prompt: 判断
      card:
        task: 判断玩家是否勇敢
        authority: 0
        output:
          format: json
          schema: { brave: bool }
          then: [ { if: "out.brave", then: [ { inc: { keeper_trust: 1 } } ] } ]
    keeper:
`);
    const { story } = load(y);
    const g = new Game(story, { seed: 1 }); g.start();
    const r = await runEntry(g, "judge_bold", { chat: async () => ({ content: '好的 {"brave": true}' }) });
    expect(r.json).toEqual({ brave: true });
    expect(g.state.keeper_trust).toBe(1);
  });
});

describe("存档", () => {
  it("存档 → 读档后随机序列与状态完全一致", () => {
    const { story } = load(lighthouseY);
    const g = new Game(story, { seed: 99 }); g.start();
    g.doAction("move", { to: "海滩" }); g.doAction("search", {}, "ai");
    const save = JSON.parse(JSON.stringify(g.save()));
    const { game: h, warnings } = Game.load(story, save);
    expect(warnings).toEqual([]);
    g.doAction("move", { to: "村庄" }); h.doAction("move", { to: "村庄" });
    g.doAction("search", {}, "ai"); h.doAction("search", {}, "ai");
    expect(h.state).toEqual(g.state);
    expect(h.rng.s).toBe(g.rng.s);
  });
  it("别的故事的存档会被拒绝；故事改动会提示", () => {
    const { story } = load(lighthouseY);
    const { story: box } = load(boxY);
    const s = new Game(story, { seed: 1 }).save();
    expect(() => Game.load(box, s)).toThrow(/属于故事/);
    const changed = { ...story, meta: { ...story.meta, version: "0.3.1" } };
    expect(Game.load(changed, s).warnings[0]).toContain("不一样");
  });
});

describe("JS 脚本沙箱（QuickJS）", () => {
  let runner: ScriptRunner;
  beforeAll(async () => { runner = await createQuickJsRunner(); });
  const withScript = (src: string, limits = "") => {
    const y = boxY.replace("    params: { n: { type: number, min: 1, max: 3 } }\n    steps:\n      - inc: { chances: -1 }\n      - if: \"params.n == state.answer\"\n        then: [ { set: { found: true } }, { log: \"'钥匙！'\" } ]\n        else: [ { log: \"'空的。'\" } ]",
      "    params: { n: { type: number, min: 1, max: 3 } }\n    script: scripts/open.js#run") + limits;
    const { story, files } = load(y, { "scripts/open.js": src });
    const g = new Game(story, { seed: 4, files, scripts: runner }); g.start();
    return g;
  };
  it("脚本通过 API 改状态、用可复现随机数、返回结果", () => {
    const g = withScript(`export function run(api) {
      api.state.inc("chances", -1);
      if (api.params.n === api.state.get("answer")) api.state.set("found", true);
      return { lucky: api.random.int(1, 6) };
    }`);
    const r = g.doAction("open_box", { n: g.state.answer });
    expect(r.ok).toBe(true);
    expect(r.result.lucky).toBeGreaterThanOrEqual(1);
    expect(g.ending).toBe("win");
  });
  it("api.fail 撤销全部改动", () => {
    const g = withScript(`export function run(api) { api.state.inc("chances", -1); api.fail("箱子锁住了"); }`);
    const r = g.doAction("open_box", { n: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("箱子锁住了");
    expect(g.state.chances).toBe(3);
  });
  it("死循环会超时中止并撤销", () => {
    const g = withScript(`export function run(api) { api.state.inc("chances", -1); while (true) {} }`, "scripts: { limits: { time_ms: 30 } }\n");
    const r = g.doAction("open_box", { n: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("中止");
    expect(g.state.chances).toBe(3);
  });
  it("不能用 Math.random、没有网络和文件", () => {
    for (const body of ["return Math.random()", "return fetch('http://x')", "return require('fs')"]) {
      const g = withScript(`export function run(api) { ${body} }`);
      expect(g.doAction("open_box", { n: 1 }).ok).toBe(false);
    }
  });
  it("吃内存过多会被中止", () => {
    const g = withScript(`export function run(api) { const a = []; for (;;) a.push(new Array(100000).fill(1)); }`, "scripts: { limits: { time_ms: 200, memory_mb: 8 } }\n");
    const r = g.doAction("open_box", { n: 1 });
    expect(r.ok).toBe(false);
  });
});
