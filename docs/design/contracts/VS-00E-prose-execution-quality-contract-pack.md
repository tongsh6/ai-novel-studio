# VS-00E — 正文场级执行简述与质量闭环 Contract Pack

> 状态：草案（2026-06-25）。
>
> 角色：冻结「章级方向 → 场级执行简述 → 正文生成 → 独立质量评估 → 修订候选 → 作者采纳」这条主链的契约与边界。
> 不授权代码实现；实现经 `tasks/slices/` 下 CP1–CP3 slice 与 ADR-0020。
>
> 上游：`../08-novel-element-model.md`（E18–E30 / NEM-GAP-04）、`VS-00C-creative-context-assembly-contract-pack.md`（创作上下文组装 + ReaderEffectBrief CP5）、`VS-00D-ai-guided-authoring-contract-pack.md`（CreativeDecisionPacket / brief / feedback_patch / 三层）、`../quality/31-novel-quality-gates.md`（Quality Gate 与 QualityFinding 设计）、`../domain/33-experience-engine.md`（E23–E30 场级 craft）。

---

## 0. 现状基线（以实际分支 `develop/dialogue-based-novel-workbench` 为准）

2026-06-25 CP0 冻结时已存在（代码）：

- `NovelDomain.ChapterPlanDirection`、`NovelDomain.ReaderEffectBrief`（章级读者效果，从 `ChapterPlanDirection` 投影）、`NovelDomain.WritingCoordinate`、`NovelDomain.MissingPolicyResult`、`NovelDomain.TentativeArtifactSet`。
- `NovelCommon.Contracts.CreativeRequest`：当时仅有 `request_id / tool_name / artifact_type / creative_brief / context_text / source_turn_ref / provider_hints`，尚未接入 `decision_packet` / `execution_brief`。
- `prose_writing` capability：read_scopes = `["author_text", "chapter_draft", "prose_style_guide"]`，write_scopes = `["prose_fragment", "scene_draft"]`，provider_dependency = `:llm_provider`。
- 正文链：`TurnExecutionService` → agent 侧授权工具执行边界 → `prose_writing_adapter` → `CreativeProvider.Real` → Provider Gateway。
- `CreativeOutputSelfReport`（writer 自报告，非权威）。

2026-06-28 当前实现事实：

- 已落地：`NovelDomain.ProseExecutionBrief`、`NovelDomain.QualityFinding`、`NovelApplication.CreativeDecisionPacketBuilder`、`NovelApplication.ProseExecutionBriefBuilder`、`NovelApplication.ProseQualityService`、`NovelApplication.ProseQualityPolicy`、`NovelAgent.ProseQualityEvaluator`、`QualityEvaluationRequest`、`QualityEvaluationResult`、`CreativeRequest.execution_brief`、`CreativeRequest.decision_packet`、`TurnResult.quality_review`、`QualityReviewCard`、`revise_from_findings`、`TentativeArtifactSet.revision_base/revision_reason/quality_finding_refs`。
- VS-00E 全部 4 个真实页面 Tauri 验收已闭环：`p1-prose-quality-finding-roundtrip`、`p1-prose-quality-evaluator-degrade`、`p1-prose-revision-candidate`、`p1-prose-quality-adoption-boundary`。
- `revise_from_findings` 当前链路为：作者 action → `ActionValidator` → revision `DialogueFrame` / 单动作 `MicroPlan` → `ExecutionOrchestrator.decide` → 带真实 `decision_ref` 的 `ToolRequest` → agent 侧授权执行边界 → `ArtifactAssembler` → sibling tentative revision `TurnResult`。修订 trace 默认 `replay_policy.recall_provider=false`。
- `trace_summary` 当前记录 `creative_decision_packet_ref`、`prose_execution_brief_ref`、`writer_provider_call_ref`、`evaluator_provider_call_ref`、`revision_provider_call_ref` 与 `provider_call_budget`，用于 replay 与 author-safe 解释；不把完整 prompt 或原始 provider payload 暴露给 UI。

剩余非自动化闭环：真实文学收益 I10 仍需人工盲评，不得用 fixture 或 deterministic validator 冒充。

---

## 1. `ProseExecutionBriefV1` 是什么

场级执行简述，是把**章级方向**展开为**逐场可执行的因果 + 情绪 + 信息 + 对话意图结构**的**设计态值对象**。它告诉正文 writer「这一章每一场要发生什么改变、由谁的目标和阻力驱动、读者与主角各自得知什么、情绪如何迁移」，但它**不是作品事实**，也**不是写后评价**。

最小结构（值对象，详见 §7.1 / ADR-0020）：

```yaml
brief_id: peb_xxx
brief_version: prose_execution_v1
anchor: { target_unit, chapter_ref, scene_ref, source_turn_ref }
chapter_context: { chapter_role, pacing_mode, reader_effect_ref }
scene_units:
  - unit_id, scene_mode,
    target_change: { type, description },          # 核心字段：场景必须改变关系/认知/目标/局势/承诺
    causal_spine: { goal, opposition_or_dilemma, turn, consequence },
    character_agendas: [ { character_ref, wants, hides } ],
    information_delta: { reader_learns, protagonist_learns, remains_hidden },
    emotion_transition: { start, pressures[], turn, end, residue },   # 状态迁移，非数字曲线
    dialogue_intent: { mode, surface_topic, hidden_conflict },        # subtext 仅按场景类型启用
    sensory_anchor: [ ... ]
source_refs: [ ... ]
created_at: iso8601
```

不变量：`target_change` 必填；允许 `target_change.type = deliberate_pause`（缓冲场，须说明功能）；`emotion_transition` 用状态词不用固定数字；`pressures` 可空但须有理由；不得要求所有场景都有反转/高潮；`dialogue_intent.mode=subtext` 仅按场景类型条件启用。

## 2. 它与 `ChapterPlanDirection` / `ReaderEffectBrief` / `brief` 的关系

```text
ChapterPlanDirection (章级 E18–E22：目标/情绪/伏笔/信息释放/钩子)
  └→ ReaderEffectBrief (章级读者效果目标，已存在；intended_emotion/tension_source/payoff/hook…)
        └→ ProseExecutionBriefV1 (场级展开 E23–E30：逐场 target_change/causal_spine/agendas/…)   ← 本 pack 新增
```

- `ReaderEffectBrief` 回答「本章要给读者什么效果」；`ProseExecutionBriefV1` 回答「为达到这效果，每一场具体怎么演」。前者是后者的 `chapter_context.reader_effect_ref` 输入。
- VS-00D 的 `brief`（active local brief）/ `feedback_patch` 是作者侧持续意图与反馈补丁，作为 `ProseExecutionBriefBuilder` 的输入之一，**不被** ProseExecutionBriefV1 取代。
- 三者都不是作品事实。

## 3. 它属于设计态还是作品事实

**设计态。** 与 `ReaderEffectBrief` 同级：是写前的执行设计，进入 trace 与 provider message，但**绝不**作为 authoritative story fact 写入作品事实库。采纳正文产生作品事实时，brief 仅作为 `brief_ref` 留痕，不被物化为正文事实。

## 4. 它如何进入 `CreativeDecisionPacket`

CP1 引入 `CreativeDecisionPacket`（代码态 plain map，由 `CreativeDecisionPacketBuilder` 组装），它聚合一次创作决策的输入：`coordinate / chapter_direction / reader_effect_brief / chapter / author_input / source_turn_ref`。`ProseExecutionBriefBuilder.build(packet)` 消费 packet 产出 `ProseExecutionBriefV1`。packet 不是作品事实，是一次 turn 的决策载体；当前进入 `ToolRequest.input["decision_packet"]` → `CreativeRequest.decision_packet`，trace 只记录 author-safe `creative_decision_packet_ref`。

## 5. 它如何进入 provider 可见 message

`CreativeRequest` 扩展（保持兼容，§8）新增 `decision_packet` 与 `execution_brief` 字段。`prose_writing_adapter` / `CreativeProvider.Real` 把 `execution_brief` 序列化进 provider message 的结构化区段，**追加在现有三锚点之后**，不破坏：

```text
用户创作简述：
上下文：
重要：
```

`execution_brief` 以可追踪的结构化段落进入 message（不得把全部场级信息塞进不可追踪的自由文案）。trace 记录 `brief_ref`，而非完整 prompt。

## 6. 正文生成后哪些 validator 被执行

正文产出后由独立 `ProseQualityService.evaluate/4` 运行，分两类：

- **确定性 validator（非 LLM，§11.1）**：连续句首重复、重复句式、段落长度过度均匀、高频身体反应模板、高频直接情绪标签、高频 AI 套话、短距离重复短语、结构元标签误入正文。
- **语义 validator（独立 evaluator LLM，§11.2）**：`scene_change` / `emotional_transition` / `character_agency` / `causal_progression` / `setup_turn_consequence` / `brief_alignment` / `prose_pattern_repetition` / `emotion_expression_balance` / `dialogue_intent_fit`。

validator → quality gate 映射（**不为每个问题新建顶级 gate**；仅新增一个 `quality_gate.style_fit` 承载风格/句式两条 validator，其余挂现有 gate）：

| Quality Gate | Validator | 默认 action |
|---|---|---|
| `quality_gate.pacing`（已存在） | `validator.emotional_transition` | WARN |
| `quality_gate.pacing` | `validator.scene_pacing_fit` | WARN |
| `quality_gate.character_logic`（已存在） | `validator.character_agency` | ADOPTION_REVIEW |
| `quality_gate.character_logic` | `validator.reaction_earned` | WARN |
| `quality_gate.payoff_validity`（已存在） | `validator.setup_turn_consequence` | WARN |
| `quality_gate.style_fit`（**本 pack 新增**） | `validator.prose_pattern_repetition` | WARN |
| `quality_gate.style_fit` | `validator.emotion_expression_balance` | WARN |
| `quality_gate.knowledge_boundary`（已存在） | `validator.character_knowledge_boundary` | BLOCK / CONFIRM |

`quality_gate.style_fit` 已登记入 `../quality/31-novel-quality-gates.md §6`。

## 7. `QualityFinding` 如何投影到 TurnResult 和 UI

`ProseQualityService` 产出 `[QualityFinding]`（§7.3 / ADR-0020）。`ProseQualityPolicy.decide/1` 据其 severity/action 汇总出 `quality_policy`：

```text
无 finding                         → proceed
轻微模板化/节奏/铺垫               → proceed_with_warning
人物无动机/情绪突变/场景无变化     → adoption_review
高置信设定冲突/认知越界            → block 或 confirm
evaluator 失败                     → quality_review_unavailable
```

`TurnResultBuilder` 在 TurnResult 增加 `quality_review`（status + findings + policy_action / review_status）。前端（§15）在正文草稿卡下展示 `QualityReviewCard`，复用现有 available actions，**不新建平行 Card 状态机**，**不提升 finding 严重级别**，**不隐藏原始正文**。

## 8. 修订候选如何保持 tentative/adoption 边界

新增作者动作 `revise_from_findings`（§12）：基于选定 findings 调用正文 writer，产出 **sibling tentative artifact**（新 artifact id），设置 `revision_base = 原 artifact id` / `revision_reason = findings` / `quality_finding_refs`。原稿继续保留、不被覆盖；修订稿不自动采纳、不自动进入阅读投影；原稿与修订稿都各自走现有 adoption 七态；一次动作最多一个候选；evaluator 不得自动递归触发下一次修订。修订调用必须重新经过 `ExecutionOrchestrator`，不得伪造 `decision_ref` 或从 application 编排直接绕过 gate 调用 toolbox。`TentativeArtifactSet` provenance 扩展 `quality_finding_refs / revision_base / revision_reason`，不破坏现有 artifact type 与 adoption 七态。

## 9. evaluator 失败如何降级

`ProseQualityService` evaluator 调用失败（连接/超时/二次非法 JSON）时返回 `quality_review_unavailable`：

- 原稿仍然显示、仍可被作者审阅与采纳；
- UI 显示「本次质量复核未完成」；
- **不得**生成空 finding 冒充 `passed`；
- **不得**自动调用修订；
- trace 记 `quality_review_status = unavailable` + 失败原因（脱敏）。

## 10. replay 如何处理 writer/evaluator 调用

replay **默认不重新调用**正文生成模型或质量评估模型（沿 VS-06 / ADR-0017 replay 不变量）。replay 从持久化的 `brief_ref / quality_finding_refs / writer_provider_call_ref / evaluator_provider_call_ref / quality_policy_action / quality_review_status` 重建解释，不产生新的 provider 调用、不产生新作品事实。

---

## 11. 冻结的新增 / 扩展对象（实现由 CP1–CP3 落地）

- Domain：`NovelDomain.ProseExecutionBrief`（§1/§7.1）、`NovelDomain.QualityFinding`（§7.3）；`TentativeArtifactSet` provenance 扩展（§8）。
- Common：`CreativeRequest` 扩展 `decision_packet` / `execution_brief` / `revision`（兼容，默认 nil）；新增 `QualityEvaluationRequest` / `QualityEvaluationResult`（**不复用** `CreativeOutputSelfReport` 作为权威结果）。
- Application：`CreativeDecisionPacketBuilder`、`ProseExecutionBriefBuilder`、`ProseQualityService`、`ProseQualityPolicy`。
- Agent：writer / evaluator 职责分离（`ProseWriter` / `ProseQualityEvaluator`），可复用 Provider Gateway 但用不同 request contract 与 prompt。
- Capability：`prose_writing` read_scopes 扩展至实际使用范围（§14）；质量 evaluator 通过独立 request/prompt 与独立 provider call 运行，不产作品事实、输出 QualityFinding、支持失败降级。
- Trace：新增事件 `creative_decision_packet_built / prose_execution_brief_built / prose_generated / prose_quality_evaluated / quality_policy_decided / revision_candidate_generated`。

## 12. 不变量（与 ADR-0020 一致）

```text
I1 原始正文永不被静默覆盖
I2 QualityFinding 不直接修改 artifact 或作品事实
I3 Evaluator 失败 ≠ 质量通过
I4 修订稿始终是新的 tentative artifact（独立 id）
I5 Writer 与 Evaluator 使用独立调用与 trace ref
I6 Replay 不重新调用 Writer 或 Evaluator
I7 文学类 finding 默认不硬阻断作者采纳（WARN / ADOPTION_REVIEW 为主）
I8 一次 revision action 最多生成一个候选
I9 前端不能自行提升 finding 的严重级别
I10 真实质量收益必须通过人工盲评验证（不得用 fixture 假装）
```

## 13. 兼容性红线

- 不破坏 `CreativeProvider.Real` 的三锚点：`用户创作简述：` / `上下文：` / `重要：`。
- `CreativeRequest` 新字段默认 nil，兼容现有 provider / stub / slice_verify。
- 不改变 adoption 七态；不新增平行 brief / ReaderEffectBrief / QualityFinding / adoption / trace 体系。
- 第一阶段不为情绪弧 / 张力曲线 / 潜台词图建独立 DB 表；不以固定数字张力曲线为硬契约；潜台词检查仅按场景类型条件启用。

## 14. 验收（CP1–CP3 注册到 `quality/acceptance/scenarios.yml`）

`p1-prose-execution-brief`（CP1）、`p1-prose-quality-finding-roundtrip` / `p1-prose-quality-evaluator-degrade`（CP2）、`p1-prose-revision-candidate` / `p1-prose-quality-adoption-boundary`（CP3）、`p1-prose-quality-real-provider-sample`（真实 provider 仅收集盲评材料，不得自动断言「文学质量提升」）。质量基线 fixture 见 `quality/acceptance/fixtures/prose-quality/`（CP0 建立，§16 坏样本，确定性可复现，不依赖云端模型）。

## 15. checkpoint 边界

- **CP0（本 pack + ADR-0020 + 基线 fixture + ledger/NEXT）**：冻结对象与边界，建立可复现质量基线；2026-06-28 追加收敛 revision Orchestrator 边界、provider call refs / budget 与 decision_packet trace ref。
- **CP1（已闭环）**：`ProseExecutionBriefV1` 成为运行时对象，进入正文生成请求，trace 记 `prose_execution_brief_ref` / `creative_decision_packet_ref`（不新增情绪表）。
- **CP2（已闭环）**：独立 `ProseQualityService`，产 `QualityFinding`，evaluator 与 writer 分离，evaluator 失败诚实降级；writer/evaluator provider call ref 独立追踪。
- **CP3（已闭环）**：`revise_from_findings` 重新经过 Orchestrator，产 sibling tentative revision，原稿保留，修订稿独立采纳，revision replay 不重调 provider。
- 非目标（设计预留，不在 VS-00E 实现）：完整 E36 情绪曲线账 / E37 承诺账 / 自动永久 experience rule / 全量风格对象库 / 自动无限改写 / 多轮自主批量润色。
