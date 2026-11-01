import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { loadFromPath } from "../../../packages/schema/src/node.js";
import { validateFiles } from "../../../packages/schema/src/validate.js";
import { checkFsm } from "../game-runtime/fsm.js";
import { readFileSync } from "node:fs";

const dir = fileURLToPath(new URL("../../../examples/ember-corridor", import.meta.url));

describe("演示故事包：余烬回廊", () => {
  it("通过校验，没有错误和警告", () => {
    const res = validateFiles(loadFromPath(dir));
    expect(res.issues.filter((i) => i.level !== "info")).toEqual([]);
    expect(res.ok).toBe(true);
  });
  it("动画状态机和图集一致", () => {
    const sheets = JSON.parse(readFileSync(dir + "/game/data/sheets.json", "utf8"));
    for (const [fsm, sheet] of [["hero", "hero"], ["slime", "slime"]]) {
      const def = JSON.parse(readFileSync(`${dir}/game/data/${fsm}.fsm.json`, "utf8"));
      expect(checkFsm(def, sheets[sheet].animations)).toEqual([]);
    }
  });
});
