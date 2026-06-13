# Frontend Stack

前端技术栈以 `docs/design/tech-stack/04-frontend.md` 和 `docs/design/tech-stack/05-desktop.md` 为权威来源。

## Required

| 类别 | 技术 |
|---|---|
| Runtime | Tauri 2 desktop-first |
| UI | React + Radix UI headless primitives |
| Style | Tailwind CSS 4 |
| Server State | TanStack Query |
| UI State | Zustand |
| Form | React Hook Form + Zod resolver |
| Icon | Lucide |
| Schema | Zod 4 + codegen |

## Guard

```bash
cd frontend && pnpm typecheck && pnpm lint && pnpm test && pnpm build
bash scripts/frontend_audit.sh
bash scripts/check_design_trace.sh
```

