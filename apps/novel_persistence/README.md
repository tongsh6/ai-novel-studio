# NovelPersistence

**TODO: Add description**

## Installation

If [available in Hex](https://hex.pm/docs/publish), the package can be installed
by adding `novel_persistence` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:novel_persistence, "~> 0.1.0"}
  ]
end
```

Documentation can be generated with [ExDoc](https://github.com/elixir-lang/ex_doc)
and published on [HexDocs](https://hexdocs.pm). Once published, the docs can
be found at <https://hexdocs.pm/novel_persistence>.


## 消息闭环索引（ADR-0027）

- [lib/novel_persistence/interaction_lifecycle.ex](lib/novel_persistence/interaction_lifecycle.ex)：复用 Interaction 的接收/结果幂等持久化及同会话状态投影。
- [test/novel_persistence/interaction_lifecycle_test.exs](test/novel_persistence/interaction_lifecycle_test.exs)：原文不可变、采纳状态与作用域回归。
- 完整切片：`tasks/slices/Q3D-message-outcome-roundtrip.md`。

## B26 / B27 共享入口

- [author_question_repo.ex](lib/novel_persistence/author_question_repo.ex)：单调用共同任务、明确问题来源与持久回复链的实现/验证；契约见 UA-01 §2.2 与 VS-00D §11。

- [author_content_registration.ex](lib/novel_persistence/author_content_registration.ex)：B26 结果提交事务内重验原文来源，重复登记返回已有对象事实。

## B44 持久化 adoption 转换边界

- [status_transition.ex](lib/novel_persistence/status_transition.ex)：持久化 changeset 的状态转换守卫，矩阵策略由调用方注入（adoption 走 `NovelDomain.AdoptionStatus`；维护类走 `NovelDomain.MaintenanceArtifactStatus`），非法转换 error、同态 no-op 合法。
- [chapter_summary_repo.ex](lib/novel_persistence/chapter_summary_repo.ex)：章摘要全部写路径经 ADR-0019 矩阵守卫；`supersede_prior_accepted/2` 逐行 changeset + 事务更新，无 `update_all` 绕过。
- [reconciliation_report_repo.ex](lib/novel_persistence/reconciliation_report_repo.ex)：审读报告维护类替换（新报告 SUPERSEDE 旧 TENTATIVE）逐行 changeset + 事务；`update_all` 已移除，stale 报告不可再裁决翻成 ACCEPTED。
- 完整切片：`tasks/slices/B44-persistence-transition-boundary.md`。

## B47 canon freshness 只读快照

- [adoption_repository.ex](lib/novel_persistence/adoption_repository.ex)：B47 只读 `canon_snapshot/2`——章正文版本/format digest 复用 `accepted_chapter_scopes/2`，角色 fingerprint 复用 `character_profile_context/2`（与采纳事务重校验同源）；不建表、不写模型，错误面 `target_missing|target_ambiguous|cross_work_scope|unsupported_canon_object`。
- [读取测试](test/novel_persistence/b47_canon_freshness_read_test.exs)：章/角色快照、缺失/歧义/跨作品错误面；实现切片 `tasks/slices/B47-canon-freshness-and-conflict-detection.md` §7。

## B71 私有 canonical 历史（VS-00L §16.8）

- [agent_run_record.ex](lib/novel_persistence/schemas/agent_run_record.ex)：`agent_runs.authoring_transcript` nullable map；写边界拒绝清空、身份错绑与旧消息截断/覆写，同值/追加/纯状态更新允许。
- [migration 20261102000001](priv/repo/migrations/20261102000001_add_authoring_transcript_to_agent_runs.exs)：只新增私有列，不进入公开 schema/DTO。
- [agent_run_log.ex](lib/novel_persistence/agent_run_log.ex)：`commit_snapshot/2` 同一事务提交 run/step/event/durable checkpoint；事件插入错误回滚。
- [agent_run_authoring_transcript_test.exs](test/novel_persistence/agent_run_authoring_transcript_test.exs)：私有列身份/前缀/清空边界与跨表回滚回归。

## B71 作者动作原子受理存储（VS-00L §16.10）

- [author_action_receipt_repo.ex](lib/novel_persistence/author_action_receipt_repo.ex)：新增 `insert_strict/2`；唯一冲突明确返回 `:duplicate`，不把异 payload 吞为成功，既有 `record/2` 兼容语义保留给非修订动作。
- [schemas/author_action_receipt.ex](lib/novel_persistence/schemas/author_action_receipt.ex)：允许受理方显式提供 receipt id，把不可变 receipt 身份与结果中的 run 绑定写入同一行。
- [work_session_repo.ex](lib/novel_persistence/work_session_repo.ex)：`assistant_entries_by_run/3` 按 work+session+已提交 `agent_run_id` 读取 run 的 child Interaction，不按 parent 猜最新 run。
- [author_action_receipt_repo_test.exs](test/novel_persistence/author_action_receipt_repo_test.exs)：既有 receipt 记录/回放语义回归。

## B71 Provider 执行事实有序提交（VS-00L §16.12）

- [provider_run_log.ex](lib/novel_persistence/provider_run_log.ex)：run/event/output 的唯一持久提交边界；进入 read-compare-write 事务即声明 SQLite 写意图（`mode: :immediate`），复用既有 `busy_timeout`，不靠 sleep/次数重试；同一事务提交整批事实，冲突/写入失败回滚，重复事实幂等，晚到早期事件按真实 identity/sequence 留存且不回滚终态或清空输出；错误与正常载荷在比较/写入前统一为作者安全 JSON 形态，失败返回安全 error。
- [provider_fact_merge.ex](lib/novel_persistence/provider_fact_merge.ex)：纯归并判据——同调用身份/归属不可换绑、生命周期只前进、终态不互换、event/output 内容冲突拒绝；无 I/O，由 `ProviderRunLog` 真实消费。
- [provider_run_log_test.exs](test/novel_persistence/provider_run_log_test.exs)：乱序终态保护、完全重复幂等、同序/同 id 冲突、run/call/work/session 换绑、失败/取消终态、正常取消推进、整批回滚，以及 atom/string 等价实际 JSON 重放、真冲突回滚、隐私字段不落库和真实 Ecto 连接回调写意图回归。
