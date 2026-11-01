# 给 AI 编程助手的说明（AGENTS.md）

本仓库是“我的绿洲”：AI 驱动冒险故事平台的客户端（Tauri 2）、规则引擎、校验器和公开故事库。改代码前先看这份。

## 目录

- `apps/desktop/`：客户端（Vite + TS 前端，`src-tauri/` 是 Rust 端）
  - `src/custom-ui.ts`：自定义组件沙箱（iframe、CSP、`oasis-ui/1` 桥接）
  - `game-runtime/`：2D 游戏运行时（PixiJS + Rapier），由 `build.mjs` 用 esbuild 打成字符串，经虚拟模块 `virtual:oasis-game-runtime` 懒加载
- `packages/schema/`：JSON Schema + 校验器（`src/validate.ts`）。改了 `src/story.schema.json` 后：复制到 `docs/schema/story.schema.json`，再跑 `node packages/schema/scripts/gen-validator.mjs` 重新生成预编译校验器
- `packages/engine/`：规则引擎；`crates/oasis-native/`：Rust 本地能力
- `docs/`：规范（`ruleset-spec.md` 完整版、`story-format.md` 作者版）、设计说明 `DESIGN.md`
- `examples/`：示例故事（不进在线故事库）；`stories/`：公开故事库
- `tools/demo-art/`：示例故事的程序化美术/音效生成脚本

## 必须遵守

- **每个故事都必须接 AI**。游戏里的 AI 只能异步用（`game.ai.ask` / `game.ai.action`），不能放进实时循环。
- **不要放松沙箱**：自定义组件 iframe 只有 `allow-scripts`，CSP `default-src 'none'`，不能联网。不能加 `'unsafe-eval'`；`'wasm-unsafe-eval'` 只为 Rapier 的 wasm。`csp-no-eval.test.ts` 会检查构建产物里没有 `eval`/`new Function`。
- 不能让故事挡住客户端出口（按住 Esc、安卓返回、右上角 ⋯）。
- 虚拟按键默认不显示，作者显式声明才出现。
- 只收全年龄内容；示例素材必须原创（程序生成或自己画）。
- 文档、提交说明、PR 标题和描述用中文；`CHANGELOG.md` 的新条目写在 `## 未发布` 下。
- 发 PR 后不要自己合并，由维护者合并。

## 常用命令

```bash
pnpm install
pnpm typecheck && pnpm test                 # TS 类型检查 + vitest
pnpm --filter @my-oasis/desktop build       # 前端构建（会打包游戏运行时）
cargo test -p oasis-native                  # Rust
node packages/schema/scripts/gen-validator.mjs --check   # 预编译校验器与 schema 同步
pnpm oasis validate examples/ember-corridor # 校验一个故事包
node tools/demo-art/ember-corridor.mjs      # 重新生成演示美术/音效
```
