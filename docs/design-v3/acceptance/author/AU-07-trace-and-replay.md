# AU-07 系统透明度与决策溯源

> 作者视角：我想知道 AI 为什么会给我这个建议。系统应该能告诉我它参考了我小说里的哪些设定、是否调用了工具、以及在做决定时是如何考虑的。几天后回看旧对话，即使 AI 不在线，解释也还在。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 点击消息旁的"为什么？" | 系统展示本轮决策摘要——为什么不调工具、为什么拒了 |
| 查看 AI 参考了哪些内容 | 看到引用了哪些设定、对话、记忆 |
| 了解操作为什么没执行 | 系统解释是被什么 gate 拦截的 |
| 查看 AI 调用了什么工具 | 看到工具名、版本、执行结果 |
| 翻看一周前的对话解释 | 解释是持久化的，不依赖实时 AI |
| AI 给我的解释是通俗的 | 不是技术错误码，是我能看懂的中文 |

明确不能做的：
- 系统不应向我展示原始 LLM 提示词（Raw Prompts）
- 我不应看到涉及系统安全或他人隐私的信息

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #5 | 工具调用有 trace | B1 — 工具调用的 trace 可查 |
| #9 | TurnResult 是 canonical 输出 | A1 — trace summary 源自真实 trace |
| #13 | trace summary 脱敏 | C1 — 敏感字段不在作者可见区 |
| #14 | replay 不重新调用 LLM | D1 — 离线查看解释不调 AI |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0013 | trace 脱敏与上下文引用 |
| ADR-0014 | TraceSummaryView redaction 规则 |
| ADR-0017 | ReplayCase / ReplayReport 定义 |
| VS-06 Contract Pack §2 | TraceSummaryView 字段 |
| VS-06 Contract Pack §4 | ReplayReport schema |
| VS-06 Contract Pack §5 | Required Replay Questions（6 个问题） |
| VS-06 Contract Pack §6 | Proof 草案 |

---

## 4. 验收场景

### 场景组 A：每轮对话的可解释性

#### A1 — 纯聊天时能看到为什么不调工具

**作为作者**，我和 AI 聊了聊故事方向，AI 没有调用任何工具。我点开"为什么？"，看到解释："本轮只需要自然语言回应，不需要工具"。这是我能看懂的中文，不是一串技术错误码。

**验证点**：
- [ ] trace summary 包含决策原因（`no_tool_reason`）
- [ ] 原因是人类可读的（如 `"no_tool_needed"` → "不需要工具"）
- [ ] trace 记录完整的事件顺序（5 个事件）

**测试**：`dialogue_gateway_test.exs` — `"DecisionTrace records no-tool, no-behavior, no-write reasons"` ✅

---

#### A2 — AI 的建议被拒绝时能看到原因

**作为作者**，我让 AI "把整本书重写一遍"。AI 拒绝了我。我点开"为什么？"，看到解释："计划范围过广，建议降级为对话讨论"。还告诉我被哪个检查拦截了（action_scope gate）。

**验证点**：
- [ ] trace summary 包含 `orchestrator_decision` 和 `first_blocking_gate`
- [ ] gate 名有对应的中文解释（如 `action_scope` → "计划范围"）

**当前实现**：`first_blocking_gate` 被记录在 summary 中 ✅。但 gate 名是英文 atom（如 `action_scope`），缺少作者友好的中文映射 ❌。

---

#### A3 — AI 调用了工具时能看到完整过程

**作为作者**，AI 帮我创建了一个角色。我点开详情，看到：AI 调用了"角色创建工具"，输入了名字和类型，执行成功，产生了一个草稿——目前还未采纳。

**验证点**：
- [ ] trace summary 包含 tool_name、tool_version、tool_status
- [ ] 标注 `adoption_status = "not_adopted"`（不谎报采纳）
- [ ] 事件顺序包含从 tool_request → tool_result 的完整链路

**测试**：`tool_provenance_test.exs` — `"executes valid tool request and returns ToolResult"` ✅

---

### 场景组 B：上下文溯源

#### B1 — 看到 AI 引用了什么

**作为作者**，AI 说"林烬应该从亲情线切入"。我想知道它是基于我说的、还是作品设定、还是我确认过的伏笔。我点开详情，看到它参考了：作品《灵源纪元》的当前设定、上一轮的对话内容。

**验证点**：
- [ ] `context_refs` 列出所有引用来源（source_type + context_ref）
- [ ] 空上下文时标注无引用（`has_context: false`）
- [ ] 来源类型包括 current_work / conversation / memory / behavior

**测试**：`context_grounding_test.exs` — `"with context, trace records context_refs"` ✅

---

### 场景组 C：脱敏边界

#### C1 — 我看不到系统的内部秘密

**作为作者**，我在决策详情里翻看。我不应该看到：AI 的原始提示词、系统内部策略、其他作者的数据、代码堆栈。如果一条记忆被标记为"敏感"，它的正文不应该出现在我能看到的摘要里。

**验证点**：
- [ ] author-safe summary 不含 raw prompt
- [ ] author-safe summary 不含 hidden policy
- [ ] `redaction_level = :author_safe` 的 summary 与 developer 视图隔离
- [ ] **当前实现：有 `redaction_level` 字段但同一份报告既用作 author 又用作 developer 视图——未做内容隔离** ❌

---

### 场景组 D：离线回放

#### D1 — 断网状态下翻看旧对话的解释

**作为作者**，我去年的今天写的对话，现在回看——AI 服务当时可能已经不在线了。但我仍然能看到当时的决策解释：为什么那个建议被拒了、AI 当时参考了什么。这些解释是从当时保存的 trace 里重建的，不需要重新调用 AI。

**验证点**：
- [ ] ReplayReport 从持久化的 DecisionTrace 重建
- [ ] `provider_called = false`——重建不调 LLM
- [ ] 完整 trace → `result_status = :complete`

**测试**：`replay_service_test.exs` — `"replay report does not call provider"` ✅、`"builds replay report from reply-only trace"` ✅

---

#### D2 — 不完整的 trace 诚实标注

**作为作者**，我的一个旧对话因为某种原因 trace 数据不完整（缺少 turn_result_ref）。我回看时系统标注为"部分可解释"，而不是假装一切正常。它明确告诉我"缺少 turn_result_ref——部分信息不可用"。

**验证点**：
- [ ] 缺失关键 ref → `result_status = :partial`
- [ ] `missing_trace_refs` 列出缺失项
- [ ] 不声称 `complete`

**测试**：`replay_service_test.exs` — `"missing_turn_result_ref detected as partial"` ✅

---

#### D3 — 回放能回答"策划建议和最终决定有什么差异"

**作为作者**，AI 最初建议了一个 3 步计划，但最终系统只执行了第 1 步。我回看时，能看到：AI 建议了什么、系统裁决了什么（降级/拒绝/确认）、以及为什么。

**验证点**：
- [ ] ReplayReport 的 `decision_explanations` 包含 plan vs decision 的差异
- [ ] 包含 `plan_actions`（AI 建议的步骤数）vs `orchestrator_decision`（系统的裁决）
- [ ] **当前实现：`build_decision_explanations` 只输出 decision 信息，plan 信息仅在 `record_with_decision` 的 summary 中有 `plan_actions` 计数** ⚠️

**测试**：`replay_service_test.exs` — `"builds replay report from tool_dispatched trace"` ✅

---

#### D4 — 回放能回答"工具结果为什么没直接变成作品内容"

**作为作者**，AI 用工具生成了一个角色，但我当时没采纳。回看时我想知道：是我不满意所以没采纳，还是系统拦截了？

**验证点**：
- [ ] `state_explanations` 解释 adoption boundary 的决策
- [ ] 标注 `adoption_status = "not_adopted"` 以及原因
- [ ] **当前实现：`build_state_explanations` 硬编码返回 `"no production write in this turn"`——不区分不同情况** ❌

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 纯聊天时能看到不调工具原因 | ✅ |
| A2 | 被拒时能看到被什么 gate 拦了 | ⚠️ gate 名无中文映射 |
| A3 | 工具调用完整过程可查 | ✅ |
| B1 | 看到 AI 引用了什么 | ✅ |
| C1 | 看不到系统秘密 | ❌ 无内容隔离 |
| D1 | 断网查看旧对话解释 | ✅ |
| D2 | 不完整 trace 诚实标注 | ✅ |
| D3 | 建议和决定差异可见 | ⚠️ plan vs decision 信息不完整 |
| D4 | 工具结果为什么没采纳 | ❌ state_explanations 硬编码 |

**通过率：5/9 完整 + 2/9 部分 = 约 67%**

---

## 6. 缺口

| 缺口 | 具体表现 | 影响 |
|------|---------|------|
| GAP-01 — 作者友好的文案映射 | gate 名（`action_scope`）、reason_code 为英文 atom | 作者看不懂"为什么被拒" |
| GAP-02 — 脱敏内容隔离 | author_safe 和 developer 视图用同一份数据 | 敏感信息可能泄露给作者 |
| GAP-03 — state_explanations 硬编码 | 不区分"作者没采纳"和"系统拦截了" | 回放无法解释 adoption boundary 的真实决策 |
| GAP-04 — ReplayReport 不回答全部 6 个问题 | VS-06 §5 要求回答 6 个问题，当前只覆盖 3 个 | 回放的完整性不够 |
| GAP-05 — ToolTrace/BehaviorTrace 未接入 Replay | ReplayService 只处理 DecisionTrace | 工具调用和行为生命周期的回放缺失 |
| GAP-06 — developer summary 与 author-safe 无隔离层 | 同一份 report 用于两个视图 | 开发者视图可暴露比作者视图更多的信息，但目前无差异 |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/replay_service_test.exs
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
```
