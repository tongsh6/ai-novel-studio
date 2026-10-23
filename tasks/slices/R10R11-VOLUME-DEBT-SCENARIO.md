# R10R11-VOLUME-DEBT-SCENARIO：卷级负债规则正触发真实页面场景

- 状态：**done（2026-10-23；CP1–CP4 全落；真实 Tauri `au13-review-adjudication-roundtrip` 扩展验收 PASS + au14 回归 PASS）**
- 来源：`tasks/slices/B13B-adr-enforcement-reconciliation.md` §4.1 #10；ADR-0028 `## enforcement_gaps`（R10/R11 finding 真实触发验收未做 + au13/au14 断言漂移）
- 设计真源：`docs/design/adr/ADR-0028-volume-structure-and-open-volume-action-v3.md`；`docs/design/contracts/VS-00J-volume-structure-and-blueprint-contract-pack.md` §4 item5 / §9 决策④；`docs/design/acceptance/author/AU-13-ledgers-and-reconciliation.md`
- 类型：质量/审读场景验收（正触发 + 既有场景修复）

---

## 1. 开工七问

1. **Contract**：VS-00J §9 决策④「卷级负债」两条规则——R10 `volume_plan_mismatch`（立项计划卷数 ≠ 事实卷数，`work:planned_volumes=N` / `volumes:actual=M`，`proposed_disposition=revise_design`，事实优先不静默改写任一方、不阻断写作）；R11 `volume_blueprint_missing`（多卷作品逐卷检查 `volumes.blueprint`，缺蓝图→每卷一条 `volume:<title>`，同样只产设计负债）。
2. **Invariant**：卷级负债必须作为设计负债 finding 出现在真实审读报告里（不是静默改写规划/事实）；每条 finding 携带真实 `source_refs`；作者按 `revise_design` 处置后 correction intent 真实回对话流；全部处置后活跃报告清空。
3. **Boundary**：不改规则/服务/UI；本 slice 只改 **验收资产**：`scripts/seed_au13_review_adjudication.exs`（造 planned=4、事实 3 卷、2 卷缺蓝图）、`frontend/slice-verify/external-ui-driver.mjs`、`frontend/slice-verify/native-tauri-verifier.mjs`、`quality/acceptance/scenarios/au13-review-adjudication-roundtrip.yml`。产品代码零改动（R10/R11 已在 `LedgerReconciliation` / `LedgerReconciliationService` 落地）。
4. **Consumer**：真实 Tauri 工作台 → 作品档案「脉络」tab → 「发起全书审读」→ 审读报告卡片 → 处置动作（修订设定）→ correction intent user_message → 对话流 turn_result。
5. **Proof**：真实 Tauri `au13-review-adjudication-roundtrip` 扩展验收（8 处偏离 = 4 停滞 + 1 提前收官 + 1 R10 + 2 R11；三条卷级 finding 的文案/source_refs/处置 + 处置后报告清空 + rail 计数归零）+ 既有单测（`ledger_reconciliation_test` R10/R11）+ au14 回归 PASS。
6. **Acceptance Driver**：外部 Playwright 驱动真实 Tauri 页面（见 CP3）；产品代码零验收感知逻辑。
7. **Exploration**：不适用（质量/审读场景，非要素物化 slice）。

## 2. CP0 场景口径（默认拍板）

B13b §7 未单列 Q10 决策点；按「扩既有审读场景或新增 volume-debt 场景」的建议，选择**扩 `au13-review-adjudication-roundtrip`**：
- 它已是 tauri surface 且走真实「发起全书审读 → 报告 → 逐项处置 → 报告清空」链路，R10/R11 只是同份报告里的设计负债条目 → 复用真实处置链路，避免平行场景。
- 同时满足 B13b「本批修 au13/au14 seed 并复跑」：au13 seed 已由 B13b-C D1 修正为 planned=1；本 slice 把它改成 planned=4 / 事实 3 卷（含 2 缺蓝图），把 R10/R11 从「漂移噪声」变成**正触发断言**。
- au14 seed 已是 `planned_volumes=1`（无 R10/R11 触发条件），只需复跑回归。

## 3. CP1 seed / 场景事实布置

`scripts/seed_au13_review_adjudication.exs`（在既有 4 章计划 + 4 角色 + 4 STALLED 弧光 + 第 1 章正文 + 60000 目标体量之上）：
- `planned_volumes: 4`（意图卷数）。
- 章计划采纳只建规范单卷（事实第 1 卷）；给第 1 卷写卷蓝图（`goal_conflict/arc_stage/climaxes/new_characters`），保证 R11 只命中缺蓝图卷。
- 新建第 2 卷「第二卷：暗流」、第 3 卷「第三卷：收束」（`status=planned`，`blueprint=nil`），并把计划第 3/4 章分到第 2/3 卷（TOC 只渲染有章的卷，事实卷数读端口才=3）。
- 结果：R10 命中 1 条（4≠3）；R11 命中 2 条（第 2/3 卷缺蓝图）；报告共 8 处偏离。

## 4. CP2 driver / verifier / manifest 扩展

**driver（`driveAu13ReviewAdjudicationRoundtrip`）**
- 「8 处偏离」断言；`ledger.report.done` 断言 `finding_count=8`、`rules.volume_plan_mismatch=1`、`rules.volume_blueprint_missing=2`。
- 审读报告卡片断言：R10 卡片可见「立项计划 4 卷，实际已建 3 卷」+ `work:planned_volumes=4`/`volumes:actual=3` source refs + 「不阻断写作」+「修订设定」按钮；R11 两张卡片分别可见卷名与 `volume:<title>` source refs + 「修订设定」按钮。
- 三条卷级 finding 各走一次真实「修订设定」处置：断言 correction intent user_message（含处置措辞与 finding 文案）、真实 turn_result；记录 intent 文本/turn id。
- ADR-0028 gap 原文要求断言 `proposed_disposition`：从真实 `get_review_report` phx_reply 的 findings 数据（不是 UI 按钮文本推断）断言 R10/R11 三条 finding 的 `proposed_disposition === "revise_design"` 且 `source_refs` 精确命中（R10 `work:planned_volumes=4`/`volumes:actual=3`；R11 `volume:第二卷：暗流`/`volume:第三卷：收束`），并写入 ui-state（`volume_report_findings`）。
- 全部处置后：报告清空「暂无待处置的审读报告」+ rail「审读待处置」计数消失（沿用既有断言）。

**verifier（`findAu13ReviewAdjudicationEvidence` / `au13ReviewAdjudicationBehavior`）**
- finder 条件：`review_finding_count>=8`、`adjudicated_count>=8`、`rules.volume_plan_mismatch>=1`、`rules.volume_blueprint_missing>=2`、卷债可见/source_refs 可见/3 条修订设定 intent/3 次处置；`ledger.report.done` 报告同源条件。
- behavior 断言：真实报告产出 R10/R11 设计负债、source_refs 可见、不阻断写作、提供 revise_design、处置回对话流、8 条全部处置后报告清空。

## 5. CP3 真实 Tauri 验收

命令：`PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh au13-review-adjudication-roundtrip --surface tauri`

证据（待收口）：
- 页面：8 处偏离、R10/R11 卡片文案与 source_refs、三条修订设定处置 intent、处置后报告清空。
- app JSONL：`ledger.report.done`（finding_count=8 / rules）、`ledger.adjudicate.done`（8 条，disposition 含 revise_design）、`ledger.dismiss.done`；rail 计数。
- WS 帧：3 条卷债 correction intent user_message + turn_result。
- summary.json：verifier behavior assertions 含 6 条卷债断言（`real_full_review_reported_volume_plan_mismatch_r10`、`real_full_review_reported_multi_volume_missing_blueprint_r11`、`report_cleared_after_all_eight_findings_dispositioned` 等），`log_noise.ok=true`。
- au14 `au14-finding-inventory-arc-loop` 回归 PASS（seed planned=1，无 R10/R11 触发；finding_count=1 断言保持）。

## 6. CP4 回归与诚实边界

- au14 `au14-finding-inventory-arc-loop` 复跑（seed planned=1，不触发 R10/R11；断言 finding_count=1）。
- 诚实边界：
  1. 不改产品代码：R10/R11 规则实现本 slice 前已存在；本 slice 只补真实验收证据与既有场景修复。
  2. 场景通过「分章到多卷」制造事实多卷；不新增用户可见入口。
  3. R10 的「事实优先、不静默改写」只在 finding 文案/不阻断写作层面断言；本 slice 不实现 R10 自动修正（ADR 非目标）。
  4. au13 场景同时承担 VS-00F/VS-00G/VS-00J 三类断言，后续再扩需控制单场景时长。

## 7. 验证命令

```bash
mix compile --warnings-as-errors && mix test
mix credo --strict && mix dialyzer
mix run scripts/arch_check.exs && mix run scripts/adr_trace.exs
bash scripts/quality_manifest_check.sh
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
cd frontend && pnpm typecheck && pnpm lint && pnpm test
PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh au13-review-adjudication-roundtrip --surface tauri
PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh au14-finding-inventory-arc-loop --surface tauri
bash scripts/ai_static_scan.sh --top 10
```

## 8. 决策日志

- **2026-10-23 — CP0 场景口径**：扩 `au13-review-adjudication-roundtrip`（不新增平行场景）；au14 只复跑回归。
- **2026-10-23 — CP1 seed**：planned=4、事实 3 卷（第 1 卷有蓝图、第 2/3 卷缺蓝图）、第 3/4 章分到第 2/3 卷；用真实 `LedgerReconciliationService.scan` 预验证产出 8 findings（4 arc + 1 finale + 1 R10 + 2 R11）。
- **2026-10-23 — CP2 driver/verifier/manifest**：扩展断言与处置链路；产品零改动。
- **2026-10-23 — CP3 复跑修复**：首次复跑暴露 driver 断言 bug——R11 报告 `source_refs` 期望数组未排序而实际做了 `sortStrings`（JavaScrip code-unit 排序下「第三卷」<「第二卷」），断言恒假导致报告生成后第一次处置前失败；修法=期望数组同样 `sortStrings`（不改产品代码）。同时补齐 `proposed_disposition` 报告数据断言、verifier self-test fixture 8 findings/卷债字段、manifest 五→八处偏离残留与 scenarios README 索引行。
