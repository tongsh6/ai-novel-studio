# 现有实体映射、提案边界与待裁决项

> 归档注：以下正文保留源包 `f13ff640` 的候选设计，不代表当前运行实现；后续契约差异与归属见 [归档说明](integration-notes.md)。

## 1. 审核原则

新增JSON定义不等于新增产品类/表。`$defs`是离线schema复用机制；一个值形状可能映射多个既有契约的派生视图。**不能把105个定义理解为105个需要新建的实体**。

本轮已读取关键源码；未逐行读取的全仓实现不能声称不存在。下面明确区分已核实存在、已有领域语义需要具体字段审查、目标提案和仍缺证据。无历史兼容要求意味着迁移目标契约后删旧消费者，而不是跳过存在性审计。

| 本包概念 | 已存在归属 / 证据 | 裁决与边界 |
|---|---|---|
| Request派生视图/Exchange | RequestIR、AgentRun/Canonical、ProviderRun/DecisionTrace；S03/S16 | **不新建DB/运行聚合**；Exchange仅测试容器 |
| Task/Scope/Constraints | AuthoringTask，S04 | 复用；本包字段可比现有更显式，但需改现役契约，不造并行任务 |
| Run与独立Operation | RequestIR.run、text_operation，S03 | 判别联合用于避免假run；生产统一现有构造入口 |
| System身份/版本 | SystemEnvelope/SystemIdentity，S15 | 复用；样例fixture身份不是生产ref |
| Material/Source/Coverage | RequestIR.refs/observation、AuthoringTask.materials、DialogueContext | 结构化细化是提案；实际读取来源/版本仍由现有端口提供 |
| History/Checkpoint | 会话Canonical、AuthoringSessionHistory/Compaction；S03/S16/S17 | 现有工具交换复用；纯讨论/Scope扩展明确target_design_only，先裁决Frozen |
| NovelElement E01–37 | 小说要素模型，S02 | 名称/层级/三态沿用；payload键是建议，不为每个要素新建表 |
| SceneUnit/ExecutionBrief | ProseExecutionBrief/ChapterPlanDirection/ReaderEffectBrief，S06/S07 | 复用设计态值；缺字段要真实标记，不默默伪造场景变化 |
| Writer原生候选 | CreativeRequest/CreativeProvider.Real/ToolOutputContract，S05/S10 | submit_tentative_artifact已存在；强化具体domain校验，不新增同义工具 |
| QualityRequest/Findings | QualityEvaluationRequest/ProseQualityEvaluator/QualityFinding，S11–S13 | 独立只读评估，不塞进Writer自评替代 |
| Agent工具10个镜像 | JudgmentToolContract/AgentPlanToolContract/创作/质量工具，S08–S12 | 仅镜像审查；生产只有注册表唯一Schema来源 |
| ProviderEvent | ProviderEvent，S14 | 复用事件语义；本包payload是保守白名单子集，不能推断全量生产事件只有这些字段 |
| AuthorVisible字节 | AgentNarrativeSource/AuthorVisible.Text；S16已有审查 | 不造过滤器；哈希/pointer绑定辅助证明，不改原文 |
| AuthorAction/Confirmation | AuthorActionInput/ConfirmationBinding/AuthorActionAdmission；S16 | exact effect/对象/版本重新Gate；字段映射要按真实入口审查 |
| Authority/Delegation | AgentRun.authority_scope/AgentRunPolicy、registry、gate、ApprovalAudit/Receipt；S16 | **完整模式/委托生命周期未证明已实现**；新存储是否必要仍要逐字段裁决 |
| AuthorAsset/StyleSample | Issue#3、现有Memory与B55；S19 | 作者级资产库是确认需求，不是已完成实现。禁止直接把GLOBAL枚举当可用库 |
| Standalone输出Summary/Inventory/Ledger/Mission | S04专业任务种类已有 | 本包严格JSON结果字段是**提议表达**；没有证据表明与当前每个输出parser逐字段一致 |

## 2. 本次明确的新“设计细化”，不是源码事实

- 请求外层protocol/identity/task/context/history/authority的审阅形状；当前生产仍是RequestIR七顶层字段。
- Material统一来源/覆盖值、current_author_insert_at、E01–37 payload子字段与StyleContext细字段。
- ModelResponse/Outcome的归一化审查壳：同现有ProviderOutput/TurnResult/Trace职责映射，不声称该JSON已被现役serializer接受。
- AuthorAction中grant/revoke delegation等新目标动作，授权模式继承/撤销/critical/full/smart的完整矩阵。
- 纯讨论/Scope checkpoint覆盖集合，以及完整的出处和义务保留方式。
- 外部资产的合法作品关联与授权字段；不新增作者资产读取工具，case27明确为未来设计fixture。

这些必须在schema中保留proposed_shape/target_design_fixture标签及源文件关系，不能单纯把status改为Frozen。例子能通过离线校验只说明这一候选表达自洽。

## 3. 仍需明确裁决，不能靠本包静默决定

1. **Scope/纯讨论覆盖**：现役Compaction以真实call_ids闭合为核心，拓展message/scope/turn覆盖怎样表达、原子提交和回查，要修改哪项冻结契约？本包case34是目标示例，不是实现许可。
2. **委托生命周期**：现存配置/receipt能否承载签发、范围、版本、过期、撤销代次与并发？本包仅列必要语义，没有替用户选择新表。
3. **模式/风险矩阵**：目标风险基线、manual只读例外、critical定义、smart确定性策略需要正式阈值/行为裁决；不能凭“>=3对象”等未核实常数实施。
4. **专业payload精确归属**：多场/多条item的顺序、companion允许集合、角色/世界观细字段、维护输出必须以现役领域契约/新经审定契约为真源。通用native item允许additionalProperties并不意味着任意字段可进入canon。
5. **字段位置**：请求视图与RequestIR范围projection如何无损映射？生产不能把本包整份JSON再次封进scope同时还保留旧全量快照。
6. **独立作业身份差异**：RequestIR.text_operation无AgentRun；部分creative facade用request_id作为操作run归属。目标应区分“调用身份”和“真正持久AgentRun”，不能用伪session消除差异。
7. **质量门状态**：无finding/未运行/失败/部分覆盖/已读但未过独立门要分开；规范新增更明确status之前，实际QualityPolicy/TurnResult消费者须一起迁移。
8. **公共数据集/实模结果**：本包不含真实作者全文，不存在真实模型性能与文学提升结论；R01/R18/R19仍需原始请求和真实作者体验证据。

## 4. Clean落地，不保留兼容壳

在上述决定批准后，按既有B87批次替换现役消费者：先来源与材料投影，再Checkpoint/历史、工具和作者可见字节、权限模式/委托、采纳、全链创作和真实验收。对每一项留下old→new消费者清单，删除旧拼串、重复注册表、legacy字段、零消费者handler/测试；不新增暂时兼容“新旧Request都支持”。

目标是“单一事实源和正确职责”，不是“现有类名绝不改变”。SRP允许拆开真正多个变更原因；OCP不禁止修改错误实现；DRY不意味着把语义不同的句子强塞一个巨型抽象；YAGNI不意味着省略已确认授权/审计/恢复的必要设计。
