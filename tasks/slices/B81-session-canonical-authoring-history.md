# B81：会话级 canonical 创作历史（ADR-0035 落地）

- 状态：**doing（2026-11-08 立项；ADR-0035 已批准；CP1 已实现，待全量门禁与提交；CP2–CP6 未开工）**
- 来源：
  - 作者 2026-11-08 批准 [ADR-0035：会话级 canonical 创作上下文](../../docs/design/adr/ADR-0035-session-scoped-canonical-authoring-context-v3.md)（Accepted）。
  - 产品级偏差诊断：[2026-11-08-session-level-product-deviation](../../docs/design/notes/2026-11-08-session-level-product-deviation.md)（P0-1 跨轮上下文断裂、P0-2 会话级 canonical 事实源缺失、P1-1 压缩/G6 不可达）。
  - 契约落地说明：[VS-00L §16.1/§16.6/§16.12/§16.16/§17/§18.8](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)（2026-11-08 ADR-0035 批准修订，Frozen 判据不变）。
- 本文不复制验收标准到第二份文档；契约/验收细节随阶段在既有落点（`docs/design/contracts/`、`quality/`、`docs/engineering/`）登记。

## 1. 问题与判断

B71 的 G6（压缩后真实请求）长期不可取证，根因不是压缩小功能，而是**会话结构在运行时缺失**（诊断报告证据）：

- 每个 turn 是一个独立 run；`JudgmentProtocol.new_transcript/4` 从 `application_base` + 当前作者输入 + 当前 scope 重建，**不继承会话历史**；canonical transcript 持久化在 run 级私有列（`agent_runs.authoring_transcript`）；
- 同 session 多 run 的真实批次（A3，6 runs）中每个 run 的 transcript 只含本 run 的作者消息，跨轮指代没有会话事实可用；
- 压缩按"长会话/更早作者回合"设计（VS-00L 第 100/222 行），但输入是 run 级 transcript → 实际全部 0 checkpoint，G6 无对象；
- 会话历史只以旧装配链 `:session_transcript` 材料类型与 Interaction 展示流存在，B71 主链不消费。

判断：**阶段 1 的价值不是加功能，而是把 canonical 运行事实的作用域从 run 提升到 session**，为阶段 2（每轮请求由会话派生）、阶段 3（压缩作用域会话历史）提供唯一事实基础。阶段 1 不改变模型可见行为（请求仍由 run 内结构派生），因此可独立实现与验证、风险最小。

### 1.1 断链定位（2026-11-08 核查，系统设计有、实现偏差）

**早期 session 相关 schema 确实定义过，但从来不是「会话级 canonical 结构」，而是三张表各管一段：**

| 时间 | 表 | 内容 | 角色 |
|---|---|---|---|
| 2026-04-28 | `interactions` | workspace_id / session_id / turn_id / role / content / memory_class / retention_tier / source_type / source_ref / scope_ref / replayable / retrievable | 对话消息流（展示/回放/retention）；content 是 TurnResult 形状，不是 canonical Request IR |
| 2026-05-09 | `decision_traces` | turn_id / frame_ref / decision_type / turn_result_ref / context_refs / event_order 等 | turn 级决策轨迹 |
| 2026-05-15 | `work_sessions` | id / work_id / title / summary / status / source_session_ref / source_turn_ref / last_opened_at | 会话身份容器；同时给 interactions、decision_traces 加 `session_id` |

v3 早期设计（[01 §3.3](../../docs/design/01-user-llm-workbench-interaction-model.md)）的"会话结构"是**每 turn 的合同组合**，落在 interactions + decision_traces；模型上下文由"会话摘要 + 作品状态 + 角色规则 + 作者输入"压进一个大型 user 文档（ADR-0033 背景原话）。

**B71/ADR-0033 把旧协议收敛为「单一 AgentRun 是唯一运行事实源 + run 内 Authoring Run Transcript/Request IR」并退役旧大 user 文档（含会话摘要），但迁移映射缺了三项承接：**

1. **契约层漏项**：ADR-0033 §7 要求 CP1 逐项列出旧 contract 的"保留/重命名/转换/退役"；"会话历史进入模型上下文"这一项没有作为保留/转换出现——实际按退役处理且无替代。VS-00L 只定义 run 内 transcript、Base、按需求证与"长会话 checkpoint 压缩"原则（第 100/222 行），**没有定义会话级 canonical 历史的数据结构、schema 与读边界**。
2. **schema 层缺位**：`work_sessions` 只是容器元数据（无消息/上下文结构）；`interactions` 是展示/回放流（非 canonical Request IR）；`decision_traces` 是 turn 轨迹；**不存在"会话 canonical transcript"的表、列或读端口**。canonical 结构只有 run 级落点 `agent_runs.authoring_transcript`。
3. **实现层表现**：`JudgmentProtocol.new_transcript/4` 新 run 从 base + 当前输入 + 当前 scope 重建、不继承会话历史；`AgentRunHistory` 只是按 work/session/turn 解析 run 的读取边界，不喂上下文；压缩 `plan_maintenance` 作用 run transcript，才需要"更早作者回合"这种额外收紧（会话历史无对象）；VS-00L §16.1「单一 canonical 会话边界」名实不符（实现是 run 边界）。

**结论**：断链点 = **"会话级 canonical 历史"这一层在 B71 迁移时没有被创建/承接**（设计有、实现偏差）。本任务的阶段 1 补这一层，并在重构中复用既有设计资料与实现（见 §8.0）。

## 2. 范围与非目标

**阶段 1 范围（CP1，已实现）**：

1. **会话级 canonical authoring transcript 存储**：同 session 跨 turn 连续的消息序列（作者回合、assistant 工具调用、观察/校验、tentative 候选、作者裁决、checkpoint、应用通知与 scope），身份绑定 `session_id + work_id + workspace_id`；每条消息可追溯所属 run（`run_id` 引用，run 仍是执行段）。
2. **追加/合并边界**：每次 run 的成功/失败结果经 `AgentRunLog.commit_snapshot/2` 事务内追加到会话 transcript；现有完整前缀不可被改写（前缀不可变校验）；身份冲突/错绑拒绝；未知版本诚实拒绝（未发布，无 legacy 兼容分支）。
3. **恢复**：run 恢复/重启从会话 transcript 加载本 run 执行段；恢复幂等；加载失败保留旧状态、不伪造成功。
4. **旧存储迁移**：run 级私有 transcript 列随历史迁移退役（未发布原则：不迁移数据、不留加列→删列往返）；旧 `:session_transcript` 材料类型与旧装配链的退役属阶段 6，本阶段不动。
5. **测试与回归**：确定性机制测试（跨 run 追加、前缀校验、恢复幂等、身份/错绑、未知版本、空会话、并发 run 追加顺序）+ 现有全量门禁与既有确定性/页面批次回归（阶段 1 不改变行为，现有证据应保持）。

**非目标（由后续阶段承接，不在阶段 1 冒充）**：

- 每轮请求由会话历史派生（阶段 2）；
- 压缩作用域/触发改为会话历史（阶段 3）；
- 作者可见细条/回查/审计以会话为对象的投影调整（阶段 3–4）；
- 三类 Provider 投影一致性复核（阶段 4，契约族不变）；
- 旧 `:session_transcript` 材料与旧装配链退役（阶段 6）；
- 不改 provider 投影、工具目录、采纳门、作者安全边界、UI 行为。

## 3. 契约与不变量

- **Contract**：ADR-0035 决策 1/2/9；VS-00L §16.1/§16.6/§16.8/§16.12 落地说明（2026-11-08）；ADR-0033 §11 作用域落地边界（原则不变）。
- **Invariant**：
  1. canonical 消息**永久追加、不删改**；会话 transcript 的既有前缀不可变（新写入必须校验旧消息完整前缀与不可变身份）。
  2. 作者原话/artifact 字节保持（ADR-0033 既有不变量不变）。
  3. 恢复幂等：同一会话历史重复合并/恢复不产生重复消息或顺序漂移。
  4. 未知/损坏版本诚实拒绝，不猜测、不静默降级。
  5. 每条消息可追溯到真实 `run_id`；run 身份（work/session/workspace/parent turn）不可错绑。
  6. 阶段 1 不改变每轮请求投影 → 现有 I1/I2/I3/N-NARR 不变量与页面证据不得退步。
  7. 事务原子：run 状态、step、event、会话段头、消息、durable checkpoint 同生共死；广播只在提交后。

## 4. 边界

- 修改：`novel_application`（`AuthoringCheckpoint`、`AgentRunPersistence`、`AgentRunService` 恢复路径、`AuthoringReplay`、`AuthoringTranscript.checkpoint_version/0`）、`novel_persistence`（新增 `AuthoringSessionLog` + 两个 schema + 迁移；`AgentRunLog`、`AuthoringRunRecord`、`AuthorQuestionRepo`）。
- 不改：`novel_common`（Request IR/Compaction 契约族；阶段 2 若需纯契约另行裁决，见 §9）、`novel_agent`（provider 投影/能力事实）、`novel_web`（Channel/TurnResult 投影）、前端、`novel_telemetry`、内存 flow 边界（`AgentRunFlows.AuthoringSession` 的 stage_state 契约与 error3 形状不变）。
- 迁移只按未发布原则：删除/替换旧列，不做历史兼容；只读历史证据保留在 `artifacts/`。

## 5. 消费者

- **阶段 1 真实消费者**：run 恢复/重启（`AgentRunService.recover_durable` → `AuthoringCheckpoint.restore/2`）与历史回查（`AuthoringReplay`/`TraceReplayService`）从会话存储读本 run 执行段；`AgentRunLog.commit_snapshot` 是唯一写入入口。不是"只建表/未来模块"。
- **阶段 2 第一消费者**：每轮 Provider 请求由会话 transcript 派生的判断/执行边界；
- **阶段 4 第二消费者**：审计/回查（Why/Replay）以"会话 canonical + run 引用"为对象；
- 阶段 1 自身无用户可见行为变化，消费者是内核边界而非 UI。

## 6. 证明与验收驱动

**Proof（阶段 1，CP1 已执行）**：

- 确定性机制测试：跨 run 追加顺序/前缀不可变/身份错绑拒绝/恢复幂等/未知版本拒绝/空会话/并发追加（`apps/novel_persistence/test/novel_persistence/authoring_session_log_test.exs`、`agent_run_authoring_transcript_test.exs`）；恢复/回查/隐私/压缩边界见 `authoring_checkpoint_test.exs`、`agent_run_runtime_test.exs`、`agent_run_result_commit_test.exs`、`agent_run_history_binding_test.exs`、`trace_replay_service_test.exs`、`auto_maintenance_test.exs`。
- 全量门禁：`mix compile --warnings-as-errors`（dev/test）、全量 `mix test`、`mix check`、`credo --strict`、`format`、`xref`、`arch_check`、`adr_trace`、模块规模、静态扫描（`bash scripts/ai_static_scan.sh --top 10`）。
- 不变量：I1/I2/I3、N-NARR、I-CACHE；既有确定性/真实页面批次回归（行为不变）。
- 阶段 1 **不**签署跨轮连续性/压缩/G6；真实页面多轮会话证据在阶段 2/3 后作为集成验收。

**行为不变判据（CP1）**：同一内存 transcript 经会话存储写入→恢复后，① 消息序列逐条相等（canonical key 归一化后）；② `run/system/tools/projection/base_refs/observation_refs/used_refs/call_ids` 与写入前相等；③ 三类 wire 投影（chat_completions / anthropic_messages / responses_api）JSON 逐字节相等；④ TurnResult/Interaction/事件投影不变；⑤ 全量测试与既有页面批次回归保持。DB schema 从「run 列」变为「会话两表」是唯一允许差异。

**Acceptance Driver**：阶段 1 为事实层改造，无用户可见入口变化；页面级验收由阶段 2 的真实 Tauri 多轮会话批次承担（外部自动化像用户一样多轮操作，不构造异常路径）。**产品代码不得新增验收感知逻辑**。

**Exploration**：不适用——本阶段是事实存储与恢复边界，不涉及模型作品知识获取/探索面同步；说明理由即可。

## 7. 阶段划分（ADR-0035 落地，CP1–CP6 登记）

CP 是可独立排期与验收的 checkpoint；状态统一在本任务维护（不拆独立任务文档，避免碎片与双状态源）。

| CP | 状态 | 范围/交付 | 验收 | 依赖 | 预计写域 |
|---|---|---|---|---|---|
| CP1 | done（2026-11-08 实现+测试+全量门禁） | 会话级 canonical 历史：存储/身份/追加/前缀校验/恢复幂等/旧 run 级列退役 | 确定性机制测试 + 全量门禁 + 既有批次回归（行为不变） | ADR-0035 已批准 | `apps/novel_application`（AuthoringCheckpoint/AgentRunPersistence/AgentRunService/AuthoringReplay）、`apps/novel_persistence`（AuthoringSessionLog/schema/migration/AgentRunLog） |
| CP2 | todo | 每轮请求由会话派生（完整历史；窗口压力时 checkpoint 投影替代更早历史） | 真实页面多轮会话：跨轮上下文/指代/义务 + 请求证据；机制层判据：第 N 轮请求含第 N-1 轮作者原话字节与前序 observation refs | CP1 | `apps/novel_application`（JudgmentProtocol/AgentRunServer）；可能新增 `novel_common` 纯契约（需裁决） |
| CP3 | todo | 压缩作用域=会话历史、触发/细条/回查调整 | G6 压缩后真实请求（真实多轮自然触发）+ 失败静默/幂等 | CP2 | `apps/novel_application`（TranscriptCompaction/AgentRunServer/ContextPressure，跨 run usage 累计）、`frontend/src`（仅在细条/回查需适配时） |
| CP4 | todo | 三类投影/恢复幂等 + 审计/回查以会话为对象（窄化为"投影输入来源变化后的等价性验证"） | 投影/幂等/回查机制证据 | CP2、CP3 | `apps/novel_agent`（投影校验）、`apps/novel_application`（Replay）、`scripts/arch_check.exs`（边界规则细化） |
| CP5 | todo（建议拆 CP5a/CP5b，见 §9） | 真实页面多轮会话综合验收 + G6 取证（承接 B71 G6） | 页面/机制/实模分层报告（实模不代签）；窗口不可用时按 known-gap 登记规则如实关闭 | CP2–CP4 | `scripts/`（验收 harness）、`artifacts/`（证据，只读保留） |
| CP6 | todo | 旧 `:session_transcript`/旧装配链/旧 run 级语义退役清理 | 删除后全量门禁 + 无消费者核对 | CP5 | `apps/novel_application`（ContextAssembler/DialoguePlanningService 旧路径）、`apps/novel_persistence`（旧列删除）、测试清理 |

### 7.1 相关任务与承接关系（登记全）

| 任务 | 关系 | 当前状态/依赖 |
|---|---|---|
| [B71](B71-provider-message-fidelity.md) | 上游契约与历史证据；**G6 取证移交 B81 CP5**；B71 CP5 收口依赖 G 切片/实模凭证 | CP5 仍 doing |
| [B82](B82-b71-golden-slice-evidence.md) | G2/G3/G5 与 Responses/Anthropic 实模补证；与 B81 互补不重复（G6 不在 B82） | todo，待窗口/凭证 |
| [B83](B83-vendor-stream-options-matrix.md) | `stream_options.include_usage` 矩阵；与 CP2/CP4 的 usage/能力事实相关但不阻塞 | blocked（凭证） |
| [B84](B84-web-slow-tests-and-arch-debt.md) | web 慢测试/测试债务；与 B81 并行，写域在测试前置层 | todo |
| [B78](B78-module-size-debt.md) | 大模块拆分；CP1 未改 `agent_run_server.ex`（内存流程不变），同文件冲突降低 | 待 B71 收口 |
| [B80](B80-system-capability-cleanup.md) | 能力图谱/清理（done）；B81 实现后按 00f §6 维护规则同步 | done |
| [B79](B79-work-import-and-analysis.md) | 并行独立功能；与 B81 无同文件冲突 | 待启动 |
| [bidirectional-gaps-optimization](bidirectional-gaps-optimization.md) | 双向沟通历史计划；E2 已重构 | 见原计划 |

### 7.2 排期与写域协调

- CP1 已完成；CP2 依赖 CP1；CP3/CP4 依赖 CP2；CP5/CP6 依赖前序。
- 与 B78 的同文件冲突：CP1 未改 `agent_run_server.ex`（只改持久化/恢复边界），冲突面显著小于原估；后续 CP2 会再次触碰该文件，仍需协调顺序。
- 与 B84 并行无冲突（测试前置层）；与 B82/B83 无写域冲突（验收/矩阵脚本与 artifacts）。

### 7.3 上下游、前置与后置任务（登记全）

| 关系 | 任务/资料 | 依赖性质与当前状态 |
|---|---|---|
| **上游（依据/输入）** | ADR-0035（Accepted，2026-11-08） | 决策依据；已完成，是开工前提 |
| 上游 | 产品级偏差诊断 `docs/design/notes/2026-11-08-session-level-product-deviation.md` | 问题依据（P0-1/P0-2/P1-1）；只读输入 |
| 上游 | VS-00L §16.1/§16.6/§16.8/§16.12/§16.16/§17/§18.8、ADR-0033（§11） | 契约依据（Frozen 判据不变）；已完成 |
| 上游 | [B71](B71-provider-message-fidelity.md) | 历史证据与 Request IR 契约族；G6 已移交 B81 CP5 |
| 上游 | [B80](B80-system-capability-cleanup.md) | 能力图谱/清理（done），提供实现态现状与 00f living 文档 |
| 上游 | 旧 schema/数据（`interactions`/`decision_traces`/`work_sessions`） | 设计资料与历史语义来源（不重建第二套语义，见 §8.0/§8.1 存在性审核） |
| **前置（开工/阶段条件）** | ADR-0035 已批准；门禁基线绿（2026-11-08 实测 2387+ tests 0 failures） | 已满足 |
| 前置 | 与 [B78](B78-module-size-debt.md) 的同文件顺序协调 | CP1 未触碰该文件；CP2 前需再裁决 |
| **后置（依赖 B81 产出）** | [B71](B71-provider-message-fidelity.md) CP5 最终收口 | 强依赖：CP5 需 B81 CP5（G6 取证）+ B82 证据 |
| 后置 | [B79](B79-work-import-and-analysis.md) | 条件依赖：如导入后需要跨轮会话续写，则依赖 CP2 |
| 后置（由 CP 覆盖，不单列任务） | 跨轮义务/D8 验证、会话级审计回查、旧 UI/装配链退役、细条/回查适配 | CP2/CP4/CP6/CP3 的验收项 |
| 无依赖 | [B83](B83-vendor-stream-options-matrix.md)、[B82](B82-b71-golden-slice-evidence.md)、[B84](B84-web-slow-tests-and-arch-debt.md) | 与 B81 无写域交集 |

### 7.4 契约/ADR 实现目标 → 任务映射（登记全）

> 目的：确认 ADR-0035、VS-00L、ADR-0033 的**实现目标**没有遗漏任务承接。已实现项标注证据；待产品裁决/低优先项显式登记为"未排期/待裁决"，不冒充已完成。

#### A. ADR-0035（Accepted，2026-11-08）

| 实现目标 | 承接任务 | 状态/说明 |
|---|---|---|
| 决策 1–2：session 为上下文主体、run 为执行段 | B81 CP1（事实源，**已实现**）+ CP2（请求派生） | CP1 done；CP2 todo |
| 决策 3：每轮请求由会话派生（窗口压力 checkpoint 投影） | B81 CP2 | todo |
| 决策 4–5：压缩作用域会话历史 + 压缩为上下文管理机制 | B81 CP3 | todo |
| 决策 6：事实材料经工具按需读取（不改） | 既有工具/探索链（B71 历史实现） | 已实现，无新任务 |
| 决策 7：保留 ADR-0033 契约族 | B81 CP1–CP4 的边界约束 | CP1 已遵守（契约族零改动） |
| 决策 8：审计/回查以会话为对象 | B81 CP4 | todo |
| 决策 9：旧语义处置（未发布不兼容） | B81 CP6（旧材料退役）；CP1 已退役 run 级私有列 | CP1 done；CP6 todo |
| 决策 10：不隐式压缩 | B81 CP3 验收约束 + VS-00L 既有契约 | 约束 |
| 迁移 6 阶段 | B81 CP1–CP6 | CP1 done，其余 todo |
| Contract 影响：VS-00L 落地说明修订 | 2026-11-08 已补 §16.1/§16.6/§16.12/§16.16/§17/§18.8 | done（§16.6/§16.12 为本轮复核补齐） |
| Umbrella 边界影响（application/persistence 等） | B81 CP1–CP6 写域 | CP1 done（见 §8.1） |
| UI/Trace/Replay 影响 | B81 CP3/CP4 | todo |
| 垂直切面证明（机制/页面/实模分层） | B81 CP5；G6 移交 CP5 | todo |
| enforcement_gaps：arch_check 边界规则 | B81 CP1（基础）/CP4（细化） | 评估结论：CP1 无需新增 arch_check 规则（新存储模块仅被 application 引用，现有依赖方向/编译期约束已覆盖）；CP4 再裁决是否需要"会话 canonical 唯一入口"的正向 allowlist |
| 旧 `:session_transcript` 退役范围核对 | B81 CP6 | todo |

#### B. VS-00L（Frozen；ADR-0035 落地说明修订后）

| 未实现/未验目标（§17/§16.x） | 承接任务 | 状态/说明 |
|---|---|---|
| §16.6 独立计划/使命的同一会话边界（会话级落地） | B81 CP2 | 落地说明已补；实现 todo |
| §16.8 canonical 存储身份/前缀/事务提交（会话级落地） | B81 CP1 | **已实现**（`AuthoringSessionLog` 唯一存储边界 + `AgentRunLog.commit_snapshot` 单一事务） |
| §16.12 transcript 持久化身份/恢复（会话级落地） | B81 CP1 | **已实现**（段头+消息存储/恢复；run 级列退役） |
| 压缩自动维护 AX（§16.16，A3 未闭环） | B81 CP3（作用域/触发）+ CP5（真实多轮页面取证） | todo |
| G6 压缩后真实请求 | B81 CP5 | todo；不再构造单 run/异常路径 |
| 会话级 canonical 上下文（ADR-0035） | B81 CP1–CP6 | CP1 done |
| 真实 Responses/Anthropic 实模（含相邻 role 服务端合并、cache 行为） | B82 | todo（需官方凭证） |
| R1 剩余：真实 route/原生 body 回归 | B82（真实输入补证） | 部分机制证据已在 B71 |
| I-CACHE 独立输入/多投影（真实生产输入） | B82（真实输入）+ B81 CP4（投影一致性） | 机制/CI 已有 |
| CP5 最终收口 | B71 CP5（依赖 B81 CP5 + B82） | doing；B71 保留状态真源 |
| 显式压缩的**作者可见前端入口**（§16.17 设计缺口） | **无实现任务；待作者产品设计授权** | 显式登记为未授权/待裁决 |
| 作者可见 displayName 未闭环低优先 | 无独立任务；低优先待排期 | 显式登记 |
| DecisionTrace 有限模式事件层（暂缓） | 无独立任务；随未来事件语义任务 | 显式登记（暂缓） |
| 有限模式持久事实（2026-11-06 裁决 D） | 已实现（B71 历史） | 无新任务 |

#### C. ADR-0033（Accepted；§11 作用域落地边界）

| 实现目标/未闭环项 | 承接任务 | 状态/说明 |
|---|---|---|
| 决策 1–7 原则（唯一事实源/原生多轮/最小 Base/作者主权/投影/显式压缩/回放） | 已实现（B71 历史）；作用域按 ADR-0035 落地 | CP1 已落地作用域；CP2–CP6 承接其余 |
| §11 作用域落地边界 | B81 CP1–CP6 | CP1 done |
| CP3b 实模协议层 | 历史 e79032cd PASS；完整 CP4b-2 实模行为/缓存/usage → B82 | 已实现（协议层）；实模行为待 B82 |
| G6 压缩后真实请求 | B81 CP5 | todo |
| CP5 最终收口 | B71 CP5 | doing |
| 压缩前端设计授权（状态行未闭环项） | **无实现任务；待作者设计授权** | 与 VS-00L §16.17 同一项 |
| G7/G8（动态 scope/恢复后） | 已实现（B71 CP3c done 2026-11-01） | 无新任务 |

## 8. 阶段 1：设计与实施（CP1）

### 8.0 彻底重构 + 复用设计资料与实现（原则）

本任务按 ADR-0035 做**作用域级重构**（run → session），不是抛弃重写：能复用的设计语义与实现边界全部复用，只替换"事实源层级与存储/派生边界"。

**复用设计资料**：

- `01-user-llm-workbench-interaction-model.md` §3.3 会话结构合同组合（语义参照：每 turn 结构 = 作者意图/写作坐标/材料与省略/观察证据/权限/输出类型）；
- VS-00L §16.1/§16.2/§16.6/§16.8/§16.12/第 100/222 行（canonical 不删改、作者原话与 artifact 字节、显式 checkpoint、长会话压缩）；
- ADR-0033 Request IR 契约族与三类投影（不变）；
- 旧 `interactions`/`decision_traces` 的历史语义（跨轮原文关联、turn 决策轨迹、回放定位）作为"会话历史内容"的语义来源，不重建第二套语义；
- UI 46/47 细条/文案与作者安全要求（阶段 3 复用）。

**复用实现（不重写）**：

- `AuthoringTranscript`：消息/工具调用/观察/校验/候选/checkpoint 的结构与合并逻辑（CP1 只新增 `checkpoint_version/0` 公开结构 codec 版本）；
- `AuthoringCheckpoint`：身份/版本/可回读校验边界（CP1 改造为会话段读写边界，语义复用、实现收敛为一份）；
- `TranscriptCompaction` 的 `covers/source_refs/versions/omissions/summary` 派生与幂等（CP1 不改）；
- `AgentRunPersistence` 的 durable checkpoint 提交/恢复语义（CP1 只改 canonical 落点）；
- Request IR 三类投影与能力事实派生（不变）；
- `AgentRunHistory`/`WorkSessionRepo`/`Interactions`/`DecisionTrace` 的读取与定位边界（会话历史语义来源）；
- 既有确定性测试/验收基线（阶段 1 行为不变，全部回归复用）。

**替换/新增**：

- 新增会话级 canonical transcript 的存储、身份、追加/恢复读端口（承接旧历史语义，canonical 形态）；
- 改造 `new_transcript`/`AgentRunServer` 合并路径为"会话追加"（run 仍为执行段；CP2 才改请求派生）；
- 压缩作用域改为会话历史（阶段 3）；
- 旧 run 级私有 transcript 列在迁移后退役（不做历史兼容）。

**退役（阶段 6）**：旧 `:session_transcript` 材料类型与旧装配链（`ContextAssembler`/`DialoguePlanningService` 旧路径）、未被复用的旧摘要路径；退役前逐项核对消费者。

**旧表处置基线**：`work_sessions` 保留为会话身份容器（不新建第二套 session 语义；CP1 未改其结构）；`interactions` 保留为展示/回放；`decision_traces` 保留为 turn 轨迹/审计；新增会话 canonical 存储（两表，见 §8.1）。

### 8.1 CP1 实施设计（2026-11-08 落地，已实现）

> 本节是开工前复核（2026-11-08 两位只读审计 + Lead 架构裁决）后的落地设计；实现与本文一致，代码为最终事实源。

#### 8.1.1 红线：新建实体存在性审核（逐项）

| 拟引入 | 项目中已存在 | 结论 |
|---|---|---|
| 会话身份容器 | `work_sessions`（WorkSession schema / WorkSessionRepo / WorkSessionService）；run 的 `session_id` 即其 id | **复用**；不新建 session 身份、不改 work_sessions 结构 |
| 会话级 canonical 存储 | 无等价物。`interactions`（展示/retention，content 是 TurnResult 形状）、`decision_traces`（turn 决策轨迹）、`agent_runs.authoring_transcript`（run 级 canonical）、`long_run_tasks.checkpoint_data`（只存引用） | **新增 2 张表**（消息行 + run 段头行），挂既有 session 身份；不硬套 interactions（会造第二套语义，违 ADR-0035 §7） |
| canonical 消息结构 | `NovelCommon.RequestIR` message/block；`AuthoringTranscript` 组装器 | **复用** |
| 会话/run 读写边界 | `AuthoringCheckpoint`（原 run 私有 checkpoint 读写边界）、`AgentRunPersistence`（提交投影）、`AgentRunLog.commit_snapshot`（唯一事务边界） | **改造现有模块**，不新建第二个边界模块 |
| 身份/前缀/版本/可回读校验 | `AuthoringCheckpoint.validate_identity`（application）与 `AgentRunRecord.changeset`（persistence）曾是两套并行实现 | **收敛为唯一实现**：application `AuthoringCheckpoint` 负责语义校验，persistence `AuthoringSessionLog` 负责存储壳/身份/前缀，旧两套重复实现随列删除退场 |
| JSON 归一化 | `AgentRunPersistence.json_safe`、`AuthoringCheckpoint.json_roundtrip` | **复用**（真实落库形状 = Jason encode/decode 后） |
| 会话历史读取/定位 | `AgentRunHistory`、`WorkSessionRepo`、`WorkSessionService` | **复用**；新增 `AuthoringSessionLog.fetch_run_segment/1` 作为 run 执行段端口 |
| 迁移/schema 演进 | 39 个迁移、SQLite、未发布无兼容原则 | **复用**既有迁移风格；按未发布原则删除历史加列迁移，避免"先加后删"往返 |
| 并发/顺序控制 | 无既有乐观锁；SQLite 单写者 + busy_timeout | 新增 DB UNIQUE + `mode: :immediate` 事务串行化（不引入新锁框架） |
| 压缩/检查点 | `TranscriptCompaction`、`CompactionRecord`、`RequestIR.Compaction` | CP1 **不改压缩语义**，只改持久化落点 |
| 恢复幂等 | `AgentRunService.recover_*`、`AuthoringCheckpoint.restore` | **改造**，不新建恢复框架 |

#### 8.1.2 数据模型（新增 2 表；work_sessions 不变）

`authoring_session_messages`（会话 canonical 消息流，append-only）：

- `id` binary_id PK；`workspace_id`/`work_id`/`session_id`/`run_id` string（身份三元组 + 执行段归因）
- `sequence` 会话内全局序号（从 1）；`run_sequence` run 内序号（从 1）
- `role` 冗余列；`message` JSON（RequestIR 消息真实落库形状）；`format_version` = `authoring-session-message/v1`
- UNIQUE(`session_id`, `sequence`)、UNIQUE(`run_id`, `run_sequence`)；索引(`session_id`)、(`workspace_id`,`work_id`)

`authoring_run_segments`（run 执行段头；不存消息）：

- `run_id` string PK；`workspace_id`/`work_id`/`session_id`/`parent_turn_ref`（五元组身份列）
- `header` JSON：`version`（`authoring-run-segment/v1`）+ `run`/`system`/`tools`/`projection`/`base_refs`/`observation_refs`/`used_refs`/`call_ids`（与旧 run 级 checkpoint 的 9 键结构对齐）
- `message_count`、`first_sequence`、`last_sequence`、`format_version`

身份策略：会话身份复用 `work_sessions`，但存储层**不建 FK**——与既有 `agent_runs.session_id`（string、无 FK）保持一致，避免测试/直调路径（`session_#{turn_id}` 兜底）被强约束打断；身份完整性由 `(workspace_id, work_id, session_id)` 三元组 + 段头/消息归因校验保证。

#### 8.1.3 写入语义（唯一事务边界 `AgentRunLog.commit_snapshot/2`）

- `AgentRunPersistence.snapshot/4` 增加 `authoring_segment`：由 `AuthoringCheckpoint.encode_segment_for_write/2` 产出（JSON 真实形状 + 完整 IR 可回读 + 不可变身份校验）；transcript 为 nil 时为 nil。
- `AgentRunLog.commit_snapshot/2` 事务顺序：upsert run → `AuthoringSessionLog.append_run/2`（会话消息/段头）→ 校验 steps/events 关联 → 写 steps/events → 写 durable checkpoint（校验段引用）→ 返回；任一失败回滚全部。
- `append_run/2` 算法：读该 run 已存消息 → 校验已存是新列表前缀（更短=回退拒绝、内容不同=前缀冲突）→ 追加新消息（`run_sequence` 接续、`sequence` 取会话 max+1）→ upsert 段头（身份不可改写）。幂等：同列表重复提交不产生新行。
- 并发：`commit_snapshot` 以 `mode: :immediate` 开启 SQLite 事务（单写者串行）；DB 唯一索引保证顺序无空洞、无重复。嵌套在调用方事务内时由调用方事务模式决定。
- 作者问题交付/回答两条直接调用 `AgentRunLog.commit_snapshot` 的路径（`AuthorQuestionRepo`）已透传 `authoring_segment`，不丢会话追加。

#### 8.1.4 读取/恢复语义（`AuthoringCheckpoint` 改造）

- `restore(record, checkpoint_data)`：读本 run 段头+消息 → 组装 transcript（9 键）→ `AuthoringTranscript.restore` 结构/IR 校验 → 五元组身份校验 → `{:ok, transcript, :session_segment}`；无段 → `{:ok, nil, :none}`。
- 读取端与写入端对称校验：`AuthoringSessionLog.fetch_run_segment/1` 先校验段头 `version` 与 9 键 shape（未知版本 `:authoring_segment_version_unsupported`、损坏形状 `:authoring_segment_shape_invalid`），再校验消息数量一致；损坏段头不会静默降级成空 refs 或缺键结构（2026-11-08 二审发现并修复，负例见 `authoring_checkpoint_test.exs`）。
- durable checkpoint：`agent_run.authoring_segment_ref` = `%{"run_id", "version" => "authoring-run-segment/v1"}`；引用缺失/错绑/版本错、段存在而引用缺失 → fail-closed（不回退旧内嵌副本）；`checkpoint_version`（durable header 版本）保持 3。有会话段时 task checkpoint 缺版本不阻断（段是唯一 canonical 真源，task 只核对引用），该组合由测试锁定。
- 失败语义与旧实现一致：恢复失败只报告 `authoring_history.status`/`authoring_transcript_error`，不重建 stage_state、不伪造成功。
- 写入边界：`encode_segment_for_write/2` + `validate_segment/2` 取代旧 `encode_for_write/2` + `validate_for_write/2`；不可 JSON 表示的值返回 error 且不泄漏内容。

#### 8.1.5 迁移与退役

- 新增 `20261108000001_create_authoring_session_canonical.exs`（两表 + 索引）。
- 旧 `20261102000001_add_authoring_transcript_to_agent_runs.exs` 按未发布原则**删除**（仓库不再有"先加列再删列"的迁移往返）；`agent_runs` 从建表起就没有该列。本地 dev 库若已应用旧迁移，残留列不再被 schema 映射，无害；`mix ecto.reset` 后彻底一致。
- `AgentRunRecord` 删除 `authoring_transcript` 字段与四类旧校验（规范/身份/前缀/拒绝清空 → 语义收敛到 `AuthoringSessionLog`）。
- `AgentRunPersistence` 删除 run 私有 checkpoint 编码；`AuthoringReplay` 改为会话段回查（错误面字符串 `"authoring_transcript"` 保留，API 面不变）。

#### 8.1.6 CP1 测试与验证结果（2026-11-08）

- 新增/改造测试：`authoring_session_log_test.exs`（跨 run 顺序/并发/幂等/未知版本/空会话/前缀/身份/段一致性/事务原子）；`agent_run_authoring_transcript_test.exs`（会话级前缀、身份、事务原子、段引用 fail-closed）；`authoring_checkpoint_test.exs`（段读写/S1 三投影端到端/不可 JSON 拒绝）；`agent_run_runtime_test.exs`（恢复/压缩/隐私/失败保留/会话存储回查）；`agent_run_result_commit_test.exs`（提交原子/回滚/隐私）；`auto_maintenance_test.exs`、`agent_run_compaction_event_test.exs`、`agent_run_history_binding_test.exs`、`trace_replay_service_test.exs`、`history_read_boundary_test.exs`、两个 flow 测试、web 两个 channel 测试。
- 验证（2026-11-08 最终树）：`MIX_ENV=test mix check` EXIT=0（全量 `compile --warnings-as-errors --force`、codegen enums/author_visible、enum lint、xref 无环、全量测试 **3110 tests / 0 failures**、arch_check、adr_trace 32/32、I-CACHE）；`mix credo --strict` no issues；`mix format --check-formatted` 通过；`node scripts/check_module_size.mjs --check` 通过；`bash scripts/ai_static_scan.sh --top 10` 20 passed / 1 failed（唯一 fail 为既有 gitleaks 6 项处置，touched files 0 findings）；I1/I2/I3/N-NARR 与 I-CACHE 全 PASS（静态扫描内嵌运行）。
- 实现中由并行只读审计发现并修复的缺陷：迁移主键类型（messages.id）、段表复合主键、段行身份映射、`call_ids` 缺失导致段读写全失败、读取端段头 version/shape 未校验（写入/读取不对称）；均已回归（含读取端 fail-closed 负例 3 例）。
- 门禁脚本缺陷修复：`scripts/task_done_check.mjs` 的 UI 证据判定把测试文件（路径含 workspace/ui/copy 等关键词）误判为 UI 变更，迫使无关后端 slice 需要 Tauri 页面证据或阻塞收口——修复为「测试文件不产生 UI 证据需求」（排除 `_test.exs`、`/test/`、`.test.*`），并生成 task-done manifest 验证通过；该修复单独提交（`fix(gate)`）。
- **页面回归证据（2026-11-09 补验，CP1 收口缺口修复）**：`bash scripts/native_b71_batch.sh cp1-regression-02` **PASS 19/19**（真实 Tauri 原生窗口 + AX 外部驱动，`git_head=9242751e`；证据 `artifacts/slice-verify/b71-first-consumer-tauri-native-cp1-regression-02/summary.json`，含 `request_messages_keep_strict_prefix`、`every_observation_links_original_tool_call`、`native_call_*` 等全判据）。**首轮 native 批次 FAIL 的真实原因**：B71 证据工具链仍在读 CP1 已退役的 run 级私有列（`authoring_history: 私有 transcript 缺失`）——**CP1 删列的消费者清单遗漏了 `scripts/lib/native_ui/*` 验收证据读取器**（上轮只核对了 `apps/` 与 `docs/` 生产者/消费者）。已修复：证据读取改为会话级执行段（`authoring_run_segments` 段头 + `authoring_session_messages` 消息行 + `authoring_segment_ref`），自动维护证据与 driver 同步；脚本测试夹具全部适配并复跑绿（history 26/26、auto-maintenance 11/11、native_b71 35/35、pending 32/32）。
- **第二页面批次（2026-11-09，环境失败不代签）**：`B71_SLICE=b71-authoring-transcript bash scripts/native_b71_batch.sh cp1-regression-03` 失败于 native 窗口激活（`OwnershipError: activation_unconfirmed`、`could not create image from window`、`driver_idle_timeout`）——**driver 未开始业务驱动**，属 macOS 窗口/屏幕环境限制而非产品回归；该 journey 页面证据未取得，如实登记不代签。first-consumer native 19/19 仍为 CP1 正式页面证据。
- **旧语义残留审计（2026-11-09 全仓）**：`scripts/` 生产代码与脚本测试夹具已无 `agent_runs.authoring_transcript` 读取（`authoring_run_evidence.test.mjs` 夹具同步适配后，`scripts/lib/native_ui/*.test.mjs` **31 文件 619 tests 全绿**）；`target/` 下命中为 gitignore 的构建产物旧副本，`tasks/`/`docs/` 中的旧列描述为历史记录，均非运行时代码。此审计补上 §9 登记的「全仓核对」漏项。
- **browser driver 既有漂移（与 CP1 无关，已修）**：`frontend/slice-verify/external-ui-driver.mjs` 的 `chapterFullReadAuthorFeedback` 仍按 `section[aria-label="推理"]` 读取作者可见叙事，而该 landmark 已在 46 §9.5 移除以避免读屏重复区域（`WorkspaceChat.tsx:919`）→ 页面实际渲染正确但 driver 断言失败。已改用当前 UI 契约 `[aria-label="本轮创作过程"]` + `p[data-tone="explore"]`（区域缺失时空结果让断言诚实失败，不退回 body 以免误判 developer 面）。browser 批次复验本轮受 macOS `ERR_NETWORK_IO_SUSPENDED` 环境错误影响，正式页面证据以 native PASS 为准。
- 模块规模：新增测试文件均低于 test outlier_floor（800）；`agent_run_runtime_test.exs` 因 CP1 断言迁移增长超过 ratchet 允许增量，把会话 canonical 读取/播种 helper 提取到 `test_helper.exs` 的 `TestAgenticLoopFixtures`（同时消除 5 个测试文件的重复 helper），行数回落到上限内，未做机械压缩。

### 8.2 行为不变判据（CP1 冻结）

见 §6「行为不变判据（CP1）」；判定面 = 请求 IR/三 wire 投影/TurnResult/Interaction/事件 + 全量测试；DB schema 变化为唯一允许差异。

### 8.3 软件工程原则审计（2026-11-08，SOLID / DRY / KISS / YAGNI / SoC）

> 目的：把「实现符合软件设计基本原则」作为可复核结论，而非口号。审计对象=CP1 新增/改造的
> application 与 persistence 边界；每行给出对照与验证方式。

| 原则 | CP1 对照 | 结论/证据 |
|---|---|---|
| SRP 单一职责 | `AuthoringSessionLog`=会话 canonical 存储边界（写入/读取/校验同属一个变化原因：存储契约）；`AuthoringCheckpoint`=application 读写边界（编码/恢复/段引用）；`AgentRunPersistence`=提交投影；`AgentRunLog`=唯一事务编排。职责边界与写域见 §8.1.3/§8.1.4 | 满足；模块均 <500 行（存储 440 / 边界 270） |
| OCP 开闭 | 段头 data 键契约单一来源：`AuthoringSessionLog.header_data_keys/0`；application 构造/解析段头只消费该契约，新增 data 键只改持久层契约；`AuthoringTranscript` 结构与段头契约不一致时 `:authoring_segment_key_contract_mismatch` fail-closed（不静默丢键） | 满足；键漂移有机械防护 |
| LSP 里氏替换 | `restore/2` 统一返回 `{:ok, transcript \| nil, :session_segment \| :none} \| {:partial, reason} \| {:error, reason}`，有段/无段形状一致；`append_run/2` 的 nil 与 segment 分支同语义（nil=无历史，不写行） | 满足；旧调用方（AgentRunService/AuthoringReplay）不改契约即可工作 |
| ISP 接口隔离 | 公开 API 均单一目的且各有消费者：`append_run/2`（AgentRunLog）、`fetch_run_segment/1`（AuthoringCheckpoint）、`segment_present?/1`（AgentRunLog）、`segment_format_version/0`、`header_data_keys/0`（AuthoringCheckpoint）；`AuthoringCheckpoint` 的 encode/validate/restore/ref 各有消费者。**删除无消费者 `message_format_version/0`** | 满足；无「为未来预留」的空接口 |
| DIP 依赖倒置 | 方向由 umbrella 编译期强制（application → persistence）；存储细节（Repo/Ecto/JSON 形状/事务模式）封装在 persistence，application 只消费契约函数；未引入 behaviour（项目一致风格，避免 YAGNI 反向过度抽象） | 满足；`mix compile` 与 arch_check 强制方向 |
| LoD 迪米特法则 | application 不直接触碰 Repo/schema；run 读取只经 `fetch_run_segment/1`；身份校验只比较五元组，不深入存储行内部；record 在 restore/en/validate 入口 normalize 一次后传递，避免重复递归转换 | 满足；本轮收敛了重复 normalize |
| CRP 合成复用 | 无继承；用组合：`AgentRunLog` 组合 `AuthoringSessionLog`，`AgentRunPersistence` 组合 `AuthoringCheckpoint`，`AgentRunServer` 组合内存 `AuthoringSession` | 满足 |
| DRY | 身份/前缀/版本校验语义收敛为**唯一实现**（旧 application/persistence 两套并行校验随列退役）；段头键单一来源；测试 helper 提取到 `test_helper.exs` 共享 fixtures（消除 5 文件重复）；`run_id`/`ref` 重复取值收敛 | 满足；残留重复仅为「跨层防御性校验」（application 语义 vs persistence 存储壳），属有意纵深 |
| KISS | 不引入新锁框架/FK/额外抽象层；段头只存执行段配置与 refs、不复制消息；同义分支合并；存储追加算法为 5 步顺序校验 | 满足 |
| YAGNI | 删除无消费者 API；不预建 CP2 请求派生抽象；`fetch_session_messages/1` 的消费者是 CP1 机制测试且为 CP2 声明的读端口（B81 §2 范围内），moduledoc 已注明，不是「未来模块」 | 满足（有意保留项已登记理由） |
| SoC 关注点分离 | application（编排/语义校验）/persistence（存储/事务）/web（投影）分层不变；CP1 未触碰 UI/agent 投影/作者安全面 | 满足；`novel_web` 对持久层零直接依赖（arch_check 验证） |
| 抽象与封装 | 段头 JSON 形状与错误原子文档化；application 经契约函数访问存储；错误 fail-closed 且不泄漏内容（不可 JSON 表示值不泄漏 marker） | 满足；负例覆盖 |

> 审计中确认的**既有例外**（非 CP1 引入，不扩大范围）：`TurnExecutionService.canonical_transcript/1` 的「无 IR 时回退旧 `session.authoring_transcript`」路径保留（有测试锁定其安全语义：损坏 IR 不得冒充历史；生产无新写入者，CP2 重新评估）；`ActionIdempotencyService` 对 TurnResult 私有键的防御性 drop 保留。

### 8.4 CP2 开工设计（草案，未实现，待裁决）

> 状态：**设计草案，只读调研产出，未实现、未代签**。CP2 是 B81 的行为变化阶段（每轮请求由会话派生），
> 必须等 §7.1 前置裁决与开工确认；本文只把可裁决的方案与验收判据定清楚，避免实现中临时发明。
> 依据：ADR-0035 决策 3/5、VS-00L §16.1/§16.6 落地说明、§1.1 断链定位、当前代码事实（行号见下）。

#### 8.4.1 现状事实（2026-11-08 代码树）

- `JudgmentProtocol.transcript_for_production/2` → `new_transcript/4`：`input[:transcript]` 为 nil 时从
  `application_base` + 当前作者输入 + 当前 scope 重建；非 nil 时**直接复用**（随后 `refresh_transcript`
  追加 scope/tools、`append_author_turn` 幂等追加作者）。这条「既有 transcript 分支」是 CP2 的复用点。
- 生产调用链 `DialoguePlanningService.judgment_protocol_input/5` **不传 `:transcript`** → 每 run 重建、
  不继承会话历史（§1.1 断链根因）。
- CP1 已提供事实基础：`AuthoringSessionLog.fetch_session_messages/1`（跨 run 会话消息，按 sequence）、
  `fetch_run_segment/1`（本 run 段头+消息）、`AgentRunPersistence.snapshot/4` 的 `authoring_segment` 提交、
  `AuthoringCheckpoint.restore/2` 的 run 段恢复。
- 压缩/自动维护当前作用在 `stage_state.judgment_transcript`（run 内，`TranscriptCompaction.plan/plan_maintenance`）；
  触发由 `ContextPressure`（0.70/0.90）按当前 run token 估算。

#### 8.4.2 目标与非目标

- **目标**：同 session 的第 N 轮请求 = **会话 canonical 历史（跨 turn，含已完成交换）** + 当前 scope +
  当前作者输入 + 按工具目录按需取得的观察；正常完整历史进入请求，窗口压力时以显式 checkpoint 投影替代
  **更早的已完成交换**（保留最近 K 项；作者原话、当前 scope、未覆盖消息保持原序）。跨轮指代/承诺/
  observation refs 因此有会话事实可依。
- **非目标**：不改 Request IR 契约族/三类投影/能力事实；不改作者主权/采纳门/失败静默；不隐式压缩；
  不引入「每轮最小上下文」；不把展示流（interactions）当事实源。

#### 8.4.3 关键设计决策（含推荐与反例）

| # | 问题 | 推荐方案 | 反例/风险 |
|---|---|---|---|
| D1 | 请求如何由会话派生 | application 层新增「会话请求组装」步骤：`session_history = fetch_session_messages(session_id)` 消息序列 + 会话级 refs + 当前 run envelope/system/tools → 交给 `JudgmentProtocol` 的「既有 transcript 分支」追加当前 scope/作者（复用现有追加规则，不新造第二套组装器） | 反例：在 `RequestIR`/provider 层拼历史 → 破坏「IR 是唯一事实源、投影只是投影」分层 |
| D2 | run 段与会话历史的边界 | stage_state 仍只保存**本 run 执行段**（持久化按 run 归因）；请求派生前把「会话历史」合并成请求 transcript，提交时只差分本 run 新消息（CP1 append 语义不变） | 反例：把会话全量写回每 run 的 stage_state → 持久化重复、幂等与前缀校验失效 |
| D3 | 会话级 refs | `base_refs`/`observation_refs`/`used_refs` 跨 run 合并（会话级读取 + 本 run 增量）；I-ART-9 校验集合与请求同源 | 反例：只带本 run refs → 历史观察被模型引用时校验误杀；或无限膨胀不裁剪 → 需 CP3 投影 |
| D4 | 恢复语义 | 恢复 run 时加载「本 run 段」用于 stage_state，加载「会话历史」用于后续请求派生；两者同一入口（一个读端两个视图），不伪造 | 反例：恢复后只用本 run 段继续 → 恢复后的下一请求丢失跨轮历史 |
| D5 | 窗口压力/压缩触发 | `ContextPressure` 改成按**会话历史**估算（跨 run usage 累计/消息规模），越线时由 checkpoint 投影替代更早的已完成交换；保留最近 K 项与作者原话/当前 scope 原序 | 反例：继续按 run 内 transcript 估算 → 每轮历史全量进入后必然溢出窗口；或在派生阶段静默截断 → 违反「显式压缩」 |
| D6 | novel_common 边界 | **推荐不需要新增纯契约**：会话历史读取在 persistence、组装在 application、Request IR/Compaction 契约族不变；若实现中出现「会话派生规则」需要跨 app 复用，再按 ADR-0035 允许的方式新增纯契约并单独评审 | 反例：为「未来复用」提前造 `SessionContext` 纯契约 → YAGNI + 与 RequestIR 双轨 |
| D7 | 作者可见面 | 无 UI 变化：历史消息流已由 interactions/前端展示；请求内历史不进入作者可见面，不新增验收钩子 | 反例：为「让作者看到模型记得」新增 UI 状态 → 超出 CP2 范围 |
| D8 | 多 profile（judgment/continuation） | 会话历史跨 profile 共用；当前 run 的 system/tools 由当前 profile 派生并覆盖（不沿用历史 run 的 system），保持「新阶段追加该角色完整规则」 | 反例：直接复用历史 transcript 的 system → continuation 使用 judgment 的指令 |

#### 8.4.4 不变量与机械判据

1. **跨轮字节**：第 N 轮请求必须包含第 N-1 轮作者原话的逐字字节（含空白/全角），且顺序为
   「稳定 base → 历史消息（原序）→ 当前 scope → 当前作者输入」。
2. **前缀缓存**：稳定内容前置 + 历史追加；I-CACHE 前缀判定不得退化（复用现有 I-CACHE 门禁）。
3. **压缩投影**：只折叠 checkpoint `covers` 声明的已完成交换；未完成/未闭合交换、作者原话、当前 scope
   保持原序；同批幂等。
4. **作者主权**：请求仍无 adopt/canon_write；tentative-first 不变。
5. **失败语义**：会话历史读取失败/损坏 → 请求构造 fail-closed（不静默退化成「本轮无历史」）；恢复失败
   保留旧状态。
6. **行为变化边界**：CP2 改变模型可见请求（这是目标），但 TurnResult/作者可见文案/采纳门不变。

#### 8.4.5 预期改动清单（写域，待开工确认）

- `novel_application`：`JudgmentProtocol`（`new_transcript` 接受会话历史/按当前 run 覆盖 envelope）、
  `DialoguePlanningService`（生产调用传入会话历史）、`AgentRunService`（run 启动/恢复时加载会话历史）、
  `AuthoringSession`（内存边界扩展：本 run 段 + 会话历史视图）、`ContextPressure`（会话级压力估算）。
- `novel_persistence`：无新表；复用 `AuthoringSessionLog` 读端口（若需批量跨 run 段头/refs 聚合，评估新增只读查询）。
- 测试：机制层（跨轮请求字节、refs、投影、恢复、失败语义）+ 既有 I1/I2/I3/N-NARR/I-CACHE 回归。
- 页面层：真实 Tauri 多轮会话（外部自动化像用户一样多轮操作；不构造异常路径）。

#### 8.4.6 待裁决问题（开工前）

1. **D6 novel_common 边界**：确认「CP2 不新增 novel_common 纯契约」是否被接受（推荐接受）。
2. **与 B78 顺序**：CP2 将再触碰 `agent_run_server.ex`/`judgment_protocol.ex`；建议先 CP2 再 B78 拆分（避免拆分后二次改动），需作者裁决。
3. **D8 多 profile 覆盖**：当前 run 的 system/tools 覆盖历史 run 的 system/tools 是否可接受（推荐接受，符合「新阶段追加角色完整规则」）。
4. **恢复历史策略**：D4 的「本 run 段用于 stage_state + 会话历史用于请求派生」是否作为 CP2 冻结语义。
5. **压缩阈值**：会话级 ContextPressure 阈值是否沿用 0.70/0.90（推荐沿用，CP3 再调触发与细条）。

> 本设计不缩小 CP2 验收范围：机制/页面/实模分层、G6 归 CP5、实模不代签的边界保持 §6 不变。

## 9. 剩余后果与阻塞

- 阶段 1 完成不解除跨轮连续性/压缩/G6 的验收缺口；这些由阶段 2/3 承接，未实现前**不代签**。
- **CP2 需要裁决**：若"每轮请求由会话派生"需要 `novel_common` 新增纯契约（会话派生上下文），是否允许突破 §4「CP1 不改 novel_common」边界（ADR-0035 允许新增纯契约）。属 CP2 开工前裁决。
- **旧列消费者清单补遗（2026-11-09）**：CP1 删列时遗漏了 `scripts/` 下的验收证据工具链——`scripts/lib/native_ui/authoring_history_evidence.mjs`（B71 私有历史读取）、`scripts/lib/native_ui/authoring_auto_maintenance_evidence.mjs`、`scripts/native_b71_auto_maintenance_drive.mjs`，以及 `scripts/native_b71_test.mjs`/`scripts/native_b71_pending_test.mjs` 的 DB 夹具；已适配并全绿。**教训**：旧列消费者核对必须覆盖 `apps/`、`scripts/`、`frontend/slice-verify/`、`tests/`、`quality/` 全仓，而非只看生产代码。
- 页面回归证据已补（native 19/19 PASS，§8.1.6）；browser driver 路径修复后待环境允许时复验（非 CP1 行为阻塞）；第二个 journey 批次（b71-authoring-transcript）因窗口激活环境失败未取证，不代签。
- 旧 `:session_transcript` 材料在阶段 6 退役；CP1 不动。旧列消费者核对清单（CP6 前必须逐项走查）：`AuthoringCheckpoint`、`AgentRunPersistence`、`AgentRunService`、`AuthoringReplay`、`TraceReplayService`、`TurnExecutionService`（内存字段回退）、`ActionIdempotencyService`（TurnResult 私有键）、`ContextAssembler`/`DialoguePlanningService`（旧材料类型）、测试夹具/脚本。
- 真实页面多轮会话验收依赖阶段 2；实模证据另证（不代签）。
- **G6/CP5 遗留承诺**：B71 CP5 依赖 G6 取证，而 G6 需真实多轮自然触发压缩（受模型窗口影响）。建议 CP5 启动前拆为 CP5a（机制层 + 确定性页面多轮）与 CP5b（实模自然触发；窗口不可用时按 known-gap 如实登记），并明确 B71 收口不因 CP5b 永久悬挂；该拆分属 CP5 开工裁决，不在 CP1 代签。
- CP3 写域补 `context_pressure.ex`（跨 run usage 累计是压缩触发的会话级前提）。
- 可观测性：会话追加冲突/恢复失败当前以错误原子 + 既有 run 事件面暴露；若需 telemetry 事件面，在 CP4/后续裁决，CP1 不改 novel_telemetry。
- **并发 known-gap（CP1 显式登记）**：真实并发 run 事务在 Ecto SQL Sandbox（单连接、事务内测试）下无法构造；`authoring_session_log_test.exs` 的 N2 用确定性交错 + 唯一索引实证覆盖。并发正确性由 `(session_id, sequence)` / `(run_id, run_sequence)` 唯一索引 + `mode: :immediate` 事务串行化背书，真实并发压测不在单测范围。若后续需要真实并发证据，应在 CP4/CP5 的集成 harness（非 Sandbox）中补。

## 10. 决策与恢复指引

### 10.1 新会话开工交接（2026-11-08 作者决定另起会话执行）

- **入口顺序**：`tasks/NEXT.md`（当前任务=B81）→ 本文件 §7（CP 与依赖）→ §8（设计与实施）→ §9（剩余后果）→ ADR-0035 / VS-00L 落地说明（必要引用）→ B71 历史证据（只读）。
- **CP1 状态**：已实现并通过本地门禁（2026-11-08）；CP2 尚未开工，需作者/依赖链确认。
- **验证**：确定性机制测试 + 全量 `mix test` + `mix check` + credo/format/xref/arch/adr_trace/模块规模 + 静态扫描；不变量 I1/I2/I3/N-NARR/I-CACHE；阶段 1 行为不变 → 既有确定性/页面批次回归应保持。
- **边界**：不改每轮请求派生（CP2）、不改压缩作用域/触发（CP3）、不退役旧 `:session_transcript` 材料（CP6）；未实现前不代签。

## 11. 变更记录

- 2026-11-08：立项 + 阶段 1 设计草案（作者批准 ADR-0035 后产出；未授权实现）。
- 2026-11-08：补充 §1.1 断链定位（schema 时间线 + 三项漏承接）与 §8.0 彻底重构/复用清单（作者确认：系统设计有、实现偏差；彻底重构但复用设计资料和实现）。
- 2026-11-09：**证据面收口与全仓残留审计**：`authoring_run_evidence.test.mjs` 夹具适配到会话级 canonical（18/18）；`scripts/lib/native_ui/*.test.mjs` 共 31 文件 619 tests 全绿；全仓 grep 确认 scripts/ 无旧列读取残留（target/ 为构建产物、tasks/docs 为历史记录）；第二 native 页面批次（b71-authoring-transcript）因窗口激活环境失败登记不代签；B81 §8.1.6/§9 更新。
- 2026-11-09：**CP1 页面回归证据补验与验收资产适配**：native 批次 19/19 PASS（真实 Tauri 页面）；修复 B71 证据工具链对旧 run 私有列的残留读取（改为会话级执行段）并适配 4 个脚本测试夹具（全绿）；修复 browser driver 与 46 §9.5 UI 契约的既有漂移（`aria-label="推理"` → 「本轮创作过程」区域）；§9 登记旧列消费者清单遗漏与全仓核对教训、页面证据收口状态。
- 2026-11-08：**CP2 开工设计草案（§8.4，未实现待裁决）**：基于 CP1 事实基础与当前代码事实定清请求派生算法（会话历史 + 当前 scope/作者输入）、run 段与会话历史边界、会话级 refs、恢复语义、窗口压力/压缩触发、novel_common 边界（推荐不新增）、多 profile 覆盖与 8 项不变量/6 项机械判据、预期写域与 5 个待裁决问题；只设计不实现、不代签。
- 2026-11-08：**SOLID/周边法则审计与改进**：新增 §8.4 原则审计表；按审计实施——段头 data 键契约单一来源（`AuthoringSessionLog.header_data_keys/0`，application 消费、漂移 fail-closed）、删除无消费者 `message_format_version/0`、`record_id`/`normalize` 收敛为入口一次、同义分支合并、`run_id` 重复取值收敛、`fetch_session_messages/1` 消费者注释。既有例外（TurnExecutionService 旧回退路径、ActionIdempotencyService 防御键）登记不扩大范围。
- 2026-11-08：**CP1 收口**：全量 `mix check` EXIT=0（3110/0）、credo/format/module-size 通过、静态扫描 20 passed/1 failed（仅既有 gitleaks 处置）、I1/I2/I3/N-NARR/I-CACHE 全 PASS；三轮独立审计（两份只读审计 + 两位 teammate 交叉复审）结论；门禁脚本 `task_done_check.mjs` 测试文件误判修复；测试 helper 去重与模块规模回落。
- 2026-11-08：**CP1 复核与实现落地**。只读审计（文档/契约一致性与代码路径盘点）登记的 P0 缺口（存储落点未裁决、逻辑模型缺 run/system/tools/refs 落点、校验重复实现、并发机制、行为不变判据）在 §8.1 全部关闭；文档修正：VS-00L 行号 99/221→100/222、ADR-0035 Proposed 残留与坏链、§16.6/§16.12 落地说明补齐、§7.4 承接补全。CP1 实现：会话级 canonical 存储（消息流 + run 段头）、单一写入事务、恢复/回查/durable 段引用迁移、run 级私有列按未发布原则退役；测试全量改造并新增机制测试。
