# AU-01 与 AI 聊创作

> 作者视角：我打开真实工作台，可以像和一个懂创作的写作伙伴聊天一样讨论故事创意、风格、角色。AI 会自然回应，不会偷偷替我写东西、改设定、调用工具，或假装已经做了什么。
>
> 2026-05-14 对账结论：后端 reply-only 主链、Channel roundtrip、错误恢复链路已有较多证据；真实入口 `WorkspaceChat -> socket.ts` 已改为普通聊天默认 `generate_micro_plan: false`，并新增 `scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 原生 Tauri 自动化，能从输入框/发送按钮发起两轮普通聊天并验证两轮都没有进入 MicroPlan。仍缺 DOM 级验收：自然回复文本、loading 结束、消息顺序和“不出现执行卡”的可见 UI 断言。

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
| `frontend/src/App.tsx` | 当前真实入口，渲染 `WorkspaceChat` | 真实用户入口，不是 `WorkbenchV3` |
| `WorkspaceChat.tsx` | 当前主工作台：输入、loading、消息渲染、socket 调用 | 部分实现，缺 Playwright/真人验收 |
| `frontend/src/lib/socket.ts` `sendMessage` | 当前主工作台发送 `user_message` | 默认 `generate_micro_plan: false`；原生 Tauri 两轮普通聊天验收可证明真实入口消费该默认契约 |
| `WorkspaceChannel.handle_in("user_message")` | Channel 接收前端消息并广播 `turn_result` | 有 Channel roundtrip 测试 |
| `DialogueGateway.handle_input/5` | v3 对话主链入口 | reply-only、truthfulness、empty text、interaction recorder 有测试 |
| `Planner.form_frame/3` | 调 LLM 形成 DialogueFrame，异常时 fallback | broken provider / garbage JSON 在 E2E 和 planner 测试中覆盖 |
| `TurnResultBuilder` / TurnResult schema | 前端消费 canonical 输出 | application / e2e / schema 测试覆盖 |
| `ReplayService` | replay 不重新调用 provider | E2E reply-only replay 有测试 |
| `docs/design-v3/acceptance/e2e/E2E-01-full-chain.md` | 端到端证据索引 | E1/E11 与 AU-01 相关，但仍不是完整 UI 验收 |

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

**当前证据**：`App.tsx` 渲染 `WorkspaceChat`；`WorkspaceChat.tsx` 有欢迎消息、LLM health、socket 状态。

**当前状态**：部分实现，缺真实 UI walkthrough / Playwright 验收。

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

**当前证据**：`WorkspaceChat.handleSend` 追加 user message 并调用 `sendMessage`；`WorkspaceChannelV3Test` 覆盖 `user_message -> turn_result`；`DialogueGatewayTest` 和 `V3FullChainTest` 覆盖 reply-only 主链。

**当前状态**：部分实现。前后端局部证据充分，但缺完整 UI 自动化/真人走查。

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

**当前证据**：`dialogue_gateway_test.exs` “produces primary DialogueFrame”；`v3_full_chain_test.exs` “full chain: input -> frame -> turn_result -> trace”；`workspace_channel_v3_test.exs` broadcast turn_result。

**当前状态**：后端/Channel 已测试，缺真实 UI 验收。

---

#### SC-AU01-B2 — 连续多轮不覆盖、不串话

**作为作者**，我连续聊三轮，界面按顺序保留每轮用户消息和 AI 回复。

**触发**：连续发送三条普通聊天消息。

**期望结果**：
- 每条消息有独立 `turn_id`、`frame_ref`、trace；
- 前端消息列表顺序稳定；
- 后一轮不会覆盖前一轮；
- 如果使用同一 workspace，后续轮可读取合法上下文，但不编造不存在事实。

**当前证据**：`dialogue_gateway_test.exs` “every turn produces frame ref”；`dialogue_gateway_real_loop_test` / E2E-01 E12 覆盖真实两轮 persistence 方向；`scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 从原生 Tauri 输入框/发送按钮发起两轮普通聊天，并在 `artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri/` 输出两个 `turn_id` 的 `channel.user_message.start`、`dialogue_gateway.handle_input.done`、`channel.user_message.done` JSONL evidence。

**当前状态**：部分实现 / 原生 Tauri 主链验收已建立；仍缺 DOM 级消息顺序和 loading 可见断言。

---

#### SC-AU01-B3 — 空消息不会发送

**作为作者**，我不小心只输入空格并按发送，系统不会制造空 turn。

**触发**：输入空白或纯空格并发送。

**期望结果**：
- 前端阻止发送或显示“请输入内容”；
- Channel 不产生有效业务 turn；
- 后端即使收到空 text，也返回明确 error；
- UI 不崩溃、不追加空消息。

**当前证据**：`WorkspaceChat.handleSend` `trim()` 后空文本直接 return；`DialogueGatewayTest` 覆盖 empty text error。

**当前状态**：部分实现。前端阻止和 application error 有证据；Channel 层空消息友好提示未验收。

---

#### SC-AU01-B4 — AI 说的和系统记录一致

**作为作者**，我看到的 AI 回复应当和系统记录的 frame / interaction 一致，不能 UI 显示一套、后端记录一套。

**触发**：发送普通聊天消息。

**期望结果**：
- `turn_result.assistant_message.text == frame.author_visible_draft.message`；
- interaction recorder 记录 user + assistant；
- 前端渲染的文本来自 `turn_result.assistant_message.text`；
- replay / trace 可还原这轮输出。

**当前证据**：`dialogue_gateway_test.exs` interaction recorder 断言；`v3_full_chain_test.exs` replay from reply-only trace never calls provider。

**当前状态**：后端已测试，缺 UI 渲染到 DOM 的验收。

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

**当前证据**：`DialogueGatewayTest` 覆盖 `generate_micro_plan = false` 时不产生 MicroPlan；`scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan` 从原生 Tauri 输入框/发送按钮触发普通消息并断言 `channel.user_message.start.generate_micro_plan=false`；`scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 进一步验证两轮普通聊天均为 `generate_micro_plan=false` 且同 turn 中不存在 `planner.form_micro_plan.*` 事件。

**当前状态**：部分实现 / 原生 Tauri 最小验收已建立；仍缺可见 UI 断言“不出现执行/采纳卡”。

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

**当前证据**：`dialogue_gateway_test.exs` “does not claim tool/adoption/write/behavior”；`workspace_channel_v3_test.exs` truthfulness no false claims。

**当前状态**：后端/Channel 已测试，缺真实 UI 验收；且受 SC-AU01-C1 的前端默认计划风险影响。

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

**当前证据**：`v3_full_chain_test.exs` “broken provider -> fallback frame -> recovery trace”；`planner_real_llm_test.exs` “handle_input never crashes with broken provider”。

**当前状态**：后端/E2E stub 已测试，缺真实工作台 UI 降级验收。

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

**当前状态**：部分实现。校验有测试，作者友好错误映射和 UI 验收不足。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否完整前后端闭环 |
|---|---|---|---|
| SC-AU01-A1 | 打开工作台并看到可聊天状态 | 部分实现 | 否 |
| SC-AU01-A2 | 作者输入创作想法并看到回复 | 部分实现 | 否 |
| SC-AU01-B1 | 普通创作聊天产生有效 TurnResult | 后端/Channel 已测试 | 否 |
| SC-AU01-B2 | 连续多轮不覆盖、不串话 | 部分实现 / 原生 Tauri 两轮主链验收已建立 | 否 |
| SC-AU01-B3 | 空消息不会发送 | 部分实现 | 否 |
| SC-AU01-B4 | AI 说的和系统记录一致 | 后端已测试 | 否 |
| SC-AU01-C1 | 纯聊天不应默认生成执行计划 | 部分实现 / 原生 Tauri 最小验收已建立 | 否 |
| SC-AU01-C2 | 纯聊天不调用工具、不写入、不采纳 | 后端/Channel 已测试 | 否 |
| SC-AU01-C3 | 讨论请求不变成表单化追问 | 后端/Channel 已测试 | 否 |
| SC-AU01-D1 | 普通聊天可追溯且 replay 不调 LLM | 后端已测试 | 否 |
| SC-AU01-E1 | provider 不可用时优雅降级 | 后端/E2E stub 已测试 | 否 |
| SC-AU01-E2 | LLM 乱码 JSON 时优雅降级 | 后端/E2E stub 已测试 | 否 |
| SC-AU01-E3 | frame 校验失败时作者友好提示 | 部分实现 | 否 |

**覆盖结论：13 个用户场景；0/13 完整前后端验收；新增 1 条原生 Tauri 两轮普通聊天主链证据；9/13 有后端/Channel/E2E 局部证据；4/13 仍存在真实 UI 可见行为缺口。**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| AU01-GAP-01 — 缺真实工作台 walkthrough / Playwright 验收 | 后端通过不等于作者能在桌面工作台顺畅聊天 | P0：补“打开工作台 -> 输入 -> 收到回复 -> loading 结束”的场景验收 |
| AU01-GAP-02 — 普通聊天默认触发 MicroPlan 风险 | 普通聊天若被强制推入 plan/执行链，会偏离 AU-01；当前默认 false 且已有 Tauri 主链证据，但缺 UI 卡片可见断言 | P0：继续补 DOM/截图级验收，确认普通聊天不出现执行/采纳卡 |
| AU01-GAP-03 — 空消息 / frame validation 错误的作者友好提示不足 | 用户可能看到内部 reason 或无反馈 | P1：统一 Channel fallback/error copy，前端展示友好错误 |
| AU01-GAP-04 — provider 不可用 / 乱码降级缺 UI 验收 | 已有后端降级证明，但不知道真实工作台是否可恢复 | P1：补 LM Studio 断开、garbage stub 的 UI walkthrough |
| AU01-GAP-05 — 多轮聊天 UI 顺序和状态缺自动化证明 | 消息顺序、loading、重复发送等体验风险未覆盖 | P1：补多轮 Playwright 或组件级测试 |

---

## 7. 已有证据与限制

| 证据 | 证明了什么 | 不能证明什么 |
|---|---|---|
| `dialogue_gateway_test.exs` | reply-only、truthfulness、empty text、interaction recorder、frame validation | 真实前端入口、DOM 渲染、loading、用户体验 |
| `workspace_channel_v3_test.exs` | Channel 可接收 user_message 并广播 turn_result，truthfulness 字段存在 | Tauri 桌面 UI 是否正确发送/展示 |
| `v3_full_chain_test.exs` | stub LLM 下 reply-only、replay、error recovery 等主链可跑 | 真实 LM Studio 质量、前端视觉和交互 |
| `planner_real_llm_test.exs` | LM Studio 可用时 Planner 能解析真实 LLM，异常 complete_fn 不崩溃 | 用户完整工作台体验 |
| `WorkspaceChat.tsx` | 真实入口有输入/消息/状态渲染代码 | 没有验收截图或自动化走查证明 |
| `scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` | 原生 Tauri 输入框/发送按钮可连续发起两轮普通聊天，且两轮都不进入 MicroPlan | DOM 中消息顺序、loading 消失、执行卡不可见 |

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
bash scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan

# 仍需补：DOM 级真实工作台 UI / Tauri walkthrough
# 目标：打开工作台 -> 输入普通创作聊天 -> 看到自然回复 -> loading 结束 -> 不出现执行卡 -> 异常可恢复
```

> 注意：这些命令只能证明局部链路。AU-01 的完整验收必须覆盖真实用户入口 `WorkspaceChat` 的 UI 行为。
