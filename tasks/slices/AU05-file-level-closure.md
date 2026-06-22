# AU05 File-Level Closure / 采纳创作产物文件级收口

- 状态：done / second-round reviewed
- 类型：Acceptance Slice / Artifact Slice / Projection Slice
- 启动日期：2026-06-21
- 最近复核：2026-06-22
- 验收文件：`docs/design/acceptance/author/AU-05-artifact-adoption.md`

## 1. 用户 / 系统目标

作者看到 AI 产物时，系统必须清楚区分“候选/草稿/待保存”和“已采纳作品事实”。采纳、放弃、修改后保存、高风险确认、stale 拒绝、跨作品拒绝和 canon 冲突恢复都必须从真实工作台入口触发，穿过服务端授权 action 和后端 adoption boundary，不能靠前端旁路或验收专用逻辑写入作品事实。

## 2. 开工检查

- Contract: `AuthorActionInput`、`AvailableAction`、`AdoptionDecision`、`TentativeArtifactSet`、`adoption_state`、`truthfulness`、reading projection read model、VS-04、ADR-0010、ADR-0016。
- Invariant: ToolResult / candidate selection 不等于 adopted state；只有服务端授权 `author_action` 经 adoption boundary 之后才能写 production fact；pending/discarded/stale/cross-work/conflict 内容不能进入阅读或作品事实。
- Boundary: 切过真实 `frontend` 工作台、`novel_web` Channel、`novel_application` DialogueGateway / AdoptionWorkflow / AdoptionBoundary、`novel_persistence` reading / memory read model；不修改 `novel_agent` runtime，不把 fixture provider 注册进 production。
- Consumer: 真实 Tauri 工作台候选卡、正文草稿卡、作品档案、阅读模式、why/trace 证据。
- Proof: quality acceptance / Tauri slice summary、Channel/application/frontend verifier 回归、quality manifest、static scan。
- Acceptance Driver: `scripts/quality_accept.sh <au05-scenario> --surface tauri` 和 `scripts/tauri_slice_verify.sh <slice-id>`；产品代码无 slice id、验收 env/query/localStorage、hidden DOM hook 或自动点击逻辑。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 本轮无 contract validator 变更 |
| novel_domain | no | 本轮无 domain runtime 变更 |
| novel_agent | no | 不触碰 provider runtime |
| novel_application | no | 本轮只审计和刷新 harness/docs；现有实现已覆盖 |
| novel_persistence | no | 不改 read/write model |
| novel_web | no | 不改 Channel |
| frontend | yes | 仅更新外部 slice driver / verifier，未改 `frontend/src` 生产代码 |
| docs/design | yes | AU-05 验收文件、acceptance README、蓝图同步 |
| quality | yes | 新增 `au05-discard-author-action` quality manifest 并更新 scenario 索引 |
| tasks | yes | 新增本文件并同步 `tasks/slices/README.md` |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | AU-05 文件级审计：重算 18 个场景状态、实现入口、测试和真实 Tauri 证据 | done | 15 个已验收，3 个部分实现 |
| T2 | 修复 `au05-discard-author-action` 缺口：真实工作台点击“不保存”走 `author_action.discard` | done | 新增 quality manifest、driver、verifier、summary |
| T3 | 修复 AU-05 stale/cross/canon seed 与当前 `AvailableAction` contract 漂移 | done | seed 补 `source_turn_ref` / `target_ref`；只改外部验收 seed |
| T4 | 同步 driver 与当前 UI copy | done | `设为后续方向`、`后续方向设置失败`、`修改后保存正文` |
| T5 | 复跑 AU-05 质量场景和 cross-reference Tauri 证据 | done | 见 §5 |
| T6 | 更新 AU-05 验收文件、SCENARIO-BLUEPRINT、acceptance README、ledger 和 slice 索引 | done | 本轮完成 |

## 4.1 二轮剩余缺口矩阵（2026-06-22）

二轮不推翻 2026-06-21 的文件级可交付结论。当前 11 个 AU-05 主证据与 cross evidence 均已串行复跑通过；未发现需要在 AU-05 内新增实现后才能进入 AU-06 的 P1。剩余 P1/P2 均是已登记 owner 的后续能力，不冒充当前文件已验收。

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-05 内关闭 | 建议 checkpoint / slice | 是否满足继续到 AU-06 的二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU05-A1 生成后显示为待采纳 | 已验收 | 正文草稿 pending 主链已闭；角色/设定类型覆盖仍主要依赖 AU-09 交叉证据。 | 类型覆盖扩展 | P2 | `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`au05-discard-author-action` 复跑 passed；`au09-adopt-setting-recall` 复跑 passed | 继续扩角色/设定 artifact 类型矩阵 | 否 | AU-09 story memory 类型扩展 | 是 |
| SC-AU05-A2 工具成功不自动写事实 | 已验收 | 无当前缺口；未采纳/放弃不进阅读事实仍需保持回归。 | 保持回归 | P2 | `au05-discard-author-action` 证明 discarded 后 `total_word_count_after_discard=0`；`au02-unadopted-candidate-no-reading-fact` 证明 `production_write_performed=false`、reading total=0 | 保持 no-write 回归 | 否 | AU-05/AU-08 regression | 是 |
| SC-AU05-A3 草稿在作品档案有待处理入口 | 部分实现 | 待处理入口依赖 transcript/runtime pending state；独立持久 adoption inbox / workbox 未完成。 | 持久 workbox | P1 | `au05-discard-author-action` 证明 pending artifact 可见、可点击“不保存”、resolved 后按钮清理 | 设计并实现 persistent adoption inbox；补恢复后待处理列表 driver | 否 | AU-06/AU-10 action matrix；persistent adoption inbox | 是，已登记 owner |
| SC-AU05-B1 选择候选只是继续探索 | 已验收 | 无 AU-05 当前缺口；selection/adoption 分层继续作为 AU-02 回归。 | cross-reference | P2 | `au02-candidate-adoption-bridge` 和 `au02-unadopted-candidate-no-reading-fact` 复跑 passed | 保持候选 selection 与 adoption 分层回归 | 否 | AU-02 keep regression | 是 |
| SC-AU05-B2 点击保存必须走后端边界 | 已验收 | 无当前缺口；旧 direct socket 口径已废弃。 | closed | closed | `p1-chapter-adoption-reading` 断言 `accept_author_action_routed_through_adoption_boundary`，字数与阅读正文一致 | 保持 `author_action.accept` 回归 | 否 | AU-05 keep regression | 是 |
| SC-AU05-B3 修改后再采纳 | 已验收 | 无当前缺口；编辑后保存主路径已复验。 | closed | closed | `p1-chapter-edit-then-accept` 断言 `edited_content` 随 action 传递、阅读模式展示编辑后正文，`chapter_word_count=40` | 保持 edit_then_accept 回归 | 否 | AU-05 keep regression | 是 |
| SC-AU05-B4 放弃草稿 | 已验收 | 无当前缺口；放弃后 no-write 主路径已复验。 | closed | closed | `au05-discard-author-action` 断言 `resolved=DISCARDED`、采纳按钮清理、阅读投影为空 | 保持 discard 回归 | 否 | AU-05 keep regression | 是 |
| SC-AU05-C1 低风险可采纳但必须留下 decision | 已验收 | adoption decision 有当前证据；完整 StateTrace / developer replay 仍归 AU-07。 | Trace/replay follow-up | P1 | `au02-candidate-adoption-bridge` 断言 `adoption_boundary_returned_adopt_tentative`、`production_write_not_claimed`；`au07-state-trace-adoption-replay` 已有 StateTrace refs cross evidence | 补 developer replay 和旧 turn trace 查询 UI | 否 | AU-07 trace/replay | 是，已登记 owner |
| SC-AU05-C2 高风险要求确认 | 已验收 | high-risk candidate 进入 confirmation/no-write 已复验；完整 confirmation lifecycle 归 AU-04/AU-06。 | cross-reference | P1 | `au05-adoption-safety-freshness` 断言 `adoption_boundary_returned_require_confirmation`、`candidate_not_adopted`、`production_write_not_claimed` | AU-06 继续补 durable behavior lifecycle / confirmation history | 否 | AU-06 behavior lifecycle | 是 |
| SC-AU05-C3 stale 草稿不能采纳 | 已验收 | stale restored candidate 已拒绝；完整 context version / state snapshot freshness 未持久化。 | Freshness 加固 | P1 | `au05-stale-conflict-cross-work-freshness` 断言 `adoption_boundary_returned_reject`、`production_write_not_claimed` | 补 context version / state snapshot contract 与持久化 proof | 否 | State snapshot / AU-07 follow-up | 是，已登记 owner |
| SC-AU05-C4 canon 冲突进入恢复 | 已验收 | 当前冲突依据来自 source candidate 的结构化 `canon_conflicts`；尚未从持久 canon/revision store 自动计算。 | canon/revision store | P1 | `au05-canon-conflict-recovery` 断言 `adoption_boundary_returned_fail_with_recovery`、`production_write_not_claimed` | 补 canon store 自动 conflict detection、覆盖确认/人工合并路径 | 否 | AU-09 / StateTrace / merge follow-up | 是，已登记 owner |
| SC-AU05-C5 跨作品草稿不能采纳 | 已验收 | cross-work no-write 已复验；完整跨作品 persistent inbox 仍缺。 | Workbox / isolation 加固 | P1 | `au05-conflict-cross-work-recovery` 断言 `cross_work_candidate_failed_with_recovery_without_production_write` | 补 persistent inbox 的 work scope 隔离矩阵 | 否 | SU-02/AU-06 follow-up | 是，已登记 owner |
| SC-AU05-D1 采纳后作品档案出现已确认设定 | 已验收 | 设定类 recall 主链已复验；完整角色/组织/关系矩阵继续归 AU-09。 | cross-reference | P1 | `au09-adopt-setting-recall` 断言 setting/rule 采纳进入 governed memory、档案 tab 可见、后续召回并在 why 中展示 | AU-09 补完整档案类型、筛选分页、developer replay | 否 | AU-09 story memory | 是，已登记 owner |
| SC-AU05-D2 采纳后阅读投影提示 stale / refresh | 部分实现 | 采纳后可读与 STALE banner/刷新按钮已复验；完整 refresh job/status machine 未闭环。 | Projection state machine | P1 | `p1-chapter-adoption-reading` 记录 `projection_refresh_status=STALE`、stale banner 和 refresh button 可见；`au07-state-trace-adoption-replay` 记录 projection source StateTrace ref | 补 projection refresh 专用 action、REBUILDING/FAILED/no-write driver | 否 | AU-08 reading mode | 是，已登记 owner |
| SC-AU05-D3 未采纳草稿不进入阅读模式 | 已验收 | 无当前缺口；继续保持 pending/discarded no-read 回归。 | 保持回归 | P2 | `au05-discard-author-action`、`au02-unadopted-candidate-no-reading-fact` 复跑 passed | 保持 reading projection no-leak 回归 | 否 | AU-08 keep regression | 是 |
| SC-AU05-E1 采纳可回放 | 部分实现 | 机器 artifact / StateTrace producer 已增强；完整 author/developer replay UI 和旧 turn 查询仍未闭环。 | Replay / StateTrace | P1 | `au07-state-trace-adoption-replay` 断言 adoption turn、resolved entry 与 projection ref 共用 `state_trace:ad_16`；`state_trace_ref_is_bound_to_action_turn_trace_ref` | 补 replay 双视图、旧 turn 查询 API/UI、完整 ReplayReport | 否 | AU-07 trace-and-replay | 是，已登记 owner |
| SC-AU05-E2 AI 不谎报采纳状态 | 已验收 | 主链 truthfulness/no-write 证据已复验；更细 timeout/retry truthfulness 归 AU-10/AU-04。 | cross-reference | P2 | AU-05 safety/freshness/cross/canon/discard/accept/edit_then_accept 复跑均通过并包含 adopted/no-write 对应断言 | 保持 truthfulness 回归；timeout/retry 另补 | 否 | AU-10/AU-04 truthfulness matrix | 是 |
| SC-AU05-E3 采纳失败有恢复路径 | 已验收 | reject/fail_with_recovery 已复验；完整人工合并编辑器未实现。 | UX 深化 | P2 | `au05-stale-conflict-cross-work-freshness`、`au05-conflict-cross-work-recovery`、`au05-canon-conflict-recovery` 复跑 passed | 补人工合并/重新生成路径的产品 UX | 否 | AU-10 / AU-09 follow-up | 是 |

## 5. 验证

- [x] `bash scripts/quality_accept.sh au05-adoption-safety-freshness --surface tauri`
- [x] `bash scripts/quality_accept.sh au05-stale-conflict-cross-work-freshness --surface tauri`
- [x] `bash scripts/quality_accept.sh au05-conflict-cross-work-recovery --surface tauri`
- [x] `bash scripts/quality_accept.sh au05-canon-conflict-recovery --surface tauri`
- [x] `bash scripts/quality_accept.sh au02-candidate-adoption-bridge --surface tauri`
- [x] `bash scripts/quality_accept.sh au02-unadopted-candidate-no-reading-fact --surface tauri`
- [x] `bash scripts/quality_accept.sh au05-discard-author-action --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh p1-chapter-adoption-reading`
- [x] `bash scripts/tauri_slice_verify.sh p1-chapter-edit-then-accept`
- [x] `bash scripts/tauri_slice_verify.sh au09-adopt-setting-recall`
- [x] `bash scripts/quality_accept.sh p1-chapter-adoption-reading --surface tauri`
- [x] `bash scripts/quality_accept.sh p1-chapter-edit-then-accept --surface tauri`
- [x] `bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`
- [x] `bash scripts/quality_accept.sh au09-adopt-setting-recall --surface tauri`
- [x] `pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `node scripts/task_done_check.mjs`
- [x] `bash scripts/task_done.sh`（运行完成；最终非零来自既有 gitleaks accepted_risk，非 touched-file finding）
- [x] `bash scripts/ai_static_scan.sh --top 10`（同上，Top 10 唯一 finding 为既有 accepted_risk）

## 6. 决策日志

- 2026-06-21 — 文件级审计确认旧 AU-05 文档的 direct `adopt` / `discard` / `modify_draft` Channel 判断已过期。当前真实入口统一为服务端下发 `available_actions`，前端提交 `author_action`，后端以 `ActionValidator` 和 adoption boundary 裁决。
- 2026-06-21 — `au05-discard-author-action` 补齐 AU-05 缺失的 discard 真实页面证据：点击“不保存”后 resolved=DISCARDED，按钮清除，reading projection 为空。
- 2026-06-21 — stale/cross/canon seed 只作为外部验收状态构造，补齐当前 `AvailableAction` 字段不是产品逻辑变更；产品代码没有新增验收感知逻辑。
- 2026-06-21 — 文件级退出口径：AU-05 当前无剩余 P0；P1 为持久 adoption inbox、StateTrace/replay、ProjectionHint stale/refresh、完整 canon/revision store，分别归 AU-06/AU-07/AU-08/AU-09 后续。
- 2026-06-22 — 二轮缺口收敛未发现 AU-05 内应关闭的新 P1/P0；11 个主证据和 cross evidence quality 入口已串行复跑通过。剩余 P1/P2 继续按 owner 登记，不把 persistent inbox、refresh 状态机、完整 replay 或 canon store 自动计算冒充为当前文件已验收。

## 7. 试行反馈

- 文件级审计必须区分“历史 direct socket helper artifact”与“当前真实工作台 author_action 主链”。本轮没有复活旧 `au05-adoption-boundary` 等旁路 id，而是把 current evidence 挂到 `quality_accept` 和 `tauri_slice_verify` 当前入口。
- UI copy 漂移会导致外部 driver 假失败。driver 应优先匹配当前 `copy.ts` 的用户可见文案，同时保留旧文案兼容以支持历史 artifact 对账。
