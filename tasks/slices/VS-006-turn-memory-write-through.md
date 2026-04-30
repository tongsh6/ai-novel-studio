# VS-006 Turn Memory Write-Through

- 状态：todo
- 类型：Memory Slice
- 启动日期：2026-04-30

## 1. 用户 / 系统目标

每个 turn 的用户输入和系统回应都必须写入 hot memory 与 warm persistence，并能按 workspace / turn 查询，为后续 context assembly 提供可靠来源。

本 slice 打实“交互留痕成为可召回记忆”的基础路径。

## 2. 开工检查

- Contract: `docs/design-v2/05-memory-retention-and-retrieval.md`；`docs/design-v2/schemas/foundation/enums/memory_class.json`；`docs/design-v2/schemas/foundation/enums/retention_tier.json`
- Invariant: memory 必须按 `workspace_id` 分区；同一 turn 多条记录不得覆盖；hot/warm 写入字段语义一致
- Boundary: 涉及 `novel_agent` hot store、`novel_application` TurnService 编排、`novel_persistence` warm log；`novel_web` 不直接写 memory
- Consumer: TurnService / MemoryRecallService / memory retrieval API
- Proof: Memory.Store 测试、MemoryLog 测试、TurnService 双写测试、workspace 隔离查询测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | memory enum |
| novel_domain | optional | 仅当使用 domain memory item |
| novel_agent | yes | hot memory store |
| novel_application | yes | turn 写入编排 |
| novel_persistence | yes | warm memory log |
| novel_web | optional | 只查询 application service |
| frontend | optional | 本 slice 不优先做 UI |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审核现有 TurnService memory 写入路径 | todo | 确认 user/assistant 都写入 |
| T2 | 固化 hot store key 不覆盖不变量 | todo | 同毫秒多条记录应保留 |
| T3 | 固化 warm log 字段与 hot entry 对齐 | todo | workspace_id / turn_id / role / tier |
| T4 | 增加 workspace 隔离和顺序查询测试 | todo | 这是后续 recall 的地基 |

## 5. 验证

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix run scripts/arch_check.exs`

## 6. 决策日志

- 2026-04-30 — 建立 memory write-through slice，承接现有 memory foundation，实现方向是固化不变量而不是扩展召回策略。

## 7. 试行反馈

- 待记录。
