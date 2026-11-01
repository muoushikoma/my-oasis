<!-- 代码 PR 模板 / Code PR template. 故事投稿请用默认模板 / For story submissions use the default template. -->

## 改了什么、为什么 / What & why


## 测试平台 / Tested on
- [ ] Windows
- [ ] 安卓 / Android
- [ ] 只跑了自动测试 / Automated tests only

## 截图或录屏 / Screenshots or video
<!-- 界面改动必填 / Required for UI changes -->

## 自检 / Checklist
- [ ] `pnpm typecheck` 和 `pnpm test` 通过 / pass
- [ ] 改了 schema 已运行 `gen:validator` / regenerated validator if schema changed
- [ ] 新增或修改的脚本 API 已更新 `docs/story-format.md` 和 `docs/ai-authoring-guide.md`，并补了测试 / docs + tests for script API changes
- [ ] 不会让已有故事坏掉；需要时已升级格式版本 / backward compatible, format version bumped if needed
- [ ] 界面文字中英双语 / bilingual UI text
- [ ] 遵守 CONTRIBUTING.md 的硬性规则（沙箱、无 eval、CSP、脚本无 HTML/网络/剪贴板读取/文件、玩家随时能退出、Key 不离开设备、AI 权限检查、token 只在本机、无遥测、确定性）/ follows the hard rules in CONTRIBUTING.md
- [ ] 没有密钥或隐私信息，没有 ≥100MB 的文件 / no secrets, no files ≥100MB
- [ ] 同意以 MIT 许可证授权本贡献 / I license this contribution under MIT
