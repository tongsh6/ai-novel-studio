# 场景与完整性覆盖矩阵

> 范围说明：第 1–4 节保留源包 `f13ff640` 的候选归档设计，不代表当前运行实现；差异与归属见 [归档说明](../contracts/model-interaction/integration-notes.md)。第 5 节为现役 R03 原生验收设计，消费 VS-00L/VS-00M 与 B87 §14，不沿用归档假设。
## 1. 已交付正例（全部为合成，非线上调用）
| Case | 场景 | 请求数 | 工具/输出 | 设计成熟度 |
|---|---|---:|---|---|
| [01-statistics](../../../quality/acceptance/fixtures/model-interaction/exchanges/01-statistics.json) | 统计直答，不读取角色或正文 | 1 | content | existing_semantics_design_shape |
| [02-discussion](../../../quality/acceptance/fixtures/model-interaction/exchanges/02-discussion.json) | 讨论异常，不提前执行或声称已迁移 | 1 | content | existing_semantics_design_shape |
| [03-capability-gap](../../../quality/acceptance/fixtures/model-interaction/exchanges/03-capability-gap.json) | 明确目标但能力确实缺失 | 1 | report_capability_gap | existing_semantics_design_shape |
| [04-explore-loop](../../../quality/acceptance/fixtures/model-interaction/exchanges/04-explore-loop.json) | 读取正文→真实观察→再次判断 | 2 | judgment_decision | existing_semantics_design_shape |
| [05-full-local-revision](../../../quality/acceptance/fixtures/model-interaction/exchanges/05-full-local-revision.json) | 完整写作请求：情绪因果、只改目标段、候选待采纳 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [06-first_draft](../../../quality/acceptance/fixtures/model-interaction/exchanges/06-first_draft.json) | 初稿 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [07-continuation](../../../quality/acceptance/fixtures/model-interaction/exchanges/07-continuation.json) | 续写 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [08-rewrite](../../../quality/acceptance/fixtures/model-interaction/exchanges/08-rewrite.json) | 整章重写 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [09-character_design](../../../quality/acceptance/fixtures/model-interaction/exchanges/09-character_design.json) | 角色设计 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [10-character_evolution](../../../quality/acceptance/fixtures/model-interaction/exchanges/10-character_evolution.json) | 角色演化候选 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [11-outline](../../../quality/acceptance/fixtures/model-interaction/exchanges/11-outline.json) | 卷纲规划 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [12-world_building](../../../quality/acceptance/fixtures/model-interaction/exchanges/12-world_building.json) | 世界规则 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [13-format-only](../../../quality/acceptance/fixtures/model-interaction/exchanges/13-format-only.json) | 仅排版：输出边界换行计划，不让模型重抄全文 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [14-quality-review](../../../quality/acceptance/fixtures/model-interaction/exchanges/14-quality-review.json) | 独立评审：发现不是canon，也不是修订授权 | 1 | report_quality_findings | existing_semantics_design_shape |
| [15-quality-unavailable](../../../quality/acceptance/fixtures/model-interaction/exchanges/15-quality-unavailable.json) | 评审不可用，不能伪装零发现=通过 | 1 | content | existing_semantics_design_shape |
| [16-chapter_summary](../../../quality/acceptance/fixtures/model-interaction/exchanges/16-chapter_summary.json) | 独立维护操作：chapter_summary，不捏造run/session/作者 | 1 | content | existing_semantics_design_shape |
| [17-fact_inventory](../../../quality/acceptance/fixtures/model-interaction/exchanges/17-fact_inventory.json) | 独立维护操作：fact_inventory，不捏造run/session/作者 | 1 | content | existing_semantics_design_shape |
| [18-ledger_reconcile](../../../quality/acceptance/fixtures/model-interaction/exchanges/18-ledger_reconcile.json) | 独立维护操作：ledger_reconcile，不捏造run/session/作者 | 1 | content | existing_semantics_design_shape |
| [19-chapter_mission](../../../quality/acceptance/fixtures/model-interaction/exchanges/19-chapter_mission.json) | 独立维护操作：chapter_mission，不捏造run/session/作者 | 1 | content | existing_semantics_design_shape |
| [20-narration](../../../quality/acceptance/fixtures/model-interaction/exchanges/20-narration.json) | 真实结果叙述，不把无关统计变成质量结论 | 1 | content | existing_semantics_design_shape |
| [21-plan-pair](../../../quality/acceptance/fixtures/model-interaction/exchanges/21-plan-pair.json) | 同一响应成对计划工具；计划本身不授予执行 | 1 | agent_plan_draft, judgment_decision | existing_semantics_design_shape |
| [22-clarify](../../../quality/acceptance/fixtures/model-interaction/exchanges/22-clarify.json) | 真歧义需要作者裁决，不猜对象 | 1 | ask_author | existing_semantics_design_shape |
| [23-register-original](../../../quality/acceptance/fixtures/model-interaction/exchanges/23-register-original.json) | 原文登记不重写；实际抽取范围仍需来源校验 | 1 | register_author_content | existing_semantics_design_shape |
| [24-directions](../../../quality/acceptance/fixtures/model-interaction/exchanges/24-directions.json) | 内容方向不是保存/查看的流程菜单 | 1 | propose_creative_directions | existing_semantics_design_shape |
| [25-profile-revision](../../../quality/acceptance/fixtures/model-interaction/exchanges/25-profile-revision.json) | 作品立项字段候选，不直接写works | 1 | propose_work_profile_revision | existing_semantics_design_shape |
| [26-partial-read](../../../quality/acceptance/fixtures/model-interaction/exchanges/26-partial-read.json) | 部分观察只支持部分结论，保留续读游标 | 1 | continuation_decision | existing_semantics_design_shape |
| [27-author-asset](../../../quality/acceptance/fixtures/model-interaction/exchanges/27-author-asset.json) | 素材→创作参考；不推断长期偏好或自动canon | 1 | submit_tentative_artifact | target_design_only |
| [28-author-adoption](../../../quality/acceptance/fixtures/model-interaction/exchanges/28-author-adoption.json) | 作者明确采纳候选：真正系统事务回执 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [29-full-delegation](../../../quality/acceptance/fixtures/model-interaction/exchanges/29-full-delegation.json) | 有效full委托→重新检查→自动采纳（目标设计） | 1 | submit_tentative_artifact | target_design_only |
| [30-revoked-delegation](../../../quality/acceptance/fixtures/model-interaction/exchanges/30-revoked-delegation.json) | 委托撤销：full模式不能继续写canon | 1 | submit_tentative_artifact | target_design_only |
| [31-critical-confirmation](../../../quality/acceptance/fixtures/model-interaction/exchanges/31-critical-confirmation.json) | Critical由系统门禁确认：模型提议不能充当授权 | 1 | judgment_decision | target_design_only |
| [32-cancellation](../../../quality/acceptance/fixtures/model-interaction/exchanges/32-cancellation.json) | 取消确认后结束；仅cancel_requested不能假称cancelled | 1 | content | existing_semantics_design_shape |
| [33-budget-stop](../../../quality/acceptance/fixtures/model-interaction/exchanges/33-budget-stop.json) | 预算耗尽：明确范围，不假装读完 | 1 | content | existing_semantics_design_shape |
| [34-explicit-checkpoint](../../../quality/acceptance/fixtures/model-interaction/exchanges/34-explicit-checkpoint.json) | 合法覆盖目标设计：摘要不是canon，未完成义务仍保留 | 1 | content | target_design_only |
| [35-retry-scope](../../../quality/acceptance/fixtures/model-interaction/exchanges/35-retry-scope.json) | 有界重试的合法结果仍为原只读目标，失败原报文见negative目录 | 1 | judgment_decision | existing_semantics_design_shape |
| [36-unknown-side-effect](../../../quality/acceptance/fixtures/model-interaction/exchanges/36-unknown-side-effect.json) | 连接丢失不等于未执行；先对账再重试 | 1 | content | target_design_only |
| [37-truncated-output](../../../quality/acceptance/fixtures/model-interaction/exchanges/37-truncated-output.json) | 流式截断：不执行半个工具调用或提交半篇候选 | 1 | content | existing_semantics_design_shape |
| [38-pending-revision](../../../quality/acceptance/fixtures/model-interaction/exchanges/38-pending-revision.json) | 修订已有候选：新版本仍待采纳，不覆盖已采纳正文 | 1 | submit_tentative_artifact | existing_semantics_design_shape |
| [39-author-reject](../../../quality/acceptance/fixtures/model-interaction/exchanges/39-author-reject.json) | 拒绝与确认是作者动作，不是模型自填授权 | 1 | content | existing_semantics_design_shape |
| [40-paged-read-quality](../../../quality/acceptance/fixtures/model-interaction/exchanges/40-paged-read-quality.json) | 分页读取→精确覆盖合并→独立评审 | 3 | judgment_decision, report_quality_findings | existing_semantics_design_shape |
| [41-untrusted-reference](../../../quality/acceptance/fixtures/model-interaction/exchanges/41-untrusted-reference.json) | 低信任内容仅为材料，不进入系统指令 | 1 | content | existing_semantics_design_shape |
| [42-quality-author-revision](../../../quality/acceptance/fixtures/model-interaction/exchanges/42-quality-author-revision.json) | 独立评审→作者选择发现→局部修订候选（无自动采纳） | 2 | report_quality_findings, submit_tentative_artifact | existing_semantics_design_shape |
| [43-steer-goal-version](../../../quality/acceptance/fixtures/model-interaction/exchanges/43-steer-goal-version.json) | 作者明确改方向：保留旧讨论、新goal版本与新原话，不复活旧授权 | 2 | content | existing_semantics_design_shape |
| [44-pause-resume](../../../quality/acceptance/fixtures/model-interaction/exchanges/44-pause-resume.json) | 暂停回执后，作者恢复并发出新问题；无自动修改与伪造作者消息 | 2 | content | existing_semantics_design_shape |

## 2. 反例覆盖
每个反例对一个正例应用明确JSON Pointer修改，再断言指定错误码必须被拒绝。不会把预期失败当成校验器失败。
| ID | 场景 | 期望错误码 |
|---|---|---|
| [N01](../../../quality/acceptance/fixtures/model-interaction/negative/N01.json) | 模型请求不允许无定义的额外字段 | `SCHEMA_INVALID` |
| [N02](../../../quality/acceptance/fixtures/model-interaction/negative/N02.json) | 章位数不能冒充正文数 | `CHAPTER_COUNTS_MISMATCH` |
| [N03](../../../quality/acceptance/fixtures/model-interaction/negative/N03.json) | 观察没有真实历史调用 | `FABRICATED_OBSERVATION` |
| [N04](../../../quality/acceptance/fixtures/model-interaction/negative/N04.json) | 正文来源越过作品边界 | `CROSS_WORK_MATERIAL` |
| [N05](../../../quality/acceptance/fixtures/model-interaction/negative/N05.json) | writer虚报未提供的使用证据 | `USED_REF_NOT_VISIBLE` |
| [N06](../../../quality/acceptance/fixtures/model-interaction/negative/N06.json) | 作者原话字节被组装器改写 | `AUTHOR_BYTES_CHANGED` |
| [N07](../../../quality/acceptance/fixtures/model-interaction/negative/N07.json) | 目标段原文字节与范围不符 | `SEGMENT_BYTES_MISMATCH` |
| [N08](../../../quality/acceptance/fixtures/model-interaction/negative/N08.json) | 原始工具参数不是JSON | `RAW_ARGUMENTS_INVALID_JSON` |
| [N09](../../../quality/acceptance/fixtures/model-interaction/negative/N09.json) | 判断阶段只交计划工具而无成对plan决定 | `PLAN_PAIR_INVALID` |
| [N10](../../../quality/acceptance/fixtures/model-interaction/negative/N10.json) | explore同时附带执行capability | `ACTION_FIELD_CONFLICT` |
| [N11](../../../quality/acceptance/fixtures/model-interaction/negative/N11.json) | 模型凭空创造角色目标ref | `TARGET_NOT_READ_OR_SUPPLIED` |
| [N12](../../../quality/acceptance/fixtures/model-interaction/negative/N12.json) | 只看到selected目录却宣称能力全集缺失 | `GAP_WITHOUT_CATALOG_EVIDENCE` |
| [N13](../../../quality/acceptance/fixtures/model-interaction/negative/N13.json) | 引用字段夹带解释性文本 | `INVALID_CAPABILITY_REF` |
| [N14](../../../quality/acceptance/fixtures/model-interaction/negative/N14.json) | 登记指令替代历史原文 | `REGISTRATION_SOURCE_NOT_ELIGIBLE` |
| [N15](../../../quality/acceptance/fixtures/model-interaction/negative/N15.json) | 系统把候选状态写成accepted却无采纳回执 | `ACCEPTED_WITHOUT_COMMIT` |
| [N16](../../../quality/acceptance/fixtures/model-interaction/negative/N16.json) | gate拒绝仍然写canon | `UNAUTHORIZED_EXECUTION` |
| [N17](../../../quality/acceptance/fixtures/model-interaction/negative/N17.json) | 委托撤销后仍自动采纳 | `INVALID_DELEGATION` |
| [N18](../../../quality/acceptance/fixtures/model-interaction/negative/N18.json) | 已过期委托 | `DELEGATION_EXPIRED` |
| [N19](../../../quality/acceptance/fixtures/model-interaction/negative/N19.json) | 委托不覆盖当前目标 | `DELEGATION_SCOPE_EXCEEDED` |
| [N20](../../../quality/acceptance/fixtures/model-interaction/negative/N20.json) | critical不能通过full自动采纳 | `CRITICAL_AUTO_ADOPTION` |
| [N21](../../../quality/acceptance/fixtures/model-interaction/negative/N21.json) | UI改写模型原文却保留原来源绑定 | `NARRATIVE_BYTES_REWRITTEN` |
| [N22](../../../quality/acceptance/fixtures/model-interaction/negative/N22.json) | 模型原文绑定正确但泄漏内部ref | `INTERNAL_REF_IN_AUTHOR_TEXT` |
| [N23](../../../quality/acceptance/fixtures/model-interaction/negative/N23.json) | 质量发现引用不存在原句 | `QUALITY_EVIDENCE_NOT_IN_TEXT` |
| [N24](../../../quality/acceptance/fixtures/model-interaction/negative/N24.json) | 评审失败却伪造候选 | `INVALID_RESPONSE_MATERIALIZED` |
| [N25](../../../quality/acceptance/fixtures/model-interaction/negative/N25.json) | 只发取消请求但宣称已取消 | `CANCELLATION_NOT_ACKNOWLEDGED` |
| [N26](../../../quality/acceptance/fixtures/model-interaction/negative/N26.json) | 流式事件序号倒退 | `EVENT_SEQUENCE_INVALID` |
| [N27](../../../quality/acceptance/fixtures/model-interaction/negative/N27.json) | 状态不明却宣称没有写入 | `UNKNOWN_WRITE_FALSE_CERTAINTY` |
| [N28](../../../quality/acceptance/fixtures/model-interaction/negative/N28.json) | 未闭合工具交换进入下次模型请求 | `UNCLOSED_TOOL_CALL` |
| [N29](../../../quality/acceptance/fixtures/model-interaction/negative/N29.json) | 把纯回合覆盖冒充现役call-id压缩 | `CHECKPOINT_UNAPPROVED_COVERAGE` |
| [N30](../../../quality/acceptance/fixtures/model-interaction/negative/N30.json) | 当前作者原话被重复装入历史 | `CURRENT_AUTHOR_DUPLICATED` |
| [N31](../../../quality/acceptance/fixtures/model-interaction/negative/N31.json) | 读取预算用尽仍探索 | `TOOL_BUDGET_EXHAUSTED` |
| [N32](../../../quality/acceptance/fixtures/model-interaction/negative/N32.json) | 缓存Token不能大于输入Token | `CACHED_EXCEEDS_INPUT` |
| [N33](../../../quality/acceptance/fixtures/model-interaction/negative/N33.json) | 缓存Token不可重复计入total | `USAGE_TOTAL_INCORRECT` |
| [N34](../../../quality/acceptance/fixtures/model-interaction/negative/N34.json) | 未读全章不能冒充完整重写基线 | `COMPLETE_TARGET_NOT_READ` |
| [N35](../../../quality/acceptance/fixtures/model-interaction/negative/N35.json) | 模型捏造排版边界 | `UNKNOWN_FORMATTING_BOUNDARY` |
| [N36](../../../quality/acceptance/fixtures/model-interaction/negative/N36.json) | 作者可见流式事件包含原始prompt | `SCHEMA_INVALID` |
| [N37](../../../quality/acceptance/fixtures/model-interaction/negative/N37.json) | 情绪迁移不是任意数值曲线 | `SCHEMA_INVALID` |
| [N38](../../../quality/acceptance/fixtures/model-interaction/negative/N38.json) | 写前设计不能冒充canon | `DESIGN_MASQUERADES_AS_CANON` |
| [N39](../../../quality/acceptance/fixtures/model-interaction/negative/N39.json) | 空回复不能作为完整答案 | `EMPTY_FINAL_REPLY` |
| [N40](../../../quality/acceptance/fixtures/model-interaction/negative/N40.json) | 独立文本操作不得伪造AgentRun | `SCHEMA_INVALID` |
| [N41](../../../quality/acceptance/fixtures/model-interaction/negative/N41.json) | 模型不能自填自动采纳系统字段 | `MODEL_WRITES_SYSTEM_FIELDS` |
| [N42](../../../quality/acceptance/fixtures/model-interaction/negative/N42.json) | 质量证据范围倒置 | `QUALITY_SPAN_ORDER_INVALID` |
| [N43](../../../quality/acceptance/fixtures/model-interaction/negative/N43.json) | 无作者决定也无委托不得采纳 | `ADOPTION_WITHOUT_AUTHOR_DECISION` |
| [N44](../../../quality/acceptance/fixtures/model-interaction/negative/N44.json) | 声称改变canon却不更新版本 | `CANON_VERSION_NOT_ADVANCED` |
| [N45](../../../quality/acceptance/fixtures/model-interaction/negative/N45.json) | 终态之后不能继续进度/生成 | `EVENT_AFTER_TERMINAL` |
| [N46](../../../quality/acceptance/fixtures/model-interaction/negative/N46.json) | 伪工具XML不能当原生调用 | `FAKE_TEXT_TOOL_CALL` |
| [N47](../../../quality/acceptance/fixtures/model-interaction/negative/N47.json) | 不同版本的分页不能拼成同一完整正文 | `EVIDENCE_VERSION_MISMATCH` |
| [N48](../../../quality/acceptance/fixtures/model-interaction/negative/N48.json) | 分页区间有缺口却宣称全章已读 | `COMPLETE_TARGET_NOT_READ` |
| [N49](../../../quality/acceptance/fixtures/model-interaction/negative/N49.json) | 素材参考不能变为canon | `ASSET_BECOMES_CANON` |
| [N50](../../../quality/acceptance/fixtures/model-interaction/negative/N50.json) | 跨作品作者资产没有本作品关联不可消费 | `ASSET_LINK_INVALID` |
| [N51](../../../quality/acceptance/fixtures/model-interaction/negative/N51.json) | checkpoint覆盖不存在的历史原消息 | `CHECKPOINT_SOURCE_NOT_FOUND` |
| [N52](../../../quality/acceptance/fixtures/model-interaction/negative/N52.json) | checkpoint覆盖的原始字节被改写 | `CHECKPOINT_SOURCE_BYTES_CHANGED` |
| [N53](../../../quality/acceptance/fixtures/model-interaction/negative/N53.json) | 作者同意了其它目标不能通用放行 | `AUTHOR_DECISION_BINDING_MISMATCH` |
| [N54](../../../quality/acceptance/fixtures/model-interaction/negative/N54.json) | 委托没有对应的真实签发来源 | `DELEGATION_SOURCE_MISSING` |
| [N55](../../../quality/acceptance/fixtures/model-interaction/negative/N55.json) | 采纳后正文hash与目标段确定性替换不符 | `APPLIED_REVISION_HASH_MISMATCH` |
| [N56](../../../quality/acceptance/fixtures/model-interaction/negative/N56.json) | 按质量发现修订必须选真实finding而非规则类型 | `FINDING_SELECTION_INVALID` |

## 3. 十项完整性检查（设计完成与生产验证不同）
| 维度 | 本包证据 | 生产/实模仍需 |
|---|---|---|
| 产品场景 | 14专业任务+判断/规划/登记/作者控制等场景 | 实际工作台到持久化完整消费者 |
| 小说语义 | E01–E37名称/四层/三态；scene、情绪、信息、风格字段 | 对真实小说的表达适用性和质量盲评 |
| 生命周期 | 原生工具读循环、分页、采纳、撤销、取消、异常和状态文档 | 实际恢复/并发/故障注入 |
| 字段语义 | Schema、逐字段字典、owner/source/maturity | 与生产Serializer/Parser精确映射 |
| 权威/来源 | hash、版本、Base/Observation分离、used refs | 真实数据库事实、读取真实来源 |
| 权限/效果 | 委托、critical、author_action/receipt检查 | 真授权存储、写事务re-gate、撤销竞争 |
| 失败/恢复 | failed/incomplete/cancel/unknown及反例 | 真实网络/进程/DB副作用对账 |
| Provider | 3种wire参考body与原生响应片段 | 三类实际API/模型能力验证 |
| 工程复用 | 现役实体映射和新增提案边界 | R00全仓审计及删旧迁移 |
| 验证交付 | Schema+正例+反例+投影报告 | I1/I2/I3/N-NARR/I-CACHE+Tauri+文学盲评 |

## 4. 不声称覆盖的东西
所有37要素的payload都有Schema定义，但这不证明37要素所有层级/三态的每一种组合都已有生产表或测试。Unicode段落字节例子有中文，没有全面语言学分词/排版验证。智能模式和作者资产是目标提案，实测token和文学得分均未编造。

## 5. 现役 R03 原生交错、取消与恢复验收

本节消费现役 [VS-00L §16.2.1/§16.16](../contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)、[VS-00M](../contracts/VS-00M-model-interaction-request-response-contract-pack.md) 与 [B87 §14](../../../tasks/slices/B87-model-interaction-request-projection.md)；第 1–4 节的候选归档状态不适用于本节。这里只规定输入、判据与取证边界，不登记执行进度。

### 5.1 存在性与消费者审核

既有 `native_b71_batch.sh` 和 `tauri_slice_verify.sh` 已拥有隔离批次启动、真实端口和 owned Tauri 清理；`NativeScenarioHarness` 已拥有可见 AX 动作及客户端重启；`authoring_capture_evidence` 已拥有输入封存与真实 DB 快照；`authoring_auto_maintenance_evidence` 已拥有压力、覆盖、交错及恢复判据。R03 继续这些入口，不新增 bootstrap、第二 driver 框架、产品 hook 或 DB reader。

既有 `request_cost_runtime_recipe` 是 Splash 参数的唯一 owner。auto-maintenance 路径消费其 `b87-r03-splash-product-maintenance-budget` profile 和同一后端进程产生的 `runtime-facts.json`：模型能力 262144，产品维护预算 32000、触发比例 0.70、最近项 4。模型实际 usage 必须达到真实阈值；不得伪造 usage、缩小模型能力或临时改窗口。既有外部 Splash 服务不属于批次资源，驱动和清理均不发 load/unload/stop 请求，也不接管该服务。批次只清理其创建的应用与进程/端口；`native-driver-ready.json.owned_ports` 从 runner 实际启动的 backend/proxy 端口产生，未启动 proxy 为明确 null，不用全局固定端口推断。

现役 20 条冻结讨论原文继续复用 `scripts/lib/native_ui/fixtures/r03-discussion-author-inputs.json`，原文件不改。新增 `r03-interleaved-author-inputs.json` 只存该链实际需要的 A/B/回答/后继核对/取消 5 条作者原文、哈希和观察目标，复用同一 `b87-author-inputs/v1` 结构及纯校验 owner 的显式条数参数，不增加模型或协议。capture 在窗口操作前封存两份输入并验证逐字哈希；driver 只消费封存副本，失败后不得换材料、加轮次或改维护阈值。

**后端换代的存在性审计**：`tauri_slice_verify.sh` 已独占 BEAM 启动/进程树回收，`native_ui_wait.mjs` 已独占分型等待、owned PID 与健康监督，但均没有后端重启入口。只在这两个 owner 增加一次受控换代：ready 增 `backend_owner`（真实 runner/backend PID 与本批 DB realpath）；请求/准入/监督确认/完成四份 `native-backend-restart/v1` 事实复用现有批次文件边界，逐份绑定 run_ref、request_id、活动 restore wait_id 与旧 PID。driver 只能请求，不能 spawn/kill BEAM；runner 在监督已确认的唯一恢复窗口内复用同一启动函数、同 env/同隔离 DB，既不重跑外层 seed，也不覆盖首次 runtime facts。只有新真实 PID、实际 health 200、同 DB 文件身份和新进程白名单 runtime facts 一致时才产生完成事实；其它进程继续监督，普通 restore 不获得后端健康豁免。`native_ui_wait.readBackendRestartReceipt(dir)` 统一核四份记录、原等待账、实际 runtime 文件哈希和 DB 身份，driver 与事后 oracle 共同消费；事后核验不要求 cleanup 后 PID 仍活，也不声称当前健康。测试放现役 `native_ui_wait.test.mjs`；协议只属外部验收，不新增产品状态或恢复框架。

### 5.2 冻结动作顺序与独立预期

1. 按既有原文第 1–10 条完成早期讨论。每条都必须经过真实页面和真实 completed 回执；意外追问或失败记录未闭环，不自动猜答或补发。
2. 发送新 A，请作者在两个结尾之间选择。只有真实 open 问题、同源 waiting run 与可见回答区出现后，点击“开始新讨论”，发送新 B。B 明确 completed 后，A 仍须保持原 question_ref 与未答状态；B 可以整理更早已完成历史，不能覆盖 active A 的作者原话、问题或讨论。
3. 回到 A 原问题，以冻结回答明确选择“保留父亲留下的秘密”。作答必须绑定真实 question/run/goal version 与唯一 ACK；随后冻结核对请求证明整理进入下一次实际业务判断，维护摘要请求不充当后继业务请求。
4. 先且仅执行既有冻结第 11 条讨论，不注入故障。其真实 completed 后封存同会话 canonical、所有 Provider 来源归属及真实压力，再发送固定 C；不预测模型只生成一个纯讨论项，不指定来源必须为 B。C 的第一份持久 `transcript_compaction` 准入是唯一取消目标：依据实际准入事实顺序确定，不以最晚行、合法性、是否仍在途或模型结果筛选。身份多义或第一份不合法立即失败，不能跳过它选择下一份。冻结该份 pcall/prun、全部来源坐标及原计划，核精确作用域、来源已完成、原文/作者归属、未覆盖、此前未取得执行资格和真实混合项保护集；最近四项统计完整工具交换与纯讨论，当前作者回合整体保护。沿既有 turn 有界等待同一目标的 request_dispatched 与非空正文 chunk，且无 terminal event/output，才可在真实控制坞点击“终止任务”。确认前重读同一执行仍在途，来源/计划不变；目标已结束或改变即失败，不换对象、不补输入。完整 HTTP 请求日志在执行返回后才产生，不能用等待该日志替代在途识别；取消后必须以实际请求核原字节及冻结来源。采集唯一命令/ACK、真实终态、Provider 归属、计数和 canonical；只有原摘要与 run 均 cancelled、迟到结果未提交 checkpoint 才满足取消。固定 C 窗口没有摘要、窗口短到未捕获、前置未知或材料缺失均保留失败/缺证，不修改输入、压力、等待预算或保护集。
5. 由现役 ownership 边界重启 Tauri 客户端并重新连接同一会话，核对原文、事件和来源资格保持；本动作明确只证明客户端重新连接，不冒充后端进程重启或 durable AgentRun 恢复。
6. 在隔离批次数据库注入 checkpoint 提交失败 trigger，以既有原文第 12 条运行故障 D（不复用已完成的第 11 条），D 同样以本窗口第一份持久准入冻结完整来源集合，不指定必须为 A，不得与此前任何执行资格（包括 C）重复；顺序/作用域/混合项保护集核验与 C 共用同一外部责任。没有首份合法接收、首份无效但后份成功，均不能选取后份代替。确认同一 Provider 执行的合法响应与冻结计划已持久接收但 canonical/事件提交回滚，再移除 trigger。由原 runner 执行一次真实 BEAM 后端换代并等待同会话重连，在发送新输入前证明原文、私有待提交响应、事件与来源执行资格保持，没有新增 Provider 调用。该阶段是故障提交后的静止会话恢复，不冒充 active Task 续跑。继续固定按原第 13–20 条及冻结核对请求执行；必须观察后续安全点将 D 的原计划/原响应原子提交，discussion 仍绑定 D 的 pcall/prun，私有载荷清除且不产生第二次 D 摘要请求。当前接收回合正常业务调用单独计量，不能当成摘要重试。若 D 从未持久收到合法响应，记录缺证，不用新来源 E 的成功替代原结果恢复；未知结果、取消/暂停或原方向改变后不得重发/复活。原文、计划、原响应字节与双运行身份由既有 reader 独立对账。

输入、动作和等待的先后顺序在运行前固定；脚本只根据真实已完成/等待/取消状态决定能否安全进入下一既定步骤，不从 projector、摘要或 DB 最新行选有利目标。独立预期来自冻结作者输入、动作前 canonical/Interaction 原文、真实 Provider 请求与输出、唯一命令/问题回执和事务结果。没有压力、没有可整理来源、没有合法首份摘要或没有摘要取消时保留缺证，不能写 PASS。

**取消与故障的候选前置**：2026-11-18 `c8-native-16` 已证旧次序在 C 交付后只余四条受保护讨论，另两项 ask_author 交换不可整理；44,689 输入 tokens 与 1/33 调用预算并不产生可摘要来源。该批失败永久保留，不归因于短时漏检。新次序仅增加原第 11 条的固定位置调整：C 交付使 B 自然落到最近四项外；取消 C 后 B 的执行资格永久保留，D（第 12 条）交付使 A 的恢复回复自然变旧且未被占用。进入 C/D 前分别记录实际候选坐标及保护集，C 在途来源必须匹配 B，D 持久原响应来源必须匹配 A；来源不存在、被覆盖/占用、运行未完成、作用域不符、压力未到或请求输出使保护集假设不成立时，本批前置失败，不追加输入、不重放、不降低 keep4/预算/阈值，不换候选。固定二十条及五条控制原文和哈希均不变；所有额外模型调用仍如实计量。

**2026-11-18 首份准入机制修订（替代上述候选预测，不改旧失败记录）**：`c8-fixed-20/native-01` 中第11条先回查风险表形成闭合工具交换，再交付纯讨论；keep4合法保留 A恢复/核对/11工具交换/11回复，B 已于第11条被摘要，故 C 前纯讨论只剩三条，旧固定 B/A 前置失败。责任偏差在验收将输出形状当确定事实，不在产品 keep4。以上旧次序及失败事实保留，当前步骤4/6改用固定输入窗口的第一份持久准入；不是动态预热或择优取样。准入前快照/准入事实/动作前复核/终态请求形成同一证据链，保护集必须回到首份 ProviderRun.inserted_at 时点：以 canonical 行不可变 inserted_at 严格早于准入的序列重建，保持真实微秒顺序；缺时间、与准入同刻或序号/时间矛盾均失败关闭。首次轮询或 D 终态才看到准入时，不得用后来新增工具/回复/覆盖使旧来源事后变为合格；全部来源一次冻结且此前无其它 claim；合法工具变化不改变计数契约，不能用纯讨论数近似保护集。独立反例覆盖混合项、第一份非法而后份合法、顺序多义、错scope、重复claim、来源或计划改变、窗口已终态和D无合法原响应。固定窗口仍可能没有可取消摘要，必须如实失败，绝不承诺必过。

**在途事件的持久观察边界（2026-11-18）**：ProviderEvent.emitted_at 在现役契约中允许 nil，不能把该可选发送时间当作 dispatch/chunk 存在的必要条件。既有 `authoring_interleaved_resume_evidence.inFlightSummaryForRun` 同时服务 driver 与取消事后核验，统一以同一执行的事件 sequence 与不可变 inserted_at 验证 request_dispatched 之后确有非空正文 chunk 已入库；不是 emitted_at 的任意 fallback。时间缺失、无效、倒序或 sequence 多义不取得资格，started、prepared、空 chunk、已终态或已有输出均不能替代真实在途。目标身份和确认前二次核验维持不变，不新增产品事件或验收 hook。独立 literal 反例核正常 nil emitted_at、持久时间缺损/微秒倒序、错执行、无正文及终态；全相关 node 与静态检查只证明 observer，不代签真实页面取消。`c8-first-admission-22/native-01` 首份 123 个非空 chunk 的 emitted_at 均为 null，旧 observer 永不命中；该批原 FAIL 永久保留。实际首 chunk 至输出仅约 676ms，字段修复不保证轮询及两步 AX 操作来得及；固定窗口捕获失败仍失败，不延长、换目标或追加调用。此 checkpoint 不涉及作品知识获取，探索项不适用。

**C8 外部 Provider 传输窗口（两阶段、一次性）**：现役 Phoenix HTTP/WS proxy 不承担模型链路；新增 `scripts/native_provider_stream_proxy.mjs` 只负责 runner-owned loopback HTTP/SSE 透明转发与独立控制端口，由 `tauri_slice_verify.sh` 启动、监督、清理，通过已有 NOVEL_SPLASH_ENDPOINT 仅对隔离进程临时路由，不持久改作者设置、不接管 Splash。两个端口均 ephemeral，ready 文件为 `provider-stream-ready.json`，含 pid/endpoint/control_endpoint/upstream_endpoint，正文及认证不进入控制日志。请求原字节另存本批 artifacts，JSON 仅作为证据副本解析，转发不重序列化；请求数、hash、响应原字节前缀/剩余片段与关闭原因可独立核对。

C 发送前开启只读 registry 窗口，所有业务请求正常透传。driver 通过现役首份准入与完整材料 oracle，将唯一真实外部 request_id/hash 绑定冻结的 pcall/prun/全部来源；HTTP 本身没有该内部身份，不伪称已由 header 证明。相同 hash 多请求、重复匹配、非同窗口、首份非法或无法唯一绑定均失败，不挑后份。只有精确绑定后才针对该 request_id 原子 arm，若首非空正文已经到达或请求已结束则拒绝，不能追认。首个完整 Chat SSE record 含真实非空 delta.content 后，代理先将至该 record 终止分隔符的原字节前缀交付下游，再暂停剩余字节；reasoning/role/空块不能触发。单个 HTTP data 含 content 与 DONE 时必须按原字节 record offset 切分；UTF-8/CRLF/跨包/multiline data 在解析副本处理，输出字节不改。driver 必须另见同一 prun 持久非空 chunk，再作真实 AX 双步取消，仍执行确认前在途及来源复核。

暂停从前缀写出起最多 30 秒（小于原 300 秒静默超时），只允许一次，不能续期。下游提前断开因果触发对应上游 destroy，记录两端 close/abort/自然 end；不得自动重试。上限、异常或 cleanup 终结连接只记录失败，绝不代签作者取消。incoming.pause 可能延后 end 观察，因此无论是否观察到上游自然结束，都仅证明产品接收传输取消和实际观察到的 abort/close，不声称 vendor 仍在生成或计算已停止；无上游 close 证据不声明已传播。同一 SSE record 若同时含正文与 finish_reason 等终止事实，不剥离字段制造窗口，按窗口已失失败。C 完成后必须取得 consumed + 无活动暂停/未完成连接的 disarm 事实，D 及后继仅透明转发，维持原响应/plan/hash、提交回滚与跨进程恢复判据。所有固定原文、预算、keep4 不变，迟 arm/短窗口仍可失败，旧失败批次不改签。

**上游已闭合与下游取消的分支证据（2026-11-18）**：`c8-visible-window-26` 已观察到首正文交付后、作者取消前上游 close，但产品直到代理暂停上限才终止；旧 FAIL 保留。上游 close 本身不证明自然完成，更不证明用户取消。外部代理只记录 Node HTTP 接收事实：close 时原响应 `IncomingMessage.complete === true`、此前无上游错误且未由代理 destroy，才可标记“完整 HTTP 响应已接收并关闭”；这不要求暂停中的 `end` 回调已执行，也不推断供应商计算状态。下游仍必须在真实 AX 命令之后、暂停上限之前自行断开，原产品 ACK/Provider cancelled/无迟到提交判据不变。若该完整上游闭合事实已先于下游断开，则保留其原先时序与中性原因，不虚构再次 abort；报告仅签下游接收取消、上游此前完整闭合。若上游尚未闭合，则必须观察下游断开后对应 destroy 请求及其后的 close，才能签传输 abort 传播。未知完整性、异常 close、仅 close 而无真实下游断开、pause_timeout、cleanup 均不得通过；两分支均须唯一同 request/prun、原字节首正文边界和最终 drained/disarm。独立 literal/真实本地 HTTP 反例分别覆盖先完整闭合、仍在途需要 destroy、先异常关闭、缺下游断开及超时/清理，不能调用代理生成器反推预期。

本 checkpoint 七问：Contract 为本节 C8 真实在途与原载荷恢复；Invariant 是不造正文、不换首份、不将代理关连接代签用户取消；Boundary 仅外部 runner/HTTP代理/driver/证据，产品与模型服务不改；Consumer 为现役 C8 driver 与取消事后 oracle；Proof 为本地真实 HTTP server 的原字节守恒、任意分包、早/迟 arm、同 hash 多义、空块、终态、abort 因果、超时/cleanup 失败、一次性与 D 无干预独立反例，再全 node/静态检查及独立 review；Acceptance Driver 仍为真实 Tauri C8，未新跑前不宣称闭环；Exploration 不适用，因为不新增作品知识或模型输入。存在性审核：现有 proxy 只管 Phoenix，不混入不相干 SSE 责任；新脚本及同名测试登记 scripts 索引，不另建控制框架、DB reader 或产品 hook。

**C8 证据链要求**：故障后快照必须含原 ProviderRun 的私有计划及响应文本，其字节 hash 与同次 ProviderOutput 一致；重启前后快照和既有受控换代 receipt 必须连成同一故障窗口。恢复后的 canonical 必须恰好一次引用原 pcall/prun、原响应字节及原计划覆盖，匹配同提交方作者事件，且私有载荷已清除。只保留 hash、仅有新来源成功、正文改写、原计划改选、在重启前已清除、第二次同源模型调用、事件与正文归属不同，均不能通过。该状态证据不能单独证明事务原子性，仍须与既有事务故障反例及真实故障场景共同判断。

**历史面板可见证据**：展开后以及截图前须重新观察同一来源面板的实际边界；面板与完整记录按钮须在本窗口和滚动视口内，不以 AX 中有节点或仅一部分相交作为完整可见。必要滚动是显式 UI 动作，不改变只读等待规则；滚动不能使实际面板可见时如实失败。截图仍需独立视觉复核，报告不得自动代签颜色或完整 R03。

### 5.3 旧验收假设的退役

旧 G6“B 必须折叠仍在等待的 A 的闭合交换”与 active foreign run 保护目标冲突，退役该判据；更早已完成历史与 A 的待答义务必须分别核验。旧 C8“下一回合重新摘要失败 D”不符合一次执行资格，退役该要求；“不重发 D、新来源 E 成功”也只能证明继续创作，不能代签原结果恢复。现役 C8 必须核对原 D 响应的持久保留、进程换代、同字节原子提交与零额外摘要调用。auto-maintenance 的 Strata4096 和卸载外部模型服务假设退役；其它独立 live 场景不为本节 provider 状态代签。

机械检查、真实原生动作、真实模型语义及后端 durable 恢复各自保留证据边界。任何局部绿灯都不能代替完整 R03。

**故障恢复完成边界**：上述判据是目标而非已完成声明。纯规则、事务故障注入及 bounded 安全点集成测试只证明机制；外部驱动仍须从真实 Tauri 入口完成 §5.2 第 6 步，不能用局部绿灯或另一个来源成功代签。已接收原文转交、执行未知结果呈现、窗口恢复与完整模型续行证据未闭合时，R03 不得 PASS。执行状态只见 B87 总计划。

### 5.4 原生产物与完成门禁契约

`scenario_evidence.assertCommonEvidence` 是现役原生身份、同批 run、截图和等待账的唯一共同核验者；`writeNativeSummary` 是现役原生摘要出口。R03 的成本批次与交错维护批次必须复用这两个 owner，原生 driver/slice 身份只能来自已经核验的 ready/UI 事实。本批明确声明 `surface=tauri-native`，完成门禁必须再核旁侧 `native-ui-complete.json` 的 driver/scope；`--out` 派生结果不复制或冒充原始证据目录。共同核验失败时仍保留成本报告的失败或缺证事实，但不得生成可被完成门禁接受的原生摘要；不补写成功文件，不放宽 `task_done_check`。

成本批次的共同证据下界由实际固定动作推出：N 条冻结输入需要至少 `3 + 3*N` 个等待记录，种类为 maintenance/input/turn，至少 `N + 1` 张实际截图；N 始终是预注册长度，不能按已完成输入缩小。交错维护沿用自身真实共同证据约束。场景既有 status/required 判据是机制完整性的唯一裁决者；通用摘要只投影 pass/partial/fail 到完成门禁所需的 `all_checks_passed`，保留原始检查计数、非必需的 null/观察事实及全部 not_signed，不把缺证或失败写成完整通过，也不让可选观察代替必需判据。

**可见终态与整理记录分责（2026-11-18）**：46§9.9 的整理细条不是运行态；同轮最终回复、Why 入口及顶栏空闲已经成立时，仅保留整理细条的过程容器不能阻止可见交付判定。现役 `axTurnOutcome` 必须按可见结构区分只有整理按钮/展开面板的记录容器与真实状态组；展开记录内的来源文字不是状态，记录自身也不能冒充回复。真实运行/等待/失败状态优先；缺作者边界、正文、Why、窗口或空闲，存在活动控制坞、未知过程内容、后续作者消息时均不得从整理记录推断完成。该判据来自作者界面契约，不读取内部 run 或 DB 替代页面，也不改变原等待预算。

成本出口复用现役不可覆盖的派生文件写入函数，重复 verify 与 `--out` 不改首份证据；通用摘要函数只增加这一个真实消费者所需的写入依赖，不新增第二报告、第二身份校验器或验收框架。最终 `task_done.sh` 必须消费本批真实 summary 的明确路径并执行完整静态扫描，真实模型语义与截图视觉仍须回原始证据审阅。

同一规则适用于本次复用的 B71 live 页面出口 verifyAuthorVisibleBatch：共同事实仍经 assertCommonEvidence，实际 visible.ok 经 writeNativeSummary 投影 status/all_checks_passed，并保留其页面范围及 not_signed。该摘要不代签 G2 的机制或模型取证；还必须独立运行现役 audit-g2 并回读真实请求/输出。

### 5.5 最小判断供给的真实探索正例

本节消费 VS-00M §5.2.2 与 B87 §14.6 的责任修订。移除默认作品 DTO 后，除原冻结 3/10/20 与交错输入不变，还必须证明真实模型的按需读取仍完整可用；低 token 或无工具调用本身不能作为正例。此处是 R03 材料责任修复的回归证据，不提前签收 B82 的后继开放任务。

复用既有 B82 G2 writer-refs 作者原文、seed 和 B71 live 驱动：作者要求先读第 02 章《灰烬中的手印》已保存正文、前后核对，再将重复写法改成候选且不保存。保持原文和 7000 字来源不变；新批次在执行前冻结真实 Splash 参数、一次发送、零自动重试及独立输出目录。必须回读首次真实请求无全章材料预装、真实两页调用与完整范围、下一次 judgment 及 writer 的实际 Observation、模型真实 self-report.used_context_refs 和候选状态；每步绑定本次 pcall/prun。旧 G2 PASS 只提供可复用场景，不能代签改后的请求。

人物精确操作复用既有 `scripts/seed_b29_character_role_revision.exs`、`native_b29_evidence.INPUTS.t1` 原文“指定老沈为主角”、`native_b29_drive` 与现役启动入口 `tauri_slice_verify.sh b29-existing-character-role-revision`。外部 `B29_NATIVE_MODE=r03-candidate` 在既有 prepare/config.scope 中冻结该场景与真实 Splash model/runtime；作品仍为“B29 已有角色叙事身份复现作品”，保留老沈 ENSEMBLE_POV、顾青 PROTAGONIST、同名小沈 MINOR、阿鸢 SUPPORTING 的真实 accepted 来源，不改 seed 凑行为。实际页面依次选择作品、发送唯一原文、等到角色修订候选和旧值→新值卡片后截图，再采集 t1-after/final；明确结束在采纳前，不点击采纳、不进入旧 T2，不声称完成旧 B29 全矩阵。真实模型须先通过正常目录发现对象，再主动读到所需身份/消歧字段、narrative_role、accepted 状态和真实 base_fingerprint；详情观察进入下一次真实判断，模型实际 ref、候选 ref/基线指纹及本作品来源一致。目录不能冒充已读正文，猜中隐藏合法 ref 不得取得执行资格，期间来源变化必须拒绝或重新真实取证。长 summary 的未读页如实标明，不以无关全文读取作为此单字段候选的前提。作者未采纳时权威角色及正文前后保持；现役 history/call/refs 读取 owner 对实际 pcall/prun、读取工具与后续请求交叉核验，不用候选构造的内部读基线冒充模型已探查，单测不能代签模型行为。

B71 live 的 provider 参数、预检和清理由现有 batch/tauri runner 负责，消费已有 request_cost_runtime_recipe 的真实 Splash 配置及运行时事实，不能仅把 Strata 标签改名，不对外部 Splash 发 load/unload/stop。已有同请求 IR.refs.base_refs 与实际 Observation 来源是唯一 Base/探索证据；若日志尚未保留本字段，应在现役日志投影 owner 补真实值，缺证不得从 Scope.source_refs、累计会话 refs 或模型自报反推。真实模型和原生工作统一串行，由本批原 owner 管理，任何失败均保留首份证据。

B29 与 G2 的参数冻结共同复用 validatePreregistrationFile、assertManifestRuntime 和唯一 splashRuntime 读口；每个实际 caller 显式固定自身 scenarioId（G2 为 b82-g2，B29 为 b29-r03-candidate），不能由外来文件放宽。B29 的 B29_NATIVE_PREREGISTRATION 经原 runner 校验后复制至既有 preregistration.json，与 B29_NATIVE_MODE=r03-candidate 一起形成事实边界。新增的 authoring_character_candidate_evidence 是纯目标判据 owner：旧 B29 的 candidateFacts/stateChecks/zeroWriteBetween/候选字段规则整体迁入，新旧入口共用，IO 仍在原 owner；新 native_b29_evidence.test.mjs 核既定正反例，无新 reader/框架。人物 source 指纹由同一已有 SQL 读口补齐 updated_at 原字段后，以真实 before 行的八字段规范独立核对，不以候选或观察指纹生成预期；正文/权威角色的 before/after 完整事实同样独立核对。

G2 已有真实观察→下一次请求的核验从其私有 pageCheck 整体迁入既有 authoring_call_evidence.observationNextRequestEvidence，保留原 call/output/canonical/request 身份、顺序、完整 Observation 与 refs 判据；G2 和 B29 同用此唯一纯规则。原私有实现与 helper 退役，不新增 reader/解析器或第二份匹配。沿原 G2 反例及 B29 独立来源反例验证，不从候选结果构造读取预期。

现役 B71 处置后原文“资料处理进度怎么样？”要求回应实际候选身份、处置状态与前后继关系。followup Scope 只供应唯一 artifact_ref/status/title/revision_of、计数及覆盖；不得为满足旧 oracle 重新预装候选正文。独立预期从原 source/revision Artifact 与真实采纳回执取得，缺身份/标题/前后继、重复记录、错状态或省略覆盖均失败；候选正文仍由 writerArtifactMatch 和采纳前后 canon 对账逐字核验。回复须绑定同次 Provider 字节并识别已采纳候选和两种处置状态，仅出现正文片段不能替代候选身份。原 body_preview Scope 断言及正文替代身份规则同批退役，原作者输入和实际操作链不变。

### 5.6 维护请求的独立来源与成本边界

维护请求不是新作者输入。成本核验不能要求伪造当前作者消息，也不能仅凭 operation 标签、应用前缀或报告自称通过。复用 `authoring_checkpoint_coverage` 的 canonical 来源校验与 `authoring_history_evidence` 同一只读快照；`request_cost_batch_evidence` 是调用关联消费者，`request_cost_evidence` 仅计量已经绑定的请求材料。

独立目标：真实 ProviderRun/日志 pcall、prun、workspace/work/session/parent 必须一一对应；现役 source keys 必须可规范解码、范围一致、没有重复，并唯一定位当前作者回合之前、其它已完成 run 的纯讨论原文。每条作者原话从该来源之前同 run 的真实 author 消息读取；材料必须与这些原始字节及顺序完全一致。额外作者、工具、额外应用消息、缺来源、跨作品/会话、未知/未来坐标、字段或原文篡改均不能取得可信成本证据。来源判据不读取摘要文本反推预期。

独立反例覆盖错 pcall/prun、伪 operation、同坐标改字节、作者文本改写、来源重排/重复、非讨论块、活动或当前 run、缺当前作者边界和非规范 source key。成功执行但未产生 Checkpoint 的调用也必须计成本；来源可信不代表摘要有效、已提交、可恢复或完整保留义务。分类必须为 application_base、当前作者数和当前作者字节均为零；原成本字节守恒、模型/usage及真实终态核验不变。旧失败批次只读复算另存派生证据，不覆盖原 FAIL，不重新调用模型。

**v2精确片段的独立oracle（2026-11-18）**：新材料source为source_index/source/author_text/fragments，fragments逐项含fragment_index/text，不重复整源text。外部authoring_checkpoint_coverage从真实canonical原文独立验证CRLF/CR/LF/末行及编号、顺序、完整覆盖，不能调用产品split/投影函数生成自己的预期。v2响应retained_fragment_indices只能选择本源合法有序唯一编号，非相邻片段保持分离，字节预期来自预注册literal/真实源而非摘要。v1原材料/输出只用于真实旧历史读取；请求与响应协议错配、改字节、额外text、坏编号、缺项仍失败关闭。新capsule冻结版本与coverage检查按VS-00L §16.2.1；复算不重写任何原始响应或原批结论。

### 5.7 非成功流式调用的独立计量证据

消费 VS-00M §6.4 的流式事实/缺用量边界与 VS-00L §16.2.1 的真实调用计费。请求可被计量、执行终态已知、成功响应已完整三者不是同一结论。现役 authoring_call_evidence 负责真实调用关联，request_cost_batch_evidence 消费关联结果，不能以一轮后来成功漏掉同轮早先失败调用，也不能为补数量把未知响应当成成功。

非成功 native 流日志可能只保存 status=0、body=event_stream 和耗时；这些占位单独不构成失败证据。只有准确 pcall/prun、workspace/work/session/parent/AgentRun 归属一致，既有只读数据库快照明确给出 ProviderRun failed/cancelled 与同次 ProviderOutput error，且没有与该调用冲突的成功 canonical assistant，才可将其请求归入非成功调用账。来源冲突、缺输出、重复引用、scope不一致、completed+占位均失败关闭。扩充现役只读reader读取已有 ProviderOutput 事实，不增加产品 hook、验收入口或第二调用权威表。

失败调用的请求材料仍参与字节成本对账，实际调用数独立计数；缺usage保持未知，不填零、不套用后续成功用量、不声称原始SSE终结已验证。独立反例必须覆盖失败后成功同轮双调用、伪失败/错归属/缺持久output/重复refs/成功与失败冲突。重算只能落独立派生目录，原十轮失败、零合法checkpoint与未完成原生语义判据保持不变。

### 5.8 普通成本批次的有限主体窗口与固定后继观察

仅新 `b87-r01-request-cost-manifest/v2` 的普通 native 预注册讨论批次启用：主体仍为冻结原文的3/10/20条，3条低压对照不追加；10/20条各预注册恰一次后继观察。原v1 manifest及旧批次保持原行为/partial，不补发或改签。现有交错控制中的“复述最后选择”不适用于普通未选择会话；单条通用后继输入另存冻结来源，询问已实际交付、未交付/证据不足、尚待作者选择，不暗示已选择，不读取或改写作品。原20条及交错5条字节不变。

v2 `successor_observation` 严格冻结 `source:{path,sha256,expected_turns:1}`、`author:{id,sha256}`、`lengths:[10,20]`、`count:1`；复用原作者输入schema、hash校验、原turn等待预算、零harness重试与真实页面输入机制。capture在启动前封存原文和配置，driver不能按结果选题、追加次数或改变预算。

**目标集合与竞态**：主体作者/run归属来自冻结输入与实际唯一回执/canonical身份，不信driver自报名单。N条可见completed只是必要条件；发送后继前须以同一只读事实快照确认全部主体run completed、归属主体的已准入维护均terminal、成功响应已提交canonical并清除pending载荷（失败/未知响应不得冒充合法提交）。存在在途执行、已接收未提交载荷或未知归属就partial停止，不发送后继。主体目标包括所有归属这些主体run的checkpoint；最终再次由完整canonical/events/ProviderRun/Output核对，不允许主体迟到checkpoint改算为后继维护。未证明集合闭合不能签过。

**下一请求**：每个主体checkpoint使用严格在其commit之后的首个真实非摘要业务Provider请求；沿现役C5覆盖/原文/无重放oracle，不复制来源权威。首请求缺证或覆盖错误不能借纠错或较后请求洗绿。后继必须唯一真实作者输入和独立run、正常completed；摘要调用、仅构造请求、回查UI均不能代签。目标集合通过显式主体边界限定，但全部事实保留；后继产生的新维护单独列为“窗口外、尚无后继消费证据”，不删事件、不递归追加，不声称全批每条checkpoint都已验证。

**计量与报告**：主体N轮和后继观察分别绑定实际全部业务/维护调用、usage和未知项，并给总计；cached始终为input子集，后继不冒充第N+1主体。原文数量分别严格对账。完整共同证据下界按实际预注册动作推导；后继失败、意外追问或身份不明保留partial/失败，不自动猜答。主体语义预期来自原作者要求与原始实际交付，由独立审查判断，后继回复、摘要自述与单测都不是质量oracle。

独立反例：漏主体末checkpoint、封边界时维护在途/未提交、主体迟到提交、错边界归属、后继改字节/重复/错会话/缺页面、首请求错而后请求对、摘要冒充后继、后继新维护漏计/被删、未知usage填零、旧manifest自动发输入。正例须覆盖合法主体尾维护由固定后继消费及后继新维护如实未证；不更改产品生命周期、原预算、原失败记录或交错/C8代码。

### 5.9 实际交付保留与历史否定性结论

消费 VS-00L §16.2.1 的实际提供范围/责任解除分责。作者可观察目标是：整理后继续讨论时，已经真实提供的比较不会因节选遗漏重新欠账，真正未交付与未确认部分也不被运行结束或模型自称完成消掉。26 原始 canonical44 与实际 request49/56、canonical74/79 证明存在“原文已有、节选省略、后继误称缺项”的反例；旧20/10partial及26 FAIL保留，设计修订不能倒签。

**独立反例与预期**：
- 原文在两个对象上实际给出收益/风险，摘要漏一维：后继须按来源核对，不能宣布该维从未提供；换对象/领域/措辞、没有“完成/必须”关键词仍成立。
- 原文仅承诺后做或模型空称全部完成：有来源的欠项继续保留；摘要不能把承诺变履行。
- 部分已给、部分未给、另有更细层次未定：分别表述范围；不能全标完成或全部重新挂账。共享材料充分适用时允许合并表达，不强制逐格重复。
- 历史第一页未见、尾页有答案：不足覆盖不支持缺项；读取失败/无预算只能报告具体未知。已在当前原文中具备充分证据则不机械重复读。
- 作者较后消息重开选择：同时保留先前选择与后次变更，不计为遗忘；摘要不能制造新授权或采纳。
- 恶意历史指令、无源完成声明、跨会话定位均不能取得当前权限；原文回查只证明读过文本，不把文本陈述升级成作品事实。

**七问/存在性审核**：Contract=VS-00L §16.2.1、愿景§2.4与UA-01实际交付；Invariant=来源字节/范围/未知不变、材料描述不等于目标满足；Boundary=现役摘要instructions、RequestIR.Projection展示与AuthoringSemantics共享规则，不动存储/输入/预算/作品；Consumer=后继真实判断请求及已有探索回流；Proof=上述独立原文夹具、完整material/三wire投影、同源分页Observation接线，并独立审实际模型选择/回查/回答；Acceptance Driver=现役冻结3/10/20及后继、C8，未新跑不声明完整闭环；Exploration=复用session_message_read与已有locator/coverage，不新增工具。现有summary、indices、source/locator、读取适配与覆盖事实足够承载此步，不新增完成实体、第二摘要或自动工具循环。确定性测试只证明契约接线与边界，不能证明模型主动求证；真实语义仍以原始作者要求、实际已交付原文及真实请求/观察为独立判据。

### 5.10 普通 10/20 的只观测原始传输证据

普通固定 10/20 及既定后继复用 native_provider_stream_proxy 的现役传输 owner，显式 mode=observe；C8 默认 mode=gate 不变。observe 不提供 window/arm/disarm/pause，不能偷置 B71_AUTO_MAINTENANCE 或改变 slice 身份。runner 只给本批 backend 注入 loopback endpoint，保留原 upstream、模型、请求 body、输入 hash、预算及重试规则；实际 topology 如实记录，原失败不改签。先一次 10，独立证据与语义审核满足预注册门槛后才一次 20，不为绿追加。

每个请求保留原请求、上游收到与交付产品的三份 raw bin；只记录 response status/content-type/content-encoding 白名单、请求 ID、单调序号、接收/交付时间与累计 byte offset/hash，不在逐块 JSON 重复正文，不持久化 auth/cookie/token headers。observe 对 SSE 不做解释或等待帧边界，压缩及非法帧也原样交付；写入背压沿现 HTTP 生命周期传递，禁止无限缓存、假 chunk、重试或改变终结。自然 end、上游 error/aborted、下游断开及 runner cleanup 均有独立部分 bytes/hash/HTTP complete 事实；向 Node response 写入只证明交付尝试，不能替代产品持久 chunk/Output。

失败时 driver 在 cleanup 前保存现役 DB/events/LLMLog 快照及代理只读状态；快照失败明确缺证但仍清场。snapshot 只复制当前计数/hash，不 arm、暂停或断连接；最终 cleanup 事实另外保留，不用清场产生的 EOF 证明自然终结。代理日志自身的自然完成不签产品协议完成。收到/交付字节相等、产品双 ID/原请求精确配对及独立 SSE 完整帧/残帧/终止事实共同区分无内容、协议终结缺失、产品解析缺失、持续产字直到整轮上限；同 body 多请求或身份时序歧义保留 unknown，不择匹配赢家。旧第14没有原始SSE的原因仍 unknown。

**七问/存在性审核**：Contract=本章5.7/5.8与VS-00L现役流式终结/日志事实；Invariant=原字节、终结性质、未知与原输入预算不变；Boundary=现役外部proxy、runner、driver及同名测试，不动产品协议/模型；Consumer=普通10/20失败诊断与独立原生复审；Proof=本地HTTP自然空流/有正文、EOF无DONE、半帧/编码、同块正文终止、上游错误/下游清场、背压及凭证哨兵；Acceptance Driver=原普通native入口及独立预注册先10后条件20，不借C8签过；Exploration=复用原bin/JSONL、现有owned cleanup和只读快照，不新增代理、产品日志权威或持久业务实体。证据包含私人作品仅留本批本地，不上传；观测磁盘/代理可能影响延迟须披露，不能宣称零时间扰动。
