# AU05 Adoption Safety Freshness / 采纳安全与新鲜度

- 状态：checkpoint closed（high-risk confirmation）；AU05-GAP-06 stale/conflict/cross-work 仍需后续 checkpoint
- 类型：Artifact Slice / Safety Slice
- 来源：`docs/product/user-journeys.md` Journey F5-F6；`docs/design/acceptance/author/AU-05-artifact-adoption.md` AU05-GAP-06 / AU05-GAP-07
- 当前目标：在候选采纳桥接已闭环后，加固高风险、stale、conflict、cross-work 的 adoption boundary，避免作者在过期或错误作品上下文中静默采纳。

---

## 1. 产品目标

作者明确采纳候选或草稿时，系统必须证明该动作仍然指向当前作品、当前候选/草稿来源和当前可用 action。高风险或冲突采纳不能静默成功；应进入确认、拒绝或可恢复状态，并给出 author-safe trace。

---

## 2. 开工检查

- Contract: `AuthorActionInput`、`AvailableAction`、`AdoptionDecision`、`AdoptionBoundary`、`BehaviorState` / confirmation binding、`DecisionTrace`、`StateTrace`
- Invariant: UI 只能提交服务端授权 action；stale / invented / cross-work / conflict action 不能写 production fact；高风险采纳必须确认或拒绝。
- Boundary: 切过 `novel_application`、`novel_web`、必要的 `novel_domain` 纯规则和 `frontend` 展示；不让 `novel_web` 直接访问 Repo，不新增验收专用产品钩子。
- Consumer: 真实 Tauri 工作台的候选采纳按钮、草稿采纳按钮、确认/拒绝卡、why/trace 面板。
- Proof: ActionValidator / AdoptionBoundary / Channel 回归测试覆盖高风险 confirmation 与 cross-work rejection；真实 Tauri 外部自动化覆盖高风险 candidate confirmation。
- Acceptance Driver: `bash scripts/tauri_slice_verify.sh au05-adoption-safety-freshness`，外部 Playwright 通过真实 Tauri 工作台输入高风险采纳场景、点击可见“采用这个方向”，并收集 app JSONL、WebSocket frames、截图和 summary。产品代码未新增 slice id、autorun、隐藏 DOM hook 或验收专用 Channel/API。

---

## 3. 最小闭环

```text
候选或草稿已展示
→ 作者触发采纳
→ 服务端校验 source_turn_ref / action_id / candidate_ref / work_id / freshness
→ 高风险或冲突进入 confirmation/rejection/recovery
→ UI 显示等待确认或拒绝原因
→ trace 说明为何不能静默采纳
```

---

## 4. 非目标

- 不一次性完成完整 replay 页面。
- 不重做 AU02 候选继续探索和候选采纳桥接。
- 不把 safety 场景做成产品代码里的测试分支；验收替身只能在外部 harness 或 test/support 中注入。

---

## 5. 本 checkpoint 已闭环

- `CandidateDirection.risk_hint` 从 LLM frame parsing 进入 `TurnResult.candidate_directions`，并由 `DialogueGateway.handle_action/3` 传入 `AdoptionBoundary`。
- `WorkspaceChannel` 为服务端保存的 source turn 补齐 `work_id/session_id`，author action 进入 application 前附加当前 work scope，避免候选来源和当前作品上下文脱节。
- 高风险候选采纳返回 `require_confirmation` / `needs_confirmation`，UI 显示“候选方向待确认”；`truthfulness.candidate_adopted=false`，`production_write_performed=false`。
- application/channel 回归覆盖高风险 confirmation 与 cross-work rejection；前端契约测试覆盖 `risk_hint` 字段。

证据：

- Tauri 外部验收：`artifacts/slice-verify/au05-adoption-safety-freshness-tauri/summary.json`
- UI frame / state：`artifacts/slice-verify/au05-adoption-safety-freshness-tauri/ui-frames.json`、`ui-state.json`
- 截图：`artifacts/slice-verify/au05-adoption-safety-freshness-tauri/au05-adoption-safety-freshness-external-ui.png`

---

## 6. 未闭环缺口

- stale freshness 仍缺 source turn / context version / revision snapshot 的真实产品字段与外部验收。
- conflict 恢复仍缺当前 canon/revision 对比与“修订/覆盖确认/放弃”产品路径。
- cross-work rejection 已有 application 回归，但还缺真实 UI 场景构造和 Tauri 外部自动化证据。
