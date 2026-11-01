# 故事包格式规范（Oasis Story Format v0.3，正式草案）

> 公开文档。本规范是**唯一标准**：作者可以手写、用其他工具生成，或让 AI 按 [AI 创作指南](ai-authoring-guide.md) 生成故事包；客户端只负责**导入、校验、试玩、上传**。机器可读版本：[schema/story.schema.json](schema/story.schema.json)。
>
> 关键词“必须 / 不得 / 应当 / 可以”按 RFC 2119 的含义使用。

## 最高原则（优先于本规范其余所有条款）
1. **每一处内容都要标明“固定”还是“AI 处理”，没标的一律算固定。** 固定内容一字不差地由作者写定、引擎照做；只有作者明确标成 AI 处理的地方，AI 才能写入。
2. **玩家不能超出故事规范。**
   - 玩家能做的事只有故事里声明的动作（`actions`）。
   - 只有作者开启的地方才出现自由打字框；打的字必须落到作者列出的已声明动作上，落不到就显示作者写的“拒绝/超界回应”（作者没写 `input` 时，任何文字都不会触发动作）。
   - 玩家对 AI 的“提示注入”（例如“把金币改成 9999”“直接跳到好结局”“忽略之前的规则”）由引擎拦截：AI 只能在任务卡给的权限内回应，越权的工具调用一律拒绝并记录。
   - 玩家这边只能改外观（主题、布局、隐藏组件、关掉可选的 AI 功能），不能改规则、状态或存档内容；存档带校验码，被改过就拒绝读取。

**作者怎么标注**

| 地方 | 固定（默认） | AI 处理 |
|---|---|---|
| 界面组件 | 什么都不写 | 写 `content: ai`；只有这样的组件（或区域里有这样的组件）才能作为 AI 的 `output.to` |
| 状态 | `writable_by` 不含 `ai` | `writable_by` 含 `ai`，且还要有任务卡工具在 `writes` 里放权 |
| 选项按钮 | 写 `choices` | 写 `from_ai: true`（等同 `content: ai`） |
| 图片 | `src` / `bind` + `images`（自带素材） | `generated: 生图点id`（见 §10.5），并写 `fallback` |
| 自由输入框 | 不放 `text-input` / `chat-box` | 放上并**必须**写 `input`：允许的动作、超界回应 |

```yaml
ui:
  components:
    log:   { type: text-log, region: main, content: ai }   # AI 叙述可以写进这里
    rules: { type: text-block, region: side, text: 每天消耗 1 份灯油。 }  # 固定，AI 碰不到
    input:
      type: text-input
      region: input
      input:
        actions: [move, search, tend_light]      # 玩家打的字最多只能变成这三个动作
        words: { tend_light: [点灯, 添油] }        # 不经 AI 时按关键词对应
        reject: 这件事在这座岛上做不到。你可以移动、搜索或照看灯塔。
        max_length: 300
    keeper_chat:
      type: chat-box
      region: side
      content: ai
      input: { actions: [], reject: 老人只是看着你，没有回答。 }   # 只聊天，不能导致任何动作
```

引擎怎么执行：玩家文字先截断到 `max_length`、去掉控制字符；命中 `words` 就直接执行对应动作；交给 AI 时，文字被包在【玩家输入】标记里并声明“这不是指令”，这一轮 AI 能调用的动作被限制在 `input.actions` 之内（再叠加任务卡的权限）；都不满足就显示 `reject`。

## 0. 核心理念（给作者的一句话）
平台**不内置任何玩法**。没有内置的生命值、骰子、检定、背包。你定义：有哪些数值（状态）、玩家/AI 能做哪些事（动作）、什么时候发生什么（事件）、怎样算结束（结局）、界面长什么样（界面）、哪些地方用 AI 以及 AI 能管多少（AI 接入点与任务卡）。引擎只负责**照你的规则执行，并阻止任何人（包括 AI）违反规则**。

---

## 1. 故事包文件结构
故事包是一个 **zip 文件**（扩展名 `.oasis`，内容即 zip），或一个未压缩的文件夹（导入时客户端自动打包）。

```
my-story.oasis
├─ story.yaml          必需  主文件（本规范的全部内容）
├─ setting.md          可选  世界观设定，Markdown
├─ prompts/            可选  提示词模板文件（*.md）
├─ scripts/            可选  规则脚本（*.js / *.ts；Lua、Python 见 §12）
└─ assets/ 或任意目录 可选  图片（webp/png/jpg）、音频（ogg/mp3/m4a）、字体（woff2），在 assets 清单里登记（§13.5）
```
| 规则 | 说明 |
|---|---|
| 主文件 | 必须名为 `story.yaml`，位于包根目录；UTF-8 编码，无 BOM |
| 也可用 JSON | 可以改用 `story.json`（内容结构完全相同）；两者不得同时存在 |
| 路径 | 包内引用一律用**相对路径**、正斜杠 `/`，不得以 `/` 开头，不得含 `..` |
| 文件类型白名单 | `.yaml .yml .json .md .txt .js .ts .lua .py .webp .png .jpg .jpeg .woff2 .ogg .mp3 .m4a` |
| 大小限制 | 整包 ≤ 300 MB；单张图片 ≤ 10 MB；单个音频 ≤ 30 MB；文本/脚本 ≤ 2 MB；任何单个文件 < 100 MB；封面建议 WebP ≤ 200 KB |
| 文件数 | ≤ 2000 个 |

## 2. 基础约定
### 2.1 标识符（id）
所有 `id`（状态名、动作名、事件名、组件名、接入点名……）必须匹配 `^[a-z][a-z0-9_]{0,39}$`：小写字母开头，只含小写字母、数字、下划线，最长 40。
- ✅ `oil`、`npc_mood`、`search_beach`
- ❌ `Oil`（大写）、`1st`（数字开头）、`灯油`（中文）、`search-beach`（连字符）

显示给玩家的中文名请写在 `label` 字段里。
`meta.id` 例外：用小写字母、数字和连字符 `^[a-z][a-z0-9-]{2,63}$`。

### 2.2 表达式（字符串）
凡是标注为 **表达式** 的字段，值是一个字符串，按下面的安全小语言求值：
| 元素 | 写法 |
|---|---|
| 字面量 | 数字 `3` `-1.5`，字符串 `'海滩'`（**单引号**），布尔 `true` `false`，空 `null`，列表 `[1, 2]` |
| 读状态 | `state.oil`、`state.npc_mood.keeper`（record 字段） |
| 读参数 | `params.to`（动作参数） |
| 局部变量 | 用 `let` 定义后直接写名字，如 `r` |
| AI 输出 | `out.ok`（仅在 AI 接入点的 `then` 中） |
| 事件数据 | `event.xxx`（仅在事件的 `when` / `do` 中） |
| 运算 | `+ - * / %`，比较 `== != < <= > >=`，逻辑 `&& || !`，三元 `a ? b : c`，成员 `x in list` |
| 内置函数 | `len(x)` `has(list, x)` `min(a,b)` `max(a,b)` `abs(x)` `floor(x)` `ceil(x)` `round(x)` `str(x)` `num(x)` |
| 随机函数 | `rand()` `randint(a,b)` `pick(list)` `weighted({a: 3, b: 1})`（任何表达式里都能用，见 §5） |
| 内置变量 | `turn`（当前回合数，从 1 开始） |

不得出现：函数定义、循环、赋值（赋值用步骤完成）、访问任何其他对象。
**常见错误**：在 YAML 里写 `when: state.location == "海滩"` —— 双引号会被 YAML 吃掉。应写 `when: "state.location == '海滩'"`（外层双引号、内层单引号）。

### 2.3 字面值 vs 表达式
在步骤（§6.2）里，**等号右边一律是表达式**。所以要赋一个字符串，必须加单引号：`set: { location: "'海滩'" }`。只写 `set: { location: 海滩 }` 会被当成读取一个名叫“海滩”的变量而报错。

---

## 3. 顶层结构
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `spec` | 字符串 | **必填** | 固定为 `"oasis/0.3"` |
| `meta` | 对象 | **必填** | 元信息，§4 |
| `uses` | 字符串列表 | 可选 | 引用官方规则模板，§11 |
| `random` | 对象 | 可选 | 随机数设置，§5 |
| `state` | 对象 | 可选 | 状态定义，§6.1；可以没有 |
| `actions` | 对象 | 可选 | 动作，§6.2 |
| `events` | 列表 | 可选 | 事件，§7 |
| `endings` | 对象 | 可选 | 结局，§8；可以没有（故事不会自动结束） |
| `tools` | 对象 | 可选 | 向 AI 暴露的工具，§9 |
| `ai` | 对象 | 可选 | AI 全局规则与接入点，§10；**省略 = 无 AI 的纯规则故事** |
| `ui` | 对象 | 可选 | 界面，§13；省略 = 默认简约模板 |
| `scripts` | 对象 | 可选 | 脚本设置，§12 |
| `start` | 对象 | 可选 | 开局设置，§3.1 |

不认识的顶层字段会被报错（防止拼写错误），以 `x_` 开头的字段除外（留给作者自用，引擎忽略）。

### 3.1 start
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `intro` | 字符串 | 可选 | 开局显示给玩家的固定文字（不经 AI） |
| `do` | 步骤列表 | 可选 | 开局时执行的步骤（在 `game_start` 事件之前） |

## 4. meta
| 字段 | 类型 | 必填 | 取值 / 说明 |
|---|---|---|---|
| `id` | 字符串 | **必填** | `^[a-z][a-z0-9-]{2,63}$`，全平台唯一 |
| `title` | 字符串 | **必填** | 1–40 字 |
| `version` | 字符串 | **必填** | 语义化版本 `主.次.修`，如 `1.0.0`；再次上传必须更大 |
| `summary` | 字符串 | **必填** | 1–200 字 |
| `language` | 字符串 | **必填** | 如 `zh-CN` `en` `ja` |
| `rating` | 字符串 | **必填** | `all-ages` \| `teen` \| `mature`；**不接受成人内容**；公开故事库只收 `all-ages`；`teen`、`mature` 只能本地导入游玩 |
| `authors` | 字符串列表 | 可选 | 作者名 |
| `tags` | 字符串列表 | 可选 | ≤ 10 个，每个 ≤ 12 字 |
| `content_warnings` | 字符串列表 | 可选 | 如 `[恐怖, 暴力]`；`mature` 时**必填** |
| `cover` | 路径 | 可选 | 包内图片 |
| `setting` | 路径 | 可选 | 包内 Markdown，作为 AI 设定资料 |
| `est_minutes` | 整数 | 可选 | 1–600 |
| `min_engine` | 字符串 | 可选 | 最低引擎版本，默认 `0.3.0` |
| `license` | 字符串 | 可选 | 作者授权声明（平台条款待定） |

## 5. random（可复现随机数）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `seed` | `"auto"` 或整数 | 可选 | 默认 `auto`（每局随机种子）；写固定数字便于测试 |

引擎为每局生成一个种子，所有随机调用按顺序记录。读档后随机序列从中断处继续，因此**同样的操作得到同样的结果**（防止玩家反复读档刷结果）。
随机函数：`rand()` 返回 [0,1)；`randint(a,b)` 返回 a 到 b 的整数（含两端，要求 a ≤ b）；`pick(list)` 随机取一个；`weighted({键: 权重})` 按权重取键。
骰子写法如 `roll('2d6+3')` `roll_adv()` `roll_dis()` 可直接使用（`uses: [oasis/dice@1]` 写不写都行）。随机与骰子函数在任何表达式里都能用，结果都按种子可复现并记入日志。

## 6. 状态与动作
### 6.1 state
`state` 是一个对象：键是状态 id，值是状态定义。
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | 字符串 | **必填** | 见下表 |
| `init` | 与类型一致 | **必填** | 初始值 |
| `label` | 字符串 | 可选 | 显示名 |
| `visible` | 字符串 | 可选 | `both`（默认）\| `player`（只给玩家看）\| `ai`（只给 AI 看）\| `none`（隐藏变量） |
| `writable_by` | 列表 | 可选 | 谁能**直接**写：`rules`（动作/事件/脚本，始终包含）、`ai`（AI 写入型工具）、`ui`（输入组件，如起名）。默认 `[rules]` |
| `desc` | 字符串 | 可选 | 给 AI 和其他作者看的说明 |

类型与附加字段：
| type | 附加字段 | init 示例 |
|---|---|---|
| `number` | `min` `max`（可选，数字）、`integer`（可选，默认 false） | `3` |
| `bool` | — | `false` |
| `string` | `max_length`（可选，默认 2000） | `""` |
| `enum` | `values`（**必填**，字符串列表，≥ 1 个） | `灯塔`（必须在 values 里） |
| `list` | `of`（**必填**：`number`\|`string`\|`bool`）、`max_items`（可选） | `[]` |
| `set` | 同 list，但元素不重复 | `[]` |
| `map` | `of`（**必填**）——键为字符串 | `{}` |
| `record` | `fields`（**必填**，对象：字段名 → 基本类型 `number`/`string`/`bool`） | `{ keeper: 0 }` |

引擎强制：类型不符拒绝；`number` 超出 `min/max` **自动截断到边界**；`integer: true` 时四舍五入；`enum` 不在 `values` 中拒绝。

### 6.2 actions
动作是一段规则过程，可被玩家（界面组件）、AI（通过工具）、事件或其他动作触发。`actions` 是对象：键是动作 id。
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `label` | 字符串 | 可选 | 显示名 |
| `desc` | 字符串 | 可选 | 说明 |
| `params` | 对象 | 可选 | 参数定义：参数名 → `{ type, values?, min?, max?, required?(默认 true), desc? }`，type 为 `number`\|`string`\|`bool`\|`enum` |
| `require` | 表达式 | 可选 | 前提条件；为假时动作被拒绝，不产生任何改动 |
| `require_message` | 字符串 | 可选 | 被拒时给玩家/AI 的说明 |
| `steps` | 步骤列表 | 二选一 | 声明式步骤 |
| `script` | 字符串 | 二选一 | `文件路径#函数名`，如 `scripts/ignite.js#run` |
| `result` | 表达式 | 可选 | 返回值（给 AI 或界面看），通常是对象字面量，如 `"{ ok: r >= 12, roll: r }"` |
| `callable_by` | 列表 | 可选 | `player`（界面组件）、`ai`、`rules`（事件/其他动作）；默认 `[player, ai, rules]` |
| `cooldown_turns` | 整数 | 可选 | 同一动作两次执行之间至少间隔的回合数 |

`steps` 和 `script` 必须且只能有一个。

**步骤（steps）**：每个步骤是只有一个键的对象。
| 步骤 | 写法 | 含义 |
|---|---|---|
| `set` | `{ set: { 状态: 表达式, ... } }` | 赋值；record 字段写 `npc_mood.keeper` |
| `inc` | `{ inc: { 状态: 表达式 } }` | 数值加减（负数即减） |
| `add` | `{ add: { 状态: 表达式 } }` | 向 list/set 加入元素 |
| `remove` | `{ remove: { 状态: 表达式 } }` | 从 list/set 移除元素 |
| `put` | `{ put: { 状态: { key: 表达式, value: 表达式 } } }` | 写 map 的一项 |
| `let` | `{ let: { 名字: 表达式 } }` | 定义局部变量（只在本动作内有效；名字不得与状态 id 相同） |
| `if` | `{ if: 表达式, then: [步骤], else: [步骤] }` | 条件分支；`else` 可省略（这是唯一允许多个键的步骤） |
| `call` | `{ call: 动作id, params: { ... } }` | 调用另一个动作（嵌套深度 ≤ 8） |
| `emit` | `{ emit: 事件名, data: { ... } }` | 发出自定义事件，`data` 可省略 |
| `end` | `{ end: 结局id }` | 立即进入该结局 |
| `fail` | `{ fail: "说明文字" }` | 中止动作并撤销本动作的所有改动 |
| `log` | `{ log: 表达式 }` | 写入回合日志（玩家可见的规则记录） |

**原子性**：一个动作（含它调用的子动作）要么全部生效，要么全部撤销（`fail`、校验失败、脚本出错时）。

## 7. events（事件与钩子）
`events` 是列表，每项：
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | id | **必填** | 事件规则的名字 |
| `hook` | 字符串 | **必填** | 何时检查，见下表（不叫 `on`：YAML 会把 `on` 误读成布尔值 true） |
| `when` | 表达式 | 可选 | 附加条件，默认 `true` |
| `do` | 步骤列表 | **必填** | 要执行的步骤 |
| `once` | 布尔 | 可选 | 只触发一次，默认 false |
| `notify_ai` | 字符串 | 可选 | 触发后作为系统提示注入下一次 AI 请求 |

`hook` 的取值：
| 值 | 时机 |
|---|---|
| `game_start` | 开局 |
| `turn_start` / `turn_end` | 每回合开始 / 结束（一个“回合” = 玩家一次提交输入或点击一个动作组件后的完整处理） |
| `action:<动作id>` | 该动作成功执行后 |
| `state:<状态id>` | 该状态的值发生变化后 |
| `<自定义名>` | 被 `emit` 发出时 |

为避免死循环：同一事件规则在一次处理中最多触发 10 次，事件链深度 ≤ 16，超出则停止并记录错误。

## 8. endings（结局）
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `check_on` | 字符串 | 可选 | `state_change`（默认，每次状态变化后检查）\| `turn_end` \| `manual`（只由 `end` 步骤触发） |
| `list` | 列表 | 可选 | 可以为空；按顺序检查，**第一个满足的生效** |
| `script` | 字符串 | 可选 | `文件#函数`，返回结局 id 或 null；有它时先于 `list` 检查 |

`list` 每项：`id`（**必填**）、`label`（**必填**，显示名）、`when`（表达式；`check_on: manual` 时可省略）、`kind`（可选：`good` \| `bad` \| `neutral`，只用于显示）、`text`（可选，固定结尾文字）。
进入结局后游戏锁定：动作全部不可用，只有 `after_end: true` 的 AI 接入点还能运行（如尾声叙述）。

## 9. tools（向 AI 暴露的工具）
AI 只能通过工具影响游戏。`tools` 是对象：键是工具 id（会成为 function calling 的函数名）。每个工具是以下三种之一：
| 种类 | 写法 | 效果 |
|---|---|---|
| 动作型 | `{ action: 动作id, desc }` | 调用一个动作；参数取自动作 `params`；该动作的 `callable_by` 必须含 `ai` |
| 查询型 | `{ query: 表达式, desc }` | 只读，返回表达式的值 |
| 写入型 | `{ write: 状态id, desc }` | 直接写某个状态；该状态的 `writable_by` 必须含 `ai` |

`desc`（**必填**）写给 AI 看：这个工具做什么、何时用。
工具本身不授予权限，AI 能用哪个工具、能改多少，由各接入点的任务卡决定（§10.3）。

## 10. ai（AI 全局规则与接入点）
### 10.1 单 AI 原则
一个故事只用**一个 AI**：玩家在客户端配置的一个 Key、一个模型，所有接入点共用。作者只能写“建议”。
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model_hint` | 对象 | 可选 | `{ tier: light \| standard \| strong, note: "..." }`，仅作推荐 |
| `system` | 字符串或路径 | 可选 | 全局人设与世界观，所有接入点共享 |
| `rules` | 对象 | 可选 | 全局 AI 规则，§10.2 |
| `entry_points` | 对象 | **必填** | 至少 1 个接入点，§10.4 |

### 10.2 全局 AI 规则 rules
所有任务卡继承；任务卡**只能更严，不能放宽**。
| 字段 | 类型 | 说明 |
|---|---|---|
| `max_authority` | 整数 0–3 | 全故事最高裁量权，默认 1 |
| `must` | 字符串列表 | 必须遵守事项（写进提示词） |
| `forbid` | 字符串列表 | 禁止事项（写进提示词） |
| `on_violation` | 对象 | `{ retry: 0–3（默认 1）, tell_ai: true }`：越权被拒后是否把原因告诉 AI 并让它重试 |
| `max_tool_calls` | 整数 | 一次玩家操作内工具调用上限，默认 8，最大 20 |

### 10.3 AI 任务卡 card
每个接入点必须有一张任务卡。
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task` | 字符串 | **必填** | 用一两句话说明这个 AI 要做什么 |
| `authority` | 整数 0–3 | **必填** | 裁量权等级，不得高于 `rules.max_authority` |
| `must` / `forbid` | 字符串列表 | 可选 | 追加到全局规则之后 |
| `tools` | 对象 | 可选 | 白名单：工具 id → `{ writes? }`；不在这里的工具对该接入点不存在 |
| `output` | 对象 | **必填** | 输出格式，见下 |

**裁量权等级**（引擎强制）：
| 等级 | 名称 | 引擎允许 |
|---|---|---|
| 0 | 只叙述 | 只能用查询型工具；任何会改变状态的调用被拒 |
| 1 | 小幅调整 | 能改状态，但**每个改动都必须落在 `writes` 声明的范围内**；没声明 `writes` 的工具一律不能改状态 |
| 2 | 重大裁定 | 白名单内工具可任意改动（若声明了 `writes` 仍受其限制），但**不得导致结局**：若一次调用会触发结局，整次调用撤销并被拒 |
| 3 | 完全自由 | 白名单内工具，可以导致结局 |

任何等级下：状态类型/范围约束、动作 `require`、`callable_by` 照常生效；随机数只能由引擎产生。

**`writes`（每个工具可改的状态范围）**：对象，状态 id → 限制：
| 限制写法 | 适用类型 | 含义 |
|---|---|---|
| `{ delta: [下限, 上限] }` | number | 一次调用对该状态的净变化必须在区间内 |
| `{ range: [最小, 最大] }` | number | 调用后该状态必须在区间内 |
| `{ values: [...] }` | enum/string/bool | 只能改成列出的值 |
| `{ add_only: true }` | list/set | 只能加入，不能移除 |
| `any` | 任意 | 不限制 |
校验方式：引擎先在“草稿”里执行工具，得出改动清单，逐项比对等级与 `writes`；全部合法才提交，否则整次撤销。

**`output`**：
| 字段 | 类型 | 说明 |
|---|---|---|
| `format` | 字符串 | `text`（默认）\| `json` \| `sections` |
| `to` | 字符串 | 写到哪里：`region:<区域id>` \| `component:<组件id>` \| `state:<状态id>`（该状态须 `writable_by` 含 `ai`，类型须为 string）\| `none` |
| `max_chars` | 整数 | 文本最大长度，默认 800 |
| `schema` | 对象 | `format: json` 时**必填**：字段名 → 基本类型（`bool`/`number`/`string`/`enum:[a,b]`） |
| `then` | 步骤列表 | `format: json` 时可选：拿到结果后执行的规则步骤，可用 `out.字段`；这些步骤以规则身份执行，**不受**裁量权影响（是作者写的规则） |
| `sections` | 对象 | `format: sections` 时**必填**：段名 → 目标（同 `to`），一个请求输出多段，分别写到不同位置 |

### 10.4 接入点 entry_points
`entry_points` 是对象：键是接入点 id。
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `kind` | 字符串 | **必填** | `narrate`（叙述）\| `dialogue`（NPC 对话）\| `judge`（裁量，通常配 json 输出）\| `generate`（生成文本） |
| `trigger` | 字符串 | **必填** | `player_input`（玩家提交输入）\| `action:<id>` \| `event:<自定义名或事件规则id>` \| `ui:<组件id>.<事件>` \| `game_start` \| `game_end` |
| `prompt` | 字符串或路径 | **必填** | 提示词模板；可用 `{{state.xxx}}` `{{input}}`（玩家输入）`{{history}}` `{{setting}}` `{{event.xxx}}` |
| `card` | 对象 | **必填** | 任务卡，§10.3 |
| `context` | 对象 | 可选 | `{ state: [状态id...] 或 "visible", history_turns: 0–20（默认 6）, setting: bool（默认 true） }` |
| `temperature` | 数字 | 可选 | 0–2，默认 0.8 |
| `priority` | 字符串 | 可选 | `critical`（默认，玩家在等）\| `background`（可后台预生成并缓存） |
| `merge` | 布尔 | 可选 | 默认 true：与同一操作触发的其他接入点合并成一次请求 |
| `optional` | 布尔 | 可选 | 默认 false；true 时玩家可关闭此接入点 |
| `fallback` | 字符串 | 可选 | 关闭或失败时显示的固定文字；`optional: true` 时**应当**提供 |
| `after_end` | 布尔 | 可选 | 结局后是否仍可运行，默认 false |
| `opening` | 字符串 | 可选 | 仅 `trigger: game_start` 时：不调用 AI 直接显示的开场白 |

平台会在每个接入点的提示词前加一段**固定前缀**（安全规则、工具使用契约、任务卡内容），作者内容不能覆盖。

### 10.5 AI 生图 images（第二步实现；MVP 只校验不执行）
作者可以在 `ai.images` 里定义“生图点”，让 AI 按状态生成插图或背景。图片组件用 `generated: 生图点id` 显示它。
| 字段 | 必填 | 说明 |
|---|---|---|
| `trigger` | 是 | `game_start`、`turn_end`、`action:<id>`、`event:<id>`、`state:<id>`（该状态变化时） |
| `prompt` | 是 | 提示词模板，可用 `{{state.x}}`（只能引用已有状态） |
| `style` | 否 | 统一画风描述，拼在提示词后 |
| `size` | 否 | `512x512` `1024x1024` `1024x1536` `1536x1024`，默认 1024x1024 |
| `cache` | 否 | `once`（整局只生成一次）、`none`、`{ by_state: [状态id…] }`（这些状态取值相同就复用），默认 `once` |
| `fallback` | 建议 | 失败、超时或玩家关闭生图时显示的图：`asset:<id>` 或路径；`none` 表示确认只显示文字 |
| `alt` | 否 | 图片的文字说明，读屏和关图时显示 |

- 默认用故事同一个服务商和 Key 调 OpenAI 兼容的 `images/generations` 接口；服务商不支持时，玩家可在设置里单独配一个生图服务（同样只存钥匙串）。
- 玩家可以一键关闭 AI 生图省钱，此时一律显示 `fallback`。
- 生图点是**固定提示词 + 状态填空**，玩家文字不会进入生图提示词；生成结果只在本地缓存，不改任何状态。

```yaml
ai:
  images:
    scene:
      trigger: state:location
      prompt: 夜晚的孤岛，{{state.location}}，海风，冷色调
      style: 水彩插画
      cache: { by_state: [location] }
      fallback: asset:bg_default
ui:
  components:
    pic: { type: image, region: side, generated: scene, content: ai }
```

## 11. 官方规则模板 uses
可选。格式 `oasis/<名字>@<主版本>`。模板是预先写好的状态、动作、函数和组件，导入时一并打包锁定版本。
| 模板 | 提供 |
|---|---|
| `oasis/dice@1` | 表达式函数 `roll('NdM+K')`、`roll_adv('d20')`（优势）、`roll_dis('d20')`（劣势）；组件 `dice-log` |
| `oasis/check@1` | 动作 `check`（参数：属性名、难度），返回 `{ ok, roll, total }` |
| `oasis/inventory@1` | 状态 `inventory`（map）与动作 `give_item` `take_item` `use_item`；组件 `item-list` |
| `oasis/clock@1` | 状态 `day`、事件钩子 `day_end` |
模板定义的 id 加前缀避免冲突（如 `inv_*`），作者可以覆盖同名动作。

## 12. scripts（可选高级层）
| 字段 | 类型 | 说明 |
|---|---|---|
| `limits` | 对象 | `{ time_ms: 1–200（默认 50）, memory_mb: 4–64（默认 16） }`，每次调用 |

语言按文件扩展名识别：`.js` `.ts`（MVP）、`.lua`（M8）、`.py`（M9）。所有语言共用同一套 API：
| API | 说明 |
|---|---|
| `api.state.get(id)` / `api.state.set(id, v)` / `api.state.inc(id, n)` / `api.state.add(id, v)` / `api.state.remove(id, v)` | 读写状态（受类型约束） |
| `api.params` | 动作参数 |
| `api.random.int(a,b)` / `.float()` / `.pick(list)` / `.weighted(obj)` | 可复现随机数 |
| `api.actions.call(id, params)` | 调用动作 |
| `api.events.emit(name, data)` | 发出事件 |
| `api.end(ending_id)` / `api.fail(msg)` | 结局 / 中止并撤销 |
| `api.log(msg)` | 日志 |

函数签名：`run(api)`，返回值即动作的 `result`。沙箱中**没有**网络、文件、系统时钟、`Math.random`（用 `api.random`），超时或超内存即中止并撤销。
```js
// scripts/ignite.js
export function run(api) {
  if (api.state.get("oil") < 1) api.fail("没有灯油了");
  api.state.inc("oil", -1);
  return { ok: api.random.int(1, 6) >= 3 };
}
```

## 13. ui（界面）
省略 `ui` 时使用默认简约模板：叙述区 + 输入框 + 状态栏（显示 `visible` 为 `both`/`player` 的状态）。
| 字段 | 类型 | 说明 |
|---|---|---|
| `theme` | 对象 | `{ base: light\|dark\|sepia, colors: { accent, bg, text, panel }（#RRGGBB）, font: { body: sans\|serif\|mono 或包内字体路径, size: 12–24 }, background: 素材引用 或 { bind: 状态id, images: { 值: 素材引用 }, default: 素材引用 } }` |
| `sound` | 对象 | 背景音乐与音效，见下 |
| `layout` | 对象 | `{ template: simple\|two-column\|stage\|custom, grid?: 字符串列表, columns?: 列表, rows?: 列表 }`；`custom` 时 `grid` **必填**，用区域 id 拼成的行，如 `["side main", "side input"]` |
| `components` | 对象 | 组件 id → 组件定义 |

组件定义通用字段：`type`（**必填**）、`content`（`fixed` 默认 / `ai`，见最高原则）、`region`（**必填**，区域 id；内置模板的区域：`simple` 为 `main` `input` `status`，`two-column` 为 `main` `input` `side`，`stage` 为 `top` `main` `input` `side`）、`label`、`hidden_by_default`、`player_can_hide`（默认 true）。

| type | 专用字段 | 说明 |
|---|---|---|
| `text-log` | — | 显示 AI 叙述与规则日志；常作 `output.to` 目标 |
| `text-input` | `placeholder`；`input`（可选：`actions`、`reject`、可选 `words` `max_length`；不写时玩家文字不能触发任何动作，默认回应“这里做不到。”）；或 `writes: 状态id`（只填值，如名字，需 `writable_by` 含 ui） | 玩家输入；提交时触发 `player_input` |
| `button` | `action`（动作 id）或 `emit`（事件名） | 点击：执行动作，或触发事件（可作 AI 接入点触发 `ui:<id>.click`） |
| `choice-buttons` | `choices: [{ label, action, params }]` 或 `from_ai: true`（见下方 choices 约定） | 选项按钮 |
| `stat-list` / `stat-bar` | `bind: [状态id]` | 显示状态；`stat-bar` 仅 number 且需 min/max |
| `item-list` | `bind: 状态id`（list/set/map） | 列表显示 |
| `chat-box` | `title`，`portrait`（素材引用），`input`（可选，同 text-input） | 对话框；发送触发 `ui:<id>.send`，`{{input}}` 为发送内容 |
| `text-block` | `bind: 状态id` 或 `text` | 显示一段文字 |
| `image` | `src`，或 `bind`（一个状态）+ `images: { 值: 素材引用 }`（可再写 `src` 作默认图），或 `generated: 生图点id`；`fit: cover\|contain` | 图片 / 随状态切换 / AI 生图 |
| `dice-log` | —（需 `oasis/dice`） | 随机结果记录 |
| `node-map`、`portrait`、`item-grid`、`timer`、`custom` | — | MVP 之后 |

**AI 生成的选项按钮（choices 约定）**
`choice-buttons` 写 `from_ai: true` 时，选项由 AI 给出：
1. 让某个接入点的 `output.to` 指向这个组件（`format: text`），或者在 `format: sections` 里让其中一项指向它；
2. AI 在这段输出里**每行写一个选项**；行首的“1.”“-”等序号会被去掉；最多 6 个，每个最多 40 字；
3. 玩家点选项时，等同于把这行字打进本页的 `text-input`（必须有，且写了 `input`），所以同样只能落到 `input.actions` 里的动作或得到 `reject` 回应——AI 写的选项不能绕过边界。
```yaml
ai:
  entry_points:
    narrator:
      kind: narrate
      trigger: player_input
      prompt: 玩家行动：{{input}}
      card:
        task: 叙述结果，并给出 2-3 个下一步
        authority: 1
        output:
          format: sections
          sections: { story: region:main, next: component:options }   # next 每行一个选项
ui:
  components:
    options: { type: choice-buttons, region: input, from_ai: true }
```

**声音 `ui.sound`**
```yaml
ui:
  sound:
    music: { bind: location, tracks: { 海滩: asset:waves, 灯塔: asset:wind }, volume: 0.6 }  # 或 { src: asset:bgm }
    effects: { "action:search": asset:rustle, "ending:dark": asset:thunder, game_start: asset:bell }
```
音效的键可用 `game_start` `game_end` `turn_end` `action:<id>` `event:<id>` `ending:<id>`。玩家可单独调音乐/音效音量或静音。

组件只能**读**可见状态；要改状态必须通过 `action`（走引擎校验）。
玩家可在本地改主题、布局（位置、大小、隐藏 `player_can_hide` 的组件）、关闭 `optional` 的 AI 接入点；**不能**改动作、工具、提示词、任务卡和输出绑定。优先级：玩家 > 故事 > 默认（仅限可改部分）。

### 13.5 素材清单 assets 与引用
所有图片、音频都应在顶层 `assets` 登记，然后用 `asset:<id>` 引用（直接写包内路径也行，但不推荐）。
```yaml
assets:
  bg_beach:  { type: image, path: assets/beach.webp, use: background, alt: 夜晚的海滩 }
  keeper:    { type: image, path: assets/keeper.png, use: portrait }
  waves:     { type: audio, path: assets/waves.ogg, use: music, loop: true, volume: 0.6 }
  rustle:    { type: audio, path: assets/rustle.mp3, use: sfx }
```
| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | 是 | `image` 或 `audio` |
| `path` | 是 | 包内相对路径，文件必须存在 |
| `use` | 否 | `background` `portrait` `illustration` `icon`（须是图片）、`music` `sfx`（须是音频）、`other` |
| `alt` / `loop` / `volume` | 否 | 文字说明 / 是否循环 / 默认音量 0–1 |

格式与大小：图片 WebP/PNG/JPG，单张 ≤ 10 MB（背景建议 1920 宽 WebP，约 200–400 KB）；音频 OGG/MP3/M4A，单个 ≤ 30 MB（建议 96–128 kbps，需要时可用更高码率）；整包 ≤ 300 MB。校验时检查：文件存在、扩展名与类型相符、用途与类型相符、引用的 id 存在且类型对（背景要图片、音乐要音频）。

## 14. 校验级别
客户端导入、服务端上传都用同一套校验，结果分三级：
| 级别 | 含义 | 示例 |
|---|---|---|
| 错误 | 不能导入 | 缺必填字段、类型不对、引用不存在、表达式语法错、越过 `max_authority` |
| 警告 | 能导入但建议修改 | 某结局永远不可能满足（静态可判断时）、`optional` 接入点无 `fallback`、动作从未被任何地方使用 |
| 提示 | 体验建议 | 提示词很长（预计较慢、较贵）、封面过大 |

## 15. 常见错误清单
| 错误写法 | 正确写法 | 原因 |
|---|---|---|
| `set: { location: 海滩 }` | `set: { location: "'海滩'" }` | 右边是表达式，字符串要单引号 |
| `when: state.hp == "0"` | `when: "state.hp == 0"` | 数字不要加引号；整句要被 YAML 当字符串 |
| `id: 灯油` | `oil` + `label: 灯油` | id 只能用小写英文、数字、下划线 |
| `init: 海边`（enum 值是 `海滩`） | `init: 海滩` | init 必须在 values 中 |
| 工具 `{ action: search }` 但动作 `callable_by: [player]` | 加上 `ai` | AI 调不了不允许它调的动作 |
| 任务卡 `authority: 1` 却没写 `writes` | 给工具写 `writes` 或改用等级 2 | 等级 1 只允许声明过的小幅改动 |
| `authority: 3` 而 `rules.max_authority` 未写 | 写 `rules: { max_authority: 3 }` | 默认上限是 1 |
| `output: { format: json }` 无 `schema` | 补上 `schema` | json 输出必须声明字段 |
| 结局 `when` 引用 `state.HP` | `state.hp` | 区分大小写 |
| 步骤里用 `random()` | `rand()` / `randint(a,b)` | 只能用列出的随机函数 |
| 事件写 `on: turn_end` | `hook: turn_end` | YAML 把 `on`、`yes`、`no`、`off` 当成布尔值；本规范不使用这些键名 |
| 用 Tab 缩进 | 用 2 个空格 | YAML 不允许 Tab |
| `ai` 里给不同接入点写不同模型 | 只写 `model_hint` | 一个故事只用一个 AI |
| `output: { to: component:log }` 而 log 没标 | 给 log 加 `content: ai` | 没标的组件是固定内容，AI 不能写 |
| 放了 `chat-box` / `text-input` 却没写 `input` | 写 `input: { actions: [...], reject: ... }` | 自由输入必须有边界 |
| `src: asset:bg` 但 assets 里没有 bg | 在 `assets` 登记，或改正 id | 引用的素材必须存在 |
| 背景音乐引用了图片素材 | 引用 `type: audio` 的素材 | 类型要对 |

## 16. 完整示例：《守灯人（迷你版）》
```yaml
spec: oasis/0.3
meta:
  id: lighthouse-mini
  title: 守灯人（迷你版）
  version: 0.3.0
  summary: 七夜之内保住灯火，查明失踪船只的真相。
  language: zh-CN
  rating: all-ages
  est_minutes: 20
uses: [oasis/dice@1]
start:
  intro: 你在潮声里醒来，灯塔顶端的火苗只剩豆大。
state:
  oil:      { type: number, init: 3, min: 0, max: 5, integer: true, label: 灯油 }
  day:      { type: number, init: 1, integer: true, label: 天数 }
  location: { type: enum, values: [灯塔, 海滩, 村庄], init: 灯塔, label: 地点 }
  clues:    { type: set, of: string, init: [], label: 线索 }
  keeper_trust: { type: number, init: 0, min: -3, max: 3, integer: true, visible: ai, desc: 老守灯人对玩家的信任 }
actions:
  move:
    label: 前往
    params: { to: { type: enum, values: [灯塔, 海滩, 村庄] } }
    require: "params.to != state.location"
    require_message: 你已经在这里了
    steps: [ { set: { location: "params.to" } } ]
  search:
    label: 搜索
    require: "state.location != '灯塔'"
    require_message: 灯塔里已经没什么可找的
    steps:
      - let: { r: "roll('1d20')" }
      - if: "r >= 12"
        then: [ { add: { clues: "state.location + '的线索'" } }, { log: "'找到了线索'" } ]
        else: [ { inc: { oil: -1 } }, { log: "'潮水打湿了灯油'" } ]
    result: "{ ok: r >= 12, roll: r }"
  tend_light:
    label: 添油守夜
    require: "state.location == '灯塔'"
    steps: [ { inc: { oil: -1, day: 1 } } ]
  change_trust:
    params: { amount: { type: number, min: -1, max: 1 } }
    steps: [ { inc: { keeper_trust: "params.amount" } } ]
    callable_by: [ai]
events:
  - id: storm
    hook: state:day
    when: "state.day == 4"
    once: true
    do: [ { inc: { oil: -1 } } ]
    notify_ai: 第四夜暴风雨来临，灯油被风吹灭了一些。
endings:
  list:
    - { id: darkness, label: 灯火熄灭, kind: bad, when: "state.oil <= 0" }
    - { id: truth, label: 真相大白, kind: good, when: "len(state.clues) >= 2 && state.location == '灯塔'" }
    - { id: dawn, label: 平淡的黎明, kind: neutral, when: "state.day > 7" }
tools:
  move:   { action: move, desc: 玩家明确要去另一个地点时调用 }
  search: { action: search, desc: 玩家在当前地点搜索时调用，结果由骰子决定 }
  tend:   { action: tend_light, desc: 玩家在灯塔添油守夜时调用，会推进一天 }
  trust:  { action: change_trust, desc: 老守灯人对玩家的信任变化时调用 }
ai:
  model_hint: { tier: standard }
  system: 这是一个安静、略带悬疑的海边故事，全年龄。
  rules:
    max_authority: 2
    must: [用第二人称叙述, 保持全年龄]
    forbid: [透露玩家看不到的数值, 替玩家做决定]
    on_violation: { retry: 1, tell_ai: true }
  entry_points:
    narrator:
      kind: narrate
      trigger: player_input
      prompt: |
        玩家行动：{{input}}
        当前：{{state.location}}，灯油 {{state.oil}}，第 {{state.day}} 天。
        根据玩家行动调用合适的工具，再叙述结果，结尾给 2-3 个选项。
      card:
        task: 叙述玩家行动的结果，用工具推进规则
        authority: 2
        must: [每次结尾给 2-3 个选项, 检定失败如实叙述]
        tools: { move: {}, search: {}, tend: {} }
        output: { format: text, to: region:main, max_chars: 400 }
    keeper:
      kind: dialogue
      trigger: ui:keeper_chat.send
      prompt: |
        你是村里的老守灯人，话少、警惕。玩家对你说：{{input}}
        你对玩家的信任：{{state.keeper_trust}}（-3 到 3）。
      context: { state: [keeper_trust, clues], history_turns: 4 }
      card:
        task: 扮演老守灯人和玩家对话，信任足够高时透露线索
        authority: 1
        forbid: [直接说出失踪船只的真相]
        tools: { trust: { writes: { keeper_trust: { delta: [-1, 1] } } } }
        output: { format: text, to: component:keeper_chat, max_chars: 200 }
      optional: true
      fallback: 老人摇摇头，没有说话。
ui:
  layout: { template: two-column }
  components:
    log:   { type: text-log, region: main, content: ai }
    input:
      type: text-input
      region: input
      placeholder: 你要做什么？
      input:
        actions: [move, search, tend_light]     # 玩家打的字最多只能变成这三个动作
        words: { tend_light: [点灯, 添油, 守灯] }  # 没配 Key 时按关键词映射
        reject: 这件事在这座岛上做不到。你可以移动、搜索或照看灯塔。
        max_length: 300
    stats: { type: stat-list, region: side, bind: [oil, day, location, clues] }
    keeper_chat:
      type: chat-box
      region: side
      title: 老守灯人
      content: ai
      input: { actions: [], reject: 老人只是看着你，没有回答。, max_length: 200 }
```
该示例可直接通过校验；更多示例与生成要求见 [ai-authoring-guide.md](ai-authoring-guide.md)。
