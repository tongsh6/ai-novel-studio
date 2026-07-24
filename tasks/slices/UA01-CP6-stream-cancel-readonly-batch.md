# UA01 CP6 Provider Progress Cancel Readonly Batch

- 状态：done / verified
- 类型：Provider Runtime Slice / Agent Runtime Slice / UI Contract Slice / Acceptance Slice
- 父 slice：`UA01-unified-agent-run-mainchain-closure.md`
- 启动条件：CP4 与 CP5 已稳定；本文件已完成 CP6 的 provider progress、ProviderExecution cancel 边界和只读 batch profile，并通过真实 Tauri 验收。

## 1. 目标

把 CP6 的三个后续能力从 ADR 句子拆成可验收 checkpoint：provider progress 事件、ProviderExecution cancel 边界、只读并行 batch profile。本文件是历史 CP6 progress/cancel/read-only batch 证据；provider token streaming 与 provider execution cancellation 已改由 `UA01-provider-execution-stream-unification.md` 以完整统一架构推进，不能由本文件冒充完成。

## 2. 开工检查

- Contract: `docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md` §5/6/8/10、ADR-0021、VS-02、VS-06。
- Invariant: UA-01 A10/A11/A12/A13/A15/A16；AgentEvent author-safe，provider cancel / progress 保持同一 ProviderExecution / AgentRun runtime 状态，replay 不重新调用 provider。
- Boundary: `novel_agent` 暴露 provider capability 与 cancel adapter；`novel_application` 编排 event/state/budget；`novel_web` 只转发 command 和广播 author-safe event；`frontend` 只消费公开协议；`novel_domain` 不做 I/O。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 过程面板中的 provider progress、cancel result 和只读 batch 完成状态。
- Proof: provider adapter 单元测试、AgentRun runtime command/progress 测试、Channel command 测试、三条真实 Tauri 场景。
- Acceptance Driver: 外部 Tauri driver 从真实页面触发 provider progress / cancel / readonly batch；验证 websocket frame、app JSONL、UI 状态和 final TurnResult，不使用产品内验收逻辑。

## 3. 范围

必须实现：

- provider progress event 映射为 author-safe `agent_event`，不泄漏 raw prompt、secret 或 chain-of-thought。
- cancel command 绑定 run_id；运行中先进入 `cancelling`，请求同一 ProviderExecution cancel，最终落 `cancelled`；不用前端断连、UI 文案或第二 provider 路径冒充取消。
- read-only batch profile 只允许只读工具或只读 provider 查询，不产生 adoption、production write 或 artifact mutation。
- budget、replay、trace 对 streaming chunk、cancel result、batch item refs 可解释。

非目标：

- 不把 progress 当作 UI 打字动画假象。
- 不用 front-end timeout 冒充 provider cancel。
- 不把 read-only batch 写成多 action MicroPlan 旁路 gate。

## 4. Checkpoints

| CP6 checkpoint | 状态 | 说明 |
|---|---|---|
| CP6.1 provider progress | done / ADR-0023 CP3 upgraded | 新增 `provider_progress_v1` profile 与 `provider_progress` author-safe event；该 checkpoint 只证明 progress 事件，不证明 token streaming。2026-07-04 已迁为 model-drafted `provider_complete` AgentPlan。 |
| CP6.2 provider cancel boundary | done | 运行中 cancel 进入 `cancelling`，reason code 记录 `provider_execution_cancel_requested`，`cancel_strategy=provider_execution_cancel`，最终落 `cancelled`。 |
| CP6.3 read-only batch profile | done / ADR-0023 CP3 upgraded | 新增 `readonly_batch_context_v1`，并行读取 profile / characters / rules / stats，只产生 observation 和只读 TurnResult，不调用内容 provider、不产生 artifact 或 adoption。2026-07-04 已迁为 model-drafted two-step `readonly_batch` AgentPlan。 |
| CP6.4 real Tauri acceptance | done | 三条 driver/verifier 均已 active/nightly 并产出 fresh summary。 |

## 5. 验收入口

- provider progress: `quality/acceptance/scenarios/agent-provider-streaming-progress.yml`（历史场景名；不代表 token streaming 已完成）
- cancel: `quality/acceptance/scenarios/agent-provider-cancel-honest-boundary.yml`
- read-only batch: `quality/acceptance/scenarios/agent-readonly-batch-profile.yml`
- scenario index: 三条均在 `quality/acceptance/scenarios.yml` 中登记为 `status: active` / `tier: nightly`。

## 6. 验证证据

- `bash scripts/tauri_slice_verify.sh agent-provider-streaming-progress` 通过；summary: `artifacts/slice-verify/agent-provider-streaming-progress-tauri/summary.json`，记录 `profile_ref=provider_progress_v1`、`plan_drafted_target_tool_ref=provider_complete`、`plan_drafted_step_count=1`、`progress_event_count=3`、`consumed_provider_calls=3`。该 artifact 只作为 CP6 progress / ADR-0023 CP3 plan-driven 证据，不再作为 provider token streaming 架构证据。
- `bash scripts/quality_accept.sh agent-provider-cancel-honest-boundary --surface tauri` 通过；summary: `artifacts/slice-verify/agent-provider-cancel-honest-boundary-tauri/summary.json`，记录 `interrupt_reason_codes=[cancel_requested, provider_execution_cancel_requested]`、`cancel_strategy=provider_execution_cancel`、`terminal_status=cancelled`。
- `bash scripts/tauri_slice_verify.sh agent-readonly-batch-profile` 通过；summary: `artifacts/slice-verify/agent-readonly-batch-profile-tauri/summary.json`，记录 `profile_ref=readonly_batch_context_v1`、`plan_drafted_target_tool_ref=readonly_batch`、`plan_drafted_step_count=2`、`readonly_item_refs=[work_profile, characters, rules, stats]`、`consumed_provider_calls=2`、`consumed_tool_calls=4`，且 readonly profile 自身仍不调用内容 provider、不生成 artifact/adoption/write。

## 7. 设计原则

本 slice 必须把 provider capability 与 runtime 编排解耦：provider 只声明和执行能力，application 决定 AgentRun 状态推进，web/frontend 只消费协议。优先小步扩展现有 AgentEvent/AgentRunState/Trace，不新建平行 streaming bus 或 batch runner。

## 8. 运行控制坞体验收口（2026-07-24）

- 用户确认 active run 采用「对话内状态记录 + 输入区上方固定控制坞」，解决流式文本增长时
  暂停/继续/取消按钮随内容宽度漂移的问题。
- Contract 与命令语义不变：暂停/继续共用一个主操作槽位，危险操作在作者界面改称
  「终止任务」，确认后仍发送 canonical `agent_command cancel`。
- 第二轮 UX 收口把固定控制坞与自然语言调整输入合并为一张任务工作卡，并与 `880px`
  对话内容轨道对齐；运行中仅「发送调整」保持黑色主操作，暂停/终止降为描边操作。
- Boundary 仅涉及 Pencil、`WorkspaceChat`、展示文案与既有外部 driver；不修改
  `novel_agent / novel_application / novel_web`，不增加验收 hook。
- Proof 复用 `agent-interrupt-safe-point`、`agent-cancel-target-binding`、
  `agent-provider-cancel-honest-boundary`，并新增固定控制坞组件测试与布局断言。
