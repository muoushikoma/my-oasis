// 内置 2D 刚体物理（纯引擎模块）：圆、矩形、凸多边形；重力、斜坡、摩擦、弹性；距离/铰链/焊接关节；传感器（只报碰撞不推开）。
// 世界是纯 JSON 数据（存在 game.extra.physics 里）：能存档、能撤销；同样的输入一定得到同样的结果（不用随机数、不用真实时间，
// 物体按 id 顺序处理）。固定步长：每次 step 按 1/120 秒细分。
export type Vec = [number, number];
export interface Shape { type: "circle" | "box" | "poly"; r?: number; w?: number; h?: number; points?: Vec[] }
export interface Body {
  id: number; type: "dynamic" | "static" | "kinematic"; shape: Shape;
  x: number; y: number; angle: number; vx: number; vy: number; av: number;
  density: number; friction: number; restitution: number; sensor: boolean; fixed_rotation: boolean;
  gravity_scale: number; damping: number; angular_damping: number; tag?: string; data?: any;
  // 派生量（创建/改形状时计算）
  m: number; im: number; ii: number; local: Vec[]; radius: number;
}
export interface Joint { id: number; type: "distance" | "pin" | "weld"; a: number; b: number; ax: number; ay: number; bx: number; by: number; length: number; stiffness: number; angle: number }
export interface World { gravity: Vec; iterations: number; next: number; bodies: Body[]; joints: Joint[]; pairs: string[]; time: number; bounds?: [number, number, number, number] }
export interface StepEvents { begin: { a: number; b: number; sensor: boolean; tag_a?: string; tag_b?: string }[]; end: { a: number; b: number }[] }

export const PHYS_LIMITS = { bodies: 512, joints: 256, vertices: 16, iterations: 20 };
const STEP = 1 / 120;
const fin = (v: any, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
const clampN = (v: any, lo: number, hi: number, d: number) => Math.max(lo, Math.min(hi, fin(v, d)));

export function createWorld(o: any = {}): World {
  const g = Array.isArray(o.gravity) ? o.gravity : [0, fin(o.gravity_y ?? o.gravity, 980)];
  return { gravity: [fin(g[0], 0), fin(g[1], 980)], iterations: clampN(o.iterations, 1, PHYS_LIMITS.iterations, 8) | 0, next: 1, bodies: [], joints: [], pairs: [], time: 0,
    bounds: Array.isArray(o.bounds) && o.bounds.length === 4 ? o.bounds.map((v: any) => fin(v, 0)) as any : undefined };
}

function shapeOf(s: any): Shape {
  if (!s || typeof s !== "object") throw new Error("物体要写 shape，例如 { type: \"box\", w: 32, h: 32 }");
  if (s.type === "circle") return { type: "circle", r: clampN(s.r, 0.5, 100000, 8) };
  if (s.type === "box") return { type: "box", w: clampN(s.w, 1, 100000, 16), h: clampN(s.h, 1, 100000, 16) };
  if (s.type === "poly") {
    const pts: Vec[] = (Array.isArray(s.points) ? s.points : []).map((p: any) => [fin(p?.[0] ?? p?.x, 0), fin(p?.[1] ?? p?.y, 0)] as Vec);
    if (pts.length < 3 || pts.length > PHYS_LIMITS.vertices) throw new Error(`多边形要 3~${PHYS_LIMITS.vertices} 个顶点`);
    return { type: "poly", points: convexOrder(pts) };
  }
  throw new Error(`不认识的形状「${s.type}」（可用 circle / box / poly）`);
}
/** 顶点按顺时针（屏幕坐标，y 向下）排好，并检查是凸多边形 */
function convexOrder(p: Vec[]): Vec[] {
  let area = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (Math.abs(area) < 1e-6) throw new Error("多边形面积为 0");
  const q = area < 0 ? [...p].reverse() : p;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length], c = q[(i + 2) % q.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9) throw new Error("只支持凸多边形（凹的请拆成几个）");
  }
  return q;
}
function derive(b: Body) {
  const s = b.shape;
  if (s.type === "circle") { b.local = []; b.radius = s.r!; const area = Math.PI * s.r! * s.r!; b.m = area * b.density; b.ii = b.m * s.r! * s.r! / 2; }
  else {
    let pts: Vec[] = s.type === "box" ? [[-s.w! / 2, -s.h! / 2], [s.w! / 2, -s.h! / 2], [s.w! / 2, s.h! / 2], [-s.w! / 2, s.h! / 2]] : s.points!;
    // 质心移到原点
    let A = 0, cx = 0, cy = 0, I = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; const cr = a[0] * c[1] - c[0] * a[1]; A += cr; cx += (a[0] + c[0]) * cr; cy += (a[1] + c[1]) * cr; }
    A /= 2; cx /= 6 * A; cy /= 6 * A;
    pts = pts.map((p) => [p[0] - cx, p[1] - cy] as Vec);
    for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; const cr = a[0] * c[1] - c[0] * a[1]; I += cr * (a[0] * a[0] + a[0] * c[0] + c[0] * c[0] + a[1] * a[1] + a[1] * c[1] + c[1] * c[1]); }
    b.local = pts; b.radius = Math.max(...pts.map((p) => Math.hypot(p[0], p[1])));
    b.m = Math.abs(A) * b.density; b.ii = Math.abs(I / 12) * b.density;
  }
  if (b.type !== "dynamic") { b.im = 0; b.ii = 0; b.m = 0; }
  else { b.im = b.m > 0 ? 1 / b.m : 0; b.ii = b.fixed_rotation || b.ii <= 0 ? 0 : 1 / b.ii; }
}

const BODY_KEYS = ["x", "y", "angle", "vx", "vy", "av", "density", "friction", "restitution", "gravity_scale", "damping", "angular_damping"] as const;
export function addBody(w: World, o: any): number {
  if (w.bodies.length >= PHYS_LIMITS.bodies) throw new Error(`物理世界最多 ${PHYS_LIMITS.bodies} 个物体`);
  const b: Body = { id: w.next++, type: ["static", "kinematic"].includes(o?.type) ? o.type : "dynamic", shape: shapeOf(o?.shape),
    x: 0, y: 0, angle: 0, vx: 0, vy: 0, av: 0, density: 0.001, friction: 0.4, restitution: 0, sensor: !!o?.sensor, fixed_rotation: !!o?.fixed_rotation,
    gravity_scale: 1, damping: 0, angular_damping: 0.01, m: 0, im: 0, ii: 0, local: [], radius: 0 };
  setBody(w, b, o ?? {}, true);
  w.bodies.push(b);
  return b.id;
}
export function setBody(w: World, b: Body, o: any, fresh = false) {
  for (const k of BODY_KEYS) if (o[k] !== undefined) (b as any)[k] = fin(o[k], (b as any)[k]);
  b.density = clampN(b.density, 1e-9, 1e6, 0.001); b.friction = clampN(b.friction, 0, 10, 0.4); b.restitution = clampN(b.restitution, 0, 1, 0);
  b.damping = clampN(b.damping, 0, 100, 0); b.angular_damping = clampN(b.angular_damping, 0, 100, 0.01);
  if (typeof o.sensor === "boolean") b.sensor = o.sensor;
  if (typeof o.fixed_rotation === "boolean") b.fixed_rotation = o.fixed_rotation;
  if (["static", "kinematic", "dynamic"].includes(o.type)) b.type = o.type;
  if (o.shape && !fresh) b.shape = shapeOf(o.shape);
  if (typeof o.tag === "string") b.tag = o.tag.slice(0, 40);
  if (o.data !== undefined) { const j = JSON.stringify(o.data); if (j && j.length > 4096) throw new Error("物体的 data 最多 4 KB"); b.data = o.data === null ? undefined : JSON.parse(j); }
  derive(b);
}
export function getBody(w: World, id: number) { return w.bodies.find((b) => b.id === id); }
export function removeBody(w: World, id: number) { w.bodies = w.bodies.filter((b) => b.id !== id); w.joints = w.joints.filter((j) => j.a !== id && j.b !== id); }
/** 给脚本看的物体（不含派生量） */
export function bodyView(b: Body) {
  return { id: b.id, type: b.type, shape: b.shape, x: b.x, y: b.y, angle: b.angle, vx: b.vx, vy: b.vy, av: b.av, sensor: b.sensor, tag: b.tag, data: b.data, mass: b.m, vertices: b.shape.type === "circle" ? undefined : worldVerts(b) };
}
export function addJoint(w: World, o: any): number {
  if (w.joints.length >= PHYS_LIMITS.joints) throw new Error(`物理世界最多 ${PHYS_LIMITS.joints} 个关节`);
  const a = getBody(w, o?.a), b = getBody(w, o?.b);
  if (!a || !b || a === b) throw new Error("关节要连接两个不同的、存在的物体（a、b 写物体 id）");
  const type = ["pin", "weld"].includes(o.type) ? o.type : "distance";
  const ax = fin(o.ax, 0), ay = fin(o.ay, 0), bx = fin(o.bx, 0), by = fin(o.by, 0);
  const pa = toWorld(a, ax, ay), pb = toWorld(b, bx, by);
  const j: Joint = { id: w.next++, type, a: a.id, b: b.id, ax, ay, bx, by, length: o.length === undefined ? Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) : clampN(o.length, 0, 1e6, 0), stiffness: clampN(o.stiffness, 0, 1, 1), angle: b.angle - a.angle };
  w.joints.push(j); return j.id;
}
export function removeJoint(w: World, id: number) { w.joints = w.joints.filter((j) => j.id !== id); }

// ---------- 几何 ----------
const rot = (x: number, y: number, a: number): Vec => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
const toWorld = (b: Body, x: number, y: number): Vec => { const r = rot(x, y, b.angle); return [b.x + r[0], b.y + r[1]]; };
export function worldVerts(b: Body): Vec[] { return b.local.map((p) => toWorld(b, p[0], p[1])); }
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

interface Contact { a: Body; b: Body; nx: number; ny: number; pts: { x: number; y: number; depth: number; jn: number; jt: number; mn: number; mt: number; bias: number }[] }
function aabb(b: Body) { return [b.x - b.radius, b.y - b.radius, b.x + b.radius, b.y + b.radius]; }

function circleCircle(a: Body, b: Body): Contact | null {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), r = a.radius + b.radius;
  if (d >= r) return null;
  const nx = d > 1e-9 ? dx / d : 0, ny = d > 1e-9 ? dy / d : 1;
  return mk(a, b, nx, ny, [[a.x + nx * a.radius, a.y + ny * a.radius, r - d]]);
}
function polyCircle(p: Body, c: Body, flip: boolean): Contact | null {
  const v = worldVerts(p); let best = -Infinity, bi = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length]; const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey);
    const nx = ey / L, ny = -ex / L; const s = (c.x - a[0]) * nx + (c.y - a[1]) * ny;
    if (s > c.radius) return null; if (s > best) { best = s; bi = i; }
  }
  const a = v[bi], b = v[(bi + 1) % v.length];
  const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey;
  const t = Math.max(0, Math.min(1, ((c.x - a[0]) * ex + (c.y - a[1]) * ey) / L2));
  const qx = a[0] + ex * t, qy = a[1] + ey * t; let nx = c.x - qx, ny = c.y - qy; const d = Math.hypot(nx, ny);
  let depth: number;
  if (best < 0 && d > 1e-9) { if (d > c.radius) return null; nx /= d; ny /= d; depth = c.radius - d; }
  else { const L = Math.sqrt(L2); nx = ey / L; ny = -ex / L; depth = c.radius - best; }
  // 法线从 p 指向 c
  return flip ? mk(c, p, -nx, -ny, [[qx, qy, depth]]) : mk(p, c, nx, ny, [[qx, qy, depth]]);
}
function polyPoly(A: Body, B: Body): Contact | null {
  const va = worldVerts(A), vb = worldVerts(B);
  const axis = (v: Vec[], o: Vec[]) => { let best = -Infinity, bi = 0; for (let i = 0; i < v.length; i++) { const a = v[i], b = v[(i + 1) % v.length]; const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey); const nx = ey / L, ny = -ex / L; let mn = Infinity; for (const p of o) mn = Math.min(mn, (p[0] - a[0]) * nx + (p[1] - a[1]) * ny); if (mn > best) { best = mn; bi = i; } } return { s: best, i: bi }; };
  const ea = axis(va, vb); if (ea.s > 0) return null;
  const eb = axis(vb, va); if (eb.s > 0) return null;
  // 参考面：分离量大的那一面（带一点偏好，结果稳定）
  const useA = ea.s >= eb.s - 1e-6;
  const ref = useA ? va : vb, inc = useA ? vb : va, ri = useA ? ea.i : eb.i;
  const r1 = ref[ri], r2 = ref[(ri + 1) % ref.length];
  const ex = r2[0] - r1[0], ey = r2[1] - r1[1], L = Math.hypot(ex, ey), tx = ex / L, ty = ey / L, nx = ty, ny = -tx;
  // 入射边：法线和参考面法线最相反的那条
  let ii = 0, mind = Infinity;
  for (let i = 0; i < inc.length; i++) { const a = inc[i], b = inc[(i + 1) % inc.length]; const fx = b[0] - a[0], fy = b[1] - a[1], l = Math.hypot(fx, fy); const d = (fy / l) * nx + (-fx / l) * ny; if (d < mind) { mind = d; ii = i; } }
  let seg: Vec[] = [inc[ii], inc[(ii + 1) % inc.length]];
  const clip = (s: Vec[], ox: number, oy: number, off: number): Vec[] => {
    const out: Vec[] = []; const d0 = s[0][0] * ox + s[0][1] * oy - off, d1 = s[1][0] * ox + s[1][1] * oy - off;
    if (d0 <= 0) out.push(s[0]); if (d1 <= 0) out.push(s[1]);
    if (d0 * d1 < 0) { const t = d0 / (d0 - d1); out.push([s[0][0] + (s[1][0] - s[0][0]) * t, s[0][1] + (s[1][1] - s[0][1]) * t]); }
    return out;
  };
  seg = clip(seg, -tx, -ty, -(r1[0] * tx + r1[1] * ty)); if (seg.length < 2) return null;
  seg = clip(seg, tx, ty, r2[0] * tx + r2[1] * ty); if (seg.length < 2) return null;
  const pts: [number, number, number][] = [];
  for (const p of seg) { const sep = (p[0] - r1[0]) * nx + (p[1] - r1[1]) * ny; if (sep <= 0) pts.push([p[0], p[1], -sep]); }
  if (!pts.length) return null;
  return useA ? mk(A, B, nx, ny, pts) : mk(A, B, -nx, -ny, pts);
}
function mk(a: Body, b: Body, nx: number, ny: number, pts: [number, number, number][]): Contact {
  return { a, b, nx, ny, pts: pts.map(([x, y, depth]) => ({ x, y, depth, jn: 0, jt: 0, mn: 0, mt: 0, bias: 0 })) };
}
function collide(a: Body, b: Body): Contact | null {
  const ca = a.shape.type === "circle", cb = b.shape.type === "circle";
  if (ca && cb) return circleCircle(a, b);
  if (!ca && cb) return polyCircle(a, b, false);
  if (ca && !cb) return polyCircle(b, a, true);
  return polyPoly(a, b);
}

// ---------- 求解 ----------
function velAt(b: Body, rx: number, ry: number): Vec { return [b.vx - b.av * ry, b.vy + b.av * rx]; }
function applyImp(b: Body, px: number, py: number, rx: number, ry: number) { b.vx += px * b.im; b.vy += py * b.im; b.av += cross(rx, ry, px, py) * b.ii; }

function substep(w: World, h: number, touching: Map<string, boolean>) {
  const bodies = w.bodies;
  for (const b of bodies) {
    if (b.type !== "dynamic") continue;
    b.vx += w.gravity[0] * b.gravity_scale * h; b.vy += w.gravity[1] * b.gravity_scale * h;
    if (b.damping) { const k = 1 / (1 + h * b.damping); b.vx *= k; b.vy *= k; }
    if (b.angular_damping) b.av *= 1 / (1 + h * b.angular_damping);
    if (b.fixed_rotation) b.av = 0;
  }
  // 宽相：按 x 排序扫一遍（同样的输入顺序 → 同样的结果）
  const order = bodies.map((b) => ({ b, box: aabb(b) })).sort((p, q) => p.box[0] - q.box[0] || p.b.id - q.b.id);
  const contacts: Contact[] = [];
  for (let i = 0; i < order.length; i++) {
    const A = order[i];
    for (let j = i + 1; j < order.length; j++) {
      const B = order[j]; if (B.box[0] > A.box[2]) break;
      if (B.box[1] > A.box[3] || B.box[3] < A.box[1]) continue;
      let a = A.b, b = B.b; if (a.id > b.id) [a, b] = [b, a];
      if (a.type !== "dynamic" && b.type !== "dynamic" && !a.sensor && !b.sensor) continue;
      const c = collide(a, b); if (!c) continue;
      touching.set(`${a.id}:${b.id}`, a.sensor || b.sensor);
      if (!a.sensor && !b.sensor) contacts.push(c);
    }
  }
  contacts.sort((p, q) => p.a.id - q.a.id || p.b.id - q.b.id);
  for (const c of contacts) {
    const { a, b, nx, ny } = c; const tx = -ny, ty = nx;
    const e = Math.max(a.restitution, b.restitution);
    for (const p of c.pts) {
      const rax = p.x - a.x, ray = p.y - a.y, rbx = p.x - b.x, rby = p.y - b.y;
      const rna = cross(rax, ray, nx, ny), rnb = cross(rbx, rby, nx, ny), rta = cross(rax, ray, tx, ty), rtb = cross(rbx, rby, tx, ty);
      const kn = a.im + b.im + rna * rna * a.ii + rnb * rnb * b.ii, kt = a.im + b.im + rta * rta * a.ii + rtb * rtb * b.ii;
      p.mn = kn > 0 ? 1 / kn : 0; p.mt = kt > 0 ? 1 / kt : 0;
      const va = velAt(a, rax, ray), vb = velAt(b, rbx, rby); const vn = (vb[0] - va[0]) * nx + (vb[1] - va[1]) * ny;
      p.bias = (0.2 / h) * Math.max(0, p.depth - 0.5) + (vn < -30 ? -e * vn : 0);
    }
  }
  const joints = w.joints.map((j) => ({ j, a: getBody(w, j.a)!, b: getBody(w, j.b)! })).filter((x) => x.a && x.b);
  for (let it = 0; it < w.iterations; it++) {
    for (const c of contacts) {
      const { a, b, nx, ny } = c; const tx = -ny, ty = nx; const mu = Math.sqrt(a.friction * b.friction);
      for (const p of c.pts) {
        const rax = p.x - a.x, ray = p.y - a.y, rbx = p.x - b.x, rby = p.y - b.y;
        let va = velAt(a, rax, ray), vb = velAt(b, rbx, rby);
        const vn = (vb[0] - va[0]) * nx + (vb[1] - va[1]) * ny;
        let dj = p.mn * (-vn + p.bias); const j0 = p.jn; p.jn = Math.max(0, j0 + dj); dj = p.jn - j0;
        applyImp(a, -nx * dj, -ny * dj, rax, ray); applyImp(b, nx * dj, ny * dj, rbx, rby);
        va = velAt(a, rax, ray); vb = velAt(b, rbx, rby);
        const vt = (vb[0] - va[0]) * tx + (vb[1] - va[1]) * ty;
        let dt = -p.mt * vt; const t0 = p.jt; p.jt = Math.max(-mu * p.jn, Math.min(mu * p.jn, t0 + dt)); dt = p.jt - t0;
        applyImp(a, -tx * dt, -ty * dt, rax, ray); applyImp(b, tx * dt, ty * dt, rbx, rby);
      }
    }
    for (const { j, a, b } of joints) solveJoint(j, a, b, h);
  }
  for (const b of bodies) {
    if (b.type === "static") { b.vx = b.vy = b.av = 0; continue; }
    b.x += b.vx * h; b.y += b.vy * h; b.angle += b.av * h;
  }
  // 位置修正，避免慢慢陷进去
  for (const c of contacts) {
    const { a, b, nx, ny } = c; const tot = a.im + b.im; if (!tot) continue;
    const d = Math.max(...c.pts.map((p) => p.depth)); const k = Math.max(0, d - 0.5) * 0.4 / tot;
    a.x -= nx * k * a.im; a.y -= ny * k * a.im; b.x += nx * k * b.im; b.y += ny * k * b.im;
  }
}
function solveJoint(j: Joint, a: Body, b: Body, h: number) {
  const ra = rot(j.ax, j.ay, a.angle), rb = rot(j.bx, j.by, b.angle);
  const pa: Vec = [a.x + ra[0], a.y + ra[1]], pb: Vec = [b.x + rb[0], b.y + rb[1]];
  const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
  const va = velAt(a, ra[0], ra[1]), vb = velAt(b, rb[0], rb[1]);
  const rvx = vb[0] - va[0], rvy = vb[1] - va[1];
  if (j.type === "distance") {
    const L = Math.hypot(dx, dy); if (L < 1e-9) return; const nx = dx / L, ny = dy / L;
    const rna = cross(ra[0], ra[1], nx, ny), rnb = cross(rb[0], rb[1], nx, ny);
    const k = a.im + b.im + rna * rna * a.ii + rnb * rnb * b.ii; if (!k) return;
    const C = L - j.length, vn = rvx * nx + rvy * ny;
    const imp = -(vn + j.stiffness * 0.2 * C / h) / k;
    applyImp(a, -nx * imp, -ny * imp, ra[0], ra[1]); applyImp(b, nx * imp, ny * imp, rb[0], rb[1]);
    return;
  }
  // pin / weld：两点重合（按 x、y 两个方向分别求解，简单稳定）
  for (const [nx, ny, C] of [[1, 0, dx], [0, 1, dy]] as const) {
    const rna = cross(ra[0], ra[1], nx, ny), rnb = cross(rb[0], rb[1], nx, ny);
    const k = a.im + b.im + rna * rna * a.ii + rnb * rnb * b.ii; if (!k) continue;
    const v2a = velAt(a, ra[0], ra[1]), v2b = velAt(b, rb[0], rb[1]);
    const vn = (v2b[0] - v2a[0]) * nx + (v2b[1] - v2a[1]) * ny;
    const imp = -(vn + j.stiffness * 0.2 * C / h) / k;
    applyImp(a, -nx * imp, -ny * imp, ra[0], ra[1]); applyImp(b, nx * imp, ny * imp, rb[0], rb[1]);
  }
  if (j.type === "weld") {
    const k = a.ii + b.ii; if (!k) return;
    const C = b.angle - a.angle - j.angle; const imp = -((b.av - a.av) + j.stiffness * 0.2 * C / h) / k;
    a.av -= imp * a.ii; b.av += imp * b.ii;
  }
}

/** 推进 dtMs 毫秒（内部按 1/120 秒细分，最多 250ms）；返回这段时间里开始/结束接触的物体对 */
export function stepWorld(w: World, dtMs: number): StepEvents {
  let left = Math.max(0, Math.min(0.25, fin(dtMs, 0) / 1000));
  const touching = new Map<string, boolean>();
  let n = 0;
  while (left > 1e-9 && n++ < 30) { const h = Math.min(STEP, left); substep(w, h, touching); left -= h; }
  w.time += Math.max(0, Math.min(250, fin(dtMs, 0)));
  if (w.bounds) { const [x0, y0, x1, y1] = w.bounds; w.bodies = w.bodies.filter((b) => b.type !== "dynamic" || (b.x >= x0 && b.x <= x1 && b.y >= y0 && b.y <= y1)); }
  for (const b of w.bodies) for (const k of ["x", "y", "angle", "vx", "vy", "av"] as const) if (!isFinite(b[k])) b[k] = 0;
  const prev = new Set(w.pairs), now = [...touching.keys()].sort();
  const tag = (id: number) => getBody(w, id)?.tag;
  const ev: StepEvents = { begin: [], end: [] };
  for (const k of now) if (!prev.has(k)) { const [a, b] = k.split(":").map(Number); ev.begin.push({ a, b, sensor: touching.get(k)!, tag_a: tag(a), tag_b: tag(b) }); }
  const nowSet = new Set(now);
  for (const k of w.pairs) if (!nowSet.has(k)) { const [a, b] = k.split(":").map(Number); ev.end.push({ a, b }); }
  w.pairs = now;
  return ev;
}

/** 点查询：哪些物体包含这个点 */
export function queryPoint(w: World, x: number, y: number): number[] {
  const out: number[] = [];
  for (const b of w.bodies) {
    if (b.shape.type === "circle") { if (Math.hypot(x - b.x, y - b.y) <= b.radius) out.push(b.id); continue; }
    const v = worldVerts(b); let inside = true;
    for (let i = 0; i < v.length && inside; i++) { const a = v[i], c = v[(i + 1) % v.length]; if (cross(c[0] - a[0], c[1] - a[1], x - a[0], y - a[1]) < 0) inside = false; }
    if (inside) out.push(b.id);
  }
  return out;
}
/** 射线：返回最近的命中 { id, x, y, distance } 或 null */
export function raycast(w: World, x0: number, y0: number, x1: number, y1: number): { id: number; x: number; y: number; distance: number } | null {
  const dx = x1 - x0, dy = y1 - y0; let best: any = null;
  for (const b of w.bodies) {
    if (b.sensor) continue;
    let t = Infinity;
    if (b.shape.type === "circle") {
      const fx = x0 - b.x, fy = y0 - b.y, A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - b.radius * b.radius, D = B * B - 4 * A * C;
      if (A > 0 && D >= 0) { const s = (-B - Math.sqrt(D)) / (2 * A); if (s >= 0 && s <= 1) t = s; }
    } else {
      const v = worldVerts(b);
      for (let i = 0; i < v.length; i++) {
        const a = v[i], c = v[(i + 1) % v.length], ex = c[0] - a[0], ey = c[1] - a[1], den = cross(dx, dy, ex, ey); if (Math.abs(den) < 1e-12) continue;
        const s = cross(a[0] - x0, a[1] - y0, ex, ey) / den, u = cross(a[0] - x0, a[1] - y0, dx, dy) / den;
        if (s >= 0 && s <= 1 && u >= 0 && u <= 1) t = Math.min(t, s);
      }
    }
    if (t < Infinity && (!best || t < best.t)) best = { t, id: b.id };
  }
  if (!best) return null;
  const L = Math.hypot(dx, dy);
  return { id: best.id, x: x0 + dx * best.t, y: y0 + dy * best.t, distance: L * best.t };
}
