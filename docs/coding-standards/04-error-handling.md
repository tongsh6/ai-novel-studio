# 错误处理

统一错误处理模式，确保错误可追踪、可恢复、可理解。

## 4.1 返回值 vs 异常

| 场景 | 模式 | 示例 |
|------|------|------|
| 预期可能失败 | `{:ok, result}` / `{:error, reason}` | 输入校验、外部调用 |
| 不应失败的内部逻辑 | 直接返回值 | 纯数学计算、状态转换 |
| 配置错误/程序员错误 | 抛出异常 | `raise "missing config"` |
| 断言前置条件 | `{:error, reason}`（不抛） | 参数校验 |

## 4.2 错误原因约定

`{:error, reason}` 中的 `reason` 优先使用原子（`:not_found`、`:unauthorized`），需要附加信息时使用元组：

```elixir
{:error, {:validation, "title must not be empty"}}
{:error, {:not_found, "turn #{turn_id}"}}
{:error, %{field: :title, message: "too long"}}
```

## 4.3 不吞错误

禁止裸 `rescue` / `try` 不处理：

```elixir
# BAD — 吞掉了所有异常
try do
  dangerous_call()
rescue
  _ -> :error
end

# GOOD — 记录日志或重新抛出
try do
  dangerous_call()
rescue
  e -> Logger.error("dangerous_call failed: #{Exception.message(e)}")
       {:error, e}
end
```

## 4.4 管道中的错误传播

使用 `with` 或 `case` 在管道中传播错误：

```elixir
# GOOD — with 模式
with {:ok, user} <- find_user(id),
     {:ok} <- authorize(user, action),
     {:ok, result} <- execute(user, action) do
  {:ok, result}
else
  {:error, :not_found} -> {:error, :user_not_found}
  {:error, :unauthorized} -> {:error, :forbidden}
end
```

## 4.5 前端错误

- API 错误统一通过 `Result<T, E>` 类型返回
- 组件不 catch 业务错误，向上冒泡到 error boundary
- 可恢复错误显示用户提示，不可恢复错误上报监控
