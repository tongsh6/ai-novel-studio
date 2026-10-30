# B42：真实模型行为与求证证据分层

- 状态：**doing（CP0–CP3 与 §12 历史交付保留；§13 实际请求输入绑定整改 CP0–CP3 done（2026-10-30）；CP4 真实运行仍 blocked：待 B39 接线、预注册/driver 与资源窗口）**。
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
| CP4 | AU-15 A0/A1/A2 预注册与真实运行；B27 语义 fixture 另按原 rubric，不与求证共享通过线；报告分机制/模型行为/文学评价。涉及 AU-15 的真实创作求证执行必须先经 ADR-0030 Accepted，证据基建不代替该决策 | **blocked（真实运行）**：ADR-0030/VS-00K/AU-15 已于 2026-10-29 Accepted；可准备预注册，产品/driver 与资源前置见 §10，未运行不写 PASS |

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

2026-10-27 的 ADR 接受前置已于 2026-10-29 由作者明确解除；当前 CP4 状态、剩余依赖和恢复顺序统一见 §10。可以先做预注册/场景设计，不能把设计接受或 B42 结果层完成当作 B39 产品能力及真实运行已就绪。

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

- 状态：`blocked`（真实运行）；尚未注册可执行 AU-15 场景、未运行真实模型、无模型行为 PASS。预注册与 driver 设计可先准备，不能将整项工作都视为作者阻塞。
- 已解除：作者于 2026-10-29 明确接受 ADR-0030、VS-00K、AU-15 为 B39 实施基线，记录见 [B39 §9.7.17](B39-evidence-seeking-authoring.md#9717-c01-实施基线收口)。
- 剩余前置：B39 场景所需产品接线与最小准备判断、外部 driver/verifier 和可执行场景登记、运行前参数/必需证据预注册、真实 provider 可用性与单槽模型窗口；设计接受不自动满足这些条件。
- 恢复顺序：按已接受 AU-15 与 B39 CP 设计预注册/driver → 所需产品接线就绪 → 冻结自然输入、参数、必需证据、关键缺事实场景≥2独立重复及失败分母 → 协调资源窗口并真实运行 → 分别记录机制/实模/原生交互。文学评价仍交 I10。
- 不得以历史探索场景、stub 批次、HTTP 200、旧 summary 代替；缺凭据只标 blocked。

### 10.1 AU-15 预注册与 driver 准备

- 状态：**todo（2026-10-30 明确 CP4 可独立推进的准备入口；真实运行仍按上节 blocked，未注册可执行场景、未产生新 PASS）**。
- 范围与来源：消费已接受的 [AU-15](../../docs/design/acceptance/author/AU-15-evidence-seeking-authoring.md)、[VS-00K](../../docs/design/contracts/VS-00K-evidence-seeking-authoring-contract-pack.md)、B39 §4/§9 的既有 CP 与预注册，以及本任务 §6/§12 的证据词表和完整性规则；只细化准备步骤，不改通过阈值、失败分母或作者裁决。
- 下一步：核对 A0/A1/A2 与后续场景的产品接线、真实 Tauri 外部驱动入口、verifier 采集点和现有证据适配，形成缺口—owner—依赖矩阵；将运行前必须确定的自然输入、保留措辞、参数、重复安排、必需证据与结果判定落实成可审阅预注册方案。未就绪入口写明依赖，不以占位/blocked 假场景填满 registry。
- 准备交付物：区分真实创作/采纳 setup 与测量 run，说明样本来源、版本、适用性与复用条件；列出用户操作→请求/观察/产物→持久事实→页面反馈的 driver/verifier 路径；对接 Base、观察、后续请求、used refs、准备结果、恢复/replay 与模型/driver 身份，区分 unknown、not_executed、evidence_missing 和明确失败。独立重复、保留措辞与失败分母沿已接受契约，不因当前难以采集而删要求。
- 完成边界：准备 checkpoint 完成只表示方案、接口与依赖可审阅，不能把产品接线、真实场景登记、模型资源窗口或运行结果标为完成。B39 所需能力就绪后才冻结可执行版本并登记场景；资源安排明确后再真实运行。文学收益仍归 I10，B27 的独立语义 rubric 不并入 AU-15。
- 归属：B42 负责证据与运行前声明，B39 负责产品与场景语义；本项可先推进，不加载模型、不写产品数据、不改历史 artifact，也不替作者安排评审人或新增资源授权。

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

## 12. 证据完整性回补（2026-10-29 done）

- 状态：**done（CP0 契约冻结 → 判定实现 → 反例矩阵 → CLI/结果层集成；真实模型与真实页面仍归 CP4，不由本节代签）**。
- 来源：本任务 §6/§8 的反假绿与 unknown 边界、[B39 D4](B39-evidence-seeking-authoring.md#97-开放决策清单给作者每项选项-推荐-影响)。这是 CP1/CP2 的残余修复，不依赖 ADR-0030 Accepted。
- CP0 复现的缺陷（2026-10-28，`fixture_only=true`、`real_model_called=false`，无生产请求/模型调用）：
  1. `evaluateModelBehaviorEvidence` 只把 `binding=violated/unknown` 加入拒绝原因；构造输入满足其余身份/重复/观察链接条件、但 `binding=partial` 且有 `observation_metadata_missing` 时，仍返回 `eligible/pass`、空原因列表（反例输入与结果：`artifacts/quality-accept/b42-evidence-completeness-review/probe.json`；本证据不写 release 批次、不充当真实模型 PASS）。
  2. `evaluateEvidenceChain` 的 `verified` 只检查 base/used/metadata 三个条件，`preparation_outcome_unknown`/`stale_on_restore_unknown` 等 blocker 被吞；产物可携带自证 `binding=verified` 摘要而判定不重算。
  3. `replay_provider_called=false` 无法区分“replay 已执行且证明未调 provider”和“replay 根本没跑”，历史代码把后者写成 `false`。
  4. 场景没有“必需/不适用/未执行”声明，无法判断 A0 零探索是合法缺席还是缺证据，也无法阻止事后删要求放行。
- 结论：只把 `verified` 收紧或只要求 `verified` 都不够；需要**声明 + 逐维度完整性 + 重算 + 原因传播**四件一起，否则仍会把 partial/未知读成 PASS。

### 12.1 CP0 契约冻结（2026-10-28，additive 同版本，历史读取保留 unknown）

1. **场景必需证据声明** `quality-evidence-requirements/v1`（落点：artifact `evidence-requirements.json`、registry 场景字段或 CLI `--evidence-requirements <file>`）：
   - `{schema_version?, dimensions, note?}`；8 维度：`base_refs`、`observations`、`observation_link`、`source_metadata`、`used_context_refs`、`preparation`、`restore`、`replay`；
   - 每维度 `required` | `not_applicable`；未声明 → `required`（严格默认，忘记声明不会自动放行）；
   - 反缩水结构约束：`base_refs`/`used_context_refs` 必须 required；`observation_link`/`source_metadata` required 时 `observations` 必须 required；未知维度/非法值/未知顶层字段直接 config error（CLI exit 66/pure 函数抛错）；
   - 旧 CLI flag `--requires-observation-link` 只并入“增加要求”（observations/link/source_metadata 强制 required），不会减少声明。
2. **未执行不是不适用**：`replay_status = not_executed | no_provider_call | provider_called | unknown`（evidence-chain v1 additive 可选字段）。`provider_called` → 硬违规；`not_executed`/`unknown` → 未证明 replay 不调 provider，replay 声明 required 时按证据缺失；历史链缺字段 → `unknown`，旧布尔 `replay_provider_called=false` **不得**反推已验证。
3. **A0 合法零探索**：Base 足够场景可声明 observations/link/source_metadata/preparation/restore/replay 为 not_applicable，不因无观察被判缺失。
4. **完整性判定语义**：必需维度缺失/未知/未执行 → `evidence_missing`（67）；硬违规 → `fail`（1）；`observation_link` 在“观察与真实 provider 调用两侧都已记录、却无可判顺序链接”时按 fail（因果断言被证据否定），任一侧未记录则只算 evidence_missing（不能从缺失反推违规）；必需维度完整且无阻塞 blocker 才可 PASS。
5. **汇总硬约束**：`release-real-llm` 的 PASS 汇总要求每个 pass 场景 `evidence_completeness.status=complete`（`validateReleaseLayerSummary` 强制），不能出现“tier PASS 但场景证据不完整”。

### 12.2 实现清单

| 文件 | 行为变化 |
|---|---|
| `scripts/lib/quality/evidence_chain.mjs` | 新增 `REPLAY_STATUSES`/`EVIDENCE_DIMENSIONS`/`EVIDENCE_REQUIREMENTS_SCHEMA_VERSION`；`buildEvidenceChain` 记录 `replay_status`（旧布尔 false→unknown）；`evaluateEvidenceChain` 的 `verified` 收紧为“无任何 blocker”并返回 replay 三态；新增 `normalizeEvidenceRequirements`/`validateEvidenceRequirements`/`applyLegacyEvidenceFlags`/`evaluateEvidenceCompleteness`/`readRecordedEvidenceChain`/`readRecordedEvidenceRequirements`；`readLlmCalls` 追加 `request_params`（真实请求体采样参数白名单，供 CLI 回放身份，不读正文）。 |
| `scripts/lib/quality/release_layer.mjs` | 证据链一律重算（`evaluateEvidenceChain`），不再信任 artifact 自带 binding 摘要（不一致只记 `checks.evidence_binding_summary_mismatch`）；按声明算完整性并传播原因码；blocker 归因（声明 not_applicable 的维度不阻塞但留明细）；新增 `evidence_chain_invalid`/`evidence_requirements_invalid`/`required_*_missing` 等原因码与 `evidence_blockers`/`evidence_blocking_blockers` 明细；scenario rows 增 `evidence_requirements`/`evidence_completeness`，replay scenes 增 `evidence_binding`/`evidence_completeness`；PASS 汇总强制 completeness。非法声明 → `ReleaseLayerError(code=config)`。 |
| `scripts/lib/quality/release_layer_cli.mjs` | 读取 artifact 记录的 `evidence-chain.json`（校验失败→该场景 evidence_missing + `evidence_chain_invalid`，不 crash 整批）与 `evidence-requirements.json`（损坏→`evidence_requirements_invalid`）；新增 `--evidence-requirements <file>`（显式文件非法→exit 66）；采样参数从真实 llm-calls 请求体读取（缺失不伪造，按 `missing_model_params` 处理）；usage 更新。 |
| `quality/acceptance/evidence-schema.json` | additive：evidence-chain 增可选 `replay_status`；新增 `$defs.evidence_requirements`（quality-evidence-requirements/v1）；release_layer_summary 描述补 §12 字段与 PASS 约束；不新增必填、不升级版本、历史读取不收紧。 |
| `scripts/lib/quality/evidence_chain.test.mjs` | 34 tests（原 22 + §12 12）：replay 三态、verified 无 blocker、声明归一化/反缩水、A0/完整/缺 used/缺元数据/未跑 replay/link 分界、artifact 记录读取非法拒绝、schema 同源。 |
| `scripts/lib/quality/release_layer.test.mjs` | 44 tests（原 31 + §12 13）：完整链 fixture 改为真实证据链并声明未实现维度 N/A；partial+真实链接不 PASS（probe 同型）、伪造 verified 摘要重算后 evidence_missing、缺 used、replay required 未执行、A0 通过、旧 artifact 摘要→evidence_missing、非法声明 config、PASS 汇总完整性校验；CLI 退出码矩阵 0/1/64/65/67/69。 |

边界遵守：未改 `apps/`、`frontend/src`、产品 prompt、历史证据、`quality/acceptance/scenarios.yml` registry；未注册占位/假场景；未启动真实模型/Phoenix/Vite/Tauri；未重写旧 artifact。

### 12.3 反例矩阵与验收映射（§12.3 逐项）

| 要求（原 §12.3） | 用例 | 结果 |
|---|---|---|
| partial+真实观察链接 | 「§12 反例复现」+ probe.json 同型输入；链上 `observation_metadata_missing` | evidence_missing(67)，原因 `required_source_metadata_missing`/`observation_metadata_missing`/`required_evidence_missing`，不再 PASS |
| verified+必需 blocker | 伪造 `binding=verified` + `preparation_outcome_unknown` 且 preparation required | 重算 partial；`checks.evidence_binding_summary_mismatch=true`；evidence_missing(67) |
| 缺 used refs | `used_context_refs=null` 链 | evidence_missing(67)，`required_used_context_refs_missing` |
| 缺来源版本/覆盖 | 观察无 outcome/source_revision/coverage | evidence_missing(67)，`required_source_metadata_missing` |
| 未跑 replay | replay 声明 required + `replay_status=not_executed` | evidence_missing(67)，`required_replay_evidence_missing`，不得写成已验证不调 provider |
| A0 合法零探索 | Base recorded、used 自报告为空、其余声明 N/A | PASS(0)；requirements 结论 complete，observations=not_applicable |
| 完整正例 | 真实证据链 fixture（Base/观察/链接/used/元数据齐；prep/restore/replay 声明 N/A） | PASS(0)，`evidence_completeness=complete` |
| 旧 artifact | 仅 `binding` 摘要的骨架链 / 无记录字段 | evidence_missing(67)，不 PASS 也不误判 fail |
| CLI 0/1/64/65/67/69 | fixture CLI：pass→0、越界→1、非法参数→64、空 tier→65（既有）、缺必需→67、全 not_run→69 | 与结果层一致；空 tier 仍 not_run/65，不注册假场景 |
| `quality_accept` 分支 | 既有 `release_layer_accept.test.mjs`（0/1/64/65/67/69 + K5 + 非 release tier 不写结果层） | 211/211 quality JS 测试全过，批次退出码未被本回补改变 |

### 12.4 验证记录（2026-10-29，本地只读/纯函数，无真实模型/页面）

```bash
node --test scripts/lib/quality/*.test.mjs                     # 211/211 pass（含 evidence_chain 34、release_layer 44）
node --test scripts/lib/quality/evidence_chain.test.mjs        # 34/34
node --test scripts/lib/quality/release_layer.test.mjs         # 44/44
node --test scripts/next_task_check.test.mjs                   # 25/25（未受影响的排期检查回归）
bash scripts/quality_manifest_check.sh                         # passed（207 scenarios / 2 drafts / 209 manifests）
```

- 直接使用真实历史 artifact 的 CLI 用例保持原判定：`p1-chapter-draft-generation-native` 仍 evidence_missing/67（历史 artifact 缺 Base/元数据/重复身份），没有因新版判定被“升级”成 PASS。
- 本轮未运行 `mix test`（未改 Elixir）；未加载模型；未起 Phoenix/Vite/Tauri；probe.json 未写入 release 批次。

### 12.5 残余与接回完整闭环

1. **CP4 真实运行仍 blocked**：设计已于 2026-10-29 Accepted，剩余产品/driver/预注册/资源条件见 §10；本节历史基建修复不是 AU-15 完成。
2. **release/release-real-llm registry 仍 0 场景**：CLI PASS 分支只在 fixture 证据链上验证；首个真实场景归 CP4，`quality_accept --tier release-real-llm` 在真实场景登记前仍只会有 no scenarios/K5 evidence_missing，不得写成“tier 已非空”。
3. **声明冻结的信任边界**：完整性依赖运行前冻结的声明；纯函数层能校验声明结构（反缩水）但不能自证声明是在看到结果之前写的。CP4 预注册时应把声明写进 manifest/artifact 并留 `declared_at`/来源 ref；当前契约已支持，未新增强制执行。
4. **历史证据保持只读**：旧 artifact 不补写 `replay_status`/声明；读取一律 unknown → evidence_missing。任何历史数据修复需作者单独授权。
5. **quality schema 同源校验**：新增字段由 `evidence_chain.test.mjs` 与 schema `$defs` 交叉校验；未改 B41 `quality-verdict/v2`。

恢复：先复现 probe.json 反例，审读 §6/§8/§11、`quality/acceptance/tiers.md` §必需证据完整性 与 B39 §9，再改判定；不得通过放宽声明/删除维度让测试变绿。排队与实现完成不构成降低通过标准的作者裁决，也不代替 CP4。

## 13. 元原则整改：实际请求输入绑定

- 状态：**CP0–CP3 done（2026-10-30）；CP4 真实运行仍 blocked**。本节整改只动质量证据归一化/判定/读取与结果层，不动产品内容/provider/数据库；§12 历史交付保留。
- 来源：[元原则审查 F05](../2026-10-27-design-to-execution-reconciliation.md#164-九类现役偏离与修复归属) 与已有纯函数反例：请求观察引用明确为空，当前 `time_order` 仍可令绑定为 verified。§12 历史完成只覆盖当时列出的完整性问题，不关闭这一新缺口。
- 元原则：M3 要求真实观察进入真实请求。时间先后只用于验证顺序；工具返回、APP记录、反向索引和存盘 binding 摘要都不能单独证明请求实际包含材料。
- 证据目录：CP0 复现/对照 `artifacts/quality-accept/b42-binding-cp0/{probe-pre-fix.json,probe-after-fix.json,probe.mjs}`；CP2 CLI/只读回归 `artifacts/quality-accept/b42-binding-cp2/`。基线 HEAD `e1685675` + 2026-10-30 文档队列 WIP；两个 probe 分别记录旧/新 `evidence_chain.mjs` sha256，纯函数调用，无 provider/model/页面/服务。

### 13.1 CP0：真实来源、字段与历史兼容（2026-10-30 done）

#### 13.1.1 来源核对（已核实事实）

| 事实 | 位置 | 兼容/整改含义 |
|---|---|---|
| 请求侧观察关联目前无生产写入 | B39 §9 字段映射表；`readLlmCalls`（`evidence_chain.mjs` :1057）与 `readArtifactEvidence`（:1169）不产出 `request_observation_refs` | 历史/当前真实链只能 unknown；不能把时间顺序当输入证据 |
| 缺失与显式空数组被归一成 `[]` | `normalizeProviderCall`（:298）与 `normalizeObservation`（:263）用 `?? []`；`buildObservationLinks`（:365）无显式引用时按时间顺序兜底 | 必须引入 recorded/unknown 三态；显式 [] = “明确未包含”，缺失 ≠ 未包含 |
| 反向关联被当作有效链接 | `observed_in_calls` 只参与 explicit 链接，未与请求侧交叉核对 | 反向声称只作交叉核对；矛盾保留为违规 |
| 自报告 used refs 无调用归属 | 真实 `quality_action` 帧只有 used_context_refs、无 provider_call_ref（抽查 16 处 co-occurrence 均为 null）；`readArtifactEvidence`（:1147/:1185）拍平成整 run 并集 | used 必须绑定报告调用；无法定位 → evidence_missing，不猜最后一次调用 |
| real 标记可被手填 | `normalizeProviderCall`（:310）`raw.real===true \|\| class===real_model` | real 只由 provider 分类决定；手填冲突记违规 |
| 判定信任序列化缓存 | `evaluateEvidenceChain`（:639）直接读 chain 上 links/blockers/violations/unbound | 必须从原始字段重算；缓存仅比对，不一致 → `evidence_chain_derived_mismatch` |

#### 13.1.2 复现（CP0 pre-fix）

纯函数 probe 覆盖 §13 反例：C1 请求关联缺失、C2 请求显式空数组、C3a 仅反向声称、C3b 反向声称与请求矛盾、C4 多观察部分覆盖、C5 used 借用其他调用、C6 自证缓存、C8 确定性 provider 手填 real —— **8 例均 verified**（应为 partial/violated）；C7a 逆序已 violated；C7b 时间缺失只 partial 但原因不可区分；C9 合法关联、C10 A0 为合法对照。证据：`probe-pre-fix.json`（旧模块 sha256 记录在文件内）。

#### 13.1.3 判据冻结（additive 于 quality-evidence-chain/v1）

1. **输入侧三态**：`observations[].observed_in_calls_status`、`provider_calls[].request_observation_refs_status` ∈ `recorded|unknown`；缺失=unknown；显式 `[]`=recorded。历史链缺字段 → unknown（不反推送达/未包含，也不授信）。
2. **inclusion 只来自请求侧同源记录**：某真实调用 `request_observation_refs`（recorded）包含该 `observation_ref`，且 `ordered !== false`。
3. **顺序≠包含**：`observation_to_provider_call[].includes_observation ∈ true|false|null`；time_order 只证明先后；`linked_by` 语义写入 schema 描述。
4. **反向声称只作交叉核对**：仅 `observed_in_calls` → inclusion unknown（不足）；与请求记录矛盾 → `observation_link_conflict` 违规。
5. **显式否认**：请求记录明确未包含且观察侧无声称 → `includes_observation=false`；场景 required 时 observation_link 记 fail（`observation_not_linked`），不因缺失而误判。
6. **used 信用绑定报告调用**：新增 `used_context_refs_provider_call_ref`；信用集合 = Base ∪ 该调用请求实际包含观察的 refs/source_refs；used 非空但报告调用缺失 → `used_context_refs_call_unknown`（evidence_missing）；集合外 ref → `unbound_ref` 违规（detail=`not_in_reported_call` / `outside_base_and_observations`）。
7. **逐观察完整性**：observation_link 存在当且仅当每个观察都有真实请求包含链接（不再由“任一有效链接”代签）。
8. **真实模型身份**：`real` 只由 provider 分类决定；`real_claimed=true` 但分类非 real_model → `deterministic_provider_claims_real` 违规。
9. **重算不信缓存**：判定从原始字段重算；序列化 links/blockers/violations/unbound 仅比对，不一致 → `evidence_chain_derived_mismatch`（binding 不得 verified；release 层 evidence_missing）。
10. **判定分界**：recorded 矛盾/否定 → violated（fail）；unknown/缺失 → partial/blockers（evidence_missing）；包含成立但时间缺失 → `observation_call_order_unknown`（partial）；A0（observations 声明 N/A）与 Base 足够 + used 显式空不受影响。
11. **版本与兼容**：仍 `quality-evidence-chain/v1`；新字段全部可选（schema `$defs.evidence_chain` 同步）；历史 artifact 只读、不补写；不新增 PASS。

### 13.2 开工七问与验证范围

1. **Contract**：ADR-0030/VS-00K 的观察因果与引用真实、B39 D1/D4/D7、现有 evidence-chain/requirements/结果层退出码与历史兼容。
2. **Invariant**：无请求侧同源证据不标 verified；显式未包含不能得到 used 信用；缺失诚实 unknown/证据不足；原材料/历史证据不改写，机制与实模分层。
3. **Boundary**：质量证据归一化/判定、schema 的必要兼容、CLI和结果层及对应测试；不借整改修改产品内容、provider或数据库。
4. **Consumer**：证据链读取/校验与 release-real-llm 实际 CLI/汇总。B39/B27负责真实材料来源，分层规则不能变成另一个真源。
5. **Proof**：§13.3 反例矩阵 + 合法对照 + 旧 artifact 只读兼容 + 解析→判定→CLI/汇总的原因和退出码一致；原必需维度不缩水。
6. **Acceptance Driver**：工程消费者由真实 CLI 在隔离合成材料上验证（§13.4）；CP4 的真实模型/页面仍需原产品、driver、预注册及资源条件。本步通过不能代签它们，产品验收感知 no。
7. **Exploration**：不新增小说要素或探索工具；只核证据关系。实际观察/请求和 used refs 同源的产品闭环继续归 B39/B27，不能用专用 packet 补漏。

### 13.3 CP1：反例固化为正式回归（done）

| 反例 | 用例/断言（`evidence_chain.test.mjs`） | 修复后结果 |
|---|---|---|
| C1 请求关联未记录 | `§13 C1`：time_order link `includes=null`、blocker `observation_inclusion_unknown` | partial；不得 verified |
| C2 请求明确空数组 | `§13 C2`：includes=false；used 依赖 → `unbound_ref` | violated；completeness fail |
| C3a 仅反向声称 | `§13 C3a` | partial |
| C3b 反向声称与请求矛盾 | `§13 C3b`：`observation_link_conflict` | violated |
| C4 多观察部分覆盖 | `§13 C4`：`observation_not_included_in_request` + completeness fail | 不得 verified |
| C5 used 借用其他调用 | `§13 C5`：`unbound_ref` detail=`not_in_reported_call` | violated |
| C6 自证缓存 | `§13 C6`：重算 + `derived_mismatch=true` | partial |
| C7a 逆序 | 既有 `observation_after_provider_call` | violated |
| C7b 时间缺失 | `§13 C7b`：`observation_call_order_unknown` | partial，不 fail |
| C8 确定性 provider 手填 real | `§13 C8`：real=false + `deterministic_provider_claims_real` | violated |
| C9 合法关联 | `§13 C9` | verified（合法对照） |
| C10 A0 零探索 | `§13 C10` | verified / completeness complete |
| 旧链缺字段 | `§13 历史链缺 request refs 状态`：validate 通过、unknown 重算 | partial；原件字段不补写 |

实现清单：

| 文件 | 行为变化 |
|---|---|
| `scripts/lib/quality/evidence_chain.mjs` | 新增 `RECORDING_STATUSES`；normalize 记录三态；`buildObservationLinks` 拆分请求包含/反向声称/顺序；新增 `deriveEvidenceFacts` 从原始字段重算 links/blockers/violations/used 信用；`evaluateEvidenceChain` 重算 + `derived_mismatch`；`evaluateEvidenceCompleteness` 逐观察包含 + fail/missing 分界；`validateEvidenceChain` 校验新可选字段；`readLlmCalls`/`readArtifactEvidence` 只在真实记录存在时透传 request refs，并支持选项式报告调用归属 |
| `scripts/lib/quality/release_layer.mjs` | 新 blocker→维度映射；`derived_mismatch` → `evidence_chain_derived_mismatch`（evidence_missing）；REASON_CODES 登记 |
| `quality/acceptance/evidence-schema.json` | additive：记录三态、`includes_observation`、`used_context_refs_provider_call_ref`、违规码、binding 计数/`derived_mismatch`；不升级版本、不加必填 |
| `scripts/lib/quality/evidence_chain.test.mjs` | 49 tests（原 34 + §13 15）：反例矩阵、unknown/denial 分界、历史链兼容、schema 同源 |
| `scripts/lib/quality/release_layer.test.mjs` | 45 tests：fixture 补请求包含/报告调用；denial→fail 与 unknown→evidence_missing 分界 |

### 13.4 CP2：解析/读取/schema 兼容 + CLI/汇总回归（done）

- `node --test scripts/lib/quality/*.test.mjs` → **228/228 pass**（evidence_chain 49、release_layer 45、其余不变）。
- `bash scripts/quality_manifest_check.sh` → passed（207 scenarios / 2 drafts / 209 manifests；yaml=6.0.3）。
- 实际 CLI：真实历史原生 artifact（116 文件）→ `release_layer_cli summarize --tier release-real-llm` exit 67 `evidence_missing`（`mechanism_layer_missing`）；命令前后全文件 sha256 **unchanged=true**。旧记录不能被新判据升级为 PASS，也未被误判 fail。证据：`artifacts/quality-accept/b42-binding-cp2/{summary.md,cli-historical.json,historical-readonly-hashes.json}`。
- 历史链结构兼容：缺 §13 字段通过 validate、按 unknown 重算、字段不被补写（测试断言）。

### 13.5 CP3：残余与承接（done，登记不代签）

1. **生产侧缺口（B39）**：writer prompt 当前不写 observation refs（B39 §9 表），`used_context_refs` 帧无报告调用归属。B39 CP1 必须产出 `request_observation_refs`/`observed_in_calls`/报告调用 ref；此前真实链只能 partial/evidence_missing，CP4 不得运行或 PASS。
2. **CP4 仍 blocked**：真实模型/页面/预注册/资源条件不变（§10）；本节修复只是判据与基建，不是 AU-15 完成。
3. **历史证据只读**：未回填任何旧 artifact；任何历史数据修复需作者单独授权。
4. **B41 verdict 未改**：`quality-verdict/v2` 与 release 退出码语义不变。
5. **声明冻结信任边界**：evidence-requirements 仍由运行前冻结；本判据不能自证声明在看到结果前写（§12.5 残余保留）。

### 13.6 checkpoint 状态

| CP | 完整交付 | 状态 |
|---|---|---|
| CP0 | 核原始来源、字段与历史兼容，明确真实关联/未知/矛盾/不适用及输出调用范围；形成可执行反例清单 | **done（2026-10-30）**：§13.1，probe-pre-fix.json；判据 11 条冻结 |
| CP1 | 将反例固化为失败测试后修改共享判定内核；请求关联和 used 信用同源，避免只删一个 fallback 留下旁路 | **done（2026-10-30）**：§13.3，49 evidence chain tests + 45 release tests，probe-after-fix 8 例修复 |
| CP2 | 必要解析/读取/schema 兼容及实际 CLI/汇总回归，旧记录不能自证，原件不变；正反例与退出原因一致 | **done（2026-10-30）**：§13.4，228/228、manifest check、真实历史 artifact CLI 67 + sha256 unchanged |
| CP3 | 整理局部证据、剩余真实采集/模型/页面缺口与原 owner 承接，复核新判据未反向伪造输入或削弱验证 | **done（2026-10-30）**：§13.5；B39 采集缺口与 CP4 blocked 如实登记 |
| CP4 | AU-15 A0/A1/A2 预注册与真实运行 | **blocked**：见 §10，本整改不解除 |

### 13.7 收口门禁（2026-10-30，B42 §13 commit `8219061c` + 本节文档）

| 门禁 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 质量库测试 | `node --test scripts/lib/quality/*.test.mjs` | **228/228 pass**（evidence_chain 49、release_layer 45） | `artifacts/gates/2026-10-30-b42-s13/` |
| 清单检查 | `bash scripts/quality_manifest_check.sh` | passed（207 scenarios / 2 drafts / 209 manifests） | 同上 |
| 后端 | `mix format --check-formatted`、`mix compile --warnings-as-errors`、`mix run scripts/arch_check.exs`、`mix test` | 全 exit 0；9 apps **2344 tests / 0 failures** | `backend.log` |
| 循环/架构 | `mix xref graph --format cycles --fail-above 0`、`arch_check` | No cycles found；架构检查通过 | `mix-extra.log` |
| ADR 追溯 | `mix run scripts/adr_trace.exs` | 30/30 Accepted、338 refs、0 pending | `mix-extra.log` |
| 不变量 | `run_i3_nonce` / `run_i1_causal` / `run_i2_variation` | I3 3/3、I1 4/4、I2 3/3 disjoint / 0 violations | `mix-extra.log` |
| 前端 | `pnpm typecheck && pnpm lint && pnpm test`；`pnpm build`；`frontend_audit.sh --quick`；`check_design_trace.sh` | 40 files/625 tests pass；build pass；audit PASS；design trace PASS | `frontend.log`、`frontend-extra.log` |
| 任务收口 | `bash scripts/task_done.sh --slice b42-s13-binding --quick` | exit 0；manifest `artifacts/task-done/20261030T124527Z/manifest.json`；UI evidence not required（未改前端/UI） | `task-done.log` |
| 静态扫描 | `bash scripts/ai_static_scan.sh --top 10` | exit 0；19/20 checks pass；gitleaks 4 条历史命中均既有 disposition（touched files 0），未新增/未放宽规则 | `static-scan.log`、`artifacts/static-scan/top10.md` |
| 排期检查 | `node scripts/next_task_check.mjs`、`node --test scripts/next_task_check.test.mjs` | ok；27/27 | 本机输出 |

- 未改产品代码（apps/、frontend/src、mix.exs、config/ 零 diff）；未启动真实模型/Phoenix/Vite/Tauri；未回填历史 artifact。
