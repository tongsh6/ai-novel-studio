# Runtime Invariants

I1 / I2 / I3 是运行时内容来源不变量。

它们证明：

- user-facing 创作内容与 provider 输出存在因果绑定；
- 独立输入会产生不同输出；
- 用户 nonce 会贯通到最终 artifact 内容。

它们不证明：

- 用户能在真实 UI 中完成工作流；
- 采纳、拒绝、恢复能通过可见控件完成；
- 点击之后 persistence 和 projection 正确；
- Tauri 桌面打包可用。

因此，场景化验收必须保持独立，并且必须从产品外部驱动真实 product surface。

## Drivers

```bash
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
```

## 后续任务建议

新增主链级 I3 driver：

```text
scripts/scenario_invariants/run_i3_main_chain.exs
```

目标是通过 `DialogueGateway.handle_input` 主链进入；如果主链产生 user-facing artifact，则 artifact item 的 title/body/rationale 中必须出现 nonce。该 driver 不应替代现有 I3，也不应削弱 I1 / I2 / I3。

