# SU-02 切换作品

> 系统用户视角：我有多个小说项目（作品），可以在它们之间切换，每个作品有独立的对话上下文、设定和产出。切换作品就像切换项目文件：不会丢、不会串、不会把未完成请求写到错误作品。
>
> 2026-05-12 对账结论：VS-09 已推进 Work CRUD、启动时选择/创建 work、Channel `work_id` 透传；但“运行时作品切换 + 上下文隔离 + pending 请求隔离 + UI 验收”尚未闭环。不能再按旧文档判断为“仅 mock”，也不能把已有 CRUD 误判为完整作品切换。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 看当前在哪个作品里 | 顶部栏显示当前作品名，缺省作品也有可辨识名称 |
| 查看已有作品列表 | 展示数据库中已有作品，当前作品有选中状态 |
| 创建新作品 | 创建持久化 Work，并自动进入新作品上下文 |
| 快速开始一个未命名作品 | 没有作品时自动创建“未命名作品”，后续可区分、可改名 |
| 切换到另一个作品 | 离开旧 Channel，加入新 `workspace:{work_id}`，刷新该作品上下文 |
| 重新打开软件时回到上次作品 | 优先打开上次使用且仍存在的作品，否则回退到最新作品 |
| 切换时隔离数据和请求 | 旧作品消息、记忆、pending LLM 结果不会串到新作品 |
| 作品不可用时降级 | 不白屏、不无限 loading，提示用户选择其他作品或创建新作品 |

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| SU02-I1 | Work 身份必须来自持久化 Work id，不能继续依赖 mock work id | SC-SU02-A1、SC-SU02-B1、SC-SU02-D1 |
| SU02-I2 | 作品切换必须重新限定 Channel topic 和 `work_id` | SC-SU02-C1、SC-SU02-C2 |
| SU02-I3 | 不同作品的消息、上下文、记忆、产物和 pending 结果不能互相污染 | SC-SU02-C3、SC-SU02-C4 |
| SU02-I4 | 上次打开作品的恢复策略必须可重复、可降级、桌面优先 | SC-SU02-D1、SC-SU02-D2 |
| SU02-I5 | 未命名作品必须可辨识，且不阻塞创作 | SC-SU02-B2 |

---

## 3. 契约引用

| 契约 / 实现 | 用途 | 当前证据判断 |
|---|---|---|
| `NovelApplication.WorkService` | Work list/create/get/mark_opened 用例层 | 已实现并有 application 测试 |
| `NovelWeb.WorksController` | `GET /api/works`、`POST /api/works`、`GET /api/works/:id` | 已实现，web 层未直接访问 Repo |
| `frontend/src/lib/works.ts` | 前端 Work API 客户端、lastOpened 选择逻辑 | 已实现，`pickInitialWorkId` 有单测；lastOpened 仍用 `localStorage` |
| `WorkspaceChat.tsx` 启动流程 | 启动时 list works、选择 lastOpened/最新、无作品则创建“未命名作品”、join channel | 部分实现；只在 mount 时连接一次，没有运行时切换 |
| `WorkspaceChannel.join/3` | 从 topic/payload 注入 `workspace_id` 和 `work_id`，best-effort `mark_opened` | 已实现；join 任意 workspace 有测试 |
| `socket_v3.ts` / `socket.test.ts` | 前端发送消息和工具请求携带 `work_id` | 部分测试覆盖 |
| `docs/project-ledger.md` | VS-09 / GAP-WT-02 / GAP-AC-P0-5 当前状态 | 台账确认 CRUD 与 work_id pass-through 已推进，切换 UI/隔离 E2E 未闭环 |

---

## 4. 验收场景

### 场景组 A：查看和识别

#### SC-SU02-A1 — 当前作品名可见

**作为系统用户**，我进入工作台后能看到当前作品名，知道自己正在写哪部作品。

**前置条件**：后端可用，数据库中至少有一个 Work；或数据库为空。

**触发**：打开工作台。

**期望结果**：
- 顶部栏显示当前作品名；
- 若没有作品，系统自动创建并显示“未命名作品”；
- `SystemContext.workId/workTitle` 与实际加入的 `workspace:{work_id}` 一致；
- 不再出现 `mock_work_123` 这类固定 mock 身份。

**当前证据**：`WorkspaceChat.tsx` 启动时调用 `listWorks` / `createWork`，join `workspace:${workId}` 后 `setContext({ workId, workTitle })`。

**当前状态**：部分实现。

---

#### SC-SU02-A2 — 作品列表可见

**作为系统用户**，我能打开作品列表，看到所有已有作品，并识别当前作品。

**前置条件**：数据库中已有多个 Work。

**触发**：点击顶部作品区域或作品管理入口。

**期望结果**：
- 列出全部作品；
- 当前作品有选中状态；
- 作品按最近打开或更新时间排序；
- 失败时给出可理解提示。

**当前证据**：`GET /api/works`、`WorkService.list/0` 和 `listWorks()` 已存在；未发现用户可操作的作品列表 UI。

**当前状态**：部分实现。

---

### 场景组 B：创建作品

#### SC-SU02-B1 — 用户创建新作品

**作为系统用户**，我能主动创建一个新作品，创建成功后进入该作品。

**前置条件**：工作台已打开。

**触发**：在作品列表或作品管理入口点击“创建新作品”，填写名称并确认。

**期望结果**：
- `POST /api/works` 创建持久化 Work；
- 新作品成为当前作品；
- Channel 切换到 `workspace:{new_work_id}`；
- 新作品显示空白/欢迎状态，不继承旧作品消息。

**当前证据**：`WorkService.create/1`、`WorksController.create/2`、`createWork()` 已实现；UI 目前只在“启动且无作品”时自动创建。

**当前状态**：部分实现。

---

#### SC-SU02-B2 — 自动启动未命名作品

**作为系统用户**，首次打开软件时即使还没有作品名，也能先开始创作。

**前置条件**：数据库中没有 Work。

**触发**：打开工作台。

**期望结果**：
- 系统创建一个标题为“未命名作品”的 Work；
- 当前上下文使用该 Work id；
- 多个未命名作品可区分；
- 后续可以重命名，且不丢失已有对话和设定。

**当前证据**：`WorkspaceChat.tsx` 在 no works 时 `createWork({ title: "未命名作品" })`；`WorkService.create/1` 要求 title 存在。

**当前状态**：部分实现。自动创建已具备，区分多个未命名作品和重命名未实现。

---

### 场景组 C：运行时切换与隔离

#### SC-SU02-C1 — 选择并切换作品

**作为系统用户**，我从作品列表选择另一个作品后，工作台切换到该作品。

**前置条件**：数据库中至少有两个 Work，当前在作品 A。

**触发**：选择作品 B。

**期望结果**：
- 顶部标题切换为作品 B；
- `SystemContext.workId` 切换为 B；
- 消息、TOC、角色、统计等读取 B 的上下文；
- 切回 A 时 A 的上下文仍完整。

**当前证据**：启动时可选择初始 Work；未发现运行时选择作品并切换上下文的 UI/状态流。

**当前状态**：未实现。

---

#### SC-SU02-C2 — 切换作品时重新加入 Channel

**作为系统用户**，切换作品后 WebSocket Channel 必须从旧 topic 切到新 topic。

**前置条件**：当前已加入 `workspace:{work_a}`。

**触发**：切换到作品 B。

**期望结果**：
- 旧 channel leave；
- 新 channel join `workspace:{work_b}`；
- join payload 含 `work_id: work_b`；
- join 失败时保留明确错误状态，不把消息发到旧作品。

**当前证据**：`WorkspaceChannel.join/3` 支持 topic/payload `work_id`；`WorkspaceChat.tsx` effect 标注 “Only connect once”，没有 `workId` 依赖驱动的 rejoin。

**当前状态**：未实现。

---

#### SC-SU02-C3 — 消息和上下文按作品隔离

**作为系统用户**，我在作品 A 中聊出的角色、设定、消息，不会污染作品 B。

**前置条件**：作品 A、B 均存在；A 中已有消息/角色/设定。

**触发**：从 A 切到 B，继续对话或读取上下文。

**期望结果**：
- B 的消息列表不显示 A 的消息；
- B 的上下文召回不引用 A 的角色/设定；
- A/B 的 trace、artifact、projection 均以各自 `work_id` 归属；
- 有自动化或人工 walkthrough 证明。

**当前证据**：Channel 会注入 `work_id`；部分请求会透传 `work_id`。未发现双作品隔离 E2E/Playwright/人工验收记录。

**当前状态**：未实现验收。

---

#### SC-SU02-C4 — pending LLM 请求不跨作品污染

**作为系统用户**，我在作品 A 发起一轮 AI 回复后切到作品 B，A 的迟到结果不能落到 B。

**前置条件**：作品 A 有未完成 LLM 请求。

**触发**：请求未完成时切换到作品 B。

**期望结果**：
- A 的迟到 `turn_result` 不显示在 B；
- 若请求完成，结果只归属 A；
- 切回 A 可看到 A 的完成结果或明确取消状态；
- UI loading / task 状态不串作品。

**当前证据**：当前 channel join 模型有 `work_id`，但运行时切换未实现，也没有 pending 隔离测试。

**当前状态**：未实现。

---

### 场景组 D：恢复与降级

#### SC-SU02-D1 — 重启恢复上次打开作品

**作为系统用户**，我关闭软件后重新打开，系统回到上次使用的作品。

**前置条件**：至少有两个 Work，用户最后打开作品 B。

**触发**：重启应用。

**期望结果**：
- 若 B 仍存在，启动后打开 B；
- 若 B 不存在，回退到最新作品；
- `mark_opened` 影响排序；
- 恢复策略可被自动化测试复现。

**当前证据**：`pickInitialWorkId()` 有单测；`WorkspaceChannel.join/3` best-effort `mark_opened`；`setLastOpenedWorkId()` 使用 `localStorage`。

**当前状态**：部分实现。恢复选择逻辑有测试，但存储方式不符合 Desktop-First 约束，缺端到端验收。

---

#### SC-SU02-D2 — 上次作品不可用时优雅降级

**作为系统用户**，如果上次作品被删除、损坏或后端暂不可用，应用不会白屏。

**前置条件**：lastOpened 指向不存在或不可读取的 Work；或后端不可用。

**触发**：打开工作台。

**期望结果**：
- 不白屏、不无限 loading；
- 明确提示“上次作品无法加载”或进入作品选择/创建入口；
- 后端不可用时仍可显示受限工作台状态；
- 不把 `"lobby"` 持久化为真实作品污染后续恢复。

**当前证据**：`WorkspaceChat.tsx` catch 后以 `workId = "lobby"`、`workTitle = "未连接"` 渲染，并调用 `setLastOpenedWorkId(workId)`。

**当前状态**：未实现验收；存在把 fallback id 写入 lastOpened 的风险。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-SU02-A1 | 当前作品名可见 | 部分实现 | 否 |
| SC-SU02-A2 | 作品列表可见 | 部分实现 | 否 |
| SC-SU02-B1 | 用户创建新作品 | 部分实现 | 否 |
| SC-SU02-B2 | 自动启动未命名作品 | 部分实现 | 否 |
| SC-SU02-C1 | 选择并切换作品 | 未实现 | 否 |
| SC-SU02-C2 | 切换时重新加入 Channel | 未实现 | 否 |
| SC-SU02-C3 | 消息和上下文按作品隔离 | 未实现验收 | 否 |
| SC-SU02-C4 | pending LLM 请求不跨作品污染 | 未实现 | 否 |
| SC-SU02-D1 | 重启恢复上次打开作品 | 部分实现 | 否 |
| SC-SU02-D2 | 上次作品不可用时优雅降级 | 未实现验收 | 否 |

**覆盖结论：10 个场景；0/10 完整端到端验收；2/10 有局部自动化测试或后端基础设施；5/10 部分实现；5/10 未实现或未验收。**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| SU02-GAP-01 — 运行时作品切换 UI 缺失 | 用户无法主动从 A 切换到 B，作品管理停留在启动阶段 | P0：补作品列表/选择入口，并定义状态流 |
| SU02-GAP-02 — 切换时 leave/join Channel 缺失 | 即使有 UI，也无法保证消息发到新作品 | P0：让 workId 变化驱动 leave old channel + join new channel |
| SU02-GAP-03 — 跨作品消息/上下文隔离缺验收 | 串作品会污染小说事实、记忆和产物 | P0：新增双作品隔离 E2E 或 walkthrough case |
| SU02-GAP-04 — pending 请求隔离缺实现/验证 | 迟到结果可能显示在错误作品 | P0：定义取消/归属策略，并补自动化测试 |
| SU02-GAP-05 — 用户主动创建作品 UI 缺失 | 只有启动自动创建，不支持正常多作品工作流 | P1：补创建入口、校验和成功后切换 |
| SU02-GAP-06 — lastOpened 使用 `localStorage` | 违反 Desktop-First 方向，Tauri 数据迁移风险已在台账记录 | P1：迁移到 Tauri 合规存储或平台抽象 |
| SU02-GAP-07 — 未命名作品不可区分/不可重命名 | 多个未命名作品会误导用户，影响恢复与管理 | P1：补展示区分信息和 rename 能力 |
| SU02-GAP-08 — 不可用作品恢复 UX 不完整 | 后端不可用或旧 id 丢失时可能污染 lastOpened 或体验不明确 | P2：定义 fallback 状态，不持久化临时 `"lobby"` |
| SU02-GAP-09 — 作品详情/归档面板未接入 | Work CRUD 已有，但管理面板未形成完整操作面 | P2：与 GAP-WT-02 合并追踪 |

---

## 7. 现有基础设施

| 基础设施 | 位置 | 用途 | 风险 |
|---|---|---|---|
| Work 用例层 | `apps/novel_application/lib/novel_application/work_service.ex` | list/create/get/mark_opened | 仍是 Phase 1，不含 rename/delete/archive |
| Work HTTP API | `apps/novel_web/lib/novel_web/controllers/works_controller.ex` | 前端读取和创建作品 | 需补 controller 层验收时核查路由/错误形态 |
| Work 前端客户端 | `frontend/src/lib/works.ts` | list/create/lastOpened/pickInitial | lastOpened 用 `localStorage` |
| 启动去 mock | `frontend/src/components/WorkspaceChat.tsx` | 启动解析真实 Work，创建默认 Work，join Channel | 只执行一次，不支持 runtime 切换 |
| Channel work_id | `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | 把 `work_id` 注入主链输入 | 缺切换和双作品隔离验收 |
| WorkService 测试 | `apps/novel_application/test/novel_application/work_service_test.exs` | CRUD 与 mark_opened 基础证明 | 不覆盖 UI / Channel / E2E |
| pickInitial 测试 | `frontend/src/lib/__tests__/works.test.ts` | 恢复选择策略纯函数证明 | 不覆盖 Tauri 存储和重启 |

**当前完整目标数据流**：

```text
目标:
作品列表 API
→ 用户选择 / 创建 Work
→ frontend set current work
→ leave old workspace channel
→ join workspace:{work_id}
→ reset/load work-scoped messages/context/projection
→ pending result 只归属原 work
→ lastOpened 合规持久化

当前:
启动时 list/create Work
→ pick initial work
→ join workspace:{work_id}
→ setContext
→ 无运行时切换 UI / rejoin / 双作品隔离验收
```

---

## 8. 验收命令

```bash
# Work 用例层基础设施
mix test apps/novel_application/test/novel_application/work_service_test.exs

# Channel join / work_id 基础设施
mix test apps/novel_web/test/novel_web/channels/workspace_channel_test.exs

# 前端初始 work 选择纯函数
cd frontend && pnpm test -- works.test.ts
```

> 注意：上述命令只能证明现有基础设施，不证明 SU-02 完整验收通过。完整验收仍需补运行时切换 UI、Channel rejoin、双作品隔离和 pending 请求隔离场景。
