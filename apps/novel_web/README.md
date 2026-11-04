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
