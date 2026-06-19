# SU02 Work Lifecycle Management

- 状态：checkpoint closed（作品生命周期最小真实 Tauri 闭环已补；SU-02 全量矩阵未完成）
- 类型：UI Contract Slice / Acceptance Slice / System Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

作者在真实工作台里管理作品时，必须能完成命名新增、修改作品名、安全删除或移出作品三件基础动作。作品是后续会话、记忆、产物、阅读投影和 trace 的边界；如果作品只能快速创建一串“未命名作品”，或者删除当前作品后仍停在旧 `work_id`，后续所有跨作品隔离验收都会被污染。

本 slice 只补作品生命周期的最小闭环，不重做 SU-02 已有的运行时切换主链，也不把物理删除作为首版默认行为。删除语义先定义为安全移出：将 Work 标记为 `DISCARDED`，默认作品列表不再展示；如后续产品明确“归档”语义，再使用 `ARCHIVED`。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-02-work-switching.md` `SC-SU02-B3/B4/B5`；`docs/design/acceptance/SCENARIO-BLUEPRINT.md` 的“作品生命周期管理闭环”；`tasks/slices/v3/VS-09-work-management.md` 的 Work Management 边界；`apps/novel_persistence/lib/novel_persistence/schemas/work.ex` 的 `title/status/revision`。
- Invariant: 作品 mutation 必须经 `novel_web -> novel_application -> novel_persistence`；重命名不得改变 `work_id` 或丢失当前 session/pending/档案；删除或移出当前作品后必须切到另一个真实 Work 或新建未命名 Work，不能停在 `lobby` 或已移出的 `work_id`；产品代码不得新增验收感知逻辑。
- Boundary: 预计切穿 `novel_persistence`、`novel_application`、`novel_web`、`frontend`、`quality` 和外部 Tauri verifier；不应修改 `novel_agent`；不应为本 slice 修改 Foundation enum，除非发现 Work status 已有契约不足且先补设计/ADR。
- Consumer: 第一个真实消费者是 `frontend/src/components/WorkspaceChat.tsx` 的作品菜单；HTTP 消费者是 `frontend/src/lib/works.ts`；后端入口是 `NovelWeb.WorksController`。
- Proof: 后端 WorkRepo/WorkService/WorksController 测试覆盖 rename/discard、冲突和 not_found；前端 API/组件测试覆盖命名新增、重命名失败保留旧状态、删除当前作品后的切换策略；外部 Tauri driver 从真实工作台操作作品菜单完成 `su02-work-lifecycle-management`；最终跑架构、前端和静态扫描门禁。
- Acceptance Driver: 新增或扩展 `frontend/slice-verify/external-ui-driver.mjs` 的外部用户级 driver，注册到 `scripts/tauri_slice_verify.sh` 与 `quality/acceptance/scenarios/*.yml`。driver 只能使用用户可见语义、日志、截图和持久化结果，不允许生产代码读取 slice id、query、localStorage 或 hidden DOM hook。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 使用现有 `AdoptionStatus` 值，不新增基础 enum。 |
| novel_domain | no | Work 目前是 persistence schema + application 用例，不在 domain 新建未来抽象。 |
| novel_agent | no | 作品生命周期不应进入 provider/runtime。 |
| novel_application | yes | `WorkService` 增加 rename / discard 或等价安全移出用例。 |
| novel_persistence | yes | `WorkRepo` 增加 update title、discard/status mutation、默认 list 过滤移出作品。 |
| novel_web | yes | `WorksController` / router 增加 update 与 discard 路由，错误形态保持 JSON。 |
| frontend | yes | `works.ts` API、`WorkspaceChat` 作品菜单、必要 dialog 和集中 copy。 |
| docs/design | yes | SU-02、总蓝图、acceptance README 已先补口径；实现后回填证据。 |
| quality | yes | 新增 scenario manifest 和 Tauri verifier 入口。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 补 SU-02 与总蓝图的生命周期场景 | done | 已新增 B3/B4/B5 和 P0 场景族。 |
| T2 | 补 Work persistence/application/web 生命周期 API | done | rename 使用 `revision` / optimistic lock；discard 默认从列表移出。 |
| T3 | 补前端作品菜单命名新增、重命名、删除确认 | done | 文案已进 `frontend/src/lib/copy.ts`，没有新增验收专用 hook。 |
| T4 | 补外部 Tauri driver 与 quality scenario | done | slice id：`su02-work-lifecycle-management`；已接 `tauri_slice_verify` 与 quality acceptance。 |
| T5 | 补测试与门禁闭环 | done | 后端、前端、Tauri、quality acceptance、架构、设计追溯和 static scan 均已跑完；static scan 仅剩既有 gitleaks accepted risk。 |
| T6 | 回填验收文档证据与剩余缺口 | done | 已回填 SU-02 / 总蓝图 / acceptance README；不把最小闭环写成 SU-02 全量 done。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh su02-work-lifecycle-management`
- [x] quality 场景入口：`bash scripts/quality_accept.sh su02-work-lifecycle-management --surface tauri`
- [x] 后端局部验证：`mix test apps/novel_persistence/test/novel_persistence/work_repo_test.exs apps/novel_application/test/novel_application/work_service_test.exs apps/novel_web/test/novel_web/controllers/works_controller_test.exs`
- [x] 架构边界：`mix xref graph --format cycles --label compile-connected --fail-above 0`、`mix run scripts/arch_check.exs`
- [x] 前端验证：`pnpm --dir frontend typecheck`、`pnpm --dir frontend lint`、`pnpm --dir frontend test`
- [x] 设计追溯：`bash scripts/check_design_trace.sh`
- [x] 静态扫描：`bash scripts/ai_static_scan.sh --top 10`（17/18 pass；剩余 gitleaks 为既有 `accepted_risk`，blocking=0）

## 6. 决策日志

- 2026-06-19 — 用户指出当前作品级“新增、修改作品名字、删除作品”缺失。先补场景化验收蓝图和相关文档，再进入功能实现。
- 2026-06-19 — 删除语义首版定义为安全移出/废弃，不做物理删除；删除当前作品后必须立刻落到另一个真实 Work 或新建未命名 Work。
- 2026-06-19 — `su02-work-lifecycle-management` 外部 Tauri driver 已通过，覆盖命名新增、重命名、安全移出当前作品、fallback 和默认列表过滤。

## 7. 试行反馈

- 运行时切换最小闭环不能覆盖作品生命周期。当前已补作品生命周期最小闭环；后续 SU-02 汇报仍必须拆分“已有最小切换/生命周期证据”和“pending 迟到、重启恢复、完整隔离矩阵仍缺”。
- `tasks/NEXT.md` 不是本轮入口；本轮从 `SCENARIO-BLUEPRINT.md` 的 SU-02 当前缺口推进。
