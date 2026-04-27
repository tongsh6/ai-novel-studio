# Phase 0 · Week 4 · 第一个真实 capability + End-to-End smoke

- 启动日期：2026-04-28
- 范围依据：`docs/design-v2/tech-stack/14-roadmap.md` §5（任务定义在那里，本文件仅跟踪状态）
- 完成标准依据：同上 §5.2
- 上一周：`tasks/2026-04-28-phase-0-week-3-cross-cutting-provider.md`（6/6 done）

## 任务清单

引自 `14-roadmap.md` §5.1。

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | DB works 表 migration + Ecto Schema | done | (pending) | `works` 表（uuid PK + title/genre/status + adoption 字段）；`NovelPersistence.Schemas.Work` + adopt_changeset；dev + test DB 迁移成功 |
| T2 | Intent Registry + Slot Schema | done | (pending) | `NovelAgent.IntentRegistry` + `SlotSchema`（5 slots：3 required + 2 optional）；`CREATE_WORK_SEED` 硬编码注册；3 tests |
| T3 | Router 骨架 | done | (pending) | `NovelAgent.Router` + `Router.Result` struct；关键词识别 intent + 流派关键词提取 + 缺失槽位检测；4 tests |
| T4 | Executor + TurnResult 组装 | done | (pending) | `NovelFoundation.ID.uuid/0` 新增；`NovelApplication.TurnService.handle_message/2`；clarification / tentative artifact 两条路径 |
| T5 | Adoption Boundary | done | (pending) | `NovelApplication.AdoptionBoundary.accept/1`；Ecto insert → adopt_changeset（tentative → accepted）；novel_application 加 novel_persistence 依赖 |
| T6 | Channel 消息处理链路 | done | (pending) | `WorkspaceChannel` 新增 `user_message` / `adopt` 事件处理；调用 TurnService + AdoptionBoundary；broadcast turn_result |
| T7 | Frontend 改造 | done | (pending) | `WorkspaceChat` 组件（对话流 + adoption card 渲染 + accept/discard 按钮）；`sendMessage` + `adopt` socket helpers；CSS Module；tsc + vite build 通过 |
| T8 | End-to-end smoke test | done | (pending) | `TurnServiceTest`：用户消息 → clarification 断言 + DB 持久化验证（Sandbox checkout）；4 tests |

完成标准（来自 `14-roadmap.md` §5.2）：
- [x] 用户输入文本 → Router 识别 intent + 提取 slots → TurnService 产出 TurnResult（clarification 或 tentative artifact）
- [x] TurnResult 包含 adoption_card（ui_cards）+ adoption_state.pending（tentative artifact）
- [x] Channel push turn_result → 前端 WorkspaceChat 渲染 card + accept 按钮
- [x] 用户 accept → AdoptionBoundary → DB works 表有 accepted 记录
- [x] paper_trail 自动记录 revision（Ecto insert/update 经 paper_trail 写 versions 表）
- [x] 后端 51 tests + 前端 8 tests 全绿
- [x] format / credo (192 mods/funs, 0 issues) / xref (无循环) / arch_check 全部门禁通过
- [ ] 完整 OTel trace（留待 Phase 1 — 当前通过 `:telemetry` + audit log JSONL 覆盖）
- [ ] 浏览器端到端手动验证（需 `mix phx.server` + `pnpm dev` 双终端启动后人工测试）

## 决策日志

倒序，最新在上。

- **2026-04-28** — T1-T8 全部完成。关键决策：
  - **novel_application 加 novel_persistence 依赖**：AdoptionBoundary 需要 `Repo.insert/update`，无法绕过。原先 novel_application → {novel_agent, novel_domain, novel_foundation}，现加入 novel_persistence。依赖方向仍为单向无循环（novel_persistence → novel_domain → novel_foundation，novel_application → novel_persistence，两条链不交叉）。
  - **works 表与 workspaces 表分离**：works 存小说作品（title/genre/status/adoption），workspaces 存 UI 会话。语义不同，不合并。
  - **ID 生成进 novel_foundation**：`NovelFoundation.ID.uuid/0` 用 `:crypto.strong_rand_bytes/16` 拼 UUID v4 格式，避免在 novel_application 中引入 Ecto 仅为了 `Ecto.UUID.generate/0`。Erlang 的 `:uuid` 模块不存在（需 hex 包），直接用 crypto。
  - **Router 用关键词 + 简单规则**：Phase 0 不做 LLM-based slot filling。意图识别靠关键词（建/创建/写/创作），流派提取靠 13 个流派关键词表，其他 slot（core_selling_point/target_reader）当前不可提取 → 触发 clarification。
  - **TurnService 返回 plain map**：不定义 TurnResult struct，直接用 atom-key map。与 Phoenix Channel JSON 序列化（jason）自然对齐，减少 struct → map 转换。
  - **novel_application 测试用 Sandbox.checkout**：test_helper.exs 设 Sandbox mode `:manual`，每个测试 setup 中 `Sandbox.checkout/1`。与 novel_persistence 测试模式一致。
  - **前端 WorkspaceChat 替换 ChannelDemo**：App.tsx 直接挂 WorkspaceChat 全屏组件。ChannelDemo 保留不删（Phase 0 参考）。

## 卡点 / TBD

- **浏览器端到端手动验证未做**：`mix phx.server` + `pnpm dev` → 浏览器测试完整链路待用户手动跑。
- **LLM-based slot filling 未实施**：Router 当前基于关键词规则。Phase 1 应改为 LLM slot extraction（Router 内部调用 Provider.complete 做结构化输出）。
- **TurnResult schema 对齐**：当前 TurnService 产出与 `TurnResult` Ecto schema（novel_persistence）字段不完全一致。Phase 1 需统一成 SSOT（JSON Schema → codegen → 双向校验）。
- **adoption discard 路径未实现**：前端有 discard 按钮，但后端 AdoptionBoundary 只实现了 accept。discard/branch/edit_then_accept 留待 Phase 1。

## 下次会话恢复指引

接手者按以下顺序读取上下文：

1. `docs/design-v2/tech-stack/14-roadmap.md` §5（Week 4 任务源）+ §5.2（完成标准）→ §6（Phase 1 启动）
2. `docs/design-v2/adr/0008-first-batch-intents.md`（CREATE_WORK_SEED 定义）
3. `docs/design-v2/adr/0010-first-batch-intent-slot-schema.md`（slot schema）
4. 本文件 §任务清单（当前到哪）+ §决策日志（为什么这么走）

**当前状态：Week 4 全部 8/8 完成。Phase 0 四周全部收官。** 下一阶段是 Phase 1（`14-roadmap.md` §6：Memory / LongRunner / Consistency / Multi-Agent 等 Foundation 子系统实施）。

Phase 0 总交付：
- 4 周、43 个任务、全部 done
- 后端 51 tests + 前端 8 tests，全绿
- 监督树 3 层（Workspace → Author → Agent）+ 横切层（Provider / Authority / Budget / Telemetry / Audit）
- 端到端链路打通：用户输入 → Router → TurnService → Channel push → 前端 WorkspaceChat → AdoptionBoundary → DB
