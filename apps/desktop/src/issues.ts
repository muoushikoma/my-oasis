import type { Issue, ValidationResult } from "@my-oasis/schema";
import { aiFixRequest } from "@my-oasis/schema";
import { h, toast } from "./dom";
export function issueCard(i: Issue) {
  return h("div", { class: `issue ${i.level}` },
    h("div", { class: "issue-head" }, h("span", { class: "lv" }, i.level === "error" ? "错误" : i.level === "warning" ? "提醒" : "说明"),
      h("b", {}, `${i.file}${i.line ? ` 第 ${i.line} 行` : ""}`), i.where ? h("span", { class: "muted" }, `（${i.where}）`) : null),
    h("p", {}, i.message), i.fix ? h("p", { class: "fix" }, `👉 ${i.fix}`) : null, i.ref ? h("p", { class: "small muted" }, `规范 ${i.ref}`) : null);
}
export async function copyText(t: string, ok = "已复制") {
  try { await navigator.clipboard.writeText(t); toast(ok); } catch { toast("复制失败，请手动选中文字复制", "err"); }
}
/** 报错列表 + “复制给 AI 修改” */
export function issuesView(res: ValidationResult) {
  const errs = res.issues.filter((i) => i.level === "error").length, warns = res.issues.length - errs, fix = aiFixRequest(res);
  return h("div", {},
    h("p", {}, !res.issues.length ? "✅ 检查通过，没有发现问题。" : errs ? `发现 ${errs} 个错误${warns ? `、${warns} 条提醒` : ""}。错误改完才能导入和试玩。` : `有 ${warns} 条提醒，不影响游玩。`),
    fix ? h("div", { class: "row" }, h("button", { class: "primary", onclick: () => copyText(fix, "已复制，粘贴给 AI 让它修改即可") }, "复制给 AI 修改")) : null,
    h("div", { class: "issues" }, ...res.issues.map(issueCard)),
    fix ? h("details", {}, h("summary", {}, "要复制给 AI 的文字"), h("pre", { class: "fixreq" }, fix)) : null);
}
