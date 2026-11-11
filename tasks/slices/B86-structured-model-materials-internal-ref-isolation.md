# B86 模型材料与返回结构化：内部标识隔离

**状态**：**todo（候选，未启动；2026-11-11 作者提出方向；同日作者要求撤回已落后的实现——`3a084fcf`/`72f8fb7d` revert，未提交的材料结构化改动已撤销；仅保留本设计记录）**。
**来源**：作者在 B81 CP5 实模批次发现「内部引用 `chapter:<uuid>` 泄漏到作者可见面」后指出根因：**发给模型的数据没有结构化，模型返回也不够结构化**——章节编号/名称/内容混在自然语言文本里，模型自然会把内部 uuid 当可复述文本写进正文。修复应从契约机制做，不是展示层事后过滤。
**证据**：`cp5-real-05`（真实 strata）扫描 20 个 AX/text 证据命中 `chapter:5d6d6360-…`：模型正文「定位到第1章（chapter:…）」+ 工具观察「已检索章节「chapter:…」」；`judgment_stable_chapters_section` 的章索引行 `- 第 1 章「标题」[chapter_ref=chapter:<uuid>]（计划中）` 是直接来源。

## 1. 现状（机制层面）

| 层 | 现状 | 缺口 |
|---|---|---|
| 材料（发给模型） | 章节列表、探索观察等以**自然语言段**注入（`ChapterListBudget.entry_line` 行内嵌 `chapter_ref=chapter:<uuid>`；observation summary 含裸 ref） | 内部标识与作者语言混在同一文本流，模型会把 ref 当自然语言学习/复述 |
| 返回（模型 → 产品） | 已是**结构化 native tool call**（`judgment_tool_contract` 的 `input_schema` + `valid?` 校验；写作输出走 tool args 的 body/prose 字段） | schema 只校验类型/枚举；**没有「作者可见自由文本字段禁止内部标识」约束**，模型可合法把 ref 写进 body |
| 作者可见出口 | `AuthorVisible.Text.new/1` 当前接收已准备好的非空展示文本 | 判断说明仍可把原生工具 `reason` 作为作者可见文本发布。结构化材料与说明契约均待收敛 |

`b82-g2-observed-target-04` 再现了判断说明的泄漏。判断调用没有可见 `content`，原生工具参数 `reason` 同时含章节和草稿内部引用，并逐字出现在当前回合的创作活动；同次 `dialogue_goal` 没有这些引用。`JudgmentProtocol.tool_narrative/3` 从工具参数取作者说明，当前仅验证可用文本形状。下一轮设计需核对说明进入作者可见活动之前的契约位置及原生有界纠错，保留成功说明与模型原始字节的因果关系。见 [B82 实模记录](B82-b71-golden-slice-evidence.md#作者可见驱动的验收边界2026-11-11)。

## 2. 目标（机制修复，分步）

1. **材料结构化**：章节等实体材料改为结构化字段表示（如 `{seq, title, status, chapter_ref}` 的 JSON/表格），内部标识只出现在**专用字段**，自然语言说明与数据分离；探索观察 summary 同理（ref 只进 `facts`/`evidence_refs`，summary 用作者可读名）。
2. **返回结构化约束**：判断/写作 tool contract 增加**作者可见字段（body/prose/decision 文本）不得含内部标识**的校验（`valid?`/normalize 层）；违规处理策略二选一（设计冻结时定）：① 拒绝并让模型重试（fail-closed）；② 产品投影（`AuthorVisible.Text`）后记录一次「模型输出含内部标识」事件（可观测）。内部引用用结构化字段（如 `used_chapter_refs`）表达，不写进正文。
3. **作者可见出口统一契约**：核对消息流、回放、导出与摘要的文本来源，复用 `NovelCommon.AuthorVisible.Text` 形状与现有作者可见词表。输出发生违约时的处理按第 2 项裁决。
4. **验收**：单测（材料无裸 ref、schema 拒绝/投影生效、作者可见文本无内部标识）+ 真实页面批次扫描（C9 类判据 hits=0）+ 不破坏 I-CACHE 边界（章节列表段标题被 I-CACHE boundary marker 引用，改用结构化后需同步）。

## 3. 边界与影响

- 跨契约变更（判断/写作材料格式 + tool schema + 作者可见投影 + 测试资产），需独立预注册/验收，不与 B81 CP5 混签。
- 不改判断/写作的**语义**（谁读什么、压缩阈值、K 等）；只改**表示与校验**。
- 与 B85（窗口设置 UI）无关；与 B81 的关联仅是 B81 CP5 发现该问题。
- 文档真源：`docs/design/contracts/VS-00L-*`（请求 IR/材料结构）、`judgment_tool_contract`/`authoring_operation`（工具 schema）、`docs/design/ui/46/47`（作者可见面）、`scenario-acceptance.md`（红线）。
