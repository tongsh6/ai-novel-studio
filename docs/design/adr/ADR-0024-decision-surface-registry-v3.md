# ADR-0024：决策面注册表与 ui_cards 信息通告边界

- 状态：Accepted
- 日期：2026-07-15（同日 Proposed → Accepted，用户批准）
- 来源文档：
  - `../notes/2026-07-15-dialogue-flow-decision-surface-review.md`（诊断与七行盘点表）
  - `../07-workbench-ui-contract.md` §4 / §8 / §9 / §10
  - `../contracts/VS-05-ui-roundtrip-contract-pack.md` §4
  - `../00c-state-and-contract-atlas.md` §6.6 / §7
- 影响范围：UI / Dialogue / Behavior / Slice
- 相关不变量：`00c` §7 #8、#9、#10、#11；新增 #18（N-SURF，见本 ADR）
- 首个证明 slice：待创建 `decision-surface` CP1（schema 闸门）；CP2（clarification 决策面）；CP3（awaiting_author 恢复决策面）
- 取代：无（修订 `07` §4 的「卡片中心」心智；不取代 ADR-0007 / ADR-0015，是其消费侧的收口）
- 取代者：无

---

## 背景

`07` §4 与 VS-05 §4 以「card_type 集合」为 UI 契约中心，设想作者的每个决策时刻都经 ui_cards 呈现。但实现推进（VS-02A、VS-00E、AU-09、UA-01 CP5）让决策面自然迁出了 ui_cards，长成四条并行通道：专用 TurnResult 字段（`candidate_directions` / `adoption_state` / `quality_review` / `behavior_state`）、`available_actions` 动作通道、AgentRun 事件流工作态、以及残余的 3 种 ui_cards 产出。

2026-07-15 诊断确认的事实（证据位置见来源 note）：

- 契约定义 10 种 card_type，后端产出 3 种（其中 2 种不在契约内或命名偏离），前端 switch 消费 9 种（6 种为死分支），三方真正贯通的只有 `candidate_set`。
- 契约中的 `clarification_prompt` / `recovery_prompt` 对应的决策时刻在产品中真实存在，但既无卡片也无其他显式 surface：clarification 靠「下一条消息即回答」的隐式约定；awaiting_author 不产出任何 TurnResult，是对话死角。
- codegen SSOT 中 `ui_cards` 是 `z.array(z.any())`，前端手写 `TurnResult` interface 绕过 codegen 管线，漂移无机器闸门。

不冻结的长期风险：每个新决策时刻继续随机选择「发明卡片 / 发明字段 / 发明动作」三条路之一，UI 契约永久处于「文档一套、后端一套、前端一套」状态；`DefaultCard` 静默兜底掩盖所有后续漂移。

## 决策范围

本 ADR 冻结：

1. **决策面注册表**是 UI 决策契约的中心（取代「card_type 集合」心智）。
2. **ui_cards 的定位收缩**为信息通告 lane，不承载决策。
3. 现存 card_type 的**命名与处置定案**。
4. 两个缺失决策面（clarification、awaiting_author 恢复）的**契约填补方向**。
5. **schema 治理**要求：决策面进入 codegen 闸门。
6. 新增不变量 **N-SURF**。

## 非目标

- 不冻结各决策面字段的完整 schema（分别由 ADR-0007/0008/0010/0019/0020/0021 已冻结或后续 CP 冻结）。
- 不冻结创作内容流式（`notes/2026-07-01` 延伸，另立 slice）。
- 不冻结调用经济学（ADR-0023 范围）。
- 不冻结前端渲染性能与运行组锚定方案（实现层，slice 内决策）。
- 不改变 Planner/Orchestrator 执行权边界（ADR-0003/0004/0005 不动）。

## 考虑过的方案

### 方案 A：改代码对齐 10 卡契约

后端补齐 10 种 card_type 产出，决策信息回填进卡片。

- 优点：契约文档零修改；卡片体系纸面完整。
- 缺点：要求把 4 个已验收、有专属 UI、受 I1 不变量字节绑定保护的决策面（候选方向、草稿采纳、质量重写、运行控制）推倒重写进卡片；与 VS-05 §4.1 已做出的「creative card 撤出业务动作」修正方向相反；大改动换取的只是与一份 5 月草案的一致性。

### 方案 B：契约认领现产 3 卡

supersede 契约文档，将 card_type 集合改写为 `candidate_set` / `confirmation_card` / `result_card`。

- 优点：改动最小，文档与代码即刻一致。
- 缺点：没有回答「决策面契约是什么」——四条并行通道各自无契约地位；clarification / awaiting_author 缺口原样保留；下一个决策时刻依旧无规则可循。

### 方案 C：决策面注册表（选定）

契约中心从「卡片集合」改为「决策时刻 → canonical 驱动字段 + 动作通道 + 渲染责任」的注册表；ui_cards 降为信息通告 lane。

- 优点：契约描述的是系统真实生长出的结构；已验收决策面原样入册零重写；缺失决策面成为注册表中显式的两行空缺，直接转化为 CP2/CP3；后续新决策时刻有唯一入册路径。
- 缺点：契约文档修订量较大（`07` §4 重写、VS-05 §4 增补、`00c` 联动）；「注册表」是新的契约对象，需要维护纪律。

## 最终决策

采用方案 C。

### 1. 决策面注册表（本 ADR 冻结 v1）

作者决策时刻只能通过注册表登记的决策面进入主链。注册表 v1 共 7 行：

| # | 决策时刻 | canonical 驱动字段 | 动作通道（action_type） | 渲染责任 | 状态 |
|---|---|---|---|---|---|
| S1 | 选择候选方向 | `candidate_directions` | `choose_candidate`（+ continue 语义复用 user_message 携带 candidate_selection） | 候选面板 | 已落地 |
| S2 | 草稿采纳 | `adoption_state`（展示载体 `candidate_set` 卡） | `accept` / `discard` / `edit_then_accept` | 采纳卡 + 动作按钮 | 已落地（I1 绑定保护） |
| S3 | 执行确认 | `behavior_state`（type=confirmation；展示载体 `confirmation_card` 卡） | `confirm_before_execute` / `reject_or_cancel_confirmation` / `cancel_pending_behavior` | 确认卡 + 动作按钮 | 已落地（命名见决策 3） |
| S4 | 回答澄清 | `behavior_state`（type=clarification） | `answer_clarification` | **待补**：显式澄清 surface（问题文本 + 动作绑定），替换「隐式下一条消息」约定 | 缺口 → CP2 |
| S5 | 质量发现重写 | `quality_review` | `revise_from_findings` | 质量复核卡 | 已落地 |
| S6 | 运行中控制 | `agent_run_state` + AgentEvent 流 | pause / resume / cancel / steer（agent_command 通道） | 运行组（AgentRunDialogueFlow） | 已落地（ADR-0021/0022 系） |
| S7 | 运行恢复（awaiting_author） | **待补**：awaiting_author 时产出 TurnResult | steer / resume / cancel 语义的 available_actions | **待补**：恢复提示 + 动作 | 缺口 → CP3 |
| S8 | 本章使命裁决（2026-08-22 WR01b 修订增补） | `chapters.plan_direction["chapter_mission"]`（status=`ChapterMissionStatus`，经 `get_toc` 投影到档案） | `confirm_chapter_mission` / `rewrite_chapter_mission` / `discard_chapter_mission`（author_action，payload `chapter_ref`） | 档案「大纲与结构」逐章使命块（43 §5.0.3） | 已落地（VS-00E §16.8；设计态，不经采纳边界） |

注册表维护规则：新增决策时刻必须先在本注册表登记一行（新 ADR 或本 ADR 修订），才能出现对应的字段、动作或 UI；不入册的决策入口视为契约违规。

### 2. ui_cards 收缩为信息通告 lane

- ui_cards 仅承载**信息通告**：系统已裁决状态的作者可读说明（结果、确认请求的展示部分、草稿集的展示载体）。
- ui_cards **不携带可提交动作**：卡片结构中禁止 `actions` 字段（现存 `result_card` 的空 `actions: []` 字段在 CP1 删除）；可提交动作唯一来源是 `available_actions`（重申 `00c` §7 #10，与 VS-05 §4 Rule 5 一致）。
- 前端对未知 card_type 的兜底渲染（DefaultCard）保留，但 CP1 起未知类型必须同时产生开发侧告警（console/log），不允许纯静默。

### 3. card_type 命名与处置定案

命名原则：ui_cards 是信息通告，统一 `_card` 后缀；`_prompt` / `_request` 后缀暗示卡片承载行为请求，与新定位矛盾，废弃。

| 契约原 card_type | 处置 | 理由 |
|---|---|---|
| `candidate_set` | **保留**（S2 展示载体，命名不动） | 三方已贯通，I1 绑定 |
| `confirmation_request` | **更名为 `confirmation_card`**（认领实现名） | 卡片只是 S3 的展示部分，动作在 available_actions；改契约文字比改产出点+存量数据便宜 |
| （契约外）`result_card` | **入册**为信息 lane 卡片 | 已有真实消费者；语义即「已裁决结果通告」 |
| `clarification_prompt` | **废弃** | 由 S4 决策面取代 |
| `recovery_prompt` | **废弃** | 由 S7 决策面取代 |
| `selection_prompt` | **废弃** | 由 S1 决策面覆盖 |
| `revision_target_prompt` | **废弃** | 由 S5 决策面覆盖 |
| `trace_summary` | **废弃** | `trace_summary` 字段 + trace 入口已覆盖（ADR-0014/0015） |
| `projection_notice` | **废弃** | `projection_refs` 字段已覆盖（ADR-0016） |
| `cancellation_summary` | **废弃** | 取消结果由 `result_card` 表达 |
| `capability_notice` | **Deferred** | 无当前消费者；需要时按信息 lane 入册 |

前端 6 个死分支（`clarification_card` / `warning_card` / `progress_card` / `checkpoint_card` / `failure_card` / `escalation_card`）在 CP1 删除；对应卡片组件若无其他消费者一并删除。

### 4. 缺失决策面填补方向

- **S4 clarification**：`status=needs_clarification` 的 TurnResult 必须携带结构化澄清 surface（澄清问题文本、`behavior_ref`、绑定 `answer_clarification` 动作）；「下一条用户消息默认视为回答」的行为可保留为快捷路径，但不再是唯一入口。载体形式（behavior_state 投影或信息卡）在 CP2 slice 内定案，不新增第五条通道。
- **S7 awaiting_author**：AgentRun 进入 awaiting_author（预算耗尽 / 无进展 / 计划修订不可用）时必须产出 TurnResult：说明停止原因 + 携带恢复动作。对话流中不允许存在「run 停了但没有下文」的终局。

### 5. schema 治理

- 注册表中每个决策面的驱动字段与 ui_cards 卡片形状必须进入 `docs/design/schemas/` codegen 源，生成物为前端唯一类型来源。
- 前端禁止手写 TurnResult 及决策面字段的 TypeScript interface（现存 `WorkspaceChat.tsx` 手写 interface 在 CP1 移除）；channel payload 必须经 codegen schema `safeParse`，失败进入开发侧告警。
- `schema_version` 收敛：codegen 源接受当前 `"3.0-draft"`，正式冻结时收敛为 semver；策略细节 CP1 内定案。

### 6. 新增不变量 N-SURF（`00c` §7 #18）

```text
作者决策只能通过决策面注册表登记的决策面进入主链；
ui_cards 不携带可提交动作；
未入册的决策入口（新卡片动作、新字段动作、新旁路通道）视为契约违规。
```

## 决策理由

- 契约应描述系统真实承重结构。四个已落地决策面各自有专属 UI、测试与不变量保护，是实践验证过的形态；把它们的契约地位补上，比把它们塞回卡片或假装它们不存在都更符合「契约是 SSOT」。
- 「注册表 + 唯一动作通道」延续 v3 既有决策脉络：ADR-0007 冻结了 AvailableAction 是 UI 唯一可提交动作来源，VS-05 §4.1 已把 creative card 的业务动作撤出——本 ADR 是同一方向的完整收口。
- 两个缺口（S4/S7）从「诊断发现」升级为「注册表显式空缺」，使 CP2/CP3 的验收标准直接来自契约行，而不是临时判断。

## Contract 影响

- 修订：`07` §4（重写为决策面注册表 + 信息卡片 lane，本 ADR 同步落地）。
- 增补：`contracts/VS-05-ui-roundtrip-contract-pack.md` §4 追加修订指向（不改写历史冻结内容）。
- 联动：`00c` §6.6 UI contracts 增加注册表行、§7 增加 #18。
- 后续冻结：S4 / S7 surface 的字段级 schema（CP2/CP3 slice 前置 contract pack 或本 ADR 修订）。

## Umbrella 边界影响

- `novel_application`：card 产出点（`turn_result_builder.ex` / `dialogue_gateway.ex`）命名与 `actions` 字段清理；S7 需在 AgentRun 完成/停止路径产出 TurnResult（`agent_run_server.ex` 事件 payload 或 finalizer 层）。
- `novel_web`：channel 透传，不新增语义；不应修改。
- `frontend`：删手写 interface 与死分支、接入 codegen schema 校验。
- `novel_domain` / `novel_agent` / `novel_persistence`：本 ADR 无直接改动要求；S7 若需 BehaviorState 扩展再按 ADR-0008 评估。

## UI / Trace / Replay 影响

- UI：决策面渲染责任按注册表行固定；未知卡片兜底 + 告警。
- Trace：决策面动作回传继续走 AuthorActionInput → 主链 re-gate（ADR-0009/0012 不变）；S7 的 TurnResult 与既有 AgentEvent 流共享 run_ref，replay 可关联。
- Replay：无新增语义；S4/S7 的 surface 进入 TurnResult 后自动获得既有 trace/replay 覆盖。

## 垂直切面证明

- **CP1（schema 闸门）**：codegen schema 落地 + 前端 safeParse + 死代码删除。Proof：契约漂移注入测试（后端发未入册 card_type / 缺字段 → CI 红）；`pnpm typecheck` 证明手写 interface 已不可绕过；前端单测证明未知卡片告警。
- **CP2（S4 clarification）**：场景化验收——外部自动化驱动真实页面：触发澄清 → 页面出现显式澄清 surface → 通过 surface 提交回答 → 主链继续。
- **CP3（S7 awaiting_author）**：场景化验收——掐预算逼出 awaiting_author → 对话流出现带恢复动作的 TurnResult → 触发恢复动作 → run 继续或收束。
- N-SURF driver 方向：扫描 TurnResult 产出，断言所有携带动作语义的结构均来自 available_actions / 注册表决策面。

## 迁移与兼容

- 引用保留：ADR-0007（AvailableAction 唯一动作来源）、ADR-0015（TurnResultViewModel）、VS-05 §4 Rule 1-5 全部保留并被本 ADR 强化。
- 更名迁移：契约名 `confirmation_request` → 实现名 `confirmation_card`（文档侧更名，代码零改动）。
- 废弃：`07` §4 原 10 卡集合中的 8 种（见处置表）；前端 6 个死分支。
- v2 关系：不引用 v2 约束；`07` §4 原文作为草案历史保留在 git 历史中。

## 后续工作

- 需要更新的设计文档：`07` §4（本次同步修订）；`00c` §6.6 / §7 / §8（本次同步修订）；`docs/design/ui/42-card-system.md`（CP1 时对齐信息 lane 定位）。
- 需要创建的 schema：ui_card（含 3 种入册卡片字段）、S1-S7 决策面字段的 codegen 源（CP1）。
- 需要进入的 slice：`decision-surface` CP1 / CP2 / CP3（按 `tasks/slices/` 六问立项，需用户批准 implementation plan）。
- 仍需 Deferred 的问题：`capability_notice` 是否入册；S4 载体形式（behavior_state 投影 vs 信息卡）；`schema_version` 收敛节奏。

## 修订：S7 运行时有效性与恢复面状态矩阵（2026-07-28，DS03 冻结）

DS03（`tasks/slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md`）
冻结 S7 的**运行时有效性前提**——在 available_actions 载体（CP3 本体，仍开放）之前，
先钉死「历史状态 / 实时运行时 / 作者决策面」的单一状态契约：

1. **命令权限真源**：`TurnResult.agent_run` 是历史展示事实；实时命令权限唯一来自
   服务端 `agent_run_state` 帧的 `runtime_live`——稳态快照与 bounded 重连恒为
   `true`；join 时发现的 dead bounded run 广播 `runtime_live: false` 只读快照
   （`AgentRunService.list_dead_bounded/2`）；durable 检查点恢复沿用既有
   `runtime_live: false`。缺失（仅历史快照）视为 unknown，不授予命令。
2. **resume 门禁（同步命令）**：仅 `paused` 可 resume；`awaiting_author` 裸 resume
   返回 `awaiting_author_requires_input`，恢复入口只有非空 steer（`steer_requires_text`
   拒空白）或绑定 action。拒绝必须对作者可见（channel error reason 结构化透传）。
3. **steer 持久化**：steer 被接受后以 user interaction 落库（content 携带
   `agent_run_id`，turn_id 派生 `{parent_turn_ref}:steer:{goal_version}` 幂等）；同一
   turn 因 steer 再次 settle 只补 assistant entry，不重复 user beat。刷新后 transcript
   恢复作者补充及其 run 锚定。
4. **错误呈现**：命令失败是控制坞内单一内联 system status（按 run/command/reason
   去重），不得追加为 assistant 消息；`not_found` 同时把该 run 前端降级为 dead。
5. **UI 状态矩阵**：见 `docs/design/ui/46-state-and-feedback.md` §9.7.1（paused /
   awaiting live / dead bounded / durable checkpoint / unknown 五行）。

S7 注册表行的 available_actions 载体与 `agent_run_state` schema codegen 仍属
CP3 / DS01 范围，本修订不据此关闭 S7。
