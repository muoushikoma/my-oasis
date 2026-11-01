// 雪线 · AI 结果入口（由 build/make_gen.py 从 gen_src.js 生成）
// 记账后交给 gen_world.js / gen_region.js / gen_building.js 处理，每个都有自己的时间预算。

// ───────── 入口：AI 结果 ─────────
export function onAi(api) {
  const p = api.params;
  const q = api.state.get("aiq");
  const job = q.pend[p.request];
  if (!job) {
    const side = q.side && q.side[p.request];
    if (side) { // AI 导演、AI 日记：交给 ui.js 按规则落实
      delete q.side[p.request]; api.state.set("aiq", q);
      if (side.k === "director" && !p.error) api.actions.call("ui", { op: "director", s: String(p.text || "") });
      if (side.k === "diary") api.actions.call("ui", { op: "diary", s: p.error ? "" : String(p.text || ""), v: side.day });
      if (side.k === "mind" && !p.error) api.actions.call("npc_mind", { id: side.id, s: String(p.text || "") });
      return;
    }
    if (p.entry === "narrate" && p.text && !p.error) { const g = api.state.get("g"); g.narr = { t: api.time, text: String(p.text).slice(0, 160) }; api.state.set("g", g); }
    return;
  }
  delete q.pend[p.request];
  q.done[job.k + ":" + job.id] = true;
  api.state.set("aiq", q);
  runJob(api, job.k, job.id, p.error ? "" : String(p.text || ""));
}
// 超时兜底（ui.js 调用）
export function fallback(api) {
  const k = api.params.k, id = api.params.id, req = api.params.req;
  const q = api.state.get("aiq");
  if (req !== undefined && req !== null) delete q.pend[req];
  if (q.done[k + ":" + id]) return true;
  q.done[k + ":" + id] = true;
  q.want = q.want.filter((w) => !(w.k === k && w.id === id));
  api.state.set("aiq", q);
  runJob(api, k, id, "");
  return true;
}
function runJob(api, k, id, text) {
  api.actions.call("gen_" + k, { id, s: text });
  const g = api.state.get("g"), world = api.state.get("world");
  const ok = text && text.indexOf("{") >= 0;
  const name = k === "world" ? "世界" : k === "region" ? (world.regions[id] || {}).name : "建筑 " + id;
  g.log = (g.log || []).concat([name + (ok ? "：AI 生成" : "：规则生成")]).slice(-12);
  api.state.set("g", g);
}

