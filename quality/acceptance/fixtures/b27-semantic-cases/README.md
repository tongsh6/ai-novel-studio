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

## 5. 运行器（骨架）

`scripts/model_contracts/b27_semantic_eval.exs` 做**单 episode 单轮请求回放**并落逐例结果 JSON，
字段覆盖 rubric 判定所需；不实现自动判分（最终由 CP4 按案例卡 rubric 盲评）。

```bash
# 快照完整性（不调用 provider）
MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
  mix run scripts/model_contracts/b27_semantic_eval.exs --check-snapshots --all

# stub：只证明管道/字段/解析（semantic_evidence=false）
MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
  mix run scripts/model_contracts/b27_semantic_eval.exs --case M01,M11 --provider stub

# stage 实际模型（Strata；真实单轮语义证据）
MIX_ENV=test NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
  mix run scripts/model_contracts/b27_semantic_eval.exs --case M01 --provider strata

# LM Studio（首次 JIT 慢，必须显式给 ≥300s）
NOVEL_LMSTUDIO_TIMEOUT_MS=600000 MIX_ENV=test \
NOVEL_TEST_DB_DIR=artifacts/model-contracts/b27-cp0/db MIX_TEST_PARTITION=b27cp0 \
  mix run scripts/model_contracts/b27_semantic_eval.exs --case M01 --provider lmstudio

# 计划面探针（SP01 快照）
... mix run scripts/model_contracts/b27_semantic_eval.exs --case SP01 --surface plan --provider strata
```

- 参数：`--case ID[,ID]` / `--all` / `--surface judgment|plan` / `--provider stub|lmstudio|strata|deepseek`
  / `--arm old_rules|integrated` / `--runs N` / `--out DIR` / `--check-snapshots`。
- 结果：`artifacts/model-contracts/b27-cp0/runs/<case>-<provider>-runN.json` + `summary-*.json`；
  字段含输入、snapshot hash、响应工具/文本、材料、允许路径命中、零容忍候选、无谓追问标记、
  耗时、调用计数、`semantic_evidence`（stub=false）。
- 退出码：0 成功；1 provider 失败；2 用法/快照缺失/完整性失败；3 blocked（凭据缺失 /
  integrated 臂未就绪 / 快照不可用）。
- **已知限制**：CP0 骨架只回放冻结首轮请求（`episode.rounds_executed=1`），不驱动探索/候选/
  采纳多轮；§6.1 完整 40 episode（含必要探索与有界重试）由 CP4 episode driver 承接。
  单轮响应也不等于语义通过——通过/失败按 rubric 盲评。

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
