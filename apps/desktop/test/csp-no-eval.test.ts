// 客户端 CSP 不允许 'unsafe-eval'：构建产物里不能出现 new Function / eval，校验器必须是预编译的。
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../..");
const dist = join(root, "apps/desktop/dist");

describe("CSP: no runtime eval", () => {
  it("预编译的 Ajv 校验器与 schema 同步", () => {
    execFileSync("node", [join(root, "packages/schema/scripts/gen-validator.mjs"), "--check"], { stdio: "pipe" });
  });

  it("schema 源码不在运行时编译 Ajv", () => {
    const src = readFileSync(join(root, "packages/schema/src/validate.ts"), "utf8");
    expect(src).not.toMatch(/\.compile\(|ajv\/dist\/2020/);
  });

  it.skipIf(!existsSync(dist))("构建产物不含 new Function / eval(", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : /\.(m?js|html)$/.test(e.name) && files.push(p); } };
    walk(dist);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/new\s+Function\s*\(|(?<![.\w$}])eval\s*\(|\bFunction\s*\(\s*["'`]/);
    }
  });
});
