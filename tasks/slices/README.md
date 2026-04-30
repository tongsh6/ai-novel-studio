# tasks/slices/

承重竖切面执行目录。

长期规则见 `docs/engineering/vertical-slice.md`。本目录只记录当前试行期的 slice 施工面、状态和恢复信息。

当前 DAG 见 `tasks/slices/DAG.md`。工程操作系统推进事项见 `tasks/2026-04-30-engineering-operating-system.md`。

---

## 文件命名

```text
VS-<三位序号>-<kebab-slug>.md
```

示例：

```text
VS-001-turn-result-contract-spine.md
VS-002-clarification-card-loop.md
VS-003-confirmation-before-execute-loop.md
```

---

## 最小结构

每个 slice 文件至少包含：

```md
# VS-001 <Slice Name>

- 状态：todo / doing / done / blocked
- 类型：Turn Slice / Behavior Slice / Artifact Slice / Projection Slice / Memory Slice / UI Contract Slice
- 启动日期：YYYY-MM-DD

## 1. 用户 / 系统目标

本 slice 要打实什么长期承重能力。

## 2. 开工检查

- Contract:
- Invariant:
- Boundary:
- Consumer:
- Proof:

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | |
| novel_agent | no | |
| novel_application | no | |
| novel_persistence | no | |
| novel_web | no | |
| frontend | no | |
| docs/design-v2 | no | |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | | todo | |

## 5. 验证

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix run scripts/arch_check.exs`
- [ ] frontend checks（如果涉及 frontend）

## 6. 决策日志

- YYYY-MM-DD — ...

## 7. 试行反馈

记录本 slice 暴露出的规则缺口、过重流程或需要脚本化的检查。
```

---

## 试行原则

- slice 文件不是表格填空；它必须帮助接手者理解链路。
- 如果某一项写不出来，优先缩小或重切 slice。
- 不为了满足结构而制造未来抽象。
- 试行期允许更新本 README 和 `docs/engineering/vertical-slice.md`，但要在 slice 决策日志里说明原因。

---

## 全部 slice 索引

| Slice | 类型 | 施工意图 | 状态 |
|---|---|---|---|
| `VS-001-turn-result-contract-spine.md` | Turn Slice | 固化 TurnResult 合同出口 | done |
| `VS-002-clarification-card-loop.md` | Behavior Slice | 固化缺 slot 到 clarification card 的等待闭环 | done |
| `VS-003-confirmation-before-execute-loop.md` | Behavior Slice | 固化高风险执行前确认闭环 | done |
| `VS-004-tentative-artifact-adoption-boundary.md` | Artifact Slice | 固化 tentative artifact 到 adoption 的权威边界 | done |
| `VS-005-accepted-artifact-marks-projection-stale.md` | Projection Slice | 固化 accepted source 变化使 projection stale 的派生链路 | done |
| `VS-006-turn-memory-write-through.md` | Memory Slice | 固化 turn 写入 hot/warm memory 的留痕路径 | done |
| `VS-007-intent-registry-expansion.md` | Turn Slice | 注册第一批核心 intent + Router LLM 升级 | done |
| `VS-008-provider-gateway-real-adapter.md` | Turn Slice | 实现 LM Studio Provider adapter + Gateway 路由 | done |
| `VS-009-governed-memory-recall-pipeline-close.md` | Memory Slice | 收束 Governed Memory Recall Pipeline | done |
| `VS-010-novel-domain-core-objects.md` | Artifact Slice | 落地 Novel Domain 核心对象模型 | done |
| `VS-011-real-provider-gateway.md` | Turn Slice | 接入 Anthropic API 真实 Provider | done |
| `VS-012-end-to-end-creative-turn-pipeline.md` | Turn Slice | 端到端创作对话链路打通 | done |
| `VS-013-modify-draft-closed-loop.md` | Turn Slice | 修改草稿闭环 + discard bug 修复 | done |

当前执行批次以 `DAG.md` 为准。README 中的表只做索引，不表达依赖顺序。
