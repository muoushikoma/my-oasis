// 故事自己摆放的屏幕控件（input.controls）：按钮、摇杆、十字键。
// 只是客户端生成的普通控件，故事给的是数据（位置、大小、文字、图片素材 id），不能写 HTML。
// 层级在画面之上、在“⋯”出口按钮和暂停菜单之下，所以盖不住玩家的出口。
import { h } from "./dom";
import type { ControlDef, InputState } from "@my-oasis/schema";

const ANCHOR: Record<string, [number, number]> = {
  top_left: [0, 0], top: [0.5, 0], top_right: [1, 0], left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  bottom_left: [0, 1], bottom: [0.5, 1], bottom_right: [1, 1],
};
const len = (v: number | string | undefined, d: number) => (typeof v === "number" ? `${v}px` : typeof v === "string" && /^-?\d+(\.\d+)?%$/.test(v) ? v : `${d}px`);

export function buildControls(defs: ControlDef[], lang: "zh" | "en", input: InputState, url: (assetId: string) => string | undefined) {
  const layer = h("div", { class: "rt-ctl-layer" });
  const items = new Map<string, HTMLElement>();
  const offs: (() => void)[] = [];
  let firstStick: string | undefined;
  for (const d of defs.slice(0, 16)) {
    const size = Math.max(24, Math.min(320, d.size ?? (d.type === "button" ? 64 : 128)));
    const [ax, ay] = ANCHOR[d.anchor ?? (d.type === "button" ? "bottom_right" : "bottom_left")] ?? [0.5, 1];
    const el = h("div", { class: `rt-ctl rt-ctl-${d.type} ${d.shape === "rect" ? "rect" : "round"}${d.show === "always" ? "" : " touch-only"}`, "data-ctl": d.id });
    const st = el.style;
    st.width = st.height = `${size}px`;
    // 锚点决定贴哪条边；x/y 是相对锚点的偏移（向右、向下为正；也可以写百分比）
    const dx = len(d.x, ax === 0 ? 16 : ax === 1 ? -16 : 0), dy = len(d.y, ay === 0 ? 16 : ay === 1 ? -16 : 0);
    st.left = `calc(${ax * 100}% + ${dx} - ${ax * size}px)`; st.top = `calc(${ay * 100}% + ${dy} - ${ay * size}px)`;
    if (d.opacity !== undefined) st.opacity = String(d.opacity);
    if (d.color && /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\)|[a-z]{3,20})$/.test(d.color)) st.setProperty("--ctl", d.color);
    const img = d.image ? url(d.image) : undefined, pimg = d.pressed_image ? url(d.pressed_image) : undefined;
    if (img) { st.backgroundImage = `url("${img}")`; el.classList.add("has-img"); }
    const label = typeof d.label === "string" ? d.label : d.label ? (d.label[lang] || d.label.zh || d.label.en || "") : "";
    const setPressed = (on: boolean) => { el.classList.toggle("on", on); if (pimg) st.backgroundImage = `url("${on ? pimg : img ?? ""}")`; };
    if (d.type === "button") {
      if (label) el.append(h("span", {}, label));
      el.onpointerdown = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); if (!input.held[d.id]) input.pressed[d.id] = true; input.held[d.id] = true; setPressed(true); };
      el.onpointerup = el.onpointercancel = () => { delete input.held[d.id]; setPressed(false); };
    } else if (d.type === "joystick") {
      firstStick ??= d.id;
      const knob = h("div", { class: "rt-ctl-knob" }); el.append(knob);
      const set = (e: PointerEvent | null) => {
        let x = 0, y = 0;
        if (e) { const r = el.getBoundingClientRect(), R = r.width / 2; x = (e.clientX - r.left - R) / R; y = (e.clientY - r.top - R) / R; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } }
        const v = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
        input.sticks = { ...(input.sticks ?? {}), [d.id]: v };
        if (d.id === firstStick) input.joystick = v;
        knob.style.transform = e ? `translate(${x * size * 0.3}px, ${y * size * 0.3}px)` : "";
        setPressed(!!e);
      };
      el.onpointerdown = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); set(e); };
      el.onpointermove = (e) => { if (el.classList.contains("on")) set(e); };
      el.onpointerup = el.onpointercancel = () => set(null);
    } else {
      // 十字键：按住时 held 里出现 <id>_up / _down / _left / _right（斜方向两个同时出现）
      for (const k of ["up", "down", "left", "right"]) el.append(h("i", { class: `rt-ctl-arrow ${k}` }));
      const dirs = ["up", "down", "left", "right"].map((k) => `${d.id}_${k}`);
      const set = (e: PointerEvent | null) => {
        const on = new Set<string>();
        if (e) {
          const r = el.getBoundingClientRect(), R = r.width / 2, x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
          if (y < -0.35) on.add(dirs[0]); if (y > 0.35) on.add(dirs[1]); if (x < -0.35) on.add(dirs[2]); if (x > 0.35) on.add(dirs[3]);
        }
        for (const k of dirs) { if (on.has(k)) { if (!input.held[k]) input.pressed[k] = true; input.held[k] = true; } else delete input.held[k]; }
        setPressed(on.size > 0);
      };
      el.onpointerdown = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); set(e); };
      el.onpointermove = (e) => { if (e.buttons || e.pointerType === "touch") set(e); };
      el.onpointerup = el.onpointercancel = () => set(null);
    }
    el.oncontextmenu = (e) => e.preventDefault();
    if (d.hidden) el.hidden = true;
    items.set(d.id, el); layer.append(el);
  }
  return {
    el: layer,
    /** api.controls.show(ids)：只显示这些控件；null = 全部显示。隐藏的控件同时松开 */
    show(ids: string[] | null) {
      for (const [id, el] of items) {
        const vis = ids === null || ids.includes(id);
        if (!vis && !el.hidden) { el.dispatchEvent(new Event("pointercancel")); delete input.held[id]; }
        el.hidden = !vis;
      }
    },
    dispose() { offs.forEach((f) => f()); layer.remove(); },
  };
}
