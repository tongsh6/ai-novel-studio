# AU09 Memory Taxonomy Write Policy / 记忆类型与写入治理

- 状态：CP1 闭环（冻结写入治理契约 + 角色演化记忆写入路径 + 真实页面验收）
- 类型：Memory Governance Slice + Domain Contract Slice
- 启动日期：2026-06-23
- 来源反馈：用户问题 16、17
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md`

## 1. 用户 / 系统目标

记忆需要区分不同类型，尤其是“角色记忆”不能和角色主档案、普通设定、伏笔、规则混在一起。系统必须澄清什么时候写入记忆、什么时候不写、写什么、后续是否需要更新/移除/废弃，确保记忆对创作有帮助，而不是冗余、过时或误导上下文。

## 2. 开工检查

- **Contract**：`docs/design/06-memory-context-and-trace.md`；`docs/design/domain/21-novel-object-model.md` character 主档案；`docs/design/domain/22-continuity-model.md` 连续性；AU-09 memory status / recallable / validity window。
- **Invariant**：
  - 角色主体写 Character 主档案；角色记忆只记录演化、当前状态、关系变化、认知边界等连续性事实。
  - 只读查询、普通解释、失败 turn、未采纳候选不得写记忆。
  - 写入记忆必须有来源、状态、类型、scope、有效期或召回策略；过时内容必须可 deprecated / archived / superseded。
  - 召回只消费当前 work、confirmed/stabilized、recallable 且有效窗口匹配的记忆。
  - 记忆更新不能静默覆盖 locked 或高风险事实。
- **Boundary**：
  - `docs/design`：先冻结最小 memory taxonomy、写入时机、更新/废弃策略。
  - `novel_application`：AdoptionWorkflow、MemoryManagementService、ContextAssembler 需要消费统一策略。
  - `novel_persistence`：MemoryItem type/status/scope/validity/supersession 查询需对齐。
  - `frontend`：记忆管理页和作品档案文案要解释类型与状态，不把角色主档案显示成角色记忆。
  - **不改**：不把 provider 输出直接写 confirmed memory；不绕过 adoption / lifecycle guard。
- **Consumer**：记忆管理页、作品档案伏笔/规则/角色详情、ContextAssembler、why 面板。
- **Proof**：
  - 文档 contract 和代码枚举/DTO 对齐。
  - 后端测试覆盖各类型写入/不写入/召回/废弃。
  - 真实 Tauri 验收覆盖：创建角色主体不写角色记忆；采纳角色演化事件写角色记忆；deprecated/archived 角色记忆不召回；why 显示记忆类型和来源。
- **Acceptance Driver**：新增或扩展 AU-09 外部 Tauri driver；产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | maybe | 类型枚举如抽纯函数 |
| novel_domain | yes | memory type / lifecycle 语义 |
| novel_agent | maybe | prompt 需说明哪些内容应产出 pending memory |
| novel_application | yes | 写入时机、召回、上下文组装 |
| novel_persistence | yes | type/status/supersession/effective window 查询 |
| novel_web | maybe | memory DTO / management API |
| frontend | yes | 类型显示和治理动作 |
| docs/design | yes | 本 slice 首先补 contract |
| quality | yes | 新增验收矩阵 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计现有 MemoryType、写入入口、召回策略和角色相关路径 | done | taxonomy 已丰富（11 MemoryType）；adoption 按 artifact_type→MemoryType 映射；召回过滤 CONFIRMED/STABILIZED+recallable+窗口；character_seed→主档案不写记忆；缺：角色演化记忆写入路径 + 成文写入策略 |
| T2 | 定义 memory taxonomy 与角色记忆边界 | done | `06-memory-context-and-trace.md §4.5` 冻结：主档案（character_seed）vs 角色演化记忆（character_evolution_seed → CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP）边界 |
| T3 | 定义写入/不写入/更新/废弃/移除策略 | done | §4.5.3 写入时机与不写边界（只读/失败/未采纳不写）；§4.5.4 更新/supersede/deprecate/archive + 召回过滤 |
| T4 | 对齐 application/persistence/frontend 行为 | done | 新增 `character_evolution` 能力 + `character_evolution_seed` artifact + 采纳写角色记忆（memory_subtype 或内容分类）；前端卡/标签/记忆类型展示 |
| T5 | 补真实 Tauri 验收和局部测试 | done | domain/contract/persistence/agent 测试；`au09-memory-taxonomy-write-policy` Tauri driver 通过 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（`artifacts/slice-verify/au09-memory-taxonomy-write-policy-tauri/summary.json`；`scripts/quality_accept.sh au09-memory-taxonomy-write-policy --surface tauri` 通过）
- [x] 后端 / Channel / frontend 局部验证（持久化/契约/provider 测试 + 前端 typecheck/lint/test 全绿）
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 gitleaks ProjectGod 既有 accepted_risk）

## 6. 决策日志

- 2026-06-23 — 登记用户反馈 16/17。现有 AU-09 已证明基础记忆生命周期和召回，但类型语义、角色记忆边界、写入时机与后续治理仍需单独收敛。
- 2026-06-24 — CP1 闭环（用户确认范围：冻结契约 + 角色演化记忆写入路径 + Tauri 验收）。`06 §4.5` 冻结实现层写入治理；新增 `character_evolution` 能力/`character_evolution_seed` artifact，采纳写角色记忆（CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP，按 memory_subtype 或内容分类）非主档案；planner/provider 区分“设计角色”vs“更新/演化角色”。真实 Tauri 证明：设计角色→主档案不写记忆、记忆页无角色记忆；更新当前状态→采纳写「当前状态」角色记忆、记忆页按类型展示且保留本轮 nonce。坑：`@creative_tools` 白名单（turn_execution_service）漏 character_evolution 致工具拿不到 provider（complete_fn_required）；driver nonce 须同时含字母数字（random_identifier_tokens 要求）。

## 7. 试行反馈

- 策略落「少写、写准、可解释、可废弃」：写入只在采纳后；只读/失败/未采纳不写；召回过滤终态与窗口外。
- CP2 后续：角色记忆与角色主档案的双向引用/演化时间线、supersede 旧角色记忆的显式入口、角色记忆参与召回的真实页面证据（本 CP 证写入与展示，召回过滤复用既有 `MemoryRecallRepo` 及 `au09-validity-window-recall`/`au09-memory-trace-roundtrip`）。
