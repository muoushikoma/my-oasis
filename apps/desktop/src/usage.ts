// AI 用量（token）记录：只存在本机（localStorage），从不上传。
// 分三档：本局（当前这次游玩，退出即清零）、按故事累计、全部累计；可以手动清零。
// 服务商没返回用量时按文字长度估算，并标“估算”。

export interface Tokens { input: number; output: number; calls: number; estimatedCalls: number; cost: number; costUnknownCalls: number; currency?: string }
export interface UsageStore { total: Tokens; stories: Record<string, Tokens & { title?: string }>; since: string }
/** 单价：每 100 万 token 多少钱。留空（undefined）表示不知道，不折算。 */
export interface Price { input?: number; output?: number; currency: string }
export type PriceTable = Record<string, Price>; // 键："服务商id/模型名"

export const zero = (): Tokens => ({ input: 0, output: 0, calls: 0, estimatedCalls: 0, cost: 0, costUnknownCalls: 0 });

/** 粗略估算 token：中日韩文字约 1 字 1 token，其余约 4 个字符 1 token。只用于服务商没给用量时。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0, other = 0;
  for (const ch of text) { if (/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch)) cjk++; else other++; }
  return Math.ceil(cjk + other / 4);
}

/** 统一一次调用的用量：优先用服务商返回的；没有就按请求和回复文字估算 */
export function normalizeUsage(body: any, out: { content?: string | null; tool_calls?: any[]; usage?: any }): { input: number; output: number; estimated: boolean } {
  const u = out.usage;
  const i = u?.input_tokens ?? u?.prompt_tokens; const o = u?.output_tokens ?? u?.completion_tokens;
  if (typeof i === "number" || typeof o === "number") return { input: i ?? 0, output: o ?? 0, estimated: false };
  const inText = (body?.messages ?? []).map((m: any) => typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")).join("\n")
    + (body?.tools ? JSON.stringify(body.tools) : "");
  const outText = (out.content ?? "") + (out.tool_calls ?? []).map((t: any) => t?.function?.arguments ?? "").join("");
  return { input: estimateTokens(inText), output: estimateTokens(outText), estimated: true };
}

/** 按单价折算这次花了多少钱；单价不全返回 undefined */
export function costOf(t: { input: number; output: number }, p?: Price): number | undefined {
  if (!p || p.input === undefined || p.output === undefined || isNaN(p.input) || isNaN(p.output)) return undefined;
  return (t.input * p.input + t.output * p.output) / 1e6;
}

export function add(a: Tokens, u: { input: number; output: number; estimated: boolean }, cost: number | undefined, currency?: string): Tokens {
  const r = { ...a, input: a.input + u.input, output: a.output + u.output, calls: a.calls + 1, estimatedCalls: a.estimatedCalls + (u.estimated ? 1 : 0) };
  if (cost === undefined) r.costUnknownCalls++;
  else if (!r.currency || r.currency === currency) { r.cost += cost; r.currency = currency; }
  else r.costUnknownCalls++; // 不同币种不硬加，算作“未折算”
  return r;
}

// 默认单价：故意不预填付费模型的价格（各家常调价、分档复杂），只把明确免费的本机模型记为 0。
// 玩家可在“设置 → AI 用量”里按服务商官网价格自己填。
export function defaultPrice(provider: string): Price | undefined {
  if (provider === "ollama" || provider === "lmstudio") return { input: 0, output: 0, currency: "¥" };
  return undefined;
}

// ---------- 本机存储 ----------
const KEY = "oasis.usage", PKEY = "oasis.prices";
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const ls = (): KV | undefined => (typeof localStorage !== "undefined" ? localStorage : undefined);

export function loadUsage(kv = ls()): UsageStore {
  try { const j = JSON.parse(kv?.getItem(KEY) ?? ""); if (j?.total) return { stories: {}, since: new Date().toISOString(), ...j, total: { ...zero(), ...j.total } }; } catch { /* 新建 */ }
  return { total: zero(), stories: {}, since: new Date().toISOString() };
}
export function saveUsage(u: UsageStore, kv = ls()) { kv?.setItem(KEY, JSON.stringify(u)); }
export function loadPrices(kv = ls()): PriceTable { try { return JSON.parse(kv?.getItem(PKEY) ?? "{}") ?? {}; } catch { return {}; } }
export function savePrices(p: PriceTable, kv = ls()) { kv?.setItem(PKEY, JSON.stringify(p)); }
export const priceKey = (provider: string, model: string) => `${provider}/${model}`;
export function priceFor(provider: string, model: string, kv = ls()): Price | undefined {
  return loadPrices(kv)[priceKey(provider, model)] ?? defaultPrice(provider);
}

// ---------- 当前归属（哪一局 / 哪个故事） ----------
let current: { storyId: string; title?: string } = { storyId: "_create" };
let session: Tokens = zero();
const listeners = new Set<() => void>();
/** 开始一局：本局清零，之后的调用记到这个故事 */
export function beginSession(storyId: string, title?: string) { current = { storyId, title }; session = zero(); }
/** 离开游玩（创作区、测试连接等）：记到“其他”里 */
export function endSession() { current = { storyId: "_create", title: "创作区与测试连接" }; session = zero(); }
export const sessionUsage = () => session;
export function onUsage(f: () => void) { listeners.add(f); return () => listeners.delete(f); }

/** 每次 AI 调用结束后调用 */
export function record(provider: string, model: string, body: any, out: any, kv = ls()) {
  const u = normalizeUsage(body, out);
  const p = priceFor(provider, model, kv);
  const c = costOf(u, p);
  session = add(session, u, c, p?.currency);
  const st = loadUsage(kv);
  st.total = add(st.total, u, c, p?.currency);
  const prev = st.stories[current.storyId] ?? zero();
  st.stories[current.storyId] = { ...add(prev, u, c, p?.currency), title: current.title ?? (prev as any).title };
  saveUsage(st, kv);
  listeners.forEach((f) => f());
  return u;
}
export function resetUsage(storyId?: string, kv = ls()) {
  if (!storyId) { saveUsage({ total: zero(), stories: {}, since: new Date().toISOString() }, kv); session = zero(); return; }
  const st = loadUsage(kv); const s = st.stories[storyId];
  if (s) {
    const t = st.total, m = (a: number, b: number) => Math.max(0, a - b);
    st.total = { ...t, input: m(t.input, s.input), output: m(t.output, s.output), calls: m(t.calls, s.calls), estimatedCalls: m(t.estimatedCalls, s.estimatedCalls),
      costUnknownCalls: m(t.costUnknownCalls, s.costUnknownCalls), cost: t.currency === s.currency ? m(t.cost, s.cost) : t.cost };
    delete st.stories[storyId]; saveUsage(st, kv);
  }
}

// ---------- 显示 ----------
export const fmtNum = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(2) + " 百万" : n >= 1e4 ? (n / 1e4).toFixed(1) + " 万" : String(n);
export function fmtTokens(t: Tokens): string {
  const s = `${fmtNum(t.input + t.output)} tokens（输入 ${fmtNum(t.input)} / 输出 ${fmtNum(t.output)}）`;
  return t.estimatedCalls ? s + (t.estimatedCalls === t.calls ? "·估算" : "·部分估算") : s;
}
export function fmtCost(t: Tokens): string {
  if (!t.calls) return "";
  if (t.costUnknownCalls === t.calls) return "费用：未设置单价";
  const v = t.cost < 0.01 && t.cost > 0 ? t.cost.toFixed(4) : t.cost.toFixed(2);
  return `约 ${t.currency ?? ""}${v}` + (t.costUnknownCalls ? "（部分未设置单价）" : "");
}
