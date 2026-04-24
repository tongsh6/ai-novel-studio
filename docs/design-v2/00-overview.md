# 小说创作 Agent 设计总纲 v2

> 状态：草案
>
> 目标：重新定义“写小说的 agent”的完整设计边界。本文优先回答一个更基础的问题：我们首先在做一个 agent，然后才是在做一个写小说的 agent。
>
> 关系：`docs/00-*` 到 `docs/16-*` 保留为 v1 历史验证资料。v2 不直接推翻 v1，而是把 v1 已验证的 Router / Executor / Orchestrator / Clarification / AgentTurnResult 抽象为通用 Agent 基础层，再在其上设计小说创作领域层。

---

## 1. 核心定位

本项目的最终目标不是“一个会聊天的小说生成器”，而是：

**一个以对话为主入口、以结构化状态为隐性内核、支持长篇连载创作全生命周期的小说创作 Agent 工作台。**

它面向的主要场景是：

- 网文作者
- 长期连载
- 日更或高频产出
- Co-author 与 Ghost writer 混合模式
- 百万字级连续性维护

因此系统必须同时满足三类要求：

1. Agent 要完整：能识别意图、规划任务、调用能力、维护状态、处理中断、解释行为、记录审计、管理预算。
2. 小说要专业：能覆盖立项、世界观、主线、分卷、章节、场景、正文、改稿、阅读、连续性维护。
3. 使用要轻：工作台主页面默认是对话和结果卡片，结构面板隐藏在背后，作者不被表单和后台系统压垮。

---

## 2. 设计原则

### 2.1 先 Agent，后小说

小说能力建立在通用 Agent 基础能力之上。

通用 Agent 层必须业务无关：今天可用于小说，未来也可用于剧本、论文、游戏剧情、知识库写作。

小说领域层只能依赖通用 Agent 层，不能反向污染通用层。

### 2.2 对话优先，结构兜底

用户主入口是自然语言对话。

但系统内部必须维护结构化对象、状态机、日志、任务、预算、hook 和审计记录。

纯聊天无法支撑长篇连载；纯结构表单又会让创作体验变重。v2 采用“对话驱动 + 结构化内核自动维护”的双层形态。

### 2.3 结构面板默认隐藏

结构面板是能力，不是负担。

默认工作台只呈现：

- 对话流
- 结果卡片
- 当前作品 / 卷 / 章上下文
- 必要的确认、采纳、警示和进度卡

世界观、人物、伏笔、时间线、卷树、章节树等结构面板只有在作者主动打开时才出现。

### 2.4 面向最终形态设计，分阶段实现

设计不因 V1 实现阶段而刻意缩水。

实现可以分期，但总架构要直接面向最终目标：

- 长篇
- 长跑
- 时序状态
- 多层记忆
- 可回放
- 可观测
- 可治理
- 可扩展

### 2.5 长跑透明

系统可以支持连续写作任务，但不能黑箱运行。

长跑任务必须在启动前和运行中持续暴露：

- 预计 token
- 预计时间
- 预计费用
- 预计章节 / 场景数量
- 当前消耗
- 当前风险
- checkpoint 原因
- tentative 产物列表

### 2.6 加法优先，协议版本化

系统演化默认采用加法：

- 加字段
- 加 intent
- 加对象
- 加 hook
- 加 contract

修改既有语义必须走 deprecation、迁移、双读或版本升级流程。

---

## 3. 总体分层

v2 架构分两层：

```text
Layer 2: Novel Domain Layer
  小说生命周期、世界观、主线、分卷、章节、场景、正文、人物、伏笔、风格、阅读模式

Layer 1: Agent Foundation Layer
  交互协议、状态机、意图、能力、记忆、规划、Provider、观测、安全、治理、UX、多 Agent
```

依赖方向固定：

```text
Novel Domain Layer -> Agent Foundation Layer
Agent Foundation Layer -/-> Novel Domain Layer
```

即：

- 通用 Agent 层不知道什么是章节、伏笔、人物、卷。
- 小说层可以注册自己的 intent、object schema、post-hook、validator、context policy。
- 通用层只处理“这是一个 Agent task / turn / capability / memory / checkpoint / budget / result”。

---

## 4. Layer 1：Agent Foundation Layer

Layer 1 定义一个完整 Agent 应具备的基础形态。它是 v2 的第一优先级。

### 4.1 子系统 1：交互契约

目标：让所有入口和消费方共享同一种交互语义。

硬骨：

- `AgentTurnResult` 是唯一 canonical turn result。
- Orchestrator 输入形状固定。
- HTTP / CLI / batch / future meta-agent 都必须走同一输入语义。
- 前端主消息只消费 `assistant_message.content`。
- 调试信息只能从 `route_result`、`execution_result`、`validation`、`trace` 读取，不能成为前端主渲染来源。
- 所有 id 使用固定前缀 + 稳定唯一 id。
- 结构化对象读 API 可以存在；结构化对象写入默认必须走 intent / capability，不允许 UI 直接绕过 Agent 写生产状态。

v1 继承：

- `docs/design-v1/11-agent-turn-result-schema.md`
- `docs/design-v1/13-orchestrator-runtime-spec.md`

v2 待补：

- schema version
- idempotency key
- streaming event 形状
- structured card 标准协议

### 4.2 子系统 2：回合与任务状态

目标：区分一次对话回合、一个长跑任务、一个澄清请求、一个待采纳产物的状态。

硬骨：

- Turn phase 状态机
- Clarification 状态机
- Long-run task 状态机
- Tentative artifact 状态机
- phase 与 status 的映射表
- 终态不可逆规则

基础状态机：

```text
Turn:
RECEIVED -> ROUTED -> READY_TO_EXECUTE -> EXECUTING -> COMPLETED
                    -> NEEDS_CLARIFICATION
                    -> FAILED

Clarification:
OPEN -> RESOLVED
     -> SUPERSEDED
     -> ABANDONED
     -> EXPIRED

Long-run task:
PLANNED -> CONFIRMED -> RUNNING -> CHECKPOINT -> RESUMING -> RUNNING
                                -> COMPLETED
                                -> CANCELLED
                                -> FAILED

Tentative artifact:
TENTATIVE -> ACCEPTED
          -> EDITED_ACCEPTED
          -> DISCARDED
          -> SUPERSEDED
          -> INVALIDATED
          -> ARCHIVED
```

### 4.3 子系统 3：意图与对话行为

目标：Agent 不只是“路由 + 执行”，还要完整处理真实对话行为。

硬骨：

- Slot Policy
- Clarification
- Confirmation
- Rejection
- Cancellation
- Correction

注：Intent Registry 本身归子系统 4「能力与 Executor 层」集中管理。本节只负责定义真实对话行为语义。

行为边界：

- Clarification：信息不足，需要追问。
- Confirmation：信息足够，但动作高风险或成本高，需要二次确认。
- Rejection：请求不应执行，Agent 明确拒绝并解释。
- Cancellation：用户中断当前 turn 或 long-run task。
- Correction：用户推翻上一轮的识别、参数、结果或状态写入。

v1 已有：

- Router intent
- missing fields
- Slot Policy 四级
- Clarification state

v2 待补：

- 高风险 confirmation policy
- cancellation protocol
- correction protocol
- rejection template

### 4.4 子系统 4：能力与 Executor 层

目标：把 Agent 可调用能力注册为明确的 capability，而不是散落在 prompt 或函数里。同时把 intent 集中注册，避免在 prompt 或业务层重复声明。

硬骨：

- Intent Registry
- Capability Registry
- Intent ↔ Capability 映射
- Executor 输入契约
- Executor 输出契约
- Executor Validator
- capability 权限与预算声明
- capability 是否支持 streaming / cancellation / retry 的声明
- capability 是否产生 tentative artifact 的声明

Executor 不判断用户意图。Router 不创作。Validator 不创作。

建议 Executor 输出基础形状：

```json
{
  "handled": true,
  "status": "COMPLETED",
  "artifacts": [],
  "action_result": {},
  "metadata": {},
  "usage": {}
}
```

### 4.5 子系统 5：记忆体系

目标：让 Agent 具备可分层、可回放、可查询、可演化的记忆。

通用 Agent 至少需要四类记忆：

1. 情景记忆：interaction log、trace、用户与 Agent 的历史回合。
2. 语义记忆：结构化对象库，业务层注册对象类型。
3. 程序记忆：Agent 知道自己有哪些 intent、capability、policy、hook。
4. 元记忆：用户偏好、项目偏好、长期行为偏好，不能混入单个业务对象。

硬骨：

- interaction log 是一等对象。
- capability / intent / hook registry 可被 Agent 查询。
- 结构化对象读写必须有统一入口。
- replay 与 time-travel 要从设计上保留位置。
- 业务对象属于 Layer 2，记忆机制属于 Layer 1。

### 4.6 子系统 6：规划与编排

目标：支持从单轮交互到长跑任务的统一编排。

硬骨：

- Orchestrator 是单轮 turn 的唯一编排入口。
- LongRunner 是多步任务编排器，但不能绕过 Orchestrator / Store contract。
- plan 是结构化对象，不是 prompt 里的自然语言段落。
- checkpoint 是一等状态，不是错误。
- tentative 入库是长跑的默认安全策略。
- 用户可以在 checkpoint 修改 brief、编辑已产出内容、续跑、分支或取消。

通用 checkpoint 触发条件：

- 单元完成
- 预算命中
- clarification 触发
- confirmation 触发
- validator 失败
- 一致性冲突
- 用户主动暂停
- provider / tool error 达到重试上限

### 4.7 子系统 7：一致性与并发

目标：让 Agent 在长期、多回合、多任务并行写入中保持结构化对象的可信状态。

硬骨：

- revision / version stamp：结构化对象的每次写入必须携带版本戳。
- 乐观锁或 lease：读-改-写链路必须具备冲突检测。
- rebase / invalidation 策略：当底层对象在长跑期间被人工或 hook 修改，长跑产物必须重新基于最新版合并，而不是静默覆盖。
- 冲突处置语义：conflict 默认走 checkpoint + clarification，而不是在后台强写。
- tentative 与 accepted 的一致性规则：tentative 的 base revision 要明确记录。

一致性不能依赖 prompt 自觉，也不能依赖事后审核；它必须在对象写入 contract 里强约束。

此子系统与子系统 5（记忆体系）和子系统 6（规划与编排）互补：
记忆负责“写过什么”，规划负责“要写什么”，一致性负责“写入是否可以安全落地”。

### 4.8 子系统 8：Provider 抽象

目标：业务逻辑不绑定任何单一模型供应商。

硬骨：

- 所有模型调用走统一 `LLMClient` 或 `ModelProvider`。
- Prompt template 与 provider SDK 解耦。
- usage 必须标准化：prompt tokens、completion tokens、cost、latency、model、provider。
- provider error 必须标准化。
- 支持本地 stub / 本地模型 / 云模型的切换。

基础接口方向：

```text
complete(messages, params) -> ModelResult
stream(messages, params) -> ModelEvent*
```

### 4.9 子系统 9：观测性

目标：Agent 的每次行为都能解释、诊断、统计和回放。

硬骨：

- Trace：每次 interaction 的完整链路。
- Metrics：intent 频率、clarification 率、confirmation 率、失败率、重试率、hook 采纳率、长跑中断率。
- Structured logs：比 interaction log 更底层，记录 provider call、validator result、tool call、latency。
- Replay：用 interaction id 复刻一次 turn。
- Explainability：能解释为什么路由到某个 intent、为什么推断某个 slot、为什么触发 checkpoint。

观测性不能依赖前端截图或自然语言日志。

### 4.10 子系统 10：安全、权限与预算

目标：让 Agent 不因自动化能力而失控。

硬骨：

- Prompt injection 边界。
- 高风险动作 confirmation。
- 单 turn 预算。
- 单 long-run task 预算。
- 项目级 / 日级 / 月级预算。
- capability 权限声明。
- 审计日志。
- cancel / rollback / discard 的用户入口。

预算不只包括费用，也包括：

- token
- wall time
- 并发资源
- 写入对象数量
- 产物规模

### 4.11 子系统 11：UX 基础语义

目标：让 Agent 输出在界面上有稳定形态，而不是每个 intent 临时拼 UI。

硬骨：

- render mode
- structured card
- progress card
- warning card
- confirmation card
- tentative artifact card
- adoption card
- streaming event
- interruption event

UI 基础语义属于 Layer 1；小说卡片的具体字段属于 Layer 2。

主工作台默认只显示对话流与卡片流。结构面板必须是可主动打开的辅助视图。

### 4.12 子系统 12：多 Agent 组合

目标：为未来 Reviewer、Planner、LongRunner、ContinuityChecker、StyleCoach 等角色保留可组合口子。

硬骨：

- Agent identity。
- Agent 间消息协议。
- 父子 Agent 预算继承。
- 权限隔离。
- 子 Agent 不得绕过父级 Orchestrator 写生产状态。
- 子 Agent 输出必须可嵌入或转换为 canonical result / artifact。

V1 可以不实现完整多 Agent，但 Layer 1 contract 不能堵死这条路。

---

## 5. Layer 2：Novel Domain Layer

Layer 2 是小说业务特化层。它使用 Layer 1 的 Agent 能力，注册小说领域对象、intent、validator、context policy 和 post-hook。

### 5.1 模块 1：小说生命周期对象

从大到小：

```text
work
  -> worldbuilding
  -> main_outline
  -> volume / arc
  -> chapter
  -> scene
  -> draft
```

跨层对象：

- character
- faction
- location
- relationship
- item
- ability
- organization

设计原则：

- 跨层引用走 id，不做深层内嵌。
- 生命周期对象描述“这本书有哪些层级”。
- 时序对象描述“这些层级在某个时间点发生了什么变化”。

### 5.2 模块 2：时序连续性对象

长篇连载的核心不只是“记得文本”，而是“记得状态变化”。

基础对象：

- `state_snapshot`
- `timeline_event`
- `foreshadowing`
- `worldrule`
- `chapter_summary`

锚点机制：

```text
anchor_type + anchor_id
```

起步支持：

- volume
- chapter
- scene

不能把时序对象写死为只锚定 chapter，否则后续会阻碍场景级、卷级、跨章结构。

### 5.3 模块 3：风格与作者意志

风格不是 prompt 附件，而是作品级长期资产。

基础对象：

- `style_sample`
- `writing_preferences`
- `brief`

其中：

- `style_sample`：作者自己的文本或参考文本，供 Agent 提炼语感。
- `writing_preferences`：节奏偏好、禁忌、雷点、套路偏好、金手指节奏、口癖、章节尾钩偏好。
- `brief`：章级、场景级或长跑任务级临时意图。

在线反馈属于长期补丁，不应替代初始风格设定。

### 5.4 模块 4：小说 intent 族

小说层注册自己的 intent。初始族群：

- 立项族
- 世界观族
- 主线族
- 分卷族
- 章节族
- 场景族
- 正文族
- 改稿族
- 人物族
- 风格族
- 长跑族
- 阅读族
- 维护族

代表性 intent：

- `CREATE_WORK_SEED`
- `DEFINE_WORLDBUILDING`
- `REFINE_WORLDRULE`
- `CREATE_MAIN_OUTLINE`
- `REVISE_MAIN_OUTLINE`
- `SPLIT_INTO_VOLUMES`
- `CREATE_VOLUME`
- `GENERATE_VOLUME_OUTLINE`
- `GENERATE_CHAPTER_OUTLINE`
- `SET_CHAPTER_BRIEF`
- `GENERATE_SCENE_OUTLINE`
- `DRAFT_SCENE`
- `REVISE_SCENE`
- `DRAFT_CHAPTER`
- `REVISE_DRAFT`
- `CREATE_CHARACTER_CANDIDATES`
- `REFINE_EXISTING_CHARACTER`
- `LOAD_STYLE_SAMPLE`
- `SET_WRITING_PREFERENCE`
- `CONTINUE_DRAFTING`
- `RUN_UNTIL_CHECKPOINT`
- `ENTER_READ_MODE`
- `SUMMARIZE_CHAPTER`
- `UPDATE_STATE_SNAPSHOT`
- `SCAN_NEW_FORESHADOWING`
- `SCAN_FORESHADOWING_RESOLUTION`

### 5.5 模块 5：维护 post-hook

维护工作不应要求用户显式记得触发。

策略：

```text
写完章 / 写完场景 / 改完稿
  -> 自动草拟摘要、状态变动、伏笔变动、时间线事件
  -> 以待采纳卡片展示
  -> 用户一键采纳、编辑采纳或丢弃
```

默认 hook：

- `hook.SUMMARIZE_CHAPTER`
- `hook.UPDATE_STATE_SNAPSHOT`
- `hook.SCAN_NEW_FORESHADOWING`
- `hook.SCAN_FORESHADOWING_RESOLUTION`

关键边界：

- hook 可以自动运行。
- hook 不直接写生产状态。
- hook 产物默认是 pending adoption。

### 5.6 模块 6：上下文组装策略

Router / Executor / LongRunner / Reader 各自消费的上下文形状不一样，但都必须从同一批结构化对象 + 片段检索中装配。

基础策略：

- 组装输入：作品 brief、writing_preferences、style_sample、当前卷/章/场景对象、最近 N 章摘要、相关 state snapshot、相关 foreshadowing、worldrule、timeline 事件。
- 组装顺序：长期偏好 -> 当前单元 brief -> 结构化骨架 -> 检索文本细节 -> 临时反馈补丁。
- 长跑专用：上下文装配在每次 checkpoint / resume 时重新组装，不依赖 prompt 残留。
- 阅读模式：Reader 只读 accepted 源，不能看到 tentative、在线反馈、未采纳 hook 产物。

小说长跑的实现走 Layer 1 子系统 6（规划与编排）+ 子系统 7（一致性与并发），这里只定义小说特有的上下文策略，不重复长跑通用机制。

### 5.7 模块 7：阅读模式

阅读模式是闭环，不是附属功能。

目标：

- 将已采纳正文投影为纯净阅读视图。
- 支持目录、卷、章导航。
- 支持从阅读态回到创作态。
- 默认不展示结构面板和调试信息。

阅读模式不应消费 tentative artifact，除非用户显式选择预览。

### 5.8 模块 8：创作生命周期

小说创作生命周期是 Domain 层的主时序线，决定 Agent 在不同阶段的默认行为、默认推荐、默认可执行 intent 集合。

四个主阶段：

- 建立期：立项、世界观、主线、卷/章骨架成型，以引导式对话为主。
- 推进期：章节 / 场景逐步产出，以 brief + hook 维护状态。
- 连载期：高频产出，长跑常驻，连续性维护密集。
- 修订期：以 REVISE_DRAFT / 改稿族 intent 为主，adoption 边界更严格。

跨阶段原则：

- 阶段切换是渐变而非硬切。
- 每个阶段影响默认卡片推荐、默认 hook 组合、默认长跑允许范围。
- 结构面板作为 UI 层投影，不在 Domain 层独立建模；结构面板的设计规范在 Layer 3 UI 文档（`43-structure-panel.md`）中定义。

---

## 6. v2 对 v1 的继承关系

v1 已验证或已形成雏形的内容：

- Router / Executor / Validator 分工
- Orchestrator 单轮编排
- Slot Policy
- Clarification state
- AgentTurnResult
- Interaction log
- SQLite 本地优先
- 最小 intent 集
- 前端工作台雏形

v2 对这些内容的处理：

- 保留其作为 Layer 1 的基础。
- 不把 v1 的小说对象当作最终约束。
- 不把 v1 的最小 scope 当作最终目标。
- 将 v1 文档标记为历史验证资料，而不是 v2 的唯一标准。

---

## 7. 关键设计决策索引

本节记录当前讨论中已经收敛的决策。后续应拆为正式 ADR。

### D2-001 目标用户是网文长篇连载作者

系统优先服务高频、长篇、类型化、连续性强的创作场景。

### D2-002 人机分工采用 Co-author + Ghost writer 混合

Agent 可以独立生成场景或章节，但用户保留方向控制、采纳、编辑和中断权。

### D2-003 体量目标是长期连载

百万字级连续性是架构前提，不是未来附加项。

### D2-004 记忆内核采用结构化对象库 + 片段检索混合

骨架信息结构化维护，文本细节通过章节片段检索辅助。

### D2-005 创作粒度采用全生命周期设计，默认场景级可控生成

章级是常用单元，场景级是默认可控单元，beat 级作为可选精修层。

### D2-006 风格注入采用设定文档 + 样本 + brief，在线反馈作为补充

不能依赖慢速在线学习来建立作者风格。

### D2-007 长期连续性系统性建模

需要 state snapshot、timeline event、foreshadowing、worldrule、chapter summary。

### D2-008 维护 intent 采用混合提议

写完后自动草拟维护结果，但以待采纳卡片交给用户确认。

### D2-009 长跑支持中途编辑与自动吸收

用户可以回头编辑已产出章节或 brief，后续续跑必须吸收变更。

### D2-010 长跑资源消耗启动前预估且过程中实时展示

风险、时长、token、费用必须透明。

### D2-011 V1 单作品单 long-run task，最终形态可多任务但默认关闭并发

避免早期引入状态竞争写入。

### D2-012 章以上层级采用引导式对话 + 隐藏结构面板

建立期通过对话引导成型，成型后结构面板可主动打开查看和编辑。

### D2-013 第一优先级是 Agent 基础完整形态

先定义通用 Agent 硬骨，再定义小说领域硬骨。

### D2-014 小说质量门禁必须领域化

设定冲突、人物逻辑、节奏、爽点、hook、战力膨胀、网文留存等质量判断属于 Novel Domain，不应写进 Foundation。

### D2-015 高风险 canon 变化必须保留作者确认

作品定位、主角/反派重大设定、卷纲定稿、关键章节细纲、重大人物命运、大高潮和结局方向默认需要 confirmation 或 adoption。

### D2-016 经验沉淀不能直接污染长期偏好

作者修改、采纳、否决和质量门结果应先成为 experience artifact，经 review / adoption 后再形成可复用 experience rule。

### D2-017 小说要素清单不是一次性表单

项目、人物、世界观、章节、伏笔、网文运营等要素应按必须结构化、半结构化和文档层分级落位，避免把全部清单直接变成巨型 schema。

### D2-018 TurnResult v2 顶层 schema 由 ADR-0001 冻结

TurnResult v2 顶层 schema 已通过 ADR-0001（`adr/0001-turn-result-v2-schema.md`）冻结为 14 必填 + 5 可选字段、5 条 canonical 路径、7 条跨字段约束。adoption 7 态由 ADR-0001 与 `30-contract-glossary.md` §3.2 共同作为唯一 canonical 权威；turn / task / artifact 状态枚举、phase / status / next_action 完整集合与兼容表已由 ADR-0002（`adr/0002-state-enums.md`）冻结。schema 根目录约定为 `docs/design-v2/schemas/`，所有 `$id` / `$ref` 相对此根解析。Domain 注入的扩展属性必须使用 `domain_ext.` 前缀，由契约测试 lint。

### D2-019 Authority / Budget / Escalation 最小枚举由 ADR-0003 冻结

Authority / budget / escalation 的最小枚举已通过 ADR-0003（`adr/0003-authority-budget-escalation.md`）冻结。`authority_scope` 必须保持结构化，至少包含 `capability_scope`、`write_scope`、`task_control_scope`、`budget_override_scope`；budget 至少覆盖 scope / dimension / threshold / guard decision；escalation 至少覆盖 type / reason / status / resolution。`write_scope` 继续使用 `read_only`、`propose_only`、`tentative_write`、`production_write`；重复失败默认归入 retry/checkpoint/failure policy，不直接作为 escalation reason。

---

## 8. 演化策略

### 8.1 硬骨、中骨、软肉

硬骨：

- 改动会牵动前后端、日志、状态机、测试、持久化、运行时。
- 必须写 contract 和 ADR。

中骨：

- 改动影响一个领域模块或一族 intent。
- 必须写迁移说明和契约测试。

软肉：

- prompt、局部字段、UI 布局、单个 executor 内部策略。
- 可以快速迭代，但不能破坏硬骨协议。

### 8.2 v2 优先硬化顺序

建议顺序：

1. Agent Foundation Layer 总 contract
2. AgentTurnResult v2
3. Orchestrator input / output / phase contract
4. Intent / Capability Registry
5. Conversation behavior：clarification / confirmation / cancellation / correction / rejection
6. Memory contract
7. Long-run task contract
8. Consistency / concurrency contract
9. Provider abstraction contract
10. Observation / trace contract
11. Security / budget contract
12. Novel Domain Layer object contract
13. Novel intent catalog
14. Post-hook adoption contract
15. UI card contract

### 8.3 文档组织建议

后续文档目录（以当前 `docs/design-v2/` 实际内容为准）：

```text
docs/design-v2/
  00-overview.md
  01-agent-foundation-contract.md
  02-turn-and-task-state-machines.md
  03-conversation-behaviors.md
  04-capability-and-intent-registry.md
  05-memory-retention-and-retrieval.md
  06-planning-and-long-run.md
  07-consistency-and-concurrency.md
  08-provider-abstraction.md
  09-observability-and-audit.md
  10-security-and-budget.md
  11-ux-contract.md
  12-multi-agent-composition.md
  20-novel-domain-overview.md
  21-novel-object-model.md
  22-continuity-model.md
  23-style-and-author-intent.md
  24-novel-intent-catalog.md
  25-maintenance-hooks.md
  26-context-assembly-policy.md
  27-reading-projection.md
  28-authoring-lifecycle.md
  29-design-integrity-review.md
  30-contract-glossary.md
  31-novel-quality-gates.md
  32-human-approval-policy.md
  33-experience-engine.md
  34-novel-element-field-priority.md
  adr/
    README.md
    0000-index.md
```

注：文件 01-12 对应 §4 子系统 1-12；文件 21-28 对应 §5 模块 1-8；20-novel-domain-overview 为 Domain 层总览，29-design-integrity-review 为阶段性审查文档，31-34 是从小说主编与要素建模视角补充的质量、人工确认、经验沉淀和字段优先级策略。

### 8.4 治理纪律

演化治理不是独立子系统，而是贯穿 Layer 1 与 Layer 2 的过程纪律。它承接原 §4.10 的全部条目：

硬骨：

- Additive-first。
- schema version。
- AgentTurnResult version。
- intent deprecation。
- migration。
- ADR。
- contract tests。
- compatibility window。

硬骨改动规则：

1. 必须写 ADR（落入 `docs/design-v2/adr/`）。
2. 必须说明替代方案。
3. 必须定义迁移策略。
4. 必须补契约测试。
5. breaking change 必须升 major。

ADR 适用范围参照 `README.md` §6：

- Foundation 硬骨改动：必须 ADR。
- Domain 核心对象与连续性机制改动：必须 ADR。
- UI 仅表现层微调：可不写 ADR。
- UI 若反向要求 contract 变更：必须先写 ADR，再改 Foundation / Domain 文档。

---

## 9. 当前未决问题

以下问题暂不在本文定死，后续应进入对应 contract 或 ADR。

1. `AgentTurnResult v2` 是否保持完全兼容 v1，还是引入 `trace`、`cards`、`usage` 顶层字段。
2. `Capability Registry` 存储为 YAML、SQLite 表，还是两者结合。
3. `Intent Registry` 与 `Capability Registry` 是一体还是分离。
4. correction 是否允许自动回滚已采纳生产对象，还是必须创建修正事件。
5. replay 是严格复刻当时 provider 输出，还是使用 frozen raw result。
6. 长跑任务的 tentative artifact 是否进入同一 draft 表，还是进入独立 artifact 表。
7. 结构面板的编辑是否全部转为对话 intent，还是允许受控 action intent。
8. 多 Agent 是作为远期预留，还是在长跑任务中尽早引入 Planner / Writer / Reviewer 三角色。

---

## 10. 下一步

本文只是 v2 总纲。

下一步不应直接扩小说 schema，而应先把 Layer 1 硬骨写成正式 contract：

1. `01-agent-foundation-contract.md`
2. `02-turn-and-task-state-machines.md`
3. `03-conversation-behaviors.md`

完成这三份后，再进入小说领域对象与 intent 的细化。
