# 作者行为离线语料扩增设计（P2）

> 状态：后续实施设计基线（2026-10-31）。作者同意优先于 P0/P1 启动 P2；本文只授权设计、生成器与外部验证资产实现，不代表已调用模型、已扩增语料或已取得场景 PASS。
>
> 上游：[作者行为语料生成与状态探索验证设计](author-behavior-corpus-and-state-exploration.md)；执行状态由后续 B72 原任务维护。

## 1. 为什么可以先做 P2

P2 的输入是已冻结的目标、状态和人工种子，输出是离线候选语料。它不依赖 execute prose、采纳/编辑/断线恢复等 runner 缺口，因此可以与 P0/P1 并行或先行。

先做 P2 的价值是：后续补状态和动作时已有更多表达可复用，而不是先扩 runner 后才发现语料仍然只有少量人工句子。

必须保持边界：**生成不等于冻结，冻结不等于执行，执行不等于真实模型语义通过。** 新案例在真实运行前一律是资产覆盖，不得写 executed/evaluated 或 PASS。

## 2. 目标与非目标

### 目标

- 先用小规模批次校准，再按**语义边界矩阵**进行正式离线 LLM 扩增，而不是只增加同义句。
- 同时覆盖目标、对象、授权、上下文、确定性、限制条件和表达风格；每个候选必须声明自己新增的边界。
- 产出完整 generation manifest、候选包、语义覆盖/去重/泄漏报告和人工冻结记录。
- 为 F5 补充 holdout，为 execute 路径准备新的 holdout 候选；后者在 runner 支持前保持 not-run。
- 用少量新案例穿过现有真实 UI runner，证明格式、fixture 和判卷可消费。

### 非目标

- 不每次提交都调用生成模型；日常测试只读冻结资产。
- 不让生成模型修改产品 prompt、定义自己的正确性或签署模型行为 PASS。
- 不把生成调用当作 B42 产品模型行为证据。
- 不读取作者真实作品、私有日志或 secret；首批只用已冻结的合成目标/状态。
- 不自动把模型输出追加到 `cases.yml`，不按数量凑足语料或填满无意义组合。
- 首批正式冻结仍以单轮案例为主，避免同时改变 `author-behavior-cases/v1` 和多轮 runner；多轮补充/纠正/反悔可先生成候选，但须等待 additive 格式与执行设计，不能拼接成单句冒充多轮。
- 不要求 P0 的 6 个旧 not-run cases 或 P1 的新动作在本批一并完成，它们仍按原缺口承接。

## 3. 输入与语义边界扩增矩阵

### 3.1 只允许使用的基础资产

- `target-templates.yml`：目标、状态维度、允许结果和禁止行为。
- `states.yml`：当前 S1/S2/S3 及后续已正式冻结的合成状态说明。
- `cases.yml`：现有人工种子、既有表达、split 和已覆盖边界。
- `oracles.yml`：用于保持语义边界，不作为生成响应的“标准答案”。

输入生成器的内容应是必要的目标/状态/表达指引，不应把完整私有项目日志或真实作品交给模型。P1 新状态只有在对应实现者正式冻结后才能成为生成输入，P2 不反向修改其状态真源。

### 3.2 语义边界维度

| 维度 | 必须覆盖的差异 | 例子 |
|---|---|---|
| 作者目标 | 查询、讨论、生成、修订、保存、拒绝、开局 | “只想知道进度”与“把设定存下来” |
| 对象与指代 | 明确、省略、同名、多目标、无目标、失效对象 | “改第二段”在单候选与双候选中的不同结果 |
| 授权边界 | 只讨论、可产候选、明确保存、明确采纳、禁止写入 | “先聊聊”与“存下来”不能混同 |
| 上下文状态 | 空作品、部分正文、pending、stale、跨作品、读取失败/unknown | 同一句话在不同事实状态下应有不同后果 |
| 确定性与歧义 | 事实充分、信息不足、两个合理对象、事实冲突 | 直接回答、先探索、必要澄清或诚实缺口 |
| 操作范围 | 追加、局部修订、整章重写、只排版、前文不变 | “接着写，前面别动”与“全章重来” |
| 多意图与限制 | 请求中包含两个目标或显式排除动作 | “想几个书名，但别写正文” |
| 表达风格 | 简略、口语、省略、犹豫、自我修正、情绪化 | 风格变化不得改变授权与对象语义 |
| 对话序列（后续格式） | 补充、纠正、反悔、跨轮指代 | 先拒绝后恢复、先限定范围后改主意 |

`boundary_tags` 是候选的必填元数据。只有表达风格变化而没有新增语义边界的候选，应标为低价值同义变体，不得用来制造“覆盖增长”。

### 3.3 作者画像（persona）契约

作者风格是独立于语义边界的正式维度。新增 `author-behavior-personas/v1` sidecar，每个 persona 至少定义：

- `persona_id`、创作经验、题材/叙事偏好和常见作者目标。
- 表达方式：简略/详细、口语/书面、省略/指代、错字或中英混合等。
- 委托程度：希望 AI 自主推进还是希望逐步讨论。
- 澄清耐心、采纳习惯、对写入/覆盖的敏感程度。
- 纠正/反悔频率、长输入与资料粘贴习惯、多作品/恢复行为。
- 多轮行动倾向，而不仅是句子风格。

首批校准选择约 8–12 个有显著行为差异的 persona，正式库逐步扩展到 20–30 个。persona 不得使用现实人口属性刻板印象，也不声称代表真实人群；它们是行为与表达模型。

基础画像至少覆盖：简短直接、详细规划、模糊探索、谨慎控制、高度委托、频繁纠正、资料粘贴、指代省略、写作新手、类型小说熟练作者、多作品并行，以及悬疑/人物/世界观等不同创作优先级。

### 3.4 三层语料资产与总体规模

| 层 | 稳定期目标量级 | 管理与用途 |
|---|---:|---|
| 核心冻结回归库 | **300–500 条** | 高风险语义边界、作者主权、负例和真实失败；逐条审核，PR/release 使用 |
| 作者风格探索库 | **2,000–5,000 条** | 20–30 persona × 多语义边界/表达/状态；机器过滤、分层抽样、夜间探索 |
| 多轮作者旅程 | **100–300 条** | 补充、纠正、反悔、长会话和恢复；按 persona 行为驱动，需 additive 多轮格式/runner |

这些是全周期目标，不是一次生成或一次人工审核任务。核心库与探索库必须分开：探索资产只有运行后才有执行结果，晋级核心回归必须经失败缩化与人工确认。

### 3.5 分批扩增策略

**阶段 A：校准批次，最多 60 个候选。**

- 验证生成质量、manifest、persona、去重、审核和冻结流程。
- 预计 shortlist 约 15–30 条，质量不足允许更少。
- 校准通过后才扩大生成预算，不将校准阶段的通过标准反向调成只追求数量。

**阶段 B：核心语义扩增，300–500 个原始候选。**

- 按“目标族 × 语义边界 × 合法状态 × persona × 表达风格”生成，不做无意义全笛卡尔积。
- 预期新增约 50–100 条高价值核心案例；这是规划量级而非上限或凑数指标。
- F5 至少提供一个独立 holdout；F2/F3 execute 新表达可冻结，但 runner 支持前明确 not-run。

**阶段 C：作者风格与多轮扩展。**

- 分批次扩展至 2,000–5,000 条探索资产和 100–300 条多轮旅程候选，不要求一次生成或全部精审。
- 每个 persona 先覆盖关键语义边界，再增加表达变化；不得只给同一作者画像批量生产同义句。
- 多轮候选在 additive 格式和 runner 就绪前只进入 candidate pack，不拼接成单句冒充多轮，也不计入已执行旅程。
- 新案例默认进入 dev、holdout 或 explore；没有真实失败证据不得标 regression。

## 4. 离线生成流水线

```text
冻结基础资产 + 语义边界矩阵 + persona 契约 + 生成配置
→ 阶段 A：≤60 候选，校准生成/审核/冻结
→ 校准证据复核，未通过则不扩量
→ 阶段 B：300–500 原始候选，形成核心语义扩增
→ 阶段 C：分批扩展作者风格探索库与多轮旅程候选
→ 结构校验与原始候选只读保存
→ 精确去重 / 近义聚类 / 泄漏与结构过滤
→ 语义边界 × persona 覆盖分析 + 候选 shortlist（机器建议，不是正确性结论）
→ 核心案例逐条审核；探索案例按 persona/边界抽样审核
→ 冻结 accepted cases + rejected/unknown 原因
→ validator / split 校验 / corpus hash 更新
→ 代表性真实 UI 抽样与探索批次
→ 语义/persona 覆盖 + declared / executed / evaluated 分开报告
```

原始候选、拒绝候选和失败生成批次必须保留，不能只保存最终通过样本。重新生成不得覆盖旧 manifest 或候选包。阶段 A/B/C 及每个 persona/多轮子批次必须有独立 generation id；后续阶段不得把此前候选数量重复计入原始扩增分母。

## 5. Generation manifest 契约

每次生成前写独立 manifest，建议 schema 为 `author-behavior-generation-manifest/v1`，至少包含：

```yaml
schema: author-behavior-generation-manifest/v1
generation_id: ab-YYYYMMDD-<short-seed>
created_at: <timestamp>
git_head: <commit>
base_corpus_sha: <current-cases-and-targets-hash>
generator:
  generator_version: <implementation-version>
  provider: <approved-provider>
  model: <requested-model>
  actual_model: <provider-reported-or-unknown>
  params: <temperature/top_p/max_tokens/seed等>
  prompt_template_sha: <sha>
input:
  stage: calibration | core_semantic | persona_exploration | multi_turn
  asset_layer: core | exploration | journey
  target_ids: [F1..., F2..., F3..., F4..., F5...]
  state_ids: [S1..., S2..., S3...]
  persona_ids: [<本批作者画像>]
  semantic_cells:
    - target_id: <目标>
      boundary_tags: [object_ambiguous, discussion_only]
      state_id: <合法状态>
      persona_ids: [<本单元覆盖的作者画像>]
      styles: [brief, colloquial, self_correcting]
      max_variants: <数量>
  source_case_ids: [<允许使用的seed>]
  max_candidates: <本批预算>
privacy:
  synthetic_only: true
  real_work_data: false
budget:
  max_calls: <number>
  max_duration_minutes: <number>
output:
  candidate_uri: <artifact-path>
status: preregistered
```

生成结束后以 additive 结果记录 actual_model、调用数、失败数、原始响应/候选 hash 和终止状态。生成调用的证据用于复现语料来源，**不进入产品模型行为 PASS 分母**。

## 6. 候选包与审核记录

候选包与正式 `cases.yml` 分离，建议 `author-behavior-generation-candidates/v1`。每个候选至少包含：

- `candidate_id`、`generation_id`、`target_id`、`state_id`。
- `persona_id`、`asset_layer: core | exploration | journey`。
- `expression`、表达风格、源 seed 引用和 `sequence_kind: single_turn | multi_turn_candidate`。
- `boundary_tags` 与所属 `semantic_cell_id`；必须说明相对既有语料新增的语义边界，不能只写“更口语”。
- 由目标模板建议的 expected，而非模型自行发明的新 oracle。
- `normalized_expression_sha`。
- 审核状态 `pending / shortlisted / accepted / rejected / unknown`。
- 精确去重、近义聚类、语义重复和泄漏标记与原因。
- 审核人、审核时间、split 建议、审核说明及接受价值 `new_boundary | new_persona_behavior | wording_variant | rejected`。

只有 `accepted` 候选才能转为正式 case，并在正式资产中记录：

- `provenance.kind: generated_frozen`。
- 可定位到 generation manifest 的 generator/source ref。
- `expression_frozen: true`。
- 审核后的 target/state/expected/split/tier。

拒绝原因至少区分：语义偏离、状态不成立、不自然、重复、holdout 泄漏、含实现指令、期望无法判定、生成格式错误。拒绝样本不计入冻结覆盖，但保留在候选包供审计。

## 7. 生成提示与独立性

生成提示只描述：

- 作者目标和合成状态。
- 需要的自然表达风格。
- 不得出现的产品实现术语。
- 输出结构与数量。
- 必须保留的限制条件。

生成模型不得看到“选这个回答就会 PASS”之类判卷指引。目标 allowed/forbidden 可以经离线模板用于审核，但生成响应与判卷器必须继续保持独立。

可使用另一个模型做自然度/重复性辅助排序，但它只能给建议，不能代替人工接受，也不能评价产品输出。没有第二模型不构成阻塞。

## 8. 去重、近义与泄漏控制

### 8.1 确定性检查

- 空白、标点、全半角和大小写归一后的精确重复。
- 同 split/跨 split 的 normalized text 冲突。
- 空文本、过短无语义文本、实现术语和输出结构错误。
- target/state/source ref 是否合法。

### 8.2 近义聚类

首版不强制引入新依赖，可用现有运行时能实现的 token/字符 shingle 做候选聚类；embedding 只能在项目已有依赖或许可明确后使用。

相似度只用于 shortlist 和人工提示，不能自动证明两个句子语义等价。相同表达在不同状态可能是必要的同句异境，不得仅因文本相同就删除。

### 8.3 Holdout

- holdout 在任何产品调词/修复前按目标、状态、persona 和表达风格分层选定并冻结。
- holdout 不得与 dev/regression 共享 normalized text；近义聚类也必须披露。
- 优先使用独立生成 seed、独立模板或独立批次；同一模型生成不等于完全独立，只能声称“未参与调词”，不能声称真实用户独立样本。
- 失败后可查看结果，但不得根据该失败修改 holdout 表达或删除难例；修复需求进入 dev，原 holdout 保留。

### 8.4 语义边界与作者画像覆盖报告

正式扩增必须额外输出 `semantic_coverage` 与 `persona_coverage`，至少报告：

- 既有冻结案例、原始候选、shortlist、accepted、rejected 各有多少，按 core/exploration/journey 分层。
- 每个语义边界单元的合法状态、persona、表达风格、split 和来源。
- `new_boundary`、`new_persona_behavior` 与 `wording_variant` 的比例，防止同义句或单一 persona 主导扩增。
- 每个 persona 覆盖的目标、边界、状态、多轮行为和缺口，不能只统计 persona 总条数。
- 尚未覆盖、只有候选未冻结、已冻结未执行、已执行未评估的边界与 persona 组合。
- holdout 在语义边界与 persona 两个维度的近义泄漏和集中风险。

完成判定优先看关键语义边界和作者行为差异是否新增有效案例，而不是原始生成数或冻结总数是否达标。任何覆盖率都只代表声明资产，实际执行仍按 declared/executed/evaluated 另算。

## 9. 低成本人工审核

人工不审全部原始输出，只审机器过滤后的 shortlist：

1. 是否符合作者目标与状态。
2. 是否像真实作者表达，而非产品说明书。
3. 是否带来新表达或新边界，而非仅换词。
4. allowed/forbidden 是否仍然成立。
5. 是否适合 dev 或 holdout。

涉及 execute、对象歧义、写入授权和 holdout 的候选必须逐条确认；明显重复、格式错误和低价值候选可批量拒绝。机器不得自动接受。

## 10. 冻结、版本与可追溯性

- 正式冻结只修改既定 `cases.yml` 及必要的 validator/fixture，不新建平行语料真源。
- 新 case id 不复用旧 id，provenance 链到 generation manifest。
- 冻结后重新计算 corpus hash；manifest 的 base hash 与新 hash 分开保存。
- 生成候选包和审核报告可放 `artifacts/author-behavior/` 作为运行证据；被正式接受的语料仍只能以 `quality/acceptance/author-behavior/cases.yml` 为真源。
- 真实失败后续转 regression 仍走 B70 promoter，不因模型生成来源直接获得 regression 身份。

## 11. 真实页面抽样与证据边界

P2 可以先于 P0/P1 完成，但必须至少用一小批新冻结案例证明现有 runner 可消费：

- 每个目标族至少选择 1 条当前 runner 支持的新案例。
- 使用隔离合成 DB 和独立 fixture，经真实 WorkspaceChat 输入并采集原有 verdict/coverage 证据。
- 新 fixture 只提供刺激响应，不读取新 case expected/oracle 作为答案。
- execute 或新动作尚不支持时选择其他合法案例，不为凑通过把 execute 改成 ask_author；不支持的新案例保持 not-run。
- 浏览器/确定性证据不代签真实模型语义或 native 覆盖。

抽样通过只证明新资产能被当前机制链消费，不证明所有新案例或真实模型语义通过。

## 12. Checkpoint 与完成标准

| CP | 范围 | 完成标准 |
|---|---|---|
| CP0 | 设计与预注册格式 | 本文冻结；无模型调用、无正式语料变化 |
| CP1 | 校准与核心语义原始批次 | 先完成 ≤60 校准并复核质量，再开放 300–500 核心扩增；manifest、persona、boundary_tags、原始响应/候选、预算/失败/终止证据齐全；不直接改正式 corpus |
| CP2 | 核心案例过滤、审核与冻结 | shortlist、接受/拒绝原因、去重/泄漏与 semantic/persona coverage、provenance/split 完整；validator 通过；关键语义边界与 holdout 缺口如实报告 |
| CP3 | 作者风格探索库与多轮资产 | 分批扩展 persona 探索资产和多轮旅程候选；核心/探索/旅程分层、每批 manifest 和覆盖报告齐全；长期 2,000–5,000 + 100–300 是路线目标，不用单批数量冒充完成 |
| CP4 | 真实 UI 抽样、夜间探索与交接 | 每目标族及代表性 persona 有受支持新案例的真实页面证据，或如实 blocked 且 CP4 不标 done；分层抽样、declared/executed/evaluated 和 not-run 完整；旧 P0/P1 缺口不被销账 |

CP4 只要求代表性真实页面与探索证据，不要求几千条资产全部运行；其余新案例的执行覆盖仍按后续批次承接。长期规模未达时只能报告路线进度，不能宣称完整作者风格库已建成。

## 13. 实现边界与开工七问

1. **Contract**：复用现有 targets/states/cases/oracles/coverage v1，新增 generation manifest/candidate 与 `author-behavior-personas/v1` sidecar；不改生产 contract。
2. **Invariant**：生成≠冻结≠执行≠PASS；真实来源可追溯；holdout 不调词；无真实失败不标 regression；无真实作品数据；核心/探索/旅程分层。
3. **Boundary**：仅限 `quality/acceptance/author-behavior/`、离线 `scripts/`、外部 `frontend/slice-verify/` 和 test/support fixture；不改 `apps/*/lib` 或 `frontend/src`。
4. **Consumer**：首个消费者是现有 author-behavior corpus validator、真实 UI runner 与后续 P0/P1 实施者。
5. **Proof**：生成 manifest/candidate/persona 正反例、去重和 holdout 泄漏测试、semantic/persona coverage、validator、真实 UI 与夜间分层抽样；模型生成调用本身不是产品行为证据。
6. **Acceptance Driver**：复用 `author-behavior-corpus` 外部 Playwright/quality_accept 入口；产品新增验收感知逻辑 **no**。
7. **Exploration**：不涉及产品模型获取作品知识；生成模型只读合成目标/状态，不读私有作品。后续正式案例若涉及作品引用，仍走 B42 证据链。

## 14. 完成后的诚实边界

首批 P2 完成只能声称“完成了一次可追溯的离线语料扩增，并证明代表性新案例可被现有真实页面链消费”。它不能声称：

- 已形成广泛真实作者代表性语料。
- 所有新案例已执行或所有负例已覆盖。
- 真实模型语义、多轮行为或文学质量已验证。
- P0/P1 的既有运行和动作缺口已关闭。
