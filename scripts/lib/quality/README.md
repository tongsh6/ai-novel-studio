# scripts/lib/quality/

质量证据地基（B41）的共享 helper。**禁止**在此重新实现 YAML 解析；YAML 语法一律交给 `yaml_bridge.py` 的标准解析器。

| 文件 | 角色 |
|---|---|
| `yaml_bridge.py` | 标准 YAML 解析桥：stdin 收 `{root, paths}`，用 PyYAML SafeLoader + 重复键检测解析，输出 JSON `{path, ok, data, error, line}`。唯一 YAML 语法入口。 |
| `manifest.mjs` | manifest 语义校验与查询的唯一实现（规则见 `tasks/slices/B41-quality-evidence-foundation.md` §6）；`loadProject` 是唯一 reader，并把实际目录 manifest 列表与 driver 存在性作为事实挂在 Project 上；`validateProject` 只消费这些事实做纯判定，外部 driver/`tauri --list`/`ci.md` 检查由 `validate()` 编排。被 `quality_manifest_check.sh`（经统一 Node 运行作用域）、`quality_accept.sh`、e2e 聚合器消费。 |
| `manifest_cli.mjs` | `validate` / `list` / `ids-by-tier` / `field` / `registry-status` CLI；执行入口与聚合器通过它读 registry。 |
| `manifest.test.mjs` | 纯语义负例矩阵：非法/重复/缺失 ID、路径越界、词表漂移、required_artifacts、anti_hooks、blocked、draft 注册与 `idsByTier`，以及合法 dogfood/e2e driver 正例；只在内存 Project/事实值上验证，不写临时项目、不读 YAML、不启动子进程/DB。真实的 `fs/子进程/DB 初始化 = 0` 观测与真实 IO 接线在 `manifest_io.test.mjs`。运行 `node --test scripts/lib/quality/manifest.test.mjs`。 |
| `manifest_io.test.mjs` | 真实 IO/接线负例：标准 YAML 解析、重复键、缺 manifest 文件/未注册 stray、driver 存在性事实、registry 解析错误与真实仓库集合一致性；只读 fixture 经外层 run scope 单次发布，写文件负例使用隔离工作副本。作用域申请与 fixture 初始化在 `before` 内完成，`after` 直接 `close`（cleanup 失败抛给 framework，借用只归还）；裸 node 入口初始化失败不残留 scratch。运行 `node --test scripts/lib/quality/manifest_io.test.mjs`。 |
| `manifest_fixture.mjs` | manifest 测试唯一合成 fixture owner：独立字面值 `minimalManifest/scenarioEntry/draftEntry`、真实 IO 规格 `fixtureProjectSpec`、纯语义 `memoryFixtureProject`（显式 IO 事实）；不 import 被测实现、不读 artifacts。 |
| `au15_preregistration_check.test.mjs` | B84 A2：AU-15 准备检查纯判定；只在内存输入上验证 unknown/blocked 均不 ready、D6-A/作者裁决/资源窗口不凭文字推定满足（资源窗口声明词有无都只 unknown）、模型/供应商身份只要求非空且一致（含已声明的 `setup.provider`，不固定 strata/iq3_s）、`budget_matches_v1` 只声称声明值符合 v1 约定、`scenario_preparation_declared` 只检查准备态声明；报告原样转录 `preregistration.status` 作为声明，不据此产生完成/授权字段，缺 status 也不改变 unknown/not_ready；不读真实 artifact、不建目录/子进程。 |
| `au15_preregistration_check_io.test.mjs` | B84 A2：`node scripts/au15_preregistration_check.mjs --root` 真实 CLI/IO 回归；合成项目根由 `materializeFixture` 在 `before` 一次物化、写差异走 `createWorkingCopy`、`after` close；覆盖缺文件/坏 JSON/YAML/非 mapping 的读边界非零且不写半成品、缺 status、预算不符、四项 unknown、显式缺 D6-A、模型/`setup.provider` 声明不一致与报告落点隔离。真实边界用 Node `--import` 给实际 CLI 入口装共享静态 preload（preload 只装 fs hooks，argv/main/process.exitCode 由 CLI 执行；子进程 env 走既有 scope）；固定 preload 作为独立只读代码 fixture 经 `materializeFixture` 与项目模板同 run 唯一物化、跨进程复用，每个测试进程只在 `scope.workDir` 下 `mkdtemp` 自己的 worker（guard 日志/哨兵只落该叶子），`after` 先核对日志、再释放自己的叶子、最后 close（借用只归还），因此同一外层 run 串行/并行重复启动互不读到旧 denial；真实 CLI 指向 repo root 的 guard 负例非零、静态命名 `readFileSync` 负控制被拒，并验证 denied root 下的测试自有 scope 不被误拒绝；测试不读真实 artifact。 |
| `au15_preregistration_fixture.mjs` | B84 A2：上述两测试共享的独立合成输入 owner（预注册/场景/文件规格）；不 import 被测实现，不读真实 artifacts 或真实预注册。 |
| `verdict.mjs` | B41 CP4：evidence verdict v2 生成/读取/校验（由 CP4 负责）。 |
| `verdict_cli.mjs` | B41 CP4：verdict 读写 CLI（供 runner/聚合器调用）。 |
| `verdict.test.mjs` | B41 CP4：verdict 构造/读取/迁移负例测试。 |
| `accept_verdict.mjs` | B41 CP4 真实消费者：`quality_accept.sh` 每次 run 后生成/写入 verdict（确定性 provider pass；真实 provider pass 留 B42；证据缺失降级 evidence_missing；旧 PASS 先归档）。 |
| `author_behavior_observation.mjs` | B73 产品外观察派生：子 turn 关联、TENTATIVE/canon/hash delta、真实章 ref 歧义、negative trap executed/evaluated 与虚构声明检查；`author_behavior_observation.test.mjs` 为对应回归。 |
| `author_behavior_live_cases.mjs` / `.test.mjs` | B71 实模作者行为输入选择器：加载/校验 B70 冻结 corpus（复用 loader/validator），按已批准 pilot 组/目标族/状态/split 选 case 并输出 `expression` 原文+sha+元数据+state/target/oracle/persona 记录；拒绝 expression_frozen=false、未知 case、explore 默认拒绝、未批准 pilot 外输入；不写 corpus、不生成输入。由 `scripts/author_behavior_live_case.mjs`、`authoring_capture_evidence.prepare` 与 Node 测试消费。 |
| `quality_accept_batch.test.mjs` | B41 CP2：批次状态分层/退出码 fixture 集成测试（pass/fail/skipped/evidence_missing/not_run）。 |
| `e2e_status.mjs` | B41 CP3：E2E 聚合器状态/来源/freshness 纯函数。 |
| `e2e_status.test.mjs` | B41 CP3：blocked/stale/evidence_missing/provider mismatch 等 fixture 测试。 |
| `evidence_chain.mjs` | B42 CP2：`quality-evidence-chain/v1` 求证证据链（Base refs / observations / observation→provider call 顺序 / used-unbound-unknown / preparation/stale/replay）归一化、集合校验与历史 artifact 只读读取；被 `release_layer.mjs`、`native_run_manifest.mjs`、`release_layer_cli.mjs` 与测试消费，无独立 CLI。 |
| `evidence_chain.test.mjs` | B42 CP2：集合关系正反例、顺序违规、supplied≠used、历史 ws frames / p1 原生实模 artifact 只读验证；实际临时输出目录统一归文件级 run scope（`after` close，不使用 repo/tmp）；`node --test scripts/lib/quality/evidence_chain.test.mjs`。 |
| `native_run_manifest.mjs` | B42 CP3：`quality-native-run/v1` 原生 artifact 目录统一 run manifest（run/final/failure/scoped/checks/termination/native-transport/AX/DB snapshot/生产指纹/identity），final+failure 并存不得只看 final；被 `release_layer_cli.mjs` 消费。 |
| `native_run_manifest.test.mjs` | B42 CP3：合成 fixture 判定语义 + 真实历史原生目录（p1/b28/b29，缺失跳过）只读验证。 |
| `release_layer.mjs` | B42 CP1：`quality-release-layer/v1` release/release-real-llm 分层结果层（机制/模型行为分离、真实 provider PASS 反假绿、重复/保留措辞/失败分母、空 tier 已知事实、blocked 不得 PASS）。 |
| `release_layer_cli.mjs` | B42 CP1：读 registry + B41 batch + verdict + CP2 证据链 + CP3 原生 run，输出分层结果；空 tier exit 65、跨 tier 合并 exit 66。 |
| `release_layer.test.mjs` | B42 CP1：分层/反假绿/空 tier/CLI 真实历史证据只读测试（31 条）。 |
| `quality_accept_shell_safety.test.mjs` | K4 静态回归（Lead 批准）：扫描 `scripts/quality_accept.sh` 双引号内 `$var` 紧跟非 ASCII 的写法（`set -u` 下会 unbound/退出码异常），要求 `${var}`；含扫描器自检与 4 处已修复写法防回退。 |
| `release_layer_accept.test.mjs` | B42 CP1 接线（含 K5 真实 provider passthrough → evidence_missing）：`scripts/quality_accept.sh --tier release\|release-real-llm` 批次后写 batch 目录内 release-layer.json 的 fixture 集成测试；既有退出码/既有 tier 行为不变（6 条）。 |
