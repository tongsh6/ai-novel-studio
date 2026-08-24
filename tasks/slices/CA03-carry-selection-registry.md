# CA03 携带层统一：携带登记表与可见性

- 状态：done（2026-08-24）
- 类型：Carry Slice（四层体系 ②携带层收敛；VS-00C 语义扩展）
- 启动日期：2026-08-24
- 立论：`notes/2026-08-11-establish-carry-process-write-pipeline.md` §2②（「携带层——建得最多
  但碎……无统一的『本次写作该携带什么』语义策略层」）与 §4（携带层统一是独立的刀）。

## 1. 用户 / 系统目标

创作调用（写正文/规划/角色设计/世界观/演化）前往 prompt 里搬状态的十来条通道，收敛成
**一张携带登记表**：每条携带一行登记（id、服务哪些调用点、三态归类、数据源、顺序），
组装按登记表驱动；每次调用发一条 `context.carry.done` 日志——**带了哪些、被门挡了哪些、
哪些诚实为空**，排查携带问题从翻代码变成看一条日志。

**用户拍板（2026-08-24）：先统一不改行为**——本刀提示词逐字节不变；发现的携带缺口
（门的不对称）列成清单交作者逐条拍板，批准的下一刀再补。

## 2. 开工检查（七问）

- **Contract**：VS-00C 新增「携带登记表」节（登记表 = 携带层的 SSOT；纪律：新增携带必须
  登记一行，与 ADR-0024 决策面注册表同款）；`context.carry.done` 观测事件（ADR-0018 口径）。
- **Invariant**：
  - I-C1 行为不变：本刀前后，各调用点的 provider prompt **逐字节一致**（全量测试 + I1/I2/I3 +
    既有场景复跑为证）。
  - I-C2 单一门面：携带条目的「服务哪些调用点」只在登记表声明一处，组装层不再散落
    per-block 门判定。
  - I-C3 日志诚实三分：carried（真带了）/ gated（登记表挡的）/ empty（该带但源为空，
    诚实缺席）——empty 不伪造、gated 不冒充 empty。
- **Boundary**：只动 `novel_application`（`TurnExecutionService` 组装区重构为登记表驱动 +
  新 `CarryRegistry` 模块；渲染函数原地不动）与 `docs/design`；不改 domain/persistence/web/
  frontend/契约字段/replay。
- **Consumer**：① TES 组装（唯一消费登记表的执行者）；② 排查者（carry 日志）；③ 后续
  缺口拍板（登记表即缺口清单的机器底稿）。
- **Proof**：全量 `mix test`（既有 prompt 断言密集：flow 测试断言写作/规划 prompt 内容）+
  I1/I2/I3 + credo/xref/arch；真实 Tauri：新增小场景 `ca03-carry-registry-observability`
  （一次正文 + 一次规划，carry 日志的 carried 集合与登记表一致、锚点段在场）+ 复跑
  `wr01-chapter-mission-before-prose`、`wr02-planning-mission-before-outline` 作行为回归。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh ca03-carry-registry-observability`；
  产品代码零验收感知逻辑（carry 日志是真实运维观测面，非验收钩子）。
- **Exploration**：登记表是代码内目录（非作品数据），非要素物化——不适用。

## 3. 登记表 v1（行为=现状快照，缺口不在本刀修）

| id | 三态 | prose | plot | character_design | evolution | world_building | 数据源 |
|---|---|---|---|---|---|---|---|
| target_structure | 设计态 | ✓ | — | — | — | — | context.structured_chapters |
| character_roster | 设计态 | ✓ | ✓ | ✓ | ✓ | — | character_reader |
| roster_payload(data) | 设计态 | — | — | — | — | — | character_reader（仅 character_roster 工具） |
| prior_summaries | 实现态 | ✓(目标章前窗) | ✓(末 N 章) | — | — | — | chapter_summary_reader |
| prior_prose | 实现态 | ✓(续写/重写) | — | — | — | — | chapter_prose_reader |
| creative_facts | 实现态 | ✓ | — | — | — | — | memory_reader |
| style_guide | 实现态 | ✓ | — | — | — | — | memory_reader |
| work_skeleton | 设计态 | — | ✓ | — | — | — | current_work_snapshot |
| absence_directives | 在场判定 | manifest | manifest | — | — | — | manifest+character/assumption |
| progress_state | 进度态 | ✓(弧光/伏笔/保密) | ✓(五账 digest) | — | — | — | ledger_reader |
| execution_brief | 设计态 | ✓ | — | — | — | — | CreativeDecisionPacket |
| planning_mission | 设计态 | — | ✓ | — | — | — | stage_state（WR02） |
| dialogue_context | 会话 | ✓ | ✓ | ✓ | ✓ | ✓ | ContextAssembler |

（manifest 门=CapabilityFactManifest 是否登记该能力，当前仅 prose_writing/plot_outline；权威表=`NovelApplication.CarryRegistry` + VS-00C §3.5。）

## 3.1 缺口清单（登记表照出的门不对称——只登记，待作者逐条拍板，本刀不修）

| # | 缺口 | 现状 | 潜在后果 |
|---|---|---|---|
| G1 | 正文路径无全书骨架/收官守则 | work_skeleton 仅 plot | 写章模型不知道距目标还有多远（WR01 使命的 skeleton:progress 材料部分弥补） |
| G2 | 规划路径无作品事实/风格段 | creative_facts/style 仅 prose | 扩章计划可能与已确认设定冲突 |
| G3 | world_building 无阵容 | character_roster 门不含 world_building | 设定生成看不见现有角色，易撞名/撞设定 |
| G4 | character_design/evolution 无进度态 | progress_state 仅 prose/plot | 设计角色时看不见弧光停滞名单 |
| G5 | manifest 只登记 prose/plot | absence_directives 其余能力无缺席守则 | 其余能力在地基真空时无守则兜底 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 盘点 12 块的门/源/序，`CarryRegistry` 模块落表 | done | `apps/novel_application/lib/novel_application/carry_registry.ex`：14 行登记（含 data 载体 roster_payload/decision_packet；absence 门=:manifest；dialogue_context=:all）；`carries?/2` 唯一门面 + `carry_report/2` 纯三分 |
| T2 | TES 组装区改登记表驱动（渲染函数原地），`context.carry.done` 日志 | done | 5 个纯开关门（target_structure/character_roster/roster_payload/creative_facts/work_skeleton）切 `CarryRegistry.carries?`（模式分派保留在渲染内）；`character_context_action?` 删除；target_structure/dialogue_context 从 tool_input 上提到装配层（bytes 不变，仅计算位置前移）；`emit_carry` 三分日志 |
| T3 | VS-00C 携带登记表节 + 缺口清单（交拍板，不修） | done | VS-00C §3.5（登记表 v1 + I10 单一门面 / I11 登记纪律 / I12 快照即行为）；缺口 G1-G5 见 §3.1（待拍板） |
| T4 | 测试：carry 日志单测 + 全量回归 | done | `carry_registry_test.exs` 2 例（门快照抽查 + 三分含 gated 不冒充 empty）；application 532 过；全量门禁见 §5 |
| T5 | 真实 Tauri：新场景 + wr01/wr02 复跑 | done | `ca03-carry-registry-observability`（一次正文+一次规划的 carry 三分与登记表一致、prior_prose 空而非被挡、列表互斥、零写入）已落 manifest/driver/verifier/单测；运行结果见 §7 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（`ca03-carry-registry-observability` PASS + `wr01-chapter-mission-before-prose`/`wr02-planning-mission-before-outline` 复跑 PASS = 行为回归干净）
- [x] 后端局部验证（全量 1452 tests 0 failures）；I3 / I1 / I2 PASS
- [x] `mix compile --warnings-as-errors && mix test`；xref 无环；arch_check 通过
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`（442 tests）
- [x] `bash scripts/quality_manifest_check.sh`；`bash scripts/ai_static_scan.sh --top 10`（经 `task_done.sh --slice` 统一收尾）

## 6. 决策日志

- 2026-08-24 — 渲染函数不搬家：登记表只收敛「选取与门」，块的渲染留在原位——搬 1000+ 行
  渲染代码的风险与收益不成比（I-C1 逐字节不变是硬约束）。
- 2026-08-24 — gated 与 empty 分开记：被登记表挡下（设计如此）与源为空（诚实缺席）是两种
  事实，混在一起会让缺口清单失真（M3 排查判例）。

## 7. 试行反馈

- 2026-08-24 — 真实 Tauri PASS（`artifacts/slice-verify/ca03-carry-registry-observability-tauri/`）：
  一次正文 + 一次规划，carry 三分与登记表逐项一致——
  prose：carried=[target_structure, character_roster, creative_facts, progress_state,
  execution_brief, decision_packet, dialogue_context]，gated=[roster_payload, work_skeleton,
  planning_mission]，empty=[prior_summaries, prior_prose, style_guide, absence_directives]；
  planning：carried=[character_roster, progress_state, planning_mission, dialogue_context]，
  gated=[target_structure, roster_payload, prior_prose, creative_facts, style_guide,
  execution_brief, decision_packet]。列表互斥、gated 不冒充 empty、两产物 tentative 零写入。
  同批 wr01/wr02 复跑 PASS（I-C1 行为不变的页面级证据）。
- 首跑抓到一个**我方 driver 预期错**（不是产品缺陷）：`prior_summaries` 在 seed 场景是诚实
  empty——seed 直插 `AdoptionRepository.persist` 不经采纳主链，治理摘要（chapter_summaries）
  不会生成。carry 日志把它正确分类为 empty 而非 gated，恰好演示了三分口径的价值；driver
  改为断言「不被门挡」。**衍生观察**：狗粮/真实使用中若 prose 轮 prior_summaries 长期 empty，
  即为摘要维护断链的告警信号——carry 日志首次让这类断链可被机器看见。
- 缺口 G1-G5（§3.1）待作者逐条拍板；批准的做成下一刀（每补一处=改一条路径 prompt，须带
  场景化验收）。
