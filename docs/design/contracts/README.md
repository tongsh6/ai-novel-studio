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
| [VS-00D-ai-guided-authoring-contract-pack.md](VS-00D-ai-guided-authoring-contract-pack.md) | 三层 Message 与 B27 共同语义；§11.4 与 ADR-0001 修订联合保留 primary frame，区分应用记录与未知模型判断；§11.4.1 核对共同输入载体；禁止额外分类调用，真实质量按 B27 §6.1 |
| `VS-00E-prose-execution-quality-contract-pack.md` | 正文场级执行简述 + 独立质量评估 + 修订候选（ProseExecutionBriefV1 / QualityFinding / revise_from_findings；ADR-0020；CP0–CP3） |
| `VS-00F-five-ledgers-three-state-contract-pack.md` | 五本账（E33-E37）对象化 + 三态对账机制（LedgerEntry 信封 / 两级对账节拍 / 处置枚举；08 NEM-GAP-05/06；**Frozen**，M2 漂移实证拉动） |
- `VS-00G-fact-completeness-and-provisioning-contract-pack.md` — **Frozen / CP4b-2 core done, CP4 doing**：承重事实完备性与补全回路（承重事实清单 manifest/缺席守则/设计负债规则族/设定盘点/工作假定/全书骨架）；`fact_inventory_v1` 主动入口与选择性采纳核心链已通过真实 Tauri，当前沿 `tasks/slices/VS-00G-fact-inventory-run.md` 继续 finding 触发 A 与规划字段建议。CP5e 已有历史 Tauri 证据，当前 HEAD 复验与触发 C、works 级假定、记忆类富化未闭环。
| `VS-00H-system-identity-message-contract-pack.md` | 系统身份消息（**Frozen**，2026-10-21，CP1–CP3 已实现）：把 VS-00D §4.4 已规定但未落地的 SYSTEM 块具体化——身份文本唯一真源 / Provider Gateway 唯一注入点 / adapter role 渲染 / trace 只落 `system_identity_ref` 不落原文 / `Usage.cached_tokens` 可观测；不变量 I-SYS-1～4；承重入口 `tasks/slices/UA01-agentic-loop-prompt-hardening.md` T7 |
| [VS-00I-prompt-prefix-stability-contract-pack.md](VS-00I-prompt-prefix-stability-contract-pack.md) | 前缀基础 Frozen；B26/B27 静态 schema/动态事实边界、§7 I-CACHE-3 单调用语义与来源回归目标；旧 call1/none 断言仅历史。新守卫须实现复跑，不跳过或静默放宽门禁 |
| `VS-00J-volume-structure-and-blueprint-contract-pack.md` | 卷结构与卷级蓝图（**Frozen，2026-10-22，作者 B11① 开工授权按建议默认拍板，§9 四项可翻案**）：E14-E17 最小结构化槽（`volumes.blueprint` map 列）/ 卷身份 `(work_id,seq)` 与改名语义 / plot_outline 卷蓝图块产出 / 开新卷动作形态 A（复用 plot_outline + `volume_scope`）/ 6 个消费面 / 不变量 I-VOL-1～8 / 无蓝图退化等价；ADR-0028 Accepted 为决策记录（enforced_by 覆盖 CP0–CP5，长尾 gaps 登记）；承重入口 `tasks/slices/B11A-volume-blueprint.md`（**done，2026-10-22，CP0–CP5 全落 + 真实 Tauri au08 三轮扩展 PASS**） |
| [VS-00K-evidence-seeking-authoring-contract-pack.md](VS-00K-evidence-seeking-authoring-contract-pack.md) | 求证式创作（**Accepted，2026-10-29，B39 实施基线；产品未完成**）：最小 Base / 模型请求观察 / 准备判断 / 证据使用；创作 run 只读探索与 plan revision、used refs 绑定、通用实模验收与携带迁移；上游 00 §2.4、ADR-0030；执行 `tasks/slices/B39-evidence-seeking-authoring.md`、验收 `acceptance/author/AU-15-evidence-seeking-authoring.md` |
| [UA-01-unified-agent-run-loop-contract-pack.md](UA-01-unified-agent-run-loop-contract-pack.md) | 统一 AgentRun 循环；§2.2 B26/B27 联合修订（2026-10-24 已接受，单调用共享入口已随 B26 CP2 实施）承接 J1–J4，含持久问题/空选项回复/身份与恢复、§2.2.3a 结果状态与重放、§2.2.8 现有承载/schema/消费者映射；QA/OUT 与页面证据见 B26 §14，文档不代表 B27 §6.1 语义验收 |
| `VS-01-execution-authority-contract-pack.md` | 执行权与降级确认 |
| `VS-02-tool-provenance-contract-pack.md` | 工具调用溯源（ToolRequest/Result/Trace） |
| `VS-02A-tentative-creative-artifact-contract-pack.md` | 试探性创作产物 |
| `VS-03-behavior-lifecycle-contract-pack.md` | 对话行为生命周期（ConfirmationBinding） |
| `VS-04-adoption-boundary-contract-pack.md` | 候选选择与采纳边界 |
| `VS-05-ui-roundtrip-contract-pack.md` | UI AvailableAction 往返 |
| `VS-06-replay-surface-contract-pack.md` | Trace 摘要与回放解释 |
