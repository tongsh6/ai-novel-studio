# SU02 Pending Result Work Isolation

- 状态：checkpoint closed（慢回复迟到结果按作品归属已由真实 Tauri 验收证明；SU-02 全量矩阵未完成）
- 类型：UI Contract Slice / Acceptance Slice / System Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

作者在作品 A 发出一轮较慢的 AI 回复后，如果立即切到作品 B，A 的迟到回复不能显示到 B，也不能改变 B 的 loading / task 状态。作者切回 A 时，应能从真实会话恢复看到 A 的完成结果或明确状态。

这个 checkpoint 只关闭 `SC-SU02-C4` 的迟到结果归属证据，不补完整 artifact / projection / trace 全矩阵，也不新增作品归档管理入口。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-02-work-switching.md` `SC-SU02-C4`；`docs/design/acceptance/SCENARIO-BLUEPRINT.md` 的“作品切换隔离闭环”；`WorkspaceChannel` 的 `work_id/session_id` 注入与 `WorkSessionService.resume/1`；`frontend/src/lib/works.ts` 的 `isCurrentWorkConnection`。
- Invariant: 慢回复迟到时，当前作品 B 不渲染作品 A 的 assistant 结果；B 的 loading / task 状态不被 A 清理或污染；切回 A 后恢复出的 transcript 属于 A 的 `work_id/session_id`，且包含 A 的完成结果。
- Boundary: 切穿 `novel_agent` test/support provider、外部 Tauri verifier、quality manifest、tasks 和 acceptance docs；不修改 production `frontend/src`、`apps/*/lib` runtime，也不把 fixture provider 注册进 production runtime。
- Consumer: 第一个真实消费者是 `frontend/src/components/WorkspaceChat.tsx` 的作品菜单与消息流；后端入口是真实 `WorkspaceChannel`。
- Proof: `bash scripts/tauri_slice_verify.sh su02-pending-result-work-isolation` 驱动真实 Tauri 工作台；`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs` 覆盖 verifier；后端局部测试覆盖 SliceVerify provider 的慢响应只由作者 nonce 触发。
- Acceptance Driver: `su02-pending-result-work-isolation`，由 `frontend/slice-verify/external-ui-driver.mjs` 像用户一样发送作品 A 消息、打开可见作品菜单切到 B、等待 A 结果迟到、再从菜单切回 A。产品代码不读取 slice id、URL query、localStorage 或 hidden DOM hook，不新增自动输入/点击/采纳逻辑。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增基础类型。 |
| novel_domain | no | 不新增领域抽象。 |
| novel_agent | yes | 只改 `apps/novel_agent/test/support/provider/slice_verify.ex`，用于外部验收制造慢响应。 |
| novel_application | no | 复用现有 DialogueGateway / WorkSession 持久化。 |
| novel_persistence | no | 复用现有 transcript 持久化与 work/session 隔离。 |
| novel_web | no | 复用现有 Channel work_id/session_id 注入。 |
| frontend | yes | 只改 slice driver/verifier，不改生产 React。 |
| docs/design | yes | 回填 SU-02、总蓝图和 acceptance README。 |
| quality | yes | 新增 scenario manifest 并接入总表。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 新增慢回复验收 provider 触发条件 | done | 限定 test/support provider 和作者 nonce，不进 production runtime。 |
| T2 | 新增外部 Tauri driver / verifier / 单测 | done | 真实菜单 A→B→A，验证 B 不显示 A 迟到结果且 A 可恢复。 |
| T3 | 注册 tauri_slice_verify 与 quality manifest | done | 新增 `su02-pending-result-work-isolation`。 |
| T4 | 回填 SU-02 文件级矩阵和缺口状态 | done | 不把 artifact/projection/trace 全矩阵写成 closed。 |
| T5 | 跑真实验收、局部验证、task_done、static scan | done | static scan 剩既有 gitleaks `accepted_risk`，0 touched、blocking=0。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh su02-pending-result-work-isolation`
- [x] quality 场景入口：`bash scripts/quality_accept.sh su02-pending-result-work-isolation --surface tauri`（沙箱内 Mix.PubSub `:eperm` 后按权限规则非沙箱重跑通过）
- [x] 前端 verifier 局部验证：`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] provider 局部验证：`mix test apps/novel_agent/test/novel_agent/provider/slice_verify_test.exs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan --slice su02-pending-result-work-isolation`
- [x] `bash scripts/ai_static_scan.sh --top 10`（17/18 pass；唯一 gitleaks finding 为既有 `accepted_risk`，0 touched、blocking=0）

## 6. 决策日志

- 2026-06-20 — SU-02 文件级审计后，C4 是本文件仍未闭合的 P0：现有 `su02-work-switching` 只能证明切到 B 后不显示 A 的消息，不能证明真实迟到 turn_result 只归属 A 且切回 A 可恢复。
- 2026-06-20 — 慢响应只放在 `NovelAgent.Test.Provider.SliceVerify` 中，由作者输入里的 `SU02SLOW` nonce 触发；不在生产 runtime 增加验收开关或 provider 注册。
- 2026-06-20 — `su02-pending-result-work-isolation` 已通过真实 Tauri 验收：作品 A 慢回复 `turn_3` 完成在原 `work_id`，作品 B 不显示 A 文本且不残留 loading，切回 A 后 transcript_count=2 并恢复完成 turn。
- 2026-06-20 — checkpoint closed：后端/前端/架构/quality/task_done/static scan 已跑完；`ai_static_scan` 唯一 Top 10 是历史 `tools/company-console/server/config.mjs:4` gitleaks accepted risk，不在本次 touched files。

## 7. 试行反馈

- 当前 `SC-SU02-C4` 可关闭，但不能把它外推为 artifact/projection/trace 全矩阵完成；这些仍归 `SC-SU02-C3` 后续。
