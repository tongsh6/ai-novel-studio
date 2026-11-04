# novel_application 测试支持

本目录存放可被 `novel_application` 与 `novel_web` 测试共同复用的测试生命周期 helper。

## 文件

- [agent_run_cleanup_helper.exs](agent_run_cleanup_helper.exs)：定义 `NovelApplication.TestAgentRunCleanup`。在 Sandbox owner 停止前同步 AgentRun server，并等待 step/后台任务安静。仅供两个 app 的 `test/test_helper.exs` 通过 `Code.require_file/1` 加载；文件只定义 helper，不启动 ExUnit、不初始化 env、不启动 owner。
- [agent_event_relay_helper.exs](agent_event_relay_helper.exs)：定义 `NovelApplication.TestAgentEventRelay`。它通过公共 `AgentRunService.subscribe_events/2` 建立真实测试订阅者，`observe/2` 订阅后原样返回 run attrs，`subscribe/4` 供 recover/confirmation 等路径先显式订阅；只转发真实 Registry `AgentEvent`，不镜像服务 API、不向生产传测试选项。仅供测试通过 `Code.require_file/1` 加载。
