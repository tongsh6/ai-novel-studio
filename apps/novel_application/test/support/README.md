# novel_application 测试支持

本目录存放可被 `novel_application` 与 `novel_web` 测试共同复用的测试生命周期 helper。

## 文件

- [agent_run_cleanup_helper.exs](agent_run_cleanup_helper.exs)：定义 `NovelApplication.TestAgentRunCleanup`。`register_run/1` 在 run 成功启动后按 Registry 实际 PID 登记 ExUnit `on_exit`；`release_run/2` 对仍存活的 run 先发既有 `:cancel` command，只对该 PID 轮询 state 等待 `current_task?` 为 false 且本 run 的 step 任务自然完成，再经 `AgentRunSupervisor` 结束 run，并按 `$callers` 链收口本 run 的 step/background 派生任务（含嵌套）。deadline 覆盖整个退出；到期或 state/stop 失败会保留原始失败、强制收口已识别资源并确认死亡后抛异常。`on_exit` 边界会先用 `Logger.error` 记录带原始异常与堆栈的“测试资源退出失败”再原样重抛：ExUnit 1.19 在 test 已失败时只保留首个异常，此记录仅为补足退出失败证据，不改变释放语义。`register_task_caller/1` / `release_task_caller/2` 服务真实 `socket.channel_pid`：退出时先 monitor 等待该已拥有 caller 退出，再只按 `$callers` 收口其派生 task（含 nested）；到期仍精准结束该 caller 与已识别 task 后 raise。Channel 的关闭仍由 Phoenix 原生 per-test Supervisor 与链接负责，不在此建立平行所有权。run 与 Channel caller 是两种 producer，分别释放；`await_quiescent/1` 与全局遍历已随全部消费者迁移删除。仅供两个 app 的 `test/test_helper.exs` 通过 `Code.require_file/1` 加载；文件只定义 helper，不启动 ExUnit、不初始化 env、不启动 owner。
- [agent_event_relay_helper.exs](agent_event_relay_helper.exs)：定义 `NovelApplication.TestAgentEventRelay`。它通过公共 `AgentRunService.subscribe_events/2` 建立真实测试订阅者，`observe/2` 订阅后原样返回 run attrs，`subscribe/4` 供 recover/confirmation 等路径先显式订阅；只转发真实 Registry `AgentEvent`，不镜像服务 API、不向生产传测试选项。仅供测试通过 `Code.require_file/1` 加载。
