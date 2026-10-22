# VS-00I Prompt Prefix Stability Contract Pack（Prompt 前缀稳定性契约）

> 状态：**Frozen（2026-10-21，作者裁决 §14 选项 1）**。本文定义"每次 provider 请求从头开始的字节恒定前缀"的分层模型、各调用点映射、adapter 责任、度量与分期。不授权代码实现；实现经 `tasks/slices/UA01-agentic-loop-prompt-hardening.md` T6 推进。**2026-10-21 进展**：CP-AB / CP-D / CP-C 完成；CP-E 在 local/DeepSeek 范围完成（含 Strata 临时 IQ3 profile）；冻结判据按 §14 选项 1 修订并生效。Anthropic live/断点、其余厂商凭据与 Strata Q2 live 复测为**冻结后 adapter 增量**，不阻塞本契约。
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
| DeepSeek | 自动前缀缓存（磁盘 KV） | 64 token 块；TTL 以小时计 | 无 | `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | — | **已核实（2026-10-21，CP-E）**：`deepseek-v4-pro`、生产判断 call1 prompt（10,046 bytes / 2,057 input tokens）连续两次，`cached_tokens=2048`（2048/2057 ≈ 99.6%），TTFT 3755→3319ms（`prompt_prefix_live.exs`，报告 `artifacts/model-contracts/prefix-live/deepseek.md`）。 |
| Anthropic | **显式** `cache_control` 断点 | ≥1024 token（Haiku 2048）；最多 4 断点；顺序 tools → system → messages；TTL 5 分钟 / 1 小时 | 断点打在 **L1 末** 与 **L2 末**（messages 内），system 不打；撤销或闲置现 `anthropic_system/1` 的 4096 字符阈值分支 | `usage.cache_read_input_tokens` / `cache_creation_input_tokens` | — | 字段已接；断点策略未实现 |
| Gemini（OpenAI 兼容层） | 2.5 系列隐式缓存 + 显式 cache API | Flash ≥1024 / Pro ≥2048 token | 无（隐式） | 兼容层是否映射到 `prompt_tokens_details.cached_tokens` | — | **待核实** |
| Kimi（Moonshot） | 自动 context cache（另有显式 cache API） | 待核实 | 无 | `usage.cached_tokens` | — | **待核实** |
| 智谱 GLM | 部分模型自动缓存 | 待核实 | 无 | `prompt_tokens_details.cached_tokens` | — | **待核实** |
| MiniMax（海外 / 国内） | 待核实 | 待核实 | 无 | 待核实 | — | **待核实** |
| LM Studio（llama.cpp） | 推理槽位 KV 前缀复用 | 无门槛；逐 token | 无 | `usage.prompt_tokens` / `completion_tokens` / `total_tokens` / `completion_tokens_details.reasoning_tokens`；**无 `cached_tokens`** → 以 adapter 首 delta 的 `ttft_ms` 为代理（§6.2） | 实测：`qwen3.8-flash-next@q2_k`，context 262144，parallel **3**，TTL 空（未关闭空闲驱逐）。与“并行预测=1”前提不一致；live 命中测量须单会话并记录冲掉风险 | **已核实（2026-10-21，CP-E）**：生产判断 call1 prompt（10,046 bytes）连续两次，TTFT 195,350ms → 6,619ms（run1 含模型冷加载，run2 同 slot 前缀复用代理）；usage 仍无 cache 字段、流式 token 计数 0。报告 `artifacts/model-contracts/prefix-live/lmstudio.md`。 |
| Strata（strata-engine，本地 OpenAI 兼容） | 引擎侧 KV / expert cache（实测前缀复用） | 待核实（本地 profile，context 262144） | 无（thinking → 顶层 `reasoning_effort: "none"`） | `usage.input_tokens` / `output_tokens`；**`cached_tokens` 实测回传** | 127.0.0.1:8081，`qwen3.8-flash-next-q2_0`；本地单机 Q2 与 IQ3 profile 不可同时常驻（128GB 机器实测 IQ3 引擎 RSS 60.9GB + Q2 模型 69GB） | **2026-10-21 起 dev 默认 provider**（`NOVEL_PROVIDER_DEFAULT=strata`）；Q2 服务 8081 未启动，Q2 live 待跑。临时 IQ3 profile（8082，`qwen3.8-flash-next-iq3_s`）live 基线：prefix 连续两次 `cached_tokens=2125/2132 (99.7%)`、TTFT 2059→65ms；MBC judgment 7/7、tool-call 2/2（临时 profile，不作 Q2 冻结证据） |
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

**冻结纪律（2026-10-21 作者裁决 §14 选项 1 修订，原「≈ call1 全长」表述作废）**：以下三条同时成立才改 Frozen——① 已迁移调用点的 call2 共享前缀覆盖 call1 的 **L0–L2 全长**（L4 按 §2.3 置尾、不参与共享前缀）；② 已迁移调用点 I-CACHE-1 全绿（driver enforce 行 + CI/静态扫描阻断）；③ 至少一个可达厂商有 live 命中证据。沿用 VS-00H 实现完再冻结的先例；Anthropic live/断点与其余厂商按 adapter 增量补齐，不阻塞冻结。身份文本保持 v1，不与本文任何 CP 捆绑。

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
| A3/A4 | LM Studio 实测 usage 无 `cached_tokens`（prompt/completion/total + reasoning_tokens）；runtime `qwen3.8-flash-next@q2_k` / context 262144 / parallel 3 / TTL 空；短流式 TTFT=1365ms（token 计数 0，流式 usage 未返回）；其他厂商 shell 无凭据，保持待核实 |
| 门禁 | 后端 1,577/0；compile/xref/arch PASS；前端未改动；`agentic-loop-gate-deviation-replan` 真实 Tauri PASS |

### 11.1 CP-D 实现证据（2026-10-21）

| 项 | 证据 |
|---|---|
| 重排范围 | `AgenticPlanDraftPlanner` 起草/修订（`draft_context_block` / `revision_context_block` 与四条 prompt 构造器）、`ChapterMissionService.mission_prompt`；只改排序，不删段、不改措辞 |
| L1 前置 | 调用点常量参数（`profile_ref` / `plan_step_targets` / `internal_observation_steps`）、计划/修订要求、能力目录；`run_id` 从首字段移至 L3 尾部 |
| 前缀度量（跨 run） | `run_icache_prefix.exs` 新增 `cross_run`：draft_reasoning `2675/3654 (0.7321)`、draft_structure `2675/4911 (0.5447)`、revision_reasoning `2753/4028 (0.6835)`、revision_structure `2753/5571 (0.4942)`、chapter_mission `1270/2782 (0.4565)`；每条均覆盖 L1/L2 边界（boundary 2634 / 2712 / 1160），`enforce=true` 硬断言 |
| N-PLAN | planner / mission / prose-drafting flow / plot-outline flow focused tests 全绿；计划语义、schema、校验未动 |
| 回归钉 | 3 条 prompt 段落顺序测试（起草、修订、章节使命）钉住 L1 → L2 → L3 → L4 |
| 报告 | `artifacts/scenario-invariants/icache-cp-d.md` / `.json` |

诚实边界：公开 prompt 构造器（`@doc false`）是 CP-D 同批补的，改前旧排序没有同口径数字；本 CP 以“公共前缀 ≥ L1 边界”的绝对位置断言证明覆盖，未伪造改前数字。CP-C 前的判断连续两轮基线（`1107/10022 (0.1105)`，能力目录未覆盖）另存 `icache-cp-c-before.md`。

### 11.2 CP-C 实现证据（2026-10-21）

| 项 | 证据 |
|---|---|
| 重排范围 | `JudgmentProtocol` call1/call2 共享 L1 公共前缀（角色句 + 能力目录；目录从 `context_block` 末尾迁入 L1）；`DialoguePlanningService.judgment_context_block/2` 只承载 L2/L3；章节段拆为稳定列表（L2，不消费作者输入）+ 作者点名章（L3 补充） |
| 连续两轮共享前缀（L0–L2） | `judgment_consecutive` `1107/10022 (0.1105, covered=false)` → `2543/10051 (0.2530, covered=true, boundary=2505)`；`enforce=true` 硬断言 |
| 调用对共享前缀（L0–L2） | `conversation` call_pair `525/6686 (0.0785)` → `2059/8175 (0.2519)`；新增 `judgment_call_pair_prod`（production 上下文、含 4 章）`3927/10052 (0.3907)`，`boundary=3925`、`covered=true`、`enforce=true`——call2 共享前缀覆盖 call1 全部 L0–L2（止于 L3 分叉），L4 按 §2.3 硬规则置尾、不参与共享前缀 |
| MBC A/B（pass_rate 不降） | 7 用例 × 1 run、production 上下文形态：stub / LM Studio `qwen3.8-flash-next@q2_k` / DeepSeek `deepseek-v4-pro` 改前改后均 protocol=1.0、form=1.0、judgment=1.0，call2 首调 1.0、0 重试 |
| 继承不变量 | I1 4/4、I2 3 pairs disjoint、I3 3+3、N-NARR PASS；全量 `mix test` 623+126/0 |
| 回归钉 | 2 条单测（call1/call2 共享 L1+L2 字节前缀；章节拆段与连续两轮 L2 恒定） |
| 报告 | `artifacts/scenario-invariants/icache-cp-c.md`、`artifacts/model-contracts/{stub,lmstudio,deepseek}/judgment-protocol-cp-c-{before,after}.json` |

诚实边界：MBC 电池在三个 provider 上均为 7/7（天花板效应），本轮只能证明“不退化”，不是灵敏度测试；失败路径未触发，无调用点例外登记。

### 11.3 CP-E 实现证据（2026-10-21，local/DeepSeek 范围）

> 作者 2026-10-21 明确本阶段 scope：`CP-D → CP-C → CP-E（local/DeepSeek）`。

| 项 | 证据 |
|---|---|
| DeepSeek live 缓存命中 | `deepseek-v4-pro`，生产判断 call1 prompt（10,046 bytes / 2,057 input tokens）连续两次：`cached_tokens=2048`（2048/2057 ≈ 99.6%），TTFT 3755→3319ms；`artifacts/model-contracts/prefix-live/deepseek.md` |
| LM Studio TTFT 代理 | `qwen3.8-flash-next@q2_k`，同一 prompt 连续两次：TTFT 195,350ms → 6,619ms（run1 含模型冷加载，run2 单会话同 slot 前缀复用；无 cache 字段，token 计数 0）；`artifacts/model-contracts/prefix-live/lmstudio.md` |
| Strata（临时 IQ3 profile） | 本地 strata-engine 8082 / `qwen3.8-flash-next-iq3_s`，同一生产 prompt 连续两次：`cached_tokens=2125/2132 (99.7%)`、TTFT 2059→65ms；MBC judgment 7/7、tool-call 2/2。报告 `artifacts/model-contracts/prefix-live/strata-iq3-temp.md`、`artifacts/model-contracts/strata/*-iq3-temp.json`。**这是临时 profile，Q2（8081）待切换后同口径复测。** |
| 调用对可缓存前缀覆盖 | `judgment_call_pair_prod` `3927/10052`，boundary=3925、`covered=true`、enforce：call2 共享前缀覆盖 call1 全部 L0–L2（L4 按 §2.3 置尾、不参与） |
| I-CACHE-1 登记与门禁 | `docs/engineering/scenario-invariants.md` §8；`.github/workflows/ci.yml` 新增 step；`scripts/ai_static_scan.sh` 新增 `scenario-invariants-i-cache` check；driver `run_icache_prefix.exs` 的 enforce 行覆盖判断连续两轮、判断 call_pair L0–L2、起草/修订/章节使命 cross_run |
| 验收驱动 | `bash scripts/slice_verify.sh au02-candidate-continuation` PASS（真实页面 + 前后端主链；产品代码零验收感知） |
| 门禁 | `mix compile --warnings-as-errors`、全量 `mix test` 0 failures、xref 无环、arch PASS、I1/I2/I3/N-NARR 绿 |

诚实边界：Anthropic live `cache_read_input_tokens > 0` **未做**——shell 与桌面 secret 均无 Anthropic 凭据；Anthropic 断点策略需要把 prompt 切成 message content blocks（L1 末 / L2 末），当前 prompt 是单一 user message，分块契约未实现，不伪造。Gemini / Kimi / 智谱 / MiniMax / OpenAI 同样无凭据，保持未核实。

**Frozen 后边界（2026-10-21）**：Anthropic live `cache_read_input_tokens > 0` 与断点分块、Gemini / Kimi / 智谱 / MiniMax / OpenAI 的凭据与 live 基线仍缺，按 §14 作为冻结后 adapter 增量，不阻塞本契约；本地默认 provider 已指向 Strata Q2（8081），Q2 live 复测在服务切换后补，不改变已冻结的判据与排序。**2026-10-22 口径注记**：本地 Strata 已改为只连 Strata App 统一推理后台 `http://127.0.0.1:47831/v1`（per-profile 8081/8082 方案 superseded）；本契约 8081/8082 记录保留为当时测量证据，不改变已冻结判据。

---

## 12. 与现有文档关系

- `VS-00H`：L0 的真源；§7 "缓存是顺带打开的门"在本文展开为可执行契约。
- `notes/2026-07-22` §2.1：六段骨架是内容契约，本文是排序契约；§2.2 映射、§2.3 裁决。
- `VS-00D` §4.4：三层信封投影到 messages 时的顺序应遵守本文分层（NovelLayer 的稳定原则 → L1/L2，WorkState → L2，TurnGuidance → L3/L4）。
- `08` §9.1 `cached_tokens`、§17 trace：TTFT 与命中数是 §17.1 "latency / usage" 的细化。
- `UA01-agentic-loop-prompt-hardening.md` T6：承重入口，原"prompt 静态段前置（KV cache 友好）"一句展开为本文 CP-AB → D → C → E。
- `tasks/NEXT.md` B4 / B8：B4 是 live 厂商矩阵的凭据门控（§6.2 基线依赖）；B8 是本地推理上下文配置的运维先例（§5 LM Studio 行运行侧前提）。

---

## 13. CP-AB 收口决定（2026-10-21，Goal G-B20+AB）

- 状态保持 **Proposed**（该状态已于 2026-10-21 由 §14 作者裁决改为 **Frozen**）；CP-AB active 工作关闭。
- 重新度量：continuation `780/1940 (0.4021)`、conversation `525/6686 (0.0785)`；未达到“call2 共享前缀 ≈ call1 全长”的冻结纪律。
- 厂商 shell 凭据全部 unset；当前只有 LM Studio 单次短流式 TTFT=1365ms，不具备全厂商 live 基线。
- D5 `plan_revised` 场景已判定 legacy/superseded，不能作为 CP-AB 冻结证据。
- **恢复条件**：提供至少目标厂商凭据并完成 CP-D/CP-C/CP-E，或由作者显式缩减契约范围并重新定义冻结判据。
- 在此之前，不再以 CP-AB 名义改 prompt；不得把局部度量、stub MBC 或单一 LM Studio TTFT 冒充全量 Frozen。

---

## 14. CP-D/C/E 执行结果与冻结裁决（2026-10-21，作者选 1 → Frozen）

**执行结果**：CP-D、CP-C 完成；CP-E 在作者指定的 local/DeepSeek 范围完成（证据见 §11.1–§11.3、§5 矩阵、§8 I-CACHE-1 登记）。

**结构性冲突**：§9 冻结纪律要求「call2 共享前缀 ≈ call1 全长」，但 §2.3 裁决 L4（判别规则、输出契约）必须置尾——call1 的 L4 段按硬规则不可能进入共享前缀。实测 call2 已覆盖 call1 的**全部可缓存前缀**（L0–L2，`judgment_call_pair_prod` `3927/10052`，boundary=3925、covered=true）；剩余约 6.1k 字节正是 L4 输出契约，设计上不应共享。

**冻结提案（二选一，需作者拍板）**：

1. **（已选）修订冻结纪律**为「call2 共享前缀覆盖 call1 的 L0–L2 全长（L4 置尾除外）」+ 已迁移调用点 I-CACHE-1 全绿 + 至少一个可达厂商 live 命中证据（DeepSeek `cached_tokens 2048/2057`、Strata IQ3 临时 profile `2125/2132`、LM Studio TTFT 代理）→ 可将本文改 Frozen；Anthropic 断点/后续厂商按 adapter 增量补齐，不阻塞冻结。
2. **保持原文**「≈ call1 全长」并永远保持 Proposed（结构上不可达，除非推翻 §2.3 的 L4 置尾裁决——那需要新的判界 A/B 证据）。

**作者裁决（2026-10-21）**：选 **1**。本文自本日起状态 **Frozen**；§9 冻结纪律已按方案 1 修订，原「≈ call1 全长」表述作废。

**冻结生效核对（方案 1 三条件，2026-10-21）**：

- [x] **call2 覆盖 call1 的 L0–L2 全长**：`judgment_call_pair_prod` `3927/10052`，boundary=3925、`covered=true`、`enforce=true`（L4 按 §2.3 置尾、不参与）。
- [x] **已迁移调用点 I-CACHE-1 全绿**：`run_icache_prefix.exs` 的 1 条 consecutive + 5 条 cross_run + 1 条 call_pair enforce 全过；已接入 CI step 与 `ai_static_scan.sh` critical check。
- [x] **至少一个可达厂商 live 命中**：DeepSeek `deepseek-v4-pro` `cached_tokens=2048/2057 (99.6%)`；Strata IQ3 临时 profile `cached_tokens=2125/2132 (99.7%)`、TTFT 2059→65ms。

**冻结后边界（不阻塞契约，按增量推进）**：①Anthropic live `cache_read_input_tokens>0` 与断点分块（需 message content blocks 契约）；②其余厂商凭据/live 基线；③Strata Q2（8081）服务切换后的同口径 live 复测；④桌面 stage profile 的 provider 持久选择切换与 dogfood/stage 的 strata 支持。冻结后不得以「某厂商未覆盖」为由回退 L0–L4 排序或放开 L4 置尾；L4 前移仍须先有该调用点 MBC A/B 判界数据（§2.3）。

**未完成边界（两手都不掩盖）**：Anthropic live `cache_read_input_tokens > 0` 未做（无凭据）；Anthropic 断点需把单一 user message 切成 L1 末/L2 末 content blocks，分块契约未实现；Gemini / Kimi / 智谱 / MiniMax / OpenAI 仍无凭据、未核实。


## 15. 冻结后增量：真实调用对与通道边界（2026-10-23）

作者授权：先补真实调用对探针并运行现有可用 Provider，再依证据修 adapter；各 Provider
差异只进入自己的适配通道，不改全局配置或升级工具。本节补充验证边界，不改变 L0–L4
排序、L4 置尾及系统身份文本。

### 15.1 应用前缀稳定是必要条件，不等于服务端已命中

原 `prompt_prefix_live.exs` 重复发送同一份 call1；该结果仅证明同请求复测，不能证明
生产 call1（自然语言、tool_choice=none）→call2（实际说明经生产截断后、具名强制工具）
之间的缓存复用。I-CACHE-1/2 仍是应用层结构不变量，不代表供应商模板后的 token 前缀。
新的探针调用 `JudgmentProtocol.request_judgment` + `Execution` + `Gateway`，留存原生
HTTP/SSE、实际模型、端点、工具哈希和 ProviderRun facts。长说明绑定消费生产
`decision_prompt` 的既有截断规则，不复制该规则。缺字段为 unobservable，明确 0 为 miss，
正数为 hit；重试不得隐藏成首调成功，非流式总耗时不冒充 TTFT。

### 15.2 当前实测与修复

证据：`artifacts/model-contracts/prefix-live/verified-20261023/summary.{json,md}`；
逐请求原文为同目录 `deepseek-wire.json`、`strata-wire.json`。全部为脚本虚构样书，未读实际作品。

| 通道 | 实际调用对（3 组） | 独立同请求对照 | 处置 |
|---|---|---|---|
| DeepSeek / deepseek-v4-pro | 协议均通过；call2 每次 384 tokens 命中 | 第二次 2048/2142 | 保持现有请求协议；首批首对 0、后续部分命中，不能要求首次相邻请求必命中；未证明 L0–L2 全覆盖 |
| Strata / iq3_s，App 0.2.1 + engine 0.1.47 Metal | 协议均通过；call2 每次 0 | 第二次 2138/2145 | `none` 在服务端删除工具造成模板前缀分叉；仅本 adapter 标记 tool_constancy=degraded，保持禁用工具语义 |
| LM Studio | 未运行推理 | 未运行 | 仅 embedding 已加载；原 /v1/models 包含下载目录，探针在自己的 LM 通道另查 /api/v1/models.loaded_instances，不自动加载模型 |
| Anthropic 及其余云通道 | 缺凭据，blocked | 未运行 | 不以 stub 替代、不声称 live 已验证 |

通道修复：Anthropic 官方支持 `{type: none}`，原本「不支持 none」的假设撤销；原生
工具映射移入 `Anthropic`，流式 call1 保留工具列表、维持禁止调用，移除错误的降级标记。
只完成协议测试，没有 Anthropic live 缓存证据；既有显式缓存断点/内容分块缺口仍开放。
共同计量修复：`Usage` 的非流式构造器令 `ttft_ms=nil`，`latency_ms` 保留真实总耗时；
流式仍由首 delta 时间填入 TTFT。OpenAI 兼容共享层仅开放 adapter execute 覆盖入口，
不含 Strata vendor 判断；其他通道有隔离回归测试。

### 15.3 运行方式与未闭环边界

`PREFIX_PROBE_PROFILE_DIR` 显式指定已有桌面 profile，设置与凭据仅装入当前 BEAM 的
RuntimeConfig，不写文件。运行 `bash scripts/probe_run.sh scripts/model_contracts/prompt_prefix_live.exs all 1`；
`PREFIX_PROBE_MODE=inventory` 仅盘点，`pair` 仅首个调用对，默认运行完整四组。
`PREFIX_PROBE_LABEL` 为报告标签。索引与自测见 `scripts/model_contracts/README.md`。

探针未清空用户缓存，不保证冷启动；首组先于同请求复测，改变稳定前缀的负对照仍可能命中
更早的共享工具/身份缓存，不能强求归零。首批 Strata 对照被其他客户端插入影响，保留原始
报告，仅用 verified 批作当前基线。DeepSeek 规则见
[官方上下文缓存文档](https://api-docs.deepseek.com/guides/kv_cache/)，其公共前缀需物化后才可命中且为 best-effort。

真实 Tauri 回归：`su01-provider-strata-local`，独立端口 14657/15769，通过真实工作台
设置→模型列表→连接测试→发送→可见回复，同 turn 两次 HTTP 200；证据
`artifacts/slice-verify/su01-provider-strata-local-tauri-strata/summary.json`，turn
`message_a4c200c1-70f2-4a68-8c7d-cd4c506efea1`。这是产品入口回归，不能冒充缓存修复成功。

后续 checkpoint：Strata 提供在禁止工具调用时保留模板工具前缀的协议支持，再验证请求级
稳定前缀提示；多会话缓存/RAM 检测由 Strata 处理，单独开启 parking 不能修前缀分叉。
通用稳定边界元数据等待首个可实际消费且有证据收益的 adapter 再引入，本批不提前扩张
公共业务接口。Anthropic 显式断点/原生 none live、其他通道凭据与 LM 已加载模型基线继续挂账。
