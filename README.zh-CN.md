[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

# 我的绿洲（内部）

> **私有闭源项目，仅限内部使用，请勿外传。**

“我的绿洲”是一个 AI 驱动冒险故事的平台。玩家在**桌面客户端**里下载并游玩故事；创作者在客户端外做好故事包，再用客户端导入、试玩和上传。

## 组成
- **桌面客户端**（Tauri 2，首发 Windows）：本地规则引擎、作者定义的 AI 接入点（一个故事一个 AI 模型）、故事导入、检查（大白话报错）、试玩、上传。**不内置编辑器**：作者在客户端外制作故事包，可手写，或把 [AI 创作指南](docs/ai-authoring-guide.md) 交给聊天 AI 生成。界面由作者定义，没定义则用简约模板。
- **服务器**（自建，阿里云 ECS，大陆节点）：账号、故事上传/审核/下载、用户数据（作品、下载记录、云存档）。
- **玩家自带 AI**：自己的 API Key 或本地模型；Key 只存本机系统钥匙串，绝不上传服务器。

## 设计要点
- 规则、界面、哪里用 AI 全部由作者定义，平台不内置固定玩法（骰子等只是可选模板）；引擎强制执行规则，每个 AI 接入点只能在作者授予的权限内行事。
- 服务器地址不写死，来自签名、可远程更新的引导配置。
- IP 测试阶段使用自签证书 + 客户端公钥固定；密码绝不明文传输，服务端用 argon2id 存储。
- 内容遵守大陆法规（实名、备案、内容审核），不接受成人内容。

## 状态
M1（引擎、校验器、命令行）已完成；M2（单机 Windows 客户端）进行中。服务器相关功能**暂停**，先发单机版试水。

## 开发
```bash
pnpm install
pnpm test                                  # 单元测试
pnpm oasis validate examples/lighthouse-mini
pnpm oasis play tests/fixtures/guess-the-box     # 文字版试玩
# 接 AI（OpenAI 兼容接口）：设置环境变量 OASIS_API_KEY、OASIS_BASE_URL、OASIS_MODEL
```
不要提交任何 API Key，Key 只从环境变量读取。

## 文档
- [项目说明](docs/overview.md)
- [整体架构](docs/architecture.md)
- [服务器 API 与数据设计](docs/server-api.md)
- [故事包格式规范](docs/ruleset-spec.md)
- [JSON Schema](docs/schema/story.schema.json)
- [AI 创作指南](docs/ai-authoring-guide.md)
- [MVP 与里程碑](docs/mvp.md)
