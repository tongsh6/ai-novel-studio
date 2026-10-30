# B64：按真实写作坐标消费记忆有效窗

- 状态：**todo（2026-10-30 设计反查登记；CP0 现役反例与契约准备可推进，产品实现和页面验收未开工）**。
- 来源：有效期已在普通 recall 路径验证，但 CA02 的专业创作事实读端口没有目标章或有效窗输入；本轮只读代码核对发现消费边界不一致，尚未运行数据库、真实模型或页面反例。
- 上游：[AU09 有效窗原任务](AU09-validity-window-recall.md)、[CA02](CA02-writing-facts-context.md)、[VS-00C](../../docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md)、[B39](B39-evidence-seeking-authoring.md)。本项保护既有章节级窗口，不等待 B54 新建故事时间读模型，也不重复建设 B39 的求证循环。

## 1. 作者场景与静态缺口

作品已写到第 10 章，作者回到第 3 章续写或重写。设定 A 仅在第 2–4 章有效，设定 B 从第 8 章生效。模型必须知道本轮作用位置与材料适用范围，不能把“全书写到哪里”当作每次创作的目标，也不能把所有确认记忆一律标成当前必须遵守的事实。

该场景已有设计依据：

- [06 §4.5.4](../../docs/design/06-memory-context-and-trace.md#454-更新废弃与召回过滤) 要求当前 work、确认态、可召回且有效窗匹配的记忆进入普通 context/why；窗口外与失效记忆不能默认混入当前事实。
- [08 §7](../../docs/design/08-novel-element-model.md) 的 WritingCoordinate 限定写作与检索边界；坐标不是知识完备证明。
- [AU-09](../../docs/design/acceptance/author/AU-09-story-memory.md) 的 I6/C4 已有章节级过滤验收，原任务明确该证据针对普通 recall，不能外推全部专业模型消费路径。

本次核实的现状：

| 环节 | 代码证据 | 缺口或边界 |
|---|---|---|
| 普通 recall | [MemoryRecallRepo](../../apps/novel_persistence/lib/novel_persistence/memory_recall_repo.ex) 35–55、62–109 行 | 已按章节 UUID→seq 过滤，但当前位置取最大已采纳章 seq；尚未消费本轮明确目标章。未知位置/无效窗口当前为不约束，不能在本任务未经明确设计就改成一律拒绝 |
| 专业事实读取 | [WorkArchiveRepo](../../apps/novel_persistence/lib/novel_persistence/work_archive_repo.ex) 125–134、163–188 行 | `creative_facts/1` 仅传 work_id，查询和投影只有确认态、recallable、类型等条件，没有 `valid_from/valid_until` 或本轮位置 |
| 生产接线 | [NovelApplication](../../apps/novel_application/lib/novel_application.ex) 468–473 行、[正文 flow](../../apps/novel_application/lib/novel_application/agent_run_flows/prose_drafting_with_quality.ex) 1233–1271 行 | 生产 reader 指向 `creative_facts/1`，真实正文 flow 注入该端口，不只是测试 helper |
| 目标身份与消费 | [TurnExecutionService](../../apps/novel_application/lib/novel_application/turn_execution_service.ex) 99–150、208、1188–1196 行 | 已解析 `resolved_chapter_ref` 与 WritingCoordinate，后者传入执行；记忆读取仍只传 work_id。已有真实章身份可复用，不以新时间线表解决接线缺口 |
| writer / evaluator | [TurnExecutionService](../../apps/novel_application/lib/novel_application/turn_execution_service.ex) 363–374、1239、1281–1286 行 | 事实段标为作者已确认且写作须保持一致，并同源成为 evaluator 的事实基线；窗口适用性未随此段传入 |
| 现有测试 | [CA02 读端口测试](../../apps/novel_persistence/test/novel_persistence/work_archive_repo_creative_facts_test.exs) | 覆盖分组、确认态与 recallable，没有目标章/未来生效/过期窗口矩阵；已有普通 recall 测试仍须保留 |

这些证据证明存在静态接线缺口，**不证明某次线上生成已发生错误**。CP0 先用可重复反例验证实际影响；已有 AU09 普通召回通过记录不改写。

## 2. 消费者矩阵与待冻结语义

| 消费者 | 本任务处理 |
|---|---|
| 正文初写、续写、rewrite | 明确真实目标章/当前单元与有效窗关系，writer 与 evaluator 消费同一适用性事实；不能用最大已写章替代明确目标 |
| 规划 | 先区分全书/未来规划与当前章事实，允许按任务查看历史和未来材料；不得把过滤规则机械套成“未来信息都不可见” |
| 普通对话 recall | 保留无明确目标时的既有回退，明确有目标与无目标如何分工；跨作品和失效态保护不降低 |
| `revise_from_findings` | [ProseRevisionService](../../apps/novel_application/lib/novel_application/prose_revision_service.ex) 346–353、382–404 行当前主要消费原正文与 finding，未核实它存在同一 CA02 注入问题。只做调用矩阵核对，不按猜测新增事实包 |
| 已采纳正文修订 | 沿 B28/B36 的真实目标、基线与材料来源核查；不能把通用写作路径的静态发现直接宣称为独立修订路径的缺陷 |
| 档案、历史解释与探索 | 窗口外资料仍可因明确历史查询而读取，必须表达来源与适用范围；当前有效事实选择不等于删除历史或禁止模型取证 |

CP0 还须明确：未知当前位置、无窗口、无效章节引用、重编号、场级窗口尚未支持、跨章任务的作用范围；这些都不由本次排期直接冻结新默认策略。优先复用 AU09 的章节身份/有效窗规则与现有 `resolved_chapter_ref`；修复既有读取边界，不扩大固定携带内容。

## 3. 开工七问

1. **Contract**：AU09-I6、06 §4.5.4、VS-00C 的坐标/材料边界、既有 NarrativePosition 与 MemoryItem 有效窗、B39 Base/Requested Observation 与来源版本约束；不新增 timeline schema。
2. **Invariant**：真实作用位置决定材料适用性，明确目标不被全书进度覆盖；当前事实与历史/未来资料分开解释；writer/evaluator/why 同源，跨作品与确认/终态过滤不退化；未知不伪装成确定。
3. **Boundary**：application 的目标解析/消费者组装，domain 的纯适用性规则（如确需抽取），persistence 既有查询端口与窗口映射，必要的 trace/why 展示。复用 ProviderExecution；不新建记忆存储或修改作者数据。
4. **Consumer**：首个为真实正文 writer 及 evaluator；随后覆盖普通 recall、规划及按需观察。独立修订路径按 CP0 证据纳入，不能为“全覆盖”添加无消费者数据。
5. **Proof**：旧章/新章、窗口内外、无窗/未知、错误引用、重编号、跨作品的局部反例；检查真实模型请求中的事实、适用性与来源，并核对 why/trace。模型是否据此正确创作须有独立真实行为证据，stub 只证明接线。
6. **Acceptance Driver**：外部驱动真实 Tauri 建立章节和有有效窗的记忆，再从主输入续写/重写旧章、切换目标和新会话，核对实际请求与可见结果；原普通 recall 场景回归。具体 driver 在 CP0 冻结；产品验收感知逻辑 **no**。
7. **Exploration**：同一记忆仍沿既有探索面可达；观察带真实来源和适用范围，后续模型请求与 used refs 不越过实际材料。无需创建新要素，也不靠专用 prompt packet 修补遗漏。

## 4. Checkpoint

| CP | 完整范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 确认消费者矩阵、构造第 10 章回写第 3 章等反例；冻结目标/未知/规划/历史读取的最小适用性契约与驱动；核实缺口后才改代码 | todo |
| CP1 | 真实章身份/作用范围贯穿需要它的读取端口；统一既有有效窗规则，保留无目标回退与历史可查；只修实际消费者 | todo |
| CP2 | writer/evaluator、普通 recall、trace/why 及规划边界同源；覆盖窗口、重编号、错误引用、跨作品、恢复与当前值变化；回归独立修订路径 | todo |
| CP3 | 外部真实 Tauri 完成旧章/新章与跨会话矩阵，分开记录确定性接线和真实模型消费；原 AU09 证据不外推，全部计划内后果齐备才关闭 | todo |

## 5. 非目标与恢复

- 不重建故事时间线、历法、状态快照或风格对象，不提前启动 B54/B55；故事时间与章节有效窗仍是不同概念。
- 不把所有确认记忆固定预装给模型；B39 的最小供给/按需求证方向继续有效，旧供给尚在时仍须遵守正确适用性。
- 不全量过滤档案历史、不静默改作者记忆、不重放已采纳动作；未知/无效边界的新处理先设计，不借修复默认 fail-hard。
- 恢复时先读本任务消费者矩阵、AU09 与 CA02 当前代码，再看 B39 的实际接线；本次仅登记任务，无产品修复、数据库操作或新验收结论。
