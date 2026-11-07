# NovelAgent

**TODO: Add description**

## Installation

If [available in Hex](https://hex.pm/docs/publish), the package can be installed
by adding `novel_agent` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:novel_agent, "~> 0.1.0"}
  ]
end
```

Documentation can be generated with [ExDoc](https://github.com/elixir-lang/ex_doc)
and published on [HexDocs](https://hexdocs.pm). Once published, the docs can
be found at <https://hexdocs.pm/novel_agent>.


## B71 R2 统一流式生命周期（VS-00L §19.3，2026-11-07）

- [sse_stream.ex](lib/novel_agent/provider/sse_stream.ex)：三 wire 共用的 SSE 传输生命周期（取消/静默窗口/总时长/帧分割/文本增量事件/终止分流）。
- [sse_stream/chat_decoder.ex](lib/novel_agent/provider/sse_stream/chat_decoder.ex)：Chat Completions delta——正文、tool_calls 分片、供应商私有 reasoning 增量。
- [sse_stream/anthropic_decoder.ex](lib/novel_agent/provider/sse_stream/anthropic_decoder.ex)：Anthropic Messages——text_delta、tool_use input_json 分片、usage、provider error。
- [sse_stream/responses_decoder.ex](lib/novel_agent/provider/sse_stream/responses_decoder.ex)：Responses SSE——output_text delta、function_call_arguments delta/done、output_item、completed/incomplete/failed。
- [sse_stream/result.ex](lib/novel_agent/provider/sse_stream/result.ex)：流终止物化与错误分类/超时诊断/日志（不伪造成功）。
- [responses_wire.ex](lib/novel_agent/provider/responses_wire.ex)：Responses output 单一解析（非流式与流式共用；`call_id` 为唯一工具身份，item id 不混用）。
- [responses_stream.ex](lib/novel_agent/provider/responses_stream.ex)：Responses SSE 入口。
- [responses_stream_test.exs](test/novel_agent/provider/responses_stream_test.exs)：B71 R2——failed/截断 fail-closed/incomplete/工具增量归一/取消/chunk 事件。
- [openai_responses_wire_test.exs](test/novel_agent/provider/openai_responses_wire_test.exs)：Responses route 级真实传输（`complete/4` 非流式 + `execute/5` SSE；能力声明 streaming=true）。

## B71 逐调用执行引用（VS-00L §16.9）

- [gateway_execution_refs_test.exs](test/novel_agent/provider/gateway_execution_refs_test.exs)：真实 Gateway → NativeToolExchange → canonical → LLMLog 配对；自动 `pcall/prun`、协议失败→重试两次引用逐项一致、传输失败无 assistant/假原生 id。
- [request_ir_execution_refs_test.exs](test/novel_agent/provider/request_ir_execution_refs_test.exs)：assistant 可选执行引用、重复原生 id 的 canonical 映射、三投影忽略内部字段、非法引用拒绝。
- [native_boundary_r1_test.exs](test/novel_agent/provider/native_boundary_r1_test.exs)：B71 R1 原生请求边界——prepare_request 不查默认 route、实际 route 能力门、route_hint/purpose 同源、Chat/Anthropic/Responses 经 Gateway 的 HTTP 原生 body 保真、DeepSeek 私有状态隔离。
- [slice_verify_test.exs](test/novel_agent/provider/slice_verify_test.exs)：质量卡 local 修订只改 finding 命中句段并保留范围外字节；可选 `SLICE_VERIFY_QUALITY_REVISION_RETRY=1` 只让当前修订首轮返回同工具空参数，且仅在同一 operation 历史出现该调用的 failed validation 后返回合法修订，不影响源 writer/evaluator。另含 B71 自然对话边界：原文登记先于“设定/主角”名词识别；真实 `## 待采纳候选` 目录按 ref/operation/title 唯一选目标，多候选歧义/缺目录/禁用操作诚实 `ask_author`。失败历史负例的非法 ref 仅在 `SLICE_VERIFY_PENDING_INVALID_REF=1` 且作者文本含 `B71_INVALID_PENDING_REF` 时注入，正常修订不触发。
- [pending_dialogue_input_test.exs](test/novel_agent/provider/pending_dialogue_input_test.exs)：原生候选目录与显式旧 `pending_adoptions` JSON 的统一解析；native 目录优先，`revision_of` 只合并同一 ref 的可见旧字段。
- [slice_verify.ex](test/support/provider/slice_verify.ex)：上述 fixture 的 test-support 实现与同次 Gateway 执行引用记录；生产 runtime 不注册。
- [pending_dialogue_input.ex](test/support/provider/pending_dialogue_input.ex)：仅 test-support 的请求材料规范化；只读模型实际收到的 prompt，不读 DB/ctx 中未提供的目标 ref。
- [provider/README.md](test/support/provider/README.md)：test-support provider 目录索引。Stub 已由 `lib/novel_agent/provider/` 移入 `test/support/provider/stub.ex`，生产 registry 不再注册，仅测试环境经 `config/test.exs` 的 `:extra_providers` 注入。
- [test/support/README.md](test/support/README.md)：test-support 目录索引。
