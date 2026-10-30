# B43：统一执行裁决与 Gate 残余——行为输入、幂等输入与回放

- 状态：**doing（2026-10-31 CP0 盘点完成/CP1 done：payload digest 幂等冲突已实现；CP2 统一裁决 producer/reply_only、CP3 blocked 页面、CP4 回归未做）**。
- 登记日期：2026-10-27；来源：12 门与 allow 路径已验收，但 blocked 页面、open_behavior/slot 顺序和同键异 payload 仍未闭合。
- 上游：ADR-0005、[GATE-ORDER-CLOSURE](GATE-ORDER-CLOSURE-execution-gate-order-12.md)、[B40](B40-judgment-era-acceptance-reanchor.md)、[B49](B49-core-semantics-and-adr-review.md)。

## 1. 真实缺口

1. `ActionIdempotencyLedger` 以 work/session/turn/action/idempotency_key 查 receipt，未比较 payload。相同 key 不同 `edited_content` 可能命中旧回执而不是拒绝或 recovery。
2. 普通 AgentRun step 的 open_behavior 未统一进入 GateOrder，MissingPolicy 又可能落在门后，导致真正 behavior/slot 阻断在 trace 中看起来像门已通过后的普通失败。
3. blocked 路径主要是单测，缺真实页面的 first_blocking_gate、DecisionTrace、Replay 与 no-tool/no-write 证据。

4. B49 R2=A 要求所有回合统一裁决，当前普通回复仍缺 OrchestratorDecision；须盘点回复/执行/作者动作/停等出口，并让 trace/TurnResult/回放的裁决信息同源。

这些不是“12 门不存在”，而是已有实现的边界没有闭环。不能用 allow 路径 12 门全绿代替。

## 2. 开工七问

1. **Contract**：ADR-0031（Accepted）、ADR-0005/0007/0027、统一 OrchestratorDecision/DecisionTrace、GateOrder、AuthorActionInput/Receipt、open behavior、TurnResult/replay；复用 AuthorQuestion 的 payload_digest 先例，不另造第二幂等系统。
2. **Invariant**：同 key 同字节最多执行一次；同 key 异 payload 必须明确拒绝且不得执行；未解决 behavior/缺章/歧义章在正确门阻断；blocked 不产生 success claim 或生产写入；trace 与真实门一致；普通回复有真实 reply_only 裁决但无虚构执行/写入，统一对象不代表整个计划一次放行。
3. **Boundary**：`novel_application` 的 GateOrder、ActionIdempotency、普通回复生产入口、六个 AgentRun flow、TurnExecutionService/TurnResult/TraceWriter、ActionValidator；persistence 仅按既有回执需要；web/frontend 只消费现有 author-safe 错误与 replay。
4. **Consumer**：Orchestrator、作者动作、Replay/why、外部验收与真实作者。
5. **Proof**：同 key 同/异 payload、open behavior、缺章/歧义章、重复执行/回滚、真实 blocked 页面与 replay；局部故障矩阵+可控真实 Tauri；覆盖 reply-only、业务执行、作者动作、等待/失败出口及同源裁决/trace/历史回放。
6. **Acceptance Driver**：候选 `agent-gate-blocked-lineage`，外部驱动真实工作台产生确定 blocked，核对 first_blocking_gate/reason、DecisionTrace、no tool/no write、Replay；复用普通对话真实入口验证新增 reply_only decision 与零业务动作/零写入、刷新回放一致。产品验收感知逻辑 **no**。
7. **Exploration**：不新增作品要素；gate/behavior/回执/失败原因沿现有 trace/replay 可查，不靠 Channel 旁路掩盖。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 冻结所有回合出口→裁决类型/trace/返回映射及历史读取；与 B45 对齐词表；保留 payload digest、open_behavior/slot 和错误语义的完整范围 | 未开工 |
| CP1 | 幂等输入一致性：同 key 同 payload 回放，同 key 异 payload 拒绝，不误报 duplicate、不二次写入；保留原成功回执 | **done（2026-10-31，§9）**：payload digest 入内存账/持久 result；同 key 同 payload duplicate、异 payload conflict 错误、无第二回执；历史回执无 digest 按 legacy duplicate；真实 channel 测试 |
| CP2 | 统一裁决 producer 与 reply_only 路径、裁决同源 trace/结果/回放；open_behavior/slot 在六个 flow 与 TurnExecutionService 统一进门，MissingPolicy 与 GateResult 顺序一致 | 未开工 |
| CP3 | 普通回复/执行/作者动作/停等与 blocked 真实页面及 replay：真实裁决、正确 first_blocking_gate/reason、无虚构工具/写入、DecisionTrace/why 可读；历史记录兼容 | 未开工 |
| CP4 | 回归 allow 路径、B40 的场景重锚及既有 adoption/action 测试；不为通过而弱化负例 | 未开工 |

## 8. CP0 盘点（2026-10-31，进行中）

### 8.1 现有裁决 producer（真实调用点）

`ExecutionOrchestrator.decide/3` 现役调用点：
- `prose_revision_service.ex:86`（无 gate_context）
- `agent_run_flows/prose_drafting_with_quality.ex:1223`
- `character_design_with_context.ex:273`
- `judgment_plan.ex:518`
- `character_evolution_with_context.ex:300`
- `plot_outline_with_context.ex:653`
- `world_building_with_context.ex:300`
- `dialogue_gateway.ex:725`（confirmation re-gate，带 binding/open_behavior/idempotency）
- `pending_artifact_workflow.ex:537/1300/1438`

### 8.2 Trace 现状

- allow_tool 路径：`TraceWriter.record_with_tool/7`（turn_execution_service、prose_revision、pending_artifact、agent_run step）。
- blocked/decision：`BlockedDecisionTrace` + `TraceWriter.record_with_decision/5`，用于阻断出口。
- `TraceWriter` 仍有 `decision_type(_) -> :reply_only` 的兜底（trace_writer.ex:415），但本轮未找到真实普通回复 producer 显式构造 `OrchestratorDecision(decision_type: :reply_only)`；`reply_only_decision_recorded` 仅存在于 trace/replay 类型枚举（trace_writer.ex:438、trace_replay_service.ex:24）。这是 B43 CP2 要补的真实缺口，不能用 trace 兜底冒充统一裁决。

### 8.3 幂等输入现状

- `ActionIdempotencyLedger` 查 receipt 键为 work/session/turn/action/idempotency_key；本轮未读到 payload digest 比较。
- `AuthorQuestion` 已有 payload_digest 先例可复用（§2 Contract）。
- 同 key 异 payload 的拒绝/恢复语义仍待 CP0 冻结。

### 8.4 Blocked 页面现状

- `BlockedDecisionTrace` 已有持久化通道（经 `DialogueGateway.persist_turn_trace/4`），但 blocked 证据主要是单测；真实页面 first_blocking_gate/reason、no-tool/no-write、Replay 未见现役外部场景（B43 原缺口 3）。

### 8.5 CP0 待冻结项

1. 普通回复 reply_only 的判决由谁生产、何时进入 `TurnResult.orchestrator_decision`、与 trace/replay 字段一致；
2. 六类出口（普通回复/执行/作者动作/等待/失败/阻断）→ decision_type/trace/返回/historical 映射；
3. 同 key 同/异 payload 的 receipt 字段与拒绝错误码；
4. blocked 场景 driver 的种子与判据（候选 `agent-gate-blocked-lineage`）。

## 9. CP1 实现记录（2026-10-31）

- `ActionIdempotencyLedger`：新增 `payload_digest/1`（对 input.payload 做确定性规范化 + SHA-256），内存 entry 存 digest；`lookup/3` 返回 `{:duplicate, entry}` / `{:conflict, entry}` / `:miss`——同 key 同 payload 才回放，异 payload 明确 conflict；历史 entry 无 digest 按 legacy duplicate（不误伤旧回执）。
- `ActionIdempotencyService`：持久回执 `result` 写入 `payload_digest`；lookup 读回执 digest 比较，异 payload 返回 conflict；record 不新增 schema/migration（digest 放既有 result map）。
- `workspace_channel`：`handle_in("author_action")` 命中 conflict 时返回 author-safe `{:error, %{reason: :idempotency_payload_conflict}}`，记 `channel.author_action.error`，不广播 turn_result、不进入 dispatch。
- 测试：纯函数同键异 payload conflict；真实 channel（注入 persistence）同键同 payload duplicate、异 payload 拒绝且 `author_action_receipts` 只有一条原回执、无第二次 turn_result。
- 边界：payload digest 不包含服务端生成的 input_id；历史回执无 digest 只能按旧 duplicate 语义，无法追溯其原始 payload（已知兼容边界）。

## 4. 非目标

- 不重建 GateOrder、第二运行时或更换幂等体系；不让 Planner 自批权限、不为 reply_only 制造 MicroPlan 或虚假门禁通过记录。
- 不用 Channel 特判代替 flow 统一输入。
- 不用 allow 场景或修改断言掩盖 blocked。
- 不把 policy/safety 规则集无消费者扩展塞进本任务。
- 不把 D21 等旧确认场景漂移简单归因于 Gate，先核产品 confirmation 语义。

## 5. 验证与恢复

- 同 key 不同 `edited_content` 明确失败且零第二次写入；同 key 同字节保持幂等。
- open behavior、缺章、歧义章分别在预期 GateResult 阻断，writer/tool 未派发。
- 真实页面出现 blocked DecisionTrace 与 author-safe reason，replay 无 provider、无生产写入。
- 恢复时先核对 B49 的主链语义裁决与 B40 的场景处置，避免把旧 multi-step 语义重新带回。

## 6. 2026-10-30 裁决承接

范围依据 [B49 基线收口](B49-core-semantics-and-adr-review.md#716-c02-实施基线收口)；R2=A 是待新增生产链，不能以“现状不产生 decision”作为豁免。R1 保留逐步执行，R3 将决定与运行进度分工；来源身份消费原 B01 的真实引用，不在本任务另造来源体系。B45 只提供 schema/兼容/边界契约，不能代替本任务的真实 decision 生产者；本任务也不能靠只补 schema 关闭。

本次仅细化任务，不改变原幂等/behavior/blocked 的验收范围，不表示任何 CP 已实现。ADR 已正式接受；实施仍须按完整七问、主链不变量和外部真实页面验证执行。

## 7. CP0 与 schema 映射协同（2026-10-30）

作者确认将首批 schema 链路纳入队列。CP0 与 [B45 §7](B45-schema-legacy-governance.md#7-字段与消费者映射交付2026-10-30-纳入队列) 共同核对每个回合出口的真实 producer、decision 字段/状态、序列化、运行时校验、TurnResult/trace/回放消费者与历史读取；映射公共清单由 B45 维护，本任务维护业务出口与执行后果，不复制两套词表。

CP0 的交付须能指出普通 reply_only 与业务执行/等待/失败分别如何进入同源裁决；CP2/CP3 再证明生产与消费接线。B01 真实来源、同键异 payload、behavior/slot 门序、blocked 真实页面与 no-provider replay 仍属于完整范围。两任务的 CP0 可协同准备，不等待 B45 全量历史清理，也不因只补 schema 就关闭本任务。
