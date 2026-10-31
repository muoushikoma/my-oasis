import { describe, it, expect } from "vitest";
import { estimateTokens, normalizeUsage, costOf, record, loadUsage, resetUsage, beginSession, sessionUsage, savePrices, priceKey, fmtCost, zero, add } from "../src/usage";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("AI 用量记录", () => {
  it("优先用服务商返回的用量", () => {
    expect(normalizeUsage({ messages: [] }, { content: "x", usage: { input_tokens: 100, output_tokens: 20 } })).toEqual({ input: 100, output: 20, estimated: false });
    expect(normalizeUsage({}, { content: "x", usage: { prompt_tokens: 5, completion_tokens: 6 } })).toEqual({ input: 5, output: 6, estimated: false });
  });
  it("没返回时估算并标记", () => {
    const u = normalizeUsage({ messages: [{ role: "user", content: "你好世界" }] }, { content: "hello world!", usage: null });
    expect(u.estimated).toBe(true);
    expect(u.input).toBe(4); expect(u.output).toBe(3);
    expect(estimateTokens("")).toBe(0);
  });
  it("单价不全不折算；按每百万 token 计算", () => {
    expect(costOf({ input: 1e6, output: 5e5 }, { input: 2, output: 8, currency: "¥" })).toBe(6);
    expect(costOf({ input: 1, output: 1 }, { input: 2, currency: "¥" })).toBeUndefined();
    expect(costOf({ input: 1, output: 1 }, undefined)).toBeUndefined();
  });
  it("不同币种不硬加", () => {
    let t = add(zero(), { input: 1, output: 1, estimated: false }, 1, "¥");
    t = add(t, { input: 1, output: 1, estimated: false }, 1, "$");
    expect(t.cost).toBe(1); expect(t.costUnknownCalls).toBe(1);
  });
  it("本局、按故事、总计都记在本机，可清零", () => {
    const kv = mem();
    savePrices({ [priceKey("deepseek", "m")]: { input: 1, output: 2, currency: "¥" } }, kv);
    beginSession("s1", "故事一");
    record("deepseek", "m", {}, { content: "a", usage: { input_tokens: 1e6, output_tokens: 1e6 } }, kv);
    record("deepseek", "other", {}, { content: "abcd", usage: null }, kv);
    expect(sessionUsage().calls).toBe(2);
    expect(sessionUsage().estimatedCalls).toBe(1);
    expect(fmtCost(sessionUsage())).toBe("约 ¥3.00（部分未设置单价）");
    beginSession("s2");
    expect(sessionUsage().calls).toBe(0);
    record("ollama", "q", {}, { content: "", usage: { input_tokens: 10, output_tokens: 10 } }, kv);
    let st = loadUsage(kv);
    expect(st.total.calls).toBe(3);
    expect(st.stories.s1.title).toBe("故事一");
    expect(st.stories.s2.cost).toBe(0);
    resetUsage("s1", kv); st = loadUsage(kv);
    expect(st.stories.s1).toBeUndefined(); expect(st.total.calls).toBe(1); expect(st.total.input).toBe(10);
    resetUsage(undefined, kv); expect(loadUsage(kv).total.calls).toBe(0);
  });
});
