# VS-00A Creative Exploration Contract Pack

> 状态：draft for VS-00A docs-ready（2026-05-08）
>
> 角色：为 `tasks/slices/v3/VS-00A-creative-exploration-loop.md` 关闭实现前文档 blocker。本文是 VS-00A 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-00A 只覆盖模糊创作输入的自然探索路径：

```text
AuthorInput
→ DialogueContext
→ exploration DialogueFrame
→ CandidateDirectionSet
→ TurnResult
→ DecisionTrace
```

不覆盖：

- tool dispatch
- durable clarification
- confirmation
- adoption
- production write
- final UI visual implementation

---

## 2. Exploration Turn 最小语义

模糊创作输入进入 exploration，而不是直接进入表单化补槽。

Required semantics:

| 语义 | 要求 |
|---|---|
| `frame_type` | 必须表达 exploration 或等价语义 |
| `dialogue_goal` | 必须说明本轮是在展开创作想法 |
| `missing_information` | 可记录缺失信息，但不得自动变成 UI 表单 |
| `candidate_direction_refs` | 若给出候选方向，必须能被 TurnResult / trace 引用 |
| `author_visible_message` | 必须是自然创作对话，不是字段清单 |

---

## 3. CandidateDirectionSet 最小规则

候选方向是创作讨论材料，不是系统事实。

| 字段 / 语义 | 要求 |
|---|---|
| `direction_id` | 可被 TurnResult 和 trace 引用 |
| `title` | 给作者看的短标题 |
| `pitch` | 一到三句方向说明 |
| `tone_tags` | 可选，用于区分热血、黑色幽默、压抑等风格 |
| `source_frame_ref` | 必须引用本轮 exploration frame |
| `adoption_status` | VS-00A 必须是 `not_adopted` 或等价语义 |

Forbidden claims:

- 候选方向已写入作品设定
- 作者已经选择某个方向
- 系统已经创建作品、角色、世界观或大纲

---

## 4. 缺信息不自动表单化

当作者输入模糊时，系统可以追问，但追问必须服务创作展开。

允许：

- 给 2-3 个方向让作者选口味
- 用自然语言问一个关键选择
- 明确说明“现在还不需要定死”

禁止：

- 把缺失 slot 直接渲染成字段表
- 一次性要求补齐所有 required slots
- 在没有阻塞执行的情况下打开 durable clarification

---

## 5. TurnResult Truthfulness Rules

VS-00A TurnResult 可以说：

| 情况 | 可以表达 |
|---|---|
| exploration | 正在共同探索方向 |
| candidate directions | 这些是可选创作方向 |
| missing information | 还有一些设定可以稍后确定 |

VS-00A TurnResult 不得说：

- 已创建作品
- 已采纳设定
- 已写入角色、世界观或大纲
- 已调用工具
- 已打开需要作者处理的 durable behavior

---

## 6. Proof 草案

VS-00A implementation plan 必须把以下 proof 转成测试或可运行命令。本文只定义证明目标。

| Proof | Expected assertion |
|---|---|
| fuzzy idea enters exploration | “赛博修仙但没想好”产生 exploration frame |
| partner-like reply | TurnResult 包含自然展开回应，而不是字段清单 |
| candidate directions | TurnResult 包含 2-3 个候选方向，且均标记为未采纳 |
| no mechanical form | 不产生 slot form / durable clarification |
| trace explains choice | DecisionTrace 记录为什么本轮停留在 exploration |

---

## 7. Remaining Deferred Items

| 问题 | 后续归属 |
|---|---|
| 候选方向最终 UI 卡片样式 | VS-05 或后续 UI slice |
| 候选方向选择后的 adoption | VS-04 |
| exploration 是否调用候选生成工具 | VS-02 之后的能力 slice |

