# B35 修订采纳范围完整性（内容修订不得整章误替换）

- 状态：pending / CP0 设计登记（2026-10-25，B33 CP4 scoped 真实模型 replay 暴露）
- 类型：采纳/事务/内容完整性承重 slice（修复既有 B28 采纳范围语义；不新增能力）
- 来源证据：`artifacts/novel-output/p1-b33-cp4-replay-2026-10-25/`（maintenance-replay content_revision；`content-integrity.json`/`comparison.json`）
- 关联：B28 整章修订、B30 结构维护、B33 CP4、P1 canonical、ADR 采纳边界

## 1. 问题事实（已复现，真实模型）

- 真实输入：把第03章（display seq 4）正文第一段改得更紧张、只改这一段。
- 产品候选：`prose_fragment`，payload keys 含 `target_chapter_ref`/`adoption_effect`/`modification_scope`；候选正文约 126 chars。
- 采纳 receipt：`adoption_effect.mode="replace_scope"`，`covered=["draft:561dbccb…:5"]`、`coverage="complete"`，`expected_base_versions=[{version:5}]`；**新 ACCEPTED draft 仅 126 chars，旧 1198 chars draft 被 SUPERSEDED**；章节有效字数 **1002→116**（其他段落全丢失）。
- 期望：只替换目标段，未涉及段落**逐字保留**；整章有效字数不塌缩；错误应被拒绝/澄清，不能静默数据丢失。
- 根因初判：内容修订候选只含局部正文，但采纳 effect 仍是整章 `replace_scope complete`；采纳侧未校验候选正文是否真正覆盖被替换范围（`coverage="complete"` 与实际内容不符）。

## 2. 拟冻结契约（CP0 校准）

1. **候选范围声明**：修订候选必须声明 `modification_scope`（paragraph/segment/chapter）、`target_chapter_ref`、被替换/覆盖范围（段标识或字节范围/完整正文）；候选正文与声明范围一致。
2. **replacement 覆盖完整性**：`adoption_effect.mode="replace_scope"`+`coverage="complete"` 仅当候选正文**完整覆盖**被替换范围（整章时=完整章节正文，段级时=该段完整文本）且未涉及部分逐字保留；否则拒绝（可解释错误）或降级为 fragment scope，**不得静默整章替换**。
3. **数据完整性校验**：采纳前机械校验——被声明保留的未改段落字节级一致；接受后章节有效字数不得因未声明原因下降；receipt/trace 记录 scope、covered refs、旧/新长度。
4. **错误/澄清**：不完整/范围不明 → `ask_author` 或可解释拒绝（零写入）；重复/幂等/失败回滚保持既有契约。
5. 不新增产品能力；不降低采纳安全校验；测试覆盖：段级修订保留其余段落、整章修订完整替换、部分候选+complete 声明→拒绝零写入、失败回滚、幂等。

## 3. CP 计划

| CP | 工作 | 证据 |
|---|---|---|
| CP0 | 从 replay 证据复现+定位候选构造/采纳校验链路（application/persistence），核对 B28 现有测试为何未覆盖 | `artifacts/model-contracts/b35-cp0/` |
| CP1 | 契约固化 + 候选范围/覆盖声明（最小改动） | 测试/契约 |
| CP2 | 采纳侧覆盖完整性校验/拒绝/回滚 + 数据不变测试 | 后端测试 |
| CP3 | 真实模型 scoped content_revision replay（B33 CP4 同 DB 副本）：第一段替换成功且其余段落/字数保留；不整批重跑 | 模型证据 |
| CP4 | B28/B30/P1 相关回归 + P1 canonical-2 前置门禁 | 回归证据 |

## 4. 边界

- 不改 frontend/src/novel_common/验收 hook；不降 schema/不补字段；不重跑 canonical 换分。
- 真实模型仅 scoped replay，单槽；模型生命周期用户硬约束。
- 历史错误数据（replay DB 为副本）不写回 canonical；如需修 stage/canonical 数据另授权。
