# VS-02 ToolRequest / ToolResult / ToolTrace Loop

- 状态：docs-ready
- 类型：Turn Slice
- 启动日期：2026-05-07
- 所属 DAG：`tasks/slices/v3/DAG.md` B3

> 本文件是 VS-02 的具体 slice 入口，不是 implementation plan，不授权代码实现。当前文档 blocker 已关闭；进入代码实现仍需用户明确批准。

---

## 1. 用户 / 系统目标

打实 v3 工具 provenance 主链：系统可以在 Orchestrator 批准后调用一个受 registry 管控的工具，并且用 ToolRequest / ToolResult / ToolTrace 证明这个调用从何而来、用了什么 contract、返回了什么、为什么结果没有自动成为生产事实。

本 slice 证明 Toolbox 是后台能力层，不是 UI 工具按钮集合，也不是 Planner 可以自由调用的函数列表。

---

## 2. 开工检查

- Contract: `CapabilityRegistryEntry`、`ToolRequest`、`ToolResult`、`ToolTrace`、`DecisionTrace`
- Invariant: `00c` §7 #3、#5、#6、#9、#14：未经 decision 的 ToolRequest 不 dispatch；工具调用有 trace；ToolResult 不直接等于 production fact；TurnResult 是 canonical 输出；replay 默认不重新调用 LLM
- Boundary: 切过 application approving decision / agent toolbox runtime / trace coordination；不写 domain production state；不让 web 或 frontend 直接调用 toolbox
- Consumer: Replay / audit test
- Proof: 一个 read-only 或 validation tool 调用能从 decision 到 request/result/trace 完整 replay，且 replay 不重新调用 provider

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-02 使用方式 |
|---|---|---|
| `tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md` | docs-ready | 提供 accepted OrchestratorDecision 起点 |
| `docs/design-v3/adr/ADR-0011-toolbox-registry-v3.md` | Accepted | 固化 registry entry 与 status / version 语义 |
| `docs/design-v3/adr/ADR-0012-tool-request-result-v3.md` | Accepted | 固化 ToolRequest / ToolResult envelope |
| `docs/design-v3/adr/ADR-0013-decision-trace-v3.md` | Accepted | 固化 ToolTrace 进入 DecisionTrace 的最小语义 |
| `docs/design-v3/contracts/VS-02-tool-provenance-contract-pack.md` | Draft contract pack | 关闭 VS-02 registry / request / result / trace / proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| ADR-0011 / ADR-0012 / ADR-0013 Accepted | closed | 三条 ADR 已标记 Accepted |
| `CapabilityRegistryEntry` 最小 schema 明确 | closed | `docs/design-v3/contracts/VS-02-tool-provenance-contract-pack.md` §2 |
| `ToolRequest` 最小 schema 与 forbidden semantics 明确 | closed | `docs/design-v3/contracts/VS-02-tool-provenance-contract-pack.md` §3 |
| `ToolResult` 最小 schema 与 truth boundary 明确 | closed | `docs/design-v3/contracts/VS-02-tool-provenance-contract-pack.md` §4 |
| ToolTrace / DecisionTrace 最小 policy 明确 | closed | `docs/design-v3/contracts/VS-02-tool-provenance-contract-pack.md` §5 |
| replay / audit proof 明确 | closed | `docs/design-v3/contracts/VS-02-tool-provenance-contract-pack.md` §6 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 id、Result/Error、validation helper；不承接业务工具编排 |
| novel_domain | no | VS-02 不写 production domain state |
| novel_agent | yes | 承接被批准 ToolRequest 的工具 runtime，并返回 ToolResult material |
| novel_application | yes | 负责 decision 到 ToolRequest 的转换、registry 审查、结果集成、trace coordination、TurnResult truthfulness |
| novel_persistence | no | VS-02 不要求新增 Repo、DB schema 或 migration |
| novel_web | yes | 只提交 AuthorInput 并返回 TurnResult；不直接提交 ToolRequest |
| frontend | no | UI action schema 留给 VS-03 / VS-05 |
| docs/design-v3 | yes | 本 slice 消费 ADR-0011 至 ADR-0013 和 VS-02 contract pack |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 评审 ADR-0011 是否满足 Toolbox Registry 输入门槛 | done | ADR-0011 已进入 Accepted |
| T2 | 评审 ADR-0012 是否满足 ToolRequest / ToolResult 输入门槛 | done | ADR-0012 已进入 Accepted |
| T3 | 评审 ADR-0013 是否满足 ToolTrace / DecisionTrace 输入门槛 | done | ADR-0013 已进入 Accepted |
| T4 | 补 VS-02 contract pack | done | `docs/design-v3/contracts/VS-02-tool-provenance-contract-pack.md` |

---

## 7. 验证

设计阶段验证：

- [ ] `rg -n "ADR-0011.*Pro""posed|ADR-0012.*Pro""posed|ADR-0013.*Pro""posed|ToolRequest.*Pro""posed|ToolResult.*Pro""posed|ToolTrace.*Pro""posed|VS-02.*plan""ned" docs/design-v3 tasks/slices/v3`
- [ ] `rg -n "TO""DO|TB""D|占位""符|下一步需要冻""结|仍未进入 Pro""posed" docs/design-v3 tasks/slices/v3`
- [ ] `git diff --check`

实现阶段验证入口：

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

---

## 8. 决策日志

- 2026-05-07 — 从 `tasks/slices/v3/DAG.md` B3 建立 VS-02 文件。当前只授权 slice 设计和评审，不进入 implementation plan / code。
- 2026-05-07 — 新增 `docs/design-v3/contracts/VS-02-tool-provenance-contract-pack.md`，关闭 VS-02 文档 blocker，并将 ADR-0011 至 ADR-0013 标记为 Accepted。仍不授权代码实现。

---

## 9. 试行反馈

- VS-02 的关键不是实现更多工具，而是证明“批准、调用、结果、追踪、回放”之间没有断链。
- VS-02 刻意不冻结 production adoption；否则会把 VS-04 的写入边界提前拉进来。

---
