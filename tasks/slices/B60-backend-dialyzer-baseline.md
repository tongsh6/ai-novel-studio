# B60：后端 Dialyzer 基线清零（门禁债）

- 状态：**done（2026-10-27，CP0–CP3；39 → 0 warnings，无 nowarn/ignore；1 条经 Lead 裁决的真实缺陷顺带修复 + 回归测试）**。`mix dialyzer` 0 warnings，后端全门禁绿；残余 R2/R4 已登记（不改语义）。
- 登记日期：2026-10-27；发现来源：B41–B49 收口全门禁复跑 `mix dialyzer`（HEAD `dc6cda1e`）失败：`done (warnings were emitted)`，**Total errors: 39, Skipped: 0**。
- 归因：本会话未修改任何 `apps/*/lib` 生产代码（仅 `apps/novel_agent/test/support/provider/slice_verify.ex` 验收替身），warning 文件均非本会话改动；按代码来源归因为 **B28/B36 等前序批次**（如 `adoption_repository.ex` 的 `replacement_pieces/2` guard 告警由 B36 CP2 `be189f0c` 引入区段）在 OTP 28/Elixir 1.19 下未复跑 dialyzer 的既有门禁债。**不是 B40/B42/B41 引入**。
- 上游：`.github/workflows/ci.yml` backend job `Dialyzer` step；AGENTS 完成后门禁；[B41](B41-quality-evidence-foundation.md) 的证据地基。
- 执行：b60-dialyzer（2026-10-27，HEAD `8cbced2f` 基线 → 同 HEAD 工作区清零）。

## 1. 问题

CI backend job 含 `mix dialyzer`，项目无 `ignore_warnings` 配置；当前 HEAD 运行 exit 2（39 warnings），即 CI 该 step 会红，但其余 AGENTS 必需后端门禁（compile -Werror / format / test / credo / xref / arch）均为绿。若不清理，后续「全门禁绿」声明无法包含 dialyzer。

## 2.0 同批发现并已修复：umbrella 根 `mix test` 空测试面（2026-10-27）

- 现象：umbrella 根 `mix test` 以 exit 2 结束（各 app 自身 0 failures），根因是 `apps/novel_test` 与 `apps/novel_e2e` 没有任何 `.exs` 测试文件；Elixir 1.19 下空测试面使该 app 的 test task 非 0，进而拖红根任务。`novel_e2e` 旧 e2e 测试文件已在 `2c3c3b5a`（2026-07-19 帧纪元退役）移除。
- 修复（本轮，最小测试面）：新增 `apps/novel_test/test/novel_test_app_smoke_test.exs` 与 `apps/novel_e2e/test/novel_e2e_app_smoke_test.exs`，只断言对应 app 可编译加载，不引入行为断言/旁路验收；根 `mix test` 恢复 exit 0（7 个 app 全绿 + 2 个 smoke）。
- 与 dialyzer 债务独立：本项已关闭，不属 B60 剩余范围。

## 2. CP0 证据（基线）

- 命令：`mix dialyzer`（HEAD `8cbced2f`，本地 Elixir 1.19.5 / OTP 28）；输出 `Total errors: 39, Skipped: 0, Unnecessary Skips: 0`，`done (warnings were emitted)`，exit 2；原始日志 `/tmp/b60-dialyzer-before.log`（不入 git）。
- warning 类型分布：`call` 5 / `guard_fail` 6 / `no_return` 3 / `pattern_match` 11 / `pattern_match_cov` 13 / `exact_compare` 1（dialyxir 1.4.7 未识别 OTP 28 的 `:exact_compare`，回退为 legacy 文本）。
- 文件分布：novel_agent 3、novel_application 30、novel_domain 1、novel_persistence 3、novel_web 0、novel_foundation 0。
- 重点告警族（与初判一致，逐条清单见 §6）：
  - `adoption_repository.ex` / `authoring_task_builder.ex` / `chapter_mission_inputs.ex` / `pending_artifact_workflow.ex` / `turn_execution_service.ex`：`|| ""` 型恒真 guard（`text/1`、`String.length` 等已保证 binary，`false`/`nil` 分支不可达）。
  - `pending_artifact_workflow.ex`：`artifact_type: :chapter_structure_change_plan` / `:character_profile_revision` 不在 `NovelDomain.TentativeArtifactSet.@type artifact_type`（typespec 过窄）→ `TurnResultBuilder.build/8` 调用失败级联出 `no_return`。
  - `novel_application.ex`：`ChapterSummaryMaintenance.run/3` 契约 `input()` 缺 `:material_scope`（实际调用方都传），契约不满足 → 匿名函数 no_return。
  - `gateway.ex`：`AdapterExecution.execute/6`、`materialize_result/2` 的 `context()` 契约比动态 opts 调用方实际可证明类型窄。
  - 其余为 dialyzer 证明不可达的防御性 clause/兜底（逐条 §6）。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 逐条把 39 warning 分类：真实缺陷 / 类型过窄（typespec/guard 修正）/ 需要显式 ignore + 理由，形成清单 | **完成**（§6，39/39 全部归类；`nowarn` 0 条） |
| CP1 | 按分类修复：优先真实缺陷与死分支；typespec/guard 修正保持行为不变；每类附复跑证据；禁止全局 ignore_warnings | **完成**（§6/§7；17 个 lib 文件 + 1 个回归测试；含 1 条经作者裁决的真实缺陷修复 #30） |
| CP2 | `mix dialyzer` 0 warnings；`mix compile --warnings-as-errors` / `mix format --check-formatted` / `mix credo --strict` / `mix test` 全绿；xref/arch/scenario invariants 复跑 | **完成**（§7，证据命令全部 exit 0） |
| CP3 | 收口记录：warning 基线清零证据、任何保留 ignore 的逐条理由、与 B28/B36 等任务文档的交叉引用 | **完成**（§8；R1 已按作者裁决选项 A 修复并复跑，残余 R2/R4 已登记） |

## 4. 非目标

- 不借此改动产品行为/协议；不批量加 `@dialyzer {:nowarn_function, ...}` 掩盖可修问题；不改 provider/持久化语义。
- 不重跑 B27 语义矩阵或真实模型批次（与本门禁债无关）。
- 本轮**未新增任何 `@dialyzer` nowarn、未配置 `ignore_warnings`**；0 条豁免。

## 5. 验证与恢复

- 复跑：`mix dialyzer`（期望 `Total errors: 0` + `done (passed successfully)`，exit 0）。
- 回归：`mix compile --warnings-as-errors`、`mix test`、`mix credo --strict`、`mix format --check-formatted`；主链改动另跑 `mix xref graph --format cycles --label compile-connected --fail-above 0`、`mix run scripts/arch_check.exs` 与三个 scenario invariants driver。
- 恢复：先读 §6 的 39 条分类与修复清单；若未来出现新的 dialyzer warning，优先按 §6 的族根因（typespec 过窄 / 恒真守卫 / 不可达兜底）判断，不要用全局 ignore 掩盖。基线可随时用 `git show 8cbced2f` 对照本文档逐条复现。

## 6. CP1：39 warning 逐条分类与修复清单

分类口径：

- **b = 类型标注/契约过窄或恒真守卫修正**：改 `@spec`/类型/守卫（或删除被类型证明恒真的比较），**可达路径行为逐字节不变**。
- **a = 死分支/真实缺陷清理**：删除 dialyzer 证明不可达的 clause/兜底；**可达路径行为逐字节不变**，不可达输入的差异登记于 §8.2。
- **c = 显式 ignore**：本轮 **0 条**。

| # | 位置（HEAD `8cbced2f` 行号） | 类型 | 类 | 根因与处置 |
|---|---|---|---|---|
| 1 | `lib/novel_agent/provider/gateway.ex:459:48` | call | b | `AdapterExecution.materialize_result/2` 的 ctx 契约 `context()` 比实现实际接受域窄（实现只用 Map.get 读可选键；Gateway 动态 opts 只能推出 `map()`）。契约改为 `context() \\| map()`，运行时不变。 |
| 2 | `lib/novel_agent/provider/gateway.ex:467:70` | call | b | 同上但触发在 `execute/6`：其调用的 `initial_events/1`、`emit_events/4`、`cancelled?/1`、`materialize_cancelled/2` 逐个声明了 `context()`（含值类型），使 `execute/6` 的成功类型要求 ctx 值满足具体类型，而 Gateway 的 `Keyword.get` 值只能是 `any()`。把 execute 链上这 4 个 helper 与 `execute/6` 的 ctx 参数放宽为 `map()`（实现本就只做 `Map.get`/模式匹配可选键），其它 adapter 公共 helper 仍保留 `context()`。 |
| 3 | `lib/novel_agent/tools/world_building_adapter.ex:36:8` | pattern_match_cov | a | `artifact_type_from_task/1` 只由 `%AuthoringTask{} = task` 分支调用，`_task -> nil` 不可达；删除兜底（output_contract 恒 map，同时去掉冗余 `is_map` guard）。 |
| 4 | `lib/novel_application.ex:385:18` | no_return | b | `ChapterSummaryMaintenance.run/3` 契约 `input()` 缺调用方实际传入的 `optional(:material_scope)`（`:chapter`/`:fragment`），契约不成立 → 匿名函数 no_return。`input()` 增补该可选键。 |
| 5 | `lib/novel_application.ex:401:63` | call | b | 同 #4 的级联；补 `input()` 后消失。 |
| 6 | `lib/novel_application/adoption_workflow.ex:593:18` | pattern_match | a | `AdoptionRepository.accepted_chapter_scopes/2` 的错误面只有 `:error`（Ecto.UUID.cast 失败）与 `{:error, :target_ambiguous \\| :target_missing}`；`:not_found` 分支无生产者，删除（`:error` 分支保留原 `:target_missing` 映射）。 |
| 7 | `lib/novel_application/adoption_workflow.ex:1125:8` | pattern_match_cov | a | `put_b28_result_fields/2` 的 `persisted` 只来自 adoption writer 的 `{:ok, map}`；非 map 兜底不可达，删除。 |
| 8 | `lib/novel_application/agent_run_flows/prose_drafting_with_quality.ex:951:26` | exact_compare | b | `pick_mission_chapter/2` 的 `is_binary(ref) and ref != ""`：`ref` 来自 `resolve_target_chapter_identity/6`，恒为 nil 或非空 `"chapter:<uuid>"`，`ref != ""` 恒真（OTP 28 新 `:exact_compare`）。删除恒真比较，`is_binary(ref)` 分支保留。 |
| 9 | `lib/novel_application/agentic_plan_draft_planner.ex:978:8` | pattern_match_cov | a | `correction_targets/1` 调用点只传 `%AgentRun{}`（map）；`_run -> []` 不可达，删除。 |
| 10 | `lib/novel_application/authoring_task_builder.ex:1:pattern_match` | pattern_match | b | 行 1 是 `and` 编译出的无行号守卫：`valid_chapter_revision_version?/1` 里 `ref = text(...)` 恒 binary，`is_binary(ref) and ...` 左操作数恒真（pattern false/type true）。删除恒真 `is_binary(ref)`，条件等价。 |
| 11 | `lib/novel_application/authoring_task_builder.ex:368:guard_fail` | guard_fail | b | `for_quality_evaluation/1` 的 `text(attrs[:source_ref]) \\|\\| text(attrs[:turn_id])`：`text/1` 恒返回 binary，空串在 Elixir 中是真值，兜底永不触发。删除兜底（行为保持：source_ref 为空串时同样不回退 turn_id；原意差异见 §8.2 R2）。 |
| 12 | `lib/novel_application/authoring_task_builder.ex:916:8` | pattern_match_cov | a | `refs_for/1` 前 3 个 clause 已覆盖 `nil \\| binary`（调用点全部来自 `text/1`），第 4 个 `_ref -> []` 不可达。改为 2 clause（`is_binary(ref) and ref != "" -> [ref]` / `_ -> []`），对**所有**输入行为与原 4 clause 完全一致。 |
| 13 | `lib/novel_application/authoring_task_builder.ex:942:8` | pattern_match_cov | a | `blank_to_nil/1` 调用点均传 `text/1` 结果（binary），非 binary 兜底不可达；删除兜底（差异 §8.2）。 |
| 14 | `lib/novel_application/aux_task_builder.ex:205:8` | pattern_match_cov | a | `map_get/2` 调用点均为 map（attrs/材料 map），非 map 兜底不可达；删除兜底与冗余 `is_map` guard。 |
| 15 | `lib/novel_application/aux_task_builder.ex:215:8` | pattern_match_cov | a | `blank_to_nil/1` 同 #13。 |
| 16 | `lib/novel_application/aux_task_builder.ex:218:8` | pattern_match | b | `blank_or/2` 的 `nil` clause：调用点第一参为 `text/1` 结果（binary），nil 不可达。改用 guard 合并为 `when value in [nil, ""]` 单 clause，**对所有输入（含 nil/非 binary）行为与原 3 clause 完全一致**。 |
| 17 | `lib/novel_application/character_profile.ex:257:8` | pattern_match_cov | a | `fallback_targets/1` 只由 `targets/1` 的 `is_binary(work_id)` 分支调用；`_work_id -> []` 不可达，删除。 |
| 18 | `lib/novel_application/dialogue_planning_service.ex:526:8` | pattern_match | a | `exploration_budget_section/2` 只由 `exploration_sections/2` 的非空 `list ->` 分支调用，`[]` 分支不可达，删除。 |
| 19 | `lib/novel_application/dialogue_planning_service.ex:666:8` | pattern_match_cov | a | `read_only_plan_steps/1` 调用点只传 `selected_judgment_plan/3` 成功返回的 `%AgentPlan{}`（map）；`_plan -> nil` 不可达，删除并去掉冗余 `is_map` guard。 |
| 20 | `lib/novel_application/exploration_service.ex:1:pattern_match` | pattern_match | b | 行 1 是 `and` 编译守卫：`role_query?/1` 的 `query` 在分析域内恒 binary，`is_binary(query) and ...` 左操作数恒真。删除 `is_binary`（非 binary 会 raise，由 `character_role_note/2` 既有 `rescue _ -> ""` 兜成同结果，行为等价）。 |
| 21 | `lib/novel_application/exploration_service.ex:1087:9` | pattern_match_cov | a | `character_role_note/2` 内 `CharacterProfile.targets/1` 成功面只有 `{:ok, list}` / `list`；`_ -> ""` 不可达（异常已由本函数 rescue 兜底），删除。 |
| 22 | `lib/novel_application/pending_artifact_workflow.ex:200:47` | pattern_match | a | `change_plan/2` 错误面是 atom code，没有 `{:chapter_structure_invalid, _}` 包装；嵌套 else 分支不可达，删除。 |
| 23 | `lib/novel_application/pending_artifact_workflow.ex:205:13` | pattern_match | b | `build_structure_change_candidate/5` 因 #25 级联 no_return，使 `with` 的 `{:ok, result}` 分支不可达；修 `TentativeArtifactSet.@type artifact_type` 后消失。 |
| 24 | `lib/novel_application/pending_artifact_workflow.ex:269:8` | pattern_match | a | `maintain_refusal_message/1` 的 `:unsupported_effect` clause：`ChapterStructureMaintenance.change_plan/2` 无该错误生产者（moduledoc 曾列为可能，已在 #39 同批修正文档）；删除死 clause，其它拒绝原因文案不变。 |
| 25 | `lib/novel_application/pending_artifact_workflow.ex:288:8` | no_return | b | `NovelDomain.TentativeArtifactSet.@type artifact_type` 缺 `:chapter_structure_change_plan` / `:character_profile_revision`（pending artifact workflow 真实构造的候选类型），使 `TurnResultBuilder.build/8` 契约调用失败 → no_return。补类型。 |
| 26 | `lib/novel_application/pending_artifact_workflow.ex:316:57` | call | b | 同 #25 的 `TurnResultBuilder.build/8` 调用失败；补类型后消失。 |
| 27 | `lib/novel_application/pending_artifact_workflow.ex:401:45` | pattern_match | a | `revise_character_profile/5` 的 with 错误面是具体 atom code（`:invalid_character_role/:target_ambiguous/:target_missing/:unsupported_effect/:unsupported_field`），没有嵌套 `{:character_profile_invalid, _}`；删除死 else 分支（其余仍由第 2 clause 包装）。 |
| 28 | `lib/novel_application/pending_artifact_workflow.ex:420:8` | no_return | b | 同 #25（`build_character_profile_candidate/5` 的 `TurnResultBuilder.build/8` 级联）。 |
| 29 | `lib/novel_application/pending_artifact_workflow.ex:445:57` | call | b | 同 #25（角色主档案修订候选 build 调用）。 |
| 30 | `lib/novel_application/pending_artifact_workflow.ex:611:13` | pattern_match | a | `revise_chapter/6` 外层 else 的 `false ->` clause：with 子句是 `false <- snapshot.read_only`，失败时 else 收到的是 `true` 而非 false，故 `false ->` 不可达；即只读会话修订会 raise `WithClauseError`（内部错误）。**本条 triage 暴露真实产品缺陷，经作者裁决选项 A：把死 clause 改成 `true -> {:error, {:pending_artifact_invalid, :revision_not_allowed}}`**（错误码/作者可见语义沿用既有体系），并补回归测试 `b28_chapter_revision_wiring_test.exs`「read-only 会话修订已采纳章 → 可解释拒绝」。修复前测试 red（WithClauseError）、修复后 green；正常 ACTIVE 主链行为不变，详见 §8.1。 |
| 31 | `lib/novel_application/pending_artifact_workflow.ex:1452:44` | pattern_match | a | `revise_adopted/7` 的 `request_adopted/7` 错误面只有 `{:authoring_task_invalid, _}`（`revision_input/7` 只转发 AuthoringTaskBuilder 错误）；嵌套 `{:pending_artifact_invalid, _}` 不可达，删除。 |
| 32 | `lib/novel_application/pending_artifact_workflow.ex:1561:guard_fail` | guard_fail | b | `guard_scope_text/2` 的 `(frame.dialogue_goal \\|\\| %{}) \\|\\| ""`：`DialogueFrame.t` 约定 `dialogue_goal` 恒为 `%{summary: String.t()}`，两个兜底均不可达；改为 `frame.dialogue_goal.summary`。 |
| 33 | `lib/novel_application/turn_execution_service.ex:500:guard_fail` | guard_fail | b | `blocked_message/2` 的 `chapter \\|\\| "…"`：`WritingCoordinate.requested_chapter` 恒为 `String.t()`（未点名为 ""），nil 分支不可达；删除兜底。 |
| 34 | `lib/novel_application/turn_execution_service.ex:2698:7` | pattern_match_cov | a | `narration_goal/1` 的 case 第 2 clause 不可达（`frame.dialogue_goal` 恒 `%{summary: binary}`），删除。 |
| 35 | `lib/novel_application/turn_execution_service.ex:2699:7` | pattern_match_cov | a | 同 #34 的第 3 clause；合并为单 clause `%DialogueFrame{dialogue_goal: %{summary: summary}} -> summary`（summary 为 nil 时仍返回 nil，与旧 `_ -> nil` 一致）。 |
| 36 | `lib/novel_domain/chapter_mission_inputs.ex:542:guard_fail` | guard_fail | b | `chapter_header/1` 的 `title \\|\\| ""`：`display_chapter_title/2` 恒返回 binary，兜底不可达；删除。 |
| 37 | `lib/novel_persistence/adoption_repository.ex:849:guard_fail` | guard_fail | b | `replacement_pieces/2` 的 `to_string(content \\|\\| "")`：content 来自 `projection_content/1`（恒 binary），兜底不可达；改为 `to_string(content)`。 |
| 38 | `lib/novel_persistence/adoption_repository.ex:2441:guard_fail` | guard_fail | b | `empty_coverage/2` 的 `String.length(content \\|\\| "")`：content 来源同上（恒 binary），兜底不可达；删除。 |
| 39 | `lib/novel_persistence/adoption_repository.ex:1274:8` | pattern_match_cov | a | `validate_chapter_object_kind/1` 只由 `ensure_planned_chapter/3` 的 `%{title: _}` 分支调用（恒 map）；`_chapter` 兜底不可达，删除。同批修正 `ChapterStructureMaintenance` moduledoc 对 `:unsupported_effect` 的错误面描述（#24 根因文档面）。 |

分类汇总：**b 类 19 条**（#1,#2,#4,#5,#8,#10,#11,#16,#20,#23,#25,#26,#28,#29,#32,#33,#36,#37,#38）；**a 类 20 条**（#3,#6,#7,#9,#12,#13,#14,#15,#17,#18,#19,#21,#22,#24,#27,#30,#31,#34,#35,#39，其中 #30 为经作者裁决修复的真实缺陷）；**c 类（nowarn/ignore）0 条**。**#30 是唯一带失败语义修正的条目**：由「内部 WithClauseError」改为「可解释 `:revision_not_allowed` 拒绝」，属作者批准的缺陷修复，不是为消 warning 改变产品主链行为。

## 7. CP2：门禁证据（2026-10-27，HEAD `8cbced2f` 工作区，本地 Elixir 1.19.5 / OTP 28）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Dialyzer（before） | `mix dialyzer` | `Total errors: 39, Skipped: 0, Unnecessary Skips: 0`；`done (warnings were emitted)`；exit 2 |
| Dialyzer（after） | `mix dialyzer` | **`Total errors: 0, Skipped: 0, Unnecessary Skips: 0`；`done (passed successfully)`；exit 0** |
| 编译零警告 | `mix compile --warnings-as-errors --force` | exit 0，0 warnings |
| 格式 | `mix format --check-formatted` | exit 0（`authoring_task_builder.ex` 因新增注释补过一次 `mix format`） |
| Credo | `mix credo --strict` | exit 0，`found no issues`（608 source files） |
| 全量测试 | `mix test`（umbrella 根，排除 `:integration`/`:real_llm`） | exit 0：novel_foundation 96 / novel_common 61 / novel_agent 298 / novel_domain 382 / novel_persistence 331 / novel_application 984 / novel_web 133 / novel_test 1 / novel_e2e 1 = **2287 tests, 0 failures**（novel_application 984 = 原 983 + B60 read-only 回归测试 1） |
| 循环依赖 | `mix xref graph --format cycles --label compile-connected --fail-above 0` | `No cycles found`，exit 0 |
| 架构边界 | `mix run scripts/arch_check.exs` | `✅ 架构检查通过`，exit 0 |
| 场景不变量（主链改动后必跑） | `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs` | exit 0：`[I3] Layer-B cases=3 pass=3 fail=0`、Layer-A pass=3 |
| 场景不变量 | `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs` | exit 0：`[I1] cases=4 pass=4 fail=0` |
| 场景不变量 | `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs` | exit 0：`[I2] cases=3 pairs=3 disjoint=3 violations=0` |
| AGENTS 静态扫描 | `bash scripts/ai_static_scan.sh --top 10 --quick` | 17 pass / 2 fail / 1 skip；`Findings: 3 total, 0 in touched files`。2 条既有 gitleaks 命中已有 disposition（`.pen` false_positive、历史 `tools/company-console` accepted_risk，均在 B60 改动文件之外）；1 条 `task-done-manifest` 为切片收口流程检查（manifest 早于本轮 `mix test` 触碰时间，待 Lead 收口时重建 manifest），非 B60 代码问题。详见 `artifacts/static-scan/top10.md` |

证据日志（本机 `/tmp/`，不入 git）：`b60-dialyzer-before.log`、`b60-dialyzer-after.log`、`b60-compile.log`、`b60-format.log`、`b60-credo.log`、`b60-mix-test.log`、`b60-xref.log`、`b60-arch.log`、`b60-{i1_causal,i2_variation,i3_nonce}.log`。

变更文件（17 个 lib 生产代码文件 + 1 个回归测试 + 本 slice 文档；无 `apps/*/test` 生产逻辑改动）：

1. `apps/novel_agent/lib/novel_agent/provider/adapter_execution.ex`（#1、#2）
2. `apps/novel_agent/lib/novel_agent/tools/world_building_adapter.ex`（#3）
3. `apps/novel_application/lib/novel_application/adoption_workflow.ex`（#6、#7）
4. `apps/novel_application/lib/novel_application/agent_run_flows/prose_drafting_with_quality.ex`（#8）
5. `apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex`（#9）
6. `apps/novel_application/lib/novel_application/authoring_task_builder.ex`（#10、#11、#12、#13）
7. `apps/novel_application/lib/novel_application/aux_task_builder.ex`（#14、#15、#16）
8. `apps/novel_application/lib/novel_application/chapter_structure_maintenance.ex`（#24/#39 同批 moduledoc 修正）
9. `apps/novel_application/lib/novel_application/chapter_summary_maintenance.ex`（#4）
10. `apps/novel_application/lib/novel_application/character_profile.ex`（#17）
11. `apps/novel_application/lib/novel_application/dialogue_planning_service.ex`（#18、#19）
12. `apps/novel_application/lib/novel_application/exploration_service.ex`（#20、#21）
13. `apps/novel_application/lib/novel_application/pending_artifact_workflow.ex`（#22、#24、#27、#30、#31、#32 及 #23/#25/#26/#28/#29 级联）
14. `apps/novel_application/lib/novel_application/turn_execution_service.ex`（#33、#34、#35）
15. `apps/novel_domain/lib/novel_domain/chapter_mission_inputs.ex`（#36）
16. `apps/novel_domain/lib/novel_domain/tentative_artifact_set.ex`（#25/#28 根因：artifact_type 类型）
17. `apps/novel_persistence/lib/novel_persistence/adoption_repository.ex`（#37、#38、#39）
18. `apps/novel_application/test/novel_application/b28_chapter_revision_wiring_test.exs`（#30 回归测试：read-only 会话修订 → 可解释拒绝）

无 `mix.exs`/CI/deps/quality/frontend/协议/schema/文案语义改动；无 `git commit`（Lead 提交）。

## 8. CP3：收口、行为不变量说明与残余

### 8.1 R1（已按作者裁决选项 A 修复，CP1 顺带真实缺陷）

**`PendingArtifactWorkflow.revise_chapter/6` 的 read-only 会话修订路径**：with 子句 `false <- snapshot.read_only` 在只读会话（`session.status != "ACTIVE"`，`WorkSessionService.show/2` 可真实返回 `read_only: true`）下不匹配，else 收到 `true`；原代码 else 写的是 `false -> {:error, {:pending_artifact_invalid, :revision_not_allowed}}`，该分支永远不执行，只读会话修订实际会 raise `WithClauseError`（按内部错误处理）。B60 triage 认定这是「门禁债暴露出来的真实产品缺陷」（与 B59 同类），经作者裁决选项 A 修复：

- 修复：else 改为 `true -> {:error, {:pending_artifact_invalid, :revision_not_allowed}}`（沿用既有错误码与作者可见拒绝语义，不新增协议字段）。
- 回归测试：`apps/novel_application/test/novel_application/b28_chapter_revision_wiring_test.exs` 新增「read-only 会话修订已采纳章 → 可解释拒绝（不 crash、不调用 writer）」；已做 red/green 验证：修复前该测试以 `WithClauseError` 失败，修复后通过。
- 影响面：仅非 ACTIVE（只读/归档）会话上对已采纳章的修订请求；正常 ACTIVE 主链行为逐字节不变（全量 2287 测试 + scenario invariants 复跑通过）。
- 残余：拒绝文案沿用 `maintain_refusal_message` 体系外的 `:revision_not_allowed` 错误码（前端既有失败处理路径），本 slice 未新增用户可见文案；若产品要专门文案，另开 UI copy slice。

### 8.2 行为不变性与不可达输入差异（逐条登记）

本轮除经作者裁决的 #30（R1，见 §8.1）外严格遵守「可达路径行为不变」。以下差异只发生在 dialyzer 全局分析证明不可达的输入上（`apps/*/lib` 无该调用方，测试也未覆盖这类输入；2287 测试全绿）：

- **完全保行为**（对所有输入逐字节一致，含不可达输入）：#12 `refs_for/1` guard 重写、#16 `blank_or/2` guard 合并、#20 `role_query?/1`（非 binary → raise 但由既有 rescue 兜成 `""`）。
- **删除非 binary/nil 兜底后，不可达输入从回退值变为 FunctionClauseError/CaseClauseError**（可达输入完全不变）：#13/#15 `blank_to_nil/1`（非 binary）、#14 `map_get/2`（非 map）、#17 `fallback_targets/1`（非 binary）、#3 `artifact_type_from_task/1`（非 AuthoringTask）、#7 `put_b28_result_fields/2`（非 map）、#9 `correction_targets/1`（非 map）、#18 `exploration_budget_section/2`（空列表；调用方已短路）、#19 `read_only_plan_steps/1`（非 map）、#22/#27/#31 嵌套错误分支（若未来 producer 变化则 WithClauseError，非静默错误码）、#6 `:not_found`（若 repo 未来返回则 CaseClauseError）、#39 `validate_chapter_object_kind/1`（非 map）、#32 `guard_scope_text/2`（dialogue_goal 非 map/nil）、#33 `blocked_message/2`（chapter=nil 时原显示 `…`，现显示空串）、#37/#38 `content=nil` 时 `String.length` 会 raise（`to_string(nil)` 仍 ""）、#34/#35 non-binary summary 原返回 nil 现原样返回。
- **语义备注 R2（未改，仅登记）**：`AuthoringTaskBuilder.for_quality_evaluation/1` 原 `text(attrs[:source_ref]) || text(attrs[:turn_id])` 的兜底永不触发（空串是真值），即 source_ref 缺省时**不会**回退 turn_id。B60 删除死兜底后行为不变；若产品原意是「缺省回退 turn_id」，需要一次显式行为修复（不在本 slice 范围）。
- **R3（已关闭）**：`ChapterStructureMaintenance.change_plan/2` moduledoc 曾声称可返回 `:unsupported_effect`，实际无生产者；已同步修正文档错误面（#24 的根因文档面）。
- **R4（登记）**：`AdoptionWorkflow` 中 `accepted_chapter_scopes/2` 的 `:not_found` 为历史契约漂移（仓储层已不返回）。若后续仓储再引入该返回值，应同步调用方（现有 `:error`/`{:error, _}` 分支已覆盖真实错误面）。

### 8.3 与既有任务的交叉引用

- **B28/VS-00C**：`adoption_repository.ex` `replacement_pieces/2`、`empty_coverage/2` 的 `content || ""` 与 `adoption_workflow.ex` B28 result fields 分支均属 B28/B36 引入区段；本轮只删恒真/不可达分支，不改整章修订/采纳语义。
- **B36**：`put_b28_result_fields/2` 非 map 兜底删除；结构化段落替换主链不变（`persist_replace_segments` 路径测试全绿）。
- **B30**：`pending_artifact_workflow.ex` 章节结构维护分支：#22/#24 死分支、`change_plan` 错误面文档修正；`artifact_type: :chapter_structure_change_plan` 纳入 `TentativeArtifactSet.@type artifact_type`。
- **B29**：`artifact_type: :character_profile_revision` 纳入 `TentativeArtifactSet.@type artifact_type`，角色主档案修订候选继续经 `TurnResultBuilder.build/8`。
- **B27**：`ChapterSummaryMaintenance.input()` 补齐 `:material_scope`（B27 CP3c/D4 引入的摘要材料范围标注），`AuxTaskBuilder.for_chapter_summary/1` 语义不变。
- **B22**：`AdapterExecution` 的 ctx 契约按「Gateway 单点注入 + adapter 只消费可选键」的实际接受域修正，`TimeoutPolicy`/三层时钟行为不变。

### 8.4 后续约束

- 不得为了让 dialyzer 绿而启用全局 `ignore_warnings`；后续若新增 warning，先按 §6 的族根因处理，确有「证明不可达/第三方行为」时才允许逐条 `@dialyzer {:nowarn_function, ...}` 并写入任务文档。
- R1 已按作者裁决 A 修复（#30，含回归测试）；若未来 read-only/归档会话策略变化（例如允许只读会话继续修订），需重访该拒绝语义。
- R2（`for_quality_evaluation` 的 source_ref→turn_id 兜底原意）与 R4（`accepted_chapter_scopes/2` 的 `:not_found` 历史契约漂移）保持登记、本批不改；若产品意图确认需要兜底/重新引入错误码，另开最小修复。
- 2026-10-28 R2 后续裁决与完整失败链已统一交 [B63 §6.2](B63-known-gaps-remediation.md#62-r2-质量物料引用裁决)；此处保留原始发现，不再维护第二份 R2 决策状态。
