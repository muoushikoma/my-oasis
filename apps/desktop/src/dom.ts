export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) (e as any)[k.toLowerCase()] = v;
    else if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
export function toast(msg: string, kind: "ok" | "err" = "ok") {
  const t = h("div", { class: `toast ${kind}` }, msg); document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}
export const fmtVal = (v: any) => Array.isArray(v) ? (v.length ? v.join("、") : "无") : typeof v === "boolean" ? (v ? "是" : "否") : v && typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k}:${x}`).join("、") : String(v ?? "");
