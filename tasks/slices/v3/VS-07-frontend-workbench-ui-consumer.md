# VS-07 Frontend Workbench UI Consumer

> 状态：docs-ready（2026-05-09）
>
> 角色：证明 Tauri 前端可以通过 v3 Phoenix Channel 发送 user_message / author_action，接收 turn_result / action_result broadcast，形成第一个端到端 UI 闭环。

---

## 1. Contract

本 slice 消费的契约（全部通过 Phoenix Channel JSON 序列化）：

| Contract | 来源 | Channel 消息 | 前端消费方式 |
|---|---|---|---|
| `TurnResult` (map) | VS-00 / VS-05 | `turn_result` broadcast | → React state（Zustand store） |
| `AvailableAction` | VS-03 §3 / VS-05 §3 | `turn_result.available_actions` | → ActionPanel 可点击按钮 |
| `AuthorActionInput` | VS-04 §3 | `author_action` push | → 用户点击 action 后构造 payload |
| `BehaviorState` (summary) | VS-03 §4 | `turn_result.behavior_state` | → clarification / confirmation UI card |
| `candidate_directions` | VS-00A | `turn_result.candidate_directions` | → candidate card list |
| `orchestrator_decision` | VS-01 §5 | `turn_result.orchestrator_decision` | → decision summary display |
| `tool_result` | VS-02 §4 | `turn_result.tool_result` | → tool execution result card |
| `tentative_artifacts` | VS-02A §2 | `turn_result.tentative_artifacts` | → creative artifact card |

## 2. Invariant

本 slice 保护的全局不变量（来自 `00c` §7）：

| # | Invariant | 本 slice 如何保护 |
|---|---|------|
| #9 | TurnResult 是 canonical UI 输出 | 前端只从 `turn_result` broadcast 读取渲染数据，不直接访问 trace/tool/internal struct |
| #10 | UI 只能提交 AvailableAction | action buttons 从 `turn_result.available_actions` 派生，action_id/action_type 不可硬编码 |
| #13 | trace summary 脱敏 | 前端只渲染 `turn_result.trace_summary`，不访问 raw prompt 或敏感字段 |
| #15 | projection hints 只触发刷新 | 前端收到 projection_hint 后刷新对应视图，不自行写入状态 |

## 3. Boundary

```text
novel_web (Phoenix Channel — Elixir)
  → broadcast "turn_result" (JSON serialized by Phoenix)
  → broadcast "action_result" (JSON)
  ← receive "user_message" push
  ← receive "author_action" push

frontend (Tauri 2 / React 19 / TypeScript 6 — Node)
  → Phoenix.Socket connection (via phoenix.js or raw WebSocket)
  → channel.join("workspace:<id>")
  → channel.on("turn_result", ...) → Zustand store → React re-render
  → channel.on("action_result", ...) → Zustand store
  → channel.push("user_message", payload) ← 用户输入
  → channel.push("author_action", payload) ← 用户点击 action
```

**不碰**：
- `novel_application` / `novel_agent` / `novel_domain` 内部模块（前端只通过 Channel JSON 交互）
- production write（前端不能直接写 DB、adopted state 或调用 Toolbox）
- Ecto / Repo（前端不直接访问 persistence）
- raw provider prompt / response（trace summary 已脱敏）

## 4. Consumer

**第一个真实消费者**：Tauri 桌面应用 Workbench 视图。

具体交互序列：
1. 前端连接 WebSocket → `socket.channel("workspace:lobby")` → `channel.join()`
2. 用户在 `<MessageInput>` 输入文本 → `channel.push("user_message", %{text: "..."})`
3. Channel 返回 `{:reply, {:ok, %{received: true}}}` → 确认消息已送达
4. Channel **broadcast** `"turn_result"` → `channel.on("turn_result", callback)` → React 渲染消息 + action panel
5. 用户点击 action 按钮 → `channel.push("author_action", %{action: {...}})`（action 数据来自 step 4 的 available_actions）
6. Channel 返回 `{:reply, {:ok, ...}}` 或 `{:reply, {:error, ...}}`——直接 reply，不是 broadcast
7. 如有后续 broadcast（如 `action_result`）→ 更新 UI

## 5. Proof

| Proof | 验证方式 | 通过标准 |
|---|---|---|
| user_message roundtrip | 输入 "你好" → 等待 `turn_result` broadcast | `turn_result.assistant_message.text` 非空 |
| generate_micro_plan roundtrip | 输入创作请求 + `generate_micro_plan: true` | `turn_result` 含 `orchestrator_decision` |
| author_action reply | 发送合法 action → 检查 reply | `{:ok, %{received: true, action_status: "accepted"}}` |
| invented action rejected | 发送不存在 action_id | `{:error, %{reason: "invented..."}}` |
| ping/pong | `channel.push("ping", %{})` | `{:reply, {:ok, %{event: "pong"}}}` |
| explore no form | 输入模糊创作意图 | `turn_result` 不含 `required_slots` / `missing_slots` / `slot_form` |
| candidate cards visible | exploration turn_result 含 `candidate_directions` | 前端渲染 CandidateCard 列表 |

这些 proof 可在 Elixir 侧用 `Phoenix.ChannelTest` 写为 Channel 集成测试，也可在前端侧用 Vitest + MSW 或 Playwright 写为 E2E 测试。VS-07 最低要求 Elixir Channel 测试通过。

## 6. 最小 UI 范围

VS-07 只覆盖最小可用的 Workbench UI：

| 组件 | 功能 | 数据来源 |
|---|---|---|
| `MessageList` | 显示 assistant_message 文本列表 | `turn_result.assistant_message.text` |
| `MessageInput` | 输入文本，发送 `user_message` | 用户输入 → `channel.push` |
| `ActionPanel` | 显示可用操作按钮（如有） | `turn_result.available_actions` |
| `CandidateCards` | 显示候选方向卡片（如有） | `turn_result.candidate_directions` |
| `StatusBar` | 显示当前 phase / status | `turn_result.phase` / `turn_result.status` |
| `ConnectionIndicator` | WebSocket 连接状态 | Phoenix Socket 事件 |

不覆盖：
- 完整编辑器（正文编辑在后续 slice）
- 角色/大纲管理面板
- 阅读模式
- 设置页面
- 多 workspace 切换

## 7. 技术约束

- **启动命令**：`pnpm tauri dev`（不是 `pnpm dev`）
- Phoenix Channel 通过 WebSocket 连接（`frontend/src/lib/channel.ts` 或 phoenix.js）
- React 19 + TypeScript 6
- 状态管理：
  - **Zustand**：管理 UI 状态（当前 turn、channel 连接状态、消息列表）
  - Channel 数据通过 `channel.on("turn_result", callback)` 直接写入 Zustand store
  - **不引入** TanStack Query 管理 WebSocket push 数据（channel push ≠ REST fetch）
- 不引入新的状态管理库或 UI 库（遵守 `frontend_audit.sh` 依赖约束）
- 组件头部必须有设计追溯注释（格式见 AGENTS.md）
- 文案集中到 `frontend/src/lib/copy.ts`
- 禁止内联样式（使用 Tailwind CSS 4）
