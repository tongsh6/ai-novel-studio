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

正文产出后由独立 `ProseQualityService.evaluate/3` 运行，分三层：

- **确定性 finding（非 LLM，§11.1）**：高频身体反应模板、高频直接情绪标签、高频
  AI 套话、结构元标签误入正文等可由明确规则确认的问题。
- **局部形式候选（非 LLM，§11.1）**：连续窗口内的句首、完整标点骨架和长度接近度只
  召回 `form_candidates`，不得直接成为 `QualityFinding`，也不得把形式雷同命名为
  “节奏问题”。
- **语义 validator（独立 evaluator LLM，§11.2）**：
  1. 对 `form_candidates` 逐项区分机械重复与刻意排比/回环/咒语式重复，只有缺少强度、
     意义、视角或情绪递进的机械重复才输出 `validator.sentence_rhythm_uniformity`；
  2. 独立对照 `ChapterPlanDirection` / `ReaderEffectBrief` 的章功能、情节推进、情绪目标、
     信息释放和 hook，判断实际正文的事件密度、张力轨迹、细写/概述选择是否匹配，输出
     `validator.narrative_pacing_fit`；
  3. 继续执行 `scene_change` / `emotional_transition` / `character_agency` /
     `causal_progression` / `setup_turn_consequence` / `brief_alignment` /
     `emotion_expression_balance` / `dialogue_intent_fit` 等语义检查。

validator → quality gate 映射（**不为每个问题新建顶级 gate**；仅新增一个 `quality_gate.style_fit` 承载风格/句式两条 validator，其余挂现有 gate）：

| Quality Gate | Validator | 默认 action |
|---|---|---|
| `quality_gate.pacing`（已存在） | `validator.emotional_transition` | WARN |
| `quality_gate.pacing` | `validator.narrative_pacing_fit` | WARN / ADOPTION_REVIEW |
| `quality_gate.character_logic`（已存在） | `validator.character_agency` | ADOPTION_REVIEW |
| `quality_gate.character_logic` | `validator.reaction_earned` | WARN |
| `quality_gate.payoff_validity`（已存在） | `validator.setup_turn_consequence` | WARN |
| `quality_gate.style_fit`（**本 pack 新增**） | `validator.prose_pattern_repetition` | WARN |
| `quality_gate.style_fit` | `validator.sentence_rhythm_uniformity` | WARN |
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

`TurnResultBuilder` 在 TurnResult 增加 `quality_review`（status + findings + policy_action /
review_status）。每个作者可见 finding 必须包含：

```text
quality_finding_id
quality_gate / validator / severity / action
summary / reasoning / confidence
evidence_spans[{text, sentence_start, sentence_end, start_offset?, end_offset?}]
impact_scope(local|paragraph|chapter)
revision_scope(local|paragraph|chapter)
brief_field_refs / suggested_revision / can_override
```

前端（§15）在正文草稿卡下展示 `QualityReviewCard`，至少显示原句、位置、判断理由、
影响范围和置信度，复用现有 available actions，**不新建平行 Card 状态机**，
**不提升 finding 严重级别**，**不隐藏原始正文**。`quality_finding_id` 是选择动作与
provenance 的稳定标识；`validator` 只表示规则类型，不能代替 finding id。

## 8. 修订候选如何保持 tentative/adoption 边界

新增作者动作 `revise_from_findings`（§12）：基于选定 findings 调用正文 writer，产出
**sibling tentative artifact**（新 artifact id），设置 `revision_base = 原 artifact id` /
`revision_reason = findings` / `quality_finding_refs`。修订范围由所选 findings 的最高
`revision_scope` 决定：

```text
local      → 只改 evidence_spans 命中的句段，范围外文本尽量保持不变
paragraph  → 只改命中段落
chapter    → 允许章级重组，但仍不得改变已确认作品事实
```

默认是 `local`；不得因为实现方便把局部问题升级成整章重写。writer 虽返回完整正文候选，
但 scope 约束必须进入修订 prompt。原稿继续保留、不被覆盖；修订稿不自动采纳、不自动进入
阅读投影；原稿与修订稿都各自走现有 adoption 七态；一次动作最多一个候选；evaluator 不得
自动递归触发下一次修订。修订调用必须重新经过 `ExecutionOrchestrator`，不得伪造
`decision_ref` 或从 application 编排直接绕过 gate 调用 toolbox。

### 8.1 作者动作、回执与 AgentRun 的绑定

`revise_from_findings` 不创建第二条 `user_message`。Channel 在启动 bounded run 后返回并持久化
同一份 author-action receipt；receipt 与 `AgentRun.trigger` 必须共享：

```text
receipt_id / action_id / action_type
source_turn_ref / source_surface_ref
target_artifact_ref / quality_finding_refs
```

重复提交同一 `idempotency_key` 必须返回同一 `receipt_id/run_id`，不得重跑 provider。前端把
receipt 放回来源质量卡下方，把运行过程渲染为来源 assistant turn 的唯一工作回合；固定控制坞
只控制该 `run_id`，不得复制模型叙事。bounded run 刷新后只允许重连仍存活的 Supervisor 并
替换 event sink，不允许从数据库重建或重放 provider；完成后的 TurnResult 继续携带 trigger，
用于 transcript reload 后恢复 receipt/source 关系。

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
I11 同一 revision action receipt 最多绑定一个 run_id
I12 一个 action-triggered run 只渲染一个来源 assistant 工作回合
I13 bounded refresh 只重连存活 run，不重放 provider
I14 形式统计只召回候选，不直接成为文学质量结论
I15 刻意修辞不得仅因形式重复被判为机械问题
I16 章节节奏 finding 必须引用章功能/推进/情绪/信息等结构参照
I17 局部 finding 默认局部修订，范围升级必须来自 finding 的明确 scope
```

## 13. 兼容性红线

- 不破坏 `CreativeProvider.Real` 的三锚点：`用户创作简述：` / `上下文：` / `重要：`。
- `CreativeRequest` 新字段默认 nil，兼容现有 provider / stub / slice_verify。
- 不改变 adoption 七态；不新增平行 brief / ReaderEffectBrief / QualityFinding / adoption / trace 体系。
- 第一阶段不为情绪弧 / 张力曲线 / 潜台词图建独立 DB 表；不以固定数字张力曲线为硬契约；潜台词检查仅按场景类型条件启用。

## 14. 验收（CP1–CP3 注册到 `quality/acceptance/scenarios.yml`）

`p1-prose-execution-brief`（CP1）、`p1-prose-quality-finding-roundtrip` / `p1-prose-quality-evaluator-degrade`（CP2）、`p1-prose-revision-candidate` / `p1-prose-quality-adoption-boundary`（CP3）、`quality-revision-action-run-anchoring`（动作回执、单一工作回合、同 run 控制与刷新重连）、`p1-prose-quality-real-provider-sample`（真实 provider 仅收集盲评材料，不得自动断言「文学质量提升」）。质量基线 fixture 见 `quality/acceptance/fixtures/prose-quality/`（CP0 建立，§16 坏样本，确定性可复现，不依赖云端模型）。

其中 `p1-prose-quality-finding-roundtrip` 必须从真实正文入口连续覆盖三类语义边界：机械
重复候选被确认、刻意修辞候选被抑制、没有局部形式候选的章节功能/叙事密度错配被独立
识别；前两者分别证明形式召回与修辞裁决职责，第三者证明章节节奏不依赖形式统计。

## 15. checkpoint 边界

- **CP0（本 pack + ADR-0020 + 基线 fixture + ledger/NEXT）**：冻结对象与边界，建立可复现质量基线；2026-06-28 追加收敛 revision Orchestrator 边界、provider call refs / budget 与 decision_packet trace ref。
- **CP1（已闭环）**：`ProseExecutionBriefV1` 成为运行时对象，进入正文生成请求，trace 记 `prose_execution_brief_ref` / `creative_decision_packet_ref`（不新增情绪表）。
- **CP2（已闭环）**：独立 `ProseQualityService`，产 `QualityFinding`，evaluator 与 writer 分离，evaluator 失败诚实降级；writer/evaluator provider call ref 独立追踪。
- **CP3（已闭环）**：`revise_from_findings` 重新经过 Orchestrator，产 sibling tentative revision，原稿保留，修订稿独立采纳，revision replay 不重调 provider。
- 非目标（设计预留，不在 VS-00E 实现）：完整 E36 情绪曲线账 / E37 承诺账 / 自动永久 experience rule / 全量风格对象库 / 自动无限改写 / 多轮自主批量润色。

---

## 16. 写前推理：本章使命（`ChapterMissionV1`，2026-08-21 WR01）

> 立论：`notes/2026-08-11-establish-carry-process-write-pipeline.md` §2/§4（处理层真空）。
> 用户拍板（2026-08-21）：正文 run 新增模型步 / 本期不持久化、不预确认 / 失败降级继续写。

### 16.1 是什么

`ChapterMissionV1` 是写前推理步的输出值对象（`NovelDomain.ChapterMission`）：

```yaml
mission_id: cm_xxx
statement: 一两句话——这一章现在必须干什么（模型原话）
must_advance: [ { text, basis_ref, basis_label } ]   # 1..N，依据必须是材料里列名的 ref
must_avoid:   [ { text, basis_ref, basis_label } ]   # 0..N
dropped:      [ ... ]                                # 依据越界、被机械丢弃的条目（留痕）
confidence / provider_call_ref / degraded / degraded_reason
```

它回答的是 §2 链条里缺失的一步：`ChapterPlanDirection`（设计态）与五本账/进度（进度态）
**对表之后**本章该推进什么。`ProseExecutionBriefV1` 仍回答「每一场怎么演」，使命进入其
`chapter_context["mission"]`，不改变 scene_units 结构。

### 16.2 机械半边与模型半边

- 携带选取（`NovelDomain.ChapterMissionInputs`，0 调用）：按写作坐标选材料并逐条列名
  `[ref]`——本章计划九字段+场次（`plan:<seq>:<field>`）、有预期的未回收伏笔按临近
  （`ledger:information:foreshadow_*`，无预期只计数）、后续章保密信息
  （`ledger:information:plan_info_*`）、弧光（STALLED 优先）、主线、题材承诺、最近三章
  情绪曲线、全书进度（`skeleton:progress`）、在场角色。不新设阈值（VS00F 刀④口径）。
- 模型推导（`NovelApplication.ChapterMissionService`，1 次 native tool-call
  `chapter_mission`）：返回 statement / must_advance / must_avoid / author_reasoning。
- 依据绑定（I-M1）：`basis_ref ∉ 材料 ref 集合` 的条目进 `dropped`，不进简报、不进 prompt。
- 叙事绑定（I-M3）：`author_reasoning` 走 N-NARR 绑定（content 优先 / tool arguments 回退），
  以 `mission_derived` 事件进作者推理区；绑定失败不作废使命，只不发作者可见事件。

### 16.3 运行形态（ADR-0023 N-PLAN 合规）

`chapter_mission` 是 `prose_drafting_with_quality_v1` 的 flow 内模型步（`kind: explore`，
`internal_observation_steps`），由模型排入计划；`prose_writing` 声明 D1 前置
`step_preconditions: %{"prose_writing" => [:chapter_mission]}`——模型漏排时 replan 改道，
不硬失败。作者显式一步预算（`max_steps: 1`）不声明前置。预算：正文 run `max_steps` 4→5、
`max_provider_calls` 5→6。

### 16.4 进简报与 provider message

`CreativeDecisionPacket["chapter_mission"]` → `ProseExecutionBriefBuilder` →
`chapter_context["mission"]`（不含 `dropped`）→ `ProseExecutionBrief.to_prompt_section/1`
在章行之后渲染：

```text
本章使命：<statement>
· 必须推进：<text>（依据：<basis_label>）
· 不得：<text>（依据：<basis_label>）
```

`brief_source` 取值新增：`"chapter_mission"`（在场）/ `"chapter_mission_degraded"`（推理
失败降级，简报不伪造使命）；未排步时不变。三锚点与既有段顺序不变（§13）。

### 16.5 留痕

- 业务日志 `chapter_mission.derived.done`（`turn_id/run_id/mission_ref/must_advance_count/
  must_avoid_count/dropped_unbound_count/basis_refs/input_ref_count/provider_call_ref/
  narrative_bound`）与 `chapter_mission.derived.error`（`reason`）；
- `prose_execution_brief.built.done` 增 `chapter_mission_ref`；
- `trace_summary.chapter_mission_ref`；
- AgentRun 事件 `mission_derived`（`author_narrative` + `author_narrative_source`）。

### 16.6 不变量

- I-M1 依据绑定：简报中每条使命条目的 `basis_ref` ∈ 本步材料 ref 集合。
- I-M2 设计态：使命不写 `chapters` / `memory_items` / `ledger_entries`；
  `production_write_performed=false`。
- I-M3 叙事只来自模型输出字节。
- I-M4 降级不拦稿：推理失败/缺席时正文照常生成，`brief_source` 如实标注。
- I-M5 预期归对象，不设全局阈值。

### 16.7 一期边界（2026-08-21）

- 一期使命不持久化、作者无预确认/改写入口 → **§16.8 二期已落**。
- 只接正文路径；`plot_outline` 规划前推理另排。
- 携带层五通道的统一选取策略仍是独立刀，本节选取器只是首个样板。

### 16.8 二期：使命落章计划 + 作者裁决 + 探索可达（2026-08-22 WR01b）

> 用户拍板：裁决入口在档案「大纲与结构」逐章；作者版下次直接用、不再让模型推；
> 推理完成即存暂定。

- **持久位**：`chapters.plan_direction["chapter_mission"]`（与 `scene_plans` 同款，零新表零新列；
  `ChapterPlanDirection.chapter_mission` 透传，不参与 E18-E22 的 prompt_lines/summary）。形状 =
  `ChapterMission.persisted_map/1`（无 dropped/降级字段）+ `status` + `source` + `derived_at/decided_at`。
- **状态机** `ChapterMissionStatus`（`schemas/foundation/enums/chapter_mission_status.json`）：
  `TENTATIVE`（模型推导，作者未裁决）→ `CONFIRMED`（作者确认）；`AUTHOR_EDITED`（作者改写，
  换 mission_id、依据归作者）；作废 = 删键。`CONFIRMED / AUTHOR_EDITED` 为**作者版**。
- **写入规则**：推理步成功即 `put_tentative`；作者版在场时**不覆盖、不推导、0 调用**（I-M6），
  新暂定覆盖旧暂定。大纲重物化只补缺失的 E18-E22 并**带回既有使命**（`design_empty?` /
  `carry_mission`）。
- **作者裁决（ADR-0024 S8）**：`author_action` 三动作 `confirm_chapter_mission` /
  `rewrite_chapter_mission`（payload `statement` + `must_advance[]` + `must_avoid[]`）/
  `discard_chapter_mission`，payload `chapter_ref`=章 id；回执 `mission_status`。渲染责任=
  档案大纲 tab（43 §5.0.3）。
- **作者版进简报**：`to_prompt_lines` 标「本章使命（作者已定）」；业务日志
  `chapter_mission.derived.done` 增 `source: model|author`、`persisted`、`mission_status`；
  作者版不发 `mission_derived` 叙事事件（无模型原话可绑）。
- **探索可达**：`chapter_read` 的【计划】段增「本章使命：一句话（暂定/作者已确认/作者改写）；
  必须推进…；不得…」。
- **why 面板**：`trace_summary.chapter_mission_statement`（author-safe 文本）→「本章使命：…」。
- 不变量：I-M6 作者版不被覆盖；I-M7 使命仍是设计态（只进 plan_direction，
  `production_write_performed=false`，暂定写入与 AU-14 暂定设定同款）。

