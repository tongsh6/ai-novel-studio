# AU-13 看住我这本书的账（五本账与三态对账）

> 作者视角：书写到几十章后，我最怕的不是某一章写坏，而是**这本书悄悄走偏**——重要角色不知不觉消失、支线被遗忘、说好的题材变了味、埋的承诺没人兑现。我需要系统替我记账（每个角色的弧光走到第几步、每条线推进到哪、哪些承诺还没兑现），并且每隔一二十章给我一份"账面 vs 当初设计"的对账报告，让我裁决：改设计迁就正文、标记正文待修、知情接受、还是告诉系统这是误报。系统只记账和报告，**从不替我改任何一方**。
>
> 立档依据：2026-07-21 M2 达标跑（101,421 字/75 章）实证漂移三症状（要角消失/无设计接管/题材漂移），`contracts/VS-00F` + `ADR-0026` 冻结账本与对账契约。本 AU 是其验收家族；边界上与 AU-09（故事记忆类事实）、AU-12（立项档案视图）互斥——账面是**进度视图**，不是记忆对象也不是立项元数据。

---

## 1. 我能做什么

- 采纳一章正文后，系统自动更新受影响的账目（我不需要逐章确认记账；异常态转移除外）。
- 在探索面（AI 判断循环）与档案面板查看各账：弧光/冲突/信息/情绪曲线/承诺（面板视图排 VS-00F CP4）。
- 每 10-20 章（或我显式发起）收到对账报告：哪些账目偏离了设计，证据是哪几章。
- 对每条偏离逐项裁决：`revise_design` / `revise_prose` / `accept_drift` / `dismiss`（误报反馈进经验回路）。
- 写作时 AI 自动带着相关账面工作（出场角色弧光、活跃冲突线、未兑现承诺）。

## 2. 不变量

| # | 不变量 | 上游 |
|---|---|---|
| AU13-I1 | 账面断言必有非空 source_refs 且引用真实对象（不凭空记账） | VS-00F I-L1 / 00c #19 |
| AU13-I2 | 权威账面变更只经作者采纳 ∪ 系统发起的 LOW 风险 TENTATIVE→ACCEPTED；对账运行本身只读权威层 | VS-00F I-L2 / ADR-0019 INV-1 |
| AU13-I3 | 账本落地与探索可达同批（archive_read(ledgers)） | VS-00F I-L3 / 08 §8 |
| AU13-I4 | 漂移判定规则确定性；模型不参与规则判定；阈值只经 Experience 回路调整 | VS-00F I-L4 / 33 §12 |
| AU13-I5 | 无账本数据时诚实降级为摘要或缺失说明，不伪造账本存在 | 06 §5.0 |
| AU13-I6 | 任何处置下系统不静默改写设计态或实现态 | 08 §9.3 / ADR-0026 |

## 3. 契约引用

`contracts/VS-00F-five-ledgers-three-state-contract-pack.md`（§2 对象/§3 对账/§5 不变量）、`adr/ADR-0026`、`domain/25`（hook/artifact 家族）、`schemas/foundation/ledger_entry.json` + `enums/ledger.json` + `enums/arc_ledger_status.json`、`quality/32` §11（裁决持久化）、`ui/43` §5 模块 9。

## 4. 验收场景（随 CP 立档，编号预留）

| 场景 | 内容 | CP |
|---|---|---|
| SC-AU13-A1 | 采纳一章正文 → 弧光账自动更新（出场角色 last_seen 前移）→ archive_read(ledgers) 可查 → 下一章写作简报含相关弧光条目 | CP1 **verified**（`au13-arc-ledger-roundtrip` 真实 Tauri，2026-07-21） |
| SC-AU13-A2 | M2 75 章书重放：凌渊类"消失角色"被账面标 STALLED；无 design_ref 的接管线被报告 | CP1 **verified**（`scripts/vs00f_ledger_replay.exs`，2026-07-21） |
| SC-AU13-B1 | 对账报告产出与逐项裁决 roundtrip（四处置各一例；dismiss 进 experience evidence） | CP2 |
| SC-AU13-B2 | revise_prose 处置 → VS-00E §8 sibling 修订候选 → 原稿保留 | CP2 |
| SC-AU13-C1 | 面板 Ledgers 模块只读视图 + correction intent | CP4 |

## 5. 场景覆盖状态

2/5（2026-07-21：A1 真实 Tauri + A2 重放均 verified；B1/B2/C1 随 CP2/CP4）。

## 6. 落地路线

见 `tasks/slices/VS-00F-five-ledgers-three-state.md` CP 表。

## 7. 已知限制

- CP1-CP3 期间账本覆盖不全（逐账落地），按 AU13-I5 诚实标注。
- 弧光停滞阈值默认 8 章，CP1 以 M2 书重放校准后固化。

## 8. 验收命令

`bash scripts/tauri_slice_verify.sh au13-arc-ledger-roundtrip`；重放 `NOVEL_TEST_DB_DIR=<副本> MIX_TEST_PARTITION=_dogfood MIX_ENV=test mix run scripts/vs00f_ledger_replay.exs`。
