# B13B — ADR enforcement_gaps 对账裁决与落地台账（B13b 汇总）

- 状态：**done（2026-10-22，B13b A/B/C 三组审计汇总落档；47 条 gap 全部有裁决，ADR 文本 47/47 已落地）**
- 类型：ADR 治理收口台账（B13a 的后续阶段 B13b 的唯一持久交付物）
- 来源：
  - `tasks/NEXT.md` B13/B13a 行；B13a 落地 commit `221d13c3`（26 份 Accepted ADR 补 `enforced_by`、`adr_trace` 收紧为硬门禁、20 份 ADR 登记 `enforcement_gaps` 转 B13b）
  - 三组审计产物：`/tmp/b13b/part-a.md`（组 A，ADR-0001..0012，26 条）、`part-b.md`（组 B，ADR-0015..0026，14 条）、`part-c.md`（组 C，ADR-0028，7 条 + 跨 ADR 验收漂移专项）
  - 落地记录：`/tmp/b13b/apply-a.md`（组 A，26/26 APPLY 已应用）、`/tmp/b13b/apply-b.md`（组 B，14/14 APPLY + 5 份 manifest 迁移）、`/tmp/b13b/acceptance-drift.md`（R10 场景漂移修复记录，task-10）
- 基线：`develop/dialogue-based-novel-workbench` HEAD `ee2d1521` + 2026-10-22 本轮未提交工作树改动（含 Lead 全仓 format、基线清账、B21、B13b 落地）
- 输入规模：**22 份 ADR / 47 条 `## enforcement_gaps`** = 组 A 26 条（12 份）+ 组 B 14 条（9 份）+ 组 C 7 条（ADR-0028）

---

## 0. 状态、方法与证据口径

1. **职责**：B13b 只做「逐条对账 + 裁决 + ADR 文本/质量门禁面落地」，不把全部缺口都实现。裁决五类：修复-本批 / 修复-独立 slice / 降级 / 弃置 / 伪缺口需修正；ADR-0028 另有一条「随基线清账关闭」。
2. **真实页面证据只认**：`quality/acceptance/scenarios.yml` 已注册 + `quality/acceptance/scenarios/<id>.yml` + `artifacts/slice-verify/<id>-tauri*/summary.json`（及同目录截图/app JSONL/llm-calls）。**单测/组件测试只作局部证据，不能冒充真实页面闭环**。
3. **时间线（关键）**：判断纪元生产模块始于 `e34083e3`（2026-07-16 JudgmentProtocol），`c4509c86`（2026-07-19）完成「帧纪元退役」。**早于 2026-07-16 的 artifact 属前判断主链历史证据**，只能证明"曾经有验收"，不能主张当前 HEAD 页面闭环；本台账逐条标注证据日期与新旧。
4. **不信 ADR/清单自述**：每条 gap 均重新查代码给 `file:line`；`scripts/adr_trace.exs` 只校验 `enforced_by` 路径存在、**不解析 `enforcement_gaps`**，因此「ADR 门禁绿」≠「缺口已实装/已验收」。
5. **落地状态口径**（本文所有表）：`已落地`=审计时点在仓库工作树/证据中核实；`部分`=文本/数据层已落但验收或配套未闭环；`未落地`=本批裁决后尚未执行（多为转下批 B 轨）；`不适用`=转独立 slice/降级/弃置，不需要本批代码落地。
6. **纪律与并发**：三组审计均只读仓库（未跑 mix test / Tauri / commit）；落地阶段由 Lead 与各 owner 分工执行。本汇总落档时仓库仍有并发写入（基线 dialyzer、组 A/B APPLY、task-10 复跑），**落地状态以 2026-10-22 02:5x 工作树核实为准，最终以 apply-a.md/apply-b.md + Lead 全量复跑为准**。

---

## 1. 执行摘要

### 1.1 47 条裁决分布（主裁决）

| 组 | ADR 数 | 条数 | 修复-本批 | 修复-独立 slice | 降级 | 弃置 | 伪缺口需修正 | 其它 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| A（ADR-0001..0012） | 12 | 26 | 8 | 9 | 6 | 2 | 1 | — |
| B（ADR-0015..0026） | 9 | 14 | 4 | 5 | 2 | 1 | 2 | — |
| C（ADR-0028） | 1 | 7 | 1 | 2 | 2 | 0 | 1 | 随基线清账关闭 1 |
| **合计** | **22** | **47** | **13** | **16** | **10** | **3** | **4** | **1** |

> C 组 ADR-0028 的 G3 含「工作台当前卷 UI」+「卷蓝图编辑 UI」两个子项：当前卷=修复-独立 slice；编辑 UI=伪缺口需修正（VS-00J §1 非目标）。故 C 实际处置项 7 条 + 1 子项。

### 1.2 本批实际落地（核实于 2026-10-22 02:5x）

| # | 项 | 状态 | 核实方式 / 证据 |
|---|---|---|---|
| L1 | 全仓 `mix format` 修复 format 红 | ✅ 已落地（Lead 声明） | 工作树 115 个 modified 中大量纯格式化；本汇总未再复跑 `mix format --check-formatted` |
| L2 | `lint_enum_literals` 34→0（含 9 条 `(file,value)` 精确撞名豁免） | ✅ 按 Lead 复跑口径（本汇总未复跑） | `scripts/lint_enum_literals.exs` +29 行 `@value_exemptions`（带中文理由）；各 owner 修真实违规 |
| L3 | `mix credo --strict` 修复（初始 Nesting 1 条；落地中另修 persistence 2 条 Nesting + baseline-core complexity） | ✅ 按 Lead/owner 复跑口径（`acceptance-drift.md` §8：`mix credo --strict` found no issues） | `chapter_summary.ex`（baseline-support）+ `chapter_mission_repo.ex`/`planning_mission_repo.ex` helper 抽取（task-10 顺带） |
| L4 | `quality_manifest_check.sh`：2 个 browser driver ignored + 6 个真实 Tauri 场景登记 → **0 WARN EXIT=0** | ✅ 已落地并复跑核实 | `scripts/quality_manifest_check.sh` +8 行；`scenarios.yml` +6 条目；6 份新 manifest；`quality/acceptance/scenarios/README.md` +6 行。本汇总实跑 `bash scripts/quality_manifest_check.sh` → `passed`、0 WARN |
| L5 | 判断纪元 manifest 文本迁移 **8/8** | ✅ 已落地 | Lead 迁 `agent-conversation-turn`、`agentic-loop-plan-replan-reasoning`、`agentic-loop-no-deviation-direct`；组 B task-12 迁 `agent-plan-native-tool-calling-protocol`、D1/D2/D4/D7 四份（见 apply-b.md §1b）。遗留：`scenarios.yml` 8 个 title + `scenarios/README.md` 5 行旧描述——**已由 Lead 统一更新（核实 ✅），见 §6 D8** |
| L6 | **47/47 条 APPLY 文本落到 22 份 ADR** | ✅ 已落地 | 组 A `apply-a.md`：26/26、0 冲突；组 B `apply-b.md`：14/14；ADR-0028 与 README 由 Lead 落。`mix run scripts/adr_trace.exs` → **27/27（255 refs，0 pending）** |
| L7 | ADR-0028 gaps / ADR README 状态行按组 C 裁决改写 | ✅ 已落地 | `ADR-0028` 7 条裁决痕迹（G5/G7 删除、G2/G4 降级、G3/G1/G6 改写）；`docs/design/adr/README.md` 首段 + §8.3 行改为「CP0–CP5 全落 + B13b 裁决」 |
| L8 | R10 场景漂移 seed 修正 | ✅ 已落地 | `scripts/seed_au13_review_adjudication.exs`、`seed_au14_finding_inventory_arc.exs` 的 `planned_volumes` 3/4 → 1（保留字段、加注释） |
| L9 | `au13-review-adjudication-roundtrip` 复跑恢复绿 | ✅ 已落地（真实 Tauri PASS） | 2026-10-22 02:48 PASS：`review_finding_count=5`、rules=`{arc_stalled:4, premature_finale:1}`、`adjudicated_count=5`，app-log 无 `volume_plan_mismatch`（`artifacts/slice-verify/au13-review-adjudication-roundtrip-tauri/`） |
| L10 | `au14-finding-inventory-arc-loop` 复跑 | ✅ 已落地（真实 Tauri PASS，2026-10-22 02:51） | R10 修复后先暴露 D10（质量门禁叙事层元词规则 vs 旧 driver 期望），按 task-10 建议 A 把夹具 `apps/novel_agent/test/support/provider/slice_verify.ex:3996` 一行改为无元词句后复跑 PASS：`summary.json` 存在、报告 `finding_count=1`（rules=`{protagonist_undermaterialized:1}`）；证据 `artifacts/slice-verify/au14-finding-inventory-arc-loop-tauri/`。详见 `acceptance-drift.md` §6/§9、本文 §6 D10 |
| L11 | B21 首次 append 场名误标修复（B13b 背景项，非 47 gap） | ✅ 已落地（真实 Tauri PASS） | `adoption_repository.ex` `resolve_scene(:append)` 拆 `append_scene_title/2`；`p1-chapter-adoption-reading` manifest 增断言；2026-10-22 02:46 summary：`planned_scene_titles=["对账","夜巡"]`、`reading_scene_row_titles=["场景 1"]`；`tasks/slices/B21-first-append-scene-naming.md` done |

### 1.3 「修复-本批」13 项的真实落地状态（不得混淆）

> 13 项 = 组 A 8 + 组 B 4 + 组 C 1。**「修复-本批」是裁决类别，不等于本批已执行**；下表按 2026-10-22 02:5x 工作树与 apply-a/b 记录核实。

| 落地状态 | 项 | 说明 |
|---|---|---|
| ✅ 已落地 | B-ADR-0023（8 份 manifest 文本迁移） | 8/8 迁移完成（Lead 3 + task-12 5）；D1 场景仍需复跑取 summary（见 §6 D6/D9） |
| ✅ 已落地 | C-G6（R10 多卷场景） | seed 修正 + au13 复跑 PASS（02:48）+ au14 复跑 PASS（02:51，经 D10 夹具修复后）；blueprint 增量回归断言转独立 slice（§4.1 #10） |
| ✅ 已落地（B13B-FOLLOWUP 2026-10-23） | B-ADR-0025-CP1（conversation manifest 迁移 + judgment-plan 支路注册） | manifest 已迁 ✅；`judgment-plan-multi-step` 质量场景已注册（manifest + scenarios.yml + README）并真实 Tauri PASS（§11 / BB-12） |
| ✅ 已落地 6 / ⏸ 延后 2（B13B-FOLLOWUP 2026-10-23） | A 组 8 项：ADR-0002#3（`micro_plan.inspect_plan` 扫描面）、0004#3（`decision_trace_ref`）、0006#1（`dialogue` phase）、0006#2（`failed_recoverable`）、0007#3（AvailableAction `trace_ref`）、0009#1（binding 必填字段）、0010#1（采纳持久化失败 TurnResult）、0011#1（deprecated fixture+测试） | BB-1/2/3/5/6/8 已落地（§11，含测试）；**BB-4 `failed_recoverable` 语义边界需作者拍板**、**BB-7 采纳持久化失败 TurnResult（Q5 产品行为）需作者拍板**——诚实延后，见 §11.3 |
| ✅ 已落地 1 / ⏸ 延后 1（B13B-FOLLOWUP 2026-10-23） | B-ADR-0016（projection_refs schema 声明 + codegen）、B-ADR-0018（日志噪声门禁 `check_log_noise.sh` + 单 turn ≤30 断言） | BB-9 已落地（schema 3 字段 + codegen + 前端 schema 测试）；**BB-10 日志噪声口径与现有已绿场景实测（p1 单 turn 53 行 > ADR 30 行）冲突，需作者/质量口径裁决**——诚实延后，见 §11.3 |
| ✅ 已落地（B13B-FOLLOWUP 2026-10-23） | B-ADR-0026-g1 的 rail 计数真实页面断言 | au13 真实 Tauri PASS：报告生成后关闭档案 rail 显示「审读待处置 5」（= report finding_count），全部处置后 chip 消失；见 §11.2 / BB-11 |
| ◐ 按 Lead 复跑关闭（不属于上述 13 项，参考项） | C-G7（lint_enum_literals） | ADR gap 已删除；34→0 由 Lead 基线清账口径（**本汇总未复跑**）；最终以 `mix run scripts/lint_enum_literals.exs` 0 违例确认 |

### 1.4 五个关键结论

1. **47 条 gap 全部有裁决，且 ADR 文本 47/47 已落**；剩余工作是「转独立 slice 16 条 / 下批 B 轨小修 12 条 / 作者裁决 15 问」的排期，不是继续审计。
2. **最高价值发现（组 C）：B11A CP5 的 R10 负债规则已静默打破两个已注册 nightly 真实页面场景断言**（au13-review finding 5→6、au14-finding 1→2）；au13/au14 均已复跑 PASS（au14 期间暴露并修复 **D10：2026-08-25 质量门禁元词规则 vs 旧 driver 期望**的既有夹具漂移）。
3. **系统性 acceptance manifest 漂移**：除 ADR-0023/0025 点名的 3 个场景外，实际另有 5 个同族 manifest 旧口径（已由 task-12 迁移），以及组 A 发现的 **11 个 manifest 仍引用已退役 `planner.form_frame`/`form_micro_plan` 事件**（live-provider 变体在当前代码不可复跑，未修复）。
4. **「修复-本批」≠ 已修**：13 项中 2 项完全落地（B-23 manifests、C-G6 R10 两场景）、1 项部分（B-25 注册未落）、**10 项代码/门禁修复未落地**（8 条本批可修代码项 + B-16 schema + B-18 噪声门禁），均转下批 B 轨；本文按 ADR 裁决痕迹如实标注，不虚报完成。
5. **B13 已具备关闭条件与否取决于排期**：B13a（追溯门禁）+B13b（对账裁决）两阶段本批完成；剩余全为具体 slice/B 轨/作者裁决项，建议按 §10 处置。

---

## 2. 逐条裁决台账（47 条）

> 证据列：`nightly`=quality 场景已注册；`artifact` 日期为本地 mtime；`前判断纪元`=早于 2026-07-16 的历史证据。表内 `本批落地` 口径见 §0 第 5 条。

### 2.1 组 A（ADR-0001..0012，26 条）

| # | ADR | 缺口摘要 | 代码事实 / 证据（截断，保留 file:line） | 裁决 | 本批落地 | 下一步 |
|---|---|---|---|---|---|---|
| 1-1 | 0001 | `DialogueFrame` 由判断①机械转换，原 `form_frame` 管线退役 | 属实：`dialogue_planning_service.ex:807,1043-1074` `judgment_frame/4`；`planner.ex:1-8` 退役声明（commit `c4509c86` 2026-07-19）；证据 `au01-ordinary-chat-two-turn-roundtrip`（nightly，2026-07-24 判断纪元后）、`gap-wt04-non-exploration-frame-badges`（2026-07-24） | **弃置** | ADR 文本 ✅ DELETE +「迁移与兼容」注记（apply-a.md） | 无（载体迁移注记，不催修） |
| 1-2 | 0001 | `DialogueFrame.validate/1` 仅测试调用；author_visible_draft forbidden 扫描仅 3 词 | 属实：`dialogue_frame.ex:79-93,162-179`；全仓调用仅测试；主链 `dialogue_planning_service.ex:1043-1074` 直接构造；无真实页面 forbidden 场景 | **修复-独立 slice** `PLANNER-SEMANTIC-BOUNDARY` | ADR 文本 ✅ NEW | 进 §4 slice 1；与 3-1/3-2/3-3 同根 |
| 2-1 | 0002 | `MicroPlan` 由 `agent_run_flows` 机械构造；`form_micro_plan` 路径退役 | 属实：`judgment_plan.ex:845-874` 等 6 处 + `pending_artifact_workflow.ex:281-374`；`planner.ex:5` | **弃置** | ADR 文本 ✅ DELETE + 迁移注记 | 无 |
| 2-2 | 0002 | 「一个 primary frame 至多一个 primary MicroPlan」未强制 | **部分不准确**：step plan 引用 `primary:false` step frame（`judgment_plan.ex:428,575-594`）；`primary` 无消费者；真实偏差=ADR-0002#3「frame_ref 必须引用 primary frame」不成立 | **伪缺口需修正** | ADR 文本 ✅ NEW（修正为 primary 语义问题） | 待作者裁决 primary 语义（§7 Q1） |
| 2-3 | 0002 | `state_changes_requested`/`requires_confirmation_hint`/`fallback_strategy` 未消费；`check_forbidden` 扫描面不足 | 属实：`micro_plan.ex:77-114` 只扫 goal/proposed_actions/state_changes；三字段主链零消费；`@forbidden_semantics` 只经 inspect 文本 | **修复-本批** | ❌ 未落地，转下批 B 轨（ADR 裁决痕迹已标） | `micro_plan.ex:112-114` 纳 `required_capabilities`/`fallback_strategy` + `micro_plan_test.exs` 断言 |
| 3-1 | 0003 | `PlannerBoundary.validate/2` 只校验 frame_ref/forbidden/stop_after | 属实：`planner_boundary.ex:17-38`；`required_capabilities` 无 registry 校验；`state_changes_requested` 零消费 | **修复-独立 slice** `PLANNER-SEMANTIC-BOUNDARY` | ADR 文本 ✅ NEW | §4 slice 1；registry 复用 `CapabilityRegistry.get/1` |
| 3-2 | 0003 | 不校验 DialogueFrame forbidden 语义；`MicroPlan.check_forbidden` 缺 3 词 | 属实：主链无 `DialogueFrame.validate`；`micro_plan.ex:77-95` 12 词缺 `tool_request_id`/`state_adopted`/`available_action` | **修复-独立 slice** 同上 | ADR 文本 ✅ NEW | §4 slice 1；扩 `au01-frame-validation-friendly-error`/`agent-step-regate` |
| 3-3 | 0003 | Planner 输出已迁 judgment 结构，forbidden 扫描未对 judgment 原结构统一语义校验 | 属实：`judgment_protocol.ex:320-340` 只校验 record_only/候选一致性；`build_judgment` 无语义族扫描 | **修复-独立 slice** 同上 | ADR 文本 ✅ NEW | §4 slice 1 |
| 4-1 | 0004 | reply-only 主链不构造 `OrchestratorDecision` | 属实：`dialogue_planning_service.ex:804-830`（decision=nil）；`trace_writer.ex:20-50,368-370` 以 `decision_type=:reply_only` 承担解释；TurnResult.orchestrator_decision 无消费者 | **降级** | ADR 文本 ✅ NEW（文档化偏差） | 按 README §11.4 另立新 ADR 收窄（本批不新建） |
| 4-2 | 0004 | 缺 `tool_requests`/`state_transitions`；status 单值；decision_type 子集 | 属实：`orchestrator_decision.ex:8-16,49-64`；事实载体=`approved_actions`+TurnResult tool_result/state_delta；3 个 builder 恒 `:decided` | **降级** | ADR 文本 ✅ NEW | 同上；勿扩无用字段 |
| 4-3 | 0004 | 所有 builder 的 `decision_trace_ref` 保持 nil | 属实：`orchestrator_decision.ex:63` 默认 nil；`execution_orchestrator.ex:265-331` 不赋值；回填成本低（trace 与 decision 同作用域） | **修复-本批** | ❌ 未落地，转下批 B 轨 | trace 写入后回填 + TurnResult 映射 + 断言（`turn_execution_service.ex:274-311` 等） |
| 5-1 | 0005 | `GateOrder.evaluate/2` 只实装 8 门；behavior/slot/policy/toolbox 分散旁路 | 属实：`gate_order.ex:25-34` 恰 8 gates；`workspace_channel.ex:21-25,2861-2870` current_turn guard；`action_validator.ex:13-21,108-130`；`execution_orchestrator.ex:230-258` | **修复-独立 slice** `GATE-ORDER-CLOSURE` | ADR 文本 ✅ NEW | §4 slice 2（8→12 门 + 独立 GateResult） |
| 5-2 | 0005 | budget/trace_readiness/turn_result_compat 恒 `:pass`；correlation 无幂等 | 属实：`gate_order.ex:52-58,94-128`；budget 实际在 `agent_run_budget.ex:38-119`；幂等在 Channel/ActionIdempotencyService | **修复-独立 slice** 同上 | ADR 文本 ✅ NEW | §4 slice 2；合并 AU-10 receipt 为 gate lineage |
| 5-3 | 0005 | 无独立 `GateResult`/逐 gate trace/order version | 属实：`gate_order.ex:16-22` 轻量 type；`execution_orchestrator.ex:326` 只 first_blocking_gate；`gate_order_version` 0 命中 | **修复-独立 slice** 同上 | ADR 文本 ✅ NEW | §4 slice 2 CP1：GateResult/version 写入 DecisionTrace |
| 6-1 | 0006 | `build_phase/2` 不产 `dialogue`；自然对话=completed | 属实：`turn_result_builder.ex:99-107`；VS-03 §2 冻结 `dialogue`；TurnResult.phase 无消费者、schema 无 enum | **修复-本批** | ❌ 未落地，转下批 B 轨 | `build_phase(nil,nil)->"dialogue"` + 3 处 reply-path 测试断言 |
| 6-2 | 0006 | `build_status/3` 不产 `failed_recoverable` | 属实：`turn_result_builder.ex:104-118`；`agent_run_server.ex:685-706` 手写 failed（文案已声明可重试） | **修复-本批** | ❌ 未落地，转下批 B 轨 | builder 加分支 + `agent_run_server.ex:692` status→failed_recoverable |
| 7-1 | 0007 | VS-03 冻结的 recover 动作无生产者 | 属实：生产只产 answer/confirm/reject/cancel/candidate/artifact 动作；`retry_action`/`narrow_scope`/`no_further_action` 0 命中；恢复面由 DS03 控制坞承载（2026-07-28 真实 Tauri 三场景） | **降级**（收窄冻结集） | ADR 文本 ✅ NEW | 按 §11.4 另立 ADR 收窄动作集 |
| 7-2 | 0007 | `TurnResult.primary_next_action` 未实装 | 属实：全仓 0 命中/0 消费者；primary step 由 `behavior_state.active.required_next_action` 表达；draft VS-05 §2 仍要求必填 | **降级**（字段退役） | ADR 文本 ✅ NEW | 新 ADR 退役字段 + 同步 draft VS-05 |
| 7-3 | 0007 | behavior_actions 4 个动作不带 `trace_ref` | 属实：`execution_orchestrator.ex:203-220` 无 trace_ref；candidate/artifact 动作已有约定；VS-03 §3 必填 | **修复-本批** | ❌ 未落地，转下批 B 轨 | `behavior_actions/4` 加 turn_id + 4 动作 trace_ref + 测试 |
| 8-1 | 0008 | cancel/reject 关闭 BehaviorState 不经 OrchestratorDecision | 属实（引用需修正）：`dialogue_gateway.ex:312,364-460` 直接构造 `:cancelled`；规则原文在 VS-03 §4（draft），ADR-0008 正文只冻结 envelope | **修复-独立 slice** `BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY` | ADR 文本 ✅ NEW | §4 slice 3；前置=作者裁决 VS-03 是否冻结（§7 Q2） |
| 8-2 | 0008 | 同一 workstream 至多一个 primary author-blocking behavior 无显式 supersede | 属实：`:superseded` 从未赋值；依赖 `workspace_channel.ex:2861-2870` + 前端 `activeBehaviorId`；`au06-single-active-confirmation`（前判断纪元 2026-06-22）有系统不变量历史证据 | **修复-独立 slice** 同上 | ADR 文本 ✅ NEW | §4 slice 3 CP2 显式 supersede + 扩 au06 |
| 9-1 | 0009 | `ConfirmationBinding.build/1` 未把 `idempotency_key`/`trace_ref` 设必填 | 属实：`confirmation_binding.ex:24-43,67,70`；gateway 恒传（`dialogue_gateway.ex:678-690,625-631`），生产路径不受影响 | **修复-本批** | ❌ 未落地，转下批 B 轨 | 两字段改 `require_field` + domain fixtures |
| 9-2 | 0009 | binding 不校验 open behavior/target 一致性 | 属实：`confirmation_binding.ex:52-73` 只结构校验；上游 `action_validator.ex:108-130` + Channel guard 已守门 | **降级**（上游守门） | ADR 文本 ✅ NEW | 若 VS-03 §5 冻结，并入行为生命周期 slice（§7 Q2） |
| 10-1 | 0010 | 持久化 writer error 时 AdoptionWorkflow 直接 `{:error}`，不产 TurnResult | 属实：`adoption_workflow.ex:202-232`（persist error 分支）；`workspace_channel.ex:2187-2221` 只回 error 帧；VS-04 §5 规则 5 要求必产 TurnResult | **修复-本批** | ❌ 未落地；按 Lead Q6 不在本批实现，转下批 B 轨 | 构造 failed TurnResult + failure action_result + 注入 writer error 单测 |
| 11-1 | 0011 | registry 无 deprecated 条目，缺专项测试 | 属实：`capability_registry.ex:38-173` 仅 active/disabled；`dispatchable?/1` 白名单；无 deprecated 测试 | **修复-本批** | ❌ 未落地，转下批 B 轨 | 加 `deprecated_tool` 固定件 + 2 条断言；**验收场景不适用**（不在 planner 目录） |
| 12-1 | 0012 | Toolbox 不按 `output_contract_ref` 统一校验 ToolResult.output | 属实：`toolbox.ex:31-55` 无 output 校验；仅 creative 路径走 ToolOutputContract；`text_analysis`/`character_roster` 无冻结 schema | **降级**（契约缺失不可校验） | ADR 文本 ✅ NEW | 新 ADR 收窄规则 4，或先冻结两个 output schema 再开 slice（§7 Q3） |

### 2.2 组 B（ADR-0015/0016/0018/0019/0020/0023/0024/0025/0026，14 条）

| # | ADR | 缺口摘要 | 代码事实 / 证据（截断，保留 file:line） | 裁决 | 本批落地 | 下一步 |
|---|---|---|---|---|---|---|
| B-15 | 0015 | 冻结的 `TurnResultViewModel` 无同名模块，现行 envelope 为 TurnResult v3 | 属实：全仓 0 命中；canonical=`TurnResultBuilder`（`turn_result_builder.ex:1-4,35,265`；schema `turn_result_v3.json:5,27-29`）；设计名仍在 07§3.1/VS-05/VS-05 slice（docs-ready） | **降级**（文档化偏差） | ADR 文本 ✅ NEW | 确认不新建模块（§7 Q14）；记录设计名→实现名映射 |
| B-16 | 0016 | `NovelDomain.ProjectionHint` 无调用者；v3 schema 未声明运行期 3 字段 | 属实：`projection_hint.ex:1-43` 0 调用；生产裸 map `adoption_boundary.ex:349-358` + `adoption_workflow.ex:1153-1180` 运行期补 3 字段；schema `turn_result_v3.json:202-213` 未登记；`au07-state-trace-adoption-replay` 已验 `source_state_trace_ref` | **修复-本批（schema）+ 降级（struct 不接线）** | ◐ 仅 ADR 文本 ✅；schema/codegen ❌ 未落地 | 补 3 字段声明 + `pnpm codegen:schemas`；struct 不接线 |
| B-18 | 0018 | §6 噪声约束（单 turn ≤30 行/常规无 warning）无机器校验 | 属实：无校验脚本/断言；`vs10-observability-spine` 无行数/级别断言且 artifact 2026-07-01 过期（driver 帧纪元）；生产 lib 当前 0 处 Logger.warning 但无门禁 | **修复-本批** | ❌ 未落地（ADR 文本 ✅） | 新增 `scripts/check_log_noise.sh` + 已绿 Tauri verifier 断言 + manifest；见 §6 D14 |
| B-19g1 | 0019 | `AdoptionRepository` 直写 ACCEPTED/SUPERSEDED 绕过转换矩阵 | 属实（修正 B13a 误算）：MemoryItem 属记忆状态机（ADR 非目标）、LedgerEntry 走两步仪式；真实缺口=artifact/Draft 持久化边界未强制矩阵；`artifact_adoption_entry.ex:62-76` 仅被无生产写入的 embedded schema 引用 | **修复-独立 slice** `Q1Cb-adoption-transition-enforcement` | ADR 文本 ✅ NEW（含修正） | §4 slice 4；Contract=矩阵/INV-1/INV-4；扩 q1c/p1-chapter-edit-then-accept |
| B-19g2 | 0019 | 复活/un-archive 只有矩阵与单测，无生产入口 | 属实：`adoption_status.ex:10-19`；生产 0 命中；无场景 | **修复-独立 slice（等产品触发）** `AU05b-adoption-revive` | ADR 文本 ✅ NEW | §4 slice 5；若不承诺则降级 Deferred（§7 Q4） |
| B-20 | 0020 | I10 人工盲评未归档 | 属实：`p1-prose-quality-real-provider-sample` 不在 scenarios；现有 p1-prose-quality-* 全 `provider: slice_verify` fixture；contract VS-00E:248 要求 | **修复-独立 slice（人工盲评，AI 不可自证）** | ADR 文本 ✅ NEW | §4 slice 6；真实 provider 采样 + 人工盲评归档 `walkthroughs/<date>/` |
| B-23 | 0023 | 2 份 manifest 仍写旧 `conversation_turn_v1` 计划链；D6 口径过时 | **真漂移在 manifest**：driver/verifier/artifact 已迁判断纪元（`external-ui-driver.mjs:25638,26080-26160,26166-26172`；`native-tauri-verifier.mjs:6038-6180,6321-6342,6394-6483`；artifact 2026-07-16/18）；同族另 5 份同样漂移 | **伪缺口需修正 + 修复-本批** | ✅ 8/8 manifest 已迁（Lead 3 + task-12 5）；ADR 文本 ✅；遗留 index title/README 5 行+D1 复跑 | 见 §6 D3/D4/D5/D6/D8/D9/D10/D14 |
| B-24S4 | 0024 | S4 显式澄清面未落地 | 属实且更彻底：判断纪元无 `require_clarification` 生产者（`execution_orchestrator.ex:325-331,118-126`）；`answer_clarification` 不可达；残留前端 auto-track（`WorkspaceChat.tsx:1507-1516`）；DS03 控制坞已成事实澄清回收面 | **降级** | ADR 文本 ✅ NEW | 触发=误判可复现/产品要求选项化澄清 → `DS04-clarification-surface`（§7 Q6） |
| B-24S7 | 0024 | S7 `available_actions` 恢复面未关闭 | **部分已闭环**：预算缺口路径由 B20 CP3（`f8f62fe5` 2026-10-21）产出带恢复动作 TurnResult（`agent_run_server.ex:1842-1893`），真实 Tauri `agentic-loop-budget-deviation-replan` 已证；剩余=非预算 await 无 TurnResult + agent_run_state 无 schema 载体 | **伪缺口需修正（缩窄保留）** | ADR 文本 ✅ NEW | 非预算 await 进入作者可见场景时按同型 envelope 统一 settle |
| B-24g3 | 0024 | `capability_notice` Deferred；`schema_version` 未 semver 收敛 | 属实：capability_notice 0 命中；`3.0-draft` 全链；两项**本就是 ADR-0024 决策内 Deferred 项**，不属未实装 gap | **弃置（DELETE）** | ✅ DELETE + `### B13b 裁决` 注记 | 保留 Deferred 处可追踪性，不占 gaps |
| B-25CP6 | 0025 | CP6 外部探索翼未实现 | 属实：`SearchProvider`/`web_search` 0 命中；内部翼已实现（`exploration_service.ex:1-40`）；slice CP6 todo | **修复-独立 slice（等触发）** `UA01-CP6-external-exploration` | ADR 文本 ✅ NEW | §4 slice 7；开工前作者拍板出站授权/来源可信度（§7 Q7） |
| B-25CP1 | 0025 | `agent-conversation-turn` manifest 仍旧链；「只能由 wr02 证明 plan 支路」不成立 | 前半真：manifest 旧链；driver/verifier/artifact 已 judgment_loop_v1 2/2；后半假：`judgment-plan-multi-step` 有 2026-07-19 真实 Tauri 证据（judgment_plan_v1、4 步、3 产物）但**未注册 quality 场景** | **修复-本批** | ◐ manifest 迁移 ✅；ADR 文本 ✅；`judgment-plan-multi-step` 注册 ❌ | 注册新 manifest + scenarios.yml 条目（§6 D15） |
| B-26g1 | 0026 | VS-00F 余项：rail 待处置计数、LongRunTask 关联 | **(a) rail 已实现**：`WorkspaceChat.tsx:1231-1235,5138-5151` + `copy.ts:575`（commit `dab0bc97` 2026-07-22），但无真实页面断言；(b) LongRunTask 确实未落地（`ledger_maintenance.ex:318-330` 仅章数节拍） | **伪缺口需修正**（rail 已实现缺验收；LongRunTask 保留） | ◐ ADR 文本 ✅；rail 断言 ❌ | rail 断言加入 au13 场景并复跑；LongRunTask 等 durable 定期化触发（§4 slice 8） |
| B-26g2 | 0026 | dismiss 仍写 `ledger.dismiss.done`，未收编 Experience Engine | 属实：`ledger_adjudication_service.ex:163-172` 只写日志；33 Experience Engine 无运行时（0 命中）；au13 断言的是日志而非 Engine | **修复-独立 slice（等 Engine 触发）** | ADR 文本 ✅ NEW | §4 slice 9；Engine 运行时出现后收编 + 更新 au13 断言 |

### 2.3 组 C（ADR-0028，7 条）

| # | 缺口摘要 | 代码事实 / 证据（截断，保留 file:line） | 裁决 | 本批落地 | 下一步 |
|---|---|---|---|---|---|
| C-G1 | R10/R11 负债规则 finding 真实触发验收未做 | 规则 `ledger_reconciliation.ex:224-300`；scan 接入 `ledger_reconciliation_service.ex:68,194-205`；域/服务测试有；无正触发真实页面。反向副作用：R10 打坏 au13-review（5→6）/au14-finding（1→2） | **修复-独立 slice**（正触发）+ 附带修复-本批（既有场景） | ◐ 既有场景：seed 已修 + au13 PASS ✅ + au14 PASS ✅（D10 夹具修复后）；正触发 slice ❌ | §4 slice 10：扩既有审读场景或新增 volume-debt 场景（planned=3 且 2 卷缺蓝图 → finding → 处置 → 清空） |
| C-G2 | `VolumeBlueprint.design_ref/1` 只给形状，未写五本账 | `volume_blueprint.ex:185-208` helper；全仓无产品调用；VS-00J:126 明文「只定形状，不接线」 | **降级**（契约明示延后，非 enforcement 失败） | ✅ ADR 文本（APPEND 降级注记） | 归 R2/承诺账 slice（`ledger_reconciliation.ex:17` CP2b 数据基础）；见 §4 slice 12 |
| C-G3 | 卷蓝图编辑 UI 未做；工作台「当前卷」仍硬编码 | 编辑 UI 属 VS-00J §1/ADR 非目标（`VS-00J:28`、ADR:51）；前端只读 `StructurePanel.tsx:739-742,1443-1449`；当前卷：`WorkspaceChat.tsx:1683,1779,3885` 写死「未定卷」，坐标数据已真实（`turn_execution_service.ex:331,344`；au08 summary `volume_ref` 绑定 TOC id） | 当前卷=**修复-独立 slice**；编辑 UI=**伪缺口需修正**（非目标） | ✅ ADR 文本拆分改写 | §4 slice 11：独立前端接当前卷（数据源/语义待作者裁决 §7 Q11） |
| C-G4 | 开新卷形态 A 为最小入口；45 §4.2 完整方向候选流未做 | 机械入口 `workspace_channel.ex:230-260,2295-2335`；UI `StructurePanel.tsx:1408-1425`；无方向候选/确认卡；VS-00J §9① 已拍板形态 A（翻案条件=真实作者反馈） | **降级**（已拍板形态裁剪） | ✅ ADR 文本（APPEND 降级） | 产品 backlog；若作者要 45§4.2 完整体验按 ADR 修订开 slice（§7 Q13） |
| C-G5 | `next_seq` 采用 max(seq)+1 | 与 VS-00J:71 append-only 口径逐字一致（`volume_scope.ex:49-72`） | **伪缺口需修正（删除）** | ✅ ADR 已删除（保留为实现注记） | 无 |
| C-G6 | 其它多卷场景回归未做（blueprint 增量兼容未断言） | 桩 `slice_verify.ex:1998-2008,2065-2085`；`WorkSkeleton.volume_directive`（`work_skeleton.ex:121-160`）；planned_volumes>1 seed 仅 4 个；R10 真实副作用见 C-G1 | **修复-本批 + 修复-独立 slice** | ✅ seed + au13 PASS + au14 PASS（D10 夹具修复后）；blueprint 增量回归断言转独立 slice | 见 §6 D1/D2/D10；独立 slice 补 multi-volume 回归（§4.1 #10） |
| C-G7 | lint_enum_literals 为 HEAD 既有红（34/18 文件） | 审计时点 5 violations/4 文件（prose_revision_from_findings.ex:781 等）；baseline 清账 34→0（含精确豁免） | **随基线清账关闭（条件删除）** | ✅ ADR 已删除该条；lint 0 由 Lead 复跑口径 | 最终以 `mix run scripts/lint_enum_literals.exs` 0 违例确认（Lead） |

---

## 3. 本批已落地（执行者 / 文件 / 证据 / 命令）

### 3.1 工程基线清账

| 项 | 执行者 | 文件 | 证据/命令 |
|---|---|---|---|
| 全仓 format | Lead | 全仓（工作树大量纯格式化） | `mix format --check-formatted`（Lead 复跑） |
| enum literal lint 34→0 | Lead + 各 owner（task-1/2/3/4） | `scripts/lint_enum_literals.exs` +29 行精确 `(file,value)` 豁免；owner 修真实违规 | `mix run scripts/lint_enum_literals.exs`（Lead 复跑） |
| credo Nesting | baseline-support（task-4） | `apps/novel_domain/lib/novel_domain/chapter_summary.ex` | `mix credo --strict`（Lead 复跑） |
| dialyzer 369→0 | baseline-flows/core/persistence/support（task-1/2/3/4） | 按 app 分派的告警修复；root `mix.exs` `plt_add_apps: [:mix]` | `mix dialyzer`（Lead 最终复跑；本汇总未复跑） |
| quality_manifest_check 0 WARN | Lead（task-11）+ 组 C 分析 | `scripts/quality_manifest_check.sh`（2 ignored + 注释）；`scenarios.yml` +6；新 manifest ×6；scenarios/README +6 行 | 本汇总实跑：`bash scripts/quality_manifest_check.sh` → `passed`、0 WARN、EXIT=0 |
| 判断纪元 manifest 迁移 8/8 | Lead（3）+ b13b-adr-b（5） | 8 个 `quality/acceptance/scenarios/*.yml` | `apply-b.md` §1b；本汇总逐份核实判断纪元断言 |
| ADR 文本 47/47 APPLY | b13b-adr-a（26）、b13b-adr-b（14）、Lead/C（7） | 22 份 ADR | `apply-a.md`（26/26,0 冲突）、`apply-b.md`（14/14）；`mix run scripts/adr_trace.exs` → 27/27（255 refs,0 pending） |
| ADR README ADR-0028 状态行 | Lead | `docs/design/adr/README.md` 首段 + §8.3 | 本汇总核实 |

### 3.2 验收漂移（R10 → 两场景）+ D10

- 执行者：`baseline-persistence`（task-10），记录 `/tmp/b13b/acceptance-drift.md`。
- 改动（3 处，均非产品代码）：
  1. `scripts/seed_au13_review_adjudication.exs`、`scripts/seed_au14_finding_inventory_arc.exs` 的 `planned_volumes` 3/4 → 1（保留字段 + 3 行注释）。
  2. **D10 夹具修复**：`apps/novel_agent/test/support/provider/slice_verify.ex` 的 `roster_presence_sentence` 中「…压低声音向主角确认了暗号」改为「…压低声音与来人对了暗号」（1 行 + 注释）。根因=质量门禁 2026-08-25（commit `5ea79995`）新增叙事层元词规则（`prose_quality_validators.ex:57` `主角/反派/配角`），prose 正文命中即产 quality finding，采纳 UI 从「保存为章节正文」切到质量复核卡，而旧 driver（2026-07-24）直接点「保存为章节正文」→ 超时。产品代码/门禁未改。
- 复跑（真实 Tauri，2026-10-22 02:48 / 02:51，串行锁 `/tmp/ainovel-tauri.lock`）：
  - `au13-review-adjudication-roundtrip`：**PASS**，`review_finding_count=5`、rules=`{arc_stalled:4, premature_finale:1}`、`adjudicated_count=5`，app-log 无 `volume_plan_mismatch`。
  - `au14-finding-inventory-arc-loop`：R10 修复后先红于 D10；夹具修复后 **PASS**，`summary.json` 存在、报告 `finding_count=1`、rules=`{protagonist_undermaterialized:1}`。
- 证据：`artifacts/slice-verify/{au13-review-adjudication-roundtrip,au14-finding-inventory-arc-loop}-tauri/summary.json`；其余 `planned_volumes>1` seed 的只读风险核查见 `acceptance-drift.md` §5（ca04 潜在 R10 风险、au08 数据自洽、au13-revise/au14-foreshadow 安全）。
- 长期建议（D10）：凡「driver 直接点『保存为章节正文』」的 prose 采纳步骤，应统一容忍质量复核分支（或夹具/seed 保证正文无叙事层元词）；manifest user_flow 未提质量复核，建议全量 nightly 机械对照（见 §6 D10、§7 Q15）。

### 3.3 B21（B13b 背景项）

- 执行者：`b21-scene-naming`（task-5）；slice `tasks/slices/B21-first-append-scene-naming.md`（done）。
- 根因/修复：`adoption_repository.ex` `resolve_scene(:append)` 首次 append 不再回填 `scene_plans[0].title`，固定占位「场景 1」（阅读端 `isGeneratedScenePlaceholder` 已隐藏）；第二次 append 保持 NEM04 场名；overwrite 不变。
- 证据：`artifacts/slice-verify/p1-chapter-adoption-reading-tauri/summary.json`（2026-10-22 02:46）：`planned_scene_titles=["对账","夜巡"]`、`reading_scene_row_titles=["场景 1"]`；`p1-chapter-adoption-reading.yml` 增 5 条断言。
- **真实模型验收（2026-10-22 23:35，Lead）**：`--provider strata`（iq3_s）真实 Tauri PASS——8 次真实请求、18,767/5,606 tokens、真模型 1700 字正文；B21 全部断言（计划场名不冒充/scene 行="场景 1"/无假标题/字数一致）在真实模型路径同样成立；同时修复 D19 验收 harness 真实-provider 假设（产品代码零改动）。证据 `artifacts/slice-verify/p1-chapter-adoption-reading-tauri-strata/summary.json`。

---

## 4. 转独立 slice / B 轨挂账清单

### 4.1 转独立 slice（16 条裁决 → 11 个候选 slice）

| # | 候选 slice | 来源 gap | Contract（冻结什么） | Invariant（保护什么） | Acceptance Driver（真实页面） | 触发/前置 |
|---|---|---|---|---|---|---|
| 1 | `PLANNER-SEMANTIC-BOUNDARY` | A 1-2、3-1、3-2、3-3 | ADR-0003 权限边界 + ADR-0001 forbidden 语义族（13 词）+ VS-01 最小 contract | judgment 原结构/Frame/MicroPlan 三层语义校验；required_capabilities 必须在 registry；越权词不得静默进 TurnResult | 扩 `au01-frame-validation-friendly-error`（stub 返回含语义族词 judgment）+ `agent-step-regate`（step 级） | 无需作者前置；可直接排期 |
| 2 | `GATE-ORDER-CLOSURE` | A 5-1、5-2、5-3 | ADR-0005 gate 顺序（8→12）+ VS-01 gate subset | 每个不可逆动作逐门可解释；GateResult/version 写 DecisionTrace；correlation 幂等 lineage | 扩 `e2e-01-downgrade-real-page`/`agent-step-regate` 断言 gate 序列 | 无需前置 |
| 3 | `BEHAVIOR-LIFECYCLE-DECISION-AUTHORITY` | A 8-1、8-2（+9-2 若 VS-03 冻结） | ADR-0008 + VS-03 §4 规则4（若冻结） | behavior 开/更新/关闭经 decision；同 workstream 显式 supersede | 扩 `au10-workbench-recovery-cancel-waiting` + `au06-single-active-confirmation` | 作者裁决 VS-03 是否冻结（§7 Q2） |
| 4 | `Q1Cb-adoption-transition-enforcement` | B 19-g1 | ADR-0019 矩阵/INV-1/INV-4 + artifact_adoption_entry schema | 非法转换在持久化边界被拒可解释；canon 必经 TENTATIVE→ACCEPTED 两步 | 扩 `q1c-adopted-content-revision`/`p1-chapter-edit-then-accept` 断言持久化状态历史 | 作者确认矩阵下沉 persistence 的风险（§7 Q4） |
| 5 | `AU05b-adoption-revive` | B 19-g2 | ADR-0019 复活路径/INV-1/INV-3 | 复活必须经 TENTATIVE 重入采纳、直达 ACCEPTED 被拒 | au05 家族：丢弃已采纳→从档案恢复→重新采纳，断言状态续链 | 作者确认是否承诺复活体验（§7 Q4） |
| 6 | `P1-prose-quality-real-provider-sample` | B 20 | VS-00E:248 + ADR-0020 I10 | fixture/自动化不得冒充质量收益；盲评材料可追溯且不自动改稿 | 真实 provider 采样产候选对 → 人工盲评归档 `walkthroughs/<date>/REPORT.md`；场景只收集材料 | 作者指定盲评负责人/时机（§7 Q8） |
| 7 | `UA01-CP6-external-exploration` | B 25-CP6 | ADR-0025 §3 外部翼 + `SearchProvider` contract | 只产带来源 tentative 候选；未采纳不进 canon；query 全进 trace；网络出站显式授权 | 真实 Tauri：现实资料问题→搜索活动行→带来源候选→采纳进 canon | 作者先拍板出站授权粒度/来源可信度（§7 Q7） |
| 8 | `VS-00F-durable-reconciliation`（LongRunTask A20） | B 26-g1 余项 | VS-00F:116 + ADR-0021 A20 | 定期化对账跨重启恢复同一 LongRunTask、不重复派发 | backend restart 后同一 LongRunTask 恢复且不重复派发已完成审读 | 定期化对账需要 durable/超出 bounded 预算时 |
| 9 | `EXPERIENCE-ENGINE-dismiss-integration` | B 26-g2 | ADR-0026 + 33 Experience Engine 契约（未运行） | dismiss 收编为 experience_evidence 输入、日志保留为审计镜像 | 更新 au13 断言：dismiss 产 experience evidence 而非仅日志 | 33 Experience Engine 出现运行时后 |
| 10 | `B11A-R10R11-volume-debt-scenario`（正触发） | C G1、C G6 | VS-00J §4 item5/§9 决策④ + ADR-0028 | R10/R11 finding 在真实页面出现并可处置、报告清空；事实优先不静默改写 | 扩既有审读场景或新增 volume-debt 场景：planned=3 且 2 卷缺蓝图 → 审读 → 两条 finding → 处置 → 无活跃报告 | 无需前置；建议随下批 B 轨 |
| 11 | `WORKBENCH-CURRENT-VOLUME` | C G3 | ADR-0028 §UI 影响 + VS-00J 消费面 | 工作台头部显示真实写作坐标当前卷，不出现假「未定卷」；无验收感知逻辑 | 扩 `au08-volume-structured-planning` 断言当前卷名=真实卷；真实 Tauri 复跑 | 作者定当前卷语义/数据源（§7 Q11） |

> 补充挂账（trigger 型，不新开 slice）：`DS04-clarification-surface`（B-24S4 触发）、`NEXT-B-BATCH-CODE-SMALL`（见 §4.2）、`R2-design-ref-wiring`（C-G2 归 R2/承诺账，§4.2）。

### 4.2 下批 B 轨小修批次（本批「修复-本批」未落地 12 项；其中 **8 条为组 A 本批可修代码项转下批 B 轨（本批未落地代码）**）

| # | 项 | 来源 | 精确落点/预期改动 | 验收/测试 |
|---|---|---|---|---|
| BB-1 | `micro_plan.inspect_plan` 扫描面 | A 2-3 | `apps/novel_domain/lib/novel_domain/micro_plan.ex:112-114` 纳入 `required_capabilities`/`fallback_strategy` | `micro_plan_test.exs` +2 forbidden 断言 |
| BB-2 | `decision_trace_ref` 回填 | A 4-3 | `turn_execution_service.ex:274-311`、`pending_artifact_workflow.ex:307-325,387-405`、`turn_result_builder.ex:177-184` | 确认 re-gate/pending 路径断言 `decision_trace_ref == trace_ref` |
| BB-3 | TurnPhase `dialogue` | A 6-1 | `turn_result_builder.ex:99-101` 前插 `build_phase(nil,nil)->"dialogue"` | 更新 3 处 reply-path 断言 + builder 单测 |
| BB-4 | TurnStatus `failed_recoverable` | A 6-2 | `turn_result_builder.ex:104` + `agent_run_server.ex:692` | `agent_run_runtime_test.exs:516` + builder 单测 |
| BB-5 | AvailableAction `trace_ref` | A 7-3 | `execution_orchestrator.ex:203-220` 加 turn_id 入参 + 4 动作 trace_ref | `execution_authority_test.exs`/`behavior_lifecycle_test.exs` |
| BB-6 | ConfirmationBinding 必填字段 | A 9-1 | `confirmation_binding.ex:52-73` 两字段 `require_field` | domain fixtures + gateway 回归（已恒传） |
| BB-7 | 采纳持久化失败 TurnResult | A 10-1 | `adoption_workflow.ex:202-232` persist error 分支 + failure action_result | 注入 writer `{:error,:boom}` 单测 + channel 回归（错误路径响应形态变化，需 Lead 拍板） |
| BB-8 | deprecated fixture + 测试 | A 11-1 | `capability_registry.ex:157-172` 加 `deprecated_tool`；`tool_provenance_test.exs` | dispatchable=false + execute→tool_not_dispatchable；**不写验收场景**（无产品路径） |
| BB-9 | projection_refs schema 声明 | B-16 | `docs/design/schemas/foundation/turn_result_v3.json:202-213` + `pnpm codegen:schemas` | codegen drift 门禁；无运行时行为变化 |
| BB-10 | 日志噪声门禁 | B-18 | 新增 `scripts/check_log_noise.sh` + 已绿 Tauri verifier 断言 + manifest | 脚本绿 + 场景复跑 |
| BB-11 | rail 待处置计数断言 | B-26g1 | `external-ui-driver.mjs:13794 driveAu13ReviewAdjudicationRoundtrip` + verifier + au13 manifest | au13 真实 Tauri 复跑：报告生成后关闭档案断言 rail「审读待处置 N」，全处置后消失 |
| BB-12 | `judgment-plan-multi-step` 质量场景注册 | B-25CP1 | 新增 `quality/acceptance/scenarios/judgment-plan-multi-step.yml` + scenarios.yml 条目 | `quality_accept.sh judgment-plan-multi-step --surface tauri` 复跑；证据 2026-07-19 已有 |

### 4.3 延后接线/触发条件挂账

| 项 | 来源 | 触发条件 | 归属 |
|---|---|---|---|
| `design_ref` → 五本账接线 | C-G2 | R2/承诺账 slice 需要卷蓝图引用时（`ledger_reconciliation.ex:17` CP2b 数据基础） | R2/承诺账 |
| 45 §4.2 完整新卷方向候选流/确认卡 | C-G4 | 真实作者反馈需要独立卷管理入口（VS-00J §9① 翻案条件） | 产品 backlog / 新 ADR |
| `DS04-clarification-surface` | B-24S4 | 实测判断①把「需澄清」误判为 explore/direct_reply 可复现，或产品要求选项化澄清面 | 决策面 B 轨 |
| 只读工具 output contract | A 12-1 | 需要统一校验前先冻结 `text_analysis_output_v1`/`character_roster_result_v1` schema | 新 contract/slice |
| 降级项的新 ADR 收窄 | A 4-1/4-2、7-1/7-2、9-2、12-1 | 按 ADR README §11.4：实现反馈改变 Accepted ADR 须新增 ADR 替代（本批不新建） | 下一轮 ADR |

---

## 5. 降级 / 弃置 / 伪缺口修正清单（ADR 文本落点）

> 全部 18 项 ADR 文本已落地（apply-a 26/26、apply-b 14/14、ADR-0028 由 Lead 落）。「落点」=该 ADR 内承载裁决的位置。

| # | ADR | gap | 处置 | ADR 文本落点 | 状态 |
|---|---|---|---|---|---|
| 5-1 | 0001 | 1-1 | 弃置 | `## enforcement_gaps` DELETE + 「迁移与兼容」注记 + `### B13b 裁决` | ✅ |
| 5-2 | 0001 | 1-2 | 伪缺口→修正为修复-独立 slice | gap 行 NEW（PLANNER-SEMANTIC-BOUNDARY） | ✅ |
| 5-3 | 0002 | 2-1 | 弃置 | DELETE +「迁移与兼容」注记 + 裁决节 | ✅ |
| 5-4 | 0002 | 2-2 | 伪缺口需修正 | gap 行 NEW（primary step frame 事实修正） | ✅ |
| 5-5 | 0004 | 4-1、4-2 | 降级（文档化偏差） | gap 行 NEW ×2（含 §11.4 后续动作） | ✅ |
| 5-6 | 0007 | 7-1、7-2 | 降级（收窄冻结集/字段退役） | gap 行 NEW ×2 | ✅ |
| 5-7 | 0009 | 9-2 | 降级（上游守门） | gap 行 NEW | ✅ |
| 5-8 | 0012 | 12-1 | 降级（契约缺失不可校验） | gap 行 NEW | ✅ |
| 5-9 | 0015 | B-15 | 降级（文档化偏差） | gap 行 NEW | ✅ |
| 5-10 | 0024 | B-24S4 | 降级 | gap 行 NEW | ✅ |
| 5-11 | 0024 | B-24S7 | 伪缺口需修正（缩窄保留） | gap 行 NEW | ✅ |
| 5-12 | 0024 | B-24g3 | 弃置 | DELETE + `### B13b 裁决` 注记 | ✅ |
| 5-13 | 0026 | B-26g1 | 伪缺口需修正（rail 已实现/LongRunTask 保留） | gap 行 NEW | ✅ |
| 5-14 | 0028 | C-G2 | 降级（契约明示延后） | gap 行 APPEND 降级注记 | ✅ |
| 5-15 | 0028 | C-G3 编辑 UI 子项 | 伪缺口需修正（非目标） | gap 行改写为「当前卷 UI」缺口 + 编辑 UI 移出 | ✅ |
| 5-16 | 0028 | C-G4 | 降级（已拍板形态裁剪） | gap 行 APPEND 降级注记 | ✅ |
| 5-17 | 0028 | C-G5 | 伪缺口（删除） | gap 行 DELETE（保留实现注记） | ✅ |
| 5-18 | 0028 | C-G7 | 随基线清账关闭（删除） | gap 行 DELETE | ✅ |

> 未在本文复制的「完整 NEW 文本」：见各 ADR 当前 `## enforcement_gaps`（已落地，可直接阅读）；组 A/B 落地记录见 `/tmp/b13b/apply-a.md`、`apply-b.md`；组 C 见 `/tmp/b13b/part-c.md` §1.3。

---

## 6. 场景注册与断言漂移清单

> 来源：part-c 场景漂移专项（原 D1–D9，本文重新编号）+ part-b §2.1（8 份 manifest 漂移）+ part-a §0-5（11 份退役事件 manifest）+ task-10 `acceptance-drift.md`（D10）+ 最近失败无 summary 场景 + vs10 过期。状态为 2026-10-22 02:5x。

| ID | 漂移项 | 现状与证据（2026-10-22 02:5x） | 类型 | 归属/处置 |
|---|---|---|---|---|
| D1 | `au13-review-adjudication-roundtrip` finding_count 5→6（R10） | 旧证据 2026-07-29 count=5；seed planned_volumes 3→1 后 2026-10-22 02:48 真实 Tauri **PASS**：count=5、rules 一致、无 `volume_plan_mismatch` | **已修复**（R10 副作用） | ✅ task-10；关闭 |
| D2 | `au14-finding-inventory-arc-loop` finding_count 1→2（R10） | seed 修正后 R10 数据层断言恢复（report count=1）；2026-10-22 02:51 经 D10 夹具修复后真实 Tauri **PASS**，`finding_count=1`、rules=`{protagonist_undermaterialized:1}` | **已修复**（R10 副作用） | ✅ task-10；关闭 |
| D3 | ADR-0025 gap：`agent-conversation-turn` manifest 旧链 | manifest 已迁 judgment_loop_v1 2/2 ✅；证据：`-tauri-lmstudio/summary.json` 2026-07-20 PASS；`-tauri` 目录为 2026-07-20 端口冲突失败（无 summary） | **已迁移；证据待复跑** | 复跑取新 summary 后可关闭 ADR-0025 gap |
| D4 | ADR-0023 gap：`agentic-loop-plan-replan-reasoning` manifest 旧链 | 已迁 prose 基座+判断②续行 ✅；evidence 2026-07-18（prose_drafting_with_quality_v1、replans=1、短计划）PASS | **已迁移**（证据为判断纪元） | 可关闭该半句；建议 nightly 复跑 |
| D5 | ADR-0023 gap：`agentic-loop-no-deviation-direct` manifest 旧链 | 已迁 judgment_loop_v1 直通 ✅；evidence 2026-07-16 PASS（2/2） | **已迁移；场景语义待裁决** | 场景「无偏离计划直通」语义已退役，弃置 vs 改指待作者裁决（§7 Q10） |
| D6 | 同族 5 份 manifest 旧口径（未点名但同病） | `agent-plan-native-tool-calling-protocol`、D1/D2/D4/D7 四份已由 task-12 迁到判断纪元 ✅；D1 无 summary（2026-10-21 失败）、D2/D7 evidence 2026-07-18、D4 evidence 2026-10-21 | **已迁移；D1 待复跑** | D1 复跑取 summary；D2/D4/D7 建议 nightly 复跑确认 |
| D7 | 11 份 manifest 仍引用已退役 `planner.form_frame`/`form_micro_plan` 事件 | `au01-empty-message-guard`、`au01-frame-validation-friendly-error`、`au01-garbage-json-recovery`、`au01-ordinary-chat-two-turn-roundtrip`、`au02-candidate-fallback-ui`、`au02-natural-exploration-no-slot-form`、`au07-gate-reason-why`、`au07-tooltrace-registry-redacted-io`、`e2e-01-downgrade-real-page`、`e2e-01-readonly-tool-trace`、`e2e-01-replay-report`；live-provider 变体当前不可复跑 | **系统性质量文档债（未修）** | 下批 B 轨：逐份迁判断纪元断言或标 blocked；与 D3-D6 同批 |
| D8 | 遗留文案：`scenarios.yml` 8 个旧 title + `scenarios/README.md` 5 行旧描述 | Lead 已统一更新（核实 ✅）：判断纪元 title 8/8、README 5 行；描述性字段不参与机器断言 | **已修复** | 关闭 |
| D9 | 最近失败/无 summary 场景 | `au05-adoption-safety-freshness`（2026-10-21 失败无 summary）；`agentic-loop-tool-failure-replan`（2026-10-21 04:01 失败无 summary）；`p1-chapter-draft-generation`（D18，已修并真实复跑 PASS）；`judgment-explore-internal`（2026-07-20 仅失败截图，登记 `status: blocked`）；`agent-conversation-turn` 的 `-tauri` 非 lmstudio 目录 2026-07-20 端口冲突失败（lmstudio 目录有 summary） | **证据缺口** | 各自复跑后补 summary；judgment-explore-internal 待复跑后改 active |
| D10 | **质量门禁叙事层元词规则 vs 旧 driver 期望**（Lead 命名 D10） | 触发源：`prose_quality_validators.ex:57` `@meta_label_patterns` 于 2026-08-25（`5ea79995`）加入 `主角/反派/配角`；prose body 命中即产 quality finding，采纳 UI 切质量复核卡，而 2026-07-24 的旧 driver 直接点「保存为章节正文」→ 超时。本次实锤 `au14-finding-inventory-arc-loop`；夹具 `slice_verify.ex` `roster_presence_sentence` 1 行修复（「向主角确认了暗号」→「与来人对了暗号」）后 au14 复跑 PASS | **已修复（夹具 1 行）** | ✅ task-10；长期建议：全量 prose 采纳场景做「容忍质量复核分支」机械对照/统一语义（§7 Q15、acceptance-drift.md §6） |
| D11 | `vs10-observability-spine` 过期 | 最后 artifact 2026-07-01（帧纪元）；driver 仍以 `planner.form_frame.done` 等为 key events → 当前不可信 | **过期/需复跑** | 迁判断纪元 key events 后复跑；与 ADR-0018 噪声断言可同批 |
| D12 | `judgment-plan-multi-step` 有真实证据但未注册 quality 场景 | evidence `judgment-plan-multi-step-tauri/summary.json` 2026-07-19（judgment_plan_v1、4 步、3 产物）；仅 `tauri_slice_verify.sh` UA01 alias 白名单，`quality_accept.sh` 不可达 | **已修复（B13B-FOLLOWUP，2026-10-23）** | manifest + scenarios.yml + README 已登记；真实 Tauri PASS（`profile_ref=judgment_plan_v1`、≥3 步、≥2 act 能力、≥2 pending artifacts；证据 `artifacts/slice-verify/judgment-plan-multi-step-tauri/summary.json`） |
| D13 | 新登记 6 个 Tauri 场景的证据时效 | 登记 ✅（5 active + judgment-explore-internal blocked）；证据日期：judgment-explore-chapter-plan 2026-07-20、au13-arc 2026-07-22、au13-revise 2026-07-22、au10 2026-10-21、b17 2026-10-21 | **已登记；建议 current-HEAD 复跑** | 逐场景 `quality_accept.sh <id> --surface tauri` 复跑（nightly 排期） |
| D14 | ADR-0023 正文 CP 检查点历史注记未加 | ADR-0023 检查点段落仍写前判断纪元 `conversation_turn_v1` 检查点 | **已修复（B13B-FOLLOWUP，2026-10-23）** | 在「实现检查点」段前加「历史检查点注记（判断纪元前）」：明确 conversation 计划直通/修订路径已随 ADR-0025 退役，不得作为当前口径引用 |
| D15 | ADR README / ADR-0028 状态行 | README 首段 + §8.3 已修 ✅；ADR-0028 gaps 已按组 C 裁决改写 ✅ | **已修复** | 关闭 |
| D16 | 2 个 browser driver 未登记（HEAD 红） | `scripts/quality_manifest_check.sh` ignored + 注释已修 ✅；本汇总实跑 0 WARN | **已修复** | 关闭 |
| D17 | 6 个 Tauri 场景无 manifest（WARN） | 6 份 manifest + scenarios.yml + README 已登记 ✅；checker 0 WARN | **已修复** | 关闭 |
| D18 | **验收 verifier 判断纪元漂移：`p1-chapter-draft-generation` finder/behavior 未迁 base/agent 链与 judgment 事件**（B21 复跑发现） | HEAD 既有：finder 用 `draft_turn_id`（`:agent:N`）精确过滤，要求基 turn 的 `channel.user_message.start/done` 与 agent turn 的 `toolbox.execute.done` 同 turn；behavior 仍断言已退役 `planner.form_frame/form_micro_plan.done`。同文件 `p1-chapter-adoption-reading` finder 已在 `c4509c86` 拆链，draft-generation 漏迁 → 该 nightly 在 HEAD 即红。修复：`native-tauri-verifier.mjs` finder 拆基/agent 因果链（context 用 `contextAssembleTurnIdForDraftTurn/2` 解析）、behavior 迁 judgment 事件、self-test 新增 1 条锁定用例；真实 Tauri 二次复跑 2026-10-22 **PASS**（`turn_ids=[基 turn, :agent:5]`、`context_turn_id=:agent:3`、behavior 10 条含 `judgment_decided_before_prose_execution`）；前端 544/0。同族残留（verifier KEY_EVENTS 旧事件文本、`p1-prose-execution-brief` 的 lmstudio 旧期望、旧行为函数负向断言）未修，见下批 B 轨 | **已修复（verifier 层）** | ✅ B21 补充；同族残留转下批 B 轨（§4.2 追加） |
| D19 | **真实 provider 模式下验收 driver 假设缺口（B21 场景真跑实锤，2026-10-22 23:04 → 当日修复）** | 首次真跑（`--provider strata`，iq3_s）暴露：真实模型一次产出 3 个待采纳候选（prose + character_seed + world_rule_seed）并触发质量复核卡，driver 假设「单 pending artifact + 无质量复核分支/正文按钮恒为保存为章节正文」→ `.first()` 点中 character_seed、等待 prose target 超时（真实采纳本身成功，属 harness 假设而非产品回归）。**修复（2026-10-22，Lead，产品零改动）**：driver 按 `artifact_type=prose_fragment` 定位正文候选；采纳按钮按正文语义优先（质量复核时「保存原稿」→ 否则「保存为章节正文」→ 兜底通用 pattern）；采纳后只要求正文候选按钮消失。**真实 Strata `iq3_s` 复跑 PASS**（8 次真实请求、18,767/5,606 tokens、1700 字真模型正文；`planned_scene_titles=["对账","夜巡"]`、scene 行 `["场景 1"]`、假标题 `[]`）；确定性场景复跑零回归 PASS | **已修复（验收 harness 层）** | ✅ 证据 `artifacts/slice-verify/p1-chapter-adoption-reading-tauri-strata/summary.json`；真实 provider 验收仍属 nightly/live（依赖本机 Strata App），非 CI 确定性 |

| D21 | **`au04-confirmation-tool-failure-recovery` 判断纪元后场景漂移（B13B-DEFERRED-CLOSURE CP3 复跑发现，2026-10-23）** | HEAD 既有：driver 期待「高风险重写请求 → `needs_confirmation` turn_result → 确认后工具失败」，但判断纪元（ADR-0025）下该输入走判断 execute=prose_writing → 质量复核偏离 D4 → `awaiting_author`，全程无 confirmation TurnResult（首断言 200s 超时）。与 B13B 改动无因果：BB-4 只改 `fail_with_recovery`/run 失败的 status 映射，不涉及 `needs_confirmation` 产生路径；复跑 frames/app-log 无 fail_with_recovery 决策。 | **未修复（既有漂移）** | 不纳入本批证据；需产品/验收口径裁决：判断纪元如何确定性产 turn-time `requires_confirmation`，或 driver 改走 adoption overwrite 确认路径。转后续场景维护 |

### 6.1 判断纪元证据口径（组 A 的总体结论，适用于所有 ADR）

组 A 对 12 份 ADR 的 `enforced_by` 场景逐条核对后确认：全部已在 `scenarios.yml` 注册，但**除 au01/gap-wt04/au02-unadopted/agentic-loop/DS03 等外，其余 artifact 均早于判断纪元（2026-07-16）**，不能作为「当前 HEAD 真实页面已闭环」的证据；且 11 份 manifest 引用已退役事件（D7）。这是 B13b 对 ADR→真实页面链路的总体裁决：**「有历史验收 / 当前未复跑」是常态，不是个别缺口**。

---

## 7. 需要作者裁决的问题（去重后 15 条）

### 7.1 作者/产品决策

| # | 问题 | 影响 ADR/契约 | 决定选项 | Lead/审计建议 |
|---|---|---|---|---|
| Q1 | 主链对象语义收窄：primary frame、reply-only decision、`primary_next_action`、primary plan 唯一性 | ADR-0001#2 / 0002#3 / 0004#1/#2 / 0007 | A. 按 §11.4 新增 ADR 收窄（不新建 ViewModel/reply envelope/字段）；B. 全部按原 ADR 实现（成本高、无消费者） | 建议 A；先处理 0002#3 的 primary 语义（step frame 已事实化） |
| Q2 | VS-03 behavior lifecycle contract pack 是否冻结 | ADR-0006..0009；gap 8-1、9-2、8-2 | A. 本轮冻结 → 8-1/9-2 必做（slice 3）；B. 维持 draft → 降级为文档化偏差，只做 8-2 supersede | 建议 B 或部分冻结；draft 已 2026-05-07 未更新 |
| Q3 | 只读工具 output contract 是否值得建 | ADR-0012 规则 4 | A. 收窄为 creative/作者可见 artifact 必须校验（YAGNI）；B. 先冻结两个 output schema 再统一校验 | 建议 A |
| Q4 | ADR-0019: 复活/un-archive 是否仍是产品承诺？矩阵是否下沉 persistence？ | ADR-0019 | A. 承诺→开 `AU05b`/`Q1Cb`；B. 不承诺→降级 Deferred + 写触发条件 | 建议矩阵下沉开 `Q1Cb`；复活先降级 Deferred |
| Q5 | 采纳持久化失败是否升级为 failed TurnResult（改变错误路径响应形态） | ADR-0010 + VS-04 §5 规则5 | A. 下批 B 轨做（Lead Q6 已暂缓）；B. 永久降级，明确「error reply 即足够」 | 建议 A（VS-04 规则要求），需 UI 回归 |
| Q6 | ADR-0024 S4 显式澄清面是否还做 | ADR-0024 S4 / N-SURF | A. 降级（判断循环 await/explore 已承接）；B. 开 `DS04` 做选项化澄清 | 建议 A，保留触发条件 |
| Q7 | ADR-0025 CP6 外部探索翼：SearchProvider 选型、网络出站授权粒度、来源可信度 | ADR-0025 §3 | A. 保留 gap 等真实创作需求触发；B. 现在立项 | 建议 A；开工前必须拍板授权边界 |
| Q8 | ADR-0020 I10 人工盲评谁做/何时做/记录落点 | ADR-0020 I10 / VS-00E:248 | A. 发布前人工 gate + `walkthroughs/<date>/`；B. 日常 CI（不可行，AI 不可自证） | 建议 A 并明确负责人 |
| Q9 | ADR-0026 Experience Engine 收编 dismiss、LongRunTask 关联优先级 | ADR-0026 / 33 | A. 继续挂 gap 等 33 运行时/durable 定期化；B. 降级 Deferred | 建议 A（能力未存在，不应降级） |
| Q10 | ADR-0023 D6/no-deviation 场景语义：弃置 vs 改指；正文历史检查点注记 vs 新 ADR | ADR-0023 | A. no-deviation-direct 弃置 + ADR-0023 正文加历史注记；B. 改指 `judgment_plan_v1` 真计划直通（需新 driver 断言+复跑） | 建议 A（当前 verifier 已别名，语义名不副实） |
| Q11 | 工作台「当前卷」语义与数据源 | ADR-0028 §UI 影响 | A. 写作坐标 `volume_ref`（JSONL 已有）+ get_toc 回退；B. 仅 TOC 末卷；C. 规划/写作两态不同口径 | 建议 A，规划态可回退 TOC；需作者定「当前」定义（§4 slice 11） |
| Q12 | 卷蓝图作者编辑/作废入口去留 | ADR-0028 / VS-00J §1 | A. 维持非目标（从 gaps 删除，仅 enum 留位）；B. 立项新 slice（需 ADR 修订） | 建议 A |
| Q13 | 45 §4.2 完整新卷方向候选流/确认卡是否排期 | ADR-0028 / VS-00J §9① | A. 长期按形态 A（当前）；B. 排期做完整流（产品翻案） | 建议 A；若排期按 ADR 修订开独立 slice |
| Q14 | ADR-0015 命名：是否确认不新建 `TurnResultViewModel` 模块 | ADR-0015 / VS-05 | A. 降级（记录设计名→实现名映射，YAGNI）；B. 按字面新建（成本高、收益低） | 建议 A |
| Q15 | 6 个新登记 Tauri 场景的 nightly 分层 + judgment-explore-internal blocked 处置 + D10 长期语义 | quality/acceptance | A. 全部 nightly，judgment-explore-internal 先复跑再 active；其余 5 个保留 nightly 并做 current-HEAD 复跑；prose 采纳场景统一「容忍质量复核分支」语义（D10）；B. 部分降 release/known-gap | 建议 A；au13/au14 已 PASS 可作近例 |

### 7.2 Lead 执行决策（非作者业务裁决）

| # | 项 | 建议 |
|---|---|---|
| LQ1 | D2 au14 夹具修复（`slice_verify.ex:3996` 元词句）→ 复跑 | 采纳 task-10 建议 A：只改夹具 1 行（与 `e0a68dbd` 同类修法），不动质量门禁与 driver |
| LQ2 | D3/D6/D9/D11/D12 复跑与注册排期（agent-conversation-turn、D1、D2/D4/D7、au05、vs10、judgment-plan-multi-step） | 纳入下一轮 nightly；D1 必须补 summary |
| LQ3 | D7（11 份退役事件 manifest）+ D8（8 title/README 行，已由 Lead 修）迁移 | 一次质量文档批，不改产品代码 |
| LQ4 | D15 `judgment-plan-multi-step` 注册、BB-11 rail 断言、BB-9 schema、BB-10 噪声门禁 | 排入下批 B 轨小修（§4.2） |
| LQ5 | 8 条 A 组代码修复是否进下批 B 轨（已按 Lead 指令暂缓） | 确认排期；均低风险 additive（10-1 需 UI 回归） |
| LQ6 | 降级项「新增 ADR 收窄」是否本轮做（§7 Q1-Q2 相关） | 建议随作者裁决一次性新增 1-2 份收窄 ADR，不逐条开 |
| LQ7 | `mix run scripts/adr_trace.exs` / 全量门禁最终复跑、commit 拆分 | Lead 收尾（task-9） |

---

## 8. 诚实边界与未验证项

1. **本汇总未运行** `mix test`、`mix dialyzer`、`mix credo`、enum lint 脚本、任何 Tauri 场景；所有「已落地」以工作树文件 + apply-a/b 记录 + 既有 artifacts 核实。**唯一下游命令复跑**：`bash scripts/quality_manifest_check.sh` → `passed`/0 WARN（2026-10-22 02:5x）。
2. **landed 状态时点**：仓库在并发展开（Lead task-9、组 A/B 落地、task-10 复跑）。本文落入仓库前已核实：22 份 ADR 均有 B13b 裁决标记；`apply-a.md`/`apply-b.md` 存在且记录完整；6 场景 + 8 manifests 已迁。若后续 Lead 再改，以最终工作树为准。
3. **未落地清单**（§1.3）：A 组 8 项代码修复、B-16/B-18/B-25 注册/B-26 rail 断言、C-G1 正触发与 C-G3 当前卷 UI 未实现。**不得**把 §2 中「修复-本批」读成已修复——逐行看 `本批落地`。
4. **场景证据缺口**（§6 D9/D11/D12/D13）：`au05-adoption-safety-freshness`、`agentic-loop-tool-failure-replan`、`judgment-explore-internal` 无 PASS summary；`vs10` 过期；`judgment-plan-multi-step` 未注册；6 个新登记场景多数证据早于本批，需 current-HEAD 复跑。这些不能作为当前 HEAD 通过证据。注：au13/au14 已由 task-10 复跑 PASS（含 D10 夹具修复），不在此列。
5. **前判断纪元证据**（2026-07-16 前）：组 A 多数 ADR 场景 artifact 属历史证据（详见 part-a §3）；本台账已降权使用，不主张当前闭环。
6. **artifacts mtime caveat**：`artifacts/` gitignored，mtime 为本地时间，与 commit 时间可能数分钟交错；只用它证明「存在判断纪元口径 summary」，不证明「当前 HEAD 通过」。
7. **与 apply-a.md/apply-b.md 的差异**：本汇总写档时已读取两份记录并采纳其状态；差异点：apply-b.md 指出 5 个 scenarios.yml title + README 5 行未改（已由 Lead 修，本文 D8）、D1 需复跑（本文 D6/D9）、ADR-0023 正文注记未加（本文 D14）。除此以外无冲突。
8. **B13b 的裁决边界**：本台账是「对账裁决 + ADR 文本落地」，不是产品实现完成证明；`adr_trace` 绿只证明引用可追溯（脚本不解析 gaps）。

---

## 9. 决策日志

- **2026-10-22 — B13b 启动**：作者拍板主线顺序 B13a → B11③ → B11① 全部收口后，`MAINLINE-RESET-2` 选择 B13b（IR 缺口逐项对账）；同时先做工程基线清账 + B21（作者指令「短、立即消除用户可见错误 + 门禁全绿」，随后 B13b）。B13a（commit `221d13c3`）已为 B13b 提供输入：26 份 Accepted ADR 的 `enforced_by` + 20 份 ADR 的 47 条 `enforcement_gaps`。
- **2026-10-22 — B13b 三组审计**：组 A（ADR-0001..0012，26 条）、组 B（ADR-0015..0026，14 条）、组 C（ADR-0028，7 条 + 跨 ADR 验收漂移专项）并行只读审计；核心裁决口径：真实页面证据只认 quality 注册 + artifacts；早于判断纪元（2026-07-16）证据降权；不信 ADR 自述。
- **2026-10-22 — B13b 落地**：Lead 落基线清账（format/enum lint/credo/dialyzer/quality_manifest/6 场景登记/8 个 scenario title + README 5 行统一）；组 A/B 分别落 26/14 条 APPLY 到 ADR（`apply-a.md`/`apply-b.md`）；Lead 落 ADR-0028/README；task-10 修 R10 seed 并复跑（au13 PASS；au14 暴露 D10 质量门禁词表 vs 旧 driver 期望，夹具 1 行修复后 PASS）。
- **2026-10-22 — B13b 汇总（本文）**：47 条裁决全部落档；13 项「修复-本批」中 1 项已落地、3 项部分/待复跑、9 项未落地转下批 B 轨；16 条转独立 slice 收敛为 11 个候选 slice + 12 项下批 B 轨小修；18 项降级/弃置/伪缺口文本已落；15 条作者裁决 + 7 条 Lead 决策待处理。
- **与 B13a 的关系**：B13a=「门禁地基」（`enforced_by` 清单 + `adr_trace` 硬门禁），B13b=「缺口对账与裁决」。B13b 完成后，B13 的「追溯 + 对账」两阶段即完成；缺口实现/验收由具体 slice/B 轨承载。

---

- **2026-10-23 B13B-FOLLOWUP 落地**：§4.2 的 13 个候选动作中 10 项完成（BB-1/2/3/5/6/8/9/11/12 + D14），3 项需作者拍板诚实延后（BB-4 failed_recoverable 语义边界 / BB-7 Q5 持久化失败 TurnResult / BB-10 日志噪声口径）；BB-11/BB-12 补齐两个验收注册债并真实 Tauri PASS（au13 rail 待处置计数、judgment-plan-multi-step）；NEXT 枚举漏列 BB-11 的口径不一致已按 §4.2 修正。详见 §11。

- **2026-10-23 B13B 延后 3 项作者拍板（只定方案，下一轮执行）**：BB-4 采用方案 A 全量统一 `failed_recoverable`（纯线格式语义，不新增 recovery action/UI 恢复卡；phase 仍 failed、run/action_result status 不变）；BB-7 与 BB-4 同批闭合（persist failure 产 failed action_result + failed_recoverable TurnResult，闭 VS-04 规则 5）；BB-10 采用方案 A 口径修订+全闭环（ADR §6 改 45/60 + 统计口径、ADR §4/LogEmit 补 level、静态脚本+CI、verifier 断言；依据 300 turn 实测）。执行计划见 §11.3；入口 `tasks/NEXT.md` `B13B-DEFERRED-CLOSURE`。

## 10. 后续承接：B13 整体关闭建议

**建议：满足下列 4 个条件后，B13 可整体关闭；否则保留 B13 但缩窄为「ADR 缺口台账维护」。**

| # | 关闭条件 | 当前状态 | 责任 |
|---|---|---|---|
| C1 | 47 条 gap 全部有裁决且落档 | ✅ 本文件 + 22 份 ADR 文本 | done |
| C2 | 47/47 ADR APPLY 落地且 `adr_trace` 绿 | ✅ apply-a/b 记录；27/27（255 refs） | done |
| C3 | 转出项（16 条 → 11 slice + 12 B 轨小修）有明确归属/排期 | ◐ 本文件 §4 已列；待 Lead 登记 `tasks/NEXT.md`/B 轨 | Lead |
| C4 | 作者裁决 15 条有处理结论（至少 Q1-Q15 有归属） | ◐ §7 已列建议；待作者拍板 | 作者 |

**若 C3/C4 在本轮收口前无法全部落地**（更可能的现实）：B13 保留但**缩窄为「ADR 缺口台账维护」**——输入从 47 条 gap 降为 §4 的转出清单；每完成一个 slice/B 轨批次，回来更新本文件 §4/§6 的状态。**不建议**继续以「B13 未关闭」为由推迟具体产品 slice。

**建议的下一批队列**（按价值/风险）：
1. **场景复跑补齐证据**：D10 夹具修复已使 au13/au14 恢复真实 PASS；下一步复跑 D3/D4/D5、D6 的 D1 场景、D9 的 au05/D1 场景、D11 vs10、D12 judgment-plan-multi-step 注册，并做「prose 采纳场景容忍质量复核分支」的全量机械对照（D10 长期建议）。
2. **R10/R11 正触发场景**（§4 slice 10）——把 B11A CP5 的负债规则从未验收变验收。
3. **工作台「当前卷」UI**（§4 slice 11）——ADR-0028 §UI 承诺 + 用户可见假坐标。
4. **下批 B 轨小修 12 项**（§4.2，多为低风险 additive；10-1 需 UI 回归）。
5. **11 份退役事件 manifest 迁移 + vs10 复跑**（质量文档债，一批清）。
6. 作者裁决落地：按 §7 逐条拍板；新增 1-2 份「收窄 ADR」承载 Q1/Q2 结论。

---

## 11. B13B-FOLLOWUP 落地记录（2026-10-23）

> 承接 §4.2 下批 B 轨小修批次。口径修正：§4.2 实际 13 个候选动作（NEXT 行枚举漏了 BB-11）；本批 **10 项完成、3 项已由作者拍板（2026-10-23）并转入下一轮执行**（见 §11.3）。

### 11.1 已落地（代码/文档 + 测试）

| # | 落地内容 | 测试/证据 |
|---|---|---|
| BB-1 | `MicroPlan.check_forbidden` 扫描面纳入 `required_capabilities` / `fallback_strategy`（ADR-0002 #3） | `micro_plan_test.exs` +4（两字段命中拦截、默认 fallback/空能力不误报） |
| BB-2 | `OrchestratorDecision.decision_trace_ref` 闭合：主 prose / 修订 / 已采纳修订路径在 trace 记录后回填 trace id；TurnResultBuilder 映射该字段（ADR-0004 #3） | `vs00e_cp3` 断言 `turn_result.orchestrator_decision.decision_trace_ref == turn_result.trace_summary.trace_ref` |
| BB-3 | TurnPhase `dialogue`：无 behavior、无工具调用的回复轮 phase = dialogue（ADR-0006 #1） | 3 处 reply-path 断言更新 + web channel 测试 |
| BB-5 | behavior `available_actions` 4 动作补 `trace_ref = decision_trace:<turn_id>`（ADR-0007 #3） | `behavior_lifecycle_test` / `execution_authority_test` 断言 |
| BB-6 | `ConfirmationBinding.build` 必填 `idempotency_key` + `trace_ref`（ADR-0009 #1） | domain fixtures 更新 + 2 负向用例；gateway 恒提供两字段 |
| BB-8 | capability registry 新增 `deprecated_tool` fixture（status :deprecated；不可分发、Toolbox `tool_not_dispatchable`）（ADR-0011 #1） | `tool_provenance_test.exs` +3；不写验收场景（无产品路径） |
| BB-9 | `turn_result_v3.json` projection_refs items 增 `projection_hint_id` / `reason` / `source_state_trace_ref` + `pnpm codegen:schemas`（ADR-0016） | 前端 `schemas.test.ts` +1（运行时 3 字段接受）；codegen 产物入档（含既有 memory_status/volume_blueprint_status 漂移同步） |
| D14 | ADR-0023 加「历史检查点注记（判断纪元前）」 | doc only |
| BB-11 | au13 driver/verifier/manifest 增档案 rail 待处置计数断言（ADR-0026-g1） | 真实 Tauri `au13-review-adjudication-roundtrip` PASS：报告生成后关闭档案 rail 显示「审读待处置 5」（= finding_count），全部处置后 chip 消失；证据 `artifacts/slice-verify/au13-review-adjudication-roundtrip-tauri/summary.json` |
| BB-12 | `judgment-plan-multi-step` 质量场景注册（manifest + `scenarios.yml` + README + tauri seed/list/echo） | 真实 Tauri PASS：`profile_ref=judgment_plan_v1`、模型自产 ≥3 步、≥2 act 能力、run completed + ≥2 pending artifacts；证据 `artifacts/slice-verify/judgment-plan-multi-step-tauri/summary.json` |

### 11.2 关键实现说明（不改变产品语义的边界）

- BB-3 只改「无 behavior/无 tool 的回复轮」phase；工具轮仍 completed、失败仍 failed——schema `phase` 为 string（无 enum），前端生产无 phase 消费。
- BB-2 的 `decision_trace_ref` 是线格式 additive 字段（`orchestrator_decision` 原形状 + 新键）；修订路径此前完全无 `orchestrator_decision`，本次补齐 map 形状与 trace 引用，不改变采纳/写入语义。
- BB-6 收紧后，历史持久化 action 若缺 `idempotency_key`/`trace_ref` 会在 confirm 时显式报错（不再静默）；服务端下发的 available_actions 恒带两字段。
- BB-11 的 rail chip 只在档案面板**关闭（收纳态）**渲染；driver 按真实用户路径 reload → join → 关闭档案后断言（外部自动化，无产品 hook）。

### 11.3 已拍板待执行（作者裁决 2026-10-23：三项全部按推荐方案执行，下一轮落地）

> 决策证据：`tasks/NEXT.md` §6 Decision Log 与 `docs/project-ledger.md`。执行入口：`tasks/NEXT.md` 队首任务 `B13B-DEFERRED-CLOSURE`。**本批只拍板、不写代码**（作者指令「只定方案，下一轮再执行」）。

| # | 项 | 拍板结论 | 下一轮执行范围（checkpoint 摘要） |
|---|---|---|---|
| BB-4 | TurnStatus `failed_recoverable`（ADR-0006 #2） | **方案 A：全量统一**——所有 `fail_with_recovery` 决策 + 所有 run 失败兜底 TurnResult → `status="failed_recoverable"`（`phase` 仍 `failed`、run 级 status 仍 `failed`、action_result.status 仍 `failed`）；**不新增 recovery action/UI 恢复卡**（沿用 B13b 7-1 降级：恢复面=DS03 控制坞；07 恢复卡为独立 UI 债） | CP1：`turn_result_builder.build_status`/`agent_run_server.safe_failure_turn_result`/`adoption_workflow.decision_status(:fail_with_recovery)` 三生产者统一 + builder/runtime 单测；CP3：driver 断言更新（q3d-candidate-semantics / q3d-author-registration-guards / au04-confirmation-tool-failure-recovery）+ 真实 Tauri 复跑 3-5 场景 |
| BB-7 | 采纳持久化失败 TurnResult（ADR-0010 #1 / VS-04 规则 5） | **方案 A：与 BB-4 同批闭合**——persist writer error → 失败 `action_result`（`status="failed"`、`persistence.persisted=false`、`reason_code=adoption_persistence_failed`）+ `failed_recoverable` TurnResult（`phase="failed"`、说明「采纳未保存、原候选保留、可重试」）→ 返回 `{:ok,...}` 走既有广播；结构性/无效 action 仍 `{:error}`（保持现有边界） | CP2：`adoption_workflow` persist error 分支 + 注入 `adoption_writer = fn _ -> {:error, :boom} end` 单测 + Channel/workflow 回归；无真实页面注入路径（ADR 允许单测/Channel 证据）；前端零改动（广播已有） |
| BB-10 | 日志噪声门禁（ADR-0018 §6/§4） | **方案 A：口径修订 + 机器化全闭环**——ADR §6 改「正常路径 ≤45 行/失败恢复路径 ≤60 行」+ 明确统计口径（base turn 聚合父+agent step；排除 UI 读取 `channel.get_*`、join/work_session/slice_verify 与伪 turn）；ADR §4 补 `level` 字段；`LogEmit` additive 补 `level`（start/done→info、error→error）；新增 `scripts/check_log_noise.sh`（生产 lib `Logger.warning` allowlist=17 处 provider 适配器，新增需豁免）+ CI；verifier 加通用断言（正常路径 0 error 级 + 行数预算），2-3 个已绿场景落 manifest data 断言并复跑 | CP4：LogEmit level + 单测；ADR-0018 §4/§6 文本修订；`scripts/check_log_noise.sh` + `.github/workflows/ci.yml` + scripts/README 注册（注意并行会话在途修改，需串行）；verifier 通用 per-base-turn 计数 + 正常路径 0 error 断言；2-3 个已绿 Tauri 场景复跑取证据 |

**统计口径的数据依据（BB-10 阈值）**：扫 300 个真实 Tauri turn 的 app-log（排除 UI 读取/生命周期），业务事件/base turn = p50 7、p90 21、p95 28、p99 37；正常路径 max 42、失败恢复路径 max 56；现有 17 处 `Logger.warning` 全在 provider 适配器 unknown-error 分支。故 45/60 可在不误伤已绿复杂流（p1 导出 38、judgment-plan-multi-step 42、b17 失败路径 56）的前提下拦住「明显翻倍」回归。

**其它诚实边界**：BB-2/BB-5/BB-6/BB-9 触碰 TurnResult 线格式/确认绑定，已跑 I1/I2/I3/N-NARR/I-CACHE-1 与后端全量；`failed_recoverable` 未落地意味着「run failure 的 recoverable 语义」仍与 ADR 文本存在已知差距（已在 ADR-0006 enforcement_gaps 保留）。

### 11.4 B13B-DEFERRED-CLOSURE 执行记录（2026-10-23，作者拍板方案 A/方案 A/方案 A）

> 执行入口 `tasks/NEXT.md` `B13B-DEFERRED-CLOSURE`。本批落地 BB-4 / BB-7 / BB-10，并顺带修复 au05 两场景的既有验收夹具漂移（Q3D `kind` 契约落地后旧 seed 未迁移）。

#### BB-4 `failed_recoverable` 全量统一（方案 A）

| 生产者 | 文件 | 变更 |
|---|---|---|
| TurnResultBuilder | `turn_result_builder.ex` | `build_phase/3` 对 `%OrchestratorDecision{decision_type: :fail_with_recovery}` → `phase="failed"`；`build_status/3` → `status="failed_recoverable"`。工具失败但决策放行仍是 `failed`（工具失败 ≠ fail_with_recovery） |
| AgentRunServer | `agent_run_server.ex` `safe_failure_turn_result/2` | 所有 run 失败兜底 TurnResult `status → failed_recoverable`；`phase` 仍 `failed`、run 级 status 仍 `:failed` |
| AdoptionWorkflow | `adoption_workflow.ex` `decision_status/1` | `:fail_with_recovery` → `failed_recoverable`；`phase` 仍 `failed`、`action_result.status` 仍 `failed` |
| DialogueGateway | `dialogue_gateway.ex` `candidate_status/1` | 同上（候选方向 fail_with_recovery）；`candidate_action_status` 仍 `failed` |

测试与断言：新增 `turn_result_builder_test.exs`（3 例）；更新 `action_roundtrip_test` / `agent_run_runtime_test` / `turn_interaction_service_test` / `workspace_channel_v3_test`；外部驱动与 verifier 同步（`q3d-candidate-semantics` live+restored、`q3d-author-registration-guards` failed_turns/restored、`au05-conflict-cross-work-recovery` / `au05-canon-conflict-recovery` 的 turn_result；action_result 仍 `failed`）。`au04-confirmation-tool-failure-recovery` 的确认后工具失败 TurnResult 仍 `failed`，断言不变（该用例是 tool failure，不是 fail_with_recovery 决策）。

#### BB-7 采纳持久化失败 TurnResult（方案 A，与 BB-4 同批）

- `AdoptionWorkflow.finalize_adoption/7` persist error 分支：失败 action_result（`status="failed"`、`persistence.persisted=false`、`persistence.reason_code="adoption_persistence_failed"`）+ `failed_recoverable` TurnResult（`phase="failed"`；作者文案「采纳未保存：作品档案写入失败，原候选仍保留为待采纳，作品事实没有被修改」；trace `decision_type=adopt_persistence_failed`）→ `{:ok, action_result, turn_result}` 走既有 Channel `action_result`/`turn_result` 广播；原始持久化异常只进 developer `LogEmit`（author-safe）。
- 单测 `adoption_workflow_test.exs`：注入 `fn _ -> {:error, :disk_full} end`，断言失败回执 + failed_recoverable TurnResult + 作者可见载荷不含原始错误文本；Channel 既有 `{:ok, action_result, turn_result}` 广播路径回归（`workspace_channel_v3_test` 全绿）。VS-04 规则 5 闭合（ADR-0010 enforcement_gaps 有落地注记）。
- **诚实边界**：同 key 重复点击仍受既有 action receipt 幂等约束（回放失败回执、不产生第二次写入尝试）；恢复路径 = 重新发起采纳/Run，不在本批改幂等语义。ADR 允许单测/Channel 证据，无真实页面注入路径。

#### BB-10 日志噪声门禁（方案 A，口径修订 + 全闭环）

- ADR-0018 §4：JSONL 行新增必填 `level`（start/done→`info`、error 相→`error`，caller 不可覆盖）；§6：预算改「正常路径 ≤45 行 / 失败恢复路径 ≤60 行」并冻结 base turn 聚合口径（父 turn + `<turn>:agent:N`；排除 `channel.get_*`/join/work_session/slice_verify/伪 turn）。
- `LogEmit` additive `level`；单测 `apps/novel_common/test/novel_common/log_emit_test.exs`（level 映射 + turn 关联键 + 保留字段不可覆盖）。
- 静态门禁：`scripts/check_log_noise.sh`（生产 lib `Logger.warning` allowlist 17 处 = provider 适配器 unknown-error 分支；实测 17/17；新增 exit 1）；CI `backend` job 与 `scripts/README.md` 已登记。
- 运行时通用断言：verifier `evaluateAppLogNoise`（base turn 聚合/排除 UI 读取/正常路径 0 error 级/45–60 行预算/失败恢复路径允许 error；未归属 turn 的 error 记录使整场景按失败恢复路径兜底）；`tauri_slice_verify.sh` 写 `summary.json.log_noise` + `log-noise.json`，违规 exit 1；verifier 单测 +6（合计 240）。
- 场景 manifest data 断言：`p1-chapter-adoption-reading`、`judgment-explore-chapter-plan`（正常路径）、`q3d-author-registration-guards`（失败恢复路径）。
- **诚实边界**：`agent_run.run_failed` 的 app-log 记录仍缺 `turn_id`（既有可观测性缺口，不属本批；噪声门禁用整场景失败恢复路径兜底规避误判），登记为后续可观测性债。

#### 真实 Tauri 复跑（隔离库 `NOVEL_TEST_DB_DIR=/tmp/b13b-verify-db` + `MIX_TEST_PARTITION=_b13b`，端口 14661/15773；证据 `artifacts/slice-verify/<scenario>-tauri/summary.json`）

| 场景 | 结果 | 噪声证据（summary.log_noise） |
|---|---|---|
| `q3d-author-registration-guards` | ✅ PASS | 4 base turns（纠正+3 失败）12–17 行、0 error（失败路径兜底 ≤60） |
| `q3d-candidate-semantics` | ✅ PASS | 见 summary（失败路径兜底） |
| `au05-conflict-cross-work-recovery` | ✅ PASS | 失败恢复路径 4 行含 1 error、≤60 |
| `au05-canon-conflict-recovery` | ✅ PASS | 失败恢复路径 4 行含 1 error、≤60 |
| `p1-chapter-adoption-reading` | ✅ PASS | 正常路径 38 行、0 error（与 300-turn baseline 的 p1 38 一致） |
| `judgment-explore-chapter-plan` | ✅ PASS | 正常路径 14 行、0 error |
| `au04-confirmation-tool-failure-recovery` | ❌ 未通过（**既有场景漂移 D21**，非本批引入） | — |

#### 既有验收夹具漂移修复（顺带，产品零改动）

- `scripts/seed_au05_conflict_cross_work_recovery.exs` / `scripts/seed_au05_canon_conflict_recovery.exs`：候选方向补 `kind: "creative_direction"`。根因 = Q3D 候选用途契约（无 `kind` 不授予采纳动作）落地后旧 seed 未迁移，两场景首跑即因按钮不出现超时；修复后真实 Tauri PASS。不新增产品验收感知逻辑。

#### 门禁

- 后端：`mix test` **1,849 tests / 0 failures**（7 个 app 分档）；`mix compile --warnings-as-errors` ✓；`mix format --check-formatted` ✓；`mix run scripts/lint_enum_literals.exs` clean；`mix credo --strict` 0 issue；`mix dialyzer` 0 errors；`mix xref graph --format cycles --label compile-connected --fail-above 0` 无环；`mix run scripts/arch_check.exs` 通过；`mix run scripts/adr_trace.exs` **27/27（262 refs, 0 pending）**。
- 不变量：I3 3/3 + Layer-A 3/3、I1 4/4、I2 3 pairs disjoint、N-NARR PASS、I-CACHE-1 全行 `enforced=true`。
- 前端：`pnpm typecheck` ✓、`pnpm lint` ✓、`pnpm test` **573 tests / 36 files 0 failures**（含 verifier 240）；`bash scripts/frontend_audit.sh` 27 PASS / 0 WARN / 0 FAIL；`bash scripts/check_design_trace.sh` 16 PASS / 0 WARN / 0 FAIL。
- 质量体系：`bash scripts/quality_manifest_check.sh` passed；`bash scripts/check_log_noise.sh` passed（17/17）。
- 静态扫描：`bash scripts/ai_static_scan.sh --top 10` → 收尾 task_done manifest 生成后复跑，0 blocking（两条既有 gitleaks disposition 保留，见 `artifacts/static-scan/`）。

## 附 A：22 份 ADR / 47 条 gap 落点速查

| ADR 文件 | gap 数 | APPLY 落地记录 | ADR 文本状态 | 备注 |
|---|---:|---|---|---|
| ADR-0001-dialogue-frame-v3 | 2 | apply-a.md | ✅ | 弃置+独立 slice |
| ADR-0002-micro-plan-v3 | 3 | apply-a.md | ✅ | 弃置+伪缺口+下批 B 轨 |
| ADR-0003-planner-authority-boundary | 3 | apply-a.md | ✅ | 独立 slice ×3 |
| ADR-0004-orchestrator-decision-v3 | 3 | apply-a.md | ✅ | 降级×2+下批 B 轨 |
| ADR-0005-execution-gate-order-v3 | 3 | apply-a.md | ✅ | 独立 slice ×3 |
| ADR-0006-turn-phase-status-v3 | 2 | apply-a.md | ✅ | 下批 B 轨 ×2 |
| ADR-0007-next-action-available-action-v3 | 3 | apply-a.md | ✅ | 降级×2+下批 B 轨 |
| ADR-0008-behavior-state-v3 | 2 | apply-a.md | ✅ | 独立 slice ×2 |
| ADR-0009-confirmation-binding-v3 | 2 | apply-a.md | ✅ | 下批 B 轨+降级 |
| ADR-0010-state-adoption-boundary-v3 | 1 | apply-a.md | ✅ | 下批 B 轨（Lead Q6） |
| ADR-0011-toolbox-registry-v3 | 1 | apply-a.md | ✅ | 下批 B 轨 |
| ADR-0012-tool-request-result-v3 | 1 | apply-a.md | ✅ | 降级 |
| ADR-0015-turn-result-view-model-v3 | 1 | apply-b.md | ✅ | 降级 |
| ADR-0016-projection-hint-ui-v3 | 1 | apply-b.md | ✅ | 本批未落地（schema） |
| ADR-0018-business-log-schema-v3 | 1 | apply-b.md | ✅ | 本批未落地（噪声门禁） |
| ADR-0019-adoption-status-transition-v3 | 2 | apply-b.md | ✅ | 独立 slice ×2 |
| ADR-0020-prose-quality-...boundary-v3 | 1 | apply-b.md | ✅ | 独立 slice（盲评） |
| ADR-0023-agentic-loop-plan-driven-execution-v3 | 1 | apply-b.md | ✅ | manifests 8/8 已迁；正文注记待补 |
| ADR-0024-decision-surface-registry-v3 | 3 | apply-b.md | ✅ | 降级+伪缺口+弃置 |
| ADR-0025-judgment-driven-interactive-loop-v3 | 2 | apply-b.md | ✅ | 独立 slice+本批（注册未全落） |
| ADR-0026-five-ledgers-three-state-reconciliation-v3 | 2 | apply-b.md | ✅ | 伪缺口+独立 slice |
| ADR-0028-volume-structure-and-open-volume-action-v3 | 7 | Lead（组 C 裁决） | ✅ | 2 降级/1 删除/1 独立 slice/1 本批/1 正触发/1 清账关闭 |

## 附 B：三份审计产物导航（/tmp 产物，非持久）

- `/tmp/b13b/part-a.md`：组 A 26 条完整证据表、§6 APPLY 26 块、§5 作者问题 Q1-Q6。
- `/tmp/b13b/part-b.md`：组 B 14 条完整证据表、§2.1 manifest 漂移专项、§3 APPLY 14 块、§4 Top5。
- `/tmp/b13b/part-c.md`：组 C 7 条+跨 ADR 验收漂移专项、APPLY 7 块、Top5、验收漂移清单 D1-D9。
- `/tmp/b13b/apply-a.md`、`apply-b.md`：A/B 组 APPLY 实际落地记录（26/26、14/14 + 5 manifests）。
- `/tmp/b13b/acceptance-drift.md`：R10 场景漂移修复记录（au13/au14 均 PASS；含 D10 质量门禁叙事层元词 vs 旧 driver 期望的根因与修复）。

> 上述 /tmp 产物是审计过程材料；**持久真源以本文件 + 22 份 ADR 当前文本 + quality/acceptance 场景文件为准**。
