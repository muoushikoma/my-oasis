# 更新记录 / Changelog

## 未发布

- **玩之前就能看到故事的关键信息**：`meta.languages` 改为支持的语言列表（如 `[zh, en, ja]`，旧写法 `language: zh-CN` 仍可用）；新增 `meta.ai_role`（AI 在故事里做什么，中英双语）、`meta.est_tokens_per_min`（每分钟大约多少 token）、`meta.description`（详情页长介绍）。投稿故事库时 `languages`、`ai_role`、`est_minutes`、`est_tokens_per_min` 必填。
- 发布页和客户端（在线故事库、我的故事库）：列表卡片只显示名称、标签、简介；点开是详情页，显示简介、长介绍、AI 做什么、语言、时长、每分钟 token（约 2000 token/分钟）、平台、内容提示、作者、版本，以及下载/收藏/点赞等按钮。客户端会记录本机游玩时长，玩够 2 分钟后显示你自己实测的每分钟 token。
- 投稿检查（`stories-validate`）现在会对每个故事跑和客户端一样的完整校验器（必须接 AI、动作/结局、自定义组件规则……），有错误就不通过；错误提示里列出 html/htm/css 等允许的文件类型。
- 中文、日文 README 补上自定义组件的说明。

- **自定义组件（`ui` 组件 `type: custom`）**：作者在故事包里自带 HTML/JS/CSS，客户端放进无同源权限的沙箱 iframe（`allow-scripts`，CSP `default-src 'none'`，不能联网；桌面/安卓经独立的 `oasisui:` 协议加载）。组件只能通过 `postMessage` 桥接协议 `oasis-ui/1`（`window.oasis`）读取玩家可见的状态、订阅变化、调用声明过的动作（`actions`）、发出声明过的事件（`emits`，触发 `ui:<id>.<事件>`）、读语言和 `config`、调整高度；拿不到 Key、令牌、文件和 Tauri 命令。设置里可以全局关闭，关闭时显示 `fallback`。校验器检查文件存在、引用文件、外网引用、大小（≤ 8 MB）、声明的动作和事件。示例 `tests/fixtures/custom-ui-mini/`。

- **每个故事都必须接 AI**：`ai` 变为必填，且至少要有一个 AI 接入点（`ai.entry_points`），否则校验报错 `ai_required`；平台不再收纯规则故事。AI 失败/超时时的 fallback 替代文字、可关闭的 AI 生图仍然保留。
- 客户端：没接好 AI（没填 Key、也没设置本地模型）时，开始游玩前会提示先去“设置”接 AI；去掉“纯规则”标签，首次向导文案同步。
- 文档、README、发布页、测试样例与示例故事同步更新。
- 故事可以在 `meta.platforms` 声明支持的平台（`desktop` 电脑 / `mobile` 手机，可两者都写；不写 = 两端都支持）。
- 客户端“我的故事库”和“在线故事库”只列出当前设备能玩的故事，并拦住加载不支持本机的故事（创作里试玩不拦）；故事卡片和发布页显示支持平台。
- 屏幕虚拟摇杆/按钮默认不在电脑上显示，只在手机上显示；“设置”里可改成总是显示或不显示。
- 收藏：只保存在本机（localStorage），可以“只看收藏”，本地故事库里收藏的排在前面。
- 点赞：用 GitHub 👍 reaction 计数。每个故事在仓库里有一个点赞帖 Issue（标题 `[likes] <id>`，标签 `story-likes`），由 `stories-publish` 工作流自动创建；玩家登录 GitHub 后点赞/取消，计数所有玩家共享，不需要服务器。
