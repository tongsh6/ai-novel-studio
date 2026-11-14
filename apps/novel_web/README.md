# NovelWeb

**TODO: Add description**

## Installation

If [available in Hex](https://hex.pm/docs/publish), the package can be installed
by adding `novel_web` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:novel_web, "~> 0.1.0"}
  ]
end
```

Documentation can be generated with [ExDoc](https://github.com/elixir-lang/ex_doc)
and published on [HexDocs](https://hexdocs.pm). Once published, the docs can
be found at <https://hexdocs.pm/novel_web>.


## B71 作者动作入口（VS-00L §16.10）

- [workspace_channel.ex](lib/novel_web/channels/workspace_channel.ex)：质量发现修订不再 lookup→start→best-effort record；入口只从当前 work/session 持久 source 读取精确 TurnResult，新 run 经 `AgentRunService.start_author_action/3` 原子受理。ACK/`action_result` 复用既有 `agent_run_state_payload` 与已提交 `turn_results`，运行事实来自 `AgentRunService.receipt_run_facts/3`；新路径不写第二份 best-effort receipt，也不把 receipt 私有摘要字段暴露给作者。
- [workspace_channel_author_action_admission_test.exs](test/novel_web/channels/workspace_channel_author_action_admission_test.exs)：真实 DB fixture 与真实 Channel 进程下的并发受理、冲突、拒写回滚（含 topic 零 `run_started`）、终局/失败/运行丢失/迟到回执、ACK 事实投影与 source 权限边界。
- [workspace_channel_v3_test.exs](test/novel_web/channels/workspace_channel_v3_test.exs)：lobby 内存来源明确未受理，不再用假 socket source 冒充持久授权。

## B71 运行事件与自动整理记录

- [workspace_channel.ex](lib/novel_web/channels/workspace_channel.ex)：join 时按当前 work/session 订阅应用层事件；每个 Channel 只向自身连接推送运行事件、结果和状态。重连/恢复投影不会再次广播到其它窗口，也不注册第二套 run 回调。
- [workspace_channel_scoped_events_test.exs](test/novel_web/channels/workspace_channel_scoped_events_test.exs)：通过两个真实 Channel 的不同 transport 验证每个连接每事件一份，后加入连接不向其它窗口重放历史。
- [workspace_channel_action_idempotency_test.exs](test/novel_web/channels/workspace_channel_action_idempotency_test.exs)：重复作者动作复用已提交回执，不增加作用域订阅或重复执行。
- [workspace_channel_confirmation_handoff_test.exs](test/novel_web/channels/workspace_channel_confirmation_handoff_test.exs)：验证确认 child 的启动/工具事件实时到达并与持久记录同源，首个模型响应前已有可见进度。
- [workspace_channel_agent_events_test.exs](test/novel_web/channels/workspace_channel_agent_events_test.exs)：历史补拉只经 Application 查询入口，保持作用域、游标、作者安全投影与实时 wire 形状。
- 自动整理消费既有 `checkpoint_created` 事件。作者命令 `compact_transcript` 与其专属 Channel 测试已退役；应用内部压缩和安全点自动维护按 VS-00L §16.16/§18 执行，当前不提供手动整理 Channel 入口。
- [workspace_channel_command_ack.ex](lib/novel_web/channels/workspace_channel_command_ack.ex)：运行控制命令回执形状的所属点。

## B84 A3 Channel 测试资源所有权

16 个 Channel 测试模块统一使用 `NovelPersistence.DataCase, async: false` 获得事务与 Sandbox owner，不再各自手工 `Sandbox.start_owner!/stop_owner`，也不再调用已删除的全局 `await_quiescent`。

每个成功的 `subscribe_and_join/join` 都在测试进程内用 `NovelApplication.TestAgentRunCleanup.register_task_caller(socket.channel_pid)` 登记真实 Channel caller；Channel 的关闭仍由 Phoenix 原生 per-test Supervisor 与链接负责。凡成功 ACK、receipt 或 start 结果产生真实 live runtime 的用例，都在取得实际 `run_id` 后立即 `register_run/1`，再执行业务断言/故意 kill；持久 seed、历史 `runtime_live: false` 回执和 reject 产生的零 provider 记录不冒充 live run。退出时 run 与 caller 各自收口，其他 owner 不被等待或停止。

| 测试模块 | 角色 |
|---|---|
| [workspace_channel_test.exs](test/novel_web/channels/workspace_channel_test.exs) | 基础 join、消息作用域、user_message AgentRun ACK 与 live 行为投影 |
| [workspace_channel_v3_test.exs](test/novel_web/channels/workspace_channel_v3_test.exs) | v3 turn_result、author_action、候选继续、采纳/确认契约 |
| [workspace_channel_logging_test.exs](test/novel_web/channels/workspace_channel_logging_test.exs) | user_message start 日志契约与独立日志目录 |
| [workspace_channel_action_idempotency_test.exs](test/novel_web/channels/workspace_channel_action_idempotency_test.exs) | 持久幂等回执、冲突拒绝与重放 |
| [workspace_channel_confirmation_acceptance_test.exs](test/novel_web/channels/workspace_channel_confirmation_acceptance_test.exs) | 确认交接验收：竞态、写失败、离线源、Why、源/子身份与预算 |
| [workspace_channel_confirmation_handoff_test.exs](test/novel_web/channels/workspace_channel_confirmation_handoff_test.exs) | handoff child 的启动/tool_started 事件与 Provider 真值 |
| [workspace_channel_author_action_admission_test.exs](test/novel_web/channels/workspace_channel_author_action_admission_test.exs) | 作者动作受理并发、冲突、拒写回滚、运行丢失与迟到回执 |
| [workspace_channel_renumber_recompute_test.exs](test/novel_web/channels/workspace_channel_renumber_recompute_test.exs) | 重编号采纳后的机械账面重算触发与日志 |
| [workspace_channel_scoped_events_test.exs](test/novel_web/channels/workspace_channel_scoped_events_test.exs) | 双真实 transport 的作用域事件、重复 reconnect 不增订阅 |
| [workspace_channel_agent_events_test.exs](test/novel_web/channels/workspace_channel_agent_events_test.exs) | 断线重连按 run 补拉作者可见事件 |
| [workspace_channel_chapter_mission_test.exs](test/novel_web/channels/workspace_channel_chapter_mission_test.exs) | 本章使命确认/改写/作废的 Channel 投影 |
| [workspace_channel_planning_mission_test.exs](test/novel_web/channels/workspace_channel_planning_mission_test.exs) | 规划使命确认/改写/作废的 Channel 投影 |
| [workspace_channel_plan_next_volume_test.exs](test/novel_web/channels/workspace_channel_plan_next_volume_test.exs) | 开新卷动作的机械 scope 推导与 AgentRun 提交 |
| [workspace_channel_steer_binding_test.exs](test/novel_web/channels/workspace_channel_steer_binding_test.exs) | steer 目标版本冲突、域校验与 additive 绑定字段 |
| [workspace_channel_task_state_test.exs](test/novel_web/channels/workspace_channel_task_state_test.exs) | 会话恢复、导出 task_state、durable 恢复与 assumption 面 |
| [workspace_channel_work_profile_test.exs](test/novel_web/channels/workspace_channel_work_profile_test.exs) | 作品档案读投影与内部 id 不泄露 |

应用侧 helper 与生命周期边界见 [novel_application support README](../novel_application/test/support/README.md) 与 [agent_run_cleanup_test.exs](../novel_application/test/novel_application/agent_run_cleanup_test.exs)。
