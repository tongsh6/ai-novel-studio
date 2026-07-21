# CA02 写作/评估事实链（Order 7 刀一）

- 状态：**CP1 闭环（2026-07-21）**——注入基建+两消费者+全门绿；风格对象化与 🔴 门读模型为登记余项
- 类型：Context Assembly Slice（VS-00C 消费面补全，与 [CA01](CA01-planning-context-completion.md) 同族）
- 上游：`VS-00C` §3.1 L3(b)（确认记忆连续性层，标注"已有 AU-09 recall 主链"但对机器指令驱动的写作轮实际失效）与 L4 风格层空位、`06` §4.5.4 召回过滤契约、`23` 风格与作者意图设计、`31` §6.12 缺口注记（evaluator 缺事实基线）、Order 7 评估（2026-07-21 全景矩阵刀一）
- 领域拉动：M2 实锤——设定漂移与伏笔失忆（写作轮拿不到已确认伏笔/规则/状态）；STYLE_RULE/AUTHOR_PREFERENCE 仅探索可查，writer 事前无风格锚、style_fit 只能事后拦；knowledge_boundary 等 🟡 门 evaluator 只有正文+brief 无事实可比对

## 承重七问

- **Contract**：VS-00C §3.1 L3(b)（"相关 confirmed/recallable memory（伏笔/规则/设定）"进写作连续性层）从关键词 recall 兜底升级为**机械分类型读取**（ADR-0025 规划期机械准备先例）；L4 风格层落最小形态=STYLE_RULE/AUTHOR_PREFERENCE 记忆注入（**不建 23 的 style_sample/writing_preferences 对象**，YAGNI，登记为后续）；`QualityEvaluationRequest` 增可选 `facts_context` 字段（novel_common 契约扩展）；消费 06 §4.5.4 召回过滤契约（CONFIRMED/STABILIZED + recallable）。
- **Invariant**：注入全部机械读取不问模型；字段/记忆缺席诚实缺席不渲染空段（06 §5.0）；只读不写（记忆生命周期零改动）；I1/I2/I3 不破；real.ex 三锚点（用户创作简述：/上下文：/重要：）不动，新段标题避开内容级锚点字串（现有角色/作品章节/已采纳章节/目标情绪/已采纳正文）。
- **Boundary**：novel_persistence（WorkArchiveRepo 增 `creative_facts/1` 分组只读查询，既有五函数不动）；novel_domain（AssemblyPolicy 增 `facts_group_limit` 预算字段）；novel_common（QualityEvaluationRequest 增字段）；novel_application（turn_execution_service 两新段+evaluator 输入透传+memory_reader 端口+flows 接线）；novel_agent（prose_quality_evaluator prompt 增事实基线段）。**不改**：real.ex、判断协议、采纳通道、记忆写入/状态机、frontend。
- **Consumer**：第一=prose_writing 工具 prompt（writer 事前看到伏笔/规则/状态/关系+风格偏好）；第二=语义 evaluator（facts_context 作为 knowledge_boundary/character_logic 类判断的事实基线，31 §6.12 🟡 门补输入——**不实现 🔴 四门**，那是各阶段读模型基建，31 明文"不应塞进产出期硬凑"）。
- **Proof**：turn_execution_service 单测（fake memory_reader 断言两段在场/缺席诚实/非 prose 能力不注入）+ WorkArchiveRepo.creative_facts 分组查询测试 + evaluator 请求带 facts_context 测试 + 全量 gate（compile/test/xref/arch/I1-I3/快扫）。
- **Acceptance Driver**：既有 prose 真实 Tauri 场景复跑不回归（本 slice 不新增验收感知逻辑）；产品级效果（设定/伏笔一致性、风格贴合）随下次节拍狗粮清算（已入待清算批次）。
- **Exploration**（08 §8 探索面同步律）：**不适用增量**——本 slice 不物化新要素，注入的记忆本就经既有探索面可达（archive_read 五记忆面 + memory_recall）；无新增探索缺口。

## 范围内明确不做

- 23 的 style_sample/writing_preferences/brief/feedback_patch 对象化——L4 风格层完整形态，待独立 slice。
- 31 §6.12 🔴 四门（worldrule_conflict/timeline_and_state/foreshadowing/serialization_retention）的运行钩子与读模型。
- CREATIVE_DIRECTION 类型与 work_direction 持久化（AU09-work-direction-memory-recall 待拍板）。
- 关键词 recall 通道（DialogueContext.memory_summary）改动——保留原样，与新机械段并存（轻微重复可接受，KISS）。
- plot_outline/其他能力的事实段扩展——规划层事实注入归 CA01 余项（planning_facts_section）。

## CP1 完成记录（2026-07-21）

已落地（全部机械读取，零验收感知逻辑）：

1. **读端口**：`WorkArchiveRepo.creative_facts/1`（一次查询按创作消费分组：伏笔与情节事实/世界规则与约束[不含 STYLE_RULE]/人物当前状态/人物关系/风格[STYLE_RULE+AUTHOR_PREFERENCE]；只回 CONFIRMED/STABILIZED + recallable）+ `NovelApplication.persistence_memory_reader/0`（inject_persistence 门控）。
2. **写作注入**：`turn_execution_service` 增 `memory_reader` 端口 + `creative_memory_sections`（仅 prose_writing；组内按更新时间倒序取 `AssemblyPolicy.facts_group_limit`[floor 8/standard 12/large 20]；条目 summary 主句+content 200 字裁剪；空组空段诚实缺席）；两段入 context_text（L5 之后、作者输入之前），标题避开 stub 内容级锚点；`context.creative_facts.done` 观测日志（空段不发）。
3. **evaluator 事实基线**：`QualityEvaluationRequest` 增 `facts_context`；`run_prose_quality`/`semantic_opts` 透传与 writer 同源文本；`prose_quality_evaluator` prompt 增「作品事实基线」段（缺席诚实缺席）。
4. **接线**：prose_drafting_with_quality（reader_dep）+ dialogue_gateway 确认 re-gate 路径 + judgment_plan（M2 主链执行点）三处；非 prose flow 不需要（能力门控在 service 层）。

验证：`mix compile --warnings-as-errors` 零警告；全量 1243 测试 0 失败（新增 7 上下文单测 + 2 repo 分组测试）；xref 无循环+arch 通过；I1/I2/I3 绿；快扫 5 项均非触碰文件；真实 Tauri `au13-arc-ledger-roundtrip`（穿 prose/采纳/探索主链）带本改动复跑 PASS（turn_mruqs2wb_31）。

**A/B 实锤的既有失败（非本次回归）**：`p1-chapter-draft-generation` 场景在无本改动的基线（e18abe0e）同样超时——verifier 仍等 `planner.form_frame.done`/`planner.form_micro_plan.done` 等判断纪元前事件（07-06 已登记"13 driver 验收语义迁移 Tauri 复跑未闭环"债），登记 NEXT 待清算。

余项（登记不失踪）：

- 23 风格对象化（style_sample/writing_preferences/brief/feedback_patch）——L4 完整形态独立 slice。
- 31 🔴 四门读模型基建（独立 slice，31 明文不塞产出期）。
- 产品级效果（设定/伏笔一致性、风格贴合、evaluator 高置信冲突发现率）随下次节拍狗粮清算。
