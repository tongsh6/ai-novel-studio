# test/support/provider

仅 test-support 的确定性 provider 与请求材料解析；生产 runtime 不注册。

- [stub.ex](stub.ex)：`NovelAgent.Provider.Stub` 离线 fixture provider（由 `lib` 移入）。只读 canonical `role/provenance/blocks`；`capabilities/1` 只模拟测试链路需要的六项传输形态，`projection_target/1` 为 `chat_completions`，用于通过 Gateway 按实际 route 派生的能力门，不代表真实传输/实模证据。测试环境由 `config/test.exs` 的 `:extra_providers` 显式注册。
- [stub_chapter_summary.ex](stub_chapter_summary.ex)：stub 与 SliceVerify 共用的章摘要确定性四栏 fixture。
- [slice_verify.ex](slice_verify.ex)：Tauri/Channel slice 验证用的确定性 provider。请求日志只记录实际收到的请求：canonical IR 用真实 `ir_version`，非 IR 如实标 `text/v1`；落盘前只裁剪 `message.provider_state/provider_session`，不修改原请求、不把重建文本写成实际请求。保留同次 Gateway 执行引用；自然对话 pending 修订只从“当前操作材料视图”读取当前 scope 目录与当前作者原话，consumer 与 helper 共用同一视图，不再把扁平历史交给 pending 目标选择。作者资料/候选处置由 `material_intent/1` 唯一分流（登记原文、修订/放弃候选、状态查询），优先于泛化“进度怎么样”章节匹配；状态回复只消费当前 scope 的实际 pending/resolved 与完整 `body_preview`，明确章节进度仍走真实章节统计。
- [pending_dialogue_input.ex](pending_dialogue_input.ex)：判断请求材料的唯一规范化入口。优先解析当前原生 `## 待采纳候选` 目录（ref/type/status/title/operations/body_preview）；旧格式只认当前 scope 的 `## 消息处置与已有产物` 段（非写判断的现役上下文段）。没有该段时不扫描裸 facts JSON，也不扫描资料原文等其它材料里的 JSON。旧 scope 只作历史，当前缺目录/空目录不回退；不跨 scope 补 `revision_of`，不把缺失当原稿，不读 DB/ctx。`candidate_state` 区分 `:parsed` / `:explicit_empty` / `:missing` / `:bad_format`，坏格式由 consumer 诚实询问作者。`material_state/1` 在同一当前 scope 上汇总实际 pending/resolved 供给（含 `supplied?` 与完整模型可见 `body_preview`）；当前缺失时不得用历史 scope 或章节统计补状态。
- [wire_tool_facts.ex](wire_tool_facts.ex)：离线替身读取工具事实的唯一入口。`%RequestIR{}` 委托 canonical `NovelCommon.RequestIR.Tools` 查询 API；legacy 文本形态只读调用方显式给出的 `tools`/`tool_choice`，不从文本猜工具。生产 Gateway 只接受 IR，本模块只让历史测试替身调用不因 API 收紧崩溃。
- 对应正式测试：`test/novel_agent/provider/stub_test.exs`、`test/novel_agent/provider/slice_verify_test.exs`、`test/novel_agent/provider/pending_dialogue_input_test.exs`、`test/novel_agent/provider/slice_verify_author_behavior_test.exs`。

`NovelTest.TestProviderPrompt`（离线替身请求材料读取）与 `NovelTest.TestRequestIR`
（canonical IR 测试夹具）已迁 `apps/novel_test/lib/novel_test/`：它们只依赖
`novel_common` 纯契约，跨 app 共享后由 `novel_test` app 承载；本目录只保留依赖
agent 运行时实现的确定性 provider 与材料解析。
