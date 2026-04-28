# ADR-0011：Reading Projection refresh 状态与触发语义

- 状态：Accepted (2026-04-25)
- 日期：2026-04-25
- 涉及范围：Domain 子系统 27（Reading Projection）/ Domain 子系统 28（Authoring Lifecycle）/ Foundation 子系统 2（Turn & Task State Machines）/ Foundation 子系统 11（UX Contract）
- 相关文档：`0009-projection-object-schema.md`、`0008-first-batch-intents.md`、`0010-first-batch-intent-slot-schema.md`、`../27-reading-projection.md`、`../02-turn-and-task-state-machines.md`、`../03-conversation-behaviors.md`、`../11-ux-contract.md`、`../30-contract-glossary.md`

---

## 背景

ADR-0009 已冻结 `reading_projection_root.status` 的字段位置，并明确完整状态机语义由 ADR-0011 冻结。

`27-reading-projection.md` 已给出阅读投影刷新原则：

1. 默认阅读投影只消费 accepted / authoritative source。
2. accepted draft、chapter ordering、title update 或显式 refresh intent 会影响投影刷新。
3. UI 不应自己比较字段猜测 stale，而应消费系统给出的 projection status 与 `source_revision_refs`。
4. 默认阅读模式不是 tentative preview；preview 必须走显式路径。

如果 refresh 状态和触发语义不冻结，UI 会继续在以下问题上自造逻辑：

1. stale 时是否还能阅读。
2. adopted source 变化后何时显示 refresh recommended。
3. refresh 失败时使用 warning、retry 还是 failure 语义。
4. tentative 是否能临时进入阅读面。
5. refresh 是否需要新 Foundation `next_action` / `card_type` / `action_type`。

本 ADR 的目标是冻结 W11 最小 refresh 状态与触发语义，同时不重定义 ADR-0009 的对象字段集。

---

## 考虑过的方案

### 方案 A：把 refresh 状态并入 Foundation task phase

优点：所有状态都走同一套 task state machine。

缺点：会把 Domain projection 的派生对象状态误写成 Foundation 运行 phase；`FRESH / STALE / REBUILDING / FAILED` 不是 turn/task phase，而是 projection object status。

### 方案 B：只复用 `27-reading-projection.md` 的四个词，不定义转换与触发器

优点：改动最小。

缺点：UI 仍不知道何时 stale、何时 rebuilding、失败后是否可 retry；ADR-0009 的 `status` 字段位置仍缺语义。

### 方案 C：冻结 projection 自身四态 + 最小触发器 + Foundation 投影边界

优点：关闭 UI 前冻结缺口；不新增 Foundation 状态；与 ADR-0009 的对象字段分工清楚。

缺点：自动刷新策略和后台调度算法仍需后续实现层补充。

---

## 最终决策

采用**方案 C：冻结 projection 自身四态 + 最小触发器 + Foundation 投影边界**。

本 ADR 冻结：

1. `reading_projection_root.status` 的 4 个 canonical 取值与语义。
2. accepted source 变化后如何标记 stale。
3. refresh 开始、成功、失败的最小状态转换。
4. 自动触发与显式触发的最小集合。
5. tentative preview 与默认阅读路径的边界。
6. UI / Foundation 侧如何投影，不新增 `next_action` / `card_type` / `action_type`。

本 ADR 显式不冻结：

1. 后台 job 调度算法。
2. stale 后自动刷新还是手动刷新的产品默认策略。
3. refresh 具体耗时、预算阈值、重试次数。
4. future preview mode 的具体 UI 交互。
5. ADR-0009 已冻结的 projection object 字段表。

---

## 1. Projection refresh status

`reading_projection_root.status` 的最小 canonical 取值固定为：

| status | 语义 | 可读性 | UI 最低投影 |
| --- | --- | --- | --- |
| `FRESH` | 当前 projection 与 accepted source revisions 对齐 | 可读 | 正常阅读 |
| `STALE` | accepted source 已变化，但 projection 尚未刷新 | 可读旧投影 | stale / refresh recommended 警示 |
| `REBUILDING` | 系统正在刷新 projection | 可读旧投影或显示刷新中，取决于 UI 策略 | progress 或 secondary warning |
| `FAILED` | 最近一次刷新失败，projection 未更新到目标 source revisions | 可读旧投影（如存在）或显示失败 | warning / failure 提示 |

约束：

1. `status` 是 projection object status，不是 Foundation `status` family。
2. `STALE` 不等于不可读；它表示读到的是旧 projection。
3. `FAILED` 不等于 source invalid；它表示 refresh attempt 失败。
4. `REBUILDING` 不应删除或覆盖上一份可读 projection，除非实现层明确采用不可用刷新策略并向 UI 暴露。
5. 新增 projection status 必须走新 ADR。

---

## 2. 最小触发器集合

系统至少必须识别以下 projection refresh trigger：

| trigger | 来源 | 默认效果 |
| --- | --- | --- |
| `accepted_draft_changed` | draft adoption 后 accepted draft revisions 变化 | 标记 `reading_projection_root.status=STALE`，并通过 affected refs 指向受影响章 |
| `chapter_ordering_changed` | chapter ordering adoption 后阅读顺序变化 | 标记 `reading_projection_root.status=STALE`，并通过 affected refs 指向受影响 TOC / chapter entries |
| `title_update_changed` | accepted chapter / volume title 更新 | 标记 `reading_projection_root.status=STALE`，并通过 affected refs 指向受影响 TOC / chapter projection |
| `reader_recap_source_changed` | accepted chapter_summary / reader-facing recap source 变化 | 标记 `reading_projection_root.status=STALE`，并通过 affected refs 指向受影响 recap / chapter projection |
| `explicit_refresh_intent` | `intent.REFRESH_READING_PROJECTION` | 尝试进入 `REBUILDING`，或按 budget / authority 先进入 confirmation |

说明：

1. 前三项来自 `27-reading-projection.md` §12.1 的 minimum trigger。
2. `reader_recap_source_changed` 来自 `27` §15 / §17 对 recap 来源边界的要求；它不新增对象族，只说明 recap source 变化也会影响 projection freshness。
3. `explicit_refresh_intent` 已由 ADR-0008 冻结为首批阅读族 intent，并由 ADR-0010 给出最小 slots。
4. 实现层可以增加更细粒度 trigger，但不得绕过以上最小集合。

---

## 3. 状态转换

最小合法转换如下：

```text
FRESH
  -> STALE       (accepted source revision changes)
  -> REBUILDING  (explicit refresh / automatic refresh begins)

STALE
  -> REBUILDING  (refresh begins)
  -> FRESH       (no-op reconciliation proves source_revision_refs already aligned)

REBUILDING
  -> FRESH       (refresh succeeds and source_revision_refs updated)
  -> FAILED      (refresh fails)
  -> STALE       (refresh output is superseded by newer accepted source before completion)

FAILED
  -> REBUILDING  (retry / explicit refresh begins)
  -> STALE       (new accepted source arrives before successful rebuild)
```

约束：

1. 任意进入 `FRESH` 的转换，必须更新 `source_revision_refs` 与 `projected_at`。
2. `STALE` 必须保留上一版 `source_revision_refs`，并能指向触发 stale 的 newer source revisions 或 stale reason。
3. `FAILED` 必须保留失败原因与可审计事件；失败不得静默回退为 `FRESH`。
4. `REBUILDING -> FRESH` 必须只消费 accepted / authoritative source。
5. tentative source 不得通过 refresh 转换进入默认阅读 projection。

---

## 4. Stale 判定

projection stale 的 canonical 判定是：

> 当前 accepted / authoritative source revisions 与 projection 对象记录的 `source_revision_refs` 不一致，且系统尚未成功生成对齐后的 projection。

最小规则：

1. stale 判定由系统完成，UI 不得自行比较 draft / chapter / title 字段。
2. stale 标记必须落在 projection object status 上，至少落在 `reading_projection_root.status`。
3. 如果只有部分 chapter 受影响，root 可以标记为 `STALE`，TOC / chapter entry / chapter projection 应尽量提供 affected refs，供 UI 精细提示（affected refs 可通过 TOC `chapter_entry`、projection refs 或 `source_revision_refs` 关联表达；本 ADR 不要求 `reading_projection_chapter` 持有独立 refresh status 字段）。
4. `refresh recommended` 是 `STALE` 的 UI hint，不是第五个 status。
5. source changes 被撤销或 superseded 后，系统可通过 reconciliation 把 `STALE -> FRESH`，但必须可审计。

---

## 5. 显式 refresh intent

`intent.REFRESH_READING_PROJECTION` 是用户或系统显式请求刷新投影的 Domain intent。

约束：

1. intent namespace 由 ADR-0008 冻结；本 ADR 不新增 intent。
2. 最小 slots 由 ADR-0010 冻结：`work_ref`、`source_revision_refs` 为 required slots；`projection_scope`、`force_refresh` 为 optional preference slots。
3. 若 refresh 低成本、低副作用、且 policy 允许自动执行，可以直接进入 turn `READY_TO_EXECUTE -> EXECUTING -> COMPLETED`。
4. 若 refresh 成本高、范围大、会启动 long-run 或需要 authority escalation，必须按 `03-conversation-behaviors.md` §6 先触发 confirmation。
5. confirmation 的 `next_action` 使用 ADR-0002 的 `CONFIRM_BEFORE_EXECUTE`；不得新增 `REFRESH_PROJECTION` 这类 next_action。

---

## 6. 自动 refresh 与惰性 refresh

本 ADR 不规定产品默认采用自动刷新或手动刷新，但冻结二者的最小边界：

### 6.1 自动 refresh

当系统选择自动刷新：

1. accepted source 变化后可以直接进入 `REBUILDING`。
2. 若预算、权限或高风险 guard 不允许自动执行，必须先标记 `STALE`，并等待 confirmation / explicit intent。
3. 自动 refresh 仍必须写入 `projection_built` / `projection_refreshed` / `projection_failed` 等事件。

### 6.2 惰性 refresh

当系统选择惰性刷新：

1. accepted source 变化后必须至少标记 `STALE`。
2. UI 可以显示 refresh recommended，但不得自行决定是否后台刷新。
3. explicit refresh intent 或系统调度开始时进入 `REBUILDING`。

---

## 7. Preview 边界

默认阅读 projection 不消费 tentative source。

tentative source 只能进入：

1. 显式“预览未采纳版本”。
2. 对比模式。
3. debug / review 模式。

约束：

1. preview path 不得写回默认 `reading_projection_root.source_revision_refs`。
2. preview path 不得把默认 projection status 改成 `FRESH`。
3. preview stale / preview failed 若未来需要表达，必须作为 preview-mode metadata 或后续 ADR，不得污染本 ADR 四态。
4. long-run checkpoint 产物不因 checkpoint 本身进入默认阅读 projection；仍需 adoption 后再 refresh。

---

## 8. Foundation / UI 投影边界

Projection refresh 不新增 Foundation runtime 枚举。

### 8.1 next_action

本 ADR 不新增 `next_action`。允许复用：

| 场景 | next_action |
| --- | --- |
| 只展示 stale / failed / fresh 结果 | `SHOW_RESULT` 或 `NO_FURTHER_ACTION` |
| 高成本 refresh 前确认 | `CONFIRM_BEFORE_EXECUTE` |
| refresh failure 可系统重试 | `RETRY_SYSTEM` |
| refresh 作为 long-run / task checkpoint 恢复 | `RESUME_TASK` |

`REFRESH_PROJECTION` 不得作为 new `next_action`。

### 8.2 card_type

本 ADR 不新增 `card_type`。允许复用：

| 场景 | card_type |
| --- | --- |
| stale / refresh recommended | `warning_card` |
| refresh running | `progress_card` |
| refresh completed | `result_card` |
| refresh failed | `warning_card` 或 `failure_card` |
| 高成本 refresh 需确认 | `confirmation_card` |

### 8.3 action_type

本 ADR 不新增 `action_type`。

1. failed refresh 的重试可投影为 ADR-0006 `retry`。
2. 高成本 refresh 的确认可投影为 `confirm` / `reject`。
3. stale 状态下的“刷新”入口不在本 ADR 新增 button action；它应触发 `intent.REFRESH_READING_PROJECTION`，具体 UI 入口由后续 UI 设计决定。

---

## 9. 事件要求

最小事件集合沿用 `27-reading-projection.md` §21.1：

| event | 必须出现的场景 |
| --- | --- |
| `projection_built` | 首次构建 projection |
| `projection_refreshed` | refresh 成功完成 |
| `projection_marked_stale` | accepted source 变化导致 stale |
| `projection_failed` | refresh 失败 |
| `recap_generated` | reader_recap 生成或刷新 |

约束：

1. `projection_marked_stale` 必须携带触发 trigger 与 affected projection refs。
2. `projection_refreshed` 必须携带新的 `source_revision_refs`。
3. `projection_failed` 必须携带 failure reason 与可重试性提示。
4. 事件名是 Domain event 名，不是 Foundation `next_action`。

---

## 10. 与 ADR-0009 的关系

ADR-0009 冻结 projection object 字段位置；本 ADR 冻结 refresh 状态与触发语义。

分工如下：

| 主题 | 权威 ADR |
| --- | --- |
| `reading_projection_root.status` 字段位置 | ADR-0009 |
| `status` 四态语义与转换 | ADR-0011 |
| 4 类 projection object 字段集 | ADR-0009 |
| `source_revision_refs` 字段挂载位置 | ADR-0009 + `30 §2.3` |
| stale 判定与 refresh trigger | ADR-0011 |
| reader_recap 字段边界 | ADR-0009 |
| recap source changed 对 projection freshness 的影响 | ADR-0011 |

---

## 11. 影响

### 11.1 对 Foundation 的影响

1. 无新增 Foundation phase / status / next_action。
2. refresh confirmation、retry、progress、failure 均复用 ADR-0002 / ADR-0006。
3. UI 不得通过新增 action_type 绕过 intent registry。

### 11.2 对 Domain 的影响

1. `27-reading-projection.md` §12–§13 的 refresh 状态与触发语义升级为 ADR 冻结。
2. stale 自动刷新还是手动刷新仍为策略配置，但 stale 标记与事件不可省略。
3. preview path 与默认 reading projection 分离。

### 11.3 对 UI 的影响

1. UI 可稳定区分 fresh / stale / rebuilding / failed。
2. UI 只消费系统给出的 status、source refs、events，不自行猜 stale。
3. UI 仍保留刷新入口、提示文案、加载样式与 preview 交互设计自由。

---

## 12. 回写目标

本 ADR Accepted 后已回写：

1. `0000-index.md` §2.1：新增 ADR-0011。
2. `00-overview.md` §7：新增 D2-028，说明 projection refresh 状态与触发语义由 ADR-0011 冻结。
3. `29-design-integrity-review.md` §7.1 第 11 条：若已由 ADR-0009 临时标记，改为 ADR-0009 + ADR-0011 共同冻结。
4. `30-contract-glossary.md` §10：追加本 ADR 冻结的硬骨条目。
5. `27-reading-projection.md` §24：标注 refresh 四态与最小触发语义已由 ADR-0011 冻结；保留“stale 后自动刷新还是手动刷新的产品默认策略仍后置”的表述。

---

## 13. 后续工作

1. 在后续 schema 文件中为 projection status enum 建立 `$id`。
2. 在 contract tests 中验证 accepted source 变化会产生 `projection_marked_stale`。
3. 在 UI 设计阶段映射 stale warning、rebuilding progress、failed retry 的呈现方式。
4. 若未来加入 preview mode object，需要新 ADR，不能复用默认 reading projection 四态表达 tentative preview。

## enforced_by

- （pending — projection refresh 尚未实现）
