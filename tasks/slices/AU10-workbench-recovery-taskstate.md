# AU10 Workbench Recovery TaskState / 工作台恢复态 task_state

- 状态：checkpoint closed
- 类型：UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-17
- 来源：`tasks/NEXT.md` Order 26；`docs/design/acceptance/author/AU-10-workbench-ui.md` SC-AU10-D2 / AU10-GAP-07 / AU10-GAP-11。

## 1. 用户 / 系统目标

作者通过真实工作台触发可见产品动作时，顶部任务状态必须消费正式 `task_state` 事件，能区分 RUNNING / CHECKPOINT / COMPLETED / FAILED，而不是只在 store 或局部测试里存在。

本 checkpoint 先闭环 `task_state` 生命周期：复用现有真实「导出全书」按钮作为可见同步长任务入口，后端通过 `LongRunTaskLog` 记录并广播生命周期，前端状态条显示完成态。断线重连、LLM 超时/取消等待和完整后台 LongRunner streaming 仍是 AU-10 recovery 后续缺口，不在本 checkpoint 内假装完成。

## 2. 开工检查

- Contract: `TaskPhase` / `Status`、`LongRunTaskLog`、`TaskRunner.track/3`、`WorkspaceChannel task_state`、`WorkspaceChat longRun`。
- Invariant: `task_state` 必须来自正式 Channel 事件；后台任务 RUNNING / CHECKPOINT / FAILED / COMPLETED 时，真实首屏不得仍显示“无任务”。
- Boundary: 本 checkpoint 涉及 `novel_application`、`novel_persistence`、`novel_web`、`frontend` 和 `scripts/tauri_slice_verify.sh`；不改 provider runtime、不改 persistence schema、不新增验收感知开关。
- Consumer: `WorkspaceChat` 顶部任务状态条；外部 Tauri driver 验证真实 UI 可见状态。
- Proof: Channel 回归、前端 runtime/verifier 测试、`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-taskstate`。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 通过真实页面生成并采纳正文，进入阅读模式点击“导出全书”，观察 websocket `task_state` frame 和返回工作台后的“任务完成”；产品代码不读取 slice id/env/query/localStorage。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 复用既有 `TaskPhase` / `Status` enum。 |
| novel_domain | no | 不新增领域对象。 |
| novel_agent | no | 不改 provider / agent runtime。 |
| novel_application | yes | `TaskRunner.track/3` 包裹同步产品动作生命周期。 |
| novel_persistence | yes | `LongRunTaskLog.fail/2` 与 failed changeset。 |
| novel_web | yes | `export_work` 广播正式 `task_state`。 |
| frontend | yes | `WorkspaceChat` 显示 completed 状态；Tauri driver/verifier 新增 slice。 |
| docs/design | yes | 完成后同步 AU-10 acceptance 状态。 |
| quality | no | 不新增质量运行规则。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 持久化/application 层补正式 FAILED 与同步生命周期封装 | done | `LongRunTaskLog.fail/2`、`TaskRunner.track/3`。 |
| T2 | `WorkspaceChannel.export_work` 广播 task_state | done | 成功 RUNNING/CHECKPOINT/COMPLETED，失败 FAILED。 |
| T3 | 前端保留 completed 可见状态 | done | `longRun.status=completed` + 文案。 |
| T4 | 新增 AU10 taskstate Tauri driver/verifier | done | 点击真实“导出全书”。 |
| T5 | 同步 NEXT / acceptance / ledger | done | 标明后续断线/超时/完整 LongRunner 仍未闭环。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-taskstate`（证据：`artifacts/slice-verify/au10-workbench-recovery-taskstate-tauri/summary.json`）
- [x] 后端 / Channel / 前端局部验证：`workspace_channel_task_state_test.exs` 覆盖 COMPLETED / FAILED；`workspaceRuntimeState.test.ts` 和 native verifier 测试覆盖 completed 状态。
- [x] `bash scripts/quality_manifest_check.sh`（通过；保留既有 manifest warning，其中本 slice 尚无 quality acceptance manifest）
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/ai_static_scan.sh --top 10`（复扫后无 pending/blocking；仅剩历史 gitleaks `accepted_risk`）

## 6. 决策日志

- 2026-06-17 — 本 checkpoint 不新增“验收按钮”，选择现有真实“导出全书”按钮作为可见任务状态入口；FAILED 由同一 Channel handler 的真实错误分支覆盖，避免前端伪造失败态。
- 2026-06-17 — checkpoint closed：Tauri driver 证明真实工作台点击“导出全书”后收到 RUNNING / CHECKPOINT / COMPLETED websocket `task_state` 并返回工作台显示“任务完成”；Channel 回归证明导出失败时广播 FAILED。断线重连、LLM 超时/取消等待和完整异步 LongRunner streaming 推进到后续 AU-10 recovery checkpoint。

## 7. 试行反馈

- `TaskRunner` 之前只有 async demo runner，未提供可包裹真实同步产品动作的生命周期入口；本 checkpoint 增加 `track/3` 作为过渡。完整后台 LongRunner streaming 仍需后续单独收敛。

## FAILED 任务状态真实页面补验

- 状态：**todo（2026-10-30 承接既有 FAILED 余项；RUNNING/CHECKPOINT/COMPLETED 历史证据不改）**。
- 来源：本任务目标及 [AU-10 SC-AU10-D2](../../docs/design/acceptance/author/AU-10-workbench-ui.md)。当前 `quality/acceptance/scenarios/au10-workbench-recovery-taskstate.yml` 只声明成功三态，不能替代 FAILED 的真实页面闭环。
- 下一步：核对现役导出/TaskRunner.track 失败来源、Channel task_state 与前端错误/重试表现，设计可重复的外部故障与恢复输入；先区分 handler 异常、路径/文件失败和用户取消的真实语义，不新增验收专用失败开关。
- 完整后果：从真实导出入口触发失败，首屏显示真实失败原因且不报导出成功；故障解除后新请求可成功，旧失败记录与新执行身份不混用。异常/取消零意外正文写入、不遗留半成品冒充完整导出，重复提交不重复不可逆副作用。
- Proof/Boundary：既有 task_state 契约、application/export、web、前端状态消费及外部文件/进程故障驱动；局部 Channel 证据加真实原生页面/文件输出对账。完整批量 LongRunner 仍归 B52 的触发条件，不能因本项补验重新开启批量任务。
