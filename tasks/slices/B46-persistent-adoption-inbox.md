# B46：持久 Adoption Inbox 与待处理视图

- 状态：**doing（2026-10-31 CP0 盘点完成：pending 事实/读模型/session scoping/动作恢复路径已核；work-wide inbox 读模型与跨会话处理待做）**。
- 登记日期：2026-10-27；来源：待处理项主要依赖 transcript/runtime pending state，重开或换会话后缺少集中恢复与处理入口。
- 上游：[AU05](AU05-file-level-closure.md)、[AU09](AU09-file-level-closure.md)、[AU09-archive-stats-current](AU09-archive-stats-current.md)、[B31](B31-author-reply-run-binding.md)。

## 1. 目标与边界

为作者提供一个跨会话可恢复的待处理工作箱：

```text
真实 pending/receipt → 持久读模型 → 关闭重开/新会话仍可见
→ 作者继续 accept/discard/edit_then_accept
→ 处理后消失且无副作用不重复
```

只恢复 transcript 不等于恢复完整 workbox。AU05 与 AU09 不分别建设两套 inbox；上游持久恢复与下游档案待审核视图使用同一事实源。

## 2. 开工七问

1. **Contract**：既有 pending/receipt、adoption 七态、session/work scope、B31 恢复语义与 VS-04/VS-05。读模型先复用现有事实，不默认新增平行表。
2. **Invariant**：pending 不混 confirmed；重开/新会话恢复同一对象与版本；处理后不重复执行；跨作品不可见；未采纳不进入 canon；刷新/恢复不重复产生用户动作或作者消息。
3. **Boundary**：application 恢复读模型、persistence 查询、web/channel 既有入口、frontend 档案/候选视图。先评估现有存储是否足够，必要时才论证新增持久结构。
4. **Consumer**：跨会话继续采纳/放弃的作者，以及档案待审核视图和 why。
5. **Proof**：真实 pending→关闭重开/新会话仍可见且可处理→accept/discard 后消失；版本/来源/状态一致；work 隔离、无重复副作用。
6. **Acceptance Driver**：外部驱动真实 Tauri 产生真实候选，关闭重开应用和新建会话，在可见待处理区继续处理；产品验收感知逻辑 **no**。
7. **Exploration**：待处理与历史项可经真实档案/查询读取，不新增隐藏内存态；恢复后 why 可追真实 pending/receipt 来源。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 冻结 inbox 事实源、pending 与历史边界、恢复/版本/幂等语义；证明是否需要新持久结构 | 未开工 |
| CP1 | 持久读模型与恢复：按 work 获取当前 pending、来源和版本，支持关闭重开与新会话 | 未开工 |
| CP2 | 档案待审核视图与现有候选卡/动作接通；处理后消失，confirmed/history 分开 | 未开工 |
| CP3 | accept/discard/edit_then_accept、重复提交、跨作品、刷新与恢复矩阵；真实 Tauri 证据 | 未开工 |

## 6. CP0 盘点记录（2026-10-31）

**真实事实源（复用现有存储）**：
- assistant `interactions.content.turn_result.adoption_state.pending/resolved` 是唯一待处理/已处理事实；采纳七态与 artifact revision 仍在 turn_result/回执中，无独立 pending 表。
- `WorkSessionRepo.adoption_state(work_id, session_id)` 按 **work+session** 过滤 assistant interactions，pending = 所有 pending 条目去掉 resolved artifact_id，返回 pending_adoptions / pending_adoption_turn_results / resolved_adoptions；不跨 session。
- `WorkSessionService.resume/1` 只取 **active session** 的 adoption_state；`show/2` 取指定 session，read-only session 隐藏 pending；Channel join 恢复也按 active/requested session 的 turn_results。
- 前端 `pendingAdoptionTurnResults` → `WorkspaceChat` 候选卡/待处理视图；动作走 adopt/discard/edit_then_accept，channel 从当前 socket/transcript 的 source turn 找回 artifact 并调 adoption workflow；idempotency 依赖 receipt key/revision，已有幂等测试。
- 现有持久结构（interactions JSON）**足够**表达待处理、来源 turn、版本与 resolved；不需要新建 inbox 表。

**真实缺口**：
1. 读模型 session-scoped：重开同 session 可恢复；**新会话看不到旧会话 pending**，不满足“跨会话集中恢复”。
2. 动作入口依赖当前 socket/transcript 的 source turn；新会话即使能看到列表，也缺少服务端按 source turn ref 取回并继续采纳的通路。
3. 待处理与 resolved/history 已在同一读模型分流；但无 work-wide 历史视图/来源 session 标注。
4. 缺来源/版本/revision 时目前会由 adoption workflow 阻断（不冒充当前有效），但需要在 inbox 读模型层显式表达，不能静默丢弃。

**CP1 冻结方向（拟，需实现验证）**：
- 复用 interactions JSON，新增 work-wide 只读查询 `adoption_inbox(work_id)`：pending（含 source_session_id/source_turn_ref/artifact_id/revision）+ resolved（仅展示，不提供动作）；仍用 resolved artifact_id 去重。
- resume/show snapshot 增加 inbox 字段或让 pendingAdoptionTurnResults 在 active session 为空时补 work-wide pending（保留 session 语义与历史读取，不改变 read-only 限制）。
- 动作：服务端按 source_session_id + source_turn_ref 从持久 interactions 取回 turn_result/tentative artifact，再走既有 adoption workflow；不复制状态机、不自动采纳。
- 测试：同 session 重开、全新 session、跨作品隔离、来源缺失/revision 失效、重复提交幂等、处理后从 inbox 消失；真实页面 driver 由 B46 CP3 定义。

**未决**：动作是否需要前端先切换 source session（实现成本低）还是服务端跨 session 直接采纳（体验好、改动大）；CP1 先按“服务端按 source ref 取回，不要求切换”做可行性验证，若来源契约不足则登记 blocker 并给作者选项。

## 4. 非目标

- 不复制 transcript 当 inbox，不新增第二套 pending 状态机。
- 不把 AU05 与 AU09 拆成两个平行任务。
- 不自动采纳、不自动清理、不让 pending 进入 canon。
- 不重复 AU07 persisted replay 或 AU12 概览/快照，不为“有表”建表。

## 5. 验证与恢复

- 真实 pending 在重开/新会话后仍保留身份、版本、来源与可执行动作；处理后消失。
- accept/discard/edit_then_accept 均不重复写入；pending 与 confirmed/历史展示正确。
- 跨作品只读隔离，缺来源/版本时诚实降级，不把旧候选冒充当前有效。
- 恢复时先读 B31、AU05/AU09 和 VS-04；若现有持久结构足够，不新增表。
