# VS-00M · 完整模型交互设计候选审查材料

本目录属于 [VS-00M 设计候选](../VS-00M-model-interaction-request-response-contract-pack.md) 的审查附件，不是另一份冻结协议。其应用对象是非持久化设计视图，不新增生产 RequestIR、能力注册表或采纳事实源。

**源基线**：`f13ff6406a002eff54397b906872255048c31763`；**本次归档核对基线**：`04492ea3b7a08cd4ce363110c099c6b4446a7488`。两者不混用；最新输出通道/envelope/SSE 变更见 [归档说明与差异](integration-notes.md)，未将旧草案假定为已符合当前合同。

## 阅读顺序

1. [完整局部修订请求／响应／系统结果](../../../../quality/acceptance/fixtures/model-interaction/exchanges/05-full-local-revision.json)：唯一完整主样例，合成数据，不是线上日志。
2. [拆分阅读视图](../../../../quality/acceptance/fixtures/model-interaction/read-first/README.md)与[三类 Provider 参考报文](../../../../quality/acceptance/fixtures/model-interaction/wire/README.md)。
3. [协议规范](01-protocol-spec.md) → [逐字段字典](02-field-dictionary.md) → [状态与不变量](03-state-and-invariants.md)。
4. [九份候选 Schema](../../schemas/model-interaction/README.md)与[场景和反例覆盖矩阵](../../acceptance/model-interaction-coverage.md)。
5. [可重复执行的离线验证](../../../../scripts/model_contracts/model_interaction/README.md)；报告只能生成到 `artifacts/model-contracts/vs00m-design/<run>/`。

## 文件与子目录索引

| 路径 | 职责 |
|---|---|
| [00-sources.md](00-sources.md) | 原固定基线来源及可信边界；不自动更新成当前实现事实 |
| [01-protocol-spec.md](01-protocol-spec.md) | 原包协议规范，保留原有字段与表述；导航已调整 |
| [02-field-dictionary.md](02-field-dictionary.md) | 原包生成的逐字段字典，与 JSON 字典配套，不是另一字段定义源 |
| [03-state-and-invariants.md](03-state-and-invariants.md) | 生命周期、错误/恢复和系统事实边界 |
| [04-provider-mapping.md](04-provider-mapping.md) | 离线参考映射；不替代现役 adapter，不签真实 API 验收 |
| [05-existence-audit-and-gaps.md](05-existence-audit-and-gaps.md) | 原包存在性审计与未决点 |
| [07-implementation-and-review.md](07-implementation-and-review.md) | B87 既有批次消费关系，不维护第二任务状态 |
| [integration-notes.md](integration-notes.md) | 归档决策、已知新旧差异、去重、codegen 和验证边界 |
| [integration-manifest.json](integration-manifest.json) | 文件迁移映射、哈希、别名去重与原包出处；由校验器消费 |
| [sources.json](sources.json) | 原包来源索引，固定基线不变 |
| [reference/](reference/README.md) | 要素/字段/工具/任务类型的审查快照；不是第二生产注册表 |

## 设计归属和验收归属

上游始终是 [VS-00M](../VS-00M-model-interaction-request-response-contract-pack.md)、[VS-00L](../VS-00L-authoring-run-transcript-request-ir-contract-pack.md) 与领域设计；实际执行状态只在 [B87](../../../../tasks/slices/B87-model-interaction-request-projection.md)。

离线工具通过只表示原包合成样例的自洽性，不表示 R00–R19 完成、契约 Frozen、Elixir 接线、Tauri 实测、数据库授权/事务或文学质量已通过。本次归档不修改生产代码，不自动启用生成类型，不注册正式 PASS 场景。
