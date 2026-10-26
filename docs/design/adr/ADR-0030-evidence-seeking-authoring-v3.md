# ADR-0030：求证式创作——最小供给、Run 级探索与证据闭环

- 状态：**Proposed（2026-10-27；不授权代码实现）**
- 来源文档：
  - `../00-vision-and-engineering-roadmap.md` §2.4
  - `../00c-state-and-contract-atlas.md` §4、§6.7、§7、§8.4、§9.12
  - `../contracts/VS-00K-evidence-seeking-authoring-contract-pack.md`
  - `../notes/2026-08-11-establish-carry-process-write-pipeline.md` §1、§4
- 影响范围：DialogueContext / AgentRun / Exploration / Creative Execution / Trace / Replay / Acceptance
- 相关不变量：`00c` §7 #20–#23（候选）
- 首个证明 slice：`tasks/slices/B39-evidence-seeking-authoring.md`
- 取代：无
- 取代者：无

## 背景

现有创作主链已经具备 AgentRun、模型起草 AgentPlan、plan revision、只读探索、写前使命、质量复核和作者采纳边界。但正文、规划与修订的最终知识保障仍主要依赖 APP 预先选择并携带材料。每新增一类连续性需求，就可能继续增加固定 packet、CarryRegistry 行和 prompt 段。

这种责任划分要求 APP 预先枚举模型可能需要的全部知识，既不可持续，也不能证明模型在真实创作时能处理未预见的信息需求。

同时，完全取消底座、让模型自由探索也不成立：作者意图、写作坐标、权限、工具、预算和版本不能靠猜；模型还可能没有意识到自己缺信息，或者无界查询、引用不存在的证据。

## 决策范围

本 ADR 拟冻结以下责任与边界，待评审 Accepted 后才可作为实现输入：

1. APP 的主动供给收敛为不可猜测的最小可信底座与契约必要材料，不再以“预装全部相关知识”为目标。
2. 规划、正文和修订中的模型通过统一 AgentRun 的只读探索、观察与 plan revision 按需求证；不另建平行 agent runtime，也不在 writer 内私藏第二套循环。
3. APP 预选携带与模型请求观察是两条可区分、可审计的通道。后续模型请求中的非 Base 作品知识必须能追溯到真实观察。
4. 模型对既有事实的引用必须能绑定到底座公开 refs 或本 run 实际观察 refs；未读取 ref 不得冒充依据。该约束不限制 tentative 的新创作。
5. 求证仍受 Orchestrator、权限、预算、重复查询处理、取消、恢复、trace 和作者采纳边界约束。
6. 新作品维度默认优先进入可探索事实与引用体系，不以新增固定 prompt packet 作为默认补漏方式。现有携带按真实证据逐块迁移，不做一次性删除。

## 非目标

- 不冻结时间线、伤势、物品等任何单一领域的专用 schema。
- 不承诺模型永远不会漏查或误判；语义质量仍需通用准备、复核与作者裁决。
- 不要求首轮 prompt 不含答案，也不要求所有事实都必须等模型查询才提供。
- 不在本 ADR 中确定 Base 的逐字段全集、查询预算数值或新的 provider-native writer 工具循环。
- 不直接改写或废止 Accepted 的 ADR-0023 / ADR-0025；本 ADR 说明与它们的补充关系。
- 不要求立即删除现有 CarryRegistry 条目或建立新的作品事实表。

## 考虑过的方案

### 方案 A：继续扩展 APP 预选携带

- 优点：调用少、确定性强，适合坐标、身份和安全边界等稳定信息。
- 缺点：每种知识都需要专用携带规则；APP 永远无法穷举相关性，容易形成持续补漏洞的 prompt 清单。
- 结论：保留为最小底座机制，不作为全部作品知识的获取架构。

### 方案 B：完全取消主动供给，全部交给模型自由查询

- 优点：表面上去除了 APP 对相关信息的所有判断。
- 缺点：目标、权限和坐标仍需系统提供；模型存在未知未知、无界探索和伪造依据的风险，无法保证成本与恢复。
- 结论：拒绝。

### 方案 C：最小底座 + AgentRun 级求证 + 证据闭环

- 优点：复用现有计划、观察、replan、预算、恢复与 UI；模型负责相关性，系统负责可信供给与边界；可按真实场景逐步迁移。
- 缺点：需要打通创作 profile 的探索步、准备判断和证据引用校验，调用与观测复杂度高于一次性 context。
- 结论：选择为本 ADR 提案。

### 方案 D：在 writer 内直接运行 provider-native 工具循环

- 优点：模型可以在生成过程中即时查询。
- 缺点：会与 AgentRun 的计划、预算、权限、恢复和作者活动流形成第二控制环，并增加 provider 兼容与 artifact 因果绑定复杂度。
- 结论：Deferred；只有 run 级求证经真实证据仍无法满足时才重新评估。

## 最终决策（Proposed）

采用方案 C。求证发生在统一 AgentRun 内：模型通过计划与修订表达信息需求，runtime 执行只读探索并返回观察，准备判断决定继续求证或进入创作，writer 与质量复核的消费引用接受证据绑定检查。

“模型提出探索”不等于“模型批准执行”；act 步仍重新经过 MicroPlan / Orchestrator gate。探索观察与推理结果默认只读，不直接写 canon。

## 决策理由

该方案把 APP 从“全知的相关性预测者”还原为“可信事实、工具和边界提供者”，同时保留小说创作必需的作者主权、版本、审计和恢复。它利用既有 AgentRun 资产，避免把主动投喂的问题替换成无约束自由 agent 的问题。

## Contract 影响

- `contracts/VS-00C`：区分 Base、Derived 与 Requested Observation；CarryRegistry 不再被视为全部知识的唯一入口。
- `contracts/UA-01`：创作 profile 增加只读探索与证据不足时的 plan revision；复用现有观察和恢复。
- `contracts/VS-00E`：写前使命增加准备就绪判断；writer self_report 的 used_context_refs 接受真实证据绑定。
- `06`：DialogueContext 不再被解释为模型全部作品知识的完整快照；补充 run 观察的证据语义。
- `08`：要素消费面从“入库后等 APP 携带”扩展为“可探索、可引用、可按需进入创作”。
- `engineering/vertical-slice`：Proof 与 Exploration 必须说明真实求证链，不得只断言固定 prompt 段存在。

详细候选契约见 `contracts/VS-00K-evidence-seeking-authoring-contract-pack.md`。

## Umbrella 边界影响

- `novel_domain`：候选纯值对象、证据引用与准备判断校验，不执行 I/O。
- `novel_application`：AgentRun、探索步、准备判断、证据索引、观察投影和 plan revision。
- `novel_agent`：继续提供统一 ProviderExecution；不新增供应商专用求证协议。
- `novel_persistence`：优先复用 AgentObservation / trace 与既有作品读端口；新表不是首刀前提。
- `novel_web` / frontend：复用真实 Channel、候选与 AgentRun 活动投影，不新增旁路页面。

## UI / Trace / Replay 影响

作者应能看到模型查了哪些材料、得到什么观察、还有哪些缺口；作者可见叙事继续遵守 N-NARR。Trace 应能关联查询、观察、后续 provider 调用和 used_context_refs。Replay 默认不重调模型，优先根据持久观察解释。

## 垂直切面证明

首个真实消费者是正文 writer，随后扩展到规划与修订。真实 Tauri 验收必须证明：固定底座没有完整答案时，模型能自主选择探索，真实观察进入后续 writer 请求，生成结果与证据相容；另一个没有专用 packet 的要素必须复用同一机制。确定性替身只证明接线。

验收入口：`acceptance/author/AU-15-evidence-seeking-authoring.md`。执行任务：`tasks/slices/B39-evidence-seeking-authoring.md`。

## 迁移与兼容

现有携带块不因本 ADR 一次性删除。先建立求证链，再依据真实 run 的引用、重复查询与质量证据，逐块决定保留为 Base、转为按需读取或改为派生内容。历史 ADR 与验收证据保留，不把新目标写成既有完成事实。

## 后续工作

- 评审 VS-00K 的 Base / Observation / Preparation / EvidenceUsage 候选契约。
- 完成主链、Context、AgentRun、写前推理与验收文档的逐条处置。
- Accepted 后由 B39 CP1 建立正文 run 的真实求证闭环。
- 根据真实证据再决定时间线等领域读模型和固定携带退役顺序。

## enforcement_gaps

本 ADR 当前为 Proposed，全部目标行为仍待 B39 实现与真实页面验收；现有探索、AgentRun、chapter_mission 和 self_report 只能作为可复用基础，不能视为求证式创作已经完成。
