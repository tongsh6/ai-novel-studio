# VS00D-G-GAP-RECONCILIATION：VS-00D G1–G7 / 差距台账复核与 C 轨观察（2026-10-24）

- 状态：**done（2026-10-24；CP0 侦察/裁决 + CP1 台账修订 + 重扫复核；无产品代码变更）**
- 来源：`tasks/NEXT.md` 队列项 `VS-00D-G1-G7`；`docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md` §6 G1–G7；`tasks/NEXT.md` §5 Selection Rule 第 6 条「差距回收仪式」；C 轨观察
- 类型：差距对账 / 队列收账（无产品行为变更；不新增验收场景）
- 七问简答：Contract=VS-00D §6 G 表 + §8 分期 + §11 共同输入 + 08 §6.2 NEM-GAP + NEXT B 轨债务表；Invariant=每个滞留 ≥3 快照项必须有裁决（推进 / 降级登记理由 / 显式弃置），不把机制存在当整体关闭、不把已销账项以文档改写方式复活；Boundary=只改 `tasks/`/`docs/project-ledger.md`/`reports/gap-ledger/`（不碰 VS-00D 契约文档工作树改动、不碰 B26–B31 并行文件）；Consumer=下一轮队列选择与作者对账；Proof=`bash scripts/gap_ledger.sh` 快照 + `node scripts/next_task_check.mjs` + 全门禁；Acceptance Driver=本 slice 无产品行为变更，复用同日 HEAD 已绿真实 Tauri 场景证据，不新增 driver；Exploration=不适用。

---

## 1. CP0 侦察结论（2026-10-24）

### 1.1 差距回收仪式快照

`bash scripts/gap_ledger.sh` → **2026-10-24 开放差距 22 项**（VS-00D 7 / NEM-GAP 6 / B 轨 9），全部 ×37 快照仍开放，触发复核流程。裁决修订 NEXT B 轨表后重扫：**19 项开放**（VS-00D 7 / NEM-GAP 6 / B 轨 6），关闭 B1/B2/B8。台账 `reports/gap-ledger/latest.json`。

### 1.2 VS-00D G1–G7 事实与裁决

契约原文 `docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md` §6（行 403–409）与 §8 分期；并行会话 2026-10-24 已在 §11 联合修订（B26/B27 共同输入真源，`tasks/NEXT.md:46`）。逐项：

| G | 契约事实（§6） | 当前证据 | 裁决 | 承接/触发 |
|---|---|---|---|---|
| G1 | 小说层契约全调用点覆盖未闭环；AU11 已有原则/要素/质量门投影，builder 仍过渡实现 | **关键更正：AU11 证据链已失效**——唯一生产调用 `AIMessageEnvelope.quality_diagnosis/3` 与 `evidence_summary[:ai_message_envelope]` 写入被 commit `c4509c86`（2026-07-19 帧纪元退役）删除，现仅剩 `trace_writer.ex:332–341` 读无人写的键；判断入口 prompt 只有能力目录+形态规则（`judgment_protocol.ex:797–817`）。B27 `:15,107` 明确承接 G1/G3/G5/G7（调用点矩阵、规则唯一来源、MissingPolicy） | **承接（B27）**，不关闭；AU11 场景按证据失效标 blocked（见 §1.5） | 触发=B27 CP0 定稿 + B26 CP2 共享入口迁移完成；本会话不碰 |
| G2 | 当前作品层事实与风格消费不完整；Order 7 仍有剩余 | **大部分已落**：写作事实/风格（`turn_execution_service.ex:495–505,998–1070`）、评估器事实基线（`:322`、`prose_quality_evaluator.ex:236–240`）、摘要窗/卷蓝图/创作锚/章节状态（`:890–920`、`:213–216`、`workspace_context.ex:480–482`、`dialogue_planning_service.ex:1179–1210`；CA01–CA04/B11A）。**余项完整清单**：CA01 登记的 planner 起草层 `planning_facts_section`（`CA01:35–40`，代码中无该符号）、Order 7-ⓔ 判断「对账报告待裁决」一行、OmissionNote 覆盖（B10，`turn_execution_service.ex:152–153`）；NEXT:227 Order 7 状态列仍写「待定序」，为过期台账（本批已修正） | **降级登记**：已消费部分不再重复建设；余项=C 轨排队（B10/后续 A 轨拉动） | C 轨（被对应 A 轨拉动）；无队列挂靠不开工 |
| G3 | 引导字段正式 schema 与场景覆盖未闭环；AU11 过渡 envelope/trace 已有 guidance_mode 等 | `DialogueFrame` 无 guidance 字段（`dialogue_frame.ex:28–56`）；判断时代 evidence 仅 judgment/action/record_only/context_used，`guidance_mode` 仅在死路径 builder/trace_writer；§8 CP2 要求「经 ADR 冻结」，全仓无该 ADR | **拆分裁决：语义/调用点半边承接 B27（与 G1 同源）；schema 半边无 owner**（AU11 文件级 close 曾拟 4 个 checkpoint，均不存在）——登记 gap：trigger=作者批准 ADR 排期 / B27 推进到 schema 冻结 | 语义=B27；schema=无 owner（显式登记，不冒充承接） |
| G4 | 创作决策载体完整语义投影未闭环；CreativeDecisionPacket 已传坐标/章方向/读者效果/作者输入/使命，continuity/style_intent 等仍是后续 checkpoint | `CreativeDecisionPacketBuilder` 已接；剩余维度属 VS-00E/后续 CP | **降级登记（后续 checkpoint）** | C 轨/后续 slice；不新开 |
| G5 | 要素选择解释未覆盖完整调用面；AU11 已证明 checkpoint | B27 声明消费；其余调用点选择/省略 trace 随 B27 调用点矩阵 | **承接（B27）** | 同上 |
| G6 | 质量门全链消费与效果验收未闭环；VS-00E 已有简报/评估/修订 | 2026-10-24 B11D 收口（质量卡场级归因 + 场级修订作用域，真实 Tauri PASS）；「长篇效果」仍需狗粮节拍测量 | **降级登记（C 轨观察）**：机制链已有多 slice 证据，效果归狗粮/观察轨，不整项关闭 | C 轨观察（每 3–5 周期狗粮，Selection Rule #4） |
| G7 | message envelope 统一契约与全调用点覆盖未闭环；AU11 最小 proof | B27 声明消费；§11 联合修订已定共同输入真源 | **承接（B27）**，不关闭 | 同上 |

**结论**：G1–G7 均**不得**以「机制存在」或「局部 slice 通过」宣称整体关闭；4 项（G1/G3/G5/G7）由 B27+B26 承接（trigger 型：并行会话释放），G2/G4/G6 降级登记到 C 轨/后续 checkpoint。本会话**不修改 VS-00D 契约文档**（工作树含并行会话未提交修改，§6/§11 对账状态由 B27 owner 在其 Accepted 时统一落），本 slice 的裁决落在本文件 + NEXT 决策日志。

### 1.3 NEM-GAP（08 §6.2）裁决

| 项 | 现状 | 裁决 |
|---|---|---|
| NEM-GAP-01 主题/前提消费完整性待对账 | G2 同源；premise/theme/main_goal 已有字段 | 降级：随 G2 Order 7 余项 C 轨排队 |
| NEM-GAP-02 核心设定引擎/成长体系/命名体系无对象 | 领域要素未拉动，无队列挂靠 | C 轨排队（领域拉动才做；Selection Rule #1） |
| NEM-GAP-04 场级 craft 最小三槽其余要素待拉动 | E28-E30 无契约 key（NEXT E28E30 行 deferred） | trigger 挂账：契约 key 冻结/真实创作动作拉动后开 |
| NEM-GAP-05 五本账长期效果与长尾 | VS-00F 已建账，长期效果需狗粮测量 | C 轨观察 |
| NEM-GAP-06 三态对账定期化与反馈收编待完善 | 定期化对账需 durable（B13b §4.1 #8 trigger） | trigger 挂账：durable reconciliation 前置满足后开 |
| NEM-GAP-08 全书骨架/事实补全回路假定长尾 | 回路已实现，长尾未闭环 | C 轨观察（狗粮/现场拉动） |

### 1.4 B 轨债务（NEXT B 轨债务表 B1–B10）逐项裁决

证据来源：NEXT B 轨行、相关 slice/commit 记录。

| 项 | 裁决 | 理由/证据 |
|---|---|---|
| B1 僵尸 run T5 复验、durable 环境竞态复验 | **已销账（显式弃置）** | T5/durable 竞态的安全面已由 B23 CP4「首次 join 惰性收口 runtime_lost_on_restart + 零重复广播」与 B22/B23 运行时回归覆盖；旧 T5 复验无剩余可执行动作，显式弃置不再占开放债务 |
| B2 D5 预算偏离场景迁移、姊妹场景判断纪元重验、no-progress 语义重设计 | **已销账** | D5= B19 并入 B20 收口；no-progress 语义由 B23-FOLLOWUP 真 no-progress 场景 PASS；姊妹场景（p1-chapter-adoption-reading/au07）已由 B21/B23/B24/B25 多轮真实 Tauri 回归覆盖 |
| B3 work_direction 召回、superseded 卡 UI 置灰、toolbox 遥测 run/turn 绑定 | **降级登记 → C 轨排队** | 均无当前队列挂靠（Selection Rule #2）；work_direction 召回是 AU09 探索翼消费者项，等对应 A 轨拉动；superseded UI 置灰随未来采纳 UI 批；toolbox 遥测随 observability 批 |
| B4 SU01 live vendor 矩阵、DeepSeek live 探针 | **挂账（用户门控）** | 需作者提供凭据/真实 vendor 环境，非 AI 可闭环 |
| B5 47 文案指南机械步注记 | **降级登记 → C 轨排队** | 文档小件，随文案批顺手带走；无独立队列价值 |
| B7 T4 残余三小件（探针目录陈旧/摘要注水去重/runner 长措辞） | **降级登记 → C 轨排队** | 探针/harness 体系自觉扩建被禁止；仅在观察到复发异常时按止损律处理 |
| B8 LM Studio 上下文配置重启易失运维状态 | **已销账（显式弃置）** | 属本机运维状态而非产品缺陷；B22 已把超时/上下文诊断纳入 provider 层（finish_reason/usage 证据），不再以手工 `lms load` 作为产品债务跟踪 |
| B10 上下文组装小件（OmissionNote/摘要质量门/why-panel） | **降级登记 → C 轨排队** | 与 G2 Order 7 余项同源；摘要质量门与 why-panel 分别等 VS-00C/CP4c 类 A 轨拉动 |
| B6 dogfood-runner 判定架构债 | **降级登记 → C 轨排队** | harness 重构无当前队列挂靠；判定点随下次 dogfood 拉动时按「分类一次+穷尽分支」模式迁移 |

**说明**：B 轨表为「成批处理」台账；销账/降级不减少对真实缺陷的登记（降级项仍在 C 轨排队文本中保留），只把「已无剩余动作」的项从开放债务移出。Gap ledger 脚本按 NEXT 行文本识别状态（`已销账` 等），修订后重扫可复核计数变化。

### 1.5 独立复核发现的偏差与证据失效登记（2026-10-24）

二次只读复核（子 agent，2026-10-24 00:44–00:50）发现并已在本文件更正：

1. **AU11 证据链失效**：`AIMessageEnvelope` 唯一生产调用点（`quality_diagnosis/3` 与 `frame.evidence_summary[:ai_message_envelope]` 写入）已被 commit `c4509c86`（2026-07-19「帧纪元退役第二批」）删除；全仓仅剩 `trace_writer.ex:332–341` 消费者，无生产者。判断纪元 `DialogueFrame.evidence_summary` 只有四键（`judgment / action / record_only / context_used`，`dialogue_planning_service.ex:1104–1109`）。
2. **两份 au11 真实 Tauri 场景仍 active 且硬断言死字段**：`au11-quality-diagnosis-message-envelope`、`au11-missing-workstate-policy`（scenarios.yml 原 1047–1060 区）driver 断言 `trace_summary.ai_message_envelope`（`external-ui-driver.mjs:4226–4227,4351–4352`），最后证据 2026-06-22 且 key_events 含已退役 `planner.form_frame.done`；按当前 HEAD 静态推断应红灯。**处置**：标记 `status: blocked` + `blocked_reason`（先例 e2e-01 `scenarios.yml:1263`），登记 `quality/acceptance/known-gaps.md`，待 B27/G7 统一 envelope 落地后 re-anchor；真实 Tauri 复核结果见 §3。
3. **`known-gaps.md` 与实际状态不一致**：该文件原写「当前无 blocked 场景」，但 scenarios.yml 已有 e2e-01/judgment-explore-internal 两条 blocked；本批一并修正为四条（含 au11 两条）。
4. **NEXT Order 7 台账过期**：状态列仍「待定序」，而刀一/刀二已由 CA01–CA04/B11A（2026-07-21/08-24）交付；这正是 G2 契约（VS-00D:404）与 NEM-GAP-01（08:189）持续指向过期台账的原因——本批已把 Order 7 状态行改为「部分闭环 + 余项回链 B10」。
5. **G4/G6 精度**：G4 的 continuity/style_intent 已由 CA02/CA04 从 writer 上下文路径承接，packet 保持最小是设计选择（无 YAGNI 拉动）；G6 机制链有当日 B11D 真实 Tauri 证据，「长篇效果」按 Selection Rule #4 归狗粮观察，不归本队列。

## 2. C 轨观察收口（本 slice 同批）

C 轨定义（NEXT §4）：被 A 轨拉动才做——explore 方向质量 live MBC 探针；记忆类面场景级验收；harness/探针体系自发扩建一律禁止。本轮执行一次**差距回收仪式**（Selection Rule #6）：快照 22 项 → 逐项裁决（§1.2–§1.4）→ 修订 NEXT B 轨表 → 重扫快照。C 轨观察结论：
- VS-00D G1–G7：无一项可诚实关闭；4 项承接 B27/B26（trigger），3 项降级到 C 轨/狗粮观察。
- 所有滞留项均有裁决；无「停留在开放但无裁决」项。
- 后续观察节拍：每 3–5 个周期狗粮（Selection Rule #4）+ 下次开工前再跑 `gap_ledger.sh` 对账新增/关闭/滞留。

## 3. 验证与证据

- 差距回收快照：`reports/gap-ledger/latest.json`（2026-10-24 扫描；裁决前 22 项 → 修订 B 轨台账后重扫 19 项，关闭 B1/B2/B8）。
- 队列一致性：`node scripts/next_task_check.mjs` ok；唯一 next 行 = C 轨观察（周期）/或收口时点配置。
- 全门禁：后端全量、前端 typecheck/lint/test、quality manifest、静态扫描、task_done（本 slice 无 UI 变更，UI evidence not required）。
- AU11 复核：`PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh au11-quality-diagnosis-message-envelope --surface tauri`（2026-10-24）**真实 Tauri exit 1**，driver 报 `No AU11 turn_result with AIMessageEnvelope trace summary`（`external-ui-driver.mjs:4222`），无 summary.json——与“producer 已删除”的静态判断一致；据此把两份 au11 场景标 `status: blocked` + `blocked_reason`（`quality/acceptance/scenarios.yml`，先例 e2e-01）+ 更新 `quality/acceptance/known-gaps.md`（4 条 blocked）。
- 真实 Tauri：本 slice 无产品行为变更，不新增场景；引用同日 HEAD 已绿证据（B11D `p1-prose-quality-finding-roundtrip` PASS、R10R11 `au13` PASS、WORKBENCH-CURRENT-VOLUME `au08` PASS）作为当前产品状态基线，不宣称新验收。

## 4. 诚实边界

1. VS-00D 契约文档 §6/§11 的状态/所有权列更新归 B27 owner（工作树含并行未提交修改，本会话不碰）；本 slice 仅在台账层裁决。
2. G1–G7 未被关闭；G2/G4/G6 为降级登记（仍有剩余工作，只是无当前队列挂靠）。
3. NEM-GAP/B 轨销账只针对「已无剩余可执行动作」项；降级项仍保留描述（C 轨排队），不是删除证据。
4. 本轮不实现 B26/B27/B28–B31 的代码；它们由并行会话/后续队列负责。
5. C 轨观察为周期性动作，非一次性完成；本 slice 完成的是**本轮**观察与裁决入账。

## 5. 决策日志

- **2026-10-24 — CP0**：运行差距回收仪式（22 项开放 / 全部 ×37 滞留）→ G1–G7 裁决（G1/G3/G5/G7 承接 B27+B26；G2/G4/G6 降级 C 轨/后续 checkpoint；不关闭、不改 VS-00D 契约文档）→ NEM-GAP 6 项裁决（trigger/C 轨）→ B 轨 B1–B10 裁决（B1/B2/B8 销账、B3/B5/B6/B7/B10 降级 C 轨、B4 用户门控挂账）。
- **2026-10-24 — CP1**：NEXT B 轨表按裁决修订；新增/更新 C 轨观察与 VS-00D 行状态；重扫差距台账；journeys/ledger 收口。
