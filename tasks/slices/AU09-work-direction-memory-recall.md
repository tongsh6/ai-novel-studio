# AU09 创作方向进入记忆治理（长期可召回）

- 状态：**blocked（方向长期可召回目标已确认，持久化实施待 T1 语义/类型/多方向生命周期契约；§6 准备可独立推进）**。
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
| T1 | 契约扩展与类型定名 | todo（含待拍板点） | 06 §4.5 增补 work_direction 采纳写入；记忆类型二选一待用户拍板：**A（推荐）新增 `CREATIVE_DIRECTION` 子类型**（语义独立、召回策略可单独调、记忆页可按类筛）/ B 复用既有 `CONSTRAINT`（零枚举变更，但方向与硬约束混淆）。多方向语义同步冻结：建议并存留痕、召回默认取最新 N 条（改选=新条目，旧条目自然降权，不静默删除）。 |
| T2 | 采纳路径接线 | todo | `choose_candidate` 的 adopt_tentative 分支经既有治理写入边界写 memory_items（含 direction 标题/描述/tags、source_turn_ref/decision 引用）；未采纳/duplicate 不写；幂等（同 receipt 语义，重复采纳不重复写）。 |
| T3 | 召回接线 | todo | 上下文组装按既有 recall 框架把 active 方向带进创作/对话上下文（floor 档预算内），why 面板可解释来源引用。 |
| T4 | 诚实文案同步 | todo | 卡片/子 turn 消息「不会写入章节正文或作品事实」改为反映真实语义（如「已写入创作方向记忆，后续创作可召回；不会写入章节正文」）；copy.ts 集中管理；同步校准依赖旧文案的 driver 断言（吸取 runner 文案漂移教训，改前先 `rg` 驱动耦合面）。 |
| T5 | 真实 Tauri 场景闭环 | todo | `au09-work-direction-memory-recall`：设方向 → 新会话创作轮 recall 可见 + why 来源 → 记忆页可见可废弃 → 废弃后不召回；反证：未采纳候选无记忆行。 |
| T6 | 全量门禁 | todo | compile/test/xref/arch_check/I1-I3/N-NARR/静态扫描；涉及记忆写入须复跑 AU-09 既有场景（taxonomy-write-policy / recall-context / validity-window / cross-work-isolation）防回归。 |

## 4. 验收

- [ ] T1 契约冻结（类型拍板后）
- [ ] `bash scripts/quality_accept.sh au09-work-direction-memory-recall --surface tauri`
- [ ] AU-09 既有场景回归复跑
- [ ] 全量门禁

## 5. 决策记录

- 2026-07-05 — 用户拍板「方向可长期召回」并登记本 slice；来源排查证明当前为会话级软约定（全库零结构化消费者）。类型定名（A 新增 CREATIVE_DIRECTION / B 复用 CONSTRAINT）与多方向并存语义留 T1 拍板。

## 6. 当前契约与裁决材料准备

- 状态：**todo（2026-10-30 可独立准备；持久写入实施仍待本任务 T1 的具体契约接受）**。
- 下一步：重核当前 `choose_candidate` → AdoptionBoundary → receipt/trace → 后续创作的消费者，保留已确认“方向长期可召回”的目标；按当前 MemoryType、ADR-0030/0031 和通用求证链比较落位方式，避免按七月建议直接增加枚举或固定 packet。
- 待裁决材料：方向与硬约束/剧情事实的区别、有效范围、多方向并存或替换、作者废弃/冲突时的语义、可解释来源；类型命名随语义归属确定。旧 T1 的 CREATIVE_DIRECTION/CONSTRAINT 选项为历史提案，不能把它或“最新 N 条自然降权”当已冻结契约。
- 交付：真实生产/消费矩阵、最小方案与选项影响、采纳/幂等/跨会话/有效期/废弃/Why 的完整验收范围；B64 的目标坐标规则与 B39 的求证入口明确复用。该准备不写记忆、不运行模型，不预先接受任何方案。
- 实施放行：作者接受具体契约后再推进 T2–T6；完成普通回复统一裁决不等于方向持久化完成，方向写入也不等于真实模型正确消费。后续状态仍在本原任务，不另建创作方向 slice。
