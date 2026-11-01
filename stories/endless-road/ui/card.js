// 《无尽之路》操作面板：状态条 + 事件卡 / 商店 + 行动按钮。
// 组件在沙箱里运行，只能读玩家可见的状态、调用 story.yaml 里声明过的动作（choose、trade、walk、camp、potion、attack、flee）。
const $ = (id) => document.getElementById(id);
const T = (zh, en) => (oasis.lang === "en" ? en : zh);
let pending = false;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function hud(s) {
  const box = $("hud"); box.replaceChildren();
  const bar = el("div", "hpbar"); const fill = el("i");
  fill.style.width = `${Math.max(0, Math.min(100, (100 * (s.hp || 0)) / (s.max_hp || 1)))}%`;
  bar.append(fill, el("span", "", `${T("生命", "HP")} ${s.hp ?? 0}/${s.max_hp ?? 0}`));
  box.append(bar);
  const stat = (label, v) => { const x = el("span"); x.append(`${label} `, el("b", "", String(v ?? 0))); box.append(x); };
  stat(T("等级", "Lv"), s.level); stat(T("口粮", "Rations"), s.rations); stat(T("药水", "Potions"), s.potions); stat(T("金币", "Gold"), s.gold); stat(T("里程", "Miles"), s.distance);
}

function card(s, busy) {
  const ui = s.ui_card || { mode: "none" };
  $("card").className = "card" + (ui.mode === "shop" ? " shop" : "") + (ui.mode === "none" ? " quiet" : "");
  if (ui.mode === "none") {
    $("kind").textContent = ""; $("title").textContent = "";
    $("text").textContent = s.hp > 0 ? String(s.situation || "").split("\n")[0] : T("旅程结束了。", "The journey is over.");
    $("text").classList.remove("dots");
    $("items").replaceChildren();
    return;
  }
  $("kind").textContent = (ui.kind || "") + " ·";
  $("title").textContent = ui.title || "";
  $("text").textContent = ui.text || "";
  $("text").classList.toggle("dots", ui.mode === "loading");
  $("items").replaceChildren(...(ui.items || []).map((it) => {
    const b = el("button", "item"); b.disabled = !!it.disabled || busy;
    b.append(el("span", "label", it.text || ""));
    if (it.sub) b.append(el("span", "sub", it.sub));
    b.addEventListener("click", () => run(ui.action, { id: it.id }));
    return b;
  }));
}

function bar(s, busy) {
  const ph = s.phase || "none";
  const acts = [
    ["walk", T("继续前进", "Walk on"), ph === "none", true],
    ["camp", T("扎营休息", "Camp"), ph === "none" && !s.camped && s.rations > 0],
    ["potion", T("喝药水", "Potion"), s.potions > 0 && s.hp < s.max_hp],
    ["attack", T("攻击", "Attack"), ph === "battle", ph === "battle"],
    ["flee", T("逃跑", "Flee"), ph === "battle"],
  ];
  $("bar").replaceChildren(...acts.map(([id, label, ok, main]) => {
    const b = el("button", "act" + (main ? " main" : ""), label);
    b.disabled = !ok || busy || s.hp <= 0;
    b.addEventListener("click", () => run(id, {}));
    return b;
  }));
}

function render(s) {
  const busy = pending || oasis.busy || oasis.ended;
  hud(s); card(s, busy); bar(s, busy);
  oasis.resize(Math.max(80, document.body.scrollHeight + 2));
}

async function run(action, params) {
  if (pending) return;
  pending = true; $("msg").textContent = ""; render(oasis.state);
  try {
    const r = await oasis.action(action, params);
    if (!r.ok) $("msg").textContent = r.error || T("现在做不到。", "Can't do that right now.");
  } finally { pending = false; render(oasis.state); }
}

oasis.ready.then((o) => render(o.state));
oasis.onState((s) => render(s));
