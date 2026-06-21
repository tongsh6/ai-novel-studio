# AU05 Conflict / Cross-Work Adoption Recovery / 冲突与跨作品采纳恢复

- 状态：checkpoint closed（cross-work）；后续 canon conflict recovery 已闭环
- 类型：Safety Slice / Adoption Boundary
- 来源：`tasks/slices/AU05-stale-conflict-cross-work-freshness.md` §5.4；`docs/design/acceptance/author/AU-05-artifact-adoption.md` SC-AU05-C4/C5；AU05-GAP-06
- 当前目标：在 stale restored candidate 已被真实 Tauri 工作台拒绝后，继续把 canon conflict 与 cross-work action 的拒绝、恢复或覆盖确认做成可复跑的真实产品链路。
- 本轮 checkpoint：已闭环“来自其它作品的候选不能被静默采纳到当前作品”。真实 Tauri 工作台在当前作品恢复一条 source work 属于外部作品的候选卡，作者点击可见“设为后续方向”，后端通过 `ActionValidator -> DialogueGateway -> AdoptionBoundary` 返回 `fail_with_recovery`，UI 显示“后续方向设置失败”，`production_write_performed=false`。

---

## 1. 产品目标

作者不能把与当前 canon 冲突的候选/草稿，或来自其它作品的旧 action，静默采纳到当前作品。系统必须基于明确 source/work/revision/canon 依据给出拒绝、恢复、重新生成或覆盖确认。

---

## 2. 开工检查

- Contract: `AuthorActionInput`、`AvailableAction`、`AdoptionDecision`、source work scope、canon/revision/context version、DecisionTrace/StateTrace。
- Invariant: conflict / cross-work adoption 不得静默写 production fact；跨作品内容不得污染当前作品；覆盖必须重新 gate。
- Boundary: 预期切过 `novel_application`、`novel_web`、必要的 `novel_domain` 纯规则与真实 Tauri 工作台；如需查询当前 canon/revision，必须经 application/persistence 边界，`novel_web` 不直接访问 Repo。
- Consumer: 真实 Tauri 工作台的候选/草稿采纳入口、拒绝/恢复卡、why/trace 面板。
- Proof: application/channel 回归 + 外部 Tauri 自动化；至少一个真实 UI 场景证明 conflict 或 cross-work action 被拒绝/恢复且 `production_write_performed=false`。
- Acceptance Driver: 扩展 `bash scripts/tauri_slice_verify.sh <slice-id>`，由外部 Playwright 操作真实页面，不新增产品验收 hook。

---

## 3. 最小闭环候选

```text
当前作品已有 canon / revision
→ 作者触发来自旧 canon、冲突 canon 或其它作品的采纳动作
→ 服务端校验 source work / revision / conflict basis
→ AdoptionBoundary 返回 reject / fail_with_recovery / require_confirmation
→ UI 显示拒绝、恢复或覆盖确认原因
→ trace 说明为何不能静默写入作品事实
```

---

## 4. 非目标

- 不用 LLM 文案猜测“冲突”；必须有明确 canon/revision/source 依据。
- 不绕开真实工作台入口，不在产品代码中加入验收感知逻辑。
- 不一次性完成完整 StateTrace 持久化；若当前 checkpoint 只证明 no-write，必须在结尾标出后续缺口。

---

## 5. 已闭环 checkpoint：cross-work candidate recovery failure

### 5.1 范围

本 checkpoint 使用外部 seed 构造真实持久化状态：当前作品的 active session transcript 中存在一条候选 turn，但该 turn 的 `work_id` 与候选 `work_id` 都指向另一部作品。产品代码不识别 slice id、不读取验收 env、不暴露隐藏 DOM hook；外部 Playwright 只操作真实工作台入口。

```text
恢复当前作品 active session transcript
→ 外部作品候选卡在真实工作台可见
→ 作者点击“设为后续方向”
→ Channel 提交服务端授权的 author_action.choose_candidate
→ DialogueGateway 将 current_work_id 与 source_work_id 传入 AdoptionBoundary
→ AdoptionBoundary 返回 fail_with_recovery
→ UI 显示“后续方向设置失败”
→ truthfulness.candidate_adopted=false
→ truthfulness.production_write_performed=false
```

### 5.2 实现点

- `scripts/seed_au05_conflict_cross_work_recovery.exs` 创建当前作品和外部来源作品，只把跨作品候选作为当前作品 transcript 的恢复状态。
- `WorkspaceChannel` 回归覆盖 cross-work candidate 的 `action_result.status="failed"` 和失败 turn_result 广播。
- `frontend/slice-verify/external-ui-driver.mjs` 新增 `au05-conflict-cross-work-recovery` driver，外部点击真实候选卡按钮并采集 WebSocket frame。
- `native-tauri-verifier` 新增证据规则，接受 `adoption.evaluate.done` 的 expected `fail_with_recovery`，并要求 `work_id_mismatch` / `cross_work_adoption_rejected` reason codes。
- `scripts/tauri_slice_verify.sh` 新增可复跑入口。

### 5.3 证据

- 外部 Tauri 场景化验收：`artifacts/slice-verify/au05-conflict-cross-work-recovery-tauri/summary.json`
- 验收命令：`bash scripts/tauri_slice_verify.sh au05-conflict-cross-work-recovery`
- 局部回归：
  - `apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs`
  - `apps/novel_application/test/novel_application/action_roundtrip_test.exs`
  - `apps/novel_application/test/novel_application/adoption_boundary_test.exs`
  - `frontend/slice-verify/native-tauri-verifier.test.mjs`

### 5.4 未闭环缺口

- canon conflict checkpoint 已补；仍缺真实 revision/canon store 自动计算、覆盖确认和 StateTrace 产品链路。
- context version / state snapshot freshness 仍未形成完整持久化 contract。
- 完整 AU-04 confirmation re-gate 与 StateTrace 持久化仍是后续 slice。
