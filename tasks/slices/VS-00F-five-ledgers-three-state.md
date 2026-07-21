# VS-00F 五本账与三态对账（M3 主 slice）

- 状态：**CP0 进行中**（契约 Proposed 待用户 review 冻结；冻结前不编码）
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
| CP0 | 契约冻结（rev2，全树先例排查后修订）+ 配套 ADR + 同批文档修订（25 §5/§8.1、ADR-0018 白名单、ADR-0024 注册、00c 回填、schemas 登记、ui/43 §5、AU-13 立档） | — | 进行中（Proposed rev2） |
| CP1 | 弧光账最小闭环（信封落地 + arc 提炼/漂移规则 + 裁决 + archive_read(ledgers) + writer 投影段） | 凌渊 stalled 被账面暴露；凌云/沈逸无设计接管被报告 | 未开工 |
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

## 2. 决策记录

| 日期 | 事项 | 状态 |
|---|---|---|
| 2026-07-21 | 契约 Proposed：LedgerEntry 统一信封（非五表）、两级对账节拍、处置四枚举、CP1 选弧光账 | 被 rev2 取代 |
| 2026-07-21 | **rev2（用户要求全树先例排查后重写）**：三个并行代理扫全部 142 份设计文档产先例映射（契约 §9 复用 vs 新造总表）。主要修正：投影改认领 VS-00C §3.0 progress_state_packet 既有槽（撤回 execution_brief 塞入方案）；两 artifact 归 25 §8.1 维护家族并与 continuity_warning_artifact 切分；自动通过定义为系统发起 TENTATIVE→ACCEPTED（ADR-0019 INV-1）并首次契约化 25 §9.3 policy；revise_prose 复用 VS-00E §8 修订机械；dismiss 接 Experience Engine（33）与 feedback_patch 切割；裁决面认领 ADR-0024 入册纪律；status 枚举改 UPPER_SNAKE；修正"08 §4.4"失效引用（正确出处=产品里程碑 §4.4）；新画质量门 vs 账本对账分工表（31 §6 五处重叠首次画线）；验收开新 AU-13 家族。开放问题 5 项见契约 §8 | 待用户拍板冻结 |
