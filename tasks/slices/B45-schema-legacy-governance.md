# B45：Schema 与输出契约治理——现役、历史兼容与真实消费者

- 状态：**todo（2026-10-30 ADR-0031 相关设计前置已解除，CP0–CP3 未开工；五账等对象级依赖逐项核对，不增无消费者字段）**。
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
| CP0 | 全量 `$ref`/enum/生成物盘点；交付 §7 字段/状态→producer→转换→校验→consumer→历史兼容映射与首批三链修改清单；逐项处理13个部分承接schema，保留legacy/现役/血缘/any分类 | 未开工 |
| CP1 | 冻结逐类处置与错误矩阵：真实所需类型含 reply_only、schema/opaque/local contract、失败与空结果区别、动作/旧字段兼容；与 B43/B06 联动，不盲补旧架构 | 未开工 |
| CP2 | 实施必要 schema/codegen/registry/读取兼容及真实边界校验；typed map/opaque 不免检，悬空 schema 不冒充已校验；不让 legacy 进入当前 wire 误校验 | 未开工 |
| CP3 | codegen/新旧 v3/内部输出回归与负例，真实前端/模型消费证据，文档/README 更新；旧兼容测试逐项归属，运行时缺口不由纯 schema 通过代签 | 未开工 |

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
