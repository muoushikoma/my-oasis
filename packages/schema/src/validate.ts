import { parseDocument, LineCounter, isMap, isSeq, isPair, isScalar, type Document } from "yaml";
// 预编译的 Ajv 校验器（scripts/gen-validator.mjs 生成），运行时不用 new Function，符合客户端 CSP
import storyValidate from "./story.validate.generated.js";
import { strFromU8 } from "fflate";
import { parseExpr, collectRefs, ExprError, BUILTIN_FUNCS, RANDOM_FUNCS, DICE_FUNCS } from "./expr.js";
import { ALLOWED_EXT, IMAGE_EXT, AUDIO_EXT, LIMITS, type StoryFiles } from "./files.js";
import { DEFAULT_MAX_AUTHORITY, KNOWN_TEMPLATES, regionsOf, type Story, type Step, type StateDef } from "./types.js";

export type Level = "error" | "warning" | "info";
export interface Issue {
  level: Level;
  code: string;
  message: string;       // 大白话说明
  fix?: string;          // 怎么改
  file: string;
  line?: number;         // 从 1 开始
  col?: number;
  path: (string | number)[];
  where: string;         // 人话位置，如「动作 search 的第 1 步」
  ref?: string;          // 规范条款
}
export interface ValidationResult { ok: boolean; story?: Story; issues: Issue[]; mainFile: string }

function getAjv(): any {
  return storyValidate;
}

const SECTION_NAMES: Record<string, string> = {
  meta: "基本信息 meta", state: "状态 state", actions: "动作 actions", events: "事件 events", endings: "结局 endings",
  tools: "工具 tools", ai: "AI 设定 ai", ui: "界面 ui", start: "开局 start", uses: "模板 uses", random: "随机数 random", scripts: "脚本 scripts",
};
export function describePath(path: (string | number)[]): string {
  if (!path.length) return "文件最外层";
  const [a, b, ...rest] = path;
  let s: string;
  if (a === "state" && b !== undefined) s = `状态「${b}」`;
  else if (a === "actions" && b !== undefined) s = `动作「${b}」`;
  else if (a === "events" && typeof b === "number") s = `第 ${b + 1} 条事件`;
  else if (a === "endings" && b === "list" && typeof rest[0] === "number") { s = `第 ${rest[0] + 1} 个结局`; rest.shift(); }
  else if (a === "tools" && b !== undefined) s = `工具「${b}」`;
  else if (a === "ai" && b === "entry_points" && rest.length) { s = `AI 接入点「${rest.shift()}」`; }
  else if (a === "ui" && b === "components" && rest.length) { s = `界面组件「${rest.shift()}」`; }
  else { s = SECTION_NAMES[String(a)] ?? String(a); if (b !== undefined) rest.unshift(b); }
  const parts: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (typeof k === "number") parts.push(`第 ${k + 1} 项`);
    else if (k === "steps" || k === "do") { const n = rest[i + 1]; if (typeof n === "number") { parts.push(`第 ${n + 1} 步`); i++; } else parts.push("步骤"); }
    else if (k === "then" || k === "else") { const n = rest[i + 1]; parts.push(`${k === "then" ? "条件成立时" : "否则"}${typeof n === "number" ? `的第 ${n + 1} 步` : ""}`); if (typeof n === "number") i++; }
    else if (k === "card") parts.push("任务卡");
    else parts.push(`「${k}」`);
  }
  return [s, ...parts].join("的");
}

function levenshtein(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export function closest(name: string, options: string[]): string | undefined {
  let best: string | undefined, bd = Infinity;
  for (const o of options) { const x = levenshtein(name.toLowerCase(), o.toLowerCase()); if (x < bd) { bd = x; best = o; } }
  return best !== undefined && bd <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}
const didYouMean = (name: string, options: string[]) => { const c = closest(name, options); return c ? `是不是想写「${c}」？` : ""; };
const listOf = (xs: string[]) => (xs.length ? xs.map((x) => `「${x}」`).join("、") : "（目前一个都没有）");

const TYPE_CN: Record<string, string> = { string: "文字", number: "数字", integer: "整数", boolean: "true/false", object: "一组「名字: 值」", array: "列表", null: "空" };
const typeName = (v: unknown) => v === null ? "空" : Array.isArray(v) ? "列表" : typeof v === "object" ? "一组「名字: 值」" : typeof v === "string" ? "文字" : typeof v === "number" ? "数字" : typeof v === "boolean" ? "true/false" : typeof v;

export function validateFiles(files: StoryFiles): ValidationResult {
  const issues: Issue[] = [];
  const hasYaml = files.has("story.yaml") || files.has("story.yml");
  const hasJson = files.has("story.json");
  const mainFile = files.has("story.yaml") ? "story.yaml" : files.has("story.yml") ? "story.yml" : "story.json";
  const push = (i: Omit<Issue, "where" | "file"> & { file?: string; where?: string }) => issues.push({ file: mainFile, where: describePath(i.path), ...i });

  // ---------- 文件层 ----------
  if (!hasYaml && !hasJson) {
    push({ level: "error", code: "no_main_file", path: [], message: "故事包里没有找到主文件 story.yaml。", fix: "在故事包最外层放一个名为 story.yaml 的文件（注意不要多套一层文件夹）。", ref: "§1" });
    return { ok: false, issues, mainFile };
  }
  if (hasYaml && hasJson) push({ level: "error", code: "both_main_files", path: [], message: "story.yaml 和 story.json 同时存在，不知道用哪个。", fix: "删掉其中一个。", ref: "§1" });
  let total = 0;
  if (files.size > LIMITS.fileCount) push({ level: "error", code: "too_many_files", path: [], message: `文件太多（${files.size} 个），最多 ${LIMITS.fileCount} 个。`, ref: "§1" });
  for (const [p, d] of files) {
    total += d.length;
    if (p.startsWith("/") || p.split("/").includes("..")) push({ level: "error", code: "bad_path", file: p, path: [], message: `文件路径「${p}」不安全。`, fix: "只用包内相对路径，不要以 / 开头、不要含 ..。", ref: "§1" });
    const ext = (p.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) push({ level: "error", code: "bad_file_type", file: p, path: [], message: `不支持的文件类型「${p}」。`, fix: `只能放这些类型：${ALLOWED_EXT.join(" ")}`, ref: "§1" });
    if (d.length > LIMITS.fileBytes) push({ level: "error", code: "file_too_big", file: p, path: [], message: `文件「${p}」有 ${(d.length / 1024 / 1024).toFixed(1)} MB，单个文件必须小于 100 MB（GitHub 限制）。`, fix: "压缩或拆分这个文件。", ref: "§1" });
    if (IMAGE_EXT.includes(ext) && d.length > LIMITS.imageBytes) push({ level: "error", code: "image_too_big", file: p, path: [], message: `图片「${p}」有 ${(d.length / 1024).toFixed(0)} KB，超过 10 MB。`, fix: "压缩图片或转成 WebP。", ref: "§13.5" });
    if (AUDIO_EXT.includes(ext) && d.length > LIMITS.audioBytes) push({ level: "error", code: "audio_too_big", file: p, path: [], message: `音频「${p}」有 ${(d.length / 1024 / 1024).toFixed(1)} MB，超过 30 MB。`, fix: "降低码率（如 96–128 kbps 的 OGG/MP3）或剪短。", ref: "§13.5" });
  }
  if (total > LIMITS.packageBytes) push({ level: "error", code: "package_big", path: [], message: `故事包有 ${(total / 1024 / 1024).toFixed(1)} MB，超过 300 MB 上限。`, fix: "压缩图片和音频，或删掉没用到的素材。", ref: "§1" });

  // ---------- 语法 ----------
  const src = strFromU8(files.get(mainFile)!).replace(/^\uFEFF/, "");
  const lc = new LineCounter();
  const doc = parseDocument(src, { lineCounter: lc, uniqueKeys: true, prettyErrors: false });
  const posOf = (offset: number) => { const p = lc.linePos(offset); return { line: p.line, col: p.col }; };
  if (doc.errors.length) {
    for (const e of doc.errors) {
      const { line, col } = posOf(e.pos[0]);
      const lineText = src.split("\n")[line - 1] ?? "";
      let message = "文件格式（YAML）写错了，程序读不懂这一行。";
      let fix = "检查缩进是否对齐（用 2 个空格）、冒号后面是否有空格、引号和括号是否成对。";
      if (/\t/.test(lineText)) { message = "这一行用了 Tab 键缩进，YAML 不允许。"; fix = "把 Tab 换成空格（每层 2 个空格）。"; }
      else if (e.code === "DUPLICATE_KEY") { message = "同一层里出现了两个同名的字段。"; fix = "删掉或改名其中一个。"; }
      else if (/[:]\S/.test(lineText) && !/['"]/.test(lineText) && e.code !== "BAD_INDENT") fix = "冒号后面要有一个空格，例如 `title: 守灯人`。" ;
      push({ level: "error", code: "syntax", path: [], line, col, message: `${message}（原始提示：${e.code}）`, fix, ref: "§1" });
    }
    return { ok: false, issues, mainFile };
  }
  const story = doc.toJS({ maxAliasCount: 50 }) as Story;
  if (!story || typeof story !== "object" || Array.isArray(story)) {
    push({ level: "error", code: "not_object", path: [], line: 1, message: "主文件内容不是一组「字段: 值」。", fix: "参考规范 §16 的示例，从 `spec: oasis/0.3` 开始写。", ref: "§3" });
    return { ok: false, issues, mainFile };
  }

  const locate = (path: (string | number)[], key?: string) => {
    let node: any = doc.contents;
    let last: any = node;
    for (const k of path) {
      if (isMap(node)) { const pair = node.items.find((p: any) => isScalar(p.key) && String(p.key.value) === String(k)); if (!pair) break; last = pair.key; node = pair.value; }
      else if (isSeq(node) && typeof k === "number") { node = node.items[k]; }
      else break;
      if (node) last = node;
    }
    if (key && isMap(node)) { const pair = node.items.find((p: any) => isScalar(p.key) && String(p.key.value) === key); const kr = (pair as any)?.key?.range; if (kr) return posOf(kr[0]); }
    const r = (node?.range ?? last?.range) as number[] | undefined;
    return r ? posOf(r[0]) : { line: 1, col: 1 };
  };
  const report = (level: Level, code: string, path: (string | number)[], message: string, fix?: string, ref?: string, key?: string) => {
    const pos = locate(path, key);
    push({ level, code, path: key ? [...path, key] : path, where: describePath(key ? [...path, key] : path), message, fix, ref, ...pos });
  };

  // ---------- 结构（JSON Schema） ----------
  const v = getAjv();
  v(story);
  const ptr = (s: string) => s.split("/").slice(1).map((x) => x.replace(/~1/g, "/").replace(/~0/g, "~")).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const stepLike = /\/(steps|do|then|else)\/\d+/;
  const seen = new Set<string>();
  for (const e of (v.errors ?? []) as any[]) {
    if (["oneOf", "anyOf", "if", "not"].includes(e.keyword)) continue;
    if (/\/oneOf\/|\/anyOf\//.test(e.schemaPath)) continue;            // 交给下面的语义检查给出更易懂的提示
    if (stepLike.test(e.instancePath)) continue;                        // 步骤由语义检查处理
    const path = ptr(e.instancePath);
    const dataAt = path.reduce((o: any, k) => (o == null ? o : o[k]), story);
    let message = "", fix: string | undefined, key: string | undefined, ref: string | undefined;
    const field = path.length ? `「${path[path.length - 1]}」` : "";
    switch (e.keyword) {
      case "required": if (e.params.missingProperty === "hook" && path[0] === "events" && dataAt && ("on" in dataAt || "true" in dataAt)) continue; key = undefined; message = `缺少必填项「${e.params.missingProperty}」。`; fix = `补上 ${e.params.missingProperty}，写法见规范。`; break;
      case "additionalProperties": {
        key = e.params.additionalProperty;
        const known = Object.keys(e.parentSchema?.properties ?? {});
        if ((key === "true" || key === "on") && path[0] === "events") { message = "事件里写了 `on:`，YAML 会把 on 当成 true，读不出来。"; fix = "把 `on:` 改成 `hook:`。"; ref = "§7"; }
        else { message = `多了一个不认识的字段「${key}」。${didYouMean(key!, known)}`; fix = known.length ? `这里能用的字段有：${known.join("、")}。` : "删掉它。"; }
        break;
      }
      case "type": message = `${field || "这里"}应该是${TYPE_CN[e.params.type] ?? e.params.type}，现在写的是${typeName(dataAt)}。`;
        if (e.params.type === "string" && typeof dataAt !== "string") fix = "如果是条件或计算，请整句加上双引号。"; break;
      case "enum": message = `${field}写的是「${JSON.stringify(dataAt)}」，只能是：${(e.params.allowedValues as any[]).join(" / ")}。`; {
        const c = typeof dataAt === "string" ? closest(dataAt, e.params.allowedValues) : undefined; if (c) fix = `是不是想写「${c}」？`; } break;
      case "const": message = `${field}应该写成「${e.params.allowedValue}」。`; break;
      case "pattern": {
        const last = path[path.length - 1];
        if (/\[a-z\]\[a-z0-9_\]/.test(e.params.pattern)) { message = `名字「${dataAt}」不合规则：只能用小写英文字母开头，后面跟小写字母、数字或下划线。`; fix = "例如 oil、keeper_trust；中文名写在 label 里。"; ref = "§2.1"; }
        else if (last === "id" && path[0] === "meta") { message = `故事 id「${dataAt}」不合规则：只能用小写字母、数字和连字符，3–64 位。`; fix = "例如 lighthouse-keeper。"; ref = "§2.1"; }
        else if (last === "version" || last === "min_engine") { message = `版本号「${dataAt}」格式不对。`; fix = "写成三段数字，如 1.0.0。"; }
        else if (last === "trigger") { message = `触发方式「${dataAt}」写法不对。`; fix = "可选：player_input、game_start、game_end、action:动作id、event:事件名、ui:组件id.事件（如 ui:keeper_chat.send）。"; ref = "§10.4"; }
        else if (last === "to" || path.includes("sections")) { message = `输出位置「${dataAt}」写法不对。`; fix = "写成 region:区域id、component:组件id、state:状态id 或 none。"; ref = "§10.3"; }
        else if (last === "hook") { message = `事件时机「${dataAt}」写法不对。`; fix = "可选：game_start、turn_start、turn_end、action:动作id、state:状态id，或自定义事件名。"; ref = "§7"; }
        else if (path.includes("colors")) { message = `颜色「${dataAt}」格式不对。`; fix = "写成 #RRGGBB，如 #3aa6b9，并加引号。"; }
        else if (path[0] === "uses") { message = `模板「${dataAt}」写法不对。`; fix = `写成 oasis/名字@版本，如 ${KNOWN_TEMPLATES[0]}。`; }
        else message = `${field}「${dataAt}」的格式不对。`;
        break;
      }
      case "propertyNames": continue; // 由内层 pattern 报告
      case "minimum": message = `${field}是 ${dataAt}，不能小于 ${e.params.limit}。`; break;
      case "maximum": message = `${field}是 ${dataAt}，不能大于 ${e.params.limit}。`; break;
      case "minItems": message = `${field}至少要有 ${e.params.limit} 项。`; break;
      case "maxItems": message = `${field}最多 ${e.params.limit} 项。`; break;
      case "minLength": message = `${field}不能是空的。`; break;
      case "maxLength": message = `${field}太长了，最多 ${e.params.limit} 个字。`; break;
      case "minProperties": message = `${field}里至少要写 1 项。`; break;
      case "uniqueItems": message = `${field}里有重复的项。`; break;
      default: message = `${field}不符合规范（${e.keyword}）。`;
    }
    // 名字类错误：Ajv 对 propertyNames 的 instancePath 指向对象本身，名字在 propertyName 里
    if (e.propertyName) { key = e.propertyName; message = `名字「${e.propertyName}」不合规则：只能用小写英文字母开头，后面跟小写字母、数字或下划线（最长 40）。`; fix = `例如 ${toSnake(String(e.propertyName))}；中文名写在 label 里。`; ref = "§2.1"; }
    const sig = `${e.instancePath}|${key ?? ""}|${message}`;
    if (seen.has(sig)) continue; seen.add(sig);
    report("error", `schema_${e.keyword}`, path, message, fix, ref ?? specRefFor(path), key);
  }

  // ---------- 语义 ----------
  semantic(story, files, report);
  realtimeChecks(story, files, report);
  const ok = !issues.some((i) => i.level === "error");
  return { ok, story: ok ? normalizeStory(story) : undefined, issues: sortIssues(issues), mainFile };
}

export function toSnake(x: string) {
  const r = x.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+/g, "_").replace(/_$/, "");
  return r || "my_name";
}
function specRefFor(path: (string | number)[]) {
  return ({ meta: "§4", state: "§6.1", actions: "§6.2", events: "§7", endings: "§8", tools: "§9", ai: "§10", ui: "§13", uses: "§11", scripts: "§12", random: "§5", start: "§3.1" } as Record<string, string>)[String(path[0])] ?? "§3";
}
function sortIssues(xs: Issue[]) {
  const o = { error: 0, warning: 1, info: 2 };
  return xs.sort((a, b) => o[a.level] - o[b.level] || (a.line ?? 0) - (b.line ?? 0));
}

type Report = (level: Level, code: string, path: (string | number)[], message: string, fix?: string, ref?: string, key?: string) => void;

const STEP_OPS = ["set", "inc", "add", "remove", "put", "let", "if", "call", "emit", "end", "fail", "log"];

function semantic(s: Story, files: StoryFiles, report: Report) {
  const obj = (x: any) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  const state: Record<string, StateDef> = obj(s.state);
  const actions = obj(s.actions);
  const tools = obj(s.tools);
  const endings = Array.isArray(s.endings?.list) ? s.endings.list : [];
  const events = Array.isArray(s.events) ? s.events : [];
  const comps = obj(s.ui?.components);
  const entries = obj(s.ai?.entry_points);
  const isAi = (c: any) => c?.content === "ai" || c?.from_ai === true;
  const uses = Array.isArray(s.uses) ? s.uses : [];
  const stateIds = Object.keys(state), actionIds = Object.keys(actions), endingIds = endings.map((e: any) => e?.id).filter(Boolean);
  const regions = regionsOf(s.ui);
  const emitted = new Set<string>();
  const usedActions = new Set<string>();
  const fileExists = (p: unknown) => typeof p === "string" && files.has(p);
  const checkFile = (path: (string | number)[], p: unknown, what: string) => {
    if (typeof p === "string" && !fileExists(p)) report("error", "missing_file", path, `${what}引用了文件「${p}」，但故事包里没有这个文件。`, `把文件放进故事包，或检查路径大小写（包内文件有：${[...files.keys()].slice(0, 8).join("、")}${files.size > 8 ? "……" : ""}）。`, "§1");
  };

  // assets（素材清单）
  const assets = obj((s as any).assets);
  const extOf = (x: string) => (x.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase();
  for (const [id, a] of Object.entries<any>(assets)) {
    if (!a || typeof a.path !== "string") continue;
    const p = ["assets", id];
    if (!files.has(a.path)) { report("error", "missing_file", p, `素材「${id}」的文件「${a.path}」不在故事包里。`, "把文件放进故事包，或检查路径和大小写。", "§13.5", "path"); continue; }
    const ext = extOf(a.path);
    if (a.type === "image" && !IMAGE_EXT.includes(ext)) report("error", "asset_format", p, `素材「${id}」标为图片，但「${a.path}」不是 WebP/PNG/JPG。`, undefined, "§13.5", "path");
    if (a.type === "audio" && !AUDIO_EXT.includes(ext)) report("error", "asset_format", p, `素材「${id}」标为音频，但「${a.path}」不是 OGG/MP3/M4A。`, undefined, "§13.5", "path");
    if ((a.use === "music" || a.use === "sfx") && a.type !== "audio") report("error", "asset_use", p, `素材「${id}」用途是 ${a.use}，类型应为 audio。`, undefined, "§13.5", "use");
    if (["background", "portrait", "illustration", "icon"].includes(a.use) && a.type !== "image") report("error", "asset_use", p, `素材「${id}」用途是 ${a.use}，类型应为 image。`, undefined, "§13.5", "use");
  }
  const assetIds = Object.keys(assets);
  /** 检查素材引用：asset:<id> 或包内路径 */
  const checkRef = (path: (string | number)[], ref: unknown, want: "image" | "audio", what: string, key?: string) => {
    if (typeof ref !== "string") return;
    if (ref.startsWith("asset:")) {
      const id = ref.slice(6), a = assets[id];
      if (!a) report("error", "unknown_asset", path, `${what}引用的素材「${id}」没有在 assets 里登记。${didYouMean(id, assetIds)}`, `已登记的素材：${listOf(assetIds)}。`, "§13.5", key);
      else if (a.type !== want) report("error", "asset_type", path, `${what}需要${want === "image" ? "图片" : "音频"}，但素材「${id}」是${a.type === "image" ? "图片" : "音频"}。`, undefined, "§13.5", key);
      return;
    }
    if (!files.has(ref)) { report("error", "missing_file", path, `${what}引用了文件「${ref}」，但故事包里没有这个文件。`, "把文件放进故事包，或改用 asset:素材id。", "§13.5", key); return; }
    const ok = (want === "image" ? IMAGE_EXT : AUDIO_EXT).includes(extOf(ref));
    if (!ok) report("error", "asset_format", path, `${what}需要${want === "image" ? "图片（WebP/PNG/JPG）" : "音频（OGG/MP3/M4A）"}，但「${ref}」格式不对。`, undefined, "§13.5", key);
  };
  const images = obj((s as any).ai?.images);

  // meta
  checkRef(["meta"], s.meta?.cover, "image", "封面", "cover");
  checkFile(["meta", "setting"], s.meta?.setting, "设定");
  if (s.meta?.rating === "mature") report("warning", "mature_rating", ["meta", "rating"], "分级是 mature：可以在本地导入游玩，但目前（暂定）主故事库不收 mature，上传会被拒绝。", "如果内容其实适合全年龄或青少年，改成 all-ages 或 teen。", "§4");
  uses.forEach((u, i) => { if (!KNOWN_TEMPLATES.includes(u)) report("error", "unknown_template", ["uses", i], `不认识的官方模板「${u}」。${didYouMean(u, KNOWN_TEMPLATES)}`, `可用的有：${KNOWN_TEMPLATES.join("、")}。`, "§11"); });

  // state
  for (const [id, d] of Object.entries(state)) {
    if (!d || typeof d !== "object") continue;
    const p = ["state", id];
    if (d.type === "enum" && Array.isArray(d.values) && typeof d.init === "string" && !d.values.includes(d.init))
      report("error", "enum_init", [...p, "init"], `初始值「${d.init}」不在可选值 ${listOf(d.values)} 里。${didYouMean(d.init, d.values)}`, "把 init 改成 values 里的某一个。", "§6.1");
    if (d.type === "number" && typeof d.init === "number") {
      if (d.min !== undefined && d.init < d.min) report("error", "init_range", [...p, "init"], `初始值 ${d.init} 小于下限 ${d.min}。`, undefined, "§6.1");
      if (d.max !== undefined && d.init > d.max) report("error", "init_range", [...p, "init"], `初始值 ${d.init} 大于上限 ${d.max}。`, undefined, "§6.1");
      if (d.min !== undefined && d.max !== undefined && d.min > d.max) report("error", "min_max", p, `下限 ${d.min} 比上限 ${d.max} 还大。`, undefined, "§6.1");
    }
    if ((d.type === "list" || d.type === "set") && Array.isArray(d.init) && d.of) {
      const jt = d.of === "bool" ? "boolean" : d.of;
      if (d.init.some((x: any) => typeof x !== jt)) report("error", "init_elem_type", [...p, "init"], `初始列表里有不是「${d.of}」类型的元素。`, undefined, "§6.1");
    }
    if (d.type === "record" && d.fields && d.init && typeof d.init === "object") {
      for (const k of Object.keys(d.init)) if (!(k in d.fields)) report("error", "record_field", [...p, "init"], `初始值里的「${k}」不在 fields 里。`, `fields 里有：${Object.keys(d.fields).join("、")}`, "§6.1");
    }
  }

  // 表达式检查
  type Ctx = { params?: Set<string>; locals?: Set<string>; out?: Set<string>; event?: boolean; random?: boolean };
  const checkExpr = (path: (string | number)[], src: unknown, ctx: Ctx, key?: string) => {
    if (typeof src === "number" || typeof src === "boolean") return;
    if (typeof src !== "string") return;
    let ast;
    try { ast = parseExpr(src); }
    catch (e) {
      const m = e instanceof ExprError ? e.message : String(e);
      let fix = "检查括号、引号是否成对，运算符是否写对（等于用 ==，并且用 &&，或者用 ||）。";
      if (/(^|[^=!<>])=([^=]|$)/.test(src)) fix = "判断相等要写两个等号 ==。";
      if (/\band\b|\bor\b|并且|或者/.test(src)) fix = "「并且」写 &&，「或者」写 ||。";
      report("error", "expr_syntax", path, `表达式「${src}」写错了：${m}。`, fix, "§2.2", key);
      return;
    }
    const refs = collectRefs(ast);
    for (const fn of refs.calls) {
      if (BUILTIN_FUNCS.includes(fn)) continue;
      if (RANDOM_FUNCS.includes(fn) || DICE_FUNCS.includes(fn)) continue; // 随机/骰子函数任何表达式里都能用（结果可复现）
      report("error", "unknown_func", path, `不能使用函数「${fn}()」。${didYouMean(fn, [...BUILTIN_FUNCS, ...RANDOM_FUNCS, ...DICE_FUNCS])}`, `可用：${[...BUILTIN_FUNCS, ...RANDOM_FUNCS].join("、")}、${DICE_FUNCS.join("、")}。`, "§2.2", key);
    }
    for (const pth of refs.paths) {
      const [root, a, b] = pth;
      if (root === "state") {
        if (a === undefined) { report("error", "state_bare", path, "不能直接用 state，要写 state.某个状态。", undefined, "§2.2", key); continue; }
        if (!(a in state)) { report("error", "unknown_state", path, `表达式里用到的状态「${a}」不存在。${didYouMean(a, stateIds)}`, `已有的状态：${listOf(stateIds)}。`, "§2.2", key); continue; }
        const d = state[a];
        if (b !== undefined && d?.type === "record" && d.fields && !(b in d.fields)) report("error", "unknown_field", path, `状态「${a}」没有字段「${b}」。`, `有：${Object.keys(d.fields).join("、")}`, "§6.1", key);
      } else if (root === "params") {
        if (!ctx.params) report("error", "params_not_here", path, "这里没有参数可用（params 只能在动作里用）。", undefined, "§2.2", key);
        else if (a !== undefined && !ctx.params.has(a)) report("error", "unknown_param", path, `参数「${a}」没有定义。${didYouMean(a, [...ctx.params])}`, `在动作的 params 里加上它，现有参数：${listOf([...ctx.params])}。`, "§6.2", key);
      } else if (root === "out") {
        if (!ctx.out) report("error", "out_not_here", path, "out 只能在 AI 接入点 output.then 里用。", undefined, "§10.3", key);
        else if (a !== undefined && !ctx.out.has(a)) report("error", "unknown_out", path, `AI 输出里没有字段「${a}」。`, `output.schema 里有：${listOf([...ctx.out])}。`, "§10.3", key);
      } else if (root === "event") {
        if (!ctx.event) report("error", "event_not_here", path, "event 只能在事件里用。", undefined, "§2.2", key);
      } else if (root === "turn") {
      } else if (ctx.locals?.has(root)) {
      } else if (root in state) {
        report("error", "missing_state_prefix", path, `「${root}」是状态，读取时要写成 state.${root}。`, `把 ${root} 改成 state.${root}。`, "§2.2", key);
      } else {
        report("error", "unknown_name", path, `表达式「${src}」里的「${root}」不知道是什么。`,
          /[\u4e00-\u9fff]/.test(root) || /^[A-Za-z]/.test(root) ? `如果想写文字「${root}」，要加单引号：\"'${root}'\"；如果是状态，写 state.xxx；如果是局部变量，先用 let 定义。` : undefined, "§2.3", key);
      }
    }
  };

  const typeOfTarget = (t: string) => state[t.split(".")[0]];
  const checkTarget = (path: (string | number)[], tgt: string, op: string) => {
    const [sid, field] = tgt.split(".");
    const d = state[sid];
    if (!d) { report("error", "unknown_state", path, `要修改的状态「${sid}」不存在。${didYouMean(sid, stateIds)}`, `已有的状态：${listOf(stateIds)}。`, "§6.2", tgt); return; }
    if (field && (d.type !== "record" || !d.fields || !(field in d.fields))) { report("error", "unknown_field", path, `状态「${sid}」没有字段「${field}」。`, undefined, "§6.2", tgt); return; }
    const t = field ? d.fields![field] : d.type;
    if (op === "inc" && t !== "number") report("error", "op_type", path, `「inc」只能用于数字，但「${tgt}」是 ${t}。`, "改用 set。", "§6.2", tgt);
    if ((op === "add" || op === "remove") && t !== "list" && t !== "set") report("error", "op_type", path, `「${op}」只能用于列表/集合，但「${tgt}」是 ${t}。`, undefined, "§6.2", tgt);
    if (op === "put" && t !== "map") report("error", "op_type", path, `「put」只能用于 map，但「${tgt}」是 ${t}。`, undefined, "§6.2", tgt);
  };

  const collectLets = (steps: any, out: Set<string>) => {
    if (!Array.isArray(steps)) return;
    for (const st of steps) { if (st?.let && typeof st.let === "object") Object.keys(st.let).forEach((k) => out.add(k)); collectLets(st?.then, out); collectLets(st?.else, out); }
  };
  const checkSteps = (path: (string | number)[], steps: unknown, ctx: Ctx) => {
    if (steps === undefined) return;
    if (!Array.isArray(steps)) { report("error", "steps_not_list", path, "步骤应该是一个列表（每一步前面加「- 」）。", undefined, "§6.2"); return; }
    steps.forEach((st: Step, i: number) => {
      const p = [...path, i];
      if (!st || typeof st !== "object" || Array.isArray(st)) { report("error", "step_shape", p, "这一步应该写成「- 操作: 内容」，例如 `- set: { oil: 3 }`。", undefined, "§6.2"); return; }
      const keys = Object.keys(st);
      const op = keys.find((k) => STEP_OPS.includes(k));
      if (!op) { const k = keys[0]; report("error", "unknown_step", p, `不认识的步骤「${k}」。${didYouMean(k, STEP_OPS)}`, `能用的步骤：${STEP_OPS.join("、")}。`, "§6.2"); return; }
      const allowed = op === "if" ? ["if", "then", "else"] : op === "call" ? ["call", "params"] : op === "emit" ? ["emit", "data"] : [op];
      const extra = keys.filter((k) => !allowed.includes(k));
      if (extra.length) report("error", "step_extra", p, `这一步除了「${op}」还写了 ${listOf(extra)}。每一步只能做一件事。`, "把它们拆成单独的步骤（每步前面一个「- 」）。", "§6.2");
      const body = (st as any)[op];
      switch (op) {
        case "set": case "inc": case "add": case "remove": case "let":
          if (!body || typeof body !== "object" || Array.isArray(body)) { report("error", "step_body", p, `「${op}」后面应写成 { 名字: 值 }。`, undefined, "§6.2"); break; }
          for (const [k, val] of Object.entries(body)) {
            if (op === "let") { if (k in state) report("error", "let_shadow", [...p, op], `局部变量「${k}」和状态同名了。`, "换一个名字。", "§6.2", k); }
            else checkTarget([...p, op], k, op);
            checkExpr([...p, op], val, ctx, k);
          }
          break;
        case "put":
          if (!body || typeof body !== "object") break;
          for (const [k, val] of Object.entries<any>(body)) { checkTarget([...p, op], k, op); checkExpr([...p, op, k], val?.key, ctx, "key"); checkExpr([...p, op, k], val?.value, ctx, "value"); }
          break;
        case "if":
          checkExpr(p, body, ctx, "if");
          if (!Array.isArray((st as any).then)) report("error", "if_then", p, "「if」后面必须有 then（条件成立时做什么）。", undefined, "§6.2");
          checkSteps([...p, "then"], (st as any).then, ctx);
          checkSteps([...p, "else"], (st as any).else, ctx);
          break;
        case "call":
          if (!(body in actions)) report("error", "unknown_action", p, `调用的动作「${body}」不存在。${didYouMean(String(body), actionIds)}`, `已有的动作：${listOf(actionIds)}。`, "§6.2", "call");
          else { usedActions.add(body); for (const [k, val] of Object.entries(obj((st as any).params))) checkExpr([...p, "params"], val, ctx, k); }
          break;
        case "emit": emitted.add(String(body)); for (const [k, val] of Object.entries(obj((st as any).data))) checkExpr([...p, "data"], val, ctx, k); break;
        case "end": if (!endingIds.includes(body)) report("error", "unknown_ending", p, `要进入的结局「${body}」不存在。${didYouMean(String(body), endingIds)}`, `已有的结局：${listOf(endingIds)}。`, "§6.2", "end"); break;
        case "fail": if (typeof body !== "string") report("error", "fail_text", p, "fail 后面写一句说明文字。", undefined, "§6.2"); break;
        case "log": checkExpr(p, body, ctx, "log"); break;
      }
    });
  };

  // start
  checkSteps(["start", "do"], s.start?.do, { random: true, locals: (() => { const l = new Set<string>(); collectLets(s.start?.do, l); return l; })() });

  // actions
  for (const [id, a] of Object.entries<any>(actions)) {
    if (!a || typeof a !== "object") continue;
    const p = ["actions", id];
    const hasSteps = a.steps !== undefined, hasScript = a.script !== undefined;
    if (hasSteps === hasScript) report("error", "action_body", p, hasSteps ? "同时写了 steps 和 script，只能二选一。" : "动作既没有 steps 也没有 script，不知道要做什么。", "写 steps（推荐），或写 script: scripts/xxx.js#run。", "§6.2");
    if (hasScript && typeof a.script === "string") {
      const [file, fn] = a.script.split("#");
      if (!fn) report("error", "script_ref", p, `脚本写法「${a.script}」不对。`, "写成 文件路径#函数名，例如 scripts/ignite.js#run。", "§6.2", "script");
      else if (!files.has(file)) report("error", "missing_file", p, `脚本文件「${file}」不在故事包里。`, undefined, "§12", "script");
      else if (/\.(lua|py)$/.test(file)) report("warning", "script_lang_later", p, `「${file}」是 ${file.endsWith(".py") ? "Python" : "Lua"} 脚本，目前版本还不支持（计划 ${file.endsWith(".py") ? "M9" : "M8"}），试玩时该动作会失败。`, "先用 JavaScript 或声明式步骤。", "§12", "script");
    }
    const params = new Set(Object.keys(obj(a.params)));
    for (const [pn, pd] of Object.entries<any>(obj(a.params))) if (pd?.type === "enum" && !Array.isArray(pd.values)) report("error", "param_values", [...p, "params", pn], "enum 类型的参数必须写 values（可选值列表）。", undefined, "§6.2");
    const locals = new Set<string>(); collectLets(a.steps, locals);
    checkExpr(p, a.require, { params }, "require");
    checkSteps([...p, "steps"], a.steps, { params, locals, random: true });
    checkExpr(p, a.result, { params, locals }, "result");
  }

  // events
  const eventIds = new Set<string>();
  events.forEach((e: any, i: number) => {
    if (!e || typeof e !== "object") return;
    const p = ["events", i];
    if (e.id) { if (eventIds.has(e.id)) report("error", "dup_event", p, `事件 id「${e.id}」重复了。`, undefined, "§7", "id"); eventIds.add(e.id); }
    if (typeof e.hook === "string") {
      const [k, v] = e.hook.split(":");
      if (k === "action" && v !== undefined) { if (!(v in actions)) report("error", "unknown_action", p, `事件监听的动作「${v}」不存在。${didYouMean(v, actionIds)}`, undefined, "§7", "hook"); }
      else if (k === "state" && v !== undefined) { if (!(v in state)) report("error", "unknown_state", p, `事件监听的状态「${v}」不存在。${didYouMean(v, stateIds)}`, undefined, "§7", "hook"); }
    }
    const locals = new Set<string>(); collectLets(e.do, locals);
    checkExpr(p, e.when, { event: true, random: true, locals }, "when");
    checkSteps([...p, "do"], e.do, { event: true, random: true, locals });
  });
  // 自定义事件名是否有人发出（放在 steps 检查之后）
  events.forEach((e: any, i: number) => {
    const h = e?.hook;
    if (typeof h === "string" && !h.includes(":") && !["game_start", "turn_start", "turn_end"].includes(h) && !emitted.has(h) && !Object.values<any>(comps).some((c) => c?.emit === h))
      report("warning", "never_emitted", ["events", i], `事件监听「${h}」，但没有任何地方会发出这个事件（emit），它永远不会触发。`, "检查拼写，或在某个动作里加 `- emit: " + h + "`。", "§7", "hook");
  });

  // endings
  const check_on = s.endings?.check_on ?? "state_change";
  const ids = new Set<string>();
  endings.forEach((e: any, i: number) => {
    const p = ["endings", "list", i];
    if (e?.id) { if (ids.has(e.id)) report("error", "dup_ending", p, `结局 id「${e.id}」重复了。`, undefined, "§8", "id"); ids.add(e.id); }
    if (e?.when === undefined && check_on !== "manual") report("warning", "ending_no_when", p, "这个结局没有写条件 when，只能由动作里的 `end` 步骤进入。", "如果是故意的，忽略即可。", "§8");
    checkExpr(p, e?.when, {}, "when");
  });
  if (s.endings?.script) { const f = String(s.endings.script).split("#")[0]; if (!files.has(f)) report("error", "missing_file", ["endings"], `结局脚本文件「${f}」不在故事包里。`, undefined, "§8", "script"); }

  // tools
  for (const [id, t] of Object.entries<any>(tools)) {
    if (!t || typeof t !== "object") continue;
    const p = ["tools", id];
    const kinds = ["action", "query", "write"].filter((k) => t[k] !== undefined);
    if (kinds.length !== 1) { report("error", "tool_kind", p, kinds.length ? `工具同时写了 ${kinds.join(" 和 ")}，只能选一种。` : "工具没有说明做什么。", "写 action: 动作id、query: 表达式 或 write: 状态id 三者之一。", "§9"); continue; }
    if (t.action !== undefined) {
      const a = actions[t.action];
      if (!a) report("error", "unknown_action", p, `工具指向的动作「${t.action}」不存在。${didYouMean(String(t.action), actionIds)}`, `已有的动作：${listOf(actionIds)}。`, "§9", "action");
      else { usedActions.add(t.action); if (Array.isArray(a.callable_by) && !a.callable_by.includes("ai")) report("error", "not_ai_callable", p, `动作「${t.action}」的 callable_by 里没有 ai，AI 用不了这个工具。`, `在动作「${t.action}」的 callable_by 里加上 ai。`, "§9", "action"); }
    }
    if (t.write !== undefined) {
      const d = state[t.write];
      if (!d) report("error", "unknown_state", p, `工具要写的状态「${t.write}」不存在。${didYouMean(String(t.write), stateIds)}`, undefined, "§9", "write");
      else if (!(d.writable_by ?? []).includes("ai")) report("error", "not_ai_writable", p, `状态「${t.write}」不允许 AI 直接写。`, `在状态「${t.write}」里加上 writable_by: [rules, ai]。`, "§9", "write");
    }
    if (t.query !== undefined) checkExpr(p, t.query, {}, "query");
  }

  // ai
  if (s.ai) {
    const maxA = s.ai.rules?.max_authority ?? DEFAULT_MAX_AUTHORITY;
    checkFile(["ai", "system"], typeof s.ai.system === "string" && /\.md$/.test(s.ai.system) ? s.ai.system : undefined, "全局设定");
    for (const [id, ep] of Object.entries<any>(entries)) {
      if (!ep || typeof ep !== "object") continue;
      const p = ["ai", "entry_points", id];
      const card = obj(ep.card);
      if (typeof card.authority === "number" && card.authority > maxA)
        report("error", "authority_exceeds", [...p, "card"], `任务卡的裁量权是 ${card.authority} 级，但全局最多只允许 ${maxA} 级${s.ai.rules?.max_authority === undefined ? "（没写 max_authority 时默认是 1）" : ""}。`, `把它改成 ${maxA} 或以下，或在 ai.rules.max_authority 里调高。`, "§10.3", "authority");
      for (const [tid, tc] of Object.entries<any>(obj(card.tools))) {
        const t = tools[tid];
        if (!t) { report("error", "unknown_tool", [...p, "card", "tools"], `任务卡允许的工具「${tid}」没有在 tools 里定义。${didYouMean(tid, Object.keys(tools))}`, `已定义的工具：${listOf(Object.keys(tools))}。`, "§10.3", tid); continue; }
        const changes = t.action !== undefined || t.write !== undefined;
        if (card.authority === 0 && changes) report("warning", "authority0_tool", [...p, "card", "tools"], `这个接入点是 0 级（只叙述），但给了会改状态的工具「${tid}」，它每次都会被拒绝。`, "去掉这个工具，或把裁量权调高。", "§10.3", tid);
        if (card.authority === 1 && changes && !tc?.writes) report("warning", "authority1_no_writes", [...p, "card", "tools"], `1 级（小幅调整）下，工具「${tid}」没写 writes（能改哪些状态、改多少），所以它改不了任何状态，调用会被拒绝。`, `给它写 writes，例如 writes: { ${stateIds[0] ?? "oil"}: { delta: [-1, 1] } }，或把裁量权改成 2。`, "§10.3", tid);
        for (const [sid, lim] of Object.entries<any>(obj(tc?.writes))) {
          const d = state[sid];
          if (!d) { report("error", "unknown_state", [...p, "card", "tools", tid, "writes"], `writes 里的状态「${sid}」不存在。${didYouMean(sid, stateIds)}`, undefined, "§10.3", sid); continue; }
          const kind = lim === "any" ? "any" : Object.keys(obj(lim))[0];
          const okKinds: Record<string, string[]> = { delta: ["number"], range: ["number"], values: ["enum", "string", "bool", "number"], add_only: ["list", "set"], any: [d.type] };
          if (!kind || !okKinds[kind]) report("error", "bad_limit", [...p, "card", "tools", tid, "writes"], `「${sid}」的限制写法不对。`, "可用：{ delta: [下限, 上限] }、{ range: [最小, 最大] }、{ values: [...] }、{ add_only: true }、any。", "§10.3", sid);
          else if (!okKinds[kind].includes(d.type)) report("error", "limit_type", [...p, "card", "tools", tid, "writes"], `「${sid}」是 ${d.type} 类型，不能用「${kind}」限制。`, undefined, "§10.3", sid);
          else if ((kind === "delta" || kind === "range") && lim[kind][0] > lim[kind][1]) report("error", "limit_order", [...p, "card", "tools", tid, "writes"], `「${sid}」的 ${kind} 前一个数要小于等于后一个数。`, undefined, "§10.3", sid);
        }
      }
      // 输出
      const out = obj(card.output);
      const checkTo = (path: (string | number)[], to: unknown, key: string) => {
        if (typeof to !== "string" || to === "none") return;
        const [k, v] = to.split(":");
        if (k === "region" && !regions.includes(v)) report("error", "unknown_region", path, `输出到区域「${v}」，但界面里没有这个区域。${didYouMean(v, regions)}`, `当前布局的区域：${listOf(regions)}。`, "§13", key);
        if (k === "component" && !(v in comps)) report("error", "unknown_component", path, `输出到组件「${v}」，但界面里没有这个组件。${didYouMean(v, Object.keys(comps))}`, `已有组件：${listOf(Object.keys(comps))}。`, "§13", key);
        else if (k === "component" && !isAi(comps[v])) report("error", "ai_into_fixed", path, `AI 要输出到组件「${v}」，但它没有标为 AI 处理（不写就是固定内容）。`, `在组件「${v}」里加 content: ai。`, "§0", key);
        if (k === "region" && regions.includes(v) && !Object.values<any>(comps).some((c) => c?.region === v && isAi(c))) report("error", "ai_into_fixed", path, `AI 要输出到区域「${v}」，但这个区域里没有标为 AI 处理的组件。`, `给区域「${v}」里的显示组件（如 text-log）加 content: ai。`, "§0", key);
        if (k === "state") {
          const d = state[v];
          if (!d) report("error", "unknown_state", path, `输出到状态「${v}」，但它不存在。`, undefined, "§10.3", key);
          else { if (d.type !== "string") report("error", "out_state_type", path, `只能把 AI 文字写进文字（string）类型的状态，「${v}」是 ${d.type}。`, undefined, "§10.3", key);
            if (!(d.writable_by ?? []).includes("ai")) report("error", "not_ai_writable", path, `状态「${v}」不允许 AI 写。`, `在状态「${v}」里加上 writable_by: [rules, ai]。`, "§10.3", key); }
        }
      };
      checkTo([...p, "card", "output"], out.to, "to");
      for (const [sec, to] of Object.entries(obj(out.sections))) checkTo([...p, "card", "output", "sections"], to, sec);
      if ((out.format ?? "text") === "text" && out.to === undefined) report("warning", "no_output_to", [...p, "card", "output"], "没写输出到哪里（to），AI 的回复不会显示。", "加上 to: region:main 之类。", "§10.3");
      const outFields = new Set(Object.keys(obj(out.schema)));
      const locals = new Set<string>(); collectLets(out.then, locals);
      checkSteps([...p, "card", "output", "then"], out.then, { out: outFields, locals, random: true });
      // 触发
      if (typeof ep.trigger === "string") {
        const [k, rest] = ep.trigger.split(":");
        if (k === "action" && rest && !(rest in actions)) report("error", "unknown_action", p, `触发用的动作「${rest}」不存在。${didYouMean(rest, actionIds)}`, undefined, "§10.4", "trigger");
        if (k === "event" && rest && !eventIds.has(rest) && !emitted.has(rest)) report("error", "unknown_event", p, `触发用的事件「${rest}」不存在（既不是事件 id，也没有被 emit 过）。`, undefined, "§10.4", "trigger");
        if (k === "ui" && rest) {
          const [cid, evt] = rest.split(".");
          const c = comps[cid];
          if (!c) report("error", "unknown_component", p, `触发用的组件「${cid}」不存在。${didYouMean(cid, Object.keys(comps))}`, `已有组件：${listOf(Object.keys(comps))}。`, "§10.4", "trigger");
          else {
            const evts: Record<string, string[]> = { button: ["click"], "chat-box": ["send"], "text-input": ["submit"], "choice-buttons": ["click"] };
            const ok = evts[c.type];
            if (!ok) report("error", "component_no_event", p, `组件「${cid}」（${c.type}）不会产生事件，不能用来触发 AI。`, "用 button、chat-box、text-input 或 choice-buttons。", "§13", "trigger");
            else if (!ok.includes(evt)) report("error", "component_event", p, `组件「${cid}」（${c.type}）没有「${evt}」事件。`, `应写 ui:${cid}.${ok[0]}。`, "§13", "trigger");
          }
        }
      }
      // 提示词
      if (typeof ep.prompt === "string") {
        if (/^[\w\-/]+\.md$/.test(ep.prompt.trim())) checkFile(p, ep.prompt.trim(), "提示词");
        for (const m of ep.prompt.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
          const ref = m[1];
          if (["input", "history", "setting"].includes(ref)) continue;
          const [r, a] = ref.split(".");
          if (r === "state") { if (!(a in state)) report("error", "unknown_state", p, `提示词里的 {{${ref}}} 引用了不存在的状态「${a}」。${didYouMean(a ?? "", stateIds)}`, undefined, "§10.4", "prompt"); }
          else if (r !== "event") report("error", "bad_placeholder", p, `提示词里的 {{${ref}}} 看不懂。`, "可用：{{input}} {{history}} {{setting}} {{state.xxx}} {{event.xxx}}。", "§10.4", "prompt");
        }
      }
      for (const sid of Array.isArray(ep.context?.state) ? ep.context.state : []) if (!(sid in state)) report("error", "unknown_state", [...p, "context"], `context 里的状态「${sid}」不存在。`, undefined, "§10.4", "state");
      if (ep.optional && !ep.fallback) report("warning", "optional_no_fallback", p, "这个 AI 接入点玩家可以关闭，但没写 fallback（关闭后显示什么）。", "加一句 fallback 文字。", "§10.4");
    }
    // 写了 ai 但没有接入点：允许（等同于不用 AI）
    const narr = Object.values<any>(entries).some((e) => e?.kind === "narrate");
    if (narr && s.ui?.components && !Object.values<any>(comps).some((c) => c?.type === "text-log")) report("warning", "no_text_log", ["ui", "components"], "有 AI 叙述，但界面里没有叙述区（text-log），叙述可能看不到。", "加一个 { type: text-log, region: main }。", "§13");
  }

  // ui
  if (s.ui?.layout?.template === "custom" && Array.isArray(s.ui.layout.grid)) {
    const widths = s.ui.layout.grid.map((r) => r.trim().split(/\s+/).length);
    if (new Set(widths).size > 1) report("error", "grid_shape", ["ui", "layout", "grid"], "布局网格每一行的区域个数要一样。", undefined, "§13");
  }
  for (const [id, c] of Object.entries<any>(comps)) {
    if (!c || typeof c !== "object") continue;
    const p = ["ui", "components", id];
    if (c.region && !regions.includes(c.region)) report("error", "unknown_region", p, `组件放在区域「${c.region}」，但当前布局没有这个区域。${didYouMean(c.region, regions)}`, `当前布局（${s.ui?.layout?.template ?? "simple"}）的区域：${listOf(regions)}。`, "§13", "region");
    const binds = c.bind === undefined ? [] : Array.isArray(c.bind) ? c.bind : [c.bind];
    for (const b of binds) {
      if (typeof b !== "string") continue;
      const d = state[b];
      if (!d) report("error", "unknown_state", p, `组件绑定的状态「${b}」不存在。${didYouMean(b, stateIds)}`, `已有的状态：${listOf(stateIds)}。`, "§13", "bind");
      else if (d.visible === "none" || d.visible === "ai") report("warning", "bind_hidden", p, `组件显示的状态「${b}」被设为玩家看不见（visible: ${d.visible}），组件不会显示它。`, undefined, "§13", "bind");
      else if (c.type === "stat-bar" && (d.type !== "number" || d.min === undefined || d.max === undefined)) report("error", "stat_bar", p, `进度条只能显示有上下限的数字，「${b}」不符合。`, "改用 stat-list，或给状态加 min/max。", "§13", "bind");
    }
    const acts: [string, any][] = [];
    if (c.action !== undefined) acts.push(["action", c.action]);
    if (Array.isArray(c.choices)) c.choices.forEach((ch: any, i: number) => acts.push([`choices`, ch?.action]));
    for (const [k, a] of acts) {
      if (!(a in actions)) report("error", "unknown_action", p, `组件要执行的动作「${a}」不存在。${didYouMean(String(a), actionIds)}`, `已有的动作：${listOf(actionIds)}。`, "§13", k);
      else { usedActions.add(a); const cb = actions[a].callable_by; if (Array.isArray(cb) && !cb.includes("player")) report("error", "not_player_callable", p, `动作「${a}」的 callable_by 里没有 player，玩家点了也不会执行。`, "在 callable_by 里加上 player。", "§13", k); }
    }
    if (c.type === "button" && c.action === undefined && c.emit === undefined && !Object.values<any>(entries).some((e) => e?.trigger === `ui:${id}.click`))
      report("warning", "button_noop", p, "这个按钮点了什么也不会发生（没有 action、emit，也没有 AI 接入点用它触发）。", undefined, "§13");
    if (c.emit) emitted.add(c.emit);
    // 最高原则：自由文字必须有边界
    if ((c.type === "text-input" && c.writes === undefined) || c.type === "chat-box") {
      if (!c.input) report("warning", "free_input_unbounded", p, `「${id}」没有写 input：玩家的文字不能触发任何动作（只会交给 AI 接入点，或得到默认回应“这里做不到。”）。`, "加上 input: { actions: [允许的动作], reject: 超界时的固定回应 }；actions 可以是 []（只聊天、不改任何东西）。", "§0", "type");
      else {
        for (const a of c.input.actions ?? []) if (!(a in actions)) report("error", "unknown_action", [...p, "input"], `input.actions 里的动作「${a}」没有声明。${didYouMean(a, Object.keys(actions))}`, undefined, "§0", "actions");
        for (const a of Object.keys(obj(c.input.words))) if (!(c.input.actions ?? []).includes(a)) report("error", "word_not_allowed", [...p, "input"], `words 里的动作「${a}」不在 input.actions 里。`, `把「${a}」加进 actions，或删掉这一条。`, "§0", "words");
        const fedToAi = Object.values<any>(entries).some((e) => e?.trigger === "player_input" ? c.type === "text-input" : e?.trigger === `ui:${id}.send` || e?.trigger === `ui:${id}.submit`);
        if (!fedToAi && !Object.keys(obj(c.input.words)).length) report("warning", "input_always_rejected", [...p, "input"], `「${id}」的文字既不交给 AI，也没有关键词 words，玩家输入什么都会得到拒绝回应。`, undefined, "§0");
      }
    }
    if (c.type === "text-input" && c.writes !== undefined) { const d = state[c.writes]; if (!d) report("error", "unknown_state", p, `输入框要写入的状态「${c.writes}」不存在。`, undefined, "§13", "writes"); else if (!(d.writable_by ?? []).includes("ui")) report("error", "not_ui_writable", p, `状态「${c.writes}」不允许界面直接写。`, `在状态里加 writable_by: [rules, ui]。`, "§13", "writes"); }
    for (const k of ["src", "portrait"]) checkRef(p, c[k], "image", "组件", k);
    for (const [k, v] of Object.entries(obj(c.images))) checkRef([...p, "images"], v, "image", "组件图片", k);
    if (c.type === "choice-buttons" && c.from_ai) {
      const targets = Object.values<any>(entries).flatMap((e) => [e?.card?.output?.to, ...Object.values(obj(e?.card?.output?.sections))]);
      if (!targets.includes(`component:${id}`)) report("warning", "choices_no_source", p, `「${id}」写了 from_ai: true，但没有任何 AI 接入点输出到它，按钮会一直是空的。`, `在某个接入点的 output 里写 to: component:${id}（或 sections 的一项指向它），让 AI 每行写一个选项。`, "§13", "from_ai");
      if (!Object.values<any>(comps).some((x) => x?.type === "text-input" && x.input)) report("warning", "choices_no_input", p, `「${id}」的 AI 选项点击后要作为玩家文字提交，但界面里没有带 input 的 text-input。`, "加一个 text-input 并写 input（允许的动作、超界回应）；选项和手打的字走同样的边界检查。", "§13", "from_ai");
    }
    if (c.type === "image" && Array.isArray(c.bind)) report("error", "image_bind", p, "图片组件只能绑定一个状态。", "写成 bind: location（不要用列表）。", "§13", "bind");
    if (c.type === "image" && typeof c.bind === "string" && state[c.bind]?.type === "enum" && c.images) {
      const miss = (state[c.bind].values ?? []).filter((x) => !(x in c.images));
      if (miss.length) report("warning", "image_missing_values", p, `状态「${c.bind}」为 ${listOf(miss)} 时没有对应图片，会显示空白（或 src 默认图）。`, undefined, "§13", "images");
    }
    if (c.generated !== undefined && !(c.generated in images)) report("error", "unknown_image_point", p, `组件要显示的 AI 生图「${c.generated}」没有在 ai.images 里定义。`, undefined, "§10.5", "generated");
    if (c.type === "image" && c.src === undefined && c.bind === undefined && c.generated === undefined) report("error", "image_no_source", p, "图片组件没有图片来源。", "写 src、bind + images，或 generated。", "§13");
  }

  // 背景、声音
  const bg = (s.ui as any)?.theme?.background;
  if (typeof bg === "string") checkRef(["ui", "theme"], bg, "image", "背景", "background");
  else if (bg && typeof bg === "object") {
    if (!(bg.bind in state)) report("error", "unknown_state", ["ui", "theme", "background"], `背景绑定的状态「${bg.bind}」不存在。`, undefined, "§13", "bind");
    for (const [k, v] of Object.entries(obj(bg.images))) checkRef(["ui", "theme", "background", "images"], v, "image", "背景", k);
    checkRef(["ui", "theme", "background"], bg.default, "image", "默认背景", "default");
  }
  const sound = obj((s.ui as any)?.sound);
  const music = obj(sound.music);
  checkRef(["ui", "sound", "music"], music.src, "audio", "背景音乐", "src");
  if (music.bind !== undefined && !(music.bind in state)) report("error", "unknown_state", ["ui", "sound", "music"], `背景音乐绑定的状态「${music.bind}」不存在。`, undefined, "§13", "bind");
  for (const [k, v] of Object.entries(obj(music.tracks))) checkRef(["ui", "sound", "music", "tracks"], v, "audio", "背景音乐", k);
  for (const [k, v] of Object.entries(obj(sound.effects))) {
    checkRef(["ui", "sound", "effects"], v, "audio", "音效", k);
    const [kind, id] = k.split(":");
    if (kind === "action" && !(id in actions)) report("error", "unknown_action", ["ui", "sound", "effects"], `音效绑定的动作「${id}」不存在。`, undefined, "§13", k);
    if (kind === "ending" && !endingIds.includes(id)) report("error", "unknown_ending", ["ui", "sound", "effects"], `音效绑定的结局「${id}」不存在。`, undefined, "§13", k);
    if (kind === "event" && !eventIds.has(id) && !emitted.has(id)) report("error", "unknown_event", ["ui", "sound", "effects"], `音效绑定的事件「${id}」不存在。`, undefined, "§13", k);
  }

  // AI 生图
  for (const [id, ip] of Object.entries<any>(images)) {
    const p = ["ai", "images", id];
    if (typeof ip?.trigger === "string") {
      const [k, v] = ip.trigger.split(":");
      if (k === "state" && !(v in state)) report("error", "unknown_state", p, `生图触发用的状态「${v}」不存在。`, undefined, "§10.5", "trigger");
      if (k === "action" && !(v in actions)) report("error", "unknown_action", p, `生图触发用的动作「${v}」不存在。`, undefined, "§10.5", "trigger");
      if (k === "event" && !eventIds.has(v) && !emitted.has(v)) report("error", "unknown_event", p, `生图触发用的事件「${v}」不存在。`, undefined, "§10.5", "trigger");
    }
    for (const sid of Array.isArray(ip?.cache?.by_state) ? ip.cache.by_state : []) if (!(sid in state)) report("error", "unknown_state", [...p, "cache"], `缓存依据的状态「${sid}」不存在。`, undefined, "§10.5", "by_state");
    if (ip?.fallback && ip.fallback !== "none") checkRef(p, ip.fallback, "image", "生图失败时的替代图", "fallback");
    if (ip?.fallback === undefined) report("warning", "image_no_fallback", p, "没写 fallback：生图失败或玩家关闭生图时，这里将不显示图片。", "写 fallback: asset:某张自带图片，或 fallback: none 表示确认只显示文字。", "§10.5");
    for (const m of String(ip?.prompt ?? "").matchAll(/\{\{\s*state\.([a-z0-9_]+)\s*\}\}/g)) if (!(m[1] in state)) report("error", "unknown_state", p, `生图提示词里的 {{state.${m[1]}}} 引用了不存在的状态。`, undefined, "§10.5", "prompt");
    if (!Object.values<any>(comps).some((c) => c?.generated === id) && !(typeof bg === "object")) report("warning", "image_unused", p, `AI 生图「${id}」没有任何图片组件显示它（组件里写 generated: ${id}）。`, undefined, "§10.5");
  }

  // 未使用的动作（定时器调用的也算用到）
  for (const t of Object.values<any>((s as any).realtime?.timers ?? {})) if (typeof t?.action === "string") usedActions.add(t.action);
  for (const id of actionIds) if (!usedActions.has(id) && !(Array.isArray(actions[id]?.callable_by) && actions[id].callable_by.includes("player") && !s.ui?.components))
    if (!usedActions.has(id)) report("info", "unused_action", ["actions", id], `动作「${id}」没有被任何工具、组件或步骤用到，玩家和 AI 都触发不了它。`, "如果是要给 AI 用，在 tools 里注册；给玩家用，就放一个按钮。", "§6.2");
  // 无 AI 且无组件
  if (!Object.keys(entries).length && !(s as any).realtime && !Object.values<any>(comps).some((c) => ["button", "choice-buttons"].includes(c?.type)))
    report("warning", "no_way_to_play", [], "这是一个没有 AI 的故事，但界面里没有按钮或选项，玩家没办法操作。", "加 button 或 choice-buttons 组件，或者加一个 AI 接入点。", "§13");
}

/** 生成可以直接贴给 AI 的修改请求 */
export function aiFixRequest(res: ValidationResult, max = 30): string {
  const errs = res.issues.filter((i) => i.level !== "info").slice(0, max);
  if (!errs.length) return "";
  const lines = errs.map((i, n) => `${n + 1}. [${i.level === "error" ? "错误" : "警告"}] ${i.file}${i.line ? ` 第 ${i.line} 行` : ""}（${i.where}）：${i.message}${i.fix ? ` 建议：${i.fix}` : ""}${i.ref ? `（规范 ${i.ref}）` : ""}`);
  return [
    "我的“我的绿洲”故事包导入时，客户端校验器报了下面这些问题。请严格按照 Oasis Story Format v0.3 规范逐条修正，",
    "其他内容保持不变，然后重新输出完整的 story.yaml（以及需要改动的其他文件），并附自检结果。",
    "",
    ...lines,
  ].join("\n");
}

/** 终端/界面用的友好格式 */
export function formatIssues(res: ValidationResult): string {
  if (!res.issues.length) return "✅ 检查通过，没有发现问题。";
  const icon = { error: "❌", warning: "⚠️ ", info: "💡" };
  const out = res.issues.map((i) => `${icon[i.level]} ${i.file}${i.line ? ` 第 ${i.line} 行` : ""}（${i.where}）\n   ${i.message}${i.fix ? `\n   👉 ${i.fix}` : ""}${i.ref ? `（规范 ${i.ref}）` : ""}`);
  const e = res.issues.filter((i) => i.level === "error").length, w = res.issues.filter((i) => i.level === "warning").length;
  out.push("", e ? `共 ${e} 个错误、${w} 个警告。错误改完才能导入。` : `✅ 可以导入（${w} 个警告建议处理）。`);
  return out.join("\n");
}

/** 补齐可省略的部分：没有状态、没有结局的故事也能直接交给引擎 */
export function normalizeStory<T extends Story>(s: T): T {
  const st: any = s ?? {};
  return { ...st, state: st.state ?? {}, endings: { ...(st.endings ?? {}), list: Array.isArray(st.endings?.list) ? st.endings.list : [] } };
}

/** oasis/0.4：实时循环、输入、画布的引用检查（只查格式与引用是否存在，不限制玩法） */
function realtimeChecks(s: Story, files: StoryFiles, report: Report) {
  const obj = (x: any) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  const v04 = s.spec === "oasis/0.4";
  const comps = obj(s.ui?.components), actions = obj(s.actions), entries = obj(s.ai?.entry_points);
  const need04 = (path: (string | number)[], what: string) => { if (!v04) report("error", "needs_0_4", path, `${what}是 oasis/0.4 的功能。`, "把第一行改成 spec: oasis/0.4（0.3 的内容不用改）。", "§1"); };
  const ref = (path: (string | number)[], key: string, r: unknown) => {
    if (typeof r !== "string") return;
    const [file, fn] = r.split("#");
    if (!fn) report("error", "script_ref", path, `脚本写法「${r}」不对。`, "写成 文件路径#函数名，例如 scripts/game.js#tick。", "§6.2", key);
    else if (!files.has(file)) report("error", "missing_file", path, `脚本文件「${file}」不在故事包里。`, undefined, "§12", key);
  };
  if (s.realtime) {
    need04(["realtime"], "实时循环 realtime ");
    const rt: any = s.realtime;
    ref(["realtime"], "on_tick", rt.on_tick); ref(["realtime"], "on_ai", rt.on_ai); ref(["realtime"], "on_resize", rt.on_resize);
    for (const [id, t] of Object.entries<any>(obj(rt.timers))) {
      const p = ["realtime", "timers", id];
      if (!t?.action && !t?.emit && !t?.script) report("error", "timer_body", p, `定时器「${id}」没写到点后做什么。`, "写 action、emit 或 script 中的至少一个。", "§14");
      if (t?.action && !(t.action in actions)) report("error", "unknown_action", p, `定时器要执行的动作「${t.action}」不存在。`, undefined, "§14", "action");
      ref(p, "script", t?.script);
    }
    if (!rt.on_tick && !Object.keys(obj(rt.timers)).length) report("warning", "realtime_empty", ["realtime"], "写了 realtime，但没有 on_tick 也没有定时器，循环里什么都不会发生。", undefined, "§14");
  }
  if (s.input) need04(["input"], "输入映射 input ");
  if ((s.ui as any)?.takeover) {
    need04(["ui"], "接管整个页面 ui.takeover ");
    if (typeof (s.input as any)?.keys?.Escape === "string") report("warning", "takeover_escape", ["input", "keys"], "Escape 键可以绑定，但长按 1 秒总会打开客户端的暂停菜单（玩家的出口，故事关不掉）。", "短按 Esc 仍会传给故事；不要让“长按 Esc”成为玩法的一部分。", "§10.8");
  }
  for (const [id, c] of Object.entries<any>(comps)) {
    if (c?.type !== "canvas") continue;
    const p = ["ui", "components", id];
    need04(p, "画布组件 canvas ");
    if (!c.render) report("error", "canvas_no_render", p, `画布「${id}」没有 render 函数，不知道画什么。`, "写 render: scripts/game.js#draw。", "§14");
    ref(p, "render", c.render);
    if (c.size === "fill" && (c.width || c.height)) report("warning", "canvas_fill_size", p, `画布「${id}」是 size: fill，写的 width/height 不会生效。`, "铺满时用 render 里的 api.params.width / height。", "§10.8");
    if (c.hidpi && c.size !== "fill") report("warning", "canvas_hidpi", p, `画布「${id}」的 hidpi 只在 size: fill 时生效。`, undefined, "§10.8");
  }
  for (const [id, e] of Object.entries<any>(entries)) if (e?.trigger === "script") need04(["ai", "entry_points", id], "由脚本调用的 AI 接入点（trigger: script）");
  for (const [id, d] of Object.entries<any>(obj(s.state))) if (d?.type === "json") need04(["state", id], "json 类型的状态");
}
