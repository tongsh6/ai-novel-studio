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
| T4 | 同步 SCENARIO-BLUEPRINT、acceptance README、project ledger 和 slice 索引 | done | 只作为事实台账，不改变用户指定顺序 |
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

## 6. 二轮剩余缺口矩阵（2026-06-22）

本轮不推翻 2026-06-21 文件级可交付结论，只复核已登记的 P1/P2、external blocker 和 cross-reference。二轮复跑的当前证据为 6 个 AU-10 quality/Tauri 入口：`au10-workbench-matrix-layout`、`au10-workbench-recovery-taskstate`、`au10-workbench-recovery-disconnect-timeout`、`au10-workbench-recovery-provider-timeout`、`au10-workbench-recovery-reconnect`、`au10-workbench-recovery-cancel-waiting`，均通过。AU-10 当前没有 external platform blocker。

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-10 本轮关闭 | 建议 checkpoint / slice | 是否满足继续到 AU-11 的二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU10-A1 真实工作台首屏 | 已验收 | 1280x800 baseline 已验收；更多 viewport / 右侧栏状态仍是扩展回归 | 补验收 | P2 | `au10-workbench-matrix-layout`：真实工作台 1280x800 无横向溢出、top status 单行、输入区和结构栏可见 | 后续 viewport/右侧栏扩展 driver | 否，P2 后续 | viewport/右侧栏扩展回归 | 是 |
| SC-AU10-A2 LLM health/model 真实显示 | 已验收 | live vendor 失败矩阵归 SU-01 P1；AU-10 当前仅消费健康状态 | cross-reference | P2 | `au10-workbench-matrix-layout`；SU-01 provider health/model evidence | SU-01 live provider matrix | 否，跨 SU-01 后续 | SU-01 live provider matrix | 是 |
| SC-AU10-A3 WebSocket 离线禁用输入 | 已验收 | 无本轮剩余缺口 | 无 | done | `au10-workbench-recovery-reconnect`：外部停服、离线禁用输入、重启后 rejoin、下一轮成功 | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-10 quality | 是 |
| SC-AU10-B1 发送消息 loading 生命周期 | 已验收 | 普通/失败/取消 loading 已验收；完整异步 LongRunner 恢复态缺真实生产消费者 | 补验收 | P1 | `au10-workbench-matrix-layout`、`au10-workbench-recovery-disconnect-timeout`、`au10-workbench-recovery-provider-timeout`、`au10-workbench-recovery-cancel-waiting` | 等批量生成/推演成为真实消费者后补 LongRunner recovery driver | 否；不为验收强造 LongRunner product hook | LongRunner recovery after real consumer | 是 |
| SC-AU10-B2 普通聊天不误触发执行态 | 已验收 | legacy no-MicroPlan 专用 slice 不在当前 AU-10 Tauri list；matrix 已覆盖当前证据 | 文档同步 | P2 | `au10-workbench-matrix-layout` 断言 ordinary chat completed without micro_plan | 如需要，重新登记专用 current Tauri entry | 否，P2 后续 | no-MicroPlan dedicated regression | 是 |
| SC-AU10-C1 候选方向卡片来自 TurnResult | 已验收 | 无本轮剩余缺口 | 无 | done | `au10-workbench-matrix-layout`、`au02-candidate-continuation`、`au02-candidate-adoption-bridge` | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-02/AU-10 quality | 是 |
| SC-AU10-C2 点击候选继续探索 | 已验收 | 无本轮剩余缺口 | 无 | done | `au02-candidate-continuation`；AU-10 matrix 覆盖候选授权 action | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-02 quality | 是 |
| SC-AU10-C3 ActionPanel 只显示授权 action | 已验收 | disabled/stale/idempotency 深矩阵还未形成统一 AU-10 视觉 driver；已有 AU-04/AU-06/Channel 确定性证据 | 补验收 | P1 | `au10-workbench-matrix-layout`、`au04-disabled-confirmation-action-ui`、`au04-stale-confirmation-ui`、`au04-confirm-idempotency-ui`、Channel action tests | 只做确定性 AU-10 action idempotency/stale/disabled follow-up，不做竞态不稳定 driver | 否；当前授权边界已有主证据 | `AU10-action-idempotency-stale-disabled` | 是 |
| SC-AU10-C4 确认/拒绝走真实 `author_action` | 已验收 | action_result 全状态 UI 未系统化；confirm/reject/cancel 主路径已有证据 | 补验收 | P1 | `au04-confirm-before-execute`、`au10-workbench-recovery-cancel-waiting`、AU-04 二轮 evidence | action_result deep matrix | 否；主链已关闭，深矩阵后续 | action_result deep matrix | 是 |
| SC-AU10-C5 10 种 UI card 渲染正确 | 部分实现 | 分散证据覆盖候选、确认、adoption、trace、projection；缺全 card visual matrix 与 unknown fallback 当前 driver | 补测试 / 补验收 | P1 | `au10-workbench-matrix-layout` + AU-02/AU-04/AU-05/AU-07/AU-08 cross evidence | 建立 `UICards` visual/behavior matrix，继续保证动作只来自 `available_actions` | 否；当前不阻塞主链验收 | AU10 card visual matrix | 是 |
| SC-AU10-D1 采纳/修改/放弃主流程 | 已验收 | 持久 adoption inbox / deep StateTrace 属 AU-05/AU-07 P1 | cross-reference | P1 | `au05-discard-author-action`、`p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`au10-workbench-matrix-layout` | AU-05 persistent inbox；AU-07 deep StateTrace | 否，跨 owner 已登记 | AU-05/AU-07 follow-up | 是 |
| SC-AU10-D2 真实首屏消费 task_state | 已测试 | RUNNING/CHECKPOINT/COMPLETED 已验收；FAILED 仍只有 Channel 局部测试；异步 LongRunner 缺真实消费者 | 补验收 | P1 | `au10-workbench-recovery-taskstate` 观察 WebSocket task_state frames：RUNNING/CHECKPOINT/COMPLETED；`workspace_channel_task_state_test.exs` 覆盖 FAILED | 补真实失败任务 UI driver；LongRunner 等真实消费者 | 否；成功链路已验收，FAILED 登记后续 | FAILED task_state UI / LongRunner after real consumer | 是 |
| SC-AU10-D3 超时/取消等待 | 已验收 | 完整异步 LongRunner 仍缺 | 补验收 | P1 | `au10-workbench-recovery-disconnect-timeout`、`au10-workbench-recovery-provider-timeout`、`au10-workbench-recovery-reconnect`、`au10-workbench-recovery-cancel-waiting` | 等真实 LongRunner consumer 后补恢复矩阵 | 否；现有 recovery 主链已闭环 | LongRunner recovery after real consumer | 是 |
| SC-AU10-E1 projection hint / 阅读模式 | 已验收 | refresh/rebuild/failed/no-write 专项归 AU-08 P1 | cross-reference | P1 | `p1-chapter-adoption-reading`、`p1-export-minimum`、`su02-artifact-projection-trace-isolation`、`au10-workbench-matrix-layout` | AU-08 projection refresh matrix | 否，AU-08 owner | AU-08 projection refresh matrix | 是 |
| SC-AU10-E2 trace / why 入口 | 已验收 | 历史 turn 查询 / developer view / 完整 replay 归 AU-07 P1 | cross-reference | P1 | `au07-trace-why-entry`、`au09-memory-create-recall`、`au10-workbench-matrix-layout` | AU-07 deep replay / old turn query | 否，AU-07 owner | AU-07 deep replay | 是 |
| SC-AU10-F1 Tauri UI 自动化验收 | 已验收 | 无本轮剩余缺口；6 个 AU-10 manifest 均在 quality acceptance | 文档同步 / 补验收 | done | 本轮复跑 6 个 AU-10 quality/Tauri 入口全部通过 | 保持 quality manifest 回归 | 否，已关闭 | `AU10-file-level-closure` | 是 |
| SC-AU10-F2 Tauri / Design-Driven 约束 | 部分实现 | copy 集中、hidden `data-*` 真实产品用途复核、更多状态 viewport 仍需治理；静态门禁覆盖基础边界 | 修设计偏差 / 验收卫生 | P1 | `au10-workbench-matrix-layout`、`frontend_audit.sh`、`check_design_trace.sh`、static scan | 单独 UI hygiene checkpoint，扫描 copy/hidden metadata/viewport | 否；不影响当前工作台主链二轮退出 | AU10 UI hygiene checkpoint | 是 |

二轮退出判断：AU-10 本轮无需要先关闭的新增 P0/P1；现有 P1/P2 均已明确 owner、证据边界和恢复路径。当前文件满足进入 AU-11 的二轮退出标准。

## 7. 验证

- [x] 外部自动化驱动真实页面的场景化验收：6 个 AU-10 Tauri driver 已接入并通过 quality acceptance。
- [x] 后端 / Channel / 组件局部验证：本 checkpoint 不改产品代码；沿用已有 `workspace_channel_task_state_test.exs` / action 相关测试作为局部证据。
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh` 不适用：本 checkpoint 未改 `frontend/src`。
- [x] `bash scripts/task_done.sh --skip-static-scan`：本轮最终门禁生成 manifest，并由 `node scripts/task_done_check.mjs` 校验。
- [x] `bash scripts/ai_static_scan.sh --top 10`：17 pass / 1 fail / 0 skipped；唯一 Top 10 为历史 `gitleaks generic-api-key` accepted_risk，0 touched-file finding，blocking=0。

## 8. 决策日志

- 2026-06-21 — 本轮按用户指定 SU/AU/E2E 顺序推进到 AU-10，不按 `tasks/NEXT.md` 队首排序。AU-10 不再把历史 `au10-micro-plan-entry` / `au10-ordinary-chat-no-micro-plan` browser/native support 当作当前 Tauri list 主证据；文件级主证据以 `scripts/tauri_slice_verify.sh --list` 的 6 个 AU-10 Tauri entries 为准。
- 2026-06-21 — 完整异步 LongRunner streaming 不作为当前 AU-10 P0 blocker：当前没有真实批量生成/推演生产消费者，若为了 AU-10 强造 harness 容易变成验收专用产品逻辑。登记为 P1 cross-reference，等真实消费者出现后关闭。
- 2026-06-21 — 双击/旧按钮 stale 的外部真实页面 harness 延续 `AU10-action-idempotency-stale-disabled.md` 的 Option A：后端 stale/invented/disabled/idempotency 有确定性局部证据，外部 UI 竞态不强塞成不稳定验收脚本。
- 2026-06-21 — `quality_accept` 复跑 6 个 AU-10 Tauri 入口均通过。`au10-workbench-matrix-layout` 首次经 wrapper 运行时曾在 Tauri build 阶段 143 退出，底层 driver 复跑通过后 wrapper 复跑也通过；未形成产品断言失败。
- 2026-06-22 — 二轮缺口收敛不回退文件级可交付结论。6 个 AU-10 quality/Tauri 入口串行复跑通过；LongRunner、FAILED task_state、card/action 深矩阵、projection/trace 深链路和 UI hygiene 继续按 P1/P2 或 cross-owner 登记，当前无 AU-10 本轮必须关闭的 P0/P1，可进入 AU-11。

## 9. 试行反馈

文件级 closure 需要把“当前 runnable evidence”和“历史 artifact/background evidence”分开写，否则 AU-10 很容易被单个 checkpoint 或旧 browser driver 误标完成。
