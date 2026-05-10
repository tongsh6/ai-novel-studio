# AU-07 系统透明度与决策溯源

> 作者视角：我想知道 AI 为什么会给我这个建议。系统能告诉我它参考了我小说里的哪些设定、使用了哪些工具，以及它在做决定时是如何考虑的。这种透明度让我能更信任这个伙伴，并在它出错时知道该如何纠偏。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 点击消息旁的"为什么？" | 系统展示本轮决策摘要（Trace Summary） |
| 查看 AI 参考了哪些内容 | 界面列出本次回复引用的角色、设定和记忆片段 |
| 了解任务为什么没执行 | 系统解释是被权限拦截、预算超支，还是信息不足而降级 |
| 查看历史工具调用过程 | 看到 AI 曾尝试"查询角色列表"或"验证剧情一致性"的记录 |
| 离线翻看一周前的对话解释 | 历史解释是持久化的，不依赖实时 LLM |

明确不能做的：
- 系统不应向我展示原始 LLM 提示词（Raw Prompts）或代码日志
- 我不应看到涉及系统安全或其他作者隐私的敏感信息

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #5 | 工具调用有 trace | B1 — ToolTrace 可被 ReplayReport 引用 |
| #9 | TurnResult 是 canonical 输出 | A1 — trace summary 源自 DecisionTrace，不自创事实 |
| #13 | trace summary 脱敏 | D1 — 敏感字段不在 author-safe view 中出现 |
| #14 | replay 不重新调用 LLM | C1 — ReplayReport 只读 trace，不调 provider |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0013 | trace 脱敏与上下文引用 |
| ADR-0014 | TraceSummaryView redaction 规则 |
| ADR-0017 | ReplayCase / ReplayReport 定义 |
| VS-06 Contract Pack §2 | TraceSummaryView 字段 |
| VS-06 Contract Pack §3 | ReplayCase schema |
| VS-06 Contract Pack §4 | ReplayReport schema |
| VS-06 Contract Pack §6 | Proof 草案（8 条） |

---

## 4. 验收场景

### 场景组 A：作者可见的决策摘要

#### A1 — 查看回复的解释

**作为作者**，AI 拒绝了我修改大纲的请求，我想知道为什么。系统给我一个通俗易懂的解释。

```
作者: 帮我把大纲改了。
AI: 抱歉，我现在还不能直接修改你的整本大纲。
    [为什么？] → 点击展开:
    "系统决策: 建议降级为讨论"
    "原因: 计划范围过广"
    "参考上下文: 《灵源纪元》- 全书大纲"
```

**验证点**：
- [ ] trace_summary 中包含脱敏后的决策原因
- [ ] 解释中包含 `reason_code` 的人类可读描述
- [ ] 没有暴露原始 prompt 或代码堆栈

**测试**：`context_grounding_test.exs` — `"without context, TurnResult does not fabricate work facts"` ✅（验证 trace summary 诚实性）
**测试**：`action_roundtrip_test.exs` — `"valid action passes through gateway"` ✅（验证 trace 正常流转）

---

### 场景组 B：上下文引用溯源

#### B1 — 了解信息来源

**作为作者**，AI 提到了主角林烬的一个秘密。我想确认它是从我的设定里看到的还是自己编的。

**验证点**：
- [ ] 决策摘要中包含 `context_refs` 列表
- [ ] 如果是 AI 编造的内容，trace 诚实反映"无相关上下文引用"
- [ ] 每个 context_ref 有明确的 source_type

**测试**：`context_grounding_test.exs` — `"with context, trace records context_refs"` ✅

---

### 场景组 C：回放一致性

#### C1 — 离线状态下查看解释

**作为作者**，我翻看一周前的对话。系统仍然能展示当时为什么做那个决定，不需要重新联网问 AI。

**验证点**：
- [ ] ReplayReport 从持久化的 DecisionTrace 重建解释
- [ ] 重建过程不产生新的 LLM 调用（`provider_called == false`）
- [ ] 完整 trace 的 `result_status` 为 `complete`，缺失 trace 为 `partial`

**测试**：`replay_service_test.exs` — `"replay report does not call provider"` ✅
**测试**：`replay_service_test.exs` — `"builds replay report from reply-only trace"` ✅
**测试**：`replay_service_test.exs` — `"missing_trace_refs is empty for complete trace"` ✅

---

#### C2 — 缺失 trace 时诚实标注

**作为作者**，某个旧版本的对话缺少部分 trace 数据。系统标注为"部分可解释"而不是假装完整。

**验证点**：
- [ ] `result_status` 为 `partial` 或 `invalid_trace`
- [ ] `missing_trace_refs` 列出缺失节点
- [ ] 不声称 `complete`

**测试**：`replay_service_test.exs` — `"missing_turn_result_ref detected as partial"` ✅

---

### 场景组 D：脱敏边界

#### D1 — 保护系统秘密

**作为作者**，我试图在详情里寻找系统的内部指令（System Prompt）。系统确保这些信息被严格过滤。

**验证点**：
- [ ] author-safe trace summary 不包含 raw prompt
- [ ] author-safe trace summary 不包含 hidden policy
- [ ] author-safe trace summary 不包含 sensitive memory content
- [ ] 开发者 replay report 与作者 summary 有明确的隔离层

**测试**：`replay_service_test.exs` — `"builds replay report from reply-only trace"` ✅（验证 replay 结构独立于 provider 调用）

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 查看回复解释 | ✅ 有测试 |
| B1 | 了解信息来源 | ✅ 有测试 |
| C1 | 离线查看解释 | ✅ 有测试 |
| C2 | 缺失 trace 诚实标注 | ✅ 有测试 |
| D1 | 保护系统秘密 | ⚠️ 有结构隔离，缺专门脱敏断言 |

**通过率：4/5（80%）**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|------|------|---------|
| GAP-01 — reason_code 人类可读化 | 当前 reason_code 可能过于技术化（如 `scope_too_broad`） | 建立 reason_code → 作者友好文案的映射表 |
| GAP-02 — 可视化溯源 | 仅仅列出 context_refs 不够直观 | 前端实现"点击引用跳转并高亮原文"的联动功能 |
| GAP-03 — 脱敏专用测试 | D1 依赖 replay 结构间接验证，缺独立脱敏断言 | 新增 `trace_redaction_test.exs`：构造含敏感字段的 trace → 验证 author-safe summary 不含敏感内容 |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/replay_service_test.exs
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
```
