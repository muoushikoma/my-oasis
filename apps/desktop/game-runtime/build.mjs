// 把游戏运行时（PixiJS + Rapier + 本目录代码）打成一个 IIFE 字符串，客户端内联进 runtime: game 的自定义组件。
// 被 vite.config.ts 的虚拟模块 virtual:oasis-game-runtime 调用；也可以单独运行：node game-runtime/build.mjs [输出文件]
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
export async function buildGameRuntime() {
  const r = await build({
    entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    bundle: true, format: "iife", minify: true, write: false, target: "es2020", legalComments: "none", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  // PixiJS 里还留着 new Function 的默认实现（被 pixi.js/unsafe-eval 替换后不会再调用）；
  // 换成直接抛错的桩，保证产物里没有任何 eval 入口（沙箱 CSP 本来也禁止）。
  const text = r.outputFiles[0].text.replace(/new\s+Function\s*\(/g, "__oasisNoEval(");
  return `function __oasisNoEval(){throw new Error("eval 已禁用（CSP）")}\n${text}`;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await buildGameRuntime();
  if (process.argv[2]) writeFileSync(process.argv[2], code);
  console.log(`游戏运行时：${(code.length / 1024).toFixed(0)} KB`);
}
