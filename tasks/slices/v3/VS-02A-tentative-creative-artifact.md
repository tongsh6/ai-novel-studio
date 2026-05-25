# VS-02A Tentative Creative Artifact

- 状态：docs-ready
- 类型：Artifact Slice
- 启动日期：2026-05-08
- 所属 DAG：`tasks/slices/v3/DAG.md` B6

> 本文件是 VS-02A 的具体 slice 入口，不是 implementation plan，不授权代码实现。它补足 v3 首批切面中“AI 不只是会聊，还能产出小说创作材料；但产物先是草稿/候选，不直接变成权威作品事实”的证明。

---

## 1. 用户 / 系统目标

打实 v3 的创作产物主链：AI 可以基于作者输入和小说上下文生成角色设定、剧情方向、章节片段或大纲草稿，但这些内容默认只是 tentative artifact，也就是“待作者采纳的创作材料”。

本 slice 证明 v3 不是只会聊天和解释的系统，而是能实际帮助作者创作；同时它也证明系统不会把 AI 生成内容直接写进权威作品状态。

示例输入：

```text
根据刚才那个赛博修仙方向，给我三个主角设定。
```

期望输出：

```text
给你三个可以继续发展的主角草案：
1. 被算法判定无灵根的底层维修工
2. 替公司清理失控仙术实验的合同修士
3. 偷渡进云端宗门的旧城少女
```

系统可以展示这些草案，但不能宣称它们已经成为正式角色。

---

## 2. 开工检查

- Contract: `DialogueContext`、`MicroPlan`、`ToolRequest`、`ToolResult`、`TentativeArtifactSet`、`TurnResult`、`DecisionTrace`
- Invariant: `00c` §7 #3、#5、#6、#9、#11、#14：Orchestrator 是唯一门禁；工具调用有 trace；写入默认 tentative；TurnResult 是 canonical 输出；candidate selection 不等于 adoption；replay 默认不重新调用 LLM
- Boundary: 切过 application decision / agent creative tool runtime / TurnResult / trace；不写 production state；不让 ToolResult 直接变成 adopted state
- Consumer: Application artifact contract test 或 Workbench candidate card
- Proof: 生成角色设定或章节片段时只产生 tentative artifact；TurnResult 明确这是草案；未经过选择和 adoption 不写入权威作品事实

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-02A 使用方式 |
|---|---|---|
| `tasks/slices/v3/VS-00B-dialogue-context-grounding.md` | docs-ready | 提供当前小说上下文和不编造事实的基础 |
| `tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md` | docs-ready | 提供执行门禁和 decision 起点 |
| `tasks/slices/v3/VS-02-tool-request-result-trace-loop.md` | docs-ready | 提供工具调用 provenance 和 ToolResult 边界 |
| `docs/design-v3/adr/ADR-0010-state-adoption-boundary-v3.md` | Accepted | 固化 tentative / candidate 不等于 adopted state |
| `docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md` | Draft contract pack | 关闭 VS-02A 创作草稿、候选产物和 proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| tentative artifact 最小语义明确 | closed | `docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md` §2 |
| creative ToolResult 与 adopted state 边界明确 | closed | `docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md` §3 |
| TurnResult truthfulness 明确 | closed | `docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md` §4 |
| artifact proof 明确 | closed | `docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md` §5 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 id、Result/Error、validation helper |
| novel_domain | yes | 可承接纯 artifact 类型校验或目标对象规则；不做 I/O |
| novel_agent | yes | 执行创作工具或 provider 调用，返回 ToolResult / tentative artifact |
| novel_application | yes | 负责 decision、工具调用批准、TurnResult assembly、trace coordination |
| novel_persistence | no | VS-02A 不要求新增 Repo、DB schema 或 migration |
| novel_web | yes | 只返回 TurnResult；不直接写作品状态 |
| frontend | yes | 可作为 candidate / draft card 的后续消费者；不得把草稿当正式作品事实 |
| docs/design-v3 | yes | 本 slice 消费上下文、工具、adoption boundary 和 VS-02A contract pack |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 补 tentative artifact 最小语义 | done | `docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md` §2 |
| T2 | 补 creative ToolResult 与 adopted state 边界 | done | `docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md` §3 |
| T3 | 补 TurnResult truthfulness | done | `docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md` §4 |
| T4 | 补 artifact proof | done | `docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md` §5 |

---

## 7. 验证

设计阶段验证：

- [x] `rg -n "VS-02A|Tentative Creative Artifact|创作草稿|tentative artifact" docs/design-v3 tasks/slices/v3`
- [x] `rg -n "TO""DO|TB""D|占位""符|下一步需要冻""结|仍未进入 Pro""posed" docs/design-v3 tasks/slices/v3`
- [x] `git diff --check`

实现阶段验证入口：

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

---

## 8. 决策日志

- 2026-05-08 — 根据最终愿景复审新增 VS-02A。当前只授权 slice 设计和评审，不进入 implementation plan / code。
- 2026-05-25 — Creative Artifact Runtime 纠偏实现已落地：工具 envelope 移到 `novel_common`，Toolbox runtime 移到 `novel_agent`，`ArtifactAssembler` 成为唯一 tentative artifact 创建边界，`world_setting` 纳入 artifact_type，unknown artifact_type 改为 validation failure；泛化 creative capability `creative_generation` 已从 production registry 移除，不再作为 production capability。

---

## 9. 试行反馈

- VS-02A 的关键不是做完整写作引擎，而是证明 AI 能产出小说材料，同时默认只进入待采纳状态。
- VS-02A 刻意放在 VS-02 后、VS-04 前：先有工具调用 provenance，再谈创作草稿，最后才进入采纳边界。
- 本轮明确不冻结正式长跑任务契约；同步创作工具不再输出 synthetic task_state_events。Formal TaskState / Long-running Creative Job Contract deferred。
