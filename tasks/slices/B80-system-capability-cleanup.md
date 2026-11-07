# B80：系统现有功能梳理与完善

- 状态：**doing（2026-11-08 立项）**
- 来源：作者 2026-11-08 原话「B79 是大工程，并且是独立的功能，先把系统现有的功能梳理了清楚，完善」。
- 上位依据：[00f 实现态能力图谱](../../docs/design/00f-capability-atlas.md)（本任务产出的 living 文档：真实入口 → 功能域 → 实现/消费 → 证据/缺口）。
- 边界：**不启动 B79**（导入/分析为独立大功能）；不改设计真源语义；每批改动可 review、门禁与不变量保持绿；未取证能力不代签。

## 1. 目标

把系统「现有功能」从设计态与任务态落回**实现态事实**：逐域核对真实入口、生产实现、测试与页面证据，产出可维护的能力图谱；据此清理死代码/旧协议、修正文档与实现不一致、补齐可立即修的小缺口。**不是**新增大功能，也**不是**重写现有设计。

## 2. Checkpoints

| CP | 范围 | 状态 |
|---|---|---|
| CP0 | 能力图谱首版：真实入口盘点（前端三视图/Channel 消息/HTTP API/桌面与验收入口）、16 功能域矩阵（状态词表 M0–M3/D）、首轮缺口清单（P1–P3） | **done**（2026-11-08，`b61389c5`，[00f](../../docs/design/00f-capability-atlas.md)） |
| CP1 | 死代码清理：`ChannelDemo`（无引用 demo 组件）、`adoptionDecision`（仅测试引用）删除；审计/追溯脚本豁免同步 | **done**（2026-11-08，`d1475385`；前端 484 tests 全绿） |
| CP2 | 旧协议退役：Channel `adopt`/`discard`/`modify_draft`（前端已改走 `author_action`，AU-05 已确认入口变更）；删除 handler 与 result helper，把 pending 校验/跨 work 拒绝/edit_then_accept 安全断言迁移到 author_action 测试 | **评估完成，待实施**（见 §3） |
| CP3 | 文档/台账一致性：`quality/acceptance/known-gaps.md`、`docs/design/00c`、`tasks` 中的过时描述与当前实现逐条核对并修正 | 待做 |
| CP4 | 逐域核对补缺：按 00f §3 的 M1/M2 域抽查（上下文压缩、设置页、恢复、可观测性等），输出下一批修复或候选；不接受「机制层代签页面/实模」 | 待做 |

## 3. CP2 旧协议退役评估（2026-11-08）

- **事实**：前端 push 消息扫描 0 处 `adopt`/`discard`/`modify_draft`；前端采纳走 `author_action`（`accept`/`discard`/`edit_then_accept`）；`AU-05` 设计文档已记录「旧文档『WorkspaceChannel 缺 handler』过期，当前有效入口是 author_action」。
- **后端结构**：三个 handler 各约 50 行；私有 `handle_adopt_result`/`handle_discard_result`/`handle_modify_draft_result` 仅被旧 handler 使用；`source_turn_for_artifact_action`/`previous_active_behavior` 仍有其它使用（保留）；底层 `AdoptionWorkflow.handle_*` 被 `author_action` 与 `pending_artifact_workflow` 复用（不删）。
- **测试**：`workspace_channel_v3_test.exs` 13 处旧协议消息调用；退役时迁移 pending 校验、跨 work 拒绝、`edit_then_accept`（SC-AU05-B3）等安全断言到 author_action 路径，不降低覆盖。
- **风险**：旧日志事件名（`:adopt`/`:discard`/`:modify_draft` 的 LogEmit）将不再产生；确认无日志/验收依赖后再删。

## 4. 验收与证据

- 每批：`mix check`（含全量测试与 I-CACHE）、不变量 I1/I2/I3/N-NARR、静态扫描全绿；
- 页面/实模证据：沿用既有验收入口（`quality_accept.sh`/`tauri_slice_verify.sh`/`native_b71_batch.sh`），本任务不新造验收标准；
- 00f 缺口清单与状态同步更新（同 commit）。
