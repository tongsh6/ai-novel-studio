# AU05 Stale / Conflict / Cross-Work Freshness / 过期、冲突与跨作品采纳安全

- 状态：checkpoint closed（stale source）；conflict / cross-work recovery 仍待后续
- 类型：Safety Slice / Adoption Boundary
- 来源：`tasks/slices/AU05-adoption-safety-freshness.md` §6；`docs/design-v3/acceptance/author/AU-05-artifact-adoption.md` AU05-GAP-06 / SC-AU05-C3~C5
- 当前目标：在高风险候选 confirmation 已闭环后，继续把 stale source、canon conflict、cross-work action 的拒绝或恢复路径做成真实工作台可验收的产品链路。
- 本轮 checkpoint：已闭环“从持久化 transcript 恢复出的 stale candidate 不能被静默采纳”。真实 Tauri 工作台恢复旧候选卡，作者点击可见“采用这个方向”，后端通过 `ActionValidator -> DialogueGateway -> AdoptionBoundary` 返回 `reject`，UI 显示拒绝结果，`production_write_performed=false`。

---

## 1. 产品目标

作者不能把旧 source turn、旧 revision、其它作品的 candidate/draft 或与当前 canon 冲突的内容静默采纳到当前作品。系统必须给出 rejection / recovery / confirmation，并在 trace 中说明原因。

---

## 2. 开工检查

- Contract: `AuthorActionInput`、`AvailableAction`、`AdoptionDecision`、source turn scope、work_id/revision/context version、DecisionTrace/StateTrace。
- Invariant: stale / conflict / cross-work adoption 不得写 production fact；UI 只能提交当前服务端授权 action；adoption boundary 是唯一裁决点。
- Boundary: 预期切过 `novel_application`、`novel_web`、必要的 `novel_domain` 纯规则与真实 Tauri 工作台；如果引入持久 source/revision，必须经过 application/persistence 边界，`novel_web` 不直接访问 Repo。
- Consumer: 真实 Tauri 工作台的候选/草稿采纳入口、拒绝/恢复卡、why/trace 面板。
- Proof: application/channel 回归 + 外部 Tauri 自动化；至少一个真实 UI 场景证明 stale 或 cross-work action 被拒绝/恢复且 `production_write_performed=false`。
- Acceptance Driver: 计划新增或扩展 `bash scripts/tauri_slice_verify.sh <slice-id>`，通过外部 Playwright 操作真实页面，不新增产品验收 hook。

---

## 3. 最小闭环

```text
候选或草稿已展示
→ 作者切换上下文、复用旧 action 或触发冲突采纳
→ 服务端校验 source/revision/work scope
→ AdoptionBoundary 返回 reject / fail_with_recovery / require_confirmation
→ UI 显示拒绝或恢复原因
→ trace 说明为何不能静默写入作品事实
```

---

## 4. 非目标

- 不把冲突检测做成 LLM 文案猜测；需要明确 canon/revision/source 依据。
- 不通过前端隐藏状态或验收专用 action 构造场景。
- 不一次性补完整 replay 页面；本 slice 只要求能解释当前采纳安全裁决。

---

## 5. 已闭环 checkpoint：stale restored candidate rejection

### 5.1 范围

本 checkpoint 使用外部 seed 构造真实持久化状态：active session 的 transcript 中存在一个带 `candidate_set_stability: "stale"` 的旧候选 turn。产品代码不识别 slice id、不读取验收 env、不暴露隐藏 DOM hook；外部 Playwright 只操作真实工作台入口。

```text
恢复 active session transcript
→ 旧候选卡在真实工作台可见
→ 作者点击“采用这个方向”
→ Channel 提交服务端授权的 author_action.choose_candidate
→ ActionValidator 接受恢复后的 string-key source 字段
→ DialogueGateway 重建 stale CandidateSet
→ AdoptionBoundary 返回 reject
→ UI 显示“候选方向未采用”
→ truthfulness.candidate_adopted=false
→ truthfulness.production_write_performed=false
```

### 5.2 实现点

- `NovelDomain.CandidateSet.stability` 支持 `:stale | :adopted | :conflicted`。
- `DialogueGateway` 从 source `turn_result.candidate_set_stability` 归一化 candidate set stability，并保留恢复后的 `trace_summary.trace_ref`。
- `ActionValidator` 兼容恢复自 JSON 的 string-key source fields，避免把合法恢复 action 误判为 source turn drift。
- `AdoptionBoundary` 对 `:stale` candidate set 返回 `reject`，reason 包含 `source_turn_stale` 与 `stale_candidate_set`，不产生 adopted/projection 写入。
- `scripts/seed_au05_stale_conflict_cross_work_freshness.exs` 只作为外部验收 seed，不进入生产 runtime。
- `frontend/slice-verify/external-ui-driver.mjs` 与 `native-tauri-verifier` 新增 `au05-stale-conflict-cross-work-freshness` 证据规则。

### 5.3 证据

- 外部 Tauri 场景化验收：`artifacts/slice-verify/au05-stale-conflict-cross-work-freshness-tauri/summary.json`
- 验收命令：`bash scripts/tauri_slice_verify.sh au05-stale-conflict-cross-work-freshness`
- 局部回归：
  - `apps/novel_application/test/novel_application/adoption_boundary_test.exs`
  - `apps/novel_application/test/novel_application/action_roundtrip_test.exs`
  - `apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs`
  - `frontend/slice-verify/native-tauri-verifier.test.mjs`

### 5.4 未闭环缺口

- canon conflict 仍缺真实 revision/canon 依据、恢复或覆盖确认产品链路。
- cross-work 仍缺真实工作台跨作品旧 action 的可复跑验收。
- context version / state snapshot freshness 仍未形成完整持久化 contract。
- 完整 AU-04 confirmation re-gate 与 StateTrace 持久化仍是后续 slice。
