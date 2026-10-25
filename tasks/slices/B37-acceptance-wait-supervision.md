# B37 验收等待与故障监督优化（消除空等）

- 状态：pending / CP0 设计登记（2026-10-25，用户反馈：验收体系等待机制需优化，许多空等浪费时间；canonical-3 被外部 SIGTERM 后无快速失败/监督）
- 类型：验收 harness 可靠性（不新增产品能力；runner/launcher/监督与证据）
- 来源：canonical-1/2/3 运行证据；B33 CP3/B35 CP3b/B36 CP3 scoped replay；用户 2026-10-25 指令
- 关联：P1-AUTHORING-DOGFOOD、B36、`frontend/slice-verify/dogfood-runner.mjs`、`scripts/dogfood_run.sh`

## 1. 问题事实

- canonical-2：采纳失败（产品 action failed）后 runner 仅等待 `adoption_settled/action_accepted`，失败帧归 ignore → **600s 盲等 ×2 ≈20min**；已加 action_failed/UI 文案 fail-fast。
- canonical-3：15:55:02 后端收到外部 SIGTERM（非产品/SIGTERM 来源未识别），page closed 后 runner 批量 skip、最后截图 uncaught 崩溃；0 字、无导出。长跑生命周期依赖 agent 工具 job，进程组可能被外部中断（未证明，但需隔离/监督）。
- 现有等待类别：输入框可见（60s）、发送 ack、turn_result/candidate、采纳、维护拍、导出；多为固定 timeout，异常时无心跳/无 last-state 证据。
- B9/维护 fail-fast 已有局部修复，但缺少**统一等待框架/预算/心跳/超时分类/进程隔离**。

## 2. 设计（冻结候选）

1. **等待原语**：`waitFor(kind, predicate, budgetMs)` 统一封装；每类预算：input 30s、ack 30s、turn_result 120s、candidate 120s、adoption 90s、maintenance 180s、export 60s、TOC 30s（可 env 覆盖，禁止 600s 盲等）；等待期每 10s 记录 heartbeat（kind/elapsed/last frame/page alive/backend health）。
2. **终局失败信号**：`action_failed`/`action_result failed|rejected|error`、`adoption_persistence_failed`/`incomplete_scope` reason、UI 文案「作品档案写入失败/采纳失败」、page/context closed、backend health down/SIGTERM、进程退出 → **立即抛 typed error**（不重试空等）。
3. **全局 watchdog**：独立 10s 定时检查 page.isClosed、backend `/health`、当前 wait 是否超预算；命中写 `failure.json`（kind/elapsed/last_state/stack）并非零退出；summary 增 `wait_stats`/`wait_events.jsonl`（kind/start/end/elapsed/outcome/last_frame）。
4. **进程隔离/监督**：`scripts/dogfood_run_detached.sh`（start/status/stop）：用 Python `os.setsid()` 或等价方式把 run 放入独立 session（避免 agent 工具 job 生命周期/信号影响）；pidfile/lock/ports 预检；日志/heartbeat/termination 元数据（记录收到 TERM/INT 时间与来源）；stop 只按 pidfile；异常中断也写 termination.json 并 teardown。
5. **故障注入与测试**：runner 支持 `DOGFOOD_FAULT_SIM=page_closed|action_failed|stall|backend_down`（仅 harness，默认 off）在 slice_verify dry-run 下验证 fail-fast 时间/退出码/证据；不用于真实验收判据。
6. **指标**：每次 run 输出 wait 总时长/超时次数/最慢 wait；超预算或 page closed 即失败；正常成功路径不变。

## 3. CP 计划

| CP | 工作 | 证据 |
|---|---|---|
| CP0 | 事实/设计冻结（本节） | slice |
| CP1 | 等待框架/watchdog/fail-fast/心跳/wait_stats 实现 + 故障注入 dry-run 测试 | runner/launcher 代码+证据 |
| CP2 | detached launcher/pidfile/lock/termination 监督 + 测试（dry-run、父进程被杀仍存活、收到 TERM 快速失败） | 脚本+证据 |
| CP3 | canonical-3b 使用 detached 监督执行；等待统计/失败快速性纳入验收报告 | canonical 证据 |

## 4. 边界

- 不改产品/frontend/src/judgment/schema；不改验收判据语义（只改等待/失败/监督）；不新增产品钩子。
- 真实模型仍单槽、用完卸载；canonical-3b 一次（canonical-3 attempt1 SIGTERM 保留为事故批次，不因分数重跑）。
- 不删除/覆盖历史证据；等待预算/故障注入参数在 evidence/summary 中记录。
