# Request IR 纯契约索引

本目录只承载已供应 canonical 请求的结构、校验、选择和投影，不执行 Provider 或作品读取。总入口：[NovelCommon](../../../README.md)；契约：[VS-00M](../../../../../docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md)。

- [observation.ex](observation.ex)：观察块、状态校验、计划聚合叶及 Compaction 后实际可见材料；应用计划读取保留 application 来源，关联引用不生成材料。
- [scope.ex](scope.ex)：Scope 纯结构、事实来源和版本绑定，追加当前范围。
- [system_envelope.ex](system_envelope.ex)：产品身份与角色规则的稳定 system 信封。
- [operation.ex](operation.ex)：计划、使命、创作、评审共用的阶段请求构造。
- [tools.ex](tools.ex)：目录和当前工具选择的唯一查询视图。
- [compaction.ex](compaction.ex)：精确覆盖、压缩准入和消息可见视图。
- [message_coverage.ex](message_coverage.ex)：run/message 坐标、当前回合保护和来源核验。
- [discussion_summary.ex](discussion_summary.ex)：真实摘要响应格式、精确引用和义务投影。
- [projection.ex](projection.ex)：三种 Provider wire 的共同投影入口及文本语义。
- [projection/chat_completions.ex](projection/chat_completions.ex)：Chat Completions 请求投影。
- [projection/responses_api.ex](projection/responses_api.ex)：Responses 请求投影。
- [projection/anthropic_messages.ex](projection/anthropic_messages.ex)：Anthropic Messages 请求投影。

现有验证仍经公共 RequestIR 边界，见 [request_ir_test.exs](../../../test/novel_common/request_ir_test.exs) 与 [compaction_test.exs](../../../test/novel_common/request_ir/compaction_test.exs)；应用实际后继请求验证见 planned_exploration_material_test.exs。
