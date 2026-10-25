# B36 局部修订算法与结构化编辑能力（不只 prompt）

- 状态：pending / CP0 设计登记（2026-10-25，作者要求：整章完整替换稿/未改段落逐字一致不能只靠 prompt 优化，需要算法/业务逻辑/应用能力支持）
- 类型：文本编辑算法 + 采纳事务能力 + 候选/验收契约承重 slice
- 来源：B35 CP3（局部 126 chars 被当整章 complete 覆盖，1002→116 字）、B33 CP4、用户 2026-10-25 裁决
- 关联：B28 整章修订、B35 修订采纳范围完整性、B33 判断可达性、P1 canonical-2

## 1. 业界做法调研（摘要）

| 方案 | 代表 | 优点 | 风险/成本 |
|---|---|---|---|
| 全文重写 + 服务端 diff 校验 | 通用 LLM 编辑器（本项目现状候选） | 不改候选 schema/UI；服务端可机械校验改动是否落在目标段、其余字节一致 | 输出 O(全文)，长章成本高；模型截断/漂移面大 |
| SEARCH/REPLACE 块 | [Aider edit formats](https://github.com/Aider-AI/aider/issues/3824) | 输出近似 O(改动)；搜索块可校验唯一匹配 | 需模型逐字重复旧文本，易一字错导致整块失败 |
| Hash/锚点编辑（anchor+§） | [Dirac hash-anchored edits](https://github.com/tangledgroup/tangled-skills/blob/main/misc/dirac-0-2-89/reference/02-hash-anchored-edits.md) | 输出 O(替换)；稳定锚点不随插入漂移；四重校验（格式/存在/单行/内容精确匹配） | 需产品提供章节分段/锚点；模型需读取锚点视图；候选/UI 需适配 |
| apply-edit-block / textpatch 库 | [apply-edit-block](https://pypi.org/project/apply-edit-block/)、[textpatch](https://pkg.go.dev/github.com/txn2/mcp-data-platform@v1.138.1/pkg/textpatch) | 现成编辑块应用+校验模式 | 外部库/语言绑定，需自建领域适配 |

**结论**：目标形态 = **锚点分段 + 编辑操作（replace segment）+ 服务端确定性 apply + 机械校验 + receipt/diff**；先落地"全文重写 + diff 校验"作为无 schema/UI 变更的算法兜底（CP1），再升级结构化编辑能力（CP2），两者都以"未涉及段落逐字一致、越界即拒绝零写入"为不变量。

## 2. 领域设计（冻结候选）

1. **确定性分段**：章节正文按空行/换行分段为 paragraph/block；每段有稳定 `segment_id`（`seg_<index>_<sha256(normalized_text)[0..8]>`）、byte start/end、原文字节；重复文本按 occurrence 区分；分段函数纯函数、可复算、测试固定样例（中文标点/空行/超长段/CRLF）。
2. **目标范围解析**：作者"第一段/整章/仅排版" → 目标 segment 集合（target_segments）或整章；与 B33/B35 `modification_scope` 对齐；无法解析→ask_author（零候选）。
3. **候选契约（CP1 兜底）**：沿用 `prose_fragment` 全章候选 body（provider 原样），payload 增加 `revision_scope`（target_segments/whole_chapter/format_only, target_chapter_ref, target_segment_ids, base_draft_ref/version）。
4. **服务端校验（CP1 算法核心）**：
   - 对 base 与候选正文做确定性分段 + 段落级 diff + 变化段内字符级 diff；
   - 断言：变化仅落在 target segment 集合内；集合外段落**字节级一致**；整章/format_only 各自语义；候选正文为空/截断/长度异常→`incomplete_scope`；越界→`out_of_scope_changes`；base 版本不符→`stale_base`；
   - 全部校验在 insert/supersede 之前，失败零写入；receipt 记 `scope/segment_changes[{id,old_sha,new_sha,kind}]/old_chars/new_chars/diff_stats`。
5. **候选契约（CP2 结构化编辑）**：新 object_kind `prose_segment_patch`：body = provider 原样编辑 JSON（`{base_draft_ref, ops:[{op:"replace",segment_id,expected_sha256,text}]}`）；服务端 apply：逐 op 校验 segment 存在/哈希一致/base 版本/覆盖范围，按 offset 逆序应用，生成新 draft；未涉及段落逐字保留；失败 `patch_apply_failed/incomplete_scope/stale_base` 零写入；候选预览/差异需 UI 支���（前端卡片 diff/preview，CP2b）。
6. **判断/候选生成**：judgment 仍只绑章/目标（`adopted_content_ref`），范围写 dialogue_goal；候选由产品根据分段+目标段确定性生成"需改段清单/锚点视图"给 writer；writer 只改目标段（CP2）或输出全章（CP1）。
7. **不可变量**：未涉及段落字节级保留；任何失败零写入；receipt/trace 可回滚；不静默丢字数；I1 候选 body 仍为 provider 原文（CP2 patch JSON）；不新增验收钩子。

## 3. CP 计划

| CP | 工作 | 证据 |
|---|---|---|
| CP0 | 调研/契约冻结（本节+评审） | slice |
| CP1 | 确定性分段/diff 校验 + adoption 集成（全文候选兜底；`out_of_scope_changes/incomplete_scope/stale_base` 零写入；receipt segment diff） | 后端测试 + B35 replay |
| CP2 | 结构化编辑能力：writer 锚点视图 + `prose_segment_patch` 候选/确定性 apply/receipt；判断范围+候选生成 | 后端测试 |
| CP2b | 前端候选 diff/preview 卡片（按 UI contract/设计文档；无验收钩子） | 前端测试 |
| CP3 | 真实模型 scoped content_revision replay（三路：A 全文+校验通过/C patch 应用成功/失败零写入；不重跑整批） | 模型证据 |
| CP4 | B28/B35/B30 回归 + P1 canonical-2 门禁 | 回归/门禁 |

## 4. 边界

- 不改 judgment schema（tool args 已由 task-94 修）；候选 schema/artifact 扩展按 B28/VS-04 契约流程走，不平行造框架。
- 不依赖 prompt 作为唯一保证；prompt 只负责产出内容，算法/业务校验负责数据完整性。
- 历史数据不清洗；真实模型单槽、用完卸载；不重跑整批换分。
