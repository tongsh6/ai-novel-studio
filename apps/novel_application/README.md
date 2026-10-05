# NovelApplication

**TODO: Add description**

## Installation

If [available in Hex](https://hex.pm/docs/publish), the package can be installed
by adding `novel_application` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:novel_application, "~> 0.1.0"}
  ]
end
```

Documentation can be generated with [ExDoc](https://github.com/elixir-lang/ex_doc)
and published on [HexDocs](https://hexdocs.pm). Once published, the docs can
be found at <https://hexdocs.pm/novel_application>.


## 消息闭环索引（ADR-0027）

- [lib/novel_application/turn_interaction_service.ex](lib/novel_application/turn_interaction_service.ex)：ADR-0027 消息接收、运行结果记录与历史来源校验入口。
- [test/novel_application/turn_interaction_service_test.exs](test/novel_application/turn_interaction_service_test.exs)：消息幂等、失败发布边界与来源回归。
- 完整切片：`tasks/slices/Q3D-message-outcome-roundtrip.md`。
