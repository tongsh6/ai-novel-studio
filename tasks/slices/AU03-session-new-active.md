# AU03 Session New Active / 新建作品内会话

- 状态：checkpoint closed
- 类型：Acceptance Slice / UI Contract Slice / Persistence Slice
- 启动日期：2026-06-19
- 来源：`docs/design/acceptance/author/AU-03-context.md` SC-AU03-C2/C6、`docs/design/acceptance/SCENARIO-BLUEPRINT.md` P0 作品内会话管理闭环。

## 1. 用户 / 系统目标

作者在同一作品内能明确新建一次空白会话，系统把它设为当前 active session，旧 active session 转入历史只读边界。新会话不能继承旧 transcript；后续发送消息必须落到新 session。

## 2. 开工检查

- Contract: `WorkSessionService.create/2`、`WorkSessionsController.create/2`、AU-03 SC-AU03-C2/C6、`WorkspaceChat` 真实工作台 session rail。
- Invariant: 同一 work 只有一个 active session；新建空白会话属于当前 Work；旧 active session 变为 `EXITED` 且 transcript 保留；缺失 work 不能创建孤儿 session。
- Boundary: 修改 `novel_persistence` session repo、`novel_application` session use case、`novel_web` sessions controller、`frontend` 工作台 session list；不修改 provider/runtime，不新增验收感知逻辑。
- Consumer: `WorkspaceChat` 右侧会话区的“新建会话”按钮，以及 `POST /api/works/:work_id/sessions`。
- Proof: `mix test apps/novel_persistence/test/novel_persistence/work_session_repo_test.exs apps/novel_application/test/novel_application/work_session_service_test.exs apps/novel_web/test/novel_web/controllers/work_sessions_controller_test.exs`；`pnpm test -- src/components/WorkspaceChat.availableActions.test.tsx src/lib/__tests__/sessions.test.ts`；`pnpm test -- slice-verify/native-tauri-verifier.test.mjs`；`bash scripts/tauri_slice_verify.sh au03-session-new-active`。
- Acceptance Driver: `bash scripts/tauri_slice_verify.sh au03-session-new-active`。外部 Playwright/Tauri driver 从真实页面点击“新建会话”，证明旧 active 进入 `EXITED` 只读历史、新 active transcript 为空、socket rejoin 到新 session、下一轮消息绑定新 session，且 `context.assemble.done.has_conversation=false`。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改 enum / Result |
| novel_domain | no | 不改领域 struct |
| novel_agent | no | 不改 provider |
| novel_application | yes | `WorkSessionService.create/2` 校验 work 存在并创建新 active session |
| novel_persistence | yes | 新增 `WorkSessionRepo.create_active/1`，退出旧 active session |
| novel_web | yes | sessions create 缺失 work 返回 404 |
| frontend | yes | `WorkspaceChat` session rail 新增新建会话入口 |
| docs/design | yes | 更新 AU-03 和蓝图真实状态 |
| quality | yes | 新增 `quality/acceptance/scenarios/au03-session-new-active.yml` 并登记到 `quality/acceptance/scenarios.yml` |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 创建 active session 时退出同作品旧 active | done | `WorkSessionRepo.create_active/1` |
| T2 | API create 拒绝不存在的 work | done | 防孤儿 session |
| T3 | 工作台 session rail 新增“新建会话”入口 | done | 使用 `createWorkSession` 后复用 `openWork` rejoin |
| T4 | 补局部测试 | done | persistence/application/web/frontend |
| T5 | 外部真实页面验收 | done | `bash scripts/tauri_slice_verify.sh au03-session-new-active` |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收
- [x] 后端 / Channel / 组件局部验证
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh`

当前真实 Tauri 证据：

- `artifacts/slice-verify/au03-session-new-active-tauri/summary.json`
- `artifacts/slice-verify/au03-session-new-active-tauri/ui-state.json`
- `artifacts/slice-verify/au03-session-new-active-tauri/app-log/2026-06-19.jsonl`

## 6. 决策日志

- 2026-06-19 — 不把低层 `WorkSessionRepo.create/1` 改成强制单 active；测试和种子仍需要显式构造各种 session 状态。真实用例入口改走 `create_active/1`，保证 UI/API 创建新会话时旧 active 进入 `EXITED`。
- 2026-06-19 — 前端创建后复用 `openWork`，而不是只改 React state。原因是 Phoenix Channel join payload 持有 `session_id`，必须重新 join 才能保证下一轮消息落到新 session。
- 2026-06-19 — `au03-session-new-active` 外部 Tauri 验收闭环：新建 action 从真实 session toolbar 发起；新 active `transcript_count=0`；旧 active 可按“默认会话”搜索并只读打开；返回新 active 后首轮 `turn_3` 的 `context.assemble.done.has_conversation=false`。

## 7. 试行反馈

- AU-03 文档中“session API/UI 未发现”的旧口径已经过期；本 checkpoint 已形成真实 Tauri 闭环，但不代表 AU-03 全量完成。仍缺从历史会话继续分支、搜索命中 turn 定位/高亮、归档过滤当前入口复跑、最新作品背景 SSOT 和完整 replay 页面。
