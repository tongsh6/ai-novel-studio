# UI 前冻结包：Schema 收口工单清单

- 状态：Proposed
- 日期：2026-04-24
- 范围：`docs/design-v2/29-design-integrity-review.md` §7.1 第 1–11 项的 schema 收口
- 前置依据：
  - `docs/design-v2/29-design-integrity-review.md` §7.1（必须先冻结清单）
  - `docs/design-v2/30-contract-glossary.md`（命名与枚举风格已收口）
  - `docs/design-v2/adr/README.md`（ADR 模板）

---

## 0. 本计划解决与不解决的问题

### 解决

- 把 29 §7.1 中编号 1–11 的"必须冻结但仍未冻结"项落到**最小可用 JSON schema**。
- 每项产出一个独立 ADR 文件（`adr/NNNN-<slug>.md`），包含 schema 定义、字段语义、示例、与既有文档的回写指引。
- 给出一个**可终止的判定标准**：当 §7.1 第 1–11 项全部被 `Accepted` 状态的 ADR 覆盖，且 `00-overview.md §7` / `30-contract-glossary.md` 完成回写后，本计划完成。（每项至少一个 ADR；允许拆分为子 ADR。）

### 不解决

- 不引入新的业务能力或新对象族。
- 不改 Foundation / Domain 的原则级语义（29 §3.1 已确认主链无冲突）。
- 不做 UI 文档与 `pencil` 原型（属于下一阶段）。
- 不做 §7.1 第 12–15 项（这四项在 31/32/33/34 已有专门文档承载，独立处理）。
- 不动 `novel_workbench/` 现有代码（v2 共识：可重做，本阶段不绑定旧实现）。

---

## 1. 范围核对：29 §7.1 第 1–11 项

| 编号 | §7.1 原条目 | 主要承载文档 | 当前状态 |
|---|---|---|---|
| W1 | TurnResult v2 最小完整 schema | `01-agent-foundation-contract.md` | 字段名已散落，无统一 schema |
| W2 | turn / task / artifact 最小状态枚举（adoption 7 态由 `30` §3.2 + ADR-0001 唯一权威，本 ADR 仅 `$ref` 引用，不重定义） | `01`、`02-turn-and-task-state-machines.md` | turn/task/artifact 仍未列全 |
| W3 | behavior-specific UI hint 最小 schema | `03-conversation-behaviors.md`、`11-ux-contract.md` | 仅有原则，无 schema |
| W4 | card / action 最小 schema | `11-ux-contract.md` | 有 taxonomy，无 JSON schema |
| W5 | authority / budget / escalation 最小枚举 | `01`、`10-security-and-budget.md`、`30` §5 | `write_scope` 已列 4 态；其余维度未列 |
| W6 | volume / arc 关系 | `21-novel-object-model.md` | 仅"二者都留位置"，关系未定 |
| W7 | 首批 UI 需要的具体 intent 最小集合 | `24-novel-intent-catalog.md` | 仅 family，无具体 intent 列表 |
| W8 | 这些 intent 的最小 slot schema | `24-novel-intent-catalog.md` | 无 |
| W9 | maintenance artifact / adoption review 最小 schema | `25-maintenance-hooks.md` | 流程清楚，artifact 字段未定 |
| W10 | reading_projection_root / toc / chapter / reader_recap 最小字段集 | `27-reading-projection.md`、`30` §8.3 | object family 已命名，字段未定 |
| W11 | projection refresh 最小状态与触发语义 | `27-reading-projection.md` | 仅原则，无状态枚举与触发表 |

> 来源原文：`docs/design-v2/29-design-integrity-review.md:444-463`。

---

## 2. 依赖图与执行顺序

依赖原则：**下游消费者** 不能在 **上游 schema** 冻结之前定稿。

```text
W1 (TurnResult) ⇄ W2 (状态枚举)   ← co-draft，互留 placeholder，最终合稿
              W2 ─┬─ W3 (behavior UI hint)
                  ├─ W4 (card / action)
                  └─ W9 (maintenance adoption)
W5 (authority / budget) ── 独立，被 W7/W8 引用（intent 的默认 risk_class）
W6 (volume / arc) ── 独立，被 W7/W8/W10 引用（intent 作用域 / projection TOC 层级）
W7 (intent 列表) ─ W8 (intent slot)
W10 (projection 字段) ─ W11 (refresh 状态)
```

### 执行波次（每波内部可并行，标注的 intra-wave 依赖除外）

- **Wave A（基础枚举）**：W1 ⇄ W2（co-draft），W5, W6
- **Wave B（依赖 A）**：W3, W4, W9, W7, W10
  - **intra-wave 依赖**：W9 启动前需 W4 草稿冻结 card 公共字段（W9 adoption review payload 引用 W4 card schema）
- **Wave C（依赖 B）**：W8（依赖 W7）, W11（依赖 W10）

理由：W3/W4/W9 都引用 W2 的状态枚举与 W1 的 result 顶层；W8 必须在 W7 列出 intent 后才能定 slot；W11 必须在 W10 字段定后才能定刷新状态机。

---

## 3. 工单清单（11 项 → 至少 11 个 ADR）

每个工单结构统一：**目标 / 输入 / 产出 / 完成判据 / 失败信号**。
单工单允许拆为多个 ADR 文件（如 `0002a` / `0002b`），只要仍落在同一 §7.1 编号下。

### W1 · ADR-0001 · TurnResult v2 顶层 schema

- **目标**：定义 `AgentTurnResult` 最小 JSON schema（顶层字段、类型、required、与 `cards` / `behaviors` / `adoption` / `projection_refs` 的层级关系）。
- **输入**：`01-agent-foundation-contract.md:1080-1107`、`30` §10。
- **产出**：`docs/design-v2/adr/0001-turn-result-v2-schema.md`，含：
  - JSON schema（draft-07 即可）。
  - 至少 3 个示例：纯回答 / 触发 clarification / 触发 long-run。
  - 回写指引：列出 `01` 中需引用本 schema 的小节。
- **完成判据**：
  - schema 字段集合覆盖 29 §4.2.1 列出的"主消息 / cards / behavior / adoption / projection"五类。
  - 状态字段使用 W2 的枚举（W1 与 W2 同波次，互相留 placeholder 引用，最终在 W2 完成后回填）。
  - 通过 Momus 评审（见 §5）。
- **失败信号**：出现"为了写 schema 而新增 Foundation 概念"——立即停下，回到 29 重审。

### W2 · ADR-0002 · turn / task / artifact 状态枚举

- **目标**：列出 3 类对象的最小状态全集 + 转换规则（仅状态机骨架，不含完整迁移条件矩阵）。
- **输入**：`02-turn-and-task-state-machines.md`。
- **范围声明**：adoption 7 态由 `30` §3.2 + ADR-0001 作为唯一 canonical 权威，本 ADR 不重定义、不内联，仅在需要时通过 `$ref` 引用 `foundation/enums/adoption_status.json`（由 ADR-0001 落地）。
- **产出**：`docs/design-v2/adr/0002-state-enums.md`，含：
  - 3 张枚举表（每张：枚举值、是否终态、典型触发）。
  - 1 张状态机图（mermaid 即可），覆盖 turn / task。
  - artifact 状态与 adoption 状态的关系说明（artifact 内嵌 adoption 状态 vs 独立）。
- **完成判据**：
  - 不重新定义 adoption 7 态（违反即 reject）。
  - turn / task / artifact 各自最小枚举不超过 8 个（避免过度设计）。
  - 与 W1 互相引用闭环。

### W5 · ADR-0003 · authority / budget / escalation 最小枚举

- **目标**：补齐 `30` §5 未列出的 `capability_scope` / `task_control_scope` / `budget_override_scope` 最小值集，以及 budget 维度（token / wall_time / cost / write_count）与 escalation 触发条件。
- **输入**：`01:1088-1091, 1103-1105`、`10-security-and-budget.md`、`30` §5。
- **产出**：`docs/design-v2/adr/0003-authority-budget-escalation.md`。
- **完成判据**：
  - 4 个 authority scope 各自最小枚举 ≤ 5 项。
  - budget 维度明确"哪些是硬上限 / 哪些是软提示"。
  - escalation 触发条件至少覆盖：超预算 / 高风险 intent / 重复失败。

### W6 · ADR-0004 · volume / arc 关系

- **目标**：在三种候选关系（A. arc 嵌套 volume；B. volume 嵌套 arc；C. 二者正交）中选一个并固化。
- **输入**：`21-novel-object-model.md:852, 865-867`、`29` §5.3.1。
- **产出**：`docs/design-v2/adr/0004-volume-arc-relation.md`，含：
  - "考虑过的方案 + 拒绝原因"完整段（按 ADR 模板，因为这是有真实分歧的决策）。
  - 对结构面板 / TOC / planning 默认单元 / reading projection TOC 的影响说明。
- **完成判据**：
  - 给出明确归属：planning 默认中观单元是 volume 还是 arc。
  - W7 / W10 可以引用本 ADR 的结论。

---

（Wave B 开始）

### W3 · ADR-0005 · behavior-specific UI hint schema

- **目标**：为 `clarification` / `confirmation` / `correction` / `cancellation` / `rejection` 五类 behavior（来自 `30` §6）各自定义 UI hint 最小字段集。
- **输入**：`03-conversation-behaviors.md`、`11-ux-contract.md`、`30` §6、W1。
- **产出**：`docs/design-v2/adr/0005-behavior-ui-hint.md`。
- **完成判据**：
  - 5 类 behavior 各有 hint schema；durable 类必须包含 `resolution_ref` 字段位置。
  - 与 W1 的 `behaviors` 数组字段对齐。

### W4 · ADR-0006 · card / action 最小 JSON schema

- **目标**：定义 card 公共信封 + action 信封 + 至少 5 类 card 变体（clarification / confirmation / warning / checkpoint / adoption）的 minimal schema。
- **输入**：`11-ux-contract.md:825-844`、`30` §9（NextAction → UI action 映射表）、W1、W2。
- **产出**：`docs/design-v2/adr/0006-card-action-schema.md`。
- **完成判据**：
  - card 公共字段 ≤ 8 个（id / type / title / body / actions / state_ref / created_at / domain_ext）。
  - action 字段与 `30` §9 表中右列的 UI actions 完全一致。
  - 留出 `domain_ext` 扩展点供 Domain（quality / approval / experience）后续注入。

### W9 · ADR-0007 · maintenance artifact + adoption review schema

- **目标**：定义 `maintenance_artifact` 字段集与 adoption review payload。
- **输入**：`25-maintenance-hooks.md:676-695`、`30` §3、W1、W2。
- **产出**：`docs/design-v2/adr/0007-maintenance-artifact-schema.md`。
- **完成判据**：
  - artifact 包含：`hook_name` / `revision_base` / `proposed_change` / `requires_adoption` / `adoption_state`。
  - adoption review payload 引用 W4 的 card schema（adoption card variant）。
  - 明确"低风险自动 adoption"的判定字段位置（具体策略不在此 ADR 内决定，只留字段）。

### W7 · ADR-0008 · 首批 UI intent 最小集合

- **目标**：从 `24-novel-intent-catalog.md` 13 个 intent family 中，挑出"首批 UI 必须支持"的最小 intent 集（建议 ≤ 20 个）。
- **输入**：`24-novel-intent-catalog.md:852-870`、`28-authoring-lifecycle.md`（按生命周期阶段筛选）、W6。
- **产出**：`docs/design-v2/adr/0008-first-batch-intents.md`，含：
  - intent 列表（每条：namespace 名 / family / 默认 risk_class / 是否需 confirmation / 是否 long-run）。
  - 选择依据：覆盖立项 → 写章 → 修订 → 阅读最小闭环。
- **完成判据**：
  - 至少覆盖立项 / 新章 / 改稿 / 维护 / 阅读 5 个生命周期阶段各 1 个 intent。
  - 每个 intent 都引用 `30` §7.1 的 namespace 格式（`intent.<NAME>`）。

### W10 · ADR-0009 · reading projection 对象字段集

- **目标**：为 `reading_projection_root` / `_toc` / `_chapter` / `reader_recap`（`30` §8.3 已命名）定义最小字段集。
- **输入**：`27-reading-projection.md:604-623`、`30` §2.3 / §8.3、W6。
- **产出**：`docs/design-v2/adr/0009-projection-object-schema.md`。
- **完成判据**：
  - 4 个对象各有字段集；`source_revision_refs` 字段位置与 `30` §2.3 一致。
  - TOC 层级遵循 W6 的 volume/arc 决议。
  - `reader_recap` 与 `aggregate summary`（29 §5.3.3 待决）的边界明确：本 ADR 只管 recap，summary 留给后续。

---

（Wave C 开始）

### W8 · ADR-0010 · 首批 intent 的 slot schema

- **目标**：为 W7 选出的每个 intent 定义 slot 字段。
- **输入**：W7 的 intent 列表、`24` 各 family 描述、W5 的 authority 字段。
- **产出**：`docs/design-v2/adr/0010-first-batch-intent-slots.md`。
- **完成判据**：
  - 每个 intent slot 字段 ≤ 6 个（避免膨胀）。
  - slot 中可出现 `clarification_required` 标志，与 W3 联动。
  - 至少 2 个 intent 配备示例 payload。

### W11 · ADR-0011 · projection refresh 状态与触发

- **目标**：定义 `reading_projection` 的刷新状态机（fresh / stale / refreshing / failed）与触发表（adoption 完成 / source revision 变化 / 用户手动）。
- **输入**：W10、`27-reading-projection.md`、`07-consistency-and-concurrency.md`。
- **产出**：`docs/design-v2/adr/0011-projection-refresh-policy.md`。
- **完成判据**：
  - 状态机含 4 态，转换边 ≤ 8 条。
  - 触发表覆盖 3 类来源：adoption 事件 / revision 变化 / 用户。
  - 明确 stale 是否阻断阅读（建议：不阻断，仅提示）。

---

## 4. 跨工单回写任务

§7.1 第 1–11 项全部被 `Accepted` 状态的 ADR 覆盖后，必须执行的"反向回写"：

| 回写目标 | 内容 | 责任工单 |
|---|---|---|
| `00-overview.md` §7 | 新增 D2-018 ~ D2-028 入索引 | W1–W11 各自 |
| `30-contract-glossary.md` §10 | 把新固化的字段补入"本文冻结的硬骨" | W1, W2, W5, W9, W10 |
| `adr/0000-index.md` §2 表格 | 追加 11 行 | W1–W11 |
| `29-design-integrity-review.md` §7.1 | 在第 1–11 项后标注 `Accepted by ADR-NNNN` | W1–W11 |

回写本身**不改变语义**，只更新引用与索引。

---

## 5. 评审与质量门

- 每个 ADR 进入 `Proposed` 状态后：
  1. 由 Sisyphus 起草。
  2. 用 Momus 评审 ADR 文件本身（输入：ADR 路径）。
  3. 如涉及 Foundation 跨子系统语义（W1 / W2 / W5），追加一次 Oracle 咨询。
  4. 评审通过后改 `Accepted`，并完成 §4 回写。
- **不**为单个 ADR 跑 `/review-work`（成本过高），仅在 Wave B 结束 + Wave C 结束 各跑一次集成 review。

---

## 6. 终止条件（DoD）

本计划完成 = 全部满足：

1. §7.1 第 1–11 项每项至少有一个 `Accepted` 状态的 ADR 覆盖（编号从 `0001` 起递增；允许同一项拆为多个子 ADR）。
2. `00-overview.md §7` 索引表为每个新增 ADR 追加一条 `D2-XXX` 条目。
3. `30-contract-glossary.md §10` 已扩充，列出本批新固化的字段。
4. `adr/0000-index.md` 表格已为每个新增 ADR 追加一行。
5. `29-design-integrity-review.md §7.1` 第 1–11 项已标注对应 ADR 编号（`Accepted by ADR-NNNN[, ADR-MMMM ...]`）。
6. `lsp_diagnostics` 不适用（纯文档）；改用：
   - `grep -rn "TODO\|TBD\|未定" docs/design-v2/adr/` 在本批新增文件中必须为空。
   - 每个新增 ADR 编号在 `docs/design-v2/` 其它文档中至少被引用 1 次（证明已完成回写）。

> **临时假设逃生口与 DoD 的关系**：若任一 ADR 走 §8 中 W6 风险条目所允许的"临时假设解锁下游、保持 `Proposed`"路线，本计划 DoD 自动延期至该 ADR 转 `Accepted` 之日。换言之，DoD 第 1 条的"全部 `Accepted`"是硬要求，逃生口仅是中间过渡，不是绕过 DoD 的口子。

满足后，可正式开始 UI 设计阶段（`40-ui-overview.md` 起）。

---

## 7. 不在本计划内的事情（防止范围蔓延）

以下事项虽然相关，但**不在本计划工作范围**：

- §7.1 第 12–15 项（quality finding / approval / experience / 字段优先级）的进一步细化——它们已有专门文档（31/32/33/34），如需补 schema 应另起计划。
- 29 §7.2 列出的"非阻塞"事项（资产对象细粒度、子类型枚举全集、feedback_patch 归并算法等）。
- `novel_workbench/` 既有代码的任何调整。
- UI 文档与 `pencil` 原型。
- ADR-0012+ 的预分配（按需新增即可）。

---

## 8. 风险与已知不确定性

| 风险 | 影响 | 缓解 |
|---|---|---|
| W6（volume/arc）分歧大，可能阻塞 W7/W10 | 中 | 优先级最高，Wave A 内最先开工；如果一周内未达成共识，先用临时假设解锁下游，ADR 状态保持 `Proposed`。**临时假设最长保留窗口：本计划 Wave C 启动前必须升级为 `Accepted`**（即 W8/W11 起草前，W6 必须定稿，否则 Wave C 阻塞）。升级截止条件：W6 ADR 给出明确归属决策（A/B/C 选一）并完成 §4 回写。 |
| W1 / W2 互相引用 | 低 | 同波次起草，最后一次性合稿 |
| ADR 主题膨胀（新增非 §7.1 范围的 ADR） | 中 | **范围闸门**：每个 ADR 必须可追溯到 29 §7.1 第 1–11 项之一；超出范围的新主题必须另起计划，不在本计划内新增 |
| 单个工单内部需要拆分（如 W2 拆成 turn / task 两份） | 低 | **允许**：工单可拆为多个 ADR 文件（如 `0002a-*.md` / `0002b-*.md`），只要仍落在 §7.1 同一编号下；拆分时同步更新 §3 工单表与 §4 回写表 |
| Schema 过度设计 | 高 | 每个 ADR 设字段数量上限（已在工单中标注） |
| 与未来 §7.1 第 12–15 项产生 schema 冲突 | 中 | W4 card schema 留 `domain_ext` 扩展点；W6/W9 留 quality / approval 关联字段位置 |

---

## 9. 工时估算（粗）

- Wave A（W1, W2, W5, W6）：~4 工单 × 2h = 8h
- Wave B（W3, W4, W9, W7, W10）：~5 工单 × 2h = 10h
- Wave C（W8, W11）：~2 工单 × 1.5h = 3h
- 评审 + 回写：~5h
- **合计：约 26h（3–4 个工作日纯产出）**

不计：分歧引发的额外讨论（W6 可能 +4h）、Oracle 咨询轮次。

---

## 10. 启动信号

用户确认本计划后，我从 **W1（TurnResult schema）** 开始，原因：

- 它是其他 ADR 的引用根。
- 一旦 W1 成形，W2/W3/W4/W9 都能并行展开。
- 风险最低（只是把 `01` 中已散落的字段聚合，不发明新概念）。
