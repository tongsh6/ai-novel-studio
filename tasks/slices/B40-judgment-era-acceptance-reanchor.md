# B40：判断纪元验收重锚与证据收口

- 状态：**done（2026-10-27 CP0–CP4 批次 + 2026-10-29 §10.2 同族场景重锚批次）**。2026-10-29 批次在 current-HEAD 逐场景真跑 18 个同族场景：14 PASS、1 retired（证据充分）、其余经重锚后 PASS；全部如实 `surface=browser/driver=headless-chromium`（不冒充 native）；native 系统级覆盖缺口与新登记残余见 §10.6。B59/B61/B62 已交付的产品修复与原生证据仍以各原任务为准。
- 登记日期：2026-10-27；来源：v3 全量对账发现“实现已演进，但旧验收/台账仍停在退役链路”。
- 上游：[B27 CP5](B27-systematic-prompt-and-intent-integration.md)、[B13B §6](B13B-adr-enforcement-reconciliation.md)、[VS00D-G 对账](VS00D-G-GAP-RECONCILIATION.md)、[known-gaps](../../quality/acceptance/known-gaps.md)、[AU07](AU07-file-level-closure.md)。
- 本任务只承接明确的验收重锚、证据重跑和状态修正；若发现真实产品缺口，另立 CP0 和产品 slice，不在验收脚本里掩盖。

## 1. 问题与目标

判断纪元与 B26/B27 已改变生产主链：旧 `planner.form_frame/form_micro_plan`、AIMessageEnvelope、固定多步 MicroPlan producer 等不再存在。多份场景仍要求旧事件，导致两类错误结论：

1. 实现已有但场景不可执行或被 blocked，被误写为“产品未实现”；
2. 历史 summary 仍在，但 key events / driver / surface 已不能证明当前 HEAD。

目标是在不重写产品功能的前提下，让每个场景重新满足以下一种诚实状态：

```text
按当前生产链重锚并复跑 PASS
或 保持 blocked / 正式退役并指向当前替代证据
```

禁止通过复活旧对象、修改语义或降低断言来制造 PASS。

## 2. 开工七问

1. **Contract**：消费当前 JudgmentProtocol / AgentPlan / AuthoringTask / AgentObservation / ToolTrace / ReplayReport / ProviderExecution 契约，以及 ADR-0023/0025、VS-00D §11、VS-02、VS-06。不得恢复已退役 Envelope 或 form_frame。
2. **Invariant**：证据必须来自当前生产链和当前页面；allow 不能代替 blocked；summary 存在不等于 current-HEAD PASS；未重跑不得改 active；机制、真实模型行为与文学质量分开；不篡改产品数据或 artifact 字节。
3. **Boundary**：主要修改 `quality/acceptance/**`、外部 driver/verifier、任务与验收文档。生产 `apps/` 默认不改；若必须改，先登记真实缺口、七问和单独 checkpoint。frontend 只在已有作者可见 Why/Replay 需要同步时按设计修改，不新增旁路页面。
4. **Consumer**：quality gate / nightly 与审阅证据的人；作者通过现有 Why/Replay 查看当前真实来源。不得只为清理台账而改测试。
5. **Proof**：逐场景保存当前 key events、driver、surface、provider、request/response refs、trace/replay、summary；负向场景必须有真实拒绝或诚实退役依据。复跑 `quality_manifest_check`、NEXT/ADR/链接检查及必要局部测试。
6. **Acceptance Driver**：外部自动化驱动真实 Tauri WorkspaceChat 与现有只读探索/质量诊断/缺上下文/回放入口；产品验收感知逻辑 **no**。live provider 变体只在本机已有凭据/模型可用时运行，不能用凭据缺失去阻塞确定性重锚。
7. **Exploration**：复用 chapter_read/prose_search/archive_read 等真实只读能力取得证据；本任务不物化新作品要素，不新增专用 prompt packet 或查询分支。

## 3. 范围与承接

| 批次 | 范围 | 当前证据与完成标准 |
|---|---|---|
| CP0 | 场景/字段/证据映射 | 对每份目标场景列出旧 key events、当前生产事件与字段、driver/surface/provider、重锚或退役选择；B27 CP5 与 VS00D-G 的 G1/G3/G5/G7 关闭边界单列，不能因 AuthoringTask 存在就全关 |
| CP1 | AU11 两条 blocked | `au11-quality-diagnosis-message-envelope`、`au11-missing-workstate-policy` 改按当前 AuthoringTask/JudgmentProtocol/trace 字段验收；真实 Tauri 通过后才改 active，仍证明质量诊断有据、缺 WorkState 不编造；只读探索可有来源和覆盖记录，但不得把读取当创作/采纳写入，不得新增 canon；author-safe replay 可回查 |
| CP2 | AU07 ToolTrace | 核对当前 registry snapshot/redacted I/O 与 no-provider replay；更新 `au07-tooltrace-registry-redacted-io` driver/manifest 及 AU07 台账“实现存在、证据待重锚”的真实状态，保留 developer/多类型 UI 等真实长尾，不重建 ReplayService |
| CP3 | B13B D7/D11 与同族证据 | 以 B13B D7 的 11 份为基线，并全量纳入后续发现的旧 `planner.form_*` 场景（当前至少 22 份，其中 19 个 active、3 个 blocked；动态变化以 CP0 为准），以及 `au07-gate-reason-why` 与 VS-10；逐份迁移或正式 blocked/退役；并处理 `e2e-01-downgrade-real-page` 的 blocked/退役选择，不能用 allow 路径冒充 blocked；历史 summary 只作历史，不能代替 current-HEAD 复跑 |
| CP4 | 全量复核与收口 | quality manifest、相关场景、任务状态、known-gaps、journey/ledger/索引同步；重跑后仍失败的保留 blocked 与原因，不为了完成率降低标准 |

## 4. 非目标

- 不做第七次 B27 全量语义 retest；B27 34/40 known-gap 继续单列。
- 不恢复 AIMessageEnvelope、Planner.form_frame/form_micro_plan、synthetic task_state_events 或固定多步 producer。
- 不重写 ToolTrace、ReplayService、JudgmentProtocol 等已有生产实现。
- 不承接 AU07 developer 权限、多类型 replay UI、reason catalog 等独立长尾；它们另按真实消费者登记。
- 不把所有 known-gaps 或全部旧场景一次性纳入；`agent-provider-streaming-progress`、D21 等其他漂移需在全量验收对账中单独确认承接，不默认同批完成。
- 不修改生产代码来迁就 driver；发现真实缺口时另立任务。

## 5. 验收与证据

- CP1：两条 AU11 当前链路真实 Tauri PASS，旧 envelope 断言为零，当前字段/来源/覆盖/author-safe replay 可回查。
- CP2：只读工具 turn 证明 registry name/version/status/layer、contract refs、grant summary、redacted request/result summaries、无 raw payload、no-provider replay 与 no production write；AU07 文件不再把已有实现写成未实现。
- CP3：全量目标场景每份都有“重锚 PASS”或“blocked/退役+替代证据”的明确结果；`e2e-01-downgrade` 不允许 allow 冒充。
- CP4：quality manifest 无未解释漂移；known-gaps 只减少已真实通过项；所有未闭环后果保留 owner 和 trigger。

确定性机制、真实模型行为、原生/browser surface 分别记录。不能用 2026-06 的旧 summary 或另一 provider/surface 的证据互换。

## 6. 依赖与恢复

- 前置：B27 CP3 的 AuthoringTask 与统一语义已落地；不依赖 ADR-0030，不与 B39 求证实现捆绑。
- 并行：B39 可独立推进；本任务不阻塞其 ADR 评审。
- 若当前生产字段又变化，先更新 CP0 映射，不继续改 driver。
- 若发现生产缺口，停止验收迁移，登记真实缺口与新任务，不修改断言掩盖。
- 恢复时先读 B27 CP5、B13B D7/D11、known-gaps、AU07 与本任务；不要只读 v3 旧 slice 或历史 summary。

---

## 7. CP0 记录：旧验收对象→当前生产链映射与逐场景处置（2026-10-27，b40-reanchor）

### 7.0 方法、环境与证据口径

- **真源扫描（动态，非手工清单）**：`grep -rl "planner.form_frame|form_micro_plan" quality/acceptance/scenarios/`（11 份 manifest）；`grep -rl "ai_message_envelope" quality/acceptance/scenarios/`（2 份）；对 `frontend/slice-verify/native-tauri-verifier.mjs` 的 `sliceKeyEvents` 做全量解析 + 按行归属函数，得到 29 个仍要求退役 key events 的场景；对 `external-ui-driver.mjs` 扫描 `form_frame`=0（driver 层不读旧事件，漂移集中在 verifier/manifest）。**动态清单以本节为 CP0 准绳**（与 B13B D7 的 11 份基线有交集但不限于它）。
- **当前生产事件/字段来源**：`apps/novel_common/lib/novel_common/log_emit.ex` 全量 emit 目录 + 2026-10-23/10-25/10-27 的真实 app-log（`artifacts/slice-verify/au13-*/`、`au10-micro-plan-entry/`、`au09-character-role-taxonomy-*/`、`agent-step-regate-tauri/`）+ 生产源码（`dialogue_planning_service.ex:1249` 明确注释「judgment.decided.done 取代旧 planner.form_frame.done 的 JSONL 覆盖」；`judgment_protocol.ex:1216-1218` 冻结当前 frame_type 派生）。
- **真实模型可用性（按 Lead 2026-10-27 裁决）**：本机真实模型可用（Strata `iq3_s` 已加载）；但 **B40 按分层规则只取机制证据**（确定性 provider + native Tauri），真实模型行为语义归 [B42](B42-model-behavior-evidence-tier.md) 的 `release-real-llm` 层。B40 不加载/切换/卸载任何模型，不把机制 PASS 写成模型语义 PASS。
- **surface/provider 口径（2026-10-27 Lead 裁决后修订）**：CP1–CP3 一律 `provider=slice_verify`；`tauri_slice_verify` 默认 driver 是外部 Playwright→Vite（`isTauri=false`），summary 如实 `surface=browser / driver=headless-chromium`，**只能读作 browser-surface 产品链证据，不得写成「原生 Tauri 交互通过」**。native 系统级（AX/CGEvent）allowlist 不含本批场景；CP1/CP2 因 native 未闭环保持 blocked，CP3 家族 PASS 逐份标注 evidence_surface=browser。旧 lmstudio/scoped summary 只作历史，不得换 provider/surface 冒充 current-HEAD。
- **本次 CP0 关键新发现**（会改变场景语义，逐条给处置）：
  1. **frame_type 分类收窄（B26 `5ce6261d`）**：`JudgmentProtocol.frame_type/1` 当前只产 `creative_exploration | capability_gap | casual_reply`；`question_answer`/`meta_discussion` 已无生产者。任何断言这两个 frame_type 的场景（`gap-wt04-non-exploration-frame-badges`、旧 AU11）在判断纪元不可达 → 退役或按 `casual_reply + dialogue_goal/内容` 重锚。
  2. **普通回复的结构化来源/覆盖替代 envelope**：当前等价物是 `turn_result.frame_summary{frame_type,dialogue_goal,frame_origin,goal_origin,model_interpretation_status}` + `trace_summary.reply_record{response_kind,task_policy_version,protocol_version,source_input_ref,supplied_context_refs,coverage,model_interpretation_status,raw_content}` + `trace_summary.context_refs`（source_type=current_work/memory/session_transcript…）+ `judgment.decided.done{action,capability,frame_type,candidate_count,reason_code}`；`no_tool_reason` 当前值为 `no_tool_requested`（旧 `no_tool_needed` 仅帧纪元路径）。
  3. **专业调用契约**：`AuthoringTask` 经 `AuthoringTaskBuilder` 进入 `ToolRequest.input`（task_policy_version=b27-task-v2）；`reply_record.protocol_version=b26-tools-v1`。旧 `AIMessageEnvelope`/`guidance_mode`/`planner.form_*` 无任何生产写入路径。
  4. **持久 replay summary 不含 dialogue_goal/reply_record**：`TraceReplayService.trace_summary/2` 只保留 decision_type/no_tool_reason/gate/context_refs/tool_trace_refs 等；why 弹窗首屏用 turn_result trace summary，刷新后换成持久摘要。因此 why 断言只能覆盖持久摘要里真实存在的字段（决定/原因/无模型召回/不泄露），不能断言 envelope 的 guidance 区块。
  5. **e2e-01-downgrade 的 action_scope 降级静态不可达**（与 GATE-ORDER-CLOSURE §4 一致）：生产 `%MicroPlan{}` 构造点均为单 action；判断纪元 plan 走 `judgment_plan_v1` 跨能力计划（单步单 action），不再有「多步 MicroPlan → action_scope 降级」路径。
  6. **纯只读 character_roster turn 不再由工作台直接触发**：当前只读 `character_roster` 只在 AgentRun（如 `character_design_with_context_v1`）内部作为只读步执行（Orchestrator allow_tool + Toolbox + ToolTrace + 中间步 TurnResult 广播）。AU-07 ToolTrace 场景据此重锚到「只读工具步」，而不是伪造纯只读 turn。
  7. **旧 missing-WorkState 结构化 envelope 已退役**：当前语义是「覆盖如实 + prompt 不编造」（判断 prompt 的 `## 作品事实` 段如实给「正文统计：N 章中已写 M 章」）；why 面板不再有 envelope 缺失区块。缺 WorkState 的「要求补材料且不宣称已读」保留为场景断言（确定性替身按真实 prompt 的 0 章事实产出该语义）；真实模型行为层归 B42。

### 7.1 旧对象→当前生产链字段映射（CP0 主表）

| 旧验收对象（退役） | 当前生产链真实事件/字段 | 证据锚点（生产源码/真实 app-log） | 重锚结论 |
|---|---|---|---|
| `planner.form_frame.start/done` | `judgment.decided.done{action,capability,frame_type,candidate_count,reason_code}` + `turn_result.frame_summary{frame_type,dialogue_goal,frame_origin,goal_origin,model_interpretation_status}` | `dialogue_planning_service.ex:1249-1260`（注释：取代旧 form_frame JSONL 覆盖）；`au13`/`au10` 真实 app-log | 各场景 key events 用 `judgment.decided.done`；frame_type 断言按 B26 收窄后的值 |
| `planner.form_micro_plan.start/done` | `judgment.decided.done{action=execute/plan}` → `orchestrator.decide.start/done{decision_type,gate_order_version,gate_outcomes}` → `toolbox.execute.start/done`；跨能力计划走 `judgment_plan_v1` + `plan_draft.*`/`agent_event` | `execution_orchestrator.ex`、`gate_order.ex`、`agent-step-regate` 真实 app-log（每条 12 门 lineage） | 不再要求 form_micro_plan；tool turn 断言 gate lineage + toolbox |
| `dialogue_gateway.handle_input.start/done` | 已无同名事件；等价链为 `channel.user_message.start` → `context.assemble.*` → `judgment.decided.done` → `channel.user_message.done` | `workspace_channel.ex`、真实 app-log | 从 key events 移除`dialogue_gateway.handle_input.*` |
| `AIMessageEnvelope`（`trace_summary.ai_message_envelope`、`guidance_mode`、novel/work_state/turn_guidance layer） | `trace_summary.reply_record` + `turn_result.frame_summary` + `trace_summary.context_refs` + `judgment.decided.done`；专业调用见 `AuthoringTask.to_input/1`（b27-task-v2） | `judgment_protocol.ex:1193-1214`（reply_record）、`trace_writer.ex:332-336`（reply_record 入 author-safe summary）、`turn_result_builder.ex:40-59` | AU11 两个场景按此重锚（CP1） |
| `guidance_mode=quality` / 质量诊断 mode 结构化字段 | 判断纪元普通回复：`frame_type=casual_reply`、`decision_type=reply_only`、`no_tool_reason=no_tool_requested`；质量关注点（conflict/cost/reader payoff）当前只存在于模型回复文本与 `dialogue_goal`，不再是结构化 trace 字段 | `judgment_protocol.ex:1216-1218`；真实 `au11-quality` run 的 turn_result（2026-10-27） | 质量诊断的「具体取舍」断言保留在回复文本层（机制=provider 字节绑定）；结构化质量分类的模型语义归 B42 |
| `WorkStateLayer` 缺失 map / `missing_questions` | `context.assemble.done{has_snapshot,context_refs_count}` + `trace_summary.reply_record.supplied_context_refs`/`context_refs` + 判断 prompt 的 `## 作品事实` 段（`正文统计：N 章中已写 M 章`） | `context_assembler.ex:build_refs`、`dialogue_planning_service.ex:judgment_work_facts_section`；真实 `au11-missing` prompt | CP1：覆盖如实 + prompt 不编造 + 回复要求补材料；why 的 envelope 缺失区块退役 |
| `provider_progress_v1` profile/计划目录/预算事件 | `provider_gateway.complete.start/done` + `agent_event` provider activity（unified/error-author-safe 场景）+ `AgentEvent :provider_progress` 仅保留投影 | B27 CP3c 退役批次；`agent-provider-execution-stream-unified`/`error-author-safe` | `agent-provider-streaming-progress`（profile 已退役）→ retired；unified/error 场景保留机制断言 |
| multi-step `%MicroPlan{}` + `action_scope` 降级 | 无生产者（全仓 MicroPlan 构造点单 action；判断纪元 plan 走 `judgment_plan_v1` 单步单 action） | GATE-ORDER-CLOSURE §4；`gate_order.ex` 12 门仍存在，但 action_scope 降级无触发者 | `e2e-01-downgrade-real-page`、`au07-gate-reason-why` → **合并退役**（替代证据见 7.3） |
| `question_answer`/`meta_discussion` frame badges | 当前 frame_type 只有 3 值（见发现 1）；UI 仍保留 badge 文案但无生产者 | `judgment_protocol.ex:1216-1218`、`frontend/src/lib/framePresentation.ts` | `gap-wt04-non-exploration-frame-badges` → retired（B26 收窄证据） |
| 「纯只读 character_roster turn」 | AgentRun 内部只读步：`orchestrator.decide.done{allow_tool}` + `context.characters.done{character_dossier}` + `toolbox.execute.done{character_roster,succeeded}` + 该步 `turn_result` 广播 + 持久 trace `tool_trace_refs` | `agent-step-regate`/`au09-character-role-taxonomy-*` 真实 app-log；`character_design_with_context.ex:250-330` | AU-07/E2E 只读 ToolTrace 三场景重锚到该只读步（CP2） |
| `generate_micro_plan` 传输字段 | **仍存在且为真实 UI/socket 字段**（普通聊天 false；档案/修订动作 true） | `frontend/src/lib/socket.ts`、`workspace_channel.ex:220` | 保留断言；不当作退役对象 |

### 7.2 目标场景清单与逐份处置（CP0 裁决）

> 记号：**Reanchor**=改 driver/verifier/manifest 到当前链并 current-HEAD 真跑 PASS；**Retire**=正式退役（registry/manifest 移除 + known-gaps retired + 替代证据）；**Blocked**=保留 registry blocked + 具体原因/触发条件；**Pending**=机械迁移完成但本轮预算内未跑（保持 active 但 verifier 已按当前链更新，交 CP4/nightly 复跑；不允许写 PASS）。

**A. CP1（AU11，2 份，全部 blocked→重锚）**

| 场景 | 旧断言对象 | 当前等价断言（机制层） | 处置 |
|---|---|---|---|
| `au11-quality-diagnosis-message-envelope` | envelope 三层 + guidance_mode=quality + planner.form_frame | `frame_type=casual_reply`、`decision_type=reply_only`、`no_tool_reason=no_tool_requested`；reply_record 版本/来源/覆盖（b27-task-v2 / b26-tools-v1 / supplied_context_refs≥1 / current_work+memory context_refs）；assistant 字节=provider 输出（N-NARR）；回复含阻力/代价/读者回报；判断 prompt 含真实作品事实且 `已写 1 章`；why=决定+无模型召回；no tool/adoption/write | Reanchor → 真跑 PASS 后 active |
| `au11-missing-workstate-policy` | envelope WorkState missing map + planner.form_frame | `context.assemble.done has_snapshot` + 空白作品 context_refs（无 memory）；判断 prompt 如实 `正文统计：0 章中已写 0 章` 且无 `## 章节列表`/无虚构章节；assistant 要求补材料、不宣称已读、不编造林烬等种子事实；reply_record 字节绑定；no tool/adoption/write；why=决定+无模型召回 | Reanchor → 真跑 PASS 后 active |

**B. CP2（AU-07 ToolTrace 与 E2E tool trace，3 份重锚 + 1 份退役）**

| 场景 | 旧断言对象 | 当前等价断言 | 处置 |
|---|---|---|---|
| `au07-tooltrace-registry-redacted-io` | 纯只读 turn + lmstudio + planner.form_* | AgentRun 只读步持久 trace：registry snapshot(name/version/status/layer)、input/output contract refs、grant summary、redacted request/result summaries（payload_stored=false）、no raw payload；ReplayReport no-provider + tool_trace 链；只读步 no state_delta/artifact_refs；无 author_action/adoption；no production write | Reanchor（机制层，provider=slice_verify） |
| `e2e-01-readonly-tool-trace` | 同上（summary 级 refs） | 同只读步 + `TraceRepository.list_by_turn` 返回 tool_trace_ref | Reanchor（机制层） |
| `e2e-01-replay-report` | 同上 + 六问 | 同只读步 + ReplayReport 六问 answered/not_applicable + 链含 frame/plan/decision/tool_trace/turn_result + provider_called=false | Reanchor（机制层） |
| `au07-gate-reason-why` | action_scope 降级 + lmstudio + planner.form_* | 无当前生产等价物（降级静态不可达） | **Retire**；替代证据 = `agent-step-regate` current-HEAD 真跑（12 门 allow lineage + 作者安全 why/无模型召回）+ `gate_order_closure_test` blocked 路径单测 |

**C. CP3-A（B13B D7 基线剩余 8 份）**

| 场景 | 现状 | 处置 |
|---|---|---|
| `au01-empty-message-guard` | manifest 旧断言；KEY_EVENTS 已当前；driver 对 disabled 发送按钮会超时（实跑暴露） | Reanchor：driver 改断言「发送不可用」，manifest 改 judgment 链 → 真跑 |
| `au01-frame-validation-friendly-error` | manifest 旧断言；verifier behavior 已当前（负向无 form_micro_plan + judgment 链） | Reanchor：manifest 断言改写 + 真跑 |
| `au01-garbage-json-recovery` | 同上 | Reanchor + 真跑 |
| `au01-ordinary-chat-two-turn-roundtrip` | 同上（KEY_EVENTS 已当前） | Reanchor + 真跑 |
| `au02-candidate-fallback-ui` | manifest 旧 `planner.form_frame.done` frame_type/candidate_count | Reanchor 到 `judgment.decided.done{frame_type=creative_exploration,candidate_count≥2}` + 真跑 |
| `au02-natural-exploration-no-slot-form` | 同上 | Reanchor + 真跑 |
| `e2e-01-downgrade-real-page` | 多步 MicroPlan 降级静态不可达（发现 5） | **Retire**（替代证据见 7.3） |
| `au07-gate-reason-why` | 见 CP2 | **Retire** |

**D. CP3-B（同族动态清单，29 个旧 key-event 场景去掉已列项）**

| 场景 | 漂移类型 | 处置 |
|---|---|---|
| `vs10-observability-spine`（pr-smoke/browser） | driver+manifest 仍以帧纪元 key events；B41 实跑 fail（`driver_stale`） | Reanchor driver 到 `judgment.decided.done/orchestrator.decide.done/toolbox.execute.done` + current team 真跑（browser surface） |
| `au01-turnresult-recorder-ui-consistency`、`au02-candidate-continuation`、`au02-candidate-multiturn-context`、`au02-freeform-followup-after-candidate`、`au02-unadopted-candidate-no-reading-fact`、`au02-candidate-adoption-bridge`、`p1-chapter-draft-generation`、`p1-prose-execution-brief` | driver 有 07-17~10-22 判断纪元 PASS 证据；verifier behavior 已当前、仅 KEY_EVENTS/断言文字残留旧事件 | Reanchor（迁移 key events/断言）+ current-HEAD 复跑（能跑多少跑多少；未跑项保持 active 但 verifier 已按当前链，交 nightly 复跑，**不得写 PASS**） |
| `gap-wt04-non-exploration-frame-badges` | `question_answer/meta_discussion` 无生产者（发现 1） | **Retire**（B26 收窄证据） |
| `au05-adoption-safety-freshness` | 06 月旧 driver + 无 summary（F12） | Blocked：`evidence_missing`（旧 driver 未迁移，nightly 复跑前不得 PASS）；触发=driver 重锚批次 |
| `au03-context-source-ui`、`au03-current-work-context-ssot`、`au03-long-session-compression`、`au07-trace-why-entry`、`au09-au03-session-memory-layering`、`au12-correction-intent-roundtrip`、`vs00c-cp3/cp4/cp5` | 06 月旧 driver/manifest，KEY_EVENTS 含 `planner.form_*`；其中 `au03-context-source-ui` 已有判断纪元 driver 复用路径 | Pending/Blocked：本轮按 CP0 只做映射，重锚归下一批；保持 blocked 或 active? 见 7.4 残余（不静默 active-red） |
| `agent-provider-streaming-progress` | `provider_progress_v1` profile 已退役（F10） | **Retire**；替代证据=`agent-provider-execution-stream-unified`/`agent-provider-execution-error-author-safe` 机制证据 |
| `judgment-explore-internal` | blocked + 无 summary（F12） | 保持 blocked（`evidence_missing`）；重跑触发=judgment explore driver 迁移批次 |
| `au10-micro-plan-entry`（pr-smoke/browser） | F14 legacy MicroPlan 入口；05 月旧证据 | **Retire**；替代证据=`p1-chapter-plan-minimum`（judgment→orchestrator→toolbox 规划链）+ e2e plan 场景；pr-smoke 选择当前可运行最小真实路径 |
| `au10-ordinary-chat-no-micro-plan` | 未注册（registry 无此 id） | 不纳入（无 registry 对象） |

> **不纳入本批**（B40 非目标范围）：`agent-provider-streaming-progress` 之外的 provider 长跑进度新 slice、AU07 developer 权限/多类型 UI/reason catalog 长尾、D21 等其他漂移、`F15` 重复 bounded roster 合并（见 7.4 残余）。

### 7.3 退役裁决与替代证据（Retire 明细）

| 退役对象 | 退役依据 | 替代证据（current-HEAD 真跑优先） |
|---|---|---|
| `e2e-01-downgrade-real-page` | 判断纪元无 multi-step `%MicroPlan{}` 生产者，`action_scope` 降级静态不可达（GATE-ORDER-CLOSURE §4 已有裁决；本轮复核 7.0-5） | ① `agent-step-regate`：current-HEAD 真实 Tauri PASS，逐 step 12 门 gate lineage（allow 路径）+ 作者安全 why/无模型召回断言（本轮加到该 driver/verifier）；② `gate_order_closure_test`：blocked 路径单测矩阵（只作单测证据）；③ 从 `scenarios.yml`/manifest 移除，known-gaps 记 `retired` |
| `au07-gate-reason-why` | 同上（action_scope 降级无生产者）；why 面板的持久 replay summary 已无 gate-blocking 文本来源（发现 4） | 同 ①/②；gate reason 的「作者安全解释」断言挂到 `agent-step-regate` 的 why 面板（决定/无模型召回/不泄露）+ 12 门 lineage；不伪造 allow 路径为降级 PASS |
| `gap-wt04-non-exploration-frame-badges` | B26 起 `JudgmentProtocol.frame_type` 只产 3 值，`question_answer/meta_discussion` 无生产者（发现 1） | `au01-ordinary-chat-two-turn-roundtrip`（普通回复链）+ `au01-turnresult-recorder-ui-consistency`（frame 展示一致性）current-HEAD 复跑；frame badge 的语义收窄由 B26 决策与 UI contract 承接 |
| `agent-provider-streaming-progress` | `provider_progress_v1` profile/计划目录/预算已退役（B27 CP3c；F10） | `agent-provider-execution-stream-unified`、`agent-provider-execution-error-author-safe` 的 provider activity/error author-safe 机制证据（保留 active） |
| `au10-micro-plan-entry` | F14：legacy MicroPlan 入口语义已退役 | `p1-chapter-plan-minimum`（judgment→orchestrator→toolbox 规划链）current-HEAD 复跑 + `judgment-plan-multi-step` 计划证据 |

### 7.4 CP0 残余（诚实边界，转 CP3/CP4 或 B42）

1. **同族旧 driver 场景**（`au03-*`、`au05-adoption-safety-freshness`、`au07-trace-why-entry`、`au09-au03-*`、`au12-correction-intent-roundtrip`、`vs00c-*`）本轮只完成映射与 KEY_EVENTS/断言迁移评估；若不能在预算内 current-HEAD 真跑 PASS，则保留 blocked（原因=旧 driver 未迁移/无 current 证据），**不得静默写成 PASS 或降级断言**。触发条件：下一批 driver 重锚（同 B40 CP3 流程）。
2. **真实模型行为层**：AU11 质量诊断的「模型真的按质量原则给出取舍」、AU07 的「真实模型选择只读工具」等语义属 B42 `release-real-llm`；B40 只声明机制证据（确定性 provider + native surface），verdict 层 `model_behavior=not_applicable`，不得把机制 PASS 读成模型 PASS。
3. **why 面板能力边界**：持久 replay summary 无 dialogue_goal/reply_record/missing 区块（发现 4），故 why 断言只能覆盖决定/原因/无模型召回/不泄露；如需更丰富的作者解释，另立产品 slice（不在 B40 修产品）。
4. **F15 重复 bounded roster**：`ua01-agent-bounded-roster-to-character-design` 与 `agent-bounded-roster-to-character-design` 仍是同一 canonical driver/verifier 的两条 registry 项（nightly 双跑）；合并/别名化属验收维护后续项，本轮未动。
5. **E2E-01 聚合**：E4 退役后需把聚合矩阵 E4 指向替代证据（agent-step-regate），E10（持久化闭环无独立真实页面 artifact）仍 `evidence_missing`；聚合器在 CP3 重算并记录 honest 状态。

## 8. CP1 实现记录：AU11 两条 blocked 重锚（2026-10-27，b40-reanchor）

> **2026-10-27 Lead surface 裁决覆盖状态**：本节 8.1/8.2 记录的是「按当前生产字段重锚 + browser-surface 机制预验」；因 native 系统级驱动未实现，两条场景 **registry 仍为 blocked**（不得用 browser 证据改 active）。证据只能读作 **browser-surface 机制预验**（summary `surface=browser / driver=headless-chromium`），不读作 native PASS；native 闭环触发条件见 8.4。

### 8.1 结论

| 场景 | 结果 | 证据（browser-surface 机制预验；最终状态见 8.4） | 备注 |
|---|---|---|---|
| `au11-quality-diagnosis-message-envelope` | **blocked（重锚完成，native PASS 未闭环）** | `artifacts/slice-verify/au11-quality-diagnosis-message-envelope-tauri/summary.json`（`surface=browser / driver=headless-chromium`）；机制预验时 verdict 曾 pass，随后按 Lead surface 裁决改写为 `status=skipped / reason=native_system_driver_missing`，旧 pass 归档 `verdict-history/`（见 8.4） | 旧 envelope 断言零保留；按判断纪元普通回复来源/覆盖 + N-NARR 字节绑定 + author-safe why 重锚 |
| `au11-missing-workstate-policy` | **blocked（重锚完成，native PASS 未闭环）** | 同左（browser-surface 机制预验；verdict 改写 skipped/native_system_driver_missing） | 覆盖如实（空白作品 context_refs=[]）+ 判断 prompt 0 章事实不编造 + 回复要求补材料/不宣称已读 |

### 8.2 改动清单

| 文件 | 改动 | 理由 |
|---|---|---|
| `frontend/slice-verify/external-ui-driver.mjs` | 重写 `driveAu11QualityDiagnosisMessageEnvelope` / `driveAu11MissingWorkstatePolicy` | 旧 driver 等待 `trace_summary.ai_message_envelope`（已退役）。新 driver 只读当前真实链：turn_result frame_summary/trace_summary.reply_record/context_refs/truthfulness + app-log judgment.decided.done/context.assemble.done/channel.user_message.done + why 面板；why 断言=决定标签+「不会重新调用模型」+无 raw/trace。质量诊断保留「具体取舍（阻力/代价/读者回报）」断言；缺 WorkState 保留「要求补材料且不宣称已读、不编造种子事实」断言。 |
| `frontend/slice-verify/native-tauri-verifier.mjs` | 重写 AU11 两个 finder/behavior + 更新两者 `sliceKeyEvents` + dispatch 传 options（promptRecords） | verifier 由 envelope 三层字段改为 reply_record/context_refs/judgment events；新增模型请求外部证据：质量场景判断 prompt 必须含真实作品事实且「已写 1 章」，缺失场景必须「0 章」且无 `## 章节列表`/无虚构章节。单测 245/245。 |
| `frontend/slice-verify/native-tauri-verifier.test.mjs` | 替换 AU11 两个单测为判断纪元契约（含 promptRecords 证据） | 与新 finder/behavior 同源；245/245 |
| `scripts/seed_au11_quality_diagnosis_message_envelope.exs` | 追加第 1 章已采纳正文（保留章节计划采纳） | 判断纪元质量诊断需要真实「已写 1 章」当前作品事实；旧 envelope 时代由 envelope 读 chapter_lines，现已无该路径。seed 只造事实，不预制裁断结论。 |
| `apps/novel_agent/test/support/provider/slice_verify.ex` | `quality_context_missing_prompt?/1` 改为只读真实判断 prompt 的作品事实口径（`## 当前作品上下文` + `正文统计：…已写 0 章`） | 旧「缺章节摘要」标记随 envelope 退役。新判定只读真实生产 prompt 文本（不读 slice id/env/验收开关），是确定性替身的机制对齐；Lead 已批准。 |
| `quality/acceptance/scenarios/au11-quality-diagnosis-message-envelope.yml`、`au11-missing-workstate-policy.yml` | 断言改写为当前链；保留原契约引用（VS-00D / AU-11 acceptance / interaction model），B40 只作 `execution_source` | 重锚是换被测字段，不是换被测契约 |
| `quality/acceptance/scenarios.yml` | 两条标题/entrypoint/blocked_reason 更新；**registry 保持 `blocked`**（Lead surface 裁决，见 8.4；native PASS 未闭环不得改 active） | 重锚是换被测字段，不是降低 surface 标准 |
| `quality/acceptance/known-gaps.md` | 删除两条 blocked 行；登记 CP1 重锚结果与证据 | blocked 表只保留真实不可执行场景 |

### 8.3 诚实边界（不得读成模型语义 PASS）

- 两条 verdict 均为 `provider=slice_verify`、`mechanism=pass`、`model_behavior=not_applicable`。质量诊断「模型真的给出质量取舍」、缺 WorkState 时真实模型「主动索要材料而不编造」的行为语义属 **B42 `release-real-llm` 层**，B40 不声明。
- `verdict.json.git_head` 是运行时刻的 `git rev-parse HEAD`（本会话期间 HEAD 因其他成员提交而前进：`8c6194c0` / `d6bc69a4`）；B40 改动本身尚未提交。提交后如需聚合器 `freshness=current`，应在提交后复跑一次（触发条件见 CP4/交接）。
- why 面板当前持久 replay summary 不含 `dialogue_goal`/`reply_record`/envelope 缺失区块（CP0 发现 4），故 why 断言只覆盖决定/原因/无模型召回/不泄露；更丰富的作者解释需另立产品 slice。

### 8.4 CP1 surface 诚实性裁决后的最终状态（Lead 2026-10-27）

- **registry**：`au11-quality-diagnosis-message-envelope`、`au11-missing-workstate-policy` 均为 `status: blocked`，`blocked_reason` 写明「browser-surface 机制预验通过，但 native 系统级驱动（AX/CGEvent）未实现，native PASS 未闭环；不得用 browser 证据改 active」。
- **证据定位**：`summary.json` 如实 `surface=browser / driver=headless-chromium / tauri_window_launched=true`（tauri_slice_verify 默认 Playwright→Vite 驱动，Tauri 窗口仅启动）；`verdict.json` 已按诚实状态改写为 `status=skipped`（reason=native_system_driver_missing，旧 pass 归档到 `verdict-history/`；`surface=tauri` 来自 registry 字段，读方以 status/reason 为准，不读作 PASS）。
- **机制预验内容有效**：driver/verifier/manifest/seed/fixture 的重锚本身是可复用的，一旦 native driver 落地可直接复用断言与证据要求。
- **native 闭环触发条件**：(1) 新增 native AU11 driver（AX 读取聊天输入/发送/为什么 + CGEvent 输入）与 evidence checker；(2) 注册 `TAURI_NATIVE_SYSTEM_DRIVER=1` allowlist；(3) 原生 run 产物（native transport/AX/AX 截图/DB snapshot）通过 verifier；(4) 之后才把 registry 改 active。
- **真实模型语义**（质量诊断模型取舍、缺材料时模型主动索要）仍归 B42 `release-real-llm`。

## 9. CP2 记录：AU-07 ToolTrace / E2E 只读工具步（2026-10-27，b40-reanchor）

### 9.1 结论（blocked，两个独立原因）

| 场景 | 结论 | reason |
|---|---|---|
| `au07-tooltrace-registry-redacted-io` | **blocked** | ① native 系统级驱动未实现（allowlist 不含）；② 判断纪元 AgentRun 内部只读步 `DecisionTrace` 未持久化：`do_execute_tool_step` 丢弃 `TurnExecutionService.execute` 返回的 trace（`character_design_with_context.ex:300-345`），本轮真实 run 按 step turn_id (`message_…:agent:3`) 查询 `TraceRepository.list_by_turn` 返回 **0 条**，因此 ToolTrace registry snapshot/redacted I/O 无当前可达的持久回查路径。ToolTrace 实现（TraceWriter.record_with_tool → registry_snapshot/contract_refs/grant_summary/redacted summaries）仍存在，缺的是 AgentRun step trace persistence + native driver。 |
| `e2e-01-readonly-tool-trace` / `e2e-01-replay-report` | **blocked** | 同一持久化缺口（纯只读 turn + 持久 ToolTrace 回查无当前生产者）+ native driver 未实现；不以旧 lmstudio summary / browser 机制预验代签。 |

### 9.1b B61 native 关闭（2026-10-28）

B40 的 native 缺口已由 [B61](B61-native-acceptance-driver-coverage.md) 关闭：AU11×2、AU07×3 在真实 Tauri 窗口以 AX/CGEvent 外部驱动取得原生 PASS（`driver=ax-native-system-ui / surface=tauri`），AU11 42/41 checks、AU07 29/29 checks、trace count=1；五条场景 registry 已按证据改 `active`。B40 CP1/CP2 的 browser-surface 结论保留为历史，不再作为 active 的依据。

### 9.1a B59 修复追记（2026-10-27，B59 done）

B40 登记的 AgentRun step DecisionTrace 持久化缺口已由 [B59](B59-agent-run-step-trace-persistence.md) 完成（5 flow 接线 + planner spec trace_persister 注入 + 单测/flow 级断言）。修复后三个场景 scoped 复验全部通过（browser-surface，如实标注）：au07-tooltrace（`trace-query.json` count=1，含 registry snapshot/合同 refs/grant summary/redacted IO/no-provider ReplayReport）、e2e-01-readonly-tool-trace、e2e-01-replay-report。三个场景 registry 仍保持 blocked，**唯一剩余原因=native 系统级驱动未实现**；B40 记录的历史失败证据路径已被修复后 scoped PASS 覆盖（同一 artifact 目录），历史结论保留在 §9.1 文本与提交历史。

### 9.2 本轮已完成的可复用重锚（保留，供缺口修复后直接复跑）

- driver：`driveE2E01ReadonlyToolTrace` 改为「先看当前角色阵容，再设计反派」→ bounded AgentRun 内部只读 `character_roster` 步（真实 Orchestrator allow_tool + context.characters + toolbox + 中间步 turn_result 广播），再按 step turn_id 查产品持久 trace；`driveE2E01ReplayReport`/`driveAu07TooltraceRegistryRedactedIo` 复用同一只读步证据。
- verifier：e2e-01/au07 三个 finder/behavior 按只读步事件（orchestrator.decide.done/context.characters.done/toolbox.execute.done/step turn_result）重写；KEY_EVENTS 同步；单测 245/245。
- manifests：三份断言改为「readonly roster tool step + registry/redaction/no-provider replay/no production write」语义；provider 改 slice_verify（机制层）。
- **实跑证据（失败，只读保留）**：`artifacts/slice-verify/au07-tooltrace-registry-redacted-io-tauri/`（`trace-query.json` turn_id=`…:agent:3`、count=0；app-log 证明只读步真实执行 `toolbox.execute.done character_roster succeeded`）。该失败佐证了 9.1②，不是验收脚手架错误。
- 若未来补齐 step trace persistence：只需把 driver 的 trace 查找从「按 step turn 查」改为产品实际持久范围（或在产品侧持久化 step trace），并照常以 native 系统级驱动复跑。

### 9.3 同时完成的 AU-07 台账修正

- `au07-gate-reason-why` 与 `e2e-01-downgrade-real-page` 已按 7.3 正式退役（registry/manifest 移除、known-gaps `retired`、替代证据=`agent-step-regate` + `gate_order_closure_test`）。
- AU07 文件级台账 §2/§6 同步「实现存在、证据待重锚」；本任务已复核：ToolTrace 实现仍在，但判断纪元 step trace 持久化路径缺失（9.1②），不得把历史 lmstudio 证据当 current。

## 10. CP3 记录：D7 家族与同族场景重锚/退役/真跑（2026-10-27，b40-reanchor）

> **surface 口径（Lead 2026-10-27 裁决）**：CP3 家族允许 `tauri_slice_verify`（默认 Playwright→Vite）产品链证据，但**一律记录 evidence_surface=browser / driver=headless-chromium**，不得写成「原生 Tauri 交互通过」。native 系统级未覆盖缺口汇总见 known-gaps。

### 10.1 逐场景结论表（current-HEAD 真跑复核）

| 场景 | CP0 旧对象 | 处置 | 证据（summary/verdict） | evidence_surface |
|---|---|---|---|---|
| `au01-empty-message-guard` | 旧断言「空消息无 turn」；driver 对禁用发送按钮会超时 | **重锚 PASS**：driver 按真实产品「空输入禁用发送」尝试；verifier/manifest 迁 judgment 链 | `artifacts/slice-verify/au01-empty-message-guard-tauri/`（verdict pass，git_head d6bc69a4） | browser / headless-chromium |
| `au01-ordinary-chat-two-turn-roundtrip` | `planner.form_frame`/`form_micro_plan` 断言 | **重锚 PASS**：`judgment.decided.done` 两轮链 + 无退役事件负向断言 | `.../au01-ordinary-chat-two-turn-roundtrip-tauri/`（verdict pass） | browser / headless-chromium |
| `au01-frame-validation-friendly-error` | 旧 fallback 文案/断言 | **重锚 PASS**：断言改为产品意图（友好可重试、无 raw/internal 泄漏、恢复轮完成），不锁文案版本 | `.../au01-frame-validation-friendly-error-tauri/`（verdict pass） | browser / headless-chromium |
| `au02-natural-exploration-no-slot-form` | `planner.form_frame` frame_type creative_exploration 断言 | **重锚 PASS**：`judgment.decided.done{frame_type=creative_exploration,candidate_count>0}` + 无工具/采纳卡片 | `.../au02-natural-exploration-no-slot-form-tauri/`（verdict pass） | browser / headless-chromium |
| `agent-step-regate` | 无（本不是 D7 项，作为 E4 替代证据重跑） | **重锚 PASS**：判断纪元 provider 调用数从 3→2 的断言按当前链修正（判断 1 + 机械计划 0 + writer 1）；新增 author-safe why/gate 断言（决定标签、无模型召回、无内部 gate/prompt 文本） | `.../agent-step-regate-tauri/`（verdict pass，git_head d6bc69a4） | browser / headless-chromium |
| `pr-smoke-core-reply`（新增） | F14：legacy au10-micro-plan-entry 退役后 pr-smoke 需当前可执行最小真实路径 | **新增并 PASS**：pr-smoke/tauri，复用普通聊天两轮 driver/verifier，判断纪元 reply 链 | `artifacts/slice-verify/pr-smoke-core-reply-tauri/` | browser / headless-chromium |
| `vs10-observability-spine` | driver 仍等待 `planner.form_frame/form_micro_plan` | **重锚 PASS**：key events 迁 `judgment.decided.done` + `orchestrator.decide.done`/`toolbox.execute.done`；修正 agent-run 父 turn / `<parent>:agent:N` 关联 | `artifacts/slice-verify/vs10-observability-spine/`（verdict pass，git_head d6bc69a4） | browser / headless-chromium |
| `au02-candidate-fallback-ui` | `planner.form_frame.done candidate_count>=2` fallback 断言 | **blocked**：判断纪元候选帧只能由 `propose_creative_directions` 工具产生；坏/空候选在协议校验层安全失败或落为 casual_reply（候选被丢弃），到不了应用 `Planner.fallback_candidates`；应用兜底代码仍在但无当前可达生产者（触发=协议/产品裁决或真实模型产出该路径） | `.../au02-candidate-fallback-ui-tauri/`（失败证据只读保留 + verdict fail） | — |
| `au01-garbage-json-recovery` | 「LLM 乱码 JSON 降级」 | **retired**：判断纪元 provider 契约=自然语言 content + 可选原生工具调用，不存在「必须可解析 JSON」；实测 garbage 标记文本被当作普通回复原样展示，旧语义无生产者。替代=frame-validation 安全终局 + `agent-provider-execution-error-author-safe` | 历史失败证据保留；registry/manifest 已移除 | — |
| `gap-wt04-non-exploration-frame-badges` | `question_answer`/`meta_discussion` badge | **retired**：B26（5ce6261d）起 frame_type 只产 3 值，无生产者；历史 07-24 证据早于收窄，不是当前证据 | 见 known-gaps retired | — |
| `e2e-01-downgrade-real-page` / `au07-gate-reason-why` | 多步 MicroPlan → action_scope 降级 | **retired**：判断纪元无 multi-step MicroPlan 生产者；替代=`agent-step-regate`（本轮 PASS，含 why/gate 断言）+ `gate_order_closure_test`（blocked 路径单测） | `.../agent-step-regate-tauri/` | browser / headless-chromium |
| `agent-provider-streaming-progress` / `au10-micro-plan-entry` | provider_progress_v1 / legacy MicroPlan 入口 | **retired**（F10/F14）；pr-smoke 由 `pr-smoke-core-reply` 承接 | 见 known-gaps | — |

### 10.2 未在预算内完成/保留 blocked 的同族项（诚实清单）

- 状态：**done（2026-10-29；结果矩阵、重锚映射与残余见 §10.6）**。下列原始清单保留为批次前事实。
- 排期理由：当前验收入口和旧事件断言的偏差不能因前批收口消失；复用 B61/B62 已有原生 harness，不等待 ADR-0030。
- 下一步：先按当前 verifier/manifest/summary 逐项重新核对，避免重做已由后续批次补齐的内容；首批优先 `p1-chapter-draft-generation`、`p1-prose-execution-brief`、`au01-turnresult-recorder-ui-consistency`，其余按下列同族逐项接续。首批不是完整验收范围的替代。
- 完成标准：每个原场景有当前生产链的重锚或有依据的退役、证据 surface/driver、失败与 freshness；原生交互需求按场景补齐，browser 证据不能代签。同步 E2E 聚合受影响证据；历史 PASS 保留为历史。发现产品缺陷回原业务任务或先补 slice 设计，不能靠改断言掩盖。
- 独立阻塞：`au02-candidate-fallback-ui` 的产品/协议裁决仍见 §10.1，不阻塞其他可达场景；不可达路径不得编造 producer。

- `vs10-observability-spine`：**已重锚 PASS**（`verdict pass`，git_head d6bc69a4，browser-surface）；旧 `planner.form_frame/form_micro_plan` 等待与父子 turn 关联问题已修。
- `p1-chapter-draft-generation`、`p1-prose-execution-brief`、`au01-turnresult-recorder-ui-consistency`、`au02-candidate-continuation/multiturn/freeform/unadopted/bridge`：有 07–10 月判断纪元历史 PASS 证据，但**未在本轮 current-HEAD 复跑**；verifier KEY_EVENTS/断言未全部迁移，保留 active 但不得以历史证据代签（nightly 复跑前不写 PASS）。
- `au03-context-source-ui`、`au03-current-work-context-ssot`、`au03-long-session-compression`、`au05-adoption-safety-freshness`、`au07-trace-why-entry`、`au09-au03-session-memory-layering`、`au12-correction-intent-roundtrip`、`vs00c-cp3/cp4/cp5`：06 月旧 driver + 旧 KEY_EVENTS，本轮仅完成映射，未真跑；保持现状并交下一批（触发=同流程重锚）。
- 以上未完成后项不阻塞 CP0–CP3 的映射/退役/已跑部分；但它们不得被读作「当前 HEAD 已验收」。

### 10.3 本轮新增/变更的验收与质量资产

- 新增 pr-smoke 场景 `pr-smoke-core-reply`（manifest+registry+driver/verifier 复用+tauri 白名单）。
- `scripts/e2e_01_full_chain_check.sh`：E4 改指 agent-step-regate；E6/E9 改 deterministic `-tauri`；E11 改指 frame-validation；artifact expectations 同步 provider（slice_verify）与断言。
- `scripts/lib/quality/e2e_status.test.mjs`：新增 E4 replacement fresh-verdict 回归；`node --test` 57/57。
- `scripts/tauri_slice_verify.sh`：注册 pr-smoke-core-reply；移除已退役 id 白名单。
- `apps/novel_agent/test/support/provider/slice_verify.ex`：AU11 missing 判定改按真实判断 prompt 的作品事实（`正文统计：N 章中已写 0 章`），无 slice id/env 开关；`mix compile` 通过。
- `frontend/slice-verify/{external-ui-driver,native-tauri-verifier,vs10-observability-spine}.mjs` 目标场景最小重锚；verifier 单测 245/245。

### 10.4 E2E 聚合重算（2026-10-27，current HEAD `d6bc69a4`）

`bash scripts/e2e_01_full_chain_check.sh --provider slice_verify` → **exit 67（evidence_missing，诚实状态）**，逐场景：
- **E6/E9 blocked**：`e2e-01-readonly-tool-trace` / `e2e-01-replay-report` registry blocked（step trace 未持久化 + native 未实现）。
- **E4 stale（根因已由 Lead 修复）**：替代证据 `agent-step-regate` verdict=pass，但 `git_head=d6bc69a4`（短 hash）与聚合器完整 HEAD 不一致 → 判 stale。Lead 已修：`accept_verdict.mjs` 改记录完整 hash、`quality_accept.sh` 批次同源；`e2e_status.mjs` 新增 `commitMatches` 兼容既有短哈希证据（≥7 位前缀，与 git 缩写规则一致），并补 `e2e_status.test.mjs` 回归。**提交后复跑聚合器即可让 E4/E1/E2/E11/E12 等 fresh verdict 正确判 current**（见 §12 复跑记录）。
- E3/E5/E7/E8/E13：legacy summary 无 git_head → stale（未在本轮复跑，诚实）。
- **E10 evidence_missing**：持久化闭环无独立真实页面 artifact（AU-07 cross-reference），补证据前聚合不会 PASS。
- 结论：聚合器不再假绿（E4 不再写「已验收」），E6/E9 blocked 如实；未 PASS 的根因是 step-trace 缺口（B59）+ 未复跑项 + B41 hash 残留，不是本轮验收重锚失败。

### 10.5 CP3 残余（交接 Lead/CP4）

1. **B41 residual（需 Lead/B41 修）**：`accept_verdict.mjs` 写短 git_head vs 聚合器完整 hash 比较 → 所有新 verdict 判 stale；建议 `accept_verdict` 改用完整 hash（或聚合器双向兼容），修后 E4 替代证据与 CP3 PASS 场景在聚合器中可为 current。
2. **同族未复跑项**（§10.2）：`p1-chapter-draft-generation`、`p1-prose-execution-brief`、`au01-turnresult-recorder-ui-consistency`、`au02-candidate-*`、`au03-*`、`au05-adoption-safety-freshness`、`au07-trace-why-entry`、`au09-au03-*`、`au12-correction-intent-roundtrip`、`vs00c-*`：verifier/manifest 中旧事件断言未全部迁移；历史 PASS 只作历史，nightly 复跑前不得 pass。
3. **native 系统级覆盖**：本轮所有 PASS 均为 browser-surface（见 §10 表）；native driver 覆盖缺口 known-gap 保持。
4. **AU-07 三场景**解除依赖 [B59](B59-agent-run-step-trace-persistence.md) + native driver。
5. **E10**：持久化闭环需独立真实页面 artifact（AU-07 cross-reference）。

## 10.6 §10.2 同族场景重锚批次结果（2026-10-29，current-HEAD）

**预注册**：`artifacts/b40-reanchor/preregistration.json`（范围=18 个同族场景；预算=每场景 harness wait 240s、wall 480s、同因失败≤2、批次 90min；判据=exit 0 + verdict pass + git_head=current HEAD + surface/driver 记录；不使用真实模型；证据/日志目录 + 失败只读）。执行方式：detached nohup 批处理（`/tmp/b40_reanchor_batch.sh`、`rerun*.sh`），逐场景 `bash scripts/quality_accept.sh <id> --surface tauri`；日志 `artifacts/b40-reanchor/{logs,rerun-logs,rerun2-logs,rerun3-logs}/`，结果 JSONL 同目录。

### 10.6.1 逐场景结论（18）

| 场景 | 首轮 | 最终 | 说明 |
|---|---|---|---|
| `p1-chapter-draft-generation` | PASS 16s | PASS | 旧事件断言已可判；current-HEAD 真跑 |
| `p1-prose-execution-brief` | PASS 16s | PASS | 同上 |
| `au02-candidate-continuation` | PASS 18s | PASS | |
| `au02-freeform-followup-after-candidate` | PASS 17s | PASS | |
| `au02-unadopted-candidate-no-reading-fact` | PASS 17s | PASS | |
| `au02-candidate-adoption-bridge` | PASS 17s | PASS | |
| `au02-candidate-multiturn-context` | FAIL（reply 不回显 nonce） | **PASS 19s** | 重锚：上下文连续性改由真实后续请求 prompt（llm-calls 外部证据）携带 nonce+候选标题判定，不再要求确定性替身回复 copy 回显；manifest data 断言同步 |
| `au01-turnresult-recorder-ui-consistency` | FAIL（restore 后发送按钮 disabled） | **PASS 18s** | 重锚：空输入发送按钮当前产品设计为 disabled（`canSubmitMainInput` 需 hasSteerInput）；改为验证「键入后发送可用」+ 输入可用，未放宽输入/记录一致性断言 |
| `au03-context-source-ui` | FAIL（旧 `planner.form_frame.done`） | **PASS 18s** | 重锚 KEY_EVENTS/断言到 `judgment.decided.done`（判断纪元同一语义位），why 文案与上下文来源断言保留 |
| `au03-current-work-context-ssot` | PASS 249s | PASS | verifier 重锚在轮询窗口内生效；驱动侧证据为 current-HEAD |
| `au03-long-session-compression` | PASS 20s | PASS | 同上（KEY_EVENTS/行为同步到 judgment 事件） |
| `au05-adoption-safety-freshness` | FAIL（无 high-risk 候选） | **retired** | 产品契约漂移：judgment `propose_creative_directions` schema 无 risk_hint，`CandidateDirection` 恒 low → 无可达生产者。见 `quality/acceptance/known-gaps.md` 2026-10-29 retired 表 |
| `au07-trace-why-entry` | PASS 18s | PASS | verifier 重锚到 judgment 事件后由同一轮询窗口判 PASS |
| `au09-au03-session-memory-layering` | PASS 19s | PASS | 无需重锚 |
| `au12-correction-intent-roundtrip` | FAIL（无 world_building 执行） | **PASS 113s** | 重锚：确定性替身补「立项修订」判断分支（test-support 只读 prompt 语义→execute world_building），driver/verifier 修父/子 turn（作者消息/判断在父、工具与 TurnResult 在子）日志匹配 |
| `vs00c-cp3-structured-context` | FAIL（旧 planner 事件 + 子/父 turn 混用） | **PASS 18s** | 重锚：父 turn 承载 user_message/context.assemble/judgment.decided；子 turn 承载 tool；断言语义不变 |
| `vs00c-cp4-chapter-plan-structure` | FAIL（同上） | **PASS 18s** | 同上（generation/draft 双父 turn） |
| `vs00c-cp5-reader-effect-brief` | PASS 53s | PASS | 复用 CP4 行为重锚；首轮轮询窗口内判定 |

**汇总**：**17 PASS + 1 retired**（PASS 中 6 个经重锚后复跑 PASS：au02-multiturn、au01-turnresult、au03-context-source-ui、au12、vs00c-cp3、vs00c-cp4；另 au03-current-work/au03-long-session/au07-trace-why/vs00c-cp5 在首轮轮询窗口内应用 verifier 重锚后判 PASS）。首轮失败证据保留只读。所有 PASS verdict 的 `git_head` 为 current HEAD（重锚提交前后视运行时间点，见各 verdict.json），`surface=browser`、`driver=headless-chromium`、`requested_surface=tauri`、`tauri_window_launched=true`——**是外部自动化驱动真实产品前端+真实 Phoenix 后端的页面链，不是原生 AX 驱动**；不签 native PASS。

### 10.6.2 本批重锚改动（frontend/slice-verify + 确定性替身 + 注册）

1. `native-tauri-verifier.mjs`：判断纪元事件迁移（`planner.form_frame/micro_plan.*` → `judgment.decided.done`）用于 `au03-current-work-context-ssot`、`au03-long-session-compression`、`au03-context-source-ui`、`au07-trace-why-entry`、`au09-memory-recall-context`（同族同病因顺带修复）；`vs00c-cp3/4/5` 增加 agent 子 turn→父 turn 映射（user_message/context.assemble/judgment 在父、toolbox 在子），删除对不存在事件的硬要求；`au01-turnresult` 改验「键入后发送可用」；`au02-multiturn` 改验真实请求 prompt 携带上下文。
2. `external-ui-driver.mjs`：au02-multiturn 增加 llm-calls prompt 证据；au01 空输入 disabled 语义重锚；au12 父/子 turn 日志匹配。
3. `apps/novel_agent/test/support/provider/slice_verify.ex`：新增 AU12「立项修订」判断分支（prompt 含产品 UI 文案「修订当前作品的立项设定」+「不要直接写入作品档案」时判 execute/world_building）；只读识别 prompt 语义，不识别 slice id/env/隐藏开关，不改变其它场景行为。
4. 注册与台账：`au05-adoption-safety-freshness` 从 registry/manifest/tauri implemented list 移除并登记 retired；`scripts/lib/quality/manifest.mjs` required list 改 `au13-review-adjudication-roundtrip` 保持 key 场景实现校验；manifest 计数测试同步（207→206/208，B47 blocked 场景登记后 207/209）；`frontend/slice-verify/native-tauri-verifier.test.mjs` 246/246。
5. 产品代码零验收感知：本批未新增 slice id/env/query/DOM hook；`frontend/src` 无改动；确定性替身只读真实判断 prompt 文本。

### 10.6.3 残余与诚实边界（不冒充闭环）

1. **native 覆盖缺口不变**：本批全部为 browser-surface；native AX/CGEvent 覆盖仍按 B61/B62 已交付范围为准，扩面需要新 native driver 批次。
2. **au01-turnresult / au12 首轮失败根因已定位并修复并复跑 PASS**：au01=空输入 disabled 的产品设计（旧断言假设不成立）；au12=确定性替身缺判断分支 + 父/子 turn 日志断言。最终 verdict 见 §10.6.4；重试均按失败类型修复后 scoped 复跑，未放宽产品断言。
3. **E2E 聚合**：本批 verdict 写完整 git_head；`bash scripts/e2e_01_full_chain_check.sh --provider slice_verify` 的 fresh/stale 结论以复跑为准；本批未重跑 E2E 聚合（受 B40 CP3 记录的历史 E6/E9 blocked 与 E10 证据映射影响），不把本批场景 PASS 外推为整条 E2E PASS。
4. **失败证据只读保留**：首轮失败日志与截图保留在各自 `artifacts/slice-verify/<id>-tauri/`（最新一次运行会按 harness 语义覆盖同名目录，历史备份见 `artifacts/wip-backups/`）；不删除、不改写。
5. **重试口径**：au01/au12 各经历首轮失败→根因修复→再跑；每次失败类型不同（断言假设不成立 / stub 分支缺失 / 父子 turn 匹配），不是同因盲试；未用放宽断言或删除场景要求过关。

### 10.6.4 最终复跑记录（2026-10-29）

| 场景 | 命令 | 结果 | verdict 关键字段 |
|---|---|---|---|
| `au01-turnresult-recorder-ui-consistency` | `bash scripts/quality_accept.sh au01-turnresult-recorder-ui-consistency --surface tauri` | **PASS**（exit 0，18s） | `status=pass`、`surface=browser`、`driver=headless-chromium`、`git_head=<current>`、evidence 齐 |
| `au12-correction-intent-roundtrip` | 同上（au12） | **PASS**（exit 0，113s） | `status=pass`、`surface=browser`、待采纳 `world_setting` + accept/edit/discard 动作可见、`production_write_performed=false` |

- 结果文件：`artifacts/b40-reanchor/{results,rerun-results,rerun2-results,rerun3-results}.jsonl`；日志 `artifacts/b40-reanchor/*-logs/`；截图/帧/DB 证据在 `artifacts/slice-verify/<id>-tauri/`。
- 汇总：18 场景全部有结论（17 PASS + 1 retired）；native 覆盖缺口仍按第 1 条登记，不签 native PASS。
- 重试记录：au01 3 次运行（首轮断言假设错→改「键入后可用」仍漏改旧断言→最终复跑 PASS）；au12 4 次运行（stub 缺分支→补分支后父/子日志断言错→证据 finder 父 turn done 匹配→最终复跑 PASS）。均为不同根因的 scoped 修复，不是同因盲试。

## 11. CP4 收口记录（2026-10-27，Lead）

### 11.1 收口动作

1. **registry/known-gaps 同步**：`quality/acceptance/scenarios.yml` 落定 207 场景（退役 6 + 新增 `pr-smoke-core-reply`）；`known-gaps.md` 重写为当前事实：blocked 表（AU11×2、AU07/e2e×3、au02-fallback、judgment-explore-internal、E10）+ retired 表（7）+ CP3 PASS 表（browser-surface 如实）+ native 覆盖缺口汇总 + B42 证据分层 known-gap。
2. **B41 git_head 短/长 hash 残留修复（Lead）**：`accept_verdict.mjs` 与 `quality_accept.sh` 改为记录完整 commit hash；`e2e_status.mjs` 新增 `commitMatches` 兼容既有短哈希（≥7 位前缀，git 缩写语义）；`e2e_status.test.mjs` 补 2 条回归。修后无需重跑即让既有短哈希 verdict 可判 current。
3. **manifest 测试计数同步**：`scripts/lib/quality/manifest.test.mjs` 由 212/2/214 更新为 207/2/209（B40 registry 事实），B41 CP5 的历史快照保持原记录不改。
4. **E2E 聚合断言强化（Lead 复核补强）**：B40 把若干 `artifactSpecs.assertions` 置空以避免旧断言名；Lead 改为使用当前 summary `behavior.assertions` 中真实存在的断言名（E1/E2/E3/E4/E6/E9/E11），恢复聚合器对断言内容的检查，而不是空期望。
5. **B59 产品缺口**：登记后按「新发现产品缺陷→体系化 slice」在同日推进并 done（5 flow 接线 + scoped 复验 3 场景 PASS）；AU-07 三场景只剩 native driver 依赖。
6. **文档归一**：B40 §7.0 surface 口径、§8.1 表、§8.2 registry 行、§10.4 hash 根因均按 Lead surface 裁决与 hotfix 结果修正；AU11/AU07/B13B 台账同步真实状态（browser-surface 机制预验 ≠ native PASS；verdict 改写 skipped/native_system_driver_missing）。

### 11.2 CP4 验证（提交前，HEAD `d6bc69a4` + 工作树）

```bash
bash scripts/quality_manifest_check.sh          # passed（207 scenarios / 2 drafts / 209 manifests）
node --test scripts/lib/quality/*.test.mjs      # 183/183（B41 96 + B42 80 + Lead hotfix/manifest 计数 7，最终见 §12 终态）
cd frontend && pnpm vitest run slice-verify/native-tauri-verifier.test.mjs  # 245/245
node --test scripts/lib/quality/e2e_status.test.mjs   # 59/59
git diff --check                                # clean
```

### 11.3 CP4 未闭环后果（必须保留，不得因 done 销账）

| 后果 | 承接/触发 |
|---|---|
| native 系统级驱动覆盖（AU11×2 + AU07×3 + CP3 家族） | 「native acceptance driver 覆盖」批次：AX/CGEvent driver + native evidence checker + allowlist；实现前不得把 browser-surface 记 active（AU11/AU07 保持 blocked） |
| AU-07 三场景（au07-tooltrace、e2e-readonly、e2e-replay） | 产品侧 step trace 持久化由 [B59](B59-agent-run-step-trace-persistence.md) 修复；native 驱动由 [B61](B61-native-acceptance-driver-coverage.md) 关闭（5/5 原生 PASS，registry active） |
| au02-candidate-fallback-ui | 协议/产品裁决：creative_exploration 空候选是否进入应用兜底；不得用旧证据代签 |
| 同族未复跑场景（§10.2） | nightly 重锚批次：verifier/manifest 旧事件迁移 + current-HEAD 复跑；历史 PASS 只作历史 |
| E10 持久化闭环 | AU-07 cross-reference 补独立真实页面 artifact |
| 最终 HEAD 复跑 | Lead 在最终提交后于最终 HEAD 复跑 pr-smoke / e2e 聚合（artifacts 不入 git）；本文件不写「最终 HEAD aggregate PASS」除非该复跑真实通过 |

## 12. 最终提交后复跑计划（Lead）

最终提交后（所有代码/registry/文档落定、HEAD 不再移动）按顺序复跑并把结果写入最终汇报与 `artifacts/`：

1. `bash scripts/quality_accept.sh --tier pr-smoke`（pr-smoke-core-reply + vs10，预期 pass=2；若失败如实保留 blocked/失败证据）。
2. `bash scripts/e2e_01_full_chain_check.sh --provider slice_verify`（预期仍 exit 67：E6/E9 blocked、E10 evidence_missing；E4/E1/E2/E11/E12 在 hash hotfix 后应判 fresh；stale 项如实保留）。
3. 按需 scoped 复跑 `agent-step-regate`（E4 替代证据）刷新最终 HEAD verdict。

提交前证据（`git_head=d6bc69a4`）只作阶段证据，不冒充最终 HEAD 证据。
