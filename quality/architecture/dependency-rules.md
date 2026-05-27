# Dependency Rules

依赖规则用于保护 compile-time 边界和测试边界。

## Backend

- 新增跨 app 调用前先确认被调用模块是否是公开入口。
- E2E 只能通过 `novel_web` 顶层入口和允许的 application gateway 进入。
- Web 层不得直接调用 Repo 或手写 Ecto query。

## Frontend

- 不新增 spec 外的状态管理、样式或 UI 依赖。
- 不用 browser-only API 替代 Tauri 平台抽象。
- 不把测试 fixture 或 slice provider 放入生产默认启动路径。

## Guard

```bash
mix run scripts/arch_check.exs
bash scripts/frontend_audit.sh
```

