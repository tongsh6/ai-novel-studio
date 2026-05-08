# VS-00B Dialogue Context Grounding Contract Pack

> 状态：draft for VS-00B docs-ready（2026-05-08）
>
> 角色：为 `tasks/slices/v3/VS-00B-dialogue-context-grounding.md` 关闭实现前文档 blocker。本文是 VS-00B 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-00B 只覆盖“带着当前小说上下文回应”的最小路径：

```text
AuthorInput
→ DialogueContext assembly
→ planner input
→ grounded DialogueFrame
→ TurnResult
→ DecisionTrace.context_refs
```

不覆盖：

- memory ranking 全量策略
- tool dispatch
- production write
- adoption
- trace 持久化最终 schema

---

## 2. DialogueContext 最小来源集合

VS-00B 的 DialogueContext 至少允许以下来源，具体实现可先用测试 stub：

| 来源 | 作用 | 是否必须 |
|---|---|---:|
| `CurrentWorkSnapshot` | 当前作品、主角、世界观或当前章节摘要 | no |
| `ConversationSummary` | 最近对话摘要 | no |
| `MemoryContextSummary` | 与本轮输入相关的记忆摘要 | no |
| `OpenBehaviorSummary` | 当前是否有未关闭等待态 | no |
| `ContextSourceRef` | 每个上下文片段的来源引用 | yes, 当存在上下文片段时 |

规则：

1. Planner 只能接收已组装好的 DialogueContext。
2. Planner 不直接访问 Repo。
3. DialogueContext 可以为空，但必须明确为空。
4. 上下文为空时，TurnResult 不得编造作品事实。

---

## 3. Context Refs 与 Trace 绑定

每个进入 planner input 的上下文片段必须有来源引用。

| 语义 | 要求 |
|---|---|
| `context_ref` | 可被 DecisionTrace 引用 |
| `source_type` | current_work / conversation / memory / behavior / policy |
| `source_id` | 可选；如果来自持久对象则必须存在 |
| `summary` | 给 planner 的安全摘要，不包含无关全量数据 |
| `redaction_level` | 标记是否可出现在作者可见 trace summary |

DecisionTrace 至少需要记录：

- 本轮是否有 DialogueContext
- 使用了哪些 context refs
- 哪些上下文进入了作者可见回应
- replay 时不得重新调用 LLM 补上下文

---

## 4. 无上下文时不编造事实

当作者输入依赖作品上下文，但 DialogueContext 没有相关信息时，系统必须诚实回应。

允许：

- 说明当前还不知道主角或作品设定
- 请求作者给一句现状
- 给出不依赖具体事实的通用创作建议，并标明是假设

禁止：

- 编造主角姓名、作品设定、章节进度
- 假装读到了不存在的记忆或作品快照
- 把“缺上下文”伪装成确定的作品事实

---

## 5. Proof 草案

VS-00B implementation plan 必须把以下 proof 转成测试或可运行命令。本文只定义证明目标。

| Proof | Expected assertion |
|---|---|
| grounded reply | 有 CurrentWorkSnapshot 时，TurnResult 只引用 snapshot 中存在的事实 |
| no-context honesty | 无上下文时，TurnResult 明确说明缺上下文或继续探索，不编造 |
| planner boundary | agent/planner input 来自 application 组装的 DialogueContext，不直接访问 Repo |
| trace context refs | DecisionTrace 记录本轮使用的 context refs |
| redaction | 作者可见 trace summary 不暴露不该展示的原始上下文 |

---

## 6. Remaining Deferred Items

| 问题 | 后续归属 |
|---|---|
| 上下文排序、去重和 token 打包策略 | memory / context policy slice |
| trace store 的持久化 schema | VS-06 或后续 persistence slice |
| 作品快照 read model 的最终字段 | 后续 reading / projection slice |

