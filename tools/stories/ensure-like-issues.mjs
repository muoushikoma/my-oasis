// 给每个故事建一个“点赞帖”Issue（标题 [likes] <id>，标签 story-likes）。玩家在客户端点赞 = 给它加 👍。
// 合并到 main 后由 stories-publish 工作流运行；需要 GH_TOKEN（issues: write）。已存在的不会重复建。
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./common.mjs";
const repo = process.env.GITHUB_REPOSITORY || "muoushikoma/my-oasis", token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) { console.error("缺少 GH_TOKEN"); process.exit(1); }
const api = async (method, p, body) => {
  const r = await fetch(`https://api.github.com${p}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok && r.status !== 422) throw new Error(`${method} ${p} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "index.json"), "utf8"));
await api("POST", `/repos/${repo}/labels`, { name: "story-likes", color: "f9d0c4", description: "故事点赞帖：给它点 👍 就是给故事点赞" }); // 已存在时 422，忽略
const have = new Set();
for (let page = 1; page <= 20; page++) {
  const list = await api("GET", `/repos/${repo}/issues?labels=story-likes&state=all&per_page=100&page=${page}`);
  for (const it of list) { const m = /^\[likes\] (.+)$/.exec(it.title); if (m && !it.pull_request) have.add(m[1]); }
  if (list.length < 100) break;
}
let made = 0;
for (const st of index.stories) {
  if (have.has(st.id)) continue;
  const t = typeof st.title === "object" ? (st.title.zh || st.title.en) : st.title;
  await api("POST", `/repos/${repo}/issues`, { title: `[likes] ${st.id}`, labels: ["story-likes"],
    body: `《${t}》的点赞帖。\n\n给这条 Issue 点 👍 就是给故事点赞（客户端“在线故事库”里的点赞按钮做的也是这件事）。请不要在这里讨论或关闭它。\n\nLike thread for “${t}”. A 👍 reaction here counts as a like.` });
  made++;
}
console.log(`点赞帖：新建 ${made} 个，已有 ${have.size} 个`);
