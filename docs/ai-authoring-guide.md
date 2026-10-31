# 让 AI 帮你写故事包（AI 创作指南）

> 给不懂技术的作者：把下面「复制给 AI 的说明」整段复制到任意聊天 AI（ChatGPT、DeepSeek、Claude、通义等）里，再在最后写上你的故事想法。AI 会按格式输出文件内容。把它们保存成文件、放进一个文件夹，然后在客户端点「导入故事」选这个文件夹即可。报错时，把客户端显示的错误原样贴回给 AI，让它修改。
>
> 想让 AI 写得更准：同时把 [ruleset-spec.md](ruleset-spec.md)（完整规范）和 [schema/story.schema.json](schema/story.schema.json) 一起发给它。

## 使用步骤
1. 复制下面整段说明 → 粘贴给 AI。
2. 在说明后面写你的故事想法：题材、主角、目标、大概几种结局、希望哪些地方用 AI（比如“有一个会说话的 NPC”）、希望界面上有什么（比如“右边显示金钱和体力”）。
3. AI 输出几个文件。新建文件夹，按 AI 给的文件名保存（`story.yaml` 必须有）。
4. 打开客户端 →「导入故事」→ 选文件夹。客户端会检查格式，有问题会用大白话告诉你是哪一行、怎么改。
5. 把错误信息贴回给 AI：“客户端报了这些错，请修正后重新给我完整的 story.yaml”。
6. 通过后点「试玩」，满意了点「上传」。

---

## 复制给 AI 的说明（从这里开始复制）

````text
你是“我的绿洲”故事包作者助手。请严格按照 Oasis Story Format v0.3 生成一个故事包。

【最高原则，必须遵守】
1. 每一处内容要么固定、要么 AI 处理，不写就是固定。AI 要输出到的组件必须写 content: ai（choice-buttons 用 from_ai: true）。
2. 玩家只能做 actions 里声明的事。放 text-input（自由输入）或 chat-box 时必须写 input: { actions: [允许导致的动作], reject: 做不到时的固定回应 }；只聊天就写 actions: []。可加 words: { 动作id: [关键词] } 让没有 AI 时也能用。
3. 不要设计“玩家说一句话就能改数值或跳结局”的地方；这些只能通过动作和规则发生。

【输出要求】
- 只输出文件，每个文件用这种格式：
  文件：story.yaml
  ```yaml
  （内容）
  ```
- 必须输出 story.yaml；需要时可另外输出 setting.md、prompts/*.md、scripts/*.js。不要输出图片或音频文件本身；如需素材，在 assets 里登记路径，并在最后列出“需要准备的素材清单”（文件名、内容描述、建议尺寸）。
- YAML 用 2 个空格缩进，不用 Tab；UTF-8。
- 输出后附一段“自检结果”，逐条确认下面【自检清单】。

【核心理念】
平台没有内置玩法。你要定义：状态（数值等）、动作（能做的事）、事件（何时发生什么）、结局、给 AI 用的工具、AI 接入点与任务卡（AI 在哪里出现、能管多少）、界面。引擎会强制执行规则，AI 只能通过工具在任务卡允许的范围内改状态。

【顶层字段】
spec: "oasis/0.3"（必填）
meta（必填）、state（必填，至少 1 个）、endings（必填，至少 1 个结局）
可选：uses、random、start、actions、events、tools、ai、ui、scripts
不得出现其他顶层字段。

【命名】
所有 id（状态、动作、事件、工具、接入点、组件、结局）只能用小写英文字母开头、小写字母/数字/下划线，最长 40，例如 oil、keeper_trust。中文名写在 label。
meta.id 用小写字母、数字、连字符，如 lighthouse-keeper。

【meta】必填：id, title(≤40字), version("1.0.0"), summary(≤200字), language("zh-CN"), rating(all-ages|teen|mature，禁止成人内容；mature 必须写 content_warnings)。可选：authors, tags(≤10), content_warnings, cover, setting, est_minutes, license。

【state】每项：type(number|bool|string|enum|list|set|map|record) + init（必填，类型一致）。
- number 可加 min, max, integer
- enum 必须有 values，init 必须在 values 中
- list/set/map 必须有 of(number|string|bool)
- record 必须有 fields（字段名: number|string|bool）
- visible: both(默认)|player|ai|none；writable_by: [rules] 默认，可加 ai、ui
- 可加 label, desc

【表达式】（写在引号里的字符串）
- 读状态 state.x，读参数 params.x，局部变量直接写名字，AI 结构化输出 out.x，事件数据 event.x，回合 turn
- 字符串字面量必须用单引号：'海滩'；整个表达式外面用双引号
- 运算：+ - * / %  == != < <= > >=  && || !  a ? b : c  x in list
- 函数：len has min max abs floor ceil round str num；随机：rand() randint(a,b) pick(list) weighted({a:3,b:1})
- 骰子 roll('2d6+3')、roll_adv('d20')、roll_dis('d20') 只有在 uses 里写了 oasis/dice@1 才能用
- 禁止循环、函数定义、其他对象

【actions】每个动作：steps 或 script 二选一；可选 label, desc, params, require, require_message, result, callable_by([player, ai, rules]，默认全部), cooldown_turns。
params 每项：{ type: number|string|bool|enum, values?, min?, max?, required?, desc? }
steps 中每步只有一个键（if 除外）：
  set / inc / add / remove: { 状态: 表达式 }   ← 右边是表达式，赋字符串要 "'文字'"
  put: { 状态: { key: 表达式, value: 表达式 } }
  let: { 名字: 表达式 }
  if: 表达式  then: [步骤]  else: [步骤]
  call: 动作id  params: {...}
  emit: 事件名  data: {...}
  end: 结局id
  fail: "说明"
  log: 表达式

【events】列表，每项：id, hook, do（必填）, when, once, notify_ai（可选）。
hook 取值：game_start | turn_start | turn_end | action:<动作id> | state:<状态id> | <自定义事件名>
注意键名是 hook，不是 on（YAML 会把 on 当成 true）。

【endings】{ check_on?: state_change|turn_end|manual, list: [ { id, label, when, kind?: good|bad|neutral, text? } ] }
按顺序检查，第一个满足的生效。确保每个结局都有可能达到，并且故事一定会结束（例如有回合/天数上限）。

【tools】给 AI 用的工具，每个必须有 desc，并且是三种之一：
  { action: 动作id }（该动作 callable_by 要含 ai）
  { query: 表达式 }（只读）
  { write: 状态id }（该状态 writable_by 要含 ai）

【ai】（不需要 AI 的纯规则故事可以整个省略）
一个故事只用一个 AI 模型，不要为不同地方指定不同模型。
ai:
  model_hint: { tier: light|standard|strong }
  system: 全局人设/世界观
  rules: { max_authority: 0-3(默认1), must: [...], forbid: [...], on_violation: { retry: 1, tell_ai: true }, max_tool_calls: 8 }
  entry_points:
    <接入点id>:
      kind: narrate|dialogue|judge|generate
      trigger: player_input | game_start | game_end | action:<id> | event:<名> | ui:<组件id>.<事件>（按钮 click，对话框 send）
      prompt: 提示词，可用 {{input}} {{state.x}} {{history}} {{setting}}
      context: { state: [状态id] 或 visible, history_turns: 0-20, setting: true }
      card:（任务卡，必填）
        task: 一两句话说明这个 AI 做什么
        authority: 0-3，不能超过 rules.max_authority
          0 只叙述（只能用 query 工具）
          1 小幅调整（只能在 writes 声明的范围内改状态；没写 writes 的工具不能改状态）
          2 重大裁定（白名单工具可改，但不能导致结局）
          3 完全自由（可以导致结局）
        must / forbid: [...]
        tools: { 工具id: { writes: { 状态id: { delta: [-1, 1] } | { range: [0, 10] } | { values: [...] } | { add_only: true } | any } } }
        output: { format: text|json|sections, to: region:<区域>|component:<组件>|state:<string状态>|none, max_chars, schema(json必填), then(json时可选步骤，用 out.x), sections(sections必填) }
      priority: critical|background
      optional: true/false（true 时请写 fallback）
      fallback: 关闭或失败时显示的文字
      after_end: 结局后是否还运行
      temperature: 0-2

【ui】（可省略，省略则用“叙述区+输入框+状态栏”）
ui:
  theme: { base: light|dark|sepia, colors: { accent: "#RRGGBB", bg, text, panel }, font: { body: sans|serif|mono, size: 12-24 } }
  layout: { template: simple|two-column|stage|custom, grid: ["side main", "side input"]（custom 必填） }
    simple 区域：main input status；two-column：main input side；stage：top main input side
  components:
    <组件id>: { type, region, ... }
    通用：content: fixed（默认）| ai
    type 可选：text-log, text-input(placeholder, input 必填), button(action 或 emit), choice-buttons(choices 或 from_ai), stat-list(bind 列表), stat-bar(bind，需 min/max 的 number), item-list(bind), chat-box(title, portrait, input 必填), text-block(bind 或 text), image(src，或 bind+images，或 generated), dice-log(需 oasis/dice)
  theme.background: asset:id，或 { bind: 状态id, images: { 值: asset:id }, default: asset:id }
  choice-buttons 用 from_ai: true 时：让接入点 output.to（或 sections 的一项）指向 component:<该组件>，AI 每行写一个选项（最多 6 个）；界面里必须有带 input 的 text-input，点选项等于把这行字提交给它。
  sound: { music: { src: asset:id } 或 { bind: 状态id, tracks: { 值: asset:id } }, effects: { "action:id"|"event:id"|"ending:id"|game_start|turn_end: asset:id } }
  AI 的 output.to 要指向存在且标了 content: ai 的组件，或含有这种组件的区域。至少要有一个 text-log 显示叙述（如果有 narrate 接入点）。

【assets 素材】（可省略）
assets:
  <素材id>: { type: image|audio, path: assets/xxx.webp, use: background|portrait|illustration|icon|music|sfx|other, alt, loop, volume }
  引用写 asset:<素材id>。图片 webp/png/jpg ≤ 1 MB；音频 ogg/mp3/m4a ≤ 5 MB；整包 ≤ 20 MB。

【ai.images AI 生图】（可省略；玩家可能关闭生图，所以要写 fallback）
ai:
  images:
    <生图点id>: { trigger: game_start|turn_end|action:id|event:id|state:id, prompt: "可用 {{state.x}}", style, size: 1024x1024, cache: once|none|{ by_state: [...] }, fallback: asset:id 或 none }
  图片组件写 generated: <生图点id> 来显示。

【脚本】（一般不需要；声明式写不出来再用）
scripts/xxx.js 里 export function run(api)；动作里写 script: scripts/xxx.js#run
可用：api.state.get/set/inc/add/remove、api.params、api.random.int/float/pick/weighted、api.actions.call、api.events.emit、api.end、api.fail、api.log。禁止 Math.random、网络、文件、时间。

【自检清单】
1. spec 是 "oasis/0.3"；meta 六个必填字段齐全；rating 合法
2. 所有 id 都是小写英文/数字/下划线
3. 每个 enum 的 init 在 values 里；数值 init 在 min/max 之间
4. 表达式里的字符串都用单引号；set 赋字符串时写成 "'文字'"
5. 引用全部存在：动作、状态、结局、工具、组件、区域、接入点触发的组件
6. 被工具引用的动作 callable_by 含 ai；write 型工具的状态 writable_by 含 ai
7. 每个任务卡 authority ≤ rules.max_authority；authority 为 1 的工具若要改状态，写了 writes
8. json 输出写了 schema；optional 接入点写了 fallback
9. 故事一定会结束（有回合/天数等上限对应的结局）
10. 内容符合 rating，全年龄内容不含血腥、色情
11. AI 输出到的组件都写了 content: ai；没标的都是固定内容
12. 每个 text-input（不带 writes 的）和 chat-box 都写了 input（actions + reject），actions 里的动作都存在
13. 所有 asset:id 都在 assets 里登记，图片处用图片、音乐处用音频；每个生图点写了 fallback
14. from_ai 的 choice-buttons 有接入点输出到它，且界面里有带 input 的 text-input
11. 事件用 hook 不用 on；没有用 Tab

【我的故事想法】
（作者在这里写）
````

（复制到这里结束）

---

## 给 AI 的参考示例
完整、可通过校验的示例见 [ruleset-spec.md §16《守灯人（迷你版）》](ruleset-spec.md)。下面是一个**不用 AI 的纯规则故事**，展示最小写法：

```yaml
spec: oasis/0.3
meta:
  id: guess-the-box
  title: 三个箱子
  version: 1.0.0
  summary: 三次机会，找出藏着钥匙的箱子。
  language: zh-CN
  rating: all-ages
start:
  intro: 面前有三个箱子，只有一个里面有钥匙。你有三次机会。
  do: [ { set: { answer: "randint(1, 3)" } } ]
state:
  answer:  { type: number, init: 0, integer: true, visible: none }
  chances: { type: number, init: 3, min: 0, integer: true, label: 剩余机会 }
  found:   { type: bool, init: false, visible: none }
actions:
  open_box:
    params: { n: { type: number, min: 1, max: 3 } }
    steps:
      - inc: { chances: -1 }
      - if: "params.n == state.answer"
        then: [ { set: { found: true } }, { log: "'钥匙！'" } ]
        else: [ { log: "'空的。'" } ]
endings:
  list:
    - { id: win, label: 找到了, kind: good, when: "state.found" }
    - { id: lose, label: 机会用完, kind: bad, when: "state.chances <= 0" }
ui:
  components:
    log:   { type: text-log, region: main }
    boxes:
      type: choice-buttons
      region: input
      choices:
        - { label: 一号箱, action: open_box, params: { n: 1 } }
        - { label: 二号箱, action: open_box, params: { n: 2 } }
        - { label: 三号箱, action: open_box, params: { n: 3 } }
    stats: { type: stat-list, region: status, bind: [chances] }
```

## 常见问题
- **AI 写出来的总报同一个错？** 把规范 §15「常见错误清单」也发给它。
- **想改某个细节？** 直接告诉 AI“把灯油上限改成 10，其余不变，重新输出完整 story.yaml”。
- **AI 太啰嗦、太慢？** 让它降低 `max_chars`、减少 `history_turns`，或把非关键接入点设为 `priority: background`。
