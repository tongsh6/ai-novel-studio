# AU05 Stale / Conflict / Cross-Work Freshness / 过期、冲突与跨作品采纳安全

- 状态：next
- 类型：Safety Slice / Adoption Boundary
- 来源：`tasks/slices/AU05-adoption-safety-freshness.md` §6；`docs/design-v3/acceptance/author/AU-05-artifact-adoption.md` AU05-GAP-06 / SC-AU05-C3~C5
- 当前目标：在高风险候选 confirmation 已闭环后，继续把 stale source、canon conflict、cross-work action 的拒绝或恢复路径做成真实工作台可验收的产品链路。

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
