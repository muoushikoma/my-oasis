// 玩家设置：只含外观、模型选择和开关，不含任何规则；API Key 不在这里（在系统钥匙串）。
import { PROVIDERS } from "./providers";
import { pickText, type Lang } from "@my-oasis/schema";
export { PROVIDERS };
export interface Settings {
  provider: string; base_url: string; model: string;
  theme: "story" | "light" | "dark" | "sepia"; fontSize: number;
  music: number; sfx: number; muted: boolean; imageGen: boolean; merge: boolean;
  /** 故事显示语言（中文/English）；缺这种语言时用另一种 */ lang: Lang; disabledEntries: Record<string, string[]>; hidden: Record<string, string[]>; onboarded?: boolean;
}
const DEF: Settings = { provider: "deepseek", base_url: PROVIDERS[0].base_url, model: PROVIDERS[0].model, theme: "story", fontSize: 16, music: 0.6, sfx: 0.8, muted: false, imageGen: false, merge: true, lang: (typeof navigator !== "undefined" && !/^zh/i.test(navigator.language ?? "zh") ? "en" : "zh"), disabledEntries: {}, hidden: {} };
export function loadSettings(): Settings { try { return { ...DEF, ...JSON.parse(localStorage.getItem("oasis.settings") ?? "{}") }; } catch { return { ...DEF }; } }
export function saveSettings(s: Settings) { localStorage.setItem("oasis.settings", JSON.stringify(s)); }
/** 按玩家选的语言取故事文字 */
export const tr = (v: unknown) => pickText(v, loadSettings().lang);
/** 客户端自己的界面文字：按玩家选的语言取中文或英文 */
export const t2 = (zh: string, en: string) => (loadSettings().lang === "en" ? en : zh);
export const trList = (v: unknown) => (Array.isArray(v) ? v.map(tr) : []);
export const isLocalUrl = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
