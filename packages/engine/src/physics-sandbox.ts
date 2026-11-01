// 内置 2D 刚体物理（在 QuickJS 沙箱里运行的纯 JS，作为脚本前置代码的一部分注入）。
// 世界是纯 JSON 数据：作者把它存进 json 类型的状态，每次 tick 取出、step、存回，所以能存档、能撤销、能重放。
// 确定性：不用随机数和真实时间；物体按数组顺序处理；固定子步长；所有数学在同一个 QuickJS（WASM）里算。
// 形状：circle（圆）、box（矩形）、polygon（凸多边形，凹的自动取凸包，最多 16 个顶点；斜坡用三角形）。
// 类型：dynamic（受力）、static（不动）、kinematic（按速度移动、不受力）。传感器 sensor：只报碰撞，不推开。
// 关节：distance（硬杆）、rope（绳，最长不超过 length）、pin（铰链；不写 b 就钉在世界上）。
// 求解：每个子步 = 积分速度 → 碰撞检测（按 x 排序扫描 + SAT/裁剪得到接触点）→ 热启动 → 顺序冲量迭代（法向、摩擦、弹性、穿透修正、关节）→ 积分位置。
// 注意：本文件内容是字符串，里面不能出现反引号和美元符加花括号。
export const PHYSICS_JS = String.raw`
const __phys = (function () {
  var MAXB = 512, MAXJ = 256, SLOP = 0.5, BAUM = 0.2; // 穿透超过 SLOP 像素时按 BAUM 比例在速度里推开
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function cross(ax, ay, bx, by) { return ax * by - ay * bx; }
  function hull(pts) {
    var p = pts.map(function (q) { return [num(q[0] !== undefined ? q[0] : q.x, 0), num(q[1] !== undefined ? q[1] : q.y, 0)]; });
    p.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (p.length < 3) throw new Error("polygon 至少要 3 个点");
    var lo = [], up = [], i;
    for (i = 0; i < p.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 1][0] - lo[lo.length - 2][0], lo[lo.length - 1][1] - lo[lo.length - 2][1], p[i][0] - lo[lo.length - 2][0], p[i][1] - lo[lo.length - 2][1]) <= 0) lo.pop(); lo.push(p[i]); }
    for (i = p.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 1][0] - up[up.length - 2][0], up[up.length - 1][1] - up[up.length - 2][1], p[i][0] - up[up.length - 2][0], p[i][1] - up[up.length - 2][1]) <= 0) up.pop(); up.push(p[i]); }
    up.pop(); lo.pop(); var h = lo.concat(up);
    if (h.length < 3) throw new Error("polygon 的点不能在一条直线上");
    if (h.length > 16) throw new Error("polygon 最多 16 个顶点");
    // 保证有向面积为正（这样边 (e.x, e.y) 的外法线是 (e.y, -e.x)）
    var a = 0; for (i = 0; i < h.length; i++) { var q = h[(i + 1) % h.length]; a += cross(h[i][0], h[i][1], q[0], q[1]); }
    if (a < 0) h.reverse();
    return h;
  }
  /** 质量属性（以本地原点为质心） */
  function massOf(b) {
    if (b.type !== "dynamic") return { im: 0, ii: 0 };
    var d = num(b.density, 1) / 100, m, I;
    if (b.shape === "circle") { m = d * Math.PI * b.r * b.r; I = 0.5 * m * b.r * b.r; }
    else {
      var v = b.points, A = 0, J = 0;
      for (var i = 0; i < v.length; i++) { var p = v[i], q = v[(i + 1) % v.length], c = cross(p[0], p[1], q[0], q[1]); A += c / 2; J += c * (p[0] * p[0] + p[0] * q[0] + q[0] * q[0] + p[1] * p[1] + p[1] * q[1] + q[1] * q[1]); }
      m = d * Math.abs(A); I = d * Math.abs(J) / 12;
    }
    m = Math.max(m, 1e-6); I = Math.max(I, 1e-6);
    return { im: 1 / m, ii: b.fixed_rotation ? 0 : 1 / I };
  }
  function world(o) {
    o = o || {};
    var g = o.gravity; g = Array.isArray(g) ? [num(g[0], 0), num(g[1], 980)] : g && typeof g === "object" ? [num(g.x, 0), num(g.y, 980)] : [0, 980];
    return { gravity: g, iterations: Math.max(1, Math.min(30, Math.floor(num(o.iterations, 10)))), substep_hz: Math.max(30, Math.min(480, Math.floor(num(o.substep_hz, 120)))), bodies: [], joints: [], contacts: {}, events: [], next_id: 1, time: 0 };
  }
  function find(w, id) { for (var i = 0; i < w.bodies.length; i++) if (w.bodies[i].id === id) return w.bodies[i]; return null; }
  function add(w, o) {
    o = o || {};
    if (w.bodies.length >= MAXB) throw new Error("物理世界最多 " + MAXB + " 个物体");
    var id = o.id !== undefined && o.id !== null ? String(o.id).slice(0, 40) : "b" + w.next_id++;
    if (find(w, id)) throw new Error("物体 id「" + id + "」已存在");
    var shape = o.shape === "circle" || o.shape === "polygon" ? o.shape : "box";
    var type = o.type === "static" || o.type === "kinematic" ? o.type : "dynamic";
    var b = { id: id, shape: shape, type: type, x: num(o.x, 0), y: num(o.y, 0), angle: num(o.angle, 0), vx: num(o.vx, 0), vy: num(o.vy, 0), av: num(o.av, 0),
      density: num(o.density, 1), friction: Math.max(0, num(o.friction, 0.4)), restitution: Math.max(0, Math.min(1, num(o.restitution, 0))),
      sensor: !!o.sensor, fixed_rotation: !!o.fixed_rotation, gravity_scale: num(o.gravity_scale, 1), damping: Math.max(0, num(o.damping, 0)),
      group: Math.floor(num(o.group, 0)), tag: o.tag === undefined ? null : o.tag };
    if (shape === "circle") b.r = Math.max(0.5, num(o.r, 8));
    else if (shape === "box") { b.w = Math.max(1, num(o.w, 16)); b.h = Math.max(1, num(o.h, 16)); b.points = [[-b.w / 2, -b.h / 2], [b.w / 2, -b.h / 2], [b.w / 2, b.h / 2], [-b.w / 2, b.h / 2]]; }
    else {
      var h = hull(Array.isArray(o.points) ? o.points.slice(0, 64) : []);
      // 把原点挪到质心：points 是相对 (x, y) 写的
      var A = 0, cx = 0, cy = 0;
      for (var i = 0; i < h.length; i++) { var p = h[i], q = h[(i + 1) % h.length], c = cross(p[0], p[1], q[0], q[1]); A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
      cx /= 3 * A; cy /= 3 * A;
      b.points = h.map(function (p) { return [p[0] - cx, p[1] - cy]; });
      var cs = Math.cos(b.angle), sn = Math.sin(b.angle);
      b.x += cs * cx - sn * cy; b.y += sn * cx + cs * cy;
    }
    w.bodies.push(b);
    return b;
  }
  function remove(w, id) {
    w.bodies = w.bodies.filter(function (b) { return b.id !== id; });
    w.joints = w.joints.filter(function (j) { return j.a !== id && j.b !== id; });
    for (var k in w.contacts) { var p = k.split("|"); if (p[0] === id || p[1] === id) delete w.contacts[k]; }
  }
  function joint(w, o) {
    o = o || {};
    if (w.joints.length >= MAXJ) throw new Error("最多 " + MAXJ + " 个关节");
    var A = find(w, o.a), B = o.b === undefined || o.b === null ? null : find(w, o.b);
    if (!A) throw new Error("关节的物体 a「" + o.a + "」不存在");
    if (o.b !== undefined && o.b !== null && !B) throw new Error("关节的物体 b「" + o.b + "」不存在");
    var type = o.type === "rope" || o.type === "pin" ? o.type : "distance";
    // 锚点：ax/ay、bx/by 是相对物体中心的本地坐标（默认中心）；pin 可以直接写世界坐标 x/y
    var j = { id: o.id !== undefined ? String(o.id).slice(0, 40) : "j" + w.next_id++, type: type, a: A.id, b: B ? B.id : null, ax: num(o.ax, 0), ay: num(o.ay, 0), bx: num(o.bx, 0), by: num(o.by, 0), length: 0 };
    if (type === "pin" && typeof o.x === "number" && typeof o.y === "number") {
      var la = toLocal(A, o.x, o.y); j.ax = la[0]; j.ay = la[1];
      if (B) { var lb = toLocal(B, o.x, o.y); j.bx = lb[0]; j.by = lb[1]; } else { j.bx = o.x; j.by = o.y; }
    } else if (!B) { j.bx = num(o.bx, A.x); j.by = num(o.by, A.y); }
    var pa = anchor(A, j.ax, j.ay), pb = B ? anchor(B, j.bx, j.by) : [j.bx, j.by];
    j.length = num(o.length, Math.hypot(pb[0] - pa[0], pb[1] - pa[1]));
    w.joints.push(j); return j;
  }
  function toLocal(b, x, y) { var dx = x - b.x, dy = y - b.y, c = Math.cos(b.angle), s = Math.sin(b.angle); return [c * dx + s * dy, -s * dx + c * dy]; }
  function anchor(b, lx, ly) { var c = Math.cos(b.angle), s = Math.sin(b.angle); return [b.x + c * lx - s * ly, b.y + s * lx + c * ly]; }
  function verts(b) {
    if (b.shape === "circle") return null;
    var c = Math.cos(b.angle), s = Math.sin(b.angle);
    return b.points.map(function (p) { return [b.x + c * p[0] - s * p[1], b.y + s * p[0] + c * p[1]]; });
  }
  function aabb(b) {
    if (b.shape === "circle") return [b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r];
    var v = b._v, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < v.length; i++) { x0 = Math.min(x0, v[i][0]); y0 = Math.min(y0, v[i][1]); x1 = Math.max(x1, v[i][0]); y1 = Math.max(y1, v[i][1]); }
    return [x0, y0, x1, y1];
  }
  function normals(v) { var n = []; for (var i = 0; i < v.length; i++) { var q = v[(i + 1) % v.length], ex = q[0] - v[i][0], ey = q[1] - v[i][1], l = Math.hypot(ex, ey) || 1; n.push([ey / l, -ex / l]); } return n; }
  // ---- 碰撞：返回 { n: [nx, ny]（A 指向 B）, pts: [[x, y, depth], ...] } 或 null ----
  function circleCircle(A, B) {
    var dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), r = A.r + B.r;
    if (d >= r) return null;
    var nx = d > 1e-9 ? dx / d : 0, ny = d > 1e-9 ? dy / d : 1;
    return { n: [nx, ny], pts: [[A.x + nx * A.r, A.y + ny * A.r, r - d]] };
  }
  function polyCircle(P, C) { // 法线从多边形指向圆
    var v = P._v, ns = P._n, best = -Infinity, bi = 0, i;
    for (i = 0; i < v.length; i++) { var s = ns[i][0] * (C.x - v[i][0]) + ns[i][1] * (C.y - v[i][1]); if (s > C.r) return null; if (s > best) { best = s; bi = i; } }
    if (best < 0) return { n: ns[bi], pts: [[C.x - ns[bi][0] * C.r, C.y - ns[bi][1] * C.r, C.r - best]] };
    var bd = Infinity, qx = 0, qy = 0;
    for (i = 0; i < v.length; i++) {
      var p = v[i], q = v[(i + 1) % v.length], ex = q[0] - p[0], ey = q[1] - p[1], L = ex * ex + ey * ey;
      var t = L > 0 ? Math.max(0, Math.min(1, ((C.x - p[0]) * ex + (C.y - p[1]) * ey) / L)) : 0;
      var cx = p[0] + ex * t, cy = p[1] + ey * t, d = (C.x - cx) * (C.x - cx) + (C.y - cy) * (C.y - cy);
      if (d < bd) { bd = d; qx = cx; qy = cy; }
    }
    var dist = Math.sqrt(bd); if (dist >= C.r || dist < 1e-9) return dist < 1e-9 ? { n: ns[bi], pts: [[qx, qy, C.r]] } : null;
    return { n: [(C.x - qx) / dist, (C.y - qy) / dist], pts: [[qx, qy, C.r - dist]] };
  }
  function maxSep(A, B) {
    var va = A._v, na = A._n, vb = B._v, best = -Infinity, bi = 0;
    for (var i = 0; i < va.length; i++) {
      var m = Infinity; for (var k = 0; k < vb.length; k++) m = Math.min(m, na[i][0] * (vb[k][0] - va[i][0]) + na[i][1] * (vb[k][1] - va[i][1]));
      if (m > best) { best = m; bi = i; }
    }
    return [best, bi];
  }
  function polyPoly(A, B) {
    var sa = maxSep(A, B); if (sa[0] > 0) return null;
    var sb = maxSep(B, A); if (sb[0] > 0) return null;
    var ref = A, inc = B, ei = sa[1], flip = false;
    if (sb[0] > 0.98 * sa[0] + 0.1) { ref = B; inc = A; ei = sb[1]; flip = true; }
    var rv = ref._v, n = ref._n[ei], v1 = rv[ei], v2 = rv[(ei + 1) % rv.length];
    // 入射边：法线与参考法线最反向的那条
    var iv = inc._v, inn = inc._n, ii = 0, mn = Infinity;
    for (var i = 0; i < iv.length; i++) { var d = inn[i][0] * n[0] + inn[i][1] * n[1]; if (d < mn) { mn = d; ii = i; } }
    var seg = [iv[ii], iv[(ii + 1) % iv.length]];
    var tx = v2[0] - v1[0], ty = v2[1] - v1[1], tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    function clip(s, ox, oy, off) {
      var out = [], d0 = ox * s[0][0] + oy * s[0][1] - off, d1 = ox * s[1][0] + oy * s[1][1] - off;
      if (d0 <= 0) out.push(s[0]); if (d1 <= 0) out.push(s[1]);
      if (d0 * d1 < 0) { var t = d0 / (d0 - d1); out.push([s[0][0] + (s[1][0] - s[0][0]) * t, s[0][1] + (s[1][1] - s[0][1]) * t]); }
      return out;
    }
    var c = clip(seg, -tx, -ty, -(tx * v1[0] + ty * v1[1])); if (c.length < 2) return null;
    c = clip(c, tx, ty, tx * v2[0] + ty * v2[1]); if (c.length < 2) return null;
    var pts = [];
    for (i = 0; i < c.length; i++) { var sep = n[0] * (c[i][0] - v1[0]) + n[1] * (c[i][1] - v1[1]); if (sep <= 0) pts.push([c[i][0], c[i][1], -sep]); }
    if (!pts.length) return null;
    return { n: flip ? [-n[0], -n[1]] : [n[0], n[1]], pts: pts };
  }
  function collide(A, B) {
    if (A.shape === "circle" && B.shape === "circle") return circleCircle(A, B);
    if (A.shape !== "circle" && B.shape === "circle") return polyCircle(A, B);
    if (A.shape === "circle" && B.shape !== "circle") { var m = polyCircle(B, A); if (!m) return null; m.n = [-m.n[0], -m.n[1]]; return m; }
    return polyPoly(A, B);
  }
  function key(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
  function stepOnce(w, h, touching, prev) {
    var bs = w.bodies, i, k, b;
    for (i = 0; i < bs.length; i++) {
      b = bs[i]; var m = massOf(b); b._im = m.im; b._ii = m.ii;
      if (b.type === "dynamic") {
        b.vx += w.gravity[0] * b.gravity_scale * h; b.vy += w.gravity[1] * b.gravity_scale * h;
        if (b.damping) { var f = Math.max(0, 1 - b.damping * h); b.vx *= f; b.vy *= f; b.av *= f; }
      }
      if (b.type === "static") { b.vx = 0; b.vy = 0; b.av = 0; }
      b._v = verts(b); b._n = b._v ? normals(b._v) : null; b._box = aabb(b);
    }
    // 宽阶段：按 aabb 左边排序后扫描（排序稳定：相同时按数组顺序）
    var order = bs.map(function (b, i) { return i; });
    order.sort(function (p, q) { return bs[p]._box[0] - bs[q]._box[0] || p - q; });
    var man = [];
    for (i = 0; i < order.length; i++) {
      var A = bs[order[i]];
      for (k = i + 1; k < order.length; k++) {
        var B = bs[order[k]]; if (B._box[0] > A._box[2]) break;
        if (B._box[1] > A._box[3] || B._box[3] < A._box[1]) continue;
        if (A.type !== "dynamic" && B.type !== "dynamic" && !A.sensor && !B.sensor) continue;
        if (A.group && A.group === B.group && A.group < 0) continue; // 负数分组：组内不碰撞
        var a = A, bb = B; if (order[i] > order[k]) { a = B; bb = A; } // 固定顺序：数组里靠前的是 A
        var c = collide(a, bb); if (!c) continue;
        var kk = key(a.id, bb.id); touching[kk] = [c.n[0], c.n[1], a.id];
        if (a.sensor || bb.sensor) continue;
        c.key = kk; c.a = a; c.b = bb; c.mu = Math.sqrt(a.friction * bb.friction); c.e = Math.max(a.restitution, bb.restitution);
        c.cp = c.pts.map(function (p) {
          var rax = p[0] - a.x, ray = p[1] - a.y, rbx = p[0] - bb.x, rby = p[1] - bb.y, n = c.n, tx = -n[1], ty = n[0];
          var rna = cross(rax, ray, n[0], n[1]), rnb = cross(rbx, rby, n[0], n[1]), rta = cross(rax, ray, tx, ty), rtb = cross(rbx, rby, tx, ty);
          var kn = a._im + bb._im + a._ii * rna * rna + bb._ii * rnb * rnb, kt = a._im + bb._im + a._ii * rta * rta + bb._ii * rtb * rtb;
          var vn = (bb.vx - bb.av * rby - a.vx + a.av * ray) * n[0] + (bb.vy + bb.av * rbx - a.vy - a.av * rax) * n[1];
          return { rax: rax, ray: ray, rbx: rbx, rby: rby, mn: kn > 0 ? 1 / kn : 0, mt: kt > 0 ? 1 / kt : 0, pn: 0, pt: 0, bias: Math.max(vn < -60 ? -c.e * vn : 0, BAUM / h * Math.max(0, p[2] - SLOP)), depth: p[2] };
        });
        man.push(c);
      }
    }
    function impulse(a, b, rax, ray, rbx, rby, px, py) {
      a.vx -= a._im * px; a.vy -= a._im * py; a.av -= a._ii * cross(rax, ray, px, py);
      b.vx += b._im * px; b.vy += b._im * py; b.av += b._ii * cross(rbx, rby, px, py);
    }
    // 热启动：沿用上一子步同一对物体的法向冲量（点数相同时），叠放更稳
    for (i = 0; i < man.length; i++) {
      var cw = man[i], pv = prev[cw.key];
      if (!pv || !pv[3] || pv[3].length !== cw.cp.length) continue;
      for (k = 0; k < cw.cp.length; k++) { var q = cw.cp[k], ww = pv[3][k]; q.pn = ww[0]; q.pt = ww[1]; impulse(cw.a, cw.b, q.rax, q.ray, q.rbx, q.rby, cw.n[0] * q.pn - cw.n[1] * q.pt, cw.n[1] * q.pn + cw.n[0] * q.pt); }
    }
    var J = w.joints.map(function (j) { return prepJoint(w, j, h); }).filter(function (x) { return x; });
    for (var it = 0; it < w.iterations; it++) {
      for (var j = 0; j < J.length; j++) solveJoint(J[j], impulse);
      for (i = 0; i < man.length; i++) {
        var c = man[i], a = c.a, bb = c.b, n = c.n, tx = -n[1], ty = n[0];
        for (k = 0; k < c.cp.length; k++) {
          var p = c.cp[k];
          var dvx = bb.vx - bb.av * p.rby - a.vx + a.av * p.ray, dvy = bb.vy + bb.av * p.rbx - a.vy - a.av * p.rax;
          // 摩擦
          var vt = dvx * tx + dvy * ty, lt = -vt * p.mt, maxF = c.mu * p.pn, pt = Math.max(-maxF, Math.min(maxF, p.pt + lt)); lt = pt - p.pt; p.pt = pt;
          impulse(a, bb, p.rax, p.ray, p.rbx, p.rby, tx * lt, ty * lt);
          dvx = bb.vx - bb.av * p.rby - a.vx + a.av * p.ray; dvy = bb.vy + bb.av * p.rbx - a.vy - a.av * p.rax;
          var vn = dvx * n[0] + dvy * n[1], ln = (-vn + p.bias) * p.mn, pn = Math.max(0, p.pn + ln); ln = pn - p.pn; p.pn = pn;
          impulse(a, bb, p.rax, p.ray, p.rbx, p.rby, n[0] * ln, n[1] * ln);
        }
      }
    }
    for (i = 0; i < man.length; i++) touching[man[i].key][3] = man[i].cp.map(function (p) { return [Math.round(p.pn * 1000) / 1000, Math.round(p.pt * 1000) / 1000]; });
    for (i = 0; i < bs.length; i++) { b = bs[i]; if (b.type === "static") continue; b.x += b.vx * h; b.y += b.vy * h; if (!b.fixed_rotation || b.type === "kinematic") b.angle += b.av * h; }
  }
  function prepJoint(w, j, h) {
    var A = find(w, j.a), B = j.b === null ? null : find(w, j.b); if (!A || (j.b !== null && !B)) return null;
    var S = B || { x: j.bx, y: j.by, vx: 0, vy: 0, av: 0, angle: 0, _im: 0, _ii: 0 }, bl = B ? [j.bx, j.by] : [0, 0];
    var pa = anchor(A, j.ax, j.ay), pb = anchor(S, bl[0], bl[1]);
    return { j: j, a: A, b: S, rax: pa[0] - A.x, ray: pa[1] - A.y, rbx: pb[0] - S.x, rby: pb[1] - S.y, dx: pb[0] - pa[0], dy: pb[1] - pa[1], h: h };
  }
  function solveJoint(J, impulse) {
    var a = J.a, b = J.b, j = J.j;
    var dvx = b.vx - b.av * J.rby - a.vx + a.av * J.ray, dvy = b.vy + b.av * J.rbx - a.vy - a.av * J.rax;
    if (j.type === "pin") {
      // 点约束：2×2 有效质量
      var ima = a._im, imb = b._im, iia = a._ii, iib = b._ii;
      var k11 = ima + imb + iia * J.ray * J.ray + iib * J.rby * J.rby, k12 = -iia * J.rax * J.ray - iib * J.rbx * J.rby, k22 = ima + imb + iia * J.rax * J.rax + iib * J.rbx * J.rbx;
      var det = k11 * k22 - k12 * k12; if (Math.abs(det) < 1e-12) return;
      var bx = -dvx - BAUM / J.h * J.dx * 0.5, by = -dvy - BAUM / J.h * J.dy * 0.5;
      var px = (k22 * bx - k12 * by) / det, py = (k11 * by - k12 * bx) / det;
      impulse(a, b, J.rax, J.ray, J.rbx, J.rby, px, py);
      return;
    }
    var L = Math.hypot(J.dx, J.dy); if (L < 1e-6) return;
    var nx = J.dx / L, ny = J.dy / L, C = L - j.length;
    if (j.type === "rope" && C <= 0) return;
    var rna = cross(J.rax, J.ray, nx, ny), rnb = cross(J.rbx, J.rby, nx, ny), k = a._im + b._im + a._ii * rna * rna + b._ii * rnb * rnb; if (!k) return;
    var vn = dvx * nx + dvy * ny, lam = -(vn + BAUM / J.h * C * 0.5) / k;
    if (j.type === "rope") lam = Math.min(0, lam);
    impulse(a, b, J.rax, J.ray, J.rbx, J.rby, nx * lam, ny * lam);
  }
  function step(w, dtMs) {
    var dt = Math.max(0, Math.min(250, num(dtMs, 0))) / 1000, h = 1 / w.substep_hz, n = Math.min(64, Math.ceil(dt / h - 1e-9));
    var touching = {}, i, before = w.contacts || {};
    var prev = w.contacts || {};
    if (n > 0) { h = dt / n; for (i = 0; i < n; i++) { touching = {}; stepOnce(w, h, touching, prev); prev = touching; } }
    else return (w.events = []);
    for (i = 0; i < w.bodies.length; i++) { var b = w.bodies[i]; delete b._im; delete b._ii; delete b._v; delete b._n; delete b._box; }
    var ev = [], k;
    var sensorOf = function (kk) { var p = kk.split("|"), A = find(w, p[0]), B = find(w, p[1]); return !!((A && A.sensor) || (B && B.sensor)); };
    for (k in touching) if (!before[k]) { var t = touching[k], p = k.split("|"), a = t[2], b2 = p[0] === a ? p[1] : p[0]; ev.push({ type: "begin", a: a, b: b2, nx: t[0], ny: t[1], sensor: sensorOf(k) }); }
    for (k in before) if (!touching[k]) { var p2 = k.split("|"); ev.push({ type: "end", a: p2[0], b: p2[1], sensor: sensorOf(k) }); }
    w.contacts = touching; w.events = ev; w.time = num(w.time, 0) + dt * 1000;
    return ev;
  }
  /** 正在接触的物体：[{ id, nx, ny }]，法线从这个物体指向对方（站在地上时 ny > 0） */
  function touching(w, id) {
    var out = [];
    for (var k in w.contacts) { var p = k.split("|"), t = w.contacts[k]; if (p[0] !== id && p[1] !== id) continue; var other = p[0] === id ? p[1] : p[0], s = t[2] === id ? 1 : -1; out.push({ id: other, nx: t[0] * s, ny: t[1] * s }); }
    return out;
  }
  function at(w, x, y) {
    var out = [];
    for (var i = 0; i < w.bodies.length; i++) {
      var b = w.bodies[i];
      if (b.shape === "circle") { if (Math.hypot(x - b.x, y - b.y) <= b.r) out.push(b.id); continue; }
      var v = verts(b), n = normals(v), inside = true;
      for (var k = 0; k < v.length; k++) if (n[k][0] * (x - v[k][0]) + n[k][1] * (y - v[k][1]) > 0) { inside = false; break; }
      if (inside) out.push(b.id);
    }
    return out;
  }
  function impulseAt(w, id, ix, iy, px, py) {
    var b = find(w, id); if (!b || b.type !== "dynamic") return;
    var m = massOf(b); b.vx += num(ix, 0) * m.im; b.vy += num(iy, 0) * m.im;
    if (typeof px === "number" && typeof py === "number") b.av += m.ii * cross(px - b.x, py - b.y, num(ix, 0), num(iy, 0));
  }
  return { world: world, add: add, remove: remove, get: find, joint: joint, step: step, touching: touching, at: at, impulse: impulseAt,
    vertices: function (b) { return b && b.shape !== "circle" ? verts(b) : null; } };
})();
`;
