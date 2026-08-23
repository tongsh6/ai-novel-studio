# Schemas — JSON Schema / enum SSOT 索引

> 当前 JSON Schema 与 enum 单一真源。消费者：`pnpm codegen:schemas`（Zod 生成）、schema 漂移检查、兼容层。
>
> 规则：前端 TypeScript 类型不得手写，必须从此处 codegen；设计引用 schema 一律指向 `docs/design/schemas/...`。

## foundation/

| 文件 | 内容 |
|---|---|
| `foundation/candidate_direction.json` | 探索候选方向 schema；`adoption_status` 固定为 `not_adopted`，不同于 artifact adoption 7 态 |
| `foundation/turn_result_v2.json` | TurnResult v2 顶层 schema（ADR-0015 时代历史冻结；现行线格式见 v3） |
| `foundation/turn_result_v3.json` | TurnResult v3 线格式（draft）；决策面驱动字段类型化（ADR-0024 决策 5），`ui_cards` / `candidate_directions` 条目收紧由前端 barrel 组合完成 |
| `foundation/ui_card.json` | ui_cards 信息通告卡片 schema；card_type 三卡集合 + 禁 actions 字段（ADR-0024 决策 2/3，N-SURF） |
| `foundation/artifact_adoption_entry.json` | 采纳条目 schema |
| `foundation/phase_next_action_compat.json` | phase / next_action 兼容 schema |
| `foundation/ledger_entry.json` | 五本账统一信封（VS-00F §2 / ADR-0026）；进度视图对象，source_refs 非空（I-L1），status 与采纳 7 态正交 |
| `foundation/ledger_information_payload.json` | 信息账 payload 细则（VS-00F §2.4，五本账 payload 细则首份；伏笔/章计划信息两类条目，planned_reveal 预期归伏笔自己，留位字段刻意不填） |

## foundation/enums/

`slot_type` / `source_type` / `adoption_status` / `memory_status` / `memory_class` / `behavior_status` / `requiredness` / `ledger` / `arc_ledger_status` / `information_ledger_status` / `chapter_mission_status` —— 编译期冻结枚举的 SSOT（`ledger` 五账分类、`arc_ledger_status` 弧光账状态机、`information_ledger_status` 信息账状态机（VS00F 刀④），ADR-0026；`chapter_mission_status` 本章使命裁决状态（WR01b，VS-00E §16.8 / ADR-0024 S8）；其余账状态机随对应 CP 增补）。
