# 逐字段字典（由本包Schema生成）

完整机读版本：`catalogs/field-dictionary.json`。required_in_parent表示该分支父对象存在时必填；条件必填还有运行时检查，不能只看此列。

所有proposed_shape字段是候选表达。Source-mirror工具内部允许开放属性的地方来自原契约，不代表领域验证已经完整。

## 通用缺省规则

未提供≠null≠空数组≠未读；除Schema明确允许null外不得使用null。无实际版本/来源时不得造0/默认ID。字段owner是生产责任，不是认证身份；必须从真实端口验证。

## VersionRef

owner: `application`；来源：`AuthoringTask.scope.expected_base_versions`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `VersionRef.ref` | required_in_parent · `string` | 稳定对象或来源身份；不得凭标题猜造。 |

| `VersionRef.version` | required_in_parent · `integer` | 该对象读取/操作时的真实版本。 |

| `VersionRef.sha256` | optional_or_conditional · `string` | 对应字符串UTF-8原字节哈希；不是原始JSON网络文本hash。 |



## Source

owner: `application`；来源：`RequestIR.refs + ContextSourceRef`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Source.ref` | required_in_parent · `string` | 稳定对象或来源身份；不得凭标题猜造。 |

| `Source.source_kind` | required_in_parent · `enum(author_message, author_action, accepted_prose, work_archive, candidate, design_brief, observation, system_job, catalog, memory, author_asset, external_reference, quality_finding, delegation, checkpoint)` | 来源类别：作者原话、已采纳正文、设计简述、观察、素材、目录等。 |

| `Source.authority` | required_in_parent · `enum(canon, tentative, author_statement, design, derived, reference_only, system_fact)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `Source.work_ref` | optional_or_conditional · `string` | 作品作用域，跨作品前必须有明确合法授权。 |

| `Source.version` | optional_or_conditional · `integer` | 该对象读取/操作时的真实版本。 |

| `Source.sha256` | optional_or_conditional · `string` | 对应字符串UTF-8原字节哈希；不是原始JSON网络文本hash。 |

| `Source.trust` | required_in_parent · `enum(author_provided, application_attested, tool_attested, model_generated, external_untrusted)` | 来源获得方式/信任层级，与作品权威地位分离。 |



## Coverage

owner: `application`；来源：`RequestIR.observation + AuthoringTask.materials`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Coverage.status` | required_in_parent · `enum(not_read, partial, complete, truncated, unavailable, stale)` | 此对象自身生命周期状态，不是所有层共用的成功状态。 |

| `Coverage.unit` | required_in_parent · `enum(item, chapter, segment, utf8_byte, unicode_codepoint, catalog_entry)` | 统计/覆盖的单位：item、chapter、segment、UTF-8 byte等，所有区间按该单位解释。 |

| `Coverage.included` | required_in_parent · `integer` | 实际已提供量。 |

| `Coverage.total` | required_in_parent · `integer \| null` | 已知权威总量，未知为null。 |

| `Coverage.ranges` | optional_or_conditional · `array<object>` | 同一版本材料的实际覆盖区间列表，不能混合旧页与新页拼完整。 |

| `Coverage.ranges[].start` | required_in_parent · `integer` | 情绪起点的可读状态，或所在区间的起点；具体类型由父对象限定。 |

| `Coverage.ranges[].end_exclusive` | required_in_parent · `integer` | 覆盖范围右开终点；单位由coverage.unit决定。 |

| `Coverage.omitted_count` | required_in_parent · `integer \| null` | 未提供量，未知为null。 |

| `Coverage.next_cursor` | required_in_parent · `string \| null` | 真实续读位置；已读完为null，未知/无法续读须配合status解释。 |

| `Coverage.reason` | optional_or_conditional · `string` | 供用户理解的简短依据，不要求私有思维链。 |



## Omission

owner: `application`；来源：`VS-00L observations/omissions`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Omission.material_kind` | required_in_parent · `string` | 被提供或省略材料的业务种类，区别其来源和权威等级。 |

| `Omission.reason` | required_in_parent · `enum(not_requested, not_read, budget, unavailable, access_denied, stale, compacted, irrelevant_by_explicit_scope, not_implemented)` | 供用户理解的简短依据，不要求私有思维链。 |

| `Omission.source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `Omission.recover_via` | optional_or_conditional · `string \| null` | 该省略项可用哪个真实工具/路径补取；不存在入口不能虚填。 |

| `Omission.description` | required_in_parent · `string` | 当前对象的可读说明；不作为唯一权限、身份或版本证据。 |



## Coordinate

owner: `application`；来源：`WritingCoordinate`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Coordinate.work_ref` | required_in_parent · `string` | 作品作用域，跨作品前必须有明确合法授权。 |

| `Coordinate.volume_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Coordinate.chapter_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Coordinate.scene_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Coordinate.target_level` | required_in_parent · `enum(work, volume, chapter, scene)` | 当前写作目标的结构尺度：作品/卷/章/场。 |

| `Coordinate.story_time` | optional_or_conditional · `string` | 作品中的叙事时间信息，不是系统created_at。 |

| `Coordinate.pov_character_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Coordinate.order_basis` | required_in_parent · `enum(author_requested, current_cursor, validated_target)` | 写作坐标来自作者明确选择、当前游标还是经过核验的目标。 |



## Count

owner: `application`；来源：`工作统计；新增明确计量口径`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Count.value` | required_in_parent · `integer` | 字段的真实值或作者选项值，类型受父字段Schema和领域规则限制。 |

| `Count.unit` | required_in_parent · `enum(unicode_codepoints, non_whitespace_codepoints, words, tokens, chapters, scenes)` | 统计/覆盖的单位：item、chapter、segment、UTF-8 byte等，所有区间按该单位解释。 |

| `Count.method_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Count.source_ref` | required_in_parent · `string` | 已存在的来源引用，不能只用解释性文字代替。 |



## Constraint

owner: `application`；来源：`AuthoringTask.preserve + 作者 brief`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Constraint.constraint_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Constraint.kind` | required_in_parent · `enum(preserve_text, preserve_event_order, preserve_canon, style, scope, length, pov, prohibition, reader_effect)` | 判别分支；不得与作者最终意图分类混同。 |

| `Constraint.text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `Constraint.source_ref` | required_in_parent · `string` | 已存在的来源引用，不能只用解释性文字代替。 |

| `Constraint.strength` | required_in_parent · `enum(must, prefer)` | 约束是must还是prefer；模型不能把偏好默默升级成作者硬约束。 |

| `Constraint.applies_to` | optional_or_conditional · `array<string>` | 该条作者约束适用的目标集合；不超出当前合法作用域。 |



## Goal

owner: `application`；来源：`AgentRun.goal`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Goal.text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `Goal.source_ref` | required_in_parent · `string` | 已存在的来源引用，不能只用解释性文字代替。 |

| `Goal.version` | required_in_parent · `integer` | 该对象读取/操作时的真实版本。 |



## AuthorInput

owner: `author`；来源：`RequestIR user/author`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `AuthorInput.message_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorInput.text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `AuthorInput.sha256` | required_in_parent · `string` | 对应字符串UTF-8原字节哈希；不是原始JSON网络文本hash。 |



## ExecutionIdentity

owner: `application`；来源：`RequestIR.run + text_operation；不虚构 run/session`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ExecutionIdentity/oneOf[0].kind` | required_in_parent · `const "agent_run"` | 判别分支；不得与作者最终意图分类混同。 |

| `ExecutionIdentity/oneOf[0].request_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[0].provider_attempt_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[0].workspace_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[0].work_ref` | required_in_parent · `string` | 作品作用域，跨作品前必须有明确合法授权。 |

| `ExecutionIdentity/oneOf[0].session_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[0].run_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[0].turn_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[0].step_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[0].goal_version` | required_in_parent · `integer` | 当前目标版本；steer必须新版本且来源可追溯。 |

| `ExecutionIdentity/oneOf[0].created_at` | required_in_parent · `string` | UTC/带时区 ISO-8601 时间，不用本地无时区时间 |

| `ExecutionIdentity/oneOf[1].kind` | required_in_parent · `const "standalone_operation"` | 判别分支；不得与作者最终意图分类混同。 |

| `ExecutionIdentity/oneOf[1].request_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[1].provider_attempt_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[1].operation_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[1].profile_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionIdentity/oneOf[1].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `ExecutionIdentity/oneOf[1].work_ref` | optional_or_conditional · `string` | 作品作用域，跨作品前必须有明确合法授权。 |

| `ExecutionIdentity/oneOf[1].created_at` | required_in_parent · `string` | UTC/带时区 ISO-8601 时间，不用本地无时区时间 |



## TaskScope

owner: `application`；来源：`AuthoringTask.scope/B28/B36`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `TaskScope.object_kind` | required_in_parent · `enum(none, work, volume, chapter, scene, segment, character, world_rule, candidate, memory, author_asset, ledger)` | 当前作用对象类型，如chapter/segment/character/candidate，不等于artifact_type。 |

| `TaskScope.refs` | required_in_parent · `array<string>` | 所属对象的实际引用集合，具体是否目标/来源/事件由父契约决定。 |

| `TaskScope.coverage` | required_in_parent · `enum(none, single, chapter, multi)` | 材料真实覆盖，不是预计读取范围。 |

| `TaskScope.base_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `TaskScope.base_hash` | optional_or_conditional · `string` | UTF-8 原字节 SHA-256，64 位小写十六进制 |

| `TaskScope.target_chapter_ref` | optional_or_conditional · `string` | 实际目标章节身份，修订与统计都不能靠标题同名猜测。 |

| `TaskScope.modification_scope` | optional_or_conditional · `enum(format_only, target_segments, whole_chapter)` | format_only/target_segments/whole_chapter的明确修订方式。 |

| `TaskScope.target_segment_ids` | optional_or_conditional · `array<string>` | 本次允许替换的真实已读段ID集合，不得自造或跨基线复制。 |

| `TaskScope.expected_base_versions` | optional_or_conditional · `array<VersionRef>` | 写入/修订预期基线，不匹配必须重读/拒绝。 |



## OutputContract

owner: `application`；来源：`ToolOutputContract + profile 原生工具`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `OutputContract.mode` | required_in_parent · `enum(content_or_native_tools, native_tool, structured_json, text)` | 所属对象的合法模式：授权模式、输出方式或对白模式各遵循所在类型枚举。 |

| `OutputContract.allowed_tool_names` | required_in_parent · `array<string>` | 此次专业输出允许的原生模型工具名；必须是当前profile实际展开的定义。 |

| `OutputContract.artifact_type` | optional_or_conditional · `string` | 输出或候选的领域类型；正文、卷纲、角色、排版计划不能靠相同body形状互换。 |

| `OutputContract.payload_schema_ref` | optional_or_conditional · `string` | 专业输出的校验schema引用；提案形状不等于现役parser。 |

| `OutputContract.required_evidence` | required_in_parent · `enum(none, available_sources, complete_target)` | 该任务要求无旧证据/已公开来源/完整目标，缺少时不能直接生成结论。 |

| `OutputContract.allow_companions` | required_in_parent · `boolean` | 当前专业任务是否允许伴生产物；非正文任务不能由模型擅自附带其它类型。 |

| `OutputContract.requires_author_visible_text` | required_in_parent · `boolean` | 此输出模式是否必须有非空作者可见答复，不允许标点占位终局。 |



## Task

owner: `application`；来源：`AuthoringTask + JudgmentProtocol；task.kind 扩展是设计标签不是新运行类型`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Task.kind` | required_in_parent · `enum(judgment, plan_draft, continuation_decision, first_draft, continuation, rewrite, revision, character_design, character_evolution, outline, world_building, chapter_mission, quality_evaluation, chapter_summary, fact_inventory, ledger_reconcile, result_narration, author_content_registration, work_profile_revision, creative_directions)` | 判别分支；不得与作者最终意图分类混同。 |

| `Task.role` | required_in_parent · `string` | 专业角色或原生消息角色；authority/provenance仍必须独立。 |

| `Task.goal` | required_in_parent · `Goal` | 当前任务目标文本、来源与版本；作者引导改变目标必须升版本。 |

| `Task.source` | required_in_parent · `Source` | 有类型、权威、信任和可选版本的真实来源，不是自由来源说明字符串。 |

| `Task.scope` | required_in_parent · `TaskScope` | 目标对象、覆盖、基线与修改边界，不能用泛泛目标文字替代。 |

| `Task.operation_effect` | required_in_parent · `enum(observe, decide, plan, create_candidate, revise_candidate, format_only, evaluate, extract_facts, reconcile, narrate, design_object, register_author_text)` | AuthoringTask真实期望效果：生成、修订、排版、评估、提取等；与模型调用阶段不同。 |

| `Task.material_refs` | required_in_parent · `array<string>` | 此次实际提供的材料实例引用。 |

| `Task.constraints` | required_in_parent · `array<Constraint>` | 来自可追溯作者意图或已确认规则的限制；must与prefer须区别。 |

| `Task.output_contract` | required_in_parent · `OutputContract` | 本专业任务的输出种类、允许工具、artifact与证据要求。 |

| `Task.prior_result_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |



## ElementPayload_E01

owner: `application`；来源：`08-novel-element-model §4 E01（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E01.logline` | optional_or_conditional · `array<string>` | 设计细化字段；承载“前提”的 logline 内容，不要求一次列全 |



## ElementPayload_E02

owner: `application`；来源：`08-novel-element-model §4 E02（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E02.central_question` | optional_or_conditional · `array<string>` | 设计细化字段；承载“主题”的 central_question 内容，不要求一次列全 |

| `ElementPayload_E02.value_conflict` | optional_or_conditional · `array<string>` | 设计细化字段；承载“主题”的 value_conflict 内容，不要求一次列全 |

| `ElementPayload_E02.intended_argument` | optional_or_conditional · `array<string>` | 设计细化字段；承载“主题”的 intended_argument 内容，不要求一次列全 |



## ElementPayload_E03

owner: `application`；来源：`08-novel-element-model §4 E03（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E03.genre_rules` | optional_or_conditional · `array<string>` | 设计细化字段；承载“类型契约”的 genre_rules 内容，不要求一次列全 |

| `ElementPayload_E03.reader_promises` | optional_or_conditional · `array<string>` | 设计细化字段；承载“类型契约”的 reader_promises 内容，不要求一次列全 |

| `ElementPayload_E03.avoidances` | optional_or_conditional · `array<string>` | 设计细化字段；承载“类型契约”的 avoidances 内容，不要求一次列全 |



## ElementPayload_E04

owner: `application`；来源：`08-novel-element-model §4 E04（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E04.target_readers` | optional_or_conditional · `array<string>` | 设计细化字段；承载“定位”的 target_readers 内容，不要求一次列全 |

| `ElementPayload_E04.core_selling_points` | optional_or_conditional · `array<string>` | 设计细化字段；承载“定位”的 core_selling_points 内容，不要求一次列全 |

| `ElementPayload_E04.comparables` | optional_or_conditional · `array<string>` | 设计细化字段；承载“定位”的 comparables 内容，不要求一次列全 |



## ElementPayload_E05

owner: `application`；来源：`08-novel-element-model §4 E05（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E05.time_space` | optional_or_conditional · `array<string>` | 设计细化字段；承载“世界观”的 time_space 内容，不要求一次列全 |

| `ElementPayload_E05.social_structure` | optional_or_conditional · `array<string>` | 设计细化字段；承载“世界观”的 social_structure 内容，不要求一次列全 |

| `ElementPayload_E05.history` | optional_or_conditional · `array<string>` | 从Canonical派生的有序会话视图；不能成为第二历史真源。 |

| `ElementPayload_E05.power_rules` | optional_or_conditional · `array<string>` | 设计细化字段；承载“世界观”的 power_rules 内容，不要求一次列全 |



## ElementPayload_E06

owner: `application`；来源：`08-novel-element-model §4 E06（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E06.mechanism` | optional_or_conditional · `array<string>` | 设计细化字段；承载“核心设定引擎”的 mechanism 内容，不要求一次列全 |

| `ElementPayload_E06.benefits` | optional_or_conditional · `array<string>` | 设计细化字段；承载“核心设定引擎”的 benefits 内容，不要求一次列全 |

| `ElementPayload_E06.limits` | optional_or_conditional · `array<string>` | 设定/能力/风格约束的明确边界，不能只描述收益不描述限制。 |

| `ElementPayload_E06.costs` | optional_or_conditional · `array<string>` | 设计细化字段；承载“核心设定引擎”的 costs 内容，不要求一次列全 |



## ElementPayload_E07

owner: `application`；来源：`08-novel-element-model §4 E07（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E07.surface_desire` | optional_or_conditional · `array<string>` | 设计细化字段；承载“人物体系”的 surface_desire 内容，不要求一次列全 |

| `ElementPayload_E07.deep_need` | optional_or_conditional · `array<string>` | 设计细化字段；承载“人物体系”的 deep_need 内容，不要求一次列全 |

| `ElementPayload_E07.fatal_flaw` | optional_or_conditional · `array<string>` | 设计细化字段；承载“人物体系”的 fatal_flaw 内容，不要求一次列全 |

| `ElementPayload_E07.arc_design` | optional_or_conditional · `array<string>` | 设计细化字段；承载“人物体系”的 arc_design 内容，不要求一次列全 |

| `ElementPayload_E07.opposition` | optional_or_conditional · `array<string>` | 设计细化字段；承载“人物体系”的 opposition 内容，不要求一次列全 |

| `ElementPayload_E07.relationships` | optional_or_conditional · `array<string>` | 设计细化字段；承载“人物体系”的 relationships 内容，不要求一次列全 |



## ElementPayload_E08

owner: `application`；来源：`08-novel-element-model §4 E08（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E08.central_conflict` | optional_or_conditional · `array<string>` | 设计细化字段；承载“主线架构”的 central_conflict 内容，不要求一次列全 |

| `ElementPayload_E08.stakes_escalation` | optional_or_conditional · `array<string>` | 设计细化字段；承载“主线架构”的 stakes_escalation 内容，不要求一次列全 |

| `ElementPayload_E08.major_climax` | optional_or_conditional · `array<string>` | 设计细化字段；承载“主线架构”的 major_climax 内容，不要求一次列全 |



## ElementPayload_E09

owner: `application`；来源：`08-novel-element-model §4 E09（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E09.stages` | optional_or_conditional · `array<string>` | 设计细化字段；承载“成长体系”的 stages 内容，不要求一次列全 |

| `ElementPayload_E09.resource_economy` | optional_or_conditional · `array<string>` | 设计细化字段；承载“成长体系”的 resource_economy 内容，不要求一次列全 |

| `ElementPayload_E09.costs_and_limits` | optional_or_conditional · `array<string>` | 设计细化字段；承载“成长体系”的 costs_and_limits 内容，不要求一次列全 |



## ElementPayload_E10

owner: `application`；来源：`08-novel-element-model §4 E10（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E10.person` | optional_or_conditional · `array<string>` | 设计细化字段；承载“叙述策略”的 person 内容，不要求一次列全 |

| `ElementPayload_E10.viewpoint` | optional_or_conditional · `array<string>` | 设计细化字段；承载“叙述策略”的 viewpoint 内容，不要求一次列全 |

| `ElementPayload_E10.tense` | optional_or_conditional · `array<string>` | 设计细化字段；承载“叙述策略”的 tense 内容，不要求一次列全 |

| `ElementPayload_E10.distance` | optional_or_conditional · `array<string>` | 设计细化字段；承载“叙述策略”的 distance 内容，不要求一次列全 |



## ElementPayload_E11

owner: `application`；来源：`08-novel-element-model §4 E11（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E11.syntax` | optional_or_conditional · `array<string>` | 设计细化字段；承载“语言风格”的 syntax 内容，不要求一次列全 |

| `ElementPayload_E11.register` | optional_or_conditional · `array<string>` | 设计细化字段；承载“语言风格”的 register 内容，不要求一次列全 |

| `ElementPayload_E11.voice_rules` | optional_or_conditional · `array<string>` | 设计细化字段；承载“语言风格”的 voice_rules 内容，不要求一次列全 |

| `ElementPayload_E11.taboos` | optional_or_conditional · `array<string>` | 设计细化字段；承载“语言风格”的 taboos 内容，不要求一次列全 |



## ElementPayload_E12

owner: `application`；来源：`08-novel-element-model §4 E12（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E12.naming_rules` | optional_or_conditional · `array<string>` | 设计细化字段；承载“命名体系”的 naming_rules 内容，不要求一次列全 |

| `ElementPayload_E12.reserved_names` | optional_or_conditional · `array<string>` | 设计细化字段；承载“命名体系”的 reserved_names 内容，不要求一次列全 |



## ElementPayload_E13

owner: `application`；来源：`08-novel-element-model §4 E13（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E13.motifs` | optional_or_conditional · `array<string>` | 设计细化字段；承载“母题与意象”的 motifs 内容，不要求一次列全 |

| `ElementPayload_E13.images` | optional_or_conditional · `array<string>` | 设计细化字段；承载“母题与意象”的 images 内容，不要求一次列全 |

| `ElementPayload_E13.meaning_evolution` | optional_or_conditional · `array<string>` | 设计细化字段；承载“母题与意象”的 meaning_evolution 内容，不要求一次列全 |



## ElementPayload_E14

owner: `application`；来源：`08-novel-element-model §4 E14（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E14.conflict_goal` | optional_or_conditional · `array<string>` | 设计细化字段；承载“卷目标”的 conflict_goal 内容，不要求一次列全 |

| `ElementPayload_E14.arc_milestone` | optional_or_conditional · `array<string>` | 设计细化字段；承载“卷目标”的 arc_milestone 内容，不要求一次列全 |

| `ElementPayload_E14.location_boundary` | optional_or_conditional · `array<string>` | 设计细化字段；承载“卷目标”的 location_boundary 内容，不要求一次列全 |



## ElementPayload_E15

owner: `application`；来源：`08-novel-element-model §4 E15（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E15.start_threads` | optional_or_conditional · `array<string>` | 设计细化字段；承载“支线编织”的 start_threads 内容，不要求一次列全 |

| `ElementPayload_E15.advance_threads` | optional_or_conditional · `array<string>` | 设计细化字段；承载“支线编织”的 advance_threads 内容，不要求一次列全 |

| `ElementPayload_E15.close_threads` | optional_or_conditional · `array<string>` | 设计细化字段；承载“支线编织”的 close_threads 内容，不要求一次列全 |



## ElementPayload_E16

owner: `application`；来源：`08-novel-element-model §4 E16（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E16.climax_distribution` | optional_or_conditional · `array<string>` | 设计细化字段；承载“节奏蓝图”的 climax_distribution 内容，不要求一次列全 |

| `ElementPayload_E16.payoff_density` | optional_or_conditional · `array<string>` | 设计细化字段；承载“节奏蓝图”的 payoff_density 内容，不要求一次列全 |

| `ElementPayload_E16.breathing_spaces` | optional_or_conditional · `array<string>` | 设计细化字段；承载“节奏蓝图”的 breathing_spaces 内容，不要求一次列全 |



## ElementPayload_E17

owner: `application`；来源：`08-novel-element-model §4 E17（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E17.characters_to_introduce` | optional_or_conditional · `array<string>` | 设计细化字段；承载“新要素释放计划”的 characters_to_introduce 内容，不要求一次列全 |

| `ElementPayload_E17.settings_to_introduce` | optional_or_conditional · `array<string>` | 设计细化字段；承载“新要素释放计划”的 settings_to_introduce 内容，不要求一次列全 |

| `ElementPayload_E17.release_order` | optional_or_conditional · `array<string>` | 设计细化字段；承载“新要素释放计划”的 release_order 内容，不要求一次列全 |



## ElementPayload_E18

owner: `application`；来源：`08-novel-element-model §4 E18（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E18.chapter_function` | optional_or_conditional · `array<string>` | 本章承担推进/铺垫/转折等功能的明确表达；不存在统一强制高潮模板。 |



## ElementPayload_E19

owner: `application`；来源：`08-novel-element-model §4 E19（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E19.plot_change` | optional_or_conditional · `array<string>` | 设计细化字段；承载“章目标四件套”的 plot_change 内容，不要求一次列全 |

| `ElementPayload_E19.character_change` | optional_or_conditional · `array<string>` | 设计细化字段；承载“章目标四件套”的 character_change 内容，不要求一次列全 |

| `ElementPayload_E19.information_release` | optional_or_conditional · `array<string>` | 设计细化字段；承载“章目标四件套”的 information_release 内容，不要求一次列全 |

| `ElementPayload_E19.foreshadowing_action` | optional_or_conditional · `array<string>` | 设计细化字段；承载“章目标四件套”的 foreshadowing_action 内容，不要求一次列全 |



## ElementPayload_E20

owner: `application`；来源：`08-novel-element-model §4 E20（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E20.intended_reader_emotion` | optional_or_conditional · `array<string>` | 设计细化字段；承载“情绪定位”的 intended_reader_emotion 内容，不要求一次列全 |

| `ElementPayload_E20.tension_source` | optional_or_conditional · `array<string>` | 设计细化字段；承载“情绪定位”的 tension_source 内容，不要求一次列全 |



## ElementPayload_E21

owner: `application`；来源：`08-novel-element-model §4 E21（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E21.opening_pull` | optional_or_conditional · `array<string>` | 设计细化字段；承载“章首拉力与章尾断章”的 opening_pull 内容，不要求一次列全 |

| `ElementPayload_E21.ending_hook` | optional_or_conditional · `array<string>` | 设计细化字段；承载“章首拉力与章尾断章”的 ending_hook 内容，不要求一次列全 |

| `ElementPayload_E21.hook_type` | optional_or_conditional · `array<string>` | 设计细化字段；承载“章首拉力与章尾断章”的 hook_type 内容，不要求一次列全 |



## ElementPayload_E22

owner: `application`；来源：`08-novel-element-model §4 E22（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E22.length_goal` | optional_or_conditional · `array<string>` | 设计细化字段；承载“字数与场次划分”的 length_goal 内容，不要求一次列全 |

| `ElementPayload_E22.scene_division` | optional_or_conditional · `array<string>` | 设计细化字段；承载“字数与场次划分”的 scene_division 内容，不要求一次列全 |



## ElementPayload_E23

owner: `application`；来源：`08-novel-element-model §4 E23（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E23.goal` | optional_or_conditional · `array<string>` | 当前任务目标文本、来源与版本；作者引导改变目标必须升版本。 |

| `ElementPayload_E23.conflict_or_dilemma` | optional_or_conditional · `array<string>` | 设计细化字段；承载“场景解剖”的 conflict_or_dilemma 内容，不要求一次列全 |

| `ElementPayload_E23.turn` | optional_or_conditional · `array<string>` | 情绪或因果转折，所在Scene设计中的状态转变，不是会话turn_id。 |

| `ElementPayload_E23.consequence` | optional_or_conditional · `array<string>` | 场景转折导致的具体后果，属于设计意图，写后要按正文对账。 |

| `ElementPayload_E23.required_change` | optional_or_conditional · `array<string>` | 设计细化字段；承载“场景解剖”的 required_change 内容，不要求一次列全 |



## ElementPayload_E24

owner: `application`；来源：`08-novel-element-model §4 E24（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E24.wants` | optional_or_conditional · `array<string>` | 人物在本场具体追求的目标，是对白/冲突动力。 |

| `ElementPayload_E24.hides` | optional_or_conditional · `array<string>` | 当前人物在本场隐瞒的内容，属于明确设计/证据，不是模型任意猜心理。 |

| `ElementPayload_E24.conflicts` | optional_or_conditional · `array<string>` | 实际发现的冲突列表，需要对应来源/证据；不能凭空补设定。 |



## ElementPayload_E25

owner: `application`；来源：`08-novel-element-model §4 E25（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E25.reader_knows` | optional_or_conditional · `array<string>` | 设计细化字段；承载“场内信息差”的 reader_knows 内容，不要求一次列全 |

| `ElementPayload_E25.characters_know` | optional_or_conditional · `array<string>` | 设计细化字段；承载“场内信息差”的 characters_know 内容，不要求一次列全 |

| `ElementPayload_E25.reveals` | optional_or_conditional · `array<string>` | 设计细化字段；承载“场内信息差”的 reveals 内容，不要求一次列全 |

| `ElementPayload_E25.withheld` | optional_or_conditional · `array<string>` | 设计细化字段；承载“场内信息差”的 withheld 内容，不要求一次列全 |



## ElementPayload_E26

owner: `application`；来源：`08-novel-element-model §4 E26（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E26.location` | optional_or_conditional · `array<string>` | 设计细化字段；承载“时空与感官”的 location 内容，不要求一次列全 |

| `ElementPayload_E26.time` | optional_or_conditional · `array<string>` | 设计细化字段；承载“时空与感官”的 time 内容，不要求一次列全 |

| `ElementPayload_E26.atmosphere` | optional_or_conditional · `array<string>` | 设计细化字段；承载“时空与感官”的 atmosphere 内容，不要求一次列全 |

| `ElementPayload_E26.sensory_anchors` | optional_or_conditional · `array<string>` | 设计细化字段；承载“时空与感官”的 sensory_anchors 内容，不要求一次列全 |



## ElementPayload_E27

owner: `application`；来源：`08-novel-element-model §4 E27（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E27.voices` | optional_or_conditional · `array<string>` | 设计细化字段；承载“对白设计”的 voices 内容，不要求一次列全 |

| `ElementPayload_E27.surface_topic` | optional_or_conditional · `array<string>` | 人物对白表面上谈什么，与隐藏冲突分开。 |

| `ElementPayload_E27.subtext` | optional_or_conditional · `array<string>` | 设计细化字段；承载“对白设计”的 subtext 内容，不要求一次列全 |

| `ElementPayload_E27.dialogue_action_balance` | optional_or_conditional · `array<string>` | 设计细化字段；承载“对白设计”的 dialogue_action_balance 内容，不要求一次列全 |



## ElementPayload_E28

owner: `application`；来源：`08-novel-element-model §4 E28（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E28.spatial_logic` | optional_or_conditional · `array<string>` | 设计细化字段；承载“动作编排”的 spatial_logic 内容，不要求一次列全 |

| `ElementPayload_E28.action_causality` | optional_or_conditional · `array<string>` | 设计细化字段；承载“动作编排”的 action_causality 内容，不要求一次列全 |



## ElementPayload_E29

owner: `application`；来源：`08-novel-element-model §4 E29（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E29.emotional_flow` | optional_or_conditional · `array<string>` | 设计细化字段；承载“内心戏”的 emotional_flow 内容，不要求一次列全 |

| `ElementPayload_E29.thought_presentation` | optional_or_conditional · `array<string>` | 设计细化字段；承载“内心戏”的 thought_presentation 内容，不要求一次列全 |



## ElementPayload_E30

owner: `application`；来源：`08-novel-element-model §4 E30（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E30.time_transition` | optional_or_conditional · `array<string>` | 设计细化字段；承载“场间过渡”的 time_transition 内容，不要求一次列全 |

| `ElementPayload_E30.viewpoint_transition` | optional_or_conditional · `array<string>` | 设计细化字段；承载“场间过渡”的 viewpoint_transition 内容，不要求一次列全 |

| `ElementPayload_E30.continuity_bridge` | optional_or_conditional · `array<string>` | 设计细化字段；承载“场间过渡”的 continuity_bridge 内容，不要求一次列全 |



## ElementPayload_E31

owner: `application`；来源：`08-novel-element-model §4 E31（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E31.state_changes` | optional_or_conditional · `array<string>` | 设计细化字段；承载“连续性账”的 state_changes 内容，不要求一次列全 |

| `ElementPayload_E31.timeline` | optional_or_conditional · `array<string>` | 设计细化字段；承载“连续性账”的 timeline 内容，不要求一次列全 |

| `ElementPayload_E31.rule_consistency` | optional_or_conditional · `array<string>` | 设计细化字段；承载“连续性账”的 rule_consistency 内容，不要求一次列全 |



## ElementPayload_E32

owner: `application`；来源：`08-novel-element-model §4 E32（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E32.plants` | optional_or_conditional · `array<string>` | 设计细化字段；承载“伏笔账”的 plants 内容，不要求一次列全 |

| `ElementPayload_E32.development` | optional_or_conditional · `array<string>` | 设计细化字段；承载“伏笔账”的 development 内容，不要求一次列全 |

| `ElementPayload_E32.payoffs` | optional_or_conditional · `array<string>` | 设计细化字段；承载“伏笔账”的 payoffs 内容，不要求一次列全 |



## ElementPayload_E33

owner: `application`；来源：`08-novel-element-model §4 E33（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E33.arc_steps` | optional_or_conditional · `array<string>` | 设计细化字段；承载“弧光账”的 arc_steps 内容，不要求一次列全 |

| `ElementPayload_E33.realized_changes` | optional_or_conditional · `array<string>` | 设计细化字段；承载“弧光账”的 realized_changes 内容，不要求一次列全 |

| `ElementPayload_E33.remaining_changes` | optional_or_conditional · `array<string>` | 设计细化字段；承载“弧光账”的 remaining_changes 内容，不要求一次列全 |



## ElementPayload_E34

owner: `application`；来源：`08-novel-element-model §4 E34（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E34.main_progress` | optional_or_conditional · `array<string>` | 设计细化字段；承载“冲突账”的 main_progress 内容，不要求一次列全 |

| `ElementPayload_E34.subplot_progress` | optional_or_conditional · `array<string>` | 设计细化字段；承载“冲突账”的 subplot_progress 内容，不要求一次列全 |

| `ElementPayload_E34.unresolved_conflicts` | optional_or_conditional · `array<string>` | 设计细化字段；承载“冲突账”的 unresolved_conflicts 内容，不要求一次列全 |



## ElementPayload_E35

owner: `application`；来源：`08-novel-element-model §4 E35（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E35.reader_knowledge` | optional_or_conditional · `array<string>` | 设计细化字段；承载“信息账”的 reader_knowledge 内容，不要求一次列全 |

| `ElementPayload_E35.character_knowledge` | optional_or_conditional · `array<string>` | 设计细化字段；承载“信息账”的 character_knowledge 内容，不要求一次列全 |

| `ElementPayload_E35.full_truth` | optional_or_conditional · `array<string>` | 设计细化字段；承载“信息账”的 full_truth 内容，不要求一次列全 |



## ElementPayload_E36

owner: `application`；来源：`08-novel-element-model §4 E36（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E36.realized_tension` | optional_or_conditional · `array<string>` | 设计细化字段；承载“情绪曲线账”的 realized_tension 内容，不要求一次列全 |

| `ElementPayload_E36.release_points` | optional_or_conditional · `array<string>` | 设计细化字段；承载“情绪曲线账”的 release_points 内容，不要求一次列全 |

| `ElementPayload_E36.emotional_residue` | optional_or_conditional · `array<string>` | 设计细化字段；承载“情绪曲线账”的 emotional_residue 内容，不要求一次列全 |



## ElementPayload_E37

owner: `application`；来源：`08-novel-element-model §4 E37（名称/维度）；字段分解为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ElementPayload_E37.promises` | optional_or_conditional · `array<string>` | 设计细化字段；承载“承诺账”的 promises 内容，不要求一次列全 |

| `ElementPayload_E37.fulfillments` | optional_or_conditional · `array<string>` | 设计细化字段；承载“承诺账”的 fulfillments 内容，不要求一次列全 |

| `ElementPayload_E37.outstanding_promises` | optional_or_conditional · `array<string>` | 设计细化字段；承载“承诺账”的 outstanding_promises 内容，不要求一次列全 |



## NovelElement

owner: `application`；来源：`08-novel-element-model：37×层级×三态；具体JSON为提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `NovelElement/oneOf[0].element_id` | required_in_parent · `const "E01"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[0].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[0].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[0].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[0].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[0].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[0].payload` | required_in_parent · `ElementPayload_E01` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[0].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[1].element_id` | required_in_parent · `const "E02"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[1].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[1].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[1].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[1].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[1].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[1].payload` | required_in_parent · `ElementPayload_E02` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[1].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[2].element_id` | required_in_parent · `const "E03"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[2].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[2].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[2].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[2].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[2].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[2].payload` | required_in_parent · `ElementPayload_E03` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[2].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[3].element_id` | required_in_parent · `const "E04"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[3].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[3].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[3].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[3].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[3].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[3].payload` | required_in_parent · `ElementPayload_E04` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[3].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[4].element_id` | required_in_parent · `const "E05"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[4].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[4].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[4].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[4].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[4].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[4].payload` | required_in_parent · `ElementPayload_E05` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[4].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[5].element_id` | required_in_parent · `const "E06"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[5].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[5].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[5].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[5].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[5].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[5].payload` | required_in_parent · `ElementPayload_E06` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[5].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[6].element_id` | required_in_parent · `const "E07"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[6].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[6].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[6].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[6].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[6].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[6].payload` | required_in_parent · `ElementPayload_E07` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[6].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[7].element_id` | required_in_parent · `const "E08"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[7].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[7].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[7].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[7].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[7].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[7].payload` | required_in_parent · `ElementPayload_E08` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[7].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[8].element_id` | required_in_parent · `const "E09"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[8].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[8].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[8].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[8].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[8].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[8].payload` | required_in_parent · `ElementPayload_E09` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[8].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[9].element_id` | required_in_parent · `const "E10"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[9].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[9].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[9].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[9].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[9].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[9].payload` | required_in_parent · `ElementPayload_E10` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[9].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[10].element_id` | required_in_parent · `const "E11"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[10].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[10].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[10].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[10].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[10].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[10].payload` | required_in_parent · `ElementPayload_E11` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[10].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[11].element_id` | required_in_parent · `const "E12"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[11].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[11].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[11].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[11].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[11].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[11].payload` | required_in_parent · `ElementPayload_E12` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[11].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[12].element_id` | required_in_parent · `const "E13"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[12].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[12].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[12].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[12].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[12].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[12].payload` | required_in_parent · `ElementPayload_E13` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[12].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[13].element_id` | required_in_parent · `const "E14"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[13].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[13].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[13].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[13].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[13].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[13].payload` | required_in_parent · `ElementPayload_E14` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[13].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[14].element_id` | required_in_parent · `const "E15"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[14].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[14].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[14].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[14].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[14].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[14].payload` | required_in_parent · `ElementPayload_E15` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[14].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[15].element_id` | required_in_parent · `const "E16"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[15].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[15].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[15].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[15].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[15].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[15].payload` | required_in_parent · `ElementPayload_E16` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[15].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[16].element_id` | required_in_parent · `const "E17"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[16].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[16].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[16].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[16].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[16].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[16].payload` | required_in_parent · `ElementPayload_E17` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[16].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[17].element_id` | required_in_parent · `const "E18"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[17].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[17].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[17].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[17].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[17].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[17].payload` | required_in_parent · `ElementPayload_E18` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[17].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[18].element_id` | required_in_parent · `const "E19"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[18].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[18].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[18].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[18].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[18].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[18].payload` | required_in_parent · `ElementPayload_E19` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[18].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[19].element_id` | required_in_parent · `const "E20"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[19].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[19].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[19].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[19].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[19].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[19].payload` | required_in_parent · `ElementPayload_E20` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[19].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[20].element_id` | required_in_parent · `const "E21"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[20].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[20].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[20].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[20].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[20].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[20].payload` | required_in_parent · `ElementPayload_E21` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[20].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[21].element_id` | required_in_parent · `const "E22"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[21].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[21].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[21].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[21].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[21].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[21].payload` | required_in_parent · `ElementPayload_E22` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[21].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[22].element_id` | required_in_parent · `const "E23"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[22].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[22].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[22].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[22].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[22].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[22].payload` | required_in_parent · `ElementPayload_E23` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[22].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[23].element_id` | required_in_parent · `const "E24"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[23].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[23].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[23].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[23].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[23].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[23].payload` | required_in_parent · `ElementPayload_E24` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[23].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[24].element_id` | required_in_parent · `const "E25"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[24].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[24].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[24].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[24].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[24].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[24].payload` | required_in_parent · `ElementPayload_E25` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[24].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[25].element_id` | required_in_parent · `const "E26"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[25].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[25].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[25].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[25].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[25].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[25].payload` | required_in_parent · `ElementPayload_E26` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[25].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[26].element_id` | required_in_parent · `const "E27"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[26].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[26].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[26].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[26].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[26].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[26].payload` | required_in_parent · `ElementPayload_E27` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[26].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[27].element_id` | required_in_parent · `const "E28"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[27].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[27].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[27].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[27].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[27].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[27].payload` | required_in_parent · `ElementPayload_E28` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[27].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[28].element_id` | required_in_parent · `const "E29"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[28].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[28].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[28].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[28].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[28].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[28].payload` | required_in_parent · `ElementPayload_E29` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[28].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[29].element_id` | required_in_parent · `const "E30"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[29].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[29].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[29].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[29].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[29].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[29].payload` | required_in_parent · `ElementPayload_E30` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[29].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[30].element_id` | required_in_parent · `const "E31"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[30].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[30].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[30].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[30].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[30].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[30].payload` | required_in_parent · `ElementPayload_E31` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[30].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[31].element_id` | required_in_parent · `const "E32"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[31].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[31].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[31].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[31].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[31].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[31].payload` | required_in_parent · `ElementPayload_E32` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[31].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[32].element_id` | required_in_parent · `const "E33"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[32].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[32].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[32].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[32].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[32].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[32].payload` | required_in_parent · `ElementPayload_E33` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[32].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[33].element_id` | required_in_parent · `const "E34"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[33].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[33].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[33].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[33].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[33].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[33].payload` | required_in_parent · `ElementPayload_E34` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[33].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[34].element_id` | required_in_parent · `const "E35"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[34].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[34].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[34].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[34].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[34].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[34].payload` | required_in_parent · `ElementPayload_E35` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[34].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[35].element_id` | required_in_parent · `const "E36"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[35].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[35].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[35].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[35].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[35].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[35].payload` | required_in_parent · `ElementPayload_E36` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[35].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |

| `NovelElement/oneOf[36].element_id` | required_in_parent · `const "E37"` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `NovelElement/oneOf[36].level` | required_in_parent · `enum(work, volume, chapter, scene)` | 要素当前作用的结构层级work/volume/chapter/scene，不限制其只能在默认层级出现。 |

| `NovelElement/oneOf[36].plane` | required_in_parent · `enum(design, realization, progress)` | 设计态/实现态/进度态之一，保持项目三态区分。 |

| `NovelElement/oneOf[36].authority` | required_in_parent · `enum(canon, tentative, design, derived, reference_only)` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `NovelElement/oneOf[36].subject_refs` | required_in_parent · `array<string>` | 该小说要素描述的真实作品/人物/场景对象，不等于其证据来源。 |

| `NovelElement/oneOf[36].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `NovelElement/oneOf[36].payload` | required_in_parent · `ElementPayload_E37` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `NovelElement/oneOf[36].discrepancy` | optional_or_conditional · `string` | 单项不一致描述，必须绑定对应设计和实际来源。 |



## SceneUnit

owner: `application`；来源：`ProseExecutionBrief/VS-00E §1；mode 枚举细化为提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `SceneUnit.unit_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `SceneUnit.scene_title` | optional_or_conditional · `string` | 面向作者的场名；内部unit_id仍独立承担身份。 |

| `SceneUnit.scene_mode` | required_in_parent · `enum(action, reaction, deliberate_pause)` | 当前场景行动/承接/缓冲等模式，不要求所有场都有大反转。 |

| `SceneUnit.target_change` | required_in_parent · `object` | 场景必须造成的认知/关系/目标/局势变化；允许解释明确的缓冲场。 |

| `SceneUnit.target_change.type` | required_in_parent · `string` | 所属判别结构的类型，例如block/event/变化种类，不能用自由字符串逃避Schema。 |

| `SceneUnit.target_change.description` | required_in_parent · `string` | 当前对象的可读说明；不作为唯一权限、身份或版本证据。 |

| `SceneUnit.causal_spine` | optional_or_conditional · `object` | 场景的目标、阻力/困境、转折、后果，作为写前设计而非已发生剧情。 |

| `SceneUnit.causal_spine.goal` | required_in_parent · `string` | 当前任务目标文本、来源与版本；作者引导改变目标必须升版本。 |

| `SceneUnit.causal_spine.opposition_or_dilemma` | required_in_parent · `string` | 阻碍场景目标的外部阻力或承接场困境。 |

| `SceneUnit.causal_spine.turn` | required_in_parent · `string` | 情绪或因果转折，所在Scene设计中的状态转变，不是会话turn_id。 |

| `SceneUnit.causal_spine.consequence` | required_in_parent · `string` | 场景转折导致的具体后果，属于设计意图，写后要按正文对账。 |

| `SceneUnit.character_agendas` | required_in_parent · `array<object>` | 当前场景各人物的目标和隐瞒信息，不自动等同人物长期设定。 |

| `SceneUnit.character_agendas[].character_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `SceneUnit.character_agendas[].wants` | required_in_parent · `string` | 人物在本场具体追求的目标，是对白/冲突动力。 |

| `SceneUnit.character_agendas[].hides` | required_in_parent · `string` | 当前人物在本场隐瞒的内容，属于明确设计/证据，不是模型任意猜心理。 |

| `SceneUnit.information_delta` | required_in_parent · `object` | 本场读者/主角新知道什么、仍隐藏什么的设计差异。 |

| `SceneUnit.information_delta.reader_learns` | required_in_parent · `array<string>` | 读者在本场获得的信息，可能与角色知识不同。 |

| `SceneUnit.information_delta.protagonist_learns` | required_in_parent · `array<string>` | 主角在当前场景新获知的信息，不能与读者知道的信息混同。 |

| `SceneUnit.information_delta.remains_hidden` | required_in_parent · `array<string>` | 本场仍不应揭露的信息，属于设计限制，不代表人物事实已知。 |

| `SceneUnit.emotion_transition` | required_in_parent · `object` | 场景情绪从起点经压力/转折到终点和余波的状态迁移。 |

| `SceneUnit.emotion_transition.start` | required_in_parent · `string` | 情绪起点的可读状态，或所在区间的起点；具体类型由父对象限定。 |

| `SceneUnit.emotion_transition.pressures` | required_in_parent · `array<string>` | 从情绪起点向转折累积的具体压力事件/观察，而非数值强度。 |

| `SceneUnit.emotion_transition.turn` | required_in_parent · `string` | 情绪或因果转折，所在Scene设计中的状态转变，不是会话turn_id。 |

| `SceneUnit.emotion_transition.end` | required_in_parent · `string` | 情绪终点状态文本，或所在类型定义的终点；不是数值情绪分。 |

| `SceneUnit.emotion_transition.residue` | required_in_parent · `string` | 场景结束后仍保留并影响下一场的情绪余波。 |

| `SceneUnit.emotion_transition.empty_pressures_reason` | optional_or_conditional · `string` | 情绪压力列表为空时的真实说明；允许功能明确的缓冲场，不强制反转。 |

| `SceneUnit.dialogue_intent` | required_in_parent · `object` | 场景对白的表层话题、隐含冲突和表达模式；不是所有对白都强制潜台词。 |

| `SceneUnit.dialogue_intent.mode` | required_in_parent · `enum(direct, subtext, none)` | 所属对象的合法模式：授权模式、输出方式或对白模式各遵循所在类型枚举。 |

| `SceneUnit.dialogue_intent.surface_topic` | required_in_parent · `string` | 人物对白表面上谈什么，与隐藏冲突分开。 |

| `SceneUnit.dialogue_intent.hidden_conflict` | required_in_parent · `string` | 对白未直说的冲突设计；不能自动当作角色已知事实。 |

| `SceneUnit.sensory_anchor` | required_in_parent · `array<string>` | 与本场真实行动/情绪相关的感官细节设计，不为凑描写堆砌环境。 |

| `SceneUnit.degraded` | required_in_parent · `boolean` | 该设计单元因信息缺失而明确降级；不能补造内容后伪装完整。 |

| `SceneUnit.degraded_reason` | optional_or_conditional · `string` | 降级的真实原因，与缺失字段/证据对应。 |



## ExecutionBrief

owner: `application`；来源：`ProseExecutionBrief；authority 明确化为设计`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ExecutionBrief.brief_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionBrief.brief_version` | required_in_parent · `const "prose_execution_v1"` | 设计执行简述的结构版本；不是作品Canon版本。 |

| `ExecutionBrief.authority` | required_in_parent · `const "design"` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `ExecutionBrief.anchor` | required_in_parent · `Coordinate` | 写作设计绑定的作品/章/场坐标；设计目标不是已发生事实。 |

| `ExecutionBrief.chapter_context` | required_in_parent · `object` | 本章功能、节奏和读者效果等写作设计上下文。 |

| `ExecutionBrief.chapter_context.chapter_role` | required_in_parent · `string` | 执行简述中的章节功能定位，用于指导场景组织。 |

| `ExecutionBrief.chapter_context.pacing_mode` | required_in_parent · `string` | 本章/场应采取的节奏设计，不能所有场景机械紧凑或高潮。 |

| `ExecutionBrief.chapter_context.reader_effect_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ExecutionBrief.scene_units` | required_in_parent · `array<SceneUnit>` | 逐场的执行设计集合，须与实际章节目标相容，不是已写正文事实。 |

| `ExecutionBrief.source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |



## StyleContext

owner: `application`；来源：`domain/23-style-and-author-intent；Issue#3`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `StyleContext.current_brief_refs` | required_in_parent · `array<string>` | 本轮作者明确创作要求/局部brief引用，应优先于旧风格样本。 |

| `StyleContext.confirmed_preference_refs` | required_in_parent · `array<string>` | 作者已经确认的偏好引用；样本中的风格不能自动加入该集合。 |

| `StyleContext.sample_material_refs` | required_in_parent · `array<string>` | 被当作文风样本的真实材料引用，样本不自动提升为长期偏好。 |

| `StyleContext.local_feedback_refs` | required_in_parent · `array<string>` | 当前局部反馈来源；不自动成为作者长期偏好。 |

| `StyleContext.precedence` | required_in_parent · `const "current_explicit_constraints_then_confirmed_work_preferences_then_samples"` | 当前作者要求、已确认约束和旧样本之间的优先关系。 |

| `StyleContext.conflict_policy` | required_in_parent · `const "surface_conflict_do_not_silently_rewrite_canon"` | 当前意图、canon、设计和历史样本冲突时的明确处理策略，不是默认覆盖。 |



## LiteraryContext

owner: `application`；来源：`现有要素/ReaderEffectBrief/ProseExecutionBrief 的非持久投影视图`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `LiteraryContext.coordinate` | required_in_parent · `Coordinate` | 当前写作目标坐标，包括作品/卷/章/场和视角/时间信息。 |

| `LiteraryContext.elements` | required_in_parent · `array<NovelElement>` | 本轮确需提供的小说要素片段，不要求每次列全37项。 |

| `LiteraryContext.execution_brief` | optional_or_conditional · `ExecutionBrief` | ProseExecutionBrief设计态材料，不直接写入canon。 |

| `LiteraryContext.style` | optional_or_conditional · `StyleContext` | 作者当前表达要求、已确认偏好和参考样本的有界组合。 |

| `LiteraryContext.reader_effect_targets` | optional_or_conditional · `array<string>` | 章/场的读者期待与情绪/悬念目标，写后须独立评估。 |

| `LiteraryContext.quality_targets` | optional_or_conditional · `array<string>` | 当前明确评审/写作目标，不能把通用指标当已达到的事实。 |

| `LiteraryContext.intentionally_unplanned` | optional_or_conditional · `array<string>` | 哪些创作细节有意留白，不要把留白错误补成canon。 |



## ChapterIndexPayload

owner: `application`；来源：`ChapterListBudget/ReadingProjection；不以标题推断对象类型`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ChapterIndexPayload.kind` | required_in_parent · `const "chapter_index"` | 判别分支；不得与作者最终意图分类混同。 |

| `ChapterIndexPayload.chapter_slots_total` | required_in_parent · `integer` | 当前结构记录总数；可能包含没有已采纳正文的错误或规划记录。 |

| `ChapterIndexPayload.chapters_with_accepted_prose` | required_in_parent · `integer` | 真实已有已采纳正文的章节数，不从结构行数推算。 |

| `ChapterIndexPayload.items` | required_in_parent · `array<object>` | 专业工具候选条目列表；按当前artifact_type验证具体领域形状。 |

| `ChapterIndexPayload.items[].chapter_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ChapterIndexPayload.items[].display_number` | required_in_parent · `integer` | 面向作者的章序号；不能代替内部稳定chapter_ref身份。 |

| `ChapterIndexPayload.items[].title` | required_in_parent · `string` | 候选/记录面向作者的标题；不承担稳定身份，不能混入内部ID。 |

| `ChapterIndexPayload.items[].record_kind` | required_in_parent · `enum(chapter, volume_outline_record, unknown)` | 原始历史fixture记录是消息、Scope还是回合，决定覆盖核查方式。 |

| `ChapterIndexPayload.items[].has_accepted_prose` | required_in_parent · `boolean` | 本章是否确有已采纳正文；没有正文与质量未过门不是同一情况。 |

| `ChapterIndexPayload.items[].visible_in_reading` | required_in_parent · `boolean` | 当前阅读投影是否确实显示该结构记录；期望隐藏不能写入此事实。 |

| `ChapterIndexPayload.items[].prose_revision` | optional_or_conditional · `integer` | 质量建议的拟修订内容或范围，不等于已实际改稿。 |



## TextPayload

owner: `application`；来源：`正文/素材/原文；byte 区间只用于原字节，不能当 grapheme 段号`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `TextPayload.kind` | required_in_parent · `const "text"` | 判别分支；不得与作者最终意图分类混同。 |

| `TextPayload.text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `TextPayload.sha256` | required_in_parent · `string` | 对应字符串UTF-8原字节哈希；不是原始JSON网络文本hash。 |

| `TextPayload.encoding` | required_in_parent · `const "utf-8"` | 正文字节解释方式；本包统一utf-8用于hash与offset。 |

| `TextPayload.segments` | optional_or_conditional · `array<object>` | 实际绑定原文的稳定段ID、原字节、hash和范围，修订不能凭段序号猜另一个版本。 |

| `TextPayload.segments[].segment_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `TextPayload.segments[].text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `TextPayload.segments[].sha256` | required_in_parent · `string` | 对应字符串UTF-8原字节哈希；不是原始JSON网络文本hash。 |

| `TextPayload.segments[].start_byte` | required_in_parent · `integer` | UTF-8原字节左闭区间起点；必须与segment原文精确一致。 |

| `TextPayload.segments[].end_byte_exclusive` | required_in_parent · `integer` | UTF-8片段右开区间终点，与start_byte共同定位精确原文。 |

| `TextPayload.line_break_boundaries` | optional_or_conditional · `array<object>` | 系统按绑定原版公开的合法排版边界，不允许模型自造。 |

| `TextPayload.line_break_boundaries[].boundary_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `TextPayload.line_break_boundaries[].byte_offset` | required_in_parent · `integer` | UTF-8字节坐标；不能按Unicode字符位置直接代替。 |

| `TextPayload.line_break_boundaries[].current_lines` | required_in_parent · `integer` | 绑定原文边界当前换行数量，用于验证format_only计划是否真正产生变化。 |



## EntityPayload

owner: `application`；来源：`Archive/Memory/WorkProfile；fields 为已命名事实非任意 metadata`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `EntityPayload.kind` | required_in_parent · `const "entity_records"` | 判别分支；不得与作者最终意图分类混同。 |

| `EntityPayload.records` | required_in_parent · `array<object>` | 当前实际读取的实体记录列表，空需结合覆盖状态解释。 |

| `EntityPayload.records[].ref` | required_in_parent · `string` | 稳定对象或来源身份；不得凭标题猜造。 |

| `EntityPayload.records[].entity_kind` | required_in_parent · `enum(character, world_rule, work_profile, memory, volume_outline, chapter_plan, ledger_entry)` | 记录属于角色/设定/档案等哪一领域类别，不能仅凭标题猜分类。 |

| `EntityPayload.records[].title` | required_in_parent · `string` | 候选/记录面向作者的标题；不承担稳定身份，不能混入内部ID。 |

| `EntityPayload.records[].body` | required_in_parent · `string` | 模型候选正文；不是已采纳事实。 |

| `EntityPayload.records[].fields` | optional_or_conditional · `array<object>` | 实体记录中有来源的命名字段集合；额外领域规则仍须实际契约验证。 |

| `EntityPayload.records[].fields[].name` | required_in_parent · `string` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `EntityPayload.records[].fields[].value` | required_in_parent · `string \| number \| boolean \| null` | 字段的真实值或作者选项值，类型受父字段Schema和领域规则限制。 |

| `EntityPayload.records[].fields[].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |



## AssetPayload

owner: `application`；来源：`Issue#3 proposed 作者资产；不宣称现有全局库`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `AssetPayload.kind` | required_in_parent · `const "author_asset"` | 判别分支；不得与作者最终意图分类混同。 |

| `AssetPayload.source_owner_kind` | required_in_parent · `enum(author_original, third_party, unknown)` | 素材原始作者/引用归属类型，不从上传者身份自动推断原创归属。 |

| `AssetPayload.text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `AssetPayload.sha256` | required_in_parent · `string` | 对应字符串UTF-8原字节哈希；不是原始JSON网络文本hash。 |

| `AssetPayload.allowed_uses` | required_in_parent · `array<enum(inspiration, style_reference, quote, adaptation)>` | 作者素材明确允许的用途，例如灵感、风格参考或逐字引用；不自动授权转为canon。 |

| `AssetPayload.work_link_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AssetPayload.enabled` | required_in_parent · `boolean` | 素材是否在作者当前授权下启用；停用后不能继续作为可读材料。 |

| `AssetPayload.not_canon` | required_in_parent · `const true` | 明确此素材/设计输出不是权威故事事实，不能靠模型自报变成canon。 |

| `AssetPayload.attribution` | optional_or_conditional · `string` | 原素材/第三方引用的归属说明；保留权利与用途约束，不冒认作者本人表达。 |

| `AssetPayload.linked_work_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |



## CatalogPayload

owner: `application`；来源：`CapabilityRegistry 只读结果；非新数据库`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `CatalogPayload.kind` | required_in_parent · `const "capability_catalog"` | 判别分支；不得与作者最终意图分类混同。 |

| `CatalogPayload.revision` | required_in_parent · `string` | 当前授权/委托/设计记录自身版本，不等于Canon全局版本。 |

| `CatalogPayload.complete_for_scope` | required_in_parent · `boolean` | 能力目录或查询结果在声明作用域内是否完整；不代表整个系统全局完整。 |

| `CatalogPayload.operations` | required_in_parent · `array<object>` | 当前目录查询实际返回的能力及效果集合，包含覆盖边界。 |

| `CatalogPayload.operations[].name` | required_in_parent · `string` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `CatalogPayload.operations[].effects` | required_in_parent · `array<string>` | 目录声明的真实可实现效果集合；不能把‘近似能做’描述为完全相同效果。 |

| `CatalogPayload.operations[].availability` | required_in_parent · `enum(available, disabled, not_authorized, unsupported)` | 素材/风格/读侧的可用状态；与作品是否实际存在相区分。 |

| `CatalogPayload.operations[].limits` | required_in_parent · `array<string>` | 设定/能力/风格约束的明确边界，不能只描述收益不描述限制。 |



## Payload

owner: `application`；来源：`VS-00M`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

该定义由引用/判别联合组成，字段见具体分支定义。



## Material

owner: `application`；来源：`Context refs + AuthoringTask materials；本形态为请求视图，不存第二份内容`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Material.material_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Material.origin` | required_in_parent · `enum(application_base, tool_observation, author_supplied)` | 当前材料是Base、tool observation等哪种来源。 |

| `Material.source` | required_in_parent · `Source` | 有类型、权威、信任和可选版本的真实来源，不是自由来源说明字符串。 |

| `Material.coverage` | required_in_parent · `Coverage` | 材料真实覆盖，不是预计读取范围。 |

| `Material.payload` | required_in_parent · `Payload` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `Material.tool_call_id` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Material.observation_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Material.available_for` | required_in_parent · `array<enum(judgment, planning, writing, revision, quality, maintenance, narration)>` | 当前材料准许参与哪些任务用途；权限与可用性不能当成已被模型读取/使用。 |



## Context

owner: `application`；来源：`DialogueContext / Scope；当前运行投影，不持久独立真源`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Context.snapshot_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Context.work_ref` | optional_or_conditional · `string` | 作品作用域，跨作品前必须有明确合法授权。 |

| `Context.work_revision` | optional_or_conditional · `integer` | 当前作品权威投影的真实版本，不能用scope/goal版本替代。 |

| `Context.scope_revision` | required_in_parent · `integer` | 当前权限/上下文范围快照版本，不可代替作品或目标版本。 |

| `Context.materials` | required_in_parent · `array<Material>` | 实际进入本请求或tool结果的数据条目；可访问但未读不得列为已供给。 |

| `Context.omissions` | required_in_parent · `array<Omission>` | 没提供/没读到/已压缩内容及原因和补读途径。 |

| `Context.literary` | optional_or_conditional · `LiteraryContext` | 本轮需要的小说要素、设计简述、风格与质量目标，不是常态全量档案。 |

| `Context.pending_obligations` | required_in_parent · `array<object>` | 已有作者诉求/未决问题的明确义务，不因Checkpoint丢失。 |

| `Context.pending_obligations[].obligation_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Context.pending_obligations[].source_ref` | required_in_parent · `string` | 已存在的来源引用，不能只用解释性文字代替。 |

| `Context.pending_obligations[].description` | required_in_parent · `string` | 当前对象的可读说明；不作为唯一权限、身份或版本证据。 |

| `Context.pending_obligations[].state` | required_in_parent · `enum(open, awaiting_author, in_progress)` | 该对象的局部状态，例如执行、义务或操作，不可跨状态机随意同义替换。 |

| `Context.counts` | optional_or_conditional · `array<Count>` | 带计量方法和来源的统计项；字符、有效字、英文词与Token不能混用。 |

| `Context.registerable_author_source_refs` | optional_or_conditional · `array<string>` | 经真实作者内容语义与来源审核可登记的原文消息集合，非按“保存”等关键词猜测。 |



## Budget

owner: `application`；来源：`AgentRunPolicy + provider execution limits`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Budget.provider_calls_remaining` | required_in_parent · `integer` | 本run剩余模型调用数；纠错/重试也占预算。 |

| `Budget.tool_calls_remaining` | required_in_parent · `integer` | 当前实际剩余工具调用额度；每次执行及重试按规则扣减。 |

| `Budget.retries_remaining` | required_in_parent · `integer` | 当前纠错/重试尚余预算，不因失败自动重置。 |

| `Budget.output_tokens_limit` | required_in_parent · `integer` | 本轮剩余的输出预算约束，不是实际消耗。 |

| `Budget.context_tokens_limit` | required_in_parent · `integer \| null` | 已解析Provider/模型的真实上下文限制；未知用null，不凭模型名猜数。 |

| `Budget.deadline_at` | required_in_parent · `string \| null` | 实际截止时间，未知/无显式deadline为null；不得无限延长重试。 |



## Delegation

owner: `application`；来源：`VS-00M 提案；现有 authority/receipt 归属审计未完`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Delegation.delegation_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Delegation.issuer_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Delegation.source_author_action_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Delegation.work_ref` | required_in_parent · `string` | 作品作用域，跨作品前必须有明确合法授权。 |

| `Delegation.allowed_capabilities` | required_in_parent · `array<string>` | 委托明确涵盖的真实业务能力集合，不意味着所有这些能力当前都可执行。 |

| `Delegation.allowed_effects` | required_in_parent · `array<string>` | 本层允许的真实业务效果；model suggestion != execution permission。 |

| `Delegation.target_refs` | required_in_parent · `array<string>` | 当前动作真实目标。作者选择artifact时，需经系统候选绑定映射到实际被修改对象。 |

| `Delegation.revision` | required_in_parent · `integer` | 当前授权/委托/设计记录自身版本，不等于Canon全局版本。 |

| `Delegation.valid_from` | required_in_parent · `string` | UTC/带时区 ISO-8601 时间，不用本地无时区时间 |

| `Delegation.expires_at` | required_in_parent · `string` | UTC/带时区 ISO-8601 时间，不用本地无时区时间 |

| `Delegation.revoked` | required_in_parent · `boolean` | 委托是否已撤销；写前必须重新取实际状态，不能只信请求旧快照。 |

| `Delegation.may_adopt` | required_in_parent · `boolean` | 该有效委托是否明确允许采纳，不因允许生成候选而自动为true。 |

| `Delegation.can_rollback` | required_in_parent · `boolean` | 此委托/操作是否具有已实现的回滚能力；不是模型对风险的主观承诺。 |

| `Delegation.mode_scope` | required_in_parent · `enum(run, session, work, global)` | 委托/模式生效层级，不能当成无限跨作品授权。 |



## Authority

owner: `application`；来源：`AgentRun/Policy/VS-00M；模式与委托是目标设计，非已实现承诺`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Authority.model_action_authority` | required_in_parent · `const "suggest_only"` | 模型只有suggest_only建议权，实际权限由系统裁决。 |

| `Authority.model_can_adopt` | required_in_parent · `const false` | 模型不得自行采纳，固定false。 |

| `Authority.candidate_default_status` | required_in_parent · `const "TENTATIVE"` | 新创作产物初始状态，固定TENTATIVE，不代表会自动写Canon。 |

| `Authority.policy_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Authority.policy_revision` | required_in_parent · `integer` | 权限/风险策略当时实际版本，可审计回放。 |

| `Authority.mode` | required_in_parent · `enum(manual, risk_based, full, smart)` | 所属对象的合法模式：授权模式、输出方式或对白模式各遵循所在类型枚举。 |

| `Authority.mode_maturity` | required_in_parent · `enum(current_snapshot, target_design_fixture)` | 声明授权模式形状是当前事实还是目标设计fixture。 |

| `Authority.mode_source` | required_in_parent · `object` | 有效模式来自哪一层真实用户设置及引用。 |

| `Authority.mode_source.scope` | required_in_parent · `enum(run, session, work, global)` | 目标对象、覆盖、基线与修改边界，不能用泛泛目标文字替代。 |

| `Authority.mode_source.ref` | required_in_parent · `string` | 稳定对象或来源身份；不得凭标题猜造。 |

| `Authority.work_scope_refs` | required_in_parent · `array<string>` | 当前权限允许的作品范围，默认不能从某作品升级成全作者数据。 |

| `Authority.allowed_effects` | required_in_parent · `array<string>` | 本层允许的真实业务效果；model suggestion != execution permission。 |

| `Authority.delegation` | optional_or_conditional · `Delegation` | 由作者签发的作用域委托事实快照；有mode=full不等于已存在合法委托。 |

| `Authority.budget` | required_in_parent · `Budget` | 当前run/调用剩余可用资源的快照；真正扣减仍在应用执行边界。 |

| `Authority.hard_denials` | required_in_parent · `array<enum(cross_work_without_grant, stale_base, unregistered_effect, expired_delegation, model_self_authorization)>` | 所有授权模式均不可绕过的硬拒绝条件。 |



## ToolDefinition

owner: `application`；来源：`JudgmentToolContract/AgentPlanToolContract/NativeToolExchange`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolDefinition.name` | required_in_parent · `string` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolDefinition.description` | required_in_parent · `string` | 当前对象的可读说明；不作为唯一权限、身份或版本证据。 |

| `ToolDefinition.input_schema` | required_in_parent · `object` | 实际原生工具Schema；生产从现有注册表导出，不从文件镜像创建第二真源。 |

| `ToolDefinition.schema_source_ref` | required_in_parent · `string` | 工具Schema现有真源文件/注册位置，生产必须从该注册源导出。 |

| `ToolDefinition.schema_version` | required_in_parent · `string` | 此对象/工具/设计包自己的版本，不可拿它证明作品事实新鲜。 |



## Capabilities

owner: `application`；来源：`现有业务 registry 与 Agent 原生工具目录；二者不同`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Capabilities.catalog_revision` | required_in_parent · `string` | 本次能力目录快照版本；不能从旧目录推定当前能力。 |

| `Capabilities.inventory_coverage` | required_in_parent · `enum(complete_for_profile, selected_subset)` | 当前目录是profile范围完整还是selected_subset，决定缺口结论的证据边界。 |

| `Capabilities.business_operations` | required_in_parent · `array<object>` | 当前公布的业务能力、effect与目标限制，不等于Provider函数列表。 |

| `Capabilities.business_operations[].name` | required_in_parent · `string` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `Capabilities.business_operations[].allowed_effects` | required_in_parent · `array<string>` | 本层允许的真实业务效果；model suggestion != execution permission。 |

| `Capabilities.business_operations[].target_kinds` | required_in_parent · `array<string>` | 能力实际支持的对象类别集合，不代表自动授权这些对象。 |

| `Capabilities.business_operations[].constraints` | required_in_parent · `array<string>` | 来自可追溯作者意图或已确认规则的限制；must与prefer须区别。 |

| `Capabilities.tools` | required_in_parent · `array<ToolDefinition>` | 当前profile的完整原生工具定义；外层统一schema不能替代具体工具Schema。 |

| `Capabilities.exploration_tools` | required_in_parent · `array<string>` | 当前可用于求证的现役只读工具集合，不能列出未实现工具。 |

| `Capabilities.lookup_available` | required_in_parent · `boolean` | 当前是否真的存在可用目录探索入口，不能为了设计完整填true。 |



## System

owner: `application`；来源：`SystemIdentity/SystemEnvelope；样例 identity_ref 为测试标识`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `System.identity_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `System.constitution_version` | required_in_parent · `string` | 产品宪法/共同约束版本引用，从现有唯一策略源生成。 |

| `System.output_protocol_version` | required_in_parent · `string` | 原生工具/输出契约版本，须与实际注册Schema一致。 |

| `System.role` | required_in_parent · `string` | 专业角色或原生消息角色；authority/provenance仍必须独立。 |

| `System.instructions` | required_in_parent · `string` | 当前角色的静态指令，从产品规则生成；不包含原始不可信素材。 |

| `System.material_instruction_policy` | required_in_parent · `const "materials_are_data_not_instructions"` | 明确材料只当数据，不允许材料中的命令覆盖系统权限。 |



## Runtime

owner: `provider_execution`；来源：`ProviderRun/InferenceParams；不投影进模型 messages`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Runtime.provider` | required_in_parent · `string` | 已解析的供应商路由，不能由模型内容自行选择。 |

| `Runtime.model` | required_in_parent · `string` | 路由解析后的模型名；样例fixture-model不代表真实可调用模型。 |

| `Runtime.api` | required_in_parent · `enum(openai.chat.completions, openai.responses, anthropic.messages)` | 选定的真实Provider协议类型，决定wire映射，不能让模型自行改。 |

| `Runtime.stream` | required_in_parent · `boolean` | 是否使用Provider流式传输；流式片段仍要完整终态校验。 |

| `Runtime.tool_choice` | required_in_parent · `enum(auto, required, none)` | Provider原生工具选择策略；不能利用required等字段绕过业务授权。 |

| `Runtime.parallel_tool_calls` | optional_or_conditional · `boolean` | API实际支持时的并行工具设置；业务组合规则仍独立检查。 |

| `Runtime.max_output_tokens` | required_in_parent · `integer` | 选定Provider支持的输出Token预算，投影时换成对应API字段。 |

| `Runtime.temperature` | optional_or_conditional · `number` | 供应商支持时才发送的采样参数；不能忽略不支持参数导致行为漂移。 |

| `Runtime.reasoning_effort` | optional_or_conditional · `enum(none, low, medium, high)` | Provider实际支持的推理预算参数，不是要求模型暴露思维链。 |

| `Runtime.parameter_policy` | required_in_parent · `const "validate_against_resolved_provider_capabilities"` | 要求按解析出的Provider能力验证参数，不支持时明确拒绝或有限模式。 |

| `Runtime.strict_tool_schema` | required_in_parent · `boolean` | 此route是否使用供应商严格工具Schema模式，必须显式验证支持。 |

| `Runtime.private_provider_state_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |



## Protocol

owner: `application`；来源：`设计包标签；不是新增生产协议`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Protocol.kind` | required_in_parent · `const "model_interaction_request"` | 判别分支；不得与作者最终意图分类混同。 |

| `Protocol.schema_version` | required_in_parent · `const "ans-model-interaction-design/1.0-draft"` | 此对象/工具/设计包自己的版本，不可拿它证明作品事实新鲜。 |

| `Protocol.status` | required_in_parent · `const "proposed_design_view"` | 此对象自身生命周期状态，不是所有层共用的成功状态。 |

| `Protocol.canonical_contract` | required_in_parent · `const "authoring-request-ir/v1"` | 本审阅视图拟映射的现役Canonical契约标识；不意味着本对象可直接被其parser接受。 |

| `Protocol.source_commit` | required_in_parent · `const "f13ff6406a002eff54397b906872255048c31763"` | 本次审阅所固定的仓库commit，避免把活动分支后续变更混进证据。 |



## ToolArgs_judgment_decision

owner: `model`；来源：`apps/novel_application/lib/novel_application/judgment_tool_contract.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_judgment_decision.action` | required_in_parent · `enum(execute, plan, explore)` | 当前判别联合的动作：作者动作、Agent提议或计划步骤各有自己的枚举，不可跨父类型复用。 |

| `ToolArgs_judgment_decision.adopted_content_ref` | optional_or_conditional · `string \| null` | 本次已实际公开或读取的已采纳内容身份；不能填待采纳候选身份。 |

| `ToolArgs_judgment_decision.capability` | optional_or_conditional · `string \| null` | 仅 execute 时提供；plan/explore 时省略或为 null。 |

| `ToolArgs_judgment_decision.character_ref` | optional_or_conditional · `string \| null` | 仅 revise_character_profile 时提供：从「角色索引」原样复制 character_ref（身份），不得猜。 |

| `ToolArgs_judgment_decision.dialogue_goal` | required_in_parent · `string` | 模型本次提议要达成的作者目标摘要；不能改变原目标/作用范围。 |

| `ToolArgs_judgment_decision.explore_request` | optional_or_conditional · `object \| null` | judgment explore的真实只读请求；不能同时带执行capability/修改目标。 |

| `ToolArgs_judgment_decision.explore_request/anyOf[0].query` | required_in_parent · `string` | 只读检索条件；字符串还是JSON字符串由现役工具契约决定。 |

| `ToolArgs_judgment_decision.explore_request/anyOf[0].tool` | required_in_parent · `string` | explore_request实际选择的已存在只读工具名。 |

| `ToolArgs_judgment_decision.pending_artifact_ref` | optional_or_conditional · `string \| null` | 真正待采纳候选身份，不能与已采纳正文目标混用。 |

| `ToolArgs_judgment_decision.reason` | required_in_parent · `string` | 供用户理解的简短依据，不要求私有思维链。 |

| `ToolArgs_judgment_decision.target_segment_ids` | optional_or_conditional · `array<string>` | 本次允许替换的真实已读段ID集合，不得自造或跨基线复制。 |



## ToolArgs_ask_author

owner: `model`；来源：`apps/novel_application/lib/novel_application/judgment_tool_contract.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_ask_author.options` | required_in_parent · `array<object>` | 作者明确选择项；可空/自由回答遵循对应工具契约，不替作者预选。 |

| `ToolArgs_ask_author.options[].kind` | optional_or_conditional · `enum(choice, free_text)` | 判别分支；不得与作者最终意图分类混同。 |

| `ToolArgs_ask_author.options[].label` | required_in_parent · `string` | 作者可见选项名称，不能夹内部ID充当可辨识对象。 |

| `ToolArgs_ask_author.options[].recommended` | optional_or_conditional · `boolean` | 模型推荐的选项标签，不等于作者已经选择。 |

| `ToolArgs_ask_author.options[].value` | required_in_parent · `string` | 字段的真实值或作者选项值，类型受父字段Schema和领域规则限制。 |

| `ToolArgs_ask_author.question` | required_in_parent · `string` | 模型面向作者的具体问题，必须能让作者裁决真正缺失的信息/对象/范围。 |

| `ToolArgs_ask_author.reason_codes` | optional_or_conditional · `array<string>` | 当前判断涉及的登记原因码集合；不提升权限。 |



## ToolArgs_agent_plan_draft

owner: `model`；来源：`apps/novel_application/lib/novel_application/agent_plan_tool_contract.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_agent_plan_draft.author_reasoning` | required_in_parent · `string` | 模型面向作者的简短说明，必须可直接显示并保留字节来源。 |

| `ToolArgs_agent_plan_draft.confidence` | required_in_parent · `number` | 模型评估信心，不是机械安全保证。 |

| `ToolArgs_agent_plan_draft.plan` | required_in_parent · `object` | Agent建议的步骤结构，系统未Gate之前不构成执行授权。 |

| `ToolArgs_agent_plan_draft.plan.steps` | required_in_parent · `array<object>` | 计划建议的动作/探索步骤，真实执行仍逐步通过Gate。 |

| `ToolArgs_agent_plan_draft.plan.steps[].authoring_intent` | optional_or_conditional · `enum(none, continuation, rewrite) \| null` | 计划步骤中的写作模式提示；不是应用预先替模型判断作者真实意图。 |

| `ToolArgs_agent_plan_draft.plan.steps[].depends_on` | optional_or_conditional · `array<string>` | 计划步骤对其他step_id的依赖，必须存在且不能形成无解环。 |

| `ToolArgs_agent_plan_draft.plan.steps[].description` | required_in_parent · `string` | 当前对象的可读说明；不作为唯一权限、身份或版本证据。 |

| `ToolArgs_agent_plan_draft.plan.steps[].exploration_query` | optional_or_conditional · `string \| null` | 计划中的只读检索条件，真实执行后才有Observation。 |

| `ToolArgs_agent_plan_draft.plan.steps[].kind` | required_in_parent · `enum(explore, act)` | 判别分支；不得与作者最终意图分类混同。 |

| `ToolArgs_agent_plan_draft.plan.steps[].requested_chapter_raw` | optional_or_conditional · `string \| null` | 作者原始章节指代，保留原话以便定位/澄清，不替代稳定chapter_ref。 |

| `ToolArgs_agent_plan_draft.plan.steps[].risk_hint` | optional_or_conditional · `enum(low, medium, high)` | 模型对计划风险的非权威提示，不能替代系统风险派生。 |

| `ToolArgs_agent_plan_draft.plan.steps[].step_id` | required_in_parent · `string` | 计划中稳定步骤身份，用于依赖和进度，不是Provider工具call_id。 |

| `ToolArgs_agent_plan_draft.plan.steps[].success_criteria` | required_in_parent · `array<string>` | 计划步骤预计的完成判据；不是系统已验证通过的结果。 |

| `ToolArgs_agent_plan_draft.plan.steps[].target_chapter` | optional_or_conditional · `string \| null` | 模型/作者可读的章节指代；真实写入仍按chapter_ref绑定。 |

| `ToolArgs_agent_plan_draft.plan.steps[].target_chapter_ref` | optional_or_conditional · `string \| null` | 实际目标章节身份，修订与统计都不能靠标题同名猜测。 |

| `ToolArgs_agent_plan_draft.plan.steps[].target_tool_ref` | required_in_parent · `string` | 某计划步骤打算调用的真实工具引用，未过Gate不能执行。 |

| `ToolArgs_agent_plan_draft.plan.steps[].target_word_count` | optional_or_conditional · `integer \| null` | 作者/计划给出的目标长度；统计口径与字/词/Token必须明确。 |

| `ToolArgs_agent_plan_draft.plan.steps[].write_intent` | optional_or_conditional · `enum(none, tentative)` | 计划希望产生none/tentative等效果，不是已批准production write。 |

| `ToolArgs_agent_plan_draft.reason_codes` | required_in_parent · `array<string>` | 当前判断涉及的登记原因码集合；不提升权限。 |



## ToolArgs_register_author_content

owner: `model`；来源：`apps/novel_application/lib/novel_application/judgment_tool_contract.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_register_author_content.author_content_source_ref` | required_in_parent · `string` | 被登记的作者原文消息引用；不能指向保存指令、模型总结或未知来源。 |

| `ToolArgs_register_author_content.author_reasoning` | required_in_parent · `string` | 模型面向作者的简短说明，必须可直接显示并保留字节来源。 |

| `ToolArgs_register_author_content.dialogue_goal` | required_in_parent · `string` | 模型本次提议要达成的作者目标摘要；不能改变原目标/作用范围。 |



## ToolArgs_propose_creative_directions

owner: `model`；来源：`apps/novel_application/lib/novel_application/judgment_tool_contract.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_propose_creative_directions.author_reasoning` | required_in_parent · `string` | 模型面向作者的简短说明，必须可直接显示并保留字节来源。 |

| `ToolArgs_propose_creative_directions.candidate_directions` | required_in_parent · `array<object>` | 供作者选择的小说内容方向，不是保存/删除等管理菜单。 |

| `ToolArgs_propose_creative_directions.candidate_directions[].pitch` | required_in_parent · `string` | 候选小说方向的短提案，不是管理流程菜单。 |

| `ToolArgs_propose_creative_directions.candidate_directions[].title` | required_in_parent · `string` | 候选/记录面向作者的标题；不承担稳定身份，不能混入内部ID。 |

| `ToolArgs_propose_creative_directions.candidate_directions[].tone_tags` | optional_or_conditional · `array<string>` | 候选方向的语气/氛围标签，不能单凭标签判定实际文风合格。 |



## ToolArgs_propose_work_profile_revision

owner: `model`；来源：`apps/novel_application/lib/novel_application/judgment_tool_contract.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_propose_work_profile_revision.author_reasoning` | required_in_parent · `string` | 模型面向作者的简短说明，必须可直接显示并保留字节来源。 |

| `ToolArgs_propose_work_profile_revision.body` | required_in_parent · `string` | 模型候选正文；不是已采纳事实。 |

| `ToolArgs_propose_work_profile_revision.field` | required_in_parent · `enum(premise, theme, main_goal, core_selling_point, target_reader, tone_preference, target_length, planned_volumes, serial_form)` | 作品立项修订允许的明确字段名，不是自由JSON路径越权更新。 |

| `ToolArgs_propose_work_profile_revision.title` | required_in_parent · `string` | 候选/记录面向作者的标题；不承担稳定身份，不能混入内部ID。 |

| `ToolArgs_propose_work_profile_revision.value` | required_in_parent · `string \| integer` | 字段的真实值或作者选项值，类型受父字段Schema和领域规则限制。 |



## ToolArgs_report_capability_gap

owner: `model`；来源：`apps/novel_application/lib/novel_application/judgment_tool_contract.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_report_capability_gap.alternative_operation_refs` | optional_or_conditional · `array<string>` | 能力缺口说明中的真实替代操作ID；解释文字不得混入ID，近似操作不得冒充相同效果。 |

| `ToolArgs_report_capability_gap.author_reasoning` | required_in_parent · `string` | 模型面向作者的简短说明，必须可直接显示并保留字节来源。 |

| `ToolArgs_report_capability_gap.dialogue_goal` | required_in_parent · `string` | 模型本次提议要达成的作者目标摘要；不能改变原目标/作用范围。 |

| `ToolArgs_report_capability_gap.missing_effect` | required_in_parent · `string` | 缺失的明确业务效果，需要真实目录范围/观察或系统复核支持。 |



## ToolArgs_submit_tentative_artifact

owner: `model`；来源：`apps/novel_agent/lib/novel_agent/creative_provider/real.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_submit_tentative_artifact.items` | required_in_parent · `array<object>` | 专业工具候选条目列表；按当前artifact_type验证具体领域形状。 |

| `ToolArgs_submit_tentative_artifact.items[].item_id` | required_in_parent · `string` | 单次候选条目身份，后续由应用绑定真实artifact；不是让模型指定数据库主键。 |

| `ToolArgs_submit_tentative_artifact.items[].title` | required_in_parent · `string` | 候选/记录面向作者的标题；不承担稳定身份，不能混入内部ID。 |

| `ToolArgs_submit_tentative_artifact.items[].body` | required_in_parent · `string` | 模型候选正文；不是已采纳事实。 |

| `ToolArgs_submit_tentative_artifact.items[].rationale` | optional_or_conditional · `string \| null` | 候选修改或设计的公开依据，不是作品正文，也不是系统授权。 |

| `ToolArgs_submit_tentative_artifact.companion_artifacts` | optional_or_conditional · `array<object>` | 与本次正文同时提出的伴生产物；必须符合专业任务允许范围，仍是候选。 |

| `ToolArgs_submit_tentative_artifact.self_report` | optional_or_conditional · `object` | Writer对使用材料等的自报，须校验可见引用，不能视为客观使用成功或质量评分。 |

| `ToolArgs_submit_tentative_artifact.self_report.used_context_refs` | optional_or_conditional · `array<string>` | 模型声明此次真正使用的材料身份；Observation用观察ID，Base用公开材料引用。 |



## ToolArgs_report_quality_findings

owner: `model`；来源：`apps/novel_agent/lib/novel_agent/prose_quality_evaluator.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_report_quality_findings.findings` | required_in_parent · `array<object>` | 独立质量发现集合；空集合只有连同评审完成与覆盖才有意义。 |

| `ToolArgs_report_quality_findings.findings[].quality_finding_id` | required_in_parent · `string` | 单次发现稳定身份；validator类型不是finding身份。 |

| `ToolArgs_report_quality_findings.findings[].quality_gate_ref` | required_in_parent · `string` | 已登记质量门引用，不能给每个发现临时造顶级门。 |

| `ToolArgs_report_quality_findings.findings[].validator_ref` | required_in_parent · `string` | 已登记的质量检测规则身份；不能代替具体finding_id。 |

| `ToolArgs_report_quality_findings.findings[].summary` | required_in_parent · `string` | 有来源的可读摘要；不能替代需要全章/原句的证据，也不是新的Canon。 |

| `ToolArgs_report_quality_findings.findings[].reasoning` | required_in_parent · `string` | 可公开判断依据，独立于隐藏推理。 |

| `ToolArgs_report_quality_findings.findings[].evidence_spans` | required_in_parent · `array<object>` | 对应版本正文的真实原句与位置，供独立评审复核。 |

| `ToolArgs_report_quality_findings.findings[].evidence_spans[].text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `ToolArgs_report_quality_findings.findings[].evidence_spans[].sentence_start` | required_in_parent · `integer` | 证据原句起点编号；本包正例使用已有段落文本，不证明完整分句算法。 |

| `ToolArgs_report_quality_findings.findings[].evidence_spans[].sentence_end` | required_in_parent · `integer` | 证据原句终点编号，必须不小于起点并依实际分句算法核对。 |

| `ToolArgs_report_quality_findings.findings[].impact_scope` | required_in_parent · `enum(local, paragraph, chapter)` | 质量问题实际影响范围local/paragraph/chapter，区别建议修订范围。 |

| `ToolArgs_report_quality_findings.findings[].revision_scope` | required_in_parent · `enum(local, paragraph, chapter)` | 质量发现建议修改的local/paragraph/chapter范围，不能超出作者最终授权。 |

| `ToolArgs_report_quality_findings.findings[].confidence` | required_in_parent · `number` | 模型评估信心，不是机械安全保证。 |



## ToolArgs_continuation_decision

owner: `model`；来源：`apps/novel_application/lib/novel_application/judgment_tool_contract.ex`；成熟度：`source_mirror_with_descriptive_annotations`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolArgs_continuation_decision.action` | required_in_parent · `const "continue"` | 当前判别联合的动作：作者动作、Agent提议或计划步骤各有自己的枚举，不可跨父类型复用。 |

| `ToolArgs_continuation_decision.guidance` | required_in_parent · `string` | continuation或修订的具体继续建议，仍受原对象/范围/预算约束。 |

| `ToolArgs_continuation_decision.reason` | required_in_parent · `string` | 供用户理解的简短依据，不要求私有思维链。 |



## ToolCall

owner: `provider_adapter`；来源：`原生调用 parsed/arguments_raw；不是系统执行授权`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolCall/oneOf[0].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[0].name` | required_in_parent · `const "judgment_decision"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[0].arguments` | required_in_parent · `ToolArgs_judgment_decision` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[0].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |

| `ToolCall/oneOf[1].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[1].name` | required_in_parent · `const "ask_author"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[1].arguments` | required_in_parent · `ToolArgs_ask_author` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[1].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |

| `ToolCall/oneOf[2].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[2].name` | required_in_parent · `const "agent_plan_draft"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[2].arguments` | required_in_parent · `ToolArgs_agent_plan_draft` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[2].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |

| `ToolCall/oneOf[3].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[3].name` | required_in_parent · `const "register_author_content"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[3].arguments` | required_in_parent · `ToolArgs_register_author_content` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[3].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |

| `ToolCall/oneOf[4].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[4].name` | required_in_parent · `const "propose_creative_directions"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[4].arguments` | required_in_parent · `ToolArgs_propose_creative_directions` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[4].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |

| `ToolCall/oneOf[5].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[5].name` | required_in_parent · `const "propose_work_profile_revision"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[5].arguments` | required_in_parent · `ToolArgs_propose_work_profile_revision` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[5].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |

| `ToolCall/oneOf[6].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[6].name` | required_in_parent · `const "report_capability_gap"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[6].arguments` | required_in_parent · `ToolArgs_report_capability_gap` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[6].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |

| `ToolCall/oneOf[7].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[7].name` | required_in_parent · `const "submit_tentative_artifact"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[7].arguments` | required_in_parent · `ToolArgs_submit_tentative_artifact` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[7].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |

| `ToolCall/oneOf[8].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[8].name` | required_in_parent · `const "report_quality_findings"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[8].arguments` | required_in_parent · `ToolArgs_report_quality_findings` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[8].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |

| `ToolCall/oneOf[9].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolCall/oneOf[9].name` | required_in_parent · `const "continuation_decision"` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `ToolCall/oneOf[9].arguments` | required_in_parent · `ToolArgs_continuation_decision` | 完整解析后的工具参数，仍需schema/effect/ref和权限验证。 |

| `ToolCall/oneOf[9].arguments_raw` | optional_or_conditional · `string` | 原工具参数JSON字符串；不可静默修复后伪装原串。 |



## HistoryMessage

owner: `application`；来源：`现有 Canonical message 的设计视图；tool 内容用 material_ref 唯一展开`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `HistoryMessage/oneOf[0].message_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `HistoryMessage/oneOf[0].role` | required_in_parent · `const "user"` | 专业角色或原生消息角色；authority/provenance仍必须独立。 |

| `HistoryMessage/oneOf[0].provenance` | required_in_parent · `const "author"` | 消息真正来自作者、模型、应用还是工具结果；不能靠原生role推断。 |

| `HistoryMessage/oneOf[0].text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `HistoryMessage/oneOf[0].sha256` | required_in_parent · `string` | 对应字符串UTF-8原字节哈希；不是原始JSON网络文本hash。 |

| `HistoryMessage/oneOf[1].message_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `HistoryMessage/oneOf[1].role` | required_in_parent · `const "assistant"` | 专业角色或原生消息角色；authority/provenance仍必须独立。 |

| `HistoryMessage/oneOf[1].provenance` | required_in_parent · `const "model"` | 消息真正来自作者、模型、应用还是工具结果；不能靠原生role推断。 |

| `HistoryMessage/oneOf[1].content` | required_in_parent · `string \| null` | 模型文本或原生结果内容；系统不得伪造实际完成。 |

| `HistoryMessage/oneOf[1].tool_calls` | required_in_parent · `array<ToolCall>` | 模型原生工具调用集合；不接受正文里的伪XML作为执行调用。 |

| `HistoryMessage/oneOf[2].message_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `HistoryMessage/oneOf[2].role` | required_in_parent · `const "tool"` | 专业角色或原生消息角色；authority/provenance仍必须独立。 |

| `HistoryMessage/oneOf[2].provenance` | required_in_parent · `const "tool_result"` | 消息真正来自作者、模型、应用还是工具结果；不能靠原生role推断。 |

| `HistoryMessage/oneOf[2].call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `HistoryMessage/oneOf[2].result_kind` | required_in_parent · `enum(observation, validation_result)` | 本工具结果是观察、校验还是执行/业务回执，不能互相冒充。 |

| `HistoryMessage/oneOf[2].material_refs` | required_in_parent · `array<string>` | 此次实际提供的材料实例引用。 |

| `HistoryMessage/oneOf[2].validation` | optional_or_conditional · `object` | 结构/ref/范围校验结果，不授予执行或采纳权限。 |

| `HistoryMessage/oneOf[2].validation.status` | required_in_parent · `enum(passed, failed)` | 此对象自身生命周期状态，不是所有层共用的成功状态。 |

| `HistoryMessage/oneOf[2].validation.reason_code` | required_in_parent · `string` | 稳定可机读原因码，用于决定恢复与审计，不以自由文字替代。 |

| `HistoryMessage/oneOf[2].validation.execution_authorized` | required_in_parent · `const false` | 本验证记录不授执行权，固定false。 |

| `HistoryMessage/oneOf[2].validation.canon_written` | required_in_parent · `const false` | 是否真实发生作品权威写入；读取和校验固定false。 |

| `HistoryMessage/oneOf[3].message_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `HistoryMessage/oneOf[3].role` | required_in_parent · `const "checkpoint"` | 专业角色或原生消息角色；authority/provenance仍必须独立。 |

| `HistoryMessage/oneOf[3].provenance` | required_in_parent · `const "application"` | 消息真正来自作者、模型、应用还是工具结果；不能靠原生role推断。 |

| `HistoryMessage/oneOf[3].checkpoint_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |



## Checkpoint

owner: `application`；来源：`TranscriptCompaction；非call覆盖明确为待裁决提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Checkpoint.checkpoint_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Checkpoint.contract_state` | required_in_parent · `enum(current_call_id_coverage, proposed_scope_or_turn_coverage)` | Checkpoint覆盖形态是当前call-id语义还是新增scope/turn目标提案。 |

| `Checkpoint.covers` | required_in_parent · `object` | Checkpoint精确覆盖的调用、消息、Scope和回合身份，不是模糊“前面全部”。 |

| `Checkpoint.covers.call_ids` | required_in_parent · `array<string>` | 被Checkpoint明确覆盖的已闭合原生调用集合；现役语义不接受凭空构造。 |

| `Checkpoint.covers.message_refs` | required_in_parent · `array<string>` | 被覆盖或引用的原始消息身份集合，不可仅引用摘要。 |

| `Checkpoint.covers.scope_refs` | required_in_parent · `array<string>` | 被Checkpoint覆盖的真实Scope更新身份，只用于经裁决的新覆盖语义。 |

| `Checkpoint.covers.turn_refs` | required_in_parent · `array<string>` | Checkpoint涉及的真实作者回合引用，不得覆盖仍活跃义务。 |

| `Checkpoint.source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `Checkpoint.source_versions` | required_in_parent · `array<VersionRef>` | Checkpoint实际覆盖材料的版本集合，用于防止旧证据冒充当前状态。 |

| `Checkpoint.summary` | required_in_parent · `string` | 有来源的可读摘要；不能替代需要全章/原句的证据，也不是新的Canon。 |

| `Checkpoint.omissions` | required_in_parent · `array<string>` | 没提供/没读到/已压缩内容及原因和补读途径。 |

| `Checkpoint.preserved_obligations` | required_in_parent · `array<string>` | 压缩后仍应保留的作者约束/未决目标，不得被摘要抹掉。 |

| `Checkpoint.canonical_retained` | required_in_parent · `const true` | 压缩后原Canonical仍保留且可回查的声明；真实存储要独立证明。 |

| `Checkpoint.committed` | required_in_parent · `const true` | Checkpoint/记录是否真实提交；投影只能消费提交成功的覆盖。 |

| `Checkpoint.summary_is_canon` | required_in_parent · `const false` | Checkpoint摘要是否为Canon，本设计固定false。 |



## History

owner: `application`；来源：`AuthoringSessionHistory/Checkpoint；不是第二历史库`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `History.canonical_session_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `History.projection_policy_ref` | required_in_parent · `string` | 本次历史选择/覆盖的规则引用，不能拿任意最近N条代替。 |

| `History.messages` | required_in_parent · `array<HistoryMessage>` | 按真实因果顺序排列的历史user/assistant/tool/checkpoint视图。 |

| `History.checkpoints` | required_in_parent · `array<Checkpoint>` | 后续请求中可消费的已提交历史覆盖记录，与原消息精确关联。 |

| `History.unresolved_question_refs` | required_in_parent · `array<string>` | 仍等待作者回答的问题引用；Checkpoint不得吞掉它们。 |

| `History.current_author_insert_at` | optional_or_conditional · `integer` | 派生视图插入位置，确保同回合读取前或新回合历史后作者原话仅一次。 |



## Request

owner: `application`；来源：`RequestIR/AuthoringTask 的设计派生视图；非HTTP，非新增数据库`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Request.kind` | required_in_parent · `const "request"` | 判别分支；不得与作者最终意图分类混同。 |

| `Request.protocol` | required_in_parent · `Protocol` | 设计视图的版本与实际Canonical契约归属，不是Provider API body的一部分。 |

| `Request.identity` | required_in_parent · `ExecutionIdentity` | 当前执行归属的判别联合：真正AgentRun或独立operation。 |

| `Request.system` | required_in_parent · `System` | 产品身份、角色规则和版本构成的稳定系统信封。 |

| `Request.task` | required_in_parent · `Task` | 当前模型调用的业务工作，不等同AgentRun的整个长期目标。 |

| `Request.author_input` | optional_or_conditional · `AuthorInput` | 本轮独立作者原话与原始消息身份/哈希；无作者参与的独立作业省略。 |

| `Request.context` | required_in_parent · `Context` | 此次实际供给的事实、材料覆盖、创作设计及尚未完成义务，而非完整作品数据库。 |

| `Request.history` | required_in_parent · `History` | 从Canonical派生的有序会话视图；不能成为第二历史真源。 |

| `Request.authority` | required_in_parent · `Authority` | 数据权威级别：canon、tentative、design等；不等于执行权限。 |

| `Request.capabilities` | required_in_parent · `Capabilities` | 当前role的业务效果、原生工具Schema及目录覆盖/探索可达性。 |

| `Request.runtime` | required_in_parent · `Runtime` | 真正传输选项，通常不进模型可见业务数据。 |



## Usage

owner: `provider_adapter`；来源：`Usage/ProviderOutput；cached 是 input 子集`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Usage.measurement` | required_in_parent · `enum(provider_reported, unavailable)` | 用量来自Provider报告还是未采集；fixture不得伪造实测指标。 |

| `Usage.input_tokens` | required_in_parent · `integer \| null` | Provider实际报告的输入Token，包含缓存命中部分。 |

| `Usage.output_tokens` | required_in_parent · `integer \| null` | Provider实际输出Token；不能填预估正文长度或max_output_tokens。 |

| `Usage.cached_input_tokens` | required_in_parent · `integer \| null` | Provider报告的输入缓存Token子集；不可再加到input或total上。 |

| `Usage.reasoning_tokens` | required_in_parent · `integer \| null` | 供应商报告的推理Token子量；不能重复加到输出或总Token。 |

| `Usage.total_tokens` | required_in_parent · `integer \| null` | Provider实际总Token，正常归一化为输入+输出，不再次叠加缓存或推理子项。 |

| `Usage.time_to_first_token_ms` | required_in_parent · `integer \| null` | 实际测得首Token延迟，未采集为null。 |

| `Usage.duration_ms` | required_in_parent · `integer \| null` | Provider调用实际总耗时；未测量为null，不能填写预计值。 |



## ModelResponse

owner: `provider_adapter`；来源：`ProviderOutput/CreativeProviderResult/QualityEvaluationResult 的观测视图`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ModelResponse.kind` | required_in_parent · `const "model_response"` | 判别分支；不得与作者最终意图分类混同。 |

| `ModelResponse.request_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ModelResponse.response_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ModelResponse.provider_run_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ModelResponse.provider_call_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ModelResponse.status` | required_in_parent · `enum(completed, tool_calls, incomplete, refused, failed, cancelled)` | 此对象自身生命周期状态，不是所有层共用的成功状态。 |

| `ModelResponse.native_finish_reason` | required_in_parent · `string \| null` | Provider原始终止原因，不能被应用自由改成成功。 |

| `ModelResponse.output` | required_in_parent · `object` | 适配层归一化的assistant文本与tool_calls，系统授权字段不在其中。 |

| `ModelResponse.output.role` | required_in_parent · `const "assistant"` | 专业角色或原生消息角色；authority/provenance仍必须独立。 |

| `ModelResponse.output.content` | required_in_parent · `string \| null` | 模型文本或原生结果内容；系统不得伪造实际完成。 |

| `ModelResponse.output.tool_calls` | required_in_parent · `array<ToolCall>` | 模型原生工具调用集合；不接受正文里的伪XML作为执行调用。 |

| `ModelResponse.usage` | required_in_parent · `Usage` | 实测或明确未采集的资源用量；不能用max预算代替消耗。 |

| `ModelResponse.raw_capture_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ModelResponse.error` | optional_or_conditional · `object` | 实际故障对象；失败原因为空不代表成功，也不能伪造作品事实。 |

| `ModelResponse.error.code` | required_in_parent · `string` | 稳定系统状态码，用户展示使用对应安全文案而非原始内部对象。 |

| `ModelResponse.error.message` | required_in_parent · `string` | 错误/校验的可读解释，与稳定reason_code分开。 |

| `ModelResponse.error.retryable` | required_in_parent · `boolean` | 该具体错误是否允许重试；写入状态unknown不得仅据true直接重复执行。 |

| `ModelResponse.error.source` | required_in_parent · `enum(provider, transport, decoder)` | 有类型、权威、信任和可选版本的真实来源，不是自由来源说明字符串。 |



## ToolResult

owner: `tool_executor`；来源：`AgentObservation/ToolResult/validation_result`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ToolResult.kind` | required_in_parent · `const "tool_result"` | 判别分支；不得与作者最终意图分类混同。 |

| `ToolResult.request_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ToolResult.call_id` | required_in_parent · `string` | 原生工具调用身份，用于精确绑定后续结果。 |

| `ToolResult.tool_name` | required_in_parent · `string` | 工具结果实际执行者名称，需对应原call/计划的业务工具。 |

| `ToolResult.result_kind` | required_in_parent · `enum(observation, validation_result, execution_result)` | 本工具结果是观察、校验还是执行/业务回执，不能互相冒充。 |

| `ToolResult.status` | required_in_parent · `enum(ok, partial, truncated, unavailable, stale, failed, cancelled, not_authorized)` | 此对象自身生命周期状态，不是所有层共用的成功状态。 |

| `ToolResult.materials` | required_in_parent · `array<Material>` | 实际进入本请求或tool结果的数据条目；可访问但未读不得列为已供给。 |

| `ToolResult.summary` | required_in_parent · `string` | 有来源的可读摘要；不能替代需要全章/原句的证据，也不是新的Canon。 |

| `ToolResult.canon_written` | required_in_parent · `boolean` | 是否真实发生作品权威写入；读取和校验固定false。 |

| `ToolResult.receipt_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ToolResult.error_code` | optional_or_conditional · `string` | 稳定错误码，供恢复/诊断而非正文创作。 |

| `ToolResult.next_cursor` | required_in_parent · `string \| null` | 真实续读位置；已读完为null，未知/无法续读须配合status解释。 |



## ValidationCheck

owner: `application`；来源：`校验审计记录`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ValidationCheck.rule_id` | required_in_parent · `string` | 当前校验规则的稳定标识，必须指向实际执行的规则。 |

| `ValidationCheck.status` | required_in_parent · `enum(pass, fail, not_applicable, not_run)` | 此对象自身生命周期状态，不是所有层共用的成功状态。 |

| `ValidationCheck.evidence_refs` | required_in_parent · `array<string>` | 本结论/校验真实依赖的证据引用，不能用目标ID冒充读取证据。 |

| `ValidationCheck.message` | required_in_parent · `string` | 错误/校验的可读解释，与稳定reason_code分开。 |



## Validation

owner: `application`；来源：`JudgmentProtocol.complete_validation：校验不授权`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Validation.kind` | required_in_parent · `const "validation"` | 判别分支；不得与作者最终意图分类混同。 |

| `Validation.request_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Validation.response_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Validation.status` | required_in_parent · `enum(passed, rejected, incomplete)` | 此对象自身生命周期状态，不是所有层共用的成功状态。 |

| `Validation.checks` | required_in_parent · `array<ValidationCheck>` | 本验证回执实际运行/未运行的规则及结果列表；not_run不能冒充pass。 |

| `Validation.next_action` | required_in_parent · `enum(return_reply, execute_read, request_execution_gate, retry_model, await_author, stop)` | 校验之后应纠错/请求Gate/返回/停止的系统流程结果，不是自动批准工具。 |

| `Validation.execution_authorized` | required_in_parent · `const false` | 本验证记录不授执行权，固定false。 |

| `Validation.canon_written` | required_in_parent · `const false` | 是否真实发生作品权威写入；读取和校验固定false。 |



## AuthorizationDecision

owner: `application`；来源：`OrchestratorDecision/GateResult/ConfirmationBinding`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `AuthorizationDecision.decision` | required_in_parent · `enum(not_required, allow, require_confirmation, deny)` | 系统裁决枚举，allow/deny/require_confirmation/not_required含义不同。 |

| `AuthorizationDecision.risk_class` | required_in_parent · `enum(low, medium, high, critical, not_applicable)` | 系统对合法操作实际效果计算的风险，不赋予越权操作可确认资格。 |

| `AuthorizationDecision.basis_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorizationDecision.policy_revision` | required_in_parent · `integer` | 权限/风险策略当时实际版本，可审计回放。 |

| `AuthorizationDecision.work_ref` | required_in_parent · `string` | 作品作用域，跨作品前必须有明确合法授权。 |

| `AuthorizationDecision.effect` | required_in_parent · `string` | 系统操作实际或被请求的业务效果，与capability名不同；应经过门禁。 |

| `AuthorizationDecision.target_refs` | required_in_parent · `array<string>` | 当前动作真实目标。作者选择artifact时，需经系统候选绑定映射到实际被修改对象。 |

| `AuthorizationDecision.expected_versions` | required_in_parent · `array<VersionRef>` | 作者动作/执行门绑定的预期版本，执行前必须与实际版本复核。 |

| `AuthorizationDecision.delegation_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorizationDecision.reason_code` | required_in_parent · `string` | 稳定可机读原因码，用于决定恢复与审计，不以自由文字替代。 |

| `AuthorizationDecision.confirmation_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |



## ModelTextBinding

owner: `application`；来源：`AgentNarrativeSource；定位解码后的模型字符串，不比JSON转义字节`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ModelTextBinding.content` | required_in_parent · `string` | 模型文本或原生结果内容；系统不得伪造实际完成。 |

| `ModelTextBinding.response_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ModelTextBinding.json_pointer` | required_in_parent · `string` | 模型原响应解析对象中作者可见字符串的位置，必须实际可解析。 |

| `ModelTextBinding.sha256` | required_in_parent · `string` | 对应字符串UTF-8原字节哈希；不是原始JSON网络文本hash。 |



## SystemStatusMessage

owner: `application`；来源：`状态文案与模型原文分离`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `SystemStatusMessage.source` | required_in_parent · `const "system"` | 有类型、权威、信任和可选版本的真实来源，不是自由来源说明字符串。 |

| `SystemStatusMessage.code` | required_in_parent · `string` | 稳定系统状态码，用户展示使用对应安全文案而非原始内部对象。 |

| `SystemStatusMessage.text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `SystemStatusMessage.receipt_refs` | required_in_parent · `array<string>` | 真实执行/采纳回执；设计样例引用为合成映射。 |



## ArtifactOutcome

owner: `application`；来源：`TentativeArtifactSet/AdoptionStatus；status 仅系统写入`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ArtifactOutcome.artifact_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ArtifactOutcome.artifact_type` | required_in_parent · `string` | 输出或候选的领域类型；正文、卷纲、角色、排版计划不能靠相同body形状互换。 |

| `ArtifactOutcome.status` | required_in_parent · `enum(TENTATIVE, ACCEPTED, DISCARDED, SUPERSEDED)` | 此对象自身生命周期状态，不是所有层共用的成功状态。 |

| `ArtifactOutcome.item_id` | required_in_parent · `string` | 单次候选条目身份，后续由应用绑定真实artifact；不是让模型指定数据库主键。 |

| `ArtifactOutcome.model_body` | required_in_parent · `ModelTextBinding` | 系统候选正文到实际模型输出字符串的来源绑定，不是另写一份无来源正文。 |

| `ArtifactOutcome.revision_base` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ArtifactOutcome.receipt_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ArtifactOutcome.target_refs` | required_in_parent · `array<string>` | 当前动作真实目标。作者选择artifact时，需经系统候选绑定映射到实际被修改对象。 |



## Outcome

owner: `application`；来源：`TurnResult/Trace/Receipt 读模型；不是新业务事实表`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Outcome.kind` | required_in_parent · `const "application_outcome"` | 判别分支；不得与作者最终意图分类混同。 |

| `Outcome.request_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Outcome.response_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Outcome.validation_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Outcome.authorization` | required_in_parent · `AuthorizationDecision` | 系统在真实身份/作用域/版本和策略上产生的执行决定，不是模型填写。 |

| `Outcome.execution` | required_in_parent · `object` | 工具/采纳动作真实执行状态，独立于模型响应是否结束。 |

| `Outcome.execution.state` | required_in_parent · `enum(not_started, completed, failed, cancel_requested, cancelled, unknown)` | 该对象的局部状态，例如执行、义务或操作，不可跨状态机随意同义替换。 |

| `Outcome.execution.executed_call_ids` | required_in_parent · `array<string>` | 系统真正执行的原生调用身份；模型曾建议但被拒绝的不得列入。 |

| `Outcome.execution.effect` | required_in_parent · `string` | 系统操作实际或被请求的业务效果，与capability名不同；应经过门禁。 |

| `Outcome.execution.receipt_refs` | required_in_parent · `array<string>` | 真实执行/采纳回执；设计样例引用为合成映射。 |

| `Outcome.execution.idempotency_key` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Outcome.canon` | required_in_parent · `object` | 本轮实际作品权威写入事实，包括未知结果、前后版本、回执与回滚状态。 |

| `Outcome.canon.changed` | required_in_parent · `boolean \| null` | 真实写入是否改变Canon；未知用null，不可武断false。 |

| `Outcome.canon.before_versions` | required_in_parent · `array<VersionRef>` | 操作前实际绑定的对象版本，用于采纳前比较和回滚对账。 |

| `Outcome.canon.after_versions` | required_in_parent · `array<VersionRef>` | 实际提交后的对象版本列表，只有真实事务完成后由系统记录。 |

| `Outcome.canon.receipt_refs` | required_in_parent · `array<string>` | 真实执行/采纳回执；设计样例引用为合成映射。 |

| `Outcome.canon.rollback_supported` | required_in_parent · `boolean` | 实际作用类型是否已支持回滚；不是因unreleased就假定可撤销。 |

| `Outcome.canon.write_state` | required_in_parent · `enum(not_attempted, not_written, committed, rolled_back, unknown)` | 事务事实，不以模型结束原因替代。 |

| `Outcome.canon.applied_text_ref` | optional_or_conditional · `string` | 系统确定性应用目标段/格式计划后的文本证据，不是让模型生成整章副本。 |

| `Outcome.artifacts` | required_in_parent · `array<ArtifactOutcome>` | 系统在真实输出校验后物化的候选结果列表；空表示本轮没有物化产物。 |

| `Outcome.author_visible` | required_in_parent · `object` | 经来源绑定后给作者看的模型文本与独立系统状态投影。 |

| `Outcome.author_visible.model_texts` | required_in_parent · `array<ModelTextBinding>` | 模型原文绑定数组；不是系统自行生成的总结。 |

| `Outcome.author_visible.status_messages` | required_in_parent · `array<SystemStatusMessage>` | 系统确认事实，source必须system，不能冒充模型话语。 |

| `Outcome.next_state` | required_in_parent · `enum(completed, continue, awaiting_author, failed, cancelled, blocked, paused)` | 本结果后运行进入继续/等待作者/暂停/终止等哪一种状态。 |

| `Outcome.question_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Outcome.pending_call_refs` | required_in_parent · `array<string>` | 已提出且尚待完成的调用引用；恢复时必须保持原始归属。 |

| `Outcome.recovery` | optional_or_conditional · `object` | 失败/未知状态之后的恢复策略与可用检查点，不自动重放写操作。 |

| `Outcome.recovery.retry_policy` | required_in_parent · `enum(none, safe_read_retry, bounded_model_correction, reconcile_before_retry, author_decision)` | 安全只读重试、有界模型纠错、先对账再重试或等作者等明确恢复方式。 |

| `Outcome.recovery.checkpoint_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `Outcome.recovery.reason` | required_in_parent · `string` | 供用户理解的简短依据，不要求私有思维链。 |



## AuthorAction

owner: `author`；来源：`AuthorActionInput/ConfirmationBinding；委托动作是提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `AuthorAction.kind` | required_in_parent · `const "author_action"` | 判别分支；不得与作者最终意图分类混同。 |

| `AuthorAction.action_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorAction.actor_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorAction.work_ref` | required_in_parent · `string` | 作品作用域，跨作品前必须有明确合法授权。 |

| `AuthorAction.session_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorAction.action` | required_in_parent · `enum(confirm, reject, accept, discard, edit_then_accept, pause, resume, cancel, steer, grant_delegation, revoke_delegation, revise_from_findings)` | 当前判别联合的动作：作者动作、Agent提议或计划步骤各有自己的枚举，不可跨父类型复用。 |

| `AuthorAction.source_turn_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorAction.target_refs` | required_in_parent · `array<string>` | 当前动作真实目标。作者选择artifact时，需经系统候选绑定映射到实际被修改对象。 |

| `AuthorAction.expected_versions` | required_in_parent · `array<VersionRef>` | 作者动作/执行门绑定的预期版本，执行前必须与实际版本复核。 |

| `AuthorAction.idempotency_key` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorAction.confirmation_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorAction.delegation_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `AuthorAction.new_goal_text` | optional_or_conditional · `string` | 作者新的引导原文，不从系统摘要伪造。 |

| `AuthorAction.created_at` | required_in_parent · `string` | UTC/带时区 ISO-8601 时间，不用本地无时区时间 |

| `AuthorAction.quality_finding_refs` | optional_or_conditional · `array<string>` | 已有VS-00E作者动作选择的真实quality_finding_id；不得使用validator类型冒充。 |



## ProviderEvent

owner: `provider_adapter`；来源：`ProviderEvent：不包含推理/密钥/raw prompt`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `ProviderEvent.kind` | required_in_parent · `const "provider_event"` | 判别分支；不得与作者最终意图分类混同。 |

| `ProviderEvent.event_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ProviderEvent.provider_run_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ProviderEvent.sequence` | required_in_parent · `integer` | 同一Provider run内严格递增的事件序号，重复/倒退须处理。 |

| `ProviderEvent.event_type` | required_in_parent · `enum(started, progress, chunk, final_output, usage_recorded, error, cancel_requested, cancelled)` | ProviderEvent八类事件之一，不能用普通chunk假装final_output。 |

| `ProviderEvent.visibility` | required_in_parent · `enum(author, developer, internal)` | 事件对author/developer/internal哪一层可见；敏感数据不能借internal标记流向author。 |

| `ProviderEvent.summary` | required_in_parent · `string` | 有来源的可读摘要；不能替代需要全章/原句的证据，也不是新的Canon。 |

| `ProviderEvent.payload` | required_in_parent · `object` | 有kind判别的材料内容，不是无约束metadata垃圾桶。 |

| `ProviderEvent.payload.phase` | optional_or_conditional · `string` | Provider或运行当前阶段，需结合所属状态机，不能直接等于任务状态。 |

| `ProviderEvent.payload.author_narrative_delta` | optional_or_conditional · `string` | 明确属于作者可见叙事字段的流式增量，不含原始私有推理或任意raw output。 |

| `ProviderEvent.payload.source_field` | optional_or_conditional · `enum(content, author_reasoning, reason, question)` | 明确作者可见模型文本字段，禁止原始私有推理。 |

| `ProviderEvent.payload.tool_call_id` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ProviderEvent.payload.response_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ProviderEvent.payload.usage_ref` | optional_or_conditional · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `ProviderEvent.payload.error_code` | optional_or_conditional · `string` | 稳定错误码，供恢复/诊断而非正文创作。 |

| `ProviderEvent.payload.cancel_acknowledged` | optional_or_conditional · `boolean` | 运行监督/Provider已经实际确认取消；仅发取消请求时不得设true。 |

| `ProviderEvent.refs` | required_in_parent · `array<string>` | 所属对象的实际引用集合，具体是否目标/来源/事件由父契约决定。 |

| `ProviderEvent.emitted_at` | required_in_parent · `string` | UTC/带时区 ISO-8601 时间，不用本地无时区时间 |



## Exchange

owner: `application`；来源：`离线设计测试容器，不进入产品/Provider`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `Exchange.kind` | required_in_parent · `const "exchange"` | 判别分支；不得与作者最终意图分类混同。 |

| `Exchange.case_id` | required_in_parent · `string` | 合成测试场景的稳定编号，不是生产run_id。 |

| `Exchange.title` | required_in_parent · `string` | 候选/记录面向作者的标题；不承担稳定身份，不能混入内部ID。 |

| `Exchange.fixture` | required_in_parent · `object` | 离线样例合成标记与实现声明边界，绝不等同线上日志。 |

| `Exchange.fixture.synthetic` | required_in_parent · `const true` | 标记全部示例数据为合成fixture，不冒称真实作者或线上请求。 |

| `Exchange.fixture.implementation_claim` | required_in_parent · `const "none"` | 样例明确声明没有生产实现证明，固定none。 |

| `Exchange.fixture.design_status` | required_in_parent · `enum(existing_semantics_design_shape, target_design_only)` | 离线场景是复用已有语义的设计形状还是尚未实现的目标提案。 |

| `Exchange.requests` | required_in_parent · `array<Request>` | 一段合成往返中的实际请求设计对象，顺序反映调用链而非全量塞入模型。 |

| `Exchange.responses` | required_in_parent · `array<ModelResponse>` | Adapter归一化模型响应集合；每项需绑定明确request_id与原始输出来源。 |

| `Exchange.tool_results` | required_in_parent · `array<ToolResult>` | 本exchange真实工具/校验结果样例，与call_id一一闭合。 |

| `Exchange.validations` | required_in_parent · `array<Validation>` | 当前exchange各响应实际校验记录，须与响应关联。 |

| `Exchange.outcomes` | required_in_parent · `array<Outcome>` | 各调用后系统实际处置的合成记录集合，生产来自现有Trace/TurnResult/Receipt。 |

| `Exchange.author_actions` | required_in_parent · `array<AuthorAction>` | 样例中已发生的真实作者动作序列，生产由既有作者动作/回执事实提供。 |

| `Exchange.events` | required_in_parent · `array<ProviderEvent>` | 本exchange的真实顺序事件fixture；不代表需要新建事件总线。 |

| `Exchange.expected` | required_in_parent · `object` | 离线测试的预期行为，不进入生产模型请求或作为系统先验结论。 |

| `Exchange.expected.narrative` | required_in_parent · `string` | 测试或结果中的可读说明，不等于隐藏推理或执行回执。 |

| `Exchange.expected.must_not_happen` | required_in_parent · `array<string>` | 测试场景禁止后果说明，只用于验收，不注入生产作为答案提示。 |

| `Exchange.canonical_fixture_records` | optional_or_conditional · `array<object>` | 离线样例的原始历史记录，用于验证Checkpoint覆盖；不建议新增产品持久表。 |

| `Exchange.canonical_fixture_records[].ref` | required_in_parent · `string` | 稳定对象或来源身份；不得凭标题猜造。 |

| `Exchange.canonical_fixture_records[].kind` | required_in_parent · `enum(user, assistant, scope, turn)` | 判别分支；不得与作者最终意图分类混同。 |

| `Exchange.canonical_fixture_records[].text` | required_in_parent · `string` | 该来源下的文本值；是否原文/摘要由所在对象语义决定。 |

| `Exchange.canonical_fixture_records[].sha256` | required_in_parent · `string` | 对应字符串UTF-8原字节哈希；不是原始JSON网络文本hash。 |

| `Exchange.canonical_fixture_records[].version` | optional_or_conditional · `integer` | 该对象读取/操作时的真实版本。 |



## SummaryResult

owner: `model`；来源：`ChapterSummary 语义；封闭JSON为本稿提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `SummaryResult.summary` | required_in_parent · `string` | 有来源的可读摘要；不能替代需要全章/原句的证据，也不是新的Canon。 |

| `SummaryResult.source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `SummaryResult.coverage` | required_in_parent · `Coverage` | 材料真实覆盖，不是预计读取范围。 |

| `SummaryResult.unresolved_points` | required_in_parent · `array<string>` | 尚待确认的问题集合，不能因为总结生成而视为已解决。 |



## FactInventoryResult

owner: `model`；来源：`FactInventoryService；候选非canon`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `FactInventoryResult.candidate_facts` | required_in_parent · `array<object>` | 从指定材料提取的待审事实命题；模型推断不自动成为作品权威状态。 |

| `FactInventoryResult.candidate_facts[].subject_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `FactInventoryResult.candidate_facts[].claim` | required_in_parent · `string` | 从材料提取或对账的命题文本；权威性取决于父对象来源和状态。 |

| `FactInventoryResult.candidate_facts[].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `FactInventoryResult.candidate_facts[].confidence` | required_in_parent · `number` | 模型评估信心，不是机械安全保证。 |

| `FactInventoryResult.conflicts` | required_in_parent · `array<object>` | 实际发现的冲突列表，需要对应来源/证据；不能凭空补设定。 |

| `FactInventoryResult.conflicts[].source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |

| `FactInventoryResult.conflicts[].description` | required_in_parent · `string` | 当前对象的可读说明；不作为唯一权限、身份或版本证据。 |

| `FactInventoryResult.missing_information` | required_in_parent · `array<string>` | 执行任务尚缺的信息，不可用默认值补全并当作事实。 |



## LedgerResult

owner: `model`；来源：`LedgerReconcile；三态对账不静默更新`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `LedgerResult.discrepancies` | required_in_parent · `array<object>` | 设计态/实现态/进度态间待作者裁决的差异，不直接改任何一方。 |

| `LedgerResult.discrepancies[].element_id` | required_in_parent · `enum(E01, E02, E03, E04, E05, E06, E07, E08, E09, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21, E22, E23, E24, E25, E26, E27, E28, E29, E30, E31, E32, E33, E34, E35, E36, E37)` | 项目现有小说要素E01–E37标识；payload细分字段是本包提案。 |

| `LedgerResult.discrepancies[].design_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `LedgerResult.discrepancies[].realization_ref` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `LedgerResult.discrepancies[].description` | required_in_parent · `string` | 当前对象的可读说明；不作为唯一权限、身份或版本证据。 |

| `LedgerResult.discrepancies[].options` | required_in_parent · `array<string>` | 作者明确选择项；可空/自由回答遵循对应工具契约，不替作者预选。 |

| `LedgerResult.source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |



## MissionResult

owner: `model`；来源：`ChapterMission；本稿JSON细化`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `MissionResult.chapter_function` | required_in_parent · `string` | 本章承担推进/铺垫/转折等功能的明确表达；不存在统一强制高潮模板。 |

| `MissionResult.required_changes` | required_in_parent · `array<string>` | 原目标下必须落实的变化；不能改成泛泛“已润色”后跳过。 |

| `MissionResult.reader_effect` | required_in_parent · `string` | 当前章节对读者的预期作用，属于设计意图。 |

| `MissionResult.source_refs` | required_in_parent · `array<string>` | 同一读取或派生实际依赖的来源列表。 |



## CharacterItem

owner: `model`；来源：`character_design/domain E07；具体附加字段提案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `CharacterItem.item_id` | required_in_parent · `string` | 单次候选条目身份，后续由应用绑定真实artifact；不是让模型指定数据库主键。 |

| `CharacterItem.title` | required_in_parent · `string` | 候选/记录面向作者的标题；不承担稳定身份，不能混入内部ID。 |

| `CharacterItem.body` | required_in_parent · `string` | 模型候选正文；不是已采纳事实。 |

| `CharacterItem.rationale` | optional_or_conditional · `string \| null` | 候选修改或设计的公开依据，不是作品正文，也不是系统授权。 |

| `CharacterItem.name` | optional_or_conditional · `string` | 当前工具/能力/记录的登记名称；权限仍按稳定ID与目录验证。 |

| `CharacterItem.narrative_role` | optional_or_conditional · `enum(PROTAGONIST, ANTAGONIST, SUPPORTING, MINOR, ENSEMBLE_POV)` | 角色在故事中的叙事身份；改变已有角色必须针对真实档案而非新建同名人物。 |

| `CharacterItem.desire` | optional_or_conditional · `string` | 人物表层欲望的设计表达，须区分设计档案与正文实际表现。 |

| `CharacterItem.need` | optional_or_conditional · `string` | 人物深层需要的设计说明，与表层欲望分开。 |

| `CharacterItem.flaw` | optional_or_conditional · `string` | 人物缺陷的设计描述，不从一次行为自动推断长期人格。 |

| `CharacterItem.voice` | optional_or_conditional · `string` | 角色/叙述声音的设计表达，与作者风格样本及已采纳事实分开。 |

| `CharacterItem.source_refs` | optional_or_conditional · `array<string>` | 同一读取或派生实际依赖的来源列表。 |



## FormattingItem

owner: `model`；来源：`prose_formatting_plan 现役native文案`；成熟度：`proposed_shape`。

| 字段 | 类型与条件 | 含义 |

|---|---|---|

| `FormattingItem.item_id` | required_in_parent · `string` | 单次候选条目身份，后续由应用绑定真实artifact；不是让模型指定数据库主键。 |

| `FormattingItem.title` | required_in_parent · `string` | 候选/记录面向作者的标题；不承担稳定身份，不能混入内部ID。 |

| `FormattingItem.body` | required_in_parent · `string` | 模型候选正文；不是已采纳事实。 |

| `FormattingItem.rationale` | optional_or_conditional · `string \| null` | 候选修改或设计的公开依据，不是作品正文，也不是系统授权。 |

| `FormattingItem.line_break_changes` | required_in_parent · `array<object>` | 模型只提出已给boundary_id的换行数量变更，不提供正文重写。 |

| `FormattingItem.line_break_changes[].boundary_id` | required_in_parent · `string` | 真实对象/来源/操作的稳定引用；样例使用 fixture 专用 demo 标识 |

| `FormattingItem.line_break_changes[].lines` | required_in_parent · `integer` | 排版边界的目标换行数量0/1/2，不能当正文长度。 |
