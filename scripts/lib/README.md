# Script Helper Index

`scripts/lib/` 放多个启动/验收脚本共享的 helper。这里的脚本不应单独作为用户入口；入口脚本应位于 `scripts/` 顶层或对应场景目录。

| 文件 | 角色 |
|---|---|
| `process_tree.sh` | 进程树终止与清理 helper，被 stage/dev/Tauri 验收脚本复用。进程组查询优先 `ps`，setuid `ps` 被执行环境拒绝/缺失时退化为 `python3 os.getpgid`（非 setuid）；两者都不可用时跳过组信号、只按 `pgrep -P` 收集的子孙回收，安全护栏绝不自杀。 |
| `test_env.sh` | **测试/验收入口统一运行时前置与 Node 运行作用域入口**（只 source）：`novel_test_db_dir` / `novel_test_db_prepare`（测试库目录解析、可选重置、create+migrate，migrate 失败 fail-closed）、`novel_wait_for_http`、`novel_ports_precheck`；`novel_node_test_scope` 薄委托 `test_env.mjs run`，不建库。被 `ai_static_scan.sh`、`slice_verify.sh`、`tauri_slice_verify.sh`、`dogfood_run.sh`、`quality_manifest_check.sh` 与 CI 复用，消除各入口自带的建库/等待/端口/Node 作用域前置漂移。 |
| `test_env.mjs` | 同一作用域契约的 Node 薄适配（不是测试框架/发现器/fixture DSL）：`openTestRunScope` 创建或借用 run scope 并给子进程传 `NOVEL_TEST_RUN_DIR` + 进程局部 `TMPDIR/TMP/TEMP`；受控 `NOVEL_TEST_RUN_DIR`/`TMPDIR`/`TMP`/`TEMP` 由 scope owner 最终派生（完整转发 env 也不能覆盖/删除）；`runInScope` 在顶层退出后收口本 run 进程组（正常/失败/取消/被杀同一 finalization 顺序，借用入口不建脱离组、不清理父组），收口失败保留 scratch 并非零；SIGINT/SIGTERM/超时复用 `process_tree.sh`；CLI 的最终结果在拥有的进程/资源收口之后确定，归档/输出/返回共用同一份有效退出码与失败事实（`cleanup_error`、`scope_removed`），cleanup 失败不掩成子进程成功；win32 owned 树收口显式未实现（非成功），parent-scope 借用仍由外层 owner 收口；`materializeFixture` 对「相对路径+内容」规格先在 run 内按内容指纹原子取得唯一初始化权（`.claims/*.claim`），只有 owner 构建并在完整校验后发布、再写 `ready`；其余进程等待该完整结果，不各自构建后竞争；初始化失败写 `failed`，等待者在本 run 明确失败不重建，owner 被杀或等待期限耗尽按基础设施失败。`createWorkingCopy` 给写文件 case 提供绑定 `TestContext` 的隔离副本。public `scope.close()` 清理失败抛异常；正常返回 `{dir, borrowed, removed}`，成功 close 幂等（第二次 close 只复用关闭事实，不再删除旧路径后来重建的资源），借用永不删除。CLI 在唯一 finalization 边界直接把 `close` 的 `removed`/可选 `error` 转成 `scope_removed`/`cleanup_error` 与有效退出码，并保留原始 child 退出码；Node 测试 `after` 直接调用 close，由 framework 接收异常而失败，不再解释软错误返回值。 |
| `test_env.test.mjs` | `test_env.sh` 的行为与接线回归（临时目录 + fake mix + 本地回环 HTTP）：目录解析、create/migrate 调用序列、`--reset` 的 drop 次序、migrate 失败 fail-closed、HTTP 等待成功/超时、端口占用、`novel_node_test_scope` 无建库/退出码透传/嵌套复用父 scope、入口与 CI 不再各自实现建库三连。 |
| `test_env_scope.test.mjs` | `test_env.mjs` 的真实 CLI/子进程作用域回归：owned scratch 与进程局部 TMPDIR、成功/真实断言失败/初始化失败、SIGTERM 取消与超时的进程树回收、子进程被杀后的 parent 收口、CLI finalization 顺序（先收口再归档）、cleanup/树收口失败的非零与保留 scratch、参数与借用边界 fail-closed、借用/嵌套不删父 scope 与 sentinel、同规格 fixture 单次物化与并发同 inode、两真实 Node 子进程同 scope/规格竞争时经 fs 边界观测 payload 只写入一次、初始化失败不发布/等待者不重建、owner 被杀与等待超时的明确基础设施失败、完整 env 转发仍写 owned tmp、正常/失败/被杀/取消（子进程捕获 TERM 后 exit 0）均收口后台孙进程且取消不返回成功、嵌套借用不清理父组并由外层收口、fixture 规格纯校验与复用前缺失/漂移/额外文件检查、工作副本隔离与模板只读/哈希不变、public close 清理失败抛异常且成功幂等（外部重建哨兵不被第二次删除）、裸 node:test 直接入口生命周期（before 初始化失败不残留、cleanup 失败非 PASS、借用不删父 scope、原 11 个 IO 全量通过且回收）。 |
| `tauri_dev_config.sh` | 生成 Tauri dev runtime overlay config，避免启动脚本改写 `frontend/src-tauri/tauri.conf.json`。 |
| `tauri_toolchain.sh` | Tauri dev/native build 共享的只读工具链定位：优先保留现有 PATH，缺失时仅把 `CARGO_HOME/bin` 或原始用户 home 的 `.cargo/bin` 前置到本次子进程 PATH；不安装/切换、不读隔离 HOME。被 `scripts/tauri_slice_verify.sh`、`scripts/frontend_audit.sh` 复用。 |
| `tauri_toolchain.test.mjs` | `tauri_toolchain.sh` 的受控最小 PATH/fake toolchain 回归：fallback、含空格 CARGO_HOME、不替换现有工具、隔离 HOME 不采用、缺失失败与两入口接线；不读写用户凭证。 |
| `b31-question-proof.mjs` | B31 浏览器驱动与原生验证器共用的纯回复证明/预算 helper；不操作页面或产品。测试在 frontend/slice-verify/b31-question-proof.test.mjs。 |
| `b28-chapter-fixture.mjs` | B28 原浏览器与原生验收共用的原始合成正文、旧全文兼容归一及ADR-0029计划/预览字节与实际分段校验；正文仍必须通过真实UI编辑采纳。 |
| `native_ui/` | [外部系统 UI 驱动](native_ui/README.md)：macOS AX/CGEvent 驱动真实 Tauri 窗口（原生验收 harness），含高层工作台动作与等待账；产品不读取。 |
| `quality/` | [B41 质量证据地基](quality/README.md)：标准 YAML 解析桥、manifest 语义校验/查询 CLI、反例测试；被 `scripts/quality_manifest_check.sh`、`scripts/quality_accept.sh`、e2e 聚合器消费。 |
| `author_visible/` | 作者可见文本泄漏扫描唯一实现（`leak_scan.mjs`）：读取 `docs/design/schemas/author_visible/display_names.json` 的 forbidden tokens，按「作者可见产品文案 / 模型正文排除 / AX name-description-value 分面」扫描；被 `native_ui/author_visible_check.mjs` 与 node 单测消费。 |

| `native_app_ownership.mjs` | B37原生重开归属清理：精确匹配本批独立可执行路径，清理前复核PID身份，输出退出证据；进程观测统一走 `native_ui/process_observation.mjs`（优先ps，setuid ps被环境拒绝时用pgrep+lsof等价精确归属），cleanup证据含 `process_observation`；由Tauri runner调用。 |
| `native_app_ownership.test.mjs` | 重开/同名其他批次/参数伪匹配的归属回归；共享解析器行为由 `native_ui/process_observation.test.mjs` 覆盖。 |

## Node 测试/变异作用域示例

外层入口只创建一次 run scope，整次调用的测试文件与重复重启的变异子进程都借用同一个
`NOVEL_TEST_RUN_DIR` 和受控 `TMPDIR/TMP/TEMP`。不要在每个测试文件、每个变异点或每次
重启时自行 `openTestRunScope()`，否则会为同一调用反复创建/回收 run。

```bash
# 整次 Node 测试调用共用一个 run scope（由外层 owned，退出时统一回收）
source scripts/lib/test_env.sh
novel_node_test_scope -- node --test scripts/lib/quality/manifest.test.mjs
```

```bash
# 纯 manifest 变异：只选能判别纯规则的测试；scope 包住 mutator 整次调用，
# 变异工具重启的每个测试子进程都继承外层 TMPDIR，而不是各自创建新 run。
# overlay 由 mutator 建立，必须让 Node 按 symlink 路径加载 overlay SUT；
# pure coverage 必须来自真实 pure 测试（target/coverage/typescript/lcov.info），
# 不能把 IO 用例混进 pure 覆盖，也不能让未覆盖站点假装被执行。
source scripts/lib/test_env.sh
NODE_OPTIONS="--preserve-symlinks --preserve-symlinks-main" \
  novel_node_test_scope -- ~/scripts/ub-tools/mutator/mutator \
  scripts/lib/quality/manifest.mjs \
  --use-existing-coverage \
  --test-command "node --test scripts/lib/quality/manifest.test.mjs"

# 作用域自身测试需要 owned scope：在外层 run 内移除继承的 NOVEL_TEST_RUN_DIR，
# 继续继承外层 TMPDIR，由外层 owner 统一收口。
novel_node_test_scope -- env -u NOVEL_TEST_RUN_DIR node --test \
  scripts/lib/test_env_scope.test.mjs
```

IO 边界测试在独立阶段用自己的 run scope 运行（真实文件/子进程），不要塞进每个纯变异点；
`manifest.test.mjs` 只覆盖内存规则，IO 点必须由 `manifest_io.test.mjs` 真实入口执行：

```bash
source scripts/lib/test_env.sh
novel_node_test_scope -- node --test scripts/lib/quality/manifest_io.test.mjs
```

工程入口（`scripts/ai_static_scan.sh` / `scripts/task_done.sh`）在参数解析后、资源初始化前
调用 `novel_node_test_scope_ensure`：裸入口由最外层申请一次 owned run；`task_done →
ai_static_scan` 等嵌套入口继承父 scope，不重复创建/不结束父 scope。已有
`NOVEL_TEST_RUN_DIR` 先经 Node borrow 校验（不在 Shell 解析 marker），无效则 fail-closed；
`--help` 与非法参数不构造 run。原始 argv 与退出码原样透传。

`test_env.test.mjs` / `test_env_scope.test.mjs` 是作用域自身的回归，必须直接拥有 run scope
（验证 owned/借用/清理语义）；可在外层 run 内运行，但入口必须 `env -u NOVEL_TEST_RUN_DIR`，
不能以借用父 scope 的方式运行。

## quality/（B41 证据基建）

契约文件位于 `quality/acceptance/verdict-schema.json`（quality-verdict/v2）。本目录 verdict 相关文件：

| 文件 | 角色 |
|---|---|
| `quality/verdict.mjs` | verdict v2 唯一生成/读取/校验实现：`buildVerdict`/`writeVerdict`/`readVerdict`/`validateVerdict`。缺 verdict.json、缺 status 或结构无效一律 evidence_missing，绝不默认 PASS；旧 summary.json 只算 artifact（legacy_summary=true）；拒绝用失败 verdict 静默覆盖已有 PASS。无外部依赖。 |
| `quality/verdict_cli.mjs` | verdict v2 的 bash runner CLI：`read <artifact_dir>`（JSON，退出码 0 pass / 1 fail / 65 skipped / 67 evidence_missing / 69 not_run）、`write <artifact_dir> <json>`、`validate <file>`。 |
| `quality/verdict.test.mjs` | verdict 负例矩阵、legacy 读取、PASS 覆盖保护与 schema/实现同源回归；运行 `node --test scripts/lib/quality/verdict.test.mjs`，无前端/npm 依赖。 |
| `quality/e2e_status.mjs` | B41 CP3 E2E 聚合器判定纯函数：场景状态 `pass/fail/blocked/stale/evidence_missing/not_run`、freshness（`git_head`/`current`）、聚合 verdict `quality-aggregate/v1` 与批量退出码；被 `scripts/e2e_01_full_chain_check.sh` 消费。 |
| `quality/e2e_status.test.mjs` | B41 CP3 负例 fixture：E4 blocked、旧 summary 无 git_head→stale、缺失/provider 不匹配、fresh pass 与退出码映射；运行 `node --test scripts/lib/quality/e2e_status.test.mjs`。 |
## quality/（B42 模型行为与求证证据分层，2026-10-27）

| 文件 | 角色 |
|---|---|
| `quality/evidence_chain.mjs` | B42 CP2 + §12：`quality-evidence-chain/v1`——Base refs、observations（outcome/source_revision/coverage）、observation→后续 provider call 顺序、used/unbound/unknown、preparation_outcome/stale_on_restore/replay 三态（`replay_status`）的归一化与集合校验；`quality-evidence-requirements/v1` 必需证据声明的归一化/校验与 `evaluateEvidenceCompleteness`；绑定/完整性判定与 artifact 记录读取；被 `release_layer.mjs`/CLI 消费。 |
| `quality/native_run_manifest.mjs` + `quality/native_run_manifest_cli.mjs` | B42 CP3：`quality-native-run/v1`——原生 artifact 目录统一 run manifest（run/final/failure/scoped/checks/termination/native-transport/AX/DB snapshot/生产指纹）；final+failure 并存必须 fail，scoped 不外推全矩阵；CLI `scan <artifact-dir>`。 |
| `quality/release_layer.mjs` + `quality/release_layer_cli.mjs` | B42 CP1 + §12：`quality-release-layer/v1`——release/release-real-llm 分层结果层（机制/模型行为分离、真实 provider PASS 反假绿、重复/保留措辞/失败分母、空 tier=not_run）；证据链一律重算、必需证据按声明逐维度判定（缺必需→evidence_missing，硬违规→fail）；CLI 读 artifact 记录的 evidence-chain/evidence-requirements 或 `--evidence-requirements`；被 `scripts/quality_accept.sh` 的 release tier 批次消费。 |
| `quality/release_layer_accept.test.mjs` | B42 CP1 接线 + K5（真实 provider passthrough→evidence_missing）fixture 集成测试。 |
| `quality/quality_accept_shell_safety.test.mjs` | K4 静态回归：扫描 `quality_accept.sh` 双引号内 `$var` 紧跟非 ASCII 的写法，避免 `set -u` 下变量名被全角字符吞并。 |

