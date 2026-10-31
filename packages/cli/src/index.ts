#!/usr/bin/env -S npx tsx
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, env, exit } from "node:process";
import { validateFiles, formatIssues, aiFixRequest, type Story, type StoryFiles } from "@my-oasis/schema";
import { loadFromPath } from "@my-oasis/schema/node";
import { Game, runEntry, entriesFor, openAiCompatible, createQuickJsRunner, type LLM } from "@my-oasis/engine";

const HELP = `用法：
  oasis validate <故事文件夹 | .oasis | story.yaml> [--ai-fix]   检查故事包；--ai-fix 额外输出可以贴给 AI 的修改请求
  oasis play <故事> [--seed 数字] [--no-ai]                      文字版试玩

试玩时接 AI（OpenAI 兼容接口），用环境变量配置，Key 不会写进任何文件：
  OASIS_API_KEY   （或 OPENAI_API_KEY）
  OASIS_BASE_URL  默认 https://api.openai.com/v1；OpenRouter 用 https://openrouter.ai/api/v1；Ollama 用 http://localhost:11434/v1
  OASIS_MODEL     默认 gpt-4o-mini`;

function opt(name: string) { const i = argv.indexOf(name); return i > 0 ? argv[i + 1] : undefined; }
function load(p: string): { files: StoryFiles; res: ReturnType<typeof validateFiles> } {
  if (!p || !existsSync(p)) { console.error(`找不到「${p ?? ""}」。`); exit(2); }
  let files: StoryFiles;
  try { files = loadFromPath(p); } catch (e: any) { console.error(`读取失败：${e.message}`); exit(2); }
  return { files, res: validateFiles(files) };
}

async function main() {
  const [cmd, target] = argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help") { console.log(HELP); return; }
  if (cmd === "validate") {
    const { res } = load(target);
    console.log(formatIssues(res));
    if (argv.includes("--ai-fix") && !res.ok) console.log("\n———— 复制下面这段给 AI ————\n" + aiFixRequest(res));
    exit(res.ok ? 0 : 1);
  }
  if (cmd === "play") return play(target);
  console.error(`不认识的命令「${cmd}」。\n\n${HELP}`); exit(2);
}

async function play(target: string) {
  const { files, res } = load(target);
  if (!res.ok) { console.log(formatIssues(res)); console.log("\n故事有错误，不能试玩。可用 `oasis validate --ai-fix` 生成给 AI 的修改请求。"); exit(1); }
  if (res.issues.length) console.log(formatIssues(res) + "\n");
  const story = res.story as Story;
  const seed = opt("--seed") !== undefined ? Number(opt("--seed")) : undefined;
  const scripts = await createQuickJsRunner();
  let game = new Game(story, { seed, files, scripts });
  const key = env.OASIS_API_KEY ?? env.OPENAI_API_KEY;
  const baseUrl = env.OASIS_BASE_URL ?? "https://api.openai.com/v1";
  const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);
  let llm: LLM | undefined;
  if (story.ai && !argv.includes("--no-ai")) {
    if (key || isLocal) llm = openAiCompatible({ baseUrl, apiKey: key, model: env.OASIS_MODEL ?? "gpt-4o-mini" });
    else console.log("⚠️  这个故事用到 AI，但没有设置 OASIS_API_KEY。AI 部分会跳过（可选部分显示替代文字），你可以用 /do 手动执行动作。\n");
  }
  const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async () => { stdout.write("> "); const r = await lines.next(); if (r.done) return null; if (!stdin.isTTY) stdout.write(r.value + "\n"); return r.value; };
  let shown = 0;
  const flushLog = () => {
    for (const l of game.log.slice(shown)) {
      if (l.kind === "random" || l.kind === "action" || l.kind === "rejected") continue;
      const icon = { rule: "📜", dice: "", event: "✨", ending: "🏁", error: "⚠️ ", violation: "🚫" }[l.kind] ?? "";
      console.log(`  ${icon} ${l.text}`);
    }
    shown = game.log.length;
  };
  const showState = () => {
    const vis = game.visibleState("player");
    console.log("  ── " + Object.entries(vis).map(([k, v]) => `${story.state[k].label ?? k}：${Array.isArray(v) ? (v.length ? v.join("、") : "无") : typeof v === "object" ? JSON.stringify(v) : v}`).join(" ｜ "));
  };
  const comps = story.ui?.components ?? {};
  const menu = () => {
    const items: { label: string; run: () => any }[] = [];
    for (const [cid, c] of Object.entries<any>(comps)) {
      if (c.type === "button" && c.action) items.push({ label: c.label ?? cid, run: () => game.doAction(c.action, c.params ?? {}, "player") });
      if (c.type === "button" && !c.action) items.push({ label: c.label ?? cid, run: () => triggerUi(`ui:${cid}.click`, "") });
      if (c.type === "choice-buttons" && Array.isArray(c.choices)) for (const ch of c.choices) items.push({ label: ch.label, run: () => game.doAction(ch.action, ch.params ?? {}, "player") });
    }
    return items;
  };
  const runAi = async (entryId: string, input: string, event?: any, allowActions?: string[]) => {
    const ep = game.entry(entryId);
    if (!llm) { if (ep.fallback) say(ep.card.output.to, ep.fallback); return; }
    try {
      process.stdout.write("  …AI 思考中\r");
      const clear = () => process.stdout.write("\r" + " ".repeat(20) + "\r");
      const r = await runEntry(game, entryId, llm, input, event, { allowActions }).finally(clear);
      for (const t of r.toolLog) console.log(`  🔧 ${t.tool}(${JSON.stringify(t.args)}) → ${t.result.ok ? "成功" : t.result.error}`);
      flushLog();
      if (r.text) say(r.target, r.text);
      if (r.sections) for (const [k, v] of Object.entries(r.sections)) say(ep.card.output.sections?.[k], v);
      if (r.json) console.log(`  🧾 AI 裁定：${JSON.stringify(r.json)}`);
      if (r.error) console.log(`  ⚠️  ${r.error}`);
    } catch (e: any) {
      console.log(`  ⚠️  AI 请求失败：${e.message}`);
      if (ep.fallback) say(ep.card.output.to, ep.fallback);
    }
  };
  const say = (to: string | undefined, text: string) => {
    const [k, id] = (to ?? "").split(":");
    const who = k === "component" ? (comps[id]?.title ?? id) : "";
    console.log(`\n${who ? `【${who}】` : ""}${text}\n`);
  };
  const triggerUi = async (trig: string, input: string) => { for (const e of entriesFor(game, trig)) await runAi(e, input); };

  console.log(`\n═══ ${story.meta.title} ═══\n${story.meta.summary}\n（输入 /help 查看命令）\n`);
  game.start();
  if (story.start?.intro) console.log(story.start.intro + "\n");
  for (const e of entriesFor(game, "game_start")) { const ep = game.entry(e); if (ep.opening) say(ep.card.output.to, ep.opening); else await runAi(e, ""); }
  flushLog(); showState();

  while (!game.ending) {
    const items = menu();
    if (items.length) console.log(items.map((it, i) => `  [${i + 1}] ${it.label}`).join("  "));
    const raw = await ask();
    if (raw === null) { rl.close(); return; }
    const line = raw.trim();
    if (!line) continue;
    if (line === "/quit" || line === "/q") { rl.close(); return; }
    if (line === "/help") { console.log(`  直接输入文字 = 你的行动（交给 AI 主持）
  数字 = 点对应的按钮
  /do 动作 参数=值 …   直接执行动作（如 /do move to=海滩）
  /say 组件 文字        对 NPC 对话框说话（如 /say keeper_chat 你好）
  /actions /state /log /save 文件 /load 文件 /quit`); continue; }
    if (line === "/state") { showState(); console.log("  （完整）" + JSON.stringify(game.state)); continue; }
    if (line === "/log") { for (const l of game.log.slice(-30)) console.log(`  [回合 ${l.turn}] ${l.kind}: ${l.text}`); continue; }
    if (line === "/actions") { for (const [id, a] of Object.entries(story.actions ?? {})) console.log(`  ${id}${a.label ? `（${a.label}）` : ""} ${Object.keys(a.params ?? {}).map((p) => `${p}=…`).join(" ")}  可由：${(a.callable_by ?? ["player", "ai", "rules"]).join("/")}`); continue; }
    if (line.startsWith("/save ")) { writeFileSync(line.slice(6).trim(), JSON.stringify(game.save(), null, 2)); console.log("  💾 已保存（存档里不含 API Key）"); continue; }
    if (line.startsWith("/load ")) {
      try { const r = Game.load(story, JSON.parse(readFileSync(line.slice(6).trim(), "utf8")), { files, scripts }); game = r.game; shown = game.log.length; r.warnings.forEach((w) => console.log("  ⚠️  " + w)); console.log("  📂 已读档"); showState(); }
      catch (e: any) { console.log("  ⚠️  " + e.message); }
      continue;
    }
    let acted = false;
    if (line.startsWith("/do ")) {
      const [id, ...kv] = line.slice(4).trim().split(/\s+/);
      const params = Object.fromEntries(kv.map((x) => { const [k, ...v] = x.split("="); const s = v.join("="); return [k, /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s]; }));
      const r = game.doAction(id, params, "player");
      if (!r.ok) console.log(`  ✋ ${r.error}`); else { acted = true; if (r.result !== true && r.result !== undefined) console.log(`  → ${JSON.stringify(r.result)}`); }
    } else if (line.startsWith("/say ")) {
      const [, cid, ...rest] = line.split(/\s+/);
      const r = game.playerInput(cid, rest.join(" "), { aiAvailable: !!llm });
      if (r.kind === "rejected") console.log(`  ${r.text}`);
      else if (r.kind === "to_ai") { for (const e of entriesFor(game, `ui:${cid}.send`)) await runAi(e, r.text, undefined, r.allowActions); acted = true; }
      else acted = true;
    } else if (/^\d+$/.test(line) && items[Number(line) - 1]) {
      const r = await items[Number(line) - 1].run();
      if (r && r.ok === false) console.log(`  ✋ ${r.error}`); else acted = true;
    } else {
      const cid = Object.entries<any>(story.ui?.components ?? {}).find(([, c]) => c.type === "text-input" && c.input)?.[0];
      if (!cid) console.log("  这个故事没有开放自由输入，请用上面的按钮数字或 /do。");
      else {
        const r = game.playerInput(cid, line, { aiAvailable: !!llm });
        if (r.kind === "rejected") console.log(`  ${r.text}`);
        else if (r.kind === "to_ai") { for (const e of entriesFor(game, "player_input")) await runAi(e, r.text, undefined, r.allowActions); acted = true; }
        else acted = true;
      }
    }
    if (acted) { flushLog(); if (!game.ending) game.endTurn(); flushLog(); showState(); }
  }
  const end = story.endings.list.find((e) => e.id === game.ending)!;
  for (const e of entriesFor(game, "game_end")) await runAi(e, "");
  console.log(`\n🏁 结局：${end.label}${end.text ? `\n${end.text}` : ""}\n`);
  rl.close();
}

main().catch((e) => { console.error("出错了：" + (e?.message ?? e)); exit(1); });
