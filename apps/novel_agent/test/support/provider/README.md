# test/support/provider

仅 test-support 的确定性 provider 与请求材料解析；生产 runtime 不注册。

- [slice_verify.ex](slice_verify.ex)：Tauri/Channel slice 验证用的确定性 provider。保留同次 Gateway 执行引用；自然对话 pending 修订只从“当前操作材料视图”读取当前 scope 目录与当前作者原话，consumer 与 helper 共用同一视图，不再把扁平历史交给 pending 目标选择。作者资料/候选处置由 `material_intent/1` 唯一分流（登记原文、修订/放弃候选、状态查询），优先于泛化“进度怎么样”章节匹配；状态回复只消费当前 scope 的实际 pending/resolved 与完整 `body_preview`，明确章节进度仍走真实章节统计。
- [pending_dialogue_input.ex](pending_dialogue_input.ex)：判断请求材料的唯一规范化入口。优先解析当前原生 `## 待采纳候选` 目录（ref/type/status/title/operations/body_preview）；旧格式只读当前 scope（无 scope 时为本轮请求）的 `## 消息处置与已有产物` 段；只有明确无 scope 的当前请求才兼容作者段之前的裸 facts JSON。native scope 没有明确状态段时不扫描资料原文等其它材料里的 JSON。旧 scope 只作历史，当前缺目录/空目录不回退；不跨 scope 补 `revision_of`，不把缺失当原稿，不读 DB/ctx。`candidate_state` 区分 `:parsed` / `:explicit_empty` / `:missing` / `:bad_format`，坏格式由 consumer 诚实询问作者。`material_state/1` 在同一当前 scope 上汇总实际 pending/resolved 供给（含 `supplied?` 与完整模型可见 `body_preview`）；当前缺失时不得用历史 scope 或章节统计补状态。
- 对应正式测试：`test/novel_agent/provider/slice_verify_test.exs`、`test/novel_agent/provider/pending_dialogue_input_test.exs`、`test/novel_agent/provider/slice_verify_author_behavior_test.exs`。
