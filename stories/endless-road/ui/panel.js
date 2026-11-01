// 《无尽之路》面板：一个组件文件，两种用法（config.view）
//   bar   行动栏：生命条、资源、行动按钮，以及打开详情弹窗的小按钮（角色 / 行囊 / 遗物 / 旅程）
//   event 事件：事件卡 / 商店 / 赶路时的提示
// 组件在沙箱里运行，只能读玩家可见的状态、调用 story.yaml 里给这个组件声明过的动作。
const T = (zh, en) => (oasis.lang === "en" ? en : zh);
const root = document.getElementById("root");
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
  const more = el("div", "more");
  for (const [id, label] of [["char", T("🧝 角色", "🧝 Character")], ["pack", T("🎒 行囊与强化", "🎒 Pack")], ["relic", T("💎 遗物与状态", "💎 Relics")], ["trip", T("🗺 旅程", "🗺 Journey")]]) {
    const b = el("button", "mini", label); b.disabled = busy();
    b.addEventListener("click", () => run("open_panel", { id }));
    more.append(b);
  }
  p.append(hud, acts, more, el("p", "msg", msg));
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

const VIEWS = { bar, event };
function render(s) {
  const view = VIEWS[(oasis.config && oasis.config.view) || "event"] || event;
  root.replaceChildren(view(s || {}));
  oasis.resize(Math.max(48, document.body.scrollHeight + 2));
}
oasis.ready.then((o) => render(o.state));
oasis.onState((s) => render(s));
