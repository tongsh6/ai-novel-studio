# AU02 Candidate Adoption Bridge / 候选方向到采纳边界

- 状态：done
- 类型：Artifact Slice / UI Contract Slice
- 来源：`docs/product/user-journeys.md` Journey C6、Journey F；`docs/design/acceptance/author/AU-02-explore.md` AU02-GAP-02；`docs/design/acceptance/author/AU-05-artifact-adoption.md` AU05-GAP-05
- 当前目标：把“候选方向只是灵感入口”与“明确采纳必须进入 adoption boundary”打成真实工作台闭环。

---

## 1. 产品目标

作者输入模糊创意后，AI 可以给出多个候选方向。作者点选候选时，系统应继续围绕该方向探索，但不能把候选写成作品事实。只有当作者明确表示采用某个候选方向时，系统才可以通过服务端 `AuthorActionInput` / adoption boundary 重新 gate，并返回可解释的 `AdoptionDecision` 或等待确认状态。

本 slice 要证明三件事彼此不同：

1. candidate presented：候选方向被展示。
2. candidate selected：作者选择候选继续探索。
3. candidate adopted：作者明确采纳后，由服务端 adoption boundary 裁决。

---

## 2. 开工检查

- Contract: `CandidateDirectionSet`、`AuthorActionInput.choose_candidate`、`AvailableAction`、`AdoptionDecision`、`AdoptionBoundary`、`ProjectionHint`、`DecisionTrace`、ADR-0010、ADR-0016、`docs/design/contracts/VS-04-adoption-boundary-contract-pack.md`
- Invariant: candidate selection 不等于 adoption；UI 只能提交服务端授权 action；production write 必须经过 adoption boundary；trace/replay 能解释候选来源、作者动作和裁决结果。
- Boundary: 切过 `frontend`、`novel_web`、`novel_application`、必要的 `novel_domain` 纯规则；不让 `frontend` 直接写作品事实，不让 `novel_web` 直接访问 Repo，不让 `novel_agent` 直接越过 adoption boundary。
- Consumer: 真实 Tauri 工作台 `WorkspaceChat` 的候选卡、available action、why/trace 面板。
- Proof: 后端 adoption boundary / author action 测试、前端候选 action 测试、真实 Tauri 外部自动化验收。
- Acceptance Driver: `bash scripts/tauri_slice_verify.sh au02-candidate-continuation` 验证“继续讨论”是 `user_message.candidate_selection` 且不进入 adoption；`bash scripts/tauri_slice_verify.sh au02-candidate-adoption-bridge` 验证“设为后续方向”提交服务端授权 `author_action.choose_candidate` 并进入 adoption boundary。两个 driver 都由外部 Playwright 打开真实 Tauri 工作台，通过可见输入和按钮完成验证；产品代码未新增 slice id、autorun、隐藏 DOM hook 或验收专用 Channel/API。

---

## 3. 最小闭环

```text
模糊创意输入
→ Planner 返回 candidate_directions
→ UI 展示候选方向
→ 点击候选继续探索
→ 系统发送 `user_message.candidate_selection` 并生成围绕该候选的下一轮回复，且不写作品事实
→ 作者明确采纳候选
→ 前端提交服务端授权 `choose_candidate` available action
→ AdoptionBoundary 产生 AdoptionDecision
→ TurnResult / trace 返回作者可见结果
```

---

## 4. 当前已知基础

| 能力 | 当前状态 |
|---|---|
| 候选方向生成 | 已有 `au02-candidate-continuation` / `au02-candidate-adoption-bridge` Tauri 证据 |
| 候选继续探索 | 已有真实工作台候选点击证据；`au02-candidate-continuation` 证明 continuation 是 `user_message.candidate_selection`，不是 adoption action |
| AdoptionBoundary | application/domain 局部测试存在 |
| 采纳 UI / Channel | 候选卡展示服务端授权的“设为后续方向”动作，`author_action` 进入 `AdoptionBoundary` |
| 关键缺口 | 已闭环；后续转入 AU-05 高风险 / stale / conflict / cross-work 安全加固 |

---

## 5. 验收标准

- 真实 Tauri 工作台中可从模糊创意生成候选方向。
- 点击候选继续探索时，trace 或外部证据证明没有 production write / adoption。
- 明确采纳候选时，前端提交服务端授权动作，不自行发明 adopted state。
- 服务端返回 adoption boundary 裁决，UI 展示采纳结果、等待确认或拒绝原因。
- why/trace 能说明候选来源、作者动作和裁决结果。
- 外部验收脚本收集截图、WebSocket frame、app JSONL 和 summary 到 `artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/`。

已通过证据：

- Tauri 外部验收：`artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json`
- Tauri 外部验收：`artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json`
- UI frame / state：`artifacts/slice-verify/au02-candidate-continuation-tauri/ui-frames.json`、`ui-state.json`
- UI frame / state：`artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/ui-frames.json`、`ui-state.json`
- 截图：`artifacts/slice-verify/au02-candidate-continuation-tauri/au02-candidate-continuation-external-ui.png`
- 截图：`artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/au02-candidate-adoption-bridge-external-ui.png`

验收断言：

- `candidate_panel_rendered_from_turn_result`
- `candidate_ref_sent_from_real_workbench`
- `micro_plan_not_requested`
- `no_adoption_or_projection_events`
- `candidate_adoption_sent_authorized_choose_candidate_action`
- `adoption_boundary_returned_adopt_tentative`
- `ui_rendered_candidate_adoption_result`
- `production_write_not_claimed`
- `no_legacy_artifact_adopt_endpoint_used`

---

## 6. 非目标

- 不一次性实现完整小说生命周期管理。
- 不为候选方向新增生产专用表，除非 adoption boundary 当前闭环确实需要持久化 proof。
- 不把候选选择直接写入阅读投影。
- 不为了验收在生产 UI 加 `data-testid`、slice id 判断、自动点击或隐藏状态上报。
