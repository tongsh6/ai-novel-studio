# B47：Canon Freshness 与持久冲突发现

- 状态：**done（2026-10-29，CP0–CP3）**。CP3 真实 Tauri 页面矩阵 `b47-canon-freshness` current-HEAD PASS（stale/conflict 零写入 + fresh 采纳对照；surface=browser 如实，不冒充 native）；残余见 §10（StateTrace、legacy 候选、memory 对象、edit_then_accept、B29 持久层差异）。
- 登记日期：2026-10-27；来源：当前部分安全检查依赖候选预声明 `canon_conflicts`，不能证明系统会从当前持久事实自动发现冲突或过期。
- 2026-10-29 本轮范围：CP0 冻结 + CP1 对象级基线比较/自动 stale 检测 + CP2 采纳重 gate/receipt 前后版本/幂等；**不做**真实 Tauri/长跑/页面矩阵（CP3 交接 Lead）。
- 上游：[AU05-canon-conflict-recovery](AU05-canon-conflict-recovery.md)、[AU05-file-level-closure](AU05-file-level-closure.md)、[B28](B28-whole-chapter-revision.md)、[B29](B29-existing-character-role-revision.md)、[B36](B36-localized-revision-algorithm.md)。

## 1. 问题与目标

当前系统能处理“候选自己声明有冲突”的情况，但真正的持久事实安全还需要：

- 候选与当前 canon 的冲突由系统按真实对象和版本发现，而不是靠模型或候选自报；
- base revision/fingerprint 变化后旧候选被识别为 stale，不得继续写入；
- 覆盖时重新 gate，StateTrace/receipt 能解释来源、前后版本与拒绝原因。

不能把本任务做成一个泛化“canon store”空架构。应按真实对象逐个复用 B28/B29/B36 已证明的 base version/fingerprint/stale 保护。

## 2. 开工七问

1. **Contract**：VS-04 adoption、现有 revision_base/base_ref/fingerprint/stale_base_version、B28/B29/B36 对象版本语义与 AU05 freshness/conflict 场景。先冻哪些对象支持自动冲突发现，不泛化到所有作品事实。
2. **Invariant**：冲突依据来自当前持久事实与版本，不从 LLM 文案猜；stale base 零写入；覆盖重新 gate；StateTrace/receipt 可回放前后版本与原因；候选未授权变更不写 canon。
3. **Boundary**：application AdoptionBoundary/Workflow、domain 纯比较、persistence 当前 canon/版本读取、web/frontend 既有确认与回执。不新建泛化存储。
4. **Consumer**：AdoptionWorkflow、作者覆盖确认、StateTrace/replay 和后续 freshness 检查。
5. **Proof**：持久 canon A 与候选 B 冲突时自动识别→fail_with_recovery 或覆盖确认；stale base 零写入；同 key/版本幂等；前后版本可解释。
6. **Acceptance Driver**：外部驱动真实候选与持久基线变化，在真实页面确认/拒绝/重试；产品验收感知逻辑 **no**。
7. **Exploration**：canon 当前版本、候选 base、stale 原因和前后版本可从 why/replay 查询，不新增固定 prompt packet。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 选择首批真实对象与冲突类型，冻结 base version/fingerprint、自动检测、stale 与重新 gate 语义；确认现有持久源可支持 | **done（2026-10-29，§6；证据=现有代码路径 + 读端口核对）**：首批 O1 章正文修订候选 / O2 角色叙事身份修订候选；不建泛化 store |
| CP1 | 实现对象级基线比较与自动冲突/stale 检测；不从候选自报推断 | **done（2026-10-29，§7）**：domain `CanonFreshness` + persistence `canon_snapshot/2` + application 决策前 gate；38 个新测试（domain 12 / persistence 4 / boundary 7 / adoption 15）；stale/冲突零写入 |
| CP2 | 采纳事务内重新 gate、失败回滚、StateTrace/receipt 前后版本；确认/拒绝幂等 | **done（2026-10-29，§8）**：确认重入重新 gate；持久层错误映射具体 reason code；成功 receipt 前后版本沿用 B28/B36/B29 + additive `canon_freshness`；重放/确认拒绝幂等；失败零写入 |
| CP3 | 真实页面冲突、stale、覆盖确认与恢复矩阵；同步 AU05 freshness/conflict 证据，其他对象按真实消费者扩展 | 交接 Lead（本会话不改 driver/场景/前端；清单见 §11） |

## 4. 非目标

- 不新建泛化 canon store、版本表或第二套事实源。
- 不让模型判断代替持久版本和对象规则。
- 不把 B28/B29/B36 的对象保护复制成互不一致的全局逻辑。
- 不把所有语义冲突都机械判为同一 action；高风险仍按 adoption/confirmation 边界处理。

## 5. 验证与恢复

- 持久基线改变后旧候选 stale，零写入；当前 canon 与候选冲突时系统自行发现，而非候选预声明。
- 合法覆盖重新 gate 并保留前后版本与来源；失败回滚。
- 恢复时先读 B28/B29/B36 和 AU05 freshness；若某对象没有可靠版本语义，先补该对象的 contract，不强行统一。

## 6. CP0：首批对象与版本语义冻结（2026-10-29，先证据后实现）

### 6.1 现状核对（只读；代码路径即证据）

**当前唯一的行为来源是候选自报**：

- `NovelDomain.CandidateSet` 把 `canon_conflicts` 定义为候选可选字段（`apps/novel_domain/lib/novel_domain/candidate_set.ex:13`）。
- `DialogueGateway.candidate_direction_to_boundary_candidate/1` 从 source `turn_result.candidate_directions[]` 原样透传 `canon_conflicts`（`apps/novel_application/lib/novel_application/dialogue_gateway.ex:895-906`）。
- `AdoptionBoundary` 只在候选 map 自带非空 `canon_conflicts` 时返回 `fail_with_recovery`（`apps/novel_application/lib/novel_application/adoption_boundary.ex:147-166`，判定在 `:295-303`）。
  → 候选/模型不报 = 系统不查；冲突依据不是持久事实。

**artifact 采纳前置检查不读持久版本**：

- `AdoptionWorkflow.handle_adopt` 的决策链是 `find_pending_artifact → validate_work_boundary → check_current_pending → check_revision_base → AdoptionBoundary.evaluate → finalize_adoption`（`apps/novel_application/lib/novel_application/adoption_workflow.ex:63-95`）。
- `check_revision_base/2` 只比较 artifact 顶层 `revision_base` 与请求 `params["base_revision"]`（`adoption_workflow.ex:484-497`）；两值均来自客户端/候选载荷，**不读持久事实**，且 B28/B36 修订候选的该字段实际为空（修订基线在 payload scope 内）。
- 持久化失败统一降级为 `adoption_persistence_failed`（`adoption_workflow.ex:1138-1152`），作者看不到 stale/冲突/越界等具体拒绝原因，也没有前后版本回执。

**已有可靠版本语义，可直接复用的对象保护（非目标：不重造）**：

| 对象 | 版本事实 | 事务内重校验位置 | 现有错误码 |
|---|---|---|---|
| 章正文 replace_scope（B28） | 当前 accepted draft `draft:<id>:<revision>` + `covered`/`expected_base_versions` | `AdoptionRepository.persist_replace_scope`（`apps/novel_persistence/lib/novel_persistence/adoption_repository.ex:883-916`）、`ensure_complete_cover`（`:2456-2481`） | `stale_base_version` / `incomplete_scope` |
| 章正文 replace_segments（B36） | `covered`/`base_versions`/`expected_segment_hashes` | `persist_replace_segments`（`:628-712`） | `stale_base_version` / `segment_mismatch` / `incomplete_scope` |
| 章正文 format_paragraphs（ADR-0029） | `covered`/`expected_base_versions`/`source_hash` | `persist_formatting_plan` 事务内重读 canon 并 `ProseFormatting.apply_plan`（`:549-608`） | `stale_base_version` / `format_only_violation` |
| 角色叙事身份（B29） | 整对象 fingerprint + 字段 old 值 | `revise_character_narrative_role/5`（`:1599-1700`，指纹 `:1698-1714`） | `stale_base` |

**当前 canon 读端口已存在，无需新表/第二事实源**：

- 章：`AdoptionRepository.accepted_chapter_scopes/2`（`:2132-2151`）返回 `chapter_ref` + 按 scene seq 的 `scopes[draft_id, revision, content]`；即候选生成用的同一来源（`AdoptionWorkflow.chapter_revision_context/2`，`adoption_workflow.ex:560-600`）。
- 角色：`AdoptionRepository.character_profile_context/2`（`:1540-1586`）返回 `character_ref/base_fingerprint/narrative_role`；fingerprint 口径 `:1698-1714`。
- 阅读/投影/摘要消费端（`ReadingProjectionRepo.chapter_facts/1` `:205-295`、`chapter_summary_revision_base`）已经以 `draft:<id>:<revision>` / `revision_base` 形式消费同一版本事实。

**本批不选的对象与理由（不硬做）**：

| 对象 | 不选理由 |
|---|---|
| confirmed memory / world_setting 等记忆型设定 | 只有 `source_ref`/`revision_of`/状态链，没有对象级单调 revision 或内容指纹；冲突只能靠 LLM/相似度猜 ⇒ 违反 Invariant，先不纳入自动检测（未来若补该对象 contract 再扩）。 |
| 章节结构 change plan / renumber（B30） | 有 `base_versions` 但对象是结构 mapping 而非 canon 文本，消费者是结构维护 renumber 事务（已有 `validate_renumber_base`，`:2012-2015`），不属于「正文/角色 canon 冲突」首批闭环。 |
| chapter_summary | 有 `revision_base`（`schemas/chapter_summary.ex`），但**没有作者采纳入口**：摘要由 `ChapterSummaryMaintenance` 在正文采纳后自动生成/接受（`apps/novel_application/lib/novel_application/chapter_summary_maintenance.ex`）。其 freshness 是派生/消费端问题（fact_inventory/阅读投影），不是本批「候选采纳重新 gate」；不把 maintenance 包装成假采纳事务。 |
| creative_direction / 「设为后续方向」 | selection ≠ adoption，不写 canon（AU05 既有证据）；候选自报 `canon_conflicts` 的 legacy gate 保留不动。 |

### 6.2 首批对象（2 类，均有真实消费者与持久版本语义）

**O1 章正文修订候选（prose_fragment，携带 B28/B36/ADR-0029 基线声明）**

- 身份：`chapter_ref`（持久 chapter id，非 title）。
- 候选基线（产品生成候选时从持久 canon 填充，不是模型文本）：`covered` / `base_versions` / `expected_base_versions` 的 `draft:<id>:<revision>` 集合；`format_paragraphs` 另含 `source_hash`（base 正文 sha256）。
- 当前 canon：`accepted_chapter_scopes/2` 的当前 accepted draft 集合（同一来源）。
- 版本单位：每个 accepted prose draft 的单调 `revision`（Ecto `optimistic_lock`，`schemas/draft.ex`）；format plan 追加 base 正文内容 hash。
- 冲突/过期类型：缺 draft/版本变化 → **stale_base_version**；当前 canon 出现候选未覆盖的 accepted 片段（候选 coverage 前提失效）→ **canon 冲突（incomplete_scope）**；`source_hash` 与当前 base 正文不一致 → **canon 冲突（内容已变）**。
- 消费者：真实工作台「保存到作品」采纳链（`AdoptionWorkflow.handle_adopt` + `AdoptionRepository.persist`）、B28/B36 修订场景、阅读/摘要/检索。

**O2 角色叙事身份修订候选（character_profile_revision，B29）**

- 身份：`character_ref`（持久 character id）。
- 候选基线：`base_fingerprint` + `changes[0].old`（旧 narrative_role）。
- 当前 canon：`character_profile_context/2` 的 `base_fingerprint` + `narrative_role`。
- 版本单位：整对象 fingerprint（id+name+aliases+narrative_role+role+summary+status+updated_at 的 sha256）+ 被改字段旧值。
- 冲突/过期类型：fingerprint 变化 → **stale_base**；当前 narrative_role ≠ 候选 old（候选前提被相反/不同事实取代）→ **canon 冲突**。
- 消费者：真实工作台角色修订候选采纳（B29 原生/浏览器场景）、角色档案/roster/判断上下文。

### 6.3 冻结契约（本批不可放宽）

1. **领域判定**：`NovelDomain.CanonFreshness.assess(object, declared, current)` 为纯函数；输入只接受结构化基线/版本事实，不接受 LLM 文案、候选自报 `canon_conflicts` 或相似度。输出 `%{object, status, reason_codes, expected, current}`：
   - `status: :fresh | :stale | :conflict`；`reason_codes` 见 6.4。
2. **当前 canon 读取**：只在 persistence 读端口 `AdoptionRepository.canon_snapshot/2`（`{:chapter_prose, chapter_ref}` / `{:character_profile, character_ref}`），application 经注入端口 `NovelApplication.persistence_canon_reader/0` 消费；不新建表/不复制事实。
3. **边界 gate 顺序**：`missing_candidate → work_boundary → stability → contract_rejection → canon_freshness → legacy candidate self-report canon_conflicts → overwrite/high-risk/meta/duplicate`。系统计算的 freshness 优先于候选自报；legacy 自报路径保留（方向候选不写 canon）。
4. **决策映射**：`stale/conflict/missing/unavailable` 一律 `fail_with_recovery`（本轮不做自动覆盖：基线已变时确认也不能证明作者看到的是同一基准）；`fresh` 才继续既有 overwrite/high-risk confirmation 路径。契约错误（target_missing/unsupported_field/format_only_violation 等）同样在决策前 `fail_with_recovery`，不再落到持久化后才泛化失败。
5. **stale base 零写入**：边界拒绝发生在 `persist_adoption` 之前（不调用 writer）；持久化事务内 B28/B36/B29 现有重校验保留为最终防线（TOCTOU），其错误按 6.4 映射为具体 reason code，仍零写入（Ecto.Multi 回滚，B35/B36/B29 既有测试）。
6. **回执/留痕（沿用现有通道，不新建 StateTrace 表）**：
   - 成功：沿用 B28/B36/B29 receipt 的 `covered_refs` / `superseded_draft_refs`（前）与 `source_revision_ref`（后）、`base_fingerprint` / `current_fingerprint`；action_result 追加 `canon_freshness`（采纳时校验过的 expected/current）。
   - 拒绝：action_result 追加 `canon_freshness`（expected/current）+ decision reason codes；TurnResult `trace_summary` 追加同结构（可随既有 transcript/trace 回放）；`LogEmit` adoption 日志只进 developer 字段。
7. **幂等**：同一候选/版本成功采纳后重放 → 当前 canon 已变 ⇒ stale 拒绝且零写入（不重复写、不重复报 accepted）；角色修订持久层 duplicate 回执保留；channel 既有 idempotency receipt / pending 可用性检查不重复实现。
8. **未授权变更不写 canon**：契约白名单校验（B29 `unsupported_field/unsupported_effect/invalid_character_role`、B28 effect 白名单、B36 目标段边界）在决策前先跑一次，持久化事务内再跑一次。

### 6.4 冻结词汇

| 场景 | reason_codes（decision/action_result/trace_summary） |
|---|---|
| 章基线版本变化/缺失 draft | `stale_base_version`, `candidate_base_outdated` |
| 章当前 canon 多出未覆盖 accepted 片段 | `canon_conflict_detected`, `incomplete_scope`, `canon_changed_after_candidate` |
| format plan base 内容 hash 变化 | `canon_conflict_detected`, `canon_content_changed` |
| 角色 fingerprint 变化 | `stale_base`, `candidate_base_outdated` |
| 角色当前值与候选 old 矛盾 | `canon_conflict_detected`, `persisted_canon_differs` |
| 目标缺失/歧义 | `target_missing` / `target_ambiguous` |
| 读端口不可用 | `canon_freshness_unavailable` |
| 契约拒绝 | `target_missing` / `unsupported_field` / `unsupported_effect` / `invalid_character_role` / `format_only_violation` / `incomplete_scope` 等既有码 |
| `fail_with_recovery` 统一附加 | `conflict_recovery_required`（stale/conflict 类） |

### 6.5 开工七问（逐条回答）

1. **Contract**：VS-04 §4 Required gate facts 的 `freshness` + `conflict check`（`docs/design/contracts/VS-04-adoption-boundary-contract-pack.md`）、ADR-0010（State/Adoption boundary）、ADR-0019（canon 状态与 INV-1/2）、B28 §7.2 Q01/Q05、B29 §6.2 Q02/Q05、B36 §2 不可变量与 ADR-0029；新增仅 additive：`NovelDomain.CanonFreshness` + `AdoptionRepository.canon_snapshot/2` + `AdoptionWorkflow` 决策 opts/回执字段，不改 schema/enum/DB。
2. **Invariant**：冲突/stale 依据必须来自当前持久 canon 与版本（候选 payload 由产品从 canon 填充，非模型文案）；stale/conflict 零写入；覆盖必须先重新 gate，确认后仍以事务内重校验为准；回执可解释前/后版本与拒绝原因；候选未授权变更（字段/范围/效果白名单）不写 canon。
3. **Boundary**：`novel_domain`（纯判定）、`novel_application`（AdoptionWorkflow/AdoptionBoundary 编排 + 注入读端口）、`novel_persistence`（只加当前 canon 读函数，无迁移/写模型变更）；不改 `novel_web`/`frontend`/`novel_agent`；不新建 canon store/版本表/第二事实源。
4. **Consumer**：真实工作台「保存到作品」采纳入口（`author_action accept` / socket `adopt`）→ AdoptionWorkflow → AdoptionBoundary → AdoptionRepository.persist；回执经既有 `action_result` + TurnResult 广播，作者可见失败文案；后续 freshness 检查（B28/B29/B36 场景、阅读/摘要消费）复用同一 version 来源。
5. **Proof**：直接用例（持久 canon A 与候选 B 冲突 → fail_with_recovery；stale base → 零写入；同候选/版本重放 → stale 零写入；前后版本可解释；未授权变更 → 零写入）+ 既有 summary/character/draft/adoption 回归 + 门禁（compile/xref/arch/format/全量 mix test/I1–I3 若触及主链）。
6. **Acceptance Driver**：CP3 由 Lead 在真实 Tauri 工作台扩展 AU05/B28/B29 场景（持久 canon 先变更 → 旧候选采纳 → 作者看到 stale/冲突失败 → 重新生成/确认路径）；产品代码新增验收感知逻辑：**no**（本批只读持久事实，无 slice id/env/query/DOM hook）。
7. **Exploration**：本批不新增要素/数据、不新增 prompt packet；当前 canon 版本经既有读端口进入产品判定与回执，模型仍只消费既有判断/写作材料；非要素物化、不涉及模型作品知识获取 ⇒ 大多数语义不适用；freshness 依据不新增模型探索面。

### 6.6 CP0 结论

- 首批对象 = O1 章正文修订候选 + O2 角色叙事身份修订候选；两者已有可靠、单调、可持久复算的版本语义与真实消费者。
- 现状缺口 = 「决策前的系统自动 stale/冲突判定 + 具体拒绝原因/前后版本回执」；持久化事务内已有保护是最终防线，不复制成第二套规则。
- 不选对象（记忆设定/结构 plan/chapter_summary/方向候选）已在 6.1 登记理由；其中 `chapter_summary` 若未来需要消费端 freshness，按对象单独补 contract，不并入本批。

## 7. CP1 实施记录（2026-10-29）

### 7.1 改动文件与行为

| 文件 | 行为 |
|---|---|
| `apps/novel_domain/lib/novel_domain/canon_freshness.ex`（新增） | 纯函数 `assess/3`（`:chapter_prose` / `:character_profile`）+ `missing/3` + `unavailable/2` + `fresh?/1`。只用结构化基线/当前版本事实，输出 `%{object, status(:fresh/:stale/:conflict/:missing/:unavailable), reason_codes, expected, current}`；未知对象返回 `{:error, :unsupported_canon_object}`，不猜测。 |
| `apps/novel_persistence/lib/novel_persistence/adoption_repository.ex` | 新增只读 `canon_snapshot/2`：`{:chapter_prose, chapter_ref}` 复用 `accepted_chapter_scopes/2`（当前 accepted `draft:<id>:<revision>` + base 正文 sha256）；`{:character_profile, character_ref}` 复用 `character_profile_context/2`（`base_fingerprint` + `narrative_role`）。零 schema/迁移/写模型变更。 |
| `apps/novel_application/lib/novel_application.ex` | 新增 `persistence_canon_reader/0`（未启用真实持久化时为 nil，不伪造版本）。 |
| `apps/novel_application/lib/novel_application/adoption_workflow.ex` | `handle_adopt` 增第 7 个可注入参数 `canon_reader`；决策前由 application 从 artifact payload 抽取**产品生成时记录的基线**（B28 `covered/expected_base_versions`、B36 `covered/base_versions`、ADR-0029 `source_hash`、B29 `base_fingerprint`+旧值），读持久 canon 后调 `CanonFreshness.assess/3`，把 verdict/契约结果放进边界 opts。legacy 无基线候选返回 nil，不引入误判。 |
| `apps/novel_application/lib/novel_application/adoption_boundary.ex` | gate 顺序新增 `adoption_contract_decision` + `canon_freshness_decision`（在 legacy 自报 `canon_conflicts`、overwrite/high-risk 之前）：`stale/conflict/missing/unavailable` → `fail_with_recovery`，reason codes 来自系统判定；契约错误用既有稳定错误码。 |

### 7.2 语义要点

- 冲突依据 = 当前持久 canon 版本 vs 候选生成时产品填充的基线；**不读取**候选 `canon_conflicts`、LLM 文案或相似度。
- 章正文 stale：候选覆盖的 `draft:<id>` 缺失/版本不符/当前章无 accepted 正文 → `stale_base_version`；当前 canon 多出候选未覆盖 accepted 片段（coverage 前提失效）→ `canon_conflict_detected` + `incomplete_scope`；format plan `source_hash` 与当前 base 内容 hash 不符 → `canon_conflict_detected` + `canon_content_changed`。
- 角色 stale：fingerprint 变化（对象在别处被更新）；冲突：当前 `narrative_role` 与候选 `old` 矛盾（`persisted_canon_differs`）。
- 边界判定只消费持久事实，不写库；`fresh` 才继续既有 overwrite/high-risk confirmation 路径。

### 7.3 测试（TDD：先红后绿）

- `apps/novel_domain/test/novel_domain/canon_freshness_test.exs`（12）：fresh/stale/版本淘汰/canon 缺失/多片段冲突/内容 hash 冲突/角色 fresh/fingerprint stale/值冲突/missing/未知对象。
- `apps/novel_persistence/test/novel_persistence/b47_canon_freshness_read_test.exs`（4）：章快照 versions+digest 与 accepted 稿一致且排除历史稿；角色快照 fingerprint 随字段更新变化；target_missing/cross_work_scope/unsupported_canon_object。
- `apps/novel_application/test/novel_application/adoption_boundary_test.exs`（+8）：系统 stale/conflict/missing/unavailable → `fail_with_recovery` 且先于高风险确认；fresh 时 legacy 自报仍生效；契约错误映射。
- `apps/novel_application/test/novel_application/b47_canon_freshness_adoption_test.exs`（新增 15）：真实 SQLite canon A vs 候选 B（stale/conflict/角色冲突/角色 stale/fingerprint 过期）；stale/冲突零写入；fresh 采纳成功；receipt 前后版本；TOCTOU 事务重 gate；未授权变更；重放幂等；覆盖确认重新 gate；确认拒绝幂等；legacy 无误判。

## 8. CP2 实施记录（2026-10-29）

### 8.1 采纳事务内重新 gate 与失败回滚

- 决策前 re-gate：application 每次 `handle_adopt` 都重新读持久 canon（包括 `confirmation_satisfied: true` 的确认重入），基线与确认时点不一致 → `fail_with_recovery`，不进入 writer。
- 事务内 re-gate（复用，不重造）：B28 `validate_expected_versions`/`ensure_complete_cover`、B36 `expected_segment_hashes`/版本、ADR-0029 `apply_plan(source_hash)`、B29 fingerprint 校验仍在 `Ecto.Multi` 写前执行；失败整体回滚零写入（B35/B36/B29 既有测试 + 本轮 TOCTOU 用例）。
- 失败原因结构化：`classify_persistence_failure/1` 把持久层 `:stale_base_version`/`:stale_base`/`:segment_mismatch`/`:incomplete_scope`/`:out_of_scope_changes`/`:format_only_violation`/`:target_missing`/白名单错误映射为稳定 reason code，不再一律 `adoption_persistence_failed`；作者可见文案按原因说明「已过期/冲突/范围不一致/契约不允许/目标缺失，未写入」。

### 8.2 StateTrace / receipt（复用既有通道，不新建表）

- 成功回执沿用 B28/B36/B29 既有字段：`covered_refs` / `superseded_draft_refs`（前）、`source_revision_ref`（后）、`base_fingerprint` / `current_fingerprint`、`committed_changes`、`segment_changes`。
- 本轮追加 additive 回执：`action_result.canon_freshness`（expected/current/status/reason_codes）与 TurnResult `trace_summary.canon_freshness`；拒绝时 decision/truthfulness reason codes 含系统判定码；`LogEmit.emit(:adoption, :persist, :error, %{canonical_versions: ...})` 只进 developer 日志。TurnResult 随既有 transcript/trace 通道可回放。
- **不伪称 StateTrace 已实现**：本批没有新增持久 StateTrace 表/记录；失败拒绝的可回放证据 = 既有 TurnResult/trace_summary + action_result + 业务日志。该缺口已在 §10 登记。
- 角色 B29 `old_role` 兼容 fallback 保留不动（既有事务语义），但边界 freshness 对 fingerprint 变化按 B47 严格 fail（不让旧候选借 fallback 静默写入）；需要产品裁决是否统一收紧持久层 fallback —— 见 §10 待裁决。

### 8.3 幂等

- 同一候选/版本成功采纳后重放：当前 canon 已变 → 边界 `stale` 拒绝、零写入、不二次报 accepted（用例覆盖）。
- 角色修订持久层 duplicate 回执保留（B29 既有）。
- channel 既有 `AuthorActionReceiptRepo` / pending 可用性检查未重复实现；本批只加对象级 freshness 闸，不新建第二套 idempotency key 表。
- 确认拒绝重复调用只关闭确认，不改作品事实（用例覆盖）。

## 9. 验证记录（2026-10-29，本会话执行）

| 命令 | 结果 |
|---|---|
| `mix compile --warnings-as-errors`（根目录） | pass（0 warning） |
| `mix format --check-formatted`（根目录） | pass |
| `mix xref graph --format cycles --label compile-connected --fail-above 0` | `No cycles found` |
| `MIX_ENV=test mix run scripts/arch_check.exs` | `✅ 架构检查通过`（dev 环境并行 4000 端口占用，改用 CI 同款 test env；未改脚本） |
| `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs` | `[I3] Layer-B cases=3 pass=3 fail=0 ...` |
| `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs` | `[I1] cases=4 pass=4 fail=0 ...` |
| `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs` | `[I2] cases=3 pairs=3 disjoint=3 violations=0` |
| `mix test`（根目录，`MIX_TEST_PARTITION=b47` 隔离测试库） | **2344 tests, 0 failures**（foundation 96 / common 61 / agent 298 / test 1 / domain 402 / persistence 346 / application 1006 / web 133 / e2e 1） |
| 聚焦回归（`MIX_TEST_PARTITION=b47`） | application 110/0（adoption 全链+B47）；persistence 50/0（B28/B35/B36/B29/summary/projection/B47 读端口） |
| `MIX_ENV=test MIX_TEST_PARTITION=b47cp3seed mix run scripts/seed_b47_canon_freshness.exs` | pass：`ok works=3`；三作品 self_check ok（stale/conflict/fresh 判定与 expected/current 版本）|
| `MIX_ENV=test MIX_TEST_PARTITION=b47cp3seed mix run scripts/seed_b47_canon_freshness.exs -- --check` | pass：`check_ok=true`（seed 后、UI 采纳前）|
| 应用采纳链模拟（临时脚本，真实 `AdoptionWorkflow.handle_adopt` + 真实持久化 + 真实 `canon_snapshot/2`） | pass：stale/conflict → `fail_with_recovery` + canon_freshness=stale/conflict + DB/阅读零写入；fresh → accepted + 旧稿 SUPERSEDED + 新稿 sha=候选 sha + mutation+1。证据 `artifacts/b47-cp3-seed/app-chain-verify.log` |
| `quality/acceptance/scenarios/b47-canon-freshness.yml` 结构校验（PyYAML + canonical evidence kind/tier/surface/anti_hooks） | pass；`quality_manifest_check.sh` 目前唯一报错为「manifest 未注册」，注册归 Lead |
| `mix credo --strict` | 本批改动 0 finding；全仓剩 1 条既有重构提示在 `apps/novel_agent/test/support/provider/slice_verify.ex`（Lead B40 改动文件，不在本批范围） |

> 环境说明：共享 `/tmp/ai_novel_studio_test.sqlite3` 存在历史非沙箱残留行（Mutation/Work 各 1），会让「全表计数」型旧用例（如 `b28_replace_scope_test` 的 Mutation count）失败；本轮用 `MIX_TEST_PARTITION=b47` 新建隔离测试库复跑，未清理共享库、未改旧用例，避免影响并行验收。

### 9.1 CP3 真实页面矩阵执行记录（2026-10-29，Lead）

**预注册**：`artifacts/b47-cp3/preregistration.json`（范围=三作品矩阵；预算=harness 600s / wall 1800s / 同因≤2；判据=exit 0 + verdict pass + summary/behavior 覆盖 stale/conflict 零写入与 fresh 采纳；不使用真实模型）。

| 步骤 | 内容 |
|---|---|
| seed | `scripts/seed_b47_canon_freshness.exs`（runner 在 reset_test_db 后执行）→ 三作品 stale/conflict/fresh，每作品 1 章真实持久 canon + 产品同形 pending 正文修订候选；seed.log 每作品一行 JSON + 汇总（数据库路径、declared/current versions、drafts 快照、expected_after_adoption 等） |
| driver | `frontend/slice-verify/external-ui-driver.mjs` 新增 `driveB47CanonFreshness`：从 seed.log 解析当次 work_id/标题/artifact_id，真实作品菜单切三个作品、点「保存为章节正文」；采集 author_action/action_result/turn_result 关键字段、可见文案、node:sqlite 只读 DB 前后快照、fresh 阅读模式可见正文；写 `persistence-snapshots.json` |
| verifier | `findB47CanonFreshnessEvidence` + `b47CanonFreshnessBehavior`：stale/conflict 需 action_result.status=failed + decision=fail_with_recovery + canon_freshness.status∈{stale,conflict} + reason codes + expected/current 版本 + turn_result.failed_recoverable + production_write_performed=false + DB 前后 drafts/mutation 完全一致；fresh 需 accepted/adopt_tentative/fresh + 旧 accepted 全部 SUPERSEDED（按 draft_id 匹配 revision 递增）+ 唯一新 ACCEPTED sha=候选 sha + mutation+1 + 阅读模式可见候选正文 |
| 注册 | `quality/acceptance/scenarios.yml`（active）、`scenarios/b47-canon-freshness.yml`、`scripts/tauri_slice_verify.sh`（--list/seed case/描述/600s 等待窗/allowlist）、`scripts/README`、`quality/acceptance/scenarios/README` |

**执行结果**（`bash scripts/quality_accept.sh b47-canon-freshness --surface tauri`）：

- 最终通过（run4）：exit 0，verdict `status=pass`，evidence **8/8**（screenshot/websocket_frames/app_jsonl/turn_result/action_result/seed_log/summary_json/persistence_snapshot）；`surface=browser`、`driver=headless-chromium`、`git_head=4b25d728`（运行时 HEAD；如实记录，不冒充 native）。
- 首轮失败与根因（保留只读）：run1 action_result 匹配用 `action_type=accept`，实际采纳帧为 `action_type=adopt`+artifact_id → 改按 artifact_id 匹配；run2 等待 `channel.user_message.done`，纯采纳动作只有 `channel.author_action.done` → 改匹配 author_action 完成日志；run3 阅读模式短 sleep 抢拍 → 与 p1-chapter-adoption-reading 同口径等待「阅读模式/全书有效字数/本章有效字数」再快照。均为 driver/verifier 断言与当前生产链的偏差，不是产品缺陷；每次按失败类型修复后 scoped 复跑，未放宽产品判据。
- 证据：`artifacts/slice-verify/b47-canon-freshness-tauri/{verdict.json,summary.json,persistence-snapshots.json,seed.log,ui-frames.json,ui-state.json,*.png}`；日志 `artifacts/b47-cp3/run*.log`。
- 最终门禁复核（HEAD `11bc3530`）：`mix dialyzer` 0 errors（本批修正 `declared_version_entry`/`canon_freshness_opt` 的死分支与 guard 告警）；scoped re-run `b47-canon-freshness` PASS 29s、`au12-correction-intent-roundtrip` PASS 18s（内容/证据见 `artifacts/final-20261029/results.jsonl`）；`mix test` 全量 2344/0、`credo --strict` no issues、I1/I2/I3 PASS。
- 运行后资源清理：4657/5769 无监听、无残留 Tauri/Phoenix/Vite；未加载/卸载语言模型（deterministic provider）。共享 test DB 在最终门禁前已 drop/create/migrate 重建，避免本轮 seed 残留影响全表计数型旧用例。

## 10. 残余 / known-gap（不伪称完成）

1. **CP3 已闭环（2026-10-29）**：`b47-canon-freshness` current-HEAD PASS，见 §9.1；`surface=browser/driver=headless-chromium` 如实记录，native 系统级覆盖不在本 slice 声明。
2. **无持久 StateTrace 新表**：失败拒绝的可回放证据是既有 TurnResult `trace_summary`/`action_result`/业务日志；成功前后版本仍在既有 receipt 字段。不宣称 StateTrace 已实现。
3. **legacy 候选无基线元数据**（历史 prose append/overwrite 候选、旧 memory 型设定）：`canon_freshness_verdict` 返回 nil，保持既有 overwrite/high-risk 确认与持久化事务行为；不伪造 stale 判定。若需要，按对象补 contract 后扩第二批。
4. **memory/confirmed 设定对象未纳入自动冲突**：无可靠对象级 revision/fingerprint（只有 source_ref/状态链），沿用 AU05 候选自报 `canon_conflicts` legacy gate；新增自动检测需要先补该对象 contract（非本批泛化）。
5. **`edit_then_accept`（modify_draft）路径未做决策前 freshness 预检**：其持久化事务仍会重校验并零写入（B28/B36 既有），但失败仍走 `{:error, reason}` 局部错误，不产生带 `canon_freshness` 的 TurnResult；登记为下一 checkpoint 候选。
6. **B29 持久层 `old_role` fallback 与边界 strict 的差异**：采纳路径现由边界 freshness 严格拒绝 fingerprint 变化（B47 Invariant）；持久层 `validate_character_fingerprint/3` 在 `old_role` 等于当前值时仍放行。是否统一收紧持久层属产品裁决，未在本批擅自改动既有守卫。
7. **format plan digest 与持久层 join 语义**：`canon_snapshot` 的 base 正文按 `accepted_chapter_scopes/2`（scene seq 升序、空片段剔除、`\n\n` 连接）复算；与 `chapter_revision_context/2`、`persist_formatting_plan` 当前实现一致，但三处依赖同一约定，后续抽公共纯函数时需保持。

## 11. CP3 执行记录与交接清单（2026-10-29，Lead 已执行）

> 2026-10-29 Lead 已按本清单完成 driver/verifier/runner/注册并取得 current-HEAD PASS；下述内容保留为交接历史与实现依据。

### 11.1 本批已交付给 CP3 的文件

| 文件 | 说明 |
|---|---|
| `scripts/seed_b47_canon_freshness.exs`（新增） | 单 seed 构造 stale / conflict / fresh 三作品的真实持久 canon + 待采纳候选；支持 `--check` 复验 |
| `quality/acceptance/scenarios/b47-canon-freshness.yml`（新增） | 一个合并场景 manifest（stale+conflict+fresh 对照矩阵，surface=tauri，runner 推断 tauri_slice_verify）；**尚未在 `scenarios.yml` 注册**，注册归 Lead（见 11.5） |
| 本文件 §6–§11 | CP0 契约、CP1/CP2 实施、验证记录、known-gap、本交接 |

seed 运行（runner 在 reset_test_db 之后执行）：

```bash
MIX_ENV=test mix run scripts/seed_b47_canon_freshness.exs          # 造数
MIX_ENV=test mix run scripts/seed_b47_canon_freshness.exs -- --check  # 造数后、UI 采纳前复验
```

seed.log 格式（每行均以 `[b47-canon-freshness-seed] ` 前缀，字段值 JSON）：

```text
[b47-canon-freshness-seed] work={...}   # 每作品一行，字段见 11.2
[b47-canon-freshness-seed] db={...}     # database 路径 + works/drafts/mutations 全局基线
[b47-canon-freshness-seed] seed={...}   # seed_version/seeded_at/works 数组/self_check
[b47-canon-freshness-seed] ok works=3 ...   # 成功收口行（失败会 raise 非零退出）
```

`--check` 输出 `check={...}` 每作品一行 + `check_ok=true|false`（失败 exit 1）；只用于 seed 后、UI 采纳前，fresh 作品被采纳后预期会变成 stale。

### 11.2 seed 构造的三作品事实（真实持久 canon，无候选自报）

| scenario | 作品标题（UI 可见） | 持久 canon 布置 | 恢复的候选 declared 基线 | 期望 |
|---|---|---|---|---|
| stale | `B47 Canon Freshness · 过期基线` | 第01章先 append 旧基线正文 → 产品 B28 `replace_scope` 原位重写为当前 canon（旧 accepted → SUPERSEDED、新 accepted revision 前进） | 旧 draft ref/version（已 superseded 的 `draft:<old>:<rev>`） | `fail_with_recovery`，reason 含 `stale_base_version`，零写入 |
| conflict | `B47 Canon Freshness · 片段冲突` | 第01章 append 两段 accepted 正文（scene1/scene2），当前 canon versions = 两段 | 只含 scene1 draft 的 covered/expected_base_versions | `fail_with_recovery`，reason 含 `canon_conflict_detected` + `incomplete_scope`，零写入 |
| fresh | `B47 Canon Freshness · 新鲜基线` | 第01章 append 两段 accepted 正文，与 conflict 同形 | 两段 covered/expected_base_versions = 当前 canon | `adopt_tentative` 成功；旧两稿 SUPERSEDED、新整章稿 ACCEPTED，receipt 前后 refs 可解释 |

每作品 `seed.log work=` 行包含（driver/verifier 断言字段清单）：

- 身份：`scenario/work_id/work_title/session_id/turn_id/artifact_id/chapter_id/chapter_ref/chapter_title/chapter_count`
- 候选：`card_title/candidate_content/candidate_content_sha256/candidate_word_count`（正文候选卡与 payload.items 同字节）
- 基线与当前：`declared_versions`（`%{"draft:<id>" => revision}`）、`declared_refs`（按阅读投影 scene 顺序的 `draft:<id>:<revision>`，与候选 payload covered/expected_base_versions 同序）、`current_versions`、`current_prose_sha256`
- 采纳前持久事实：`drafts`（当前 accepted 行：`draft_id/draft_ref/revision/status/content_sha256/char_count`）、`accepted_draft_refs`、`work_mutation_count`
- 阅读投影：`current_reading_text_sha256/current_reading_word_count/current_reading_char_count`（`accepted_chapter_prose` 同源）
- 期望：`expected_freshness_status`、`expected_reason_codes`、`expected_decision`、`expected_after_adoption`（fresh：`superseded_refs`/`new_accepted_content_sha256`/`new_accepted_word_count`/`mutation_delta=1`；stale/conflict：`outcome=zero_write,mutation_delta=0`）
- UI 可达性自检：`pending_artifact_visible/pending_adoption_turn_visible` 均为 true（通过 `WorkSessionService.resume` 的 `pending_adoptions` + `pending_adoption_turn_results` 验证）
- 文案：`visible_approve_label="保存为章节正文"`（prose_fragment 的 copy.ts `acceptProseLabel`；与通用「保存到作品」同属采纳入口）

**注意 revision 不是 1**：Draft changeset 的 `optimistic_lock(:revision)` 在插入/状态转换时也会推进 revision（既有产品行为）；driver 不得硬编码版本号，必须从 seed.log `declared/current_versions` 读取。

### 11.3 UI 可达性依据（为什么真实页面会出现候选卡 + 采纳按钮）

1. seed 写入的 assistant interaction 含产品同形 `turn_result`：`ui_cards[]` 里 `card_type=candidate_set`（`artifact_type="prose_fragment"`、`items[]`、`candidate_set_ref=artifact_id`）→ 前端 `CandidateSetCard` 渲染标题/正文/候选正文；
2. `adoption_state.pending[]`（`requires_adoption=true`）经 `WorkSessionRepo.adoption_state/2` → `WorkSessionService.resume` 的 `pending_adoptions/pending_adoption_turn_results` → 前端 `workspaceRuntimeState.deriveAdoptionState` 得到 `pendingArtifactIds`；
3. `available_actions[]` 的 `accept`（`target_ref=artifact_id`）经 `filterVisibleAvailableActions`（`frontend/src/lib/workbenchActions.ts`）在 pending 中时可见，作品正文类 artifact 的按钮文案为 `copy.ts` `acceptProseLabel`「保存为章节正文」；
4. 点击后走真实 Channel `author_action`（`accept`）→ `AdoptionWorkflow.handle_adopt`（服务端默认注入 `persistence_canon_reader/0`）→ 本批 freshness gate；
5. 本会话已用**真实应用采纳链**（非 driver）在三作品上模拟同一入口并通过（证据 `artifacts/b47-cp3-seed/app-chain-verify.log`）：stale/conflict → `fail_with_recovery` + canon_freshness stale/conflict + DB/阅读零写入；fresh → accepted + 旧稿 SUPERSEDED + 新稿 content sha = 候选 sha + mutation +1。该模拟不能替代 CP3 真实页面验收，只证明 seed→产品链可达。

### 11.4 driver 建议步骤与外部证据断言（Lead 实现）

建议沿用 `frontend/slice-verify/external-ui-driver.mjs` 现有 helper：
- 用 `ensureWorkSelectedByTitle(page, title, work_id)` / `waitForVisibleWorkTitle` 按 seed.log 的 `work_title/work_id` 切换三作品；
- 用现有候选卡/采纳按钮 helper（正则可匹配 `保存为章节正文`）点击；
- 用现有 WS 帧抓取 `action_result` / `turn_result`；用 app jsonl 抓 `channel.join.done`。

建议 step 顺序（trial 标记 T1/T2/T3）：
1. **T1 stale**：选 `B47 Canon Freshness · 过期基线` → 等候选卡与「保存为章节正文」可见 → 点击 → 等该 action 的 `action_result` + `turn_result`。断言：
   - `action_result.status=failed`、`action_result.decision.decision_type=fail_with_recovery`、`action_result.canon_freshness.status="stale"`、其 `expected.versions/current.versions` 与 seed.log 对应字段一致、`decision.reason_codes` 含 `stale_base_version`+`conflict_recovery_required`；
   - `turn_result.status=failed_recoverable`、`truthfulness.production_write_performed=false`、`parent_turn_id=seed.log.turn_id`；
   - 可见助手消息匹配 11.6 失败文案词；
   - 只读 DB/持久化对账：见 11.7。
2. **T2 conflict**：选 `B47 Canon Freshness · 片段冲突` → 点击 → 断言同上，但 `canon_freshness.status="conflict"`、reason 含 `canon_conflict_detected`+`incomplete_scope`。
3. **T3 fresh 对照**：选 `B47 Canon Freshness · 新鲜基线` → 点击 → 断言：
   - `action_result.status=accepted`、`decision_type=adopt_tentative`、`canon_freshness.status="fresh"`、`persistence.persisted=true`；
   - `action_result.persistence.superseded_draft_refs == seed.log.expected_after_adoption.superseded_refs`（集合相等，顺序可按 receipt）；
   - DB：旧 covered drafts 全 SUPERSEDED，恰有 1 条新 ACCEPTED，`content_sha256 == candidate_content_sha256`；work mutation 计数 = seed 基线 +1；
   - 打开阅读模式：正文可见新内容、有效字数 = `expected_after_adoption.new_accepted_word_count`、无重复章。
4. 可选负例/幂等：再次点击 stale/conflict 候选（若按钮仍可见）仍失败且仍零写入；fresh 采纳后按钮从 pending 消失。

证据落盘建议（`artifacts/slice-verify/b47-canon-freshness-tauri/`）：`screenshot`（三作品候选卡 + 失败/成功消息 + fresh 阅读模式）、`websocket_frames`（action/turn 帧）、`app_jsonl`、`turn_result`、`action_result`、`seed.log`（runner 已复制）、`summary.json`、`persistence_snapshot.json`（11.7 前后快照）。manifest 的 `evidence.required` 已按这些 kind 冻结。

### 11.5 Lead 注册/接线清单（本会话不改这些共享文件）

1. `quality/acceptance/scenarios.yml`：**Lead 已在 2026-10-29 注册**（id=`b47-canon-freshness`、nightly/tauri、manifest 指向本文件、driver=`frontend/slice-verify/external-ui-driver.mjs`、entrypoint=`scripts/quality_accept.sh b47-canon-freshness --surface tauri`、status=`blocked` + blocked_reason「CP3 driver/verifier 实现中」）；`quality_manifest_check.sh` 已通过（207 scenarios / 2 drafts / 209 manifests）。driver/verifier 完成并真跑后由 Lead 转 active。
2. `scripts/tauri_slice_verify.sh`（尚未接）：在 `case "$SLICE_ID"` 增 `b47-canon-freshness) SEED_SCRIPT="scripts/seed_b47_canon_freshness.exs";;`；在 `--list` / slice 描述与 driver 分支加本场景（driver 分支由 Lead 实现）；三作品切换 + 3 次采纳建议 `TAURI_WAIT_SECONDS` ≥600s（默认 360s 可能偏紧）。
3. `scripts/README.md` 登记 `seed_b47_canon_freshness.exs`；`quality/acceptance/scenarios/README.md` 登记 manifest（如 README 要求逐文件列）——当前两处尚未登记。
4. driver/verifier 实现（Lead）：断言 11.4 字段；写 `verdict.json` 前确保证据 kind 齐全（尤其 `seed_log`/`persistence_snapshot`/`action_result`/`turn_result`）；manifest 已冻结 evidence.required = screenshot/websocket_frames/app_jsonl/turn_result/action_result/seed_log/summary_json/persistence_snapshot。
5. 回归：`p1-chapter-adoption-reading`、`p1-chapter-overwrite-confirm`、`b28-whole-chapter-revision`、`b29-existing-character-role-revision`、`au05-stale-conflict-cross-work-freshness`、`au05-canon-conflict-recovery`（`au05-adoption-safety-freshness` 已被 B40 §10.2 retired，不作判据）。

### 11.6 失败/成功文案匹配词（来自产品现有实现，非 driver 专用文案）

- stale（decision 拒绝）：`版本已变化（base version/fingerprint 过期）`、`没有写入作品事实`、`原候选仍保留`。
- conflict（decision 拒绝）：`canon 冲突`（完整为「系统从当前作品事实检测到与候选依据不一致（canon 冲突）」）、`没有写入作品事实`。
- 持久化事务内 TOCTOU 被拒（若真出现）：同 stale/conflict 语义的 `persistence_failure_message`，作者可见仍含 `版本`/`冲突`/`没有写入`/`原候选仍保留`。
- fresh 成功：`已通过采纳边界，采纳内容已进入已决状态。`；action_result `status=accepted`。
- 不要按「保存到作品」四字匹配本场景正文候选按钮：prose_fragment 的可见 accept 文案是 `保存为章节正文`（如未来 copy 改动，以 `copy.ts` 当前值为准；driver 建议沿用现有 `acceptProseLabel`/正则有兼容集合）。

### 11.7 零写入 / 前后版本对账方式

- seed.log 的 `work=` 行是**采纳前**快照：`drafts` 数组（id/status/revision/content_sha256）、`work_mutation_count`、`current_reading_text_sha256`、`current_reading_word_count`、`current_versions`、`declared_versions`。
- stale/conflict 失败后（verifier 只读查询 DB 或经应用只读端口）必须与快照完全一致：
  - drafts 行数/每行 id/status/revision/content_sha256 不变；无新 accepted 稿；
  - mutation 计数：按 `mutations.target_scope = "work:<work_id>"` 过滤后仍等于 `work_mutation_count`（delta=0）；
  - 阅读投影：`ReadingProjectionRepo.accepted_chapter_prose(work_id, chapter_ref)` 的 sha256 与有效字数分别等于 `current_reading_text_sha256/current_reading_word_count`；UI 阅读模式/章字数/TOC 章数不变。
- fresh 成功后：
  - 旧 covered drafts → SUPERSEDED（receipt `superseded_draft_refs` = `declared_versions` 对应 refs，与 `expected_after_adoption.superseded_refs` 相等）；
  - 恰有 1 条新 ACCEPTED，`content_sha256 = candidate_content_sha256`；
  - mutation 计数 + `expected_after_adoption.mutation_delta`（=1）；
  - 阅读正文 = 候选内容（sha 相等），有效字数 = `new_accepted_word_count`。
- 现成参考实现（本会话临时验证脚本，未入库）：`/tmp/b47_seed_verify.exs`；其输出已保存 `artifacts/b47-cp3-seed/app-chain-verify.log`，可按同样查询移植到 verifier。

### 11.8 已知坑（driver 实现前必读）

1. **切换作品必须按标题 + seed.log work_id**：三个作品并列，标题稳定；不要依赖「最近打开」顺序。
2. **seed 可重复运行会新增同名作品**：接受度 runner 已 reset DB 后只跑一次；若手动复跑未 reset，driver 应按 seed.log 本次输出的 work_id 精确选择（`ensureWorkSelectedByTitle` 已按 work_id 验证 join）。
3. `--check` 只保证 seed 后基线；fresh 作品被采纳后其 pending 消失、canon 前进，再跑 check 会按预期失败，不要把它当回归。
4. DB 路径在 `seed.log db.database`（隔离 test DB / 分区库）；runner 默认库为 `/tmp/ai_novel_studio_test.sqlite3`（`NOVEL_TEST_DB_DIR` 可覆盖），verifier 以 seed.log `db.database` 为准。
5. 失败决定不会 resolve pending（作者可重试）；不要断言按钮消失；断言「无第二次写入/无重复 adopted 回执」。
6. 本 seed 不覆盖 O2 角色 fingerprint 场景（真实页面矩阵首批只做 O1 章正文三类）；若后续要补角色 stale，可在同一 seed 增第四个作品与 `character_profile_revision` 候选，按 §6.2 O2 payload 形状扩展。

### 11.9 本会话预跑证据（非验收 verdict，仅交接自检）

- `artifacts/b47-cp3-seed/seed.log`：`MIX_ENV=test MIX_TEST_PARTITION=b47cp3seed mix run scripts/seed_b47_canon_freshness.exs` 输出（3 作品、每作品 work= JSON、db=、seed= 汇总；`ok works=3`）。
- `artifacts/b47-cp3-seed/check.log`：`--check` 输出 `check_ok=true`。
- `artifacts/b47-cp3-seed/app-chain-verify.log`：真实应用采纳链模拟（非页面）输出三类结果 ok=true（stale/conflict 零写入、fresh 成功+前后版本）。
- 三作品 id/title（本次预跑示例，driver 以当次 seed.log 为准）：
  - stale `8ce10577-…` / `B47 Canon Freshness · 过期基线`
  - conflict `bc628874-…` / `B47 Canon Freshness · 片段冲突`
  - fresh `2ec168b1-…` / `B47 Canon Freshness · 新鲜基线`
