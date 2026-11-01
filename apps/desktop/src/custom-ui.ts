// 自定义组件（ui 组件 type: custom，规范 §13.3）：作者在故事包里自带 HTML/JS/CSS，
// 客户端把它放进无同源权限的沙箱 iframe（sandbox="allow-scripts"），CSP default-src 'none'，不能联网。
// 组件和客户端之间只有 postMessage，协议见 BRIDGE_VERSION；拿不到 Key、令牌、文件、Tauri 命令。
import type { StoryFiles } from "@my-oasis/schema";

/** 桥接协议版本：只做向后兼容的增加；不兼容的改动会换成 oasis-ui/2 */
export const BRIDGE_VERSION = "oasis-ui/1";
/** iframe 内文档自己的 CSP（再叠加客户端的 CSP） */
export const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:";
export const CUSTOM_MAX_BYTES = 8 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml",
  ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".flac": "audio/flac", ".opus": "audio/ogg",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".webm": "video/webm", ".mp4": "video/mp4",
  ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".md": "text/plain",
};
const extOf = (p: string) => (p.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase();
function b64(d: Uint8Array) { let s = ""; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000)); return btoa(s); }
const dec = new TextDecoder();
export function normPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) { if (!seg || seg === ".") continue; if (seg === "..") { if (!out.length) return ""; out.pop(); } else out.push(seg); }
  return out.join("/");
}
const isUrl = (r: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(r);

/** 组件里运行的桥接脚本：提供 window.oasis */
export const BRIDGE_SCRIPT = `(()=>{"use strict";const V=${JSON.stringify(BRIDGE_VERSION)},P=parent,L=new Set(),pend=new Map();let rid=0,ready;
const send=(m)=>P.postMessage(Object.assign({oasis:V},m),"*");
const api={version:V,component:"",state:{},lang:"zh",config:{},ended:false,busy:false,
ready:new Promise(r=>ready=r),
onState(cb){L.add(cb);return()=>L.delete(cb)},
action(id,params){return new Promise(r=>{const n=++rid;pend.set(n,r);send({type:"action",req:n,action:String(id),params:params||{}})})},
emit(event,payload){send({type:"emit",event:String(event),payload:payload===undefined?null:payload})},
resize(height){send({type:"resize",height:Number(height)||0})},
log(...a){send({type:"log",text:a.map(x=>typeof x==="string"?x:JSON.stringify(x)).join(" ").slice(0,500)})}};
addEventListener("message",(e)=>{if(e.source!==P)return;const m=e.data;if(!m||m.oasis!==V)return;
if(m.type==="init"||m.type==="state"){api.state=m.state||{};api.lang=m.lang;api.ended=!!m.ended;api.busy=!!m.busy;
if(m.type==="init"){api.component=m.component;api.config=m.config||{};ready(api)}
const ch=m.changed||Object.keys(api.state);L.forEach(f=>{try{f(api.state,ch)}catch(err){console.error(err)}})}
else if(m.type==="result"){const r=pend.get(m.req);if(r){pend.delete(m.req);r({ok:!!m.ok,error:m.error})}}});
window.oasis=api;send({type:"ready"})})();`;

/** 把组件 HTML 和它引用的包内文件拼成一份独立文档（脚本/样式内联，图片/声音/字体变 data: 地址） */
export function buildFrameHtml(files: StoryFiles, src: string): string {
  const raw = files.get(src); if (!raw) throw new Error(`找不到自定义组件文件 ${src}`);
  const dir = src.includes("/") ? src.slice(0, src.lastIndexOf("/") + 1) : "";
  const get = (ref: string, base = dir) => { if (isUrl(ref)) return undefined; const p = normPath(base + ref.split(/[?#]/)[0]); return p ? files.get(p) : undefined; };
  const dataUrl = (ref: string, base = dir) => { const d = get(ref, base); return d ? `data:${MIME[extOf(ref.split(/[?#]/)[0])] ?? "application/octet-stream"};base64,${b64(d)}` : undefined; };
  const css = (text: string, base: string) => text.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, _q, ref) => { const u = dataUrl(ref, base); return u ? `url("${u}")` : m; });
  const scriptSafe = (t: string) => t.replace(/<\/script/gi, "<\\/script");
  let html = dec.decode(raw);
  html = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a, ref, b) => {
    const d = get(ref); return d ? `<script${a}${b}>${scriptSafe(dec.decode(d))}</script>` : m;
  });
  html = html.replace(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi, (m) => {
    const ref = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m)?.[1]; const d = ref && get(ref);
    if (!ref || !d) return m; const p = normPath(dir + ref); return `<style>${css(dec.decode(d), p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "")}</style>`;
  });
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_m, a, t) => `<style${a}>${css(t, dir)}</style>`);
  html = html.replace(/\b(src|href|poster)\s*=\s*(["'])([^"']+)\2/gi, (m, k, q, ref) => { const u = dataUrl(ref); return u ? `${k}=${q}${u}${q}` : m; });
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><script>${BRIDGE_SCRIPT}</script>`;
  // 放在最前面：CSP 和 window.oasis 在作者的任何代码之前生效
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => m + head);
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

export interface FrameHost {
  /** 玩家可见的状态 */ state(): Record<string, any>;
  lang(): string; ended(): boolean; busy(): boolean;
  action(action: string, params: Record<string, any>): Promise<{ ok: boolean; error?: string }>;
  emit(event: string, payload: unknown): void;
  /** 把文档交给客户端：Tauri 里走自定义协议（独立 CSP 和源），浏览器开发模式用 srcdoc */
  load(iframe: HTMLIFrameElement, html: string): void | Promise<void>;
  log?(text: string): void;
}

/** 一个自定义组件实例：iframe 跨渲染保留（用 moveBefore 移动，不会重新加载） */
export class CustomFrame {
  readonly el: HTMLElement;
  readonly iframe: HTMLIFrameElement;
  private lastSent = ""; private ready = false; private lastAction = 0; private actionsInWindow = 0;
  constructor(readonly cid: string, readonly c: any, files: StoryFiles, private host: FrameHost) {
    this.iframe = document.createElement("iframe");
    this.iframe.setAttribute("sandbox", "allow-scripts");
    this.iframe.setAttribute("referrerpolicy", "no-referrer");
    this.iframe.setAttribute("allow", "");
    this.iframe.setAttribute("title", String(c.label ?? cid));
    this.iframe.className = "custom-frame";
    this.iframe.style.height = `${clampH(c.height ?? 200)}px`;
    this.el = document.createElement("div"); this.el.className = "custom-host"; this.el.append(this.iframe);
    window.addEventListener("message", this.onMsg);
    void host.load(this.iframe, buildFrameHtml(files, c.src));
  }
  private post(m: any) { this.iframe.contentWindow?.postMessage({ oasis: BRIDGE_VERSION, ...m }, "*"); }
  private snapshot() { return { state: this.host.state(), lang: this.host.lang(), ended: this.host.ended(), busy: this.host.busy() }; }
  /** 状态变了就推给组件（只推玩家可见的状态） */
  update() {
    if (!this.ready) return;
    const s = this.snapshot(), j = JSON.stringify(s); if (j === this.lastSent) return;
    const old = this.lastSent ? JSON.parse(this.lastSent).state : {};
    const changed = [...new Set([...Object.keys(old), ...Object.keys(s.state)])].filter((k) => JSON.stringify(old[k]) !== JSON.stringify(s.state[k]));
    this.lastSent = j; this.post({ type: "state", ...s, changed });
  }
  private onMsg = async (e: MessageEvent) => {
    if (e.source !== this.iframe.contentWindow) return;
    const m = e.data; if (!m || typeof m !== "object" || m.oasis !== BRIDGE_VERSION) return;
    switch (m.type) {
      case "ready": { this.ready = true; const s = this.snapshot(); this.lastSent = JSON.stringify(s); this.post({ type: "init", component: this.cid, config: this.c.config ?? {}, ...s }); return; }
      case "action": {
        const reply = (ok: boolean, error?: string) => this.post({ type: "result", req: m.req, ok, error });
        const allowed: string[] = Array.isArray(this.c.actions) ? this.c.actions : [];
        if (typeof m.action !== "string" || !allowed.includes(m.action)) return reply(false, `组件没有声明动作「${String(m.action)}」（写在 actions 里）`);
        // 防刷：每秒最多 20 次
        const now = Date.now(); if (now - this.lastAction > 1000) { this.lastAction = now; this.actionsInWindow = 0; }
        if (++this.actionsInWindow > 20) return reply(false, "操作太频繁");
        const params = m.params && typeof m.params === "object" && !Array.isArray(m.params) ? m.params : {};
        if (JSON.stringify(params).length > 4096) return reply(false, "参数太大");
        try { const r = await this.host.action(m.action, params); reply(r.ok, r.error); } catch (err: any) { reply(false, String(err?.message ?? err)); }
        return;
      }
      case "emit": {
        const allowed: string[] = Array.isArray(this.c.emits) ? this.c.emits : [];
        if (typeof m.event !== "string" || !allowed.includes(m.event)) return this.host.log?.(`自定义组件「${this.cid}」发了没有声明的事件「${String(m.event)}」，已忽略`);
        let payload = m.payload; try { if (JSON.stringify(payload ?? null).length > 2048) payload = null; } catch { payload = null; }
        this.host.emit(m.event, payload); return;
      }
      case "resize": this.iframe.style.height = `${clampH(m.height)}px`; return;
      case "log": this.host.log?.(`[${this.cid}] ${String(m.text).slice(0, 500)}`); return;
    }
  };
  destroy() { window.removeEventListener("message", this.onMsg); this.el.remove(); }
}
const clampH = (h: unknown) => Math.max(40, Math.min(2000, Math.round(Number(h) || 200)));

/** 移动节点时尽量不让 iframe 重新加载（支持 moveBefore 的内核；否则退回普通移动，组件会重新收到 init） */
export function moveInto(parent: Element, child: Element) {
  const p: any = parent;
  if (typeof p.moveBefore === "function" && parent.isConnected && child.isConnected) { try { p.moveBefore(child, null); return; } catch { /* 退回 */ } }
  parent.append(child);
}
