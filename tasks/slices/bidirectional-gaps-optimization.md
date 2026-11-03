# 双向沟通过隙优化（基于 2026-11-04 全面审核）

> 审核真源：[`artifacts/review-bidirectional/SUMMARY.md`](../../artifacts/review-bidirectional/SUMMARY.md)（4 名独立审核员 + Lead 交叉复核 + 亲跑测试；只读审核）。
> 本计划目标：把审核报告中的 P1/P2 缺口逐项核对当前代码、排优先级、给出修复方案与验收方式，按可 review 粒度分批实施。
> 边界：审核结论 L1–L4a 已成立；L4b（真实模型语义质量）仍 `blocked`，本计划不代签、不伪造。

## 0. 现状核实（2026-11-04，HEAD `f8f77ca5` 前后）

| 审核项 | 当前代码状态 | 结论 |
|---|---|---|
| P1-1 S2C 孤儿 `action_result` | 后端 `workspace_channel.ex` 仍有 27 处 `broadcast!`；前端**无** `channel.on("action_result")` 监听（仅有类型定义与单测 fixture） | **仍存在** |
| P1-2 8 个 C2S 幽灵事件 | `socket.ts` 仍有 `confirm/reject/revise/dismiss/resume/cancel/branch/retry` push 辅助函数；后端 channel **无**对应 handler；前端**无调用点**（仅死代码） | **仍存在**（死代码 + 误用即崩 channel 风险） |
| P1-3 传输层无鉴权 | `user_socket.ex` 注释明确「Phase 0 不做鉴权，Phase 1 接入 Authority.Gate」 | **设计边界**（本地单机桌面 Phase 0），非缺陷；留 Phase 1 |
| P1-4 `compact_transcript` 后端孤岛 | Channel 有 handler（`workspace_channel.ex:1121`），前端无类型/入口 | **仍存在** |
| P1-5 跨后端重启 HITL 断裂 | 前端有 `renderExpiredBoundedDock`（expired 模式）；durable dead 场景是否覆盖待场景确认 | **需场景验证**（审核报告称 dead durable 渲染 null） |
| P1-6 新交互无 gate verdict | `artifacts/slice-verify` 72 个 verdict 全 `provider=slice_verify`；「等待即回答」重构只有前端单测 + 非验收 smoke | **仍存在**（验收基线缺口） |
| P1-7 真实模型语义未验收 | `quality/acceptance/known-gaps.md` 有 blocked 表；`author-behavior-real-llm-subset` blocked | **仍存在**（blocked，不代签） |
| P2 断线只补状态不补事件 | 待确认（无 gap 检测/sequence 补拉） | 仍存在 |
| P2 多窗口 event_sink 顶掉 | `agent_run_server.ex` 单 `event_sink`（审核行 778-781） | 仍存在 |
| P2 clarification 契约-实现缺口 | `answer_clarification` 落 catch-all 只 ack；无生产方 | 仍存在 |
| P2 `user_message.behavior_id` 死接线 | Channel `handle_in("user_message")` 不读 behavior_id | 仍存在 |
| P2 文档 vs artifact 不符 / 目录名误导 / token 流 | 审核登记项 | 文档/证据口径问题 |

## 1. 优化项与方案（按优先级）

### 批次 A：传输层死协议清理（P1-2、P1-1；低风险、高收益）

**A1 删除 8 个幽灵 C2S 事件**（`frontend/src/lib/socket.ts` `confirm/reject/revise/dismiss/resume/cancel/branch/retry` 辅助函数）
- 方案：删除已无调用点的死函数（保留 `AgentCommand` = pause/resume/cancel/steer 真实命令）；若未来需要旧 behavior 协议，由契约重新引入，不留「可误用的死代码」。
- 验证：`pnpm typecheck/lint/test`；grep 确认无引用；前端全量。
- 风险：低（无调用点）。**不做 catch-all**：Phoenix 无 handler 时本就应显性暴露错误，不为死代码加兜底。

**A2 前端补 `action_result` 监听（或删除无消费者的广播）**
- 先定位：后端 27 处 `broadcast!` 中哪些只发 `action_result` 不发 `turn_result`（跨窗口同步依赖 action_result 的分支）。
- 方案（二选一，按事实决定）：
  - 若确需跨窗口同步：前端 `channel.on("action_result")` → 更新候选/回执状态（与 `turn_result` 幂等去重）；
  - 若已有等价 `turn_result` 覆盖：后端删除冗余 `action_result` 广播（少一条协议）并更新契约。
- 判定：以「跨窗口（两个窗口同 workspace）能否一致显示受理回执」为验收场景，确定性驱动验证。
- 风险：中（涉及广播/契约）；需先出「哪些分支只发 action_result」清单。

### 批次 B：`compact_transcript` 前端入口（P1-4；中等）

- 现状：后端 Channel/Service/GenServer + 测试齐备；前端无类型/入口 → 能力孤岛。
- 方案：按产品语义落地一个真实消费者（作者可见的「整理较早记录/检查点」动作，或由控制坞提供）——**先确认产品是否要暴露该动作**（46 §9.9 已定义「作者零操作自动整理」；若产品不需要手动入口，则删除后端孤岛或标记 internal-only，不留半条链路）。
- 验证：若暴露 → 前端类型 + 动作 + 真实批次；若删除 → 后端清理 + 契约更新。

### 批次 C：跨后端重启 HITL 恢复（P1-5；高价值、中高复杂度）

- 方案：durable dead run 的控制坞提供显式恢复入口（「从检查点继续」/「重新发起」），并明确 open 问题在 runtime_live=false 时能否答复：
  - open 问题在 run 不可 live 时 → 「重新发起该问题」路径（预填原问题与选项）；
  - dead durable 控制坞渲染独立状态（不再 null）。
- 验证：kill backend → 刷新 → 控制坞可见恢复入口 → 重新发起/恢复；确定性驱动 + 页面证据。
- 依赖：A2 的跨窗口一致性（同一状态通道）。

### 批次 D：验收基线补门（P1-6、P1-7；证据链）

- **D1**：「等待即回答」重构补 gate verdict：
  - 场景：真实页面（Tauri）→ 诱导 ask_author → 底部回答面板选项/自由文本回答 → 同 run `user_turns=2` + `run_resumed` + provider 继续 + 全新类扫描 hits=0（新交互 L4a 证据）；
  - 驱动已有（native-runner `fdbacccc`/`e8fd6840`/`204cc939`/`2d2b0d9a`）；产出正式 verdict 并登记「provider=slice_verify」口径。
- **D2**：真实模型语义（L4b）`author-behavior-real-llm-subset` 仍 blocked——写清 re-anchor 条件（真实模型/预注册/判据），不代签；如资源允许，按预注册跑一次真实模型批次并如实登记（PASS 或 evidence_missing）。

### 批次 E：P2 健壮性（低优先级，可分批）

- E1 断线补事件序列：加 sequence gap 检测 + 补拉（或明确「只补快照」为产品决策，写进契约）。
- E2 多窗口 event_sink：同一 run 多窗口订阅改为多 sink（或明确「单窗口」产品边界）。
- E3 clarification 契约-实现缺口：确认该 behavior 是否仍需要（有模板/动作/渲染但无生产方）→ 要么接入生产/消费方，要么删除并更新契约。
- E4 `user_message.behavior_id`：接线读取或删除字段（不留死字段）。
- E5 证据口径：`-tauri` 目录名 vs `summary.surface` 不符 → 证据指南补充「必须看 surface/driver/provider」；UA-01 D3 文档与 artifact 差异更正或标注。

## 2. 实施顺序与验收

| 批次 | 内容 | 预计 | 验收 |
|---|---|---|---|
| A | 幽灵事件清理 + action_result 归位 | 半天 | 前端全量 + 真实页面跨窗口证据（若涉及广播） |
| B | compact_transcript 入口或清理 | 半天 | 前端/后端全量 + 契约更新 |
| C | 跨重启 HITL 恢复 | 1–2 天 | 确定性驱动 + 页面证据 + 恢复指引 |
| D | 验收基线补门 | 1 天 | 正式 verdict（L4a）+ blocked 口径登记 |
| E | P2 健壮性 | 2–3 天（可分项） | 各子项单测/契约更新 |

每批独立 commit（可 review 粒度）+ 全量门禁（后端 3061/0、前端 743+、I1/I2/I3、credo/module-size/xref/arch、设计追溯、静态扫描 blocking=0）+ push。

## 3. 明确不做

- **不加传输层兜底 catch-all**（Phoenix 无 handler 应显性失败；不为死代码加防崩层）。
- **不代签 L4b**（真实模型语义 blocked；不给 stub 证据升 PASS）。
- **鉴权留 Phase 1**（`user_socket.ex` 注释明确；本地单机桌面 phase 0 边界）。
- **不为「双向特性」新增产品面**：审核结论已确认核心架构主线成立，本计划只修缺口，不造新功能。

## 4. 关联

- 审核报告证据：`artifacts/review-bidirectional/{transport,dialogue,runtime,evidence}.md`
- 相关既有任务：B71（创作请求体/等待即回答）、46 §9.7 契约、B26 问答闭环、B31 CP1 steer 绑定。
- 恢复指引：`artifacts/b71-resume/`（A3b/交互重构证据链）。
