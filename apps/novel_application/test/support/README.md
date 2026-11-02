# novel_application 测试支持

本目录存放可被 `novel_application` 与 `novel_web` 测试共同复用的测试生命周期 helper。

## 文件

- [agent_run_cleanup_helper.exs](agent_run_cleanup_helper.exs)：定义 `NovelApplication.TestAgentRunCleanup`。在 Sandbox owner 停止前同步 AgentRun server，并等待 step/后台任务安静。仅供两个 app 的 `test/test_helper.exs` 通过 `Code.require_file/1` 加载；文件只定义 helper，不启动 ExUnit、不初始化 env、不启动 owner。
