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
| 聊到一半 AI 服务断了 | 系统告诉我"暂时连不上"，不白屏不 crash |

明确不能做的（本验收不覆盖）：
- 让 AI 生成大纲或章节（→ AU-05）
- 让 AI 替我做决定并执行（→ AU-04）
- AI 主动追问缺失信息（→ AU-06）

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #1 | 每 turn 必有 frame | A1、A2 — 每轮对话都产生 DialogueFrame |
| #9 | TurnResult 是 canonical 输出 | B1-B4 — 不谎报，assistant_message 与 frame 一致 |
| #14 | replay 默认不重新调用 LLM | — trace 记录 `replay_policy.recall_provider=false` |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0001 | DialogueFrame v3 定义 |
| VS-00 Contract Pack §2 | DialogueFrame reply-only schema + forbidden semantics |
| VS-00 Contract Pack §3 | DecisionTrace 最小 shape |
| VS-00 Contract Pack §4 | TurnResult truthfulness 规则 |
| VS-00 Implementation Plan §8 | Safe Fallback 策略 |

---

## 4. 验收场景

### 场景组 A：基础对话

#### A1 — 发起创作讨论

**作为作者**，我打开工作台，输入一段创作想法。AI 给我一个自然的文字回应，读起来像写作伙伴在聊天。

**验证点**：
- [ ] 收到 assistant 消息
- [ ] 消息读起来像自然对话，不是表单或模板
- [ ] `frame.frame_type` 是有效的 frame_type（`casual_reply` 等）
- [ ] `trace.decision_type == :reply_only`

**测试**：`dialogue_gateway_test.exs` — `"produces primary DialogueFrame"` ✅

---

#### A2 — 连续聊多轮，不串话

**作为作者**，我连续发了 3 条消息。每条消息 AI 独立回应。第 2 轮的回应能体现对第 1 轮的理解，但不会串到第 3 轮。

**验证点**：
- [ ] 每条消息产生独立的 `turn_id`、`frame_ref`、trace
- [ ] 后一轮不覆盖前一轮的 TurnResult

**测试**：`dialogue_gateway_test.exs` — `"every turn produces frame ref"` ✅

---

#### A3 — 发了空消息

**作为作者**，我不小心发了空消息。系统明确告诉我不能为空，不会崩溃。

**验证点**：
- [ ] 返回 `{:error, "text is required"}`
- [ ] Channel 层返回明确的 error reply

**测试**：`dialogue_gateway_test.exs` — `"empty text returns error"` ✅

---

### 场景组 B：系统诚实——不谎报

#### B1 — 纯聊天时不会谎称"我帮你写了东西"

**作为作者**，我只是在聊方向。AI 不能声称它调用了工具或写入了内容。

**验证点**：
- [ ] `turn_result.truthfulness.tool_called == false`
- [ ] `turn_result.truthfulness.production_write_performed == false`
- [ ] 回应文本中不含"已生成"、"已写入"、"已修改"

**测试**：`dialogue_gateway_test.exs` — `"does not claim tool/adoption/write/behavior"` ✅

**为什么重要**：如果系统谎称调了工具，界面会展示假的"工具结果"卡片，作者会被误导。

---

#### B2 — 纯聊天时不会谎称"我帮你改了设定"

**作为作者**，我没有要 AI 改设定。系统诚实记录"本轮没有采纳、没有写入"。

**验证点**：
- [ ] `artifact_adopted == false`
- [ ] `durable_behavior_opened == false`

---

#### B3 — 讨论请求不产生执行计划

**作为作者**，我问"应该更悬疑还是更温柔"。这是一个讨论请求，AI 只给我分析意见，不产生 MicroPlan。

**验证点**：
- [ ] TurnResult 中不存在 `:micro_plan` 字段
- [ ] `generate_micro_plan = false` → `handle_reply_only` 路径

**测试**：`dialogue_gateway_test.exs` — `"does not produce MicroPlan"` ✅

---

#### B4 — AI 说的和系统记录的一致

**作为作者**，AI 回复的文字必须和 Planner 产生的 frame draft 一致。

**验证点**：
- [ ] `turn_result.assistant_message.text` == `frame.author_visible_draft.message`
- [ ] interaction_recorder 中 assistant entry 的 content.text 与以上一致

**测试**：`dialogue_gateway_test.exs` — interaction recorder 断言 ✅

---

### 场景组 C：AI 掉线也能优雅处理

#### C1 — AI 服务不可用

**作为作者**，AI 服务突然不可用了。系统不崩溃、不白屏，而是给我一个诚实提示："抱歉，我现在无法连接到创作引擎。请稍后再试。"

**验证点**：
- [ ] Planner LLM 调用失败 → `fallback_frame/4` 生成 safe fallback
- [ ] fallback frame 中 `frame_type = :casual_reply`、`needs_tool = false`
- [ ] fallback message 为预设降级提示
- [ ] `evidence_summary.fallback = true`
- [ ] 系统不 crash，正常返回 TurnResult

**当前实现**：`planner.ex:42-43` — `{:error, _reason} -> {fallback_frame(...), []}` ✅。**但无独立测试** ❌

---

#### C2 — AI 返回了乱码

**作为作者**，AI 返回了无法解析的乱码。系统不把乱码直接展示给我，而是内部重试解析，失败后降级处理。

**验证点**：
- [ ] 第一次 JSON 解析失败 → `parse_json_retry` 重试
- [ ] 重试仍失败 → 返回 `{:error, reason}` → `fallback_frame`
- [ ] 降级消息清晰可用，不暴露 raw LLM 输出

**当前实现**：`planner.ex:147` — `parse_json_retry` ✅。**但无独立测试** ❌

---

#### C3 — frame 校验不通过也不 crash

**作为作者**，AI 产出的 frame 包含禁止语义（如 "approved"）。系统拦截这个 frame，返回错误提示，而不是假装正常。

**验证点**：
- [ ] `DialogueFrame.validate(frame)` 返回 `{:error, reasons}` → Channel 返回 error
- [ ] error 中包含明确的 reasons 列表
- [ ] 后续消息不受影响（Channel 不因为一次 frame 校验失败而断开）

**测试**：`dialogue_gateway_test.exs` — `"DialogueFrame validation rejects forbidden semantics"` ✅

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 发起创作讨论 | ✅ |
| A2 | 连续聊多轮 | ✅ |
| A3 | 发了空消息 | ✅ |
| B1 | 不谎称写了东西 | ✅ |
| B2 | 不谎称改了设定 | ✅ |
| B3 | 不产生执行计划 | ✅ |
| B4 | AI 说的和记录一致 | ✅ |
| C1 | AI 不可用降级 | ⚠️ 有实现无测试 |
| C2 | AI 乱码降级 | ⚠️ 有实现无测试 |
| C3 | frame 校验不通过 | ✅ |

**通过率：8/10 完整 + 2/10 部分 = 约 90%**

---

## 6. 缺口

| 缺口 | 场景 | 当前状态 | 建议处理 |
|------|------|---------|---------|
| GAP-01 | C1 — AI 不可用 | 代码有 `fallback_frame/4` 但无测试 | 传 `broken_fn` → 验证返回 fallback frame |
| GAP-02 | C2 — AI 乱码 | 代码有 `parse_json_retry` 但无测试 | 用返回 garbage 的 stub provider → 验证 retry + fallback |
| GAP-03 | error 消息暴露给作者 | frame validation 失败返回 `"frame validation failed: ..."` 原文 | 映射为作者友好的提示，不暴露内部 reason 原文 |

---

## 7. 已知限制

当前测试使用 stub provider（返回固定 frame JSON）。B1-B4 的真值保证验证的是"stub 不会说谎"。C1-C2 的降级路径有代码实现但无专门测试。完整降级场景需 VS-08 端到端集成时用 real LLM 或 broken_fn 覆盖。

---

## 8. 验收命令

```bash
mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs
```
