# Schemas — JSON Schema / enum SSOT 索引

> 当前 JSON Schema 与 enum 单一真源。消费者：`pnpm codegen:schemas`（Zod 生成）、schema 漂移检查、兼容层。
>
> 规则：前端 TypeScript 类型不得手写，必须从此处 codegen；设计引用 schema 一律指向 `docs/design/schemas/...`。

## foundation/

| 文件 | 内容 |
|---|---|
| `foundation/candidate_direction.json` | 探索候选方向 schema；`adoption_status` 固定为 `not_adopted`，不同于 artifact adoption 7 态 |
| `foundation/turn_result_v2.json` | TurnResult v2 顶层 schema |
| `foundation/artifact_adoption_entry.json` | 采纳条目 schema |
| `foundation/phase_next_action_compat.json` | phase / next_action 兼容 schema |

## foundation/enums/

`slot_type` / `source_type` / `adoption_status` / `memory_status` / `memory_class` / `behavior_status` / `requiredness` —— 编译期冻结枚举的 SSOT。
