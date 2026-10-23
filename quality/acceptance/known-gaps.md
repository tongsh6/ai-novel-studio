# Known Acceptance Gaps

本文件登记已经进入 manifest、但当前不能作为质量 gate 执行的场景。Known gap 不是通过状态，也不能进入 `pr-smoke`。

## 当前 blocked 场景（2026-10-24 复核）

| 场景 | blocked 原因 | 触发 re-anchor |
|---|---|---|
| `e2e-01-downgrade-real-page` | 判断纪元（ADR-0025）后生产主链已无 multi-step MicroPlan 生产者（所有 `%MicroPlan{}` 构造点均为单 action），action_scope 降级阈值静态不可达；verifier key events 仍要求已退役 `planner.form_frame.done`/`planner.form_micro_plan.done`（B13B D7）。gate 序列证据改由 `agent-step-regate`（allow 路径 12 门真实页面 PASS）+ `gate_order_closure_test`（blocked 路径单测）承担。 | 判断链可控多步生产路径 re-anchor 或正式退役后改 active |
| `judgment-explore-internal` | 最近一次真实页面记录（2026-07-20）只有失败截图、无 `summary.json`。 | 真实 Tauri 复跑取得 PASS 后改 active |
| `au11-quality-diagnosis-message-envelope` | **AU11 证据链失效**：`AIMessageEnvelope` 唯一生产调用（`quality_diagnosis/3` 与 `evidence_summary[:ai_message_envelope]` 写入）已于 commit `c4509c86`（2026-07-19 帧纪元退役）删除，仅剩 `trace_writer.ex` 消费者；2026-10-24 真实 Tauri 复跑 exit 1（driver 报 `No AU11 turn_result with AIMessageEnvelope trace summary`；driver 末改 2026-06-19、旧证据 2026-06-22 含已退役 `planner.form_frame.done`）。 | B27/G7 统一 envelope 落地后 re-anchor；登记 `tasks/slices/VS00D-G-GAP-RECONCILIATION.md` §1.5 |
| `au11-missing-workstate-policy` | 同上（同一失效 envelope 链路；driver 同批断言 `trace_summary.ai_message_envelope`）。 | 同上 |

登记批次：`tasks/slices/VS00D-G-GAP-RECONCILIATION.md`（2026-10-24）；下一批开工前重扫差距台账时复核本表。
