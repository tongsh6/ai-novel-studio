# AU09 Validity Window Recall / 记忆有效期窗口召回

- 状态：checkpoint closed
- 类型：Memory Recall Slice + Context Slice
- 启动日期：2026-06-18
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md` SC-AU09-C4，AU09-GAP-08。
- 所属设计：`docs/design/06-memory-context-and-trace.md` 记忆有效期 / NarrativePosition，AU-03 current work context。

## 1. 用户 / 系统目标

作者为设定指定章节/场景有效期后，AI 的普通召回必须尊重当前叙事位置：过期或尚未生效的记忆不能混入当前 prompt；全书有效或当前窗口内的记忆仍可召回，并在 why 中给出 author-safe 来源。

本 slice 不重做记忆管理入口，也不声明完整 AU09 完成。它只补 `valid_from` / `valid_until` 与当前作品叙事位置之间的真实召回过滤闭环。

## 2. 开工检查

- **Contract**：消费 `MemoryItem.valid_from` / `valid_until` / `expire_condition`、`NarrativePosition`、`WorkspaceContext` current chapter/prose position、`MemoryRecallRepo` recall contract、`TraceSummaryView.context_refs`。
- **Invariant**：
  - 普通 recall 只能返回当前叙事位置内有效、confirmed/stabilized 且 recallable 的记忆。
  - 超出有效期的记忆不得进入 prompt、TurnResult context refs 或 why 内容。
  - 有效期过滤必须按当前 Work 的真实阅读/章节状态计算，不能由验收专用 env、query、localStorage 或 fake UI hook 驱动。
- **Boundary**：
  - `novel_persistence`：`MemoryRecallRepo` 已在 recall 前按当前作品叙事位置过滤窗口外记忆。
  - `novel_application`：ContextAssembler / WorkspaceContext 消费过滤后的 memory summary。
  - `novel_web`：只通过正式 Channel/REST 输出 context/why 信息。
  - `frontend`：只消费正式 why/context refs；不添加验收感知逻辑。
  - **不改** MemoryType enum、不修改 scenario invariant driver、不把 seed 数据逻辑注册进生产 runtime。
- **Consumer**：真实工作台后续对话、why 面板、AU09 recall 主链。
- **Proof**：
  - 外部 Tauri：`bash scripts/tauri_slice_verify.sh au09-validity-window-recall`。seed 当前叙事位置和两条记忆，真实工作台发送相关消息，证明窗口内/无窗口记忆可召回，窗口外记忆不进入 context/why。
  - 后端局部：persistence/application 测试覆盖当前章节位置、窗口内、窗口外、无窗口、跨作品隔离。
- **Acceptance Driver**：复用并收紧 `au09-validity-window-recall` 外部 driver。driver 必须从真实工作台操作，不新增产品验收感知逻辑。

## 3. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计现有 `valid_from` / `valid_until` 字段、seed、driver 和 recall 查询 | done | 现有 `MemoryRecallRepo` 已消费章节 UUID 窗口；seed/driver 可复跑。 |
| T2 | 实现 current narrative position 到 recall 过滤 | done | 当前叙事位置取当前作品已采纳正文最大章节 seq，窗口边界 chapter UUID 解析到 seq。 |
| T3 | 补后端窗口过滤与跨 work 隔离测试 | done | `memory_recall_repo_test.exs` 覆盖窗口外、窗口内、无窗口、无当前位置和无效边界。 |
| T4 | 收紧外部 Tauri verifier | done | `au09-validity-window-recall` 证明 context/why 不包含 out-of-window nonce。 |
| T5 | 同步 AU-09 / NEXT / ledger | done | 2026-06-18 复验后标 checkpoint closed；下一队首转为跨作品记忆隔离。 |

## 4. 当前缺口

- 章节级窗口已闭环：窗口外记忆不进入普通 recall、context refs 或 why。
- scene-level 有效期、降权而非排除策略、乱序采纳时的 story-order 字段仍是后续深化。
- 跨作品记忆隔离不在本 checkpoint 内，已拆到 `AU09-cross-work-memory-isolation`。

## 5. 验证计划

- [x] `mix test apps/novel_persistence/test/novel_persistence/memory_recall_repo_test.exs`
- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `cd frontend && pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au09-validity-window-recall`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-18 — `AU09-memory-trace-roundtrip` 已闭环 lifecycle/reference 可解释链路；下一 AU09 P1 缺口转为有效期窗口参与普通召回。
- 2026-06-18 — 复核发现有效期窗口过滤、测试和 Tauri driver 已存在；本轮复跑后标 checkpoint closed。下一 AU09 队首转为 `AU09-cross-work-memory-isolation`。
