# AU-03 AI 了解我的作品

> 作者视角：AI 了解我当前作品的设定、角色和进度，能给出有上下文的建议。但当它不了解某些信息时，应该诚实告诉我，而不是瞎编。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 聊到主角时 AI 知道名字和设定 | AI 回应中用到正确的作品信息 |
| 问"主角现在在哪" | AI 根据当前章节给出准确回答 |
| 在新建的空作品里问"主角怎么样" | AI 诚实说"我还不了解你的作品" |
| 看 AI 用了哪些上下文 | trace 记录引用了哪些信息来源 |

明确不能做的：
- AI 不能装作了解实际不存在的信息
- AI 不能编造主角名、作品设定、章节进度

---

## 2. 验收场景

### 场景组 A：有上下文时

#### A1 — AI 基于作品信息给建议

**作为作者**，我的作品《灵源纪元》已有设定——主角叫林烬、赛博修仙世界观、写到第三章霓虹地牢。当我问"把主角动机改得更狠一点"，AI 应该知道林烬是谁，给出针对性的建议。

```
作品上下文:
  作品: 《灵源纪元》
  类型: 赛博修仙
  主角: 林烬
  当前: 第三章 霓虹地牢
  世界观: 2077年灵气被垄断

作者: "把主角动机改得更狠一点。"
AI: "林烬找妹妹的动机可以从'亲情'升级为'赎罪'——
     如果当初是他把妹妹带进了灵源矿区..."
```

**验证点**：
- [ ] AI 回应引用了主角名
- [ ] trace 记录了本轮使用了哪些上下文引用（`context_refs`）
- [ ] Planner 接收的是组装好的 DialogueContext，不直接访问数据层

**测试**：`context_grounding_test.exs` — `"with context, trace records context_refs"` ✅
**测试**：`context_grounding_test.exs` — `"Planner receives assembled context, not raw Repo access"` ✅

---

#### A2 — AI 基于章节进度回答位置问题

**作为作者**，我问"主角现在在哪里？"，AI 能根据当前章节信息准确回答。

**验证点**：
- [ ] 回应包含正确的章节位置信息
- [ ] 回应不包含作品中不存在的事実

**测试**：`context_grounding_test.exs` — `"with context, frame records dialogue_context_ref"` ✅

---

### 场景组 B：无上下文时

#### B1 — 无上下文时 AI 诚实说不知道

**作为作者**，我在一个空作品（没有设定、没有章节）里问"主角现在在哪里？"。AI 应该诚实说还不了解作品，而不是编造。

**验证点**：
- [ ] AI 不编造主角名
- [ ] AI 不编造作品设定
- [ ] AI 不编造章节进度
- [ ] AI 可以说明不知道、请求作者给现状、或给出标注为"假设"的通用建议

**测试**：`context_grounding_test.exs` — `"without context, TurnResult does not fabricate work facts"` ✅（验证回应不含"林烬"、"灵源纪元"等编造信息）

---

#### B2 — 无上下文时 trace 诚实记录

**作为作者**，空作品的第一轮对话，trace 应该明确记录"本轮无上下文"，而不是假装有。

**验证点**：
- [ ] `trace.event_order` 中包含 `:dialogue_context_empty`
- [ ] `DialogueContext.has_context?(ctx)` 返回 `false`

**测试**：`context_grounding_test.exs` — `"without context, trace records empty context event"` ✅
**测试**：`context_grounding_test.exs` — `"assembles empty context correctly"` ✅

---

### 场景组 C：上下文组装

#### C1 — 上下文来自多个来源

**作为作者**，AI 的回应综合了我的作品快照、最近对话摘要和记忆片段。每个来源都有据可查。

**验证点**：
- [ ] 上下文包含作品快照（`current_work_snapshot`）
- [ ] 上下文包含对话摘要（`conversation_summary`）
- [ ] 上下文包含记忆摘要（`memory_summary`）
- [ ] 每个片段有对应的 `context_ref`

**测试**：`context_grounding_test.exs` — `"assembles context from fetcher"` ✅

---

#### C2 — 上下文文本化后 Planner 可用

**作为作者**，组装好的上下文被转成 Planner 可读的 prompt 文本，作为 LLM 输入的一部分。

**验证点**：
- [ ] prompt 文本包含作品名和主角信息
- [ ] prompt 文本包含对话摘要
- [ ] 空上下文时 prompt 文本显示"（无）"
- [ ] Planner 不直接调用 Repo 获取上下文

**测试**：`context_grounding_test.exs` — `"to_prompt_text includes all non-nil sections"` ✅
**测试**：`context_grounding_test.exs` — `"to_prompt_text with empty context shows (无)"` ✅
**测试**：`context_grounding_test.exs` — `"Planner with nil context produces frame without context_ref"` ✅

---

## 3. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 有上下文时基于作品信息给建议 | ✅ 有测试 |
| A2 | 基于章节进度回答位置问题 | ✅ 有测试 |
| B1 | 无上下文时诚实说不知道 | ✅ 有测试 |
| B2 | 无上下文时 trace 诚实记录 | ✅ 有测试 |
| C1 | 上下文多来源组装 | ✅ 有测试 |
| C2 | 上下文转 prompt 文本 | ✅ 有测试 |

**通过率：6/6（100%）**

---

## 4. 验收命令

```bash
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
```

---

## 5. 已知限制

当前上下文由 stub fetcher 提供，真实作品快照（从 persistence 读取当前小说数据）待 VS-08 端到端集成时接入。本验收证明的是"有上下文时 AI 会用、无上下文时 AI 不编造"这个行为契约，不依赖真实数据。
