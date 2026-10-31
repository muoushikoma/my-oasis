# 我的绿洲 · 故事交付格式（oasis/0.3）

本文只规定**交付文件的格式**。故事的规则、玩法、数值、剧情都由作者决定，本文不作任何限制。表格里没打 ✅ 的字段都是可选的。

## 1. 包结构

交付物是一个 `.oasis` 文件，也就是改了扩展名的 zip 包。也可以直接交付一个文件夹，结构和下面一样。

```
my-story.oasis
├── story.yaml          主文件（必需，位于包的最外层，不要多套一层文件夹）
├── assets/…            图片、音频、字体（可选，目录名随意）
└── scripts/…           脚本（可选，目录名随意）
```

- 主文件为 `story.yaml`，也可以用 `story.json`，但两者只能有一个。
- 包里的路径一律写相对路径，不能以 `/` 开头，也不能含 `..`。
- 允许的扩展名：`.yaml .yml .json .md .txt .js .ts .lua .py .webp .png .jpg .jpeg .woff2 .ogg .mp3 .m4a`
- 大小限制：
  - 单张图片不超过 1 MB
  - 单个音频不超过 5 MB
  - 整包不超过 20 MB
  - 最多 200 个文件

## 2. 主文件的顶层字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `spec` | ✅ | 固定写 `oasis/0.3` |
| `meta` | ✅ | 元信息，见第 3 节 |
| `state` | | 状态表，可以没有，见第 4 节 |
| `endings` | | `{ list?: [结局…], check_on?, script? }`，可以没有，见第 4 节 |
| `assets` | | 素材登记，见第 5 节 |
| `actions` | | 动作，见第 6 节 |
| `ai` | | AI 接入点，见第 7 节。不写就是纯规则、不用 AI 的故事 |
| `ui` | | 界面，见第 8 节。不写就用默认模板 |
| `scripts` | | `{ limits: { time_ms: 1–200, memory_mb: 4–64 } }` |
| `start` | | `{ intro: 文字, do: 步骤 }` |
| `random` | | `{ seed: auto 或 整数 }` |
| `uses` | | 模板列表，格式为 `oasis/<名称>@<版本号>`，例如 `oasis/dice@1`（可不写；骰子函数不依赖它） |
| `events` / `tools` | | 事件与工具，字段见仓库 `docs/schema/story.schema.json` |

id 的通用格式：状态、动作、素材、接入点、组件这些的 id 都要匹配 `^[a-z][a-z0-9_]{0,39}$`，也就是小写字母开头，可以有数字和下划线。

## 3. meta（元信息）

| 字段 | 必填 | 格式 |
|---|---|---|
| `id` | ✅ | `^[a-z][a-z0-9-]{2,63}$`，例如 `rainy-bookshop`。投稿时必须和文件夹名一样 |
| `title` | ✅ | 字符串 |
| `version` | ✅ | `x.y.z` 格式 |
| `summary` | ✅ | 字符串 |
| `language` | ✅ | 例如 `zh-CN`、`en`、`ja` |
| `rating` | ✅ | `all-ages`、`teen` 或 `mature`（`mature` 时 `content_warnings` 必填；公开故事库只收 `all-ages`、`teen`） |
| `authors` / `tags` / `content_warnings` | | 字符串数组 |
| `cover` | | 包内图片的路径 |
| `setting` | | 包内文件的路径，内容是世界观设定文本 |
| `est_minutes` | | 整数 |
| `min_engine` | | `x.y.z` 格式 |
| `license` | | 字符串 |

## 4. state 与 endings

`state` 的写法是 `状态id: { type, init, … }`。

- `type` 可选 `number`、`bool`、`string`、`enum`、`list`、`set`、`map`、`record`。
- 可选字段：
  - `label`、`desc`
  - `visible`：`both`、`player`、`ai` 或 `none`
  - `writable_by`：取值在 `rules`、`ai`、`ui` 里选
  - 数字用：`min`、`max`、`integer`
  - 文字用：`max_length`
  - `enum` 类型必填 `values`
  - `list`、`set`、`map` 类型可写 `of`、`max_items`
  - `record` 类型可写 `fields`

`state`、`endings` 都可以省略；`endings.list` 也可以为空。

`endings.list` 里每一项的写法是 `{ id, label, when?, kind?, text? }`：

- `when` 写表达式，例如 `"state.x >= 3"`。
- `kind` 可选 `good`、`bad` 或 `neutral`。
- `endings.check_on` 可选 `state_change`、`turn_end` 或 `manual`。

## 5. 素材与引用

先在 `assets` 里登记素材，写法是 `素材id: { type, path, use?, alt?, loop?, volume? }`：

- `type`：`image` 或 `audio`。
- `path`：包内路径。扩展名必须和类型对得上：图片用 webp、png、jpg，音频用 ogg、mp3、m4a。
- `use`：可选 `background`、`portrait`、`illustration`、`icon`、`music`、`sfx` 或 `other`。

其他地方引用素材时写 `asset:<素材id>`，也可以直接写包内路径。所有被引用的文件都必须在包里。

## 6. 脚本与动作

在 `actions` 里定义动作，写法是 `动作id: { label?, desc?, params?, require?, require_message?, result?, callable_by?, cooldown_turns?, steps | script }`。

- `steps` 和 `script` **必须且只能写一个**。
- `script` 的格式是 `包内文件路径#函数名`，例如 `scripts/act.js#run`。语言按扩展名识别：`.js`、`.ts`、`.lua`、`.py`。
- 脚本函数的写法是 `export function run(api) { … }`，返回值就是这个动作的结果。
- 表达式里可以随处使用 `rand()`、`randint(a,b)`、`pick(list)`、`weighted({…})`、`roll('2d6')`、`roll_adv()`、`roll_dis()`，结果按种子可复现。
- 脚本可以用的 API：
  - 读写状态：`api.state.get / set / inc / add / remove`
  - 动作参数：`api.params`
  - 随机数：`api.random.int / float / pick / weighted`
  - `api.actions.call`、`api.events.emit`、`api.end(结局id)`、`api.fail(说明)`、`api.log`
- `callable_by` 取值在 `player`、`ai`、`rules` 里选。
- `endings.script` 也可以用同样的 `文件#函数` 格式。

## 7. AI 接入点声明

```yaml
ai:
  model_hint: { tier: light|standard|strong, note: … }   # 可选
  system: 全局系统提示                                   # 可选
  rules: { max_authority: 0–3, must: [], forbid: [], on_violation: { retry: 0–3, tell_ai: bool }, max_tool_calls: 1–20 }  # 可选
  entry_points:
    接入点id:
      kind: narrate | dialogue | judge | generate        # 必填
      trigger: player_input | game_start | game_end | action:<id> | event:<名> | ui:<组件id>.<事件>   # 必填
      prompt: 提示词，可写 {{占位符}}                     # 必填
      card:                                              # 必填（任务卡）
        task: 任务说明                                   # 必填
        authority: 0–3                                   # 必填（自由裁量程度）
        must: [必须遵守的规则]                            # 可选
        forbid: [禁止事项]                                # 可选
        tools: { 工具id: { writes: { 状态id: any 或 {delta:[a,b]} 或 {range:[a,b]} } } }   # 可选
        output:                                          # 必填
          format: text | json | sections
          to: component:<id> | region:<id> | state:<id> | none
          max_chars: 1–8000
          schema: { 字段: bool|number|string|enum:[…] }   # format 为 json 时必填
          sections: { 段名: 输出目标 }                    # format 为 sections 时必填
          then: 步骤
      context: { state: visible 或 [状态id], history_turns: 0–20, setting: bool }   # 可选
      temperature: 0–2
      priority: critical | background
      merge / optional / after_end: bool
      fallback: 失败时显示的文字
      opening: 开场文字
  images:                                                # 可选：AI 生图点
    生图点id: { trigger: game_start|turn_end|action:<id>|event:<名>|state:<id>, prompt, style?, size?: 512x512|1024x1024|1024x1536|1536x1024, cache?: once|none|{by_state:[…]}, fallback?: asset:<id>|路径|none, alt? }
```

- 接入点的 `card.authority` 不能大于 `ai.rules.max_authority`。

## 8. ui（界面）

- `layout`：`{ template: simple | two-column | stage | custom, grid?, columns?, rows? }`。`custom` 时 `grid` 必填。
- 内置模板的区域：
  - `simple`：`main`、`input`、`status`
  - `two-column`：`main`、`input`、`side`
  - `stage`：`top`、`main`、`input`、`side`
- `components` 的写法是 `组件id: { type, region, content?, … }`：
  - `type` 可选 `text-log`、`text-input`、`button`、`choice-buttons`、`stat-list`、`stat-bar`、`item-list`、`chat-box`、`text-block`、`image`、`dice-log`。
  - `content` 可选 `fixed`（默认）或 `ai`。**AI 输出的目标组件必须写 `content: ai`**。
  - `text-input` 和 `chat-box` 可选 `input: { actions: [动作id…], reject: 超出范围时的回应文字, words?, max_length? }`。不写时，玩家文字不能触发任何动作（仍可交给 AI 接入点）。
  - 其他字段：`label`、`placeholder`、`writes`、`action`、`emit`、`choices`、`from_ai`、`bind`、`title`、`portrait`、`text`、`src`、`images`、`fit`、`generated`、`hidden_by_default`、`player_can_hide`。
- `theme`、`sound`：字段见仓库的 schema。

## 9. 最小完整示例（已用仓库校验器实测通过）

文件结构：

```
my-story/
├── story.yaml
├── assets/cover.png
└── scripts/act.js
```

`scripts/act.js`：

```js
export function run(api) {
  api.state.inc("count", 1);
  return { count: api.state.get("count") };
}
```

`story.yaml`：

```yaml
spec: oasis/0.3
meta:
  id: my-story
  title: 示例故事
  version: 1.0.0
  summary: 一句话简介。
  language: zh-CN
  rating: all-ages
  cover: assets/cover.png
assets:
  cover:
    type: image
    path: assets/cover.png
    use: illustration
state:
  count:
    type: number
    init: 0
    visible: both
  narration:
    type: string
    init: ""
    writable_by: [rules, ai]
actions:
  act:
    label: 行动
    callable_by: [player, ai]
    script: scripts/act.js#run
endings:
  list:
    - id: done
      label: 结束
      when: "state.count >= 3"
ai:
  entry_points:
    narrator:
      kind: narrate
      trigger: player_input
      prompt: "玩家说：{{input}}"
      card:
        task: 根据玩家输入叙述
        authority: 1
        output:
          format: text
          to: component:log
ui:
  layout:
    template: simple
  components:
    log:
      type: text-log
      region: main
      content: ai
    pic:
      type: image
      region: status
      src: asset:cover
    say:
      type: text-input
      region: input
      input:
        actions: [act]
        reject: 做不到。
    go:
      type: button
      region: input
      action: act
```

最少只需要 `spec` 和 `meta`（6 个必填字段）就能通过校验，其余全部可以不写：

```yaml
spec: oasis/0.3
meta: { id: my-story, title: 示例, version: 1.0.0, summary: 简介, language: zh-CN, rating: all-ages }
```

完整的字段定义见仓库 `docs/schema/story.schema.json`。
