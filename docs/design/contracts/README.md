# Contracts — Contract Pack 索引

> 当前唯一 contract pack 目录。contract pack 是承重竖切面实现前的契约冻结文档，消费者：backend / application / domain / frontend contract 对齐。
>
> 不授权代码实现；实现须经对应 `tasks/slices/v3/` slice 与 ADR。

## 文档

| 文件 | 契约 |
|---|---|
| `VS-00-reply-only-contract-pack.md` | 纯回复主链（DialogueFrame + TurnResult + Trace） |
| `VS-00A-creative-exploration-contract-pack.md` | 创意探索候选方向回合 |
| `VS-00B-dialogue-context-grounding-contract-pack.md` | 带作品上下文回应（DialogueContext 最小来源） |
| `VS-00C-creative-context-assembly-contract-pack.md` | 创作上下文组装（分层 / 预算 profile / 省略可解释；上游 `../08-novel-element-model.md`） |
| `VS-00D-ai-guided-authoring-contract-pack.md` | AI 引导式创作三层 + Message 契约 |
| `VS-00E-prose-execution-quality-contract-pack.md` | 正文场级执行简述 + 独立质量评估 + 修订候选（ProseExecutionBriefV1 / QualityFinding / revise_from_findings；ADR-0020；CP0–CP3） |
| `VS-00F-five-ledgers-three-state-contract-pack.md` | 五本账（E33-E37）对象化 + 三态对账机制（LedgerEntry 信封 / 两级对账节拍 / 处置枚举；08 NEM-GAP-05/06；**Proposed 待冻结**，M2 漂移实证拉动） |
- `VS-00G-fact-completeness-and-provisioning-contract-pack.md` — **Frozen / CP4b-2 core done, CP4 doing**：承重事实完备性与补全回路（承重事实清单 manifest/缺席守则/设计负债规则族/设定盘点/工作假定/全书骨架）；`fact_inventory_v1` 主动入口与选择性采纳核心链已通过真实 Tauri，当前沿 `tasks/slices/VS-00G-fact-inventory-run.md` 继续 finding 触发 A 与规划字段建议。
| `UA-01-unified-agent-run-loop-contract-pack.md` | 统一 AgentRun 循环与可打断创作对话流（AgentRun / AgentStep / AgentEvent；ADR-0021；UA-CP0–CP4 进行中，CP5/CP6 未实现） |
| `VS-01-execution-authority-contract-pack.md` | 执行权与降级确认 |
| `VS-02-tool-provenance-contract-pack.md` | 工具调用溯源（ToolRequest/Result/Trace） |
| `VS-02A-tentative-creative-artifact-contract-pack.md` | 试探性创作产物 |
| `VS-03-behavior-lifecycle-contract-pack.md` | 对话行为生命周期（ConfirmationBinding） |
| `VS-04-adoption-boundary-contract-pack.md` | 候选选择与采纳边界 |
| `VS-05-ui-roundtrip-contract-pack.md` | UI AvailableAction 往返 |
| `VS-06-replay-surface-contract-pack.md` | Trace 摘要与回放解释 |
