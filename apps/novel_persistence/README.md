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
