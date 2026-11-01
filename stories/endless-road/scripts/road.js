// 无尽之路 / The Endless Road — 规则脚本
//
// 框架：
//   每走一里 → 引擎掷出「事件类别 + 强度」→ AI 把它写成一张「事件卡」（标题、描述、2~3 个选项）→ 玩家选一个 → 规则结算。
//   选项 = 动作（检定 / 付出 / 赌运 / 动手 / 接委托）+ 从菜单里挑的「收获」和「风险」。具体数值全部由规则按威胁和难度计算，
//   卡上直接显示，AI 改不了。没有 AI 时用内置的事件模板。
//   资源：口粮、药水、金币（消耗品）；铁料、魔晶（强化材料）；遗物（最多 3 件，被动效果）；
//   强化：武器、护甲、背包（携带上限）、营具（扎营效果），在交易事件里用金币和材料升级。
//
// 规则全部在这里；scripts/scene.js 只负责画面。

const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_NAME = { str: ["力量", "STR"], dex: ["敏捷", "DEX"], con: ["体质", "CON"], int: ["智力", "INT"], wis: ["感知", "WIS"], cha: ["魅力", "CHA"] };
const BIOMES = {
  plains: ["风语平原", "Whispering Plains"], forest: ["幽暗森林", "Gloomwood"], hills: ["古冢丘陵", "Barrow Hills"],
  swamp: ["腐沼泽地", "Rotfen Marsh"], mountains: ["霜脊山道", "Frostspine Pass"], ashlands: ["余烬荒原", "Emberwaste"],
};
// [中文名, 英文名, 精灵, 染色]
const FOES = {
  plains: [["游荡的豺狼", "A prowling jackal", "wolf", "gold"], ["拦路的强盗", "A highway bandit", "bandit", "none"], ["地精斥候", "A goblin scout", "bandit", "green"], ["草原软泥", "A meadow ooze", "ooze", "none"]],
  forest: [["灰鬃狼", "A grey-maned wolf", "wolf", "none"], ["巨型蜘蛛", "A giant spider", "spider", "none"], ["狗头人伏兵", "A kobold ambusher", "bandit", "red"], ["林间鬼火", "A forest wisp", "wisp", "green"]],
  hills: [["游荡的骷髅", "A wandering skeleton", "skeleton", "none"], ["古冢尸妖", "A barrow wight", "skeleton", "blue"], ["丘陵巨魔", "A hill troll", "troll", "none"], ["墓地幽魂", "A grave wisp", "wisp", "purple"]],
  swamp: [["沼泽鳄蜥", "A marsh drake", "drake", "green"], ["腐泥怪", "A rot ooze", "ooze", "shadow"], ["沼泽蜘蛛", "A bog spider", "spider", "green"], ["蜥蜴人猎手", "A lizardfolk hunter", "bandit", "green"]],
  mountains: [["雪原巨魔", "A frost troll", "troll", "blue"], ["冰霜元素", "An ice elemental", "wisp", "blue"], ["雪狼", "A snow wolf", "wolf", "pale"], ["矮人逃兵", "A dwarven deserter", "bandit", "blue"]],
  ashlands: [["火焰蜥龙", "A fire drake", "drake", "none"], ["焦骨食尸鬼", "A charred ghoul", "skeleton", "red"], ["熔岩犬", "A hellhound", "wolf", "red"], ["火焰元素", "A fire elemental", "wisp", "red"]],
};

// ===== 事件框架 =====
const KINDS = ["combat", "encounter", "discovery", "hazard", "mystic", "dilemma", "trade", "rest", "quest"];
const KIND_ICON = { combat: "⚔", encounter: "💬", discovery: "🔍", hazard: "⚠", mystic: "✨", dilemma: "⚖", trade: "🛒", rest: "🔥", quest: "📜" };
const KIND_NAME = {
  combat: ["敌人", "Enemy"], encounter: ["遭遇", "Encounter"], discovery: ["发现", "Discovery"], hazard: ["险境", "Hazard"], mystic: ["秘境", "Mystic"],
  dilemma: ["抉择", "Dilemma"], trade: ["交易", "Trade"], rest: ["休憩", "Rest"], quest: ["委托", "Quest"],
};
const BASE_WEIGHT = { combat: 34, encounter: 13, discovery: 12, hazard: 11, mystic: 8, dilemma: 6, trade: 9, rest: 7 };
const BIOME_WEIGHT = {
  plains: { encounter: 4, trade: 3 }, forest: { combat: 4, mystic: 2 }, hills: { mystic: 5, discovery: 3 },
  swamp: { hazard: 6 }, mountains: { hazard: 4, rest: -2 }, ashlands: { combat: 6, discovery: 2 },
};
// 每种类别允许的选项动作（AI 写了别的会被丢掉）
const VERBS = { combat: ["fight", "check", "pay"], encounter: ["check", "pay", "gamble", "fight", "quest"], discovery: ["check", "gamble", "pay"], hazard: ["check", "pay"], mystic: ["check", "pay", "gamble"], dilemma: ["pay", "check", "quest", "fight"], quest: ["check", "pay", "fight", "gamble"], rest: [], trade: [] };
const REWARDS = ["gold", "rations", "potion", "heal", "iron", "essence", "xp", "blessing", "relic", "map", "none"];
const RISKS = ["hurt", "lose_gold", "lose_rations", "curse", "poison", "ambush", "lost", "exhaust", "none"];
const COSTS = ["gold", "rations", "potion", "hp", "iron", "essence"];
const DIFFS = ["easy", "normal", "hard"];
const SIZE = { small: 0.6, medium: 1, large: 1.7, huge: 2.4 };
const R_NAME = {
  gold: ["金币", "gold"], rations: ["口粮", "rations"], potion: ["药水", "potion"], heal: ["恢复生命", "heal"], iron: ["铁料", "iron"], essence: ["魔晶", "essence"],
  xp: ["经验", "XP"], blessing: ["祝福", "blessing"], relic: ["遗物", "relic"], map: ["侦察", "scouting"], none: ["无", "nothing"],
  hurt: ["受伤", "hurt"], lose_gold: ["丢金币", "lose gold"], lose_rations: ["丢口粮", "lose rations"], curse: ["诅咒", "curse"], poison: ["中毒", "poison"],
  ambush: ["被袭击", "ambush"], lost: ["迷路", "get lost"], exhaust: ["疲惫", "exhaustion"], hp: ["生命", "HP"],
};
// 状态效果（按里程计时；疲惫直到扎营）
const STATUS = {
  blessed: ["祝福", "Blessed", "d20 +2"], cursed: ["诅咒", "Cursed", "d20 -2"], poisoned: ["中毒", "Poisoned", "每里 -1d4"],
  exhausted: ["疲惫", "Exhausted", "AC -2"], scouted: ["侦察", "Scouted", "下一里避开战斗"],
};
// 遗物（被动，最多 3 件）
const RELICS = {
  lucky_charm: ["幸运符", "Lucky charm", "所有 d20 +1", "+1 to every d20"],
  vampiric_blade: ["吸血之刃", "Vampiric blade", "命中时回复 2 生命", "heal 2 on hit"],
  traveler_boots: ["旅人靴", "Traveler's boots", "每里 25% 不耗口粮", "25% chance to save a ration each mile"],
  guardian_amulet: ["守护护符", "Guardian amulet", "AC +1", "AC +1"],
  hunter_horn: ["猎人号角", "Hunter's horn", "击败敌人金币 ×1.5", "×1.5 gold from foes"],
  alchemist_flask: ["炼金瓶", "Alchemist's flask", "药水效果 ×1.5", "potions heal ×1.5"],
  star_chart: ["星图", "Star chart", "预知下一里的事件类别", "see next mile's event type"],
  undying_ember: ["不灭余烬", "Undying ember", "致命伤时以 1 生命存活（用掉）", "survive a lethal blow once (consumed)"],
};
const RELIC_IDS = Object.keys(RELICS);
// 强化
const GEAR = {
  weapon: { name: ["武器", "Weapon"], max: 5, gold: 30, iron: 2, essAt: 3, desc: ["命中与伤害 +1", "+1 hit & damage"] },
  armor: { name: ["护甲", "Armor"], max: 5, gold: 30, iron: 2, essAt: 3, desc: ["AC +1", "AC +1"] },
  pack: { name: ["背包", "Pack"], max: 3, gold: 20, iron: 1, essAt: 99, desc: ["口粮上限 +4、药水上限 +1", "+4 ration cap, +1 potion cap"] },
  kit: { name: ["营具", "Camp kit"], max: 3, gold: 25, iron: 1, essAt: 99, desc: ["扎营回血更多、夜袭更少", "better camp healing, fewer ambushes"] },
};
const KIT_HEAL = [0.5, 0.65, 0.8, 1], KIT_AMBUSH = [20, 14, 8, 4];
const PRICE = { ration: 2, potion: 15, iron_sell: 4 };

// 画面模块（AI 只能在白名单里挑）
const FOE_SPRITES = ["wolf", "spider", "bandit", "skeleton", "troll", "drake", "ooze", "wisp", "warden"];
const KIND_SPRITES = {
  encounter: ["stranger", "bandit", "skeleton", "wisp"], discovery: ["chest", "rocks", "shrine"], hazard: ["chasm", "rocks", "thorns"],
  mystic: ["shrine", "wisp"], dilemma: ["stranger", "bandit"], trade: ["cart"], rest: ["campfire"], quest: ["stranger", "shrine", "chest", "cart"],
};
const TINTS = ["none", "red", "green", "blue", "gold", "shadow", "pale", "purple"];
const WEATHER = ["clear", "rain", "snow", "fog", "embers", "fireflies", "leaves"];
const BIOME_WEATHER = { plains: "clear", forest: "leaves", hills: "clear", swamp: "fog", mountains: "snow", ashlands: "embers" };
const SUBJECT_X = 176, HERO_X = 58, MILE_PX = 160;
const BOSS_EVERY = 25, BIOME_EVERY = 10;
const AI_WAIT = { unknown: 20000, yes: 30000, no: 1500 };

// ===== 内置事件模板（没有 AI，或 AI 太慢时用）=====
// 选项：{ label:[zh,en], verb, ability?, diff?, reward?, risk?, cost? }
const TEMPLATES = {
  encounter: [
    { title: ["路边的老兵", "An old soldier"], text: ["一位独臂老兵坐在里程碑上擦拭头盔，见你走来，眯起眼打量你的剑。", "A one-armed veteran polishes his helm on a milestone, eyeing your sword."], sprite: "stranger",
      options: [{ label: ["向他讨教剑术", "Ask for sword tips"], verb: "check", ability: "wis", diff: "normal", reward: "xp", risk: "none" },
        { label: ["分他一份口粮", "Share a ration"], verb: "pay", cost: "rations", reward: "iron" },
        { label: ["替他送一封信", "Deliver his letter"], verb: "quest" }] },
    { title: ["收过路费的人", "The toll keepers"], text: ["两个持棍的家伙拦在路中间：“过路费，十个金币，概不赊账。”", "Two men with clubs block the road. \"Toll. Pay up, no credit.\""], sprite: "bandit", foe: ["收费的恶棍", "Toll thugs"],
      options: [{ label: ["乖乖付钱", "Pay the toll"], verb: "pay", cost: "gold", reward: "none" },
        { label: ["吓唬他们", "Intimidate them"], verb: "check", ability: "cha", diff: "hard", reward: "gold", risk: "ambush" },
        { label: ["拔剑", "Draw your sword"], verb: "fight" }] },
  ],
  discovery: [
    { title: ["半埋的箱子", "A half-buried chest"], text: ["路旁的土里露出一角铁皮箱，锁孔里塞着泥。", "The corner of an iron chest pokes out of the dirt, its lock caked with mud."], sprite: "chest",
      options: [{ label: ["撬开锁", "Pick the lock"], verb: "check", ability: "dex", diff: "normal", reward: "gold", risk: "hurt" },
        { label: ["用蛮力砸开", "Smash it open"], verb: "check", ability: "str", diff: "easy", reward: "iron", risk: "hurt" }] },
    { title: ["倒塌的哨塔", "A collapsed watchtower"], text: ["一座哨塔斜倒在路边，上层的储物间似乎还完好。", "A watchtower leans by the road; its upper storeroom looks intact."], sprite: "rocks",
      options: [{ label: ["爬上去搜", "Climb up and search"], verb: "check", ability: "str", diff: "hard", reward: "relic", risk: "hurt" },
        { label: ["在瓦砾里翻找", "Dig through the rubble"], verb: "gamble", reward: "potion", risk: "hurt" }] },
  ],
  hazard: [
    { title: ["断裂的吊桥", "A broken rope bridge"], text: ["峡谷上的吊桥只剩一半木板，风一吹就晃。", "Half the planks of the gorge bridge are gone, and it sways in the wind."], sprite: "chasm",
      options: [{ label: ["小心走过去", "Edge across"], verb: "check", ability: "dex", diff: "normal", reward: "xp", risk: "hurt" },
        { label: ["绕远路", "Take the long way"], verb: "pay", cost: "rations", reward: "none" }] },
    { title: ["落石坡", "A rockslide slope"], text: ["山坡上不断有碎石滚落，路被埋了一半。", "Stones keep tumbling down the slope, half-burying the road."], sprite: "rocks",
      options: [{ label: ["顶着落石冲过去", "Dash through"], verb: "check", ability: "con", diff: "normal", reward: "none", risk: "hurt" },
        { label: ["清出一条路", "Clear a path"], verb: "check", ability: "str", diff: "hard", reward: "iron", risk: "exhaust" }] },
  ],
  mystic: [
    { title: ["古老的祭坛", "An ancient altar"], text: ["长满青苔的石门中央，一枚符文在缓缓发光。", "In a mossy stone arch, a rune glows slowly."], sprite: "shrine",
      options: [{ label: ["默念祷词", "Pray"], verb: "check", ability: "wis", diff: "normal", reward: "blessing", risk: "curse" },
        { label: ["献上金币", "Offer gold"], verb: "pay", cost: "gold", reward: "heal" },
        { label: ["撬下符文石", "Pry out the runestone"], verb: "gamble", reward: "essence", risk: "curse" }] },
    { title: ["会说话的鬼火", "A talking wisp"], text: ["一团鬼火绕着你转：“回答我的谜题，就给你看点好东西。”", "A wisp circles you: \"Answer my riddle and I'll show you something nice.\""], sprite: "wisp",
      options: [{ label: ["解谜", "Solve the riddle"], verb: "check", ability: "int", diff: "hard", reward: "relic", risk: "curse" },
        { label: ["让它带路", "Let it lead the way"], verb: "gamble", reward: "map", risk: "lost" }] },
  ],
  dilemma: [
    { title: ["受伤的商人", "A wounded merchant"], text: ["一个商人倒在翻倒的车旁，腿被压住了，远处还有狼嚎。", "A merchant lies pinned under his overturned cart; wolves howl nearby."], sprite: "stranger",
      options: [{ label: ["给他一瓶药水", "Give him a potion"], verb: "pay", cost: "potion", reward: "gold" },
        { label: ["抬起车子", "Lift the cart"], verb: "check", ability: "str", diff: "normal", reward: "rations", risk: "ambush" }] },
    { title: ["迷路的孩子", "A lost child"], text: ["一个孩子坐在路边哭，说她的村子在“很远很远的东边”。", "A child sobs by the road; her village is \"far, far to the east\"."], sprite: "stranger",
      options: [{ label: ["答应送她回家", "Promise to take her home"], verb: "quest" },
        { label: ["分她点吃的", "Share some food"], verb: "pay", cost: "rations", reward: "blessing" }] },
  ],
  quest: [
    { title: ["委托的终点", "The end of the errand"], text: ["你终于找到了委托里提到的地方。", "You finally reach the place the errand spoke of."], sprite: "stranger",
      options: [{ label: ["完成委托", "Complete the errand"], verb: "check", ability: "cha", diff: "normal", reward: "relic", risk: "none" },
        { label: ["讨要更多报酬", "Ask for more"], verb: "gamble", reward: "gold", risk: "ambush" }] },
  ],
  trade: [{ title: ["流浪行商", "A wandering peddler"], text: ["一辆挂着铜铃的马车停在路边，车上还架着一个小铁砧。", "A cart with brass bells waits by the road, a small anvil on its tailboard."], sprite: "cart" }],
  rest: [{ title: ["避风的岩洞", "A sheltered hollow"], text: ["一处干燥的岩洞，里面还留着别人的篝火灰。", "A dry hollow with the ashes of someone else's fire."], sprite: "campfire" }],
};

// ---------- 小工具 ----------
function L(api, zh, en) { return api.lang === "en" ? en : zh; }
function T2(api, v) { return Array.isArray(v) ? (api.lang === "en" ? v[1] : v[0]) : String(v == null ? "" : v); }
function get(api, k) { return api.state.get(k); }
function set(api, k, v) { api.state.set(k, v); }
function d(api, n, sides) { let s = 0; for (let i = 0; i < n; i++) s += api.random.int(1, sides); return s; }
function mod(score) { return Math.floor((score - 10) / 2); }
function sign(n) { return n >= 0 ? "+" + n : String(n); }
function prof(level) { return 2 + Math.floor((level - 1) / 4); }
function abil(api) { return get(api, "abil"); }
function abilMod(api, a) { return mod(abil(api)[a]); }
function atkMod(api) { const a = abil(api); return Math.max(mod(a.str), mod(a.dex)); }
function biomeName(api) { return T2(api, BIOMES[get(api, "biome")]); }
function threatNow(api) { const dd = get(api, "distance"); return 1 + Math.floor(dd / 8) + Math.floor(Math.pow(dd / 35, 2)); }
function has(api, relic) { return (get(api, "relics") || []).indexOf(relic) >= 0; }
function status(api) { return get(api, "status") || {}; }
function gear(api) { return get(api, "gear"); }
function caps(api) { const p = gear(api).pack; return { rations: 8 + 4 * p, potions: 3 + p }; }
function abilText(api) { const a = abil(api); return ABIL.map((k) => `${T2(api, ABIL_NAME[k])} ${a[k]}(${sign(mod(a[k]))})`).join(" · "); }
function clip(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }

// d20：叠加祝福、诅咒、幸运符
function d20(api) {
  const nat = api.random.int(1, 20), st = status(api);
  let bonus = 0; if (st.blessed) bonus += 2; if (st.cursed) bonus -= 2; if (has(api, "lucky_charm")) bonus += 1;
  return { nat, bonus };
}
function bonusText(b) { return b ? sign(b) : ""; }

function calcAc(api) {
  const g = gear(api); let ac = 12 + Math.min(2, abilMod(api, "dex")) + g.armor;
  if (has(api, "guardian_amulet")) ac += 1; if (status(api).exhausted) ac -= 2;
  return ac;
}
function heal(api, n) { const mx = get(api, "max_hp"), hp = get(api, "hp"); const v = Math.min(mx, hp + Math.max(0, Math.round(n))); set(api, "hp", v); return v - hp; }
function hurt(api, n) {
  const hp = Math.max(0, get(api, "hp") - n);
  if (hp <= 0 && has(api, "undying_ember")) {
    set(api, "hp", 1); set(api, "relics", get(api, "relics").filter((r) => r !== "undying_ember"));
    api.log(L(api, "🔥 不灭余烬燃尽了——你没有倒下，剩下 1 点生命。", "🔥 The undying ember burns out — you stay standing with 1 HP."));
    return;
  }
  set(api, "hp", hp);
}
function addStatus(api, k, miles) { const st = status(api); st[k] = Math.max(st[k] || 0, miles); set(api, "status", st); }
// 加资源（受携带上限限制）
function gain(api, k, n) {
  if (n <= 0) return 0;
  const c = caps(api);
  if (k === "rations" || k === "potions") {
    const cur = get(api, k), v = Math.min(c[k], cur + n), lost = cur + n - v;
    set(api, k, v);
    if (lost > 0) api.log(L(api, `🎒 背包装不下，丢掉了 ${lost} ${k === "rations" ? "份口粮" : "瓶药水"}。`, `🎒 Your pack is full — ${lost} ${k} left behind.`));
    return v - cur;
  }
  api.state.inc(k, n); return n;
}

// ---------- 画面状态（scripts/scene.js 负责画） ----------
function sfx(api) { return get(api, "scene_fx"); }
function saveFx(api, s) { s.busy = true; set(api, "scene_fx", s); }
function pop(api, text, color, onFoe) {
  const s = sfx(api); const x = onFoe && s.cur ? s.cur.wx - s.scroll : HERO_X;
  s.fx = (s.fx || []).slice(-5); s.fx.push({ text: String(text), color, x: x + api.random.int(-4, 4), y: 84, life: 900 }); saveFx(api, s);
}
function anim(api, key, ms) { const s = sfx(api); s[key] = ms; saveFx(api, s); }
function reveal(api) { const s = sfx(api); if (s.cur && s.cur.pending) { s.cur.pending = false; saveFx(api, s); } }
function setSubject(api, sub) { const s = sfx(api); if (s.cur) s.prev = s.cur; s.cur = sub; saveFx(api, s); }
function dropSubject(api, dying) {
  const s = sfx(api); if (!s.cur) return;
  if (dying) s.dying = { sprite: s.cur.sprite, scale: s.cur.scale, wx: s.cur.wx, t: 600 }; else s.prev = s.cur;
  s.cur = null; saveFx(api, s);
}

// ===== 事件卡 =====
function rollKind(api) {
  const w = Object.assign({}, BASE_WEIGHT); const adj = BIOME_WEIGHT[get(api, "biome")] || {};
  for (const k in adj) w[k] = Math.max(1, (w[k] || 0) + adj[k]);
  let k = api.random.weighted(w);
  if (status(api).scouted && k === "combat") k = api.random.weighted(w);
  return k;
}
function foeFor(api, name, boss, threat) {
  const t = threat;
  const f = { name, hp: 3 + 4 * t + api.random.int(0, t), max_hp: 0, ac: Math.min(19, 10 + Math.floor((t + 1) / 2)), atk: 1 + Math.floor(t * 0.6),
    dice: 1 + Math.floor(t / 8), sides: t >= 6 ? 10 : t >= 4 ? 8 : t >= 2 ? 6 : 4, bonus: Math.floor(t / 2), threat: t, boss: !!boss };
  if (boss) { f.hp = Math.round(f.hp * 1.3); f.bonus += 1; }
  f.max_hp = f.hp; return f;
}
function defaultFoe(api) { return api.random.pick(FOES[get(api, "biome")]); }

// 把一个选项草稿变成规则认可的选项：校验动作、算 DC、算收获/风险/代价的确切数值
function finalizeOption(api, o, kind, idx, card) {
  const T = card.threat;
  const allowed = VERBS[kind] || [];
  if (allowed.indexOf(o.verb) < 0) return null;
  const opt = { id: `o${idx}`, label: o.label, verb: o.verb };
  if (o.verb === "fight") return opt;
  if (o.verb === "quest") {
    if (get(api, "quest") && get(api, "quest").due) return null; // 同时只能接一个委托
    return opt;
  }
  let rsize = "medium", ksize = "medium";
  if (o.verb === "check") {
    opt.ability = ABIL.indexOf(o.ability) >= 0 ? o.ability : "wis";
    opt.diff = DIFFS.indexOf(o.diff) >= 0 ? o.diff : "normal";
    opt.dc = Math.min(25, 11 + Math.floor(T / 2) + { easy: -3, normal: 0, hard: 3 }[opt.diff]);
    rsize = { easy: "small", normal: "medium", hard: "large" }[opt.diff];
    ksize = opt.diff === "easy" ? "small" : "medium";
  } else if (o.verb === "pay") {
    opt.cost = COSTS.indexOf(o.cost) >= 0 ? o.cost : "gold";
    opt.camt = costAmount(api, opt.cost, T);
    rsize = "large";
  } else if (o.verb === "gamble") { rsize = "large"; ksize = "large"; opt.chance = 50; }
  if (kind === "quest") rsize = rsize === "large" ? "huge" : "large";
  // 收获
  let rw = REWARDS.indexOf(o.reward) >= 0 ? o.reward : "none";
  const relicOk = (o.verb === "check" && opt.diff === "hard") || kind === "quest";
  if (rw === "relic" && !relicOk) rw = rsize === "large" || rsize === "huge" ? "essence" : "iron";
  if (rw === "relic" && get(api, "relics").length >= 3) rw = "essence";
  if (rw === "essence" && rsize !== "large" && rsize !== "huge") rw = "iron";
  if (kind === "combat" && o.verb !== "fight") { rsize = "small"; if (rw === "relic" || rw === "essence") rw = "gold"; }
  opt.reward = rw; opt.ramt = rewardAmount(api, rw, rsize, T);
  if (rw === "relic") opt.relic = RELIC_IDS.indexOf(o.relic) >= 0 && !has(api, o.relic) ? o.relic : null;
  // 风险（付出代价没有风险；战斗类的检定失败一律是被袭击）
  if (o.verb !== "pay") {
    let rk = RISKS.indexOf(o.risk) >= 0 ? o.risk : "hurt";
    if (kind === "combat") rk = "ambush";
    opt.risk = rk; opt.kamt = riskAmount(api, rk, ksize, T);
  }
  return opt;
}
function costAmount(api, c, T) {
  return { gold: 8 + 3 * T, rations: 2, potion: 1, hp: Math.max(2, Math.round(get(api, "max_hp") * 0.25)), iron: 2, essence: 1 }[c];
}
function rewardAmount(api, r, size, T) {
  const k = SIZE[size];
  switch (r) {
    case "gold": return Math.round((6 + 3 * T) * k);
    case "rations": return Math.max(1, Math.round((2 + T / 4) * k));
    case "potion": return k >= 1.7 ? 2 : 1;
    case "heal": return Math.max(3, Math.round(get(api, "max_hp") * 0.35 * k));
    case "iron": return Math.max(1, Math.round((1 + T / 4) * k));
    case "essence": return k >= 2.4 ? 2 : 1;
    case "xp": return Math.round(12 * T * k);
    case "blessing": return Math.max(2, Math.round(3 * k));
    case "map": return 1;
    default: return 0;
  }
}
function riskAmount(api, r, size, T) {
  const k = { small: 0.6, medium: 1, large: 1.5 }[size] || 1;
  switch (r) {
    case "hurt": return Math.max(1, Math.round((1 + Math.floor(T / 3)) * 3.5 * k));
    case "lose_gold": return Math.round((5 + 2 * T) * k);
    case "lose_rations": return Math.max(1, Math.round(1.5 * k));
    case "curse": case "poison": return Math.max(2, Math.round(3 * k));
    default: return 0;
  }
}
function canAfford(api, o) {
  if (o.verb !== "pay") return true;
  const have = { gold: get(api, "gold"), rations: get(api, "rations"), potion: get(api, "potions"), hp: get(api, "hp") - 1, iron: get(api, "iron"), essence: get(api, "essence") }[o.cost];
  return have >= o.camt;
}
function amtText(api, r, n, relic) {
  if (r === "none") return T2(api, R_NAME.none);
  if (r === "relic") return relic ? T2(api, RELICS[relic]) : L(api, "随机遗物", "a random relic");
  if (r === "blessing" || r === "curse" || r === "poison") return `${T2(api, R_NAME[r])} ${n}${L(api, " 里", " mi")}`;
  if (r === "map" || r === "ambush" || r === "lost" || r === "exhaust") return T2(api, R_NAME[r]);
  return `${T2(api, R_NAME[r])} ${r.indexOf("lose") === 0 || r === "hurt" ? "-" : "+"}${n}`;
}
function optText(api, o, kind) {
  if (o.verb === "fight") return L(api, "⚔ 进入战斗", "⚔ Start a fight");
  if (o.verb === "leave") return o.note || "";
  if (o.verb === "quest") return L(api, "📜 接受委托：几里路后回来领取丰厚报酬", "📜 Accept: return in a few miles for a big reward");
  if (o.verb === "camp") return o.note || "";
  if (o.verb === "potion") return o.note || "";
  const win = o.reward === "none" ? (kind === "combat" ? L(api, "避开战斗", "avoid the fight") : L(api, "安全通过", "get through safely")) : amtText(api, o.reward, o.ramt, o.relic) + (kind === "combat" ? L(api, "，并避开战斗", " & avoid the fight") : "");
  if (o.verb === "pay") return `${L(api, "付出", "Pay")} ${T2(api, R_NAME[o.cost === "potion" ? "potion" : o.cost])} ${o.camt} → ${win}`;
  const lose = amtText(api, o.risk, o.kamt);
  if (o.verb === "gamble") return `🎲 ${L(api, "五五开", "50/50")} · ${L(api, "成", "win")}：${win} · ${L(api, "败", "lose")}：${lose}`;
  return `🎲 ${T2(api, ABIL_NAME[o.ability])} DC ${o.dc} · ${L(api, "成", "pass")}：${win} · ${L(api, "败", "fail")}：${lose}`;
}

// 生成一张事件卡（先是“正在描绘”的空卡，等 AI；超时就用模板）
function spawn(api, kind, tier, boss) {
  const threat = Math.max(1, threatNow(api) + tier);
  set(api, "event_kind", kind);
  set(api, "threat", threat);
  set(api, "event_tier", boss ? "boss" : ["weak", "normal", "tough", "elite"][tier + 1] || "normal");
  const s = sfx(api); const wx = Math.max(s.target, s.scroll) + SUBJECT_X;
  const seq = (get(api, "card") || {}).seq + 1 || 1;
  const card = { seq, kind, threat, boss: !!boss, pending: true, born: api.time, title: "", text: "", options: [], foe: "" };
  if (kind === "combat") {
    const pick = boss ? null : defaultFoe(api);
    card.foe = boss ? L(api, `${biomeName(api)}的守关者`, `Warden of the ${biomeName(api)}`) : T2(api, pick);
    card.title = card.foe;
    setSubject(api, { sprite: boss ? "warden" : pick[2], tint: boss ? "none" : pick[3], scale: boss ? 2 : 1, boss: !!boss, wx, pending: true });
  } else {
    setSubject(api, { sprite: api.random.pick(KIND_SPRITES[kind]), tint: "none", scale: 1, wx, pending: true });
  }
  set(api, "card", card);
  set(api, "phase", "card");
  api.log(`${KIND_ICON[kind]} ${T2(api, KIND_NAME[kind])}${boss ? L(api, "：守关者挡住了去路", ": a warden blocks the road") : ""}（${L(api, "威胁", "threat")} ${threat}）`);
}

// 用模板（或 AI 的草稿）填好卡片
function fillCard(api, draft, fromAi) {
  const card = get(api, "card"); const kind = card.kind;
  card.title = clip(T2(api, draft.title), 30) || card.title || T2(api, KIND_NAME[kind]);
  card.text = clip(T2(api, draft.text), 360);
  if (draft.foe) card.foe = clip(T2(api, draft.foe), 30);
  const opts = [];
  if (kind === "trade" || kind === "rest") { /* 交易、休憩不需要选项 */ }
  else if (card.boss) opts.push({ id: "o1", label: L(api, "迎战", "Face the warden"), verb: "fight" });
  else {
    (draft.options || []).slice(0, 3).forEach((o, i) => { const f = finalizeOption(api, Object.assign({}, o, { label: clip(T2(api, o.label), 40) || L(api, "试试看", "Try it") }), kind, i + 1, card); if (f) opts.push(f); });
    if (kind === "combat" && !opts.some((o) => o.verb === "fight")) opts.unshift({ id: "o0", label: L(api, "动手", "Fight"), verb: "fight" });
    if (!opts.length || (kind === "combat" && opts.length < 2)) {
      // AI 没给出能用的选项：标题和描述用 AI 的，选项借用内置模板
      const tpl = kind === "combat" ? combatTemplate(api, card) : TEMPLATES[kind] ? api.random.pick(TEMPLATES[kind]) : null;
      if (tpl) tpl.options.forEach((o, i) => { if (opts.some((x) => x.verb === "fight") && o.verb === "fight") return; const f = finalizeOption(api, Object.assign({}, o, { label: T2(api, o.label) }), kind, i + 4, card); if (f) opts.push(f); });
    }
  }
  card.options = opts;
  card.pending = false; card.ai = !!fromAi;
  if (draft.sprite && (KIND_SPRITES[kind] || []).indexOf(draft.sprite) >= 0) { const s = sfx(api); if (s.cur) { s.cur.sprite = draft.sprite; saveFx(api, s); } }
  set(api, "card", card);
  reveal(api);
  if (card.text) api.log(`📖 ${card.title}：${card.text}`);
  if (kind === "trade") set(api, "phase", "shop");
  if (kind === "combat" && card.boss) { /* 守关者卡片只有迎战 */ }
}
function combatTemplate(api, card) {
  return {
    title: card.foe, foe: card.foe,
    text: L(api, `${card.foe}挡在路上，还没发现你。`, `${card.foe} blocks the road and hasn't noticed you yet.`),
    options: [{ label: ["动手", "Fight"], verb: "fight" }, { label: ["悄悄绕过去", "Sneak past"], verb: "check", ability: "dex", diff: "normal", reward: "xp", risk: "ambush" },
      { label: ["丢下金币引开它", "Toss gold as a distraction"], verb: "pay", cost: "gold", reward: "none" }],
  };
}
function useTemplate(api) {
  const card = get(api, "card"); if (!card || !card.pending) return;
  if (card.kind === "combat") fillCard(api, combatTemplate(api, card), false);
  else if (card.kind === "quest") { const q = get(api, "quest") || {}; const t = api.random.pick(TEMPLATES.quest); fillCard(api, Object.assign({}, t, { title: q.title || t.title }), false); }
  else fillCard(api, api.random.pick(TEMPLATES[card.kind]), false);
}

function startBattle(api, name, free) {
  const card = get(api, "card");
  const f = foeFor(api, name || card.foe || T2(api, defaultFoe(api)), card.boss, card.threat);
  set(api, "foe", f); set(api, "event_kind", "combat"); set(api, "phase", "battle");
  reveal(api);
  api.log(`⚔ ${L(api, "战斗开始", "Battle")}：${f.name}（${L(api, "生命", "HP")} ${f.hp} · AC ${f.ac}）`);
  if (free) enemyTurn(api);
}
function endEvent(api, dying) {
  dropSubject(api, !!dying);
  set(api, "phase", "none"); set(api, "event_kind", "none"); set(api, "event_title", "");
}

// 结算收获 / 风险
function applyReward(api, o) {
  const r = o.reward, n = o.ramt;
  switch (r) {
    case "gold": return L(api, `获得 ${gain(api, "gold", n)} 金币`, `gained ${gain(api, "gold", n)} gold`);
    case "rations": return L(api, `获得 ${gain(api, "rations", n)} 份口粮`, `gained ${gain(api, "rations", n)} rations`);
    case "potion": return L(api, `获得 ${gain(api, "potions", n)} 瓶药水`, `gained ${gain(api, "potions", n)} potion(s)`);
    case "heal": return L(api, `恢复 ${heal(api, n)} 生命`, `recovered ${heal(api, n)} HP`);
    case "iron": gain(api, "iron", n); return L(api, `获得 ${n} 铁料`, `gained ${n} iron`);
    case "essence": gain(api, "essence", n); return L(api, `获得 ${n} 魔晶`, `gained ${n} essence`);
    case "xp": gainXp(api, n); return L(api, `获得 ${n} 经验`, `gained ${n} XP`);
    case "blessing": addStatus(api, "blessed", n); return L(api, `受到祝福（${n} 里）`, `blessed for ${n} miles`);
    case "map": addStatus(api, "scouted", 2); return L(api, "摸清了前面的路（接下来两里更容易避开战斗）", "scouted the road ahead (easier to avoid fights for 2 miles)");
    case "relic": return giveRelic(api, o.relic);
    default: return L(api, "平安无事", "nothing more");
  }
}
function applyRisk(api, o) {
  const r = o.risk, n = o.kamt;
  switch (r) {
    case "hurt": hurt(api, n); anim(api, "hhurt", 400); pop(api, `-${n}`, "#ff5a4a", false); return L(api, `受伤，失去 ${n} 生命`, `hurt for ${n} HP`);
    case "lose_gold": { const g = Math.min(get(api, "gold"), n); api.state.inc("gold", -g); return L(api, `丢了 ${g} 金币`, `lost ${g} gold`); }
    case "lose_rations": { const g = Math.min(get(api, "rations"), n); api.state.inc("rations", -g); return L(api, `丢了 ${g} 份口粮`, `lost ${g} rations`); }
    case "curse": addStatus(api, "cursed", n); return L(api, `被诅咒了（${n} 里）`, `cursed for ${n} miles`);
    case "poison": addStatus(api, "poisoned", n); return L(api, `中毒了（${n} 里）`, `poisoned for ${n} miles`);
    case "exhaust": addStatus(api, "exhausted", 99); return L(api, "累坏了（AC -2，直到扎营）", "exhausted (AC -2 until you camp)");
    case "lost": { if (get(api, "rations") > 0) api.state.inc("rations", -1); else hurt(api, 2); return L(api, "迷了路，多耗了 1 份口粮", "got lost and spent an extra ration"); }
    case "ambush": return "ambush";
    default: return L(api, "没出什么事", "nothing bad happened");
  }
}
function giveRelic(api, want) {
  const owned = get(api, "relics") || [];
  if (owned.length >= 3) { gain(api, "essence", 2); return L(api, "遗物袋满了，把它化成了 2 魔晶", "relic bag full — melted it into 2 essence"); }
  const pool = RELIC_IDS.filter((r) => owned.indexOf(r) < 0);
  const id = want && pool.indexOf(want) >= 0 ? want : api.random.pick(pool);
  set(api, "relics", owned.concat([id]));
  return L(api, `获得遗物【${RELICS[id][0]}】：${RELICS[id][2]}`, `gained relic [${RELICS[id][1]}]: ${RELICS[id][3]}`);
}

function chooseOption(api, id) {
  const card = get(api, "card"); if (!card || get(api, "phase") !== "card" || card.pending) return;
  if (id === "potion") { potion(api); return; }
  if (id === "camp") { campHere(api, true); return; }
  if (id === "leave") return leaveCard(api);
  const o = card.options.filter((x) => x.id === id)[0]; if (!o) return;
  if (!canAfford(api, o)) { api.log(L(api, "付不起这个代价。", "You can't afford that.")); return; }
  api.log(`➤ ${o.label}`);
  if (o.verb === "fight") { startBattle(api, card.foe, false); return; }
  if (o.verb === "quest") {
    const due = get(api, "distance") + api.random.int(4, 8);
    set(api, "quest", { title: card.title, due });
    api.log(L(api, `📜 接下委托「${card.title}」——第 ${due} 里左右回来领赏。`, `📜 Accepted "${card.title}" — come back around mile ${due}.`));
    endEvent(api); return;
  }
  let ok;
  if (o.verb === "pay") {
    const c = o.cost === "potion" ? "potions" : o.cost;
    if (c === "hp") hurt(api, o.camt); else api.state.inc(c, -o.camt);
    ok = true;
  } else if (o.verb === "gamble") {
    const r = api.random.int(1, 100); ok = r <= o.chance;
    api.log(`🎲 ${L(api, "赌运气", "Gamble")}：${r} ${ok ? L(api, "→ 成功", "→ win") : L(api, "→ 失败", "→ lose")}`);
  } else {
    const r = d20(api); const m = abilMod(api, o.ability) + prof(get(api, "level"));
    const total = r.nat + m + r.bonus;
    ok = r.nat === 20 || (r.nat !== 1 && total >= o.dc);
    api.log(`🎲 ${T2(api, ABIL_NAME[o.ability])} ${L(api, "检定", "check")}：d20=${r.nat} ${sign(m)}${bonusText(r.bonus)} = ${total} ${L(api, "对", "vs")} DC ${o.dc} → ${ok ? L(api, "成功", "success") : L(api, "失败", "failure")}`);
    pop(api, ok ? L(api, "成功", "pass") : L(api, "失败", "fail"), ok ? "#9aff8a" : "#ff8a7a", false);
  }
  if (ok) {
    const msg = applyReward(api, o);
    api.log(`✔ ${msg}${card.kind === "combat" ? L(api, "，避开了战斗", ", and avoided the fight") : ""}。`);
    if (card.kind === "quest") set(api, "quest", {});
    endEvent(api);
  } else {
    const msg = applyRisk(api, o);
    if (msg === "ambush") { api.log(L(api, "✘ 被发现了！", "✘ You're spotted!")); startBattle(api, card.foe, true); return; }
    api.log(`✘ ${msg}。`);
    if (card.kind === "quest") set(api, "quest", {});
    endEvent(api);
  }
}
function leaveCard(api) {
  const card = get(api, "card");
  if (card.kind === "hazard") {
    if (get(api, "rations") > 0) { api.state.inc("rations", -1); api.log(L(api, "你绕了远路，多吃掉 1 份口粮。", "You take the long way around, eating 1 extra ration.")); }
    else { hurt(api, 2); api.log(L(api, "你饿着肚子绕了远路，失去 2 生命。", "You detour on an empty stomach and lose 2 HP.")); }
  } else if (card.kind === "combat" && !card.boss) {
    // 想溜走：敏捷检定，失败就被追上
    const r = d20(api), m = abilMod(api, "dex") + prof(get(api, "level")), dc = 10 + Math.floor(card.threat / 2), total = r.nat + m + r.bonus;
    if (!(r.nat === 20 || (r.nat !== 1 && total >= dc))) { api.log(L(api, `🏃 想溜走（${total} 对 DC ${dc}）——被追上了！`, `🏃 You try to slip away (${total} vs DC ${dc}) — caught!`)); startBattle(api, card.foe, true); return; }
    api.log(L(api, `🏃 你悄悄退开，换了条小路（${total} 对 DC ${dc}）。`, `🏃 You back off quietly and take a side path (${total} vs DC ${dc}).`));
  } else if (card.kind === "quest") {
    api.log(L(api, "你放弃了这个委托。", "You abandon the errand.")); set(api, "quest", {});
  } else api.log(L(api, "你没有停留，继续上路。", "You don't linger, and move on."));
  endEvent(api);
}

// ===== 战斗 =====
function enemyTurn(api) {
  const f = get(api, "foe"); reveal(api);
  const roll = api.random.int(1, 20), total = roll + f.atk, ac = calcAc(api);
  if (roll === 1 || (roll !== 20 && total < ac)) {
    pop(api, L(api, "闪开", "dodge"), "#c8d8ff", false);
    api.log(L(api, `🛡 ${f.name}攻击落空（d20=${roll}，${total} 对 AC ${ac}）`, `🛡 ${f.name} misses (d20=${roll}, ${total} vs AC ${ac})`));
    return;
  }
  const dmg = d(api, roll === 20 ? f.dice * 2 : f.dice, f.sides) + f.bonus;
  hurt(api, dmg); anim(api, "hhurt", 400);
  pop(api, `-${dmg}`, roll === 20 ? "#ffdd44" : "#ff5a4a", false);
  api.log(L(api, `🩸 ${f.name}${roll === 20 ? "暴击！" : "击中了你"}（d20=${roll}），造成 ${dmg} 点伤害。`, `🩸 ${f.name} ${roll === 20 ? "lands a CRITICAL hit" : "hits you"} (d20=${roll}) for ${dmg} damage.`));
}
function victory(api, f) {
  const xp = 20 * f.threat * (f.boss ? 3 : 1);
  const gold = Math.round((api.random.int(1, 6) + 2 * f.threat) * (has(api, "hunter_horn") ? 1.5 : 1));
  gain(api, "gold", gold); api.state.inc("kills", 1);
  const parts = [L(api, `${xp} 经验`, `${xp} XP`), L(api, `${gold} 金币`, `${gold} gold`)];
  const beast = ["wolf", "drake", "spider"].indexOf((sfx(api).cur || {}).sprite) >= 0;
  if (beast || api.random.int(1, 100) <= 50) { const n = gain(api, "rations", beast ? 2 : 1); if (n) parts.push(L(api, `${n} 份口粮`, `${n} ration(s)`)); }
  if (api.random.int(1, 100) <= 50) { const n = 1 + Math.floor(f.threat / 5); gain(api, "iron", n); parts.push(L(api, `${n} 铁料`, `${n} iron`)); }
  if (f.boss) { gain(api, "essence", 2); gain(api, "potions", 1); parts.push(L(api, "2 魔晶、1 瓶药水", "2 essence, 1 potion")); parts.push(giveRelic(api, null)); }
  api.log(L(api, `🏆 你击败了${f.name}！${parts.join("、")}。`, `🏆 You defeated ${f.name}! ${parts.join(", ")}.`));
  endEvent(api, true);
  gainXp(api, xp);
}
function gainXp(api, n) {
  api.state.inc("xp", n);
  while (get(api, "xp") >= get(api, "xp_next")) {
    api.state.inc("xp", -get(api, "xp_next"));
    const lv = get(api, "level") + 1;
    set(api, "level", lv); set(api, "xp_next", 60 * lv);
    const g = Math.max(1, d(api, 1, 10) + abilMod(api, "con"));
    api.state.inc("max_hp", g); heal(api, g);
    let extra = "";
    if (lv % 4 === 0) { const a = abil(api); const k = a.str >= a.dex ? "str" : "dex"; a[k] = Math.min(20, a[k] + 2); set(api, "abil", a); extra = L(api, `，${ABIL_NAME[k][0]} +2`, `, ${ABIL_NAME[k][1]} +2`); }
    if (lv === 5) extra += L(api, "，学会了额外攻击（每回合攻击两次）", ", and gained Extra Attack");
    api.log(L(api, `⭐ 升到 ${lv} 级！最大生命 +${g}${extra}。`, `⭐ Level ${lv}! Max HP +${g}${extra}.`));
  }
}

// ===== 面板与界面层 =====
function refresh(api) {
  set(api, "ac", calcAc(api));
  const c = caps(api), g = gear(api), st = status(api);
  set(api, "pack_text", L(api,
    `口粮 ${get(api, "rations")}/${c.rations} · 药水 ${get(api, "potions")}/${c.potions} · 金币 ${get(api, "gold")}\n铁料 ${get(api, "iron")} · 魔晶 ${get(api, "essence")}`,
    `Rations ${get(api, "rations")}/${c.rations} · Potions ${get(api, "potions")}/${c.potions} · Gold ${get(api, "gold")}\nIron ${get(api, "iron")} · Essence ${get(api, "essence")}`));
  set(api, "gear_text", Object.keys(GEAR).map((k) => `${T2(api, GEAR[k].name)} ${k === "weapon" || k === "armor" ? "+" : "Lv"}${g[k]}`).join(" · "));
  const rel = get(api, "relics") || [];
  set(api, "relic_text", rel.length ? rel.map((r) => `${T2(api, RELICS[r])}：${L(api, RELICS[r][2], RELICS[r][3])}`).join("\n") : L(api, "（还没有）", "(none yet)"));
  const sts = Object.keys(st).filter((k) => st[k] > 0).map((k) => `${L(api, STATUS[k][0], STATUS[k][1])}${k === "exhausted" ? "" : ` ${st[k]}${L(api, "里", "mi")}`}（${STATUS[k][2]}）`);
  const q = get(api, "quest");
  if (q && q.due) sts.push(L(api, `📜 委托「${q.title}」：第 ${q.due} 里`, `📜 Errand "${q.title}": mile ${q.due}`));
  if (has(api, "star_chart") && get(api, "next_kind")) sts.push(L(api, `🗺 下一里：${KIND_NAME[get(api, "next_kind")][0]}`, `🗺 Next mile: ${KIND_NAME[get(api, "next_kind")][1]}`));
  set(api, "status_text", sts.length ? sts.join("\n") : L(api, "（无）", "(none)"));
  const ph = get(api, "phase"), card = get(api, "card") || {};
  let s;
  if (ph === "battle") { const f = get(api, "foe"); s = `⚔ ${f.name}${f.boss ? L(api, "（守关者）", " (Warden)") : ""}\n${L(api, "生命", "HP")} ${f.hp}/${f.max_hp} · AC ${f.ac} · ${L(api, "命中", "to hit")} ${sign(f.atk)}`; }
  else if (ph === "card" || ph === "shop") s = `${KIND_ICON[card.kind]} ${card.pending ? L(api, "前方有动静……", "Something ahead…") : card.title}`;
  else s = L(api, `前路漫漫。你身在${biomeName(api)}，第 ${get(api, "distance")} 里。`, `The road goes on. You are in the ${biomeName(api)}, mile ${get(api, "distance")}.`);
  set(api, "situation", s);
  set(api, "event_title", ph === "none" ? "" : card.title || "");
  showUi(api);
}
const PANEL = { color: "#efe6d6", bg: "#1b1611f0", padding: 14, radius: 12, width: "min(640px, 96vw)", border: 1, border_color: "#e0a84a66", gap: 8 };
function showUi(api) {
  const ph = get(api, "phase"), card = get(api, "card") || {};
  if (get(api, "hp") <= 0 || (ph !== "card" && ph !== "shop")) { api.overlay.hide(); return; }
  const head = { type: "rich", spans: [{ text: `${KIND_ICON[card.kind]} ${T2(api, KIND_NAME[card.kind])} · `, style: { color: "#c8b89a", size: 13 } }, { text: card.pending ? L(api, "前方有动静……", "Something ahead…") : card.title, style: { bold: true, color: "#e0a84a", size: 17 } }] };
  if (card.pending) {
    api.overlay.hide("shop");
    api.overlay.show("card", { anchor: "bottom", z: 1, style: PANEL, children: [head,
      { type: "text", text: L(api, "（AI 正在描绘这一幕……）", "(The AI is painting this scene…)"), style: { color: "#c8b89a", size: 14 } },
      { type: "row", children: [{ type: "space" }, { type: "button", id: "skip", text: L(api, "不等了，直接开始", "Don't wait") }] }] });
    return;
  }
  if (ph === "shop") { api.overlay.hide("card"); showShop(api, head, card); return; }
  api.overlay.hide("shop");
  const items = card.options.map((o) => ({ id: o.id, text: o.label, sub: optText(api, o, card.kind) + (canAfford(api, o) ? "" : L(api, "（付不起）", " (can't afford)")), disabled: !canAfford(api, o) }));
  if (card.kind === "rest") items.push({ id: "camp", text: L(api, "🔥 扎营休息", "🔥 Make camp"), sub: L(api, "免费，完全恢复，解除疲惫", "free, full heal, clears exhaustion") });
  if (get(api, "potions") > 0 && get(api, "hp") < get(api, "max_hp")) items.push({ id: "potion", text: L(api, "🧪 先喝一瓶药水", "🧪 Drink a potion first"), sub: L(api, "不结束这个事件", "doesn't end the event") });
  if (!card.boss) items.push({ id: "leave", text: L(api, "↩ 离开", "↩ Leave"), sub: card.kind === "hazard" ? L(api, "绕路：多耗 1 份口粮", "detour: costs 1 extra ration") : card.kind === "combat" ? L(api, `🎲 敏捷 DC ${10 + Math.floor(card.threat / 2)} 溜走，失败会被追上`, `🎲 DEX DC ${10 + Math.floor(card.threat / 2)} to slip away; fail and it attacks`) : "" });
  api.overlay.show("card", { anchor: "bottom", z: 1, style: PANEL, children: [head, { type: "text", text: card.text, style: { color: "#efe6d6", size: 14 } }, { type: "list", id: "opts", items }] });
}
function gearCost(api, k) {
  const g = gear(api), lv = g[k], def = GEAR[k];
  return { gold: def.gold * (lv + 1), iron: def.iron * (lv + 1), essence: lv >= def.essAt ? 1 : 0, max: lv >= def.max };
}
function showShop(api, head, card) {
  const gold = get(api, "gold"), c = caps(api);
  const items = [
    { id: "buy_ration", text: L(api, `口粮 ×1`, "Ration ×1"), sub: `${PRICE.ration}g · ${get(api, "rations")}/${c.rations}`, disabled: gold < PRICE.ration || get(api, "rations") >= c.rations },
    { id: "buy_potion", text: L(api, `治疗药水 ×1`, "Healing potion ×1"), sub: `${PRICE.potion}g · ${get(api, "potions")}/${c.potions}`, disabled: gold < PRICE.potion || get(api, "potions") >= c.potions },
    { id: "sell_iron", text: L(api, "卖出铁料 ×1", "Sell iron ×1"), sub: `+${PRICE.iron_sell}g · ${L(api, "剩", "have")} ${get(api, "iron")}`, disabled: get(api, "iron") < 1 },
  ];
  for (const k of Object.keys(GEAR)) {
    const cost = gearCost(api, k), lv = gear(api)[k];
    const okay = !cost.max && gold >= cost.gold && get(api, "iron") >= cost.iron && get(api, "essence") >= cost.essence;
    items.push({ id: `up_${k}`, text: `⚒ ${T2(api, GEAR[k].name)} ${k === "weapon" || k === "armor" ? "+" : "Lv"}${lv} → ${cost.max ? L(api, "已满", "max") : lv + 1}`,
      sub: cost.max ? "" : `${cost.gold}g · ${L(api, "铁料", "iron")} ${cost.iron}${cost.essence ? ` · ${L(api, "魔晶", "essence")} ${cost.essence}` : ""} · ${T2(api, GEAR[k].desc)}`, disabled: !okay });
  }
  items.push({ id: "leave", text: L(api, "↩ 告别行商", "↩ Say goodbye"), sub: "" });
  api.overlay.show("shop", { anchor: "bottom", z: 1, style: PANEL, children: [head, { type: "text", text: card.text, style: { color: "#efe6d6", size: 14 } }, { type: "list", id: "shop", items }] });
}
function shopBuy(api, id) {
  const gold = get(api, "gold"), c = caps(api);
  if (id === "leave") { api.log(L(api, "你向行商道别。", "You bid the peddler farewell.")); endEvent(api); return; }
  if (id === "buy_ration" && gold >= PRICE.ration && get(api, "rations") < c.rations) { api.state.inc("gold", -PRICE.ration); gain(api, "rations", 1); }
  else if (id === "buy_potion" && gold >= PRICE.potion && get(api, "potions") < c.potions) { api.state.inc("gold", -PRICE.potion); gain(api, "potions", 1); }
  else if (id === "sell_iron" && get(api, "iron") > 0) { api.state.inc("iron", -1); api.state.inc("gold", PRICE.iron_sell); }
  else if (id.indexOf("up_") === 0) {
    const k = id.slice(3); if (!GEAR[k]) return;
    const cost = gearCost(api, k);
    if (cost.max || gold < cost.gold || get(api, "iron") < cost.iron || get(api, "essence") < cost.essence) return;
    api.state.inc("gold", -cost.gold); api.state.inc("iron", -cost.iron); api.state.inc("essence", -cost.essence);
    const g = gear(api); g[k] += 1; set(api, "gear", g);
    api.log(L(api, `⚒ ${GEAR[k].name[0]}强化到 ${g[k]} 级：${GEAR[k].desc[0]}。`, `⚒ ${GEAR[k].name[1]} upgraded to ${g[k]}: ${GEAR[k].desc[1]}.`));
    pop(api, "⚒", "#ffd890", false);
  }
}

// ===== 导出：动作与回调 =====
export function setup(api) {
  const a = {};
  for (const k of ABIL) { const r = [d(api, 1, 6), d(api, 1, 6), d(api, 1, 6), d(api, 1, 6)].sort((x, y) => x - y); a[k] = r[1] + r[2] + r[3]; }
  if (Math.max(a.str, a.dex) < 14) { if (a.str >= a.dex) a.str = 14; else a.dex = 14; }
  if (a.con < 10) a.con = 10;
  set(api, "abil", a); set(api, "abilities", abilText(api));
  const hp = 14 + mod(a.con);
  set(api, "max_hp", hp); set(api, "hp", hp);
  set(api, "biome", "plains");
  set(api, "scene_fx", { scroll: 0, target: 0, prev: null, cur: null, fx: [], busy: false });
  set(api, "art", { time: "day", weather: "clear" });
  const best = api.storage.get("best"); if (typeof best === "number") set(api, "best", best);
  api.log(L(api, `🎲 掷出属性：${abilText(api)}`, `🎲 Rolled abilities: ${abilText(api)}`));
  api.log(L(api, `生命 ${hp} · AC ${calcAc(api)} · 长剑 1d10${sign(atkMod(api))}`, `HP ${hp} · AC ${calcAc(api)} · Longsword 1d10${sign(atkMod(api))}`));
  refresh(api);
  return true;
}

export function walk_rules(api) {
  const dist = get(api, "distance") + 1;
  set(api, "distance", dist); set(api, "camped", false);
  if (dist > get(api, "best")) { set(api, "best", dist); api.storage.set("best", dist); }
  { const s = sfx(api); s.scroll = Math.max(s.scroll, s.target); s.target = s.scroll + MILE_PX; if (s.cur) { s.prev = s.cur; s.cur = null; } saveFx(api, s); }
  if (dist % BIOME_EVERY === 0) {
    const cur = get(api, "biome"); const next = api.random.pick(Object.keys(BIOMES).filter((b) => b !== cur));
    set(api, "biome", next); set(api, "art", { time: get(api, "art").time, weather: BIOME_WEATHER[next] });
    api.log(L(api, `🗺 道路把你带进了${biomeName(api)}。`, `🗺 The road leads you into the ${biomeName(api)}.`));
  }
  { const art = get(api, "art"); art.time = ["day", "day", "dusk", "night"][Math.floor(dist / 3) % 4]; set(api, "art", art); }
  api.log(L(api, `—— 第 ${dist} 里 · ${biomeName(api)} ——`, `—— Mile ${dist} · ${biomeName(api)} ——`));
  // 口粮
  if (get(api, "rations") > 0) { if (has(api, "traveler_boots") && api.random.int(1, 100) <= 25) api.log(L(api, "👢 旅人靴：这一里没耗口粮。", "👢 Traveler's boots: no ration needed this mile.")); else api.state.inc("rations", -1); }
  else { const dmg = d(api, 1, 4) + Math.floor(dist / 25); hurt(api, dmg); api.log(L(api, `🍖 口粮吃完了，饥饿让你失去 ${dmg} 生命。`, `🍖 Out of rations — hunger costs you ${dmg} HP.`)); }
  // 采集：平原、森林、丘陵有时能在路边找到吃的
  if (["plains", "forest", "hills"].indexOf(get(api, "biome")) >= 0 && api.random.int(1, 100) <= 20 && gain(api, "rations", 1)) api.log(L(api, "🫐 路边采到一些浆果和蘑菇（+1 口粮）。", "🫐 You forage berries and mushrooms by the road (+1 ration)."));
  // 状态效果
  const st = status(api);
  if (st.poisoned) { const dmg = d(api, 1, 4); hurt(api, dmg); api.log(L(api, `🤢 毒性发作，失去 ${dmg} 生命。`, `🤢 Poison burns: -${dmg} HP.`)); }
  for (const k of Object.keys(st)) if (k !== "exhausted" && st[k] > 0) st[k] -= 1;
  set(api, "status", st);
  if (get(api, "hp") <= 0) { refresh(api); return { died: true }; }
  // 事件：守关者 > 委托回访 > 预知的类别 > 掷骰
  const q = get(api, "quest");
  if (dist % BOSS_EVERY === 0) { if (q && q.due === dist) { q.due += 1; set(api, "quest", q); } spawn(api, "combat", dist === BOSS_EVERY ? 1 : 2, true); }
  else if (q && q.due && dist >= q.due) spawn(api, "quest", 1, false);
  else {
    const kind = get(api, "next_kind") || rollKind(api);
    const tier = Number(api.random.weighted({ "-1": 30, "0": 50, "1": 15, "2": 5 }));
    spawn(api, kind, tier, false);
  }
  set(api, "next_kind", rollKind(api));
  refresh(api);
  return { kind: get(api, "event_kind") };
}

// AI 返回后由 output.then 调用（规则身份执行）
export function apply_ai(api) {
  const p = api.params, card = get(api, "card");
  if (!card || get(api, "phase") !== "card" && get(api, "phase") !== "shop") return false;
  if (!card.pending && card.ai) return false;      // 已经用过 AI 的结果
  if (!card.pending && card.touched) return false; // 玩家已经在内置卡片上做了选择
  set(api, "ai_mode", "yes");
  const draft = { title: p.title, text: p.text, foe: p.foe, options: [] };
  for (const i of [1, 2, 3]) {
    const verb = p[`o${i}_verb`]; if (!verb || verb === "none") continue;
    draft.options.push({ label: p[`o${i}_label`], verb, ability: p[`o${i}_ability`], diff: p[`o${i}_diff`], reward: p[`o${i}_reward`], risk: p[`o${i}_risk`], cost: p[`o${i}_cost`], relic: p.relic });
  }
  if (card.kind === "combat" || card.kind === "quest") { if (!draft.foe && card.kind === "combat") draft.foe = card.foe; }
  card.pending = true; set(api, "card", card); // 允许覆盖内置卡片
  fillCard(api, draft, true);
  // 画面模块
  const s = sfx(api);
  if (s.cur) {
    const allowed = card.kind === "combat" ? (card.boss ? FOE_SPRITES : FOE_SPRITES.filter((x) => x !== "warden")) : KIND_SPRITES[card.kind] || [];
    if (allowed.indexOf(p.sprite) >= 0) s.cur.sprite = p.sprite;
    if (TINTS.indexOf(p.tint) >= 0) s.cur.tint = p.tint;
    s.cur.pending = false; saveFx(api, s);
  }
  const art = get(api, "art");
  if (["day", "dusk", "night"].indexOf(p.time) >= 0) art.time = p.time;
  if (WEATHER.indexOf(p.weather) >= 0) art.weather = p.weather;
  set(api, "art", art);
  refresh(api);
  return true;
}

// 界面层的按钮 / 列表点击
export function on_ui(api) {
  const p = api.params;
  if (p.overlay === "card" && p.type === "button" && p.id === "skip") { if ((get(api, "ai_mode") || "unknown") === "unknown") set(api, "ai_mode", "no"); useTemplate(api); }
  else if (p.overlay === "card" && p.type === "select") { const c = get(api, "card"); c.touched = true; set(api, "card", c); chooseOption(api, p.id); }
  else if (p.overlay === "shop" && p.type === "select") shopBuy(api, p.id);
  refresh(api);
}
// 定时检查：AI 太慢就用内置模板
export function watch(api) {
  const card = get(api, "card");
  if (!card || !card.pending || (get(api, "phase") !== "card" && get(api, "phase") !== "shop")) return;
  const mode = get(api, "ai_mode") || "unknown";
  if (api.time - card.born < AI_WAIT[mode]) return;
  if (mode === "unknown") set(api, "ai_mode", "no");
  useTemplate(api); refresh(api);
}
// 读档后（或窗口变化）把界面层重新显示出来
export function resize(api) { refresh(api); }

export function attack(api) {
  const lv = get(api, "level"), g = gear(api);
  const swings = lv >= 5 ? 2 : 1;
  const bonus = atkMod(api) + prof(lv) + g.weapon;
  anim(api, "atk", 300); reveal(api);
  for (let i = 0; i < swings; i++) {
    const f = get(api, "foe"); const r = d20(api); const total = r.nat + bonus + r.bonus;
    if (r.nat === 1 || (r.nat !== 20 && total < f.ac)) {
      pop(api, L(api, "未命中", "miss"), "#e8e8e8", true);
      api.log(L(api, `🗡 攻击落空（d20=${r.nat}，${total} 对 AC ${f.ac}）`, `🗡 You miss (d20=${r.nat}, ${total} vs AC ${f.ac})`));
      continue;
    }
    const dmg = Math.max(1, d(api, r.nat === 20 ? 2 : 1, 10) + atkMod(api) + g.weapon);
    f.hp = Math.max(0, f.hp - dmg); set(api, "foe", f);
    anim(api, "fhurt", 300);
    pop(api, r.nat === 20 ? `${dmg}!` : String(dmg), r.nat === 20 ? "#ffdd44" : "#ffffff", true);
    api.log(L(api, `🗡 ${r.nat === 20 ? "暴击！" : "命中！"}（d20=${r.nat}）对${f.name}造成 ${dmg} 点伤害。`, `🗡 ${r.nat === 20 ? "CRITICAL!" : "Hit!"} (d20=${r.nat}) ${dmg} damage to ${f.name}.`));
    if (has(api, "vampiric_blade")) heal(api, 2);
    if (f.hp <= 0) { victory(api, f); refresh(api); return { won: true }; }
  }
  enemyTurn(api);
  refresh(api);
  return { won: false };
}

export function flee(api) {
  const f = get(api, "foe");
  const dc = 10 + Math.floor(f.threat / 2) + (f.boss ? 3 : 0);
  const r = d20(api), total = r.nat + abilMod(api, "dex") + prof(get(api, "level")) + r.bonus;
  if (r.nat === 20 || (r.nat !== 1 && total >= dc)) {
    api.log(L(api, `🏃 敏捷检定 ${total} 对 DC ${dc}：你甩掉了${f.name}。`, `🏃 DEX check ${total} vs DC ${dc}: you shake off ${f.name}.`));
    endEvent(api); refresh(api); return { fled: true };
  }
  api.log(L(api, `🏃 敏捷检定 ${total} 对 DC ${dc}：没能逃掉！`, `🏃 DEX check ${total} vs DC ${dc}: you fail to escape!`));
  enemyTurn(api); refresh(api);
  return { fled: false };
}

export function potion(api) {
  const amt = Math.round((d(api, 2, 4) + 2 + Math.floor(get(api, "max_hp") / 5)) * (has(api, "alchemist_flask") ? 1.5 : 1));
  const h = heal(api, amt);
  api.state.inc("potions", -1);
  const st = status(api); let cure = "";
  if (st.poisoned) { st.poisoned = 0; set(api, "status", st); cure = L(api, "，解了毒", ", and cures the poison"); }
  pop(api, `+${h}`, "#7aff8a", false);
  api.log(L(api, `🧪 你喝下治疗药水，恢复 ${h} 生命${cure}。`, `🧪 You drink a healing potion and recover ${h} HP${cure}.`));
  if (get(api, "phase") === "battle") enemyTurn(api);
  refresh(api);
  return { healed: h };
}

function campHere(api, safe) {
  set(api, "camped", true);
  const st = status(api); if (st.exhausted) { st.exhausted = 0; set(api, "status", st); }
  if (safe) {
    const h = heal(api, get(api, "max_hp"));
    const r = gain(api, "rations", 1);
    api.log(L(api, `🔥 你在安全的地方睡了个好觉，恢复 ${h} 生命${r ? "，还找到了 1 份存粮" : ""}。`, `🔥 You sleep soundly in safety and recover ${h} HP${r ? ", and find 1 stored ration" : ""}.`));
    endEvent(api); return { healed: h };
  }
  const kit = gear(api).kit;
  api.state.inc("rations", -1);
  const h = heal(api, Math.ceil(get(api, "max_hp") * KIT_HEAL[kit]));
  api.log(L(api, `🔥 你在路边扎营，吃掉 1 份口粮，恢复 ${h} 生命。`, `🔥 You make camp by the road, eat 1 ration and recover ${h} HP.`));
  if (api.random.int(1, 100) <= KIT_AMBUSH[kit]) {
    api.log(L(api, "夜里有动静……", "Something stirs in the night…"));
    spawn(api, "combat", 0, false);
    const card = get(api, "card"); card.pending = false; card.title = card.foe; set(api, "card", card);
    startBattle(api, card.foe, false);
    return { healed: h, ambush: true };
  }
  return { healed: h };
}
export function camp_rules(api) { const r = campHere(api, false); refresh(api); return r; }
