# 场景与完整性覆盖矩阵

> 归档注：以下正文保留源包 `f13ff640` 的候选设计，不代表当前运行实现；后续契约差异与归属见 [归档说明](../contracts/model-interaction/integration-notes.md)。
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
