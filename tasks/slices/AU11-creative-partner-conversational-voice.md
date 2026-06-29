# AU11 Creative Partner Conversational Voice / 创作伙伴对话口吻

- 状态：设计（backlog，未开工）
- 类型：Dialogue Prompt / Persona Slice（提示词层，非路由、非运行时）
- 启动日期：2026-06-29
- 来源反馈：路由校准 + 消除「思考中」验证期间的真实观察——trivial 输入「测试」回应「测试已收到，系统运行正常。随时可以继续创作或讨论。」（系统诊断腔）
- 所属验收：`docs/design/00-vision-and-engineering-roadmap.md` §2 / §2.2（AI 引导式创作）；关联 `docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md`、`docs/design/02-dialogue-frame-and-micro-plan.md`（DialogueFrame.assistant_message）。

## 1. 用户 / 系统目标

作者面对的是「可感知的创作伙伴」，不是系统/通用助手。即使输入是 trivial 或模糊的（如「测试」「在吗」「嗯」「随便看看」「你好」），AI 的对话回应也应当**在角色内**、**围绕作品**、**邀请下一步创作**（例如「收到～想从哪儿入手？先聊聊故事方向，还是直接写两笔看看手感？」），而不是返回「系统运行正常」「已收到」这类系统诊断/机械腔。

本 slice **只改对话回应的口吻（persona）**，不改路由判定、不改 AgentRun 主链、不改写入/采纳边界，也不靠关键字/场景硬分支去「装人格」。

## 2. 开工检查

- **Contract**：消费 `00` §2/§2.2 的「AI 引导式创作三层契约」（小说层 / 当前作品层 / 本轮引导层），以及 `VS-00D-ai-guided-authoring-contract-pack.md`。固化点是 `DialogueFrame.assistant_message`（`02-dialogue-frame-and-micro-plan.md`）在**无工具对话轮**的口吻约束，由 `apps/novel_application/lib/novel_application/planner.ex` 的 `form_frame` system_prompt 投影。不新增/不改 schema 字段。
- **Invariant**：
  - persona 只影响 `assistant_message` 的语气，**不得改变** `frame_type` / `tool_need.needs_tool` / `execution_readiness` 等路由判定（不回归刚校准的路由 slice）。
  - 口吻来自 persona 提示词，**不得**按输入关键字/场景预制回应（守「意图用 AI 语义，不靠关键字」，且不破坏 I2/I3）。
  - 无工具对话轮仍是 no-write（persona 不触碰写入/采纳边界）。
  - 回答不得编造作品事实（章节数、角色、进度等）；persona 是语气层，不替代「当前作品层」上下文事实。
  - 不在生产代码（`frontend/src`、`apps/*/lib`）新增任何验收感知逻辑。
- **Boundary**：
  - `novel_application`：`planner.ex` 的 `form_frame` system_prompt 增补「创作伙伴」persona 段 + `assistant_message` 口吻约束（当前该 prompt 仅有任务/格式规则，无语气/人格约束）。
  - `novel_agent`：若 persona 需在创作 provider 层（`real.ex`）体现，**必须保留 stub 正则锚点**（见 memory `creative-prompt-stub-anchor-coupling`：`用户创作简述：/上下文：/重要：/JSON 数组/artifact_type：`），避免 I3 断。预期本 slice 主要落在 application 的 form_frame，不动创作锚点。
  - **不改**：`dialogue_planning_service`（profile 路由）、AgentRun 运行时（`agent_run_server` 等）、UI 阶段流（`WorkspaceChat` 创作执行面板）、契约 schema、写入/采纳边界。
  - `frontend`：预期无需改（`assistant_message` 后端生成，前端只渲染）。
- **Consumer**：作者在真实工作台 `WorkspaceChat` 的对话——无工具轮（downgrade / casual_reply / question_answer）的 `assistant_message`。
- **Acceptance Driver**：外部 Tauri/脚本驱动 `WorkspaceChat` 发一组 trivial/模糊输入，抓取 `assistant_message` 文本做分析性判定；产品代码新增验收感知逻辑：**no**。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 无需基础工具变更 |
| novel_domain | no | 不新增/不改 DialogueFrame schema |
| novel_agent | maybe | 仅当 persona 需落到创作 provider；若动 `real.ex` 必须保留 stub 锚点 |
| novel_application | yes | `planner.ex` `form_frame` system_prompt 增补创作伙伴 persona + `assistant_message` 口吻约束 |
| novel_persistence | no | 不涉及 |
| novel_web | no | 不涉及 |
| frontend | no | `assistant_message` 由后端生成，前端只渲染 |
| docs/design | maybe | 若把「创作伙伴口吻」沉淀为引导层约束，回写 VS-00D / `00` §2.2 |
| quality | yes | 新增分析性验收（非 0/1 不变量）manifest 入口 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 采集 baseline：一组 trivial/模糊输入（测试/在吗/嗯/随便看看/你好…）在真实 provider 下的 `assistant_message` 现状 | todo | 用 lmstudio + 确定性后端各跑一遍；记录机械腔指纹（系统/已收到/运行正常/正常…），按本地模型真实指纹选黑名单（教训：memory `prose-ai-taste-findings` 照搬别人黑名单打偏） |
| T2 | 在 `form_frame` system_prompt 增补创作伙伴 persona 段 + `assistant_message` 口吻约束 | todo | 在角色内、围绕作品、邀请下一步；明确禁止系统诊断腔；不改 frame_type/needs_tool 规则 |
| T3 | 回归确认：路由判定与 I1/I2/I3 不回归 | todo | 进度提问仍 question_answer no-tool、写正文仍进创作、character 复合仍起 run；三不变量复跑 |
| T4 | 分析性验收脚本 + quality manifest | todo | baseline vs treatment 对比：在角色内/邀请创作/不含机械腔黑名单的命中率提升；地板模型下收益有限须诚实标注 |
| T5 | 真实页面 Tauri 验收 + 证据归档 | todo | 外部驱动 `WorkspaceChat` 发 trivial 输入，截图 + assistant_message 判定；产品代码不加验收钩子 |

## 5. 验证（未开工，全部待办）

- [ ] 外部自动化驱动真实页面的场景化验收（`artifacts/slice-verify/au11-creative-partner-conversational-voice-tauri/summary.json`）
- [ ] baseline vs treatment 分析性对比（在角色内 / 邀请创作 / 无机械腔黑名单）
- [ ] `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`
- [ ] `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`
- [ ] `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs`
- [ ] 路由不回归：进度提问 no-tool / 写正文进创作 / character 复合起 run
- [ ] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-29 — 登记为 backlog 后续（`tasks/NEXT.md` Order 60），不抢当前队首 `UA01-unified-agent-run-mainchain-closure`。来源：路由校准 + 消除「思考中」验证时观察到 trivial 输入回应偏系统诊断腔（「系统运行正常」），与愿景「作者面对创作伙伴」不符。判定为提示词/persona 层质量问题，与路由、AgentRun 主链、UI 阶段流正交，且受地板档本地模型限制，单列为独立 slice。

## 7. 试行反馈 / 开放问题

- **地板模型限制**：本地小模型回应本就偏白偏套路（参 memory `prose-ai-taste-findings`：「降 AI 味」对正文的发现）。persona 提示词在地板档收益有限；是否现在做、还是等默认切换强模型后再做，由用户排期。
- **验收口径**：「像创作伙伴」不是 0/1 不变量，须做分析性/启发式评估 + 必要时人工观感，黑名单要按**本地模型真实机械腔指纹**选（不照搬）。
- **范围红线**：本 slice 严格限定在 `assistant_message` 口吻；一旦发现需要改 frame_type/needs_tool 才能改善，说明问题不在 persona 层，应回到路由/契约层另开 slice，不在此混入。
