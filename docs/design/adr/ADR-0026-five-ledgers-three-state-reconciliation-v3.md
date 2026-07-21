# ADR-0026：五本账对象化与三态对账边界 v3

- 状态：Accepted
- 日期：2026-07-21
- 来源文档：
  - `../contracts/VS-00F-five-ledgers-three-state-contract-pack.md`（本 ADR 授权的 contract pack，§9 先例映射总表）
  - `../08-novel-element-model.md`（§4.5 E33-E37 / §5 三态对账 / §10 未冻结项 2/3 授权 / NEM-GAP-05/06）
  - `../06-memory-context-and-trace.md`（§5.0 continuity ledgers 投影行、§10.1/§18 StateTrace）
  - `../domain/25-maintenance-hooks.md`（hook 家族、维护 artifact 信封、§9.3 自动通过 policy、§10 validator）
  - `../domain/33-experience-engine.md`（§6.3/§11/§12 误报反馈回路）
  - `../quality/31-novel-quality-gates.md`（§6 质量门目录——与账本对账的分工线见 pack §6.2）
  - `../contracts/VS-00C-creative-context-assembly-contract-pack.md`（§3.0 progress_state_packet 槽、§10 候选 3）
  - `../contracts/VS-00E-prose-execution-quality-contract-pack.md`（§8 修订机械，revise_prose 复用）
  - `ADR-0010` / `ADR-0019`（采纳边界与七态；INV-1 是自动通过通道的合规底线）
  - `ADR-0021`（A20 LongRunTask 关联）、`ADR-0024`（决策面注册纪律）、`ADR-0025`（探索内部翼）
- 影响范围：Domain / Persistence / Application / Agent(profile) / Quality / Trace / Frontend(面板后置)
- 相关不变量：VS-00F §5（I-L1–I-L4）
- 首个证明 slice：`tasks/slices/VS-00F-five-ledgers-three-state.md` CP1（M2 75 章书重放为验收靶）
- 取代：无
- 取代者：无

---

## 背景

M2 达标跑（101,421 字/75 章）实证了 07-19 复盘的预言：要角随扩章批漂移（凌渊消失/凌云昙花/沈逸无设计接管）、题材承诺静默漂移、信息边界失守。根因是"向前看"的进度维度（E33-E37 五本账）只有 main_outline 文本兜底（NEM-GAP-05），且设计态 vs 实现态对账从未被表述为机制（NEM-GAP-06）——偏离静默累积，崩溃延迟到来（08 §5.3 反模式实况）。

## 决策范围

冻结 VS-00F contract pack 的三件事：LedgerEntry 统一信封与五账状态机；两级对账节拍（增量 `hook.UPDATE_LEDGERS` + 周期 `ledger_reconciliation_v1` profile）与产物（两个维护家族 artifact）；处置四枚举与既有通道的挂接（revise_prose→VS-00E §8、dismiss→Experience Engine、裁决持久化→32 §11 approval_record + adoption 主链）。

## 冻结的不变量

1. **I-L1 出处锚定**：账面断言必须携带非空 `source_refs` 且引用真实对象。
2. **I-L2 采纳边界**：权威账面变更 = 作者采纳 ∪ 系统发起的 LOW 风险采纳（完整 TENTATIVE→ACCEPTED，守 ADR-0019 INV-1；本条为 25 §9.3 policy 的首次契约化，并收编 VS-00C §10 候选 3 的章摘要采纳档位问题——章摘要现行自动 accept 归入同一通道口径）。对账运行本身只读权威层。
3. **I-L3 探索可达**：账本落地的同一 CP 内 `archive_read(ledgers)` 可查同一数据（08 §8 探索面同步律）。
4. **I-L4 规则确定性**：漂移规则确定性输出；模型只参与提炼与叙述；规则阈值只经 Experience 回路 policy proposal 调整（33 §12）。
5. **账面是进度视图非事实本体**：不双写 memory_items/摘要/档案承载的事实，只记进度并引用。
6. **对账不静默改写**：任何处置下设计态与实现态都只能经采纳变更（08 §9.3）。

## 非目标

- 不重构 E31/E32（memory_items 现状保留为同伴账）；不建 timeline_event。
- 不新建修订引擎（revise_prose 复用 VS-00E §8）、不新建反馈回路（dismiss 复用 33）、不新建裁决持久化（复用 32 §11 + adoption）。
- 不在质量评估层引入曲线模型（ADR-0020 非目标继续有效；E36 账是账本层记录，不用于质量门判定）。
- 裁决 UI 首版走档案页 + correction intent（AU-12 范式）；对话流决策面待 CP2+ 按需修订 ADR-0024，本 ADR 不新增卡型。

## 考虑过的方案

### 方案 A（采纳）：统一 LedgerEntry 信封 + 两级节拍 + 复用既有通道
一种对象五种 payload；增量自动记账（LOW）+ 周期报告作者裁决；修订/反馈/裁决全部挂接既有机制。基建一次建成，第六种账零基建。

### 方案 B（否决）：五张独立表
查询直白但采纳边界/探索面/面板/trace 五处基建 ×5，与 25 §8 信封先例背离。

### 方案 C（否决）：扩展 memory_items 承载账面
复用最省，但把"进度视图"混进"事实记忆"（06 §4.5 治理边界被破坏），且 MemoryType 语义漂移；账面查询按 subject/design_ref 的形态也与记忆召回过滤正交。

## 后果

- 正向：漂移从静默累积变为账面可查、报告可拦；面板/探索/写作上下文三个消费面共享同一账源；M2 类缺陷（Q5）获得机器化暴露路径。
- 代价：采纳链路多一个异步维护 hook；每 10-20 章一次批量对账 run 的算力；五账逐 CP 落地期间账面覆盖不全（诚实标注，不伪造账本存在——06 §5.0 缺失处理）。
- 同批文档修订（本 ADR 生效即执行）：25 §5/§8.1 扩员与切分注记、ADR-0018 §3 module 白名单加 `ledger`、00c §4/§6/§7/§9 回填、ui/43 §5 第 9 模块注记、schemas 登记、acceptance AU-13 立档。
