# B34 作者意图语料与验证覆盖（stage 运行日志 2026-06 起）

- 状态：**doing / CP0 完成（2026-10-25，语料 146 turn→98 去重作者原话，覆盖缺口矩阵已出）；CP1/CP2 完成（2026-10-25，契约冻结+确定性 fixture/测试/场景草案）**；CP3 实模 scoped 验证待后。
- 类型：验证体系/意图覆盖（不新增产品能力；把真实历史作者意图沉淀为可回归的验证资产）
- 来源：`log/llm-calls/stage/*.jsonl`（2026-06-17 起，23 文件约 13MB）+ `log/app/stage/*.jsonl`（约 5.2MB）；另 P1 canonical/实模证据
- 关联：B26 单调用判断协议、B27 任务语义/调用矩阵、B33 动作意图有界纠错、P1-AUTHORING-DOGFOOD、D15

## 1. 目标

1. 从 stage 历史日志抽取**真实作者输入**（作者原话）与系统实际判断/执行结果（frame/action/capability/对象/结果）；建立意图分类与频次。
2. 与当前验证覆盖对照（`slice_verify` 判断 fixture、B26/B27 语义案例、AU/验收场景、B33 复验案例集），输出**覆盖缺口矩阵**。
3. 把高频/高风险真实意图沉淀为验证资产：确定性 fixture/test-support 分支、验收场景用例、真实模型 scoped case；不把日志做成一次性报告。
4. 只读分析历史日志，不改历史证据；不引入平行 harness/知识体系。

## 2. 日志事实与抽取口径（CP0）

- 格式跨版本：6 月为旧 planner frame JSON；7–8 月出现 profile router/判断器；10 月为 B26/B27 后新协议；抽取器需按版本兼容，不硬编码单一年份格式。
- 作者输入优先取 prompt 中 `## 作者输入` 块；无该块时取最后一条 user content 的短文本（≤阈值）并标注来源类型。
- 系统结果从 llm-call response（frame_type/action/capability/tool call）与 app 日志（judgment.decided/action/能力/对象）按时间/会话关联；无法关联的样本标 `outcome=unknown`，不猜。
- 去重按（归一化文本, 意图类, 结果）聚类；保留原文件/行号/时间戳溯源。
- 隐私/长度：只分析仓库内 stage 日志；长输入截断仅用于展示，语料保留必要上下文摘要。

## 3. 意图分类（初版，CP0 校准）

写章首稿/续写/重写；整章修订（排版/内容）；章节结构（重编号/增删/卷）；角色设计/改判/演化/归并；设定/伏笔/世界观；章节计划/大纲；查询（进度/主角/关系/事实）；讨论/方向探索；采纳/放弃/恢复候选；导出/审读；闲聊/元讨论；能力缺口/澄清。

## 4. CP 计划

| CP | 工作 | 证据 |
|---|---|---|
| CP0 | 日志盘点+抽取器+语料+频次+结果关联+覆盖缺口矩阵 | `artifacts/model-contracts/b34-cp0/` |
| CP1 | 冻结验证契约：意图类→期望 route/capability/ask/gap/no-write；top-N 验收用例与 fixture 规格 | slice 更新 |
| CP2 | test-support fixture/验收场景覆盖扩展 + 确定性测试；不新增产品钩子 | fixture/test 代码 |
| CP3 | 真实模型 scoped 验证（抽样意图，单槽；与 B33 复验合并或独立标注） | 模型证据 |
| CP4 | P1 复验/收口引用（验证体系覆盖报告） | 证据索引 |

## 5. 边界

- 不改产品/frontend/src/tasks；不跑整批 dogfood 换分；历史日志只读。
- 不新建平行 plans/specs/notes；语料/报告落 artifacts，验证契约落本 slice 与既有 `quality/`/fixture 体系。
- 真实模型调用仅在 CP3、单槽、有预算上限；模型生命周期用户硬约束（用完卸载；native iq3_s 常驻不额外加载）。
- 不把历史日志中的错误当 canon；只作为意图/验证样本。

## 6. CP0 记录（2026-10-25）

- 扫描 `log/llm-calls/stage` 23 文件/794 行 + `log/app/stage` 28 文件/13,297 行；解析失败 0；抽取 **146 turn → 98 条去重作者原话**（来源：`## 作者输入` 60、旧 `## 用户输入` 22、短 user content fallback 16）；覆盖 2026-06-16–2026-10-23。
- 结果关联 97/98（99%，turn_id+app 事件 ±6h 防跨周误配）；unknown 17/98（17.3%，旧 frame/planner 无 judgment 事件或 Oct stream `event_stream`）——标 unknown 不猜。
- 协议跨版本：旧两段式 frame/planner（6–7 月）→ 单调用 judgment+tools（8–10 月）→ Strata 流式（10 月）；频次跨协议合并仅代表历史需求集合，CP1 需对 2026-10 新协议单独切窗重采。
- 意图频次（去重后）：prose_write 22、world_foreshadow 14、progress_query 10、meta_acceptance 9、work_setup 8、discussion 8、plan_outline 7、other_unclassified 5、chapter_revision 3、chapter_rewrite 3、chitchat_noise 2、query_status 2、delegation 2、character_design 1、export_review 1、structure_change 1；`structure_renumber`/`character_role_revision`/`character_evolution` 本窗口为 0（窗口无 B29/B30 指令；由对应场景另证）。
- 覆盖缺口 Top（详见 `coverage-matrix.md`）：progress_query（10，HIGH，无长上下文自然语言进度问询场景）、work_setup（8，HIGH，空作品题材/起名开局无专项场景）、discussion（8，缺“讨论不误执行”专项；与 B33 gate 配对）、world_foreshadow（14，缺“设定讨论 vs 采纳”边界）、delegation/chitchat_noise/other_unclassified（9，边界负例并入 B33）。prose_write/world_foreshadow/meta_acceptance/plan_outline/chapter_revision 等已有较广覆盖（LOW）。
- 证据：`artifacts/model-contracts/b34-cp0/{corpus.jsonl,corpus-all-turns.jsonl,corpus-summary.md,taxonomy.md,coverage-matrix.md,samples/}`；脚本 `scripts/mine_author_intents.mjs`（只读可复跑）。

### CP1 验证契约（冻结，2026-10-25）

意图类 → 允许终局（deterministic 验证口径）：
1. **progress_query**：基于当前真实进度/章节事实回答（可 read-only 查询），**零候选、零写入**；不得用 memory 虚报。
2. **work_setup（空作品题材/起名）**：ask_author 澄清或 plan 类候选；**不得直接产 prose 正文**；空事实时诚实说明。
3. **discussion/方向讨论、评价写法**：reply/explore 讨论，**零候选、零写入**（B33 gate 负例：不得误纠错成 execute）。
4. **world_foreshadow 讨论 vs 采纳**：作者只问设定是否合理 → reply/explore 零候选；明确要求保存/采纳 → execute world_building/候选。
5. **delegation/chitchat_noise/其他短指代**：不得自动创建/采纳；需具体动作或澄清（ask/reply），零写入。
6. 已有覆盖（prose_write/meta_acceptance/world_foreshadow 采纳/plan_outline/chapter_revision 等）保持既有用例与优先级，不重复造。

### 2026-10 新协议窗口重采（2026-10-20 起）

- 命令：`node scripts/mine_author_intents.mjs --since 2026-10-20 --label 2026-10`；产物 `corpus-window-2026-10.jsonl`/`corpus-summary-window-2026-10.md`（不覆盖全量产物）。
- 窗口：64 turn → **39 条去重语料**；解析失败 0；结果关联 39/39（100%）、unknown 0；作者文本来源 `## 作者输入` 38 + fallback 1。
- 协议/模型：单调用 judgment+tools（10 月后段 Strata 流式 `event_stream`）；模型 iq3_s 24 / deepseek-flash 9 / qwen3.8-flash 9。
- 意图频次：meta_acceptance 7、plan_outline 6、world_foreshadow 5、prose_write 4、work_setup 3、chapter_rewrite 3、chapter_revision 2、progress_query 2、delegation/query_status/export_review/structure_change/discussion/other/chitchat 各 1。
- 结果分布：execute 18、reply 12、plan 3、await_author 2、explore 1、adopt accept 3。
- 对比全量：旧协议噪声消失（unknown 17.3%→0）；prose_write 占比下降、meta_acceptance/plan_outline 上升（新协议下写作判断仍可能被 meta/plan 吞，CP1/B33 复验需关注，不在本窗口下结论）。

### CP1/CP2 fixture 清单（进入 task-91）

- `author-progress-question-in-writing-context`（长上下文 3 章计划+部分已写；问“第几章写到哪/执行完了么/草稿在哪”→ 基于事实回答、零候选零写入）。
- `author-new-work-genre-and-title`（空作品“写一本玄幻/帮我起名”→ plan/ask，不直接 prose）。
- `author-direction-discussion-without-execute`（“继续聊这个方向/这段写法如何”→ reply 零候选零写入；与 B33 gate 正例配对）。
- `world_foreshadow discussion-vs-adopt` 边界（讨论不产候选；明确保存才产 world_rule 候选）。
- delegation/noise 边界负例（不自动执行/采纳；并入 B33 负例集）。
- 2026-10 新协议单独切窗重采频次（CP1 实施时先重跑抽取器加窗口过滤，频次单独报告）。

### CP1/CP2 实施记录（2026-10-25，task-91）

**实现范围**：只改 test-support/测试/场景清单与本文档；不改产品/frontend/src/tasks 之外文档；无新增产品钩子/testid；无真实模型调用。

**fixture 实现**（`apps/novel_agent/test/support/provider/slice_verify.ex`）：
- `progress_query_prompt?/1` + `judgment_progress_query_result/1`：从判断 prompt 的 `## 章节列表（共 N 章：已写 M 章，计划中 K 章）`（或正文统计）读事实回答；无章节事实时诚实说明不猜；零 tool_calls/零候选。
- `work_setup_prompt?/2` + `judgment_work_setup_result/1`：空作品（无已写章）的起名/开始创作/题材开场 → ask_author（题材/方向/书名），不产 prose。
- `discussion_prompt?/1` + `discussion_reply/1`：继续聊方向/写法讨论/不要写正文 → reply，零候选；与 B33 gate 负例配对。
- `world_foreshadow_discussion_prompt?/1` / `world_foreshadow_adopt_prompt?/1`：讨论（继续聊/是否合理/评价）→ reply 零候选；明确“保存为/采纳该/新增伏笔…”→ execute world_building（仍为待采纳候选）。
- `delegation_noise_prompt?/1`：短确认/噪声（同意你的路径/kkk/数字/收到）→ reply，不自动 execute/adopt；零写入。
- 分支放在既有 B28/B29/B30/AU09 判断分支之后、generic regular 之前，旧分支优先级不变；未改产品协议字段。

**测试证据**：
- `apps/novel_agent/test/novel_agent/provider/slice_verify_test.exs`：新增 `SliceVerifyB34AuthorIntentFixtureTest` 5 组（progress_query/work_setup/discussion/world_foreshadow 边界/delegation-noise），全绿；既有 45 组不回归（50/0）。
- `apps/novel_application/test/novel_application/b34_author_intent_fixture_test.exs`：5 组真实链路（fixture→`JudgmentProtocol.request_judgment`）：
  - progress_query：`reply` + 章节统计事实 + `candidate_directions == []`；
  - work_setup：`await_author` + 具体问题，无 capability/prose 候选；
  - discussion：`reply` + 零候选，B33 gate 不触发（`provider_call_count == 1`）；
  - world_foreshadow：讨论 reply 零候选；保存请求 execute world_building；讨论零候选；
  - delegation/noise：reply + 零候选/零 capability。
- 回归：B28/B29/B30/AU09 判断 fixture 全量绿；application 全量见下方验证记录。
- 场景清单：`quality/acceptance/scenarios/b34-author-intent-corpus-fixtures.yml`（**draft / tier deterministic / default_provider slice_verify**；未注册 `scenarios.yml`，不注册真实模型 nightly）；README 已索引。

**覆盖前/后矩阵（意图类 × 频次 × fixture 状态）**：

| 意图类 | 全量频次 | 2026-10 窗口 | 覆盖前 | 覆盖后（确定性） | 状态 |
|---|---:|---:|---|---|---|
| progress_query | 10 | 2 | **无**（HIGH） | slice_verify progress fixture + app 链路测试 | 已覆盖 |
| work_setup | 8 | 3 | **无**（HIGH） | slice_verify work_setup fixture + app 链路测试 | 已覆盖 |
| discussion | 8 | 1 | 普通对话/多轮场景，缺“讨论不误执行”专项 | slice_verify discussion fixture + app 链路测试（B33 gate 负例） | 已覆盖 |
| world_foreshadow | 14 | 5 | 采纳场景多，缺讨论 vs 采纳边界 | slice_verify discussion/adopt 分支 + app 链路测试 | 边界已覆盖 |
| delegation | 2 | 1 | **无**（MED） | slice_verify 短确认/噪声负例 + app 测试 | 已覆盖 |
| chitchat_noise | 2 | 1 | **无**（MED） | 并入 delegation/noise fixture | 已覆盖 |
| other_unclassified | 5 | 1 | 无 | 按 CP0 建议不新增 fixture（短指代依赖上下文，保留语料溯源） | 不新增（有意） |
| prose_write / meta_acceptance / plan_outline / chapter_revision / chapter_rewrite / query_status / export_review / structure_change / character_design | 已有较广覆盖 | — | LOW | 保持既有用例/优先级，不重复造 | 保持 |

**2026-10 窗口频率说明**：见本 slice “2026-10 新协议窗口重采”节；窗口 39 条去重语料中 progress_query 2、work_setup 3、discussion 1、world_foreshadow 5、delegation 1、chitchat_noise 1；旧协议 unknown 噪声消失，但 prose_write 占比下降、meta_acceptance/plan_outline 上升（仅频次事实，误路由结论由 B33 CP4 复验）。

**验证记录**：
- `apps/novel_agent`: slice_verify fixture 50/0；全量 **290/0**（p1plan 隔离分区）。
- `apps/novel_application`: B34 fixture test 5/0；全量 **950/0**（p1plan）。
- `mix compile --warnings-as-errors` 零警告；`mix format --check-formatted` 通过；touched credo 0 issue；I1/I2/I3 全绿（p1plan）；`bash scripts/ai_static_scan.sh --top 10 --quick` 本改动文件 0 findings（余既有 gitleaks/task-done manifest 流程项）。
- 未关闭：CP3 真实模型 scoped 验证（lifecycle 可用新增案例）；CP4 覆盖报告引用。


## 7. CP1/CP2 实施记录（2026-10-25，`0f1eeee9`）

- `slice_verify` 判断 fixture 按真实语料 wording 增补：progress_query 按章节统计回答零候选；work_setup 空作品 ask_author（题材/方向/书名）不产 prose；discussion 讨论 reply 零候选（B33 gate 负例）；world_foreshadow 讨论 reply / 明确保存才 execute world_building；delegation/chitchat_noise reply 不自动执行/采纳。
- 测试：`SliceVerifyB34AuthorIntentFixtureTest` 5 组 + application `b34_author_intent_fixture_test` 5 组真实链路；agent 290/0、application 950/0、全后端 2225/0；compile -Werror/format/credo/enum 绿。
- 场景清单：`quality/acceptance/scenarios/b34-author-intent-corpus-fixtures.yml`（deterministic draft，未注册 nightly；README 已索引）。
- 覆盖前后矩阵：progress_query/work_setup/discussion/world_foreshadow 边界/delegation-noise 均从缺口→确定性覆盖；other_unclassified 按 CP0 建议不新增（短指代依赖上下文）；prose_write 等既有保持。
- 2026-10 窗口频次（aux）：64 turn→39 条去重；meta_acceptance 7/plan_outline 6/world_foreshadow 5/prose_write 4/work_setup 3/chapter_rewrite 3/chapter_revision 2/progress_query 2；unknown 0（旧协议噪声消失）。
