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
| 看 AI 用了哪些上下文 | trace 记录引用了哪些信息来源 |

明确不能做的：
- AI 不能装作了解实际不存在的信息
- AI 不能编造主角名、作品设定、章节进度

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #1 | 每 turn 必有 frame | A1 — grounded turn 也必须有 primary frame |
| #8 | 缺 slot 不自动等于表单 | B1 — 无上下文时诚实，不编造 |
| #13 | trace summary 脱敏 | D2 — context_ref 来源可追溯，不入作者可见区 |

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

### 场景组 A：上下文组装管线

#### A1 — fetcher 返回四个来源的正确性

**作为作者**，我不知道的是，每次我发消息时系统会调用 `context_fetcher` 回调从数据库拉取四类上下文。

**fetcher 契约**（`context_fetcher/0` 必须返回的 5 元组）：
```
(workspace_id) -> {:ok, snapshot, conv_summary, mem_summary, behavior_summary}
```

**验证点**：
- [ ] `current_work_snapshot`：来自 Workspace 表查询，返回 `%{name:, description:}` 或 `nil`
- [ ] `conversation_summary`：来自 Interaction 表，最近 N 轮对话的 `"role: text"` 文本
- [ ] `memory_summary`：来自记忆召回（`recallMemories`），**当前实现返回 nil — 这是 GAP**
- [ ] `open_behavior_summary`：当前是否有未关闭的 BehaviorState，**当前实现返回 nil — 这是 GAP**
- [ ] fetcher 查询失败时不应 crash，应返回 `{:ok, nil, nil, nil, nil}` 并记录 warning

**当前实现**：`workspace_context.ex:27` — `{:ok, snapshot, conv_summary, nil, nil}`。memory 和 behavior 未接入。❌

**测试**：`context_grounding_test.exs` — `"assembles context from fetcher"` ✅（验证 stub 路径）

---

#### A2 — workspace_id 匹配的正确性

**作为作者**，我的 workspace 在 Channel topic 中是 `"workspace:my-novel"`。系统用这个 ID 去查 DB 时必须匹配正确的字段。

**验证点**：
- [ ] Channel 中的 `workspace_id` (= `suffix`) 与 DB 查询字段一致
- [ ] 如果 DB 中用 `name` 字段匹配，Channel 传入的 `suffix` 必须是 workspace 的 `name`，不是 `id`
- [ ] Workspace 不存在时 `current_work_snapshot` 返回 `nil`，不 crash

**当前实现**：`workspace_context.ex:63-64` — `where: w.name == ^workspace_id`。用 `name` 字段匹配而非 `id`。需确认 Channel 传入的是 name 而非 UUID。⚠️ 待验证

---

#### A3 — ContextAssembler 组装完整性

**作为作者**，fetcher 返回的四类原始数据经过 `ContextAssembler.assemble/2` 组装成 `DialogueContext` struct。

**DialogueContext 字段级验证**：
| 字段 | 来源 | 缺失时的行为 |
|------|------|------------|
| `workspace_id` | 直接传入 | 必填，不可为 nil |
| `current_work_snapshot` | fetcher 第1元素 | nil → has_context? 不依赖此项 |
| `conversation_summary` | fetcher 第2元素 | nil → prompt 中省略此段 |
| `memory_summary` | fetcher 第3元素 | nil → prompt 中省略此段 |
| `open_behavior_summary` | fetcher 第4元素 | nil → prompt 中省略此段 |
| `context_refs` | `build_refs/4` | 每个非 nil 来源产生一个 `ContextSourceRef` |
| `assembled_at` | `DateTime.utc_now()` | 必填 |

**验证点**：
- [ ] 每个非 nil 来源对应一条 `ContextSourceRef`（source_type 分别为 `:current_work`、`:conversation`、`:memory`、`:behavior`）
- [ ] `ContextSourceRef.summary` 包含实际内容摘要，**当前实现为占位文本 `"context from memory"` — 这是 GAP**
- [ ] `context_refs` 中每个 ref 有唯一的 `context_ref` ID
- [ ] 空上下文时 `context_refs == []` 且 `has_context? == false`

**测试**：`context_grounding_test.exs` — `"assembles context from fetcher"` ✅、`"assembles empty context correctly"` ✅、`"has_context? returns true when snapshot exists"` ✅

---

#### A4 — Planner 接收边界

**作为作者**，组装好的 `DialogueContext` 通过 `Planner.form_frame/3` 传给 LLM。Planner 不直接访问 Repo。

**验证点**：
- [ ] `Planner.form_frame` 的参数包含 `%DialogueContext{}` struct（不是 raw map 或 Repo query）
- [ ] Planner 通过 `DialogueContext.to_prompt_text/1` 将上下文转为 prompt 文本
- [ ] `frame.source_refs.dialogue_context_ref` 非空（有上下文时）或为 nil（无上下文时）
- [ ] `evidence_summary.context_used == true`（有上下文时）

**测试**：`context_grounding_test.exs` — `"Planner receives assembled context, not raw Repo access"` ✅、`"Planner with nil context produces frame without context_ref"` ✅

---

### 场景组 B：有上下文时

#### B1 — 四类上下文逐类验证

**作为作者**，我的作品《灵源纪元》已有设定。本轮对话应该用到以下上下文：

```
1. current_work_snapshot: %{name: "灵源纪元", description: "赛博修仙"}
   → prompt: "## 当前作品上下文\n- name: 灵源纪元\n- description: 赛博修仙"

2. conversation_summary: "user: 林烬需要一个动机\nassistant: 可以从亲情线切入..."
   → prompt: "## 最近对话\nuser: 林烬需要一个动机\nassistant: 可以从亲情线切入..."

3. memory_summary: 从 recallMemories 结果构建
   → prompt: "## 相关记忆\n- 伏笔: 林烬的妹妹林瑶失踪\n- 设定: 灵气被垄断为能源"

4. open_behavior_summary: nil（当前无等待中的行为）
   → prompt: 省略此段
```

**验证点**：
- [ ] 每类非 nil 上下文在 `to_prompt_text` 中有对应的 `##` 标题段
- [ ] 作品上下文段包含 `name` 和 `description`
- [ ] 对话摘要段包含最近几轮的 `role: text` 行
- [ ] 记忆段包含从记忆召回中提取的相关项
- [ ] `memory_summary` 不为 nil 但为空时（无相关记忆），prompt 中显示"## 相关记忆\n（无相关记忆）"而非省略

**测试**：`context_grounding_test.exs` — `"to_prompt_text includes all non-nil sections"` ✅

---

#### B2 — 对话历史跨轮延续

**作为作者**，第 1 轮我告诉 AI "我叫林烬"→ 第 2 轮我问"记得我叫什么吗"→ AI 回答"林烬"。

**跨轮数据流**：
```
Turn 1:
  handle_input → interaction_recorder 写入 Interaction 表:
    {role: "user", content: %{text: "我叫林烬"}}
    {role: "assistant", content: %{text: "你好林烬..."}}
  
Turn 2:
  context_fetcher 从 Interaction 表读取最近 10 条:
    "user: 我叫林烬\nassistant: 你好林烬..."
  → ContextAssembler → Planner → AI 回应引用"林烬"
```

**验证点**：
- [ ] Turn 1 后 Interaction 表中有 2 条记录（user + assistant）
- [ ] Turn 2 的 `conversation_summary` 包含 Turn 1 的内容
- [ ] Turn 2 的 Planner prompt 包含对话历史段
- [ ] Turn 2 的 AI 回应能引用 Turn 1 的信息

**测试**：`dialogue_gateway_real_loop_test.exs`（tag: `:integration`，需 SQLite3）✅

---

#### B3 — 对话历史截断

**作为作者**，我和 AI 聊了 50 轮。系统只取最近 N 轮作为上下文，不会无限增长 prompt。

**验证点**：
- [ ] `conversation_summary` 只包含最近 N 轮（当前 N=10）
- [ ] prompt 总长度在 token 预算内
- [ ] 截断不影响最近的对话连贯性
- [ ] N 可配置

---

### 场景组 C：无上下文或部分上下文

#### C1 — 无上下文时诚实

**作为作者**，空作品的第一轮对话。所有四个上下文来源都是 nil。

**每个来源为 nil 时的行为**：
| 来源 | prompt 输出 |
|------|-----------|
| `current_work_snapshot = nil` | `"（无——这是新对话或尚未创建作品）"` |
| `conversation_summary = nil` | 省略此段 |
| `memory_summary = nil` | 省略此段 |
| `open_behavior_summary = nil` | 省略此段 |

**验证点**：
- [ ] AI 不编造任何作品信息
- [ ] `has_context?` 返回 false
- [ ] `trace.event_order` 包含 `:dialogue_context_empty`

**测试**：`context_grounding_test.exs` — `"without context, TurnResult does not fabricate work facts"` ✅、`"without context, trace records empty context event"` ✅

---

#### C2 — 部分上下文

**作为作者**，我的作品有设定（snapshot 非空）但还没有对话历史（conversation_summary = nil），也没有记忆。AI 应该只基于已有的作品信息回答，不该假装有对话历史。

**验证点**：
- [ ] snapshot 有值 → `has_context?` 返回 true
- [ ] conversation_summary = nil → prompt 中不出现 `"## 最近对话"` 段
- [ ] memory_summary = nil → prompt 中不出现 `"## 相关记忆"` 段
- [ ] AI 不声称"根据我们之前的讨论"（没有对话历史）
- [ ] `context_refs` 只有 1 条 ref（对应 snapshot）

**当前覆盖**：❌ 无 partial context 测试。stub fetcher 要么全给要么全空。

---

### 场景组 D：溯源与脱敏

#### D1 — 每类上下文有独立的来源引用

**作为作者**，如果我想知道 AI 用了哪些信息，trace 中应该有明确的来源记录。

**验证点**：
- [ ] `context_refs` 中每条记录有唯一的 `context_ref` ID
- [ ] `source_type` 区分 `:current_work` / `:conversation` / `:memory` / `:behavior`
- [ ] `ContextSourceRef.summary` 从通用占位变为具体摘要（如"作品《灵源纪元》的当前设定"而非"context from current_work"）
- [ ] 每条 ref 的 `redaction_level` 标记为 `:author_safe`

**测试**：`context_grounding_test.exs` — `"every turn with context has distinct context refs in summary"` ✅

---

#### D2 — 作者可见的 trace summary 脱敏

**作为作者**，trace summary 中不应暴露 raw prompt、敏感记忆内容或系统内部策略。

**验证点**：
- [ ] author-safe trace summary 不含原始 LLM prompt
- [ ] author-safe trace summary 不含记忆原文（只含引用 ID）
- [ ] `redaction_level = :author_safe` 的 context_ref 不出现在 developer 专属区域

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 验证粒度 | 状态 |
|------|--------|---------|------|
| A1 | fetcher 四来源返回契约 | 5 元组每个字段 | ⚠️ memory/behavior 未接入 |
| A2 | workspace_id 匹配 | DB 字段级 | ⚠️ name vs id 需确认 |
| A3 | ContextAssembler 组装 | DialogueContext 字段级 | ⚠️ ref summary 为占位文本 |
| A4 | Planner 接收边界 | 参数类型级 | ✅ |
| B1 | 四类上下文逐类验证 | to_prompt_text 段级 | ✅ |
| B2 | 对话历史跨轮延续 | Interaction 表读写 | ✅（integration tag） |
| B3 | 对话历史截断 | prompt 长度 | ⚠️ 无测试 |
| C1 | 无上下文时诚实 | 每个 nil 字段行为 | ✅ |
| C2 | 部分上下文 | 混合 nil/非 nil | ❌ 无实现 |
| D1 | 来源引用完整性 | ContextSourceRef 字段级 | ✅ |
| D2 | 脱敏边界 | redaction_level | ⚠️ 无专门测试 |

**通过率：6/11 完整 + 4/11 部分 = 约 73%**

---

## 6. 缺口

| 缺口 | 具体表现 | 影响 | 建议处理 |
|------|---------|------|---------|
| GAP-01 — memory_summary 未接入 | `workspace_context.ex:27` 返回 `nil` | AI 无法基于记忆（伏笔、规则）给建议 | ContextAssembler 调用 `recallMemories` API 填充 `memory_summary` |
| GAP-02 — behavior_summary 未接入 | `workspace_context.ex:27` 返回 `nil` | 有 open behavior 时 AI 不知道"在等作者" | fetcher 查询当前活跃的 BehaviorState |
| GAP-03 — ContextSourceRef.summary 为占位文本 | `context_assembler.ex:53` 写死 `"context from #{type}"` | trace 中看不到实际引用了什么 | 改为从实际数据中提取摘要（如作品名、记忆标题） |
| GAP-04 — workspace_id 匹配字段不一致 | `where: w.name == ^workspace_id` 但变量名是 `workspace_id` | Channel 传入 UUID 但 DB 查 name → 查不到 | 统一：要么用 `name`，要么用 `id`，两边对齐 |
| GAP-05 — 部分上下文无测试 | stub fetcher 只有全给/全空两种 | 部分 nil 时的 prompt 拼接未验证 | 新增 fetcher 返回混合 nil 的测试用例 |
| GAP-06 — fetcher 异常无保护 | DB 挂了 → fetcher crash → handle_input 整体失败 | 单次 DB 故障不应阻断对话 | fetcher 内 rescue → 返回 `{:ok, nil, nil, nil, nil}` + Logger.warning |
| GAP-07 — conversation 只取 10 条 | `limit: 10` 硬编码 | 长篇对话中最近 10 条可能不够覆盖跨章讨论 | 改为可配置，或基于 token 预算动态截断 |

---

## 7. 已知限制

当前上下文由 stub fetcher 提供，真实作品快照（从 persistence 读取当前小说数据）待 VS-08 端到端集成时接入。本验收证明的是"有上下文时 AI 会用、无上下文时 AI 不编造"这个行为契约，不依赖真实数据。

---

## 8. 验收命令

```bash
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs
```
