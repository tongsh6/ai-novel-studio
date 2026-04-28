# 模块边界

模块和 App 必须有清晰的职责界限，禁止跨边界引用。

## 3.1 App 间依赖（AGENTS.md 强制规则）

参见 `AGENTS.md` 中的「架构约束」章节。编译期强制，违反即编译失败。

**简记**：`novel_web → novel_application → {novel_agent, novel_domain} → novel_foundation`

## 3.2 模块大小

| 指标 | 上限 | 说明 |
|------|------|------|
| 单个模块行数 | 300 行 | 超过考虑拆分 |
| 单个函数行数 | 20 行 | 超过考虑提取子函数 |
| 函数参数数 | 4 个 | 超过考虑用 Map 或 Struct |

## 3.3 模块内聚

同一模块内的所有公有函数应在同一抽象层级上操作同一概念：

```elixir
# BAD — 混合了兴趣点计算和存储
def calculate_interest(principal, rate), do: principal * rate
def save_to_db(result), do: Repo.insert(result)

# GOOD — 职责分离
defmodule InterestCalculator do
  def calculate(principal, rate), do: principal * rate
end
defmodule InterestRepository do
  def save(result), do: Repo.insert(result)
end
```

## 3.4 循环依赖

禁止模块间相互引用。如果出现双向引用，提取共同依赖到新模块。

```elixir
# BAD — A 引用 B，B 引用 A
defmodule A, do: def run, do: B.work()
defmodule B, do: def work, do: A.run()

# GOOD — 提取公共协议
defmodule Protocol, do: @callback run()
defmodule A, do: def run, do: Protocol.run()
defmodule B, do: def work, do: Protocol.run()
```

## 3.5 文件与模块一致性

- 一个文件只定义一个主模块（可包含同模块的私有子模块）
- 文件名必须与主模块名的最后一段一致（`NovelApplication.TurnService` → `turn_service.ex`）
