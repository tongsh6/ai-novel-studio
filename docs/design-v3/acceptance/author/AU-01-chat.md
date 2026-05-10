# AU-01 与 AI 聊创作

> 作者视角：我可以像和一个懂创作的写作伙伴聊天一样，讨论我的故事创意、风格、角色。AI 会自然回应，不会偷偷替我写东西、改设定或者假装做了什么。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 聊聊故事开头的气质 | AI 给出自然的讨论回应，像写作伙伴 |
| 问"应该更悬疑还是更温柔" | AI 帮我分析，但不替我决定也不改正文 |
| 连续聊多轮 | 每轮独立回应，不会串话 |
| 发空消息 | 系统告诉我"请输入内容"，不会崩溃 |

明确不能做的（本验收不覆盖）：
- 让 AI 生成大纲或章节（→ AU-05）
- 让 AI 替我做决定并执行（→ AU-04）
- AI 主动追问缺失信息（→ AU-06）

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #1 | 每 turn 必有 frame | A1、A2 — 每轮对话产生 DialogueFrame |
| #9 | TurnResult 是 canonical 输出 | B1、B4 — 不谎报，assistant_message 与 frame 一致 |
| #14 | replay 默认不重新调用 LLM | — （trace 记录 replay_policy.recall_provider=false） |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0001 | DialogueFrame v3 定义 |
| VS-00 Contract Pack §2 | DialogueFrame reply-only schema |
| VS-00 Contract Pack §2.3 | Forbidden Semantics |
| VS-00 Contract Pack §3 | DecisionTrace 最小 shape |
| VS-00 Contract Pack §4 | TurnResult truthfulness 规则 |
| VS-00 Contract Pack §5 | Proof 草案（6 条） |
| VS-00 Implementation Plan §6 | 4 个 contract test |
| VS-00 Implementation Plan §8 | Safe Fallback 策略 |

---

## 4. 验收场景

### 场景组 A：基础对话

#### A1 — 发起创作讨论

**作为作者**，我打开工作台，输入一段创作想法。
**系统应该**给我一个自然的文字回应。

```
作者输入: "我想聊聊这个故事开头的气质，先别写正文。"
系统回应: 一段自然的中文讨论回应
```

**验证点**：
- [ ] 我收到了一条 assistant 消息
- [ ] 这条消息读起来像人在聊天，不是表单或模板

**测试**：`dialogue_gateway_test.exs` — `"produces primary DialogueFrame"` ✅

---

#### A2 — 连续聊多轮

**作为作者**，我在同一个工作区连续发 3 条消息。
**系统应该**每条消息独立回应，不会串话。

```
第1轮: "我想写赛博修仙" → 回应A
第2轮: "这个方向有什么问题吗？" → 回应B  （基于第1轮上下文）
第3轮: "那帮我分析一下市场" → 回应C
```

**验证点**：
- [ ] 3 个回应互不相同
- [ ] 第2轮回应能体现对第1轮的理解
- [ ] 没有出现"第1轮的回应出现在第3轮"这种串话

**测试**：`dialogue_gateway_test.exs` — `"every turn produces frame ref"` ✅

---

#### A3 — 发了空消息

**作为作者**，我不小心发了空消息。
**系统应该**明确告诉我不能为空，不会崩溃或假装处理了。

**验证点**：
- [ ] 返回明确错误提示
- [ ] 系统没有 crash

**测试**：`dialogue_gateway_test.exs` — `"empty text returns error"` ✅

---

### 场景组 B：系统诚实

#### B1 — 纯聊天时不会谎称"我帮你写了东西"

**作为作者**，我只是在聊方向、没有要求 AI 写任何东西。
**系统应该**诚实地说"本轮没有执行任何工具/写入"。

```
作者输入: "先聊方向不写正文，纯交流"
系统回应: 自然讨论回应
```

**验证点**：
- [ ] 回应中不包含"已生成"、"已写入"、"已修改"等谎报
- [ ] 系统内部记录中 `tool_called = false`
- [ ] 系统内部记录中 `production_write_performed = false`

**测试**：`dialogue_gateway_test.exs` — `"does not claim tool/adoption/write/behavior"` ✅

**为什么重要**：如果系统谎称调了工具，界面会展示假的"工具结果"卡片，作者会被误导。

---

#### B2 — 纯聊天时不会谎称"我帮你改了设定"

**作为作者**，我没有要 AI 改任何小说设定。
**系统应该**诚实记录"本轮没有采纳任何产出、没有写入任何 production state"。

**验证点**：
- [ ] `artifact_adopted = false`
- [ ] `durable_behavior_opened = false`

**测试**：`dialogue_gateway_test.exs` — `"does not claim tool/adoption/write/behavior"` ✅（同 B1）

---

#### B3 — 纯聊天时不会凭空产生执行计划

**作为作者**，我说"帮我判断应该更悬疑还是更温柔"，这是一个讨论请求。
**系统应该**只给我分析意见，不产生多步执行计划。

**验证点**：
- [ ] 系统内部不产生 MicroPlan

**测试**：`dialogue_gateway_test.exs` — `"does not produce MicroPlan"` ✅

---

#### B4 — AI 说的和系统记录的一致

**作为作者**，我看到 AI 的回复文字。
**系统应该**确保这段文字和内部 frame draft 一致，不是凭空编造的。

**验证点**：
- [ ] `assistant_message.text` 和 Planner 产生的 `author_visible_draft.message` 一致

**测试**：`dialogue_gateway_test.exs` — interaction recorder 断言 ✅

---

### 场景组 C：AI 掉线了也能处理

#### C1 — AI 服务不可用时优雅降级

**作为作者**，我正在聊天，但后端的 AI 服务（LLM）突然不可用了。
**系统应该**给我一个诚实的降级提示。

**验证点**：
- [ ] 系统不崩溃，仍然返回回应
- [ ] 回应内容是预设的降级提示（如 "抱歉，我现在无法连接到创作引擎。请稍后再试。"）
- [ ] 不会谎称调用了工具或写入了内容

**当前状态**：❌ 无独立测试

---

#### C2 — AI 返回了乱码

**作为作者**，AI 服务返回了一些无法理解的乱码。
**系统应该**内部降级处理，不把乱码直接展示给我。

**验证点**：
- [ ] 不向作者暴露原始 LLM 输出
- [ ] 降级提示清晰可用
- [ ] 系统记录了解析失败的原因（供开发者排查）

**当前状态**：❌ 无测试

---

### 场景组 D：系统不会越权

#### D1 — LLM 企图在回应中夹带"批准执行"的指令

**作为作者**，我不知道的是，LLM 有时会在回应文本中夹带不该出现的词（如 "approved"、"ready_to_execute"）。系统拦截这些情况。

**验证点**：
- [ ] 包含 `"approved"` 的 frame 被拒绝
- [ ] 包含 `"ready_to_execute"` 的 frame 被拒绝
- [ ] 包含 `"production_write_allowed"` 的 frame 被拒绝
- [ ] 拦截理由明确记录在 validation error 中

**测试**：`dialogue_gateway_test.exs` — `"DialogueFrame validation rejects forbidden semantics"` ✅

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 发起创作讨论 | ✅ 有测试 |
| A2 | 连续聊多轮 | ✅ 有测试 |
| A3 | 发了空消息 | ✅ 有测试 |
| B1 | 不谎称写了东西 | ✅ 有测试 |
| B2 | 不谎称改了设定 | ✅ 有测试 |
| B3 | 不凭空产生执行计划 | ✅ 有测试 |
| B4 | AI 说的和记录一致 | ✅ 有测试 |
| C1 | AI 掉线时优雅降级 | ❌ 缺测试 |
| C2 | AI 返回乱码时降级 | ❌ 缺测试 |
| D1 | 拦截越权回应 | ✅ 有测试 |

**通过率：8/10（80%）**

---

## 6. 缺口

| 缺口 | 场景 | 建议处理 |
|------|------|---------|
| GAP-01 | C1 — AI 不可用 | 传 `broken_fn` 作为 `complete_fn`，验证返回降级 frame |
| GAP-02 | C2 — AI 返回乱码 | 用返回 garbage 的 stub provider 测 JSON 解析防御 |

---

## 7. 已知限制

当前测试使用 stub provider（返回固定 frame JSON），B1-B4 的真值保证验证的是"stub 不会说谎"。完整场景（真实 LLM 可能产生包含禁止语义的输出）需 real LLM → VS-08 端到端集成时覆盖。

---

## 8. 验收命令

```bash
mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs
```
