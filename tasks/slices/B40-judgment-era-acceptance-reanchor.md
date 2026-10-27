# B40：判断纪元验收重锚与证据收口

- 状态：**todo（全量对账已登记，未开工；不默认修改产品代码）**。
- 登记日期：2026-10-27；来源：v3 全量对账发现“实现已演进，但旧验收/台账仍停在退役链路”。
- 上游：[B27 CP5](B27-systematic-prompt-and-intent-integration.md)、[B13B §6](B13B-adr-enforcement-reconciliation.md)、[VS00D-G 对账](VS00D-G-GAP-RECONCILIATION.md)、[known-gaps](../../quality/acceptance/known-gaps.md)、[AU07](AU07-file-level-closure.md)。
- 本任务只承接明确的验收重锚、证据重跑和状态修正；若发现真实产品缺口，另立 CP0 和产品 slice，不在验收脚本里掩盖。

## 1. 问题与目标

判断纪元与 B26/B27 已改变生产主链：旧 `planner.form_frame/form_micro_plan`、AIMessageEnvelope、固定多步 MicroPlan producer 等不再存在。多份场景仍要求旧事件，导致两类错误结论：

1. 实现已有但场景不可执行或被 blocked，被误写为“产品未实现”；
2. 历史 summary 仍在，但 key events / driver / surface 已不能证明当前 HEAD。

目标是在不重写产品功能的前提下，让每个场景重新满足以下一种诚实状态：

```text
按当前生产链重锚并复跑 PASS
或 保持 blocked / 正式退役并指向当前替代证据
```

禁止通过复活旧对象、修改语义或降低断言来制造 PASS。

## 2. 开工七问

1. **Contract**：消费当前 JudgmentProtocol / AgentPlan / AuthoringTask / AgentObservation / ToolTrace / ReplayReport / ProviderExecution 契约，以及 ADR-0023/0025、VS-00D §11、VS-02、VS-06。不得恢复已退役 Envelope 或 form_frame。
2. **Invariant**：证据必须来自当前生产链和当前页面；allow 不能代替 blocked；summary 存在不等于 current-HEAD PASS；未重跑不得改 active；机制、真实模型行为与文学质量分开；不篡改产品数据或 artifact 字节。
3. **Boundary**：主要修改 `quality/acceptance/**`、外部 driver/verifier、任务与验收文档。生产 `apps/` 默认不改；若必须改，先登记真实缺口、七问和单独 checkpoint。frontend 只在已有作者可见 Why/Replay 需要同步时按设计修改，不新增旁路页面。
4. **Consumer**：quality gate / nightly 与审阅证据的人；作者通过现有 Why/Replay 查看当前真实来源。不得只为清理台账而改测试。
5. **Proof**：逐场景保存当前 key events、driver、surface、provider、request/response refs、trace/replay、summary；负向场景必须有真实拒绝或诚实退役依据。复跑 `quality_manifest_check`、NEXT/ADR/链接检查及必要局部测试。
6. **Acceptance Driver**：外部自动化驱动真实 Tauri WorkspaceChat 与现有只读探索/质量诊断/缺上下文/回放入口；产品验收感知逻辑 **no**。live provider 变体只在本机已有凭据/模型可用时运行，不能用凭据缺失去阻塞确定性重锚。
7. **Exploration**：复用 chapter_read/prose_search/archive_read 等真实只读能力取得证据；本任务不物化新作品要素，不新增专用 prompt packet 或查询分支。

## 3. 范围与承接

| 批次 | 范围 | 当前证据与完成标准 |
|---|---|---|
| CP0 | 场景/字段/证据映射 | 对每份目标场景列出旧 key events、当前生产事件与字段、driver/surface/provider、重锚或退役选择；B27 CP5 与 VS00D-G 的 G1/G3/G5/G7 关闭边界单列，不能因 AuthoringTask 存在就全关 |
| CP1 | AU11 两条 blocked | `au11-quality-diagnosis-message-envelope`、`au11-missing-workstate-policy` 改按当前 AuthoringTask/JudgmentProtocol/trace 字段验收；真实 Tauri 通过后才改 active，仍证明质量诊断有据、缺 WorkState 不编造；只读探索可有来源和覆盖记录，但不得把读取当创作/采纳写入，不得新增 canon；author-safe replay 可回查 |
| CP2 | AU07 ToolTrace | 核对当前 registry snapshot/redacted I/O 与 no-provider replay；更新 `au07-tooltrace-registry-redacted-io` driver/manifest 及 AU07 台账“实现存在、证据待重锚”的真实状态，保留 developer/多类型 UI 等真实长尾，不重建 ReplayService |
| CP3 | B13B D7/D11 与同族证据 | 以 B13B D7 的 11 份为基线，并全量纳入后续发现的旧 `planner.form_*` 场景（当前至少 22 份，其中 19 个 active、3 个 blocked；动态变化以 CP0 为准），以及 `au07-gate-reason-why` 与 VS-10；逐份迁移或正式 blocked/退役；并处理 `e2e-01-downgrade-real-page` 的 blocked/退役选择，不能用 allow 路径冒充 blocked；历史 summary 只作历史，不能代替 current-HEAD 复跑 |
| CP4 | 全量复核与收口 | quality manifest、相关场景、任务状态、known-gaps、journey/ledger/索引同步；重跑后仍失败的保留 blocked 与原因，不为了完成率降低标准 |

## 4. 非目标

- 不做第七次 B27 全量语义 retest；B27 34/40 known-gap 继续单列。
- 不恢复 AIMessageEnvelope、Planner.form_frame/form_micro_plan、synthetic task_state_events 或固定多步 producer。
- 不重写 ToolTrace、ReplayService、JudgmentProtocol 等已有生产实现。
- 不承接 AU07 developer 权限、多类型 replay UI、reason catalog 等独立长尾；它们另按真实消费者登记。
- 不把所有 known-gaps 或全部旧场景一次性纳入；`agent-provider-streaming-progress`、D21 等其他漂移需在全量验收对账中单独确认承接，不默认同批完成。
- 不修改生产代码来迁就 driver；发现真实缺口时另立任务。

## 5. 验收与证据

- CP1：两条 AU11 当前链路真实 Tauri PASS，旧 envelope 断言为零，当前字段/来源/覆盖/author-safe replay 可回查。
- CP2：只读工具 turn 证明 registry name/version/status/layer、contract refs、grant summary、redacted request/result summaries、无 raw payload、no-provider replay 与 no production write；AU07 文件不再把已有实现写成未实现。
- CP3：全量目标场景每份都有“重锚 PASS”或“blocked/退役+替代证据”的明确结果；`e2e-01-downgrade` 不允许 allow 冒充。
- CP4：quality manifest 无未解释漂移；known-gaps 只减少已真实通过项；所有未闭环后果保留 owner 和 trigger。

确定性机制、真实模型行为、原生/browser surface 分别记录。不能用 2026-06 的旧 summary 或另一 provider/surface 的证据互换。

## 6. 依赖与恢复

- 前置：B27 CP3 的 AuthoringTask 与统一语义已落地；不依赖 ADR-0030，不与 B39 求证实现捆绑。
- 并行：B39 可独立推进；本任务不阻塞其 ADR 评审。
- 若当前生产字段又变化，先更新 CP0 映射，不继续改 driver。
- 若发现生产缺口，停止验收迁移，登记真实缺口与新任务，不修改断言掩盖。
- 恢复时先读 B27 CP5、B13B D7/D11、known-gaps、AU07 与本任务；不要只读 v3 旧 slice 或历史 summary。
