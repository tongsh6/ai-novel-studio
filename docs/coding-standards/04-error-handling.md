# 错误处理

统一错误处理模式，确保错误可追踪、可恢复、可理解。

## 持续重构原则：先追源头，再决定校验

新增或保留校验、拦截前，先追清数据生产、转换、写入和消费的真实路径，解释问题为何会发生。优先修正生产者、数据结构、状态提交和责任归属；源头不会产生的问题，不在下游增加拦截。

对真实外部输入或确实可能失败的边界，必要的解析与校验集中执行一次；内部消费已经建立的契约，不逐层重复检查、补默认值或建立新的错误分支。发现内部不变量被破坏时，修复产生该状态的源头，不能仅在末端隐藏结果。

这一原则贯穿设计、实现、测试和审查，也适用于既有逻辑。人工构造的异常样例、覆盖率或变异分数本身不是新增生产校验的依据；先确认路径可达和实际后果，再决定测试与实现。

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
