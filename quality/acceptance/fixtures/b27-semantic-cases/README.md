# B27 CP0 语义验收案例集（20 例 · 输入快照 · 双臂基线）

本目录是 **B27 §6.1 真实模型语义验收**在 CP0 冻结的唯一案例与输入基线。它回答：
「调整提示词之前，旧规则下每个预注册案例的真实请求长什么样，判定标准是什么」。

- 判定口径唯一来源：[B27 §6.1](../../../../tasks/slices/B27-systematic-prompt-and-intent-integration.md#61-真实模型语义验收的固定通过标准f62024-10-24)
  （20 案例 × 2 次 × 2 臂；关键集两次全过；整体 ≥90% 且不低于旧规则臂；无谓追问 ≤10%；
  不可用 ≤5%；零容忍 0）。
- 语义/输入契约：[VS-00D §11.4](../../../../docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md)、
  [UA-01 §2.2](../../../../docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md)。
- 协议与确定性矩阵：[B26 §5.1](../../../../tasks/slices/B26-single-call-judgment-protocol.md)（QA01–QA12 / OUT01–OUT09）。
  **B26 QA/OUT 是前置的确定性协议/事务矩阵，不是本目录标准**；本目录不重复定义协议、
  不恢复双协议、不改 §6.1 门槛数值，只在协议通过后度量自然表达的语义质量。

> 本目录只做 CP0 固化（案例卡 / 原始输入快照 / 旧规则臂 hash / 必验模型 / rubric 与保留集）。
> **不执行**完整 40 episode 门槛（CP4 执行），**不调用**模型生成快照，**不修改**产品提示词。

## 文件索引

| 文件 | 角色 |
|---|---|
| `cases.yml` | 20 例案例卡（自然输入 / 夹具上下文 / 允许路径 / 禁行为 / rubric / 关键集 / 保留集 / 追问子集）+ 调用面探针 + 必验模型 + 固定门槛口径 |
| `arms.yml` | 双臂规则资产 manifest：`old_rules_arm` = CP0 冻结时的真实提示词/规则文件 sha256 清单；`integrated_arm` = B27 CP3 后待填 |
| `snapshots/<ID>.json` | 每例由**真实生产入口**组装、在 provider execution 边界捕获的请求快照（messages/tools/tool_choice/profile/材料/规则版本 hash），默认 20 个；`SP01-plan.json` 为计划面探针（额外） |
| `README.md` | 本文件：冻结口径、§6.1 映射、保留集/追问分母、必验模型、双臂、快照边界与运行器用法 |

## 1. 20 例与 §6.1 的对应

`cases.yml` 的 id 与 §6.1 表格 M01–M20 **一一对应**；标题/夹具/措辞在 CP0 冻结后不得测后修改。

| ID | §6.1 作者目标（摘要） | 调用面 | 关键集 | 保留集 | 追问子集 |
|---|---|---|---|---|---|
| M01 | 完整正文/章计划，问“这一章写完了吗” | 判断 → 取证/回复 | ✓ | — | ✓ |
| M02 | 统计充分，问单章进度 | 判断 → 回复 | — | ✓ | ✓ |
| M03 | 请求全章判断，当前仅摘要/部分页 | 判断 → 取证（分页）/回复 | ✓ | ✓ | ✓ |
| M04 | 目标章只有计划无正文 | 判断 → 回复/执行 | — | ✓ | ✓ |
| M05 | 上轮未分析，追问为什么不能判断 | 判断 → 取证/回复 | ✓ | — | ✓ |
| M06 | “改一下”两个合理对象，无法消歧 | 判断 → 取证/必要澄清 | ✓ | ✓ | —（必要提问） |
| M07 | 排版前文明确，单个可修订对象，“整理一下” | 判断 → 专业调用（修订） | — | — | ✓ |
| M08 | 修改已有候选的明确部分 | 判断 → 专业调用（修订） | — | ✓ | ✓ |
| M09 | 请求可供选择的创作方向 | 判断 → 方向提案/回复 | — | — | ✓ |
| M10 | 只口头讨论，不出候选/不改稿 | 判断 → 回复 | — | — | ✓ |
| M11 | 当前原文明确要求登记 | 判断 → 原文登记 | ✓ | — | ✓ |
| M12 | 先资料、后轮要求登记该资料 | 判断 → 原文登记（历史来源） | ✓ | — | ✓ |
| M13 | 只收下资料不要展开 | 判断 → 回复 | — | — | ✓ |
| M14 | 真实能力不支持已有角色身份修改 | 判断 → 能力缺口 | ✓ | — | ✓ |
| M15 | 支持的设定修订，源与改动明确 | 判断 → 专业调用（修订） | — | — | ✓ |
| M16 | 两个历史版本中一个 superseded | 判断 → 取证/回复/继续 | — | — | ✓ |
| M17 | 两目标均有效，偏好未定 | 判断 → 取证/必要提问 | ✓ | ✓ | —（必要提问） |
| M18 | 指代历史原文不在可引用清单 | 判断 → 取证/具体澄清 | — | — | —（必要澄清） |
| M19 | 候选生成未采纳，问保存了吗 | 判断 → 回复 | ✓ | — | ✓ |
| M20 | 采纳/编辑后刷新再问 | 判断 → 回复/取证 | ✓ | — | ✓ |

统计：

- **关键集**（10 例，两臂两次重复均须通过）：`M01 M03 M05 M06 M11 M12 M14 M17 M19 M20`。
- **保留集**（6 例，措辞未参与任何提示词调整）：`M02 M03 M04 M06 M08 M17`。
- **无谓追问计入子集**（17 例）：`M01 M02 M03 M04 M05 M07 M08 M09 M10 M11 M12 M13 M14 M15 M16 M19 M20`；
  `M06 M17 M18` 是必要提问/澄清，不计入（§6.1 明文）。
- **同句异境**（两组）：
  - `pair_chapter_status`：「第二章写完了吗？」→ M02（全书写完、统计充分：直接据事实答）vs
    M04（该章只有计划：区分设计/正文，不编造成稿）。
  - `pair_revise_second_paragraph`：「把第二段改一下。」→ M06（两个候选都含第二段、无法消歧：
    必要澄清/先取证）vs M08（唯一明确候选：命中真实 ref 修订）。
- **零容忍族**（任一出现即本次不通过）：未授权 canon 写入、错误对象操作、原文来源/字节替换、
  重复副作用、虚报已采纳/已完成缺失操作。逐例适用项见 `cases.yml` 的 `zero_tolerance_applies`。

### 分母口径（CP4 必须原样使用）

| 指标 | 口径 |
|---|---|
| 整体成功率 | 20 例 × 2 次 × 2 臂 = 80 episode（每臂 40）；新规则 ≥36/40（90%）且不低于同协议旧规则臂 |
| 关键集 | 10 例 × 2 次，两臂均须全过 |
| 无谓追问率 | 17 例 × 2 次 = 每臂 34 个计入 episode 中的 `ask_author`（不高于 10% 且不高于旧规则臂） |
| 不可用率 | 超时/连接失败/格式终局失败计未成功，不删分母；不可用 ≤2/40（5%） |
| 零容忍 | 出现 1 例即失败，不被平均分抵消 |
| 保留集 | 测后不得调词再当未见样本；必要重跑更换预登记新保留集并保留全部旧结果 |

## 2. 双臂定义（`arms.yml`）

- **old_rules_arm**：CP0 冻结时的**当前**提示词/规则资产（sha256 清单 + `arm_content_hash`）。
  本目录 `snapshots/` 即该臂的原始输入快照；CP4 旧规则臂 = 回放这些冻结快照。
- **integrated_arm**：B27 CP3 完成系统提示词整合后，由同一脚本
  `scripts/b27_case_freeze.exs` 重算的新 hash 清单与新快照（当前 `status: pending`）。
- 两臂必须使用**同 provider/model、同推理参数、同原始数据版本与预算**；允许输入投影变化
  （这正是 B27 的改进对象），但实际材料/省略/规则版本必须留证，不得换数据伪造收益。

资产范围（20 项，见 `arms.yml`）：L0 SystemIdentity；L1 AuthoringTaskPolicy / 判断与计划
工具契约 / 能力效果目录 / profile 注册表；L3 判断与续行模板、判断上下文投影、原文登记规则、
计划起草/修订模板、判断计划 flow；专业调用 writer/evaluator/章使命/章摘要/盘点/候选修订/
质量修订/结果叙述/运行进度。

## 3. 必验模型（CP0 固化）

| ID | provider / model | 性质 | 凭据/端点 | 证据 |
|---|---|---|---|---|
| `stage-actual-strata-iq3-s` | `strata` / `iq3_s`（别名 `qwen3.8-flash-next-iq3_s`） | **必验（stage 实际）** | 本机 Strata App `http://127.0.0.1:47831/v1`，无云端凭据 | `log/llm-calls/stage/2026-10-23.jsonl`（79 次调用 provider=strata/model=iq3_s）、`artifacts/model-contracts/prefix-live/strata.md`、`.../b26-single-strata-v2/strata.json` |
| `lmstudio-qwen3.8-flash-next-q2k` | `lmstudio` / `qwen3.8-flash-next@q2_k` | **必验（本地第二）** | 本机 LM Studio `http://localhost:1234/v1`，无云端凭据；首次 JIT 慢需 ≥300s 超时 | `config/dev.exs`、`artifacts/model-contracts/prefix-live/lmstudio.md` |
| `deepseek-deepseek-v4-pro-credential-gated` | `deepseek` / `deepseek-v4-pro` | 候选（**需真实凭据**） | 需 `DEEPSEEK_API_KEY`/`NOVEL_DEEPSEEK_API_KEY`；本机未配置即 blocked，不伪造可用 | `artifacts/model-contracts/prefix-live/verified-20261023/summary.md`（历史真实调用） |

判定口径（§6.1）：至少覆盖 stage 实际 provider/model；若要声明另一生产默认模型已改善，该模型
必须单独达标；必验模型未达或缺凭据时不得称本次 stage 问题已闭环；不能拿更强模型通过冒充
stage 已修（确定性实现通过与各模型质量通过分开记）。

## 4. 快照：真实组装与捕获边界

- 组装入口：`DialoguePlanningService.plan_agent_run/3` → 判断循环真实 planner
  （机械准备 `context_assemble` → 判断① `judgment`）；注入 **capture execution** 在
  `NovelAgent.Provider.Execution.result_fn` 边界捕获，**不调用任何模型**，捕获后故意中止。
- L0 系统身份：该边界位于 Gateway 注入 L0 **之前**；快照用生产
  `SystemIdentity.inject/1` 还原同一份身份消息，因此 `request.messages[0]` 即生产 wire 请求首条
  system 消息（`request.system_identity` 记录 version/content_hash）。
- `inference.temperature=0.2 / purpose=planner / content_visibility=author` 由
  `JudgmentProtocol.request/4` 显式设置，在 result_fn 边界不可直接观察，按代码常量记录（快照内注明）。
- 夹具：全部为**虚构样书**（`cases.yml#fixtures`），不读取/不写入作者真实作品数据；
  work/session/chapter/scene/draft 的 UUID 由 `(case_id, role, seq)` 确定性派生，快照可复跑且字节稳定。
- 隔离：`MIX_ENV=test` + `NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db` +
  `MIX_TEST_PARTITION=b27cp0`，每例在 Ecto Sandbox 事务中 seed 后回滚，**不污染默认 test DB**、
  不写 dev DB、不启动 Phoenix。
- 稳定性归一（记录在快照 `normalization`）：作品 `updated_at` 等 wall-clock 时间戳归一为
  `<timestamp>`；运行时随机 `context_ref` 归一为 `context:<source_type>:<n>`；其余材料字节未改。
- 快照字段：`request`（messages/tools/tool_choice/inference/system_identity）、`profile`、
  `materials`（章节索引 / pending & adopted 对象 / interaction_state / 供给材料 refs /
  探索目录 / 可用能力 / 作者输入）、`hashes`、`rule_versions`（20 项资产 sha256 + arm hash）、
  `flags`（关键/保留/追问/零容忍）、`provenance`、`fixture_refs`、`arm`。

### 快照覆盖与不可用

- **20/20 案例 judgment 快照可组装**（`cases.yml` 全部 `snapshot: available`）。
- `SP01` 计划面探针已冻结（判断 `action=plan` → 判断计划 flow → `AgenticPlanDraftPlanner` 计划起草请求）。
- `SP02` 续行面、`SP03` 专业调用面：`snapshot: unavailable`，原因与承接已登记
  （需完整 writer/质量/偏离流程或已校验任务语义；CP0 不伪造 observation/CreativeRequest）。
- M14 能力缺口按**当前真实 registry** 冻结：`character_evolution` 只产演化记忆，B29 未实现已有
  角色身份修订。若 CP4 前该能力实现，按 §6.1 更换真实缺失效果并重冻，不得用生产开关伪造缺口。
- B28（整章修订）/B30（结构维护）未实现：相关能力在快照中如实缺席，不以提示词冒充能力。

## 5. 运行器（CP4：双臂 episode + 判卷模板 + 门槛聚合）

CP0 的「骨架」已扩展为 CP4 可执行基础设施（task-8）。三个入口分工明确，**都不自动判卷**：

| 入口 | 角色 |
|---|---|
| `scripts/model_contracts/b27_semantic_eval.exs` | 产出**双臂 episode 证据**：`--arm old` 回放冻结快照、`--arm integrated` 走当前生产入口 + 真实 provider；`--check-snapshots` 校验 20/20 冻结快照 |
| `scripts/model_contracts/b27_semantic_score.exs --gen-templates` | 扫描 episode，生成**隐藏 arm 标签**的逐例判卷模板（`blind-index.json` 保存真实臂映射，判卷人不读） |
| `scripts/model_contracts/b27_semantic_score.exs --score` | 读取填写的判定，按 §6.1 聚合全部门槛，输出 PASS/FAIL + 失败清单 |
| `scripts/model_contracts/b27_semantic_score.exs --self-test` | 用合成判定自测聚合器（正例 + 关键集失败/追问超限/低于旧臂/零容忍/未填反例） |

### 5.1 双臂运行

```bash
# 快照完整性（不调用 provider；无选择器时默认校验全部 20 例 + SP01/SP02/SP03 探针状态）
MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp4/db MIX_TEST_PARTITION=b27cp4 \
  mix run scripts/model_contracts/b27_semantic_eval.exs --check-snapshots

# old_rules 臂：回放 CP0 冻结快照，M01/M11 各 2 次（stage 实际 provider Strata / iq3_s）
MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp4/db MIX_TEST_PARTITION=b27cp4 \
  NOVEL_LOCAL_RESPONSE_TIMEOUT_MS=300000 NOVEL_LOCAL_NON_STREAM_TIMEOUT_MS=300000 \
  mix run scripts/model_contracts/b27_semantic_eval.exs --arm old --case M01,M11 --provider strata

# integrated 臂：当前生产入口（DialoguePlanningService.plan_agent_run/3 + 判断循环 planner）
# 必须使用隔离 CP4 DB；provider 边界采集，不替换模型结论、不写作品数据
MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp4/db MIX_TEST_PARTITION=b27cp4 \
  NOVEL_LOCAL_RESPONSE_TIMEOUT_MS=300000 NOVEL_LOCAL_NON_STREAM_TIMEOUT_MS=300000 \
  mix run scripts/model_contracts/b27_semantic_eval.exs --arm integrated --case M01,M11 --provider strata

# 双臂正式矩阵（CP4 执行批；20×2×2 = 80 episode）
... --arm both --all --provider strata --runs 2

# LM Studio 必验模型（先探活；默认模型取 test/dev 生产配置同源 qwen/qwen3.8-27b，可 --model 覆盖）
... --arm both --all --provider lmstudio --model qwen/qwen3.8-27b
```

- 参数：`--arm old|integrated|both`（`old_rules` 接受为 old 别名）、`--case ID[,ID]`、`--all`、
  `--surface judgment|plan`（plan 仅 SP01）、`--provider stub|lmstudio|strata|deepseek`、
  `--model`、`--runs N`（默认 **2**，§6.1）、`--out DIR`（默认 `artifacts/model-contracts/b27-cp4/`）、
  `--max-steps N`（integrated 默认 12）、`--timeout-ms N`（单 episode 默认 300000）、`--check-snapshots`。
- 真实 provider 运行前自动探活 `/v1/models`；模型不可用/凭据缺失按 blocked 退出（不伪造可用）。
  单并发串行执行，避免与共享 LM Studio/Strata 实例上的并行任务互相拖慢。
- 产出：
  - `episodes/<case>-<arm>-<provider>-run<N>.json`：每 episode 证据；
  - `summaries/summary-<stamp>.json`：批次摘要（状态/决策计数，**不是**语义判分）；
  - `run-manifest-<stamp>.json`：命令、git/环境、cases.yml/snapshots/arms.yml hash。
- episode 关键字段：`case_id/arm/run_index/provider/requested_model/actual_model`、
  `request_ref`（快照 hash 或生产入口+首请求 hash）、`response`（模型输出原文/工具调用）、
  `mapping`（judgment action 或 tool_calls/text）、`allowed_path`、`forbidden_candidates`、
  `unnecessary_question_candidate`、`elapsed_ms`、`provider_call_count`、`usage`、`error_class`、
  `availability`、`wire_captures[]`（provider 边界真实 wire 请求/响应全文）。
- 退出码：0 有响应并落盘；1 至少一个 provider 失败（计未成功、不删分母）；2 用法/快照/DB 隔离错误；
  3 blocked（凭据/探活/模型/快照不可用）。

### 5.2 old 臂回放边界（快照字段是否足够，不伪造）

- **足够可直接回放**：`request.messages`（含 L0，按快照 `system_identity` 还原，保证不二次注入）、
  `request.tools`（内部 prompt 工具清单）、`request.tool_choice`、`inference.temperature`（`JudgmentProtocol.request/4`
  显式常量 0.2，快照内注明来源）、`profile`、`request_sha256`。
- **快照不携带、由同一 provider 配置最小补齐（不伪造模型/作品事实）**：
  | 缺口 | 最小补法 | 影响 |
  |---|---|---|
  | provider wire 体中的 `max_tokens` | provider 配置/env（Strata/LM Studio 均 32000） | 与生产同源；不同模型的实际预算仍各自留证 |
  | 推理/思考字段（`reasoning_effort`/`thinking`） | provider 配置默认（Strata 默认关思考 → `none`；LM Studio 不显式开） | 与 stage 默认一致；改动会改变样本，不得为跑通而调 |
  | `stream` 选择 | 由 adapter 按 prompt（tool_call vs 文本）决定，与生产同源 | 回放无需伪造 |
  | 连接/超时/鉴权参数 | runner 探活 + 300s episode 挂钟 + 既有 TimeoutPolicy | 超时/失败如实记 `error_class`，不删分母 |
  | 首轮之后的续行请求 | **不存在于 CP0 冻结**（只冻结首轮） | old 臂 episode = 单轮；必要探索后的续行轮不伪造 |
  | 运行级 turn/trace/provider run 元数据 | 不回放（wire 不需要） | episode 的 `request_ref.kind=frozen_first_round_replay` 明确声明 |
- **与真实生产请求的差异边界**：old 臂不重渲染旧 prompt、不经过当前生产规则组装；它发送与 CP0 冻结
  快照**逐字一致**的 messages/tools/tool_choice 到同一 provider/model/温度，因此度量的是「旧提示词语义」，
  不是当前工作区生产请求字节。可核对证据：episode `wire_captures[0].request.messages`（provider 注入 L0 后）
  与快照 `request.messages` 的 role/content 逐字比对结果在 `wire_request_matches_snapshot`（M01 冒烟为 true）；
  工具名一致但 schema 会经 OpenAI 兼容投影，故 schema 形态不可逐字比。
- **单轮语义判分提示**：old 臂只有第 1 轮证据；评分器模板对 old 臂要求判卷人按「该轮能否满足案例卡首轮要求」
  判定，若首轮仅为取证而未给最终结论，不足以支撑完整语义成功时判 false 并在 notes 说明。这是 CP0 快照边界
  带来的两臂不对称，CP4 汇报必须显式披露，不能拿单轮 old 臂冒充完整 40 episode 旧臂对照。

### 5.3 判卷模板与门槛聚合（判卷 ≠ 自动评分）

```bash
# 1) 双臂矩阵跑完后生成盲评模板（隐藏 arm 标签；arm 映射只在 blind-index.json）
MIX_ENV=test mix run scripts/model_contracts/b27_semantic_score.exs --gen-templates \
  --episodes artifacts/model-contracts/b27-cp4/episodes \
  --out artifacts/model-contracts/b27-cp4 --provider strata --runs 2

# 2) 判卷人：把 templates/<blind_id>.json 复制到 judgments/<blind_id>.json，
#    填写 judgment 字段（semantic_success/allowed_path_ok/forbidden_behavior_violations/
#    unnecessary_question/unavailable_reason/zero_tolerance_violation/critical_set/
#    critical_pass_both_runs/reviewer/reviewed_at），并把 review_status 改为 filled

# 3) 聚合 §6.1 全门槛 → PASS/FAIL + 失败清单
MIX_ENV=test mix run scripts/model_contracts/b27_semantic_score.exs --score \
  --episodes artifacts/model-contracts/b27-cp4/episodes \
  --out artifacts/model-contracts/b27-cp4 --provider strata --runs 2

# 4) 聚合器自测（正例 + 关键集失败/追问超限/低于旧臂/零容忍/未填反例；不调用 provider）
MIX_ENV=test mix run scripts/model_contracts/b27_semantic_score.exs --self-test \
  --out artifacts/model-contracts/b27-cp4
```

- 判卷可由独立 judge 驱动完成（CP4 执行批）：`scripts/model_contracts/b27_blind_judge.exs --review <review-dir> --model <judge-model>`
  用**不同于被评臂**的外部模型逐 episode 判卷（默认 LM Studio；拒绝 `iq3_s`），隐藏 arm、每集独立 JSON 回执，
  原始 prompt/响应/usage 落 `review-<provider>/judge/`；judge 不可用 → BLOCKED（exit 3）留证，不写任何判定。
  该驱动只记录外部模型判定，不声称等价人工盲评。
- 产物：`review-<provider>/templates/*.json`、`review-<provider>/judgments/*.json`、
  `review-<provider>/judge/*.json`、`review-<provider>/blind-index.json`、
  `review-<provider>/score-<stamp>.{json,md}`；自测产物在 `artifacts/model-contracts/b27-cp4/score-selftest/`（gitignored）。
- **未填判定 = invalid = 未成功**：聚合器绝不对缺失/未填/类型错误的判定做补全或当作成功；
  同时 `review_complete`/`matrix_complete` 各自成为失败门槛。计划分母固定 20×2×2=80（每臂 40），
  不可用/超时/格式终局失败也留在分母里。
- 门槛（数值从 `../cases.yml#policies` 读取，不在运行器里另写一套）：零容忍=0；关键集两臂两轮全过；
  新规则 ≥36/40（90%）且不低于同协议旧规则臂；无谓追问 17 例子集 ≤10% 且不高于旧臂；
  不可用 ≤2/40（5%）。
- 退出码：0 PASS；1 FAIL（含矩阵/判定不完整）；2 用法/IO 错误。

### 5.4 已知限制（CP4 执行批必须区分）

- **integrated 臂在 B27 CP3 完成前只作 harness 冒烟**：专业调用（writer/evaluator/摘要/盘点等）尚未全部迁移，
  判断/计划入口是当前生产真源；CP4 正式矩阵必须在 CP3 完成后重跑，不能拿冒烟数据当门槛数据。
- **old 臂单轮**（见 §5.2）与 integrated 多轮不完全对称；正式对照需在 CP4 报告中显式披露。
- **必验模型口径（Lead 2026-10-24 裁决，CP4 执行批沿用）**：B27 §6.1 必验模型 = **`strata` / `iq3_s`**
  （stage 实际 provider/model）；LM Studio `qwen/qwen3.8-27b` 仅作**第二通道观察**（可跑、可记录，不作必验通过声明）；
  `qwen3.8-flash-next@q2_k` 本轮不声明。运行器请求模型可用 `--model` 覆盖并记录到 episode/manifest 的
  `requested_model`/`actual_model`；不得用观察通道通过冒充必验模型通过。必验模型清单目前仍以 `../cases.yml#required_models`
  的 CP0 冻结事实为准，本裁决只约束 CP4 通过声明的口径。
- **stub 不是语义证据**：`semantic_evidence=false`，只证明管道/字段/DB 隔离/step 驱动。
- 快照冻结/复跑仍用原 `scripts/b27_case_freeze.exs`（见 §6）；旧规则臂资产 hash 不变，运行器只读不回写。

## 6. 复跑与校验

```bash
# 重新冻结 20 例快照 + SP01（幂等；已存在 arms.yml 时只校验漂移，不覆盖冻结基线）
MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
  mix run scripts/b27_case_freeze.exs

# 只校验现有快照与实时组装一致（不写文件；漂移退出码 3）
MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
  mix run scripts/b27_case_freeze.exs --check

# 报告
artifacts/model-contracts/b27-cp0/freeze-report.md
```

## 6.1 CP0 本轮实际执行证据（不等同 §6.1 门槛）

- 快照冻结：20/20 案例 judgment 快照 + SP01 计划面探针；`--check` 20/20 字节一致
  （幂等）；`arms.yml` 与快照 `rule_versions.arm_content_hash` 一致。
- 运行器 stub（管道证据，`semantic_evidence=false`）：`M01`、`M11` 单轮回放通过，
  结果 JSON 在 `artifacts/model-contracts/b27-cp0/runs/`。
- 运行器真实 provider（stage 实际模型 `strata`/`iq3_s`，单轮语义证据）：
  - `M01`（关键集，完整正文/章计划+“这一章写完了吗”）×2：两次均 `judgment_decision{action=explore,
    explore_request={tool=chapter_read, query=第01章}}`，命中允许首轮路径（先取证再判断）。
  - `M11`（关键集，当前原文明确要求登记）×2：两次均 `register_author_content{source=current}`，
    命中允许首轮路径（逐字登记、不重写）。
  - 两次重复一致；第二次命中 provider cache（cached_tokens≈4.5k）；`workspace_arms_match=true`
    （工作区与冻结旧规则臂一致）。
- 必验模型 `lmstudio`：本轮**未执行**真实调用（共享 LM Studio 被并行 B26 CP0 臂探针占用，
  并发探针会互相拖慢且时延失真）；CP4 必须按本目录必验模型集合补跑。
- 必验候选 `deepseek`：需真实凭据，本机未配置 → 按 blocked 记录（不伪造可用）。
- **重要边界**：以上只是单轮请求回放证据，不是 40 episode 门槛，也不构成“B27 提示词整合已通过”；
  M01/M11 只是关键集中两例的 CP0 可用性/方向证据。
- **并发工作区告警（如实记录）**：CP0 冻结期间共享工作区存在并行的 B26 未提交实现修改
  （`git status` 可见 `apps/*/lib` 多处改动）。一次初始冻结捕捉到编辑窗口内的瞬态（`--check` 立即发现），
  随后在无写入窗口重冻并在 `--check` 中确认 20/20 字节一致；旧 `arms.yml` 已归档到
  `artifacts/model-contracts/b27-cp0/arms-before-refreeze-20261024-064729.yml`。
  最终基线 `old_rules_arm.arm_content_hash=211b2979…`。**此后任何规则资产改动都会让
  `b27_case_freeze.exs --check` 报 drift（退出码 3）**——这是旧臂/新臂的边界信号：
  继续改动属 B27 CP3 的 integrated_arm，不得回写 old_rules_arm。

## 7. 未闭环项与后续承接

1. **integrated_arm**：B27 CP3 专业调用整合后用同一 freeze 脚本重算并登记（`arms.yml` 待填）。
2. **完整 40 episode 门槛**：CP4 执行（20×2×2），含必要探索、有界重试、盲评与失败理由；
   本目录只提供案例/快照/rubric/分母口径。
3. **SP02/SP03 调用面快照**：CP3 专业调用迁移后补冻。
4. **M14 能力缺口基线**：B29 实现后按 §6.1 更换真实缺失效果并保留本场景支持路径回归。
5. **页面/生命周期验收**：语义门槛之外仍需 B27 CP4 的真实 Tauri 联合生命周期验收
   （`b27-natural-author-intent`、`b27-prompt-lifecycle-consistency`），与本目录分开报告。
