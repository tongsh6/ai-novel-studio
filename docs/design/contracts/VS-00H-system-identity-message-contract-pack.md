# VS-00H System Identity Message Contract Pack（系统身份消息契约）

> 状态：Frozen（2026-10-21，T7 CP1–CP3 已实现）。本文把 `VS-00D` §4.4 已写入契约、但从未落地的 `SYSTEM / DEVELOPER` 块具体化为可实现、可验证的契约。后续变更仍须经 `tasks/slices/UA01-agentic-loop-prompt-hardening.md` T7 与本文评审。
>
> 角色：定义"每一次 provider 推理调用，模型首先看到的那条固定消息"——内容真源、注入点、provider 渲染、trace 留痕、不变量与分期。它是 `VS-00D` 三层信封之前的**第 0 层**，也是 `notes/2026-07-22-prompt-as-function-of-state.md` §2.1 "模型口径文案库"的第一条、"六段骨架"第①段之前的产品前提。
>
> 上游：`VS-00D` §4.4（SYSTEM 块存在性）、`foundation/08-provider-abstraction.md` §6（provider-neutral message role）、`docs/design/README.md` v3 原则 3/4/7。

---

## 1. 核心问题

### 1.1 现状（2026-10-21 代码核查）

| 事实 | 证据 |
|---|---|
| 全仓库没有任何一处发送 `role: "system"` 消息 | `apps/**/*.ex` grep `role: "system"` 为零 |
| 产品身份由各调用点在 user message 开头自述，至少 18 处，措辞至少 3 种 | `judgment_protocol.ex` ×4 "小说创作系统的创作判断器"；`agentic_plan_draft_planner.ex` ×4 "小说创作系统的 AgentRun 计划起草器/修订器"；`chapter_mission_service.ex` ×2 "长篇小说写作台的写前/规划前推理器"；`planner.ex` "一个小说创作 AI"；`creative_provider/real.ex` ×7、`prose_quality_evaluator.ex`、`chapter_summary_generator.ex`、`fact_inventory_service.ex` 各类"助手" |
| `VS-00D` §4.4 已规定 `SYSTEM / DEVELOPER` 块（"你是 AI Novel Studio 的创作协作模型……不得批准执行、写入或采纳"） | 该块在 `AIMessageEnvelope` 过渡实现（AU11 质量诊断 checkpoint）中也未渲染 |
| Anthropic adapter 已写好"把 system 消息抽到顶层 `system` 字段"的转换，但上游无人产出 system 消息 | `provider/anthropic.ex` `anthropic_messages/1` |
| `system_prompt` 已被 `trace_writer` / `provider_run_log` / `trace_redactor` / `ProviderEvent` 列为敏感键 | 四处 `@unsafe_keys` / `sensitive_payload_key?` 名单 |
| `Usage` 不记录缓存命中 | `provider/usage.ex` 仅 `input_tokens / output_tokens / model / latency_ms`；`08` §9.1 已定义 `cached_tokens` 字段 |
| `judgment_protocol.ex` 有 6 处 `update_in(prompt, [:messages], fn [message \| rest] -> ...)`，默认首条消息即 user 任务消息 | 重试提示追加路径 |

### 1.2 问题陈述

```text
产品身份（这是什么 app、服务谁、底线是什么）是产品层事实，
却由 18 个调用点各自描述、彼此不一致，且没有一处是真正的 system 消息。
```

后果：

1. 产品底线（"产出皆待确认材料，未经作者采纳不是作品事实"）在多处重复书写、措辞漂移，改一处漏一处。
2. 模型在不同调用里被告知自己属于"小说创作系统 / 长篇小说写作台 / 一个小说创作 AI"，没有稳定的产品自我认知。
3. provider 协议里专为此设计的 `system` role 闲置；trace 的 `system_prompt` 位永远为空。
4. 请求没有任何稳定前缀，provider 侧 prompt cache 没有可命中的地基（见 §7）。

### 1.3 不是什么

- 不是"写一段更好的话术"。本文只定**身份层**的契约；各调用点的角色分工、任务指令、输出格式仍归各调用点与 `VS-00D` 三层信封。
- 不是系统约束的执行机制。v3 原则 4 "系统约束不藏进 prompt"：采纳边界由 `ADR-0010` / `ADR-0019` 与代码强制；身份消息只是把这一事实**告知**模型，不是靠它拦截。
- 不是作者可见叙事。身份文本永不进入 UI、TurnResult、作者可见 trace（§5 I-SYS-3），因此与 `ADR-0022` N-NARR 无冲突。

---

## 2. SystemIdentityMessage 契约

### 2.1 逻辑结构

```text
SystemIdentityMessage
  role              : "system"
  content           : text            -- 唯一真源，见 §2.2
  identity_version  : string          -- 文本变更即递增（如 "sys-identity-v1"）
  content_hash      : string          -- content 的稳定哈希，供 trace 引用
```

`identity_version` 与 `content_hash` 不暴露给模型，只进 trace / ProviderRun 事实（§4）。

### 2.2 内容真源与构成规则

身份文本有且只有一个代码真源（候选模块名 `NovelAgent.Provider.SystemIdentity`；模块结构按 `08` §23 不在本文冻结）。文本**只允许**包含随任务不变的产品事实：

| 必含 | 依据 |
|---|---|
| 产品是什么：AI Novel Studio，长篇小说创作工作台 | `00` 产品定位 |
| 服务谁、谁裁决：作者；执行、写入、采纳由作者与系统裁决，模型不批准 | `VS-00D` §3 分权、§4.4 SYSTEM 块 |
| 产出地位：模型产出的一切都是待确认材料，未经作者采纳不构成作品事实 | `ADR-0010` / `ADR-0019`；v3 原则 7 |
| 事实来源纪律：当前作品事实只来自后续消息给出的材料；材料缺失时如实说明，不编造 | `VS-00D` §4.4、§4.5 MissingPolicy；README 原则 13 缺口诚实律 |
| 角色与任务由后续消息给出 | 为 `VS-00D` 三层与各调用点的角色句留位 |

| 禁含 | 原因 |
|---|---|
| 输出格式要求（JSON / 自然语言 / 不要 markdown / 不要代码块） | 调用点之间互斥：判断 call1 要自然语言，writer 要 JSON |
| 输出语言要求 | 部分结构化输出字段为英文枚举；语言要求归调用点 |
| 具体角色名（判断器 / 起草器 / 评审器 / 写作助手） | 角色随调用变化，是六段骨架第①段，不是身份层 |
| 任何作品级或轮级内容 | 破坏前缀稳定性（§7），且违反 `VS-00D` "三层不得混成一段" |
| 可被模型复述为作者可见文本的措辞（产品状态词、内部机器名） | 防止泄漏进 artifact（`B9` 元泄漏先例） |

v1 草案（约 120 字，供评审，不在本文冻结字节）：

```text
你在 AI Novel Studio 中工作，这是一个长篇小说创作工作台，服务于正在创作的作者。
作者是唯一裁决者：执行、写入、采纳都由作者与系统决定，你不批准任何一项。
你产出的一切都是待确认材料，未经作者采纳不构成作品事实。
当前作品的事实只来自后续消息给出的材料；材料缺失时如实说明，不要编造。
你本次承担的角色与任务由后续消息给出。
```

### 2.3 与 `VS-00D` §4.4 SYSTEM 块的关系

`VS-00D` §4.4 列出的四行中，"必须按 NovelLayer / WorkState / TurnGuidance 三层判断"一行**暂不进入** v1 身份文本：当前多数调用点并未显式暴露三层结构（`VS-00D` §6 G7 未闭环），写进去是向模型声明一个它看不到的结构。待 G7 信封统一后，由 `VS-00D` 决定是否升版身份文本加入该行。其余三行语义已被 §2.2 必含项覆盖。

---

## 3. 注入契约

### 3.1 注入点：Provider Gateway，且只在这里

```text
调用点（novel_application / novel_agent 各 prompt 构造处）
  → 产出 prompt：角色句 + 任务 + 上下文（不含身份层）
NovelAgent.Provider.Gateway.execute/4
  → 在分发到 adapter 之前 prepend SystemIdentityMessage      ← 唯一注入点
各 adapter（OpenAI 兼容系 / Anthropic / Stub / 未来厂商）
  → 把 role: "system" 渲染为自家协议
```

选择 gateway 而非 application 层或各调用点，理由：

1. **唯一咽喉**：所有 provider（含 Stub）与所有调用点（含 `novel_agent` 内部的 `creative_provider/real.ex`、`prose_quality_evaluator.ex`）都经过它；`novel_agent` 不能反向依赖 `novel_application`，注入点只能在 `novel_agent`。
2. **不破坏既有首消息假设**：`judgment_protocol.ex` 6 处 `[message | rest]` 在 application 层运行完毕之后 gateway 才注入，重试提示仍追加到正确的 user 消息。
3. **trace 诚实**：gateway 记录的 ProviderRun 事实就是真实发出的请求形态。

### 3.2 注入规则

| 规则 | 说明 |
|---|---|
| 位置 | `messages[0]`；若 prompt 已含调用点自带的 system 消息，身份消息仍在其前，不合并、不替换 |
| 幂等 | 同一 prompt 经 gateway 两次不得产生两条身份消息；识别依据为消息 metadata 标记（不靠 content 前缀字符串匹配） |
| 适用面 | 所有经 `Gateway.execute/4` 的推理请求（含 stream、tool call、Stub）；`list_models`、连通性探测等非推理调用不经该入口，不受影响 |
| 不设 opt-out | 不提供"跳过身份"开关，直到出现真实消费者需要并登记；此前任何绕过都视为契约违反 |
| 不改调用点 | CP1 不修改任何既有 prompt 文本（§8） |

### 3.3 Adapter 渲染责任（`08` §6.4 的具体化）

| Adapter | `role: "system"` 渲染 | 现状 |
|---|---|---|
| OpenAI 兼容系（OpenAI / DeepSeek / Kimi / MiniMax / 智谱 / Gemini-compat / LM Studio） | 原样置于 `messages` 数组首位 | `normalize_messages/1` 已透传，预计零改动 |
| Anthropic | 抽到顶层 `system` 字段 | `anthropic_messages/1` 已实现 |
| Stub | 接受并忽略或记录；不得因首条消息非 user 而改变匹配行为 | 需核验 |
| 未来厂商 | 必须在 adapter 内完成 role 映射；不得要求上游为其改变 message 形态 | `08` §6.4 |

---

## 4. Trace 与留痕契约

`system_prompt` 是既定敏感键（§1.1），因此：

1. **不落原文**：ProviderRun / trace / activity API 不存储、不返回身份文本。
2. **落引用**：每次 ProviderRun 事实携带 `system_identity_ref = {identity_version, content_hash}`，优先复用既有 metadata / usage 载体，不为此新增持久化列；若 CP1 发现既有载体无法承载，先登记再评估。
3. **可回答**：对任意历史调用，trace 能回答"当时生效的是哪一版身份"，满足 `08` §17.3 explainability 与 `VS-00D` §4.6 TraceRequirements 第 1 条。
4. **开发者可见、作者不可见**：引用可出现在 developer 视图的 provider_progress / activity API；不进入作者可见 TurnResult、卡片、叙事。

---

## 5. 不变量

| ID | 不变量 | 机器可验 |
|---|---|---|
| I-SYS-1 | 任何经 gateway 的推理请求，最终 messages 首条为且仅为一条 SystemIdentityMessage | gateway 单测 + Stub 捕获请求帧断言 |
| I-SYS-2 | 身份文本只有一个代码真源；任何调用点 prompt 不得再自述产品身份 | CP2 后以静态检查守卫（候选：对 `apps/**/lib` 扫描"你是.*（小说创作系统\|长篇小说写作台\|小说创作 AI）"类产品自称；具体 pattern 在 CP2 登记） |
| I-SYS-3 | 身份文本不出现在作者可见 UI、TurnResult、author-safe trace payload | 既有 `system_prompt` 敏感键机制 + activity API 测试 |
| I-SYS-4 | 身份文本不含输出格式 / 语言指令 | 评审项（文本变更须经 PR 审核对照 §2.2 禁含表） |

与既有不变量关系：I1 / I2 / I3 / N-NARR / N-PLAN 均作用于响应侧或 artifact 侧，不受请求侧新增 system 消息影响；但按项目规则，CP1 完成后仍须复跑三条 scenario invariants。

---

## 6. 边界（七问）

| 问 | 答 |
|---|---|
| Contract | 本文；`VS-00D` §4.4 SYSTEM 块；`08` §6.2 role / §6.4 adapter 责任 / §9.1 `cached_tokens` / §17 trace |
| Invariant | I-SYS-1 ～ I-SYS-4（§5） |
| Boundary | CP1 只改 `novel_agent`（gateway、新身份模块、必要时 `Usage`）；`novel_application` CP1 不动、CP2 仅删改各调用点文本；`novel_web` / `frontend` / `novel_persistence` schema 全程不动（§4 第 2 条） |
| Consumer | 全部 provider 推理调用；ProviderRun trace / developer activity 视图的 `system_identity_ref`；CP3 后 `Usage.cached_tokens` 的开发者可见面 |
| Proof | gateway focused tests（I-SYS-1 / 幂等 / Stub 兼容）；全量 `mix test`；复跑一条既有 `scripts/slice_verify.sh` 对话场景，以 Stub 捕获帧或 developer activity API 中的 `system_identity_ref` 作为外部证据；I1 / I2 / I3 复跑 |
| Acceptance Driver | 既有 slice_verify / tauri_slice_verify 对话场景，不新建；证据为网络帧 / ProviderRun 事实，作者侧 UI 无变化属预期。产品代码零验收感知（无 env / query / testid） |
| Exploration | 不适用：本 slice 不物化任何小说要素 |

---

## 7. 缓存：顺带打开的门，不是设计动机

固定前缀是 provider prompt cache 的**必要非充分**条件。本文只做两件事，其余归 `UA01` T6 "prompt 静态段前置"：

1. **让收益可测**：`Usage` 增加 `cached_tokens`（`08` §9.1 已定义），由各 adapter 从厂商响应映射（OpenAI 系 `prompt_tokens_details.cached_tokens`、Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens`、DeepSeek `prompt_cache_hit_tokens`；未核实厂商置空），并进入 ProviderRun 事实与开发者视图。没有这一步，任何 prompt 结构调整都无法证明缓存收益。
2. **不让缓存反过来驱动 prompt 顺序**：`notes/2026-07-22` 六段骨架把作者原文置于第②段、约束块靠近决策点，是为模型行为质量设计的；静态段前移只能在不损害它的前提下进行。

已知门槛与机制差异（供 T6 决策，不在本文冻结）：Anthropic 需显式 `cache_control` 且 ≥1024 token；OpenAI 自动、≥1024 token；DeepSeek 自动、64 token 块；Kimi 为独立 context cache API；Gemini 经 OpenAI 兼容层的隐式缓存是否生效待验证；LM Studio 受益于 llama.cpp KV 前缀复用。单独一段百字身份不足以触发多数厂商缓存，收益来自身份 + 角色规则 + 工具定义 + 作品级稳定上下文共同构成的前缀。近在眼前的可验证场景：`judgment_protocol` call1 / call2 连续两次调用共享 goal / deviation / tools，只有尾部指令不同。

> 2026-10-21 追记：身份之后的排序契约已独立为 `VS-00I-prompt-prefix-stability-contract-pack.md`（五层稳定度模型、调用对工具集恒定、逐调用点映射、Anthropic 断点、前缀共享度量）。本节只保留"缓存不是身份层的设计动机"这一立场。

---

## 8. 分期

| CP | 范围 | Proof | 不做 |
|---|---|---|---|
| CP0 | 本文 + `VS-00D` / `08` / notes 指针 + `UA01` T7 登记 | 文档可达链完整（contracts README → 本文；VS-00D §4.4 → 本文） | 任何代码 |
| CP1 | 身份模块（文本 + version + hash）；gateway 注入 + 幂等；`system_identity_ref` 进 ProviderRun 事实；gateway focused tests；Stub 兼容核验；全量 `mix test`；一条既有 slice_verify 场景复跑；I1/I2/I3 | I-SYS-1 / I-SYS-3 成立；既有测试爆点全部显式处理（断言 messages 长度 / 首条内容的测试需同步更新，不得静默放宽） | 不改 18 处调用点文本；不做 opt-out；不做缓存 |
| CP2 | 18 处调用点去产品自称：`你是小说创作系统的创作判断器` → `本次你承担创作判断器的角色`，删除"小说创作系统 / 长篇小说写作台 / 一个小说创作 AI"；I-SYS-2 静态守卫落地；既有 MBC 探针复跑对照 | 探针 pass_rate 不退化；I-SYS-2 守卫绿 | 不做角色枚举（无消费者，YAGNI；notes "不为体系化而重写"） |
| CP3 | `Usage.cached_tokens` + adapter 映射 + ProviderRun / 开发者视图可见；Anthropic `cache_control` 标记；judgment call1/call2 前缀共享实测 | 开发者视图可见命中数；call2 命中 call1 前缀有数据 | 不调整任何 prompt 内部段落顺序（归 `UA01` T6） |

CP1 是最小承重步：它已经穿过 调用点 → gateway → adapter → provider → ProviderRun trace 的真实链路，有真实消费者（trace / developer 视图），可由外部脚本证明。CP2 / CP3 是其后果，不是可选项；未做前本 slice 不得标 done。

---

## 9. 风险与处置

| 风险 | 处置 |
|---|---|
| 既有测试断言 messages 精确结构 | CP1 全量 `mix test` 暴露，逐条显式更新；这是可见破坏，优于静默污染 |
| Stub 若按首条消息匹配 | CP1 核验；若是，改 Stub 匹配 user 消息，不改注入规则 |
| 身份文本与调用点"你是 X 助手"短期并存（CP1→CP2 之间） | v1 文本末句"角色与任务由后续消息给出"显式让位；CP2 收口 |
| 每次调用 +100～200 token | 接受；CP3 可测后再评估是否值得压缩 |
| 身份文本被模型复述进 artifact | §2.2 禁含项 + 既有 `B9` 元泄漏采纳门兜底 |
| 本地小模型对 system role 支持弱 | LM Studio 走 OpenAI 兼容 `messages`，多数 chat template 支持 system；若某模型忽略，属该模型能力问题，不为其改契约 |

---

## 10. 与现有文档关系

- `VS-00D` §4.4：SYSTEM 块的存在性归它；内容真源、注入、渲染、留痕归本文。本文为其展开，不另立三层之外的"第四层"概念——身份层是三层之前的产品前提。
- `foundation/08-provider-abstraction.md`：§6.2 `system` role、§6.4 adapter 渲染责任、§9.1 `cached_tokens`、§17 trace、§18 安全边界——本文是这些既定条款在"身份消息"上的具体化。
- `notes/2026-07-22-prompt-as-function-of-state.md` §2.1：身份层 = 模型口径文案库第一条、六段骨架第①段之前的前提；"目录先立、不为体系化而重写"的迁移纪律在本文 CP2 沿用。
- `tasks/slices/UA01-agentic-loop-prompt-hardening.md`：T7 为本文承重入口；T6 "prompt 静态段前置（KV cache 友好）"依赖本文 CP1 / CP3。
- `ADR-0010` / `ADR-0019`：身份文本中的"待确认材料"陈述是对这两项决策的告知，不是替代其代码强制。
- `ADR-0022` N-NARR：身份文本非作者可见叙事，不在 N-NARR 作用域；但 I-SYS-3 保证它永不混入作者可见字节。
- `ui/47-ui-copy-guidelines.md`：身份文本是模型侧口径，不是用户可见文案，不进 `copy.ts`；归 notes §2.1 所述"文案三层之外的第四层"。

---

## 11. 实现证据（2026-10-21）

| CP | 状态 | 落地 | 证据 |
|---|---|---|---|
| CP1 | done | `NovelAgent.Provider.SystemIdentity`（文本/version/hash/message/inject/identity_message?）；`Gateway.execute/4` 唯一注入；`AdapterExecution.provider_run!` metadata 落 `system_identity_ref`；Stub / SliceVerify 只忽略身份文本、保留其它 system 消息 | `apps/novel_agent/test/novel_agent/provider/system_identity_test.exs`；`gateway_test.exs` 的 I-SYS-1/幂等/共享前缀/ProviderRun ref；全量 `mix test` 1570/0；`bash scripts/slice_verify.sh au02-candidate-continuation` PASS；测试库 `provider_runs.metadata` 实测 `{"system_identity_ref":{"version":"sys-identity-v1","content_hash":"064a…4252d"}}`；I1/I2/I3 全绿 |
| CP2 | done | 18 处调用点改为“本次你承担…的角色”，删除“小说创作系统 / 长篇小说写作台 / 一个小说创作 AI”自称；I-SYS-2 静态守卫随 `mix test` 执行 | 8 个 lib 文件替换；`system_identity_guard_test.exs` 绿；MBC stub `pass_rate=1.0` |
| CP3 | done / live cache 未测 | `Usage.cached_tokens`（OpenAI `prompt_tokens_details.cached_tokens`、DeepSeek `prompt_cache_hit_tokens`、Anthropic `cache_read_input_tokens`）；ProviderEvent/Output/developer activity 透传；Anthropic 长 system 块加 `cache_control: ephemeral`；连续两次 Gateway 调用共享同一身份前缀 | `usage_test.exs`；`anthropic_test.exs` cache_control case；`provider_activity_service_test.exs` `cached_tokens=7`；`gateway_test.exs` 共享前缀 case。**诚实边界**：真实 vendor cache hit（Anthropic/OpenAI/DeepSeek 线上命中数）未测，需 live 凭据；本 CP 只证明“可测字段 + 标记 + 共享前缀”已就位 |

### 11.1 明确未做 / 后续

- 真实 vendor prompt cache 命中率矩阵（需 live 凭据与 ≥1024 token 前缀；本地 LM Studio 的 KV 前缀复用也未做真实命中测量）。
- CP2 的 live MBC 探针（本轮只跑 stub；live 需模型运行且不作为结构门禁）。
- `system_identity_ref` 在开发者 UI 的显式展示（当前已进 ProviderRun metadata / activity usage 数据，UI 可后续消费）。
- 身份文本 v2 / 三层结构行：等 VS-00D G7 信封统一后再评估。
