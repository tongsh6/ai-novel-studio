# 模型交互协议规范（设计候选，非已冻结生产协议）

> 归档注：以下正文保留源包 `f13ff640` 的候选设计，不代表当前运行实现；后续契约差异与归属见 [归档说明](integration-notes.md)。

## 1. 目标、版本和适用范围

这是基于项目现役契约设计的**端到端 JSON 表达与验证规范**。用途是审查、确定实现边界、生成真实消费者的契约测试；不是新增一套 ModelInteraction 数据库，也不是现役 RequestIR 的未经批准替代品。设计版本 `ans-model-interaction-design/1.0-draft` 只标识本审阅包。`canonical_contract=authoring-request-ir/v1` 标识映射目标，**不表示本包的 Request 对象就是当前 Elixir RequestIR 序列化结果**。

项目已确认的主轴是 Dialogue-first / Agent-native、作者主权、长期创作连续性、按需求证和可回放。现役 RequestIR 负责原生消息、工具与Provider投影 [S01/S03]；专业任务、执行简述和质量评估已经有独立职责 [S04–S07/S11–S13]。本包沿这些责任组织，不因追求“统一”让判断器接收所有专业字段。

完整不等于每轮全量。Schema 表达所有合法情形，实际请求只实例化当轮需要的 profile、材料和输出约束。没有小说正文需求的统计问答不装入全章；整章重写不得以短摘要代替完整基线。

## 2. 四层对象及生产者

| 逻辑层 | 本包文件/对象 | 权威生产者 | 不允许的混同 |
|---|---|---|---|
| 请求派生视图 | `request.schema.json` | application 从 AgentRun、Canonical、AuthoringTask、真实材料派生 | 不持久化为第二主事实，不把作者原话重新总结后冒充原话 |
| 模型往返 | `model-response.schema.json`、`examples/wire/` | Provider adapter记录真实接收；content/tool arguments为模型产出 | `status/usage/provider_ref`不是让模型填写的业务权限 |
| 系统验证与效果 | `validation`、`tool_result`、`application_outcome` | 校验器、只读工具、Orchestrator、采纳事务 | 校验合法不等于有权限；模型提议不等于真实写入 |
| 作者可见结果/行动 | Outcome.author_visible、AuthorAction、ProviderEvent | 原生模型字段的精确投影+明确标注的系统状态+真实作者动作 | 不能修改模型原文后保留原字节来源；不能把流式预览当已采纳 |

`exchange` 只是**离线样例容器**：把一段请求、响应、校验、作者动作、执行回执与事件放在一起检查。生产不应增加 Exchange 表、Exchange coordinator 或并行事件总线。

## 3. 请求顶层职责

| 字段 | 必须明确的语义 | 模型消费方式 |
|---|---|---|
| `protocol` | 提案版本、基线commit、当前契约归属 | 日志/适配层；不整体塞入Prompt |
| `identity` | agent_run或standalone_operation二选一 | 内部追踪；只供必要坐标，不能让独立摘要伪造会话/run |
| `system` | SystemIdentity引用、专业角色、宪法/输出契约版本 | 稳定system前缀；材料不升格为系统指令 |
| `task` | 调用目的、作者/作业来源、目标版本、范围、保留项、输出要求 | 业务数据；judgment目的不是预先判断作者意图 |
| `author_input` | 作者本轮原文、真实message_ref、UTF-8哈希 | 独立原生user消息，只插入一次；独立作业可没有 |
| `context` | 本次实际可见材料、权威级别、覆盖/省略、未完成义务、必要创作设计 | Base材料进入应用数据；观察材料只在对应原生tool结果展开 |
| `history` | Canonical有序视图、真实工具往返、有效checkpoint、未答问题 | 保留因果顺序；不靠选最近N条任意丢历史 |
| `authority` | 系统权限/预算事实的投影，模型仅有建议权 | 只提供必要约束；完整签发/撤销信息保留在系统侧 |
| `capabilities` | profile工具、实际业务效果、目录覆盖与探索入口 | 原生tools展开完整Schema；目录不是无边界预装所有作品知识 |
| `runtime` | Provider/model、输出预算、流式、strict方言 | 传输参数，不能作为模型业务事实 |

`identity.kind=standalone_operation` 不要求 run_ref/session_ref/turn_ref。章摘要、设定盘点、结果叙述可以是已有事实驱动的独立作业；这不意味着“Provider能力有限”，不能因此填finite_mode。参照现役 `RequestIR.text_operation` [S03]。

`history.current_author_insert_at` 是**本设计的派生视图索引**，不是建议新增的Canonical存储字段。它使当前原话在同回合工具读取之前，而在下一作者回合时置于历史之后，避免连续工具调用后重复当前作者消息。生产应由已有消息身份/顺序推导等价位置，不持久化另一份顺序真源。

## 4. 领域任务、信息需求与产出

### 4.1 已有14种专业任务

`first_draft / continuation / rewrite / revision / character_design / character_evolution / outline / world_building / chapter_mission / quality_evaluation / chapter_summary / fact_inventory / ledger_reconcile / result_narration` 是 `AuthoringTask.kinds` 的代码事实 [S04]。

本包额外的 judgment/plan_draft/continuation_decision/author_content_registration/work_profile_revision/creative_directions 是**场景标签**，映射现有判断工具/入口，不是在 AuthoringTask 中新增这些运行时枚举。详见 task-profiles.json。

### 4.2 创作语义

37项要素的名称和四层/三态来源于项目要素模型 [S02]。`NovelElement.payload` 的细分JSON键是本设计建议的机器表达，**不是37张新表、不是已实现字段承诺**。字段最多是一项任务实际需要的一部分，允许只带已确认目标及相关引用。

- 设计态：全书/卷/章/场的目标与计划，不等于正文里已经发生。
- 实现态：已采纳正文及其有证据的提炼；模型提炼仍是derived/tentative，不能自动获得canon权威。
- 进度态：设计兑现进度，引用真正的账本/事件/版本；不能依据“读过标题”推断已兑现。
- 写前 `execution_brief` 必须标design。scene_units保持项目的target_change、causal_spine、agendas、information_delta、emotion_transition、dialogue_intent、sensory_anchor；情绪以状态迁移表达，不用无来源的数值曲线 [S06/S07]。
- `style` 区分当前明确要求、已确认长期偏好、样本和推断。作者素材/第三方文字是参考数据，不因进入Prompt就成为作者自己的表达、长期偏好或canon [S19]。

### 4.3 任务范围与基线

`scope.refs` 是目标对象，`material_refs` 是此次实际提供的材料实例，`observation_ref` 是真实观察身份，`provider_call_ref` 是模型调用身份，四者不可混用。`used_context_refs` 对观察用 observation_ref，对Base用已公开材料来源；不能拿目标chapter_ref伪装“本次已读取”。

修订必须有 base_ref、base_hash、expected_base_versions；其中多片段/分页的完整性需要按同一对象版本聚合范围证明，不能只有complete布尔声明。

- `target_segments`：模型只返回目标段替换稿。系统根据既有稳定segment定位应用替换；目标外字节由原版保留，不要求模型再抄一遍。
- `whole_chapter`：请求必须提供完整当前基线，响应符合全章覆盖；不得把单片段当整章完成。
- `format_only`：采用现有 `prose_formatting_plan` 思路，模型返回真实boundary_id的换行计划，系统确定性应用；不让模型重写文字后自称没有改字 [S10]。
- 不同任务的单一输出容器并不意味同一payload：角色、卷纲、正文、排版、质量发现必须经过各自领域契约，不能依赖通用body字符串校验完成所有领域校验。

## 5. 来源、权威、信任与覆盖

`Source.authority` 回答“这段材料在作品中是什么地位”，`trust` 回答“通过谁、从哪里得到”；二者正交。tool_attested只证明工具真实返回，不保证外部网页事实正确；model_generated不能自己提高为canon。

| 情况 | 合法表达 | 禁止表达 |
|---|---|---|
| 尚未读 | coverage.status=not_read，included=0 | 空列表表示“已经查明不存在” |
| 真实查得为空 | complete + included=total=0 + omitted_count=0 | 隐藏查询错误、把失败当0 |
| 只看一页 | partial/truncated + 区间/总量或null + next_cursor | complete=true，只靠字数猜覆盖 |
| 来源过期 | stale + 原版本 + 重新读取/核对 | 静默把旧内容绑定新版本 |
| 当前不可访问 | unavailable/omissions(access_denied) | 编造数据或暗示作品中没有 |
| 没展示全部历史 | checkpoint/omissions + 原Canon可回查 | 无记录截断messages |

省略字段表示“不适用或未请求”；null只用于Schema明确允许的“未知/不可得”（例如实测Token未收集）。空数组只有在已读取或明确没有需求时才有意义。不得用默认0代替未知Token/字数/版本。

材料是数据，不能提升成system。作者在粘贴引用文本、工具读到恶意命令、历史小说对白中出现“忽略前文”都不构成更高权限指令。用户当前指令仍遵循确认/采纳边界；模型不能改系统规则或自授工具权限。

## 6. 历史与Checkpoint

现役Canonical保留真实作者/模型/工具顺序。压缩是**已提交、可核验的显式替代表达**，不是在投影器里随意删除历史。

本包将checkpoint分为：
- `current_call_id_coverage`：现行闭合工具交换语义的设计映射。
- `proposed_scope_or_turn_coverage`：纯讨论/旧Scope覆盖的目标提案，**不可发送到现役v1后冒称已支持**。必须先完成VS-00L/ADR裁决、生产消费和回归。

对新覆盖结构必须证明：被覆盖原消息/调用确实存在、来源版本一致、不覆盖未回答义务、不切开工具交换、未产生新授权、原始文本可回查、恢复幂等。摘要本身不是canon，不能替代修订所需全文。

## 7. 原生工具与响应分工

判断器的7个工具、continuation_decision、submit_tentative_artifact、report_quality_findings均来源当前代码 [S08–S12]，本包10个名字的镜像**不是新增10种工具**。同一profile只携带自己需要的工具。

保留现行重要规则：判断阶段plan必须同一响应返回 judgment_decision(action=plan)+agent_plan_draft；其他判断动作单工具，纯回复0工具。是否执行由后续Gate决定，不因原生tool_call合法就自动放行。

ModelResponse是适配层标准化结果。模型负责content/arguments，adapter负责provider refs/status/raw_capture/usage。`arguments_raw`保存供应商原工具JSON串（有些API本身已解析为对象，其字节来源须另存原响应），`arguments`为解析对象。两者必须一致；不要用重新encode的JSON当作供应商原始网络字节。

响应状态含 completed/tool_calls/incomplete/refused/failed/cancelled。`finish_reason`必须对应实际供应商终止；中途JSON片段不得执行；截断正文不得自动物化成完整候选。拒绝与故障分别记录，不用泛化成功答案掩盖。

`Validation`只报告schema/ref/effect/来源等检查结果，固定 execution_authorized=false、canon_written=false。`ToolResult`只陈述实际读取/校验/执行。`ApplicationOutcome`汇总独立Gate、真实事务、候选与作者可见结果。应用不能让模型自己填“通过检查”“已采纳”后予以信任。

## 8. 权限与采纳目标

安全顺序：身份与作品隔离 → 能力/效果存在 → 真实版本与覆盖 → run/profile/预算/授权 → 风险/确认或委托 → 执行 → 候选/采纳事务 → 回执/状态。

manual/risk_based/full/smart与可撤销Delegation是VS-00M目标设计，样例统一标 `target_design_fixture`。**Schema能表达，不等于仓库实现已支持**。

- manual的只读可放行；有副作用执行前确认，生成候选和采纳仍分离。
- risk_based允许适当生成tentative；已采纳高风险变更须确认。
- full不是任意写入：必须有真实作者签发的范围、effect/target、版本、有效期、撤销语义、可回滚性，最终采纳仍由已有AdoptionWorkflow事务完成。
- smart必须有确定性可复算策略；不明则保守询问/拒绝，不让模型自己评风险后写库。
- critical仅适用于**已经合法**的高风险操作。跨作品越权、虚构工具、过期对象直接拒绝，不因点击确认变合法。
- 作者“同意”只能绑定明确effect/目标/版本/影响；不得在候选尚未产生时预采纳未来任意内容。确认后重新Gate。作者要求停止/撤销授权后不能复活缓存中的旧许可。

离线校验可以检查样例里的授权字段关联和矛盾；真正的撤销原子性、并发版本、身份合法性、有效授权存储、幂等和事务回滚只能由应用/数据库测试证明。

## 9. 质量、作者可见性和文学判断

Writer的self_report只是一项使用声明。独立evaluator只读输出QualityFinding及原句证据；finding不能改写正文或直接决定采纳。[S07/S11–S13]

必须区分：无finding且评审已完成；未评审；评审失败；只覆盖部分正文；确定性检测候选与语义发现。`findings=[]`不能独自证明质量合格。证据quote必须真的出现在对应版本正文中；句序位置也要按实际分句算法核查。

作者可见模型文本与来源字段的**解析后UTF-8字符串字节**一致，绑定response_ref+JSON Pointer+hash。不是把JSON转义形式的网络字节当普通正文。系统状态另以 source=system 标注；模型正文内部ref泄漏必须拒绝/有界重试，不能展示层改字后冒称模型原文。

私有推理/完整Prompt/密钥永不进入作者可见ProviderEvent。reason/author_reasoning是用户可读的简短依据，不是隐藏思维链。

情绪递进、人物能动性、节奏与读者效果最终仍要真实模型样本和作者/盲评；本包不把结构字段齐全说成“文学质量已合格”。

## 10. 生命周期和不可知结果

Provider/Agent/候选/Canon是不同状态机：一次Provider结束可以触发工具或等待作者，不等于整个Agent目标完成；候选生成也不等于Canon写入。

只读请求可以在预算内重试；结构错误按原call_id回流纠错且不能扩大原scope。副作用调用在超时或丢回执后必须先用幂等键/事务记录对账，**不知道是否写入时 canon.changed=null、write_state=unknown**，retry_policy=reconcile_before_retry，不能宣称“没修改”。

取消请求和取消确认分离。cancel_requested后可能仍有合法晚到的网络消息，运行监督器必须按终态和代次处理，不要把后续段落重新物化或双采纳。恢复读取已提交Checkpoint、原目标/权限版本与真实挂起问题，不重建一个相似的新会话假装续行。

## 11. 实施规则与不兼容历史

本包不要求现役代码为提案新增兼容层。批准目标契约后，所有当前消费者同批迁移、删除旧拼串/解析路径/无人消费字段，版本变更明确fail-closed。**没有发布不等于允许无授权删除作者已有作品**；开发数据重置必须明确备份与范围。

所有拟新增字段/值对象/持久载体应回到既有R00存在性审计。特别是Delegation存储、Source分组、Literary payload的细字段和scope-turn checkpoint，不因本JSON定义而绕过审查。推荐映射与仍需裁决项见05文档。
