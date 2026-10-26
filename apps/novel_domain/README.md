# NovelDomain

**TODO: Add description**

## Installation

If [available in Hex](https://hex.pm/docs/publish), the package can be installed
by adding `novel_domain` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:novel_domain, "~> 0.1.0"}
  ]
end
```

Documentation can be generated with [ExDoc](https://github.com/elixir-lang/ex_doc)
and published on [HexDocs](https://hexdocs.pm). Once published, the docs can
be found at <https://hexdocs.pm/novel_domain>.


## 分段计划

- [ProseFormatting](lib/novel_domain/prose_formatting.ex)：ADR-0029的纯边界视图与换行应用，供Application预览及Persistence采纳复算。
- [算法测试](test/novel_domain/prose_formatting_test.exs)：非换行字节保真、Unicode、原换行、过期及非法计划。
