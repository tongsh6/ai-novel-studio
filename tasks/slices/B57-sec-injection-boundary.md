# B57：提示注入与不可信内容边界（先补验）

- 状态：**todo（先以对抗证据判定最小修改，未开工）**。
- 登记日期：2026-10-27；来源：未检出专用 injection guard 或专项对抗验收，但 GateOrder/Orchestrator/adoption 已有结构防线，不能仅凭模块缺席断言无防护。
- 上游：`docs/design/foundation/10-security-and-budget.md`、[B39](B39-evidence-seeking-authoring.md)、[UA01-CP6 外部探索](UA01-judgment-driven-loop.md)、[SU01](SU01-file-level-closure.md)。

## 1. 目标

先用最小对抗矩阵回答“现有结构到底能挡住什么”，再决定是否实现防线，而不是预建空 Guard：

- 作者输入要求忽略 system、越权写库、直接采纳、泄露 secret；
- 作品正文、摘要、Observation 或外部资料中夹带同类指令；
- 模型被诱导把未读材料说成已读、把 tentative 说成 canon、把失败说成成功。

只有实际失败才实现最小防线；已通过的结构约束补成可复用证据，避免重复建设。

## 2. 开工七问

1. **Contract**：foundation 10 的权限/预算/输入信任边界、Orchestrator re-gate、adoption/author action、B39 observation 证据绑定、Provider secret redaction 与 UA01-CP6 出站授权。
2. **Invariant**：不可信内容不得提升权限、触发未授权 tool/canon 或泄漏 secret；来源指令只能当数据；TurnResult 诚实且 trace 可查；不把正常创作误判为攻击。
3. **Boundary**：外部对抗 harness、必要 application/provider/authority/adoption 边界；先用现有作者输入和作品观察，不修改生产数据、不预建 Guard、不改模型供应商。
4. **Consumer**：Provider Gateway、WorkspaceChat 作者、B39 observation 消费、UA01-CP6 外部资料与审计者。
5. **Proof**：每类注入都验证无未授权 tool/canon、无 secret 泄漏、TurnResult 诚实、trace 可查；现有链若失败才登记最小修复与回归。
6. **Acceptance Driver**：外部驱动真实工作台/观察输入，注入语料只在外部 harness 注入，产品代码不识别场景或提供测试后门。
7. **Exploration**：对抗输入的来源、观察、工具调用、回执和 trace 可查；外部资料只产生带来源的 tentative，采纳前不写 canon。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 冻结对抗矩阵：作者输入、作品观察、外部资料、伪已读/伪采纳/伪成功/泄密；明确不应误伤的正常创作 | 未开工 |
| CP1 | 在真实主链执行只读对抗，记录 tool/canon/secret/TurnResult/trace；区分结构防线已生效与真实缺口 | 未开工 |
| CP2 | 仅对失败类实现最小修复并复跑全矩阵；若全部已有防线通过，只登记证据，不新增 Guard | 未开工 |
| CP3 | 与 B39 observation、UA01-CP6 外部资料共用来源与权限复核；回归正常创作和 SU01 secret redaction | 未开工 |

## 4. 非目标

- 不把“没有 injection_guard 模块”当成无防护，也不预建空抽象。
- 不把模型说“我会遵守”当安全证明；必须看实际 tool/canon/secret/trace。
- 不以关键词屏蔽正常小说内容，不为通过率扩元词黑名单。
- 不允许外部资料直接写 canon 或隐式出站，授权边界不能由 prompt 自行放宽。
- 不用 stub 的成功回复证明真实模型一定安全；实模行为与结构机制分证。

## 5. 验证与恢复

- 所有注入类均无未授权 tool/canon/secret 泄漏；失败有 author-safe 说明和可追踪原因。
- 观察中的指令只被当数据，不能改变系统/作者权限或把未读材料升级为证据。
- 若需要修复，必须最小且可回滚，并同时证明正常创作不被误伤。
- 恢复时先读 foundation 10、B39、UA01-CP6 和 SU01，不直接新增 Guard。
