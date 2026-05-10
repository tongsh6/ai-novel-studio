# AU-06 对话行为生命周期

> 作者视角：当 AI 不确定我的意图，或者需要我确认某个操作时，系统会进入一个"等待我"的状态。这种状态是持久的——我可以现在回答，也可以先聊点别的再回来处理。我能清楚地看到系统在等什么，以及我有哪些选择。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 看到系统提示"需要你补充信息" | 界面显示系统处于"等待作者"阶段，并列出待办事项 |
| 回答 AI 的追问 | 系统接收我的回答，尝试关闭追问并继续执行任务 |
| 看到 AI 提示"确认还是取消" | 系统提供明确的按钮或选项让我做决定 |
| 点击"取消"或"先别做这个" | 系统关闭当前的等待状态，清理相关的建议卡片 |
| 先聊点别的，不理会之前的追问 | 系统保留之前的追问状态，但我仍然可以进行普通对话 |

明确不能做的：
- 系统不应该在我没回答追问的情况下，假装已经理解了并继续执行错误的计划。
- 我不应该在没有"确认"的情况下被系统强行推进到高风险操作。

---

## 2. 验收场景

### 场景组 A：开启行为 (Opening Behavior)

#### A1 — 缺少关键信息触发追问

**作为作者**，我发起一个任务但没说清楚目标（如"帮我改一下剧情"但没说哪章）。
**系统应该**开启一个"追问"（Clarification）行为。

```
作者: 帮我改一下剧情。
AI: 没问题，但我需要确认一下：你是想修改[第一章]还是[第二章]？
    系统状态: [等待作者补充信息]
```

**验证点**：
- [ ] `TurnPhase` 变为 `awaiting_author`
- [ ] `TurnStatus` 包含 `needs_clarification`
- [ ] 内部产生了一个 `BehaviorState`，类型为 `clarification`
- [ ] `TurnResult` 中包含了引导我回答的 `available_actions`

**测试**: `behavior_lifecycle_test.exs` — `"missing blocking slot opens durable clarification"` ✅

---

#### A2 — 高风险操作触发确认

**作为作者**，我要求删除某个重要设定。
**系统应该**开启一个"确认"（Confirmation）行为。

**验证点**：
- [ ] `TurnStatus` 包含 `needs_confirmation`
- [ ] 产生了一个类型为 `confirmation` 的 `BehaviorState`

---

### 场景组 B：交互与回答 (Interaction)

#### B1 — 通过 Action 回答追问

**作为作者**，我点击了建议的选项（如"修改第一章"）。
**系统应该**接收这个 `AvailableAction`，并尝试解决当前的追问。

**验证点**：
- [ ] 提交的 Action 引用了正确的 `behavior_id`
- [ ] 系统重新进入裁决流程（re-gate）

**测试**: `behavior_lifecycle_test.exs` — `"answering clarification resolves behavior"` ✅

---

#### B2 — 取消行为

**作为作者**，我点击了"取消"按钮。
**系统应该**关闭当前的 `BehaviorState`，并将状态设为已取消。

**验证点**：
- [ ] `BehaviorState.resolution` 变为 `cancelled`
- [ ] 界面上的追问/确认提示消失

---

### 场景组 C：生命周期闭环 (Lifecycle Resolution)

#### C1 — 行为解决后继续主链

**作为作者**，我回答了追问。
**系统应该**关闭追问行为，并自动推进到原来的任务计划。

**验证点**：
- [ ] `BehaviorState.status` 变为 `closed`
- [ ] 系统执行了后续的 `MicroPlan`（如开始修改第一章剧情）

---

#### C2 — 行为被覆盖（Superseded）

**作为作者**，在一个追问还没处理完时，我又发起了一个全新的、更高优先级的任务。
**系统应该**优雅地处理旧行为（如标记为被覆盖或提醒我先处理旧任务）。

**验证点**：
- [ ] 系统不会同时展示两个冲突的"主等待态"
- [ ] Trace 记录了旧行为如何被处理

---

### 场景组 D：健壮性 (Robustness)

#### D1 — 尝试操作已关闭的行为

**作为作者**，我尝试点击一个昨天已经完成的确认按钮。
**系统应该**提示我"该操作已处理"或"已过期"，而不是重新执行。

**验证点**：
- [ ] 返回 `stale_action` 或 `already_resolved` 提示
- [ ] 系统不产生新的执行副作用

**测试**: `behavior_lifecycle_test.exs` — `"stale behavior action is rejected"` ✅

---

## 3. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 缺信息触发追问 | ✅ 有测试 |
| A2 | 高风险触发确认 | ✅ 有测试 |
| B1 | 通过 Action 回答 | ✅ 有测试 |
| B2 | 取消行为 | ✅ 有实现 (cancel action) |
| C1 | 解决后继续主链 | ✅ 有实现 |
| C2 | 行为被覆盖 | ❌ 缺实现 (需处理 behavior stack) |
| D1 | 处理已关闭行为 | ✅ 有测试 |

**通过率：5/6（83%）**

---

## 4. 缺口

| 缺口 | 影响 | 建议处理 |
|------|------|---------|
| GAP-01 — 行为堆栈/覆盖 | 如果用户同时触发多个追问，界面可能变得混乱 | 明确 "Primary Author-blocking Behavior" 的单一性原则，新行为必须显式取代旧行为 |
| GAP-02 — 行为过期时间 | 某些确认动作（如临时生成的验证码或时效性方案）如果一直不处理，不应永远挂着 | 为 `BehaviorState` 增加 TTL (Time-To-Live) 机制 |

---

## 5. 验收命令

```bash
mix test apps/novel_application/test/novel_application/behavior_lifecycle_test.exs
```

全部通过标准：所有场景 ✅，GAP-01/02 已关闭。
