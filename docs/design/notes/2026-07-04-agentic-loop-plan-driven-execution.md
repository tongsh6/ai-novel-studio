# Agentic Loop 计划驱动执行设计（探索）

> 状态：讨论备忘（不冻结 schema、不授权实现）。结论需升级为 ADR-0023（建议新建）+ contract 扩展 + CP slice 后方可实现。
>
> 来源：2026-07-04 与作者确认的核心回路形态（「计划由模型动态生成 → 执行 → 探索 → 评估 → 偏离才修订计划」）；2026-07-03/04 全面 review 与 10 章狗粮长跑实证（`tasks/NEXT.md` 2026-07-04 条目、`tasks/slices/UA01-bounded-run-single-candidate-termination.md`）。
>
> 上游：ADR-0021（AgentRun/Turn 边界）、ADR-0022（计划可视化/评估重规划/叙事作者权，Proposed）、`notes/2026-07-01-agentic-loop-reasoning-stream-ui.md`（46§9 UI）。

---

## 1. 背景与根因

当前 loop（ADR-0021 运行时）是逐步 pick-one：每个 step 之前都调一次 `AgenticNextStepPlanner`，从 profile 写死的 2-4 个 step_options 里选下一步。ADR-0022 冻结了「计划可维护可修订、评估→重规划、叙事归模型」的语义，`NovelDomain.AgentPlan`/PlanStep 契约也已就位（kind/status/description/success_criteria/depends_on），但运行时没有兑现：没有真实的模型起草计划，`plan_steps` 主要服务 UI 展示。

实证代价（2026-07-04 长跑）：

- **调用经济学**：conversation=7 次 provider 调用/轮、prose=6、其余创作 profile=5；地板模型实测 40-65 秒/轮。其中约一半是「问模型下一步干嘛」的 planner 调用，而答案对确定性 pipeline 每次都一样。
- **鲁棒性**：planner 坏 JSON 无重试 → 一次解析失败灭整个 run；完成信号只靠提示词纪律 → 真实模型在 artifact_created 后再选 prose_writing（僵尸 run 四重后果：未请求候选/终态不诚实/迟到帧污染/饿死队列）。
- **判断力**：planner 只看到观察的一行 summary（structured_payload 不进 prompt），无法区分「小问题可完成」和「冲突必须重规划」。

三者同根：**把确定性推进也交给模型每步重新发明**。

## 2. 核心回路（与作者确认的形态）

```
目标理解
   ↓
计划起草（模型产出 AgentPlan v1：里程碑粒度 PlanStep，kind=explore|act，描述为模型措辞）
   ↓
┌─→ 执行计划中下一个 pending step（act 步构造单动作 MicroPlan，重新过 ExecutionOrchestrator 门）
│      ↓
│   观察（工具结果 / 探索发现 / 质量信号 → AgentObservation）
│      ↓
│   评估（先确定性核对；命中偏离信号才调模型）
│      ↓
│   ├─ 无偏离信号 → 机械推进：按计划执行下一步（0 次 planner 调用）─┐
│   ├─ 偏离信号   → 模型修订计划（v+1，带 revision_reason，插入/废弃/重排）─┤
│   ├─ 完成条件成立 → run 以 goal_satisfied 完成                        │
│   └─ 缺作者输入/预算尽 → awaiting_author                              │
└──────────────────────────────────────────────────┴─┘
```

两个关键修正（相对「每轮重新生成计划」的朴素理解）：

1. **修订而非重造**：计划是活文档。模型第一次起草，之后在原计划上修订（版本 v+1、修订原因、步骤插入/废弃/重排）。作者看到「v1 → 发现前提不成立 → v2（因为 X）」的连续演化。
2. **评估分两级**：观察后先做**确定性核对**（app 机器判，零成本）；只有命中偏离信号才**惊动模型**（一次 evaluate+replan 合并调用）。「每步都问模型」不是更 agentic，是把机械推进也付了模型价。

## 3. 固定/动态的三层边界（防「固定 workflow」误读）

| 层 | 固定/动态 | 归属 |
|---|---|---|
| 能力空间（allowed_tools、internal steps） | **固定** | 权限/安全边界，AgentTaskProfileRegistry + authority_scope |
| 计划（选哪些步、顺序、几步、为什么） | **动态** | 模型起草 + 模型修订（每 run 一份，非 app 预制） |
| 执行门（act 步单动作 MicroPlan → Orchestrator re-gate） | **固定** | 机器强制，ADR-0003/0004/0021 不动 |

机械推进 ≠ 固定 workflow 复活：被推进的轨道是**模型为本 run 起草的计划**，不是 app 预制的 steps 列表（已删除的 `AgentRunSequentialPlanner` 是后者）。红线判据是「轨道由谁产出」，不是「推进由谁执行」。

## 4. 运行时设计

### 4.1 计划起草（首次 planner 调用）

- profile routing 之后、第一个 step 之前，目标 profile 的 planner 做**一次**调用，产出：作者可见 reasoning（叙事，N-NARR 溯源）+ 结构尾巴（完整 PlanStep 列表：step_id/kind/description/success_criteria + 每步 target 能力 ref + 写作坐标字段沿用 2026-07-04 已落的 authoring_intent/target_chapter/requested_chapter_raw）。
- PlanStep 的 target 能力必须落在 allowed_tools ∪ internal_observation_steps（校验同现状 `validate_profile_tool`）；越界 → 同坏 JSON 处理（重试→失败）。
- 计划粒度沿 ADR-0022：一次 run ≈2-6 条里程碑，不与 tool call 1:1。

### 4.2 机械推进（advance，0 次模型调用）

step 完成且**全部**满足时直接执行计划中下一个 pending step：

1. 本步 status=completed（工具成功）；
2. 无 §4.3 任一偏离信号；
3. 下一 pending PlanStep 存在且其 target 通过 profile 白名单；
4. act 步照常构造单动作 MicroPlan 重新过 Orchestrator（门是确定性裁决，不是模型调用；gate deny 本身构成偏离信号）。

### 4.3 偏离信号族（确定性触发器 → 一次 evaluate+replan 模型调用）

| # | 信号 | 来源 |
|---|---|---|
| D1 | step/工具失败 | tool_result.status=failed（替代现状「直接 run_failed」：先给模型一次改道机会，重试预算内） |
| D2 | 质量复核产出需行动 finding | quality_review.policy_action ≠ none / finding severity 达阈值 |
| D3 | 作者 steer | 既有 `maybe_promote_steer_plan_revision` 归入此信号族（goal version bump → 必须 replan） |
| D4 | Orchestrator gate deny / require_confirmation | 现状直接报错；改为偏离信号（模型可改道或 await_author） |
| D5 | 预算余量不足以走完剩余计划 | remaining steps/provider budget < 剩余 pending 步的下界估计 |
| D6 | 计划走完但完成条件未成立 | 所有 PlanStep done 而 §4.5 完成条件缺失 |
| D7 | 观察带确定性缺口标记 | 上下文缺失（missing policy soft）、空阵容等 app 可判类别 |

evaluate+replan 是**一次**合并调用（沿 ADR-0022 决策 2 的「不加独立 call site」精神）：输出 evaluation_of_last + 修订后的计划（或 done/await_author）。修订受 `max_replans` 预算约束（建议随本设计从全档 1 放宽为创作档 2，见 §10）。

### 4.4 完成与终止

- **机械完成**：计划全部步骤 done 且 profile 完成条件成立（创作档：pending artifact 已产出；conversation：本轮回应已产出）→ run 以 `goal_satisfied` 完成，**不再花一次「done 收束」调用**。完成叙事 = 最后一次计划（修订）调用里模型对终局的措辞 + app 结构态（chip/进度），不伪造收束 prose。
- **候选预算 backstop**（T3-B，已拍板）：`AgentRunPolicy` 候选预算项；候选已达预算而仍要执行新步 → 系统裁决完成（goal_satisfied + reason_codes 留痕模型提议）。计划驱动下该 backstop 兜「模型把计划修出第二份候选」的残余情形。
- awaiting_author（预算尽/D3 需确认/await 决策）与 no_progress（progress_signature 复现）语义保留不变。

### 4.5 协议鲁棒性（分两级，节奏待拍板）

- **本设计内（CP0）**：planner/replan 调用补「携带失败片段重试一次」（与 writer、frame planner 同款既有模式）。消除「一次坏 JSON 灭 run」。
- **后续独立 CP（推荐、未拍板）**：迁移 OpenAI-compatible 原生 tool calling（LM Studio/DeepSeek/Anthropic 均支持，SSE adapter 架构已就位）——reasoning 为正文、结构为 tool call，与「两段式」天然同构，解析鲁棒性质变。改造面：ProviderExecution 扩展 + stub 应答改造 + planner 调用点迁移，归 `UA01-provider-execution-stream-unification` 域。

### 4.6 观察保真

计划起草与 replan 调用的 prompt 携带最近 K 条观察的**紧凑 structured_payload**（预算内截断；质量 finding 至少含 gate/severity/summary 明细），不再只有一行 summary。K 与字符预算随 AssemblyPolicy 档位参数化。

## 5. 调用经济学目标（每轮 provider 调用，含 1 次 routing）

| profile | 现状 | 目标（无偏离路径） | 备注 |
|---|---|---|---|
| conversation_turn | 7 | ≈3（routing+计划+frame） | finalize 复用 frame 产物则 3，独立则 4 |
| prose_drafting | 6 | 4（routing+计划+writer+evaluator） | 质量链不减 |
| character/outline/evolution/world | 5 | 3（routing+计划+tool） | |
| prose_revision | 6 | ≈3-4（计划+writer±evaluator） | 无 routing（action 入口） |

每轮墙钟预期近似减半（地板模型实测 40-65s → 目标 20-35s）。偏离路径每次 replan +1 调用，受 max_replans 约束。精确口径在各 CP 落地时以真实验收定格，本表只定方向。

## 6. 叙事与 46§9 兼容（N-NARR）

- 模型叙事节点收敛为：**计划起草 / 计划修订（带原因）/ 完成（终局措辞随最后一次计划调用）/ await**。字节溯源与 provenance 要求不变。
- 机械推进的步骤只产**结构事件**（tool_started/observed/gate_decided 等 app 骨架，46§9 本就归 app）；「执行中」态用计划面板的 status 推进表达，天然匹配 46§9 五态（探索中/执行中/受阻/重规划/完成）。
- 相比现状的变化被诚实声明：作者不再每步看到一段模型独白；换来的是一份真实的、可检视的计划和有原因的修订。若实测作者体感需要更密叙事，可加 opt-in 的步级 narration 调用（默认关）。

## 7. 与既有 ADR 的关系

- **ADR-0003/0004/0021 全保留**：planner 只提议不批准；act 步单动作 MicroPlan + re-gate；AgentRun/Turn 边界、打断、durable 不动。
- **ADR-0022 细化 + 一处执行语义修订**：决策 1（计划可视化/版本化/修订）与决策 3（叙事作者权）原样兑现；决策 2 的「每次 observe 后 evaluate（折进每步 planner 调用）」修订为「每次 observe 后**确定性核对**，命中偏离信号才做 evaluate+replan 合并调用」——保留其「不加独立 call site、先评估后决策」的精神，把普通路径成本从每步一调降到零。该修订需 ADR 级冻结。
- **建议新建 ADR-0023**（Agentic Loop 计划驱动执行与调用经济学）引用并细化 0022，而非改写 0022（0022 的三决策独立成立；执行经济学是新决策域）。

## 8. 契约影响清单

- `NovelDomain.AgentPlan`：契约已就位；补「修订操作语义」（插入/废弃/重排的规范化 + revision_reason 强制）。
- `NovelDomain.AgentNextStepDecision`：语义从「每步选步」升为「计划起草/修订载体」（decision_type 增 plan_drafted/plan_revised 或以现有 execute_step+plan_revision 承载，实现期定）。
- `NovelDomain.AgentRunPolicy`：+候选预算项（T3-B，已拍板）；max_replans 建议创作档 1→2。
- `NovelCommon.Contracts.AgentEvent`：plan_drafted/plan_revised 事件族沿 ADR-0022；机械推进步不产叙事事件。
- `UA-01 contract pack`：预算矩阵、planner 协议（计划起草/修订两态 prompt + 结构尾巴 schema）更新。

## 9. 验收与不变量影响（诚实登记）

- **各 profile provider_calls 口径全量下调** → 既有真实 Tauri scenario 的 verifier 断言须同步迁移（agent-conversation-turn、agent-prose-drafting-with-quality、agent-plot-outline/character-evolution/world、agent-no-progress-stop、provider-execution 系列的 budget 断言）。这是本设计最大的验收迁移面，须在 CP 内逐个登记复跑。
- **stub/slice_verify**：`agent_next_step_decision_content` 从「按观察选步」应答改为「产出计划/按信号修订」应答；I1/I2/I3 与 N-NARR driver 的锚点保持（「AgentRun 下一步规划器」锚点词随 prompt 改名需同步 stub，登记为 [[creative-prompt-stub-anchor-coupling]] 同类耦合）。
- **证明 slice**：ADR-0022 预留的 `agentic-loop-plan-replan-reasoning`（前提不成立 → 真实页面看到 v1→探索→评估→v2 带模型原因→执行→完成回顾）作为本设计伞形验收；另加「无偏离直通」场景断言零 replan 调用与目标调用数。
- **狗粮**：作为搭车复验（0 retry 通过线沿 UA01-bounded-run slice），不为本设计单独触发。

## 10. CP 切分建议

| CP | 内容 | 风险 |
|---|---|---|
| CP0 | planner 坏 JSON 重试 + 观察保真（不改 loop 形态） | 低，立即降脆弱性 |
| CP1 | 计划起草调用 + AgentPlan 运行时落地 + 机械推进（先 conversation + prose 两 profile，其余 profile 过渡期保留逐步 planner——两形态并存须登记为过渡态） | 中 |
| CP2 | 偏离信号族 D1-D7 + evaluate/replan 合并调用 + steer 融合 + 预算语义（含 T3-B 合并实现、max_replans 放宽） | 中高 |
| CP3 | 全 profile 迁移 + 完成态 + 46§9 计划面板消费 + 验收口径全量迁移 | 高（迁移面大） |
| CP4（独立后续） | 原生 tool calling 协议迁移 | 中，归 provider execution 域 |

## 11. 未冻结语义 → ADR-0023 待办 / open decisions

1. tool calling 迁移节奏（§4.5 推荐「先加固后迁移」，待拍板）。
2. 完成态是否需要模型收束叙事（§4.4 取「不需要」，若体感不足加 opt-in）。
3. max_replans 创作档默认值（建议 2）。
4. CP1 两形态并存过渡期的验收口径标注方式。
5. evaluate 被规划裹挟的回退阀（ADR-0022 已留：拆独立便宜 evaluate 调用）在事件触发模式下是否仍需要。
