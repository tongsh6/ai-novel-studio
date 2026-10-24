# B31：作者补充输入与待回复任务的稳定绑定

- 状态：doing / **CP0 已完成（2026-10-25，真实 Tauri 隔离复现）**：已复现「两个 awaiting run + 普通自由输入被 steer 到另一 run」；根因=前端当前 run 取 visibleAgentRunMap 插入序末位 + 普通主输入对 selected run 一律 steer（非 selected 的 open question 不参与）+ JoinRestore 广播顺序无契约；服务端按客户端 run_id 绑定无独立错误（goal 无跳级）。CP1 修复设计已冻结（见 §6）。
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
| CP2 | 新场景从真实输入到同 run 结果/刷新/再回复；B26 选项接线可用后补选项等价回归 | todo |
| CP3 | DS03/B23/Q3D/取消和重传回归、全门禁、台账收口 | todo |

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
