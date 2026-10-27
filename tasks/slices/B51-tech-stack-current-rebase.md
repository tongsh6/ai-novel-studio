# B51：技术栈与 Canonical 引用当前重定

- 状态：**todo（文档/必要 ADR，未开工；不倒装依赖）**。
- 登记日期：2026-10-27；来源：tech-stack 锁死依赖与当前自研 Gateway/codegen/Tauri sidecar 不一致，glossary/UI 引用和多处完成状态也互相矛盾。
- 上游：`docs/design/tech-stack/**`、`docs/design/foundation/30-contract-glossary.md`、`docs/design/07-workbench-ui-contract.md`、[B50](B50-multi-agent-current-boundary.md)、[B49](B49-core-semantics-and-adr-review.md)。

## 1. 范围

本任务不是按旧文档重装依赖，而是建立当前可核对的权威映射：

1. **依赖与运行时**：langchain、instructor_lite、GenStage、Horde、OTel 等声明与当前 mix.exs、Req/Gateway、自研 codegen、frontend/package、Tauri 配置逐项对账；PaperTrail 单独裁决。
2. **PaperTrail 生产真相**：依赖与 versions migration 存在，但生产调用未检出；现链使用 persisted `source_revision_ref + StateTrace`。只读检查 versions 存量与消费后，决定保留、替换或 supersede，不能直接删表或把 spike 当生产证据。
3. **Canonical 引用与状态**：glossary 错 ADR/死链、07 退役卡仍作前提、S4/S7 旧状态、D6/I5/B22/B34 等“已闭环/待办”前后冲突，全部改为当前证据链接。
4. **文档与工具口径**：frontend_audit、AGENTS、目录与命令、secret 的 local-file 方案、卡片集合、Tauri sidecar 与 CI 一致。

## 2. 开工七问

1. **Contract**：当前代码/lock/CI/Tauri 配置为生产证据，B50 的 Multi-Agent 裁决、B49 的主链语义、B13B 的 ADR enforcement、DS01 的现行 schema；旧文档只作历史输入。
2. **Invariant**：每个“锁定/必须”都有当前证据或 supersession；不为对齐旧文档倒装依赖；不删除历史验证；引用可解析、状态与原任务一致。
3. **Boundary**：docs/design、schemas、frontend_audit、必要 ADR 和 tasks；生产依赖安装/升级/卸载一律先经作者明确同意，不在本任务默认执行。
4. **Consumer**：AGENTS、frontend_audit、后续实现者、codegen/slice 规划者与旅程读者。
5. **Proof**：依赖/引用矩阵逐项通过；versions 只读证据与 revision/trace 替代链闭合；tech08 不再以全勾冒充验收；adr_trace、frontend_audit 与链接检查通过。
6. **Acceptance Driver**：以静态证据、只读 DB/代码/CI 检查为主；若保留 PaperTrail，另按 PG 服务/凭据安排真实版本写入验证，产品验收感知逻辑 **no**。
7. **Exploration**：当前依赖、历史决策、替代实现和证据可从文档与 ADR 回查；没有消费者的旧库不进入新实现。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 全量依赖/引用/状态矩阵：当前证据、历史拍板、真实消费者、保留/延期/退役候选；Multi-Agent 交 B50，不擅自统一 | 未开工 |
| CP1 | PaperTrail 只读 versions 与 `source_revision_ref` / StateTrace / Replay / Projection 消费核对，形成保留或替代 ADR；CI 未勾项明确归属 | 未开工 |
| CP2 | tech-stack 与 canonical 引用修订：退役卡不再作为当前推荐，S4/S7 与 ADR 一致，D6/I5/B22/B34 等状态链到当前证据 | 未开工 |
| CP3 | AGENTS/frontend_audit/目录/命令/secret/card/sidecar/CI 口径复核；必要 ADR 与任务登记，文档不反向要求倒装依赖 | 未开工 |

## 4. 非目标

- 不重装 langchain/instructor/OTel/GenStage/Horde，不为了旧“锁定”文本重新引入库。
- 不重复 2026 absorption Step A-C、B13B ADR enforcement 或 DS01 产品实现。
- 不直接删除 versions 历史表，不把 PaperTrail spike 当生产证据。
- 不把 D4 等用户旅程仅因多个子步骤 closed 就自动标为全生命周期 closed；需要真实 walkthrough 对照。
- 不统一处理 B50 的 Multi-Agent 决策，它必须由作者先裁决。

## 5. 验证与恢复

- 所有“锁定/必须”均有当前依赖证据或正式退役记录；旧“等待批准才能编码”只标历史阶段。
- PaperTrail 二选一闭环：真实版本记录可回查，或 ADR 明确 supersede 且现有 refs 足以证明 replay/stale。
- 恢复时先读 B50/B49 的最新裁决、当前代码与 lock，不从旧技术文档直接恢复实现。
