# ADR-0027：消息处置、运行结果与跨轮来源关联 v3

> **2026-10-24 联合修订已接受**：作者确认“确定 开工”，接受 B26/B27 联合设计及 ADR-0001 普通回复来源修订，并授权共享入口实现与验证。下文历史“待 Accepted / 本轮只改文档”描述保留当时语境，不再构成本次实施阻塞；实现和验收仍按各 slice 逐项留证。

- 状态：**Accepted（2026-10-05）**
- 原提案日期：2026-08-31；本次修订依据：用户核查 D8 根因后，确认先以现有对象建立「输入—处置—执行—结果」闭环并授权实施。
- 原「LedgerEntry 第六账」方案未被接受，不由本 ADR 自动授权。
- 实施入口：`tasks/slices/Q3D-message-outcome-roundtrip.md`；队列 `tasks/NEXT.md` Q3d。
- 契约来源：VS-00B 上下文、ADR-0021 AgentRun、ADR-0019 采纳、Q3c 作者源候选、`06-memory-context-and-trace.md`。

## 1. 经核查的根因

D8 原始日志中的模型能引用先前存档诉求，并非完全没有跨轮记忆。五次写入诉求误派只读，
属于 Q3a/Q3b 已处理的能力边界问题。进一步核查发现：只读执行前后四组会话摘要逐字相同；
只读 flow 的结果只进入运行审计和 Channel 广播，没有进入下一轮读取的 Interaction；
判断上下文也没有完整消费待采纳/已采纳状态。现有 Q3c 场景只证明同条消息同时提供原文和
存档指令，未证明先提供原文、下一轮再发出存档指令。

依据：`notes/2026-08-30-stage-session-archive-loop.md`（历史分析）；
`log/llm-calls/stage/2026-08-28.jsonl` 第 10/14、16/22、24/30、30/34 行；
`DialoguePlanningService`、`ReadonlyBatchContext`、`WorkspaceContext` 当前实现。
历史材料中的「每轮从零」「无任何跨轮状态」不作为本次实现前提。

## 2. 决策

### D1 消息与运行分别留痕，复用已有对象

- `Interaction` 保存作者原文及消息处置关联；`AgentRun` 保存一次运行的生命周期。
- 已验证的 `user_message` 在返回成功 ack、启动模型执行前持久化；保存失败返回错误。
- 接收身份由 workspace/session/turn 确定；同身份同输入重传复用已有 run，不再次调用模型；
  同身份不同输入拒绝。作者原文不可被状态更新覆盖。
- 处置元数据放在 `Interaction.content`：`agent_run_id` 与 `message_handling`
  （复用 AgentRun status、processed_at、result_turn_refs）。处理完成不等于作品事实写入。
- 执行中的 steer 输入同样保留原文与来源，不能用更新 goal.text 代替消息记录。
- 桌面 App 在发送前为一次输入生成不可变 `turn_id`，依 `user_message_submission.json` 保留原文、
  作品/会话、候选引用及计划选项。Tauri 经原生命令原子写本地待投递文件，浏览器入口使用对应平台存储；
  本机写入失败不得投递。记录保留至结果或终态/失活回执，重连与刷新复用原身份核对。
  明确拒绝则保留原文并标记 rejected，后续恢复只展示、不自动投递；作者修改后发出新的请求。
  作者主动再次发送或“重新发起任务”使用新身份，即使文字相同也不合并。
- steer 也走相同本地待投递机制，回执确认后才删除其投递记录；重复引导不能再次推进 goal.version。
  内部来源仍为 parent:steer:version，投递身份由 Interaction.content.submission_id 单独关联，
  恢复同时携带两者，防止刷新后重复显示作者补充。重连还核对持久会话结果，覆盖已收到命令回执
  但后续结果在断线期间完成的情况。历史只读页面不混入当前会话的待投递气泡。
- 接收与启动按消息身份串行化；相同身份的原文、候选引用或计划选项不同则拒绝。
  Channel 明确拒绝与当前连接不一致的 work/session，不能把旧消息挪到新作品执行。
  已接受身份先核对原输入和旧回执，不重新要求候选仍可选，也不激活已成为历史的会话。
- user_message 回执携带 `agent_run_state`、`runtime_live`、`message_status` 和持久 `turn_results`。
  状态取自活 runtime 或原运行记录；前端不把任意 run_id 构造成 running。无进程的 bounded run
  不从普通重传重建，保持真实历史状态并明确失活；无运行记录则诚实说明无法继续。
- 不新增义务表或第六账。未来确有跨多个独立任务的长期目标生命周期需求时，另行评审。

### D2 所有 flow 的结果经过统一记录边界

- AgentRun 收到成功业务 TurnResult 后，先持久化 assistant Interaction，再广播给前端；不依赖
  各 profile 自行决定是否记录对话。各 flow 仍负责其领域 trace。
- 以 scope/turn/result 身份去重；相同结果重放不追加重复消息，更新同一结果的当前快照。
- 失败、取消、等待作者保留输入及运行状态；结果写入失败不能发布成功产物。
  若存储本身不可用，可以实时发送明确的“未能保存”失败通知，但不能声称该通知已可持久恢复。
- 运行审计与会话记录职责分开，但通过 run/turn refs 关联；审计存在不替代会话记录。

### D3 判断消费真实处置和采纳状态

- `DialogueContext.interaction_state` 提供同作品同会话的有界作者消息、处理状态、近期结果，
  以及独立于消息窗口的完整待采纳/已解决候选；`open_behavior_summary` 同批进入判断输入。
- 采纳状态由 `WorkSessionRepo.adoption_state/2` 统一从持久记录投影，UI 恢复和 Agent 共用；
  相同 artifact_id 去重，终态覆盖旧 pending。不能用最近 30 条聊天或 80 条上下文代替完整待办。
  聊天分页继续独立运行。已退出/归档会话只能回看，不恢复可执行待办。
- HTTP resume/show 除完整 pending/resolved 外，向活动会话提供 `pending_adoption_turn_results`：
  待办所属回合的既有 TurnResult 和 available_actions，去除运行活动明细；前端按作品/会话在
  TanStack Query 缓存，与实时结果共同查找真实授权动作，不伪造 action_ref，也不插回聊天分页。
- 判断摘要只展示每类最多 12 项，同时提供真实总数和 omitted_adoptions；
  `session_adoptions` 探索工具按当前运行的 work/session 读取同一完整投影，允许关键词、
  artifact_ref 和 JSON `{query, offset}` 分页查询。session 不由模型指定；非活动或跨作品查询拒绝。
  原文仍只由明确来源物化，查询待办不自动扩大作者原文白名单或执行采纳。
- 消息已处理、运行结束、候选已采纳分别表达。追问「完成了吗」必须依据结果和采纳事实，
  不能只因 run completed 宣称已保存；只读结果仍明确无写入。
- 待采纳候选在追问后仍待采纳，回复不会关闭它；作者的显式处置请求按 D5 执行。

### D4 跨轮原文引用保持字节来源

- 判断协议增加可选 `author_content_source_ref`：引用当前输入或本次上下文列出的历史作者 turn。
  该字段仅在 `author_content_registration=true` 分支参与来源校验和消费；未启用登记时
  归一为空来源，不得因未使用字段的占位值阻断普通回复。启用登记时来源必填：
  本条原文显式填 `current`，历史原文填本次提供的 `turn_ref`；缺失值不得默认当前输入。
- 原文登记仅允许 `action=reply`、`frame_type=capability_gap` 的保真物化路径，与
  execute/plan/explore/await_author 互斥。来源不明确需要澄清时，关闭登记信号再等待作者。
  两阶段判断共用业务规则；解析时给予一次明确纠正机会，执行派发前复核同一规则。
  仍不合法则诚实失败，持久记录消息及失败结果，不派发创作工具、不生成候选、不入档。
- 来源选择归模型，合法来源集合、作用域和字节复制由应用层校验；禁止按「上一条」关键词
  在生产代码硬选来源，也不允许模型直接提供待保存正文来冒充作者原文。
- 候选的 `source_turn_ref` 仍指当前生成/采纳动作所属 turn；原文来源单独由
  `source_tool_result_ref` 和 item.provider_call_ref 的 `author_input:<原文 turn_ref>` 表达，
  不能把历史原文 turn 当成本轮动作授权入口。先提供资料、后要求存档时，
  body 取所引用作者消息原文。缺失、越界或不明确的来源诚实失败/追问，不回退保存指令本身。
- 同一来源已有待采纳/已采纳候选时复用其状态，不重复生成同一份作者源候选。

### D4.1 单调用迁移的原文/方向/缺口承载（2026-10-24 联合修订，已接受并随 B26 CP2 实施）

本节记录联合修订接受的 D4.1 目标，不把 Accepted 的来源/字节/幂等边界取消。D4/D5 中旧 action=reply、frame_type=capability_gap、author_content_registration/author_narrative 的具体模型参数写法属于已删除的两段式实现；B26 迁移后以 [UA-01 §2.2](../contracts/UA-01-unified-agent-run-loop-contract-pack.md) 为唯一新模型协议，不再同时保留旧入口。实现与验收证据见 B26 §11–§14；文档记录不替代逐项验收。

- 原文登记由 register_author_content 提交明确 author_content_source_ref 和作者可见说明；app 只从已允许的当前/历史消息读字节，保持源与动作 turn 分离、全文边界、缺来源拒绝、去重、采纳及编辑后状态语义。
- 移除旧 reply/capability_gap 参数联合条件，改校验明确登记操作及其 source/scope/state；不能为了沿用旧解析器把新工具再包成隐式旧 reply 协议。
- 普通 content 回复没有副作用，不能从文本列表/空行/语气猜登记、方向选择或采纳。只收下不展开不调用登记/方向工具，原始输入仍可靠留存。
- 可操作创作方向由 propose_creative_directions 明确结构；缺口由 report_capability_gap 明确结构。分别保留原有方向与 Q3B 业务结果，不将自然文字机械转成默认动作。
- 纠正后的作者说明取当前有效响应的 content/author_reasoning，N-NARR/source refs 不与上次失败文字混绑。模型工具来源变化不改变候选字节或采纳授权。
- ask_author 回答绑定实际问题/goal version/source_turn；选项值与原话均保留，稳定投递身份与 receipt 幂等沿 D1/D3，不因“同一 run”就接受过期问题。

实施责任：B26 负责新 schema/handler/公共校验迁移与 Q3C/Q3D 回归；B27 负责源材料、任务含义、事实状态与规则唯一来源；B31 负责通用多任务归属。当前/历史原文→候选→刷新→采纳→追问完整链是必要验收，不把工具名存在当作闭环。不新增第六账或长期义务表。

问答恢复/幂等细则以 UA-01 §2.2.2 A 为唯一真源：每问必有持久 TurnResult 与系统自由文本动作，源动作绑定键不变、submission_id 按原输入持久化，receipt 使用作用域派生键；空选项不绕过 author_action。状态收尾/发布失败重放按 UA-01 §2.2.3a，当前失败不否认先前已提交成果。普通文本 trace 以 VS-00D §11.4 区分 supplied evidence 与模型未提供的结构，不增加抽取调用。上述联合修订已随 B26 CP2 实施并由 B26 QA/OUT 与页面证据覆盖（见 B26 §14）；现有数据不回填伪造元信息。

### D5 已有候选的对话处置（2026-10-18，BIZ-06 用户确认）

- 目标体验依据 `docs/design/00-vision-and-engineering-roadmap.md` §2.2–2.3 的 AI 引导式创作：作者可以直接说修改或
  放弃，AI 识别目标并执行现有能力；不能把操作建议当作创作方向，也不能声称执行了尚未发生的动作。
- 判断① `execute` 支持 `revise_pending_artifact` / `discard_pending_artifact`，
  `pending_artifact_ref` 必须是当前作品、当前活动会话中实际 TENTATIVE 的 artifact_id。
  目标不明确时等待作者澄清；无效引用允许一次模型纠正，仍无效则诚实失败，不猜最新对象。
- 判断与执行分步；执行前重新读取持久状态，核对活动会话、实际目标和预算。
  修订实际工具由目标类型决定，明确加入运行权限并作为下一步 target_tool_ref 通过策略，
  执行端再次校验，不以 judgment 权限隐式调用创作工具。
  修订复用 Orchestrator 与既有创作工具，以完整原稿及作者要求生成独立候选；
  dialogue_goal 须消解历史指代，与当前作者原话分别传给执行工具，不能在交接时丢掉已理解的修改要求；
  原稿不覆盖，修订稿仍待采纳，模型字节及 Provider 来源保持原样。修订能力不含采纳授权。
  既有 CreativeRequest.revision 承接修订要求；设定修订沿用原稿形态，不套用新建模板添加栏目，
  修改过程说明放 rationale，不混入可采纳正文；应用层不通过删改输出字节修正内容。
- 放弃复用现有 discard 动作验证与 AdoptionWorkflow，记录本轮请求和源对象关系。
  只改变候选处置状态，不写作品事实；已处置、跨作品或历史会话对象不得再次执行。
  成功后沿用既有 AdoptionWorkflow 的事实回执，执行前的模型判断只保留在来源绑定的过程记录中，
  不得用“尚未执行”的判断说明替换完成结果；该回执是结构事实，不是 app 编造的模型完成回顾。
- 修订候选的 `revision_of` 指原稿，`registration_source_ref` 继承资料登记来源。
  登记去重沿该关系检查 pending 与 ACCEPTED/EDITED_ACCEPTED；所有版本均放弃后才可重新登记。
  这两个字段不充当内容来源，item.provider_call_ref 仍绑定本次真实模型输出。
- `interaction_state` 和 `session_adoptions` 同批提供版本关系、可执行操作、实际正文预览；
  作者消息附来源登记计数。作者“修改后保存”的全文优先于历史候选 items，不能据旧正文回答状态。
- 解析纠正禁止重复登记时，必须由本次模型输出新的 `author_narrative`，不能沿用先前承诺。
  原生工具叙事绑定具体字段和 Provider 字节，旧 author_reasoning 绑定继续兼容。
- UI 的“修改后保存”只接受作者实际编辑的完整正文；instruction-only 请求不得被拼接后入档。
  保存/编辑/放弃前检查持久待办，防止旧页面复活已处置候选。保存失败保留弹窗及作者编辑，
  展示失败提示，不自动切换目标或清空内容。

实施与外部验收归 `tasks/slices/Q1B-live-archive-recheck.md`，未扩大为任意已采纳事实的自动改写。

## 3. 不变量

1. I-M1：成功接收必有持久消息；失败不能伪装为成功接收。
2. I-M2：同一输入身份只启动一次运行；原文不可因重试、steer 或结果回填改变。
3. I-M3：成功业务结果先入会话记录再发布；存储失败只发诚实错误通知；技术完成与作品入档分开判断。
4. I-M4：来源与处理状态按作品/会话隔离；作者源候选逐字绑定实际被引用的消息。
5. I-M5：待处理与采纳事实能进入下一轮判断；刷新恢复不丢输入和结果、不重复执行模型。

## 4. 验收与边界

外部真实工作台多轮场景：输入原文→后续要求存档→生成引用原文的候选→刷新→追问
未采纳状态→作者采纳→再次追问；另以只读回合证明运行结果进入下一轮上下文。
局部测试覆盖记录失败、重传、输入冲突、失败/取消、非法来源与跨作品/会话隔离。
完整命令、证据和实施状态见 Q3D slice；没有真实页面证明时不得标 done。

本 ADR 不自动确认旧提案的作者义务账、通用语义履约判定或任意跨任务目标状态机。
这些仍需真实需求与独立契约，不以本次消息闭环宣称完成。

## enforced_by

- apps/novel_application/lib/novel_application/turn_interaction_service.ex
- apps/novel_application/lib/novel_application/agent_run_service.ex
- apps/novel_application/lib/novel_application/agent_run_server.ex
- apps/novel_application/lib/novel_application/judgment_protocol.ex
- apps/novel_persistence/lib/novel_persistence/interaction_lifecycle.ex
- apps/novel_application/test/novel_application/turn_interaction_service_test.exs
- apps/novel_persistence/test/novel_persistence/interaction_lifecycle_test.exs
- quality/acceptance/scenarios/q3d-message-outcome-roundtrip.yml

- quality/acceptance/scenarios/q3d-author-registration-guards.yml

- apps/novel_persistence/lib/novel_persistence/work_session_repo.ex
- apps/novel_application/lib/novel_application/work_session_service.ex
- apps/novel_application/lib/novel_application/exploration_service.ex
- quality/acceptance/scenarios/q3d-long-session-adoption-state.yml

- frontend/src/lib/socket.ts
- frontend/src-tauri/src/lib.rs
- docs/design/schemas/foundation/user_message_submission.json
- quality/acceptance/scenarios/q3d-message-delivery-recovery.yml
- apps/novel_application/lib/novel_application/pending_artifact_workflow.ex
- apps/novel_application/test/novel_application/pending_artifact_workflow_test.exs
- quality/acceptance/scenarios/q1b-candidate-lifecycle.yml
- quality/acceptance/scenarios/q1b-candidate-stale-modal.yml
- quality/acceptance/scenarios/q1b-candidate-revision-adoption.yml
