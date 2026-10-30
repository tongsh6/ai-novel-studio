# B72：作者行为离线 LLM 语料扩增（P2）

- 状态：**doing（2026-10-31 CP0 设计 done；CP1 离线生成实现与原始批次待实施，尚未调用模型或修改正式 corpus）**。
- 类型：验证资产与外部生成工具；实现交由其他实现者，本文维护执行状态与证据。
- 来源：B70 交付后审计确认当前仅 17 cases、15 条人工模板 + 2 条确定性模板生成，尚无真正 LLM 扩增。作者明确选择先做一次 P2 离线语料扩增，再处理 P0/P1 的运行/动作缺口。
- 上游：[B70](B70-author-behavior-corpus-and-state-exploration.md)（done，验证基础设施）；设计真源：[作者行为离线语料扩增设计](../../docs/design/acceptance/author-behavior-offline-corpus-expansion.md)。
- 关联：B34 目标缺口、B41 verdict、B42 实模证据分层；本任务的生成调用不是产品模型行为证据。

## 1. 目标与完整范围

在只读合成目标/状态/人工种子的前提下，建立“核心冻结回归库 + 作者风格探索库 + 多轮作者旅程”三层语料资产。执行顺序为：最多 60 个候选校准 → 300–500 个核心语义原始候选 → 分批扩展作者风格探索与多轮旅程 → 代表性真实 UI 和夜间分层抽样。

作者画像（persona）是独立覆盖维度，逐步扩展至 20–30 个，记录表达、委托、澄清耐心、采纳、纠正/反悔、资料粘贴和多作品行为，而非只换措辞。长期路线目标为核心 300–500 条、探索 2,000–5,000 条、多轮 100–300 条；这些是路线量级，不要求单批凑齐或全部精审。

每个候选必须有 `persona_id`、`asset_layer`、`boundary_tags` 和 `semantic_cell_id`，覆盖报告同时输出 semantic/persona coverage。首批覆盖现有 F1–F5，补 F5 holdout，并允许为 F2/F3 execute 准备新 holdout；execute runner 未支持前保持 not-run。多轮补充/纠正/反悔在 additive 格式和 runner 就绪前只进入 candidate pack。

核心纪律：生成≠冻结≠执行≠PASS；模型不得自动接受自己的候选，不得把生成调用写成 B42 产品模型行为证据。

## 2. 非目标与依赖

- 不读取作者真实作品、私有日志或 secret；首批只用合成资产。
- 不按数量凑语料，不自动追加 `cases.yml`，新候选无真实失败不得标 regression。
- 不等待 P0 的 6 个旧 not-run cases 或 P1 新动作先完成；这些缺口不由本任务销账。
- 不在本批实现多轮 runner，不要求真实模型产品语义运行或 I10。
- 真实页面 CP4 只需每目标族及代表性 persona 的受支持新案例；不支持的新 execute 案例留后续执行覆盖。

## 3. 开工七问

1. **Contract**：复用 author-behavior targets/states/cases/oracles/coverage v1；新增 generation manifest/candidate 与 `author-behavior-personas/v1` sidecar，不改生产 contract。
2. **Invariant**：生成来源可追溯；accepted 才可 generated_frozen；holdout 不参与调词；declared/executed/evaluated 分离；核心/探索/旅程分层；无真实作品数据；缺证据不 PASS。
3. **Boundary**：只改 `quality/acceptance/author-behavior/`、离线 `scripts/`、外部 `frontend/slice-verify/`、test/support fixture 和文档；不改生产 `apps/*/lib` 或 `frontend/src`。
4. **Consumer**：现有 author-behavior validator、真实 UI runner、后续 P0/P1 实施者与语料审核者。
5. **Proof**：manifest/candidate/persona 正反例、去重和 holdout 泄漏测试、semantic/persona coverage、corpus validator、代表性真实页面与夜间分层抽样。
6. **Acceptance Driver**：复用 `author-behavior-corpus` 外部 Playwright + `quality_accept`，独立 fixture 与隔离 DB，操作真实 WorkspaceChat；产品新增验收感知逻辑 **no**。
7. **Exploration**：不涉及产品模型获取作品知识；生成模型只读合成目标/状态。正式案例若涉及作品事实引用，后续执行仍按 B42 证据链，不由本任务代签。

## 4. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 冻结生成 manifest/candidate/persona、三层资产、批次矩阵、去重/泄漏、审核、holdout、真实 UI 与隐私边界 | **done（2026-10-31）**：见设计真源；未调用模型、未改正式 corpus |
| CP1 | 校准与核心语义原始批次：先完成 ≤60 校准并复核质量，再开放 300–500 核心扩增；manifest、persona、boundary_tags、原始响应/候选、预算/失败/终止证据齐全；不直接改正式 corpus | todo |
| CP2 | 核心案例过滤、审核与冻结：接受/拒绝原因、去重/泄漏与 semantic/persona coverage、provenance/split、validator；证明关键边界与作者行为差异增长 | todo |
| CP3 | 作者风格探索库与多轮资产：分批扩展 persona 探索资产和旅程候选；分层、每批 manifest 与覆盖报告齐全；长期 2,000–5,000 + 100–300 是路线目标，不用单批数量冒充完成 | todo |
| CP4 | 真实 UI、夜间分层抽样与交接：每目标族及代表性 persona 有受支持新案例的真实页面证据，或如实 blocked 且 CP4 不标 done；更新 declared/executed/evaluated 和 not-run；旧 P0/P1 缺口不销账 | todo |

CP1 生成不等于冻结，CP2 冻结不等于全部执行，CP3 资产数量不等于真实页面覆盖，CP4 抽样不等于真实模型或全量作者风格验证。全部范围未闭环前不得标 B72 done。

## 5. 首批实施约束

- 校准最多 60 个候选，校准通过后才开放核心扩增；核心新增冻结预期约 50–100 条，不设上限或凑数下限。
- 每个候选必须有 `persona_id`、`asset_layer`、`boundary_tags`/`semantic_cell_id` 和 `new_boundary | new_persona_behavior | wording_variant` 审核价值。
- 核心案例逐条审核；探索案例按 persona/边界抽样审核；探索发现的新失败经缩化与人工确认后才晋级核心回归。
- 新案例默认 dev、holdout 或 explore；holdout 同时按语义边界与 persona 分层冻结，F5 至少一个候选。
- 原始候选、拒绝候选、失败调用和旧 manifest 均只读保留；各阶段及 persona/多轮子批次使用独立 generation id，不重复计数。
- 正式接受只写既有 `cases.yml` 与必要 validator/fixture；生成运行证据落 `artifacts/author-behavior/`。
- 真实页面抽样必须使用独立 fixture 刺激源，不能读取 case expected/oracle 作为响应答案。

## 6. 验证与恢复

- 文档/排期：`node scripts/next_task_check.mjs`。
- 格式与工具：既有 `node scripts/author_behavior_check.mjs` 及相关 node:test；本机缺 PyYAML 时如实记阻塞，不绕过标准解析器。
- 真实页面：既有 `bash scripts/quality_accept.sh author-behavior-corpus --surface browser` 或对应当前注册入口；证据写 `artifacts/slice-verify/` 与 `artifacts/author-behavior/`。
- 实现完成后执行覆盖范围内的项目门禁、I1/I2/I3 和静态扫描；不得用生成调用或 oracle 单测替代真实页面抽样。
- 恢复时先读设计真源、CP 状态和 generation manifest；不得把原始候选当作已接受语料，不得从历史 verdict 推断当前 HEAD 通过。

## 7. 当前状态与下一步

当前只有 CP0 设计与任务登记，尚无生成器新实现、模型调用、候选包或新冻结案例。实现者下一步按设计 §5–§6 实现 manifest/candidate 与 CP1 原始批次；模型资源与生成调用预算在实际执行前单独核对。
