# novel_agent test/support

- [authoring_task_fixtures.ex](authoring_task_fixtures.ex)：创作任务/原生工具调用的测试夹具；请求文本只从 canonical `%RequestIR{}` 的 `blocks` 读取，并保留作者/材料字节。文本块按原字节读，tool_call/observation/validation_result 按结构化 block 的 JSON 读（与真实模型在 wire 上收到的工具结果同形）。
- [provider/](provider/README.md)：确定性 provider 与判断请求材料解析（仅 test-support；生产 runtime 不注册）。
