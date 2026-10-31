# 我的绿洲 · 故事交付格式（oasis/0.4，兼容 0.3）

本文只规定**交付文件的格式**。故事的规则、玩法、数值、剧情都由作者决定，本文不作任何限制。表格里没打 ✅ 的字段都是可选的。

`oasis/0.4` 在 0.3 的基础上增加了实时游戏能力（第 10 节）。0.3 的故事包不用做任何修改，照样可以导入和游玩；用到第 10 节的功能时，把 `spec` 改成 `oasis/0.4` 即可。

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
| `spec` | ✅ | `oasis/0.4` 或 `oasis/0.3` |
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
| `realtime` | | 实时循环（0.4），见第 10 节 |
| `input` | | 键盘、触摸、虚拟摇杆输入（0.4），见第 10 节 |
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

- `type` 可选 `number`、`bool`、`string`、`enum`、`list`、`set`、`map`、`record`、`json`。
- `json`（0.4）可以存任意 JSON 值（对象、数组、嵌套结构，最大 1 MB），适合放坐标、敌人列表、地图等实时游戏数据。
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
      trigger: script | player_input | game_start | game_end | action:<id> | event:<名> | ui:<组件id>.<事件>   # 必填
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
- `trigger: script`（0.4）表示这个接入点只由脚本用 `api.ai.request` 调用，见第 10 节。

## 8. ui（界面）

- `layout`：`{ template: simple | two-column | stage | custom, grid?, columns?, rows? }`。`custom` 时 `grid` 必填。
- 内置模板的区域：
  - `simple`：`main`、`input`、`status`
  - `two-column`：`main`、`input`、`side`
  - `stage`：`top`、`main`、`input`、`side`
- `components` 的写法是 `组件id: { type, region, content?, … }`：
  - `type` 可选 `text-log`、`text-input`、`button`、`choice-buttons`、`stat-list`、`stat-bar`、`item-list`、`chat-box`、`text-block`、`image`、`dice-log`、`canvas`（0.4，见第 10 节）。
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

## 10. 实时游戏（oasis/0.4）

故事不一定是对话驱动的。写了 `realtime` 的故事会进入实时循环：每秒固定调用若干次脚本，脚本读取玩家输入、更新状态，画布组件把画面画出来。动作类、解谜、平台跳跃、俯视角探索等都可以做，玩法完全由作者决定。

### 10.1 realtime（循环）

```yaml
realtime:
  tick_hz: 30                      # 每秒推进几次，1–60，默认 30
  tick_ms: 16                      # 每次脚本调用的时间上限（毫秒），1–50，默认 16
  on_tick: scripts/game.js#tick    # 每次推进时调用（可选）
  on_ai: scripts/game.js#onAi      # 脚本发起的 AI 请求返回时调用（可选）
  timers:                          # 定时事件（可选）
    定时器id:
      every_ms: 1000               # 每隔多久触发一次（≥16）
      after_ms: 500                # 开始后多久第一次触发；只写它就是一次性定时器
      action: 动作id               # 到点要做的事：action / emit / script 至少写一个
      params: { … }                # 传给 action 的参数
      emit: 事件名                  # 触发一个事件（可被 event:<名> 的 AI 接入点、事件规则接住）
      script: scripts/x.js#fn      # 直接调用脚本函数，api.params.timer 是定时器 id
```

- 每次推进的顺序：先触发到点的定时器，再调用 `on_tick`。
- 时间以游戏内时间计算，每步最多 250 毫秒；同一个随机种子、同样的输入，结果完全一样。
- 某一步出错或超时，这一步对状态的改动会全部撤销，并记一条错误日志，循环继续运行。
- 结局判定和回合制故事一样；进入结局后循环停止。

### 10.2 input（输入）

```yaml
input:
  keys: { ArrowLeft: left, KeyA: left, Space: jump }   # 键盘按键（KeyboardEvent.code）→ 作者自己起的名字
  joystick: true                                      # 屏幕虚拟摇杆；或 { side: left | right }
  buttons: [ { id: jump, label: 跳 } ]                 # 屏幕按钮，最多 8 个；id 和 keys 的名字可以相同
  pointer: true                                       # 在画布上点击/触摸
```

脚本里用 `api.input` 读取当前输入：

| 字段 | 说明 |
|---|---|
| `held` | `{ 名字: true }`，正按着的键和屏幕按钮 |
| `pressed` | 上一步之后刚按下的键（只出现一次），画布点击会出现 `pointer` |
| `joystick` | `{ x, y }`，范围 -1 到 1；向右、向下为正 |
| `pointer` | `{ x, y, down, target }`，坐标是画布像素坐标，`target` 是画布组件 id |

### 10.3 canvas（画布组件）

```yaml
ui:
  components:
    screen: { type: canvas, region: main, width: 320, height: 240, render: scripts/game.js#draw, pixelated: true }
```

- `render` 必填，格式为 `文件#函数`；`width`、`height` 是画布像素尺寸（16–4096，默认 320×240）；`pixelated: true` 时放大不模糊。
- 每次推进后调用一次 `render`。`api.params` 里有 `width`、`height`。render 函数只能读状态，对状态的任何改动都会被撤销，也不能播放声音或请求 AI。
- 绘制指令（每帧最多 5000 条，按调用顺序绘制）：

| 指令 | 说明 |
|---|---|
| `api.draw.clear(颜色?)` | 清屏，可填充颜色 |
| `api.draw.camera(x, y, zoom?)` | 设置相机：之后的世界坐标减去 (x, y) 再乘以 zoom |
| `api.draw.rect(x, y, w, h, 颜色, { stroke?, width?, alpha?, fixed? })` | 矩形；`stroke: true` 只画边框 |
| `api.draw.circle(x, y, r, 颜色, { stroke?, width?, alpha?, fixed? })` | 圆 |
| `api.draw.line(x1, y1, x2, y2, 颜色, 线宽?)` | 线段 |
| `api.draw.text(文字, x, y, { size?, color?, align?, bold?, font?, alpha?, fixed? })` | 文字，`align` 为 left/center/right |
| `api.draw.image(素材id, x, y, w?, h?, { sx?, sy?, sw?, sh?, flip_x?, alpha?, fixed? })` | 图片；`sx/sy/sw/sh` 从图里裁一块，适合精灵图 |
| `api.draw.tilemap({ tileset?, tile_size, columns, map, x?, y?, colors? })` | 图块地图，见下 |

- `fixed: true` 表示这条指令不受相机影响，用来画分数等界面元素。
- 图块地图：`tileset` 是图片素材 id，图里的图块按 `tile_size` 切成格子、每行 `columns` 个，从 0 开始编号。`map` 是二维数组（或字符串数组，每个字符一格），每个值是图块编号；`-1`、`null`、`.`、空格表示空。`colors: { 值: 颜色 }` 可以不用图片、直接用纯色方块画。
- 颜色写 CSS 颜色，例如 `#ffcc00`、`rgba(0,0,0,.5)`。

### 10.4 声音

`api.sound.play(素材id, { volume?, loop? })` 播放一段已登记的音频素材；`api.sound.stop(素材id?)` 停止循环播放的声音，不填 id 就全部停止。每步最多 32 个声音指令。玩家的静音和音效音量设置会生效。

### 10.5 AI（异步、结构化）

1. 声明一个 `trigger: script` 的接入点，推荐 `output.format: json` 并写好 `schema`。
2. 脚本里调用 `api.ai.request(接入点id, 输入文字?, 数据?)`，立即返回请求编号（同时最多 4 个，超出返回 `null`）。游戏循环不会等待 AI。
3. AI 返回后，先按接入点的 `output.then` 处理（可以用 `out.字段`），再调用 `realtime.on_ai`。`api.params` 包括：`request`（请求编号）、`entry`、`data`（按 schema 整理好的 JSON 对象）、`text`、`error`（失败原因，成功时为 `null`）。
4. 没有配置 AI 或请求失败时，`on_ai` 也会被调用：`error` 有内容，`text` 是接入点的 `fallback`。

### 10.6 脚本 API 补充与沙箱

- 实时脚本还可以读取：`api.dt`（这一步的毫秒数）、`api.time`（游戏开始后的毫秒数）、`api.input`。
- 脚本在沙箱里运行：不能联网、不能读写文件、不能读取真实时间，也不能用 `Math.random`，随机数请用 `api.random`。
- 每次调用受 `realtime.tick_ms` 的时间上限和 `scripts.limits.memory_mb` 的内存上限约束（默认 16 MB），超出会被中止。
- 脚本文件每次调用都会重新执行，顶层常量可以随便用；需要保存的数据请写进状态（`json` 类型最方便）。

### 10.7 实时示例

仓库 `tests/fixtures/realtime-mini/` 是一个完整的小示例《星星收集者》：方向键、WASD 或虚拟摇杆移动，按住空格或“冲”加速；定时生成星星，倒计时 60 秒；带相机跟随的图块地图；吃到星星有音效；第 5 颗星时异步请求 AI 打气。截图见 `docs/images/realtime-mini-desktop.png`、`docs/images/realtime-mini-mobile.png`。
