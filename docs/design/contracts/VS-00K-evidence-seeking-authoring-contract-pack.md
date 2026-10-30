# VS-00K Evidence-Seeking Authoring Contract Pack（求证式创作）

> 状态：**Accepted（2026-10-29，作者与 ADR-0030/AU-15 一并接受为 B39 实施基线）**。产品仍待 B39 按完整 CP 实施与验收；字段全集、预算数值等未在本 pack 预先冻结。
> 上游：`../00-vision-and-engineering-roadmap.md` §2.4、`../notes/2026-08-11-establish-carry-process-write-pipeline.md`、ADR-0021/0022/0023/0025。
> 冻结决策：`../adr/ADR-0030-evidence-seeking-authoring-v3.md`。
> 执行与验收：`tasks/slices/B39-evidence-seeking-authoring.md`、`../acceptance/author/AU-15-evidence-seeking-authoring.md`。
> 非目标：不冻结时间线或任何单一作品领域的专用 schema，不声称现有产品已完成求证闭环。

> 裁决依据与接受范围：[B39 实施基线收口](../../../tasks/slices/B39-evidence-seeking-authoring.md#9717-c01-实施基线收口)。接受设计不代表产品已实现；不预定新上下文系统、新表、预算次数或独立 gate。

## 1. 要纠正的根问题

现有体系已经有“处理层 = 探索（按需查证）+ 推理”的设计意图，也有 AgentRun 与判断循环探索实现，但创作执行仍以 APP 预选携带为知识保障：

| 当前事实 | 结构性后果 |
|---|---|
| `CarryRegistry` 逐条决定哪些固定材料进入创作调用 | 新维度容易继续变成新携带行与 prompt 段 |
| 正文 profile 只允许 `context_assemble / chapter_mission / prose_writing` | 模型无法像判断循环一样在正文 run 内按需探索 |
| `chapter_mission` 只能从机械预选材料中推导 | 有依据绑定，但没有开放的信息求证过程 |
| writer 有 `self_report.used_context_refs` | 只有字段，未验证 refs 是否来自真实可读证据 |
| 判断循环已有探索、观察、no-progress 与活动投影 | 可复用，不需要另建 agent runtime |

因此，本 pack 不是再增加一个上下文 packet，而是重新划分：**谁判断相关性、谁提供证据、谁执行、谁裁决，以及如何证明。**

术语边界：`02` 的创意 `exploration / explore` 是共同展开方向；本文的“作品求证 / 信息求证”是为既有事实取得证据，二者不得互相冒充完成证据。Observation 是实际读取结果的运行视图，不自动成为长期 Memory、candidate 或 canon。

本原则约束的是**模型调用及其作品知识获取**。Orchestrator、Replay、纯 Reader、确定性 Maintenance / Validator 等消费者仍按任务需要的最小输入工作，不为了形式统一而强行 agent 化。

## 2. 统一术语与责任

以下术语是候选契约概念，不默认要求新建数据库实体或 Elixir struct。

| 概念 | 责任 | 明确边界 |
|---|---|---|
| Base Context | APP 主动提供不可猜测的作者意图、坐标、权限、工具、预算、版本与契约必要材料 | 不得声称穷尽本轮知识；不是越少字越好 |
| Requested Observation | 模型通过 AgentRun 计划/修订选择的只读探索结果 | 必须有真实查询与观察，不得由 APP 按领域关键字伪造为模型选择 |
| Preparation Decision | 模型根据 Base + Observations 判断准备就绪、继续求证、降级或询问作者 | 复用 AgentRun 决策与 plan revision，不另建私有循环 |
| Derived Brief | 从当前证据推导的本章使命、执行简报和写作方向 | 属于设计态/run 内产物，不直接成为 canon |
| Evidence Usage | writer / evaluator 对实际使用来源、假设和风险的自报告及机械绑定 | 非权威；refs 真实不代表语义判断正确 |
| Canon | 已采纳作品事实 | 仍只经 candidate / adoption / policy 改变，边界不因求证改变 |

**预选携带与请求观察必须分账。** CarryRegistry 管 APP 预选；AgentObservation、查询和证据 refs 管模型请求。两者都可进入后续 provider 请求，但不得混成无法解释来源的一段“背景”。

## 3. 目标主链

```text
Base Context
  → 模型起草/修订 AgentPlan
  → 只读探索（0..N，受预算与 no-progress 约束）
  → Requested Observation(s)
  → Preparation Decision
       ├─ 证据不足 → plan revision → 继续探索
       ├─ 无法消歧 → 作者决策面 / 诚实降级
       └─ 准备就绪 → Derived Brief → writer / planner / revision
  → self_report + quality review
       ├─ 需要补证 → 有界补充探索与修订
       └─ 可提交 → tentative candidate → 作者采纳 → Canon
```

### 3.1 不采用第二套 writer 内循环

求证优先发生在统一 AgentRun 的计划、观察与修订层。writer 保持结构化 tentative 产出与 I1 因果绑定；provider-native writer 内工具循环 Deferred，避免重复预算、权限、恢复和作者活动流。

### 3.2 Base 与动态观察的消息边界

- Base 由契约按 profile 明确，模型不得负责猜测目标作品、章节身份、权限或预算。
- 每次实际模型请求的内容与来源清单同源生成，独立记录本次真正可见的 Base 和此前真实观察；trace/replay/引用校验复用该事实，并与实际发送请求核对。不静默回改首轮 DialogueContext，不把后续观察伪装成首轮已知；快照是逻辑证据边界，不默认新建 struct/表或保存全量 prompt。
- 动态观察的内容或保真投影与观察/source refs 同批送入请求，表达真实来源、结果分类、可获得的版本/权威状态及覆盖/省略；区分已采纳、待定、推导与假设，未知字段不得伪造。仅后台留 refs 或仅传 refs 不构成模型已获得有依据材料。
- 观察进入准备判断、plan revision、writer 或 evaluator 的真实请求时，必须能关联到对应 provider call。
- 动态内容的位置遵守 VS-00I 前缀稳定性；复用已有材料格式与共享引用规则，已覆盖的规则不重复堆叠；不得为插入观察破坏稳定前缀或改变 provider 间语义。作者面使用可读来源，小说正文不强制插入技术引用。
- 省略与分页仍需可解释；“模型没查到”与“APP 没提供”必须在 trace 中可区分。

## 4. 分项契约

### 4.1 创作 profile 与探索步

- 正文、规划和修订 profile 必须能使用同一组只读探索目标，不再只给判断循环。
- 模型决定查不查、查什么以及何时准备就绪；APP 不按时间、物品、伤势等领域关键字自动插步或改写 query。
- 已授权范围内自主查询，不逐次弹窗；runtime 在实际读取前校验工具、query、作品/会话范围、权限、预算与任务状态，模型提供 ref 不扩大授权。act 步仍重新经过 MicroPlan / Orchestrator gate；观察不直接写 canon。
- 探索执行、观察、活动、续读和 no-progress 优先复用同一实现，不在每个 flow 复制；独立只读 gate 是否必要由边界缺口与真实消费者评估，不以统一外观为由新增层。
- 额度不足时保留进度、已查材料和缺口，由作者追加或停止；模型不自行扩额，replan 不重置已用预算。数值按场景测量，不冻结“2 次探索”。取消后不再派发新查询，已返回观察不能触发迟到写入。

### 4.2 准备判断

- 本次目标依赖的关键既有事实未核清时，默认先继续求证或请作者决定，再生成符合原目标的正文候选。准备判断必须能表达“还缺什么”，不能只输出一个总 confidence 让 APP 猜阈值；不要求穷尽全书或给新创意补旧来源。
- 信息缺口是通用结构，不使用 `timeline_missing`、`item_missing` 等领域专用分支。
- APP preflight 的 hard missing / 权限 / 版本阻断与模型语义上的信息缺口分层：模型不能解除系统 block，APP 也不能仅凭预选材料替模型宣布 ready。不得把 D7 的应用可判缺口悄然改写成模型语义缺口；新信号由 ADR-0030 承接。
- 证据足够时才生成最终 Derived Brief；不足时进入有界 plan revision。
- 查不到、冲突、过期和预算耗尽各有诚实出口；不得用默认事实填平。
- 作者明确要求“先假设、试写”时按其意图及既有 MissingPolicy/profile policy 处理，明确假设与风险；这不允许越过身份、权限、版本等硬阻断，也不把缺证据静默视为准备齐全。

### 4.3 证据引用与创作输出

- 本次请求实际可见的 Base refs 与此前真实执行、且已送入本次请求的观察 refs 共同构成本次可引用证据集合，按 run 汇总对账；只在别次调用出现或尚未发送的 ref 不自动获得本次证据信用。优先从既有 Context/AuthoringTask/AgentObservation 派生，不默认新增持久表。
- `used_context_refs` 中每个 ref 必须属于该集合；越界引用须记录 provider call、run 和 unbound ref。未返回自报告时记为 `unknown`，不得由 supplied refs 推导 used refs，也不得把缺省伪报成“确定没有使用”。
- 不修改模型 artifact 的 title/body/rationale 字节；越界引用通过 warning、补充求证、质量 finding 或作者裁决处理。
- 新创作允许没有旧 ref；只有对既有 canon 的引用与连续性主张需要证据支持。
- self_report 仍是非权威信号，不直接写作品事实或改变采纳状态。

### 4.4 Trace、Replay 与恢复

- 查询、观察、后续 provider 调用、准备决策与 used refs 必须可按 run 对账。
- 恢复优先根据持久 AgentObservation / trace 重建证据视图，不能只靠旧 prompt 字符串。
- 来源版本不匹配或 stale 的观察不得冒充当前事实。
- replay 默认不重调模型；作者可见叙事继续遵守 N-NARR，技术遥测不冒充模型叙事。

### 4.5 既有携带迁移

- 本 pack 不一次性删除现有携带，也不要求每个事实都等模型查询。
- 每个携带块后续须根据真实使用证据归类：Base（不可猜/必要）、On-demand（模型按需求取）、Derived（从当前证据推导）。
- 新作品维度默认先进入可探索事实与引用体系；新增固定 packet 必须说明为何不能由按需观察或派生完成。
- 迁移按承重 slice 逐块进行，不能把元原则当成一次性清空 CarryRegistry 的许可。

## 5. 已接受的设计不变量（00c #20–#23，运行时与 CI 待落实）

| # | 不变量 | 机器证明方向 |
|---|---|---|
| 20 | **观察因果**：后续模型请求中的非 Base 作品知识必须能关联到本 run 的真实观察及其来源；不得有隐式侧路 | 对 provider 请求、Base refs、observation refs 做集合与血缘对账 |
| 21 | **引用真实**：`used_context_refs ⊆ Base refs ∪ observed refs`；未读取 ref 不得获得证据信用，且不得修改 artifact 字节来掩盖 | 注入未观察 ref，断言 unbound 记录、处置与原始字节不变 |
| 22 | **求证有界**：探索只读并受权限、预算、no-progress、取消与恢复约束；推理和观察不直接写 canon | 重复查询、预算耗尽、取消/恢复、production write 与 replay 测试 |
| 23 | **通用求证与诚实缺口**：求证不依赖领域专用 prompt 分支；未知、冲突和未读取必须显式可见 | 两个不同要素共用同一产品链；缺失/冲突场景；真实模型行为与 stub 机制证据分开 |

这些不变量已作为设计接受，运行时与 CI 尚未全部落实，不能写成 CI 已强制。落地到 `docs/engineering/scenario-invariants.md` 与 quality 运行体系须由对应 CP 单独完成。

## 6. 既有设计的处置矩阵

“修订”表示目标语义需要改变，不表示新行为已实现；“保留”表示继续作为底座；历史证据不重写。

| 设计落点 | 处置 | 必须落地的责任变化 |
|---|---|---|
| `00b` 端到端主链 | 修订 | 在 Context 与创作执行之间明确“探索→观察→准备/修订”的可逆求证环，不再只有线性携带 |
| `00d` 运行时 | 修订 | 区分求证控制面、作品探索数据面与 run 证据轨迹；统一 AgentRun，不增第二 runtime |
| `01` 交互模型 | 修订 | 作者不承担反复提醒义务；AI 可查证据再答/写，只有真正歧义才问作者，探索活动可感知 |
| `02` Frame / MicroPlan | 保留并补充 | 不为求证另造作者 turn 或绕 gate；信息缺口沿 AgentPlan / observation / behavior 既有边界表达 |
| `03` Toolbox | 修订 | 只读探索成为创作 profile 共用能力；观察契约含 refs、结果分类、版本/权威信息，工具不直接给 canon 写入权 |
| `04` Orchestrator | 保留并补充 | 模型提出探索不获执行批准；只读/写入、预算与 re-gate 继续统一 |
| `04a` 长跑 | 修订 | 求证预算、观察持久化、恢复和 stale 处理进入 checkpoint，不靠旧 prompt 残留 |
| `06` Context / Trace | 修订 | DialogueContext 是 Base/预选与派生上下文，不是所有作品知识的完整快照；补 Requested Observation 与证据链 |
| `08` 要素模型 | 修订 | 四消费面从“等 APP 携带”扩为规划、maintenance、探索/展示、求证式创作；物化必须可探索、可引用 |
| `domain/26` 上下文策略 | 修订 | 固定“必需/必须进入”清单降为 Base 与检索/降级规则；结构化摘要、预算与权威优先保留，坐标不等于知识完备 |
| `domain/22 / 23` 连续性与风格 | 修订 | hot/warm tier 是存储检索层级，不等于自动注入；long-run 启动清单转为最小恢复底座＋按需读取，来源版本仍需核对 |
| `VS-00C` | 修订 | CarryRegistry 只管预选携带；补 Base / Observation / Evidence Usage 边界与迁移规则 |
| `VS-00D` | 修订 | 当前作品层从单向 WorkStateMessage 扩展为 Base + 可探索事实 + 真实观察；三层仍投影到真实 message |
| `VS-00E` | 修订 | chapter_mission 增加准备就绪/信息缺口；self_report refs 进入机械证据绑定，质量可触发补充求证 |
| `UA-01` | 修订 | 创作 profile 增加只读探索和证据不足 plan revision；不恢复每步必调 planner，不新建 writer 内循环 |
| ADR-0023 / 0025 | 由 ADR-0030 补充，不直接改历史 | 模型仍制定/维护计划；求证缺口是有计划 run 的修订依据，Orchestrator 与作者主权不变 |
| `engineering/vertical-slice` | 修订 | Proof/Exploration 必须证明真实求证与引用，不能只断言固定 prompt 段存在 |
| `engineering/quality-gates` | 增补 | trace/replay 清单补 Base、查询、观察版本/覆盖、后续请求、used refs 与 gap/replan 结果；按 CP 落地，未覆盖不得冒充 |
| `engineering/scenario-invariants` | 后续增补 | 先在 B39 场景 verifier 复用证据链，再独立固化 I-EVIDENCE 族，不扩大 I1–I3 原义、不提前宣称 CI |
| `acceptance` | 新增 AU-15 | 机制与真实模型行为分证；至少两个不同要素共用同一链，含未知、越界引用、预算和恢复 |
| `quality` 运行体系 | 后续增补 | 统一真实请求证据词表与 request/response/ref 顺序；缺实模凭据只能 blocked/未闭环 |

## 7. Checkpoint 与真实消费者

| CP | 范围 | 第一个真实消费者与完成证明 |
|---|---|---|
| CP0 | 本 pack、ADR-0030、AU-15、B39、atlas 与上述文档处置 | 设计读者能逐条找到责任、契约、验收和未实现状态；不代表产品实现 |
| CP1 | 正文 run 开放共享只读探索、同源材料与观察进入使命/writer；完整用户场景具备所需最小准备判断；现有携带保留 | writer；SC-AU15-A0/A1/A2，覆盖 Base 足够、人物承诺与另一未定制要素；真实模型自主选择及后续请求证据 |
| CP2 | 准备判断、信息缺口、有界 replan、used refs 证据绑定 | 写前使命与 writer；SC-AU15-B1/C1 |
| CP3 | 规划、修订、写后质量与恢复共用求证 | 规划/修订/evaluator/replay；SC-AU15-B2/C2 |
| CP4 | 固定携带凭证据迁移，领域读模型按真实缺口立项 | APP 维护者与后续领域 slice；SC-AU15-D1 |

每个 CP 仍需独立 slice checkpoint 与外部真实页面证据。可以先做局部接线并报告 unknown，但不能代签 A0 的 ready/missing 或正式场景；完整缺口/replan/引用绑定继续由 CP2 承接。CP 完成、正式场景 PASS、完整 B39 done 与 I10 文学收益分开；缺必需证据不通过，CP1 通过不等于 VS-00K 全部完成。

## 8. 明确不在本 pack 冻结的内容

- Base 的逐 profile 字段全集与各档预算数值；
- Preparation Decision 的最终字段名与 schema；
- 各探索工具缺失的版本元数据如何补齐；
- 未绑定 refs 在所有场景下究竟 warn、replan、confirm 还是 block；
- writer 内 native 工具循环；
- 时间线、状态快照或统一查询语言；
- 既有携带块的最终退役清单；
- CI 新不变量已落地或真实模型行为已通过。

这些项目必须沿对应 CP 的真实消费者和证据继续决策，不能在 CP0 假装全部定完。

## 9. CP0 文档验收

- ADR-0030、AU-15、B39 与本 pack 互相可达，并进入各自 README / 00c atlas。
- 上述每篇承重设计都有明确处置，不能只添加“参见元原则”而不改变责任与验收含义。
- Accepted 只表示设计冻结；未实现、未注册、未运行场景与未落地 CI 不变量分别如实标记，无产品完成的虚假声明。
- 文档链接、ADR trace、NEXT 规则、差距台账与 `git diff --check` 通过；功能测试与真实页面不属于 CP0 证据。
