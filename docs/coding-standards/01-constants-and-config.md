# 常量与配置

消除硬编码，确保所有可变值通过常量、模块属性、配置文件或环境变量管理。

## 规则

### 1.1 禁止 Magic Number / Magic String

所有非零、非空、非平凡的字面值必须提取为具名常量。

```elixir
# BAD — 硬编码
defp page_size, do: 20

# GOOD — 具名模块属性
@page_size 20
defp page_size, do: @page_size
```

```typescript
// BAD — 内联字面量
const result = await api.fetch({ timeout: 5000 });

// GOOD — 具名常量
const API_TIMEOUT_MS = 5000;
const result = await api.fetch({ timeout: API_TIMEOUT_MS });
```

**例外**（可直接使用字面值）：
- `0`、`1`、`true`、`false`、`nil` / `null`
- 空字符串 `""`、空列表 `[]`、空 map `%{}` / `{}`
- 数学/逻辑运算中的自然零值

### 1.2 配置值必须通过配置系统注入

Elixir 侧使用 `Application.get_env/3` 或 `config/` 文件；前端使用环境变量。

```elixir
# BAD — 模块内硬编码 URL
@api_url "https://api.example.com"

# GOOD — 从 config 读取
@api_url Application.compile_env(:novel_agent, :api_url)
```

```typescript
// BAD — 源码中的 URL
const API_BASE = "https://api.example.com/v1";

// GOOD — 环境变量
const API_BASE = import.meta.env.VITE_API_BASE_URL;
```

### 1.3 业务阈值与开关量必须显式声明

```elixir
# BAD — 业务规则散落在函数中
def too_long?(text), do: String.length(text) > 1000

# GOOD — 阈值显式声明
@max_chapter_length 1000
def too_long?(text), do: String.length(text) > @max_chapter_length
```

### 1.4 跨模块共享常量使用模块函数

```elixir
# BAD — 各模块各自定义相同含义的常量
# module_a.ex: @timeout 5000
# module_b.ex: @timeout 5000

# GOOD — 集中定义，按模块引用
defmodule NovelFoundation.Constants do
  @moduledoc "跨模块共享常量，禁止硬编码副本"

  @api_default_timeout_ms 5000
  def api_default_timeout_ms, do: @api_default_timeout_ms
end
```

### 1.5 枚举值使用 Ecto 枚举或 Union 类型

```elixir
# BAD — 字符串散落各处
status == "published"

# GOOD — Ecto 枚举或 Union
@type status :: :draft | :published | :archived
```

### 1.6 数组/列表常量不可在模块中变异

```elixir
# BAD — 每次调用返回同一份引用
@valid_statuses [:draft, :published, :archived]
def valid_statuses, do: @valid_statuses

# GOOD — 返回新副本
@valid_statuses [:draft, :published, :archived]
def valid_statuses, do: @valid_statuses
```

## 检查点

- 所有新增字面量：是否可以用具名常量替代？
- 所有配置文件值：是否有硬编码 fallback？
- 所有业务阈值：是否显式声明的常量？
- 所有 URL/Token：是否来自环境变量或配置文件？
