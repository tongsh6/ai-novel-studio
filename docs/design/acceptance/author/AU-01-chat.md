# AU-01 与 AI 聊创作

> 作者视角：我打开真实工作台，可以像和一个懂创作的写作伙伴聊天一样讨论故事创意、风格、角色。AI 会自然回应，不会偷偷替我写东西、改设定、调用工具，或假装已经做了什么。
>
> 2026-06-20 复核结论：普通聊天两轮真实工作台 checkpoint 已闭环。`scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 现在可从真实 Tauri 工作台输入两轮自然创作聊天，验证两轮 user/assistant 可见顺序、thinking 出现后清退、`generate_micro_plan=false`、无 `planner.form_micro_plan.*` 事件、无 action/candidate/adoption UI；`--real-lmstudio` 模式进一步证明真实 LM Studio 每轮都有对应 `form_frame` request 且 assistant 回复不是 fallback。`au01-empty-message-guard` 已补空白输入真实页面验收：空格发送不产生 `user_message` frame、不追加可见消息、不进入 thinking，随后有效普通聊天仍可完成。`au01-garbage-json-recovery` 已补 malformed provider frame JSON 真实页面验收：显示友好 fallback、raw payload 不可见、输入/Channel 可恢复并继续普通聊天。`au01-frame-validation-friendly-error` 已补 forbidden semantics frame 真实页面验收：作者看到通用友好 fallback，UI 和 websocket `turn_result` 不暴露内部 validation reason，业务日志保留详细 reason，随后普通聊天恢复。`au01-turnresult-recorder-ui-consistency` 已补同一 turn 的 UI / websocket `turn_result` / interaction recorder transcript / reload 恢复 UI 对账。AU-01 文件级退出标准已满足，可以进入 AU-02；这不等于所有产品场景完整验收，D1 trace/replay UI 归 AU-07 cross-reference，C3 no-slot-form UI 反证为 P2 后续。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 打开工作台开始聊天 | 显示当前作品、连接状态、欢迎语和输入框 |
| 输入创作想法 | 前端追加我的消息，后端返回自然 AI 回复，界面展示出来 |
| 问风格/方向问题 | AI 只讨论分析，不自动写正文、不改设定、不强制行动计划 |
| 连续聊多轮 | 每轮有独立 turn/frame/trace，界面不串消息、不覆盖上一轮 |
| 发空消息或网络异常 | 不崩溃、不白屏，给出可理解提示 |
| LM Studio 不可用或返回乱码 | 系统降级成诚实提示，前端仍可继续下一轮 |

明确不覆盖：
- 生成候选方向卡片（AU-02）
- 生成/采纳正文、大纲、角色设定（AU-05）
- 高风险确认、行为生命周期（AU-04/AU-06）
- 作品切换隔离（SU-02）

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU01-I1 / `00c` #1 | 每个有效 turn 必有 DialogueFrame | SC-AU01-B1、SC-AU01-B2 |
| AU01-I2 / `00c` #9 | TurnResult 是前端消费的 canonical 输出 | SC-AU01-B1、SC-AU01-B4 |
| AU01-I3 | 普通聊天不得默认升级为执行计划或工具调用 | SC-AU01-C1、SC-AU01-C2 |
| AU01-I4 | 系统诚实：没调用工具、没写入、没采纳就不能声称做了 | SC-AU01-C1、SC-AU01-C3 |
| AU01-I5 / `00c` #14 | replay 默认不重新调用 LLM | SC-AU01-D1 |
| AU01-I6 | Provider 异常不能让用户界面崩溃或暴露内部错误 | SC-AU01-E1、SC-AU01-E2、SC-AU01-E3 |

---

## 3. 契约引用

| 契约 / 实现 | 用途 | 当前证据判断 |
|---|---|---|
| `frontend/src/App.tsx` | 当前真实入口，渲染 `WorkspaceChat` | 唯一生产工作台入口 |
| `WorkspaceChat.tsx` | 当前主工作台：输入、loading、消息渲染、socket 调用 | 普通聊天两轮真实 Tauri 可见 checkpoint 已补；异常矩阵仍缺 |
| `frontend/src/lib/socket.ts` `sendMessage` | 当前主工作台发送 `user_message` | 默认 `generate_micro_plan: false`；`au01-ordinary-chat-two-turn-roundtrip` 证明真实入口两轮消费该默认契约 |
| `WorkspaceChannel.handle_in("user_message")` | Channel 接收前端消息并广播 `turn_result` | 有 Channel roundtrip 测试 |
| `DialogueGateway.handle_input/5` | v3 对话主链入口 | reply-only、truthfulness、empty text、interaction recorder 有测试 |
| `Planner.form_frame/3` | 调 LLM 形成 DialogueFrame，异常时 fallback | broken provider / garbage JSON 在 E2E 和 planner 测试中覆盖 |
| `TurnResultBuilder` / TurnResult schema | 前端消费 canonical 输出 | application / e2e / schema 测试覆盖 |
| `ReplayService` | replay 不重新调用 provider | E2E reply-only replay 有测试 |
| `docs/design/acceptance/e2e/E2E-01-full-chain.md` | 端到端证据索引 | E1/E11 与 AU-01 相关，但仍不是完整 UI 验收 |

---

## 4. 验收场景

### 场景组 A：真实工作台入口

#### SC-AU01-A1 — 打开工作台并看到可聊天状态

**作为作者**，我打开桌面应用，进入工作台，能看见当前作品、连接状态、欢迎语和输入框。

**前置条件**：后端已启动；LM Studio 可用或不可用均可。

**触发**：启动应用，进入默认工作台。

**期望结果**：
- 渲染真实入口 `WorkspaceChat`；
- 当前作品名、LLM 状态、服务连接状态可见；
- 显示欢迎消息；
- 输入框可用；
- 若后端不可用，界面仍显示受限状态，不白屏。

**当前证据**：`App.tsx` 渲染 `WorkspaceChat`；`WorkspaceChat.tsx` 有欢迎消息、LLM health、socket 状态；`au01-ordinary-chat-two-turn-roundtrip` 从真实 Tauri 工作台等待服务连接、作品标题、输入框并完成两轮发送。

**当前状态**：最小真实 Tauri checkpoint 已补；后端不可用受限态仍需异常矩阵覆盖。

---

#### SC-AU01-A2 — 作者输入创作想法并看到回复

**作为作者**，我输入“我想写一个雨夜开场的悬疑故事，先聊聊气质”，发送后看到自己的消息和 AI 的自然回复。

**前置条件**：工作台已连接 Channel。

**触发**：在输入框输入并发送。

**期望结果**：
- 用户消息立即追加到消息列表；
- UI 进入 loading / thinking 状态；
- Channel 收到 `user_message`；
- 后端广播 `turn_result`；
- 前端渲染 `assistant_message.text`；
- loading 结束，输入框可继续使用。

**当前证据**：`WorkspaceChat.handleSend` 追加 user message 并调用 `sendMessage`；`WorkspaceChannelContractTest` 覆盖 `user_message -> turn_result`；`DialogueGatewayTest` 和 `FullChainTest` 覆盖 reply-only 主链；`au01-ordinary-chat-two-turn-roundtrip` 证明真实 UI 中用户消息、assistant reply 和 thinking 清退可见。

**当前状态**：最小真实 Tauri checkpoint 已补；异常态和更多输入矩阵仍待后续。

---

### 场景组 B：基础自然对话

#### SC-AU01-B1 — 普通创作聊天产生有效 TurnResult

**作为作者**，我只想聊创作，不要求 AI 生成内容或执行任务。

**触发**：发送普通聊天消息。

**期望结果**：
- 后端产生有效 DialogueFrame；
- `turn_result.frame_ref`、`turn_result.frame_summary` 存在；
- `trace.decision_type == :reply_only`；
- `assistant_message.text` 是自然中文，不是 JSON 或错误堆栈；
- 前端只显示普通 AI 回复，不显示无关执行卡片。

**当前证据**：`dialogue_gateway_test.exs` “produces primary DialogueFrame”；`v3_full_chain_test.exs` “full chain: input -> frame -> turn_result -> trace”；`workspace_channel_v3_test.exs` broadcast turn_result；`au01-ordinary-chat-two-turn-roundtrip` 校验每轮 `channel.user_message.start -> dialogue_gateway.handle_input.done -> channel.user_message.done`，且真实 UI 渲染 assistant reply。

**当前状态**：最小真实 Tauri checkpoint 已补；完整 trace/replay 仍属 AU-07/AU-01 后续矩阵。

---

#### SC-AU01-B2 — 连续多轮不覆盖、不串话

**作为作者**，我连续聊三轮，界面按顺序保留每轮用户消息和 AI 回复。

**触发**：连续发送三条普通聊天消息。

**期望结果**：
- 每条消息有独立 `turn_id`、`frame_ref`、trace；
- 前端消息列表顺序稳定；
- 后一轮不会覆盖前一轮；
- 如果使用同一 workspace，后续轮可读取合法上下文，但不编造不存在事实。

**当前证据**：`dialogue_gateway_test.exs` “every turn produces frame ref”；`dialogue_gateway_real_loop_test` / E2E-01 E12 覆盖真实两轮 persistence 方向；`scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 从真实 Tauri 输入框/发送按钮发起两轮普通聊天，并在 `artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri/` 输出两个 `turn_id` 的 JSONL evidence、UI message role order、thinking 状态和截图。

**当前状态**：最小真实 Tauri checkpoint 已补，含 DOM 可见消息顺序和 loading/thinking 清退断言；三轮及更长对话仍待后续矩阵。

---

#### SC-AU01-B3 — 空消息不会发送

**作为作者**，我不小心只输入空格并按发送，系统不会制造空 turn。

**触发**：输入空白或纯空格并发送。

**期望结果**：
- 前端阻止发送或显示“请输入内容”；
- Channel 不产生有效业务 turn；
- 后端即使收到空 text，也返回明确 error；
- UI 不崩溃、不追加空消息。

**当前证据**：`WorkspaceChat.handleSend` `trim()` 后空文本直接 return；`DialogueGatewayTest` 覆盖 empty text error；`scripts/tauri_slice_verify.sh au01-empty-message-guard` 从真实 Tauri 输入框填空格并点击发送，验证无 `user_message` frame、DOM 消息数不变、thinking 不出现、输入仍可用，随后有效普通聊天完成。

**当前状态**：已验收。真实页面已证明空白输入不会创建业务 turn；Channel 直收空 text 的 fallback 仍作为局部防御测试保留。

---

#### SC-AU01-B4 — AI 说的和系统记录一致

**作为作者**，我看到的 AI 回复应当和系统记录的 frame / interaction 一致，不能 UI 显示一套、后端记录一套。

**触发**：发送普通聊天消息。

**期望结果**：
- `turn_result.assistant_message.text == frame.author_visible_draft.message`；
- interaction recorder 记录 user + assistant；
- 前端渲染的文本来自 `turn_result.assistant_message.text`；
- replay / trace 可还原这轮输出。

**当前证据**：`dialogue_gateway_test.exs` interaction recorder 断言；`v3_full_chain_test.exs` replay from reply-only trace never calls provider；`au01-ordinary-chat-two-turn-roundtrip` 验证真实 UI 展示的是 `turn_result.assistant_message.text`；`au01-turnresult-recorder-ui-consistency` 证明同一 `turn_id` 下 websocket `turn_result.assistant_message.text`、assistant transcript row `text`、assistant transcript row 内嵌 `turn_result.assistant_message.text` 与 reload 后恢复 UI 文本一致。

**当前状态**：已验收。B4 的 TurnResult / recorder / 恢复 UI 同源对账已由真实 Tauri checkpoint 闭环；完整 replay/trace 作者视图仍属 AU-07 cross-reference。

---

### 场景组 C：不执行、不谎报

#### SC-AU01-C1 — 纯聊天不应默认生成执行计划

**作为作者**，我只是问“这个开头应该更悬疑还是更温柔”，系统应当只讨论，不自动进入执行计划。

**触发**：在真实工作台发送普通讨论消息。

**期望结果**：
- 前端对普通聊天发送 `generate_micro_plan: false` 或不传该字段；
- 后端走 reply-only；
- 不生成 MicroPlan；
- 不出现确认卡、执行卡、工具结果卡；
- truthfulness 显示未调用工具、未写入。

**当前证据**：`DialogueGatewayTest` 覆盖 `generate_micro_plan = false` 时不产生 MicroPlan；`scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan` 从原生 Tauri 输入框/发送按钮触发普通消息并断言 `channel.user_message.start.generate_micro_plan=false`；`scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 进一步验证两轮普通聊天均为 `generate_micro_plan=false`、同 turn 中不存在 `planner.form_micro_plan.*` 事件，并且真实 UI 无执行/采纳/候选卡。

**当前状态**：最小真实 Tauri checkpoint 已补，含“不出现 action/candidate/adoption 卡”可见 UI 断言。

---

#### SC-AU01-C2 — 纯聊天不调用工具、不写入、不采纳

**作为作者**，我只是在聊方向，AI 不能声称调用了工具、生成了作品内容或写入了设定。

**触发**：发送“先聊方向，不写正文，不改设定”。

**期望结果**：
- `truthfulness.tool_called == false`；
- `truthfulness.production_write_performed == false`；
- `truthfulness.artifact_adopted == false`；
- `truthfulness.durable_behavior_opened == false`；
- 文本不包含“已写入”“已修改”“已采纳”等虚假完成语义；
- 前端不显示 artifact/adoption/progress 相关卡片。

**当前证据**：`dialogue_gateway_test.exs` “does not claim tool/adoption/write/behavior”；`workspace_channel_v3_test.exs` truthfulness no false claims；`au01-ordinary-chat-two-turn-roundtrip` 验证普通聊天不渲染 action/candidate/adoption UI。

**当前状态**：后端/Channel 已测试，普通聊天可见 no-action/no-adoption checkpoint 已补；完整 truthfulness UI 文案矩阵仍待后续。

---

#### SC-AU01-C3 — 讨论请求不变成表单化追问

**作为作者**，我想自然聊创作方向，系统不能把我打断成机械字段表单。

**触发**：发送“我想写小说但没想好”。

**期望结果**：
- 不出现 `required_slots` / `missing_slots` / `slot_form`；
- 前端不渲染机械表单；
- AI 回复是自然探索式语言；
- 如果需要追问，也应是对话式追问。

**当前证据**：`dialogue_gateway_test.exs` “does not open mechanical slot form”；`workspace_channel_v3_test.exs` “does not contain forbidden form fields”。

**当前状态**：后端/Channel 已测试，缺真实 UI 验收。

---

### 场景组 D：trace 与 replay

#### SC-AU01-D1 — 普通聊天可追溯且 replay 不调 LLM

**作为作者/开发者**，我能追溯普通聊天为什么这样回复；回放时不重新调用 LLM。

**触发**：完成一轮普通聊天后查看 trace/replay。

**期望结果**：
- trace 有 `frame_ref`、decision type、event order；
- replay report `provider_called == false`；
- 回放使用记录结果，不产生新 AI 回复；
- 作者视角不暴露敏感 provider 原文。

**当前证据**：`dialogue_gateway_test.exs` DecisionTrace assertions；`v3_full_chain_test.exs` “replay from reply-only trace never calls provider”。

**当前状态**：后端已测试；作者 UI 视图属于 AU-07，AU-01 只记录基础证据。

---

### 场景组 E：异常与降级

#### SC-AU01-E1 — LM Studio / provider 不可用时优雅降级

**作为作者**，本地 LM Studio 没启动或 provider 超时，工作台不崩溃，AI 回复区域显示诚实提示。

**触发**：provider 返回 `{:error, %{code: "timeout"}}` 或真实 LM Studio 不可用。

**期望结果**：
- Planner 生成 fallback frame；
- `assistant_message.text` 是可读降级提示；
- `frame_ref` 仍存在；
- trace 记录 recovery / fallback；
- 前端正常显示降级消息，loading 结束；
- 下一轮仍可继续发送。

**当前证据**：`v3_full_chain_test.exs` “broken provider -> fallback frame -> recovery trace”；`planner_real_llm_test.exs` “handle_input never crashes with broken provider”；`au10-workbench-recovery-disconnect-timeout-tauri` 已从真实工作台证明不可达 provider 后显示诚实 no-write fallback、loading 结束、恢复 provider 后下一轮可继续。

**当前状态**：provider 不可用和真实 timeout 恢复已由 AU-10 recovery checkpoint 闭环；乱码 UI 降级已由 `au01-garbage-json-recovery` 闭环。

---

#### SC-AU01-E2 — LLM 返回乱码 JSON 时优雅降级

**作为作者**，如果 LLM 返回无法解析的内容，系统不把乱码展示给我。

**触发**：provider 返回 `not valid json {{{`。

**期望结果**：
- 系统先尝试 parse retry；
- 重试仍失败时 fallback；
- 前端显示友好降级提示；
- 不暴露 raw LLM 输出；
- Channel 不断开。

**当前证据**：`Planner.parse_json_retry/3`；`v3_full_chain_test.exs` “garbage JSON -> fallback frame -> never crashes”；`planner_real_llm_test.exs` “Planner falls back when provider returns garbage”。

**当前状态**：后端/E2E stub 已测试，缺 UI 降级验收。

---

#### SC-AU01-E3 — frame 校验失败时给作者友好提示

**作为作者**，如果 AI 产出的 frame 带有禁止语义，系统应拦截并给我可理解提示，而不是暴露内部校验 reason。

**触发**：LLM 产出含 `approved` / `ready_to_execute` 等禁止语义的 frame。

**期望结果**：
- `DialogueFrame.validate/1` 拦截；
- Channel 不崩溃；
- 前端收到作者友好提示；
- 内部 reason 进入 trace/log，不直接暴露给作者；
- 后续消息不受影响。

**当前证据**：`dialogue_gateway_test.exs` 覆盖 DialogueFrame validation rejects forbidden semantics；旧文档已记录 error reason 暴露风险。

**当前状态**：已验收。`au01-frame-validation-friendly-error` 证明真实工作台会拦截 forbidden semantics frame，作者看到通用友好 fallback，UI 和 websocket `turn_result` 不暴露内部 validation reason，下一轮可继续。

---

## 5. 场景覆盖状态

### 5.1 文件级对账矩阵（2026-06-20）

| 场景 ID / 名称 | 设计期望 | Contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / slice |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU01-A1 打开工作台并看到可聊天状态 | 工作台可见作品、服务状态、聊天输入和已有上下文 | WorkSession / Channel join；Tauri desktop-first | `WorkspaceChat.tsx`、`WorkspaceChannel`、`WorkSession` | `workspace_channel_v3_test.exs` | `au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json` | 已验收 | 无 | closed | P0 | `AU01-ordinary-chat-two-turn-roundtrip.md` |
| SC-AU01-A2 作者输入创作想法并看到回复 | 作者输入后看到 user/assistant 回复，loading 清退 | `TurnResult.assistant_message`；message order | `WorkspaceChat.handleSend`、`workspaceApi.sendUserMessage`、`DialogueGateway.handle_input/3` | `dialogue_gateway_test.exs` | `au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json`；`au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio/summary.json` | 已验收 | 无 | closed | P0 | `AU01-ordinary-chat-two-turn-roundtrip.md` |
| SC-AU01-B1 普通创作聊天产生有效 TurnResult | reply-only TurnResult 有 assistant message、truthfulness、frame ref | `TurnResult` / `DialogueFrame` / truthfulness | `Planner.form_frame/2`、`DialogueGateway`、`WorkspaceChannel.user_message` | `dialogue_gateway_test.exs`、`workspace_channel_v3_test.exs` | `au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json` | 已验收 | 无 | closed | P0 | `AU01-ordinary-chat-two-turn-roundtrip.md` |
| SC-AU01-B2 连续多轮不覆盖、不串话 | 两轮在同一会话追加，不覆盖、不复用 turn id | session transcript / turn id | `ContextAssembler`、`WorkspaceContext`、`InteractionRecorder` | `dialogue_gateway_test.exs` | `au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json` | 已验收 | 无 | closed | P0 | `AU01-ordinary-chat-two-turn-roundtrip.md` |
| SC-AU01-B3 空消息不会发送 | 空白输入不产生 user_message、不追加 DOM 消息，输入仍可用 | blank input guard；no empty business turn | `WorkspaceChat.handleSend`、`WorkspaceChannel.user_message` | Channel 空文本 fallback 局部测试 | `au01-empty-message-guard-tauri/summary.json` | 已验收 | 无 | closed | P0 | `AU01-empty-message-guard.md` |
| SC-AU01-B4 AI 说的和系统记录一致 | UI 文本、TurnResult、recorder/replay 记录一致 | interaction recorder / replay record | `InteractionRecorder`、`ReplayService`、`WorkspaceChat`、`WorkSessionService.show/resume` | `dialogue_gateway_test.exs`、`native-tauri-verifier.test.mjs` | `au01-turnresult-recorder-ui-consistency-tauri/summary.json`；`quality_accept au01-turnresult-recorder-ui-consistency` | 已验收 | replay/trace 作者视图仍归 AU-07 | cross-reference | P1 | `AU01-turnresult-recorder-ui-consistency.md` |
| SC-AU01-C1 纯聊天不应默认生成执行计划 | 普通聊天不触发 MicroPlan、确认卡、执行卡 | `generate_micro_plan=false`；no MicroPlan by default | `WorkspaceChat.handleSend`、`WorkspaceChannel.user_message`、`Planner.form_micro_plan/2` | `DialogueGatewayTest` no MicroPlan | `au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json`；`au10-ordinary-chat-no-micro-plan-tauri/summary.json` | 已验收 | 无 | closed | P0 | `AU01-ordinary-chat-two-turn-roundtrip.md` |
| SC-AU01-C2 纯聊天不调用工具、不写入、不采纳 | truthfulness no tool/write/adoption，UI 无工具/采纳卡 | truthfulness / no production write | `DialogueGateway`、`WorkspaceChannel`、`WorkspaceChat` cards | `dialogue_gateway_test.exs`、`workspace_channel_v3_test.exs` | `au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json` | 已验收 | 无 | closed | P0 | `AU01-ordinary-chat-two-turn-roundtrip.md` |
| SC-AU01-C3 讨论请求不变成表单化追问 | 不出现 slot form / required_slots；语言自然 | no mechanical slot form | `Planner` frame contract、`DialogueFrame.validate/1` | `dialogue_gateway_test.exs`、`workspace_channel_v3_test.exs` | 无 | 已测试 | 缺真实 UI 反证矩阵 | evidence gap | P2 | `AU01-freeform-no-slot-form-ui` |
| SC-AU01-D1 普通聊天可追溯且 replay 不调 LLM | trace 有 frame/order；replay 不重新调用 provider | DecisionTrace / ReplayService | `DecisionTrace`、`ReplayService`、why/replay UI | `dialogue_gateway_test.exs`、`v3_full_chain_test.exs` | 无 | 已测试 | AU-01 缺普通聊天 trace/replay UI；主要 owner 为 AU-07 | cross-reference | P1 | `AU07-trace-replay-chat-readonly` |
| SC-AU01-E1 provider 不可用时优雅降级 | fallback frame 可读、loading 结束、下一轮可继续 | provider error fallback / no crash | `Planner.fallback_frame/2`、`Provider.Gateway`、`WorkspaceChat` | `v3_full_chain_test.exs`、`planner_real_llm_test.exs` | `au10-workbench-recovery-disconnect-timeout-tauri/summary.json`；`au10-workbench-recovery-provider-timeout-tauri/summary.json` | 已验收 | 证据 owner 在 AU-10 recovery，AU-01 只引用 cross-file 证据 | cross-reference | P1 | `AU10-workbench-recovery-disconnect-timeout.md` / provider timeout |
| SC-AU01-E2 LLM 乱码 JSON 时优雅降级 | parse/retry/fallback；UI 友好提示；raw LLM 不可见；Channel 不断 | Planner parse retry / fallback frame / raw output redaction | `Planner.parse_json_retry/3`、`Planner.fallback_frame/2`、`SliceVerify` test provider、external driver | `v3_full_chain_test.exs`、`planner_real_llm_test.exs`、`native-tauri-verifier.test.mjs` | `au01-garbage-json-recovery-tauri/summary.json`；`quality_accept au01-garbage-json-recovery` | 已验收 | 无 | closed | P0 | `AU01-garbage-json-recovery.md` |
| SC-AU01-E3 frame 校验失败时作者友好提示 | 禁止语义被拦截，作者看到友好提示，内部 reason 只进 trace/log | `DialogueFrame.validate/1` / Channel fallback payload redaction | `DialogueFrame`、`DialogueGateway`、`WorkspaceChannel`、external driver | `dialogue_gateway_test.exs`、`workspace_channel_v3_test.exs`、`native-tauri-verifier.test.mjs` | `au01-frame-validation-friendly-error-tauri/summary.json`；`quality_accept au01-frame-validation-friendly-error` | 已验收 | 无 | closed | P1 | `AU01-frame-validation-friendly-error.md` |

**覆盖结论：13 个用户场景；11/13 已有真实页面外部自动化证据（其中 SC-AU01-E1 的证据 owner 为 AU-10 recovery）；2/13 已测试但缺 AU-01 文件级 UI 对账。当前新增 `au01-turnresult-recorder-ui-consistency` 后已关闭 SC-AU01-B4 的 P1 缺口；AU-01 文件级退出标准已满足，可以进入 AU-02。剩余 P1 为 D1 trace/replay UI cross-reference（owner：AU-07），P2 为 C3 自由讨论 no-slot-form UI 反证。**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| AU01-GAP-01 — 缺真实工作台 walkthrough / Playwright 验收 | 后端通过不等于作者能在桌面工作台顺畅聊天 | 已补普通聊天两轮 checkpoint：真实工作台输入、收到回复、thinking 清退；后续扩展异常矩阵 |
| AU01-GAP-02 — 普通聊天默认触发 MicroPlan 风险 | 普通聊天若被强制推入 plan/执行链，会偏离 AU-01 | 已补 checkpoint：两轮 `generate_micro_plan=false`、无 `planner.form_micro_plan.*`、无执行/采纳/候选卡 |
| AU01-GAP-03 — frame validation 错误的作者友好提示不足 | 用户可能看到内部 reason 或无反馈 | 已关闭：`au01-frame-validation-friendly-error` 证明作者看到通用友好 fallback，UI 和 websocket `turn_result` 不暴露内部 validation reason，业务日志保留详细 reason，后续消息可恢复 |
| AU01-GAP-04 — provider 不可用 / 乱码降级缺 UI 验收 | provider 不可用和乱码返回如果只停留在后端测试，不能证明作者端不崩溃 | 已关闭：provider unavailable / timeout 由 AU-10 recovery 证据覆盖；乱码 JSON 已由 `au01-garbage-json-recovery` 证明友好 fallback、raw payload 不可见、下一轮恢复 |
| AU01-GAP-05 — 多轮聊天 UI 顺序和状态缺自动化证明 | 消息顺序、loading、重复发送等体验风险未覆盖 | 已补两轮 checkpoint；三轮、重复发送和长会话体验降为 P2 后续矩阵 |
| AU01-GAP-06 — 普通聊天 recorder / replay / UI 一致性缺文件级证据 | B4 已完成同一 turn 的 UI / TurnResult / recorder / reload 恢复对账；D1 仍缺作者 trace/replay UI | B4 已关闭：`au01-turnresult-recorder-ui-consistency` 证明同一 `turn_id` 的可见 assistant 文本、websocket TurnResult、transcript row 与 reload 恢复 UI 一致；D1 由 AU-07 owner 补 trace/replay 页面，不在 AU-01 中重复造入口 |

---

## 7. 已有证据与限制

| 证据 | 证明了什么 | 不能证明什么 |
|---|---|---|
| `dialogue_gateway_test.exs` | reply-only、truthfulness、empty text、interaction recorder、frame validation | 真实前端入口、DOM 渲染、loading、用户体验 |
| `workspace_channel_v3_test.exs` | Channel 可接收 user_message 并广播 turn_result，truthfulness 字段存在 | Tauri 桌面 UI 是否正确发送/展示 |
| `v3_full_chain_test.exs` | stub LLM 下 reply-only、replay、error recovery 等主链可跑 | 真实 LM Studio 质量、前端视觉和交互 |
| `planner_real_llm_test.exs` | LM Studio 可用时 Planner 能解析真实 LLM，异常 complete_fn 不崩溃 | 用户完整工作台体验 |
| `WorkspaceChat.tsx` | 真实入口有输入/消息/状态渲染代码 | 不单独证明异常矩阵或完整 replay/trace |
| `scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` | 原生 Tauri 输入框/发送按钮可连续发起两轮普通聊天，验证 DOM 消息顺序、thinking 清退、无 MicroPlan、无 action/candidate/adoption UI；`--real-lmstudio` 验证真实 provider 两轮 form_frame 请求 | 不证明乱码 JSON、frame validation 错误提示、完整 replay/trace UI |
| `scripts/tauri_slice_verify.sh au01-empty-message-guard` | 原生 Tauri 输入框空白发送不会产生 websocket `user_message`、不会追加可见消息，且后续有效普通聊天可完成 | 不证明乱码 JSON、frame validation 错误提示、完整 replay/trace UI |
| `scripts/tauri_slice_verify.sh au01-garbage-json-recovery` | 原生 Tauri 输入框触发 malformed provider JSON，证明页面显示友好 fallback、raw provider payload 不可见、thinking 清退、输入/Channel 保持可用，下一轮普通聊天完成且无 MicroPlan | 不证明禁止语义 frame validation 的专门提示，也不证明完整 replay/trace UI |
| `scripts/tauri_slice_verify.sh au01-frame-validation-friendly-error` | 原生 Tauri 输入框触发 forbidden semantics frame，证明页面显示通用友好 fallback、UI 与 websocket `turn_result` 不暴露内部 validation reason、业务日志保留详细 reason，下一轮普通聊天完成且无 MicroPlan | 不证明完整 replay/trace UI |
| `scripts/tauri_slice_verify.sh au01-turnresult-recorder-ui-consistency` | 原生 Tauri 输入框发送普通聊天，证明当前 UI、websocket `turn_result.assistant_message.text`、interaction recorder 的 assistant transcript row 和 reload 后恢复 UI 都展示同一 assistant 文本 | 不证明完整 trace/replay 作者页面；该 cross-reference 归 AU-07 |

---

## 8. 验收命令

```bash
# 后端 / Channel 局部证据
mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
mix test --include integration apps/novel_e2e/test/novel_e2e/v3_full_chain_test.exs

# 真实 LM Studio 证据（本地 LM Studio 启动后）
mix test --include real_llm apps/novel_application/test/novel_application/planner_real_llm_test.exs

# 原生 Tauri 主链证据
bash scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip
bash scripts/tauri_slice_verify.sh --real-lmstudio au01-ordinary-chat-two-turn-roundtrip
bash scripts/tauri_slice_verify.sh au01-empty-message-guard
bash scripts/tauri_slice_verify.sh au01-garbage-json-recovery
bash scripts/tauri_slice_verify.sh au01-frame-validation-friendly-error
bash scripts/tauri_slice_verify.sh au01-turnresult-recorder-ui-consistency
bash scripts/quality_accept.sh au01-ordinary-chat-two-turn-roundtrip --surface tauri
bash scripts/quality_accept.sh au01-garbage-json-recovery --surface tauri
bash scripts/quality_accept.sh au01-frame-validation-friendly-error --surface tauri
bash scripts/quality_accept.sh au01-turnresult-recorder-ui-consistency --surface tauri
bash scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan

# 仍需补：replay UI / C3 no-slot-form UI 反证
# 目标：旧 turn replay 有作者可理解反馈，自由讨论不被表单化有真实 UI 反证
```

> 注意：这些命令证明 AU-01 普通聊天主路径、空消息 guard、乱码 JSON 降级、frame validation 友好错误和 TurnResult/recorder/UI 一致性 checkpoint。AU-01 的完整验收仍必须覆盖 trace/replay 矩阵和 C3 no-slot-form UI 反证。
