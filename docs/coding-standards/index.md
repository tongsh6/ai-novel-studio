# 编码规范

本目录按维度逐层细化编码规范，适用于本项目中所有 AI 编码助手和人类开发者。

## 维度总览

| 维度 | 聚焦问题 | 粒度 |
|------|----------|------|
| [01 — 常量与配置](01-constants-and-config.md) | 硬编码、Magic Number、配置泄漏 | 每一条规则可独立检查 |
| [02 — 命名规范](02-naming-conventions.md) | 命名不一致、模糊命名 | 按语言/上下文分组 |
| [03 — 模块边界](03-module-boundaries.md) | 模块职责漂移、循环依赖 | 按架构层级分组 |
| [04 — 错误处理](04-error-handling.md) | 吞异常、错误类型不统一 | 按错误传播层级分组 |
| [05 — 测试规范](05-testing-standards.md) | 测试覆盖盲区、脆弱测试 | 按测试类型分组 |
| [06 — Elixir 惯用模式](06-elixir-idioms.md) | 非惯用 Elixir 写法 | 按语言特性分组 |
| [07 — 前端规范](07-frontend.md) | React/TypeScript 反模式 | 按组件层级分组 |
| [08 — 文档与注释](08-documentation.md) | 过度注释/缺失注释 | 按注释场景分组 |

## 快速查找

遇到以下问题 → 查阅对应文档：

| 问题 | 文档 |
|------|------|
| 这个数字/字符串应该写成常量吗？ | [01 — 常量与配置](01-constants-and-config.md) |
| 模块叫什么名字好？ | [02 — 命名规范](02-naming-conventions.md) |
| 代码应该放在哪个 app？ | [03 — 模块边界](03-module-boundaries.md) |
| 函数该返回什么错误？ | [04 — 错误处理](04-error-handling.md) |
| 这个功能要不要写测试？ | [05 — 测试规范](05-testing-standards.md) |
| 用 `case` 还是模式匹配？ | [06 — Elixir 惯用模式](06-elixir-idioms.md) |
| 组件可以内联 style 吗？ | [07 — 前端规范](07-frontend.md) |
| 这段逻辑需要加注释吗？ | [08 — 文档与注释](08-documentation.md) |

## 优先级

1. **常量与配置** — 所有编码行为的第一道检查点
2. **模块边界** — 其次是架构边界
3. **命名规范** — 再其次是命名与组织
4. 其余维度按需查阅
