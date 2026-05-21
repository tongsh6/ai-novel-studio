# tasks/

执行层目录：记录当前在做什么、做到哪了、为什么这么决定。

## 与其他文档的边界

| 层 | 位置 | 性质 |
|---|---|---|
| 规划 | `docs/design-v2/README.md`、`docs/design-v2/tech-stack/14-roadmap.md` | "应该怎么走"——节奏、目标、完成标准 |
| 决策 | `docs/design-v2/adr/` | 硬骨决策——一旦 Accepted 就稳定 |
| 施工规则 | `docs/engineering/vertical-slice.md` | "如何组织开发任务"——承重竖切面试行规则 |
| 执行 | `tasks/`（本目录） | "现在走到哪、为什么这么走"——状态、卡点、决策日志 |
| 竖切面 | `tasks/slices/` | "当前在打实哪段承重链路"——slice 开工检查、任务清单、验证与试行反馈 |

**纪律**：任何"目标 / 节奏 / 完成标准"信息只在规划层维护；本目录通过**引用**而不是复制锚定到规划层，避免漂移。

涉及功能开发的任务优先落到 `tasks/slices/`。周期性进展、跨 slice 汇总、阶段恢复指引仍保留在 `tasks/` 顶层 task 文件中。

## 文件命名

`YYYY-MM-DD-<phase-or-scope>-<slug>.md`，例如 `2026-04-26-phase-0-week-1-bootstrap.md`。
日期是任务**启动日期**，不是更新日期。

## 文件结构（最小）

每份 task 文件至少包含：

1. **范围** —— 引用规划文档对应章节，不复制内容。
2. **任务清单** —— 表格：任务 / status（todo / doing / done / blocked）/ 关联 commit / 备注。
3. **决策日志** —— 倒序时间戳，每条一句话 +（必要时）why。
4. **卡点 / TBD** —— 当前阻塞、未决问题、外部依赖。
5. **下次会话恢复指引** —— 给接手的 AI 或换工具的人："先读 X，再看任务表，从 Y 继续"。

## 何时新建 vs 追加

- **新建**：每个 phase / week / 集中作战周期开一份新文件。
- **追加**：同一周期内的状态、决策、卡点都追加到当前 task 文件，不开新文件。

## 跨会话纪律

- 开工前必须先读 `tasks/NEXT.md`。除非有 P0 bug，下一项工作从 `Queue` 中唯一 `Status=next` 的任务开始。
- `docs/product/user-journeys.md` 负责说明队首任务位于哪条用户旅行图、前后断点是什么；不能只因为某个局部任务容易闭环就跳出当前 focus。
- 每次完成 checkpoint 后必须同步更新 `tasks/NEXT.md`、`docs/product/user-journeys.md` 和 `docs/project-ledger.md`。可用 `node scripts/next_task_check.mjs` 做结构检查。
- 任务状态变更要 commit（不积压、不留在工作树）。
- 决策日志即使内容短也要写——它是接手者的关键上下文。
- 完成的任务保留在文件里，用 status 标记 `done`，不删除。
