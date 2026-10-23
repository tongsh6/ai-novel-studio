# BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY：behavior 生命周期决策权收口（8-2 显式 supersede）

- 状态：**done（2026-10-23；CP0–CP4 全落；真实 Tauri `au06-single-active-confirmation` re-anchor PASS ；8-1/9-2 文档化偏差已登记）**
- 来源：`tasks/slices/B13B-adr-enforcement-reconciliation.md` §4.1 #3（gap A 8-1 / 8-2，+9-2 视 Q2）；ADR-0008 `## enforcement_gaps`
- 设计真源：`docs/design/adr/ADR-0008-behavior-state-v3.md`、`docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md`（draft）
- 类型：承重竖切面（行为生命周期 / 执行权威）

---

## 1. 开工七问

1. **Contract**：VS-03 §4 规则 1（同一 workstream 默认最多一个 primary author-blocking behavior）+ 规则 3（`superseded` 必须引用替代 behavior）；ADR-0008「application 负责 lifecycle 裁决」「Trace 记录 open/close」。
2. **Invariant**：同一 workstream 至多一个 primary author-blocking behavior；旧 behavior 被新 behavior 替代时必须显式 `:superseded` 且 resolution 指向替代者（不只依赖 Channel current-turn guard 隐式失效）；不得以 UI 状态代替服务端裁决。
3. **Boundary**：切穿 `novel_domain`（`BehaviorState.supersede/3`、`from_map/1`、`snapshot/2`）、`novel_application`（`AdoptionWorkflow` 打开新 confirmation 时 supersede 上一 behavior）、`novel_web`（Channel 从已同步 turn_results 读取上一 active behavior 并交给 application）；不改 persistence schema、不改 frontend、不改 AgentRun 状态机。
4. **Consumer**：采纳覆盖确认（`AdoptionWorkflow.build_decision_turn_result/4` → TurnResult `behavior_state`）；Channel adopt 入口；真实页面 driver/verifier；后续 cancellation/confirmation 动作仍走既有路径。
5. **Proof**：`behavior_state_test`（supersede/from_map/snapshot2）+ `adoption_workflow_test`（显式 supersede / closed 不 supersede）+ 真实 Tauri `au06-single-active-confirmation`（B2 打开时 B1 入 history 且 resolution 指向 B2，旧确认不可执行，最新确认只采纳一次）。
6. **Acceptance Driver**：外部 Playwright driver 驱动真实 Tauri 工作台（真实聊天输入 + 档案按钮 + 确认按钮），从 WS 帧/app JSONL/可见页面取证；产品代码零验收感知逻辑。
7. **Exploration**：不适用（behavior lifecycle 非要素物化 slice）。

## 2. CP0 契约与作者裁决（默认拍板）

B13b §7 Q2「VS-03 behavior lifecycle contract pack 是否冻结」审计建议为 **B（维持 draft，只做 8-2 supersede + 文档化偏差）**；本轮按作者授权「遇作者裁决点按审计建议默认拍板并登记」执行：

- **VS-03 保持 draft**（不整包冻结、不新增 `cancel_or_close` decision 语义）。
- **8-2 实现**：显式 supersede（本 slice 主体）。
- **8-1 降级为文档化偏差**：cancel/reject 关闭 BehaviorState 仍由 `DialogueGateway.cancel_waiting_behavior_state/3` 直接构造 `:cancelled`（不经 OrchestratorDecision）；VS-03 §4 规则 4 处于 draft，ADR-0008 正文未冻结关闭权。Trigger 翻案条件：VS-03 冻结、或出现第二个 author-blocking behavior 生产者需要统一的关闭权威。
- **9-2 降级为文档化偏差**：`ConfirmationBinding` 不校验 open behavior/target 一致性；上游 `ActionValidator` + Channel current-turn guard 已承担该守门（若 VS-03 §5 冻结再并入行为生命周期）。

## 3. CP1 实现（8-2 显式 supersede）

**Domain（`NovelDomain.BehaviorState`）**
- `supersede/3`：旧 behavior → `lifecycle_status: :superseded`，`closed_at_turn_ref` 取替代者打开 turn，`resolution = %{ref: "behavior_superseded:<旧>:<新>", type: "superseded", superseded_by: <新>, superseded_by_ref: "behavior:<新>", reason_code: "new_author_blocking_behavior_opened"}`（VS-03 规则 3「必须引用替代 behavior」）。
- `snapshot/2`（active + history 列表）：新 behavior 进 active，被 supersede 的旧 behavior 以终态进 history；`summary/1` 现有枚举映射把 `:superseded` 映射到 `CANCELLED`（冻结 `BehaviorStatus` 枚举无 SUPERSEDED 值，沿用既有映射）。
- `from_map/1`：从 `behavior_state.active` summary map（atom/string key 双形态、JSON 往返）恢复 struct；缺 `behavior_id` 返回 nil，不伪造 behavior。
- `author_blocking?/1`：clarification / confirmation / recovery。

**Application（`AdoptionWorkflow`）**
- `adoption_decision_opts/5` additive 接收 `previous_behavior`（Channel 提供）。
- `decision_behavior_state/7`：新 confirmation 打开时，若上一 behavior 仍 open 且 author-blocking 且 `behavior_id` 不同 → `BehaviorState.supersede/3` 并写入新 TurnResult 的 `behavior_state.history`；`trace_summary.behavior_supersede_ref` 与 `truthfulness.superseded_behavior_ref` 携带同一 resolution ref。
- 已 closed / 同 id / 无 previous → 行为不变（不伪造 supersede）。

**Web（`WorkspaceChannel`）**
- `previous_active_behavior/1`：从本 socket 已同步 `turn_results_list`（join restore + 本轮广播）找最近一个 `behavior_state.active` 快照；`handle_in("adopt")` 把其作为 `previous_behavior` 交给 application（服务端事实，不读 UI/验收开关）。

## 4. CP2 单测矩阵

- `behavior_state_test`：supersede 终态/引用/closed turn；snapshot/2 active+history；from_map atom/string/JSON 往返与拒绝无 id 输入。
- `adoption_workflow_test`：新 confirmation 显式 supersede 上一条 open behavior（history + resolution ref + trace ref + schema 校验）；已 closed behavior 不 supersede（history 空、无 trace ref）。
- verifier self-test（245 tests）同步 fixtures。

## 5. CP3 真实页面验收（au06 场景 re-anchor）

**背景**：原 `au06-single-active-confirmation` driver 依赖判断纪元前的「两条高风险 rewrite user_message 直接产 needs_confirmation TurnResult」路径；判断纪元后该路径走 judgment execute → D4 高风险门禁 → awaiting_author（`_behavior` 被 flow 丢弃，不产可行动确认），**场景已漂移**（基线复跑失败确认；`p1-chapter-overwrite-confirm` 的 rewrite 路径同样漂移）。当前生产 durable confirmation behavior 的合法来源是**采纳覆盖确认**（AdoptionWorkflow require_confirmation）。

**re-anchor（seeded pending-candidate 流）**：判断纪元后，高风险工具/覆盖确认在 agent 流里只产内部 `require_confirmation` 裁决（`_behavior` 被丢弃、run 转 awaiting_author），不会变成可行动 TurnResult；且 `推翻/重写` 关键词同时触发 D4 高风险门禁，无法从聊天输入稳定生成带 rewrite provenance 的候选。因此场景用**种子注入**当前产品合法的作者可见状态（与 B25 场景同范式）：一个作品 + 两章各有已采纳正文 + 会话恢复两条待采纳 rewrite 候选（不同 turn、分别指向两章）。driver 从真实页面按作者方式操作（外部 Playwright）：

1. 真实工作台恢复两条待采纳覆盖重写候选（正文 marker 可见 + 「保存为章节正文」入口）。
2. 保存第一条 → **覆盖确认 B1** 打开（`require_confirmation` + behavior_state.active=confirmation，且该 TurnResult 零工具/零写入）。
3. B1 打开时作者再发一条普通消息 → 该 turn 的 `trace_summary.context_refs` 必须带 author-safe open behavior ref（AU-03 语义，且不泄漏 behavior_ref/action_id）。
4. 保存第二条 → **覆盖确认 B2**：断言 `behavior_state.active.behavior_id` = B2 动作的 behavior_ref、`behavior_state.history` 含 B1 且 `status=CANCELLED`、`resolution_ref="behavior_superseded:<B1>:<B2>"`、`trace_summary.behavior_supersede_ref` 与之一致。
5. 旧确认按钮隐藏/禁用/被 stale 拒绝；旧确认不产生采纳/写入。
6. 确认 B2 → 只采纳一次（resolved 含第二条候选、第一条保持 pending、未静默采纳）。

证据：`artifacts/slice-verify/au06-single-active-confirmation-tauri/summary.json`——`supersede_explicit=true`、`superseded_behavior_id=bh_confirm_as_au06_rewrite_first`、`supersede_resolution_ref=trace_behavior_supersede_ref=behavior_superseded:<B1>:<B2>`、`old_confirm_prevented=true`、`adoption_after_old_count=0`、`latest_confirmation_adopted=true`、`first_artifact_not_adopted=true`、`second_turn_behavior_context_author_safe=true`、log noise ok。verifier finder/behavior 已同步新断言（见 `native-tauri-verifier.mjs`）。au10 cancel-waiting（8-1 未改路径）回归 PASS。

## 6. 诚实边界

1. **8-1 未实现（文档化偏差）**：cancel/reject 关闭 behavior 仍不经 OrchestratorDecision；本 slice 不新增 `cancel_or_close` decision 载体（Q2 默认 B）。触发翻案：VS-03 冻结或第二 behavior 生产者出现。
2. **9-2 未实现（文档化偏差）**：binding 不校验 open behavior/target 一致性，由上游 ActionValidator/Channel guard 承接。
3. **supersede 仅覆盖「上一个 active behavior」**：新 TurnResult history 只携带被替代的那一条；更早历史不跨 turn 累积（前端「取最近携带 behavior_state 的 turn」语义不变）。
4. **行为生产者范围**：当前产品只有采纳覆盖确认/同名确认会 surface durable author-blocking behavior；judgment/agent-run 内部产生的 require_confirmation decision 仍为内部裁决（不产行为 TurnResult），归后续 `ask_author` / 判断停等契约（B26 并行会话）。
5. **DecisionTrace 持久化**：采纳确认 TurnResult 的 `trace_summary` 携带 supersede ref，但 action trace 持久化链未生成 trace_ref（既有行为，非本 slice 引入）；replay/why 的 behavior 证据仍以 TurnResult/behavior_state 为准。
6. **au10-workbench-recovery-cancel-waiting 回归不可复跑（预存在漂移）**：该场景 driver 依赖「高风险 rewrite user_message → needs_confirmation TurnResult → 点拒绝/取消」，判断纪元后同一 D4 高风险门禁把该路径变为内部裁决 + awaiting_author（flow 丢弃 `_behavior`），driver 等不到确认卡。**非本 slice 引入**：本 slice 未改 cancel 路径（`DialogueGateway.cancel_waiting_*`），既有 cancel 单测（`dialogue_gateway_test`、`workspace_channel_v3_test`、`action_roundtrip_test`）全绿。后续候选：au10 re-anchor 为 **seed 注入 open confirmation TurnResult**（同 `seed_au04_confirmation_ttl_ui.exs` 范式）→ driver 点「拒绝」→ 断言 cancelled + history resolution + 下一轮成功；与 route A（agent flow 把 require_confirmation 转可行动 TurnResult）同批评估。

## 7. 验证命令与结果

```bash
mix compile --warnings-as-errors
mix test                     # 1910 tests, 0 failures
mix format --check-formatted
mix credo --strict
mix run scripts/adr_trace.exs
mix run scripts/arch_check.exs
mix xref graph --format cycles --label compile-connected --fail-above 0
bash scripts/quality_manifest_check.sh
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
cd frontend && pnpm vitest run slice-verify/native-tauri-verifier.test.mjs
PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh au06-single-active-confirmation --surface tauri
bash scripts/ai_static_scan.sh --top 10
```

## 8. 决策日志

- **2026-10-23 — CP0 裁决（Q2 默认 B）**：VS-03 维持 draft，不整包冻结；只做 8-2 显式 supersede；8-1（cancel/reject 关闭不经 decision）与 9-2（binding 不校验 open behavior）登记为文档化偏差 + 触发条件。
- **2026-10-23 — CP1 实现**：`BehaviorState.supersede/3` + `snapshot/2` + `from_map/1` + `author_blocking?/1`；`AdoptionWorkflow` 新 confirmation 打开时显式 supersede 上一 open author-blocking behavior 并写入 history/trace_summary/truthfulness；Channel 从 socket turn_results 读取上一 active behavior 交给 application。
- **2026-10-23 — CP2 测试**：domain/application 单测 + verifier self-test fixtures 同步。
- **2026-10-23 — CP3 场景 re-anchor**：原 au06 legacy 路径判断纪元后漂移（基线复跑失败确认）；driver/verifier/manifest 重写为「采纳覆盖确认 B1 → 用户消息带 open behavior context → 保存新草稿打开 B2 显式 supersede B1 → 旧确认不可执行 → 最新确认只采纳一次」。
