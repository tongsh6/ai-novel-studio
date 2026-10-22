# B24-探索面全章可读：chapter_read 分段预算 + 续读

> ⚠️ **契约变更通知（2026-10-23 01:09 CST，commit `d817f67e`）**：本 slice 的章节身份已从「按标题寻址」修订为 **`chapter_ref = "chapter:<chapters.id>"` 唯一寻址**（见 §1.1(a)）。若你正在实现旧契约（JSON `{"chapter":...}`、`find_chapter` first-match、标题身份测试），**请先停止并重读 §1.1 / §6 / §7**；旧实现不得提交。写入/采纳链 title 身份统一归 follow-up（候选 B25），不在本 slice 范围。

**状态**：**done（2026-10-23，CP0–CP4 全落；新真实 Tauri 场景 + 两回归 PASS；全门禁绿）**。
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

### 0.3 章节唯一编码审计（2026-10-23 作者质询后只读核查）

作者指出「用章节名当身份不对，章节名会重复」，核查结论：**唯一编码存在，但探索/写入路径没有把它当身份用**。

| 标识 | 存储事实 | 唯一性 | 当前用途 | 结论 |
|---|---|---|---|---|
| `chapters.id` | `Chapter` schema `@primary_key {:id, :binary_id, autogenerate: true}`；stage schema `id TEXT PRIMARY KEY` | **DB 层唯一**（主键） | TOC DTO `id`、`chapter_content/2`、探索 refs `chapter:<id>`、ledger `chapter_ref`、`ChapterMissionRepo` 的 get/confirm/rewrite/discard | **真正的唯一编码**；但 `chapter_read` 查询没有使用它 |
| `chapters.seq` | integer；代码 `next_chapter_seq = max(seq)+1`，AU08 CP1 约定 work 内全局（`adoption_repository.ex:1123-1130`） | 代码意图唯一；**DB 只有 `(volume_id, seq)` 普通索引，无唯一约束**（migration `20260430000001`；stage schema 同）；历史卷内 seq 数据未审计 | 账本 `design_ref: chapter_plan:<seq>`、`subject_ref: plan_info_<seq>`、使命暂定 `put_tentative(work_id, seq)` | 只能作**展示序号/别名**；不能当安全身份 |
| `chapters.title` | string，无唯一约束 | **不唯一** | 探索 `chapter_read` 子串匹配；采纳 `find_or_create_chapter`（`work_id+title`）、`ensure_planned_chapter`（同）、覆盖检测 `has_accepted_chapter?/2`、读前文 `accepted_chapter_prose/2`、写作目标 `resolve_target_chapter` | **把标题当身份是系统性债务**（重复标题会复用/合并同一章） |

其余缺口：
- `ReadingProjectionRepo.toc/1` 返回 `id/seq/title`（`reading_projection_repo.ex:257-271`），但 `WorkspaceContext.structured_chapter_entry` 白名单丢弃 `id`（`workspace_context.ex:143-160`），判断/计划章节列表只渲染 title；`exploration_sections` 也不渲染 observation 的 `refs`，所以模型看得到标题、看不到唯一编码。
- `ChapterMissionRepo` 内部口径混用：`put_tentative/3` 按 seq，get/confirm/rewrite/discard 按 chapter id（`chapter_mission_repo.ex`）；`ProseExecutionBriefBuilder.chapter_ref/1` 又是「有 id 用 id、否则用 title」。
- stage 库当前 5 个作品、31 章无重复 title/seq，但这是数据现状，不是设计保证；不能靠「当前没重复」来选标题身份。
- 探索观察 `refs: ["chapter:<uuid>"]` 已存在（`exploration_service.ex:345-388`），只是没进模型可见上下文——这是本 slice 可直接复用的唯一编码基础。

### 0.4 本 slice 不做 / 另立归属

- **写入/采纳链的章节身份统一**（`find_or_create_chapter` / `ensure_planned_chapter` / `has_accepted_chapter?` / `accepted_chapter_prose` / `resolve_target_chapter` 从 title 改为唯一 id；seq 唯一约束/数据审计；`ChapterMissionRepo` 口径统一）→ **独立 follow-up slice**（候选 `B25-chapter-identity-unification`，见 §7），本 slice 不假装解决。→ **follow-up 已关闭（2026-10-23，B25 done）**。
- **确定性重复段/重复章检测（方案 B）** → `P1-word-count-audit` checkpoint B（`tasks/slices/P1-word-count-audit.md:91-95`；`docs/product/novel-output-milestones.md:67` 要求重复章 0）。本 slice 只解「AI 能读到完整正文」这一前置能力。
- **单轮超过 12,000 字符的章节 / 3 章以上批量全文阅读** → 本 slice 受既有 `@max_explore_rounds 2` 限制，登记为后续 gap（见 §7）；不在本 slice 擅自放宽回合硬上限。
- **provider 自适应观察预算 / AssemblyPolicy 档位接入** → 登记 gap。现状 `AssemblyPolicy` 已有 floor 2000 / standard 8000 / large 200000 chars（`assembly_policy.ex:35-40`），但探索服务没有 provider 上下文；且 `strata` 仍映射 floor（`assembly_policy.ex:41-47`），与今天实际能处理 2 万 token 判断 prompt 的事实不符，档位校准另立。
- **判断上下文直接注入全章正文（方案 C）** → 不做；放大每次判断 prompt，且多章不经济。
- **判断循环「先问再做」倾向调参** → `UA01-agentic-loop-prompt-hardening` / 狗粮观察。
- **观察在 call2 prompt 被渲染两遍**（本 slice 顺带修，见 CP2；证据：最终判断 prompt 中 2 条观察出现 4 次）。此项若要单独评估可拆出，但修复成本低且直接减少本 slice 观察变大后的 prompt 压力。

## 1. 开工检查（七问）

1. **Contract**：ADR-0025 §决策范围 #3 / §3 内部翼明确「工具与索引细节由 slice 冻结」；本 slice 在 §1.1 冻结 **`chapter_read` 观察合同 v2**（章节唯一寻址 / query 语法 / 分段预算 / 续读元数据 / 回合与 no-progress 语义 / 作者可见活动文案）。消费既有读取语义：`ReadingProjectionService.chapter_content/2`（每 scene 最高 revision accepted）、`ChapterSummaryRepo.current_accepted/2`、`ChapterPlanDirection.from_storage/1`——**不新建平行读路径**。**章节身份以 DB 唯一 `chapters.id` 派生的 `chapter_ref = "chapter:<id>"` 为准**；`seq` 只作展示序号与「唯一命中才可用」的别名，`title` 只作旧兼容解析且必须唯一命中（重复即歧义错误，列候选 ref，禁止 first-match）；判断/计划章节索引同批暴露 ref 供模型寻址，作者面不出现 UUID/ref。不新增 ADR、不改 JSON Schema、不改持久化 schema；`novel_persistence` 只做读端口 additive（TOC 已有 id，补进 structured chapters）；observation 仅在 application 内部 stage_state 增可选键，`agent_events.payload` 沿用既有 map。
2. **Invariant**：
   - **I-EXPLORE-READ-1（页覆盖）**：同一章从 offset 0 连续续读时，各页首尾相接、无重叠、无缺口；页码/范围/总数机械一致；最后一页 `next_offset=null` 时其结尾必须等于正文总字符数。
   - **I-EXPLORE-READ-2（正文优先）**：任一 `chapter_read` 观察中可见正文字符数 ≥ min(正文总字符数, 单页预算 6000)；【计划】≤500、【摘要】≤400，设计态材料不得把正文挤到配额以下（本 slice 的回归守卫；旧 1500 预算下正文只剩 216 字即反例）。
   - **I-EXPLORE-READ-3（截断必可续读）**：正文被截断时观察必须同时给出「已返回 x–y / 共 N 字符」与可执行的 `next_offset` 续读 query；不允许只出现「…（截断）」而无续读信息。
   - **I-EXPLORE-READ-4（只读零写）**：`chapter_read` 全程只读，不产生 production write / adoption / tool 写路径 / provider 调用；只读已采纳正文，tentative 草稿不进观察。
   - **I-EXPLORE-READ-5（真重复才 no-progress）**：同 tool+同 query（含 offset）重复观察按既有 no-progress 语义停等；不同 offset 的合法续读不得误触发 no-progress。
   - **I-EXPLORE-READ-6（兼容）**：其它探索工具（`prose_search` / `archive_read` / `memory_recall` / `session_adoptions`）的观察预算与行为不变；`chapter_read` 旧纯标题 query 继续可用，但只在**唯一命中**时解析成功（0→找不到并列出真实候选；多个→歧义错误列出候选 ref，不静默取第一个）。
   - **I-EXPLORE-READ-7（唯一编码寻址）**：章节身份以 DB 唯一 `chapter_ref = "chapter:<chapters.id>"` 为准；`chapter_seq` 只能作「work 内唯一命中」的展示序号别名，title 只能作旧兼容解析且必须唯一命中；任何歧义必须返回候选 `chapter_ref`/seq/title 列表，禁止按 TOC 顺序 first-match；同一章的分页续读必须复用同一个 `chapter_ref`。禁止新增用 title/seq 做安全身份的路径。
   - **I-EXPLORE-READ-8（作者可见文案不暴露内部）**：作者可见的 `exploration_observed` summary 不得出现内部工具 id（`chapter_read` / `prose_search` / `archive_read` / `memory_recall` / `session_adoptions`）、原始 JSON query、`chapter_ref`/UUID、`offset`/`next_offset` 字段名或 `inspect` 错误结构；必须使用集中标签映射的人类可读文案（章节用 `第 N 章「标题」`）。工具 id / query / ref / offset 只保留在结构化 payload / trace / developer 面。
   - **I-EXPLORE-READ-9（双面身份）**：模型可见的章节索引必须同时给出 `chapter_ref`（供工具寻址）、seq（人类序号）与 title（展示）；作者可见 UI/文案只能使用 seq + title，不得出现 `chapter_ref`/UUID；该分离在单测与真实页面验收同时断言。
3. **Boundary**：
   - **改**：`novel_application`（`ExplorationService` 唯一 ref 解析、`DialoguePlanningService` 探索目录/回合/no-progress signature/prompt 输入去重、**判断章节索引渲染 ref**、`AgenticPlanDraftPlanner` 计划步目录与章节索引、`ContextAssembler` structured chapter 白名单加 id、`JudgmentPlan` 计划内探索 signature 与事件 summary）、`novel_persistence` **只读端口 additive**（`WorkspaceContext.structured_chapter_entry` 补 `id`；必要时新增 chapter index reader，零 schema/migration）、`novel_agent` 仅测试替身（`test/support/provider/slice_verify.ex`）、验收 harness（`frontend/slice-verify/external-ui-driver.mjs` / `native-tauri-verifier.mjs` / `.test.mjs`）、`quality/acceptance/` 与 `scripts/tauri_slice_verify.sh` 注册。
   - **明确不改**：章节表 schema/迁移、`novel_web` 生产 Channel、前端 `src` 产品代码、ADR-0025 外部探索翼、判断循环「先问再做」prompt、`@max_explore_rounds` 数值（本 slice 保持 2）、provider 窗口策略、**写入/采纳链的 title 身份**（归 follow-up slice，见 §0.4/§7）。
4. **Consumer**：第一真实消费者 = 判断循环 `explore` 分支（`DialoguePlanningService.judgment_explore_result/7` → `ExplorationService.run/4`，即本次失败会话走的路径）；第二 = 计划模式下探索步（`JudgmentPlan.execute_exploration_decision_step/4`，同批获得更大单页）；第三 = 真实作者在工作台提出「审核/核对/引用全章」类请求；验收消费者 = 外部 Playwright/Tauri driver。
5. **Proof**：§5。CP1 单测（页覆盖矩阵 / 预算优先级回归守卫 / 续读语法 / 兼容）；CP2 循环流测试（分页续读、重复页 no-progress、最终回复引用末页独有事实）；CP3 新真实页面场景（确定性 provider）PASS + 既有 `judgment-explore-chapter-plan` 回归；全门禁与 I1/I2/I3/N-NARR/I-CACHE-1。
6. **Acceptance Driver**：新场景 `judgment-explore-chapter-full-read`，`bash scripts/quality_accept.sh judgment-explore-chapter-full-read --surface tauri`：外部 driver 从真实 Tauri 工作台输入作者式请求（发问文本触发 test/support 替身的分页探索），等真实回复；verifier 只读页面可见文本 + app JSONL + WS 帧，断言两页探索顺序/范围/末页事实被引用/零写入/**作者可见文案人类可读且不含内部工具 id 或 JSON**。**产品代码新增验收感知逻辑：no**（无 env 开关、无 slice id、无 data-testid、无 autorun；替身只在 test/support 且由脚本环境注入）。
7. **Exploration**：本 slice 不物化新的 novel element 要素，而是修复既有探索读取面本身；`chapter_read` 已覆盖【计划/摘要/正文】三态，本 slice 让正文同批可完整读取，未新增要素物化，故探索面同步律不适用（属于既有面修复 + 读取能力补全）。

### 1.1 契约冻结（CP0）：`chapter_read` 观察合同 v2

**(a) 章节寻址：唯一 `chapter_ref` 优先，seq / title 只能唯一解析**

```text
规范语法（新；唯一寻址；与 session_adoptions 的 {query, offset} 先例同构）:
  {"chapter_ref":"chapter:<chapters.id>","offset":0}
展示/别名语法（便利；必须 work 内唯一命中，不能用于分页）:
  {"chapter_seq":3,"offset":0}
旧兼容语法（deprecated；必须唯一命中，歧义即错误，不再 first-match）:
  <TOC 真实章标题>                       # offset=0
  {"chapter":"<TOC 真实章标题>","offset":N}
```

- **模型可见的章节索引必须带 ref**（判断 L2 章节段 + 计划章节段同批）：每行形如
  `- 第 3 章「恐惧体验」[chapter_ref=chapter:<uuid>]`
  模型调用 `chapter_read` 时从索引复制 `chapter_ref`；seq/title 只用于理解与作者沟通。
- **解析规则（顺序固定，禁止静默 fallback/first-match）**：
  1. `chapter_ref`：校验 `chapter:<uuid>` 格式与 UUID、且必须属于当前 work；非法/跨 work → 诚实错误，不 fallback 到 title。
  2. `chapter_seq`：按 `(work_id, seq)` 查询；**恰好 1 行**才可用；0 行/多行 → 未找到或歧义观察，列出候选 `chapter_ref`/seq/title。
  3. 旧标题/纯标题：精确标题优先、再唯一子串；**恰好 1 行**才可用；0 行 → 列出当前章索引（含 ref）；多行 → 歧义观察列候选；**禁止按 TOC 顺序取第一个**。
- `offset` 为非负整数；JSON 解析失败 / 缺 `chapter_ref|chapter_seq|chapter` → 参数错误观察，列出语法与当前章索引，不返回正文。
- **分页必须复用同一 ref**：`offset > 0` 时观察 footer 给出同一 `chapter_ref` 的续读 query；模型不得用 title/seq 重新解析续读（重复标题/重复 seq 时会导致跳章）。
- catalog / 判断与计划 prompt 的 query 说明统一改为「优先复制 `chapter_ref`；标题/序号只是唯一命中时的别名，不能当安全身份」；不再出现任何具体作品的编号格式示例。
- **作者可见活动文案不展示 query 原文**（JSON 会暴露 ref/UUID/offset）：作者只看到 `第 N 章「标题」` 的人类可读文案（见 (e)）。

**(b) 观察布局与预算**

| 段 | 内容 | 预算 | 说明 |
|---|---|---|---|
| 标题行 | `「章标题」（第 N 章）` | — | 标题用于人读，ref 在结构字段/索引中 |
| 【计划】 | 设计态九字段/场次/使命/卷蓝图（现有渲染） | ≤ **500** 字符（段内截断标「…（略）」） | **仅 offset=0 页返回**；续读页不重复 |
| 【摘要】 | 治理摘要（现有渲染） | ≤ **400** 字符（段内截断标「…（略）」） | **仅 offset=0 页返回**；续读页不重复 |
| 【正文】 | 已采纳正文页 + 范围头 | 单页 **6000** 字符 | 每页都带：`【正文】第 x–y 字符 / 共 N 字符（有效字数 W）`；续读页同格式 |
| 续读 footer | 仅在 `next_offset != nil` 时 | — | 例：`【续读】剩余 N-p 字符；用 {"chapter_ref":"chapter:<本页 ref>","offset":p} 继续。` |

- 整条观察上限 **7200** 字符（500 + 400 + 6000 + 头部/footer 余量）；不再对整条观察做二次 clip 把正文截掉。其它工具观察仍用既有 `@summary_max_chars 1500`。
- 短章（正文 ≤6000 字符）一次返回**完整正文**，`next_offset=null`，模型无需续读。
- 页切分优先在 `\n\n` 段落边界（≤ offset+6000 内最靠后的边界）；无段落边界时按 6000 硬切。`offset` 语义为正文（各 scene 按现有 `\n` 连接后的字符串）字符偏移，`next_offset = 本页结束偏移`；`offset=0` 表示从头。
- `offset > 正文总字符` → 诚实观察「offset 超出正文范围（共 N 字符）；从头读用 offset=0，或使用上一页给出的 next_offset」；`offset = 总字符` → 「已到正文末尾，无更多内容」；不返回伪造正文。

**(c) 回合 / 进度语义（不改既有硬上限）**

- 保持 `@max_explore_rounds = 2`。单轮最多 2 次探索 = 最多 2 页 = **12,000 字符正文**；典型章（P1 单章 ≥1000 有效字；本次样本 raw 5,495）一页可读完，2 章各 1 页亦可读完。
- **progress signature 修复**：判断循环 explore 步的签名从 `"#{run_id}:explore:#{sequence}:#{tool}:#{query}"` 改为不含 sequence 的 `"#{run_id}:explore:#{tool}:#{query}"`（计划内探索同理）；query 含 offset → 不同页签名不同、合法续读不误停；同页重复 → 命中既有 `no_progress` 停等（ADR-0025「无新信息连续探索命中 no-progress」）。
- 观察结构新增可选键 `chapter_ref` / `chapter_seq` / `next_offset` / `prose_total_chars` / `prose_range` / `activity_summary`，供循环/事件/验收断言使用；不改变 `tool/query/summary/refs` 既有形状（`refs` 继续含 `chapter:<id>`）。

**(d) 明确非目标**

- 不把正文预算做成 provider 自适应（v1 固定 6000；判断 prompt 本身已 9k–22k tokens，能承载判断循环的 provider 余量足够；档位化留待 AssemblyPolicy 校准）。
- 不改变 `chapter_read` 一章一次的原子性（每次调用仍只读一章）；多章 = 多次调用。
- 不放宽探索回合/预算 backstop；超长章（>12k 字符）本轮只返回前 12k，诚实告知剩余量并登记 gap。

**(e) 作者可见活动文案（不得暴露内部工具 id / 原始 JSON）**

作者在主工作台看到的 `exploration_observed` 事件 summary 由探索服务集中产出，**不得包含内部工具 id、原始 query JSON、`chapter_ref`/UUID、`offset`/`next_offset` 字段名、`inspect` 错误结构**。集中标签（单点映射，判断循环与计划内探索共用；章节一律用 seq + title 展示）：

| tool | 作者可见文案（示例） |
|---|---|
| `chapter_read`（整章/首页） | `已阅读章节正文「<title>」（第 N 章）（有效字数 W）。` |
| `chapter_read`（续读页） | `已阅读章节正文「<title>」（第 N 章；第 x–y 字符 / 共 N 字符）。` |
| `prose_search` | `已检索正文「<检索词>」。` |
| `archive_read` | `已查阅作品档案：<面向中文名>。`（profile/characters/… 映射中文；缺省「作品档案」） |
| `memory_recall` | `已检索记忆「<检索词>」。` |
| `session_adoptions` | `已查询当前会话候选。` |
| 失败/参数错误 | 作者安全的人话（如「章节检索未完成，可换个章名或让我先列出章节」）；developer payload 保留结构化原因。 |

- 事件 payload / trace 保留 `tool`、`query`、`chapter_ref`、`next_offset` 等结构化字段（developer 面可用）；作者可见文本只从上述映射取，且**不出现 UUID/ref**。
- 实现落点：`ExplorationService` 在产出 observation 时同时给出 `activity_summary`（或等价纯函数），`DialoguePlanningService` / `JudgmentPlan` 的 `exploration_observed` 事件 summary 改用该字段；计划内探索的 step goal 同步人类可读，tool id 留在 decision/trace。
- 验收断言：真实页面可见文本与 app JSONL 的 author 事件 summary 均**不包含** `chapter_read` 等内部 id、`{"chapter"`、`offset`；包含「已阅读章节正文」等人类可读文案。**产品代码不得为验收加文案钩子**，人类可读文案本身是真实作者体验。

## 2. CP 路线（最小实现步只是 checkpoint，不缩小 §1 范围）

| CP | 内容 | 闭环覆盖 / 距闭环还缺 | 证明 | 状态 |
|---|---|---|---|---|
| **CP0 契约冻结** | 本文档 §1.1 冻结观察 v2（query/预算/续读/回合+进度/作者可见文案/非目标）；§6 决策按建议默认，作者可翻案 | 解 F2/F3；契约先于代码 | 本文档 + 决策日志 | **done（2026-10-23 开档冻结；开工授权即按建议默认执行）** |
| **CP1 读取契约实现** | `ExplorationService`：`chapter_read` 解析 `chapter_ref`（唯一）/`chapter_seq`（唯一别名）/title（旧兼容、唯一命中）三路寻址，**歧义列候选 ref、禁止 first-match**；分段预算、页切分/范围/next_offset/footer（footer 用同 ref）、参数错误诚实观察；`catalog` 改为「优先复制 chapter_ref」；其它工具预算不变 | 解 F2/F3 的读取侧 + 唯一身份寻址；尚未接判断循环行为 | `exploration_service_test` 新矩阵：短章一页全文、6001+ 两页覆盖、段落边界/硬切、offset 越界/末尾/非法、计划/摘要再长正文仍 ≥6000、**重复标题→title 查询歧义列 ref、按 ref 读取正确章**、**重复 seq 同理**、按 ref 分页无重叠无缺口、旧纯标题唯一命中兼容、只读零写；旧三态断言零回归 | **done（2026-10-23：三路寻址/歧义/续读/预算矩阵；`exploration_service_test` 22 例绿）** |
| **CP2 循环与提示接入** | `DialoguePlanningService`：目录/续读提示（ref-first）、progress signature 去重、observation 可选键进事件 payload；**判断 L2 章节索引渲染 ref+seq+title**；`AgenticPlanDraftPlanner` 计划章节段同批渲染 ref（明确 ref 仅探索步用；target_chapter 仍复制标题）；`ContextAssembler`/`WorkspaceContext` 读端口 additively 透传 `chapters.id`；`JudgmentPlan` 计划内探索 signature 对齐；**作者可见 `exploration_observed` summary 改用集中人类可读标签（I-READ-8，工具 id/ref/UUID/JSON 不进作者面）**；顺带修 call2 `author_content_context` 与 `context_block` 重复渲染观察 | 解 F3/F4 的行为面 + 唯一身份可寻址 + 作者可见措辞 | `judgment_exploration_loop_test`：page1→page2 续读不触发 no-progress、最终 reply 引用末页独有事实；重复同页 → no_progress 停等；**章节列表含 chapter_ref、author 事件 summary 含「第 N 章「title」」且不含 `chapter_read`/`chapter:`/UUID/`{"`/`offset`**；`judgment_protocol_test` 目录文本；现有 explore→reply 场景回归；I-CACHE-1 | **done（2026-10-23：章节索引 ref/计划段/文案/signature/call2 去重；flow 测试绿；I-CACHE-1 绿）** |
| **CP3 真实页面场景** | 新场景 `judgment-explore-chapter-full-read`：seed **两章同名标题**（重复 title）+ 目标章正文 >6000 字符 + 首/末页独有锚点；外部 driver 从真实 Tauri 工作台输入作者式审核请求；替身从章节索引取目标章 `chapter_ref` 做两页探索并回复引用末页事实；verifier 断言按 ref 页序/范围/next_offset/末页事实/零写入/**页面可见文案 `第 N 章「title」` 且不含 ref/UUID/内部工具 id/JSON**；manifest 注册（`quality/acceptance/scenarios.yml` + scenario yml + `tauri_slice_verify.sh` 注册/seed） | 全部 1–3、7–9 与 4 的外部自动化证明（对话主链，不新增 UI） | `scripts/quality_accept.sh judgment-explore-chapter-full-read --surface tauri` PASS；`artifacts/slice-verify/judgment-explore-chapter-full-read-tauri/`（截图 / ws 帧 / app JSONL / summary.json） | **done（2026-10-23，真实 Tauri PASS）** |
| **CP4 回归与收口** | 既有 `judgment-explore-chapter-plan` 确定性回归（driver 断言随文案/章节索引更新）；`p1-chapter-adoption-reading`（正文读取/回填不被影响）；后端全量 + compile/format/credo/dialyzer/xref/arch/adr_trace/static scan；前端 verifier 测试；I1/I2/I3/N-NARR/I-CACHE-1；slice/NEXT/ledger/journey 收口；follow-up 身份统一 slice 登记 | 完整闭环；§7 gap 诚实登记 | 门禁命令清单见 §5；证据路径入档 | **done（2026-10-23，全门禁绿；见 §8）** |

**依赖**：CP0 → CP1 → CP2 → CP3 → CP4。CP1/CP2 可同批开发但分开自测；CP3 依赖 CP1+CP2 的观察形状稳定后一次成型（避免 driver/verifier 反复改口径）。

## 3. 涉及范围

- `apps/novel_application/lib/novel_application/exploration_service.ex`（读取合同 v2：`chapter_ref` 唯一寻址 / seq·title 唯一别名 / 分段预算 / 续读 / 集中人类可读活动文案）
- `apps/novel_application/lib/novel_application/dialogue_planning_service.ex`（目录/续读提示、signature、prompt 去重、**判断章节索引渲染 ref**、author 事件 summary 改用人类可读文案）
- `apps/novel_application/lib/novel_application/context_assembler.ex`（structured chapter 白名单 additively 透传 `id`）
- `apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex`（计划章节段渲染 ref；计划步目录：ref-first + 续读；步骤描述不写内部工具名）
- `apps/novel_application/lib/novel_application/agent_run_flows/judgment_plan.ex`（计划内探索 signature、事件 summary / step goal 人类可读）
- `apps/novel_persistence/lib/novel_persistence/workspace_context.ex`（**只读 additive**：structured chapter 补 `id`；必要时新增 chapter index reader；零 schema/migration）
- `apps/novel_application/test/novel_application/exploration_service_test.exs`、`judgment_exploration_loop_test.exs`、`judgment_protocol_test.exs`（如需）
- `apps/novel_agent/test/support/provider/slice_verify.ex`（仅测试替身：按 ref 两页 explore + 末页事实引用）
- `frontend/slice-verify/external-ui-driver.mjs`、`native-tauri-verifier.mjs`、`native-tauri-verifier.test.mjs`（既有「已检索」断言随人类可读文案更新；新场景断言不暴露内部 id/ref/UUID）
- `scripts/tauri_slice_verify.sh`、`scripts/seed_judgment_explore_chapter_full_read.exs`（新）
- `quality/acceptance/scenarios.yml`、`quality/acceptance/scenarios/judgment-explore-chapter-full-read.yml`（新）
- 文档：本 slice、`tasks/NEXT.md`、`tasks/slices/README.md`、`docs/product/user-journeys.md`、`docs/project-ledger.md`
- **不改**：chapter schema/migration、`novel_web` 生产 Channel、`frontend/src` 产品 UI、其它探索工具的观察预算、`@max_explore_rounds` 数值、provider 配置/策略、**写入/采纳链 title 身份**（follow-up slice）。

## 4. 任务清单

| # | 任务 | 所属 CP | 状态 |
|---|---|---|---|
| T1 | 冻结观察合同 v2 与 §6 决策（含唯一编码寻址与作者可见文案） | CP0 | done |
| T2 | `chapter_read` 三路寻址解析（`chapter_ref` 唯一 / `chapter_seq` 唯一别名 / title 旧兼容唯一命中）、歧义列候选、分段预算、页切分、范围与 next_offset/footer（同 ref） | CP1 | done |
| T3 | `chapter_read` 参数错误 / 越界 / 末尾 / 无已采纳正文 / 重复标题/seq 歧义的诚实观察 | CP1 | done |
| T4 | `ExplorationService.catalog` 与 `AgenticPlanDraftPlanner` 计划步目录更新（ref-first + 续读语法；不写死任何章名格式） | CP1/CP2 | done |
| T5 | 循环 explore 目录/续读提示 + progress signature（判断循环 + 计划内） | CP2 | done |
| T6 | call2 观察重复渲染修复（`author_content_context` 去重） | CP2 | done |
| T7 | 作者可见活动文案集中映射（章节用 `第 N 章「title」`；工具 id/ref/UUID/JSON 不进作者面），判断循环/计划 flow 共用 | CP2 | done |
| T8 | **章节索引 ref 暴露**：`WorkspaceContext`/`ContextAssembler` 透传 `id`；判断 L2 与计划章节段渲染 `[chapter_ref=...]`，并明示 ref 只供探索寻址（target_chapter 仍复制标题） | CP2 | done |
| T9 | `exploration_service_test` 页覆盖/预算优先级矩阵（I-READ-2 + 重复标题/重复 seq/按 ref 分页/旧唯一标题兼容） | CP1 | done |
| T10 | `judgment_exploration_loop_test` 续读/重复页 no-progress/末页事实回复/章节索引含 ref/author summary 无内部标识 | CP2 | done |
| T11 | 新 seed（**两章同名标题** + 非编号标题目标章）+ 替身按 ref 分页探索 + driver/verifier（含作者可见文案与无 ref/UUID 断言）+ manifest/注册 | CP3 | done（2026-10-23，两章同名 seed + 真实 Tauri PASS） |
| T12 | 真实 Tauri 场景 PASS + `judgment-explore-chapter-plan`（断言更新） / `p1-chapter-adoption-reading` 回归 | CP3/CP4 | done（2026-10-23，三场景真实 Tauri PASS） |
| T13 | 全门禁 + 不变量 + 静态扫描 + 文档收口 + follow-up slice 登记 | CP4 | done（2026-10-23） |

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
- **作者可见文案（I-READ-8）**：CP2/CP3 断言 author 事件 summary 与真实页面可见文本不含 `chapter_read` / `prose_search` 等内部 id、`chapter:`/UUID、`{"`、`offset`；含 `第 N 章「title」` 与「已阅读章节正文」。既有 driver 的「已检索」断言按新文案更新（chapter_read → 「已阅读」；prose_search 仍含「已检索」）。
- **唯一编码寻址（I-READ-7/9）**：单测覆盖重复标题/重复 seq 的歧义与按 ref 正确读取、ref 分页无重叠无缺口；断言模型可见章节索引含 `chapter_ref`，作者可见文案不含 ref/UUID；不再用「第NN章」格式作为身份或示例。
- **写入/采纳链身份未统一**：本 slice 只修读取面；`find_or_create_chapter` 等 title 身份按 follow-up slice 验证，不把本 slice 的绿当作全章身份问题已解决。→ **已于 2026-10-23 由 `B25-chapter-identity-unification` 关闭**（CP1 仓储 ref 化、CP2a/CP2b 应用与计划链 ref、CP3 seq 唯一索引与修复脚本；新真实 Tauri 同名两章场景 + B24 两场景回归 PASS）。

## 6. 决策日志

- **2026-10-23 B24 收口（CP1–CP4 全落，作者两次纠偏后的最终契约）**：CP1 `ExplorationService.chapter_read` 观察 v2——三路寻址（`chapter_ref=chapter:<chapters.id>` 唯一 / `chapter_seq` work 内唯一别名 / title 旧兼容唯一命中，歧义列候选 ref、禁止 first-match）、分段预算（【计划】≤500 /【摘要】≤400 / 正文单页 6000，段内「…（略）」截断、整条 ≤7200）、段落边界优先切页 + 范围/总数/`next_offset`/续读 footer（复用同 ref）、参数/越界/末尾/无正文诚实观察、作者可见 `activity_summary` 集中映射（`第 N 章「title」`，无工具 id/ref/UUID/JSON/offset）。CP2——判断 L2 与计划章节段渲染 `- 第 N 章「title」[chapter_ref=chapter:<uuid>]`（`WorkspaceContext`/`ContextAssembler` 只读 additive 透传 id + 新 `chapter_index_reader` 读端口）、catalog/计划步目录 ref-first + 续读说明、progress signature 去 sequence（同页重复命中 no-progress、合法续读不误停）、call2 观察重复渲染去重、`exploration_observed` 事件 payload 带 ref/offset 元数据（nil 不写入，避免 wire author-safe payload 把 nil 字符串化）。CP3——新场景 `judgment-explore-chapter-full-read`（seed 两章同名「灰烬中的手印」：A seq1 计划中干扰项、B seq2 7000 字符目标章 + 首/末页独有锚点 + 超长计划/摘要；外部 Playwright 驱动真实 Tauri 工作台）**PASS**：判断从模型可见索引取 B 的 `chapter_ref` → 两页 1–6000 / 6001–7000 → 逐字抄 footer JSON → reply 引用末页独有事实 → 零写入；作者可见时间线为「已阅读章节正文「灰烬中的手印」（第 2 章）…」，无内部形态。CP4——`judgment-explore-chapter-plan`（driver 断言随文案更新）、`p1-chapter-adoption-reading` 两回归真实 Tauri PASS；后端全量、frontend 566/0、全门禁绿；`task_done` 证据入档。
- **2026-10-23 开档（作者定向「方案 A 开一个 slice」）**：只读侦察确认根因 = 探索观察 1500 预算被设计态材料挤占（正文 4.9%）+ 无续读 + 探索回合 2；AI 两次拿到逐字节相同观察后被迫诚实回复。本 slice 冻结 `chapter_read` 观察 v2（分段预算/续读/进度语义），不做确定性重复审计（方案 B 归 `P1-word-count-audit` checkpoint B），不放宽回合硬上限。
- **2026-10-23 开档后作者纠偏（第一轮，D5 修订）**：①D3 原示例 `"第01章"` 把某部作品的章名格式当成通用契约，**错**——作品章名可为「恐惧体验」「午夜来电」等任意标题；第一轮改为「作品 TOC 真实章标题，原样复制」，匹配精确优先 + 既有子串回退，catalog/提示/测试不得硬编码编号格式。②`chapter_read` 是内部工具名，**不适合让作者看到**——原活动行「已检索 chapter_read「…」。」与 JSON query 都会把内部实现泄漏到作者面；改为集中人类可读文案，工具 id/offset 只留 developer payload/trace，并进验收断言（I-READ-8）。
- **2026-10-23 作者二次纠偏（身份模型，取代第一轮的标题寻址）**：作者指出「章节名会重复，哪怕加再多前提条件都可能重复」；只读核查确认 `chapters.id` 是 DB 唯一 UUID，`chapters.seq` 只是代码意图 work 内唯一（DB 无唯一约束），而探索/采纳/写作多处仍以 `(work_id, title)` 当身份（`find_or_create_chapter`/`ensure_planned_chapter`/`has_accepted_chapter?`/`accepted_chapter_prose`/`resolve_target_chapter`）；探索 `refs` 里已有 `chapter:<uuid>` 但模型看不到。修订：**唯一寻址改为 `chapter_ref = "chapter:<chapters.id>"`**；seq 仅作唯一命中别名，title 仅旧兼容且必须唯一命中（歧义列候选 ref，禁止 first-match）；判断/计划章节索引同批暴露 ref；作者面只用 `第 N 章「title」`（不出现 UUID/ref）；写入/采纳链 title 身份统一拆 follow-up slice（候选 `B25-chapter-identity-unification`，不在 B24 冒充解决）。
- **待作者拍板（建议默认，开工授权即执行、可翻案）**：
  - **D1 页大小与段预算**：正文单页 **6000** 字符；【计划】≤500、【摘要】≤400；整条观察 ≤7200。备选：更大单页（8k+）或 provider 档位化——建议 v1 固定，理由见 §1.1(d)。
  - **D2 回合策略**：**不改** `@max_explore_rounds 2`；单轮最多 2 页/12k 字符；超长章登记 gap。备选：本 slice 就加「续读授予额外回合」——建议不做，避免动预算 backstop 与 UA01 合同，等真实长章需求触发。
  - **D3 章节寻址（按作者二次纠偏修订）**：规范语法 `{"chapter_ref":"chapter:<chapters.id>","offset":N}`（UUID 来自判断/计划章节索引，DB 唯一、改名稳定）；`chapter_seq` 仅 work 内唯一命中别名；旧标题/纯标题仅唯一命中兼容，歧义列候选 ref，禁止 first-match；分页 footer 复用同一 ref。**不使用标题/序号作为安全身份**。
  - **D4 续读页是否重复计划/摘要**：**不重复**（仅 offset=0 页返回），减少 prompt 与重复信息；建议默认。
  - **D5 作者可见活动行（按作者纠偏修订）**：**必须改**——作者可见 `exploration_observed` summary 用集中人类可读标签（chapter_read → `已阅读章节正文「<title>」（第 N 章）（第 x–y 字符 / 共 N 字符）`），不得出现内部工具 id、`chapter_ref`/UUID、原始 JSON query、`offset` 字段名或 `inspect` 错误结构；工具 id/ref 只进 developer payload/trace（见 §1.1(e)）。
  - **D6 验收场景**：新建 `judgment-explore-chapter-full-read`，不复用 blocked 的 `judgment-explore-internal`；seed **两章同名标题**证明 ref 消歧（目标章正文 >6000 字符 + 首/末页锚点）；建议默认。
  - **D7 身份范围**：B24 **只改读取面**，以 `chapters.id` 为唯一身份；`find_or_create_chapter`/覆盖检测/读前文/目标章解析等写入/采纳链的 title 身份、`seq` 唯一约束/数据审计、`ChapterMissionRepo` 口径统一 → **follow-up slice**（候选 `B25-chapter-identity-unification`）。建议默认。

## 7. 未闭环 / 后续 gap（诚实登记）

1. **写入/采纳链的章节身份统一（follow-up slice，候选 `B25-chapter-identity-unification`）**：`find_or_create_chapter` / `ensure_planned_chapter` 仍按 `(work_id,title)` 复用章节，`has_accepted_chapter?` / `accepted_chapter_prose` / `resolve_target_chapter` 仍按 title；`chapters.seq` 无 DB 唯一约束、`ChapterMissionRepo` 混用 seq/id。重复标题在这些路径仍会合并/覆盖。触发：本 slice 收口后立即评估；需要 schema 约束/数据审计（重复 title/seq）与 adoption/writing 语义变更，不能借读取修复冒充。
2. **超长章**（正文 raw >12,000 字符）：单轮 2 页读不完；本 slice 仅返回前 12k 并诚实告知剩余量。触发条件：真实长章审核请求出现 → 开「续读回合/页预算 provider 档位化」小 slice。
3. **3 章以上批量全文阅读**：本 slice 最多 2 章/轮（各 ≤1 页）；跨多章重复审计归方案 B（确定性重复段/重复章检测）与后续批量阅读 slice。
4. **provider 自适应观察预算**：`AssemblyPolicy` 已有档位但探索服务未接；`strata: floor(2000)` 与真实能力不符，档位校准另立。
5. **真实模型是否遵守续读提示**：CP3 用确定性替身证明机制与主链；弱模型是否在真实会话中主动续读，归狗粮观察（与 C11/判断循环调参同批）。
6. **模型自述回复中的内部工具名**：本 slice 只保证系统生成的 activity / 事件文案不暴露内部工具 id/ref（I-READ-8）；模型回复正文仍受 N-NARR 字节绑定，不篡改、不后处理。若真实模型把 `chapter_read` 等写进回复，另立 prompt 引导 / 文案守卫评估（不阻塞本 slice）。
7. **真实模型是否按 ref 寻址**：catalog/章节索引说明 + 确定性替身可证明机制；弱模型是否优先复制 `chapter_ref`、不用标题猜，归狗粮观察；旧标题唯一命中兜底仍在。

## 8. 收口记录（2026-10-23）

**结果**：CP0–CP4 全部完成；`tasks/NEXT.md` 队首 B24 转 done、B23-FOLLOWUP 接队首；`docs/product/user-journeys.md` C12 转 closed；`docs/project-ledger.md` 与 `tasks/slices/README.md` 同步。

**真实页面验收（外部自动化驱动真实 Tauri 工作台）**

| 场景 | 结果 | 证据 |
|---|---|---|
| `judgment-explore-chapter-full-read`（新） | PASS | `artifacts/slice-verify/judgment-explore-chapter-full-read-tauri/summary.json`（turn `message_…`、`chapter_ref`、页范围 `[1,6000]/[6001,7000]`、两页作者可见 summary、`judgment_explore_count=2`、`judgment_reply_count=1`、零写入）+ 截图 / ui-frames / exploration-frames / judgment-prompts / llm-calls / app JSONL |
| `judgment-explore-chapter-plan`（回归，断言随文案更新） | PASS | `artifacts/slice-verify/judgment-explore-chapter-plan-tauri/summary.json` |
| `p1-chapter-adoption-reading`（正文读取/采纳回归） | PASS | `artifacts/slice-verify/p1-chapter-adoption-reading-tauri/summary.json` |

**门禁**：`mix compile --warnings-as-errors` / `mix format --check-formatted` / `mix credo --strict`（0）/ `mix dialyzer`（0）/ xref 无环 / arch / `adr_trace 27/27` / `quality_manifest_check` passed / 后端全量 / 前端 typecheck+lint+566 tests / frontend_audit 27 / design trace 16 / I1·I2·I3·N-NARR·I-CACHE-1 / 静态扫描 0 blocking（task-done manifest 由 `scripts/task_done.sh --slice judgment-explore-chapter-full-read` 生成）。

**单元/集成测试矩阵**：`exploration_service_test` 22 例（短章一页、两页覆盖、段落边界/硬切、offset 越界/末尾/非法、计划摘要再长正文仍 6000、ref/seq/title 三路寻址、重复标题/重复 seq 歧义列候选、只读零写、活动文案无内部形态、章索引带 ref）；`judgment_exploration_loop_test` 7 例（page1→page2 续读、末页事实 reply、章节索引 ref 双面身份、同页重复同签名/不同 offset 不同签名）；`agentic_plan_draft_planner_test` +2（计划章节段 ref、`chapter_index_reader` 注入）。

**诚实边界（§7）**：写入/采纳链 title 身份统一、`seq` 唯一约束/数据审计、`ChapterMissionRepo` 口径统一仍归 follow-up slice（候选 `B25-chapter-identity-unification`）；超长章 >12k、3 章以上批量、provider 自适应观察预算、真实弱模型是否主动续读/按 ref 寻址均登记 gap。
