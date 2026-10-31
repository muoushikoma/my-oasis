//! OpenAI 兼容流式响应（SSE）解析：把分块的文本与工具调用拼起来。
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct ToolCallAcc { pub id: String, pub name: String, pub arguments: String }

#[derive(Debug, Default)]
pub struct Accumulator { buf: String, pub content: String, pub tool_calls: Vec<ToolCallAcc>, pub done: bool, pub usage: Option<Usage> }

/// 服务商返回的用量（token 数）。不同服务商字段名不同，这里统一成输入/输出。
#[derive(Debug, Default, Clone, Copy, Serialize, PartialEq)]
pub struct Usage { pub input_tokens: u64, pub output_tokens: u64 }

/// 从一段响应 JSON 里找用量：OpenAI 兼容（usage.prompt_tokens / completion_tokens）、
/// Anthropic 风格（usage.input_tokens / output_tokens）、Gemini 原生（usageMetadata）。没有就返回 None。
pub fn parse_usage(v: &Value) -> Option<Usage> {
    let n = |x: &Value| x.as_u64();
    let u = &v["usage"];
    if u.is_object() {
        let i = n(&u["prompt_tokens"]).or_else(|| n(&u["input_tokens"]));
        let o = n(&u["completion_tokens"]).or_else(|| n(&u["output_tokens"]));
        if i.is_some() || o.is_some() { return Some(Usage { input_tokens: i.unwrap_or(0), output_tokens: o.unwrap_or(0) }); }
    }
    let g = &v["usageMetadata"];
    if g.is_object() {
        let i = n(&g["promptTokenCount"]); let o = n(&g["candidatesTokenCount"]);
        if i.is_some() || o.is_some() { return Some(Usage { input_tokens: i.unwrap_or(0), output_tokens: o.unwrap_or(0) }); }
    }
    None
}

#[derive(Debug, PartialEq)]
pub enum Delta { Text(String), Done }

impl Accumulator {
    /// 喂入一段原始字节（可能在任意位置被截断），返回新产生的文本增量
    pub fn feed(&mut self, chunk: &str) -> Vec<Delta> {
        self.buf.push_str(chunk);
        let mut out = vec![];
        while let Some(i) = self.buf.find('\n') {
            let line: String = self.buf.drain(..=i).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" { self.done = true; out.push(Delta::Done); continue; }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            // 用量一般在最后一块（OpenAI 需请求里带 stream_options.include_usage）；有的服务商每块都给累计值，取最后一次
            if let Some(u) = parse_usage(&v) { self.usage = Some(u); }
            let d = &v["choices"][0]["delta"];
            if let Some(t) = d["content"].as_str() { if !t.is_empty() { self.content.push_str(t); out.push(Delta::Text(t.to_string())); } }
            if let Some(tcs) = d["tool_calls"].as_array() {
                for tc in tcs {
                    let idx = tc["index"].as_u64().unwrap_or(0) as usize;
                    while self.tool_calls.len() <= idx { self.tool_calls.push(ToolCallAcc::default()); }
                    let acc = &mut self.tool_calls[idx];
                    if let Some(id) = tc["id"].as_str() { acc.id = id.to_string(); }
                    if let Some(n) = tc["function"]["name"].as_str() { acc.name.push_str(n); }
                    if let Some(a) = tc["function"]["arguments"].as_str() { acc.arguments.push_str(a); }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_split_text_and_tool_calls() {
        let mut a = Accumulator::default();
        let s = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"mo\",\"arguments\":\"{\\\"to\\\"\"}}]}}]}\n";
        let (x, y) = s.split_at(20);
        let mut d = a.feed(x); d.extend(a.feed(y));
        d.extend(a.feed("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"ve\",\"arguments\":\":\\\"海滩\\\"}\"}}]}}]}\ndata: [DONE]\n"));
        assert_eq!(d[0], Delta::Text("你好".into()));
        assert_eq!(a.content, "你好");
        assert_eq!(a.tool_calls, vec![ToolCallAcc { id: "c1".into(), name: "move".into(), arguments: "{\"to\":\"海滩\"}".into() }]);
        assert!(a.done);
        assert_eq!(a.usage, None);
    }
    #[test]
    fn parses_usage_variants() {
        let mut a = Accumulator::default();
        a.feed("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":120,\"completion_tokens\":35,\"total_tokens\":155}}\n");
        assert_eq!(a.usage, Some(Usage { input_tokens: 120, output_tokens: 35 }));
        let v: Value = serde_json::from_str("{\"usage\":{\"input_tokens\":7,\"output_tokens\":3}}").unwrap();
        assert_eq!(parse_usage(&v), Some(Usage { input_tokens: 7, output_tokens: 3 }));
        let v: Value = serde_json::from_str("{\"usageMetadata\":{\"promptTokenCount\":9,\"candidatesTokenCount\":4}}").unwrap();
        assert_eq!(parse_usage(&v), Some(Usage { input_tokens: 9, output_tokens: 4 }));
        let v: Value = serde_json::from_str("{\"usage\":null}").unwrap();
        assert_eq!(parse_usage(&v), None);
    }
}
