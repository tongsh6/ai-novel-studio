# AU09 Archive Memory Roundtrip / 伏笔与规则档案回写

- 状态：checkpoint closed（CP2：代码 + 伏笔/规则 tab 刷新矩阵 + 外部 Tauri adoption/recall 已闭环；完整 AU09 管理状态机待补）
- 类型：Artifact Slice + UI Contract Slice（作品档案伏笔/规则 创建→采纳→展示→召回 的最小闭环）
- 启动日期：2026-06-18
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md` SC-AU09-A4 / AU09-GAP-03；显示消费面 = 作品档案「伏笔」「经验规则」tab。
- 所属设计：`docs/design/contracts/VS-02A-tentative-creative-artifact-contract-pack.md`（`world_building -> world_setting / foreshadowing_seed / *_rule_seed`）、`docs/design/06-memory-context-and-trace.md`、`docs/design/ui/43-structure-panel.md`、VS-04 采纳边界。

## 1. 用户 / 系统目标

作者在真实工作台从作品档案「伏笔」或「经验规则」tab 发起 AI 引导的设定设计；AI 基于当前作品生成待采纳草稿。伏笔入口生成 `foreshadowing_seed`，规则入口生成 `world_rule_seed` / `style_rule_seed` / `constraint_seed`，`world_setting` 只保留给普通世界观/背景设定草稿和历史兼容。作者采纳后，系统按显式 artifact type 写入 governed memory（伏笔为 `FORESHADOWING`，规则为 `WORLD_RULE` / `STYLE_RULE` / `CONSTRAINT`），并让对应档案 tab 可见。后续对话应能经 AU-09 recall 主链引用这条已确认设定。

这不是记忆 CRUD 控制台。创建仍从对话入口发起，写入仍必须经过 tentative artifact 和 adoption boundary。

## 2. 开工检查

- **Contract**：消费 `world_building -> world_setting / foreshadowing_seed / *_rule_seed` artifact contract、AU-09 MemoryType、StructurePanel 伏笔/规则 tab、VS-04 adoption boundary；本 slice 固化的是显式 artifact type 采纳后的 governed memory 分类与档案可见性，不把伏笔概念并入 world_setting。
- **Invariant**：
  - 未采纳 artifact 不写 memory，不进入档案已确认列表。
  - 采纳后的伏笔类设定写为 `FORESHADOWING`，规则类设定写为 `WORLD_RULE` / `STYLE_RULE` / `CONSTRAINT`，而不是落到不可见的 `DRAFT_CONTEXT`。
  - 读写按当前 `work_id` 隔离。
  - 采纳结果必须可由 `WorkArchiveRepo.foreshadowing/1` 或 `rules/1` 读取，并继续受 memory governance 约束。
- **Boundary**：
  - `novel_agent`：`CreativeProvider.Real` 补 `world_building` 专用 prompt，生成伏笔/规则结构化草稿，保留三锚点和 nonce 贯通。
  - `novel_persistence`：`AdoptionRepository` 对 `foreshadowing_seed` / `*_rule_seed` 直接映射具体 MemoryType，`world_setting` 仅保留历史兼容兜底。
  - `frontend`：复用已存在 StructurePanel 伏笔/规则发起入口；本 slice 不改生产 UI。
  - **不改** schema、MemoryType enum、artifact enum、production runtime provider 注册、验收专用 hook。
- **Consumer**：真实 StructurePanel 的「新建伏笔」「新建规则」入口、`AdoptionRepository.writer/0`、`WorkArchiveRepo` 读模型、后续 `MemoryRecallRepo`。
- **Proof**：
  - agent 单测：`world_building` prompt 有伏笔/规则结构、上下文 grounding、三锚点。
  - persistence 单测：`foreshadowing_seed` / `*_rule_seed` 采纳后进入正确 MemoryType，并能被 archive tab 读模型读取。
  - 外部 Tauri：`bash scripts/tauri_slice_verify.sh au09-adopt-setting-recall` 复用真实工作台档案入口，证明 `world_building -> explicit archive artifact -> author_action accept -> adoption.evaluate -> governed memory -> 伏笔/规则 tab 重开可见 -> recall/why`。
  - verifier 单测：`pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs` 强制 `channel.get_foreshadowing.done` / `channel.get_rules.done` 与 UI count/text 证据。
- **Acceptance Driver**：复用 `bash scripts/tauri_slice_verify.sh au09-adopt-setting-recall`；产品代码不读取 slice id/env/query/localStorage。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增 MemoryType 枚举。 |
| novel_domain | yes | `TentativeArtifactSet` artifact type union 增加伏笔/规则草稿类型。 |
| novel_agent | yes | `CreativeProvider.Real` 的 `world_building` prompt。 |
| novel_application | no | 复用既有 adoption workflow 和 archive service。 |
| novel_persistence | yes | `AdoptionRepository` 的显式 archive artifact type -> MemoryType 映射。 |
| novel_web | no | 复用既有 Channel/action 路由。 |
| frontend | yes | 复用已存在 StructurePanel 发起入口；同步 artifact card 标题和外部验收 driver。 |
| docs/design | yes | AU-09 acceptance 与任务入口同步。 |
| quality | no | 不新增运行规则。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | `world_building` 专用 prompt | done | 伏笔/规则结构、上下文 grounding、三锚点。 |
| T2 | 显式 artifact type 采纳分类为 governed memory | done | `foreshadowing_seed` -> `FORESHADOWING`；`world_rule_seed` / `style_rule_seed` / `constraint_seed` -> rules tab 类型。 |
| T3 | 局部测试 | done | agent + persistence targeted tests。 |
| T4 | AU-09 / NEXT / ledger 同步 | done | 本轮同步入口，明确 CP1 与后续矩阵边界。 |
| T5 | 外部 Tauri driver | done（CP1） | 复用 `au09-adopt-setting-recall`，从真实档案入口发起并验证显式伏笔/规则 artifact 采纳后进入 governed memory + recall/why。 |
| T6 | 档案 tab 刷新 UI 矩阵 | done（CP2） | 同一 Tauri driver 覆盖“新增伏笔→采纳→重开伏笔 tab 可见”和“新建规则→采纳→重开经验规则 tab 可见”。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au09-adopt-setting-recall`
- [x] 后端 / 局部验证：`mix test apps/novel_agent/test/novel_agent/creative_provider/real_test.exs`
- [x] 后端 / 局部验证：`mix test apps/novel_persistence/test/novel_persistence/adoption_repository_test.exs`
- [x] `mix compile --warnings-as-errors`
- [x] `mix test`
- [x] `pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`（通过；保留既有 slice manifest 缺口 WARN）
- [x] `bash scripts/check_design_trace.sh`（经 `bash scripts/ai_static_scan.sh --top 10` 执行）
- [x] `bash scripts/ai_static_scan.sh --top 10`（17 pass；1 个历史 gitleaks `accepted_risk`，本次改动文件 0 项）

## 6. 决策日志

- 2026-06-18 — LongRunner CP3C 已由 `docs/design/04a-planning-and-long-run.md` 判定为无真实生产消费者，用户决策先铺产品功能广度。下一步选择 AU-09 档案设定 roundtrip：它已有真实 StructurePanel 入口、`world_building` 工具、adoption boundary 和 archive read model，是比 LongRunner 桩更贴近蓝图的承重切面。
- 2026-06-18 — 初版为保持 schema 最小改动，曾不新增 `foreshadowing_seed` / `rule_seed` artifact type，而是在采纳边界把 `world_setting` 归类为具体 MemoryType。
- 2026-06-18 — 用户指出“当前把伏笔归到 world_setting”；本任务已纠偏：`world_building` 按作者意图生成 `foreshadowing_seed` / `world_rule_seed` / `style_rule_seed` / `constraint_seed`，`world_setting` 只保留普通世界观设定和历史兼容。
- 2026-06-18 — `au09-adopt-setting-recall` 验收已收紧：真实「新增伏笔」必须产生 `foreshadowing_seed`，真实「新建规则」必须产生 `*_rule_seed` 或 `constraint_seed`，采纳后重开对应 tab，并要求 UI 文本与 archive count 匹配。summary 证据包含 `archive_tab_checked=foreshadowing,rule`、`archive_foreshadowing_count_after_adoption=1`、`archive_rule_count_after_adoption=1`。

## 7. 试行反馈

- 作品档案的“创建”入口不能只补按钮；必须证明采纳后的事实能进入对应 read model。否则作者看到的是入口，系统实际写入的是档案 tab 读不到的 `DRAFT_CONTEXT`。
- `world_setting` 作为 artifact 类型过粗的问题已纠偏；后续不得再把伏笔/规则默认装进 `world_setting`，应使用显式 artifact type 并由 governed memory type 承接。
