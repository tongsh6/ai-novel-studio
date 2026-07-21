# VS-00F 五本账与三态对账（M3 主 slice）

- 状态：**CP0 done（2026-07-21 用户"开工"拍板默认项）/ CP1 进行中**——契约 Frozen、ADR-0026 Accepted、同批修订全落（25 §5/§8.1、ADR-0018 白名单、00c §4/§6.5/§7#19、ui/43 §5 模块9、schemas 三件、AU-13 立档）
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
| CP1 | 弧光账最小闭环（信封落地 + arc 提炼/漂移规则 + 自动通过 + archive_read(ledgers) + writer 投影段） | 凌渊 STALLED 被账面暴露 | **后端闭环 + M2 重放 PASS**（2026-07-21）；余 Tauri 场景与 gap 见 §3 |
| CP2 | 承诺账 + 信息账 + 全量对账报告首版 | 题材漂移产出 broken 候选；"第60章前指"泄露被报告 | 未开工 |
| CP3 | 冲突账 + 情绪曲线账 | 主线停滞/情绪偏差可查 | 未开工 |
| CP4 | 对账节拍机器化 + 规划消费账面 + 面板视图 | 下次百章狗粮：漂移 30 章内被拦截 | 未开工 |

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

**未闭环缺口（CP1 收口前必做，不写 done）**：
- SC-AU13-A1 外部自动化驱动真实页面场景（采纳→记账→探索可查→下一章简报含
  账面）——需 slice_verify 场景注册 + 真实 Tauri 验收。
- StateTrace 留痕（契约 §3.2）：账面权威变更暂只有业务日志，与章摘要维护
  同病（先例本就缺 StateTrace），随维护 trace 债一并补。
- M2 重放的 roster 为测试夹具注入（狗粮 seed 无角色采纳），生产 roster 来自
  角色采纳链路——不影响规则验证，登记素材边界。
- 阈值校准：8 章在 M2 书上表现合理（三个消失角色全中、零误报），维持默认。

## 2. 决策记录

| 日期 | 事项 | 状态 |
|---|---|---|
| 2026-07-21 | 契约 Proposed：LedgerEntry 统一信封（非五表）、两级对账节拍、处置四枚举、CP1 选弧光账 | 被 rev2 取代 |
| 2026-07-21 | **rev2（用户要求全树先例排查后重写）**：三个并行代理扫全部 142 份设计文档产先例映射（契约 §9 复用 vs 新造总表）。主要修正：投影改认领 VS-00C §3.0 progress_state_packet 既有槽（撤回 execution_brief 塞入方案）；两 artifact 归 25 §8.1 维护家族并与 continuity_warning_artifact 切分；自动通过定义为系统发起 TENTATIVE→ACCEPTED（ADR-0019 INV-1）并首次契约化 25 §9.3 policy；revise_prose 复用 VS-00E §8 修订机械；dismiss 接 Experience Engine（33）与 feedback_patch 切割；裁决面认领 ADR-0024 入册纪律；status 枚举改 UPPER_SNAKE；修正"08 §4.4"失效引用（正确出处=产品里程碑 §4.4）；新画质量门 vs 账本对账分工表（31 §6 五处重叠首次画线）；验收开新 AU-13 家族。开放问题 5 项见契约 §8 | 待用户拍板冻结 |
