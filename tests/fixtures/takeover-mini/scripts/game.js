// 位置用 0~1 的比例存，屏幕多大都能画；尺寸变化时 on_resize 记下新的宽高
export function resize(api) {
  api.state.set("view", { width: api.params.width, height: api.params.height });
}
export function tick(api) {
  const d = api.state.get("dot"), i = api.input, s = 0.5 * api.dt / 1000;
  if (i.held.left) d.x -= s; if (i.held.right) d.x += s; if (i.held.up) d.y -= s; if (i.held.down) d.y += s;
  if (i.pointer.down) { const sc = api.screen; if (sc.width) { d.x = i.pointer.x / sc.width; d.y = i.pointer.y / sc.height; } }
  d.x = Math.max(0, Math.min(1, d.x)); d.y = Math.max(0, Math.min(1, d.y));
  api.state.set("dot", d);
}
export function draw(api) {
  const w = api.params.width, h = api.params.height, d = api.state.get("dot");
  api.draw.clear("#101826");
  api.draw.circle(d.x * w, d.y * h, Math.min(w, h) * 0.05, "#4fd1a5");
  api.draw.text(`${w}×${h}`, 8, 8, { size: Math.max(12, h * 0.03), color: "#fff8" });
}
