# VS00D-G-GAP-RECONCILIATION：VS-00D G1–G7 / 差距台账复核与 C 轨观察（2026-10-24）

- 状态：**done（2026-10-24 的差距对账批次；不代表下述转出项完成）**
- 状态边界：§1–§5 是该批次历史；§6 是尚未拆出独立任务的 B 轨债务唯一状态源，§7 链接其他原任务，真实创作复验有独立小节状态。规则见 [tasks/README](../README.md)。
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

## 6. 开放债务状态

仅本表维护尚未拆出独立任务的 B 轨状态，`scripts/gap_ledger.sh` 只读本节。todo/blocked/deferred 均开放；明确 done/superseded/cancelled 才排除。已拆成独立任务的 B11–B31 到各原任务查询；历史完整债务表在 `docs/project-ledger.md` §10，不再参与扫描。每个子项有承接/触发条件；归并不是完成。

| 编号 | 事项 | 状态 | 承接 / 触发 |
|---|---|---|---|
| B3 | work_direction 召回（AU09，探索翼=新消费者）、superseded 卡 UI 置灰、toolbox 遥测 run/turn 绑定 | todo | **部分归并（2026-10-24，未销账）**：work_direction/角色召回随 B27 共同输入审计及 B29 角色消费验证；superseded 卡 UI 随采纳 UI 真实需求、toolbox 遥测随 observability 批。不得用主档案更新代替召回证明。 |
| B4 | SU01 live vendor 矩阵、DeepSeek live 探针 | blocked | **挂账（2026-10-24，用户门控）**：需真实 vendor 凭据/环境，非 AI 可闭环。 |
| B5 | 47 文案指南机械步注记 | todo | **归并 B27（2026-10-24，未销账）**：随共同规则/文案统一处理 47 指南机械步注记，不再独立排一个文案批。 |
| B7 | T4 残余三小件：探针 call1 目录陈旧（capability_catalog_section 5 项旧目录 vs 生产 6+4）、会话摘要同质 assistant 消息无去重（"已通过采纳边界"×10 注水）、runner 章节请求四子句长措辞助推 plan 判界方差 | todo | **部分归并（2026-10-24，未销账）**：旧 call1 目录探针随 B26 退役，必要判例迁入新协议；会话摘要重复/共同上下文语义归 B27，runner 章请求措辞归 P1-AUTHORING-DOGFOOD。停止两段式参数优化，不自发扩建 harness。 |
| B9 | 狗粮 runner 的确认路径、Q1 空章清算与 Q4 重复段观察（采纳级元泄漏防线已完成，仅保留余项） | todo | 随真实创作复验：needs_confirmation 必须显式确认/跳过并计数；补写/重复观察仍待实跑。原 B9 的 done 只指元泄漏防线，不能遮蔽这些余项。 |
| B10 | 上下文组装小件（2026-07-21 评估余项）：OmissionNote 覆盖不全（仅 prior_prose 裁剪留痕，摘要窗/roster/账面 cap 的取舍无省略记录）；判断 call1 加账面一行摘要（待议，call2 病灶史提醒判断 prompt 加东西须谨慎）；摘要质量门（四栏齐全有校验、内容质量无——摘要是账本/摘要窗/规划共同上游）；why-panel 上下文可解释面板（VS-00C CP2 延后件，随 CP4c 前端批） | todo | **部分归并（2026-10-24，未销账）**：G2/CA01 planner facts、待裁决报告、省略与覆盖范围进入 B27 CP0/CP3 调用矩阵；不再追加 call1 专属摘要。摘要质量收益随真实创作复验，why 面板扩展仍等实际 UI 消费需求。 |
| B6 | `frontend/slice-verify/dogfood-runner.mjs` 判定架构债——文件里散落一堆各自手写的帧判定函数（事件名/字段字面量），契约理解不唯一、易与真实契约（`frontend/src/lib/socket.ts` 等）漂移（2026-07-20 `awaitingAuthor` 判错字段路径实锤）；已把 `adoptPendingDraft` 一处重构成"分类一次+穷尽分支"（`classifyChapterAttemptFrame`），其余判定点（`readToc`、settle/overwrite 确认等）仍是老写法，未同步重构 | todo | **归并 P1-AUTHORING-DOGFOOD（2026-10-24，未销账）**：仅迁移该真实旅程用到的帧分类/确认/恢复判定，契约单源；不先做全 runner 通用框架重构。 |

## 7. 条件项与未关闭后果

这是承接索引，不是第二份执行状态表；已有独立任务时只在接收方更新。原 NEXT 的条件、验收边界与排期依据迁回本对账任务；不因未列为 NEXT 候选而丢弃。

| 项 | 承接 / 触发条件 | 当前处置与退出条件 |
|---|---|---|
| B13b §4.1 #1 / #6 | #1 已归联合主线；#6 真实质量样本归 P1-AUTHORING-DOGFOOD | 不再等“并行 B26 完成”才接 #1；#6 保留作者指定盲评负责人/时机的条件。B13b 对账完成不等于这两项实现完成 |
| AU05B-ADOPTION-REVIVE（B13b #5） | 作者明确需要撤回误丢弃/恢复旧版 | deferred；矩阵已有，生产入口未有。复活必须回 TENTATIVE 重入采纳；B28 保留历史不自动承诺复活 UI |
| UA01-CP6 外部探索（B13b #7） | 真实创作研究需求 + 作者出站授权粒度/来源可信度决策 | deferred；本轮优先内部作品事实闭环，不先扩搜索平台。触发后从真实问题到带来源 tentative 候选与采纳验收 |
| VS-00F durable 对账 / NEM-GAP-06（B13b #8） | 真实审读超 bounded 预算或确需跨重启定期化 | deferred；复用 LongRunTask，证明同一任务恢复且不重复派发。正常有界审读不因此重做 |
| Experience Engine dismiss（B13b #9） | 33 Experience Engine 有获准运行时和真实消费者 | deferred；保留现有 dismiss 审计证据，不为消台账先建引擎 |
| E28–E30、NEM-GAP-02/04 | 真实创作暴露当前表达不足，并冻结具体对象/字段及消费者 | deferred；E24 角色议程结构化、E26 地点/时间/氛围也保留原账，不只列 E28–E30。B11D 多场/单场替换归 B28 CP0 接单，不混同“多加 craft 字段” |
| NEM-GAP-05、VS-00D G6；NEM-GAP-08 | 前两项由狗粮检验持续防漂移/质量；08 由原 VS-00G CP5e 及假定链承接 | 机制已有证据不外推长期收益；CP5e 真实页面、触发 C、寿命催办、works 级假定仍分别开放。B29 触及角色档案时复用/回归相关假定，不趁机重建事实盘点 |
| B3/B5/B7/B10 | 共同输入/枚举/目录/消息去重/文案归 B27；B3 的角色召回随 B29；B7 runner 措辞归狗粮 | 部分归并，均未销账；superseded 卡 UI、遥测、why 面板、摘要质量等剩余按原消费者拉动。停止两段式探针扩建不等于所有 B7 余项已修 |
| B6/B9 | 下一次真实狗粮确需处理的帧分类、覆盖确认和失败恢复 | 随 P1-AUTHORING-DOGFOOD；仅统一真实契约消费，不先做通用 harness 重构 |
| B4、AB-RESUME/VS-00I 冻结后增量、B22 自适应校准 | 凭据/可用环境或实际存活与缓存问题出现 | C 轨；复用当前 adapter/TimeoutPolicy。历史调用对数据只作历史证据，不能为追 cache 命中恢复双协议；不恢复作者已停止的 A/B |
| C-TRACK-OBSERVATION | 开工/收尾差距回收；每 3–5 周期真实狗粮 | 周期仪式，2026-10-24 本轮已做；不再占产品队首。扫描只覆盖 G/NEM/B 轨登记表，开放计数只覆盖 G/NEM/B 轨来源，不是项目全部任务数 |

### 原任务承接入口

| 原记录 / 余项 | 唯一状态来源及仍需承接的范围 |
|---|---|
| B26/B27 联合入口、PLANNER-SEMANTIC-BOUNDARY、G1/G3/G5/G7 | [B26](B26-single-call-judgment-protocol.md) / [B27](B27-systematic-prompt-and-intent-integration.md)；协议与语义分别验收；G3 schema owner 为 B27，不恢复旧 AU11 producer |
| B31 一般自由输入绑定 | [B31](B31-author-reply-run-binding.md)；明确 ask_author 问题绑定由 B26 自证，本项不作反向前置 |
| Q1c 全章后果 / B11D 多场正文、单场替换、逐场评审 | [B28](B28-whole-chapter-revision.md) CP0 接单；原 B11D 已完成的 finding 归因保留。未形成覆盖/身份/事务/页面验收前，转出项保持开放 |
| B25 大纲物化遗漏 / AU08 结构维护 | [B30](B30-chapter-structure-maintenance.md)；ensure_planned_chapter 仍 title+limit(1)，正文 ref 验收不覆盖该路径；卷章类型先复现，不重建已正确路径 |
| AU09 已有角色改判主角 CP2 | [B29](B29-existing-character-role-revision.md)；主档案、记忆与下轮消费一致，不能以演化文字代替字段更新 |
| Order 7 / G2 / NEM-GAP-01 | [B27](B27-systematic-prompt-and-intent-integration.md) 输入矩阵承接 CA01 planner facts / 待裁决报告 / 省略范围；[CA01](CA01-planning-context-completion.md) 原字段写入余项仍保留，已有 CA01–CA04/B11A 不重做 |
| Order 6 / NEM-GAP-05/06 / R2 design_ref | [VS-00F](VS-00F-five-ledgers-three-state.md) 与 [B13b §4](B13B-adr-enforcement-reconciliation.md)；五账长期效果、design_ref、durable 和 dismiss 触发分别保留 |
| NEM-GAP-08 | [VS-00G](VS-00G-fact-inventory-run.md) CP5e、触发 C、寿命催办、works 级假定、记忆注入富化；没有新证据不借本次迁移关账 |
| B14 / DS03 尾项 | [DS03](DS03-awaiting-author-runtime-validity-and-recovery-surface.md)；schema/Pencil/其他 flow steer 等原余项保留，明确问题回复由 B26 承接 |
| B22、B24、AB-RESUME、T7 的后置项 | [B22](B22-provider-liveness-and-budget-policy.md) 自适应校准；[B24](B24-exploration-chapter-full-read.md) 超长章/批量/档位；[提示词任务](UA01-agentic-loop-prompt-hardening.md) T6/T7 的 vendor/live/developer UI；均按原触发条件，不因历史行 done 关闭长尾 |
| Order 8 空转调查、E28–E30 / NEM-GAP-02/04 | 原调查已完成，后续以本节条件表及 `docs/design/08-novel-element-model.md` 差距为源；需真实创作消费者，不自动建空字段 |

### 真实创作复验

- 状态：**done（2026-10-27，canonical-3e 浏览器实模 + 原生实模 scoped 四项能力）**。canonical-3e 保留为浏览器实模产品链 PASS；完成审计要求的原生证据已由 P1 原生 scoped 批次补齐（创作/排版维护/真实关闭重开恢复+续写/真实目录面板导出，真实 Strata iq3_s，checks 103/103，见下）。I10 文学盲评仍待作者安排；原批次与失败批次只读保留。
- 原收口记录：**done / PASS（2026-10-25，canonical-3e final；P1 收口）**：Strata `iq3_s` detached phase1+phase2 共约 28.3min，单次未重跑换分；**10/10 章≥1000、总 12,894 字**；维护 5/5（design/format/content/renumber/role，attempts 均 1）；content_revision 第03/04章 `target_segments`：25 段仅 segment0 变化、**其余 24 段 sha 逐字节相同**、首段 46→184 chars、字数 1344→1470 不塌缩；wrong-route 终局 0、failures/retries 0；B9 confirm 3/skip 0；author_question_events 0（机制武装）；导出 44KB；wait 59 waits/0 timeouts/无重复 instruction；writer 24（≤40）。canonical-1/2/3 各事故/失败批次（attempt1 SIGTERM/attempt2 预算污染/attempt3 design/attempt4 awaiting）全部保留只读；**I10 文学盲评仍待作者指定负责人/时机（AI 不代签）**，B38 世界规则保存判断候选 deferred（trigger 真实产品链复现/作者请求）。证据 `artifacts/novel-output/p1-authoring-dogfood-2026-10-25-canonical3e/`。
- 任务：P1-AUTHORING-DOGFOOD；既有周期复验，不新增产品能力或平行 harness。
- 范围：引用 `docs/product/novel-output-milestones.md` §4/§8；每 3–5 个周期插入，最迟本轮 B26/B27→B31→B28→B30→B29 后执行。
- 剩余：复用真实工作台 runner 完成 10 章创作，包含修订/结构/角色维护、采纳、重开、审读、导出；确认路径/空章/重复观察消费 §6 B6/B7/B9。各操作尚未上线时不能用脚本旁路代替。
- 验证：实模语义、真实 Tauri 产品链、文学质量盲评分开；记录错对象/错绑/越权/虚报、重试率、缺章/重复/漂移、人工改稿负担。ADR-0020 I10 仍需作者指定盲评负责人/时机；AI 不代替盲评签字。

#### 2026-10-27 P1 原生实模 scoped 补验（创作/维护/恢复/导出）

- **背景**：完成审计指出 canonical-3e summary 为 `surface=browser / driver=headless-chromium`；作者保留原生标准、不重跑 10 章矩阵换分。新增 `scripts/native_p1_drive.mjs` / `native_p1_evidence.mjs`（外部 AX/CGEvent 操作真实 Tauri 窗口）与 runner 的 `p1-chapter-draft-generation` native allowlist/verify 分支。
- **批次**：`artifacts/slice-verify/p1-chapter-draft-generation-native/`（provider=strata/iq3_s、driver=ax-native-system-ui、scope=scoped_native_creation_maintenance_restore_export、REPORT.md）；**checks 103/103 PASS、detached EXIT/0**。
- **四项能力实测**：
  - **创作 T1**：真实主输入「第01章：底层灵气账单的正文还没写，帮我写出来吧。」→ judgment explore→execute(prose_writing) → 候选 1290 字符（provider_call_ref 命中 writer run、provider usage.model=iq3_s）→ 真实点击采纳 → DB accepted 与候选逐字节一致 → 阅读可见；章数 12/章身份不变。
  - **维护 T2**：真实主输入「把第01章正文整理一下，只调整分段和排版，不要改字句。」→ judgment execute(revise_adopted_content) → `prose_formatting_plan`/format_only → 真实点击「应用分段方案」→ preview 1321 字符/73 换行 vs base 1290/42，**非换行字节完全相同**；receipt `adoption_effect=format_paragraphs`、non_newline_hash/result_hash 与本地计算一致；同章身份/章数不变、旧 draft SUPERSEDED 保留。
  - **恢复 T3**：真实关闭重开（cleanup 164ms remaining=[]，old pid 15548→new 22846）→ DB 章节/草稿/摘要事实一致、active session/transcript/阅读恢复一致；续写「接着第01章：底层灵气账单往下写一段吧。」→ 采纳 → 同章追加（scenes 1→2、1321→1886 字符、旧正文为前缀保留）。
  - **导出 T4**：阅读模式「导出全书」→ 真实 macOS 目录选择面板（AXSheet + Cmd+Shift+G 导航 + 目录可见校验）→ 导出 `export-dir/P1 单章正文草稿验证作品.md` 6763 bytes、sha256 `0d9a36d3…e529`，内容含当前第01章已采纳正文与章标题；导出后回工作台会话可继续。
- **真实模型**：provider=strata、provider_outputs.usage.model=iq3_s（15 run）；18 次 provider 调用（planner 10/writer 2/evaluator 2/narration 3/revision 1，全部 HTTP 2xx，累计 186,860ms）；三条主输入各发 1 次、无 cancel/重发、作者提问 0（author_question_events=[]）；wait-ledger 35 waits/0 timeout（含 input/ack/turn/candidate/adoption/maintenance/restore/export 全分型）；生产源码指纹批次前后一致（HEAD `f75a2bb0`）。
- **模型生命周期**：跑前 Strata loaded=null/lms ps/内存记录；结束 `POST /api/models/unload` 200 → `GET loaded=null/current=null`，model-lifecycle-before/after 落盘；端口/进程释放。
- **失败批次（只读，驱动缺陷已修）**：`...-failed-screenshot-flake-20261027T014834`（窗口截图 flake→重试+整屏兜底）、`...-failed-candidate-ledger-and-export-navigation-20261027T0154`（candidate 等待账+导出面板导航→目录可见校验/取消守卫）；后者在 workspace 外误导出的 9715B 文件已由 Lead 核实并清理。
- **边界**：scoped 四项能力证据，不重跑 canonical 10 章矩阵/不换分；I10 文学盲评仍待作者指定负责人/时机（AI 不代签）；真实模型流式响应未落库导致 I1 字节级对照诚实降级为「provider_call_ref→provider_runs/usage + 采纳链逐字节一致 + 已采纳正文进入后续 provider 请求」三重证据。

#### 2026-10-25 复验预注册（P1 cycle-2026-10-25，canonical run 前撰写，禁止事后改口）

- **批次/预算**：每轮一次 **canonical** 10 章级真实创作复验；总真实模型 writer 调用预算按 10 章 × 平均 2–3 轮估算（≤40 次），超预算以诚实失败/缺口记录收尾；不并发模型（单槽），不因结果不理想重跑换分；失败/重试次数全量计数。
- **模型**：先做 ≤2 章模型 probe（LM Studio `qwen3.8-flash-next@iq4_nl` 优先，必要时 `qwen3.8-27b-bf16`/`strata/iq3_s`），按 probe 的延迟/可采纳性/失败模式选定 provider/model/timeout，并写入 `artifacts/novel-output/p1-model-probe-2026-10-25/plan.md`；probe 与正式 run 串行。
- **模型/工具裁决（作者 2026-10-25，覆盖 probe 建议）**：P1 canonical 主模型 = **Strata `iq3_s`**（作者明确选择，速度优先）。依据：严格同模型对比受 Strata 缺 llama-server engine 阻塞（同一 27b-bf16 在 Strata 无法加载；LM Studio 同模型实测 plan 9.09/prose 9.20/judge 8.63 tok/s、机械质量合规，作为对照保留）；Strata iq3_s 同 prompt 实测 plan 20.59/prose 78.11/judge 48.89 tok/s、机械质量合规。**风险如实保留**：iq3_s 与 probe B 非同模型/量化，且 B28 CP4 有长文 writer 退化史（32k 失控低熵）→ **canonical 前必须先做单章受控验证（plan 不被拒、正文>0、无失控重复、pending 候选）**，通过才 P1 GO；失败则如实记录、不重跑换分。Strata llama-server engine 安装暂不进行（如需严格同模型对比再另行授权）。
- **模型生命周期（用户硬约束，2026-10-25）**：真实模型加载属 harness 能力、非产品能力；**任何 probe/正式 run 结束（含失败/中断）必须 `~/.lmstudio/bin/lms unload --all` 并用 `lms ps` 验证无已加载大模型**；同一时刻只允许加载 1 个模型；加载前记录 `lms ps`/内存压力，发现 >1 大模型或非预期模型立即中止并报 Lead；不得让模型常驻导致本机负载过大/崩溃重启。
- **范围（10 章级会话）**：真实 Tauri 工作台自然语言创作，含至少：新章/续写草稿多章（≥5 章达标）、**整章仅排版修订**（B28 format_only，≥1）、**整章内容修订**（≥1）、**章节重编号/结构维护**（B30，≥1）、**已有角色叙事身份修订**（B29，≥1）；每类均从真实自然语言入口出发并经真实采纳/确认；含 **重启后 resume 断点续跑** 演练、阅读模式/档案审读、导出完整作品；维护动作不得用脚本旁路代替（runner 只能像作者操作 UI）。
- **度量**：错对象/错绑（回复或操作落到错误章/角色/run）、越权写入/未确认写入、虚报完成、走错能力/误路由、重试率、缺章/重复章/重复段、字数漂移/质量漂移、人工改稿负担（作者视角记录）；确定性统计用 word-count/quality/continuity 报告；模型语义与产品状态链分开。
- **证据（milestones §8）**：`artifacts/novel-output/p1-authoring-dogfood-2026-10-25/{summary.json,word-count.json,chapter-quality.md,continuity-report.md,export/,progress.jsonl,...}` + 真实 Tauri/WS/app JSONL/llm-calls/截图/DB 快照；失败/重试批次全保留。
- **B6/B7/B9 消费**：runner 仅对本旅程用到的帧分类/确认/恢复判定迁移「分类一次+穷尽分支」契约单源；`needs_confirmation` 显式确认/跳过并计数；空章/重复段观察接入报告；章节请求按自然作者措辞。
- **文学质量盲评（ADR-0020 I10）**：与产品状态链/自动化分开；**需作者指定盲评负责人/时机**，AI 不代签、不以自动化分数替代质量收益判定；本轮先输出可盲评样本包（chapters/quality/连续性），盲评结果待作者安排。
- **退出/收尾**：10 章 canonical（或诚实记录失败章数）完成后输出证据与报告；未达标项/缺口/数据清理均如实登记，不把机制通过冒充文学收益；stage 数据修复另行授权。

#### 2026-10-25 CP0 阻塞与修复（预注册后、canonical 前）

- **probe 发现**：真实模型（LM Studio `qwen3.8-flash-next@iq4_nl` / `qwen3.8-27b-bf16`）在 `agent_plan_draft` 只返回 `{"plan":{...}}` arguments；`AgentPlanToolContract` 要求顶层 `{plan, author_reasoning, reason_codes, confidence}` 且 `additionalProperties=false` → `plan_draft.output_validation rejected {:invalid_plan_tool_arguments, []}` → `agent_plan_protocol_violation`，每章 0 正文。**模型可用性不是问题，是 plan 协议/提示不可达**；不修则 canonical 10 章只会产出失败证据。
- **裁决**：先做最小产品可达性修复（task-81：draft/revision 输出契约显式 JSON 骨架 + `invalid_plan_tool_arguments` 纠错回执携带字段级错误/骨架；**不放宽 schema、不服务端补字段**），修复提交后 harness 做**单次受控单章验证**（加载选定模型→验证→`lms unload --all` 卸载），通过后发 P1 GO 再跑 canonical 10 章。probe 的 A/B 失败证据保留，不重跑刷分。
- **模型卸载**：probe 结束时 harness 必须卸载全部模型（`lms unload --all` + `lms ps` 验证为空），正式 dogfood 复用同一生命周期规则。
- **P1 canonical-2 预注册（2026-10-25，post-fix 验收，非分数重跑）**：B33（判断路由/上下文）+ B35（采纳范围完整性）+ B36（局部修订算法/结构化替换）+ runner 维护措辞修复完成后，执行**一次**完整 canonical-2：
  - 配置：`--provider strata --model iq3_s`，fresh DB `tmp/dogfood-db-p1-canonical2-20261025`，证据目录 `artifacts/novel-output/p1-authoring-dogfood-2026-10-25-canonical2/`；phase1 `--stop-after 5` + phase2 `--resume`；维护 5 拍按 B36/b28 口径；不加载 LM Studio；模型用完卸载。
  - 通过判据：10 章各推进（7/10 章≥1000 可接受；空章/短章如实记录）；维护 5/5 成功（design_character/content_revision/format_revision/chapter_renumber/character_role_revision）且内容修订「第一段实际变化、其余段落逐字节保留、字数不塌缩」；wrong-route 终局 0（允许≤1 次有界纠错后 execute）；无错对象/错绑/越权写入/虚报；B9 确认显式计数；导出完整；§8 证据齐。
  - 若仍有失败：如实记录并归因到 B33/B35/B36/P1 runner，不以重跑换分；必要时再开修复任务，不直接关闭 P1。
  - **canonical-2 失败批次与修订（2026-10-25，如实记录）**：canonical-2 phase1 在 content_revision 维护拍失败——`adoption.persist :incomplete_scope`（第04章有 2 份 accepted prose drafts，B36 CP2 `persist_replace_segments` 只接受单一 base draft）；UI 显示「作品档案写入失败，原候选仍待采纳」。这是**产品修复自身暴露的新缺陷（B36 CP2b）**，不是 canonical-2 评分问题；证据保留在 `artifacts/novel-output/p1-authoring-dogfood-2026-10-25-canonical2/`，不覆盖。**B36 CP2b 修复（多 covered_refs 组合）后执行一次 canonical-3**（同 canonical-2 预注册配置/判据；fresh DB/证据目录；仅因产品缺陷修复重跑，不因分数重跑换分）。canonical-3 通过后 P1 收口；仍失败则如实归因/继续修复，不直接关闭。
  - **canonical-3b attempt2（2026-10-25，预算污染批次，不用于 P1）**：B37 detached 启动后 input 30s×2 超时、turn 120s 对 iq3_s writer/续写不足（writer 90–200s、续写 197s）→ runner 超时重发同一续写指令（08:15 重发/08:16:44 才采纳），第02章 931→1475 字；Lead 经 detached stop 终止（TERM/143），证据改名 `...canonical3b-attempt2-budget-contaminated/`。B37 CP3 修复（按 provider 预算 + 超时不重发）后 canonical-3c fresh 执行；attempt1 SIGTERM/attempt2 均保留。
  - **canonical-3c attempt3（2026-10-25，design_character 维护拍失败，不用于 P1）**：phase1 EXIT0/15.7min、5 章 5,561 字（05 empty）；B37 wait 35/0 timeouts/无重复发送；format+content PASS（第04章第一段 1049→1136），design_character 4 次失败（产品 ask_author 要方向；runner「方向由你定」仍 await；随后 prose_ready 非预期候选 fail-fast）→ 未跑 phase2；证据 `...canonical3c-attempt3-design-beat-failed/`。**B37 CP4** 修复 design 澄清/无关候选后，先 design-beat 真实模型 scoped replay，再 canonical-3d fresh。attempt1 SIGTERM/attempt2 预算污染/attempt3 均保留。
  - **canonical-3d attempt4（2026-10-25，awaiting_author 作者问答未自动化，不用于 P1）**：design-beat scoped replay PASS 后 canonical-3d 启动；实况多次 `agent_awaiting_author`（模型等作者决策/补充），runner 按工具失败 readToc/取消活跃 run/重发，每章多耗 2–4min；Lead 通过 detached stop 终止（attempt4 证据保留）。**B37 CP5** 通用作者问题应答（不 cancel/不重发，bounded 回复）修复后 → 真实模型单章 scoped replay → **canonical-3e final**。attempt1–4 全部保留，不重跑分数。



  - **canonical-2 最终失败摘要（2026-10-25，phase1 自然结束，未跑 phase2/未导出）**：39.6min；总 6,443 字；5 章推进（01 1184/02 1373/03 1444/04 1708/05 734 short）；维护 design PASS（老鬼 character_seed）、format PASS（1444→1444）、content_revision FAIL×2（`adoption.persist :incomplete_scope`，第04章 2 份 accepted drafts；B36 CP2 单 base 限制；零写入）；renumber/role 未触发；73 provider calls、retry 0、chapter failures 0、meta_leak confirm 2；runner 在采纳失败后盲等 600s×2（已修 fail-fast `036a2da5`）。证据 `artifacts/novel-output/p1-authoring-dogfood-2026-10-25-canonical2/`（failure-summary/launcher/db-snapshot/summary/app/llm）；canonical-1 只读。
  - 边界：只允许这一次 post-fix canonical-2；canonical-1 证据保留只读；I10 盲评仍需作者指定负责人/时机（AI 不代签）。
- **单章受控验证 PASS（2026-10-25，HEAD `582a7ae8`）**：Strata `iq3_s` 单章一次通过——`plan_draft.output_validation` rejected=0（无 invalid_plan_tool_arguments）、plan 顶层四字段+steps=3+prose_writing 带 authoring_intent、正文 1405 words、无失控重复（8-gram 0.0157、max completion 1452）、pending 候选由外部 runner 作者确认采纳、0 run_failed/0 retry；wall 207.975s、12 calls/7728 completion tokens/聚合 36.61 tok/s；结束 `lms ps=[]`、Strata loaded=null。证据 `artifacts/novel-output/p1-model-validate-strata-2026-10-25/`。**canonical 10 章已 GO（fresh+stop-after 5+resume，单次不重跑换分）**。
- **canonical 实跑结果（2026-10-25，HEAD `f213e56d`，P1 未通过）**：`--provider strata --model iq3_s`，phase1 `--stop-after 5` 16.4min + phase2 `--resume` 26.9min，exit 0、导出成功、单次未重跑。实测：**10,002 有效字**（目标 100k 未达）、章 12（前 10 章中 7 章≥1000：01 1145/02 1092/03 1002/04 1230/06 1566/07 1551/10 1460；05 章 956 短、08/09 空、11/12 未写）；writer 11 次（≤40）、重试 26（wrong-route 24 + locator timeout 2）；B9 confirm 3/skip 0；空章 4、重复段 0；维护 **2/5**（format_revision ✅、chapter_renumber ✅；design_character ❌ 5 次 judgment 只回角色方向、content_revision ❌ 4 次 `agent_awaiting_author`、character_role_revision ⛔ 依赖设计未执行）；无错对象/错绑/越权写入/虚报。**根因线索**：判断输入约 70k chars（input token 中位 23–32k，失败 reply 中位 32.4k），iq3_s 在长/冗余上下文下把创作动作判成 reply/creative_directions/await_author；正文无失控/32k 截断（重复段 0），瓶颈是语义路由不是长文退化。证据 `artifacts/novel-output/p1-authoring-dogfood-2026-10-25/`（§8 证据 + app-log/llm-calls/backend/db-snapshot/run-report/失败截图）；模型生命周期 close（Strata loaded=null、`lms ps=[]`、native iq3_s 按任务前保留）。**P1 不关**：新开 B33（判断路由/上下文可靠性）与 P1 runner 维护措辞修复，修复后 scoped 复验，不复跑换分。

## 8. 关联裁决与迁移记录

### 2026-10-24 排期关联裁决

以下是上一轮关联分析的决策依据；原任务承接后不在这里同步实现进度。

排序依据是[愿景 §2.1–§2.3](../../docs/design/00-vision-and-engineering-roadmap.md)：会话结构是 Agent 内核；作者面对自然语言创作伙伴；系统掌管门禁、记账、归档；写入默认 tentative，作者决定 canon。长期目标仍是[产出里程碑](../../docs/product/novel-output-milestones.md)的连续创作、修订、事实一致与中断恢复，当前不以再堆一次字数替代这些能力。

近期发展已从“补生成工具与底层机制”转到“把已有能力连成可靠的创作循环”：章节与卷已有稳定身份和结构，质量与采纳已有边界，作者却仍可能需要换成工具式说法、回复串任务、整章整理变成新建章、指定主角只落记忆、重编号变成新大纲。因此优先收敛任务语义与对象操作，而不是继续按 ADR 缺口编号逐个补件。

### 设计滞后与任务归并裁决

| 现有项 / 证据 | 判断 | 本轮排期处置与关闭条件 |
|---|---|---|
| B26 与 B27：UA-01 §2.2、VS-00D §11；生产仍为两段式 | 一个入口上的协议与语义变更，前后独立实施会改两遍 | 联合设计、一次接线；B26 负责协议/分派/来源/计数，B27 负责全调用点任务语义。协议通过和语义质量通过分别报告，不能相互顶替 |
| B31 与 B26 ask_author：`WorkspaceChat` 当前从 `visibleAgentRuns.at(-1)` 取主输入目标；最新 UA-01 / B31 §2.1 已划清边界 | 明确问题的绑定与无明确绑定的一般输入相关，但不是同一前置 | B26 独立交付持久问题、空选项自由文本、显式选择及恢复；B31 处理一般输入/换话题/旧讨论归属，紧随后复用同一校验。CP0 可提前，不把 B31 全部完成设为 B26 门槛；列表顺序仍只是根因线索 |
| B13b §4.1 #1 `PLANNER-SEMANTIC-BOUNDARY`；Q3A 语义对账 | 与新协议映射、能力目录和越权校验同一边界，不是“等 B26 完成再补”的独立刀 | 并入 B26 CP3 / B27 CP1–CP2：可执行结构的原响应→Frame→MicroPlan 校验、registry 合法性、权限与语义冲突对账；保留反例与真实入口验证，不扩成关键词路由器 |
| VS-00D G1/G3/G5/G7、AU11 旧口吻/envelope 任务 | G 表与 AU11 历史完成口径仍依赖已退役的 `Planner.form_frame` 证据；旧 `AIMessageEnvelope` 有定义但未见生产外部调用，两份 AU11 场景已登记 blocked | 归 B27 全调用点矩阵；G3 schema/MissingPolicy/trace 的 owner 明确为 B27 CP0，按真实消费者决定复用/增量/退役。旧 builder 不补关键词续命，旧场景改锚当前判断链；G 项保持开放直到证据逐项成立 |
| VS-00D G2、Order 7、CA01 余项、B10、NEM-GAP-01 | 作品事实与省略语义是 B27 的共同输入，继续全部放 C 轨会让“统一任务”缺事实 | 归 B27 CP0/CP3：planner 事实、阵容/摘要窗/创作锚、待裁决报告、截断与省略来源逐消费者核查；复用已接线的 CA01–CA04/B11A。新 why 面板及摘要质量收益仍另验，不借机扩 UI |
| VS-00D G4/G6、B11D、质量修订 | 设计载体/质量机制已有实现；场级 finding 不等于场级正文身份或场级替换，fixture 不能证明文学收益 | G4 已有 brief/使命/坐标由 B27 保留，缺失维度按具体调用列账；G6 与五账长期效果进真实创作复验。B11D §5 的多场正文、单场替换、逐场评审在 B28 CP0 逐条接单裁决，不能以“已转 B28”自动关闭 |
| B28、Q1c、B25：`PendingArtifactWorkflow.request_adopted/6` 只传所选 artifact 正文 | 单 artifact 修订已通不等于完整章修订；旧候选缺 ref 仍可能落新建兼容路径 | B28 负责完整覆盖集合、来源恢复、版本与同章事务替代；Q1c 既有证据保留，补原生 Tauri 全章后果。B28 优先于新领域槽扩容 |
| B30、B25、AU08/B11A：`ensure_planned_chapter/4` 仍 title-first；卷章类型已有解析 | 生成/追加计划与维护原结构必须区分；B25 的正文证明不能覆盖大纲物化 | B30 优先于 B29：先复现并核对 B25 遗漏路径；维护按 ref 更新，生成路径身份/幂等也纳入同一契约。卷蓝图误建章先用当前 B11A 复现，已正确则保留回归，不再造类型系统 |
| B29、AU09 角色类型 §7 CP2、Q1c | 角色叙事身份是 Character 主档案事实，演化记忆不能替代更新 | AU09 已有角色改判主角的余项合并到 B29；复用 Character 身份/归并及采纳，更新同一对象并同步档案/探索/上下文，不另建角色生命周期系统 |
| `C-TRACK-OBSERVATION`、反复 MAINLINE-RESET、B13b 总审计 | 巡检已执行却长期占唯一 next；“处理完候选”也不等于 trigger 项已实现 | 巡检回归开工/收尾仪式，已完成任务移到历史区；每个未完成项在下表有 owner、前置与退出条件，不再以观察代替产品推进 |

本轮代码核对入口：[判断协议](../../apps/novel_application/lib/novel_application/judgment_protocol.ex)、[旧 envelope](../../apps/novel_application/lib/novel_application/ai_message_envelope.ex)、[已采纳修订](../../apps/novel_application/lib/novel_application/pending_artifact_workflow.ex)、[采纳仓储](../../apps/novel_persistence/lib/novel_persistence/adoption_repository.ex)、[输入绑定](../../frontend/src/lib/agentRunInputRouting.ts)、[工作台](../../frontend/src/components/WorkspaceChat.tsx)。AU11 失败证据索引见 [known-gaps](../../quality/acceptance/known-gaps.md)，本轮未重跑页面。

### 不再作为独立目标的实现

- **两段式专属实现和优化**：按 B26 删除清单迁移后移除 call1/call2 分派、双态替身、专属解析/计数、调用对测试与探针；停止 UA01-CALL2 参数对照，不建模型分档、降级或开关。保留单调用所需 L0–L4 前缀纪律、缓存事实和 N-NARR；provider 的通用 forced-tool 能力整形不能误删。
- **旧 AU11 入口与机械话术修补**：不恢复 `Planner.form_frame`，不新加自然语言关键词分类器，不用“复述意图/报形态/固定空行”解析业务授权。迁移必要契约后删除无消费者的旧实现，独立口吻任务并入 B27。
- **重复机制**：不为正文/结构/角色各建一套修订框架、控制坞、采纳通道或长期义务账；共用现有身份、版本、授权与结果词义，保留各对象自己的事务和领域规则。
- **尚无消费者的扩建**：不因 E28–E30 缺字段就先建槽；不为接 dismiss 先建 Experience Engine；不因有定期化设计就先建 durable 调度；不重建已被统一 Strata 后台取代的 per-profile 发现。

这些是下一实现批的删除/合并约束，**本轮没有删除代码**。`00` 中初创阶段的 Stage 1、“下一步先设计”等文字以及历史 Order 顺序只作背景，不覆盖当前实现事实和本队列。

### 2026-10-24 状态真源与 NEXT 精简

- 范围/Contract：用户授权精简；`tasks/README.md` 固化“原任务维护状态、NEXT 只排期”；本任务已有差距对账职责，承接 B 轨扫描来源迁移。
- Invariant：每个状态有唯一源；完成项不入当前/候选；移出 NEXT 不关闭差距；历史记录、未闭环后果及原证据限制保留。
- Boundary：tasks/docs/reports/scripts；不改任何 umbrella app、生产前端、依赖或业务数据。Consumer 为接手者、next_task_check、gap_ledger 与统一静态扫描入口。
- Proof：检查器正反例（源状态/失效链接/锚点/重复任务/多队首/旅程双写/体积）、差距扫描迁移与失败不覆盖快照测试、历史完整迁移对照；编译基线及统一扫描。
- Acceptance Driver / Exploration：工程文档和脚本任务，无产品行为，不新增 Tauri 场景或验收 hook；非要素物化。
- 迁移：旧 NEXT 完成记录/Order/债务快照/Decision Log 原文转 `docs/project-ledger.md` §10，条件/开放债务/关联裁决回本文件；B26–B31 原设计与验收状态未改。B9 原行整体 done 掩盖 runner/空章/重复余项，现只把余项显式挂 todo；这是揭示开放项，不回滚已完成的采纳防线。
- 更新规则：checkpoint 只改原任务；选项或阻塞改变才改 NEXT；体验覆盖改变才改旅程；交付/证据/重要裁决才改事实台账。验证结果在本条下补充，不向 NEXT 回灌日志。

- 迁移验证：旧 NEXT 548→25 行；83 行历史表格记录与原 Decision Log 完整迁入事实台账，11 行条件承接均在本文件可达；新链接检查通过。原 19 个开放差距 ID 全保留，新增 B9 余项后为 20 项（7 G / 6 NEM / 7 B），无虚假关闭。
- 检查验证：`mix compile`、`node --test scripts/next_task_check.test.mjs`（22/22）、`node scripts/next_task_check.mjs`、`bash -n scripts/gap_ledger.sh`、`git diff --check` 通过；测试覆盖原状态变终态、锚点子任务、旅程双写、规模限制、源表/单行丢失及失败不覆盖快照。
- 扫描闭环：首轮 `bash scripts/ai_static_scan.sh --top 10` 提示新动态 RegExp 与过期 task-done manifest；前者改为静态正则加标题层级比较，后者经 `bash scripts/task_done.sh --top 10` 正常刷新并触发完整复扫。最终结果消费 `artifacts/static-scan/top10.md` / `report.json` / `disposition.md`；既有 gitleaks 两项处置不改，本轮没有新增产品 UI 验收。

### 2026-10-25 队列完成审计预注册（18:17，未宣告完成）

- 触发：作者更新目标的成功定义；当前 NEXT 声明清空，HEAD `a60c9024`，需按完整 CP 与证据层级逐项核对。
- 范围：只读检查 B26–B31、B33–B38 与 P1 canonical-3e 的任务/验收摘要、实际 driver、门禁、维护回执与资源生命周期；不挖掘额外 stage 作者原文，不改历史批次，不运行真实模型。
- 预算：每份 canonical 摘要/声明对应 driver 读取一次，按差异定位必要片段；当前全门禁最多一批，出现新失败先登记根因，不改判据或重复刷分。资源检查各请求 5s，确认空闲后按作者授权卸载并验证；不杀未知任务。
- 证据目录：`artifacts/completion-audit/20261025-1817/`。记录 HEAD/工作区、scope→requirement→evidence→verdict、模型前后状态、命令/退出码、团队任务视图。
- 已确认矛盾：B28/B29/B30/B31 canonical summary 为 `surface=browser / driver=headless-chromium`；P1 dogfood-runner 实际 `chromium.launch({headless:true})`，summary 硬写 `surface=tauri`。不以启动了原生 app 代替原生交互证据。B27 CP4/CP5 known-gap 保留，文学盲评只由作者安排。
- 升级边界：若需改变原生验收要求、known-gap 的完成口径或历史数据，按作者新规则提交具体选项；当前不将 goal 标 complete，不修改原始验收产物。

#### 完成审计裁决与结果（2026-10-25）

- 作者明确选择：**保留原生标准，补原生证据；B27 保留未完成 known-gap，不将整个 goal 标完成**。因此撤回 NEXT 的队列清空声明，仅按原顺序重开 B31→B28→B30→B29→P1 的原生证据，不回滚产品实现，不放宽判据，不重跑已失败的真实模型矩阵换分。
- P1 canonical-3e 已证明浏览器上的实模连续创作/维护/导出（12,894字、10章、维护5/5），不是原生 Tauri 交互证明，也不是10万字里程碑或 I10 文学盲评完成。原报告保持只读，错误 surface 字段由此审计注记纠正；后续 producer 修正归 B37。
- 当前 HEAD `a60c9024` 的确定性全门禁单批通过：后端 warnings-as-errors、前端 typecheck/lint/603 tests、sidecar release、离线 Tauri .app/.dmg/前端审计27项、xref/arch/静态扫描、I1/I2/I3、N-NARR/I-CACHE、task_done/next_task_check；命令、退出码和分步耗时见 `artifacts/completion-audit/20261025-1817/gate-results.json`，独立监督每10s心跳，termination success=true。本批不含真实模型调用。
- 静态扫描19项通过、gitleaks原始检查1项失败，只有2条历史处置（Pencil元数据 false_positive、历史 ProjectGod凭据 accepted_risk），blocking=0。没有修改 baseline/dispositions 或豁免。
- 收尾发现 Strata `/api/models.loaded=null` 不能代表原生引擎已卸载：`/api/native.instances` 仍有 iq3_s ready。确认无 queued/generating 请求后，按用户授权卸载原生实例并调用 models/unload；同时卸载 LM Studio embedding。核验 `lms ps=[]`、Strata `loaded=null` 且 `instances=[]`，原始状态/回执见同证据目录。未卸载工具/删除模型文件/修改全局设置。
- 本线程协作树仅 root、无 pending/in_progress 子任务；不将此视为外部工具全部任务视图。工作区新增的 `tasks/next_excutor_prompt.md` 为已有外部内容，未编辑或纳入本次代码修改。

- 作者澄清资源变化为手动装载；当前模型保留给作者使用。上面的空载快照只证明当时清理成功，最终环境现有作者实例不再计作 harness 遗漏。后续原生确定性验收零真实模型调用；模型长跑须先协调单槽，不能再次卸载作者手动保留的实例。
