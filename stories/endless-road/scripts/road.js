// 无尽之路 / The Endless Road — 规则脚本
// 简化版 D&D 5e：属性 4d6 去最低、熟练加值、d20 检定对 DC/AC、伤害骰、升级。
// 规则（掷骰、数值、奖励多少）全部在这里；AI 只负责给遭遇起名字、写描述、挑检定属性和奖励类型。

const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_NAME = {
  str: ["力量", "STR"], dex: ["敏捷", "DEX"], con: ["体质", "CON"],
  int: ["智力", "INT"], wis: ["感知", "WIS"], cha: ["魅力", "CHA"],
};
const BIOMES = {
  plains: ["风语平原", "Whispering Plains"],
  forest: ["幽暗森林", "Gloomwood"],
  hills: ["古冢丘陵", "Barrow Hills"],
  swamp: ["腐沼泽地", "Rotfen Marsh"],
  mountains: ["霜脊山道", "Frostspine Pass"],
  ashlands: ["余烬荒原", "Emberwaste"],
};
// 没有 AI 时用的内置名字（每个地区几种敌人）
// [中文名, 英文名, 精灵, 染色]
const FOES = {
  plains: [["游荡的豺狼", "A prowling jackal", "wolf", "gold"], ["拦路的强盗", "A highway bandit", "bandit", "none"], ["地精斥候", "A goblin scout", "bandit", "green"], ["草原软泥", "A meadow ooze", "ooze", "none"]],
  forest: [["灰鬃狼", "A grey-maned wolf", "wolf", "none"], ["巨型蜘蛛", "A giant spider", "spider", "none"], ["狗头人伏兵", "A kobold ambusher", "bandit", "red"], ["林间鬼火", "A forest wisp", "wisp", "green"]],
  hills: [["游荡的骷髅", "A wandering skeleton", "skeleton", "none"], ["古冢尸妖", "A barrow wight", "skeleton", "blue"], ["丘陵巨魔", "A hill troll", "troll", "none"], ["墓地幽魂", "A grave wisp", "wisp", "purple"]],
  swamp: [["沼泽鳄蜥", "A marsh drake", "drake", "green"], ["腐泥怪", "A rot ooze", "ooze", "shadow"], ["沼泽蜘蛛", "A bog spider", "spider", "green"], ["蜥蜴人猎手", "A lizardfolk hunter", "bandit", "green"]],
  mountains: [["雪原巨魔", "A frost troll", "troll", "blue"], ["冰霜元素", "An ice elemental", "wisp", "blue"], ["雪狼", "A snow wolf", "wolf", "pale"], ["矮人逃兵", "A dwarven deserter", "bandit", "blue"]],
  ashlands: [["火焰蜥龙", "A fire drake", "drake", "none"], ["焦骨食尸鬼", "A charred ghoul", "skeleton", "red"], ["熔岩犬", "A hellhound", "wolf", "red"], ["火焰元素", "A fire elemental", "wisp", "red"]],
};
// 画面模块（AI 只能在这些里面挑）
const FOE_SPRITES = ["wolf", "spider", "bandit", "skeleton", "troll", "drake", "ooze", "wisp", "warden"];
const KIND_SPRITES = { hazard: ["chasm", "rocks", "thorns"], treasure: ["chest"], social: ["stranger", "bandit"], merchant: ["cart"], shrine: ["shrine"], rest: ["campfire"] };
const TINTS = ["none", "red", "green", "blue", "gold", "shadow", "pale", "purple"];
const WEATHER = ["clear", "rain", "snow", "fog", "embers", "fireflies", "leaves"];
const BIOME_WEATHER = { plains: "clear", forest: "leaves", hills: "clear", swamp: "fog", mountains: "snow", ashlands: "embers" };
const SUBJECT_X = 176, HERO_X = 58, MILE_PX = 160;
const KIND_ICON = { combat: "⚔", hazard: "⚠", treasure: "💰", social: "💬", merchant: "🛒", shrine: "✨", rest: "🔥" };
const KIND_NAME = {
  combat: ["敌人", "Enemy"], hazard: ["险境", "Hazard"], treasure: ["宝藏", "Treasure"], social: ["路人", "Stranger"],
  merchant: ["行商", "Merchant"], shrine: ["奇遇", "Wonder"], rest: ["营地", "Safe camp"],
};
const DEFAULT_TITLE = {
  hazard: ["断裂的小路", "A broken path"], treasure: ["半埋的箱子", "A half-buried chest"], social: ["路边的旅人", "A roadside traveler"],
  merchant: ["流浪行商", "A wandering peddler"], shrine: ["古老的祭坛", "An ancient shrine"], rest: ["避风的岩洞", "A sheltered hollow"],
};
const DEFAULT_ABIL = { hazard: "dex", treasure: "int", social: "cha", shrine: "wis" };
const PRICE = { ration: 2, potion: 15 };
const BOSS_EVERY = 25;      // 每 25 里一个守关者
const BIOME_EVERY = 10;     // 每 10 里换一个地区

// ---------- 小工具 ----------
function L(api, zh, en) { return api.lang === "en" ? en : zh; }
function T2(api, pair) { return api.lang === "en" ? pair[1] : pair[0]; }
function get(api, k) { return api.state.get(k); }
function d(api, n, sides) { let s = 0; for (let i = 0; i < n; i++) s += api.random.int(1, sides); return s; }
function mod(score) { return Math.floor((score - 10) / 2); }
function sign(n) { return n >= 0 ? "+" + n : String(n); }
function prof(level) { return 2 + Math.floor((level - 1) / 4); }
function abil(api) { return get(api, "abil"); }
function abilMod(api, a) { return mod(abil(api)[a]); }
function atkMod(api) { const a = abil(api); return Math.max(mod(a.str), mod(a.dex)); }
function heal(api, n) { const mx = get(api, "max_hp"); const hp = get(api, "hp"); const v = Math.min(mx, hp + n); api.state.set("hp", v); return v - hp; }
function hurt(api, n) { api.state.set("hp", Math.max(0, get(api, "hp") - n)); }
function threatNow(api) { const d = get(api, "distance"); return 1 + Math.floor(d / 8) + Math.floor(Math.pow(d / 35, 2)); }
function dcFor(threat, tier) { return Math.min(25, 10 + Math.floor(threat / 2) + tier); }
function biomeName(api) { return T2(api, BIOMES[get(api, "biome")]); }

function abilText(api) {
  const a = abil(api);
  return ABIL.map((k) => `${T2(api, ABIL_NAME[k])} ${a[k]}(${sign(mod(a[k]))})`).join(" · ");
}

// 敌人数值：只由威胁等级决定（AI 改不了）
function makeFoe(api, threat, name, boss) {
  const t = threat;
  return {
    name,
    hp: 3 + 4 * t + api.random.int(0, t),
    max_hp: 0,
    ac: Math.min(19, 10 + Math.floor((t + 1) / 2)),
    atk: 1 + Math.floor(t * 0.6),
    dice: 1 + Math.floor(t / 8),
    sides: t >= 6 ? 10 : t >= 4 ? 8 : t >= 2 ? 6 : 4,
    bonus: Math.floor(t / 2),
    threat: t,
    boss: !!boss,
  };
}

// ---------- 画面状态（scripts/scene.js 负责画） ----------
function sfx(api) { return api.state.get("scene_fx"); }
function saveFx(api, s) { s.busy = true; api.state.set("scene_fx", s); }
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

function refreshSituation(api) {
  const kind = get(api, "event_kind");
  let s;
  if (kind === "none") {
    s = L(api, `前路漫漫。你身在${biomeName(api)}，第 ${get(api, "distance")} 里。`, `The road goes on. You are in the ${biomeName(api)}, mile ${get(api, "distance")}.`);
  } else if (kind === "combat") {
    const f = get(api, "foe");
    s = `${KIND_ICON.combat} ${f.name}${f.boss ? L(api, "（守关者）", " (Warden)") : ""}\n${L(api, "生命", "HP")} ${f.hp}/${f.max_hp} · AC ${f.ac} · ${L(api, "命中", "to hit")} ${sign(f.atk)}`;
  } else if (kind === "merchant") {
    const w = get(api, "weapon_bonus"), ar = get(api, "armor_bonus");
    s = `${KIND_ICON.merchant} ${get(api, "event_title")}\n${L(api, "口粮", "Ration")} ${PRICE.ration}g · ${L(api, "药水", "Potion")} ${PRICE.potion}g · ${L(api, "装备升级", "Gear upgrade")} ${gearPrice(w, ar)}g`;
  } else if (kind === "rest") {
    s = `${KIND_ICON.rest} ${get(api, "event_title")}\n${L(api, "这里很安全：扎营不消耗口粮，并完全恢复。", "Safe here: camping costs no ration and fully heals you.")}`;
  } else {
    const c = get(api, "check");
    s = `${KIND_ICON[kind]} ${get(api, "event_title")}\n${L(api, "应对", "Resolve")}：${c.approach || T2(api, KIND_NAME[kind])} — ${T2(api, ABIL_NAME[c.ability])} ${L(api, "检定", "check")} DC ${c.dc}`;
  }
  api.state.set("situation", s);
}

function clearEvent(api, dying) {
  dropSubject(api, !!dying);
  api.state.set("event_kind", "none");
  api.state.set("event_title", "");
  refreshSituation(api);
}

function gearPrice(w, ar) { return 40 * (w + ar + 1); }

// 生成一个遭遇（类型、强度由规则掷出），然后发出 encounter 事件让 AI 填写内容
function spawn(api, kind, tier, boss) {
  const threat = Math.max(1, threatNow(api) + tier);
  api.state.set("event_kind", kind);
  api.state.set("threat", threat);
  api.state.set("event_tier", boss ? "boss" : ["weak", "normal", "tough", "elite"][tier + 1] || "normal");
  const s = sfx(api);
  const wx = Math.max(s.target, s.scroll) + SUBJECT_X;
  if (kind === "combat") {
    const pick = boss ? null : api.random.pick(FOES[get(api, "biome")]);
    const name = boss ? L(api, `${biomeName(api)}的守关者`, `Warden of the ${biomeName(api)}`) : T2(api, pick);
    setSubject(api, { sprite: boss ? "warden" : pick[2], tint: boss ? "none" : pick[3], scale: boss ? 2 : 1, boss: !!boss, wx, pending: true });
    const f = makeFoe(api, threat, name, boss);
    if (boss) { f.hp = Math.round(f.hp * 1.3); f.bonus += 1; }
    f.max_hp = f.hp;
    api.state.set("foe", f);
    api.state.set("event_title", name);
    api.log(`${KIND_ICON.combat} ${L(api, boss ? "守关者挡住了去路" : "遭遇敌人", boss ? "A warden blocks the road" : "Enemy encounter")}：${name}（${L(api, "威胁", "threat")} ${threat}）`);
  } else {
    const title = T2(api, DEFAULT_TITLE[kind]);
    setSubject(api, { sprite: api.random.pick(KIND_SPRITES[kind]), tint: "none", scale: 1, wx, pending: true });
    api.state.set("event_title", title);
    if (DEFAULT_ABIL[kind]) api.state.set("check", { ability: DEFAULT_ABIL[kind], dc: dcFor(threat, tier), approach: "", reward: kind === "treasure" ? "gold" : "heal", hostile: false });
    api.log(`${KIND_ICON[kind]} ${T2(api, KIND_NAME[kind])}：${title}`);
  }
  refreshSituation(api);
}

function enemyTurn(api) {
  const f = get(api, "foe");
  reveal(api);
  const roll = api.random.int(1, 20);
  const total = roll + f.atk;
  const ac = get(api, "ac");
  if (roll === 1 || (roll !== 20 && total < ac)) {
    pop(api, L(api, "闪开", "dodge"), "#c8d8ff", false);
    api.log(L(api, `🛡 ${f.name}攻击落空（d20=${roll}，${total} 对 AC ${ac}）`, `🛡 ${f.name} misses (d20=${roll}, ${total} vs AC ${ac})`));
    return;
  }
  const dmg = d(api, roll === 20 ? f.dice * 2 : f.dice, f.sides) + f.bonus;
  hurt(api, dmg);
  anim(api, "hhurt", 400);
  pop(api, `-${dmg}`, roll === 20 ? "#ffdd44" : "#ff5a4a", false);
  api.log(L(api, `🩸 ${f.name}${roll === 20 ? "暴击！" : "击中了你"}（d20=${roll}），造成 ${dmg} 点伤害。`, `🩸 ${f.name} ${roll === 20 ? "lands a CRITICAL hit" : "hits you"} (d20=${roll}) for ${dmg} damage.`));
}

function gainXp(api, n) {
  api.state.inc("xp", n);
  while (get(api, "xp") >= get(api, "xp_next")) {
    api.state.inc("xp", -get(api, "xp_next"));
    const lv = get(api, "level") + 1;
    api.state.set("level", lv);
    api.state.set("xp_next", 60 * lv);
    const gain = Math.max(1, d(api, 1, 10) + abilMod(api, "con"));
    api.state.inc("max_hp", gain);
    heal(api, gain);
    let extra = "";
    if (lv % 4 === 0) { // 4、8、12…级：属性提升 +2（加在最高的攻击属性上）
      const a = abil(api); const k = a.str >= a.dex ? "str" : "dex"; a[k] = Math.min(20, a[k] + 2);
      api.state.set("abil", a); api.state.set("abilities", abilText(api));
      extra = L(api, `，${ABIL_NAME[k][0]} +2`, `, ${ABIL_NAME[k][1]} +2`);
    }
    if (lv === 5) extra += L(api, "，学会了额外攻击（每回合攻击两次）", ", and gained Extra Attack (two attacks per turn)");
    api.log(L(api, `⭐ 升到 ${lv} 级！最大生命 +${gain}${extra}。`, `⭐ Level ${lv}! Max HP +${gain}${extra}.`));
  }
}

function giveReward(api, kind, threat) {
  if (kind === "gold") { const g = api.random.int(4, 10) + 3 * threat; api.state.inc("gold", g); return L(api, `获得 ${g} 金币`, `found ${g} gold`); }
  if (kind === "rations") { const r = api.random.int(2, 4); api.state.inc("rations", r); return L(api, `获得 ${r} 份口粮`, `got ${r} rations`); }
  if (kind === "potion") { api.state.inc("potions", 1); return L(api, "获得 1 瓶治疗药水", "got a healing potion"); }
  const h = heal(api, Math.max(4, Math.floor(get(api, "max_hp") / 2))); return L(api, `恢复了 ${h} 点生命`, `recovered ${h} HP`);
}

function upgradeGear(api) {
  const w = get(api, "weapon_bonus"), ar = get(api, "armor_bonus");
  if (w <= ar) { api.state.inc("weapon_bonus", 1); return L(api, `武器 +${w + 1}`, `weapon +${w + 1}`); }
  api.state.inc("armor_bonus", 1); api.state.inc("ac", 1); return L(api, `护甲 +${ar + 1}（AC ${get(api, "ac")}）`, `armor +${ar + 1} (AC ${get(api, "ac")})`);
}

// ---------- 动作 ----------
export function setup(api) {
  const a = {};
  for (const k of ABIL) { const r = [d(api, 1, 6), d(api, 1, 6), d(api, 1, 6), d(api, 1, 6)].sort((x, y) => x - y); a[k] = r[1] + r[2] + r[3]; }
  // 保底：至少有一项攻击属性 ≥ 14、体质 ≥ 10，免得开局就绝望
  if (Math.max(a.str, a.dex) < 14) { if (a.str >= a.dex) a.str = 14; else a.dex = 14; }
  if (a.con < 10) a.con = 10;
  api.state.set("abil", a);
  api.state.set("abilities", abilText(api));
  const hp = 14 + mod(a.con);
  api.state.set("max_hp", hp);
  api.state.set("hp", hp);
  api.state.set("ac", 12 + Math.min(2, mod(a.dex)));
  api.state.set("biome", "plains");
  api.state.set("scene_fx", { scroll: 0, target: 0, prev: null, cur: null, fx: [], busy: false });
  api.state.set("art", { time: "day", weather: "clear" });
  const best = api.storage.get("best");
  if (typeof best === "number") api.state.set("best", best);
  api.log(L(api, `🎲 掷出属性：${abilText(api)}`, `🎲 Rolled abilities: ${abilText(api)}`));
  api.log(L(api, `生命 ${hp} · AC ${get(api, "ac")} · 长剑 1d10${sign(atkMod(api))}`, `HP ${hp} · AC ${get(api, "ac")} · Longsword 1d10${sign(atkMod(api))}`));
  refreshSituation(api);
  return true;
}

export function walk_rules(api) {
  const dist = get(api, "distance") + 1;
  api.state.set("distance", dist);
  { const s = sfx(api); s.scroll = Math.max(s.scroll, s.target); s.target = s.scroll + MILE_PX; if (s.cur) { s.prev = s.cur; s.cur = null; } saveFx(api, s); }
  api.state.set("camped", false);
  if (dist > get(api, "best")) { api.state.set("best", dist); api.storage.set("best", dist); }
  // 换地区
  if (dist % BIOME_EVERY === 0) {
    const cur = get(api, "biome");
    const next = api.random.pick(Object.keys(BIOMES).filter((b) => b !== cur));
    api.state.set("biome", next);
    api.state.set("art", { time: get(api, "art").time, weather: BIOME_WEATHER[next] });
    api.log(L(api, `🗺 道路把你带进了${biomeName(api)}。`, `🗺 The road leads you into the ${biomeName(api)}.`));
  }
  { const art = get(api, "art"); art.time = ["day", "day", "dusk", "night"][Math.floor(dist / 3) % 4]; api.state.set("art", art); }
  api.log(L(api, `—— 第 ${dist} 里 · ${biomeName(api)} ——`, `—— Mile ${dist} · ${biomeName(api)} ——`));
  // 口粮
  if (get(api, "rations") > 0) api.state.inc("rations", -1);
  else {
    const dmg = d(api, 1, 4) + Math.floor(dist / 25);
    hurt(api, dmg);
    api.log(L(api, `🍖 口粮吃完了，饥饿让你失去 ${dmg} 点生命。`, `🍖 Out of rations — hunger costs you ${dmg} HP.`));
    if (get(api, "hp") <= 0) return { died: true };
  }
  // 遭遇
  if (dist % BOSS_EVERY === 0) { spawn(api, "combat", dist === BOSS_EVERY ? 1 : 2, true); return { kind: "combat", boss: true }; }
  const kind = api.random.weighted({ combat: 40, hazard: 13, treasure: 11, social: 12, merchant: 11, shrine: 6, rest: 7 });
  const tier = Number(api.random.weighted({ "-1": 30, "0": 50, "1": 15, "2": 5 }));
  spawn(api, kind, tier, false);
  return { kind, tier };
}

// AI 返回后由 output.then 调用（规则身份执行）：只改名字、描述、检定属性和奖励类型
export function apply_ai(api) {
  const p = api.params;
  const kind = get(api, "event_kind");
  if (kind === "none") return false;
  const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const title = clip(p.title, 30), foe = clip(p.foe, 30), text = clip(p.text, 360), approach = clip(p.approach, 30);
  if (title) api.state.set("event_title", title);
  if (kind === "combat") {
    const f = get(api, "foe");
    if (foe || title) { f.name = foe || title; api.state.set("foe", f); }
  } else if (DEFAULT_ABIL[kind]) {
    const c = get(api, "check");
    if (ABIL.indexOf(p.ability) >= 0) c.ability = p.ability;
    if (approach) c.approach = approach;
    if (["gold", "rations", "potion", "heal"].indexOf(p.reward) >= 0) c.reward = p.reward;
    c.hostile = !!p.hostile && kind === "social";
    if (foe) c.foe = foe;
    api.state.set("check", c);
  }
  // 画面模块：只接受白名单里的值
  const s = sfx(api);
  if (s.cur) {
    const allowed = kind === "combat" ? (s.cur.boss ? FOE_SPRITES : FOE_SPRITES.filter((x) => x !== "warden")) : KIND_SPRITES[kind] || [];
    if (allowed.indexOf(p.sprite) >= 0) s.cur.sprite = p.sprite;
    if (TINTS.indexOf(p.tint) >= 0) s.cur.tint = p.tint;
    s.cur.pending = false;
    saveFx(api, s);
  }
  const art = get(api, "art");
  if (["day", "dusk", "night"].indexOf(p.time) >= 0) art.time = p.time;
  if (WEATHER.indexOf(p.weather) >= 0) art.weather = p.weather;
  api.state.set("art", art);
  if (text) api.log(`📖 ${text}`);
  refreshSituation(api);
  return true;
}

export function attack(api) {
  const lv = get(api, "level");
  const swings = lv >= 5 ? 2 : 1;
  const bonus = atkMod(api) + prof(lv) + get(api, "weapon_bonus");
  anim(api, "atk", 300);
  reveal(api);
  for (let i = 0; i < swings; i++) {
    const f = get(api, "foe");
    const roll = api.random.int(1, 20);
    const total = roll + bonus;
    if (roll === 1 || (roll !== 20 && total < f.ac)) {
      pop(api, L(api, "未命中", "miss"), "#e8e8e8", true);
      api.log(L(api, `🗡 你的攻击落空（d20=${roll}，${total} 对 AC ${f.ac}）`, `🗡 You miss (d20=${roll}, ${total} vs AC ${f.ac})`));
      continue;
    }
    const dmg = Math.max(1, d(api, roll === 20 ? 2 : 1, 10) + atkMod(api) + get(api, "weapon_bonus"));
    f.hp = Math.max(0, f.hp - dmg);
    api.state.set("foe", f);
    anim(api, "fhurt", 300);
    pop(api, roll === 20 ? `${dmg}!` : String(dmg), roll === 20 ? "#ffdd44" : "#ffffff", true);
    api.log(L(api, `🗡 ${roll === 20 ? "暴击！" : "命中！"}（d20=${roll}）你对${f.name}造成 ${dmg} 点伤害。`, `🗡 ${roll === 20 ? "CRITICAL!" : "Hit!"} (d20=${roll}) You deal ${dmg} damage to ${f.name}.`));
    if (f.hp <= 0) return victory(api, f);
  }
  refreshSituation(api);
  enemyTurn(api);
  refreshSituation(api);
  return { won: false };
}

function victory(api, f) {
  const xp = 20 * f.threat * (f.boss ? 3 : 1);
  const gold = api.random.int(1, 6) + 2 * f.threat;
  api.state.inc("gold", gold);
  api.state.inc("kills", 1);
  const parts = [L(api, `${xp} 经验`, `${xp} XP`), L(api, `${gold} 金币`, `${gold} gold`)];
  const beast = ["wolf", "drake", "spider"].indexOf((sfx(api).cur || {}).sprite) >= 0;
  if (beast || api.random.int(1, 100) <= 50) { const n = beast ? 2 : 1; api.state.inc("rations", n); parts.push(L(api, `${n} 份口粮`, `${n} ration(s)`)); }
  if (f.boss) { parts.push(upgradeGear(api)); api.state.inc("potions", 1); parts.push(L(api, "1 瓶药水", "1 potion")); }
  api.log(L(api, `🏆 你击败了${f.name}！获得 ${parts.join("、")}。`, `🏆 You defeated ${f.name}! Gained ${parts.join(", ")}.`));
  clearEvent(api, true);
  gainXp(api, xp);
  return { won: true };
}

export function resolve(api) {
  const kind = get(api, "event_kind");
  const c = get(api, "check");
  const threat = get(api, "threat");
  const lv = get(api, "level");
  const m = abilMod(api, c.ability) + prof(lv);
  const roll = api.random.int(1, 20);
  const total = roll + m;
  const ok = roll === 20 || (roll !== 1 && total >= c.dc);
  api.log(`🎲 ${T2(api, ABIL_NAME[c.ability])} ${L(api, "检定", "check")}：d20=${roll} ${sign(m)} = ${total} ${L(api, "对", "vs")} DC ${c.dc} → ${ok ? L(api, "成功", "success") : L(api, "失败", "failure")}`);
  if (kind === "hazard") {
    if (ok) { api.log(L(api, "你安然通过。", "You make it through safely.")); clearEvent(api); gainXp(api, 10 * threat); return { ok }; }
    const dmg = d(api, 1 + Math.floor(threat / 3), 6);
    hurt(api, dmg);
    api.log(L(api, `你受了伤，失去 ${dmg} 点生命，但总算过去了。`, `You get hurt, losing ${dmg} HP, but you make it past.`));
    clearEvent(api);
    return { ok };
  }
  if (kind === "treasure") {
    if (ok) { api.log(`✔ ${giveReward(api, c.reward, threat)}。`); clearEvent(api); gainXp(api, 5 * threat); return { ok }; }
    const dmg = d(api, 1, 6) + Math.floor(threat / 2);
    hurt(api, dmg);
    api.log(L(api, `机关被触发，你失去 ${dmg} 点生命，宝物也毁了。`, `A trap springs: you lose ${dmg} HP and the prize is ruined.`));
    clearEvent(api);
    return { ok };
  }
  if (kind === "social") {
    if (ok) { api.log(`✔ ${giveReward(api, c.reward, threat)}。`); clearEvent(api); gainXp(api, 5 * threat); return { ok }; }
    if (c.hostile) {
      const name = c.foe || get(api, "event_title");
      const f = makeFoe(api, threat, name, false); f.max_hp = f.hp;
      api.state.set("event_kind", "combat"); api.state.set("foe", f); api.state.set("event_title", name);
      api.log(L(api, `谈崩了——${name}动起手来！`, `Talks break down — ${name} attacks!`));
      refreshSituation(api);
      return { ok, fight: true };
    }
    api.log(L(api, "对方摇摇头，转身离开了。", "They shake their head and walk away."));
    clearEvent(api);
    return { ok };
  }
  if (kind === "shrine") {
    if (ok) {
      let r;
      if (api.random.int(1, 100) <= 15) r = upgradeGear(api);
      else { api.state.inc("max_hp", 2); r = L(api, "最大生命 +2，", "max HP +2, ") + giveReward(api, c.reward === "gold" || c.reward === "rations" ? "heal" : c.reward, threat); }
      api.log(L(api, `✨ 祝福降临：${r}。`, `✨ A blessing: ${r}.`));
      clearEvent(api); gainXp(api, 5 * threat); return { ok };
    }
    const dmg = d(api, 1, 6);
    hurt(api, dmg);
    api.log(L(api, `一股寒意穿过身体，你失去 ${dmg} 点生命。`, `A chill runs through you; you lose ${dmg} HP.`));
    clearEvent(api);
    return { ok };
  }
  return false;
}

export function leave(api) {
  const kind = get(api, "event_kind");
  if (kind === "combat") {
    const f = get(api, "foe");
    const dc = 10 + Math.floor(f.threat / 2) + (f.boss ? 3 : 0);
    const roll = api.random.int(1, 20);
    const total = roll + abilMod(api, "dex") + prof(get(api, "level"));
    if (roll === 20 || (roll !== 1 && total >= dc)) {
      api.log(L(api, `🏃 敏捷检定 d20=${roll} → ${total} 对 DC ${dc}：你甩掉了${f.name}。`, `🏃 DEX check d20=${roll} → ${total} vs DC ${dc}: you shake off ${f.name}.`));
      clearEvent(api);
      return { fled: true };
    }
    api.log(L(api, `🏃 敏捷检定 d20=${roll} → ${total} 对 DC ${dc}：没能逃掉！`, `🏃 DEX check d20=${roll} → ${total} vs DC ${dc}: you fail to escape!`));
    enemyTurn(api);
    refreshSituation(api);
    return { fled: false };
  }
  if (kind === "hazard") {
    if (get(api, "rations") > 0) { api.state.inc("rations", -1); api.log(L(api, "你绕了远路，多吃掉 1 份口粮。", "You take the long way around, eating 1 extra ration.")); }
    else { hurt(api, 2); api.log(L(api, "你饿着肚子绕了远路，失去 2 点生命。", "You detour on an empty stomach and lose 2 HP.")); }
  } else {
    api.log(L(api, "你没有停留，继续上路。", "You don't linger, and move on."));
  }
  clearEvent(api);
  return { left: true };
}

export function potion(api) {
  const h = heal(api, d(api, 2, 4) + 2 + Math.floor(get(api, "max_hp") / 5));
  api.state.inc("potions", -1);
  pop(api, `+${h}`, "#7aff8a", false);
  api.log(L(api, `🧪 你喝下治疗药水，恢复 ${h} 点生命。`, `🧪 You drink a healing potion and recover ${h} HP.`));
  if (get(api, "event_kind") === "combat") { enemyTurn(api); refreshSituation(api); }
  return { healed: h };
}

export function camp_rules(api) {
  const kind = get(api, "event_kind");
  api.state.set("camped", true);
  if (kind === "rest") {
    const h = heal(api, get(api, "max_hp"));
    api.log(L(api, `🔥 你在安全的营地睡了个好觉，恢复 ${h} 点生命。`, `🔥 You sleep soundly in the safe camp and recover ${h} HP.`));
    clearEvent(api);
    return { healed: h };
  }
  api.state.inc("rations", -1);
  const h = heal(api, Math.ceil(get(api, "max_hp") / 2));
  api.log(L(api, `🔥 你在路边扎营，吃掉 1 份口粮，恢复 ${h} 点生命。`, `🔥 You make camp by the road, eat 1 ration and recover ${h} HP.`));
  if (api.random.int(1, 100) <= 20) {
    api.log(L(api, "夜里有动静……", "Something stirs in the night…"));
    spawn(api, "combat", 0, false);
    return { healed: h, ambush: true };
  }
  return { healed: h };
}

export function buy(api) {
  const item = api.params.item;
  if (item === "gear") {
    const cost = gearPrice(get(api, "weapon_bonus"), get(api, "armor_bonus"));
    if (get(api, "gold") < cost) api.fail(L(api, `金币不够（需要 ${cost}）`, `Not enough gold (need ${cost})`));
    api.state.inc("gold", -cost);
    api.log(L(api, `🛒 花 ${cost} 金币升级装备：${upgradeGear(api)}。`, `🛒 Spent ${cost} gold upgrading gear: ${upgradeGear(api)}.`));
  } else {
    const cost = PRICE[item];
    if (get(api, "gold") < cost) api.fail(L(api, `金币不够（需要 ${cost}）`, `Not enough gold (need ${cost})`));
    api.state.inc("gold", -cost);
    if (item === "ration") api.state.inc("rations", 1); else api.state.inc("potions", 1);
    api.log(L(api, `🛒 花 ${cost} 金币买了 1 ${item === "ration" ? "份口粮" : "瓶药水"}。`, `🛒 Bought 1 ${item === "ration" ? "ration" : "potion"} for ${cost} gold.`));
  }
  refreshSituation(api);
  return true;
}
