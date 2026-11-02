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
