# AU05 Adoption Safety Freshness / 采纳安全与新鲜度

- 状态：next
- 类型：Artifact Slice / Safety Slice
- 来源：`docs/product/user-journeys.md` Journey F5-F6；`docs/design-v3/acceptance/author/AU-05-artifact-adoption.md` AU05-GAP-06 / AU05-GAP-07
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
- Proof: ActionValidator / AdoptionBoundary / Channel 回归测试，真实 Tauri 外部自动化覆盖 stale 或 cross-work rejection，以及高风险 confirmation。
- Acceptance Driver: 计划新增 `bash scripts/tauri_slice_verify.sh au05-adoption-safety-freshness`，外部 Playwright 通过真实页面制造过期或高风险采纳场景并收集 app JSONL、WebSocket frames、截图和 summary。

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
