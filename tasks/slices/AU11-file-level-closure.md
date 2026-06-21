# AU11 File-Level Closure / AI 引导式创作文件级收口

- 状态：done
- 类型：Acceptance Slice + Trace Contract Slice
- 启动日期：2026-06-21
- 所属验收：`docs/design/acceptance/author/AU-11-ai-guided-authoring.md`

## 1. 用户 / 系统目标

把 AU-11 从“只有质量诊断 checkpoint”推进到文件级可交付状态：质量诊断和缺上下文不编造都有真实 Tauri / quality acceptance 证据；clarify/confirm 引导模式与 prose_writing envelope 投影登记为 P1 后续，不再作为当前文件 P0 blocker。

## 2. 开工检查

- **Contract**：`VS-00D-ai-guided-authoring-contract-pack.md`；`AIMessageEnvelope`；`trace_summary.ai_message_envelope`；`TurnGuidance.guidance_mode=quality`；`WorkStateMessage` missing policy。
- **Invariant**：小说层判断不能替代作品事实；缺章节/正文/人物状态必须显式进入 trace/why；质量诊断不得触发 tool/adoption/production write；Planner 引导不等于执行授权。
- **Boundary**：真实 Tauri Workbench UI → Channel → `DialogueGateway` → `Planner` / `AIMessageEnvelope` → `TraceWriter` → `TurnResult` → why 面板。不改 persistence schema；不把 test/support provider 注册进 production runtime；不新增验收感知逻辑。
- **Consumer**：`WorkspaceChat` 消息流和 why 面板；真实作者从自然语言输入触发。
- **Proof**：两个 Tauri quality scenarios、application/provider/frontend targeted tests、quality manifest check、task_done、AI static scan。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh au11-quality-diagnosis-message-envelope` 与 `scripts/tauri_slice_verify.sh au11-missing-workstate-policy`；产品代码不感知 slice id。

## 3. 场景对账

| 场景 | 状态 | 真实页面证据 | 局部证据 | 剩余缺口 |
|---|---|---|---|---|
| SC-AU11-01 质量诊断引导 | 已验收 | `artifacts/slice-verify/au11-quality-diagnosis-message-envelope-tauri/summary.json`；`quality_accept` 通过 | `AIMessageEnvelope` / `TraceWriter` / `traceSummaryView` tests | `guidance_mode` 仍是过渡 trace/evidence 字段，P1 schema 冻结 |
| SC-AU11-02 缺当前作品上下文不编造 | 已验收 | `artifacts/slice-verify/au11-missing-workstate-policy-tauri/summary.json`；`quality_accept` 通过 | `AIMessageEnvelope` missing tests；slice provider test；why missing view test；native verifier test | 跨调用点正式 schema 仍待冻结，P1 |
| SC-AU11-03 澄清与确认是引导模式，不是执行授权 | 部分实现 | AU-04/AU-06 confirmation/behavior Tauri 证据证明执行授权边界 | ADR-0002/0003/0005/0009；`ActionValidator` / behavior lifecycle tests | 缺 `guidance_mode=clarify/confirm` 与 Orchestrator 组合 proof，P1 |
| SC-AU11-04 prose_writing 消费同一个 envelope | 部分实现 | VS-00C CP0/CP3/CP4/CP5 Tauri 证据证明 prose_writing 前置上下文和 missing policy | CreativeDecisionPacket contract / context tests | 缺 `AIMessageEnvelope(call_site=:prose_writing)` 专项投影进入 provider prompt/trace，P1 |

## 4. 文件级退出结论

- 当前口径：`2/4` 已验收，`2/4` 部分实现。
- P0：0 个未闭合。
- P1：`guidance_mode` schema 冻结、clarify/confirm 引导 proof、prose_writing envelope 投影。
- P2：更完整 WorkState projection 深度，与 AU-03/AU-09/AU-12 后续合并。
- 结论：AU-11 可进入下一个验收文件 AU-12；不能声称 VS-00D 全调用点完成。

## 5. 验证

- [x] `mix test apps/novel_application/test/novel_application/ai_message_envelope_test.exs apps/novel_application/test/novel_application/context_grounding_test.exs apps/novel_agent/test/novel_agent/provider/slice_verify_test.exs`
- [x] `cd frontend && pnpm test -- native-tauri-verifier traceSummaryView`
- [x] `bash scripts/tauri_slice_verify.sh au11-missing-workstate-policy`
- [x] `bash scripts/quality_accept.sh au11-missing-workstate-policy --surface tauri`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --slice au11-missing-workstate-policy --top 10`（完成执行；因历史 `gitleaks` accepted_risk 返回 1，当前 blocking=0）
- [x] `bash scripts/ai_static_scan.sh --top 10`（Top 10 仅历史 `gitleaks` accepted_risk，0 touched files）

## 6. 决策日志

- 2026-06-21 — SC-AU11-02 补成真实 Tauri proof 后，AU-11 文件级 P0 关闭。SC-AU11-03/04 是跨 contract/schema/prose_writing 的 P1，不在当前文件内强行扩张实现。
