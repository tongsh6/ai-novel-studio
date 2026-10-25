# B37 验收等待与故障监督优化（消除空等）

- 状态：**doing / CP0–CP2 完成（2026-10-25，`7130d3b8`）**：统一 wait 预算/watchdog/fail-fast/wait-events（无 600s 盲等；故障注入 page_closed/backend_down 1ms、action_failed 252ms、stall 1256ms 退出）+ detached launcher（父 shell kill -9 后 run 继续、stop 1076ms TERM/143、lock）；canonical-3b 使用 detached 启动后暴露**真实模型预算不匹配**（input30s×2 / turn120s 对续写不足→重复发送），已停止并记为 attempt2；**CP3** 按 provider 校准预算（strata/lmstudio: input120/turn360/candidate300/adoption180/maintenance300…）+ turn 超时不重发同指令；canonical-3c 待 CP3 后 fresh 跑。
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

## 5. CP1/CP2 实施记录（2026-10-25，`7130d3b8`）

- `dogfood-runner.mjs`：`WAIT_BUDGET_DEFAULTS`（input30/ack30/turn120/candidate120/adoption90/maintenance180/export60/toc30，env `DOGFOOD_WAIT_<KIND>_MS`）；所有等待经 waitForJourneyKind/waitFor，10s heartbeat + `wait-events.jsonl` + summary `wait_stats`；fail-fast typed error（action_failed/action_result failed/adoption_persistence_failed/incomplete_scope/UI 失败文案/page closed/backend health down/SIGTERM）；watchdog 10s；failure.json（code/current_wait/wait_stats/stack）。
- `scripts/dogfood_run_detached.sh start/status/stop`：Python 独立 session（start_new_session）、pidfile/lock、4657/5769+strata 预检、detached.log/heartbeat.jsonl/meta（HEAD/命令/env）、trap INT/TERM/EXIT 写 termination.json、stop 定向 TERM 进程组。
- 验证（slice_verify）：正常 10 章+维护 5/5、46 waits/5538ms/0 timeout；故障注入 page_closed/backend_down 1ms、action_failed 252ms、stall 1256ms 全部 exit1+typed failure；detached 父 shell kill -9 后 run 继续 exit0、主动 stop 1076ms TERM/143、重复 start exit1；node/eslint/bash-n 绿。
- 证据 `artifacts/novel-output/p1-b37-wait-supervision-2026-10-25/`；canonical-3b 使用 detached launcher。

### CP3 记录（2026-10-25，真实模型预算校准中）

- canonical-3b attempt2（HEAD `7130d4b8`→`177422f5`，detached）暴露：input 30s 两次超时；turn 120s 对真实 iq3_s writer/续写不足（实测 writer 90–200s、续写 197s），08:15 runner 超时后**重复发送同一续写指令**（08:16:44 才收到并采纳）→ 批次污染，已停止（Lead 通过 detached stop，TERM/143；证据改名 `...canonical3b-attempt2-budget-contaminated/` 并写 failure-summary）。
- 修复（task-100）：按 provider 预算（slice_verify 快；strata/lmstudio input120/ack60/turn360/candidate300/adoption180/maintenance300/export120/toc60，env 可覆盖）；turn 超时**不重发**同 instruction（in-flight guard + wait_timeout/failure）；wait_events/summary 记 provider/budget；slow_turn 故障注入测试；detached status/stop 支持显式 artifact dir。
- canonical-3c：CP3 修复提交后 fresh DB/证据目录执行（attempt1 SIGTERM/attempt2 预算污染均保留，不重跑分数）。

### CP3 实施记录（2026-10-25，`f0e26573`）

- provider 预算表（env 覆盖）：slice_verify input30/ack30/turn120/candidate120/adoption90/maintenance180/export60/toc30；strata/lmstudio input120/ack60/turn360/candidate300/adoption180/maintenance300/export120/toc60；late_result_grace real120s/slice30s。
- turn 超时**不重发**：超预算只等 late-result grace，grace 失败→fatal `turn_timeout` 非零退出；in-flight guard；`isFatalWaitError` 直接冒泡。
- wait_events/wait_stats/failure.json 记录 provider/budget/elapsed/outcome；detached status/stop 支持 `--artifact-dir`。
- 测试（slice_verify）：预算表断言；slow_turn+小预算→exit1/turn_timeout/`instruction_sent` 恰好 1 次；page_closed/backend_down/action_failed/stall 回归；正常 10 章+维护 5/5、46 waits/5532ms/0 timeouts。
- canonical-3c：fresh DB/证据目录（attempt1 SIGTERM、attempt2 预算污染保留）。

### CP4 记录（2026-10-25，canonical-3c attempt3 design beat 修复中）

- canonical-3c phase1 EXIT0/15.7min：5 章推进 01 1009/02 1064/03 1296/04 2192/05 0；总 5,561；B9 confirm2/skip0；B37 wait_stats **35 waits/0 timeouts/无重复 instruction**（预算/防重发生效）。
- 维护：format PASS、content_revision PASS（第04章 1049→1136，第一段实际变化）；**design_character 4 次失败**（产品 ask_author 要具体方向；runner「方向由你定」后仍 await；随后非预期 prose_ready 候选 fail-fast）；renumber/role 未触发 → maintenance 5/5 不可能；未跑 phase2；证据改名 `...canonical3c-attempt3-design-beat-failed/`。
- task-101：design beat 首指令具体化（方向/定位/用途+命名授权+直接生成保存）、澄清 bounded≤2、无关候选忽略只等 character_seed、有界失败、deterministic dry-run；之后 design-beat 真实模型 scoped replay → canonical-3d fresh。
