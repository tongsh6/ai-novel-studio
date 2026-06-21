# AU-08 阅读我的作品

> 作者视角：经过和 AI 的多轮讨论、生成、采纳后，我有了真正的章节内容。我可以在一个干净的阅读模式里翻阅目录、逐章阅读，像看一本真正的书。当底层作品事实变更导致阅读投影过期时，系统会提醒我刷新，而不是把未采纳草稿或 mock 数据伪装成作品正文。

> 2026-06-21 文件级复核：2026-05-13 “`get_toc` 仍是 mock / 缺 `get_chapter_content` / 采纳未接 Reading Projection” 的结论已被当前 checkout 的实现和证据取代。`WorkspaceChannel.get_toc` / `get_chapter_content` 现在经 `NovelApplication.ReadingProjectionService` 读取 `NovelPersistence.ReadingProjectionRepo` 的当前 `work_id` 已采纳事实；正文采纳、编辑后采纳、未采纳不入阅读、跨作品隔离、多章导航、空章诚实显示、字数审计和导出均有真实 Tauri driver，且 5 个 P1 Reading Projection 场景已挂入 `quality_accept.sh --surface tauri` 并复跑通过。剩余未闭合项集中在 Projection refresh job/status machine（专用 refresh action、REBUILDING/FAILED 真实来源）和阅读模式异常降级细节，登记为 P1/P2 后续，不阻塞 AU-08 核心文件级交付。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 在工作台点击“阅读模式” | 切换到只读阅读视图，保留当前作品上下文 |
| 查看目录 | 看到当前作品已采纳的卷、章结构，不看到其他作品或 mock 内容 |
| 阅读章节正文 | 看到已采纳正文按章节、场景、自然段排版 |
| 看到空作品或空章节状态 | 新作品、未采纳内容或未写章节明确提示暂无已采纳正文 |
| 看到投影过期 | 采纳后 `projection_refs.refresh_status=STALE` 会在阅读模式显示过期 banner |
| 刷新 / 重试投影 | 目标语义是触发 read model 刷新且不写作品事实；专用 refresh job/status machine 仍是 P1 后续 |
| 返回工作台 | 回到原工作台，当前作品上下文不丢失 |

明确不能做的：

- 阅读模式不能编辑、采纳、放弃或确认写入作品事实。
- 未采纳的 `adoption_state.pending` 草稿不能进入 TOC 或正文。
- 不同作品的 TOC、正文、projection status 不能串数据。
- mock TOC 不能作为“有作品内容”的验收依据。
- ProjectionHint 不能被 UI 当成写入授权。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU08-I1 | 只有已采纳作品事实进入阅读投影 | `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept` |
| AU08-I2 | 未采纳草稿不进入 TOC / 正文 | `p1-chapter-draft-generation`、`au02-unadopted-candidate-no-reading-fact` |
| AU08-I3 | 阅读模式只读，不能产生 production write | ReadingMode 实现 + refresh P1 后续 no-write driver |
| AU08-I4 | TOC / 正文必须按当前 `work_id` 隔离 | `su02-artifact-projection-trace-isolation` |
| AU08-I5 | ProjectionHint 只触发刷新，不授权写入 | ADR-0016、VS-04；专用 refresh action 仍为 P1 |
| AU08-I6 | 过期/重建/失败状态必须作者可见 | STALE 已验收；REBUILDING/FAILED 仍为 P1 |
| AU08-I7 | 缺数据或读取失败必须诚实显示 | 空作品/空章节已验收；离线/失败细节 P1 |
| AU08-I8 | 阅读模式不得展示 mock 数据为真实作品 | Channel/repo 测试 + 空投影 Tauri evidence |

---

## 3. 契约引用

| 契约 / 代码 | 用途 |
|---|---|
| `docs/design/adr/ADR-0016-projection-hint-ui-v3.md` | ProjectionHint 只刷新、不写入的权威决策 |
| `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` | AdoptionDecision、ProjectionHint、adoption boundary |
| `docs/design/07-workbench-ui-contract.md` | Workbench / ReadingMode 消费 TurnResult 与 projection hints 的 UI 规则 |
| `docs/design/ui/44-reading-mode.md` | ReadingMode UI 与状态设计 |
| `frontend/src/components/ReadingMode.tsx` | 阅读模式前端实现 |
| `frontend/src/components/WorkspaceChat.tsx` | 切换阅读模式、接收 `projection_refs`、处理 pending build action |
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | `get_toc` / `get_chapter_content` / `export_work` Channel 入口 |
| `apps/novel_application/lib/novel_application/reading_projection_service.ex` | Application 层 Reading Projection 读服务 |
| `apps/novel_persistence/lib/novel_persistence/reading_projection_repo.ex` | 当前 `work_id` 已采纳卷章、正文、字数和 audit 读模型 |
| `quality/acceptance/scenarios/p1-chapter-adoption-reading.yml` | 采纳正文进入阅读投影 quality 入口 |
| `quality/acceptance/scenarios/p1-chapter-expansion-multichapter.yml` | 多章导航与空章诚实显示 quality 入口 |

---

## 4. 场景对账矩阵

| 场景 ID / 名称 | 设计期望 | Contract / Invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / slice |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU08-A1 采纳章节后阅读模式看到真实目录 | TOC 展示当前作品已采纳卷/章 | AU08-I1/I4 | `WorkspaceChannel.get_toc` → `ReadingProjectionService.toc/1` | `reading_projection_repo_test.exs`、`workspace_channel_v3_test.exs` | `p1-chapter-adoption-reading-tauri` | 已验收 | 无 | 无 | - | 保持 quality regression |
| SC-AU08-A2 未采纳草稿不进入阅读模式 | pending 草稿不进 TOC/正文 | AU08-I2/I8 | `ReadingProjectionRepo.toc/1` 只统计 accepted draft | repo/channel tests | `p1-chapter-draft-generation-tauri`、`au02-unadopted-candidate-no-reading-fact-tauri` | 已验收 | 无 | 无 | - | 保持 quality regression |
| SC-AU08-A3 采纳正文后章节正文可读 | 正文显示章节标题、有效场景标题和自然段 | AU08-I1/I7 | `get_chapter_content` → `ReadingProjectionRepo.chapter_content/2` | repo/channel/service tests | `p1-chapter-adoption-reading-tauri`、`p1-chapter-edit-then-accept-tauri` | 已验收 | 无 | 无 | - | 保持 quality regression |
| SC-AU08-A4 不把 mock 目录当真实作品 | 空作品/无采纳内容显示空态 | AU08-I2/I8 | `ReadingProjectionRepo.toc/1` invalid/empty work 返回空 TOC | `get_toc returns an empty real projection...`、repo empty tests | `au02-unadopted-candidate-no-reading-fact-tauri` | 已验收 | 无 | 无 | - | 保持 quality regression |
| SC-AU08-B1 点击目录切换章节 | 点击 TOC 章节后正文加载对应章节 | AU08-I4/I7 | `ReadingMode.activeChapterId` + `getChapterContent` | frontend runtime tests 间接覆盖状态派生 | `p1-chapter-expansion-multichapter-tauri` 点击第 2/3 章 | 已验收 | 无 | 无 | - | 本轮补强 driver |
| SC-AU08-B2 章节内容缺失时诚实显示 | TOC 有章节但无已采纳正文时显示空章 | AU08-I7/I8 | `ReadingMode` `READING.emptyChapterBody`；repo 返回空 scenes | repo structural chapter tests | `p1-chapter-expansion-multichapter-tauri` 点击第 4 章空态 | 已验收 | 无 | 无 | - | 本轮补强 driver |
| SC-AU08-B3 作品切换后阅读内容隔离 | B 作品不显示 A 的 TOC/正文 | AU08-I4 | Channel work topic + repo `work_id` scope | repo cross-work tests | `su02-artifact-projection-trace-isolation-tauri` | 已验收 | 无 | 无 | - | 保持 SU-02 regression |
| SC-AU08-B4 返回工作台不丢上下文 | 从阅读返回工作台保留当前作品/会话 | AU08-I4 | `App.tsx` hidden workbench + `ReadingMode` `setMode("workbench")` | 前端实现可读，暂无专项测试 | 多个 driver 可从工作台进入阅读；缺返回后输入继续专项断言 | 已实现未验收 | 无明确偏差 | 验收缺口 | P1 | `au08-reading-return-context` 后续 |
| SC-AU08-C1 已采纳内容变化后提示 stale | `projectionStatus=STALE` 显示过期 banner 和刷新按钮 | AU08-I5/I6 | `AdoptionWorkflow.projection_refs/5`、`WorkspaceChat.handleTurnResult`、`ReadingMode` banner | `adoption_workflow_test.exs` projection refs | `p1-chapter-adoption-reading-tauri` | 已验收 | `STALE` 现在随采纳投影发出，后续 refresh job 未完成 | 后续增强 | P1 | Projection job/status machine |
| SC-AU08-C2 刷新投影不写入作品事实 | 点击刷新只重建 read model，不写 production state | AU08-I3/I5 | `ReadingMode.setPendingBuildAction`；`WorkspaceChat` 发送普通文本 | ADR/contract 已冻结 | 无专用真实 no-write driver | 部分实现 | 当前刷新被转成普通聊天文本，不是专用 projection refresh action | 设计偏差 / 验收缺口 | P1 | `au08-projection-refresh-no-write` |
| SC-AU08-C3 重建中状态可见 | `REBUILDING` 显示重建中，不提供写入按钮 | AU08-I6 | `ReadingMode` banner | runtime 状态派生 tests | 无真实状态来源 / driver | 已实现未验收 | 缺真实 refresh job 状态来源 | 产品能力缺口 | P1 | Projection job/status machine |
| SC-AU08-C4 重建失败可重试且不丢旧内容 | `FAILED` 显示失败和重试，旧内容保留或明确标注 | AU08-I6/I7 | `ReadingMode` banner / retry action | runtime 状态派生 tests | 无真实 failure 状态来源 / driver | 已实现未验收 | retry 同样走普通聊天文本 | 设计偏差 / 验收缺口 | P1 | Projection job/status machine |
| SC-AU08-D1 阅读模式不能编辑或采纳 | 页面没有 adoption/write action | AU08-I3 | `ReadingMode` 只含目录、返回、导出、刷新/重试 | 实现可读；无写入按钮来自 copy/组件 | 核心阅读 driver 无 adoption/write after reading；缺专项 no-author-action 断言 | 已实现未验收 | refresh action 待专用化 | 验收缺口 | P1 | `au08-reading-readonly-no-write` |
| SC-AU08-D2 无服务或 Channel 未就绪时诚实降级 | 离线/加载失败不误判成空作品 | AU08-I7/I8 | `ReadingMode` `tocError` / runtime state | `workspaceRuntimeState.test.ts` | 无真实断网/Channel failure reading driver | 部分实现 | 空态与加载失败语义仍可更清晰 | UX / 验收缺口 | P1 | AU-10 recovery / AU-08 failure follow-up |
| SC-AU08-D3 阅读模式真实入口可被作者发现 | 工作台可见入口进入阅读模式 | AU08-I4 | `WorkspaceChat` 阅读模式按钮 | 前端实现 | 所有 `p1-*reading*` driver 从真实工作台点击进入 | 已验收 | 无 | 无 | - | 保持 regression |
| SC-AU08-D4 阅读模式有自动化验收 | 改动后能自动发现阅读模式断链 | AU08-I1-I8 | `tauri_slice_verify.sh` + `quality_accept.sh` | native verifier tests | 本轮补 `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`p1-word-count-audit`、`p1-chapter-expansion-multichapter`、`p1-export-minimum` quality manifests，并全部复跑 `quality_accept.sh --surface tauri` 通过 | 已验收 | 状态机分支仍需后续 driver | 质量入口补强 | P1 | 保持 nightly |

---

## 5. 缺口分级

### P0

无当前 P0。旧 P0（mock TOC、缺章节 handler、采纳未进入 Reading Projection、ProjectionHint 未进 TurnResult、跨作品隔离未验收）已由当前实现、局部测试和 Tauri evidence 关闭。

### P1

| 缺口 | 当前证据 | 后续 owner / 恢复路径 |
|---|---|---|
| Projection refresh 专用 action / no-write driver | `ReadingMode` 只设置 `pendingBuildAction`；`WorkspaceChat` 仍把 refresh/retry 转成普通文本 | `au08-projection-refresh-no-write`：新增专用 Channel/Application refresh action 或显式 no-op refresh，并验证 no production write |
| REBUILDING / FAILED 真实状态来源 | UI banner 已实现，但缺 projection job/status producer | Projection job/status machine；补真实 Tauri driver 覆盖重建中、失败、重试 |
| 返回工作台上下文专项验收 | `App.tsx` 保持 workbench 挂载，缺返回后继续输入的 driver 断言 | `au08-reading-return-context` |
| 阅读模式只读专项 no-write 验收 | 核心 reading drivers 没有发现写入，但缺“阅读模式内无 author_action/write”专门断言 | `au08-reading-readonly-no-write`，可与 refresh no-write 合并 |
| 离线/加载失败语义 | runtime state 有 failed/empty 区分，真实 reading failure driver 缺失 | 与 AU-10 recovery 合并，补 Channel failure / service disconnect reading driver |

### P2

| 缺口 | 说明 |
|---|---|
| 阅读入口视觉细节 | 当前入口可被真实 driver 点击；更细 UI 对齐归 AU-10 workbench 视觉矩阵 |
| 更完整导出体验 | `p1-export-minimum` 覆盖 Markdown 文件和 honest placeholders；更复杂格式/路径体验归产品后续 |

---

## 6. 文件级退出判断

- 当前验收文件 16 个场景已有可信对账矩阵。
- 当前 P0 为 0。
- 核心承重链路“生成草稿 → 作者采纳/编辑后采纳 → adoption boundary → persistence → Reading Projection → ReadingMode TOC/正文/字数/stale banner”有真实 Tauri evidence 和 quality manifest。
- 未采纳不入阅读、跨作品 projection 隔离、多章导航、空章诚实显示、短章 audit、导出均已挂入当前 Tauri / quality 入口。
- P1 均已登记 owner 文件和恢复路径，主要集中在 projection refresh job/status machine，不阻塞 AU-08 当前文件级核心交付。

AU-08 当前文件级收口完成后，可以进入下一个验收文件 AU-09；刷新状态机后续不得回写成 AU-08 已完整状态机闭环。
