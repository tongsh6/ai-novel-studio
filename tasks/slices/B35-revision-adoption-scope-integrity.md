# B35 修订采纳范围完整性（内容修订不得整章误替换）

- 状态：**doing / CP0–CP3 完成（2026-10-25，`2392b104`/`59d94374`；CP3b PASS：判断可达+数据安全，但文本无变化→B36）**：根因=target_segments 指令未强制整章完整稿 + 候选无条件 complete + 采纳只校验 covered refs 不校验正文内容；修复候选 scope 声明 + 采纳侧 `ensure_content_covers_scope`（complete 非 format_only → new_chars>=covered_base/2，否则 `incomplete_scope` 零写入）；CP3 scoped replay FAIL（判断 tool args 可达性缺口，候选未产出/零写入）→ task-94 修复中；P1 canonical-2 暂停。
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

## 5. CP3 记录（2026-10-25，FAIL：判断 tool args 不可达；数据安全 PASS）

- 环境：canonical DB 新副本、`DOGFOOD_MAINTENANCE_ONLY=1 retry=content_revision`、native iq3_s；HEAD `2392b104`；单次未重跑。
- 链路：首次 judgment 返回 `revise_adopted_content`+`target_chapter_ref`/`modification_scope` → `JudgmentToolContract` invalid_tool_arguments（候选 payload 字段不允许出现在 judgment_decision）→ B33 纠错后纯文本 reply → 终局 reply；runner 记 wrong-route，无候选/零写入。
- **数据完整性 PASS**：第03章 ACCEPTED draft 561db… v5（1198 chars、sha e4830487…）与 canonical 完全一致，未 SUPERSEDED；章有效字数 1002、总字数 10002、导出正常；canonical DB sha `86c655f7…` 未变。
- 结论：B35 采纳保护未被行使；根因在判断 tool 可达性/纠错回退，task-94（prose）修复后做**一次** content_revision scoped replay；仍不重跑整批。
- 证据：`artifacts/novel-output/p1-b35-cp3-replay-2026-10-25/`。

## 6.1 CP3b 复验记录（2026-10-25，PASS with residual）

- HEAD `59d94374`；canonical DB 新副本/新证据目录 `artifacts/novel-output/p1-b35-cp3b-replay-2026-10-25/`；native iq3_s 单次；3 provider calls/39.9s。
- **判断可达 PASS**：judgment 首次 execute/revise_adopted_content + `adopted_content_ref=chapter:a9524ba9-…`（真实章级 ref），范围写 dialogue_goal；output_validation 错误 0、wrong_route 0、retry 0。
- **数据完整性 PASS**：第03章 1002→1002 字（非 116）、总字数 10002；旧 1198 chars→新 1198 chars、22 段→22 段；除第一段外其余段落逐字节一致；receipt scope=target_segments/covered_refs/old_chars/new_chars=1198；canonical DB sha `86c655f7…` 未变、无未确认写入。
- **Residual**：新旧 ACCEPTED 内容 sha256 相同（e4830487…）→ writer 交付稿与旧稿逐字节相同，第一段未实际改写。说明 B35 范围/安全保护成立、判断可达已修；实际局部改写能力交 **B36 算法/结构化编辑**（不依赖 prompt 唯一保证）。
- P1 canonical-2：等 B36 CP1/CP3（真实局部改写+越界拒绝）后 GO。
## 6. 后续门禁

- task-94 修复提交 → B35 CP3 单次复验（同 B35-CP3-REPLAY-PLAN，新 DB 副本/证据目录）；PASS 判据：target_segments 合法判断→整章完整稿候选→采纳后其余段落逐字节保留/字数不塌缩；或模型仍局部稿时 `incomplete_scope` 零写入（数据安全）。通过后 P1 canonical-2（post-fix 一次验收）。
