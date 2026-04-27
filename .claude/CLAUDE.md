@AGENTS.md

# 项目特定指令

## 技术栈

- 后端：Elixir 1.19 + Erlang/OTP 28 + Phoenix 1.8（API only, no LiveView）
- 数据库：PostgreSQL + Ecto 3.x + paper_trail（审计）
- 前端：TypeScript 6 + React 19 + Vite 8 + Tauri 2
- 包管理：Mix（Elixir）+ pnpm（Node）
- 测试：ExUnit（Elixir）+ Vitest（TypeScript）
- CI：GitHub Actions

## 常用命令

```bash
# 编译
mix compile --warnings-as-errors

# 测试
mix test                          # 全部后端测试
(cd frontend && pnpm test)        # 全部前端测试

# 代码质量
mix format --check-formatted      # 格式检查
mix credo --strict                # 静态分析
mix xref graph --format cycles --label compile-connected --fail-above 0  # 循环依赖

# 架构门禁
mix run scripts/arch_check.exs

# 一键全部门禁
MIX_ENV=test mix check

# 前端
cd frontend && pnpm lint          # ESLint
cd frontend && pnpm build         # TypeScript 编译 + Vite 打包
cd frontend && pnpm codegen:schemas  # JSON Schema → Zod
```

## 关键文件

- 架构分析报告：`docs/design-v2/architecture-review-2026-04-28.md`
- 工程实践分析：`docs/design-v2/engineering-practice-review-2026-04-28.md`
- 设计文档入口：`docs/design-v2/README.md`
- 架构门禁脚本：`scripts/arch_check.exs`
- CI 配置：`.github/workflows/ci.yml`

## 当前阶段

Phase 0 Week 2 — 架构骨架已建立，监督树已打通，大部分 app 还是空壳。Phase 1 开始填充业务代码。
