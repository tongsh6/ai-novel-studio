# B70：作者行为语料生成与状态探索验证体系

- 状态：**done（2026-10-30 CP0–CP3 交付）**：格式冻结/固定回放/seeded 状态探索/覆盖扩展（5 目标族 17 cases）/PR 子集/夜间多 seed/失败转回归/真实模型 blocked 预注册入口；真实模型语义运行与 I10 仍按 B42/作者授权，不在本任务内代签。
- 类型：验证基础设施；仓内管理、运行时外挂、证据内生、判卷外部，不新增生产验收感知能力。
- 设计真源：[作者行为语料生成与状态探索验证设计](../../docs/design/acceptance/author-behavior-corpus-and-state-exploration.md)；实现由其他实现者承接，本文只维护执行状态、证据与未闭环后果。
- 来源：作者指出现有真实页面验收多为从历史日志提取的固定输入与操作剧本，覆盖过窄；独立开发阶段不能依赖持续人工创作生产语料。作者确认采用“少量人工目标模板 + 离线生成与冻结 + 自动状态探索 + 失败驱动回归”的方向，并同意先登记任务再开始 CP0。
- 关联：[B27](B27-systematic-prompt-and-intent-integration.md) 自然语言语义与 20 例案例、[B34](B34-author-intent-corpus-validation.md) 历史语料与覆盖矩阵、[B37](B37-acceptance-wait-supervision.md) 外部运行监督、[B40](B40-judgment-era-acceptance-reanchor.md) 场景重锚、[B41](B41-quality-evidence-foundation.md) manifest/verdict、[B42](B42-model-behavior-evidence-tier.md) 机制/模型行为证据分层。

## 1. 问题与目标

现有体系能够证明固定剧本穿过真实主链并留下可信证据，但不能充分证明不同自然表达、作品状态和操作顺序下仍具有正确行为。I1/I2/I3 证明内容来源与输入贯通，不证明语义理解和作者行为覆盖。

本任务建立一套低人工维护成本的验证体系：

1. 人工只维护少量作者目标、状态、允许结果与禁止行为，不逐条编写长期 UI 剧本。
2. 离线生成并冻结多表达、多上下文语料，记录来源、版本、开发/回归/保留/探索分组；日常测试不重复调用生成模型。
3. 数据驱动回放与状态驱动随机探索共用外部真实 UI 主链；每步检查全局硬不变量。
4. 自动保存种子、轨迹和证据，失败去重并尽可能缩化为最小复现，修复后沉淀永久回归。
5. 结果进入既有 B41/B42 证据与分层体系；确定性机制、真实模型行为、文学质量不得互相代签。

## 2. 范围与非目标

### 范围

- `quality/acceptance/` 中的目标模板、案例、状态与判卷/覆盖契约及场景注册。
- `scripts/` 中的离线生成、校验、选择、运行、oracle、覆盖统计和失败缩化工具。
- `frontend/slice-verify/` 中产品之外的共享 UI 动作、观察与证据采集能力。
- test/support 或外部 harness 的隔离 fixture/seed；不得注册进生产 runtime。
- PR 小子集、后台/夜间探索、真实模型语义子集的执行分层。

### 非目标

- 不在 `apps/*/lib` 或 `frontend/src` 增加验收开关、自动操作、slice 识别、专用 DOM hook 或上报事件。
- 不重建 B41 verdict、B42 evidence chain、native manifest 或另一套任务/文档目录。
- 不用 LLM 生成器自行定义并自行签署正确性；语义未知可记 `unknown`，不得硬判 PASS。
- 不把模型合成语料冒充广泛真实用户代表性，不把文学质量并入机制 PASS。
- 不一次性重写全部既有固定场景；它们继续作为机制回归，新能力先与少量代表场景交叉验证。

## 3. 开工七问

1. **Contract**：消费 B27 `b27-semantic-cases-v1` 的自然输入/夹具/允许路径/禁行为/保留集思想，B34 历史语料与覆盖矩阵，B41 `quality-verdict/v2`、manifest/退出码，B42 evidence requirements/evidence chain/release layer。CP0 冻结作者目标模板、冻结案例、状态、oracle、provenance/split、覆盖报告五类格式及版本策略；如需改变生产 contract，必须另列承接，不在验证工具中暗改。
2. **Invariant**：未授权/未采纳零 canon 写入；不得操作错误作品、对象或版本；重复动作不得产生重复副作用；页面完成声明必须有持久事实；supplied≠used；缺证据/旧 HEAD/blocked/unknown 不得 PASS；保留集不得按具体措辞调词；确定性替身不代签真实模型行为。
3. **Boundary**：只改 `quality/`、`scripts/`、外部 `frontend/slice-verify/`、测试专用 fixture/support 与本任务文档。生产 `apps/`、`frontend/src` 默认不改；任何真实产品观测缺口须证明其用户/审计价值并另行接受。
4. **Consumer**：首个消费者是开发者经 `scripts/quality_accept.sh` / `scripts/tauri_slice_verify.sh` 驱动的当前 `WorkspaceChat` 真实工作台；后续消费者为 B27/B39/B42 的语义与求证验证及 PR/nightly/release 审核。
5. **Proof**：格式/生成器/oracle/选择器有自动化正反例；同一模板实际产生不同表达与状态；负例必须能被抓到，不能只证明 happy path；最小数据驱动闭环必须由外部脚本操作真实页面并保存网络/日志/持久化证据；状态探索失败必须可按种子复现。
6. **Acceptance Driver**：复用现有 `quality_accept.sh`、`tauri_slice_verify.sh` 与 native allowlist，新增的数据驱动场景必须登记 manifest，由产品外 driver 输入、点击、确认、拒绝或采纳并读取外部证据。产品新增验收感知逻辑：**no**。
7. **Exploration**：本任务不新增产品作品知识供给或固定 prompt packet；涉及模型声称使用作品事实的案例，复用现有只读探索目录和 B42 Base→Observation→后续真实请求→used refs 证据链。语料生成模型不获得作者私有作品事实，除非另有明确授权与脱敏边界。

## 4. 目标结构

```text
人工目标模板（少量）
→ 离线生成/去重/过滤/分组
→ 冻结语料与状态矩阵
→ 数据驱动回放 或 状态驱动探索
→ 真实 UI / socket / application / persistence
→ 外部硬不变量 + 语义允许集合 + 覆盖统计
→ B41 verdict / B42 证据分层 / artifacts
```

硬事实自动判定；语义按允许结果集合与禁行为判定；文学质量仍归独立真实模型/人工评价。作者模拟器或生成模型不得给自己判分。

## 5. Checkpoint 与完整闭环

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 盘点 B27/B34、现有 UI driver、dogfood/native runner、B41/B42 的可复用边界；冻结目标模板、案例、oracle、provenance/split、覆盖报告格式与执行分层；确定首批代表场景和负例 | **done（2026-10-30）**：`quality/acceptance/author-behavior/` 五类格式冻结（README + targets/states/cases/oracles + 5 JSON Schema + coverage-report example）；校验器 `scripts/lib/quality/author_behavior.mjs` + CLI + 10 条正反例测试；复用映射/首批目标族与负例/执行分层见下 CP0 记录 |
| CP1 | 最小数据驱动闭环：至少 3 个作者目标族，包含多表达、多状态及同句异境/歧义负例；共享外部 UI driver 穿过真实主链；自动硬断言与证据 verdict；生成器/oracle 正反例通过 | **done（2026-10-30，确定性闭环）**：数据驱动浏览器 spec `frontend/slice-verify/author-behavior-corpus.mjs` 从冻结 corpus 子集（F1/F2/F3 × S1/S2/S3，6 cases，含同句异境与空作品歧义负例）驱动真实工作台；隔离 DB + 状态 seed；corpus-aware 确定性替身（仅 test/support，env 注入，产品无感知）；oracle 6/6 pass、0 fail/unknown；`quality_accept` verdict pass（quality-verdict/v2, evidence 4/4）；覆盖报告 `author-behavior-coverage-report/v1` 通过；生成器/validator/oracle 正反例 20/20 node:test。真实模型语义不在本 CP 代签 |
| CP2 | 状态驱动探索：动作选择、随机种子、全局不变量、状态/转移覆盖、失败轨迹保存与缩化；至少一个非固定操作顺序场景由外部真实页面闭环 | **done（2026-10-30）**：seeded 探索器 + 浏览器场景 `author-behavior-explore`；seed 20261030 同 seed 两次 plan_hash/序列一致、seed 7 序列不同，均 15 steps/6 cases pass；每步 oracle G1–G6；真实页面负控失败保存 + 同类别缩化（minimal 1 步）通过。动作限于切换作品/发送（采纳/编辑/断线等留 CP3） |
| CP3 | 覆盖扩展与分层：按 B34/新发现缺口扩展目标族；PR 受影响子集、后台/夜间探索、真实模型语义子集入口；失败转回归、完整门禁与文档索引；真实模型语义结论仍归对应产品/B42 流程，不以 stub 代签 | **done（2026-10-30）**：新增 F4 delegation/短指代、F5 work_setup 空作品开局（B34 缺口），corpus 17 cases/5 targets；11-case 探索真实页面 verdict pass（5/5 目标族执行）；PR 子集选择器+测试；夜间多 seed detached runner（预注册/预算/心跳/终止）实跑 seeds 11/13 2/2 pass；真实模型 release-real-llm blocked 入口 + holdout-only 预注册（4 cases，未加载模型）；失败转回归 promoter（只接受硬违规、拒绝 fixture 不兼容、指纹去重）+ 台账。真模语义/I10 仍不代签 |

CP1 只是最小实现 checkpoint，不替代 CP2 状态探索和 CP3 覆盖/分层后果；全部计划内范围未闭环前不得将 B70 标 done。

## 6. CP0 工作清单

- [x] 核对现有案例/fixture/场景格式，明确哪些直接复用、哪些 additive 扩展，避免第二套 verdict 或语义语料真源。（记录：`artifacts/task-audit/2026-10-30-b70-cp0/audit-map.json`）
- [x] 核对 `external-ui-driver.mjs`、`dogfood-runner.mjs`、native verifier 的动作、观察、等待与证据边界，确定共享抽取点；不把新语料继续堆进大型场景分支。（CP1 通过数据驱动场景驱动既有外部入口，不新增产品钩子）
- [x] 冻结目标模板、冻结案例、状态/oracle、来源与分组、覆盖报告格式；保留集与生成集版本不可混淆。（`author-behavior-targets/states/cases/oracles/coverage-report/*/v1`）
- [x] 冻结低成本执行策略：生成一次长期复用、PR 按影响选择、后台跑扩展、真实模型只跑语义子集。（见 CP0 记录执行分层）
- [x] 选择 CP1 代表目标与负例，定义如何证明自动判卷能拒绝错误对象、越权写入、重复副作用和虚假完成。（F1/F2/F3 × S1/S2/S3 × 9 cases；负例陷阱 T-R1/T-R2/T-W1/T-W2/T-B1/T-B2；CP1 需补 oracle 变异测试）
- [x] 明确真实日志/作品的使用边界：默认使用合成样书；真实材料须授权、脱敏，生成模型不得默认读取。（案例 provenance 默认 human_template/合成状态；真实数据未使用）

## 6.1 CP0 记录（2026-10-30 done）

- 复用边界（只读审计，`artifacts/task-audit/2026-10-30-b70-cp0/audit-map.json`）：B27 案例卡 policies/retention/same-sentence/zero-tolerance 思想（不复制 20 例、不重跑 40 episode）；B34 抽取口径与高频缺口（progress_query/work_setup/discussion/world_foreshadow/delegation）生成 F1/F3；`external-ui-driver.mjs`/`dogfood-runner.mjs` 的动作/观察/等待/证据与长跑监督复用；`quality_accept.sh`/`tauri_slice_verify.sh` 的 manifest/tier/verdict/native 入口复用；`manifest.mjs`+`yaml_bridge.py` 为唯一 YAML 解析源；B41 `quality-verdict/v2` 与 B42 `quality-evidence-chain/v1`/release layer 不重造；B37 等待预算/心跳/失败缩化复用。
- 冻结格式：`quality/acceptance/author-behavior/` 下 `author-behavior-targets/v1`、`author-behavior-states/v1`、`author-behavior-cases/v1`、`author-behavior-oracles/v1`、`author-behavior-coverage-report/v1`；5 个 JSON Schema + 示例报告；validator/CLI/tests。
- 首批代表：目标族 F1-progress-query / F2-chapter-write-or-rewrite / F3-world-foreshadow-boundary；状态 S1-partial-multichapter / S2-empty-skeleton / S3-pending-candidate-context；9 条冻结案例（dev 4 / regression 2 / holdout 3，explore 留 CP2）；负例陷阱 T-R1/T-R2/T-W1/T-W2/T-B1/T-B2（虚构进度、无 receipt 完成声明、同名章错绑、无作者采纳自动写入、讨论强制写、明确采纳请求只回复）。
- 判卷分工：硬事实（canon 写入/对象身份/重复副作用/虚假完成/读取失败未知）由 oracle 自动判；语义按目标族允许结果集合；`unknown` 不判 PASS；文学质量 I10 排除，不代签。
- Provenance/split：human_template/derived_frozen/generated_frozen；holdout 不参与调词，失败转回归必须新 id 并保留原失败；holdout 表达不得与 dev/regression 同表达（validator 硬检查）。
- 执行分层：PR（格式 + 少量 pr-smoke 代表）/nightly（冻结语料回放 + 硬 oracle）/explore（状态探索 + seed/缩化，CP2）/real-llm（仅 holdout 未调词子集，独立预注册、单槽/unload、结果入 B42 release-real-llm）。
- 验证：`node scripts/author_behavior_check.mjs --report quality/acceptance/author-behavior/coverage-report.example.json` 通过；`node --test scripts/lib/quality/author_behavior.test.mjs` 10/10（含重复 id、未知引用、holdout 泄漏、provenance 缺失、未知动作/效果/禁止行为、目标/状态无案例、覆盖报告计数/sha 不一致）。
- 残余（不冒充完成）：尚无数据驱动 runner/状态探索器/场景 PASS；真实模型 holdout 未预注册运行；覆盖报告仅格式示例，真实统计在 CP1/CP2 生成；真实作品数据未使用；I10 不代签。

## 6.2 CP1 实施进度（2026-10-30，进行中；CP1 未完成）

- 已完成（判卷/证据侧，确定性）：
  - `scripts/lib/quality/author_behavior_oracle.mjs`：消费冻结 corpus + 外部 driver 观察，产出每 case `pass/fail/unknown`、违规类别（映射全局不变量）与 `author-behavior-coverage-report/v1`；allowed action/effect 集合 + 硬违规（错对象/未授权 canon 写/重复副作用/虚假完成/讨论强制 execute/auto-adopt）+ 证据不足/`supplied unknown` → unknown（不判 PASS）。
  - CLI 扩展：`node scripts/author_behavior_check.mjs --evaluate <observations.json> --coverage-out <report.json>`；覆盖报告进入既有 schema 校验。
  - 正反例测试：`scripts/lib/quality/author_behavior_oracle.test.mjs` 7 条（全部 case 允许集可 pass；disallowed action、错对象、未授权写、重复副作用、虚假完成、讨论强制 execute 均被抓；证据缺失/unknown 不 PASS；覆盖报告生成与 schema 校验）；与 corpus 校验器合计 17/17 node:test。
- 未完成（阻断 CP1 标 done 的页面闭环）：
  1. 数据驱动浏览器 spec `frontend/slice-verify/author-behavior-corpus.mjs`（外部 Playwright，复用既有 workbench 可见语义）执行 corpus 子集（步骤：按状态切换作品 → 发送冻结表达 → 等 turn_result/候选 → 采集观察 → 调用 oracle → 写 summary/覆盖报告）。
  2. 确定性 provider fixture（test support，仅浏览器 runner 注入；按 corpus 表达返回允许的 reply/ask_author 行为）与 `scripts/slice_verify_server.exs`/`slice_verify.sh` 的 provider/seed 接线；不注册生产 runtime。
  3. 状态 seed `scripts/seed_author_behavior_states.exs`（S1/S2/S3 合成作品）与隔离 DB。
  4. 场景注册（`scenarios.yml` + manifest，evidence verdict）与 `quality_accept` 跑通；覆盖报告落 `artifacts/author-behavior/`。
- 诚实边界：当前只有判卷器与格式/正反例，没有真实页面数据驱动 run；不得把 oracle 单测当 CP1 完成。真实模型语义子集仍属 CP3/B42 流程。

## 6.3 CP1 完成记录（2026-10-30 done，确定性闭环）

- 交付：
  - 数据驱动 spec `frontend/slice-verify/author-behavior-corpus.mjs`：Playwright 操作真实浏览器工作台——按状态切换合成作品（作品菜单可见语义）、发送冻结表达、从隔离 DB 读取该轮最终 `judgment_decided`/`awaiting_author`、canon 计数与 assistant 文本；调用 oracle/CLI 生成 observations/coverage/summary；不硬编码逐条剧本（表达来自 corpus）+ 少量 driver 逻辑。
  - 状态 seed `scripts/seed_author_behavior_states.exs`（S1 部分多章/S2 空骨架/S3 待采纳候选，合成作品）；隔离 DB 落 `ARTIFACT_DIR/database`。
  - 确定性语料替身：仅在 `scripts/slice_verify_server.exs` 既有 slice_verify 上按 `AUTHOR_BEHAVIOR_CORPUS_JSON` env 增加 corpus-aware 分支（reply/ask_author）；产品 runtime 不读 env/语料，不新增验收钩子。
  - 场景注册 `author-behavior-corpus`（browser/pr-smoke/slice_verify，manifest + scenarios.yml），`quality_accept` verdict pass；覆盖报告 schema/示例更新。
  - 离线确定性生成器 `scripts/lib/quality/author_behavior_generator.mjs`（模板生成候选 + generated_frozen provenance，仅候选、不自动冻结/不标 holdout）+ 3 条正反例测试；corpus 增加 2 条 generated_frozen 表达（dev），总 12 cases（dev 6/regression 3/holdout 3）。
- 运行证据（`artifacts/slice-verify/author-behavior-corpus/` + 归档 `artifacts/author-behavior/author-behavior-corpus-20261030/`）：
  - 子集 6 cases：C-F1-001/C-F3-001/C-F2-002/C-F1-002/C-F3-003/C-F3-005（3 目标族 × 3 状态；dev/regression/holdout；C-F3-001 vs C-F3-005 同句异境；C-F2-002 空作品歧义 → ask_author）。
  - oracle：total 6 / pass 6 / fail 0 / unknown 0；每 case 最终 action 来自隔离 DB 真实事件；canon 计数零变化（ask_author 不写）。
  - `quality_accept`: `[accept-verdict] status=pass schema=quality-verdict/v2 evidence=4/4`、exit 0；覆盖报告 `runs {tier:pr-smoke, provider:slice_verify_author_behavior_corpus, total6, pass6, fail0, unknown0}`，gaps 诚实列出未跑 6 cases + `real_model_semantics_not_covered_by_deterministic_run`。
  - 静态/门禁：全量 mix test **2374/0**（test/support 变更）、format/compile -Werror/credo strict/xref/arch、I1/I2/I3、manifest 211 scenarios、task_done manifest、静态扫描仅 gitleaks 历史处置；前端 ESLint 含新 spec 通过。
- CP1 收口补强（对齐外部验收设计 §196/§356–357）：
  - **刺激源与判据独立**：新增 `quality/acceptance/author-behavior/fixtures.yml`（`author-behavior-fixtures/v1`）只声明表达→最小 reply/ask_author；SliceVerify 的 corpus 分支只读 fixtures，不再读 case expected/oracle；oracle 独立判卷。validator 增加 fixture 引用/表达一致/pr-smoke 覆盖检查。
  - **缺省观察不放行**：evaluator 仅在 `supplied_status == "known"` 时允许 pass；缺省/unknown 一律 unknown（补测试）。
  - **覆盖报告 declared/executed/evaluated 分离**：`negative_traps_declared/evaluated`、`oracles_declared/executed/evaluated`；不再把声明复制成执行；报告 schema/示例/测试同步。当前 run：declared oracles 5 / executed 4 / evaluated 4；traps declared 6 / evaluated 0（无违规触发，如实记录）。
- 诚实边界（不冒充）：本 CP 是**确定性替身 + 真实页面主链**接线/判卷闭环，不是真实模型语义 PASS；F2 仅覆盖 ask_author 分支（execute prose 路径留 CP3 real-model 子集）；未跑 corpus 的 6 个 case（含 execute 正例/负例）与 explore split；状态探索/失败缩化 = CP2；覆盖扩展/PR 选择/真模语义分层 = CP3。I10 不代签。

## 6.4 CP2 完成记录（2026-10-30 done，seed 状态探索）

- 交付：
  - `scripts/lib/quality/author_behavior_explorer.mjs`：mulberry32 seeded PRNG、`buildExplorationPlan`（pool 全 case 随机顺序 + 随机插入真实作品切换）、`summarizeExploration`（逐步结果/状态转移/覆盖/失败统计）、`shrinkFailureTrace`（贪心删除保留**同一失败类别**的最小序列，不冒充其他失败）、`failureFingerprint`；6 条正反例测试。
  - 复用同一外部浏览器 spec 增加 exploration 模式（`AUTHOR_BEHAVIOR_EXPLORE_SEED`/`_POOL`）：真实页面逐步执行计划，每个 send 后独立调用 oracle 判 G1–G6；落 `exploration.json`，失败时落 `failure-trace.json`（完整轨迹、缩化、replay_command、指纹）；页面等待均为有界；产品代码零感知。
  - 新场景 `author-behavior-explore`（browser/nightly/slice_verify，manifest + registry，212 scenarios）；`slice_verify.sh` 探索分支、`quality_accept` provider env 接线。
- 运行证据（`artifacts/slice-verify/author-behavior-explore/`；归档 `artifacts/author-behavior/`）：
  - seed 20261030（quality_accept）：**verdict pass**，15 steps/13 转移，6 cases 每步 pass，最终 6/6 pass。
  - 同 seed 复跑：`plan_hash=3173f4d42672…` 与首次完全一致、操作顺序一致、6/6 pass（种子复现）。
  - seed 7：`plan_hash=59d045ae5b0c…`、操作顺序不同、12 转移、6/6 pass（非固定操作顺序）。
  - 负控（seed 3，pool 故意含 C-F3-002 与 fixture 不兼容的刺激）：exit 1（预期）、真实页面执行后保存 failure-trace：`failures=[{step C-F3-002, action_not_allowed:reply}]`，缩化保留同一类别、minimal_steps=1（仅该 send）、replay_command 与 dedupe_fingerprint；批次只读归档，不当作产品缺陷或 PASS。
- 诚实边界：探索动作目前只有作品切换 + 发送（采纳/拒绝/编辑/离线恢复等动作留 CP3 或后续）；未在有效 pool 上触发真实失败（缩化路径由页面负控 + 单测证明）；确定性替身不代签真实模型语义/文学质量；随机探索不自动证明语义覆盖，未触达目标只记声明/缺口。

## 6.5 CP3 完成记录（2026-10-30 done，覆盖扩展与分层）

- 覆盖扩展（按 B34 缺口）：新增目标族 **F4-delegation-or-short-reference**（delegation/chitchat_noise/other_unclassified ≳9 历史样本，“你懂的/那个改一下/继续”不得猜对象自动执行/采纳）与 **F5-work-setup-empty-start**（work_setup 8，HIGH，空作品起名/开局先澄清或计划，不直接产正文/不虚构设定）；corpus 17 cases / 5 targets（dev 9/regression 4/holdout 4），新增 fixtures 5 条；oracles 增 4 个负例陷阱（T-D1/T-D2/T-S1/T-S2）。
- 真实页面覆盖证据（`artifacts/author-behavior/coverage-expanded-11cases/`）：探索场景 seed 20261030 pool=11 → **quality_accept verdict pass**，28 steps/18 转移，11/11 cases 逐步 pass；覆盖报告 targets：F1 2/F2 1/F3 3/**F4 3/F5 2** 全部执行；剩余 gaps 为未跑 6 cases（含 execute 路径/生成表达）与 real-model 未覆盖。
- PR 受影响子集：`scripts/lib/quality/author_behavior_pr_subset.mjs` + CLI + 4 测试；规则覆盖 corpus/harness/judgment/core/agent/domain/docs/tests/未知路径保守全选；示例：judgment_protocol+cases+design docs → tier nightly/17 cases；docs-only → none；未知 → 全选并标 conservative。
- 后台/夜间探索：`scripts/author_behavior_nightly.sh` 需先写 `author-behavior-nightly-preregistration/v1`（scope/seeds/budget/criteria/evidence_dir），逐 seed 预算 240s、心跳、pidfile、termination；detached 实跑 seeds 11/13：**2/2 pass**，证据 `artifacts/author-behavior/nightly-cp3-20261030T152315Z/`（preregistration/state/termination/heartbeat/results/per-seed summary）。
- 真实模型语义子集入口：`scripts/author_behavior_real_llm_plan.mjs` 生成 holdout-only 预注册（本 corpus 4 holdout cases；单槽/卸载命令/预算/判据/I10 不代签）；场景 `author-behavior-real-llm-subset`（release-real-llm, **blocked**）登记于 registry + manifest；**未加载/运行模型**，生成预注册 `artifacts/author-behavior/real-llm-prereg-20261030.json`。
- 失败转回归：`scripts/lib/quality/author_behavior_promote.mjs` + CLI + 2 测试；只接受含 G1–G6 硬违规的失败，fixture 不兼容/驱动失败明确拒转；输出 derived_frozen regression 候选（保留原失败指纹/plan_hash/violation）并写 `regressions.json` 台账；现有页面负控（fixture 不兼容）被正确地拒绝，无真实产品失败可登记。
- 门禁/索引：全量 mix test 与 I1–I3、node 测试 34/34、manifest 213 scenarios、task_done、静态扫描；文档索引 author-behavior README/scripts README/设计真源指针同步。证据 `artifacts/gates/2026-10-30-b70-cp3/`。
- 残余（不代签）：真实模型语义运行 blocked（需作者授权资源窗口+B42 预注册/证据链，单槽/unload 前置）；探索动作仍限切作品/发送（采纳/编辑/断线恢复未覆盖）；6 个 not-run cases（execute prose 路径等）；I10 文学质量只能作者指定负责人/时机盲评。

## 7. 验证与恢复

- 文档/排期：`node scripts/next_task_check.mjs`；差距来源变化时按规则运行 `bash scripts/gap_ledger.sh`。
- 工具局部：`node --test scripts/lib/quality/*.test.mjs` 及新增格式的既有测试入口；本机 PyYAML/Bash 依赖问题必须如实记录，不能跳过 manifest 后声称全绿。
- 真实页面：`bash scripts/quality_accept.sh <scenario-id>` 或 `bash scripts/tauri_slice_verify.sh <scenario-id>`，证据落 `artifacts/slice-verify/`。
- 完成实现后执行项目规定的后端/前端门禁、I1/I2/I3、静态扫描闭环；只改验证工具也不能省略其覆盖范围内的检查。
- 恢复时先读本任务 CP 状态与关联 manifest，再从对应 artifact/seed 恢复；不得从历史 PASS 推断当前 HEAD 通过。

## 8. 当前未闭环与下一步

CP0 冻结资产与设计真源已就绪，CP1 判卷器/覆盖报告已有局部实现，但数据驱动真实页面 run、场景 verdict、CP2 状态探索和 CP3 分层仍未闭环。实现者从设计真源 §15–§16 与上方 CP1 实施进度接续；不得把格式、oracle 单测或覆盖示例冒充页面 PASS。
