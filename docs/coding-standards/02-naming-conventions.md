# 命名规范

模块、函数、变量的命名应准确表达意图，禁止模糊或误导性命名。

## 2.1 模块命名

### 规则

| 语言 | 模式 | 示例 |
|------|------|------|
| Elixir | `NovelApp.SubDomain.ModuleName` 驼峰 | `NovelApplication.TurnService` |
| TypeScript | PascalCase 文件名 + 默认导出 | `TurnService.ts` → `export default class TurnService` |
| TypeScript (React) | PascalCase 组件名 | `WorkspacePanel.tsx` |

### 禁止使用的后缀

| 禁止 | 原因 | 替代 |
|------|------|------|
| `Manager` | 含义模糊 | `Orchestrator` / `Coordinator` / `Service` |
| `Handler` | 含义模糊 | 按行为命名：`Processor` / `Validator` / `Dispatcher` |
| `Helper` | 万能垃圾箱 | 拆分为职责明确的模块 |
| `Utils` | 同上 | 同上 |
| `Common` | 同上 | 同上 |
| `Processor` | 过于泛化 | 说明处理什么：`TurnProcessor` |

### 通用避免词

- `data`、`info`、`stuff`、`things` 不表达任何含义
- `new`、`old`、`temp` 暗示时间性，应用版本号或日期

## 2.2 函数/方法命名

### Elixir

| 场景 | 模式 | 示例 |
|------|------|------|
| 纯函数 | 动词/动词短语 | `calculate_cost/1`、`validate!/1` |
| 有副作用的函数 | `动词_后缀` | `create_turn!/1`、`save/2` |
| 返回 `{:ok, result}` | `动词` | `fetch_turn/1` → `{:ok, turn}` |
| 返回 `{:error, reason}` | `动词`（同上） | `fetch_turn/1` → `{:error, :not_found}` |
| 断言/检查 | `?` 结尾 | `valid?/1`、`published?/1` |
| 转换 | `to_` 前缀 | `to_json/1`、`to_struct/1` |

### TypeScript

遵循 TypeScript 命名惯例：函数名 camelCase，布尔值用 `is`/`has`/`can` 前缀。

## 2.3 变量命名

- 变量名长度与作用域正相关：短作用域可用短名，长作用域必须用描述性名称
- 避免缩写，除非是行业通用缩写（`HTML`、`API`、`JSON`）
- Elixir 中 `_` 前缀表示未使用的参数

## 2.4 数据库/迁移命名

- 表名：复数 `snake_case`（`works`, `turns`）
- 字段名：`snake_case`
- 迁移文件名：`YYYYMMDDHHMMSS_description.exs`
