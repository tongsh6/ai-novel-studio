# UA01 CP5 Durable AgentRun Resume

- 状态：done / verified
- 类型：Agent Runtime Slice / Persistence Slice / Recovery Slice / Acceptance Slice
- 父 slice：`UA01-unified-agent-run-mainchain-closure.md`
- 启动条件：CP4 正文主链剩余缺口收口后进入实现；2026-06-29 已完成 durable AgentRun + LongRunTask checkpoint/recovery/stale policy 闭环。

## 1. 目标

把 durable AgentRun 从 ADR 后续项落成可执行闭环：长运行 AgentRun 必须关联 `LongRunTask`，能在后端进程重启或 Channel 断线后恢复作者可见状态，且 stale snapshot 不得静默继续。

## 2. 开工检查

- Contract: `docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md` §1/3/8/10、ADR-0021、`docs/design/04a-planning-and-long-run.md`。
- Invariant: UA-01 A10/A18/A19/A20；bounded run 不强制创建 LongRunTask，durable run 必须关联 LongRunTask，stale state 不得静默继续。
- Boundary: `novel_application` 负责编排 resume；`novel_persistence` 保存 checkpoint / LongRunTask 关联；`novel_web` 只做 Channel adapter 和 broadcast；`novel_agent` 只执行 provider/tool runtime；`novel_domain` 保持纯结构。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 对一个 durable AgentRun 的恢复面板和继续/等待作者状态。
- Proof: 后端 checkpoint/resume 测试、Channel reconnect 测试、真实 Tauri `agent-durable-resume-long-run-task` 场景。
- Acceptance Driver: 外部 Tauri driver 触发 durable run，制造后端重启或 socket reconnect，再从真实页面观察恢复后的 `agent_run_state`、LongRunTask ref、stale policy 和最终 TurnResult；产品代码不新增验收 hook。

## 3. 范围

必须实现：

- durable profile 与 bounded profile 分账，不把所有 AgentRun 都升格为 LongRunTask。
- `AgentRun.long_run_task_ref` 与 LongRunTask 状态互相可追踪。
- step checkpoint 包含 run id、step sequence、goal version、state snapshot ref、idempotency key、completed observation refs。
- resume 时检查 work/session/goal/snapshot freshness；stale 时进入 `awaiting_author` 或 replan，不静默继续旧 tool/provider 调用。
- UI 恢复后不显示孤立“思考中...”，而是从恢复的 run state / event stream 展示阶段。

非目标：

- 不新增 ProviderExecution 之外的取消体系。
- 不把 CP6 streaming 或 read-only batch 合并进 CP5。
- 不绕过现有 `AgentRunLog` / `LongRunTask` / trace 体系自建持久化。

## 4. Checkpoints

| CP5 checkpoint | 状态 | 说明 |
|---|---|---|
| CP5.1 durable run contract review | done | `AgentRun` 区分 bounded/durable；bounded 拒绝 LongRunTask ref，durable 必须关联 LongRunTask。 |
| CP5.2 persistence + application resume | done | `AgentRunService.start_durable/2` 创建 LongRunTask；`AgentRunServer` checkpoint 同步 run/step/event/progress；runtime 不在时恢复为 stale `awaiting_author`，不重复执行已完成 step。 |
| CP5.3 Channel reconnect / UI recovery | done | Channel join 异步调用 `AgentRunService.recover_durable/3`，重新绑定 live runtime sink 或从 checkpoint 广播 `run_resumed` + `agent_run_state`；`WorkspaceChat` 展示“可恢复长任务/已恢复检查点”和 LongRunTask ref。 |
| CP5.4 real Tauri acceptance | done | `bash scripts/quality_accept.sh agent-durable-resume-long-run-task --surface tauri` 通过；summary 记录 backend restart 后 `runtime_not_live` stale recovery、completed steps 仍为 1、恢复后 `toolbox.execute` 次数为 0。 |

## 5. 验收入口

- quality manifest: `quality/acceptance/scenarios/agent-durable-resume-long-run-task.yml`
- scenario index: `quality/acceptance/scenarios.yml` 中登记为 `status: active` / `tier: nightly`。
- command: `bash scripts/quality_accept.sh agent-durable-resume-long-run-task --surface tauri`
- fresh evidence: `artifacts/slice-verify/agent-durable-resume-long-run-task-tauri/summary.json`

## 6. 验证记录

- `mix compile --warnings-as-errors`：通过。
- `mix test apps/novel_domain/test/novel_domain/agent_run_contract_test.exs apps/novel_persistence/test/novel_persistence/agent_run_log_test.exs apps/novel_application/test/novel_application/agent_run_runtime_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_task_state_test.exs`：27 tests, 0 failures。
- `node --check frontend/slice-verify/external-ui-driver.mjs` / `node --check frontend/slice-verify/native-tauri-verifier.mjs`：通过。
- `bash scripts/quality_accept.sh agent-durable-resume-long-run-task --surface tauri`：通过；summary 记录 durable `long_run_task_ref`、`recovery_reason_codes=[durable_recovered, stale_resume, runtime_not_live]`、`completed_step_count_after_recovery=1`、`repeated_toolbox_after_recovery_count=0`。

## 7. 设计原则

本 slice 必须优先复用现有 LongRunTask、AgentRunLog、AgentEvent、TurnResult 和 trace；只在 durable resume 语义确实需要时扩展字段。保持 KISS/YAGNI，避免把 bounded runtime 改成全量 job 系统；用 DIP 让 web 只依赖 application 公开入口。
