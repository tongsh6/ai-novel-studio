# B49：主链语义收窄与 ADR 评审

- 状态：**todo（评审先行；未授权按旧 Accepted 字面直接改代码）**。
- 登记日期：2026-10-27；来源：primary/reply-only/next_action/output contract 的 Accepted 字面与当前实现不同，ADR-0022 的历史语义也已被后续协议改变。
- 上游：ADR-0001/0002/0003/0004/0007/0012/0022/0023/0025、[B27](B27-systematic-prompt-and-intent-integration.md)、[B43](B43-gate-order-residual.md)、[B45](B45-schema-legacy-governance.md)。

## 1. 需要裁决的不是“补还是重做”

当前实现已经选择 step frame、reply-only trace、available_actions、creative/typed output 等新载体，但 Accepted 文本仍要求另一组字段或全集。直接补齐会制造无消费者对象，全部称“文档化偏差”又会掩盖真实越权风险。

本任务先统一四类决策：

1. primary frame / 一个 primary plan 与 reply-only 的真实边界；
2. reply-only 是否必须产生 OrchestratorDecision，以及 decision/status/type 的当前子集；
3. `continue_dialogue / no_further_action / retry_action / narrow_scope / primary_next_action` 等无真实生产者动作的退役或保留；
4. 只读 output 是否都必须统一 schema 校验，以及哪些类型走显式 opaque/局部 contract。

同时评审 ADR-0022：其 N-NARR、PlanStep、重规划已有实现，但“每次 observe 都 evaluate”和旧调用协议已被 ADR-0023/0025/B26 改变，不能整份原样接受。

## 2. 评审范围与选项

- **A：按旧字面补齐**：仅在能证明真实消费者时保留，禁止为形式完整造字段。
- **B：以当前实现为基准收窄**：明确哪些语义是当前有效契约、哪些旧段 superseded，保留真实安全边界。
- **C：新 ADR 承接并部分替换**：把不可共存的历史决策拆成保留、收窄、退役三组，不能用一份“当前实现说明”冒充裁决。

ADR-0022 另需选择：接受现行语义、以新 ADR 承接，或把旧段标 superseded。转 Accepted 必须补 `enforced_by/enforcement_gaps` 并通过 adr_trace。

## 3. 开工七问

1. **Contract**：上述 ADR、当前 TurnResult v3/barrel、JudgmentProtocol/AgentPlan/AuthoringTask、GateOrder、Replay。裁决前只更新评审材料，不直接改生产。
2. **Invariant**：每个保留字段/动作都有真实消费者；安全语义不减弱；历史决策不静默改写；Proposed/Accepted/Superseded 与实际实现可追溯。
3. **Boundary**：docs/design/adr、contracts、schemas、00c、tasks 与必要测试。代码实现等裁决后另按 B01/B43/B45 等任务执行。
4. **Consumer**：后续 Planner/Gate/schema/前端/replay 实现者与评审者。
5. **Proof**：新 ADR 明确 supersede/收窄关系、保留/退役清单与真实 consumer；adr_trace 通过；B01/B43/B45 有明确可执行边界。
6. **Acceptance Driver**：评审阶段以当前代码/场景证据矩阵为主；实施后按各承接任务的真实 Tauri 场景验收，产品验收感知逻辑 **no**。
7. **Exploration**：每项决策可回查生产 consumer 和证据；无消费者的字段不进入新探索面或 UI。

## 4. 评审交付物

1. 主链语义对照表：Accepted 字面、当前实现、真实消费者、保留/收窄/退役选择及理由。
2. ADR-0022 现行语义对照表：N-NARR/PlanStep/replan 的已实现部分与历史段冲突，不能只挑已实现部分转 Accepted。
3. 新 ADR 或修订关系提案及索引更新；明确 B01 Planner、B43 Gate、B45 schema、B12 S7、B18 legacy 各自后续范围。
4. 不把 B27 的语义 known-gap、B39 求证评审和 I10 文学盲评混入本任务的通过条件。

## 5. 非目标

- 不新建 Router、第二套 runtime 或旧 Envelope。
- 不把 Accepted 当实现完成，也不把当前实现直接当 Accepted。
- 不为消 ADR gap 补无生产者动作、字段或按钮。
- 不直接修改历史 ADR 的最终决策段来“对齐”而不留替代关系。
- 不以 B27 全量 retest 或 B39 评审替代本裁决。

## 6. 验证与恢复

- 评审材料中的每个“保留”都有真实 consumer，每个“退役”都有替代证据或无消费者证明。
- 新 ADR 若转 Accepted，必须有 `enforced_by` 与未完成 `enforcement_gaps`，adr_trace 通过。
- 恢复时先读 B43/B45 的依赖，避免同时改多套语义；B27 的实模门槛和 I10 继续独立。
