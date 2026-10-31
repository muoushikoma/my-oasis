// 《星星收集者》：oasis/0.4 实时示例。世界 30×22 格，每格 16 像素；画布 320×240，相机跟随主角。
const T = 16, W = 30, H = 22;
const wall = (cx, cy) => cx <= 0 || cy <= 0 || cx >= W - 1 || cy >= H - 1 || (cy === 8 && cx > 4 && cx < 14) || (cx === 20 && cy > 4 && cy < 16);
const MAP = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (wall(x, y) ? 1 : 0)));
const blocked = (x, y) => wall(Math.floor(x / T), Math.floor(y / T));

export function spawn(api) {
  const stars = api.state.get("stars");
  if (stars.length >= 6) return;
  for (let i = 0; i < 20; i++) {
    const x = api.random.int(1, W - 2) * T + 8, y = api.random.int(1, H - 2) * T + 8;
    if (!blocked(x, y)) { stars.push({ x, y }); break; }
  }
  api.state.set("stars", stars);
}

export function tick(api) {
  const inp = api.input, dt = api.dt / 1000, hero = api.state.get("hero");
  let dx = (inp.held.right ? 1 : 0) - (inp.held.left ? 1 : 0) + inp.joystick.x;
  let dy = (inp.held.down ? 1 : 0) - (inp.held.up ? 1 : 0) + inp.joystick.y;
  const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
  const speed = inp.held.dash ? 160 : 90;
  const nx = hero.x + dx * speed * dt, ny = hero.y + dy * speed * dt, r = 5;
  if (!blocked(nx - r, hero.y - r) && !blocked(nx + r, hero.y - r) && !blocked(nx - r, hero.y + r) && !blocked(nx + r, hero.y + r)) hero.x = nx;
  if (!blocked(hero.x - r, ny - r) && !blocked(hero.x + r, ny - r) && !blocked(hero.x - r, ny + r) && !blocked(hero.x + r, ny + r)) hero.y = ny;
  api.state.set("hero", hero);
  const stars = api.state.get("stars"), left = stars.filter((s) => Math.hypot(s.x - hero.x, s.y - hero.y) > 10);
  if (left.length !== stars.length) {
    api.state.set("stars", left);
    api.state.inc("score", stars.length - left.length);
    api.sound.play("pickup");
    if (api.state.get("score") === 5) api.ai.request("cheer", "玩家拿到了 5 颗星", { score: 5 });
  }
}

export function onAi(api) {
  const p = api.params;
  api.state.set("comment", (p.data && p.data.line) || p.text || "加油！");
}

export function draw(api) {
  const d = api.draw, hero = api.state.get("hero"), { width, height } = api.params;
  const cx = Math.max(0, Math.min(W * T - width, hero.x - width / 2)), cy = Math.max(0, Math.min(H * T - height, hero.y - height / 2));
  d.clear("#101418");
  d.camera(Math.round(cx), Math.round(cy), 1);
  d.tilemap({ tileset: "tiles", tile_size: T, columns: 2, map: MAP });
  for (const s of api.state.get("stars")) d.circle(s.x, s.y, 5, "#ffd84a");
  d.rect(hero.x - 6, hero.y - 6, 12, 12, "#4fd1a5");
  d.rect(hero.x - 6, hero.y - 6, 12, 12, "#0b3d2e", { stroke: true, width: 1 });
  d.text(`★ ${api.state.get("score")}   ⏱ ${api.state.get("time_left")}`, 6, 6, { fixed: true, size: 12, color: "#fff", bold: true });
}
