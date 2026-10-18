# Q1b 真实模型多轮存档复验

- 状态：BIZ-06 已闭环（2026-10-18）。十轮实模证明数据/动作链，最后四轮实模证明上下文指代、显式采纳和真实完成回执；具体版本边界见文末。
- 下方旧任务表和早期调用属于历史基线；BIZ-06 最终验证与保留限制见文末。
- 范围：NEXT Q1b / Journey C10；复验 D8 症状，消费已完成的 Q3d 与 DS02。
- 前置：DS02 已提交 `864eebc1`；此前 1510 后端/461 前端、两场景、四项不变量及完整扫描通过。

## 开工检查

1. Contract：ADR-0027、七态 AdoptionStatus、作者字节来源与采纳契约。
2. Invariant：原文字节与来源不变；作者采纳前不入档；恢复与真实采纳状态一致。
3. Boundary：外部 driver → Frontend → Channel → Application → 真实 Provider / Persistence；首跑发现未启用来源字段阻断普通回复，追加 JudgmentProtocol 分支校验修复；其他生产边界不改。
4. Consumer：真实工作台作者及 quality_accept 验收入口。
5. Proof：四次模型 HTTP 2xx、网络帧、日志、截图、只读隔离库事实与两次追问原话语义核查。
6. Acceptance Driver：`q1b-live-archive-roundtrip`，仅外部脚本操作真实页面；不注入结果或写夹具，不加产品验收钩子。
7. Exploration：无新要素物化；读取既有 pending/resolved 与作者原文，采纳事实通过现有探索面可达。

## 任务清单

| 任务 | 状态 | 证据 / 说明 |
|---|---|---|
| 核对当前真实模型与隔离环境 | done | localhost:1234 已加载 qwen/qwen3.8-27b；未安装或切换模型；当前无 DeepSeek 环境凭证 |
| 外部场景驱动与真实 provider 证据门禁 | done | 场景 manifest 及 driver 已接入，禁止确定性替身 |
| 真实页面四轮与采纳 / 刷新验证 | done | 稳定开盖后四轮及八次模型 HTTP 200；原文字节/来源、零提前写入、唯一 CONFIRMED、刷新状态均通过 |
| 未登记原文时来源字段不参与判定 | done | 15 项协议测试、1512 项后端全量及 q3d 页面回归通过；Qwen 实模首轮已正常返回普通回复 |
| 模型原话与事实对账、登记结果 | done | 采纳前明确未入档且需确认；采纳后明确已保存、无需重复存档或再次采纳，与实际事实一致 |

## 决策日志

- 2026-10-08：用户继续后先提交 DS02，再沿唯一队首 Q1b 复验。使用本机已加载 Qwen；历史 D8 的 DeepSeek 不在本次模型范围。独立测试数据库与端口，原 stage 数据不修改。
- 2026-10-08：外部自动化启动 Tauri 并驱动同一 App/WorkspaceChat 页面；不是原生 WebView 内部驱动，不把这份证据扩展到平台 API 验收。

- 2026-10-08 首跑：Qwen 正确判定 reply / 不生成，但可空字段返回字符串 null。新增 author_source_in_context 校验未按 author_content_registration 分支区分，导致普通回复重试后失败。修复按业务分支清空未启用来源，登记时白名单保持严格；不是为某个占位字符串加例外。失败日志及截图保存在 `artifacts/slice-verify/q1b-live-archive-roundtrip-tauri-lmstudio-first-failure/`。

- 2026-10-08 第二跑：协议修复后首轮两次模型调用成功（40s + 108s），Interaction 与 AgentRun 已 completed；外部驱动最后收到流式叙事和 heartbeat，终态回包前 Tauri/Vite 进程退出，页面显示同步离线。调试外部 Node 保存现有帧并提前结束无进展等待为失败，未修改产品状态。网络帧与截图保存在 `artifacts/slice-verify/q1b-live-archive-roundtrip-tauri-lmstudio-frontend-exit/`；下一跑使用独立 PTY，并由外部 driver 监测前端 HTTP 存活。

- 2026-10-08 第三跑：独立 PTY 下前后端均已启动，01:48:55 macOS 合盖休眠，01:49:31 温控休眠持续 737 秒，02:01:48 唤醒；场景在 900 秒首轮等待上限后失败。系统电源日志与页面/网络证据保存在 `artifacts/slice-verify/q1b-live-archive-roundtrip-tauri-lmstudio-host-sleep/`。这是运行环境中断，不是四轮存档通过；已请用户选择环境稳定后重跑或先交付修复。
- 验收脚本退出会自动重置隔离库，前两份 DB 备份实际为清理后的空库，已按 post-cleanup-empty-db 命名，不作为现场事实证据；数据库状态以当时查询和 backend SQL 日志为准。

- 2026-10-08：用户明确回复“已开盖且散热恢复，继续实模复验”。q3d 确定性真实页面兼容回归 PASS；随后以同一 Qwen、原断言、独立 PTY 重跑，使用命令生命周期内的 caffeinate -i 防空闲休眠，不改电源设置。

## 恢复指引

先读 NEXT；以下实模记录属于此前版本，当前恢复点是文末 BIZ-01–04 后整批回归。性能测量已按用户要求停止。需要复跑时运行 `scripts/quality_accept.sh q1b-live-archive-roundtrip --surface tauri`，
固定已有 pnpm 10.33.0，显式指定独立 NOVEL_TEST_DB_DIR / MIX_TEST_PARTITION；真实模型调用可能耗时，
通过 live-turn-results.json 和 app/LLM 日志观察进展，不能降低断言或改为 fake provider 压绿。


## 已完成的局部验证

- `mix test`：1512 tests / 0 failures；定向 JudgmentProtocol：15 / 0。
- `mix compile --warnings-as-errors`、xref compile-connected cycles、`mix run --no-start scripts/arch_check.exs` 通过。
- I3 3/3、I1 4/4、I2 3/3、N-NARR 通过，四个不变量 driver 未改。
- 前端 typecheck / lint / test（461）通过；外部验收器 204 项通过，包含新加的真实模型缺轮、替身、无关采纳日志拒绝用例。
- `q3d-message-outcome-roundtrip --surface tauri` 确定性真实页面回归通过，覆盖跨轮来源、历史采纳状态恢复与作者采纳。
- `bash scripts/ai_static_scan.sh --top 10` 完整扫描：17 PASS / 2 既有 FAIL，3 findings / 0 touched / 0 blocking。
  剩余处置：Pencil fileToken 为 false_positive；其他分支历史 config 为 accepted_risk；ChapterSummary 嵌套为 deferred，均沿用原台账。
- 以上仅为局部及既有页面回归证据；Q1b 四轮真实模型场景以任务表和最终运行结果为准。


## 历史实模证据与边界（BIZ 修复前）

`bash scripts/quality_accept.sh q1b-live-archive-roundtrip --surface tauri` 通过。
使用已加载的 qwen/qwen3.8-27b，经 LM Studio 正常 provider 调用；四个真实作者回合共八次 HTTP 200，
未使用 fake provider、结果注入或数据写入夹具。独立 SQLite 只读查询证明采纳前 0 条、采纳后 1 条
含 nonce 的 CONFIRMED 事实；author_input 来源与原文字节严格相等，刷新恢复 canonical 状态。

模型原话对账：采纳前明确“目前还没有正式存入作品档案”，采纳后明确“已经保存了”且
无需重复存档/再次采纳；这与实际落库和 pending/resolved 状态一致。末轮可讨论方向属于
CandidateDirection，未被当成新待采纳产物或作品事实。

证据目录：`artifacts/slice-verify/q1b-live-archive-roundtrip-tauri-lmstudio/`：
`summary.json`、`live-turn-results.json`、`live-adoption-evidence.json`、`ui-state.json`、
`ui-frames.json`、八次模型请求/响应日志、四阶段及最终页面截图。
当前验证是“启动 Tauri，外部 Playwright 驱动同一真实工作台页面”；不是原生 WebView 内部驱动。
历史 D8 使用的 DeepSeek 未在本次复验，不将单模型单场景结果外推为全部模型的稳定率。

验收器收尾校准：adoption.evaluate.done 的 turn_id 绑定来源 turn 本身；派生回执可以带冒号后缀。
新增验收器最初只认可冒号派生形式，现按实际契约接受精确来源或其冒号派生，同时负例拒绝相似
前缀的其他 turn。未修改四轮 UI、字节、真实 provider 或数据库断言来压绿，204 项验收器测试通过。

### 历史观察（BIZ 修复前）

存档轮 call2 耗时 **536,689ms**，消耗 13,970 completion tokens（其中 13,646 reasoning tokens），
而真正结构输出仅约 324 tokens。四轮最终结构判定均正确，但延迟仍不适合顺畅创作。
同时存档轮 call1 叙事说“单动作执行/设定整理能力”，最终 call2 正确选择作者原文登记；
这提示两段说明与动作约束之间可能有冲突，需要测量后归因，不能仅凭一次日志断言根因。
下一项沿既有 `UA01-judgment-structured-call-reliability.md` 的 T1/T2 规则，先量化当前 Qwen 的
call2 延迟、推理量和叙事/结构一致性，再决定协议或目的模型配置方案。


## 桌面构建与收尾

- `bash scripts/build_sidecar.sh`、`bash scripts/frontend_audit.sh` 通过（27 PASS / 0 WARN，含 Tauri .app/.dmg 构建）；`bash scripts/check_design_trace.sh` 16 PASS。
- .app 内 sidecar 与当前源归档 SHA256 相等；旧生成目录保存在 `artifacts/project-analysis/q1b-sidecar-before-clean/`。
- 验收结束时 process_tree 有一次 setpgid warning，已核查 4857/5869 端口均释放，无遗留验收监听服务。
- 所有依赖锁文件未变；仅使用既有 pnpm 10.33.0 与已安装工具。收尾 worktree 检查只有主工作区。


## BIZ-01–04 后整批回归（2026-10-08）

Q3D 的确定性业务反例与传输故障矩阵已闭环；当前队首回到本任务。
沿用既有 q1b-live-archive-roundtrip 和当前模型，重点核对意图、历史原文、待采纳/已采纳事实
与刷新恢复，不恢复参数/超时对照。原有实模证据只覆盖此前版本，不能替代这一批回归。


### 当前运行（2026-10-08，代码 77bf8389）

已只读确认 LM Studio 加载 qwen/qwen3.8-27b（MLX 4bit）。使用独立分区 q1b_biz_77bf、
独立 4857/5869 端口、既有 pnpm 10.33.0 和原验收断言。仅外部证据等待窗使用 3600 秒，
未修改产品超时或模型参数。命令周期内 caffeinate -i 防空闲休眠，不改变机器电源设置。
旧实模证据备份至 `artifacts/slice-verify/q1b-live-archive-roundtrip-tauri-lmstudio-before-biz-77bf8389/`。
本轮日志为 `artifacts/project-analysis/q1b-biz-live.log`；最终按下方数据与语义分别记录结果。


### 本轮结果：数据断言通过，业务语义未通过

- 实际模型：qwen/qwen3.8-27b，四个用户回合、九次 chat/completions HTTP 200；未切换模型、
  未改推理参数、未注入结果或业务数据。`q1b-live-archive-roundtrip --surface tauri` 自动脚本 PASS。
- 数据链：资料消息持久保存；原文登记候选 body 与历史消息逐字一致、来源绑定正确；
  采纳前零作品事实，采纳后唯一 CONFIRMED；刷新恢复 canonical 状态；末轮未重复生成待采纳产物或写入作品事实。
- 状态语义：采纳前明确“还没有……尚未被采纳”；采纳后明确“已经保存了……不需要再重复保存”。
  两次回答与独立 SQLite 事实及 pending/resolved 一致。
- 登记轮首次结构输出 source/action 正确，但 frame_type=meta_discussion 与登记约束冲突；
  App 拒绝后一次纠正为 capability_gap，通过后才物化。这是受控重判，不能说九次结构输出全都合法。
- **语义反例 1**：作者首轮明确“先只记录、暂不生成候选”；模型叙事也声称不生成，但结构响应
  带三个 candidate_directions（转为设定候选、角色设计展开、雨港世界观搭建）。模型声明
  meta_discussion，App 因候选非空强转 creative_exploration，真实页面出现三张方向卡。
- **语义反例 2**：登记轮的采纳/修改/丢弃流程建议也成为方向卡，发放 choose_candidate。
  局部公开入口重放“丢弃候选”返回 accepted 和“已将「丢弃候选」设为后续创作方向”，
  没有执行真正的 discard。末轮的“只读查看作品档案”也被当作方向选项。
- 自动脚本只断言 adoption_state.pending，没有检查首轮 candidate_directions/choose_candidate。
  因此它的 PASS 只证明现有数据断言，**不能作为整个用户场景已通过的依据**。未改写 summary 压绿，
  未修改生产代码；后续须与 BIZ-05 同批补齐外部页面负例与验收断言。
- 证据：当前通用实模目录下 `01-source.png`、`02-save-request.png`、`live-turn-results.json`、
  `live-adoption-evidence.json`、`summary.json`、真实请求/响应日志；补充
  `artifacts/project-analysis/q1b-biz-semantic-review.json` 与 `q1b-biz-operation-direction-repro.{exs,json,log}`。
  操作路径重放未点击真实 UI、未调用模型或写作品事实，只作为公开入口局部证据；完整专项页面仍待补。
- 验收边界：Tauri 已启动，外部 Playwright 操作真实 App/WorkspaceChat 页面，未直接驱动 native WebView。
  旧实模基线保留在 before-biz-77bf8389 备份目录。验收结束后 4857/5869 已释放，无新增 worktree。
- 下一步：Q3D / BIZ-05，厘清仅记录约束、创作方向与操作建议的产出/动作边界；继续保护原文字节、
  来源、采纳权限与状态恢复，不转回超时参数优化。

### 本轮文档交付验证

- `mix compile`、`node scripts/next_task_check.mjs`、`node scripts/task_done_check.mjs`、`git diff --check` 通过。
- `bash scripts/ai_static_scan.sh --top 10`：17 PASS / 2 既有 FAIL，3 个已处置 finding，0 blocking，
  本轮修改文件命中 0。未修改生产实现，因此本轮没有新增静态问题修复。
- 剩余 Top 10 实为三项：Pencil fileToken 为 false_positive，继续保留扫描；其他开发线历史凭证为
  accepted_risk，轮换/吊销与历史清理由凭证所有者处理；ChapterSummary 嵌套为 deferred，下一次触及
  解析模块时抽取函数并复跑单测。详细处置见 `artifacts/static-scan/disposition.md`。
- 扫描无阻断不等于业务语义通过；BIZ-05 仍未闭环，docs-only 交付 manifest 不替代场景验收结论。

## BIZ-05 后实模复验（2026-10-18）

外部脚本补齐了首轮 candidate_directions/choose_candidate/页面方向入口均为空的断言，
登记轮也必须没有流程方向或 choose_candidate；保留原文字节、来源、采纳前零写入、
采纳后唯一 CONFIRMED、刷新恢复与四轮真实 provider 证据要求。没有降低原断言。

本机模型状态与运行边界：

- 开始时已加载 qwen/qwen3.6-35b-a3b。首轮叙事 HTTP 200，结构调用 300,005ms 超时；
  同参数重试的叙事仍成功，结构调用随后 HTTP 400 terminated。只读模型状态确认加载模型
  已换为 qwen3.8-flash-next@q2_k，不能将中断样本作为 BIZ-05 语义结论。
- 用户明确确认当前 Flash Next Q2 稳定、授权继续，随后以该模型重跑。外部等待窗 3600 秒，
  原有 provider timeout、推理参数、逐轮 UI 断言不变；独立分区 biz5_flash、端口 4957/5969。
- 原 2026-10-08 样本备份为 `q1b-live-archive-roundtrip-tauri-lmstudio-before-biz5-486ce367/`；
  两个 Qwen 3.6 未完成样本分别保留为 `*-biz5-qwen36-timeout/`、`*-biz5-qwen36-terminated/`。
- 当前运行日志：`artifacts/project-analysis/biz5-live-flash.log`；证据仍落现有通用实模目录。
  四轮已完成；详见下方最终结果。

### Flash Next Q2 最终结果与边界

- 四回合、九次 HTTP 200，模型均为 qwen3.8-flash-next@q2_k。原文登记的首个结构判断
  触发一次 operation_conflict 纠正，合规后才物化；不是九次结构判定初次均合法。
- 首轮 meta_discussion 且方向/产物/动作均为空；登记轮 capability_gap，只有一份原文候选
  及 accept/discard/edit_then_accept；采纳前后两次 question_answer 均无方向或新候选。
- 候选正文与历史原文字节一致、来源精确绑定；采纳前零事实，采纳后唯一 CONFIRMED；
  刷新后待办清除，末轮明确已保存且不需要额外入档操作。BIZ-05 两项反例均通过。
- 外部脚本 PASS 已与四轮回复、帧、截图及持久化结果交叉核对。证据：通用实模目录的
  summary.json / live-turn-results.json / live-adoption-evidence.json / 四张截图，以及
  `artifacts/project-analysis/biz5-semantic-review.json`。Tauri 已启动，Playwright 驱动真实页面，
  未直接驱动 native WebView；只覆盖本次模型与场景。

### 下一项 BIZ-06：已有候选的引导与处理（待场景核查，P2）

第三轮正确回答“尚未采纳”，但又主动建议“重新登记一条新的待采纳候选”。第四轮正确
回答已保存；当前四轮没有重复候选或写入，尚未提交第三轮提出的“重新登记”指令，不能
声称该分支已经发生重复写入或已经验证安全。

后续沿 AU-02 / AU-05 / AU-09 与 ADR-0027，核对“继续讨论 / 修改现有候选 / 放弃 /
重新提出创作要求”如何引用同一对象、何时确实需要新版本，并验证 AI 的引导与真实可用动作一致。
先从本次真实语义反例进入，不做超时参数优化，也不新增通用义务账。

### BIZ-06 开工设计（2026-10-18，用户确认对话直接执行）

- Contract：判断① execute 下增加 revise_pending_artifact / discard_pending_artifact，
  pending_artifact_ref 必须引用当前作品/会话的实际待采纳对象。修订复用既有创作工具、
  Orchestrator、TentativeArtifactSet.revision_base 与作者采纳；放弃复用 AdoptionWorkflow。
- Invariant：原稿保留、新修订 tentative 且 Provider 字节绑定；放弃不写 canon；同来源
  pending/accepted 不重复登记，全部放弃后可重新提出；不存在、已处置、跨会话对象不执行。
  “修改”不等于“修改后采纳”，旧 instruction 不能被拼到正文后冒充已修改的内容。
- Boundary：Application 判断、候选流程、状态读取与写回；既有 Agent 创作工具执行边界；
  Web/Frontend 复用当前主入口和产物动作，不引入数据库实体、通用义务账或独立 UI 流程。
- Consumer：WorkspaceChat 自然语言输入、真实修订候选卡、原有作者动作与刷新恢复。
- Proof：协议及公开流程测试、对象绑定/歧义/失效、修订/放弃/重新登记、来源与刷新；
  全量工程检查、I1/I2/I3/N-NARR、桌面构建与统一静态扫描。
- Acceptance Driver：q1b-candidate-lifecycle 外部脚本通过真实页面操作上述全链，
  同时保留实模语义复验。只在 test/support 注入故障，不新增产品验收钩子。
- Exploration：修订元数据与实际内容同批投影到 interaction_state 和 session_adoptions；
  已修改后保存的正文优先于历史 items，来源关系用于登记去重但不冒充 Provider 内容来源。

### BIZ-06 实现与页面证据

用户确认“AI 直接生成修订候选或执行放弃，修订仍需作者采纳”后，新增
`PendingArtifactWorkflow`；判断绑定目标后独立执行，执行前复核当前活动会话、持久待办和预算。
实际创作工具由目标类型选定，同批更新运行工具权限；下一步以实际工具通过 AgentRun 策略，
执行端再次核对该权限，不能借 judgment 权限调用创作工具。
修订复用既有创作工具和 Orchestrator，原稿保留，新稿保持 Provider 字节与待采纳状态；
放弃复用现有动作检查和 AdoptionWorkflow，不写作品事实。不存在/历史/跨作品目标不能执行。

修订的 registration_source_ref 仅关联登记来源，revision_of 指原稿；不替代实际内容来源。
同来源还有待采纳或已采纳版本时禁止重复登记，全部放弃后允许新身份重新登记。
已编辑后保存的正文进入状态摘要及探索面；模型纠正重复登记或无效目标时必须提供新的、
可验证来源的回复，不能复用未执行的旧承诺。原生工具叙事明确绑定 author_narrative 或旧 author_reasoning 字段。

删除旧 instruction 拼接入档逻辑，全文编辑才可“修改后保存”。持久待办检查阻止另一视图
放弃后旧编辑复活候选；保存失败保留编辑全文与弹窗。没有修改依赖、超时或模型参数，
没有生产验收开关、隐藏 DOM hook 或验收 Provider 注册。

外部脚本均经实际 App/WorkspaceChat 输入/点击，启动 Tauri 后由 Playwright 操作相同真实页面；
这些证据不等于直接驱动 native WebView。三个确定性场景已通过：

| 场景 | 实际操作及结果 | 证据目录 |
|---|---|---|
| q1b-candidate-lifecycle | 十轮：登记/重复登记、修订、分别放弃原稿及修订稿、重新登记、编辑后采纳和刷新状态；仅显式采纳后有一条 CONFIRMED | `artifacts/slice-verify/q1b-candidate-lifecycle-tauri/` |
| q1b-candidate-revision-adoption | 单独点击修订稿保存，实际保存模型修订全文，原稿仍待采纳 | `artifacts/slice-verify/q1b-candidate-revision-adoption-tauri/` |
| q1b-candidate-stale-modal | 两个真实视图，放弃后旧编辑提交拒绝，编辑全文和错误提示保留，零事实写入 | `artifacts/slice-verify/q1b-candidate-stale-modal-tauri/` |

实现入口：`apps/novel_application/lib/novel_application/pending_artifact_workflow.ex`；
核心保护测试：`apps/novel_application/test/novel_application/pending_artifact_workflow_test.exs`、
JudgmentProtocolTest、TurnInteractionServiceTest、AgentNarrativeSourceTest。
外部驱动和证据判定仍在 `frontend/slice-verify/{external-ui-driver,native-tauri-verifier}.mjs`，
三项 manifest 已登记 `quality/acceptance/scenarios/README.md`，可通过 quality_accept.sh 复跑。

### BIZ-06 工程与实模复验状态

- 后端 1,545 项、前端 483 项、证据验证器 216 项通过；编译零警告、无编译依赖环、架构检查通过。
- I3/I1/I2/N-NARR 通过；sidecar 重建及 frontend_audit.sh 桌面构建 27 PASS / 0 WARN / 0 FAIL，产出 .app/.dmg。
- `bash scripts/ai_static_scan.sh --top 10` 完整复扫 17 PASS / 2 既有 FAIL、3 findings、0 touched、0 blocking。首轮新增的函数嵌套/复杂度和 alias 顺序已修；验收器追加测试导致的 manifest 过期已重生成关闭，不登记豁免。
- 剩余 Top 10 实为三项：Pencil fileToken 为 false_positive（继续保留扫描）；其他开发线历史凭证为 accepted_risk（原所有者负责轮换与历史处理）；ChapterSummary 嵌套为 deferred（下次触及解析器时处理）。见 `artifacts/static-scan/disposition.md`。
- 两项真实页面兼容回归 `q3d-candidate-semantics`、`q3d-long-session-adoption-state` 通过；既有方向/产物动作和跨分页待办未退化。
- 实模使用用户已确认的 qwen3.8-flash-next@q2_k；第一次在第三轮 Provider 调用超时，失败证据保留
  `artifacts/project-analysis/biz6-first-live/`。第二次第三轮同时违反操作帧与重复登记条件，校验先纠正呈现帧、再因重复登记拒绝；
  未多写候选或作品事实，但流程未通过。已将真实登记状态校验提前，一次纠正关闭重复登记并
  由模型重写一致回复，未增加纠正次数；双重矛盾单测已覆盖，第二次证据保留 `artifacts/project-analysis/biz6-second-live/`。
  第三次在第二轮遇到系统低电量休眠：pmset 记录 16:22:54 电量 1% Low Power Sleep，
  16:32:23 接入交流电后唤醒；该次 Provider 超时不作业务语义结论。第三次证据在
  `artifacts/project-analysis/biz6-third-live/`，电源日志 `biz6-power-events.log`。
  第四次恢复供电后，在执行边界复核中发现修订步骤仍声明 judgment 而非实际创作工具；
  主动停止旧版本运行并保留 `artifacts/project-analysis/biz6-fourth-live/`，不作通过样本。
  已补齐实际工具权限及拒绝测试，完整生命周期和修订采纳页面重跑通过。
  第五次通过了前三轮，修订工具与目标引用也正确，但新建设定模板把改名过程写进正文，
  导致旧名字残留，原断言拒绝；证据保留 `artifacts/project-analysis/biz6-fifth-live/`。
  现改为消费既有 CreativeRequest.revision：设定修订沿用原稿形态，角色/大纲同步接收修订要求；
  修改过程放 rationale，不在应用端修补 Provider 字节。局部模板测试与修订采纳页面通过。
  此次还发现被主动终止的旧 Node 验收驱动遗留并向共用日志写 stderr；已让 cleanup 回收
  UI 驱动进程树，TERM 中断实测驱动与端口均释放。第五次 app/回合证据按 turn 关联，混入的旧 stderr 不作当前运行证据。
  第六次完成前三轮；修订 Provider 输出已逐字等于原稿仅替换指定姓名的结果，原稿/修订稿各一份待采纳，
  但页面在第四轮开始后离线，未收到后续事件。后端完成时间 17:09:35，公开只读快照与数据库备份保留在
  `artifacts/project-analysis/biz6-sixth-live/`。同轮存在并行构建触发 Tauri 重建，不能把该样本作为页面通过证据。
  补齐修订结果的 artifact_refs，让运行候选预算及 artifact_created 事件消费真实新产物；并明确原文登记为完整消息，
  不得在模型回复中承诺自动去掉指令前缀。该说明偏差由第六次第二轮暴露，实际字节复制一直完整。
  所有构建改为在实模之前串行完成；第七次独立复验，日志
  `artifacts/project-analysis/biz6-live-final.log`，未改 provider timeout/模型参数，也未用重试掩盖失败。
- 确定性页面通过只证明 App 边界；实模未完成前，Q1b / BIZ-06 保持未全部闭环。


### 十轮实模结果与最后收口

第七次独占运行完成十轮数据/动作验收：25 次真实 HTTP 200，全部为 Flash Next Q2；
登记两次 operation_conflict、已有来源两次 already_materialized 均在一次纠正后合规，
未放宽门禁。原文登记、版本去重、指名修订、分别放弃、重新登记、编辑后采纳与状态回答
均符合实际持久数据。采纳前零事实，最终唯一 CONFIRMED 为“岑舟”编辑版，原稿和修订稿已放弃。
证据在 `q1b-candidate-lifecycle-tauri-lmstudio/`，源文件哈希保留 `source-manifest.json`，
机器核对记录 `artifacts/project-analysis/biz6-semantic-review.json`。

这次脚本 PASS 只证明当时的数据和动作断言。人工语义复核发现，第五/七轮实际已经放弃，
最终消息却复用了模型执行前“尚未完成”的判断。已删除该覆盖，成功结果沿用现有
AdoptionWorkflow 的事实回执；模型判断仍保留在来源绑定的过程事件中，不编造模型完成回顾。
主场景同批加强了完成回执断言，旧实模样本不外推为该新断言已通过。

另补齐上下文交接：当前原话可能只有“按刚才的改”，判断已消解的 dialogue_goal 必须
分别传入实际创作 brief，不能只把原话交给缺少历史上下文的执行器。单元测试以不含新名字的
当前原话和包含具体改名目标的判断结果证明交接；不新增来源类型或绕过作者采纳。

既有 `q1b-candidate-revision-adoption` 扩展为四轮：原文登记 → 只讨论改名（无执行）→
引用上一轮要求生成修订 → 作者采纳新稿 → 对话放弃原稿并显示实际完成回执。
确定性真实页面已通过；最终真实模型四轮九次 HTTP 200 也通过，未并行 Tauri 或构建。


失败路径同批闭环：ToolTrace 在产物装配之前记录，模型/工具失败也保留可查 trace。
最终失败结果明确工具已调用、未形成可采纳新稿，不改变原稿或作品事实；运行级测试覆盖
该事实回执，不把失败调用伪装成未调用。该路径不增加自动重试或放宽预算。


### BIZ-06 最终结论（2026-10-18）

- **外部真实页面**：三个专项在最终代码上通过。修订采纳场景扩展到“只讨论 → 按上轮要求修订 → 点击采纳 → 明确放弃原稿”，原稿在作者处置前保留；双视图旧编辑拒绝且保留全文；主生命周期的两个放弃步骤均增加完成回执断言。
- **真实模型**：十轮 / 25 次 HTTP 200 证明版本/来源/处置/重新登记/编辑后采纳的数据闭环；发现的最终回执缺陷随后修复。最终代码的四轮 / 9 次 HTTP 200 专项证明：当前原话不包含新名字，传给工具的 dialogue_goal 已明确“沈砚 → 林渡”；新稿字节来自真实 Provider，采纳前无事实，采纳后唯一 CONFIRMED，明确放弃原稿后 pending=0，页面显示“已放弃该待采纳内容”。两批都使用 qwen3.8-flash-next@q2_k，不把旧十轮样本冒充新增回执断言已通过。
- **局部/工程**：后端 1,545 项、前端 483 项、证据验证器 216 项通过；编译零警告、xref/架构、I1/I2/I3/N-NARR、前端审计/设计追溯通过；最终 sidecar 与 .app/.dmg 已重建，包内 sidecar hash 与源归档一致。依赖及锁文件未改。
- **静态闭环**：`bash scripts/ai_static_scan.sh --top 10` 为 17 PASS / 2 既有 FAIL、0 blocking。已修本次函数复杂度/嵌套、alias 顺序及过期 manifest；剩余三项及处置见前节和 `artifacts/static-scan/disposition.md`。
- **证据**：`artifacts/project-analysis/biz6-context-semantic-review.json`、`biz6-semantic-review.json`；`artifacts/slice-verify/q1b-candidate-revision-adoption-tauri-lmstudio/` 含四轮记录、完整网络帧、采纳/放弃截图、模型日志及 source-manifest。
- **边界**：Tauri 已启动，Playwright 驱动同一真实 App/WorkspaceChat 页面，不是 native WebView 内部驱动；实模样本为作品设定候选，不外推所有模型/长文类型。超时、低电量休眠、主动中断、模板失败和页面离线样本各自保留；未调产品超时或推理参数。原文登记仍是完整消息，剔除指令前缀需作者编辑或要求修订。
- **下一场景**：第十轮提出了对已采纳编辑版“保留或替代”的选择，尚未实际执行。沿 Journey D5 / Q1c 核查已采纳内容的修订、覆盖确认、版本保留及后续上下文，不把提示当成已支持的能力。
