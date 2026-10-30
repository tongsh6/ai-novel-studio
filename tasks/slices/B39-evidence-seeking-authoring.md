# B39：求证式创作——最小供给、Run 级探索与证据闭环

- 状态：**doing（2026-10-30 CP1 开工；作者已正式接受 ADR-0030/VS-00K/AU-15；CP1a 只读探索步+观察进 writer、CP1b 观察 refs 进使命与 writer 材料、CP1c used refs 校验/逐调用 trace 已落地；最小准备判断与 A0/A1/A2、实模证据未完成；CP1–CP4 不得整体标 done）**。
- 登记日期：2026-10-27；来源：作者指出持续增加 APP 主动投喂只会不断补漏洞，要求先把元原则深化到全部承重设计，而非先做时间线专用设计。
- 上游：[00 §2.4](../../docs/design/00-vision-and-engineering-roadmap.md#24-创作信息获取元原则最小供给按需求证证据闭环2026-10-27-用户拍板)、[ADR-0030](../../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md)、[VS-00K](../../docs/design/contracts/VS-00K-evidence-seeking-authoring-contract-pack.md)、[AU-15](../../docs/design/acceptance/author/AU-15-evidence-seeking-authoring.md)。
- 当前可依已接受基线进入 CP1 设计与实现；本会话继续逐项作者裁决，尚未启动产品施工或实模运行。执行与资源边界见 §9.7.17。

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

1. **Contract**：消费 00 §2.4、ADR-0021/0022/0023/0025、VS-00C、VS-00E、UA-01 与既有 ExplorationService；消费已接受的 ADR-0030 与 VS-00K，区分 Base、Requested Observation、Preparation Decision、Evidence Usage；接受不代替对应 CP 的实际实现与验证。
2. **Invariant**：已接受但尚未全部落实的设计不变量 #20–#23——非 Base 作品知识必须能追到真实观察；used_context_refs ⊆ Base refs ∪ 实际观察 refs；求证有界、只读、可恢复且不直接写 canon；通用场景不得依赖领域专用 prompt 分支。I1/I2/I3、N-NARR、作者采纳与 Orchestrator 门禁不变。
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
| CP1 | 正文 run 开放现有只读探索；共享判断循环探索执行，观察进入使命与 writer；保留现有携带，不新建时间表；首个完整用户场景具备必要的最小准备判断；完成 SC-AU15-A0/A1/A2，确定性机制与真实模型行为分层取证 | **doing（CP1a+CP1b+CP1c checkpoint 2026-10-30）**：共享只读探索步 → 观察进使命/writer 材料；`EvidenceUsage` 纯校验 used refs ⊆ 当次请求 Base∪实际观察，越界只记 trace unbound、不改 artifact 字节；trace summary additive 记录 request_base_refs/request_observation_refs/used/unbound/provider_call_ref（partial 语义）。**未完成**：最小准备判断（D3-A）、SC-AU15-A0/A1/A2 driver/verifier/registry 与真实模型行为分层证据、外部请求字节交叉核对/B42 provider_calls 字段、dialogue 内联探索迁移；不得以 checkpoint 代签 CP1/AU-15 |
| CP2 | 写前准备可返回通用信息缺口并触发有界 plan revision；建立 Base/观察 refs 与 used_context_refs 对账；明确“可先求证”与“只能由作者裁决”的 clarification 边界；未知、歧义、冲突与越界引用完成 SC-AU15-B1/C1 | 未开工 |
| CP3 | 规划、修订、写后质量与恢复复用同一求证链；完成 SC-AU15-B2/C2；真实 provider 请求、trace、replay 与作者可见证据一致 | 未开工 |
| CP4 | 依据真实 run 的引用、重复查询和质量证据逐块迁移固定携带；领域读模型（包括是否需要时间线）按真实缺口单独立项；完成 SC-AU15-D1 | 未开工 |

CP1 只是执行 checkpoint，不能替代本任务“规划/正文/修订＋准备/写后复核＋恢复”的完整闭环；CP1 通过不得把 B39 标 done。

### 4.1 求证不变量的 CP 与证据承接

2026-10-30 补齐 [VS-00K §5–§6](../../docs/design/contracts/VS-00K-evidence-seeking-authoring-contract-pack.md#5-已接受的设计不变量00c-2023运行时与-ci-待落实) 与 [ADR-0030 enforcement_gaps](../../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md#enforcement_gaps) 已要求的落实后果。下表属于原 CP1–CP4 完整验收，不增设平行求证任务、不改变 #20–#23 含义，也不表示任何新不变量已进入 CI。

| 已接受不变量 | CP 承接 | 运行时/场景证明 | 工程门禁与分层边界 |
|---|---|---|---|
| #20 观察因果 | CP1 首个正文真实消费者；CP3 扩至规划/修订/质量及恢复 | 同一次实际请求的 Base、真实观察、来源/版本/覆盖与后续请求对账；拒绝把未送达请求的 ref 当已见证据 | 先在 AU-15 verifier 接 B42 同源证据，按已接线消费者固化确定性因果正反例；真实模型自主选择探索另由 AU-15/B42 实模层证明 |
| #21 引用真实 | CP2 集合校验；CP3 恢复/回放；CP4 迁移回归 | used refs 不越出 Base∪实际观察；未读/错误来源必须留 unbound/未知处置，原 artifact 字节不被修补 | 注入越界引用、缺来源和历史缺字段的负例进入机制检查；引用存在不能代签模型理解或语义正确 |
| #22 求证有界 | CP1 权限/预算/取消/no-progress；CP3 跨重启与 stale | 禁止未授权 dispatch/canon 写入；保留真实预算与观察，恢复重新核版本，replay 不调模型 | 复用现有运行边界、故障与恢复测试，随相应 CP 接入确定性检查；本项不替运行资源授权，不放宽 I1–I3 |
| #23 通用求证与诚实缺口 | CP1 Base 负控制与首场景；CP2 未知/冲突；CP3 第二消费者；CP4 固定携带迁移 | 两个不同要素共用同一产品链，Base 足够不强制探索，未知/未读/冲突不伪报完成 | 机制复用与诚实失败可确定性检查；自主行为、保留措辞与独立重复按 AU-15/B42 实模层，不用 stub 或静态扫描代签 |

每个 CP 收尾须登记该行已实现的 producer/consumer、verifier/测试入口、对应 quality 运行入口及证据，未覆盖范围继续开放。先由实际场景证明，再把稳定且可确定性复现的规则固化为 I-EVIDENCE 族，接入现有 `docs/engineering/scenario-invariants.md`、`quality/` 与 CI；具体 driver/命名与接入点在对应 CP 内明确，不在本次规划中虚构已存在的脚本或提前冻结新字段/阈值。CP4 整体收口必须回查该映射，不能以场景局部 PASS 漏掉工程门禁后果。

常规 CI 负责可重复的机制不变量；真实模型样本、资源窗口和独立运行仍按 release-real-llm/实际验收安排，文学结论仍归 I10。B42 消费并校验同源证据，不替 B39 实现产品守卫，也不另建同义验证规则。

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
- ADR-0030 已于 2026-10-29 Accepted；以 §9.7.17 和三份已接受文档恢复，不从早期 Proposed 预研段推断仍有作者决策阻塞。
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
- 顺序：计划顺序由模型提出；当本轮使命依赖探索所得事实时，必须证明观察进入使命与 writer（或使命基于观察重建），不能只证明 writer 收到摘要便缩掉 §6 的使命消费要求。模型错排导致使命未消费观察，应记录缺口/失败；有界准备与 replan 的完整机制仍由 CP2 承接，APP 不按领域关键词插步。
- A2 通用性：渲染只依赖 `ExplorationService` 的 tool/query/refs/summary 通用形状，不出现时间/物品等领域分支。

#### 9.3.4 Base refs additive 暴露

- 见 9.4 方案 A：在 writer 请求装配点（`TurnExecutionService`/`AuthoringTaskBuilder` 已持有 `AuthoringTask`）计算本次请求公开 refs，写进既有 trace summary（additive），**不改 prompt 字节**。

#### 9.3.5 预算/续读/no-progress/取消/恢复复用点

- 预算：复用 plan 步预算（explore=1 step/0 tool/0 provider；prose 生效上界见 9.2 #3）。**不新增 budget key**（会被 `AgentRun.normalize_budget` 丢弃）；如需硬上限，建议初始 N=2，但必须按本 run 累计已执行探索计数；仅当前 plan+cursor 不能证明跨 replan 不重置。CP1 先核现有步骤/计划历史是否足以重建，覆盖 replan 累计上限；跨重启恢复归 CP3，不在 CP1 代签。无法复用时先补预算方案，不新增会被丢弃的键，也不放开上限。判断循环同款“2 轮 + 8 续读额度”需续读状态，属 CP3（SC-AU15-B2），CP1 不建议。
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
| 实现成本/风险 | 复用既有 task 与 trace，但 refs 必须与最终请求内容同源，不能另算一份日志清单 | 现有 ContextAssembler 早于后续 task 材料装配；Context 可在 run/step 中重新组装，不能笼统称每轮只有一份。若 B 指最终逐调用快照，则是可评估方案，需明确职责与契约，成本不能仅凭复用 Context 判断 | 零产品字段改动；但依赖请求格式，无法独立提供产品内引用核验 |
| 对 I1–I3 | 不动 artifact 字节来源 → I1 不变；I2/I3 无关 | 同左，但 domain 变更需回归更多不变量 | 同左（纯读取） |
| 对 VS-00I（前缀稳定） | prompt 完全不变 | prompt 可能不变，但 envelope 结构变 | prompt 不变 |
| 对契约影响 | additive 仍有契约影响：实施前在 VS-00K 明确字段、来源类别、版本/unknown、逐 provider call 绑定和真实 trace/replay 消费者 | 需改 domain 契约/文档 | 无产品字段，但须冻结外部解析规则 |
| 证据消费 | 场景 verifier 从 turn_result.trace_summary 解析 base_refs/request_observation_refs，配 observations/provider_calls 构 `evidence-chain.json`；B42 `buildEvidenceChain` 无需改 | why 面板可直接读；证据同样可消费 | 只能作为旁证；无产品侧集合 |
| CP2 used refs 校验复用 | 应用层可直接用同一集合校验 | 需跨层取集合 | 不能用于产品内校验 |

- **推荐：A + C 交叉校验。** 每个 provider call 单独记录，按实际渲染内容区分 Base 与 Requested Observation；不能把观察进入 materials 后重新算作 Base。D1 的 trace 记录本身不改 prompt，D7 的观察渲染则会改变动态段，二者分别验证 VS-00I/I1。字段同时服务产品 trace/replay 与 CP2 引用核验，不能是只有验收脚本消费的隐藏 metadata。外部真实请求解析提供第二来源；不能仅从 task 对象推断模型实际看见的材料。仅在现有 ContextAssembler 阶段附加全量 refs 不能解决后续材料与观察的核验；若 B 指最终逐调用快照，则应评估，见 §9.7.3。
- 边界：以上字段/形状仍是建议。本次不改 VS-00K/ADR/schema；作者裁决后、CP1 实施前登记新增字段的契约与消费者，不能先加生产字段再以“additive 无影响”为由把登记推迟到 CP2。

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
- seed 方式（待作者裁决，9.7 D6）：正式 AU-15 推荐 (ii) 真实模型先写并由外部 UI 驱动采纳前置章，遵守 AU-15 §5 现有要求；(i) fixture 仅用于机制测试/探针。若正式验收改用 fixture，须先明确修订 AU-15 前置要求，不能把“同形写入”当作真实创作采纳已验。两种路径均须证明正文可探索且未进 Base；setup 与测量分开保存，冻结独立 run 数和失败分母。
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
| `replay_provider_called` | CP1 不跑 replay | **未执行不能当作已验 false**；由 B42 §12 明确未运行/不适用与字段兼容，CP3 才证明回放不调用模型 |
| `binding` | 由上述集合/顺序规则派生（`evaluateEvidenceChain`） | 依赖缺字段结果 |
| 身份/重复/措辞/params | summary + real-model-proof + llm-calls request body | 有 |

- 诚实边界：缺字段只能记 `unknown`/`partial`，**不得补写**；CP1 先落产品侧 `base_refs`/`request_observation_refs`，其余缺口显式登记给 CP2/CP3。

#### 9.5.6 结果分层与预期状态（预注册校准要点）

- 机制层：必须 PASS（探索步计划/执行/观察/后续请求/零 canon）。
- 模型行为层：A1/A2 ≥2 独立 run 全过才 `pass`；确定性替身/APP 插步不得 `pass`。
- release-real-llm tier：须先完成 B42 §12 证据完整性回补，再按场景必需证据判定。CP1 的准备/恢复等未覆盖后果继续开放，仅出机制与模型行为观察报告；缺必需证据应为 `evidence_missing`，不得因当前函数接受 partial 而写 PASS。A0 未证明 ready/missing 区分时，也不能以零探索步替代完整 A0 验收。
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
| **D1 实际请求的同源材料证据** | 原 A/B/C 为实现比较，已收敛为产品约束 | 作者确认见 §9.7.4；逐调用、内容/引用同源、Base/Observation 分账，trace/replay/校验复用 | 优先复用 Context/AuthoringTask/Observation；具体存放位置由实施评估，不预建独立系统 |
| **D2 资料不足与预算耗尽的处理** | 已确认产品选项 A，记录见 §9.7.6 | 额度内自主求证，不足时保留进度与缺口，由作者追加或停止 | 复用 run 总预算和恢复入口；次数不凭空冻结，实现及恢复证据仍待完成 |
| **D3 关键事实未核清时是否继续写作** | 已确认 A，记录见 §9.7.8 | 关键既有事实未核清时默认求证/询问，不把查过资料当准备就绪 | 不要求新创意有旧来源；作者明确要求假设试写仍按其意图与 policy 处理 |
| **D4 局部进度与正式验收口径** | 已确认分层口径，记录见 §9.7.10 | 允许分阶段推进与汇报，严格限定每个通过结论的范围 | CP/场景/完整 B39/文学收益分别成立；必需证据缺失不得 PASS |
| **D5 只读探索的授权与执行边界** | 已确认产品约束，记录见 §9.7.12 | 授权范围内自主查询，执行前自动校验，取消后不再派发，结果不直接写 canon，过程可追溯 | 复用现有探索链并补缺口；是否独立 gate 由工程评估，不增加逐次批准负担 |
| **D6 正式验收前置章节来源** | 已确认 A，记录见 §9.7.14 | 正式验收真实创作并经页面采纳；日常机制测试/调试可用隔离预置数据 | 保存前置来源与采纳证据，setup/测量分账；后续求证仍需独立证明 |
| **D7 查询结果对写作模型的来源表达** | 已确认内容、来源和引用规则同批提供，记录见 §9.7.16 | 实际请求中辨认材料来历与证据边界；复用 D1 同一材料源和已有规则 | 收到、声称使用、引用合法、语义正确分别核验；不要求正文每句带技术引用 |

**2026-10-28 评审补充（尚未生效）**：上表更新的是 AI 推荐与事实边界，作者未逐项选定，ADR-0030/VS-00K/AU-15 仍 Proposed。D1/D2/D7 中字段形状、预算初值等属于需验证的工程方案；作者主要确认产品边界与完整验收口径，不能以实现方便降低契约。作者裁决后记录选择、日期及承接 CP；未选项继续 blocked。

### 9.7.1 2026-10-29 裁决前事实刷新

- 逐项讨论见 [裁决包 C01](../2026-10-27-design-to-execution-reconciliation.md#102-c01求证式创作路线与实施边界)。元原则已拍板；本轮只审具体实施路线和 D1–D7，不将“同意路线”扩成全部子项或实模窗口授权。
- [B42 §12](B42-model-behavior-evidence-tier.md#12-证据完整性回补2026-10-29-done) 已有 2026-10-29 完整性回补记录：按运行前声明的必需维度重算、区分 replay 未执行并传播缺证据原因。§9.2/§9.5/§9.7 中“基建待补、当前 partial 可 PASS”属于 10-28 基线；后续预注册须读取 B42 当前契约，不能复用旧假设。
- D4 当前实际取舍是“先报告 CP1 局部证据”或“等完整场景证据后再给正式 PASS”；旧 b（缺必需证据仍 PASS）不再作为可接受选项。AU-15 本来要求的维度不得为通过而改为 not_applicable，A0 的 ready/missing 语义与完整 CP 责任保留。
- 原生/实模 AU-15 尚未由 B42 基建代验；本轮未接受 ADR-0030，也未实现 B39。

### 9.7.2 C01 路线裁决记录

- 日期：2026-10-29；来源：本聊天在明确展示 C01 的 A/B/C 选项及“只确认路线、随后逐项处理 D1–D7”边界后，作者回复原文 **“A”**。
- 已生效选择：**C01-A**（对应 ADR-0030 提案方案 C）。系统提供必要底座，模型通过现有 AgentRun 按需读取作品事实，观察进入使命与写作，保留可核对的来源；后续沿既定 CP1–CP4 推进。
- 效力：路线取舍已确定，可以据此继续契约收口与子项评审。作者未另附理由；不把 AI 的推荐理由写成作者原话。
- 本次路线选择未覆盖 D1–D7；后续子项结果分别见本任务裁决记录。ADR-0030/VS-00K/AU-15 仍 Proposed，完成相应选择和接受手续后才解除产品实施前置；本项不包含其他 C 项、真实模型资源窗口或历史数据写入授权。
- 执行后果：不重选元原则，不引入第二运行时，不一次性删除现有携带。本轮仅记录选择，没有代码、schema 或产品验收变更。

### 9.7.3 D1 方案含义澄清

- 2026-10-29 作者询问“为什么不建议选 B？”，这是评审问题，当时未形成 D1 选择；后续产品约束裁决见 §9.7.4。
- 只读核对：`ContextAssembler.assemble_for_input/4` 先收集工作/会话等材料和 context_refs；`TurnExecutionService` 随后组装专业材料、execution brief 和 AuthoringTask；prose flow 的 `context_for_run` 可重新组装 Context，观察又在 `author_input_text` 单独合入。因此“Context 固定每轮一份”不准确，实际问题是现有 Context 的职责和组装位置尚不能代表最终每次 provider 请求。
- 原 B“在现有 DialogueContext 组装层加全量 refs”与“统一每次调用的上下文快照”须分开。后者可行：在最终请求装配处让内容与引用清单同源，保留逐调用、不可变、Base/Observation 分账；trace/replay 只消费该快照，外部真实请求独立复核。
- D1 的核心取舍是单一证据来源与逐调用粒度，不应让作者凭对象名决定工程分层。A 若另造一套与请求内容分离的 trace 清单，同样不合格；B 若采用逐调用快照，不应仅因名字是 Context 而排除。是否复用 DialogueContext 或使用轻量请求快照，由 CP1 根据真实消费者、契约和最小改动评估；尚不授权新增抽象或修改产品。

### 9.7.4 D1 产品约束裁决记录

- 日期：2026-10-29；来源：本聊天明确提出“每次模型调用实际收到的材料，必须有同源、可追溯、可核验的记录”，说明替代原 A/B/C 存放位置选择后，作者回复原文 **“好 继续”**。
- 已生效约束：逐次真实模型调用区分 APP 主动供给与模型请求观察；内容和来源清单同源生成；trace、回放、后续引用校验复用同一事实来源；用实际请求核对交接，收到材料不冒充正确使用。
- 实施原则：优先复用 Context、AuthoringTask、Observation。是否需要额外快照结构，由真实消费者、契约与最小改动评估；不预先批准新上下文系统、新表或全量 prompt 存档。
- 完成后果：本项作为 B39 主链的输入与证据约束实施；不能把单独增加日志/快照当作正文自主求证完成。引用使用校验、恢复等仍按 CP2/CP3 实现与验收。
- 该次 D1 选择未覆盖 D2–D7；后续逐项结果见各自裁决记录。该次未修改 ADR 状态、产品代码或 schema，未启动真实模型。

### 9.7.5 D2 产品决策材料

- 状态：**done（D2 产品取舍已确认，裁决见 §9.7.6；仅指决策闭合，产品实施与验收未完成）**。
- 场景：作者要求承接前文，AI 查到一部分资料后仍需读取更多章节或续页，但当前 run 的资源额度已不足。要决定的是此时如何交还控制权，而不是让作者选择 budget 字段名或未经测量的次数。
- 当前可复用：AgentRun 已有步骤/工具/模型调用/replan 的总预算；AgentRunServer 已有 `plan_budget_shortfall`、awaiting_author 和追加步骤的恢复动作。正文求证与这些能力的完整接线仍待 B39，不能把入口存在当作探索恢复已验。

| 产品选项 | 推荐 | 影响 |
|---|---|---|
| **A：额度内自主求证；耗尽后保留进度、说明缺口，由作者追加或停止** | **推荐** | 常规只读查询不逐次打断作者，运行不会自行扩大授权；需接通观察保留、预算恢复及作者可见反馈。查不到或无法消歧可更早提问，不必耗完额度 |
| B：到限后交付本轮已经形成的受限结果，明确未完成与未核实部分 | 有条件备选 | 减少等待，但可能不满足原目标；只有 profile/MissingPolicy 允许时采用，没有结果不伪造。新生成调用必须仍有预留额度，不能突破总预算；关键事实不足不能被虚构成已确认事实 |
| C：到限终止本次任务，需重新发起请求 | 不优先推荐 | 终止语义较简单，但作者负担与重复查询可能增加；不能伪称支持同 run 恢复 |

工程方案仍优先复用既有 run 总账；探索与合法续读按真实消耗计入，replan 不重置已用额度，重复无进展须停止。旧“2 次探索”只是早期初值建议，不是作者冻结上限；默认额度和预留写作空间由真实场景、资源限制与测量论证。跨重启恢复仍归 CP3，不在 CP1 代签。下表保留裁决前选项；选择见 §9.7.6，本次记录不改变现有预算行为。

### 9.7.6 D2 裁决记录

- 日期：2026-10-29；来源：本聊天展示 D2 的 A/B/C 产品选项，并推荐“保留进度，说明已查内容与剩余缺口，由作者追加额度或停止”后，作者回复原文 **“同意推荐”**。
- 已生效选择：**D2-A**。额度内自主求证，不逐次打断；当前额度不足以继续时保留进度、已查材料和缺口，进入作者决策，由作者追加或停止；不能自行扩大资源授权。
- 边界：查不到或无法消歧可提前询问，不必耗尽预算；不把未查清的事实当已确认；默认额度、次数、续读计费与预留写作空间由实际场景和资源测量确定，不把早期“2 次”建议冻结为产品上限。
- 实施后果：复用既有 run 总账和预算恢复入口，验证 replan 不重置已用额度、重复查询不空转、追加后承接既有观察。跨重启恢复仍归 CP3；本次只是产品取舍，尚无对应正文求证运行证据。
- 该次 D2 选择未覆盖 D3–D7、ADR 接受手续及其它 C 项；后续结果见对应裁决记录。该次无产品代码、schema、数据或真实模型操作。

### 9.7.7 D3 产品决策材料

- 状态：**done（D3 产品取舍已确认，记录见 §9.7.8；产品实施与验收未完成）**。
- 场景：作者要求“把前文约定接着写”，AI 已读取相关章节，但没找到约定的具体内容，或两个来源互相冲突。即使查询成功且预算尚有余量，也不能据此判断已经准备好写作。
- 设计依据：VS-00K §4.2 已提出准备判断应表达缺什么，按需要继续求证、降级或询问；不能由 APP 机械宣布 ready。当前 chapter_mission 从机械预选材料推导使命，已有依据绑定，但尚无完整的观察→缺口判断→补查/询问→再判断链路。

| 产品选项 | 推荐 | 影响 |
|---|---|---|
| **A：本次目标依赖的关键既有事实未核清时，默认继续求证或请作者决定，再给符合原目标的正文候选** | **推荐** | 降低错接前文；可能增加查询或一次作者互动。模型说明缺口，APP 核权限/引用/预算等边界；已知足够时不强制多查，不要求新创意都有旧来源 |
| B：在契约允许的范围内，先给明确标注假设和未核实部分的候选草稿 | 可选 | 更快获得可讨论文本，但可能返工，需明确这是受限候选而非已核实续写；不能绕过对象身份、权限、版本等硬阻断，不自动采纳、不改 canon |

本次取舍只涉及默认交付策略。作者主动要求“先假设、试写”时，仍按明确的作者意图和既有 policy 处理，不用准备判断否定正常创作自由。资料不存在、含糊、冲突与纯新创作要分开，不要求穷尽全书知识才允许写作。

**工程推进口径**：原 D3 的 i/iii 是内部实现先后；可以先落探索与观察传递的局部 checkpoint，准备判断未接时如实记 unknown。但该 checkpoint 不能代签 AU-15 A0 的 ready/missing 区分，也不能外推为完整求证创作已完成。首个完整用户场景必须具备它实际需要的最小准备判断；完整缺口结构、有界 replan 与引用绑定仍由 CP2 承接。是否复用使命调用、需要哪些字段由实现设计评估，不预定新模型调用或固定置信度阈值。“机械过渡即 ready”不作为可选方案。

### 9.7.8 D3 裁决记录

- 日期：2026-10-29；来源：本聊天展示 D3 的 A/B 选项，推荐“关键既有事实未核清，先继续求证或请作者决定，再生成符合原目标的正文候选”后，作者回复原文 **“a”**，对应 **D3-A**。
- 已生效默认行为：本次目标依赖的关键既有事实未核清时，先求证或询问作者；查询成功和预算尚有余量均不能代替准备就绪判断。
- 创作边界：只核查目标所依赖的关键既有事实，不要求掌握全书全部信息，不要求新创意有旧来源。作者明确要求“先假设、试写”时，仍按作者意图与既有 policy 处理；身份、权限、版本等硬阻断保持。
- 实施后果：准备判断应说明缺口并形成真实续行/询问结果；内部可以先做接线 checkpoint，未接准备判断记 unknown，不能将局部完成宣布为完整求证能力。完整缺口与有界 replan 等仍由既定 CP 承接。
- 该次 D3 选择未覆盖 D4–D7、ADR 接受手续及其它 C 项，后续结果见各自裁决记录。记录本项不表示代码、schema、真实模型或页面验收已完成。

### 9.7.9 D4 验收口径材料

- 状态：**done（D4 分层口径已确认，记录见 §9.7.10；仅决策闭合，不表示产品验收通过）**。
- 场景：探索工具成功、观察进了后续请求、局部测试通过，但真实模型是否自主求证、正文是否承接事实、原生页面和恢复等仍未完整验证。这时应准确说明哪些已完成，不能把局部证据汇总成整个能力 PASS。
- 现有约束：项目承重 slice 要求外部自动化驱动真实产品入口；AU-15 要求机制、模型行为与文学评价分开，关键缺事实场景至少两次独立实模运行并保留失败分母。B42 §12 已按必需维度校验完整性，但基建本身不能代验 B39。
- **推荐口径（原 c+a 的组合，非降低通过线）**：
  1. 实现与验证可以分阶段；只对实际完成且有证据的范围报告结果，列明未验后果、承接 CP 和 blocker。
  2. 正式 AU-15 场景只有预先冻结的适用要求全部满足才可 PASS；必需证据缺失记 evidence_missing，已证违规记 fail，未执行不伪报通过。不为过关删除维度或把本应适用的要求改成不适用。
  3. 机制测试、真实模型行为、原生/浏览器交互分别留证；一个场景通过不外推整组，CP 完成不外推 B39 done，B39 done 须覆盖完整规划范围。
  4. 文学质量收益继续由 I10 人工盲评判断，工程 PASS 不代签。真实模型的引用有来源也不自动证明语义正确。
- 与 D3 的关系：可以先做局部接线，但未实现本场景必需的准备判断时不能按正式创作场景通过；不再把“CP1 先未知”解释成允许关键事实未知时默认给正式续写。
- 本项需要确认的是上述完整交付口径；“partial/unknown 也写 PASS”与已有规则冲突，不是可供作者普通选择的替代。本节保留提出时的口径；作者选择见 §9.7.10，本次记录不修改实际判据或运行产物。

### 9.7.10 D4 裁决记录

- 日期：2026-10-29；来源：本聊天提出“允许分阶段推进和汇报，同时严格限制每个通过结论的范围”，明确局部 checkpoint、正式场景、完整 B39 与文学收益分别成立后，作者回复原文 **“同意”**。
- 已生效口径：局部完成须说明实际验证范围与未完成后果；正式场景仅在预先冻结的必需证据齐全时 PASS；完整 B39 须完成全部规划范围后才 done；工程结果不代签 I10 文学收益。
- 证据边界：机制测试与真实模型行为、浏览器与原生交互、引用来源与语义正确性分别证明；单场景不能外推整组。必需证据缺失不能通过，未执行不补写成通过，违反判据如实记失败。
- 实施后果：按 B42 当前完整性契约与 AU-15 预注册执行，保留失败分母与未验后果；不为过关删除要求或伪称不适用。本项确认不表示 B39 或 AU-15 已通过。
- 该次 D4 选择未覆盖 D5–D7、ADR 接受手续及其它 C 项，后续结果见各自裁决记录。该次只更新文档，无代码、schema、数据或真实模型操作。

### 9.7.11 D5 探索授权边界材料

- 状态：**done（D5 产品约束已确认，记录见 §9.7.12；只关闭决策项，不表示运行时守卫已实现或验收）**。
- 场景：模型为当前作品查询某章或档案，但请求对象可能不属于当前作品/会话，或任务已取消、预算已不足。读取本身不改作品事实，也仍可能读错对象、越过授权或无界消耗。这里列的是必须防住的情况，不声称本轮复现了这些事故。
- 现有能力：判断循环与 judgment_plan 已经通过 ExplorationService 执行只读探索，后者内联路径不经写操作 Toolbox/Orchestrator；读取端口已有 work_id 作用域，会话采纳读取还检查 work/session 对应。B39 仍须审计并证明各消费路径守卫一致，不能仅凭传入 work_id 宣称全部权限闭环。
- **推荐确认的产品约束**：
  1. 已授权范围内的当前作品/会话资料可由模型按需查询，不逐次请求作者批准；读取范围以任务权限为准，模型给出的其它对象 ref 不增加权限。
  2. 实际读取前验证工具、查询、作品/会话范围、权限、运行状态及剩余预算；重复无进展按既有规则停止，合法续读不误判重复。
  3. 取消后不再派发新的查询；已返回结果不得触发迟到写入。细粒度中断正在进行的读取能力须另按真实实现取证，不预先承诺。
  4. 观察保持只读，不自动成为 canon 或采纳动作；执行动作仍经既有 gate，写入仍受作者授权与采纳边界约束。
  5. 查询、结果、拒绝原因和后续使用可追溯；用实际观察/事件留证，不为统一外观伪造 ToolRequest/ToolTrace。
- 实施建议与影响：优先共享现有探索执行入口并补齐缺失守卫，避免每个 flow 复制规则。原 a“复用内联路径”和 b“增加只读 gate”都是满足约束的工程候选；b 可以改善集中审计，但需证明真实消费者与迁移收益，不能仅为形式统一新增层。若 a 不能满足隔离/权限/恢复要求，必须补齐或调整设计，不得以“复用优先”保留漏洞。
- 与已确认事项的关系：D2 规定预算不足交还作者，D1 规定材料证据同源，本项把它们落实到查询执行边界；不新增跨作品、外网、文件系统或写操作的授权。本节保留提出时的约束，作者确认见 §9.7.12。

### 9.7.12 D5 裁决记录

- 日期：2026-10-29；来源：本聊天提出授权内自主查询、执行前自动校验、取消/重复停止、观察不直接改变作品事实、过程可追溯的约束后，作者回复原文 **“同意”**。
- 已生效约束：读取只在任务已授权范围内自主执行，不逐次要求作者批准；每次实际读取前核对工具、查询对象归属、权限、预算与运行状态，模型提供 ref 不增加权限。取消后不再派发新查询，重复无进展须停止。
- 写入与证据边界：观察不自动成为 canon，写入/采纳保留原门禁与授权；真实查询、结果与拒绝原因可追溯，不伪造执行成功或 ToolTrace。已返回观察不能触发迟到写入。
- 实施后果：优先共享既有探索链，审计并补齐守卫；是否增设独立只读 gate 由真实消费者和迁移收益决定，不预先授权新层或第二运行时。正在执行的读取是否可细粒度中断仍按实际实现取证。
- 该次 D5 选择未覆盖 D6–D7、ADR 接受手续及其它 C 项，后续结果见各自裁决记录。本次不增加跨作品/外网/文件系统/写操作权限，未修改产品代码或执行模型调用。

### 9.7.13 D6 验收前置资料方案

- 状态：**done（D6 证据口径已确认，记录见 §9.7.14；未运行前置创作或验收）**。
- 场景：要验证“模型能承接前文约定”，先得有一章已经采纳、包含该约定的正文。要明确这份正文如何产生，才能说明本次证据覆盖了哪条链路。
- 当前要求：AU-15 §5 写明通过真实创作与采纳产生前置事实；后续自然请求不直接提示工具、不提供约定答案，相关事实须在真实作品中可读。A2 用另一未配置专用 packet 的要素复用同一机制。

| 选项 | 推荐 | 影响 |
|---|---|---|
| **A：正式验收使用真实模型创作并由外部 UI 自动化采纳的前置章节（原 ii）** | **推荐** | 证明真实作品产出/采纳与后续探索写作之间的连接，符合现有 AU-15；准备耗时和模型调用更多，需保存前置来源与采纳证据 |
| B：正式验收也直接预置隔离作品资料（原 i） | 正式采用须先明确修订 AU-15 前置 | 更快且可控，可以验证从已有资料读取开始的后续链路；不能据此声称前置章节真实创作/采纳已验，且仍须真实 UI 和真实模型完成被测求证链 |

日常单测、机制测试与低成本探针可以使用隔离 fixture；无论选哪种，都不能让 APP 或驱动替模型安排答案/探索步骤，不得通过临时专用 packet 供给被测答案。正式 A1/A2 仍须核对真实查询、观察进入后续请求、输出与事实相容及引用边界，前置来源真实不等于这些后续行为自动通过。

准备样本与测量 run 分账；独立重复和失败分母预先冻结，setup 失败如实留存，不伪报成成功测量。是否可复用已有真实前置样本及如何隔离，须在预注册明确来源、版本、适用性和独立性，不默认每次重建全书，也不默认复用旧 artifact 就满足当前验收。本项确认的是证据口径，不等于立刻启动真实模型或修改用户存量数据。

### 9.7.14 D6 裁决记录

- 日期：2026-10-29；来源：本聊天推荐“正式验收使用真实模型创作并由真实页面采纳的前置章节，日常单测、机制验证和调试仍用隔离预置数据”后，作者回复原文 **“同意”**。
- 已生效选择：**D6-A（原 ii）**。正式 AU-15 的前置章节走真实创作/采纳链并保留来源与采纳证据，保持现有验收前置要求；隔离 fixture 仍可用于日常机制测试与调试，不能据此代签真实创作采纳。
- 证据边界：后续真实模型自主查询、观察进入写作请求、结果与前文相容、引用可绑定仍须分别验证；前置事实真实不等于后续能力通过。
- 实施后果：setup 与测量 run 分账，冻结样本来源、隔离、独立重复与失败分母；样本复用条件由预注册说明，不默认为每次重建全书或直接复用历史 artifact 即合格。
- 该次 D6 选择未覆盖 D7、ADR 接受手续及其它 C 项，后续结果见各自记录。本次只确认验收口径，未运行真实模型、创作前置样本或修改存量数据。

### 9.7.15 D7 观察内容与来源方案

- 状态：**done（D7 产品约束已确认，记录见 §9.7.16；未修改产品接线）**。
- 场景：查询返回一句“某人答应三天后回来”，若写作模型不知道来自哪份材料、什么版本、覆盖了哪段，以及属于已采纳正文还是待定资料，就可能把局部、过期或未确认内容当成完整既有事实。
- 现状：prose flow 的 `author_input_text` 已有观察 summary 合流点，writer 有可选 `self_report.used_context_refs`，但不等于完整来源表达与生产绑定校验已成立；具体缺口须与 D1 的同源请求记录一起接通。
- **推荐原 i+ii 的产品约束**：
  1. 有用的观察内容或保真投影，与可核验的 observation/source refs 同批进入真正的后续请求；可获得的版本、覆盖、省略与资料权威状态一并表达，未知值不补造。不能只给引用不给内容，也不能只在后台记录来源却让模型看不见。
  2. 明确模型对既有事实的引用只能来自本次实际可见的底座材料或真实观察；区分已采纳事实、待定资料、推导和假设。无来源的新创意可作为 tentative，不把创造性内容误判为伪引用。
  3. 复用已有材料格式与共享引用规则；已有表达足够时不重复追加提示。动态观察遵守 VS-00I 的消息/前缀边界，不为每类要素添加专用 prompt 分支。
  4. 系统机械核验 used refs 的真实可见性与来源绑定；模型未自报告记 unknown，不能从“已提供”推断“已使用”，引用合法也不代签语义正确。越界按既定质量/求证/作者决策路径处理，不修改 artifact 字节掩盖。
- 与 D1 的区别：D1 保证系统对“实际给了什么”有同源事实；D7 保证模型收到可辨认来源的材料与引用规则。两者使用同一材料源，不建设两套索引。
- 方案影响：增加必要的材料元数据和绑定接线，换取模型可区分事实来源及后续可核验性。仅传摘要成本低但缺这层能力；只传 refs 缺少事实内容，均不能替代推荐组合。正文创作不要求每句带技术引用，作者界面按可读来源投影，内部 refs 不直接当正文文案。
- 本节保留提出时的方案，作者确认见 §9.7.16；本次无 prompt/schema/产品代码修改，未触发真实模型。

### 9.7.16 D7 裁决记录

- 日期：2026-10-29；来源：本聊天提出将观察内容、可核验来源、已有版本/覆盖/省略与引用规则一起交给写作模型，区分 D1 系统存证与 D7 模型可辨来源后，作者回复原文 **“同意”**。
- 已生效约束：观察内容或保真投影和真实来源同批进入后续请求，已有版本/覆盖等边界一并表达，未知不补造；区分已采纳、待定、推导与假设；既有事实引用限实际收到的材料，新创意仍可作为 tentative。
- 校验边界：系统核查引用实际可见性，不只信任自报告；未报告记 unknown，引用合法不等于语义正确，不改 artifact 字节掩盖越界。D1/D7 共用材料源、索引与既有引用规则，不重复堆提示。
- 作者体验：正文无需每句带技术引用；作者面采用可读来源表达，技术 refs 不直接作为小说正文或作者提示文案。
- 实施后果：需补齐请求材料元数据、观察交接与引用核验接线，并验证前缀边界；本项是产品决策，尚无对应实现/实模/页面验收结论。
- 本次 D7 确认不自动接受其它 C 项或执行数据/模型操作；C01 与 D1–D7 的取舍已齐，进入 §9.7.17 的实施基线正式接受。

### 9.7.17 C01 实施基线收口

- 状态：**done（2026-10-29 作者正式接受实施基线；仅设计裁决收口，产品未完成）**。
- 接受来源：本聊天明确展示三份对齐后的草案及“接受设计不关闭未实现/未验收缺口”的边界，并询问是否接受为 B39 实施基线；作者回复原文 **“同意”**。
- 对齐文件：[ADR-0030](../../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md)、[VS-00K](../../docs/design/contracts/VS-00K-evidence-seeking-authoring-contract-pack.md)、[AU-15](../../docs/design/acceptance/author/AU-15-evidence-seeking-authoring.md)。三份均已按这次明确的整体接受转为 Accepted；依据是本次确认，不是倒推此前单项同意。
- 收口范围：仅落实本文件 C01/D1–D7 已确认的产品边界，不增加新产品取舍。字段/快照载体、预算数值、具体 gate 组织等由对应 CP 按真实消费者与最小改动评估；新表、第二运行时或其它能力不由本次收口默认授权。
- 关键对齐：CP1 的完整用户场景包括 A0/A1/A2 与所需最小准备判断，局部接线不能代签；完整缺口/replan/引用校验继续由 CP2 承接，跨重启等由 CP3 承接；D4 全范围与分层证据标准不变。
- 已接受但未实现：ADR 将既有只读/预算/验收基础单列为 enforced_by，并把 B39 产品接线、完整引用/恢复/真实页面与实模证据逐项保留在 enforcement_gaps。接受设计不等于这些缺口关闭。
- 接受后动作：三份文件及必要索引已同步；B39 进入按原 CP 规划的待排期/实施准备；不由状态更新启动真实模型、修改存量数据或接受 C02–C08。正式运行仍须冻结具体预注册与资源窗口。
- 本次文档验证：`node scripts/next_task_check.mjs`、`git diff --check` 通过；修改文档本地引用 204/204 可达；`mix run --no-start scripts/adr_trace.exs` 为 29/29 Accepted、316 refs（包含 ADR-0030 的 10 个既有基础引用）。这些只证明文档/引用完整，未执行产品、真实模型或原生页面验收。

### 9.8 本轮验证、未闭环与恢复

> 本节保留 2026-10-28 只读预研时的验证与前置状态；2026-10-29 已解除的设计接受前置及当前恢复范围以 §9.7.17 为准。

- 本轮只做只读核对（git/代码/quality schema 与脚本/历史 artifacts），并写本节与独立报告；**未运行产品、验收、Tauri、真实模型或长跑，未改产品/契约/ADR/验收文档，未 commit**。
- 未闭环（不得读作完成）：CP1 未开工（ADR-0030 Proposed）；SC-AU15 未注册（release tier 仍 0 场景）；本轮未运行真实模型；无 native AU-15 证据；历史 P1 native 实模证据存在（判断循环探索），但不能替代 CP1 未接线与 AU-15 未注册；`judgment-explore-internal`/B62/B63 相关 WIP 属其他任务，不作为本任务证据。
- ADR Accepted 后的建议开工顺序：① 作者裁决 9.7 D1–D7 → ② CP1 接线（9.3）+ 机制测试 → ③ 登记 AU15 场景/driver/verifier（draft 先永不执行，真实 PASS 后按证据改 active）→ ④ 低成本探针（授权后，不计分母）→ ⑤ A0/A1/A2 ≥2 独立 run + B42 sidecars → ⑥ B42 CP4 结果层判定 → ⑦ 按 tasks/README 更新状态/台账。
- 恢复指引：先读本节 + §8.4 + `artifacts/completion-audit/2026-10-28-b39-cp1-preread/report.md` + B42 §6/§10/§11 + AU-15；不要从历史 p1/agentic-loop 证据推断 AU-15 已通过。

### 9.9 CP1a 接线 checkpoint（2026-10-30，未完成 CP1）

- 交付：
  - 新增 `NovelApplication.AgentRunFlows.ExplorationStep`（application 层共享只读探索执行）：目录/工具集由调用点分账、`ExplorationService` 内联 0 provider 调用、工具失败归一 `:failed` 观察、author-visible `exploration_observed` + developer `AgentObservation` + `AgentStep`、no-progress namespace 由调用点给；不新增 agent loop、不新增表。
  - `judgment_plan` 迁移到共享模块（行为/事件/payload 保持；原私有三处漂移之一收敛）；`dialogue_planning_service` 内联路径仍待后续迁移（CP1 残余，不冒充三处已统一）。
  - 正文 flow：计划目标/执行器白名单/planner target 与 step_catalog 开放 `prose_search/chapter_read/archive_read/memory_recall`；机械决策携带 `exploration_query`；计划内检索步走共享模块，0 provider/0 tool，观察进 snapshot 并随 `author_input_text` 的“已完成观察”段进入真实 writer prompt。
- 测试：`agent_run_prose_drafting_flow_test.exs` 新增 focused 场景——4 步计划含 `archive_read` 检索，author 侧 `exploration_observed` 带 tool/query/真实 summary，writer prompt 含该观察内容；`completed_step_refs=4`、`steps=4`、`tool_calls=1`、`provider_calls=4`（检索步不增 provider/tool）；相关 flow tests 23/23。
- 残余（CP1 未完成，不得代签）：
  1. CP1b：观察以 author-safe + 真实 refs 进入 `chapter_mission`（`ChapterMissionInputs` additive observation items）与 writer AuthoringTask refs/trace；当前 writer 仅收到 summary 行，使命尚未消费观察。
  2. CP1c：`self_report.used_context_refs ⊆ Base refs ∪ 实际观察 refs` 的 domain 纯校验、Base/observation 逐调用同源 trace 快照（D1 方案）、未绑定 ref 记 unknown/不修改 artifact 字节。
  3. 最小准备判断（D3-A）与 A0/A1/A2 场景、AU-15 registry/driver/verifier、确定性机制与真实模型行为分层取证；跨重启恢复归 CP3。
  4. `dialogue_planning_service` 两处探索内联实现迁移、续读/no-progress 跨 flow 预算累计证据。
- 门禁：见 `artifacts/gates/2026-10-30-b39-cp1a/`。

### 9.10 CP1b 接线 checkpoint（2026-10-30，未完成 CP1）

- 交付：
  - `ChapterMissionInputs.build` additive `observations`（`%{ref: "observation:<id>", group: :observation, text: 摘要+来源 refs}`）；`to_prompt_section` 新增“本 run 已取得的观察（按需求证；内容与来源同批）”组；复用 `refs/known_ref?/label` 与 `ChapterMission.bind/2` 的 I-M1 越界丢弃——模型只有复制真实 observation ref 才能保留依据，无观察不出 item。
  - 正文 flow 把本 run 的 exploration observations 映射进 `mission_inputs`；`author_input_text` 观察段升级为 `[observation:<id>] 摘要（来源 refs：…）`；writer `AuthoringTask` materials 增加 `observation:<id>` 条目、`source_refs` 增加 observation refs；`TurnExecutionService` 透传 observations。D7 的“内容+可核验来源同批进入后续请求”在 writer prompt 中可见：材料段列出 observation ref，观察段列出底层来源 refs。
- 测试（CP1a 场景扩展）：mission prompt 含“本 run 已取得的观察”和 `observation:<id>`；模型返回该 ref 后 `mission_persisted.must_advance.basis_ref` 保留 observation ref（bind 未丢弃）；writer prompt 同时含观察摘要与 `observation：observation:<id>` 材料行；预算仍 4 steps/1 tool/4 provider。相关测试 36/36（prose flow、domain mission inputs、authoring task builder）。
- 残余（CP1 未完成）：
  1. CP1c：`self_report.used_context_refs ⊆ Base refs ∪ 实际观察 refs` 的 domain 校验、逐 provider call 同源 Base/observation 快照（D1）、未绑定 ref unknown/不修改 artifact 字节；当前尚未限制模型自报 used refs。
  2. 最小准备判断（D3-A）：关键既有事实未核清时继续求证/询问，再由模型/计划继续；当前只有探索目录与观察传递，无正式准备判断。
  3. SC-AU15-A0/A1/A2 driver/verifier/registry、真实模型行为分层证据、≥2 独立 run 与失败分母；A2 通用性（时间要素）与 diff 检查。
  4. `dialogue_planning_service` 两处探索内联实现迁移、跨 flow 预算累计/续读证据。
- 门禁：见 `artifacts/gates/2026-10-30-b39-cp1b/`。

### 9.11 CP1c 接线 checkpoint（2026-10-30，未完成 CP1）

- 交付：
  - 新增 `NovelDomain.EvidenceUsage` 纯校验：`used_context_refs ⊆ Base refs ∪ 实际观察 refs`；状态 `:ok | :partial | :all_unbound | :no_claim | :unknown`；越界 ref 记 `unbound_context_refs`，不给证据信用、不修改 artifact 字节；4 条 domain 测试。
  - `TurnExecutionService` 在真实 writer tool result 之后、trace 记录之前，由同一请求事实派生 Base refs（task materials 非 observation + source_refs）与 observation refs（observation 材料 ref + 观察底层 source refs），校验模型自报 `used_context_refs`；结果随 trace meta 记录。
  - `TraceWriter` additive 写 `request_base_refs` / `request_observation_refs` / `used_context_refs` / `unbound_context_refs` / `used_context_refs_validation` / `used_context_refs_provider_call_ref`（author-safe，不写 raw prompt）；turn_result 的 trace_summary/Why 消费同源。
- 测试（prose CP1 场景扩展）：writer self_report 同时引用真实 observation ref 与虚构 `chapter:b39-invented`；trace summary `validation=partial`、`used_context_refs=[observation:…]`、`unbound_context_refs=[chapter:b39-invented]`、`request_observation_refs` 含该 observation ref、`request_base_refs` 非空、provider_call_ref 指向实际 writer 调用；已生成 prose pending 候选保持存在。相关测试 16/16；全量门禁见 `artifacts/gates/2026-10-30-b39-cp1c/`。
- 残余（CP1 未完成）：
  1. Base/observation 快照目前由 request 装配事实派生（AuthoringTask/observations），尚未与外部真实 provider 请求字节交叉核对；B42 `provider_calls[].request_observation_refs`/`observed_in_calls` sidecar 需在 AU-15 verifier 采集（CP1d）。
  2. 最小准备判断未接：关键既有事实未核清时继续求证/询问的正式行为。
  3. SC-AU15-A0/A1/A2 driver/verifier/registry、真实模型行为分层证据、≥2 独立 run/失败分母、A2 通用性与无领域分支 diff 检查。
  4. `dialogue_planning_service` 两处探索内联实现迁移、跨 flow 预算累计/续读证据。

## 10. 当前初始供给整改的消费交接

- [B27 §9](B27-systematic-prompt-and-intent-integration.md#9-元原则整改实际请求材料与引用同源) 负责当前共通初始请求的实际材料与 supplied refs 同源；[AU03](AU03-file-level-closure.md#当前上下文缺失与读取失败补验) 负责真实空/未知/fetch 失败及恢复语义。其执行状态只在各原任务维护，本节不复制。
- B39 按已接受的 C01/D1–D7 和原 CP1–CP4 消费这套真实供给基础，继续完成专业 run 的按需求证、观察进入后续请求、实际可见来源/used refs 校验、准备/恢复及携带迁移。B27 当前初始链修复不替代本任务完整闭环，本任务也不另建一套初始材料/错误真源。
- “召回过但未发送却标 supplied”的整改不默认把全部 memory 塞回首轮，也不一刀切删掉已有 carry。按必要 Base、按需取得与来源/覆盖边界逐项处理；若转按需读取，须证明模型可发现缺口、取得真实观察并用于后续实际请求。
- 模型自报使用、系统核验引用可见性与语义正确保持分层；没有自报或无法核验时保留 unknown，不从日志/字段/卡片存在推断已使用。与 B42 共用证据口径，机制、实模、原生页面及文学结论各守原验收边界。
- **上游判据已就绪（B42 §13，2026-10-30）**：`quality-evidence-chain/v1` 现在要求请求侧同源记录（`provider_calls[].request_observation_refs` + `observed_in_calls`）才能授 inclusion 信用，且 `used_context_refs` 必须绑定 `used_context_refs_provider_call_ref`；缺失一律 unknown/partial，time_order 不再授信。B39 CP1 采集/verifier 必须产出这两类字段，否则本任务真实链路只能 evidence_missing（不得由 B42 侧补写 or 从 prompt 文字反推）。
