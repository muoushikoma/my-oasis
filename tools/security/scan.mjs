// 用法：
//   node tools/security/scan.mjs diff <base-ref>        扫描 PR 改动，结果写到 $OUT_DIR/scan.json
//   node tools/security/scan.mjs check <name> <level> <zh> <en>   记录一个外部检查结果
//   node tools/security/scan.mjs report                 汇总，写 job summary 和 comment.md；有红灯时退出码 1
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { scan, report } from "./rules.mjs";

const OUT = process.env.OUT_DIR || path.join(process.env.RUNNER_TEMP || "/tmp", "security-review");
fs.mkdirSync(OUT, { recursive: true });
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 30 });
const [cmd, ...args] = process.argv.slice(2);

if (cmd === "diff") {
  const base = args[0] || "origin/main";
  const range = `${base}...HEAD`;
  const diff = git("diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", range);
  const status = {}, sizes = {};
  for (const l of git("diff", "--name-status", "--no-renames", range).split("\n").filter(Boolean)) {
    const [s, f] = l.split("\t"); status[f] = s[0];
    if (s[0] !== "D" && fs.existsSync(f)) sizes[f] = fs.statSync(f).size;
  }
  const findings = scan({ diff, sizes, status });
  fs.writeFileSync(path.join(OUT, "scan.json"), JSON.stringify(findings, null, 1));
  console.log(`扫描完成：${findings.length} 条发现`);
  for (const f of findings) console.log(`${f.level}\t${f.id}\t${f.file}`);
} else if (cmd === "check") {
  const [name, level, zh, en] = args;
  fs.appendFileSync(path.join(OUT, "checks.jsonl"), JSON.stringify({ name, level, zh, en }) + "\n");
} else if (cmd === "report") {
  const rd = (f) => (fs.existsSync(path.join(OUT, f)) ? fs.readFileSync(path.join(OUT, f), "utf8") : "");
  const findings = JSON.parse(rd("scan.json") || "[]");
  const checks = rd("checks.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const { level, markdown } = report(findings, checks);
  fs.writeFileSync(path.join(OUT, "comment.md"), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  console.log(markdown);
  if (level === "red") { console.log("::error::自动安全审核：红灯 / Security review: red"); process.exit(1); }
} else { console.error("用法见文件开头"); process.exit(2); }
