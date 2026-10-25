# P1-AUTHORING-DOGFOOD CP0 — canonical 10 章执行计划（runner 适配版）

状态：CP0 执行支架（预注册见 `tasks/slices/VS00D-G-GAP-RECONCILIATION.md#真实创建复验` 2026-10-25 条目）。
本文件只描述执行计划与证据口径；正式结果落
`artifacts/novel-output/p1-authoring-dogfood-2026-10-25/`，不以计划替代证据。

## 0. 批次与预算（预注册冻结，禁止事后改口）
- 一次 **canonical** 10 章级真实创作复验；真实模型 writer 调用预算 ≤40 次；单槽串行、不并发。
- **模型 probe 结论（task-80，2026-10-25 11:42）**：候选 B `qwen3.8-27b-bf16`（非 thinking，
  context 32768，`NOVEL_LMSTUDIO_TIMEOUT_MS=900000`）**有条件选定**；候选 A
  `qwen3.8-flash-next@iq4_nl` 不选（同 bug 且单次 139–163s 明显更慢）。
- **P1 GO 前置阻塞（task-81）**：A/B 两模型 100% 复现 `agent_plan_draft` 纠错死路——
  首轮缺 `authoring_intent` 被拒，纠错请求把 tools 改成 `auto` 并要求调用 `auto`，模型照做后
  产品期望 `agent_plan_draft` → `invalid_plan_tool_arguments`/`agent_plan_protocol_violation`
  → 零正文。**模型可用性不是问题；正式 dogfood 需先修 plan 可达性**（prompt 骨架/纠错），
  修复后 harness 单次受控单章验证（加载→验证→卸载）再发 P1 GO。
- 10 章预计时长（probe 的 m10 基线 12 章 14224s ≈ 19.8min/章）：**约 2.5–4.5 小时**，不含加载/
  启动；超预算/失败按预注册诚实收尾，不重跑换分。
- probe 证据：`artifacts/novel-output/p1-model-probe-2026-10-25/`（`plan.md`、
  candidate-a/b 的 app-log/llm-calls/progress）。

## 1. 启动/续跑命令（模型 probe 完成后补 provider/model/timeout）
```bash
# canonical（fresh）
DOGFOOD_ARTIFACT_DIR=artifacts/novel-output/p1-authoring-dogfood-2026-10-25 \
NOVEL_TEST_DB_DIR=tmp/dogfood-db-p1-canonical-20261025 \
NOVEL_LMSTUDIO_MODEL=qwen3.8-27b-bf16 NOVEL_LMSTUDIO_TIMEOUT_MS=900000 \
NOVEL_LMSTUDIO_REASONING_EFFORT=none \
bash scripts/dogfood_run.sh --provider lmstudio --chapters 10 --plan-chapters 10 --min-words 1000

# 断点续跑演练（phase1 写满 5 个已推进章后优雅退出；phase2 复用同一 DB/证据目录）
... bash scripts/dogfood_run.sh --provider lmstudio --chapters 10 --plan-chapters 10 \
    --stop-after 5
... bash scripts/dogfood_run.sh --provider lmstudio --chapters 10 --plan-chapters 10 --resume
```
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
| **B30 重编号** | 第03/04章 | 「把第03章和第04章的编号对调，内容不要动。」→ 保存到作品 | 回执 committed_mapping | 0 provider（维护能力） |
| 写作 7–8 | 第07–08章 | 首稿/续写 | | 2–4 |
| **B29 角色身份** | 设计出的配角 | 「把<角色名>改为主角，其他角色不要动。」→ 保存到作品 | receipt committed_changes / 主档案字段 | 0 provider |
| 写作 9–10 | 第09–10章 | 首稿/续写 | | 2–4 |
| 审读/导出 | — | 档案角色/结构审读；阅读模式导出全书；截图 | — | 摘要维护异步另计 |

预计真实模型调用：writer 约 14–20 次；judgment/评估/摘要约 15–20 次；总计 ≤40 writer 上限成立。
预计时长：非 thinking 快模型约 35–60 分钟；27b thinking 约 2–3 小时（以 probe 实测标定）。

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

## 5. 需 Lead/harness 确认
1) probe 选定 provider/model、`NOVEL_LMSTUDIO_TIMEOUT_MS`/等价超时、并发=1 与单槽窗口。
2) canonical 若出现诚实缺章/失败章（≤预算内重试）是否按预注册「里程碑或诚实记录失败章数」收尾。
3) strata 被选中时的 endpoint/model 与 run 命令；`iq3_s` 长文退化风险接受口径。
4) I10 盲评负责人/时机（作者指定）；AI 只产样本包。
5) resume 演练停在 5 章后二次启动是否按计划（证据记 `stopped_for_resume_breakpoint`/`resume` 轮）。
