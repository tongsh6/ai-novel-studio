# I3 Nonce Propagation

I3 证明用户输入中的一次性随机标识符会进入最终 user-facing artifact 内容字段。

## Driver

```bash
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
```

## Evidence

```text
artifacts/scenario-invariants/i3.md
artifacts/scenario-invariants/i3.json
```

## Boundary

I3 不证明真实 UI、Tauri desktop packaging、persistence projection 或 author action 链路完整。它必须与 `quality/acceptance/scenarios.yml` 中的场景化验收互补。

