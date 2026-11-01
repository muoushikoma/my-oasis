// 无尽之路 / The Endless Road — 规则脚本
//
// 框架：
//   每走一里 → 引擎掷出「事件类别 + 强度」→ AI 把它写成一张「事件卡」（标题、描述、2~3 个选项）→ 玩家选一个 → 规则结算。
//   选项 = 动作（检定 / 付出 / 赌运 / 动手 / 接委托）+ 从菜单里挑的「收获」和「风险」。具体数值全部由规则按威胁和难度计算，
//   卡上直接显示，AI 改不了。这个故事需要接 AI。
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
  blessed: ["祝福", "Blessed", "d20 +2", "d20 +2"], cursed: ["诅咒", "Cursed", "d20 -2", "d20 -2"], poisoned: ["中毒", "Poisoned", "每里 -1d4", "-1d4 HP per mile"],
  exhausted: ["疲惫", "Exhausted", "AC -2", "AC -2"], scouted: ["侦察", "Scouted", "更容易避开战斗", "easier to avoid fights"],
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
// 职业：属性按 order 从高到低分配；atk 攻击属性；die 伤害骰（die5 是 5 级以后）；hd 生命骰；check 检定加成
const CLASSES = {
  fighter: { name: ["战士", "Fighter"], order: ["str", "con", "dex", "wis", "cha", "int"], atk: "str", die: 10, die5: 10, hd: 10, base: 14, ac: 13,
    weapon: ["长剑", "Longsword"], check: { str: 2, con: 2 },
    desc: ["板甲与长剑。生命骰 d10，5 级起每回合攻击两次；力量、体质检定 +2。", "Plate and longsword. d10 hit die, two attacks per turn from level 5; +2 to STR and CON checks."] },
  rogue: { name: ["游荡者", "Rogue"], order: ["dex", "con", "cha", "int", "wis", "str"], atk: "dex", die: 8, die5: 8, hd: 8, base: 13, ac: 12,
    weapon: ["细剑", "Rapier"], check: { dex: "x2" },
    desc: ["兜帽与细剑。生命骰 d8；每场战斗第一击偷袭（+1d6，每 2 级再 +1d6）；敏捷检定双倍熟练，逃跑更容易。", "Hood and rapier. d8 hit die; the first strike of each fight is a Sneak Attack (+1d6, +1d6 every 2 levels); double proficiency on DEX checks, easier escapes."] },
  wizard: { name: ["法师", "Wizard"], order: ["int", "con", "dex", "wis", "cha", "str"], atk: "int", die: 10, die5: 10, dice5: 2, hd: 6, base: 12, ac: 13,
    weapon: ["火焰箭", "Fire Bolt"], check: { int: 2, wis: 1 },
    desc: ["法袍与法杖。生命骰 d6，常驻法师护甲（AC 13 起）；火焰箭 1d10（5 级起 2d10）；每场战斗第一发魔法飞弹必中；智力检定 +2。", "Robe and staff. d6 hit die, permanent Mage Armor (AC 13 base); Fire Bolt 1d10 (2d10 from level 5); the first Magic Missile of each fight always hits; +2 to INT checks."] },
  cleric: { name: ["牧师", "Cleric"], order: ["wis", "con", "str", "cha", "dex", "int"], atk: "wis", die: 8, die5: 8, hd: 8, base: 13, ac: 14,
    weapon: ["钉头锤", "Mace"], check: { wis: 2, cha: 1 },
    desc: ["锁甲与钉头锤。生命骰 d8；药水和扎营回血 ×1.5；对亡灵和幽魂额外 +1d8；感知检定 +2。", "Chain mail and mace. d8 hit die; potions and camping heal ×1.5; +1d8 against undead and spirits; +2 to WIS checks."] },
};
const CLASS_IDS = Object.keys(CLASSES);
// 职业资源：怒气（命中 +1、挨打 +1，每场清零）、连击（命中 +1，每场从 1 开始）、法力（只在扎营时补满）、信仰（每回合 +1，每场至少 2）
const RES = { fighter: { k: "rage", cur: 0, max: 6 }, rogue: { k: "combo", cur: 0, max: 5 }, wizard: { k: "mana", cur: 6, max: 6 }, cleric: { k: "faith", cur: 2, max: 6 } };
const RES_NAME = { rage: ["怒气", "Rage"], combo: ["连击", "Combo"], mana: ["法力", "Mana"], faith: ["信仰", "Faith"] };
// 每个职业 3 个技能（cost < 0 表示“花光全部，至少 -cost 点”）
const SKILLS = {
  fighter: [
    { id: "bash", cost: 2, icon: "shield", name: ["盾击", "Shield Bash"], desc: ["攻击；命中造成 1d6+力量，并眩晕 1 回合（打断蓄力）", "Attack; on hit 1d6+STR and stun 1 turn (breaks a charge)"] },
    { id: "cleave", cost: 3, icon: "sword", name: ["顺劈", "Cleave"], desc: ["必中：2 个武器骰 + 力量 + 武器强化", "Never misses: 2 weapon dice + STR + weapon"] },
    { id: "cry", cost: 4, icon: "star", name: ["战吼", "Battle Cry"], desc: ["回复 25% 生命，并获得格挡 5+等级", "Heal 25% HP and gain block 5+level"] }],
  rogue: [
    { id: "evade", cost: 1, icon: "boot", name: ["闪避", "Evade"], desc: ["完全躲开敌人这回合的攻击", "Completely dodge the enemy's next attack"] },
    { id: "venom", cost: 2, icon: "skull", name: ["淬毒之刃", "Poison Blade"], desc: ["攻击；命中后敌人中毒 3 回合（亡灵免疫）", "Attack; on hit the foe is poisoned 3 turns (undead immune)"] },
    { id: "evis", cost: -2, icon: "gem", name: ["剔骨", "Eviscerate"], desc: ["必中：花光连击，每点 1d6+1，再 + 敏捷", "Never misses: spend all combo, 1d6+1 each, + DEX"] }],
  wizard: [
    { id: "ward", cost: 1, icon: "shield", name: ["护盾术", "Shield"], desc: ["获得格挡 5 + 2×熟练", "Gain block 5 + 2×proficiency"] },
    { id: "frost", cost: 2, icon: "gem", name: ["冰霜射线", "Ray of Frost"], desc: ["必中：1d8+智力，并冻结 1 回合", "Never misses: 1d8+INT and freeze 1 turn"] },
    { id: "fireball", cost: 3, icon: "fire", name: ["火球术", "Fireball"], desc: ["必中：3d6+智力（每 3 级 +1d6）", "Never misses: 3d6+INT (+1d6 every 3 levels)"] }],
  cleric: [
    { id: "cure", cost: 2, icon: "heart", name: ["治疗术", "Cure Wounds"], desc: ["回复 1d8 + 感知 + 等级", "Heal 1d8 + WIS + level"] },
    { id: "smite", cost: 2, icon: "star", name: ["惩戒", "Smite"], desc: ["攻击 +2d8 光耀伤害（亡灵和幽魂 4d8）", "Attack +2d8 radiant (4d8 vs undead and spirits)"] },
    { id: "sanct", cost: 3, icon: "check", name: ["庇护所", "Sanctuary"], desc: ["获得格挡 8 + 2×等级，并解毒", "Gain block 8 + 2×level and cure poison"] }],
};
// 天赋：升级时三选一
const PERKS = {
  toughness: { n: ["坚韧", "Toughness"], d: ["最大生命 +6", "+6 max HP"] },
  bulwark: { n: ["铁壁", "Bulwark"], d: ["防御时格挡 +3", "+3 block when you Defend"] },
  scavenger: { n: ["拾荒者", "Scavenger"], d: ["打败敌人金币 ×1.5，更常掉铁料", "×1.5 gold from foes, more iron drops"] },
  veteran: { n: ["老兵", "Veteran"], d: ["每场战斗开始时职业资源 +1", "+1 class resource at the start of each fight"] },
  forager: { n: ["觅食者", "Forager"], d: ["任何地区都能采集，几率 +15%", "Forage in any region, +15% chance"] },
  hardy: { n: ["吃苦耐劳", "Hardy"], d: ["疲劳的惩罚推迟 3 点", "Fatigue penalties start 3 points later"] },
  keen: { n: ["致命", "Keen Edge"], d: ["掷出 19 也算暴击", "Crit on a natural 19 too"] },
  haggler: { n: ["砍价高手", "Haggler"], d: ["商店价格 -25%", "Shop prices -25%"] },
  fury: { n: ["狂怒", "Fury"], d: ["怒气上限 +2，顺劈只要 2 点", "+2 max Rage; Cleave costs 2"], c: "fighter" },
  riposte: { n: ["还击", "Riposte"], d: ["闪避成功时立刻反击", "Counterattack whenever you evade"], c: "rogue" },
  venomist: { n: ["剧毒专精", "Venomist"], d: ["淬毒 5 回合；剔骨每点连击 +2", "Poison lasts 5 turns; Eviscerate +2 per combo"], c: "rogue" },
  arcane_flow: { n: ["奥术涌流", "Arcane Flow"], d: ["战斗中每回合 +1 法力", "+1 Mana every combat turn"], c: "wizard" },
  evocation: { n: ["塑能", "Evocation"], d: ["火球术 +2d6，法力上限 +1", "Fireball +2d6, +1 max Mana"], c: "wizard" },
  devotion: { n: ["虔诚", "Devotion"], d: ["战斗开始信仰 +1，治疗术 ×1.5", "+1 Faith at fight start; Cure Wounds ×1.5"], c: "cleric" },
};
// 岔路：每 5 里选一次接下来走哪条路
const PATHS = {
  road: { n: ["大路", "Highway"], icon: "flag", d: ["安全：威胁 -1，更多行商和歇脚地；路边采不到东西", "Safe: threat -1, more peddlers and rest stops; no foraging"] },
  wilds: { n: ["荒野", "The Wilds"], icon: "map", d: ["威胁 +1，更多发现和秘境，收获 ×1.3，采集更容易", "Threat +1, more discoveries and mystic sites, rewards ×1.3, easier foraging"] },
  shortcut: { n: ["捷径", "Shortcut"], icon: "boot", d: ["每步走 2 里（每步只吃 1 份口粮），威胁 +2，疲劳 +2，没有行商和歇脚地", "2 miles per step (1 ration per step), threat +2, fatigue +2, no peddlers or rest stops"] },
};
const PATH_WEIGHT = { road: { combat: -14, trade: 8, rest: 4 }, wilds: { discovery: 7, mystic: 5, combat: 3, trade: -4 }, shortcut: { trade: -99, rest: -99, combat: 6, hazard: 3 } };
const PATH_THREAT = { road: -1, wilds: 1, shortcut: 2 };
function hasPerk(api, k) { return (get(api, "perks") || []).indexOf(k) >= 0; }
function pathId(api) { const p = get(api, "path"); return PATHS[p] ? p : "road"; }
function cls(api) { return CLASSES[get(api, "hero_class")] || CLASSES.fighter; }
function checkBonus(api, ability) { const b = cls(api).check[ability]; return b === "x2" ? prof(get(api, "level")) : b || 0; }
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
const AI_STALE_MS = 25000; // 等这么久还没有 AI 结果，就提示检查设置并允许重试


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
function atkMod(api) { return mod(abil(api)[cls(api).atk]); }
function biomeName(api) { return T2(api, BIOMES[get(api, "biome")]); }
function threatNow(api) { const dd = get(api, "distance"); return 1 + Math.floor(dd / 8) + Math.floor(Math.pow(dd / 35, 2)); }
function has(api, relic) { return (get(api, "relics") || []).indexOf(relic) >= 0; }
function status(api) { return get(api, "status") || {}; }
function gear(api) { return get(api, "gear"); }
function caps(api) { const p = gear(api).pack; return { rations: 8 + 4 * p, potions: 3 + p }; }
function abilText(api) { const a = abil(api); return ABIL.map((k) => `${T2(api, ABIL_NAME[k])} ${a[k]}(${sign(mod(a[k]))})`).join(" · "); }
// 英文模式下把中文标点换成英文标点（日志、面板、事件卡都经过这里）
function en(api, t) {
  if (api.lang !== "en" || typeof t !== "string") return t;
  return t.replace(/（/g, " (").replace(/）/g, ")").replace(/：/g, ": ").replace(/，/g, ", ").replace(/。/g, ".").replace(/、/g, ", ").replace(/【/g, "[").replace(/】/g, "]").replace(/「|」/g, "\"").replace(/ {2,}/g, " ").replace(/\( /g, "(");
}
// 日志：写进客户端日志，同时记进 journal 状态（界面里自己画日志框）
function log(api, t) {
  const line = en(api, t);
  api.log(line);
  const j = get(api, "journal") || []; j.push(line); if (j.length > 60) j.splice(0, j.length - 60);
  set(api, "journal", j);
}
function enSpec(api, n) {
  if (Array.isArray(n)) return n.map((x) => enSpec(api, x));
  if (!n || typeof n !== "object") return n;
  const o = {}; for (const k in n) o[k] = (k === "text" || k === "sub" || k === "title" || k === "t") ? en(api, n[k]) : enSpec(api, n[k]); return o;
}
function clip(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }

// d20：叠加祝福、诅咒、幸运符
function d20(api) {
  const nat = api.random.int(1, 20), st = status(api);
  let bonus = 0; if (st.blessed) bonus += 2; if (st.cursed) bonus -= 2; if (has(api, "lucky_charm")) bonus += 1;
  bonus -= fatiguePen(api); bonus += passiveSum(api, "luck");
  return { nat, bonus };
}
function bonusText(b) { return b ? sign(b) : ""; }
// 疲劳：每走一里 +1，扎营清零；6 起 d20 -1，9 起 -2，12 起 -3 并且每里掉血
function fatiguePen(api) { const f = (get(api, "fatigue") || 0) - (hasPerk(api, "hardy") ? 3 : 0); return f >= 12 ? 3 : f >= 9 ? 2 : f >= 6 ? 1 : 0; }
function priceOf(api, k) { const v = PRICE[k] * (1 + get(api, "distance") / 50); return Math.max(1, Math.round(k === "iron_sell" ? v : v * (hasPerk(api, "haggler") ? 0.75 : 1))); }

function calcAc(api) {
  const g = gear(api); let ac = cls(api).ac + Math.min(2, abilMod(api, "dex")) + g.armor;
  if (has(api, "guardian_amulet")) ac += 1; if (status(api).exhausted) ac -= 2;
  ac += passiveSum(api, "ac") - curseCount(api, "clumsy");
  return ac;
}
function heal(api, n) { const mx = get(api, "max_hp"), hp = get(api, "hp"); const v = Math.min(mx, hp + Math.max(0, Math.round(n))); set(api, "hp", v); return v - hp; }
function hurt(api, n) {
  const hp = Math.max(0, get(api, "hp") - n);
  if (hp <= 0 && has(api, "undying_ember")) {
    set(api, "hp", 1); set(api, "relics", get(api, "relics").filter((r) => r !== "undying_ember"));
    log(api, L(api, "🔥 不灭余烬燃尽了——你没有倒下，剩下 1 点生命。", "🔥 The undying ember burns out — you stay standing with 1 HP."));
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
    if (lost > 0) log(api, L(api, `🎒 背包装不下，丢掉了 ${lost} ${k === "rations" ? "份口粮" : "瓶药水"}。`, `🎒 Your pack is full — ${lost} ${k} left behind.`));
    return v - cur;
  }
  api.state.inc(k, n); return n;
}

// ---------- 画面状态（scripts/scene.js 负责画） ----------
function sfx(api) { return get(api, "scene_fx"); }
function saveFx(api, s) { s.busy = true; set(api, "scene_fx", s); }
// 飘字只用像素字体里有的字符：数字、+ - !，以及图标 v(成功) x(失败/未命中) s(闪开) h(强化)
function pop(api, text, color, onFoe) {
  const s = sfx(api); const x = onFoe && s.cur ? s.cur.wx - s.scroll : HERO_X;
  s.fxid = (s.fxid || 0) + 1;
  s.fx = (s.fx || []).slice(-5); s.fx.push({ id: s.fxid, text: String(text), color, x: x + api.random.int(-4, 4), y: 84, life: 900, foe: !!onFoe }); saveFx(api, s);
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
// 敌人特性（AI 可以挑，规则执行）：改变敌人会出哪些意图
const TRAITS = {
  none: ["普通", "Ordinary", ""], armored: ["重甲", "Armored", "AC +2，常常举盾防御"], swift: ["迅捷", "Swift", "常常连击两次"],
  venomous: ["剧毒", "Venomous", "攻击会让你中毒"], brute: ["蛮力", "Brute", "常常蓄力，下回合重击"], regenerating: ["再生", "Regenerating", "每回合回复生命"],
  arcane: ["奥术", "Arcane", "会吸取生命、施加诅咒"], undead: ["亡灵", "Undead", "免疫毒；怕圣光"], thief: ["盗贼", "Thief", "会偷你的金币"],
};
const TRAIT_EN = { armored: "AC +2, often raises a guard", swift: "often strikes twice", venomous: "attacks poison you", brute: "often charges up, then smashes", regenerating: "regains HP every turn", arcane: "drains life and curses", undead: "immune to poison; weak to radiance", thief: "steals your gold" };
const SPRITE_TRAIT = { wolf: "swift", spider: "venomous", bandit: "thief", skeleton: "undead", troll: "regenerating", drake: "brute", ooze: "armored", wisp: "arcane", warden: "armored" };
const TRAIT_IDS = Object.keys(TRAITS);
function foeFor(api, name, boss, threat, trait) {
  const t = threat;
  const f = { name, hp: 3 + 4 * t + api.random.int(0, t), max_hp: 0, ac: Math.min(19, 10 + Math.floor((t + 1) / 2)), atk: 1 + Math.floor(t * 0.6),
    dice: 1 + Math.floor(t / 8), sides: t >= 6 ? 10 : t >= 4 ? 8 : t >= 2 ? 6 : 4, bonus: Math.floor(t / 2), threat: t, boss: !!boss,
    trait: TRAITS[trait] ? trait : "none", block: 0, stun: 0, poison: 0, charged: false, intent: null };
  if (f.trait === "armored") f.ac += 2;
  if (f.trait === "brute") f.bonus += 1;
  if (boss) { f.hp = Math.round(f.hp * 1.4); f.bonus += 1; }
  f.max_hp = f.hp; f.intent = pickIntent(api, f); return f;
}
function dmgRange(f, mult, plus) { return [f.dice * mult + f.bonus + (plus || 0), f.dice * f.sides * mult + f.bonus + (plus || 0)]; }
function pickIntent(api, f) {
  if (f.charged) { const r = dmgRange(f, 2, 2); return { t: "smash", lo: r[0], hi: r[1] }; }
  const w = { attack: 55, defend: 10, charge: 10 };
  if (f.trait === "armored") w.defend += 20; if (f.trait === "brute") w.charge += 22; if (f.trait === "swift") w.double = 30;
  if (f.trait === "venomous") w.poison = 30; if (f.trait === "arcane") { w.drain = 22; w.curse = 12; } if (f.trait === "thief") w.steal = 25;
  if (f.boss) w.charge += 8;
  if (f.sig && !f.sigCd) w.sig = f.boss ? 18 : 24;
  const t = api.random.weighted(w);
  if (t === "sig") return sigIntent(f);
  if (t === "defend") return { t, lo: 3 + Math.floor(f.threat * 0.8), hi: 3 + Math.floor(f.threat * 0.8) };
  if (t === "charge" || t === "curse") return { t, lo: 0, hi: 0 };
  if (t === "steal") return { t, lo: 5 + f.threat, hi: 5 + f.threat };
  if (t === "double") { const r = dmgRange(f, 1, -1); return { t, lo: Math.max(1, r[0]), hi: Math.max(1, r[1]) }; }
  const r = dmgRange(f, 1, 0); return { t, lo: r[0], hi: r[1] };
}
function defaultFoe(api) { return api.random.pick(FOES[get(api, "biome")]); }

// 把一个选项草稿变成规则认可的选项：校验动作、算 DC、算收获/风险/代价的确切数值
function finalizeOption(api, o, kind, idx, card) {
  const T = card.threat;
  const allowed = VERBS[kind] || [];
  if (allowed.indexOf(o.verb) < 0) return null;
  const opt = { id: `o${idx}`, label: o.label, verb: o.verb, win: clip(o.win, 140), lose: clip(o.lose, 140) };
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
  const relicOk = (o.verb === "check" && opt.diff === "hard") || kind === "quest" || (card.item && !card.itemOffered);
  if (rw === "relic" && !relicOk) rw = rsize === "large" || rsize === "huge" ? "essence" : "iron";
  if (rw === "relic" && !card.item && get(api, "relics").length >= 3) rw = "essence";
  if (rw === "relic" && card.item) { card.itemOffered = true; opt.rarity = (o.verb === "check" && opt.diff === "hard") || kind === "quest" || o.verb === "pay" ? "rare" : "common"; }
  if (rw === "essence" && rsize !== "large" && rsize !== "huge") rw = "iron";
  if (kind === "combat" && o.verb !== "fight") { rsize = "small"; if (rw === "relic" || rw === "essence") rw = "gold"; }
  opt.reward = rw; opt.ramt = rewardAmount(api, rw, rsize, T);
  if (rw === "relic") opt.relic = card.item ? `✦ ${card.item.name}（${T2(api, RARITY[opt.rarity])}）` : RELIC_IDS.indexOf(o.relic) >= 0 && !has(api, o.relic) ? o.relic : null;
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
  const k = SIZE[size] * (pathId(api) === "wilds" ? 1.3 : 1);
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
    case "hurt": return Math.max(2, Math.round((1 + Math.floor(T / 3)) * 4.5 * k));
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
  if (r === "relic") return relic ? (relic[0] === "✦" ? relic : T2(api, RELICS[relic])) : L(api, "随机遗物", "a random relic");
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

const VERB_ICON = { check: "dice", pay: "bag", gamble: "clover", fight: "sword", quest: "scroll" };
// 选项的结构化标签：k = dc（难度）/ good（收获）/ bad（风险或代价）/ info
function optTags(api, o, kind) {
  const t = [];
  const win = () => (!o.reward || o.reward === "none") ? (kind === "combat" ? L(api, "避开战斗", "avoid the fight") : L(api, "安全通过", "get through")) : amtText(api, o.reward, o.ramt, o.relic);
  if (o.verb === "fight") t.push({ k: "bad", t: L(api, "进入战斗", "start a fight") });
  else if (o.verb === "quest") t.push({ k: "info", t: L(api, "几里后回访领赏", "reward a few miles later") });
  else if (o.verb === "pay") { t.push({ k: "bad", t: `${L(api, "付出", "pay")} ${T2(api, R_NAME[o.cost])} ${o.camt}` }); t.push({ k: "good", t: win() }); }
  else {
    t.push({ k: "dc", t: o.verb === "gamble" ? L(api, "五五开", "50 / 50") : `${T2(api, ABIL_NAME[o.ability])} DC ${o.dc}` });
    t.push({ k: "good", t: win() });
    if (o.risk && o.risk !== "none") t.push({ k: "bad", t: amtText(api, o.risk, o.kamt) });
  }
  return t.map((x) => ({ k: x.k, t: en(api, x.t) }));
}

// 生成一张事件卡（内容由 AI 写：可能已经提前写好，也可能还在路上）
function spawn(api, kind, tier, boss, presetThreat) {
  const threat = presetThreat || Math.max(1, threatNow(api) + tier);
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
  log(api, `${KIND_ICON[kind]} ${T2(api, KIND_NAME[kind])}${boss ? L(api, "：守关者挡住了去路", ": a warden blocks the road") : ""}（${L(api, "威胁", "threat")} ${threat}）`);
}

// 用模板（或 AI 的草稿）填好卡片
function fillCard(api, draft, fromAi) {
  const card = get(api, "card"); const kind = card.kind;
  card.title = clip(T2(api, draft.title), 30) || card.title || T2(api, KIND_NAME[kind]);
  card.text = clip(T2(api, draft.text), 360);
  if (draft.foe && !card.sig) card.foe = clip(T2(api, draft.foe), 30);
  const opts = [];
  if (kind === "trade" || kind === "rest") { /* 交易、休憩不需要选项 */ }
  else if (card.boss) opts.push({ id: "o1", label: L(api, "迎战", "Face the warden"), verb: "fight" });
  else {
    (draft.options || []).slice(0, 3).forEach((o, i) => { const f = finalizeOption(api, Object.assign({}, o, { label: clip(T2(api, o.label), 40) || L(api, "试试看", "Try it") }), kind, i + 1, card); if (f) opts.push(f); });
    if (kind === "combat" && !opts.some((o) => o.verb === "fight")) opts.unshift({ id: "o0", label: L(api, "动手", "Fight"), verb: "fight" });
    if (!opts.length || (kind === "combat" && opts.length < 2)) {
      // AI 给出的选项都不合规：标题和描述用 AI 的，选项由规则补一组通用的
      const tpl = kind === "combat" ? combatTemplate(api, card) : genericOptions(api, kind);
      if (tpl) tpl.options.forEach((o, i) => { if (opts.some((x) => x.verb === "fight") && o.verb === "fight") return; const f = finalizeOption(api, Object.assign({}, o, { label: T2(api, o.label) }), kind, i + 4, card); if (f) opts.push(f); });
    }
  }
  opts.forEach((o, i) => (o.id = `o${i + 1}`));
  card.options = opts;
  card.pending = false; card.ai = !!fromAi;
  if (draft.sprite && (KIND_SPRITES[kind] || []).indexOf(draft.sprite) >= 0) { const s = sfx(api); if (s.cur) { s.cur.sprite = draft.sprite; saveFx(api, s); } }
  set(api, "card", card);
  reveal(api);
  if (card.text) log(api, `${fromAi ? "✦" : "📖"} ${card.title}：${card.text}`);
  if (opts.length) log(api, `${L(api, "选项", "Options")}：` + opts.map((o, i) => `${i + 1}. ${o.label}（${optText(api, o, kind)}）`).join("  "));
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
const GENERIC_ABIL = { encounter: "cha", discovery: "int", hazard: "dex", mystic: "wis", dilemma: "wis", quest: "cha" };
const GENERIC_REWARD = { encounter: "gold", discovery: "gold", hazard: "xp", mystic: "blessing", dilemma: "xp", quest: "relic" };
function genericOptions(api, kind) {
  return { options: [
    { label: ["谨慎应对", "Handle it carefully"], verb: "check", ability: GENERIC_ABIL[kind] || "wis", diff: "easy", reward: GENERIC_REWARD[kind] || "gold", risk: "hurt" },
    { label: ["放手一搏", "Go all in"], verb: "check", ability: GENERIC_ABIL[kind] || "wis", diff: "hard", reward: kind === "quest" ? "relic" : "gold", risk: "hurt" },
  ] };
}

function startBattle(api, name, free) {
  const card = get(api, "card");
  const spr = (sfx(api).cur || {}).sprite;
  const trait = (card.sig && card.sig.trait !== "none" ? card.sig.trait : "") || card.trait || SPRITE_TRAIT[spr] || "none";
  const f = foeFor(api, (card.sig && card.sig.name) || name || card.foe || T2(api, defaultFoe(api)), card.boss, card.threat, trait);
  if (card.sig) { f.sig = { move: card.sig.move, mk: card.sig.mk }; f.intent = pickIntent(api, f); if (!card.foe_line && card.sig.line) card.foe_line = card.sig.line; if (!card.foe_end && card.sig.end) card.foe_end = card.sig.end; codexAdd(api, "foe", card.sig.name, `${card.sig.move}：${T2(api, SIG_TEXT[card.sig.mk])}`, card.sig.desc); }
  set(api, "foe", f); set(api, "event_kind", "combat"); set(api, "phase", "battle");
  set(api, "hero_block", 0); set(api, "evade", false);
  // 职业资源：怒气、连击点每场清零；信仰至少 2；法力保留（只在扎营时补满）
  const r = get(api, "res"); if (r && r.k) { if (r.k === "rage") r.cur = 0; if (r.k === "combo") r.cur = 1; if (r.k === "faith") r.cur = Math.max(r.cur, 2 + (hasPerk(api, "devotion") ? 1 : 0)); if (r.k === "mana") r.cur = Math.min(r.max, r.cur + 1); if (hasPerk(api, "veteran")) r.cur = Math.min(r.max, r.cur + 1); set(api, "res", r); }
  reveal(api);
  log(api, `⚔ ${L(api, "战斗开始", "Battle")}：${f.name}（${L(api, "生命", "HP")} ${f.hp} · AC ${f.ac}${f.trait !== "none" ? " · " + T2(api, TRAITS[f.trait]) : ""}）`);
  if (card.foe_line) log(api, `✦ ${f.name}：「${card.foe_line}」`);
  fireItems(api, "battle_start");
  if (get(api, "foe").hp <= 0) { victory(api, get(api, "foe")); return; }
  if (free) { log(api, L(api, "它抢先出手！", "It strikes first!")); const ff = get(api, "foe"); ff.intent = { t: "attack", lo: dmgRange(ff, 1, 0)[0], hi: dmgRange(ff, 1, 0)[1] }; set(api, "foe", ff); enemyTurn(api); }
}
function endEvent(api, dying) {
  dropSubject(api, !!dying);
  { const card = get(api, "card") || {}; if (!card.returned) { giveBack(api, { item: card.item && !card.itemGiven ? card.item : null, sig: null, wares: (card.wares || []).filter((w) => !w.sold) }); card.returned = true; set(api, "card", card); } }
  set(api, "event_kind", "none"); set(api, "event_title", "");
  settle(api);
}
// 事件结束后：先选天赋，再选岔路，然后才能继续走
function settle(api) {
  if (get(api, "hp") <= 0) { set(api, "phase", "none"); return; }
  if ((get(api, "perk_offer") || []).length) set(api, "phase", "perk");
  else if (get(api, "loot") && get(api, "loot").uid) set(api, "phase", "loot");
  else if (get(api, "distance") >= (get(api, "fork_at") || 5)) set(api, "phase", "fork");
  else set(api, "phase", "none");
}
function offerPerks(api) {
  if ((get(api, "perk_offer") || []).length) { api.state.inc("perk_queue", 1); return; }
  const id = get(api, "hero_class"), taken = get(api, "perks") || [];
  const pool = Object.keys(PERKS).filter((k) => (!PERKS[k].c || PERKS[k].c === id) && taken.indexOf(k) < 0);
  const pick = [];
  while (pool.length && pick.length < 3) pick.push(pool.splice(api.random.int(0, pool.length - 1), 1)[0]);
  if (get(api, "pool") && (get(api, "pool").perks || []).length) pick[pick.length >= 3 ? 2 : pick.length] = "ai";
  set(api, "perk_offer", pick);
  if (get(api, "phase") === "none") settle(api);
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
    case "relic": { const card = get(api, "card") || {}; return card.item ? giveItem(api, o.rarity || "common", card.title) : giveRelic(api, o.relic); }
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
// 给一件道具：优先用这张卡上 AI 发明的，其次从造物池里拿，都没有就给固定遗物
function giveItem(api, rarity, origin) {
  const card = get(api, "card") || {};
  if (card.item && !card.itemGiven) { card.itemGiven = true; set(api, "card", card); return acquire(api, card.item, rarity, origin); }
  const p = pool(api); const spec = p.items.shift(); set(api, "pool", p);
  if (spec) return acquire(api, spec, rarity, origin);
  return giveRelic(api, null);
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
  const o = card.options.filter((x) => x.id === id)[0];
  if (!o) { log(api, L(api, "这张卡上没有这个选项。", "There is no such option on this card.")); return; }
  if (!canAfford(api, o)) { log(api, L(api, "付不起这个代价。", "You can't afford that.")); return; }
  log(api, `➤ ${o.label}`);
  if (o.verb === "fight") { if (o.win) log(api, `✦ ${o.win}`); startBattle(api, card.foe, false); return; }
  if (o.verb === "quest") {
    if (o.win) log(api, `✦ ${o.win}`);
    const due = get(api, "distance") + api.random.int(4, 8);
    set(api, "quest", { title: card.title, due });
    log(api, L(api, `📜 接下委托「${card.title}」——第 ${due} 里左右回来领赏。`, `📜 Accepted "${card.title}" — come back around mile ${due}.`));
    endEvent(api); return;
  }
  let ok;
  if (o.verb === "pay") {
    const c = o.cost === "potion" ? "potions" : o.cost;
    if (c === "hp") hurt(api, o.camt); else api.state.inc(c, -o.camt);
    ok = true;
  } else if (o.verb === "gamble") {
    const r = api.random.int(1, 100); ok = r <= o.chance;
    log(api, `🎲 ${L(api, "赌运气", "Gamble")}：${r} ${ok ? L(api, "→ 成功", "→ win") : L(api, "→ 失败", "→ lose")}`);
  } else {
    const r = d20(api); const m = abilMod(api, o.ability) + prof(get(api, "level")) + checkBonus(api, o.ability);
    const total = r.nat + m + r.bonus;
    ok = r.nat === 20 || (r.nat !== 1 && total >= o.dc);
    log(api, `🎲 ${T2(api, ABIL_NAME[o.ability])} ${L(api, "检定", "check")}：d20=${r.nat} ${sign(m)}${bonusText(r.bonus)} = ${total} ${L(api, "对", "vs")} DC ${o.dc} → ${ok ? L(api, "成功", "success") : L(api, "失败", "failure")}`);
    pop(api, ok ? "v" : "x", ok ? "#9aff8a" : "#ff8a7a", false);
  }
  if (ok) {
    const msg = applyReward(api, o);
    if (o.win) log(api, `✦ ${o.win}`);
    log(api, `✔ ${msg}${card.kind === "combat" ? L(api, "，避开了战斗", ", and avoided the fight") : ""}。`);
    if (card.kind === "quest") set(api, "quest", {});
    endEvent(api);
  } else {
    if (o.lose) log(api, `✦ ${o.lose}`);
    const msg = applyRisk(api, o);
    if (msg === "ambush") { log(api, L(api, "✘ 被发现了！", "✘ You're spotted!")); startBattle(api, card.foe, true); return; }
    log(api, `✘ ${msg}。`);
    if (card.kind === "quest") set(api, "quest", {});
    endEvent(api);
  }
}
function leaveCard(api) {
  const card = get(api, "card");
  if (card.kind === "hazard") {
    if (get(api, "rations") > 0) { api.state.inc("rations", -1); log(api, L(api, "你绕了远路，多吃掉 1 份口粮。", "You take the long way around, eating 1 extra ration.")); }
    else { hurt(api, 2); log(api, L(api, "你饿着肚子绕了远路，失去 2 生命。", "You detour on an empty stomach and lose 2 HP.")); }
  } else if (card.kind === "combat" && !card.boss) {
    // 想溜走：敏捷检定，失败就被追上
    const r = d20(api), m = abilMod(api, "dex") + prof(get(api, "level")) + checkBonus(api, "dex") + (get(api, "hero_class") === "rogue" ? 2 : 0), dc = 10 + Math.floor(card.threat / 2), total = r.nat + m + r.bonus;
    if (!(r.nat === 20 || (r.nat !== 1 && total >= dc))) { log(api, L(api, `🏃 想溜走（${total} 对 DC ${dc}）——被追上了！`, `🏃 You try to slip away (${total} vs DC ${dc}) — caught!`)); startBattle(api, card.foe, true); return; }
    log(api, L(api, `🏃 你悄悄退开，换了条小路（${total} 对 DC ${dc}）。`, `🏃 You back off quietly and take a side path (${total} vs DC ${dc}).`));
  } else if (card.kind === "quest") {
    log(api, L(api, "你放弃了这个委托。", "You abandon the errand.")); set(api, "quest", {});
  } else log(api, L(api, "你没有停留，继续上路。", "You don't linger, and move on."));
  endEvent(api);
}

// ===== AI 造物：道具、怪物、感悟 =====
// AI 用一套“效果语法”发明新东西：什么时候触发（trig）× 产生什么效果（eff）× 可选的诅咒代价（curse），再起名字、写来历。
// 规则只认语法里的词：按稀有度和等级算出具体数值；不合法的组合会被改成最接近的合法组合。所以 AI 可以随意发明，但不会把游戏玩坏。
const TRIGS = ["passive", "battle_start", "on_hit", "on_hurt", "on_kill", "on_mile", "on_camp"];
const EFFS = ["heal", "block", "damage", "poison", "stun", "resource", "gold", "ration", "ac", "luck", "maxhp", "fatigue", "xp"];
const CURSES = ["none", "frail", "clumsy", "weary", "hungry"];
const EFF_TRIGS = {
  heal: ["on_kill", "on_hurt", "on_mile", "on_camp", "on_hit", "battle_start"], block: ["battle_start", "on_hurt", "on_hit"], damage: ["battle_start", "on_hit", "on_hurt"],
  poison: ["battle_start", "on_hit"], stun: ["battle_start", "on_hit", "on_hurt"], resource: ["battle_start", "passive", "on_hit", "on_hurt", "on_kill"],
  gold: ["on_kill", "on_mile"], ration: ["on_kill", "on_mile", "on_camp"], ac: ["passive"], luck: ["passive"], maxhp: ["passive"], fatigue: ["on_mile", "on_kill"], xp: ["on_kill", "on_mile"],
};
const USE_EFFS = ["heal", "block", "damage", "poison", "stun", "resource", "ration", "fatigue", "xp"]; // 消耗品能用的效果
const BATTLE_EFFS = ["block", "damage", "poison", "stun"];
const RARITY = { common: ["普通", "Common", 1], rare: ["稀有", "Rare", 1.6], legendary: ["传说", "Legendary", 2.4] };
const RARITY_UP = { common: "rare", rare: "legendary", legendary: "legendary" };
const TRIG_NAME = { passive: ["常驻", "Always"], battle_start: ["战斗开始时", "At battle start"], on_hit: ["命中时", "On hit"], on_hurt: ["受伤时", "When hurt"], on_kill: ["击败敌人时", "On kill"], on_mile: ["每走一里", "Each mile"], on_camp: ["扎营时", "When camping"], use: ["使用", "Use"] };
const CURSE_NAME = { frail: ["虚弱：最大生命 -20%", "Frail: -20% max HP"], clumsy: ["笨拙：AC -1", "Clumsy: AC -1"], weary: ["沉重：每里 50% 额外 +1 疲劳", "Weary: 50% chance of +1 extra fatigue per mile"], hungry: ["饥饿：每里 25% 多吃 1 份口粮", "Hungry: 25% chance to eat an extra ration per mile"] };
const FREQ = { passive: 1, battle_start: 1, on_hit: 0.45, on_hurt: 0.5, on_kill: 1, on_mile: 0.35, on_camp: 1.5, use: 2.5 };
const SIG_KINDS = ["breath", "drain", "venom", "hex", "rob", "frenzy", "harden", "roar"];
const MAX_TRINKETS = 4, MAX_BAG = 4;

// 把 AI 的发明整理成合法的规格
function cleanSpec(raw, isPerk) {
  const name = clip(raw.name, 16); if (!name) return null;
  let kind = isPerk ? "insight" : raw.kind === "consumable" ? "consumable" : "trinket";
  let eff = EFFS.indexOf(raw.eff) >= 0 ? raw.eff : "heal", trig = raw.trig;
  if (kind === "consumable") { if (USE_EFFS.indexOf(eff) < 0) eff = "heal"; trig = "use"; }
  else if ((EFF_TRIGS[eff] || []).indexOf(trig) < 0) trig = EFF_TRIGS[eff][0];
  const curse = kind === "trinket" && CURSES.indexOf(raw.curse) > 0 ? raw.curse : "none";
  return { name, desc: clip(raw.desc, 90), kind, trig, eff, curse };
}
// 数值：按效果、触发频率、稀有度、等级算
function itemAmt(api, it) {
  const r = RARITY[it.rarity || "common"][2], lv = get(api, "level"), fq = FREQ[it.trig] || 1, k = fq * r;
  switch (it.eff) {
    case "heal": case "block": return Math.max(1, Math.round((3 + lv) * k));
    case "damage": return Math.max(1, Math.round((2 + lv) * k));
    case "poison": return Math.max(1, Math.round(2 * k));
    case "stun": return it.trig === "use" ? (r >= 2.4 ? 2 : 1) : Math.min(100, Math.round((it.trig === "battle_start" ? 40 : 25) * fq * r * (it.trig === "battle_start" ? 1 : 2)));
    case "resource": return it.trig === "passive" ? (r >= 2.4 ? 2 : 1) : Math.max(1, Math.round(1.5 * k));
    case "gold": return Math.max(1, Math.round((2 + get(api, "distance") / 10) * k * 3));
    case "ration": return it.trig === "on_camp" || it.trig === "use" ? Math.max(1, Math.round(r)) : Math.min(90, Math.round((it.trig === "on_mile" ? 15 : 30) * r));
    case "ac": case "luck": return r >= 2.4 ? 2 : 1;
    case "maxhp": return Math.round(5 * r);
    case "fatigue": return it.trig === "use" ? 99 : Math.max(1, Math.round(r));
    case "xp": return Math.max(1, Math.round(5 * lv * k));
  }
  return 0;
}
// 效果说明（规则算出的确切数值）
function effText(api, it) {
  const n = itemAmt(api, it), pct = it.eff === "stun" && it.trig !== "use" || it.eff === "ration" && (it.trig === "on_mile" || it.trig === "on_kill");
  const e = {
    heal: [`回复 ${n} 生命`, `heal ${n} HP`], block: [`格挡 +${n}`, `+${n} block`], damage: [`对敌人造成 ${n} 点伤害`, `deal ${n} damage to the foe`],
    poison: [`敌人中毒 ${n} 回合`, `poison the foe for ${n} turns`], stun: pct ? [`${n}% 几率眩晕敌人`, `${n}% chance to stun the foe`] : [`眩晕敌人 ${n} 回合`, `stun the foe for ${n} turn(s)`],
    resource: it.trig === "passive" ? [`职业资源上限 +${n}`, `+${n} max class resource`] : [`职业资源 +${n}`, `+${n} class resource`],
    gold: [`获得 ${n} 金币`, `gain ${n} gold`], ration: pct ? [`${n}% 几率获得 1 份口粮`, `${n}% chance to find a ration`] : [`获得 ${n} 份口粮`, `gain ${n} ration(s)`],
    ac: [`AC +${n}`, `AC +${n}`], luck: [`所有 d20 +${n}`, `+${n} to every d20`], maxhp: [`最大生命 +${n}`, `+${n} max HP`],
    fatigue: it.trig === "use" ? ["清除全部疲劳", "clear all fatigue"] : [`疲劳 -${n}`, `fatigue -${n}`], xp: [`获得 ${n} 经验`, `gain ${n} XP`],
  }[it.eff] || ["", ""];
  return `${T2(api, TRIG_NAME[it.trig] || TRIG_NAME.passive)}：${T2(api, e)}${it.kind === "consumable" ? L(api, `（剩 ${it.charges} 次）`, ` (${it.charges} left)`) : ""}`;
}
function heldItems(api) { return get(api, "items") || []; }
function activeItems(api) { return heldItems(api).filter((x) => x.kind !== "consumable"); }
function passiveSum(api, eff) { return activeItems(api).filter((x) => x.trig === "passive" && x.eff === eff).reduce((a, x) => a + itemAmt(api, x), 0); }
function curseCount(api, c) { return activeItems(api).filter((x) => x.curse === c).length; }
// 效果生效（ctx.battle：在战斗中）
function applyEff(api, it, n) {
  switch (it.eff) {
    case "heal": { const h = heal(api, n); if (h) pop(api, `+${h}`, "#7aff8a", false); return h ? L(api, `回复 ${h} 生命`, `healed ${h}`) : ""; }
    case "block": set(api, "hero_block", (get(api, "hero_block") || 0) + n); return L(api, `格挡 +${n}`, `+${n} block`);
    case "damage": { if (get(api, "phase") !== "battle") return ""; hitFoe(api, n, it.name); return ""; }
    case "poison": { const f = get(api, "foe"); if (!f || !f.name || f.trait === "undead") return ""; f.poison = Math.max(f.poison || 0, n); set(api, "foe", f); return L(api, `${f.name}中毒 ${n} 回合`, `${f.name} poisoned ${n} turns`); }
    case "stun": { const f = get(api, "foe"); if (!f || !f.name) return ""; f.stun = Math.max(f.stun || 0, it.trig === "use" ? n : 1); f.charged = false; set(api, "foe", f); return L(api, `${f.name}被眩晕`, `${f.name} is stunned`); }
    case "resource": resGain(api, n); return L(api, `职业资源 +${n}`, `+${n} resource`);
    case "gold": gain(api, "gold", n); return L(api, `+${n} 金币`, `+${n} gold`);
    case "ration": { const g = gain(api, "rations", n); return g ? L(api, `+${g} 口粮`, `+${g} ration`) : ""; }
    case "fatigue": { const f0 = get(api, "fatigue") || 0; set(api, "fatigue", Math.max(0, f0 - n)); return f0 ? L(api, `疲劳 -${Math.min(f0, n)}`, `fatigue -${Math.min(f0, n)}`) : ""; }
    case "xp": gainXp(api, n); return L(api, `+${n} 经验`, `+${n} XP`);
  }
  return "";
}
// 触发某个时机的所有道具 / 感悟
function fireItems(api, trig) {
  for (const it of activeItems(api)) {
    if (it.trig !== trig || it.trig === "passive") continue;
    if (get(api, "phase") === "battle" && BATTLE_EFFS.indexOf(it.eff) >= 0 && (get(api, "foe") || {}).hp <= 0) continue;
    let n = itemAmt(api, it);
    if ((it.eff === "stun" && trig !== "use") || (it.eff === "ration" && (trig === "on_mile" || trig === "on_kill"))) { if (api.random.int(1, 100) > n) continue; n = 1; }
    if (BATTLE_EFFS.indexOf(it.eff) >= 0 && get(api, "phase") !== "battle") continue;
    const msg = applyEff(api, it, n);
    if (msg) log(api, `✦ ${it.name}：${msg}`);
  }
}
// 拿到一件道具（spec → 带稀有度的实物）；栏位满了进入“取舍”阶段
function acquire(api, spec, rarity, origin) {
  if (!spec) return "";
  const it = Object.assign({}, spec, { uid: (get(api, "uid") || 0) + 1, rarity: spec.curse && spec.curse !== "none" ? RARITY_UP[rarity] : rarity, origin: origin || "" });
  set(api, "uid", it.uid);
  if (it.kind === "consumable") it.charges = it.rarity === "legendary" ? 3 : it.rarity === "rare" ? 2 : 1;
  const own = heldItems(api), same = own.filter((x) => x.kind === it.kind).length;
  const cap = it.kind === "trinket" ? MAX_TRINKETS : it.kind === "consumable" ? MAX_BAG : 999;
  codexAdd(api, it.kind === "insight" ? "insight" : "item", it.name, effText(api, it), it.desc);
  set(api, "toast", { id: it.uid + 1000 * ((get(api, "toast") || {}).n || 0), n: ((get(api, "toast") || {}).n || 0) + 1, title: it.name, rarity: T2(api, RARITY[it.rarity]), rk: it.rarity, eff: en(api, effText(api, it)), curse: it.curse !== "none" ? T2(api, CURSE_NAME[it.curse]) : "", desc: it.desc, kind: it.kind });
  if (same >= cap) { set(api, "loot", it); return L(api, `发现【${it.name}】，但栏位满了`, `found [${it.name}], but your slots are full`); }
  addItem(api, it);
  return L(api, `获得${T2(api, RARITY[it.rarity])}道具【${it.name}】：${effText(api, it)}`, `gained ${T2(api, RARITY[it.rarity])} item [${it.name}]: ${effText(api, it)}`);
}
function addItem(api, it) {
  set(api, "items", heldItems(api).concat([it]));
  if (it.trig === "passive" && it.eff === "maxhp") { api.state.inc("max_hp", itemAmt(api, it)); heal(api, itemAmt(api, it)); }
  if (it.trig === "passive" && it.eff === "resource") { const r = get(api, "res"); if (r && r.k) { r.max += itemAmt(api, it); set(api, "res", r); } }
  if (it.curse === "frail") { const cut = Math.round(get(api, "max_hp") * 0.2); api.state.inc("max_hp", -cut); set(api, "hp", Math.min(get(api, "hp"), get(api, "max_hp"))); it.cut = cut; set(api, "items", heldItems(api).map((x) => (x.uid === it.uid ? it : x))); }
}
function removeItem(api, uid) {
  const it = heldItems(api).filter((x) => x.uid === uid)[0]; if (!it) return;
  set(api, "items", heldItems(api).filter((x) => x.uid !== uid));
  if (it.trig === "passive" && it.eff === "maxhp") { api.state.inc("max_hp", -itemAmt(api, it)); set(api, "hp", Math.max(1, Math.min(get(api, "hp"), get(api, "max_hp")))); }
  if (it.trig === "passive" && it.eff === "resource") { const r = get(api, "res"); if (r && r.k) { r.max = Math.max(1, r.max - itemAmt(api, it)); r.cur = Math.min(r.cur, r.max); set(api, "res", r); } }
  if (it.curse === "frail" && it.cut) api.state.inc("max_hp", it.cut);
}
// 图鉴：跨局记录见过的 AI 造物；本局清单给界面显示
function codexAdd(api, t, name, eff, desc) {
  const made = get(api, "made") || []; if (!made.some((m) => m.n === name)) { made.push({ t, n: name, e: en(api, eff || ""), d: desc || "" }); set(api, "made", made.slice(-40)); }
  let cx = api.storage.get("codex"); if (!Array.isArray(cx)) cx = [];
  if (!cx.some((c) => c.n === name)) { cx.push({ t, n: name }); if (cx.length > 400) cx.splice(0, cx.length - 400); api.storage.set("codex", cx); }
  set(api, "codex_n", cx.length);
}

// ---- 造物池：后台提前让 AI 发明一批（道具 3、感悟 1、怪物 2），用到时直接取 ----
function pool(api) { const p = get(api, "pool"); return p && p.items ? p : { items: [], perks: [], foes: [], req: 0, born: 0 }; }
function ensurePool(api) {
  const p = pool(api);
  if (p.req && api.time - p.born < 90000) return;
  if (p.items.length >= 3 && p.foes.length >= 2 && p.perks.length >= 1) return;
  const made = (get(api, "made") || []).map((m) => m.n);
  const cx = (api.storage.get("codex") || []).slice(-25).map((c) => c.n);
  const req = api.ai.request("invent", "", { biome: biomeName(api), mile: get(api, "distance"), hero: CLASSES[get(api, "hero_class")].name[0], level: get(api, "level"),
    thread: get(api, "thread") || "（还没有）", path: PATHS[pathId(api)].n[0], made: made.join("、") || "（还没有）", codex: cx.join("、") || "（还没有）",
    need: needText(api) });
  p.req = req == null ? 0 : req; p.born = api.time; set(api, "pool", p);
}
function needText(api) {
  const n = [];
  if (get(api, "rations") <= 2) n.push("口粮快没了"); if (get(api, "hp") < get(api, "max_hp") * 0.5) n.push("伤得很重");
  if ((get(api, "fatigue") || 0) >= 6) n.push("很疲劳"); if (get(api, "gold") < 10) n.push("没钱");
  return n.join("、") || "状态还行";
}
function takeInvent(api, d) {
  const p = pool(api);
  for (const i of [1, 2, 3]) { const s = cleanSpec({ name: d[`i${i}_name`], desc: d[`i${i}_desc`], kind: d[`i${i}_kind`], trig: d[`i${i}_trig`], eff: d[`i${i}_eff`], curse: d[`i${i}_curse`] }); if (s && !p.items.some((x) => x.name === s.name)) p.items.push(s); }
  { const s = cleanSpec({ name: d.p_name, desc: d.p_desc, trig: d.p_trig, eff: d.p_eff }, true); if (s) p.perks.push(s); }
  for (const i of [1, 2]) {
    const name = clip(d[`f${i}_name`], 16); if (!name) continue;
    p.foes.push({ name, sprite: FOE_SPRITES.indexOf(d[`f${i}_sprite`]) >= 0 && d[`f${i}_sprite`] !== "warden" ? d[`f${i}_sprite`] : "bandit", tint: TINTS.indexOf(d[`f${i}_tint`]) >= 0 ? d[`f${i}_tint`] : "none",
      trait: TRAITS[d[`f${i}_trait`]] ? d[`f${i}_trait`] : "none", move: clip(d[`f${i}_move`], 12) || L(api, "绝招", "Signature"), mk: SIG_KINDS.indexOf(d[`f${i}_kind`]) >= 0 ? d[`f${i}_kind`] : "breath",
      line: clip(d[`f${i}_line`], 80), end: clip(d[`f${i}_end`], 120), desc: clip(d[`f${i}_desc`], 90) });
  }
  p.items = p.items.slice(-8); p.perks = p.perks.slice(-3); p.foes = p.foes.slice(-5);
  p.req = 0; set(api, "pool", p);
}
// 把没用上的造物还回池子
function giveBack(api, ev) {
  if (!ev) return; const p = pool(api);
  if (ev.item) p.items.unshift(ev.item); if (ev.sig) p.foes.unshift(ev.sig); if (ev.wares) for (const w of ev.wares) p.items.push(w);
  set(api, "pool", p);
}
function itemHint(spec) { return spec ? `${spec.name}（${spec.kind === "consumable" ? "消耗品" : "饰品"}，${TRIG_NAME[spec.trig][0]}：${spec.eff}${spec.curse !== "none" ? "，带诅咒" : ""}）——${spec.desc}` : "（无）"; }
function foeHint(sig) { return sig ? `${sig.name}（特性 ${sig.trait}，招牌招式「${sig.move}」）——${sig.desc}` : "（无）"; }
// 怪物的招牌招式
const SIG_TEXT = {
  breath: ["必中的猛烈一击", "an unblockable blast"], drain: ["吸取生命", "drains life"], venom: ["剧毒，让你中毒 4 里", "venom — poisons you 4 miles"], hex: ["诅咒 3 里并削弱", "hexes you 3 miles"],
  rob: ["抢走大量金币", "robs lots of gold"], frenzy: ["狂乱连击三次", "a frenzy of three strikes"], harden: ["大量格挡并回血", "hardens: big block and heal"], roar: ["怒吼：之后伤害永久 +2", "roars: +2 damage for the rest of the fight"],
};
function sigIntent(f) {
  const s = f.sig, r = dmgRange(f, 1, 0);
  switch (s.mk) {
    case "breath": return { t: "sig", lo: Math.round(r[0] * 1.3), hi: Math.round(r[1] * 1.3) };
    case "drain": return { t: "sig", lo: r[0] + 1, hi: r[1] + 1 };
    case "venom": case "hex": return { t: "sig", lo: Math.max(1, r[0] - 1), hi: Math.max(1, r[1] - 1) };
    case "rob": return { t: "sig", lo: 10 + 2 * f.threat, hi: 10 + 2 * f.threat };
    case "frenzy": return { t: "sig", lo: Math.max(1, r[0] - 2), hi: Math.max(1, r[1] - 2) };
    case "harden": return { t: "sig", lo: 4 + f.threat, hi: 4 + f.threat };
    default: return { t: "sig", lo: 0, hi: 0 };
  }
}

// ===== 战斗 =====
function resGain(api, n) { const r = get(api, "res"); if (!r || !r.k) return; r.cur = Math.max(0, Math.min(r.max, r.cur + n)); set(api, "res", r); }
// 伤害打到主角身上：先扣格挡，闪避则完全躲开
function damageHero(api, f, dmg, crit) {
  if (get(api, "evade")) {
    set(api, "evade", false); pop(api, "s", "#c8d8ff", false);
    log(api, L(api, `💨 你闪开了${f.name}的攻击！`, `💨 You evade ${f.name}'s attack!`));
    if (hasPerk(api, "riposte")) set(api, "riposte", 1);
    return 0;
  }
  let b = get(api, "hero_block") || 0; const used = Math.min(b, dmg); b -= used; dmg -= used; set(api, "hero_block", b);
  if (used) log(api, L(api, `🛡 格挡挡下 ${used} 点伤害。`, `🛡 Your guard absorbs ${used} damage.`));
  if (get(api, "hero_class") === "fighter") resGain(api, 1);
  if (dmg <= 0) { pop(api, "s", "#c8d8ff", false); return 0; }
  hurt(api, dmg); anim(api, "hhurt", 400);
  pop(api, `-${dmg}`, crit ? "#ffdd44" : "#ff5a4a", false);
  return dmg;
}
function hitRoll(api, f, bonus) { const roll = api.random.int(1, 20), total = roll + f.atk + (bonus || 0), ac = calcAc(api); return { roll, total, ac, hit: roll === 20 || (roll !== 1 && total >= ac), crit: roll === 20 }; }
// 敌人按照预告的意图行动
function enemyTurn(api) {
  let f = get(api, "foe"); reveal(api);
  const it = f.intent || { t: "attack" };
  let hurts = 0; set(api, "riposte", 0);
  if (it.t !== "sig" && f.sigCd) f.sigCd = 0;
  f.block = 0; // 上回合举起的格挡只挡你这一回合
  if (f.stun > 0) {
    f.stun -= 1; if (it.t === "smash") f.charged = false;
    log(api, L(api, `💫 ${f.name}动弹不得，这回合什么也没做。`, `💫 ${f.name} can't act this turn.`));
  } else if (it.t === "defend") {
    f.block += it.lo; log(api, L(api, `🛡 ${f.name}摆出防御姿态（格挡 ${it.lo}）。`, `🛡 ${f.name} raises its guard (block ${it.lo}).`));
  } else if (it.t === "charge") {
    f.charged = true; log(api, L(api, `⚡ ${f.name}正在蓄力——下回合会重击！`, `⚡ ${f.name} is charging up — a heavy blow is coming!`));
  } else if (it.t === "sig") {
    const s = f.sig; f.sigCd = 1;
    log(api, L(api, `✦ ${f.name}使出「${s.move}」！`, `✦ ${f.name} unleashes "${s.move}"!`));
    if (s.mk === "harden") { f.block += it.lo; const hh = Math.min(f.max_hp - f.hp, Math.round(f.max_hp * 0.2)); f.hp += hh; log(api, L(api, `${f.name}的身体变得坚硬（格挡 ${it.lo}，回复 ${hh}）。`, `${f.name} hardens (block ${it.lo}, heals ${hh}).`)); }
    else if (s.mk === "roar") { f.bonus += 2; log(api, L(api, `${f.name}的攻击变得更狠了（伤害 +2）。`, `${f.name} grows fiercer (+2 damage).`)); }
    else {
      const hits = s.mk === "frenzy" ? 3 : 1;
      for (let i = 0; i < hits; i++) {
        const h = s.mk === "breath" ? { hit: true, crit: false } : hitRoll(api, f, 1);
        if (!h.hit) { pop(api, "s", "#c8d8ff", false); log(api, L(api, `🛡 「${s.move}」落空了。`, `🛡 "${s.move}" misses.`)); continue; }
        const dmg = api.random.int(it.lo, Math.max(it.lo, it.hi));
        const taken = damageHero(api, f, s.mk === "rob" ? Math.max(1, dmgRange(f, 1, 0)[0]) : dmg, false);
        if (taken) { hurts++; log(api, L(api, `🩸 「${s.move}」造成 ${taken} 点伤害。`, `🩸 "${s.move}" deals ${taken} damage.`)); }
        if (s.mk === "drain" && taken) { f.hp = Math.min(f.max_hp, f.hp + taken); log(api, L(api, `${f.name}吸走了你的生命（回复 ${taken}）。`, `${f.name} drinks your life (+${taken}).`)); }
        if (s.mk === "venom" && taken) { addStatus(api, "poisoned", 4); log(api, L(api, "🤢 剧毒渗进伤口（中毒 4 里）。", "🤢 Venom seeps in (poisoned 4 miles).")); }
        if (s.mk === "hex") { addStatus(api, "cursed", 3); log(api, L(api, "🌀 你被诅咒了（d20 -2，3 里）。", "🌀 You are hexed (d20 -2, 3 miles).")); }
        if (s.mk === "rob") { const g = Math.min(get(api, "gold"), it.lo); if (g) { api.state.inc("gold", -g); log(api, L(api, `💰 ${f.name}抢走了 ${g} 金币！`, `💰 ${f.name} robs ${g} gold!`)); } }
        if (get(api, "hp") <= 0) break;
      }
    }
  } else if (it.t === "curse") {
    addStatus(api, "cursed", 2); log(api, L(api, `🌀 ${f.name}对你施加了诅咒（d20 -2，2 里）。`, `🌀 ${f.name} curses you (d20 -2 for 2 miles).`));
  } else {
    const hits = it.t === "double" ? 2 : 1;
    for (let i = 0; i < hits; i++) {
      const h = hitRoll(api, f, it.t === "smash" ? 2 : 0);
      if (!h.hit) { pop(api, "s", "#c8d8ff", false); log(api, L(api, `🛡 ${f.name}攻击落空（d20=${h.roll}，${h.total} 对 AC ${h.ac}）`, `🛡 ${f.name} misses (d20=${h.roll}, ${h.total} vs AC ${h.ac})`)); continue; }
      let dmg = it.t === "smash" ? d(api, f.dice * 2, f.sides) + f.bonus + 2 : it.t === "double" ? Math.max(1, d(api, f.dice, f.sides) + f.bonus - 1) : d(api, f.dice, f.sides) + f.bonus;
      if (h.crit) dmg += d(api, f.dice, f.sides);
      const taken = damageHero(api, f, dmg, h.crit); if (taken) hurts++;
      const verb = { smash: L(api, "重击", "smashes"), double: L(api, "连击", "strikes"), poison: L(api, "毒咬", "bites"), drain: L(api, "吸取", "drains"), steal: L(api, "扒窃", "swipes at") }[it.t] || L(api, "击中", "hits");
      if (taken) log(api, L(api, `🩸 ${f.name}${verb}你${h.crit ? "（暴击）" : ""}，造成 ${taken} 点伤害。`, `🩸 ${f.name} ${verb} you${h.crit ? " (critical)" : ""} for ${taken} damage.`));
      if (it.t === "poison" && taken) { addStatus(api, "poisoned", 3); log(api, L(api, "🤢 你中毒了（每里 -1d4，喝药水可解）。", "🤢 You are poisoned (-1d4 per mile; a potion cures it).")); }
      if (it.t === "drain" && taken) { f.hp = Math.min(f.max_hp, f.hp + taken); log(api, L(api, `${f.name}吸走了你的生命（回复 ${taken}）。`, `${f.name} drinks your life (heals ${taken}).`)); }
      if (it.t === "steal") { const g = Math.min(get(api, "gold"), it.lo); if (g) { api.state.inc("gold", -g); log(api, L(api, `💰 ${f.name}偷走了 ${g} 金币！`, `💰 ${f.name} steals ${g} gold!`)); } }
      if (get(api, "hp") <= 0) break;
    }
    if (it.t === "smash") f.charged = false;
  }
  // 回合结束：敌人中毒、再生
  if (f.poison > 0 && f.trait !== "undead") { const pd = 2 + Math.floor(get(api, "level") / 2); f.hp = Math.max(0, f.hp - pd); f.poison -= 1; pop(api, `-${pd}`, "#9aff6a", true); log(api, L(api, `☠ 毒素侵蚀${f.name}，${pd} 点伤害。`, `☠ Poison eats at ${f.name} for ${pd}.`)); }
  if (f.trait === "regenerating" && f.hp > 0 && f.hp < f.max_hp) { const rg = 1 + Math.floor(f.threat / 3); f.hp = Math.min(f.max_hp, f.hp + rg); log(api, L(api, `🌿 ${f.name}的伤口在愈合（+${rg}）。`, `🌿 ${f.name} regenerates (+${rg}).`)); }
  f.intent = pickIntent(api, f);
  set(api, "foe", f);
  // 受伤时触发的道具、还击：在敌人回合写回之后再结算
  if (get(api, "hp") > 0) {
    if (get(api, "riposte") && f.hp > 0) { hitFoe(api, d(api, 1, cls(api).die) + atkMod(api), L(api, "还击", "riposte")); set(api, "riposte", 0); }
    for (let i = 0; i < hurts; i++) fireItems(api, "on_hurt");
  }
  f = get(api, "foe");
  if (f.hp <= 0) { victory(api, f); return; }
  // 每回合：牧师 +1 信仰，法师（奥术涌流）+1 法力
  const r = get(api, "res"); if (r && r.k === "faith") resGain(api, 1); if (r && r.k === "mana" && hasPerk(api, "arcane_flow")) resGain(api, 1);
}
// 对敌人造成伤害：先扣敌人的格挡
function hitFoe(api, dmg, note) {
  const f = get(api, "foe"); let used = Math.min(f.block || 0, dmg); f.block -= used; dmg -= used;
  f.hp = Math.max(0, f.hp - dmg); f.opened = true; set(api, "foe", f);
  anim(api, "fhurt", 300); pop(api, String(dmg), "#ffffff", true);
  log(api, L(api, `🗡 ${note ? note + "：" : ""}对${f.name}造成 ${dmg} 点伤害${used ? `（格挡吸收 ${used}）` : ""}。`, `🗡 ${note ? note + ": " : ""}${dmg} damage to ${f.name}${used ? ` (${used} blocked)` : ""}.`));
  return f.hp <= 0;
}
function victory(api, f) {
  const xp = 20 * f.threat * (f.boss ? 3 : 1);
  const gold = Math.round((api.random.int(1, 6) + 2 * f.threat) * (has(api, "hunter_horn") ? 1.5 : 1) * (hasPerk(api, "scavenger") ? 1.5 : 1));
  gain(api, "gold", gold); api.state.inc("kills", 1);
  const parts = [L(api, `${xp} 经验`, `${xp} XP`), L(api, `${gold} 金币`, `${gold} gold`)];
  const beast = ["wolf", "drake", "spider"].indexOf((sfx(api).cur || {}).sprite) >= 0;
  if (beast && api.random.int(1, 100) <= 60) { const n = gain(api, "rations", 1); if (n) parts.push(L(api, `${n} 份口粮`, `${n} ration(s)`)); }
  if (api.random.int(1, 100) <= (hasPerk(api, "scavenger") ? 75 : 45)) { const n = 1 + Math.floor(f.threat / 5); gain(api, "iron", n); parts.push(L(api, `${n} 铁料`, `${n} iron`)); }
  if (f.boss) { gain(api, "essence", 2); gain(api, "potions", 1); parts.push(L(api, "2 魔晶、1 瓶药水", "2 essence, 1 potion")); parts.push(giveItem(api, "legendary", L(api, `${f.name}的遗物`, `${f.name}'s relic`))); }
  else if (f.sig && api.random.int(1, 100) <= 50 && pool(api).items.length) parts.push(giveItem(api, f.threat >= 6 ? "rare" : "common", f.name));
  log(api, L(api, `🏆 你击败了${f.name}！${parts.join("、")}。`, `🏆 You defeated ${f.name}! ${parts.join(", ")}.`));
  const c = get(api, "card"); if (c && c.foe_end) log(api, `✦ ${c.foe_end}`);
  set(api, "hero_block", 0); set(api, "evade", false);
  fireItems(api, "on_kill");
  endEvent(api, true);
  gainXp(api, xp);
  settle(api);
}
function gainXp(api, n) {
  api.state.inc("xp", n);
  while (get(api, "xp") >= get(api, "xp_next")) {
    api.state.inc("xp", -get(api, "xp_next"));
    const lv = get(api, "level") + 1;
    set(api, "level", lv); set(api, "xp_next", 60 * lv);
    const g = Math.max(1, d(api, 1, cls(api).hd) + abilMod(api, "con"));
    api.state.inc("max_hp", g); heal(api, g);
    let extra = "";
    if (lv % 4 === 0) { const a = abil(api); const k = cls(api).atk; a[k] = Math.min(20, a[k] + 2); set(api, "abil", a); set(api, "abilities", abilText(api)); extra = L(api, `，${ABIL_NAME[k][0]} +2`, `, ${ABIL_NAME[k][1]} +2`); }
    if (lv === 5) extra += { fighter: L(api, "，学会了额外攻击（每回合攻击两次）", ", and gained Extra Attack"), wizard: L(api, "，火焰箭变为 2d10", ", and Fire Bolt now deals 2d10"), rogue: "", cleric: "" }[get(api, "hero_class")] || "";
    const r = get(api, "res"); if (r && r.k) { r.max += lv % 2 === 0 ? 1 : 0; set(api, "res", r); }
    log(api, L(api, `⭐ 升到 ${lv} 级！最大生命 +${g}${extra}。选择一个天赋。`, `⭐ Level ${lv}! Max HP +${g}${extra}. Choose a talent.`));
    offerPerks(api);
  }
}

// ===== 面板与界面层 =====
function refresh(api) {
  set(api, "ac", calcAc(api));
  const c = caps(api), g = gear(api), st = status(api);
  set(api, "pack_text", en(api, L(api,
    `口粮 ${get(api, "rations")}/${c.rations} · 药水 ${get(api, "potions")}/${c.potions} · 金币 ${get(api, "gold")}\n铁料 ${get(api, "iron")} · 魔晶 ${get(api, "essence")}`,
    `Rations ${get(api, "rations")}/${c.rations} · Potions ${get(api, "potions")}/${c.potions} · Gold ${get(api, "gold")}\nIron ${get(api, "iron")} · Essence ${get(api, "essence")}`)));
  set(api, "gear_text", en(api, Object.keys(GEAR).map((k) => `${T2(api, GEAR[k].name)} ${k === "weapon" || k === "armor" ? "+" : "Lv"}${g[k]}`).join(" · ")));
  const rel = get(api, "relics") || [];
  set(api, "perk_text", en(api, (get(api, "perks") || []).map((k) => `${T2(api, PERKS[k].n)}：${T2(api, PERKS[k].d)}`).join("\n") || L(api, "（升级时选择）", "(choose when you level up)")));
  set(api, "relic_text", en(api, rel.length ? rel.map((r) => `${T2(api, RELICS[r])}：${L(api, RELICS[r][2], RELICS[r][3])}`).join("\n") : L(api, "（还没有）", "(none yet)")));
  const sts = Object.keys(st).filter((k) => st[k] > 0).map((k) => `${L(api, STATUS[k][0], STATUS[k][1])}${k === "exhausted" ? "" : ` ${st[k]}${L(api, "里", "mi")}`}（${L(api, STATUS[k][2], STATUS[k][3])}）`);
  if (fatiguePen(api)) sts.push(L(api, `😮‍💨 疲劳 ${get(api, "fatigue")}（d20 -${fatiguePen(api)}，扎营清除）`, `😮‍💨 Fatigue ${get(api, "fatigue")} (d20 -${fatiguePen(api)}, camp to clear)`));
  const q = get(api, "quest");
  if (q && q.due) sts.push(L(api, `📜 委托「${q.title}」：第 ${q.due} 里`, `📜 Errand "${q.title}": mile ${q.due}`));
  const nx = get(api, "next"); set(api, "next_ready", !!(nx && nx.draft));
  if (has(api, "star_chart") && nx && nx.kind) sts.push(L(api, `🗺 下一里：${KIND_NAME[nx.kind][0]}`, `🗺 Next mile: ${KIND_NAME[nx.kind][1]}`));
  set(api, "status_text", en(api, sts.length ? sts.join("\n") : L(api, "（无）", "(none)")));
  const ph = get(api, "phase"), card = get(api, "card") || {};
  let s;
  if (ph === "battle") { const f = get(api, "foe"); s = `⚔ ${f.name}${f.boss ? L(api, "（守关者）", " (Warden)") : ""}\n${L(api, "生命", "HP")} ${f.hp}/${f.max_hp} · AC ${f.ac} · ${L(api, "命中", "to hit")} ${sign(f.atk)}`; }
  else if (ph === "card" || ph === "shop") s = `${KIND_ICON[card.kind]} ${card.pending ? L(api, "前方有动静……", "Something ahead…") : card.title}`;
  else s = L(api, `前路漫漫。你身在${biomeName(api)}，第 ${get(api, "distance")} 里。`, `The road goes on. You are in the ${biomeName(api)}, mile ${get(api, "distance")}.`);
  set(api, "event_title", ph === "none" ? "" : card.title || "");
  set(api, "ui_battle", ph === "battle" ? battleUi(api) : {});
  set(api, "items_ui", heldItems(api).map((it) => ({ uid: it.uid, name: it.name, kind: it.kind, rk: it.rarity, rarity: T2(api, RARITY[it.rarity]), eff: en(api, effText(api, it)), curse: it.curse !== "none" ? T2(api, CURSE_NAME[it.curse]) : "", desc: it.desc,
    usable: it.kind === "consumable" && (BATTLE_EFFS.indexOf(it.eff) < 0 || ph === "battle") && ["battle", "none", "card"].indexOf(ph) >= 0 && !(ph === "card" && BATTLE_EFFS.indexOf(it.eff) >= 0) })));
  showUi(api);
  set(api, "situation", en(api, s));
}
// 事件卡和商店：把要显示的内容写进玩家可见的状态 ui_card，由自定义组件 ui/panel.html 显示；
// 点选项会调用 choose / trade 动作。关掉自定义组件时，侧栏“眼前”里也会列出选项，配合备用按钮使用。
function showUi(api) {
  const ph = get(api, "phase"), card = get(api, "card") || {};
  if (get(api, "hp") > 0 && ph === "perk") {
    set(api, "ui_card", enSpec(api, { mode: "card", kind: L(api, `⭐ 升到 ${get(api, "level")} 级`, `⭐ Level ${get(api, "level")}`), title: L(api, "选择一个天赋", "Choose a talent"),
      text: L(api, "你在路上学到了新的东西。选一个——之后的冒险都会用到它。", "The road has taught you something. Pick one — it stays with you for the rest of the journey."),
      items: (get(api, "perk_offer") || []).map((k) => { if (k === "ai") { const sp = pool(api).perks[0]; const it = Object.assign({ rarity: "rare" }, sp); return { id: k, icon: "scroll", text: `✦ ${sp.name}`, sub: "", tags: [{ k: "dc", t: L(api, "旅途感悟 · AI 根据你的旅程写成", "Insight · written by the AI from your journey") }, { k: "good", t: effText(api, it) }, { k: "info", t: sp.desc }] }; }
        return { id: k, icon: PERKS[k].c ? "star" : "check", text: T2(api, PERKS[k].n), sub: "", tags: [{ k: PERKS[k].c ? "dc" : "good", t: T2(api, PERKS[k].d) }] }; }), action: "pick_perk" }));
    return;
  }
  if (get(api, "hp") > 0 && ph === "loot") {
    const it = get(api, "loot");
    set(api, "ui_card", enSpec(api, { mode: "card", kind: L(api, "🎒 栏位满了", "🎒 Slots full"), title: `✦ ${it.name}`, ai: true,
      text: `${T2(api, RARITY[it.rarity])} · ${effText(api, it)}${it.curse !== "none" ? " · " + T2(api, CURSE_NAME[it.curse]) : ""}。${it.desc}`,
      items: heldItems(api).filter((x) => x.kind === it.kind).map((x) => ({ id: String(x.uid), icon: "cross", text: L(api, `丢掉【${x.name}】`, `Drop [${x.name}]`), sub: "", tags: [{ k: "bad", t: effText(api, x) }] }))
        .concat([{ id: "new", icon: "boot", text: L(api, "不要新道具", "Leave the new item"), sub: "", tags: [] }]), action: "drop_item" }));
    return;
  }
  if (get(api, "hp") > 0 && ph === "fork") {
    const cur = pathId(api);
    set(api, "ui_card", enSpec(api, { mode: "card", kind: L(api, "🧭 岔路口", "🧭 A fork in the road"), title: L(api, "接下来走哪条路？", "Which way now?"),
      text: L(api, `路在这里分成三条。选好的路会一直走到下一个岔口（第 ${(Math.floor(get(api, "distance") / 5) + 1) * 5} 里）。口粮 ${get(api, "rations")} · 生命 ${get(api, "hp")}/${get(api, "max_hp")} · 疲劳 ${get(api, "fatigue") || 0}。`,
        `The road splits three ways. Your choice holds until the next fork (mile ${(Math.floor(get(api, "distance") / 5) + 1) * 5}). Rations ${get(api, "rations")} · HP ${get(api, "hp")}/${get(api, "max_hp")} · Fatigue ${get(api, "fatigue") || 0}.`),
      items: Object.keys(PATHS).map((k) => ({ id: k, icon: PATHS[k].icon, text: T2(api, PATHS[k].n) + (k === cur ? L(api, "（当前）", " (current)") : ""), sub: "", tags: [{ k: k === "road" ? "good" : k === "wilds" ? "dc" : "bad", t: T2(api, PATHS[k].d) }] })), action: "go" }));
    return;
  }
  if (get(api, "hp") <= 0 || (ph !== "card" && ph !== "shop")) { set(api, "ui_card", { mode: "none" }); return; }
  const kind = `${KIND_ICON[card.kind]} ${T2(api, KIND_NAME[card.kind])}`;
  if (card.pending) {
    set(api, "ui_card", enSpec(api, { mode: card.stale ? "stale" : "loading", kind, title: L(api, "前方有动静……", "Something ahead…"),
      text: card.stale ? L(api, "AI 还没有回应。请检查“设置”里的 AI 服务商和 API Key，然后点重试。", "The AI hasn't answered. Check your AI provider and API key in Settings, then retry.")
        : L(api, "（AI 正在描绘这一幕……）", "(The AI is painting this scene…)"),
      items: card.stale ? [{ id: "retry", icon: "hourglass", text: L(api, "重试", "Retry"), sub: "", tags: [] }] : [], action: "choose" }));
    return;
  }
  if (ph === "shop") { set(api, "ui_card", enSpec(api, { mode: "shop", kind, title: card.title, text: card.text, items: shopItems(api), action: "trade", ai: !!card.ai })); return; }
  const items = card.options.map((o) => ({ id: o.id, icon: VERB_ICON[o.verb] || "dice", text: o.label, sub: optText(api, o, card.kind), tags: optTags(api, o, card.kind).concat(canAfford(api, o) ? [] : [{ k: "bad", t: L(api, "付不起", "can't afford") }]), disabled: !canAfford(api, o) }));
  if (card.kind === "rest") items.push({ id: "camp", icon: "fire", text: L(api, "扎营休息", "Make camp"), sub: "", tags: [{ k: "good", t: L(api, "免费 · 完全恢复 · 解除疲惫", "free · full heal · clears exhaustion") }] });
  if (get(api, "potions") > 0 && get(api, "hp") < get(api, "max_hp")) items.push({ id: "potion", icon: "potion", text: L(api, "先喝一瓶药水", "Drink a potion first"), sub: "", tags: [{ k: "info", t: L(api, "不结束这个事件", "doesn't end the event") }] });
  if (!card.boss) items.push({ id: "leave", icon: "boot", text: L(api, "离开", "Leave"), sub: "", tags: card.kind === "hazard" ? [{ k: "bad", t: L(api, "绕路：多耗 1 份口粮", "detour: 1 extra ration") }] : card.kind === "combat" ? [{ k: "dc", t: L(api, `敏捷 DC ${10 + Math.floor(card.threat / 2)} 溜走`, `DEX DC ${10 + Math.floor(card.threat / 2)} to slip away`) }, { k: "bad", t: L(api, "失败会被追上", "fail and it attacks") }] : [] });
  set(api, "ui_card", enSpec(api, { mode: "card", kind, title: card.title, text: card.text, items, action: "choose", ai: !!card.ai }));
}
// 意图的显示文字
function intentUi(api, f) {
  const it = f.intent || { t: "attack", lo: 0, hi: 0 };
  const rng = `${it.lo}–${it.hi}`;
  const m = {
    attack: ["sword", L(api, `攻击 ${rng}`, `Attack ${rng}`), "atk"], smash: ["sword", L(api, `重击 ${rng}`, `Smash ${rng}`), "big"],
    double: ["sword", L(api, `连击 2×${rng}`, `Strike twice 2×${rng}`), "atk"], poison: ["skull", L(api, `毒咬 ${dmgRange(f, 1, 0).join("–")} + 中毒`, `Venom bite ${dmgRange(f, 1, 0).join("–")} + poison`), "atk"],
    drain: ["heart", L(api, `吸血 ${rng}`, `Drain ${rng}`), "atk"], steal: ["coin", L(api, `扒窃 ${it.lo} 金币 + 伤害`, `Steal ${it.lo} gold + damage`), "atk"],
    defend: ["shield", L(api, `防御（格挡 ${it.lo}）`, `Guard (block ${it.lo})`), "def"], charge: ["hourglass", L(api, "蓄力：下回合重击！", "Charging: big hit next turn!"), "warn"],
    curse: ["cross", L(api, "施咒：d20 -2", "Hex: d20 -2"), "warn"],
    sig: f.sig ? ["star", `✦ ${f.sig.move}：${T2(api, SIG_TEXT[f.sig.mk])}${it.hi ? ` ${f.sig.mk === "rob" ? L(api, `（${it.lo} 金币）`, ` (${it.lo} gold)`) : f.sig.mk === "harden" ? L(api, `（格挡 ${it.lo}）`, ` (block ${it.lo})`) : (f.sig.mk === "frenzy" ? "3×" : "") + rng}` : ""}`, "big"] : ["sword", rng, "atk"],
  }[it.t] || ["sword", rng, "atk"];
  return { icon: m[0], text: f.stun > 0 ? L(api, "💫 眩晕中，下回合无法行动", "💫 Stunned — skips its turn") : m[1], k: f.stun > 0 ? "def" : m[2] };
}
function battleUi(api) {
  const f = get(api, "foe"), r = get(api, "res") || {}, cid = get(api, "hero_class");
  const tr = TRAITS[f.trait] || TRAITS.none;
  const skills = (SKILLS[cid] || []).map((sk) => {
    const c = skillCost(api, sk), need = c < 0 ? -c : c;
    return { id: sk.id, icon: sk.icon, text: T2(api, sk.name), sub: en(api, T2(api, sk.desc)), cost: c < 0 ? `${need}+` : String(c), disabled: (r.cur || 0) < need };
  });
  return enSpec(api, {
    foe: { name: f.name, hp: f.hp, max: f.max_hp, ac: f.ac, block: f.block || 0, stun: f.stun || 0, poison: f.poison || 0, boss: !!f.boss,
      trait: f.trait !== "none" ? tr[api.lang === "en" ? 1 : 0] : "", trait_desc: f.trait !== "none" ? (api.lang === "en" ? TRAIT_EN[f.trait] : tr[2]) : "", intent: intentUi(api, f) },
    block: get(api, "hero_block") || 0, evade: !!get(api, "evade"),
    res: r.k ? { k: r.k, name: T2(api, RES_NAME[r.k]), cur: r.cur, max: r.max } : null,
    defend: 3 + prof(get(api, "level")) + gear(api).armor + (hasPerk(api, "bulwark") ? 3 : 0),
    flee_dc: 10 + Math.floor(f.threat / 2) + (f.boss ? 3 : 0),
    skills,
  });
}
function gearCost(api, k) {
  const g = gear(api), lv = g[k], def = GEAR[k];
  return { gold: def.gold * (lv + 1), iron: def.iron * (lv + 1), essence: lv >= def.essAt ? 1 : 0, max: lv >= def.max };
}
function shopItems(api) {
  const gold = get(api, "gold"), c = caps(api);
  const items = [
    { id: "buy_ration", icon: "ration", text: L(api, `口粮 ×1`, "Ration ×1"), sub: `${priceOf(api, "ration")}g · ${get(api, "rations")}/${c.rations}`, disabled: gold < priceOf(api, "ration") || get(api, "rations") >= c.rations },
    { id: "buy_potion", icon: "potion", text: L(api, `治疗药水 ×1`, "Healing potion ×1"), sub: `${priceOf(api, "potion")}g · ${get(api, "potions")}/${c.potions}`, disabled: gold < priceOf(api, "potion") || get(api, "potions") >= c.potions },
    { id: "sell_iron", icon: "iron", text: L(api, "卖出铁料 ×1", "Sell iron ×1"), sub: `+${priceOf(api, "iron_sell")}g · ${L(api, "剩", "have")} ${get(api, "iron")}`, disabled: get(api, "iron") < 1 },
  ];
  for (const k of Object.keys(GEAR)) {
    const cost = gearCost(api, k), lv = gear(api)[k];
    const okay = !cost.max && gold >= cost.gold && get(api, "iron") >= cost.iron && get(api, "essence") >= cost.essence;
    items.push({ id: `up_${k}`, icon: "hammer", text: `${T2(api, GEAR[k].name)} ${k === "weapon" || k === "armor" ? "+" : "Lv"}${lv} → ${cost.max ? L(api, "已满", "max") : lv + 1}`,
      sub: cost.max ? "" : `${cost.gold}g · ${L(api, "铁料", "iron")} ${cost.iron}${cost.essence ? ` · ${L(api, "魔晶", "essence")} ${cost.essence}` : ""} · ${T2(api, GEAR[k].desc)}`, disabled: !okay });
  }
  const card = get(api, "card") || {};
  (card.wares || []).forEach((w, i) => { if (w.sold) return; const rk = i === 0 ? "common" : "rare", price = warePrice(api, rk);
    items.unshift({ id: `ware_${i}`, icon: w.kind === "consumable" ? "potion" : "gem", text: `✦ ${w.name}`, sub: "", tags: [{ k: "dc", t: T2(api, RARITY[rk]) }, { k: "good", t: effText(api, Object.assign({ rarity: rk, charges: rk === "rare" ? 2 : 1 }, w)) }, { k: "bad", t: `${price}g` }].concat(w.curse !== "none" ? [{ k: "bad", t: T2(api, CURSE_NAME[w.curse]) }] : []), disabled: gold < price }); });
  items.push({ id: "leave", icon: "boot", text: L(api, "告别行商", "Say goodbye"), sub: "" });
  return items;
}
function warePrice(api, rk) { return Math.round((rk === "rare" ? 45 : 22) * (1 + get(api, "distance") / 60) * (hasPerk(api, "haggler") ? 0.75 : 1)); }
function shopBuy(api, id) {
  const gold = get(api, "gold"), c = caps(api);
  if (id.indexOf("ware_") === 0) {
    const card = get(api, "card"), i = Number(id.slice(5)), w = (card.wares || [])[i]; if (!w || w.sold) return;
    const rk = i === 0 ? "common" : "rare", price = warePrice(api, rk); if (gold < price) return;
    api.state.inc("gold", -price); w.sold = true; set(api, "card", card);
    log(api, `🛒 ${acquire(api, w, rk, card.title)}`);
    if (get(api, "loot") && get(api, "loot").uid) { endEvent(api); }
    return;
  }
  if (id === "leave") { log(api, L(api, "你向行商道别。", "You bid the peddler farewell.")); endEvent(api); return; }
  if (id === "buy_ration" && gold >= priceOf(api, "ration") && get(api, "rations") < c.rations) { api.state.inc("gold", -priceOf(api, "ration")); gain(api, "rations", 1); }
  else if (id === "buy_potion" && gold >= priceOf(api, "potion") && get(api, "potions") < c.potions) { api.state.inc("gold", -priceOf(api, "potion")); gain(api, "potions", 1); }
  else if (id === "sell_iron" && get(api, "iron") > 0) { api.state.inc("iron", -1); api.state.inc("gold", priceOf(api, "iron_sell")); }
  else if (id.indexOf("up_") === 0) {
    const k = id.slice(3); if (!GEAR[k]) return;
    const cost = gearCost(api, k);
    if (cost.max || gold < cost.gold || get(api, "iron") < cost.iron || get(api, "essence") < cost.essence) return;
    api.state.inc("gold", -cost.gold); api.state.inc("iron", -cost.iron); api.state.inc("essence", -cost.essence);
    const g = gear(api); g[k] += 1; set(api, "gear", g);
    log(api, L(api, `⚒ ${GEAR[k].name[0]}强化到 ${g[k]} 级：${GEAR[k].desc[0]}。`, `⚒ ${GEAR[k].name[1]} upgraded to ${g[k]}: ${GEAR[k].desc[1]}.`));
    pop(api, "h", "#ffd890", false);
  }
}

// ===== 导出：动作与回调 =====
export function setup(api) {
  // 掷 6 个属性值（4d6 去掉最低），选职业时按职业的主次顺序分配
  const rolls = [];
  for (let i = 0; i < 6; i++) { const r = [d(api, 1, 6), d(api, 1, 6), d(api, 1, 6), d(api, 1, 6)].sort((x, y) => x - y); rolls.push(r[1] + r[2] + r[3]); }
  rolls.sort((x, y) => y - x);
  if (rolls[0] < 14) rolls[0] = 14;
  if (rolls[1] < 10) rolls[1] = 10;
  set(api, "rolls", rolls);
  set(api, "biome", "plains");
  set(api, "scene_fx", { scroll: 0, target: 0, prev: null, cur: null, fx: [], busy: false });
  set(api, "art", { time: "day", weather: "clear" });
  const best = api.storage.get("best"); if (typeof best === "number") set(api, "best", best);
  set(api, "phase", "class");
  set(api, "class_info", CLASS_IDS.map((id) => {
    const c = CLASSES[id]; const a = {}; c.order.forEach((k, i) => (a[k] = rolls[i]));
    return { id, name: T2(api, c.name), desc: en(api, T2(api, c.desc)), hp: c.base + mod(a.con), ac: c.ac + Math.min(2, mod(a.dex)),
      stats: en(api, ABIL.map((k) => `${T2(api, ABIL_NAME[k])} ${a[k]}`).join(" · ")) };
  }));
  log(api, L(api, `🎲 掷出属性值：${rolls.join("、")}。选择一个职业，属性会按职业分配。`, `🎲 Rolled ability scores: ${rolls.join(", ")}. Pick a class; scores are assigned to suit it.`));
  refresh(api);
  return true;
}
export function pick_class(api) {
  const id = String(api.params.id || "");
  if (!CLASSES[id]) api.fail(L(api, "没有这个职业。", "No such class."));
  const c = CLASSES[id], rolls = get(api, "rolls"), a = {};
  c.order.forEach((k, i) => (a[k] = rolls[i]));
  set(api, "hero_class", id); set(api, "class_name", T2(api, c.name));
  set(api, "abil", a); set(api, "abilities", abilText(api));
  const hp = c.base + mod(a.con);
  set(api, "max_hp", hp); set(api, "hp", hp);
  set(api, "res", Object.assign({}, RES[id]));
  set(api, "phase", "none");
  log(api, L(api, `🧭 你是一名${c.name[0]}。${abilText(api)}`, `🧭 You are a ${c.name[1]}. ${abilText(api)}`));
  log(api, L(api, `生命 ${hp} · AC ${calcAc(api)} · ${c.weapon[0]} 1d${c.die}${sign(atkMod(api))}`, `HP ${hp} · AC ${calcAc(api)} · ${c.weapon[1]} 1d${c.die}${sign(atkMod(api))}`));
  log(api, L(api, `技能：${SKILLS[id].map((k) => k.name[0]).join("、")}（消耗${RES_NAME[RES[id].k][0]}）`, `Skills: ${SKILLS[id].map((k) => k.name[1]).join(", ")} (cost ${RES_NAME[RES[id].k][1]})`));
  ensurePool(api);
  rollNext(api, 1, 0);
  refresh(api);
  return true;
}

// ===== 提前生成：始终比玩家多准备一里 =====
// next = { mile, kind, tier, threat, boss, biome, req, born, draft, failed }
// 掷出下一里的事件后立刻在后台请求 AI（api.ai.request，不阻塞游戏）；玩家走到时直接用写好的卡。
function rollNext(api, mile, prev) {
  if (prev == null) prev = mile - 1;
  const q = get(api, "quest");
  const cur = get(api, "biome"), path = pathId(api);
  const biome = Math.floor(mile / BIOME_EVERY) > Math.floor(prev / BIOME_EVERY) ? api.random.pick(Object.keys(BIOMES).filter((x) => x !== cur)) : cur;
  const base = Math.max(1, 1 + Math.floor(mile / 8) + Math.floor(Math.pow(mile / 35, 2)) + PATH_THREAT[path]);
  let ev;
  if (mile % BOSS_EVERY === 0) ev = { kind: "combat", tier: mile === BOSS_EVERY ? 1 : 2, boss: true };
  else if (q && q.due && mile >= q.due) ev = { kind: "quest", tier: 1, boss: false };
  else {
    const w = Object.assign({}, BASE_WEIGHT); const adj = BIOME_WEIGHT[biome] || {}, padj = PATH_WEIGHT[path] || {};
    for (const k in adj) w[k] = Math.max(1, (w[k] || 0) + adj[k]);
    for (const k in padj) { w[k] = Math.max(0, (w[k] || 0) + padj[k]); if (!w[k]) delete w[k]; }
    let k = api.random.weighted(w); if (status(api).scouted && k === "combat") k = api.random.weighted(w);
    ev = { kind: k, tier: Number(api.random.weighted({ "-1": 30, "0": 50, "1": 15, "2": 5 })), boss: false };
  }
  ev.mile = mile; ev.biome = biome; ev.path = path; ev.threat = Math.max(1, base + ev.tier);
  ev.req = 0; ev.draft = null; ev.failed = false; ev.born = api.time;
  giveBack(api, get(api, "next"));               // 之前预留给下一里、但没用上的造物还回池子
  const P = pool(api);
  if (ev.kind === "combat" && (ev.boss || ev.tier >= 1 || api.random.int(1, 100) <= 35) && P.foes.length) ev.sig = P.foes.shift();
  if ((["discovery", "mystic", "quest", "encounter", "dilemma"].indexOf(ev.kind) >= 0 || ev.boss) && P.items.length) ev.item = P.items.shift();
  if (ev.kind === "trade" && P.items.length) ev.wares = P.items.splice(0, 2);
  set(api, "pool", P);
  set(api, "next", ev);
  askAi(api, "next");
}
// 发出写卡请求：which = "next"（提前写下一里）或 "card"（眼前这张还没写好）
function askAi(api, which) {
  const ev = which === "next" ? get(api, "next") : get(api, "card");
  if (!ev || !ev.kind) return;
  const tierName = ev.boss ? "boss" : ["weak", "normal", "tough", "elite"][(ev.tier || 0) + 1] || "normal";
  const q = get(api, "quest") || {};
  const req = api.ai.request("road_event", "", { mile: ev.mile, kind: ev.kind, tier: tierName, threat: ev.threat, biome: ev.biome || get(api, "biome"), boss: !!ev.boss, quest: q.title || "", hero: CLASSES[get(api, "hero_class")] ? CLASSES[get(api, "hero_class")].name[0] : "", path: PATHS[ev.path || pathId(api)].n[0], thread: get(api, "thread") || "（还没有，由你开启）", perks: (get(api, "perks") || []).map((k) => PERKS[k].n[0]).join("、") || "无",
    item: itemHint(ev.item), sig: foeHint(ev.sig), wares: (ev.wares || []).map((w) => w.name).join("、") || "（无）", inv: heldItems(api).map((x) => x.name).join("、") || "（无）" });
  if (req == null) { ev.failed = true; } else { ev.req = req; ev.born = api.time; ev.failed = false; }
  set(api, which, ev);
}
// AI 的原始输出 → 卡片草稿
function draftFrom(p, card) {
  const draft = { title: p.title, text: p.text, foe: p.foe, options: [] };
  for (const i of [1, 2, 3]) {
    const verb = p[`o${i}_verb`]; if (!verb || verb === "none") continue;
    draft.options.push({ label: p[`o${i}_label`], verb, ability: p[`o${i}_ability`], diff: p[`o${i}_diff`], reward: p[`o${i}_reward`], risk: p[`o${i}_risk`], cost: p[`o${i}_cost`], relic: p.relic, win: p[`o${i}_win`], lose: p[`o${i}_lose`] });
  }
  if (card.kind === "combat" && !draft.foe) draft.foe = card.foe;
  return draft;
}
// 把 AI 写好的内容放到眼前这张卡上（文字、选项、画面模块）
function applyDraft(api, p) {
  const card = get(api, "card");
  card.foe_line = clip(p.foe_line, 80); card.foe_end = clip(p.foe_end, 120);
  card.trait = TRAITS[p.foe_trait] && p.foe_trait !== "none" ? p.foe_trait : "";
  set(api, "card", card);
  fillCard(api, draftFrom(p, card), true);
  const th = clip(p.thread, 90);
  if (th && th !== get(api, "thread")) { set(api, "thread", th); log(api, `✦ ${L(api, "旅途主线", "The journey")}：${th}`); }
  const s = sfx(api);
  if (s.cur) {
    const allowed = card.kind === "combat" ? (card.boss ? FOE_SPRITES : FOE_SPRITES.filter((x) => x !== "warden")) : KIND_SPRITES[card.kind] || [];
    if (!card.sig && allowed.indexOf(p.sprite) >= 0) s.cur.sprite = p.sprite;
    if (!card.sig && TINTS.indexOf(p.tint) >= 0) s.cur.tint = p.tint;
    s.cur.pending = false; saveFx(api, s);
  }
  const art = get(api, "art");
  if (["day", "dusk", "night"].indexOf(p.time) >= 0) art.time = p.time;
  if (WEATHER.indexOf(p.weather) >= 0) art.weather = p.weather;
  set(api, "art", art);
}

export function walk_rules(api) {
  if (get(api, "phase") !== "none") api.fail(L(api, "先处理眼前的事。", "Deal with what's in front of you first."));
  const from = get(api, "distance"), dist = nextMile(api, from);
  const path = pathId(api);
  set(api, "distance", dist); set(api, "camped", false);
  if (dist > get(api, "best")) { set(api, "best", dist); api.storage.set("best", dist); }
  { const s = sfx(api); s.scroll = Math.max(s.scroll, s.target); s.target = s.scroll + MILE_PX; if (s.cur) { s.prev = s.cur; s.cur = null; } saveFx(api, s); }
  // 预先准备好的这一里（没有就现场掷）
  let ev = get(api, "next");
  if (!ev || ev.mile !== dist || ev.path !== path) { rollNext(api, dist, from); ev = get(api, "next"); }
  const q = get(api, "quest");
  if (ev.kind === "quest" && !(q && q.due)) { rollNext(api, dist, from); ev = get(api, "next"); } // 委托已经放弃了
  if (ev.biome !== get(api, "biome")) {
    set(api, "biome", ev.biome); set(api, "art", { time: get(api, "art").time, weather: BIOME_WEATHER[ev.biome] });
    log(api, L(api, `🗺 道路把你带进了${biomeName(api)}。`, `🗺 The road leads you into the ${biomeName(api)}.`));
  }
  { const art = get(api, "art"); art.time = ["day", "day", "dusk", "night"][Math.floor(dist / 3) % 4]; set(api, "art", art); }
  log(api, L(api, `—— 第 ${dist} 里 · ${biomeName(api)} · ${PATHS[path].n[0]} ——`, `—— Mile ${dist} · ${biomeName(api)} · ${PATHS[path].n[1]} ——`));
  // 疲劳
  const fat = (get(api, "fatigue") || 0) + (path === "shortcut" ? 2 : 1); set(api, "fatigue", fat);
  const fp = fatiguePen(api);
  if (fp >= 3) { const dmg = d(api, 1, 4); hurt(api, dmg); log(api, L(api, `😫 你累得眼前发黑（疲劳 ${fat}），失去 ${dmg} 生命。该扎营了！`, `😫 You're utterly spent (fatigue ${fat}) and lose ${dmg} HP. Make camp!`)); }
  else if (fp && (fat === 6 || fat === 9 || fat === 7 && path === "shortcut" || fat === 10 && path === "shortcut")) log(api, L(api, `😮‍💨 你越来越累了（疲劳 ${fat}：d20 -${fp}）。扎营可以清除疲劳。`, `😮‍💨 You're getting tired (fatigue ${fat}: d20 -${fp}). Camping clears it.`));
  // 口粮
  if (get(api, "rations") > 0) { if (has(api, "traveler_boots") && api.random.int(1, 100) <= 25) log(api, L(api, "👢 旅人靴：这一里没耗口粮。", "👢 Traveler's boots: no ration needed this mile.")); else api.state.inc("rations", -1); }
  else { const dmg = d(api, 1, 4) + Math.floor(dist / 25); hurt(api, dmg); log(api, L(api, `🍖 口粮吃完了，饥饿让你失去 ${dmg} 生命。`, `🍖 Out of rations — hunger costs you ${dmg} HP.`)); }
  // 采集：平原、森林、丘陵有时能在路边找到吃的
  const forage = path === "road" ? 0 : (["plains", "forest"].indexOf(get(api, "biome")) >= 0 || hasPerk(api, "forager") ? 12 : 0) + (path === "wilds" ? 15 : 0) + (hasPerk(api, "forager") ? 15 : 0);
  if (api.random.int(1, 100) <= forage && gain(api, "rations", 1)) log(api, L(api, "🫐 路边采到一些浆果和蘑菇（+1 口粮）。", "🫐 You forage berries and mushrooms by the road (+1 ration)."));
  // 道具：每里触发、诅咒
  fireItems(api, "on_mile");
  for (let i = 0; i < curseCount(api, "weary"); i++) if (api.random.int(1, 2) === 1) api.state.inc("fatigue", 1);
  for (let i = 0; i < curseCount(api, "hungry"); i++) if (api.random.int(1, 4) === 1 && get(api, "rations") > 0) { api.state.inc("rations", -1); log(api, L(api, "✦ 诅咒让你饿得更快（多吃了 1 份口粮）。", "✦ A curse gnaws at you (an extra ration eaten).")); }
  // 状态效果
  const st = status(api);
  if (st.poisoned) { const dmg = d(api, 1, 4); hurt(api, dmg); log(api, L(api, `🤢 毒性发作，失去 ${dmg} 生命。`, `🤢 Poison burns: -${dmg} HP.`)); }
  for (const k of Object.keys(st)) if (k !== "exhausted" && st[k] > 0) st[k] -= 1;
  set(api, "status", st);
  if (get(api, "hp") <= 0) { refresh(api); return { died: true }; }
  if (ev.boss && q && q.due === dist) { q.due += 1; set(api, "quest", q); }
  // 生成这一里的卡：写好了就直接用，还在写就等它，失败了就重新请求
  spawn(api, ev.kind, ev.tier, ev.boss, ev.threat);
  const card = get(api, "card"); card.mile = dist; card.biome = ev.biome; card.tier = ev.tier;
  card.item = ev.item || null; card.wares = ev.wares || null; card.sig = ev.sig || null;
  if (card.sig) { card.foe = card.sig.name; card.title = card.sig.name; const sx = sfx(api); if (sx.cur) { if (!card.boss) sx.cur.sprite = card.sig.sprite; sx.cur.tint = card.sig.tint; saveFx(api, sx); } }
  set(api, "next", {});  // 这一里的预留已经交给卡片
  if (ev.draft) { set(api, "card", card); applyDraft(api, ev.draft); }
  else if (ev.req && !ev.failed) { card.req = ev.req; card.born = ev.born; set(api, "card", card); }
  else { set(api, "card", card); askAi(api, "card"); }
  // 马上开始准备下一里
  rollNext(api, nextMile(api, dist), dist);
  ensurePool(api);
  refresh(api);
  return { kind: get(api, "event_kind") };
}

// 后台 AI 写好了（realtime.on_ai）：可能是眼前这张卡，也可能是提前写的下一里
export function on_ai(api) {
  const p = api.params, data = p.data;
  const card = get(api, "card"), next = get(api, "next");
  const ok = !p.error && data && typeof data === "object";
  const P = pool(api);
  if (P.req && P.req === p.request) { if (ok) takeInvent(api, data); else { P.req = 0; set(api, "pool", P); } refresh(api); return; }
  if (card && card.pending && card.req === p.request && (get(api, "phase") === "card")) {
    if (ok) applyDraft(api, data);
    else { card.stale = true; set(api, "card", card); log(api, L(api, `AI 没能写出这张卡：${p.error || "格式不对"}`, `The AI couldn't write this card: ${p.error || "bad format"}`)); }
  } else if (next && next.req === p.request) {
    if (ok) next.draft = data; else next.failed = true;
    next.req = 0; set(api, "next", next);
  }
  refresh(api);
}

// 事件卡上的选择（自定义组件或备用按钮调用）
export function choose(api) {
  const id = String(api.params.id || "");
  const c = get(api, "card");
  if (id === "retry") { if (c && c.pending) { c.stale = false; set(api, "card", c); askAi(api, "card"); } }
  else if (c && c.pending) api.fail(L(api, "AI 还在描绘这一幕，请稍等。", "The AI is still painting this scene — please wait."));
  else chooseOption(api, id);
  refresh(api);
  return true;
}
// 窗口尺寸（realtime.on_resize）：界面组件据此铺满整个窗口
export function on_resize(api) { const p = api.params; set(api, "screen", { w: Math.round(p.width || 0), h: Math.round(p.height || 0) }); }

// 商店里的购买 / 强化
export function trade(api) { shopBuy(api, String(api.params.id || "")); refresh(api); return true; }
// 定时检查：眼前的卡太久没写好就提示重试；提前写的请求丢了（比如读档后）就重发
export function watch(api) {
  const card = get(api, "card"), next = get(api, "next");
  if (card && card.pending && !card.stale && get(api, "phase") === "card" && api.time - card.born >= AI_STALE_MS) { card.stale = true; set(api, "card", card); refresh(api); }
  if (next && next.kind && !next.draft && (next.failed || (next.req && api.time - next.born >= AI_STALE_MS * 2))) askAi(api, "next");
  if (get(api, "phase") !== "class" && get(api, "hp") > 0) ensurePool(api);
}

// 一次武器攻击（技能也用）：extra 额外伤害骰 [n, sides]，auto 必中
function strike(api, o) {
  o = o || {};
  const lv = get(api, "level"), g = gear(api), c = cls(api), id = get(api, "hero_class");
  const f = get(api, "foe"); const r = d20(api); const total = r.nat + atkMod(api) + prof(lv) + g.weapon + r.bonus;
  const missile = id === "wizard" && !f.opened && !o.skill;  // 法师：每场战斗第一发魔法飞弹必中
  const critOn = hasPerk(api, "keen") ? 19 : 20;
  if (!o.auto && !missile && (r.nat === 1 || (r.nat < critOn && total < f.ac))) {
    f.opened = true; set(api, "foe", f); pop(api, "x", "#e8e8e8", true);
    log(api, L(api, `🗡 ${o.name ? o.name + "：" : ""}落空（d20=${r.nat}，${total} 对 AC ${f.ac}）`, `🗡 ${o.name ? o.name + ": " : ""}miss (d20=${r.nat}, ${total} vs AC ${f.ac})`));
    return { hit: false };
  }
  const crit = !o.auto && r.nat >= critOn;
  const notes = [];
  let dmg;
  if (o.raw != null) dmg = o.raw;
  else {
    const n = (o.dice || ((lv >= 5 && c.dice5) ? c.dice5 : 1)) * (crit ? 2 : 1);
    dmg = d(api, n, lv >= 5 ? c.die5 : c.die) + atkMod(api) + g.weapon;
    if (missile) notes.push(L(api, "魔法飞弹必中", "Magic Missile never misses"));
    if (id === "rogue" && !f.opened) { const sn = d(api, 1 + Math.floor(lv / 2), 6); dmg += sn; notes.push(L(api, `偷袭 +${sn}`, `Sneak Attack +${sn}`)); }
    if (id === "cleric" && f.trait === "undead" || id === "cleric" && ["skeleton", "wisp"].indexOf((sfx(api).cur || {}).sprite) >= 0) { const hv = d(api, 1, 8); dmg += hv; notes.push(L(api, `圣光 +${hv}`, `radiant +${hv}`)); }
  }
  if (o.extra) { const ex = d(api, o.extra[0] * (crit ? 2 : 1), o.extra[1]); dmg += ex; }
  dmg = Math.max(1, dmg);
  if (crit) notes.unshift(L(api, "暴击", "critical"));
  const killed = hitFoe(api, dmg, (o.name || T2(api, c.weapon)) + (notes.length ? `（${notes.join("，")}）` : ""));
  if (crit) pop(api, "!", "#ffdd44", true);
  if (has(api, "vampiric_blade")) heal(api, 2);
  if (id === "fighter") resGain(api, 1);
  if (id === "rogue") resGain(api, crit ? 2 : 1);
  if (!killed) fireItems(api, "on_hit");
  return { hit: true, crit, dmg, killed: killed || get(api, "foe").hp <= 0 };
}
// 玩家回合开始：上回合的格挡、闪避作废
function turnStart(api) { set(api, "hero_block", 0); set(api, "evade", false); reveal(api); }
// 玩家回合结束：敌人死了就胜利，否则轮到敌人
function turnEnd(api) {
  const f = get(api, "foe");
  if (f.hp <= 0) { victory(api, f); refresh(api); return { won: true }; }
  enemyTurn(api); refresh(api); return { won: false };
}
export function attack(api) {
  turnStart(api);
  const lv = get(api, "level"), id = get(api, "hero_class");
  anim(api, "atk", id === "wizard" ? 450 : 300);
  const swings = id === "fighter" && lv >= 5 ? 2 : 1;
  for (let i = 0; i < swings; i++) { const r = strike(api); if (r.killed) break; }
  return turnEnd(api);
}
export function defend(api) {
  turnStart(api);
  const b = 3 + prof(get(api, "level")) + gear(api).armor + (hasPerk(api, "bulwark") ? 3 : 0);
  set(api, "hero_block", b);
  if (get(api, "hero_class") === "fighter") resGain(api, 1);
  log(api, L(api, `🛡 你举起防御（格挡 ${b}，挡到你下次行动）。`, `🛡 You raise your guard (block ${b} until your next action).`));
  return turnEnd(api);
}
function skillCost(api, sk) {
  if (sk.id === "cleave" && hasPerk(api, "fury")) return 2;
  return sk.cost;
}
export function skill(api) {
  const id = String(api.params.id || ""), cid = get(api, "hero_class");
  const sk = (SKILLS[cid] || []).filter((x) => x.id === id)[0];
  if (!sk) api.fail(L(api, "没有这个技能。", "No such skill."));
  const r = get(api, "res"), cost = skillCost(api, sk);
  const need = cost < 0 ? -cost : cost;
  if (!r || r.cur < need) api.fail(L(api, `${T2(api, RES_NAME[r.k])}不够。`, `Not enough ${T2(api, RES_NAME[r.k])}.`));
  turnStart(api);
  const spent = cost < 0 ? r.cur : cost;
  r.cur -= spent; set(api, "res", r);
  const name = T2(api, sk.name), lv = get(api, "level"), f = get(api, "foe");
  log(api, `✧ ${name}${L(api, "！", "!")}`);
  anim(api, "atk", 400);
  switch (id) {
    case "bash": { const h = strike(api, { name, raw: d(api, 1, 6) + abilMod(api, "str") + gear(api).weapon }); if (h.hit && !h.killed) { const ff = get(api, "foe"); ff.stun = Math.max(ff.stun, 1); ff.charged = false; set(api, "foe", ff); log(api, L(api, `💫 ${ff.name}被打晕了！`, `💫 ${ff.name} is stunned!`)); } break; }
    case "cleave": strike(api, { name, auto: true, dice: 2 }); break;
    case "cry": { const h = heal(api, Math.ceil(get(api, "max_hp") * 0.25)); set(api, "hero_block", 5 + lv); pop(api, `+${h}`, "#7aff8a", false); log(api, L(api, `📣 你怒吼一声，恢复 ${h} 生命，格挡 ${5 + lv}。`, `📣 You roar, healing ${h} HP with block ${5 + lv}.`)); break; }
    case "evade": set(api, "evade", true); log(api, L(api, "💨 你压低身形，准备闪开下一击。", "💨 You crouch low, ready to dodge the next blow.")); break;
    case "venom": { const h = strike(api, { name }); if (h.hit && !h.killed) { const ff = get(api, "foe"); if (ff.trait === "undead") log(api, L(api, "亡灵不怕毒。", "The undead shrug off poison.")); else { ff.poison = hasPerk(api, "venomist") ? 5 : 3; set(api, "foe", ff); log(api, L(api, `☠ ${ff.name}中毒了（${ff.poison} 回合）。`, `☠ ${ff.name} is poisoned (${ff.poison} turns).`)); } } break; }
    case "evis": { let dm = abilMod(api, "dex") + gear(api).weapon; for (let i = 0; i < spent; i++) dm += d(api, 1, 6) + 1 + (hasPerk(api, "venomist") ? 2 : 0); strike(api, { name: `${name} ×${spent}`, auto: true, raw: dm }); break; }
    case "ward": { const b = 5 + 2 * prof(lv); set(api, "hero_block", b); log(api, L(api, `🔷 一层力场护住了你（格挡 ${b}）。`, `🔷 A shimmering field protects you (block ${b}).`)); break; }
    case "frost": { const h = strike(api, { name, auto: true, raw: d(api, 1, 8) + abilMod(api, "int") }); if (!h.killed) { const ff = get(api, "foe"); ff.stun = Math.max(ff.stun, 1); ff.charged = false; set(api, "foe", ff); log(api, L(api, `❄ ${ff.name}被冻住了！`, `❄ ${ff.name} is frozen!`)); } break; }
    case "fireball": strike(api, { name, auto: true, raw: d(api, 3 + Math.floor(lv / 3) + (hasPerk(api, "evocation") ? 2 : 0), 6) + abilMod(api, "int") }); break;
    case "cure": { const h = heal(api, (d(api, 1, 8) + abilMod(api, "wis") + lv) * (hasPerk(api, "devotion") ? 1.5 : 1)); pop(api, `+${h}`, "#7aff8a", false); log(api, L(api, `✚ 圣光愈合了你的伤口（+${h}）。`, `✚ Holy light mends your wounds (+${h}).`)); break; }
    case "smite": { const holy = f.trait === "undead" || ["skeleton", "wisp"].indexOf((sfx(api).cur || {}).sprite) >= 0; strike(api, { name, extra: [holy ? 4 : 2, 8] }); break; }
    case "sanct": { const b = 8 + 2 * lv; set(api, "hero_block", b); const st = status(api); if (st.poisoned) { st.poisoned = 0; set(api, "status", st); } log(api, L(api, `✨ 圣域笼罩着你（格挡 ${b}，解除中毒）。`, `✨ A sanctuary surrounds you (block ${b}, poison cured).`)); break; }
  }
  return turnEnd(api);
}
// 升级天赋
export function pick_perk(api) {
  const id = String(api.params.id || ""), offer = get(api, "perk_offer") || [];
  if (offer.indexOf(id) < 0) api.fail(L(api, "没有这个天赋。", "No such talent."));
  if (id === "ai") {
    const P = pool(api), spec = P.perks.shift(); set(api, "pool", P); set(api, "perk_offer", []);
    if (spec) log(api, `🌟 ${L(api, "旅途感悟", "Insight")}：${acquire(api, spec, "rare", L(api, "感悟", "insight"))}`);
    if (get(api, "perk_queue") > 0) { api.state.inc("perk_queue", -1); offerPerks(api); }
    settle(api); refresh(api); return true;
  }
  set(api, "perks", (get(api, "perks") || []).concat([id])); set(api, "perk_offer", []);
  const P = PERKS[id];
  if (id === "toughness") { api.state.inc("max_hp", 6); heal(api, 6); }
  if (id === "fury" || id === "evocation") { const r = get(api, "res"); r.max += id === "fury" ? 2 : 1; if (r.k === "mana") r.cur += 1; set(api, "res", r); }
  log(api, L(api, `🌟 学会天赋【${P.n[0]}】：${P.d[0]}。`, `🌟 New talent [${P.n[1]}]: ${P.d[1]}.`));
  if (get(api, "perk_queue") > 0) { api.state.inc("perk_queue", -1); offerPerks(api); }
  settle(api); refresh(api); return true;
}
// 使用消耗品（战斗中算一个回合）
export function use_item(api) {
  const uid = Number(api.params.id), it = heldItems(api).filter((x) => x.uid === uid && x.kind === "consumable")[0];
  if (!it) api.fail(L(api, "没有这件道具。", "No such item."));
  const battle = get(api, "phase") === "battle";
  if (BATTLE_EFFS.indexOf(it.eff) >= 0 && !battle) api.fail(L(api, "这件道具只能在战斗中用。", "That item only works in battle."));
  if (battle) turnStart(api);
  const n = itemAmt(api, it);
  const msg = it.eff === "fatigue" ? (set(api, "fatigue", 0), L(api, "疲劳全消", "fatigue cleared")) : applyEff(api, it, n);
  log(api, `✦ ${L(api, "使用", "Used")}【${it.name}】${msg ? "：" + msg : ""}`);
  it.charges -= 1;
  set(api, "items", heldItems(api).map((x) => (x.uid === uid ? it : x)).filter((x) => x.kind !== "consumable" || x.charges > 0));
  if (battle) return turnEnd(api);
  refresh(api); return true;
}
// 栏位满了：丢掉一件旧的，或放弃新的
export function drop_item(api) {
  const id = String(api.params.id || ""), it = get(api, "loot");
  if (!it || !it.uid) api.fail(L(api, "没有要取舍的道具。", "Nothing to choose."));
  if (id === "new") log(api, L(api, `你把【${it.name}】留在了路边。`, `You leave [${it.name}] by the road.`));
  else { const old = heldItems(api).filter((x) => String(x.uid) === id)[0]; if (!old) api.fail(L(api, "没有这件道具。", "No such item.")); removeItem(api, old.uid); addItem(api, it); log(api, L(api, `你丢下【${old.name}】，换上了【${it.name}】：${effText(api, it)}。`, `You drop [${old.name}] for [${it.name}]: ${effText(api, it)}.`)); }
  set(api, "loot", {}); settle(api); refresh(api); return true;
}
// 岔路
export function go(api) {
  const id = String(api.params.id || "");
  if (!PATHS[id]) api.fail(L(api, "没有这条路。", "No such path."));
  set(api, "path", id);
  const dist = get(api, "distance");
  set(api, "fork_at", (Math.floor(dist / 5) + 1) * 5);
  log(api, L(api, `🧭 你选择了${PATHS[id].n[0]}：${PATHS[id].d[0]}。`, `🧭 You take the ${PATHS[id].n[1]}: ${PATHS[id].d[1]}.`));
  rollNext(api, nextMile(api, dist), dist);   // 路变了，重新准备下一里
  settle(api); refresh(api); return true;
}
// 走一步到哪一里：捷径一步 2 里，但不会跳过守关者
function nextMile(api, dist) {
  const step = pathId(api) === "shortcut" ? 2 : 1;
  const boss = Math.ceil((dist + 1) / BOSS_EVERY) * BOSS_EVERY;
  return Math.min(dist + step, boss);
}

export function flee(api) {
  turnStart(api);
  const f = get(api, "foe");
  const dc = 10 + Math.floor(f.threat / 2) + (f.boss ? 3 : 0);
  const r = d20(api), total = r.nat + abilMod(api, "dex") + prof(get(api, "level")) + checkBonus(api, "dex") + (get(api, "hero_class") === "rogue" ? 2 : 0) + r.bonus;
  if (r.nat === 20 || (r.nat !== 1 && total >= dc)) {
    log(api, L(api, `🏃 敏捷检定 ${total} 对 DC ${dc}：你甩掉了${f.name}。`, `🏃 DEX check ${total} vs DC ${dc}: you shake off ${f.name}.`));
    endEvent(api); refresh(api); return { fled: true };
  }
  log(api, L(api, `🏃 敏捷检定 ${total} 对 DC ${dc}：没能逃掉！`, `🏃 DEX check ${total} vs DC ${dc}: you fail to escape!`));
  enemyTurn(api); refresh(api);
  return { fled: false };
}

export function potion(api) {
  const amt = Math.round((d(api, 2, 4) + 2 + Math.floor(get(api, "max_hp") / 5)) * (has(api, "alchemist_flask") ? 1.5 : 1) * (get(api, "hero_class") === "cleric" ? 1.5 : 1));
  const h = heal(api, amt);
  api.state.inc("potions", -1);
  const st = status(api); let cure = "";
  if (st.poisoned) { st.poisoned = 0; set(api, "status", st); cure = L(api, "，解了毒", ", and cures the poison"); }
  pop(api, `+${h}`, "#7aff8a", false);
  log(api, L(api, `🧪 你喝下治疗药水，恢复 ${h} 生命${cure}。`, `🧪 You drink a healing potion and recover ${h} HP${cure}.`));
  if (get(api, "phase") === "battle") { turnStart(api); return Object.assign(turnEnd(api), { healed: h }); }
  refresh(api);
  return { healed: h };
}

function campHere(api, safe) {
  set(api, "camped", true); set(api, "fatigue", 0);
  fireItems(api, "on_camp");
  const st = status(api); if (st.exhausted) { st.exhausted = 0; set(api, "status", st); }
  { const r = get(api, "res"); if (r && r.k === "mana" && r.cur < r.max) { r.cur = r.max; set(api, "res", r); log(api, L(api, "🔮 冥想让法力恢复满了。", "🔮 Meditation restores your Mana.")); } }
  if (safe) {
    const h = heal(api, get(api, "max_hp"));
    const r = gain(api, "rations", 1);
    log(api, L(api, `🔥 你在安全的地方睡了个好觉，恢复 ${h} 生命${r ? "，还找到了 1 份存粮" : ""}。`, `🔥 You sleep soundly in safety and recover ${h} HP${r ? ", and find 1 stored ration" : ""}.`));
    endEvent(api); return { healed: h };
  }
  const kit = gear(api).kit;
  api.state.inc("rations", -1);
  const h = heal(api, Math.ceil(get(api, "max_hp") * Math.min(1, KIT_HEAL[kit] * (get(api, "hero_class") === "cleric" ? 1.5 : 1))));
  log(api, L(api, `🔥 你在路边扎营，吃掉 1 份口粮，恢复 ${h} 生命。`, `🔥 You make camp by the road, eat 1 ration and recover ${h} HP.`));
  if (api.random.int(1, 100) <= KIT_AMBUSH[kit]) {
    log(api, L(api, "夜里有动静……", "Something stirs in the night…"));
    spawn(api, "combat", 0, false);
    const card = get(api, "card"); card.pending = false; card.title = card.foe; set(api, "card", card);
    startBattle(api, card.foe, false);
    return { healed: h, ambush: true };
  }
  return { healed: h };
}
export function camp_rules(api) { const r = campHere(api, false); refresh(api); return r; }
