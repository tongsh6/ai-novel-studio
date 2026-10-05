# Q3D 消息处置与跨轮结果关联

- 状态：done（2026-10-05）；消息闭环、外部真实页面、局部/全量回归与质量门禁完成。
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
