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

## 当前 AU Slice 文件

| 文件 | 角色 |
|---|---|
| `AU10-workbench-recovery-taskstate.md` | AU-10 recovery 已闭环 checkpoint：真实工作台“导出全书”的 task_state 生命周期可见性；下一队首见 `tasks/NEXT.md`。 |
| `AU10-workbench-recovery-disconnect-timeout.md` | **CP1~CP3B checkpoint closed**：provider 不可用、WebSocket service reconnect、取消等待与真实 provider timeout 均已有真实工作台 Tauri 证据；完整异步 LongRunner streaming 和 stale/disabled/idempotency UI 仍待后续。证据见 `tasks/NEXT.md` 和对应 `artifacts/slice-verify/au10-workbench-recovery-*-tauri/summary.json`。 |
| `AU12-work-profile-overview.md` | **AU-12 首个切面（checkpoint closed）**：补设计 43 §5① 缺失的「作品档案立项概览」只读视图。用户 2026-06-17 调整队列先做 AU12，CP1 已由 `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json` 证明真实工作台可核对 works 立项字段且不泄漏内部 Work UUID；下一队首见 `tasks/NEXT.md`。验收锚点 `docs/design/acceptance/author/AU-12-work-profile.md`。 |
| `AU09-character-dossier-roundtrip.md` | **CP1 done**：作品档案各 tab「数据展示+操作」端到端可用的第一个样板。已打通角色主档案断链——`character_seed` 采纳回写 `Character` 表（设计 21 §7.2 主档案层，**不写记忆**）+ AI 引导的上下文感知 schema 化角色设计（专用 capability 非独立 Agent）+ 角色 tab 展示 + 上下文读取。证据：`artifacts/slice-verify/au09-character-dossier-roundtrip-tauri/summary.json`；CP2 待做字段级结构化、关系对象和角色演化 memory。 |
| `AU10-action-idempotency-stale-disabled.md` | **CP1 部分闭环**：AU10-GAP-03(P0)。后端 stale/invented/disabled + idempotency 去重早已实现且 channel/单测覆盖；本 slice 补前端 duplicate 可见反馈（commit `2724653`）。双击/旧按钮 stale 的外部真实页面验收因 UI 竞态 + 内部状态依赖判定为非确定性，按 Option A 不纳入 harness（slice §7 已落账）。 |
| `AU09-archive-memory-roundtrip.md` | **CP2 checkpoint closed**：作品档案伏笔/规则入口已能通过 `world_building -> foreshadowing_seed / *_rule_seed -> adoption` 写入 governed memory，并按语义进入伏笔/规则 tab 的 read model；`au09-adopt-setting-recall` 已证明真实页面 adoption、伏笔/规则 tab 重开可见、recall/why。不能标完整 AU09 done，因 replay 和完整 trace 仍待补。 |
| `AU09-memory-management-workbench-entry.md` | **checkpoint closed**：正式工作台记忆管理入口、创建、确认、锁定、废弃、归档与 recall/why 基础生命周期已由 `au09-memory-management-entry` 真实 Tauri 验收证明。 |
| `AU09-memory-trace-roundtrip.md` | **checkpoint closed**：记忆 lifecycle/reference 追溯已由 `au09-memory-trace-roundtrip` 证明；locked terminal 后端阻止和 blocked trace 有局部测试，真实页面可见“引用与治理追溯”。 |
| `AU09-validity-window-recall.md` | **checkpoint closed**：章节级 `valid_from` / `valid_until` 已参与普通召回，`au09-validity-window-recall` 证明窗口外记忆不进入 context/why。 |
| `AU09-cross-work-memory-isolation.md` | **checkpoint closed**：跨作品记忆隔离已由 `au09-cross-work-memory-isolation` 证明。真实工作台从作品 A 切到作品 B 后，记忆管理页、作品档案伏笔/规则、ordinary recall 和 why 只消费当前 Work 的 memory。 |
| `AU09-AU03-session-memory-layering.md` | **checkpoint closed**：同一作品内 active session、historical session、current work memory 在 context/why 中分层且不互相伪装，已由 `au09-au03-session-memory-layering` 真实 Tauri 证据证明。 |
| `AU11-quality-diagnosis-message-envelope.md` | **checkpoint closed**：SC-AU11-01 质量诊断引导已把 VS-00D 三层 message / AIMessageEnvelope 从 docs-ready 推进到真实工作台 trace proof；AU11 整体仍有缺上下文真实验收、clarify/confirm guidance_mode、prose_writing envelope 投影缺口。 |
| `AU11-missing-workstate-policy.md` | **next**：SC-AU11-02 缺当前作品上下文不编造。证明 WorkState missing policy 在真实工作台 trace/why 中可见，assistant 不编造已读章节事实且 no write。 |

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
