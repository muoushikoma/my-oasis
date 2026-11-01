import { describe, it, expect } from "vitest";
import { withAi } from "../../schema/test/with-ai.js";
import { readFileSync } from "node:fs";
import { validateFiles, filesFromText, libraryProblems, libraryWarnings, localizeStory, pickText, type Story } from "@my-oasis/schema";
import { Game, buildMessages, createQuickJsRunner } from "../src/index.js";

const root = new URL("../../../", import.meta.url).pathname;
const guide = readFileSync(root + "docs/ai-authoring-guide.md", "utf8");
const boxY = guide.match(/```yaml\n(spec: oasis\/0\.3\nmeta:\n  id: guess-the-box[\s\S]*?)```/)![1];
const load = (y: string, extra: Record<string, string> = {}) => {
  const files = filesFromText(withAi(y), extra); const r = validateFiles(files);
  if (!r.ok) throw new Error(r.issues.filter((i) => i.level === "error").map((i) => i.message).join("\n"));
  return { story: r.story as Story, files };
};

describe("中英双语", () => {
  it("双语示例通过校验和故事库要求", () => {
    const { story } = load(boxY);
    expect(libraryProblems(story)).toEqual([]);
    expect(libraryWarnings(story)).toEqual([]);
  });
  it("按语言展开，缺的语言用另一种", () => {
    expect(pickText({ zh: "灯" }, "en")).toBe("灯");
    expect(pickText("plain", "en")).toBe("plain");
    const { story } = load(boxY);
    const en = localizeStory(story, "en");
    expect(en.meta.title).toBe("Three Boxes");
    expect((en.ui as any).components.boxes.choices[0].label).toBe("Box 1");
    expect(localizeStory(story, "zh").start!.intro).toMatch(/三个箱子/);
  });
  it("引擎用玩家语言，存档与语言无关", () => {
    const { story } = load(boxY);
    const g = new Game(story, { seed: 1, lang: "en" }); g.start();
    expect(g.story.endings.list[0].label).toBe("Found it");
    const save = g.save();
    const r = Game.load(story, save, { lang: "zh" });
    expect(r.warnings).toEqual([]);
    expect(r.game.story.endings.list[0].label).toBe("找到了");
  });
  it("故事库：分级必须全年龄、标签正好 3 个且双语", () => {
    const { story } = load(boxY);
    const bad = structuredClone(story) as any; bad.meta.rating = "teen"; bad.meta.tags = bad.meta.tags.slice(0, 2); bad.meta.title = "只有中文";
    const p = libraryProblems(bad);
    expect(p.join("\n")).toMatch(/全年龄/); expect(p.join("\n")).toMatch(/正好 3 个/); expect(p.join("\n")).toMatch(/meta.title/);
  });
  it("老故事（普通字符串）照样能玩", () => {
    const { story } = load(readFileSync(root + "tests/fixtures/guess-the-box/story.yaml", "utf8"));
    const g = new Game(story, { seed: 1, lang: "en" }); g.start();
    expect(typeof g.story.meta.title).toBe("string");
  });
  it("脚本读 api.lang；AI 提示带上语言", async () => {
    const runner = await createQuickJsRunner();
    const y = boxY.replace("    steps:\n      - inc: { chances: -1 }", "    script: scripts/open.js#run").replace(/      - if: "params\.n == state\.answer"\n.*\n.*\n/, "");
    const { story, files } = load(y, { "scripts/open.js": "function run(api) { return api.lang; }" });
    const g = new Game(story, { seed: 1, lang: "en", files, scripts: runner }); g.start();
    expect(g.doAction("open_box", { n: 1 }, "player").result).toBe("en");
    const ai = load(readFileSync(root + "examples/lighthouse-mini/story.yaml", "utf8")).story;
    const ga = new Game(ai, { lang: "en" }); ga.start();
    const ep = Object.keys(ai.ai!.entry_points!)[0];
    expect(buildMessages(ga, ep, "hi")[0].content).toMatch(/English/);
  });
});
