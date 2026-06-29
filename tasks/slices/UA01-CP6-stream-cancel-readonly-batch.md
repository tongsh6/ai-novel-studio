# UA01 CP6 Streaming Cancel Readonly Batch

- 状态：done / verified
- 类型：Provider Runtime Slice / Agent Runtime Slice / UI Contract Slice / Acceptance Slice
- 父 slice：`UA01-unified-agent-run-mainchain-closure.md`
- 启动条件：CP4 与 CP5 已稳定；本文件已完成 CP6 的 provider progress、协作式 cancel 诚实边界和只读 batch profile，并通过真实 Tauri 验收。

## 1. 目标

把 CP6 的三个后续能力从 ADR 句子拆成可验收 checkpoint：provider streaming 事件、provider hard cancel 的诚实边界、只读并行 batch profile。任何 provider 不支持硬取消时必须明确降级为协作式取消，不得在 UI 或 trace 中伪装成已中断 provider 调用。

## 2. 开工检查

- Contract: `docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md` §5/6/8/10、ADR-0021、VS-02、VS-06。
- Invariant: UA-01 A10/A11/A12/A13/A15/A16；AgentEvent author-safe，provider 不支持硬取消时诚实降级，replay 不重新调用 provider。
- Boundary: `novel_agent` 暴露 provider capability 与 stream/cancel adapter；`novel_application` 编排 event/state/budget；`novel_web` 只转发 command 和广播 author-safe event；`frontend` 只消费公开协议；`novel_domain` 不做 I/O。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 过程面板中的 streaming progress、cancel result 和只读 batch 完成状态。
- Proof: provider adapter 单元测试、AgentRun runtime command/stream 测试、Channel command 测试、三条真实 Tauri 场景。
- Acceptance Driver: 外部 Tauri driver 从真实页面触发 streaming / cancel / readonly batch；验证 websocket frame、app JSONL、UI 状态和 final TurnResult，不使用产品内验收逻辑。

## 3. 范围

必须实现：

- provider streaming event 映射为 author-safe `agent_event`，不泄漏 raw prompt、secret 或 chain-of-thought。
- cancel command 绑定 run_id；支持硬取消的 provider 记录 hard-cancel evidence，不支持时记录 cooperative-cancel / safe-point waiting。
- read-only batch profile 只允许只读工具或只读 provider 查询，不产生 adoption、production write 或 artifact mutation。
- budget、replay、trace 对 streaming chunk、cancel result、batch item refs 可解释。

非目标：

- 不把 streaming 当作 UI 打字动画假象。
- 不用 front-end timeout 冒充 provider cancel。
- 不把 read-only batch 写成多 action MicroPlan 旁路 gate。

## 4. Checkpoints

| CP6 checkpoint | 状态 | 说明 |
|---|---|---|
| CP6.1 provider streaming progress | done | 新增 `provider_progress_v1` profile 与 `provider_progress` author-safe event；当前 provider 不支持 token 级 streaming 时诚实降级为 checkpoint progress。 |
| CP6.2 provider cancel honest boundary | done | 运行中 cancel 进入 `cancelling`，reason code 记录 `cooperative_cancel` / `provider_hard_cancel_unsupported`，到 safe point 后才落 `cancelled`。 |
| CP6.3 read-only batch profile | done | 新增 `readonly_batch_context_v1`，并行读取 profile / characters / rules / stats，只产生 observation 和只读 TurnResult，不产生 provider call、artifact 或 adoption。 |
| CP6.4 real Tauri acceptance | done | 三条 driver/verifier 均已 active/nightly 并产出 fresh summary。 |

## 5. 验收入口

- streaming: `quality/acceptance/scenarios/agent-provider-streaming-progress.yml`
- cancel: `quality/acceptance/scenarios/agent-provider-cancel-honest-boundary.yml`
- read-only batch: `quality/acceptance/scenarios/agent-readonly-batch-profile.yml`
- scenario index: 三条均在 `quality/acceptance/scenarios.yml` 中登记为 `status: active` / `tier: nightly`。

## 6. 验证证据

- `bash scripts/quality_accept.sh agent-provider-streaming-progress --surface tauri` 通过；summary: `artifacts/slice-verify/agent-provider-streaming-progress-tauri/summary.json`，记录 `profile_ref=provider_progress_v1`、`progress_event_count=3`、`provider_streaming_unavailable`、`consumed_provider_calls=1`。
- `bash scripts/quality_accept.sh agent-provider-cancel-honest-boundary --surface tauri` 通过；summary: `artifacts/slice-verify/agent-provider-cancel-honest-boundary-tauri/summary.json`，记录 `interrupt_reason_codes=[cancel_requested, cooperative_cancel, provider_hard_cancel_unsupported]`、`cancel_strategy=cooperative_safe_point`、`terminal_status=cancelled`。
- `bash scripts/quality_accept.sh agent-readonly-batch-profile --surface tauri` 通过；summary: `artifacts/slice-verify/agent-readonly-batch-profile-tauri/summary.json`，记录 `profile_ref=readonly_batch_context_v1`、`readonly_item_refs=[work_profile, characters, rules, stats]`、`consumed_provider_calls=0`、`consumed_tool_calls=4`。

## 7. 设计原则

本 slice 必须把 provider capability 与 runtime 编排解耦：provider 只声明和执行能力，application 决定 AgentRun 状态推进，web/frontend 只消费协议。优先小步扩展现有 AgentEvent/AgentRunState/Trace，不新建平行 streaming bus 或 batch runner。
