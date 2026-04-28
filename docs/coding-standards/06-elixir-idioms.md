# Elixir 惯用模式

确保代码遵循 Elixir 社区惯用模式，避免"其他语言风格"的 Elixir 代码。

## 6.1 模式匹配优先于控制流

```elixir
# BAD — 用 if/else 解包
if result == :ok do
  "success"
else
  "failure"
end

# GOOD — 模式匹配
case result do
  :ok -> "success"
  _ -> "failure"
end
```

## 6.2 管道运算符使用原则

```elixir
# GOOD — 管道整洁
list
|> Enum.filter(&active?/1)
|> Enum.map(&format/1)

# BAD — 超过 5 个管道应当命名中间结果
list
|> Enum.filter(&active?/1)
|> Enum.map(&format/1)
|> Enum.sort()
|> Enum.uniq()
|> Enum.take(10)
|> Enum.join(",")
```

超过 5 个管道时提取命名步骤：

```elixir
active_items = Enum.filter(list, &active?/1)
formatted = Enum.map(active_items, &format/1)
Enum.join(Enum.take(Enum.sort(Enum.uniq(formatted)), 10), ",")
```

## 6.3 私有函数命名

用 `do_` 前缀表示公有函数的私有实现：

```elixir
def process(data) do
  data |> validate() |> do_process()
end

defp do_process(validated_data) do
  # 实际实现
end
```

## 6.4 守卫子句 (Guard) 优先于 if

```elixir
# BAD
def validate(%{status: status}) do
  if status in [:draft, :published] do
    {:ok, status}
  else
    {:error, :invalid_status}
  end
end

# GOOD
def validate(%{status: status}) when status in [:draft, :published], do: {:ok, status}
def validate(_), do: {:error, :invalid_status}
```

## 6.5 用 Struct 而非原始 Map

领域概念必须用 Struct 定义，禁止函数间传递裸 Map：

```elixir
# BAD
def process_turn(%{id: id, title: title}) ...

# GOOD
def process_turn(%Turn{id: id, title: title}) ...
```

## 6.6 `with` 的正确使用

`with` 用于多步骤依赖操作，不用于单个条件：

```elixir
# GOOD — 多步骤
with {:ok, user} <- find_user(id),
     {:ok, session} <- create_session(user) do
  {:ok, {user, session}}
end

# BAD — 单步用 with 没必要
with {:ok, user} <- find_user(id), do: user
# 直接用 case
case find_user(id) do
  {:ok, user} -> user
  {:error, _} -> nil
end
```
