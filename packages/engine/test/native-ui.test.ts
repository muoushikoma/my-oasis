import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const strToU8 = (s: string) => new TextEncoder().encode(s);
import { validateFiles, type Story, type StoryFiles } from "@my-oasis/schema";
import { Game, createQuickJsRunner, type ScriptRunner } from "../src/index.js";

const dir = new URL("../../../tests/fixtures/realtime-mini/", import.meta.url).pathname;
function loadDir(d: string): StoryFiles {
  const m: StoryFiles = new Map();
  const walk = (p: string, rel: string) => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) walk(f, rel + n + "/"); else m.set(rel + n, new Uint8Array(readFileSync(f))); } };
  walk(d, ""); return m;
}
let runner: ScriptRunner;
beforeAll(async () => { runner = await createQuickJsRunner({ timeScale: 1000 }); });

function build(extraScript: string, patch: (y: string) => string) {
  const files = loadDir(dir);
  files.set("story.yaml", strToU8(patch(new TextDecoder().decode(files.get("story.yaml")!))));
  files.set("scripts/ui.js", strToU8(extraScript));
  files.set("assets/intro.webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
  const r = validateFiles(files);
  if (!r.ok) throw new Error(JSON.stringify(r.issues.filter((i) => i.level === "error")));
  const g = new Game(r.story as Story, { seed: 1, files, scripts: runner }); g.start(); return g;
}
const script = `
export function ask(api) { api.textinput.open({ id: "name", placeholder: { zh: "名字", en: "Name" }, max_length: 8, multiline: false }); }
export function film(api) { api.video.play("intro", { skippable: true }); }
export function onUi(api) { const p = api.params; if (p.type === "text" && !p.cancelled) api.state.set("comment", p.text); if (p.type === "video") api.state.set("comment", p.skipped ? "skip" : "end"); }
`;
const patch = (y: string) => y
  .replace("  on_ai: scripts/game.js#onAi", "  on_ai: scripts/game.js#onAi\n  on_ui: scripts/ui.js#onUi")
  .replace("actions:\n", "actions:\n  ask: { script: scripts/ui.js#ask }\n  film: { script: scripts/ui.js#film }\n")
  .replace("assets:\n", "assets:\n  intro: { type: video, path: assets/intro.webm, use: other }\n");

describe("原生界面：输入框和视频", () => {
  it("api.textinput.open 产生输入框请求，结果交给 on_ui（截断到 2000 字）", () => {
    const g = build(script, patch);
    expect(g.doAction("ask", {}, "rules").ok).toBe(true);
    const fx = g.takeEffects();
    expect(fx.ui).toHaveLength(1);
    const u: any = fx.ui[0];
    expect(u).toMatchObject({ op: "text.open", id: "name", max_length: 8, multiline: false });
    g.deliverUi({ type: "text", request: u.req, id: "name", text: "小雪", cancelled: false });
    expect(g.state.comment).toBe("小雪");
  });
  it("api.video.play 只接受登记过的视频素材", () => {
    const g = build(script, patch);
    expect(g.doAction("film", {}, "rules").ok).toBe(true);
    const u: any = g.takeEffects().ui[0];
    expect(u).toMatchObject({ op: "video.play", id: "intro", skippable: true });
    g.deliverUi({ type: "video", request: u.req, id: "intro", ended: false, skipped: true });
    expect(g.state.comment).toBe("skip");
    const bad = build(`export function film(api) { api.video.play("pickup"); }`, patch);
    expect(bad.doAction("film", {}, "rules").ok).toBe(false);
  });
});
