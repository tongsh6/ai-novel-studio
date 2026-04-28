# 文档与注释

注释仅解释 WHY，不解释 WHAT。代码本身负责说明 HOW。

## 8.1 必须加注释的场景

| 场景 | 示例 |
|------|------|
| 隐藏约束 | `# 用户 ID 格式来自上游 Legacy System X` |
| 特定 BUG 的 workaround | `# 降级到 Enum.at/2，因为 :array.to_list 在 Erlang 27 有并发 BUG` |
| 非显而易见的性能选择 | `# 不合并这两个循环：实测各自遍历比一次合并快 3 倍（200k 行）` |
| 复杂的正则/匹配模式 | `# 匹配形如 "第X章 标题" 或 "Chapter X: Title"` |

## 8.2 禁止写注释的场景

```elixir
# BAD — 重复 WHAT
def get_title(turn), do: turn.title  # 获取标题

# BAD — 已注释掉的代码（直接删除，git 历史可找回）
# def old_method(x) do ...
```

## 8.3 `@moduledoc` / `@doc` 使用原则

```elixir
# GOOD — 解释模块的职责边界
defmodule NovelApplication.TurnService do
  @moduledoc """
  负责 Turn 生命周期的编排。
  不直接操作 Repo，通过 Repository 接口访问持久化层。
  """
end
```

```elixir
# GOOD — 公共 API 文档含类型签名和返回说明
@doc """
根据 turn_id 获取 Turn 完整信息。

返回 `{:ok, %Turn{}}` 或 `{:error, :not_found}`。
"""
@spec get_turn(String.t()) :: {:ok, %Turn{}} | {:error, :not_found}
def get_turn(turn_id) do
  ...
end
```

## 8.4 `@spec` 和类型标注

- 所有公有函数必须标注 `@spec`
- 类型定义集中放在模块顶部
- 使用 `@type` 而非散落的 Guard

## 8.5 Moduledoc 不写的内容

- 不放变更历史（git log 负责）
- 不放使用示例（那是 README 或测试的职责）
- 不放内部实现细节（那是代码自身的职责）
