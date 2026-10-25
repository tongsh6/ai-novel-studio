# B37 验收等待与故障监督优化（消除空等）

- 状态：**done（2026-10-25，CP0–CP5；canonical-3e 使用）**：统一 wait 预算/watchdog/fail-fast/wait-events（无 600s 盲等；故障注入 page_closed/backend_down 1ms、action_failed 252ms、stall 1256ms 退出）+ detached launcher（父 shell kill -9 后 run 继续、stop 1076ms TERM/143、lock）；canonical-3b 使用 detached 启动后暴露**真实模型预算不匹配**（input30s×2 / turn120s 对续写不足→重复发送），已停止并记为 attempt2；**CP3** 按 provider 校准预算（strata/lmstudio: input120/turn360/candidate300/adoption180/maintenance300…）+ turn 超时不重发同指令；canonical-3c 待 CP3 后 fresh 跑。
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

### CP4 实施记录（2026-10-25，`b62eb1ae`）

- design beat：首指令按章节计划确定性推导方向（下一待写章/seq/用途）+ 命名授权 +「直接生成并保存到作品档案，不需要再问我」；产品仍 ask_author 时补 ≤2 条不同具体方向（避开演化/世界设定触发词）；等待只认 `character_seed`，无关 `prose_ready/candidate_ready` 忽略/不采纳，首个无关后 `DOGFOOD_DESIGN_UNRELATED_GRACE_MS`（slice5s/real30s）有界等待；只有无关候选→`design_unrelated_candidate_only` bounded 失败；detail 记 direction/clarifications/ignored_candidates。
- dry-run（slice_verify）：normal_design/ask_then_seed/unrelated_then_seed PASS；unrelated_only bounded FAIL ~5.2s；正常 10 章+维护 5/5、wait_stats 46/0 timeouts；故障注入不回归。
- 下一步：design-beat 真实模型 scoped replay（canonical DB 副本）→ PASS 后 canonical-3d fresh（attempt1/2/3 保留）。

### CP4 真实模型 scoped replay（2026-10-25，PASS）

- canonical-1 DB 新副本 `tmp/dogfood-db-p1-design-replay-20261025`；detached maintenance-only design_character；strata iq3_s；证据 `artifacts/novel-output/p1-b37-cp4-design-replay-2026-10-25/`。
- design 拍：character_seed「陆沉」1 候选→真实作者 accepted；direction=第05章线；clarifications=0、ignored=[]、wrong_route=0；wait 4/38.7s/0 timeouts；canonical DB sha 未变。
- 结论：B37 CP4 确定性方向/bounded 澄清/无关候选忽略在真实 iq3_s 成立；canonical-3d fresh 启动。

### CP5 记录（2026-10-25，用户指出运行中模型会等作者回复；canonical-3d attempt4 停止）

- canonical-3d phase1（detached，~15min）实况：第01章 1539、第02章 1127；多次 `agent_awaiting_author` → runner 按工具失败 readToc/取消活跃 run/重发，每章多耗 2–4min；用户指出模型在等作者决策/补充，不能干等。Lead 通过 detached stop 终止（attempt4 证据 `...canonical3d-attempt4-awaiting-author/`，不用于 P1）。
- task-102（B37 CP5）：通用 `respondToAuthorQuestion`——识别 awaiting question/options/recommended；以作者身份 bounded 回复具体默认决策（章/续写/维护/扩章共用，≤2 次不同回复）；**不 cancel/readToc/重发**；无问题文本/重复问题→`author_question_unresolved` bounded 失败；记录 author_question_events；dry-run fixtures + 真实模型单章 scoped replay 后 canonical-3e final。

### CP5 实施记录（2026-10-25，`0476f299`）

- 识别 `turn_result.author_question`（question/options/recommended/actions）；`respondToAuthorQuestion` 章/续写/维护/扩章共用：options 选 recommended/第一个；无 options 按动作具体默认回复；≤2 条不同回复；记录 author_question_events；**不 cancel/readToc/不重发原 instruction**；无问题文本/重复问题/无 action → `author_question_unresolved` fatal；集成章 adopt/maintenance/plan expand。
- test-support 最小分支：choice 回复「保留悬念」→ 第01章 prose 候选；slice_verify_test 51/0；dry-run free-text/options→prose 555 字（1 instruction/1 回复）；重复/无文本 bounded fatal；正常 10 章+维护 5/5、故障注入不回归；全后端 2241/0。
- canonical-3e final：fresh DB/证据目录 detached 启动（attempt1–4 保留；运行中 author question 自动应答并入监控）。

### CP5 完成与 canonical-3e 验证（2026-10-25）

- CP5 提交 `0476f299`：通用 author_question 应答（options/free-text，bounded ≤2；不 cancel/readToc/重发；无问题文本/重复→`author_question_unresolved` fatal）；dry-run 全 PASS（free/options→prose 555 字；repeat/no-text bounded；正常 10 章+维护 5/5；故障注入不回归）。
- canonical-3e final：detached 两阶段 EXIT0；wait **59 waits/1,433,314ms/0 timeouts**；无重复 instruction；author_question_events=0（本批未触发，机制武装）；failure/termination 证据齐。
- 结论：B37 等待/预算/防重发/作者问答/进程隔离在真实长跑验证；后续长跑复用 detached launcher。
