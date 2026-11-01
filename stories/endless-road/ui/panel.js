// 《无尽之路》面板：一个组件文件，三种用法（config.view）
//   bar   行动栏：生命条、资源、行动按钮
//   event 事件：事件卡 / 商店 / 赶路时的提示
//   info  信息：角色、行囊与强化、遗物与状态、旅程（可折叠）
// 组件在沙箱里运行，只能读玩家可见的状态、调用 story.yaml 里给这个组件声明过的动作。
const T = (zh, en) => (oasis.lang === "en" ? en : zh);
const root = document.getElementById("root");
const closed = new Set(["trip"]); // 信息面板里折叠了哪些分组（默认收起“旅程”；只在本次打开期间记住）
let pending = false, msg = "";

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function busy() { return pending || oasis.busy || oasis.ended; }

async function run(action, params) {
  if (pending) return;
  pending = true; msg = ""; render(oasis.state);
  try { const r = await oasis.action(action, params || {}); if (!r.ok) msg = r.error || T("现在做不到。", "Can't do that right now."); }
  finally { pending = false; render(oasis.state); }
}

// ---------- 行动栏 ----------
function bar(s) {
  const p = el("div", "panel bar");
  const hud = el("div", "hud");
  const hp = el("div", "hp"); const fill = el("i"); fill.style.width = `${Math.max(0, Math.min(100, (100 * (s.hp || 0)) / (s.max_hp || 1)))}%`;
  hp.append(fill, el("span", "", `${T("生命", "HP")} ${s.hp ?? 0} / ${s.max_hp ?? 0}`));
  hud.append(hp);
  for (const [k, v] of [[T("口粮", "Rations"), s.rations], [T("药水", "Potions"), s.potions], [T("金币", "Gold"), s.gold], ["AC", s.ac], [T("里程", "Mile"), s.distance]]) {
    const c = el("span", "chip", k); c.append(el("b", "", String(v ?? 0))); hud.append(c);
  }
  const ph = s.phase || "none", dead = s.hp <= 0;
  const acts = el("div", "acts");
  for (const [id, label, ok, main] of [
    ["walk", T("继续前进 ➜", "Walk on ➜"), ph === "none", ph !== "battle"],
    ["attack", T("⚔ 攻击", "⚔ Attack"), ph === "battle", ph === "battle"],
    ["potion", T("🧪 药水", "🧪 Potion"), s.potions > 0 && s.hp < s.max_hp],
    ["camp", T("🔥 扎营", "🔥 Camp"), ph === "none" && !s.camped && s.rations > 0],
    ["flee", T("🏃 逃跑", "🏃 Flee"), ph === "battle"],
  ]) {
    const b = el("button", "act" + (main ? " main" : ""), label);
    b.disabled = !ok || dead || busy();
    b.addEventListener("click", () => run(id));
    acts.append(b);
  }
  p.append(hud, acts, el("p", "msg", msg));
  return p;
}

// ---------- 事件 ----------
function event(s) {
  const ui = s.ui_card || { mode: "none" };
  if (ui.mode === "none") {
    const p = el("div", "panel idle");
    if (s.hp <= 0) { p.append(el("div", "title", T("旅程结束了", "The journey is over"))); return p; }
    p.append(el("div", "title", T("🛤 前路", "🛤 The road")));
    p.append(el("p", "text road", String(s.situation || "").split("\n")[0]));
    if (s.phase === "battle") p.append(el("p", "muted", T("战斗中：用下面的行动栏攻击、喝药或逃跑。", "In battle: use the action bar to attack, drink a potion or flee.")));
    else p.append(el("span", "badge" + (s.next_ready ? "" : " wait"), s.next_ready ? T("✓ 下一里已经备好", "✓ The next mile is ready") : T("… AI 正在准备下一里", "… The AI is preparing the next mile")));
    p.append(el("p", "msg", msg));
    return p;
  }
  const p = el("div", "panel" + (ui.mode === "shop" ? " shop" : ""));
  const head = el("div", "head"); head.append(el("span", "kind", ui.kind || ""), el("span", "title", ui.title || "")); p.append(head);
  const text = el("p", "text", ui.text || ""); if (ui.mode === "loading") text.classList.add("dots"); p.append(text);
  const items = el("div", "items");
  for (const it of ui.items || []) {
    const b = el("button", "item"); b.disabled = !!it.disabled || busy();
    b.append(el("b", "", it.text || "")); if (it.sub) b.append(el("small", "", it.sub));
    b.addEventListener("click", () => run(ui.action, { id: it.id }));
    items.append(b);
  }
  p.append(items, el("p", "msg", msg));
  return p;
}

// ---------- 信息 ----------
function sec(id, title, body) {
  const box = el("section", "sec" + (closed.has(id) ? " closed" : ""));
  const h = el("h3", "", title); h.addEventListener("click", () => { closed.has(id) ? closed.delete(id) : closed.add(id); render(oasis.state); });
  const b = el("div", "body"); if (typeof body === "string") b.textContent = body; else b.append(body);
  box.append(h, b); return box;
}
function kv(pairs) { const d = el("dl", "kv"); for (const [k, v] of pairs) d.append(el("dt", "", k), el("dd", "", String(v ?? ""))); return d; }
function info(s) {
  const p = el("div", "info");
  const ch = el("div");
  ch.append(kv([[T("等级", "Level"), s.level], [T("经验", "XP"), `${s.xp ?? 0} / ${s.xp_next ?? 0}`], [T("护甲等级", "Armor Class"), s.ac], [T("生命", "HP"), `${s.hp} / ${s.max_hp}`]]));
  const xp = el("div", "xp"); const xi = el("i"); xi.style.width = `${Math.min(100, (100 * (s.xp || 0)) / (s.xp_next || 1))}%`; xp.append(xi); ch.append(xp);
  ch.append(el("div", "muted", s.abilities || ""));
  p.append(sec("char", T("🧝 角色", "🧝 Character"), ch));
  p.append(sec("pack", T("🎒 行囊与强化", "🎒 Pack & upgrades"), `${s.pack_text || ""}\n${s.gear_text || ""}`));
  p.append(sec("relic", T("💎 遗物与状态", "💎 Relics & status"), `${s.relic_text || ""}\n${s.status_text || ""}`));
  p.append(sec("trip", T("🗺 旅程", "🗺 Journey"), kv([[T("已走里程", "Miles walked"), s.distance], [T("最远纪录", "Best record"), s.best], [T("击败敌人", "Foes defeated"), s.kills]])));
  return p;
}

const VIEWS = { bar, event, info };
function render(s) {
  const view = VIEWS[(oasis.config && oasis.config.view) || "event"] || event;
  root.replaceChildren(view(s || {}));
  oasis.resize(Math.max(48, document.body.scrollHeight + 2));
}
oasis.ready.then((o) => render(o.state));
oasis.onState((s) => render(s));
