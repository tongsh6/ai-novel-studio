# B63：known-gaps 清零与残余定性（judgment-explore-internal / E10 / R2-R4）

- 状态：**done（2026-10-28，CP0–CP3）**：`judgment-explore-internal` 复跑 PASS 并 active；E10 evidence_missing 关闭（native 证据映射，E2E 整条仍受 stale 行影响、不冒充 PASS）；R2 留作者裁决（open）、R4 保持登记；known-gaps/NEXT/台账已由 Lead 收口。
- 登记日期：2026-10-28；来源：作者选择「清 known-gaps」。
- 上游：[known-gaps](../../quality/acceptance/known-gaps.md)、[E2E-01-full-chain](../../docs/design/acceptance/e2e/E2E-01-full-chain.md) §E10、[B60](B60-backend-dialyzer-baseline.md) §8.2 R2/R4、[B61](B61-native-acceptance-driver-coverage.md)。

## 1. 范围（三类，逐项给出可核验结论）

1. **`judgment-explore-internal`（blocked / evidence_missing）**：阻塞原因「最近一次真实页面记录（2026-07-20）只有失败截图、无 summary.json」。driver 已存在（`frontend/slice-verify/external-ui-driver.mjs` → `driveJudgmentExploreInternal`），场景断言为判断循环内部探索翼（判断→只读检索已采纳正文→回复带出处、同 turn、无生产写入）。用现有 `tauri_slice_verify` 入口 current-HEAD 复跑：PASS → registry active；失败 → 保留 blocked 并写清失败首因（不得用历史证据代签）。
2. **`e2e-01-full-chain` E10 持久化闭环（aggregate evidence_missing）**：先只读分析 E2E 文档 §E10 的验收要求、现有场景/artifact 是否已有满足该闭环的独立真实页面证据（如 `e2e-01-replay-report`、`au08-reading-readonly-no-write`、`q1c-adopted-content-revision` 等），给出三种结论之一：
   - (a) 现有真实页面 artifact 已满足 → 由 Lead 批准后把 E10 映射到该 artifact（不得降低判据）；
   - (b) 需要一次 scoped 真实页面复跑补齐 → 指明场景/入口与改动；
   - (c) 无法在不伪造的前提下补齐 → 保持 evidence_missing，登记 owner/触发条件与缺口本质。
3. **B60 R2 / R4**：R2（`for_quality_evaluation` 的 `source_ref || turn_id` 兜底原意）需要作者确认产品意图 → 整理成作者裁决项；R4（`accepted_chapter_scopes` `:not_found` 历史契约漂移）给出「保持登记 / 最小防御性修复」建议与影响面。

## 2. CP0 边界与证据规则

- 不改验收判据强度、不改产品 `apps/`（如发现真实产品缺陷，按 B59 先例登记新 slice，不现场改）。
- E10 结论必须**不伪造**：没有真实页面 artifact 就如实保持 evidence_missing 并登记；不得用局部 mix 证据或历史 summary 冒充。
- `judgment-explore-internal` 复跑使用既有 `quality_accept judgment-explore-internal --surface tauri`（browser-surface 产品链证据，如实标注）；**Tauri 运行与 B62 native 批次串行**，由 Lead 协调，禁止与 B62 同时占用 4657/5769。
- 失败批次只读保留；同因失败 ≤2 次后升级 Lead。

## 3. Checkpoint

| CP | 范围与完成标准 |
|---|---|
| CP0 | done：三类对象、边界、证据规则 |
| CP1 | done：`judgment-explore-internal` current-HEAD 复跑 **PASS**（browser-surface；driver/verifier 零改动）；证据 `artifacts/slice-verify/judgment-explore-internal-tauri/`；registry active 已由 Lead 按证据改 |
| CP2 | done（Lead 2026-10-28 批准映射）：E10 结论 (a) + 证据索引 + 映射已落地；R2 作者裁决项（A/B/C，推荐 A，**待作者确认**）；R4 建议「保持登记」 |
| CP3 | 进行中：e2e_status 测试/聚合已回归；known-gaps/NEXT/台账/scenarios.yml 由 Lead 收口；最终 HEAD verdict 复跑由 Lead 排期 |

## 4. 验证与恢复

- 复跑：`bash scripts/tauri_slice_verify.sh --provider slice_verify judgment-explore-internal`（registry `blocked` 时 `quality_accept.sh` 前置返回 65、不执行 runner；二者调用的是同一 runner 命令；registry `active` 后可走 `bash scripts/quality_accept.sh judgment-explore-internal --surface tauri` 复跑写 verdict）。
- E10：以 `quality/acceptance/scenarios.yml` 的 E2E 聚合 spec 与 `scripts/e2e_01_full_chain_check.sh` artifactSpecs 为准逐项核对。
- 恢复：先读 known-gaps 当前表、E2E 文档 §E10、B60 §8.2；不要用历史 summary 当 current-HEAD 证据。

## 5. CP1：judgment-explore-internal current-HEAD 复跑（PASS）

### 5.1 只读重锚判断：无需重锚（driver/verifier/manifest 0 改动）

| 检查项 | 当前生产链事实 | 结论 |
|---|---|---|
| 入口/注册 | `scenarios.yml` 旧 `status: blocked`（原因=2026-07-20 失败记录无 summary）；runner=`tauri_slice_verify`，默认 provider=`slice_verify`，manifest seed=`seed_p1_chapter_draft_generation.exs` | 无过期字段 |
| driver selector/文案 | `input[placeholder="输入你的想法、问题或指令..."]`、发送按钮「发送」、采纳按钮 pattern（含「保存为章节正文」）与其他 current-HEAD PASS 场景共用 | 未过期 |
| 草稿/采纳断言 | `turn_result.tool_result.output.artifact_type=prose_fragment` + `pending[].artifact_type=prose_fragment` + `artifact_adopted=true/resolved`（与 p1/au05/vs00c 当前 driver 同形状） | 未过期 |
| 探索问答路由 | `「灵气账单」` 命中 `slice_verify.ex` 当前路由（含「正文里/查一下」→ `prose_search`；回环回复含「依据如下」+ 观察引用行含章名/词） | 未过期 |
| 作者可见活动行 | 断言 `includes("已检索")` 对应 `ExplorationService.activity_text("prose_search")` 当前文案「已检索正文「query」。」，与 2026-10-25 `judgment-explore-chapter-plan` PASS 同渲染路径 | 未过期 |
| verifier 事件/字段 | `findJudgmentExploreInternalEvidence`/`judgmentExploreInternalBehavior` 要求 `judgment.decided.done` action=explore→reply 同基 turn、无 toolbox、零 pending、回复引用词+章名；`dialogue_planning_service.ex` 当前 `emit_judgment_decided` + `LogContext.put_turn` 绑基 turn_id，2026-10-25 sibling PASS 的 app-log 实测同形 | 未过期 |

结论：没有旧事件、旧 selector、旧断言需要重锚；本轮未修改 `frontend/slice-verify/**` 或 manifest（0 改动）。残余风险（事前未改断言）：本场景「chat→正文草稿→采纳」段自 2026-07-20 无 current-HEAD PASS，但同 chain 形状有 2026-10-25/10-27 邻场景 PASS；失败则按首因报告，不重锚刷分。

### 5.2 运行结果（2026-10-28，HEAD 7fcab486；browser-surface 如实标注）

- 命令：`bash scripts/tauri_slice_verify.sh --provider slice_verify judgment-explore-internal` → exit 0，`[tauri-slice-verify] verified judgment-explore-internal turn_id=message_d464f510-a84b-41b3-8ad6-a08f7ceffaa0` + `passed: judgment-explore-internal`。
- 证据：`artifacts/slice-verify/judgment-explore-internal-tauri/`（`summary.json` / `app-log.json` / `ui-frames.json` / `ui-state.json` / `log-noise.json` / `judgment-explore-internal-external-ui.png` / `backend.log` / `tauri.log` / `tauri-home` / `llm-calls`）。
- summary：`behavior=judgment_explores_adopted_prose_then_replies_with_cited_facts`、`judgment_explore_count=1`、6/6 assertions（author_question_names_a_prose_only_fact；judgment_decided_explore_before_reply_on_same_turn；exploration_ran_readonly_without_toolbox_dispatch；exploration_observation_visible_in_run_feedback；reply_cites_fact_term_and_source_chapter；explore_turn_produced_no_pending_artifacts）；`log_noise.ok=true`（12 行/0 error）；`provider=slice_verify`、`surface=browser`、`driver=headless-chromium`、`tauri_window_launched=true`——**browser-surface 证据，不得读作原生交互 PASS**。
- app-log：同 turn 两条 `judgment.decided.done`（action=explore, frame_type=judgment_explore, reason=missing_work_facts_require_retrieval → action=reply, frame_type=casual_reply）；explore turn 无 `toolbox.execute.done`；ui-state：cites_fact/cites_chapter/exploration_visible/explore_no_pending 全 true。
- 页面可见证据：回复「我检索了正文中与「灵气账单」相关的段落，依据如下：「第01章：底层灵气账单」…」；运行反馈可见「已检索正文「灵气账单」。」；`turn_result.truthfulness={artifact_adopted:false, production_write_performed:false, tool_called:true, exploration_call_count:1}`。
- 历史失败证据只读保留：`artifacts/slice-verify/judgment-explore-internal-tauri-failed-20260720/`（原目录整体重命名，内容未改）；`judgment-explore-internal-tauri-lmstudio/` 未动。两批失败首因（供恢复参考，非本轮结论）：① 2026-07-20 tauri 批次 `backend.log` = 端口 4657 `:eaddrinuse`（环境占用）；② `-lmstudio` 批次真实模型把引用词带引号检索（`"灵气账单"`）→ `prose_search` 0 命中 → 回复无「依据如下」；当前 manifest 默认 provider=`slice_verify` 确定性替身，与 driver 断言一致。
- 进程清理：运行结束 4657/5769 无 listener、无 tauri/vite/beam slice_verify_server/target-debug-app/external-ui-driver 残留。

### 5.3 CP1 结论

PASS → known-gaps `judgment-explore-internal` 行可关闭、registry 改 `active`（2026-10-28 Lead 已按证据改 active）。最终提交后 HEAD 变化的老化（freshness）复跑由 Lead 统一排期。

## 6. CP2：E10 定性 (a) + R2 / R4

### 6.1 E10 持久化闭环：结论 = **(a) 现有真实页面 native artifact 已满足**（2026-10-28 Lead 批准映射）

E2E-01 §E10 判据逐项证据：

| 判据 | 证据 |
|---|---|
| turn 完成后 `TraceRepository.list_by_turn(turn_id) != []` | `artifacts/slice-verify/e2e-01-readonly-tool-trace-tauri/trace-query.json`：产品仓储 `NovelPersistence.TraceRepository.list_by_turn(turn_id)` 实测 `count=1`；summary checks `tool_trace_queryable_by_step_turn_id=true`、`trace_repository_list_by_turn_returned_tool_trace_ref=true` |
| trace 字段 `turn_id` / `frame_ref` / `decision_type` | 同 `trace-query.json`：`turn_id=message_b1382842-…:agent:3`、`frame_ref=frame_run_mvqwbht2_5_3`、`decision_type=tool_dispatched` |
| trace 字段 `event_order` | 同批 run 的 `database/ai_novel_studio_test.sqlite3` 只读核对 `decision_traces` 行 `event_order=["author_input_received","dialogue_frame_validated","micro_plan_generated","orchestrator_decision_allow_tool","tool_request_constructed","tool_dispatched","tool_result_received","tool_trace_recorded","turn_result_emitted"]`（非空，未改任何字节）；summary `replay_report_result_complete=true`，ReplayService 恰以 `trace.event_order != [] && turn_result_ref != nil` 判定 `:complete`（`replay_service.ex:137`），属机器判据 |
| 无 provider 参与的持久回放（补充） | summary `replay_report_built_from_persisted_trace_without_provider_call=true`；`trace-query.json` ReplayReport `provider_called=false`、`result_status=complete`、chain 含 frame/plan/decision/tool_trace/turn_result |

判据未降低、未用局部 mix 证据冒充。**批准后已执行的映射改动**（2026-10-28）：

1. `scripts/e2e_01_full_chain_check.sh`：artifactSpecs 新增独立 key `e10-persistence-roundtrip-tauri`（rel_path 指向上述 summary；`slice_ids=["e2e-01-readonly-tool-trace"]`、provider=slice_verify、surface=tauri、assertions 取 summary 实际存在项：`tool_trace_queryable_by_step_turn_id` / `trace_repository_list_by_turn_returned_tool_trace_ref` / `replay_report_result_complete`）；E10 scenario 改为 `slices:["e2e-01-readonly-tool-trace"]`、`artifacts:["e10-persistence-roundtrip-tauri"]`、`surface:"tauri"`（保留原 commands 作机制证据）。既有 E6/E9 spec 未改。
2. `docs/design/acceptance/e2e/E2E-01-full-chain.md`：§E10 行改「已验收（2026-10-28，native 证据）」+ 证据索引；新增 2026-10-28 B63 CP2 日期注记；§4.2 cross-reference 与 §4.3 段同步（developer/多类型 trace query UI 仍归 AU-07）；历史段保留。

**验证**：`bash -n scripts/e2e_01_full_chain_check.sh` 通过；`node --test scripts/lib/quality/e2e_status.test.mjs` 59/59 pass；`bash scripts/e2e_01_full_chain_check.sh --provider slice_verify` → E10 **pass/fresh**，聚合 counts 由 `{pass:2, stale:10, evidence_missing:1}` 变为 `{pass:3, stale:10, evidence_missing:0}`，整条仍 exit 67（证据缺失：E1/E2/E3/E4/E5/E7/E8/E11/E12/E13 stale，B40 §10.2 未复跑债务）。**边界**：本映射只关闭 E10 自身 evidence_missing，不使整条 E2E-01 PASS；freshness 与 HEAD 相关，最终提交后 HEAD 变化需按 Lead/B62 排期复跑否则该 native verdict 判 stale。

### 6.2 R2（作者裁决项，**open，待作者确认**；引用 [B60](B60-backend-dialyzer-baseline.md) §8.2 R2）

事实：`AuthoringTaskBuilder.for_quality_evaluation/1` 原 `text(attrs[:source_ref]) || text(attrs[:turn_id])` 兜底永不触发（`text(nil)=""` 为真值）；B60 删死兜底后行为不变 =「source_ref 为空时**不回退** turn_id」，最终 `{:error, {:authoring_task_invalid, :material_ref_required}}`。调用方 `turn_execution_service.ex:2062` 传 `source_ref=List.first(tool_result.artifact_refs)`、`turn_id=frame.turn_id`；error 时 quality eval task=nil（既有容错）。

| 选项 | 内容 | 影响 | 推荐 |
|---|---|---|---|
| **A（推荐）** | 保持现状：不回退 turn_id | 零行为变化；quality evaluation 的 prose 物料必须绑定正文 artifact ref（字节来源），turn_id 是轮次标识不是正文物料，回退会让物料来源漂移并与 I1 因果绑定语义冲突；缺 artifact 的 error 路径已被调用方容错、测试覆盖 | ✅ |
| B | 恢复回退：source_ref 空 → turn_id | 行为变化；prose material ref 变成 turn（无正文内容绑定），需改调用方/测试/契约文档，且 source_refs 与 material ref 语义混淆 | ❌ |
| C | 不回退但显式跳过质量评估并留可观测事件 | 主链行为不变（现 error→task=nil 已等价），只补显式日志；如需另开最小观测 slice | 可选 |

状态：**待作者选 A/B/C**；作者确认前 R2 保持 open，不自行标记关闭。

### 6.3 R4（建议「保持登记」；引用 [B60](B60-backend-dialyzer-baseline.md) §8.2 R4）

事实：仓储 `AdoptionRepository.accepted_chapter_scopes/2` 错误面只有 `:error`（Ecto.UUID.cast 失败）与 `{:error, :target_missing | :target_ambiguous}`（identity 解析），无 `:not_found` 生产者；`AdoptionWorkflow` 现有子句 `{:ok,%{scopes:[_|_]}}`、`{:ok,_}`→`:incomplete_scope`、`:error`→`:target_missing`、`{:error, reason}` 透传，已覆盖真实错误面。

建议：**保持登记，不做最小防御性修复**（不加 `{:error, :not_found}` 不可达子句）。理由：该子句在 dialyzer 下会成为不可达/不符 spec 分支（B60 刚清零 39 warnings，加回即新增门禁债）；当前无消费者需要该错误码。触发条件：若未来仓储重新引入 `:not_found` 或错误面变更 → 同步改 workflow 子句 + 回归测试 + 仓储 typespec/契约文档，并重跑 dialyzer。风险面：当前多类型错误经 `{:error, reason}` 透传，消费者若未处理未知 atom 走上游 default 分支（无静默数据风险，但语义可能不友好）。

## 7. 变更与验证汇总

- 改动文件（本 CP2，Lead 已批准）：`scripts/e2e_01_full_chain_check.sh`（仅 E10 mapping + 独立 spec）、`docs/design/acceptance/e2e/E2E-01-full-chain.md`（E10 结论注记）、本文件。
- 证据（本地 artifacts，gitignored）：`artifacts/slice-verify/judgment-explore-internal-tauri/`（CP1 PASS）、`artifacts/slice-verify/judgment-explore-internal-tauri-failed-20260720/`（旧失败只读保留）、`artifacts/slice-verify/e2e-01-full-chain/summary.json`（E10 pass/fresh，聚合仍 evidence_missing）。
- 门禁：`node --test scripts/lib/quality/e2e_status.test.mjs` 59/59；`bash -n scripts/e2e_01_full_chain_check.sh` 通过。
- 未改：产品 `apps/`、`frontend/slice-verify/**`、`quality/acceptance/scenarios.yml`、known-gaps/NEXT/project-ledger（Lead 收口）；未 commit。

## 8. CP3 收口记录（2026-10-28，Lead）

1. **registry**：`judgment-explore-internal` 已按 CP1 PASS 证据改 `active`（删除 blocked_reason）；nightly blocked 仅剩 `au02-candidate-fallback-ui`（契约裁决）。`quality_manifest_check` 207/2/209 passed。
2. **known-gaps**：`judgment-explore-internal` 与 E10 两行移出 blocked/evidence_missing 表；新增 B62/B63 关闭记录；native 覆盖现状更新。
3. **E2E**：E10 映射已落地（`e10-persistence-roundtrip-tauri`），聚合计数 `pass:2→3 / evidence_missing:1→0`（HEAD 7fcab48）；整条 E2E-01 仍 exit 67（E1/E2/E3/E4/E5/E7/E8/E11/E12/E13 stale，B40 §10.2 债务），不冒充 PASS。
4. **R2**：保持 open（作者裁决项，推荐 A）；**R4**：保持登记，不引入不可达分支/新 dialyzer 债。
5. **静态扫描闭环**：E10 映射新增的 `artifactSpecs.key: "e10-persistence-roundtrip-tauri"` 被 gitleaks generic-api-key 规则误报（内部 spec 标识符非凭证）；已按既有处置台账在 `reports/static-scan/dispositions.json` 登记 `false_positive` 并写明理由与重报处理，而非改写代码语义规避扫描器。
5. **提交后 freshness**：judgment-explore-internal 在最终 HEAD 用 `quality_accept` 复跑一次写 verdict（Lead 排期）；E10 证据 freshness 依赖 B61 native 批次在最终 HEAD 的复跑。
