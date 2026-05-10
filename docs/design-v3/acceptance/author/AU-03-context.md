# AU-03 AI 了解我的作品

> 作者视角：AI 了解我当前作品的设定、角色和进度，能给出有上下文的建议。当它不了解某些信息时，应该诚实告诉我，而不是瞎编。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 聊到主角时 AI 知道名字和设定 | AI 回应中用到正确的作品信息 |
| 问"主角现在在哪" | AI 根据当前章节给出准确回答 |
| 在新建的空作品里问"主角怎么样" | AI 诚实说"我还不了解你的作品" |
| 连续对话多轮 | AI 记住前几轮聊了什么 |
| 看看 AI 引用了哪些信息 | 能看到 AI 是基于什么给出建议的 |

明确不能做的：
- AI 不能装作了解实际不存在的信息
- AI 不能编造主角名、作品设定、章节进度

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #1 | 每 turn 必有 frame | A1 — 有上下文时也正常产生 frame |
| #8 | 缺 slot 不自动等于表单 | B1 — 无上下文时诚实，不编造 |
| #13 | trace summary 脱敏 | D2 — 来源引用可追溯，不入作者可见区 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0001 | DialogueFrame 必须支持 context ref 绑定 |
| ADR-0013 | trace 脱敏与上下文引用 |
| VS-00B Contract Pack §2 | DialogueContext 最小来源集合（4 类来源） |
| VS-00B Contract Pack §3 | Context Refs 与 Trace 绑定 |
| VS-00B Contract Pack §4 | 无上下文时不编造事实 |
| VS-00B Contract Pack §5 | Proof 草案 |

---

## 4. 验收场景

### 场景组 A：有上下文时的对话

#### A1 — AI 知道我的作品和角色

**作为作者**，我的《灵源纪元》里主角叫林烬，写到第三章霓虹地牢。我问"把主角动机改得更狠一点"。AI 的回应里提到了林烬的名字和当前处境，给出的建议切合我的故事。我打开决策详情，能看到引用了"当前作品上下文"和"最近对话"。

**验证点**（字段级——系统内部保证，作者不直接看到）：
- [ ] `current_work_snapshot` 来自 Workspace 表，包含 `name` 和 `description`
- [ ] `conversation_summary` 来自 Interaction 表，最近几轮对话的文本
- [ ] `context_refs` 中每条非 nil 来源对应一条 `ContextSourceRef`
- [ ] Planner 只接收组装好的 `DialogueContext`，不直接查数据库

**测试**：`context_grounding_test.exs` — `"with context, trace records context_refs"` ✅、`"Planner receives assembled context, not raw Repo access"` ✅

---

#### A2 — 聊天内容跨轮记忆

**作为作者**，第 1 轮我告诉 AI "我叫林烬，是个剑修"→ 第 2 轮我问"记得我叫什么吗？"→ AI 回答"林烬，你是剑修"。我能看到 AI 记住了上一轮的内容。

**验证点**：
- [ ] 第 1 轮后 Interaction 表有 2 条记录（user + assistant）
- [ ] 第 2 轮的 `conversation_summary` 包含第 1 轮内容
- [ ] 第 2 轮 Planner prompt 包含对话历史段

**测试**：`dialogue_gateway_real_loop_test.exs`（tag: `:integration`，需 SQLite3）✅

---

#### A3 — 我的伏笔和设定 AI 也能引用

**作为作者**，我之前确认了一条伏笔"林烬的妹妹林瑶失踪"。下一轮我问"林烬为什么要冒险"，AI 在回答中引用了这条伏笔。这说明 AI 不只是记住聊天内容，还能引用我确认过的设定。

**验证点**：
- [ ] `memory_summary` 来自记忆召回（`recallMemories`），非 nil
- [ ] `to_prompt_text` 输出包含 `"## 相关记忆"` 段
- [ ] **当前实现：`workspace_context.ex:27` 的 `memory_summary` 写死为 nil** ❌

---

#### A4 — 聊了很多轮后 AI 不会忘掉最近的对话

**作为作者**，我和 AI 聊了 30 轮关于角色设定的讨论。第 31 轮我问"那林烬的武器是什么"，AI 仍然能回答出最近的设定。即使它不可能记住全部 30 轮，至少最近几轮不能丢。

**验证点**：
- [ ] `conversation_summary` 取最近 N 轮（当前 `limit: 10`）
- [ ] prompt 总长度在合理范围内，不会无限增长
- [ ] 截断后最近的对话仍然连贯

---

### 场景组 B：无上下文或信息不全时

#### B1 — 新作品里 AI 诚实说不知道

**作为作者**，我新建了一个空作品，还没写任何设定。我问"主角现在在哪里？"AI 诚实地说还不了解我的作品，而不是编造一个地名。

**验证点**：
- [ ] AI 回应不含虚构的主角名、地名、情节
- [ ] `has_context?` 返回 false
- [ ] trace 记录 `:dialogue_context_empty`

**测试**：`context_grounding_test.exs` — `"without context, TurnResult does not fabricate work facts"` ✅、`"without context, trace records empty context event"` ✅

---

#### B2 — 有作品设定但还没聊过天

**作为作者**，我的作品有基本设定（名字、类型），但还没开始和 AI 对话，也没有确认过任何伏笔。我问"这个类型适合什么开头"，AI 基于已有的作品信息给了我建议，但没有假装之前聊过。

**验证点**：
- [ ] snapshot 有值 → AI 回应引用作品信息
- [ ] conversation_summary = nil → AI 不说"根据我们之前的讨论"
- [ ] memory_summary = nil → AI 不引用不存在的记忆
- [ ] `context_refs` 只有 1 条（对应 snapshot）

**当前覆盖**：❌ 无 partial context 测试。stub fetcher 只有全给或全空。

---

### 场景组 C：溯源透明度

#### C1 — 看看 AI 引用了什么

**作为作者**，AI 告诉我"林烬应该从亲情线切入"。我想确认这个建议是基于我的设定还是它自己编的。我查看决策详情，能看到 AI 用了哪些信息来源——是引用了作品设定、最近的对话、还是我确认过的伏笔。

**验证点**：
- [ ] 每条 context 来源有 `source_type`（`current_work` / `conversation` / `memory` / `behavior`）
- [ ] 每个来源有唯一 ID
- [ ] **当前实现：`ContextSourceRef.summary` 是占位文本 `"context from memory"`，不是实际摘要** ❌

**测试**：`context_grounding_test.exs` — `"every turn with context has distinct context refs"` ✅

---

#### C2 — 敏感信息不出现在可看的摘要里

**作为作者**，我看到的决策摘要里不应该出现系统内部的原始 prompt、其他人的数据、或者标为敏感的内容。

**验证点**：
- [ ] author-safe 摘要不含 raw LLM prompt
- [ ] author-safe 摘要不含敏感记忆原文
- [ ] `redaction_level = :author_safe` 的 ref 不出现在 developer 专属区域

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | AI 知道作品和角色 | ✅ |
| A2 | 聊天内容跨轮记忆 | ✅（integration tag） |
| A3 | 伏笔和设定被 AI 引用 | ❌ memory_summary 未接入 |
| A4 | 聊多了不会忘 | ⚠️ limit 硬编码 10 |
| B1 | 新作品诚实说不知道 | ✅ |
| B2 | 有设定但无聊天历史 | ❌ 无 partial context 测试 |
| C1 | 看 AI 引用了什么 | ⚠️ ref summary 占位文本 |
| C2 | 敏感信息不暴露 | ⚠️ 无专门测试 |

**通过率：3/8 完整 + 3/8 部分 = 约 56%**

---

## 6. 缺口

| 缺口 | 具体表现 | 影响 |
|------|---------|------|
| GAP-01 — memory_summary 未接入 | `workspace_context.ex:27` 返回 nil | AI 无法基于记忆（伏笔、规则）给建议 |
| GAP-02 — behavior_summary 未接入 | `workspace_context.ex:27` 返回 nil | 有 open behavior 时 AI 不知道"在等作者" |
| GAP-03 — ContextSourceRef.summary 占位 | `context_assembler.ex:53` 写死文本 | trace 中看不到实际引用了什么 |
| GAP-04 — workspace_id 匹配字段 | `where: w.name == ^workspace_id` | Channel 传 UUID 但查 name → 可能查不到 |
| GAP-05 — conversation limit 硬编码 | `limit: 10` | 长篇对话可能不够 |
| GAP-06 — fetcher 异常无保护 | DB 挂了 → crash | 单次 DB 故障不该阻断对话 |
| GAP-07 — 部分上下文无测试 | stub 只有全给/全空 | 混合 nil/非 nil 的 prompt 拼接未验证 |

---

## 7. 已知限制

当前上下文由 stub fetcher 提供，真实作品快照待 VS-08 端到端集成时接入。本验收证明的是"有上下文时 AI 会用、无上下文时 AI 不编造"这个行为契约。

---

## 8. 验收命令

```bash
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs
```
