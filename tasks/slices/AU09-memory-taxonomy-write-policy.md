# AU09 Memory Taxonomy Write Policy / 记忆类型与写入治理

- 状态：todo
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
| T1 | 审计现有 MemoryType、写入入口、召回策略和角色相关路径 | todo | 区分当前事实与历史文档 |
| T2 | 定义 memory taxonomy 与角色记忆边界 | todo | 主档案 vs 演化记忆必须明确 |
| T3 | 定义写入/不写入/更新/废弃/移除策略 | todo | 包含来源、有效期、supersession |
| T4 | 对齐 application/persistence/frontend 行为 | todo | 最小实现，不提前造复杂治理系统 |
| T5 | 补真实 Tauri 验收和局部测试 | todo | 重点证明记忆不会污染创作上下文 |

## 5. 验证

- [ ] 外部自动化驱动真实页面的场景化验收
- [ ] 后端 / Channel / frontend 局部验证
- [ ] `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`
- [ ] `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`
- [ ] `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs`
- [ ] `bash scripts/quality_manifest_check.sh`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-23 — 登记用户反馈 16/17。现有 AU-09 已证明基础记忆生命周期和召回，但类型语义、角色记忆边界、写入时机与后续治理仍需单独收敛。

## 7. 试行反馈

- 本 slice 应先收敛“少写、写准、可解释、可废弃”的策略。若无法证明某类记忆会改善创作上下文，就不要默认写入。
