# B77：Goal-centric 持续运行目标架构评审

- 状态：**deferred（2026-11-01 作者需要研究思考；初稿尚未全面核对项目愿景与元原则，从 NEXT 移除，暂停 R1–R7 裁决及后续 ADR / 实现规划）**
- 类型：Direction / Architecture 设计评审；不授权生产实现
- 来源：作者提出 Router + Worker、事件驱动、Inline & Spill / Chain of Recall、异步持久在线与 Watchdog，要求不做补丁式缝合，先整体走通设计重构。
- 设计真源：[00e-goal-centric-runtime-architecture-review](../../docs/design/00e-goal-centric-runtime-architecture-review.md)
- 关联：[B50](B50-multi-agent-current-boundary.md)、[B52](B52-longrun-batch-draft.md)、[B71](B71-provider-message-fidelity.md)、ADR-0021 / 0027 / 0033、UA-01、04a、06、07。

## 1. 范围与目标

形成一套可评审的 Goal-centric 持续运行目标架构，统一：

- Goal / EventEnvelope / WorkItem / AgentRun / Conversation / Turn 的所有权；
- Router 确定性协调与 Worker 统一 AgentRun 执行边界；
- 等待、挂起、重试、lease、checkpoint、恢复与副作用语义；
- Inline / Spill / Chain of Recall 与 Transcript / Observation / used refs；
- 云端控制面、本地 Execution Node、WorkbenchProjection 与作者主权；
- 现有 ADR / contract / slice 的保留、迁移、重新开放与最终退役关系。

完成标准不是“有一份构想”，而是 R1–R7 经作者逐项裁决后，对象、状态、故障矩阵、首个真实消费者、外部自动化和迁移映射均无关键悬空项。

## 2. 非目标

- 不修改生产代码、schema、migration、Provider、Connector、前端或运行时。
- 不新建 Accepted ADR、不启动多 Agent / 24×7、不调用真实模型或第三方账号。
- 不因架构提案自动启动 B50 实施或 B52 批量初稿，不宣称旧能力已交付。
- 不把 B71 当前未提交 WIP 改写成新架构；B77 只登记后续迁移关系。
- 不新增平行的设计目录、任务体系或实现计划。

## 3. 开工七问（设计阶段）

1. **Contract**：评审 Goal / EventEnvelope / WorkItem / AgentRun attempt / RunResult / WorkbenchProjection；承接 ADR-0021、0027、0033、UA-01、VS-00L、ADR-0015 与 04a。
2. **Invariant**：统一执行内核、单一 Goal 写者、事件幂等、lease fencing、权限只收缩、tentative-first、真实观察、作者字节、replay 不调模型、Watchdog 有界恢复。
3. **Boundary**：只改 `docs/design` 目标架构与索引、`tasks` 本任务和排期、必要事实台账；不改 `apps` / `frontend/src` / 生产配置。
4. **Consumer**：第一消费者是作者与架构评审者；未来产品消费者建议为作品相关本地文件事件驱动的持续 Goal，以及真实 WorkbenchProjection。
5. **Proof**：R1–R7 逐项裁决；对象 / 状态 / 故障 / 验收 / 迁移矩阵可闭合；文档链接和排期检查通过。未来实现仍须真实 Tauri + 真实外部事件 + 真实故障证据。
6. **Acceptance Driver**：本阶段无产品验收驱动；目标设计 S1–S7 见 00e §17，未来由外部自动化操作真实 Tauri、真实文件 / Connector 和外部故障入口，产品新增验收感知逻辑 **no**。
7. **Exploration**：本设计直接服务通用求证；Recall 必须经同一只读探索与观察回流，跨 attempt 不伪造 Base，不新增固定 packet 或第二求证 runtime。

## 4. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 输出目标架构初稿：方案比较、统一对象与状态、Router / Worker、事件、Context、跨设备、Watchdog、事实边界、G 系不变量、故障矩阵、S1–S7、现有契约迁移和 R1–R7 | **done（仅文本产出，2026-11-01）**：初稿已落盘；未完成项目愿景与元原则全面核对，不代表设计评审走通 |
| CP1 | 先全面核对项目愿景与元原则，再由作者研究并评审 R1–R7；记录接受、修改或拒绝及理由，解决关键语义冲突 | deferred |
| CP2 | 按裁决吸收修订，同步 00c / 00d / 相关设计与任务关系；形成后续 ADR 输入清单，不提前标 Accepted 或授权实现 | deferred |

CP0 的“初稿文本产出完成”不等于目标架构 Accepted，不等于全面设计检查完成，不等于 B50 / B52 重新开放，不等于任何实现或验收完成。重新开放须由作者明确触发，且先补齐愿景与元原则审计。

## 5. 已核实的设计输入

- 当前 AgentRun 对 session / parent_turn / origin_frame 有强所有权约束，外部事件不能靠伪造 Turn 接入。
- 当前 bounded / durable / LongRunTask / BehaviorState 分层若直接叠加 Goal，会产生重复等待与恢复语义。
- TaskRunner 的真实异步执行仍是占位，不应在其上继续补新控制面。
- ADR-0033 的统一运行事实、Transcript、观察和 checkpoint 是必须承接的执行底座。
- B50 已记录多 Agent / 24×7 deferred；本次作者需求是重新评审输入，但不是自动实施授权。
- 当前桌面 sidecar 不具备机器关机后的 24×7 能力，持续在线必须明确常开控制面和节点离线语义。

## 6. 评审后承接

- CP1 裁决写回本任务，不由 AI 代签。
- CP2 只完成设计与迁移收口；后续 ADR、contract pack、schema 和垂直实现 slice 另行登记。
- 若接受 WorkItem / Run-attempt，ADR-0021、UA-01、VS-00L、B31 / DS03 / UA01-CP5 等现有 steer / resume / durable 消费者必须进入逐条迁移清单。
- 若接受 WorkbenchProjection，ADR-0015、VS-05、07 和前端唯一读模型必须同步迁移，不能让 UI 直接读内部 Goal / WorkItem 表。
- 旧实现、历史证据和 B71 当前工作不删除；最终退役以消费者迁移与真实页面证据为准。

## 7. 验证与恢复

- 文档 / 排期：`node scripts/next_task_check.mjs`。
- ADR 引用基线：`mix run scripts/adr_trace.exs`（本稿不新增 Accepted ADR，不以其冒充实装证据）。
- 前端设计追溯不适用于本次无组件改动；无需运行产品测试或场景不变量。
- 恢复时先读 00e 的状态和本任务 CP，再从作者最新 R1–R7 裁决继续；不得只读旧讨论推荐就进入实现。

## 8. CP0 验证记录（2026-11-01）

- `node scripts/next_task_check.mjs`：通过。
- `bash scripts/check_design_trace.sh`：19 passed / 0 warning / 0 failed；本次未改组件。
- 本次新增文档、任务和相关设计索引的本地 Markdown 链接：134 个目标均可达；NEXT 新增 B77 链接可达。
- 新评审稿与新任务的代码围栏、尾随空白检查：通过；`git diff --check`：通过。
- `mix run scripts/adr_trace.exs`：未通过，原因是既有 Accepted `ADR-0032-paper-trail-retirement-v3` 缺少 `## enforced_by`；本任务未修改该 ADR，也不以本次新增 Proposed 文档冒充它的实装证据。
- 全量 touched-file 链接检查另发现 `tasks/NEXT.md` 既有 `../../artifacts/queue-audit/2026-10-31-audit.md` 引用目标不存在；该引用不属于本次新增，未擅自删除或重建历史 artifacts。排除这项既有问题后，本次范围链接全部通过。
- 本次只有设计、索引、任务与事实台账变更，未运行产品测试、I1/I2/I3 或真实页面验收，也未据此声称任何产品能力完成。
