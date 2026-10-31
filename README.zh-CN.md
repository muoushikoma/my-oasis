[English](README.md) | 简体中文 | [日本語](README.ja.md)

# 我的绿洲

非盈利开源项目。“我的绿洲”是一个 AI 驱动冒险故事的平台：**规则由故事作者决定**，平台不内置骰子、属性等固定玩法；作者明确规定哪些内容是固定的、哪些交给 AI，以及每个 AI 环节的任务、自由裁量程度和必须遵守的规则。玩家不能越出故事的规则。

- 🌐 故事发布页：<https://muoushikoma.github.io/my-oasis/>
- ⬇️ 客户端下载（Windows / 安卓）：[Releases](https://github.com/muoushikoma/my-oasis/releases/latest)

本仓库同时存放**客户端源代码**和**公开故事库**（`stories/`）。

## 怎么玩

1. 安装客户端。第一次打开时按向导接入你自己的 AI（DeepSeek、通义千问、Kimi、OpenAI 等，或本地模型）；纯规则的故事不需要 AI。
2. 打开“游玩 → 在线故事库”，**不用登录**就能浏览、下载、游玩。客户端读的是本仓库 `main` 分支的 `index.json` 和 `stories/`。
3. 列表打不开？在顶部换“线路”：GitHub 直连、jsDelivr 加速、GitHub Pages，或填自己的镜像/代理地址。
4. 也可以在发布页直接下载 `.oasis` 文件，在客户端里导入。

## 怎么投稿

**推荐：在客户端里一键投稿**
1. “创作 → 投稿到故事库”，点“用 GitHub 登录”（免费账号即可），在浏览器里输入客户端显示的验证码。
2. 选择故事包或草稿，客户端会先检查格式，然后自动帮你复制仓库、建分支、提交投稿（PR），并显示审核状态。

**手动：在 GitHub 网页上投稿**
1. Fork 本仓库，在你的副本里把故事放进 `stories/<故事id>/`（文件夹名 = `story.yaml` 里的 `meta.id`）。
2. 向本仓库 `main` 提 Pull Request，按模板勾选自检清单。

之后：系统自动检查（来自 fork 的投稿**只能改动 `stories/`**），维护者审核通过并合并后，故事目录和发布页会自动更新。没合并的投稿不会出现在客户端里。

### 内容规则
- **不收色情内容**，分级只接受 `all-ages`（全年龄）和 `teen`（青少年）；不收血腥猎奇、仇恨、违法内容和他人隐私。
- 只上传自己创作或有权使用的文字、图片和音乐；绝对不要放 API Key 或密码。
- 维护者有权拒绝或下架任何故事。

## 许可证与版权

- **代码**：[MIT 许可证](LICENSE)。
- **故事**：`stories/` 里每个故事的版权**归各自作者所有**，不适用 MIT 许可证。投稿即表示你授予本项目一项免费、非独占、全球范围、可撤回（下架）的许可：在本仓库、发布页和客户端里存储、展示、分发你的故事（包括为分发而做的格式转换和打包）。详见 [stories/LICENSE.md](stories/LICENSE.md)。

## 仓库结构

```
apps/desktop/         客户端（Tauri 2：Windows + 安卓）
packages/             schema（校验）、engine（规则引擎）、cli
crates/oasis-native/  本地能力：故事包读取、存档、模型请求、GitHub 登录与投稿（Key/token 不出 Rust）
docs/                 故事包格式规范、AI 创作指南、JSON Schema
stories/<id>/         已上架的故事
index.json            故事目录（合并后自动生成，请勿手改）
site/                 故事发布页模板（GitHub Pages 自动部署）
tools/stories/        投稿检查、生成目录与发布页的脚本
```

## 开发

```bash
pnpm install
pnpm typecheck && pnpm test
cargo test -p oasis-native
pnpm oasis validate examples/lighthouse-mini
npm ci --prefix tools/stories && node tools/stories/validate.mjs   # 检查 stories/
```
API Key、GitHub token 只存在系统安全存储里（Windows 凭据管理器 / 安卓 Keystore），请求由 Rust 端代发。绝不要提交任何 Key 或密码。

## 文档
[概览](docs/overview.md) · [架构](docs/architecture.md) · [故事包格式规范](docs/ruleset-spec.md) · [JSON Schema](docs/schema/story.schema.json) · [AI 创作指南](docs/ai-authoring-guide.md)
