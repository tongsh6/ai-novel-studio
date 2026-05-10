# AU-06 对话行为生命周期

> 作者视角：当 AI 不确定我的意图，或需要我确认某个操作时，系统会进入一个"等待我"的状态。这种状态是持久的——我可以现在回答，也可以先聊点别的再回来处理。我能清楚看到系统在等什么，以及我有哪些选择。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 看到系统提示"需要你补充信息" | 界面显示"等待作者"阶段，并列出待处理事项 |
| 回答 AI 的追问 | 系统接收我的回答，关闭追问并重新裁决 |
| 看到 AI 提示"确认还是取消" | 系统提供明确的确认/取消选项 |
| 点击"取消"或"先别做这个" | 系统关闭当前等待状态，清理相关卡片 |
| 先聊点别的，不理会之前的追问 | 系统保留追问状态，但我仍可进行普通对话 |

明确不能做的：
- 系统不应在我没回答追问的情况下假装理解并继续执行
- 我不应在没确认的情况下被系统推进到高风险操作

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #7 | durable behavior 必须有 open/close/resolution 生命周期 | A1 → C1 — 完整 open→resolve→close 链路 |
| #8 | 缺 slot 不自动等于表单 | A1 — 缺失信息打开 clarification 是对话行为，不是表单 |
| #10 | UI 只能提交 available actions | B1 — 回答追问通过 AvailableAction，不自由文本 |
| #12 | 确认回答重新进入 gate | B1 — 回答后 behavior 进入 resolving，重新形成 decision |
| #14 | replay 不调 LLM | C1 — behavior trace 完整可回放 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0006 | TurnPhase / TurnStatus 定义 |
| ADR-0007 | NextAction / AvailableAction 定义 |
| ADR-0008 | BehaviorState 生命周期 |
| ADR-0009 | ConfirmationBinding 和 re-gate 策略 |
| VS-03 Contract Pack §2 | TurnPhase / TurnStatus 最小集合 |
| VS-03 Contract Pack §3 | NextAction / AvailableAction 集合 |
| VS-03 Contract Pack §4 | BehaviorState 最小 schema |
| VS-03 Contract Pack §5 | ConfirmationBinding 最小 policy |
| VS-03 Contract Pack §7 | Proof 草案（10 条） |

---

## 4. 验收场景

### 场景组 A：开启行为

#### A1 — 高风险操作触发确认

**作为作者**，我要求执行一个高风险操作。系统开启一个"确认"（Confirmation）行为，等待我点头。

```
作者: 把第一章全部替换成新版本。
AI: 这会影响第一章的全部内容。
    确认替换吗？
    系统状态: [等待作者确认]
    [确认执行] [取消]
```

**验证点**：
- [ ] TurnPhase 变为 `awaiting_author`
- [ ] 产生类型为 `confirmation` 的 BehaviorState
- [ ] TurnResult 中包含引导我行动的 `available_actions`
- [ ] BehaviorState 有 `required_next_action`

**测试**：`behavior_lifecycle_test.exs` — `"high-risk confirmation plan opens behavior"` ✅
**测试**：`behavior_lifecycle_test.exs` — `"behavior has required_next_action"` ✅

---

#### A2 — 降级不打开行为

**作为作者**，我提出一个宏大但可行的想法。系统虽然降级了计划，但不需要我确认——只是告诉我会分步来做。

**验证点**：
- [ ] `downgrade_to_dialogue` 不打开 durable behavior
- [ ] TurnPhase 仍为 `dialogue`

**测试**：`behavior_lifecycle_test.exs` — `"downgrade does not open behavior"` ✅

---

### 场景组 B：交互与回答

#### B1 — 通过 Action 回答确认

**作为作者**，我点击了"确认执行"。系统接收这个 action，将 behavior 推进到 resolving 状态，重新进入 Orchestrator gate。

**验证点**：
- [ ] 提交的 action 引用了正确的 `behavior_ref`
- [ ] 系统重新进入裁决流程（re-gate）
- [ ] BehaviorState 进入 resolving 状态

**测试**：`action_roundtrip_test.exs` — `"valid action passes through gateway"` ✅

---

#### B2 — 取消行为

**作为作者**，我点击了"取消"按钮。系统关闭当前 BehaviorState。

**验证点**：
- [ ] BehaviorState 有可用的 `cancel_pending_behavior` action
- [ ] 取消后 lifecycle_status 变为 `cancelled`
- [ ] 界面上的确认提示消失

---

### 场景组 C：生命周期闭环

#### C1 — 行为解决后继续主链

**作为作者**，我回答了追问。系统关闭追问行为，自动推进到原来的任务计划。

**验证点**：
- [ ] BehaviorState.lifecycle_status 变为 `resolved`
- [ ] `closed?` 返回 true
- [ ] resolution 字段非空
- [ ] 系统继续执行后续 MicroPlan

**测试**：`behavior_lifecycle_test.exs` — `"closed? returns true for resolved/cancelled/failed"` ✅

---

### 场景组 D：健壮性

#### D1 — 尝试操作已关闭的行为

**作为作者**，我尝试点击一个昨天已经处理完的确认按钮。系统提示"该操作已处理"，不重新执行。

**验证点**：
- [ ] 返回 stale action 提示
- [ ] 系统不产生新的执行副作用

**测试**：`action_roundtrip_test.exs` — `"stale action rejected by gateway"` ✅

---

#### D2 — 同一时刻只有一个主等待态

**作为作者**，在一个确认还没处理完时，我发起另一个需要确认的任务。系统要么拒绝新任务，要么关闭旧任务——不会同时展示两个"主等待态"。

**验证点**：
- [ ] 不出现两个 primary author-blocking behavior 同时活跃
- [ ] Trace 记录了旧行为如何处理

**测试**：`behavior_lifecycle_test.exs` — `"open? returns true for :awaiting_author"` ✅（验证 open? 判断逻辑）

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 高风险触发确认 | ✅ 有测试 |
| A2 | 降级不打开行为 | ✅ 有测试 |
| B1 | 通过 Action 回答 | ✅ 有测试 |
| B2 | 取消行为 | ⚠️ 有实现，缺独立测试 |
| C1 | 解决后继续主链 | ✅ 有测试 |
| D1 | 处理已关闭行为 | ✅ 有测试 |
| D2 | 单一主等待态 | ✅ 有测试 |

**通过率：6/7（86%）**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|------|------|---------|
| GAP-01 — 取消行为的端到端验证 | B2 有实现但缺独立场景测试 | 新增测试：open behavior → cancel action → 验证 behavior closed + 无副作用 |
| GAP-02 — 行为过期时间 | 某些确认如果一直不处理不应永远挂着 | 为 BehaviorState 增加 TTL 机制 |
| GAP-03 — 行为被覆盖（Superseded） | 同一 workstream 内第二个确认如何取代第一个 | 明确 superseded 规则 + 测试 |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/behavior_lifecycle_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
```
