// 规范 §2.2 的安全表达式小语言：解析为 AST，求值由 evaluate() 完成。
export type Node =
  | { t: "lit"; v: unknown }
  | { t: "id"; name: string }
  | { t: "mem"; obj: Node; prop: string }
  | { t: "call"; fn: string; args: Node[] }
  | { t: "list"; items: Node[] }
  | { t: "obj"; entries: [string, Node][] }
  | { t: "un"; op: string; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "tern"; c: Node; a: Node; b: Node };

export class ExprError extends Error {
  constructor(message: string, public pos: number) { super(message); }
}

type Tok = { k: "num" | "str" | "id" | "op" | "eof"; v: string; pos: number };

const OPS = ["&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "<", ">", "!", "?", ":", "(", ")", "[", "]", "{", "}", ",", "."];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ k: "num", v: m[0], pos: i }); i += m[0].length; continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) { j++; } s += src[j]; j++; }
      if (j >= src.length) throw new ExprError("文字缺少结尾的引号", i);
      out.push({ k: "str", v: s, pos: i }); i = j + 1; continue;
    }
    if (/[A-Za-z_\u4e00-\u9fff]/.test(c)) {
      const m = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*/.exec(src.slice(i))!;
      out.push({ k: "id", v: m[0], pos: i }); i += m[0].length; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`看不懂的符号「${c}」`, i);
    out.push({ k: "op", v: op, pos: i }); i += op.length;
  }
  out.push({ k: "eof", v: "", pos: src.length });
  return out;
}

const PREC: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, in: 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

export function parseExpr(src: string): Node {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (v: string) => {
    const t = next();
    if (t.v !== v || (t.k !== "op")) throw new ExprError(`这里应该是「${v}」`, t.pos);
  };
  function primary(): Node {
    const t = next();
    if (t.k === "num") return { t: "lit", v: Number(t.v) };
    if (t.k === "str") return { t: "lit", v: t.v };
    if (t.k === "id") {
      if (t.v === "true") return { t: "lit", v: true };
      if (t.v === "false") return { t: "lit", v: false };
      if (t.v === "null") return { t: "lit", v: null };
      if (peek().v === "(" && peek().k === "op") {
        next();
        const args: Node[] = [];
        if (peek().v !== ")") { do { args.push(expr()); } while (peek().v === "," && next()); }
        expect(")");
        return { t: "call", fn: t.v, args };
      }
      return { t: "id", name: t.v };
    }
    if (t.k === "op") {
      if (t.v === "(") { const e = expr(); expect(")"); return e; }
      if (t.v === "[") {
        const items: Node[] = [];
        if (peek().v !== "]") { do { items.push(expr()); } while (peek().v === "," && next()); }
        expect("]");
        return { t: "list", items };
      }
      if (t.v === "{") {
        const entries: [string, Node][] = [];
        if (peek().v !== "}") {
          do {
            const k = next();
            if (k.k !== "id" && k.k !== "str") throw new ExprError("对象里应是「名字: 值」", k.pos);
            expect(":");
            entries.push([k.v, expr()]);
          } while (peek().v === "," && next());
        }
        expect("}");
        return { t: "obj", entries };
      }
      if (t.v === "!" || t.v === "-") return { t: "un", op: t.v, a: unary() };
    }
    if (t.k === "eof") throw new ExprError("表达式不完整", t.pos);
    throw new ExprError(`这里不应出现「${t.v}」`, t.pos);
  }
  function postfix(): Node {
    let n = primary();
    while (peek().k === "op" && peek().v === ".") {
      next();
      const id = next();
      if (id.k !== "id") throw new ExprError("「.」后面应是名字", id.pos);
      n = { t: "mem", obj: n, prop: id.v };
    }
    return n;
  }
  function unary(): Node {
    const t = peek();
    if (t.k === "op" && (t.v === "!" || t.v === "-")) { next(); return { t: "un", op: t.v, a: unary() }; }
    return postfix();
  }
  function binary(min: number): Node {
    let a = unary();
    for (;;) {
      const t = peek();
      const op = t.k === "op" || (t.k === "id" && t.v === "in") ? t.v : "";
      const pr = PREC[op];
      if (!pr || pr < min) return a;
      next();
      a = { t: "bin", op, a, b: binary(pr + 1) };
    }
  }
  function expr(): Node {
    const c = binary(1);
    if (peek().k === "op" && peek().v === "?") {
      next(); const a = expr(); expect(":"); const b = expr();
      return { t: "tern", c, a, b };
    }
    return c;
  }
  const e = expr();
  if (peek().k !== "eof") throw new ExprError(`多出来的内容「${peek().v}」`, peek().pos);
  return e;
}

export const BUILTIN_FUNCS = ["len", "has", "min", "max", "abs", "floor", "ceil", "round", "str", "num"];
export const RANDOM_FUNCS = ["rand", "randint", "pick", "weighted"];
export const DICE_FUNCS = ["roll", "roll_adv", "roll_dis"];

/** 遍历 AST，收集引用（供语义检查用） */
export function collectRefs(n: Node, out: { roots: Set<string>; paths: string[][]; calls: Set<string> } = { roots: new Set(), paths: [], calls: new Set() }) {
  const pathOf = (x: Node): string[] | null => x.t === "id" ? [x.name] : x.t === "mem" ? (pathOf(x.obj)?.concat(x.prop) ?? null) : null;
  switch (n.t) {
    case "id": out.roots.add(n.name); out.paths.push([n.name]); break;
    case "mem": { const p = pathOf(n); if (p) { out.roots.add(p[0]); out.paths.push(p); } else collectRefs(n.obj, out); break; }
    case "call": out.calls.add(n.fn); n.args.forEach((a) => collectRefs(a, out)); break;
    case "list": n.items.forEach((a) => collectRefs(a, out)); break;
    case "obj": n.entries.forEach(([, a]) => collectRefs(a, out)); break;
    case "un": collectRefs(n.a, out); break;
    case "bin": collectRefs(n.a, out); collectRefs(n.b, out); break;
    case "tern": collectRefs(n.c, out); collectRefs(n.a, out); collectRefs(n.b, out); break;
  }
  return out;
}

export type Scope = { vars: Record<string, unknown>; funcs: Record<string, (...a: any[]) => unknown> };

export function evaluate(n: Node, scope: Scope): any {
  switch (n.t) {
    case "lit": return n.v;
    case "id":
      if (!(n.name in scope.vars)) throw new Error(`找不到名字「${n.name}」`);
      return scope.vars[n.name];
    case "mem": {
      const o = evaluate(n.obj, scope);
      if (o === null || typeof o !== "object") throw new Error(`「${n.prop}」前面的值不是对象`);
      if (!Object.prototype.hasOwnProperty.call(o, n.prop)) return null;
      return (o as any)[n.prop];
    }
    case "call": {
      const f = scope.funcs[n.fn];
      if (!f) throw new Error(`不能使用函数「${n.fn}」`);
      return f(...n.args.map((a) => evaluate(a, scope)));
    }
    case "list": return n.items.map((a) => evaluate(a, scope));
    case "obj": return Object.fromEntries(n.entries.map(([k, a]) => [k, evaluate(a, scope)]));
    case "un": { const a = evaluate(n.a, scope); return n.op === "!" ? !a : -a; }
    case "tern": return evaluate(n.c, scope) ? evaluate(n.a, scope) : evaluate(n.b, scope);
    case "bin": {
      if (n.op === "&&") return evaluate(n.a, scope) && evaluate(n.b, scope);
      if (n.op === "||") return evaluate(n.a, scope) || evaluate(n.b, scope);
      const a = evaluate(n.a, scope), b = evaluate(n.b, scope);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": if (b === 0) throw new Error("不能除以 0"); return a / b;
        case "%": if (b === 0) throw new Error("不能除以 0"); return a % b;
        case "==": return deepEq(a, b);
        case "!=": return !deepEq(a, b);
        case "<": return a < b;
        case "<=": return a <= b;
        case ">": return a > b;
        case ">=": return a >= b;
        case "in": return Array.isArray(b) ? b.some((x) => deepEq(x, a)) : (b && typeof b === "object" ? a in b : false);
      }
    }
  }
  throw new Error("无法计算");
}

export function deepEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const builtinFuncs: Scope["funcs"] = {
  len: (x: any) => (Array.isArray(x) || typeof x === "string" ? x.length : x && typeof x === "object" ? Object.keys(x).length : 0),
  has: (l: any, x: any) => (Array.isArray(l) ? l.some((y) => deepEq(x, y)) : l && typeof l === "object" ? x in l : false),
  min: Math.min, max: Math.max, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  str: (x: any) => String(x), num: (x: any) => Number(x),
};
