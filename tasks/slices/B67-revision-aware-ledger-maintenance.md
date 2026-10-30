# B67：章节修订后的派生账面一致性

- 状态：**blocked（2026-10-31 CP0/CP1 done；CP2 机制进展但 StateTrace 留痕依赖 VS00F-TRACE owner 先落地，CP3 页面驱动未开工；依赖见下）**。
- 来源：修订后必须重新对齐连续性；现有增量记账以本次处理章更新最近出场/推进，缺少旧章修订和旧贡献失效的完整矩阵。本轮已有弧光账纯函数反例，尚未进行数据库或真实页面复现。
- 上游：[VS-00F 原任务](VS-00F-five-ledgers-three-state.md)、[VS-00F 契约](../../docs/design/contracts/VS-00F-five-ledgers-three-state-contract-pack.md)、[ADR-0026](../../docs/design/adr/ADR-0026-five-ledgers-three-state-reconciliation-v3.md)、[B28](B28-whole-chapter-revision.md)、[B30](B30-chapter-structure-maintenance.md)。本项负责派生值与有效来源的正确性；VS00F-TRACE 负责权威变更留痕，不能互相代签。

## 1. 作者场景与已有证据

角色在第 10 章刚出现，作者回去修改第 3 章。后续脉络页或审读不能因此认为角色最近只出现于第 3 章，也不能在旧章删掉角色出场后继续把已失效版本当作当前账面依据。

设计并未把“最近出场”定义成“最后一次处理”：

- [VS-00F §2.1–§2.2](../../docs/design/contracts/VS-00F-five-ledgers-three-state-contract-pack.md) 46–60 行分别定义账面断言 `source_refs`、最近账面变动章 `last_event_chapter`、乐观并发 `revision`，以及 `last_seen_chapter` 落后当前章超过阈值的停滞判定。`last_seen_chapter` 与 `last_event_chapter` 不是同一语义。
- [创作生命周期 §12.3](../../docs/design/domain/28-authoring-lifecycle.md#123-修订后也必须再维护) 明确改稿后重新对齐连续性层；[连续性模型 §21](../../docs/design/domain/22-continuity-model.md) 要求 correction/supersede/invalidate 保留来源与历史意义。
- [ADR-0026](../../docs/design/adr/ADR-0026-five-ledgers-three-state-reconciliation-v3.md) 的 I-L1/I-L2、进度视图边界与不静默改写继续约束本任务；重算不是重新裁决故事事实。

### 1.1 当前调用链与缺口

| 环节 | 代码证据 | 本次结论 |
|---|---|---|
| 采纳后维护 | [AdoptionWorkflow](../../apps/novel_application/lib/novel_application/adoption_workflow.ex) 234–243、292–325 行；[NovelApplication](../../apps/novel_application/lib/novel_application.ex) 202–230 行 | 真实采纳触发摘要，摘要后串行触发账面维护；后台异步与章节修订均须纳入版本审计。摘要材料可能是 fragment，不能一律当整章重算依据 |
| 出场记账 | [LedgerMaintenance](../../apps/novel_application/lib/novel_application/ledger_maintenance.ex) 61–77、150–181 行 | 读取本次摘要命中角色，再更新相应弧光条目；这条路径未对新摘要不再命中的旧贡献执行撤回 |
| 最近出场/推进 | [LedgerEntry](../../apps/novel_domain/lib/novel_domain/ledger_entry.ex) 110–130、181–200 行 | `arc_sighted` / `conflict_advanced` 直接覆盖本次章 ref/seq，没有按有效正文进度区分历史章更新 |
| 信息账 | [LedgerMaintenance](../../apps/novel_application/lib/novel_application/ledger_maintenance.ex) 447–498 行 | 计划信息释放与前指泄露已有明确现役规则；须审计正文替换后旧依据失效的处理，但不能未经证据就改写其语义或撤销作者回收裁决 |
| 持久边界 | [LedgerRepository](../../apps/novel_persistence/lib/novel_persistence/ledger_repository.ex) 的 `upsert/1` | 当前函数先读 existing，再写 TENTATIVE、再写 ACCEPTED；原子性、版本条件和并发调用保护须核对完整链，不能把业务键 upsert 等同于版本一致性已证明 |

### 1.2 纯函数反例的证明范围

2026-10-30 直接加载当前 `LedgerEntry` 源文件，在内存构造既有弧光条目并调用纯函数：

```text
原条目：last_seen_chapter=ch10，last_seen_seq=10，status=ON_TRACK
arc_sighted(原条目, chapter_ref=ch3, chapter_seq=3)
→ last_seen_chapter=ch3，last_seen_seq=3
arc_recompute_stall(上述条目, current_seq=12, threshold=8)
→ STALLED（12 - 3 = 9）
```

这证明当前函数可把历史章处理顺序写成最近出场进度。运行无 Mix/app 启动、无数据库和模型；单独加载时出现 `ID.unique/1` 依赖未加载警告，本例直接构造 struct 未调用该函数，不是项目编译失败。该反例**不是页面复现或完整 slice 验收**；实际触发、落盘和作者可见影响由 CP0/CP3 继续证明。

## 2. 必须先冻结的语义与复用边界

1. **事实基线**：以哪些当前已采纳正文/摘要版本和完整性范围计算账面，fragment 不足时如何求取完整依据；本次处理章、真实写作进度、最近账面变动章分别表达。
2. **旧贡献失效**：同章替换、角色出场移除、章重编号及乱序处理后，哪些派生值重算、哪些旧出处仅留历史。不能只取 `max(seq)`，否则移除最新出场仍无法纠正；也不能删除历史引用掩盖此前依据。
3. **作者裁决保护**：现有函数保护了裁决/终态枚举，但 payload/source 仍可能更新；CP0 要明确裁决依据变化后的提示、复核或保持规则。不得默认把 DRIFTED/RESUMED/RETIRED 等重置成机械态，不自动撤销作者处置。
4. **原子性与恢复**：按契约的 `revision` 语义核对从读取基线到持久更新的竞争条件；失败、过期结果和重试如何避免部分权威变更或覆盖较新贡献。具体锁、条件更新、事务范围与存储形态由现役证据决定，本次不冻结新表或统一大事务。
5. **状态与证据**：LOW 风险自动采纳与语义裁决仍按 VS-00F §3.2/§3.3 分工；不能用“重算”绕开采纳边界或把过期材料判成当前成功。维护失败不回滚作者已经成功采纳的正文，但必须有诚实的维护状态和恢复路径。

## 3. 开工七问

1. **Contract**：VS-00F 的进度视图、来源、revision 与 LOW 自动通过；ADR-0026 I-L1–I-L4、ADR-0019 采纳矩阵；B28/B30 的稳定章身份与当前已采纳版本。未知失效/裁决语义在 CP0 冻结，不从旧函数默认行为反推授权。
2. **Invariant**：相同有效事实集不因处理顺序得到不同机械进度；旧版本不能覆盖新贡献；修订移除旧事实后当前账面不继续冒认；作者裁决与历史可追溯；幂等/失败无额外权威变更，未采纳正文不参与当前账面。
3. **Boundary**：application 的摘要/账面维护编排，domain 的纯派生与状态约束，persistence 的当前事实读取和版本更新；现有脉络/审读/Why 为消费面。复用既有仓储和 StateTrace，不重建五账、摘要或修订引擎。
4. **Consumer**：脉络页、确定性对账报告与 `archive_read(ledgers)`，随后是创作模型读取的账面观察；B39 消费其真实来源，不在本任务预装额外 prompt。
5. **Proof**：先将纯函数反例变成原实现可失败的局部测试；覆盖旧章/新章、删除贡献、fragment 与完整章、乱序/并发、重编号、重复/过期、作者裁决与失败恢复；对账当前出处及历史留存。局部计算不代签持久链和真实页面。
6. **Acceptance Driver**：外部驱动真实 Tauri 先形成多章账面，再回改旧章、移除最新出场、重开与查看脉络/审读；证明当前进度、来源、无重复写入和裁决保护。CP0 选定既有 B28/AU13 驱动承接；产品验收感知逻辑 **no**。
7. **Exploration**：沿同一个 `archive_read(ledgers)` 读取当前有效账面与真实来源，相关正文/摘要可继续取证；新旧状态不能只在 UI 修饰。若涉及模型消费，记录实际观察及后续请求；不创建新故事时间线或固定知识包。

## 4. Checkpoint

| CP | 完整范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 复现现役旧章/删除贡献反例，盘点五账、摘要完整性及实际调用顺序；冻结失效、当前进度、作者裁决、版本原子性和失败恢复的最小契约 | **done（2026-10-31，§6）**：红测复现 arc/conflict 倒退；冻结“历史出处只追加、进度指针单调、删除贡献须当前事实重算”；不做页面/模型 |
| CP1 | 在既有事实源上实现可解释的贡献更新/失效与必要重算；只处理实际需修复账种，不用追加 ref 或 max(seq) 假装全部一致 | **done（2026-10-31，§6）**：arc/conflict 旧章不回退；当前摘要重算仍出现对象；完全无当前出现 → 机械 STALLED/DORMANT + 进度 0/空、历史 source_refs 保留、裁决态不改；重复维护幂等；不用追加 ref/max 冒充一致 |
| CP2 | 接入持久版本/采纳边界与失败恢复；验证同章及跨章竞争、旧任务晚到、重复和重编号；与 VS00F-TRACE 协同留痕，保护人工裁决 | **partial（2026-10-31，§6）**：upsert 事务内 revision CAS、过期拒绝、并发单提交、重复幂等、旧调用兼容；B30 重编号采纳后接入 `recompute_work` 按当前 seq 重算（失败降级只记日志、不回滚采纳）；待 StateTrace 协同、旧任务晚到页面级、CP3 页面 |
| CP3 | 真实页面完成多章→旧章修订/移除→脉络/审读→刷新重开/探索验证，保留历史依据；必要实模消费另分证，完整矩阵通过才关闭 | todo |

## 6. CP0/CP1 记录（2026-10-31）

- 红测（TDD，先失败）：内存构造 arc last_seen=ch10，`arc_sighted(ch3)` 当前实现把 last_seen 倒回 3；`conflict_advanced` 同样倒回 last_advanced。修复后测试转绿。
- CP1 已实现（仅 domain 纯函数，不碰持久/页面）：
  - `LedgerEntry.arc_sighted/2`：新章 seq < 已存 last_seen_seq 时视为**历史出处**，只追加 source_refs（同一 ref 幂等，不增 revision），不改 last_seen/last_event/status/presence_note；新章/同章仍按原规则推进。
  - `LedgerEntry.conflict_advanced/2`：同规则保护 last_advanced，不倒退、不解除/进入休眠误判。
  - 依据：VS-00F `last_seen_chapter` ≠“最后一次处理章”，旧章回改不能把最近出场写成第 3 章；停滞判定继续按真实最近出场。
- 追加 CP1 进展（同轮）：`LedgerMaintenance` 新增可选 `summaries` 端口（生产接 `LedgerRepository.accepted_summaries_by_seq/1`）；在本次出场记账后、停滞计算前，对每个 arc 条目从当前已采纳摘要重算 `last_seen`：
  - 若对象仍在当前事实中出现且最大出现 seq 小于已存 last_seen → 降级到真实最大出现章/更新 presence_note/revision；
  - 若对象完全不在当前事实中出现（且 summaries 非空）→ 进度置 0/空、presence_note 删除、机械态置 STALLED，source_refs 历史保留；不自动 RETIRED，作者可再裁决；summaries 为空时跳过避免误失效；
  - 测试：旧章修订移除第10章最新出场后，按当前摘要回到第3章真实出场（recomputed=1、状态按窗口重算）。
- 完全无当前出现语义（同轮冻结并实现）：summaries 非空且对象在所有当前摘要中都未出现 → `last_seen_seq=0`、`last_seen_chapter=nil`、删除 `presence_note`、机械态 STALLED；source_refs 历史保留；已裁决态不改；重复维护幂等，不重复涨 revision。测试覆盖 initial ch10→修订后完全消失。
- 未完成（CP1 剩余，明确不冒充）：冲突账推进重算、持久版本原子性/旧任务晚到/重编号组合、真实页面/模型矩阵。
- 作者裁决/终态：本次未改裁决保护；单调 guard 不把 DRIFTED/RESUMED/RETIRED 等机械改写。
- 门禁：domain ledger_entry 8/0、application ledger_maintenance 7/0、ledger_reconciliation 25/0；全量 mix test 1040/0。
- 明确未做：持久层原子/版本更新、跨章竞争、重编号组合、真实 Tauri 页面矩阵、真实模型消费。

- CP1 收尾（同轮）：`LedgerMaintenance` 增加 conflict 当前事实重算：从当前已采纳摘要 + 章 `chapter_role` 找出仍推进主线的最大 seq，低于已存 last_advanced 时降级；无当前推进章时置 last_advanced 0/空、机械 DORMANT、历史 source_refs 保留；重复维护幂等。测试：第10章推进→修订为过渡、仅第3章推进 → conflict 重算回第3章（conflict_recomputed=1）；author adjudication 态不被改写。
- CP1 完成范围：arc/conflict 两个现役机械账；emotion/information 本轮未产生旧章失效反例，不改其现有规则；不把“重算”当作重新裁决故事事实。
- 仍未做：持久层 revision 条件/并发/旧任务晚到/重编号组合（CP2）、真实页面/模型矩阵（CP3）；CP2/CP3 未开工。

- CP2 进展（同轮）：`LedgerRepository.upsert/1` 改为事务内 CAS：
  - 读 existing → TENTATIVE → ACCEPTED 在同一 `Repo.transaction`；
  - 已存在行要求 `attrs.revision == existing.revision + 1`（生产维护/裁决均递增 revision），否则 `{:error, :stale_ledger_revision}`，不覆盖较新账面；
  - 条件 `update_all` 以 `id + revision + ACCEPTED` 匹配，0 行即 stale 回滚；TENTATIVE→ACCEPTED 再以新 revision 条件下推；
  - attrs 无 revision 的旧脚本/种子保留兼容更新（同事务，无 revision 断言）。
  - 测试：过期 revision 拒绝且不覆盖、并发同 revision 只有一提交/另一 stale、无 revision 兼容、幂等；`adoption_repository_test` 中模拟“已推进态”的直改 status 改为 `LedgerEntry.adjudicate`（真实裁决递增 revision），不再用旧 revision 手改绕过 CAS。
- CP2 追加：`LedgerMaintenance.recompute_work/2` 从当前摘要/章索引重算 arc/conflict/stall/dormancy；`NovelApplication.recompute_ledgers_after_structure_change/1` 在 workspace_channel 检测到 `renumber_chapters` 采纳成功后触发，失败只记 `ledger.recompute_after_renumber.error`，不回滚作者已成功采纳。测试：重编号后 seq 10→6 的 arc last_seen 随之重算，recompute_work arc=1/current_seq=6。全量 mix 1044/0、credo 0 issues。
- CP2 追加：旧任务晚到（先处理第10章、后维护第3章）测试——当前事实仍有第10章出场时，last_seen 保持10、不回退不误报，来源追加 ch3；maintenance 12/0。
- **依赖/阻塞（2026-10-31）**：CP2 的“与 VS00F-TRACE 协同留痕”需要该 owner 先确定维护型 StateTrace 的生产/存储/回放契约；B67 不平行自建第二 trace。CP3 页面矩阵可在其边界落定后继续；当前不标 done。
- CP2 未完成：StateTrace 与 VS00F-TRACE 协同留痕（需其 owner 落地持久 state trace）、旧任务晚到/维护失败的页面级证据；CP3 真实页面矩阵。

## 5. 非目标与恢复

- 不把账面改成第二事实库，不新建通用事件溯源平台、五张新表或故事时间线；不重做 B30 已完成的章身份/重编号。
- 不以纯 StateTrace 接线代替派生值正确性，也不把本任务当作所有维护/质量门已实现；B56、Experience Engine、durable 定期对账仍按原触发条件。
- 不直接修改真实作品旧账或恢复历史作者决定；实施前的反例数据和外部驱动只在明确的测试范围内准备。
- 恢复时先核最新正文、摘要与账面事实链，再读 B28/B30、VS00F-TRACE 与 B47 的版本边界；本次只有任务登记和无 I/O 的函数反例，没有新产品验收结论。
