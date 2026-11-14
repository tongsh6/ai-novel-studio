# B84：全项目测试环境作用域、fixture 体系与剩余架构/测试债务

- 状态：**doing（A0完成；A1/A2六个局部实施单元前4个已提交、R01快照/capture两族随原R01整体保持WIP；**A3已收口**：Application流程、Channel 16模块、日志源头、Rust单测、裸Mix/config/test、其余runtime测试全部完成并本地提交；web回归196例62.2秒；A1/A2其余Node族、A4/A5与既有债务保留）**
- 来源：
  - [00f 能力图谱 P2-E](../../docs/design/00f-capability-atlas.md)：`novel_web` 193 tests / 532s 慢测试仍待收敛；`novel_common` 日志 I/O 部分已由 ADR-0034（`novel_telemetry`）闭环，本任务只承接 web 慢测试与剩余债务。
  - B71 审核轮架构 P2-10 记录与 2026-11-08 候选。
- 范围：
  1. 诊断 `novel_web` 慢测试根因（真实等待/时序重试/DB 初始化/外部依赖等分类，只读 profiling，先不改测试语义）；
  2. 在**不缩小覆盖**的前提下收敛耗时（如共享测试前置、减少真实等待、泄漏/超时治理；复用既有测试体系与 `scripts/lib/test_env.sh` 统一前置，不手写旁路脚本）；
  3. 剩余架构/测试债务核对（00f P2-E 剩余项逐条处置或登记承接）。
  4. 按作者2026-11-13新指令，整体审查全项目测试入口、fixture、初始化、隔离与退出；在既有框架和 owner 上设计统一环境作用域，从源头消除无必要的重复创建，不仅修R01。设计真源为 [quality-gates §2.5](../../docs/engineering/quality-gates.md)。
- 非目标：不为提速删断言/跳过测试/放宽验收；不引入新测试框架；不动产品行为。
- 验收：全量 `mix test` 覆盖不降、耗时基线前后对比、稳定性证据；每项债务有处置或明确承接；门禁（compile/credo/format/xref/arch/扫描）保持绿。
- 依赖：无外部窗口；可与 B81 设计/实现期并行，但改动只在测试/前置层，不触碰 B81 写域（若需共享文件须协调）。
- 恢复入口：本任务；证据在 `artifacts/` 与测试报告。

## 验收资产与规模治理债务登记（2026-11-12 复核）

以下债务由 2026-11-12 B71/B81 复核的 clean/架构审计登记，归属本任务（测试/验收资产层，
不改产品行为）。修复前不得把相关断言的"通过"当作有效验收证据。

1. **browser driver 与当前 UI 契约漂移（driver_stale）**：`frontend/slice-verify/external-ui-driver.mjs`
   仍有多处查询 `section[aria-label="推理"]`（约 8 处：`installReasoningStreamObserver` 及
   `driveAgentSessionTranscriptLazyPage` / `driveUa01AgentBoundedRosterToCharacterDesign` /
   `driveAgentConversationTurn` / `driveAgentProviderExecutionActivityRestored` 等），而前端
   `WorkspaceChat.tsx:930` 已移除该重复 landmark（「推理」现为 `agentRunTimeline.ts` 的可见
   label 文本，区域契约是 `aria-label="本轮创作过程"`）。这些场景在 `quality/acceptance/scenarios.yml`
   仍为 active，若在真实窗口运行会出现假阴性/超时。修复方向：改用用户可见语义
   （`[aria-label="本轮创作过程"]` 或时间线可见 label），改后必须重跑对应 Tauri/nightly 批次并
   保存证据；不得用旧 landmark 继续判绿。
2. **规模治理盲区**：`node scripts/check_module_size.mjs` 只扫 `apps/*/lib`、`apps/*/test`、
   `frontend/src`；`frontend/slice-verify/external-ui-driver.mjs`（41,360 行）与
   `native-tauri-verifier.mjs`（27,318 行）、`scripts/lib/native_ui/`（80 个 mjs）不在 ratchet 内，
   也没有 B78 拆分排期。处置建议：先把验收脚本纳入 module-size 观察名单（门槛可高于生产代码，
   如 1500–2000 行）并登记 baseline，再按「一次一个文件、独立 refactor commit」拆分；在此之前
   至少禁止在未登记情况下继续扩大这两个文件。
3. 已在本轮修复、无需跟进：`scripts/lib/native_ui/README.md` 索引补全 10 个漏列 mjs（含 g3）；
   `apps/novel_e2e/README.md` 补齐（目录可达性规则）。

## 2026-11-13 R00 核实的质量测试前置债务（可独立推进）

来源：[B87 R00 基线](B87-model-interaction-request-projection.md#95-验证状态与恢复)，HEAD `89b44a95` 的 [CI run 43294123379](https://github.com/tongsh6/ai-novel-studio/actions/runs/43294123379)。本节只登记测试前置层的具体修复范围；本任务仍未实施，不把代码问题笼统视作环境故障。

- `scripts/lib/quality/au15_preregistration_check.test.mjs` 直接调用真实仓库检查器，并读取 gitignored `artifacts/model-contracts/b39-cp1/au15-preregistration.json`；干净 CI 缺文件即失败。应让现有检查器消费显式输入/输出，测试使用隔离且自足的夹具；保留缺文件、缺前置、冻结状态等失败语义，不提交真实运行产物充当测试依赖。
- `scripts/lib/quality/evidence_chain.test.mjs:411` 在仓库 `tmp/` 未存在时调用 `mkdtempSync`，导致 ENOENT。复用该文件已有 `os.tmpdir()` 模式与测试清理；验证原本的拒绝覆盖/显式覆盖行为，不删断言。
- `scripts/lib/quality/manifest.test.mjs` 两项真实仓库断言硬编码 231/233，与实际 232/234 漂移。应按 registry/扫描来源分别校验集合、草案分离、重复/漏项和路径边界，另用小型固定夹具测精确数量；不能仅把常数加一或删除仓库完整性断言。
- 验收：上述完整质量 parser suite 在无用户 artifacts、无预建 repo/tmp 的干净 checkout 中通过；既有正反例仍有效；入口无模型/产品写入；`quality_manifest` 检查、NEXT/索引及适用 ub-mode 门禁通过。使用现有框架，不另建测试库。

本地 `mix test` 同 HEAD 为 3185 tests/0 failures，其中 web 196 tests/548.1 秒；旧 193/532s 是历史基线。远端 Dialyzer 与 Windows smoke 失败另见 B87 归因，不能由本节测试修复代签生产类型修复或 Windows 实测。

## 2026-11-13 B87 复核发现的既有 G2 判据复杂度（未整改）

现役 `scripts/lib/native_ui/authoring_g2_evidence.mjs` 的既有页面/候选验证职责过于集中。B87 R01 使用新鲜 Node LCOV 和真实 crapper 复核时，未修改函数体的 `pageCheck`（CC46）、`normalizeOrder`（CC13）、`g2CandidateEvidence`（CC22）、`visiblePageSurface`（CC22）等仍超 CRAP10；`git diff --unified=0` 证明本次修改只在原状态解析段及新增 AX 读侧，不能把整个文件说成已达标。完整证据为 `artifacts/model-contracts/b87-r01/20261113/method-v2/leader-crap-current.log` 与同名 JSON。

- 本任务继续承接这些**原有**验证职责的收敛：按输入边界/事实关联/页面观察分开，先核真实消费者和既有职责，不另建一套验收状态机；保留全部原正反例与真实页面场景。
- B87 R01 **新增/修改**的 `statusTokenKind`、`axTurnOutcome`、`capabilityGapFacts` 等超限不转嫁本任务，必须在 R01 内解决。
- 验收仍须真实覆盖与有意义的变异反例，不能通过移走文件、排除方法、降低阈值或抽出无消费者壳层掩盖复杂度；本登记不代表整改完成，也不代表认可既有判据正确。

## 2026-11-13 全项目测试体系审查与统一方案

### 授权与审查边界

作者要求先整体审查、查明已有入口与fixture机制，再设计统一作用域、初始化、隔离和退出；禁止另建平行测试框架。本阶段只读源码/现有记录并修改本任务与既有工程规范，不改测试实现、不清理既有残留、不运行测试/编译/变异/模型/页面。原NEXT执行保持暂停；本次审查不代表恢复B87的旧验证循环。

基线HEAD `e0976d98`，包括当前未提交R01实现。全仓非忽略源码清单在 `artifacts/b84-test-system-audit/20261113/source-inventory.json`：10个umbrella app，334个Elixir测试文件、81个scripts测试文件、53个前端源码测试文件、2个外部driver自测文件、1个含内嵌测试的Rust源文件、2个spike测试/支撑文件，共473个文件，**不是用例数量**。文件名、`node:test`导入及资源关键字用于导航，不用“文件内没出现cleanup”直接判泄漏。

3个dsh-worker事实采集任务均以`turn/end: error`结束（backend已进行19步，其余未进入采集），没有可验收交付；错误未暴露更具体原因，不归因于余额/网络/磁盘猜测。leader据当前源码完成以下入口及代表性生命周期穿透审查。现有运行记录只作为历史事实，本轮不把静态检查称为运行验收。

### 已有入口与机制清单

| 面 | 已有入口/fixture | 已核实作用域与退出 | 审查结论 |
|---|---|---|---|
| 后端工程门 | 根`mix.exs:check`，`apps/novel_persistence/mix.exs`的test alias | alias执行create/migrate；`config/test.exs`缺省按PID+partition选SQLite，显式`NOVEL_TEST_DB_DIR`供多命令共用 | 已有进程/分区隔离，不是每个后端case重建整库；尚缺跨入口统一的拥有/借用及文件退出契约 |
| Ecto用例 | `apps/novel_persistence/test/support/data_case.ex` | `Sandbox.start_owner!` + `on_exit(stop_owner)`，每case事务隔离 | 直接复用；不替换为手写清表或全局共享可变DB，不恢复全仓max_cases=1 |
| E2E app与实际场景 | `apps/novel_e2e/test/novel_e2e_app_smoke_test.exs`及外部场景入口 | 该app当前测试只证明模块可加载；真实页面场景在外部runner | 不因目录叫e2e就认定已有全链环境或覆盖；不为统一而搬进一套旁路页面 |
| Application/Channel | app/web `test_helper.exs`，`agent_run_cleanup_helper.exs`、`agent_event_relay_helper.exs`，web `ConnCase` | relay跟随调用者退出；Channel模块手工启停Sandbox，先await_quiescent再停owner | 已有进程与DB顺序约束；cleanup遍历整个supervisor且到期返回`:ok`，不能当成本case已全部退出的证明 |
| 共享后端fixture | `apps/novel_test/lib/novel_test.ex`、`TestRequestIR`、`TestProviderPrompt`；agent的`authoring_task_fixtures.ex` | novel_test只依赖common，提供纯契约与请求fixture；运行时替身留agent test/support | 保留纯/运行时边界，不把novel_test改成全局环境管理器 |
| Node脚本测试 | `node --test`，quality CI按`lib/quality/*.test.mjs`执行；另有`*_test.mjs`独立断言入口 | 各测试族自己定义fixture；`scripts/lib/test_env.test.mjs:16`已有创建后`t.after`回收的正确模式 | 复用既有模式，统一作用域，不能以“有公共setup函数”代替生命周期归属 |
| Node质量/原生证据fixture | `lib/quality/manifest.test.mjs:29/64`、`lib/native_ui/fixtures/authoring_confirmation_scenarios.mjs:389`、R01 temp helpers | manifest helper及其caller未注册目录退出；confirmation纯评估测试`:708`创建testDir未回收；另一batch测试`:262`的withBatch已有try/finally，不能混为同类 | 问题超出R01且已有正确模式；case只声明差异，纯规则移出DB构造，重型基准在运行内复用 |
| 共享Shell前置 | `scripts/lib/test_env.sh` | 解析/创建DB目录、create+migrate、HTTP/端口预检；已有caller可复用；无与申请对应的通用release | 是统一方案首要承接owner；明确父/子入口借用、初始化次数、reset边界和退出 |
| Vitest | `frontend/package.json:test` → `frontend/vite.config.ts`，只发现`src/**/*.test.{ts,tsx}` | 配置未声明统一globalSetup/setupFiles；文件内已有beforeEach/afterEach、unstubAllGlobals、store/timer复位 | 保留现有轻量测试；按需共享只读fixture，不引入不需要的浏览器/后端全局环境 |
| 浏览器外部场景 | `slice_verify.sh` → `frontend/slice-verify/external-ui-driver.mjs` | driver主体finally关闭browser，Shell有进程树退出；launch/newPage早于该try，早期失败需外层证明；固定artifact路径开跑时rm -rf | 复用真实入口，补部分初始化失败和退出归属；证据/scratch混用与覆盖迁到既有唯一批次机制 |
| Tauri原生场景 | `tauri_slice_verify.sh`、native batch、`native_ui_wait.mjs` | 原生模式拒绝复用已有artifact目录、独立DB/profile；EXIT/TERM/INT处理与`native_app_ownership.mjs`按独立可执行路径回收 | 直接复用；非原生分支的覆盖/reset与多处cleanup `|| true`需区分证据保留和退出失败，不复制第二套生命周期 |
| 真实Provider探针 | `probe_run.sh`、既有dogfood入口 | 已隔离MIX_BUILD_PATH、限制探针并发、保存原日志；真实模型服务由作者环境提供 | 继承共同run作用域，服务仅借用；不能为退出而停止作者模型或改全局设置 |
| Rust桌面单测 | `frontend/src-tauri/src/lib.rs`的`#[cfg(test)]`，CI `cargo test --locked` | 多处创建temp目录后在断言末尾remove_dir_all；panic可越过该语句 | 需要按Rust原生生命周期/外层owner归还资源，不引入Node作为Rust测试框架 |
| Python离线契约 | `scripts/model_contracts/model_interaction/check_all.py`与`paths.py` | 固定只读fixture、独立时间戳输出、拒绝覆盖已有summary；生成wire用于对照 | 已有输入/输出边界；保持为离线设计证明，不并入真实Provider测试，不把证据输出自动删掉 |
| CI/全量入口 | `.github/workflows/ci.yml`、`nightly.yml`、`ai_static_scan.sh`、`task_done.sh`、`quality_accept.sh` | CI给invariants/mix test分别指定DB目录；PR fast set与nightly全量分开；静态扫描先调用test_env前置 | 已有分层，不重建CI体系；本地/CI/嵌套入口统一作用域与退出，完整门禁保留 |
| Git提交入口 | 本机`core.hooksPath=/Users/loong/scripts/git-hooks`的pre-commit委托lefthook | 当前仓库未发现lefthook配置；本次文档提交实际提示未找到配置，退出0 | commit成功不代表质量门自动执行；A5须明确本地提交与既有gate的接线，不改全局hook、不复制第二门禁清单 |
| 技术spike | `spikes/v2_verification/mix.exs`与test_helper | 独立Mix项目和验证入口，不参与产品umbrella | 保留独立验证性质，资源仍受同一所有权原则约束；本轮未执行其外部依赖 |

### 根因与设计决定

**不是整个项目都没有fixture机制。** 缺陷是各机制的作用域与资源所有权未接成完整契约：前置helper、Case、进程清理、变异代码隔离各管理一部分，case又在共同系统临时目录创建不归外层管理的资源。

1. R01的`tempDir/setup`共享了构造代码，却仍按每次调用重造源库/快照/批次。其他Node族也有局部helper，不能把“统一函数”当作“只初始化一次”。
2. 已安装Mutator的`runner.py:88`继承环境，`workers.py:319`对每站点运行给定命令，`:446`只删除代码overlay；R01曾给每个站点同一整组snapshot/capture/CLI测试命令。代码隔离并未涵盖测试在系统TMPDIR中的数据。最后一次185站点并不是185份新基础数据的需求。
3. 并发上限只限制同时执行数，不能消除累计重建。把beforeAll放进每个反复启动的子进程同样不解决外层重复。
4. 正常路径末尾删除、超时返回成功或忽略cleanup错误，均无法证明资源已归还；当前Mutator把超时/任意非零视作killed，也不能独自区分基础设施失败。
5. “运行失败就保留整套临时库”和“退出时删除所有artifacts”都不成立。合成scratch、不可变模板、借用资源、构建缓存与必须保留的原始证据需要不同所有者和保留规则。

目标设计唯一维护于 [quality-gates §2.5](../../docs/engineering/quality-gates.md)：外层运行负责公共前置和退出；相同fixture规格在运行内初始化一次；worker隔离可变运行态；case只获得事务、最小数据差异或确需的可写副本。变异选择回到真实受测职责，完整集成验证作为独立阶段。

### 新实体/机制查重裁决

| 拟解决问题 | 已存在机制 | 裁决 |
|---|---|---|
| 全仓测试调度/结果平台 | Mix、Node test、Vitest、Rust、quality gates/acceptance/verdict | **不新建**框架、发现器或第二结果台账；现役入口接同一作用域 |
| 统一初始化与退出 | test_env.sh、process_tree.sh、native_app_ownership、框架hooks | **扩展现有owner**，补开始/借用/结束责任；不新增后台资源服务 |
| Node资源fixture适配 | test_env.test.mjs里的tempDir(t)、各域已有fixture helper | **提取并退役重复实现**；若需薄JS适配只放现有scripts/lib并登记，不另建目录树/DSL；不得从`.test.mjs`导入触发别的测试 |
| DB共享与隔离 | DataCase/Sandbox、NOVEL_TEST_DB_DIR、PID/partition、完整快照owner | **复用**；共享不可变模板，隔离事务/写入者；不新建通用备份/数据库池框架 |
| fixture规格与指纹 | 现有schema/seed/builder、manifest/source hash、构建指纹 | **复用现有来源**，只在运行内按实际输入派生；不新建跨日缓存服务或平行fixture注册表 |
| 运行所有权元数据 | 既有artifact tag、PID/路径、native run/cleanup证据，当前散落的目录变量 | **补最小缺口**：拥有/借用、父运行、规范路径、进程身份、保留类别；附着现有上下文/证据，不写产品AgentRun/DB。字段在实际消费者处同批迁移，不预造通用状态机 |

### 实施顺序与不缩水的退出条件

以下是本任务后续计划，**本轮未实施**。每步可以独立review/commit，但不能以局部helper完成关闭B84。

| 开工七问 | 本任务设计答案 |
|---|---|
| Contract | quality-gates §2.5、测试规范§5.7及既有test_env/Case/Sandbox/场景manifest；不改产品契约或授权语义 |
| Invariant | 不重复构造无必要基础环境；可变状态不串例；借用作者资源不被改/删；原始证据不丢；基础设施失败不冒充PASS/killed |
| Boundary | 测试支撑、测试配置、既有scripts入口、Vitest/Rust测试区与CI；生产行为、模型Prompt、作品Schema不在本任务写域 |
| Consumer | 现役Mix/Node/Vitest/Cargo测试命令、ai_static_scan/quality_accept/native batch；先让已有调用者消费统一作用域，不建未来消费者 |
| Proof | 初始化/租用/退出记录与外部文件/进程观察共同核对；纯集合零DB初始化、规格基准每run一次、写入隔离、异常与取消后无净增owned scratch；全回归覆盖不降 |
| Acceptance Driver | 机制用既有helper测试及受控子进程验证；改变原生runner时由既有真实Tauri外部driver验证owned实例启动/取消/退出和证据保留。产品验收感知新增必须为no |
| Exploration | 不物化作品要素、不改变模型作品知识获取，不适用；真实模型场景仍按其原slice证明Base/Observation/引用，本任务不能代签 |

本轮设计审查只验证来源、职责、复用和文档接线；上表运行证明留在后续实施步骤，不能由静态表格签署。

| 步骤 | 现有落点与范围 | 必须证明 |
|---|---|---|
| A0 审查与设计 | 本节、quality-gates §2.5、测试规范及既有索引 | 各语言/入口事实、复用裁决、作用域和验收边界可定位；不把静态证据当运行PASS |
| A1 统一运行责任 | test_env.sh及直接调用者、根Mix/现有框架入口、现有进程/原生归属helper | 裸入口与嵌套入口都有明确owner；同scope不重复初始化；借用路径不被reset/delete；故障退出不能假成功 |
| A2 Node fixture与验证粒度 | scripts各测试族、quality/native_ui既有pure owners/fixtures | 纯规则零DB/服务初始化；重型源模板按规格每run一次；仅有必要可写状态重置；先覆盖R01和quality/原生证据族，再按全仓清单迁移，不能停在R01 |
| A3 后端与Rust隔离 | DataCase、application/web support、test_helper、config/test、Rust现有测试模块 | Sandbox复用，拥有的后台任务先于owner结束；Application env等不串例；Rust断言失败也释放；保持现有依赖方向和纯novel_test边界 |
| A4 前端/场景/探针接入 | Vitest配置与现有hooks，quality_accept/slice_verify/tauri/native batch/probe/dogfood | 不给纯前端测试启动全环境；原生场景保持真实入口、独立可执行身份与证据；构建可复用，作者服务只借用；固定目录覆盖/退出吞错退役 |
| A5 集成与全量证明 | 既有CI/nightly/本地gate及B84原web慢测试范围 | 正常/断言失败/初始化失败/超时/取消/子进程被杀/宿主失联恢复；相同运行两次无净增owned scratch；并行隔离、必要证据不丢；原业务测试和真实场景覆盖不降 |

资源验收同时记录初始化次数、工作副本/事务数、资源峰值与退出残留，不能只量“删完剩多少”。纯变异点增加不应增加基础环境初始化数；真实修改文件/跨进程行为需要的可写副本仍允许，但要证明其必要性与有界生命周期。预算在小规模实测后确定，不以任意阈值、扩大磁盘或降低测试覆盖代替设计。

**尚未验证**：本轮没有运行故障注入、并行隔离、跨平台、真实UI或性能测量；473文件清单是源码普查，不是逐断言语义认证。57个文件命中临时资源关键词只是审查线索。原web慢测试的历史耗时不作为当前重测结果，所有既有债务保持开放。系统临时目录历史残留未删除，全局工具/配置未修改。

原生runner还包含macOS Keychain专项初始化（`tauri_slice_verify.sh:727`起）。更换HOME/路径不自动证明系统用户域状态隔离；其实际影响和恢复须在A4单独按平台事实核实，本轮未执行。统一scope不能自动授予修改系统偏好或密钥配置的权限。

### A0交付与校验

- 入口与fixture清单、根因、查重裁决及A1–A5计划见本节；唯一环境设计在quality-gates §2.5，测试规范§5.7与索引已接入。
- 证据目录 `artifacts/b84-test-system-audit/20261113/`：`source-inventory.json`为全仓文件普查，`source-anchors.json`绑定关键路径/行号/源码哈希，`worker-results.json`保留worker失败事实，`validation.json`记录文档检查。
- `git diff --check`、`node scripts/next_task_check.mjs --open`退出0；改动文档本地链接均存在，1378个实施源码/配置文件与本次审查前指纹一致。全仓文档标记扫描的24处占位相关匹配及13处旧slice范围匹配均在既有未改正文中，不据此改写历史文档或扩大本次范围。
- 本次没有执行测试/编译/变异/模型/页面，没有删除残留或改全局工具。A0完成只证明审查和设计交付，不能关闭B84实施，也不能给R01工程门签通过。
- 文档提交沿用Git hooks、未跳过；lefthook缺仓库配置的提示如上登记。实际通过的是本节列明的手动文档/索引/指纹核对，未声称pre-commit替代完整工程验证。

### A1/A2 首个实施闭环：Node质量manifest（2026-11-14 开始）

作者明确“开始”，授权进入既定实施顺序。首批不是只加清理：贯通现有Shell入口 → 运行作用域 → 只读fixture复用 → 纯规则/IO测试分别消费 → 统一退出。完整B84范围仍为A1–A5，本checkpoint不代替后端、Rust、前端及原生场景的后续接入。

- **Contract/Invariant**：消费quality-gates §2.5及既有B41 manifest语义；纯判定不触发文件/子进程，外部资源基础规格只初始化一次，可变差异隔离，嵌套调用不删除父作用域，借用资料与原始证据不变。
- **Boundary/Consumer**：仅scripts测试支撑、quality manifest族与现有工程入口；`quality_manifest_check.sh/manifest_cli.mjs`、Node测试、`ai_static_scan.sh`、`task_done.sh`及既有CI步骤是真实消费者。产品lib、作品Schema、Provider、Frontend UI均不修改。
- **Proof/Acceptance Driver**：从真实CLI与Node子进程验证：两次/并发子进程复用同一规格、纯规则零外部环境构建、必要可写副本互不污染、正常/断言失败/初始化失败/取消/子进程退出时owned scratch回收。这个机制checkpoint不启动页面；native入口变更的真实Tauri证明仍在A4/A5，不能代签。
- **Exploration**：不改变作品知识或模型请求，不适用。

本批实体审核：`test_env.sh`已有前置，缺Node运行/fixture薄适配，允许在既有`scripts/lib/`增加`test_env.mjs`作为同一契约的适配（不是新框架/调度器/结果平台）；manifest测试已有`minimalManifest/buildFixtureProject`，提取到同目录fixture owner并删旧复制；IO测试另文件承接原真实读取/YAML/文件存在性反例，纯测试保留在原邻接文件。`loadProject`增加必要的目录/driver存在性观察供既有`validateProject`消费，禁止另建第二Project/registry。删除仅为测试绕过IO的`skipExternalChecks`分支，真实`validate()`仍完整执行原外部检查。

运行身份与scratch只在测试层；复用只读文件fixture以相对路径和内容作为规格，不依赖被测实现生成期望。纯内存值的构造/拷贝是用例输入，不为其引入跨进程缓存；“初始化一次”针对外部基础环境。宿主SIGKILL后的遗留恢复、其他语言入口及全量运行验证仍需在后续checkpoint完成，不把首批正常退出验证外推。

开工`mix compile`退出0，相关WIP文件已备份并记录指纹于 `artifacts/b84-test-system/20261114/a1-manifest/`。先有界红绿验证，不运行整组旧变异或模型采集，不安装依赖、不改全局工具。

#### 首批机制验收 checkpoint（2026-11-14）

实现已接入 `test_env.sh`、Node scope、manifest reader/pure validator 与现有 CI 入口。fixture 的唯一初始化权必须在构建前取得；竞争者只等待结果，不能各自构造后丢弃副本。leader 已用两个真实进程的 payload 写入计数核对该约束，并从 CLI 外部核对正常/失败退出、后台后代进程、清理失败时实际退出码与归档的一致性。证据均在上述目录；未运行旧 R01 大矩阵或新增模型采集。

审查中曾出现“66例通过但仍有真实缺口”，以下反例均已修复并复验；保留红态，不能用早期测试通过数代替验收：

| 缺口 | 独立反例与修复归属 |
|---|---|
| 超时后取消覆盖退出结果 | 红态 `leader-acceptance/timeout-then-cancel.json`；已删除重复可变的 `stopCode`，从已有事实派生。绿态 `final-contracts/green/timeout-then-cancel.json` 为124且子进程已结束、scope已回收。 |
| 裸 Node 入口初始化失败遗留 scope | 初始化移入现有 `before/after`，after检验cleanup事实。红态 `leader-acceptance/direct-initialization-failure.json` 曾残留1目录；leader复验 `direct-initialization-failure-green.json` 为预期非零且0残留。清理失败不再误报PASS；零IO边界探针的临时bin也归文件scope持有。 |
| 变异存活误判为等价，及新增 helper 漏选 | leader的 `driver-survivor-counterexample.json` 推翻早期等价结论；已补合法dogfood/e2e正例，相关变异被击杀。21个可达的新/改纯helper完整列入 `final-contracts/manifest-mutation-selection.json`，含零站点函数，不隐去未执行点。 |
| 默认工程入口绕过owner | worker直接运行旧扫描入口后出现新临时DB，见 `leader-acceptance/unscoped-scan-db.json`。现有helper新增薄委托 `novel_node_test_scope_ensure`，实际消费者是 `ai_static_scan.sh` / `task_done.sh`；复用Node借用校验，不复制marker解析、trap或进程树。两入口在资源初始化前申请/借用，同scope不重复申请，保留参数/退出码、父scope和显式DB。`engineering-entry/`保存真实Shell/Node及外部fake工具的红绿证据，不将其称为完整扫描。 |

审查同时退役为指标而建的 `named_error.mjs` 工厂，保留各 owner 的标准 Error 子类；两个短构造器是语言样板，不是重复业务政策。生命周期逻辑按实际职责组织，不以拆出大量单表达式函数满足 CRAP。manifest 的纯测试不构造目录/假可执行文件；零 IO 的边界证明移到现有 IO 测试，不随每个纯规则变异重复执行。

定稿后的合并局部回归：`node --test --test-concurrency=1 scripts/lib/test_env.test.mjs scripts/lib/test_env_scope.test.mjs scripts/lib/quality/manifest.test.mjs scripts/lib/quality/manifest_io.test.mjs`，**78/78，0失败/跳过，退出0**，27.1秒；日志 `leader-acceptance/all-tests.log`。leader另从真实CLI复验成功、child失败、cleanup失败、双重失败的退出/归档一致性及正常退出后的孙进程回收（`leader-acceptance/result.json`）。真实manifest CLI仍执行外部检查，不恢复测试绕过开关；现有CI全glob未删减，但干净CI的AU15等既有债务仍在本任务后续范围，未声称该完整glob已经通过。

质量证明按实际范围记录：manifest纯规则42个已执行点中40个击杀、2个在合法非空entrypoint值域下等价的`?? → ||`存活；`checkScenarioManifest`另2个消息定位站点未执行，A2仍需核对其真实parser值域/相应IO证明，不能说全文件变异通过。scope的五个关键函数16点中15个击杀，1个`state.closed=true → false`仅在失败后再次close时有重试差异；现役消费者每个scope只关闭一次，正常/借用重复关闭结果一致，保留该限定解释，不伪报击杀。完整原始输出在 `final-contracts/`，退出3与基线/环境错误均保留。

CRAP采用**未改写的Node标准完整测试LCOV**（包含CLI `main` 33次命中），默认保留BRDA，经leader独立调用crapper核对，本批新/改完整函数最高9，严格小于10。`leader-acceptance/crapper-native/review.json`是有效复核。worker自行按“行号/ordinal”合并多次CLI覆盖会错配分支，随后删除BRDA的派生也不作为验收依据；无需为这个采集错误再加壳函数或重复CLI矩阵。五个高于10的manifest既有函数体经与开工备份逐项比对未变，仍是开放债务。Dryer保留两个标准Error构造器的1.00样板命中及语义说明，不新建工厂刷零。

提交收口走现有真实入口 `bash scripts/task_done.sh --top 10`，内部完整执行 `bash scripts/ai_static_scan.sh --top 10`，结果、目录前后核对与task-done manifest绑定于 `leader-acceptance/final-gate-result.json`。Semgrep命中R01合成测试的固定零值赋值，经来源审查登记为误报，未改测试躲扫描；既有六个gitleaks历史处置沿用且保留原始扫描事实。

**本checkpoint不关闭B84。** A1/A2其余Node测试族与重型SQLite fixture迁移、A3后端/Rust/前端入口、A4真实原生场景、A5宿主SIGKILL恢复/完整门禁与跨平台验证仍开放。Windows进程树收口明确未支持，不外推本机成功。历史约149GiB残留未清理，未恢复旧R01大变异或模型采集。

### A2 下一实施单元：质量测试自足与统一失败传播（2026-11-14 开始）

首批已本地提交 `57b5abb6`，未推送。本单元消费同一scope，不另建框架：

- **Contract/Invariant**：quality-gates §2.5、B42 §10.1准备报告的原有schema与只读边界。测试不依赖私人artifacts/预建repo/tmp；未知前置不得被判ready；cleanup异常不能因为调用者漏检查返回值而变成PASS。
- **Boundary/Consumer**：现有 `au15_preregistration_check.mjs`、两个quality测试文件、既有Node scope及其当前消费者；CI的quality parser集合和准备报告CLI是消费者。产品、AU-15真实场景、Splash采集及旧原始证据均不修改。
- **Proof/Acceptance Driver**：沿真实CLI、Node hooks及受控文件输入验证；使用自足合成预注册/场景/文件存在性，保留缺文件/坏JSON/YAML/预算不符/前置未知/拒绝覆盖等反例，并验证父scope与原始资料不变。该测试支撑checkpoint不代替产品页面验收。
- **Exploration**：不物化作品要素或改变模型输入，不适用。

设计审核：`au15_preregistration_check`已有唯一owner；在原文件分离reader、纯判定、writer，增加明确的项目根输入，测试根与输出均在现有scope内，不提取第二个准备报告模块。YAML复用 `manifest.mjs` 的标准解析桥，不再正则解析YAML字段。模型/供应商检查对照输入声明，不把固定Strata字符串视作通用正确性；报告仍仅审查旧v1准备材料，不据此声称当前Splash计划就绪或授予运行权限。前置要求的存在不证明已经满足，缺满足证据为unknown，整体不ready；旧v1无独立frozen字段，不为满足测试发明字段。

统一退出的API收敛：现有 `close()` 将清理失败作为异常传播；CLI在唯一finalization边界把异常转为非零及保留原始child失败事实，Node `after`自然失败。迁移所有当前调用者，退役各测试文件重复检查soft-error返回值的做法；不新增Node fixture DSL/Case类或兼容别名。初始化继续在框架before生命周期内，借用资源只归还。

重型SQLite/快照fixture的下一步设计，以 `artifacts/b84-test-system/20261114/a2-node-fixtures/` 的现有builder/输入规格/消费者采集为依据；尚未批准新的builder接口或实现，不能从“都使用SQLite”推导可以共享同一规格。

实施与复核：公共close失败改为异常，成功关闭幂等，CLI在唯一出口保留child失败并转录cleanup错误；各Node after不再重复解释soft-error。准备检查器在原owner内分离reader/纯判定/writer/CLI，用标准YAML桥和明确的 `--root`；两测试共享独立合成输入，新增文件已在原索引登记。身份核对包括已声明的setup.provider；预算只称符合v1约定，不伪造冻结；资源窗口的条件声明不冒充满足/未满足，仍为unknown；来源status原样转录但不授予完成信用。`evidence_chain`输出归scope，不预建repo/tmp。产品、真实预注册和原生batch未修改。

证据根 `artifacts/b84-test-system/20261114/a2-quality/`：

- leader的 `leader-review/unknown-ready-counterexample.json` 证明旧checker四项unknown却ready；`declaration-counterexamples.json`证明setup.provider冲突漏检及条件词误报blocked。修正后的对照见 `review-1/feedback-closure.json`、`review-2/feedback-probe.json`，不把旧测试期望视为权威。
- `review-2/` 的IO证明使用真正 `node --import <固定preload> <CHECKER> --root <owned>`，经过argv/main guard/process.exitCode；14次受控CLI调用无意外越界，另有真实CLI指向repo根的拒绝反例、静态named fs绑定负控制及自有路径允许控制。review-1仅调用main的证据保留为函数级IO，不能冒充CLI。测试不再读取真实报告求hash；测试外只读保全观察与测试依赖分开。
- leader在共享run串行两次启动IO文件，复现固定 `guard-*.jsonl` 串扰（`leader-clean/repeat-red/`）。现在固定preload经同一materialize owner物化一次，各文件进程的可变日志/哨兵进入独有worker叶子；after释放叶子后再close/归还scope。`review-3/result-green.json`为串行2次、并行2进程各17/17，父marker/sentinel与模板不变、worker目录无净增；leader独立串行复验亦为两次exit0（`leader-clean/repeat-io-result.json`）。
- **干净源码环境完整quality集合**：以 `57b5abb6` + 本批代码建立一次本地隔离源码副本，起点无私有artifacts与repo/tmp；24文件、338测试，**325通过/0失败/13既有历史证据缺失跳过**，6.8秒，未过滤集合或新增skip。副本与所属scope已回收。来源hash/命令/原始输出在 `leader-clean/result.json`、`quality-tests.log`；之后只有上述IO测试生命周期调整，SUT、断言集合与其余来源未变，按串行/并行专项补验，不重跑未变化的大集合。
- 局部门：scope 55/55、AU15纯/IO 28/28；标准单次Node原生LCOV保留BRDA，新改完整函数最高8（close相关先前最高9），没有自定义覆盖合并。Dryer保留标准Error构造样板的真实1.00命中与语义说明。差量变异按原始清单记录：准备判定保留类型域/不可达计数的限定等价点，close转换5/5击杀，无消费者字段及包装已退役；不宣称全文件变异通过。具体来源/hash/范围见 `review-1/result.json` 与 `review-2/result.json`。

本单元提交收口仍走现有 `bash scripts/task_done.sh --top 10`（内部完整静态扫描），最终记录在 `leader-final/result.json`；这里的测试支撑机制证明不替代A3/A4/A5或真实模型/页面验收。

后续迁移的边界裁决：采集清单中的“非目标”仅是worker对非SQLite类别的标签，**不采纳为B84范围排除**；日志/文本、native_ui_wait等仍在A2。局部 `writeSource/createSourceDb` 已是现有builder，应审核后提取/复用，不能说“没有共享builder”就自由另造一套。snapshot的14表与capture的20表是不同测试投影，种子与列集合不能直接合并；是否符合当前真实消费者目标还要独立复核，不把现状当权威，也不把最小I/O夹具称为生产全Schema证据。纯判定先摆脱无关建库；确需文件/SQLite的反例与各类退出证明不得删除。

### A2 构造资产与首个SQLite消费者（2026-11-14 开始）

质量测试单元已本地提交 `d14a4e7a`，未推送。下面的设计由 [quality-gates §2.5.7](../../docs/engineering/quality-gates.md)统一维护；构造资产及首个SQLite消费者已实现并完成本单元工程验收，不能据此关闭A2或B84。

- **Contract/Invariant**：§2.5.7、B71 §16.9逐调用归属；纯集合不创建DB，同run同构造规格只初始化一次，回调只在获claim后运行；完整payload和指纹原子发布，借用原始资料不动，可写case隔离。
- **Boundary/Consumer**：扩展现有 `test_env.mjs`；将 `authoring_call_evidence.test.mjs` 的1个SQLite用例移到邻接IO测试，其余纯判定留原文件；真实消费者为已有 `readProviderRuns → joinNativeCallEvidence`，不改生产app或该证据判定语义。
- **实体查重**：唯一run/fixture owner已存在；call测试的 `scope/pair/exchange/base` 等合成数据构造器也已存在，提取为该家族fixture owner后删原复制。既有confirmation/R01 fixture不是同一规格，不能借名字合并；仅批准这一家族的纯fixture文件、SQLite fixture构造文件和邻接IO测试，均放既有fixtures/索引链，不另建框架或通用SQL builder。SQL构造复用原case实现并按实际producer字段/类型复核，不把最小查询投影称为可运行生产库。
- **Proof/Acceptance Driver**：外部进程分别重复/并发调用，观测真实builder与payload写入次数（不能只数最终目录）；同输入复用、输入变化新规格、失败不发布、发布后owner退出、模板漂移/越界、两可写副本与原始父sentinel、文件/DB关闭及退出。保留只按run读行、逐字段归属拒绝、有限模式观察的原反例。由真实Node/SQLite消费者驱动，不触发真实Tauri/模型。
- **Exploration**：不物化作品要素或改变模型请求，不适用；app全Schema及真实页面证明仍留在后续A3/A4/A5。

事实依据为 `a2-node-fixtures/consumer-review.json` 与摘要：已存在的迁移入口只启动Ecto/adapter/Repo，不启动provider；restoreSnapshot已有copy后chmod0600，不需要另修一套恢复；call读取1表，confirmation读取8表，R01两族是不同投影。合成WAL只读实验已证实辅助文件会生成，模板封存须处理此实际边界。不得改真实源或原始基线，也不在本步引入Node新特性/升级依赖。

实施中审查（未提交/未验收）：leader用真实入口证明首版仍有三个缺口：字面输入的完整集合被控制记录缩小、README.md与小写路径排序不一致，以及裸IO文件两个case各自申请run而把同规格DB构造两次。证据在 `artifacts/b84-test-system/20261114/a2-sqlite-call/leader-review/`（`literal-completeness.json`、`path-order.json`、`bare-io-lifecycle.json`）；测试退出0没有代替这些目标判据。已主动停止首版的质量循环，先修正实际作用域与独立期望，再收敛验证；中断结果不记通过，取消后未观察到owned系统scope残留。静态JSON输入的纯join用例仍应留在纯集合，不因文件加载被机械归入需建库的IO集合。

#### 第三单元复核与验证路径纠正（2026-11-14）

首版缺口已修正；之后的验证仍发生过一次违规扩大：worker `fa0906e0` 未使用外层run，在系统TMPDIR执行全段变异。取消worker后孤儿mutator仍在运行，leader核实其根PID并以既有Bash `process_tree.sh`终止，随后未发现该运行的mutator/fixture子进程。新残留最终为104个 `test-env-scope-*` 目录、4,968,448分配字节，与此前约149GiB旧残留分开。初次88目录快照与停止后104目录清单分别保留在 `leader-review/unsafe-validation-residue*.json`；leader逐项核对来源代码/owned marker、ctime、完整文件集合与lsof无占用，复核inode后按清单回收104目录，证据见 `leader-final/residue-cleanup-{preflight,result}.json`。该新前缀现为0，旧DB前缀仍161，未触碰旧R01目录。**取消worker不是子进程已收口的证据；全局工具入口的受控运行仍属A5必做项，不能以人工指令代替机制。**

leader同时拒绝为消除存活变异而删除工作副本cleanup幂等状态：`workcopy-ownership-regression.json`证明重复cleanup会删除原路径后来创建的数据。修复恢复“成功后完成、失败可重试”，在复制前建立释放责任，半途复制失败立即回收，仅当回收也失败时合并主因和清理错误。测试故障注入必须在finally恢复；stalled owner先结束，再释放父scope。SQLite用例不再以共享work目录全空作判据，只核对本case目录，并保留其他owner哨兵。此后worker限于代码修正，所有执行由leader经现有run入口完成。

当前独立证据统一在 `artifacts/b84-test-system/20261114/a2-sqlite-call/leader-final/`：

- `lifecycle-probe.json`：重复cleanup保留后来者、首文件成功后第二文件失败的半成品回收、复制/清理双失败完整传播、字面规格完整集合和大小写路径复用全部通过，owned scope已回收。
- `sqlite-lifecycle.json`：真实裸IO入口一次、同run串行两次、同run并行两进程，分别观察到**一次真实模板DatabaseSync构造**；可写副本隔离，其他owner资源/父marker未动，子进程退出后无净增scratch。计数器在外部preload观察真实构造，不只数最终目录或控制记录。
- `coverage-green/`：6个相关文件 **146/146通过、0失败**，单次标准Node原生LCOV保留BRDA。此前失败记录保留在 `coverage/`：一项新增测试漏绑TestContext已修，另两项原Shell测试明确为沙箱 `listen EPERM 127.0.0.1`（`ports-sandbox.log`），在获准本地监听的环境复验通过，未修改端口断言。
- `crapper.log`：三个本批源文件最高CRAP **9**，使用上述未改写的原生LCOV；`dryer/`使用字节一致的`.ts`镜像适配工具已知扩展名限制，阈值0.8无重复候选。
- 干净源码副本的完整quality集合与两个call消费者：**26文件、385测试，372通过/13既有历史证据缺失跳过/0失败**（`clean-quality-green.{json,log}`），起点无私有artifacts与repo/tmp，源码副本随run回收。此前同拓扑的两项负控制失败见 `clean-quality.log`：AU15 guard把整个父run作为允许根，导致run内源码副本的artifacts被放行；现只由正常调用显式放行当前工作副本，负控制缺省无豁免，并补父run内子树反例。未改SUT或放宽拒绝断言。
- 差量变异按完整变更函数分纯规格/文件生命周期/等待语义执行，源码副本及工具overlay均位于同一owned run内，每次子测试保存源码hash/输出/退出码。144个owner点+3个SQLite builder点：140项正常非零，1项自等待用50ms公开等待期限独立证明失败，2项分别复现根目录固定点/索引不推进造成的不终止；4个存活点保留契约说明（目录祖先集合已由文件集合约束、等待边界一轮poll容差、Node版本非空域、一级目录创建）。不把存活点改码刷掉，不把13个未选中的旧CLI/平台未覆盖点算本批失败或补全。具体原始退出码与限定结论见 `mutation-review.json`、`timeout-classification.json`；工具原始exit3保留，不宣称全文件100%。首次混合用例的35个强杀、源码副本缺依赖的baseline失败均不直接计绿。

最终工程门已执行既有 `bash scripts/task_done.sh --top 10`（内含完整 `bash scripts/ai_static_scan.sh --top 10`），退出0：21项原始检查20通过、1项gitleaks非零、0跳过；Top10实际7项均有既有处置（6误报、1已接受的其他开发线历史风险），阻塞数0，本批无新增待处置问题。`artifacts/task-done/20261113T234432Z/manifest.json`记录完整运行；随后仅修正文档消费者说明与本段状态，刷新manifest时复用同源扫描结果，不重跑未变化的代码集合。不跳hook、不推送；最终manifest、源文件hash、提交与临时目录检查归 `leader-final/result.json`。

本单元不改变生产证据reader/join语义、不触发模型或真实页面。confirmation、R01各族、其余Node临时资源、后端/Rust/前端/原生入口与宿主强杀恢复仍按A2–A5继续；已发现的外部工具绕过入口问题必须在该范围内闭环。

### A2 confirmation测试族（2026-11-14 开始）

上一个构造资产单元已本地提交 `af988ca`，未推送。本步承接同一§2.5契约，迁移confirmation家族，不能恢复旧R01大矩阵。既有审查清单与当前消费者共同决定范围：`authoring_confirmation_evidence.test.mjs` 含纯判定、runtime/AX/SQLite读边界；`authoring_confirmation_batch_evidence.test.mjs` 从 `verifyConfirmationBatch` 读文件/DB并写报告；既有 `fixtures/authoring_confirmation_scenarios.mjs` 提供纯事实，唯独 `testDir` 混入文件创建，缺失runtime反例会因此遗留目录。

- **Contract**：B71 §16.14 C1–C12证据归属与只读观察；quality-gates §2.5的run/fixture/case所有权、§2.5.7的两种规格和原子发布。沿用现有Node测试与owner，不增加框架、fixture registry或通用SQL生成器。
- **Invariant**：纯计算不申请文件环境；同run同规格模板只构造一次；真实reader/批次报告依然读所声明的文件和SQL行，缺失/污染反例不得被默认值掩盖；模板只读、mutable copy互不影响，异常与断言失败也必须释放case资源和恢复mock。
- **Boundary/Consumer**：只改该家族测试和fixture，消费已有 `evaluateConfirmation`、`observeConfirmationRuntime`、`scanAuthorVisibleBatch`、`readConfirmationDbFacts`、`verifyConfirmationBatch`；不改这些证据判定实现、生产app或R01 WIP。纯事实owner去掉IO职责，IO用例迁到邻接文件；已有batch测试继续承接完整报告证明。
- **实体查重/设计**：复用现有 `schemaSql/insertRows/writeDatabase/writeBatch/runtimeFixture`，审核后收敛进该家族唯一IO fixture模块；正常8表DDL采用既有batch查询投影，reader与batch使用独立且有真实消费者的seed规格，不因都用SQLite就和call/R01合并。缺表、少帧、缺日志等反例从正常模板的case副本显式变更，不每case重建Schema。模板保留固定wire/canon/AX/PNG/合成app文件；当前case的绝对app路径、ready时间与相关heartbeat由现有批次装配在副本层完成，不能封存staging绝对路径或以动态时间把相同静态资产变成不同规格。DB连接finally关闭，合成模板采用无WAL sidecar的DELETE方式；作者源库不动。
- **Proof**：先保存现有两文件基线；保留所有原有判据/缺失反例。纯集合零目录/DB构造；公开DB reader验证真实行、顺序、JSON字节与计数；同run串行/并发进程通过真实构造和写入观察证明固定模板一次、两个case修改互不污染、父资源不动、报告只落owned副本、正常/失败退出无净增。缺失runtime且实际日志存在的反例保留在IO集合，不用不存在路径替代它而缩小证明。
- **Acceptance Driver**：外部Node进程驱动现有公开reader/`verifyConfirmationBatch`，文件/SQLite/产出报告均真实；OS进程观察沿用既有测试边界替身，只证明观察接线，不能冒充真实Tauri/模型场景。产品验收感知新增为no。
- **Exploration**：不物化作品知识、不改变模型请求，不适用；真实页面与全系统作用域仍由后续A3–A5闭环。

本步批准新增该家族邻接IO测试文件和一个IO fixture模块，并同步既有README；新接口只服务这些现有消费者。worker仍负责限定代码实现，leader负责运行验证；任何验证必须在现有run入口内，纯/IO/并发用例按目标职责选择，不再把全部集成场景绑到每个纯函数变异上。

实施复核：首轮69/69及外部六场景均通过；IO/批次按需物化后，pure/AX-only/git-only零建库，共享run串行及并发各2个真实8表构造、8个静态规格、28连接全部关闭，老化2小时模板复用及初始化失败退出均成立。leader随后以真实批次测试入口同时注入断言/cleanup失败，`a2-confirmation/leader/dual-failure-red.log`只输出cleanup，原始断言被局部finally遮掉；Node原生after双错误探针也不能替代完整错误传播证据。经查重现有owner只有 `createWorkingCopy` 与私有 `failureWithCleanup`、没有同步使用组合器，因此本步补充批准§2.5.7的 `withWorkingCopy`，仅服务当前两个同步测试消费者并复用现有创建/幂等清理/错误组合，不另建退出体系。对应所有权与双失败用例由现有 `test_env_scope.test.mjs`承接。

#### confirmation实施与局部验收

证据落点：`artifacts/b84-test-system/20261114/a2-confirmation/leader/`，以 `lifecycle-owner/`、`coverage-owner/`、`mutation-owner/` 为当前来源；此前记录保留为阶段证据，不混算分数。

- 既有纯事实owner去掉 `testDir`；51个纯测试不创建scope/文件环境或DB。7个真实IO测试按实际消费者惰性物化，AX-only两用例只读5个明确文本规格，0 DB、0可写副本；仅Git mock对照也不建批次模板。完整批次反例从正常副本删文件/帧/表，writer与reader语义均未改。
- 正常模板按既有8表投影/真实seed复用同一写库实现。reader的JSON字节、时间/id排序、计数与缺表反例保留；batch报告、源/子run归属、作者字节和缺失反例保留。真实callback/cleanup双故障现在同时作为标准AggregateError到达实际批次测试入口（`dual-failure-result.json`）；嵌套副本内层先释放、外层仍可用，最终两者回收。
- 当前confirmation集合70/70（比原67增加缺runtime独立IO边界、双副本隔离及双故障证明）；干净HEAD加本批源码的本地副本同样通过70/70。加完整scope集合的单次原生coverage为 **129/129、0失败**；同步副本相关定向8/8通过，LCOV未改写/未删BRDA。
- `lifecycle-owner/result.json`六场景：pure/AX-only/git-only均0建库；同run串行两次（含模板mtime老化2小时）和并行两进程，各只构造reader/batch两份8表库、发布8个静态规格，28次连接/28次关闭，30个必要工作叶子在退出后无残留，父marker/其它owner哨兵不变；注入建库失败时只尝试一次、关闭已打开连接、没有发布半成品或遗留case副本。
- `withWorkingCopy`只增加当前同步使用组合，复用既有创建/cleanup/双错误组合，不改原API的现役消费者。移除模板中会被case整文件覆写的ready/heartbeat；**保留ID回退**，因为当前interactions/provider_runs/decision_traces seed仍有缺id行，不因变异存活误删有效逻辑。
- CRAP最高9，新批次装配函数按transport职责拆分后为8；Dryer对字节一致镜像、阈值0.8无重复。夹具变异38点：25击杀、13存活、0未覆盖，所有39次子运行有退出码，无环境失败/超时冒充kill；存活按合法值域、合成opaque id、等待事件非计时判据载荷及实际IO调用域分别解释（`mutation-review.json`），原始exit3保留。新增同步owner函数工具可识别变异点为0，依靠正常/单失败/双失败和真实消费者反例证明，不捏造分数。

最终已执行 `bash scripts/task_done.sh --top 10`（内含完整静态扫描），退出0；完整运行manifest为 `artifacts/task-done/20261114T003549Z/manifest.json`。21项原始检查20通过、1项gitleaks非零、0跳过；Top10实际7项均有既有处置（6误报、1已接受的其他开发线历史风险），0阻塞，本批没有新增待处理发现。之后仅本段/状态的文档更新，刷新manifest复用同源完整扫描，不重复未变化的代码验证。最终manifest、源hash、范围及本地提交事实见 `leader/result.json`。

尚不签B84或A2完成；R01与其他Node测试族、后端/Rust、前端/原生、宿主失联恢复与原web慢测试仍未闭环。

### A2 R01快照族与启动清单事实来源（2026-11-14 开始）

confirmation单元已本地提交 `88b3e1cf`，未推送。R01消费者和测试仍属于原R01未提交整体，已保存8个相关文件的原始源码/指纹于 `artifacts/b84-test-system/20261114/a2-r01-snapshot/before/`、`source-before.json`；本步不能单独提交缺少消费者的R01测试片段，通用owner既有提交不回滚。capture的20表家族仍是下一单元，不与本步14表源投影合并。

**独立目标反例先于迁移**：当前 `preflightNative`直接信任snapshot JSON的`run_inventory`，既有纯测试还保护“缺inventory按空事实处理”。leader以现有合成源构造器创建含durable run与RUNNING task的数据库，原清单会被拒绝；仅将JSON清单改成null、DB字节/hash不变，实际预检返回ok及0任务。有效证据为 `inventory-origin-red.{json,log}`，不是推断历史真实批次曾触发该问题。三份`inventory-probe-invalid-*`只是探针路径未满足manifest契约的设置失败，不计产品结论；合法路径的探针scope及专属空父目录均已回收，未访问原作者DB/日志或启动应用。

- **Contract/Invariant**：R01完整副本、源不变、作者数据保护与不意外恢复旧任务；同run同源规格只构造一次，纯运行清单判断0文件环境；空表的实测0与缺失/伪造声明分开，实际数据库是安全判断的来源，声明须与事实一致。
- **Boundary/Consumer**：复用 `request_cost_snapshot.mjs` 已有runInventory读取和纯assert判定，在现有owner内导出/命名清楚的实际DB读取入口，服务create/restore/preflight/prepare的当前消费者，不复制第二套清单扫描。preflight读取实际work DB，restore核对实际DB与记录，prepare核对source及实际batch的安全事实；完整复制本身不因源中含旧任务而改写数据。生产app、Prompt、IR、Provider行为不改，不启动模型或真实页面。
- **设计与查重**：删除无实际消费者的“清单缺失即空/关键运行表缺失即空”回退；在实际文件/DB边界揭示错误，不给纯内部函数堆不可达类型拦截。既有纯规则测试保留安全实测0/任意数量终止task与非终止/未知状态反例，退役缺失清单被当安全的错误期待；真实IO增加缺失和完整伪空JSON、声明与实际不一致、关键表缺失、实际batch被改成危险任务等反例。
- **fixture**：提取既有writeSource到同族fixture，复用materializeFixture，14表源模板DELETE封存/finally关闭；纯与IO邻接分开。正常源只读共享，需要改源的case才取隔离副本；实际快照/恢复输出使用run/work下必要case叶子并预先绑定Node TestContext退出，不为分配输出目录伪造空fixture。write/rename/reconcile的连接含部分初始化失败均须关闭。按真实消费者核对种子枚举，普通种子不冒充完整生产Schema；另保留明确的opaque字节/未知值透传证明，不清洗源数据。与20表capture不合并、不新建SQL框架。
- **Proof**：保留全部完整字节副本、其他作品、逐表行数、BLOB UUID/引用原始行、声明setup delta、同tick/时间回退等证明；源与副本字节/hash至少一条由Node crypto/Buffer独立核对，不能只用SUT自己的hash当oracle。使用实际preflight/restore/prepare入口验证JSON不能替代DB；使用构造/写入计数与串行/并发/失败出口证明模板复用及无净增。R01中其它仍混合的capture测试只做受影响的定向验证，其完整资源迁移随后接续，不恢复旧大变异。
- **Acceptance Driver**：外部Node进程、真实文件/SQLite及现有公开诊断入口；产品验收感知新增no。这里只签诊断与测试机制，真实模型基线仍使用既有3/10/20轮证据，不重新采集或代签产品改进。
- **Exploration**：不物化作品知识或改变模型请求，不适用。

`active-metadata-shapes.json`已核实：原冻结目录名real-v2中的原manifest实际是snapshot/v1，保持原字节；当前rebuild从其冻结full.sqlite3生成snapshot/v2，不应把v1直接接入新启动入口或回填它。formal-before manifest已有业务hash与引用签名。原证据和当前运行契约须区分，任何进一步退役须核实真实消费者，不为改测试改写冻结资料。

#### 快照族实施与验收 checkpoint（R01整体仍为WIP）

当前边界已实现：`readRunInventory`复用原SQL读取，关键运行表缺失直接失败；JSON schema/清单声明检查集中于同一私有读取器，两条现有公开入口按各自路径委托。纯安全规则只消费run mode/task状态；声明结构不是DB观察。preflight与prepare以实际库判断并对账；restore目标是将要启动的batch DB，复制前也检查实际安全，完整备份create仍原样保留危险源、不改任务状态。

leader运行发现并修复两处测试实现错误（误把restore返回值当落盘记录、SQLite null-prototype行的内容比较），没有为通过而改SUT返回形状。随后独立真实verify故障注入证明：仅写`not_collected=run_inventory`仍会被原报告分类为pass；现已在既有`MEASUREMENT_GAPS`接通partial，既不签完整测量，也不把读库失败伪报为unsafe/model failure。原错误与修复证据分别为 `verify-inventory-read-{red,green}.{jsonl,log}`；未启动应用或模型。

最终来源在 `a2-r01-snapshot/leader/`：

- `coverage-final/`：快照纯/IO、纯报告及完整capture集合一次标准原生LCOV，**102/102通过**；受影响preflight/prepare/verify定向6/6通过。完整capture仅作为受影响回归运行一次，未放回旧全段变异。
- `resource-final/result.json`：纯2例0目录/DB；串行两次及并行两进程各25个IO用例，共用2个不同标题源规格，各只执行一次14表构造；326连接/326关闭，82个必要副本/输出叶子在退出后无残留，父marker/其它owner哨兵不变；构造故障时每规格只尝试一次、连接关闭、不发布半成品。
- 源模板改为DELETE封存，普通枚举按当前schema核实；未知枚举与16字节BLOB仍有明确原样透传反例。源/full/work的字节和hash用Node crypto/Buffer独立核对。原冻结v1 metadata及formal-before metadata的hash保持不变（`metadata-preserved.json`）；没有改写作者证据。
- `inventory-origin-green.json`证明原始“DB危险但null声明放行”的反例已转拒绝；完整伪空、声明不一致、缺运行表、危险batch、实际空表的真实IO反例均保留。缺表或读取失败在报告中为缺证/partial，已观察到危险状态才记unsafe/fail。
- Crapper四个本批相关源码最高9；Dryer原0.80重复已合并为同一JSON入口，最终阈值0.8无重复。差量变异原始exit3保留：最后JSON边界14点13击杀/1拒绝错误输入形式差异；原纯规则/IO/种子按未变函数范围复用，不能把不同运行累计成全文件分数。数值/布尔种子变化不靠镜像断言刷分，详见 `mutation-review.json`。

最终工程门已执行两次：首轮因既有合成usage零值测试从850行移到851行而产生新Semgrep指纹，阻塞数1；核对表达式和本地合成来源未变后，在原 `reports/static-scan/dispositions.json` 补新位置处置并保留旧记录，未改扫描规则或测试代码。复跑 `bash scripts/task_done.sh --top 10` 退出0，manifest为 `artifacts/task-done/20261114T022956Z/manifest.json`；21项原始检查20通过、1项gitleaks非零，Top10实际7项（6误报/1已接受历史风险），0阻塞。原失败与复跑报告均保留，见 `disposition-review.json` 与最终 `leader/result.json`。

当前不单独提交依赖原R01未提交消费者的测试碎片。capture的20表资产及其IO编排变异、其余R01工程闭环仍为下一checkpoint；本步只签上述实际证明，未签R01或B84完成。

### A2 R01 capture家族（2026-11-14 设计/开始）

事实输入为 `artifacts/b84-test-system/20261114/a2-r01-capture/design-inputs.json`、`facts-summary.md`：现有33个case，20表源builder只有一份固定DDL/seed，prepareFixture有40个静态调用点；当前每例重建源、两份snapshot镜像和batch。与14表snapshot投影不是同一Schema/seed。manifest/config/source record包含实际路径，不能直接把旧临时目录整体当跨case模板。

- **Contract/Invariant**：R01测量事实与合成fixture边界、quality-gates §2.5。纯规则零环境；同run同规格作者日志、20表源/完整快照及初始批次只构造一次；必要mutable batch与负例变更隔离；路径引用指向实际发布资源，不能遗留staging路径。缺证不当pass，初始/末态事实分别观察。
- **Boundary/Consumer**：复用当前 `makeMessages/makeRecord/makeSource/createSourceDb/prepareFixture/writeDriverLog/writeCalls/writeCheckpoints/writeCheckpointAt` 等真实factory，消费已有analyze/preflight/prepare/capture/verify/CLI main；不改产品lib、Prompt、IR、Provider，不读真实作者数据或重采模型。原33例目的/失败矩阵必须保留；已有main函数级证据不能冒充进程CLI证据。
- **资产设计**：按当前真实依赖分作者源日志（无DB）、native只读源/完整snapshot（20表）、已做固定setup的批次初始资产三类，全部走同一materialize owner。作者日志的只读消费者借用，改日志者取必要副本；源DB/snapshot正常只读共享，确需篡改snapshot的反例才复制；每个native case只复制会被写入的batch DB/记录/日志输入，并在case绑定manifest.path/sha、batch_dir等位置。固定setup从现有SQL提取，所有连接finally关闭，合成库DELETE封存；不把全部只读源/镜像随每个batch重复复制。
- **路径决策/实体查重**：现有owner内部已经计算最终target，缺的是向builder提供只读发布定位。仅批准§2.5.7的第二个publicationDir参数，供本族在staging内序列化正确的发布路径；禁止在publish后修模板或预建目标目录，不复制digest/目录计算。复用现有纯manifest fixture组成所需元数据，不把其最小样本整份当真实capture输入。native manifest的冻结源规范引用与传给preflight的实际隔离副本位置是不同角色，按现有hash绑定，不改SUT路径规则或读取真实冻结路径。
- **前后状态**：旧writeCheckpoints在调用后取一次末态canon，再同时写start/final，并把实际2行memory写成0；正常fixture不能继续自证这组矛盾值。复用现有checkpoint helper，在初始批次阶段保存真正的初始DB/日志观察，再在case写入/变更后观察末态；行数取实际DB，不只把0硬改2；保留明确的合成时序/显式at场景，禁止把末态倒填初态。真正captureBatch的IO测试仍验证公开producer，独立断言初始/末态计数与受控变更，避免producer/consumer共享错误仍自洽。
- **Proof/Acceptance Driver**：原33例迁移为纯/IO并保留全部反例，外部Node入口验证source/快照/批次基准构造与必要副本数、串行/并行复用、模板/父哨兵不变、异常退出/连接关闭/无残留；capture的IO变异在该迁移后才执行。真实页面/模型不在此机制checkpoint代签，产品新增验收感知为no。
- **Exploration**：不物化作品知识或改变模型请求，不适用。全B84及R01原工程闭环仍开放。

本步批准本族纯fixture与IO fixture模块、邻接capture IO测试，以及上述现有owner参数扩展；均须先复用/搬迁已有定义并更新既有索引，不引入通用测试编排器、场景注册表、SQL生成器或未来状态机。实现前保存当前修复后的R01源码指纹；worker只做限定代码实现，leader统一运行验收。

#### capture实施与局部验收 checkpoint（2026-11-14）

当前证据唯一落点为 `artifacts/b84-test-system/20261114/a2-r01-capture/leader/`，最终来源和限定结论见 `result.json`。worker负责限定源码迁移，leader审查并经既有run入口执行验收。该单元收口，不继续扩展同一族的验证矩阵；接续A3后端生命周期设计/实施，其余A2消费者仍保留在原清单。

- 3个资产域落为4个实际规格：固定作者日志、20表源/完整快照、冻结native manifest、已做固定setup的初始batch。全部复用同一 `materializeFixture`。正常case仅复制可写batch；需改日志/快照的反例才复制该资源。既有builder增加第二个只读定位参数 `publicationDir`，仍在staging写完后原子发布，不在发布后改模板。实际source/snapshot/restore引用均可解析，无staging路径或WAL辅助文件泄入模板。
- 原33个验收目的完整保留，拆成纯7/IO28共35例；新增两例分别证明非法rebuild入参不触碰私有文件、坏driver声明不得伪造0轮。初始/末态分别观察真实DB/日志/driver，独立断言实际memory=2、work_sessions=2、driver 0→3及LLM记录0→6；真正 `captureBatch` producer的期望不再从fixture计数器反推。计数决策收敛到一个owner。
- 干净源码副本曾暴露 `rebuildSnapshot` 在拒绝非法source前先读冻结manifest，原工作树测试因存在私有artifact而掩盖了问题。现有snapshot owner的路径规则提取为 `assertFrozenFullPath`，rebuild在任何I/O前调用；SHA/WAL/合法来源等原检查保留。未复制真实artifact进测试环境，未改写原基线。
- `coverage-observation/`：合并capture/快照/报告集合 **104/104通过，0失败**，标准Node原生LCOV未改写。原owner参数扩展有发布前target不存在、发布后路径可读的实际测试；scope完整集合已在本批较早的162/162合并运行通过，之后未修改owner。
- `resource-observation/result.json`：纯7例0目录/DB；历史3例0DB。共享run串行两次与并行两进程分别只构造**1份20表源库、发布4个规格、执行3次固定DB复制**；1832次连接全部关闭，130个必要case叶子退出后回收，模板/父marker/其它owner哨兵不变。构造故障只尝试一次、关闭连接、不发布半成品。相关owned scratch及系统 `test-env-scope-*` / `ai-novel-test-run.*` 前缀均为0；旧DB前缀161保持，旧149GiB资料未清理。
- `qa-observation/`：本轮变更的三个源文件最高CRAP8.8，未变owner沿用此前最高9的证据；Dryer字节一致镜像、阈值0.8无重复。`mutation-review.json`按函数/源码hash解释证据：capture完整选定范围25点18击杀/7存活；补独立审计和零记录缺证断言后，3个相关点均击杀；重构后的两个计数函数8点全部击杀。保留只读连接权限、合法输入域可选访问、非空runtime版本域等存活说明，不删除有效约束刷分，不宣称全文件100%。初次干净副本失败和一次源码漂移后的旧行选择不计通过。
- 完整 `bash scripts/task_done.sh --top 10`（内含 `bash scripts/ai_static_scan.sh --top 10`）最终退出0，manifest为 `artifacts/task-done/20261114T042159Z/manifest.json`。首次沙箱执行因Mix.PubSub本机socket `:eperm`未能建立测试库，保留原失败，获准本地执行后通过。21项原始检查20通过、gitleaks 1项非零；Top10实际6项，5项既有误报、1项既有接受风险，0阻塞；Semgrep实际扫描了全部新capture源码，两个既有author-behavior YAML parser警告保留。没有新增扫描排除或绕过门禁。

本批未单独提交依赖R01未提交消费者的测试碎片，未推送、未启动真实模型或原生页面，未签R01或B84完成。按主阶段完整验收只关闭A0（1/6）；A1/A2部分完成，A3–A5仍开放，不能把上述局部测试通过数当作整体完成率。

### A3 Application流程资源所有权（2026-11-14 设计/开始）

承接 `a3-backend/ownership-facts.json` 与真实 `task-owner-probe.exs`：当前helper等待全部run/task，超时返回成功；终态run不退出。独立Task.Supervisor实验已证明run/caller退出不会自动结束 `async_nolink` / `start_child` 任务，不能把stop server当作资源已清空。A2 capture局部验收已收口，本步不重跑该族矩阵。

- **Contract**：quality-gates §2.5.8；现有ExUnit退出顺序、DataCase/Sandbox事务与OTP进程身份。复用 `TestAgentRunCleanup`，新增函数仅服务当前run分配/释放消费者，不建新owner实体或框架。
- **Invariant**：同次运行复用已迁移数据库，case只拥有事务；本case实际run及其派生任务先结束，Sandbox owner后结束；其他owner的阻塞任务保持存活且不被等待；超时/释放失败不签成功。
- **Boundary**：仅application测试/support及既有索引；首批10个流程模块接入DataCase与明确登记。生产lib、Provider、产品状态协议、R01 WIP和Channel尚未迁移的实际消费者不改。
- **Consumer**：character design/evolution、world building、plot outline、prose drafting/revision、judgment plan、pending revision、fact inventory、ledger reconciliation的实际 `AgentRunService.start_bounded` 调用。成功创建后立即登记实际PID；显式中途释放与退出释放复用同一路径。已有relay仍只负责真实事件转发。
- **Proof**：实际run/嵌套Task、其他owner阻塞哨兵、run先死亡仍有task、重复释放、case断言失败、Sandbox回滚次序分别验证；原业务断言不减少。故意失败的子ExUnit运行应退出非零，外层观察必须证明run/task已终止后才停止Sandbox。旧全局入口的deadline反例只证明已知机制问题，不冒充新产品发现。
- **Acceptance Driver**：既有ExUnit真实服务/SQLite入口与外部受控子进程；这是一段测试机制闭环，产品验收感知新增no，不代签真实页面或模型。
- **Exploration**：不物化作品要素、不改变模型请求，不适用。

源码备份与当前单元证据落 `artifacts/b84-test-system/20261114/a3-backend/application-owner/`。worker按ub-mode做限定代码改造，leader通过现有run入口执行编译/目标测试/故障验证及所需工程门。Channel、Rust及其余入口仍是计划内后续，不能以本步替代完整A3。

实现前独立基线：`compile-before.log`编译退出0；`baseline-flow.json`的单个真实角色演化流程1/1通过后仍有1个run server，`baseline-all.json`的10模块46/46通过后仍有44个run server（step/background各0，测试耗时3475ms）。这些记录来自已备份源码和单一隔离SQLite库，不读取真实作者数据、不调用模型；源码重载警告属于该旧版本探针，不计当前工程编译告警。`legacy-timeout-probe.log`复现无本case资源时仍等其他阻塞task，30ms期限后返回`:ok`且task存活；`nested-callers-probe.log`确认当前Elixir的实际嵌套Task携带完整caller链。以上是本次迁移的前置事实，未签修复通过。

首稿未通过leader验收：`review-all.log`为51/51、残留0，但 `review-flows-trace.log`证明原46个流程中的character steer和volume scope两个case退出时出现 `DBConnection.ConnectionError: client ... exited`，旧基线无此日志；首稿直接结束run/task会打断尚在进行的数据库操作。`deadline-red.log`的真实Task shutdown反例为期限1ms、实耗73ms、返回`:ok`，不能按worker“最终仍raise”的描述签收。设计已在§2.5.8修正为先取消派发、仅等本run在途提交到安全点，再停止；超时仍须收口owned资源并暴露失败。`assertion-failure-invalid-setup.log`仅是探针allowed_tools为空的前置失败，不计退出机制证明；已修正探针输入，后续另记有效结果。

#### Application首批实施与验收 checkpoint

- 10个模块复用既有DataCase；32个成功启动点全部登记实际run PID，原46个业务用例名称/判据保留。`pending_revision`中途读取状态后释放该PID，随后退出再次释放仍幂等。relay职责未改，没有生产测试开关或新测试框架。
- `accepted-suite.json`：**53/53、0失败，run/step/background残留均0**，两个原流程的DB断连消失。对照旧46/46通过却遗留44个run server的基线，本步证明的是资源所有权和安全退出，不能据不同用例数/调度时长宣传整体提速。
- `inflight-transaction-valid.log`与`inflight-transaction.json`：真实AgentRun的step正在SQLite事务中时触发释放，事务完成后的作品行在case内可读，DataCase结束后同一库中该行已回滚，run/task均退出。首版探针把WorkRepo不接受的输入id当成实际主键，导致读nil；`inflight-invalid-id*`及`graceful-all.log`保留该探针错误，不当产品失败。
- `deadline-green.log`及`deadline-20ms-green.log`：1ms/20ms期限下均明确报错、所属run/task均死亡；后者实际进入50ms的阻塞shutdown并在期限触发强制收口。其它owner哨兵保持存活，实际嵌套caller链与run先死后的收口由7个helper用例验证。停止操作使用短受监控进程，返回前确认它也退出。
- `accepted-failure.log`与`accepted-failure-order.json`：故意断言失败、任务拒绝结束时，原断言和清理5000ms超时同时留证；清理后owned任务0，Sandbox尚可查询，其他owner任务仍活着。ExUnit原生会丢弃第二个on_exit异常，因此只在登记回调边界增加既有Logger记录并原样重抛，不改框架、不把错误转为成功。
- helper替身已改为真实 `{:command, :cancel}` 协议，并独立断言取消消息；移除无读取消费者的测试状态。曾吞掉未知cast而仍通过的首稿不能证明取消已送达。`consumer-purpose-check.json`记录32个启动/登记点和原用例名称不变。
- **全量 `MIX_ENV=test mix check`退出0：3194测试、0失败**，含强制零警告编译、codegen/enum、编译循环、架构、ADR与I-CACHE检查。该运行开始于最终日志边界/风格收敛之前；这些后续局部变化由最终53例、双失败探针和完整扫描复验，不冒充整套再次执行。Web的196例仍耗时547.9秒，仍属下一步的真实待治理对象，未签Web慢测试解决。
- 完整 `bash scripts/task_done.sh --top 10`（含完整 `bash scripts/ai_static_scan.sh --top 10`）首轮因本批helper的两项Credo规则失败；在原函数内改隐式catch和原生comprehension后复跑退出0，Credo issues为空，格式检查通过。原始21检查20通过/gitleaks 1非零；Top10实际6项，5项既有误报/1项既有接受风险，0阻塞。两轮扫描、最终manifest与源hash归 `application-owner/result.json`。
- 本机crapper/dryer未识别Elixir源码，mutator未提供该helper的有效分析；原输出归 `tool-support/`，退出0不计CRAP/重复率/变异覆盖通过。使用真实ExUnit、故障探针、Credo与仓库工程门补充本批证据，保留工具适用性限制，不安装或伪造评分。

本批只关闭Application流程这一checkpoint；Channel现役全局等待入口、其它runtime测试、裸Mix、Rust及A4/A5仍按原范围推进。没有重采R01模型基线或改生产lib；临时资源全部经既有owned入口运行，旧系统残留与作者证据保持不动。本地提交范围/结果见同一`result.json`，不推送。

### A3 Channel作用域与全局等待退役（2026-11-14 设计/开始）

Application首批已提交 `75722dde`。本步复用既有helper继续迁移，先前全量Web为196测试/547.9秒/0失败；该数是同一次umbrella回归的实测，不与不同入口的单文件耗时直接相减。

只读输入见 `a3-backend/channel-inputs.json`：8个旧全局等待模块共有97例，约45例会启动runtime（确认/拒绝竞态另辨），生产Channel只持单个active run字段，没有完整run所有权集合。leader进一步查到另外8个现役Channel测试模块，包括旧清单未覆盖的handoff、steer、task_state等，故迁移范围为当前全部16模块，避免只清旧helper调用点。

独立前置证据：`channel-owner/phoenix-caller-before.json`使用真实Phoenix Channel与受控Task，观察到Channel已由框架关闭、其后台Task仍活且caller链指向该Channel；失败探针自行释放该Task，未遗留到下一次运行。此为生命周期机制故障注入，不冒充实际模型/UI场景。`steer-before.json`运行现有steer模块，确认其永久等待fixture是否留下run/step以及对无关全局等待的影响；完整记录以原文件为准，不把全部Web耗时先验归给一个fixture。

- **Contract**：quality-gates §2.5.9、Phoenix.ChannelTest/ExUnit原生所有权与当前AgentRun身份；实体查重复用 `TestAgentRunCleanup` 的caller匹配、停止、deadline及退出错误记录，不新建框架、transport代理或进程注册器。
- **Invariant**：case/Channel/真实run的资源有明确PID来源；caller先退出、所属任务随后退出、Sandbox最后释放；其他owner不被等待或停止；持久记录不冒充runtime；配置恢复不串例，故障退出不假成功。
- **Boundary**：16个web Channel测试、既有application测试helper及其测试/索引；生产lib、Provider、R01 WIP不改。所有当前旧await调用者迁移后退役全局入口。
- **Consumer**：真实join返回的socket.channel_pid，实际ACK/child run/start返回的run_id；手工多transport测试仍使用已有Supervisor/forwarder，仅补资源登记。live kill场景保留原故障注入与业务判据。
- **Proof**：保留原测试名称/失败矩阵；真实Channel caller退出与子任务收口、无关阻塞哨兵、断言失败/超时/配置恢复；重跑steer实际模块与全web/umbrella回归，分别记录run/task残留与耗时。新功能先按已观察反例验证，不把目录为空或测试数量本身当目标达成。
- **Acceptance Driver**：既有ExUnit实际Channel/SQLite入口与外部受控进程；产品新增验收感知no。本步不代签Tauri或模型体验验收。
- **Exploration**：不物化作品要素、不改变模型请求，不适用。

备份与本步证据为 `artifacts/b84-test-system/20261114/a3-backend/channel-owner/`。worker负责限定代码改造，leader统一通过owned运行入口执行验收。

#### Channel checkpoint 验收（2026-11-14）

16/16 个 Channel 测试模块完成迁移，`await_quiescent` 与全局遍历删除且无残留调用者；真实 `socket.channel_pid` 在 join 后由 `register_task_caller/1` 登记，退出先等该 caller 再按 `$callers` 收口派生任务。证据在 `leader-final/result.json`：

- `apps/novel_web/test/novel_web/channels/` **132/132、0失败、62.2秒**；全量 `apps/novel_web/test/` **196/196、0失败、62.2秒**，用例数与迁移前记录的196一致，耗时由547.9秒降至62.2秒（同一web入口测量）。
- 修复两处真实缺陷：`workspace_channel_renumber_recompute_test.exs:244` 函数头 `^module` 无法编译，改为独立变量加 guard；`agent_run_cleanup_test.exs:341` 的断言正则按 `inspect` 对 keyword list 的实际输出修正，保留 timeout 与 supervisor 名断言。
- 全量 `MIX_ENV=test mix check` 退出0，umbrella **3203 tests、0失败**；web仍为196例/62.2秒。
- 运行后本机 `test-env-scope-*` 与 `ai-novel-test-run.*` 前缀均为0；本checkpoint未跑真实Tauri、模型或宿主强杀。

本checkpoint只签Channel迁移与回归，不签B84、A3全部或A4/A5。

### A3 日志写出责任源头收口（2026-11-14 设计/开始）

这是Channel审查中发现的责任层缺口，纳入B84原任务，不建立平行测试框架。`logging-lifecycle-inputs.json`审计167个LogEmit出现行/36文件以及尾位置调用链，未发现现役消费者依赖返回的Task PID；未宣称静态搜索等价于全部运行行为证明。ADR-0034的独立telemetry app、字段/路径/配置键约束继续生效；历史迁移为保持时序而留下的无监督Task由同一ADR补充接续，原Accepted身份不变。

`channel-owner/logging-before.json`已证明：旧logging测试1/1通过，但telemetry配置没有恢复、novel_common被误改，随后真实LogEmit writer完成后重建了已删除的case目录。早期探针漏require宏、以及未等writer就读取目录的版本分别保留在`logging-before-invalid-probe.log`和`logging-before-unawaited.*`，不算有效否定/肯定证据。配置恢复错误由Channel迁移修；已派发的writer捕获旧dir、不受后来配置恢复影响的独立问题须在生产者层处理。

- **Contract/Invariant**：ADR-0034 B84补充、quality-gates §2.5.10；日志调用归属于其调用者，返回即完成本次写出或诊断失败；无独立Task越过作用域重新创建目录，日志IO故障不改变业务控制流。
- **Boundary/实体查重**：仅现有novel_telemetry LogEmit及其测试/说明；复用已有write_jsonl、Logger与foundation ID，不新建writer/sink/队列/flush实体，不依赖application Supervisor，不改生产Channel/Provider/作品数据。编码与行字段仍由现有owner维护。
- **Consumer**：现役Channel、application、agent及LLMLog错误报告的LogEmit调用链。没有现役Task PID消费者，不保留两套返回形态兼容；副作用命令统一`:ok`。
- **Proof**：独立文件读取证明调用返回时完整行可见；启用/禁用、IO错误、producer退出、并发可解析JSONL、原字段/关联键与配置恢复；重跑telemetry及受影响消费测试、完整后端/工程门。测试不从writer自己派生期望字段或用sleep掩盖未完成。
- **Acceptance Driver**：外部受控ExUnit/真实文件边界，产品验收感知新增no。本checkpoint不代签B84后续Tauri真实页面与全系统强杀恢复。
- **Exploration**：不物化作品知识或改变模型输入，不适用。同步IO耗时是明确取舍，验证不得声称仍与旧异步时序等价或提供fsync保证。

备份与证据落 `artifacts/b84-test-system/20261114/a3-backend/logging-owner/`，实现与验收见 `leader-final/result.json`。

#### 日志源头收口 checkpoint 验收（2026-11-14）

- `LogEmit.maybe_write_jsonl` 由未受监督的 `Task.start` 改为调用者内同步写出；`mkdir_p/File.write` 失败经既有 `Logger` 诊断且业务调用仍返回 `:ok`；`emit/__emit__` 统一为 `:ok`，未保留第二套返回值。编码失败边界与原实现一致。
- telemetry 用例覆盖返回即可读完整行、禁用不创建目录、路径被普通文件占用只留诊断、producer退出后无独立writer继续重建目录、并发行仍可解析；`MIX_ENV=test mix test apps/novel_telemetry/test/novel_telemetry/log_emit_test.exs` **6/6、0失败**。
- 契约裁决：`event`/`level`/`timestamp` 为相位保留字段；`outcome` 是业务结果字段，允许调用方显式指定（`plan_draft`/`judgment` 的 `output_validation` 依赖 `rejected`/`retry`），未指定时按phase推导。原注释声称 `outcome` 不可覆盖，与两处真实生产消费者冲突；按真实消费者修正注释与测试期望，不改生产日志字段。日志读取脚本消费 `reason_code`，不读 `outcome`。
- 全量 `MIX_ENV=test mix check` 退出0；本checkpoint不签B84、A3全部或A4/A5，也不声称仍具备旧异步时序或fsync保证。

### A3 Rust测试资源释放（2026-11-14 设计/开始）

只读事实：`frontend/src-tauri/src/lib.rs` 的 `#[cfg(test)]` 共13个用例，其中5个在系统临时目录创建资源，清理都写在断言之后（`let _ = remove_dir_all` 或 `remove_dir_all(...).unwrap()`）；panic会越过该语句。本机现有5个 `ai-novel-secrets-message-outbox-*` 空目录残留（11/11、11/12及本次基线运行），根因不是panic：`pending_message` 把 `temp_secrets_path` 返回的**文件路径**当作目录根，写入实际落在 `<tmp>/provider_secrets.json/work-a/session-a`，末尾 `remove_dir_all(root)` 只删该文件路径，外层临时目录未被清理，所以正常通过也泄漏。基线 `cargo test --locked` **13/13通过、0.41秒**，CI的platform smoke同命令是真实消费者。quality-gates §2.5.8已明确“完整A3仍包括…direct Mix入口与Rust”。

- **Contract/Invariant**：§2.5.8；用例拥有其临时目录，正常返回与断言失败/panic都必须归还；不引入新crate、Node驱动或测试开关。
- **Boundary/Consumer**：仅 `frontend/src-tauri/src/lib.rs` 的 `#[cfg(test)]` 模块与现有 `cargo test --locked`；不改产品函数、sidecar行为、Tauri配置或CI命令。
- **实体查重**：test-only `TempDir` guard（Drop复用既有`remove_dir_all`），替换5处手动清理；不新建Rust测试框架、不引入`tempfile`等新依赖。`temp_secrets_path`改为返回guard与路径，调用者持有guard到作用域结束。
- **Proof**：正常路径全绿且前后临时前缀无净增；用`catch_unwind`用例证明panic展开时Drop释放目录；既有13个断言不减少；外部运行前后核对真实目录。
- **Acceptance Driver**：真实`cargo test`与真实文件系统；产品验收感知新增no。
- **Exploration**：不涉及作品知识或模型请求，不适用。

实施前保存源码备份；worker负责限定Rust改造，leader执行`cargo test`、故障注入与前后目录核对。

#### Rust测试资源释放 checkpoint 验收（2026-11-14）

- test-only `TempDir` guard（Drop复用既有`remove_dir_all`）替换5处手动清理；`pending_message` 改用真目录根，修复“把文件路径当目录根”导致正常通过也泄漏的既有缺陷，未改变任何业务断言。
- `cargo test --locked` **14/14、0失败、0.40秒**；新增 `temp_dir_guard_removes_directory_when_test_panics` 以 `catch_unwind` 证明panic展开时目录被Drop释放；`cargo fmt --check` 通过。
- 运行前后临时前缀**无净增**：历史5个 `ai-novel-secrets-message-outbox-*` 基线保持不变，新增0；guard测试自身目录未残留（`before/residue.txt`、`after-residue.txt`）。
- 历史5个残留未删除（旧运行证据，不顺手清理）；CI platform smoke 的 `cargo test --locked` 是同一消费者，本机未执行跨平台 smoke。
- `task_done.sh --top 10` 因 `frontend/src-tauri/` 路径被文件级UI判定阻塞（要求 native slice/summary）；本批只改 `#[cfg(test)]`、无产品UI行为变化，未伪造native证据。原始失败保留在 `leader-final/task_done-blocked.log`，替代证据为完整 `ai_static_scan.sh --top 10` 与 `cargo test --locked`。该门禁分类缺口登记到A5（与既有“Git提交入口质量门接线”同族），本单元不改门禁规则。
- 本checkpoint只签Rust单测资源释放，不签A3全部、B84或A4/A5；源码备份与结果见 `artifacts/b84-test-system/20261114/a3-backend/rust-owner/`。本批已本地提交（未推送）。

### A3 裸Mix/config/test入口的数据库归还（2026-11-14 设计/开始）

只读事实：`config/test.exs` 自2026-11-04按PID+partition命名测试库以避免并发busy；显式`NOVEL_TEST_DB_DIR`供外部驱动/长生命周期共用。本机系统TMPDIR现有**207个** `ai_novel_studio_test*.sqlite3`（约54MB），裸`mix test`每次运行留下本进程库，正常退出也不归还；`scripts/lib/test_env.sh`已为脚本入口提供owned run/借用与退出，但Elixir测试进程自身没有对应退出契约。

- **Contract/Invariant**：§2.5.8“direct Mix入口”与A1拥有/借用契约；自有库在正常与失败退出时都归还，显式目录属于借用不删除，并发进程互不影响。
- **Boundary/Consumer**：仅`config/test.exs`的测试库路径与退出登记；裸`mix test`、CI中经`test_env.sh`前置的`mix test`、既有slice/probe入口消费同一路径规则；不改产品配置、CI命令或`test_env.sh`。
- **实体查重**：复用现有PID/partition命名与`NOVEL_TEST_DB_DIR`语义，不新建scope服务；在配置求值时对**本进程自有库**注册标准`at_exit`删除db/wal/shm。
- **Proof**：裸`mix test`前后临时前缀无净增；故意失败的子运行退出非零仍无净增；显式`NOVEL_TEST_DB_DIR`运行后文件保留；两个并发进程各自归还；历史207个残留不动。
- **Acceptance Driver**：真实`mix test`与真实文件系统；产品验收感知no。
- **Exploration**：不涉及作品知识或模型请求，不适用。

实施前保存`config/test.exs`备份；验证走既有测试入口，不删除历史残留。

#### 裸Mix/config/test归还 checkpoint 验收（2026-11-14）

- `config/test.exs` 提取 `test_db_path`；仅当未设置 `NOVEL_TEST_DB_DIR`（本进程自有）时注册 `System.at_exit` 删除db/wal/shm；显式目录保持借用语义、不删除。
- 裸`mix test`：6/6通过，运行前后主库文件集合完全一致（净增0）；故意失败子运行退出2后同样净增0；两个并发`mix test`各自退出0且净增0，日志在 `mix-owner/b84-conc-{a,b}.log`。
- 显式`NOVEL_TEST_DB_DIR`：运行后`ai_novel_studio_test.sqlite3`、`-shm`、`-wal`均保留，证明借用未被误删。
- `MIX_ENV=test mix check`退出0（全量回归）；历史207个库/约54MB残留未删除（历史状态，A5统一处置）；宿主强杀不在本checkpoint。
- 本checkpoint只签direct Mix入口的自有库归还，不签A3全部、B84或A4/A5；证据在 `artifacts/b84-test-system/20261114/a3-backend/mix-owner/`。本批已本地提交（未推送）。

#### 其余 runtime 测试盘点与首批迁移（2026-11-14）

盘点用临时`after_suite`探针（不提交）逐个文件统计`AgentRunSupervisor`子进程与step/background任务。11个启动run但未登记的测试文件中，7个有残留：`agent_run_runtime_test` **42 run+3 step**、`auto_maintenance_test` 12、`agent_run_compaction_event_test` 3、`agent_run_subscription_lifecycle_test` 3、`agent_run_terminal_replan_test` 2、`agent_run_service_test` 1、`judgment_exploration_loop_test` 1，共**64 run+3 step**；`agent_run_result_commit_test`、`turn_interaction_service_test`、`author_question_roundtrip_test`、`agent_event_subscription_test`为0。

首批迁移6个文件、32 tests：run成功启动后按实际run_id调用`register_run/1`，退出先释放本run再停Sandbox。订阅生命周期测试保持on_exit顺序：登记release早于latch释放/杀task，使阻塞step先退出（LIFO）。验证：6文件各自0残留、32/32通过；全量application **1406/1406、0失败、10.4秒**；格式检查通过。

#### runtime_test 迁移收口（2026-11-14）

- 48个启动点中45处按绑定`run_id`/`id`登记；并发重传在得到唯一id后登记；`{:error,...}`期望与“重传旧事实”不登记（未新建run）。
- 订阅/阻塞类测试保持on_exit LIFO顺序：先释放latch/杀task，再release本run。
- `agent_run_runtime_test` **55/55通过**，临时探针 **0 run/0 step/0 bg**；全量application **1406/1406、0失败、9.9秒**；格式检查通过。
- 该文件3733行因本批45处登记越过ratchet，按§3.2在baseline登记豁免理由与2027-03-31复核日期；未压缩代码、未调高上限，拆分（提取共享fixture）留B78。
- 本checkpoint签runtime测试全部迁移；不签A3全部或B84。本批已本地提交（未推送）。

### A3 收口结论（2026-11-14）

A3计划行的范围项均有实际证据，**签A3完成、不签B84**：

| 范围项 | 证据 |
|---|---|
| DataCase/Sandbox复用 | Application 10模块与Channel 16模块统一用DataCase；46+132用例保留 |
| application/web support与test_helper | run/caller两种producer分别登记释放；web test_helper说明同步 |
| config/test | 自有库`System.at_exit`归还db/wal/shm；借用不删；裸/失败/并发无净增 |
| Rust现有测试模块 | `TempDir` RAII；14/14；`catch_unwind` panic用例；运行前后无净增 |
| 其余runtime测试 | 7文件87 tests迁移；探针0 run/0 step/0 bg；全量application 1406/0 |
| Application env不串例 | Channel迁移按原app/key/presence恢复；telemetry测试恢复env |
| 依赖方向/纯novel_test | 全量`mix check`架构检查通过；未改novel_test边界 |

本批之后A3不再有已知未迁移的后台run消费者；B84仍开放A1/A2其余Node族与A4/A5。

### A1 裸Node测试入口与probe作用域（2026-11-14）

只读事实：40个会创建外部资源的Node测试中仅10个接统一scope；CI只有quality manifest族经`novel_node_test_scope`，`native_ui` 909、`model_contracts` 43、根`scripts/*_test.mjs` 67个测试没有CI入口；`probe_run.sh`未接`test_env.sh`而dogfood等入口已接。

- **Contract/Invariant**：quality-gates §2.5、A1的拥有/借用契约；同一run的TMPDIR/scratch贯穿一个测试族；scope自身测试自持scope；退出码不吞；probe只借用作者模型服务、原始日志必须保留。
- **Boundary/Consumer**：新增`scripts/node_test.sh`薄入口；CI新增`node-tests` job（Node24）并在quality步骤改用同一入口；`probe_run.sh`经同一scope运行`mix run`。不改产品、测试框架或模型服务。
- **实体查重**：复用既有`novel_node_test_scope`/`test_env.sh`，不新建调度器、结果台账或fixture DSL；`--self`只是同一入口的显式分支。
- **Proof**：三组测试**909/43/67全通过**；scope包装`exit 7`原样返回7；`mix run`在scope内退出0；运行后`test-env-scope-*`与`ai-novel-test-run.*`均为0；probe原始日志仍落在`artifacts/model-contracts/logs/`。
- **Acceptance Driver**：真实`node --test`与`mix run`、受控子进程；产品验收感知no。
- **Exploration**：不适用。

验收：CI步骤与本地入口同源；真实provider探测本批未运行（服务仅借用，不代签模型行为）；A4原生/浏览器入口与A5 SIGKILL仍开放。本批已本地提交（未推送）。

### A2 authoring-auto-maintenance 族迁移（2026-11-14）

只读事实：`authoring_auto_maintenance_evidence.test.mjs` 1022行/23个测试；`evaluate()` 默认先 `buildDir()`，纯评估也每case建7表SQLite+20个驱动/AX文件；该族属A2未迁移的`authoring-auto-maintenance`（7表、真实SQLite）。

- **Contract/Invariant**：quality-gates §2.5、A2；纯评估零目录/DB；同run同规格模板只构建一次；写AX/DB或verify写summary的case取隔离副本；原23个测试判据不减少、不放宽。
- **Boundary/Consumer**：原测试文件（纯评估）、新增邻接IO测试、两个fixture模块，以及SUT的`dir`可选语义；真实`verifyAutoMaintenanceBatch`路径不变（始终传目录），模型/产品/运行时不改。
- **实体查重**：复用既有`materializeFixture`/`withWorkingCopy`与既有纯事实；不新建SQL/断言/场景框架；不与confirmation/call/R01族合并。7表是当前SUT实际投影，不称为生产完整Schema。
- **Proof**：纯14/14、fixtures/work均为0 entry；IO13/13；同run串行两次与并发两进程均只出现1个fixture目录（串行inode/mtime一致）；全量native_ui组913/0；原23判据拆为27个测试仍全部保留。
- **Acceptance Driver**：真实`node --test`与文件系统、受控并发进程；产品验收感知no。
- **Exploration**：不适用。

SUT仅在`dir`缺失时把C3/C4/C7/C9/C10标为unknown（不冒充pass/fail），真实批次始终有目录；端到端verify已复验通过。证据在`artifacts/b84-test-system/20261114/a2-auto-maintenance/`。本批已本地提交（未推送）。

### A2 authoring-run-history 族：first-consumer 文件迁移（2026-11-14）

只读事实：`authoring_run_evidence.test.mjs` 666行/18个测试；3个文件边界测试每次`mkdtemp`写transport/checkpoint，5个批次测试每case调用`createFirstConsumerBatch`建4表SQLite+config。该族另一个文件`authoring_history_evidence.test.mjs`仍开放，本checkpoint只签前者。

- **Contract/Invariant**：§2.5、A2；纯帧/transcript/llm事实零目录/DB；4表模板每run一次；改DB反例取隔离副本；原18个测试判据不减少。
- **Boundary/Consumer**：原测试（纯）、邻接IO测试、两个fixture模块；真实`authoringRunFacts/readAuthoringHistory`路径不变，不碰产品。
- **实体查重**：复用`materializeFixture`/`withWorkingCopy`；4表取`authoringRunFacts`实际读取投影；不与confirmation/call/R01合并。
- **Proof**：纯5/5、fixtures/work均0 entry；IO13/13；同run串行两次与并发两进程均出现1个fixture（串行inode/mtime一致）；全量native_ui组913/0。
- **Acceptance Driver**：真实`node --test`与文件系统、受控并发进程；产品验收感知no。
- **Exploration**：不适用。

证据在`artifacts/b84-test-system/20261114/a2-run-history/`。本批已本地提交（未推送）。

### A2 authoring-run-history 族：canonical 历史读取迁移（2026-11-14）

只读事实：`authoring_history_evidence.test.mjs` 619行/26个测试，26/26每case在系统TMPDIR建4表SQLite；负例覆盖run_mode/身份/段版本/形状/checkpoint v3，每个规格不同。按A2“不能从都使用SQLite推导可以共享同一规格”，不合并为单一模板。

- **Contract/Invariant**：§2.5、A2；唯一Schema/批次owner；case目录归run scope并在退出时回收；不同负例规格各自构建、不强行合并；原26判据不减少。
- **Boundary/Consumer**：测试文件与fixture模块；真实`authoringScope/readAuthoringHistory`路径不变，不碰产品。
- **实体查重**：复用既有`createBatch`语义与4表DDL；不新建SQL/断言框架；不与first-consumer/confirmation/call族合并。
- **Proof**：26/26通过；scope work/fixtures均0 entry；系统TMPDIR历史2个`b71-history-*`保持、无净增；全量native_ui组913/0。
- **Acceptance Driver**：真实`node --test`与文件系统；产品验收感知no。
- **Exploration**：不适用。

证据在`artifacts/b84-test-system/20261114/a2-history/`。本批已本地提交（未推送）。

## 变更记录

- 2026-11-08：立项（承接 00f P2-E 剩余 web 慢测试与债务）。
- 2026-11-12：登记验收资产 driver 漂移（aria-label="推理"）与验收脚本规模治理盲区；补 native_ui README 与 novel_e2e README 索引。
- 2026-11-13：B87 R00 核实干净 CI 的质量 parser 前置/集合断言失败，登记可独立执行的测试隔离修复；尚未实施。
- 2026-11-13：按作者指令扩展为全项目测试体系审查；复用既有owner设计运行/fixture/worker/case作用域及迁移顺序，代码实施与运行验收仍开放。
- 2026-11-14：实现A1/A2首批Node manifest与默认工程入口，分离纯规则/IO消费者，完成唯一fixture初始化及失败收口的局部机制验收；其余接入与全项目验收继续开放。
- 2026-11-14：A3 Channel 16模块迁移与日志源头收口完成并通过全量回归（3203 tests/0失败，web 196例62.2秒）；修复两处测试缺陷；已本地提交（未推送），B84、A4/A5仍开放。
- 2026-11-14：A3 Rust单测RAII释放、裸Mix自有库归还、其余runtime测试首批6文件迁移完成；`agent_run_runtime_test` 42 run+3 step残留保留为下一checkpoint；B84、A4/A5仍开放。
