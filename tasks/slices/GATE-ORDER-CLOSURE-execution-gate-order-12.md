# GATE-ORDER-CLOSURE：Execution Gate Order 12 门 + GateResult/version/trace 收口

- 状态：**done（2026-10-23；真实 Tauri `agent-step-regate` PASS + blocked 路径单测矩阵 + e2e-01 re-anchor 裁决）**
- 来源：`tasks/slices/B13B-adr-enforcement-reconciliation.md` §4.1 #2（gap A 5-1 / 5-2 / 5-3）；ADR-0005 `## enforcement_gaps`
- 设计真源：`docs/design/adr/ADR-0005-execution-gate-order-v3.md`、`docs/design/contracts/VS-01-execution-authority-contract-pack.md`
- 类型：承重竖切面（execution authority 主链）

---

## 1. 开工七问

1. **Contract**：ADR-0005 冻结的 0–11 门顺序 + Gate outcome 六态 + gate→decision 映射；VS-01 §4 gate subset / §5 OrchestratorDecision 字段（`first_blocking_gate` / `decision_trace_ref`）/ §7 DecisionTrace 必录事实（gate order version、逐门 outcome、first blocking gate、reason code、replay policy）。
2. **Invariant**：Orchestrator 是执行权唯一门禁；不可逆动作必须逐门可解释；GateResult/version/first blocking gate 必须进 DecisionTrace 与 replay；确认 re-gate 仍走全部门；幂等 lineage 不得由 gate 或 Channel 任一方静默伪造。
3. **Boundary**：切穿 `novel_application`（GateOrder/ExecutionOrchestrator/TraceWriter/Replay/TraceReplay/6 个 agent run flow/BlockedDecisionTrace）、`novel_domain`（GateResult/OrchestratorDecision/DecisionTrace）、`novel_persistence`（decision_traces gate 列 + migration）、`novel_web`（author-safe agent payload nil 归一、confirm re-gate idempotency 注入）。**不修改** `novel_agent` provider、不新增 capability、不改 AgentRun 状态机、不改 TurnResult wire 必填字段。
4. **Consumer**：`ExecutionOrchestrator.decide/3`（6 个 agent run flow + confirm re-gate + pending artifact / prose revision）；`TraceReplayService`/`ReplayService`（why/replay 六问）；真实页面验收 driver/verifier。
5. **Proof**：`apps/novel_application/test/novel_application/gate_order_closure_test.exs`（36 test：12 门/version、逐门真实阻断、幂等 replay 短路、orchestrator lineage、blocked trace、replay gate order 回答）；真实 Tauri `quality_accept.sh agent-step-regate --surface tauri` PASS。
6. **Acceptance Driver**：外部 Playwright driver 驱动真实 Tauri 工作台（`frontend/slice-verify/external-ui-driver.mjs`）发作者式复合请求 → bounded AgentRun → 两个 internal AgentStep 各过 12 门；断言来自真实 app JSONL / websocket 帧 / step TurnResult trace_summary / 可见页面。**产品代码零验收感知逻辑**（无 testid、无 slice 开关、无自动上报）。
7. **Exploration**：不适用（非要素物化 slice；不新增要素/数据，只补执行权门禁与 trace 事实）。

---

## 2. CP0 契约冻结（现状裁决）

**已落地（本 slice 前）**：8 门骨架 + 部分 gate 语义；`GateOrder.evaluate/2` 返回轻量 tuple；budget/trace_readiness/turn_result_compat 恒 pass；correlation 只查 refs 存在；无 GateResult 结构、无 gate order version、无逐门 trace。

**本 slice 冻结**：
- `NovelDomain.GateResult`：gate identity + order + outcome（`:pass/:pass_with_note/:soft_block/:hard_block/:replay_existing/:recoverable_failure`）+ reason_code + input_refs + author_visible + notes；JSON-safe `to_map/1`、`lineage/1`。
- `GateOrder.gate_order_version = "adr-0005-v1"`；12 门顺序 = ADR 0–11（`gate_names/0` 为唯一顺序真源）。
- gate→decision 映射按 ADR §Gate 与 decision 的映射表：behavior→clarify、slot→clarify、authority→confirm、policy→downgrade、budget/toolbox/trace/TRC→recovery、action_scope→downgrade、envelope/correlation→recovery。
- 运行期事实经 `gate_context` 显式接线（`:frame` / `:open_behavior` / `:behavior_resolution` / `:budget` / `:trace_ready?` / `:idempotency`）；缺席走「未接线」保守语义（pass_with_note），不伪造已检查事实。

---

## 3. CP1 实现：12 门 + GateResult + version

| # | Gate | 本 slice 判定 | 真实接线 |
|--:|---|---|---|
| 0 | correlation / idempotency | refs 缺失 hard_block；plan/frame 交叉引用 mismatch hard_block；binding/context idempotency key 记 lineage；显式 replay 证据短路 `replay_existing` | confirm re-gate 注入 binding idempotency key；agent step 无作者动作 key → `idempotency_lineage_not_attached`（诚实） |
| 1 | envelope_validation | 无 proposed_actions / 非 bounded / 13 词 forbidden 语义 → hard_block；PlannerBoundary 前置失败也合成 envelope GateResult（不丢 trace 事实） | 恒评估 |
| 2 | behavior_compatibility | open behavior 未解析 → soft_block；作者确认/取消解析 → pass_with_note | confirm re-gate 注入 open_behavior + `behavior_resolution: :author_confirmed` |
| 3 | action_scope | multi-step → soft_block | 恒评估 |
| 4 | slot_contract_validation | action_id/type/summary/write_intent + state_change 结构非法 → soft_block | 恒评估（plan 级结构；ActionValidator/MissingPolicy 仍在执行前独立守门） |
| 5 | authority | high-risk 无确认 → soft_block；有效 binding → pass_with_note | 恒评估 |
| 6 | policy_safety | planner state_changes 的 production_candidate → soft_block（candidate-only 不变量） | 恒评估 |
| 7 | budget | run 预算耗尽 / tool/provider 余量为 0 → recoverable_failure | **agent run 6 个 flow 注入 `AgentRun` 真实剩余预算**（`gate_context_for_run/1`） |
| 8 | toolbox_availability | capability 未注册或不可分发（disabled/deprecated）→ recoverable_failure | 恒评估（`CapabilityRegistry.dispatchable?/1`） |
| 9 | write_boundary | production_candidate 无确认 → soft_block | 恒评估 |
| 10 | trace_readiness | trace 通道明确不可写 → recoverable_failure；真实持久化通道存在 → pass | confirm re-gate + agent run flow（`persistence_tracer` 存在即接线） |
| 11 | turn_result_compat | frame 形状不能支撑诚实 TurnResult → hard_block | 恒评估（frame 恒注入） |

**decision 层修正**：
- `OrchestratorDecision` 新增 `gate_order_version` + `gate_results`；allow / allow_agent_run / blocked / planner_boundary / replay 五个 builder 全部携带。
- 12 门全 pass 但无可分发动作时的降级改为 decision 级（`first_blocking_gate = nil` + `no_dispatchable_action`），消除「全 pass 却有 first blocking gate」的自相矛盾。
- `planner_boundary` 失败路径合成 `envelope_validation` hard_block GateResult。
- `orchestrator.decide.done` JSONL 新增 `first_blocking_gate/gate_order_version/gate_count/gate_outcomes`（JSON-safe `GateResult.lineage/1`）。

## 4. CP2 实现：DecisionTrace / Replay / blocked 路径

- `DecisionTrace` + `DecisionTraceRecord` + migration `20261023000002_add_gate_lineage_to_decision_traces`：新增 `gate_order_version :string` + `gate_result_refs {:array,:map}`；`DialogueGateway.trace_to_attrs/3` 同步；存量行 NULL 表示「本 slice 前 trace」。
- `TraceWriter.record_with_tool/7`（allow 路径）与 `record_with_decision/5`（此前无调用者，本次补齐 gate 字段）均写 gate lineage + summary `gate_order_version/gate_results`。
- 新增 `NovelApplication.BlockedDecisionTrace.record/5`：gate 阻断的 tool step 在 5 个 agent run flow 中写 DecisionTrace 后保持既有 `agent_step_blocked` 失败语义（不再只有 agent event 没有 trace）。
- `TraceReplayService`：优先从结构化 `gate_result_refs` 取 first blocking gate（历史 trace 回退 `no_write_reason` 文本）；trace summary 暴露 `gate_order_version/gate_results`。
- `ReplayService`：chain_summary 增加 `gate_order` 节点；**VS-06 六问契约不变**，gate order version / first blocking gate / 逐门 outcome 并入 `decision_reason` 回答（无 lineage 历史 trace 标 `gate_order=not_recorded`）。
- `novel_web`：author-safe agent payload 的 nil 不再被字符串化为 `"nil"`（保留 JSON null），保证 `first_blocking_gate=null` 语义不被 wire 归一伪造。
- `TraceWriter.decision_type_for(:replay_existing)` 补齐；`TraceReplayService` 决策类型白名单同步。

## 5. CP3 验收：真实 Tauri `agent-step-regate` PASS

`PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh agent-step-regate --surface tauri` → **PASS**（artifact `artifacts/slice-verify/agent-step-regate-tauri/`）。

外部 Playwright 驱动真实 Tauri 工作台（无产品验收钩子），断言（证据来自 app JSONL / WS 帧 / step TurnResult trace_summary / 可见文本）：

- 两条 `orchestrator.decide.done` allow_tool，逐条 `gate_order_version=adr-0005-v1`、`gate_count=12`、`gate_outcomes` 恰为 ADR 0–11 顺序、全部 pass/pass_with_note、`first_blocking_gate=null`、`decision_id` 互异；
- budget gate 为 `pass_with_note` 且 notes 含 `run_budget_remaining`（真实 AgentRun 剩余预算接线）；
- trace_readiness gate 为 `pass`（真实持久化通道接线）；
- 两个 step TurnResult 的 `trace_summary.gate_order_version=adr-0005-v1` 且各含 12 条 gate results（DecisionTrace lineage 外证）；
- 两条 `gate_decided` agent event，payload 含 version + 12 条 gate results、无阻断门；
- 既有行为不退化：bounded ack、plan_drafted=0、consumed 4/2/3、tentative 候选、零 production write、log noise 24 行/0 error。

summary.json 关键字段：`gate_order_version=adr-0005-v1`、`step_gate_sequences` 两条 12 门、`step_budget_gate_notes=[["run_budget_remaining"],["run_budget_remaining"]]`、`step_trace_gate_versions=["adr-0005-v1","adr-0005-v1"]`、`step_trace_gate_result_counts=[12,12]`、`gate_decided_event_count=2`。

### 5b. e2e-01-downgrade-real-page re-anchor 裁决（blocked）

`e2e-01-downgrade-real-page` 在判断纪元后**静态不可达**：生产主链全部 `%MicroPlan{}` 构造点均为单 action（`MicroPlan.multi_step?` 要求 count>1），action_scope 降级无触发者；且 verifier key events 仍要求已退役 `planner.form_frame.done` / `planner.form_micro_plan.done`（B13B D7）。本 slice 裁决：**标 blocked**（`quality/acceptance/scenarios.yml` 带 `blocked_reason`），不新增注定失败的 gate 断言、不冒充 PASS；gate 序列真实页面证据由 `agent-step-regate`（allow 路径）承担，blocked 路径由单测矩阵承担。后续候选：re-anchor 到判断链可控多步生产路径，或正式退役该场景。

## 6. 诚实边界（未闭环缺口）

1. **blocked 路径真实页面场景**：blocked decision 已有 DecisionTrace 写入 + 单测（authority/slot/policy/budget/toolbox/trace/TRC/behavior），但没有真实 Tauri 场景断言 blocked gate 序列；候选新场景 `agent-gate-blocked-lineage`（需可确定性诱导高风险/未知能力 step）。
2. **behavior compatibility 主路径**：agent run 普通 step 不注入 open_behavior（真实守门仍是 Channel current_turn guard）；只有 confirm re-gate 接线。
3. **slot/contract 真实语义**：`ActionValidator` / `MissingPolicyResult` 仍在 gate 之后（slot gate 只做 plan 结构校验），「先通过 gate 再发现 slot 缺失」的顺序缺口未完全消除。
4. **policy/safety 规则集**：目前只冻结 candidate-only state change 一条真规则；内容策略/禁止操作族仍由 envelope forbidden 扫描承接，未建独立 policy 规则表。
5. **幂等输入一致性 / replay_existing 生产接线**：gate 支持 replay 短路与 lineage 记录，但 Channel `ActionIdempotencyService` 仍以旁路 receipt 执行重复抑制；receipt key 不含 payload digest，ADR #18「输入内容不一致必须 reject/recovery」未实现。
6. **turn_result_compat**：只做 frame 形状校验；TurnResult truthfulness 仍由 `TurnResultBuilder` + `OrchestratorDecision.truthfulness_constraints` 在决策后约束。
7. **e2e-01 re-anchor**：见 §5b。
8. **`first_blocking_gate` 在 pass-downgrade**：改为 nil（无 gate 阻断）；消费方若假设「downgrade 必有 blocking gate」，以 `gate_results` 聚合为准。

## 7. 验证命令与结果

```bash
mix compile --warnings-as-errors
mix test                     # 1904 tests, 0 failures
mix format --check-formatted
mix credo --strict
mix run scripts/adr_trace.exs
mix run scripts/arch_check.exs
mix xref graph --format cycles --label compile-connected --fail-above 0
bash scripts/quality_manifest_check.sh
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh agent-step-regate --surface tauri
node --test frontend/slice-verify/native-tauri-verifier.test.mjs   # 245 pass（经 vitest）
bash scripts/ai_static_scan.sh --top 10
```

证据：`artifacts/slice-verify/agent-step-regate-tauri/{summary.json,ui-state.json,app-log.json,ui-frames.json,agent-step-regate-external-ui.png,log-noise.json}`。

## 8. 决策日志

- **2026-10-23 — 12 门骨架落地 + GateResult/version**：`GateOrder` 重写为 12 门；`NovelDomain.GateResult` 冻结 outcome 六态与 JSON-safe lineage；`OrchestratorDecision`/日志/step agent event 携带 version + 逐门 lineage。
- **2026-10-23 — 真实接线**：budget 从 AgentRun 剩余预算注入（6 flow）；trace readiness 从真实持久化通道注入；confirm re-gate 注入 idempotency key + open behavior 解析；toolbox 改用 `dispatchable?`；pass-downgrade 的 `first_blocking_gate` 修正为 nil。
- **2026-10-23 — trace/replay**：DecisionTrace 新列 + migration；record_with_tool/record_with_decision 双路径写 gate lineage；blocked decision 新增 `BlockedDecisionTrace` 落库；Replay 六问契约不变、gate 事实并入 decision_reason 回答；wire nil 不再字符串化。
- **2026-10-23 — 真实页面验收**：`agent-step-regate` 真实 Tauri PASS（12 门 ×2 step、budget/trace readiness 真实接线、step trace lineage 外证）；`e2e-01-downgrade-real-page` 因判断纪元无多步生产者 + 退役事件标 blocked（裁决与原因入 scenarios.yml）。
- **2026-10-23 — 诚实边界**：blocked 路径真实页面场景、behavior 主路径、slot 后置、policy 规则集、幂等输入一致性、e2e re-anchor 均登记为后续候选，不以单测冒充真实页面闭环。
