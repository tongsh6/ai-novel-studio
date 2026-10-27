# B61：native 验收驱动覆盖（AU11×2 / AU07×3）

- 状态：**done（2026-10-28，CP0–CP3；5/5 native 系统级 PASS，registry 已 active）**。证据全部为真实 Tauri 窗口 AX/CGEvent 驱动（`driver=ax-native-system-ui / surface=tauri`）；原 browser-surface 证据与调试失败批次均只读保留。
- 登记日期：2026-10-27；来源：B40/B59 之后，AU11×2 与 AU07×3 的**唯一剩余阻塞**是「native 系统级驱动未实现」；B40 所有 PASS 均为 browser-surface（`surface=browser / driver=headless-chromium`），不能读作原生交互。
- 上游：[B40](B40-judgment-era-acceptance-reanchor.md) §8/§9/§11.3、[B59](B59-agent-run-step-trace-persistence.md) §8、[known-gaps](../../quality/acceptance/known-gaps.md) native 汇总、`scripts/lib/native_ui/README.md`。

## 1. 问题与目标

`tauri_slice_verify.sh` 的 `TAURI_NATIVE_SYSTEM_DRIVER=1` 路径已具备完整原生 harness（AX/CGEvent 外部驱动 + typed wait ledger + native app ownership 清理 + 证据校验），但 allowlist 目前仅含 B26/B28/B29/B30/B31/P1。AU11（质量诊断 / 缺 WorkState）与 AU07（ToolTrace / replay）场景因此只能以 browser-surface 取证并被 registry 标 blocked。

目标：为这 5 个场景补齐 **native 系统级驱动 + 证据校验器 + allowlist/verify 注册**，在真实 Tauri 窗口上完成同一用户流程，产出 `driver=ax-native-system-ui` 的独立证据；native PASS 后按 slice 规则把对应场景改 active（不得用 browser-surface 证据代替）。

## 2. CP0 复现与契约（2026-10-27）

| 事实 | 证据 |
|---|---|
| native allowlist 仅 B26/B28/B29/B30/B31/P1 | `scripts/tauri_slice_verify.sh` native allowlist（`Native system driver is currently registered only for ...`）+ `verify_native_slice()` 映射 |
| AU11/AU07 的 browser PASS 均 `surface=browser / driver=headless-chromium` | `artifacts/slice-verify/au11-*-tauri/summary.json`、`artifacts/slice-verify/{au07,e2e-01}-*-tauri/summary.json` |
| 阻塞原因只剩 native driver | `quality/acceptance/scenarios.yml` 三条 blocked_reason（B59 修复后更新）与 `known-gaps.md` B59 修复复核 |
| 可复用原生 harness | `scripts/lib/native_ui/{driver,workbench}.mjs`、`scripts/native_ui_wait.mjs`（分型预算/心跳/fail-fast）、`native_app_ownership.mjs`（按可执行路径回收）、`native_b29_drive.mjs`/`native_b30_drive.mjs`/`native_p1_drive.mjs` 为既有范例 |
| 产品侧已具备取证点 | B59 后 AgentRun step trace 落库；AU07 三场景 browser scoped PASS（`trace-query.json` count=1）；AU11 两场景 browser 机制预验通过（摘要/verdict 历史见各自 artifact 目录） |

**契约（不改验收判据）**：沿用 AU11/AU07/E2E 既有 manifest 断言与 B40/B59 重锚后的当前生产链字段；native 证据只需以真实窗口交互+DB/log/AX/截图证明同一断言，不新增/放宽断言。

## 3. 范围与边界

- **改**：`scripts/native_au11_drive.mjs`、`scripts/native_au11_evidence.mjs`、`scripts/native_au07_drive.mjs`、`scripts/native_au07_evidence.mjs`（新增）；`scripts/tauri_slice_verify.sh` 的 native allowlist/verify 注册与 usage；`scripts/README.md` 索引；本 slice 文档。
- **不改**：产品 `apps/` 代码、验收判据/manifest 断言语义、registry 状态（仅在 native PASS 后由 Lead 按证据改 active）、前端、真实模型。
- 驱动只用用户可见语义（窗口标题/按钮文案/输入框/AX 文本/页面可见文本）；不读 slice id/env 开关改变产品行为；不新增产品验收感知逻辑。
- 等待一律用 `native_ui_wait` typed ledger + 分型预算（input/ack/turn/candidate/adoption/maintenance/export），不得无界等待；失败写 `failure.json`、进程由 `native_app_ownership` 回收。

## 4. Checkpoint

| CP | 范围与完成标准 |
|---|---|
| CP0 | done（上节）：gap、可复用 harness、契约与边界冻结 |
| CP1 | done（2026-10-28）：AU11×2 native driver + evidence + allowlist/verify 注册，两场景均取得 native PASS（详见 §6）；registry 改 active 由 Lead 复核 |
| CP2 | done（2026-10-28）：AU07×3 native driver + evidence（只读工具步 + 持久 trace 回查 + ReplayReport no-provider + no production write），三场景均 native PASS（详见 §7）；registry 改 active 由 Lead 复核 |
| CP3 | 回归：`quality_manifest_check`、verifier 单测、pr-smoke、E2E 聚合重算（E6/E9 由 blocked 变 current pass）、全后端/前端门禁；文档/known-gaps/NEXT/台账同步 |

## 5. 验证与恢复

- native 证据目录：`artifacts/slice-verify/<scenario>-tauri-native/`（含 `native-driver-ready.json`、`native-ui-complete.json`、AX dump/截图、`app-log/`、`llm-calls/`、DB snapshot、`summary.json`）。
- 运行方式：`TAURI_NATIVE_SYSTEM_DRIVER=1 bash scripts/quality_accept.sh <scenario> --surface tauri` 在后台等待；外部 `node scripts/native_<x>_drive.mjs <artifact-dir>` 驱动；runner 通过 `verify_native_slice` 调证据校验器写 summary/verdict。
- 预算：每场景同一失败类型最多 2 次修复尝试；失败批次保留只读；超预算记录 root-cause 并升级 Lead 给选项。
- 恢复：先读本 slice、B40 §8/§9、B59 §8、`scripts/lib/native_ui/README.md` 与既有 `native_b29_*` 范例；不要改产品代码来适配驱动。

## 6. CP1 实施记录：AU11×2 native PASS（2026-10-28，b61-native）

### 6.1 实现

| 文件 | 改动 |
|---|---|
| `scripts/lib/native_ui/scenario_driver.mjs`（新增） | AU11/AU07 共用原生驱动运行时：启动/等工作台「同步已连接+真实作品标题」、真实作品菜单切换（dumpall 兜底）、可见输入发送、外部传输帧等待、「为什么」面板点击与可见文本、AX/截图采证、typed wait 分步封装、restore 分型重开、失败首因落盘。 |
| `scripts/lib/native_ui/scenario_evidence.mjs`（新增） | 证据核验共用（只读）：ready/ui-complete/等待账/截图/provider/transport 断言、生产源码指纹、只读 DB 生产表计数、WS 帧落盘（`native-ws-frames.json`）、summary（含 `driver`/`surface`/`behavior.assertions`/`git_head`）写法。 |
| `scripts/native_au11_drive.mjs`（新增） | 真实窗口流程：打开工作台→选中场景作品→发送场景用户话术→等回复可见→点击「为什么」→读可见文本→采集 4 份 AX/截图。 |
| `scripts/native_au11_evidence.mjs`（新增） | `prepare`（读 seed / 外部 API 建空白作品、标最近打开、生产指纹与 DB 基线）、`capture`（DB 生产表计数）、`verify`（判据核验 + summary/checks 落盘）。 |
| `scripts/tauri_slice_verify.sh` | native allowlist 增加 AU11×2/AU07×3；`native-driver-ready.json` 增加 `slice_id`（外部驱动按场景分流）；`verify_native_slice` 增加两组 evidence 映射。 |
| `scripts/README.md`、`scripts/lib/native_ui/README.md` | 新增文件索引。 |

### 6.2 native PASS 证据（均为真实 Tauri 窗口 + AX/CGEvent；provider=slice_verify 确定性替身）

| 场景 | 证据路径 | 结果 |
|---|---|---|
| `au11-quality-diagnosis-message-envelope` | `artifacts/slice-verify/au11-quality-diagnosis-message-envelope-tauri/summary.json` | **native PASS**：checks 42/42，`driver=ax-native-system-ui` / `surface=tauri` / `scope=native_system_ui`；`git_head=5732b618`；`turn_id=message_86b30601-40cb-4cf9-b0fb-e78c7695fe5a`；waits=9 |
| `au11-missing-workstate-policy` | `artifacts/slice-verify/au11-missing-workstate-policy-tauri/summary.json` | **native PASS**：checks 41/41，同上驱动/表面；`git_head=5732b618`；`turn_id=message_048bef2a-a574-41a8-b235-729cd023066e`；waits=9 |

关键断言（native 等价物，未削弱浏览器 canonical 判据）：
- 质量诊断：`frame_type=casual_reply`、`decision_type=reply_only`、`no_tool_reason=no_tool_requested`、reply_record（plain_text / `b27-task-v2` / `b26-tools-v1` / supplied_context_refs≥1 且含 `current_work`）、assistant 字节=`reply_record.raw_content`、判断 prompt 含真实作品事实且「已写 1 章」、why 面板含「AI 回应」+「不会重新调用模型」且无 raw/trace 泄漏、无 tool/adoption/production write（DB 生产表计数 + 生产源码指纹不变）。
- 缺 WorkState：reply_record/supplied_context_refs=0 且 trace context refs=[]、判断 prompt「正文统计：0 章中已写 0 章」且无 `## 章节列表`/无虚构章节事实、assistant 索要目标章材料且不宣称已读、回复字节=provider 输出、why 作者安全、无 tool/adoption/production write。
- 空白作品准备与浏览器 canonical 同口径（外部 API 建标题作品 + 隔离副本 DB「最近打开」），真实窗口可见标题与 `user_message.work_id`/`context.assemble.done.work_id` 一致。

### 6.3 证据目录说明

- 目标路径原 browser-surface 旧证据只读保留为 `...-tauri-browser-surface-preserved-20261028T0015/`（未删除、未改写）。
- 驱动调试失败批次只读保留：`...-tauri-native-dev1/`（启动瞬间作品标题仍是占位「当前作品」导致误判切换）、`...-native-dev2/`（配置字段大小写错位）、`...-native-dev3/`（why 按钮等待缺 await）、`...-native-dev4/`（短链路心跳阈值误判，证据本身已可验证通过）。失败批次不覆盖为成功。

## 7. CP2 实施记录：AU07×3 native PASS（2026-10-28，b61-native）

### 7.1 实现

| 文件 | 改动 |
|---|---|
| `scripts/native_au07_drive.mjs`（新增） | 真实窗口流程：打开工作台→选中 seed 作品→发送「先看看当前已有角色阵容，然后设计一个与主角形成镜像冲突的主要反派。」→等 AgentRun 内部只读 `character_roster` 步完成→等最终回复/run 终态→以 step `turn_id` 查询产品持久 trace（`TraceRepository.list_by_turn/1` + `ReplayService.build_report/1`）并写 `trace-query.json`。不采纳任何候选。 |
| `scripts/native_au07_evidence.mjs`（新增） | `prepare`（seed 字段/最近打开/生产指纹）、`capture`（DB 生产表计数）、`verify`（transport/app-log/trace-query/AX/DB/生产指纹核验 + summary/checks）。 |

### 7.2 native PASS 证据（同一只读工具步证据支撑三项场景判据；provider=slice_verify）

| 场景 | 证据路径 | 结果 |
|---|---|---|
| `au07-tooltrace-registry-redacted-io` | `artifacts/slice-verify/au07-tooltrace-registry-redacted-io-tauri/summary.json` | **native PASS**：checks 29/29，`turn_id=message_41e0868c-fb79-4b2e-8682-8c880a8e43f2:agent:3`，`trace-query.json` count=1，waits=10 |
| `e2e-01-readonly-tool-trace` | `artifacts/slice-verify/e2e-01-readonly-tool-trace-tauri/summary.json` | **native PASS**：checks 29/29，`turn_id=message_93d92769-d128-43eb-a0a6-b3c153a600f6:agent:3`，count=1 |
| `e2e-01-replay-report` | `artifacts/slice-verify/e2e-01-replay-report-tauri/summary.json` | **native PASS**：checks 29/29，`turn_id=message_f0d1ecbb-5aaa-4f86-8318-8070f5787be2:agent:3`，count=1 |

关键断言（native 等价物）：
- app-log：`orchestrator.decide.done allow_tool`、`context.characters.done`（character_dossier, count≥1）、`toolbox.execute.done character_roster succeeded`、父 user_message done；无 `channel.author_action.*` / `adoption.evaluate.*` / `channel.adopt.*`。
- 只读步 turn_result：`tool_result.tool_name=character_roster`、`status=succeeded`、`truthfulness`（tool_called=true、production_write_performed=false、artifact_adopted=false）、无 state_delta/artifact_refs、无 adoption_state；窗口可见文本含已确认角色「林澈」，不含 `未确认影子`/`外部角色`。
- 持久 trace：`trace-query.json` count=1、`decision_type=tool_dispatched`；tool_trace_ref 含 registry snapshot（character_roster/1.0.0/active/memory）、input/output contract refs、grant summary（read=character_list、write 空、grants_within_registry）、redacted request/result summaries（payload_stored=false）且无原始 payload 令牌；ReplayReport `provider_called=false`、`result_status=complete`、六问 all answered/not_applicable、chain 含 frame/plan/decision/tool_trace/turn_result、tool_trace 步保留 registry/redaction。
- 无生产写入：DB 生产表计数 + 生产源码指纹前后不变。
- E2E 聚合器兼容性已按 `scripts/lib/quality/e2e_status.mjs` 校验：两份 e2e summary `checkArtifactContent` ok（含 E6/E9 期望断言名）、`checkFreshness` 对当前 HEAD `fresh`；`accept_verdict` 在 scratch 副本上 dry-run 均 `status=pass / surface=tauri / driver=ax-native-system-ui / evidence=5/5`（真实 verdict 写入与 registry active 由 Lead 在最终 HEAD 收口）。

### 7.3 证据目录说明

- 三个目标路径原 browser-surface 旧证据只读保留为 `...-tauri-browser-surface-preserved-20261028T0025/`。
- 驱动调试失败批次只读保留：`au07-tooltrace-registry-redacted-io-tauri-native-dev1/`（`trace-query.json` 末行转义把换行写成字面 `\n` 致 JSON 尾随字符；已修复为真实换行并在 scratch 复验 count=1）。该失败批次同时保住了真实只读步证据（roster turn_id/transport/app-log），不覆盖为成功。

## 8. 残余与交接（CP3，Lead 收口）

1. **registry 状态**：5 个场景仍为 `blocked`；native PASS 证据已就绪，按 slice 规则改 active 由 Lead 按本文件 §6/§7 证据复核后执行。
2. **verdict / 最终 HEAD**：本批 native summary `git_head=5732b618`（工作树含未提交的 B61/Lead 改动；产品代码路径经生产指纹证明未改）。Lead 提交后 HEAD 前进，若 E2E 聚合要求 `freshness=current`，需在最终 HEAD 复跑本批 5 个 native 批次（每场景一次，串行，约 12–15 分钟）或按 Lead 对最终 HEAD 证据的口径处理；不得用旧 HEAD 证据冒充 current。
3. **模型行为语义**：全部为 `provider=slice_verify` 确定性机制证据；AU11 真实模型质量诊断/缺材料行为、AU07 真实模型只读工具选择仍归 B42 `release-real-llm` 层，不因 native PASS 提前声明。
4. **建议门禁**：`bash scripts/quality_manifest_check.sh`、registry/known-gaps/NEXT 同步、E2E 聚合重算（E6/E9 由 blocked 变 current pass）由 Lead 在 CP3 执行；本批新增脚本可用 `node --check` 与 §6.2/§7.2 的 artifact 复验；失败批次（§6.3/§7.3）保持只读。

## 8. CP3 收口记录（2026-10-28，Lead）

1. **registry 激活（按 native PASS 证据）**：`au11-quality-diagnosis-message-envelope`、`au11-missing-workstate-policy`、`au07-tooltrace-registry-redacted-io`、`e2e-01-readonly-tool-trace`、`e2e-01-replay-report` 五条场景由 `blocked` 改 `active`（删除 blocked_reason）；`quality_manifest_check` 207/2/209 passed；nightly 现 203 active + 2 blocked（`au02-candidate-fallback-ui`、`judgment-explore-internal`）。
2. **verdict 驱动面修正（B61 需要，Lead 实施）**：`scripts/lib/quality/accept_verdict.mjs` 的 `surface`/`driver` 改为**以证据 summary.json 为准**（registry/manifest 字段仅回退），使 native 批次不会被写回 `driver=外部 Chromium`、browser-surface 也不会被冒充原生；新增 `quality_accept_batch.test.mjs` 回归（fixture 声明 `surface=tauri/driver=ax-native-system-ui` → verdict 如实）。质量库测试 186/186。
3. **E2E 聚合重算**：E6/E9（e2e-01-readonly-tool-trace / replay-report）在 native summary 上通过 `checkArtifactContent` + freshness（提交前 HEAD `5732b618`）；提交后按 B41 freshness 规则在最终 HEAD scoped 复跑刷新（记录见最终汇报与 artifacts），不把提交前 HEAD 证据冒充 current。
4. **文档/台账同步**：known-gaps（5 场景移出 blocked、B61 native 关闭节）、B40 §8.4/§9.1a/§11.3、AU11/AU07 台账、B59 §8 追记、NEXT/slices README/事实台账、scripts/README 与 native_ui README。
5. **边界**：未改产品 `apps/`；未改既有断言语义；真实模型语义仍归 B42 `release-real-llm`（本批 provider=slice_verify 确定性替身）；I10 不代签。
