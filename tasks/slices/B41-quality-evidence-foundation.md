# B41：质量证据地基——YAML、blocked 分层与 verdict 契约

- 状态：**done（2026-10-27，CP0–CP5 完成）**。CP0 冻结契约（PyYAML 标准解析 + 单一 manifest 模块、draft 注册表、证据词表 v2+迁移映射、verdict v2/退出码/负例矩阵；ADR 判定不适用，属 quality 运营契约）；CP1–CP4 分别落地解析/校验、批次状态分层、E2E 可信聚合、verdict v2 生成/读取同源与真实消费者；CP5 完成全量回归、known-gaps 类型词表与 B40/B42 交接。**诚实边界**：B41 是证据地基，不含产品功能验收；真实模型 PASS 判定与场景重锚分别由 B42/B40 承接。
- 登记日期：2026-10-27；来源：3 个 manifest 语法损坏、`ids-by-tier` 未排除 blocked、E2E 聚合器硬写已验收、evidence schema 不能表达真实结果。
- 上游：[全量对账](../2026-10-27-design-to-execution-reconciliation.md)、[known-gaps](../../quality/acceptance/known-gaps.md)、[evidence-schema](../../quality/acceptance/evidence-schema.json)、[B40](B40-judgment-era-acceptance-reanchor.md)。

## 1. 为什么必须先做

当前质量链存在四类根问题：

1. `agentic-loop-budget-deviation-replan`、`au13-review-adjudication-roundtrip`、`b27-prompt-lifecycle-consistency` 三个 YAML 不能被标准解析器解析，但注册为 active/nightly。
2. `quality_manifest_check.sh` / `quality_accept.sh` 主要用正则提取字段，无法可靠识别非法 YAML、重复 ID、缺键和证据词表漂移。
3. `ids-by-tier` 不按 blocked 过滤，nightly 遇到 blocked 后以 65 中止；pass/fail/skipped/not_run/evidence_missing 没有区分。
4. E2E 聚合器只按旧 summary 和硬编码状态写“已验收”，没有 blocked/freshness 判断，可能把 blocked 的 E4 继续写成 PASS。

在这些问题未解决前，后续场景重锚、B39 实模求证和“已完成”声明都缺少可靠证据地基。

## 2. 开工七问

1. **Contract**：现有 quality manifest、evidence schema、known-gaps 分类、E2E 聚合结果和 VS-00K/AU-15 的证据需求。新增 verdict 必须先冻结版本与兼容策略，不另建平行 manifest。
2. **Invariant**：非法 YAML 不得进入运行；必需场景 blocked 时聚合不得 PASS；证据缺失不得默认 PASS；stub/实模、browser/native、历史/current 必须可区分；失败证据不得删除。
3. **Boundary**：`quality/**`、`scripts/quality_*`、`scripts/e2e_01_*`、必要测试与文档。生产 `apps/` 不改；不引入未经检查的依赖或第二套验收框架。
4. **Consumer**：CI/nightly/PR 审核者、后续 B40/B42/B39 的 verifier 与证据索引。
5. **Proof**：3 个损坏文件可被标准解析器读取；故意非法 manifest 被 gate 拒绝；blocked tier 不再当普通失败或 PASS；E2E 必需 blocked 时聚合失败；缺 summary 为 evidence_missing；回归现有 active 场景。
6. **Acceptance Driver**：先以 manifest/CLI/脚本级自动化和负例为主，再选一条真实 Tauri 场景验证端到端 verdict 与报告索引。产品验收感知逻辑 **no**。
7. **Exploration**：不物化作品要素；输出只含验收证据、来源、版本、状态与链接，供后续审计和 replay 查询。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 固定三个 YAML；登记受控解析方案、现有依赖、兼容迁移与负例矩阵；若 verdict/schema 的新字段或枚举属于 C1 contract，先完成对应 ADR，再进入实现 | **done（2026-10-27）**：3 YAML 已语法修复（语义保持），215 文件标准解析全过；契约见 §6：PyYAML+单 manifest 模块、draft 注册表、证据词表 v2/migration、verdict v2/退出码/负例矩阵；ADR 判定不适用（quality 运营契约，记录待作者复核） |
| CP1 | 真正 YAML parse 总表/单表、id/tier/surface/entrypoint/必需键/重复项/anti-hooks/证据词表校验；非法文件和未注册场景失败 | **done（2026-10-27）**：PyYAML 解析桥 + `manifest.mjs` 单一校验实现 + CLI；非法 YAML/重复键/stray/draft 规则/证据词表 v2 迁移（20 manifest）/2 份 draft 受控登记；15 条负例测试全过；CI 固定 PyYAML venv 并跑测试 |
| CP2 | tier 与状态分层：active-only 执行；blocked=skipped+reason；失败=fail；无证据=evidence_missing；未运行=not_run；整批不得因 skipped 变 PASS。单独调用 blocked 必须返回专用非零/not_run 退出码，批量执行只在汇总中记 skipped+reason，不能把跳过当成功，也不能让夜间批次在首个 blocked 处意外中止 | **done（2026-10-27）**：`quality_accept.sh` 批次 rewrite（active-only/blocked skip 不中止/pass-fail-skipped-not_run-evidence_missing 分层/batch.json+logs/退出码 0-1-64-65-66-67-69）；5 条 fixture 集成测试；真实 pr-smoke 批次实跑（pass=1 fail=1，暴露 vs10 过期 driver 属 B40 已知项） |
| CP3 | E2E 聚合器增加 blocked/freshness/来源检查；E4 blocked 时不能写已验收；当前/历史/局部/缺失证据分开 | **done（2026-10-27）**：删除硬编码已验收/已测试；E1–E13 由 registry+verdict/legacy+git_head freshness+来源匹配计算；aggregate verdict=quality-aggregate/v1；E4 blocked 不写已验收；56 条纯函数测试；真实 `--provider slice_verify` 实跑 exit 67（blocked=1/stale=11/evidence_missing=1） |
| CP4 | evidence verdict schema 与真实消费者：status、reason、artifact links、surface/driver/provider/model/attempts/timeouts/git_head、mechanism/model_behavior、final/failure/scoped 索引；生成与读取同源，旧字段有迁移 | **done（2026-10-27）**：`verdict-schema.json` v2 + `verdict.mjs`（build/write/read/validate，缺 verdict/缺 status 一律 evidence_missing，PASS 反假绿）+ CLI；`accept_verdict.mjs` 接入 quality_accept（确定性 provider 写 pass，真实 provider pass 留 B42；证据缺失降级 exit 67）；20 条 verdict 测试 |
| CP5 | 全量 manifest/schema/CLI 回归与 B40/B42 交接；known-gaps 增加 retired/driver_stale/evidence_missing/implementation_missing 等可区分类型 | **done（2026-10-27）**：212 场景/2 drafts/214 manifests 标准解析与语义校验通过；96 条 quality 库测试全过；`--list`/tier-rows/ids-by-tier/负例矩阵回归；pr-smoke 真实批次 pass=1/fail=1（vs10 driver_stale 已分类登记）；known-gaps 类型词表 + 2026-10-27 发现登记；CI 文档补 `node --test` 入口；B40/B42 交接写明 |

## 4. 非目标

- 不借修基建批量改 active/blocked 状态；场景重锚归 B40。
- 不用正则在另一个文件重新实现“更聪明的 YAML 解析”。
- 不把 `summary.json` 存在当作 PASS，不把 `final.json` 与 `failure.json` 并存当作全通过。
- 不把实模、原生、浏览器、历史 scoped 证据合并成单一 PASS。
- 不修改产品代码来适配证据格式，不清理失败批次。

## 5. 验证与恢复

- 标准 YAML 解析器读取三文件成功，故意非法/重复/缺键/未注册文件被硬失败。
- `ids-by-tier` 不返回 blocked；批次汇总分别报告 pass/fail/skipped/not_run/evidence_missing。
- E2E 必需 blocked 时 aggregate 不 PASS；旧 E4 重锚或退役后按新结果计算。
- verdict 缺 status 时不能默认 PASS；final/failure/scoped 证据都可定位，浏览器与原生 driver 不混淆。
- 恢复时先读 B40/B42 的场景与证据需求，保持词表一致；缺真实凭据只标 blocked，不改写 verdict。

## 6. CP0 复现与契约冻结（2026-10-27，AI）

基线：HEAD `bf879e7d`；证据目录 `artifacts/quality-cp0/`（`parse-before-after.log`、`strict-survey.json`、`duplicate-key-scan.log`）。CP0 只复现/冻结契约，不实现校验逻辑。

### 6.1 真实复现（CP0 证据）

| 根问题 | 复现结果 | 证据 |
|---|---|---|
| 3 个 manifest 非法 YAML 但注册为 active/nightly | 标准解析器 PyYAML 6.0.3 在 `agentic-loop-budget-deviation-replan.yml:26`、`au13-review-adjudication-roundtrip.yml:42`、`b27-prompt-lifecycle-consistency.yml:46-47` 报 Parser/ScannerError；仓库现有 `quality_manifest_check.sh`（正则提取）对同一工作树返回 `passed` → 非法 YAML 可穿过门禁 | `parse-before-after.log` |
| 正则/字段提取脆弱 | `scripts/quality_manifest_check.sh` 与 `scripts/quality_accept.sh` 各有一份 `parseScenarioIndex` 正则；无法识别非法 YAML、YAML 重复键、字符串类型漂移；且两份实现可能漂移 | 源码 `quality_manifest_check.sh:23-42`、`quality_accept.sh:44-63` |
| `ids-by-tier` 不排除 blocked，批量在首个 blocked 中止 | `quality_accept.sh:91-99` 仅按 tier/surface 过滤；`run_scenario` 遇 blocked 直接 `exit 65`，`--tier` 循环无汇总，夜间批次在首个 blocked 处中止，且 skipped 无法与 fail 区分（`quality_accept.sh:197-203`） | 源码 + 5 个 blocked 注册项 |
| E2E 聚合器假绿 | `scripts/e2e_01_full_chain_check.sh` 的 `scenarioMatrix` 硬编码 `status: "已验收"/"已测试"`；`E4`（`e2e-01-downgrade-real-page`）在 scenarios.yml 为 blocked，聚合器仍写“已验收”；summary.status 只看 command exit + 旧 artifact 断言命中，无 blocked/freshness/来源判断 | `e2e_01_full_chain_check.sh:300-486`、`scenarios.yml` blocked 项 |
| evidence-schema 不能表达真实结果 | schema 仅 `scenario_id/surface/tier/artifact_dir/required`（required 仅 8 个枚举），无 status/reason/verdict/driver/provider/model/attempts/timeouts/git_head/机制-模型分层/final-failure-scoped 索引 | `quality/acceptance/evidence-schema.json` |
| 附加发现 | ① index 212 场景 / 214 manifest 文件，2 份 draft manifest 未注册且无受控登记（`b27-natural-author-intent`、`b34-author-intent-corpus-fixtures`）；② 70 个 manifest 的 `evidence.required` 使用非枚举 token（含 repo 相对路径，如 `ui_state`×50、`backend_log`×4、`llm_calls`×3、`artifacts/.../summary.json`×5 等）；③ 修后 215 个 YAML 全可解析；④ 当前无 YAML 重复键、无重复 scenario id、必需键/anti_hooks/consistency 均通过 | `strict-survey.json`、`duplicate-key-scan.log` |

**补充：已修复的 3 个 YAML**（仅语法修复，语义保持，diff 见 `git diff quality/acceptance/scenarios/`）：
- `agentic-loop-budget-deviation-replan.yml`：`"按钮" 后接自由文本` → 整条 single-quoted；
- `au13-review-adjudication-roundtrip.yml`：含 `: ` 的 plain scalar（`volumes: source refs` 等）→ single-quoted；
- `b27-prompt-lifecycle-consistency.yml`：3 处跨行 free-text `observe` → `>-` block scalar（折行→空格，语义不变）。

### 6.2 契约冻结（CP0 决策）

1. **解析方案（受控依赖）**：使用标准 YAML 解析器 **PyYAML 6.0.3**（已在本机存在）作为唯一解析源；新增 `scripts/lib/quality/yaml_bridge.py`（stdin 读路径列表、SafeLoader + 重复键检测、输出 JSON `{path, ok, data|error, line}`）；Node 侧 `scripts/lib/quality/manifest.mjs` 做全部语义校验/查询。**禁止**再写第二份正则 YAML 解析。PyYAML 缺省即门禁硬失败（明确安装提示），不得静默降级通过。CI 的 quality-manifest job 预置固定版本安装；本地要求写入 `quality/gates/local.md`。
2. **ADR 判定**：verdict/evidence schema 是 `quality/` 运营契约（00c §2.2 中 C1 设计对象清单不含它；B41 为执行任务），不需要新 ADR；以 `quality/acceptance/verdict-schema.json`（v2，additive）+ `quality/acceptance/README.md` 冻结，`evidence-schema.json` 保留并指向 verdict schema。若作者认为它属于需 ADR 的设计 C1 契约，暂停实现转 ADR——本判定记录于 CP0 供作者复核。
3. **manifest 状态词汇**：`active`（缺省）/ `blocked`（必有 `blocked_reason`）/ `draft`（新增；仅经 `scenarios.yml` 顶层 `drafts:` 注册，永不可执行、永不计 PASS）。
4. **执行结果状态词汇**：`pass | fail | skipped | not_run | evidence_missing`；`blocked` 不是执行结果而是 manifest 状态；批量 `skipped` 携带 reason 且不计 PASS；不得因 skipped 让整批 PASS。
5. **draft 注册表**：`scenarios.yml` 增加顶层 `drafts:`（`{id, manifest, reason}`）；`scenarios/` 下每个 yml 必须被 `scenarios` 或 `drafts` 引用，否则门禁失败。迁移现有 2 份 draft。
6. **证据词表 v2（canonical kind，闭集）**：`screenshot, websocket_frames, app_jsonl, turn_result, action_result, ui_state, backend_log, llm_http_log, provider_secrets_metadata, persistence_snapshot, summary_json, replay_api_response, seed_log, export_artifact, progress_jsonl, word_count_json, native_screenshots, native_transport_jsonl, persisted_session, memory_facts, audit_report`。迁移映射（CP1 机械执行并留 diff）：`ui_state→ui_state`、`backend_log→backend_log`、`llm_calls/llm_calls_jsonl/llm_call_jsonl/llm_http→llm_http_log`、`exported_markdown/exported_manuscript→export_artifact`、`audit-report.json→audit_report`、`summary.json→summary_json`、`replay_api_response_matrix→replay_api_response`、`progress_jsonl/word_count_json/native_*/persisted_session/memory_facts/provider_secrets_metadata/seed_log` 同名保留、repo 相对路径→新字段 `evidence.required_artifacts`（要求路径存在或声明可为 later 生成？**CP0 决定：必须存在，否则 evidence_missing**）、`live_provider_http_jsonl_when_provider_variant`→`evidence.conditional_required: [{kind: llm_http_log, when: {default_provider: lmstudio}}]`。
7. **verdict v2（初版冻结，CP4 实现）**：每场景运行后写 `artifacts/slice-verify/<scenario-id>/verdict.json`；字段 `schema_version=quality-verdict/v2`、`scenario_id, tier, surface, status, reason, reason_codes, driver, provider, model, actual_model, attempt, timeouts, git_head, started_at, finished_at, artifact_dir, artifact_links[{kind,path,role}], evidence_required/present/missing, mechanism{status,evidence_refs}, model_behavior{status,evidence_refs}, final_refs/failure_refs/scoped_refs`。**缺 verdict 或缺 status 一律视为 evidence_missing，不得默认 PASS**；旧 `summary.json` 只作为 artifact，不自动转 PASS（legacy 读取给 `evidence_missing`/`legacy_summary=true`）。
8. **退出码（冻结）**：`0`=pass（仅单场景）；`1`=fail；`64`=usage/config；`65`=blocked（单场景）/批量中有 blocked 仅记 skipped；`66`=manifest/gate 配置错误；`67`=evidence_missing；`69`=not_run（无任何场景执行，含“全被 blocked/skipped”的批量）。批量模式：不因 blocked 中止；只有无 fail/evidence_missing 且至少 1 个 pass 才 `0`；全 skipped → `69`。
9. **负例矩阵（CP1/CP2 必须覆盖）**：非法 YAML（3 例已修可回归）；YAML 重复键；重复 scenario id；缺必需键；证据词表漂移/路径不存在；anti_hooks 非 false；blocked 缺 reason；未知 tier/surface/status；manifest 未注册（stray file）；draft 与 scenarios 重复；manifest id/tier/surface/entrypoint 与 index 不一致；driver 缺失；verdict 缺 status 不得 PASS；batch 全 skipped 不得 PASS。
10. **兼容/迁移**：scenarios.yml 仅 additive（`drafts` + 可选 `status: draft`）；manifest 仅 additive（`required_artifacts`、`conditional_required`）；旧 summary/failure 证据不删除、不改写；`quality_accept.sh` 的公开入口/参数保持。
11. **验收方式（B41 Proof）**：`quality_manifest_check.sh` 对 HEAD 3 个旧 YAML 的历史内容若重放必失败（负例 fixture），当前树通过；负例 fixture 逐个硬失败；`ids-by-tier` 不含 blocked；batch 汇总与退出码矩阵；E2E 聚合 blocked 不写已验收；verdict 生成/读取同源且有迁移读取测试。
12. **CP0 完成判定**：3 个 YAML 已修复且 215 文件标准解析全过；上述契约冻结；CP1 起实现。**未运行产品 Tauri/实模**（本 slice 为证据基建，不需要；Acceptance Driver 以 manifest/CLI/脚本负例为主）。

### 6.3 CP0 残余/风险

- PyYAML 为系统/CI 依赖：需在 CI quality-manifest job 固定安装，并在本地文档登记；离线环境无 PyYAML 时门禁会硬失败（预期行为）。
- 70 个 manifest 证据词表迁移是机械但量大的改动；CP1 必须逐文件留 diff 并保证 `evidence.required` 语义不回退（只做 token 规范化/路径搬移）。
- 批量执行语义改变（原先首个 blocked 中止）会影响 nightly 脚本行为；CP2 同步更新 `quality/gates/ci.md`/`local.md` 的调用说明与退出码表。
- 现有 E2E 聚合结果与 blocked 状态矛盾：CP3 改为 honest blocked/freshness 后，nightly 的 e2e-01-full-chain 可能在 B40 重锚前显示 blocked（预期，不伪装 PASS）。

## 7. CP1 实现记录（2026-10-27，AI）

**交付物**

| 文件 | 作用 |
|---|---|
| `scripts/lib/quality/yaml_bridge.py` | 标准 YAML 解析桥（PyYAML SafeLoader + 重复键/多文档/非 UTF-8 拒绝；输出 JSON bundle）。唯一 YAML 语法入口。 |
| `scripts/lib/quality/manifest.mjs` | registry/manifest 语义校验唯一实现：id/tier/surface/runner/status/blocked_reason、必需键、anti_hooks、id/tier/surface/runner/entrypoint 一致性、evidence 词表 v2 + required_artifacts + conditional_required、draft 注册规则、stray manifest、driver/frontend driver/tauri list/ci.md 外部检查；查询函数 `idsByTier`（active-only）/`scenarioById`/`registryStatus`。 |
| `scripts/lib/quality/manifest_cli.mjs` | `validate/list/ids-by-tier/field/registry-status`；`quality_manifest_check.sh` 与 `quality_accept.sh` 共用。 |
| `scripts/lib/quality/manifest.test.mjs` | 15 条测试（真实仓库正例、非法 YAML、重复键、词表漂移、required_artifacts 形状、缺键/anti_hooks、blocked 缺 reason、重复 id、stray/draft、idsByTier active-only、registry 解析错误、CP0 三 YAML 回归）。 |
| `scripts/quality_manifest_check.sh` | 重写为环境预检（python3+PyYAML 缺失硬失败）+ `manifest_cli validate`。 |
| `scripts/quality_accept.sh` | 删除内嵌正则 `parseScenarioIndex`，`query_scenarios` 统一走 CLI；执行前先跑一次 manifest 校验（失败 exit 66，非法 manifest 不进入运行）。 |
| `quality/acceptance/scenarios.yml` | 新增顶层 `drafts:`（2 份 draft 受控登记）+ 20 个 manifest 证据词表迁移。 |
| `quality/acceptance/scenarios/*.yml` | 证据词表 v2 迁移：alias→canonical、repo 路径→`required_artifacts`（7 个路径清单场景，并按其文件类型补 summary_json/app_jsonl/websocket_frames/llm_http_log/screenshot/backend_log/replay_api_response）、provider 条件证据→`conditional_required`；语义等价由迁移校验脚本逐文件核对（non-evidence keys 不变，required/paths 与期望映射一致）。 |
| `quality/acceptance/README.md`、`quality/gates/local.md`、`quality/gates/ci.md`、`scripts/README.md`、`scripts/lib/README.md`、`scripts/lib/quality/README.md`、`.gitignore`、`.github/workflows/ci.yml` | 解析器依赖/校验入口/draft/词表文档；目录索引；CI 固定 PyYAML venv + `node --test scripts/lib/quality/*.test.mjs`。 |

**验证（CP1）**

```bash
bash scripts/quality_manifest_check.sh
# [quality-manifest-check] passed（212 scenarios / 2 drafts / 214 manifests；yaml=6.0.3）
node --test scripts/lib/quality/manifest.test.mjs   # 15/15 pass
bash scripts/quality_accept.sh --list               # 正常列出（active/blocked 均可见）
bash scripts/quality_accept.sh e2e-01-downgrade-real-page --surface tauri  # exit 65 blocked + reason
```

负例已覆盖：非法 YAML/重复键/重复 id/缺必需键/anti_hooks 非 false/blocked 缺 reason/词表漂移/required_artifacts 绝对路径/未注册 stray/draft 缺 status_note/draft 与 scenarios 重复。CP1 未运行产品 Tauri/实模（证据基建，不需要）。

**残余（转 CP2/CP4）**：`quality_accept.sh` 批量执行尚未写 batch summary/verdict（CP2/CP4）；E2E 聚合器仍硬编码状态（CP3，队友并行）；verdict schema/模块（CP4，队友并行）。

## 8. CP2 实现记录（2026-10-27，AI）

- `scripts/quality_accept.sh`：`--tier` 改为真正批次——`manifest_cli tier-rows` 返回 tier 内全部场景（含 blocked），active 子进程执行、blocked 记 `skipped`+`blocked_reason` 并继续；结果分层 `pass|fail|skipped|not_run|evidence_missing`；写 `artifacts/quality-accept/batches/<tier>[-<surface>]-<UTC>/batch.json` + `logs/<id>.log`；批量子进程通过 `QUALITY_ACCEPT_MANIFEST_VERIFIED=1` 复用父校验，避免 200 场景重复校验。
- 退出码（冻结实现）：`0` pass（批量需 ≥1 pass 且无 fail/evidence_missing）；`1` fail；`64` usage；`65` blocked 单场景/空 tier/整批无执行；`66` manifest 校验失败（执行前失败即停）；`67` evidence_missing；`69` not_run（批量全 skipped）。整批不因 skipped 变 PASS。
- 单场景：runner 退出 0 但 artifact_dir 不存在/为空 → `evidence_missing` exit 67；blocked 单场景 exit 65 + reason。
- 集成测试 `scripts/lib/quality/quality_accept_batch.test.mjs`（5/5）：pass/fail/skipped(blocked)/evidence_missing 分层 + fail 优先 1、全 active pass→0、全 blocked→69、单 blocked→65、空 tier→65；fixture 复制 `quality_accept.sh` + `lib/quality` + 假 runner，不进入真实产品驱动。
- 真实批次证据：`bash scripts/quality_accept.sh --tier pr-smoke` → exit 1，`counts={pass:1,fail:1}`（au10 pass；vs10 fail）。**vs10-observability-spine 失败为既有过期 driver（B13B D11：driver 仍以帧纪元 key events 等待，判断纪元后不再产出），属 B40 场景重锚范围，非本批引入**；B41 非目标不允许借基建改 active/blocked 状态，故不改 registry，移交 B40。

## 9. CP3 实现记录（2026-10-27，队友 b41-e2e + Lead 收口）

- `scripts/e2e_01_full_chain_check.sh`：删除 `scenarioMatrix` 硬编码「已验收/已测试」；E1–E13 场景状态由 `scripts/lib/quality/e2e_status.mjs` 纯函数计算：registry status（blocked 优先）、verdict/legacy summary 读取、`git_head`/`current` freshness、provider/surface/断言来源匹配；summary 显式列 `blocked_scenarios/stale_scenarios/evidence_missing_scenarios/not_run_scenarios`，内嵌 `verdict` 使用聚合专有 `schema_version=quality-aggregate/v1`（blocked 批内记 skipped，不冒充 CP4 v2）。
- 退出码：`1` fail 优先；`67` evidence_missing（含 stale/缺失）；`0` pass（无 fail/stale/缺失且 ≥1 pass）；`65` 整批全 blocked 无执行；`69` 全 skipped/not_run；`66` CLI/registry 配置错误。
- 测试：`scripts/lib/quality/e2e_status.test.mjs` 56/56（含 runner 静态防回归：不得残留「已验收/已测试/scenarioMatrix」）。
- 真实实跑（`--provider slice_verify`，默认 CLI 路径，已移除 fixture env override）：exit 67；`scenario_status_counts={pass:0,fail:0,blocked:1,stale:11,evidence_missing:1}`；**E4 blocked**（旧 summary 存在也只写 blocked+reason，不写已验收）；其余 11 个旧 artifact 因无 git_head 标 `stale`。证据：`artifacts/slice-verify/e2e-01-full-chain/summary.json`。
- `quality_accept.sh` e2e_aggregate 分支已透传聚合退出码（65/67/69/66 不再压成 1）并按状态写 verdict。
- 残余：E10 无独立真实页面 artifact → 当前定义下 aggregate 不会 PASS（AU-07 cross-reference；需 B40/补证据后才可 pass）；aggregate verdict 为聚合专有 schema，不过 `validateVerdict`（预期）。

## 10. CP4 实现记录（2026-10-27，队友 b41-verdict + Lead 收口）

- `quality/acceptance/verdict-schema.json`（draft 2020-12，`quality-verdict/v2`，additionalProperties=false，PASS 反假绿条件约束与读取规则写在 description）。
- `scripts/lib/quality/verdict.mjs`：唯一 `buildVerdict/writeVerdict/readVerdict/validateVerdict`；缺 verdict/缺 status/结构无效一律 `evidence_missing`（exit 67），legacy `summary.json` 只作 artifact（`legacy_summary=true` 且不 PASS）；PASS 要求 `evidence_required ⊆ evidence_present`、`evidence_missing` 为空、`mechanism/model_behavior` 显式且 ∈ `pass|not_applicable`；默认拒绝 fail/skipped 覆盖已有 PASS（需归档或显式 allowOverwritePass）。
- `scripts/lib/quality/verdict_cli.mjs`：read/write/validate，read 退出码 0/1/65/67/69。
- 真实消费者接线（Lead）：`scripts/lib/quality/accept_verdict.mjs` 由 `quality_accept.sh` 在每次 run 后调用——确定性 provider（slice_verify）pass 写 `mechanism=pass` + `model_behavior=not_applicable`，真实 provider pass 需 B42 模型行为证据故 B41 不写 PASS（读方 evidence_missing）；runner 成功但必需证据缺失时降级 `evidence_missing` 并让入口 exit 67；旧 PASS verdict 先归档 `verdict-history/` 再覆盖；attested 证据（runner 见证、未检测到具体文件）以 `runner_attested_evidence:<kind>` reason_code 显式标注。
- 测试：`verdict.test.mjs` 20/20；接线后真实运行：au10 pass verdict（read exit 0）、vs10 fail verdict（read exit 1，failure_refs 指向 failure.png/backend.log 等）。
- 残余：R5 本机无 draft-2020-12 独立校验器（用 draft-07 兼容子集 + 单测交叉验证）；R6 `git_head` 由调用方显式获取，缺失即 null（消费方按 stale，不 PASS）。

## 11. CP5 完成记录（2026-10-27，AI）

**全量回归（真实命令与结果）**

```bash
bash scripts/quality_manifest_check.sh
# [quality-manifest-check] passed（212 scenarios / 2 drafts / 214 manifests；yaml=6.0.3）
node --test scripts/lib/quality/*.test.mjs
# 96/96 pass（manifest 15 + verdict 20 + e2e_status 56 + accept 批次 5）
node scripts/lib/quality/manifest_cli.mjs list --root .            # 212 行，字段含 status/surface/runner/driver/entrypoint
node scripts/lib/quality/manifest_cli.mjs ids-by-tier nightly --root .  # 205（= nightly 210 − blocked 5，active-only）
node scripts/lib/quality/manifest_cli.mjs tier-rows <tier> --root .
# pr-smoke 2/2 active；nightly 210 = 205 active + 5 blocked；known-gap/release/release-real-llm 均 0
bash scripts/quality_accept.sh --tier pr-smoke
# exit 1（pass=1 fail=1；fail=vs10-observability-spine，driver_stale 已在 known-gaps 分类，属 B40 重锚范围）
```

**schema/CLI 回归**：verdict v2 生成/读写/校验同源测试覆盖（schema 常量与实现同源、缺 status→evidence_missing、PASS 反假绿、退出码闭集、legacy summary 不 PASS）；`quality_accept.sh` 先经 manifest 校验（非法 YAML exit 66），负例矩阵由 `manifest.test.mjs`/`quality_accept_batch.test.mjs` 全量覆盖；`quality/gates/ci.md` 增加 `node --test scripts/lib/quality/*.test.mjs` 为 CI 回归入口。

**known-gaps 类型词表**：新增 `implementation_missing / driver_stale / evidence_missing / retired / reanchor_pending / credential_blocked` 六类，并登记 2026-10-27 发现：`vs10-observability-spine`（driver_stale+reanchor_pending）、E4 `e2e-01-downgrade-real-page`（implementation_missing+reanchor_pending）、E10 持久化闭环（evidence_missing）、`b27-natural-author-intent`/`b34-author-intent-corpus-fixtures`（draft）、真实 provider pass verdict（B42 前 evidence_missing）。**未改任何 registry active/blocked 状态**（B41 非目标）。

**交接**

- **B40**：按 known-gaps 分类逐项重锚或退役（vs10、E4、au07-gate、B13B D7/D11 等），重锚后必须 current-HEAD 真实页面复跑并在 verdict 写 `git_head` 才能 pass；不得只改文本或做旧事件名机械替换。
- **B42**：真实 provider 的 PASS 需 `model_behavior` 层证据与 `release-real-llm` 结果层；在此前真实 provider 运行不得写 PASS（读方 evidence_missing 是预期行为）。
- **B41 自身不含产品能力验收**：本轮未运行产品 Tauri/真实模型（证据基建不需要）；不得以本 slice done 代签 B40/B42 的场景通过。

### CP5 追记（2026-10-27，B40 重锚后）

B40 将 registry 从 212/2/214 变更为 **207 scenarios / 2 drafts / 209 manifests**（退役 6：e2e-01-downgrade-real-page、au07-gate-reason-why、gap-wt04-non-exploration-frame-badges、agent-provider-streaming-progress、au10-micro-plan-entry、au01-garbage-json-recovery；新增 pr-smoke-core-reply）。因此 `scripts/lib/quality/manifest.test.mjs` 的真实仓库计数断言由 B41 CP5 的 212/2/214 更新为 207/2/209（防漂移用途），CP5 记录中的 212/2/214 保持为当时快照不改。另：B40 实跑发现并已由 Lead 修复 `accept_verdict.mjs` 短 git_head 与聚合器完整 hash 不一致（改为记录完整 hash；`e2e_status` 增加 `commitMatches` 兼容 ≥7 位短哈希并补测试）。

## 12. CP5 残余（交接后不阻塞 B41 done）

- legacy `summary.json` 只作历史 artifact：其存在不构成 PASS；重锚后由 B40 重新生成绩效 verdict。
- R5（无 draft-2020-12 独立校验器，使用 draft-07 兼容子集 + 单测交叉验证）与 R6（`git_head` 由调用方显式获取，缺失按 stale）保持登记。
- 真实 provider 的 `accept_verdict` 分支在 B42 落地前保持不写 PASS（预期 evidence_missing），不得为让报告变绿而放宽。
