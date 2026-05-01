# VS-015 CREATE_CHARACTER_CANDIDATES + StructurePanel Characters Tab

- 状态：done
- 类型：Turn Slice + Projection Slice
- 启动日期：2026-05-01
- 完成日期：2026-05-01

## 1. 用户 / 系统目标

StructurePanel 的角色/伏笔/规则三个 tab 都是空状态。Character 表、domain struct、persistence schema 已存在但无法通过对话创建。

本 slice 注册 `CREATE_CHARACTER_CANDIDATES` intent，打通"对话创建角色 → LLM 生成角色 JSON → 持久化 → 采纳 → StructurePanel 角色 tab 渲染"全链路。

## 2. 开工检查

- Contract: ADR-0008 §13（人物族 intent 名称）、24-novel-intent-catalog.md §13（intent 语义）、ADR-0001（TurnResult v2）
- Invariant:
  1. 角色只在有 work 上下文时创建
  2. 角色创建后为 TENTATIVE，需采纳后进入 ACCEPTED
  3. StructurePanel 只显示 ACCEPTED 角色
- Boundary: 涉及 novel_agent（IntentRegistry）、novel_application（TurnService + AdoptionBoundary + ReadingService）、novel_persistence（Character schema）、novel_web（WorkspaceChannel）、frontend（StructurePanel + socket.ts）
- Consumer: 用户在对话中说"创建角色"→ 收到角色 candidates adoption card → 采纳 → StructurePanel 角色 tab 显示
- Proof: `mix test` 371 tests 全绿，static scan 13/13 PASS

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | Character struct 已有，无需修改 |
| novel_agent | yes | IntentRegistry: 注册 CREATE_CHARACTER_CANDIDATES + slot schema |
| novel_application | yes | AdoptionBoundary: character create/accept/discard；TurnService: character intent 处理 + adoption 分派；ReadingService: build_characters/1 |
| novel_persistence | yes | Character schema: 新增 adopt/discard changesets |
| novel_web | yes | WorkspaceChannel: get_characters handler + discard 分派 character |
| frontend | yes | socket.ts: getCharacters；StructurePanel: 角色 tab 真实渲染 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | Character schema adopt/discard changesets | done | adopt_changeset → ACCEPTED, discard_changeset → DISCARDED |
| T2 | IntentRegistry 注册 CREATE_CHARACTER_CANDIDATES | done | slot schema: work_ref + character_direction + role_hint；meta: MEDIUM risk, no confirmation |
| T3 | AdoptionBoundary character CRUD | done | create_tentative_character, accept_character, discard_character；unwrap_multi 补 character 子句 |
| T4 | TurnService character intent 处理 | done | normalize_intent + build_create_character_candidates + handle_adopt_character + handle_discard_character；提取 create_character_artifact helper 消除 CC |
| T5 | ReadingService.build_characters + Channel | done | 查询 ACCEPTED characters；get_characters handler |
| T6 | Frontend StructurePanel 角色 tab | done | getCharacters + CharacterData type；角色卡片渲染（name/role/summary） |
| T7 | Credo 修复 | done | Enum.map_join + 提取 helper 消除 CyclomaticComplexity |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 371 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `mix run scripts/arch_check.exs` — ✅ 通过
- [x] `mix credo suggest --strict` — no issues
- [x] `bash scripts/ai_static_scan.sh --top 10` — 13/13 PASS
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test` — 全部通过

## 6. 决策日志

- 2026-05-01 — Character schema 无 revision 字段（与 Work/Draft 不同），accept_character 不做 optimistic_lock 检查。角色是原子实体，不频繁变更。
- 2026-05-01 — 批量创建支持：LLM 返回 JSON 数组，逐个 `create_tentative_character` 持久化。adoption_card 的"全部采纳"按钮采纳第一个角色（MVP 级别）。后续应改为逐角色采纳 UI。
- 2026-05-01 — `@intents` 中的 slot 必须使用 bare map `%{...}` 而非 `%SlotSchema.Slot{...}`——后者在 module attribute 编译期无法展开 struct。
- 2026-05-01 — 角色 tab 在 StructurePanel 打开时自动 fetch（与 toc 共享 useEffect），无需手动刷新。

## 7. 试行反馈

- IntentRegistry 的 slot 注册模式是运行时 map → struct 转换，不是编译期 struct。新增 intent 时容易误用 `%SlotSchema.Slot{}` struct 字面量——文档或 codegen 应注明此限制。
- Character CRUD 函数高度重复 Work/Draft 的模式——`create_tentative → accept → discard`。后续 3+ 实体类型时可考虑 `Adoption` protocol/behaviour。
- `discard` handler 的 `cond` 路由随着 artifact_type 增多（work/draft/character）变得冗长——应引入 `Artifact` protocol 做 `discard/2` dispatch。
