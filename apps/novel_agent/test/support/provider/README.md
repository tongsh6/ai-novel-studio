# test/support/provider

仅 test-support 的确定性 provider 与请求材料解析；生产 runtime 不注册。

- [stub.ex](stub.ex)：`NovelAgent.Provider.Stub` 离线 fixture provider（由 `lib` 移入）。只读 canonical `role/provenance/blocks`；`capabilities/1` 只模拟测试链路需要的六项传输形态，`projection_target/1` 为 `chat_completions`，用于通过 Gateway 按实际 route 派生的能力门，不代表真实传输/实模证据。测试环境由 `config/test.exs` 的 `:extra_providers` 显式注册。
- [stub_chapter_summary.ex](stub_chapter_summary.ex)：stub 与 SliceVerify 共用的章摘要确定性四栏 fixture。
- [slice_verify.ex](slice_verify.ex)：Tauri/Channel slice 验证用的确定性 provider。请求日志只记录实际收到的请求：canonical IR 用真实 `ir_version`，非 IR 如实标 `text/v1`；落盘前只裁剪 `message.provider_state/provider_session`，不修改原请求、不把重建文本写成实际请求。保留同次 Gateway 执行引用；自然对话 pending 修订只从“当前操作材料视图”读取当前 scope 目录与当前作者原话，consumer 与 helper 共用同一视图，不再把扁平历史交给 pending 目标选择。作者资料/候选处置由 `material_intent/1` 唯一分流（登记原文、修订/放弃候选、状态查询），优先于泛化“进度怎么样”章节匹配；状态回复只消费当前 Scope 的真实候选身份、标题、状态、修订关系与计数/覆盖，不重复正文。作品人物/章节判断通过实际 archive_read 观察；专业 planner 仍使用其独立选材后的章节事实。
- [slice_verify_pending_revision.ex](slice_verify_pending_revision.ex)：`NovelAgent.Test.Provider.SliceVerifyPendingRevision` 持有普通待采纳候选修订 fixture 的当前 Scope 任务识别与全文改名产物；`matches?/1`、`items/2` 由 SliceVerify 同序分派消费，原请求指纹、正文其余字节与输出结构保持。对应 `test/novel_agent/provider/slice_verify_pending_revision_fixture_test.exs` 两项经真实 `Real.request_ir/1` 与主替身的独立黄金回归。
- [pending_dialogue_input.ex](pending_dialogue_input.ex)：判断候选材料的唯一规范化入口。只读最新原生 Scope 的 `context.interaction_state` 元数据与同 Scope 的 `operation.pending_artifact_targets` 许可；旧 Scope、自然语言段落、作者引用的 JSON 不升级为应用事实，不跨 Scope 补 `revision_of`，不读 DB。`candidate_state` 区分 `:parsed` / `:explicit_empty` / `:missing` / `:bad_format`；`material_state/1` 汇总实际 pending/resolved 身份、状态、标题、修订关系和独立计数/覆盖，缺材料保持未知，不以历史或章节统计补值。
- [wire_tool_facts.ex](wire_tool_facts.ex)：离线替身读取工具事实的唯一入口。`%RequestIR{}` 委托 canonical `NovelCommon.RequestIR.Tools` 查询 API；legacy 文本形态只读调用方显式给出的 `tools`/`tool_choice`，不从文本猜工具。生产 Gateway 只接受 IR，本模块只让历史测试替身调用不因 API 收紧崩溃。
- 对应正式测试：`test/novel_agent/provider/stub_test.exs`、`test/novel_agent/provider/slice_verify_test.exs`、`test/novel_agent/provider/pending_dialogue_input_test.exs`、`test/novel_agent/provider/slice_verify_author_behavior_test.exs`。
- 专项 owner：`test/novel_agent/provider/slice_verify_quality_revision_fixture_test.exs` 承接原有质量局部修订/重试隔离模块；`slice_verify_pending_revision_fixture_test.exs` 持有经真实 `Real.request_ir/1` 构建的普通待采纳候选修订识别与正文原字节保留，覆盖旧前缀引用不得改变任务类型；`slice_verify_log_test.exs` 持有记录与私有字段裁剪；`slice_verify_canonical_ir_test.exs` 持有真实消息/观察材料读取边界。测试连同依赖生命周期按职责迁移，不复制 provider 或删除断言。


`NovelTest.TestProviderPrompt`（离线替身请求材料读取）与 `NovelTest.TestRequestIR`
（canonical IR 测试夹具）已迁 `apps/novel_test/lib/novel_test/`：`visible_observations/1` 复用实际 Compaction 可见投影与原 Observation 叶，替身不从累计 refs 或文字反推已读；它们只依赖
`novel_common` 纯契约，跨 app 共享后由 `novel_test` app 承载；本目录只保留依赖
agent 运行时实现的确定性 provider 与材料解析。
