import { defineConfig, type Plugin } from "vite";
// @ts-ignore 纯 JS 构建脚本
import { buildGameRuntime } from "./game-runtime/build.mjs";

/** 游戏运行时（§13.6）作为字符串打进客户端，注入 runtime: game 的自定义组件 */
function gameRuntime(): Plugin {
  const id = "virtual:oasis-game-runtime", rid = "\0" + id;
  return {
    name: "oasis-game-runtime",
    resolveId: (s) => (s === id ? rid : undefined),
    async load(s) { if (s !== rid) return; return `export default ${JSON.stringify(await buildGameRuntime())};`; },
  };
}
export default defineConfig({
  clearScreen: false,
  plugins: [gameRuntime()],
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4096 },
  optimizeDeps: { exclude: ["quickjs-emscripten"] },
});
