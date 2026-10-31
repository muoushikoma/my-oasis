//! OpenAI 兼容流式响应（SSE）解析：把分块的文本与工具调用拼起来。
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct ToolCallAcc { pub id: String, pub name: String, pub arguments: String }

#[derive(Debug, Default)]
pub struct Accumulator { buf: String, pub content: String, pub tool_calls: Vec<ToolCallAcc>, pub done: bool }

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
    }
}
