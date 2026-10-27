# B39：求证式创作——最小供给、Run 级探索与证据闭环

- 状态：**doing（CP0 元原则落地对账完成；CP1 施工待 ADR-0030 Accepted；2026-10-28 完成 CP1 只读预研复核 §9，作者决策 D1–D7 待裁决）**。
- 登记日期：2026-10-27；来源：作者指出持续增加 APP 主动投喂只会不断补漏洞，要求先把元原则深化到全部承重设计，而非先做时间线专用设计。
- 上游：[00 §2.4](../../docs/design/00-vision-and-engineering-roadmap.md#24-创作信息获取元原则最小供给按需求证证据闭环2026-10-27-用户拍板)、[ADR-0030](../../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md)、[VS-00K](../../docs/design/contracts/VS-00K-evidence-seeking-authoring-contract-pack.md)、[AU-15](../../docs/design/acceptance/author/AU-15-evidence-seeking-authoring.md)。
- 当前阶段只进行设计、契约、验收与任务登记；ADR-0030 未 Accepted 前不进入产品实现。

## 1. 核心问题与完整目标

当前系统已有 AgentRun、模型计划与修订、判断循环探索、写前使命和 self_report，但正文、规划与修订的知识保障仍主要依赖 APP 预选材料。继续为每类知识增加固定 packet，会让 APP 永远预测并追赶模型的信息需求。

完整目标是把创作主链改为：

```text
最小可信底座
→ 模型在统一 AgentRun 中判断信息需求
→ 只读探索与真实观察
→ 准备就绪 / 继续求证 / 询问作者
→ 正文、规划或修订
→ self_report / 质量复核与证据绑定
→ 必要时补充求证
→ tentative candidate 与作者采纳
```

首个消费者是正文 writer；规划与修订是完整范围内的后续消费者。首个实施锚点优先使用未进入任何专用 packet 的人物承诺/关系细节，时间连续性只承担另一个精确验证例，不建立时间线专用架构。

### 非目标

- 不以本任务为名一次性删除现有携带、重写 AgentRun 或建立 writer 内第二套工具循环。
- 不先建 timeline_event / state_snapshot 表，不冻结任何单一领域的时间或状态 schema。
- 不把 stub 预先排探索步骤当成真实模型自主求证。
- 不把 refs 存在等同于语义正确，也不要求所有新创作都有旧来源。
- 不新建平行 agent、plans、specs 或验收目录。

## 2. 开工七问

1. **Contract**：消费 00 §2.4、ADR-0021/0022/0023/0025、VS-00C、VS-00E、UA-01 与既有 ExplorationService；新增 Proposed ADR-0030 与 VS-00K，区分 Base、Requested Observation、Preparation Decision、Evidence Usage。Accepted 前只完成设计。
2. **Invariant**：候选 #20–#23——非 Base 作品知识必须能追到真实观察；used_context_refs ⊆ Base refs ∪ 实际观察 refs；求证有界、只读、可恢复且不直接写 canon；通用场景不得依赖领域专用 prompt 分支。I1/I2/I3、N-NARR、作者采纳与 Orchestrator 门禁不变。
3. **Boundary**：CP1 主要切 `novel_application` 的 AgentRun flows、共享探索步、准备与观察投影；`novel_domain` 只做纯校验；`novel_agent` 复用 ProviderExecution；`novel_persistence` 优先复用观察与 trace，零新表前提；web/frontend 复用真实 Channel 和 AgentRun 活动，不建旁路页面。
4. **Consumer**：正文 writer 及其后续真实 provider 请求；作者通过 WorkspaceChat 看到探索、缺口、候选与依据。后续消费者为规划、修订、质量复核和 replay。
5. **Proof**：domain/application 契约与边界测试、真实 provider 请求体、观察与 used refs 集合对账、恢复/no-progress/预算测试、I1/I2/I3、架构门禁；AU-15 真实 Tauri + 真实模型行为证据。CP0 只跑文档/索引/ADR/任务检查，不能声称产品能力已验证。
6. **Acceptance Driver**：拟由外部自动化驱动真实 Tauri WorkspaceChat，场景 SC-AU15-A1/A2 起，随后 B/C 矩阵。首轮 Base 不含完整答案，模型须自主选择探索；产品新增验收感知逻辑：**no**。
7. **Exploration**：本 slice 的主体就是把既有探索提升为创作共同能力；不新增作品要素。未来新增时间线等读模型时，必须同批进入同一探索与证据链，不能只进入固定携带。

## 3. 当前可复用事实（不是求证闭环已完成）

- `ExplorationService` 与判断循环已有只读探索、观察、活动投影、续读和 no-progress。
- AgentRun 已有模型起草/修订 AgentPlan、机械执行、预算、取消、恢复与 trace。
- `prose_drafting_with_quality_v1` 当前计划目标只有 `context_assemble / chapter_mission / prose_writing`，机械执行器也拒绝其他目标，正文求证能力尚未开放。
- `chapter_mission` 当前根据机械预选材料做一次强制 tool-call，已有依据绑定，但不是开放探索。
- writer 输入已有观察摘要合流点；`self_report.used_context_refs` 已有字段，但目前只做归一化，没有真实观察集合校验。
- `CarryRegistry` 管理 APP 预选携带，不能与模型请求观察混为同一语义。

## 4. Checkpoint

| CP | 完整工作与完成标准 | 状态 |
|---|---|---|
| CP0 | 元原则落到主链、运行时、Context、AgentRun、写前推理、要素模型、工程与验收；形成 ADR-0030 / VS-00K / AU-15 / B39 和索引、atlas、不变量、旧条款处置矩阵。只登记设计，不声称实现 | **done（2026-10-27）**：主链/领域/契约/工程文档完成处置；候选 #20–#23；ADR trace 28/28、NEXT ok、新文档链接通过、差距快照 20 项开放无意外减少、diff check 通过；未运行产品功能测试或 Tauri |
| CP1 | 正文 run 开放现有只读探索；共享判断循环探索执行，观察进入使命与 writer；保留现有携带，不新建时间表；真实模型完成 SC-AU15-A1/A2，确定性机制与模型行为分层取证 | 未开工；ADR-0030 待 Accepted |
| CP2 | 写前准备可返回通用信息缺口并触发有界 plan revision；建立 Base/观察 refs 与 used_context_refs 对账；明确“可先求证”与“只能由作者裁决”的 clarification 边界；未知、歧义、冲突与越界引用完成 SC-AU15-B1/C1 | 未开工 |
| CP3 | 规划、修订、写后质量与恢复复用同一求证链；完成 SC-AU15-B2/C2；真实 provider 请求、trace、replay 与作者可见证据一致 | 未开工 |
| CP4 | 依据真实 run 的引用、重复查询和质量证据逐块迁移固定携带；领域读模型（包括是否需要时间线）按真实缺口单独立项；完成 SC-AU15-D1 | 未开工 |

CP1 只是执行 checkpoint，不能替代本任务“规划/正文/修订＋准备/写后复核＋恢复”的完整闭环；CP1 通过不得把 B39 标 done。

## 5. CP0 设计落地清单

| 落点 | 必须落地的内容 | 状态 |
|---|---|---|
| 00 / design README / AGENTS | 元原则、反模式、已确认决策与入口 | done（2026-10-27 前序） |
| ADR-0030 | 方案比较、Run 级求证、与 Accepted ADR 的关系、非目标与迁移 | 已登记 Proposed |
| VS-00K | 统一候选契约、不变量、文档处置矩阵、CP 与证明 | done（Proposed） |
| 00c atlas | 对象、contract、全局不变量、ADR backlog 与 slice 入口 | done（AgentObservation、求证 contract、#20–#23、ADR-0030、§9.12） |
| 00b / 00d / 01 / 02 / 03 / 04 / 04a | 主链与运行时责任、工具与门禁、恢复，不写历史实现为已完成 | done（求证回边、逐请求快照、作品求证/创意探索分界、恢复与 stale） |
| 06 / 08 / domain 26、22、23 | Base 与观察边界、四消费面、hot/warm 检索层级与恢复规则 | done（Observation≠Memory/canon、坐标≠知识完备、可达+回流+引用、启动清单≠自动注入） |
| VS-00C / VS-00D / VS-00E / UA-01 | 预选携带与模型观察分离、准备判断、创作 profile 探索、证据使用 | done（§3.6 / §11.4.2 / §16.11 / §4.1；Accepted 历史段保留并增补） |
| engineering / acceptance | slice Proof/Exploration 约束、AU-15 场景与实模证据分层 | done（第七问扩充不增第八问；AU-15 Proposed，未注册运行场景） |
| ADR / contracts / acceptance / slices 索引与 project-ledger | 可达性、唯一事实源、未实现状态 | done（00a、00c、各 README、NEXT 与事实台账已同步；Proposed 标记清楚） |

## 6. CP1 实施边界与证据

### 必须做

- 复用判断循环探索执行与观察格式，提取共享能力而非复制第二套；
- planner target/catalog 与正文机械执行器接受只读探索步；
- 观察以 author-safe、带真实 refs 的形式进入使命和 writer；
- 复用预算、no-progress、取消、恢复和 `exploration_observed`；
- 真实模型在 Base 不含答案时主动选择探索；后续真实请求包含观察；
- A2 未定制要素不得新增专用产品分支。

### 不得做

- 按“时间/物品”等关键字让 APP 自动插探索步；
- 让 stub 的选择冒充真实模型行为；
- 修改 provider artifact 字节来凑证据或 I1；
- 为通过验收删除既有携带或引入 slice 专用开关；
- 只做 helper、注册表或局部测试就标完成。

## 7. 验证与恢复

### CP0 文档检查

```bash
mix run scripts/adr_trace.exs
node scripts/next_task_check.mjs
bash scripts/gap_ledger.sh
git diff --check
```

另需检查新文档在对应 README、00c atlas 和任务索引中可达。CP0 不需要后端/前端功能测试或 Tauri；未运行时必须明确说明。

### CP1+ 产品验证

沿用 AU-15。必须分别报告：外部自动化真实页面验收、后端/组件局部验证、真实模型行为证据、未闭环缺口。真实模型长跑或狗粮只能沿便宜验证阶梯并由作者另行拍板。

### 恢复指引

- 先读本任务、VS-00K、ADR-0030、AU-15 和当前 NEXT；不要从历史总结猜完成度。
- ADR-0030 未 Accepted 时只做文档，不写产品代码。
- 并行修改 B30/B29 等任务时保留其 WIP 与原生验收证据，不把本任务文档编辑当成其他任务完成。
- 时间线需求继续保留在 `docs/design/notes/2026-10-26-story-timeline-management.md`，不纳入 CP1 前置。

## 8. 决策日志

- 2026-10-27 — 作者明确当前重点不是时间线专用设计，而是把“最小供给 + 模型按需求证 + 证据闭环”深入落到各设计。CP0 因此先处理全部承重设计与验收，不以时间线 schema 开工。
- 2026-10-27 — 采用统一 AgentRun 级求证作为 Proposed 方向；writer 内 native 工具循环 Deferred。ADR-0023/0025 保持 Accepted 历史，不由本任务直接改写。
- 2026-10-27 — 按作者“先深化元原则而非时间线专用设计”的排序，NEXT 当前任务转为 B39；B29 初始保留为第一候选，随后其原生补验完成并按任务规则移出队列，既有证据不覆盖、不丢弃。

#### 2026-10-27 CP1 开工前只读预研与验收预注册（AI，未实现；ADR-0030 仍 Proposed）

- 目的：在作者评审 ADR-0030 / VS-00K / AU-15 期间完成 CP1 的只读接线审计与真实模型验收预注册；ADR Accepted 后可直接开工。本节不改变 CP 状态、不改设计/契约、不写产品代码，仅登记可复用事实、实施切口与开放决策。
- 基线：HEAD `d1006713`，工作树干净；独立核对证据见 `artifacts/completion-audit/2026-10-27-b39-cp1-readiness/report.md`。

**接线事实（当前代码）**

1. 创作 run 计划目标白名单仍无探索：`apps/novel_application/lib/novel_application/agent_run_flows/prose_drafting_with_quality.ex:369`（仅 `context_assemble/chapter_mission/prose_writing`）→ CP1a 需加入探索目标并分支执行。
2. 探索执行已有可复用实现但为私有：`agent_run_flows/judgment_plan.ex:36`（`@exploration_step_targets`）、`:473 execute_exploration_decision_step`、`:504 exploration_observed` 事件与 payload；CP1a 应提取 application 内共享模块，由判断循环与 prose flow 同源调用，不新增平行 agent loop。
3. 观察已在 run 内保存/投影：`agent_run_server.ex:812-823`（add_observations / persist_step_result / emit_observations），continuation 已有 observation_block（prose flow `:226-234`）可作模板；持久化复用 AgentRun event/step，无新表前提。
4. CP1b 观察进使命/writer：`chapter_mission` 输入（prose flow `:751-799`）与 writer 的 `AuthoringTask`（`authoring_task_builder.ex:155 for_prose_writing`、`:744 prose_materials`）需把本 run 观察摘要/refs 作为材料来源之一；`CarryRegistry`（`carry_registry.ex`）现有携带不变。
5. CP1c 证据绑定：`self_report.used_context_refs` 目前只归一化（`tool_output_contract.ex:176`）与空报告判定（`:500-504`）；需新增 domain 纯校验 `used_context_refs ⊆ Base refs ∪ 实际观察 refs`，未绑定 ref 记录 trace、不修改 artifact 字节、不给证据信用。**Base refs 的统一暴露点当前不存在**（context 组装未输出统一 Base refs 集合），CP1 需 additive 暴露，不得新增固定 packet。
6. Replay 从持久观察重建属 CP3：`replay_service` 当前无 observation 处理，CP1 不得声称完成。

**CP1 验收预注册（ADR Accepted 后执行；执行前不改）**

- 模型/资源：Strata `iq3_s`（作者既有实例），单槽串行；原生 Tauri 外部系统 UI 驱动 + 真实模型；加载前记录 `lms ps`/内存与 Strata `loaded=null`，结束（成功/失败/中断）`POST /api/models/unload` 并验证 `loaded=null`；不加载第二模型。
- 场景（引用 `acceptance/author/AU-15`，不改判据）：**SC-AU15-A0** Base 已足够的小任务不强制探索，允许模型直接准备，不把“每 run 都调工具”当目标。**SC-AU15-A1** 较早章已采纳正文含人物承诺/关系细节（如“沈砚答应三天后回灯楼接顾青”），该事实不进任何专用 packet，首轮 Base 不含完整内容；后续创作请求须证明模型自主选择只读探索→观察含真实承诺/关系表达、章 refs 与覆盖→后续 writer 真实 provider 请求包含该观察或保真投影→候选与承诺/关系相容→采纳前零 canon 写入。**SC-AU15-A2** 对未配置专用 packet 的时间关系复用同一探索/证据链：两章分别含“过了三天/又过了两星期”，观察进入后续 writer，结果与累计十七天相容，产品 diff 不得出现时间专用分支。
- 预算/等待：B37 分型预算（input120 / turn360 / candidate300 / adoption180 / maintenance300 / restore30 秒）+ 10s 心跳；原指令只发一次、超时不重发；模型提问按作者默认应答（options 推荐项；free-text 给具体默认方向）≤2 次并记录 `author_question_events`；同一失败类型≤2 次，超预算记录根因并升级。
- 证据目录：`artifacts/slice-verify/b39-au15-a1-native/`、`artifacts/slice-verify/b39-au15-a2-native/`；含真实 Tauri AX/截图、native-transport、app-log、llm-calls（真实 provider 请求体，证明观察进入后续请求）、observations 与 `used_context_refs` 集合对账、只读 DB 快照、模型生命周期 before/after。失败批次只读保留。
- 判据分层：确定性机制证据（探索目标被计划/执行、观察持久化、writer 请求包含、refs 校验命中）与真实模型行为证据（模型自主决定查询/使用观察/承认缺口）分别报告；确定性替身只证明接线，不得代替模型行为。
- 实模重复与保留措辞：关键缺事实场景至少独立运行 2 次且全部满足规定证据链，timeout/格式失败计入分母；至少保留一种未参与调词的自然措辞。模型、参数、预算、禁答集、重复次数和通过线在 CP1 开工前冻结，执行中不得为通过率追加专用 packet 或缩减分母。

**待作者/开工后首个 CP1 checkpoint 决策（不阻塞 ADR 评审）**

1. Base refs 集合的字段形状与暴露点（context 组装输出 additive refs 列表 vs 既有 trace refs 聚合）。
2. prose run 的探索预算（最大探索步数/重复查询预算）是否复用判断循环预算，或按 run 分账。
3. CP1 的最小准备判断边界：仅“继续探索或进入写作”，`replan/degrade/ask_author` 留 CP2（避免 CP1 范围膨胀）。

## 9. 2026-10-28 CP1 只读预研复核（AI，未实现；ADR-0030 仍 Proposed）

- 目的：在 §8.4 旧预研（基线 HEAD `d1006713`）之后 B40/B41/B42/B59/B61 已落地的当前仓库上，重做 CP1 只读接线审计、实施切口、Base refs 方案与真实模型预注册校准。本节只登记事实与方案，不改变 CP/ADR 状态，不写产品代码，不改 ADR/契约/schema/验收文档，不运行产品或真实模型，不 commit。
- 基线：HEAD `7fcab486`（B61）。工作树含**其他任务未提交 WIP**（`tasks/NEXT.md`、`tasks/slices/README.md`、B62/B63 文档及 `scripts/`、`quality/acceptance/scenarios.yml` 等改动）；**`apps/` 无未提交改动**，下文中产品代码 file:line 均可在 HEAD 复现。独立只读核对报告：`artifacts/completion-audit/2026-10-28-b39-cp1-preread/report.md`。
- 与旧预研的关系：`仍成立`＝事实未变；`已变`＝代码/证据基础已改变，旧表述需按本节修订；`需修正`＝旧表述不完整或会误导 CP1 计划。

### 9.1 与 2026-10-27 旧预研逐条对比（接线现状审计）

| # | §8.4 旧事实 | 当前代码事实（file:line） | 结论与 CP1 含义 |
|---|---|---|---|
| 1 | `prose_drafting_with_quality_v1` 计划目标只有 `context_assemble/chapter_mission/prose_writing`，机械执行器拒绝其他目标 | 执行器白名单 `agent_run_flows/prose_drafting_with_quality.ex:369`（`@checked_step_targets` :41、`checked_step?` :489）；另有**planner 侧起草校验白名单** `agentic_plan_draft_planner.ex:537-539` 与 **prompt 能力目录** `:766-771`；profile 工具集仍只有 prose_writing（`dialogue_planning_service.ex:40`、`agent_task_profile_registry.ex:38-45`） | **仍成立且范围更大**：CP1 要成对改 flow 执行器、planner 白名单、prompt 目录、checked 摘要口径（4 处）；authority_scope/profile registry 无需加探索目标（探索步不经 `plan_from_decision`/Orchestrator，与 judgment_plan 现状一致） |
| 2 | 探索执行已有可复用实现但为私有（`judgment_plan.ex:36/473/504`） | **三处漂移实现**：judgment_plan 计划步 `judgment_plan.ex:474-538`（`ExplorationService.run/3`，4 个工具、无 session）；判断循环内联 `dialogue_planning_service.ex:668-718`（`:720-737` 用 `run/4` 带 session，目标集含 `character_roster` 5 工具，`@read_only_plan_targets` :432）；判断 action=explore `:1536-1576`。事件 payload/step/signature 在两处几乎逐字重复（`judgment_plan.ex:544-562` vs `dialogue_planning_service.ex:1583-1603`） | **需修正**：不是“一处私有实现”，而是三处（工具集/会话作用域/signature 各不相同）。CP1 提取前须先定“目录与工具集分账”（plan 步 4 工具 vs 判断循环 5 工具含 `session_adoptions`，后者需 session 作用域） |
| 3 | 观察已在 run 内保存/投影：`agent_run_server.ex:812-823`（add_observations/persist_step_result/emit_observations）；continuation observation_block `:226-234` | `apply_recorded_result` `agent_run_server.ex:810-823`；`add_observations` :1398-1401；`persist_step_result` :1743-1746 + `step_attrs` :1934-1958；`emit_observations` :1413-1434（visibility `:developer`）；snapshot :2062 / step_snapshot :3131 传 `state.observations` | **仍成立，但两处需修正**：① developer 观察事件**不上 socket**（`workspace_channel.ex:900-904` gate `AgentEvent.author_visible?`，`agent_event.ex:115-116`），只落 DB `agent_events`；作者可见探索活动行走 author stage 事件 `exploration_observed`（`judgment_plan.ex:503-510`）。② 观察只在进程内 state（:64、:1400），long-run checkpoint 不含 observations（:1858-1878），重启后为空 → CP1 只覆盖同 run 后续请求，恢复归 CP3 |
| 4 | CP1b：`chapter_mission` 输入与 writer `AuthoringTask` 需把观察作材料来源之一 | writer：`author_input_text` `prose_drafting_with_quality.ex:1514-1537`（只拼 `summary`，无 refs）→ `tool_input.creative_brief`（`turn_execution_service.ex:558-603`；`creative_tool_adapter.ex:48`）→ provider prompt「用户创作简述」（`creative_provider/real.ex:329`）；`continuation_observation_block` :226-235 同。使命：`mission_inputs` :870-899 只走 `ChapterMissionInputs.build`（`novel_domain/chapter_mission_inputs.ex:67`），**不接收 observations**；但使命已有完整 ref 绑定机制：`refs/1` :106、`to_prompt_section/1` :132、`ChapterMission.bind/2`（`chapter_mission.ex:78`）、调用点 `chapter_mission_service.ex:196-201`（I-M1 越界丢弃） | **仍成立，且给出更小切口**：writer 侧只差“带 refs”；使命侧无需新契约，给 `ChapterMissionInputs.build` 增 observation items 即可复用 I-M1（见 9.3.3） |
| 5 | `self_report.used_context_refs` 只归一化与空报告判定，无真实观察集合校验；`tool_output_contract.ex:176/500-504` | 归一化 `apps/novel_common/lib/novel_common/contracts/tool_output_contract.ex:176`、空报告 :500-503；`creative_provider/real.ex:381` 仅 prompt 说明；全仓 `used_context_refs` 仅 4 处匹配（第 4 处为测试 fixture `slice_verify.ex:2547`）；application/domain 无消费者、无 unbound 记录 | **仍成立**。self_report 随 tool_result.output/state_delta 出站（`creative_tool_adapter.ex:293/303`），可被 turn_result/ws 帧/DB 捕获（P1 实模真实返回 `chapter:<uuid>`），但无任何绑定校验 |
| 6 | **Base refs 统一暴露点当前不存在**（context 组装未输出统一 Base refs 集合） | 已存在三个互不交集的 ref 生产点：① context 组装 `DialogueContext.context_refs`（`context_assembler.ex:78`），trace summary 已记（`trace_writer.ex:185`）；② authoring 材料/范围 refs 已渲染进 writer prompt（`authoring_task_builder.ex:748-807` `prose_materials`；`novel_common/authoring_semantics.ex:325-329` scope refs、`:396-406` materials 行）；③ 使命材料 refs（`ChapterMissionInputs`） | **需修正**：不是“完全没有 refs”，而是**没有“本次模型调用实际公开给模型的 Base refs 集合”的统一记录与 used refs 对账**。CP1 应做 additive 聚合（9.4），不新造 ref 体系 |
| 7 | Replay 从持久观察重建属 CP3：`replay_service` 无 observation 处理，CP1 不得声称完成 | ReplayService 只从 `DecisionTrace` 构建（`replay_service.ex:16`、`:31` `provider_called: false`），无 observation/evidence 处理；B59 只补 step `DecisionTrace` 持久化（`agent_run_flows/step_trace_persistence.ex:34`、5 flow 接线），**探索步不产生 DecisionTrace**（`judgment_plan.ex:474-538` 不经 TurnExecutionService/Orchestrator，仅 AgentStep+AgentObservation+事件） | **仍成立且更强**：CP1 探索证据只能来自 agent_events/AgentStep/observation；不得把 B59 的 step trace 持久化读作“探索 trace 已就绪” |

### 9.2 旧预研未覆盖的新事实（B40–B61 之后）

1. **契约已就绪，CP1 属于接线而非改契约**：`PlanStep` 已含 `exploration_query`（`novel_domain/agent_plan.ex:30/137`）；`AgentNextStepDecision` 已含 `exploration_query`（`agent_next_step_decision.ex:39/61/116/146`）；planner 已解析该字段（`agentic_plan_draft_planner.ex:382`）。→ CP1 不需要改 domain 契约/schema。
2. **目标集一致靠手工清单成对维护**：planner `plan_step_targets/1` 与 flow `mechanical_execute_decision` 必须一致（注释明示，`agentic_plan_draft_planner.ex:518-521`）；现有测试范式可直接复用（`agent_run_judgment_plan_flow_test.exs:403-431`：计划带 `archive_read` 步 → 内联执行 → author 侧 `exploration_observed` 事件带 tool/query/outcome）。
3. **预算模型已给探索步定价**：`AgentRunBudget.step_cost`（`agent_run_budget.ex:217-239`）explore kind = `1 step / 0 tool / 0 provider`。prose run 生效预算（`dialogue_planning_service.ex:2482-2496` + `plan_overhead_budget` :2424-2431）：`max_steps 6 / tool_calls 3 / provider_calls 11 / replans 1`。**注意** `AgentRun.normalize_budget` 只保留固定键（`agent_run.ex:396-410`），新增 budget 键会被静默丢弃 → 预算分账不能靠改 budget map。
4. **观察可见性已分层**：author stage 事件（`activity_summary`，作者面）与 developer observation 事件（`structured_payload` 含 tool/query/outcome，只进 DB `agent_events`）分开；`AgentObservation.author_safe_summary/1` 丢弃 `structured_payload`（`agent_observation.ex:60-69`），所以 DB step 行/step_attrs 拿不到 outcome/tool/query → 证据必须读 `agent_events.payload` 或 stage 事件 payload。
5. **B61 native harness 已通用化**：`NativeScenarioHarness`/`ensureWorkSelected`（`scripts/lib/native_ui/scenario_driver.mjs:46/644`）、共同证据断言与 summary（`scenario_evidence.mjs:304`/`:391`）；真实 provider 的 `llm-calls` 含完整 request+response+`usage.model`（P1 artifact：18 调用，`response.usage.model=iq3_s`）→ A1/A2 可按 P1 模式实现驱动/证据，不必从零。
6. **B42 证据层已冻结**：`quality-evidence-chain/v1` 必填字段与集合规则（`quality/acceptance/evidence-schema.json` `$defs.evidence_chain`；`scripts/lib/quality/evidence_chain.mjs:1-14`、`:395-556`），release 层反假绿（`release_layer.mjs:159-320`，`DEFAULT_PLANNED_RUNS=2`、timeout 入分母、retention wording、model/actual_model/params 身份）。通用读取 `readArtifactEvidence` 只认 frames 里的 `observation_refs` 数组，不认探索事件 payload、也不产 `base_refs`（`evidence_chain.mjs:852-939`）→ AU-15 必须由场景 verifier 显式构造 `evidence-chain.json`。
7. **当前 registry 状态**：HEAD 下 nightly 203 active + 2 blocked（`au02-candidate-fallback-ui`、`judgment-explore-internal`；B61 §8）；`release`/`release-real-llm` 均 0 场景（`scenarios.yml` 无该 tier），AU-15 尚未注册。工作树 WIP（B63）已把 `judgment-explore-internal` 复跑 PASS（browser-surface）待 Lead 收口，未提交、不属于 HEAD 基线。

### 9.3 CP1 实施切口（设计级，不写代码）

#### 9.3.1 共享探索执行模块的提取边界

- 建议模块：`NovelApplication.AgentRunFlows.ExplorationStep`（application 层纯编排，不新增 agent loop、不新增 agent runtime）。
- 输入：`run`（work_id/session_id）、`tool`、`query`、`sequence`、`signature_namespace`、`target_set`（调用点目录，实现“plan 步 4 工具 / 判断循环 5 工具”分账）、`stage_sink`。
- 内部步骤：target 白名单校验 → `ExplorationService.run/4`（session 作用域，可支持 `session_adoptions`；对齐 `dialogue_planning_service.ex:720-737` 的现有实现，而非 `run/3`）→ 工具失败归一化为 `:failed` 观察（不硬失败 run）→ author-visible `exploration_observed` stage payload（tool/query/refs/summary/outcome/facts + 章续读键，复用 `judgment_plan.ex:544-562` 形状）→ developer `AgentObservation`（structured_payload = `ExplorationService.observation_metadata/1`）→ `AgentStep`（goal=activity、observation_refs）→ `progress_signature`（namespace 由调用点给）。
- 调用点替换：`judgment_plan.ex:474-579`；`dialogue_planning_service.ex:668-718` 与 `:1536-1576`（保留各自 signature 前缀/目标集/会话语义）；prose flow 新增 dispatch 分支（对标 `judgment_plan.ex:957-966`）。
- 明确不做：不合并判断循环 judge 回合到 flow；不把探索变成 Toolbox tool（沿用内联只读 0 调用、不经 Orchestrator gate，与判断循环一致；是否补只读 gate lineage 见 9.7 D5）；不复制第二套 payload 渲染。

#### 9.3.2 planner target/catalog 与机械执行器接受只读探索步

- 成对改 4 处：`prose_drafting_with_quality.ex:369`（含 `@checked_step_targets` :41、`checked_step?` :489）；`agentic_plan_draft_planner.ex:537`（`plan_step_targets`）+ `:766`（`step_catalog`）；新增 flow dispatch 分支（`next_step_from_decision`，对标 `judgment_plan.ex:957-966`）。
- `mechanical_execute_decision` 需把 `exploration_query: map_get(step, :exploration_query)` 传入 decision（prose flow 当前缺；`judgment_plan.ex:240` 已有）。
- 不改：AgentPlan/AgentNextStepDecision 契约（已支持）；profile registry/authority_scope（探索步不经 `plan_from_decision` 的 `allowed_tool?`，与 judgment_plan 现状一致）。
- 测试范式：模仿 `agent_run_judgment_plan_flow_test.exs:403-431`，prose flow 用 4 步（context+explore+mission+prose）断言：explore 步来自模型计划、执行 0 provider 调用、author-visible stage 事件、观察进后续 writer 请求、预算消耗（步数 +1、tool/provider 不增）。

#### 9.3.3 观察如何以 author-safe、带真实 refs 的形式进入使命与 writer

- writer：把 `author_input_text`（`prose_drafting_with_quality.ex:1514-1537`）的观察段从“摘要行”升级为“带回 ref 的 author-safe 观察行”，如 `- [observation:<observation_id>]（tool）摘要（refs: chapter:<uuid>, …）`；观察来源仍限 `snapshot.observations`（不新增持久源）；同时把本次请求的 observation refs 作为 trace meta（9.4 方案 A）。`continuation_observation_block` :226-235 同步加 refs。
- 使命：`mission_inputs`（:870）把本 run 已执行探索观察映射为 `ChapterMissionInputs` additive items（建议 `%{ref: "observation:<observation_id>", group: :observation, text: "<tool/activity> 摘要（refs: …）"}`），复用 `refs/known_ref?/to_prompt_section/bind`（`chapter_mission_inputs.ex:106/109/132`；`chapter_mission.ex:78`；`chapter_mission_service.ex:196`），不动 `ChapterMission` 值对象；没有观察时不生成 item（诚实缺席）。
- 顺序：使命步是否在探索步之后由模型计划顺序决定，CP1 不强制；若模型把使命排在探索前，A1 判据按“writer 请求必须含观察”取证（见 9.5.3）。
- A2 通用性：渲染只依赖 `ExplorationService` 的 tool/query/refs/summary 通用形状，不出现时间/物品等领域分支。

#### 9.3.4 Base refs additive 暴露

- 见 9.4 方案 A：在 writer 请求装配点（`TurnExecutionService`/`AuthoringTaskBuilder` 已持有 `AuthoringTask`）计算本次请求公开 refs，写进既有 trace summary（additive），**不改 prompt 字节**。

#### 9.3.5 预算/续读/no-progress/取消/恢复复用点

- 预算：复用 plan 步预算（explore=1 step/0 tool/0 provider；prose 生效上界见 9.2 #3）。**不新增 budget key**（会被 `AgentRun.normalize_budget` 丢弃）；如需硬上限，用无状态计数：按 `run.plan` 已执行前缀（plan cursor）统计 exploration target 步数，在 flow dispatch 处拒绝超限步（建议 N=2），恢复后可由 plan+cursor 重建。判断循环同款“2 轮 + 8 续读额度”需续读状态，属 CP3（SC-AU15-B2），CP1 不建议。
- 续读：CP1 预注册把前置章控制在单页（≤6000 字符，`ExplorationService` `@chapter_page_chars`），使 A1/A2 无需续读；若模型仍触发多页需求，按既有“未覆盖末页先续读”观察提示行为记录；预算/计划不允许则记失败或未闭环，不伪造读全。
- no-progress：沿用“同 tool+同 query（含 offset）才判重复”语义（`judgment_plan.ex:536`、`dialogue_planning_service.ex:1574`），共享模块由调用点传 namespace（如 `#{run_id}:prose_explore:`），保证跨 flow/跨步不串扰且续读页不误停。
- 取消：复用既有 cancel 语义（`agent_run_server.ex:1520-1529`）；探索只读、无 canon 写入、无迟到写风险；CP1 不新增可中断性保证（内联读不可细粒度取消，同判断循环现状）。
- 恢复：观察只在进程内（9.1 #3），CP1 场景不跨重启、不得声称恢复；从持久观察重建属 CP3（需要产品持久化或从 agent_events 重建）。

#### 9.3.6 A2 通用性约束

- 同一构建/同一契约/同一 target catalog；不得为时间关系新增 CarryRegistry 行、prompt 分支、工具白名单特批（AU-15 §6）。A1/A2 差异只允许在 seed 数据与作者输入措辞，不允许在代码。产品 diff 检查以“A1/A2 同一提交 + 无领域关键字分支”取证。

### 9.4 Base refs 暴露方案对比（仅建议，不改契约文档）

| 维度 | 方案 A：trace 聚合 additive（推荐） | 方案 B：context 组装层统一 | 方案 C：纯外部派生 |
|---|---|---|---|
| 字段形状（建议名，非契约） | trace summary/DecisionTrace additive `base_refs: [String]` + `base_ref_entries: [%{ref, source, version}]`（source ∈ scope/material/context；version 取材料 version 或 nil）+ `request_observation_refs: [String]`；不进入 prompt 文本 | `DialogueContext` 新增 Base refs 快照字段（domain struct 变更） | 无产品字段；verifier 从 `llm-calls` prompt 解析 `- kind：ref`、`- 目标对象 refs：…` 等 token |
| 暴露点 | writer 请求装配点（`TurnExecutionService`/`AuthoringTaskBuilder`）→ `TraceWriter.record_with_tool` meta → trace summary → turn_result/ws 帧/app-log/DB trace | 上下文组装（`ContextAssembler`/`DialogueContext`） | 验收现场解析 artifact |
| 实现成本/风险 | 中低：复用既有 task 结构与 trace 通道；prompt 字节不变 | 高：ContextAssembler 在 task 装配之前、不知道 materials（分层倒置）；context 是 per-turn 非 per-call；domain/契约影响面大（06/VS-00B/VS-00D） | 低：零产品改动；但依赖 prompt 格式稳定，无法产品内复用 |
| 对 I1–I3 | 不动 artifact 字节来源 → I1 不变；I2/I3 无关 | 同左，但 domain 变更需回归更多不变量 | 同左（纯读取） |
| 对 VS-00I（前缀稳定） | prompt 完全不变 | prompt 可能不变，但 envelope 结构变 | prompt 不变 |
| 对契约影响 | 无（后续可建议 VS-00K §4.3/§4.4 additive 登记字段名，CP2 再做） | 需改 domain 契约/文档 | 无 |
| 证据消费 | 场景 verifier 从 turn_result.trace_summary 解析 base_refs/request_observation_refs，配 observations/provider_calls 构 `evidence-chain.json`；B42 `buildEvidenceChain` 无需改 | why 面板可直接读；证据同样可消费 | 只能作为旁证；无产品侧集合 |
| CP2 used refs 校验复用 | 应用层可直接用同一集合校验 | 需跨层取集合 | 不能用于产品内校验 |

- **推荐：A + C 交叉校验。** 理由：① prompt 字节不变，VS-00I/I1 零风险；② Base refs 恰好由“已渲染进 prompt 的 ref”派生（AuthoringTask scope refs + materials refs + 材料版本/覆盖），语义上就是“模型实际可见的 Base”；③ 记录点位于 writer 请求装配处，CP2 的 `used ⊆ Base ∪ observed` 校验可直接复用；④ C 作为独立第二来源对账，避免“产品自证”。B 不推荐用于 CP1（分层倒置 + domain 契约影响大）。
- 边界：以上字段/形状只是 CP1 建议，**不得在 CP1 依据本表改 VS-00K/ADR/schema**；作者裁决后再由 CP2 决定是否入契约。

### 9.5 CP1 真实模型验收预注册草案（校准版；ADR Accepted 后执行，执行前冻结）

#### 9.5.1 模型/资源/驱动

- provider/model：Strata `iq3_s`（作者既有实例），单槽串行。params 从真实请求体记录（strata 当前实测 `stream=true / temperature=0.7 / max_tokens=32000`，以实际请求体为准）；`model` 由 provider 配置决定、`actual_model` 取 `response.usage.model`（P1 实测 `iq3_s`）。
- 不允许：加载第二模型；LM Studio 仅作者 embedding 常驻（IDLE），不得 unload/占用（B28/B29/B37/VS00D-G 资源约定）。
- 生命周期（修正旧预注册）：跑前记录 `lms ps` + 内存 + Strata `/api/models.loaded=null` + `/api/native.instances` 为空（旧预注册只查 `loaded=null`；2026-10-27 P1 收尾发现 `loaded=null` 不代表原生引擎卸载，见 `tasks/slices/VS00D-G-GAP-RECONCILIATION.md` 2026-10-27 收尾记录）；结束（成功/失败/中断）`POST /api/models/unload` → 轮询 `loaded=null` 且 `native.instances=[]`（若存在 ready 实例，需作者授权后按实例卸载，不擅自动全局）；前后写 `model-lifecycle-before.json`/`-after.json`。
- 驱动：真实 Tauri 原生外部系统 UI（`TAURI_NATIVE_SYSTEM_DRIVER=1`、`driver=ax-native-system-ui`），复用 B61 通用 harness（`scenario_driver.mjs:46/644`）与 P1 实模证据核验模式（`native_p1_evidence.mjs:238-350` 生命周期、`:352` prepare、`:1419` main）；新增 `scripts/native_au15_drive.mjs`/`native_au15_evidence.mjs` 与 native allowlist/verify 注册（脚本改动，不改产品）。
- 预算/等待：B37 分型（strata：input120/ack60/turn360/candidate300/adoption180/maintenance300/export120/toc60；restore 30；`scripts/native_ui_wait.mjs:9-11` `budgetsFor`）+ 10s 心跳（`:80-85`）；原指令只发一次、turn 超时不重发；作者提问按 options 推荐项/自由文本默认方向应答 ≤2 次并落 `author_question_events`（复用 `native_p1_drive.mjs:553-604` 模式）。

#### 9.5.2 场景前置与 seed（旧预注册未定，本次新增）

- **SC-AU15-A1 前置**：作品含较早章已采纳正文，正文含一条人物承诺/关系事实（示例“沈砚答应三天后回灯楼接顾青”）；该事实不进任何专用 packet，后续 Base（摘要/携带/提示）不含完整内容，但真实正文可经 `chapter_read/prose_search` 读取。
- **SC-AU15-A2 前置**：两章正文分别含“过了三天”“又过了两周”（示例），后续 Base 不含合计；真实正文可读；结果与累计十七天相容。
- seed 方式（待作者裁决，9.7 D6）：(i) 外部 seed 脚本（fixture，走既有 persistence/采纳同形写入，声明为前置数据，便宜、可控、不引入额外模型行为变量）——推荐；(ii) 真实模型先写并采纳前置章（更贴 AU-15 §5“通过真实创作与采纳”字面，但多一轮实模、增加变量、时间翻倍）。两者都必须证明前置章正文真实可被探索工具读到且未进 Base；独立 run 分母只计测量 run，前置 setup 另存 artifact。
- 前置章长度 ≤6000 字符（单页），承诺/时间表达保留原文；语义相容由作者或作者指定评审裁决（AI 不代签，I10 原则）。

#### 9.5.3 场景、步骤与判据映射

| 场景 | 预注册自然输入（禁工具提示；另冻结 1 种未调词措辞） | 机制证据（自动） | 模型行为证据（真实 run） | 语义裁决 |
|---|---|---|---|---|
| SC-AU15-A0 | 例：“在第02章开头写一段雨夜开场的正文，三百字左右。” | 计划无 explore 步；无 `exploration_observed`；writer 调用发生；零生产写入 | 模型自行选择不探索并直接准备（不是失败） | 候选常规质量（不阻断） |
| SC-AU15-A1 | 例：“写第03章开头：顾青在灯楼等沈砚，把两人之前说好的事接着写。”（不提“查/检索”，不给承诺内容）；保留措辞另注册（例：“第03章开头从顾青等沈砚写起，前情里答应的事要接上。”） | 真实 provider 的 plan draft 响应（`llm-calls`）含 ≥1 个 exploration target 步且 kind=explore；执行产生真实 `exploration_observed`（tool/query/outcome/source_refs 含 `chapter:<uuid>`）；后续 writer 真实请求含该观察的保真投影（摘要串匹配 + observation ref 匹配）；author-visible 活动行/AX 文本可见探索；DB 生产表计数前后一致（采纳前零 canon） | 模型自主选择探索（计划步来自模型响应，app-log `plan_drafted` 与响应一致；APP 不按关键字插步）；未探索直接写→失败（正文碰巧正确不能抵消）；声称已读却无 observation/used refs→失败 | 候选与承诺/关系相容由作者裁决并记录（candidate+refs+裁决） |
| SC-AU15-A2 | 例：“写第03章开头，交代两人上次分别后过了多久。”（不提“查”） | 同 A1（两章来源可读、observed refs 含两章；writer 请求含观察）；产品 diff 无时间专用分支（A1/A2 同一构建 + diff 检查） | 模型自主读取所需来源并在后续请求使用观察 | 结果天数与“三天+两周”累计相容由作者裁决 |

- 判据分层：机制证据（确定性断言）／模型行为证据（真实 provider 请求与响应、真实运行）／语义与文学（作者或指定评审）。三者分开报告，不互相代签（AU-15 §2）。
- A0 为“不强制探索”场景：零 explore 步是成功信号，不得因“零工具调用”判失败。
- A1/A2 的模型行为前提有相邻证据但不等价：P1 native strata（2026-10-26）真实模型在判断循环自主选择 `chapter_read` 探索且观察进入下一判断请求；但 prose run 目录尚不含探索目标，仍须在 CP1 接线后验证“模型会在 prose 计划里排 explore 步”。

#### 9.5.4 重复、失败分母、保留措辞与禁答集

- 重复：A1、A2 关键缺事实场景各 ≥2 次独立 run（B42 §6.2；`release_layer.mjs` `DEFAULT_PLANNED_RUNS["release-real-llm"]=2`）。
- 分母：planned=2 per scenario；timeout/格式失败/中断计入 attempted/failed，不得排除；同一 run 内重试 ≠ 第二次独立运行；失败 artifact 只读保留（`writeEvidenceChain` 拒绝覆盖旧证据，`evidence_chain.mjs:941-953`）。
- 保留措辞：每个关键场景 ≥1 种未参与调词的措辞，记录 `retention_wording{text, ref, tuned:false}`（`release_layer.mjs:236-245`）。
- 禁答集（预注册，不得出现/不得声称）：A1 不得声称“已核对/已读前文”而无对应观察；`used_context_refs` 不得填未观察 ref（CP2 机械抓，CP1 记录对账）；A2 不得断言与累计天数矛盾的时长、不得声称“全部前文已读”而只读一章；任何场景不得由产品/驱动预写答案事实（DB 生产表计数 + 观察来源核对）。

#### 9.5.5 证据目录与字段清单（对齐 B42 `evidence_schema`）

- 目录（每次独立 run 一个目录，只增不删；`<run>` = `a0-run1`、`a1-run1`、`a1-run2`、`a2-run1`、`a2-run2`）：
  - `artifacts/slice-verify/au15-<run>-tauri-native/`
  - 批目录 `artifacts/quality-accept/batches/<batch>/batch.json` + `release-layer.json`
- 每 run 目录必备：`summary.json`（driver/surface/provider/model/checks/git_head）、`native-run-manifest.json`（B42 CP3）、`evidence-chain.json`（B42 CP2，含全部必填字段）、`verdict.json`、`native-driver-ready.json`/`native-ui-complete.json`、AX dump/截图、`native-transport.jsonl`+`native-ws-frames.json`、`app-log/`、`llm-calls/`、`database/` 只读快照、`wait-events.jsonl`/`wait-stats.json`/`heartbeat.jsonl`、`model-lifecycle-before.json`/`-after.json`、`real-model-proof.json`/`native-evidence.json`、`retention-wording.json`、`attempts.json`、`natural-input.txt`。
- `quality-evidence-chain/v1` 字段来源映射：

| 字段 | 当前来源 | 状态 |
|---|---|---|
| `base_refs` / `base_ref_entries` | 产品无统一集合（9.1 #6） | **缺**；CP1 方案 A 补，否则 `base_refs_status=unknown` → 不能 PASS |
| `observations[].tool/query/outcome` | author stage `exploration_observed` payload / DB `agent_events.payload` | 有（需场景 verifier 显式读取，通用读取不认） |
| `observations[].source_refs` | observation `refs`（如 `chapter:<uuid>`） | 有 |
| `observations[].source_revision` | 无版本字段 | **缺**（`unknown`） |
| `observations[].coverage` | `facts`/`next_offset`/`prose_range` 可映射（chapter_read 页覆盖）；archive/prose_search 需定义映射 | **部分缺**（verifier 映射规则 + 产品字段均可补，CP1 至少记录 unknown） |
| `observations[].observed_at/run_ref/turn_ref` | 事件时间/run/turn | 有 |
| `observations[].observed_in_calls` | 由 verifier 链接 | 可生成 |
| `observation_refs`（顶层）/ `observation_to_provider_call` | 由 observations + provider_calls 派生（显式 ref 链接或时间顺序） | 可生成 |
| `used_context_refs` | turn_result `tool_result.output.self_report`（模型返回时；P1 实测有） | 有（捕获点），无产品校验（CP2） |
| `provider_calls` | 真实 `llm-calls`（request/response/step/turn_id/provider/`usage.model`） | 有（verifier 组装；`actual_model` 需从 `usage.model` 映射，通用 reader 取 `response.model=strata`） |
| `provider_calls[].request_observation_refs` | writer prompt 当前无 observation refs | **缺**；CP1 注入 refs 后可解析 |
| `preparation_outcome` | 无准备判断（CP2） | **缺**（CP1 记 `unknown`） |
| `stale_on_restore` | CP1 不重启 | 记 `unknown`（不伪造 none） |
| `replay_provider_called` | 不跑 replay | 记 `false`（机制可证） |
| `binding` | 由上述集合/顺序规则派生（`evaluateEvidenceChain`） | 依赖缺字段结果 |
| 身份/重复/措辞/params | summary + real-model-proof + llm-calls request body | 有 |

- 诚实边界：缺字段只能记 `unknown`/`partial`，**不得补写**；CP1 先落产品侧 `base_refs`/`request_observation_refs`，其余缺口显式登记给 CP2/CP3。

#### 9.5.6 结果分层与预期状态（预注册校准要点）

- 机制层：必须 PASS（探索步计划/执行/观察/后续请求/零 canon）。
- 模型行为层：A1/A2 ≥2 独立 run 全过才 `pass`；确定性替身/APP 插步不得 `pass`。
- release-real-llm tier：以 B42 release layer 判定（evidence_chain + native_run + repeats + retention + params/model identity）；CP1 若无 `base_refs`/`request_observation_refs`，binding 最多 partial/unknown → 很可能 `evidence_missing`，**不得降级成 PASS**。
- 旧预注册未区分“语义相容由作者裁决”；本次校准：机制/模型行为由证据判定，语义相容（承诺、天数）由作者或指定评审裁决记录，不由自动分代签（I10 原则）。

### 9.6 B59/B61（及 B40–B42）对旧预注册假设的影响

| 旧假设（§8.4） | 当前变化 | 对预注册的修订 |
|---|---|---|
| 原生 Tauri 外部系统 UI 驱动 + 真实模型（能力待建） | B61 已建通用 native harness（`scenario_driver.mjs`/`scenario_evidence.mjs`/`native_ui_wait.mjs`） | A1/A2 驱动可按 B61+P1 模式实现；仍需新增 AU15 allowlist/verify 注册 |
| 证据目录含 llm-calls 真实 provider 请求体 | 真实 provider llm-calls 已含完整 request+response+`usage.model`（P1 实测）；B42 另要求 evidence-chain/native-run-manifest/release-layer | 证据清单扩展 B42 sidecars 与身份字段；观察 refs 需进 prompt 才能成 `request_observation_refs` |
| “B59 step trace 持久化已落”（任务语境） | B59 只覆盖 tool/act 步（5 flow + prose 自有路径）；**探索步无 DecisionTrace**（内联只读，不经 TurnExecutionService/Orchestrator） | 探索证据用 agent_events/AgentStep/observation；不得把 B59 读作探索 trace 就绪 |
| B61 native 5/5 | HEAD registry = 203 active + 2 blocked（`au02-candidate-fallback-ui`、`judgment-explore-internal`）；WIP B63 已复跑 judgment-explore-internal PASS（browser-surface）待 Lead 收口 | 预注册应写“B61 harness 已通用化、AU15 待注册”，不得把 judgment-explore-* 浏览器 PASS 当 A1 原生证据 |
| 关键缺事实场景 ≥2 次全过 | B42 已冻结为 release layer 规则（`DEFAULT_PLANNED_RUNS=2`、timeout 入分母、禁重试洗分母） | 预注册按 B42 字段/语义写，不另立通过线 |
| 真实模型在 Base 不含答案时主动探索 | **已有相邻真实证据**：P1 native strata/iq3_s（2026-10-26）判断循环 2 次自主 `action=explore`（`explore_request.chapter_read`，`llm-calls` 第 0 次调用），随后判断请求包含该观察（第 1 次调用 prompt 含【正文】/已检索/chapter_read），见 `artifacts/slice-verify/p1-chapter-draft-generation-native/run/llm-calls/2026-10-27.jsonl`。但这是**判断循环**、非 prose run、非 AU-15 场景；另有 2026-07-20 lmstudio judgment-explore 失败于模型把引用词加引号检索→0 命中（B63 §5.2 恢复参考） | A1 的模型行为前提风险下降但未消除（prose profile 目录尚未开放探索）；A1/A2 仍把“查询质量失败”归类为模型行为失败并保留证据；建议接线后先做 ≤2 次低成本探针（不计入验收分母，待作者授权） |
| B37 分型预算（input120/turn360/candidate300/adoption180/maintenance300/restore30）+10s 心跳 | B37 已落 `budgetsFor`（`native_ui_wait.mjs:9-11`）；P1 实模 35 waits/0 timeout | 预算表述保留，补 typed ledger/失败首因/超时不重发 |
| LM Studio 仅作者 embedding 不可用 | 仍成立（B28/B29/B37/VS00D-G：作者 LM embedding IDLE 常驻，不占用/不卸载） | 单槽真实模型只走 Strata；生命周期核验加 `/api/native.instances` |

### 9.7 开放决策清单（给作者；每项：选项 + 推荐 + 影响）

| 决策 | 选项 | 推荐 | 影响 |
|---|---|---|---|
| **D1 Base refs 字段形状与暴露点** | (A) trace 聚合 additive（`base_refs`/`base_ref_entries`/`request_observation_refs`）；(B) context 组装层统一（DialogueContext 新字段）；(C) 纯外部 verifier 派生 | **A + C 交叉校验**（9.4） | prompt 字节不变、I1/VS-00I 零风险；CP2 可复用同一集合；不改契约（后续 additive 登记建议） |
| **D2 prose run 探索预算/分账** | (a) 复用 plan 步预算 + 无状态硬上限（建议 2，按 plan+cursor 计数）；(b) 判断循环同款 2 轮+8 续读额度（需续读状态，CP3）；(c) 新增 budget 字段（`AgentRun.normalize_budget` 会丢弃，需改契约） | **(a)** | 决定单 run 可探索步数/A1–A2 可行性/重启后预算可重建；续读留 CP3 |
| **D3 CP1 准备判断最小边界** | (i) 无准备判断，仅记录 exploration→writer 机械过渡（preparation_outcome=unknown）；(ii) 机械过渡记为 ready（需作者确认不构成语义代签）；(iii) CP1 内实现最小准备判断 | **(i)**，并把 (ii)/(iii) 留 CP2 | 决定 release tier 证据链 blocker 与“CP1 是否可能 PASS” |
| **D4 release tier 判定口径** | (a) 只有 binding=verified 且字段齐全才 PASS（最严，CP1 大概率 evidence_missing，等 CP2）；(b) 允许 binding=partial + blockers 显式登记后 PASS（当前 release_layer 代码允许 partial，需作者确认）；(c) CP1 只出“机制+模型行为观察”报告，不写 tier PASS | **(c) 或 (b)**，由作者裁决 | 决定 B42 CP4 结果定性、NEXT/台账措辞；不得把部分证据写成 PASS |
| **D5 探索步 gate/lineage** | (a) 保持内联只读旁路（同判断循环现状）；(b) 给只读探索加轻量 gate + 逐门 lineage/ToolTrace | **(a) CP1**；(b) 留 CP3/契约讨论 | 影响证据完整度（ToolTrace 不是探索证据来源）与实现风险 |
| **D6 A1/A2 前置 seed 方式** | (i) 外部 seed 脚本写已采纳正文（fixture，声明前置数据）；(ii) 真实模型先写并采纳前置章 | **(i)** | 决定实模 run 数/时长/变量；两种都必须证明前置正文可探索且未进 Base |
| **D7 观察 ref 是否显式进 writer prompt + used refs 词表说明** | (i) 仅 refs 行（最小）；(ii) 加一句“used_context_refs 只能引用材料/观察中列出的 ref”（改 prompt 动态段，需 VS-00I 检查）；(iii) 都不做（证据只能时间顺序链接） | **(i)**，(ii) 视作者对证据质量要求 | 决定 `request_observation_refs` 可解析性、self_report 证据质量与 prompt 改动范围 |

### 9.8 本轮验证、未闭环与恢复

- 本轮只做只读核对（git/代码/quality schema 与脚本/历史 artifacts），并写本节与独立报告；**未运行产品、验收、Tauri、真实模型或长跑，未改产品/契约/ADR/验收文档，未 commit**。
- 未闭环（不得读作完成）：CP1 未开工（ADR-0030 Proposed）；SC-AU15 未注册（release tier 仍 0 场景）；本轮未运行真实模型；无 native AU-15 证据；历史 P1 native 实模证据存在（判断循环探索），但不能替代 CP1 未接线与 AU-15 未注册；`judgment-explore-internal`/B62/B63 相关 WIP 属其他任务，不作为本任务证据。
- ADR Accepted 后的建议开工顺序：① 作者裁决 9.7 D1–D7 → ② CP1 接线（9.3）+ 机制测试 → ③ 登记 AU15 场景/driver/verifier（draft 先永不执行，真实 PASS 后按证据改 active）→ ④ 低成本探针（授权后，不计分母）→ ⑤ A0/A1/A2 ≥2 独立 run + B42 sidecars → ⑥ B42 CP4 结果层判定 → ⑦ 按 tasks/README 更新状态/台账。
- 恢复指引：先读本节 + §8.4 + `artifacts/completion-audit/2026-10-28-b39-cp1-preread/report.md` + B42 §6/§10/§11 + AU-15；不要从历史 p1/agentic-loop 证据推断 AU-15 已通过。
