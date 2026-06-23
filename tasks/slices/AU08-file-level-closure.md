# AU08 File-Level Closure

- 状态：done
- 类型：Acceptance Slice / Projection Slice / UI Contract Slice
- 启动日期：2026-06-21

## 1. 用户 / 系统目标

把 `docs/design/acceptance/author/AU-08-reading-mode.md` 从 2026-05 的 mock/缺 handler 旧结论推进到当前 checkout 的文件级可交付状态：逐场景对账真实 Reading Projection 链路、补 quality manifest 入口、把未闭合的 projection refresh 状态机登记为 P1 后续，而不是把单个历史 checkpoint 当成 AU-08 全量完成。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-08-reading-mode.md`；`docs/design/acceptance/SCENARIO-BLUEPRINT.md` 的“采纳到阅读投影”；`docs/design/contracts/VS-04-adoption-boundary-contract-pack.md`；`docs/design/adr/ADR-0016-projection-hint-ui-v3.md`；`docs/design/ui/44-reading-mode.md`；新增 `quality/acceptance/scenarios/p1-*.yml`。
- Invariant: 已采纳正文才进入 Reading Projection；pending/未采纳内容不进入 TOC/正文；TOC/正文按 `work_id` 隔离；ProjectionHint 不授权写 production state；阅读模式不得展示 mock 为真实作品。
- Boundary: 本 checkpoint 只改外部 harness / verifier、quality manifest、docs 和 tasks。生产 `frontend/src` 与 umbrella app runtime 不改；不新增验收 env/query/localStorage/DOM hook；不把 fixture provider 注册进 production runtime。
- Consumer: `bash scripts/quality_accept.sh p1-chapter-adoption-reading --surface tauri`、`p1-chapter-edit-then-accept`、`p1-word-count-audit`、`p1-chapter-expansion-multichapter`、`p1-export-minimum`；AU-08 文件级审计矩阵。
- Proof: `pnpm --dir frontend test -- --run frontend/slice-verify/native-tauri-verifier.test.mjs`；新增/复跑 quality acceptance；`bash scripts/quality_manifest_check.sh`；`bash scripts/task_done.sh`；`bash scripts/ai_static_scan.sh --top 10`。
- Acceptance Driver: `bash scripts/tauri_slice_verify.sh p1-chapter-adoption-reading` 证明采纳后正文、字数和 STALE banner；`p1-chapter-edit-then-accept` 证明编辑后采纳；`p1-word-count-audit` 证明短章/P1 进度；`p1-chapter-expansion-multichapter` 证明多章归属、目录点击和空章诚实显示；`p1-export-minimum` 证明导出读取已采纳事实。产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 未改 |
| novel_domain | no | 未改 |
| novel_agent | no | 未改 |
| novel_application | no | 未改 |
| novel_persistence | no | 未改 |
| novel_web | no | 未改 |
| frontend | yes | 只改 `frontend/slice-verify` 外部 driver / verifier / verifier tests |
| scripts | yes | 只改验收 harness：`scripts/tauri_slice_verify.sh` 的 Tauri 配置同步改为内容变化时才覆盖，避免 watcher 因无效 mtime 变化重启 |
| docs/design | yes | 更新 AU-08、SCENARIO-BLUEPRINT、acceptance README、project ledger |
| quality | yes | 新增 P1 Reading Projection quality manifests 并登记总表 |
| tasks | yes | 新增 AU-08 文件级收口记录并更新 slice 索引 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 重新审计 AU-08 当前实现、测试、Tauri artifacts 与质量入口 | done | 旧 mock/缺 handler 口径已被当前实现取代 |
| T2 | 补强 Tauri verifier：采纳后 STALE banner；多章 TOC 点击；空章诚实显示 | done | 只改外部 harness，不改 production UI |
| T3 | 新增 P1 Reading Projection quality manifests 并登记索引 | done | `p1-chapter-adoption-reading` 等 5 个 manifest |
| T4 | 更新 AU-08 文件级场景矩阵与 P1/P2 缺口分级 | done | P0=0；projection refresh 状态机登记 P1 |
| T5 | 复跑真实 Tauri / quality acceptance 与质量门禁 | done | 见 §5 |

## 5. 验证

- [x] 外部 verifier 单测：`pnpm --dir frontend test -- --run frontend/slice-verify/native-tauri-verifier.test.mjs`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-chapter-adoption-reading --surface tauri`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-chapter-edit-then-accept --surface tauri`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-word-count-audit --surface tauri`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-chapter-expansion-multichapter --surface tauri`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-export-minimum --surface tauri`
- [x] 二轮外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-chapter-draft-generation --surface tauri`
- [x] 二轮外部自动化驱动真实页面：`bash scripts/quality_accept.sh au08-reading-readonly-no-write --surface tauri`
- [x] 二轮外部自动化驱动真实页面：`bash scripts/quality_accept.sh au08-reading-return-context --surface tauri`
- [x] 二轮 cross evidence：`bash scripts/quality_accept.sh au02-unadopted-candidate-no-reading-fact --surface tauri`
- [x] 二轮 cross evidence：`bash scripts/quality_accept.sh su02-artifact-projection-trace-isolation --surface tauri`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan --slice p1-chapter-draft-generation && node scripts/task_done_check.mjs`
- [x] `bash scripts/ai_static_scan.sh --top 10`（17 passed / 1 failed / 0 skipped；唯一 finding 为历史 gitleaks `accepted_risk`，0 touched-file finding，blocking=0，入口退出码 0）

## 6. 二轮缺口矩阵（2026-06-22）

二轮复核范围只处理第一轮已登记的剩余 P1/P2、external blocker 或 cross-reference，不回退 AU-08 的文件级可交付结论。本轮已关闭 3 个 AU-08 剩余缺口：`p1-chapter-draft-generation` cross-reference driver 漂移、`SC-AU08-D1` 阅读模式查看/导出/返回 no-write 专项验收，以及 `SC-AU08-B4` 返回工作台后继续同一 work/session 上下文专项验收。三处修复仅在外部 driver / verifier / quality manifest，生产 `frontend/src` 与 umbrella runtime 未改。AU-08 当前口径重算为 12/16 已验收、2/16 已实现未验收、2/16 部分实现。

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-08 内关闭 | 建议 checkpoint / slice | 是否满足继续到 AU-09 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU08-A1 采纳章节后阅读模式看到真实目录 | 已验收 | 无 | 无 | - | `p1-chapter-adoption-reading` 二轮通过：12 章 TOC、总字数 135、`projection_refresh_status=STALE` | 保持 quality regression | 否 | keep regression | 是 |
| SC-AU08-A2 未采纳草稿不进入阅读模式 | 已验收 | 二轮发现 `p1-chapter-draft-generation` driver 文案等待漂移，真实 UI 已渲染 pending prose 卡但旧断言超时 | cross-reference / driver 漂移 | P1 | 修复后 `p1-chapter-draft-generation` 二轮通过：pending `prose_fragment` 未采纳、阅读模式检查前后未发送 adopt、TOC 12 章且无已采纳正文；`au02-unadopted-candidate-no-reading-fact` 二轮通过：空 TOC、候选文案不进阅读、no action/projection/write | 已补外部 driver：匹配当前作者可见文案，并等待新的 `channel.get_toc.done` | 是，已关闭 | `p1-chapter-draft-generation` harness drift | 是 |
| SC-AU08-A3 采纳正文后章节正文可读 | 已验收 | 无 | 无 | - | `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept` 二轮通过；编辑后采纳字数 40 | 保持 quality regression | 否 | keep regression | 是 |
| SC-AU08-A4 不把 mock 目录当真实作品 | 已验收 | 无 | 无 | - | `au02-unadopted-candidate-no-reading-fact` 二轮通过：`reading_toc_chapter_count=0`、`reading_total_word_count=0` | 保持空投影 regression | 否 | AU-02/AU-08 keep regression | 是 |
| SC-AU08-B1 点击目录切换章节 | 已验收 | 无 | 无 | - | `p1-chapter-expansion-multichapter` 二轮通过：第 1/2/3 章分别写入并从目录点击加载 | 保持多章导航 regression | 否 | keep regression | 是 |
| SC-AU08-B2 章节内容缺失时诚实显示 | 已验收 | 无 | 无 | - | `p1-chapter-expansion-multichapter` 二轮通过：未写章节显示 honest empty state | 保持空章 regression | 否 | keep regression | 是 |
| SC-AU08-B3 作品切换后阅读内容隔离 | 已验收 | 无 | 无 | - | `su02-artifact-projection-trace-isolation` 二轮通过：source/target `work_id` 不同，目标作品 TOC 4 次保持空，目标 trace/why 排除源作品 artifact/chapter | 保持 SU-02 cross regression | 否 | SU-02 artifact/projection/trace isolation | 是 |
| SC-AU08-B4 返回工作台不丢上下文 | 已实现未验收 | 第一轮缺“阅读返回后继续输入/同 work/session”专项真实页面断言 | 验收缺口 | P1 | `au08-reading-return-context` 二轮通过：真实工作台生成并采纳正文后进入阅读，点击“返回工作台”，继续发送 follow-up；summary 记录 `followup_turn_id=turn_19`，同一 `work_id=3b6f31bf-ad3e-4126-98d3-5e5aa9d198f6`、`session_id=c9553054-ce18-472f-9d07-3357d7930a0e`，且返回动作 no `author_action` / no `user_message` | 已补外部 driver/verifier 与 quality manifest；不改产品 runtime | 是，已关闭 B4 | `au08-reading-return-context` | 是 |
| SC-AU08-C1 已采纳内容变化后提示 stale | 已验收 | STALE banner 已有证据；完整 refresh job 不在本场景闭环 | 后续增强 | P1 | `p1-chapter-adoption-reading`、`p1-word-count-audit` 二轮均记录 `projection_refresh_status=STALE` | Projection job/status machine 后续补 | 否 | `au08-projection-refresh-no-write` / status machine | 是 |
| SC-AU08-C2 刷新投影不写入作品事实 | 部分实现 | 当前 refresh/retry 仍转普通聊天文本，不是专用 projection refresh action；缺 no-write driver | 设计偏差 / 验收缺口 | P1 | ADR-0016/VS-04 已冻结边界；暂无专用真实 driver | 新增专用 Channel/Application refresh action 或显式 no-op refresh，并证明 no production write | 否，需单独产品设计与 driver | `au08-projection-refresh-no-write` | 是，已登记后续 |
| SC-AU08-C3 重建中状态可见 | 已实现未验收 | UI banner 存在，缺真实 REBUILDING 状态来源 | 产品能力缺口 | P1 | runtime 派生测试；无真实状态 producer | Projection job/status machine 产生 REBUILDING 并补 Tauri driver | 否 | Projection job/status machine | 是，已登记后续 |
| SC-AU08-C4 重建失败可重试且不丢旧内容 | 已实现未验收 | UI banner/retry 存在，缺真实 FAILED 状态来源，retry 仍非专用 refresh action | 产品能力缺口 / 设计偏差 | P1 | runtime 派生测试；无真实 failure driver | Projection job/status machine 产生 FAILED，补保留旧内容/重试 no-write driver | 否 | Projection job/status machine | 是，已登记后续 |
| SC-AU08-D1 阅读模式不能编辑或采纳 | 已实现未验收 | 第一轮缺“阅读模式内无 author_action/write”专项断言；refresh 后续仍待专用化 | 验收缺口 | P1 | `au08-reading-readonly-no-write` 二轮通过：真实工作台生成并采纳正文后进入阅读，点击“导出全书”和“返回工作台”，期间 `author_action`、`user_message`、adoption、toolbox execution、production write claim 均为 0，返回后输入/发送可用 | 已补外部 driver/verifier 与 quality manifest；refresh 专用 no-write 另归 SC-AU08-C2 | 是，已关闭 D1 | `au08-reading-readonly-no-write` | 是 |
| SC-AU08-D2 无服务或 Channel 未就绪时诚实降级 | 部分实现 | 缺真实断网/Channel failure reading driver；失败态文案/空态区分仍可更清晰 | UX / 验收缺口 | P1 | runtime state 测试；真实 failure driver 无 | 与 AU-10 recovery 合并补 service disconnect / Channel failure reading driver | 否 | AU-10 recovery / AU-08 failure follow-up | 是，已登记后续 |
| SC-AU08-D3 阅读模式真实入口可被作者发现 | 已验收 | 无 | 无 | - | 本轮 8 个 AU-08/cross evidence 均从真实工作台可见入口进入阅读或读取投影 | 保持 regression | 否 | keep regression | 是 |
| SC-AU08-D4 阅读模式有自动化验收 | 已验收 | 二轮发现单个 cross driver 文案等待漂移；已修复并复跑。D1 no-write 与 B4 return-context 专项已补真实 Tauri driver | quality harness drift / 验收补强 | P1 | 本轮通过 `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`p1-word-count-audit`、`p1-chapter-expansion-multichapter`、`p1-export-minimum`、`p1-chapter-draft-generation`、`au02-unadopted-candidate-no-reading-fact`、`su02-artifact-projection-trace-isolation`、`au08-reading-readonly-no-write`、`au08-reading-return-context` | 已补 `p1-chapter-draft-generation` 外部 driver、`au08-reading-readonly-no-write` 与 `au08-reading-return-context` 外部 driver/verifier；后续保持 nightly | 是，已关闭 | AU-08 quality regression | 是 |

二轮退出判断：AU-08 当前没有未关闭的本文件内 P0；本轮应关闭的 P1/cross-reference driver 漂移、D1 no-write 专项和 B4 return-context 专项均已关闭并复跑通过。剩余 P1 都需要新的 projection refresh/status 产品能力或异常降级 driver，不应以当前核心阅读链路证据冒充完整状态机闭环。满足进入 AU-09 的二轮退出标准。

## 7. 决策日志

- 2026-06-21 — 不再沿用 2026-05 “AU-08 0/16 完整验收”的旧口径。当前真实链路已经有 Channel/Application/Persistence Reading Projection；核心阅读主链以 P1 chapter drivers 为当前 evidence source。
- 2026-06-21 — Projection refresh job/status machine 仍未闭环：专用 refresh action、REBUILDING/FAILED 真实来源、refresh no-write driver 登记为 AU-08 P1，不把普通聊天文本 refresh 伪装为已完成的 projection refresh。
- 2026-06-21 — 本 checkpoint 只补外部 harness/quality/docs/tasks，不改产品代码，因此没有新增产品验收感知逻辑。
- 2026-06-21 — `scripts/tauri_slice_verify.sh` 的 `sync_tauri_conf` 改为幂等覆盖，避免目标内容不变时仅因重写 `tauri.conf.json` 触发 Tauri watcher 重建；这是验收 harness 稳定性修复，不改变产品 runtime。
- 2026-06-22 — 二轮复核发现 `p1-chapter-draft-generation` 旧 driver 仍等待“待确认的创作材料”文案，当前真实 UI 已是“待保存章节草稿/章节正文草稿”。修复只在外部 driver：点击可见“阅读”按钮后等待新的 `channel.get_toc.done`，并继续断言未采纳 prose 不进阅读。生产 runtime 未改。
- 2026-06-22 — 二轮补 `au08-reading-readonly-no-write` 关闭 `SC-AU08-D1` no-write 专项。外部 Tauri driver 从真实工作台生成/采纳正文后进入阅读模式，点击真实导出和返回，verifier 只消费 UI frames / app JSONL / `slice_verify.ui_state.done` 证据，断言无 `author_action`、无 `user_message`、无 adoption、无 tool dispatch、无 production write claim，且返回工作台后输入/发送恢复可用。生产 runtime 未改，refresh 专用 no-write 仍归 C2 后续。
- 2026-06-22 — 二轮补 `au08-reading-return-context` 关闭 `SC-AU08-B4` 返回上下文专项。外部 Tauri driver 从真实工作台生成/采纳正文后进入阅读模式，点击真实返回，再发送 follow-up，verifier 断言返回动作本身无 `author_action` / `user_message`，follow-up 的 websocket `channel.user_message.start/done` 与 `turn_result` 保持同一 `work_id` / `session_id`。生产 runtime 未改。

## 8. 试行反馈

- AU-08 历史 evidence `au08-adoption-reading-projection` 仍可作为背景，但当前可复跑入口应优先使用 `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`p1-chapter-expansion-multichapter` 等 `tauri_slice_verify.sh --list` 中的 slice。
- Reading Projection 的“当前可读”与“异步 projection refresh job/status machine”应分开验收；前者是 AU-08 文件级核心，后者是后续 P1 能力。
