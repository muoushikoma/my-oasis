# 无尽之路 / The Endless Road

一条没有尽头的路，从左往右一直走。每走一里吃掉 1 份口粮，并遇到一个新事件：敌人、险境、宝藏、路人、行商、奇遇或安全的营地。看你能走多远。

A road with no end, walked left to right. Every mile costs a ration and brings a new event. See how far you can go.

## 规则（简化 D&D 5e）

- 开局掷属性（4d6 去掉最低），生命 = 14 + 体质调整值，长剑 1d10 + 力量/敏捷调整值。
- 攻击和检定：d20 + 调整值 + 熟练加值，对抗 AC / DC；20 自动成功、伤害骰翻倍，1 自动失败。
- 升级：生命 +1d10 + 体质；4、8、12…级攻击属性 +2；5 级起每回合攻击两次。
- 资源：口粮（每里 1 份，吃完会饿掉血）、治疗药水、金币（行商处买口粮、药水、升级装备）。
- 扎营：每里一次，消耗 1 份口粮，恢复一半生命，有 20% 概率夜袭；安全营地免费且回满。
- 每 25 里有一个守关者；地区每 10 里变换一次；威胁随里程增长，后期越来越快。
- 最远纪录保存在本机（`api.storage`），不随读档回滚。

## AI 负责什么

遭遇的**类型和强度由引擎掷骰**，数值（血量、伤害、奖励多少）全部由规则计算，AI 改不了。AI（`road_event` 接入点，裁量权 0 级）只负责：

- 给遭遇起名字、写 2~3 句描述；
- 挑检定用哪项属性、“应对”要做什么、成功时拿到哪类奖励、谈崩了会不会动手；
- **挑画面模块**（见下），拼出这一幕。

没连 AI 也能玩：用内置的名字和画面。倒下时还有一段可选的 AI 墓志铭；每进入一个新地区，会触发一次 AI 生图（`ai.images.vista`，客户端支持后生效，现在显示替代图）。

## 画面模块

画面是 256×144 的像素画布（`scripts/scene.js`），每一帧由这些模块叠出来：

| 层 | 模块 | 谁来选 |
|---|---|---|
| 背景 | 6 个地区 × 4 层（`sky` 天空、`far` 远景、`mid` 中景、`ground` 地面与路），走路时视差卷动 | 规则（地区） |
| 主体 | 敌人 `wolf` `spider` `bandit` `skeleton` `troll` `drake` `ooze` `wisp` `warden`；场景 `chasm` `rocks` `thorns` `chest` `cart` `shrine` `campfire` `stranger` | AI（规则先给默认值，限定白名单） |
| 染色 | `none` `red` `green` `blue` `gold` `shadow` `pale` `purple` | AI |
| 时间 | `day` `dusk` `night` | AI（默认随里程循环） |
| 天气 | `clear` `rain` `snow` `fog` `embers` `fireflies` `leaves`（粒子） | AI（默认随地区） |
| 主角 | 站立、走路 4 帧、攻击 | 规则 |

新遭遇先以剪影出现，AI 写好后现形（没有 AI 时 4 秒后自动现形）。战斗有挥剑、受击闪烁、飘字伤害和血条。

素材全部是逐像素手绘后由脚本生成的，源文件和加新精灵的方法见仓库 `tools/art/endless-road/`。

## 文件

```
story.yaml          主文件（规则、AI 接入点、界面）
scripts/road.js     规则：掷骰、战斗、检定、资源、升级、AI 输出的白名单校验
scripts/scene.js    画面：模块合成、动画、天气、时间
assets/bg/          背景分层
assets/sprites/     精灵（主角 6 帧，篝火 2 帧）
assets/cover.png    封面；assets/vista.png 生图失败时的替代图
```
