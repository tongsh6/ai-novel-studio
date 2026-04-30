# VS-007 Intent Registry Expansion

- 状态：done
- 类型：Turn Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

系统目前只有 `CREATE_WORK_SEED` 一个 intent 注册，Router 只能识别"建/创建/写/创作"关键词。作者无法发起章节写作、人物创建、世界观设定、风格管理等真实小说创作行为。

本 slice 从 ADR-0008 首批 20 个 intent 中选取第一批 4 个核心 intent 注册到 IntentRegistry，同时升级 Router 从关键词识别到 LLM-based intent 分类，使系统能真正承载多类创作请求。

## 2. 开工检查

- Contract: `docs/design-v2/adr/0008-first-batch-intents.md` §3.3（产出期 5 intent）；`docs/design-v2/adr/0010-first-batch-intent-slot-schema.md` §3（slot schema）；`docs/design-v2/04-capability-and-intent-registry.md`
- Invariant: 注册的 intent 必须通过 SlotSchema 校验（blocking_slots 非空必须触发 clarification）；未经注册的 intent name 不得路由到执行路径
- Boundary: 涉及 `novel_agent`（IntentRegistry + Router）、`novel_application`（TurnService 分支）；不应修改 `novel_persistence`、`novel_web`；不新增领域对象
- Consumer: TurnService.handle_message/4 的 route 分支；WorkspaceChannel 返回的 TurnResult；前端 clarification/confirmation/adoption card
- Proof: IntentRegistry 注册测试、Router 路由测试、TurnService 分支覆盖测试、slot 缺失 clarification 测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum |
| novel_domain | no | 不引入新领域对象 |
| novel_agent | yes | IntentRegistry 新增 4 intent slot schema + meta/1 + classification_prompt/0；Router LLM 升级 |
| novel_application | yes | TurnService 通用化：build_tentative_for + build_draft_tentative + build_clarification |
| novel_persistence | no | 不新增持久化 |
| novel_web | no | Channel 透传，不改 |
| frontend | no | 已有 card 类型足够覆盖 |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 选定第一批 4 个 intent 并确认其 slot schema | done | DRAFT_SCENE, DRAFT_CHAPTER, REVISE_DRAFT, CONTINUE_DRAFTING（产出期核心） |
| T2 | 在 IntentRegistry 注册 4 个 intent | done | 按 ADR-0010 §7.3 完整 slot envelope；新增 meta/1（risk_class + requires_confirmation） |
| T3 | Router 升级：LLM-based intent 分类替代关键词识别 | done | 主路径 Provider.Gateway.complete；fallback 关键词分类器保留为降级；新增 Router.Result 元数据字段 |
| T4 | TurnService 为新增 intent 产出 tentative artifact | done | build_tentative_for 路由 + build_draft_tentative（调用 Provider.Gateway）+ 通用 clarification/confirmation |
| T5 | 补齐 IntentRegistry + Router + TurnService 测试 | done | +15 agent tests, +4 application tests；覆盖注册/路由/澄清/生成全链路 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 326 tests, 0 failures（+19 new）
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles found
- [x] `cd frontend && pnpm typecheck && pnpm test` — 12 tests, 0 failures
- [x] `bash scripts/ai_static_scan.sh --top 10 --quick` — arch check PASS；2 个预存 Credo 问题不在本 slice 范围

## 6. 决策日志

- 2026-04-30 — 选定产出期 4 个核心 intent：DRAFT_SCENE (MEDIUM)、DRAFT_CHAPTER (HIGH)、REVISE_DRAFT (MEDIUM)、CONTINUE_DRAFTING (HIGH)。覆盖 2 个无 confirmation + 2 个需 confirmation 的场景。
- 2026-04-30 — Router 双路径设计：主路径 LLM 分类（Provider.Gateway），LM Studio 不可用时自动降级为关键词 fallback。这保证在本地模型不可用时系统仍可运行（虽然分类精度降低）。
- 2026-04-30 — TurnService 通用化：build_tentative_for 根据 intent 路由到 build_create_work_tentative（Work 创建）或 build_draft_tentative（通用内容生成，调用 Provider.Gateway）。新增 4 个 intent 共享同一个 builder。
- 2026-04-30 — build_draft_tentative 调用 Provider.Gateway 生成内容，产出一个 `artifact_type: "draft_text"` 的 tentative artifact + adoption card。不持久化到 DB（当前无 Scene/Chapter 领域对象持久化），但 adoption card 使前端可以展示采纳/修改/放弃流程。
- 2026-04-30 — Router.Result 新增 `requires_confirmation` 和 `risk_class` 字段（从 IntentRegistry.meta/1 读取），解决了 VS-003 反馈中"这两个字段不在 Router.Result struct 中"的问题。

## 7. 试行反馈

- Router LLM 分类在 LM Studio 未启动时会静默降级为 fallback 关键词分类。当前 fallback 分类器精度有限（"写" 歧义问题：需 "写一本/一部" 才归类为 CREATE_WORK_SEED），但足以验证链路。LLM 可用时分类质量由本地模型能力决定。
- `build_draft_tentative` 的 artifact 不在 DB 中持久化——这是已知取舍：Scene/Chapter/Draft 的领域对象 + persistence 是后续 slice 的范畴。当前 tentative artifact 是 ephemeral（内存中），adopt/discard 的持久化语义尚未就位——这是 Phase 3 的范畴。
- IntentRegistry 从 1 → 5 个 intent 的扩展顺畅：SlotSchema envelope 足够通用，新增 intent 只需声明 slots + meta 数据。剩余 15 个 intent 的注册遵循同一模式，可批量完成。
- `meta/1` 函数独立于 SlotSchema struct——这是有意的设计选择：元数据（risk_class / requires_confirmation）是 intent 的属性而非 slot 的属性，保持两个数据结构的独立性避免了概念混淆。
- 关键词 fallback 分类器优先级敏感（"写一本" 必须在 "写" 之前匹配），后续如需扩展 intent 数量应替换为更健壮的分类策略，而不是继续打补丁。
