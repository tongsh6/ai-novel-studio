# AU-06 对话行为生命周期

> 作者视角：当 AI 需要我确认或补充信息时，系统进入"等待作者"状态。我能看到它为什么等我、我有哪些选择。我操作后这个状态会正常关闭——不是永远挂着。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 看到系统提示"需要你确认" | 界面显示"等待作者" + 确认/取消按钮 |
| 点击"确认执行" | 系统接收我的决定，关闭等待，重新评估 |
| 点击"取消" | 系统关闭等待，不产生任何副作用 |
| 想先聊点别的，暂时不理确认 | 确认提示还在，但不妨碍我正常聊天 |
| 回看几天前的对话 | 能看到当时 AI 让我确认了什么事情，我点了什么 |
| 点一个已经处理过的旧按钮 | 系统提示"已处理"，不会重新执行 |

明确不能做的：
- 我不确认时 AI 不能自己往下走
- 同一个地方不能同时弹出两个确认让我选
- 两周前的确认按钮今天点了不应该还有效

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #7 | durable behavior 必须有 open/close/resolution | C1 — 从打开到关闭的完整过程可追踪 |
| #8 | 缺 slot 不自动等于表单 | A2 — 降级不打开 behavior |
| #10 | UI 只能提交 available actions | D1 — 点已关闭的按钮被拒绝 |
| #12 | 确认后重新 gate | C2 — 点了确认不等于直接执行 |
| #14 | replay 不调 LLM | E1 — 历史确认可回溯 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0006 | TurnPhase / TurnStatus 定义 |
| ADR-0007 | NextAction / AvailableAction 定义 |
| ADR-0008 | BehaviorState 生命周期 |
| ADR-0009 | ConfirmationBinding 和 re-gate 策略 |
| VS-03 Contract Pack §2 | TurnPhase / TurnStatus 最小集合 |
| VS-03 Contract Pack §3 | AvailableAction 集合 |
| VS-03 Contract Pack §4 | BehaviorState 最小 schema |
| VS-03 Contract Pack §5 | ConfirmationBinding 最小 policy |
| VS-03 Contract Pack §7 | Proof 草案 |

---

## 4. 验收场景

### 场景组 A：看到等待状态

#### A1 — 确认弹窗内容完整

**作为作者**，AI 让我确认一个操作。我看到"等待作者确认"的提示，清楚知道 AI 要我确认什么（比如"确认替换第一章正文"），以及会有什么影响。我面前有两个按钮：确认执行、拒绝。

**验证点**：
- [ ] 提示文字说明了在等什么（`prompt_contract.question`）
- [ ] 给出了约束说明（风险、权限限制）
- [ ] 给出了可用的操作按钮（至少 confirm + reject/cancel）

**测试**：`behavior_lifecycle_test.exs` — `"high-risk confirmation plan opens behavior"` ✅、`"behavior has required_next_action"` ✅

---

#### A2 — 普通讨论不触发确认

**作为作者**，我和 AI 正常讨论剧情方向——不涉及具体写入操作。系统不会无缘无故进入"等待确认"状态。我的输入框一直是可用的。

**验证点**：
- [ ] 降级/对话阶段不打开 durable behavior
- [ ] TurnPhase 为 `dialogue`（不是 `awaiting_author`）

**测试**：`behavior_lifecycle_test.exs` — `"downgrade does not open behavior"` ✅

---

### 场景组 B：我能做什么操作

#### B1 — 点确认，系统处理我的决定

**作为作者**，我点了"确认执行"。确认提示消失，系统开始处理。我不用再点第二次。

**验证点**：
- [ ] 提交的 action 引用了正确的 `behavior_ref`
- [ ] behavior 从"等我"变为"正在处理"
- [ ] 系统重新评估确认后的状态

**测试**：`action_roundtrip_test.exs` — `"valid action passes through gateway"` ✅

**当前实现问题**：确认后 behavior 不会进入 resolving 状态——永远停在 awaiting_author。❌

---

#### B2 — 点取消，确认消失且不影响作品

**作为作者**，我点了"取消"。确认提示消失，我回到正常对话。之前 AI 建议的操作没有留下任何痕迹。

**验证点**：
- [ ] behavior 有 `cancel_pending_behavior` action
- [ ] 取消后 lifecycle 变为 cancelled
- [ ] 取消不产生 production write

---

#### B3 — 点了已过期的确认按钮

**作为作者**，我翻到两天前的一个确认提示，点了"确认执行"。系统提示我这个操作已经过期了——因为在那之后作品的上下文已经变了。不会基于过时的状态执行操作。

**验证点**：
- [ ] 返回 stale action 提示
- [ ] 不产生新的执行副作用

**测试**：`action_roundtrip_test.exs` — `"stale action rejected by gateway"` ✅

---

### 场景组 C：完整的使用体验

#### C1 — 一次完整的确认过程

**作为作者**，我要 AI "替换第一章正文"。系统弹出了确认提示（告诉我影响范围）。我看了下，点确认。系统重新评估后执行了替换。几天后我回看这轮对话，能看到：什么时候 AI 让我确认的、我什么时候点的确认、确认后系统做了什么。

**验证点**：
- [ ] behavior 创建时记录 `opened_at_turn_ref`（什么时候打开的）
- [ ] behavior 关闭时记录 `closed_at_turn_ref` + `resolution`（什么时候关的、结果是什么）
- [ ] **当前实现：`opened_at_turn_ref` 有记录，但 `closed_at_turn_ref` 和 `resolution` 永远为空——因为 resolution 路径未实现** ❌

---

#### C2 — 点了确认不是直接执行，系统会重新审查

**作为作者**，我点了确认后，系统并没有直接执行。因为它发现在我刚点确认之前，作品的上下文已经发生了变化（比如角色设定被修改了）。系统重新审查后发现需要再次确认。这很合理——确认那一刻的状态才是系统执行的基础。

**验证点**：
- [ ] confirm action 后 → behavior resolving → re-gate
- [ ] re-gate 可能产生新的 decision（包括再次 require_confirmation）
- [ ] **当前实现：re-gate 未实现** ❌

---

### 场景组 D：不会卡住

#### D1 — 同一时间只有一个确认在等我

**作为作者**，在一个确认还没处理完的时候，我又发起了一个需要确认的操作。系统要么告诉我"先处理上一个确认"，要么自动关闭上一个确认用新的替代——不会出现两个确认弹窗叠在一起的情况。

**验证点**：
- [ ] 同一 workspace 内 active behavior <= 1
- [ ] 新 behavior 打开时旧 behavior 被 superseded 或新 behavior 被拒绝
- [ ] **当前实现：无检查——可以同时打开多个 behavior** ❌

---

#### D2 — 挂了两小时的确认不会永远挂着

**作为作者**，我有一个确认提示挂了两个小时没处理。系统至少标注它为"可能已过期"，而不是假装和刚弹出来时一样有效。

**验证点**：
- [ ] `opened_at_turn_ref` 可计算存活时间
- [ ] 超时后 action 不应仍显示为有效
- [ ] **当前实现：无 TTL 逻辑** ❌

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 确认弹窗内容完整 | ✅ |
| A2 | 普通讨论不触发确认 | ✅ |
| B1 | 点确认系统处理 | ⚠️ resolution 未实现 |
| B2 | 点取消无副作用 | ⚠️ 有实现缺测试 |
| B3 | 点过期按钮被拒 | ✅ |
| C1 | 完整确认过程可回溯 | ❌ close/resolution 未记录 |
| C2 | 确认后重新审查 | ❌ re-gate 未实现 |
| D1 | 同一时间只有一个确认 | ❌ 无检查 |
| D2 | 挂两小时不会永远挂着 | ❌ 无 TTL |

**通过率：3/9 完整 + 2/9 部分 = 约 44%**

---

## 6. 缺口

| 缺口 | 具体表现 | 影响 |
|------|---------|------|
| GAP-01 — Behavior resolution 未实现 | `handle_action` 不修改 behavior status | 确认后 behavior 永不 close——永远是 awaiting_author |
| GAP-02 — 状态转换无 guard | 任何代码可直接改 lifecycle_status | 可能出现 `cancelled → awaiting_author` 回退 |
| GAP-03 — 单一活跃 behavior 未强制 | 打开新 behavior 前不检查已有活跃者 | 可能同时出现两个确认弹窗 |
| GAP-04 — TTL 未实现 | 无过期机制 | 确认可以永远挂着 |
| GAP-05 — trace_ref 未填写 | behavior 创建后 trace_ref 为空 | 回放时无法追溯 behavior 的打开和关闭 |
| GAP-06 — ConfirmationBinding 未使用 | ADR-0009 的设计不存在于代码中 | 确认绑定(防止绑定错误 target)的保障缺失 |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/behavior_lifecycle_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
```
