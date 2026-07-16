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
- 2026-07-16 **CP1b（入口翻转，runtime 核心落地；场景迁移账开立）**：user_message
  进判断循环（机械准备 0 调用 → 判断①两段 2 调用 → reply 内联终结 / execute·plan
  切能力 profile / await 停等附 TurnResult）；frame 机械转换（下游零改动）；候选随
  call2 arguments 携带；judgment_decided 事件发射；预算 +1→+2；旧路由函数族删除；
  双桩判断规则表（Stub 文本规则 / SliceVerify 复用 profile_route_match + 帧候选
  构建 nonce 保留）。全 umbrella 1221/0 + I1/I2/I3 + 前端 394/0（commit 0c2c0e42）。
  **场景迁移账（未闭环，逐批重校准）**：
  ① `agent-conversation-turn`：4 步 3 调用 → 2 步 2 调用；plan_drafted 断言 →
     judgment_decided；叙事流式断言沿用（call1 chunks）。
  ② au01 家族：普通对话计数迁移；`au01-garbage-json-recovery` 语义重定义——帧 JSON
     恢复路径已不存在，坏结构现走 call2 native-tool 重试 → 仍坏则 S7 安全失败终局。
  ③ au02 候选家族：候选来源迁 judgment call2（nonce 回显已在桩保留）；计数 4→2。
  ④ 创作 profile 场景（约 15 个）：入场开销 +2 步 +1 调用（判断 2 取代路由 1），
     各场景 consumed 计数逐个按实测校准。
  ⑤ `agentic-loop-plan-replan-reasoning`（UA01D6REPLAN）与 `agent-no-progress-stop`
     （UA01NOPROGRESS）：对话计划路径经判断循环不再可达（chat 判 reply 终结），
     诱导需迁至创作 profile 或按判断循环语义重定义。
  ⑥ `agent-provider-execution-error-author-safe`：语义再迁——对话回应调用 = 判断
     call1；其失败现走 S7 安全失败终局（run failed + 安全 TurnResult），不再是
     frame 吸收为 completed；断言按新诚实语义重写。
  ⑦ conversation flow（context/frame/strategy/response 四步管线）在 user_message
     链路不再可达，仅 runtime 直连测试消费——退役评估登记为 CP2 前置清理项。
  ⑧ 入口 profile 更名 `profile_routing_v1` → `judgment_loop_v1`（wire 诚实身份：
     路由已并入判断）：与场景断言批一起做（planning-service 常量与测试、驱动/
     verifier 断言、authority_scope allowed_tools "profile_route"→"judgment" 同批）。
  **首验实锤（agent-conversation-turn 判断链真实页面已跑通，驱动待校准）**：
  run_started → goal_understood(机械 context) → 判断叙事 author chunks 逐字流式 →
  judgment_decided(author, judgment_reply) → turn_result（叙事+内联回复字节绑定）→
  run_completed；**consumed steps=2 / provider_calls=2 / tool_calls=0**（简单对话
  恰 2 次调用达成）。驱动失败点=旧 plan_drafted 计划步断言（校准对象）。
  共用驱动 `driveAgentConversationTurn` 服务 5 个场景 id（mainline 3 + D6 基 2），
  校准批次：mainline 判断链重写（conversation-turn / no-deviation-direct /
  stream-unified）先行，D6 基两个按 ⑤ 再诱导。
- 2026-07-17 **CP1 场景校准批一收口（commit e14c1a25）**：mainline 三场景真实
  Tauri 绿——`agent-conversation-turn`（判断链：机械 context 先行 → 叙事流式 →
  judgment_decided(reply) → 内联回复字节携带叙事前缀 → 2 步/2 调用/0 工具；
  持久化 ProviderRun 事实恰 2 条 author_reasoning+planner）、
  `agentic-loop-no-deviation-direct`（finder/behavior 参数化委托，直通=零修订）、
  `agent-provider-execution-stream-unified`（持久化事实合成帧家族断言迁判断口径）。
  迁移账⑧完成：`judgment_loop_v1` 更名全链落地。verifier 单测 174/0（三个 fixture
  迁判断形状 + N-NARR/经济学负例）。**批二待办**（迁移账①③④⑤⑥⑦剩余）：
  au01/au02 家族、创作 profile 计数位移批、D6 基两场景与 no-progress 再诱导、
  error-author-safe 语义再迁、conversation flow 退役评估。另记：连跑 harness
  偶发早期 SIGTERM（exit 144，Phoenix ready 后被杀，重跑即过）——疑为前后 run
  清理竞态，未阻塞但值得观察。
- 2026-07-17 **CP1 场景校准批二收口（commit ccd35ccd）**：创作 profile 家族七场景
  判断入场口径真实 Tauri 绿（roster-design / prose / outline / world / evolution /
  streaming-progress / p1-prose-revision-candidate）。计数位移三层落地（+2 步
  +1 调用 + completed_step_count 判断步计入）；驱动 fast-ack 更名残留清；两处
  "步骤描述进页面"过时断言迁 plan_drafted payload 推导（46§9.5）；UI 修复
  "第 4/2 步"假计数（进度行 done 钳位计划轨道 total）。**批三待办**：au01/au02
  家族、D6 基两场景 + no-progress 再诱导、error-author-safe 语义再迁、
  world-style-rule / readonly-batch / cancel·steer·durable 家族 run-and-see、
  conversation flow 退役评估（CP2 前置）。**CP1 累计 10 场景判断口径绿。**
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
