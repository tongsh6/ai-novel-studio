# B45：Schema 与输出契约治理——现役、历史兼容与真实消费者

- 状态：**doing（2026-10-31 CP0/CP1 done；CP2 partial：turn_result_v3 已加 optional orchestrator_decision typed 契约并 codegen/前端校验；trace_summary/truthfulness、ledger enum、agent_run_state 与 CP3 未做）**。
- 登记日期：2026-10-27；来源：v2 `$ref` 缺失导致 `z.any()`、旧 enum 与现行 v3 不一致、部分生成物无法提供有效校验。
- 上游：[B49](B49-core-semantics-and-adr-review.md)、[B06 五账 schema](../2026-10-27-design-to-execution-reconciliation.md)、[DS01](DS01-decision-surface-schema-gate.md)、[schemas/README](../../docs/design/schemas/README.md)。

## 1. 问题

`turn_result_v2` 多个 `$ref` 目标不在 schema 树，codegen 会把不可解析位置降级为 `z.any()`；`phase_next_action_compat` 等生成物也不是有效约束。旧大写 TurnPhase/NextAction/Status 与现行 v3 小写 wire 不是一套语义，`behavior_status` 还缺当前状态值。

风险不是“老文件没删干净”，而是：

- 把 legacy 的宽松/失效结构误当现行 SSOT；
- 把有意的现行 v3 局部校验误写成全面收紧；
- 为追求形式完整重新引入旧架构或无消费者字段。

## 2. 开工七问

1. **Contract**：ADR-0031（Accepted）、schemas README、codegen、Foundation 兼容测试、现行 TurnResult v3/barrel、B49 的统一裁决类型/动作治理/分层输出校验与 VS-00F 的真实 wire consumer。
2. **Invariant**：legacy 与现役不可混用；每个 `$ref` 可解释；不得把意外 `z.any()` 当收紧；不得为消账盲删兼容层或新增无用途字段；只变更 R2/R3/R5/R6 实际消费者所需的契约，已有其它业务及历史读取保持兼容。
3. **Boundary**：schemas、frontend codegen/generated、registry/ToolResult/Observation 的契约声明、必要的 common/domain/adapter 边界检查、兼容测试与文档；不重写业务流程，不预建新表/UI。TS 类型沿 schema/codegen，不手写平行类型。
4. **Consumer**：当前 v3 前端、B43 统一裁决 producer/trace/replay、内部读取/模型观察消费者、Foundation 兼容层及 codegen。
5. **Proof**：引用解析矩阵、legacy/现役 wire 对照、生成物非意外 any、新旧 wire 的 safeParse/历史读取、真实动作/内部输出的必要字段与失败/空结果矩阵、旧兼容测试归属明确；新增规则必须被实际消费者执行。
6. **Acceptance Driver**：codegen/schema/运行时边界负例加真实 Channel/前端消费；涉及统一裁决、动作与输出链时与 B43 的外部真实工作台场景联合取证，不以 schema PASS 代替产品链；产品验收感知逻辑 **no**。
7. **Exploration**：schema 来源与 legacy 状态可查；无消费者的字段不生成新功能，不新增探索面。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 全量 `$ref`/enum/生成物盘点；交付 §7 字段/状态→producer→转换→校验→consumer→历史兼容映射与首批三链修改清单；逐项处理13个部分承接schema，保留legacy/现役/血缘/any分类 | **done（2026-10-31，§8）**：38 份 schema/$ref/生成物/消费者全量盘点（artifact）；三链字段级矩阵；13 部分枚举逐项处置；active/legacy/any/未来预留分类明确 |
| CP1 | 冻结逐类处置与错误矩阵：真实所需类型含 reply_only、schema/opaque/local contract、失败与空结果区别、动作/旧字段兼容；与 B43/B06 联动，不盲补旧架构 | **done（2026-10-31，§8.7）**：冻结四类处置（active-typed/active-opaque/legacy-frozen/future-reserved）与 invalid≠empty、unknown enum、历史缺字段兼容规则；CP2 按此实施 |
| CP2 | 实施必要 schema/codegen/registry/读取兼容及真实边界校验；typed map/opaque 不免检，悬空 schema 不冒充已校验；不让 legacy 进入当前 wire 误校验 | **partial（2026-10-31，§9）**：v3 加 optional orchestrator_decision（typed enum/status/trace ref）、codegen 重放、前端合法/非法 decision_type 测试；trace_summary/truthfulness/ledger enum/agent_run_state 未做 |
| CP3 | codegen/新旧 v3/内部输出回归与负例，真实前端/模型消费证据，文档/README 更新；旧兼容测试逐项归属，运行时缺口不由纯 schema 通过代签 | 未开工 |

## 8. CP0 盘点记录（2026-10-31）

### 8.1 可复核产物

- 盘点脚本：`scripts/b45_schema_inventory.mjs`（只读 docs/design/schemas、frontend/src、apps/*/lib；不修改 codegen/schema）。
- 运行产物：`artifacts/b45-schema-inventory/schema-inventory.json` / `.md`。
- 首轮结果：**38 份 schema**；`$ref` 共 20 个，**15 个不可解析**（全部在 `turn_result_v2.json`，形如 `foundation/enums/turn_phase.json` 的文件内相对路径被再次加 `foundation/` 前缀）；生成 TS 38 份，`z.any()` 共 **33 处**，分布：turn_result_v2 18、turn_result_v3 9、artifact_adoption_entry 2、ledger_entry 2、phase_next_action_compat 1、ui_card 1。

### 8.2 分类结论（初版）

- **legacy-frozen（非现役线）**：`turn_result_v2.json`（ADR-0015 时代，仅 barrel 历史导出；15 个 broken ref 的 18 个 any 不应误当现役 SSOT）。
- **legacy-compat（生成但无消费者）**：`phase_next_action_compat.json` 生成整份 `z.any()`，前端/后端均未找到真实消费者；CP1 决定保留历史或标记 legacy。
- **active + intentional open shape**：`turn_result_v3`（9 个 any：ui_cards/candidate_directions/adoption_state/trace_summary/truthfulness 等，部分由 barrel 组合收紧；additionalProperties=true 为 draft 惯例）、`artifact_adoption_entry`（payload/catchall）、`ledger_entry`（ledger 枚举 + payload/catchall）、`ui_card`（items/catchall）。
- **active 且前端真实消费**：`user_message_submission`（socket/WorkspaceChat/AuthorQuestionReply `.parse`）、`turn_result_v3`（`turnResultWire.ts` safeParse + WorkspaceChat/UICards 类型）、`candidate_direction`、`ui_card`、`author_choice_action`（barrel safeParse）、`artifact_adoption_entry`。
- **后端生成枚举**：20 份 enums 全部由 `mix codegen.enums` 生成 Foundation 模块；28 个 Elixir 枚举文件。实际消费者：adoption_status 28 文件、memory_source_type 4、memory_type 3、memory_scope/source_type/mutation_status 2、memory_class/retention_tier 1；agent_type/defaultability/inferability/information_ledger_status/ledger/requiredness/scope_dependency/slot_type **当前未找到消费者**（不能自动当实现范围）。
- **13 个部分承接 schema 初判**：agent_type/defaultability/inferability/requiredness/scope_dependency/slot_type 暂归“无现役消费者/未来预留或 legacy，CP1 逐项定性”；memory_* 有真实后端消费者，需补 producer/历史矩阵；mutation_status 有 2 处消费，需核是否仍服务采纳/事务边界；retention_tier 有 1 处消费，hot/warm/cold 无实际迁移消费者不能宣称策略成立；source_type/memory_source_type 边界待 CP1。

### 8.3 首批三链修改清单（初版，CP1 冻结）

1. **统一裁决/TurnResult/trace/replay**：`turn_result_v3.json` 未声明 `orchestrator_decision`/`decision_trace_ref`；当前由 B43 producer 输出、`frontend/src/lib/turnResultWire.ts` 的 TurnResultSchema catchall 容忍，不是 typed 校验。候选修改：新增 optional orchestrator_decision schema（decision_id/decision_type/decision_status/required_author_action/decision_trace_ref）并在 barrel 组合；DecisionTrace 无独立 JSON schema，trace_summary 当前 `z.record(any)`，需决定 typed 局部契约或显式 opaque；历史无 decision 记录继续按 trace 格式读取。owner：B43 产业务事实，B45 只定字段/校验/兼容。
2. **agent_run_state**：38 份 schema 中无对应文件；DS01 §9 负责 schema 接线与 live/dead/unknown/恢复权限，B45 只记录缺口与映射方法，不在本任务造 schema。
3. **五账 status/payload 与面板 DTO**：`ledger_entry.json` 的 `ledger` 当前生成 `z.any()`（应消费 `enums/ledger.json`），`payload` 为 open record；`ledger_information_payload.json` 已存在但未见真实校验 consumer；`LedgerViewService`→Channel→StructurePanel 为真实消费面，面板 DTO 不是领域信封。owner：VS-00F B06/真实五账消费者；B45 定契约/兼容，不替其接线。

### 8.4 CP0 覆盖说明

- 38 份 schema 均有 schema 级盘点（artifact 全量行）；首批三链有字段级矩阵；其余 25 份为枚举/简单结构，值级清单与消费者在 artifact/§8.6；未把“生成物存在”算作真实校验。
- 三链每字段的类型/空值/失败/历史兼容测试入口由 CP1 冻结、CP2 落地；CP0 不声称已验证运行时行为。

### 8.6 13 个部分承接 schema 逐项处置（2026-10-31，CP0）

| schema | 现役值/consumer 证据 | 处置 | 依据/后续 |
|---|---|---|---|
| agent_type | 6 值；Elixir 模块生成但无 backend/frontend 引用 | **future-reserved** | 不生成新功能；B50 延期边界内保留，CP2 不改 |
| defaultability | 2 值；无消费者 | **future-reserved/legacy** | 不参与当前校验；保留枚举，无消费者不声称实现 |
| inferability | 2 值；无消费者 | **future-reserved/legacy** | 同上 |
| memory_class | 4 值；`interaction.ex` 消费 | **active-typed** | 保留，CP2 核 schema/DB/wire 同源 |
| memory_scope | 6 值；adoption_repository、memory_item 消费 | **active-typed** | 保留，历史缺值按 schema default 读取 |
| memory_source_type | 6 值；domain/memory schema/application 4 文件 | **active-typed** | 保留，来源权威性由原 AU09 业务链验证 |
| memory_type | 11 值；persistence 3 文件 | **active-typed** | 保留，召回/治理语义不由 schema 代签 |
| mutation_status | 6 值；mutation schema/adoption_workflow 消费 | **active-typed** | 保留，核采纳/事务阶段映射 |
| requiredness | 2 值；无消费者 | **future-reserved** | 不生成新功能 |
| retention_tier | 3 值；interaction schema 消费 | **active-enum / policy-unimplemented** | 只承认枚举存在；hot/warm/cold 迁移/遗忘无消费者，不能宣称策略成立 |
| scope_dependency | 10 值；无消费者 | **future-reserved/legacy** | 保留历史值，不实现 |
| slot_type | 9 值；无消费者 | **future-reserved/legacy** | 同上 |
| source_type | 8 值；adoption_repository/interaction 消费 | **active-typed** | 与 memory_source_type 边界在 CP2 文档化，禁止同义词表独立漂移 |

补充：`ledger` 枚举当前生成但领域 `LedgerEntry` 硬编码同名列表、无 generated 消费；`information_ledger_status` 无消费者；`behavior_status`/`turn_phase`/`next_action`/`status` 为 v2 大写 legacy 词表，不能与 v3 小写 wire 混用（CP1 冻结，CP2 不把它引入当前 wire）。

### 8.7 CP1 冻结：处置与错误/兼容矩阵

**四类处置：**
1. **active-typed**：有真实消费者且字段/枚举稳定 → CP2 补 typed schema/生成物/边界校验；未知枚举值必须报错或显式 unknown，不得静默当合法。
2. **active-opaque**：消费者真实需要开放形状（payload/opaque tool output/trace_summary 未知键）→ 显式 opaque 契约 + 允许键集合/透传规则；不得用 `z.any()` 冒充已校验，也不得擅自全面封死。
3. **legacy-frozen**：v2/phase_next_action_compat/大写 legacy 词表 → 不进入当前 wire 校验、不迁移历史、不删除读取；生成物 any 保留为历史事实，不写成 SSOT。
4. **future-reserved**：无真实消费者 → 保留 JSON/生成物但不接入运行时校验；新增消费者前须回 B45/对应 slice 登记，不因枚举存在自动实现。

**错误/空结果规则：**
- 合法空结果（空账/无报告/空列表）与校验失败必须区分：失败返回显式 error/invalid，不得降级成成功空对象；读取失败不得伪装空账。
- 历史记录缺字段：按 schema `optional`/明确 default 读取；缺必需字段时返回历史兼容错误，不静默伪造。
- 旧 wire（v2）只按历史格式读取，不参与当前 TurnResult safeParse；当前 v3 未知顶层键按 `additionalProperties=true` 容忍，已知决策面字段按 typed 局部契约校验。
- 动作/旧字段兼容：`available_actions` 仍唯一 UI 动作来源；不因收窄 schema 删除旧动作或伪造通过。

**首批变更清单（进入 CP2）：**
- turn_result_v3 增加 optional `orchestrator_decision` typed 局部契约（与 B43 producer 字段一致；旧记录无此字段继续可读）；
- trace_summary/truthfulness 从 blanket any 改为 typed 局部契约或显式 opaque（至少 decision_type/decision_id/decision_trace_ref/tool_called/production_write_performed）；
- `ledger_entry.ledger` 与 `enums/ledger.json` 同源，取消领域硬编码漂移；payload 分账局部契约由 VS-00F B06 提供；
- agent_run_state schema 交 DS01 §9，不在本任务造；
- v2/phase_next_action_compat 标记 legacy，不列入当前校验；codegen 不解析跨文件 $ref 的事实写进 README/CP2 说明。

### 8.5 首批三链字段级映射（2026-10-31，CP0）

#### A. 统一裁决 / TurnResult / trace / replay

| 字段/结构 | 设计依据 | producer | 转换/序列化 | 校验点 | consumer | 持久/历史 | 处置 |
|---|---|---|---|---|---|---|---|
| `orchestrator_decision`（v3 未声明） | ADR-0031 §2.1/R2=A；B43 §10 | `OrchestratorDecision`（reply_only/exploration/capability_gap/require_clarification/allow_tool…）经 `TurnResultBuilder.build/8` | 只投影 decision_id/type/status/first_blocking_gate/required_author_action/decision_trace_ref（`maybe_add_decision/2`） | 当前 `TurnResultSchema`（barrel）无该字段 typed 规则，v3 `catchall(any)` 宽容；**不是实际校验** | `frontend/src/lib/turnResultWire.ts` safeParse、WorkspaceChat/Why、B43 Replay | 旧 turn 无该字段；新 turn 才产生。无迁移、不得回填伪造 | CP1 冻结 optional schema（含 decision_type 枚举/reply_only 等）并在 barrel 组合；B43 产业务事实，B45 定契约与兼容测试 |
| `trace_summary`（`z.record(any)`） | ADR-0014/0031 §2.1 | `TraceWriter.record/4`（含 decision_id/reason_codes/orchestrator_decision） | 已脱敏 map | 无 typed 局部契约；Why 读取时自行取键 | `traceSummaryView.ts`、Replay/Why | 历史 trace 格式保留；缺 decision 的旧 trace 按 trace 读取 | CP1 决定 typed 局部契约或显式 opaque；至少把 decision_type/decision_id/decision_trace_ref 纳入可校验字段，未知键保留 |
| `truthfulness`（`z.record(any)`） | 00c/ADR-0004 诚实性 | `TurnResultBuilder.build_truthfulness/3` | map | 无 typed 契约 | 前端/B43 验收断言 | 历史无字段时消费方需容忍 | CP1 冻结必要布尔/枚举字段（tool_called/production_write_performed/decision_type 等） |
| `turn_result_v2` 15 broken refs / 18 any | ADR-0015 历史冻结 | 无现役 producer | codegen 双前缀路径未解析 → any | barrel 仅历史导出 | 无现役消费者（仅类型导出） | 历史冻结，不迁移 | 不把 v2 any 当现役 SSOT；CP1 决定保留历史方式（修 ref 或标注 legacy），禁止用它约束当前 wire |

#### B. `agent_run_state`

| 结构 | 依据 | producer | 转换 | 校验点 | consumer | 历史 | 处置 |
|---|---|---|---|---|---|---|---|
| `agent_run_state` Channel 事件 | DS01 §9；B45 §7.2 | `workspace_channel.agent_run_state_payload/2`（run + runtime 快照） | run struct → string keys；`trigger/interrupt_state` stringify atom | **无 JSON schema/safeParse**；前端 `AgentRunStateData` 为手写接口（socket.ts:295） | `frontend/src/lib/socket.ts` 事件、`agentRunAnchoring.ts`、WorkspaceChat | 无 schema 版本；缺字段靠 optional | 38 份 schema 中无对应文件；由 DS01 §9 建 schema/codegen/live/dead/unknown/恢复权限验证；B45 只记录映射方法与缺口，不抢建 |

#### C. 五账 status/payload 与面板 DTO

| 结构 | 依据 | producer | 转换 | 校验点 | consumer | 历史 | 处置 |
|---|---|---|---|---|---|---|---|
| 领域 `LedgerEntry` 信封 | VS-00F §2.1/ADR-0026 | `LedgerRepository.upsert`、`LedgerMaintenance` | domain struct → persistence map → `to_map` | `ledger_entry.json` 生成 TS：`ledger: z.any()`、payload/catchall open；无运行时 safeParse | 前端无直接消费 | DB 存 payload/map；历史缺 revision/裁决字段按读取默认 | 领域信封不是面板 DTO；CP1 把 ledger 字段收紧到 `enums/ledger.json` 或明确 opaque，payload 分账局部契约由 VS-00F B06 owner |
| 面板 `LedgerThreadEntry` | ui43 §5 / `LedgerViewService` | `LedgerViewService.threads/1`（`thread_entry/1` Map.take） | DB map → 按五账分组 map | 无 schema；前端 socket.ts:870 手写 interface | `get_ledger_threads` Channel、StructurePanel 脉络 | 空账返回空列表（不伪造） | DTO 使用 `id` 而非领域 `entry_id`/`work_ref`，不能强套领域信封；CP2 新增面板 DTO 契约或复用 generated 局部 schema，并保留历史读 |
| `ledger_information_payload.json` | VS-00F §2.4 | 未见真实 producer/validator | JSON 文件存在但未接入 | 无 | 无 | — | CP1 判“未来预留/待裁决”，无消费者不生成新功能 |

## 9. CP2 实施记录（2026-10-31，partial）

- `turn_result_v3.json` 新增 optional `orchestrator_decision`：decision_id、decision_type 枚举（含 reply_only/exploration/capability_gap/require_clarification 等 ADR-0031 类型）、decision_status、first_blocking_gate、required_author_action、decision_trace_ref；旧记录可缺失，缺失不等于伪造已产生。
- 运行 `pnpm codegen:schemas` 重放，生成物 `frontend/src/generated/foundation/turn_result_v3.ts` 得到 typed union；`TurnResultSchema` 通过 barrel 继承。
- 前端 `turnResultWire` 测试：合法 reply_only decision 无 issue；未知 decision_type 产生 `orchestrator_decision` 路径漂移 issue，不冒充通过；全量 frontend 638/638、typecheck 通过。全量 backend mix 1048/0（schema 变更只由前端消费）。
- 未完成：trace_summary/truthfulness 的 typed 局部契约、ledger enum 同源（领域硬编码漂移）、agent_run_state schema（DS01 §9 owner）、错误/历史兼容运行时负例与 CP3 真实消费证据。

## 4. 非目标

- 不删除所有旧 schema 或把所有 `z.any()` 都当错误。
- 不把 `turn_result_v3.additionalProperties=true` 与 barrel 的局部收紧改写成全面封闭。
- 不为“更严格”新增无消费者字段、卡片、工具或 UI。
- 不重复实现 DS03 当前 `agent_run_state` 新 schema；它由 DS01 §9 承接，本任务只协调共同映射方法与必要兼容规则。
- 不把旧 enum 的 x-adr/x-source 直接改成“看起来更合理”而不查历史血缘。

## 5. 验证与恢复

- 所有现行 `$ref` 可解析或有明确 opaque/legacy 解释；没有意外 `z.any()` 被写成 SSOT。
- legacy 不污染当前 v3 safeParse/页面行为；兼容测试不被误删或误改。
- 恢复时先读 B49 的语义裁决和 VS-00F schema 任务；没有真实消费者的字段不进入实现队列。

## 6. 2026-10-30 裁决承接

依据 [B49 基线收口](B49-core-semantics-and-adr-review.md#716-c02-实施基线收口)，本任务承接 R3/R5/R6 的必要契约变化，原“现行 v3 完全不变”仅适用于旧纯清理基线，不得用它阻止已确认的普通回复统一裁决字段及其消费接线。

每类输出都须有明确 owner、消费者、类型/必要字段、错误形状与相应验证。opaque 不免检，未经契约定义的无效输入不能静默成为成功空结果；跨层复用同源 schema 允许，禁止独立漂移规则。B43 负责裁决生产与执行链，B45 不替它造业务结果；来源引用的生成/存在性由原 B01 承接。本次只有任务细化，代码与 schema 未改。

## 7. 字段与消费者映射交付（2026-10-30 纳入队列）

作者在本聊天确认将 schema 映射与首批三条消费链纳入任务队列。本节细化原 CP0–CP3，不新建平行 schema 任务或提前接受未决字段策略；各 CP 仍未开工。

### 7.1 CP0 的具体产物

以现有 38 份 JSON schema 为初始清单，另列首批链路确需但尚缺的结构；开工时按实际目录刷新数量。映射写在本原任务的 CP0 交付记录，运行报告放 `artifacts/`，不维护第二份执行状态表。

每个现役字段、枚举/状态及边界至少记录：

| 映射内容 | 必须回答的问题 |
|---|---|
| 设计依据与语义 | 来自哪个 contract/ADR 章节；字段、状态或枚举值表示什么，谁有权产生？ |
| producer | 哪个真实入口/模块产生值；失败、缺失、未知与合法空结果如何区分？ |
| 转换/序列化 | 领域对象、数据库结构、wire DTO 各是什么；转换由谁负责，哪些字段有意不暴露？ |
| 校验点 | 哪个真实边界执行 schema/safeParse 或本地契约；类型声明不能代替实际检查。 |
| consumer | 哪个前端、应用、模型观察或回放消费者实际使用；消费的是生成类型还是平行手写结构？ |
| 持久化与历史 | 是否存储、如何读旧记录/缺字段、版本或状态变化如何兼容；无存储需求时明确不适用。 |
| 处置与证据 | 现役补链、历史兼容、未来预留或语义待裁决；给出原任务/CP、具体修改与正反例。 |

领域 schema、存储结构和前端 DTO 可以不同，映射必须显式且有测试；不得为了同名同形暴露不必要字段或改变权威来源。`$ref` 无法解析、意外 any、仅 `as Type` 的接收点要单列；有意 opaque/局部开放结构须给出消费者与边界依据，不能统一封死当前 wire。

CP0 完成标准：清单无漏项，首批三链有可执行修改清单；每个未核清项都有具体问题、受影响消费者与处置入口。仅检索到引用、生成出类型或把未知标成“已覆盖”不满足标准。CP1 再冻结必要的错误/兼容策略，产品取舍冲突需给可审阅选项，不由映射自动批准。

### 7.2 首批三条链与唯一责任方

| 链路 | 本任务交付 | 业务实施/完整验收的原 owner |
|---|---|---|
| 统一 OrchestratorDecision / TurnResult / trace / replay | 普通回复、执行、等待和失败出口的类型/字段/转换、必要校验与历史读取矩阵；与 B01 核真实来源 | [B43](B43-gate-order-residual.md) CP0/CP2/CP3；B45 提供必要契约，不替它生成业务裁决 |
| agent_run_state | 记录现役 wire、缺失语义、schema/codegen 与边界兼容，复用同一映射方法 | [DS01 §9](DS01-decision-surface-schema-gate.md#9-ds03-agent_run_state-schema-承接) 负责 schema 接线与 live/dead/unknown、恢复权限验证；不在 B45 重做该实现 |
| 五账 status/payload 与面板 DTO | 明确领域信封与脉络响应的字段投影，分账状态/载荷的约束、生成和兼容 | [VS-00F B06](VS-00F-five-ledgers-three-state.md#b06-分账契约与真实消费-checkpoint) 负责真实五账消费者链；不能直接把 entry_id/work_ref 信封套到使用 id 的面板 DTO |

三个 owner 可以先各自核对已明确的消费者，不以整个 B45 全量清理完成作为开工前置。B43 的幂等/behavior/blocked、DS01 的恢复权限、VS-00F 的真实页面与历史读取仍是完整范围，不能缩成只改 JSON。

### 7.3 十三个部分承接 schema 的逐项处置范围

以下来自逐文件审计，**均待实际用途核定**；登记不表示要实现每个预留枚举值，也不拆成十三个孤立任务。CP0 的结果逐项进入“现役补链 / 历史兼容 / 未来预留 / 语义待裁决”，保留设计来源及处置依据。

| schema（foundation/enums） | 需核清的映射与生命周期 |
|---|---|
| agent_type.json | 当前运行 profile 与历史角色分类；遵守 B50 延期边界。 |
| defaultability.json | 默认值的真实来源、允许条件及校验位置。 |
| inferability.json | 旧槽位推断前提与当前判断/计划语义。 |
| memory_class.json | 基础记忆分类与小说领域记忆的对应关系。 |
| memory_scope.json | WORK/SESSION 及 GLOBAL/VOLUME/ARC 等值的实际读写消费者；未开放范围须明确条件。 |
| memory_source_type.json | 作者、模型、导入等来源的权威性与写入路径。 |
| memory_type.json | 各类记忆生成、采纳、治理与实际召回；方向类型裁决仍回原 AU09 任务。 |
| mutation_status.json | 通用 Mutation 各阶段是否仍有现役消费者，与当前采纳/事务边界的关系。 |
| requiredness.json | 必需/可选字段与缺失处理、Gate 输入的对应关系。 |
| retention_tier.json | hot/warm/cold 的实际保留/迁移/遗忘消费者；未实现策略不能只靠枚举存在宣称成立。 |
| scope_dependency.json | 各依赖范围在实际入口和读写隔离中的使用。 |
| slot_type.json | 各槽位类型的现役数据、生成与读取方式。 |
| source_type.json | 与 memory_source_type 的用途边界及消息/trace 消费，避免同义词表独立漂移。 |

### 7.4 CP2/CP3 验证出口

每条实际修改链都须证明合法数据可消费、非法数据按契约处理、旧数据仍按明确策略读取；无效结果不能变成成功空结果。codegen、局部边界负例与外部真实页面分别留证，联合验证裁决/恢复/脉络的当前入口及无额外写入。通用自动 migration 平台、无消费者的完整枚举能力不由本次排期自动启动；发现独立需求先回设计/任务流程登记。
