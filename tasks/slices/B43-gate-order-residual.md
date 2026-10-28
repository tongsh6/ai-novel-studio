# B43：Execution Gate 残余——行为输入、幂等输入与 blocked 链

- 状态：**blocked（产品实施待 B49 主链语义裁决；CP0 可先只读核查，未开工）**。
- 登记日期：2026-10-27；来源：12 门与 allow 路径已验收，但 blocked 页面、open_behavior/slot 顺序和同键异 payload 仍未闭合。
- 上游：ADR-0005、[GATE-ORDER-CLOSURE](GATE-ORDER-CLOSURE-execution-gate-order-12.md)、[B40](B40-judgment-era-acceptance-reanchor.md)、[B49](B49-core-semantics-and-adr-review.md)。

## 1. 真实缺口

1. `ActionIdempotencyLedger` 以 work/session/turn/action/idempotency_key 查 receipt，未比较 payload。相同 key 不同 `edited_content` 可能命中旧回执而不是拒绝或 recovery。
2. 普通 AgentRun step 的 open_behavior 未统一进入 GateOrder，MissingPolicy 又可能落在门后，导致真正 behavior/slot 阻断在 trace 中看起来像门已通过后的普通失败。
3. blocked 路径主要是单测，缺真实页面的 first_blocking_gate、DecisionTrace、Replay 与 no-tool/no-write 证据。

这些不是“12 门不存在”，而是已有实现的边界没有闭环。不能用 allow 路径 12 门全绿代替。

## 2. 开工七问

1. **Contract**：ADR-0005/0007/0027、GateOrder、AuthorActionInput/Receipt、open behavior、TurnResult/replay；复用 AuthorQuestion 的 payload_digest 先例，不另造第二幂等系统。
2. **Invariant**：同 key 同字节最多执行一次；同 key 异 payload 必须明确拒绝且不得执行；未解决 behavior/缺章/歧义章在正确门阻断；blocked 不产生 success claim 或生产写入；trace 与真实门一致。
3. **Boundary**：`novel_application` 的 GateOrder、ActionIdempotency、六个 AgentRun flow、TurnExecutionService、ActionValidator；persistence 仅按既有回执需要；web/frontend 只消费现有 author-safe 错误与 replay。
4. **Consumer**：Orchestrator、作者动作、Replay/why、外部验收与真实作者。
5. **Proof**：同 key 同/异 payload、open behavior、缺章/歧义章、重复执行/回滚、真实 blocked 页面与 replay；局部故障矩阵+可控真实 Tauri。
6. **Acceptance Driver**：候选 `agent-gate-blocked-lineage`，外部驱动真实工作台产生确定 blocked，核对 first_blocking_gate/reason、DecisionTrace、no tool/no write、Replay；产品验收感知逻辑 **no**。
7. **Exploration**：不新增作品要素；gate/behavior/回执/失败原因沿现有 trace/replay 可查，不靠 Channel 旁路掩盖。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 冻结 payload digest 计算、open_behavior/slot 输入与错误语义；确认 B49 对 multi-step/reply 语义的影响 | 未开工 |
| CP1 | 幂等输入一致性：同 key 同 payload 回放，同 key 异 payload 拒绝，不误报 duplicate、不二次写入；保留原成功回执 | 未开工 |
| CP2 | open_behavior/slot 在六个 flow 与 TurnExecutionService 统一进门；MissingPolicy 位置与 GateResult 顺序一致 | 未开工 |
| CP3 | blocked 真实页面与 replay：确定阻断、正确 first_blocking_gate/reason、no tool/no write、DecisionTrace/why 可读 | 未开工 |
| CP4 | 回归 allow 路径、B40 的场景重锚及既有 adoption/action 测试；不为通过而弱化负例 | 未开工 |

## 4. 非目标

- 不重建 GateOrder 或更换幂等体系。
- 不用 Channel 特判代替 flow 统一输入。
- 不用 allow 场景或修改断言掩盖 blocked。
- 不把 policy/safety 规则集无消费者扩展塞进本任务。
- 不把 D21 等旧确认场景漂移简单归因于 Gate，先核产品 confirmation 语义。

## 5. 验证与恢复

- 同 key 不同 `edited_content` 明确失败且零第二次写入；同 key 同字节保持幂等。
- open behavior、缺章、歧义章分别在预期 GateResult 阻断，writer/tool 未派发。
- 真实页面出现 blocked DecisionTrace 与 author-safe reason，replay 无 provider、无生产写入。
- 恢复时先核对 B49 的主链语义裁决与 B40 的场景处置，避免把旧 multi-step 语义重新带回。
