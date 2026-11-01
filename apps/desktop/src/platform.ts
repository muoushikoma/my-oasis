// 故事支持的平台（meta.platforms）与当前设备判断：客户端只列出、只加载本机能玩的故事。
export type Platform = "desktop" | "mobile";
export const PLATFORMS: Platform[] = ["desktop", "mobile"];
export const PLATFORM_LABEL: Record<Platform, string> = { desktop: "电脑", mobile: "手机" };

/** 故事声明的平台；没写时视为两端都支持（兼容旧故事） */
export function storyPlatforms(meta: any): Platform[] {
  const p = Array.isArray(meta?.platforms) ? meta.platforms.filter((x: any) => PLATFORMS.includes(x)) : [];
  return p.length ? p : [...PLATFORMS];
}
/** 当前设备：安卓壳 / 手机浏览器 / 粗指针小屏 = mobile，其余 = desktop。可用 ?platform=mobile 调试 */
export function currentPlatform(env: { search?: string; ua?: string; android?: boolean; coarseSmall?: boolean } = browserEnv()): Platform {
  const q = /[?&]platform=(desktop|mobile)\b/.exec(env.search ?? "");
  if (q) return q[1] as Platform;
  if (env.android || /Android|iPhone|iPad|iPod|Mobile/i.test(env.ua ?? "") || env.coarseSmall) return "mobile";
  return "desktop";
}
function browserEnv() {
  if (typeof window === "undefined") return {};
  return { search: location.search, ua: navigator.userAgent, android: !!(window as any).OasisAndroid,
    coarseSmall: !!window.matchMedia?.("(pointer: coarse) and (max-width: 900px)").matches };
}
export const playableHere = (meta: any, here: Platform = currentPlatform()) => storyPlatforms(meta).includes(here);
export const platformText = (meta: any) => storyPlatforms(meta).map((p) => PLATFORM_LABEL[p]).join(" / ");
/** 屏幕虚拟摇杆/按钮：auto（默认）= 只在手机上显示；on = 总是显示；off = 不显示 */
export type VirtualControls = "auto" | "on" | "off";
export const showVirtualControls = (mode: VirtualControls | undefined, here: Platform) => mode === "on" ? true : mode === "off" ? false : here === "mobile";
