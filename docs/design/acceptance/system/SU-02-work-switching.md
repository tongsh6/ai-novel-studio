# SU-02 切换作品

> 系统用户视角：我有多个小说项目（作品），可以在它们之间切换，每个作品有独立的对话上下文、设定和产出。切换作品就像切换项目文件：不会丢、不会串、不会把未完成请求写到错误作品。
>
> 2026-05-12 对账结论：VS-09 已推进 Work CRUD、启动时选择/创建 work、Channel `work_id` 透传；但“运行时作品切换 + 上下文隔离 + pending 请求隔离 + UI 验收”尚未闭环。不能再按旧文档判断为“仅 mock”，也不能把已有 CRUD 误判为完整作品切换。
>
> 2026-06-20 当前 checkout 复核：`WorkspaceChat` 已提供真实作品菜单、快速新建未命名作品、运行时切换、旧 channel leave / 新 `workspace:{work_id}` join，并用 `{token, workId}` 过滤旧连接迟到事件；`su02-work-switching` 外部 Tauri 验收可复跑，证明作者从真实工作台在作品 A 发送消息后，通过可见作品菜单创建/切换到作品 B，UI 上下文与新 channel work_id 一致，且 B 的消息流不显示 A 的消息。`su02-empty-start-unnamed-work` 证明空 Work 数据库启动会通过幂等 `ensure_initial` 创建单个真实“未命名作品”、join 真实 `work_id`，普通消息和重命名保持同一 Work，且多个未命名作品在菜单里可见区分。`su02-work-lifecycle-management` 外部 Tauri 验收证明作者可从真实作品菜单命名新增作品、重命名当前作品、经二次确认安全移出当前作品，并验证默认列表不再展示已移出作品。`su02-work-restart-recovery` 证明 reload 后会恢复仍存在的 lastOpened 作品；当 lastOpened 指向已安全移出的 `DISCARDED` Work 时，工作台回退到真实可用 Work、重新 join 对应 Channel，并替换 stale preference。`su02-pending-result-work-isolation` 进一步证明作品 A 的慢回复迟到结果不会污染作品 B，切回 A 后可恢复 A 的完成 turn。`su02-artifact-projection-trace-isolation` 证明源作品生成待确认正文草稿后切到目标作品不显示源作品 pending artifact，源作品采纳后阅读投影只出现在源作品，目标作品 TOC 仍为空，目标 why/trace 不带源作品 artifact/chapter 上下文。上述证据关闭 SU-02 的 P0/P1 文件级闭环；后端不可用 UX、恢复/归档管理入口、大列表和异常矩阵作为 P2 后续。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 看当前在哪个作品里 | 顶部栏显示当前作品名，缺省作品也有可辨识名称 |
| 查看已有作品列表 | 展示数据库中已有作品，当前作品有选中状态 |
| 快速新建作品 | 创建一个未命名 Work，并自动进入新作品上下文；多个未命名作品在菜单中可区分，后续仍可命名 |
| 命名新增作品 | 输入作品名创建持久化 Work，避免一串“未命名作品” |
| 修改作品名 | 在当前作品或作品菜单中修改名称，标题、列表、恢复策略同步更新 |
| 删除作品 | 经过确认后从默认作品列表移出；默认优先安全归档/废弃而不是物理删除 |
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
| SU02-I6 | 作品级 mutation 必须经 `novel_web → novel_application → novel_persistence`，不能由前端直接改持久化状态 | SC-SU02-B3/B4/B5 |
| SU02-I7 | 删除当前作品后必须切到另一个真实 Work 或创建新的未命名 Work，不能停在 `lobby` 或已删除 work_id | SC-SU02-B5、SC-SU02-D2 |

---

## 3. 契约引用

| 契约 / 实现 | 用途 | 当前证据判断 |
|---|---|---|
| `NovelApplication.WorkService` | Work list/create/get/mark_opened 用例层 | 已实现并有 application 测试 |
| `NovelWeb.WorksController` | `GET /api/works`、`POST /api/works`、`GET /api/works/:id` | 已实现，web 层未直接访问 Repo |
| Work lifecycle API | `PATCH /api/works/:id` 重命名；`POST /api/works/:id/discard` 安全移出作品 | 已实现，经 `NovelWeb.WorksController` → `NovelApplication.WorkService` → `NovelPersistence.WorkRepo`；重命名使用 `revision` 冲突保护，删除首版采用 `DISCARDED` 安全移出而非物理删除 |
| `frontend/src/lib/works.ts` | 前端 Work API 客户端、lastOpened 选择逻辑 | 已实现，`pickInitialWorkId` 有单测；Tauri 下 lastOpened 走 app config preference command，浏览器 fallback 才使用 `localStorage`；`lobby` 不会持久化 |
| `WorkspaceChat.tsx` 作品运行时 | 启动时 list works、选择 lastOpened/最新、无作品则通过幂等 `ensureInitialWork` 创建“未命名作品”；作品菜单支持刷新、选择已有作品、快速创建未命名作品、命名新增、重命名、安全移出和重复标题序号区分；`openWork` 关闭旧 socket/channel、重置 work-scoped runtime、恢复目标作品 session 并 join 新 channel | 已有空库启动、运行时切换、作品生命周期、重启恢复、慢回复迟到归属和 artifact/projection/trace 隔离真实 Tauri 证据；异常矩阵作为 P2 后续 |
| `WorkspaceChannel.join/3` | 从 topic/payload 注入 `workspace_id` 和 `work_id`，best-effort `mark_opened` | 已实现；join 任意 workspace 有测试 |
| `socket.ts` / socket tests | 前端发送消息和工具请求携带 `work_id` | 部分测试覆盖；历史 `历史旁路 socket helper` 旁路已退役删除 |
| `docs/project-ledger.md` | VS-09 / GAP-WT-02 / GAP-AC-P0-5 当前状态 | 台账确认 CRUD、work_id pass-through、运行时切换、生命周期、恢复和隔离 E2E 已推进到 SU-02 文件级闭环；管理/异常矩阵为 P2 后续 |

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

**当前证据**：`WorkspaceChat.tsx` 启动时调用 `listWorks` / `ensureInitialWork`，join `workspace:${workId}` 后 `setContext({ workId, workTitle })`；`su02-empty-start-unnamed-work` 证明空 Work 数据库启动后标题显示“未命名作品”，join 真实 `work_id`，不使用 `lobby/mock`。

**当前状态**：已验收。

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

**当前证据**：`GET /api/works`、`WorkService.list/0` 和 `listWorks()` 已存在；`WorkspaceChat` 顶栏作品菜单列出已有作品、标记当前作品并提供刷新按钮；`su02-work-switching` 从真实菜单选择/创建作品。

**当前状态**：最小真实前端闭环已补；排序、失败态和大列表管理仍未完整验收。

---

### 场景组 B：作品生命周期

#### SC-SU02-B1 — 快速新建未命名作品

**作为系统用户**，我能从作品菜单快速创建一个新作品，先进入创作，再稍后补作品名。

**前置条件**：工作台已打开。

**触发**：在作品列表或作品管理入口点击“新建作品”。

**期望结果**：
- `POST /api/works` 创建持久化 Work；
- 新作品成为当前作品；
- Channel 切换到 `workspace:{new_work_id}`；
- 新作品显示空白/欢迎状态，不继承旧作品消息。

**当前证据**：`WorkService.create/1`、`WorksController.create/2`、`createWork()` 已实现；`WorkspaceChat` 作品菜单提供“新建作品”，创建成功后调用 `openWork(created)` 进入新作品；`su02-work-switching` 覆盖真实菜单新建并切换。

**当前状态**：最小真实前端闭环已补；命名、校验、重命名和失败恢复仍未完整验收。

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

**当前证据**：启动 no works 时 `WorkspaceChat` 走 `ensureInitialWork({ title: "未命名作品" })`，后端 `WorkService.ensure_initial/1` 只在 active list 为空时创建，避免 StrictMode/重入导致重复自动创建；`duplicateWorkTitleIndex` + 作品菜单序号标签让多个同名“未命名作品”可见区分。`su02-empty-start-unnamed-work` 从无 seed 的真实 Tauri 工作台证明：空库启动后只有一个自动 Work、标题为“未命名作品”、消息发送和重命名保持同一 `work_id`、后续快速创建两个未命名作品时菜单显示“第 1 个 / 第 2 个”。

**当前状态**：已验收。

---

#### SC-SU02-B3 — 命名新增作品

**作为系统用户**，我能在创建作品时输入作品名，而不是只能得到“未命名作品”。

**前置条件**：工作台已打开，至少已有一个作品。

**触发**：在作品菜单点击“新建作品”，输入作品名并确认。

**期望结果**：
- 新作品以作者输入的标题创建；
- 标题经过 trim、非空校验和长度限制；
- 创建成功后切换到该作品并 join `workspace:{new_work_id}`；
- 作品列表中显示新标题，当前作品有选中状态；
- 创建失败时留在原作品，不清空原作品消息、pending、档案或阅读状态。

**当前证据**：后端 `POST /api/works` 支持传入 title；`WorkspaceChat` 作品菜单提供命名新增 dialog，创建成功后进入新 `work_id`；`su02-work-lifecycle-management` 从真实 Tauri 工作台输入作者提供的标题，并验证创建请求、当前标题和 channel work_id。

**当前状态**：最小真实前端闭环已补。失败态、批量管理和重启恢复矩阵仍待后续覆盖。

---

#### SC-SU02-B4 — 修改作品名

**作为系统用户**，我能把当前作品从“未命名作品”改成真实书名，并在所有工作台入口看到新名称。

**前置条件**：当前作品存在，且有稳定 `work_id`。

**触发**：在作品菜单或作品标题旁点击“重命名”，输入新作品名并保存。

**期望结果**：
- `PATCH /api/works/:id` 或等价 action 经 `WorkService` 更新 title；
- 更新使用 `revision` / optimistic lock 或等价冲突保护；
- 顶栏标题、作品列表、恢复后的当前作品名同步更新；
- 当前 channel 不换 work_id，消息、session、pending、档案和阅读状态不丢；
- 空白/过长名称被拒绝或规范化，失败时保留旧名称。

**当前证据**：`WorkRepo.rename/2`、`WorkService.rename/2`、`WorksController.update/2` 和 `frontend/src/lib/works.ts` `renameWork()` 已实现；`WorkspaceChat` 作品菜单提供重命名入口；`su02-work-lifecycle-management` 从真实 Tauri 工作台重命名当前作品，并验证 `work_id` 不变、标题同步和 revision 冲突保护的局部测试。

**当前状态**：最小真实前端闭环已补。并发冲突 UI、失败保留旧状态的完整可见反馈矩阵仍待后续覆盖。

---

#### SC-SU02-B5 — 删除或移出作品

**作为系统用户**，我能删除不再需要的作品，并确认不会误删正在创作的内容。

**前置条件**：至少有两个作品；其中一个为当前作品。

**触发**：在作品菜单对某个作品点击“删除”，阅读确认说明后确认。

**期望结果**：
- 删除必须二次确认，确认文案包含作品名；
- 第一版默认采用安全移出：将 Work 标记为 `DISCARDED`；如产品后续定义“归档”语义，再使用 `ARCHIVED`，不做不可恢复物理删除；
- 删除非当前作品时，当前作品和 channel 不变；
- 删除当前作品时，系统切换到另一个真实 Work；若没有其它 Work，则创建新的“未命名作品”并 join；
- 被删除作品不再作为 lastOpened 恢复目标；
- 相关会话、记忆、产物、阅读投影不得串到新作品；若后续支持恢复，必须重新进入显式恢复/选择流程。

**当前证据**：`WorkRepo.discard/1`、`WorkService.discard/2`、`WorksController.discard/2` 和 `frontend/src/lib/works.ts` `discardWork()` 已实现；`WorkspaceChat` 作品菜单提供删除确认 dialog，确认文案包含作品名；`su02-work-lifecycle-management` 从真实 Tauri 工作台安全移出当前作品，验证 fallback 到另一个真实 Work 或新未命名 Work，且默认作品列表不再包含已移出作品。

**当前状态**：最小真实前端闭环已补。重启后 lastOpened 不恢复已移出作品已有 `su02-work-restart-recovery` 证据；恢复/归档管理入口作为 P2 后续。

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

**当前证据**：`WorkspaceChat` `handleSelectWork` 从作品菜单调用 `openWork(work)`；`su02-work-switching` 证明真实页面可从作品 A 切换到作品 B，标题/上下文跟随新 work。

**当前状态**：最小真实前端闭环已补。

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

**当前证据**：`WorkspaceChannel.join/3` 支持 topic/payload `work_id`；`WorkspaceChat.openWork` 调用 `closeWorkspaceConnection()` 离开旧 channel/socket，再 `joinWorkspace(socket, "workspace:#{work.id}", %{work_id, session_id})`；`su02-work-switching` 证明切换后至少出现两个不同 `channel.join.done` work_id。

**当前状态**：最小真实前端闭环已补。

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

**当前证据**：Channel 会注入 `work_id`；`WorkspaceChat.openWork` 重置消息、session、pending adoption、阅读投影等 work-scoped runtime；`su02-work-switching` 证明切换到新作品后不显示旧作品消息；`au09-cross-work-memory-isolation` 已另证记忆/档案/why 不串作品；`su02-artifact-projection-trace-isolation` 从真实 Tauri 工作台证明源作品生成 `prose_fragment` pending artifact 后切到目标作品不显示源作品待确认草稿，源作品采纳后 `get_toc/get_chapter_content` 只在源 `work_id` 有已采纳章节内容，目标作品 TOC 仍为空，目标作品后续 why/trace 不带源作品 artifact/chapter 上下文。证据见 `artifacts/slice-verify/su02-artifact-projection-trace-isolation-tauri/summary.json`。

**当前状态**：已验收。角色/统计、大列表和异常失败态属于 P2 扩展矩阵，不阻塞 SU-02 文件级退出。

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

**当前证据**：`WorkspaceChat` 为每次 `openWork` 分配递增 token，并在 join 回调、`turn_result`、`task_state` handler 中用 `isCurrentWorkConnection({token, workId})` 过滤旧连接事件；`su02-work-switching` 最小证明切换后新作品消息流没有旧作品内容。`su02-pending-result-work-isolation` 进一步从真实 Tauri 工作台发送作品 A 慢回复、在完成前切到作品 B，验证 A 的 `channel.user_message.done` 仍在原 `work_id`，B 不显示 A 的 user/assistant 文本且不残留 loading，切回 A 后 transcript 恢复完成 turn。

**当前状态**：已验收。artifact/projection/trace 已由 C3 的 `su02-artifact-projection-trace-isolation` 覆盖。

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

**当前证据**：`pickInitialWorkId()` 有单测；`WorkspaceChannel.join/3` best-effort `mark_opened`；`setLastOpenedWorkId()` 在 Tauri 下写 app config preference，浏览器 fallback 才写 `localStorage`；`su02-work-restart-recovery` 证明作者从真实工作台选择作品 B 后，reload 会恢复 B 并重新 join `workspace:{work_b}`。

**当前状态**：最小真实前端闭环已补。OS-level preference 文件读写和完整进程重启矩阵仍待后续覆盖。

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

**当前证据**：`WorkspaceChat.tsx` 启动失败时使用 `workId = null`、`workTitle = "作品加载失败"`，不会把 `lobby` 写入当前上下文；`shouldPersistLastOpenedWorkId()` 拒绝 `lobby`；`su02-work-restart-recovery` 证明 stale lastOpened 指向 `DISCARDED` Work 时，默认列表过滤该 Work，并回退到真实可用 Work 重新 join。

**当前状态**：stale/discarded lastOpened 降级最小真实前端闭环已补。后端完全不可用、损坏数据和恢复/归档管理入口仍待后续覆盖。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-SU02-A1 | 当前作品名可见 | 已有最小真实前端闭环 | 是（最小） |
| SC-SU02-A2 | 作品列表可见 | 已有最小真实前端闭环 | 是（最小） |
| SC-SU02-B1 | 快速新建未命名作品 | 已有最小真实前端闭环 | 是（最小） |
| SC-SU02-B2 | 自动启动未命名作品 | 真实 Tauri 闭环已补 | 是 |
| SC-SU02-B3 | 命名新增作品 | 已有最小真实前端闭环 | 是（最小） |
| SC-SU02-B4 | 修改作品名 | 已有最小真实前端闭环 | 是（最小） |
| SC-SU02-B5 | 删除或移出作品 | 已有最小真实前端闭环 | 是（最小） |
| SC-SU02-C1 | 选择并切换作品 | 已有最小真实前端闭环 | 是（最小） |
| SC-SU02-C2 | 切换时重新加入 Channel | 已有最小真实前端闭环 | 是（最小） |
| SC-SU02-C3 | 消息和上下文按作品隔离 | 已验收 | 是 |
| SC-SU02-C4 | pending LLM 请求不跨作品污染 | 已验收 | 是 |
| SC-SU02-D1 | 重启恢复上次打开作品 | 最小真实前端闭环已补 | 是（最小） |
| SC-SU02-D2 | 上次作品不可用时优雅降级 | stale/discarded lastOpened 降级最小闭环已补 | 是（最小） |

**覆盖结论：13 个场景；13/13 已验收。SU-02 当前达到文件级可交付状态，可进入 SU-03；后端不可用 UX、恢复/归档管理、大列表/异常失败态和 OS-level preference 进程级矩阵作为 P2 后续。**

### 5.1 文件级对账矩阵

| 场景 ID / 名称 | 设计期望 | Contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / slice |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-SU02-A1 当前作品名可见 | 顶栏显示真实当前作品名，context 与 channel work_id 一致 | SU02-I1/I2 | `WorkspaceChat.openWork`、`WorkService.list/create`、`WorkspaceChannel.join` | `works.test.ts`、`work_service_test.exs`、`workspace_channel_test.exs` | `su02-work-switching`、`su02-work-restart-recovery` summary | 已验收 | 无 | 无 | P0 | 保持现有回归 |
| SC-SU02-A2 作品列表可见 | 可见作品列表、当前选中、失败提示 | SU02-I1/I4 | `GET /api/works`、作品菜单、`handleRefreshWorks` | `works_controller_test.exs`、`work_service_test.exs` | `su02-work-switching`、`su02-work-lifecycle-management` summary | 已验收 | 大列表/失败态未深验 | 覆盖矩阵 | P2 | 后续 work management matrix |
| SC-SU02-B1 快速新建未命名作品 | 创建持久化 Work 并切入新 `workspace:{id}`，不继承旧消息 | SU02-I1/I2/I3/I5 | `createWork`、`handleCreateUnnamedWork`、`openWork` | `works.test.ts`、Work API tests | `su02-work-switching` summary | 已验收 | 无 | 无 | P0 | 保持现有回归 |
| SC-SU02-B2 自动启动未命名作品 | 空库启动自动创建未命名作品，可区分并后续重命名 | SU02-I1/I5 | `loadWorksAndOpenInitial`、`ensureInitialWork`、`WorkService.ensure_initial`、重复标题菜单标签 | `work_service_test.exs`、`works_controller_test.exs`、`works.test.ts`、`workspaceRuntimeState.test.ts` | `su02-empty-start-unnamed-work` summary | 已验收 | 无 | 无 | P0 | 保持现有回归 |
| SC-SU02-B3 命名新增作品 | 作者输入标题创建并切入新作品，失败不破坏原作品 | SU02-I1/I6 | `WorksController.create`、`WorkService.create`、命名新增 dialog | Work API / service tests、title helper tests | `su02-work-lifecycle-management` summary | 已验收 | 创建失败可见矩阵未深验 | 覆盖矩阵 | P2 | lifecycle failure matrix |
| SC-SU02-B4 修改作品名 | revision 保护改名，不换 work_id，不丢消息/session | SU02-I6 | `WorkRepo.rename`、`WorkService.rename`、`renameWork`、重命名 dialog | `work_service_test.exs`、`works_controller_test.exs`、`works.test.ts` | `su02-work-lifecycle-management` summary | 已验收 | 并发冲突 UI 未深验 | 覆盖矩阵 | P2 | lifecycle failure matrix |
| SC-SU02-B5 删除或移出作品 | 二次确认安全移出，当前作品删除后 fallback 到真实 Work | SU02-I4/I6/I7 | `WorkRepo.discard`、`WorkService.discard`、`discardWork`、删除确认 dialog | Work API / service tests | `su02-work-lifecycle-management`、`su02-work-restart-recovery` summary | 已验收 | 恢复/归档管理入口未定义 | 产品入口缺口 | P2 | archive/recovery management |
| SC-SU02-C1 选择并切换作品 | 标题/context/session 切到 B，切回 A 仍完整 | SU02-I2/I3 | `handleSelectWork`、`openWork`、`resumeWorkspace` | `isCurrentWorkConnection` 单测 | `su02-work-switching`、`su02-pending-result-work-isolation`、`su02-artifact-projection-trace-isolation` summary | 已验收 | 角色/统计扩展矩阵未深验 | 覆盖矩阵 | P2 | work management extended matrix |
| SC-SU02-C2 切换时重新加入 Channel | leave old channel，join new `workspace:{work_id}` | SU02-I2 | `closeWorkspaceConnection`、`joinWorkspace`、`WorkspaceChannel.join` | `workspace_channel_test.exs` | `su02-work-switching` summary | 已验收 | join 失败 UI 未深验 | 覆盖矩阵 | P2 | rejoin failure matrix |
| SC-SU02-C3 消息和上下文按作品隔离 | 消息、上下文、记忆、产物、trace、projection 不串作品 | SU02-I3 | `openWork` reset runtime、WorkSession resume、archive/memory/projection services | `adoption_workflow_test.exs`、`adoption_boundary_test.exs`、`reading_projection_service_test.exs`、`trace_summary_ref_test.exs`、`trace_writer_test.exs`、persistence adoption/reading/trace repo tests、`workspace_channel_v3_test.exs` | `su02-work-switching` 证明消息；`au09-cross-work-memory-isolation` 证明记忆/档案/why；`su02-artifact-projection-trace-isolation` 证明 pending artifact、采纳后 reading projection、目标 why/trace 均按 `work_id` 隔离 | 已验收 | 角色/统计扩展矩阵未深验 | 覆盖矩阵 | P2 | 后续 extended isolation matrix |
| SC-SU02-C4 pending LLM 请求不跨作品污染 | A 慢回复迟到不显示到 B，切回 A 可恢复完成结果 | SU02-I3 | `isCurrentWorkConnection`、`WorkspaceChannel`、`WorkSessionService.resume` | `slice_verify_test.exs`、`native-tauri-verifier.test.mjs` | `su02-pending-result-work-isolation` summary | 已验收 | 无 | 无 | P0 | 保持现有回归 |
| SC-SU02-D1 重启恢复上次打开作品 | lastOpened 仍存在时恢复该 Work 并 rejoin | SU02-I4 | `getLastOpenedWorkId`、`setLastOpenedWorkId`、`pickInitialWorkId` | `works.test.ts` | `su02-work-restart-recovery` summary | 已验收 | OS-level preference 文件读写未单独验 | 覆盖矩阵 | P2 | desktop preference matrix |
| SC-SU02-D2 上次作品不可用时优雅降级 | stale/discarded lastOpened 不恢复，后端不可用不白屏 | SU02-I4/I7 | `pickInitialWorkId`、`shouldPersistLastOpenedWorkId`、startup failure UI | `works.test.ts` | `su02-work-restart-recovery` summary | 已验收 | 后端完全不可用/损坏数据 UX 未深验 | 覆盖矩阵 | P2 | backend unavailable UX matrix |

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| SU02-GAP-01 — 运行时作品切换 UI 缺失 | 已补最小闭环：顶栏作品菜单可选择已有作品并切换 | 后续补大列表、失败态、搜索/归档等管理矩阵 |
| SU02-GAP-02 — 切换时 leave/join Channel 缺失 | 已补最小闭环：`openWork` 关闭旧连接并 join 新 `workspace:{work_id}` | 保持 `su02-work-switching` 作为回归；后续补断线/失败 rejoin 矩阵 |
| SU02-GAP-03 — 跨作品消息/上下文隔离缺验收 | 已补齐：消息流不串、AU09 已证明记忆/档案/why 不串，`su02-artifact-projection-trace-isolation` 已证明 artifact/projection/trace 不串作品 | 保持回归；角色/统计扩展矩阵作为 P2 |
| SU02-GAP-04 — pending 请求隔离缺实现/验证 | 已补齐：`su02-pending-result-work-isolation` 证明作品 A 慢回复完成在原 `work_id`，作品 B 不显示 A 文本且不残留 loading，切回 A 后恢复完成 turn | 保持该 slice 回归 |
| SU02-GAP-05 — 快速创建作品 UI 只到未命名最小闭环 | 已补最小闭环：作品菜单提供“新建作品”命名创建和“快速新建未命名作品”两个入口，创建后进入新作品 | 后续补创建失败、大列表和重启恢复矩阵 |
| SU02-GAP-05A — 空库启动未命名作品缺真实证据 | 已补齐：`su02-empty-start-unnamed-work` 证明空库启动通过幂等 ensure initial 创建单个真实未命名 Work，重命名保留消息，重复未命名作品可见区分 | 保持该 slice 回归 |
| SU02-GAP-06 — 命名新增作品最小闭环 | 已补最小闭环：作品菜单命名新增，保存后进入新 Work | 保持 `su02-work-lifecycle-management` 回归；后续补创建失败/大列表/重启矩阵 |
| SU02-GAP-07 — 修改作品名最小闭环 | 已补最小闭环：`PATCH /api/works/:id`、WorkService rename、前端重命名入口和真实 Tauri 验收 | 后续补并发冲突 UI、失败态和恢复后标题同步矩阵 |
| SU02-GAP-08 — 删除或移出作品最小闭环 | 已补最小闭环：安全废弃、二次确认、默认列表过滤、删除当前作品后的 fallback，以及 stale/discarded lastOpened reload 降级 | 后续补恢复/归档管理入口和异常矩阵 |
| SU02-GAP-09 — lastOpened 使用 `localStorage` | 已纠偏：Tauri 下使用 app config preference command，浏览器 fallback 才使用 `localStorage`；`su02-work-restart-recovery` 已补 reload 恢复证据 | 后续补 OS-level preference 文件读写/真实进程重启矩阵 |
| SU02-GAP-10 — 不可用作品恢复 UX 不完整 | stale/discarded lastOpened 已能回退到真实 Work，且不持久化 `lobby`；后端完全不可用/损坏数据 UX 仍未完整覆盖 | P2：定义后端不可用和损坏数据的可见降级状态 |
| SU02-GAP-11 — 作品详情/归档面板未接入 | Work CRUD 已有，但管理面板未形成完整操作面 | P2：与 GAP-WT-02 合并追踪 |

---

## 7. 现有基础设施

| 基础设施 | 位置 | 用途 | 风险 |
|---|---|---|---|
| Work 用例层 | `apps/novel_application/lib/novel_application/work_service.ex` | list/create/get/mark_opened/rename/discard | rename/discard 已有局部测试；恢复/归档管理策略待后续 |
| Work HTTP API | `apps/novel_web/lib/novel_web/controllers/works_controller.ex` | 前端读取、创建、重命名和安全移出作品 | 已有 update/discard 路由和错误形态；归档/恢复不是首版能力 |
| Work 前端客户端 | `frontend/src/lib/works.ts` | list/create/rename/discard/lastOpened/pickInitial | 已有 title 校验 helper、rename/discard API；Tauri preference command + browser fallback；`lobby` 不持久化 |
| 启动去 mock | `frontend/src/components/WorkspaceChat.tsx` | 启动解析真实 Work，创建默认 Work，join Channel；已有运行时选择、快速创建、命名新增、重命名、安全移出入口 | 完整失败态和重启恢复矩阵待补 |
| Channel work_id | `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | 把 `work_id` 注入主链输入 | 缺切换和双作品隔离验收 |
| WorkService 测试 | `apps/novel_application/test/novel_application/work_service_test.exs` | CRUD 与 mark_opened 基础证明 | 不覆盖 UI / Channel / E2E |
| pickInitial 测试 | `frontend/src/lib/__tests__/works.test.ts` | 恢复选择策略纯函数证明 | 不覆盖 Tauri 存储和重启 |

**当前完整目标数据流**：

```text
目标:
作品列表 API
→ 用户选择 / 创建 / 重命名 / 删除 Work
→ frontend set current work
→ leave old workspace channel
→ join workspace:{work_id}
→ reset/load work-scoped messages/context/projection
→ pending result 只归属原 work
→ lastOpened 合规持久化

当前:
启动时 list/ensureInitial Work
→ pick initial work
→ join workspace:{work_id}
→ setContext
→ 运行时作品菜单可选择/创建 Work
→ openWork 关闭旧 channel/socket 并 join workspace:{work_id}
→ token + workId 过滤旧连接迟到事件
→ su02-work-switching 已证明最小真实页面闭环
→ su02-work-lifecycle-management 已证明命名新增 / 重命名 / 删除安全流
→ su02-work-restart-recovery 已证明 reload 恢复 lastOpened 和 stale/discarded lastOpened 降级
→ su02-pending-result-work-isolation 已证明慢回复迟到不污染目标作品且切回源作品可恢复
→ su02-empty-start-unnamed-work 已证明空库启动、重命名保留消息和重复未命名可区分
→ su02-artifact-projection-trace-isolation 已证明 artifact / reading projection / trace/why 均按 work_id 隔离
→ SU-02 P0/P1 文件级闭环完成，P2 异常矩阵后续处理
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

# 运行时作品切换最小真实 Tauri 闭环
bash scripts/tauri_slice_verify.sh su02-work-switching
bash scripts/quality_accept.sh su02-work-switching --surface tauri

bash scripts/tauri_slice_verify.sh su02-empty-start-unnamed-work
bash scripts/quality_accept.sh su02-empty-start-unnamed-work --surface tauri

bash scripts/tauri_slice_verify.sh su02-work-lifecycle-management
bash scripts/quality_accept.sh su02-work-lifecycle-management --surface tauri

bash scripts/tauri_slice_verify.sh su02-work-restart-recovery
bash scripts/quality_accept.sh su02-work-restart-recovery --surface tauri

bash scripts/tauri_slice_verify.sh su02-pending-result-work-isolation
bash scripts/quality_accept.sh su02-pending-result-work-isolation --surface tauri

bash scripts/tauri_slice_verify.sh su02-artifact-projection-trace-isolation
bash scripts/quality_accept.sh su02-artifact-projection-trace-isolation --surface tauri
```

> 注意：上述命令证明 SU-02 当前 P0/P1 文件级闭环；后端不可用 UX、恢复/归档管理入口、大列表、异常失败态和 OS-level preference 进程级矩阵仍登记为 P2 后续。
