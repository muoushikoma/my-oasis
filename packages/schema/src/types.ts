// 故事包（v0.3）的 TypeScript 类型，仅描述常用字段；完整约束见 story.schema.json。
export type Step = Record<string, any>;
export interface StateDef {
  type: "number" | "bool" | "string" | "enum" | "list" | "set" | "map" | "record" | "json";
  init: any; label?: string; desc?: string;
  visible?: "both" | "player" | "ai" | "none";
  writable_by?: ("rules" | "ai" | "ui")[];
  min?: number; max?: number; integer?: boolean; max_length?: number;
  values?: string[]; of?: "number" | "string" | "bool"; max_items?: number;
  fields?: Record<string, "number" | "string" | "bool">;
}
export interface ParamDef { type: "number" | "string" | "bool" | "enum"; values?: string[]; min?: number; max?: number; required?: boolean; desc?: string }
export interface ActionDef {
  label?: string; desc?: string; params?: Record<string, ParamDef>;
  require?: string; require_message?: string; steps?: Step[]; script?: string;
  result?: string; callable_by?: ("player" | "ai" | "rules")[]; cooldown_turns?: number;
}
export interface EventDef { id: string; hook: string; when?: string; do: Step[]; once?: boolean; notify_ai?: string }
export interface EndingDef { id: string; label: string; when?: string; kind?: "good" | "bad" | "neutral"; text?: string }
export interface ToolDef { desc: string; action?: string; query?: string; write?: string }
export type WriteLimit = "any" | { delta: [number, number] } | { range: [number, number] } | { values: any[] } | { add_only: true };
export interface OutputDef {
  format?: "text" | "json" | "sections"; to?: string; max_chars?: number;
  schema?: Record<string, string>; then?: Step[]; sections?: Record<string, string>;
}
export interface CardDef {
  task: string; authority: 0 | 1 | 2 | 3; must?: string[]; forbid?: string[];
  tools?: Record<string, { writes?: Record<string, WriteLimit> }>; output: OutputDef;
}
export interface EntryPointDef {
  kind: "narrate" | "dialogue" | "judge" | "generate"; trigger: string; prompt: string; card: CardDef;
  context?: { state?: string[] | "visible"; history_turns?: number; setting?: boolean };
  temperature?: number; priority?: "critical" | "background"; merge?: boolean;
  optional?: boolean; fallback?: string; after_end?: boolean; opening?: string;
}
export interface AiDef {
  model_hint?: { tier?: string; note?: string }; system?: string;
  rules?: { max_authority?: number; must?: string[]; forbid?: string[]; on_violation?: { retry?: number; tell_ai?: boolean }; max_tool_calls?: number };
  entry_points: Record<string, EntryPointDef>;
}
export interface ComponentDef { type: string; region: string; [k: string]: any }
export interface UiDef {
  theme?: any;
  layout?: { template: "simple" | "two-column" | "stage" | "custom"; grid?: string[]; columns?: string[]; rows?: string[] };
  components?: Record<string, ComponentDef>;
  /** oasis/0.4：故事接管整个客户端页面 */ takeover?: boolean;
}
export interface Story {
  spec: "oasis/0.3" | "oasis/0.4";
  meta: { id: string; title: import("./i18n.js").LocalText; version: string; summary: import("./i18n.js").LocalText; language: string; languages?: string[]; /** 每分钟大约多少 token */ est_tokens_per_min?: number; /** AI 在故事里做什么（一两句） */ ai_role?: import("./i18n.js").LocalText; est_minutes?: number; /** 支持的平台；不写 = 电脑和手机都支持 */ platforms?: ("desktop" | "mobile")[]; tags?: import("./i18n.js").LocalText[]; rating: string; [k: string]: any };
  uses?: string[]; random?: { seed?: "auto" | number }; start?: { intro?: string; do?: Step[] };
  state: Record<string, StateDef>; actions?: Record<string, ActionDef>; events?: EventDef[];
  endings: { check_on?: "state_change" | "turn_end" | "manual"; list: EndingDef[]; script?: string };
  tools?: Record<string, ToolDef>; ai?: AiDef; ui?: UiDef; scripts?: { limits?: { time_ms?: number; memory_mb?: number } };
  realtime?: RealtimeDef; input?: InputDef; assets?: Record<string, { type: "image" | "audio"; path: string; [k: string]: any }>;
}
/** oasis/0.4：实时循环 */
export interface TimerDef { every_ms?: number; after_ms?: number; action?: string; params?: Record<string, any>; emit?: string; script?: string }
export interface RealtimeDef { tick_hz?: number; tick_ms?: number; interpolate?: boolean; on_tick?: string; on_ai?: string; on_resize?: string; on_ui?: string; timers?: Record<string, TimerDef> }
/** oasis/0.4：输入映射。keys：按键（KeyboardEvent.code）→ 输入名 */
export interface InputDef { keys?: Record<string, string>; joystick?: boolean | { side?: "left" | "right" }; buttons?: { id: string; label?: string }[]; pointer?: boolean }
export interface InputState { held: Record<string, boolean>; pressed: Record<string, boolean>; joystick: { x: number; y: number }; pointer: { x: number; y: number; down: boolean; target?: string; wheel?: number; button?: number }; touches?: { id: number; x: number; y: number; target?: string }[] }
export const DEFAULT_MAX_AUTHORITY = 1; // 暂定默认
export const KNOWN_TEMPLATES = ["oasis/dice@1", "oasis/check@1", "oasis/inventory@1", "oasis/clock@1"];
export const TEMPLATE_REGIONS: Record<string, string[]> = {
  simple: ["main", "input", "status"],
  "two-column": ["main", "input", "side"],
  stage: ["top", "main", "input", "side"],
};
export function regionsOf(ui?: UiDef): string[] {
  const l = ui?.layout;
  if (!l || l.template !== "custom") return TEMPLATE_REGIONS[l?.template ?? "simple"];
  return [...new Set((l.grid ?? []).flatMap((r) => r.trim().split(/\s+/)))];
}
