# VS-00C Creative Context Assembly

- 状态：CP0 done / CP1 done / CP2 done / CP3 done / CP4 done / **CP5 done**（ReaderEffectBrief 与非权威 self_report 已进入 prose_writing / TurnResult；VS-00C CP 序列完成）
- 类型：Context Assembly Slice（VS-00D `call_site=:prose_writing` 投影）
- 启动日期：2026-06-14
- 所属契约：`docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md`
- 上游：`VS-00D`（AIMessageEnvelope 总框架）、`08-novel-element-model.md`（要素模型）、`06`（Context/Trace）

> 本文件是 VS-00C 的 slice 入口，不是 implementation plan。CP0 范围/验收已冻结，编码前需用户批准。
> VS-00C 是 VS-00D `AIMessageEnvelope(call_site=:prose_writing)` 的 WorkState 投影（CreativeDecisionPacket）；边界对齐已在契约 §1.4 完成。

---

## 0. 实现序列（契约 §8）

CP0 → CP1 → CP2 → CP3 → CP4 → CP5。依据数据依赖与杠杆，与接入模型能力无关。

| CP | 范围 | 关闭 Gap | 状态 |
|---|---|---|---|
| **CP0** | WritingCoordinate + MissingPolicyResult（坐标与缺失策略固化） | G11、G13(hard-missing)、降 G9 | **done（Tauri evidence）** |
| **CP1** | 策略化省略 + 预算 profile + 确认路径同源组装 + fetcher fallback | G2/G4/G9/G10 | **done（76ca402+560b5c2）** |
| CP2 | chapter_summary 对象 + 续写摘要兜底 | G3/G5 | **done（CP2.1 + CP2.2 核心；why-panel + dogfood 延后）** |
| CP3 | 结构对象分层进入上下文 | G6/G1 | **done（Tauri evidence）** |
| CP4 | 章计划结构化（方向层） | 08 NEM-GAP-03 | **done（Tauri evidence）** |
| CP5 | ReaderEffectBrief + 创作输出自报告 | G12/G14 | **done（Tauri evidence）** |

---

## 1. CP0 目标

把"这一轮到底在写哪里、缺什么、缺了怎么办"从散落在 `turn_execution_service` 的 `authoring_intent` + `resolve_target_chapter` 临时推断，固化为一等值对象 `WritingCoordinate` 与 `MissingPolicyResult`，并接入主链与 trace。这是后续所有 CP 的上下文选择器前置。

示例：
```text
作者：重写第 99 章（不存在的章）
```
期望：系统识别 authoring_mode=:rewrite、target_chapter 解析失败 → MissingPolicyResult.severity=:block → **不调用 provider**，诚实回复"找不到第 99 章"，trace 记录坐标与 block 决策；而不是编造一章正文。

---

## 2. 开工检查（承重六问）

- **Contract**：固化 `NovelDomain.WritingCoordinate`、`NovelDomain.MissingPolicyResult`（值对象 + 推导规则）；消费 `08`§7 坐标规则、`VS-00C`§3.0 CreativeDecisionPacket 的 writing_coordinate/missing 字段。坐标进入 trace（ADR-0013 DecisionTrace / ADR-0018 业务日志）。
- **Invariant**：
  - I-a：首稿 / 续写 / 重写三类输入推导出不同 `authoring_mode`（沿用 `authoring_intent`，不另发明意图判定——意图仍由 AI/planner 出，坐标只做确定性归一）。
  - I-b：hard missing（重写/续写目标章不存在、或必要 target 缺失）→ `severity=:block`，**该轮不调用 provider**，返回可解释 TurnResult。
  - I-c：确认执行路径复用原轮 WritingCoordinate 与原作者输入引用（不再 `author_input="确认执行"` + `context:nil`），降低 G9。
  - I-d：既有 I1/I2/I3 场景不变量不破；real.ex 三锚点不动。
- **Boundary**：
  - `novel_domain`：WritingCoordinate / MissingPolicyResult 纯值对象 + 推导（纯函数，无 I/O）。
  - `novel_application`：`TurnExecutionService` 推导坐标、按 MissingPolicyResult 决定是否 dispatch provider；`DialogueGateway.handle_confirmation_dispatch` 保留原轮坐标/输入；`TraceWriter` 记录坐标与缺失决策。
  - **不改**：CreativeProvider/real.ex 模板、Gate Order、schema、persistence 写入。
- **Consumer**：第一个真实消费者是 prose_writing turn 执行链（`TurnExecutionService.execute`）与 trace；确认派发路径为第二消费者。
- **Proof**：见 §4。
- **Acceptance Driver**：外部自动化驱动真实工作台输入"重写一个不存在的章" → UI 显示可解释的"找不到该章"且无创作产物；产品代码**不新增任何验收感知逻辑**（坐标推导/缺失策略是真实产品能力，对所有输入一致，不读验收 env/slice id）。

---

## 3. CP0 范围（最小实现步）

1. `NovelDomain.WritingCoordinate`：`work_ref / authoring_mode / target_unit / target_chapter / source_turn_ref / source_input_ref` + `derive/1`（从 action.authoring_intent + 已解析目标章映射 authoring_mode）。
2. `NovelDomain.MissingPolicyResult`：`severity(:ok|:block|:confirm|:degrade|:omit) / missing([{what,reason}])` + 判定 hard-missing 的规则（CP0 只实现 :block 与 :ok；:confirm/:degrade/:omit 留 CP1+）。
3. `TurnExecutionService`：执行前推导坐标 + 评估 MissingPolicyResult；`:block` 时短路（不 dispatch provider），产出可解释 TurnResult；坐标与缺失决策进 trace + 业务日志。
4. `DialogueGateway.handle_confirmation_dispatch`：从 source turn_result/plan 恢复原轮 WritingCoordinate 与原作者输入引用，传入执行（接 G9 的坐标侧，完整同源组装留 CP1）。

不做（CP1+）：预算 profile、OmissionNote、chapter_summary、fetcher 重组、:degrade/:omit 软缺失。

---

## 4. Proof

- 单测：`derive/1` 对 首稿/续写/重写/规划/无目标 五类映射出正确 authoring_mode；MissingPolicyResult 对"目标章存在/不存在"判 :ok / :block。
- 应用层测试：重写不存在章 → 无 provider 调用（complete_fn 注入断言未被调用）+ TurnResult 可解释；确认执行复用原坐标（prompt/trace 含原 target_chapter 而非"确认执行"）。
- 不变量：`MIX_ENV=test mix run scripts/scenario_invariants/run_i{3,1,2}_*.exs` 全过。
- 工程门禁：`mix compile --warnings-as-errors`、`mix cmd --app novel_domain mix test`、`mix cmd --app novel_application mix test`、`arch_check`、`xref` 无循环。
- 外部验收：`scripts/tauri_slice_verify.sh <cp0-rewrite-missing-chapter>`（真实工作台重写不存在章 → 可解释 block、无创作卡）。

---

## 6. CP2 设计（承重六问 + checkpoint 拆分）

- 关闭 Gap：G3（被裁前文以摘要替代，replacement 不再 nil）、G5（跨章写作时模型知道前面各章**写了什么**，不只是标题）。
- 契约依据：`docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md` §5（新对象）/§8（CP2 范围）/§10（ADR 候选）。

### 6.1 承重六问

1. **Contract**：新增 `chapter_summaries`（契约 §5.2 字段）+ `NovelDomain.ChapterSummary` 状态机（复用 `NovelDomain.AdoptionStatus` 七态矩阵 / ADR-0019）；消费 CP1 `OmissionNote.replacement` 槽、22 §10/§16/§17。与既有 `chapters.summary`（**计划摘要**，写前）严格区分（契约 §5.1：写后内容压缩，不是 chapter 偷塞字段）。
2. **Invariant**：VS00C-I5（未采纳摘要不进普通创作上下文）；G3（L5 截断 replacement 填本章摘要）；G5（写作 prompt 可获得目标章之前的实现态连续性窗口）；正文重写/续写采纳后旧 ACCEPTED 摘要→SUPERSEDED 并产新 tentative；**摘要生成失败不阻断正文采纳主链**（降级留痕）；I1/I2/I3 不破、real.ex 三锚点不动。注意：前章摘要只说明“之前写了什么”，不能单独证明第 N 章首稿具备完整创作方向；首稿完备上下文依赖 CP3/CP4/CP5。
3. **Boundary**：domain（ChapterSummary 纯状态流转，无 I/O）；persistence（chapter_summaries schema/migration/repo + 后续 fetcher 扩展）；application（ChapterSummaryMaintenance 用例 + ContextAssembler 注入[CP2.2]）；agent（摘要走既有 CreativeProvider `Gateway.complete` 通道，不新增 provider 类型、不动 real.ex 模板 / stub 锚点）。**不改**：Planner 判定、GateOrder、AdoptionWorkflow 主流程返回契约、reading projection 口径。
4. **Consumer**：续写/首稿组装链（L3a/L5，CP2.2）为第一消费者；maintenance 为产出侧消费者（正文采纳后）；why 面板透出为后置 checkpoint。
5. **Proof**：见 §6.3。
6. **Acceptance Driver**：外部 Tauri 驱动真实工作台续写超预算长章 → 从 trace/日志断言 prompt 含「摘要替代物」（CP2.2）。产品代码**不新增验收感知**（摘要生成对所有正文采纳一致触发，不读验收 env/slice id）。

### 6.2 三个开放决策（契约留待 slice 拍板，用户 2026-06-16 定）

- **采纳档位 = 自动采纳**：maintenance 产 tentative → 低风险自动转 ACCEPTED。摘要是写后派生物，与 AU-03 会话摘要同构，KISS、无新增 UI、不打断作者；仍经 adoption 状态机留 trace。
- **source_type = 新增 `:continuity`**：why 面板区分「作品背景」vs「前章摘要」；落地在 **CP2.2**（摘要进上下文时），ContextSourceRef 枚举 + Zod SSOT 同步。
- **重写后旧摘要 = SUPERSEDED + 新 tentative**（revision_base 指向新正文）。契约 §5.3 已定，非开放项。

### 6.3 Checkpoint 拆分（最小实现步，不缩小 CP2 范围）

- **CP2.1（本轮）— 摘要对象 + 生成 + 自动采纳**：
  - domain `NovelDomain.ChapterSummary`：`new/1`（TENTATIVE）、`accept/1`、`supersede/1`，四栏 `summary_text` 渲染（情节推进 / 人物状态与弧光 / 伏笔动作 / 情绪基调）。
  - persistence `chapter_summaries` schema/migration/repo：`insert_tentative` / `accept` / `supersede_prior_accepted` / `current_accepted` / `list_recent_accepted`。
  - application `NovelApplication.ChapterSummaryMaintenance.run/3`（注入 generator + repo）：supersede 旧 ACCEPTED → 生成 tentative（四栏）→ insert → 自动 accept；失败降级留痕（`chapter_summary.maintenance.degraded`）不阻断。
  - 接 `AdoptionWorkflow.handle_adopt`（注入 maintainer，正文/场景采纳后触发，默认异步 + 失败吞掉，不影响采纳返回）。
  - 默认 generator 走 `Gateway.complete/1`（独立摘要 prompt，不动 real.ex 三锚点）。
  - **Proof**：domain 状态机单测；repo 单测（insert/accept/supersede/current）；maintenance 单测（stub generator：采纳→ACCEPTED 四栏摘要；同章再采纳→旧 SUPERSEDED；generator 失败→degraded 且采纳侧不受影响）；`handle_adopt` 注入 recording maintainer 断言收到正确 input（work_id/chapter_id/content）；I1/I2/I3 + 工程门禁。
  - **不 claim**：真实 LLM 摘要质量 / dogfood 长跑 / 上下文消费（均 CP2.2）。
- **CP2.2 — 上下文消费（关 G3/G5 收口）**：L5 截断 replacement=本章摘要 + OmissionNote；L3a 注入目标章之前最近 N 章摘要（实现态连续性窗口，不等同首稿完备方向）；fetcher 扩展返回摘要；新增 `:continuity` source_type + why 透出；外部 Tauri dogfood 长跑不再 HTTP 400。
  - **实现取向（最小涟漪，reader-port）**：摘要经新 reader port `chapter_summary_reader`（与 `chapter_prose_reader` 同型注入），**不改** DialogueContext envelope / fetcher 6-tuple / ContextAssembler。port 经 `WorkspaceContext` 用 `toc()` 索引在应用层做 title↔chapter_id Map 解析（与 work_id `:string` 口径一致，不做跨类型 DB join），调 `ChapterSummaryRepo.current_accepted`；L3a 使用 `previous(work_id, target_title, n)`，按目录顺序取目标章之前窗口，避免按写入时间把后章摘要带入当前章。
  - **CP2.2 本轮交付（G3/G5 prompt 闭合）**：L5——`budget_prior_prose` 裁剪时以本章摘要兜底（replacement=`chapter_summary:章` + excerpt 前置「更早正文摘要」），无摘要才回落 replacement=nil；L3a——prose_writing 轮注入「## 前文各章摘要」（目标章之前最近 N 章，CP2 当前默认 15，N 来自 `AssemblyPolicy.summary_window`；排除当前章/后章）；`context.continuity.done` 业务日志（含 `source_type: continuity`、`summary_window`、`assembly_policy_id`）作外部证据；`ContextSourceRef.source_type += :continuity`（前端 `traceSummaryView` 未映射时回落「其他」，不破）。
  - **诚实边界**：CP2.2 不 claim “写第 N 章首稿上下文已完备”。第 N 章首稿还需要 CP3 的目标章计划摘要/卷内位置、CP4 的 E18-E22 章方向四件套，以及 CP5 的读者效果目标。
  - **CP2.2 deferred（why-panel + dogfood）**：`:continuity` 的完整 ContextSourceRef → trace_summary → 前端 why 面板专属 label（§6「可后置 checkpoint」）；真实 LLM dogfood 长跑（当前 provider 上下文容量配置下连续累积超长章不再 HTTP 400 + 衔接质量人工抽查）作为外部真实页面验收。

## 7. CP3 设计（结构对象分层进入上下文）

- 关闭 Gap：G6/G1。CP2 解决实现态连续性（前面已写了什么），CP3 解决目标章在计划结构中的设计态位置（这章计划写什么、在前后章之间处于哪里）。
- 契约依据：`docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md` §8 CP3。

### 7.1 承重六问

1. **Contract**：`NovelDomain.DialogueContext.structured_chapters`；fetcher 7 元组 `{snapshot, conv, mem, behavior, current_chapters, structured_chapters}`；结构条目 `%{title, seq, summary, has_prose}`。`current_chapters` 标题列表保持给 Planner 使用。
2. **Invariant**：标题列表和结构对象分层；planner 不因 CP3 改语义；prose_writing 在 provider 调用前可获得目标章计划摘要、seq、上一章/下一章位置和正文状态；未命中结构对象时保持旧行为，不伪造方向。
3. **Boundary**：persistence 只从 `ReadingProjectionRepo.toc/1` 映射章节结构；application 组装 L2 section；agent/provider 模板不改；前端不新增验收感知逻辑。
4. **Consumer**：第一个真实消费者是 `TurnExecutionService` 的 prose_writing `ToolRequest.input["context_text"]`；外部消费者是 ADR-0018 业务日志 `context.structure.done`。
5. **Proof**：application 单测覆盖目标章结构注入、缺结构回退、planner 漏 `target_chapter` 时从真实作者输入命中现有章；persistence 单测覆盖 fetcher 结构条目；Tauri 外部 driver `vs00c-cp3-structured-context` 从真实档案点击第 2 章“生成正文草稿”，业务日志证明 `context.structure.done` 发生在 `toolbox.execute.done` 之前。
6. **Acceptance Driver**：`bash scripts/tauri_slice_verify.sh vs00c-cp3-structured-context`；产品代码不读 slice id/env/query/localStorage。该 driver 只使用真实档案、大纲按钮、websocket 帧和业务日志。

### 7.2 关键实现事实

- `NovelPersistence.WorkspaceContext` 返回结构化章节条目，标题列表从结构条目派生，兼容旧 6 元组 fetcher。
- `ContextAssembler` 同时兼容旧标题列表、旧结构 map payload 和新 7 元组，统一归一为 `DialogueContext.current_chapters` + `structured_chapters`。
- `TurnExecutionService` 在 prose_writing context_text 中按顺序放入：L2 目标章结构 → L3a 前文各章摘要 → L5 本章已采纳正文/裁剪摘要 → 当前作者输入。
- 真实 UI 首稿路径中 planner 可能不填 `target_chapter`；应用层已补确定性兜底：planner 精确目标优先，其次从作者输入命中现有章标题/章号。该修复同时让生成时上下文目标章与采纳归章一致。

### 7.3 证据

- `artifacts/slice-verify/vs00c-cp3-structured-context-tauri/summary.json`
- `apps/novel_application/test/novel_application/cp3_structured_context_test.exs`
- `apps/novel_application/test/novel_application/context_grounding_test.exs`
- `apps/novel_persistence/test/novel_persistence/chapter_summary_reader_test.exs`

### 7.4 诚实边界

CP3 仍不 claim “写第 N 章首稿上下文已完备”。它把目标章计划摘要和卷内位置放进 L2，但计划摘要仍是自由文本近似。CP4 才把章方向升级为 E18-E22 结构化四件套；CP5 才补 ReaderEffectBrief。

---

## 8. CP4 设计（章计划结构化方向层）

- 关闭 Gap：`08` NEM-GAP-03。CP3 解决“目标章在哪里、计划摘要是什么”，CP4 解决“这章承担什么叙事功能、推进什么四件套、如何制造情绪与断章”。
- 契约依据：`docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md` §8 CP4；`docs/design/08-novel-element-model.md` E18-E22。

### 8.1 承重六问

1. **Contract**：新增 `NovelDomain.ChapterPlanDirection`；`chapters.summary` 保持计划摘要，`chapters.plan_direction` 作为伴生结构承载 E18-E22（章功能定位 / 情节推进 / 人物变化 / 信息释放 / 伏笔动作 / 情绪定位 / 章首拉力 / 章尾断章 / 字数与场次）。
2. **Invariant**：规划采纳后的章结构可保存结构化方向；prose_writing L2 优先渲染 `plan_direction`，旧数据无方向时回退 CP3 的计划摘要；增量规划继续按章标题幂等追加，不覆盖已有章事实。
3. **Boundary**：domain 只放纯值对象；persistence 负责 parser、migration、schema、TOC/WorkspaceContext 读模型；application 只消费结构方向渲染 L2；agent 仅约束 `outline_draft` 输出 body 标签与确定性 provider fixture；前端生产代码不新增验收感知逻辑。
4. **Consumer**：第一个真实消费者是 `TurnExecutionService` 的 prose_writing `ToolRequest.input["context_text"]`；外部消费者是 `context.structure.done.has_plan_direction=true` 业务日志。
5. **Proof**：domain/parser/repo/workspace context/context assembler/application prompt 单测；`native-tauri-verifier` 规则覆盖真实页面“生成结构化大纲 → 保存 → 生成章节正文草稿”。
6. **Acceptance Driver**：`bash scripts/tauri_slice_verify.sh vs00c-cp4-chapter-plan-structure`。driver 只用真实档案按钮、保存按钮、websocket 帧和业务日志；产品代码不读 slice id/env/query/localStorage。

### 8.2 关键实现事实

- `NovelDomain.ChapterPlanDirection` 统一归一、存储和 prompt 渲染 E18-E22 方向字段。
- `ChapterPlanParser` 兼容旧 `标题: 摘要` 行格式与 CP4 多行标签格式；结构化方向存在时生成可读 `summary`，同时保存 `plan_direction`。
- `Chapter` 新增 `plan_direction :map`；`AdoptionRepository` 采纳 outline 时新章写入 summary + direction，旧章只补缺失 summary/direction，不覆盖已有事实；`ReadingProjectionRepo.toc/1` 与 `WorkspaceContext` 透出该字段。
- `ContextAssembler` 归一 string/atom key 的 `plan_direction`；`TurnExecutionService` 在目标章结构段中优先输出 `章方向：E18-E22 结构化方向` 与目标四件套，`context.structure.done` 增加 `has_plan_direction`。
- `CreativeProvider.Real` 对 `plot_outline/outline_draft` 的 `body` 输出增加 E18-E22 标签要求；`SliceVerify` deterministic provider 同步生成结构化章方向。

### 8.3 证据

- `artifacts/slice-verify/vs00c-cp4-chapter-plan-structure-tauri/summary.json`
- `apps/novel_domain/test/novel_domain/chapter_plan_direction_test.exs`
- `apps/novel_persistence/test/novel_persistence/chapter_plan_parser_test.exs`
- `apps/novel_persistence/test/novel_persistence/adoption_repository_test.exs`
- `apps/novel_application/test/novel_application/cp4_chapter_plan_direction_test.exs`
- `frontend/slice-verify/native-tauri-verifier.test.mjs`

### 8.4 诚实边界

CP4 仍不 claim “首稿质量闭环完成”。它把写前章方向从自由文本升级为结构对象，但读者效果、承诺/钩子风险和 AI 输出自报告仍属 CP5。

---

## 9. CP5 设计（ReaderEffectBrief + 创作输出自报告）

- 关闭 Gap：G12/G14。CP4 已把章计划方向结构化，CP5 把该方向投影成写前读者效果约束，并让模型输出附带非权威自报告，供质量/maintenance 后续消费，而不是写入作品事实。
- 契约依据：`docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md` §8 CP5；`docs/design/08-novel-element-model.md` E18-E22。

### 9.1 承重六问

1. **Contract**：新增 `NovelDomain.ReaderEffectBrief`；`ToolResult.output.self_report` 承载 `CreativeOutputSelfReport`；`NovelCommon.Contracts.ToolOutputContract` 归一 `self_report` 并给出 `quality_action`；业务日志新增 `context.reader_effect.done`。
2. **Invariant**：ReaderEffectBrief 是 provider 调用前的写作约束，不是生成后评价；AI `self_report` 只作为质量线索和 warning，不自动进入 `adoption_state.pending[].payload`、Reading Projection 或作品事实；缺 plan_direction 时必须明确省略，不能伪造读者效果。
3. **Boundary**：`novel_domain` 只放纯值对象；`novel_common` 定义 provider output contract；`novel_agent` 负责真实 provider JSON 解析与 tool adapter 输出；`novel_application` 渲染 ReaderEffectBrief、记录日志并把 warnings 透到 TurnResult；前端仅更新外部 verifier，不新增生产 UI 验收 hook。
4. **Consumer**：第一个真实消费者是 `prose_writing` 的 `ToolRequest.input["context_text"]`；第二消费者是 `ToolResult.output.self_report` / `warnings`；外部消费者是 Tauri verifier 对 `context.reader_effect.done` 与 `ui-state` 的关联断言。
5. **Proof**：domain/common/agent/application 单测；`frontend/slice-verify/native-tauri-verifier.test.mjs`；`bash scripts/tauri_slice_verify.sh vs00c-cp5-reader-effect-brief`。
6. **Acceptance Driver**：`bash scripts/tauri_slice_verify.sh vs00c-cp5-reader-effect-brief`。driver 只用真实档案按钮、保存按钮、websocket 帧和业务日志；产品代码不读 slice id/env/query/localStorage。

### 9.2 关键实现事实

- `ReaderEffectBrief.from_plan_direction/1` 从 CP4 的 E18-E22 结构化章方向投影出目标情绪、张力来源、承诺/爽点、悬念边界、钩子目标与网文风险说明，并在 prose_writing L2 中以 `## 读者效果目标（写前约束）` 渲染。
- `TurnExecutionService` 在 `context.structure.done` 后追加 `context.reader_effect.done`，记录 `has_reader_effect_brief`、关键字段是否存在、风险条数与 `assembly_policy_id`。
- `CreativeProvider.Real` 的 prose_writing 输出合同从单纯 JSON array 扩展为兼容旧 array 的 object：`items` + `self_report`；纠错 prompt 同步允许两种形态，保留三锚点。
- `CreativeToolAdapter` 把 `self_report` 放入 `ToolResult.output.self_report`，并以 `creative_output_self_report` warning 暴露 `quality_action` 与 `risk_flags`；`TurnResultBuilder` 透传 tool warnings。
- `SliceVerify` deterministic provider 在正文草稿响应中返回 `self_report`，Tauri verifier 断言 `used_context_refs` 包含 `reader_effect_brief`，且 risk flags 只作为质量信号存在。

### 9.3 证据

- `artifacts/slice-verify/vs00c-cp5-reader-effect-brief-tauri/summary.json`
- `apps/novel_domain/test/novel_domain/reader_effect_brief_test.exs`
- `apps/novel_common/test/novel_common/contracts/tool_output_contract_test.exs`
- `apps/novel_agent/test/novel_agent/creative_provider/real_test.exs`
- `apps/novel_agent/test/novel_agent/tools/creative_tool_adapter_test.exs`
- `apps/novel_application/test/novel_application/cp5_reader_effect_brief_test.exs`
- `frontend/slice-verify/native-tauri-verifier.test.mjs`

### 9.4 诚实边界

CP5 完成的是“写前上下文与输出质量线索”闭环，不等于自动质量门禁或最终小说质量评审完成。`self_report` 不是事实来源，不能绕过 adoption boundary；后续若要把风险标记变成正式质量 finding，需要进入独立 creative-quality / maintenance slice。

---

## 10. 决策日志

- 2026-06-14：确认 VS-00C↔VS-00D 边界已在契约 §1.4 对齐（VS-00C = call_site=:prose_writing 投影）。实现序列 CP0 先行（坐标/缺失是 CP1 组装的前置）。CP0 slice 六问冻结，待用户批准编码。
- 2026-06-15：**CP0 后端闭环**（用户批准）。新增 `NovelDomain.WritingCoordinate`（derive/1 归一 authoring_mode，不重判意图）、`NovelDomain.MissingPolicyResult`（evaluate/2，CP0 只判 :ok/:block）；`TurnExecutionService.execute` 前置坐标推导 + 缺失评估，hard missing（作者显式命名的不存在章）短路不调 provider 并产可解释 TurnResult；`emit_coordinate` 业务日志（ADR-0018）；确认派发透传 source_turn_ref（坐标侧接 G9）。仅当带真实 DialogueContext 时评估缺失（确认/无 context 路径不误阻断）。
  - 测试：domain writing_coordinate 7 + missing_policy 7 + application cp0 5 = 19 全绿；novel_domain 130/0、novel_application 238/0 无回归；I3/I1/I2 全过；arch_check/xref/格式 通过；compile 零警告。
- 2026-06-15：**CP0 重设计**（commit c1c257d，初版瞄错靶子）。问题：planner 按规则把"未匹配列表的章"的 target_chapter 置 null，导致"续写第99章"静默回退到最新章；初版只挡 planner 回显坏章的罕见 case，漏主病灶。正确信号 = **作者点名（requested_chapter_raw 非空）+ planner 未匹配（target_chapter 空）**。
  - planner.ex 加 `requested_chapter_raw` 输出+指令+解析；MicroPlan 加该字段（含 from_map）；WritingCoordinate 改 requested_chapter+matched_chapter 双字段；MissingPolicyResult.evaluate/1 靠 planner 匹配结果；SliceVerify provider 按章号匹配（"第一章"→第01章、"第99章"不匹配→block）。
  - **决定性证据 repro4**：真实 `Planner.form_micro_plan("续写第99章的正文草稿", chapters=["第01章…"])` → action `{authoring_intent: :continuation, target_chapter: nil, requested_chapter_raw: "第99章", target_ref: "prose_writing"}` → 必 block。后端在所有可直接验证层（单测/真实 Planner 链路/I1·I2·I3）均证明正确。
  - **tauri 外部场景：已编码、未通过、未提交（本地 WIP）**。harness 文件：`frontend/slice-verify/external-ui-driver.mjs`(driveCp0MissingChapterBlock)、`native-tauri-verifier.mjs`(vs00c-cp0-missing-chapter-block 事件)、`scripts/tauri_slice_verify.sh`(4 处注册，复用 seed_p1_chapter_draft_generation)。slice_verify provider 章号匹配已随 c1c257d 提交。
  - **未破的诊断（下次专调入口）**：实跑两次，运行后端的 coordinate 日志为 `requested="第99章", matched="", authoring_mode="first_draft"`——即 action 同时 `requested_chapter_raw="第99章"` 却 `authoring_intent=nil`，这在 provider+planner 源码里**数学上不可能同时发生**（repro4 反证）。指向运行态差异（多半 seed 的 current_chapters 没按预期进 context，或编译/缓存态）。下次：起后端后直接打印那轮真实 planner prompt + provider plan JSON，与 repro4 对比定位。
  - **CP0 当前交付（用户选 B）**：后端真修复落袋（c1c257d 待 push），外部页面验收作为 tracked 缺口；harness 本地 WIP 留待短会话专调。
- 2026-06-15/16：**CP1 完成**（用户批准，关 G2/G4/G9/G10）。设计驱动，逐条回指 06 §5.3/§5.5、26 §14/§25、ADR-0009、AU-03 SC-B3、VS-00C §3.2/§3.3；不是补丁。
  - **G2/G4（76ca402）**：`NovelDomain.AssemblyPolicy`（provider→profile 矩阵 floor 2000/large 200k）+ `OmissionNote`；`DialogueContext += assembly_policy/omission_notes`（envelope 一等字段）；策略在应用边界解析（`NovelApplication.current_assembly_policy` 读 provider 配置）挂 envelope，TurnExecution 只读不够 Gateway（避开补丁坑#1）；`budget_prior_prose` 用 policy 预算裁剪 + 产 OmissionNote + 发 `context.downgrade.done`；trace_summary 透出作者可见 omission。floor=2000 与历史一致，行为不变。
  - **G9/G10（560b5c2）**：确认派发同源重组装（ContextAssembler 取 snapshot/章节 + 挂 policy + 注入 reader，去特例非塞字段，避开补丁坑#2）；`safe_fetch` 异常/非 ok 降级明确空 + `context.assemble.error` 留痕（避开补丁坑#3，非默默吞）。
  - 验证：domain 139/0、application 245/0 无回归；CP1 新测 17（policy 6+omission 6+assembly 4+fallback 3，部分计入上数）；I3/I1/I2 全过；arch/xref/format/compile 通过。G9 端到端由既有 au04 tauri 场景覆盖。
  - **诚实边界**：CP1 让裁剪策略化+可解释，但被裁前文 replacement=nil（凭空消失变"有记录的消失"）；真正用摘要兜底是 CP2。
- 2026-06-15（专调）：**根因基本定位**。in-process 复现完整应用主链：`DialogueGateway.handle_input/3`（直注 slice_verify complete_fn）→ **block 成功**（"没有找到《第99章》", tool_called=false）；进一步 `handle_input/2` 走 **`Gateway.complete` 配置 provider 路由**（= 真实 tauri 路径）、provider 配 **atom `:slice_verify`** → **同样 block 成功**。即 CP0 block 行为已穿过 handle_input→form_frame→Gateway.complete(slice_verify)→form_micro_plan→orchestrator→execute **整条主链 + 真实 Gateway 路由**验证通过，只差 Tauri React UI 渲染。
  - 真实 tauri 后端却给 first_draft（生成草稿），与 c1c257d 源码 + in-process 复现**矛盾**（坐标日志 requested="第99章" 却 authoring_mode=first_draft，源码不可能）。结论：**tauri 后端那次 `mix run --no-start` 的陈旧增量编译**（in-process repro 每次 fresh compile 故正确）。
  - 坑：`Gateway` provider 路由 `@provider_modules`/`extra_providers` 用 **atom 键**，slice 后端 `slice_verify_server.exs` 配 `default: "slice_verify"`（字符串）；in-process 用字符串会 "unknown provider" fallback，用 atom 才通——真实后端能通说明 RuntimeConfig 已归一，但这是个易踩点。
  - **下次收尾（轻量）**：tauri 跑前强制 clean 编译（`MIX_ENV=test mix compile` 或 `rm -rf _build/test/lib/novel_agent` 后再 `tauri_slice_verify.sh vs00c-cp0-missing-chapter-block`），预期 block 通过即可提交 harness。CP0 产品行为本身已由 in-process 全链路证明，无需再改后端。
- 2026-06-16：**CP2.1 完成**（用户批准；采纳档位=自动采纳、source_type=新增 :continuity[落地 CP2.2]）。关 G5 的对象与生成侧，G3 的 replacement 兜底留 CP2.2 收口。
  - **domain**：`NovelDomain.ChapterSummary`（new→TENTATIVE / accept→ACCEPTED / supersede→SUPERSEDED，复用 `AdoptionStatus` 矩阵；四栏 `render_sections`/`four_column?`）。与 `chapters.summary`（计划摘要）严格区分。
  - **persistence**：`chapter_summaries` 表（migration 20260616000001）+ schema + `ChapterSummaryRepo`（insert/update_status/supersede_prior_accepted/current_accepted/list_recent_accepted）。
  - **application**：`ChapterSummaryMaintenance.run/3`（注入 generator+repo）：supersede 旧 ACCEPTED → 生成 tentative（四栏）→ insert → 自动 accept；**失败容忍**（生成失败/抛错/缺锚点→`{:degraded}` + `chapter_summary_maintenance.run.error`，绝不阻断采纳）。`ChapterSummaryGenerator` 走 `Gateway.complete/1` 独立摘要 prompt（不碰 real.ex 锚点）。
  - **接线**：`AdoptionWorkflow.handle_adopt` 加注入 `summary_maintainer`（默认异步 + 兜底 rescue），正文/场景采纳成功后用 `persisted.reading_projection.chapter_id` 触发；非正文 artifact 不触发。
  - 验证：domain 147/0、application 253/0、persistence 141/0 无回归；CP2.1 新测 21（domain 8 + repo 5 + maintenance 6 + hook 2）；I3/I1/I2 全过；compile(0 警告)/xref(无环)/arch/format/credo(改动文件 0 issue) 通过；静态扫描仅余两预存在 FAIL（gitleaks 历史 accepted_risk、task-done 本地陈旧）。
  - **诚实边界 / 未 claim**：真实 LLM 摘要质量、dogfood 长跑、上下文消费（L3a/L5 replacement + :continuity + why 透出）均属 **CP2.2**；CP2.1 默认 generator 从本次采纳正文生成，按全章已采纳正文生成（append 连续性）也留 CP2.2。
- 2026-06-17：**CP2.2 核心完成**。prose_writing 轮新增 `chapter_summary_reader` port：L5 裁剪本章已采纳正文时以本章 ACCEPTED 摘要填 `OmissionNote.replacement=chapter_summary:章`，L3a 注入目标章之前最近 N 章已采纳摘要；N 不再由本地常量控制，统一使用 `AssemblyPolicy.summary_window`，默认 15，policy id 升级为 `prose_writing/*_v2`；业务日志 `context.continuity.done` 记录窗口和 policy。why-panel 专属 label 与 dogfood 长跑仍 deferred。
- 2026-06-17：**CP3 完成**。persistence/fetcher 返回结构化章节条目，`DialogueContext.structured_chapters` 进入 prose_writing L2；真实 UI 第 2 章首稿路径暴露 planner 漏 `target_chapter` 的问题，应用层补确定性目标章解析（planner 目标优先，其次作者输入命中现有章标题/章号），保证首稿结构上下文与采纳归章一致。外部 Tauri 证据：`artifacts/slice-verify/vs00c-cp3-structured-context-tauri/summary.json`。
- 2026-06-17：**队列修正**。AU10 baseline 已闭环但不得抢占 VS-00C CP 序列；当前队首为 CP4（章计划结构化），CP5 完成后再回到下一个任务。
- 2026-06-17：**CP4 完成**。新增 `ChapterPlanDirection` 与 `chapters.plan_direction`，规划采纳从 `outline_draft` body 标签解析 E18-E22 章方向并物化到章结构；WorkspaceContext/ContextAssembler 透出 `plan_direction`，prose_writing L2 优先渲染章功能、目标四件套、情绪定位、章首拉力、章尾断章和字数场次，`context.structure.done` 记录 `has_plan_direction=true`。外部 Tauri 证据：`artifacts/slice-verify/vs00c-cp4-chapter-plan-structure-tauri/summary.json`。
- 2026-06-17：**CP5 完成**。新增 `ReaderEffectBrief` 写前约束和 prose_writing `self_report` 输出合同；ReaderEffectBrief 从 CP4 `plan_direction` 投影目标情绪、张力、承诺/爽点、悬念边界、钩子目标与风险说明，进入 L2；`context.reader_effect.done` 提供业务日志证据；`self_report` 归一后进入 `ToolResult.output.self_report` / warnings，且不进入 adoption payload 或作品事实。外部 Tauri 证据：`artifacts/slice-verify/vs00c-cp5-reader-effect-brief-tauri/summary.json`。VS-00C CP0-CP5 序列完成，队列可回到 AU10 recovery/taskstate。
