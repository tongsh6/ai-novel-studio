# AU-10 工作台实时交互

> 作者视角：工作台是我和 AI 协作的主界面。我需要实时知道系统状态、AI 在做什么、现在等我做什么、哪些按钮可以点。界面上的卡片、候选、action、任务状态、trace 和投影状态必须来自真实主链，不能由前端猜测或用 mock 冒充。
>
> 2026-05-14 对账结论：历史上曾同时存在 `WorkspaceChat` 真实入口和 `历史旁路工作台` v3 消费者实验组件。`au10-micro-plan-entry` 已证明真实前端入口可触发 MicroPlan；`au01-ordinary-chat-two-turn-roundtrip` 已证明原生 Tauri 可从输入框/发送按钮连续完成两轮普通聊天且不进入 MicroPlan；VS-10 进一步新增 `vs10-observability-spine` 浏览器验证和 `scripts/tauri_slice_verify.sh vs10-observability-spine` 原生 Tauri 自动化验证，可在不等待人工操作的情况下驱动真实工作台控件并校验日志链。该结论已被 2026-06-12 对账更新，以下状态以 2026-06-12 为准。
>
> 2026-05-22 验收卫生更正：历史 Tauri 验收曾依赖产品前端内的 autorun / UI state 上报路径。该路径已废弃并清理；当前可重复运行的 Tauri 验证必须由外部 Playwright driver 操作真实界面，不允许在 `WorkspaceChat`、`socket.ts` 或 Channel 中恢复 slice-id 识别、自动填充、自动点击或验收状态上报。
>
> 2026-06-12 真源对齐：`WorkspaceChat` 已是当前真实入口，并已有多条外部 Tauri driver 证据覆盖 provider health、普通聊天、候选继续探索、候选 action 授权、confirm-before-execute、保存/不保存/修改后保存、trace/why、保存后阅读投影、档案真实数据、记忆创建/召回、AU-10 MicroPlan 入口和 no-MicroPlan 普通聊天。`历史旁路工作台` / `历史旁路 socket helper` 旁路已退役删除，避免继续保留第二套工作台 UI/helper 语义。AU-10 当前主要缺口不再是“这些链路不存在”，而是完整工作台矩阵尚未一次性闭环：首屏/顶部状态栏在真实 viewport 下布局失控，长跑 `task_state`/断线/超时恢复缺完整 UI 证据，部分组件仍有设计追溯/文案集中/隐藏 metadata 卫生问题，且缺覆盖这些状态的统一 AU-10 Tauri 验收。
>
> 2026-06-12 截图问题第一轮修复：明确“规划大纲/卷数/章节数/角色成长路线/势力结构”的作者输入会被归一为创作产出请求并进入 `plot_outline`，不再停在候选方向；`candidate_set` 按 `artifact_type` 显示“大纲草稿 / 章节正文草稿 / 角色设定草稿 / 世界设定草稿”，assistant_message fallback 与离线 provider rationale 同步使用“待保存草稿”语义；保存/不保存/修改后保存动作说明目标落点；顶部栏压缩可见运行态，模型长名进入 tooltip，候选按钮和结果卡从“采用这个方向/候选方向已采用”调整为“设为后续方向/已设为后续方向”，明确不写入章节正文或作品事实。这只是语义与首屏拥挤的实现修复，仍需 AU-10 专属 Tauri matrix 和 1280×800 screenshot 断言复核。
>
> 2026-06-17 baseline matrix 复核：新增 `bash scripts/tauri_slice_verify.sh au10-workbench-matrix-layout`。该外部 Tauri driver 不依赖产品验收钩子，在 1280×800 真实工作台依次验证首屏/顶部栏/输入区/结构栏无横向溢出、普通聊天默认 no-MicroPlan、why 弹窗不泄漏 raw prompt、候选方向通过服务器授权 `author_action.choose_candidate`、候选选择不写生产正文、正文草稿采纳进入 adoption boundary、Reading Projection 可读取已采纳正文与字数、任务状态首屏基线可见。证据：`artifacts/slice-verify/au10-workbench-matrix-layout-tauri/summary.json`。这只是 AU-10 baseline checkpoint；后续已补 task_state checkpoint、provider failure recovery CP1、WebSocket service reconnect CP2 与 cancel waiting CP3A，仍未闭环真实 timeout、完整异步 LongRunner、disabled/stale/idempotency UI 和全 card 视觉矩阵。
>
> 2026-06-17 task_state checkpoint：新增 `bash scripts/tauri_slice_verify.sh au10-workbench-recovery-taskstate`。该外部 Tauri driver 通过真实工作台生成并采纳正文、进入阅读模式点击真实“导出全书”，观察 websocket `task_state` frame 并返回工作台确认“任务完成”可见；证据包含 RUNNING / CHECKPOINT / COMPLETED。Channel 回归 `workspace_channel_task_state_test.exs` 覆盖导出失败时 FAILED 广播。这只闭合真实导出动作的同步任务状态 checkpoint；provider failure recovery CP1 已由同日 `au10-workbench-recovery-disconnect-timeout` 覆盖，WebSocket service reconnect CP2 已由同日 `au10-workbench-recovery-reconnect` 覆盖，cancel waiting CP3A 已由同日 `au10-workbench-recovery-cancel-waiting` 覆盖；真实 timeout 和完整异步 LongRunner streaming 仍未闭环。
>
> 2026-06-17 provider failure recovery checkpoint：新增 `bash scripts/tauri_slice_verify.sh au10-workbench-recovery-disconnect-timeout`。该外部 Tauri driver 通过产品 provider config API 把 runtime 切到不可达 LM Studio endpoint，驱动真实工作台发送消息，验证 Provider Gateway 记录 `provider_gateway.complete.error`，Channel 返回可恢复 fallback TurnResult，UI 显示无法连接且明确本轮没有待采纳内容/没有写入作品事实，loading 清除、输入可继续；恢复 `slice_verify` provider 后下一轮完成。证据：`artifacts/slice-verify/au10-workbench-recovery-disconnect-timeout-tauri/summary.json`。这只闭合 provider 失败恢复 CP1；WebSocket service reconnect CP2 已由同日 `au10-workbench-recovery-reconnect` 覆盖；cancel waiting CP3A 已由同日 `au10-workbench-recovery-cancel-waiting` 覆盖；完整异步 LongRunner streaming、stale/disabled/idempotency UI 仍未闭环。
>
> 2026-06-17 WebSocket service reconnect checkpoint：新增 `bash scripts/tauri_slice_verify.sh au10-workbench-recovery-reconnect`。该外部 Tauri driver 不依赖产品验收钩子，也不依赖浏览器离线模拟；它从产品外部停止本次 slice 的 Phoenix 服务，验证真实工作台显示“同步离线”、输入被禁用且 loading 清除；再重启同一 slice 服务，观察 `channel.join.done` rejoin，UI 恢复“同步已连接”，并发送下一轮消息完成。证据：`artifacts/slice-verify/au10-workbench-recovery-reconnect-tauri/summary.json`。这只闭合 WebSocket service disconnect/reconnect CP2；cancel waiting CP3A 已由同日 `au10-workbench-recovery-cancel-waiting` 覆盖；真实 timeout、完整异步 LongRunner streaming、stale/disabled/idempotency UI 仍未闭环。
>
> 2026-06-17 cancel waiting checkpoint：新增 `bash scripts/tauri_slice_verify.sh au10-workbench-recovery-cancel-waiting`。该外部 Tauri driver 触发真实高风险工具 confirmation，点击可见“拒绝”，验证 `author_action` 使用服务器授权动作、Channel 返回 cancelled action_result 与 cancelled TurnResult，`behavior_state.active=nil`，truthfulness 明确 `tool_called=false` / `production_write_performed=false`；真实工作台显示“已取消等待”、清除确认按钮、输入可用，并完成下一轮消息。证据：`artifacts/slice-verify/au10-workbench-recovery-cancel-waiting-tauri/summary.json`。这只闭合取消等待 CP3A；真实 timeout、完整异步 LongRunner streaming、stale/disabled/idempotency UI 仍未闭环。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 一打开工作台就看到真实系统状态 | 显示当前 Work、LLM health、模型名、WebSocket 状态和可用/降级原因 |
| 发送普通创作消息 | 用户消息立即出现，loading 明确，回复回来后 loading 消失 |
| 看到 AI 的结构化回复 | `ui_cards`、候选方向、adoption、projection、task_state 按 TurnResult/Channel 事件渲染 |
| 点击候选方向继续探索 | 选择候选时提交合法 action 或 user intent，不等同采纳 |
| 点击确认/拒绝/取消等 action | 所有按钮必须来自服务器 `available_actions`，并通过 `author_action` 回传 |
| 处理草稿采纳、修改、放弃 | 只通过真实 adoption 主流程，不调用不存在的 Channel handler |
| 看到长任务状态 | `task_state` RUNNING/CHECKPOINT/COMPLETED/FAILED 实时更新真实首屏 |
| 查看 AI 为什么这样做 | 作者能看到可理解的 frame/trace 摘要，开发信息不泄漏 |
| 切到阅读模式或投影状态 | projection hint 只触发刷新/状态更新，不直接写作品事实 |
| 服务或 LLM 异常时继续判断 | 输入禁用、错误文案、重连/重试状态和恢复路径清楚 |

明确不能做：
- 前端不能展示服务器没有授权的 action；
- UI card action 不能绕开 `available_actions` 自行拼可执行动作；
- disabled 按钮不能通过前端状态 hack 变成可执行；
- loading 结束后不能留下空白或假消息；
- 长跑状态不能在后台已 RUNNING 时仍显示“待机”；
- Tauri 桌面应用不能直接使用浏览器假设或绕过 `env.ts` 端点抽象。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU10-I1 / `00c` #9 | TurnResult 是 UI canonical 输出 | SC-AU10-B2、SC-AU10-C1、SC-AU10-C3 |
| AU10-I2 / `00c` #10 | UI 只能提交服务器授权 action | SC-AU10-C3、SC-AU10-C4 |
| AU10-I3 / `00c` #11 | candidate selection 不等于 adoption | SC-AU10-C2、SC-AU10-D1 |
| AU10-I4 / `00c` #15 | projection hint 只刷新投影，不直接写作品事实 | SC-AU10-E1 |
| AU10-I5 | 真实入口必须消费 task_state，而不是只在旁路组件实现 | SC-AU10-D2 |
| AU10-I6 | 桌面端点和 UI 约束必须遵守 Tauri/Design-Driven 规则 | SC-AU10-F2 |

---

## 3. 契约引用

| 契约 / 实现 | 用途 | 当前证据判断 |
|---|---|---|
| `frontend/src/App.tsx` | 真实应用入口 | 当前 `workbench` mode 只渲染 `WorkspaceChat` |
| `WorkspaceChat.tsx` | 真实工作台主组件 | 当前首屏真实入口；已有消息、卡片、候选、档案、阅读切换、provider health、`available_actions` / `author_action` / `task_state`、adoption、trace/why、reading projection 的最小闭环或跨 AU Tauri 证据；`au10-workbench-matrix-layout` 已补 1280×800 baseline matrix；`au10-workbench-recovery-taskstate` 已补真实导出动作的 task_state 可见生命周期；`au10-workbench-recovery-disconnect-timeout` CP1 已补 provider 失败后 loading 清除、no-write 文案和恢复后继续下一轮；`au10-workbench-recovery-reconnect` CP2 已补服务断开/重启后的离线禁用输入、自动 rejoin 与下一轮继续；`au10-workbench-recovery-cancel-waiting` CP3A 已补高风险 confirmation 取消等待后 no-write、按钮清除和下一轮继续；仍缺完整异步 LongRunner streaming 和更深 UI 状态矩阵 |
| `UICards.tsx` | 结构化卡片渲染 | 10 类卡片组件存在；**superseded（2026-05-26）**：card 不再承载业务动作，真实提交动作必须来自 `available_actions` |
| `socket.ts` | 真实 `WorkspaceChat` 使用的 Channel helper | `sendMessage` 默认 `generate_micro_plan: false`；`sendAuthorAction` 与 `onTaskState` 已被真实入口消费；adoption 当前通过服务器 `available_actions` 与 `author_action` 主路进入，旧 direct helper 仅作为兼容边界审计对象 |
| `历史旁路工作台` / `历史旁路 socket helper` | 历史旁路 UI/helper | 已退役删除；后续不得再把它们作为当前 AU-10 局部证据 |
| `WorkspaceChannel` | 后端真实 Channel | 实现 `user_message`、`author_action`、`ping`、adoption accept/discard/edit_then_accept 路由、confirmation 针对 pending artifact 的采纳路由、工具 confirmation 取消等待路由，以及档案/结构相关 handlers；旧 direct `adopt`/`discard` 兼容路径仍需治理，完整 action_result/长跑状态 UI 仍需验收 |
| `workspace_channel_v3_test.exs` / `workspace_channel_task_state_test.exs` | Channel action 安全与 task_state 局部证据 | 覆盖 invented action 被拒绝、confirmation 后 task_state 广播，以及 `export_work` 成功/失败 task_state 生命周期；Channel 测试不能替代前端真实入口验收 |
| `frontend/src/lib/__tests__/*` | 前端 helper/type 局部测试 | 覆盖 candidate/task_state/socket helper 形状；没有浏览器 UI 行为 |
| `frontend/package.json` | 前端脚本 | 有 `playwright` 依赖；slice/Tauri 验证脚本已覆盖 AU-01/AU-02/AU-04/AU-05/AU-07/AU-08/AU-09/AU-10/VS-10 的多条真实入口证据，`au10-workbench-matrix-layout` 已提供 AU-10 baseline matrix，`au10-workbench-recovery-taskstate` 已提供真实导出 task_state checkpoint，`au10-workbench-recovery-disconnect-timeout` 已提供 provider failure recovery CP1，`au10-workbench-recovery-reconnect` 已提供 WebSocket service reconnect CP2，`au10-workbench-recovery-cancel-waiting` 已提供取消等待 CP3A；仍不是完整异步 LongRunner 的 AU-10 套件 |
| `docs/design/tech-stack/05-desktop.md` | Tauri 桌面约束 | provider health 已通过 `providerHealth.ts`/`env.ts` 端点抽象；当前主要偏差是截图暴露的桌面布局、组件追溯/文案集中和少量隐藏 `data-*` metadata 卫生 |

---

## 4. 验收场景

### 场景组 A：真实入口与系统状态

#### SC-AU10-A1 — Tauri 打开真实工作台首屏

**作为作者**，我启动桌面应用后进入真实工作台，而不是旁路 demo 组件。

**期望结果**：
- `App.tsx` 首屏与验收文档描述一致；
- 当前 Work 真实加载或降级为空态；
- 不依赖浏览器 dev server 人工 mock；
- 有 Playwright/Tauri walkthrough 证据。

**当前证据**：`App.tsx` 渲染 `WorkspaceChat`；`WorkspaceChat` 已被 `stage-startup-context-contract`、`workspace-runtime-state`、AU-01/AU-10 等外部 Tauri driver 多次作为真实入口驱动；历史 `历史旁路工作台` 旁路已退役删除。`au10-workbench-matrix-layout` 已在 1280×800 真实工作台断言顶部栏、主工作区、输入区、结构栏和无横向溢出。

**当前状态**：baseline checkpoint 已闭环 / 完整错误恢复矩阵未闭环。

---

#### SC-AU10-A2 — LLM health 和模型名真实显示

**作为作者**，我看到 LLM 检测中、已连接/未连接和模型名，且状态定期刷新。

**期望结果**：
- health 通过项目 endpoint 抽象调用；
- 显示 model / error reason；
- 30s 刷新；
- Tauri 环境不假设浏览器同源路径。

**当前证据**：`WorkspaceChat` 通过 `frontend/src/lib/providerHealth.ts` 调用 `apiBaseUrl("/api/provider/health")`；`su01-provider-health-model-tauri` 已证明真实 Tauri 工作台能显示后端 provider metadata。

**当前状态**：最小闭环 / 已并入 AU-10 baseline matrix，运行时切换和异常矩阵另见 SU-01。

---

#### SC-AU10-A3 — WebSocket 离线时输入和按钮不可用

**作为作者**，服务离线时我不能继续发送消息，状态栏明确显示离线。

**期望结果**：
- WebSocket join 成功/失败驱动状态；
- 输入框和发送按钮禁用；
- 重连中/失败/恢复状态可见；
- 不需要刷新页面才能恢复。

**当前证据**：`WorkspaceChat` 输入框和发送按钮按 `socketConnected` disabled；socket/channel close/error 会标记同步离线并清除 loading；`workspace-runtime-state-tauri` 覆盖了 resume connection/status normalization 的一段真实入口证据；`au10-workbench-recovery-reconnect-tauri` 已证明外部停止 Phoenix 服务后真实工作台显示“同步离线”、输入禁用、loading 清除，服务重启后 `channel.join.done` rejoin、输入恢复并完成下一轮。

**当前状态**：WebSocket service reconnect CP2 与 cancel waiting CP3A 已闭环 / 真实 timeout 和完整 LongRunner 恢复未闭环。

---

### 场景组 B：消息与 loading

#### SC-AU10-B1 — 发送消息后完整 loading 生命周期

**作为作者**，我发送消息后立即看到自己的消息和“思考中...”，回复到达后 loading 消失。

**期望结果**：
- 用户消息乐观显示；
- loading 与请求生命周期绑定；
- 失败时显示可恢复错误；
- 超时不会无限 loading；
- 可通过真实工作台自动化或 walkthrough 证明。

**当前证据**：`WorkspaceChat.handleSend` 有乐观消息、loading、catch 错误；`au01-ordinary-chat-two-turn-roundtrip-tauri` 与 `au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio` 已从原生 Tauri 输入框/发送按钮完成两轮真实入口普通聊天；`au10-workbench-recovery-disconnect-timeout` CP1 已证明不可达 provider 后显示可恢复错误、清除 loading、恢复 provider 后下一轮可继续；`au10-workbench-recovery-cancel-waiting` CP3A 已证明高风险工具 confirmation 点击“拒绝”后返回 cancelled action_result / TurnResult、关闭 active behavior、不调用工具、不写作品事实，并完成下一轮。仍缺真实 timeout 和完整异步 LongRunner 恢复体验。

**当前状态**：普通聊天最小闭环；provider failure recovery CP1 与 cancel waiting CP3A 已闭环 / 真实 timeout 与 LongRunner 恢复未闭环。

---

#### SC-AU10-B2 — 普通聊天不误触发执行态

**作为作者**，普通创作聊天不应因为前端默认参数而强制进入 MicroPlan/工具执行路径。

**期望结果**：
- 普通输入默认 `generate_micro_plan = false`；
- 明确工具/执行意图才打开执行计划；
- 不出现服务器未要求的 action/card；
- 与 AU-01 普通聊天闭环一致。

**当前证据**：真实 `WorkspaceChat` 使用的 `sendMessage` helper 默认 `generate_micro_plan: false`；`au10-ordinary-chat-no-micro-plan-tauri` 与 `au10-ordinary-chat-no-micro-plan-tauri-lmstudio` 已从原生 Tauri 普通输入证明不会误入 MicroPlan；`au10-micro-plan-entry-tauri` 证明明确入口可触发 MicroPlan。

**当前状态**：最小闭环。

---

### 场景组 C：候选、卡片和 action 安全

#### SC-AU10-C1 — 候选方向卡片来自 TurnResult

**作为作者**，探索阶段看到候选方向卡片，内容来自 `turn_result.candidate_directions`。

**期望结果**：
- 卡片显示 title / pitch / tone_tags；
- 空候选不渲染假面板；
- 候选与 adoption 状态保持分离；
- 真实工作台 walkthrough 证明可见。

**当前证据**：`WorkspaceChat` 能渲染 candidates；`au02-candidate-continuation-tauri`、`au02-candidate-adoption-bridge-tauri` 已从真实工作台候选卡进入继续探索/授权 action 链路；类型测试仍只作为局部证据。

**当前状态**：最小闭环 / 候选长链路质量仍需补矩阵。

---

#### SC-AU10-C2 — 点击候选继续探索

**作为作者**，我点击某个候选方向后，系统继续围绕该方向探索，但不自动采纳。

**期望结果**：
- 候选卡可点击或有明确 action；
- 提交 `candidate_ref` / `candidate_set_ref` 或等价 author action；
- selection 产生 trace；
- 不进入作品事实。

**当前证据**：`WorkspaceChat` 候选卡通过服务器 `available_actions` 匹配候选 continuation action，`au02-candidate-continuation-tauri` 已证明点击候选继续讨论不会直接采纳，且继续围绕候选方向对话。

**当前状态**：最小闭环。

---

#### SC-AU10-C3 — ActionPanel 只显示服务器授权 action

**作为作者**，我只能看到并点击服务器 `available_actions` 返回的按钮。

**期望结果**：
- 真实首屏渲染 `available_actions`；
- disabled action 不可点击，显示 disabled_reason；
- 点击后走 `author_action`；
- 前端不会构造不在 `available_actions` 中的 enabled action。

**当前证据**：`WorkspaceChat` 已渲染 `available_actions`，disabled action 不可点击，点击后通过 `sendAuthorAction` 回传；`workbenchActions` 测试覆盖 action_id/action_type/target_ref 匹配。`au02-candidate-adoption-bridge-tauri`、`au05-adoption-boundary-tauri`、`au05-discard-boundary-tauri`、`au05-modify-draft-boundary-tauri` 均已从真实入口验证 action 授权路径。

**当前状态**：最小闭环 / 完整 action matrix 待验收。

---

#### SC-AU10-C4 — 确认/拒绝动作走真实 `author_action`

**作为作者**，确认或拒绝 AI 的计划时，前端必须调用后端真实 `author_action` handler。

**期望结果**：
- confirmation card / action button 传 `source_turn_ref`、`action_id`、`idempotency_key`；
- 后端根据 server-held TurnResult 校验；
- invented/stale action 被拒绝；
- UI 显示 action_result 和后续 turn/task_state。

**当前证据**：后端 `workspace_channel_v3_test.exs` 有 invented action 拒绝测试；`WorkspaceChat` 只匹配服务器 `available_actions` 后提交 `author_action`。`au04-confirm-before-execute-tauri`、AU-05 三条 adoption boundary Tauri 证据已覆盖真实点击到后端 action 路由；仍缺 action_result 全状态可见反馈和 stale/idempotency UI 验收。

**当前状态**：最小闭环 / 完整反馈矩阵待验收。

---

#### SC-AU10-C5 — 10 种 UI card 渲染不崩溃且行为正确

**作为作者**，不同 card_type 都能正确显示，未知类型降级为默认卡片。

**期望结果**：
- 10 种 card type 按 ADR/contract 渲染；
- action label、enabled、target_ref 保持服务器语义；
- action 执行统一受 `available_actions` 限制；
- 有组件或浏览器自动化覆盖。

**当前证据**：`UICards.tsx` 组件存在；当前运行时业务动作不再由 card 自行构造提交，统一受 `available_actions` 限制。`cards.test.ts` 只覆盖 clarification/answer 的类型形状，未覆盖全部 card 视觉/降级状态。

**当前状态**：部分实现。

---

### 场景组 D：采纳、长任务和 task_state

#### SC-AU10-D1 — 草稿采纳/修改/放弃走真实 adoption 主流程

**作为作者**，我对 adoption card 点击采纳、修改后采用或放弃，动作应进入后端 adoption boundary。

**期望结果**：
- 前端动作与 Channel handler 匹配；
- 修改弹窗提交后有响应和失败态；
- 不直接把 pending artifact 当成已采纳；
- 采纳后产生 projection hint / StateTrace。

**当前证据**：`WorkspaceChat` 有修改弹窗，并通过服务器 `available_actions`/`author_action` 进入 adoption workflow；`WorkspaceChannel` 已路由 accept/discard/edit_then_accept 与 pending artifact confirmation。`au05-adoption-boundary-tauri`、`au05-discard-boundary-tauri`、`au05-modify-draft-boundary-tauri` 和 `au08-adoption-reading-projection-tauri` 证明真实工作台可采纳、放弃、修改后采用并进入阅读投影；旧 direct helper/handler 仍需作为兼容债务清理。

**当前状态**：最小闭环 / StateTrace、revision、workbox 完整语义待验收。

---

#### SC-AU10-D2 — 真实首屏消费 task_state

**作为作者**，长任务运行时，顶部状态或任务条从 RUNNING 到 COMPLETED/FAILED 实时变化。

**期望结果**：
- `WorkspaceChannel` 广播 task_state；
- 真实 `WorkspaceChat` 订阅并更新状态；
- RUNNING / CHECKPOINT / COMPLETED / FAILED 都有可见状态；
- 真长任务与同步工具最小事件都可显示。

**当前证据**：后端 confirmation 测试覆盖 task_state 广播；`WorkspaceChat` 已订阅 `task_state` 并把 RUNNING / CHECKPOINT / COMPLETED / FAILED 映射到 `longRun` store。`au10-workbench-recovery-taskstate` 已通过真实“导出全书”动作证明 RUNNING / CHECKPOINT / COMPLETED websocket frame 到达 UI 且返回工作台后“任务完成”可见；`workspace_channel_task_state_test.exs` 覆盖导出失败时 FAILED 广播。`workspace-runtime-state-tauri` 仍是运行态归一化的一段真实入口证据。

**当前状态**：task_state checkpoint、service reconnect CP2 与 cancel waiting CP3A 已闭环 / 完整异步 LongRunner streaming 与真实 timeout 恢复未闭环。

---

#### SC-AU10-D3 — 长时间 loading 超时与取消等待

**作为作者**，LLM 超时或后端卡住时，我能看到超时提示并继续操作。

**期望结果**：
- LLM turn timeout 显示明确错误；
- loading 结束；
- 可重试或取消等待；
- 不留下假 AI 消息。

**当前证据**：`socket.ts` 对 user_message / author_action 使用 `LLM_TURN_TIMEOUT_MS=300000`，与 provider 默认长等待窗口对齐；`handleSend` catch 显示“发送失败，请重试。”；`au10-workbench-recovery-disconnect-timeout` CP1 已证明不可达 provider 失败后不无限 loading，且恢复 provider 后可继续；`au10-workbench-recovery-reconnect` CP2 已证明服务断开/重启后的离线与重连恢复；`au10-workbench-recovery-cancel-waiting` CP3A 已证明确认等待可由真实页面点击拒绝关闭，且不留下 loading、工具调用或 production write。仍无真实 timeout 或完整异步 LongRunner UI 自动化。

**当前状态**：provider failure recovery CP1、service reconnect CP2 与 cancel waiting CP3A 已闭环 / 真实 timeout 和完整 LongRunner 恢复未闭环。

---

### 场景组 E：trace、projection 与阅读模式

#### SC-AU10-E1 — projection hint 只触发阅读投影刷新

**作为作者**，采纳或刷新投影后，工作台显示投影状态；切到阅读模式后看到真实 TOC/正文或明确 stale/rebuild 状态。

**期望结果**：
- `projection_refs.refresh_status` 更新 store；
- 阅读模式只请求刷新/重试，不直接写作品事实；
- TOC/正文来自真实后端；
- 跨 Work 隔离。

**当前证据**：`WorkspaceChat.handleTurnResult` 会把 `projection_refs[0].refresh_status` 写入 store；`au08-adoption-reading-projection-tauri` 已证明采纳后的 artifact 可在阅读模式投影中可见。完整投影 job、stale/rebuild、跨 Work 隔离和只读约束仍需 AU-08 后续矩阵覆盖。

**当前状态**：最小闭环 / 完整投影矩阵待验收。

---

#### SC-AU10-E2 — 作者可见 trace / why 入口

**作为作者**，我可以查看 AI 本轮为什么这样回答、用了哪些上下文、是否调用工具。

**期望结果**：
- 工作台有 why/trace 入口；
- 作者视图中文且脱敏；
- 开发者视图可定位 trace id / turn id；
- 与 replay/trace repository 相连。

**当前证据**：`WorkspaceChat` 已有 why/trace 入口，`au07-trace-why-entry-tauri` 证明作者能从真实工作台消息打开 why dialog；`au09-memory-create-recall-tauri` 进一步证明记忆召回可在 why 中展示。历史 replay/developer view 与持久化 trace 查询仍未完整闭环。

**当前状态**：最小闭环 / 深度 trace/replay 待验收。

---

### 场景组 F：桌面 UI 约束与自动化验收

#### SC-AU10-F1 — 真实工作台 Playwright/Tauri 验收

**作为作者/维护者**，我能用自动化或标准 walkthrough 证明工作台核心 UI 场景可用。

**期望结果**：
- 有 Playwright 或等价 Tauri UI spec；
- 覆盖启动、发送、loading、candidate、card action、task_state、断线错误；
- 失败截图/日志可追溯；
- 不只依赖 helper unit test。

**当前证据**：`scripts/slice_verify.sh` / `scripts/tauri_slice_verify.sh` 已有多条真实入口证据：provider health、AU-01 普通聊天、AU-02 候选继续/授权、AU-04 confirmation、AU-05 adoption、AU-07 why、AU-08 reading projection、AU-09 archive/memory、AU-10 MicroPlan/no-MicroPlan、VS-10 observability。所有驱动均为外部 driver，不依赖产品识别 slice id。`au10-workbench-matrix-layout` 已形成 AU-10 baseline matrix，覆盖 1280×800 viewport/layout、普通聊天、why、候选授权 action、adoption、reading projection 和 task status 首屏基线；`au10-workbench-recovery-taskstate` 已形成真实导出动作的 task_state checkpoint；`au10-workbench-recovery-disconnect-timeout` CP1 已形成 provider failure recovery checkpoint；`au10-workbench-recovery-reconnect` CP2 已形成 WebSocket service reconnect checkpoint；`au10-workbench-recovery-cancel-waiting` CP3A 已形成取消等待恢复 checkpoint；当前仍缺真实 timeout 和完整异步 LongRunner 恢复态覆盖。

**当前状态**：baseline matrix、task_state、provider failure CP1、service reconnect CP2、cancel waiting CP3A 已闭环 / timeout、LongRunner 恢复态矩阵未闭环。

---

#### SC-AU10-F2 — Tauri 与 Design-Driven 约束

**作为维护者**，工作台实现符合桌面优先和设计驱动约束。

**期望结果**：
- URL/endpoint 使用 `env.ts` 抽象；
- 无内联样式；
- 用户可见文案集中在 `copy.ts`；
- 组件可追溯到设计文档/原型；
- 桌面窗口和 CSP 与 tech-stack 文档一致。

**当前证据**：`WorkspaceChat` 有设计注释；provider health 端点已走 `providerHealth.ts` / `env.ts`，本轮未发现生产组件仍有 `style={{...}}`。剩余问题是截图中顶部状态区压缩成竖排、右侧栏挤压主阅读流，部分用户可见文案仍在组件内硬编码，且 `StructurePanel`/`WorkspaceChat` 仍有少量隐藏 `data-*` metadata 需要按场景化验收红线复核真实产品用途。

**当前状态**：部分实现 / 修设计偏差与验收卫生。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 证据等级 |
|---|---|---|---|
| SC-AU10-A1 | 打开真实工作台首屏 | baseline checkpoint 已闭环 | `App.tsx -> WorkspaceChat`；`au10-workbench-matrix-layout-tauri` 覆盖 1280×800 首屏/layout；完整恢复态仍缺 |
| SC-AU10-A2 | LLM health/model 状态 | 最小闭环 / 已并入 baseline | `su01-provider-health-model-tauri`；`providerHealth.ts` 走 `env.ts`；`au10-workbench-matrix-layout-tauri` 复核 provider 状态可见 |
| SC-AU10-A3 | WebSocket 离线禁用输入 | WebSocket service reconnect CP2 已闭环 | `au10-workbench-recovery-reconnect-tauri` 证明服务断开后同步离线、输入禁用、loading 清除，服务恢复后自动 rejoin 并完成下一轮 |
| SC-AU10-B1 | 发送消息 + loading | 最小闭环 / provider failure CP1 与 cancel waiting CP3A 已闭环 | AU-01 deterministic 与 LMStudio Tauri 两轮普通聊天；`au10-workbench-matrix-layout-tauri` 覆盖普通消息完成；`au10-workbench-recovery-disconnect-timeout-tauri` 覆盖不可达 provider 后 no-write fallback、loading 清除、恢复后下一轮完成；`au10-workbench-recovery-cancel-waiting-tauri` 覆盖确认等待取消后 loading 清除与下一轮完成；缺真实 timeout / LongRunner 恢复态 |
| SC-AU10-B2 | 普通聊天不误触发执行 | 最小闭环 / 已并入 baseline | `au10-ordinary-chat-no-micro-plan-*` 与 `au10-micro-plan-entry-*` 区分普通聊天和明确执行入口；baseline driver 断言 ordinary turn 不进入 planner micro-plan |
| SC-AU10-C1 | 候选卡显示 | 最小闭环 | AU-02 Tauri 真实入口候选继续/授权证据 |
| SC-AU10-C2 | 候选点选继续探索 | 最小闭环 | `au02-candidate-continuation-tauri` 证明继续探索不等于采纳 |
| SC-AU10-C3 | ActionPanel 只显示授权 action | baseline checkpoint 已闭环 / 完整矩阵待补 | AU-02/AU-05 真实入口 action 证据；baseline driver 覆盖 `choose_candidate` 授权 action；仍缺 stale/disabled/idempotency UI 覆盖 |
| SC-AU10-C4 | 确认/拒绝走 `author_action` | 高风险工具取消 CP3A checkpoint closed / 完整反馈待补 | AU-04/AU-05 真实点击到后端 action route；`au10-workbench-recovery-cancel-waiting-tauri` 覆盖 `reject_or_cancel_confirmation` 返回 cancelled action_result / TurnResult；缺 action_result 全状态矩阵 |
| SC-AU10-C5 | 10 种 card 渲染和行为 | 部分实现 | card 不再自行构造业务 action；全 card 视觉/未知类型降级测试不足 |
| SC-AU10-D1 | 采纳/修改/放弃主流程 | baseline checkpoint 已闭环 / 深语义待补 | AU-05 accept/discard/edit_then_accept、AU-08 adoption-reading projection；baseline driver 覆盖正文草稿 accept -> Reading Projection |
| SC-AU10-D2 | task_state 实时显示 | checkpoint closed / 完整异步长任务待补 | `au10-workbench-recovery-taskstate-tauri` 覆盖真实导出动作 RUNNING/CHECKPOINT/COMPLETED UI；`workspace_channel_task_state_test.exs` 覆盖 FAILED；缺完整异步 LongRunner 和 timeout |
| SC-AU10-D3 | 超时/取消等待 | provider failure CP1 + reconnect CP2 + cancel waiting CP3A 已闭环 / timeout 与 LongRunner 待补 | timeout/catch 有；`au10-workbench-recovery-disconnect-timeout-tauri` 覆盖 provider failure recovery；`au10-workbench-recovery-reconnect-tauri` 覆盖 service reconnect recovery；`au10-workbench-recovery-cancel-waiting-tauri` 覆盖取消等待 no-write 关闭；缺真实 timeout 和完整 LongRunner Tauri 证据 |
| SC-AU10-E1 | projection hint/阅读模式 | 最小闭环 / 完整 AU-08 待补 | `au08-adoption-reading-projection-tauri` |
| SC-AU10-E2 | trace/why 入口 | 最小闭环 / 深度 replay 待补 | `au07-trace-why-entry-tauri`，`au09-memory-create-recall-tauri` |
| SC-AU10-F1 | Playwright/Tauri UI 验收 | baseline + task_state + provider failure CP1 + reconnect CP2 + cancel waiting CP3A 已闭环 / 恢复态 CP3B 待补 | AU-01/AU-02/AU-04/AU-05/AU-07/AU-08/AU-09/AU-10/VS-10；`au10-workbench-matrix-layout-tauri` 是首条 AU-10 baseline matrix；`au10-workbench-recovery-taskstate-tauri` 覆盖真实导出 task_state checkpoint；`au10-workbench-recovery-disconnect-timeout-tauri` 覆盖 provider failure recovery；`au10-workbench-recovery-reconnect-tauri` 覆盖 service reconnect；`au10-workbench-recovery-cancel-waiting-tauri` 覆盖取消等待；缺真实 timeout 和完整 LongRunner 恢复矩阵 |
| SC-AU10-F2 | Tauri/Design 约束 | baseline layout checkpoint 已闭环 / 卫生项待补 | endpoint/inline-style/历史旁路工作台 旁路旧问题已不成立；规划语义、草稿命名、按钮语义和顶部栏拥挤首轮修复后已由 1280×800 baseline driver 复核；剩余隐藏 metadata、文案集中和更深 viewport 状态 |

**覆盖率重算（2026-06-17）**：AU-10 已有 baseline matrix checkpoint、task_state checkpoint、provider failure recovery CP1、WebSocket service reconnect CP2 和 cancel waiting CP3A，但仍不是完整 AU-10 闭环。当前可说清的是：真实入口、1280×800 首屏/layout、普通消息 no-MicroPlan、why、候选授权 action、正文草稿采纳、Reading Projection 和 task status 首屏基线已被 `au10-workbench-matrix-layout` 串起来；真实“导出全书”动作的 RUNNING / CHECKPOINT / COMPLETED UI 可见性与失败分支 FAILED 已由 `au10-workbench-recovery-taskstate` + Channel 回归覆盖；不可达 provider 后 no-write fallback、loading 清除与恢复 provider 后继续下一轮已由 `au10-workbench-recovery-disconnect-timeout` CP1 覆盖；服务断开/重启后的同步离线、输入禁用、自动 rejoin 和下一轮继续已由 `au10-workbench-recovery-reconnect` CP2 覆盖；高风险工具 confirmation 点击“拒绝”后的 cancelled action_result / TurnResult、no-write、active behavior 关闭、按钮清除和下一轮继续已由 `au10-workbench-recovery-cancel-waiting` CP3A 覆盖。仍不能说完整覆盖真实 timeout、完整异步 LongRunner streaming、disabled/stale/idempotency action UI、全 card 视觉和隐藏 metadata 卫生。后续队首应从同一 slice 的 CP3B 补恢复态矩阵。

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU10-GAP-01 — 真实入口与 v3 消费者分裂 | **已收口（2026-06-12）**：`WorkspaceChat` 是唯一生产工作台入口；`历史旁路工作台` / `历史旁路 socket helper` 旁路已删除。剩余为 AU-10 matrix 和布局验收 | 补验收/修设计偏差 | P0 |
| AU10-GAP-02 — 普通聊天默认触发 MicroPlan 风险 | 已由 `au10-ordinary-chat-no-micro-plan-*` 证明当前风险关闭；剩余是把该证据纳入 AU-10 完整矩阵 | 补验收 | P1 |
| AU10-GAP-03 — 真实入口 action 不走 `author_action` | 当前真实入口已走 `available_actions`/`author_action`；剩余 action_result、stale/idempotency、disabled_reason 的 UI 反馈矩阵 | 补验收 | P0 |
| AU10-GAP-04 — card action 可绕过 `available_actions` | **resolved for current runtime（2026-05-26）**：card 不再构造业务 action；剩余为全 card 视觉和未知类型降级测试 | 补验收 | P1 |
| AU10-GAP-05 — 候选方向完整体验未入矩阵 | 已由 AU-02 证明候选可继续探索；剩余是多候选、多轮、失败态和 trace 质量 | 补验收 | P1 |
| AU10-GAP-06 — adoption UI 与后端不匹配 | accept/discard/edit_then_accept 已有真实入口证据；旧 direct helper/handler 兼容路径和 StateTrace/revision/workbox 完整语义仍需治理 | 补集成/补验收 | P0 |
| AU10-GAP-07 — 真实入口 task_state 只到 store | **checkpoint closed（2026-06-17）**：真实“导出全书”动作已通过外部 Tauri driver 证明 RUNNING/CHECKPOINT/COMPLETED UI 可见，FAILED 由 Channel 回归覆盖；取消等待 CP3A 已另由 `au10-workbench-recovery-cancel-waiting` 覆盖；剩余是完整异步 LongRunner streaming 和真实 timeout 恢复 | 补验收/补集成 | P0 |
| AU10-GAP-08 — trace/why 深链路不足 | why dialog 已有真实入口；缺历史 turn replay、developer trace id、持久化查询和脱敏边界矩阵 | 补实现/补验收 | P1 |
| AU10-GAP-09 — projection 到阅读完整矩阵不足 | adoption-reading 最小闭环已有；缺 projection job、stale/rebuild、跨 Work 隔离、只读保护 | 补集成/补验收 | P1 |
| AU10-GAP-10 — 错误恢复 UX 不完整 | provider failure recovery CP1、service reconnect CP2 与 cancel waiting CP3A 已闭环；真实 timeout 和完整 LongRunner 恢复仍缺 UI 验收 | 补实现/补验收 | P1 |
| AU10-GAP-11 — AU-10 专属 UI 自动化不足 | baseline driver 已补：`au10-workbench-matrix-layout` 覆盖 1280×800 layout、普通聊天、why、候选 action、adoption、projection 和 task status 基线；task_state driver 已补：`au10-workbench-recovery-taskstate` 覆盖真实导出 task_state checkpoint；provider failure driver 已补：`au10-workbench-recovery-disconnect-timeout` 覆盖不可达 provider 后恢复；reconnect driver 已补：`au10-workbench-recovery-reconnect` 覆盖服务断开/重启后的离线和重连；cancel waiting driver 已补：`au10-workbench-recovery-cancel-waiting` 覆盖确认等待取消 no-write 和后续继续；剩余是真实 timeout、完整 LongRunner 和全 action/card 矩阵 | 补验收 | P0 |
| AU10-GAP-12 — 桌面/设计约束偏差 | 首轮已修：顶部状态区短文案/tooltip、草稿命名、动作落点说明、规划请求归一；1280×800 screenshot/layout baseline 已由 AU-10 专属 driver 复核；剩余：隐藏 `data-*` metadata、文案集中、全 card/右侧栏更多状态 | 修设计偏差/验收卫生 | P1 |

---

## 7. 已知限制 / 现有基础设施

| 基础设施 | 可复用点 | 不能算已完成 AU-10 的原因 |
|---|---|---|
| `WorkspaceChat` | 当前真实首屏，已承载 provider health、消息、候选、action、adoption、why、reading、archive/memory 的最小证据；baseline layout/state、真实导出 task_state checkpoint、provider failure recovery CP1、service reconnect CP2 和 cancel waiting CP3A 已被 AU-10 专属 driver 覆盖 | 仍是大型组件，真实 timeout、完整异步 LongRunner 和全 action/card 状态矩阵未覆盖 |
| `历史旁路工作台` / `历史旁路 socket helper` | 历史 v3 旁路 UI/helper | 已退役删除，不再作为当前验收基础设施 |
| `UICards` | 卡片组件齐全，业务 action 不再从 card 自行提交 | 缺全 card 视觉/降级验收 |
| `workspace_channel_v3_test.exs` / `workspace_channel_task_state_test.exs` | 后端 action 安全和 task_state 广播局部证据 | 覆盖后端 FAILED 分支，但不证明真实 UI 断线/超时恢复 |
| `turn_result_candidates.test.ts` / `task_state.test.ts` | 类型形状保护 | 不是用户视角验收 |
| `scripts/slice_verify.sh` | 浏览器外部 driver，可跑 `au10-micro-plan-entry` | 只证明局部入口 |
| `scripts/tauri_slice_verify.sh` | 原生 Tauri 外部 driver，已覆盖多条跨 AU 真实入口证据，并已新增 `au10-workbench-matrix-layout` baseline matrix、`au10-workbench-recovery-taskstate` task_state checkpoint、`au10-workbench-recovery-disconnect-timeout` provider failure CP1、`au10-workbench-recovery-reconnect` service reconnect CP2 与 `au10-workbench-recovery-cancel-waiting` cancel waiting CP3A | baseline/task_state/provider failure/reconnect/cancel waiting checkpoint 不等于完整 AU-10：真实 timeout、完整 LongRunner、全 card/action 仍缺 |
| `artifacts/slice-verify/*/summary.json` | 可复核历史验收摘要与 deterministic/LMStudio 证据 | 不能把 deterministic fixture 说成真实 provider；LMStudio 证据也需逐条标明 |

---

## 8. 验收命令

```bash
# 查看当前可复跑外部驱动
bash scripts/slice_verify.sh --list
bash scripts/tauri_slice_verify.sh --list

# AU-10 及其跨 AU checkpoint 证据
bash scripts/tauri_slice_verify.sh su01-provider-health-model
bash scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip
bash scripts/tauri_slice_verify.sh au02-candidate-continuation
bash scripts/tauri_slice_verify.sh au02-candidate-adoption-bridge
bash scripts/tauri_slice_verify.sh au04-confirm-before-execute
bash scripts/tauri_slice_verify.sh au05-adoption-boundary
bash scripts/tauri_slice_verify.sh au05-discard-boundary
bash scripts/tauri_slice_verify.sh au05-modify-draft-boundary
bash scripts/tauri_slice_verify.sh au07-trace-why-entry
bash scripts/tauri_slice_verify.sh au08-adoption-reading-projection
bash scripts/tauri_slice_verify.sh au09-archive-real-data
bash scripts/tauri_slice_verify.sh au09-memory-create-recall
bash scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan
bash scripts/tauri_slice_verify.sh au10-micro-plan-entry
bash scripts/tauri_slice_verify.sh au10-workbench-matrix-layout
bash scripts/tauri_slice_verify.sh au10-workbench-recovery-taskstate
bash scripts/tauri_slice_verify.sh au10-workbench-recovery-disconnect-timeout
bash scripts/tauri_slice_verify.sh au10-workbench-recovery-reconnect
bash scripts/tauri_slice_verify.sh au10-workbench-recovery-cancel-waiting
bash scripts/tauri_slice_verify.sh workspace-runtime-state
bash scripts/tauri_slice_verify.sh vs10-observability-spine

# 当前仍是局部工程证据，不替代完整 AU-10 matrix
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_task_state_test.exs
mix test apps/novel_application/test/novel_application/behavior_lifecycle_test.exs
cd frontend && pnpm test
cd frontend && pnpm typecheck
```

后续真正完整闭环前还需要新增：
- AU-10 recovery CP3B Tauri spec：真实 timeout、重试，以及完整异步 LongRunner streaming；
- 更深 UI 状态矩阵：disabled/stale/idempotency action、全 card 视觉/未知类型降级、projection stale/rebuild、跨 Work 只读隔离；
- viewport/layout 扩展断言：在更多状态下顶部状态栏不能竖排压缩，右侧栏不能遮挡或挤爆主流程，底部输入区在 1280×800 和截图等价尺寸下稳定；
- 组件文案集中、隐藏 `data-*` metadata 复核和设计追溯补齐；
- 与 AU-02/AU-04/AU-05/AU-08/AU-09 的跨场景 walkthrough 继续合并为 AU-10 专属验收报告。
