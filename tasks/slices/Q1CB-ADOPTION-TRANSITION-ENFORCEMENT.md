# Q1CB-ADOPTION-TRANSITION-ENFORCEMENT：采纳状态转换矩阵在持久化边界强制

- 状态：**done（2026-10-23；CP0–CP3 全落；真实 Tauri `p1-chapter-edit-then-accept` 扩展验收 PASS；复活维持 Deferred 已登记）**
- 来源：`tasks/slices/B13B-adr-enforcement-reconciliation.md` §4.1 #4（gap B 19-g1）；ADR-0019 `## enforcement_gaps`
- 设计真源：`docs/design/adr/ADR-0019-adoption-status-transition-v3.md`；`docs/design/contracts/VS-04-adoption-boundary-contract-pack.md`；`docs/design/foundation/30-contract-glossary.md` §3.2.1
- 类型：承重竖切面（adoption 持久化边界）

---

## 1. 开工七问

1. **Contract**：ADR-0019 artifact adoption 7 态转换矩阵；INV-1（进入 `ACCEPTED`/`EDITED_ACCEPTED` 只能来自 `TENTATIVE`，复活必须回 `TENTATIVE` 重入）；INV-4（非表中转换一律在持久化边界 reject 且可解释）。
2. **Invariant**：canon 进入必须有可溯的 TENTATIVE→canon 两步；任何持久化写入不得绕过矩阵；非法转换被拒时作者可见结果是可解释的失败（不静默吞、不伪装写入成功）。
3. **Boundary**：`novel_domain`（复用 `NovelDomain.AdoptionStatus.transition_allowed?/2` 单一权威）、`novel_persistence`（`Draft` changeset 校验 + `AdoptionRepository.supersede_accepted_drafts` 去掉 `update_all` 绕过，逐行 changeset 更新）、`novel_application`（`AdoptionWorkflow` 把 `{:illegal_adoption_transition, detail}` 分类为可解释 failed action_result + `failed_recoverable` TurnResult）。不改 schema/取值集合、不改 UI、不改 Channel 协议。
4. **Consumer**：阅读投影采纳持久化（`AdoptionRepository.persist/1` 的 `reading_projection` Multi step）；`edit_then_accept` / `accept` / 覆盖采纳路径；真实页面 driver/verifier。
5. **Proof**：`draft_test`（矩阵边界：TENTATIVE→ACCEPTED 合法、DISCARDED/ARCHIVED→ACCEPTED 非法、ACCEPTED→TENTATIVE 非法、ACCEPTED→SUPERSEDED 合法与自反 no-op）+ `adoption_workflow_test`（非法转换 → failed action_result + `failed_recoverable` TurnResult + `illegal_adoption_transition` reason code + 零原文泄漏）+ 真实 Tauri `p1-chapter-edit-then-accept`（pending TENTATIVE → resolved `EDITED_ACCEPTED` 两步留痕 + state trace draft revision ref）。
6. **Acceptance Driver**：外部 Playwright 驱动真实 Tauri 工作台：生成第 1 章正文草稿 → 阅读 pending TENTATIVE 候选 → 点「修改后采纳」编辑全文 → 保存 → 阅读模式显示作者编辑正文且字数匹配；断言来自 WS 帧/app JSONL/可见页面。产品代码零验收感知逻辑。
7. **Exploration**：不适用（adoption 持久化边界，非要素物化 slice）。

## 2. CP0 契约与作者裁决（默认拍板）

B13b §7 Q4「ADR-0019 复活/un-archive 是否仍是产品承诺？矩阵是否下沉 persistence？」审计建议：**矩阵下沉 persistence（开 Q1Cb）；复活先降级 Deferred**。本轮按作者授权「遇作者裁决点按审计建议默认拍板并登记」执行：

- **矩阵下沉 persistence 实现**（本 slice 主体）。
- **复活/un-archive 维持 Deferred（文档化挂账）**：矩阵已允许 `DISCARDED/SUPERSEDED/INVALIDATED/ARCHIVED → TENTATIVE`，但生产无写入入口、无验收场景；触发=作者真实需要撤回误丢弃/恢复旧版时开 `AU05b-adoption-revive`。ADR-0019 gap 保留 trigger 文本，不冒充已实现。
- 既有 `ChapterSummary.accept` 路径（领域 enforcer）保持不动；`ArtifactAdoptionEntry` 的 changeset 校验继续作为 embedded 结构约束（TurnResult 序列化时同源）。

## 3. CP1 实现（持久化边界强制）

**`NovelPersistence.Schemas.Draft`**
- `changeset/2` 新增 `validate_adoption_transition/2`：当 persisted struct 的 `status` 与本次写入的新值不同且不是自反 no-op 时，调用 `NovelDomain.AdoptionStatus.transition_allowed?/2`；非法 → `add_error(:status, "illegal adoption transition FROM -> TO")`。
- 新建 struct 默认 `status=TENTATIVE`（ADR-0019 初始态），首次以 `ACCEPTED`/`EDITED_ACCEPTED` 落库即 TENTATIVE→canon 两步的第二步；直接非法跳变（如 `DISCARDED → ACCEPTED`）在 insert 前即被拒。
- `adopt_changeset/1` / `discard_changeset/1` 改为走 `changeset/2`（不再用裸 `change`），新增 `supersede_changeset/1`；三者都受同一矩阵与 optimistic lock 保护。

**`NovelPersistence.AdoptionRepository`**
- `supersede_accepted_drafts/3` 删除 `update_all` 绕过（`update_all` 不触发 changeset 校验）：改为 `repo.all` + 逐行 `Draft.supersede_changeset/1 |> repo.update()`；非法转换返回 `{:illegal_adoption_transition, message}`，由 Multi 事务回滚（写入不落地）。
- 解释性错误：`adoption_transition_error/1` 优先透出 changeset 的矩阵错误文本，未知错误回落 `{:adoption_status_update_failed, inspect(...)}`。

**`NovelApplication.AdoptionWorkflow`**
- `persist_adoption` 保留结构化 `{:illegal_adoption_transition, detail}`（不再拼成通用字符串）。
- `classify_persistence_failure/1`：非法转换 → reason_code `illegal_adoption_transition`；其它持久化错误 → `adoption_persistence_failed`。
- 失败路径仍走 BB-7 语义：failed action_result + `failed_recoverable` TurnResult；作者可见文案区分「状态转换不合法」与「写入失败」，**不带原始错误原文**；developer 日志携带 detail（截断 300 字）。

## 4. CP2 单测矩阵

- `draft_test`：TENTATIVE→ACCEPTED 合法；DISCARDED→ACCEPTED 拒绝（INV-1）；DISCARDED→ARCHIVED→ACCEPTED 拒绝；ACCEPTED→TENTATIVE 拒绝；ACCEPTED→SUPERSEDED 合法；自反 no-op 合法。
- `adoption_workflow_test`：注入 writer 返回 `{:error, {:illegal_adoption_transition, "illegal adoption transition DISCARDED -> ACCEPTED"}}` → failed action_result（`persistence.reason_code=illegal_adoption_transition`）+ `failed_recoverable` TurnResult（reason code/作者文案/零原文泄漏）。
- 既有 `artifact_adoption_entry_test`、`adoption_repository_test`、`adoption_workflow_test` 全绿（合法路径行为不变）。

## 5. CP3 真实页面验收（p1-chapter-edit-then-accept 扩展）

外部 Playwright 驱动真实 Tauri 工作台：
1. 打开档案「大纲与结构」→「生成正文草稿」→ pending `prose_fragment` 候选（真实 WS turn_result）。
2. 断言 pending adoption entry `adoption_status == "TENTATIVE"`（canon 前状态）。
3. 点「修改后采纳」→ 编辑全文 → 保存 → `edit_then_accept` author_action 携带 `edited_content`。
4. 采纳 turn_result：resolved entry `adoption_status == "EDITED_ACCEPTED"`，且 resolved 集合只含 canon 状态；`trace_summary.state_trace_refs` 含 `source_revision_ref` 以 `draft:` 开头的持久化 revision（两步留痕）。
5. 合法流程零 `adoption.persist.error reason_code=illegal_adoption_transition`。
6. 阅读模式显示作者编辑正文、本章/全书有效字数与编辑正文一致。

非法转换拒绝的真实页面诱导不在本 slice（正常 UI 只发合法动作）；其可解释拒绝由 CP2 单测 + CP1 错误分类覆盖，slice 汇总诚实注明。

## 6. 诚实边界

1. **复活/un-archive 生产入口 Deferred**：矩阵与单测支持，但无产品入口/验收场景；触发=作者真实需要撤回误丢弃/恢复旧版 → 开 `AU05b-adoption-revive`（ADR-0019 gap 保留 trigger，不宣称已闭环）。
2. **非法转换真实页面证据**：正常 UI 只能产生合法动作（Draft 写路径只有 insert 与 supersede，均恒合法）；本 slice 的真实页面证据是「合法两步留痕 + 合法流程零非法转换拒绝」，**非法转换拒绝的可解释性由单测覆盖**（Draft changeset + AdoptionRepository 错误出口 + AdoptionWorkflow failure mapping），不冒充真实页面命中。若未来需要真实页面拒绝证据，须 seed 造敌意初态（如已 SUPERSEDED 的 draft 再采纳）后新增 Tauri 场景。
3. **持久化「两步仪式」的口径**：库内 Draft 仍是单行写入（`persist_reading_projection` insert 时 from=struct 默认 TENTATIVE，等价 TENTATIVE→canon 的第二步）；**没有额外 TENTATIVE 中间行**。真实页面两步留痕是 wire/决策层语义（pending TurnResult 条目 TENTATIVE → 采纳 TurnResult resolved canon），不是库内历史表。若要库内历史行需先 insert TENTATIVE 再 update canon（会改变 revision 语义），本 slice 不做并在此显式登记。
4. **矩阵适用范围**：artifact adoption 7 态（Draft / ArtifactAdoptionEntry / ChapterSummary）；MemoryItem 记忆状态机与 Work/Character 生命周期是独立状态机，不在本 ADR 范围。
5. **`artifact_adoption_entry` 无独立生产写入**：其 embedded changeset 校验作为 TurnResult 形状约束；持久化侧 enforcer 落在 `drafts` 与既有 `ChapterSummary`。
6. **`update_all` 改逐行 update 的副作用**：被 supersede 的旧 draft `revision` 会 +1（optimistic lock 自增），且并发冲突从「静默 update_all」变为可解释错误（`Ecto.StaleEntryError` 已 rescue 为 `{:adoption_status_update_failed, ...}`，事务回滚）；极端并发需上层重试，本 slice 仅保证不抛异常。
7. **相邻未强制点（登记后续）**：`ChapterSummaryRepo.update_status` 仍只做 inclusion 校验、`ReconciliationReportRepo` 有 update_all；不在本 slice 命名 gap 内，未改动。

## 7. 验证命令与结果

```bash
mix compile --warnings-as-errors
mix test                     # 1916 tests, 0 failures
mix format --check-formatted
mix credo --strict
mix dialyzer
mix run scripts/adr_trace.exs
mix run scripts/arch_check.exs
mix xref graph --format cycles --label compile-connected --fail-above 0
bash scripts/quality_manifest_check.sh
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
cd frontend && pnpm typecheck && pnpm lint && pnpm test
PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh p1-chapter-edit-then-accept --surface tauri
bash scripts/ai_static_scan.sh --top 10
```

证据：`artifacts/slice-verify/p1-chapter-edit-then-accept-tauri/summary.json`。

## 8. 决策日志

- **2026-10-23 — CP0 裁决（Q4 默认）**：矩阵下沉 persistence；复活/un-archive 维持 Deferred + trigger，不实现生产入口。
- **2026-10-23 — CP1 实现**：Draft changeset 矩阵校验（含 adopt/discard/supersede changesets）；AdoptionRepository supersede 去 `update_all` 改逐行受校验更新；AdoptionWorkflow 非法转换可解释失败分类（failed action_result + failed_recoverable TurnResult，零原文泄漏）。
- **2026-10-23 — CP2 测试**：draft 矩阵边界 ×6 + workflow 非法转换失败映射 + 既有持久化/采纳测试全绿。
- **2026-10-23 — CP3 验收**：扩展 `p1-chapter-edit-then-accept` driver/verifier/manifest：pending TENTATIVE → resolved EDITED_ACCEPTED 两步留痕、resolved 只含 canon、state trace draft revision ref、合法流程零非法转换拒绝；真实 Tauri 复跑（结果见收口）。
