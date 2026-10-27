# ADR-0029：模型分段计划与确定性排版

- 状态：**Accepted（2026-10-25，作者选择“模型换行计划＋确定性应用”；实施与原生实模验收仍由B28承接）**
- 来源：[B28原任务](../../../tasks/slices/B28-whole-chapter-revision.md)、[VS-02A](../contracts/VS-02A-tentative-creative-artifact-contract-pack.md)、[VS-04](../contracts/VS-04-adoption-boundary-contract-pack.md)。
- 背景：旧format_only等价规则禁止段内新增换行，原样返回却能通过；真实全文重写已出现漏字。作者要的是分段判断与字句保真。

## 决策

1. 新的章级format_only走`prose_formatting_plan`，与正文`prose_fragment`区分。仍由当前`revise_adopted_content`入口、Orchestrator和`prose_writing`工具授权进入，不新增卡型或旁路写入。
2. 模型返回一个标准item（item_id/title/body/rationale原样保留）及`line_break_changes`：每条为`{boundary_id, lines}`，lines只允许0/1/2，分别表示无换行、换行、空行分段。模型只能复制本轮视图中提供的边界ID，不输出替换正文。
3. 视图绑定完整已采纳章的hash和版本。合法边界是句末标点及其闭引号之后，或原有换行位置；ID绑定源hash与非换行文本中的字节位置。重复句有不同位置ID。首版不插入句中边界，不添加或改变标点。
4. 应用只替换选定边界处的CR/LF序列。未选位置保持原样；所有非换行字节（文字、空格、标点、Unicode组合）严格不变。未知/重复边界、非法行数、过期源、无实际变化均拒绝，零写入。
5. 模型计划与理由保留原始因果来源；`formatting_preview`是由原文和计划计算的只读展示字段，明确标注“排版预览”，不能覆盖item.body或冒充模型原文。I1/I2/I3不豁免；预览与canon均须保留原文标识及非换行字节。
6. 作者通过既有accept/discard动作应用或放弃。计划不提供会误改说明文字的edit_then_accept；调整方案通过对话生成新计划。采纳在同一事务中核验work/chapter/覆盖版本/source_hash，重新计算预览、退场旧稿并生成同章当前稿；保留历史和幂等，刷新阅读/摘要/检索。
7. 旧的全文format_only候选沿旧严格校验兼容；不修改历史候选或原证据。新验收要求真实模型实际调整至少一个合法分段，且非换行字节完全相同，原样返回不能算成功。

## 边界与消费者

- Domain：纯视图/边界/应用算法，无I/O。
- Common/Agent：显式计划字段与模型输出角色，保留原始item字节。
- Application：真实章材料、预览、候选/动作/trace及源版本绑定。
- Persistence：事务重算与同章替代，方案说明不写成作品记忆。
- UI：现有candidate_set承载计划和明确标识的预览；操作仅来自available_actions。

## enforced_by

- apps/novel_domain/lib/novel_domain/prose_formatting.ex
- apps/novel_domain/test/novel_domain/prose_formatting_test.exs
- apps/novel_common/lib/novel_common/contracts/tool_output_contract.ex
- apps/novel_agent/lib/novel_agent/creative_provider/real.ex
- apps/novel_application/lib/novel_application/pending_artifact_workflow.ex
- apps/novel_persistence/lib/novel_persistence/adoption_repository.ex
- apps/novel_application/lib/novel_application/adoption_workflow.ex
- frontend/src/components/UICards.tsx
- docs/design/schemas/foundation/ui_card.json
- apps/novel_application/test/novel_application/b28_chapter_revision_wiring_test.exs
- apps/novel_persistence/test/novel_persistence/b28_replace_scope_test.exs

## enforcement_map（文件分工）

- domain `prose_formatting.ex` + 测试：换行边界视图与确定性应用，字节保真、未知/重复边界、stale 与实际变化拒绝。
- common `tool_output_contract.ex` + agent `creative_provider/real.ex`：计划字段及分段角色，模型原始 item 字节保留。
- application `pending_artifact_workflow.ex`：完整源材料、独立预览、对话调整计划与无实际变化拒绝。
- persistence `adoption_repository.ex` + application `adoption_workflow.ex`：原子重算、版本/覆盖校验、同章替代及完整章摘要材料。
- frontend `UICards.tsx` + schema `ui_card.json`：独立预览与既有卡型（不新增卡型）。
- application/persistence 两个 B28 测试：保真、拒绝/回滚、摘要来源与不变计划拒绝。

## enforcement_gaps

- B28 已于 2026-10-27 完成整章修订、格式计划、采纳、摘要/检索/阅读与缺目标等主链，R3/R3-resume/R4/R11 的原生实模 scoped 证据已回链；原“仍待 B28 闭环”已过期。
- 剩余边界：单批原生 48 项全矩阵未重跑（A3），无变化拒绝的负向有局部测试证据，不声称 R3 重新触发该负向；单次正例不代签文学质量。stage 存量数据修复仍需单独授权，不属于本 ADR 已实装范围。
