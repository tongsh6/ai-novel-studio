# D3 摘要维护可靠性：狗粮吃生产异步语义、后台任务可观测与读取侧惰性补做

- 状态：done（2026-08-25）
- 类型：M5 狗粮产品债 D3 收口（`docs/design/notes/2026-08-25-m5-dogfood-observations.md` §3）
- 启动日期：2026-08-25
- 拍板（2026-08-25 用户「1 和 2」）：①狗粮环境吃生产异步语义（验收场景保持 sync）+ ②后台任务失败可观测 + 读取侧惰性补做；③channel 串行结构解留 B12 独立拍板。

## 1. 开工检查（七问）

- **Contract**：VS-00C §5.3 章摘要维护语义不变（异步默认/失败容忍）；新增可观测事件
  `background_task.run.error` 与补做事件 `chapter_summary_repair.*`（ADR-0018 日志口径）；
  零新表零契约字段。
- **Invariant**：采纳主链失败容忍不变（补做任务崩溃不影响读取路径）；补做幂等（只补
  「有 ACCEPTED 正文且无当前摘要」的章，supersede+insert 单当前语义）；同步测试环境行为
  逐字节不变（补做仅在异步模式调度——既有全部单测/场景不受影响）。
- **Boundary**：`novel_application`（观测包装/reader 包装/补做任务）、`novel_persistence`
  （缺失查询）、`scripts`（server env 覆盖 + 狗粮 export + seed）、`test/support` 替身
  （D3SUMFAIL 摘要失败注入 + 顺手急救 CP1 遗漏的替身正文「主角」句）；不动 web/frontend。
- **Consumer**：狗粮长跑（异步语义）；写作组装（摘要断供自愈）；排查者（background_task
  与 repair 事件）。
- **Proof**：repo 缺失查询单测 + 补做 runner 单测 + reader 包装门控单测；真实 Tauri
  `d3-summary-lazy-repair`（第 01 章摘要生成被注入失败→断供→第 02 章组装触发惰性补做→
  补做完成→后续写作 prompt 实证带回第 01 章摘要，llm-calls 外证）+ `p1-chapter-adoption-reading`
  复跑（替身「主角」句急救后 prose 采纳链回归）。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh d3-summary-lazy-repair`；产品零验收感知。
- **Exploration**：摘要经 `chapter_read` 既有可达；补做产物即普通摘要——不适用新增。

## 2. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | slice_verify_server env 覆盖 + dogfood_run.sh export（狗粮吃生产异步） | done | `NOVEL_SYNC_SUMMARY_MAINTENANCE`；场景 per-slice export 与 seed case 同块 |
| T2 | start_background_task 可观测（start 失败与任务崩溃 LogEmit） | done | `background_task.start/run.error`；失败容忍语义不变；顺手修 maintenance degrade 谎报（所有失败原标 persistence_failed → 按层分类 generation/empty_prose/persistence） |
| T3 | `chapters_missing_summary` 查询 + reader 包装惰性补做（仅异步模式调度，cap 2/次） | done | 触发点只挂 previous（by_title 双挂实测竞速两条 run.start）；同步测试环境零调度（门控单测）；补做 runner 单测（stub 四栏落库） |
| T4 | 替身：D3SUMFAIL 摘要失败注入 + 正文「主角」句急救（CP1 组合遗漏） | done | 失败注入为**一次性**（persistent_term，瞬态故障语义——永久标记会让补做同死，首版实测死循环）；「主角停在巷口」→「他」、outline 模板「主角」→「视角人物」 |
| T5 | 真实 Tauri 场景 + p1 采纳回归 + 全量门禁 + task_done | done | `d3-summary-lazy-repair` PASS（断供→读取侧补做→摘要回流 prompt，llm-calls 外证）+ `p1-chapter-adoption-reading` 复跑 PASS（急救验证）；真退出码门禁链 + task_done |

## 3. 决策日志

- 2026-08-25 — 补做触发放读取侧（reader 包装）而非采纳侧：断供自愈不依赖再次采纳发生；
  调度仅 `start_background_task`（查询在任务内），读取路径零 DB 开销。
- 2026-08-25 — 同步模式（测试环境）不调度补做：既有单测/场景行为逐字节不变；补做语义由
  专属场景在异步模式下验证。
- 2026-08-25 — 替身正文「主角停在巷口」是 CP1 词表扩后的组合遗漏（prose 采纳类场景会全
  部撞 require_confirmation，D1 场景未炸只因采的是 character_seed 不扫词表）——随本刀急救
  并以 p1 采纳场景复跑为证。

## 4. 试行反馈

- 2026-08-25 — 真实 Tauri PASS：第 01 章采纳照常（摘要异步失败不阻主链）→ 第 02 章组装
  触发 `chapter_summary_repair.run.start/done` → 后续写作 prompt 实证带回第 01 章四栏摘要
  （llm-calls）。`p1-chapter-adoption-reading` 复跑 PASS 证替身「主角」句急救无回归。
- 场景判例：内容型失败标记会让补做与原始失败同死（标记永在正文里）——瞬态故障注入必须
  一次性（persistent_term 记账）；reader 双键都挂触发会同 turn 竞速调度（两条 run.start），
  触发点应挂「每次组装恰一次」的读。
- 顺手修谎报族第三例：maintenance degrade 把 provider 失败也标 persistence_failed。
