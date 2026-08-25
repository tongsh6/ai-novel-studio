# D4 计划起草瞬态重试：provider 错误族单次重试与重试可观测

- 状态：done（2026-08-25）
- 类型：M5 狗粮产品债 D4 收口（ADR-0023 CP0「planner 重试」实装；`docs/design/notes/2026-08-25-m5-dogfood-observations.md` §3）
- 启动日期：2026-08-25
- 拍板（2026-08-25 用户「同意」）：①provider 瞬态错误（含超时全族）单次重试，修订管道同修；②重试可观测（plan_draft.retry 事件，双族覆盖）；D6 分模型为治本另刀。

## 1. 开工检查（七问）

- **Contract**：ADR-0023 CP0 planner 重试半边实装（观察保真仍留 CP0）；LogEmit 事件
  `plan_draft.retry.start`（ADR-0018 口径）；零契约字段/零新实体。
- **Invariant**：单次重试统一预算（结构族纠正重发与 provider 族原样重发共享一次，杜绝
  双重重试链）；两次仍败诚实 run_failed（不静默吞）；重试消耗如实计入 provider_call_count
  与 run 预算（bounded 语义不破）。
- **Boundary**：`novel_application`（agentic_plan_draft_planner 双段重试+事件）、test/support
  替身（D4PLANFAIL 一次性注入，复用 D3 瞬态判例）；不动 domain/persistence/web/frontend。
- **Consumer**：prose/judgment 等 model-drafted plan 的 bounded run（起草与修订两管道）；
  狗粮 retry 体温计（事件归因）。
- **Proof**：planner 单测三例（provider 首调失败→重试成功 meta 调用数如实 / 两次失败→诚实
  错误 / 叙事段失败重试）；真实 Tauri `d4-planner-transient-retry`（用户消息带 D4PLANFAIL→
  计划起草首调失败→原样重试成功→run 正常完成+retry 事件留痕+正文 tentative 零写入）。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh d4-planner-transient-retry`；产品零验收感知。
- **Exploration**：重试是执行期瞬态行为，无物化要素——不适用。

## 2. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | request_reasoning/request_plan provider 错误族接入单次重试 + retry 事件（含结构族补事件） | done | 叙事段独立一次额度；结构段 provider 错与纠正重试共享 `retry?` 单额度；`plan_draft.retry.start`（stage/family/reason）双族留痕 |
| T2 | 替身 D4PLANFAIL 一次性注入 + planner 单测三例 | done | 一次性注入（persistent_term，D3 判例复用）；单测=首调超时重试成功（调用数如实 3）/两次失败诚实上抛/叙事段重试；失败链顺手扁平化（credo 嵌套） |
| T3 | 真实 Tauri 场景 + 登记 + 门禁 + task_done | done | `d4-planner-transient-retry` PASS（首调败→重试→run 完成+retry 事件+tentative 零写入）；真退出码门禁链全绿 |

## 3. 决策日志

- 2026-08-25 — 统一单次重试预算：结构族与 provider 族共享 `retry?` 一次额度——最坏链
  「provider 败→重试→结构败→再纠正」会把一次起草膨胀到 3 调用且模糊归因；单额度下两族
  互斥，最坏 2 调用。
- 2026-08-25 — 超时入重试族（拍板 a）：同请求方差实测 84-220s vs 900s 尾部，重试期望收益
  为正；retry 体温计看数据，若净亏再收窄。

## 4. 试行反馈

- 2026-08-25 — 真实 Tauri PASS：消息带 D4PLANFAIL → 计划起草首调瞬态失败 →
  `plan_draft.retry.start` 留痕 → 同 prompt 原样重试成功 → run 正常完成、正文 tentative
  零写入。ADR-0023 CP0「planner 重试」半边就此实装（观察保真仍留 CP0）。
- 考据修正随档：D4 登记时以为的大缺口（坏草稿率 ~1/4）实为三族——结构族 M0 已有纠正
  重试、二次编码族 0a78e895 已修根、真正缺的只是 provider 层直抛；本刀补最后一族。
