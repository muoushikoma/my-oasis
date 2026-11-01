// 故事卡片上的关键信息：语言、AI 做什么、时长、每分钟 token（作者估计 + 你的实测）、平台、标签、内容提示
import { h } from "./dom";
import { metaLanguages, langName, fmtTokensPerMin } from "@my-oasis/schema";
import { tr } from "./settings";
import { platformText } from "./platform";
import { measuredPerMin } from "./usage";


/** meta 可以是故事的 meta，也可以是在线目录里的一条（字段同名） */
export function storyInfo(meta: any, storyId?: string): HTMLElement {
  const m = meta ?? {};
  const langs = Array.isArray(m.languages) && m.languages.length ? m.languages.map(String) : metaLanguages(m);
  const mine = storyId ? measuredPerMin(storyId) : undefined;
  const chips: string[] = [];
  if (langs.length) chips.push(`🌐 ${langs.map((l: string) => langName(l)).join(" / ")}`);
  if (m.est_minutes) chips.push(`⏱ 约 ${m.est_minutes} 分钟`);
  if (m.est_tokens_per_min) chips.push(`🔢 ${fmtTokensPerMin(m.est_tokens_per_min)}（作者估计）`);
  if (mine) chips.push(`📈 你的实测 ${fmtTokensPerMin(mine)}`);
  chips.push(`💻 ${platformText(m)}`);
  const tags = Array.isArray(m.tags) ? m.tags.map(tr).filter(Boolean) : [];
  const warns = Array.isArray(m.content_warnings) ? m.content_warnings.map(tr).filter(Boolean) : [];
  return h("div", { class: "story-meta" },
    m.ai_role ? h("p", { class: "small" }, `🤖 AI：${tr(m.ai_role)}`) : null,
    h("p", { class: "small muted" }, chips.join(" · ")),
    tags.length ? h("p", { class: "small muted" }, tags.map((t: string) => `#${t}`).join(" ")) : null,
    warns.length ? h("p", { class: "small warn" }, `⚠️ 内容提示：${warns.join("、")}`) : null);
}

/** 长介绍 meta.description：按纯文本显示（空行分段，# 开头当小标题，- 开头当列表），不解析 HTML */
export function descriptionEl(v: any): HTMLElement | null {
  const text = tr(v).trim(); if (!text) return null;
  const box = h("div", { class: "story-desc" });
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l: string) => l.trimEnd());
    if (lines.every((l: string) => /^\s*[-*] /.test(l))) box.append(h("ul", {}, ...lines.map((l: string) => h("li", {}, l.replace(/^\s*[-*] /, "")))));
    else if (/^#{1,6} /.test(lines[0]) && lines.length === 1) box.append(h("h4", {}, lines[0].replace(/^#+ /, "")));
    else box.append(h("p", {}, lines.join("\n")));
  }
  return box;
}

/** 列表里的卡片：只有封面、名称、标签、简介；点一下打开详情 */
export function briefCard(cover: HTMLElement, title: string, meta: any, open: () => void, badge?: HTMLElement | null): HTMLElement {
  const tags = Array.isArray(meta?.tags) ? meta.tags.map(tr).filter(Boolean) : [];
  const el = h("div", { class: "story-card clickable", tabindex: "0", role: "button", onclick: open, onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } },
    cover,
    h("div", { class: "info" },
      h("h3", {}, title, badge ?? null),
      tags.length ? h("p", { class: "small muted" }, tags.map((t: string) => `#${t}`).join(" ")) : null,
      h("p", { class: "muted brief" }, tr(meta?.summary))));
  return el;
}

/** 详情：简介、长介绍、AI 做什么、语言、时长、token、平台、内容提示、作者、版本，以及操作按钮 */
export function openDetail(o: { title: string; cover?: HTMLElement; meta: any; storyId?: string; lines?: (string | null | undefined)[]; buttons: HTMLElement[]; notice?: HTMLElement | null }) {
  const close = () => { m.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  const m = h("div", { class: "modal", onclick: (e: Event) => e.target === m && close() },
    h("div", { class: "card story-detail" },
      h("div", { class: "row" }, h("h2", { style: { flex: "1", margin: "0" } }, o.title), h("button", { onclick: close, title: "关闭" }, "✕")),
      o.cover ?? null,
      h("p", {}, tr(o.meta?.summary)),
      descriptionEl(o.meta?.description),
      storyInfo(o.meta, o.storyId),
      ...(o.lines ?? []).filter(Boolean).map((l) => h("p", { class: "small muted" }, l as string)),
      o.notice ?? null,
      h("div", { class: "row" }, ...o.buttons)));
  document.addEventListener("keydown", esc);
  document.body.append(m);
  return close;
}
