// 手柄（Gamepad API，Windows 上 Xbox/PS 手柄、安卓蓝牙手柄）。按“标准布局”编号：
// Pad0=A/× Pad1=B/○ Pad2=X/□ Pad3=Y/△ Pad4/5=肩键 Pad6/7=扳机 Pad8=选择 Pad9=开始 Pad10/11=摇杆按下 Pad12–15=十字键上下左右 Pad16=主页键
const DEAD = 0.2;
export function pollGamepad(): { buttons: Set<string>; stick: { x: number; y: number } } | undefined {
  const list = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
  const g = [...(list ?? [])].find((x) => x && x.connected); if (!g) return;
  const buttons = new Set<string>();
  g.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) buttons.add(`Pad${i}`); });
  let x = g.axes[0] ?? 0, y = g.axes[1] ?? 0;
  if (Math.hypot(x, y) < DEAD) { x = 0; y = 0; }
  if (!x && !y) { x = (buttons.has("Pad15") ? 1 : 0) - (buttons.has("Pad14") ? 1 : 0); y = (buttons.has("Pad13") ? 1 : 0) - (buttons.has("Pad12") ? 1 : 0); }
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  return { buttons, stick: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } };
}
