# NovelPersistence

**TODO: Add description**

## Installation

If [available in Hex](https://hex.pm/docs/publish), the package can be installed
by adding `novel_persistence` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:novel_persistence, "~> 0.1.0"}
  ]
end
```

Documentation can be generated with [ExDoc](https://github.com/elixir-lang/ex_doc)
and published on [HexDocs](https://hexdocs.pm). Once published, the docs can
be found at <https://hexdocs.pm/novel_persistence>.


## 消息闭环索引（ADR-0027）

- [lib/novel_persistence/interaction_lifecycle.ex](lib/novel_persistence/interaction_lifecycle.ex)：复用 Interaction 的接收/结果幂等持久化及同会话状态投影。
- [test/novel_persistence/interaction_lifecycle_test.exs](test/novel_persistence/interaction_lifecycle_test.exs)：原文不可变、采纳状态与作用域回归。
- 完整切片：`tasks/slices/Q3D-message-outcome-roundtrip.md`。

## B26 / B27 共享入口

- [author_question_repo.ex](lib/novel_persistence/author_question_repo.ex)：单调用共同任务、明确问题来源与持久回复链的实现/验证；契约见 UA-01 §2.2 与 VS-00D §11。

- [author_content_registration.ex](lib/novel_persistence/author_content_registration.ex)：B26 结果提交事务内重验原文来源，重复登记返回已有对象事实。
