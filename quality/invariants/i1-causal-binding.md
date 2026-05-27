# I1 Causal Binding

I1 证明 user-facing artifact item 的内容字段与同一 turn 内 provider 响应中的对应 item 字节一致。

## Driver

```bash
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
```

## Evidence

```text
artifacts/scenario-invariants/i1.md
artifacts/scenario-invariants/i1.json
```

## Boundary

I1 不替代真实 UI 场景化验收。它只证明内容来源的运行时因果关系，不证明用户能通过可见控件完成采纳或恢复。

