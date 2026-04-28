# AI 编码行为约束

本项目是 Elixir/Phoenix Umbrella + TypeScript/React 前端项目。以下规则适用于所有在此项目中工作的 AI 编码助手。

---

## 架构约束

### Umbrella 依赖方向（编译期强制，违反即编译失败）

```
novel_web → novel_application → {novel_agent, novel_domain}
novel_agent → novel_foundation
novel_domain → novel_foundation
```

- novel_foundation 不能依赖任何其他 umbrella app
- novel_domain 不能依赖 novel_agent / novel_persistence / novel_web
- novel_agent 不能依赖 novel_domain / novel_application
- novel_web 不能依赖 novel_persistence / novel_agent

### 各 app 职责边界

| App | 允许 | 禁止 |
|-----|------|------|
| novel_foundation | 纯函数工具、Result/Error 类型、ID 生成 | GenServer、Supervisor、Registry、Ecto、业务概念 |
| novel_domain | 纯 struct + 纯函数、领域规则、领域事件 | GenServer、Repo、Ecto、Phoenix、任何 I/O |
| novel_agent | Agent 运行时、Provider Gateway、监督树、Registry | 引用 NovelDomain / NovelApplication |
| novel_application | 用例编排、上下文组装、Prompt 构建、领域注册 | 引用 NovelWeb |
| novel_persistence | Ecto Repo、DB Schema、Migration、Repository | 引用 NovelWeb / NovelApplication / NovelAgent |
| novel_web | HTTP Router、Controller、Channel、JSON 序列化 | 直接调用 Repo、直接写 Ecto.Query |

---

## 编码规范

维度化编码规范见 [docs/coding-standards/index.md](docs/coding-standards/index.md)。新增或调整规范维度只需修改该目录下的文件，无需修改本文件。|

### 开始前必须做

1. 阅读目标 app 的 `mix.exs` 了解依赖关系
2. 阅读同目录已有模块，了解现有代码风格
3. 运行 `mix compile` 确认当前状态可编译

### 完成后必须做

1. `mix compile --warnings-as-errors` — 零警告
2. `mix test` — 全部通过
3. `mix xref graph --format cycles --label compile-connected --fail-above 0` — 无循环
4. `mix run scripts/arch_check.exs` — 架构边界正常
5. 为新模块写测试
6. 说明：修改了什么、为什么这样改、影响范围、验证方式

---

## 前端约束

- UI 组件放在 `frontend/src/components/`
- Phoenix Channel/Socket 封装放在 `frontend/src/lib/`
- 从 JSON Schema codegen 的 Zod schema 放在 `frontend/src/generated/`（不手编）
- 不要在组件中使用内联 `style={{...}}`，使用 CSS Modules 或独立 CSS 文件
- 环境相关 URL/配置通过 `import.meta.env.VITE_*` 环境变量注入，不硬编码

---

## 设计原则

- **YAGNI**：只加当前需要的代码，不提前设计未来可能需要的抽象
- **KISS**：优先简单直接的方案，不引入不必要的间接层
- **测试优先保护核心**：业务规则必须有测试，IO/边界层可适度放宽
- **最小改动**：只改任务要求的范围，不做无关重构

---

## 项目文档

- 设计文档：`docs/design-v2/`（权威，代码必须遵循）
- ADR：`docs/design-v2/adr/`（已冻结的决策）
- JSON Schema SSOT：`docs/design-v2/schemas/`
- 技术栈：`docs/design-v2/tech-stack/`
