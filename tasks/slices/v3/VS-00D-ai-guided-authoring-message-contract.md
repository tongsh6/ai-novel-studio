# VS-00D AI-Guided Authoring Message Contract

- 状态：docs-ready
- 类型：Contract Reconciliation Slice
- 启动日期：2026-06-13
- 所属 DAG：`tasks/slices/v3/DAG.md` B16

> 本文件是 VS-00D 的具体 slice 入口，不是 implementation plan，不授权代码实现。它把“AI 引导作者进行小说创作”从愿景与 prompt 口号收束为三层 contract + AI message layer 的可验收闭环。

---

## 1. 用户 / 系统目标

打实 v3 的核心判断：本应用是小说创作 Agent 系统，质量上限由每一轮 AI 会话结构决定。每次创作相关 AI 调用都必须能说明：

1. 本轮用了哪些小说创作判断框架；
2. 当前作品有哪些有来源的真实状态；
3. AI 本轮应探索、结构化、执行、质量诊断、澄清还是确认；
4. 最终 messages 是如何由三层 contract 渲染出来；
5. 缺失、冲突、过期或省略内容如何进入 trace。

示例输入：

```text
这一章感觉不够爽，主角赢得太轻了。
```

期望系统不是泛泛回复“加强冲突”，而是基于当前章上下文、小说质量门和本轮引导判断，指出冲突、代价、读者回报和主角能动性的问题；若当前章上下文缺失，必须明确缺失。

---

## 2. 开工检查

- Contract: 小说层（NovelLayerMessage）、当前作品层（WorkStateMessage）、本轮引导层（TurnGuidanceMessage）、`AIMessageEnvelope`、`DialogueFrame` / trace 过渡承载、`CreativeDecisionPacket`
- Invariant: AI 必须参与创作语义判断；作品状态必须有来源；message envelope 可重建；AI 判断不能越过 Orchestrator 和作者采纳边界
- Boundary: 切过 application context assembly / agent planner message / domain frame validation / creative provider input / trace；不新增并行 Router，不让 provider 自行读取 Repo，不写 production state
- Consumer: Planner message、FrameTrace、MicroPlan、CreativeProvider tool input、AU-11 验收场景
- Proof: “这一章不够爽”场景能重建 NovelLayer / WorkState / TurnGuidance 三层 message；缺当前章上下文时不编造；若进入重写仍需 Orchestrator 裁决

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-00D 使用方式 |
|---|---|---|
| `docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md` | Proposed contract pack | 总 contract 与 AIMessageEnvelope 定义 |
| `docs/design/08-novel-element-model.md` | Draft design | 小说层上游：要素 × 层级 × 三态 |
| `docs/design/06-memory-context-and-trace.md` | Draft design | 当前作品层、ContextPacket、omission、trace |
| `docs/design/02-dialogue-frame-and-micro-plan.md` | Draft design + ADR-0001/0002 accepted boundary | 本轮引导层结构化承载 |
| `docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md` | Proposed contract pack | prose_writing 调用点的 CreativeDecisionPacket |
| `docs/design/acceptance/author/AU-11-ai-guided-authoring.md` | Design-ready acceptance | 作者视角验收闭环 |
| `tasks/slices/v3/VS-00A-creative-exploration-loop.md` | docs-ready / implemented evidence exists | 自然探索体验基础 |
| `tasks/slices/v3/VS-00B-dialogue-context-grounding.md` | docs-ready / implemented evidence exists | 当前作品上下文不编造基础 |
| `tasks/slices/v3/VS-02A-tentative-creative-artifact.md` | done | 创作产物 tentative-first 基础 |
| `tasks/slices/v3/VS-06-trace-summary-replay-explanation.md` | done | trace / replay 解释基础 |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| 三层 contract 与 message layer 的权威入口明确 | closed | `VS-00D-ai-guided-authoring-contract-pack.md` §2-4 |
| 小说层、当前作品层、本轮引导层各自权责明确 | closed | `08` §7.1、`06` §5.0、`02` §2.2.1 |
| `guidance_mode` 枚举覆盖探索、结构、执行、质量、澄清、确认、无引导 | closed | `02` §2.4 |
| prose_writing 专项 envelope 归属明确 | closed | `VS-00C` §1.4 |
| 作者验收入口明确 | closed | `AU-11-ai-guided-authoring.md` |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | possible | 可承接通用 id、Result/Error、validation helper；不承接小说语义 |
| novel_domain | possible | 后续 CP2 若冻结 `guidance_mode` 字段才涉及；当前文档不直接改 domain |
| novel_agent | yes | Planner/provider message 渲染必须消费 envelope；不直接访问 Repo |
| novel_application | yes | 负责 ContextAssembler、message envelope 组装、trace coordination |
| novel_persistence | no | 本 slice 不新增 schema；只通过现有/后续 read model 提供 WorkState refs |
| novel_web | yes | 后续验收从真实 Channel / 工作台入口进入 |
| frontend | yes | 后续 AU-11 真实验收需要 why/trace summary 可见，但本 slice 不改 UI |
| docs/design | yes | 本 slice 收束 contract、acceptance、DAG、reading map |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 补 VS-00D 三层 + message contract | done | `docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md` |
| T2 | 补 06/08/02 的职责边界 | done | 当前作品层 / 小说层 / 本轮引导层 |
| T3 | 补 AU-11 验收入口 | done | `docs/design/acceptance/author/AU-11-ai-guided-authoring.md` |
| T4 | 补 DAG 与索引引用 | done | `tasks/slices/v3/DAG.md`、`00c`、`00a` |
| T5 | 后续实现 CP1/CP1A | pending | 需单独授权 implementation plan |

---

## 7. 验证

设计阶段验证：

```bash
rg -n "VS-00D|AIMessageEnvelope|NovelLayerMessage|WorkStateMessage|TurnGuidanceMessage|AU-11" docs/design tasks/slices/v3
rg -n "guidance_mode.*clarify|guidance_mode.*confirm|澄清 / 确认|澄清还是确认" docs/design
git diff --check
```

实现阶段验证入口：

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `bash scripts/ai_static_scan.sh --top 10`
- [ ] 外部自动化从真实工作台触发 AU-11 场景，并输出到 `artifacts/slice-verify/vs-00d-ai-guided-authoring/`

---

## 8. 决策日志

- 2026-06-13 — 根据“小说层 / 当前作品层 / 本轮引导层”以及“AI message 层也必须分层”的设计讨论新增 VS-00D。当前只授权文档闭环和评审，不进入代码实现。

---

## 9. 试行反馈

- VS-00D 的关键不是多写一段 system prompt，而是让每次 AI 调用都能回放三层 message 来源、缺失处理和输出契约。
- VS-00D 不替代 VS-00A/VS-00B/VS-00C；它把这些已有能力纳入统一会话结构。
- 实现时优先 CP1/CP1A：先让 Planner frame/trace 能说明三层判断，再考虑新增 domain 字段。
