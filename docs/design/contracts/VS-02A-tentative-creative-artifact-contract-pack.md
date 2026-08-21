# VS-02A Tentative Creative Artifact Contract Pack

> 状态：draft for VS-02A docs-ready（2026-05-08）
>
> 角色：为 `tasks/slices/v3/VS-02A-tentative-creative-artifact.md` 关闭实现前文档 blocker。本文是 VS-02A 的 contract pack，不是 implementation plan，不授权代码实现。

---

## 1. Scope

VS-02A 只覆盖“生成小说创作草稿，但不直接采纳”的最小路径：

```text
AuthorInput
→ DialogueContext
→ MicroPlan
→ OrchestratorDecision
→ creative ToolRequest
→ creative ToolResult
→ TentativeArtifactSet
→ TurnResult
→ DecisionTrace
```

不覆盖：

- production write
- final adoption
- 读者阅读投影刷新
- 完整编辑器 UI
- 长篇正文生成质量评估

---

## 2. TentativeArtifactSet 最小语义

TentativeArtifactSet 表示 AI 生成的待采纳创作材料。

| 字段 / 语义 | 要求 |
|---|---|
| `artifact_set_id` | 可被 TurnResult / trace 引用 |
| `artifact_type` | `character_seed` / `plot_direction` / `outline_draft` / `scene_draft` / `prose_fragment` / `world_setting` / `foreshadowing_seed` / `world_rule_seed` / `style_rule_seed` / `constraint_seed` 之一；unknown 必须 validation failure |
| `items` | 一个或多个草稿项 |
| `source_turn_ref` | 引用当前 turn |
| `source_tool_result_ref` | 引用生成它的 ToolResult |
| `context_refs` | 引用生成时使用的上下文 |
| `adoption_status` | VS-02A 必须是 `tentative` 或等价语义 |

草稿项至少包含：

| 字段 / 语义 | 要求 |
|---|---|
| `item_id` | 可被后续 choose/adopt action 引用 |
| `title` | 作者可读短标题 |
| `body` | 草稿正文或摘要 |
| `rationale` | 可选，说明为什么这个草稿适合当前目标 |

---

## 3. Creative ToolResult Truth Boundary

创作工具返回的 ToolResult 不能直接成为权威作品事实。

允许：

- ToolResult 包含候选角色、候选剧情、候选片段
- TurnResult 展示这些候选或草稿
- 后续 VS-04 让作者选择并进入 adoption boundary

禁止：

- ToolResult 成功即写入正式角色、正式大纲或正文
- TurnResult 宣称草稿已经被采纳
- UI 把 tentative artifact 当作权威作品投影
- replay 时重新调用 provider 补齐草稿原因
- Provider / adapter 失败时生成空 artifact、demo artifact 或 adoption action

### 3.1 2026-05-25 runtime correction

本 contract 已按 v3 creative artifact runtime 纠偏同步：

- production capabilities 只保留具体工具：`character_design`、`plot_outline`、`prose_writing`、`world_building`；泛化 creative capability `creative_generation` 已从 production registry 移除，不可 dispatch，也不得出现在 Planner 可用工具提示中。
- `Toolbox` 只返回 `ToolResult`；`ArtifactAssembler` 是唯一 `ToolResult -> TentativeArtifactSet` 创建边界。
- `ToolAdapter` 负责具体工具到 artifact_type 的 contract 映射：`character_design -> character_seed`、`plot_outline -> outline_draft`、`prose_writing -> prose_fragment`；`world_building` 保持工具能力名，但按作者意图输出 `world_setting` / `foreshadowing_seed` / `world_rule_seed` / `style_rule_seed` / `constraint_seed`，其中 `world_setting` 仅表示普通世界观/背景设定草稿，不承载伏笔或规则默认语义。
- provider failure / invalid output 必须返回 failed `ToolResult`；不得生成 `TentativeArtifactSet`、candidate_set card 或采纳类 action。

### 3.2 正文创作的伴生产物（2026-08-11）

`prose_writing` 可以在同一次 provider 调用中返回一份正文主产物，以及正文中本轮新引入、
仍需作者确认的伴生产物。当前允许的伴生类型仅为：

- `character_seed`
- `foreshadowing_seed`
- `world_rule_seed`
- `constraint_seed`

运行时形状为：

```text
prose_writing ToolResult
  primary artifact       -> prose_fragment TentativeArtifactSet
  companion artifacts    -> 0..N 个既有 seed TentativeArtifactSet
```

约束：

1. 伴生产物与正文来自同一次 provider 原始响应；`item_id/title/body/rationale` 必须按
   provider 返回原样进入 ToolResult 和 artifact，不得由 application 补写创作字节。
2. 主产物与全部伴生产物的 `item_id` 必须唯一；类型未知、字段不合法或 id 冲突均属于
   provider output validation failure，不得静默改型或合并。
3. 伴生产物只记录本轮新引入、可独立登记的内容；已有角色/规则不得重复提案，普通叙述
   细节不得为凑数升级为设定。
4. `companion_artifacts` 必须显式存在；没有新事实时返回空数组。系统不得为了固定数量
   伪造候选。
5. 每个类型分别建立 `TentativeArtifactSet`，复用既有逐项采纳与落位映射；正文的
   `authoring_intent/target_chapter` provenance 不复制到 seed 产物。
6. 任一候选在作者明确采纳前都不得进入 Character、Memory 或 Reading Projection。
7. 该扩展不新增 UI card type；同一 TurnResult 通过多个既有 `candidate_set` 展示，动作
   仍只来自 `available_actions`。

---

## 4. TurnResult Truthfulness Rules

VS-02A TurnResult 可以说：

| 情况 | 可以表达 |
|---|---|
| 草稿生成成功 | “生成了几个可选草稿” |
| 草稿可继续讨论 | “可以继续改、选一个、或让我换方向” |
| 草稿来源 | “基于当前上下文和本轮目标生成” |

VS-02A TurnResult 不得说：

- 已采纳为正式设定
- 已写入章节正文
- 已刷新阅读投影
- 作者已经选择某项

---

## 5. Proof 草案

VS-02A implementation plan 必须把以下 proof 转成测试或可运行命令。本文只定义证明目标。

| Proof | Expected assertion |
|---|---|
| tentative artifact generated | 创作请求产生 TentativeArtifactSet |
| tool provenance exists | 每个草稿能追溯到 ToolRequest / ToolResult |
| not adopted | 未经过 author action 和 adoption boundary，不产生 adopted state |
| TurnResult honest | TurnResult 明确称其为草稿、候选或可选方向 |
| replay no provider | replay 依靠 trace 和 refs 解释草稿来源，不重新调用 provider |

---

## 6. Remaining Deferred Items

| 问题 | 后续归属 |
|---|---|
| 作者选择草稿后如何采纳 | VS-04 |
| 草稿卡片 UI 呈现 | VS-05 |
| 长篇正文质量评估 | 后续 creative quality slice |
| 草稿是否持久化 | 后续 persistence / artifact repository slice |
| Formal TaskState / Long-running Creative Job Contract | 后续单独冻结 queued / running / checkpointed / completed / failed / cancelled 生命周期；本 contract 不保留 synthetic task_state_events |
