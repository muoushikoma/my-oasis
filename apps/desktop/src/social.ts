// 收藏（只存在本机）和点赞（GitHub 👍：每个故事在仓库里有一个带 story-likes 标签的 Issue，点赞数 = 它的 👍 数，不需要自建服务器）
import { bridge } from "./bridge";
import { REPO } from "./online";

const FAV = "oasis.favorites", LIKED = "oasis.liked";
const readSet = (k: string): Set<string> => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return new Set(Array.isArray(v) ? v.map(String) : []); } catch { return new Set(); } };
const writeSet = (k: string, s: Set<string>) => localStorage.setItem(k, JSON.stringify([...s]));
export const favorites = () => readSet(FAV);
export const isFavorite = (id: string) => readSet(FAV).has(id);
export function toggleFavorite(id: string): boolean { const s = readSet(FAV); const on = !s.has(id); on ? s.add(id) : s.delete(id); writeSet(FAV, s); return on; }

export interface LikeInfo { issue: number; count: number }
/** 点赞帖标题格式；工作流 stories-publish 会给每个故事自动建一个 */
export const likeIssueTitle = (id: string) => `[likes] ${id}`;
export function parseLikes(issues: any[]): Map<string, LikeInfo> {
  const m = new Map<string, LikeInfo>();
  for (const it of Array.isArray(issues) ? issues : []) {
    const r = /^\[likes\] ([a-z][a-z0-9-]{2,63})$/.exec(String(it?.title ?? ""));
    if (!r || it?.pull_request || typeof it?.number !== "number") continue;
    const count = Number(it?.reactions?.["+1"] ?? 0) || 0;
    const old = m.get(r[1]); if (!old || old.issue > it.number) m.set(r[1], { issue: it.number, count });
  }
  return m;
}
const dec = new TextDecoder();
/** 读所有故事的点赞数（公开接口，不用登录；每小时 60 次的匿名额度） */
export async function fetchLikes(): Promise<Map<string, LikeInfo>> {
  const all: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const j = JSON.parse(dec.decode(await bridge.netGet(`https://api.github.com/repos/${REPO}/issues?labels=story-likes&state=all&per_page=100&page=${page}`)));
    if (!Array.isArray(j)) break; all.push(...j); if (j.length < 100) break;
  }
  return parseLikes(all);
}
export const likedLocally = (id: string) => readSet(LIKED).has(id);
/** 点赞/取消：需要先登录 GitHub（创作 → 投稿）；返回最新点赞数 */
export async function setLike(id: string, issue: number, on: boolean): Promise<number> {
  const st = await bridge.gh<{ configured: boolean; login?: string | null }>("gh_status");
  if (!st.configured) throw new Error("GitHub 登录暂未开放（客户端还没配置登录应用），暂时不能点赞");
  if (!st.login) throw new Error("点赞要先登录 GitHub：到“创作 → 投稿”里点“用 GitHub 登录”");
  const n = await bridge.gh<number>("gh_like", { issue, on });
  const s = readSet(LIKED); on ? s.add(id) : s.delete(id); writeSet(LIKED, s);
  return n;
}
