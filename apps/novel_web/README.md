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

## B71 显式压缩作者入口（VS-00L §16.2/§16.4）

- [workspace_channel.ex](lib/novel_web/channels/workspace_channel.ex)：`agent_command` 新增 `compact_transcript` 命令（作者显式整理意图）；只携带 `run_id`，覆盖范围/证据/摘要由 application 从 canonical 事实派生。复用既有归属校验、错误 payload 与运行控制 ack 形状；成功回执 additive `compaction`（整理项数/摘要/省略/来源显示名），不新增 Channel 事件或协议。
- [workspace_channel_command_ack.ex](lib/novel_web/channels/workspace_channel_command_ack.ex)：`agent_command` 回执形状的唯一所属点（运行控制与压缩共用）；独立模块承接超限 channel 文件的新增回执投影（模块规模规则）。
- [workspace_channel_compaction_test.exs](test/novel_web/channels/workspace_channel_compaction_test.exs)：真实 Channel 下的作者显式整理回执、canonical 前缀不变/checkpoint 先提交、幂等「无可整理项」、执行中拒绝、跨作品/会话归属拒绝与无会话错误。


