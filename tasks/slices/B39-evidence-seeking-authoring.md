# B39：求证式创作——最小供给、Run 级探索与证据闭环

- 状态：**doing（CP0 元原则落地对账完成；CP1 待 ADR-0030 Accepted，未进入产品实现）**。
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
