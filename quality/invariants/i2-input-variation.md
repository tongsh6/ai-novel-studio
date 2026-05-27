# I2 Input Variation

I2 证明多个语义独立输入的 artifact item_id 集合两两不相交，用来捕获按输入无差别返回预制内容的实现。

## Driver

```bash
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
```

## Evidence

```text
artifacts/scenario-invariants/i2.md
artifacts/scenario-invariants/i2.json
```

