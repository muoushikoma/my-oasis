// api.storage：每个故事单独的小型本地数据（最高分、解锁、偏好），不随存档回滚，跨周目保留。整个故事最多 1 MB。
import type { StoryStorage } from "@my-oasis/engine";
const MAX = 1024 * 1024;
export function storyStorage(storyId: string): StoryStorage {
  const key = `oasis-store:${storyId}`;
  let data: Record<string, any> = {};
  try { data = JSON.parse(localStorage.getItem(key) ?? "{}") ?? {}; } catch { data = {}; }
  return {
    get: (k) => data[k],
    set: (k, v) => {
      const next = { ...data }; if (v === null) delete next[k]; else next[k] = v;
      const json = JSON.stringify(next);
      if (json.length > MAX) throw new Error("这个故事的本地数据超过 1 MB 了");
      data = next; try { localStorage.setItem(key, json); } catch { /* 存储满了：本次运行内仍有效 */ }
    },
  };
}
