# AU-04 执行任务与系统确认

> 作者视角：当我想让 AI 帮我做一些具体工作（如创建角色、生成大纲）时，AI 会给出它的执行建议。对于高风险操作（如写入作品），系统会要求我确认，只有我点头，它才会真正动手。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 让 AI "创建一个叫林烬的主角" | AI 给出建议方案，并说明即将创建的内容 |
| 提出一个很宏大的要求 | AI 诚实地说"这个太复杂，我只能先做第一步" |
| 看到 AI 的建议计划 | 系统展示 AI 想做的事和影响范围 |
| 点击"确认执行" | 系统真正执行任务，返回结果 |
| 说"先别弄，我想再改改" | 系统取消本次执行计划，回到讨论状态 |

明确不能做的：
- AI 不应在我不确认的情况下悄悄修改小说设定或章节
- AI 不应宣称做了它权限之外的事

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #2 | MicroPlan 只是建议 | C1 — 多步计划被降级，不是照单执行 |
| #3 | Orchestrator 唯一门禁 | B1 — 写入操作必须经过确认 gate |
| #4 | 默认只允许下一步 | A1 — 生成 MicroPlan 但 stop_after_next_action=true |
| #6 | 写入默认 tentative | B1 — 确认前不产生 production write |
| #12 | 确认回答重新进入 gate | D1 — confirm 后重新跑 Orchestrator |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0002 | MicroPlan 最小 schema |
| ADR-0003 | PlannerOutput Boundary 验证 |
| ADR-0004 | OrchestratorDecision 定义 |
| ADR-0005 | Execution Gate Order |
| VS-01 Contract Pack §2 | MicroPlan 最小 schema |
| VS-01 Contract Pack §4 | Gate Order 子集 |
| VS-01 Contract Pack §5 | OrchestratorDecision schema |
| VS-01 Contract Pack §8 | Proof 草案（7 条） |

---

## 4. 验收场景

### 场景组 A：任务建议

#### A1 — 自然请求产生执行建议

**作为作者**，我输入"帮我创建一个主角，叫林烬，是个冷酷的剑修。"
**系统应该**生成一个 MicroPlan 建议，并等待我确认。

```
作者: 帮我创建一个主角，叫林烬，是个冷酷的剑修。
AI: 没问题，我已经为你规划好了林烬的角色原型。
    [确认执行] [取消]
```

**验证点**：
- [ ] 系统生成了 MicroPlan（plan 中包含 proposed_actions）
- [ ] 系统处于"等待确认"状态，尚未写入数据库
- [ ] TurnResult 的 truthfulness 不得声称已执行

**测试**：`execution_authority_test.exs` — `"high-risk plan → require_confirmation"` ✅

---

#### A2 — 查看计划详情

**作为作者**，我想知道 AI 具体要做什么。
**系统应该**在 MicroPlan 摘要中展示涉及的工具、参数和影响范围。

**验证点**：
- [ ] plan 中包含 action summary（如"创建角色：林烬"）
- [ ] plan 中包含 risk_hint

---

### 场景组 B：确认门禁

#### B1 — 写入操作必须确认

**作为作者**，我要求 AI 修改小说内容。在我点击确认之前，系统不得写入。

**验证点**：
- [ ] OrchestratorDecision 为 `require_confirmation`
- [ ] 在我确认前，数据未写入
- [ ] TurnResult 的 `available_actions` 包含 `confirm_before_execute`

**测试**：`execution_authority_test.exs` — `"production_candidate write → require_confirmation"` ✅

---

#### B2 — 重复确认无效（幂等性）

**作为作者**，我不小心点了两次确认按钮。系统只执行一次。

**验证点**：
- [ ] 系统记录了幂等键
- [ ] 数据库中只产生一份数据

---

### 场景组 C：降级与拦截

#### C1 — 超出能力的计划被降级

**作为作者**，我提出一个非常宏大且模糊的要求（如"帮我写完这整本书"）。系统诚实告诉我做不到，降级为自然对话或分步建议。

```
作者: 帮我把整本书写完
AI: 这个任务跨度太大了，我建议我们先讨论第一章的改写方向。
    [系统决策: 降级为对话]
```

**验证点**：
- [ ] OrchestratorDecision 为 `downgrade_to_dialogue`
- [ ] AI 解释了为什么不能一次性完成

**测试**：`execution_authority_test.exs` — `"multi-step plan → downgrade_to_dialogue"` ✅

---

#### C2 — 越权请求被拦截

**作为作者**，我尝试诱导 AI 做它不应该做的事。系统硬拦截。

**验证点**：
- [ ] OrchestratorDecision 为 `reject` 或 `fail_with_recovery`
- [ ] 系统返回明确的拒绝原因

**测试**：`execution_authority_test.exs` — `"forbidden semantics blocked by envelope_validation gate"` ✅

---

### 场景组 D：执行结果

#### D1 — 确认后看到真实结果

**作为作者**，我点击了确认按钮。系统执行任务并展示结果。

**验证点**：
- [ ] 执行成功后看到结果摘要
- [ ] 内部记录了 DecisionTrace
- [ ] 如果执行失败，系统诚实报错并提供重试建议

**测试**：`execution_authority_test.exs` — `"decision trace records all required fields"` ✅

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 自然请求 → 执行建议 | ✅ 有测试 |
| A2 | 查看计划详情 | ✅ 有实现 |
| B1 | 写入操作必须确认 | ✅ 有测试 |
| B2 | 重复确认无效 | ❌ 缺测试 |
| C1 | 超大计划降级 | ✅ 有测试 |
| C2 | 越权请求拦截 | ✅ 有测试 |
| D1 | 确认后看到结果 | ✅ 有测试 |

**通过率：6/7（86%）**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|------|------|---------|
| GAP-01 — 确认幂等性 | 如果用户手快连点，可能产生重复数据 | 在 action 接收层增加基于 `idempotency_key` 的重复检测 |
| GAP-02 — `requires_confirmation_hint` 非权威 | Planner 标记 `requires_confirmation_hint=false` 时 Orchestrator 仍可 override | 新增测试：hint=false + 高风险 → Orchestrator 仍可 produce confirmation |
| GAP-03 — trace first blocking gate | DecisionTrace 必须记录第一个拦截 gate 的身份 | 已有 `decision trace records all required fields` 测试，但不专门验证 gate identity |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/execution_authority_test.exs
```
