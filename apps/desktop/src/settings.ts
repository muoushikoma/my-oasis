// 玩家设置：只含外观、模型选择和开关，不含任何规则；API Key 不在这里（在系统钥匙串）。
export interface Provider { id: string; name: string; base_url: string; model: string; needsKey: boolean; note?: string }
export const PROVIDERS: Provider[] = [
  { id: "openai", name: "OpenAI", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", needsKey: true },
  { id: "openrouter", name: "OpenRouter", base_url: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", needsKey: true },
  { id: "deepseek", name: "DeepSeek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", needsKey: true },
  { id: "ollama", name: "Ollama（本机）", base_url: "http://localhost:11434/v1", model: "qwen2.5:7b", needsKey: false, note: "先在电脑上安装并运行 Ollama" },
  { id: "lmstudio", name: "LM Studio（本机）", base_url: "http://localhost:1234/v1", model: "local-model", needsKey: false, note: "在 LM Studio 里打开“本地服务器”" },
  { id: "custom", name: "自定义（OpenAI 兼容）", base_url: "https://", model: "", needsKey: true },
];
export interface Settings {
  provider: string; base_url: string; model: string;
  theme: "story" | "light" | "dark" | "sepia"; fontSize: number;
  music: number; sfx: number; muted: boolean; imageGen: boolean; merge: boolean;
  disabledEntries: Record<string, string[]>; hidden: Record<string, string[]>;
}
const DEF: Settings = { provider: "openai", base_url: PROVIDERS[0].base_url, model: PROVIDERS[0].model, theme: "story", fontSize: 16, music: 0.6, sfx: 0.8, muted: false, imageGen: false, merge: true, disabledEntries: {}, hidden: {} };
export function loadSettings(): Settings { try { return { ...DEF, ...JSON.parse(localStorage.getItem("oasis.settings") ?? "{}") }; } catch { return { ...DEF }; } }
export function saveSettings(s: Settings) { localStorage.setItem("oasis.settings", JSON.stringify(s)); }
export const isLocalUrl = (u: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
