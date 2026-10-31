// 把 Rust 代发的模型请求包装成引擎要的 LLM 接口；失败自动重试 1 次；同时进行的请求最多 2 个。
import type { LLM } from "@my-oasis/engine";
import { bridge } from "./bridge";
import type { Settings } from "./settings";

let running = 0; const waiters: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  while (running >= 2) await new Promise<void>((r) => waiters.push(r));
  running++;
  try { return await f(); } finally { running--; waiters.shift()?.(); }
}

export function makeLlm(s: Settings): LLM {
  return {
    chat: (req) => slot(async () => {
      const body: any = { messages: req.messages, temperature: req.temperature };
      if (req.tools?.length) { body.tools = req.tools; body.tool_choice = "auto"; }
      if (req.json && !req.tools?.length) body.response_format = { type: "json_object" };
      let last: any;
      for (let i = 0; i < 2; i++) {
        try {
          const r = await bridge.chat(s.provider, { base_url: s.base_url, model: s.model }, body, req.onText);
          return { content: r.content, tool_calls: r.tool_calls?.length ? r.tool_calls : undefined };
        } catch (e: any) {
          last = e;
          const msg = String(e?.message ?? e);
          if (/Key|401|403|404/.test(msg)) break; // 配置问题，重试没用
          if (body.response_format && i === 0) delete body.response_format; // 有的服务不支持 JSON 模式
        }
      }
      throw last instanceof Error ? last : new Error(String(last));
    }),
  };
}
