# NovelApplication

**TODO: Add description**

## Installation

If [available in Hex](https://hex.pm/docs/publish), the package can be installed
by adding `novel_application` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:novel_application, "~> 0.1.0"}
  ]
end
```

Documentation can be generated with [ExDoc](https://github.com/elixir-lang/ex_doc)
and published on [HexDocs](https://hexdocs.pm). Once published, the docs can
be found at <https://hexdocs.pm/novel_application>.


## 消息闭环索引（ADR-0027）

- [lib/novel_application/turn_interaction_service.ex](lib/novel_application/turn_interaction_service.ex)：ADR-0027 消息接收、运行结果记录与历史来源校验入口。
- [test/novel_application/turn_interaction_service_test.exs](test/novel_application/turn_interaction_service_test.exs)：消息幂等、失败发布边界与来源回归。
- 完整切片：`tasks/slices/Q3D-message-outcome-roundtrip.md`。

## B26 / B27 共享入口

- [authoring_task_policy.ex](lib/novel_application/authoring_task_policy.ex)：单调用共同任务、明确问题来源与持久回复链的实现/验证；契约见 UA-01 §2.2 与 VS-00D §11。
- [judgment_tool_contract.ex](lib/novel_application/judgment_tool_contract.ex)：单调用共同任务、明确问题来源与持久回复链的实现/验证；契约见 UA-01 §2.2 与 VS-00D §11。
- [agent_plan_tool_contract.ex](lib/novel_application/agent_plan_tool_contract.ex)：单调用共同任务、明确问题来源与持久回复链的实现/验证；契约见 UA-01 §2.2 与 VS-00D §11。
- [author_question.ex](lib/novel_application/author_question.ex)：单调用共同任务、明确问题来源与持久回复链的实现/验证；契约见 UA-01 §2.2 与 VS-00D §11。
- [author_question_service.ex](lib/novel_application/author_question_service.ex)：单调用共同任务、明确问题来源与持久回复链的实现/验证；契约见 UA-01 §2.2 与 VS-00D §11。
- [author_question_roundtrip_test.exs](test/novel_application/author_question_roundtrip_test.exs)：单调用共同任务、明确问题来源与持久回复链的实现/验证；契约见 UA-01 §2.2 与 VS-00D §11。

## B47 canon freshness 决策编排

- [adoption_workflow.ex](lib/novel_application/adoption_workflow.ex)：采纳前从产品生成期 payload 抽取基线（B28 covered/expected_base_versions、B36 covered/base_versions、ADR-0029 source_hash、B29 base_fingerprint+旧值）→ 读持久 canon → `NovelDomain.CanonFreshness` 判定；持久化失败错误码分类；成功 receipt additive `canon_freshness` 前后版本。
- [adoption_boundary.ex](lib/novel_application/adoption_boundary.ex)：gate 顺序加入 contract→canon_freshness（先于 legacy 自报冲突/overwrite/高风险确认）；stale/conflict/missing/unavailable → `fail_with_recovery` 零写入。
- [集成测试](test/novel_application/b47_canon_freshness_adoption_test.exs)：stale/冲突零写入、TOCTOU 事务重 gate、重放幂等、覆盖确认重 gate、legacy 候选不误判；切片 `tasks/slices/B47-canon-freshness-and-conflict-detection.md` §8。

## B71 私有 canonical 恢复（VS-00L §16.8）

- [authoring_checkpoint.ex](lib/novel_application/authoring_checkpoint.ex)：v3 `authoring_transcript_ref` 与 v2 内嵌副本的统一选择/身份校验；损坏/错绑不回退旧副本，v2 缺身份如实 partial；有数据但缺版本按未知格式拒绝。
- [agent_run_history.ex](lib/novel_application/agent_run_history.ex)：work/session/turn 持久 run 身份的唯一解析边界；显式绑定、legacy parent/step、批量 row scope 与 scoped 批量读；显式畸形值 fail closed。
- [authoring_replay.ex](lib/novel_application/authoring_replay.ex)：消费统一 run 解析，严格校验 task header/run/work/parent 后读取 v3 或正确 v2 canonical；缺版本/错绑不补造。
- [agent_run_server.ex](lib/novel_application/agent_run_server.ex)：状态机、received/staged 转换与提交后发布；结果/问题/状态/压缩统一走 `AgentRunPersistence`，不再自带序列化与 durable task 写入细节。
- [agent_run_persistence.ex](lib/novel_application/agent_run_persistence.ex)：AgentRun snapshot 的唯一投影/写入请求边界；run/step/author-safe event、私有 checkpoint 编码调用与 durable task header/progress/step 投影，定义 delivery/status/compaction/question 四种事件语义；checkpoint_version 的唯一所属点。
- [agent_run_service.ex](lib/novel_application/agent_run_service.ex)：离线恢复复用同一私有选择/校验，不自动执行 Provider；durable task 初始 header 引用同一 checkpoint_version。`compact_transcript/1` 是作者显式压缩的唯一公共入口：只表达整理意图，不接收调用方压缩内容。
- [context_pressure.ex](lib/novel_application/context_pressure.ex)：B71 上下文压力只读派生（§16.16 自动维护入口）：真实 `ProviderRun.usage.input_tokens` + 保守模型窗口（provider 默认 + `NOVEL_CONTEXT_WINDOW_OVERRIDES` 运维覆盖，`parse_window_overrides/1`）；维护/硬线阈值只决定触发时机；usage 未知不猜测、不写库、不向作者展示。
- [transcript_compaction.ex](lib/novel_application/transcript_compaction.ex)：B71 显式压缩的唯一派生边界（VS-00L §16.2/§16.4；§18 维护派生）：`plan/1` 派生命中全部未覆盖完整交换，`plan_maintenance/2` 保留最近 K 项与当前工作回合（供安全点自动维护消费）；来源 refs/版本、作者安全摘要与省略说明；不调模型、不改写 transcript。
- [agent_run_server.ex](lib/novel_application/agent_run_server.ex)（§16.16 第 2 类入口）：安全点（step 完成后 / 进入 awaiting_author 前 / durable 恢复后首个调度）读 `ContextPressure` 真实 usage 压力，按 `:auto_maintenance` 配置自动发起上下文维护；失败静默保留旧 state、下一安全点重试；阈值只决定时机、不决定范围（保留最近 K 项、当前工作回合不整理）。
- [auto_maintenance_test.exs](test/novel_application/auto_maintenance_test.exs)：安全点自动维护：压力触发/未到/未知、当前回合、保留 K、未完成交换、配置关闭、幂等、失败静默+重试、payload 无技术词、取消后迟到结果不维护。
- [compaction_record.ex](lib/novel_application/compaction_record.ex)：压缩整理记录边界：构造 `checkpoint_created` 作者安全事件、与 checkpoint 同一边界先提交后发布、投影作者回执；事件构造失败只降级不阻塞压缩。
- [agent_run_compaction_event_test.exs](test/novel_application/agent_run_compaction_event_test.exs)：压缩整理记录的持久化/幂等/失败静默：durable 与 bounded 各一条，payload 无内部标识，SQL 拒写时无事件且内存不推进。
- [transcript_compaction_test.exs](test/novel_application/transcript_compaction_test.exs)：完整交换选择、未完成/重复结果/已覆盖排除、证据一致、作者可见回执无内部标识、空会话幂等、维护派生保留 K 项与当前工作回合。
- [agent_run_persistence_test.exs](test/novel_application/agent_run_persistence_test.exs)：delivery/status/compaction/question 四种 snapshot 请求语义与 durable task header 投影回归。
- [agent_run_runtime_test.exs](test/novel_application/agent_run_runtime_test.exs)：bounded 终局/失败留存、压缩回滚、v3 错 ref 不回退、v2 缺身份 partial 回归。
- [agent_run_history_binding_test.exs](test/novel_application/agent_run_history_binding_test.exs)：11 项 source/修订 child/旧数据/重载同源定位回归。
- [history_read_boundary_test.exs](test/novel_application/history_read_boundary_test.exs)：7 项真实持久负例（缺版本、task 身份、legacy scope、畸形显式绑定、批量 row 来源）。
- [authoring_checkpoint_test.exs](test/novel_application/authoring_checkpoint_test.exs)：私有列/v3 引用/旧 v2/缺版本选择边界。
- [agent_run_result_commit_test.exs](test/novel_application/agent_run_result_commit_test.exs)：结果提交/发布时序、失败与取消事实保留、原文去重及替换回滚回归。
- [共享测试生命周期支持](test/support/README.md)：application 与 web 共用的 AgentRun 测试收尾，Sandbox owner 由各测试模块自行管理。
- [authoring_execution_refs_test.exs](test/novel_application/authoring_execution_refs_test.exs)：assistant 执行引用经 checkpoint/真实写入边界的 JSON 恢复；旧 v1 不回填、非法引用拒绝、三投影字节等价（VS-00L §16.9）。

## B71 判断失败私有历史（VS-00L §16.7–16.8）

- [judgment_protocol.ex](lib/novel_application/judgment_protocol.ex)：成功/终局拒绝/传输错误统一返回真实私有会话 `{:error, reason, state}`；终局拒绝先用既有 `correction_transcript/2` 闭合末次原生调用，调用数只记本次实际 delta；纯前置/0 调用错误仍保持裸 error。
- [dialogue_planning_service.ex](lib/novel_application/dialogue_planning_service.ex)、[prose_drafting_with_quality.ex](lib/novel_application/agent_run_flows/prose_drafting_with_quality.ex)：判断/续行的生产消费者在协议失败、后置业务校验/派发/续行后处理失败时继承最新私有会话；inner 已带更新会话时不被较旧判断会话覆盖。
- [authoring_session.ex](lib/novel_application/agent_run_flows/authoring_session.ex)：`failure_state/1` 与 `inherit_failure/2` 复用既有 `transcript_state`/tuple3 carrier，不新增序列化副本；inner 的 flat/nested 私有会话先归并为唯一 flat canonical，显式 nil 不覆盖有效别名，两个非 nil 别名不一致时以固定安全 reason 拒绝，私有事实不进 reason/公开 TurnResult。
- [judgment_protocol_test.exs](test/novel_application/judgment_protocol_test.exs)：两次非法 pending ref 的终局拒绝保留 2 次实际调用、2 assistant+2 failed validation、原始参数/id 与 pcall/prun，且无第三次调用；混合校验/传输错误、全传输错误、0 调用前置错误与续行历史前缀回归。
- [agent_run_pending_revision_flow_test.exs](test/novel_application/agent_run_pending_revision_flow_test.exs)：真实 `Execution.dependency`/Gateway + `SliceVerify` 负例在作者消息带 `B71_INVALID_PENDING_REF` 且显式 test env 开启时注入非空非法 ref（不再依赖旧 fixture 的 null target/误路由），驱动真实 run 失败后，DB `authoring_transcript`、ProviderRun 与同次 JSONL 引用同一批调用，consumed 2、0 writer/canon；判断成功后的候选执行失败保留最新会话且预算不重算历史。
- [authoring_session_test.exs](test/novel_application/authoring_session_test.exs)：失败 carrier 只带真实调用数/transcript，inner 更新会话优先、缺会话时继承；nested/flat 归并、显式 nil、其他 nested 字段保留与不一致载体拒绝回归。

## B71 质量发现修订 fixture（VS-00E CP3 / VS-00L §16.7）

- [agent_run_prose_revision_flow_test.exs](test/novel_application/agent_run_prose_revision_flow_test.exs)：真实 `Execution.dependency`/Gateway + `SliceVerify` 驱动 `prose_revision_from_findings`；正常 1 次调用、可选测试 env 下 2 次同工具交换，首轮 failed validation 与真实 pcall/prun 保留，local finding 范围外字节不变，原稿/修订各自 tentative。

## B71 作者动作原子受理（VS-00L §16.10）

- [author_action_admission.ex](lib/novel_application/author_action_admission.ex)：质量发现修订的作者动作受理边界；`prepare/2` 生成不可变 receipt 身份与完整动作语义摘要，`admit/2` 在拥有 run 的 `AgentRunServer.init/1` 内同一事务核验持久 source、插入 receipt、提交初始 run 与 `run_started`，成功后调用方才发布并继续。
- [agent_run_server.ex](lib/novel_application/agent_run_server.ex)：`author_action_admission` 显式 spec 入口；成功后才发布已提交事件，duplicate/conflict/DB 失败不留下候选 run，也不发启动事件。
- [agent_run_service.ex](lib/novel_application/agent_run_service.ex)：`start_author_action/3`；duplicate 映射回原 receipt/run 并附订阅，不把重复当启动失败更新原 run。`receipt_run_facts/3` 为用户消息 receipt 与作者动作 receipt 共用同一执行事实读取边界：live 状态优先；Registry 明确无进程且持久 bounded run 非终态时复用既有 runtime-lost 收口；超时/未知结果不宣布已死；缺失/错 scope 明确失败。
- [action_idempotency_service.ex](lib/novel_application/action_idempotency_service.ex)：新版 receipt 按真实 run 作用域/trigger 校验并投影当前执行事实（含已提交 `turn_results`）；旧 payload-only receipt 保留历史边界；字段缺失按 legacy，存在但不支持的 `admission_version` 失败闭合；缺失/错绑明确 error；receipt 私有摘要字段不进入作者 payload。
- [action_idempotency_ledger.ex](lib/novel_application/action_idempotency_ledger.ex)：version 2 完整动作语义摘要（payload/target/behavior/candidate，排除每次重传的 `input_id`）；`admission_version/1` 统一区分缺失 legacy 与存在但不支持的非法版本。
- [workspace_channel_author_action_admission_test.exs](../novel_web/test/novel_web/channels/workspace_channel_author_action_admission_test.exs)：两个真实 `subscribe_and_join`/`push` Channel 进程并发同键、异语义冲突、receipt/run SQL 拒写（DB 无 run/event + topic 无 `run_started`）、终局/失败/运行丢失/迟到回执、来源与子结果分离、错 scope/过期/错 target、源权限不继承的真实 DB 回归。

## B71 Provider 执行事实有序提交（VS-00L §16.12）

- [provider_activity_projector.ex](lib/novel_application/provider_activity_projector.ex)：取消每事件后台 Task 与 test/prod 双路径；同一事件先由 `ProviderRunLog` 的单事务（SQLite 写意图先声明）提交 run/event/output，成功后才发布对应 stage 进展；持久失败只记安全诊断、不重发 Provider；保留取消 token、author narrative 与运行时禁用事实存储开关语义。
- [provider_activity_projector_test.exs](test/novel_application/provider_activity_projector_test.exs)：发布时 DB 已存在对应 run/event/output、冲突失败不发布且保留真实模型结果、author narrative 落库后发布、禁用开关回归。
- [test_helper.exs](test/test_helper.exs)：统一提供每次实际 Provider 调用唯一身份与 `assert_provider_fact_pairs/1` 持久配对断言；[agent_run_judgment_plan_flow_test.exs](test/novel_application/agent_run_judgment_plan_flow_test.exs)、[agent_run_prose_drafting_flow_test.exs](test/novel_application/agent_run_prose_drafting_flow_test.exs) 不再复用固定 writer/continuation 身份，[dialogue_planning_service_test.exs](test/novel_application/dialogue_planning_service_test.exs) 明确持有 Sandbox 连接，事实写入不再以 OwnershipError 日志噪音代替真实持久验证。
