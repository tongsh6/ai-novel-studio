# VS-09 Work Management Closed Loop

> 状态：docs-ready（2026-05-11）
>
> 角色：把"作品"作为运行时一等公民，端到端打通 *作者新建/选择作品 → 在该作品里对话 → 重启后恢复同一作品* 的最小闭环；消除 `WorkspaceChat.tsx:139` 的 `workId: "mock_work_123"` 硬编码与 `apps/novel_web/lib/novel_web/router.ex` 缺失的作品 HTTP 入口。

---

## 1. Contract

| Contract | 用途 |
|---|---|
| `apps/novel_persistence/lib/novel_persistence/schemas/work.ex` | works 表已存在，包含 `title / genre / status / revision`（已就位）|
| `apps/novel_persistence/lib/novel_persistence/schemas/workspace.ex` | workspaces 表已存在（已就位）|
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | join `workspace:<id>` 接受 `work_id` 参数；后续 `user_message` 注入 `work_id` 进 input |
| `docs/design-v3/acceptance/system/SU-02-work-switching.md` | 验收 8 个场景；本 slice 至少完成 A1/A2/B1/B2/B3/C1/C2/D1（7 个核心）|
| `docs/design-v3/00b-end-to-end-dialogue-flow.md` §work boundary | DialogueContext 必须按 work_id 隔离 |
| `docs/design-v2/24-novel-intent-catalog.md` `CREATE_WORK_SEED` intent | 新建作品的语义入口已设计 |

> **冻结点**：本 slice 不重新发明 `Work` schema，只补 HTTP/Channel/前端入口与 work_id 透传。

## 2. Invariant

1. **隔离**：在 work-A 发出的消息、采纳产物、长跑任务，不出现在 work-B 的 `DialogueContext` / `MemoryRecall` / `LongRunTaskLog.list_active`。（验证：跨 work 串数据回归测试）
2. **持久化**：作品列表与 last-opened-work_id 在 SQLite3 中持久化，重启进程能恢复。
3. **前端去 mock**：`WorkspaceChat.tsx` 的 `workId` 不再硬编码，必须从 `GET /api/works` 列表派生。
4. **Channel 必须接受 work_id**：缺少 `work_id` 时回退到 default work（保持向后兼容），但 `socket.assigns.work_id` 必须存在；广播 `turn_result` 必须带 work_id 维度。
5. **adoption / projection 边界不变**：作品级数据隔离不绕过 v3 adoption boundary；CREATE_WORK_SEED 仍走 tentative→accepted 流程。

## 3. Boundary

```text
novel_web (HTTP + Channel)
  ├ POST /api/works              ──┐
  ├ GET  /api/works              ──┼─→ novel_application.WorkService
  ├ GET  /api/works/:id          ──┘        ↓
  └ workspace:<ws>:join(work_id) ─────────→ novel_persistence.Schemas.Work + WorkspaceContext

novel_application
  └ WorkService (新增)：list / create / get / set_last_opened
    └ 委托 novel_persistence

frontend
  └ WorkspaceChat.tsx
    ├ 启动时 fetch GET /api/works → 列表 + last_opened_work_id
    ├ 切换作品时 channel.leave + connect 新 channel(work_id=...)
    └ 创建作品 → POST /api/works → 切换
```

**不修改**：novel_foundation / novel_domain / novel_agent / novel_persistence schema 本身（已就位）。**不实现** SU-02 D2（作品不可用降级 UI）和 C3（未命名作品占位名）——本 slice 只做核心 7 场景。

## 4. Consumer

- 真实消费者：`frontend/src/components/WorkspaceChat.tsx`（去 `mock_work_123`）。历史 `WorkbenchV3.tsx` 旁路已退役删除，不再作为消费者。
- 测试消费者：`apps/novel_e2e/test/novel_e2e/work_switching_test.exs`（新增）+ `apps/novel_web/test/.../workspace_channel_v3_test.exs`（扩展）

## 5. Proof

| 步骤 | 命令 | 预期 |
|------|------|------|
| 1 | `mix test apps/novel_web/test/.../workspace_channel_v3_test.exs` | join 接受 work_id；缺省回退 default |
| 2 | `mix test apps/novel_e2e/test/novel_e2e/work_switching_test.exs --include integration` | 跨 work 不串数据；切换 + 重启恢复 |
| 3 | `mix test` 全量 | 0 failures |
| 4 | `cd frontend && pnpm test` | WorkspaceChat 列表渲染 + 切换契约测试 |
| 5 | `bash scripts/ai_static_scan.sh --top 10 --quick` | 0 finding |
| 6 | 真人冒烟：启动 → 看到列表 → 新建 work-X → 发消息 → 关闭重启 → 仍在 work-X | walkthrough 报告 ✅ |

---

## 6. 涉及范围

| App / 文件 | 改动类型 | 说明 |
|---|---|---|
| `apps/novel_persistence/lib/novel_persistence/work_repo.ex` | 新增 | `list/0`, `create/1`, `get/1`, `set_last_opened/1`，最小 CRUD |
| `apps/novel_application/lib/novel_application/work_service.ex` | 新增 | 应用层封装（验证名字、组装 dto），不直接暴露 schema |
| `apps/novel_web/lib/novel_web/controllers/works_controller.ex` | 新增 | `index/2`, `create/2`, `show/2` |
| `apps/novel_web/lib/novel_web/router.ex` | 修改 | 新增 `/api/works` 三个路由 |
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | 修改 | join 接受 `work_id` 参数；assigns.work_id；user_message input 注入 work_id |
| `frontend/src/lib/works.ts` | 新增 | `listWorks`, `createWork`, `getCurrentWorkId`（localStorage） |
| `frontend/src/components/WorkspaceChat.tsx` | 修改 | 去 `mock_work_123`；启动 list；切换/新建 UI |
| `apps/novel_persistence/priv/repo/migrations/<date>_add_last_opened_to_works.exs` | 新增 | works 表加 `last_opened_at`（按时间排序最近一次） |

不动：`novel_foundation`, `novel_domain`, `novel_agent`, `novel_persistence/schemas/work.ex`（已存在）。

---

## 7. 已知风险

1. **work_id 与 workspace_id 语义重合**：当前代码两者混用（`workspace:<ws>` channel + works 表）。本 slice 沿用现有 workspace_id = work_id 一对一映射，避免引入新概念；后续如需多人协作再拆分。
2. **adoption boundary 的 work_id 透传**：现有 `AdoptionBoundary.evaluate` 不直接读 work_id；needed if cross-work artifact leakage 出现，则需在 §2 不变量 #1 上加补丁。先在 e2e 测试里覆盖，再决定是否补字段。
3. **前端无 Tauri 持久化**：MVP 用 localStorage 存 last_opened_work_id；后续接入 Tauri Filesystem 时再迁移。

---

## 8. 验收命令

```bash
# 后端
mix compile --warnings-as-errors
mix test apps/novel_persistence/test/.../work_repo_test.exs
mix test apps/novel_application/test/.../work_service_test.exs
mix test apps/novel_web/test/.../works_controller_test.exs
mix test apps/novel_web/test/.../workspace_channel_v3_test.exs
mix test apps/novel_e2e/test/.../work_switching_test.exs --include integration
mix test  # 全量
mix run scripts/arch_check.exs

# 前端
cd frontend && pnpm typecheck && pnpm lint && pnpm test

# 静态扫描
bash scripts/ai_static_scan.sh --top 10 --quick
```

---

## 9. 与现有 slice 的关系

- **依赖**：VS-00B（DialogueContext grounding，已 done）、VS-04（adoption boundary，已 done）。
- **解决**：GAP-WT-02（"作品档案"无内容）、GAP-AC-P0-5（SU-02 全套）的核心 7 场景。
- **不解决（留作下一 slice）**：SU-01 供应商 UI、SU-02 C3 未命名占位、SU-02 D2 不可用降级、`AdoptionBoundary` work_id 显式校验。
