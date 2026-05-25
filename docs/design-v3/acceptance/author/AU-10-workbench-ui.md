# AU-10 工作台实时交互

> 作者视角：工作台是我和 AI 协作的主界面。我需要实时知道系统状态、AI 在做什么、现在等我做什么、哪些按钮可以点。界面上的卡片、候选、action、任务状态、trace 和投影状态必须来自真实主链，不能由前端猜测或用 mock 冒充。
>
> 2026-05-14 对账结论：当前有 `WorkspaceChat` 真实入口、`WorkbenchV3` v3 消费者实验组件、`UICards`、候选/任务状态类型测试和 Channel action 安全测试。`au10-micro-plan-entry` 已证明真实前端入口可触发 MicroPlan；`au01-ordinary-chat-two-turn-roundtrip` 已证明原生 Tauri 可从输入框/发送按钮连续完成两轮普通聊天且不进入 MicroPlan；VS-10 进一步新增 `vs10-observability-spine` 浏览器验证和 `scripts/tauri_slice_verify.sh vs10-observability-spine` 原生 Tauri 自动化验证，可在不等待人工操作的情况下驱动真实工作台控件并校验日志链。采纳主流程、候选点选、trace/why、阅读投影和完整 Tauri/Design 合规仍未闭环。
>
> 2026-05-22 验收卫生更正：历史 Tauri 验收曾依赖产品前端内的 autorun / UI state 上报路径。该路径已废弃并清理；当前可重复运行的 Tauri 验证必须由外部 Playwright driver 操作真实界面，不允许在 `WorkspaceChat`、`socket.ts` 或 Channel 中恢复 slice-id 识别、自动填充、自动点击或验收状态上报。

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
| `frontend/src/App.tsx` | 真实应用入口 | 当前 `workbench` mode 渲染 `WorkspaceChat`，不渲染 `WorkbenchV3` |
| `WorkspaceChat.tsx` | 真实工作台主组件 | 有消息、卡片、候选、档案、阅读切换；已接 `available_actions` / `author_action` / `task_state` 最小闭环；已有 VS-10 原生 Tauri 自动化观测链；adoption、trace、投影和完整 UI 自动化仍未闭环 |
| `WorkbenchV3.tsx` | v3 UI consumer 实验/旁路组件 | 有 `available_actions` ActionPanel、`author_action`、task_state 订阅；但不是当前首屏入口 |
| `UICards.tsx` | 结构化卡片渲染 | 10 类卡片组件存在；**superseded（2026-05-26）**：card 不再承载业务动作，真实提交动作必须来自 `available_actions` |
| `socket.ts` | 真实 `WorkspaceChat` 使用的 Channel helper | `sendMessage` 默认 `generate_micro_plan: false`；新增 `sendAuthorAction` 与 `onTaskState`；adoption helper 仍待后端主流程对齐 |
| `socket_v3.ts` | v3 helper | 支持 `author_action` 和 `task_state`；当前只被 `WorkbenchV3` 消费 |
| `WorkspaceChannel` | 后端真实 Channel | 实现 `user_message`、`author_action`、`ping`、mock structure handlers；无 `confirm`/`adopt`/`modify_draft` handlers |
| `workspace_channel_v3_test.exs` | Channel action 安全局部证据 | 覆盖 invented action 被拒绝、confirmation 后 task_state 广播；不是前端真实入口验收 |
| `frontend/src/lib/__tests__/*` | 前端 helper/type 局部测试 | 覆盖 candidate/task_state/socket helper 形状；没有浏览器 UI 行为 |
| `frontend/package.json` | 前端脚本 | 有 `playwright` 依赖；slice 验证脚本已覆盖 `au10-micro-plan-entry` 与 `vs10-observability-spine`，但还不是完整工作台验收套件 |
| `docs/design-v2/tech-stack/05-desktop.md` | Tauri 桌面约束 | 工作台仍有直接 `fetch("/api/provider/health")` 与内联样式，不满足全部约束 |

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

**当前证据**：`App.tsx` 渲染 `WorkspaceChat`；`WorkbenchV3` 未挂真实入口。

**当前状态**：部分实现。

---

#### SC-AU10-A2 — LLM health 和模型名真实显示

**作为作者**，我看到 LLM 检测中、已连接/未连接和模型名，且状态定期刷新。

**期望结果**：
- health 通过项目 endpoint 抽象调用；
- 显示 model / error reason；
- 30s 刷新；
- Tauri 环境不假设浏览器同源路径。

**当前证据**：`WorkspaceChat` 与 `WorkbenchV3` 都轮询 provider health；但 `WorkspaceChat` 直接 `fetch("/api/provider/health")`，未走 `env.ts`。

**当前状态**：部分实现。

---

#### SC-AU10-A3 — WebSocket 离线时输入和按钮不可用

**作为作者**，服务离线时我不能继续发送消息，状态栏明确显示离线。

**期望结果**：
- WebSocket join 成功/失败驱动状态；
- 输入框和发送按钮禁用；
- 重连中/失败/恢复状态可见；
- 不需要刷新页面才能恢复。

**当前证据**：`WorkspaceChat` 输入框和发送按钮按 `socketConnected` disabled；没有发现自动重连 UI 验收。

**当前状态**：部分实现。

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

**当前证据**：`WorkspaceChat.handleSend/1` 有乐观消息、loading、catch 错误；缺真实 UI 自动化和超时/取消体验。

**当前状态**：部分实现。

---

#### SC-AU10-B2 — 普通聊天不误触发执行态

**作为作者**，普通创作聊天不应因为前端默认参数而强制进入 MicroPlan/工具执行路径。

**期望结果**：
- 普通输入默认 `generate_micro_plan = false`；
- 明确工具/执行意图才打开执行计划；
- 不出现服务器未要求的 action/card；
- 与 AU-01 普通聊天闭环一致。

**当前证据**：真实 `WorkspaceChat` 使用的 `sendMessage` helper 默认 `generate_micro_plan: false`，并有 helper 测试覆盖显式开启 MicroPlan；仍缺真实工作台 UI/Tauri 验收。

**当前状态**：部分实现 / 待验收。

---

### 场景组 C：候选、卡片和 action 安全

#### SC-AU10-C1 — 候选方向卡片来自 TurnResult

**作为作者**，探索阶段看到候选方向卡片，内容来自 `turn_result.candidate_directions`。

**期望结果**：
- 卡片显示 title / pitch / tone_tags；
- 空候选不渲染假面板；
- 候选与 adoption 状态保持分离；
- 真实工作台 walkthrough 证明可见。

**当前证据**：`WorkspaceChat` 和 `WorkbenchV3` 都能渲染 candidates；`turn_result_candidates.test.ts` 只验证类型/形状。

**当前状态**：部分实现。

---

#### SC-AU10-C2 — 点击候选继续探索

**作为作者**，我点击某个候选方向后，系统继续围绕该方向探索，但不自动采纳。

**期望结果**：
- 候选卡可点击或有明确 action；
- 提交 `candidate_ref` / `candidate_set_ref` 或等价 author action；
- selection 产生 trace；
- 不进入作品事实。

**当前证据**：`WorkspaceChat` 和 `WorkbenchV3` 候选卡当前主要展示，不可点选继续；AU-02 已记录候选操作闭环缺失。

**当前状态**：未实现。

---

#### SC-AU10-C3 — ActionPanel 只显示服务器授权 action

**作为作者**，我只能看到并点击服务器 `available_actions` 返回的按钮。

**期望结果**：
- 真实首屏渲染 `available_actions`；
- disabled action 不可点击，显示 disabled_reason；
- 点击后走 `author_action`；
- 前端不会构造不在 `available_actions` 中的 enabled action。

**当前证据**：`WorkspaceChat` 已渲染 `available_actions`，disabled action 不可点击，点击后通过 `sendAuthorAction` 回传；`workbenchActions` 测试覆盖 action_id/action_type/target_ref 匹配。**2026-05-26 更新**：`WorkbenchV3` card action bridge / generic fallback 已清理，仍缺真实浏览器/Tauri 点击验收。

**当前状态**：部分实现 / 待验收。

---

#### SC-AU10-C4 — 确认/拒绝动作走真实 `author_action`

**作为作者**，确认或拒绝 AI 的计划时，前端必须调用后端真实 `author_action` handler。

**期望结果**：
- confirmation card / action button 传 `source_turn_ref`、`action_id`、`idempotency_key`；
- 后端根据 server-held TurnResult 校验；
- invented/stale action 被拒绝；
- UI 显示 action_result 和后续 turn/task_state。

**当前证据**：后端 `workspace_channel_v3_test.exs` 有 invented action 拒绝测试；`WorkspaceChat` 已移除确认/拒绝旧 helper 路径，改为只匹配服务器 `available_actions` 后提交 `author_action`。后端已补齐 action 触发新 turn 后的 socket 记忆。仍缺真实 UI 点击验收和 action_result 可见反馈。

**当前状态**：部分实现 / 待验收。

---

#### SC-AU10-C5 — 10 种 UI card 渲染不崩溃且行为正确

**作为作者**，不同 card_type 都能正确显示，未知类型降级为默认卡片。

**期望结果**：
- 10 种 card type 按 ADR/contract 渲染；
- action label、enabled、target_ref 保持服务器语义；
- action 执行统一受 `available_actions` 限制；
- 有组件或浏览器自动化覆盖。

**当前证据**：`UICards.tsx` 组件存在；`cards.test.ts` 只覆盖 clarification/answer 的类型形状，未覆盖全部 card 或真实点击。

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

**当前证据**：`WorkspaceChat` 有修改弹窗和 `adopt` / `discard` / `modifyDraft` helper；后端 Channel 无对应 handler，AU-05 已列为 P0 缺口。

**当前状态**：未闭环。

---

#### SC-AU10-D2 — 真实首屏消费 task_state

**作为作者**，长任务运行时，顶部状态或任务条从 RUNNING 到 COMPLETED/FAILED 实时变化。

**期望结果**：
- `WorkspaceChannel` 广播 task_state；
- 真实 `WorkspaceChat` 订阅并更新状态；
- RUNNING / CHECKPOINT / COMPLETED / FAILED 都有可见状态；
- 真长任务与同步工具最小事件都可显示。

**当前证据**：后端 confirmation 测试覆盖 task_state 广播；`WorkspaceChat` 已订阅 `task_state` 并把 RUNNING / CHECKPOINT / COMPLETED / FAILED 映射到 `longRun` store。仍缺真实长任务和 UI/Tauri 可见状态验收。

**当前状态**：部分实现 / 待验收。

---

#### SC-AU10-D3 — 长时间 loading 超时与取消等待

**作为作者**，LLM 超时或后端卡住时，我能看到超时提示并继续操作。

**期望结果**：
- 60s timeout 显示明确错误；
- loading 结束；
- 可重试或取消等待；
- 不留下假 AI 消息。

**当前证据**：`socket.ts` helper 有 60s timeout，`handleSend` catch 显示“发送失败，请重试。”；无取消等待、重连恢复或 UI 自动化。

**当前状态**：部分实现。

---

### 场景组 E：trace、projection 与阅读模式

#### SC-AU10-E1 — projection hint 只触发阅读投影刷新

**作为作者**，采纳或刷新投影后，工作台显示投影状态；切到阅读模式后看到真实 TOC/正文或明确 stale/rebuild 状态。

**期望结果**：
- `projection_refs.refresh_status` 更新 store；
- 阅读模式只请求刷新/重试，不直接写作品事实；
- TOC/正文来自真实后端；
- 跨 Work 隔离。

**当前证据**：`WorkspaceChat.handleTurnResult` 会把 `projection_refs[0].refresh_status` 写入 store；AU-08 已确认 ReadingMode 的 TOC/章节仍未真实闭环。

**当前状态**：部分实现。

---

#### SC-AU10-E2 — 作者可见 trace / why 入口

**作为作者**，我可以查看 AI 本轮为什么这样回答、用了哪些上下文、是否调用工具。

**期望结果**：
- 工作台有 why/trace 入口；
- 作者视图中文且脱敏；
- 开发者视图可定位 trace id / turn id；
- 与 replay/trace repository 相连。

**当前证据**：`WorkbenchV3` 有“查看认知” frame insight，但不是当前真实入口；`WorkspaceChat` 无 why/trace 入口，AU-07 已列为缺口。

**当前状态**：未实现。

---

### 场景组 F：桌面 UI 约束与自动化验收

#### SC-AU10-F1 — 真实工作台 Playwright/Tauri 验收

**作为作者/维护者**，我能用自动化或标准 walkthrough 证明工作台核心 UI 场景可用。

**期望结果**：
- 有 Playwright 或等价 Tauri UI spec；
- 覆盖启动、发送、loading、candidate、card action、task_state、断线错误；
- 失败截图/日志可追溯；
- 不只依赖 helper unit test。

**当前证据**：`scripts/slice_verify.sh au10-micro-plan-entry` 会启动 test Phoenix + Vite，从真实 `WorkspaceChat` 打开档案面板，点击“发起新操作”，并在 `artifacts/slice-verify/au10-micro-plan-entry/frames.json` 记录 Phoenix websocket frame。Tauri 验证已迁移为外部 UI driver 模式：产品 React 代码不识别 slice id，不自动填字/点击；后续 VS-10 原生验证应由外部 driver 点击真实控件并验证同一 `turn_id` 贯穿 app JSONL 关键事件。当前仍未覆盖发送普通聊天、candidate、card action、task_state 或断线错误。

**当前状态**：部分实现 / 最小前端发起验证已建立。

---

#### SC-AU10-F2 — Tauri 与 Design-Driven 约束

**作为维护者**，工作台实现符合桌面优先和设计驱动约束。

**期望结果**：
- URL/endpoint 使用 `env.ts` 抽象；
- 无内联样式；
- 用户可见文案集中在 `copy.ts`；
- 组件可追溯到设计文档/原型；
- 桌面窗口和 CSP 与 tech-stack 文档一致。

**当前证据**：`WorkspaceChat` 有设计注释；但存在 `fetch("/api/provider/health")`、多处 `style={{...}}` 和大量组件内硬编码文案。`tauri.conf.json` 当前与备份一致，未发现本轮引入问题。

**当前状态**：部分实现 / 修设计偏差。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 证据等级 |
|---|---|---|---|
| SC-AU10-A1 | 打开真实工作台首屏 | 部分实现 | `App.tsx -> WorkspaceChat`，无 UI 验收 |
| SC-AU10-A2 | LLM health/model 状态 | 部分实现 | 代码存在，endpoint 抽象不合规 |
| SC-AU10-A3 | WebSocket 离线禁用输入 | 部分实现 | 代码存在，缺重连/验收 |
| SC-AU10-B1 | 发送消息 + loading | 部分实现 | 代码存在，缺真实 UI 验收 |
| SC-AU10-B2 | 普通聊天不误触发执行 | 部分实现 / 原生 Tauri 两轮主链验收已建立 | `sendMessage` 默认 false；`scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan` 从原生 Tauri 输入框/发送按钮触发普通消息，并断言 `channel.user_message.start.generate_micro_plan=false`；`scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 连续发起两轮普通聊天，验证两轮均完成 `channel -> application -> channel` 且不存在 `planner.form_micro_plan.*`；仍缺完整普通聊天 DOM 反馈验收 |
| SC-AU10-C1 | 候选卡显示 | 部分实现 | 组件/类型测试，缺真实 UI 验收 |
| SC-AU10-C2 | 候选点选继续探索 | 未实现 | 候选卡只展示 |
| SC-AU10-C3 | ActionPanel 只显示授权 action | 部分实现 / 待验收 | 真实入口已接 `available_actions`，缺 UI 点击验收 |
| SC-AU10-C4 | 确认/拒绝走 `author_action` | 部分实现 / 待验收 | 真实入口已走 `author_action`，缺 action_result UI 验收 |
| SC-AU10-C5 | 10 种 card 渲染和行为 | 部分实现 | 组件存在，测试不足 |
| SC-AU10-D1 | 采纳/修改/放弃主流程 | 未闭环 | 前端 helper 与后端 handler 不匹配 |
| SC-AU10-D2 | task_state 实时显示 | 部分实现 / 待验收 | 真实入口已订阅并映射 store，缺 UI/Tauri 验收 |
| SC-AU10-D3 | 超时/取消等待 | 部分实现 | timeout catch 有，取消等待缺 |
| SC-AU10-E1 | projection hint/阅读模式 | 部分实现 | store 更新有，阅读链路未闭环 |
| SC-AU10-E2 | trace/why 入口 | 未实现 | 旁路 frame insight，不在真实入口 |
| SC-AU10-F1 | Playwright/Tauri UI 验收 | 部分实现 / 最小前端与原生 Tauri 自动化证据已建立 | `scripts/slice_verify.sh au10-micro-plan-entry` 覆盖浏览器真实入口 MicroPlan 操作；`scripts/tauri_slice_verify.sh au10-micro-plan-entry` 覆盖原生 Tauri 同入口并断言 `generate_micro_plan=true`；`scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan` 覆盖原生 Tauri 普通聊天不触发 MicroPlan；`scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 覆盖原生 Tauri 两轮普通聊天主链；`scripts/tauri_slice_verify.sh vs10-observability-spine` 覆盖原生 Tauri 观测链；未覆盖完整工作台 |
| SC-AU10-F2 | Tauri/Design 约束 | 部分实现 / 修设计偏差 | 直接 fetch、内联样式、硬编码文案 |

**覆盖率重算**：0/17 完整真实前后端验收；1 条最小浏览器前端发起验证已建立；新增 4 条原生 Tauri 自动化证据（AU-01 两轮普通聊天、AU-10 普通聊天 no-MicroPlan、AU-10 MicroPlan 入口、VS-10 观测链）；13/17 有局部证据或基础设施；4/17 未实现/未闭环。

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU10-GAP-01 — 真实入口与 v3 消费者分裂 | `WorkspaceChat` 已接 `author_action`/task_state 最小闭环；`WorkbenchV3` 仍是旁路，adoption/projection/trace 能力未统一 | 补集成/修设计偏差 | P0 |
| AU10-GAP-02 — 普通聊天默认触发 MicroPlan 风险 | `sendMessage` 默认已改为 `generate_micro_plan: false`；原生 Tauri 已有 `au10-ordinary-chat-no-micro-plan` 最小验收和 `au01-ordinary-chat-two-turn-roundtrip` 两轮主链验收；仍缺完整普通聊天 DOM 反馈验收 | 补验收 | P0 |
| AU10-GAP-03 — 真实入口 action 不走 `author_action` | 确认/拒绝旧 helper 路径已移除，真实入口可提交 `author_action`；仍缺 action_result UI 反馈和 Tauri 点击验收 | 补集成/补验收 | P0 |
| AU10-GAP-04 — card action 可绕过 `available_actions` | **resolved for current runtime（2026-05-26）**：`WorkspaceChat` / `WorkbenchV3` / `UICards` 不再从 card / card_type / StructurePanel 构造可提交业务 action；剩余为真实 UI 点击验收 | 补验收 | P0 |
| AU10-GAP-05 — 候选方向只展示不可操作 | candidate cards 没有 selection/continue action | 补实现/补验收 | P0 |
| AU10-GAP-06 — adoption UI 与后端不匹配 | `adopt`/`discard`/`modify_draft` helper 无 WorkspaceChannel handler | 补集成 | P0 |
| AU10-GAP-07 — 真实入口未消费 task_state | `WorkspaceChat` 已订阅并映射 `task_state`；仍缺真实 UI 状态验收和完整异步 TaskRunner 订阅 | 补验收/补集成 | P0 |
| AU10-GAP-08 — trace/why 入口缺失 | 作者无法在真实工作台查看本轮来源/决策解释 | 补实现/补验收 | P1 |
| AU10-GAP-09 — projection 到阅读链路未闭环 | status store 更新有，TOC/章节读取仍见 AU-08 缺口 | 补集成 | P1 |
| AU10-GAP-10 — 错误恢复 UX 不完整 | 断线重连、超时取消、失败后恢复缺 UI 验收 | 补实现/补验收 | P1 |
| AU10-GAP-11 — UI 自动化覆盖不足 | 已有 `au10-micro-plan-entry` 最小浏览器与原生 Tauri 发起验证；已有 `au10-ordinary-chat-no-micro-plan` 原生 Tauri 普通聊天契约验证；已有 `au01-ordinary-chat-two-turn-roundtrip` 原生 Tauri 两轮普通聊天主链验证；VS-10 已补原生 Tauri 自动化观测链；仍缺 candidate、card action、task_state、断线错误等完整工作台覆盖 | 补验收 | P0/P1 |
| AU10-GAP-12 — 桌面/设计约束偏差 | 直接 fetch endpoint、内联样式、硬编码文案 | 修设计偏差 | P1 |

---

## 7. 已知限制 / 现有基础设施

| 基础设施 | 可复用点 | 不能算已验收的原因 |
|---|---|---|
| `WorkspaceChat` | 当前真实首屏，有消息、卡片、候选、档案入口；已接 `available_actions` / `author_action` / `task_state` 最小闭环 | adoption/trace/projection/UI 自动化多条主链未闭环 |
| `WorkbenchV3` | 已按 v3 helper 消费 `author_action`、`available_actions`、`task_state`；**superseded（2026-05-26）**：renderCard fallback / card action bridge 已清理 | 未挂真实入口，缺真实点击验收 |
| `UICards` | 卡片组件齐全；**superseded（2026-05-26）**：card 不提交业务 action | 缺真实点击验收 |
| `workspace_channel_v3_test.exs` | 后端 action 安全和 task_state 广播局部证据 | 不证明真实前端使用这些事件 |
| `turn_result_candidates.test.ts` / `task_state.test.ts` | 类型形状保护 | 不是浏览器 UI 验收 |
| `scripts/slice_verify.sh` | 可复跑浏览器前端发起验证，当前已有 `au10-micro-plan-entry` | 只证明一个最小入口，不证明 AU-10 完整工作台验收 |
| `scripts/tauri_slice_verify.sh` | 可复跑原生 Tauri 前端发起验证，当前已有 `au01-ordinary-chat-two-turn-roundtrip`、`au10-ordinary-chat-no-micro-plan`、`au10-micro-plan-entry` 和 `vs10-observability-spine` | 只证明两轮普通聊天主链、普通聊天 no-MicroPlan 契约、MicroPlan 最小入口和观测链，不证明 AU-10 完整工作台验收 |
| `frontend/walkthroughs/latest/*.png` | 有历史截图 | 不是可复跑、可断言的验收 |

---

## 8. 验收命令

```bash
# 最小前端发起验证：真实 WorkspaceChat -> socket -> Channel -> Application
bash scripts/slice_verify.sh --list
bash scripts/slice_verify.sh au10-micro-plan-entry
bash scripts/tauri_slice_verify.sh --list
bash scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip
bash scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan
bash scripts/tauri_slice_verify.sh au10-micro-plan-entry
bash scripts/tauri_slice_verify.sh vs10-observability-spine

# 当前只能证明局部基础设施，不证明 AU-10 完整验收
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
mix test apps/novel_application/test/novel_application/behavior_lifecycle_test.exs
cd frontend && pnpm test
cd frontend && pnpm typecheck
```

后续真正闭环后至少需要新增：
- 真实工作台 Playwright/Tauri spec：启动、连接、发送、loading、候选、card、action、task_state、错误态；
- `WorkspaceChat` 或统一入口对 `author_action` / `available_actions` / `task_state` 的集成测试；
- ordinary chat 默认不生成 MicroPlan 的 UI/Channel 验收；
- Tauri endpoint、无内联样式、文案集中管理的前端合规检查；
- 与 AU-02/AU-04/AU-05/AU-08/AU-09 的跨场景 walkthrough。
