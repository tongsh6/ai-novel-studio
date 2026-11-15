# novel_application 测试索引

本目录是 `novel_application` 的 ExUnit 测试入口与共享夹具；测试按真实应用/Provider 边界驱动，不复制生产实现。

## 文件与目录

- [test_helper.exs](test_helper.exs)：启动 ExUnit/Sandbox，定义 `NovelApplication.TestAssertions` 与 `NovelApplication.TestAgenticLoopFixtures`。`prompt_text/1` 对 `%NovelCommon.RequestIR{}` 读取 canonical `role/blocks`，对 binary 或 Gateway 注入后的真实 system/user list 复用 `NovelTest.TestProviderPrompt.text/1`；`message_text/1` 只提取消息文本块，不合成 canonical 字段。
- [support/README.md](support/README.md)：可被 `novel_application` 与 `novel_web` 共同加载的测试生命周期 helper 索引。
- `novel_application/`：应用用例、flow、canonical transcript/请求构造与历史消费者测试。Provider 请求断言直接消费 `RequestIR` 的 `role/provenance/blocks/tools/projection`，不再经旧 wire bridge 反解析；测试构造 `projection` 只用真实字段（`tool_choice` / `finite_mode` 等），不写 `target`/`capability_profile`，能力事实由 Gateway 按实际 fixture route 派生。
- [novel_application/judgment_initial_snapshot_test.exs](novel_application/judgment_initial_snapshot_test.exs)：R1 初始快照（VS-00L §19.2）——首次构造 `application_base → initial scope_update → user`、三类投影、作者字节与来源、重复构造幂等（工作区未提交、待独立验证）。
- [novel_application/agent_run_cleanup_test.exs](novel_application/agent_run_cleanup_test.exs)：B84 A3 的 run/caller PID 生命周期边界：先取消并等待本 run 在途 step 提交到安全点，再只释放登记 run 及其 step/background 嵌套任务；run 先退出仍收口孤儿、重复释放幂等、其他 owner 哨兵保留、超时/登记缺失不假成功且 forced 收口后无活任务、释放先于 DataCase 停 Sandbox owner。caller 侧覆盖已死/自然退出/超时与 Task 拒绝 shutdown：只收其 task、其他 owner 保留、失败不吞。
- [novel_application/agent_run_prose_continuation_test.exs](novel_application/agent_run_prose_continuation_test.exs)：正文运行的继续判断边界：作者已采纳时零调用收束，真实 continuation 保留 Base/观察历史并将仅关联的计划与证据限定为 Scope。
- [novel_application/dialogue_run_spec_test.exs](novel_application/dialogue_run_spec_test.exs)：显式 profile 的 run spec 构造、结构化作者预算与 work 身份必填契约；与对话判断路由测试分工。
- [novel_application/author_content_registration_test.exs](novel_application/author_content_registration_test.exs)：应用层原文登记的来源选择、current/历史指代校验与字节保真；持久提交重验仍由 TurnInteractionService 测试覆盖。
