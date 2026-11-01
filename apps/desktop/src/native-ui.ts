// 原生界面层（oasis/0.4）：故事脚本通过 api.textinput / api.video 请求，客户端用真正的 HTML 控件实现。
//  - 文字输入框：系统输入法（中文拼音/手写的“组字”过程）、安卓软键盘都由浏览器内核原生处理；
//  - 全屏视频：<video> 播放包内 webm/mp4。
// 安全：控件只由客户端创建，故事拿不到 DOM，也不能执行 HTML；层级低于“⋯”按钮和暂停菜单，玩家的出口永远可用。
import { h } from "./dom";
import type { UiEffect } from "@my-oasis/engine";

type Txt = string | { zh?: string; en?: string } | undefined;
export interface NativeUiHost {
  lang: "zh" | "en";
  url(assetId: string): string | undefined;
  deliver(res: Record<string, any> & { type: "text" | "video"; request: number; id: string }): void;
  muted(): boolean;
}

export class NativeUi {
  private text?: { el: HTMLElement; req: number; id: string };
  private video?: { el: HTMLElement; v: HTMLVideoElement; req: number; id: string };
  constructor(private host: NativeUiHost, private parent: () => HTMLElement = () => document.body) {}

  private t(x: Txt, zh: string, en: string): string {
    const L = this.host.lang;
    if (typeof x === "string" && x) return x;
    if (x && typeof x === "object") return (x[L] || x.zh || x.en || (L === "en" ? en : zh)) as string;
    return L === "en" ? en : zh;
  }

  /** 正在输入时，游戏键盘映射要让路（realtime 已对 INPUT/TEXTAREA 跳过按键） */
  get typing() { return !!this.text; }

  apply(list: UiEffect[]) {
    for (const u of list) {
      if (u.op === "text.open") this.openText(u);
      else if (u.op === "text.close") this.closeText(true, false);
      else if (u.op === "video.play") this.playVideo(u);
      else if (u.op === "video.stop") this.stopVideo(false, false);
    }
  }

  private openText(u: Extract<UiEffect, { op: "text.open" }>) {
    this.closeText(true, true);
    const field = (u.multiline
      ? h("textarea", { class: "nui-field", rows: 4 })
      : h("input", { class: "nui-field", type: "text", enterkeyhint: "done" })) as HTMLInputElement | HTMLTextAreaElement;
    field.maxLength = u.max_length; field.value = u.value ?? "";
    field.placeholder = this.t(u.placeholder, "", "");
    field.setAttribute("autocomplete", "off"); field.setAttribute("spellcheck", "false");
    const count = h("span", { class: "nui-count" });
    const upd = () => { count.textContent = `${[...field.value].length}/${u.max_length}`; };
    field.addEventListener("input", upd); upd();
    const submit = () => this.closeText(false, false, field.value);
    const cancel = () => this.closeText(true, false);
    field.addEventListener("keydown", (e: Event) => {
      const k = e as KeyboardEvent;
      k.stopPropagation(); // 不让故事的按键映射吃掉打字（长按 Esc 的监听在捕获阶段，不受影响）
      if (k.isComposing || k.keyCode === 229) return; // 输入法正在组字：回车是“选字”，不是提交
      if (k.key === "Enter" && (!u.multiline || k.ctrlKey || k.metaKey)) { k.preventDefault(); submit(); }
      else if (k.key === "Escape" && !k.repeat) { /* 短按 Esc：取消；长按仍会打开暂停菜单 */ setTimeout(() => { if (this.text?.req === u.req) cancel(); }, 0); }
    });
    const title = this.t(u.title, "", "");
    const card = h("form", { class: "nui-card", onsubmit: (e: Event) => { e.preventDefault(); submit(); } },
      title ? h("div", { class: "nui-title" }, title) : null,
      field,
      h("div", { class: "nui-row" }, count,
        h("button", { type: "button", class: "nui-btn ghost", onclick: cancel }, this.t(u.cancel, "取消", "Cancel")),
        h("button", { type: "submit", class: "nui-btn" }, this.t(u.ok, "确定", "OK"))));
    const el = h("div", { class: "nui-layer nui-text" }, card);
    this.parent().append(el);
    this.text = { el, req: u.req, id: u.id };
    // 安卓软键盘弹出时（全屏沉浸模式下窗口不一定缩小），按可见区域把输入框抬到键盘上方
    const vv = (window as any).visualViewport;
    if (vv) { const fit = () => { if (!el.isConnected) { vv.removeEventListener("resize", fit); return; } el.style.bottom = `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`; el.style.top = `${vv.offsetTop}px`; }; vv.addEventListener("resize", fit); fit(); }
    // 聚焦：桌面直接弹出输入法；安卓 WebView 弹出软键盘
    setTimeout(() => { field.focus(); try { field.setSelectionRange(field.value.length, field.value.length); } catch { /* */ } }, 0);
  }
  private closeText(cancelled: boolean, silent: boolean, text = "") {
    const t = this.text; if (!t) return;
    this.text = undefined; t.el.remove();
    if (!silent) this.host.deliver({ type: "text", request: t.req, id: t.id, text: cancelled ? "" : text, cancelled });
  }

  private playVideo(u: Extract<UiEffect, { op: "video.play" }>) {
    this.stopVideo(true, true);
    const src = this.host.url(u.id); if (!src) { this.host.deliver({ type: "video", request: u.req, id: u.id, ended: false, skipped: false, error: "missing" }); return; }
    const v = h("video", { class: "nui-video", playsinline: "", preload: "auto" }) as HTMLVideoElement;
    v.src = src; v.loop = !!u.loop; v.muted = !!u.muted || this.host.muted(); v.style.objectFit = u.fit ?? "contain";
    const skip = u.skippable ? h("button", { class: "nui-skip", onclick: () => this.stopVideo(false, false, true) }, this.host.lang === "en" ? "Skip ›" : "跳过 ›") : null;
    const el = h("div", { class: "nui-layer nui-video-layer" }, v, skip);
    v.onended = () => this.stopVideo(false, false, false, true);
    v.onerror = () => { const cur = this.video; if (cur?.req !== u.req) return; this.video = undefined; el.remove(); this.host.deliver({ type: "video", request: u.req, id: u.id, ended: false, skipped: false, error: "decode" }); };
    this.parent().append(el);
    this.video = { el, v, req: u.req, id: u.id };
    void v.play().catch(() => { v.muted = true; void v.play().catch(() => {}); }); // 自动播放策略：有声被拒就静音播放
  }
  private stopVideo(_replace: boolean, silent: boolean, skipped = false, ended = false) {
    const c = this.video; if (!c) return;
    this.video = undefined; c.v.pause(); c.v.removeAttribute("src"); c.v.load(); c.el.remove();
    if (!silent) this.host.deliver({ type: "video", request: c.req, id: c.id, ended, skipped });
  }
  /** 暂停菜单打开时视频跟着暂停 */
  setPaused(p: boolean) { if (this.video) { if (p) this.video.v.pause(); else void this.video.v.play().catch(() => {}); } }
  dispose() { this.closeText(true, true); this.stopVideo(false, true); }
}
