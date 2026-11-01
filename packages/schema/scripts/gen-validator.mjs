// 在构建前把 Ajv 校验器预编译成普通 JS，避免客户端运行时用 new Function（被 CSP 拦截）。
// 用法：node packages/schema/scripts/gen-validator.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const standalone = require("ajv/dist/standalone").default;
const dir = fileURLToPath(new URL("../src/", import.meta.url));
const schema = JSON.parse(readFileSync(dir + "story.schema.json", "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true, code: { source: true, esm: true } });
let src = standalone(ajv, ajv.compile(schema));
// Ajv 的 esm 输出里仍有 require()，换成 import，浏览器才能用
const imports = [];
src = src.replace(/require\("(ajv\/dist\/runtime\/[a-z0-9]+)"\)\.default/g, (_, m) => { const n = "__rt_" + m.split("/").pop(); if (!imports.some((x) => x.n === n)) imports.push({ n, m }); return n; });
if (/require\(/.test(src)) throw new Error("standalone 输出仍含 require()");
src = imports.map(({ n, m }) => `import ${n}Mod from "${m}.js";\nconst ${n} = ${n}Mod.default ?? ${n}Mod;`).join("\n") + "\n" + src;
const code = "// @ts-nocheck\n// 自动生成，勿手改：node packages/schema/scripts/gen-validator.mjs\n" + src + "\n";
const out = dir + "story.validate.generated.js";
if (process.argv.includes("--check")) {
  let cur = ""; try { cur = readFileSync(out, "utf8"); } catch {}
  if (cur !== code) { console.error("story.validate.generated.js 过期，请重新运行 gen-validator.mjs"); process.exit(1); }
  console.log("validator up to date");
} else { writeFileSync(out, code); console.log("wrote", out); }
