// 故事接管整个页面（ui.takeover）时的客户端部分：全屏/沉浸、玩家永远可用的出口（故事关不掉）。
// 出口有三种，任何一种都会打开客户端自己的暂停菜单：
//   1. 桌面：按住 Esc 1 秒（短按 Esc 仍交给故事）；
//   2. 安卓：系统返回键 / 返回手势；
//   3. 右上角的小按钮（平时几乎透明，动一下鼠标或摸一下屏幕就显出来）。
// 这些监听都挂在 window 的捕获阶段、按钮放在最顶层，故事脚本在沙箱里，碰不到 DOM，无法拦截或遮住它们。
import { h } from "./dom";
import { isTauri } from "./bridge";

export const ESC_HOLD_MS = 1000;

/** 安卓壳（MainActivity.kt）注入的接口；桌面和浏览器里没有 */
interface AndroidShell { setImmersive(on: boolean): void }
const android = (): AndroidShell | undefined => (window as any).OasisAndroid;

async function tauriWindow() {
  if (!isTauri) return undefined;
  try { const { getCurrentWindow } = await import("@tauri-apps/api/window"); return getCurrentWindow(); } catch { return undefined; }
}

/** 真全屏（桌面 F11 / 菜单里切换）；安卓用沉浸模式 */
export async function setFullscreen(on: boolean) {
  const a = android(); if (a) { try { a.setImmersive(on); } catch { /* 旧版安卓壳 */ } return; }
  const w = await tauriWindow();
  if (w) { try { await w.setFullscreen(on); return; } catch { /* 没权限时退回到网页全屏 */ } }
  try { if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.(); else if (!on && document.fullscreenElement) await document.exitFullscreen?.(); } catch { /* 浏览器拒绝 */ }
}
export async function isFullscreen(): Promise<boolean> {
  const w = await tauriWindow();
  if (w) { try { return await w.isFullscreen(); } catch { /* ignore */ } }
  return !!document.fullscreenElement;
}

export interface TakeoverHooks { openMenu(): void; menuOpen(): boolean }

/** 进入接管：返回退出函数（恢复窗口、移除监听） */
export function enterTakeover(hooks: TakeoverHooks): { corner: HTMLElement; exit: () => void } {
  const off: (() => void)[] = [];
  let wasFull = false;
  void isFullscreen().then((f) => (wasFull = f));
  // 安卓：进入时就沉浸全屏（隐藏状态栏和导航栏），退出时恢复
  if (android()) void setFullscreen(true);

  // 1. 长按 Esc
  let escTimer: any = 0;
  const kd = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.repeat && !escTimer) escTimer = setTimeout(() => { escTimer = 0; if (!hooks.menuOpen()) hooks.openMenu(); }, ESC_HOLD_MS);
    if (e.key === "F11") { e.preventDefault(); e.stopImmediatePropagation(); void isFullscreen().then((f) => setFullscreen(!f)); }
  };
  const ku = (e: KeyboardEvent) => { if (e.key === "Escape") { clearTimeout(escTimer); escTimer = 0; } };
  window.addEventListener("keydown", kd, true); window.addEventListener("keyup", ku, true);
  off.push(() => { window.removeEventListener("keydown", kd, true); window.removeEventListener("keyup", ku, true); clearTimeout(escTimer); });

  // 2. 安卓返回键（安卓壳在沉浸时把返回键转成这个事件）
  const back = () => { if (!hooks.menuOpen()) hooks.openMenu(); };
  window.addEventListener("oasis-back", back);
  off.push(() => window.removeEventListener("oasis-back", back));

  // 3. 角落按钮：动一下才显出来，3 秒后又变淡
  const corner = h("button", { class: "takeover-exit", title: "暂停菜单（也可以按住 Esc 1 秒 / 安卓返回键）", "aria-label": "暂停菜单", onclick: (e: Event) => { e.stopPropagation(); hooks.openMenu(); } }, "⋯");
  let hideT: any = 0;
  const wake = () => { corner.classList.add("show"); clearTimeout(hideT); hideT = setTimeout(() => corner.classList.remove("show"), 3000); };
  window.addEventListener("pointermove", wake, true); window.addEventListener("pointerdown", wake, true);
  off.push(() => { window.removeEventListener("pointermove", wake, true); window.removeEventListener("pointerdown", wake, true); clearTimeout(hideT); });
  wake();

  return { corner, exit: () => { off.forEach((f) => f()); if (android()) void setFullscreen(false); else if (!wasFull) void setFullscreen(false); } };
}
