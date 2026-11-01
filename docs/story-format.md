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
  - 单张图片不超过 10 MB
  - 单个音频不超过 30 MB
  - 单个文本或脚本文件（yaml/json/md/txt/js/ts/lua/py）不超过 2 MB
  - 字体只受整包和单文件上限限制
  - **任何单个文件都必须小于 100 MB**（GitHub 的硬性限制）
  - 整包不超过 300 MB
  - 最多 2000 个文件
  - 下载说明：超过 20 MB 的单个文件，客户端会自动改走 GitHub 直连（jsDelivr 不收大文件）；整包超过 50 MB 的故事，发布页不提供 .oasis 直接下载，会链接到 GitHub 上的故事文件夹，玩家用客户端「在线故事库」下载。素材越大，玩家下载越久，能压缩的尽量压缩（图片优先 WebP，音乐优先 OGG）。

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
| `title` | ✅ | 故事名称。字符串，或中英双语 `{ zh: 雨夜书店, en: Rainy Bookshop }`（**投稿故事库必须中英都写**） |
| `version` | ✅ | `x.y.z` 格式 |
| `summary` | ✅ | 简介。字符串或 `{ zh: …, en: … }`（**投稿故事库必须中英都写**） |
| `language` | ✅ | 主要语言，例如 `zh-CN`、`en` |
| `languages` | | 故事支持的语言，例如 `[zh, en]`（见第 11 节） |
| `rating` | ✅ | `all-ages`、`teen` 或 `mature`（`mature` 时 `content_warnings` 必填）。**公开故事库只收 `all-ages`（全年龄）**，其他分级只能本地导入 |
| `tags` | | 标签数组，每项是字符串或 `{ zh, en }`。**投稿故事库必须正好 3 个，每个中英都写** |
| `authors` / `content_warnings` | | 字符串数组（`content_warnings` 每项也可写 `{ zh, en }`） |
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

- `type`：`image`、`audio`、`font` 或 `video`。
- `path`：包内路径。扩展名必须和类型对得上：图片用 webp、png、jpg、gif、avif，音频用 ogg、mp3、m4a、wav、flac、opus，字体用 woff2、woff、ttf、otf，视频用 webm、mp4（见 10.9）。
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
  title: { zh: 示例故事, en: Sample Story }
  version: 1.0.0
  summary: { zh: 一句话简介。, en: A one-line summary. }
  language: zh-CN
  languages: [zh, en]
  rating: all-ages
  tags:
    - { zh: 悬疑, en: Mystery }
    - { zh: 短篇, en: Short }
    - { zh: 纯规则, en: Rules only }
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
  interpolate: false               # true：render 每个显示帧都调用（见 10.3 “画面帧率”），默认 false
  on_tick: scripts/game.js#tick    # 每次推进时调用（可选）
  on_ai: scripts/game.js#onAi      # 脚本发起的 AI 请求返回时调用（可选）
  on_resize: scripts/game.js#resize # 可用区域尺寸变化（窗口缩放、手机转屏）后、下一步开头调用（可选），见 10.8
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
- `size: fill`：画布铺满所在区域，像素尺寸等于实际显示尺寸，窗口缩放、手机转屏时自动变化（这时 `width`/`height` 不生效）。再写 `hidpi: true` 会乘上设备像素比，高清屏更清晰。详见 10.8。
- 每次推进后调用一次 `render`。`api.params` 里有 `width`、`height`（画布当前像素尺寸）和 `dpr`（设备像素比）。render 函数只能读状态，对状态的任何改动都会被撤销，也不能播放声音或请求 AI。
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
| `api.draw.sprite(素材id, x, y, { frame_w, frame_h, frame?, fps?, frames?, start?, loop?, w?, h?, … })` | 精灵表帧动画，见下 |
| `api.draw.particles(发射器名, x, y, { rate?, burst?, seq?, … })` | 粒子效果，见下 |

**所有图形通用的可选效果**（不写就是原来的样子）：

| 选项 | 说明 |
|---|---|
| `alpha` | 透明度 0–1 |
| `rotation` | 旋转角度（弧度），绕锚点旋转（rect、image、sprite、text、circle） |
| `scale`、`scale_x`、`scale_y` | 缩放倍数 |
| `anchor_x`、`anchor_y` | 锚点，0–1；默认 0（左上角），`0.5` 表示 (x, y) 是中心 |
| `flip_x`、`flip_y` | 水平/竖直翻转（image、sprite） |
| `tint` | 给图片染色，例如 `"#ff8080"`（image、sprite、粒子图片） |
| `blend` | 混合模式：`normal`（默认）、`add`（叠加发光）、`multiply`（变暗）、`screen`（变亮） |
| `glow` | 发光：`true` 或 `{ color?, size? }`（circle、text） |
| `outline` | 文字描边：`true` 或 `{ color?, width? }`（text） |

- **精灵表**：图片按 `frame_w × frame_h` 切成格子，从左到右、从上到下编号（从 0 开始）。写 `frame` 指定显示第几帧；不写 `frame` 而写 `fps`，就按这个速度自动播放（`start` 起始帧、`frames` 帧数、`loop: false` 播完停在最后一帧）。自动播放由客户端按屏幕刷新率推进，不占脚本时间，也不影响状态。`api.draw.image` 也接受 `frame_w`/`frame_h`/`frame`/`fps`。
- **粒子**：同一个发射器名在每次 render 里都出现，它就持续发射；不再出现后，剩下的粒子自然消失。选项：`rate`（每秒发射数）、`burst`（一次性喷出的数量，`seq` 变化时再喷一次）、`life_ms`（寿命，默认 800）、`speed`（像素/秒，默认 60）、`angle`（方向角度，默认 -90 即向上）、`spread`（散开角度，默认 360）、`gravity`（像素/秒²）、`drag`、`size`/`end_size`、`color`/`end_color`、`radius`（发射区域半径）、`image`（用图片当粒子）、`spin`、`max`（最多粒子数，默认 500，上限 3000）、`blend`（默认 `add`）、`soft: false`（实心圆点）。粒子完全在客户端模拟，纯视觉，不进状态、不影响结果。
- **画面帧率**：客户端用显卡（WebGL）合批绘制，设备不支持时自动改用 Canvas2D（此时 `tint` 不生效）。画面按屏幕刷新率（通常 60fps 以上）绘制，跟 `tick_hz` 无关；默认只在每次推进后调用一次 `render`，中间帧重放同一组指令（动画和粒子照样流畅）。如果希望移动本身也按 60fps 平滑，写 `realtime.interpolate: true`：render 每个显示帧都调用，`api.alpha`（0–1）是离下一次推进的进度，作者可以在状态里存上一步的位置，按 `上一步 + (这一步 − 上一步) × api.alpha` 画。这样更顺滑，但 render 调用次数会变多。
- 高分屏会自动按屏幕像素密度提高清晰度（最多 2 倍），作者仍然用 `width × height` 的坐标作画。
- **调试**：玩的时候按 F3，右上角显示帧率、每帧耗时、tick/render 脚本耗时、绘制数量和渲染器类型。

- `fixed: true` 表示这条指令不受相机影响，用来画分数等界面元素。
- 图块地图：`tileset` 是图片素材 id，图里的图块按 `tile_size` 切成格子、每行 `columns` 个，从 0 开始编号。`map` 是二维数组（或字符串数组，每个字符一格），每个值是图块编号；`-1`、`null`、`.`、空格表示空。`colors: { 值: 颜色 }` 可以不用图片、直接用纯色方块画。
- 颜色写 CSS 颜色，例如 `#ffcc00`、`rgba(0,0,0,.5)`。

### 10.4 声音

`api.sound.play(素材id, { volume?, loop?, channel?, fade_ms?, rate?, pan? })` 播放一段已登记的音频素材；`api.sound.stop(素材id?, { fade_ms? })` 停止声音，不填 id 就全部停止。每步最多 32 个声音指令。玩家的静音和音效音量设置会生效。

- 多个声音可以同时播放（客户端用 WebAudio 混音，最多同时 48 个）。
- `channel`：声道名，例如 `"music"`。同一声道同时只放一个，换曲时旧的淡出、新的淡入（交叉淡化，时长 `fade_ms`，声道默认 600 毫秒）。
- `rate` 播放速度（0.25–4，会变调），`pan` 左右声像（-1 到 1）。
- 开始游玩前，客户端会预加载并解码所有登记的图片和音频，显示加载进度，之后播放没有延迟。

### 10.5 AI（异步、结构化）

1. 声明一个 `trigger: script` 的接入点，推荐 `output.format: json` 并写好 `schema`。
2. 脚本里调用 `api.ai.request(接入点id, 输入文字?, 数据?)`，立即返回请求编号（同时最多 4 个，超出返回 `null`）。游戏循环不会等待 AI。
3. AI 返回后，先按接入点的 `output.then` 处理（可以用 `out.字段`），再调用 `realtime.on_ai`。`api.params` 包括：`request`（请求编号）、`entry`、`data`（按 schema 整理好的 JSON 对象）、`text`、`error`（失败原因，成功时为 `null`）。
4. 没有配置 AI 或请求失败时，`on_ai` 也会被调用：`error` 有内容，`text` 是接入点的 `fallback`。

### 10.6 脚本 API 补充与沙箱

- 实时脚本还可以读取：`api.dt`（这一步的毫秒数）、`api.time`（游戏开始后的毫秒数）、`api.input`、`api.screen`（`{ width, height, dpr, takeover }`，客户端可用区域的 CSS 像素尺寸，见 10.8）；render 里还可以读 `api.alpha`（见 10.3 “画面帧率”，不开 `interpolate` 时总是 0）。
- 任何脚本都可以读 `api.lang`：玩家选的语言，`"zh"` 或 `"en"`（见第 11 节）。
- 脚本在沙箱里运行：不能联网、不能读写文件、不能读取真实时间，也不能用 `Math.random`，随机数请用 `api.random`。
- 每次调用受 `realtime.tick_ms` 的时间上限和 `scripts.limits.memory_mb` 的内存上限约束（默认 16 MB），超出会被中止。
- 脚本文件每次调用都会重新执行，顶层常量可以随便用；需要保存的数据请写进状态（`json` 类型最方便）。脚本里的变量、新建的全局变量都不会留到下一次调用，`api` 对象不能修改。
- 沙箱是常驻的（每个脚本文件一个，只在第一次调用时创建），所以每次调用的固定开销很小（约 0.02 毫秒），时间上限几乎都留给作者的代码。

### 10.7 实时示例

仓库 `tests/fixtures/realtime-mini/` 是一个完整的小示例《星星收集者》：方向键、WASD 或虚拟摇杆移动，按住空格或“冲”加速；定时生成星星，倒计时 60 秒；带相机跟随的图块地图；吃到星星有音效；第 5 颗星时异步请求 AI 打气。截图见 `docs/images/realtime-mini-desktop.png`、`docs/images/realtime-mini-mobile.png`。

### 10.8 接管整个页面（ui.takeover）

```yaml
spec: oasis/0.4
realtime:
  on_resize: scripts/game.js#resize     # 可选
ui:
  takeover: true                        # 故事接管整个客户端页面
  layout: { template: custom, grid: ["screen"] }
  components:
    screen: { type: canvas, region: screen, size: fill, hidpi: true, render: scripts/game.js#draw }
```

- `ui.takeover: true`（oasis/0.4，可选，默认 `false`）：客户端不再显示顶栏、调试栏等任何外框，整个窗口交给故事。Windows 上铺满窗口（F11 切换真正的全屏）；安卓上进入沉浸全屏，隐藏状态栏和导航栏，退出故事后恢复。
- 画面怎么排完全由作者决定：可以只放一个 `size: fill` 的画布自己画全部内容，也可以用 `layout` 摆普通组件（文字、按钮、选项……），各区域铺满整个窗口；手机上也按作者写的布局摆放，不会被改成单列。
- 尺寸：`api.screen` 随时可读；尺寸变化后，下一步开头会先调用 `realtime.on_resize`（`api.params` 是 `{ width, height, dpr, takeover }`），可以在里面把新尺寸写进状态、重新排版。`render` 里的 `api.params.width/height` 是画布当前的像素尺寸。建议坐标用比例存，屏幕多大都能画。
- **玩家的出口（故事无法关闭）**：任何时候都可以打开客户端自己的暂停菜单——
  - 桌面：**按住 Esc 1 秒**（短按 Esc 仍然交给故事，可以绑定成玩法按键）；
  - 安卓：**系统返回键 / 返回手势**；
  - 任何设备：**右上角的 ⋯ 小按钮**，平时几乎透明，动一下鼠标或摸一下屏幕就会显出来。

  暂停菜单打开时故事暂停（时间不走、按键全部松开）。菜单里有：继续、存档/读档、声音、外观、设置（AI 服务商与 API Key、AI 用量）、切换全屏、重新开始、回故事库。接管模式下 **token 用量显示在暂停菜单里**（平时在顶栏）。脚本跑在沙箱里碰不到页面，所以故事不能拦截这些按键、不能遮住按钮、也不能关掉菜单；请不要把右上角那一小块当作必须点击的位置。
- 不写 `takeover` 的故事和以前完全一样。
- 完整示例：`tests/fixtures/takeover-mini/`《满屏光点》。

### 10.9 引擎功能：输入框、界面层、视频、字体、特效、物理、设备

实时故事（oasis/0.4）可以用下面这些功能，把客户端当成一个完整的 2D 引擎来用。脚本仍然跑在沙箱里：脚本只“提出请求”，真正的输入框、按钮、视频由客户端生成，故事碰不到页面本身。

**原生文字输入框 `api.textinput`**（主角的小对话框、起名、聊天）

```js
api.textinput.open({ id: "reply", title: { zh: "你想说什么？", en: "What do you say?" },
  placeholder: { zh: "输入……", en: "Type…" }, multiline: false, max_length: 120, value: "" });
api.textinput.close();               // 脚本主动关掉（不会回调）
```

- 弹出系统原生输入框：Windows 上可以用中文输入法（拼音、手写等组字过程都正常，组字时按回车是选字不是提交）；安卓上自动弹出软键盘，输入框会抬到键盘上方。
- 同一时刻只有一个输入框。单行时回车提交；多行时 Ctrl+回车提交。短按 Esc 或点“取消”是取消。
- 结果交给 `realtime.on_ui`：`api.params` 是 `{ type: "text", request, id, text, cancelled }`。`open` 的返回值就是 `request`。文字最长 2000 字。
- 输入框打开时，键盘不会触发故事绑定的按键。

**界面层 `api.overlay`**（HUD、菜单、背包列表、对话框、富文本）

```js
api.overlay.show("menu", { anchor: "center", modal: true, z: 1, style: { bg: "#000c", padding: 16, radius: 12 },
  children: [
    { type: "rich", spans: [{ text: "第一章 ", bold: true, color: "#fc6" }, { text: { zh: "雪线", en: "Snowline" } }] },
    { type: "list", id: "items", items: [{ id: "rope", text: "绳子", sub: "×2" }, { id: "torch", text: "火把" }] },
    { type: "row", children: [{ type: "space" }, { type: "button", id: "close", text: { zh: "关闭", en: "Close" } }] },
  ] });
api.overlay.hide("menu");            // hide() 不带参数 = 全部关掉
```

- 节点类型：`text`、`rich`（多段不同样式的文字）、`button`、`list`（可滚动列表）、`image`（`asset` 写素材 id）、`row`、`column`、`space`。
- 位置：`anchor`（`center`/`top`/`bottom`/`left`/`right`/`top_left`/…），也可以写 `x`/`y`/`w`/`h`（数字是像素，也可以写 `"50%"`）。`modal: true` 时后面加一层半透明遮罩并挡住点击。
- 样式（白名单）：`size`、`color`、`bg`、`radius`、`padding`、`gap`、`width`、`height`、`opacity`、`border`、`border_color`、`font`（可以是字体素材 id）、`bold`、`italic`、`align`、`scroll`。
- 点按钮 → `on_ui` 收到 `{ type: "button", overlay, id }`；点列表项 → `{ type: "select", overlay, list, id }`。
- 安全：这是**数据**不是 HTML。文字一律按纯文本显示，写 `<b>` 就显示 `<b>` 这几个字；没有任何脚本、链接或事件属性。最多 300 个节点、8 层、描述不超过 200 KB。界面层永远在“⋯”按钮和暂停菜单下面。

**全屏视频 `api.video`**（过场动画）

- `api.video.play("intro", { loop: false, muted: false, skippable: true, fit: "contain" })`，`api.video.stop()`。素材要登记成 `type: video`（webm 或 mp4，单个文件小于 100 MB）。
- 播完或跳过后 `on_ui` 收到 `{ type: "video", request, id, ended, skipped }`，坏文件时多一个 `error`。暂停菜单打开时视频也暂停。

**字体**：登记 `type: font` 的素材，开始前会自动加载；`api.draw.text(s, x, y, { font: "素材id" })` 或界面层样式 `font: "素材id"` 即可使用。

**画面**

- 图层：任何绘制选项里写 `z`（数字，越大越靠前），同一个 z 按绘制顺序。用了 z 时请只用一个 `api.draw.camera`，界面元素用 `fixed: true`。
- 镜头：`api.draw.camera(x, y, zoom, { rotation, center_x, center_y })`，可以旋转。
- 精灵表动画、图块地图、粒子：见 10.3（`sprite`、`tilemap`、`particles`）。
- 特效：`api.fx.shake(强度像素, 毫秒)` 震屏；`api.fx.fade({ color, out_ms, hold_ms, in_ms })` 转场；`api.fx.filter({ blur, grayscale, sepia, hue, brightness, contrast, saturate, invert })` 整个画面的滤镜（`{}` 取消）。都是纯视觉，不影响逻辑。

**场景切换** `api.scene.go("forest", { fade_ms: 400, color: "#000" })`：先在 `state` 里声明 `scene`（例如 `{ type: string, init: title, visible: none }`）。它把 `scene` 改成新名字并播放转场；render 和 on_tick 里按 `api.state.get("scene")` 画不同的场景。场景跟着存档走。

**缓动、补间、碰撞、物理**（纯计算，在沙箱里，结果可重现）

- `api.ease.linear / in_quad / out_quad / in_out_quad / in_cubic / out_cubic / in_out_cubic / in_sine / out_sine / in_out_sine / out_back / out_elastic / out_bounce`（参数 0~1）。
- `api.tween(from, to, start_ms, duration_ms, "out_quad")`：按 `api.time` 算出当前值。`api.math.clamp / lerp / dist / angle / approach`。
- `api.collide.rect(a, b)`、`circle(a, b)`、`circle_rect(c, r)`、`point(x, y, r)`、`tile_at(map, tile, x, y)`。
- `api.physics.move(body, dx, dy, { rects, map, tile, solid })`：按 x、y 两步移动矩形，碰墙就停，返回 `{ x, y, hit_x, hit_y, on_ground }`。适合平台跳跃和俯视角走格子。
- 需要真正的刚体（会滚、会倒、会弹、用绳子连着）：用内置物理引擎，见 10.12。

**输入补充**

- 手柄：把 `Pad0`…`Pad16`（标准布局：Pad0=A/×，Pad1=B/○，Pad2=X/□，Pad3=Y/△，Pad4/5 肩键，Pad6/7 扳机，Pad8 选择，Pad9 开始，Pad12–15 十字键上下左右）写进 `input.keys` 即可；左摇杆（或十字键）自动驱动 `api.input.joystick`。
- 鼠标：`api.input.pointer.button`（0 左 1 中 2 右；右键点下时 `pressed.pointer_right`），`api.input.pointer.wheel`（这一步累计的滚轮量，向下为正）。
- 多点触控：`api.input.touches` 是 `[{ id, x, y, target }]`，每根手指一条（最多 10）。

**存档与本地数据**

- `api.save.now()`：请客户端立刻写一次自动存档（玩家仍可在暂停菜单里管理存档）。
- `api.storage.get(key)` / `api.storage.set(key, value)`：这个故事自己的小型本地数据（最高分、解锁、设置），**不随读档回滚**，跨周目保留。一条最多 64 KB，整个故事最多 1 MB；`set(key, null)` 删除。render 里只能读。

**设备**：`api.device.vibrate(毫秒或 [震, 停, 震…])`（安卓；每段最多 1 秒、最多 20 段；不支持的设备忽略）；`api.device.copy(text)` 复制到剪贴板（只能写，不能读）。

以上请求（除了 `storage.get`）都不能在 render 里用。`realtime.on_ui` 写法同 `on_ai`：`on_ui: scripts/game.js#onUi`。

### 10.10 为什么有些事情故事不能做

这些限制是为了保护玩家，不是能力不够：

- **不能直接写网页（HTML/CSS/JS）或拿到页面**：故事来自陌生作者。如果能直接操作页面，就能伪造“设置”页骗走玩家的 AI Key、遮住暂停按钮把玩家关在里面、或偷偷花玩家的 token。所以界面只能用 `api.overlay` 这种“描述数据”，由客户端来画。
- **不能联网**：同样怕偷 Key、偷存档、偷偷上传。AI 只能走玩家自己配置的那一个服务、那一个 Key，并且要经过接入点的权限检查。
- **不能读剪贴板、文件、真实时间、`Math.random`**：前两个是隐私；后两个会让存档、撤销和重放对不上。随机数用 `api.random`，本地数据用 `api.storage`。
- **脚本有时间上限（默认 16 毫秒，作者最多调到 50 毫秒）**：防止一个死循环把整个客户端卡死。
- **自定义着色器有限制**（见 10.11）：只能写片元着色器主体、只能读自己那张纹理、循环次数固定、大小有上限；编译太慢、出错、显卡太慢或丢失上下文时自动关掉、退回普通画法。写坏的着色器能把显卡卡住，这些限制是为了让玩家的设备不被一个故事拖垮。
- **出口永远在**：按住 Esc 1 秒、安卓返回手势、右上角“⋯”任何时候都能打开暂停菜单，输入框、界面层和视频都盖不住它们。

### 10.11 自定义着色器、Tiled 地图、九宫格、画布里的视频

**自定义着色器（GLSL）**

1. 在 `assets` 里登记：`wave: { type: shader, path: fx/wave.glsl }`（扩展名 `.glsl` 或 `.frag`，单个最多 32 KB）。
2. 文件里只写片元着色器的**主体**（WebGL 1 / GLSL ES 1.00 写法）：

```glsl
uniform float u_strength;              // 自定义参数：名字以 u_ 开头，类型 float / vec2 / vec3 / vec4
void main() {
  vec2 uv = vUv + vec2(sin(vUv.y * 40.0 + uTime * 3.0) * 0.01 * u_strength, 0.0);
  gl_FragColor = texture2D(uTex, uv) * vCol;   // vCol 是 tint 和 alpha（已预乘）
}
```

客户端已经在前面写好：`precision mediump float;`、`varying vec2 vUv; varying vec4 vCol;`、`uniform sampler2D uTex; uniform float uTime; uniform vec2 uRes; uniform vec2 uTexSize;`。`uTime` 是画面时钟（秒），`uRes` 是画布逻辑尺寸，`uTexSize` 是这张纹理的像素尺寸。颜色是**预乘透明度**的。

3. 使用：
   - 单个图形：`api.draw.image / sprite / video` 的选项里写 `{ shader: "wave", uniforms: { u_strength: 1 } }`；
   - 整个画面后期处理：`api.draw.post("crt", { u_scan: 0.5 })`，这一帧画完后整张画布再过一遍着色器（`uTex` 是画好的画面，`vUv` 覆盖全屏）。最多 4 个 `post`，按顺序叠加。

**安全限制**（校验器和客户端都会检查）：不能写 `#version`、`#extension` 等预处理指令（`#define` 可以）；不能用 `while` / `do`；`for` 循环次数要写固定数字，最多 256 次，最多 8 个循环；只能读 `uTex` 这一张纹理；不能重复声明客户端已经写好的变量。客户端另有保护：编译失败或编译超过 400 毫秒就不用这个着色器；用了着色器的帧每 30 帧测一次显卡耗时，连续两次超过 120 毫秒就关掉所有自定义着色器；刚用过着色器就丢失显卡上下文（驱动重置）的，恢复后也不再用。被关掉时画面**按普通方式继续画**（不会黑屏、不会卡死），F3 面板里显示原因。不支持 WebGL 的设备（Canvas2D）上着色器不生效，所以**不要让玩法依赖着色器**，只把它当画面效果。

**Tiled 地图（.tmj）**

- 在 Tiled 里把地图另存为 **JSON 地图格式（.tmj）**，图块集选“嵌入地图”（Embed Tileset）。只支持正交地图，不支持无限地图和“图片集合”类图块集。数据格式可以是 CSV、Base64、Base64+zlib/gzip。
- 登记：`level1: { type: tilemap, path: maps/level1.tmj }`。图块集用的图片也要登记成 `type: image`，路径和 .tmj 里写的一致（相对 .tmj 所在文件夹）；或者写 `tilesets: { 图块集名: 图片素材id }` 指定。
- 画：`api.draw.tiled("level1", { x: 0, y: 0, layers: ["ground", "deco"] })`。不写 `layers` 就画所有可见的图块层。支持多个图块集、图层透明度和偏移、图层组、图块翻转；镜头没有旋转时只画屏幕附近的格子，大地图也不卡。
- 读：`api.tiled.get("level1")` 返回 `{ width, height, tile_w, tile_h, layers, tilesets, properties }`，对象层里的对象有 `name`、`type`、`x`、`y`、`w`、`h`、`properties` 等，可以用来放出生点、敌人、门；`api.tiled.solids("level1")` 返回碰撞层合并后的矩形 `[{ x, y, w, h }]`（多边形对象给出 `points`）。碰撞层：图层自定义属性 `collision: true`，或者图层名里有 `collision` / `collide` / `solid` / `碰撞`。地图数据可能很大，建议开局取一次需要的部分存进状态，不要每步都取。

**九宫格图片**

- 画布里：`api.draw.nine(图片id, x, y, w, h, { slice: 8 })`，`slice` 是四边不拉伸的像素，一个数或 `[上, 右, 下, 左]`；可以加 `slice_scale`、`sx/sy/sw/sh`（从精灵图里取一块）、`tint`、`alpha`。
- 界面层：`{ type: "image", asset: "panel", slice: 12, repeat: "stretch" | "round" | "repeat", style: { width: 200, height: 80 } }`；或者给任意容器写样式 `bg_image: "panel", bg_slice: 12` 当背景框。

**画布里的视频**

- 视频素材（`type: video`）先在脚本里播放：`api.video.texture("rain", { play: true, loop: true, muted: true, rate: 1, seek_ms: 0, volume: 1 })`；`play: false` 暂停。
- render 里画当前画面：`api.draw.video("rain", x, y, w?, h?, { alpha, rotation, tint, shader? })`，可以和其他图形一起缩放、旋转、加着色器。
- 同时最多 4 个视频纹理；暂停菜单打开时自动暂停；玩家静音时视频也静音。不循环的视频播完后 `on_ui` 收到 `{ type: "video", id, ended: true, texture: true }`。视频画面是纯视觉，不影响状态。

### 10.12 内置 2D 物理引擎

物理世界是一份纯数据（JSON），整个模拟在脚本沙箱里运行：存进 `json` 状态就能跟着存档、撤销，同样的输入一定得到同样的结果。

```js
// state 里：world: { type: json, init: null, visible: none }
function tick(api) {
  let w = api.state.get("world");
  if (!w) {
    w = api.physics.world({ gravity: [0, 980] });                       // 像素/秒²，y 向下
    api.physics.add(w, { id: "ground", type: "static", x: 160, y: 230, w: 320, h: 20 });
    api.physics.add(w, { id: "ramp", type: "static", shape: "polygon", points: [[200, 220], [300, 220], [300, 150]] }); // 斜坡
    api.physics.add(w, { id: "crate", x: 60, y: 100, w: 20, h: 20, friction: 0.6 });
    api.physics.add(w, { id: "ball", shape: "circle", x: 290, y: 100, r: 6, restitution: 0.5 });
    api.physics.add(w, { id: "coin", type: "static", sensor: true, x: 120, y: 200, w: 12, h: 12 });
    api.physics.add(w, { id: "lamp", shape: "circle", x: 150, y: 60, r: 4 });
    api.physics.joint(w, { type: "pin", a: "lamp", x: 120, y: 20 });   // 钉在世界上的摆
  }
  if (api.input.pressed.jump) api.physics.impulse(w, "crate", 0, -400);
  for (const e of api.physics.step(w, api.dt)) if (e.type === "begin" && e.sensor) api.log("碰到了 " + e.b);
  api.state.set("world", w);
}
```

- `world({ gravity, iterations, substep_hz })`：`iterations` 求解次数（默认 10，越大越稳越慢），`substep_hz` 子步频率（默认 120）。
- `add(w, 物体)`：`shape` 为 `box`（`w`、`h`）、`circle`（`r`）或 `polygon`（`points`，相对 `x, y` 的点；凹的会自动取凸包，最多 16 个顶点）；`type` 为 `dynamic`（默认）、`static`、`kinematic`（按 `vx`、`vy`、`av` 移动，不受力）；还可以写 `angle`、`vx`、`vy`、`av`（角速度）、`density`、`friction`、`restitution`（弹性 0–1）、`damping`、`gravity_scale`、`fixed_rotation`（不转，适合角色）、`sensor`（只报碰撞不推开）、`group`（负数时同组之间不碰撞）、`tag`（随便存点什么）。返回物体本身，可以直接读写它的 `x`、`y`、`angle`、`vx`、`vy`、`av`。
- `joint(w, { type, a, b, … })`：`distance`（硬杆，长度默认等于当前距离）、`rope`（绳子，最长 `length`）、`pin`（铰链，`x, y` 是世界坐标的铰点）。不写 `b` 就连在世界上。锚点也可以用本地坐标 `ax, ay, bx, by`。
- `step(w, 毫秒)`：推进并返回这一步的碰撞事件 `[{ type: "begin" | "end", a, b, nx, ny, sensor }]`（法线从 a 指向 b）。
- 其他：`touching(w, id)` → `[{ id, nx, ny }]`（法线从这个物体指向对方，站在地上时 `ny > 0`）；`at(w, x, y)` → 这个点上的物体 id；`impulse(w, id, ix, iy, px?, py?)`；`get(w, id)`；`remove(w, id)`；`vertices(物体)` → 多边形的世界坐标顶点（画图用）。
- 规模：一个世界最多 512 个物体、256 个关节。物理在脚本时间上限内运行，几十个物体没有问题；物体很多时把 `realtime.tick_ms` 调高，或者降低 `iterations`。
- Tiled 的碰撞矩形可以直接变成静态物体：`for (const r of api.tiled.solids("level1")) api.physics.add(w, { type: "static", x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h })`（物体的 `x, y` 是中心）。

### 10.13 场景文件（scenes）

大故事可以把每个场景写成单独的脚本文件：

```yaml
scenes:
  start: title                       # 开始场景（不写就是第一个）
  list:
    title:  { script: scenes/title.js }
    forest: { script: scenes/forest.js, title: { zh: 森林, en: Forest } }
```

- 每个场景脚本里可以写这些函数（都可选，没写就跳过）：`enter`（进入时，`api.params` 是 `{ from, data }`）、`exit`（离开时，`{ to }`）、`tick`（每步，在 `realtime.on_tick` 之后）、`render`（每个画布都会调用，画在画布自己的 `render` 之后，`api.params.canvas` 是画布 id）、`ui`、`ai`（在 `on_ui`、`on_ai` 之后）、`resize`。
- 切换：`api.scene.go("forest", { data: { door: 2 }, fade_ms: 400 })`，当前这一步结束时先调用旧场景的 `exit`，再调用新场景的 `enter`。`api.scene.current()` 返回当前场景名。当前场景跟着存档走。
- 写了 `scenes` 时，画布组件可以不写 `render`。不写 `scenes` 的故事和以前一样（用 state 里的 `scene`）。

### 10.14 故事自己摆放的屏幕控件（input.controls）

```yaml
input:
  controls:
    - { id: move, type: joystick, anchor: bottom_left, x: 24, y: -24, size: 140 }
    - { id: jump, type: button, anchor: bottom_right, x: -24, y: -40, size: 72, label: { zh: 跳, en: Jump }, image: btn_a, pressed_image: btn_a_down }
    - { id: pad, type: dpad, anchor: bottom_left, hidden: true }
```

- `type`：`button`（按住时 `api.input.held.<id>`，刚按下时 `pressed.<id>`）、`joystick`（`api.input.sticks.<id>` 为 `{ x, y }`，第一个摇杆同时驱动 `api.input.joystick`）、`dpad`（十字键，按住方向时 `held.<id>_up / _down / _left / _right`，斜方向两个同时出现）。
- 位置：`anchor` 是贴在哪个角或边（`top_left`、`top`、`top_right`、`left`、`center`、`right`、`bottom_left`、`bottom`、`bottom_right`），`x`、`y` 是相对它的偏移（像素或 `"10%"`，向右、向下为正）；`size` 24–320 像素；`shape: circle | rect`；`color`、`opacity`；`image`、`pressed_image` 是图片素材 id；`label` 中英双语，最多 12 个字。
- `show: touch`（默认，只在触屏设备上显示）或 `always`；`hidden: true` 开始时隐藏。脚本里 `api.controls.show(["jump"])` 只显示这些，`api.controls.show(null)` 全部显示。最多 16 个。
- 写了 `controls` 时，`joystick`、`buttons` 这两项旧写法不再显示。控件永远在“⋯”出口按钮和暂停菜单下面，挡不住玩家退出。

### 10.15 声音效果：滤波、混响、空间声音

- `api.sound.play(id, { voice: "engine", filter: { type: "lowpass", freq: 800, q: 1 }, reverb: 0.3, x: 400, y: 120 })`：
  - `filter.type`：`lowpass`、`highpass`、`bandpass`、`notch`、`peaking`、`lowshelf`、`highshelf`；`freq` 10–22000 Hz；`q`；`gain`（-40 到 40 dB，peaking/shelf 用）。
  - `reverb`：混响比例 0–1。
  - `x`、`y`：声音在世界里的位置，配合 `api.sound.listener({ x, y, scale })`（听者位置，一般跟着主角；`scale` 是像素换算成米，默认 0.01）变成空间声音：远了变小，左右有方向感。
  - `voice`：给这个声音起个句柄名，之后用它修改或停止。
- `api.sound.set("engine", { volume, rate, pan, x, y, filter, reverb, fade_ms })`：实时修改正在播放的声音（按 `voice` 名，或者声道名 `channel`）。比如进水里时 `api.sound.set("music", { filter: { type: "lowpass", freq: 600 } })`，出水后 `{ filter: null }`。
- `api.sound.stop(null, { voice: "engine" })` 按句柄停止。
- 这些效果只影响声音，不影响状态；不支持 WebAudio 的设备上效果被忽略，声音照常播放。

## 11. 中英双语

所有故事都可以同时写中文和英文。玩家在客户端“设置 → 故事语言”里选 中文 / English，发布页也可以切换。

**写法**：任何玩家能看到的文字，既可以写普通字符串（老写法，照样有效），也可以写成按语言分开的对象：

```yaml
label: { zh: 灯油, en: Lamp oil }
text:
  zh: 雨下得更大了。
  en: The rain grows heavier.
```

可以这样写的字段：`meta.title`、`meta.summary`、`meta.tags` 每一项、`meta.content_warnings` 每一项、`start.intro`、状态的 `label`/`desc`、动作的 `label`/`desc`/`require_message`、参数的 `desc`、结局的 `label`/`text`、`fail` 步骤、AI 接入点的 `opening`/`fallback`、素材和生图点的 `alt`、组件的 `label`/`placeholder`/`title`/`text`、`choices[].label`、`input.reject`、`input.buttons[].label`。

**显示规则**：按玩家选的语言显示；作者没写这种语言时，显示另一种。普通字符串在两种语言下都原样显示。

**`meta.languages`**：写上故事支持的语言，例如 `[zh, en]`。

**脚本**：`api.lang` 返回 `"zh"` 或 `"en"`，画布和实时脚本可以按它画不同的文字。

**AI**：引擎会自动告诉 AI 玩家选了哪种语言，AI 写给玩家的文字会跟着用这种语言；JSON 输出的键名不变。作者写给 AI 的 `system`、`task`、`prompt`、`must`、`forbid` 只给 AI 看，不需要写两种语言。

**投稿故事库的要求**（不满足就不能合并）：
- `meta.title`（名称）和 `meta.summary`（简介）都必须同时写 `zh` 和 `en`；
- `meta.tags` 必须**正好 3 个**，每个都同时写 `zh` 和 `en`；
- `meta.rating` 必须是 `all-ages`（全年龄）。

其他文字缺某种语言只会提醒，不会拦下；但建议全部写成中英双语。

