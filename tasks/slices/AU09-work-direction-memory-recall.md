# AU09 创作方向进入记忆治理（长期可召回）

- 状态：**doing（2026-10-31 作者选 A：显式 WORK_DIRECTION 类型/scope/废弃；T1 契约接受，实施 T2–T6 进行中）**。
- 类型：AU-09 记忆写入治理扩展 Slice
- 登记日期：2026-07-05
- 来源：2026-07-05 stage 排查发现（`tasks/NEXT.md` 同日条目）——「设为后续方向」采纳后全库零结构化消费者：仅存 interactions/receipts/decision_traces 三处留痕，效力只有会话 transcript 软路径；新会话或长会话压缩后方向即失效。用户拍板：方向应长期可召回。

## 1. 问题

`choose_candidate` 采纳（`adopt_tentative`，`target_ref=work_direction`）目前不写任何持久创作事实。「设为后续方向」是会话级软约定：同会话内靠对话历史起效，跨会话/压缩后丢失，无召回、无 why 来源、无生命周期治理。与作者预期（方向长期约束后续创作）不符。

## 2. 边界（六问）

- **Contract**: `06-memory-context-and-trace.md` §4.5 记忆写入治理契约扩展——`work_direction` 采纳写入治理记忆；类型定名待拍板（T1）；召回/有效期/终态语义沿既有治理框架。
- **Invariant**: 采纳的方向进入 governed memory、跨会话可召回且 why 可解释来源；**未采纳候选不写**（AU-09 既有红线）；不写章节正文/works 立项字段/角色主档案；终态（作者废弃）后不再召回；卡片与子 turn 文案与实际写入语义诚实一致。
- **Boundary**: `novel_application`（choose_candidate 采纳路径接线记忆写入 + 上下文组装召回）＋ `novel_persistence`（memory_items 既有表，预计零 schema 变更）＋ `frontend` 仅文案（copy.ts）；不改 channel 协议、不动 AdoptionWorkflow 既有采纳语义。
- **Consumer**: 后续创作轮次的上下文组装（recall 进 prompt）；记忆管理页（可见、可治理、可终态）；why 面板（来源可解释）。
- **Proof**: 写入/召回/未采纳不写的单测＋真实 Tauri 场景：设方向 → **开新会话** → 发起创作轮 → 方向经 recall 进入上下文且 why 可见来源；记忆页可见该条并可废弃；废弃后不再召回。
- **Acceptance Driver**: 新场景 `au09-work-direction-memory-recall`（外部 Tauri driver，复用 au09-memory-recall-context / validity-window 既有 harness 模式）；产品代码零验收感知。

## 3. 任务

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| T1 | 契约扩展与类型定名 | done（作者选 A：WORK_DIRECTION） | 06 §4.5 增补 work_direction 采纳写入；记忆类型二选一待用户拍板：**A（推荐）新增 `CREATIVE_DIRECTION` 子类型**（语义独立、召回策略可单独调、记忆页可按类筛）/ B 复用既有 `CONSTRAINT`（零枚举变更，但方向与硬约束混淆）。多方向语义同步冻结：建议并存留痕、召回默认取最新 N 条（改选=新条目，旧条目自然降权，不静默删除）。 |
| T2 | 采纳路径接线 | done（choose_candidate adopt_tentative → memory_items，幂等） | `choose_candidate` 的 adopt_tentative 分支经既有治理写入边界写 memory_items（含 direction 标题/描述/tags、source_turn_ref/decision 引用）；未采纳/duplicate 不写；幂等（同 receipt 语义，重复采纳不重复写）。 |
| T3 | 召回接线 | done（既有 recall 自动包含 WORK_DIRECTION；单测覆盖） | 上下文组装按既有 recall 框架把 active 方向带进创作/对话上下文（floor 档预算内），why 面板可解释来源引用。 |
| T4 | 诚实文案同步 | done（方向采纳消息/adopt title 改为“写入创作方向记忆，后续可召回”） | 卡片/子 turn 消息「不会写入章节正文或作品事实」改为反映真实语义（如「已写入创作方向记忆，后续创作可召回；不会写入章节正文」）；copy.ts 集中管理；同步校准依赖旧文案的 driver 断言（吸取 runner 文案漂移教训，改前先 `rg` 驱动耦合面）。 |
| T5 | 真实 Tauri 场景闭环 | doing（场景/驱动待建） | `au09-work-direction-memory-recall`：设方向 → 新会话创作轮 recall 可见 + why 来源 → 记忆页可见可废弃 → 废弃后不召回；反证：未采纳候选无记忆行。 |
| T6 | 全量门禁 | todo | compile/test/xref/arch_check/I1-I3/N-NARR/静态扫描；涉及记忆写入须复跑 AU-09 既有场景（taxonomy-write-policy / recall-context / validity-window / cross-work-isolation）防回归。 |

## 4. 验收

- [ ] T1 契约冻结（类型拍板后）
- [ ] `bash scripts/quality_accept.sh au09-work-direction-memory-recall --surface tauri`
- [ ] AU-09 既有场景回归复跑
- [ ] 全量门禁

## 5. 决策记录

- 2026-07-05 — 用户拍板「方向可长期召回」并登记本 slice；来源排查证明当前为会话级软约定（全库零结构化消费者）。类型定名（A 新增 CREATIVE_DIRECTION / B 复用 CONSTRAINT）与多方向并存语义留 T1 拍板。

## 6. 当前契约与裁决材料准备

- 状态：**accepted（2026-10-31 作者选择 A）；实施 T2–T6 进行中**。
- 下一步：重核当前 `choose_candidate` → AdoptionBoundary → receipt/trace → 后续创作的消费者，保留已确认“方向长期可召回”的目标；按当前 MemoryType、ADR-0030/0031 和通用求证链比较落位方式，避免按七月建议直接增加枚举或固定 packet。
- 待裁决材料：方向与硬约束/剧情事实的区别、有效范围、多方向并存或替换、作者废弃/冲突时的语义、可解释来源；类型命名随语义归属确定。旧 T1 的 CREATIVE_DIRECTION/CONSTRAINT 选项为历史提案，不能把它或“最新 N 条自然降权”当已冻结契约。
- 交付：真实生产/消费矩阵、最小方案与选项影响、采纳/幂等/跨会话/有效期/废弃/Why 的完整验收范围；B64 的目标坐标规则与 B39 的求证入口明确复用。该准备不写记忆、不运行模型，不预先接受任何方案。
- 实施放行：作者接受具体契约后再推进 T2–T6；完成普通回复统一裁决不等于方向持久化完成，方向写入也不等于真实模型正确消费。后续状态仍在本原任务，不另建创作方向 slice。

### CP0 契约/裁决材料（2026-10-31）

**现役链路事实**
- 候选方向来源：判断协议 `candidate_directions`（direction_id/title/pitch/tone_tags/source_frame_ref/risk_hint），由 `judgment_candidates/2` 生成；无有效 title/pitch 被过滤。
- 作者 `choose_candidate`：`DialogueGateway.handle_action/3` → `ActionValidator.validate` → `candidate_set_from_turn_result` → `chosen_candidate` → `AdoptionBoundary.evaluate`（missing/stability/cross-work/contract/freshness/conflict/overwrite/high-risk 等 gate）→ 只返回 `action_result` + `candidate_turn_result`。
- **没有调用 `AdoptionRepository.persist`、没有 MemoryItem/方向持久记录**；`adoption_target_ref` 默认字符串 `"work_direction"` 仅作为候选元数据，无实际落位消费者。因此当前“方向采纳”不会形成长期可召回事实，也没有 scope/有效期/废弃/替换语义。
- MemoryType 枚举无方向类型（`IDEA` 最近似但不等于长期方向）；`candidate_directions` 的 adoption_status 只在 TurnResult 内展示，不持久。
- trace：可经 action receipt/decision 留痕，但没有方向事实的 before/after 版本与来源绑定。

**方案比较（需作者接受具体契约后才实施）**
- **A（推荐，最小语义增量）**：新增显式 `WORK_DIRECTION` 记忆类型/结构（author 接受 schema/代码生成改动），字段含 title/pitch/tone_tags/scope（本章/本卷/全书）/status（active/superseded/abandoned）/source candidate+turn/risk；采纳时同 scope 并存或替换需显式字段，废弃写 superseded_by；Why 可回查候选来源。
- **B（不动枚举）**：把方向写入既有 `IDEA` 记忆并加结构化 metadata（scope/status/source/supersedes），由消费侧按 metadata 过滤；代价是语义借用、治理/权重语义需另行说明，长期可能与“灵感”混淆。
- **C（不动持久化）**：只保留 action receipt/decision trace 与 TurnResult 展示，明确登记“方向不长期召回”的 known-gap，不冒充长期方向记忆。
- 共同约束：只有作者采纳才写；未采纳/放弃/过期/跨作品/重复请求零写入；方向与硬约束/剧情事实分层，不覆盖既有 canon；B64 坐标、B39 求证入口复用；不按“最新 N 条自然降权”当契约。

**验收范围（接受方案后）**：真实生产/消费矩阵；采纳/幂等/跨会话/有效范围/废弃/Why；概览/上下文/后续判断与专业模型请求同源；外部真实 Tauri 从候选选择→采纳→新会话召回→模型请求核对；无 pending 卡出现冒充落位。

**实施放行**：等待作者选择 A/B/C；未接受前不写记忆、不改枚举/schema、不运行模型。

### T1–T4 实施记录（2026-10-31，作者已选 A）

- **T1 类型**：`memory_type.json` 新增 `WORK_DIRECTION` 并 codegen（foundation enum 同步，`codegen.enums --check` in sync）；方向语义独立于 CONSTRAINT/IDEA。
- **T2 采纳接线**：`DialogueGateway` 在 `choose_candidate` 且 `AdoptionDecision=:adopt_tentative` 时写 `AdoptionRepository.persist`（artifact_type=:work_direction）：
  - memory type WORK_DIRECTION、scope WORK、status CONFIRMED、recallable、summary=方向标题、content=pitch；
  - tags 含 candidate/candidate_set/decision/risk；source_id=mutation；
  - `direction_mutation_exists?/2` 幂等防重复写；写入失败让动作失败（不静默 accepted）；未采纳/拒绝/待确认不写；
  - `chosen_candidate` 改返回完整候选（保留 candidate_id，供 work/risk 来源）。
- **T3 召回**：既有 `MemoryRecallRepo` 只要求 confirmed+recallable+within window，WORK_DIRECTION 自动进入召回；单测验证 recall 返回该条。
- **T4 文案**：后端候选后果消息改为「已写入创作方向记忆，后续创作可召回；不会写入章节正文。」；前端 `candidateAdoptTitle` 同步；未改写“继续讨论”语义（不采纳不写）。
- **单测**：`au09_work_direction_test` 2/2（持久化/幂等/召回/未采纳不写）。
- **仍缺**：T5 真实 Tauri `au09-work-direction-memory-recall`（设方向→新会话召回+why→记忆页可见可废弃→废弃后不召回；未采纳无行）与 T6 全量回归/静态扫描。
