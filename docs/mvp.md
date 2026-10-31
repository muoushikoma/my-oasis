# MVP 范围与路线（v0.6）

> **路线调整（2026-10-31）**：先只做**单机客户端**用于宣传试水。服务器、账号、上传、审核、云存档**全部暂停**，视试水反响再决定是否继续（相关设计保留在 [architecture.md](architecture.md) §4–§7 和 [server-api.md](server-api.md)，标为“暂停”）。

暂定事项：故事包后缀 `.oasis`；`mature` 暂不进官方示例/推荐；AI 默认权限 1 级；（将来的）后端 Node.js + TypeScript；英文名 My Oasis。

## 路线
| 阶段 | 内容 | 验收 | 状态 |
|---|---|---|---|
| **M1 引擎** | 格式规范 v0.3、JSON Schema；`packages/schema`（加载、结构+语义校验、大白话报错带行号、“请 AI 修改”文本）；`packages/engine`（状态、动作/事件、可复现随机数、结局、AI 任务卡与工具白名单强制校验、存档）；JS 脚本沙箱（QuickJS）；`packages/cli`（`oasis validate` / `oasis play`，可接 OpenAI 兼容接口） | 两个示例故事通过校验并可在命令行玩通；单元测试全部通过 | ✅ 完成 |
| **M2 单机 Windows 客户端** | Tauri 2；导入 `.oasis`/文件夹（拖入）；大白话报错 + 一键复制给 AI；填 API Key 存系统钥匙串（Windows 凭据管理器），Rust 侧代发模型请求；选模型（OpenAI 兼容 / OpenRouter / Ollama / LM Studio）；默认简约界面 + 作者布局（内置组件）；AI 流式输出与响应速度机制；本地存档、导出/导入存档；自带 1–2 个示例故事；Windows 安装包（GitHub Actions 配置先写好，不推送） | 在 Windows 上安装 → 导入/打开示例 → 填 Key → 玩完一局 → 存读档 | 🚧 进行中 |
| **宣传试水** | 发布安装包与 AI 创作指南，收集反馈 | 视反响决定下一步 | — |
| 之后（视反响） | 服务器（账号、故事上传下载与审核、云存档）、域名与备案、Lua/Python 脚本、地图/立绘组件、快慢双模型、macOS | — | ⏸ 暂停 |

## M2 范围
**做**
- 故事：导入（文件夹、`.oasis`/`.zip`、拖入、粘贴 story.yaml）、校验、大白话报错（文件+行号+怎么改+“复制给 AI”）、试玩调试面板（状态、随机数、AI 工具调用、越权记录）
- AI：一个故事一个模型；Key 只存系统钥匙串，前端拿不到原文；流式输出；同一操作多接入点按优先级执行、并发上限 2、首字超时重试 1 次、单次操作调用上限
- 界面：默认简约模板；作者 `ui`（内置模板 + custom 网格；组件 text-log、text-input、button、choice-buttons、stat-list、stat-bar、item-list、chat-box、text-block、image、dice-log）；主题；玩家可改主题与布局、关闭可选 AI 组件
- 存档：本地多槽位、自动存档、导出/导入存档文件
- 脚本：JavaScript（QuickJS）
- 自带示例：《守灯人（迷你版）》《三个箱子》

**不做（M2）**：服务器相关一切、内置编辑器、Lua/Python、自定义组件、地图/立绘、自动更新、代码签名证书（试水阶段可先不签，安装时会有 SmartScreen 提示）

## 不做什么（任何阶段）
- 成人内容
- 客户端内置故事编辑器（作者在客户端外制作故事包）
