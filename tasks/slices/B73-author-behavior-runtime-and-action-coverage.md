# B73：作者行为运行链与动作覆盖补强

- 状态：**in_progress（CP0–CP2 已完成，CP3 门禁与静态扫描闭环进行中）**。
- 类型：B70 后续 P0/P1 验证实现；只扩外部真实页面 driver、冻结验证资产、隔离 seed/test-support 与判卷，不重开 B70 基础设施范围。
- 设计真源：[作者行为语料生成与状态探索验证设计](../../docs/design/acceptance/author-behavior-corpus-and-state-exploration.md) §8–§17；上游执行事实：[B70](B70-author-behavior-corpus-and-state-exploration.md) §6.3–§8。
- 开工 HEAD：`338abd216ae6a8d9614995844c7e74fc3a957ab9`；当前复验 HEAD：`0f9d19116e513162ea744c019095553dbcfcff0d`。verdict 只绑定产生它的 HEAD，不继承旧 PASS。
- 数据与模型边界：只用合成作品和 `ARTIFACT_DIR/database` 隔离 DB；真实作品/stage 数据不改，真实模型未授权、不加载/调用。确定性 provider 只证明机制，不代签模型语义或文学质量。

## 1. 范围与完成标准

### P0：旧语料与运行硬事实闭环

1. 在真实 `WorkspaceChat` 页面跑完旧 17 cases，补齐 C-F1-003、C-F1-G01、C-F3-G01、C-F2-001、C-F2-003、C-F3-002；不得以局部 oracle 测试替代页面证据。
2. F2 正文 execute 与 F3 明确保存 execute 经完整主链生成 TENTATIVE 候选；采纳前权威 canon/原文 hash 不变，候选目标 ref 与真实章/作品绑定。
3. 10 个 negative traps 分别保存“状态实际构造、刺激实际到达、oracle 实际判定”的证据；declared/executed/evaluated 分开。合法路径反误杀与违规检测分别记录，不能复制 trap id 冒充覆盖。
4. HO3 用真实重复动作/重试验证候选、登记、receipt 或 canon 不产生重复副作用。
5. 在当前 HEAD 按影响面复验固定回放与探索场景；失败批次只读保留，不覆盖旧证据、不反复重跑换分。

### P1：会改变正确行为的状态与动作

- 状态：同名章、多候选、stale、跨作品/失效对象、读取失败/unknown、多轮补充/纠正/反悔。每类必须说明改变的是哪条正确行为，并留下真实页面轨迹与外部事实。
- 动作：采纳、拒绝、编辑后采纳、重复确认/取消、断线/重开恢复；纳入 seeded 探索的行动模型、逐步 G1–G6 和覆盖汇总，不只写一次性 helper。
- 完整 native 矩阵、真实模型语义、I10 文学质量不在本任务代签；若未完成必须留在开放缺口。

## 2. 开工七问

1. **Contract**：消费既有 `author-behavior-{targets,states,cases,oracles,fixtures}/v1`、`author-behavior-coverage-report/v1`、TurnResult/adoption receipt 与 B41 `quality-verdict/v2`。只做 additive 观察/覆盖字段；不改变生产决策、卡片或采纳契约。
2. **Invariant**：G1–G6；execute 只产 TENTATIVE，未发生真实 UI 作者动作不得写 canon；目标 ref/原文 hash/作品隔离可核；重复动作幂等；unknown 与证据缺失不 PASS。
3. **Boundary**：只改本任务需要的 `quality/acceptance/author-behavior/**`、场景 manifest、`scripts/**`、外部 `frontend/slice-verify/**`、test-support provider/seed 和本文。生产 `apps/*/lib` 与 `frontend/src` 不改；B72、B39/AU15 在途文件与他人 WIP 不动。
4. **Consumer**：首个消费者是开发者通过 `scripts/quality_accept.sh` 驱动的真实浏览器工作台；后续消费者是 nightly/PR 覆盖审核与失败回归。
5. **Proof**：node/ExUnit 只证明 fixture 和判卷局部逻辑；完成证据必须来自外部 Playwright 的真实发送/点击/编辑/重开，结合 WS、截图、app log、隔离 DB 前后快照和 receipt。trap 检测变异测试与真实页面合法路径分开举证。
6. **Acceptance Driver**：复用 `author-behavior-corpus.mjs` 与 `slice_verify.sh` / `quality_accept.sh`，按 manifest 运行；产品新增验收感知逻辑：**no**，无新增生产 env、slice 识别、DOM hook、自动操作或 provider。
7. **Exploration**：本 slice 不新增作品知识供给或专用 prompt packet。execute/只读查询沿用真实探索与 AgentRun 主链；外部观察只读真实 TurnResult、请求/日志和 DB，不声称实模语义或观察使用已证明。

## 3. Checkpoint 与真实页面证据

| CP | 范围 | 状态与证据 |
|---|---|---|
| CP0 | 旧报告/动作语义盘点、标准 PyYAML、真实观察与 trap 数据形状、失败测试 | **done**：系统 `python3` 缺 PyYAML，使用 `artifacts/b73-tooling/venv` 隔离安装项目指定 6.0.3，不改全局环境；`author_behavior_observation.mjs` 分开 TENTATIVE/canon/hash/ref/trap 证据，负例先行后接实现。 |
| CP1 | P0：17/17 回放、F2/F3 execute、TENTATIVE/canon/hash/ref、10 traps、HO3、当前 HEAD verdict | **done（证据分层见下）**：断点前 17-case 与 execute 链路证据齐全；当前 HEAD 的 negative/actions 两个新场景 verdict pass。17-case 旧批次不冒充当前 HEAD 全量 verdict。 |
| CP2 | P1：同名/多候选/stale/跨作品/读取失败、多轮动作与恢复、seeded 行动模型 | **done**：当前 HEAD 的 actions/read-failure 两个独立场景 verdict pass；seeded v2 逐步行动与转移覆盖；另有 seed 42 变体证据。 |
| CP3 | 影响面复验、标准门禁、I1/I2/I3、静态扫描闭环与最终边界 | **in_progress**：后端/前端/不变量/局部与场景验证已完成；最终静态扫描 18/21 pass，Credo 已恢复，剩余他人 B30 native 证据过期阻断与 4 条历史 gitleaks 处置；全量 format 另有 23 个非本任务文件失败，Tauri DMG 为 dev warning，未宣称全绿。 |

### 3.1 P0 链路与 execute 证据（断点前批次，非当前 HEAD verdict）

- `artifacts/author-behavior/b73-full17-validated-20261031/`：真实页面固定回放 **17/17 pass**，补齐旧 6 cases；`summary.json`、`observations.json`、逐 case 截图、WS、prompt 与隔离 DB 快照齐全。
- `artifacts/author-behavior/b73-execute-validated-20261031/`：F2 两条 execute 均为 `prose_fragment` / `prose_drafting_with_quality_v1`，F3 明确保存为 `world_rule_seed` / `world_building_with_context_v1`；全部 `TENTATIVE`，canon 与 accepted 原文 hash 零变化，`production_write_performed=false`。
- 这些证据只证明对应批次的真实链路；后续 HEAD 复验以 §3.2 的新场景 verdict 和影响面门禁为准，未把本目录写成当前 HEAD 的 17-case verdict。

### 3.2 当前 HEAD 独立场景与 B41 verdict

三份 verdict 均为 `quality-verdict/v2`、`status=pass`、evidence **4/4**、attempt=1、timeouts=0、`model_behavior=not_applicable`，且 `git_head=0f9d19116e513162ea744c019095553dbcfcff0d`：

| 场景 | 真实页面结果与关键证据 | verdict |
|---|---|---|
| `author-behavior-negative` | 10/10 traps declared=executed=evaluated；每条 `state_constructed/stimulus_reached/detection_passed=true`。7 个故意违规 case 命中指定 fail，2 个合法路径 pass，覆盖同名错绑、讨论强写、虚假完成、短指代执行、空作品与自动采纳反误杀。证据：`artifacts/slice-verify/author-behavior-negative/{coverage.json,negative-stimuli.json,observations.json,summary.json}` | `artifacts/slice-verify/author-behavior-negative/verdict.json` |
| `author-behavior-actions` | 10/10 有序 explore cases pass；HO3 executed/evaluated。重复直接采纳只有一个 receipt/accepted 增量；多候选、跨作品、离线重开、两次取消、stale 拒绝且编辑保留、编辑后采纳、pending/accepted 重复登记均通过。证据：`artifacts/slice-verify/author-behavior-actions/{exploration.json,action-coverage.json,observations.json,coverage.json,summary.json}` | `artifacts/slice-verify/author-behavior-actions/verdict.json` |
| `author-behavior-read-failure` | 隔离库真实 `chapter_summaries` 故障使 `chapters=unavailable`；页面明确“无法读取/不知道”，`unknown_as_empty=false`、`supplied_used_conflation=false`，HO6 executed/evaluated；inject/restore 均留痕。证据：`artifacts/slice-verify/author-behavior-read-failure/{observations.json,read-fault.json,coverage.json,summary.json}` | `artifacts/slice-verify/author-behavior-read-failure/verdict.json` |

### 3.3 Seeded 行动覆盖

- 当前 HEAD `author-behavior-actions`：`author-behavior-explorer/v2`、seed `20261031`、22 步、22 个转移键，包含 double_accept、reload、cross_work、offline_reopen、cancel_edit、stale、edit_then_accept、repeat registration；`exploration.json` 逐步状态与 `action_counts` 完整。
- 变体证据 `artifacts/author-behavior/b73-action-seed42-validated-20261031/`：seed 42 为 23 步、10/10 pass、22 个转移键；证明恢复顺序/取消次数可随 seed 变化，不声称覆盖全部随机动作组合。

### 3.4 失败现场与根因（只读保留，不计 PASS）

`artifacts/author-behavior/` 下保留 execute 子轮关联、跨实例占用、HMR 中断、世界设定路由、历史 fixture 误匹配、pending 修订路由、候选类型漏判、E05 漏执行、读取失败 fixture 误匹配等目录，例如：

- `b73-execute-first-failure-20261031/`：driver 未关联 `parent:agent:N` 子 TurnResult；产品实际上已产 TENTATIVE，修复 driver 而非产品。
- `b73-cross-instance-failure-20261031/`、`b73-action-cross-instance-startup-20261031/`：其它 WIP 占用默认端口，后续使用高端口和隔离 seed 核对。
- `b73-negative-hmr-interruption-20261031/`：其它前端 WIP 触发整页重载，后续 `SLICE_VERIFY_STATIC_FRONTEND=1` 冻结本次页面资源。
- `b73-world-route-failure-20261031/`、`b73-historical-fixture-mismatch-20261031/`：世界设定与历史 fixture 路由错误，修复当前输入匹配和 profile 一致性。
- `b73-action-pending-route-failure-20261031/`：通用 fixture 错走 adopted 修订，改为从真实 pending 目录绑定原稿/修订稿 ref。
- `b73-action-e05-missing-20261031/`：runner 漏发冻结 E05，不能算完成；补发后才形成最终 10/10。
- `b73-read-failure-wrong-fixture-20261031/`：同表达命中旧 fixture，增加本批 case 过滤和可见 unknown 断言后复验。

未通过换分方式删除这些分母；最终 PASS 均来自修正后的新批次，失败目录不作通过证据。

## 4. 实现边界与验证记录

- 外部观察：`author_behavior_observation.mjs` 分开候选增量、canon 增量、accepted 原文 hash、真实章 ref、子 turn parent 关联与 trap 状态/刺激/判卷。
- 判卷：execute 与 `author_content_registration` 均要求目标族匹配的 TENTATIVE 候选；历史 CONFIRMED/receipt 可支持真实完成声明，零事实负控仍 fail；HO 执行/判定来自逐步证据，不从 case 引用复制。
- 场景：`author-behavior-negative`、`author-behavior-actions`、`author-behavior-read-failure` 已注册 `quality/acceptance/scenarios.yml` 与独立 manifest，统一复用 `quality_accept.sh` + B41 verdict，没有第二套 verdict。
- 隔离：所有场景只用合成 seed 和 artifact DB；读取故障只允许 `artifacts/slice-verify` 下的 DB，结束恢复表名；真实作品/stage 未修改。
- 并发：使用独立高端口与静态前端避免他人实例和 HMR 干扰；没有修改 `trace_replay_service.ex`、`trace_writer.ex`、B64 seed、通用 external-ui-driver、native verifier 或 Tauri WIP。

### 当前门禁记录

- 已通过：`PATH=artifacts/b73-tooling/venv/bin:$PATH bash scripts/quality_manifest_check.sh`（218 scenarios / 2 drafts / 220 manifests，PyYAML 6.0.3；B64 缺 manifest 的既有 warning 不属于本任务）。
- 已通过：`node --check frontend/slice-verify/author-behavior-corpus.mjs`、`cd frontend && pnpm exec eslint slice-verify/author-behavior-corpus.mjs`、`bash -n scripts/slice_verify.sh`、`node scripts/author_behavior_check.mjs --json`。
- 已通过上述三个真实页面场景及其 B41 verdict。
- 后端：`mix format --check-formatted`、`mix compile --warnings-as-errors`、`mix credo --strict`、xref cycles、`scripts/arch_check.exs` 均通过；全量 `mix test` **2396 tests / 0 failures**。
- 前端：`pnpm typecheck`、`pnpm lint`、`pnpm test`（43 files / **636 tests**）通过；`frontend_audit.sh` 为 26 pass / 2 warn（本机 DMG bundle 失败，脚本按 dev warning 返回 0），`check_design_trace.sh` 19/19 通过。
- 局部与不变量：author-behavior **47/47** node:test；I3 3/3、I1 4/4、I2 3 pairs 全 pass；`next_task_check` 最终通过。
- 格式：`author-behavior-corpus.mjs` 与 `slice-verify/README.md` 的 Prettier/ESLint 通过；全量 `pnpm format:check` 仍有 **23 个非本任务文件**失败，未为求绿修改他人文件。
- ub-mode：crapper/dryer/mutator 对当前 JS 变更分别报告 `No source files to analyze/mutate`，不将其写成 mutation 通过证明。
- 静态扫描闭环：最终 `bash scripts/ai_static_scan.sh --top 10` 为 **18/21 pass**，Credo 已恢复通过；4 条 gitleaks 均为既有处置（B63 文档、E10 spec id、Pencil fileToken 为 false_positive，ProjectGod 历史项为 accepted_risk），另 1 条 `task-done-manifest` 为他人 B30 native 证据过期 pending，touched=0。未将这些问题登记为 B73 修复或豁免，CP3 保留 in_progress。

## 5. 剩余边界（不得隐藏）

- 真实模型未授权，未加载/调用；所有 PASS 都是确定性机制证据，不证明真实模型语义、观察使用或文学质量。
- 完整 native 矩阵未覆盖；当前独立场景均为 browser + Playwright，不以浏览器证据冒充 Tauri/native。
- seeded 生命周期保留必要依赖顺序，只改变合法恢复顺序和取消次数，不声称穷尽动作组合或广泛真实作者代表性。
- 读取失败只覆盖 `chapters`，不替代其它来源的故障矩阵。
- 17-case 是断点前真实页面证据；本次没有把它重复运行来换当前 HEAD 标签，当前 HEAD 的独立 verdict 以 §3.2 为准。
- B72、B39/AU15、B64、trace replay/writer 及其他 WIP 不属于本任务，未修改；相关 warning/失败不借本任务 PASS 抵消。
