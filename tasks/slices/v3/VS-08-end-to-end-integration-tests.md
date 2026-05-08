# VS-08 End-to-End Integration Tests

> 状态：docs-ready（2026-05-09）
>
> 角色：用真实 provider（LM Studio `openai/gpt-oss-120b`）+ 真实 persistence（SQLite3）跑通全链路，证明 v3 主链在所有关键路径上可端到端运行。

---

## 1. Contract

本 slice 消费全部 10 个 contract pack 的集成行为：

| Contract Pack | 集成测试验证 |
|---|---|
| VS-00 | 真实 LLM → DialogueFrame → TurnResult → Channel broadcast |
| VS-00A | exploration frame → `candidate_directions` 不为空（真实 LLM 输出） |
| VS-00B | `ContextAssembler` 从 SQLite3 读取真实上下文 → Planner prompt 包含上下文 |
| VS-01 | MicroPlan → GateOrder → OrchestratorDecision（multi-step → downgrade） |
| VS-02 | `ToolRequest` 必须有 `decision_ref`（`@enforce_keys` 编译期保障 + Toolbox.execute 运行时拒绝） |
| VS-02A | creative `ToolResult` → `TentativeArtifactSet` → `adoption_status: :tentative` |
| VS-03 | confirmation → `BehaviorState` 打开 → `available_actions` 包含 confirm/cancel |
| VS-04 | `CandidateSet` → `AdoptionBoundary.evaluate` → `AdoptionDecision` |
| VS-05 | `ActionValidator`：stale / invented / disabled action 被拒绝 |
| VS-06 | `ReplayReport` 从真实 trace 构建，`provider_called == false` |

## 2. Invariant

| # | Invariant (`00c` §7) | 集成测试如何验证 |
|---|---|------|
| #1 | 每 turn 必有 frame | 所有测试路径 assert `turn_result.frame_ref != nil` |
| #2 | MicroPlan 只是建议 | 多步 MicroPlan → `decision_type: :downgrade_to_dialogue`，无 action 被执行 |
| #3 | Orchestrator 唯一门禁 | `ToolRequest` 的 `@enforce_keys [:decision_ref]` 编译期阻止无 decision 的请求；`Toolbox.execute` 运行时检查 `decision_ref` 存在 |
| #5 | 工具调用有 trace | `TraceWriter.record_with_tool` → trace 写入 SQLite3 → `TraceRepository.list_by_turn` 可查询 |
| #6 | 写入默认 tentative | 创作生成 → `TentativeArtifactSet.adoption_status == :tentative` |
| #9 | TurnResult canonical | 所有主链路径最终输出 TurnResult map |
| #14 | replay 不调 LLM | `ReplayService.build_report` 只读 trace，不调用 `Gateway.complete` |
| #15 | projection hints 只触发刷新 | `AdoptionBoundary.evaluate` 仅在 `:adopt_tentative` 决策时生成 projection_hints |

## 3. Boundary

```text
novel_web (Phoenix.ChannelTest)
  → novel_application (DialogueGateway with real LMStudio complete_fn)
    → novel_agent (LMStudio HTTP POST → parse JSON response)
    → novel_domain (DialogueFrame.validate, MicroPlan.check_forbidden, etc.)
    → novel_persistence (SQLite3 Sandbox: trace write + context read)
  → Channel broadcast → assert on turn_result payload
```

切穿全部 5 个 umbrella app（`novel_web`, `novel_application`, `novel_agent`, `novel_domain`, `novel_persistence`），用真实 LM Studio HTTP 调用和真实 SQLite3 读写。

## 4. Consumer

**CI pipeline**：`mix test --include integration`（或专门的 `mix test.integration` alias）。

集成测试放在 `apps/novel_web/test/integration/`，使用 `@moduletag :integration`。默认 `mix test` 排除（`ExUnit.start(exclude: [:integration, :real_llm])`），CI 中 **依序** 启用（VS-07 完成后再启用 VS-08）。

## 5. Proof

| # | Proof | 测试场景 | 关键断言 |
|---|---|------|------|
| 1 | reply-only E2E | `%{text: "你好，聊聊创作"}` → `handle_input` | `frame.frame_type != nil`, `trace.decision_type == :reply_only`, `turn_result.truthfulness.tool_called == false` |
| 2 | exploration E2E | `%{text: "赛博修仙怎么切入？"}` → `handle_input` | `frame.frame_type` 可能是 exploration（真实 LLM 判定），`turn_result.assistant_message.text` 不含表单式提示 |
| 3 | context E2E | 先插入 workspace + interaction → 再发消息 | 有 context 时 `context.context_refs != []`；无 context 时 `context_refs == []` |
| 4 | downgrade E2E | `%{text: "重写第一章+更新角色+整理伏笔", generate_micro_plan: true}` | `decision.decision_type == :downgrade_to_dialogue`, `OrchestratorDecision.blocks_execution?(decision) == true` |
| 5 | confirmation E2E | `%{text: "直接替换正文", generate_micro_plan: true}`（高风险） | `decision.decision_type == :require_confirmation`, `behavior != nil`, `behavior.behavior_type == :confirmation` |
| 6 | tool dispatch E2E | 单步低风险 capability_invocation | `decision.decision_type == :allow_tool`, `result.status == :succeeded`, trace 可查询 |
| 7 | creative artifact E2E | creative_generation tool dispatch | `TentativeArtifactSet` 非空，`artifact_set.adoption_status == :tentative` |
| 8 | action validation E2E | `ActionValidator.validate` 各种输入 | stale → `{:error, "stale..."}`, invented → `{:error, "invented..."}`, disabled → `{:error, "disabled..."}` |
| 9 | replay E2E | 从任意 trace 构建 ReplayReport | `report.provider_called == false`, `report.result_status in [:complete, :partial]` |
| 10 | persistence E2E | 任意 turn 后查询 DB | `TraceRepository.list_by_turn(turn_id) != []`, trace 字段完整 |
| 11 | error recovery E2E | 传入 `broken_fn` → 返回 garbage JSON | `fallback_frame.author_visible_draft.message != ""`, `trace.decision_type == :fail_with_recovery` 或 `:reply_only` |

## 6. 测试配置要求

- LM Studio 运行在 `localhost:1234`，模型 `openai/gpt-oss-120b`
- SQLite3 测试数据库（Sandbox pool，WAL mode）
- Persistence 注入方式：
  - 不通过全局 `config :novel_web, :persistence`（会污染其他并发测试）
  - 在集成测试的 `setup` 中手动创建回调并传入 `DialogueGateway.handle_input/4`：
    ```elixir
    fetcher = NovelPersistence.WorkspaceContext.context_fetcher()
    persister = NovelPersistence.WorkspaceContext.trace_persister()
    {:ok, turn_result, trace, _candidates, _context} =
      DialogueGateway.handle_input(input, fetcher, real_complete_fn, persister)
    ```
- `real_complete_fn` 使用 `NovelApplication.Test.ProviderHelpers.lmstudio_complete_fn/0`
- 集成测试文件：`apps/novel_web/test/integration/v3_full_chain_test.exs`
- Tag：`@moduletag :integration`

## 7. CI 集成

```yaml
# .github/workflows/ci.yml 新增 job
integration-test:
  needs: [unit-test]
  runs-on: ubuntu-latest
  services:
    lmstudio:
      image: lmstudio/local-server:latest
  steps:
    - run: mix test --include integration
```

注意：CI 中 LM Studio 可能不可用（需 GPU）。退而求其次：在 CI 中使用 stub provider 验证 persistence 集成，标注 `provider_called: false` 的 replay 测试可通过。

## 8. 不覆盖

- 性能 / 负载测试
- 多 workspace 并发测试
- 网络断开恢复测试
- Anthropic provider 路径（仅 LM Studio）
- 前端 UI 自动化（VS-07 的范围）
- OTP 监督树故障恢复
- 真实 HTTP endpoint（仅用 Phoenix.ChannelTest，不启动 Bandit）
