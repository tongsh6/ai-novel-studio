# Q1b 真实模型多轮存档复验

- 状态：回归已执行 / 语义未闭环（2026-10-08，代码 77bf8389）；数据断言通过，新增 BIZ-05 转 Q3D 当前队首。
- 下方旧任务表、局部验证及八次调用属于修复前基线；本轮四回合九次调用与语义结论见文末。
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
