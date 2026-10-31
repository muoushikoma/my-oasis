// 服务商预设与申请教程（2026-10-31 按各家官方文档核实；标“待核实”的是没查到官方明确说明的地方）
export interface Provider {
  id: string; name: string; base_url: string; model: string; models?: string[]; needsKey: boolean;
  site?: string; keyPage?: string; steps: string[]; pay: string; china: string; note?: string; docs?: string;
}
export const PROVIDERS: Provider[] = [
  { id: "deepseek", name: "DeepSeek（深度求索）", base_url: "https://api.deepseek.com", model: "deepseek-flash", models: ["deepseek-flash", "deepseek-v4-pro"], needsKey: true,
    site: "https://platform.deepseek.com", keyPage: "https://platform.deepseek.com/api_keys", docs: "https://api-docs.deepseek.com/",
    steps: ["打开 DeepSeek 开放平台，用手机号注册并登录", "左侧菜单进入“充值”，先充一点钱（几块钱就够玩很久）", "左侧菜单进入“API keys”，点“创建 API key”，起个名字", "复制显示出来的 Key（只显示一次），粘贴到下面"],
    pay: "需要先充值（按用量扣费，价格很低）", china: "国内可以直接访问", note: "推荐新手首选：便宜、中文好、国内直连。" },
  { id: "qwen", name: "阿里通义千问（百炼 / DashScope）", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", models: ["qwen-plus", "qwen-max", "qwen-flash"], needsKey: true,
    site: "https://bailian.console.aliyun.com", keyPage: "https://bailian.console.aliyun.com/?tab=model#/api-key", docs: "https://help.aliyun.com/zh/model-studio/get-api-key",
    steps: ["用阿里云账号登录“阿里云百炼”控制台（需要实名认证）", "在“模型广场”里开通要用的模型（如通义千问 Plus）", "进入“API-KEY”页面，点“创建 API-KEY”", "复制 Key 粘贴到下面。注意：这里预设的是北京地域地址，Key 也必须是北京地域的，否则会报“Key 不对”"],
    pay: "新用户有免费额度（额度和有效期以控制台为准，待核实），用完后按量付费，需绑定支付方式", china: "国内可以直接访问", note: "海外账号请把地址换成新加坡地域：https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  { id: "kimi", name: "月之暗面 Kimi", base_url: "https://api.moonshot.cn/v1", model: "kimi-k3", models: ["kimi-k3", "kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k2.6"], needsKey: true,
    site: "https://platform.moonshot.cn", keyPage: "https://platform.moonshot.cn/console/api-keys", docs: "https://platform.kimi.com/docs/overview",
    steps: ["打开 Kimi 开放平台，用手机号注册登录", "在“账户”里充值（新用户是否赠送额度待核实）", "进入“API Key 管理”，点“新建”", "复制 Key 粘贴到下面"],
    pay: "按量付费，需要充值", china: "国内可以直接访问（海外用户用 https://api.moonshot.ai/v1）", note: "官方说明：2026-10-31 起新注册用户不能再用 K2 系列模型，请用 K3 系列。" },
  { id: "zhipu", name: "智谱 GLM", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.7-flash", models: ["glm-4.7-flash", "glm-5.3-flash", "glm-5.3"], needsKey: true,
    site: "https://open.bigmodel.cn", keyPage: "https://open.bigmodel.cn/usercenter/apikeys", docs: "https://docs.bigmodel.cn/cn/guide/start/quick-start",
    steps: ["打开智谱开放平台，注册并登录", "点右上角个人中心 → “API Keys”，创建新的 API Key（注意选“模型标准 API”，套餐的 Key 不通用）", "复制 Key 粘贴到下面"],
    pay: "GLM-4.7-Flash 是免费模型，可以不充值先试；其他模型按量付费", china: "国内可以直接访问", note: "免费模型适合先试玩；想要更好的效果可以换 glm-5.3（收费）。" },
  { id: "doubao", name: "字节豆包（火山方舟）", base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-2-1-lite-260915", models: ["doubao-seed-2-1-lite-260915", "doubao-seed-2-1-pro-260915", "doubao-seed-evolving"], needsKey: true,
    site: "https://console.volcengine.com/ark", keyPage: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey", docs: "https://ark.volcengine.com/region:cn-beijing/docs/base-url-and-authentication",
    steps: ["用火山引擎账号登录“火山方舟”控制台（需要实名认证）", "在“开通管理”里开通要用的豆包模型", "进入“API Key 管理”，创建 API Key", "复制 Key 粘贴到下面；模型名称填控制台里显示的 Model ID"],
    pay: "开通后按量付费，新用户是否有赠送额度以控制台为准（待核实）", china: "国内可以直接访问" },
  { id: "openai", name: "OpenAI（ChatGPT 的公司）", base_url: "https://api.openai.com/v1", model: "gpt-6-luna", models: ["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol"], needsKey: true,
    site: "https://platform.openai.com", keyPage: "https://platform.openai.com/api-keys", docs: "https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing",
    steps: ["打开 OpenAI 开发者平台（不是 chatgpt.com），登录", "进入 Billing（账单），绑定银行卡并预充值，最少 5 美元", "进入 API keys，点 “Create new secret key”", "复制 Key 粘贴到下面"],
    pay: "必须单独预充值。⚠️ ChatGPT Plus / Pro 会员只是聊天网页的订阅，不等于 API，会员费不能用来调用 API（官方近期给部分 Pro/Business 订阅者提供 API 赠送额度，需自己去领取）", china: "国内无法直接访问，且不支持国内银行卡，需要自行解决网络和支付" },
  { id: "claude", name: "Anthropic Claude", base_url: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"], needsKey: true,
    site: "https://platform.claude.com", keyPage: "https://platform.claude.com/settings/keys（待核实）", docs: "https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk",
    steps: ["打开 Claude 开发者平台（Console）注册登录", "在 Billing 里绑卡并购买额度", "在 API Keys 页面创建 Key", "复制 Key 粘贴到下面"],
    pay: "需要预付费购买额度；Claude.ai 的会员订阅同样不等于 API", china: "国内无法直接访问，需要自行解决网络", note: "这里用的是官方的 OpenAI 兼容接口，官方说明它主要用于测试，部分功能不支持。模型名以官方模型列表为准（待核实）。" },
  { id: "gemini", name: "Google Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash", models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"], needsKey: true,
    site: "https://aistudio.google.com", keyPage: "https://aistudio.google.com/apikey", docs: "https://ai.google.dev/gemini-api/docs/openai",
    steps: ["用 Google 账号登录 Google AI Studio", "点 “Get API key” → “Create API key”", "复制 Key 粘贴到下面"],
    pay: "有免费额度（有次数限制），超出或用高级模型需开通结算", china: "国内无法直接访问，需要自行解决网络" },
  { id: "openrouter", name: "OpenRouter（一个 Key 用多家模型）", base_url: "https://openrouter.ai/api/v1", model: "openrouter/auto", needsKey: true,
    site: "https://openrouter.ai", keyPage: "https://openrouter.ai/settings/keys", docs: "https://openrouter.ai/docs",
    steps: ["打开 OpenRouter 注册登录", "在 Credits 页面充值（支持银行卡，部分模型免费）", "在 Keys 页面点 “Create Key”", "复制 Key 粘贴到下面；模型名称可在官网模型列表里复制，如 deepseek/…、openai/…"],
    pay: "按量付费需充值；带 “:free” 后缀的模型免费但有限速", china: "国内能否直接访问待核实" },
  { id: "siliconflow", name: "硅基流动 SiliconFlow", base_url: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3-8B", models: ["Qwen/Qwen3-8B", "THUDM/GLM-4-9B-0414", "deepseek-ai/DeepSeek-V4.1-Flash"], needsKey: true,
    site: "https://cloud.siliconflow.cn", keyPage: "https://cloud.siliconflow.cn/account/ak", docs: "https://docs.siliconflow.cn",
    steps: ["打开硅基流动，用手机号注册登录", "完成实名认证（免费模型需要实名）", "进入“API 密钥”页面，新建 API 密钥", "复制 Key 粘贴到下面"],
    pay: "部分小模型免费（如 Qwen3-8B）；大模型按量付费需充值", china: "国内可以直接访问" },
  { id: "ollama", name: "Ollama（本机运行，不花钱）", base_url: "http://localhost:11434/v1", model: "qwen3:8b", needsKey: false,
    site: "https://ollama.com", docs: "https://ollama.com/download",
    steps: ["从官网下载并安装 Ollama", "打开命令行，运行：ollama pull qwen3:8b（下载模型，约几 GB；模型名以官网为准）", "保持 Ollama 在后台运行，回到这里点“测试连接”"],
    pay: "免费，但需要电脑配置较好（建议 16GB 内存以上，有独立显卡更快）", china: "安装包和模型下载可能较慢" },
  { id: "lmstudio", name: "LM Studio（本机运行，不花钱）", base_url: "http://localhost:1234/v1", model: "local-model", needsKey: false,
    site: "https://lmstudio.ai",
    steps: ["从官网下载安装 LM Studio", "在里面搜索并下载一个模型（如 Qwen3 8B）", "左侧进入 “Developer / 本地服务器”，点 Start Server", "把模型名称填成 LM Studio 里显示的模型标识，回到这里点“测试连接”"],
    pay: "免费，但需要电脑配置较好", china: "模型下载可能较慢" },
  { id: "custom", name: "自定义（任意 OpenAI 兼容接口）", base_url: "https://", model: "", needsKey: true,
    steps: ["填写服务商提供的“OpenAI 兼容接口地址”（通常以 /v1 结尾）", "填写模型名称", "粘贴 Key"], pay: "看服务商", china: "看服务商" },
];
export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];

/** 把模型服务的报错翻译成大白话 */
export function explainError(e: unknown): string {
  const m = String((e as any)?.message ?? e ?? "");
  const code = Number(m.match(/HTTP (\d{3})/)?.[1] ?? 0);
  const body = m.toLowerCase();
  if (/还没有填写 api key/i.test(m)) return "还没有填写 API Key。";
  if (/^network|error sending request|dns|connect|failed to fetch|networkerror|timed out|超时/i.test(m))
    return "网络不通：连不上这个服务商。请检查网络；OpenAI、Claude、Gemini 在国内需要自行解决网络；本机模型请确认 Ollama / LM Studio 已经在运行。";
  if (code === 402 || /insufficient|balance|余额|quota|credit|billing|arrear|欠费/.test(body))
    return "余额不足或没开通付费：请到服务商网站充值或开通结算后再试。";
  if (code === 401 || code === 403 || /invalid.*(api[_ ]?key|token)|unauthori|incorrect api key/.test(body))
    return "Key 不对：请确认复制完整、没有多余空格，并且 Key 和所选服务商（以及地域）对应。";
  if (code === 404 || /model.*(not|does not) exist|model_not_found|no such model|模型不存在|invalid model/.test(body))
    return "模型名称不对，或者接口地址填错了：请用教程里推荐的模型名，或到服务商控制台复制准确的模型名。";
  if (code === 429) return "请求太频繁，或者免费额度用完了：稍等一会儿再试，或到服务商网站查看额度。";
  if (code >= 500) return "服务商那边暂时出问题了，请稍后再试。";
  if (code === 400) return `服务商说请求不对（可能是模型名或参数不支持）：${m.slice(0, 160)}`;
  return `连接失败：${m.slice(0, 200)}`;
}
