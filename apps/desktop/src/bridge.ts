// 本地能力桥：在 Tauri 客户端里走 Rust 命令；在浏览器开发模式下用浏览器存储模拟（仅供开发自测）。
import { filesFromZip, type StoryFiles } from "@my-oasis/schema";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface SaveInfo { slot: string; modified_ms?: number; size?: number }
export interface ProviderCfg { base_url: string; model: string }
export interface ChatOut { content: string | null; tool_calls: any[] }
export interface Picked { name: string; files: StoryFiles }

const enc = new TextEncoder(), dec = new TextDecoder();
export const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export function bytesToB64(b: Uint8Array) { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }

/** 把选中的东西（.oasis/.zip、story.yaml/json、文件夹）变成故事文件表 */
export function filesFromSingle(name: string, data: Uint8Array): StoryFiles {
  const n = name.toLowerCase();
  if (n.endsWith(".yaml") || n.endsWith(".yml")) return new Map([["story.yaml", data]]);
  if (n.endsWith(".json")) return new Map([["story.json", data]]);
  return filesFromZip(data);
}

async function tauri() {
  const core = await import("@tauri-apps/api/core");
  const dialog = await import("@tauri-apps/plugin-dialog");
  return { invoke: core.invoke, Channel: core.Channel, dialog };
}

// ---------- 浏览器开发模式用的小型 IndexedDB ----------
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open("my-oasis-dev", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function kv<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => { const q = f(db.transaction("kv", mode).objectStore("kv")); q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error); });
}
const kvGet = <T>(k: string) => kv<T>("readonly", (s) => s.get(k));
const kvSet = (k: string, v: any) => kv("readwrite", (s) => s.put(v, k));
const kvDel = (k: string) => kv("readwrite", (s) => s.delete(k));
const kvKeys = () => kv<string[]>("readonly", (s) => s.getAllKeys());

function pickFileInBrowser(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const i = document.createElement("input"); i.type = "file"; i.accept = accept;
    i.onchange = () => res(i.files?.[0] ?? null); i.click();
  });
}

export const bridge = {
  async libraryList(): Promise<string[]> {
    if (isTauri) { const t = await tauri(); return t.invoke("library_list"); }
    return (await kvKeys()).filter((k) => k.startsWith("lib:")).map((k) => k.slice(4));
  },
  async libraryPut(id: string, zip: Uint8Array) {
    if (isTauri) { const t = await tauri(); return t.invoke("library_put", { id, base64: bytesToB64(zip) }); }
    await kvSet("lib:" + id, zip);
  },
  async libraryGet(id: string): Promise<Uint8Array> {
    if (isTauri) { const t = await tauri(); return b64ToBytes(await t.invoke<string>("library_get", { id })); }
    const v = await kvGet<Uint8Array>("lib:" + id); if (!v) throw new Error("故事不存在"); return v;
  },
  async libraryDelete(id: string) {
    if (isTauri) { const t = await tauri(); return t.invoke("library_delete", { id }); }
    await kvDel("lib:" + id);
  },
  async saveWrite(story: string, slot: string, json: string) {
    if (isTauri) { const t = await tauri(); return t.invoke("save_write", { story, slot, json }); }
    await kvSet(`save:${story}:${slot}`, { json, modified_ms: Date.now() });
  },
  async saveRead(story: string, slot: string): Promise<string> {
    if (isTauri) { const t = await tauri(); return t.invoke("save_read", { story, slot }); }
    const v = await kvGet<any>(`save:${story}:${slot}`); if (!v) throw new Error("存档不存在"); return v.json;
  },
  async saveList(story: string): Promise<SaveInfo[]> {
    if (isTauri) { const t = await tauri(); return t.invoke("save_list", { story }); }
    const out: SaveInfo[] = [];
    for (const k of await kvKeys()) if (k.startsWith(`save:${story}:`)) { const v = await kvGet<any>(k); out.push({ slot: k.split(":")[2], modified_ms: v.modified_ms, size: v.json.length }); }
    return out;
  },
  async saveDelete(story: string, slot: string) {
    if (isTauri) { const t = await tauri(); return t.invoke("save_delete", { story, slot }); }
    await kvDel(`save:${story}:${slot}`);
  },
  /** 选择故事包：文件（.oasis/.zip/story.yaml）或文件夹 */
  async pickPackage(folder = false): Promise<Picked | null> {
    if (isTauri) {
      const t = await tauri();
      const p = await t.dialog.open(folder ? { directory: true } : { filters: [{ name: "故事包", extensions: ["oasis", "zip", "yaml", "yml", "json"] }] });
      if (!p || Array.isArray(p)) return null;
      const raw: any = await t.invoke("read_package", { path: p });
      if (raw.kind === "folder") return { name: raw.name, files: new Map(raw.files.map((f: any) => [f.path, b64ToBytes(f.base64)])) };
      return { name: raw.name, files: filesFromSingle(raw.name, b64ToBytes(raw.base64)) };
    }
    const f = await pickFileInBrowser(".oasis,.zip,.yaml,.yml,.json");
    if (!f) return null;
    return { name: f.name, files: filesFromSingle(f.name, new Uint8Array(await f.arrayBuffer())) };
  },
  async exportText(suggested: string, text: string): Promise<boolean> {
    if (isTauri) {
      const t = await tauri();
      const p = await t.dialog.save({ defaultPath: suggested, filters: [{ name: "存档", extensions: ["json"] }] });
      if (!p) return false; await t.invoke("export_text", { path: p, contents: text }); return true;
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = suggested; a.click(); return true;
  },
  async importText(): Promise<string | null> {
    if (isTauri) {
      const t = await tauri();
      const p = await t.dialog.open({ filters: [{ name: "存档", extensions: ["json"] }] });
      if (!p || Array.isArray(p)) return null; return t.invoke("import_text", { path: p });
    }
    const f = await pickFileInBrowser(".json"); return f ? f.text() : null;
  },
  // ---------- Key：前端只能存、查、删，拿不到原文 ----------
  async keySet(provider: string, key: string) {
    if (isTauri) { const t = await tauri(); return t.invoke("key_set", { providerId: provider, key }); }
    sessionStorage.setItem("devkey:" + provider, key); // 开发模式：只存在本次浏览器会话
  },
  async keyHas(provider: string): Promise<boolean> {
    if (isTauri) { const t = await tauri(); return t.invoke("key_has", { providerId: provider }); }
    return !!sessionStorage.getItem("devkey:" + provider);
  },
  async keyDelete(provider: string) {
    if (isTauri) { const t = await tauri(); return t.invoke("key_delete", { providerId: provider }); }
    sessionStorage.removeItem("devkey:" + provider);
  },
  /** 让 Rust 代发模型请求（流式） */
  async chat(provider: string, config: ProviderCfg, body: any, onText?: (s: string) => void): Promise<ChatOut> {
    if (isTauri) {
      const t = await tauri();
      const ch = new t.Channel<string>(); ch.onmessage = (s) => onText?.(s);
      return t.invoke("llm_chat", { args: { provider_id: provider, config, body, first_token_timeout_ms: 20000 }, onText: ch });
    }
    const key = sessionStorage.getItem("devkey:" + provider);
    const r = await fetch(config.base_url.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ ...body, model: config.model, stream: false }),
    });
    if (!r.ok) throw new Error(r.status === 401 ? "Key 不对或已失效" : `模型服务返回 ${r.status}`);
    const j = await r.json(); const m = j.choices?.[0]?.message ?? {};
    if (m.content) onText?.(m.content);
    return { content: m.content ?? null, tool_calls: m.tool_calls ?? [] };
  },
};
export { enc, dec };
