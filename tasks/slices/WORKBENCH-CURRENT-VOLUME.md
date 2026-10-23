# WORKBENCH-CURRENT-VOLUME：工作台头部显示真实写作坐标当前卷

- 状态：**done（2026-10-24；CP1–CP3 全落；真实 Tauri `au08-volume-structured-planning` 扩展验收 PASS）**
- 来源：`tasks/slices/B13B-adr-enforcement-reconciliation.md` §4.1 #11；ADR-0028 `## enforcement_gaps`（工作台「当前卷」硬编码占位）；VS-00J §4 消费面 2 / §9 Q11
- 设计真源：`docs/design/adr/ADR-0028-volume-structure-and-open-volume-action-v3.md` §UI 影响；`docs/design/contracts/VS-00J-volume-structure-and-blueprint-contract-pack.md` §4；`docs/design/schemas/foundation/turn_result_v3.json`
- 类型：前端消费面 + 后端 additive 数据契约（承重竖切面：写作坐标 → 工作台头部）

---

## 1. 开工七问

1. **Contract**：ADR-0028「工作台头部显示真实写作坐标驱动当前卷」（不出现假「未定卷」）；VS-00J §4 消费面 2（当前卷蓝图同源写作坐标）；`turn_result_v3` additive `writing_coordinate`（volume_ref / authoring_mode / matched_chapter，与 app JSONL `turn_execution.writing_coordinate.done` 同源）。
2. **Invariant**：头部当前卷必须来自真实写作坐标（最近 TurnResult 的 `writing_coordinate.volume_ref`）或 get_toc 回退（规划态），不得硬编码占位；卷标题来自 get_toc 卷节点，前端不猜；读失败回退「全书」而非伪造卷名；无验收感知逻辑。
3. **Boundary**：`novel_domain`（`WritingCoordinate` 值对象不动）；`novel_application`（`TurnExecutionService` 把坐标装进 TurnResult；`ReadingProjectionService.current_writing_coordinate/2` 解析 + TOC 回退）；`novel_web`（Channel `get_writing_coordinate` handler，读 socket assign 的 `turn_results_list`）；`frontend`（`socket.getWritingCoordinate` + WorkspaceChat 头部消费）；不改 `get_toc`/ReadingMode/StructurePanel 语义。
4. **Consumer**：真实 Tauri 工作台头部（`WorkspaceChat` 顶部 volText）；au08 真实页面场景；Channel 契约测试。
5. **Proof**：`ReadingProjectionServiceTest`（坐标优先 + TOC 回退 + 无卷 nil）、`VS00ECP2ProseQualityTest`（TurnResult 携带坐标）、`workspace_channel_v3_test`（lobby handler 返 nil 不伪造）、`frontend pnpm typecheck/lint/test`；真实 Tauri `au08`：get_writing_coordinate reply volume_title = 本轮坐标解析卷 + 页面头部可见该卷名 + 无「未定卷」。
6. **Acceptance Driver**：外部 Playwright 驱动真实 Tauri 工作台：既有 au08 流程（真实采纳分卷计划 → 第一卷章生成正文草稿）后断言头部当前卷 = 第一卷真实卷名；不新增产品验收 hook。
7. **Exploration**：不适用（消费面 slice，非要素物化）。

## 2. CP0 裁决（默认拍板）

B13b §7 Q11 审计建议 **A**：数据源 = 写作坐标 `volume_ref`（JSONL 已有）+ get_toc 回退；规划态可回退 TOC；卷蓝图作者编辑/作废维持非目标。本轮按作者授权默认拍板 A：
- 写作坐标经 TurnResult additive 字段进入前端可消费面（与 app JSONL 同源，新增字段不改变既有 turn_result 语义；schema v3 additive 可选）。
- 规划态（无坐标）→ 回退 TOC 末卷（最后一个有章的卷；全空卷取最后一卷）。
- 无卷 → `null`，头部显示「全书」（既有 `WORKBENCH.wholeBookLabel`），不再出现硬编码「未定卷」。

## 3. CP1 实现

**Backend**
- `NovelApplication.TurnExecutionService`：`execute/1` 已构建 `WritingCoordinate`；把 `%{volume_ref, authoring_mode, matched_chapter}` additive 装进 `do_execute` 的 TurnResult（`writing_coordinate`）与 hard-missing `blocked_result`；不改 trace/tool 语义。
- `NovelApplication.ReadingProjectionService.current_writing_coordinate/2`：从 `turn_results` 列表按 `produced_at` 取最近非空 `writing_coordinate.volume_ref` → get_toc 卷节点解析 `volume_title`（source=`writing_coordinate`）；无坐标 → TOC 回退末个有章卷（source=`toc_fallback`）；无卷 → nil；author-safe（不泄漏 trace/内部 id 以外的内容，id 仅用于 UI 解析）。
- `NovelWeb.WorkspaceChannel.handle_in("get_writing_coordinate")`：读 `socket.assigns[:turn_results_list]`（join 恢复 + 每轮 remember 更新），返回 `%{coordinate: ...}`；日志 `channel.get_writing_coordinate.done`（volume_ref/volume_title/source）。

**Frontend**
- `socket.ts`：`WritingCoordinate` 类型 + `getWritingCoordinate(channel, workId)`（phx_reply 风控 error/timeout）。
- `WorkspaceChat.tsx`：`refreshWritingCoordinate(channel, workId, token)`——join 成功后与每次真实 turn_result 后刷新；成功则 setContext `{volumeId, volumeTitle}`，失败保留旧值。头部显示 `context.volumeTitle || WORKBENCH.wholeBookLabel`；移除两处硬编码 `"未定卷"`（初始/切换作品置 `null`，不伪造）。
- 卷标题一律由服务端 get_toc 解析，前端不解析 id/标题映射。

## 4. CP2 测试

- `ReadingProjectionServiceTest`：最新坐标优先（含 produced_at 排序、不匹配卷回退）、TOC 回退、无卷 nil。
- `VS00ECP2ProseQualityTest`：运行 TurnResult 带 `writing_coordinate`（authoring_mode=first_draft、volume_ref 透传）。
- `workspace_channel_v3_test`：lobby `get_writing_coordinate` 返回 `%{coordinate: nil}`（不伪造卷）。
- verifier self-test：au08 fixture/expected 增加 `workbench_header_*` 字段与断言；driver/verifier 扩展见 CP3。

## 5. CP3 真实 Tauri 验收（au08 扩展）

真实页面（既有 au08 流程）：真实采纳两卷章节计划 → 第一卷某章「生成正文草稿」→ 本轮写作坐标 `volume_ref` = 第一卷 TOC id（app JSONL 已有断言）→ 新增断言：
1. `get_writing_coordinate` phx_reply 的 `coordinate.volume_title` = 本轮坐标解析的真实卷名（`第一卷·觉醒`，来自 get_toc，不是硬编码）。
2. 真实工作台头部可见文本（`[class*="volText"]`）= 该卷名；页面文本不出现「未定卷」。
3. 规划下一卷/第三卷采纳后不影响既有断言（头部仍以写作坐标为准；既有阶段断言不回归）。

证据（待收口）：`artifacts/slice-verify/au08-volume-structured-planning-tauri/summary.json`；ui-state 字段 `workbench_header_volume_title` / `..._from_channel` / `..._shows_current_volume` / `..._placeholder_present`。

## 6. 诚实边界

1. **规划态语义**：无写作坐标时回退 TOC 末卷（作者裁决 A 的「规划态可回退 TOC」）；这是展示性坐标，不是采纳事实，不写库。
2. **坐标来源**：TurnResult additive 字段与 app JSONL `turn_execution.writing_coordinate.done` 同源；不新增持久化 schema 列（TurnResult 本身不落库为行，embedded/JSON 消费）。
3. **多轮历史**：以 `produced_at` 取最近非空坐标；`join` 恢复历史+运行期 remember 均在同一校验路径。
4. **读失败**：坐标读失败保留旧值/回退「全书」，不阻断对话与写库；不伪造「未定卷」。
5. **卷蓝图编辑/作废**：维持 VS-00J §1 非目标（本 slice 未做作者编辑入口）。
6. **验收感知**：产品代码不读取 slice id/验收 env；`get_writing_coordinate` 是真实前端消费能力（头部当前卷），非验收专用事件。

## 7. 验证命令

```bash
mix compile --warnings-as-errors && mix test
mix credo --strict && mix dialyzer
mix format --check-formatted
mix run scripts/arch_check.exs && mix run scripts/adr_trace.exs
mix xref graph --format cycles --label compile-connected --fail-above 0
bash scripts/quality_manifest_check.sh
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
cd frontend && pnpm typecheck && pnpm lint && pnpm test
PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh au08-volume-structured-planning --surface tauri
bash scripts/ai_static_scan.sh --top 10
```

## 8. 决策日志

- **2026-10-24 — CP0 裁决（Q11-A 默认）**：写作坐标 volume_ref 为主数据源（TurnResult additive + JSONL 同源），规划态回退 TOC；无卷显示「全书」；不新增卷蓝图作者编辑入口。
- **2026-10-24 — CP1 实现**：TurnResult `writing_coordinate` additive；`ReadingProjectionService.current_writing_coordinate/2` + Channel `get_writing_coordinate`；前端 socket helper + 头部消费/刷新；移除硬编码「未定卷」。
- **2026-10-24 — CP2 测试**：service/channel/turn_result 单测 + verifier self-test 245 绿。
- **2026-10-24 — CP3 验收**：au08 driver/verifier/manifest 扩展头部断言（channel reply + DOM 双层证据）；真实 Tauri 复跑（结果见收口）。
