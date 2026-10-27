# B42：真实模型行为与求证证据分层

- 状态：**doing（CP0–CP3 done，2026-10-27；CP4 blocked：ADR-0030 仍为 Proposed，作者裁决未下，AI 不代签）**。
- 登记日期：2026-10-27；来源：`release` / `release-real-llm` 均为 0 注册场景，实模与 deterministic 结果混在 nightly，AU-15 还缺 Base→Observation→used refs 的证据字段。
- 上游：[B41](B41-quality-evidence-foundation.md)、[AU-15](../../docs/design/acceptance/author/AU-15-evidence-seeking-authoring.md)、[B39](B39-evidence-seeking-authoring.md)、[tiers](../../quality/acceptance/tiers.md)。

## 1. 目标

建立两类不可互相代签的证据：

1. **机制证据**：计划、工具、观察、状态、持久化、恢复、页面操作和 adoption 是否按契约执行。
2. **模型行为证据**：真实模型在自然输入下是否自行选择求证、使用观察、承认未知或仍忽略证据。

同时让原生系统驱动、浏览器驱动、不同 provider/model、尝试次数、失败分母和保留措辞可机读，避免 HTTP 200 或 stub PASS 被写成模型语义 PASS。

## 2. 开工七问

1. **Contract**：B41 verdict、VS-00K/AU-15 的 Base/Observation/used refs、B27 实模双臂与保留集、原生/浏览器 driver 证据格式。新字段必须 additive 并有版本。
2. **Invariant**：实模与 stub 分 verdict；`supplied≠used`；未自报告=unknown；观察必须进入后续真实请求；输入/参数/重复数/禁答集/失败分母先冻结；缺凭据只能 blocked，不能 PASS。
3. **Boundary**：quality schema/runner/report、外部 verifier、原生证据索引、AU-15/B27 fixtures。生产 `apps/` 不改，不新增模型分支或专用 packet。
4. **Consumer**：B39/AU-15 实模求证、B27 语义评审、release 审核者与后续原生场景。
5. **Proof**：模型行为场景至少独立 2 次且全过才可选为通过，timeout/格式失败入分母；保留未调词措辞；browser/native、driver/provider/model、actual_model 可回放；观察 refs 与后续 provider call 顺序可判。
6. **Acceptance Driver**：真实 Tauri 原生系统 UI + 真实 provider，外部保存请求/响应、观察、页面和 DB 快照；产品验收感知逻辑 **no**。
7. **Exploration**：真实观察及 refs 必须来自作品读取，非硬编码；能沿 observation→provider_call→used refs 回查，不把工具日志当模型已读。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 冻结模型行为/机制两类结果、输入参数、重复与保留措辞、凭据 blocked 和分母语义 | **done（2026-10-27）**：契约见 §6；additive sidecar 版本策略冻结，B41 `quality-verdict/v2` 不改 |
| CP1 | `release-real-llm` tier/结果层落地；与 deterministic nightly 分开汇总；模型/参数/actual_model/驱动可回放 | **done（2026-10-27）：结果层落地 + registry 空为已知未闭环**；`release_layer.mjs` + CLI + `quality_accept.sh --tier release|release-real-llm` 接线 + 测试；空 tier 显式 not_run（exit 65）；真实 provider PASS 反假绿规则落地；tier 非空不伪造 |
| CP2 | 求证证据字段：`base_refs`、请求观察、`observation_refs/outcome/source_revision/coverage`、`observation_to_provider_call`、`used_context_refs/unbound_refs/unknown/preparation_outcome/stale_on_restore/replay_provider_called` | **done（2026-10-27）**：`evidence_chain.mjs` + 历史 artifact 只读读取 + 测试；集合/顺序/unknown 语义冻结 |
| CP3 | 原生证据发现：run/final/failure/scoped checks/termination/native-transport/AX/DB snapshot 统一 run manifest，含生产指纹与 scoped 范围 | **done（2026-10-27）**：`native_run_manifest.mjs` + 真实历史目录验证 + 测试；final+failure 并存不得只看 final |
| CP4 | AU-15 A0/A1/A2 预注册与真实运行；B27 语义 fixture 另按原 rubric，不与求证共享通过线；报告分机制/模型行为/文学评价。涉及 AU-15 的真实创作求证执行必须先经 ADR-0030 Accepted，证据基建不代替该决策 | **blocked（不在本 slice 本轮执行）**：ADR-0030=Proposed；登记见 §10，触发条件解除前不预注册、不真实运行、不写 PASS |

## 4. 非目标

- 不用真实 HTTP 200 代替模型自主求证或文学判断。
- 不把 stub 排好的探索步骤写成模型选择。
- 不要求所有场景都跑实模；凭据/平台缺失必须 blocked。
- 不把 scoped 原生结果外推为全矩阵、全供应商或文学收益。
- 不把 I10 人工盲评合并进自动模型行为 verdict。

## 5. 验证与恢复

- `release`/`release-real-llm` 有明确归属与分层结果层（CP1 done）；但当前仍 0 注册场景，tier 非空由 CP4（blocked）承接，本轮不得写成「不再为空」已达成。实模结果不与 deterministic 聚合为单一 PASS。
- A0 Base 足够可不探索；A1 人物承诺、A2 时间关系使用同一产品链，无领域专用分支。
- 关键缺事实场景独立≥2次全过，保留至少一种未调词措辞，失败入分母。
- 每个观察可追到 source/work/authority/version/coverage 与后续真实 provider 请求；未读取 ref 不得成为 used evidence。
- 恢复时先读 B41 verdict 和 B39 预注册，缺字段只能标 evidence_missing，不能补写 PASS。

## 6. CP0 契约冻结（2026-10-27，b42-verdict）

基线：HEAD `1ce14d5b`（B41 done）。冻结前门禁：`node --test scripts/lib/quality/*.test.mjs` 96/96、`bash scripts/quality_manifest_check.sh` passed（212 scenarios / 2 drafts / 214 manifests）。本节只冻结语义与版本策略，不产生任何 PASS；CP4 的真实运行前置（ADR-0030）不在本节解除。

### 6.1 两类结果语义（不可互相代签）

| 维度 | 机制证据（mechanism） | 模型行为证据（model_behavior） |
|---|---|---|
| 证明对象 | 计划、工具、观察、状态推进、持久化、恢复、页面操作、采纳边界是否按契约执行 | 真实模型在自然输入下是否自行选择求证、使用观察、承认未知或仍忽略证据 |
| 允许来源 | 确定性 provider、runner 退出/断言、app JSONL、turn_result、DB 快照、native transport/AX | 真实 provider 的请求与响应正文、模型输出字节、self_report、独立重复 run 的证据链 |
| 结论词表 | `pass \| fail \| unknown \| not_applicable` | 同上，但 `pass` 只允许真实模型行为判据满足时使用；确定性/stub 批次只能 `not_applicable` |
| 代签禁令 | 模型行为 pass 不能证明机制正确 | HTTP 200、局部证据、单次运行、supplied refs、工具日志、stub 排好的探索步都不能写成模型行为 pass |
| 汇总规则 | 每个 verdict 显式记录两层；组合 PASS 需两层各自满足（`quality-verdict/v2` 已冻结，B42 不改） | 同左；`release-real-llm` 结果层要求每个 pass 场景 `model_behavior=pass` |

### 6.2 模型行为冻结参数（运行前登记、运行后不得改写）

1. **自然输入**：场景输入只能用自然创作目标/作者原话，不得出现「请先调用某工具」「必须先查 X」等提示；输入措辞与 seed 在运行前登记，运行后不得为凑通过而改写。
2. **provider / model / 参数**：provider 标识（`lmstudio` / `strata` / `deepseek` …）、模型 preset、`actual_model`（provider 上报值）、temperature/top_p/max_tokens 等参数必须随结果记录；`actual_model != model` 只有在给出 mismatch 原因时合法，不得互相冒名。确定性 provider 与真实 provider 结果不得汇总成同一 PASS。
3. **独立重复**：关键缺事实场景（AU-15 A1/A2/B1/C1/C2 等）至少 **2 次独立 run 且全部通过**；每次独立 run 有独立 artifact 目录与 attempt 记录，同一 run 内重试不能冒充第二次独立运行。
4. **保留措辞**：至少保留 **1 种未参与调词的措辞**并记录 `retention_wording{text, ref, tuned:false}`；只有调过词的措辞 → 模型行为 PASS 资格不成立。
5. **失败分母**：分母 = 计划独立 run 次数；attempted / completed / failed / timeouts / format_failures 全部记录，timeout 与格式失败计入分母、不能排除。声称通过 = 计划 run 全过；例如 1/2 过记为不通过。
6. **禁答集**：B1/C1 类场景在 manifest 中预登记不得出现/不得声称的答案、refs；违反即失败，正文碰巧正确不能抵消。
7. **凭据 blocked**：缺凭据、provider 不可达、模型未加载、ADR-0030 未 Accepted → `blocked`（manifest）/`skipped`（批次）/`evidence_missing`（已执行但证据不全），**永远不能 PASS**；单槽模型约束下真实模型 run 结束必须 unload，生命周期 before/after 留证。
8. **失败证据保留**：失败批次只读保留，重试不得覆盖/删除旧证据；artifact 目录只增不删。

### 6.3 release / release-real-llm 结果层语义

| 层 | 归属 | 允许的 provider 类 | 通过条件 |
|---|---|---|---|
| `release` | 确定性机制证据 | 仅确定性（`slice_verify` 等） | 全部场景机制 pass + model_behavior=not_applicable + 回放身份齐全；任何 blocked/缺证据都不能 PASS |
| `release-real-llm` | 真实模型行为证据（含机制） | 仅真实模型（`lmstudio` / `strata` / `deepseek` …） | 每个场景 model_behavior=pass 且满足 §6.2 全部判据 + CP2 证据链无违规 + CP3 原生 run 非 fail；否则 fail/evidence_missing |

- **分层汇总**：结果按状态、机制层、模型行为层、provider 类分别计数；`single_verdict_allowed=false`，禁止把两层合并成单一 PASS。
- **与 nightly 分开**：deterministic nightly 结果不得提升/复制为 `release-real-llm` 结果；跨 tier 结果合并直接配置错误（exit 66）。
- **可回放身份**：每个结果必须记录 scenario_id / tier / surface / driver / provider / provider_class / model / actual_model / params / attempt / timeouts / git_head / generated_at / artifact_dir / input_ref / retention_wording_ref；模型行为 PASS 缺任一关键身份 → 不通过。
- **反假绿**：`status=pass` 需 `evidence_required ⊆ evidence_present`、机制/模型行为显式、真实 tier 每个场景有模型行为 pass、无 blocked/skipped、无 HTTP-200-only、无单次运行、无缺保留措辞、无 final/failure 冲突。真实 tier 的模型行为 PASS 还必须有 CP2 证据链且 binding 不是 violated/unknown；链缺失或 Base 未记录一律 evidence_missing（局部证据不能写成模型语义 PASS）。
- **空 tier 是已知事实**：当前 `release` / `release-real-llm` 均 0 注册场景；空 tier 结果是 `not_run` + `empty_tier` + exit 65，不是 PASS、也不是"全部通过"，并显式写 `known_fact`。tier 何时非空由 CP4（blocked）/后续作者裁决决定。

### 6.4 additive schema 版本策略

1. **B41 `quality-verdict/v2` 保持冻结**：不新增必填字段、不改读取语义、不升级版本号；旧 verdict 继续按 v2 读取，缺字段者按 unknown/evidence_missing 处理，绝不补写 PASS。
2. **新增三份 sidecar 契约**（各自独立版本，写入 artifact 目录，不改 verdict v2 结构）：
   - `quality-evidence-chain/v1` → `evidence-chain.json`（CP2，`scripts/lib/quality/evidence_chain.mjs`）
   - `quality-native-run/v1` → `native-run-manifest.json`（CP3，`scripts/lib/quality/native_run_manifest.mjs`）
   - `quality-release-layer/v1` → `release-layer.json`（CP1，`scripts/lib/quality/release_layer.mjs`）
3. **schema 落点**：`quality/acceptance/evidence-schema.json` 以 `$defs` 方式 additive 扩展描述上述契约；顶层历史字段保留，`additionalProperties: true` 不收紧。读取方不得因未知可选字段拒绝旧证据。
4. **版本升级规则**：破坏性变更必须并存新版本 id 并登记 README；可选字段 additive 可同版本，但必须写 description 并由测试交叉校验；禁止原地改语义。
5. **同源校验**：每个 sidecar 的 `schema_version` 常量、枚举与必填字段由各自 `*.test.mjs` 与 `evidence-schema.json` `$defs` 交叉校验（与 B41 verdict 同源做法一致）。

### 6.5 CP4 阻塞登记（不代签）

- AU-15 A0/A1/A2 的**真实运行**依赖 [ADR-0030](../../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md) 从 `Proposed` 变为 `Accepted`（作者裁决），以及 VS-00K/AU-15 冻结与真实 provider 凭据。当前 ADR-0030 为 Proposed。
- 因此 CP4 的「预注册 + 真实运行」在本轮**不做**：不创建 AU-15 可执行场景、不加载/卸载模型、不写任何模型行为 PASS。B42 CP0–CP3 的证据基建不代替该决策。
- **触发条件（明确）**：ADR-0030 被作者 `Accepted` → CP4 才执行 AU-15 A0/A1/A2 的预注册与真实运行（含 Lead 协调单槽真实模型窗口、run 结束 unload 并验证 loaded=null）；**不接受时 CP4 保持 blocked，不以历史证据/stub 替代**。
- **状态**：`blocked`，承接方 B39（CP4 触发后回到 B42 记录结果，不得以历史探索场景/stub/HTTP 200 代签）。

## 7. CP1 实现记录（2026-10-27，b42-verdict）

**交付物**

| 文件 | 作用 |
|---|---|
| `scripts/lib/quality/release_layer.mjs` | `quality-release-layer/v1` 纯函数层：tier 归属（release=deterministic / release-real-llm=real_model）、分层计数、`evaluateModelBehaviorEvidence` 反假绿判据（真实 provider、响应正文、≥2 独立重复、保留措辞、model/actual_model/params/driver、CP2 证据链、CP3 原生 run）、失败分母、回放身份、空 tier 已知事实、blocked 不得 PASS、summary 校验与只增写入。 |
| `scripts/lib/quality/release_layer_cli.mjs` | `summarize --tier <release\|release-real-llm>`：读 registry + B41 `batch.json` + 每场景 verdict + CP2 证据链 + CP3 原生 run，输出分层结果（可选 `--out` 写 `release-layer.json`）；空 tier exit 65、tier/batch 不一致 exit 66、pass 0 / fail 1 / evidence_missing 67。 |
| `scripts/lib/quality/release_layer.test.mjs` | 31 条测试：空 tier 已知事实、确定性 nightly 不得提升为实模 PASS、HTTP-200-only/单次/缺措辞/身份缺失不得 PASS、blocked 不 PASS、真实 au10 verdict 只读验证 release 机制层 pass、真实 p1 原生实模旧证据只能 evidence_missing(67)。 |
| `scripts/lib/quality/release_layer_accept.test.mjs` | 9 条 fixture 集成测试：`scripts/quality_accept.sh --tier release\|release-real-llm` 批次结束后写 batch 目录内 `release-layer.json`；既有退出码不变（pass 0 / fail 1 / 全 blocked 69 / 空 tier 65）；非 release tier 不产生结果层；确定性 provider 不会被写成实模 PASS。 |
| `scripts/quality_accept.sh`（B42 接线，Lead 批准） | `--tier release\|release-real-llm` 批处理在写完 batch.json 后调用 `release_layer_cli summarize` 读取本批 batch/verdict/证据，写 `artifacts/quality-accept/batches/<batch>/release-layer.json` 与 `release-layer.log`；**不改变既有退出码/tier 行为**，release 层错误只告警。 |

**分层汇总语义**：counts（planned/executed/pass/fail/skipped/not_run/evidence_missing）+ `layers{mechanism, model_behavior}` + `separation{provider_classes, mixed…, single_verdict_allowed:false}` + `replay.scenes`（身份可回放）+ `failure_denominator` + `blocked/not_run/evidence_missing_scenarios` + `open_gaps`。空 tier 输出 `status=not_run, exit=65, reason_codes=[empty_tier, known_fact_empty_tier], known_fact=…`。

**当前两 tier 仍为 0 场景（已知事实，未伪造）**：本轮不新增可执行 release 场景，也不把 nightly 的确定性结果移入 release 层；CLI 实跑 `--tier release-real-llm` 输出 not_run/exit 65 并写明已知事实。tier 非空与真实运行归 CP4（blocked）。

**接线（Lead 批准，2026-10-27）**：`scripts/quality_accept.sh` 的 `--tier release|release-real-llm` 批次在写完 `batch.json` 后调用 `release_layer_cli summarize --batch <batch.json> --out <batch_dir>`，产出 `release-layer.json`/`release-layer.log`。既有退出码与既有 tier 行为不变（fail=1、pass=0、全 blocked=69、空 tier=65 均有集成测试断言）；release 层结果为 not_run/fail/evidence_missing 时只告警，不把批次退出码改绿，也不把批次 PASS 反向写成模型语义 PASS。

**验证（CP1）**

```bash
node --test scripts/lib/quality/release_layer.test.mjs          # 31/31 pass
node --test scripts/lib/quality/release_layer_accept.test.mjs   # 9/9 pass（接线 + K5 + 确定性路径回归 fixture）
node --test scripts/lib/quality/quality_accept_shell_safety.test.mjs  # 3/3 pass（K4 静态回归）
node scripts/lib/quality/release_layer_cli.mjs summarize --tier release-real-llm   # exit 65 not_run empty_tier
bash scripts/quality_accept.sh --tier release-real-llm          # exit 65 no scenarios（registry 空，现有行为不变）
```

## 8. CP2 实现记录（2026-10-27，b42-verdict）

**交付物**

| 文件 | 作用 |
|---|---|
| `scripts/lib/quality/evidence_chain.mjs` | `quality-evidence-chain/v1`：Base refs / observations（outcome/source_refs/source_revision/coverage/observed_at）/provider_calls/self_report used refs 的归一化；集合校验（`used ⊆ Base ∪ 实际观察`、stale/unread ref 不得获信用、supplied≠used、未返回=unknown）、`observation_to_provider_call` 顺序判定、`preparation_outcome`/`stale_on_restore`/`replay_provider_called` 语义、binding 状态 `verified/partial/unknown/violated`；只读读取历史 artifact（ws frames / native-transport / app-log / llm-calls），写 `evidence-chain.json` 时拒绝覆盖旧证据。 |
| `scripts/lib/quality/evidence_chain.test.mjs` | 22 条测试：集合关系正反例、stale/unread、supplied 推导、观察晚于 provider 请求、replay 重调、元数据缺失=partial、显式/时间顺序链接、schema 同源、历史 ws frames 与 p1 原生实模 artifact 只读验证。 |

**集合/顺序语义（冻结）**

- `creditable` 观察结果 = `observed/empty/ambiguous/conflict`；`error` → unread、`stale` → stale、缺失 outcome → unknown（metadata_missing）。
- Base 未记录时，used ref 若不在观察集合 → `unresolved_refs`（unknown），**不得**误判成越界；Base 已记录时才判 `unbound_ref` 违规。
- 未返回 `used_context_refs` → `used_context_refs=null` + `used_context_refs_status=unknown`，不得从 Base/supplied 推导。
- `observation_to_provider_call` 支持 `request_observation_ref` 显式链接与 `time_order` 时间顺序两种；观察晚于其后续调用 → `observation_after_provider_call` 违规。
- `replay_provider_called=true` 的运行不得作为 replay 证据信用。
- 历史 artifact 缺 outcome/coverage/source_revision/Base → binding 只能是 `unknown`（或 partial），这是可机读的证据缺口，不是 PASS。

**真实验证资产（只读，不改写）**

- `artifacts/slice-verify/agentic-loop-plan-replan-reasoning-tauri/ui-frames.json`：抽取出 `observation_refs` 与 `self_report.used_context_refs`；Base 未记录 → `binding_status=unknown`，无越界误判。
- `artifacts/slice-verify/p1-chapter-draft-generation-native/`（strata 实模）：18 次真实 provider 调用、6 个观察 refs、真实 used ref（`chapter:<id>`）；`real_observation_link_count≥1`（观察先于后续真实请求），但历史证据缺 Base/outcome/coverage → `binding_status=unknown`、used ref 记 `unresolved`。证明顺序可判，同时证明旧证据不足以冒充 evidence-bound PASS。

**验证（CP2）**：`node --test scripts/lib/quality/evidence_chain.test.mjs` → 22/22 pass（含真实 artifact 只读用例）。

## 9. CP3 实现记录（2026-10-27，b42-verdict）

**交付物**

| 文件 | 作用 |
|---|---|
| `scripts/lib/quality/native_run_manifest.mjs` | `quality-native-run/v1`：扫描一个原生 artifact 目录（兼容 `run/` 嵌套与扁平历史布局），统一输出 run/final/failure/scoped/checks/termination/native-transport/AX/DB snapshot/生产指纹/driver/provider/model/scope 与 `status`；纯函数 `evaluateNativeRun`；`validateNativeRunManifest`；写入拒绝覆盖旧证据。 |
| `scripts/lib/quality/native_run_manifest_cli.mjs` | `scan <artifact-dir>` 输出统一 run manifest（`--json` / `--out`，默认拒绝覆盖旧证据）；只读扫描，不执行产品。 |
| `scripts/lib/quality/native_run_manifest.test.mjs` | 21 条测试：合成 fixture 语义（final+failure 并存→fail、TERM→fail、无 final/failure→evidence_missing、checks 失败→fail、identity 冲突→fail、scoped 不外推全矩阵、指纹两种历史格式）+ 5 个真实历史原生目录只读验证 + CLI（真实 p1 JSON、缺目录 66、--out 拒绝覆盖）。 |

**判定规则（冻结）**

1. `failure.json` 存在 → **fail**；即使 `final.json` 也存在（`final_failure_coexist`），不得只看 final 写 PASS。
2. `termination.json` 的 `exit_code != 0` 或 signal 非 `EXIT` → fail（被 TERM/KILL 的 run 不是通过）。
3. summary `all_checks_passed=false` 或合并 checks 中存在 false → fail（检查项名为证据，不能被 summary 字段覆盖）。
4. 跨来源 driver/provider/model 冲突 → fail `identity_conflict`。
5. 无 run 证据/无 final 且无 failure/无检查 → `evidence_missing`（旧 summary 存在不是 PASS）。
6. `scope_class=scoped` → 可 pass 但 `pass_scope=scoped_scope_only`、`full_matrix_established=false`，不得外推全矩阵。
7. 生产指纹：`head`（detached-meta 或 production-sources-before）、production sources 快照与哈希、app bundle id/version、`production_sources_unchanged` 检查、model lifecycle before/after presence。

**真实历史目录验证（只读）**

| 目录 | 结果 | 关键事实 |
|---|---|---|
| `p1-chapter-draft-generation-native` | pass / `scoped_scope_only` | strata iq3_s、AX 18 份、17 截图、DB 快照、transport 283 帧/28 HTTP、EXIT 0、无 failure；scoped 不外推 |
| `b28-native-20261025-a1` | fail | `final.json` 与 `failure.json` 并存 → `final_failure_coexist`；termination EXIT 1 |
| `b28-format-native-20261026-r3` | fail | TERM 143、无 final/failure → `termination_not_clean` |
| `b29-existing-character-role-revision-native` | pass / `full_scope` | 23/23 checks，full deterministic matrix |
| `b29-existing-character-role-revision-native-strata` | fail | 实模 failure 证据保留且可定位 |
| `b29-cp0-pass-final-20261025T0730`（旧扁平布局） | evidence_missing | 只有 summary 无 final/failure → 旧 summary 不是 PASS |

**验证（CP3）**：`node --test scripts/lib/quality/native_run_manifest.test.mjs` → 21/21 pass（真实目录用例在 artifacts 缺失时自动跳过）；`node scripts/lib/quality/native_run_manifest_cli.mjs scan artifacts/slice-verify/p1-chapter-draft-generation-native --json` 输出 pass/scoped。

## 10. CP4：blocked 登记（不执行、不代签）

见 §6.5。当前登记：

- 状态：`blocked`；未创建 AU-15 可执行场景、未运行真实模型、无模型行为 PASS。
- 阻塞条件：ADR-0030 `Proposed`（作者裁决未下）；AU-15/VS-00K 未冻结为可执行验收；真实 provider 凭据与单槽模型窗口未由作者/Lead 协调。
- 触发后动作：ADR-0030 Accepted → 与 Lead 协调真实模型窗口 → 按 §6.2 冻结参数预注册 A0/A1/A2（含自然输入、模型/参数、≥2 独立重复、保留措辞、禁答集、失败分母）→ 真实运行并用 CP2/CP3 证据层判定 → 结果只写机制/模型行为分层，文学评价交 I10，不由自动分数代签。
- 不得以历史探索场景、stub 批次、HTTP 200、旧 summary 代替；缺凭据只标 blocked。

## 11. 本轮验证与残余（2026-10-27，Lead 裁决后更新）

**门禁与证据命令**

```bash
node --test scripts/lib/quality/*.test.mjs    # 182/182 pass（B41 96 + CP1 31+9 + 静态回归 3 + CP2 22 + CP3 21）
bash scripts/quality_manifest_check.sh        # passed（212 scenarios / 2 drafts / 214 manifests）
git diff --check                              # clean
bash scripts/quality_accept.sh --tier release-real-llm        # exit 65（no scenarios，registry 空；既有行为不变）
node scripts/lib/quality/release_layer_cli.mjs summarize --tier release-real-llm  # exit 65 not_run/empty_tier
```

**Tier 所有权与阻塞（Lead 裁决：不注册占位/blocked 假场景）**

- `release`：确定性机制证据层；首批候选来自 B40 重锚后的既有 deterministic 场景，待 release gate 启用后按需迁移/登记。
- `release-real-llm`：真实模型行为证据层；首个真实场景 = AU-15 A0/A1/A2（CP4，ADR-0030 Accepted 后才预注册/真实运行）。
- 因此 registry 为空是**已知未闭环事实**（不是 PASS，也不是"tier 已非空"）；结果层以 `not_run + empty_tier + exit 65 + known_fact` 如实记录。详见 `quality/acceptance/tiers.md`。

**Known-gap 候选（交 Lead 统一登记 `quality/acceptance/known-gaps.md`；本 slice 不直接改该文件）**

| # | 候选 | 证据路径 | 缺什么 / 为什么不能补写 |
|---|---|---|---|
| K1 | 历史原生/实模证据缺 CP2 证据字段 | `artifacts/quality-accept/b42-cp1-cp3/evidence-chain-p1-chapter-draft-generation-native.json`（p1 native）、`evidence-chain-agentic-loop-plan-replan-reasoning.json` | 缺 `base_refs`、观察 `outcome/source_revision/coverage`、`preparation_outcome/stale_on_restore`；旧 artifact 未记录这些字段，补写等于伪造证据 → 只能 `binding=unknown/partial`、旧证据不得提升为模型行为 PASS |
| K2 | 历史原生/实模证据缺 CP1 模型行为判据元数据 | `artifacts/quality-accept/b42-cp1-cp3/`、p1 native artifact | 缺 `retention_wording{text,ref,tuned:false}`、独立 `attempts.json`（≥2 次）、显式 `params`/`actual_model` 来源；无法从旧日志反推 → release-real-llm 只能 evidence_missing(67) |
| K3 | `release`/`release-real-llm` registry 空、release gate 未启用 | `quality/acceptance/tiers.md`、`scenarios.yml`（无该 tier 场景） | 不是能力缺失而是**有意未闭环**：占位/blocked 假场景会制造覆盖假象 → 保持空并登记，按 tier 所有权等待 B40 重锚 / CP4 |
| K4 | ~~`quality_accept.sh` 既有（B41 代码）CJK 变量名 latent bug~~ **已修复（Lead 批准）** | `scripts/quality_accept.sh`（4 处改 `${var}`）；`scripts/lib/quality/quality_accept_shell_safety.test.mjs`（静态回归） | `$scenario_id：`/`$e2e_rc）` 等 `$var` 后紧跟全角字符被 bash 并入变量名，`set -u` 下 unbound/退出码异常，破坏 e2e aggregate 65/67/69 透传。已全部改 `${var}` 并加静态回归测试（双引号内 `$var`+非 ASCII 必须花括号）；正常路径行为不变 |
| K5 | ~~真实 provider pass 无 verdict 仍计 batch pass~~ **已修复（Lead 裁决按 evidence_missing）** | `scripts/quality_accept.sh` run_scenario（`verdict_rc==2` 分支）；`release_layer_accept.test.mjs` K5 用例 | `record_verdict pass` 返回 2（真实 provider 无模型行为证据）时不再继续 `passed`：单场景 exit 67、批量记 evidence_missing（不计 PASS）；确定性 provider 既有路径 0/64/65/67/69 与批次 0/1/69 有回归测试确认不变 |

**其他确认**

- `accept_verdict.mjs` 真实 provider 分支**保持 B41 语义未动**（`provider != slice_verify` 的 pass 返回 2、不写 PASS verdict；本 slice 未修改该文件）。
- `scripts/lib/README.md` 索引由 Lead 收口；本 slice 未改。
- `quality/acceptance/known-gaps.md` 归 B40/Lead，本 slice 未直接修改，只在上表提交候选。
- 真实模型窗口（单槽）未使用；本轮未加载/卸载模型，未起 Phoenix/Vite/Tauri。
