// 接 AI：服务商教程、粘贴 Key、测试连接；设置页和首次启动向导共用
import { h, toast } from "./dom";
import { bridge } from "./bridge";
import { PROVIDERS, providerById, explainError } from "./providers";
import { loadSettings, saveSettings, isLocalUrl, type Settings } from "./settings";

export async function testConnection(s: Settings): Promise<{ ok: boolean; msg: string }> {
  try {
    const r = await bridge.chat(s.provider, { base_url: s.base_url, model: s.model }, { messages: [{ role: "user", content: "只回复一个字：好" }], max_tokens: 20 });
    return { ok: true, msg: `连接成功！模型回复：${(r.content ?? "").trim().slice(0, 30) || "（空）"}` };
  } catch (e) { return { ok: false, msg: explainError(e) }; }
}

/** 服务商选择 + 一步步教程 + Key + 测试 */
export function providerSetup(onSaved?: () => void, onTestOk?: () => void): HTMLElement {
  const s = loadSettings();
  const root = h("div", { class: "setup" });
  const draw = async () => {
    const p = providerById(s.provider);
    const has = isLocalUrl(s.base_url) ? true : await bridge.keyHas(s.provider).catch(() => false);
    const status = h("div", { class: "test-status" });
    const url = h("input", { value: s.base_url, oninput: (e: any) => (s.base_url = e.target.value.trim()) }) as HTMLInputElement;
    const model = h("input", { value: s.model, list: "model-list", oninput: (e: any) => (s.model = e.target.value.trim()) }) as HTMLInputElement;
    const key = h("input", { type: "password", autocomplete: "off", placeholder: has ? "已保存（要更换就粘贴新的）" : "在这里粘贴 API Key" }) as HTMLInputElement;
    const save = async () => {
      if (!/^https:\/\//.test(s.base_url) && !isLocalUrl(s.base_url)) { toast("接口地址必须以 https:// 开头（本机模型可以用 http://localhost）", "err"); return false; }
      if (!s.model) { toast("请填写模型名称", "err"); return false; }
      saveSettings({ ...loadSettings(), provider: s.provider, base_url: s.base_url, model: s.model });
      if (key.value.trim()) { try { await bridge.keySet(s.provider, key.value.trim()); key.value = ""; } catch (e: any) { toast(`保存 Key 失败：${e?.message ?? e}`, "err"); return false; } }
      return true;
    };
    root.replaceChildren(
      h("label", {}, "选择服务商", h("select", { onchange: (e: any) => { s.provider = e.target.value; const q = providerById(s.provider); s.base_url = q.base_url; s.model = q.model; draw(); } },
        ...PROVIDERS.map((x) => h("option", { value: x.id, selected: x.id === s.provider }, x.name)))),
      h("div", { class: "guide" },
        h("div", { class: "facts" },
          h("span", {}, `💰 ${p.pay}`), h("span", {}, `🌐 ${p.china}`)),
        p.note ? h("p", { class: "small" }, `💡 ${p.note}`) : null,
        h("ol", {}, ...p.steps.map((t) => h("li", {}, t))),
        h("div", { class: "row small" },
          p.site ? h("span", {}, "官网：", h("a", { href: p.site, target: "_blank" }, p.site)) : null,
          p.keyPage ? h("span", {}, "创建 Key：", h("a", { href: p.keyPage.replace(/（.*$/, ""), target: "_blank" }, p.keyPage)) : null)),
      h("label", {}, "接口地址（已自动填好，一般不用改）", url),
      h("label", {}, "模型名称（已填推荐模型，可改）", model, h("datalist", { id: "model-list" }, ...(p.models ?? []).map((m) => h("option", { value: m })))),
      p.needsKey ? h("label", {}, "API Key", key) : h("p", { class: "small muted" }, "本机模型不需要 Key。"),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: async () => { if (await save()) { toast("已保存"); onSaved?.(); draw(); } } }, "保存"),
        h("button", { onclick: async () => { if (!(await save())) return; status.textContent = "正在测试…"; status.className = "test-status"; const r = await testConnection(s); status.textContent = r.msg; status.className = `test-status ${r.ok ? "ok" : "bad"}`; if (r.ok) setTimeout(() => (onTestOk ?? onSaved)?.(), 900); } }, "保存并测试连接"),
        p.needsKey && has ? h("button", { onclick: async () => { await bridge.keyDelete(s.provider).catch(() => {}); toast("已删除这个服务商的 Key"); draw(); } }, "删除 Key") : null,
        h("span", { class: "muted small" }, p.needsKey ? (has ? "✅ Key 已保存在系统钥匙串" : "还没有 Key") : "")),
      status,
      h("p", { class: "small muted" }, "Key 只保存在这台电脑的系统钥匙串（Windows 凭据管理器），界面拿不到原文，请求由客户端后台代发；不会进存档，也不会上传。"));
  };
  draw();
  return root;
}

/** 首次启动向导 */
export function showWizard(done: () => void) {
  let step = 0;
  const m = h("div", { class: "modal" });
  const finish = () => { saveSettings({ ...loadSettings(), onboarded: true }); m.remove(); done(); };
  const draw = () => {
    const pages = [
      () => [h("h2", {}, "欢迎来到我的绿洲 🌴"),
        h("p", {}, "这里有两件事可以做："),
        h("ul", {}, h("li", {}, h("b", {}, "游玩："), "导入别人或 AI 写好的故事包，开始冒险。"), h("li", {}, h("b", {}, "创作："), "阅读创作规范，或者让 AI 帮你把一个想法写成完整的故事。")),
        h("p", {}, "很多故事需要接一个 AI 模型来讲故事。接下来花两分钟把 AI 接好（也可以先跳过，纯规则的故事不需要 AI）。"),
        h("div", { class: "row" }, h("button", { class: "primary", onclick: () => { step = 1; draw(); } }, "开始设置 AI"), h("button", { onclick: finish }, "先跳过"))],
      () => [h("h2", {}, "第 1 步：选一个 AI 服务商，照着教程拿到 Key"),
        h("p", { class: "small muted" }, "不知道选哪个？国内用户推荐 DeepSeek（便宜、直连）或智谱 GLM（有免费模型）；电脑配置好也可以用 Ollama 在本机免费运行。注意：ChatGPT Plus 会员不等于 API，API 要单独充值。"),
        providerSetup(undefined, () => { step = 2; draw(); }),
        h("div", { class: "row" }, h("button", { onclick: () => { step = 0; draw(); } }, "上一步"), h("button", { onclick: finish }, "先跳过"))],
      () => [h("h2", {}, "✅ AI 已经接好了"), h("p", {}, "以后可以随时在“设置”里更换服务商或模型。现在去故事库导入你的第一个故事，或者到“创作”里让 AI 帮你写一个。"),
        h("div", { class: "row" }, h("button", { class: "primary", onclick: finish }, "完成"))],
    ];
    m.replaceChildren(h("div", { class: "card wizard" }, ...pages[step]()));
  };
  draw(); document.body.append(m);
}
