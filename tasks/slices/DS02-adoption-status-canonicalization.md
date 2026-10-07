# DS02 adoption_status 序列化口径全链路统一

- 状态：done / verified（2026-10-05 完成验收；2026-10-08 核对证据并提交收尾）
- 类型：Contract Slice / Data Flow Correction
- 父契约：`docs/design/foundation/30` §3.2（大写 7 态 canonical）、ADR-0019（转换矩阵）、ADR-0024（决策面 schema 闸门）

## 1. 修复前问题（系统内部口径分裂）

- `NovelDomain.AdoptionStatus` 与 `NovelPersistence...ArtifactAdoptionEntry` Ecto 枚举使用 30 §3.2 冻结的大写 7 态（`TENTATIVE`...）。
- `NovelDomain.TentativeArtifactSet.adoption_status` 使用小写 atom `:tentative`，随 TurnResult 序列化为小写字符串，前端与外部 driver 均按小写消费（`adoption_status === "tentative"`）。
- DS01 CP1 的 schema 闸门因此被迫在前端 barrel 将 `adoption_status` 放宽为 `z.string()`（`frontend/src/lib/schemas.ts`），使 `artifact_adoption_entry.json` 的枚举校验对线上流量失效——这是登记在案的临时放宽，本 slice 的存在目的就是消灭它。

## 2. 修正方向（从数据流出发，单一权威）

统一到 canonical 大写 7 态（契约权威优先，30 §3.2 / ADR-0019 不动）：

1. `TentativeArtifactSet` 的 `adoption_status` 对齐 `NovelDomain.AdoptionStatus`（领域层单一权威，消灭第二套小写枚举）。
2. TurnResult 序列化（`turn_result_builder` `unit_pending_entry` 等）随之输出大写。
3. 前端消费点（adoptionDecision / candidateSelection / WorkspaceChat 等 `"tentative"` 字面量）与外部 driver/verifier 断言同步迁移。
4. 前端 barrel 撤销 `adoption_status: z.string()` 放宽，恢复 codegen 枚举校验（DS01 闸门在此收口）。
5. 兼容层：持久化历史 turn_result（transcript）中已有小写值——恢复路径需要一次性归一（读取时按已知枚举映射），已选 MemoryLog 共享读取边界；不在领域和前端保留双轨。

## 3. 开工检查（七问，2026-10-05）

- Contract：30 §3.2 / ADR-0019 / `artifact_adoption_entry.json` 枚举；ADR-0024 决策 5。
- Invariant：`00c` §7 #18（schema 闸门真实生效）；ADR-0019 转换矩阵。
- Boundary：novel_domain（TentativeArtifactSet）、novel_application（序列化）、frontend、slice-verify 资产；novel_persistence 增加共享历史读取适配，Ecto 枚举与表结构不动；novel_agent、novel_web 生产实现不改。
- Consumer：前端采纳链路 + I1/I3 driver + Tauri 采纳场景。
- Proof：mix 全套 + I1/I2/I3 + schemas.test（撤销放宽后枚举校验用例）+ Tauri 采纳链路回归；transcript 恢复归一用例。
- Acceptance Driver：复用 `agent-bounded-roster-to-character-design`（含 pending_artifact_tentative 断言迁移），并扩展 `q3d-message-outcome-roundtrip`：页面生成真实候选后由外部 harness 在隔离测试库写入旧版状态，再从页面刷新、采纳、刷新和追问；夹具与恢复响应留证，产品不新增验收感知。
- Exploration：不新增要素物化；既有候选/采纳投影继续同批进入上下文，历史状态也在同一读取边界归一。

## 4. 决策日志

- 2026-10-05：选定持久化读取适配（MemoryLog 的 transcript/recent/page 和 InteractionLifecycle 上下文共享）；只映射已知小写七态，保留未知值以触发契约告警，不写回原始数据、不改正文或 CandidateDirection.not_adopted。前端沿用 ADR-0024 的校验告警策略，恢复枚举约束，不另改整份 draft envelope 容错策略。
- 2026-10-05：已读卡片/工作台设计及仓库中 PZAVY、ZOwOi 原型导出；实时 Pencil 连接不可用，本次仅收紧数据与类型，未修改布局和视觉。

- 2026-07-15：立项。源于 DS01 CP1 闸门落地时发现的口径分裂与临时放宽；用户明确原则"开发阶段不允许补丁式绕过"，本 slice 是该放宽的系统性收口。


## 5. 任务清单与验证（2026-10-05）

| 任务 | 状态 | 结果 |
|---|---|---|
| 领域初态、产物生产和状态消费统一 | done | TentativeArtifactSet 使用既有初态；生产者不重建第二枚举，CandidateDirection.not_adopted 不变 |
| 历史读取边界兼容 | done | MemoryLog recent/transcript/page 与 InteractionLifecycle 共享；只转换已知小写七态，未知值保留告警；不写回原始记录或改正文 |
| 前端 schema 与类型收口 | done | 撤销 z.string；ArtifactEntry 从 WireTurnResult 推导；线上未知/缺失/小写状态触发字段级漂移告警，沿用 ADR-0024 容错渲染策略 |
| 外部真实页面验收与桌面构建 | done | q3d 历史候选/采纳回执恢复、roster 主链及桌面包通过 |
| 全量检查与静态扫描 | done | AliasUsage 已修；完整复扫 17 PASS / 2 既有 FAIL、3 旧处置、0 blocking |

### 外部自动化驱动真实页面

运行 `bash scripts/quality_accept.sh q3d-message-outcome-roundtrip --surface tauri`、
`bash scripts/quality_accept.sh agent-bounded-roster-to-character-design --surface tauri` 均通过。
启动真实 Tauri，外部 Playwright 驱动当前 App/WorkspaceChat 的同一实际页面入口，
读取 HTTP/WebSocket/日志/持久化证据；使用确定性 provider，不是原生 WebView 内部自动化，
不证明真实模型质量或平台专属 API。

Q3d 页面链路：只读执行→刷新→追问读取结果→输入带 nonce 的作者原文→刷新→下一轮保存原文→
新候选 TENTATIVE→外部隔离测试库改为旧版 tentative→刷新仍为 TENTATIVE 且原文字节不变→
重复存档不增候选→作者点击采纳→新回执 ACCEPTED→外部改为旧版 accepted→刷新仍为 ACCEPTED、
不重入待采纳→追问依据真实入档结果。

- `artifacts/slice-verify/q3d-message-outcome-roundtrip-tauri/summary.json`
- 同目录 `ui-state.json`、`ui-frames.json`、`legacy-adoption-fixtures.jsonl`、
  `legacy-pending-resume.json`、`legacy-adopted-resume.json` 和页面截图。
- `artifacts/slice-verify/agent-bounded-roster-to-character-design-tauri/summary.json`

### 后端 / 前端局部与全量验证

- 开工 `mix compile` 通过；收尾 `mix compile --warnings-as-errors`、`mix test`（1510 / 0）、
  `mix xref graph --format cycles --label compile-connected --fail-above 0`、
  `mix run --no-start scripts/arch_check.exs` 通过。
- `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`：3/3 决定性通过。
- `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`：4/4 通过。
- `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs`：3/3 两两不交。
- `MIX_ENV=test mix run scripts/scenario_invariants/run_n_narr.exs`：叙事字节绑定通过。
  四个 driver 与不变量规则均未修改。
- `cd frontend && pnpm typecheck && pnpm lint && pnpm test`：461 / 0。
- `bash scripts/frontend_audit.sh`：27 PASS，含 `tauri build --ci`；
  `bash scripts/check_design_trace.sh`：16 PASS；队列检查与八项检查器测试通过。
- `bash scripts/build_sidecar.sh` 与 Tauri 构建通过；.app 内 sidecar 与源归档 SHA256 相等，
  旧生成 release 已移至 `artifacts/project-analysis/ds02-sidecar-before-clean/`。
- 命令日志：`artifacts/project-analysis/ds02-*.log`。前端命令及所有嵌套 pnpm 均通过已有
  pnpm 10.33.0 执行，未改变依赖锁文件或全局工具。首轮前端审计漏传此环境，间接 pnpm 12
  自动清理依赖，页面因缺 Vite 文件未启动；已停止所属进程并按锁文件离线恢复，随后两场景通过。

### 静态扫描处置

命令：`bash scripts/ai_static_scan.sh --top 10`（完整模式；环境固定 pnpm 10）。
首轮新增 MemoryLogTest AliasUsage 已通过模块 alias 修复。2026-10-05 完整复扫返回 0：
17 PASS / 2 既有 FAIL，剩余 3 findings、0 touched、0 blocking；2026-10-08 核对工作树与 manifest 一致。
既有 Top 项继续按 `reports/static-scan/dispositions.json` 处置：

| 剩余项 | 处置 | 原因 / 后续 |
|---|---|---|
| Pencil fileToken 命中 gitleaks | false_positive | 设计元数据；保留扫描，若新 fingerprint 则重新核查 |
| 其他分支历史 config 命中 gitleaks | accepted_risk | 既有历史处置，当前分支不重写；凭证及历史清理由所属维护者处理 |
| ChapterSummary 嵌套层级 | deferred | 既有未触及模块；下次修改解析器时配合原测试抽取映射 |

## 6. 未闭环边界与恢复指引

本 slice 的状态契约、历史兼容、真实页面采纳链路已完成。真实模型对历史上下文的语义利用
仍需 Q1b / Journey C10 的 D8 存档复验，不能由确定性 provider 证据替代。
实时 Pencil 连接不可用，已使用仓库原型导出核对；本次没有视觉布局变更。
后端测试仍有既有测试警告、SQLite sandbox 退出日志，均无失败；桌面包为本机构建，未做公证。
下次先读 `tasks/NEXT.md`，按 Q1b 从当前配置真实模型和工作台入口复验；不要恢复前端字符串放宽。
