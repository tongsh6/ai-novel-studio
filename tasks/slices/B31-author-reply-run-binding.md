# B31：作者补充输入与待回复任务的稳定绑定

- 状态：**done（2026-10-25，原生补验收口）**。A4由外部CUA驱动真实Tauri入口，五场景/7条问题回复/三次恢复/16组截图及源绑定对账通过；后端2247、前端614、I1–I3与统一扫描闭环。既有浏览器证据和失败批次保留，真实模型语义质量/B27 known-gap不据此关闭。
- 原收口记录：**done（2026-10-25，CP0–CP3）**。CP0 真实 Tauri 复现「两个 awaiting run + 普通自由输入被 steer 到另一 run」并裁决根因（前端插入序选择 + 普通输入只按 selected run steer/不参与非 selected 的 open question + JoinRestore 顺序无契约；服务端绑定与 B26 显式路径经证据排除）；CP1 修复（确定性 active run/主输入条件/expected_goal_version/恢复稳定序/ack 绑定）；CP2 真实 Tauri 新语义 PASS + 场景注册；CP3 Q3D 口径对齐、deprecated 清理、UA-01/设计/copy 文档同步、全门禁与台账。known limits 见 §6.5。
- 登记日期：2026-10-23；本轮不改代码、不重发 stage 消息。
- 关联：[Q3D](Q3D-message-outcome-roundtrip.md)、[DS03](DS03-awaiting-author-runtime-validity-and-recovery-surface.md)、[B23](B23-awaiting-author-reason-and-exit-surface.md)、[B26](B26-single-call-judgment-protocol.md)、[B27](B27-systematic-prompt-and-intent-integration.md)。

## 1. 证据与完整目标

stage session 5d618f06-f41c-46bc-aa55-5056a2fa5612：2026-10-23 01:13 的结构调整请求在 run_mvjsvrpf_c4s 等待作者；01:20/01:25 的“处理重复第11章”“只修正列表编号”却存为最早建书消息 message_724ab778-7f16-43ea-8a06-dc779fd3ce7d 的 steer:2/3，落入 run_mvjr394t_ef。重连同时恢复两个 live run；结构调整 run 后续因重启失活而 failed。

已证实输入/run 来源异常；尚未复现当时焦点、恢复顺序与 UI 操作，不能把“数组顺序就是全部根因”当结论。证据：[业务日志](../../log/app/stage/2026-10-23.jsonl) 第373–397行，stage interactions/agent_runs/agent_events；相关代码入口 WorkspaceChat、agentRunInputRouting 与 WorkspaceChannel。

完整链路：作者回应当前问题 → 明确目标 run/behavior/来源 → 接收身份校验 → 同一 run 继续 → 结果与原问题关联 → 刷新/断线/重传保持一致；作者不需要手工填写 run_id。

## 2. 开工七问

1. **Contract**：ADR-0027 D1/D3、UA-01 run/steer、DS03 runtime 权威、B26 ask_author/author_choice；消费现有来源和绑定字段，只有证明字段不足才提最小 schema 增量。
2. **Invariant**：同一回复不因恢复排序改投另一 run；work/session/run/behavior 作用域一致；幂等身份与原文不丢；失活运行不得假恢复；显式新请求不强行 steer 旧任务；无绑定依据不猜最后一条。
3. **Boundary**：frontend 输入上下文与恢复投影；web 接收/校验；application 消息、run/behavior 关联及恢复；persistence 只补必要来源读写；domain 纯绑定校验。无证据不修改 provider、创作工具或采纳语义。
4. **Consumer**：WorkspaceChat 的自由文本补充及 B26 选项回复；不能只测后端直接调用 steer。
5. **Proof**：多 run 排序/重连、旧问题回复、取消/失活、重复提交与跨作用域测试；真实页面从两个问题走到回复/刷新，并按 WS 与持久化 refs 证明目标。
6. **Acceptance Driver**：拟新增 b31-author-reply-run-binding，外部驱动真实 Tauri 点击/输入/刷新/重连；产品验收感知逻辑：**no**。涉及回复焦点 UI 时先核对现有设计/Pencil，不引入隐藏 hook。
7. **Exploration**：非小说要素物化，适用范围是判断上下文：当前问题、待回复目标、原请求和结果关联须同批可见；不能把所有未结束 run 拼成无来源叙述。

## 2.1 与 B26 的边界（2026-10-24 补齐）

B26 独立负责所有由 ask_author 产生的明确问题：持久 author_question/源动作、options=[] 时系统 free_text 回复、显式卡片绑定、原话/提交身份/receipt、刷新/过期/失活恢复。规范只维护在 UA-01 §2.2.2 A；B26 不以本 slice 为前置，QA12 的多个 open run 显式选择也由 B26 自证。

本 slice 负责没有明确问题动作绑定的一般自由输入：作者自然更换话题、回应早期普通讨论、旧 run 恢复顺序造成的归属等。复现/领域规则可以先做；涉及 B26 问题的最终集成验收在 B26 协议/绑定入口可用后执行，复用同一绑定/校验，不再实现另一条空选项回传。不能根据两项都写“同 run steer”而推迟最小问题身份保护。

## 3. 修复策略（以 CP0 复现裁决为准）

- 先复刻两条 awaiting_author run 与重连顺序，记录可见问题、输入焦点、前端选择的 run、发出的请求、服务端绑定及保存来源。若错误不在前端选择，沿证据修真实边界，不预设替换算法。
- 明确“当前回应对象”的真实产品依据：显式问题/动作绑定优先，已确定的对话回复上下文其次。Map 插入顺序、广播到达顺序、单纯最后一条记录不能独立决定目标。
- 多个合理目标且无回复依据时用作者可理解的问题区别；UI 不要求输入 ID。明确切换话题/新任务应走新请求，不能被任何尚存 awaiting run 截走。
- 服务端按同 work/session 与当前绑定、运行生命周期验证，不盲信客户端 run_id；原消息与 submission 身份、goal version、result_turn_refs 按 ADR-0027 保存/去重。
- B26 选项与自由文本都落同一 run 内 steer 语义，选项来源有时效校验；不额外制造一套新 Channel 命令。旧确认/旧问题不可篡改新任务状态。
- 失活、取消、完成、预算不足分别消费已有状态规则；诚实提示可继续的路径，不能把旧 run 幽灵复活或把失败当新任务成功。
- B27 的“延续作者目标”使用这里的事实关联，不能让提示词凭聊天顺序补救错误绑定。

## 4. Checkpoint

| CP | 工作 | 状态 |
|---|---|---|
| CP0 | 真实页面隔离复现多停等/刷新；判清当前回复对象语义与根因，列每个输入来源/绑定/结果 | **done（2026-10-25）**：T1–T5 真实 Tauri 复现；证据 `artifacts/slice-verify/b31-author-reply-run-binding-tauri/`（PASS 批次副本 `-cp0-pass-20261025T0052`），记录 `artifacts/model-contracts/b31-cp0/{ui-repro.md,code-chain.md}`；显式 author_choice 路径正确 |
| CP1 | 基于证据修绑定选择与服务端校验，保留既有幂等/恢复契约；补错误与拒绝路径 | **done（2026-10-25，`1a1fe079`）**：前端 Q01 确定性选择/Q02 主输入条件/Q05 目标可见；后端 Q03 expected_goal_version 校验/Q04 恢复稳定序/Q05-ack 绑定信息；前端 607 tests、后端 2080 tests/0，门禁绿；无 schema/codegen |
| CP2 | 新场景从真实输入到同 run 结果/刷新/再回复；B26 选项接线可用后补选项等价回归 | **done（2026-10-25，`6882fcf4`）**：真实 Tauri PASS（`b31-author-reply-run-binding` 注册 nightly），cp2_checks 16 全 true、log_noise ok；Q open 时普通主输入 6/7 新 run、0 错误 steer；显式回复 4/4 绑对；live-only 歧义 selector→steer 带 expected_goal_version/ack 绑定；刷新 JoinRestore 稳定；B26 awaiting×2 回归 PASS（证据 artifacts/slice-verify/b31-author-reply-run-binding-tauri + cp2-report） |
| CP3 | DS03/B23/Q3D/取消和重传回归、全门禁、台账收口 | **done（2026-10-25，`500cdf9c`）**：Q3D 改用无 open question 的 plan-exhaust awaiting 验证 steer 投递恢复（Option A，PASS）；b31/agent-awaiting-author-steer-resume/agent-awaiting-author-input-required 全 PASS；前端 37 files/603 tests、后端 2080 tests/0、全门禁绿；UA-01 §9.1/§10、07-workbench-ui-contract §6.3、47-ui-copy §7.7 文档同步；deprecated 选择函数删除 |

若 CP0 证实问题已被其他改动消除，保留复现对照与新增真实回归证据，按证据关闭；不得为了有实现而改代码。CP2 未覆盖页面入口和持久来源不能仅凭 helper 测试标 done。

## 5. 验收与恢复

- 两个等待问题，回复最近正在讨论的结构问题，第一条建书 run 保持原状态；刷新/重连后再次回复仍一致。
- 明确回复旧问题时目标可追溯且不能覆盖新问题；明确新话题不被旧 run 拦截；目标不可判时必要澄清。
- 重复发送、ack 丢失、乱序广播、跨 work/session、run 失活、旧选项、取消后回复：不重复推进、不串任务，原文可恢复。
- 拟命令：bash scripts/quality_accept.sh b31-author-reply-run-binding --surface tauri（实施时注册）；回归 agent-awaiting-author-steer-resume、agent-awaiting-author-input-required、Q3D 重传与 DS03 当前已注册场景；B26 的 agent-ask-author-options-roundtrip 在其实现后加入。
- 按 [AGENTS](../../AGENTS.md) 执行修改范围对应门禁、静态扫描闭环；触及主链时 I1/I2/I3/N-NARR 必跑。真实页面网络/持久化事实与模型理解表现分开报告。
- 2026-10-23 — 作者要求登记；将“已证实错误关联”与“待复现入口根因”分开，不做未经证据的全局 latest-run 改造。恢复先读 NEXT 与当前 WIP，再从 CP0 开始。

## 6. CP0 记录与 CP1 设计冻结（2026-10-25）

### 6.1 CP0 真实页面复现结论

- **已复现**：同会话两个 live `awaiting_author` run（结构 run S、B26 问题 run Q）时，作者用普通主输入写「我回答上面那个问题：…」实际发送 `agent_command steer`，payload `run_id=S`；Q 保持 `goal.version=1 / question.status=open`；persist `turn_xxx:steer:2 + agent_run_id=S + 唯一 submission_id`。显式「回复此问题」对照正确：`author_action author_choice`，`target_ref=Q/question_ref/expected_goal_version=1`，ack accepted、goal 1→2、Q completed。
- **主根因**：前端「当前 run」=`visibleAgentRunMap` 插入序末位——transcript `turn_result` 先入（旧→新）、standalone awaiting run 后追加，故总被选中；普通主输入对 selected run 一律 steer，且只检查 selected run 自身的 open question。**次根因**：JoinRestore 广播顺序无契约（T2 `[S,Q]`↔`[Q,S]` 交换；live-only 形状 selected 跟随最后恢复项）。**排除**：服务端按客户端 run_id 绑定无独立错误、goal 无跳级、无双 run 同时推进；B26 显式路径正确。
- 其他已证实：open question 在非 selected run 时普通输入不会被引导；「回答上一问」的普通输入不绑定问题身份；selected run terminal 时同文字才成新 user_message。

### 6.2 CP1 设计冻结（Q01–Q06）

- **Q01 确定性 active run 选择（前端纯函数）**：优先级 ① 唯一 open question（goal version 与 run 匹配）所属 run；② 作者最近交互过的 run（本地 focusedRunId：点击该 run 卡片/停等坞/结果、提交 steer 时记录）；③ 最近事件/创建时间更新者；④ 唯一 steerable run；⑤ 否则 null（歧义，不自动 steer）。禁止 Map 插入序/广播到达序作为语义依据。
- **Q02 主输入 steer 条件**：仅当 ① active run 唯一确定且 ② 会话中不存在其他 run 的未答 open question 且 ③ 无 pending answer/计划选项时，才走 plain steer；否则主输入按**新请求**（user_message 新 run）处理，并在输入区给出可见提示（现有 copy/notice 机制，不新增隐藏 hook）。显式问题/选项回复只走 B26 author_choice；停等坞「发送调整」显式绑定该 run。
- **Q03 服务端校验**：plain steer 增可选 `expected_goal_version`（前端总是发送）与 `run_id` 同 work/session/runtime live 校验；版本不匹配 → `goal_version_conflict` 拒绝且不推进 goal；不要求 awaiting（允许 running/paused 的显式 steer），但 terminal 拒绝（已有）。
- **Q04 JoinRestore 顺序确定化**：web 恢复广播按稳定序（created_at + run_id/sequence）输出；前端选择不依赖该序，仅用于可复现。
- **Q05 目标可见**：多 live run 时停等坞/输入区显示输入将发给哪个任务（复用现有 goal 摘要；多歧义时提示选择）。
- **Q06 边界**：不新增问题表；显式问题 schema 不变（B26 已有 question_ref/expected_goal_version/author_choice）；plain steer 字段为 additive 可选；不改 provider/创作工具/采纳语义。
- **CP1 影响面**：frontend（WorkspaceChat/agentRunInputRouting/agentRunAnchoring + 单测）、web（WorkspaceChannel steer 校验/恢复广播序）、application（AgentRunService steer 版本校验）、persistence 仅必要读取；场景 `b31-author-reply-run-binding` 在 CP2 注册。

### 6.3 CP1 实施记录（2026-10-25，`1a1fe079`）

- **前端**：`agentRunInputRouting.ts` 新增 `selectActiveAgentRun`（priority：唯一 open question（goal version 匹配）> `focusedRunId` > 唯一语义活动时间 > 唯一 steerable > null/ambiguous；忽略 terminal/dead）、`decideAgentRunInputRoute`、`openQuestionRunIdsForRuns`、`buildAgentRunInputPresentation`；`WorkspaceChat` 接入选择/决策（移除 visibleAgentRunMap 末位语义）、`focusedAgentRunId`+语义活动时间（仅 agent_event/TurnResult 更新，不用恢复广播序）、`submitAgentSteer` 携带 additive `expected_goal_version`、`AgentRunInputRoutingAids`（目标提示/歧义提示/任务选择）、copy/CSS；`socket.ts` ack 类型 additive `resolved_run_id/binding_source`（无 codegen）。双 live run 歧义时主输入为新请求+可见提示；有未答 open question 时不 steer 并提示走问题回复；停等坞「发送调整」显式绑定。
- **后端**：channel steer 接受可选正整数 `expected_goal_version`（非法类型 `invalid_expected_goal_version`）→ AgentRunService/Server；版本冲突返回 `goal_version_conflict`（current/expected）且不推进/不写 steer，缺省兼容旧行为；ack additive `resolved_run_id`/`binding_source`；`recover_durable`/`list_dead_bounded`/`reconnect_bounded` 按 `{inserted_at,id}` 稳定排序，组序固定；B26 问题回复 map 形式 submission 的 4-tuple 兼容 clause 修复（全量回归发现并修）。
- 测试：前端 `pnpm typecheck/lint/test`（37 files/607 tests）、frontend_audit、check_design_trace 全绿；后端 2080 tests/0（含 channel steer binding 2 例、application 冲突/兼容 4 例、author question roundtrip 21 例回归）、credo/enum/xref/arch 绿。
- 残留/CP2 输入：历史卡片/消息点击未接 focused（CP2 按场景定，不新增隐式点击语义）；待投递重传路径不带 expected_goal_version（schema/codegen 决策留 CP3）；坞内目标行可选；CP3 文档同步项（UA-01 additive 字段/旧 shouldRouteInputToAgentSteer 删除/copy 登记）。

### 6.4 CP2/CP3 证据与完成判定（2026-10-25）

- **真实 Tauri 场景**：`bash scripts/quality_accept.sh b31-author-reply-run-binding --surface tauri` PASS（`b31_cp2_author_reply_run_binding_semantics_verified_on_real_workbench`；cp2_checks 16/16；trials T1–T5；证据 `artifacts/slice-verify/b31-author-reply-run-binding-tauri/`）。Q3D 回归 PASS（plan-exhaust awaiting；awaiting 0 author_question、0 问题卡、steer 两次同 run、ack goal_version=2 只推进一次 + resolved_run_id/binding_source；证据 `artifacts/slice-verify/q3d-message-delivery-recovery-tauri/`）。B26 awaiting×2 回归 PASS。
- **门禁**：mix compile -Werror、2080 tests/0、test -Werror、repo-wide format、credo strict 0、enum、xref、arch、adr；frontend typecheck/lint/603 tests、frontend_audit、check_design_trace；quality_manifest_check；I1/I2/I3/N-NARR/I-CACHE 不适用（本 slice 未改 provider/创作主链），Tauri 证据为页面/持久化边界。
- **完成判定**：CP0 真实页面复现、CP1 有测试与错误路径、CP2 覆盖真实页面入口与持久来源、CP3 回归/文档/台账齐备 → **B31 done**。B26 显式问题矩阵仍由 B26/agent-awaiting-author-* 独立承担，未混入本 slice 结论。
- **known limits**：① 历史 run 卡片/消息点击未作为 focused 来源（避免新增隐式点击语义；当前聚焦来源=提交 steer/显式回复/停等坞点击/任务选择）；② 待投递重传路径不携带 expected_goal_version（generated schema 未扩，后端 nil 兼容；live steer 均携带）；③ 证据为 headless Chromium 驱动真实前后端（Tauri 窗口同时拉起），非原生 CUA；④ slice_verify 确定性 provider，不声明真实模型语义质量；⑤ T3/T4/T5 的 run 创建为外部协议 seed（证据已标注），T1/T2 覆盖真实用户创建形状。

### 2026-10-25 完成审计与原生补验

当前只重开原生交互证明，未回滚已验证的实现或浏览器结果。证据对账与作者裁决见 [既有对账任务](VS00D-G-GAP-RECONCILIATION.md) 的队列完成审计；机器证据 `artifacts/completion-audit/20261025-1817/surface-audit.json`。后续复用本 slice 原验收矩阵，以外部系统 UI 驱动真实窗口，保留源操作/WS/持久状态和截图；原批次只读，不修改判据。

#### 原生补验首批 CP0（2026-10-25）

- 批次 `artifacts/slice-verify/b31-native-20261025-a1/` 在被测输入开始前停止：T5 的两个 plan-exhaust 前提变成明确问题。原生 AX/截图、协议 seed、请求和独立 DB/profile 均保留。
- 离线重放首条完全相同的合成请求确认替身根因：`character_profile_revision_intent?` 把不同分句的“调整章节大纲”和“主角当前状态”合并为角色身份改判。生产随后按当前动作校验发起纠错/澄清；未据此宣称生产模型缺陷。
- 修复限于 test/support：角色改判动词与角色词必须属于同一分句，正常明确改判仍保持绑定。新增逗号/分号/换行反例与同分句正例；相关替身测试53/0。修复后同一请求输出 plan（`artifacts/slice-verify/b31-native-repair-20261025/exact-request-replay.log`）。原测量断言未改。
- A2 预注册：fixture 修复后的 scoped 原生复验，先验证 T3–T5 前提确为 judgment_plan_v1/plan_exhausted_without_completion 且无 author_question，再从 T1 开始原矩阵；任何前提不符或产品状态违约立即停本批，禁止补字段/改断言。真实模型预算0，同因最多再失败一次即升级。独立目录 `artifacts/slice-verify/b31-native-20261025-a2/`，不覆盖A1。

- 当前复验状态：A2 在端口预检被拦截，未开始任何产品测量；A1遗留进程已按日志/DB归属确认并清理（共享清理函数必须由Bash执行，默认zsh分词不兼容，不据此修改产品）。B37外部failure退出测试通过；TERM子等待仍超30s，已修正原生watchdog后台wait，第二次预算升级正在等待作者裁决。不得将此批或旧浏览器证据标为原生通过。
- 本轮局部门禁：后端2243/0（warnings-as-errors）、前端603/0/typecheck/lint、等待账本5/0、compile/credo均通过。统一扫描 `TASK_DONE_MANIFEST=artifacts/slice-verify/b31-native-repair-20261025/manifest.json bash scripts/ai_static_scan.sh --top 10`：18通过/2失败，剩余Top10共3条——历史Pencil误报、历史凭据accepted_risk、当前UI证据未完成pending（1 blocker）。不使用旧摘要或修改处置台账绕过。修复与门禁证据在 `artifacts/slice-verify/b31-native-repair-20261025/`。

#### 原生复验前的离线前提核查预注册（2026-10-25）

预算裁决待回复期间，仅读取 A1 的一条合成判断请求和已冻结的 trial 输入，调用当前 SliceVerify.complete 做6类输入的离线响应检查（每类一次、零重试、零真实模型、无产品服务/数据库写入）。只确认替身响应形状与当前矩阵前提是否仍相容，不计页面通过或模型语义分数。输出 `artifacts/slice-verify/b31-native-repair-20261025/fixture-feasibility.json`；若原验收前提与新能力有冲突，先提交具体契约/样例调整方案，不直接改断言。

离线准备检查的输入构造先被守卫中止（0次替身调用）：当前合成请求在 author_inputs 来源清单和“作者输入”两处携带同一原话。后续构造同步替换这两个已定位载体并保留数量=2的断言，避免新输入与旧来源互相矛盾；原失败日志保留，仍为每类一次调用，不改变验收判据。

#### 离线前提核查结果与待裁决增补

六类检查完成（6次纯替身、0重试/真实调用）：原问题→ask_author、计划→plan、结构类普通输入→ask_author、语义回答类普通输入→execute prose_writing、歧义保留计划输入→plain reply、显式补充→execute prose_writing。证据见 `fixture-feasibility.json`，不计原生/产品链验收通过。

**当前矩阵前提冲突**：T1 在空作品中重复发送“处理重复第11章，只修正列表编号…”；B30 的现有测试替身诚实要求确认可维护结构，因此这两个新请求可产生各自的明确问题。T1 随后仅回答原 Q，却断言“只剩 S、恢复发送调整”，与“只要仍有明确问题未答，未绑定输入应成新请求”的既有 B31 契约不相容。该冲突目前由离线 fixture 和现有状态规则确认，尚未执行本批真实 T1 输入；不把推断当页面失败。

已接受增补（2026-10-25，作者选择“接受增补，保留全部绑定断言”）：保留原输入及普通输入新 run 断言；若这些新请求产生问题，逐个记录其独立 question_ref/source/run，回答原 Q 后验证其余问题仍 open、S goal仍1、主输入仍新请求。随后从各自原生问题卡用符合其语义的具体回答关闭新问题（每问题≤2次不同回答），最后在确实仅剩 S 时检查发送调整/目标绑定。T2 若出现同类新问题采用相同规则；T3/T4/T5原范围不缩小。所有附加问答记入 author_question_events。该方案不改产品/ADR/schema，不压制B30澄清；改变测试执行条件已获作者授权；TERM复验预算是另一待决事项，未随本次接受自动解除。

#### 已接受增补的实现（2026-10-25，原生运行预算仍待裁决）

- 原输入、原问题绑定、恢复序、T3/T4/T5 与其他任务不推进断言均保留。T1/T2 增加“答原Q后其他问题仍open/主输入仍新请求”检查；只有全部问题关闭且新请求run完成，才检查剩余S的调整入口。
- `b31-question-proof.mjs` 由浏览器驱动和原生验证器共用：逐项核对源动作、source_turn_ref/run/question_ref/expected_goal_version、回执、唯一持久原话；每run至多2次不同回答，重复/空问题拒绝，相同完整重传不重复计数。`author_question_events.json` 覆盖原问题和额外问题。
- 额外结构问题的具体默认决策已预设：确认第一卷，缺章节时先生成12章待采纳章节计划；第二次说明12章调查/冲突范围，保持已有正文。推荐选项优先；不cancel、不重发原指令、不自动采纳。若问题重复、缺文本、运行失败或仍未完成，诚实失败，不强制把任务变成completed。
- 原生需保存 T1/T2 的 `after-original-reply` / `after-questions-closed` 持久快照及同名AX；`native_b31_evidence.mjs capture <dir> T1 after-original-reply` 等命令只读公开API。原生验证重查每次动作/回执/其他run版本、分页历史和最后开放问题集合；不会只相信布尔结果。
- 对新增回复做隔离上下文回归时，复现另一个任务的 UA01PLANEXHAUST 标记会把当前单产物请求变成plan。修复仅test/support：判断fixture的标记只检查当前作者输入；当前任务带标记的正例仍有效。失败/修复日志 `question-context-before-fix.log` / `question-context-after-fix.log` 保留；相关61项测试通过。产品判断逻辑未改。
- 256项前端定向测试通过，包含新证明与验证器负例；原生/浏览器场景均未因本次授权而启动。旧报告缺少新增关闭条件或真实作者动作时将拒绝，证据层级仍分开。

- 2026-10-25 20:38 续行判断：作者要求先据项目愿景裁定工程事项。此处仅验证已定位的监督退出修复，不改变产品语义、原生标准或30秒预算，故执行一次新的TERM探针；若通过，沿已接受的T1/T2增补执行A3。新探针再次超时则保留失败并停止，不自行扩大预算。此前“等待TERM预算”记录为当时状态。

#### A3原生scoped复验预注册（2026-10-25 20:40）

- 前提：B37 TERM修复复验10.314秒通过；作者已接受T1/T2增补。
- 范围：一次T1–T5原生矩阵；T1/T2真实UI创建Q/S及所有测量动作，T3–T5仅前提协议seed。新问题逐源回复≤2次不同回复/run；保留原输入、run/source/question/version/持久化全部断言，不采纳、不cancel、不重发替代指令。
- 预算：slice_verify，真实模型0；输入/ack30秒、turn/candidate120秒、adoption90秒、maintenance180秒、export60秒、restore30秒、idle120秒，10秒心跳。单批失败立即保留，禁止重复同批或改变判据。
- 证据：`artifacts/slice-verify/b31-native-20261025-a3/`，独立DB/profile/源码指纹；保留全部旧批。失败或结束均回收本批所属进程，作者手动模型不动。

- A3前提失败：T3计划被生产 `character_profile_capability_required` 守卫拒绝，未执行测量UI输入。failure首因保留，监督EXIT/1，端口已释放；原生截图/AX、独立DB/profile保留。具体CP0及修复归[B29](B29-existing-character-role-revision.md#b31原生补验发现的身份意图误判2026-10-25cp0修复)，不修改本矩阵。此为生产跨分句误判，与A1替身误路由分开记录。

#### A4产品守卫修复后的scoped回归预注册（2026-10-25 20:48）

- 前提：B29身份守卫CP0/红绿回归及原话AgentRun计划链通过；A3失败批保留。
- 范围/预算：一次A3生产缺陷修复后的T1–T5原生回归，沿A3原矩阵、输入和所有绑定断言；T1/T2增补仍按作者批准执行。预算不变，真实模型0，不是语义换分。T3 seed失败现在自动写首因并退出，不等待整个turn预算。
- 证据：`artifacts/slice-verify/b31-native-20261025-a4/`，独立DB/profile，运行指纹补入实际CharacterProfile源码。再次同因失败停止升级，不修改断言。

### A4原生补验收口（2026-10-25 20:57）

- **真实原生场景**：`artifacts/slice-verify/b31-native-20261025-a4/run/summary.json`；surface=tauri，driver=cua-native-system-ui，五trial全部通过。T1/T2原生创建Q/S；普通输入共6条各成独立run；7条问题回复均精确绑定source_turn/question/run/version/submission，其他任务版本不变；所有问题关闭及新run完成后才恢复仅S调整入口。T3/T4创建顺序互换；T5可见选择后steer只推进目标1→2。T2三次原生重开JoinRestore顺序一致。
- **证据边界**：T3–T5仅前提协议seed，全部被测输入/回复/选择由原生UI完成；slice_verify确定性替身，真实模型调用0，不代表文学或B27语义质量。16组截图/AX、代理网络帧、app/provider日志、会话快照、独立DB及profile备份保留。未采纳候选、未改stage存量。A1/A2/A3及失败监督探针不覆写。
- **监督/资源**：47个分型等待、0超时、10秒心跳；独立监督EXIT/0；窗口已关闭、4657/5769/4661端口释放、无本批所属进程。作者手动加载模型保留，不冒称全局空。TERM专项10.314秒通过见B37。
- **生产修复归属**：A3发现的跨分句角色身份误判已在B29原任务登记CP0→红绿→真实计划链→原生回归；只改application CharacterProfile，不放宽B31断言。
- **门禁**：`mix compile --warnings-as-errors`、`mix test --warnings-as-errors` 2247/0、xref无环、arch通过；前端typecheck/lint/614 tests、frontend_audit、design_trace；I3 3/3、I1 4/4、I2 3/3、N-NARR/I-CACHE、quality_manifest、next_task、task_done通过。证据在 `artifacts/slice-verify/b31-native-repair-20261025/{character-route,closeout}/`。
- **静态闭环**：执行 `bash scripts/ai_static_scan.sh --top 10`；修复新增测试2处AliasUsage，复扫exit0：19 checks pass、gitleaks原始check fail；剩余Top 10仅2项历史发现（Pencil fileToken=false_positive；ProjectGod历史凭据=accepted_risk），touched findings=0、pending=0。未新增豁免或修改baseline。
- **残余**：§6.5既有重传不带expected_goal_version/历史卡片不隐式聚焦等边界保留；B27未完成known-gap、其他slice原生证明不由本结果代替。NEXT按原顺序转B28。
