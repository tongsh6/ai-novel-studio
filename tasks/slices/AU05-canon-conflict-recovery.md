# AU05 Canon Conflict Recovery / Canon 冲突采纳恢复

- 状态：checkpoint closed
- 类型：Safety Slice / Adoption Boundary
- 来源：`tasks/slices/AU05-conflict-cross-work-recovery.md` §5.4；`docs/design-v3/acceptance/author/AU-05-artifact-adoption.md` SC-AU05-C4；AU05-GAP-06
- 当前目标：在 stale source 与 cross-work adoption 都已能由真实 Tauri 工作台拒绝后，补齐“与当前 canon/revision 冲突的候选或草稿不能静默覆盖作品事实”的真实产品链路。

---

## 1. 产品目标

作者采纳的新设定如果与当前 canon 冲突，例如同一角色年龄、阵营、世界规则或主线目标不一致，系统必须基于明确 canon/revision/source 依据进入恢复、修订或覆盖确认，而不能静默覆盖当前作品事实。

---

## 2. 开工检查

- Contract: `AuthorActionInput`、`AvailableAction`、`AdoptionDecision`、canon/revision/context version、DecisionTrace/StateTrace。
- Invariant: canon conflict 不得静默写 production fact；覆盖必须重新 gate；冲突原因必须来自明确结构化依据，不来自 LLM 文案猜测。
- Boundary: 预期切过 `novel_application`、`novel_web`、必要的 `novel_domain` 纯规则和真实 Tauri 工作台；如需读取当前 canon/revision，必须经 application/persistence 边界。
- Consumer: 真实 Tauri 工作台的候选/草稿采纳入口、冲突恢复卡、why/trace 面板。
- Proof: application/channel 回归 + 外部 Tauri 自动化；真实 UI 场景证明 conflict action 被拒绝、恢复或覆盖确认且 `production_write_performed=false`。
- Acceptance Driver: 扩展 `bash scripts/tauri_slice_verify.sh <slice-id>`，由外部 Playwright 操作真实页面，不新增产品验收 hook。

---

## 3. 最小闭环候选

```text
当前作品已有 canon/revision
→ 候选或草稿声明会覆盖同一 canon target
→ 作者点击真实“采用”入口
→ 服务端校验 target/revision/conflict basis
→ AdoptionBoundary 返回 fail_with_recovery 或 require_confirmation
→ UI 显示冲突原因和下一步
→ trace 说明为何不能静默写入作品事实
```

---

## 4. 非目标

- 不实现完整人工合并编辑器。
- 不让前端自行判断 canon conflict。
- 不把 conflict 检测降级为 LLM 文案相似度猜测。

---

## 5. 本轮闭环

- Contract: `AuthorActionInput.choose_candidate`、`CandidateSet.candidates[].canon_conflicts`、`adoption_target_ref`、`AdoptionDecision.reason_codes`。
- Invariant: 带结构化 canon conflict 的候选不能静默写入作品事实；即使它是低风险候选，也必须先进入恢复失败或后续覆盖确认路径。
- Boundary: `novel_domain` 补 candidate 契约字段；`novel_application` 在 `DialogueGateway` 重建 candidate 时保留 `canon_conflicts`，并在 `AdoptionBoundary` 统一裁决；`novel_web` 只广播裁决结果；真实 Tauri 工作台只通过可见按钮触发授权 action。
- Consumer: 真实候选卡的“采用这个方向”按钮。
- Proof: application/channel 回归 + 外部 Playwright 驱动真实 Tauri 工作台。
- Acceptance Driver: `bash scripts/tauri_slice_verify.sh au05-canon-conflict-recovery`，产品代码没有新增验收专用 hook。

### 5.1 证据

- `artifacts/slice-verify/au05-canon-conflict-recovery-tauri/summary.json`
- `artifacts/slice-verify/au05-canon-conflict-recovery-tauri/ui-state.json`
- `artifacts/slice-verify/au05-canon-conflict-recovery-tauri/ui-frames.json`

真实验收流程：

```text
seed 当前作品 active session 与已确认 canon basis
→ Tauri 工作台恢复“年龄设定覆盖”候选卡
→ 外部 Playwright 点击真实“采用这个方向”
→ Channel 发送服务端授权 author_action.choose_candidate
→ AdoptionBoundary 返回 fail_with_recovery
→ UI 显示“候选方向采用失败”
→ truthfulness.candidate_adopted=false
→ truthfulness.production_write_performed=false
```

### 5.2 已补能力

- `AdoptionBoundary` 在高风险 confirmation 之前检查结构化 `canon_conflicts`，返回 `fail_with_recovery`。
- `DialogueGateway` 从 source `turn_result.candidate_directions[]` 透传 `adoption_target_ref` 与 `canon_conflicts` 到 boundary candidate。
- application/channel 回归覆盖 `canon_conflict_detected` / `conflict_recovery_required`，并断言不产生 production write。
- 外部 Tauri 验收 seed/driver/verifier 已加入 `scripts/tauri_slice_verify.sh --list`。

### 5.3 未闭环缺口

- 当前只验证 source candidate 已带结构化 `canon_conflicts` 的 boundary gate；还没有从持久化 canon/revision store 自动计算 conflict。
- 完整覆盖确认、人工合并编辑器、revision rebase 和 StateTrace 持久化仍未完成。
- 后续长篇 P1 章节计划/正文生产必须继续复用这条 canon gate，避免章节产出污染作品事实。
