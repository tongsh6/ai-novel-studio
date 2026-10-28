# B44：摘要与审读报告的持久化转换边界

- 状态：**done（2026-10-28/29：CP0–CP3）**。CP1/CP2：章摘要=ADR-0019 通用矩阵强制，审读报告=A-narrow 维护类生命周期；两 repo 无 `update_all` 绕过。CP3：current-HEAD 真实产品链页面回归 `d3-summary-lazy-repair` + `au13-review-adjudication-roundtrip` 均 PASS（external automation，**surface=browser/driver=headless-chromium**，如实记录；见 §9）。**Residual（不冒充闭环）**：① 两条链尚无 native AX driver，页面证据不是原生；② 单活跃报告替换链（第二次物化→旧 TENTATIVE SUPERSEDED）无现成页面场景。维护类替换语义已由作者 2026-10-29 确认 A，ADR-0019 已追加适用范围补充。
- 登记日期：2026-10-27；来源：`ChapterSummaryRepo` 与 `ReconciliationReportRepo` 仍有 `update_all`，可绕过 changeset 和 ADR-0019 转换矩阵。
- 上游：ADR-0019、[Q1CB](Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md)、[VS-00F](VS-00F-five-ledgers-three-state.md)、[VS-00C](../../docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md)。

## 1. 问题

Draft 的转换矩阵已落地，但相邻对象仍有直接批量更新：

- `ChapterSummaryRepo.supersede_prior_accepted/2` 直接 `update_all(status=SUPERSEDED)`；`update_status/2` 也未经过统一矩阵校验。
- `ReconciliationReportRepo.insert_superseding/1` 直接批量 SUPERSEDED 既有 TENTATIVE 报告。

合法 accepted→superseded 路径本身合法，问题在于仓储边界不能保证其他非法跃迁必被阻止。不能据此宣称已有非法数据，也不能以“调用方当前合法”豁免持久化不变量。逐写点核对见 §6。

## 2. 开工七问

1. **Contract**：ADR-0019 与 `NovelDomain.AdoptionStatus.transition_allowed?/2` 的单一矩阵、章摘要和审读报告 adoption 七态。
2. **Invariant**：仓储入口非法转换必须 changeset error/事务回滚；合法 tentative→accepted、accepted→superseded 不回归；批量操作逐行校验，不用 update_all 绕过。
3. **Boundary**：仅 `novel_persistence` 两个 repo 及必要 domain 纯函数/测试；application 只核对调用方；不改 UI、不重做 Draft、不建第二矩阵。
4. **Consumer**：章摘要维护、审读报告当前态、写作/阅读摘要、Replay 与后续持久化维护者。
5. **Proof**：直接仓储注入非法转换（如非法回到 ACCEPTED）失败且原记录不变；合法 supersede 与历史保留正常；现有摘要/审读测试和 D3/D5/AU13/AU14 场景不回归。
6. **Acceptance Driver**：以 persistence 集成测试为主，并选一条真实摘要/审读页面链证明合法行为未变；产品验收感知逻辑 **no**。
7. **Exploration**：当前 accepted/superseded 摘要与报告可从既有读取面查询；历史状态转换可通过 trace/replay 解释，不新增表。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 核对两个 repo 所有写路径、调用方合法前提与 Q1CB 明示相邻项；确认不扩大为“所有 persistence 都已统一” | **done（2026-10-28，见 §6）** |
| CP1 | 逐行读取→矩阵校验→更新/插入；移除 update_all 绕过；失败事务回滚并保留原值 | **done（2026-10-28）：章摘要 §7 + 审读报告 §8（A-narrow 维护类生命周期）** |
| CP2 | 直接 repo 非法/合法矩阵测试与既有调用回归；审读报告单活跃与历史语义不变 | **done（2026-10-28）：章摘要 §7.2 + 审读报告 §8.3（含事务回滚/stale 拒绝）** |
| CP3 | 与 VS-00F StateTrace 方案对齐但不合并实现；补真实页面合法回归与文档证据 | **done（2026-10-29，browser-surface）**：`d3-summary-lazy-repair` + `au13-review-adjudication-roundtrip` current-HEAD PASS（§9）；native 缺口与单活跃替换缺口如实登记 |

## 4. 非目标

- 不重做 Draft 转换矩阵，不把本任务扩成所有仓储统一改造。
- 不把合法 supersede 当成 bug，不修改历史数据。
- 不新增 UI、卡片或第二套状态机。
- 不把 Q1CB 的其他相邻项（如 revive）提前实现； revive 仍按作者需求触发。
- **不放宽 ADR-0019 通用矩阵来迁就维护类 artifact 替换**：A-narrow 只在 domain 新增维护类生命周期一条边（§6.3 场景 / §8），通用矩阵一字不改。

## 5. 验证与恢复

- 非法转换直接注入 repo 必失败且原记录不变；合法状态迁移无回归。
- 两个 repo 均无 `update_all` 绕过 changeset 的路径；批量更新每行均经矩阵/生命周期校验。
  - 执行口径（2026-10-28）：章摘要侧走 ADR-0019 通用矩阵；审读报告侧走 `MaintenanceArtifactStatus`（通用矩阵 ∪ 维护类替换 `TENTATIVE→SUPERSEDED`），`update_all` 已移除；`update_findings` 由 schema 守卫拒绝 stale 报告翻 ACCEPTED。
- 恢复时先读 Q1CB、ADR-0019、VS-00F StateTrace 任务；后续维护若发现更多同类写点，另行按真实消费者登记，不默认包含在本任务。

## 6. CP0 核对结果（2026-10-28）

### 6.1 章摘要写路径与调用方

| 写路径 | 现状（CP0 时） | 生产调用方与合法前提 | 结论 |
|---|---|---|---|
| `ChapterSummaryRepo.insert/1` | 只 `cast` + `validate_inclusion`；新行可直写除 TENTATIVE 外的任意合法七态（如直接 SUPERSEDED/ACCEPTED） | `ChapterSummaryMaintenance.do_run/4`（经 `NovelApplication.ex` 的 `default_summary_repo`）与 D3 断供补做 `NovelApplication.run_chapter_summary_repair/1` 共用同一 maintenance 路径；插入值恒为 `ChapterSummary.new/1` 产出的 TENTATIVE | 入口可被非法初态绕过，需矩阵守卫 |
| `ChapterSummaryRepo.update_status/2` | 只 `validate_inclusion`：TENTATIVE→任意、ACCEPTED→TENTATIVE 等非法跃迁均可写入 | `ChapterSummaryMaintenance.do_run/4`：`persisted(insert 后为 TENTATIVE)` + `ChapterSummary.accept/1` 产出的 `ACCEPTED`（领域已判合法）；测试直调 | 域层判定不构成持久化保证，需矩阵守卫 |
| `ChapterSummaryRepo.supersede_prior_accepted/2` | `update_all(status=SUPERSEDED)`，绕过 changeset；命中条件 `work_id+chapter_id+status=ACCEPTED`，业务语义本应恒合法（ACCEPTED→SUPERSEDED 在矩阵内） | `ChapterSummaryMaintenance.do_run/4` 在 insert 新 tentative 之前调用；D3 补做同路径 | 业务前置合法，但持久化层无法证明其他写点不会误用；改为逐行 changeset + 事务 |

补充：`chapter_summaries` 表在 `novel_persistence` 内除该 repo 外无写入路径（`ledger_repository.ex` / `reading_projection_repo.ex` / `workspace_context.ex` 只读）；`NovelDomain.ChapterSummary.supersede/1` 生产无调用（仅域测试），故域层不能充当唯一 enforcer。

### 6.2 审读报告写路径与调用方

| 写路径 | 现状（CP0 时） | 生产调用方与合法前提 | 结论 |
|---|---|---|---|
| `ReconciliationReportRepo.insert_superseding/1` | ①先 `update_all` 把本作品此前 **TENTATIVE→SUPERSEDED**；②插入新报告（恒 TENTATIVE） | `NovelApplication.LedgerReconciliationService.materialize/4`（章数节拍触发，`NovelApplication.ex:242`）与 `AgentRunFlows.LedgerReconciliation`（显式发起全书审读，`ledger_reconciliation.ex:266`）经 `persistence_report_repo/0` 端口调用 | ①的转换不在 ADR-0019 通用矩阵内（见 §6.3）；②的 update_all 绕过 changeset |
| `ReconciliationReportRepo.update_findings/3` | 走 `ReconciliationReport.changeset/2`；全裁决时 TENTATIVE→ACCEPTED，否则保持原态 | `LedgerAdjudicationService.adjudicate/2`（作者逐项裁决动作） | 转换在矩阵内（TENTATIVE→ACCEPTED 合法）；schema 无矩阵守卫（当前到达不了非法路径，但缺边界） |

`reconciliation_reports` 表在 `novel_persistence` 内除该 repo 外无写入路径。

### 6.3 维护类 artifact 替换语义（已裁决：作者 2026-10-29 确认 A）

#### 6.3.0 先讲场景（作者视角，非术语）

1. 作者写完第 12 章，系统按「每 10–20 章一次」的节拍跑五本账对账，产出《对账报告》：列出「哪条伏笔可能断了、哪条时间线前后矛盾」等，等作者在审读裁决页逐条处理（保留 / 修订 / 忽略）。报告落盘时是「待处理」。
2. 规矩是「一个作品同时只摊开一份待处理报告」：作者再发起一次全书审读时，系统先把上一份还挂着「待处理」的报告收起来，标成「已被更新版本取代」，再把新报告摊开——作者看到的永远是最新账，旧报告留在历史里可查。2026-07-21 起就是这样跑的，有测试盯着（`reconciliation_report_repo_test.exs`）。
3. 冲突：2026-06-14 冻结的「状态流转规则表」规定「待处理」只能走向「已采纳 / 编辑后采纳 / 丢弃 / 作废」，**不能直接走向「已被取代」**。这张表的原意是防「绕过作者采纳环节直接变成已定稿」；「被取代」原本留给「已经采纳进作品的内容后来被新版本替换」（如旧章摘要被修订版换掉）。
4. 于是 B44 要把「所有状态变化都必须过规则表校验」落到仓储层时发现：照表拦，作者第二次跑对账会失败（不能把待处理报告标成已被取代）→ 单活跃报告机制直接坏；为跑通而放行，则 B44 自己开后门、等于没修。

结论：这不是实现 bug，而是**规则表的适用范围没覆盖维护类产物**。对账报告不是作者采纳进作品的创作内容，而是系统维护产物；「新扫描替换旧扫描」不是一次作者采纳决定。据此分两类处理：
- **采纳类**（章摘要、Draft 等）：沿用原规则表，一字不改；
- **维护类**（对账报告等）：保留原表为底座，只额外明确一条「新扫描把旧的待处理报告标成已被取代，逐行校验」；历史行状态值不变、无数据迁移。

**作者裁决（2026-10-29）：A 可以。** 即「新扫描报告 → 旧待处理报告标为『已被更新版本取代』」保持不变；通用 ADR-0019 矩阵不改，维护类替换作为显式例外登记，ADR-0019 已追加「适用范围补充（2026-10-29，作者确认）」。B 分支不再保留。

**事实（已核对）**：

- ADR-0019 通用矩阵：`TENTATIVE → {ACCEPTED, EDITED_ACCEPTED, DISCARDED, INVALIDATED}`；**不含 SUPERSEDED**。`NovelDomain.AdoptionStatus.transition_allowed?/2` 与 `adoption_status_test.exs`（“TENTATIVE 不能跳过采纳直达 SUPERSEDED”）、`chapter_summary_test.exs`（`TENTATIVE→SUPERSEDED` 返回 `illegal_transition`）均已固化。
- `22-continuity-model.md §21.2` 对 `SUPERSEDED` 的定义是“新版替代旧版、旧版留史”，与审读报告“新扫描报告替换旧 TENTATIVE 报告”的语义吻合；ADR-0019 矩阵从 chapter_summary 采纳链推导，未覆盖维护类替换。
- `ReconciliationReportRepo.insert_superseding/1` 自 VS-00F CP2b（2026-07-21）起使用 TENTATIVE→SUPERSEDED；Q1CB（2026-10-23）只下沉了 Draft/AdoptionRepository，明确把该 repo 登记为相邻未强制点。即这是**既有绕过矩阵的路径**，不是 B44 引入的回归。

**根因（Lead 2026-10-28 校准）**：ADR-0019 管的是 *adoption 转换*；`reconciliation_report` 是 `25 §8.1` 维护 artifact 家族，“新扫描报告替换旧报告”是**维护类替换（maintenance supersede）**，不是作者采纳决策。矩阵未覆盖它是因为矩阵从章摘要采纳链推导而来。

**候选方案与推荐**（Lead 已上报作者，2026-10-28）：

| 选项 | 内容 | 代价/风险 |
|---|---|---|
| **A（Lead 推荐）** | 保留 ADR-0019 通用矩阵不变；为维护类 artifact 建立显式、纯函数、canonical 单表生命周期：允许 `reconciliation_report TENTATIVE→{ACCEPTED, SUPERSEDED, DISCARDED, INVALIDATED}`，report changeset 逐行强制；ADR-0019 仅追加适用范围说明 | 需冻结生命周期表并新增/明确文档落点；历史行状态值不变、无数据迁移 |
| B | 旧报告终态改为矩阵合法的 DISCARDED（TENTATIVE→DISCARDED 合法，单活跃语义保留） | 历史行状态值从 SUPERSEDED 变 DISCARDED，需同步 VS-00F/25 文档语义，可能违反“历史语义不变” |
| C | 报告谱系不进 adoption_status（新增 superseded_by/active 字段） | schema 变更，超出 B44 范围 |
| D | 登记为 repo 例外绕过 | 与 B44 目标相悖 |

**当时 hold 范围（历史记录）**：A-narrow 决策前不修改 `insert_superseding/1` 与 `update_findings/3` 的写路径、不预置 B 的 DISCARDED。**2026-10-28 已解除**：Lead 按 mandate 采用 A-narrow，实现与测试见 §8；本节保留决策前事实作为历史，执行状态以 §8 为准。

### 6.4 不扩大为“所有 persistence 已统一”

CP0 顺带核对 `novel_persistence` 其余 `update_all`，均**不是** adoption 状态转换，不在 B44 范围，本任务不据此宣称“所有 persistence 写点已统一”：

- `memory_log.ex:90` `retention_tier` 降级（Interaction 保留层级；`MemoryItem` 是独立记忆状态机，ADR-0019 明确不覆盖）。
- `work_session_repo.ex:46/226` 会话 active/exit 生命周期。
- `workspace_context.ex:630` `reference_count` 计数自增。
- `agent_run_log.ex:207` agent run 终态/失败标记。

## 7. CP1/CP2 章摘要侧实现与验证（done）

### 7.1 实现（`apps/novel_persistence/**`）

| 文件 | 行为变化 |
|---|---|
| `lib/novel_persistence/status_transition.ex`（新增） | 持久化 changeset 的状态转换守卫（策略由调用方注入）：章摘要注入 `&NovelDomain.AdoptionStatus.transition_allowed?/2`（`kind: "adoption"`）；对账报告注入 `&NovelDomain.MaintenanceArtifactStatus.transition_allowed?/2`（`kind: "maintenance"`）。非法 → `add_error(field, "illegal <kind> transition FROM -> TO")`；同态 no-op 合法、任一态缺席不校验。守卫本身不持有矩阵，矩阵/生命周期仍只来自 domain。 |
| `lib/novel_persistence/schemas/chapter_summary.ex` | `status` 默认 `TENTATIVE`（ADR-0019 初始态）；`changeset/2` 增加 `StatusTransition.validate(:status, attrs, allowed?: &NovelDomain.AdoptionStatus.transition_allowed?/2, kind: "adoption")`。效果：`update_status` 的非法跃迁（如 ACCEPTED→TENTATIVE、TENTATIVE→SUPERSEDED）返回 changeset error，不落库；`insert` 以非初始态非法值（如 SUPERSEDED）落库被拒；首次以 canon 态落库等价 TENTATIVE→canon 第二步（与 Draft 先例一致）。 |
| `lib/novel_persistence/chapter_summary_repo.ex` | `supersede_prior_accepted/2` 删除 `update_all`：事务内 `Repo.all` 命中 ACCEPTED 行 → 逐行 `ChapterSummary.changeset(%{status: SUPERSEDED}) |> Repo.update!()`；任一行失败整批回滚（原值保留）；成功返回同一 `{:ok, count}` 形状，调用方/合法行为不变。`update_status/2` 文档改为矩阵语义（函数体不需改，守卫在 schema）。 |
| `README.md` | 登记 B44 入口（新增文件可追溯）。 |

未改：Draft 矩阵与 `Schemas.Draft`（Q1CB 产物）、`NovelDomain.AdoptionStatus`（矩阵真源，无需改）、任何 UI/application 生产代码。合法路径（maintenance：supersede 旧 ACCEPTED → insert TENTATIVE → update ACCEPTED；D3 补做同路径）逐字节不变。

### 7.2 测试（TDD：先红灯，后绿灯）

新增于 `test/novel_persistence/chapter_summary_repo_test.exs`（`describe "ADR-0019 转换矩阵（B44 持久化边界）"`）：

1. `update_status` 非法 ACCEPTED→TENTATIVE 被拒且原记录不变（changeset error 文本 + `Repo.get!` 仍 ACCEPTED + `current_accepted` 仍命中）。
2. `update_status` 非法 TENTATIVE→SUPERSEDED 被拒（矩阵/域同源反例）。
3. `insert` 以非法非初始态 SUPERSEDED 落库被拒，表内零行。
4. 合法 TENTATIVE→ACCEPTED→SUPERSEDED 经 repo 仍通过。
5. `supersede_prior_accepted` 批量逐行 supersede 全部 ACCEPTED 并计数 2；非 ACCEPTED 的 TENTATIVE 不被触碰；`current_accepted` 清空。
6. 合法维护序列（与 `ChapterSummaryMaintenance.do_run/4` 生产顺序一致）：旧 ACCEPTED → supersede → insert 新 TENTATIVE → update ACCEPTED；`current_accepted`/`list_recent_accepted` 指向新摘要，旧摘要 SUPERSEDED。

红灯证据（实现前）：`10 tests, 3 failures`——两处非法 update 当前成功写库（ACCEPTED→TENTATIVE 实写 TENTATIVE）、非法 SUPERSEDED insert 当前成功落库；失败原因与预期一致（矩阵未强制），非测试写错。
绿灯证据：`mix test apps/novel_persistence/test/novel_persistence/chapter_summary_repo_test.exs` → **11 tests, 0 failures**（含新增合法维护序列用例）。

回归（相关既有测试）：`mix test <chapter_summary_repo/reader/reading_projection_repo/chapter_summary_maintenance/adoption_hook/generator/d3_summary_repair/ledger_maintenance/exploration_service 测试文件>` → persistence **32 tests, 0 failures** + application **50 tests, 0 failures**。审读报告侧改动后的完整回归见 §8.3。

## 8. 审读报告侧：A-narrow 已实现（待作者复核适用范围说明）

### 8.1 决策（作者 2026-10-29 确认 A；Lead 2026-10-28 按 mandate 先行实现）

作者提问被取消期间由 Lead 按 mandate 落 **A-narrow** 结构（未改通用矩阵；仅追加维护类替换）；2026-10-29 作者明确「A 可以」，A 成为作者生效结论（ADR-0019 已追加适用范围补充，B 分支关闭）：

- ADR-0019 管「artifact adoption 转换」；`reconciliation_report` 是 `25 §8.1` 维护 artifact，「新扫描报告替换旧报告」= maintenance replacement，不是作者采纳决策；`22 §21.2` 对 `SUPERSEDED` 的定义（新版替代旧版、旧版留史）正适用。场景化说明见 §6.3.0（Lead 维护）。
- 通用矩阵 `NovelDomain.AdoptionStatus` **一字不改**，既有用户断言不放松。
- 新增 domain 纯函数模块 `NovelDomain.MaintenanceArtifactStatus`：`transition_allowed?/2 = AdoptionStatus.transition_allowed?/2 or replacement_allowed?/2`；`replacement_allowed?/2` 只声明 `TENTATIVE→SUPERSEDED`；导出 `replacement_transitions/0`；moduledoc 写明不是第二套 7 态矩阵、不作用于 Draft/ChapterSummary。
- 对账报告 schema/repo 在持久化边界强制；`update_all` 移除。
- B 分支（旧报告终态 `DISCARDED`）未落；若作者复核改选 B，只需改维护类替换的目标状态/断言（或直接移除替换边走通用矩阵），repo 事务与逐行校验结构不返工。

### 8.2 实现（`apps/novel_domain/**` + `apps/novel_persistence/**`）

| 文件 | 行为变化 |
|---|---|
| `apps/novel_domain/lib/novel_domain/maintenance_artifact_status.ex`（新增） | 维护类生命周期 canonical 单表：`replacement_transitions/0` 只有 `TENTATIVE→SUPERSEDED`；`transition_allowed?/2` = 通用 adoption 矩阵 ∪ 维护类替换；moduledoc 写清边界（非第二矩阵、不作用于 Draft/ChapterSummary、通用矩阵不变、来源 25 §8.1 + 22 §21.2）。 |
| `apps/novel_persistence/lib/novel_persistence/schemas/reconciliation_report.ex` | `adoption_status` 默认 `TENTATIVE`；`changeset/2` 增加 `StatusTransition.validate(:adoption_status, attrs, allowed?: &MaintenanceArtifactStatus.transition_allowed?/2, kind: "maintenance")`。效果：TENTATIVE→SUPERSEDED / TENTATIVE→ACCEPTED 合法；stale（SUPERSEDED/ACCEPTED 等）报告不能翻成 ACCEPTED；ARCHIVED 等非法跃迁被拒（error `illegal maintenance transition FROM -> TO`）。 |
| `apps/novel_persistence/lib/novel_persistence/reconciliation_report_repo.ex` | `insert_superseding/1` 删除 `update_all`：`Ecto.Multi`（事务）内先读本作品 TENTATIVE 报告 → 逐行 changeset 置 SUPERSEDED（逐行校验，非法/失败中止），再 insert 新 TENTATIVE；任一失败整批回滚（旧报告不留半更新）。`{:ok, map}` / `{:error, term()}` 形状与单活跃语义不变。`update_findings/3` 代码不变，经 schema 守卫天然受控：stale 报告返回 `{:error, changeset}`，调用方 `LedgerAdjudicationService` 既有 `with`/`{:error, term()}` 处理可解释（无需改 application 语义）。 |
| `apps/novel_persistence/lib/novel_persistence/schemas/chapter_summary.ex` | 换用同一守卫模块 `StatusTransition`（注入 `AdoptionStatus` 策略），行为与 §7.1 一致；不再有 adoption/maintenance 两份 validator 实现。 |
| `apps/novel_*/README.md` | persistence/domain 目录索引登记新模块/入口（可追溯）。 |

未改：ADR-0019 文本、VS-00F/25 文档、`NovelDomain.AdoptionStatus` 通用矩阵、schema/migration（`adoption_status` 列已有）、历史行数据、UI/application 生产语义。

### 8.3 测试（TDD：先红灯，后绿灯）

domain `apps/novel_domain/test/novel_domain/maintenance_artifact_status_test.exs`（8 tests）：

1. 通用矩阵 `TENTATIVE→SUPERSEDED` 仍非法（防放宽回归）。
2. 维护类策略不放松矩阵外转换（ARCHIVED/DISCARDED/SUPERSEDED→ACCEPTED、ACCEPTED→TENTATIVE、BOGUS）。
3. `replacement_allowed?/2` 只放行 TENTATIVE→SUPERSEDED，其它 from/to 组合拒绝。
4. `replacement_transitions/0` 只有一条 canonical 边，供审计/测试。
5. 统一入口：通用矩阵合法仍合法（采纳/退场/复活/自反）、维护类替换放行、未知/缺失状态仍拒。

repo `apps/novel_persistence/test/novel_persistence/reconciliation_report_repo_test.exs`（含既有 1 项，共 6 tests）：

1. 既有：报告 TENTATIVE 落盘；新报告 SUPERSEDE 旧 TENTATIVE；latest 只回活跃一份（不回归）。
2. 第二次物化：旧报告 SUPERSEDED 留史、新报告 TENTATIVE、latest 单活跃。
3. 多条历史 TENTATIVE 报告逐行 SUPERSEDED（无 `update_all` 绕过）。
4. 非法状态直写被 changeset 拒绝（`illegal maintenance transition TENTATIVE -> ARCHIVED`）且原记录不变。
5. stale（SUPERSEDED）报告不能再被裁决翻成 ACCEPTED（changeset error + 原状态不变）。
6. 事务回滚：新报告 insert 失败时旧报告不得被半 supersede（旧仍 TENTATIVE、latest 不变、零新行）。

红灯证据（实现前）：repo `6 tests, 3 failures` —— changeset 直写非法状态当前 valid、stale 报告当前成功翻 ACCEPTED、insert 失败后旧报告已被 `update_all` 半 supersede；原因与预期一致（无持久化边界校验），非测试写错。domain 侧 `8 tests, 7 failures`（模块不存在）。
绿灯：domain **8 tests, 0 failures**；report repo **6 tests, 0 failures**；chapter summary **11 tests, 0 failures**。

回归（同批）：`mix test <ledger_adjudication_service/ledger_reconciliation_run/ledger_maintenance/d3_summary_repair/chapter_summary_maintenance/chapter_summary_reader/reading_projection_repo 测试文件>` → persistence 22 + application 21 tests, 0 failures。

### 8.4 residual（交作者复核）

- **ADR-0019 适用范围说明已落（作者 2026-10-29 确认 A）**：`docs/design/adr/ADR-0019-adoption-status-transition-v3.md` 追加「适用范围补充（2026-10-29，作者确认）」；通用矩阵不变，B 分支关闭。
- CP3 真实 Tauri 页面证据仍未闭环（§9），不得以本节的 repo 测试冒充页面验收。
- §6.3 的“hold 范围”段落是 A-narrow 决策前的历史记录（Lead 维护区），以 §8.1 决策与本节实现为准。

## 9. CP3 真实页面合法回归（2026-10-29，current-HEAD；browser-surface，如实记录）

**预注册与预算**：`artifacts/b44-cp3/preregistration.json`（范围=两条既有 nightly/tauri 场景；预算=每场景 1200s wall clock、harness wait 360s、同因失败≤2；判据=exit 0 + verdict pass + 关键合法维护/裁决事件；不使用真实模型，不加载语言模型；证据目录 + 失败只读）。执行前备份旧证据 `artifacts/wip-backups/b44-cp3-pre-rerun/`。

**执行（detached nohup + pidfile/exit 记录，轮询读取，不依赖 agent job 生命周期）**

| 场景 | 命令 | HEAD | 结果 | 关键证据 |
|---|---|---|---|---|
| `d3-summary-lazy-repair` | `bash scripts/quality_accept.sh d3-summary-lazy-repair --surface tauri` | `223d9f59` | **PASS**（exit 0，verdict pass，evidence 5/5） | evidence `artifacts/slice-verify/d3-summary-lazy-repair-tauri/`：`key_events` 含 `chapter_summary_repair.run.done`，behavior 断言含 repaired_chapter_id/third_turn；证明 B44 后「旧 ACCEPTED 摘要退场 → 新摘要 TENTATIVE → ACCEPTED + D3 断供惰性补做」合法链未回归 |
| `au13-review-adjudication-roundtrip` | `bash scripts/quality_accept.sh au13-review-adjudication-roundtrip --surface tauri` | `223d9f59` | **PASS**（exit 0，verdict pass，evidence 6/6） | evidence `artifacts/slice-verify/au13-review-adjudication-roundtrip-tauri/`：report 物化 findings=8（arc_stalled×4、premature_finale×1、volume_plan_mismatch×1、volume_blueprint_missing×2），8/8 裁决覆盖 accept_drift/dismiss/revise_design/revise_prose；证明 B44 后报告落盘 + 逐项裁决（TENTATIVE→ACCEPTED）合法链未回归 |

**Surface 如实记录（不冒充原生）**：两次 verdict 均 `surface=browser`、`driver=headless-chromium`、`requested_surface=tauri`、`tauri_window_launched=true`；即外部自动化驱动的是真实产品前端 + 真实 Phoenix 后端的页面链（Tauri dev 窗口已启动），**不是原生 AX 系统驱动**。按项目口径，browser 证据不能签成 native PASS——本 slice 也没有签。

**未闭环缺口（诚实登记）**：

1. 两条链目前没有 native AX/CGEvent 外部驱动（`d3`=聊天+采纳链，`au13`=档案面板+审读卡+8 项处置，后者原生交互成本高）；原生覆盖归后续 native 批次（B61/B62 harness），不以本轮 browser 证据冒充。
2. **单活跃报告替换链没有现成页面场景**：`au13-review-adjudication-roundtrip` 只发起一次全书审读；「第二次物化在旧 TENTATIVE 报告仍活跃时 SUPERSEDE 旧报告」需要扩展场景（同一 seed 连续发起两次审读）。该行为已由 repo 层测试（§8.3 #2/#3/#6）与业务调用方核对证明，页面级未覆盖。
3. 非法转换的真实页面诱导不可行且不必要（正常 UI 只产生合法动作，与 Q1CB 同口径）；非法拒绝证据由 CP2 persistence 测试承担，已在汇总中标注。

**清理**：两轮运行后 `lsof -iTCP:4657 -iTCP:5769` 无监听、无残留 Phoenix/Vite/Tauri 进程；未加载/卸载语言模型（`lms ps` 仅用户既有 embedding IDLE，与本轮无关）。

### 9.1 与 VS-00F StateTrace 的对齐评估（不合并实现）

- 现状：章摘要与审读报告的权威状态变更只有业务日志，没有 StateTrace（VS-00F slice 自身登记“StateTrace 留痕…随维护 trace 债一并补”；既有对账 E10 同口径）。B44 **不实现** StateTrace（非目标，且 VS-00F 无已落地方案可对齐）。
- 本 slice 提供的对齐条件：章摘要全部写路径已集中到 `ChapterSummaryRepo`（insert / update_status / supersede_prior_accepted）且非法转换在 changeset 边界被拒；审读报告裁决后同样收敛到 `ReconciliationReportRepo`（insert_superseding / update_findings）。后续 StateTrace 只需在这两个 repo 的写入口挂时间点，不需要在 application/读取面重复造迹。
- 未合并：B44 不新增 trace 表/事件/字段，不改 replay 契约；若 VS-00F 后续要求摘要/报告变更可 replay，仍由 VS-00F StateTrace 任务承接，其证据不得用本 slice 的 persistence 测试冒充。


## 10. 门禁记录（2026-10-28，本任务实际执行；A-narrow 实现后复跑）

| 命令 | 结果 |
|---|---|
| `mix compile --warnings-as-errors` | PASS（exit 0，零警告；`artifacts/b44/compile-final2.log`） |
| 聚焦测试：domain 维护类生命周期 + 两个 repo | PASS：domain **8** / report repo **6** / chapter summary **11** tests，0 failures；TDD 红灯证据见 §7.2、§8.3 |
| 相关既有回归（摘要/审读链） | PASS：persistence 22 + application 21 tests，0 failures（ledger_adjudication / reconciliation_run / ledger_maintenance / d3_summary_repair / chapter_summary_maintenance / reader / reading_projection） |
| `mix test`（全量 umbrella） | PASS（**2306 tests, 0 failures**；novel_foundation 96 / novel_common 61 / novel_agent 298 / novel_test 1 / novel_domain 390 / novel_persistence 342 / novel_application 984 / novel_web 133 / novel_e2e 1，各 app 均 0 failures；日志 `artifacts/b44/mix-test-final3.log`） |
| `mix xref graph --format cycles --label compile-connected --fail-above 0` | PASS（`No cycles found`，exit 0；`artifacts/b44/xref-cycles-final2.log`） |
| `mix run scripts/arch_check.exs` | PASS（`✅ 架构检查通过`，exit 0；`artifacts/b44/arch-check-final2.log`） |
| `mix format --check-formatted` | PASS（exit 0；`artifacts/b44/format-check-final3.log`） |
| `mix credo --strict`（CI 同款，补充） | PASS（611 files / 10469 mods-funs，found no issues；`artifacts/b44/credo-final2.log`） |
| `mix dialyzer`（CI 同款，补充） | PASS（0 errors；`Multi.run/3` 的 OTP 28 opaque 误报沿用 `work_session_repo.ex` 既有处置 `@dialyzer {:no_opaque, insert_superseding: 1}`，未改变行为；`artifacts/b44/dialyzer-final2.log`） |
| `bash scripts/ai_static_scan.sh --top 10 --quick` | 见 §10.2（A-narrow 后复跑） |

### 10.1 收口补记

- A-narrow 实现后全量复跑：2306 tests, 0 failures（较章摘要侧完成时 +13：domain +8 维护类单测、persistence +5 报告 repo 用例）。命令与完整日志见上表与 `artifacts/b44/`（artifacts 不入 git）。
- 未运行前端门禁（本 slice 未改前端）；I1/I2/I3 scenario invariant driver 未单独执行（本 slice 未触及主链/artifact/TurnResult 语义），但在 §10.2 的 `ai_static_scan.sh --quick` 同批执行中 I1/I2/I3 均 PASS（仅作回归旁证，不作为本 slice 主证明）。
- 未运行真实 Tauri/页面验收（见 §9，未闭环）。
- 静态扫描（AGENTS 要求的 AI 静态扫描闭环）结果与处置见 §10.2。

### 10.2 AI 静态扫描（`bash scripts/ai_static_scan.sh --top 10 --quick`，A-narrow 后复跑）

- 结果：**17 passed / 2 failed / 1 skipped；Findings 5 total, 0 in touched files**（本 slice 改动/新增文件零命中，无需修复项）。
- 2 个失败项均非本 slice 引入、非本写入范围：
  1. `Secret leak scan`（gitleaks）：4 条既有 false_positive/accepted_risk（B63 文档行、`scripts/e2e_01_full_chain_check.sh` spec 标识符、`.pen` fileToken、历史分支外部路径），`artifacts/static-scan/top10.md` 已按既有处置台账登记；本 slice 不重写历史、不改他人扫描处置。
  2. `Task completion manifest and UI evidence check`：`pending`（`artifacts/task-done/<other-run>/manifest.json`，来自并行任务运行产物），非 B44 产物，留给对应任务/Lead 处置；B44 不伪造 manifest PASS。
- 补充：该扫描同批执行并通过 `mix compile --warnings-as-errors`、xref cycle、arch_check、credo、I1/I2/I3 不变量 driver、Sobelow、hex audit、前端 typecheck/lint/design-trace（本 slice 未改前端，仅作回归证据）。
- 原始日志：`artifacts/static-scan/top10.md`（机器产物，不入 git）。

### 10.3 CP3 页面验收记录（2026-10-29）

- 预注册：`artifacts/b44-cp3/preregistration.json`；日志 `artifacts/b44-cp3/d3.log`/`au13.log`（exit 0/0，已读）。
- 场景证据：`artifacts/slice-verify/d3-summary-lazy-repair-tauri/verdict.json|summary.json`、`artifacts/slice-verify/au13-review-adjudication-roundtrip-tauri/verdict.json|summary.json`（HEAD `223d9f59`；surface=browser/driver=headless-chromium 如实记录）。
- 执行完成后资源检查：无 4657/5769 监听、无残留 Tauri/Phoenix/Vite 进程；未使用真实模型。
- 结论边界：本轮页面 PASS 证明“合法行为未变”，不证明非法转换在页面层的拒绝（由 CP2 测试承担），也不代表 native 覆盖。

## 11. 决策与恢复指引

- **2026-10-28 CP0**：确认两 repo 写路径、调用方合法前提；确认章摘要侧无矩阵冲突、审读报告侧 `TENTATIVE→SUPERSEDED` 不在 ADR-0019 通用矩阵，登记为未决契约项（§6.3），Lead 已上报作者。
- **2026-10-28 CP1/CP2 章摘要侧**：新增持久化通用矩阵守卫 + ChapterSummary schema 守卫 + per-row 事务 supersede；TDD 红灯→绿灯；既有摘要链回归全绿。
- **2026-10-28 审读报告侧 A-narrow（Lead mandate）**：作者提问取消后 Lead 定 A-narrow；新增 `NovelDomain.MaintenanceArtifactStatus`（通用 adoption 矩阵 ∪ 维护类替换 `TENTATIVE→SUPERSEDED`，非第二矩阵），报告 schema 守卫 + `Ecto.Multi` 事务逐行 supersede；stale 报告不能再翻 ACCEPTED；TDD 红灯→绿灯。ADR-0019 文本未改，适用范围说明列 residual 待作者复核（§8.4）。
- **residual**：① ADR-0019 适用范围说明待作者复核（若改选 B 按 §8.1 末条处理，不返工）；② CP3 真实 Tauri 页面证据未闭环（§9），不得以 repo 测试冒充页面验收。
- 恢复时先读 §6.3/§8.4；随后执行 `mix test` 全量门禁与 §9 的 Tauri 复跑协调。
