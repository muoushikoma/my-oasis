# 参与贡献 / Contributing

[简体中文](#简体中文) | [English](#english)

---

## 简体中文

感谢你愿意帮助「我的绿洲」！本项目是非营利的开源故事引擎。贡献分两类：

- **A. 客户端与引擎代码**（`apps/`、`packages/`、`crates/`、`tools/`、`docs/` 等）
- **B. 故事**（`stories/`）

### A. 客户端与引擎代码

#### 流程
1. Fork 本仓库，在你的副本里从最新的 `main` 新建分支（如 `feat/overlay-slider`、`fix/android-ime`）。
2. 修改代码，补测试和文档。
3. 向本仓库 `main` 提 Pull Request，使用**代码 PR 模板**：在 PR 链接末尾加 `?template=code.md`，或把 [.github/PULL_REQUEST_TEMPLATE/code.md](.github/PULL_REQUEST_TEMPLATE/code.md) 的内容复制到描述里。（默认模板是故事投稿用的。）
4. 一个 PR 只做一件事；大改动请先开 Issue 讨论。

#### 本地环境
- Node.js 20+ 与 **pnpm**
- **Rust 1.87+**（依赖要求，低版本无法编译）
- **Tauri 2** 的系统依赖（见 https://v2.tauri.app/start/prerequisites/ ）
- 安卓构建：**Android SDK**、NDK、JDK 17

#### 常用命令
```bash
pnpm install
pnpm typecheck                                  # TypeScript 类型检查
pnpm test                                       # 单元测试（vitest）
cargo test -p oasis-native                      # Rust 测试
pnpm --filter @my-oasis/schema gen:validator    # 改了 schema 后必须重新生成预编译校验器
pnpm --filter ./apps/desktop build              # vite build 前端
pnpm bench                                      # 脚本沙箱性能测试，性能相关改动请附结果
pnpm oasis validate examples/lighthouse-mini    # 校验示例故事
npm ci --prefix tools/stories && node tools/stories/validate.mjs   # 校验 stories/
```

#### 代码风格与提交信息
- TypeScript 严格模式，沿用周围代码的风格；不引入无必要的依赖。
- Rust 用 `cargo fmt`，尽量通过 `cargo clippy`。
- 提交信息用「范围：说明」格式，中文或英文都可以，例如：`引擎：新增 api.overlay 滑块`、`客户端：修复安卓软键盘遮挡`、`docs: explain api.storage limits`。常用范围：引擎 / 客户端 / 格式 / 文档 / CI / 工具。

#### PR 要求
- 说明**改了什么、为什么改**；
- 界面相关改动附**截图或录屏**；
- 写明在哪些平台测试过（Windows / 安卓 / 只跑了自动测试）；
- 新增或修改脚本 API 时，**必须同步更新** [docs/story-format.md](docs/story-format.md) 和 [docs/ai-authoring-guide.md](docs/ai-authoring-guide.md)，并**补测试**；
- **向后兼容**：不能让已有故事坏掉。确实要改行为时，升级格式版本（如 `oasis/0.4` → `oasis/0.5`），旧版本保持原行为。

#### 硬性规则（违反则 PR 会被拒绝）
1. **沙箱与安全**：故事脚本只能在 QuickJS 沙箱里运行；客户端不得使用 `eval` / `new Function`；不得放宽 CSP（不允许 `unsafe-eval`）。
2. **脚本能力边界**：脚本不能插入原始 HTML、不能联网、不能读取剪贴板、不能访问文件系统。
3. **玩家随时能退出**：长按 Esc、安卓返回手势、角落的 ⋯ 按钮和暂停菜单必须始终可用，故事不能遮挡或拦截这些出口。
4. **AI 与密钥**：一个 AI 配一个 Key；API Key 只存在本机安全存储里，除了发给玩家选定的 AI 服务商，绝不离开设备。
5. **AI 权限检查**不能被绕过或削弱。
6. **token 用量只保存在本机**。
7. **不加任何遥测**或数据收集。
8. **确定性**：脚本里不能用真实时间或 `Math.random`，只能用引擎提供的时间和随机数。
9. **界面文字中英双语**。
10. **不提交任何密钥**、密码、token 或个人隐私信息。
11. **不提交 100MB 及以上的文件**（不使用 Git LFS）。
12. **不得放宽故事包体积上限**（图片 10MB、音频 30MB、整包 300MB、最多 2000 个文件），除非维护者事先同意。

### B. 故事
请按 README 的「怎么投稿」流程：推荐在客户端里「创作 → 投稿到故事库」一键投稿，或手动把故事放进 `stories/<故事id>/` 后提 PR。格式见 [docs/story-format.md](docs/story-format.md)，提交时按默认的 [PR 模板](.github/pull_request_template.md) 勾选自检清单。故事库只收全年龄作品，名称、简介和 3 个标签都要中英双语。

### 审核
- 自动检查（CI）必须全部通过；
- 由维护者 **家驹** 亲自审核并决定是否合并，机器人不会合并 PR；
- 维护者可能要求修改，也可能拒绝不符合项目方向的改动。

### 许可证
代码贡献按本仓库的 [MIT 许可证](LICENSE) 发布；提交即表示你同意以 MIT 许可证授权你的贡献。故事的版权归作者，授权方式见 [stories/LICENSE.md](stories/LICENSE.md)。

### 行为准则与安全
- 参与即表示遵守 [行为准则](CODE_OF_CONDUCT.md)。
- 发现安全漏洞**不要公开开 Issue**，请按 [SECURITY.md](SECURITY.md) 通过 GitHub 私密漏洞报告提交。

---

## English

Thanks for helping My Oasis, a non-profit open-source story engine. There are two kinds of contribution:

- **A. Client and engine code** (`apps/`, `packages/`, `crates/`, `tools/`, `docs/`, ...)
- **B. Stories** (`stories/`)

### A. Client and engine code

#### Workflow
1. Fork the repo and create a branch from the latest `main` (e.g. `feat/overlay-slider`, `fix/android-ime`).
2. Make your change, with tests and docs.
3. Open a Pull Request to `main` using the **code PR template**: append `?template=code.md` to the PR URL, or paste [.github/PULL_REQUEST_TEMPLATE/code.md](.github/PULL_REQUEST_TEMPLATE/code.md) into the description. (The default template is for story submissions.)
4. One PR, one purpose. Open an issue first for large changes.

#### Local setup
- Node.js 20+ and **pnpm**
- **Rust 1.87+** (required by dependencies)
- **Tauri 2** system prerequisites (https://v2.tauri.app/start/prerequisites/)
- Android builds: **Android SDK**, NDK, JDK 17

#### Commands
```bash
pnpm install
pnpm typecheck                                  # TypeScript type check
pnpm test                                       # unit tests (vitest)
cargo test -p oasis-native                      # Rust tests
pnpm --filter @my-oasis/schema gen:validator    # regenerate the precompiled validator after schema changes
pnpm --filter ./apps/desktop build              # vite build of the frontend
pnpm bench                                      # sandbox benchmark; attach results for perf changes
pnpm oasis validate examples/lighthouse-mini    # validate an example story
npm ci --prefix tools/stories && node tools/stories/validate.mjs   # validate stories/
```

#### Code style and commit messages
- Strict TypeScript; follow the surrounding style; avoid unnecessary dependencies.
- Rust: `cargo fmt`, and keep `cargo clippy` clean where practical.
- Commit messages use `scope: description`, in Chinese or English, e.g. `引擎：新增 api.overlay 滑块`, `client: fix Android IME overlap`. Common scopes: engine / client / format / docs / ci / tools.

#### PR requirements
- Explain **what changed and why**;
- Include **screenshots or video** for UI changes;
- State which platforms you tested on (Windows / Android / automated tests only);
- Any new or changed script API **must** update [docs/story-format.md](docs/story-format.md) and [docs/ai-authoring-guide.md](docs/ai-authoring-guide.md), **with tests**;
- **Backward compatibility**: never break existing stories. If behavior must change, bump the format version (e.g. `oasis/0.4` → `oasis/0.5`) and keep the old behavior for old versions.

#### Hard rules (PRs that break these will be rejected)
1. **Sandbox and security**: story scripts run only in the QuickJS sandbox; no `eval` / `new Function` in the client; never loosen the CSP (no `unsafe-eval`).
2. **Script capability limits**: scripts get no raw HTML, no network, no clipboard read, no file access.
3. **The player can always exit**: hold Esc, the Android back gesture, the corner ⋯ button and the pause menu must always work; a story can't cover or intercept them.
4. **AI and keys**: one AI with one key; the API key lives only in the device's secure storage and never leaves the device except to the provider the player chose.
5. **AI permission checks** must not be bypassed or weakened.
6. **Token usage is stored only locally.**
7. **No telemetry** or data collection of any kind.
8. **Determinism**: no real time or `Math.random` in scripts; use the engine's time and RNG.
9. **UI text must be bilingual** (zh + en).
10. **No secrets** (keys, passwords, tokens, personal data) in commits.
11. **No files of 100MB or more** (no Git LFS).
12. **Package size limits** (image 10MB, audio 30MB, package 300MB, 2000 files) must not be raised without the maintainer's prior agreement.

### B. Stories
Follow "Submit a story" in the README: submit from the app (Create → Submit to library), or put your story in `stories/<story-id>/` and open a PR. See [docs/story-format.md](docs/story-format.md) and fill in the default [PR template](.github/pull_request_template.md) checklist. All-ages only; title, summary and exactly 3 tags must be bilingual.

### Review
- CI must pass;
- The maintainer **家驹** reviews and decides personally, and merges himself; bots never merge PRs;
- Changes may be requested, or a PR may be declined if it doesn't fit the project.

### License
Code contributions are released under the repository's [MIT License](LICENSE); by submitting you agree to license your contribution under MIT. Stories remain their authors' copyright; see [stories/LICENSE.md](stories/LICENSE.md).

### Code of conduct and security
- By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Do not open public issues for vulnerabilities**; report them privately via GitHub private vulnerability reporting, see [SECURITY.md](SECURITY.md).
