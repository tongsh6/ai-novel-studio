# novel_application 测试索引

本目录是 `novel_application` 的 ExUnit 测试入口与共享夹具；测试按真实应用/Provider 边界驱动，不复制生产实现。

## 文件与目录

- [test_helper.exs](test_helper.exs)：启动 ExUnit/Sandbox，定义 `NovelApplication.TestAssertions` 与 `NovelApplication.TestAgenticLoopFixtures`。`prompt_text/1` 对 `%NovelCommon.RequestIR{}` 读取 canonical `role/blocks`，对 binary 或 Gateway 注入后的真实 system/user list 复用 `NovelTest.TestProviderPrompt.text/1`；`message_text/1` 只提取消息文本块，不合成 canonical 字段。
- [support/README.md](support/README.md)：可被 `novel_application` 与 `novel_web` 共同加载的测试生命周期 helper 索引。
- `novel_application/`：应用用例、flow、canonical transcript/请求构造与历史消费者测试。Provider 请求断言直接消费 `RequestIR` 的 `role/provenance/blocks/tools/projection`，不再经旧 wire bridge 反解析；测试构造 `projection` 只用真实字段（`tool_choice` / `finite_mode` 等），不写 `target`/`capability_profile`，能力事实由 Gateway 按实际 fixture route 派生。
- [novel_application/judgment_initial_snapshot_test.exs](novel_application/judgment_initial_snapshot_test.exs)：R1 初始快照（VS-00L §19.2）——首次构造 `application_base → initial scope_update → user`、三类投影、作者字节与来源、重复构造幂等（工作区未提交、待独立验证）。
