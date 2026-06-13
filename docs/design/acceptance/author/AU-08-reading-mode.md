# AU-08 阅读我的作品

> 作者视角：经过和 AI 的多轮讨论、生成、采纳后，我有了真正的章节内容。我可以在一个干净的阅读模式里翻阅目录、逐章阅读，像看一本真正的书。当底层作品事实变更导致阅读投影过期时，系统会提醒我刷新，而不是把未采纳草稿或 mock 数据伪装成作品正文。

> 2026-05-13 场景化对账结论：`ReadingMode` 前端壳、模式切换、TOC 渲染、章节正文渲染和投影状态 banner 已有局部实现；`socket.ts` 有 `get_toc` / `get_chapter_content` helper，`socket.test.ts` 只验证 push 参数；但 `WorkspaceChannel.get_toc` 返回固定 mock 数据，`get_chapter_content` 没有 Channel handler，采纳后的作品事实没有接入真实 reading projection，ProjectionHint 也未转成可消费的 `projection_refs`。因此 AU-08 不能按“7/7 100% 已实现”判断。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 在工作台点击“阅读模式” | 切换到只读阅读视图，保留当前作品上下文 |
| 查看目录 | 看到当前作品已采纳的卷、章结构，不看到其他作品或 mock 内容 |
| 阅读章节正文 | 看到已采纳正文按章节、场景、自然段排版 |
| 看到空作品状态 | 新作品或未采纳内容时，明确提示暂无已采纳章节 |
| 看到投影过期 | 知道当前阅读视图可能落后于最新已采纳作品事实 |
| 刷新 / 重试投影 | 触发 read model 刷新，不绕过采纳边界写入作品事实 |
| 返回工作台 | 回到原工作台，会话输入和作品上下文不丢失 |

明确不能做的：

- 阅读模式不能编辑、采纳、放弃或写入作品事实。
- 未采纳的 `adoption_state.pending` 草稿不能进入 TOC 或正文。
- 不同作品的 TOC、正文、projection status 不能串数据。
- mock TOC 不能作为“有作品内容”的验收依据。
- ProjectionHint 不能被 UI 当成写入授权。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU08-I1 | 只有已采纳作品事实进入阅读投影 | SC-AU08-A1/A3 |
| AU08-I2 | 未采纳草稿不进入 TOC / 正文 | SC-AU08-A2 |
| AU08-I3 | 阅读模式只读，不能产生 production write | SC-AU08-D1 |
| AU08-I4 | TOC / 正文必须按当前 work_id 隔离 | SC-AU08-B3 |
| AU08-I5 | ProjectionHint 只触发刷新，不授权写入 | SC-AU08-C1/C2 |
| AU08-I6 | 过期/重建/失败状态必须作者可见 | SC-AU08-C1/C3/C4 |
| AU08-I7 | 缺数据或读取失败必须诚实显示 | SC-AU08-B2/C4 |
| AU08-I8 | 阅读模式不得展示 mock 数据为真实作品 | SC-AU08-A4 |

---

## 3. 契约引用

| 契约 / 代码 | 用途 |
|---|---|
| `docs/design/adr/ADR-0016-projection-hint-ui-v3.md` | ProjectionHint 只刷新、不写入的权威决策 |
| `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` | AdoptionDecision、ProjectionHint、adoption boundary |
| `docs/design/07-workbench-ui-contract.md` | Workbench / ReadingMode 消费 TurnResult 与 projection hints 的 UI 规则 |
| `frontend/src/components/ReadingMode.tsx` | 当前阅读模式前端实现 |
| `frontend/src/lib/store.ts` | `mode`、`projectionStatus`、`pendingBuildAction`、`channel` |
| `frontend/src/lib/socket.ts` | `getToc`、`getChapterContent` helper |
| `frontend/src/lib/__tests__/socket.test.ts` | helper push 参数测试 |
| `frontend/src/components/WorkspaceChat.tsx` | 切换阅读模式、接收 `projection_refs`、处理 pending build action |
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | 当前 `get_toc` mock handler；缺 `get_chapter_content` / projection refresh handler |
| `apps/novel_application/lib/novel_application/adoption_boundary.ex` | 当前可产生 projection_hints，但未接 TurnResult / ReadingMode |
| `apps/novel_domain/lib/novel_domain/projection_hint.ex` | ProjectionHint domain struct |
| `apps/novel_persistence/lib/novel_persistence/schemas/{volume,chapter,scene,draft}.ex` | 作品结构和草稿持久化基础 |

---

## 4. 验收场景

### 场景组 A：采纳内容进入阅读投影

#### SC-AU08-A1 — 采纳章节后阅读模式看到真实目录

**用户视角**：作者生成章节片段并采纳，然后点击“阅读模式”。

| 字段 | 内容 |
|---|---|
| 期望结果 | TOC 展示当前作品已采纳卷/章；章节来源能追到 accepted source revision |
| 当前证据 | `ReadingMode` 能渲染 `toc.volumes[].chapters[]`；`socket.ts.getToc` 会 push `get_toc` |
| 当前状态 | 前端局部实现，后端为 mock |
| 当前缺口 | `WorkspaceChannel.get_toc` 返回固定 `mock_work` / `vol_1` / `ch_1`，不读取当前 work_id 的已采纳内容 |
| 优先级 | P0 |

#### SC-AU08-A2 — 未采纳草稿不进入阅读模式

**用户视角**：作者让 AI 生成正文草稿，但没有点采纳，直接进入阅读模式。

| 字段 | 内容 |
|---|---|
| 期望结果 | 阅读模式显示空态或旧版已采纳内容，不出现 pending 草稿 |
| 当前证据 | AU-05 已证明 creative tool 默认产生 tentative artifact；`ReadingMode` 有空态文案 |
| 当前状态 | 局部证据 |
| 当前缺口 | TOC/正文仍是 mock，无法证明 pending/adopted 隔离；没有端到端验收 |
| 优先级 | P0 |

#### SC-AU08-A3 — 采纳正文后章节正文可读

**用户视角**：作者采纳一个场景正文后，在阅读模式点开对应章节。

| 字段 | 内容 |
|---|---|
| 期望结果 | 右侧正文显示章节标题、场景标题和自然段，不显示 JSON / ToolResult 原始结构 |
| 当前证据 | `ReadingMode` 有 chapter/scenes 渲染和段落 split 逻辑；`socket.ts.getChapterContent` helper 存在 |
| 当前状态 | 前端局部实现 |
| 当前缺口 | `WorkspaceChannel` 没有 `handle_in("get_chapter_content")`；真实章节正文无法通过当前 Channel 读取 |
| 优先级 | P0 |

#### SC-AU08-A4 — 不把 mock 目录当真实作品

**用户视角**：作者创建一个全新空作品，进入阅读模式。

| 字段 | 内容 |
|---|---|
| 期望结果 | 显示“暂无已采纳的章节内容”，不会出现“第一卷：起源 / 第一章：苏醒” |
| 当前证据 | `WorkspaceChannel.get_toc` 当前无论 payload 都返回固定 mock 目录 |
| 当前状态 | 已发现设计偏差 |
| 当前缺口 | 需要替换 mock handler，并增加空作品/有内容作品两个验收 |
| 优先级 | P0 |

### 场景组 B：阅读导航与上下文隔离

#### SC-AU08-B1 — 点击目录切换章节

**用户视角**：作者在目录里从第一章切到第二章。

| 字段 | 内容 |
|---|---|
| 期望结果 | 高亮章节更新，正文加载对应章节；失败时显示可理解错误或空态 |
| 当前证据 | `ReadingMode` `activeChapterId` 与 click handler 已实现 |
| 当前状态 | 前端局部实现 |
| 当前缺口 | 无真实 `get_chapter_content` handler；无加载失败 UI 文案测试 |
| 优先级 | P1 |

#### SC-AU08-B2 — 章节内容缺失时诚实显示

**用户视角**：TOC 中有章节，但该章节还没有已采纳正文。

| 字段 | 内容 |
|---|---|
| 期望结果 | 显示“该场景暂无已采纳正文”或章节空态，不编造正文 |
| 当前证据 | `ReadingMode` 对空 scene content 有占位文案 |
| 当前状态 | 前端局部实现 |
| 当前缺口 | 缺基于真实 scene/draft 状态的 backend response 和验收 |
| 优先级 | P1 |

#### SC-AU08-B3 — 作品切换后阅读内容隔离

**用户视角**：作者在作品 A 采纳章节，再切到作品 B 的阅读模式。

| 字段 | 内容 |
|---|---|
| 期望结果 | B 的 TOC/正文只显示 B 的已采纳内容；A 的章节不会出现 |
| 当前证据 | `WorkspaceChat` join 时传入 `work_id`；`getToc` payload 带 `work_id` |
| 当前状态 | 局部基础设施 |
| 当前缺口 | `WorkspaceChannel.get_toc` 忽略 payload；缺双作品隔离验收 |
| 优先级 | P0 |

#### SC-AU08-B4 — 返回工作台不丢上下文

**用户视角**：作者读完章节后返回工作台继续聊。

| 字段 | 内容 |
|---|---|
| 期望结果 | 当前作品、消息列表、输入草稿或会话状态按设计保留 |
| 当前证据 | `App.tsx` 按 `mode` 切换组件；`store.ts` 持有 `context`；`ReadingMode` 返回时 `setMode("workbench")` |
| 当前状态 | 前端局部实现 |
| 当前缺口 | `WorkspaceChat` 卸载/重挂载对 socket/messages/input 的保留未有自动化验收；是否丢消息需实际验证 |
| 优先级 | P1 |

### 场景组 C：投影刷新与状态

#### SC-AU08-C1 — 已采纳内容变化后提示投影过期

**用户视角**：作者采纳或修改作品事实后，阅读模式提示当前投影可能过期。

| 字段 | 内容 |
|---|---|
| 期望结果 | `projectionStatus=STALE` 时显示过期 banner 和刷新按钮 |
| 当前证据 | `ReadingMode` 支持 STALE banner；`WorkspaceChat` 可从 `projection_refs[0].refresh_status` 写入 store；`AdoptionBoundary` 能产生 projection_hints |
| 当前状态 | 多段局部实现 |
| 当前缺口 | `projection_hints` 未转成 TurnResult `projection_refs`；`AdoptionBoundary` projection_ref 硬编码 `character_list`；真实采纳链路未接阅读投影 |
| 优先级 | P0 |

#### SC-AU08-C2 — 刷新投影不写入作品事实

**用户视角**：作者点击“刷新投影”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 只重建 read model；不会创建、修改、采纳正文 |
| 当前证据 | ADR-0016 明确 ProjectionHint 只刷新、不写入；`ReadingMode` 只设置 `pendingBuildAction` 后回工作台 |
| 当前状态 | 设计已冻结，前端局部实现 |
| 当前缺口 | `WorkspaceChat` 把 refresh 转成普通文本“请刷新阅读投影”并走 `sendMessage`，不是专用 projection refresh action；缺 no-write 测试 |
| 优先级 | P0 |

#### SC-AU08-C3 — 重建中状态可见

**用户视角**：投影正在重建时，作者不需要猜系统是否卡住。

| 字段 | 内容 |
|---|---|
| 期望结果 | `REBUILDING` 显示重建中，不提供写入按钮 |
| 当前证据 | `ReadingMode` 有 REBUILDING banner |
| 当前状态 | 前端局部实现 |
| 当前缺口 | 后端没有真实 refresh job / status 流转；无 UI 自动化测试 |
| 优先级 | P1 |

#### SC-AU08-C4 — 重建失败可重试且不丢旧内容

**用户视角**：投影刷新失败，作者仍能读旧版本，并可以重试。

| 字段 | 内容 |
|---|---|
| 期望结果 | 显示失败 banner、可重试；旧阅读内容保留或明确标注不可用 |
| 当前证据 | `ReadingMode` 有 FAILED banner 和 retry 按钮 |
| 当前状态 | 前端局部实现 |
| 当前缺口 | 没有真实 failure 状态来源；重试同样变成普通文本消息；旧投影保留语义未实现/未验收 |
| 优先级 | P1 |

### 场景组 D：只读边界与真实用户入口

#### SC-AU08-D1 — 阅读模式不能编辑或采纳

**用户视角**：作者在阅读模式只读浏览。

| 字段 | 内容 |
|---|---|
| 期望结果 | 页面没有修改、采纳、放弃、确认写入等按钮；不会调用 adoption/write capability |
| 当前证据 | `ReadingMode` 当前仅有返回、刷新、重试、目录点击 |
| 当前状态 | 前端局部实现 |
| 当前缺口 | 缺 Playwright/组件测试证明阅读模式没有写入 action；refresh no-write 未闭环 |
| 优先级 | P1 |

#### SC-AU08-D2 — 无服务或 Channel 未就绪时阅读模式诚实降级

**用户视角**：后端断开或 Channel 尚未连接时，作者进入阅读模式。

| 字段 | 内容 |
|---|---|
| 期望结果 | 显示无法加载/离线状态，不误显示 mock 内容或空作品结论 |
| 当前证据 | `ReadingMode` 在无 channel/workId 时直接 return，不主动加载；catch 后 `setToc(null)` |
| 当前状态 | 局部实现但语义不足 |
| 当前缺口 | 无明确错误态；无法区分“空作品”和“加载失败” |
| 优先级 | P1 |

#### SC-AU08-D3 — 阅读模式真实入口可被作者发现

**用户视角**：作者在工作台顶部能清楚进入阅读模式。

| 字段 | 内容 |
|---|---|
| 期望结果 | 入口文案、位置、状态与设计一致，不依赖临时 `[阅读模式]` 文本按钮 |
| 当前证据 | `WorkspaceChat` 顶部有 `[阅读模式]` 按钮 |
| 当前状态 | 前端局部实现 |
| 当前缺口 | 按钮使用 inline style；是否符合当前 UI 设计和文案集中管理需另行验收 |
| 优先级 | P2 |

#### SC-AU08-D4 — 阅读模式有前端自动化验收

**用户视角**：每次改动后，团队能自动发现阅读模式断链。

| 字段 | 内容 |
|---|---|
| 期望结果 | Playwright/组件测试覆盖空作品、mock 禁止、TOC 切换、projection banner、返回工作台 |
| 当前证据 | `socket.test.ts` 只测 helper push 参数；未发现 `ReadingMode` 组件/浏览器测试 |
| 当前状态 | 未验收 |
| 当前缺口 | 缺真实 UI 自动化和 Tauri/浏览器 walkthrough 记录 |
| 优先级 | P1 |

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-AU08-A1 | 采纳后真实目录 | 前端局部实现，后端 mock | 否 |
| SC-AU08-A2 | 未采纳不进阅读模式 | 局部证据 | 否 |
| SC-AU08-A3 | 采纳正文可读 | 前端局部实现，后端缺 handler | 否 |
| SC-AU08-A4 | 不把 mock 当真实作品 | 已发现偏差 | 否 |
| SC-AU08-B1 | 点击目录切章节 | 前端局部实现 | 否 |
| SC-AU08-B2 | 空章节诚实显示 | 前端局部实现 | 否 |
| SC-AU08-B3 | 作品切换隔离 | 局部基础设施 | 否 |
| SC-AU08-B4 | 返回工作台保留上下文 | 前端局部实现 | 否 |
| SC-AU08-C1 | 已采纳变化提示 stale | 多段局部实现 | 否 |
| SC-AU08-C2 | 刷新投影 no-write | 设计已冻结，前端局部实现 | 否 |
| SC-AU08-C3 | 重建中状态 | 前端局部实现 | 否 |
| SC-AU08-C4 | 失败可重试 | 前端局部实现 | 否 |
| SC-AU08-D1 | 阅读模式只读 | 前端局部实现 | 否 |
| SC-AU08-D2 | 离线/加载失败降级 | 局部实现但语义不足 | 否 |
| SC-AU08-D3 | 作者可发现入口 | 前端局部实现 | 否 |
| SC-AU08-D4 | 自动化验收 | 未验收 | 否 |

**通过率：0/16 完整真实前后端验收；7/16 有局部证据。**

局部证据主要是：`ReadingMode` UI 壳、mode store、projection banner、socket helpers、socket helper tests、work_id payload、ProjectionHint domain/ADR。它们不能证明“作者采纳后的真实作品可阅读”。

---

## 6. 缺口

| 缺口 | 证据 | 建议处理 | 优先级 |
|---|---|---|---|
| AU08-GAP-01 — TOC 仍是 mock | `WorkspaceChannel.get_toc` 固定返回 `mock_work` | 接真实 reading projection / accepted source | P0 |
| AU08-GAP-02 — 章节正文读取缺后端入口 | 前端 push `get_chapter_content`，Channel 无 handler | 补 Channel/Application/Persistence 读取链路 | P0 |
| AU08-GAP-03 — 采纳到阅读投影未闭环 | AU-05 已记录 adoption handler / projection_refs 缺口 | 与 AU-05 合并成“生成->采纳->阅读”承重 slice | P0 |
| AU08-GAP-04 — ProjectionHint 未转前端可消费状态 | `AdoptionBoundary.projection_hints` 未接 `TurnResult.projection_refs` | 补 adapter 与测试 | P0 |
| AU08-GAP-05 — 刷新投影被转成普通聊天文本 | `WorkspaceChat` pending action 调 `sendMessage("请刷新阅读投影")` | 改为专用 author/system action，验证 no-write | P0 |
| AU08-GAP-06 — 跨作品阅读隔离未验收 | `get_toc` 忽略 payload | 双作品 TOC/正文/projection status 隔离测试 | P0 |
| AU08-GAP-07 — 空作品和加载失败不可区分 | `ReadingMode` catch 后 `setToc(null)` | 增加 loading/error/empty 三态 | P1 |
| AU08-GAP-08 — 阅读模式 UI 自动化缺失 | 未发现 `ReadingMode` 组件/浏览器测试 | 补组件/Playwright/Tauri walkthrough | P1 |
| AU08-GAP-09 — 阅读入口设计合规待核查 | `[阅读模式]` inline style 按钮 | 对齐当前 UI/文案规范 | P2 |

---

## 7. 证据强度说明

| 证据 | 能证明 | 不能证明 |
|---|---|---|
| `ReadingMode.tsx` | 有阅读模式前端壳、TOC/正文渲染、projection banner | 数据来自真实已采纳作品 |
| `socket.ts` / `socket.test.ts` | helper 会 push 指定事件和 payload | 后端事件存在或返回真实数据 |
| `WorkspaceChannel.get_toc` | 当前 Channel 有 TOC 入口 | 因为它返回 mock，反而证明真实阅读投影未接入 |
| `WorkspaceChannel` 缺 `get_chapter_content` | 前端章节读取会断链 | 不能说明未来没有设计，只说明当前实现未闭环 |
| `AdoptionBoundary` / `ProjectionHint` | domain/application 有 projection hint 雏形 | hint 已进入 TurnResult / ReadingMode |
| `WorkspaceChat` mode/projection 逻辑 | 前端能切换阅读模式并接收 `projection_refs` | 后端会产生正确 `projection_refs` 或刷新 action |

---

## 8. 验收命令

```bash
# 当前只有 helper 级测试，不足以验收 AU-08
cd frontend && pnpm test -- --run src/lib/__tests__/socket.test.ts

# 需要新增的最小验收：
# 1. 空作品进入阅读模式，不出现 mock 目录。
# 2. 采纳章节片段后，TOC/正文来自当前 work_id 的 accepted source。
# 3. 切换作品后，阅读模式不串 TOC/正文/projection status。
# 4. projection STALE/REBUILDING/FAILED 三态 UI 和 no-write refresh。
```
