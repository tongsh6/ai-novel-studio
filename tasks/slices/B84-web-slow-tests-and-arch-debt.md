# B84：全项目测试环境作用域、fixture 体系与剩余架构/测试债务

- 状态：**doing（A0完成；A1/A2首批Node质量manifest及工程入口已实现并通过局部机制验收；其他测试族、后端/Rust/前端/原生接入与全量运行验收未完成，原web慢测试及既有债务保留）**
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

## 变更记录

- 2026-11-08：立项（承接 00f P2-E 剩余 web 慢测试与债务）。
- 2026-11-12：登记验收资产 driver 漂移（aria-label="推理"）与验收脚本规模治理盲区；补 native_ui README 与 novel_e2e README 索引。
- 2026-11-13：B87 R00 核实干净 CI 的质量 parser 前置/集合断言失败，登记可独立执行的测试隔离修复；尚未实施。
- 2026-11-13：按作者指令扩展为全项目测试体系审查；复用既有owner设计运行/fixture/worker/case作用域及迁移顺序，代码实施与运行验收仍开放。
- 2026-11-14：实现A1/A2首批Node manifest与默认工程入口，分离纯规则/IO消费者，完成唯一fixture初始化及失败收口的局部机制验收；其余接入与全项目验收继续开放。
