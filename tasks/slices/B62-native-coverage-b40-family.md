# B62：native 验收覆盖二批（B40 CP3 家族）

- 状态：**done（2026-10-28，CP0–CP3；6/6 native 系统级 PASS，current 证据已由 native PASS 替换）**。原生证据 `driver=ax-native-system-ui / surface=tauri / provider=slice_verify`；原 browser-surface 证据与 dev/失败批次只读保留；未改产品/判据/registry（6 场景此前已 active）。
- 登记日期：2026-10-28；来源：作者选择「补 native 覆盖」。B40 CP3 家族仍有 7 个 active 场景的 PASS 证据为 browser-surface（`surface=browser / driver=headless-chromium`），不能读作原生交互。
- 范围修正（Lead 2026-10-28）：`vs10-observability-spine` 在 registry 如实为 `surface: browser`（browser 场景），**移出本批 native 范围**；本批只原生化 6 个 tauri 场景。6 场景在 B40 后均已是 active，本批目标是用 native PASS 替换其 current 证据（不改 registry、不降判据）。
- 上游：[B61](B61-native-acceptance-driver-coverage.md)（通用 native harness：`scripts/lib/native_ui/scenario_driver.mjs` / `scenario_evidence.mjs`）、[B40](B40-judgment-era-acceptance-reanchor.md) §10、[known-gaps](../../quality/acceptance/known-gaps.md)。

## 1. 目标与范围

用 B61 已建成的通用原生驱动/证据运行时，把下列场景在真实 Tauri 窗口上取得 `driver=ax-native-system-ui / surface=tauri` 的原生 PASS，并按证据改 active（不改既有断言语义）：

| 场景 | 当前证据 | 原生流程要点 |
|---|---|---|
| `au01-ordinary-chat-two-turn-roundtrip` | browser-surface PASS | 两轮普通聊天：可见输入→回复→第二轮→回复；无计划/无工具/无采纳 |
| `au01-empty-message-guard` | browser-surface PASS | 空输入禁用发送（发送不可用）→仍可正常发送一条 |
| `au01-frame-validation-friendly-error` | browser-surface PASS | 协议损坏安全失败（S7 友好终局）→后续正常轮完成 |
| `pr-smoke-core-reply` | browser-surface PASS | 判断纪元普通回复链两轮（pr-smoke 最小真实路径） |
| `au02-natural-exploration-no-slot-form` | browser-surface PASS | 模糊创作输入→creative_exploration 候选卡渲染→无表单/无采纳 |
| `agent-step-regate` | browser-surface PASS | AgentRun 内部多步 re-gate（roster→character_design）+ author-safe why/gate 断言 |
| `vs10-observability-spine` | browser-surface PASS | 观察/活动/父子 turn 关联与 why/replay 可观测性 |

## 2. CP0 契约与边界（2026-10-28）

- **判据不改**：沿用各场景 manifest/verifier 的既有断言与 B40 重锚后的当前生产链字段；native 证据只需在真实窗口交互下证明同一断言。
- **复用不重写**：优先复用 B61 的 `scenario_driver.mjs` / `scenario_evidence.mjs` 与 `native_au11/au07` 的配置模式；新增 `scripts/native_b40_family_drive.mjs` / `native_b40_family_evidence.mjs`（或按场景族拆 ≤2 个），注册 `tauri_slice_verify.sh` native allowlist/verify。
- **不碰产品**：不改 `apps/`；不改验收判据/manifest 断言；驱动只用用户可见语义；等待走 typed ledger；失败批次只读保留。
- **运行**：`TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_NATIVE_TRANSPORT_PROXY=1 CARGO_NET_OFFLINE=true TAURI_NATIVE_ARTIFACT_DIR="$PWD/artifacts/slice-verify/<scenario>-tauri" bash scripts/quality_accept.sh <scenario> --surface tauri` + 外部驱动；一次一个原生批次。

## 3. Checkpoint

| CP | 范围与完成标准 |
|---|---|
| CP0 | done（上表 + 契约/边界；vs10 经 Lead 范围修正移出本批） |
| CP1 | done（2026-10-28）：聊天族 4 场景（au01×3 + pr-smoke-core-reply）native PASS；证据含 native AX/截图/app-log/llm-calls/等待账/只读 DB，检查项与浏览器 canonical 同源（详见 §5） |
| CP2 | done（2026-10-28）：au02-natural / agent-step-regate native PASS（候选 UI、AgentRun 多步 12 门 gate + author-safe why，详见 §6） |
| CP3 | b62-native2 侧完成（6/6 native PASS + E2E 内容/新鲜度 scoped 预校验，详见 §7）；registry/known-gaps/NEXT/台账/E2E 聚合/nightly/最终 HEAD 复跑由 Lead 收口；vs10 不在本批 |

## 4. 验证与恢复

- 每场景 native PASS 后 Lead 按证据复核改 active；原 browser-surface 证据只读保留为 `*-tauri-browser-surface-preserved-*`。
- 失败批次只读保留（`*-native-dev*` / `*-native-failed-*`）；同因失败 ≤2 次后升级 Lead。
- 恢复：先读 [B61](B61-native-acceptance-driver-coverage.md) §6–§8 与 `scripts/lib/native_ui/README.md`；不要改产品代码或降低断言。

## 5. CP1 实施记录：聊天族 4 场景 native PASS（2026-10-28，b62-native2）

### 5.1 实现

| 文件 | 改动 |
|---|---|
| `scripts/native_b40_family_drive.mjs`（新增） | 6 场景共用原生驱动，按 `native-driver-ready.json` 的 `slice_id` 分流：打开工作台→选中场景作品→真实可见输入发送→等真实 WS/HTTP 帧与可见回复/候选卡/「为什么」→AX/截图采证。普通聊天在**点击发送后立即 AX 采样**捕捉 ~300ms 运行窗口内的 AgentRun 活动条（AX 等价 browser DOM observer）；空输入用「只输入不发送→观察发送按钮 AX enabled→点击尝试」真实流程；frame 校验轮等友好 fallback 后恢复；agent-step-regate 等内部 roster/character_design 步终态与 author-safe why 面板。 |
| `scripts/native_b40_family_evidence.mjs`（新增） | `prepare`（读 seed/外部 API 建 AgentRun 作品、标最近打开、生产指纹与 DB 基线）、`capture`（只读 DB 生产表计数 start/final）、`verify`（每场景判据核验 + `native-b40-checks.json` + summary `behavior.assertions`）；判据 1:1 对齐 browser canonical driver / manifest / `native-tauri-verifier` behavior，未新增/放宽断言。 |
| `scripts/tauri_slice_verify.sh` | native allowlist 增加 6 场景（`is_b40_family_native_slice`）；`verify_native_slice` 映射到 `native_b40_family_evidence.mjs verify`。 |
| `scripts/lib/native_ui/ax_cua.swift` | dump 节点增加 `kAXEnabledAttribute`（`enabled` 字段）→ `writeAX` 落 `disabled=true`：为「空输入时发送按钮不可用」提供真实可访问性证据（非点击副作用反推）。 |
| `scripts/lib/native_ui/driver.mjs` | `writeAX` 输出 `disabled=true` 标记。 |
| `scripts/README.md`、`scripts/lib/native_ui/README.md` | 新脚本索引登记。 |

### 5.2 native PASS 证据（真实 Tauri 窗口 + AX/CGEvent；provider=slice_verify 确定性替身；`git_head=7fcab486`）

| 场景 | 证据路径 | 结果 |
|---|---|---|
| `au01-ordinary-chat-two-turn-roundtrip` | `artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json` | **native PASS**：checks 37/37，`surface=tauri` / `driver=ax-native-system-ui`；turns `message_0b41d62c…`, `message_ac942e45…`；waits=13（maintenance/input/ack/turn）；verdict `pass`。 |
| `au01-empty-message-guard` | `artifacts/slice-verify/au01-empty-message-guard-tauri/summary.json` | **native PASS**：checks 33/33，同上驱动/表面；turn `message_9388c078…`；waits=10；verdict `pass`。 |
| `au01-frame-validation-friendly-error` | `artifacts/slice-verify/au01-frame-validation-friendly-error-tauri/summary.json` | **native PASS**：checks 29/29；turns `message_54ee9275…`（安全失败轮）+ `message_fb11b6de…`（恢复轮）；waits=13；verdict `pass`。 |
| `pr-smoke-core-reply` | `artifacts/slice-verify/pr-smoke-core-reply-tauri/summary.json` | **native PASS**：checks 37/37；turns `message_0f34ebb3…`, `message_750303ec…`；waits=13；verdict `pass`。 |

### 5.3 关键 native 等价断言（未削弱 browser canonical 判据）

- **普通聊天两轮 / pr-smoke**：两轮 `user_message` 各 1 次且 `generate_micro_plan=false`；每轮 ack + `turn_result`；`frame_summary.frame_type=casual_reply`、`trace_summary.decision_type=reply_only`、`no_tool_reason=no_tool_requested`；assistant 字节精确等于 `reply_record.raw_content`；可见文本顺序 user1 < assistant1 < user2 < assistant2；两轮 AgentRun 活动条在运行窗口出现、完成后无「思考中」/活动摘要残留；无 action/candidate/adoption 卡；无 tool_result/adoption_state；无 `planner.form_*` 退役事件；DB 生产表计数 + 生产源码指纹前后不变。
- **空消息守卫**：空白输入后发送按钮 AX `enabled=false`（`disabled=true` 落盘）+ 0 新增 `user_message` 帧 + 可见 user/assistant 消息数不变 + 无「思考中」+ composer 仍 enabled；随后恢复轮完整完成判断纪元回复链（`generate_micro_plan=false`、judgment.decided.done、回复=provider 字节、无生产写入）。
- **frame 校验友好错误**：协议损坏轮 `status=failed_recoverable / phase=failed` 且同轮无 `judgment.decided.done`（S7 安全终局）；fallback 文案非空、含「重试」、无内部 validation 原因（UI 可见文本与 turn_result 序列化均无）；思考清除、输入可用、服务未断开；恢复轮 `frame_type=casual_reply` 正常完成且不渲染 fallback。
- **所有场景**：`driver=ax-native-system-ui` + `ready.driver=external-system-ui`、`browser_driver_started=false`、无 `ui-frames.json`；typed wait ledger 平衡且覆盖 input/ack/turn/maintenance；截图 ≥3（4/4/4/4）；provider=slice_verify；E2E 期望断言名（E1/E12：`two_user_turns_completed` 等；E11：`invalid_judgment_action_settled_as_safe_failure` 等）均出现在 summary `behavior.assertions`。

### 5.4 证据目录说明

- 6 个目标路径的原 browser-surface 证据只读改名保留为 `...-tauri-browser-surface-preserved-20261028T0055/`（未删除、未改写）。
- 驱动调试/失败批次只读保留：`au01-ordinary-chat-two-turn-roundtrip-tauri-native-dev1/`（运行活动条未被采样到——改为点击发送后立即 AX 采样）、`...-native-dev2/`（采样成功但核验未读 driver-log 采样，已修复）、`au01-empty-message-guard-tauri-native-dev1/`、`au01-frame-validation-friendly-error-tauri-native-dev1/`、`au02-natural-exploration-no-slot-form-tauri-native-dev1/`、`agent-step-regate-tauri-native-dev1/`（dev 通过证据，仅调试用，不冒充最终）。

## 6. CP2 实施记录：au02-natural / agent-step-regate native PASS（2026-10-28，b62-native2）

### 6.1 native PASS 证据（同驱动/表面口径；`git_head=7fcab486`）

| 场景 | 证据路径 | 结果 |
|---|---|---|
| `au02-natural-exploration-no-slot-form` | `artifacts/slice-verify/au02-natural-exploration-no-slot-form-tauri/summary.json` | **native PASS**：checks 30/30；turn `message_9d9d5bab…`；候选 `人物动机` / `世界规则`（标题+立意可见、面板「可讨论方向」）；waits=8；verdict `pass`（evidence 6/6）。 |
| `agent-step-regate` | `artifacts/slice-verify/agent-step-regate-tauri/summary.json` | **native PASS**：checks 38/38；`run_id=run_mvqxdjxl_6`、`run_mode=bounded`、`consumed_budget={steps:4,tool_calls:2,provider_calls:2}`；turns `message_5b06e3a2…:agent:3`（roster）/`:agent:4`（character_design）；waits=12；verdict `pass`。 |

### 6.2 关键 native 等价断言（未削弱 browser canonical 判据）

- **au02 自然探索**：真实工作台发送模糊创作输入（`generate_micro_plan=false`）→ `judgment.decided.done{frame_type=creative_exploration,candidate_count>0}` → TurnResult 候选（title/pitch）在真实窗口候选面板渲染（标题/立意可见）→ 无机械 slot 表单（`required_slots/missing_slots/slot_schema/slot_form` 均缺席且可见文本无 slot 文案）、无执行/确认卡；无 tool_result、无 adoption、`candidate_selected/adopted=false`、`production_write_performed=false`；无 author_action/action_result 帧；无退役 planner 事件；DB/生产指纹不变。
- **agent-step-regate**：父 `user_message` 快速 ack 携带 `run_id` + `run_mode=bounded`（无 sync_turn 回退）；两个内部步各自 `orchestrator.decide.done allow_tool`（`gate_order_version=adr-0005-v1`、`gate_count=12`、`gate_outcomes` 按 correlation→turn_result_compat 顺序、无 block、`first_blocking_gate=null`、`decision_id` 互异）后才出现对应 `toolbox.execute.done`（character_roster / character_design）；budget 门 `pass_with_note + run_budget_remaining`，trace_readiness 门 `pass`；两步 TurnResult `trace_summary` 均携带 gate 版本与 12 门结果；bounded run 广播 `run_started`/`run_completed` 与 2 个 `gate_decided`（各 12 门结果）；无 `plan_drafted` 伪计划；最终 `character_seed` 候选 `requires_adoption=true / TENTATIVE`、`artifact_adopted=false`、无生产写入；author-safe「为什么」面板显示「本轮使用了工具」+「不会重新调用模型」，无 raw prompt / trace_ / gate 码泄漏，且面板仅点击后出现。

### 6.3 证据目录说明

- 两个目标路径的原 browser-surface 证据同样只读改名 `...-browser-surface-preserved-20261028T0055/`；dev 批次只读保留。

## 7. CP3 收口清单（2026-10-28，b62-native2 → Lead）

1. **6/6 native PASS 已达成**（无 vs10；按 Lead 范围修正移出）。所有 summary 均 `surface=tauri / driver=ax-native-system-ui / scope=native_system_ui / provider=slice_verify`，verdict 均 `status=pass` 且 surface/driver 取自证据 summary。
2. **E2E 相关内容/新鲜度预校验（scoped，b62-native2 执行）**：按 `scripts/lib/quality/e2e_status.mjs` 的 `checkArtifactContent` + `checkFreshness` 对 E1/E2/E4/E11 四份 native summary 逐项校验 → content ok（含期望断言名）、fresh ok、verdict fresh ok；未跑完整 `mix` 聚合命令（由 Lead 在最终 HEAD 收口）。
3. **证据 git_head**：本批全部 `git_head=7fcab486`（当前工作树 HEAD，产品源码经生产指纹证明未改）；Lead 提交后 HEAD 前进，如聚合要求 `freshness=current`，按 Lead 口径在最终 HEAD scoped 复跑（6 场景串行，单场景约 3–4 分钟）。
4. **未改**：产品 `apps/`、验收判据/manifest 断言语义、registry（6 场景保持 active，证据替换为 native）；真实模型行为语义仍归 B42 `release-real-llm`。
5. **交接 Lead**：`quality_manifest_check`、known-gaps native 覆盖声明、NEXT/台账/本文件状态、E2E 聚合与 nightly 重算、最终 HEAD 复跑与提交。
6. **变更文件清单**：`scripts/native_b40_family_drive.mjs`（新）、`scripts/native_b40_family_evidence.mjs`（新）、`scripts/tauri_slice_verify.sh`、`scripts/lib/native_ui/ax_cua.swift`、`scripts/lib/native_ui/driver.mjs`、`scripts/lib/native_ui/README.md`、`scripts/README.md`、本文件。


## 8. CP3 收口记录（2026-10-28，Lead）

1. **证据替换与保留**：6 个场景的 current 证据已由 native PASS 替换（同一期望路径 `<scene>-tauri/summary.json` + `verdict.json`）；原 browser-surface 证据只读改名为 `*-tauri-browser-surface-preserved-20261028T0055`；dev/失败批次（`*-native-dev*`）只读保留。`vs10` 按 Lead 范围修正移出（注册 surface=browser），不冒充 native。
2. **判据未削弱**：native evidence 与 browser canonical 同源断言（两轮顺序/回复字节=provider 输出/空输入 disabled/损坏轮安全终局/候选卡与无表单/AgentRun 双步 12 门 allow + author-safe why/无工具无采纳零写入），E2E E1/E2/E4/E11/E12 期望断言名均出现在 native summary `behavior.assertions`。
3. **registry**：6 场景此前已 active，本批不改状态；`quality_manifest_check` 207/2/209 passed（唯一 blocked=au02-candidate-fallback-ui）。
4. **提交后 freshness**：native 证据 git_head=提交前 HEAD；最终提交后由 Lead 排期在最终 HEAD 复跑 6 场景（quality_accept 写 fresh verdict），不把提交前证据冒充 current。
5. **边界**：provider=slice_verify 确定性机制证据；真实模型语义仍归 B42 `release-real-llm`；未改产品 `apps/`、未 commit。
