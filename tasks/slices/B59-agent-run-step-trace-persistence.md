# B59：AgentRun 内部步 DecisionTrace 持久化缺口（ToolTrace 可回查）

- 状态：**todo（B40 CP2 发现并登记，未开工；等作者排期/触发）**。
- 登记日期：2026-10-27；发现来源：B40 CP2 复核 `au07-tooltrace-registry-redacted-io` 时，真实 Tauri（browser-surface）run 按 AgentRun 内部只读步 `turn_id` 查询 `TraceRepository` 返回 0 条，导致 ToolTrace registry snapshot/redacted I/O 与 ReplayReport 无当前可达的持久回查路径。
- 本 slice 只做“把已存在的 step trace 接线持久化”；**不重建 ReplayService / 不恢复旧 envelope / 不改 redaction 规则 / 不改 provider 或工具语义**。
- 上游：[B40 判断纪元验收重锚](B40-judgment-era-acceptance-reanchor.md) §9、[AU07 文件级收口](AU07-file-level-closure.md) §8、ADR-0014、ADR-0017、VS-02、VS-06。

## 1. 问题

判断纪元起，工作台工具 turn 由 AgentRun flow 执行（`character_design_with_context_v1`、`character_evolution_with_context_v1`、`judgment_plan_v1`、`plot_outline_with_context_v1`、`world_building_with_context_v1`、`prose_drafting_with_quality_v1` 等）。每个内部步都会：

1. 构造 `DialogueFrame`（`turn_id = TurnBinding.bind(run, sequence)`，如 `message_<uuid>:agent:3`）；
2. 经 `ExecutionOrchestrator` 记 12 门 `GateResult`；
3. 经 `TurnExecutionService.execute/1` 产生 `TurnResult` **和 `DecisionTrace`**（`TraceWriter.record_with_tool/7` 会写 `tool_trace_refs`：registry snapshot / contract refs / grant summary / redacted request-result summaries）；
4. 把 `TurnResult` 作为中间步广播（真实 UI 可见）。

缺口在 (4) 之后：flow 丢弃了 (3) 的 trace，且没有调用 trace persister，导致 step `DecisionTrace` 从未进入 `TraceRepository`。AU-07 的 ToolTrace 持久回查（`TraceRepository.list_by_turn` / `ReplayService.build_report/1`）因此只对“顶层 turn”可达，对 AgentRun step 不可达。

## 2. CP0 复现证据（B40 已完成，本 slice 只引用）

- **代码位置**（5 个 flow 同模式，`_trace` 被丢弃）：
  - `apps/novel_application/lib/novel_application/agent_run_flows/character_design_with_context.ex:308` `{turn_result, _trace} =`
  - `.../character_evolution_with_context.ex:349`
  - `.../judgment_plan.ex:662`
  - `.../plot_outline_with_context.ex:702`
  - `.../world_building_with_context.ex:340`
  - 参照：`.../prose_drafting_with_quality.ex:1231` 有 `{turn_result, trace}`，但同一缺口需逐 file 复核其持久化接线。
- **真实 run 证据（失败，只读保留）**：`artifacts/slice-verify/au07-tooltrace-registry-redacted-io-tauri/`
  - driver 用真实作者请求触发 `character_design_with_context_v1`：`app-log` 证明只读步真实执行（`orchestrator.decide.done allow_tool`、`context.characters.done`、`toolbox.execute.done character_roster succeeded`，`turn_id=message_…:agent:3`）。
  - `trace-query.json`：`turn_id=message_…:agent:3`、`count=0`（step trace 未持久化）。
  - 对照：同 run 顶层 turn 的 replay/why 面板在回复轮可用（顶层 trace 正常持久化或回退 turn_result summary）。
- **影响判定**：这不是 driver/断言问题；`TraceWriter`/`ToolTrace` 实现存在且被真实执行调用，缺的是 AgentRun step 的持久化接线。

## 3. 受影响契约与场景

- 契约：ADR-0014（trace redaction）、ADR-0017（replay report）、VS-02（tool provenance）、VS-06（replay surface）；AU-07 `SC-AU07-C3`（ReplayReport 六问）与 `SC-AU07-D1`（ToolTrace 进入 replay）。
- 场景（B40 当前 blocked）：
  - `au07-tooltrace-registry-redacted-io`
  - `e2e-01-readonly-tool-trace`
  - `e2e-01-replay-report`
- 备注：B40 已把三个场景的 driver/manifest/verifier 重锚到“AgentRun 内部只读步 + 持久 trace 回查”，本 slice 修好持久化后可直接复跑（不需要再重写 driver）。

## 4. 范围与边界

- **改**：`novel_application` 编排/持久化接线（各 AgentRun flow 把 step `DecisionTrace` 交给既有 persister；复用 `DialogueGateway.persist_turn_trace` / `NovelApplication.persistence_tracer()` 同一路径，不新增第二套）。
- **不改**：provider 实现、tool 语义、ToolTrace/redaction 规则、ReplayService、前端 why/replay 组件、验收 harness 断言语义。
- **必须证明**：step `DecisionTrace` 以 step `turn_id` 持久化，且 `TraceRepository.list_by_turn(step_turn_id)` 返回含 `tool_trace_refs` 的记录；`ReplayService.build_report(trace).provider_called == false` 且六问仍可回答；无新增生产写入/采纳副作用。

## 5. Checkpoint 草案

| CP | 范围与完成标准 |
|---|---|
| CP0 | 已完成（B40 CP2 复现+证据，见 §2）；本 slice 只需复核 5 个 flow 是否同模式、prose flow 现状 |
| CP1 | 持久化接线：AgentRun step `DecisionTrace` 交给既有 persister（含 `workspace_id/session_id/turn_id` 归属）；针对每个 flow 写单测：step trace 落库、`tool_trace_refs` 完整、无重复 trace、失败不阻塞 run |
| CP2 | 真实页面 scoped 复验：复跑 B40 重锚后的 `au07-tooltrace-registry-redacted-io` / `e2e-01-readonly-tool-trace` / `e2e-01-replay-report`（当前仍受 native driver 覆盖缺口约束，验收 surface 以实际 driver 为准并如实记录）；断言 `TraceRepository` 回查 + ReplayReport no-provider + no production write |
| CP3 | 回归：`mix test`、trace/replay targeted tests、`quality_manifest_check`、相关场景 verdict 刷新；更新 B40/known-gaps 状态（把三个 blocked 场景改 active 需真实 PASS 证据） |

## 6. 非目标

- 不重建 `ReplayService` 或 ToolTrace、不恢复 AIMessageEnvelope/planner.form_*、不改 redaction 规则或契约文本。
- 不借此 slice 修 native 系统级驱动缺口（B40 已登记单独 known-gap；两者独立）。
- 不因为让 AU-07 场景变绿而放宽断言或用历史 lmstudio summary 代签。

## 7. 触发条件与恢复

- 触发：作者排期；或 AU-07 真实模型/工程证据需要 step 级 ToolTrace 时；B40 三个 blocked 场景的解除依赖本 slice（或产品侧另行提供等价持久证据）。
- 恢复：先读 B40 §9、AU07 §8、本文件 §2 证据；改动前在 `apps/novel_application` 确认 `persistence_tracer` 注入条件（test/dev/prod）并保证不双写。
