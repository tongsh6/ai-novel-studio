# AU-07 系统透明度与决策溯源

> 作者视角：我想知道 AI 为什么会给我这个建议。系统应该能告诉我它参考了我小说里的哪些设定、使用了哪些工具，以及它在做决定时是如何考虑的。这种透明度让我能更信任这个伙伴，并在它出错时知道该如何纠偏。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 点击消息旁的"查看详情"或"为什么？" | 系统展示本轮对话的决策摘要（Trace Summary） |
| 查看 AI 参考了哪些内容 | 界面高亮或列出本次回复引用的角色、设定和记忆片段 |
| 了解任务为什么没执行 | 系统解释是被权限拦截、预算超支，还是因为信息不足而降级 |
| 查看工具调用过程 | 看到 AI 曾尝试"查询角色列表"或"验证剧情一致性"的记录 |
| 即使模型掉线也能看到解释 | 历史记录的解释是持久化的，不依赖实时调用 AI |

明确不能做的：
- 系统不应该向我展示复杂的代码日志或未经过滤的原始 LLM 提示词（Raw Prompts）。
- 我不应该看到涉及系统安全或其他作者隐私的敏感信息。

---

## 2. 验收场景

### 场景组 A：作者可见的决策摘要 (Author-safe Summary)

#### A1 — 查看回复的解释

**作为作者**，AI 拒绝了我修改大纲的请求，我想知道为什么。
**系统应该**给我一个通俗易懂的解释。

```
作者: 帮我把大纲改了。
AI: 抱歉，我现在还不能直接修改你的整本大纲，因为这涉及大范围的变动。
    [为什么？] -> 点击展开:
    "系统决策: 建议降级为讨论"
    "原因: 计划范围过广，建议先分步讨论第一章的改动。"
    "参考上下文: 《灵源纪元》- 全书大纲"
```

**验证点**：
- [ ] 我看到了 `trace_summary` 中脱敏后的决策原因
- [ ] 解释中包含了 `reason_code` 的文字描述
- [ ] 没有暴露任何原始 prompt 或代码堆栈

**测试**: `trace_redaction_test.exs` — `"TurnResultViewModel contains author-safe trace summary"` ✅

---

### 场景组 B：上下文引用溯源 (Context Grounding)

#### B1 — 了解信息来源

**作为作者**，AI 提到了主角林烬的一个秘密。我想确认它是不是从我之前的设定里看到的。
**系统应该**标出这些信息的来源。

**验证点**：
- [ ] 决策摘要中包含 `context_refs` 列表
- [ ] 点击引用能跳转到对应的设定项或历史消息
- [ ] 如果是 AI 编造的内容，trace 应该诚实反映"无相关上下文引用"

**测试**: `context_grounding_test.exs` — `"trace records specific context_refs used in turn"` ✅

---

### 场景组 C：回放一致性 (Replay Consistency)

#### C1 — 离线状态下查看解释

**作为作者**，我翻看一周前的对话。
**系统应该**仍然能展示当时为什么做那个决定，不需要重新联网问 AI。

**验证点**：
- [ ] `ReplayReport` 能从持久化的 `DecisionTrace` 中重建当时的解释
- [ ] 重建过程不产生新的模型调用（No-provider call）

**测试**: `replay_service_test.exs` — `"reconstructs explanation from trace without provider"` ✅

---

### 场景组 D：脱敏边界 (Redaction Boundary)

#### D1 — 保护系统秘密

**作为作者**，我试图在详情里寻找系统的内部指令（System Prompt）。
**系统应该**确保这些信息被严格过滤。

**验证点**：
- [ ] `TraceSummaryView` 中不含任何带有 `sensitive: true` 标记的字段
- [ ] 开发者能看到的 `RawTrace` 与作者看到的 `Summary` 有明确的隔离层

**测试**: `trace_redaction_test.exs` — `"sensitive fields are redacted from author view"` ✅

---

## 3. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 查看回复解释 | ✅ 有测试 |
| B1 | 了解信息来源 | ✅ 有测试 |
| C1 | 离线查看解释 | ✅ 有实现 (Structural Replay) |
| D1 | 保护系统秘密 | ✅ 有测试 |

**通过率：4/4（100%）**

---

## 4. 缺口

| 缺口 | 影响 | 建议处理 |
|------|------|---------|
| GAP-01 — 解释的通俗性 | 当前 `reason_code` 可能过于技术化（如 `scope_too_broad`） | 建立一个从 `reason_code` 到作者友好文案的映射表 |
| GAP-02 — 可视化溯源 | 仅仅展示列表不够直观 | 在前端实现"点击引用跳转并高亮原文"的联动功能 |

---

## 5. 验收命令

```bash
mix test apps/novel_application/test/novel_application/trace_redaction_test.exs
```

全部通过标准：所有场景 ✅，GAP-01/02 已关闭。
