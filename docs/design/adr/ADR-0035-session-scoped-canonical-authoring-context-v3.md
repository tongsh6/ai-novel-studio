# ADR-0035：会话级 canonical 创作上下文——对话是工作面，run 是执行单元

- 状态：**Proposed（2026-11-08，草案待作者批准；本 ADR 未批准前不实现）**
- 日期：2026-11-08
- 来源文档：
  - `../00-vision-and-engineering-roadmap.md` §2.1（Agent 系统的核心：会话结构）、§2.4（最小供给/按需求证/证据闭环）
  - `../notes/2026-11-08-session-level-product-deviation.md`（产品级偏差诊断，本 ADR 的输入；notes 不授权实现）
  - `../contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md` §16.1/§16.6/§16.12/§18/第 99/221 行
  - ADR-0033（Authoring Run Transcript / Request IR；本 ADR 细化其实现边界，不取代其契约族）
  - `tasks/slices/B71-provider-message-fidelity.md`（G6 与实模证据真源）
- 影响范围：AgentRun / AuthoringSession / JudgmentProtocol / Request IR / TranscriptCompaction / 持久化与恢复 / 三类 Provider 投影 / Trace / Replay / 验收分层

## 背景

产品级偏差诊断（2026-11-08）确认：B71 G6 长期不可取证不是压缩小功能问题，而是**会话结构在运行时缺失**——

- 每个 turn 是一个独立 `AgentRun`，新 run 由 `new_transcript/4` 从 `application_base` + 当前作者输入 + 当前 scope 重建，**不继承会话历史**；canonical transcript 持久化在 run 级私有列；
- 同 session 多 run 的真实批次（A3，6 runs）中，每个 run 的 transcript 只含本 run 的作者消息，跨轮指代（"刚才读到的线索"）没有会话事实可用；
- 压缩机制按"长会话/更早作者回合"设计（VS-00L 第 99/221 行），但输入是 run 级 transcript 且只整理"更早作者回合" → 实模/确定性批次全部 0 checkpoint；G6 没有对象；
- 会话历史只以旧装配链 `:session_transcript` 材料类型与 Interaction 展示流存在，B71 主链不消费。

同时确认与外部工具（Codex/Claude Code）的**同构性**：

- **对话是工作面**，不是过程记录：作者与 AI 共同工作的上下文载体（意图、判断、承诺、观察、压力）；
- **事实材料经工具读取**：外部工具读代码仓库/文件；我们读应用内作品信息（章节/角色/设定/采纳状态/版本）——同构；
- 真实差异只在产品契约层：结构化作品事实 + 采纳门 + 版本/证据链 + 作者安全。

因此修复方向不是发明新会话模型，而是把成熟范式（session 工作面连续 + 压缩投影 + 工具读取事实）对齐进来，并保留我们的产品契约。

## 决策范围

本 ADR 冻结会话与 run 的职责边界、上下文派生与压缩作用域：

1. **session 是创作上下文的主体。** 同一 session 的 canonical authoring transcript 承载跨 turn 连续的运行历史（作者回合、assistant 工具调用、观察/校验结果、tentative 候选、作者裁决、checkpoint、应用通知与当前 scope），是"这个会话到目前为止发生了什么"的单一事实源；同 session 内的每次 `AgentRun` 是该历史中的一个执行段，`run_id` 作为其身份与追溯引用。
2. **run 是执行单元，不是上下文边界。** 有界/持久执行、预算、step、恢复、取消、失败与运行事件仍以 run 为单元记录与追溯；但 run 不拥有独立于会话的上下文事实，新 run 不重置上下文。
3. **每轮请求由会话派生。** 每轮 Provider 请求是从会话 canonical 历史派生的投影：正常为完整会话历史 + 当前作者输入 + 当前 scope + 按工具目录按需取得的观察；窗口压力越线时，以显式 checkpoint 投影替代**更早的**已完成历史，保留最近 K 项已完成交换，作者原话、当前 scope 与未覆盖消息保持原序。
4. **压缩的作用域是会话历史。** 压缩选择会话历史中更早的已完成交换（跨 turn 累计，按 call_id 精确整组选择），checkpoint 记录 `covers.call_ids`/`source_refs`/`versions`/`omissions`/`summary` 以及**覆盖的 turn 范围**；canonical 消息永久追加保留、不删改；同批幂等；失败静默、下一安全点重试；未完成/未闭合交换不得进入压缩范围。
5. **压缩是上下文管理机制，不是附属功能。** 它使"长会话历史连续 + 窗口可控"同时成立；"压缩后历史连续进入后续请求"是机制后果，不是每轮必经步骤（正常情况历史完整进入，越线才投影）。
6. **事实材料按需读取。** 作品档案与应用内作品信息由统一只读工具目录按需求证（元原则 §2.4），不预装全集；观察的 refs/版本与证据绑定进入后续请求（含跨 turn）；"最小供给"约束事实材料供给，**不约束会话连续性**。
7. **保留 ADR-0033 契约族不变。** Request IR、三类 Provider wire 投影、能力事实单一派生、作者主权（无 adopt/canon_write）、tentative-first、I1/I2/I3/N-NARR 不变量、作者字节与 artifact 因果、显式 checkpoint 语义均不改变；本 ADR 只调整"事实源的作用域与 run/session 职责"。
8. **审计/回查以会话为对象。** Why/Replay 与作者历史从"会话 canonical + run 引用"派生，不依赖展示流猜测；作者可见面保持无技术词、失败静默、幂等恢复。
9. **旧语义处置（未发布前提，不做兼容）。** run 级私有 transcript 列、旧 `:session_transcript` 材料类型与旧装配链在落地 slice 中迁移/删除；历史证据只读保留在 artifacts，不做产品内兼容层。
10. **不做隐式压缩。** 不按消息数/字符数静默丢弃；压缩只经显式 checkpoint（§18 自动维护/未来显式入口），且必须满足第 4 条全部约束。

## 非目标

- 不改变工具事实读取与只读探索语义（仍按需求证，不预装全集）。
- 不改变采纳门/确认交接/作者主权边界。
- 不引入隐式压缩或"每轮最小上下文"（后者会使压缩失去对象，与第 3/5 条矛盾）。
- 不改变作者可见面安全要求、失败静默、幂等恢复。
- 不把诊断报告或本 ADR 的 Proposed 状态当作实现授权。

## 考虑过的方案

- **方案 A（采纳）：会话级 canonical 创作上下文。** session 承载跨 turn 连续历史；run 为执行单元；压缩作用于会话历史；每轮请求由会话派生；事实材料经工具读取。解决跨轮连续性、D8 类风险、压缩/G6 可达性、审计对象缺失。
- **方案 B（不采纳，仅记录）：保留 run 级 canonical + 显式会话摘要材料进入请求。** 能缓解连续性，但压缩仍无对象、G6 仍不可达，且形成"展示流摘要 vs 事实源"双轨缝合。
- **方案 C（不采纳）：重新定义产品为单轮执行器。** 与愿景 §2.1 的"会话结构是核心"冲突，除非作者重新裁决愿景。

## 最终决策

采纳方案 A（Proposed，待作者批准）。

## 决策理由

1. **愿景对齐**：§2.1 明确会话结构是产品核心，作者诉求跨 turn 存续（D8 判例）；§2.4 要求观察证据进入后续请求、复用统一 AgentRun 的观察/恢复/留痕——二者都要求 session 级连续上下文。
2. **同构性**：对话是工作面、事实材料经工具读取，与外部成熟工具同构；对齐范式比自造模型更可靠。
3. **缺陷闭环**：诊断报告的 P0-1（跨轮上下文断裂）、P0-2（会话级事实源缺失）与 P1-1（压缩/G6 不可达）在本方案下被直接消除，而不是被打补丁掩盖。
4. **证据分层**：G6 可在真实多轮会话中自然取证（修复前失败=缺陷证据），不再需要构造异常路径或专用 fixture。

## Contract 影响

- VS-00L §16.1「单一 canonical 会话边界」、§16.6「已有会话保留全部消息」、§16.12（transcript 持久化身份/恢复）需按本 ADR 的 session/run 职责修订落地说明；第 99 行「长会话 checkpoint 压缩」与第 221 行 G6（长会话 + checkpoint）语义保持不变，补齐"覆盖 turn 范围"的落地。
- §18 自动维护：触发仍为安全点 + 上下文压力，但作用域为会话历史（跨 turn），不再受"更早作者回合"限制（后者是实现自加约束，契约未要求）。
- ADR-0033 决策 1/7（AgentRun 为事实源、显式压缩）**原则不变**，批准后同步补充"canonical 历史作用域 = 会话；run 为执行段"的落地边界说明，并在其变更记录登记。
- 作者可见面无技术词、失败静默、幂等、canonical 不删改等既有条款不变。

## Umbrella 边界影响

- `novel_application`：`AgentRunServer`/`AuthoringSession`/`JudgmentProtocol`/`TranscriptCompaction` 的上下文与压缩作用域调整；`new_transcript` 不再重置上下文，改为从会话历史派生。
- `novel_persistence`：会话级 canonical transcript 的存储、身份、恢复与追加校验（取代/扩展 run 级私有列）；迁移与恢复幂等。
- `novel_common`：Request IR/Compaction 契约族保持；可能新增"会话派生上下文"所需的纯契约（不引入 I/O）。
- `novel_agent`：三类投影不按 run/session 变化，投影输入仍来自 Request IR；能力事实单一派生不变。
- `novel_web`：TurnResult/历史回查与 canonical 会话对齐；作者可见面无验收感知逻辑。
- `novel_test`/`novel_e2e`：夹具与验收从会话作用域构造，不再依赖 run 级异常路径。
- `novel_telemetry`：不变。

## UI / Trace / Replay 影响

- 作者消息流与 canonical 会话历史对齐（展示不再独立于事实源）；细条/展开/回查以会话 canonical + checkpoint 为准。
- Replay/Why 以"会话 canonical + run 引用"定位，保持默认不调模型、不返回私有推理。
- 前端不新增验收专用逻辑；外部自动化仍以真实页面多轮操作取证。

## 垂直切面证明（验收）

按 B71 验收分层执行，不代签：
1. **机制层**：会话历史派生请求、窗口压力投影、covers/turn 范围、保留最近 K、未完成不压缩、幂等恢复、三类投影一致。
2. **页面层（真实 Tauri 页面 + 外部自动化）**：真实作者多轮会话（跨 turn 连续）→ 自然触发压缩 → 作者可见细条/展开 → 压缩后真实请求携带正确会话事实（G6 判据）；修复前失败=缺陷证据，修复后通过=闭环。
3. **模型行为层**：实模多轮会话的压缩触发与上下文连续性；真实模型行为不代签、不与机制证据混报。

## 迁移与兼容

- 项目未发布：不做历史兼容；旧 run 级 transcript 私有列与旧 `:session_transcript` 材料在落地 slice 中迁移或删除；只读历史证据保留在 `artifacts/`。
- 分阶段承重 slice（批准后按项目节奏）：
  1. 会话级 canonical 历史（存储/身份/恢复/追加校验）；
  2. 每轮请求由会话派生（完整历史 → 窗口压力投影）；
  3. 压缩作用域与触发（会话历史、安全点/压力）、作者可见面与回查；
  4. 三类投影/恢复幂等 + 审计/回查；
  5. 真实页面多轮会话验收 + G6 取证；
  6. 旧语义退役与清理（保持 clean）。

## 后续工作

- 本 ADR 为 **Proposed**：需作者批准后，方可修订 VS-00L 落地说明、更新 ADR-0033 变更记录、创建承重 slice 并进入实现。
- 批准前不实现、不迁移、不删除现有代码；诊断报告与本文不构成实现授权。

## enforced_by

- pending: 待作者批准后落地（本 ADR 未批准前不实现）
  - 计划：`apps/novel_application/lib/novel_application/`（会话派生上下文、压缩作用域）、`apps/novel_persistence/lib/`（会话级 canonical 存储/恢复）、`scripts/arch_check.exs`（会话/run 边界规则）、`tasks/slices/`（承重 slice）、`docs/design/contracts/VS-00L-*.md`（落地说明修订）

## enforcement_gaps

- 本 ADR 为 Proposed，尚无实现与门禁承接；现有实现（run 级 transcript、run 级压缩）与本文冲突，属已知偏差，待批准后由承重 slice 消除。
- 旧 `:session_transcript` 材料类型与旧装配链的退役范围需在 slice 设计中逐项核对，避免遗漏消费者。

## 变更记录

- 2026-11-08：草案创建（Proposed）。输入为产品级偏差诊断 `docs/design/notes/2026-11-08-session-level-product-deviation.md` 与作者对同构性/工作面的纠正。
