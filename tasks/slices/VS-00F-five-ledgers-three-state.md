# VS-00F 五本账与三态对账（M3 主 slice）

- 状态：**CP0 done / CP1 done（2026-07-21）**——契约 Frozen + ADR-0026 + 同批修订全落；弧光账后端全链 + M2 75 章书重放 PASS + 真实 Tauri `au13-arc-ledger-roundtrip` 首轮 PASS（SC-AU13-A1/A2 双验收）。下一步 CP2（承诺账+信息账+对账报告+裁决面）。
- 类型：Domain Ledger Slice（领域层，M3 阶段主任务）
- 启动日期：2026-07-21
- 所属契约：`docs/design/contracts/VS-00F-five-ledgers-three-state-contract-pack.md`
- 上游：`08-novel-element-model.md`（§10 授权冻结/§11.2 立项指令）、`domain/25`（提炼钩子信封）、`VS-00C`（CP2 四栏摘要 + CP4 章计划 = 提炼数据基础，均已闭环）、`VS-04`/ADR-0010（采纳边界）
- 领域拉动：M2 达标跑 Q5 实证（要角/题材随扩章批漂移，`tasks/NEXT.md` 2026-07-21 缺陷账）——07-19 复盘"机制层只在被领域要素拉动时才动"的正向案例

> 本文件是 slice 入口。CP0 = 契约冻结 + 立项；CP1 起逐账落地，每 CP 走完整承重竖切面（提炼→对账→作者裁决→消费闭环 + 外部自动化真实页面验收）。

---

## 0. CP 序列（契约 §7）

| CP | 范围 | M2 验收靶 | 状态 |
|---|---|---|---|
| CP0 | 契约冻结（rev2）+ ADR-0026 + 同批文档修订（25 §5/§8.1、ADR-0018 白名单、00c 回填、schemas 登记、ui/43 §5、AU-13 立档；ADR-0024 修订按拍板④留 CP2+ 按需） | — | **done**（2026-07-21） |
| CP1 | 弧光账最小闭环（信封落地 + arc 提炼/漂移规则 + 自动通过 + archive_read(ledgers) + writer 投影段） | 凌渊 STALLED 被账面暴露 | **done**（2026-07-21：后端 + M2 重放 PASS + 真实 Tauri `au13-arc-ledger-roundtrip` 首轮 PASS） |
| CP2 | 承诺账 + 信息账 + 全量对账报告首版 + 裁决 roundtrip。最小实现步（checkpoint 不缩验收范围）：**CP2a** 两账对象化+增量提炼扩展（genre 承诺条目锚定词来自作品档案自身、正文/摘要前指扫描→LEAKED 条目）+ 对账规则纯函数（R1 弧光停滞/R2 无设计接管/R3 genre 承诺偏移/R4 前指泄露）+ M2 重放实证；**CP2b** reconciliation_report_artifact 物化（TENTATIVE/单活跃/SUPERSEDE 链）+ 章数节拍触发（默认 10，简版；profile 化按契约 §7 归 CP4）+ 作者可见面（ledgers 探索面附最新报告）；**CP2c-1** 裁决服务核心（四处置/裁决态转移/报告记账/双保险）；**CP2c-2** 作者入口（裁决面入册 ADR-0024 或档案页 correction intent）+ revise_* 生成联动（VS-00E §8）+ SC-AU13-B1/B2 场景 | 题材漂移产出 BROKEN 候选；"第60章前指"泄露被报告（CP2a 重放即测）；SC-AU13-B1/B2（CP2c） | **CP2a done**（2026-07-21：重放 PASS——承诺账立账/前指 LEAKED/扫描 5 偏离[3 停滞+genre BROKEN 候选+前指泄露]；证据 artifacts/ledger-replay/m2-replay-cp2a-2026-07-21.txt）；**CP2b done**（2026-07-21：重放 PASS——报告 TENTATIVE 物化 5 偏离、latest 可读、探索面附报告；节拍=seq 整除 10 触发；证据 artifacts/ledger-replay/m2-replay-cp2b-2026-07-21.txt）；**CP2c-1 done**（2026-07-21：LedgerAdjudicationService 四处置+域层 @adjudication_targets 双保险+报告全裁决转 ACCEPTED；M2 报告真实裁决重放 PASS——凌渊 accept_drift→DRIFTED、前指 dismiss、二跑扫描不再重复报警[偏离 5→4，契约"同类信号不再报警"实证]；证据 artifacts/ledger-replay/m2-replay-cp2c1-2026-07-21.txt。**登记**：dismiss 的 Experience Engine 收编——33 尚无运行时代码[07-21 盘点]，现落 ledger.dismiss.done 结构化证据日志作 runtime evidence，Engine 落地时收编本日志族，不发明第二套回路）；**CP2c-2 并入 CP4**（作者裁决入口按拍板④=档案页起步，档案页 Ledgers 模块本就在 CP4——入口+revise 生成联动+SC-AU13-B1/B2 随面板批一体交付，避免发明第二套入口） |
| CP3 | 冲突账（主线条目+设计角色驱动推进：推进/高潮/转折章采纳即主线推进，ACTIVE⇄DORMANT 机械）+ 情绪曲线账（intended=plan_direction.emotion vs realized=摘要情绪栏，二元词重叠判 MATCHED/DEVIATED/UNPLANNED——M2 实测 54/15/6）+ 探索面聚合呈现 | 主线停滞/情绪偏差可查 | **done**（2026-07-21：重放 PASS——情绪曲线 54 MATCHED/15 DEVIATED/6 UNPLANNED 与离线测量一致、主线 ACTIVE last_advanced=74、探索面聚合呈现；证据 artifacts/ledger-replay/m2-replay-cp3-2026-07-21.txt） |
| CP4 | 最小实现步：**CP4a** 规划消费账面（plot_outline 注入五账规划摘要+延续性要求，progress_state 同通道；prose 文案随迁 app 侧）；**CP4b→并入 CP4c**（2026-07-21 承重裁决：profile 化的第一真实消费者=显式发起入口，入口在面板批——无 consumer 不先建 profile）；**CP4c** Ledgers 面板+作者裁决入口[原 CP2c-2]+revise 生成联动+SC-AU13-B1/B2/C1（前端批） | 下次百章狗粮：漂移 30 章内被拦截 | **CP4a done**（2026-07-21：投影渲染单测 2 项+plot_outline flow 注入 ledger_reader；产品级效果随下次狗粮清算）；**CP4c-1 done**（2026-07-22：①用户拍板创作语境命名——用户可见「脉络/审读」，内部契约名不动（ui43 §5.0.1 映射表+Pencil 原型 43§5-9-threads-panel [uyZGw]，基准=当前真实面板+整合红线：审读行并概览/进度态不复制对象列表/处置复用既有动作链）；②后端 LedgerViewService+channel get_ledger_threads/get_review_report+author_action adjudicate_finding 专属 clause（面板作者动作，幂等走 receipt；revise_* 返回 follow_up 由前端回对话流发修订意图）+repo 非 UUID 守卫；③前端「脉络」tab（五脉进度行+审读报告卡逐项四处置+概览审读行+待处置角标+底部发起全书审读）+**对话区限最大列宽修复**（用户反馈：面板收起时左右消息拉满全宽）；④用户可见字串全链改名（探索面/模型侧 digest/driver 断言）。验证：后端 1245+前端 396 测试 0 失败、I1/I2/I3、xref/arch、快扫触碰清零、真实 Tauri au13 复跑 PASS。**CP4c-2 done**（2026-07-22：`ledger_reconciliation_v1` AgentRun profile 落地——flow 镜像 readonly_batch 只读纪律（模型只起草计划两段式 ×2，规则判定与报告物化全程机械=reconcile 步调 CP2b materialize，恰一 tentative 报告走 repo；turn 文案 app 侧事实口径引导「脉络」页，失败诚实失败）；登记 AgentTaskProfileRegistry+规划器步目录+budget+stub/slice_verify 计划 clause；channel `start_full_review` 作者动作起 run 异步于 turn 主链；面板「发起全书审读」按钮改发该动作（其余 tab 仍意图发起）。runtime 测试 2 项（恰一次物化/诚实失败）+channel wire 测试+全门绿+au13 复跑 PASS）。**CP4c-3 done**（2026-07-22：SC-AU13-B1+C1 并场景 `au13-review-adjudication-roundtrip` 首轮链路即通——面板只读视图（五脉+停滞 chip+诚实空报告+只读提示）→显式发起真实 ledger_reconciliation_v1 run→报告 4 偏离→四处置各一例（accept_drift 即时已处置/dismiss 进 ledger.dismiss.done 证据日志/revise_design+revise_prose correction intent 走真实 user_message）→全处置后报告转 ACCEPTED、活跃报告诚实清空；SC-AU13-B2 场景 `au13-revise-prose-sibling`——revise_prose 处置→改写意图（产品文案带"改写…正文草稿…保留原稿"）→判断纪元 CP4 严格裁决下直接产 tentative sibling 修订候选（采纳边界保护，无需确认卡）→阅读投影仍显 seed 原稿（原稿保留实证）。两场景真实 Tauri PASS。顺带修 slice_verify 判定优先级：创作动词（改写/重写/续写/正文草稿）压过查账词（审读/脉络），否则修订意图被误判探索）。**余项**：收起态 rail 待处置计数（小件，登记 NEXT B 项）；定期化 LongRunTask 关联（ADR-0021 A20，随定期化需求）。**顺带 A/B 实锤既有 driver 债**：au12-correction-intent-roundtrip 在 pre-CA01 基线即失败（判断纪元 slice_verify 判 direct_reply，与 p1-chapter-draft-generation 同族，07-06 迁移债），非本批回归 |

---

## 1. CP1 开工检查（承重六问，契约冻结后生效）

- **Contract**：`NovelDomain.LedgerEntry`（契约 §2 信封 + arc payload/状态机，status UPPER_SNAKE）、`hook.UPDATE_LEDGERS`（25 §5 UPDATE_ 族扩员）、`ledger_update_artifact`（25 §8.1 维护家族，复用公共信封字段）、自动通过=系统发起 TENTATIVE→ACCEPTED（ADR-0019 INV-1 合规，LOW 风险门槛）、投影认领 VS-00C §3.0 `progress_state_packet` 槽；schemas 登记 `foundation/ledger_entry.json`+`enums/ledger.json`（x-adr/x-source，入 README 索引与 codegen）。
- **Invariant**：契约 §5 I-L1（证据锚定）/ I-L2（采纳边界，权威账面只经采纳变更）/ I-L3（探索可达同批）/ I-L4（漂移规则确定性）；既有 I1/I2/I3 场景不变量不破。
- **Boundary**：novel_domain（纯 struct + 漂移规则纯函数）；novel_persistence（ledger_entries 表 + repository）；novel_application（提炼编排 + 对账服务 + archive_read 面扩展 + writer 投影段）；novel_web（账面查询经既有 Channel 入口）。**不改**：judgment 协议、AgentRun 主链、采纳通道本体（复用 author_action）。
- **Consumer**：第一消费者=writer 上下文组装（出场角色弧光条目进 prose 简报）；第二=判断循环探索翼 `archive_read(ledgers)`；第三=对账报告的作者裁决动作。
- **Proof**：域层纯函数单测（状态机/漂移规则）+ 提炼编排测试（stub）+ **M2 75 章书重放验证**（狗粮库 `tmp/dogfood-db/` 现存 101,421 字真实数据：对其跑增量提炼+全量对账，断言凌渊条目 stalled、无设计接管线被报告——真实素材优于合成 fixture）+ I-L1/L2/L3 机器断言。
- **Acceptance Driver**：外部自动化驱动真实工作台：采纳一章正文 → 账面更新候选出现 → 作者采纳 → 档案/探索可查该账目 → 下一章写作简报含相关弧光条目（网络帧+UI 断言）；产品代码零验收感知。

---

## 3. CP1 实施记录（2026-07-21）

**已落地（后端全链）**：`NovelDomain.LedgerEntry`（信封+I-L1 构造校验+弧光机械规则
纯函数）；`ledger_entries` 表+`LedgerRepository`（upsert 走 TENTATIVE→ACCEPTED
两步仪式守 ADR-0019 INV-1，I-L1 持久化双兜底）；`LedgerMaintenance`（确定性
提炼=摘要人物栏 roster 名/别名匹配、停滞窗口锚定采纳章 seq、失败容忍、
ledger.update.* 业务日志）挂在章摘要维护后同任务串行；`archive_read` 第 9 面
`ledgers`；`progress_state` 投影走 tool_input→CreativeRequest→real.ex 段
（含"不得在正文引用状态词/章号"反泄漏约束——Q2/Q3 修向的首个落点）。

**验证**：单测 12 项（域 5/维护 4/仓储 3）+ 全量 1221 测试 0 失败 + xref/arch +
I1/I2/I3 + 静态扫描触碰文件 0。**M2 75 章书重放 PASS**（`scripts/
vs00f_ledger_replay.exs` 对狗粮库副本重放 69 章摘要）：凌渊 STALLED@25、
凌云 STALLED@52、沈墨 STALLED@47、林浩/柳烟/沈逸 ON_TRACK@75、韩晟零出场
零条目（不凭空记账）——**机器账面完整复现人工 Q5 审计**；I-L3 实证（facet
同源可查 6 条）。证据：`artifacts/ledger-replay/m2-replay-2026-07-21.txt`。

**实施中的契约微调（数据驱动，登记备案）**：弧光状态机 `ON_TRACK ⇄ STALLED`
为机械双向（出场解除停滞条件属记账事实，非漂移裁决；DRIFTED/RESUMED 仍
裁决专属）——契约 §2.2 单向箭头据此放宽，域模块注释为准。

**SC-AU13-A1 已闭环（2026-07-21，真实 Tauri 首轮 PASS）**：场景
`au13-arc-ledger-roundtrip`——采纳第1章（桩正文织入 roster 角色林岚，复刻
真实模型带 roster 即用之的行为）→ `ledger.update.done sighted=1` → 账面
问句判断走探索面 archive_read(ledgers)，回复逐字引用真实账目「弧光账·林岚：
ON_TRACK，最近出场第1章」且页面可见 → 第2章写作请求携带账面投影
（`context.progress_state.done entry_count=1`）。九事件链全齐 + evidence/
behavior 双 handler。证据：`artifacts/slice-verify/au13-arc-ledger-roundtrip-
tauri/summary.json`。配套 test-support：slice_verify 四栏摘要 clause（正文
首行归人物栏）+ opening_body roster 织入 + 探索路由 账面→archive_read
(query=ledgers)。

**剩余登记（CP1 已 done，随后续 CP/债务批处理）**：
- StateTrace 留痕（契约 §3.2）：账面权威变更暂只有业务日志，与章摘要维护同病（先例本就缺 StateTrace），随维护 trace 债一并补（不阻 CP1）。
- M2 重放的 roster 为测试夹具注入（狗粮 seed 无角色采纳），生产 roster 来自
  角色采纳链路——不影响规则验证，登记素材边界。
- 阈值校准：8 章在 M2 书上表现合理（三个消失角色全中、零误报），维持默认。

## 2. 决策记录

| 日期 | 事项 | 状态 |
|---|---|---|
| 2026-07-21 | 契约 Proposed：LedgerEntry 统一信封（非五表）、两级对账节拍、处置四枚举、CP1 选弧光账 | 被 rev2 取代 |
| 2026-07-21 | **rev2（用户要求全树先例排查后重写）**：三个并行代理扫全部 142 份设计文档产先例映射（契约 §9 复用 vs 新造总表）。主要修正：投影改认领 VS-00C §3.0 progress_state_packet 既有槽（撤回 execution_brief 塞入方案）；两 artifact 归 25 §8.1 维护家族并与 continuity_warning_artifact 切分；自动通过定义为系统发起 TENTATIVE→ACCEPTED（ADR-0019 INV-1）并首次契约化 25 §9.3 policy；revise_prose 复用 VS-00E §8 修订机械；dismiss 接 Experience Engine（33）与 feedback_patch 切割；裁决面认领 ADR-0024 入册纪律；status 枚举改 UPPER_SNAKE；修正"08 §4.4"失效引用（正确出处=产品里程碑 §4.4）；新画质量门 vs 账本对账分工表（31 §6 五处重叠首次画线）；验收开新 AU-13 家族。开放问题 5 项见契约 §8 | 待用户拍板冻结 |
