# Q3D 消息处置与跨轮结果关联

- 状态：reopened / next（2026-10-08）；既有短会话正常路径验证保留，业务反例与真实入口幂等仍未闭环。
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
| BIZ-03 待采纳状态独立于聊天分页与上下文预算 | todo | 20 轮后刷新仍有待办；80 条窗口外旧候选仍可查询；省略数真实，Agent 与 UI 消费同一完整业务事实 |
| BIZ-04 真实 UI 的发送身份与重传闭环 | todo | 稳定 ID 进入 wire；ack 丢失/断线/刷新重试不重复运行；已完成/已失败/无 runtime 返回真实回执状态 |

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
