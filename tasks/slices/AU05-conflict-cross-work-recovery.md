# AU05 Conflict / Cross-Work Adoption Recovery / 冲突与跨作品采纳恢复

- 状态：next
- 类型：Safety Slice / Adoption Boundary
- 来源：`tasks/slices/AU05-stale-conflict-cross-work-freshness.md` §5.4；`docs/design-v3/acceptance/author/AU-05-artifact-adoption.md` SC-AU05-C4/C5；AU05-GAP-06
- 当前目标：在 stale restored candidate 已被真实 Tauri 工作台拒绝后，继续把 canon conflict 与 cross-work action 的拒绝、恢复或覆盖确认做成可复跑的真实产品链路。

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
