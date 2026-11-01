// 自动安全审核的规则（纯函数，便于测试）。red = 拦下；yellow = 需要家驹看一眼；green = 没发现问题。
// 只看 PR 新增的行（少误报）；暂停/退出相关改动连删除的行一起看。
export const MB = 1024 * 1024;
export const FILE_LIMIT = 100 * MB; // GitHub 单文件硬上限

const CLIENT = /^(apps\/desktop\/src\/|packages\/[^/]+\/src\/)/;
const isCode = (f) => /\.(m?[jt]sx?|cjs|html)$/.test(f);
const isGenerated = (f) => /\.generated\.[jt]s$/.test(f);
const isTest = (f) => /(^|\/)(test|tests|__tests__)\/|\.test\.[jt]s$|\.spec\.[jt]s$/.test(f);
const isStoryScript = (f) => /^stories\/[^/]+\/.*\.(m?js|ts)$/.test(f);
/** 去掉行尾注释和字符串之外的干扰：简单地去掉 // 注释（够用，少误报） */
const stripComment = (l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, "").replace(/\s\/\/\s.*$/, "");

const R = (level, id, zh, en) => ({ level, id, zh, en });

/** 客户端代码新增行的规则 */
export const CLIENT_LINE_RULES = [
  { re: /(?<![.\w$])eval\s*\(/, ...R("red", "eval", "客户端代码里新增了 eval（会执行任意字符串代码，也违反 CSP）", "eval() added to client code (runs arbitrary strings, violates CSP)") },
  { re: /\bnew\s+Function\s*\(|(?<![.\w$])Function\s*\(\s*["'`]/, ...R("red", "new-function", "客户端代码里新增了 new Function（等同 eval）", "new Function() added to client code (same as eval)") },
  { re: /\.(innerHTML|outerHTML)\s*\+?=(?!=)|\.insertAdjacentHTML\s*\(|document\.write(ln)?\s*\(/, ...R("yellow", "html-injection", "新增了 innerHTML 等直接写 HTML 的代码，可能被故事内容注入", "innerHTML-style raw HTML write added (possible injection)") },
  { re: /(?<![.\w$])fetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\s*\(|\bnew\s+EventSource\s*\(|navigator\.sendBeacon\s*\(/, ...R("yellow", "network", "客户端新增了联网代码（fetch / XHR / WebSocket 等），要确认不会把数据发到别处", "network API added to client (fetch/XHR/WebSocket…); check where data goes") },
  { re: /api[_-]?key|apiKey|secret|keyring|keychain/i, ...R("yellow", "api-key", "改动涉及 AI Key / 密钥处理", "change touches API key / secret handling") },
];

/** 故事脚本（stories/**.js|ts）新增行的禁用写法 */
export const STORY_LINE_RULES = [
  { re: /(?<![.\w$])eval\s*\(|\bnew\s+Function\s*\(|(?<![.\w$])Function\s*\(\s*["'`]/, ...R("red", "story-eval", "故事脚本里用了 eval / new Function", "story script uses eval / new Function") },
  { re: /(?<![.\w$])fetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|sendBeacon/, ...R("red", "story-network", "故事脚本想自己联网（故事不允许联网）", "story script tries to use the network (not allowed)") },
  { re: /(?<![.\w$])(require\s*\(|import\s*\()|^\s*import\s.+from\s/, ...R("red", "story-import", "故事脚本想加载外部模块", "story script tries to import modules") },
  { re: /(?<![.\w$])(process|window|document|globalThis|localStorage|indexedDB|__TAURI__|__TAURI_INTERNALS__)\b(?!\s*:)/, ...R("red", "story-host", "故事脚本想访问客户端或系统对象（window / document / process / Tauri 等）", "story script reaches for host objects (window/document/process/Tauri…)") },
  { re: /constructor\s*\.\s*constructor|\bconstructor\s*\[\s*["'`]constructor|__proto__|Object\.setPrototypeOf|\b(Object|Array|String|Function|Number)\.prototype\.\w+\s*=/, ...R("red", "story-proto", "故事脚本在改内置原型或想逃出沙盒", "story script modifies built-in prototypes / tries a sandbox escape") },
  { re: /while\s*\(\s*(true|1)\s*\)\s*\{?\s*\}?\s*$|for\s*\(\s*;\s*;\s*\)\s*\{?\s*\}?\s*$/, ...R("yellow", "story-loop", "故事脚本里有死循环写法（引擎会超时打断，但最好确认）", "possible infinite loop in story script") },
];

const EXIT_RE = /[pP]ause[_-]?[mM]enu|openPause|showPause|\bEscape\b|onBackPressed|OnBackPressed|exitStory|holdEsc/;

/** 按文件路径的规则 */
export function fileRules(file, status) {
  const out = [];
  const f = file;
  if (/^\.github\/workflows\//.test(f) || /^\.github\/actions\//.test(f)) out.push(R("yellow", "workflow", "改了自动流程（GitHub Actions），可能影响构建和发布", "GitHub Actions workflow changed"));
  if (/^apps\/desktop\/src-tauri\/capabilities\//.test(f)) out.push(R("yellow", "capabilities", "改了客户端系统权限（Tauri capabilities）", "Tauri capabilities changed"));
  if (/^apps\/desktop\/src\/takeover\.ts$|^apps\/desktop\/android\/MainActivity\.kt$/.test(f)) out.push(R("yellow", "exit", "改了退出 / 暂停菜单相关代码（玩家必须随时能退出）", "exit / pause-menu code changed (players must always be able to leave)"));
  if (/^crates\/oasis-native\/src\/(secrets|llm)\.rs$|^apps\/desktop\/src\/(providers|settings)\.ts$/.test(f)) out.push(R("yellow", "api-key-file", "改了 AI Key / 模型请求相关文件", "API key / model request code changed"));
  if (/(^|\/)(package\.json|Cargo\.toml|pnpm-lock\.yaml|Cargo\.lock)$/.test(f) && status !== "D") out.push(R("yellow", "deps", "改了依赖（新依赖要确认来源可靠）", "dependencies changed"));
  if (/(^|\/)\.(npmrc|yarnrc)|(^|\/)build\.rs$/.test(f)) out.push(R("yellow", "build-hook", "改了构建脚本或包管理配置", "build script / package manager config changed"));
  return out;
}

/** 解析 `git diff -U0` 输出 → [{file, added:[{n,text}], removed:[{text}]}] */
export function parseDiff(diff) {
  const files = []; let cur = null, n = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) { cur = { file: line.replace(/^diff --git a\/.* b\//, ""), added: [], removed: [] }; files.push(cur); continue; }
    if (!cur) continue;
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line); if (m) { n = +m[1]; continue; }
    if (line.startsWith("+")) cur.added.push({ n: n++, text: line.slice(1) });
    else if (line.startsWith("-")) cur.removed.push({ text: line.slice(1) });
  }
  return files;
}

/** 扫描一份 diff。sizes: {file: bytes}，status: {file: "A"|"M"|"D"} */
export function scan({ diff, sizes = {}, status = {} }) {
  const findings = [];
  const add = (r, file, line) => findings.push({ ...r, file, line });
  for (const { file, added, removed } of parseDiff(diff)) {
    for (const r of fileRules(file, status[file])) add(r, file);
    const client = CLIENT.test(file) && isCode(file) && !isTest(file) && !isGenerated(file);
    if (client) for (const { n, text } of added) {
      const t = stripComment(text); if (!t.trim()) continue;
      for (const r of CLIENT_LINE_RULES) if (r.re.test(t)) add(r, file, n);
    }
    if (client && !/takeover\.ts$/.test(file) && [...added, ...removed].some((l) => EXIT_RE.test(stripComment(l.text))))
      add(R("yellow", "exit", "改动碰到了暂停 / 退出相关代码（玩家必须随时能退出）", "change touches pause / exit code (players must always be able to leave)"), file);
    if (file === "apps/desktop/src-tauri/tauri.conf.json") {
      const csp = added.filter((l) => /"csp"|default-src|script-src|connect-src/.test(l.text));
      if (csp.some((l) => /unsafe-eval(?!')|'unsafe-eval'/.test(l.text.replace(/wasm-unsafe-eval/g, "")))) add(R("red", "csp-unsafe-eval", "CSP 里加了 unsafe-eval（允许执行任意字符串代码）", "CSP now allows unsafe-eval"), file);
      else if (csp.length || removed.some((l) => /"csp"/.test(l.text))) add(R("yellow", "csp", "改了内容安全策略（CSP）", "Content Security Policy changed"), file);
    }
    if (isStoryScript(file)) for (const { n, text } of added) {
      const t = stripComment(text); if (!t.trim()) continue;
      for (const r of STORY_LINE_RULES) if (r.re.test(t)) add(r, file, n);
    }
    if (/(^|\/)package\.json$/.test(file) && added.some((l) => /"(pre|post)?install"\s*:|"prepare"\s*:/.test(l.text)))
      add(R("yellow", "install-script", "新增了安装时自动执行的脚本（postinstall 等）", "install-time script added (postinstall etc.)"), file);
  }
  for (const [file, bytes] of Object.entries(sizes)) {
    if (bytes >= FILE_LIMIT) add(R("red", "huge-file", `文件 ≥ 100MB（${(bytes / MB).toFixed(1)}MB），GitHub 放不下`, `file ≥ 100MB (${(bytes / MB).toFixed(1)}MB), GitHub rejects it`), file);
    else if (bytes >= 50 * MB) add(R("yellow", "big-file", `大文件 ${(bytes / MB).toFixed(1)}MB，会让仓库变大`, `large file ${(bytes / MB).toFixed(1)}MB`), file);
  }
  // 同一文件同一规则只保留一条（行号合并），减少刷屏
  const seen = new Map();
  for (const f of findings) {
    const k = `${f.id}|${f.file}`; const s = seen.get(k);
    if (s) { if (f.line && s.lines.length < 5) s.lines.push(f.line); } else seen.set(k, { ...f, lines: f.line ? [f.line] : [] });
  }
  return [...seen.values()].map(({ line, ...f }) => f);
}

export const overall = (findings) => findings.some((f) => f.level === "red") ? "red" : findings.some((f) => f.level === "yellow") ? "yellow" : "green";

const ICON = { red: "🔴", yellow: "🟡", green: "🟢" };
/** checks: [{name, level, zh, en}]（gitleaks、故事校验、依赖审计等外部检查的结果） */
export function report(findings, checks = []) {
  const all = [...findings.map((f) => f.level), ...checks.map((c) => c.level)];
  const lv = all.includes("red") ? "red" : all.includes("yellow") ? "yellow" : "green";
  const head = {
    red: "🔴 **红灯：有明显问题，已拦下，需要修改后才能合并。** / **Red: obvious problem found, blocked until fixed.**",
    yellow: "🟡 **黄灯：没有明显问题，但有些改动需要家驹看一眼再决定。** / **Yellow: nothing obviously wrong, but some changes need 家驹 to look.**",
    green: "🟢 **绿灯：自动检查没发现问题。（最终仍由家驹决定是否合并）** / **Green: automated checks found no problems (家驹 still decides).**",
  }[lv];
  const lines = ["<!-- my-oasis-security-review -->", "## 自动安全审核 / Automated security review", "", head, ""];
  if (checks.length) {
    lines.push("| 检查 Check | 结果 Result | 说明 Notes |", "|---|---|---|");
    for (const c of checks) lines.push(`| ${c.name} | ${ICON[c.level]} | ${c.zh} / ${c.en} |`);
    lines.push("");
  }
  if (findings.length) {
    lines.push("### 代码扫描发现 / Scanner findings", "");
    for (const f of [...findings].sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1)))
      lines.push(`- ${ICON[f.level]} \`${f.file}\`${f.lines.length ? ` (L${f.lines.join(", L")})` : ""}：${f.zh} / ${f.en}`);
  } else lines.push("代码扫描：没有发现需要注意的改动。/ Scanner: nothing to flag.");
  lines.push("", "<sub>红灯拦下；黄灯请家驹看；CodeQL 结果见 Security 标签页。Red blocks; yellow = needs 家驹; CodeQL results are in the Security tab.</sub>");
  return { level: lv, markdown: lines.join("\n") };
}
