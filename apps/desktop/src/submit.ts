// 投稿：GitHub 登录（Device Flow）+ 一键上传投稿 + 我的投稿状态。不登录也能浏览、下载、游玩。
import { validateFiles, type StoryFiles } from "@my-oasis/schema";
import { h, toast } from "./dom";
import { bridge, bytesToB64 } from "./bridge";
import { issuesView } from "./issues";

export interface PrInfo { number: number; url: string; title: string; state: string; merged: boolean; checks: string; updated_at: string }
interface Source { label: string; files: () => StoryFiles }

const PR_BODY = (meta: any, ai: boolean) => `## 投稿信息 / Submission / 投稿情報

- 故事名称：${meta.title}
- 文件夹（= meta.id）：\`stories/${meta.id}/\`
- 是否需要 AI：${ai ? "是" : "否"}
- 分级：${meta.rating ?? "?"}

## 自检

- [x] 我只改动了 \`stories/${meta.id}/\` 里的文件（由客户端自动生成）
- [x] 文件夹名和 \`story.yaml\` 里的 \`meta.id\` 一样
- [x] 在客户端里格式检查通过
- [x] 不含色情内容，也没有血腥猎奇、仇恨、违法等不适合公开发布的内容
- [x] 文字、图片、音乐都是我自己创作的，或者我有权使用
- [x] 没有放任何 API Key、密码或个人隐私信息
- [x] 同意以本仓库的规则公开发布（版权仍归我，授权平台分发），维护者可以拒绝或下架

_由「我的绿洲」客户端提交_`;

export function prStatus(p: PrInfo): [string, string] {
  if (p.merged) return ["已上架", "ok"];
  if (p.state === "closed") return ["未通过（已关闭）", "err"];
  if (p.checks === "failed") return ["格式检查没通过，点链接看原因", "err"];
  if (p.checks === "running" || p.checks === "waiting") return ["正在自动检查格式", ""];
  return ["等待维护者审核", ""];
}

export function submitView(drafts: { title: string; files: () => StoryFiles }[], guide: () => HTMLElement): HTMLElement {
  const root = h("div", {});
  const acct = h("div", { class: "card" });
  const mine = h("div", {});
  const work = h("div", {});
  let login: string | null = null, configured = false;

  const drawAcct = async () => {
    acct.replaceChildren(h("p", { class: "muted" }, "正在检查 GitHub 登录状态…"));
    try { const s = await bridge.gh<{ configured: boolean; login: string | null }>("gh_status"); login = s.login; configured = s.configured; }
    catch (e: any) { acct.replaceChildren(h("div", { class: "notice" }, `检查登录失败：${e?.message ?? e}`), h("button", { onclick: drawAcct }, "重试")); return; }
    if (login) {
      acct.replaceChildren(h("div", { class: "row" }, h("span", {}, "已登录 GitHub："), h("b", {}, login), h("span", { class: "spacer" }),
        h("button", { onclick: async () => { await bridge.gh("gh_logout"); toast("已退出登录"); drawAcct(); } }, "退出登录")));
    } else {
      acct.replaceChildren(h("h3", {}, "登录 GitHub 才能上传投稿"),
        h("p", { class: "small muted" }, "浏览、下载、游玩都不用登录。投稿需要一个免费的 GitHub 账号；客户端只申请“操作公开仓库”的权限，用来帮你复制仓库、提交投稿。登录凭证存在系统的安全存储里（Windows 凭据管理器 / 安卓 Keystore），不会上传到别处。"),
        configured ? h("button", { class: "primary", onclick: startLogin }, "用 GitHub 登录") : h("div", { class: "notice" }, "GitHub 登录暂未开放（登录应用还没登记好）。现在可以按下面的手动步骤在网页上投稿。"));
    }
    drawWork(); drawMine();
  };

  const startLogin = async () => {
    let dc: any;
    try { dc = await bridge.gh("gh_device_start"); } catch (e: any) { return toast(e?.message ?? String(e), "err"); }
    let cancelled = false, interval = Math.max(5, dc.interval ?? 5);
    acct.replaceChildren(h("h3", {}, "在浏览器里确认登录"),
      h("ol", {}, h("li", {}, "点下面的按钮打开 GitHub 网页（或手动打开 ", h("code", {}, dc.verification_uri), "）。"),
        h("li", {}, "输入这个验证码：", h("b", { class: "code-big" }, dc.user_code), " ", h("button", { onclick: () => navigator.clipboard?.writeText(dc.user_code).then(() => toast("已复制验证码")) }, "复制")),
        h("li", {}, "点“Authorize”授权，回到这里会自动完成登录。")),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => bridge.openUrl(dc.verification_uri) }, "打开 GitHub 网页"), h("button", { onclick: () => { cancelled = true; drawAcct(); } }, "取消")),
      h("p", { class: "small muted" }, "等待授权中…"));
    const deadline = Date.now() + (dc.expires_in ?? 900) * 1000;
    while (!cancelled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval * 1000));
      if (cancelled) return;
      try {
        const p = await bridge.gh<any>("gh_device_poll", { deviceCode: dc.device_code });
        if (p.status === "ok") { toast("登录成功"); return drawAcct(); }
        if (p.status === "slow_down") interval = p.interval ?? interval + 5;
        if (p.status === "denied") { toast("你在 GitHub 上拒绝了授权", "err"); return drawAcct(); }
        if (p.status === "expired") break;
      } catch (e: any) { toast(e?.message ?? String(e), "err"); return drawAcct(); }
    }
    if (!cancelled) { toast("验证码过期了，请重新登录", "err"); drawAcct(); }
  };

  const drawWork = () => {
    if (!login) { work.replaceChildren(); return; }
    const out = h("div", {});
    const choose = async (src: Source) => {
      const files = src.files(), res = validateFiles(files);
      if (!res.ok || !res.story) { out.replaceChildren(h("h3", {}, `“${src.label}”还有问题，改好才能投稿`), issuesView(res)); return; }
      const meta: any = res.story.meta, ai = /"content":"ai"/.test(JSON.stringify(res.story)) || !!(res.story as any).ai;
      const ok = h("input", { type: "checkbox" }) as HTMLInputElement;
      const btn = h("button", { class: "primary" }, "上传投稿") as HTMLButtonElement;
      btn.onclick = async () => {
        if (!ok.checked) return toast("请先勾选确认", "err");
        btn.disabled = true; btn.textContent = "上传中…（第一次会先帮你复制仓库，可能要半分钟）";
        try {
          const list = [...files].map(([path, data]) => ({ path, base64: bytesToB64(data) }));
          const pr = await bridge.gh<PrInfo>("gh_submit", { id: meta.id, title: meta.title, body: PR_BODY(meta, ai), files: list });
          out.replaceChildren(h("div", { class: "card" }, h("h3", {}, "✅ 投稿已提交"), h("p", {}, `编号 #${pr.number}。系统会先自动检查格式，然后等维护者审核；合并后就会出现在在线故事库里。`),
            h("div", { class: "row" }, h("button", { class: "primary", onclick: () => bridge.openUrl(pr.url) }, "在 GitHub 上查看"), h("code", {}, pr.url))));
          drawMine();
        } catch (e: any) { toast(`上传失败：${e?.message ?? e}`, "err"); btn.disabled = false; btn.textContent = "上传投稿"; }
      };
      out.replaceChildren(h("div", { class: "card" }, h("h3", {}, `准备投稿：${meta.title}`),
        h("p", { class: "small muted" }, `会放到 stories/${meta.id}/，共 ${files.size} 个文件。分级：${meta.rating ?? "?"}；${ai ? "需要 AI" : "纯规则"}。如果这个 id 已经上架，会作为新版本覆盖（记得把 meta.version 改大）。`),
        h("label", { class: "row" }, ok, h("span", {}, "我确认：不含色情等不适合公开的内容；文字和素材是我原创或有权使用；没有 Key 或隐私信息。版权仍归我，同意授权本平台公开分发。")),
        h("div", { class: "row" }, btn)));
    };
    work.replaceChildren(h("div", { class: "card" }, h("h3", {}, "上传投稿"),
      h("p", { class: "small muted" }, "选一个故事包或草稿，客户端会先检查格式，再自动帮你提交投稿（复制仓库、建分支、提交 PR 全自动）。"),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: async () => { try { const p = await bridge.pickPackage(false); if (p) choose({ label: p.name, files: () => p.files }); } catch (e: any) { toast(`读取失败：${e?.message ?? e}`, "err"); } } }, "选择故事包"),
        h("button", { onclick: async () => { try { const p = await bridge.pickPackage(true); if (p) choose({ label: p.name, files: () => p.files }); } catch (e: any) { toast(`读取失败：${e?.message ?? e}`, "err"); } } }, "选择文件夹"),
        ...drafts.slice(0, 6).map((d) => h("button", { onclick: () => choose({ label: d.title, files: d.files }) }, `草稿：${d.title}`))),
      out));
  };

  const drawMine = async () => {
    if (!login) { mine.replaceChildren(); return; }
    mine.replaceChildren(h("p", { class: "muted" }, "正在读取我的投稿…"));
    try {
      const prs = await bridge.gh<PrInfo[]>("gh_my_prs");
      mine.replaceChildren(h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "我的投稿"), h("span", { class: "spacer" }), h("button", { onclick: drawMine }, "刷新")),
        prs.length ? h("div", { class: "pr-list" }, ...prs.map((p) => { const [t, k] = prStatus(p); return h("div", { class: "pr-row" },
          h("span", {}, `#${p.number} ${p.title}`), h("span", { class: `tag ${k}` }, t), h("button", { onclick: () => bridge.openUrl(p.url) }, "查看")); }))
          : h("p", { class: "muted" }, "还没有投稿。")));
    } catch (e: any) { mine.replaceChildren(h("div", { class: "notice" }, `读取投稿失败：${e?.message ?? e}`)); }
  };

  const manual = h("details", {}, h("summary", {}, "不想登录？看手动在网页上投稿的步骤"), guide());
  root.append(acct, work, mine, manual);
  drawAcct();
  return root;
}
