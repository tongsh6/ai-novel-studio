# P1 Chapter Expansion / 单章正文续写累积到达标

- 状态：checkpoint 1+2 closed（2026-06-04）— 续写累积达标 + 续写连贯，两 provider Tauri 验收通过
- 类型：Product Slice / Novel Output Milestone P1
- 来源：`docs/product/novel-output-milestones.md` P1 Done（每章 ≥1000）；`docs/design-v2/21-novel-object-model.md` §6.6（场景是细粒度写作单元，ADR-0004 `chapter→scene`）；`docs/design-v2/28-authoring-lifecycle.md`（"继续写"基于前文）；`docs/design-v3/02-dialogue-frame-and-micro-plan.md` + ADR-0001/0002/0003；`docs/design-v3/contracts/VS-04-adoption-boundary-contract-pack.md`（覆盖确认）；`tasks/slices/P1-word-count-audit.md`（审计暴露"全是短章"）。
- 当前目标：作者用自然语言推进单章正文，系统**通过 AI 识别意图**（续写某章 / 重写某章），续写产出落为该章**新场景**累积有效字数，直到单章 ≥1000 达标（审计 `short→ok`）；重写走已有覆盖确认。

---

## 1. 产品目标

P1-word-count-audit 暴露的瓶颈：当前每章都是短章（确定性 168、真实 LLM 423–538，均 <1000）。原因不是 LLM 不会写，而是：

1. **实现把"章"塌缩成"单场景"**：`AdoptionRepository` 用同一个 `title` 同时定 `chapter` 和 `scene`，同章再采纳撞同场景 → `supersede` 替换 → 字数永不累积。这违背 v2 21 §6.6「章含多场景」（ADR-0004 `volume→arc→chapter→scene→draft`）。
2. **没有续写产出路径**：v2 28 把"继续写"列为 lifecycle 内动作（基于前文/伏笔/节奏），但当前主链只能"生成一章"，不能"接着这章往下写"。

本 slice 让实现回归「章含多场景」模型，并让**续写/重写意图由 AI 识别**（DialogueFrame/Planner），不是关键字匹配或 UI 按钮（后者是 v3 反模式，见 `00a` 反模式 #6）。

---

## 2. 开工检查（承重 slice 6 问）

- **Contract**：`DialogueFrame`/`MicroPlan`（ADR-0001/0002）承载"目标章 + continue/rewrite 意图"；`CreativeRequest` 经 `provider_hints` 传 target_chapter + mode；`AdoptionDecision` + 采纳"追加 vs 覆盖"分流；reading projection scene 累加（已有）；audit（已有）。
- **Invariant**：续写=同章新场景，**不得 supersede 已采纳场景**；重写=覆盖，必须 confirmation（VS-04）；字数只算已采纳、确定性；AI 意图识别不要求 100% 准，**高风险（重写/覆盖）由确认门兜底**。
- **Boundary**：`novel_application`（Planner 意图识别 + 采纳分流）、`novel_persistence`（章内多场景模型）、`novel_agent`（prose_writing 续写）、`novel_web`/frontend（自然输入入口，**不加续写按钮/关键字**）。
- **Consumer**：ReadingMode——单章多场景正文按序展示、字数累积、短章标记翻达标。
- **Proof**：domain/application/persistence/channel 测试 + 外部 Tauri 自动化（确定性多轮续写累积 + `--real-lmstudio` 证明真实 LLM 从自然输入识别续写意图与目标章）。
- **Acceptance Driver**：新 `scripts/tauri_slice_verify.sh p1-chapter-expansion`，外部 Playwright 用自然语言多轮续写真实工作台第 1 章，断言累积过 1000、`short→ok`。产品代码无意图关键字、无验收钩子。

---

## 3. 核心设计:AI 意图识别 + 章含多场景（对齐 v3）

```text
作者自然输入（如「接着写林澈摸黑钻进矿道」/「第一章太平了，推翻重写」）
→ DialogueFrame（ADR-0001）：识别为针对已有章的创作产出（execution_candidate）
→ Planner（ADR-0003 不能自批执行）形成 MicroPlan（ADR-0002）：
     proposed_action{ target_ref = 目标章, write_intent = tentative(续写) | production_candidate(重写), risk_hint }
→ Execution Orchestrator 门禁（重写=高风险）
→ prose_writing（CreativeRequest.provider_hints 带 target_chapter + mode）生成 prose_fragment
→ 采纳边界按 mode 分流：
     续写 → 同章新场景（scene seq+1），不 supersede，字数累加（adopted_state_changed）
     重写 → 覆盖确认（复用 overwrite-confirm / ConfirmationBinding）
→ reading projection 累加 → audit short→ok
```

**安全网（关键）**：AI 会误判。v3 不要求识别绝对正确，而要求高风险动作必须确认（VS-04）。重写（覆盖已有正文）误判 → overwrite-confirm 拦截；续写（新增场景）低风险，误判可纠正。

**对齐校验**：
- 不引入 v3 没有的语义——续写在 VS-04 里就是"新 scene 的 `adopted_state_changed`"，不是新 reason；覆盖复用 ConfirmationBinding。
- 章→多场景回归 ADR-0004，不自创结构。
- 意图识别在 DialogueFrame/Planner（dialogue-first），不在 UI/采纳层做关键字判断。

---

## 4. schema 扩展接法（最小改动）

| 层 | 现状 | 扩展 |
|---|---|---|
| DialogueFrame | `frame_type=execution_candidate` 表达创作产出，无目标对象维度 | 识别"针对已有章的续写/重写"（具体落在 frame 还是仅 plan，编码时定，优先不动 frame enforce 字段） |
| MicroPlan | `proposed_action` 已有 `target_ref`+`write_intent`+`risk_hint` | **复用**：target_ref=目标章；write_intent=tentative(续写)/production_candidate(重写) |
| CreativeRequest | 有 `provider_hints: map()` | ~~用 provider_hints 承载~~ **as-built（见 §4.1）**：意图作为 artifact provenance 流转、前文走 context_text、生成参数（如目标字数）走 creative_brief；provider_hints 至今无人填充（死通道），勿据本行新增写入方 |
| AdoptionRepository | chapter/scene 用同一 title 塌缩单场景 | 续写=同章新场景（scene seq+1，不 supersede）；重写=覆盖。**章身份与场景身份分离** |

### 4.1 Y2 意图透传链路（顺现有数据流，已确认 + 进度）

核查现有数据流发现：`TurnResultBuilder.maybe_add_artifacts(r, artifact_set)` 只接 `TentativeArtifactSet`，pending artifact 字段全来自 `as.*`，**plan/frame 不流进 pending artifact**；采纳轮经 `source_turn_result → artifact_field` 取。因此意图必须作为 **artifact 生成 provenance**（与现有 `source_tool_result_ref`/`context_refs` 同类），顺 `artifact → pending → 采纳` 既有流转，不逆改 `TurnResultBuilder`。`authoring_intent` 是生成 provenance（不是采纳决策，`append/overwrite` 由采纳层映射），不违反 VS-02A §3/§4。

```text
Planner → MicroPlan(authoring_intent + target_ref=目标章)                                   ← 待做(task 11)
→ TurnExecutionService 造 CreativeRequest.provider_hints{authoring_intent,target_chapter}     ← 待做
→ prose_writing ToolResult
→ ArtifactAssembler.assemble(tool_result, turn_ref, provenance) 设 artifact provenance        ← ✅
→ TurnResultBuilder.maybe_add_artifacts 投影 pending 带 provenance                             ← ✅
→ AdoptionWorkflow: authoring_intent→mode；target_chapter→chapter_title                        ← ✅
→ AdoptionRepository.projection_mode(:append|:overwrite) 章含多场景                            ← ✅
```

进度（**采纳侧消费链已通**，生成侧 + 意图识别待）：
- ✅ 采纳分流（`AdoptionRepository` append/overwrite，章含多场景）
- ✅ `TentativeArtifactSet` provenance 字段（authoring_intent + target_chapter）
- ✅ `ArtifactAssembler` 设 provenance（可选参数，向后兼容）
- ✅ `TurnResultBuilder` pending 投影带 provenance
- ✅ `AdoptionWorkflow` 消费 provenance → mode + 归章（续写 append 不需确认；重写 overwrite 走覆盖确认）
- ✅ 测试：adoption_repository 20 + adoption_workflow 7 + creative_artifact 16 全过；编译零警告、向后兼容
- ⏳ `TurnExecutionService`：MicroPlan 意图 → `CreativeRequest.provider_hints` → assemble provenance（生成侧接通）
- ⏳ Planner：真实 LLM 从自然输入识别续写/重写 + 目标章（**最不确定**，task 11）
- ⏳ Tauri：多轮续写累积到达标章（task 13）

---

## 5. checkpoint 划分

- **checkpoint 1（本次）**：打通"续写累积达标"——AI 识别续写意图 + 目标章 → 采纳为同章新场景累积过 1000 → 短章翻达标。重写复用已有 overwrite-confirm。
- **checkpoint 2（slice 内下一步）**：续写连续性——prose_writing 带"本章已采纳正文"上下文，生成衔接段而非重复/另起（v2 28「基于前文」）。归到"质量/连续性"向，与"质量放后"一致，但属本 slice 计划内后果。
- **checkpoint 3（slice 内下一步）**：连续多章（第 2…N 章逐章推进），为 P1-export-minimum / 10 万字狗粮铺路。

---

## 6. 非目标

- 不做关键字/按钮匹配续写意图（v3 反模式）。
- 不做重复段落去重（属 word-count-audit checkpoint B）。
- 不做全书导出（P1-export-minimum）。
- checkpoint 1 不要求续写正文连贯（连续性归 checkpoint 2）；但不得 supersede 已采纳场景。

---

## 7. 关联设计债

word-count-audit 的 F1/F2/F3（质量门禁收敛到 `quality_finding`、阶段阈值配置化）已登记在 `tasks/slices/P1-word-count-audit.md` §7 与 ledger，按"质量放后"暂挂，不在本 slice 处理。

---

## 8. 进度

### 数据流地基 checkpoint（已完成，2026-05-31）

整条续写/重写意图的 schema 数据流接通（详见 §4.1 Y2），顺现有数据流、对齐 v3、向后兼容：
- 采纳侧消费链 + 生成侧透传全通：`plan provenance → ArtifactAssembler → artifact → pending 投影 → AdoptionWorkflow → AdoptionRepository append/overwrite`。
- 后端门禁全绿：全量 **635 测试 0 fail**、xref 无循环、arch、credo 0 issues、I1/I2/I3 全过。
- 前端未改（本 checkpoint 纯后端 Elixir）。
- 新增测试：`adoption_repository` append 累积 2 例、`creative_artifact` provenance 透传 2 例。

### checkpoint 1 闭环（已完成，2026-06-01）

task 11（Planner 真实 LLM 识别续写/重写 + 目标章）与 task 13（Tauri 验收）已完成，checkpoint 1 闭环：

- **意图识别已接（task 11）**：`Planner.form_micro_plan` 现接收 `DialogueContext`；已采纳章节标题经 `WorkspaceContext` 6 元组 fetcher → `ContextAssembler` → `DialogueContext.current_chapters` → plan prompt 的「## 已采纳章节」。LLM 据此输出 `authoring_intent`(continuation/rewrite/none) + `target_chapter`(精确取自列表)，`build_micro_plan` 映射到 action → `plan_provenance` → `ArtifactAssembler` → pending → 采纳层 append/overwrite。安全网：rewrite→overwrite→目标章已有正文则覆盖确认拦截。
- **Tauri 验收已做（task 13）**：`scripts/tauri_slice_verify.sh p1-chapter-expansion`。
  - 确定性：初稿 168（短）→ 自然语言 2 轮续写均识别 continuation → 单章累积 **1302**、chapter_count=1（未分叉/未 supersede）、短章翻达标。`artifacts/slice-verify/p1-chapter-expansion-tauri/summary.json`。
  - `--real-lmstudio`（gpt-oss-120b）：初稿 672 → 真实 LLM 两轮均识别 continuation → 单章累积 **1509**、4×POST `/v1/chat/completions` 全 200。`artifacts/slice-verify/p1-chapter-expansion-tauri-lmstudio/summary.json`。

### checkpoint 2 闭环（续写连贯，2026-06-04）

prose_writing 续写/重写时上下文带入**目标章已采纳正文**，基于前文衔接（v2 28）而非重复/另起：

- `ReadingProjectionRepo.accepted_chapter_prose/2`（按 work_id + title 取该章已采纳正文）+ `NovelApplication.persistence_chapter_prose_reader/0` 读端口注入。
- `TurnExecutionService` 在续写/重写轮把前文拼成 `## 本章已采纳正文（…衔接续写…）` section 进 prose_writing 上下文；记 observability 事件 `turn_execution.continuation_context.done`（prior_prose_chars）。
- **健壮性修复（真实 LLM 反馈）**：真实 LLM 能识别 continuation 意图但常**漏 `target_chapter`**。故目标章改由应用层 `resolve_continuation_chapter/2` 用 `DialogueContext.current_chapters` 确定性解析（命中用之，否则回退最新章），并把解析结果同时用于"读前文"与"采纳归章"（`assemble_artifact` provenance 用解析后章），二者一致。AI 只负责识别意图。
- 测试：`tool_provenance`（continuity 5 例，含 target_chapter 缺失回退最新章）+ `reading_projection`（accepted_chapter_prose 4 例）。
- Tauri：确定性累积 1290、`--real-lmstudio` 491→1637，两者 `prior_prose_context_events=2`、真实 prose_writing 请求含「本章已采纳正文」。

### 计划内后续 checkpoint（未做）

- 连续多章（§5 checkpoint 3）未做——队首。目标章确定性解析地基已支撑多章归章。
- 归后续 P1-export-minimum / 10 万字狗粮 / 独立 creative-quality slice（repetition 等）。
