// 《无尽之路》操作面板（自定义组件）：状态、事件卡 / 商店 / 选职业、行动按钮、组件内详情弹窗。
// 只能读玩家可见的状态，只能调用 story.yaml 里给这个组件声明的动作。
(() => {
const T = (zh, en) => (oasis.lang === "en" ? en : zh);
const app = document.getElementById("app");
let pending = false, msg = "", sheet = null; // sheet：打开的详情页（char / pack / relic / trip）

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "style") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
const icon = (n) => h("i", { class: `i i-${n}` });
const busy = () => pending || oasis.busy || oasis.ended;
const portrait = (cls, cssClass) => h("div", { class: cssClass || "portrait", style: { backgroundImage: `url(${HERO[cls] || HERO.fighter})` } });
// 头像：用 <img> 预载（客户端会把同包的图片内联），再读出 data 地址给背景用
const HERO = {};
for (const c of ["fighter", "rogue", "wizard", "cleric"]) { const img = document.querySelector(`img[data-hero="${c}"]`); if (img) HERO[c] = img.src; }

async function run(action, params) {
  if (pending) return;
  pending = true; msg = ""; render();
  try { const r = await oasis.action(action, params || {}); if (!r.ok) msg = r.error || T("现在做不到。", "Can't do that right now."); }
  finally { pending = false; render(); }
}

// ---------- 顶部 ----------
function topBar(s) {
  const pct = Math.max(0, Math.min(100, (100 * (s.hp || 0)) / (s.max_hp || 1)));
  const caps = { r: 8 + 4 * ((s.gear || {}).pack || 0), p: 3 + ((s.gear || {}).pack || 0) };
  const chosen = s.phase !== "class";
  return h("div", { class: "wood" },
    h("div", { class: "top" },
      portrait(s.hero_class),
      h("div", { class: "who" }, h("span", { class: "name serif" }, chosen ? s.class_name || T("冒险者", "Adventurer") : T("新的旅人", "A new traveler")),
        chosen ? h("span", { class: "lv" }, `${T("等级", "Lv")} ${s.level}`) : h("span", { class: "lv" }, T("选择你的职业", "Choose your class"))),
      h("div", { class: "hp" }, h("i", { style: { width: `calc(${pct}% - 4px)` } }), h("b", {}, `${s.hp ?? 0} / ${s.max_hp ?? 0}`))),
    h("div", { class: "res" },
      h("span", { title: T("口粮", "Rations") }, icon("ration"), h("b", {}, s.rations), h("em", {}, `/${caps.r}`)),
      h("span", { title: T("药水", "Potions") }, icon("potion"), h("b", {}, s.potions), h("em", {}, `/${caps.p}`)),
      h("span", { title: T("金币", "Gold") }, icon("coin"), h("b", {}, s.gold)),
      h("span", { title: T("铁料", "Iron") }, icon("iron"), h("b", {}, s.iron)),
      h("span", { title: T("魔晶", "Essence") }, icon("essence"), h("b", {}, s.essence)),
      h("span", { title: T("护甲等级", "Armor Class") }, icon("shield"), h("b", {}, s.ac)),
      h("span", { title: T("已走里程", "Miles walked") }, icon("flag"), h("b", {}, s.distance))));
}

// ---------- 中间的羊皮纸卡 ----------
function tags(list) { return h("div", { class: "tags" }, (list || []).map((t) => h("span", { class: `tag ${t.k}` }, t.t))); }
function center(s) {
  if (s.phase === "class") {
    return h("div", { class: "paper card" },
      h("span", { class: "kind" }, T("开始旅程", "A new journey")),
      h("h2", { class: "serif" }, T("你是谁？", "Who are you?")),
      h("p", { class: "text" }, T("属性已经掷好，会按你选的职业分配。", "Your scores are rolled and will be assigned to suit your class.")),
      h("div", { class: "classes" }, (s.class_info || []).map((c) => h("button", { class: "btn pape cls", disabled: busy(), onclick: () => run("pick_class", { id: c.id }) },
        portrait(c.id, "portrait"), h("span", { class: "cname serif" }, c.name), h("span", { class: "cstat" }, `${T("生命", "HP")} ${c.hp} · AC ${c.ac}`), h("span", { class: "cdesc", style: { gridColumn: "span 2" } }, c.desc)))));
  }
  if (s.phase === "battle" && s.foe && s.foe.max_hp) {
    const f = s.foe, pct = Math.max(0, (100 * f.hp) / f.max_hp);
    return h("div", { class: "paper card" },
      h("span", { class: "kind" }, f.boss ? T("守关者", "Warden") : T("战斗", "Battle")),
      h("div", { class: "foe" }, icon(f.boss ? "skull" : "sword"), h("h2", { class: "serif", style: { margin: 0 } }, f.name),
        h("div", { class: "hp", style: { gridColumn: "span 2" } }, h("i", { style: { width: `calc(${pct}% - 4px)` } }), h("b", {}, `${f.hp} / ${f.max_hp}`)),
        h("div", { class: "meta" }, h("span", {}, `AC ${f.ac}`), h("span", {}, `${T("命中", "to hit")} +${f.atk}`), h("span", {}, `${T("威胁", "threat")} ${f.threat}`))),
      h("p", { class: "text", style: { margin: "10px 0 0" } }, T("用下面的按钮攻击、喝药水或逃跑。", "Attack, drink a potion or flee with the buttons below.")));
  }
  const ui = s.ui_card || { mode: "none" };
  if (ui.mode === "none") {
    if (s.hp <= 0) return h("div", { class: "paper card idle" }, h("h2", { class: "serif" }, T("旅程结束了", "The journey is over")));
    const q = s.quest && s.quest.due ? h("p", { class: "text" }, icon("scroll"), " ", T(`委托「${s.quest.title}」：第 ${s.quest.due} 里左右回访`, `Errand "${s.quest.title}": return around mile ${s.quest.due}`)) : null;
    return h("div", { class: "paper card idle" },
      h("span", { class: "kind" }, T("赶路", "On the road")),
      h("h2", { class: "serif" }, String(s.situation || "").split("\n")[0]),
      q,
      h("span", { class: "badge" + (s.next_ready ? "" : " wait") }, icon(s.next_ready ? "check" : "hourglass"), s.next_ready ? T("下一里已经备好", "The next mile is ready") : T("AI 正在准备下一里", "The AI is preparing the next mile")));
  }
  const shop = ui.mode === "shop";
  return h("div", { class: "paper card" + (shop ? " shop" : "") },
    h("span", { class: "kind" }, ui.kind || ""),
    h("h2", { class: "serif" }, ui.title || ""),
    h("p", { class: "text" + (ui.mode === "loading" ? " loading" : "") }, ui.text || ""),
    h("div", { class: "opts" }, (ui.items || []).map((it) => h("button", { class: "btn pape opt", disabled: !!it.disabled || busy(), onclick: () => run(ui.action, { id: it.id }) },
      icon(it.icon || "dice"), h("span", { class: "label" }, it.text || ""), it.tags && it.tags.length ? tags(it.tags) : h("span", { class: "sub" }, it.sub || "")))));
}

// ---------- 行动按钮 ----------
function actions(s) {
  const ph = s.phase || "none", dead = s.hp <= 0, b = busy();
  const A = (id, ic, label, ok, gold) => h("button", { class: `btn act${gold ? " gold" : ""}`, disabled: !ok || dead || b, onclick: () => run(id) }, icon(ic), label);
  return h("div", { class: "stack" },
    h("div", { class: "acts" },
      ph === "battle" ? A("attack", "sword", T("攻击", "Attack"), true, true) : A("walk", "flag", T("继续前进", "Walk on"), ph === "none", true),
      ph === "battle" ? A("walk", "flag", T("前进", "Walk"), false) : A("attack", "sword", T("攻击", "Attack"), false),
      A("potion", "potion", T("药水", "Potion"), s.potions > 0 && s.hp < s.max_hp),
      A("camp", "fire", T("扎营", "Camp"), ph === "none" && !s.camped && s.rations > 0),
      A("flee", "boot", T("逃跑", "Flee"), ph === "battle")),
    h("div", { class: "tabs" }, [["char", "person", T("角色", "Character")], ["pack", "pack", T("行囊", "Pack")], ["relic", "gem", T("遗物", "Relics")], ["trip", "map", T("旅程", "Journey")]].map(([id, ic, label]) =>
      h("button", { class: "btn tab", disabled: s.phase === "class", onclick: () => { sheet = id; render(); } }, icon(ic), label))),
    h("p", { class: "msg" }, msg));
}

// ---------- 详情弹窗（画在组件里面） ----------
const ABIL = [["str", "力量", "STR"], ["dex", "敏捷", "DEX"], ["con", "体质", "CON"], ["int", "智力", "INT"], ["wis", "感知", "WIS"], ["cha", "魅力", "CHA"]];
const GEAR = [["weapon", "sword", "武器", "Weapon", 5], ["armor", "shield", "护甲", "Armor", 5], ["pack", "pack", "背包", "Pack", 3], ["kit", "fire", "营具", "Camp kit", 3]];
const STATUS = { blessed: ["祝福", "Blessed"], cursed: ["诅咒", "Cursed"], poisoned: ["中毒", "Poisoned"], exhausted: ["疲惫", "Exhausted"], scouted: ["侦察", "Scouted"] };
function sheetBody(s, id) {
  if (id === "char") {
    const a = s.abil || {}, info = (s.class_info || []).find((c) => c.id === s.hero_class) || {};
    return [h("div", { class: "top" }, portrait(s.hero_class), h("div", {}, h("h3", { class: "serif", style: { margin: 0 } }, `${s.class_name || ""} · ${T("等级", "Lv")} ${s.level}`),
        h("div", {}, `${T("生命", "HP")} ${s.hp}/${s.max_hp} · ${T("护甲等级", "AC")} ${s.ac}`))),
      h("div", { class: "xpbar" }, h("i", { style: { width: `${Math.min(100, (100 * (s.xp || 0)) / (s.xp_next || 1))}%` } })),
      h("div", { style: { fontSize: "12.5px", color: "#b5a383", marginTop: "-6px" } }, `${T("经验", "XP")} ${s.xp} / ${s.xp_next}`),
      h("div", { class: "grid6" }, ABIL.map(([k, zh, en]) => { const v = a[k] || 10, m = Math.floor((v - 10) / 2); return h("div", { class: "cell" }, h("small", {}, T(zh, en)), h("b", {}, v), h("em", {}, m >= 0 ? `+${m}` : m)); })),
      h("div", { style: { color: "#d8c8a6" } }, info.desc || "")];
  }
  if (id === "pack") {
    const g = s.gear || {}, caps = { r: 8 + 4 * (g.pack || 0), p: 3 + (g.pack || 0) };
    return [h("h3", { class: "serif" }, T("行囊", "Pack")),
      ...[["ration", T("口粮", "Rations"), `${s.rations} / ${caps.r}`], ["potion", T("治疗药水", "Healing potions"), `${s.potions} / ${caps.p}`], ["coin", T("金币", "Gold"), s.gold], ["iron", T("铁料", "Iron"), s.iron], ["essence", T("魔晶", "Essence"), s.essence]]
        .map(([ic, n, v]) => h("div", { class: "row" }, icon(ic), h("span", { class: "grow" }, n), h("b", {}, v))),
      h("h3", { class: "serif", style: { marginTop: "12px" } }, T("强化", "Upgrades")),
      ...GEAR.map(([k, ic, zh, en, max]) => h("div", { class: "row" }, icon(ic), h("span", { class: "grow" }, T(zh, en)),
        h("span", { class: "pips" }, Array.from({ length: max }, (_, i) => h("i", { class: i < (g[k] || 0) ? "on" : "" }))))),
      h("div", { style: { marginTop: "8px", fontSize: "12.5px", color: "#b5a383" } }, T("在路上遇到的行商那里强化（金币 + 铁料，高级还要魔晶）。", "Upgrade at peddlers on the road (gold + iron; essence at higher levels)."))];
  }
  if (id === "relic") {
    const lines = String(s.relic_text || "").split("\n").filter((l) => /[:：]/.test(l));
    const st = s.status || {};
    return [h("h3", { class: "serif" }, T("遗物（最多 3 件）", "Relics (up to 3)")),
      ...[0, 1, 2].map((i) => { const l = lines[i]; if (!l) return h("div", { class: "slot empty" }, icon("gem"), h("span", {}, T("空位", "Empty slot"))); const [n, ...d] = l.split(/[:：]/); return h("div", { class: "slot" }, icon("gem"), h("div", {}, h("b", {}, n.trim()), h("small", {}, d.join(":").trim()))); }),
      h("h3", { class: "serif", style: { marginTop: "12px" } }, T("状态", "Status")),
      h("div", {}, Object.keys(st).filter((k) => st[k] > 0).map((k) => h("span", { class: "chip" }, `${T(STATUS[k][0], STATUS[k][1])}${k === "exhausted" ? "" : ` · ${st[k]}${T(" 里", " mi")}`}`)), Object.keys(st).some((k) => st[k] > 0) ? null : h("span", { style: { color: "#9c8c70" } }, T("（无）", "(none)")))];
  }
  return [h("h3", { class: "serif" }, T("旅程", "Journey")),
    ...[["flag", T("已走里程", "Miles walked"), s.distance], ["star", T("最远纪录", "Best record"), s.best], ["skull", T("击败敌人", "Foes defeated"), s.kills]].map(([ic, n, v]) => h("div", { class: "row" }, icon(ic), h("span", { class: "grow" }, n), h("b", {}, v))),
    s.quest && s.quest.due ? h("div", { class: "row" }, icon("scroll"), h("span", { class: "grow" }, T(`委托「${s.quest.title}」`, `Errand "${s.quest.title}"`)), h("b", {}, T(`第 ${s.quest.due} 里`, `mile ${s.quest.due}`))) : null,
    h("div", { style: { marginTop: "8px", fontSize: "12.5px", color: "#b5a383" } }, T("每 10 里换一个地区，每 25 里有一个守关者。", "The region changes every 10 miles; a warden waits every 25 miles."))];
}
function modal(s) {
  if (!sheet) return null;
  const tabs = [["char", "person", T("角色", "Character")], ["pack", "pack", T("行囊", "Pack")], ["relic", "gem", T("遗物", "Relics")], ["trip", "map", T("旅程", "Journey")]];
  return h("div", { class: "modal", onclick: (e) => { if (e.target === e.currentTarget) { sheet = null; render(); } } },
    h("div", { class: "wood sheet" },
      h("div", { class: "tabs" }, tabs.map(([id, ic, label]) => h("button", { class: "btn tab" + (id === sheet ? " on" : ""), onclick: () => { sheet = id; render(); } }, icon(ic), label))),
      ...sheetBody(s, sheet),
      h("div", { class: "close" }, h("button", { class: "btn gold act", onclick: () => { sheet = null; render(); } }, T("关闭", "Close")))));
}

function render() {
  const s = oasis.state || {};
  app.replaceChildren(h("div", { class: "stack", style: { position: "relative" } }, topBar(s), center(s), actions(s)), modal(s) || "");
  const m = app.querySelector(".modal .sheet");
  oasis.resize(Math.max(120, document.body.scrollHeight + 4, m ? m.scrollHeight + 24 : 0));
}
oasis.ready.then(() => render());
oasis.onState(() => render());
})();
