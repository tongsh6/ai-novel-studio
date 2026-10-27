# B45：Schema Legacy 治理—— legacy、现役与真实消费者

- 状态：**todo（治理任务，未开工；不增加业务字段）**。
- 登记日期：2026-10-27；来源：v2 `$ref` 缺失导致 `z.any()`、旧 enum 与现行 v3 不一致、部分生成物无法提供有效校验。
- 上游：[B49](B49-core-semantics-and-adr-review.md)、[B06 五账 schema](../2026-10-27-design-to-execution-reconciliation.md)、[DS01](DS01-decision-surface-schema-gate.md)、[schemas/README](../../docs/design/schemas/README.md)。

## 1. 问题

`turn_result_v2` 多个 `$ref` 目标不在 schema 树，codegen 会把不可解析位置降级为 `z.any()`；`phase_next_action_compat` 等生成物也不是有效约束。旧大写 TurnPhase/NextAction/Status 与现行 v3 小写 wire 不是一套语义，`behavior_status` 还缺当前状态值。

风险不是“老文件没删干净”，而是：

- 把 legacy 的宽松/失效结构误当现行 SSOT；
- 把有意的现行 v3 局部校验误写成全面收紧；
- 为追求形式完整重新引入旧架构或无消费者字段。

## 2. 开工七问

1. **Contract**：schemas README、codegen、Foundation 兼容测试、现行 TurnResult v3/barrel、B49 的 enum/action 退役裁决与 VS-00F 的真实 wire consumer。
2. **Invariant**：legacy 与现役不可混用；每个 `$ref` 可解释；不得把意外 `z.any()` 当收紧；不得为消账盲删兼容层或新增字段；现行 v3 行为不变。
3. **Boundary**：schemas、frontend codegen/generated、必要兼容测试和文档；不改生产业务对象，不新增 UI/表。
4. **Consumer**：当前 v3 前端、Foundation 兼容层、codegen 维护者与后续 slice。
5. **Proof**：引用解析矩阵、legacy/现役 wire 对照、生成物非意外 any、现行 safeParse/真实页面不变、旧兼容测试归属明确。
6. **Acceptance Driver**：codegen/schema 自动检查与负例为主，必要时选现行 Channel/前端真实帧验证；产品验收感知逻辑 **no**。
7. **Exploration**：schema 来源与 legacy 状态可查；无消费者的字段不生成新功能，不新增探索面。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 全量 `$ref`/enum/生成物盘点：legacy、现役、真实消费者、x-adr/x-source 血缘、意外 any 与有意 open 分类 | 未开工 |
| CP1 | 决定每类处置：保留兼容、显式 opaque、补本地定义、隔离 legacy 或退役；B49/B06 相关项联动，不盲补旧架构 | 未开工 |
| CP2 | 实施隔离/注释/必要 schema 修正与生成器防误用；不让 legacy 进入当前 wire 误校验 | 未开工 |
| CP3 | codegen 与现行 v3 回归、负例、文档/README 更新；旧兼容测试逐项归属 | 未开工 |

## 4. 非目标

- 不删除所有旧 schema 或把所有 `z.any()` 都当错误。
- 不把 `turn_result_v3.additionalProperties=true` 与 barrel 的局部收紧改写成全面封闭。
- 不为“更严格”新增无消费者字段、卡片、工具或 UI。
- 不处理 DS03 当前 `agent_run_state` 新 schema；它沿 DS03 尾项单独推进。
- 不把旧 enum 的 x-adr/x-source 直接改成“看起来更合理”而不查历史血缘。

## 5. 验证与恢复

- 所有现行 `$ref` 可解析或有明确 opaque/legacy 解释；没有意外 `z.any()` 被写成 SSOT。
- legacy 不污染当前 v3 safeParse/页面行为；兼容测试不被误删或误改。
- 恢复时先读 B49 的语义裁决和 VS-00F schema 任务；没有真实消费者的字段不进入实现队列。
