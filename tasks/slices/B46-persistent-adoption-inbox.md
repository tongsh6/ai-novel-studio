# B46：持久 Adoption Inbox 与待处理视图

- 状态：**doing（2026-10-31 CP0/CP1/CP2 done：跨会话 inbox 经既有候选卡呈现、来源 turn 读回、处理后移除/只读隐藏已落地；CP3 真实页面矩阵待做）**。
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
| CP0 | 冻结 inbox 事实源、pending 与历史边界、恢复/版本/幂等语义；证明是否需要新持久结构 | done（§6） |
| CP1 | 持久读模型与恢复：按 work 获取当前 pending、来源和版本，支持关闭重开与新会话 | done（§7） |
| CP2 | 档案待审核视图与现有候选卡/动作接通；处理后消失，confirmed/history 分开 | done（§8/§9） |
| CP3 | accept/discard/edit_then_accept、重复提交、跨作品、刷新与恢复矩阵；真实 Tauri 证据 | done（§10；accept+discard/新会话/刷新真实页面，其余变体共享路径+后端测试，已登记残差） |

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

## 7. CP1 实施记录（2026-10-31）

- `WorkSessionRepo.adoption_inbox(work_id)`：复用 interactions 的 turn_result adoption_state，work-scoped 查询 pending/resolved/turn_results；不新增表。
- `adoption_entries/2` 为每个 pending/resolved 条目 additive 增加 `source_session_id`（session-scoped `adoption_state` 同样获得该标注；现有 DTO 结构兼容）。
- `WorkSessionService.resume/1` 与 `show/2` 增加 `inbox_pending_adoptions`、`inbox_pending_adoption_turn_results`、`inbox_resolved_adoptions`；session-scoped `pending_*` 语义保持不变；controller snapshot DTO 透传（Map.get 兼容旧调用）。
- 测试 `work_session_service_test`：两个会话各 pending 条目→active session 只看到本 session pending，inbox 汇总两 session 且 source_session_id 正确；跨会话 resolve 后 inbox pending 去掉、resolved 保留；跨作品隔离；26/0。
- 全量 backend mix **1049/0**（首次运行一条既有 AgentRunRuntime timing 失败，单测与复跑均通过，登记为既有 flake，非本次回归）。frontend 未消费新字段，未声称 UI 完成。

**CP2 下一步**：前端 resume 类型/待处理视图消费 inbox（含 source session/turn），动作前按 source turn 取回并走既有 adoption workflow；只读会话不得处理；处理成功从 inbox 移除。CP3 再用真实 Tauri 关闭重开/新会话矩阵验收。
## 8. CP2 进展（2026-10-31，partial）

- `WorkSessionRepo.turn_result(work_id, turn_id)`：按 work+turn 读取持久 assistant interactions 的 turn_result，work 隔离、非 assistant 不可见。
- `WorkSessionService.turn_result/2` 暴露给 web；`workspace_channel.source_turn_for_artifact_action/3` 当前 socket 缓存未命中时回退到持久 turn_result，使跨会话 pending 动作能把原 source turn 交给既有 adoption workflow（不复制状态机/不自动采纳）。
- 测试：`turn_result` work+turn 命中、非 assistant/未知 turn/跨作品不可见；service 27/0；全量 mix 1050/0。
- 未完成：前端 inbox 视图（source session 标注、待处理列表、处理后消失）、只读会话禁止处理、动作 payload 是否携带 source session 的约定、真实页面矩阵/重复提交/刷新恢复证据。CP2 保持 partial。
## 9. CP2 实施记录（2026-10-31）

- 前端 `WorkspaceResumeSnapshot` 增加 inbox 字段；`pendingAdoptionTurnResults` 优先 work-wide inbox（旧服务端无字段回退 session）；新增 `snapshotPendingAdoptions`/`snapshotResolvedAdoptions`。
- `WorkspaceChat` 初始 resume/reconcile/restore 统一使用 inbox 快照 → 既有候选卡与档案待处理区显示跨会话 pending；只读会话仍把 pending 清空、不可处理。
- 动作成功后立即从 `resumePendingAdoptions` 移除目标 artifact（失败保留），配合 channel 持久 source turn 回退，使新会话中的旧 pending 可直接 accept/discard/edit_then_accept；处理后下次恢复从 inbox 消失。
- 测试：inbox 优先/旧快照回退/快照摘要 helper；frontend 653/653、typecheck/lint 通过。
- 残差：inbox 条目视觉上未单独标注来源 session（DTO 已有 source_session_id，UI 沿用候选卡）；跨会话动作的重复提交/revision 失效/刷新恢复矩阵与真实页面证据归 CP3。
## 10. CP3 真实页面记录（2026-10-31，partial）

- 新增场景 `b46-cross-session-inbox`（nightly/tauri），真实 Tauri 窗口 + 外部 driver **PASS**：
  - 发送原文大纲得到 pending 候选；
  - 新建会话（旧 session EXITED），snapshot `pending_adoptions=[]`、`inbox_pending_adoptions` 含旧 artifact、inbox 携带 source turn result；
  - 在真实档案“经验规则”中从新会话继续采纳；
  - 刷新后 inbox pending 移除、resolved 保留，DB 仅一条 CONFIRMED 事实。
  - 证据：`artifacts/slice-verify/b46-cross-session-inbox-tauri/`，behavior `cross_session_pending_visible_and_adoptable_through_existing_action`。
- 产品修复（驱动中发现并纠正）：
  1. 通用 `author_action` 的 source_turn_result 仅查当前 socket；新增按 work+turn 持久回退。
  2. `pending_artifact_available?` 只查当前 session；改为 active session 可处理 work-wide inbox pending（work 隔离不变）。
  3. driver DB 路径断言改为 `NOVEL_TEST_DB_DIR ?? tmp`，不再要求未设置的 partition；verifier 注册新 slice。
- 重试预算说明：首两次失败为跨会话 action 无来源/被 session 校验拒绝（产品缺陷，已修）；后续两次失败分别是 driver DB 断言与 verifier 未注册（测试基建，已修）。每次均记录根因并做 scoped replay，未刷分。
- 未完成矩阵：跨会话 `discard`/`edit_then_accept`、重复提交、跨作品隔离、EXITED 只读会话页面不可处理；这些路径与 accept 共享 channel/adoption 边界且已有后端测试，但**未分别真实页面驱动**，不冒充完整 CP3。
- 门禁：新场景 PASS、quality manifest 221/223、manifest 测试 15/15、backend mix 1050/0（含本轮 product fixes 后）。
## 11. 收口记录（2026-10-31）

- 真实 Tauri `b46-cross-session-inbox` PASS（第二轮含跨会话 discard）：pending → 新会话 inbox → 档案 accept → 刷新移除/resolved；再生成第二候选 → 第三会话 inbox → 档案 discard → 刷新移除/resolved DISCARDED；DB 仅一条 CONFIRMED 事实。证据 `artifacts/slice-verify/b46-cross-session-inbox-tauri/`。
- 产品修复：通用 author_action 持久 source turn 回退；`pending_artifact_available?` 支持 active session 处理 work-wide pending；档案待处理卡新增“放弃候选”动作（既有 discard available_action）。
- 测试/门禁：service 27/0、backend 1050/0、frontend 653/653、typecheck/lint、quality manifest 221/223、新场景外部 driver PASS。
- **已登记残差（不冒充）**：跨会话 edit_then_accept、重复提交、跨作品隔离、EXITED 只读会话页面未分别用外部 driver 驱动；它们与 accept/discard 共享 channel/adoption 边界，已有后端/既有场景测试，但未单独页面取证。inbox UI 未单独标注 source_session_id（DTO 已提供）。
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

## 12. 残差矩阵 CP0 冻结（2026-10-31）

范围：现有 `b46-cross-session-inbox` 场景已用真实 Tauri 外部 driver 覆盖「跨会话 accept」「跨会话 discard」（driver `driveB46CrossSessionInbox`，§11）。本节冻结剩余四类残差的页面驱动方案；实现前不做任何产品语义变更。

| 矩阵 | 目标行为 | 现有能力/入口 | 需新增 driver 步骤 | 断言（页面/网络/DB） | 证据 | 预算 |
|---|---|---|---|---|---|---|
| E1 编辑后采纳 | 跨会话 inbox 待处理可用 `edit_then_accept` 真实完成采纳，保存的是编辑后内容 | 档案待处理卡「先修改内容，再保存到作品」（`copy.ts:400`）；adoption 边界已有 EDIT_THEN_ACCEPT | 打开编辑 → 修改正文 → 保存；等待 resolved 帧 | resolved `EDITED_ACCEPTED`；DB 仅一条 CONFIRMED 且内容=编辑后；inbox 移除；旧 pending 不再可处理 | `cross-session-edit-adopt.png` + resume JSON | 一次真实页面运行 |
| E2 重复提交幂等 | 同一 inbox 候选的重复采纳/放弃不产生第二次写入 | acceptance/adoption 已有 duplicate 幂等（持久层）；页面动作成功后按钮消失 | 成功后 reload 断言动作消失；若能定位 DOM 残留则触发第二次并断言被拒 | 第二次无新增 receipt/DB 行；页面动作不可重复触发；resume resolved 只一条 | resume JSON 前后对比 | 首轮先用页面「动作消失」+ 后端幂等证据；仅当页面可触发时补第二次点击 |
| E3 跨作品隔离 | work A 的 inbox pending 不得出现在 work B，处理亦不得跨作品生效 | 现有 work 切换入口（`openWorkMenu`/作品菜单）；inbox 已按 work 隔离（后端） | 切到 work B → 打开档案经验规则 → 断言 A 候选不可见；resume inbox 不含 A artifact；切回 A 仍在 | B 页面无 A 候选；B resume `inbox_pending_adoptions` 不含 A artifact；切回 A 可见 | `cross-work-isolation.png` + B/A resume JSON | 一次真实页面运行 |
| E4 EXITED 只读 | 旧 session 已 EXITED 后的历史只读 transcript 不提供待处理动作 | 历史会话只读视图（AU-03）；inbox 跨会话可见但历史只读 | 新会话后打开旧会话历史 transcript | 历史只读视图无「启用规则/放弃候选」按钮（不存在或 disabled）；inbox 仍从当前 active session 可见 | `exited-history-readonly.png` | 一次真实页面运行 |

**实现与证据约束**

- 扩展现有 `b46-cross-session-inbox` 场景 driver 与 manifest assertions（不新增第二套 runner/verdict）；若单场景时长超预算，再拆 `b46-inbox-residual-matrix` 独立场景。
- 产品代码不新增验收感知逻辑；页面动作一律使用用户可见语义（role/label/文案）。
- 失败预算：四矩阵合计最多 4 次真实页面运行，同一失败类型≤2 次；失败批次只读保留，不重跑换分。
- 不在本 CP 修改 adoption/免写边界语义；若发现产品缺陷，按「CP0→契约→修复→scoped 复验→回归」处理并登记根因。
- 未完成的矩阵不得以「共享边界/已有后端测试」冒充页面证据。
