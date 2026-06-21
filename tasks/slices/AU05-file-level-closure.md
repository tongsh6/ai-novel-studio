# AU05 File-Level Closure / 采纳创作产物文件级收口

- 状态：done
- 类型：Acceptance Slice / Artifact Slice / Projection Slice
- 启动日期：2026-06-21
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

## 7. 试行反馈

- 文件级审计必须区分“历史 direct socket helper artifact”与“当前真实工作台 author_action 主链”。本轮没有复活旧 `au05-adoption-boundary` 等旁路 id，而是把 current evidence 挂到 `quality_accept` 和 `tauri_slice_verify` 当前入口。
- UI copy 漂移会导致外部 driver 假失败。driver 应优先匹配当前 `copy.ts` 的用户可见文案，同时保留旧文案兼容以支持历史 artifact 对账。
