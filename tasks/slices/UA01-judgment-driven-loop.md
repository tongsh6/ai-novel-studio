# UA01 判断驱动交互循环（ADR-0025 实施）

- 状态：CP0 done（文档批次 2026-07-15）/ CP1 todo（开工需用户批准 + MBC 探针前置）
- 类型：Agent Runtime Slice / Prompt Protocol Slice
- 父 ADR：`docs/design/adr/ADR-0025-judgment-driven-interactive-loop-v3.md`（Accepted）
- 展开层：`docs/design/notes/2026-07-15-judgment-driven-interactive-loop.md`

## 1. 目标

交互场景从计划驱动迁到判断循环：机械准备 → 判断①（意图+形态，含计划按需）→
探索/执行 → 判断②（观察+续行）→ 收束或停等作者。协议主线方案 B（回复内联）。

## 2. CP 路线（每 CP 开工前补六问）

| CP | 内容 | 状态 |
|---|---|---|
| CP0 | ADR-0025 + ADR-0023 注记 + 00 §2.3 形态章 + 00c/46§9.6/README 联动 | **done**（2026-07-15） |
| CP1 | conversation 迁判断循环（方案 B：判断①两段 + 直接回复内联；路由并入判断①）。**前置**：MBC 探针验证内联协议与"是否开计划"判断质量 | todo |
| CP2 | 单候选创作 profile 迁循环（执行内联自评 + 判断②按需） | todo |
| CP3 | prose/修订迁循环；D 系循环语义回归 | todo |
| CP4 | 计划按需全量（判断①制定计划分支 + UI 真计划恢复显示） | todo |
| CP5 | 探索内部翼（作品事实索引 + 检索工具箱 + 探索预算） | todo（可与 CP2/CP3 并行） |
| CP6 | 探索外部翼（SearchProvider + web_search + 带来源设定候选 + 网络授权边界） | todo（依赖 CP5 框架） |

## 2a. CP1 前置：MBC judgment-protocol 探针（2026-07-16，done）

`scripts/model_contracts/judgment_protocol.exs`（SI slice T7）验证两件事：

1. **方案 B 回复内联协议**：call1 自由输出（判断叙事；判"直接回复"时同一次输出
   空行后内联回复正文），call2 强制 native tool call 产轻量 `judgment_decision`
   结构（action 五选一 + capability + reply_included + reason）。
2. **"是否开计划"判断质量**：六用例阵列——闲聊观点(reply)/上下文事实(reply)/
   单动作创作(execute，不得乱开计划)/多步复杂(plan，不得漏计划)/需检索(explore)/
   意图不明(await_author)。

结果：stub 自检 12/12=1.0；**live LM Studio（openai/gpt-oss-120b）六用例全过
overall_pass_rate=1.0**（证据 `artifacts/model-contracts/lmstudio/judgment-protocol.json`）。
判断①提示词草案在探针内，CP1 落地时迁入生产模块、探针改为消费生产构造器。

## 2b. CP1 六问（开工登记，2026-07-16）

1. **Contract**：ADR-0025 决策 1/2/5（循环形态、计划按需、协议方案 B）；判断①
   动作枚举 `reply|execute|plan|explore|await_author`；N-NARR（判断叙事与内联
   回复字节绑定 provider 输出）；N-PLAN 新文本（无计划循环=judgment 事件链）。
2. **Invariant**：简单对话恰 2 次 provider 调用；判断叙事流式（call1 自由输出）；
   执行权不变（execute 动作仍逐一过 Orchestrator gate）；机械准备（上下文组装）
   永不问模型；判断①永不静默（叙事先行）。
3. **Boundary**：novel_application（判断循环 runtime + 判断①提示词模块 +
   dialogue_planning_service 入口）；novel_agent 仅 Stub 契约样本；不改
   novel_domain 执行权结构、不改 novel_web 广播协议（judgment 事件走既有
   agent_event 族）、不改 S1-S7 契约。
4. **Consumer**：workspace_channel 既有 user_message 入口（消费新 spec）；前端
   既有文档流 UI（判断叙事=46§9.4 意图段体裁，reply 正文=assistant_message）。
5. **Proof**：runtime focused tests（reply 2 调用收束 / execute 路由到既有
   profile / await_author 停等 / 坏结构重试）+ MBC 探针（已过）+ 真实 Tauri
   场景（简单对话 2 调用 + judgment 事件链）。
6. **Acceptance Driver**：`bash scripts/tauri_slice_verify.sh agent-conversation-turn`
   按判断循环口径重校准（外部驱动真实页面；产品无验收感知逻辑）。

**CP1 范围决定**（按 ADR-0025 冻结点内实施）：
- `reply`：判断循环原生路径——call1 内联正文即回复，TurnResult 正文字节绑定
  call1 输出；简单对话 = 2 次调用（判断① call1+call2），无 frame/strategy/
  response 三步管线。
- `execute`：路由语义并入判断①——action=execute + capability 等价旧路由选
  profile，切换到既有创作 profile flow（计划起草→机械 cursor 沿用；CP2 再迁
  执行内联自评）。
- `plan`：CP1 映射到既有计划驱动机制（judgment 判"复杂"→ 对应 profile 的
  AgentPlan 起草路径）；判断①自产计划分支是 CP4。
- `explore`：CP1 生产能力目录**不含检索能力**（CP5 未建），判断①提示词不提供
  explore 选项（探针已单独验证该判断力，CP5 接入时打开）。
- `await_author`：停等出口——判断叙事作为向作者的说明，run awaiting_author
  （S4 字段级 schema 是 ADR-0024 CP2 债，此处只保证不静默停机）。

**CP1 实施细则（2026-07-16 冻结，frame 语义折叠）**：

1. **frame 折叠**：note §5 映射"frame 语义并入判断①输出结构"落地为——判断①
   call2 结构直接产出 DialogueFrame 所需字段（意图/形态/工具需求），app 做
   **机械转换**（判断结构 → DialogueFrame struct，非预制创作决策），下游
   TurnResultBuilder / gateway 持久化 / 采纳桥全部沿用零改动。
2. **候选随判断结构携带（S2 保全）**：候选探索类输入（au02 家族"给几个方向"）
   判 `reply` 且 call2 arguments 可携带 `candidate_directions[]`——候选字节
   绑定 provider tool arguments（与 author_reasoning 同绑定类，I1/I3 语义不变），
   TurnResult 照常产出 candidate_set 卡与采纳桥。**探索对话从现状 4 次调用降到
   2 次**。
3. **入口与 profile**：`:profile_routing` 入口 run 重塑为判断循环（app 预制的
   route_profile 两步计划删除——N-PLAN；机械准备 context 步 0 调用先行，判断①
   两段随后）；execute/plan 沿用既有 `run_patch` profile 切换机制（等价旧路由，
   事件由 profile_route_decided 语义并入 judgment_decided）。
4. **事件命名冻结**：新增一等事件类型 **`judgment_decided`**（novel_common
   @event_types + runtime @stage_event_types + 46§9.6 回连）；判断叙事流式沿用
   provider_progress author chunks（N-NARR 字节绑定），不新增事件类型。
5. **验收资产迁移面**（ADR 已知成本）：`agent-conversation-turn` 按判断循环
   口径重校准（2 次调用、judgment_decided 链）；au02 候选家族在新链路下必须
   保持绿（stub 判断 handler 镜像候选携带 + nonce 回显 + I2 指纹）。

## 3. 决策日志

- 2026-07-15：CP0 文档批次落地（用户"同意 开始落所有的文档"）。ADR-0025 同日
  Accepted（用户四次方向拍板）；N-PLAN 改写进 00c §7 #17；形态陈述落 00 §2.3。
- 2026-07-16：CP1 前置 MBC 探针落地并通过（stub 1.0 + live gpt-oss-120b 1.0）；
  CP1 六问登记，开工（用户"开工"）。
- 2026-07-16 **CP1a（协议资产落地，不翻入口）**：`NovelApplication.JudgmentProtocol`
  生产模块——判断①两段式请求机（call1 叙事流式 + call2 强制 judgment_decision，
  坏结构携带片段重试一次）、叙事绑定（content 优先 / arguments.author_narrative
  降级，与计划协议同构）、candidate_directions 携带 schema、explore 形态由能力
  目录选项开关（CP5 打开）；`judgment_decided` 事件类型入 novel_common 契约 +
  runtime stage 事件族。探针改为消费生产构造器（首个真实消费者），stub 自检 1.0
  + live 复验生产路径。**CP1b（未闭环）**：入口翻转（profile_routing → 判断循环）、
  frame 机械转换 + reply 终结链、SliceVerify 判断 handler（继承路由规则表）、
  focused runtime tests、场景迁移账（agent-conversation-turn 2 调用口径 + au02
  候选家族 + 全部 user_message 场景计数位移 + no-progress 场景诱导再迁移）。

## 4. 下次会话恢复指引

先读 ADR-0025 与来源 note（§4 协议三方案、§5a 探索两翼、§8 开放问题 1-7），
CP1 开工前先做 MBC 探针（复用 scripts/model_contracts/ 模式）。
