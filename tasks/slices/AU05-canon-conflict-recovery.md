# AU05 Canon Conflict Recovery / Canon 冲突采纳恢复

- 状态：next
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
