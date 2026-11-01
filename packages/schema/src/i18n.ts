// 中英双语：玩家可见文字可以写成普通字符串，或 { zh: "...", en: "..." }。
export type Lang = "zh" | "en";
export type LocalText = string | { zh?: string; en?: string };
export const LANGS: Lang[] = ["zh", "en"];

export function isLocalText(v: unknown): v is { zh?: string; en?: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const ks = Object.keys(v);
  return ks.length > 0 && ks.every((k) => (k === "zh" || k === "en") && typeof (v as any)[k] === "string");
}
/** 取某种语言的文字；缺这种语言就用另一种 */
export function pickText(v: unknown, lang: Lang = "zh"): string {
  if (typeof v === "string") return v;
  if (isLocalText(v)) return v[lang] ?? v[lang === "zh" ? "en" : "zh"] ?? "";
  return v == null ? "" : String(v);
}
/** 这段文字缺哪些语言（普通字符串视为只有一种语言，返回 null 表示无法判断） */
export function missingLangs(v: unknown): Lang[] | null {
  if (isLocalText(v)) return LANGS.filter((l) => !v[l]?.trim());
  return null;
}

/** 故事里所有玩家可见文字字段的位置（用于本地化与检查） */
const TEXT_KEYS: Record<string, string[]> = {
  meta: ["title", "summary"], start: ["intro"], state: ["label", "desc"], param: ["desc"],
  action: ["label", "desc", "require_message"], ending: ["label", "text"], entry: ["fallback", "opening"],
  asset: ["alt"], image: ["alt"], component: ["label", "placeholder", "title", "text"],
};
/** 遍历所有玩家可见文字：fn(路径, 值) 返回替换值 */
export function mapStoryTexts(story: any, fn: (path: string, v: unknown) => unknown): any {
  const s = structuredClone(story ?? {});
  const on = (o: any, keys: string[], p: string) => { if (o && typeof o === "object") for (const k of keys) if (o[k] !== undefined) o[k] = fn(`${p}.${k}`, o[k]); };
  const arr = (o: any, k: string, p: string) => { if (Array.isArray(o?.[k])) o[k] = o[k].map((x: unknown, i: number) => fn(`${p}.${k}[${i}]`, x)); };
  on(s.meta, TEXT_KEYS.meta, "meta"); arr(s.meta, "tags", "meta"); arr(s.meta, "content_warnings", "meta");
  on(s.start, TEXT_KEYS.start, "start");
  for (const [k, d] of Object.entries<any>(s.state ?? {})) on(d, TEXT_KEYS.state, `state.${k}`);
  for (const [k, a] of Object.entries<any>(s.actions ?? {})) {
    on(a, TEXT_KEYS.action, `actions.${k}`);
    for (const [pk, pd] of Object.entries<any>(a?.params ?? {})) on(pd, TEXT_KEYS.param, `actions.${k}.params.${pk}`);
    walkSteps(a?.steps, `actions.${k}.steps`, fn);
  }
  for (const [i, e] of (s.events ?? []).entries?.() ?? []) walkSteps(e?.do, `events[${i}].do`, fn);
  walkSteps(s.start?.do, "start.do", fn);
  for (const [i, e] of (s.endings?.list ?? []).entries?.() ?? []) on(e, TEXT_KEYS.ending, `endings.list[${i}]`);
  for (const [k, e] of Object.entries<any>(s.ai?.entry_points ?? {})) on(e, TEXT_KEYS.entry, `ai.entry_points.${k}`);
  for (const [k, e] of Object.entries<any>(s.ai?.images ?? {})) on(e, TEXT_KEYS.image, `ai.images.${k}`);
  for (const [k, a] of Object.entries<any>(s.assets ?? {})) on(a, TEXT_KEYS.asset, `assets.${k}`);
  for (const [k, c] of Object.entries<any>(s.ui?.components ?? {})) {
    on(c, TEXT_KEYS.component, `ui.components.${k}`);
    (c?.choices ?? []).forEach((ch: any, i: number) => on(ch, ["label"], `ui.components.${k}.choices[${i}]`));
    on(c?.input, ["reject"], `ui.components.${k}.input`);
  }
  (s.input?.buttons ?? []).forEach((b: any, i: number) => on(b, ["label"], `input.buttons[${i}]`));
  return s;
}
function walkSteps(steps: any, p: string, fn: (path: string, v: unknown) => unknown) {
  if (!Array.isArray(steps)) return;
  steps.forEach((st, i) => {
    if (!st || typeof st !== "object") return;
    if (st.fail !== undefined) st.fail = fn(`${p}[${i}].fail`, st.fail);
    walkSteps(st.then, `${p}[${i}].then`, fn); walkSteps(st.else, `${p}[${i}].else`, fn);
  });
}
/** 把双语故事变成某一种语言的普通故事（缺的语言用另一种补） */
export function localizeStory<T>(story: T, lang: Lang = "zh"): T {
  return mapStoryTexts(story, (_p, v) => (isLocalText(v) ? pickText(v, lang) : v));
}
/** 故事支持哪些语言：meta.languages，否则按 meta.language 推断 */
export function storyLangs(story: any): Lang[] {
  const l = story?.meta?.languages;
  if (Array.isArray(l) && l.length) return l.filter((x: any) => x === "zh" || x === "en");
  return [String(story?.meta?.language ?? "zh").startsWith("en") ? "en" : "zh"];
}

/** 公开故事库（投稿）的额外要求；本地导入不受限。与 tools/stories/validate.mjs 保持一致。 */
export function libraryProblems(story: any): string[] {
  const m = story?.meta ?? {}; const out: string[] = [];
  const both = (v: unknown) => isLocalText(v) && !!v.zh?.trim() && !!v.en?.trim();
  if (!both(m.title)) out.push("故事名称 meta.title 要同时写中文和英文，例如 title: { zh: 雨夜书店, en: Rainy Bookshop }");
  if (!both(m.summary)) out.push("简介 meta.summary 要同时写中文和英文：summary: { zh: …, en: … }");
  if (!Array.isArray(m.tags) || m.tags.length !== 3) out.push(`标签 meta.tags 必须正好 3 个（现在 ${Array.isArray(m.tags) ? m.tags.length : 0} 个）`);
  else m.tags.forEach((t: unknown, i: number) => { if (!both(t)) out.push(`第 ${i + 1} 个标签要同时写中文和英文：{ zh: 悬疑, en: Mystery }`); });
  if (m.rating !== "all-ages") out.push(`故事库只收全年龄（rating: all-ages）的故事（现在是 "${m.rating ?? ""}"）`);
  return out;
}
/** 投稿时的提醒（不拦截）：其他玩家可见文字缺某种语言 */
export function libraryWarnings(story: any): string[] {
  const out: string[] = [];
  mapStoryTexts(story, (p, v) => {
    if (p === "meta.title" || p === "meta.summary" || p.startsWith("meta.tags")) return v;
    const miss = missingLangs(v);
    if (miss === null && typeof v === "string" && v.trim()) out.push(`${p} 只有一种语言`);
    else if (miss?.length) out.push(`${p} 缺少 ${miss.join("、")}`);
    return v;
  });
  return out;
}
