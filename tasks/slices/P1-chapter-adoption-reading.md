# P1 Chapter Adoption Reading / 10 万字最小长篇单章正文采纳与阅读

- 状态：checkpoint closed
- 类型：Product Slice / Novel Output Milestone P1
- 来源：`docs/product/novel-output-milestones.md` §6-§7；`docs/product/user-journeys.md` Journey D9；`tasks/slices/P1-chapter-draft-generation.md`
- 当前目标：作者采纳单章正文草稿后，正文进入作品事实和 Reading Projection；阅读模式能从真实 Channel 读取该章正文，未采纳草稿仍不得进入阅读投影。

---

## 1. 产品目标

P1 已证明章节计划能生成待采纳正文草稿。下一步要证明正文草稿不是只停留在聊天卡片里：作者明确采纳后，系统必须通过 adoption boundary 将 `prose_fragment` 写入正式作品事实，并让 ReadingMode 从投影读取该章正文。

---

## 2. 开工检查

- Contract: `prose_fragment` tentative artifact、`AdoptionDecision`、accepted draft / reading projection read model、`ProjectionHint`。
- Invariant: 只有采纳后的正文可以进入 ReadingMode；未采纳正文、章节计划和摘要都不得成为正文事实。
- Boundary: 预期切过 `novel_application`、`novel_persistence`、`novel_web` Channel、真实 Tauri 工作台；不应让前端直接写阅读投影。
- Consumer: ReadingMode 目录和章节正文视图；后续正文有效字数统计。
- Proof: application/persistence/channel 回归 + 外部 Tauri 自动化；真实 UI 证明作者采纳后可阅读正文。
- Acceptance Driver: 扩展 `bash scripts/tauri_slice_verify.sh p1-chapter-adoption-reading`，由外部 Playwright 操作真实页面，不新增产品验收 hook。

---

## 3. 最小闭环候选

```text
已采纳章节计划
→ 作者生成第 1 章正文草稿
→ 正文草稿以 prose_fragment tentative artifact 展示
→ 作者点击采纳
→ adoption boundary 接受并持久化
→ Reading Projection materialized
→ ReadingMode 目录出现第 1 章
→ 点击章节可看到正文
```

---

## 4. 非目标

- 不要求一次完成 10 万字。
- 不要求本 checkpoint 完成章节正文扩写到 1000 字以上；若未达标，必须保留到后续字数统计 / 扩写 checkpoint。
- 不实现全书导出。
- 不绕过 adoption boundary 直接写 projection。

---

## 5. 进度

### checkpoint A — 采纳到阅读投影最小闭环（已闭环）

`artifacts/slice-verify/au08-adoption-reading-projection-tauri/summary.json`：真实 Tauri 工作台采纳 → 写 mutation → ReadingMode 经 Channel 读到 TOC 与章节正文。

### checkpoint B — 有效字数统计 + 真实采纳链路打通（确定性 Tauri 已闭环，2026-05-29）

引用 `docs/product/novel-output-milestones.md` §2 口径与 §7 命名 checkpoint `P1-word-count-audit`。本步做字数统计核心，不做短章/空章/重复 audit 与门槛判定。

- Contract：`NovelDomain.ProseWordCount.count/1`；reading projection 单章 `word_count` + 作品 `total_word_count`；`chapter_content.word_count`。
- Invariant：有效字数 = 排除标点与空白后的字符数；只统计已采纳正文（每场景取最新版本），未采纳草稿/章节计划/摘要不计入（§7 #11）；确定性、禁 LLM 自报。
- Boundary：`novel_domain`（纯函数）→ `novel_persistence`（聚合）→ `novel_application`（DTO）→ `novel_web`（Channel payload）→ frontend（ReadingMode 显示）。
- Consumer：ReadingMode 顶栏「全书有效字数」、目录单章字数、章节头「本章有效字数」；WorkArchive stats 同口径。

#### B1 关键修复：真实 accept 接通采纳持久化（设计对齐）

字数验收暴露出一个被高估的闭环：真实工作台「确认创建」(accept author_action) 原先落在 `DialogueGateway.handle_action` 空兜底分支，只回 `status:"accepted"`，**不写库、不物化阅读投影**；真正持久化的 `AdoptionWorkflow.handle_adopt` 仅由前端没有的 `adopt` push 触发。au08「点击采纳→持久化→ReadingMode」实为旧直接 push 路径，真实用户点不到。

按 v3 设计修复（核对 ADR-0010 §87 / VS-04 §4.5、§6 / ADR-0006 §5 / 07 §8）：
- `workspace_channel.ex`：`accept`/`discard` author_action 经 `ActionValidator`（守 AU-05/06 stale/invented）路由到既有 `AdoptionWorkflow`，复用持久化 + 广播 + 幂等票据；`edit_then_accept` 仍归后续 checkpoint。
- `adoption_workflow.ex`：`handle_adopt` 对每种 AdoptionDecision 都产出 TurnResult（`adopt_tentative` 写库；`require_confirmation`/`reject`/`fail_with_recovery` 不写库但回真实 TurnResult，`available_actions: []`，与候选路径口径一致），满足「adoption failure 必须产生 TurnResult」；artifact risk 现从 artifact 派生。
- 确认重新 gate→完成采纳的闭环（ConfirmationBinding/BehaviorState）仍属 AU-04/06，候选与 artifact 路径一致暂未实现。

#### B2 修复：采纳后旧草稿卡不再可重复提交（来自用户 Stage 日志）

用户 Stage 日志显示同一 `turn_4` 的 `channel.author_action` 被连续提交 3 次（每次约 4ms 完成=幂等短路，无重复写库，后端幂等已生效）。根因在前端渲染：`visibleAvailableActions` 只按单条 `turn_result.available_actions` 渲染采纳按钮，旧草稿卡的「确认创建」在 artifact 被后续 turn 采纳后仍可点击。
- 修复：抽出纯函数 `filterVisibleAvailableActions(actions, pendingArtifactIds)`（`workbenchActions.ts`），采纳类动作（accept/discard/edit_then_accept）的目标 artifact 不在 `runtimeState.adoption.pendingArtifactIds` 时不再渲染；`WorkspaceChat` 消费它。
- 回归：新增 `workbenchActions.test.ts`（5 例）；Tauri driver 新增断言 `accept_button_cleared_after_adoption`（采纳后「确认创建」必须消失），**确定性 + `--real-lmstudio` 两种 provider 均复跑通过**（真实 LLM 本次生成 538 字，displayed==可见正文，按钮已消解，4×`POST /v1/chat/completions` 全 200）。

- Proof（已完成）：`prose_word_count_test.exs`(8) + `reading_projection_repo_test.exs` 字数回归 + `adoption_workflow_test.exs` 高风险→require_confirmation 无写库 + `workspace_channel_v3_test.exs` accept 路由/invented 拒绝 + `frontend/.../readingProjection.test.ts`；全量后端 594 + 前端 164 测试 0 failures；arch/xref/I1/I2/I3/frontend_audit/design_trace/ai_static_scan(0 touched-file finding) 全绿。
- **外部 Tauri 验收已闭环（两种 provider）**：`bash scripts/tauri_slice_verify.sh p1-chapter-adoption-reading` 从真实工作台生成草稿→点「确认创建」→采纳边界持久化→ReadingMode 显示字数；断言 `displayed == 可见正文有效字数`、`全书 == 单章`。
  - 确定性 provider：`artifacts/slice-verify/p1-chapter-adoption-reading-tauri/summary.json`（chapter_count=1, total=chapter=visible_prose=167）。
  - `--real-lmstudio`（`openai/gpt-oss-120b` 加载后）：`artifacts/slice-verify/p1-chapter-adoption-reading-tauri-lmstudio/summary.json`（4 次 `POST /v1/chat/completions` 全 200；真实生成 total=chapter=visible_prose=**423**，与确定性 167 不同，证明字数确为真实正文计算而非硬编码）。

### checkpoint B3 — edit_then_accept 真实编辑闭环（确定性 + 真实 LLM Tauri 已通过，2026-05-29）

补齐当前采纳边界中“作者编辑后采纳”的闭环。作者在采纳前编辑 AI 草稿全文，采纳的是编辑后的版本；UI 只提交服务端提供的 available action，具体写入仍由后端 adoption boundary 裁决。

- 后端 `adoption_workflow.ex`：编辑语义改为**作者全文替换**（`edited_content` 优先，直接替换 `payload.content` → `artifact_content` → 持久化 → 阅读投影 → 字数都以编辑后内容为准）；旧 `instruction` 追加语义保留向后兼容；校验改为「edited_content 或 instruction 二选一」。
- 通道 `workspace_channel.ex`：`edit_then_accept` author_action 经 `ActionValidator` 路由到 `handle_modify_draft`，编辑全文随 `AuthorActionInput.payload.edited_content`（VS-04 §3）传入。
- 前端：点「修改后采纳」打开编辑弹窗（Radix Dialog + textarea 预填草稿）→ 改写 → 提交 `edit_then_accept`（payload 带 edited_content）。`filterVisibleAvailableActions` 同样在采纳后隐藏按钮。
- Proof：`adoption_workflow_test`（编辑全文替换 + 校验）+ `workspace_channel_v3_test`（edit_then_accept → EDITED_ACCEPTED）+ 前端 `workbenchActions.test`（payload 透传）；596 后端 + 171 前端 0 failures，全门禁绿。
- **外部 Tauri 验收两种 provider 均通过**：`tauri_slice_verify.sh p1-chapter-edit-then-accept`（生成→点「修改后采纳」→弹窗改写→采纳编辑版→ReadingMode 显示编辑后正文）。断言：编辑后正文可见、采纳后按钮消失、`显示字数 == 编辑后正文有效字数`、`全书 == 单章`。确定性 40 字；`--real-lmstudio`（gpt-oss-120b）真实草稿被编辑后采纳同样通过。证据 `artifacts/slice-verify/p1-chapter-edit-then-accept-tauri{,-lmstudio}/summary.json`。
- 未做（归 AU-04/06）：require_confirmation→confirm→重新 gate 确认闭环、ConfirmationBinding、durable BehaviorState 持久化实体 + TTL/stale。

### checkpoint B4 — 覆盖确认重新 gate（AU-04/06，确定性 + 真实 LLM Tauri 已通过，2026-05-29）

覆盖已有正文 = 高风险 production write，必须先确认（AU-04/VS-04 §4）。核对 ADR-0008/0009/VS-03 §3-5。

- 新建 `NovelDomain.ConfirmationBinding`（VS-03 §5）。
- `AdoptionBoundary` 加 `overwrite_decision`（`opts.overwrite && !confirmation_satisfied → require_confirmation`，reason `overwrite_existing_canon`），确认后放行；`high_risk_decision` 同样受 `confirmation_satisfied` 控制。
- 持久化 `AdoptionRepository`：**章节身份**（同 title 落到同一卷/章/场景）+ **替换**（supersede 旧 accepted draft 写新 accepted）+ 读端口 `has_accepted_chapter?(work_id, title)`；application 经 `persistence_overwrite_reader()` 注入。
- `AdoptionWorkflow.handle_adopt` 读 overwrite + 传 opts；require_confirmation → 打开 confirmation `BehaviorState` + `confirm_before_execute`/`reject_or_cancel_confirmation` actions；`confirmation_satisfied` 重新 gate 采纳（替换）；`handle_confirmation_reject` 关闭确认不写库。
- 通道：confirm/reject 当 target 是 pending artifact 时路由到采纳确认（confirm→重新 gate 采纳；reject→关闭）；否则走既有工具派发确认。
- 前端：confirm/reject 按钮从 available_actions 渲染；`filterVisibleAvailableActions` 按**活跃行为**门控（确认/取消后行为关闭即隐藏，防重复确认）。
- Proof：`confirmation_binding_test`(4) + `adoption_workflow_test`（require_confirmation 开行为/确认后采纳）+ `adoption_boundary_test` + `workspace_channel_v3_test`（confirm→adopt / reject→cancel）+ 前端 `workbenchActions.test`（行为门控）；603 后端 + 172 前端 0 failures，全门禁绿。
- **外部 Tauri 验收两种 provider 均通过**：`tauri_slice_verify.sh p1-chapter-overwrite-confirm`（采纳第1章→再采纳同章→检测覆盖→require_confirmation→点「确认执行」→重新 gate→替换→ReadingMode 同一章不重复）。断言：cycle1 采纳、cycle2 需确认、确认前不写、确认后采纳、`final_chapter_count==1`（替换非重复）。确定性 + `--real-lmstudio`（gpt-oss-120b，8×`POST /v1/chat/completions` 200）。证据 `artifacts/slice-verify/p1-chapter-overwrite-confirm-tauri{,-lmstudio}/summary.json`。
- 未做（更后 checkpoint）：完整 durable BehaviorState 持久化实体 + TTL/stale + 单活跃行为强约束；工具派发确认重构。

### 后续 checkpoint（未做）

- P1-word-count-audit：短章 / 空章 / 重复段落 audit。
- 单章 ≥1000 / 总 ≥100,000 门槛判定与 `artifacts/novel-output/<milestone-id>/word-count.json` 产出。
- 全书导出。

### AU-08 文件级证据入口同步（2026-06-21）

- `p1-chapter-adoption-reading` 与 `p1-chapter-edit-then-accept` 已补入 `quality/acceptance/scenarios.yml` 和单场景 manifest，成为 AU-08 当前可复跑质量入口。
- 外部 verifier 补强采纳后 `projection_refs.refresh_status=STALE`、阅读模式“投影状态：已过期” banner 和“刷新投影”按钮断言。该断言只证明 STALE 可见，不代表 projection refresh job/status machine 已完成；专用 refresh/no-write 仍归 AU-08 P1 后续。
