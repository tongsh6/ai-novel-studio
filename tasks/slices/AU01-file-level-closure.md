# AU01 File-Level Closure

- 状态：file-level deliverable / cross-reference registered
- 类型：Author Acceptance File Closure
- 验收文件：`docs/design/acceptance/author/AU-01-chat.md`
- 当前结论：13 个场景中 11 个有完整真实页面外部自动化证据，SC-AU01-D1 已有 AU-07 当前 turn why/no-provider、普通旧 turn scoped query、partial replay 诚实提示、scope negative matrix 和 gate reason why cross evidence，SC-AU01-C3 为已测试并登记后续 owner；P0 已关闭，D1 完整 replay、developer view、多类型 UI 作为 AU-07 P1 cross-reference 登记，当前可进入 AU-02。
- 最近复核：2026-06-22

## 1. 文件级目标

AU-01 验收作者能在真实 Tauri 工作台自然聊天：普通讨论应产生可见 user/assistant 往返，不默认进入 MicroPlan、工具、写入、采纳或表单化流程；异常 provider / frame 输出必须友好降级；TurnResult、recorder 和恢复 UI 必须同源。

本文件是 AU-01 的文件级收口记录，补齐从验收文档到当前 runnable evidence 的对账链路。第一轮曾只修正 integration 测试 fixture 与文件级记录，不修改 production runtime；2026-06-22 二轮复核没有发现需要进入实现的 production 偏差。

2026-06-22 二轮复核：不推翻第一轮 file-level deliverable 结论；本轮只复核已登记剩余 P1/P2、external blocker 和 cross-reference。5 个 AU-01 quality entry 与 ordinary chat real LM Studio 变体均已串行复跑通过。随后按依赖关系前置复核 AU-07 `au07-trace-why-entry`、`au07-persisted-trace-query`、`au07-partial-replay-ui`、`au07-gate-reason-why` 与 `au07-trace-query-scope-negative-matrix`，将其回填为 SC-AU01-D1 当前 turn author-safe why/no-provider/no-write、reload 后普通旧 turn work/session/turn scoped query / no-provider replay、partial replay 诚实提示、降级 gate why 中文解释，以及跨 work/session/turn 负向查询不泄露 trace 子证据。当前未发现 AU-01 内应关闭的 P0/P1；D1 完整 replay、developer view、多类型 UI 继续登记为 AU-07 owner 的 cross-reference，E1 provider unavailable/timeout 继续引用 AU-10 recovery owner 证据，C3 no-slot-form UI 反证保持 P2 后续。

## 2. 开工检查

- Contract：`docs/design/acceptance/author/AU-01-chat.md`；`docs/design/acceptance/author/AU-07-trace-and-replay.md`；`docs/design/01-user-llm-workbench-interaction-model.md`；`docs/design/schemas/foundation/turn_result_v2.json`；`quality/acceptance/scenarios/au01-*.yml`；`quality/acceptance/scenarios/au07-trace-why-entry.yml`；`quality/acceptance/scenarios/au07-persisted-trace-query.yml`。
- Invariant：普通聊天默认 `generate_micro_plan=false`；TurnResult 是前端 canonical 输出；普通聊天不得谎称 tool/write/adoption；provider/frame 异常不暴露 raw/internal reason；reply-only replay 不重调 provider。
- Boundary：切穿真实 Tauri UI、Phoenix Channel、`DialogueGateway`、Planner、InteractionRecorder、session snapshot / resume 和 LM Studio request log；不修改 production provider/runtime、domain、persistence schema 或产品验收 hook。
- Consumer：`WorkspaceChat` 当前消息列表、Channel `turn_result`、interaction recorder transcript、reload 恢复 UI、why dialog、AU-01 / AU-07 quality acceptance runner。
- Proof：后端/Channel/E2E 局部测试、native verifier、5 个 AU-01 Tauri driver、ordinary chat real LM Studio 变体、5 个 AU-01 quality acceptance 入口、`au07-trace-why-entry`、`au07-persisted-trace-query`、`au07-partial-replay-ui`、`au07-gate-reason-why` 与 `au07-trace-query-scope-negative-matrix` 真实 Tauri cross evidence。
- Acceptance Driver：`scripts/tauri_slice_verify.sh au01-*` 从产品外部驱动真实 Tauri 页面。产品代码没有读取 slice id、没有隐藏 DOM hook、没有验收专用 env/query/localStorage、没有自动输入/点击/上报验收状态。

## 3. 场景对账矩阵

| 场景 | 设计期望 | Contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU01-A1 打开工作台可聊天 | 作品、服务状态、欢迎语、输入框可见 | WorkSession / Channel join | `App.tsx`、`WorkspaceChat.tsx`、`WorkspaceChannel` | `workspace_channel_v3_test.exs` | `au01-ordinary-chat-two-turn-roundtrip` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU01-A2 输入创作想法并看到回复 | user 消息、thinking、Channel、TurnResult、assistant 回复完整往返 | `TurnResult.assistant_message` | `WorkspaceChat.handleSend`、`socket.sendMessage`、`DialogueGateway.handle_input` | `dialogue_gateway_test.exs`、`workspace_channel_v3_test.exs` | `au01-ordinary-chat-two-turn-roundtrip`、`--real-lmstudio` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU01-B1 普通聊天产生有效 TurnResult | reply-only frame、trace、自然中文回复、无执行卡 | AU01-I1/I2 | `Planner.form_frame`、`DialogueGateway`、`WorkspaceChannel` | `dialogue_gateway_test.exs`、`v3_full_chain_test.exs` | `au01-ordinary-chat-two-turn-roundtrip` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU01-B2 连续多轮不覆盖、不串话 | 多轮消息顺序稳定、turn_id 独立、thinking 清退 | session transcript / turn id | `InteractionRecorder`、`WorkspaceChat` message list | `dialogue_gateway_test.exs` | `au01-ordinary-chat-two-turn-roundtrip` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU01-B3 空消息不会发送 | 空白输入不产生 frame/DOM 消息/thinking，后续有效聊天可恢复 | blank guard / no empty business turn | `WorkspaceChat.handleSend`、`DialogueGateway` empty guard | Channel / Gateway 空文本测试 | `au01-empty-message-guard` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU01-B4 AI 说的和系统记录一致 | UI、websocket TurnResult、recorder transcript、reload UI 同一文本 | AU01-I2 | `InteractionRecorder`、`WorkSessionService.show/resume`、`transcriptToMessages` | `dialogue_gateway_test.exs`、`native-tauri-verifier.test.mjs` | `au01-turnresult-recorder-ui-consistency` | 已验收 | trace/replay 作者视图归 AU-07 | cross-reference | P1 | AU-07 owner |
| SC-AU01-C1 纯聊天不生成执行计划 | `generate_micro_plan=false`，无 MicroPlan/执行/确认/采纳卡 | AU01-I3 | `socket.sendMessage`、`WorkspaceChannel.user_message`、`Planner.form_micro_plan` | `DialogueGatewayTest` no MicroPlan | `au01-ordinary-chat-two-turn-roundtrip` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU01-C2 纯聊天不调用工具/写入/采纳 | truthfulness no tool/write/adoption，UI 无相关卡 | AU01-I4 | `DialogueGateway`、`WorkspaceChat` cards | `dialogue_gateway_test.exs`、`workspace_channel_v3_test.exs` | `au01-ordinary-chat-two-turn-roundtrip` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU01-C3 讨论请求不变表单化追问 | 无 required_slots/missing_slots/slot_form，语言自然 | no mechanical slot form | `Planner` frame contract、`DialogueFrame.validate` | `dialogue_gateway_test.exs`、`workspace_channel_v3_test.exs` | 无 | 已测试 | 缺真实 UI 反证矩阵 | evidence gap | P2 | `AU01-freeform-no-slot-form-ui` |
| SC-AU01-D1 普通聊天可追溯且 replay 不调 LLM | trace 有 frame/order；replay 用记录不重调 provider | AU01-I5 / `ReplayService` / `TraceReplayService` | `DecisionTrace`、`ReplayService`、`TraceReplayService`、why/replay UI | `dialogue_gateway_test.exs`、`v3_full_chain_test.exs`、AU-07 scoped query tests | `au07-trace-why-entry` 当前 turn author-safe why/no-provider/no-write cross evidence；`au07-persisted-trace-query` 普通旧 turn scoped query / no-provider replay cross evidence；`au07-partial-replay-ui` partial replay 诚实提示 cross evidence；`au07-trace-query-scope-negative-matrix` scoped negative matrix cross evidence；`au07-gate-reason-why` 降级 gate why 中文解释 cross evidence | 部分实现 | 完整 replay、developer view、多类型 UI 仍归 AU-07 | cross-reference | P1 | `AU07-trace-replay-chat-readonly` |
| SC-AU01-E1 provider 不可用优雅降级 | fallback frame、loading 结束、恢复后可继续 | AU01-I6 | `Planner.fallback_frame`、`WorkspaceChat` | `v3_full_chain_test.exs`、`planner_real_llm_test.exs` | `au10-workbench-recovery-disconnect-timeout`、`au10-workbench-recovery-provider-timeout` | 已验收 | 证据 owner 在 AU-10 recovery | cross-reference | P1 | AU-10 owner |
| SC-AU01-E2 乱码 JSON 优雅降级 | 友好 fallback、raw payload 不可见、下一轮恢复 | AU01-I6 / parse retry | `Planner.parse_json_retry`、fallback frame | `v3_full_chain_test.exs`、`planner_real_llm_test.exs`、`native-tauri-verifier.test.mjs` | `au01-garbage-json-recovery` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU01-E3 frame validation 友好错误 | forbidden semantics 被拦截，UI/turn_result 不泄漏内部 reason，下一轮恢复 | `DialogueFrame.validate` / Channel fallback redaction | `DialogueGateway`、`WorkspaceChannel.fallback_turn_result` | `dialogue_gateway_test.exs`、`workspace_channel_v3_test.exs`、`native-tauri-verifier.test.mjs` | `au01-frame-validation-friendly-error` | 已验收 | 无 | 无 | P1 | 保持回归 |

## 4. 偏差 review

- 普通聊天入口：`frontend/src/lib/socket.ts` 默认 `generateMicroPlan=false`；`WorkspaceChat.handleSend` 未传显式执行标志时保持 reply-only。
- 空消息边界：`WorkspaceChat.handleSend` 在 `trim()` 后空文本直接 return；后端 `DialogueGateway` 仍保留 empty text 局部防御。
- provider/runtime 边界：AU-01 Tauri 验收使用 test/support provider 只作为外部 runner 环境显式注入；production provider registry 未新增验收替身。
- Channel fallback：`WorkspaceChannel` 的 error `turn_result` 使用通用 `turn_processing_failed` 和作者友好文案，内部 validation reason 只留业务日志。
- recorder/recovery：`DialogueGateway` recorder 写 user/assistant rows，`WorkSessionService.show/resume` 与 `transcriptToMessages` 恢复同一 TurnResult 文本。
- 验收红线：driver 通过真实输入框、按钮、websocket frame、业务 JSONL、session snapshot、reload UI 和 LM Studio log 取证；生产代码没有验收感知逻辑。

本轮发现的实现偏差是测试口径漂移，不是 production 行为偏差：`v3_full_chain_test.exs` 的 prompt 捕获仍按旧 string prompt 断言，creative artifact fixture 也只给 frame/plan 两个 provider 响应，未覆盖当前 creative tool adapter 的 provider 调用。本轮已最小修复测试 fixture。

## 5. 缺口分级

| 优先级 | 缺口 | 处置 |
|---|---|---|
| P0 | 无 | AU-01 主路径、空消息、no MicroPlan/no action、乱码降级、frame validation、recorder/UI 一致性均有当前证据。 |
| P1 | SC-AU01-D1 作者 trace/replay UI | 当前 turn why/no-provider 子证据已由 AU-07 `au07-trace-why-entry` 回填；普通旧 turn scoped query / no-provider replay 已由 `au07-persisted-trace-query` 回填；partial replay 诚实提示已由 `au07-partial-replay-ui` 回填；scoped negative matrix 已由 `au07-trace-query-scope-negative-matrix` 回填；降级 gate why 中文解释已由 `au07-gate-reason-why` 回填；完整 replay、developer view、多类型 UI 继续登记为 AU-07 owner：`AU07-trace-replay-chat-readonly`。AU-01 保留局部 `ReplayService` no-provider-call 证据，不在本文件重复造入口。 |
| P1 | SC-AU01-E1 provider unavailable / timeout evidence owner 在 AU-10 | 已由 AU-10 recovery checkpoint 覆盖，AU-01 只引用 cross-file 证据。 |
| P2 | SC-AU01-C3 no-slot-form UI 反证 | 后端/Channel 已测试；真实 UI 反证登记为 `AU01-freeform-no-slot-form-ui` 后续矩阵，不阻塞文件级退出。 |
| P2 | 三轮以上、重复发送、长会话普通聊天矩阵 | 后续体验矩阵；当前两轮真实工作台闭环已足够覆盖 AU-01 文件级主路径。 |

## 6. 验证记录

已复跑：

```bash
bash scripts/tauri_slice_verify.sh --list
mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
mix test --include integration apps/novel_e2e/test/novel_e2e/v3_full_chain_test.exs
pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_manifest_check.sh
bash scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip
bash scripts/tauri_slice_verify.sh --real-lmstudio au01-ordinary-chat-two-turn-roundtrip
bash scripts/tauri_slice_verify.sh au01-empty-message-guard
bash scripts/tauri_slice_verify.sh au01-garbage-json-recovery
bash scripts/tauri_slice_verify.sh au01-frame-validation-friendly-error
bash scripts/tauri_slice_verify.sh au01-turnresult-recorder-ui-consistency
bash scripts/quality_accept.sh au01-ordinary-chat-two-turn-roundtrip --surface tauri
bash scripts/quality_accept.sh au01-empty-message-guard --surface tauri
bash scripts/quality_accept.sh au01-garbage-json-recovery --surface tauri
bash scripts/quality_accept.sh au01-frame-validation-friendly-error --surface tauri
bash scripts/quality_accept.sh au01-turnresult-recorder-ui-consistency --surface tauri
bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri
bash scripts/quality_accept.sh au07-persisted-trace-query --surface tauri
bash scripts/quality_accept.sh au07-trace-query-scope-negative-matrix --surface tauri
bash scripts/quality_accept.sh au07-gate-reason-why --surface tauri --provider lmstudio
```

2026-06-22 二轮复跑：

```bash
bash scripts/quality_accept.sh au01-ordinary-chat-two-turn-roundtrip --surface tauri
bash scripts/quality_accept.sh au01-empty-message-guard --surface tauri
bash scripts/quality_accept.sh au01-garbage-json-recovery --surface tauri
bash scripts/quality_accept.sh au01-frame-validation-friendly-error --surface tauri
bash scripts/quality_accept.sh au01-turnresult-recorder-ui-consistency --surface tauri
bash scripts/tauri_slice_verify.sh --real-lmstudio au01-ordinary-chat-two-turn-roundtrip
```

结果：

- `dialogue_gateway_test.exs` + `workspace_channel_v3_test.exs`：65 tests / 0 failures。
- `v3_full_chain_test.exs --include integration`：10 tests / 0 failures。
- `native-tauri-verifier.test.mjs`：127 tests / 0 failures。
- `quality_manifest_check.sh`：passed；warning 均为其它 slice 缺 manifest，AU-01 manifest 已存在。
- 5 个 AU-01 Tauri driver 均 passed。
- ordinary chat real LM Studio 变体 passed，summary 记录 `provider=lmstudio`、`request_count=2`、HTTP 200。
- 5 个 AU-01 quality acceptance 入口均 passed。
- `au07-trace-why-entry` 作为 D1 当前 turn cross evidence passed，summary 记录真实工作台消息流 why 入口、author-safe dialog、raw prompt/provider/debug 不可见，以及 `explanation_does_not_call_provider_or_write_state`。
- `au07-persisted-trace-query` 作为 D1 普通旧 turn cross evidence passed，summary 记录 reload 后旧消息 why 入口、work/session/turn scoped replay API、`provider_called=false`、no-write 和 raw prompt/provider/debug 不可见。
- `au07-trace-query-scope-negative-matrix` 作为 D1 scoped negative matrix cross evidence passed，summary 记录原 work/session/turn replay 200，跨 work、跨 session、same-work other session 和 missing turn 均 404，且无 trace 泄露、错误不进 UI、no-provider/no-tool/no-write。
- `au07-gate-reason-why` 作为 D1 降级 gate why cross evidence passed，summary 记录真实 Tauri + real LM Studio 多步 MicroPlan 在 `action_scope` 降级，why 面板显示中文 gate/reason、no-provider replay、no-write 和 raw/internal code 不可见。
- 2026-06-22 当前 artifact：`artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json` 继续证明两轮真实页面普通聊天、thinking 清退、no MicroPlan 和无 action/candidate/adoption UI；`artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio/summary.json` 证明 `provider=lmstudio`、`request_count=2`、HTTP 200；`au01-empty-message-guard` summary 证明空白输入 `blank_user_message_frame_count=0`；`au01-garbage-json-recovery` summary 证明 `fallback_message_visible=true` 且 `raw_provider_payload_visible=false`；`au01-frame-validation-friendly-error` summary 证明 `internal_validation_reason_visible=false` 且 `internal_validation_reason_in_turn_result=false`；`au01-turnresult-recorder-ui-consistency` summary 证明 transcript、websocket TurnResult 与 reload UI 文本一致。

## 7. 退出结论

AU-01 满足文件级退出标准：

1. 13 个场景均有可信对账矩阵。
2. P0 已关闭。
3. P1 已尽量关闭；D1 当前 turn why/no-provider、普通旧 turn scoped query、partial replay 诚实提示、scope negative matrix 与 gate reason why 子证据已由 AU-07 回填，剩余完整 replay、developer view、多类型 UI 明确登记为 AU-07 cross-reference，E1 引用 AU-10 recovery owner 证据。
4. 已实现场景均有局部测试证据；承重聊天主链有外部 Tauri 真实页面证据。
5. AU-01 quality manifest、slice driver、summary artifact 与验收文档口径一致。
6. 本文件补齐 tasks/slices 文件级收口入口。

当前可进入下一个验收文件：`docs/design/acceptance/author/AU-02-explore.md`。
