# tasks/slices/

承重竖切面执行目录。

长期规则见 `docs/engineering/vertical-slice.md`。当前队列入口见 `tasks/NEXT.md`；本目录只保留仍服务当前推进的 P1 / AU / SI slice 文件。

## 文件类型

| 前缀 | 用途 |
|---|---|
| `P1-*.md` | P1 小说主链与质量 checkpoint |
| `AU*.md` | 作者旅程验收缺口或恢复 slice |
| `SI-*.md` | 场景化验收不变量与 CI 强制项 |
| `v3/` | 历史命名的当前承重切面工作区；后续有改动时应逐步迁出或重命名，不再新建版本化目录 |

旧 `VS-001..018` 与旧 `DAG.md` 已删除；它们引用的 phase roadmap、旧 ADR 和 Router-first 语义不再作为有效执行事实。

## 最小结构

每个 slice 文件至少包含：

```md
# <Slice Name>

- 状态：todo / doing / done / blocked / deferred
- 类型：Turn Slice / Behavior Slice / Artifact Slice / Projection Slice / Memory Slice / UI Contract Slice / Acceptance Slice
- 启动日期：YYYY-MM-DD

## 1. 用户 / 系统目标

本 slice 要打实什么长期承重能力。

## 2. 开工检查

- Contract:
- Invariant:
- Boundary:
- Consumer:
- Proof:
- Acceptance Driver:

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
| docs/design | no | |
| quality | no | |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | | todo | |

## 5. 验证

- [ ] 外部自动化驱动真实页面的场景化验收
- [ ] 后端 / Channel / 组件局部验证
- [ ] `bash scripts/quality_manifest_check.sh`
- [ ] `bash scripts/check_design_trace.sh`（如果涉及 frontend）

## 6. 决策日志

- YYYY-MM-DD — ...

## 7. 试行反馈

记录本 slice 暴露出的规则缺口、过重流程或需要脚本化的检查。
```

## 试行原则

- slice 文件不是表格填空；它必须帮助接手者理解链路。
- 如果 Contract / Invariant / Boundary / Consumer / Proof / Acceptance Driver 写不出来，优先缩小或重切 slice。
- 不为了满足结构而制造未来抽象。
- 试行期允许更新本 README 和 `docs/engineering/vertical-slice.md`，但要在 slice 决策日志里说明原因。
