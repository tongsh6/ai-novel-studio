# UA01 判断驱动交互循环（ADR-0025 实施）

- 状态：CP0-CP4 done（2026-07-18）/ CP5-CP6 todo（探索两翼）
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
| CP1 | conversation 迁判断循环（方案 B：判断①两段 + 直接回复内联；路由并入判断①）。**前置**：MBC 探针验证内联协议与"是否开计划"判断质量 | **done**（2026-07-17，四批 28 场景绿） |
| CP2 | 单候选创作 profile 迁循环（执行内联自评 + 判断②按需） | **done**（2026-07-18，CP2b 去伪计划 + 探针裁决判断②独立化） |
| CP3 | prose/修订迁循环；D 系循环语义回归 | **done**（2026-07-18，判断②+改进闭环+修订机械化） |
| CP4 | 计划按需全量（判断①制定计划分支 + UI 真计划恢复显示） | **done**（2026-07-18） |
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

## 2c. CP2 六问（开工登记，2026-07-17，用户"开工"）

1. **Contract**：ADR-0025 决策 1/5（执行内联自评、判断②按需、单候选创作 3 次调用
   经济学）；`evaluation_of_last` 结构（ADR-0022）作自评载体；S1/S2 候选停等语义
   不变；N-NARR（执行叙事与产物字节绑定 provider 输出）；I1/I2/I3 原样。
2. **Invariant**：单候选创作正常路径恰 3 次 provider 调用（判断① 2 + 执行 1 内联
   自评）；执行权不变（执行步仍逐一过 Orchestrator gate）；候选产出停 S1/S2（不
   自动采纳）；自评"目标已达成"必须结构显式（禁措辞猜测）；判断②仅在自评不确定/
   偏离时独立调用；机械准备永不问模型。
3. **Boundary**：novel_application（4 个单候选 flow——design/evolution/outline/
   world——执行骨架迁循环 + JudgmentProtocol 扩展自评 schema 与判断②请求机）；
   novel_agent 仅桩契约样本；不改 novel_domain 执行权/AgentPlan 结构、novel_web
   透传、S1-S7 契约。prose 双步（quality 复核）是 CP3，本 CP 不动。
4. **Consumer**：workspace_channel 既有 user_message 入口；前端既有文档流 UI
   （执行叙事 46§9.4 体裁、候选卡采纳桥沿用零改动）。
5. **Proof**：MBC 执行内联自评探针（前置，ADR 开放问题 1 指名）+ runtime focused
   tests + 真实 Tauri 场景（roster-design/outline/world/evolution 按 3 调用口径
   重校准）+ I1/I2/I3。
6. **Acceptance Driver**：`bash scripts/tauri_slice_verify.sh agent-roster-design`
   等四场景按判断循环执行口径重校准（外部驱动真实页面；产品无验收感知逻辑）。

**CP2 范围决定**：
- 执行内联自评：writer 类执行调用的 native tool call arguments 携带
  `evaluation_of_last` 式自评尾巴（goal_achieved 显式布尔 + 建议动作 + reason），
  与创作产物同调用产出——正常路径免判断②。
- 判断②按需：自评 goal_achieved=false 或产物偏离（确定性核对先行，D 系底座沿用）
  时独立调用判断②（观察 + 续行：收束｜继续｜停等作者）。
- 复合任务（先看阵容再设计等 agent_run_start 形态）：判断①仍可判 plan 走计划
  驱动——计划按需语义（ADR 决策 2）不因 CP2 改变，CP2 只翻单候选直接执行路径。
- 实施顺序（CP1 模式复刻）：前置探针 → CP2a 协议资产（自评 schema + 判断②请求机，
  不翻 flow）→ CP2b 逐 flow 翻转（design 先行证明形态，再复制三个）→ 场景批。

## 2d. CP2 前置探针结论（2026-07-17，execution-self-eval）

`scripts/model_contracts/execution_self_eval.exs` 四用例阵列（资料充分/前置缺失/
范围部分/设定冲突）双指标实测 live gpt-oss-120b：

- **v1 forced tool call 形态**：长创作内容后结构键名出轨（protocol 0.875）+
  forced tool call 无流式字节（执行段静默，违背主诉）——淘汰。
- **v2 生产同形态自由 JSON**（writer 现行协议 + self_report 扩展字段）：协议 0.75、
  自评方向 0.429→0.0（两版 prompt 均强偏"产出了内容=达成了目标"）——**内联自评
  在该模型上不可靠**（ADR §8 开放问题 1 的答案）。
- **CP2 裁决（走 ADR §5 预留回退）**：执行调用维持现行协议（自由 JSON 可流式，
  self_report 现有语义保留）；**判断②为独立短结构调用**（判断①两段式同底座，
  同模型 1.0 可靠区），由**确定性偏离信号**（D 系底座：产物缺失/风险 flags
  confirm·block/计划不匹配）按需触发；单候选正常路径产出即停 S1/S2（作者裁决，
  模型自评在此形态冗余）——**3 次调用经济学仍达成**（判断① 2 + 执行 1）。
  探针保留供未来更强模型重估内联方案。stub 自检双 1.0。

## 2e. CP2b 去伪计划落地（2026-07-18，用户"继续"批准）

四个单候选 flow（design / evolution / outline / world）执行骨架机械化：

- **付费伪计划消灭**：原每次执行花 2 次真实调用"起草"恒定两步计划（N-PLAN 违背
  形态）；改为机械构造（0 调用、suppress_plan_event——机械序列不是模型计划，不发
  plan_drafted；无计划 run 的作者可见轨道 = judgment 事件链）。机械判据成立：步序
  对相同输入恒定、不含创作判断。
- **单候选创作 5→3 次调用**（判断① 2 + writer 1）——ADR §5 经济学目标达成。
- 机械计划耗尽而产物未出 → 直接停等作者（无模型计划可修订，AgenticPlanDraftPlanner
  的 draft/revise 路径与 replan 机制从四 flow 移除；prose 双步系 CP3 保留）。
- 验收资产迁移：plan_drafted 等待删除 + `plan_drafted_event_count===0` 负例
  （伪计划消灭的机器证据）+ 计数钉 3 + eventTypes 迁 judgment_decided；world 机械
  步描述对齐 stub 样本文案；折叠卡 UI 下页面步骤文本断言（ui_context/world_step_
  visible）时机脆弱——移除，证据源改事件帧。
- **六场景真实 Tauri 绿**：bounded-roster-to-character-design / evolution /
  outline / world / world-style-rule + 后端 focused tests 迁移（无 plan_drafted
  负例 + 计数 3→1 runtime 直连口径）。
- **受影响场景回归全绿**：steer 语义迁移——机械 flow 无模型计划可修订，steer =
  goal 更新（版本 +1）+ plan_adjusted + 后续执行携带新方向，不再有 plan_revised
  promote、不消耗 replan（natural-language-steer / steer-replan 双绿）；
  interrupt/cancel 的"run 在轨"证据迁 judgment_decided（cancel×2 / interrupt /
  budget-limit 绿）。durable 环境竞态四连（ECONNREFUSED，非本改动）持续登记复验
  余项。全门禁：umbrella 8 app 0 fail + I1/I2/I3 + vitest 394 + 扫描 touched 零。

## 2f. CP3a 判断②上线（2026-07-18，用户"继续"批准）

**协议**：`JudgmentProtocol.request_continuation/3`——观察 + 续行两段式（call1 观察
叙事流式作者可见 + call2 forced `continuation_decision`{action continue|await_author
+ guidance + reason}，坏结构携带片段重试一次；判断①同底座同温度协议）。

**接线（prose_drafting_with_quality）**：两个模型修订点换判断②——
- deviation 信号（D 系确定性核对：质量 confirm/block、gate deny、缺章 gap、工具
  故障、预算）→ 判断②：continue 按 guidance 重试当前步 ｜ await_author 停等；
  修订调用产出的"新计划"只是同两步重排（纯伪修订），已消灭。
- 计划耗尽正文未出（D6 语义）→ 判断②：continue 机械补 prose 产出步（耗尽未产出
  时缺的必然是产出步——机械判据）｜ await。continue 消耗 replans 预算（runtime
  按 decision 修订事实自动计数，预算门兜底空转）。
- **prose 计划起草保留**：起草承载写作坐标解析（作者点名章的 target_chapter /
  authoring_intent——真实模型判断，非伪计划；CP0 hard-missing 机制依赖）。

**裁决语义（S 系权力结构对齐）**：quality confirm finding / gate deny / 缺章 gap /
工具故障 → 判断②观察后停等作者（confirm 的裁决权本来在作者）；判断② continue 的
改进闭环撞 max_pending_artifacts backstop（首稿已成候选，改进稿需"中间产物替代"
契约）——**登记 CP3b**：中间产物 supersede 语义 + 改进闭环 + prose_revision_from_
findings 机械化评估。

**runtime 增强**：awaiting_author 事件透传 decision.reason_codes（judgment_
continuation/agentic_deviation:* 进作者可见事件）。

**场景**：prose 正常路径绿（无 deviation 零判断②开销）；D6 双场景绿（判断②
continue 补步端到端 + continuation_decision native tool 遥测）；D 系 focused
tests 7/7 迁判断②语义（D1 故障→await、D2 质量→await、D4 gate→await、D7 缺章
→await、D6 耗尽→continue）。**no-progress 场景退役登记**：修订空转诱导在判断②
形态无对应物（空转保护由 replans 预算门承担，D 系单测实证）；后续按"判断②预算
兜底"重设计。SliceVerify/测试 continuation 桩样本落地。

## 2g. CP3b 中间产物 supersede 契约（2026-07-18，用户"继续"批准）

**契约**：判断② continue 改进闭环的"中间稿替代"语义——
- Domain：`AgentRun.supersede_pending_artifacts/2`（refs 移出待采纳集合）；
  `:artifact_superseded` 事件类型（novel_common 契约 + runtime stage 族 + copy
  "已替代"）。
- Runtime 两段式落地：步启动前快照局部替代（放行 pending 预算）；步结果收口时
  state 落地 + 作者可见事件（"上一稿已按质量意见改进，被新稿替代。"）。
- prose flow：判断② continue meta 声明 `supersede_artifact_refs`（续行重产出即
  替代本 run 中间稿）。
- 预算语义更新：plan_overhead 从"修订余量"改"判断②续行余量"（calls +1+4×replans、
  steps/tools +replans）；作者显式"最多一步"预算为硬约束不膨胀（one-step 指纹）。

**验证**：D2 focused 改进闭环端到端绿（confirm finding → 判断② continue →
supersede（预算放行+事件）→ 改进稿 → 复评通过 → completed，pending 只剩改进稿，
final TurnResult completed）；umbrella 全绿。**deviation 场景族四场景判断②口径**：
D1 工具故障 / D4 gate deny / D7 缺章 gap 三 await 场景真实 Tauri 绿（judgment_
continuation + replans 0 + 停等）；driver/verifier/fixtures 全迁 mode 分流形态。

**余批收口（2026-07-18 同日）**：guidance 传导落地——判断② continue 的修正指引
经 decision（evaluation_of_last.new_constraint）传导进续行步创作 brief（"续行修正
指引："段，模型指引到达写作调用）；credo 收参（frame 确定性重建）。**D2 improve
场景真实 Tauri 绿**（改进闭环端到端：finding → 判断② continue → guidance 进
brief → 中间稿替代（artifact_superseded 可见）→ 改进稿 → 复评通过 → completed，
最终 TurnResult 为改进稿单 pending）；driver 终局断言按 mode 分流。D 系全族回归
零回归（D1/D4/D7 await + prose 正常 + p1-revision 五场景绿）。
**尾批收口（2026-07-18 同日）**：prose_revision_from_findings 机械化落地——
恒定四步（读草稿与发现 → 修订策略与裁决 → 生成修订候选 → 汇总确认）机械构造，
起草 2 调用消灭，修订 run **3→1 调用**（仅修订 writer）；耗尽未产出停等作者
（作者显式修订动作，裁决语义）；focused + p1-prose-revision-candidate +
agent-revision-orchestrator-boundary 双场景真实 Tauri 绿（plan_drafted 负例 +
计数钉 1 + 步可见字段迁事件级证据）。**交互链路的付费伪计划至此全部消灭**
（AgenticPlanDraftPlanner 交互消费者清零，仅剩 conversation_turn 遗存——CP2
退役评估名单）。CP3 全收口。
**下批余项**：no-progress 判断②预算兜底重设计（小件）；durable 环境复验。

## 2h. CP4 六问（开工登记，2026-07-18，用户"继续"）

1. **Contract**：ADR-0025 决策 2（计划按需：模型判复杂才制定、能力目录为可选目标
   集、AgentPlan 结构沿用、活文档可修订）；N-PLAN 新文本（存在计划时必须模型制定
   维护，app 不得预制轨道）；plan_drafted/plan_revised 照发（真计划值得展示）。
2. **Invariant**：判断① plan ≠ execute——plan 产生模型自产 AgentPlan（每步 target
   为能力目录成员）；每步执行仍逐一过 Orchestrator gate；多产物停 S1/S2 作者采纳；
   计划步序来自模型（app 仅机械 cursor 推进）；I1/I2/I3 原样。
3. **Boundary**：novel_application（judgment_plan flow + AgenticPlanDraftPlanner
   能力目录分支 + dispatch plan 接线）；novel_agent（profile 注册 + 桩样本）；
   不改 novel_domain AgentPlan 结构、novel_web 透传、S1-S7。
4. **Consumer**：workspace_channel 既有入口；前端文档流（plan_drafted 步骤/进度
   恢复显示——真计划有信息量，46§9.5 删的是恒定伪计划）。
5. **Proof**：focused runtime tests（判 plan → 起草 → 逐步 → 多产物）+ 真实 Tauri
   新场景（复合创作请求端到端）+ I1/I2/I3；MBC multi_step 判断力已由 CP1 探针验证。
6. **Acceptance Driver**：新场景 `judgment-plan-multi-step`（外部驱动真实页面：
   复合请求 → 真计划步骤可见 → 逐步产出 → 多产物停采纳）。

**CP4 分步**：CP4a 最小链（判 plan → 能力目录起草 → 通用步执行 → 完成/停等；
deviation 判断②先 await）→ CP4b 真计划修订（判断② continue 修订活文档，D 系
以真计划形态复活）+ UI 深化。

## 2i. CP4a 落地（2026-07-18，判断①自产真计划最小链）

- **judgment_plan_v1 profile**：跨能力真计划——判断① plan ≠ execute（dispatch 分
  流），判"复杂"进 judgment_plan flow：计划由模型基于能力目录制定
  （AgenticPlanDraftPlanner + judgment_plan 目录：context/roster/design/evolution/
  outline/world/prose 七目标集），plan_drafted 照发（真计划值得展示）；app 只做
  机械 cursor 推进 + 每步 Orchestrator 门禁；多产物逐个进待采纳区。
- **接线全链**：dispatch plan 分支 / profile 注册 / 起草目录 / run_spec 族
  （spec/预算 steps6·tools5·calls12·pending3/恢复映射/routable+lookup 交棒名单）；
  桩多能力样本 + 多阶段判 plan 规则（命中 ≥2 创作能力域，与生产判别规则同语义）。
- **focused**：判 plan → 真计划三步（context/outline/prose）→ 双产物 → completed
  （起草 2 + 两 act 步各 1 = 4 calls，runtime 直连）。
- **场景 `judgment-plan-multi-step` 真实 Tauri 绿**（harness 白名单注册）：复合
  请求 → judgment_decided(plan) → 模型自产 ≥3 步跨 ≥2 能力计划 → 逐步过门禁 →
  ≥2 待采纳产物 → 完成。代表性回归批绿（design/prose/outline/D2-improve；
  conversation-turn 一次持久化事实计数 flake 复跑即绿，登记观察）。
- **CP4b 收口（2026-07-18 同日）**：真计划修订落地——计划走完而目标未达时由模型
  修订自己的计划（AgenticPlanDraftPlanner.revise 真修订：真计划的活文档语义，
  plan_revised 照发、replans 计数、修订预算耗尽停等作者）；focused 闭环绿（短计划
  → 模型修订补产出步 → 完成，replans 1）。**UI 真计划步骤已天然恢复显示**
  （plan_drafted 渲染链一直在，真事件回来即显示——场景实证
  plan_steps_visible_in_ui=true）。judgment-plan 场景回归绿。**CP4 全量收口**。
  余项：explore 步接入（CP5 联动）。

## 2j. CP1-CP4 实现系统性回顾（2026-07-18，用户指令；四类问题框架）

**触发**：CP5 方案被指出"用途预制 + 无视现有能力"两个根源问题，回顾前 CP 是否同病。
分类：A 用途预制（app 替模型预想用法）/ B 平行重复建设（不盘点现状）/
C 枚举维度错位（用途面 vs 数据面）/ D 桩预言固化（桩替产品定语义）。

**B 类实锤（帧纪元死代码未退役，最重）**：
- B-1 `DialogueGateway.handle_input` → `Planner.form_frame` 整条帧管线生产零调用
  者（判断纪元主链不经它；保活者仅 novel_e2e v3_full_chain + 3 个直连测试）。
  Planner 的 form_frame/form_micro_plan/build_candidates 族为死区（活的仅
  provider_failure_fallback_message 与 fallback_candidates）。
- B-2 `AgenticNextStepPlanner.next_decision` 族（ADR-0023 逐步选步模式）生产零
  消费（仅自身单测）；各 flow 只用其 with_provider_call_meta 管道 helper——死活
  混居一个模块。
- 处置：合并为**帧纪元退役清单**（用户批准）。**第一批已收口（2026-07-19，净删
  4176 行）**：e2e v3_full_chain 10 测按覆盖对照删除（10/10 均有判断纪元场景对应：
  gate→D4、确认→au04、tentative→单候选族、三个失败恢复→S7 场景族）；直连测试
  （creative_exploration_loop / planner_real_llm / grounding 的死路径段）删；
  runtime 7 个 conversation 载体测试删（provider facts 投影已由场景覆盖）；
  next_step_planner_test 整删；conversation_turn flow（1121 行）+ service 全分支
  + registry profile + 起草目录三分支 + Stub/SliceVerify conversation packets 删；
  AgenticNextStepPlanner 瘦身为 meta 挂载工具（next_decision 族删，moduledoc 记
  退役因由）；plan_draft 目录校验测试换 prose 载体（活机制保留）。
  **第二批余项**：DialogueGateway handle_input 帧管线（~200 行入口+私有帧函数，
  与活函数 persist_turn_side_effects 交织——本批一次激进清扫误删活函数后回滚，
  留精细手术）；Planner form_frame/form_micro_plan 族（与 fallback 函数交织同理）。
  教训重申：批量正则清扫禁令适用于生产文件（批三 fixture 教训的生产版）。
- B-3 判断②新建协议**维持**（补论证）：next_decision 是"步目录选步"（被机械
  cursor 取代的模式），判断②是"偏离观察+续行裁决"——非同一物；evaluation_of_last
  结构已复用。过程瑕疵：当时未做此盘点即新建。

**A 类（重新定性）**：
- A-1 prose 机械补步（判断② continue 的 :append_prose）**合法维持**：机械计划
  语境下续行动作唯一（补产出步，无自由度=机械），模型判方向（判断）——与 CP4b
  真计划修订（步序有自由度→模型修订）是同一原则在不同自由度下的正确分层。
- A-2 机械步 description 文案（作者可见状态行）属结构词家族，合法；记文档债：
  47 文案指南补"机械步状态行属结构词"注记。

**C 类**：未见实质违规（capability→profile 映射、judgment_plan 起草目录均为
能力面枚举；判断① prompt 判别规则是给模型的指引，模型可判任意 action）。

**D 类实锤**：
- D-1 **判断②零 MBC 探针 → 已补课（同日）**：`continuation_judgment.exs` 四用例
  （质量可修正→continue / 计划耗尽缺产出步→continue / 工具连续故障→await /
  前提缺失→await），消费生产构造器。**探针立刻抓到真问题**：live gpt-oss-120b
  首跑方向 0.5（耗尽误判停、故障误判续）——判断② prompt 补判别规则（四条边界，
  与判断①同打法）后 live 双 1.0。桩预言与产品 prompt 现在有共同真源。
  lib Stub 补判断族分发（判断②先于判断①判别；圈复杂度收敛提炼）。
- D-2 D2 improve/await 语义演进复盘：初版 await 由实现约束触发但最终语义产品
  驱动（S 系裁决权→supersede 后改进闭环），无需处置。

**根因自省**：CP2 探针 v1（先设计后盘点生产 writer 形态）与 CP5 方案同病——
"先设计后盘点"顺序病。纠正律：新协议/新能力先做现状盘点（消费者、既有 API、
同语义机制）再设计，盘点结论进六问 Boundary 项。

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
- 2026-07-17 **CP1 场景校准批三收口**：au01/au02 家族九场景判断口径真实 Tauri 绿
  （au01 ordinary / empty-guard / recorder；au02 continuation / natural-exploration /
  multiturn-context / freeform-followup / unadopted / adoption-bridge / fallback-ui）。
  键事件链迁判断纪元（start → context.assemble.done → judgment.decided.done → done）；
  fixtures 按函数域逐块迁移（教训：全局正则清扫曾污染无关 fixture，git 重置后改
  锚定替换）。**两个真实产品观测缺口修复**：① 判断循环两步 Task 进程各自缺
  LogContext.put_turn/put_step，llm-log 无法按 turn 关联（修：context 步 put_turn、
  判断步 put_turn+put_step("judgment")）；② 判断纪元缺业务 JSONL——补
  `judgment.decided.done`（action/capability/frame_type/candidate_count，对齐旧
  planner.form_frame.done 观测口径，外部验收按此归组）。**兜底候选语义系统性移植
  （fallback-ui 修复）**：协议新增 `candidate_directions_present` 原始信号（坏结构
  不丢探索意图）；`Planner.fallback_candidates/1` 公开为两路径共享兜底集（矛盾切入/
  人物切入）；judgment_candidates 有效性过滤（title/pitch 非空）+ 判探索而有效候选
  空 → 兜底降级；judgment.decided.done 迁分发分支、记解析与兜底后最终口径。协议
  单测新增（judgment_protocol_test 3 例锚定意图信号）；credo nesting 修
  （author_input_patterns 列表化消三层 case）。全门禁绿：umbrella 全套 + I1/I2/I3 +
  前端 typecheck/lint/394 tests + xref cycles + arch_check + 静态扫描 touched 清零。
  **CP1 累计 19 场景判断口径绿。批四待办**：garbage-json-recovery /
  frame-validation-friendly-error 语义重定义（帧 JSON 恢复路径已不存在 → call2 重试
  → S7）、D6 基两场景 + no-progress 再诱导、error-author-safe 语义再迁、
  world-style-rule / readonly-batch / cancel·steer·durable 家族 run-and-see、
  conversation flow 退役评估（CP2 前置）。
- 2026-07-17 **CP1 场景校准批四收口（迁移账②⑤⑥⑦清账）**：
  ① **garbage-json-recovery / frame-validation-friendly-error 语义重定义绿**：帧 JSON
  恢复路径已不存在，新语义 = 判断 call2 坏结构（垃圾 payload / 非法 action 两种坏
  法）→ 协议携带片段重试一次 → 仍坏 → S7 安全失败终局 → 恢复轮正常判断。错误分类
  学接入：`{:judgment_decision_unparseable, _}` 归 :json_parse_failed（与帧纪元
  :frame_contract_invalid 同格），作者文案"格式不符合契约，请重试"；anti-leak 断言
  保留（内部原因词不进页面/TurnResult）。
  ② **error-author-safe 语义再迁绿**：对话回应调用 = 判断 call1，其失败走 S7 诚实
  失败终局（run failed + 安全 TurnResult + ProviderRun 失败事实持久化 + 消费预算不
  记失败调用），不再被帧吸收为 completed。
  ③ **D6 基两场景迁 prose 基座绿**（plan-replan-reasoning / native-tool-calling-
  protocol）：诱导迁 prose 创作 profile（对话 chat 判 reply 终结，计划-修订路径只在
  创作 profile 内可达）——短计划漏正文步 → plan_revised 补足 → 正文候选；native
  tool 遥测（draft+revision）不泄漏参数。共用基座 driveAgentD6ProseReplan；父 turn
  （:agent: 后缀剥离）修正 activity/键定位。
  ④ **no-progress 迁 prose 空转基座**：修订空转判停成立（steps 4 / calls 6 /
  replans 1）。**产品观测缺口登记**：prose 步链不产 progress_signature，no_progress
  提前判停对 prose profile 不生效；空转保护当前由 replan 预算 + 计划耗尽兜底
  （agent_loop_awaiting_author）承担，不无限空转。signature 补全为后续小项。
  ⑤ **run-and-see 家族校准**：cancel-honest-boundary / cancel-target-binding /
  interrupt-safe-point 摸底即绿；steer 绿（链路 plan_adjusted→plan_revised 全通，
  终态文案对齐"这次创作请求已完成"）；readonly-batch 绿（执行段 provider-free 口
  径：判断 2 + 计划 2 = 4 调用，批量只读执行段零调用）；budget-limit 绿、
  no-progress 绿（计数迁执行段口径：判断入场 2 步 + 执行段 N 步；"最多一步"语义按
  执行段保留）；durable 同口径校准完成（checkpoint 3 步来自实测帧）但 harness 端口
  竞态三次误伤未过验，登记复验余项。
  ⑥ **conversation flow 退役评估（迁移账⑦，CP2 前置）**：遗存 =
  agent_run_flows/conversation_turn.ex + agentic_{plan_draft,next_step}_planner 的
  conversation_turn_v1 分支 + profile 注册 + stub packets + runtime 直连测试；
  user_message 链路无入口可达。建议 CP2 删除（直连测试先换 fixture profile）。
  **剩余长尾（不阻塞主线，后续 run-and-see）**：durable 复验（harness 端口竞态）、
  agentic-loop-budget-deviation-replan（D5 对话基座需迁 prose）、au03+ 家族。
  **CP1 累计 28 场景判断口径绿；批四后回主线 CP2。**
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
