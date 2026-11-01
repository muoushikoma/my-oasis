// 小地图：点地点 = 调用故事里声明过的 move 动作；状态变了就高亮当前位置
const btns = [...document.querySelectorAll("button[data-to]")];
const msg = document.getElementById("msg");
function draw(state) { btns.forEach((b) => b.classList.toggle("here", b.dataset.to === state.location)); }
oasis.ready.then((o) => { draw(o.state); o.emit("opened", { at: o.state.location }); });
oasis.onState((s) => draw(s));
btns.forEach((b) => b.addEventListener("click", async () => {
  msg.textContent = "";
  const r = await oasis.action("move", { to: b.dataset.to });
  if (!r.ok) msg.textContent = r.error || "去不了";
}));
oasis.resize(document.body.scrollHeight + 4);
