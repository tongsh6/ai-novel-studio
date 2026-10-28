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
