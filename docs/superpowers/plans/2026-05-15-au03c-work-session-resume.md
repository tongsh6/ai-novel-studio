# AU-03C 作品内会话恢复实现计划

> **给 agentic workers：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 增加作品内持久化会话模型，使桌面应用重开后自动回到上次 active session，恢复该 session 的完整对话，并从持久化恢复右侧工作台待处理事项。

**架构：** 新增 `work_sessions` 作为 `works` 下的持久化会话边界；为 `interactions`、`decision_traces`、adoption mutation 元数据补上 `session_id` 归属。Application 层提供 resume snapshot，Phoenix HTTP 与 WorkspaceChannel 消费它；React 在加入 channel 前加载 snapshot，渲染会话列表/搜索和完整 transcript。

**技术栈：** Elixir/Phoenix Umbrella、Ecto SQLite、Phoenix Channel、React/Tauri、Vitest、Tauri slice verifier。

---

## Slice 开始前 5 项

**Contract：** `WorkSession`、`SessionTranscript`、`WorkspaceResumeSnapshot`。

**Invariant：** 重开应用不能丢完整会话；历史 session 不能被原地继续写入；pending adoption 不能依赖 socket 内存。

**Boundary：** 本 slice 切穿 `novel_persistence → novel_application → novel_web → frontend/Tauri`；明确不修改 `novel_agent`。

**Consumer：** `WorkspaceChat` 启动恢复、会话列表/搜索、右侧工作台待处理事项。

**Proof：** Tauri 验证：创建作品会话 → 连聊多轮 → 生成 pending adoption → 关闭重开 → 自动回到同一 active session → 对话区完整恢复 → 右侧 pending 可采纳。

---

## 任务 1：持久化会话模型

**文件：**
- 新建：`apps/novel_persistence/lib/novel_persistence/schemas/work_session.ex`
- 新建：`apps/novel_persistence/lib/novel_persistence/work_session_repo.ex`
- 新建：`apps/novel_persistence/priv/repo/migrations/20260515000001_create_work_sessions.exs`
- 修改：`apps/novel_persistence/lib/novel_persistence/schemas/interaction.ex`
- 修改：`apps/novel_persistence/lib/novel_persistence/memory_log.ex`
- 测试：`apps/novel_persistence/test/novel_persistence/work_session_repo_test.exs`

- [ ] 先写测试：创建 session、按 work 列表、搜索 session、按 session 读取完整 transcript、为 work 自动创建 active session。
- [ ] 运行测试确认失败，失败原因应是模块/字段/函数不存在。
- [ ] 实现 schema、repo、migration、session-scoped interaction 查询。
- [ ] 运行 persistence 相关测试确认通过。

## 任务 2：Application 恢复服务

**文件：**
- 新建：`apps/novel_application/lib/novel_application/work_session_service.ex`
- 测试：`apps/novel_application/test/novel_application/work_session_service_test.exs`

- [ ] 先写测试：resume snapshot、完整 transcript 顺序、session 搜索、从持久化生成 pending adoption projection。
- [ ] 运行测试确认失败，失败原因应是服务不存在或 DTO 字段不存在。
- [ ] 实现服务 DTO 和 persistence 调用。
- [ ] 运行 application 相关测试确认通过。

## 任务 3：Web API 与 Channel 会话归属

**文件：**
- 新建：`apps/novel_web/lib/novel_web/controllers/work_sessions_controller.ex`
- 修改：`apps/novel_web/lib/novel_web/router.ex`
- 修改：`apps/novel_web/lib/novel_web/channels/workspace_channel.ex`
- 测试：`apps/novel_web/test/novel_web/controllers/work_sessions_controller_test.exs`
- 测试：`apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs`

- [ ] 先写测试：resume endpoint 返回 last active session；channel join/message/adopt 携带 `session_id`。
- [ ] 运行测试确认失败，失败原因应是路由/字段/行为不存在。
- [ ] 实现 controller、routes、channel assign 与消息记录。
- [ ] 运行 web 相关测试确认通过。

## 任务 4：前端恢复 UI

**文件：**
- 新建：`frontend/src/lib/sessions.ts`
- 修改：`frontend/src/components/WorkspaceChat.tsx`
- 修改：`frontend/src/lib/socket.ts`
- 测试：`frontend/src/lib/__tests__/sessions.test.ts`

- [ ] 先写测试：session DTO helper、resume/search URL 构造、空结果处理。
- [ ] 运行测试确认失败，失败原因应是 helper 不存在。
- [ ] 在 channel join 前加载 resume snapshot，渲染完整 transcript，增加会话列表/搜索，并将 `session_id` 传给 channel 消息。
- [ ] 运行 frontend test/typecheck/lint 确认通过。

## 任务 5：Slice 验证与台账

**文件：**
- 修改：`scripts/tauri_slice_verify.sh`
- 修改：`frontend/slice-verify/native-tauri-verifier.mjs`
- 修改：`frontend/slice-verify/native-tauri-verifier.test.mjs`
- 修改：`docs/project-ledger.md`
- 修改：`docs/design/acceptance/author/AU-03-context.md`

- [ ] 增加 `au03c-work-session-resume` Tauri 场景。
- [ ] 验证关闭/重开后恢复 last active session 的完整 transcript 和右侧待处理事项。
- [ ] 更新台账，说明当前重点推进事项和剩余 AU-03C 缺口。
- [ ] 运行完整后端、前端、静态扫描验证。
- [ ] 按主题分组提交，commit message 使用中文，并 push。
