# Q3D 消息处置与跨轮结果关联

- 状态：reopened / next（2026-10-08，新增 BIZ-05）；BIZ-01–04 已闭环，本轮实模发现输出类型与动作语义错配。
- §1–4 保留首轮实现记录；当前业务反例的完成证据见后续 BIZ checkpoint。
- 完整契约：`docs/design/adr/ADR-0027-author-obligation-state-v3.md`（本次修订 Accepted）。
- 原因：D8 的只读执行结果未进入会话上下文；待采纳对象未完整供判断消费；Q3c 未覆盖两轮原文引用。

## 1. 开工七问

- Contract：ADR-0027、VS-00B/DialogueContext、AgentRun/TurnResult、ADR-0019 与 Q3c 作者字节来源。
- Invariant：I-M1–I-M5；I1/I2/I3/N-NARR 保持强度，不修改规则绕过。
- Boundary：web 接收→application 统一消息生命周期→persistence Interaction；domain context 承载投影。
  novel_agent/provider 与生产 UI 不改；不注册验收 provider 到生产环境。
- Consumer：会话恢复、下一轮 judgment、候选采纳与状态追问。
- Proof：输入失败/幂等/冲突、终态结果记录、作用域和字节来源测试；完整后端/前端门禁与四项不变量。
- Acceptance Driver：`q3d-message-outcome-roundtrip` 外部脚本驱动真实工作台，输出到
  `artifacts/slice-verify/q3d-message-outcome-roundtrip-tauri/`；产品验收感知逻辑为 no。
- Exploration：已有 Interaction/运行结果进入同批判断上下文；物化候选走现有采纳、档案读取链。

## 2. 任务清单

| 任务 | 状态 | 完成证据 |
|---|---|---|
| 修订问题定义与 ADR，明确三个层次 | done | ADR-0027 本次修订；第六账方案不再作为已接受前提 |
| 接收端先持久化、身份去重、原文不可变 | done | InteractionLifecycle/TurnInteractionService 测试；收到即写，冲突拒绝，durable 重传不多建任务 |
| 所有 flow 统一记录结果与运行状态 | done | 结果发布前落库；正文/修订旧分支迁移；失败/取消/steer 顺序测试通过 |
| 下一轮消费消息处置、待采纳与已解决状态 | done | 状态投影/作用域测试；只读结果与采纳状态真实页面回顾 |
| 历史作者原文引用与重复物化保护 | done | 来源白名单、原文字节、待采纳/已采纳重复保护；放弃允许重提 |
| 外部多轮工作台验收及刷新恢复 | done | q3d-message-outcome-roundtrip PASS；q3c 同消息路径回归 PASS |
| 全门禁、静态扫描、任务/旅程/台账同步及提交 | done | 编译/1506 后端测试/450 前端测试/四项不变量/架构/构建通过；完整扫描 0 blocking；记录随本批提交 |

## 3. 决策与恢复指引

- 2026-10-05：按用户认可的消息/运行/诉求分层方向实施；复用 Interaction、AgentRun 与
  采纳事实，不新增作者义务账。先统一已有链路，再由后续真实需求决定独立请求对象。
- 开工基线：`mix compile` 通过；前端依赖已按锁恢复，后端 Phoenix 已为 1.8.9。
- 继续时从任务表恢复；ADR 中的完整验收和错误路径未覆盖时只能记未闭环。

## 4. 实施与证据

- 接收身份复用 workspace/session/turn，以稳定 Interaction 主键去重；同身份不同原文拒绝。
- message_handling 复用运行状态，带 processed_at/result_turn_refs；原文不因状态更新改变。
- 结果去重包含 goal version，避免 steer 新回复覆盖上一轮或倒置 transcript 顺序。
- 已接收、尚未处理的当前消息留在完整 transcript 和状态投影中，不重复注入旧对话摘要。
- 本次没有修改 I1/I2/I3/N-NARR 的规则或 driver；历史作者原文通过来源 ref 绑定，
  候选 source_turn_ref 继续表示当前动作所属 turn，二者分离。页面验收曾抓到该归属混淆，已修复。
- 外部页面还抓到来源字段层级误读导致的重复候选；已按真实 adoption entry 顶层来源及
  resolved payload item 来源修复，未放宽 action 校验。
- 后端：1,506 tests / 0 failures；前端：450 tests / 0 failures；native verifier 定向 201 tests 通过。
- `bash scripts/build_sidecar.sh` 与 `pnpm tauri build` 通过；最终 .app/.dmg 包含本批 sidecar。
  本机 ad-hoc 签名，未做 Apple 公证；不声明公开分发验证完成。
- 四项不变量与编译/架构/前端审计/设计追溯通过；完整扫描首次返回 0，17 PASS / 2 既有 FAIL，
  剩余 3 项均是旧处置（误报、接受风险、暂缓），本次触及文件 finding=0。
- 页面命令：`bash scripts/quality_accept.sh q3d-message-outcome-roundtrip --surface tauri`；
  `bash scripts/quality_accept.sh q3c-author-content-materialization --surface tauri`。
- 证据：`artifacts/slice-verify/q3d-message-outcome-roundtrip-tauri/`；
  `artifacts/project-analysis/q3d-*.log`；`artifacts/static-scan/`。
- 边界：场景使用确定性测试 provider；Tauri 启动，外部 Playwright 操作当前工作台页面，
  不宣称直接驱动 native WebView 或完成真实模型语义质量验收。24 条既有后端测试告警仍保留。
- 上下文是有界投影（最近 80 条 Interaction 中的 10 条作者输入；原文预览 600 字符、
  待采纳/已解决各最多 12 条展示并说明省略）；不承诺跨任意长历史的自动来源检索。
  所有原始消息仍持久保存，超出可引用集合的来源不能静默猜测。
- 通用长期作者义务对象与自动语义履约判定不在本次已接受方案中，未来需独立需求与契约。


## 2026-10-08 使用场景审计后重开

用户要求以 agentic/App/业务逻辑正确性为主线。审计报告：
`docs/design/notes/2026-10-08-agentic-business-scenario-audit.md`。
此前 §2 的 done 表示当时已覆盖路径，不再据此宣称整个 ADR-0027 的业务不变量已关闭。

| 待收口 | 状态 | 完整验收后果 |
|---|---|---|
| BIZ-01 来源缺失不能保存指令；BIZ-02 原文登记与创作执行互斥 | done（2026-10-08） | 来源缺失/越界/矛盾组合须拒绝或澄清；正常当前/历史原文仍逐字进入候选；真实页面、trace、消息状态及采纳无回归 |
| BIZ-03 待采纳状态独立于聊天分页与上下文预算 | done（2026-10-08） | 20 轮后刷新仍有待办；80 条窗口外旧候选仍可查询；省略数真实，Agent 与 UI 消费同一完整业务事实 |
| BIZ-04 真实 UI 的发送身份与重传闭环 | done（2026-10-08） | 稳定 ID 进入 wire；ack 丢失/断线/刷新重试不重复运行；已完成/已失败/无 runtime 返回真实回执状态 |

审计阶段仅记录问题，未修复生产代码；参数测量停止。随后从 BIZ-01/02 开始实施，不能只改 prompt 或延长超时，
也不能以单个守卫或局部测试替代本表的完整用户场景。


### BIZ-01/02 实施 checkpoint（2026-10-08）

本 checkpoint 属于上表完整 Q3D 业务收口，BIZ-03/04 保留为下一 checkpoint。
Contract：ADR-0027 D4 的显式来源与操作组合；Invariant：原文字节、无隐式来源、无提前写入；
Boundary：application 判断解析与派发、AgentRun 失败持久化；既有 provider 更新显式来源契约，
错误注入只在 test/support，生产 UI/domain/persistence 不新增验收逻辑。
Consumer：真实工作台失败反馈、刷新恢复及采纳；Proof：协议/编排/来源测试、全门禁、四项不变量；
Acceptance Driver：新增 `q3d-author-registration-guards`，并回归 q3d/q3c 正常路径；
Exploration：没有新增要素类型，沿用 world_setting 候选和采纳后的档案探索入口。
实施结果：同一联合校验由解析与派发共同消费，显式来源方可物化；两阶段 prompt 共用规则。
失败沿现有 AgentRun → Interaction → TurnResult 留痕，不新增状态枚举或生产验收逻辑。
原有 Stub 与 test/support provider 补 `current` 来源以符合既有契约；故障注入仅在 test/support。

验证记录：

- 外部真实页面：`q3d-author-registration-guards`、`q3d-message-outcome-roundtrip`、
  `q3c-author-content-materialization` 均 PASS（`bash scripts/quality_accept.sh <id> --surface tauri`）。
  三类错误在一次纠正仍失败后安全停止；各输入 handling=failed/result_turn_refs 完整，
  刷新无候选、作品事实为零；纠正场景保留历史原文字节及来源，作者采纳后唯一 CONFIRMED。
  截图、帧、app JSONL、三份 `*-restored.json` 与 `adopted-restored.json` 在各自 artifacts 目录。
- 局部/全量：48 项定向测试、1,517 项后端测试、467 项前端测试、207 项外部证据验证器测试通过。
  `mix compile --warnings-as-errors`、xref cycles、arch_check、前端 typecheck/lint/test 均通过。
- 未修改规则的 I3 3/3、I1 4/4、I2 三组两两不交、N-NARR 均通过；证据
  `artifacts/project-analysis/biz12-run_*.log`。
- `bash scripts/build_sidecar.sh`、`bash scripts/frontend_audit.sh`（含 Tauri 构建）通过，
  .app/.dmg 已包含本批 sidecar；本机 ad-hoc 签名，未做 Apple 公证。
- `bash scripts/ai_static_scan.sh --top 10`：首扫只新增过期任务清单阻断，最终清单刷新后复扫。
  本批生产/测试文件无 finding；存量三项继续按长期台账处理：Pencil fileToken 误报、
  另一开发线历史凭证 accepted_risk（所有者轮换/清理）、ChapterSummary 嵌套 deferred。
  明细见 `artifacts/static-scan/top10.md`、`disposition.md`、`report.json`。
- 边界：Tauri 已运行，外部 Playwright 驱动实际 App/WorkspaceChat 页面，不是 native WebView。
  使用可控测试 provider 注入异常，不宣称本次重新完成真实 Qwen 语义质量复验。
- 下一 checkpoint：BIZ-03 将完整待采纳事实与聊天分页/模型预算分离；随后 BIZ-04 入口发送身份与重传。
  Q3D / Journey C9 整体仍未闭环。


### BIZ-03 开工 checkpoint（2026-10-08）

- Contract：ADR-0027 D3/I-M5、既有 ArtifactAdoptionEntry/TurnResult；恢复快照增加
  pending_adoption_turn_results，携带待办所属回合的真实 available_actions，不伪造授权动作。
- Invariant：完整待办独立于 transcript 30 条及 context 80 条窗口；终态压过旧 pending；
  作品/会话隔离，历史只读；模型摘要省略数量真实，采纳仍须作者动作。
- Boundary：persistence 统一投影 → application 状态/恢复/探索 → web 快照 → Frontend 待办操作；
  不改 novel_domain/novel_agent 生产运行机制，不新建表或义务账。
- Consumer：WorkspaceChat 档案面板、Agent 下一轮判断及只读探索。
- Proof：超过两个窗口的 pending/resolved、重复快照、隔离和只读测试；完整门禁与四不变量。
- Acceptance Driver：q3d-long-session-adoption-state 从真实入口发消息、20 轮/80 条外刷新、
  查询旧候选、作者采纳与终态恢复；外部脚本取证，产品验收感知逻辑为 no。
- Exploration：在判断循环目录加入 session_adoptions，按当前 work/session 读取完整采纳投影，
  支持关键词/对象引用与分页，不借模型上下文已展示的 12 条替代全部对象。

BIZ-04 仍是下一 checkpoint，Q3D 整体不得标 done。


#### BIZ-03 实施与验证结果

- 完整采纳状态由 WorkSessionRepo 单点汇总，InteractionLifecycle 与 WorkSessionService 共用；
  只读取携带采纳状态的回合，不扩大聊天分页。按 artifact 去重，resolved 压过旧 pending。
- Agent 摘要提供真实总数/省略数，session_adoptions 在当前可信会话内按关键词、精确对象引用、
  offset 分页查询；不会读取其它作品/会话，不会自动采纳或扩大作者原文白名单。
- 恢复独立返回 pending_adoption_turn_results；前端通过统一线格式入口校验，并以 TanStack Query
  按作品/会话缓存，复用真实 action_id。Pencil 原型 ATnmR 及 43 §3–4 已核对，无视觉结构变更。
- 外部真实页面：`q3d-long-session-adoption-state` PASS。15 份作者原文候选，20 轮刷新及 45 轮
  （90 条消息）外恢复均完整；聊天页仍只有 30 条、不夹带旧候选；Agent 报告 15/省略 3，
  经探索找到最早候选。切到另一作品候选/操作凭据为零，切回后仍可直接在档案面板采纳。
  再聊 45 轮，待办 14、原候选保持 ACCEPTED，唯一对应 CONFIRMED 作品事实。
- 页面回归：`q3d-message-outcome-roundtrip`、`au03-session-history-readonly`、
  `su02-pending-result-work-isolation` 全部 PASS。旧 history 驱动改为填非空文字再检查发送；
  旧 SU02 夹具接回当前判断回复链，驱动等实际持久完成结果，不再把 Channel 接收 ack 当完成。
  这些只修改外部驱动/test-support，不修改生产门禁，也未改四项不变量脚本。
- 局部/全量：72 项定向、1,519 项后端、471 项前端测试通过；验收证据验证器 209 项通过。
  编译零警告、xref 零环、架构边界、I3 3/3、I1 4/4、I2 三组两两不交、N-NARR 通过。
- `bash scripts/build_sidecar.sh` 和 `bash scripts/frontend_audit.sh`（含 Tauri 构建）通过；
  .app/.dmg 包含本次 sidecar，源包与 .app 内副本 SHA-256 一致。本机 ad-hoc 签名，未公证。
- `bash scripts/ai_static_scan.sh --top 10`：17 PASS / 2 既有 FAIL，3 项旧处置，0 blocking、
  touched finding=0。开发中发现的新别名排序和测试夹具复杂度问题均修复后复查。
  剩余：Pencil fileToken 误报；另一开发线历史凭证 accepted_risk（所有者轮换/清理）；
  ChapterSummary 嵌套 deferred（下次触及时重构）。未更改处置台账以豁免新增问题。
- 证据：`artifacts/slice-verify/q3d-long-session-adoption-state-tauri/`（三次 resume、
  work-isolation、confirmed-facts、截图、网络帧和主链日志）；`artifacts/project-analysis/biz3-*`；
  `artifacts/static-scan/{top10.md,disposition.md,report.json}`。
- 验收边界：Tauri 启动，外部 Playwright 操作实际 App/WorkspaceChat 页面；使用确定性 provider，
  未直接驱动 native WebView，也未重新进行 Qwen 语义质量验收。
- 下一 checkpoint 为 BIZ-04 稳定发送身份/断线重传/终态回执；Q3D / Journey C9 整体仍未闭环。


### BIZ-04 开工 checkpoint（2026-10-08）

- Contract：ADR-0027 D1/D2、user_message 的稳定 turn_id、AgentRun 实际状态回执；新增
  user_message_submission schema 描述不可变的本地待投递记录，Tauri 使用本机文件存储。
- Invariant：同 scope/身份/输入重传只运行一次；同身份不同输入拒绝；作者新发送另建身份；
  先保留原文再投递；终态或已失活 runtime 不因 ack 被伪装为 running。
- Boundary：Frontend/桌面持久待投递 → Channel → Application → Interaction/AgentRun；
  不改创作能力、领域规则或采纳授权。接收与启动在同消息身份下串行化。
- Consumer：真实工作台发送、候选继续、重连/刷新重传；回执携带实际运行状态和已落盘结果。
- Proof：稳定 wire 身份、冲突/并发去重、完成/失败/失活回执、桌面存储恢复测试及完整门禁。
- Acceptance Driver：外部真实页面驱动发送，代理层丢弃回执/结果、断连、刷新，检查一份输入、
  一个运行、真实结果与状态；产品验收感知逻辑为 no。
- Exploration：本地待投递记录仅承担传输可靠性，不是小说要素；沿用已有消息及采纳探索面。

此 checkpoint 完成前，Q3D / Journey C9 保持未闭环。


#### BIZ-04 实施与验证结果

- 主消息、候选继续、阅读投影请求在发送前保留稳定 turn_id 与不可变原文；Tauri 使用原生命令，
  按作品/会话/身份原子写受限文件。浏览器入口通过 env.ts 适配存储，未新增生产验收开关。
- 本机保存失败不发送。回执不确定保留待核对消息；明确拒绝保留原文并标记 rejected，刷新只展示、
  不再自动投递。作者主动新发相同文字另建身份；不是按文字相似度去重。
- 后端按身份串行接收/启动，拒绝原文、候选引用、计划选项冲突及连接作用域不一致。已接受身份
  优先读取旧回执，不重复候选校验或会话激活（已补 Channel 历史候选反例）。重复提交
  返回原 run 的实际状态、runtime_live 和持久结果；状态读取不确定与确认失活分别表达。
- steer 复用投递机制，并单独保存 submission_id 与内部 parent:steer:version 来源；重复引导
  不再次推进目标版本。重连核对持久结果，当前会话补发不污染历史只读界面。
- 外部真实页面 `q3d-message-delivery-recovery` PASS：代理实际丢弃 60 条回执/状态/结果帧；
  completed/failed 刷新、running 断连与服务重启四类各只有一条原输入和一个 run；
  活运行重连回执为 running/live，终态仍为 completed/failed，失活仍保留历史状态但 runtime_live=false。
  引导回执丢失后刷新，原 run 的 goal.version=2，原引导只显示一次；再发相同文本创建新身份。
  回执只投影各 turn 最新结果，前端更新最新回复并按历史邻接顺序补齐缺失记录；可见回复数量
  与真实持久 transcript 对照，避免重复气泡和旧回复跑到对话末尾。
  外部篡改一次作用域让真实服务拒绝后，原文刷新仍在、不自动重试，服务端输入/run 均为零。
- 回归通过：q3d-long-session-adoption-state、q3d-author-registration-guards、
  au02-candidate-continuation、agent-awaiting-author-steer-resume、au03-session-history-readonly。
  均由真实 App/WorkspaceChat 入口驱动，Tauri 已启动；不声称直接驱动 native WebView。
- 局部/全量：1,524 项后端、478 项前端、211 项证据验证器、9 项 Rust 测试通过。
  I3 3/3、I1 4/4、I2 三组两两不交、N-NARR、编译零警告、xref 零环、架构边界通过。
- `bash scripts/build_sidecar.sh` 与 `bash scripts/frontend_audit.sh`（含 Tauri 构建）通过，
  最终桌面审计 27 PASS / 0 WARN / 0 FAIL；.app/.dmg 的 sidecar 与源包 SHA-256 一致。
  本机 ad-hoc 签名，未做 Apple 公证。
- 本批修复了回执函数复杂度、新浏览器存储位置告警和过期证据清单；统一扫描命令
  `bash scripts/ai_static_scan.sh --top 10` 在最终清单刷新后复跑。存量三项仍按既有台账处理：
  Pencil fileToken 误报；另一开发线历史凭证 accepted_risk（所有者轮换/清理）；
  ChapterSummary 嵌套 deferred（下次触及时重构）。未调整台账掩盖新增问题。
- 证据：`artifacts/slice-verify/q3d-message-delivery-recovery-tauri/`（delivery-wire、四类回执与 DB
  对照、steer-delivery、rejected-retained、截图/帧/主链日志）；`artifacts/project-analysis/biz4-*`。
- Q3D 的 BIZ-01–04 现已按 ADR-0027 的消息/运行/采纳分层契约闭环；不外推为通用作者义务机。
  此批使用确定性 provider 做故障注入，当前 Qwen 整批语义复验为 Q1b 下一项。


### BIZ-05：仅记录约束、方向候选与操作建议（next，P2）

Q1b 在 77bf8389 上跑完真实四轮；数据断言通过，完整业务语义未通过。首轮“不生成候选”仍产出
三张方向卡；登记轮“采纳/修改/丢弃”获得 choose_candidate，公开入口把“丢弃候选”接受为
后续创作方向。详见审计 notes §9、Q1B slice 与 project-ledger §8.1。

下一 checkpoint 必须从现有 VS-00 / VS-05 / UI contract 的语义边界开始，说明七问后再编码：

- 核对作者“仅记录”的约束与所有候选输出，不因候选非空静默改变回复语义。
- 分离真正创作方向与流程建议；操作建议不能获得 choose_candidate/work_direction 后果。
- 正确保留 artifact 的 accept/discard/edit；源、字节、采纳权限及状态不变量不放宽。
- 外部真实页面补“仅记录无候选”“流程建议无方向采用”“正常创作方向仍可用”及恢复/旧数据矩阵。
- 修复后加强 q1b 的候选方向断言，并重跑当前真实模型；不能继续只以 pending 为空宣称不生成候选。

本轮只完成实模核查和缺口登记，未实施 BIZ-05；没有错误动作分支的完整页面点击证据。
