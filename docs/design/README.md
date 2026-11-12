# 当前设计文档入口

> 2026-11-13：作者授权 Issue #4 的系统级设计与批次重审，确认**未发布/不兼容历史/所有新实体先存在性审计**；[VS-00M](contracts/VS-00M-model-interaction-request-response-contract-pack.md) 重构为唯一增量设计（Proposed，需先核对 Frozen 契约），[B87](../../tasks/slices/B87-model-interaction-request-projection.md) 登记 R00–R19、统一 clean/授权/创作质量最终验收；B86 C9 责任归 B87 R06，原历史证据保留。此处不是实施完成声明。

> 2026-11-12：B71/B81 完成度独立复核（三份只读审计）后完成文档与实现收口——B81 状态对齐为 done（CP1–CP6，2026-11-11 复核，§12 证据）并修正索引/契约漂移；B71 保持 doing（G3/G5 与 Responses/Anthropic 实模、真实流式预览、I10、CP5 最终收口未闭环）。本轮同批清理：VS-00L §4 移除未落地/已退役字段、§16.2/§16.8/§17 状态回写；08 §26 日期化状态改为指针（设计文档不维护第二状态源）；删除 `TurnExecutionService` 旧 `authoring_transcript` 回退与 4 个零消费者模块；checkpoint 版本与 artifact 谓词收敛到唯一契约。状态真源仍为 `tasks/slices/` 原任务。

> 2026-11-08：系统现有功能梳理启动——新增 [00f 实现态能力图谱](00f-capability-atlas.md)（真实入口 → 功能域 → 实现/消费 → 证据/缺口，living 文档）；首轮盘点登记死代码/旧协议退役/未取证/文档一致性缺口（P1–P3）。历史状态行中「R1 实现位于未提交工作区」等描述是当时记录，当前 R1/R2/流式预览证据均已提交（见 `docs/project-ledger.md`）。B79 导入/分析为独立大功能，本轮不启动。

> 2026-11-07：B71 裁决 4 C 按作者 A1 裁决恢复原计划统一归属——三类 Provider wire 投影（`NovelCommon.RequestIR.Projection` + `ChatCompletions`/`AnthropicMessages`/`ResponsesAPI`）与传输能力事实派生（`NovelCommon.CapabilityProfile`）一并下沉 `novel_common`；执行边界保留实际路由选择、传输发送与运行时监督。2026-11-06 的「投影留 agent」按作者裁决回退，[ADR-0033 §6](adr/ADR-0033-authoring-run-transcript-request-ir-v3.md#6-contract-与边界影响) 与 [VS-00L §17/§19](contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md#17-实施状态更新2026-11-03) 已同步修订；wire 与持久化字节未变，实模/页面/CP5 不代签。

> 2026-11-06：B71 裁决 4 C 依赖图下沉完成——canonical Request IR 契约族（`RequestIR`/`Tools`/`SystemEnvelope`/`Compaction`/`Operation`/`SystemIdentity`）下沉 [novel_common](../../apps/novel_common/README.md)，Provider wire 投影（`NovelAgent.Provider.Projection`）与能力事实（`CapabilityProfile`）保留 `novel_agent` 执行边界；`novel_test` 去 `novel_agent` 依赖并承载跨 app 请求契约 helper；`arch_check` 新增 common/test 边界与跨 app test-support 白名单。wire 与持久化字节未改变，实模/页面/CP5 不代签。详见 [VS-00L §17](contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md#17-实施状态更新2026-11-03) 表末行与 [ADR-0033 §6](adr/ADR-0033-authoring-run-transcript-request-ir-v3.md#6-contract-与边界影响)。

> 2026-11-04：B71 R1 源头重构——实际路由单源（Gateway 一次解析并派生能力）、三类 adapter 原生投影消费、测试替身移出生产注册表、初始快照按 [VS-00L §19.2](contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md#192-初始快照与追加历史的职责r1-真实前缀反例) 构造；已删除 `to_provider_prompt/2`、`RequestIR.from_legacy` 与构造/执行双身份比对。**实现位于未提交工作区，待独立验证**；R2/Responses SSE 与 CP5 未完成，不标 done。详见 [VS-00L §17](contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md#17-实施状态更新2026-11-03) 表末行。

> 2026-11-03：B71 CP2–CP4b 的确定性实现与验收已完成（能力事实单一来源、三类投影、原生工具调用/流式/Responses 传输、规划/使命/修订/质量/确认交接、显式压缩派生；xref/arch/不变量/全量测试门禁通过），见 [ADR-0033](adr/ADR-0033-authoring-run-transcript-request-ir-v3.md) 与 [VS-00L §17](contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md#17-实施状态更新2026-11-03)。仍未闭环：CP3b 实模、压缩前端入口设计授权、CP5 最终收口；设计接受与机制通过不代表真实模型行为或文学质量（I10）。

> 2026-10-30：作者正式接受 [ADR-0031](adr/ADR-0031-core-chain-semantics-narrowing-v3.md)，[ADR-0022](adr/ADR-0022-agentic-loop-plan-reasoning-authorship-v3.md) 同步为 Superseded；旧稿原文与证据保留。统一裁决等新增实现、历史兼容与真实页面验收仍由原 B01/B43/B45 承接，设计接受不代表产品完成。

> 2026-10-29：作者已正式接受 [ADR-0030](adr/ADR-0030-evidence-seeking-authoring-v3.md)、[VS-00K](contracts/VS-00K-evidence-seeking-authoring-contract-pack.md)、[AU-15](acceptance/author/AU-15-evidence-seeking-authoring.md) 为 B39 实施基线；产品与新增 CI 不变量仍待落实。各设计章节中带 2026-10-27 日期的 Proposed 增补保留为当时记录，当前决策状态以 ADR 正文为准。

> 2026-11-01：[Goal-centric 持续运行目标架构初稿](00e-goal-centric-runtime-architecture-review.md)暂缓评审。作者指出尚需研究思考，且初稿未全面核对项目愿景与元原则；B77 已从 NEXT 移除，暂停 R1–R7 裁决及后续 ADR / 实现规划。`00d` 与现役 Accepted ADR 仍是实现基线。

> 状态：当前唯一设计真源
>
> 适用范围：AI Novel Studio 当前产品、架构、contract、ADR、验收设计、UI 设计与 schema/codegen 追溯。

`docs/design/` 是本仓库当前唯一设计文档体系。主阅读路径不再保留 `design-v2` / `design-v3` 两套并行目录；历史版本标签只允许出现在必要的迁移背景、文件名兼容或测试命名中，不能作为当前设计入口。

新增或修改设计时，优先更新本目录下的对应子目录；不要新建版本化设计目录。

## 目录

| 目录 | 角色 | 典型消费者 |
|---|---|---|
| `00*.md` / `01*.md` ... | 当前主链、运行时、状态、工作台、小说要素设计 | 架构评审、slice 规划、实现前读图 |
| `adr/` | 当前唯一 ADR 目录 | implementation plan、代码注释、contract pack |
| `contracts/` | 当前唯一 contract pack 目录 | backend/application/domain/frontend contract 对齐 |
| `acceptance/` | 当前唯一验收设计目录 | scenario acceptance、slice 验收、质量台账 |
| `ui/` | 当前唯一 UI 设计、Pencil 原型与追溯目录 | 前端组件头部追溯、`scripts/check_design_trace.sh` |
| `schemas/` | 当前 JSON Schema / enum SSOT | codegen、schema 漂移检查、兼容层 |
| `tech-stack/` | 当前技术栈、Tauri、前端、数据库、部署与开发约束 | AGENTS、审计脚本、开发者 |
| `domain/` | 小说领域模型、上下文组装、阅读投影、创作生命周期 | application/domain/frontend 消费者 |
| `quality/` | 小说质量门禁、人审与 adoption 原则 | 质量体系、验收 manifest、UI action/adoption |
| `foundation/` | Provider、审计、安全预算、基础架构和 contract glossary | gateway、trace、security、cross-app contract |
| `notes/` | 讨论材料和运行经验 | 背景输入；不能直接授权实现 |

## 整合原则：以 v3 为主体，吸取 v2

目录合并只是把文件归到一处；**实质整合是单向的——以 v3 为指导和原则，对 v2 内容进行吸取**。v2 不是一个与 v3 并立的永久权威层，而是"待吸取的材料源"：有价值且符合 v3 原则的内容被吸收进 v3 体系并归 v3 治理，被 v3 推翻的内容标 superseded，与 v3 原则冲突的内容淘汰。终态是**一个由 v3 组织、按 v3 原则运转的单一体系**，"v2" 作为来源概念逐步消解。

任何 AI 读到看似"两个时代"的文档（如顶层 `06` 与 `domain/26`）时，一律以 v3 为判断标准，而不是按文件标题里的 `v2`/`v3` 字样判断权威。

### v3 指导原则（判定 v2 内容的尺，详见 `00`§2/§5/§10、`01`§3）

1. Dialogue-first / Agent-native，不再 Router-first。
2. 会话结构是 Agent 内核；prompt 只是其在某 provider 上的投影，真正契约是 AIMessageEnvelope/DialogueFrame/ContextPacket/MicroPlan/ToolInput/ToolResult/TurnResult/Trace。
3. AI 引导式创作三层契约（小说层 / 当前作品层 / 本轮引导层）投影到每次 AI 调用的 message layer。
4. Contract-first，系统约束不藏进 prompt；意图用 AI 语义判断，不前台化 slot、不靠关键字。
5. Planner 提建议，Execution Orchestrator 掌执行权；Planner 不能批准自己的执行。
6. Workbench 是工具箱，不是作者前台流程。
7. 写入默认 tentative，经 adoption / confirmation / policy 放行。
8. 可审计可回放；replay 默认不重调 LLM。
9. 上下文最小可解释（Context 不是全量 dump，省略要可解释）。
10. 领域建模骨架是要素 × 层级 × 三态（设计态/实现态/进度态，见 `08`）。
11. 改动按承重垂直切面，回答 Contract / Invariant / Boundary / Consumer / Proof。
12. **语义对账**（2026-08-30，D8 病理）：意图用 AI 判断只是半程——对判断的对账同样
    必须存在。模型的理解层（reason/叙事）是校验输入不是展示品；理解与行为（action/
    capability/字段）在同一响应里自相矛盾时必须被看见（拦下或留痕），不得只消费
    结构化字段而把语义当废气。形式合法性校验（schema/enum/白名单）不能替代语义
    忠实性校验。
13. **缺口诚实律**（2026-08-30，D7+D8 同根判据）：系统在信息或能力缺口处的正确行为
    是显式承认缺口并给出最近可行路径，而不是用默认值或最近邻填平。数据缺口不得硬补
    破坏性默认（D7：intent 缺失≠覆盖正文）；能力缺口不得硬选最近邻（D8：无写入能力
    ≠选只读 archive_read）；不可逆动作 fail-safe，可选元数据不 fail-hard。
14. **求证式创作**（2026-10-27，详见 `00-vision-and-engineering-roadmap.md` §2.4）：
    APP 只主动提供不可猜测的最小可信底座；规划、正文和修订中的模型按需求取作品知识，
    观察进入后续请求，既有事实引用绑定真实证据。新增固定 prompt packet 不得作为补知识
    漏洞的默认方案；求证仍须受预算、权限、留痕和作者采纳边界约束。

### 对 v2 每块内容的吸取判定

| v2 内容相对 v3 | 处置 |
|---|---|
| v3 已表述 | v2 对应内容标 superseded → 指向 v3，不再作为权威 |
| v3 未表述、符合 v3 原则、仍有价值 | 吸取：上提进 v3 主链/contract，或作为 v3 体系的领域层明确归 v3 治理 |
| v3 未表述、纯领域知识（如对象/连续性/风格细节） | 保留，但重新定位为"v3 体系的领域层"，服从 v3 原则，不再以"v2 遗产"身份存在 |
| 与 v3 原则冲突 | 淘汰 / 标废弃 |

### 目录角色（整合后）

| 层 | 目录 | 角色 |
|---|---|---|
| 主链（v3 主体） | `00*`–`08*` | 架构、交互模型、对话协议、执行编排、状态机、记忆/上下文/trace、UI 契约、小说要素模型 |
| 领域层（归 v3 治理） | `domain/`、`foundation/` | 小说领域细节与横切契约；按上表逐篇吸取，服从 v3 原则 |
| 冻结层 | `adr/`、`contracts/`、`schemas/` | 决策、契约、schema 冻结点 |
| 验证层 | `acceptance/`、`quality/` | 场景化验收口径与质量门禁设计 |
| 资产层 | `ui/`、`tech-stack/`、`notes/` | UI 设计/原型、技术栈、讨论材料 |

> 整合状态（2026-06-14）：路径与交叉链接已统一到 `docs/design/...`；本节确立"以 v3 吸取 v2"的整合原则与判定尺；各领域层文档的逐篇吸取（重新定位、superseded 标注、上提）按 `tasks/` 中的整合台账推进。

## 当前入口

建议阅读顺序：

1. `00a-reading-map.md`：按角色选择阅读路径。
2. `00c-state-and-contract-atlas.md`：查状态、contract、ADR 和 slice 入口。
3. `00d-runtime-architecture.md`：确认运行时边界。
4. `adr/README.md`：确认当前冻结决策。
5. `contracts/`：查具体 contract pack。
6. `acceptance/README.md` 与 `acceptance/SCENARIO-BLUEPRINT.md`：查场景化验收口径。
7. `ui/README.md` 与 `ui/traceability/screen-to-doc-map.md`：查 UI 实现追溯。
8. `00f-capability-atlas.md`：查「实现态功能域 → 真实入口 → 证据 → 缺口」（写/完善功能前先定位所属域）。

## 合并来源

本目录整合了原两套设计体系中仍有效的内容：

- 当前主链、ADR、contract pack、验收设计、运行时架构来自原当前设计主干。
- Tauri / frontend / schema codegen / UI 原型与追溯来自旧技术栈与 UI 资产。
- 小说领域模型、阅读投影、质量门禁、human approval / adoption、Provider、安全预算、审计等仍有效原则已并入对应子目录。

未迁入的旧 phase roadmap、旧 Router-first 设计、旧版本 ADR、历史 review 与过期状态说明已从主文档路径删除，避免继续误导 AI 或开发者。

## 写作规则

1. 当前设计引用必须使用 `docs/design/...`。
2. ADR 必须落在 `docs/design/adr/`，contract pack 必须落在 `docs/design/contracts/`。
3. UI 组件追溯必须指向 `docs/design/ui/...`，并通过 `bash scripts/check_design_trace.sh`。
4. JSON Schema / enum SSOT 必须指向 `docs/design/schemas/...`。
5. 若材料只剩考古价值，不放回主阅读路径；除非当前设计明确引用，否则删除。
6. 任何会改变产品、contract、验收或代码边界的文档调整，都要同步 `docs/project-ledger.md`、`tasks/NEXT.md` 或 `quality/` 中相关事实入口。
