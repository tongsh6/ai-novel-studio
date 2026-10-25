# P1-AUTHORING-DOGFOOD CP0 — canonical 10 章执行计划（runner 适配版）

状态：CP0 执行支架（预注册见 `tasks/slices/VS00D-G-GAP-RECONCILIATION.md#真实创建复验` 2026-10-25 条目）。
本文件只描述执行计划与证据口径；正式结果落
`artifacts/novel-output/p1-authoring-dogfood-2026-10-25/`，不以计划替代证据。

## 0. 批次与预算（预注册冻结，禁止事后改口）
- 一次 **canonical** 10 章级真实创作复验；真实模型 writer 调用预算 ≤40 次；单槽串行、不并发。
- **作者裁决（2026-10-25，覆盖 task-80 probe 建议）**：canonical 主模型改用 **Strata
  `iq3_s`**（不同模型；作者明确选择、接受速度优先）。依据：同模型对比受 Strata 缺
  llama-server engine 阻塞；iq3_s 实测 plan 20.59 tok/s / prose 78.11 tok/s / judge
  48.89 tok/s（机械质量合规），远快于 LM Studio 27b ~9 tok/s。
  - 风险如实保留：iq3_s 与 probe B（27b-bf16）非同模型；B28 CP4 有长文 writer 退化史
    （32k 失控低熵）→ **canonical 前必须先做单章受控验证**（plan 不再被拒、正文 >0 无失控、
    pending 候选），通过才 P1 GO；若单章退化/失控，如实失败并回报，不重跑换分。
- probe B 对照/历史（不作为 canonical 模型）：`qwen3.8-27b-bf16`（非 thinking，context
  32768，`NOVEL_LMSTUDIO_TIMEOUT_MS=900000`）曾有条件选定；A `qwen3.8-flash-next@iq4_nl`
  不选（更慢且同 bug）。probe 证据：`artifacts/novel-output/p1-model-probe-2026-10-25/`。
- **P1 GO 前置阻塞（task-81，已修 `0897d776`）**：A/B 曾 100% 复现 `agent_plan_draft`
  纠错死路（首轮缺 `authoring_intent`、纠错 tools 变 `auto` → `invalid_plan_tool_arguments`
  → 零正文）。模型可用性不是问题；修复后由 harness 单章受控验证（load→verify→unload），
  通过后再发 P1 GO。
- 时间/预算：作者裁决后 iq3_s 预计明显快于 LM Studio 27b 的 2.5–4.5h 对照；**不设 2.5–4.5h
  为硬预算，canonical 记录实测时长与 writer 调用数**（writer ≤40 仍为上限）；超限/失败按预注册
  诚实收尾，不重跑换分。
- **模型生命周期（用户硬约束）**：Strata 模型由 **harness 负责 load/unload（单实例）**；
  canonical 结束由 harness `POST /api/models/unload` 并验证 `loaded=null`。runner/script
  **不加载任何模型**（脚本仅保留 LM Studio teardown：任何 run 结束/失败/中断执行
  `lms unload --all`，并记录 `lms ps` before/after；Strata 不由脚本卸载）。

## 1. 启动/续跑命令（canonical = Strata iq3_s）
```bash
# canonical（fresh；Strata 模型由 harness 预先加载，runner/script 不加载）
DOGFOOD_ARTIFACT_DIR=artifacts/novel-output/p1-authoring-dogfood-2026-10-25 \
NOVEL_TEST_DB_DIR=tmp/dogfood-db-p1-canonical-20261025 \
NOVEL_STRATA_MODEL=iq3_s NOVEL_STRATA_ENDPOINT=http://127.0.0.1:47831/v1 \
bash scripts/dogfood_run.sh --provider strata --chapters 10 --plan-chapters 10 --min-words 1000

# 断点续跑演练（phase1 写满 5 个已推进章后优雅退出；phase2 复用同一 DB/证据目录）
... bash scripts/dogfood_run.sh --provider strata --chapters 10 --plan-chapters 10 \
    --stop-after 5
... bash scripts/dogfood_run.sh --provider strata --chapters 10 --plan-chapters 10 --resume
```
- script `--provider strata` 预检：先请求 `${NOVEL_STRATA_ENDPOINT:-http://127.0.0.1:47831/v1}/models`
  并检查 `iq3_s`；**未加载/endpoint 不可达时直接失败退出**（2026-10-25 实测
  `http://127.0.0.1:9/v1` → 输出「预检失败：…/models 未返回 iq3_s」并 exit 1），不会带病启动 Tauri。
- 结束/失败/中断由 harness 负责 Strata unload（`POST /api/models/unload`，验证 loaded=null）；
  script teardown 只负责 LM Studio（用户硬约束：`lms unload --all` + `lms ps` before/after）。
- `--plan-chapters 10`：seed 有 12 章计划，canonical 只推进前 10 章；`--chapters 10` 限制本轮
  最多推进的不同章数；`--stop-after` 只用于 resume 演练（不是验收旁路）。
  诚实口径：导出/TOC 仍含 seed 的 12 章计划（后 2 章为 planned 未写），`word-count.json` 与
  `chapter-quality.md` 的 below-min/empty 观察会如实标出，不把「计划章」冒充「已写章」；
  canonical 的 10 章指**实际推进并达标**的前 10 章。
- dry-run（CP0 自检，不占模型槽）：
```bash
DOGFOOD_ARTIFACT_DIR=artifacts/novel-output/p1-cp0-dryrun-2026-10-25 \
NOVEL_TEST_DB_DIR=tmp/dogfood-db-p1cp0-dryrun \
bash scripts/dogfood_run.sh --provider slice_verify --chapters 10 --plan-chapters 10 --min-words 1
```
（dry-run 使用确定性 provider 验证 UI/帧/维护插入点/报告链路；不产文学质量结论。）

## 2. 10 章执行序列（真实自然语言入口）
| 阶段 | 章 | 作者动作（真实 UI） | 采纳/确认 | 预计模型 writer 调用 |
|---|---|---|---|---|
| 写作 1–2 | 第01–02章 | 逐章「第0X章的正文还没写，帮我写出来吧。」→ 候选→保存为章节正文 | needs_confirmation 显式确认并计数 | 2–4 |
| 角色准备 | — | 「帮我设计一个配角，后面剧情里会用到。」→ 角色候选（多候选时单选）→ 保存到作品档案 | 真实候选卡 | 1（角色设计） |
| 写作 3 | 第03章 | 首稿 | | 1–2 |
| **B28 排版修订** | 第03章 | 「把第03章正文整理一下，只调整分段和排版，不要改字句。」→ 保存修订稿 | confirmation 计数 | 1（修订 writer） |
| 写作 4 | 第04章 | 首稿/续写 | | 1–2 |
| **B28 内容修订** | 第04章 | 「把第04章正文里的一段改得更克制一些，只改这一处，其他不要动。」→ 保存修订稿 | | 1（修订 writer） |
| 写作 5 | 第05章 | 首稿 | | 1–2 |
| **resume 断点演练** | — | 停 runner（`--stop-after 5`）→ `--resume` 复用 DB/维护状态续跑 | maintenance-state 跳过已完成节拍 | 0 |
| 写作 6 | 第06章 | 首稿/续写 | | 1–2 |
| **B30 重编号** | 第03/04章 | 「把第一卷的第03章和第04章的编号对调，内容不要动。」→ 保存到作品 | 回执 committed_mapping | 0 provider（维护能力） |
| 写作 7–8 | 第07–08章 | 首稿/续写 | | 2–4 |
| **B29 角色身份** | 设计出的配角 | 「把<角色名>改为主角，其他角色不要动。」→ 保存到作品 | receipt committed_changes / 主档案字段 | 0 provider |
| 写作 9–10 | 第09–10章 | 首稿/续写 | | 2–4 |
| 审读/导出 | — | 档案角色/结构审读；阅读模式导出全书；截图 | — | 摘要维护异步另计 |

预计真实模型调用：writer 约 14–20 次；judgment/评估/摘要约 15–20 次；总计 ≤40 writer 上限成立。
预计时长：iq3_s（prose 78.11 tok/s、plan 20.59 tok/s、judge 48.89 tok/s）预计 **约 30–90 分钟纯生成**
+ 维护/重试/导出开销；以单章受控验证实测标定，canonical 记录实际总时长与调用数；
不再用 LM Studio 27b 的 2.5–4.5h 作为 iq3_s 预算，若异常超 3h 如实记录为风险不重跑换分。

## 3. B6/B7/B9 消费（CP0 适配点）
- **B6**：本旅程帧判定收口到 `classifyJourneyFrame(frame, ctx)`（分类一次返回判别联合），
  章节产出/采纳结算/覆盖确认/目录投影/增量计划/维护候选全部用 `waitForJourneyKind` + 穷尽
  `switch`（default `assertNever`）。契约来源注释指向 `frontend/src/lib/socket.ts`
  （AgentRunStateData/TurnResult/AuthorActionResult）与 `agent_run_server.ex no_progress_stopped?`。
- **B7**：章节请求改自然作者短句（去掉「根据已采纳章节计划…保持为待采纳草稿」四子句）；
  续写/扩章/维护同样自然句，不塞产品内部术语。
- **B9**：所有 `needs_confirmation` 记录 `confirmation_decisions[]`
  （kind/decision=confirm|skip/target/reason_codes），summary 出
  `confirmation_counts{confirmed,skipped,by_kind}`；意外 continuation 覆盖确认按 skip 记录并走
  失败重试，不盲确认。空章/重复段观察器解析最终导出分节，输出
  `empty_chapters`/`duplicate_paragraphs` 到 `chapter-quality.md`/`continuity-report.md`/`summary.json`。
- **resume**：`maintenance-state.json` 持久化已完成维护节拍；`--resume` 跳过已完成节拍，
  避免二次改号/角色反转；run-metrics/progress 追加式不覆盖历史轮。

## 3.5 CP0 slice_verify dry-run 结果（2026-10-25，不占模型槽）
- 结果：**PASS**；证据 `artifacts/novel-output/p1-cp0-dryrun7-2026-10-25/`
  （summary/word-count/chapter-quality/continuity-report/export/progress/run-metrics/
  maintenance-state/lms-ps-*）。
- 10 章写作：前 10 章各推进 1 轮（deterministic 37–157 有效字/章）；后 2 章为 seed 计划
  未写，报告如实标 empty；空章观察 2（第11/12章），重复段 0。
- 维护组合 **5/5 完成（每类 attempts=1）**：
  - `design_character`（配角候选，多候选中选 1 采纳）；
  - `format_revision` 第03章（37→37，deterministic format_only 不增删字）；
  - `content_revision` 第04章（37→37，deterministic 无显式替换词，链路/采纳已验）；
  - `chapter_renumber` 第03/04章对调（candidate mapping 2 条 from_seq3→4/4→3，采纳 receipt）；
  - `character_role_revision`（设计出的配角 `SUPPORTING→PROTAGONIST`，主档案字段非记忆）。
- B9：confirmation_counts confirm=0/skip=0（deterministic 未触发高风险确认路径；代码分支
  已单源接入并有界记录）；recovery_decisions=16 次（均为正常 toc_projection）。
- resume 演练（`p1-cp0-dryrun8-resume-2026-10-25/`）：phase1 `--stop-after 5` 优雅退出
  （已完成 design/format/content 三拍，artifacts 落盘）；phase2 `--resume` 复用 DB/证据，
  `resume_completed_beats` 跳过已完成三拍、继续第06章+renumber+role，最终同 summary（10 章
  达标、导出成功）；两阶段结束均 `lms unload --all` 且 `lms ps` 为空。
- dry-run 迭代中修复：维护候选等待把 `prose_ready` 也算候选；重编号改为「第一卷的第03/04章
  编号对调」以匹配确定性判断口径；维护等待对误路由/失败快速失败（不再 30 分钟盲等）；
  输入/发送/确认全部有界超时+现场截图/页面文案取证；seed 增加 env 门控
  `P1_SEED_PLANNED_VOLUMES=1`（仅 dogfood launcher 打开，避免改变其它复用 seed 的场景）。
- 失败批次保留：`p1-cp0-dryrun2-stuck-batch-*`、`p1-cp0-dryrun3-stuck-batch-*`、
  `p1-cp0-dryrun6-misroute-batch-*`（分别对应输入等待/维护误路由盲等根因迭代）。

## 4. 证据与度量（milestones §8）
- `summary.json`：字数/章数/达标章、maintenance 结果、confirmation 计数、错误/重试分类、
  run duration、resume 标记、provider/model、质量观察。
- `word-count.json`：每章有效字数/审计状态/短章；`chapter-quality.md`：空章/重复段/维护动作；
  `continuity-report.md`：续写上下文、缺章/重复/漂移、盲评样本指引。
- `export/` 最终 Markdown；`progress.jsonl`/`run-metrics.jsonl` 追加；Tauri/WS/app JSONL/
  llm-calls/截图/DB 快照。
- 度量分类：错对象/错绑、越权/未确认写入、虚报、误路由、重试率、缺章/重复/漂移、人工改稿负担；
  模型语义与产品状态链分开。
- I10 盲评：本 CP0 只准备可盲评样本包；需作者指定负责人/时机，AI 不代签。

## 4.5 维护补验计划（task-87，B33 判断路由修复后）
canonical（2026-10-25）已如实记录：maintenance 5 拍仅 format_revision + chapter_renumber 成功，
design_character（5 次 wrong-route route→reply）、content_revision（4 次 agent_awaiting_author）、
character_role_revision（依赖 design 未执行）失败；**不重跑 canonical、不换分**。B33 修复后只做
scoped 维护补验，不整批重写 10 章：

1) **先 slice_verify dry-run 验证 replay 模式**（不占模型槽）：用 canonical 证据目录 + DB 的**副本**
   （避免污染 canonical 原始证据），脚本 dry-run 验证 runner 的 maintenance-only 路径、候选/采纳/
   summary 字段：
   ```bash
   cp -R artifacts/novel-output/p1-authoring-dogfood-2026-10-25 /tmp/p1-canonical-copy
   cp -R tmp/dogfood-db-p1-canonical-20261025 /tmp/p1-canonical-db-copy
   DOGFOOD_ARTIFACT_DIR=/tmp/p1-canonical-copy NOVEL_TEST_DB_DIR=/tmp/p1-canonical-db-copy \
   DOGFOOD_MAINTENANCE_ONLY=1 DOGFOOD_MAINTENANCE_RETRY=design_character,content_revision,character_role_revision \
   bash scripts/dogfood_run.sh --provider slice_verify --resume --plan-chapters 10 --min-words 1000
   ```
   （dry-run 仅验支架，不产真实维护结论；同一 DB 副本内已有章节事实。）
2) **真实模型 scoped 维护回放**（等 B33 修复 + Lead GO；harness 加载 Strata `iq3_s`，单次）：
   同样使用 canonical 证据/DB 的**副本**，`--provider strata`，只回放三拍：
   `design_character,content_revision,character_role_revision`；不写章节、不导出整书（可复用已有
   export），结束后证据单独落 `p1-authoring-dogfood-2026-10-25-maintenance-replay-<date>/`，
   canonical 原始目录不改。
   ```bash
   DOGFOOD_ARTIFACT_DIR=<canonical-copy> NOVEL_TEST_DB_DIR=<canonical-db-copy> \
   NOVEL_STRATA_MODEL=iq3_s NOVEL_STRATA_ENDPOINT=http://127.0.0.1:47831/v1 \
   DOGFOOD_MAINTENANCE_ONLY=1 DOGFOOD_MAINTENANCE_RETRY=design_character,content_revision,character_role_revision \
   bash scripts/dogfood_run.sh --provider strata --resume --plan-chapters 10 --min-words 1000
   ```
3) 本轮 runner 措辞/消歧修复（task-87）：
   - content_revision 改为明确可执行段：`把第04章正文第一段改得更紧张，只改这一段，其他段落别动。`
     （不再用「某一段」；产品若仍澄清，runner 以作者身份补一句「就改第一段…」继续，记录
     `clarification_events`，不算失败）；
   - design_character 改为真实作者口吻：`帮我设计并保存一个后面会用到、还没出场的配角到作品档案。`
     期待 `character_seed`；若仍 reply 记录 wrong-route 失败，不造假；
   - character_role_revision 依赖 design 成功后的角色名（B29 主档案字段修订）。
4) 补验判据：design 产 `character_seed` 并采纳；content 产 prose 修订并采纳（目标第一段）；role
   产 `character_profile_revision`（`SUPPORTING→PROTAGONIST`）并采纳；澄清/误路由/失败全量记录；
   若仍失败如实回报，不改写 canonical 失败事实、不重跑换分。
5) 补验结果单独报告（replay ≠ canonical）；I10 盲评仍待作者指定。
6) **本 CP0 静态验证（2026-10-25，slice_verify，不占模型槽）**：用 canonical 证据/DB 的副本执行
   maintenance-only replay → design_character/content_revision/character_role_revision **三拍均成功**
   （design→character_seed、content→prose_fragment、role→`character_profile_revision`
   `SUPPORTING→PROTAGONIST`；clarification_events=[]），正常期拍未重写；证据
   `artifacts/novel-output/p1-cp0-maintenance-replay-dryrun-2026-10-25/`。
   该结果只验证 runner 支架/措辞/回放链路，**不替代** B33 修复后的真实模型 scoped 回放。

## 4.7 B37 等待预算/超时防重发与 detached 启动（task-100）
- **provider 预算表**（env `DOGFOOD_WAIT_<KIND>_MS` 可覆盖）：
  - `slice_verify`：input 30s / ack 30s / turn 120s / candidate 120s / adoption 90s /
    maintenance 180s / export 60s / toc 30s；
  - `strata`/`lmstudio`（真实模型）：input 120s / ack 60s / turn 360s / candidate 300s /
    adoption 180s / maintenance 300s / export 120s / toc 60s（依据 canonical-1/2/3b 实测：
    writer 90–200s、续写 197s、plan/judgment 20–40s、采纳秒级）。
  - 预算表断言（不调用模型）：`DOGFOOD_PROVIDER=strata DOGFOOD_PRINT_WAIT_BUDGETS=1 node frontend/slice-verify/dogfood-runner.mjs`。
- **turn 超时绝不重发**：等待 turn_result 超预算后只等 `DOGFOOD_LATE_RESULT_GRACE_MS`
  的 late result grace（不重发同一 instruction）；grace 失败以 `turn_timeout` fatal 退出并写
  `failure.json`；发送路径有 in-flight guard。
- **detached launcher**：`DOGFOOD_ARTIFACT_DIR=... bash scripts/dogfood_run_detached.sh start ...`
  （独立 session、pidfile/lock、preflight、heartbeat/termination）；status/stop 可不用 env，
  使用 `--artifact-dir <dir>` 或 `DOGFOOD_ARTIFACT_DIR`；stop 仅在明确终止时按 pidfile 定向。
- 验证：slice_verify `slow_turn` 故障注入只发 1 次 + `turn_timeout` fatal；page_closed/
  backend_down/action_failed/stall 均非零退出；正常 10 章+维护 5/5 PASS。

## 4.8 B37 CP4 design_character 真实作者方向/bounded 澄清（task-101）
- 首指令具体化：从章节计划确定性推导方向（`designDirectionFromToc`：下一待写章标题/seq/用途），
  写法含方向/定位/用途+命名授权+「直接生成角色主档案候选并保存到作品档案，不需要再问我」。
- 产品仍 `ask_author`：最多补 2 条**不同**具体方向/定位（含明确「设计并保存一个配角」动词，避免被
  误判为角色演化/世界设定），之后仍 ask 则 bounded 失败。
- 等待只认 `character_seed`；无关候选（`prose_ready`/`candidate_ready` 非 character_seed）忽略不采纳、
  不判整拍失败；首无关后另加 `DOGFOOD_DESIGN_UNRELATED_GRACE_MS`（slice 5s/real 30s）有界等待，
  只有无关候选 → `design_unrelated_candidate_only` bounded 失败（不无限等/不误采纳）。
- 确定性 dry-run（slice_verify）：
  - 正常 design → character_seed 采纳；
  - `DOGFOOD_FAULT_SIM=design_ask_then_seed` → 1 次具体澄清 → character_seed 采纳；
  - `design_unrelated_then_seed` → 先无关 prose_ready 忽略 → character_seed 采纳；
  - `design_unrelated_only` → bounded 失败（不采纳）；
  - 既有 10 章+维护 5/5、page_closed/backend_down/action_failed/stall 无回归。

## 4.9 B37 CP5 通用作者问题应答（task-102）
- 识别 `turn_result.author_question`（question/options{choice,free_text,recommended}/available_actions），
  与普通 `agent_run_state awaiting_author`（工具失败/无问题）区分。
- 通用 `respondToAuthorQuestion`（章/续写/维护/扩章共用）：有 options 选 recommended（无则第一个
  choice）；无 options 按动作给具体默认决策（写章/续写继续、内容修订第一段、设计用 CP4 方向、
  重编号对调、plan_expand、通用 fallback）；**不 cancel/readToc/不重发原 instruction**，只经作者问题
  卡回复；≤2 条不同回复；事件写 `author_question_events`。
- 同一问题重复 / 无问题文本 / 回复失败 → bounded `author_question_unresolved`（fatal 非零退出），
  不无限等；保留 B37 预算/watchdog/fail-fast。
- 确定性 dry-run：free-text question→回复→prose 候选 PASS（1 次 instruction/1 次回复）；options
  question→recommended「保留悬念」→prose 候选 PASS（1 次 instruction/1 次回复/555 字；test-support
  新增最小分支：author_question choice 回复后返回第01章 prose_writing，旧 fixture 分支优先级不变）；
  repeat 与 no-text → bounded `author_question_unresolved` FAIL。
- 正常 10 章+维护 5/5、page/backend/action/stall/slow_turn 故障注入无回归。

## 5. 需 Lead/harness 确认
1) ~~probe 选定 provider/model~~ **已裁决**：canonical = Strata `iq3_s`（endpoint 47831；
   harness 预加载/结束后 unload 并验证 loaded=null）；runner/script 不加载模型。
2) **单章受控验证 GO/通过**：plan 不再被拒、正文 >0 无失控、pending 候选；通过后我执行
   canonical 10 章；若退化/失控如实失败不重跑换分。
3) canonical 若出现诚实缺章/失败章（≤预算内重试）按预注册「里程碑或诚实记录失败章数」收尾。
4) I10 盲评负责人/时机（作者指定）；AI 只产样本包。
5) resume 演练停在 5 章后二次启动是否按计划（证据记 `stopped_for_resume_breakpoint`/`resume` 轮）。
