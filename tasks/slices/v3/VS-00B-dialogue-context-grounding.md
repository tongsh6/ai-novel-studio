# VS-00B Dialogue Context Grounding

- 状态：docs-ready
- 类型：Context Slice
- 启动日期：2026-05-08
- 所属 DAG：`tasks/slices/v3/DAG.md` B3

> 本文件是 VS-00B 的具体 slice 入口，不是 implementation plan，不授权代码实现。它补足 v3 首批切面中“AI 不是泛聊，而是带着当前小说上下文创作”的证明。

---

## 1. 用户 / 系统目标

打实 v3 的小说工作台属性：AI 回应作者时，应能使用受控的当前作品上下文、会话摘要和记忆摘要；如果上下文缺失，必须诚实说明并继续探索，不能编造作品事实。

本 slice 证明 v3 不只是可追踪聊天器，而是知道作者正在写哪部作品、当前设定是什么、最近讨论到了哪里。

示例输入：

```text
把主角动机改得更狠一点。
```

当上下文里已有“主角林烬，正在寻找失踪妹妹”时，系统可以回应：

```text
可以把“寻找妹妹”升级成“发现妹妹被宗门当成灵源使用”。这样林烬的动机会从找人变成复仇和揭露真相。
```

当上下文不存在时，系统必须诚实回应：

```text
我还不知道这个主角目前的设定。你给我一句他的现状，我再帮你把动机改狠。
```

---

## 2. 开工检查

- Contract: `DialogueContext`、`CurrentWorkSnapshot`、`MemoryContextSummary`、`ContextSourceRef`、`DialogueFrame`、`TurnResult`、`DecisionTrace.context_refs`
- Invariant: `00c` §7 #1、#8、#9、#13、#14：每 turn 必有 frame；缺上下文不自动表单化；TurnResult 是 canonical 输出；trace summary 脱敏；replay 默认不重新调用 LLM
- Boundary: 切过 application context assembly / persistence read model 或测试 stub / agent planner input / TurnResult / trace；不让 agent 直接访问 Repo；不写 production state
- Consumer: Application context assembly test 或 planner contract test
- Proof: 同一作者输入在有作品上下文时回应引用真实上下文；无上下文时不编造事实；trace 能列出被使用的 context refs

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-00B 使用方式 |
|---|---|---|
| `tasks/slices/v3/VS-00A-creative-exploration-loop.md` | docs-ready | 提供自然探索体验起点 |
| `docs/design/00b-end-to-end-dialogue-flow.md` | Draft design | 提供 DialogueContext 来源与主链位置 |
| `docs/design/06-memory-context-and-trace.md` | Draft design | 提供上下文、记忆和 trace 约束 |
| `docs/design/adr/ADR-0001-dialogue-frame-v3.md` | Accepted | 固化 grounded turn 也必须有 primary DialogueFrame |
| `docs/design/adr/ADR-0013-decision-trace-v3.md` | Accepted | 固化 trace 必须能解释上下文来源 |
| `docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md` | Draft contract pack | 关闭 VS-00B 上下文来源、诚实回应和 proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| DialogueContext 最小来源集合明确 | closed | `docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md` §2 |
| context refs 与 trace 绑定规则明确 | closed | `docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md` §3 |
| 无上下文时不编造事实的规则明确 | closed | `docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md` §4 |
| grounded response proof 明确 | closed | `docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md` §5 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 id、Result/Error、validation helper |
| novel_domain | no | VS-00B 不新增领域规则；只读取当前作品快照的安全摘要 |
| novel_agent | yes | 接收已组装好的 DialogueContext；不直接访问 Repo |
| novel_application | yes | 负责上下文组装、来源记录、planner 输入边界、TurnResult assembly、trace coordination |
| novel_persistence | yes | 可作为当前作品快照 / 记忆摘要的读取来源或测试 stub；不新增写入 |
| novel_web | yes | 只提交 AuthorInput 并返回 TurnResult；不直接拼上下文 |
| frontend | no | 可先由 application / Channel contract test 证明；前端消费留给 VS-05 |
| docs/design | yes | 本 slice 消费主链、记忆上下文、trace 和 VS-00B contract pack |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 补 DialogueContext 最小来源集合 | done | `docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md` §2 |
| T2 | 补 context refs 与 trace 绑定规则 | done | `docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md` §3 |
| T3 | 补无上下文时不编造事实规则 | done | `docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md` §4 |
| T4 | 补 grounded response proof | done | `docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md` §5 |

---

## 7. 验证

设计阶段验证：

- [ ] `rg -n "VS-00B|Dialogue Context Grounding|当前作品上下文|不编造事实" docs/design tasks/slices/v3`
- [ ] `rg -n "TO""DO|TB""D|占位""符|下一步需要冻""结|仍未进入 Pro""posed" docs/design tasks/slices/v3`
- [ ] `git diff --check`

实现阶段验证入口：

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

---

## 8. 决策日志

- 2026-05-08 — 根据 v3 愿景评审反馈新增 VS-00B。当前只授权 slice 设计和评审，不进入 implementation plan / code。

---

## 9. 试行反馈

- VS-00B 的关键不是扩大记忆系统，而是证明 AI 回应来自受控上下文，不是泛聊或编造。
- VS-00B 刻意不新增 production write；它只证明“读上下文并诚实回应”。

