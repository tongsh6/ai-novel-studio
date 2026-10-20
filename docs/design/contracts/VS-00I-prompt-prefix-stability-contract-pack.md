# VS-00I Prompt Prefix Stability Contract Pack（Prompt 前缀稳定性契约）

> 状态：Proposed（2026-10-21）。本文定义"每次 provider 请求从头开始的字节恒定前缀"的分层模型、各调用点映射、adapter 责任、度量与分期。不授权代码实现；实现经 `tasks/slices/UA01-agentic-loop-prompt-hardening.md` T6 推进。
>
> 角色：`VS-00H` 解决了"前缀第一段是什么"（系统身份）；本文解决"身份之后怎么排"。它是 `notes/2026-07-22-prompt-as-function-of-state.md` §2.1 六段骨架在**排序维度**上的补充——六段骨架回答"prompt 里要有哪些段、约束放哪"，本文回答"这些段按稳定度如何排才能被 provider 缓存复用"。两者冲突时，六段骨架中有判例支撑的位置要求优先（§2.3）。
>
> 上游：`VS-00H` §7、`VS-00D` §4.4、`foundation/08-provider-abstraction.md` §9.1 `cached_tokens`、`notes/2026-07-22` §2.1。

---

## 1. 核心问题

### 1.1 现状（2026-10-21 代码核查）

| 事实 | 证据 |
|---|---|
| 系统身份 171 字符之后，跨调用点第一行即角色句，彼此不同 | `judgment_protocol.ex:785`、`agentic_plan_draft_planner.ex:620`、`creative_provider/real.ex:141` 等 |
| 判断 call1 的 `context_block` 顺序：作品快照 → 章节 → 会话摘要 → interaction state → open behavior → **能力目录** | `dialogue_planning_service.ex:1124-1135`；静态的能力目录排在最易变的会话摘要之后 |
| 章节段的有界投影依赖作者输入 | `ChapterListBudget.project(chapters, author_text)`，作者点名章恒在列 |
| 起草 prompt 第 2 行是 `run_id`，随后 `profile_ref` / `goal_version` / `author_goal`，静态的"计划要求"在最后 | `agentic_plan_draft_planner.ex:542-562` |
| 判断 call1 无 tools、call2 带 `judgment` tool；起草带 `agent_plan_draft`；writer 无 tools | 各 prompt 构造函数 |
| LM Studio / OpenAI 兼容系经 chat template 把 tools 渲染进 system 轮 | `lm_studio.ex:194` `put_openai_tools`；渲染位置由模型 Jinja 模板决定 |
| Anthropic 缓存前缀顺序为 tools → system → messages；`cache_control` 仅在 system 且阈值 4096 字符，实际不触发 | `anthropic.ex` `anthropic_system/1` |
| writer / evaluator / world_building 已是"格式规范在前、上下文在后" | `creative_provider/real.ex`、`prose_quality_evaluator.ex` |
| `Usage.cached_tokens` 读 OpenAI / DeepSeek / Anthropic 字段；LM Studio 是否返回未验证 | `usage.ex`；`VS-00H` §11.1 |

### 1.2 问题陈述

```text
provider 的 prompt cache 是字节级最长公共前缀复用。
当前请求在身份之后立即分叉：跨调用点分叉于角色句，同调用点跨轮分叉于首个动态字段，
调用对（call1/call2）分叉于工具集差异。可复用前缀 ≈ 身份 171 字符，等于没有。
```

### 1.3 不是什么

- 不是改身份文本。`VS-00H` §2.2 的禁含规则不变，身份保持 171 字符。
- 不是删或改任何规则、判例、输出契约的语义。本文只授权**排序与分块**。
- 不是为缓存牺牲行为质量。六段骨架中有判例支撑的位置要求（§2.3）不动。
- 不是厂商专属优化。分层模型与调用对规则 provider 无关，同一份 prompt 字节发给所有厂商；厂商差异只在 adapter 的断点标记与命中字段映射（§5），LM Studio 只是矩阵中的一行，不是设计目标。

---

## 2. 五层稳定度前缀模型

### 2.1 分层

每次请求的内容按"多久变一次"分层，从前到后排列：

| 层 | 名称 | 内容 | 变化粒度 | 可复用范围 |
|---|---|---|---|---|
| L0 | 系统身份 | `SystemIdentity.content()` | 代码版本 | 全部请求 |
| L1 | 调用点静态前言 | 角色句、任务框架、输出格式说明、**工具 schema**、能力目录、按 profile 恒定的允许目标 | 代码版本 / profile | 同调用点全部请求 |
| L2 | 作品级半稳定 | 作品快照、章节稳定列表、角色阵容、已采纳规则摘要 | 作品事实变化时 | 同作品、同调用点连续请求 |
| L3 | 轮级易变 | 作者输入、会话摘要、interaction state、open behavior、作者点名章、goal、deviation、observation、run_id、revision_reason | 每轮 / 每 run | 仅调用对内 |
| L4 | 决策点约束 + 输出契约 | 判别规则、字段映射、禁止声明 | 代码版本 | 静态但置尾（§2.3） |

每层内部同样按"稳定 → 易变"排。

### 2.2 与六段骨架的映射

| 六段骨架 | 层 | 说明 |
|---|---|---|
| ① 角色任务一句话 | L1 | 置于身份之后第一行 |
| ④ 行动目录直挂正文 | L1 | 能力目录是静态的，不应排在会话摘要之后 |
| ③ 机械事实层 | L2 / L3 | 作品级事实 L2；轮级事实 L3 |
| ② 作者原文原样在场 | L3 | "在场"是存在性要求，不是位置要求 |
| ⑤ 约束块靠近决策点 | L4 | 位置要求，有判例，保留 |
| ⑥ 输出契约 + 结论→字段映射置尾 | L4 | 位置要求，有判例（call2 登记误判修复），保留 |

### 2.3 冲突裁决（2026-10-21 拍板）

- **L4 置尾是硬规则**，不是暂时接受。L4 静态却置尾，代价是每次重算几百 token；收益来自 L1 + L2 前置，二者差一个数量级。反方向有判例（call2 登记误判靠"映射置尾"修复），为省几百 token 去碰有实锤的位置不成立。
- 任何把 L4 内容前移的提议，必须先提供该调用点的 MBC A/B 数据证明判界不漂移，否则不接受；PR 中口头判断不算。
- L4 保持精简：不往 L4 新增静态段；新增静态内容默认进 L1。
- "作者原文在场"不要求作者输入排第二；若某调用点经 A/B 证明作者输入位置影响判断，该调用点可在 §4 登记例外。

---

## 3. 调用对与工具集恒定

### 3.1 规则（2026-10-21 拍板：默认开启）

同一调用对（call1 自由叙事 → call2 强制 tool call）内，**tools 列表字节恒定**：call1 携带与 call2 相同的工具集，`tool_choice` 为 `none`；call2 为强制该工具。

这是**默认开启的硬规则**，不是待数据证明的可选优化；§6 度量只用于决定是否按 adapter 回退，不用于决定是否启用。

理由：

- 结构性前提：Anthropic 缓存顺序 tools → system → messages，工具变化使**包括 system 在内**的全部缓存失效；OpenAI 兼容系 / 本地模板把工具渲染进 system 轮，工具变化 = system 块变化。工具不恒定，L0–L2 做得再好 call2 也命中不了 call1。
- 代价是 call1 多带一次 schema（judgment tool 约 1–2k 字符），但这部分本身进入可复用前缀，每个调用对只在第一次付一次。

唯一可能的行为副作用：call1 在 `tool_choice: none` 下出现工具调用倾向（输出里冒出 JSON / 函数名 / 调用语气）。CP-AB 的 MBC 必须专门断言这一项（§9）。

### 3.2 Adapter 责任

| Adapter | `tool_choice: none` | 处理 |
|---|---|---|
| OpenAI 兼容系 | 原生支持字符串 `"none"` | 透传 |
| LM Studio | 支持 `none / auto / required` | 透传（既有 `downgrade_named_tool_choice` 不受影响） |
| Anthropic | 需核对 `{type: "none"}` 支持 | 支持则映射；不支持则 adapter 降级为不发 tools，并在 ProviderRun metadata 标注 `tool_constancy: :degraded`，不伪造 |
| Stub / SliceVerify | 忽略 tools 的 call1 不得改变匹配行为 | 核验 |

### 3.3 适用调用对

- 判断 `narrative_prompt` / `decision_prompt`（`judgment` tool）
- 续行判断 `continuation_narrative_prompt` / `continuation_decision_prompt`（continuation tool）
- 起草 / 修订的双通道调用（已为 forced tool call，核对 content 通道是否同工具集）

---

## 4. 调用点映射表

本表是实现时的逐调用点真源；每行迁移独立成 checkpoint。

| 调用点 | L1（前置） | L2 | L3（后移） | L4（置尾，不动） | 迁移风险 |
|---|---|---|---|---|---|
| 判断 call1 `narrative_prompt` | 角色句；能力目录（从 context_block 末尾提前）；`judgment` tool（§3） | 作品快照；章节稳定有界列表 | 作者点名章；会话摘要；interaction state；open behavior；作者输入；forms_section | 作者登记规则；判别规则；输出要求 | **高**：判界顺序敏感，需 MBC A/B |
| 判断 call2 `decision_prompt` | 与 call1 字节相同的 L1 | 同 call1 | call1 的 L3 + narrative echo | 字段映射 | 随 call1 |
| 续行 call1 / call2 | 角色句；continuation tool；两种续行方式说明 | — | goal_text；deviation_summary；observation；narrative echo | 判别规则；输出要求 | 中 |
| 起草 `draft_context_block` | 角色句；"计划要求"整块；`plan_step_targets`；`internal_observation_steps`；`agent_plan_draft` tool | 作品章节列表 | `author_goal`；`stage_state_keys`；`goal_version`；**`run_id`**（模型不需要，移出或置尾） | 输出格式 | 低 |
| 修订 `revision_context_block` | 同起草 + 修订要求 | 同起草 | revision_reason；观察明细；当前计划 | 输出格式 | 低 |
| 章节使命 `ChapterMissionService` | 角色句；推导要求 | 作品材料 | 本章 / 本轮目标 | 输出格式 | 低 |
| writer `prose_writing` | 角色句；JSON 格式规范（已前置） | 前文 / 摘要 / 阵容 / 已采纳规则 | 作者 brief；本章使命；写作坐标 | — | 低，仅核对 L2 在 L3 前 |
| evaluator | 角色句；评审框架（已前置） | 质量门 | 待评正文；写作目标 | 输出格式 | 低 |
| world_building / character_design / outline | 角色句；格式规范（已前置） | 作品上下文 | 作者请求；artifact_type | — | 低 |
| 章摘要 / 设定盘点 | 角色句；四栏 / 提炼要求 | 已知角色 / 未决伏笔 | 正文摘录 | 输出格式 | 低 |

映射表中"移出"的字段（如 `run_id`）须确认模型确实不消费它；若 trace / 校验依赖它出现在 prompt 中，改为置尾而非移出。

---

## 5. 厂商适配矩阵

分层模型（§2）与调用对规则（§3）产出的 prompt 字节对所有 provider 相同；本表只列**adapter 层**为命中缓存需要做的事、能读到的命中字段、以及运行侧前提。"待核实"项在 CP-AB 以真实响应核实后回填，不预设。

| Provider | 缓存机制 | 门槛 / 粒度 | adapter 动作 | 命中观测字段 | 运行侧前提 | 核实状态 |
|---|---|---|---|---|---|---|
| OpenAI / OpenAI Subscription | 自动前缀缓存 | ≥1024 token，128 粒度；TTL 约 5–10 分钟 | 无 | `usage.prompt_tokens_details.cached_tokens` | — | 字段已接；live 基线待跑 |
| DeepSeek | 自动前缀缓存（磁盘 KV） | 64 token 块；TTL 以小时计 | 无 | `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | — | 字段已接；live 基线待跑 |
| Anthropic | **显式** `cache_control` 断点 | ≥1024 token（Haiku 2048）；最多 4 断点；顺序 tools → system → messages；TTL 5 分钟 / 1 小时 | 断点打在 **L1 末** 与 **L2 末**（messages 内），system 不打；撤销或闲置现 `anthropic_system/1` 的 4096 字符阈值分支 | `usage.cache_read_input_tokens` / `cache_creation_input_tokens` | — | 字段已接；断点策略未实现 |
| Gemini（OpenAI 兼容层） | 2.5 系列隐式缓存 + 显式 cache API | Flash ≥1024 / Pro ≥2048 token | 无（隐式） | 兼容层是否映射到 `prompt_tokens_details.cached_tokens` | — | **待核实** |
| Kimi（Moonshot） | 自动 context cache（另有显式 cache API） | 待核实 | 无 | `usage.cached_tokens` | — | **待核实** |
| 智谱 GLM | 部分模型自动缓存 | 待核实 | 无 | `prompt_tokens_details.cached_tokens` | — | **待核实** |
| MiniMax（海外 / 国内） | 待核实 | 待核实 | 无 | 待核实 | — | **待核实** |
| LM Studio（llama.cpp） | 推理槽位 KV 前缀复用 | 无门槛；逐 token | 无 | `usage.prompt_tokens` / `completion_tokens` / `total_tokens` / `completion_tokens_details.reasoning_tokens`；**无 `cached_tokens`** → 以 adapter 首 delta 的 `ttft_ms` 为代理（§6.2） | 实测：`qwen3.8-flash-next@q2_k`，context 262144，parallel **3**，TTL 空（未关闭空闲驱逐）。与“并行预测=1”前提不一致；live 命中测量须单会话并记录冲掉风险 | **已核实（2026-10-21，usage 字段）**；TTFT live 基线未跑 |
| Stub / SliceVerify | 无 | — | 无 | — | — | 不适用 |

> CP-AB 实测补充（2026-10-21）：LM Studio `/v1/chat/completions` 原始 usage 为
> `{prompt_tokens:55, completion_tokens:8, total_tokens:63, completion_tokens_details:{reasoning_tokens:8}}`，
> 无缓存字段；运行侧 `lms ps` 显示 `qwen3.8-flash-next@q2_k` / context 262144 /
> parallel 3 / TTL 空。OpenAI / DeepSeek / Anthropic / Gemini / Kimi / 智谱 / MiniMax
> 在本次 shell 无凭据，保持“待核实”，不编造。TTFT live 基线未跑。

跨厂商共同前提（适用于上表所有行）：

- **同一 purpose 链路路由到同一模型**。`gateway.ex` 的 `purpose_models` 若把判断 / 起草 / 写作分到不同模型，任何厂商的缓存都按模型隔离，分层再好也无共享。
- **调用对与连续轮次落在 TTL 内**。AgentRun 内相邻调用间隔为秒级，天然满足；跨 session 的长间隔不期待命中。
- **并发**：云厂商缓存按组织 / 前缀共享，并发不破坏命中（Anthropic 首个请求写缓存、并发请求可能同时 miss 属正常）；本地单槽位推理在多会话并发下互相冲掉，度量时须控制为单会话。

---

## 6. 度量

### 6.1 前缀共享度量（离线、厂商无关、主 proof）

在 Stub / SliceVerify 捕获的请求帧上，对"同调用点相邻两次请求"和"同调用对 call1 / call2"计算公共前缀长度（字节为主，本地 tokenizer 近似为辅），输出：

```text
call_site | pair_kind (consecutive | call_pair) | shared_prefix_bytes | total_bytes | ratio
```

这是 T6 每个 checkpoint 的主要 proof：它不依赖任何厂商凭据，直接证明 §2 分层与 §3 恒定是否成立。候选落点 `scripts/scenario_invariants/run_icache_prefix.exs`，报告 `artifacts/scenario-invariants/icache.md`；正式登记为不变量须同步 `docs/engineering/scenario-invariants.md`。

### 6.2 命中观测（在线、逐厂商、辅 proof）

- **有命中字段的厂商**：`Usage.cached_tokens` 已能读 OpenAI / DeepSeek / Anthropic；其余按 §5 矩阵在 CP-AB 以真实响应核实字段名后补映射。进 ProviderRun 事实与开发者视图，不进作者可见面。
- **无命中字段的厂商**（LM Studio 等）：adapter 记录 TTFT（首 token 延迟）进 ProviderRun 事实；前缀命中时 TTFT 断崖式下降，作为代理指标。TTFT 对所有厂商都记，便于横向比较。
- **live 基线**：每个有凭据的厂商各跑一次同调用对 / 连续两轮，记录 `cached_tokens` 与 TTFT 作为基线；凭据属用户门控（NEXT B4），无凭据的厂商只做 §6.1 离线度量，不阻塞 T6。

---

## 7. 不变量

| ID | 不变量 | 机器可验 | 门禁时机 |
|---|---|---|---|
| I-CACHE-1 | 同调用对 call1 / call2 的 L0–L1 字节恒定；同调用点连续两轮、作品未变时 L0–L2 字节恒定 | §6.1 度量脚本断言 | CP-AB 起出报告；**CP-C 完成后**登记进 `docs/engineering/scenario-invariants.md` 升为 CI 阻断（此前阻断会把所有未迁移调用点标红，无信息量） |
| I-CACHE-2 | 同调用对 tools 列表字节恒定 | 捕获帧断言 | CP-AB 起即阻断（范围只含已迁移调用对） |
| I-CACHE-3 | 迁移前后该调用点 MBC pass_rate 不退化；call1 在 `tool_choice: none` 下无工具调用倾向 | 既有探针 A/B + 新增断言 | 每个 CP 的合入门禁 |
| 继承 | I-SYS-1～3、I1 / I2 / I3、N-NARR、N-PLAN 全部不变 | 既有 driver | 不变 |

---

## 8. 边界（七问）

| 问 | 答 |
|---|---|
| Contract | 本文；`VS-00H` §7；`notes/2026-07-22` §2.1 六段骨架（只重排不删段）；`08` §9.1 |
| Invariant | I-CACHE-1～3；继承项全绿 |
| Boundary | `novel_application` 各 prompt 构造函数（重排 / 分块）；`novel_agent` adapter（`tool_choice: none` 映射、Anthropic 断点、TTFT）；`novel_web` / `frontend` / `novel_persistence` schema 不动 |
| Consumer | 全部 provider 调用；开发者视图 `cached_tokens` / TTFT；§6.1 度量脚本 |
| Proof | 前缀共享度量 + MBC A/B + I1/I2/I3/N-NARR/N-PLAN + 一次 live 命中基线 |
| Acceptance Driver | 既有 slice_verify / tauri_slice_verify 场景复跑；证据为捕获帧与 ProviderRun 事实；作者侧 UI 无变化属预期；产品代码零验收感知 |
| Exploration | 不适用 |

---

## 9. 分期（2026-10-21 拍板）

| CP | 范围 | Proof | 不做 |
|---|---|---|---|
| **CP-AB 观测 + 首个实证** | §6.1 度量脚本；TTFT 进 ProviderRun（全厂商）；§5 矩阵"待核实"项以真实响应回填；有凭据厂商各一条 live 基线；本地推理按 §5 前提核对记录；**§3 工具恒定**（含各 adapter `tool_choice: none` 映射 / 降级）；**续行 call1/call2 按 §4 重排**作为度量的首个对照样本；顺带修复 VS-00H 评审 P1（`ProviderRunLog.usage_summary/2` 投影 `system_identity_ref`，与 TTFT 落点相邻） | 度量脚本对"改前 / 改后"给出可区分的共享前缀数字（改前≈L0，改后 call2 ≈ call1 全长）；I-CACHE-2 绿；MBC 不退化且 call1 无工具调用倾向；每个可达厂商有 `cached_tokens` / TTFT 基线落 `artifacts/`；activity API 可见 `system_identity_ref` | 判断 call1 重排；身份文本任何改动 |
| CP-D 起草 / 修订 | §4 起草、修订、章节使命行 | 跨 run 共享前缀覆盖 L1；N-PLAN 绿 | — |
| CP-C 判断 call1 重排 | §4 判断行；拆章节段；能力目录前置 | 连续两轮共享前缀覆盖 L0–L2；**MBC A/B pass_rate 不降**；I1/I2/I3 绿。**失败路径**：A/B 不过 → 该调用点在 §4 登记例外并保留现顺序，不改措辞重试、不强推 | 前移 L4 |
| CP-E 厂商断点与基线复测 | Anthropic 断点（§5）；CP-AB～D 完成后对每个厂商基线复测；I-CACHE-1 升 CI 阻断 | Anthropic live 一次 `cache_read_input_tokens > 0`；各厂商相对 CP-AB 基线有可解释改善；`scenario-invariants.md` 登记 I-CACHE-1 | — |

顺序 AB → D → C → E。A 与 B 合并的原因：度量脚本若无"改后"样本只能证明现状≈0，证明不了度量可信；续行调用对是最小、最确定的改动，正好做首个对照；A 单独落会成为"只建工具不消费"的禁止形态。C 保持最后且带明确失败路径。

**排期**：不插队 Q1c；CP-AB 排在 Q1c 收口之后、任何再碰 prompt 的工作之前——度量工具越晚建，之后每次 prompt 改动都是未度量的前缀回归风险。前缀部分优先级因此为 P1。

**冻结纪律**：本文在 CP-AB 于真实调用对上证明"call2 共享前缀 ≈ call1 全长"之后才改 Frozen，沿用 VS-00H 实现完再冻结的先例。身份文本保持 v1，不与本文任何 CP 捆绑。

---

## 10. 风险与处置

| 风险 | 处置 |
|---|---|
| 顺序敏感导致判界漂移 | CP-C 以 MBC A/B 为硬门禁；失败则该调用点登记例外，不强推 |
| Stub / SliceVerify 对 prompt 段落位置有隐含假设 | 它们按 `## 标题` 子串匹配；重排保留标题；仅改 test/support，不动产品 |
| Anthropic 不支持 `tool_choice: none` | adapter 降级并标注，不伪造恒定 |
| call1 多带 schema 的 token 成本 | 默认开启（§3.1 硬规则）；成本进入可复用前缀，每调用对只付一次；CP-AB 数据仅用于决定是否按 adapter 回退 |
| 并发 / 多会话下本地单槽位推理互相冲掉 | 仅影响本地推理行；度量时控制为单会话；生产多会话场景的命中率单独记录，不作为 T6 验收 |
| 某厂商命中字段名与矩阵假设不符 | CP-AB 以真实响应回填，矩阵"待核实"不写成已知；映射错误只影响观测不影响 prompt 字节 |
| `run_id` 移出 prompt 影响 trace 关联 | 先确认模型不消费；trace 关联走 ProviderRun owner_refs，不靠 prompt 文本 |

---

## 11. 实现证据（2026-10-21，CP-AB）

| 项 | 证据 |
|---|---|
| A1 离线度量 | `scripts/scenario_invariants/run_icache_prefix.exs`；改前 continuation `523/1683 (0.3108)`、conversation `525/5282 (0.0994)`；改后 continuation `780/1940 (0.4021)`、conversation `525/6686 (0.0785)`；报告 `artifacts/scenario-invariants/icache-before.md` / `icache.md` |
| I-CACHE-2 | 同一调用对 call1/call2 tools canonical JSON 字节相等；脚本内断言通过 |
| A2 TTFT | `Usage.ttft_ms`；OpenAI-compatible/Anthropic stream 首 text/tool delta；非流式回填 latency；ProviderOutput/activity usage 透传；单测通过 |
| B1 工具恒定 | call1 携带与 call2 相同 tools + `tool_choice: "none"`；OpenAI 透传；Anthropic 省略 tools 并标 `tool_constancy: :degraded`；Stub/SliceVerify 尊重 none |
| B2 续行重排 | `continuation_common_prefix/0`（角色句 + 两种续行方式）为 call1/call2 共同前缀；未改规则语义 |
| B3 VS-00H P1 | `ProviderRunLog.usage_summary/2` 投影 `system_identity_ref`；activity API 可见 version/hash，不泄漏身份原文 |
| MBC | `tool_call_compliance.exs stub` pass_rate=1.0（2/2）；call1 `tool_choice:none` focused 测试 `tool_calls == []` |
| A3/A4 | LM Studio 实测 usage 无 `cached_tokens`（prompt/completion/total + reasoning_tokens）；runtime `qwen3.8-flash-next@q2_k` / context 262144 / parallel 3 / TTL 空；其他厂商 shell 无凭据，保持待核实 |
| 门禁 | 后端 1,577/0；compile/xref/arch PASS；前端未改动 |

**未 Frozen 的原因**：续行 call_pair 的共享前缀虽显著提升（0.3108 → 0.4021），但仍未达到本文冻结纪律要求的“call2 共享前缀 ≈ call1 全长”；且 A3 多厂商 live 基线、LM Studio TTFT live 基线、CP-AB 规定的两条 slice_verify 场景尚未完成。状态保持 Proposed，不把局部实证冒充全量冻结。

---

## 12. 与现有文档关系

- `VS-00H`：L0 的真源；§7 "缓存是顺带打开的门"在本文展开为可执行契约。
- `notes/2026-07-22` §2.1：六段骨架是内容契约，本文是排序契约；§2.2 映射、§2.3 裁决。
- `VS-00D` §4.4：三层信封投影到 messages 时的顺序应遵守本文分层（NovelLayer 的稳定原则 → L1/L2，WorkState → L2，TurnGuidance → L3/L4）。
- `08` §9.1 `cached_tokens`、§17 trace：TTFT 与命中数是 §17.1 "latency / usage" 的细化。
- `UA01-agentic-loop-prompt-hardening.md` T6：承重入口，原"prompt 静态段前置（KV cache 友好）"一句展开为本文 CP-AB → D → C → E。
- `tasks/NEXT.md` B4 / B8：B4 是 live 厂商矩阵的凭据门控（§6.2 基线依赖）；B8 是本地推理上下文配置的运维先例（§5 LM Studio 行运行侧前提）。
