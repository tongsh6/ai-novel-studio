# VS-05 UI AvailableAction Roundtrip

- 状态：docs-ready
- 类型：UI Contract Slice
- 启动日期：2026-05-07
- 所属 DAG：`tasks/slices/v3/DAG.md` B6

> 本文件是 VS-05 的具体 slice 入口，不是 implementation plan，不授权代码实现。当前文档 blocker 已关闭；进入代码实现仍需用户明确批准。

---

## 1. 用户 / 系统目标

打实 v3 UI 主出口：Workbench UI 只消费 TurnResultViewModel，只提交自由文本或 AvailableAction。系统必须拒绝 stale、invented 或 disabled action，并返回新的 TurnResultViewModel，而不是让 UI 直接修改 behavior、tool、adoption 或 projection 状态。

本 slice 证明 UI 是作者动作收集者，不是第二个 Orchestrator。

---

## 2. 开工检查

- Contract: `TurnResultViewModel`、`AvailableAction`、`AuthorActionInput`、`TraceSummaryView`、`ProjectionHint`
- Invariant: `00c` §7 #9、#10、#13、#15：UI 只消费 TurnResult；UI 只能提交 available actions；trace summary 脱敏；projection hints 只触发刷新
- Boundary: 切过 web API boundary / frontend contract / application action ingestion / trace redaction；不让 frontend 直接调用 toolbox、写 BehaviorState 或写 adopted state
- Consumer: Workbench UI smoke test 或 API contract test
- Proof: invented / stale / disabled action 被拒绝；合法 action 只凭 action 引用回到主链，并由服务端取回 source TurnResultViewModel 后产生新 TurnResultViewModel

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-05 使用方式 |
|---|---|---|
| `tasks/slices/v3/VS-03-clarification-confirmation-behavior-lifecycle.md` | docs-ready | 提供 AvailableAction / BehaviorState action 起点 |
| `tasks/slices/v3/VS-04-candidate-selection-adoption-boundary.md` | docs-ready | 提供 candidate / projection hint 起点 |
| `docs/design-v3/adr/ADR-0014-trace-redaction-v3.md` | Accepted | 固化 author-visible trace summary redaction |
| `docs/design-v3/adr/ADR-0015-turn-result-view-model-v3.md` | Accepted | 固化 TurnResultViewModel 和 UI action roundtrip |
| `docs/design-v3/contracts/VS-05-ui-roundtrip-contract-pack.md` | Draft contract pack | 关闭 VS-05 view model / action / redaction / proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| ADR-0014 / ADR-0015 Accepted | closed | 两条 ADR 已标记 Accepted |
| TurnResultViewModel 最小 schema 明确 | closed | `docs/design-v3/contracts/VS-05-ui-roundtrip-contract-pack.md` §2 |
| AvailableAction roundtrip validation 明确 | closed | `docs/design-v3/contracts/VS-05-ui-roundtrip-contract-pack.md` §3 |
| UI card type subset 明确 | closed | `docs/design-v3/contracts/VS-05-ui-roundtrip-contract-pack.md` §4 |
| TraceSummaryView redaction policy 明确 | closed | `docs/design-v3/contracts/VS-05-ui-roundtrip-contract-pack.md` §5 |
| UI proof 明确 | closed | `docs/design-v3/contracts/VS-05-ui-roundtrip-contract-pack.md` §6 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 enum、id、Result/Error、validation helper |
| novel_domain | no | VS-05 不新增领域规则 |
| novel_agent | no | UI action 不进入 agent |
| novel_application | yes | 负责 TurnResultViewModel assembly、action validation、trace redaction coordination |
| novel_persistence | no | VS-05 不要求新增 Repo、DB schema 或 migration |
| novel_web | yes | 负责 API boundary serialization；不运行 business decision |
| frontend | yes | 作为 TurnResultViewModel 消费者和 AuthorActionInput 提交者；不写系统事实 |
| docs/design-v3 | yes | 本 slice 消费 ADR-0014、ADR-0015 和 VS-05 contract pack |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 评审 ADR-0014 是否满足 trace redaction 输入门槛 | done | ADR-0014 已进入 Accepted |
| T2 | 评审 ADR-0015 是否满足 TurnResultViewModel 输入门槛 | done | ADR-0015 已进入 Accepted |
| T3 | 补 VS-05 contract pack | done | `docs/design-v3/contracts/VS-05-ui-roundtrip-contract-pack.md` |

---

## 7. 验证

设计阶段验证：

- [ ] `rg -n "ADR-0014.*Pro""posed|ADR-0015.*Pro""posed|TurnResultViewModel.*Pro""posed|TraceSummaryView.*Pro""posed|VS-05.*plan""ned" docs/design-v3 tasks/slices/v3`
- [ ] `rg -n "TO""DO|TB""D|占位""符|下一步需要冻""结|仍未进入 Pro""posed" docs/design-v3 tasks/slices/v3`
- [ ] `git diff --check`

实现阶段验证入口：

- [ ] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`
- [ ] `bash scripts/frontend_audit.sh`
- [ ] `bash scripts/check_design_trace.sh`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

---

## 8. 决策日志

- 2026-05-07 — 从 `tasks/slices/v3/DAG.md` B6 建立 VS-05 文件。当前只授权 slice 设计和评审，不进入 implementation plan / code。
- 2026-05-07 — 新增 `docs/design-v3/contracts/VS-05-ui-roundtrip-contract-pack.md`，关闭 VS-05 文档 blocker，并将 ADR-0014、ADR-0015 标记为 Accepted。仍不授权代码实现。
- 2026-05-25 — Creative artifact UI roundtrip 纠偏落地：tentative creative artifact 改用 semantic `candidate_set` display card，card 不内嵌采纳/放弃/修改动作；动作由 application 层 `AvailableActionBuilder` 独立生成，frontend 从 `available_actions` 渲染和提交。

---

## 9. 试行反馈

- VS-05 的关键不是做页面，而是证明 UI roundtrip 不会绕过 TurnResult 和 Orchestrator。
- VS-05 的验收必须证明客户端伪造的 `source_turn_result` 不能授权 action；服务端必须使用自己保存或可回读的 TurnResultViewModel 作为校验来源。
- VS-05 刻意不冻结 replay developer report；否则会把 VS-06 的 replay surface 提前拉进来。
- `choose_candidate` 只表达 selection intent，不等于 adoption；正文/设定类 artifact 采纳仍必须经过 adoption boundary。

---

## 10. 已知限制 & 跟进项

以下问题在 2026-05-09 code review 中发现，当前阶段（Phase 0，single-turn focus）不阻塞合入，记录在此供后续迭代跟踪。

| # | 问题 | 影响范围 | 当前缓解 | 建议触发条件 | 建议处理 slice |
|---|---|---|---|---|---|
| FU-1 | `turn_results_by_id` 存在 socket assigns，WebSocket 断线重连后丢失 | 重连后 `author_action` 拿不到 source turn result，action 被拒绝 | Phase 0 为单轮对话，重连场景低概率；reconnect 后用户重发 `user_message` 即可恢复 | 需要支持多轮 action 链跨重连时触发 | VS-08（从 persistence 回读 turn result）|
| FU-2 | `remember_turn_result` 只在 `user_message` 路径调用，`author_action` 产生的 turn result 不会被记入 assigns | action 处理后无法再接第二个 action（如 confirm → 再次 confirm） | 当前 action 模型为单次确认，不需要 action chaining | 产品需要 `confirm → revise → confirm` 链时触发 | VS-05（扩展 action roundtrip 为多跳）|
| FU-3 | `source_turn_result/2` stale 分支返回的 stub 只有 `turn_id` + `available_actions: []`，不是完整 TurnResultViewModel | 如果 `DialogueGateway` 对 stale stub 做 pattern match 期望更多字段，可能 crash | 当前 `ActionValidator` 校验 available_actions 为空的 action 时直接 reject，不会走到深层 match | 下游新增对 stale result 的结构化消费时触发 | VS-05（stale stub schema 完善）|

### FU-1 详细说明

```
当前：turn_results_by_id 是 socket assign，WebSocket 断线即丢失
目标：跨重连仍可验证 action 来源
方案：DialogueGateway 加 source_turn_loader 回调（类似 context_fetcher / trace_persister）
      服务端优先从内存取，miss 时 fallback 到 persistence
```

### FU-2 详细说明

```
当前：handle_in("user_message") → remember_turn_result，handle_in("author_action") → 不记
风险：action 产生新 turn_result 后，客户端无法基于新 result 再次提交 action
方案：在 author_action 的 {:ok, turn_result} 分支也调用 remember_turn_result
      同时更新 current_turn_id，使 action 链可前进
```

### FU-3 详细说明

```
当前：source_turn_result(socket, ref) when ref != current_turn_id
      → %{turn_id: current_turn_id, available_actions: []}
风险：下游若 pattern match %TurnResultViewModel{} 或访问 phase/schema_version 等字段会失败
方案：返回 {:error, :stale_turn} 原子，或构造完整的 fallback TurnResultViewModel
```

---
