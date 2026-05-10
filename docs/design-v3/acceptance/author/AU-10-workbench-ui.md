# AU-10 工作台实时交互

> 作者视角：工作台是我和 AI 协作的主界面。我需要实时知道系统状态——AI 连上了吗？它在思考吗？现在在等什么？我能做什么操作？界面上的按钮和卡片必须反映真实状态，不能误导我。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 一打开工作台就看到系统状态 | 状态栏显示 LLM 是否连接、WebSocket 是否在线 |
| 发送消息 | 输入文字按回车发送，消息立即出现在对话中 |
| 看到 AI 在思考 | 消息列表底部显示"思考中..."，输入框保持可用 |
| 看到 AI 的回复卡片 | 确认卡片、候选方向、采纳卡片等以结构化方式展示 |
| 点击 action 按钮 | 按钮行为与服务器状态一致，disabled 的按钮不能点 |
| AI 在等我确认时 | 状态栏显示"等待作者"，action 面板显示可用的操作 |
| WebSocket 断开时 | 状态栏变红，输入框被禁用 |

明确不能做的：
- 界面不能展示服务器没有的 action 按钮
- disabled 的按钮不能通过前端 hack 变成 enabled
- loading 状态消失后不能留下空白的假消息

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #9 | TurnResult 是 canonical 输出 | S5 — 卡片和 action 来自 TurnResult，不由前端发明 |
| #10 | UI 只能提交 available actions | S6 — disabled action 按钮不可点击 |
| #15 | projection hints 只触发刷新 | S3 — 状态栏展示 phase/status，不触发写入 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| `WorkspaceChat.tsx` | v2 工作台主组件（587行） |
| `WorkbenchV3.tsx` | v3 工作台主组件（337行） |
| `UICards.tsx` | 10 种 UI 卡片渲染 |
| `store.ts` | `socketConnected`、`channel`、`longRun` 等状态 |
| `socket.ts` / `socket_v3.ts` | Channel 消息收发 |
| VS-05 Contract Pack | TurnResultViewModel、AvailableAction、UICard |

---

## 4. 验收场景

### 场景组 A：状态感知

#### S1 — 启动后看到连接状态

**作为作者**，我打开应用，顶部状态栏告诉我两个关键信息：

```
AI Novel Studio v3
  LLM: 已连接 · deepseek-chat   服务: 已连接
```

**验证点**：
- [ ] LLM 状态：检测中… → 已连接（绿）/ 未连接（红）
- [ ] 服务状态（WebSocket）：已连接（绿）/ 离线（灰）
- [ ] LLM 模型名 (如 `deepseek-chat`) 正确显示
- [ ] LLM 状态每 30s 自动刷新

**代码**：`WorkbenchV3.tsx:192-222`（StatusBar）✅
**代码**：`WorkspaceChat.tsx:101-115`（LLM 轮询）✅

---

#### S2 — WebSocket 断开时无法发送

**作为作者**，如果 WebSocket 断开（服务离线），输入框变灰不可用，我不能发送消息——避免写了半天发不出去。

**验证点**：
- [ ] `socketConnected === false` 时输入框 `disabled`
- [ ] 发送按钮 `disabled`
- [ ] 状态栏显示"服务: 离线"（红色或灰色）

**代码**：`WorkspaceChat.tsx:514`（`disabled={!socketConnected}`）、`WorkbenchV3.tsx:324` ✅

---

#### S3 — 看到当前 phase/status

**作为作者**，当 AI 在等我确认时，状态栏显示当前阶段。我知道系统在等我做什么。

```
AI Novel Studio v3  [awaiting_author · needs_confirmation]
```

**验证点**：
- [ ] phase 显示为人类可读的状态（如"等待作者"）
- [ ] 完成状态显示为"已完成"
- [ ] phase/status 来自 TurnResult，不由前端推测

**代码**：`WorkbenchV3.tsx:196-200`、AU-01 的文案映射 ✅

---

### 场景组 B：消息交互

#### S4 — 发送消息后看到加载状态

**作为作者**，我发送一条消息后，消息列表立即显示我的消息，底部出现"思考中..."。AI 回复到达后，加载状态消失，AI 消息出现。

```
你: 帮我想三个主角名字
AI: 思考中...                          ← 加载中
AI: 我为你构思了三个主角名字：林烬...   ← 回复到达
```

**验证点**：
- [ ] 用户消息立即出现在列表中（不等服务器）
- [ ] "思考中..."在 loading 期间持续显示
- [ ] 回复到达后 loading 消失，AI 消息出现
- [ ] 如果发送失败，显示"发送失败，请重试。"

**代码**：`WorkspaceChat.tsx:226-242`、`WorkbenchV3.tsx:127-149` ✅

---

#### S5 — 看到候选方向卡片

**作为作者**，AI 在探索阶段给了我候选方向。每个方向以卡片形式展示：标题、简介、风格标签。

```
候选创作方向:
┌──────────────────────────────────────┐
│ 公司垄断灵气                         │
│ 修仙界的灵气被巨头公司垄断...         │
│ [热血] [黑色幽默]                     │
└──────────────────────────────────────┘
```

**验证点**：
- [ ] 候选方向来自 `turn_result.candidate_directions`
- [ ] 每个卡片显示标题（title）、简介（pitch）、标签（tone_tags）
- [ ] 候选方向数量 ≥ 2

**代码**：`WorkspaceChat.tsx:473-492`、`WorkbenchV3.tsx:265-288` ✅

---

### 场景组 C：Action 面板安全

#### S6 — Available actions 只能来自服务器

**作为作者**，AI 给我展示了几个 action 按钮（如"确认执行"、"取消"）。这些按钮是从 TurnResult 的 `available_actions` 渲染的，不由前端编造。

**验证点**：
- [ ] ActionPanel 渲染的按钮和 `available_actions` 数组一一对应
- [ ] `enabled: false` 的 action 按钮被禁用
- [ ] `disabled_reason` 作为 tooltip 展示
- [ ] 前端不能凭空添加不在 `available_actions` 中的按钮

**代码**：`WorkbenchV3.tsx:291-313`（ActionPanel）✅
**测试**：`workspace_channel_v3_test.exs` — `"client-provided source_turn_result cannot authorize invented action"` ✅

---

#### S7 — Action 类型对应的文案

**作为作者**，不同类型的 action 按钮显示对应的中文文案。

| action_type | 显示文案 |
|-------------|---------|
| `confirm_before_execute` | 确认执行 |
| `reject_or_cancel_confirmation` | 拒绝 |
| `cancel_pending_behavior` | 取消 |
| `continue_dialogue` | 继续对话 |

**验证点**：
- [ ] 每种 action_type 有对应的中文文案
- [ ] 未知 action_type 降级显示原始值（不崩溃）

**代码**：`WorkbenchV3.tsx:301-309` ✅

---

### 场景组 D：卡片渲染

#### S8 — 10 种卡片类型正确渲染

**作为作者**，AI 的回复可能包含不同类型的结构化卡片。每种卡片以正确的样式渲染。

| card_type | 用途 | 渲染组件 |
|-----------|------|---------|
| `clarification_card` | 追问信息 | `ClarificationCard` |
| `confirmation_card` | 确认操作 | `ConfirmationCard` |
| `adoption_card` | 采纳草稿 | `AdoptionCard` |
| `warning_card` | 警告提示 | `WarningCard` |
| `progress_card` | 进度展示 | `ProgressCard` |
| `checkpoint_card` | 检查点 | `CheckpointCard` |
| `result_card` | 执行结果 | `ResultCard` |
| `failure_card` | 失败提示 | `FailureCard` |
| `escalation_card` | 升级提示 | `EscalationCard` |
| 未知类型 | 降级处理 | `DefaultCard` |

**验证点**：
- [ ] 已知 card_type 正确路由到对应组件
- [ ] 未知 card_type 降级到 `DefaultCard`，不崩溃
- [ ] 卡片上的 action 按钮行为正确

**代码**：`WorkspaceChat.tsx:449-470`、`UICards.tsx` ✅

---

#### S9 — 修改草稿弹窗

**作为作者**，AI 生成的草稿我不完全满意。我点击"修改后采用"，弹出修改框，输入修改意见后提交。

```
┌──────────────────────────────┐
│ 修改草稿                      │
│ [输入修改意见...]             │
│                              │
│ [取消] [提交修改]             │
└──────────────────────────────┘
```

**验证点**：
- [ ] 点击"修改后采用"（`edit_then_accept`）打开弹窗
- [ ] 弹窗预填当前草稿内容
- [ ] 点击"提交修改"调用 `modifyDraft`
- [ ] 点击遮罩层或"取消"关闭弹窗

**代码**：`WorkspaceChat.tsx:395-417`、`WorkspaceChat.tsx:565-583` ✅

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| S1 | 连接状态显示 | ✅ 有实现 |
| S2 | 断线时输入框禁用 | ✅ 有实现 |
| S3 | Phase/Status 显示 | ✅ 有实现 |
| S4 | 发送消息 + 加载态 | ✅ 有实现 |
| S5 | 候选方向卡片 | ✅ 有实现 |
| S6 | Action 来源安全 | ✅ 有实现 + 有测试 |
| S7 | Action 文案映射 | ✅ 有实现 |
| S8 | 10 种卡片渲染 | ✅ 有实现 |
| S9 | 修改草稿弹窗 | ✅ 有实现 |

**通过率：9/9（100%）** — 全部场景已有前端实现。S6 有后端 Channel 测试。

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|------|------|---------|
| GAP-01 — 前端自动化测试 | 所有 UI 交互验收依赖手动操作 | VS-07 中增加 Playwright 测试：发送消息、loading 态、卡片渲染、action 点击 |
| GAP-02 — 断线重连 UX | WebSocket 断开后需手动刷新页面 | 增加自动重连 + "重连中..."提示 |
| GAP-03 — 长时间 loading 超时 | 如果 LLM 响应超过 60s，用户看到无限"思考中" | 增加超时提示 + "取消等待"按钮 |

---

## 7. 验收命令

```bash
# Channel 层 action 安全测试
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs

# 前端 UI 验收依赖 Playwright 手动/自动 walkthrough
# cd frontend && pnpm tauri dev
# scripts/smoke_test.sh
```
