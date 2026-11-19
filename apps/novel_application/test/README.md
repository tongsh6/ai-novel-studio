# novel_application 测试索引

本目录是 `novel_application` 的 ExUnit 测试入口与共享夹具；测试按真实应用/Provider 边界驱动，不复制生产实现。

## 文件与目录

- [novel_application/professional_writer_request_test.exs](novel_application/professional_writer_request_test.exs)：专业 Writer 的真实目标、作者单供给与实际可见来源；partial、application/native 分归、被覆盖旧页及 source-only 反例。
- [novel_application/chapter_revision_request_test.exs](novel_application/chapter_revision_request_test.exs)：整章与目标段修订的实际请求材料；两段完整 accepted 基线及版本保留、作者原文字节独立、三 wire 供给。

- [novel_application/judgment_plan_material_test.exs](novel_application/judgment_plan_material_test.exs)：真实同批计划校验、数据库读取、专业 Writer 与持久会话恢复链；同一计划/原生调用绑定、partial 正文和三 wire 单供给，不以手工拼接观察代替生产者。
- [novel_application/planned_exploration_material_test.exs](novel_application/planned_exploration_material_test.exs)：R05 专业计划实读的 canonical 供给边界；已闭合计划不追加第二工具结果，application/native 来源分立，partial 原文在三类请求只供应一次，普通关联引用不生成材料。
- [novel_application/session_adoptions_read_test.exs](novel_application/session_adoptions_read_test.exs)：现会话候选目录与完整正文的只读入口；真实状态、可信会话隔离、Unicode 分页与精确续页资格，迁入旧候选目录用例。
- [novel_application/judgment_paged_sources_test.exs](novel_application/judgment_paged_sources_test.exs)：真实判断循环的候选目录、候选全文、记忆全文分页；两轮普通读取与额外续页预算、下一请求材料及来源绑定。

- [novel_application/agentic_plan_completed_prefix_test.exs](novel_application/agentic_plan_completed_prefix_test.exs)：已完成计划前缀的纯不变量；保留、改写、缺失及无当前计划边界，与真实 Provider/IR 规划编排测试分离，不复制 Provider 支撑。
- [novel_application/agentic_plan_narrative_test.exs](novel_application/agentic_plan_narrative_test.exs)：计划起草、修订与同批计划的作者叙述接收；独立原文字节、来源字段、拒绝后真实调用纠错与调用预算，复用 test_helper 的既有计划夹具。

- [test_helper.exs](test_helper.exs)：启动 ExUnit/Sandbox，定义 `NovelApplication.TestAssertions` 与 `NovelApplication.TestAgenticLoopFixtures`。`prompt_text/1` 对 `%NovelCommon.RequestIR{}` 读取 canonical `role/blocks`，对 binary 或 Gateway 注入后的真实 system/user list 复用 `NovelTest.TestProviderPrompt.text/1`；`message_text/1` 只提取消息文本块，不合成 canonical 字段。
- [support/README.md](support/README.md)：可被 `novel_application` 与 `novel_web` 共同加载的测试生命周期 helper 索引。
- `novel_application/`：应用用例、flow、canonical transcript/请求构造与历史消费者测试。Provider 请求断言直接消费 `RequestIR` 的 `role/provenance/blocks/tools/projection`，不再经旧 wire bridge 反解析；测试构造 `projection` 只用真实字段（`tool_choice` / `finite_mode` 等），不写 `target`/`capability_profile`，能力事实由 Gateway 按实际 fixture route 派生。
- [novel_application/judgment_initial_snapshot_test.exs](novel_application/judgment_initial_snapshot_test.exs)：R1 初始快照（VS-00L §19.2）——首次构造 `application_base → initial scope_update → user`、三类投影、作者字节与来源、重复构造幂等（工作区未提交、待独立验证）。
- [novel_application/agent_run_cleanup_test.exs](novel_application/agent_run_cleanup_test.exs)：B84 A3 的 run/caller PID 生命周期边界：先取消并等待本 run 在途 step 提交到安全点，再只释放登记 run 及其 step/background 嵌套任务；run 先退出仍收口孤儿、重复释放幂等、其他 owner 哨兵保留、超时/登记缺失不假成功且 forced 收口后无活任务、释放先于 DataCase 停 Sandbox owner。caller 侧覆盖已死/自然退出/超时与 Task 拒绝 shutdown：只收其 task、其他 owner 保留、失败不吞。
- [novel_application/agent_run_prose_continuation_test.exs](novel_application/agent_run_prose_continuation_test.exs)：正文运行的继续判断边界：作者已采纳时零调用收束，真实 continuation 保留 Base/观察历史并将仅关联的计划与证据限定为 Scope。
- [novel_application/dialogue_run_spec_test.exs](novel_application/dialogue_run_spec_test.exs)：显式 profile 的 run spec 构造、结构化作者预算与 work 身份必填契约；与对话判断路由测试分工。
- [novel_application/author_content_registration_test.exs](novel_application/author_content_registration_test.exs)：应用层原文登记的来源选择、current/历史指代校验与字节保真；持久提交重验仍由 TurnInteractionService 测试覆盖。
- [novel_application/transcript_compaction_summary_test.exs](novel_application/transcript_compaction_summary_test.exs)：摘要执行准入、真实来源/响应字节、调用计费、取消和持久失败；与恢复测试共用现役执行与事务入口。
- [novel_application/transcript_compaction_runtime_test.exs](novel_application/transcript_compaction_runtime_test.exs)：讨论摘要在真实 AgentRunService 中的取消、转向、任务死亡、计费与预算生命周期；与 summary 用例测试通过单一 support/transcript_compaction_helper.exs 共享 Provider 执行环境，不复制业务判定。
- [novel_application/transcript_compaction_recovery_test.exs](novel_application/transcript_compaction_recovery_test.exs)：R03 已持久接收摘要的原响应恢复，核验提交失败保留、跨 run 零模型调用恢复、同事务清除、取消/目标变更隔离与原文保真；不代签真实页面或模型摘要语义。
- [novel_application/session_message_read_test.exs](novel_application/session_message_read_test.exs)：R03 会话消息原文探索：独立作者/模型文本 oracle、Unicode grapheme 分页与全文 hash、可信会话隔离、损坏版本/角色拒绝、真实取消/失败状态及下一请求 observation/used_refs/三类 Provider 投影。
- [novel_application/work_archive_service_test.exs](novel_application/work_archive_service_test.exs)：面板读口与按需档案目录/详情；真实作品隔离、明确状态、Unicode 原文分页、来源/指纹/覆盖元数据、目录不授予正文或修订基线资格。
- [novel_application/b29_character_profile_test.exs](novel_application/b29_character_profile_test.exs)：纯人物候选规则与同文件独立 Sandbox 派发分区；后者经真实持久基线验证未读/旧版本拒绝、精确身份、零模型字段候选及无变化裁决 trace，最终采纳和采纳后读投影分别由既有 B29 专项测试覆盖。
