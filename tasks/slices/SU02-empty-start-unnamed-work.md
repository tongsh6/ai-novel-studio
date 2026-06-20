# SU02 Empty Start Unnamed Work

- 状态：checkpoint closed（空工作区自动未命名作品已由真实 Tauri 验收证明；SU-02 全量矩阵未完成）
- 类型：UI Contract Slice / Acceptance Slice / System Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

首次打开软件时，即使数据库中没有任何 Work，作者也能直接进入一个真实持久化的“未命名作品”，它不是 `lobby`、不是 mock id，并且后续可重命名而不丢失已经产生的对话。多个未命名作品同时存在时，作品菜单必须能让作者区分它们。

这个 checkpoint 关闭 `SC-SU02-B2` 的空库启动、重命名保留上下文和未命名作品可区分闭环；不覆盖 C3 的 artifact / projection / trace 全矩阵，也不新增归档/恢复管理入口。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-02-work-switching.md` `SC-SU02-B2`；`docs/design/acceptance/SCENARIO-BLUEPRINT.md` 的 SU-02 条目；`NovelApplication.WorkService.list/create/ensure_initial`；`NovelWeb.WorksController`；`WorkspaceChat.loadWorksAndOpenInitial`；`frontend/src/lib/works.ts` 的 Work title helper。
- Invariant: 空 Work 列表启动时必须创建且加入一个真实持久化 `work_id`，不能停在 `lobby/mock`；重命名不能改变 `work_id` 或清掉现有消息；重复未命名作品在作品菜单里必须可见区分。
- Boundary: 切穿 `novel_application` / `novel_web` Work API、真实 `WorkspaceChat` 启动流、外部 Tauri verifier 和 quality manifest；不修改 provider production runtime，不把 fixture provider 注册进 production app，不在产品代码读取 slice id、env、query 或 hidden DOM hook。
- Consumer: 第一个真实消费者是 Tauri 工作台顶部作品菜单、聊天输入框和重命名 dialog。
- Proof: `bash scripts/tauri_slice_verify.sh su02-empty-start-unnamed-work` 驱动真实 Tauri 工作台；`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs` 覆盖 verifier；`pnpm --dir frontend test -- works.test.ts` 覆盖重复标题 helper。
- Acceptance Driver: `su02-empty-start-unnamed-work`，由外部 Playwright driver 从空数据库启动真实工作台、发送消息、重命名、再快速创建两个未命名作品并核对可见区分。产品代码不新增验收感知逻辑。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增基础类型。 |
| novel_domain | no | 不新增领域抽象。 |
| novel_agent | no | 不改 provider/runtime。 |
| novel_application | yes | 新增 WorkService 幂等初始 Work 入口。 |
| novel_persistence | yes | 新增 WorkRepo 幂等初始 Work 事务。 |
| novel_web | yes | 新增 `/api/works/ensure-initial`，不改变普通创建语义。 |
| frontend | yes | 作品菜单为重复标题显示序号标签；新增外部 driver/verifier。 |
| docs/design | yes | 回填 SU-02、总蓝图和 acceptance README。 |
| quality | yes | 新增 scenario manifest 并接入总表。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 重复作品标题在菜单中可见区分 | done | 用集中 copy 的“第 N 个”标签，不暴露内部 Work UUID。 |
| T2 | 空库启动专用外部 Tauri driver / verifier / 单测 | done | 跳过 seed 后证明真实工作台自动创建 Work。 |
| T3 | 注册 tauri_slice_verify 与 quality manifest | done | 新增 `su02-empty-start-unnamed-work`。 |
| T4 | 回填 SU-02 文件级矩阵和缺口状态 | done | 本 checkpoint 当时关闭 B2；后续 `SU02-artifact-projection-trace-isolation` 已关闭 C3，SU-02 当前为 13/13 已验收。 |
| T5 | 跑真实验收、局部验证、task_done、static scan | done | 真实验收、局部/全量测试、I1/I2/I3、task_done 均已通过；static scan 的本次 touched-file Credo 已修复，剩余 gitleaks 为历史 accepted risk。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh su02-empty-start-unnamed-work`
- [x] quality 场景入口：`bash scripts/quality_accept.sh su02-empty-start-unnamed-work --surface tauri`（沙箱内 Mix.PubSub `:eperm` 后按权限规则非沙箱重跑通过）
- [x] 前端 verifier 局部验证：`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] 前端 Work helper 局部验证：`pnpm --dir frontend exec vitest run src/lib/__tests__/works.test.ts`
- [x] targeted 后端验证：`mix test apps/novel_application/test/novel_application/work_service_test.exs apps/novel_web/test/novel_web/controllers/works_controller_test.exs`
- [x] 全量后端验证：`mix compile --warnings-as-errors`、`mix test`、xref、arch check
- [x] 全量前端验证：`pnpm --dir frontend typecheck`、`pnpm --dir frontend lint`、`pnpm --dir frontend test`
- [x] scenario invariants：I1 / I2 / I3（沙箱内 Mix.PubSub `:eperm` 后按权限规则非沙箱重跑通过）
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/frontend_audit.sh`（0 fail；本机 DMG bundle 保留既有 dev warning）
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan --slice su02-empty-start-unnamed-work`
- [x] `bash scripts/ai_static_scan.sh --top 10`（Credo touched-file finding 已修复；剩余 gitleaks 为历史 accepted risk）

## 6. 决策日志

- 2026-06-20 — SU-02 文件级复核后，`SC-SU02-B2` 仍为 P1：实现里已有空库自动 `createWork("未命名作品")`，但旧 Tauri harness 总会 seed Work，导致没有真实页面证据；重复“未命名作品”在菜单里也不可区分。
- 2026-06-20 — 空库验收通过跳过 seed 脚本和 slice server 默认 seed 实现；这是外部 harness 控制，不进入产品 runtime。产品侧只补真实用户可见的重复标题区分。
- 2026-06-20 — 真实 Tauri 首跑发现设计偏差：dev/StrictMode 启动会从空库并发创建两个“未命名作品”，且工作台标题把真实“未命名作品”归一为“当前作品”。修复为启动流走后端幂等 `ensure_initial`，普通快速创建仍走 `POST /api/works`，并把“未命名作品”保留为真实可见标题。
- 2026-06-20 — `su02-empty-start-unnamed-work` 已通过真实 Tauri 验收，summary 记录 `turn_3`、单个自动 Work、重命名后消息保留、两个后续未命名 Work 在菜单可区分。

## 7. 试行反馈

- 空库启动类场景不能复用默认 seed 脚本；后续类似验收应显式记录 seed 为空，并在 evidence 中保留 seed/backend log。
