# AU-04 执行任务与系统确认

> 作者视角：当我想让 AI 帮我做具体工作（如创建角色、生成大纲）时，AI 会给出执行建议。对于高风险操作，系统会要求我确认，只有我点头才会真正动手。不管 AI 说什么，系统内部有独立的裁决机制——AI 不能自己批准自己的计划。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 让 AI "创建一个叫林烬的主角" | AI 给出建议方案，展示要做什么 |
| 提出一个很宏大的要求 | AI 诚实地说"这个太复杂，我只能先做第一步" |
| 提出一个高风险要求 | 系统弹出确认按钮，等我点击"确认执行" |
| 点击"确认执行" | 系统真正执行任务，返回结果 |
| 说"先别弄，我想再改改" | 系统取消本次执行计划，回到讨论状态 |

明确不能做的：
- AI 不应在我的回复里夹带"已批准执行"之类的词来绕过确认
- AI 不应在我不确认的情况下悄悄修改小说设定

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #2 | MicroPlan 只是建议 | C1 — 多步计划被降级，不是照单执行 |
| #3 | Orchestrator 唯一门禁 | B1 — AI 说"approved"但系统拒绝 |
| #4 | 默认只允许下一步 | A2 — 系统要求 `stop_after_next_action=true` |
| #6 | 写入默认 tentative | B2 — 标记 `production_candidate` 的请求被拦截 |
| #12 | 确认回答重新 gate | D2 — 确认后重新裁决，不直接执行 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0002 | MicroPlan 最小 schema |
| ADR-0003 | PlannerOutput Boundary 验证 |
| ADR-0004 | OrchestratorDecision 定义 |
| ADR-0005 | Execution Gate Order |
| VS-01 Contract Pack §2 | MicroPlan schema + Proposed Action Shape |
| VS-01 Contract Pack §3 | PlannerOutput Boundary 最小 validation（6 条） |
| VS-01 Contract Pack §4 | Gate Order（gates 0-11） |
| VS-01 Contract Pack §5 | OrchestratorDecision schema |
| VS-01 Contract Pack §6 | TurnResult Truthfulness Rules |

---

## 4. 验收场景

### 场景组 A：AI 的建议被审查

#### A1 — AI 给了我一个正常建议

**作为作者**，我让 AI "创建一个叫林烬的剑修角色"。AI 给了我一个建议方案，里面有角色设定草案。这个建议里没有越权的词（比如"已批准"、"直接写入"），系统检查通过，展示了执行建议。

**验证点**：
- [ ] MicroPlan 包含必要的标识（plan_id、turn_id、frame_ref 一致）
- [ ] `stop_after_next_action = true`（只做这一步）
- [ ] 建议内容不含禁止语义

**测试**：`execution_authority_test.exs` — `"accepts valid frame-plan pair"` ✅、`"accepts clean plan"` ✅

---

#### A2 — AI 在建议里夹带了"已批准执行"

**作为作者**，AI 的回复里出现了"已批准执行"或"可以直接写入作品"这样的话。我作为作者可能看不出问题——但系统应该拦截。如果系统没拦截，AI 就可以绕过确认直接改我的小说。

**验证点**：
- [ ] 包含 `"approved"` 的 plan → 被拒绝
- [ ] 包含 `"production_write_allowed"` 的 action → 被拒绝
- [ ] 拒绝后系统进入 recovery 状态而不是假装正常

**测试**：`execution_authority_test.exs` — `"rejects 'approved' in plan content"` ✅、`"rejects 'production_write_allowed' in action summary"` ✅、`"forbidden semantics blocked by envelope_validation gate"` ✅

**为什么重要**：LLM 可能会在文本中"自己批准自己"。如果系统不检查，AI 就可以绕过整个执行裁决机制。

---

#### A3 — 结构不完整的建议也被拦下

**作为作者**，AI 产出了一个缺少关键标识（frame_ref 对不上、或者 stop_after_next_action 为 false）的建议。这种建议结构就是错的，系统直接拒绝，不进入 gate 裁决。

**验证点**：
- [ ] `frame_ref` 不匹配 → 拒绝
- [ ] `stop_after_next_action != true` → 拒绝

**合同要求但当前未检查**（VS-01 Contract Pack §3 第 4、6 条）：
- [ ] proposed_actions 结构合法性校验——**未实现** ❌
- [ ] state_changes_requested 候选性校验——**未实现** ❌

**测试**：`execution_authority_test.exs` — `"rejects frame_ref mismatch"` ✅、`"rejects stop_after_next_action = false"` ✅

---

### 场景组 B：系统裁决——不是 AI 说什么就做什么

#### B1 — 我提了太多要求，系统说"一步步来"

**作为作者**，我说"帮我把第一章重写、角色全更新、伏笔表也整理掉"。AI 可能产出一个包含 3 个步骤的计划。系统判断这是多步计划，直接降级为对话——告诉我"这个范围太大了，我们先讨论第一步改什么"。

**验证点**：
- [ ] 多步 plan（>1 个 proposed_actions）→ `downgrade_to_dialogue`
- [ ] 系统解释了为什么不能一次性完成
- [ ] 第一个拦截 gate 的身份被记录

**测试**：`execution_authority_test.exs` — `"multi-step plan blocked by action_scope gate"` ✅、`"multi-step plan → downgrade_to_dialogue"` ✅

---

#### B2 — 高风险操作被拦截，需要我确认

**作为作者**，我说"把第一章正文直接替换成悬疑风格"。系统判断这是高风险操作（production_candidate），拦下来，弹出一个确认按钮。

**验证点**：
- [ ] 高风险 plan → `require_confirmation` + 打开确认 behavior
- [ ] `production_candidate` 的 action → 被 write_boundary gate 拦截
- [ ] 确认前没有任何写入发生

**测试**：`execution_authority_test.exs` — `"high-risk plan blocked by authority gate"` ✅、`"high-risk plan → require_confirmation"` ✅、`"production_candidate blocked by write_boundary gate"` ✅、`"production_candidate write → require_confirmation"` ✅

---

#### B3 — 即使 AI 说"风险低"，系统仍可以要求确认

**作为作者**，AI 把某个操作标记为低风险（`risk_hint = :low`），但实际上它涉及写入（`write_intent = :production_candidate`）。系统不管 AI 怎么标记，自己判断——write_boundary gate 仍然拦截并要求确认。

**验证点**：
- [ ] `risk_hint = :low` + `write_intent = :production_candidate` → 仍被拦截
- [ ] Planner 的 `requires_confirmation_hint = false` 不能阻止 Orchestrator 产生 confirmation

**测试**：`execution_authority_test.exs` — `"production_candidate write → require_confirmation"` ✅

---

### 场景组 C：降级和拒绝——清晰反馈

#### C1 — 太宏大的要求被降级

**作为作者**，我说"帮我写完这整本书"。AI 无法处理这种范围，系统降级为对话——告诉我"这跨度太大了，我们一步步来，先讨论第一章的方向"。

**测试**：`execution_authority_test.exs` — `"multi-step plan → downgrade_to_dialogue"` ✅

---

#### C2 — 越权请求被硬拦截

**作为作者**，我尝试让 AI 做一些它不应该做的事。系统硬拦截——不是降级，是直接拒绝。

**测试**：`execution_authority_test.exs` — `"forbidden semantics blocked by envelope_validation gate"` ✅

---

### 场景组 D：确认之后

#### D1 — 点确认后系统重新检查一遍

**作为作者**，我点击了"确认执行"。系统不是直接执行——而是拿着我的确认，结合当前最新状态，重新跑一遍审查。因为有可能在我点确认之前，作品的上下文已经变了。

**验证点**：
- [ ] confirm action 被接收 → behavior 进入 resolving 状态
- [ ] 重新生成 MicroPlan（基于确认后的状态）
- [ ] 重新跑 Gate Order
- [ ] **当前实现：`handle_action` 只做 validation，不做 behavior resolution + regating** ❌

---

#### D2 — 不管结果如何，AI 的回复不能撒谎

**作为作者**，不管是降级、确认还是执行成功，AI 的文字回复必须和系统实际做的事情一致。如果系统拒绝了执行，AI 就不能说"已成功写入"。

**验证点**：
- [ ] 降级时 AI 不说"已执行"
- [ ] 等待确认时 AI 不说"已完成"
- [ ] 执行成功时 AI 可以如实报告
- [ ] **当前实现：`truthfulness_constraints` 在 OrchestratorDecision 中定义了，但 TurnResultBuilder 未读取应用** ❌

**测试**：`execution_authority_test.exs` — `"truthfulness constraints prevent claiming execution"` ✅

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 正常建议通过审查 | ✅ |
| A2 | AI 夹带越权词被拦截 | ✅ |
| A3 | 结构不完整被拦下 | ⚠️ 3/6 校验实现 |
| B1 | 多步计划降级 | ✅ |
| B2 | 高风险拦截确认 | ✅ |
| B3 | AI 说低风险但系统仍拦截 | ✅ |
| C1 | 降级清晰反馈 | ✅ |
| C2 | 越权硬拦截 | ✅ |
| D1 | 确认后重新审查 | ❌ behavior resolution 未实现 |
| D2 | AI 回复不撒谎 | ⚠️ constraints 未消费 |

**通过率：7/10 完整 + 2/10 部分 = 约 80%**

---

## 6. 缺口

| 缺口 | 具体表现 | 影响 |
|------|---------|------|
| GAP-01 — PlannerBoundary 缺 3 项校验 | proposed_actions 结构 + state_changes 候选性未验证 | 结构异常的 plan 可能漏过 |
| GAP-02 — 3 个 gate 是 pass-through | budget / trace / compat 无实际逻辑 | 预算超支、trace 未就绪不会被拦截 |
| GAP-03 — Behavior resolution 未实现 | 确认后 behavior 永远不会 resolving → resolved | 确认操作是单向的——点完没有状态变更 |
| GAP-04 — truthfulness constraints 未消费 | OrchestratorDecision 的约束定义了但 TurnResult 不检查 | AI 可能声称执行了实际被拒绝的操作 |
| GAP-05 — 未知 gate 静默 fallback | 未知 gate → `:require_confirmation` 无日志 | 新增 gate 忘记映射不会被发现 |
| GAP-06 — 确认幂等性 | 重复点确认可能产生重复执行 | 手快连点 → 两条相同数据 |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/execution_authority_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
```
