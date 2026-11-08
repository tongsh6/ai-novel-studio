# B81：会话级 canonical 创作历史（ADR-0035 落地）

- 状态：**todo（2026-11-08 立项；ADR-0035 已批准；本文为阶段 1 设计草案，待作者确认开工后实现）**
- 来源：
  - 作者 2026-11-08 批准 [ADR-0035：会话级 canonical 创作上下文](../../docs/design/adr/ADR-0035-session-scoped-canonical-authoring-context-v3.md)（Accepted）。
  - 产品级偏差诊断：[2026-11-08-session-level-product-deviation](../../docs/design/notes/2026-11-08-session-level-product-deviation.md)（P0-1 跨轮上下文断裂、P0-2 会话级 canonical 事实源缺失、P1-1 压缩/G6 不可达）。
  - 契约落地说明：[VS-00L §16.1/§16.16/§17/§18.8](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)（2026-11-08 ADR-0035 批准修订，Frozen 判据不变）。
- 本文不复制验收标准到第二份文档；契约/验收细节随阶段在既有落点（`docs/design/contracts/`、`quality/`、`docs/engineering/`）登记。

## 1. 问题与判断

B71 的 G6（压缩后真实请求）长期不可取证，根因不是压缩小功能，而是**会话结构在运行时缺失**（诊断报告证据）：

- 每个 turn 是一个独立 run；`JudgmentProtocol.new_transcript/4` 从 `application_base` + 当前作者输入 + 当前 scope 重建，**不继承会话历史**；canonical transcript 持久化在 run 级私有列（`agent_runs.authoring_transcript`）；
- 同 session 多 run 的真实批次（A3，6 runs）中每个 run 的 transcript 只含本 run 的作者消息，跨轮指代没有会话事实可用；
- 压缩按"长会话/更早作者回合"设计（VS-00L 第 99/221 行），但输入是 run 级 transcript → 实际全部 0 checkpoint，G6 无对象；
- 会话历史只以旧装配链 `:session_transcript` 材料类型与 Interaction 展示流存在，B71 主链不消费。

判断：**阶段 1 的价值不是加功能，而是把 canonical 运行事实的作用域从 run 提升到 session**，为阶段 2（每轮请求由会话派生）、阶段 3（压缩作用域会话历史）提供唯一事实基础。阶段 1 **不改变模型可见行为**（请求仍由 run 内结构派生），因此可独立实现与验证、风险最小。

## 2. 范围与非目标

**阶段 1 范围（本任务当前部分）**：

1. **会话级 canonical authoring transcript 存储**：同 session 跨 turn 连续的消息序列（作者回合、assistant 工具调用、观察/校验、tentative 候选、作者裁决、checkpoint、应用通知与 scope），身份绑定 `session_id + work_id + workspace_id`；每条消息可追溯所属 run（`run_id` 引用，run 仍是执行段）。
2. **追加/合并边界**：每次 run 的成功/失败结果经 `AuthoringSession` 边界合并后**追加**到会话 transcript；现有完整前缀不可被改写（前缀不可变校验）；身份冲突/错绑拒绝；未知版本诚实拒绝（未发布，无 legacy 兼容分支）。
3. **恢复**：run 恢复/重启从会话 transcript 加载；恢复幂等；加载失败保留旧状态、不伪造成功。
4. **旧存储迁移**：run 级私有 transcript 列不作为新事实源；按未发布原则迁移/删除（不做兼容层）。旧 `:session_transcript` 材料类型与旧装配链的退役属阶段 6，本阶段不动。
5. **测试与回归**：确定性机制测试（跨 run 追加、前缀校验、恢复幂等、身份/错绑、未知版本、空会话、并发 run 追加顺序）+ 现有全量门禁与既有确定性/页面批次回归（阶段 1 不改变行为，现有证据应保持）。

**非目标（由后续阶段承接，不在阶段 1 冒充）**：

- 每轮请求由会话历史派生（阶段 2）；
- 压缩作用域/触发改为会话历史（阶段 3）；
- 作者可见细条/回查/审计以会话为对象的投影调整（阶段 3–4）；
- 三类 Provider 投影一致性复核（阶段 4，契约族不变）；
- 旧 `:session_transcript` 材料与旧装配链退役（阶段 6）；
- 不改 provider 投影、工具目录、采纳门、作者安全边界、UI 行为。

## 3. 契约与不变量

- **Contract**：ADR-0035 决策 1/2/9；VS-00L §16.1 落地说明（2026-11-08）；ADR-0033 §11 作用域落地边界（原则不变）。
- **Invariant**：
  1. canonical 消息**永久追加、不删改**；会话 transcript 的既有前缀不可变（新写入必须校验旧消息完整前缀与不可变身份）。
  2. 作者原话/artifact 字节保持（ADR-0033 既有不变量不变）。
  3. 恢复幂等：同一会话历史重复合并/恢复不产生重复消息或顺序漂移。
  4. 未知/损坏版本诚实拒绝，不猜测、不静默降级。
  5. 每条消息可追溯到真实 `run_id`；run 身份（work/session/workspace/parent turn）不可错绑。
  6. 阶段 1 不改变每轮请求投影 → 现有 I1/I2/I3/N-NARR 不变量与页面证据不得退步。

## 4. 边界

- 修改：`novel_application`（`AgentRunServer` / `AuthoringSession` / `JudgmentProtocol` 的读写端口，`AgentRunPersistence` 调用边界）、`novel_persistence`（会话级 canonical 存储 schema/migration/repo）。
- 不改：`novel_common`（Request IR/Compaction 契约族）、`novel_agent`（provider 投影/能力事实）、`novel_web`（Channel/TurnResult 投影）、前端、`novel_telemetry`。
- 迁移只按未发布原则：删除/替换旧列，不做历史兼容；只读历史证据保留在 `artifacts/`。

## 5. 消费者

- **第一消费者（阶段 2）**：每轮 Provider 请求由会话 transcript 派生的判断/执行边界；
- **第二消费者（阶段 4）**：审计/回查（Why/Replay）以"会话 canonical + run 引用"为对象；
- 阶段 1 自身无用户可见行为变化，消费者是内核边界而非 UI。

## 6. 证明与验收驱动

**Proof（阶段 1）**：

- 确定性机制测试：跨 run 追加顺序/前缀不可变/身份错绑拒绝/恢复幂等/未知版本拒绝/空会话/并发追加；旧 run 级列迁移后读路径正确。
- 全量门禁：`mix compile --warnings-as-errors`（dev/test）、全量 `mix test`、`mix check`、`credo --strict`、`format`、`xref`、`arch_check`、`adr_trace`、模块规模、静态扫描（`bash scripts/ai_static_scan.sh --top 10`）。
- 不变量：I1/I2/I3、N-NARR、I-CACHE；既有确定性/真实页面批次回归（行为不变）。
- 阶段 1 **不**签署跨轮连续性/压缩/G6；真实页面多轮会话证据在阶段 2/3 后作为集成验收。

**Acceptance Driver**：阶段 1 为事实层改造，无用户可见入口变化；页面级验收由阶段 2 的真实 Tauri 多轮会话批次承担（外部自动化像用户一样多轮操作，不构造异常路径）。**产品代码不得新增验收感知逻辑**。

**Exploration**：不适用——本阶段是事实存储与恢复边界，不涉及模型作品知识获取/探索面同步；说明理由即可。

## 7. 阶段划分（ADR-0035 落地）

| 阶段 | 范围 | 验收 | 依赖 |
|---|---|---|---|
| **1（本任务当前部分）** | 会话级 canonical 历史（存储/追加/恢复/迁移） | 机制测试 + 全量门禁 + 既有批次回归 | ADR-0035 已批准 |
| 2 | 每轮请求由会话派生（完整历史；窗口压力时 checkpoint 投影）；跨轮连续性 | 真实页面多轮会话（跨轮上下文/指代/义务）+ 请求证据 | 阶段 1 |
| 3 | 压缩作用域=会话历史、触发/细条/回查 | G6 压缩后真实请求（真实页面多轮自然触发）+ 失败静默/幂等 | 阶段 2 |
| 4 | 三类投影/恢复幂等 + 审计/回查以会话为对象 | 投影/幂等/回查证据；机制层 | 阶段 2/3 |
| 5 | 真实页面多轮会话综合验收 + G6 取证 | 页面/机制/实模分层报告（实模不代签） | 阶段 2–4 |
| 6 | 旧 `:session_transcript`/旧装配链/旧 run 级语义退役清理 | 删除后全量门禁 + 无消费者核对 | 阶段 5 |

## 8. 阶段 1 详细设计（草案，待评审）

1. **数据与身份**：
   - 会话级 canonical transcript 以 `session` 为聚合键（`work_id + workspace_id + session_id`），消息序列追加；每条消息带 `run_id` 与序号；
   - 会话身份与消息不可变身份校验（复用/扩展既有 AuthoringTranscript 的 envelope 校验；不引入第二套身份真源）；
   - schema/迁移：新增会话级存储，删除 run 级私有 transcript 列作为事实源（未发布，无兼容）。
2. **写入边界**：`AgentRunServer` 的 step 结果合并（成功/失败/恢复）统一经 `AuthoringSession` 追加到会话 transcript；`AgentRunPersistence` 负责持久化与恢复；失败时保留旧状态（不丢消息、不伪造成功）。
3. **读取边界**：run 启动/恢复从会话 transcript 取得自身执行段所需的现有结构（**阶段 1 保持 run 内派生语义不变**：请求仍从 run 的 stage_state/judgment_transcript 派生，只是该阶段状态来自会话 transcript 的对应执行段）；阶段 2 再切换为"请求由会话派生"。
4. **恢复/幂等**：加载 → 校验前缀与身份 → 合并；重复加载幂等；未知版本 fail-closed。
5. **迁移**：旧 `agent_runs.authoring_transcript` 数据不做兼容迁移；删除列/旧读路径（只读历史证据在 artifacts）。
6. **测试**：按 §6 Proof 的确定性用例；重点负例：前缀被改写、身份错绑、重复追加、未知版本、空会话恢复、并发 run 追加。

## 9. 剩余后果与阻塞

- 阶段 1 完成不解除跨轮连续性/压缩/G6 的验收缺口；这些由阶段 2/3 承接，未实现前**不代签**。
- 旧 run 级列删除前需核对全部消费者（`AgentRunServer`/`AgentRunPersistence`/`AuthoringReplay`/测试夹具/脚本）；旧 `:session_transcript` 材料在阶段 6 退役，阶段 1 不动。
- 真实页面多轮会话验收依赖阶段 2；实模证据另证（不代签）。
- 实现前需作者确认开工（本任务当前为设计草案）。

## 10. 决策与恢复指引

- 已生效决策：ADR-0035（2026-11-08 Accepted，作者批准）；本任务阶段 1 设计为执行层承接。
- 未决：是否按本设计开工阶段 1（作者确认）；阶段 2/3 的具体验收口径在开工时按 ADR-0035 与 VS-00L 登记，不在此处另立第二份标准。
- 恢复入口：`tasks/NEXT.md` → 本任务；实现状态、checkpoint、剩余后果在本文件维护。

## 11. 变更记录

- 2026-11-08：立项 + 阶段 1 设计草案（作者批准 ADR-0035 后产出；未授权实现）。
