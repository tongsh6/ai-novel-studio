# tasks/slices/v3/ — v3 承重竖切面工作区索引

> 历史命名的当前承重切面工作区（见 `../README.md`：不再新建版本化目录，后续逐步迁出）。每个 slice 文件是一段承重链路的开工检查、任务清单、验证与试行反馈。
>
> 排序与依赖以 `DAG.md` 为准；开工前先读 `DAG.md` 再读对应 slice。

## 索引

| 文件 | 切面 |
|---|---|
| `DAG.md` | 承重竖切面排序与依赖（状态总表） |
| `VS-00-implementation-plan.md` | VS-00 实现计划 |
| `VS-00-reply-only-dialogue-frame-turn-result-trace.md` | 纯回复 DialogueFrame + TurnResult + Trace |
| `VS-00A-creative-exploration-loop.md` | 创意探索回合 |
| `VS-00B-dialogue-context-grounding.md` | 带作品上下文回应 |
| `VS-00C-creative-context-assembly.md` | 创作上下文组装（VS-00D prose_writing 投影；CP0-CP5） |
| `VS-00D-ai-guided-authoring-message-contract.md` | AI 引导式创作 Message 契约 |
| `VS-01-micro-plan-downgrade-confirmation.md` | MicroPlan 降级 / 确认 |
| `VS-02-tool-request-result-trace-loop.md` | ToolRequest/Result/Trace 回合 |
| `VS-02A-tentative-creative-artifact.md` | 试探性创作产物 |
| `VS-03-clarification-confirmation-behavior-lifecycle.md` | 澄清/确认行为生命周期 |
| `VS-04-candidate-selection-adoption-boundary.md` | 候选选择与采纳边界 |
| `VS-05-ui-available-action-roundtrip.md` | UI AvailableAction 往返 |
| `VS-06-trace-summary-replay-explanation.md` | Trace 摘要与回放解释 |
| `VS-07-frontend-workbench-ui-consumer.md` | 前端工作台 UI 消费 |
| `VS-08-end-to-end-integration-tests.md` | 端到端集成测试 |
| `VS-09-work-management.md` | 作品管理闭环 |
| `VS-10-observability-spine.md` | 可观测主链 |
| `VS-11-desktop-stage-process-ownership.md` | 桌面 stage 进程所有权 |

> 注：`tasks/slices/` 顶层还有 P1-* / AU0*/ VS-0* / SI-00* 等执行层 slice，归属见 `../README.md`。
