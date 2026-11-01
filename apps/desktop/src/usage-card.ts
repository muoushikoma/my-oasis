// 设置页和游玩暂停菜单共用的“AI 用量”卡片
import { h, toast } from "./dom";
import { loadSettings, tr } from "./settings";
import { loadUsage, resetUsage, fmtTokens, fmtCost, loadPrices, savePrices, priceKey, defaultPrice, type Price } from "./usage";

// ---------- AI 用量（只在本机） ----------
export function usageCard(refresh: () => void) {
  const s = loadSettings(); const u = loadUsage();
  const key = priceKey(s.provider, s.model);
  const p: Price = loadPrices()[key] ?? defaultPrice(s.provider) ?? { currency: "¥" };
  const num = (v?: number) => (v === undefined ? "" : String(v));
  const inIn = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "未设置", value: num(p.input) }) as HTMLInputElement;
  const inOut = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "未设置", value: num(p.output) }) as HTMLInputElement;
  const cur = h("select", {}, ...["¥", "$"].map((c) => h("option", { value: c, selected: p.currency === c }, c === "¥" ? "人民币 ¥" : "美元 $"))) as HTMLSelectElement;
  const savePrice = () => {
    const all = loadPrices(); const f = (x: string) => (x.trim() === "" ? undefined : Math.max(0, Number(x)));
    const np: Price = { input: f(inIn.value), output: f(inOut.value), currency: cur.value };
    if (np.input === undefined && np.output === undefined) delete all[key]; else all[key] = np;
    savePrices(all); toast("单价已保存（只影响之后的记录）");
  };
  const stories = Object.entries(u.stories).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));
  const line = (label: string, t: any) => h("div", { class: "usage-row" }, h("b", {}, label), h("span", {}, fmtTokens(t)), h("span", { class: "muted" }, fmtCost(t)));
  return h("section", { class: "card" }, h("h3", {}, "AI 用量"),
    h("p", { class: "small muted" }, "每次 AI 回话用了多少 token 都记在这台设备上，不会上传。服务商没返回用量时按文字长度估算，会标“估算”。费用只是按你填的单价粗算，实际以服务商账单为准。"),
    line("全部累计", u.total),
    h("p", { class: "small muted" }, `从 ${new Date(u.since).toLocaleDateString("zh-CN")} 开始统计，共 ${u.total.calls} 次 AI 调用`),
    stories.length ? h("details", {}, h("summary", {}, "按故事查看"),
      ...stories.map(([id, t]) => h("div", { class: "usage-row" }, h("b", {}, tr(t.title) || id), h("span", {}, fmtTokens(t)), h("span", { class: "muted" }, fmtCost(t)),
        h("button", { class: "small", onclick: () => { if (confirm(`清零《${tr(t.title) || id}》的用量？`)) { resetUsage(id); refresh(); } } }, "清零")))) : null,
    h("h4", {}, `单价（当前模型：${s.model || "未选择"}）`),
    h("p", { class: "small muted" }, "单位：每 100 万 token 多少钱。默认不预填（各家价格常变、还分档），请照服务商官网价格表自己填；本机模型（Ollama / LM Studio）默认按 0 计算。留空就只记 token 不算钱。"),
    h("div", { class: "row wrap" }, h("label", {}, "输入 ", inIn), h("label", {}, "输出 ", inOut), cur, h("button", { onclick: savePrice }, "保存单价")),
    h("div", { class: "row" }, h("button", { onclick: () => { if (confirm("把所有 AI 用量记录清零？")) { resetUsage(); refresh(); } } }, "全部清零")));
}

