# Architecture Boundaries

本页是架构边界索引，权威规则仍位于 `AGENTS.md`、`docs/engineering/architecture-guardrails.md` 和各 umbrella app 的 `mix.exs`。

## Umbrella Direction

```text
novel_web -> novel_application -> {novel_agent, novel_domain}
novel_agent -> novel_foundation
novel_domain -> novel_foundation
```

禁止方向：

- `novel_foundation` 依赖任何其他 umbrella app。
- `novel_domain` 依赖 `novel_agent` / `novel_application` / `novel_persistence` / `novel_web`。
- `novel_agent` 依赖 `novel_domain` / `novel_application`。
- `novel_web` 直接依赖 `novel_persistence` / `novel_agent`。
- `novel_e2e` 直接引用 downstream app 内部模块。

## Guard

```bash
mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs
```

