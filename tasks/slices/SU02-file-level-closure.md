# SU02 File Level Closure

- 状态：file-level deliverable / P2 follow-up matrix registered
- 类型：Acceptance Slice / System Slice / UI Contract Slice
- 启动日期：2026-06-21

## 1. 用户 / 系统目标

按 `docs/design/acceptance/system/SU-02-work-switching.md` 的文件级口径复核作品空间管理，不把单个 checkpoint 当成完成上限。

当前结论：SU-02 在当前 checkout 达到文件级可交付状态，可以进入 SU-03。13/13 场景均有真实 Tauri 工作台或等价场景化证据；后端不可用 UX、恢复/归档管理入口、大列表和异常失败态保留为 P2 后续矩阵。

2026-06-22 二轮复核结论：未发现本文件内应关闭的 P1/P0。已串行复跑全部 6 个 SU-02 真实 Tauri quality 入口：`su02-work-switching`、`su02-empty-start-unnamed-work`、`su02-work-lifecycle-management`、`su02-work-restart-recovery`、`su02-pending-result-work-isolation`、`su02-artifact-projection-trace-isolation`，全部通过。当前二轮退出标准仍满足：13/13 已验收；剩余仅 P2 work management / failure / platform preference / extended isolation matrix。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-02-work-switching.md`；`docs/design/acceptance/SCENARIO-BLUEPRINT.md` 的 SU-02 条目；`NovelApplication.WorkService`；`NovelWeb.WorksController`；`WorkspaceChannel` work_id/session_id join 合同；`quality/acceptance/scenarios/su02-*.yml`。
- Invariant: Work 身份必须来自持久化 `work_id`；作品切换必须重新限定 Channel topic 和 `work_id`；消息、pending result、artifact、projection、trace、memory 不得跨作品污染；lastOpened 只能恢复仍存在的真实 Work，不能恢复 `lobby` 或 discarded Work。
- Boundary: 本轮只补文件级收口记录，不改生产 runtime。既有实现边界为 `novel_web -> novel_application -> novel_persistence`，前端通过 `frontend/src/lib/works.ts` 和 Tauri preference command 访问作品列表与 lastOpened。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 顶部作品菜单、当前作品上下文、消息流、阅读模式和 why 面板；本文件消费者是滚动验收接手者。
- Proof: `artifacts/slice-verify/su02-*-tauri/summary.json`；`quality/acceptance/scenarios/su02-*.yml`；Work service/web/channel/frontend 局部测试；`bash scripts/quality_manifest_check.sh`；`bash scripts/ai_static_scan.sh --top 10`。
- Acceptance Driver: `scripts/quality_accept.sh su02-work-switching --surface tauri`、`su02-empty-start-unnamed-work`、`su02-work-lifecycle-management`、`su02-work-restart-recovery`、`su02-pending-result-work-isolation`、`su02-artifact-projection-trace-isolation`。产品代码新增验收感知逻辑：no。

## 3. 场景对账结论

| 场景 | 状态 | 主要真实页面证据 | 剩余缺口 | 优先级 |
|---|---|---|---|---|
| SC-SU02-A1 当前作品名可见 | 已验收 | `su02-work-switching`；`su02-empty-start-unnamed-work` | 无 | P0 closed |
| SC-SU02-A2 作品列表可见 | 已验收 | `su02-work-switching`；`su02-work-lifecycle-management` | 大列表/失败态 | P2 |
| SC-SU02-B1 快速新建未命名作品 | 已验收 | `su02-work-switching` | 无 | P0 closed |
| SC-SU02-B2 自动启动未命名作品 | 已验收 | `su02-empty-start-unnamed-work` | 无 | P0 closed |
| SC-SU02-B3 命名新增作品 | 已验收 | `su02-work-lifecycle-management` | 创建失败/大列表矩阵 | P2 |
| SC-SU02-B4 修改作品名 | 已验收 | `su02-work-lifecycle-management` | 并发冲突 UI/失败态 | P2 |
| SC-SU02-B5 删除或移出作品 | 已验收 | `su02-work-lifecycle-management`；`su02-work-restart-recovery` | 恢复/归档管理入口 | P2 |
| SC-SU02-C1 选择并切换作品 | 已验收 | `su02-work-switching`；`su02-pending-result-work-isolation` | 角色/统计扩展矩阵 | P2 |
| SC-SU02-C2 切换时重新加入 Channel | 已验收 | `su02-work-switching` | join 失败 UI | P2 |
| SC-SU02-C3 消息和上下文按作品隔离 | 已验收 | `su02-work-switching`；`au09-cross-work-memory-isolation`；`su02-artifact-projection-trace-isolation` | 角色/统计扩展矩阵 | P2 |
| SC-SU02-C4 pending LLM 请求不跨作品污染 | 已验收 | `su02-pending-result-work-isolation` | 无 | P0 closed |
| SC-SU02-D1 重启恢复上次打开作品 | 已验收 | `su02-work-restart-recovery` | OS-level preference 进程矩阵 | P2 |
| SC-SU02-D2 上次作品不可用时优雅降级 | 已验收 | `su02-work-restart-recovery` | 后端完全不可用/损坏数据 UX | P2 |

## 4. 验证记录

- [x] `bash scripts/tauri_slice_verify.sh --list`
- [x] 查看 `artifacts/slice-verify/su02-work-switching-tauri/summary.json`
- [x] 查看 `artifacts/slice-verify/su02-empty-start-unnamed-work-tauri/summary.json`
- [x] 查看 `artifacts/slice-verify/su02-work-lifecycle-management-tauri/summary.json`
- [x] 查看 `artifacts/slice-verify/su02-work-restart-recovery-tauri/summary.json`
- [x] 查看 `artifacts/slice-verify/su02-pending-result-work-isolation-tauri/summary.json`
- [x] 查看 `artifacts/slice-verify/su02-artifact-projection-trace-isolation-tauri/summary.json`
- [x] 本轮复跑局部测试：`mix test apps/novel_application/test/novel_application/work_service_test.exs apps/novel_web/test/novel_web/controllers/works_controller_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_test.exs`（27 tests, 0 failures）
- [x] 本轮复跑前端局部测试：`pnpm --dir frontend exec vitest run src/lib/__tests__/works.test.ts slice-verify/native-tauri-verifier.test.mjs`（140 tests, 0 failures）
- [x] 本轮复跑质量 manifest：`bash scripts/quality_manifest_check.sh`（通过；剩余 warning 均为既有其它 slice 缺 manifest，SU-02 无缺 manifest warning）
- [x] 本轮 task_done：`bash scripts/task_done.sh --skip-static-scan --slice SU02-file-level-closure`（`artifacts/task-done/20260620T161425Z/manifest.json`）
- [x] 本轮统一扫描：`bash scripts/ai_static_scan.sh --top 10`（17/18 pass；唯一 Top 10 为既有 gitleaks `accepted_risk`，0 touched-file finding，blocking=0）
- [x] 二轮复跑真实验收：`bash scripts/quality_accept.sh su02-work-switching --surface tauri`
- [x] 二轮复跑真实验收：`bash scripts/quality_accept.sh su02-empty-start-unnamed-work --surface tauri`
- [x] 二轮复跑真实验收：`bash scripts/quality_accept.sh su02-work-lifecycle-management --surface tauri`
- [x] 二轮复跑真实验收：`bash scripts/quality_accept.sh su02-work-restart-recovery --surface tauri`
- [x] 二轮复跑真实验收：`bash scripts/quality_accept.sh su02-pending-result-work-isolation --surface tauri`
- [x] 二轮复跑真实验收：`bash scripts/quality_accept.sh su02-artifact-projection-trace-isolation --surface tauri`

## 5. 决策日志

- 2026-06-21 — 按用户指定滚动顺序进入 SU-02 文件级审计，不采用 `tasks/NEXT.md` 队首作为优先级来源。
- 2026-06-21 — 当前 checkout 的 SU-02 证据链足以支撑 13/13 已验收：运行时切换、空库未命名、生命周期、restart recovery、pending 迟到归属和 artifact/projection/trace 隔离均有真实 Tauri summary；quality manifest 已覆盖全部 `su02-*` 场景。
- 2026-06-21 — 未发现需要本机实现的 P0/P1。后端完全不可用 UX、恢复/归档管理、大列表、异常失败态和 OS-level preference 进程级矩阵登记为 P2，不阻塞进入 SU-03。
- 2026-06-22 — 二轮缺口收敛时复核 SU-02 剩余项均为 P2；全部 6 个 SU-02 真实 Tauri quality 入口串行复跑通过，不需要新增实现或改动产品 runtime。SU-02 继续可进入 SU-03。

## 6. 试行反馈

- SU-02 证明由多条互补 driver 组成：不能只拿 `su02-work-switching` 证明完整文件级完成；必须同时保留 pending、restart、lifecycle、empty start 和 artifact/projection/trace 的证据。
