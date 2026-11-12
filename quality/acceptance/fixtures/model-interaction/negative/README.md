# 56 个拒绝反例

返回 [样例索引](../README.md)；

| 文件或目录 | 职责 |
|---|---|
| [N01.json](N01.json) | 模型请求不允许无定义的额外字段；期望 SCHEMA_INVALID |
| [N02.json](N02.json) | 章位数不能冒充正文数；期望 CHAPTER_COUNTS_MISMATCH |
| [N03.json](N03.json) | 观察没有真实历史调用；期望 FABRICATED_OBSERVATION |
| [N04.json](N04.json) | 正文来源越过作品边界；期望 CROSS_WORK_MATERIAL |
| [N05.json](N05.json) | writer虚报未提供的使用证据；期望 USED_REF_NOT_VISIBLE |
| [N06.json](N06.json) | 作者原话字节被组装器改写；期望 AUTHOR_BYTES_CHANGED |
| [N07.json](N07.json) | 目标段原文字节与范围不符；期望 SEGMENT_BYTES_MISMATCH |
| [N08.json](N08.json) | 原始工具参数不是JSON；期望 RAW_ARGUMENTS_INVALID_JSON |
| [N09.json](N09.json) | 判断阶段只交计划工具而无成对plan决定；期望 PLAN_PAIR_INVALID |
| [N10.json](N10.json) | explore同时附带执行capability；期望 ACTION_FIELD_CONFLICT |
| [N11.json](N11.json) | 模型凭空创造角色目标ref；期望 TARGET_NOT_READ_OR_SUPPLIED |
| [N12.json](N12.json) | 只看到selected目录却宣称能力全集缺失；期望 GAP_WITHOUT_CATALOG_EVIDENCE |
| [N13.json](N13.json) | 引用字段夹带解释性文本；期望 INVALID_CAPABILITY_REF |
| [N14.json](N14.json) | 登记指令替代历史原文；期望 REGISTRATION_SOURCE_NOT_ELIGIBLE |
| [N15.json](N15.json) | 系统把候选状态写成accepted却无采纳回执；期望 ACCEPTED_WITHOUT_COMMIT |
| [N16.json](N16.json) | gate拒绝仍然写canon；期望 UNAUTHORIZED_EXECUTION |
| [N17.json](N17.json) | 委托撤销后仍自动采纳；期望 INVALID_DELEGATION |
| [N18.json](N18.json) | 已过期委托；期望 DELEGATION_EXPIRED |
| [N19.json](N19.json) | 委托不覆盖当前目标；期望 DELEGATION_SCOPE_EXCEEDED |
| [N20.json](N20.json) | critical不能通过full自动采纳；期望 CRITICAL_AUTO_ADOPTION |
| [N21.json](N21.json) | UI改写模型原文却保留原来源绑定；期望 NARRATIVE_BYTES_REWRITTEN |
| [N22.json](N22.json) | 模型原文绑定正确但泄漏内部ref；期望 INTERNAL_REF_IN_AUTHOR_TEXT |
| [N23.json](N23.json) | 质量发现引用不存在原句；期望 QUALITY_EVIDENCE_NOT_IN_TEXT |
| [N24.json](N24.json) | 评审失败却伪造候选；期望 INVALID_RESPONSE_MATERIALIZED |
| [N25.json](N25.json) | 只发取消请求但宣称已取消；期望 CANCELLATION_NOT_ACKNOWLEDGED |
| [N26.json](N26.json) | 流式事件序号倒退；期望 EVENT_SEQUENCE_INVALID |
| [N27.json](N27.json) | 状态不明却宣称没有写入；期望 UNKNOWN_WRITE_FALSE_CERTAINTY |
| [N28.json](N28.json) | 未闭合工具交换进入下次模型请求；期望 UNCLOSED_TOOL_CALL |
| [N29.json](N29.json) | 把纯回合覆盖冒充现役call-id压缩；期望 CHECKPOINT_UNAPPROVED_COVERAGE |
| [N30.json](N30.json) | 当前作者原话被重复装入历史；期望 CURRENT_AUTHOR_DUPLICATED |
| [N31.json](N31.json) | 读取预算用尽仍探索；期望 TOOL_BUDGET_EXHAUSTED |
| [N32.json](N32.json) | 缓存Token不能大于输入Token；期望 CACHED_EXCEEDS_INPUT |
| [N33.json](N33.json) | 缓存Token不可重复计入total；期望 USAGE_TOTAL_INCORRECT |
| [N34.json](N34.json) | 未读全章不能冒充完整重写基线；期望 COMPLETE_TARGET_NOT_READ |
| [N35.json](N35.json) | 模型捏造排版边界；期望 UNKNOWN_FORMATTING_BOUNDARY |
| [N36.json](N36.json) | 作者可见流式事件包含原始prompt；期望 SCHEMA_INVALID |
| [N37.json](N37.json) | 情绪迁移不是任意数值曲线；期望 SCHEMA_INVALID |
| [N38.json](N38.json) | 写前设计不能冒充canon；期望 DESIGN_MASQUERADES_AS_CANON |
| [N39.json](N39.json) | 空回复不能作为完整答案；期望 EMPTY_FINAL_REPLY |
| [N40.json](N40.json) | 独立文本操作不得伪造AgentRun；期望 SCHEMA_INVALID |
| [N41.json](N41.json) | 模型不能自填自动采纳系统字段；期望 MODEL_WRITES_SYSTEM_FIELDS |
| [N42.json](N42.json) | 质量证据范围倒置；期望 QUALITY_SPAN_ORDER_INVALID |
| [N43.json](N43.json) | 无作者决定也无委托不得采纳；期望 ADOPTION_WITHOUT_AUTHOR_DECISION |
| [N44.json](N44.json) | 声称改变canon却不更新版本；期望 CANON_VERSION_NOT_ADVANCED |
| [N45.json](N45.json) | 终态之后不能继续进度/生成；期望 EVENT_AFTER_TERMINAL |
| [N46.json](N46.json) | 伪工具XML不能当原生调用；期望 FAKE_TEXT_TOOL_CALL |
| [N47.json](N47.json) | 不同版本的分页不能拼成同一完整正文；期望 EVIDENCE_VERSION_MISMATCH |
| [N48.json](N48.json) | 分页区间有缺口却宣称全章已读；期望 COMPLETE_TARGET_NOT_READ |
| [N49.json](N49.json) | 素材参考不能变为canon；期望 ASSET_BECOMES_CANON |
| [N50.json](N50.json) | 跨作品作者资产没有本作品关联不可消费；期望 ASSET_LINK_INVALID |
| [N51.json](N51.json) | checkpoint覆盖不存在的历史原消息；期望 CHECKPOINT_SOURCE_NOT_FOUND |
| [N52.json](N52.json) | checkpoint覆盖的原始字节被改写；期望 CHECKPOINT_SOURCE_BYTES_CHANGED |
| [N53.json](N53.json) | 作者同意了其它目标不能通用放行；期望 AUTHOR_DECISION_BINDING_MISMATCH |
| [N54.json](N54.json) | 委托没有对应的真实签发来源；期望 DELEGATION_SOURCE_MISSING |
| [N55.json](N55.json) | 采纳后正文hash与目标段确定性替换不符；期望 APPLIED_REVISION_HASH_MISMATCH |
| [N56.json](N56.json) | 按质量发现修订必须选真实finding而非规则类型；期望 FINDING_SELECTION_INVALID |
