# AU11 Quality Diagnosis Message Envelope / 质量诊断引导 Message 契约

- 状态：checkpoint closed
- 类型：AI-Guided Authoring Slice + Trace Contract Slice
- 启动日期：2026-06-18
- 所属验收：`docs/design/acceptance/author/AU-11-ai-guided-authoring.md` SC-AU11-01；`docs/design/acceptance/SCENARIO-BLUEPRINT.md` §4 / §7。
- 所属设计：`docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md`，`docs/design/08-novel-element-model.md`，`docs/design/06-memory-context-and-trace.md`。

## 1. 用户 / 系统目标

作者说“这一章不够爽，主角赢得太轻了”时，系统不能只给泛泛建议，也不能绕过执行边界直接改正文。AI 调用必须能重建三层 message：小说层质量判断原则、当前作品层证据或缺失、本轮引导层判断；trace/why 至少能用 author-safe 摘要说明本轮是质量诊断或结构修订建议。

本 checkpoint 只做 SC-AU11-01 的最小真实工作台 proof：证明质量诊断 turn 的 `AIMessageEnvelope` 或等价过渡 trace 可重建，不声明 AU11 全部完成，不实现完整 prose_writing envelope 投影。

## 2. 开工检查

- **Contract**：消费 `VS-00D` 的 `AIMessageEnvelope` / `NovelLayerMessage` / `WorkStateMessage` / `TurnGuidanceMessage`；过渡期可先落到 `DialogueFrame.evidence_summary`、`trace_summary` 或新增正式 envelope read model。
- **Invariant**：
  - Novel layer 只能提供创作判断原则，不能替代当前作品事实。
  - Work state layer 必须 evidence-bound；缺当前章正文、摘要或前文时要显式缺失。
  - Turn guidance layer 必须能说明本轮为何是质量诊断 / 结构修订 / 澄清，而不是只在 assistant 文案里出现。
  - 若进入重写或正文生成，仍必须经过 MicroPlan / Orchestrator / confirmation / adoption 边界。
  - 产品代码不得为了验收读取 slice id、URL query、localStorage 或验收专用 env。
- **Boundary**：
  - `novel_domain`：若新增 envelope struct，保持纯数据/纯函数。
  - `novel_application`：Planner / ContextAssembler / TraceWriter 负责构造和记录 envelope 摘要。
  - `novel_agent`：本 checkpoint 尽量不改 provider runtime；若需要 prompt 渲染，必须通过正式 contract。
  - `novel_web` / `frontend`：真实工作台输入、turn_result、why 面板消费 author-safe trace。
  - **不改** persistence schema，除非 envelope 需要正式持久化证明；不得新增验收 hook。
- **Consumer**：真实工作台普通输入、Planner frame、TurnResult trace summary、why 面板。
- **Proof**：
  - 后端：contract/trace 测试证明质量诊断输入能产生可重建的三层 envelope 或等价过渡结构，且缺失 WorkState 不编造。
  - 外部 Tauri：新增 `bash scripts/tauri_slice_verify.sh au11-quality-diagnosis-message-envelope`。seed 一个有章节计划/正文或摘要的作品；真实工作台发送“这一章感觉不够爽，主角赢得太轻了。”；验证 trace/why 展示质量诊断来源，assistant 给出具体取舍，未静默写入作品事实。
- **Acceptance Driver**：外部自动化从真实工作台输入质量诊断请求并打开 why；不新增产品验收感知逻辑。

## 3. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计现有 Planner / trace 能否承载 VS-00D 三层 message | done | 采用 application 层 `AIMessageEnvelope` builder，过渡投影到 `DialogueFrame.evidence_summary` / `trace_summary`。 |
| T2 | 补最小 AIMessageEnvelope / trace contract 测试 | done | 覆盖质量诊断、缺当前作品上下文两类，不编造 WorkState。 |
| T3 | 新增真实 Tauri seed/driver/verifier | done | `au11-quality-diagnosis-message-envelope`：工作台输入质量诊断 -> why 可解释 -> no tool/adoption/write。 |
| T4 | 同步 AU-11 / blueprint / journeys / NEXT | done | 本 checkpoint closed；AU11 整体仍不标 complete。 |

## 4. 当前缺口

- SC-AU11-01 已有最小真实工作台 proof：`trace_summary.ai_message_envelope` 可重建 NovelLayer / WorkStateLayer / TurnGuidanceLayer，why 面板展示 author-safe 质量诊断摘要。
- `guidance_mode` 仍是过渡 trace/evidence 字段，尚未冻结进 `DialogueFrame` schema；后续 CP 需要 ADR/schema/test。
- SC-AU11-02 仍缺真实工作台验收；当前只有后端缺失上下文 contract 测试。
- SC-AU11-03 / SC-AU11-04 未闭环：clarify/confirm guidance_mode 与 prose_writing envelope 投影仍待后续 slice。

## 5. 验证计划

- [x] 后端 envelope / trace contract 测试
- [x] `cd frontend && pnpm test -- traceSummaryView native-tauri-verifier`
- [x] `bash scripts/tauri_slice_verify.sh au11-quality-diagnosis-message-envelope`
- [x] `bash scripts/quality_accept.sh au11-quality-diagnosis-message-envelope --surface tauri`
- [x] `bash scripts/ai_static_scan.sh --top 10`（17 pass / 1 historical accepted-risk gitleaks；0 touched findings）

## 6. 决策日志

- 2026-06-18 — `AU09-AU03-session-memory-layering` checkpoint closed 后，按 `SCENARIO-BLUEPRINT.md` §4 / §7 转向 P0 `AI 引导式创作 message 闭环`；首个 checkpoint 选 SC-AU11-01 质量诊断，因为它能最小证明 VS-00D 三层 message contract 从文档进入真实工作台 trace。
- 2026-06-18 — `AU11-quality-diagnosis-message-envelope` checkpoint closed。实现 `NovelApplication.AIMessageEnvelope` 过渡 builder，Planner prompt 与 `DialogueFrame.evidence_summary` 共用同一三层 envelope，TraceWriter 投影到 `trace_summary.ai_message_envelope`；前端 why 面板展示质量诊断、质量门、作品层来源/缺失摘要。外部 Tauri 证据：`artifacts/slice-verify/au11-quality-diagnosis-message-envelope-tauri/summary.json`；质量入口 `quality_accept` 通过。此结论只覆盖 SC-AU11-01，不声明 AU11 complete。
