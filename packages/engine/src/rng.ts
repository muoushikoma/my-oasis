/** 可复现随机数：mulberry32，状态只有一个 32 位整数，便于存档 */
export class Rng {
  constructor(public s: number) { this.s = s >>> 0; }
  static seed(seed?: number | "auto") {
    const v = typeof seed === "number" ? seed : (Math.random() * 2 ** 32) >>> 0; // 仅用于生成种子
    return new Rng(v);
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a: number, b: number) {
    a = Math.ceil(a); b = Math.floor(b);
    if (a > b) throw new Error(`randint(${a}, ${b})：前一个数不能大于后一个数`);
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick<T>(xs: T[]): T {
    if (!Array.isArray(xs) || !xs.length) throw new Error("pick() 需要一个非空列表");
    return xs[this.int(0, xs.length - 1)];
  }
  weighted(m: Record<string, number>): string {
    const es = Object.entries(m ?? {}).filter(([, w]) => w > 0);
    const tot = es.reduce((s, [, w]) => s + w, 0);
    if (!tot) throw new Error("weighted() 需要至少一个正权重");
    let r = this.next() * tot;
    for (const [k, w] of es) { if ((r -= w) < 0) return k; }
    return es[es.length - 1][0];
  }
}

/** 官方模板 oasis/dice@1：NdM+K */
export function rollDice(rng: Rng, expr: string) {
  const m = /^\s*(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(String(expr));
  if (!m) throw new Error(`骰子写法「${expr}」看不懂，应写成如 '2d6+3'`);
  const n = m[1] ? Number(m[1]) : 1, faces = Number(m[2]), mod = m[3] ? Number(m[3].replace(/\s/g, "")) : 0;
  if (n < 1 || n > 100 || faces < 2 || faces > 1000) throw new Error(`骰子「${expr}」个数或面数超出范围`);
  const rolls = Array.from({ length: n }, () => rng.int(1, faces));
  return { expr, rolls, total: rolls.reduce((a, b) => a + b, 0) + mod };
}
