# UA01 Agentic Loop 流式叙事恢复 + 对话卡片简化

- 状态：doing
- 类型：AgentRun Loop 体验回归修复 + UI 收敛 Slice
- 登记日期：2026-07-05
- 来源：用户 stage 反馈（2026-07-05 对话）：ADR-0023 实现后对话体验回退——「半天没反应，突然显示出一个卡片」；卡片页面元素过多需简化（元素简化，非交互简化）。

## 1. 背景与根因

用户原始要求：AI 返回应是流式逐字显示，交互上呈现「AI 正在输出自己的所思所想所作所为」；因模型 API 响应时间长，页面必须始终有状态反馈。

ADR-0023 CP4 后流式退化的根因链（已核实）：

1. 计划起草/修订调用改为强制 native tool call（`agentic_plan_draft_planner.ex` `tool_choice` 具名；LM Studio 降级为 `"required"`）。
2. 强制 tool call 下 assistant content 系统性为空（LM Studio 实测，`:482` 注释），全部字节走 `tool_calls[].function.arguments`。
3. 流式适配器只从 `delta.content` 提取 `author_narrative_delta`（`openai_compatible_stream.ex` `choice_delta`），arguments 字节不产叙事 delta。
4. 前端流式渲染只消费 `author_narrative_delta`（`agentRunTimeline.ts`）。

→ 整个规划调用期间零流式字节；结束时 `plan_drafted` 才一次性带回全文。

## 2. 用户拍板（2026-07-05）

1. **卡片简化：按处置表执行**——删阶段带（7 节点管道）、终态区、三处 hint 说明文案、计划步骤双文字标签（留状态符号+描述）；v1 版本 pill 仅 version≥2 显示；推理原文页面上只留一份。
2. **流式恢复：方案 C（拆两次调用）**——规划先自由流式输出 reasoning（content 可流式），再强制 tool call 产计划结构。用户明知调用成本 ×2 与 ADR-0023 调用经济学冲突仍拍板体验优先，**需在 ADR-0023 登记修订注记**。
3. **工作详情折叠区：整体移除**——取证走 trace/replay 等其他入口。

## 3. 边界（六问）

- **Contract**: ADR-0022 N-NARR（叙事字节归模型）；ADR-0023 N-PLAN（轨道由模型产出，不动）+ 调用经济学修订注记（规划 ×2 为用户拍板体验优先）；46§9 reasoning flow UI 收敛为「状态行 + 计划 checklist + 流式推理区」三层。
- **Invariant**: N-NARR 不破——流式 delta 与终稿叙事都来自模型 content（回退 arguments.author_reasoning）；I1/I2/I3 场景不变量必须过；N-PLAN 不动。
- **Boundary**: `novel_application`（AgenticPlanDraftPlanner 两段式、dialogue_planning_service 规划预算余量 +1→+2）；`novel_agent` 仅 test 替身（stub/slice_verify 增 reasoning 应答分支），adapter 不改（content 流式已支持）；`frontend`（卡片简化）。`novel_domain`/`novel_persistence`/`novel_web` 不动。
- **Consumer**: WorkspaceChat 对话流 agent run 卡片（唯一真实入口）；全部 9 个 profile 的规划调用。
- **Proof**: planner focused tests（两段式调用、叙事绑定 call1 content、call1 空 content 回退）；前端 vitest；mix 全量门禁；I1/I2/I3 driver；受影响 Tauri 场景复跑。
- **Acceptance Driver**: `frontend/slice-verify/external-ui-driver.mjs` 既有 agentic loop 断言随产品 UI 同步更新（工作详情 22 处引用、终态/推理区断言改为新三层语义）；产品代码零验收感知。

## 4. Checkpoint

| # | 内容 | 状态 |
|---|---|---|
| CP1 | 后端两段式规划调用：call1 无 tools 流式 reasoning（purpose `:author_reasoning`）→ call2 强制 tool call 结构化（purpose `:planner`，prompt 内嵌 call1 reasoning）；叙事优先绑定 call1 content，空 content 回退 call2 arguments.author_reasoning；`provider_call_count` 计两次调用；预算集中在 `run_budget/3` 补 `+1+max_replans` 余量（routed +1 保持路由调用语义）；stub/slice_verify 替身按「有无 tools」分辨两段 | **done**（focused test 断言两段顺序/叙事绑定 call1/计数=2；全 umbrella 1206 tests 绿） |
| CP2 | 前端卡片简化：删阶段带（7 节点）/终态区/三处 hint/步骤双标签（留状态符号+描述），v1 pill 仅 version≥2 显示，工作详情整体移除（含 props/取数/`agentRunTimeline` 详情类函数 1039→~290 行/copy.ts 死文案/死 CSS 30 块）；46§9 层级结构改三层并登记修订注记 | **done**（typecheck/lint/vitest 382/build 全绿；frontend_audit + design_trace 通过） |
| CP3 | 外部验收资产语义迁移 + 真实 Tauri 复跑 | **doing（2026-07-15 用户批准启动）**：§5.1 名单主体已迁移并复跑绿 17 场景 id（roster 家族 7 / conversation / plot / world / evolution / no-deviation / plan-replan / prose-quality / stream-unified / activity-restored / transcript-lazy-page）；迁移中发现并修复恢复端补水真实回归（详见 §5d）；收尾批（error-author-safe / durable-resume / streaming-progress / style-rule / no-progress-stop / prose-revision）进行中 |

## 5. 诚实未闭环缺口（CP3）

1. **外部 driver/verifier 语义迁移未做**：`frontend/slice-verify/external-ui-driver.mjs` 有 13 个 driver 函数断言已被移除的 UI（「工作详情」22 处、模型执行流/模型调用明细/事件序列/输出摘要/回放边界、终态+已完成、本轮路径），且与 `native-tauri-verifier.mjs` 的 evidence/behavior handler 键成对耦合（如 `older_ui_activity_loaded_after_expand`）。受影响 driver：driveAgentProseDraftingWithQuality、driveAgentWorldBuildingWithContext、driveAgentProviderExecutionActivityRestored、driveAgentConversationTurn、driveAgentProviderExecutionStreamUnified、driveAgentSessionTranscriptLazyPage、driveUa01AgentBoundedRosterToCharacterDesign(+Seeded)、driveAgentPlotOutlineWithContext、driveAgentCharacterEvolutionWithContext、driveAgentProviderExecutionErrorAuthorSafe、driveAgentDurableResumeLongRunTask。迁移方向：工作详情/终态断言 → 新三层 UI（状态 chip「已完成」、`section[aria-label="计划"]` checklist、`section[aria-label="推理"]` 叙事）+ socket 帧证据（`agent_event.provider_progress` 携 `author_narrative_delta`/provider refs）；provider 取证类断言 → 持久化 ProviderRun 事实（scoped activity API）。这是每场景验收口径的重定义，须逐场景做并重跑真实 Tauri，不做机械弱化。
2. **受影响 Tauri 场景未复跑**：上述场景现有 `artifacts/slice-verify/*/summary.json` 对新 UI 均视为 stale；`task_done` manifest 检查（static-scan blocking 项）同样等待该批 Tauri 重验证。属重型验证，需用户批准后启动。
3. **方案 C 范围**：两段式目前只覆盖计划起草/修订（run 开场静默是用户主诉）；执行步（creative tool call）与质量复核阶段的叙事仍按事件粒度到达。若需步级流式需另行拍板（每步成本 ×2）。
4. **本 slice 顺带修复的既有缺口**：I3 Layer-B 自 2026-07-01 Provider.Execution 收口后因裸一参函数注入被拒而静默退化为 indeterminate（exit 0 掩盖），已修 driver 注入形态恢复 3/3 决定性 pass；N-NARR driver 替身已对齐两段式协议（PASS：1 narrative byte-bound + 1 streamed prefix verified）。

## 5d. CP3 执行记录（2026-07-15，用户批准后启动）

- **迁移口径**：工作详情/终态区/模型执行流/模型调用明细/事件序列/输出摘要/回放边界断言 → 三层 UI 结构判定（`section[aria-label="计划"|"推理"]` + 状态标签）+ 持久化 ProviderRun 事实（`provider_runs[].events`，因 2026-07-02 d0643cd3 起 activity API 的 agent_runs[].events 只含 author 事件——考古确认为 ADR-0022 有意收紧）。计数按两段式实测：conversation 4、replan 6（修订亦两段式）、prose 5、创作 profile 4、roster 4。指向已删 UI 的死字段删除而非留 false。verifier 单测 fixtures/负例/标签同步。
- **发现真实产品回归并修复（非验收补丁）**：CP2 移除工作详情折叠区时，恢复端 activity 加载入口（展开触发 hydrate）一并消失且未补，reload 后历史消息执行过程永久空白。修复=WorkspaceChat 对带 agent_run 摘要且未补水的恢复消息惰性补水（幂等守卫复用，activity API 只读、不重调 provider，兼容 lazy-page no-recall 不变量）。真实 Tauri activity-restored 场景验证通过。
- **harness 系统修正**：默认轮询窗 180s→360s（两段式后单场景链路普遍 >180s，修默认值而非每次 env 覆盖）。
- **CP3 批次二收口（2026-07-15 晚）**：streaming-progress 已按两段式口径校准复跑绿
  （provider_progress_v1 = 路由 1 + 起草 2 + complete 1 = 4）。**累计 20 个场景 id 绿**。
- **三个长尾的深度归因（真问题，非资产校准，逐个独立处置）**：
  1. `p1-prose-revision-candidate`：**真实产品回归——已定位并系统性修复（2026-07-15）**。
     根因不在 `DialogueContext.current_chapters`（复现证实 fetcher 章节供给健全），而在
     **规划期 prompt 丢了「作品章节」列表段**：Order 62 从旧 `Planner` 两阶段拆分迁到
     `AgenticPlanDraftPlanner` 时，只带了 `author_goal`，没带旧 Planner 的
     `accepted_chapters_section`（作品章节全名列表）。但 `target_chapter` 契约仍要求模型
     "从列表精确复制全名，对不上填 null"——没有列表，真实模型与 stub 都只能填 null →
     点名章被 `MissingPolicyResult` 判 hard missing（`matched_chapter=""`）→ writer 短路
     → D7 replan 再失败 → awaiting_author。这是**规划机械准备缺项**（ADR-0025：机械准备
     不问模型），不是补丁。修复链路（沿正确数据流）：
     `WorkspaceContext.chapter_titles_reader/0`（新读端口，与 context fetcher 章节同源）
     → `NovelApplication.persistence_chapter_titles_reader/0`（既有注入门控）
     → `AgenticPlanDraftPlanner` 起草/修订四个 prompt 全部注入「## 作品章节」段 + 契约行
     改为"按列表精确复制全名，对不上填 null"；stub `prose_writing_plan_step` 停止硬编码
     `target_chapter: nil`，改为按章号对到 prompt 列表全名（列表外保持 null，
     `cp0-missing-chapter-block` 语义不变）。测试：planner +2 回归（prompt 必含章节段/
     无章时省略）、stub +2 契约（命中→全名 / 列表外→null）、全 umbrella 1218 tests 绿、
     I1/I2/I3 绿。外部验收侧顺带一处正当校准：修订 run `provider_calls` 2→3（两段式规划
     实测 = 计划 reasoning + 计划结构 + writer），driver 与 native-tauri-verifier 两侧
     finder 同步（原值 2 是两段式前 stale，与 20 场景 streaming 批同类校准）。
  2. `agent-provider-execution-error-author-safe`：**真实产品缺陷——已定位并系统性修复
     （2026-07-16）**。归因三层：
     ① 失败点被 Order 62 意外前移：run 内路由是新引入的第一个 provider 调用，stub 失败
     标记未豁免路由 prompt → 失败发生在路由而非设计缝（对话回应调用）。桩已把
     `profile_routing_prompt?` 加入机械准备豁免族（与决策/起草/修订同类），恢复设计缝。
     ② "socket 0 条 provider_progress" 不是回归而是 ADR-0022 的有意收紧（channel 只广播
     author 可见事件，developer 级 provider_progress 从不上 socket）；驱动的 socket 取证
     断言从根上过时，已迁移到持久化 ProviderRun 事实（activity API provider_runs[].events
     含 started+error、purposes、statuses），与 CP3 批次口径一致。
     ③ **真实产品缺陷（ADR-0024 S7 违约）**：runtime 三处 run_failed 终局裸退——无安全
     TurnResult（"run 停了没有下文"），且 `inspect(reason)` 把原始 provider 载荷
     （"UA01PROVIDERFAIL raw provider failure payload"）直接放进 author 可见事件摘要
     （N-NARR/47 红线）。系统性修复：`agent_run_server` 三处失败终局统一收口
     `settle_run_failed/3`——作者摘要只用结构词（按 provider/内部错误分类）、原始载荷
     只进业务日志（developer JSONL）、附安全兜底 TurnResult（文案复用
     `Planner.provider_failure_fallback_message/1`，frame 兜底与 run 终局同映射）；
     恢复动作族（steer/resume available_actions）留给 ADR-0024 CP3。
     验证：runtime 新增 S7 聚焦测试（路由失败 → 投影事实 + 净化摘要 + 安全 TurnResult）、
     全 umbrella 1219 tests 绿、verifier 174 绿、真实 Tauri 复跑绿（summary：
     provider_run_count=4，purposes=[planner, author_reasoning, conversation]，
     event_types 含 started+error，consumed=4，behavior=
     provider_failure_absorbed_into_safe_reply_with_persisted_provider_facts）。
  3. `agent-no-progress-stop`：**场景已按 ADR-0023 计划驱动机制重定义（2026-07-16）**。
     旧诱导（"两次 roster 重复读"）在机械 cursor 下不可能发生；产品现行 no-progress
     保护 = `progress_signature` 重复判停（`agent_run_server.apply_progress_signature`），
     其真实触发形态是**修订空转**：模型起草单步计划（只读上下文）→ 计划走完回应未生成
     → D6 修订 → 修订没有补足新步骤、只是把同一步再排一遍 → 机械执行重复步 → 签名
     重复（conversation context 步签名 `run:context:turn_id` 按 run 恒定）→
     awaiting_author + no_progress，空转步产物被丢弃。新诱导：UA01NOPROGRESS 标记 →
     桩确定性复刻"修订不出新步骤"的弱模型失败形态（draft 单 context 步 / revision
     追加同款 context 步）。断言迁移：roster 工具计数删除（全程 0 工具）、新增
     plan_drafted(单步)/plan_revised 帧、replans=1、budget 按两段式实测（steps=2、
     provider=5=路由 1+起草 2+空转修订 2）、无 TurnResult 帧。key_events 移除
     orchestrator.decide/toolbox.execute（无工具执行）。runtime 新增聚焦测试
     （空转修订 → no_progress 判停 + 产物丢弃 + 账目断言）。真实 Tauri 复跑绿
     （summary：stop_reason=no_progress，behavior=
     bounded_agent_run_stops_when_spinning_plan_revision_makes_no_progress）。


## 5a. Stage 首验暴露缺陷与修复（2026-07-06，用户拍板双修）

用户 stage 实测「开始 创作，从哪开始」：两段式流式正常（DeepSeek reasoning 逐字可见、计划面板正确），但 run 在第二步死亡——`run_failed: agent_step_precondition_failed, target_tool_ref: strategy_gate, missing: ["frame"]`。DeepSeek 起草的三步计划跳过了 `dialogue_frame`（prompt 未声明依赖 + 「最少步骤」要求被认真执行），且前置失败走 `handle_step_result({:error,...})` 硬 `run_failed`，未走 ADR-0023 D1 通道（D1 冻结语义本就是「替代现状直接 run_failed」）。双修已落地：

1. **Prompt 声明依赖**：`step_catalog("conversation_turn_v1")` 每步标注依赖关系；起草/修订两个 context block 的计划要求新增「能力目录中的依赖声明是硬约束」bullet。
2. **前置缺失接入 D1 replan**：`AgenticDeviationSignal.next/5` 新增 `step_preconditions` 选项，派发前确定性检出下一步缺失的 stage_state 输入 → 走既有 `maybe_replan_deviation` 修订通道（消耗 max_replans，handled_refs 防死循环，超预算 awaiting_author）；`conversation_turn` 声明 `@step_preconditions`（frame/strategy/response 三步）。执行期 `require_stage_state` 保留为最终防线。
3. 新增测试：偏离信号单测（缺失触发/齐备不触发/未声明不触发）+ runtime 集成测试（模型跳过 dialogue_frame → D1 plan_revised → run completed 无 run_failed）。

## 5b. Stage 复验暴露缺陷二：候选悬空承诺（2026-07-06，用户拍板「两种形态都允许+一致性硬约束」）

用户点候选卡「继续讨论」后发「继续聊『独特的日常细节开场』这个方向…」，DeepSeek 的 `assistant_message` 以「这里有三种常见的变体，你看看更倾向哪一类：」收尾，但页面无任何选项。DB 证据：`frame_type=casual_reply`、`candidate_directions` 无、`ui_cards=[]`。根因：frame prompt 规则「frame_type != creative_exploration 时 candidate_directions 为空数组」+ 模型被「先聊/只聊/讨论→普通对话」规则带偏（用户输入以「继续聊」开头）判成 casual_reply → 三种变体没有合法载体，文本悬空承诺。修复（`planner.ex` frame prompt）：①「先聊/讨论」规则补注——不禁止 creative_exploration，回应要给多个可选方向（含细分变体）仍应出候选；②新增一致性硬约束——文本承诺选项必须内联写全或走 candidate_directions，禁止两处都不给。全 umbrella 测试 + I1/I2/I3/N-NARR 复跑绿。注意：prompt 级修复对强模型是软约束，无 app 侧机器强制（语义级无法可靠检测），若复发考虑升级为 frame 后验（文本尾部模式 + 空候选 → 重试一次），登记为观察项。

## 5c. Stage 复验暴露缺陷三：计划目标集不一致（2026-07-06）

`run_mr9dg2ct_jx` 失败：`{:invalid_plan_step_target, "world_building"}`。模型为 conversation run 起草了含独立 `world_building` act 步的五步计划——起草校验（`validate_plan_targets` 用 `authority_scope.allowed_tools`，对话 profile 含全部创作工具）判定合法，运行时机械执行器（只接受四个内部步）拒绝 → 硬 run_failed。根因是**起草校验与执行器的合法目标集不一致**：对话 profile 的创作工具由 strategy_gate 裁决后在回应管线内调用，不是独立计划步，但 prompt 把 allowed_tools 列给了模型且校验按它放行。修复（机器强制优先）：

1. `AgenticPlanDraftPlanner.plan_step_targets/1` 按 9 个 profile 固化执行器真实接受的目标集（与各 flow `mechanical_execute_decision` 逐一核对）；`allowed_targets/1` 优先用它，未知 profile 回退旧行为。起草/修订时非法目标即被拒 → 走既有纠错重试，不再流到运行时。
2. Prompt：context block 的 `- allowed_tools:` 改为 `- plan_step_targets:`；计划要求 bullet 收紧（「不在该列表中的能力即使作品允许使用也不能作为独立 PlanStep」）；conversation 能力目录加注创作能力的真实调用方式。
3. 新增定向测试：conversation 计划带 `world_building` 独立步 → 起草时 `{:error, {:plan_step_target_not_allowed, ["world_building"]}}` 且发出纠错重试。

## 6. 验证记录（2026-07-06）

- `mix compile --warnings-as-errors` / `mix test`（全 umbrella 0 failures，novel_application 462）/ xref cycles 0 / arch_check ✅
- I3（Layer-B 3/3 pass）/ I1（3/3）/ I2（disjoint 3/3）/ N-NARR PASS，均真实 exit 0（含 §5a 双修后复跑）
- `pnpm typecheck && pnpm lint && pnpm test`（382）+ `pnpm build` ✅；frontend_audit / check_design_trace ✅
- `ai_static_scan --quick`：credo 3 项（RedundantWithClauseResult/Nesting/FunctionArity）已修复；剩余 gitleaks 2 条为既有长期处置（false_positive/accepted_risk），task-done-manifest 为 §5.2 缺口
- Stage live 证据：`log/llm-calls/stage/2026-07-06.jsonl`（DeepSeek 两段式：reasoning 流式 490 tokens + 结构 tool call 合法）；`priv/ai_novel_studio_stage.db` run_mr9cavn8_6 事件链（§5a 根因取证）
