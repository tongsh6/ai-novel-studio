# AU10 File-Level Closure

- 状态：done
- 类型：Acceptance Slice
- 启动日期：2026-06-21

## 1. 用户 / 系统目标

把 `docs/design/acceptance/author/AU-10-workbench-ui.md` 从历史 checkpoint 叙述推进为文件级可交付状态：逐场景对账真实工作台、server-authorized action、task_state、trace/why、adoption、reading projection、provider failure、WebSocket reconnect、cancel waiting 和 provider timeout 证据；把当前 6 个可复跑 AU-10 Tauri driver 接入 quality acceptance；明确剩余 P1/P2 不是当前文件级 P0 blocker。

本 slice 不新增产品行为，只同步验收真源、quality manifest 和台账。完整异步 LongRunner streaming 仍等真实批量生成/推演消费者出现后再做，不用当前同步任务伪造验收入口。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-10-workbench-ui.md`、`docs/design/acceptance/SCENARIO-BLUEPRINT.md`、`docs/design/07-workbench-ui-contract.md`、`docs/design/contracts/VS-05-ui-roundtrip-contract-pack.md`、`quality/acceptance/scenarios/*.yml`。
- Invariant: Workbench 只消费 TurnResult；业务动作只能来自 `available_actions`；candidate selection 不等于 adoption；task_state/trace/projection 由真实 Channel/TurnResult/StateTrace 驱动；provider failure/timeout/cancel/reconnect 不写 production content；不添加产品验收钩子。
- Boundary: 本 checkpoint 只改 `docs/design/acceptance`、`docs/project-ledger.md`、`tasks/`、`quality/acceptance`。不改 `frontend/src`、umbrella apps、provider runtime、fixture provider 注册或 Tauri runtime。
- Consumer: `bash scripts/quality_accept.sh <au10-*> --surface tauri`、`bash scripts/tauri_slice_verify.sh <au10-*>`、AU-10 文件级矩阵、SCENARIO-BLUEPRINT 和 project ledger。
- Proof: 6 个 AU-10 当前 Tauri quality acceptance；`bash scripts/quality_manifest_check.sh`；`bash scripts/task_done.sh --skip-static-scan`；`node scripts/task_done_check.mjs`；`bash scripts/ai_static_scan.sh --top 10`；`git diff --check`。
- Acceptance Driver: `au10-workbench-matrix-layout`、`au10-workbench-recovery-taskstate`、`au10-workbench-recovery-disconnect-timeout`、`au10-workbench-recovery-provider-timeout`、`au10-workbench-recovery-reconnect`、`au10-workbench-recovery-cancel-waiting`。产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改后端代码 |
| novel_domain | no | 不改领域代码 |
| novel_agent | no | 不改 provider/runtime |
| novel_application | no | 不改 application 编排 |
| novel_persistence | no | 不改 schema/repo |
| novel_web | no | 不改 Channel/controller |
| frontend | no | 不改 `frontend/src` 或 Tauri app |
| docs/design | yes | 更新 AU-10 验收矩阵、blueprint、README |
| quality | yes | 登记当前可复跑 AU-10 Tauri manifests |
| tasks | yes | 登记本文件级 closure 和恢复路径 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 文件级审计 AU-10 17 个场景 | done | 已按当前 Tauri artifacts、quality index、UI contract 和已有 slice 对账 |
| T2 | 接入 6 个 AU-10 当前 Tauri quality manifest | done | 当前 `tauri_slice_verify --list` 中的 AU-10 Tauri entries 已挂入 `quality/acceptance/scenarios.yml` |
| T3 | 重写 AU-10 验收文件为文件级矩阵 | done | 状态只使用已验收/已测试/已实现未验收/部分实现/未实现/不确定 |
| T4 | 同步 SCENARIO-BLUEPRINT、acceptance README、project ledger、NEXT | done | 只作为事实台账，不改变用户指定顺序 |
| T5 | 复跑 AU-10 quality acceptance 与质量门禁 | done | 6 个 AU-10 Tauri quality acceptance 已通过；task_done/static scan 在本轮最终门禁中记录 |

## 5. 文件级对账结论

| 分类 | 当前结论 |
|---|---|
| 已验收 | 14/17：真实入口、provider health、WebSocket reconnect、普通消息/loading、no-MicroPlan、候选卡/继续探索/授权 action、确认取消、adoption、provider failure/timeout、projection/reading、trace/why、Tauri UI 自动化 |
| 已测试 | 1/17：task_state FAILED 分支仍是 Channel 局部测试，真实工作台已验收 RUNNING/CHECKPOINT/COMPLETED |
| 部分实现 | 2/17：全 card 视觉/未知类型降级、Tauri/Design hygiene 深矩阵 |
| P0 | 无当前文件内开放 P0 |
| P1 | 完整异步 LongRunner streaming、FAILED task_state 真实页面、全 card/action 深矩阵、projection refresh/rebuild/failed、trace/replay 深链路、文案集中和 hidden metadata hygiene |
| P2 | legacy browser micro-plan 入口现代化、更多 viewport/右侧栏状态、更多设计回归截图 |

## 6. 验证

- [x] 外部自动化驱动真实页面的场景化验收：6 个 AU-10 Tauri driver 已接入并通过 quality acceptance。
- [x] 后端 / Channel / 组件局部验证：本 checkpoint 不改产品代码；沿用已有 `workspace_channel_task_state_test.exs` / action 相关测试作为局部证据。
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh` 不适用：本 checkpoint 未改 `frontend/src`。
- [x] `bash scripts/task_done.sh --skip-static-scan`：本轮最终门禁生成 manifest，并由 `node scripts/task_done_check.mjs` 校验。
- [x] `bash scripts/ai_static_scan.sh --top 10`：17 pass / 1 fail / 0 skipped；唯一 Top 10 为历史 `gitleaks generic-api-key` accepted_risk，0 touched-file finding，blocking=0。

## 7. 决策日志

- 2026-06-21 — 本轮按用户指定 SU/AU/E2E 顺序推进到 AU-10，不按 `tasks/NEXT.md` 队首排序。AU-10 不再把历史 `au10-micro-plan-entry` / `au10-ordinary-chat-no-micro-plan` browser/native support 当作当前 Tauri list 主证据；文件级主证据以 `scripts/tauri_slice_verify.sh --list` 的 6 个 AU-10 Tauri entries 为准。
- 2026-06-21 — 完整异步 LongRunner streaming 不作为当前 AU-10 P0 blocker：当前没有真实批量生成/推演生产消费者，若为了 AU-10 强造 harness 容易变成验收专用产品逻辑。登记为 P1 cross-reference，等真实消费者出现后关闭。
- 2026-06-21 — 双击/旧按钮 stale 的外部真实页面 harness 延续 `AU10-action-idempotency-stale-disabled.md` 的 Option A：后端 stale/invented/disabled/idempotency 有确定性局部证据，外部 UI 竞态不强塞成不稳定验收脚本。
- 2026-06-21 — `quality_accept` 复跑 6 个 AU-10 Tauri 入口均通过。`au10-workbench-matrix-layout` 首次经 wrapper 运行时曾在 Tauri build 阶段 143 退出，底层 driver 复跑通过后 wrapper 复跑也通过；未形成产品断言失败。

## 8. 试行反馈

文件级 closure 需要把“当前 runnable evidence”和“历史 artifact/background evidence”分开写，否则 AU-10 很容易被单个 checkpoint 或旧 browser driver 误标完成。
