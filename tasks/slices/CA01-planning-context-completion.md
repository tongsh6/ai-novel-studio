# CA01 规划上下文补全（Order 7 刀二·规划的世界感）

- 状态：**CP1 闭环（2026-07-21）**——字段+投影+工具上下文注入+探索可达全绿；planner 起草层注入与卷投影为登记余项
- 类型：Context Assembly Slice（VS-00C 消费面补全）
- 上游：`06` §5.0 投影表（设计已定义完整投影集）、`VS-00C` §3.1、`08` §7/§8 序位4（NEM-GAP-01）、Order 7 评估（2026-07-21 全景矩阵）
- 领域拉动：M2 实锤——扩章批凭空发明凌云/沈墨/沈逸接管主角团（规划起草层仅 chapter_titles，无阵容/无前情/无卷感/无命题锚）

## 承重六问

- **Contract**：works 表增创作向字段 `premise/theme/main_goal`（NEM-GAP-01，08 §8 序位4"进入常驻上下文"）；规划起草 prompt 新增「作品事实（规划参照）」段（阵容/最近章摘要窗/卷结构/创作锚）；plot_outline 工具路径复用既有 roster/摘要窗段。
- **Invariant**：注入全部机械读取（ADR-0025 规划期机械准备先例，不问模型）；字段缺席诚实缺席不伪造（06 §5.0）；I1/I2/I3 不破；chapter_titles 契约（target_chapter 精确复制）不动。
- **Boundary**：novel_persistence（migration+schema+profile/snapshot select+volumes 查询）；novel_application（planner 段构建+注入、plot_outline 上下文条件扩展、facade reader）。**不改**：判断协议、AgentRun 主链、采纳通道。
- **Consumer**：第一=plot_outline 工具上下文（roster+摘要窗——凭空造角的直接杠杆在工具层非 planner 层，实现中修正认知）；第二=判断 call1 作品上下文块（创作锚自动投影，nil 过滤诚实缺席）；第三=AgenticPlanDraftPlanner 起草层（planning_facts_section，**本轮余项**）。**探索面同步律（口称"第七问"，08 §8）**：创作锚三字段同批入 profile 档案面渲染 ✓；卷投影 ⓒ 与 planner 起草层注入登记余项。
- **Proof**：planner prompt 单测（fake reader 断言四段在场/缺席诚实）+ 全量 gate；产品级效果（扩章不凭空造角/不丢题材）随下次节拍狗粮清算（已入待清算批次）。
- **Acceptance Driver**：既有 `agent-plot-outline-with-context` 真实 Tauri 场景复跑不回归（本 slice 不新增验收感知逻辑）；狗粮为产品级验收载体。

## 范围内明确不做

- premise/theme/main_goal 的**采纳写入链路**（立项对话物化/correction intent 回填）——与 AU-12 world_setting 物化 P2 债同族，登记后续；本 slice 落字段+投影+seed 可填。
- 承诺账扩展（premise/theme 承诺）——待写入链路成立后随 VS-00F 后续。

## CP1 完成记录（2026-07-21）

已落地（全部机械读取，零验收感知逻辑）：

1. **字段**：migration `20260721000003` works 表增 `premise/theme/main_goal`；Work schema cast + `WorkService.normalize_attrs` 白名单同步（漏白名单会静默丢字段，grep 实锤后补）。
2. **投影**：`WorkArchiveRepo.profile` select、`WorkspaceContext.work_snapshot` 带三字段；判断 call1 `judgment_work_section` nil 过滤——字段缺席诚实缺席，不渲染空行。
3. **工具上下文（凭空造角的直接杠杆）**：`character_context_action?` 纳入 `plot_outline`（阵容段进章计划 prompt）；`prior_chapter_summaries_section` 增 plot_outline 分支（摘要窗进章计划 prompt）。
4. **探索面同步律（08 §8）**：`ExplorationService.render_profile` 增 前提/主题/主线目标 三行——创作锚要素物化同批探索可达（本条为用户"七问"追问抓出的缺口，当场补齐）。
5. **测试对齐**：`character_roster_context_test` 原「plot_outline 不注入阵容」断言与新契约对撞，按 M2 实锤反转为正断言；新增 world_building 负例保持边界。

验证：`mix compile --warnings-as-errors` 零警告；全量 1234 测试 0 失败；I1/I2/I3 三不变量绿；快扫 5 项均非触碰文件；真实 Tauri 场景 `agent-plot-outline-with-context` 复跑通过（turn_mrun1y8u_3:agent:4）。

余项（登记不失踪）：

- **planner 起草层** `planning_facts_section`（AgenticPlanDraftPlanner prompt 注入阵容/摘要窗/创作锚/卷结构）——第三消费者。
- **卷结构投影 ⓒ**（volumes 查询进上下文）。
- **写入链路 P2**（见"范围内明确不做"）。
- **产品级效果**（扩章不凭空造角/不丢题材）随下次节拍狗粮清算。
