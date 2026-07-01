# Scenario Invariants Index

本目录放机器强制的场景化不变量 driver。它们从真实主链入口验证 anti-hardcode / causal binding / input variation，不应被产品代码感知或绕过。

| 文件 | 角色 |
|---|---|
| `run_i1_causal.exs` | I1 因果绑定：artifact item 必须与 Provider 响应字段精确绑定。 |
| `run_i2_variation.exs` | I2 输入差异：语义独立输入产出的 artifact item_id 集合不得重叠。 |
| `run_i3_nonce.exs` | I3 种子贯通：用户输入随机标识符必须出现在最终用户可见 artifact 内容字段。 |
