# B24-探索面全章可读：chapter_read 分段预算 + 续读

**状态**：**registered（2026-10-23 作者定向开档；CP0 契约冻结 = 本文档 §1.1，CP1+ 待开工）**。
**来源**：2026-10-23 00:17 stage 真实会话（turn `message_ce1b5c9f-3d15-4cc7-8b49-ff8b22f585e4` / run `run_mvjquwek_9`）中，作者要求「审核第一章内容，我发现有重复的」，AI 回复「当前我能看到第一章的开头、摘要和部分正文，但可见正文被截断，不能完整核对全章重复」。作者判定这是产品侧读取路径缺口，定向「方案 A 开一个 slice」。
**关联既有 slice**：`UA01-judgment-driven-loop.md`（CP5a/CP5b 探索内部翼：工具目录、观察渲染、回合硬上限 2、clip 1500 的来源）；`UA01-agentic-loop-prompt-hardening.md`（判断 prompt 资产 / VS-00I 前缀稳定性，本 slice 改动目录与观察文本须复跑 I-CACHE-1）；`B23-awaiting-author-reason-and-exit-surface.md`（同 stage 诊断先例；不改变其停等/出口语义）；`P1-word-count-audit.md`（**方案 B** 确定性重复段/重复章检测归其 checkpoint B，本 slice 明确不做，只解读取能力）。
**设计真源**：`docs/design/adr/ADR-0025-judgment-driven-interactive-loop-v3.md` §决策范围 #3 / §3 内部翼（**「工具与索引细节由 slice 冻结」**）、`docs/design/08-novel-element-model.md` §8 探索面同步律、`docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md`（AgentRun / AgentStep / observation）、`docs/design/contracts/VS-00I-prompt-prefix-stability-contract-pack.md`（prompt 前缀稳定）、`docs/design/ui/46-state-and-feedback.md` §9（活动行文案）。

## 0. 现状核查（2026-10-23 只读侦察，stage 库 + app JSONL + LLM 调用日志）

### 0.1 现象的真实构成：不是模型能力问题，是探索读取合同问题

| # | 环节 | 事实（本次真实会话） | 代码/证据锚点 |
|---|---|---|---|
| F1 | 判断上下文不含正文 | 判断①上下文只有章节列表（标题/是否已写）等材料；作者点名章只补标题，明写「各章正文细节不在本段内」 | `dialogue_planning_service.ex:1151-1162,1187`；llm-calls 第 1 次调用 user content |
| F2 | `chapter_read` 两道硬截断 | 观察共 **1505 字符** = 标题/正文头 ≈21 +【计划】**937** +【摘要】331 +【正文】**216**（本章有效字 **4,398**，两场 raw 5,495 字符）→ 正文可见 **4.9%**；结束于「…（截断）」 | `exploration_service.ex:33-34`（1500/1200）、`:371-380`（计划/摘要/正文拼接后统一 clip）、`:600-610` |
| F3 | 无续读语法 | 第 2 次判断再次选择 explore；同一 query `第01章` 的观察与第 1 次**逐字节完全相同**（1505=1505，identical=True），零新信息 | stage 库 `agent_events` run `run_mvjquwek_9` sequence 136/244；app JSONL `judgment.decided` 3 条 |
| F4 | 探索回合硬上限 2 | 第 3 次判断时 `@max_explore_rounds = 2` 已耗尽，探索目录段不再注入（第 5 次 LLM 调用 catalog=False），只能 reply；AI 的「不能完整核对」是诚实结论 | `dialogue_planning_service.ex:430,656`；llm-calls 第 4/5 次调用 |
| F5 | 上下文窗口不是瓶颈 | 6 次判断调用 `input_tokens` 9,295 → 21,900；整章 raw 5,495 字符 ≈ 2–3k tokens（按本轮实测 ≈1.9 字符/token），约占最后一次 prompt 的 10–14% | llm-calls 第 1–6 次调用 response usage |

**结论**：AI 不是「不想读」——它试了两次并被硬预算挡住；真正缺口是探索面的读取合同：**一条 1500 字观察预算被设计态材料挤占 + 没有续读 + 每轮最多 2 次探索**。

### 0.2 回归时间线：一条为「只装正文」设计的预算被后续加料挤占

| 时间 | 变更 | 影响 |
|---|---|---|
| 2026-07-19 18:04 | CP5a（`dcdc3860`）探索内部翼上线：`chapter_read` 只返回已采纳正文，`@chapter_clip_chars 1200` + `@summary_max_chars 1500` | 当时 1500 预算只装正文，够用（最多 1200 正文 + 标题） |
| 2026-07-19 21:39 | CP5b（`39b31efe`）`chapter_read` 三态渲染：【计划】+【摘要】+【正文】 | **未重新分配预算**；计划/摘要开始吃正文额度 |
| 2026-08-11 | NEM04（`d455bc70`）场次计划进 `chapter_read` | 【计划】继续变长 |
| 2026-08-24 | WR01b（`8af78cc2`）本章使命/必须推进/不得进 `chapter_read` | 使命段 ≈464 字符（本次样本） |
| 2026-10-22 00:35 | B11C（`67370bd6`）场级 craft 子槽进 `chapter_read` | 场次计划段继续变长 |
| 2026-10-22 01:20 | B11A CP4（`6290eda8`）卷蓝图进 `chapter_read` | 【计划】段加料链最后一环 |
| 2026-10-23 00:17 | 真实作者触发审核请求 | 【计划】937 / 1505 = 62%，正文只剩 216 字 |

每次加料都符合「08 §8 探索面同步律：要素物化必须探索可达」，但**没有任何 owner 对「总观察预算 / 分段优先级」负责**，加料变成对正文的挤占。现有测试只断言各段出现（`exploration_service_test.exs:152` 起），不校验正文可见比例，故回归未被拦住。

### 0.3 本 slice 不做 / 另立归属

- **确定性重复段/重复章检测（方案 B）** → `P1-word-count-audit` checkpoint B（`tasks/slices/P1-word-count-audit.md:91-95`；`docs/product/novel-output-milestones.md:67` 要求重复章 0）。本 slice 只解「AI 能读到完整正文」这一前置能力。
- **单轮超过 12,000 字符的章节 / 3 章以上批量全文阅读** → 本 slice 受既有 `@max_explore_rounds 2` 限制，登记为后续 gap（见 §7）；不在本 slice 擅自放宽回合硬上限。
- **provider 自适应观察预算 / AssemblyPolicy 档位接入** → 登记 gap。现状 `AssemblyPolicy` 已有 floor 2000 / standard 8000 / large 200000 chars（`assembly_policy.ex:35-40`），但探索服务没有 provider 上下文；且 `strata` 仍映射 floor（`assembly_policy.ex:41-47`），与今天实际能处理 2 万 token 判断 prompt 的事实不符，档位校准另立。
- **判断上下文直接注入全章正文（方案 C）** → 不做；放大每次判断 prompt，且多章不经济。
- **判断循环「先问再做」倾向调参** → `UA01-agentic-loop-prompt-hardening` / 狗粮观察。
- **观察在 call2 prompt 被渲染两遍**（本 slice 顺带修，见 CP2；证据：最终判断 prompt 中 2 条观察出现 4 次）。此项若要单独评估可拆出，但修复成本低且直接减少本 slice 观察变大后的 prompt 压力。

## 1. 开工检查（七问）

1. **Contract**：ADR-0025 §决策范围 #3 / §3 内部翼明确「工具与索引细节由 slice 冻结」；本 slice 在 §1.1 冻结 **`chapter_read` 观察合同 v2**（query 语法 / 分段预算 / 续读元数据 / 回合与 no-progress 语义）。消费既有读取语义：`ReadingProjectionService.chapter_content/2`（每 scene 最高 revision accepted）、`ChapterSummaryRepo.current_accepted/2`、`ChapterPlanDirection.from_storage/1`——**不新建平行读路径**。不新增 ADR、不改 JSON Schema、不改持久化 schema；observation 仅在 application 内部 stage_state 增可选键，`agent_events.payload` 沿用既有 map。
2. **Invariant**：
   - **I-EXPLORE-READ-1（页覆盖）**：同一章从 offset 0 连续续读时，各页首尾相接、无重叠、无缺口；页码/范围/总数机械一致；最后一页 `next_offset=null` 时其结尾必须等于正文总字符数。
   - **I-EXPLORE-READ-2（正文优先）**：任一 `chapter_read` 观察中可见正文字符数 ≥ min(正文总字符数, 单页预算 6000)；【计划】≤500、【摘要】≤400，设计态材料不得把正文挤到配额以下（本 slice 的回归守卫；旧 1500 预算下正文只剩 216 字即反例）。
   - **I-EXPLORE-READ-3（截断必可续读）**：正文被截断时观察必须同时给出「已返回 x–y / 共 N 字符」与可执行的 `next_offset` 续读 query；不允许只出现「…（截断）」而无续读信息。
   - **I-EXPLORE-READ-4（只读零写）**：`chapter_read` 全程只读，不产生 production write / adoption / tool 写路径 / provider 调用；只读已采纳正文，tentative 草稿不进观察。
   - **I-EXPLORE-READ-5（真重复才 no-progress）**：同 tool+同 query（含 offset）重复观察按既有 no-progress 语义停等；不同 offset 的合法续读不得误触发 no-progress。
   - **I-EXPLORE-READ-6（兼容）**：其它探索工具（`prose_search` / `archive_read` / `memory_recall` / `session_adoptions`）的观察预算与行为不变；`chapter_read` 纯章节名 query 继续工作（等价 offset=0）。
3. **Boundary**：
   - **改**：`novel_application`（`ExplorationService`、`DialoguePlanningService` 探索目录/回合/no-progress signature/prompt 输入去重、`AgenticPlanDraftPlanner` 计划步目录文案；`JudgmentPlan` 计划内探索的 progress signature 同批对齐）、`novel_agent` 仅测试替身（`test/support/provider/slice_verify.ex`）、验收 harness（`frontend/slice-verify/external-ui-driver.mjs` / `native-tauri-verifier.mjs` / `.test.mjs`）、`quality/acceptance/` 与 `scripts/tauri_slice_verify.sh` 注册。
   - **明确不改**：`novel_domain` / `novel_persistence` 结构（只调用既有读端口）、`novel_web` 生产 Channel、前端 `src` 产品代码、ADR-0025 外部探索翼、判断循环「先问再做」prompt、`@max_explore_rounds` 数值（本 slice 保持 2）、provider 窗口策略。
4. **Consumer**：第一真实消费者 = 判断循环 `explore` 分支（`DialoguePlanningService.judgment_explore_result/7` → `ExplorationService.run/4`，即本次失败会话走的路径）；第二 = 计划模式下探索步（`JudgmentPlan.execute_exploration_decision_step/4`，同批获得更大单页）；第三 = 真实作者在工作台提出「审核/核对/引用全章」类请求；验收消费者 = 外部 Playwright/Tauri driver。
5. **Proof**：§5。CP1 单测（页覆盖矩阵 / 预算优先级回归守卫 / 续读语法 / 兼容）；CP2 循环流测试（分页续读、重复页 no-progress、最终回复引用末页独有事实）；CP3 新真实页面场景（确定性 provider）PASS + 既有 `judgment-explore-chapter-plan` 回归；全门禁与 I1/I2/I3/N-NARR/I-CACHE-1。
6. **Acceptance Driver**：新场景 `judgment-explore-chapter-full-read`，`bash scripts/quality_accept.sh judgment-explore-chapter-full-read --surface tauri`：外部 driver 从真实 Tauri 工作台输入作者式请求（发问文本触发 test/support 替身的分页探索），等真实回复；verifier 只读页面可见文本 + app JSONL + WS 帧，断言两页探索顺序/范围/末页事实被引用/零写入。**产品代码新增验收感知逻辑：no**（无 env 开关、无 slice id、无 data-testid、无 autorun；替身只在 test/support 且由脚本环境注入）。
7. **Exploration**：本 slice 不物化新的 novel element 要素，而是修复既有探索读取面本身；`chapter_read` 已覆盖【计划/摘要/正文】三态，本 slice 让正文同批可完整读取，未新增要素物化，故探索面同步律不适用（属于既有面修复 + 读取能力补全）。

### 1.1 契约冻结（CP0）：`chapter_read` 观察合同 v2

**(a) query 语法（向后兼容）**

```text
纯章节名（旧语法，等价 offset=0）:
  第01章
JSON（新语法，续读用；与 session_adoptions 的 {query, offset} 先例同构）:
  {"chapter":"第01章","offset":6000}
```

- `chapter` 非空字符串；`offset` 为非负整数。JSON 解析失败 / 缺 `chapter` → 返回诚实参数错误观察，不做章节匹配、不返回正文。
- 纯章节名解析失败（找不到章）保持现有「没有找到」观察 + 现有章节清单。

**(b) 观察布局与预算**

| 段 | 内容 | 预算 | 说明 |
|---|---|---|---|
| 标题行 | `「章标题」` | — | 现有 |
| 【计划】 | 设计态九字段/场次/使命/卷蓝图（现有渲染） | ≤ **500** 字符（段内截断标「…（略）」） | **仅 offset=0 页返回**；续读页不重复 |
| 【摘要】 | 治理摘要（现有渲染） | ≤ **400** 字符（段内截断标「…（略）」） | **仅 offset=0 页返回**；续读页不重复 |
| 【正文】 | 已采纳正文页 + 范围头 | 单页 **6000** 字符 | 每页都带：`【正文】第 x–y 字符 / 共 N 字符（有效字数 W）`；续读页同格式 |
| 续读 footer | 仅在 `next_offset != nil` 时 | — | 例：`【续读】剩余 N-p 字符；用 {"chapter":"第01章","offset":p} 继续。` |

- 整条观察上限 **7200** 字符（500 + 400 + 6000 + 头部/footer 余量）；不再对整条观察做二次 clip 把正文截掉。其它工具观察仍用既有 `@summary_max_chars 1500`。
- 短章（正文 ≤6000 字符）一次返回**完整正文**，`next_offset=null`，模型无需续读。
- 页切分优先在 `\n\n` 段落边界（≤ offset+6000 内最靠后的边界）；无段落边界时按 6000 硬切。`offset` 语义为正文（各 scene 按现有 `\n` 连接后的字符串）字符偏移，`next_offset = 本页结束偏移`；`offset=0` 表示从头。
- `offset > 正文总字符` → 诚实观察「offset 超出正文范围（共 N 字符）；从头读用 offset=0，或使用上一页给出的 next_offset」；`offset = 总字符` → 「已到正文末尾，无更多内容」；不返回伪造正文。

**(c) 回合 / 进度语义（不改既有硬上限）**

- 保持 `@max_explore_rounds = 2`。单轮最多 2 次探索 = 最多 2 页 = **12,000 字符正文**；典型章（P1 单章 ≥1000 有效字；本次样本 raw 5,495）一页可读完，2 章各 1 页亦可读完。
- **progress signature 修复**：判断循环 explore 步的签名从 `"#{run_id}:explore:#{sequence}:#{tool}:#{query}"` 改为不含 sequence 的 `"#{run_id}:explore:#{tool}:#{query}"`（计划内探索同理）；query 含 offset → 不同页签名不同、合法续读不误停；同页重复 → 命中既有 `no_progress` 停等（ADR-0025「无新信息连续探索命中 no-progress」）。
- 观察结构新增可选键 `next_offset` / `prose_total_chars` / `prose_range`，供循环/事件/验收断言使用；不改变 `tool/query/summary/refs` 既有形状。

**(d) 明确非目标**

- 不把正文预算做成 provider 自适应（v1 固定 6000；判断 prompt 本身已 9k–22k tokens，能承载判断循环的 provider 余量足够；档位化留待 AssemblyPolicy 校准）。
- 不改变 `chapter_read` 一章一次的原子性（每次调用仍只读一章）；多章 = 多次调用。
- 不放宽探索回合/预算 backstop；超长章（>12k 字符）本轮只返回前 12k，诚实告知剩余量并登记 gap。

## 2. CP 路线（最小实现步只是 checkpoint，不缩小 §1 范围）

| CP | 内容 | 闭环覆盖 / 距闭环还缺 | 证明 | 状态 |
|---|---|---|---|---|
| **CP0 契约冻结** | 本文档 §1.1 冻结观察 v2（query/预算/续读/回合+进度/非目标）；三项待拍板按 §6 建议默认，作者可翻案 | 解 F2/F3；契约先于代码 | 本文档 + 决策日志 | **done（2026-10-23 开档冻结；开工授权即按建议默认执行）** |
| **CP1 读取契约实现** | `ExplorationService`：`chapter_read` 解析 JSON query、分段预算、页切分/范围/next_offset/footer、参数错误诚实观察；`catalog`/目录 query 说明更新；其它工具预算不变 | 解 F2/F3 的读取侧；尚未接判断循环行为 | `exploration_service_test` 新矩阵：短章一页全文、6001+ 两页覆盖、段落边界、无段落硬切、offset 越界/末尾/非法、计划/摘要再长正文仍 ≥6000、纯章节名兼容、只读零写；旧三态断言零回归 | todo |
| **CP2 循环与提示接入** | `DialoguePlanningService`：目录/续读提示、progress signature 去重、observation 可选键进事件 payload；`AgenticPlanDraftPlanner` 计划步目录说明续读；`JudgmentPlan` 计划内探索 signature 对齐；顺带修 call2 `author_content_context` 与 `context_block` 重复渲染观察（只保留一处） | 解 F3/F4 的行为面；与 CP1 合起来才让模型「知道并能继续读」 | `judgment_exploration_loop_test`：page1→page2 续读不触发 no-progress、最终 reply 引用末页独有事实；重复同页 → no_progress 停等；`judgment_protocol_test` 目录文本；现有 explore→reply 场景回归；I-CACHE-1 | todo |
| **CP3 真实页面场景** | 新场景 `judgment-explore-chapter-full-read`：seed 一章 >6000 字符 + 首/末页独有锚点；外部 driver 从真实 Tauri 工作台输入作者式审核请求；替身按页探索并回复引用末页事实；verifier 断言页序/范围/next_offset/末页事实/零写入；manifest 注册（`quality/acceptance/scenarios.yml` + scenario yml + `tauri_slice_verify.sh` 注册/seed） | 全部 1–3 与 4 的外部自动化证明（对话主链，不新增 UI） | `scripts/quality_accept.sh judgment-explore-chapter-full-read --surface tauri` PASS；`artifacts/slice-verify/judgment-explore-chapter-full-read-tauri/`（截图 / ws 帧 / app JSONL / summary.json） | todo |
| **CP4 回归与收口** | 既有 `judgment-explore-chapter-plan` 确定性回归；`p1-chapter-adoption-reading`（正文读取/回填不被影响）；后端全量 + compile/format/credo/dialyzer/xref/arch/adr_trace/static scan；前端 verifier 测试；I1/I2/I3/N-NARR/I-CACHE-1；slice/NEXT/ledger/journey 收口 | 完整闭环；§7 gap 诚实登记 | 门禁命令清单见 §5；证据路径入档 | todo |

**依赖**：CP0 → CP1 → CP2 → CP3 → CP4。CP1/CP2 可同批开发但分开自测；CP3 依赖 CP1+CP2 的观察形状稳定后一次成型（避免 driver/verifier 反复改口径）。

## 3. 涉及范围

- `apps/novel_application/lib/novel_application/exploration_service.ex`（读取合同 v2）
- `apps/novel_application/lib/novel_application/dialogue_planning_service.ex`（目录/续读提示、signature、prompt 去重）
- `apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex`（计划步目录文案）
- `apps/novel_application/lib/novel_application/agent_run_flows/judgment_plan.ex`（计划内探索 signature）
- `apps/novel_application/test/novel_application/exploration_service_test.exs`、`judgment_exploration_loop_test.exs`、`judgment_protocol_test.exs`（如需）
- `apps/novel_agent/test/support/provider/slice_verify.ex`（仅测试替身：paged explore + 末页事实引用）
- `frontend/slice-verify/external-ui-driver.mjs`、`native-tauri-verifier.mjs`、`native-tauri-verifier.test.mjs`
- `scripts/tauri_slice_verify.sh`、`scripts/seed_judgment_explore_chapter_full_read.exs`（新）
- `quality/acceptance/scenarios.yml`、`quality/acceptance/scenarios/judgment-explore-chapter-full-read.yml`（新）
- 文档：本 slice、`tasks/NEXT.md`、`tasks/slices/README.md`、`docs/product/user-journeys.md`、`docs/project-ledger.md`
- **不改**：`novel_domain` / `novel_persistence` 代码、`novel_web` 生产 Channel、`frontend/src` 产品 UI、其它探索工具的观察预算、`@max_explore_rounds` 数值、provider 配置/策略。

## 4. 任务清单

| # | 任务 | 所属 CP | 状态 |
|---|---|---|---|
| T1 | 冻结观察合同 v2 与三项默认决策（§1.1/§6） | CP0 | done |
| T2 | `chapter_read` JSON query / offset 解析、分段预算、页切分、范围与 next_offset/footer | CP1 | todo |
| T3 | `chapter_read` 参数错误 / 越界 / 末尾 / 无已采纳正文的诚实观察 | CP1 | todo |
| T4 | `ExplorationService.catalog` 与 `AgenticPlanDraftPlanner` 计划步目录更新（含续读语法） | CP1/CP2 | todo |
| T5 | 循环 explore 目录/续读提示 + progress signature（判断循环 + 计划内） | CP2 | todo |
| T6 | call2 观察重复渲染修复（`author_content_context` 去重） | CP2 | todo |
| T7 | `exploration_service_test` 页覆盖/预算优先级矩阵（含回归守卫 I-READ-2） | CP1 | todo |
| T8 | `judgment_exploration_loop_test` 续读/重复页 no-progress/末页事实回复 | CP2 | todo |
| T9 | 新 seed + 替身分页探索 + driver/verifier + manifest/注册 | CP3 | todo |
| T10 | 真实 Tauri 场景 PASS + `judgment-explore-chapter-plan` / `p1-chapter-adoption-reading` 回归 | CP3/CP4 | todo |
| T11 | 全门禁 + 不变量 + 静态扫描 + 文档收口 | CP4 | todo |

## 5. 验证

**局部（CP1/CP2）**

```bash
mix test apps/novel_application/test/novel_application/exploration_service_test.exs
mix test apps/novel_application/test/novel_application/judgment_exploration_loop_test.exs
mix test apps/novel_application/test/novel_application/judgment_protocol_test.exs
```

**真实页面（CP3/CP4）**

```bash
bash scripts/quality_accept.sh judgment-explore-chapter-full-read --surface tauri
# 回归
bash scripts/tauri_slice_verify.sh judgment-explore-chapter-plan
bash scripts/tauri_slice_verify.sh p1-chapter-adoption-reading
```

**门禁（CP4，按 AGENTS.md）**

```bash
mix compile --warnings-as-errors
mix test
mix format --check-formatted
mix credo --strict
mix dialyzer
mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs
mix run scripts/adr_trace.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
bash scripts/ai_static_scan.sh --top 10
```

- **N-NARR**：观察是检索结果机械渲染（不引入系统代笔叙述）；回复仍是模型字节绑定。
- **I-CACHE-1 / VS-00I**：目录文本与观察位置变化后必须复跑前缀共享度量；call1/call2 仍共享 L0–L2。
- **I1/I2/I3**：本 slice 不产 artifact item，不应改变三条不变量；跑绿即证明未越界。

## 6. 决策日志

- **2026-10-23 开档（作者定向「方案 A 开一个 slice」）**：只读侦察确认根因 = 探索观察 1500 预算被设计态材料挤占（正文 4.9%）+ 无续读 + 探索回合 2；AI 两次拿到逐字节相同观察后被迫诚实回复。本 slice 冻结 `chapter_read` 观察 v2（分段预算/续读/进度语义），不做确定性重复审计（方案 B 归 `P1-word-count-audit` checkpoint B），不放宽回合硬上限。
- **待作者拍板（建议默认，开工授权即执行、可翻案）**：
  - **D1 页大小与段预算**：正文单页 **6000** 字符；【计划】≤500、【摘要】≤400；整条观察 ≤7200。备选：更大单页（8k+）或 provider 档位化——建议 v1 固定，理由见 §1.1(d)。
  - **D2 回合策略**：**不改** `@max_explore_rounds 2`；单轮最多 2 页/12k 字符；超长章登记 gap。备选：本 slice 就加「续读授予额外回合」——建议不做，避免动预算 backstop 与 UA01 合同，等真实长章需求触发。
  - **D3 query 语法**：JSON `{"chapter":"第01章","offset":N}`（与 `session_adoptions` 一致）；纯章节名 = offset=0。建议默认。
  - **D4 续读页是否重复计划/摘要**：**不重复**（仅 offset=0 页返回），减少 prompt 与重复信息；建议默认。
  - **D5 作者可见活动行**：保持「已检索 chapter_read「第01章」。」不变；页范围/next_offset 只进 observation 与 `agent_events.payload`（author-safe 机械字段）。备选：活动行加「正文 1–6000 / 共 N 字符」——建议后续按作者需要再加，v1 不动 UI 断言。
  - **D6 验收场景**：新建 `judgment-explore-chapter-full-read`，不复用 blocked 的 `judgment-explore-internal`（其 blocked 原因与 summary 缺失无关本 slice）；建议默认。

## 7. 未闭环 / 后续 gap（诚实登记）

1. **超长章**（正文 raw >12,000 字符）：单轮 2 页读不完；本 slice 仅返回前 12k 并诚实告知剩余量。触发条件：真实长章审核请求出现 → 开「续读回合/页预算 provider 档位化」小 slice。
2. **3 章以上批量全文阅读**：本 slice 最多 2 章/轮（各 ≤1 页）；跨多章重复审计归方案 B（确定性重复段/重复章检测）与后续批量阅读 slice。
3. **provider 自适应观察预算**：`AssemblyPolicy` 已有档位但探索服务未接；`strata: floor(2000)` 与真实能力不符，档位校准另立。
4. **真实模型是否遵守续读提示**：CP3 用确定性替身证明机制与主链；弱模型是否在真实会话中主动续读，归狗粮观察（与 C11/判断循环调参同批）。
5. **活动行是否展示页范围**：D5 默认不做；若作者需要「AI 正在读第 x–y 字」的可见性，另开 copy/UI 小改。
