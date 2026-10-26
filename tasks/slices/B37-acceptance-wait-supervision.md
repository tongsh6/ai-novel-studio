# B37 验收等待与故障监督优化（消除空等）

- 状态：**done（2026-10-27，P1 原生实模 scoped 批次使用本监督闭环）**。TERM10.314秒、外部failure首因保留、B31原生A4正常EXIT/0 已通过；真实模型本批归属记录/两运行时清理已由 P1 原生批次证据闭环：detached EXIT/0、35 waits/0 timeout、模型 loading-before/after-unload 落盘（Strata loaded=null 验证）、原生重开 cleanup 164ms remaining=[]、端口/进程释放；作者手动实例（LM embedding IDLE）保持未动。
- 原收口记录：**done（2026-10-25，CP0–CP5；canonical-3e 使用）**：统一 wait 预算/watchdog/fail-fast/wait-events（无 600s 盲等；故障注入 page_closed/backend_down 1ms、action_failed 252ms、stall 1256ms 退出）+ detached launcher（父 shell kill -9 后 run 继续、stop 1076ms TERM/143、lock）；canonical-3b 使用 detached 启动后暴露**真实模型预算不匹配**（input30s×2 / turn120s 对续写不足→重复发送），已停止并记为 attempt2；**CP3** 按 provider 校准预算（strata/lmstudio: input120/turn360/candidate300/adoption180/maintenance300…）+ turn 超时不重发同指令；canonical-3c 待 CP3 后 fresh 跑。
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

### 2026-10-25 完成审计：实际驱动与资源证据补口

作者选择保留原生标准。当前 dogfood-runner 实际执行 `chromium.launch({headless:true})`，但 summary 写 `surface=tauri`；需在后续原生补验前修正 producer 为实际 driver，并保留原报告只读。canonical-3e 的监督/等待/产品链证据有效，不能当原生窗口证据。B31→B28→B30→B29→P1 补验复用原矩阵，不改断言；原生外部 driver 也须遵守独立进程监督、10s 心跳、分型预算与 failure/termination 记录。

资源实际收尾证据在 `artifacts/completion-audit/20261025-1817/`：LM空，Strata loaded空及 native instances空。现有 detached脚本只卸载LM，不覆盖Strata native；下一实现步把两套状态检查纳入其退出路径。此为 harness 资源约束，不改产品加载/模型选择能力，不扩成全局模型管理系统。

#### 原生补验 harness CP0 预注册（作者裁决后，2026-10-25）

- Contract：沿用 AGENTS 场景红线、B26 实际 surface/driver 分类，以及 B37 分型等待/独立监督契约；不改变 B31 等场景的通过判据或 wire schema。
- Invariant：浏览器与原生证据不能混标；没有真实源动作/持久结果不能完成；超时不重发原指令；失败批次不覆盖；长跑不依赖工具 job 生命周期；退出后两种模型运行时均为空。
- Boundary/Consumer：仅 scripts、frontend/slice-verify 外部 harness、quality/任务证据；产品 apps/lib 与 frontend/src 不识别任何新验收开关。首消费者为 B31 原生五 trial，随后 B28/B30/B29/P1；复用既有 detached 监督能力，不另建平行任务/状态树。
- Proof/Driver：CUA 真实原生窗口的可见控件操作，外部 WS 代理/公开只读 API/app日志对账；原有浏览器完整矩阵保留。B31 明确允许的 T3/T4/T5 协议 seed 仅用于构造前提，被测输入来自原生 UI。验收感知产品逻辑 no；非要素物化，Exploration 不适用。
- 首批预算：确定性 slice_verify，真实模型调用=0；复用其 input/ack/turn/candidate/adoption/maintenance/export 分型预算（30/30/120/120/90/180/60秒），每10秒heartbeat。等待/进程异常写 failure.json 并结束该批，不把缺结果当作无事发生。同一失败类型两次后升级，不修断言换通过。
- 每批新 artifact tag、独立 DB/profile，失败目录只读；首批进入前记录源码HEAD、模型为空、预算和所用矩阵版本。原生补验不是重新评语义分数，不运行 B27全量 retest 或未预注册的P1长跑。

- 完成审计复核补记：首次卸载后已验证 LM=[]；门禁结束后的复核又见 idle embedding 驻留，尚未确认重新加载来源，不能归因于测试或某个用户应用。18:27 再执行一次 post-gate unload 并验证为空，保存 `lms-postgate-{unload.log,after.json}`。后续资源守卫应把“退出时仍驻留/复核重新出现”作为失败事实报告；不擅自关闭全局自动加载或停止未知消费者。

- 作者随后澄清（2026-10-25 18:29）：当前模型由作者手动装载。该实例归作者使用，保留，不继续全局 unload；此前“未知重载”不再作为自动重载缺陷推断。后续 harness 记录加载前快照和自身创建/使用的实例身份，只清理本次拥有的模型；已有作者实例存在时，确定性 slice_verify 继续零真实调用，真实模型任务另待单槽资源协调。退出报告区分“harness 已清理”与“作者保留实例”，不得将后者隐瞒为全局空。

- 原生 A1 揭露监督缺口：外部 failure.json 未被等待器立即消费，后来 idle timeout 覆盖了首因；显式 STOP 时父 shell 同步等子 shell 清理，30s后被KILL，缺termination。已修正等待器优先消费并保留首个 failure（测试5/0），监督用后台子进程+wait让信号 trap及时记录退出。A1 的实际失败经过与缺失termination如实保留，未补写伪造成功记录；停止工具输出为TERM后KILL。后续在A2复核退出记录。

- 作者批准“先验监督退出，再 scoped 复验”后：外部 failure 注入探针通过（原原因保留、EXIT/1、端口释放）；TERM探针 `b37-native-term-probe-20261025/` 仍失败：父进程11:01:03已TERM/143，子watchdog直到11:02:08的idle timeout才退出（>30s）。新根因定位到 tauri_slice_verify 原生分支同步等待前台Node，Bash延后TERM trap。已改为UI_DRIVER_PID后台任务+builtin wait，语法/等待账本5测试通过；未宣称TERM路径已复验通过。子进程最终已清理，未动作者模型。预算耗尽，下一次TERM复验及产品批次待作者裁决；细节 `artifacts/slice-verify/b31-native-repair-20261025/term-probe-failure.json`。

- 运行指纹：detached meta 现记录当前工作区实际runner/test-support源码sha，并在本批runner-source保存副本，避免只记录HEAD而遗漏未提交修复。原生已失败/已运行目录拒绝复用；preflight失败写failure。dogfood browser producer现如实写 surface=browser/driver=headless-chromium，原历史报告未改。当前新增代码仍受B31原生proof门禁阻断，未标完成。

#### TERM修复复验预注册（2026-10-25 20:38）

- 愿景依据：可审计与契约优先要求监督真实退出，不以父进程先退出代替资源清理。作者最新授权先据愿景判断工程事项；本次不更改验收标准。
- 范围/预算：仅一次native-slice监督退出探针，slice_verify，真实模型调用0；服务ready后主动stop一次，以发出stop至所属进程及4657/5769/4661端口全部释放的实际耗时≤30秒为通过，termination必须TERM/143。无产品输入，不作B31场景通过。
- 证据：`artifacts/slice-verify/b37-native-term-probe-20261025-final/`，独立DB与源码指纹；所有旧失败批次保持只读。仍失败则停止本批，不扩大预算。通过后才进入B31 A3已接受矩阵；作者手动加载模型保留。

- TERM复验通过：`b37-native-term-probe-20261025-final/term-verification.json`，2026-10-25T12:39:16Z发出stop，TERM/143即时记录；4.038秒端口全部释放，10.314秒全部已归属进程消失，≤30秒。未输入产品请求、真实模型调用0，作者模型保留。此证据关闭原生TERM退出缺口，不代表B31页面矩阵完成。

- B31 A4正常退出证据：五场景/7条绑定问答、47 waits/0超时，独立监督EXIT/0，端口及所属进程已清理。source snapshot含实际CharacterProfile修复；其余模型归属清理仍为P1前置，不能因确定性批次通过即销账。

- B28实模执行修正：原生等待按实际provider复用已校准预算（input120/turn360/candidate300/adoption180/maintenance300）；等待器6项测试通过。CUA辅助闭包跨批保留旧路径的问题属于驱动调用：后续每条journal显式传dir/id，不复用捕获运行状态的闭包。原错误及R2首因覆盖已在B28记录并保留审计；不伪造零超时。UI测量结束后立即关闭本批服务，离线验算在服务停机后执行，避免分析阶段占用idle预算。


## R3原生重开资源归属缺口（2026-10-26，CP0）

B28格式R3的8个分型等待全部结束，最后UI动作后detached stop成功（TERM/143）且测试端口释放。
但原生关闭/重开后，应用成为launchd子进程（PPID1），不在原detached进程树中：PID25701，
完整可执行路径位于`b28-format-native-20261026-r3/run/AI Novel Studio.app/Contents/MacOS/native-app`。
已核对该精确路径后只对该PID发送TERM，115ms退出，未动作者模型或其他应用。
证据：同批`run/resources-after.json`、`run/reopened-app-cleanup.json`、`termination.json`。

后续需让本批唯一可执行路径/实例身份随原生重开继续受监督，停止时覆盖归属已验证的重开进程；
不得扩大为按应用名或模型全局清理。当前仅CP0与精确补清理，自动回收机制未修复，P1前必须闭环。


- 修复契约：本批独立.app的精确可执行路径是跨重开的归属标识；清理前重新读取PID command核验，只对匹配PID发送TERM，3秒后仍匹配才KILL，总预算5秒；不按应用名或launchd进程组清理。入口仍是tauri_slice_verify的cleanup，产出native-app-cleanup.json；产品代码/模型生命周期不变。
- 复验预注册：下一次B28原生修复复验中实际关闭/重开窗口，最后stop后核对精确路径匹配进程为空、端口释放、termination及清理日志；不额外调用模型测试监督。旧R3手工补清理证据保留。

- R4首次真实回收：恢复计时超时后cleanup精确匹配重开进程PID35481（PPID1），自动TERM，142ms内remaining=[]；后端端口随监督退出。此证明跨launchd归属回收有效，R4产品读取修复已观测，但驱动漏finish导致全批EXIT1，不能冒充正常成功收尾。失败后getAXState重开出的本批窗口另行精确清理，审计在`b28-reading-repair-20261026/checks/r4-driver-audit.json`；原失败报告不覆盖。

- R5独立故障：恢复计时682ms已正常结束；约122秒后被监督的pnpm Tauri开发进程38309消失。现有日志没有退出来源，不能断言是谁终止。外部wrapper与原开发窗口共用com.ai-novel-studio.app，无法保证系统自动化按app身份只绑定wrapper，是已确认的归属歧义。
- 外部wrapper改为每批唯一CFBundleIdentifier（仍同一未修改产品二进制，生产tauri.conf.identifier不动）；ready元数据记录bundle_identifier。下一步仅一次0真实模型监督探针：实际关闭/重开wrapper，之后核对原开发进程与端口持续存活140秒（maintenance300预算、10秒心跳），再stop核对唯一可执行路径进程为空。目录`artifacts/slice-verify/b37-native-identity-20261026/`，不是产品验收或模型重试。

- 单独改wrapper bundle id的探针未通过：系统自动化无法打开该改名身份（procNotFound），准备预算到期退出，真实模型0。证据保留，不再沿此方向重试；wrapper身份恢复产品原identifier。
- 收敛启动方式：原生模式改为`pnpm tauri build --debug --no-bundle`嵌入当前前端资源，标准端点env/CSP overlay指向隔离后端/外部代理；只由CUA启动独立原生.app，不同时运行另一个tauri dev窗口/Vite树。监督保持后端/代理liveness，并按本批精确可执行路径观察原生进程；仅首次启动与显式restore允许短暂缺席。生产identifier、窗口和业务逻辑不变，无验收钩子。
- 先做一次0真实模型独立原生启动/重开/停止验证（`b37-native-standalone-20261026`），再考虑T4剩余复验；原生打开调用设显式工具超时，避免再次长时间阻塞沟通。

- 独立原生程序已正常加载tauri://localhost并重开；它存活到180秒维护预算结束。失败来自观察器迟于等待起点约120秒才开始又计满140秒，不能算程序自身退出。原生自动清理152ms成功；观察器在自动EXIT清理中再次stop，打断后续后端回收，留下已核对backend.log归属的两个进程，已单独清理并保留审计。
- 清理改为进入EXIT后忽略重复TERM/INT，保证剩余资源回收跑完。下一次仅做0模型“清理期间再次stop”故障复验，范围不重跑已证的长时间窗口存活；预注册目录`b37-native-cleanup-final-20261026`，注入外部失败后立即stop，首因须保留，30秒内所有已归属PID与端口清空。该故障注入通过不冒充业务slice通过。

- 重复stop故障复验通过：`b37-native-cleanup-final-20261026/run/cleanup-overlap-proof.json`，注入外部失败后在cleanup期间再次stop，首因保留，9个归属PID全部消失、端口全空，5.154秒≤30秒；原生launchd进程134ms退出，真实模型0。本批故障注入的failure.json是预期输入，不改为普通业务成功。

- 桌面已由作者确认解锁；临时shell入口包装仍出现AX可读但点击无效/noWindowsAvailable。移除手工CFBundleExecutable=shell包装，直接复制Tauri官方`build --debug --bundles app`产物，仅在副本LSEnvironment设置产品既有独立profile并本地adhoc重签，生产标识不变。ready记录真实native_executable=app，监督/清理精确匹配它；旧批次native-app只兼容读取。不修改或替换/Applications里的应用。
