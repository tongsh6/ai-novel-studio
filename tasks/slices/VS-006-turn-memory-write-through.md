# VS-006 Turn Memory Write-Through

- 状态：done
- 类型：Memory Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

每个 turn 的用户输入和系统回应都必须写入 hot memory 与 warm persistence，并能按 workspace / turn 查询，为后续 context assembly 提供可靠来源。

本 slice 打实"交互留痕成为可召回记忆"的基础路径。

## 2. 开工检查

- Contract: `docs/design-v2/05-memory-retention-and-retrieval.md`；`docs/design-v2/schemas/foundation/enums/memory_class.json`；`docs/design-v2/schemas/foundation/enums/retention_tier.json`
- Invariant: memory 必须按 `workspace_id` 分区；同一 turn 多条记录不得覆盖；hot/warm 写入字段语义一致
- Boundary: 涉及 `novel_agent` hot store、`novel_application` TurnService 编排、`novel_persistence` warm log；`novel_web` 不直接写 memory
- Consumer: TurnService / MemoryRecallService / memory retrieval API
- Proof: Memory.Store 测试、MemoryLog 测试、TurnService 双写测试、workspace 隔离查询测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum |
| novel_domain | no | 不引入领域对象 |
| novel_agent | yes | hot store 测试补齐 |
| novel_application | no | 只审核已有路径，不改代码 |
| novel_persistence | yes | 新增 MemoryLog 测试 |
| novel_web | no | 不直接写 memory |
| frontend | no | 本 slice 不做 UI |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审核现有 TurnService memory 写入路径 | done | handle_message 双写 user+assistant，handle_adopt 写 assistant。MemoryStore+MemoryLog 均收到同一 entry map。 |
| T2 | 固化 hot store key 不覆盖不变量 | done | seq 计数器确保同毫秒同 turn 不覆盖，新增 5 条同 turn 防覆盖测试 |
| T3 | 固化 warm log 字段与 hot entry 对齐 | done | 13 个字段全对齐。新增 MemoryLog 测试（9 个），覆盖 record/recent/downgrade/field alignment |
| T4 | 增加 workspace 隔离和顺序查询测试 | done | 新增 workspace 隔离测试（recent + by_turn）、排序测试 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 279 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles found

## 6. 决策日志

- 2026-04-30 — 建立 memory write-through slice，承接现有 memory foundation，实现方向是固化不变量而不是扩展召回策略。
- 2026-04-30 — T1 审核发现：hot (ETS) 和 warm (DB) 双写无事务协调，TurnService 忽略 MemoryStore/MemoryLog 返回值。当前阶段可接受（memory 为 best-effort），后续如需要可引入 outbox pattern。
- 2026-04-30 — T2/T3 确认：`record_to_memory/4` 产出的 13 个字段与 `Interaction.changeset/2` 完全对齐，DB migration 已补齐 6 个字段。

## 7. 试行反馈

- MemoryLog 此前零测试——本次补齐了 9 个测试覆盖所有公开 API。
- `MemoryStore.recent/2` 的 `tab2list` 全表扫描实现在热条目少时可行，后续如果 hot tier 增长需改为 `match_object` + 游标。
- hot/warm 缺乏统一的写入原子性——在当前阶段是已知取舍，记入决策日志供后续 outbox/transaction 方案参考。
