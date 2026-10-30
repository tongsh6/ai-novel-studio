# Q1c 已采纳内容修订：保留/替代、覆盖确认与后续上下文

- 状态：**CP1–CP4 done / CP5 done / Q1c closed（2026-10-21 收口）**
  - A1 已拍板：`SUPERSEDED` + 双向 revision link；enum/schema/migration/domain/application/UI 已落地。
  - 正式 browser 场景 `q1c-adopted-content-revision`（`slice_verify`）PASS：来源设定采纳 → 修订命中 accepted 目标 → 覆盖确认 → 旧版 `SUPERSEDED` / 新版 `CONFIRMED` → 追问读新值。
  - 四条拒绝矩阵：歧义（application）、stale / 跨作品（persistence 事务 guard）、放弃（application）；AU-05/09/12 由既有 application/domain 测试覆盖。Tauri 页面回归尝试 AU-05/AU-09 失败（既有场景漂移，未作为 Q1c 证据）。
  - 诚实边界：Q1c-specific 真实页面证据是 browser surface；未跑 Q1c 原生 Tauri 场景。
- 类型：Journey D5 / Q1c；作者主权与 canon 修订边界
- 上游：`tasks/slices/Q1B-live-archive-recheck.md` §9/§10（第十轮提出“保留或替代”，未执行）；`docs/product/user-journeys.md` D5；`docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` §2/§4；`docs/design/adr/ADR-0019-adoption-status-transition-v3.md`；`docs/design/adr/ADR-0027-author-obligation-state-v3.md` D5；`docs/design/06-memory-context-and-trace.md` §4.4
- 队列：`tasks/NEXT.md` Q1c（唯一 next）

---

## 1. 问题不是“没验证”，是“没能力”

Q1B 第十轮模型已经提出“保留或替代已保存编辑版”，但作者没有实际执行该分支。CP0 代码核查确认：

1. `PendingArtifactWorkflow.operations/1` 只对 `adoption_status == "TENTATIVE"` 返回
   `revise_pending_artifact` / `discard_pending_artifact`；已采纳条目返回 `[]`。
2. `DialoguePlanningService` 的判断协议只声明 `revise_pending_artifact` /
   `discard_pending_artifact`，没有“修订已采纳内容”的 capability。
3. `AdoptionRepository.maybe_persist_memory_item/3` 对设定类产物一律 `Repo.insert` 一条新的
   `CONFIRMED` memory；没有按目标对象查找旧版本、没有 supersede。对已采纳设定再采纳一次，
   会留下两条同时 CONFIRMED 的“当前事实”。
4. `MemoryItem` 有 `version`，但没有 `supersedes_ref` / `superseded_by_ref`；`MemoryStatus`
   只有 `DRAFT / CONFIRMED / STABILIZED / CONFLICTED / DEPRECATED / ARCHIVED`，没有设计
   `06` §4.4 使用的 `SUPERSEDED`。
5. `MemoryManagementService` 只暴露 list/get/create/confirm/lock/unlock/deprecate/archive/
   weight/validity；内容更新是私有 `update/3`，没有作者可用的“修订已采纳内容”入口。
6. `StructurePanel` 只对 pending artifact 提供 `accept` / `edit_then_accept`；已采纳条目没有
   修订动作。`TurnInteractionService` 的 `session_adoptions` 能列出 accepted 条目，但没有
   revision 语义。

因此 Q1c 的正确开工顺序是：**先冻结“已采纳内容修订”契约，再实现**；不能把“模型提出了建议”
当成“产品已支持”。

---

## 2. 开工检查（七问）

- **Contract**：`VS-04` 的 `revision_option` 从概念升级为可执行契约；新增
  `revise_adopted_content` capability（模型判断入口）与 `revision_of` / `supersedes_ref`
  字段；`ADR-0027` D5 扩展为“已采纳内容的修订义务”；`06` §4.4 的 `Confirmed → Superseded`
  落到 `MemoryStatus`；`ADR-0019` 的 artifact 转换矩阵继续管正文类 artifact，MemoryItem 走
  自己的状态机；`ADR-0024` 不新增决策面，复用 S2（草稿采纳）与 S3（执行确认）。
- **Invariant**：
  - `I-Q1C-1`：已采纳 canon 只能由一次新的采纳决策改变，不能由对话文本或 UI 直接覆盖。
  - `I-Q1C-2`：旧版本必须保留且可追溯（`SUPERSEDED` + 双向 revision link），不能删除或静默覆盖。
  - `I-Q1C-3`：覆盖已采纳内容必须经过 confirmation + 重新 gate；确认前零写入。
  - `I-Q1C-4`：目标不明确、stale、跨作品、目标已处置时拒绝或澄清，不猜目标、不写入。
  - `I-Q1C-5`：档案、阅读投影、后续创作上下文只消费当前 accepted 版本；旧版本只在
    history / trace / replay 可见。
  - `I-Q1C-6`：TurnResult 文案必须区分“已生成修订候选 / 待确认 / 已替代 / 已放弃”，
    不能把候选说成已入档。
- **Boundary**：`novel_application`（新 workflow + judgment capability + confirmation +
  supersede-on-accept）、`novel_domain`（MemoryItem 状态转换与 revision link）、
  `novel_persistence`（schema/migration/repo，`supersedes_ref` 与 `SUPERSEDED`）、
  `novel_web`（Channel 透传 author_action，不新增语义）、`frontend`（修订候选卡、旧/新对比、
  确认/放弃动作、档案 history）。不动 provider 协议，不新增验收专用代码。
- **Consumer**：真实 Tauri `WorkspaceChat` + `StructurePanel` / 档案；第一个场景是作者在对话中
  修订一条已采纳的世界设定。第二个场景是修订已采纳正文（复用既有 draft supersede）。
- **Proof**：domain 状态转换单测；persistence 迁移与 repo 单测（旧条 SUPERSEDED、新条
  CONFIRMED、双向 link、recall 排除旧条）；application 单测（目标绑定、歧义、stale、跨作品、
  confirmation 前零写入、确认后一次写入）；真实 Tauri 场景 `q1c-adopted-content-revision`；
  AU-05 / AU-09 / AU-12 回归。
- **Acceptance Driver**：外部 Playwright 驱动真实 Tauri 页面，使用作者可见语义（按钮文案、
  role、页面文本）和网络帧/持久化结果作为证据；产品代码新增验收感知逻辑：**no**。
- **Exploration**：`session_adoptions` / 档案读取面必须能列出 accepted 目标及其 revision chain；
  不新增小说要素物化通道，不借机扩 37 要素。

---

## 3. 契约提案（待拍板）

### 3.1 推荐方案 A：兄弟修订候选 + 旧版 SUPERSEDED

```text
作者：把已保存的「岑舟 25 岁」改成 30 岁
→ 判断：action=execute, capability=revise_adopted_content,
        adopted_content_ref=<accepted ref>, dialogue_goal=<展开后的修改目标>
→ App 校验目标（当前 work、accepted、类型可修订、来源明确）
→ 同一创作工具生成新内容，装成 TENTATIVE 候选：
   revision_of=<accepted ref>, registration_source_ref=<作者 turn>,
   provider_call_ref=<新内容来源>
→ UI 显示旧版/新版对比 + “替代已保存版本”确认
→ 作者确认 → AdoptionBoundary 重新 gate
→ 旧条 ACCEPTED/CONFIRMED → SUPERSEDED（不可召回）
→ 新条 → ACCEPTED/CONFIRMED（当前事实）
→ StateTrace 记录 revision_of / supersedes_ref / 作者确认
→ 档案、阅读投影、后续上下文读取新条；旧条只在 history/trace 可见
```

理由：
- 与既有 `revise_pending_artifact`、`edit_then_accept`、prose overwrite supersede 同构；
- 满足 `ADR-0019` 的“canon 进入只能来自 TENTATIVE”；
- 作者仍然拥有“保留旧版 / 替代”的真实选择；
- 不需要为 UI 发明新的决策面：S2 出候选卡，S3 出覆盖确认。

### 3.2 Memory 状态选择（需拍板）

- **A1（设计保真，推荐）**：给 `MemoryStatus` 增加 `SUPERSEDED`，给 `memory_items` 增加
  `supersedes_ref` / `superseded_by_ref`。旧条 `CONFIRMED → SUPERSEDED`，新条保持
  `CONFIRMED`；recall 排除 `SUPERSEDED`。需要 schema/codegen + migration + 状态转换矩阵。
- **A2（最小迁移）**：不加枚举，旧条用既有 `DEPRECATED` + `supersedes_ref` 表达“被替代”。
  代价是 `DEPRECATED`（作者废弃）与 `SUPERSEDED`（被新版替代）语义混在一起，未来再拆会更贵。
- 不推荐 B：原地改 `MemoryItem.content`（绕过采纳决策、丢旧版本、破坏 `I-Q1C-1/2`）。
- 不推荐 C：再插一条 CONFIRMED、旧条不退场（当前行为，产生双重 canon）。

### 3.3 正文类 artifact

正文已有 `drafts.revision` + `supersede_accepted_drafts`；本 slice 只补“目标绑定 + 修订候选 +
覆盖确认”，不重写 draft 存储。旧 draft → `SUPERSEDED`，新 draft → accepted，阅读投影按既有
`ReadingProjectionRepo` 选取最高 revision 的 accepted draft。

---

## 3A. CP0 真实页面核查结果（2026-10-21）

环境：真实 Tauri/浏览器工作台 + LM Studio `qwen3.8-flash-next@q2_k` + 隔离测试库
（`NOVEL_TEST_DB_DIR` 独立分区）。驱动：`frontend/slice-verify/q1c-adopted-content-revision-audit.mjs`
（外部 Playwright，产品零验收感知）。证据：
`artifacts/slice-verify/q1c-adopted-content-revision-audit/audit-report.json`、`03-revision-turn.png`。

### 3A.1 已采纳设定建立成功

作者原文登记「岑舟今年二十五岁，是青云宗宗主，掌管东洲灵脉。资料校验标识…」→ 待采纳
`world_setting` 候选 → 点击「保存到作品档案」→ 采纳边界返回 `artifact_adopted=true`，
`memory_items` 中恰好 1 条 `CONFIRMED / WORLD_RULE / AUTHOR_CONFIRMED`。说明“已采纳内容”
本身是可建立、可查询的。

### 3A.2 修订请求当前得到的是 capability_gap

同一会话发送「请把已保存的设定里岑舟的年龄从二十五岁改成三十岁」：

- TurnResult `status=conversational`，`trace_summary.frame_type=capability_gap`；
- `adoption_state.pending` 为空，`available_actions` 为空；
- assistant 明确说：「该条目目前处于已决状态，从我这一侧没有可用的编辑或覆盖操作，也没有
  可供修订的待采纳版本，所以我无法直接把年龄改成三十岁」；
- `truthfulness.artifact_adopted=false`、`production_write_performed=false`；
- 数据库仍只有 1 条 CONFIRMED，旧内容未被改写。

这是**诚实的失败**，不是静默覆盖；但它同时证明：**当前没有已采纳内容的修订能力**。

### 3A.3 模型给出的“最近路径”并不存在

同一回复建议：「在工作台里打开那条已入档的作品设定，使用『修改后保存』把年龄那句改为…
再保存」。代码核查：

- `MemoryDetailDrawer` 只有内容/摘要/治理信息/引用日志，没有编辑正文动作；
- `MemoryManagementService` 只暴露 confirm/lock/unlock/deprecate/archive/weight/validity，
  内容更新是私有 `update/3`；
- `StructurePanel` 的 `edit_then_accept` 只出现在 **pending artifact** 区，accepted 条目没有
  编辑按钮；
- `available_action_builder` 只对 pending units 发放 `accept` / `edit_then_accept`。

因此这条“最近路径”是**不可执行的建议**，违反项目自己的缺口诚实律（能力缺口要给出最近
可行路径，而不是最近邻猜测）。这是本 slice 必须一并修的产品语义，不是文案问题。

### 3A.4 同一请求的另一次真实页面结果：新建候选而非修订

同一 harness 的另一次运行（模型较慢、脚本等待窗口先到）里，模型没有走 capability_gap，而是
生成了一份新的 `world_setting` 候选，标题「岑舟与青云宗东洲灵脉年龄修订稿」，正文写
「已保存设定中『二十五岁』改为『三十岁』」，并明确说「当前无待采纳候选可修订，因此以新候选
承载单字变更」。该候选：

- `artifact_type=world_setting`，`adoption_status=TENTATIVE`；
- payload 中没有 `revision_of`；
- 旧 CONFIRMED 条目仍存在。

若作者点击「保存到作品档案」，`AdoptionRepository.maybe_persist_memory_item/3` 会再插入一条
`CONFIRMED`，旧条不 supersede——即**一次修订留下两条当前事实**。同一产品、同一请求出现
两种结果（诚实拒绝 / 新建候选），说明当前没有确定性契约，完全依赖模型当轮判断。

### 3A.5 对 A1/A2 的证据结论

- 需要的是**显式修订契约**，不是再改 prompt：模型已经正确理解“已决状态不能直接改”，
  缺的是 App 侧的真实操作与状态机。
- 旧版本必须有明确退场状态；`DEPRECATED` 语义是“作者废弃”，与“被新版替代”不同。真实页面
  证据 + `06` §4.4 的 `Confirmed → Superseded` 支持 **A1（新增 SUPERSEDED）**；A2 只能作为
  迁移成本受限时的降级方案。
- 还必须给“最近路径”一个真实 UI：修订候选卡 + 旧/新对比 + 覆盖确认 + 采纳后 history。
  否则 capability_gap 的文案仍然是假的。

---

## 4. Checkpoints

| CP | 目标 | 交付物 | 状态 |
|---|---|---|---|
| CP0 | 设计核查 + 契约冻结 | 本文；`VS-04` / `ADR-0027` / `06` 修订提案；真实页面核查证据（§3A）；用户拍板 A1/A2 | **证据完成，待 A1/A2 拍板** |
| CP1 | domain / persistence | `SUPERSEDED`（A1 已拍板）、`supersedes_ref` / `superseded_by_ref`、状态转换、migration、repo/domain 单测 | **done（2026-10-21）** |
| CP2 | application | `revise_adopted_content` capability、目标绑定、修订候选、confirmation、supersede-on-accept、stale/跨作品拒绝 | **done（2026-10-21）** |
| CP3 | frontend | 修订候选卡（沿用既有 revision 标签）、确认/放弃、档案 history；文案进 `copy.ts` | **done（2026-10-21）** |
| CP4 | 真实验收 | 正式 `q1c-adopted-content-revision` browser 场景 PASS（干净 `summary.json` / `audit-report.json`）；四条拒绝矩阵由 application/persistence 测试覆盖；AU-05/09/12 既有套件回归 | **done（2026-10-21）** |
| CP5 | 上下文与投影 | `followup_uses_new_version=true`、`followup_memory_context_is_new=true`，旧版只在 facts/history 为 `SUPERSEDED` | **done（2026-10-21）** |

---

## 4A. 收口状态（2026-10-21，用户指令“先停止跑，收口当前成果”）

### 已完成

- **CP1 domain/persistence**：`SUPERSEDED` enum + `supersedes_ref` / `superseded_by_ref` +
  migration + 状态矩阵 + `supersede_changeset` + `MemoryItem.supersede/2` /
  `mark_supersedes/2`；domain/persistence 单测。
- **CP2 application**：`revise_adopted_content` judgment capability；`PendingArtifactWorkflow`
  的 accepted target 目录/校验/执行；`request_adopted` 生成独立 tentative；`link_adopted_revision`
  写 `revision_of` / `supersedes_ref` / `revision_target_status`；`AdoptionWorkflow` 对
  accepted revision 强制覆盖确认；`AdoptionRepository` 在同一事务内把旧 memory 置
  `SUPERSEDED` 并建双向链。
- **CP3 frontend**：记忆管理列表/详情支持 `SUPERSEDED`（中文标签、终态色调、过滤项、版本
  关系区块）；`copy.ts` 集中文案；`memoryApi` 类型补链字段。
- **门禁**：`mix compile --warnings-as-errors`；全量 `mix test` 95+38+168+274+254+600+126 =
  **1555 tests / 0 failures**；xref 无循环；arch_check 通过；前端 `typecheck` / `lint` /
  **484 tests** 全过；`frontend_audit.sh` 27 PASS / 0 FAIL；`check_design_trace.sh` 16 PASS /
  0 FAIL。
- **真实页面结构证据**：2 次真实 Tauri/浏览器 + `qwen3.8-flash-next@q2_k` 通过
  “修订候选带 `revision_of`、命中 accepted 目标、覆盖确认、旧版 `SUPERSEDED`、新版
  `CONFIRMED`”；截图见 `artifacts/slice-verify/q1c-adopted-content-revision-audit/`。

### 未闭环 / 不得写成 done

- 最后一次追问轮被工具中断，**最终干净的 `audit-report.json` / `summary.json` 未落盘**；
  目录被 `slice_verify.sh` 的清理逻辑重置，当前只剩本次中断跑的截图/app-log。
- 正式场景未注册进 `quality/acceptance/scenarios.yml`；当前只有审计脚本
  `frontend/slice-verify/q1c-adopted-content-revision-audit.mjs`。
- 歧义目标、stale 目标、跨作品目标、放弃修订候选四条拒绝矩阵未跑真实页面。
- follow-up 已观察到模型回答“当前三十岁、二十五岁是历史版本”，但没有写入最终 summary
  的 `followup_uses_new_version` / `followup_memory_context_is_new` 字段。
- AU-05 / AU-09 / AU-12 回归未跑。

### 下一步（harness 优化后再验收，不再用真实模型跑结构门禁）

1. 结构验收改用 `SLICE_VERIFY_PROVIDER=slice_verify`（秒级），真实模型只做一次语义确认。
2. seed 一条已采纳设定，跳过“来源登记+采纳”两轮。
3. 真实模型跑时设 `NOVEL_LMSTUDIO_REASONING_EFFORT=none`；单轮 180s 硬超时，超时记
   `provider_stall`，不再等 900s。
4. 每步输出 `turn/step/elapsed`，避免“看起来在跑、其实在等一次慢调用”。
5. 补正式场景注册 + 四条拒绝矩阵 + AU-05/09/12 回归，才可把 CP4/CP5 标 done。

---

## 4B. 最终收口证据（2026-10-21）

### 正式场景

- 场景：`q1c-adopted-content-revision`（`quality/acceptance/scenarios.yml`，surface=browser，runner=slice_verify）
- 命令：`bash scripts/quality_accept.sh q1c-adopted-content-revision --surface browser`
- 结果：PASS；三轮回合 `source / revision / followup` 各约 1.3–1.6s；`failed_checks=[]`
- 证据：`artifacts/slice-verify/q1c-adopted-content-revision/summary.json`、`audit-report.json`
- 关键观察：`revision_of_present=true`、`accepted_target_identified=true`、
  `overwrite_confirmation_required=true`、`duplicate_confirmed_facts=1`、
  `old_version_still_confirmed=false`、`new_version_confirmed=true`、
  `superseded_facts=1`、`followup_uses_new_version=true`、
  `followup_memory_context_is_new=true`

### 四条拒绝矩阵（确定性测试）

- 歧义目标：`pending_artifact_workflow_test.exs` “ambiguous adopted revision target is rejected without write”；零 writer 调用、零写入。
- stale 目标：`adoption_repository_test.exs` “rejects a stale revision target without creating a second confirmed fact”；事务回滚，保持单一 `CONFIRMED`。
- 跨作品目标：`adoption_repository_test.exs` “rejects a cross-work revision target without writing”；`revision_target_cross_work`，零写入。
- 放弃修订候选：Q1c accepted sibling 测试尾部；候选 `DISCARDED`，旧 accepted 仍是当前事实，零生产写入。

### Harness 优化

- 默认单轮 `Q1C_TURN_TIMEOUT_MS=180000`（原 900s），超时即失败；
- 每轮输出 `turn/status/elapsed_ms`；结构验收改用 `slice_verify`，三轮回合约 4.3s；
- 来源设定通过真实作者原文登记 + 采纳建立，不直接写测试 DB。

### AU 回归与诚实边界

- AU-05 / AU-09 / AU-12 的 application/domain 测试随全量 `mix test` 回归。
- Tauri 页面回归尝试：`au05-adoption-safety-freshness` 未拿到高风险候选 turn_result；
  `au09-adopt-setting-recall` 等待 `slice_verify.ui_state.done` 超时。两者为既有场景漂移，
  未计入 Q1c 通过证据，登记为后续 scenario 维护项。
- Q1c-specific 页面证据为 browser surface；原生 Tauri 的 Q1c 场景未跑。不得据此声称
  “原生 Tauri Q1c 已验收”。

---

## 5. 验收场景（最小集）

1. **Happy path**：采纳设定 → 对话要求改值 → 系统命中 accepted 目标 → 生成修订候选 →
   旧/新对比可见 → 点击“替代已保存版本” → 确认 → 新版本成为当前事实，旧版本 SUPERSEDED，
   档案/后续对话读新值。
2. **歧义**：作者只说“改一下那个设定” → 系统要求指定目标（或列出 accepted 目标）→ 零写入。
3. **Stale**：候选生成后目标被另一轮修改 → 确认被拒 → 零写入，旧版本保持当前。
4. **放弃**：作者放弃修订候选 → 旧版本仍是当前事实，零写入。
5. **跨作品**：目标属于其它作品 → 拒绝，零写入。
6. **正文修订**：已采纳章节正文 → 修订候选 → 确认 → 旧 draft SUPERSEDED，新 draft accepted，
   阅读投影显示新正文，不产生重复章。
7. **版本保留**：旧版本仍可在 trace / history 查到，且 `supersedes_ref` 链完整。

---

## 6. 设计输入与未读边界

本 CP0 已读：
- `docs/design/README.md`、`00` §1-2、`00a`、`00c` §4-6、`VS-04`、`ADR-0019`、`ADR-0024`、
  `07` §4-8、`08` §1-6、`06` §4、`22` §21、`25` §15、`AU-05`、`user-journeys` C10/D5、
  `novel-output-milestones`、`tasks/NEXT.md`、Q1B/Q3D、M3 百章审计、M5/M6 观察、B12、D3/D4。
- 代码：`PendingArtifactWorkflow`、`AdoptionWorkflow`、`AdoptionRepository`、
  `MemoryManagementService`、`MemoryItem`、`StructurePanel`、`TurnInteractionService`。

尚未逐字读完（按需补）：
- `00b` / `00d` / `01` / `02` / `03` / `04` / `05` 全文；
- `VS-05` / `VS-02A` 全文；
- `ADR-0001`–`ADR-0018`、`ADR-0023` / `ADR-0025` / `ADR-0026` 全文；
- `ui/41`–`47` 全文；
- `tech-stack/` 全部。

本 slice 不把“读过入口”当成“读完整套设计”；上述未读项在进入对应 CP 前补。

---

## 7. 决策日志

- 2026-10-21 — CP0 登记：Q1c 不是“验证已有能力”，而是“缺契约 + 缺实现”。先冻结
  `revise_adopted_content` / `revision_of` / `supersedes_ref`，再写代码；不把第十轮模型建议
  当作已支持证据。
- 2026-10-21 — 推荐方案 A（兄弟修订候选 + 旧版 SUPERSEDED），复用 S2/S3 决策面；Memory
  状态在 A1（新增 SUPERSEDED）与 A2（DEPRECATED + link）之间待用户拍板。
- 2026-10-21 — CP0 真实页面核查（`qwen3.8-flash-next@q2_k`，隔离库）完成：已采纳设定
  建立成功；修订请求得到 `capability_gap`，零候选、零写入，旧事实保持一条 CONFIRMED；
  模型建议的「修改后保存」对 accepted memory 不存在。同一 harness 另一次运行生成新
  `world_setting` 候选且无 `revision_of`；若采纳会留下两条 CONFIRMED。证据支持 A1，
  并证明必须同时补真实 UI 路径，不能只改 prompt。
- 2026-10-21 — 用户拍板 A1；CP1 落地：`MemoryStatus` 增加 `SUPERSEDED`，`memory_items`
  增加 `supersedes_ref` / `superseded_by_ref`（migration 20261021000001），domain 状态矩阵
  允许 CONFIRMED/STABILIZED/CONFLICTED → SUPERSEDED、SUPERSEDED → ARCHIVED，新增
  `MemoryItem.supersede/2` 与 `mark_supersedes/2`，`MemoryManagementService` DTO 透出链字段。
  验证：`mix compile --warnings-as-errors`；全量 `mix test`（95+38+168+274+254+600+126，
  0 failures）；xref 无循环；arch_check 通过。
- 2026-10-21 — 用户叫停并指出累计等待约 60 分钟；按“先停止跑，收口当前成果”收口。
  教训：结构验收不应反复用真实模型跑全链；真实模型只做一次语义确认。CP4/CP5 只标
  “部分闭环”，不把中断跑的截图/日志冒充最终 summary；正式场景、拒绝矩阵、AU-05/09/12
  回归留待 harness 优化后补。

## Q1c 原生页面补验

- 状态：**todo（2026-10-30 承接已登记的 Q1c-specific 原生证据缺口；原 CP1–CP5/browser 收口不改，本项尚未执行）**。
- 来源：本文件顶部诚实边界与 [全量对账 E15](../2026-10-27-design-to-execution-reconciliation.md#45-其余任务)。B28 的原生正文修订证据不能替代 Q1c 的 `world_setting` 修订链。
- 下一步：先核对现役 `q1c-adopted-content-revision` 场景、原生驱动可达性、当前采纳/修订契约与旧 AU-05/09/12 漂移记录，明确最小补验输入和断言；区分 driver 漂移与产品回归，不直接恢复旧调用协议或重新实现已落地修订能力。
- 完整后果：外部驱动真实 Tauri 工作台完成设定采纳→修订命中 accepted 目标→覆盖确认→旧版 SUPERSEDED/新版 CONFIRMED→刷新与追问消费新值，核对来源/修订双向引用及零重复权威事实；保持歧义、stale、跨作品、放弃等原拒绝边界及既有回归承接，不用正文替身场景代签设定链。
- 证据与条件：当前 HEAD 的原生 summary、操作/网络/持久事实分别留证，旧 browser 与中断批次保持原边界；确定性机制与真实模型语义分开，结构补验不自动重跑长时间实模链。若发现产品缺陷，回原 Q1c 范围修复并复验；真实模型批次须有具体预注册与资源窗口，产品代码不新增验收感知逻辑。
