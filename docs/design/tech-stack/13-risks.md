# 风险登记 + 缓解

> 状态：草案
>
> 目的：把已识别的技术栈风险显式登记，给出每个风险的缓解策略、监控指标、回退条件。这是给"半年后回头看决策"的诚实账本。

---

## 1. 风险概览

| ID | 风险 | 严重度 | 概率 | 缓解状态 |
|---|---|---|---|---|
| R-01 | LLM 实验工具弱于 Python | 中 | 高 | ✅ 隔离方案 |
| R-02 | Elixir 招人困难 | 高 | 高 | ⚠️ 部分缓解 |
| R-03 | BEAM VM 启动延迟（用户感知） | 低 | 中 | ✅ Splash + 暖启动 |
| R-04 | Schema 静态保证不及 sealed/record | 中 | 中 | ✅ 双端 codegen + 契约测试 |
| R-05 | langchain_elixir 跟随主流 LLM 工具滞后 + transport 错误归一化漏网 | 中 | 高 | ⚠️ Provider Gateway 吸收 + 直连 Req fallback（2026-04-26 实测） |
| R-06 | Tauri 2 生产案例较少 | 中 | 低 | ⚠️ 监控生态成熟度 |
| R-07 | OTP 学习曲线超预期 | 高 | 中 | ⚠️ 培训 + 渐进引入 |
| R-08 | 阶段 2 跨节点 process 路由热点 | 中 | 中 | ✅ Consistent hashing 设计 |
| R-09 | 单机 Multi-Agent 资源占用过高 | 中 | 低 | ✅ 监控 + 节流 |
| R-10 | 双端 codegen 漂移 | 高 | 中 | ✅ CI 强制一致 |
| R-11 | Elixir 关键依赖维护活性下降 | 中 | 中 | ⚠️ 持续监控 + 自实现 fallback |

---

## 2. R-01：LLM 实验工具弱于 Python

### 2.1 描述

Python 生态有 DSPy / Instructor / PydanticAI / Marvin / Outlines / LiteLLM / Guidance 等成熟实验工具。Elixir 生态只有 langchain_elixir + instructor_lite + Bumblebee，跟随主流 LLM 工具通常滞后 3-6 个月。

### 2.2 影响

- prompt engineering 实验慢
- 新 LLM 范式（structured output、guided generation）落地慢
- 团队对比新旧 prompt 方案时手段不足

### 2.3 缓解

✅ **`experiments/` 目录隔离**：

- 用 Python + Jupyter 做 prompt 设计、评测、对比
- 输出物是 prompt 模板（YAML/JSON），不是 Python 代码
- 产品代码读取这些模板，**不依赖 Python**

详见 [`12-development.md`](./12-development.md) §8。

### 2.4 监控

- 每月 review 一次：是否有产品差异化功能因 Elixir 工具不足而无法实现
- 跟踪 langchain_elixir / instructor_lite 主仓库 commit 频率
- 追踪 Python 圈的关键新工具，每个工具评估"是否阻塞 Elixir 落地"

### 2.5 回退条件

如果连续 2 个产品迭代周期发现"必须依赖 Python 独有工具才能差异化"，触发栈选型重审：

- 换 Python + asyncio Process Pool（接受 Multi-Agent 表达力下降）
- 或部分模块 Python sidecar（增加架构复杂度）

---

## 3. R-02：Elixir 招人困难

### 3.1 描述

Elixir 招人池显著小于 Python / Java / TypeScript。San Francisco / 北京 / 上海可能能招到，但二线城市基本不可能。

### 3.2 影响

- 团队扩展速度受限
- 新成员入职到 productive 6-12 周
- 技术债务无人接手风险（如果原作者离职）

### 3.3 缓解

⚠️ **部分缓解**：

- **早期用现有团队 + 培训**：6-12 周 Elixir 上手培训计划
- **前端招 React/TS 工程师**：避开 Elixir 招人难（前端代码占总代码 ~40%）
- **资源**：跟 Pragmatic Studio / Dashbit / Elixir Slack / ElixirConf 社区合作
- **内部教程**：基于本项目 OTP 架构最佳实践建立 internal docs
- **结对编程**：新成员与资深 Elixir 工程师结对前 4 周

### 3.4 监控

- 招聘漏斗数据：每月候选人数 / 通过率
- 团队成员 productivity 指标
- 业务受阻是否归因于人力不足

### 3.5 回退条件

栈级回退的"零成本切换窗口"是 Phase 0（参见 [`02-alternatives.md`](./02-alternatives.md) §8）。一旦进入 Phase 1，半年后栈级回退成本极高。所以本风险的回退检查必须**前移**：

| 检查点 | 触发条件 | 处理 |
|---|---|---|
| **Phase 0 末（第 4 周）** | 现有团队成员中无人能独立完成 OTP supervision tree 设计 + 调试，且远程招聘无 Elixir 候选人入库 | 立 ADR 重审栈选型，候选回退到 C# + Orleans 或 Python + asyncio |
| **Phase 1 早期（第 3 个月）** | 团队规模未扩到目标的 50%，且业务进度因人力不足受阻 | 立 ADR 评估部分模块拆服务（用更易招人的栈），但保留 Foundation Multi-Agent 在 Elixir |
| **Phase 1 中期（第 6 个月）** | 团队仍无法扩到目标规模 | 此时栈级回退成本已经极高；可选项缩到"远程招聘扩大池子"或"接受小团队节奏"，**栈级回退基本不可行** |

> **诚实承认**：R-02 在 Phase 1 中期之后实际上是"只能预防、不能回退"的风险。Phase 0 末的检查点是真正的最后防线。

---

## 4. R-03：BEAM VM 启动延迟

### 4.1 描述

Tauri webview <200ms 起，Mix Release sidecar BEAM VM 起 1-2s。用户点击图标到能交互需要 ~2s。

### 4.2 影响

- 用户感知"启动慢"
- 与 Electron / Tauri+Bun 等竞品对比落差

### 4.3 缓解

✅ **已设计缓解方案**：

- **Splash screen 立即显示**：Tauri webview 100ms 内显示 "AI Novel Studio" + loading 动画
- **Sidecar 后台启动**：用户感知不到 sidecar 准备过程
- **Health check + 自动切**：sidecar 就绪后 Tauri 自动切到主界面
- **OS 自动唤醒（macOS launchd / Windows scheduled task）**：维持 warm sidecar，二次启动 < 100ms
- **阶段 2 web 形态此问题完全消失**

### 4.4 监控

- 用户反馈"启动慢"投诉量
- 启动时间分布（p50 / p99）
- BEAM VM cold start 时间

### 4.5 不需要回退

启动延迟是用户可接受的范围（<3s），不构成栈级回退理由。

---

## 5. R-04：Schema 静态保证不及 sealed/record

### 5.1 描述

Java sealed interface + Kotlin sealed class + Rust enum + TS+Zod 在编译期能强制全模式匹配。Elixir Dialyxir 静态分析有限，主要靠运行时 `Ecto.Changeset` 校验 + 测试。

### 5.2 影响

- ADR-0001 14+5 字段的 schema 漂移风险增加
- ADR-0002 状态机的非法转换可能在测试覆盖外漏出

### 5.3 缓解

✅ **多重缓解**：

- **JSON Schema 是 SSOT**：所有 schema 定义在 `docs/design/schemas/*.json`
- **双端 codegen**：Ecto schema + Zod schema 都从 SSOT 生成
- **契约测试**：CI 强制 codegen 输出与代码一致
- **属性测试**（StreamData）：state machine invariant 全模式检查
- **Dialyxir + ex_json_schema**：尽可能多的静态 + 运行时保证
- **代码审查纪律**：sensitive 模块（adoption boundary、authority gate）必须双人评审

详见 [`09-schema-codegen.md`](./09-schema-codegen.md)。

### 5.4 监控

- contract test 覆盖率
- 生产 schema validation error 频率
- Dialyxir warning 数量

### 5.5 回退条件

如果生产 schema 漂移导致用户数据损坏 ≥ 1 次，触发重审：

- 加 type system 工具（如 Gradient）
- 部分关键模块用 Rust NIF 重写（极端情况）
- 极端：换栈到 Kotlin/Java（高代价）

---

## 6. R-05：langchain_elixir 跟随主流 LLM 工具滞后

### 6.1 描述

主流 LLM 新特性（如 Anthropic prompt caching、OpenAI structured output、function calling 升级）通常先在 Python / TS SDK 出现，langchain_elixir 跟随滞后 3-6 个月。

### 6.2 影响

- 新 LLM 特性不能立即采用
- 商业竞争力滞后

### 6.3 缓解

⚠️ **部分缓解**：

- **自封装 Provider Gateway**：[`07-provider.md`](./07-provider.md) 设计上不绑死 langchain_elixir
- **直连 OpenAI/Anthropic API**：用 Req 直接调用，不经 langchain
- **贡献 langchain_elixir**：发现需要的新特性可以提 PR
- **关键特性自实现**：如果某特性 langchain_elixir 半年没跟，自己用 Req 实现

### 6.4 监控

- 主流 provider 新特性发布时间 vs langchain_elixir 跟进时间
- Provider Gateway 中"自实现"特性占比

### 6.5 不需要栈级回退

属于库级问题，不是栈级问题。最差情况是把 langchain_elixir 替换成自实现 Provider Gateway。

### 6.6 2026-04-26 实测发现（追加）

[`verification/structured-output-library-choice.md`](./verification/structured-output-library-choice.md) 实测发现 langchain 0.8.4 的具体短板：

- **transport 级错误未被 `LangChainError` 包装**：当底层是 `Req.TransportError` / `Mint.TransportError`（如 ECONNREFUSED、超时、TLS 失败）时，langchain 会在日志里打印 warning 然后把原异常抛回到调用方。如果 Provider Gateway 不主动拦截，这一类失败会落到 `:exception` / `:unknown`，无法触发上层 retry / circuit breaker 的对应分支。
- **缓解（已落地）**：`Provider.Gateway.normalize_error/1` 必须显式 match `%Req.TransportError{}` 与 `%Mint.TransportError{}`，归一为 `:transport_error`。具体 contract 在 [`07-provider.md`](./07-provider.md) §7 与 §7.1，contract test 必须有一条故意打到不可达端口的用例。
- **不影响 happy path**：spike 二跑实测 normal/free_form/lure_extra 三类输入下，langchain / instructor 0.1 / 直连 Req / instructor_lite 1.2 四路都是 100% schema 命中（n=20 normal 各路径），所以这条只是错误路径的归一化短板，不是稳定性短板。

---

## 7. R-06：Tauri 2 生产案例较少

### 7.1 描述

Tauri 2 在 2024 年 GA，生产案例较 Electron 少。某些边缘场景（自动更新、签名、深度系统集成）可能踩坑。

### 7.2 影响

- 调试难度高于 Electron
- 某些功能要自己 Rust 实现

### 7.3 缓解

⚠️ **部分缓解**：

- **跟踪 Tauri 2 生产案例**：1Password、Mintter、Spacedrive 等
- **保持版本最新**：Tauri 2 修复速度快，跟主版本
- **关键功能 fallback**：如果遇到 Tauri 限制，能切回 Tauri 1.x 或者 Electron（但代价高）

### 7.4 监控

- Tauri 2 GitHub issue 跟踪
- 生产环境踩坑记录

### 7.5 回退条件

如果连续 2 个 Tauri 2 严重 bug 阻塞产品发布，可考虑：

- 临时回退 Tauri 1.x（短期）
- 极端：换 Electron（包体积代价）

---

## 8. R-07：OTP 学习曲线超预期

### 8.1 描述

OTP supervision tree、GenServer state、process linking、Distributed Erlang 是平面学习曲线但深度不浅。新成员可能"会写 GenServer 但不会调试 supervision tree 问题"。

### 8.2 影响

- 团队 productivity 不达预期
- 生产问题排查困难

### 8.3 缓解

⚠️ **部分缓解**：

- **Phase 0 投入培训**：第 1-2 周专门 OTP 培训（"Designing Elixir Systems with OTP"）
- **OTP 模式库**：内部建立常用 OTP 模式 cookbook
- **Pair programming**：高级 + 初级配对解决问题
- **Observer + Phoenix LiveDashboard**：可视化 supervision tree + 进程状态
- **Code review 重点**：supervision strategy / restart strategy 必须双人评审

### 8.4 监控

- Bug 类型分布（OTP-related vs business logic）
- Code review 反复次数

### 8.5 回退条件

如果 6 个月后团队仍无法 productive 在 OTP 模式下工作，触发重审。

---

## 9. R-08：阶段 2 跨节点 process 路由热点

### 9.1 描述

阶段 2 多节点时，如果 workspace 路由不均衡（某些 workspace 流量大），可能造成单节点热点。

### 9.2 影响

- 单节点 OOM
- 跨节点 message 延迟

### 9.3 缓解

✅ **已设计**：

- **Consistent hashing by workspace_id**：详见 [`08-multi-agent.md`](./08-multi-agent.md) §10.2
- **Sticky session**：load balancer 按 workspace_id 路由
- **大 workspace 分片**：极端热点时 workspace 内部按 author_id 二次路由

### 9.4 监控

- 各节点 active workspace 数
- 各节点 RPS / 内存使用率
- 跨节点 message 延迟

### 9.5 处理

阶段 2 触发后实时调优，不会回退到阶段 1。

---

## 10. R-09：单机 Multi-Agent 资源占用过高

### 10.1 描述

阶段 1 单机长期运行，多个 Agent 同时 alive，可能内存占用 / CPU 持续偏高。

### 10.2 影响

- 用户感知应用"重"
- 与单机轻量预期相悖

### 10.3 缓解

✅ **多重设计**：

- **Idle Agent 节流**：非活跃 Agent 进入 hibernate 状态，内存占用最小
- **Authority + Budget**：每个 Agent 有 budget 上限，避免失控
- **OTP message queue 监控**：mailbox 过大触发警告
- **用户可控**：用户菜单 → 暂停所有后台 Agent（节能模式）

### 10.4 监控

- BEAM VM 内存使用
- 每 Agent 内存占用 + mailbox 长度
- CPU usage 趋势

### 10.5 不需要回退

属于实施层面调优，不影响栈选型。

---

## 11. R-10：双端 codegen 漂移

### 11.1 描述

Elixir Ecto schema + Frontend Zod schema 都从 JSON Schema codegen。如果 codegen 工具有 bug 或开发者绕过 codegen 直接改输出，会漂移。

### 11.2 影响

- 前后端 schema 不一致
- 生产环境出现"前端发字段，后端拒绝"等错误

### 11.3 缓解

✅ **CI 强制**：

- **CI step**：每次 push 自动 re-run codegen，比较输出与 git 中文件
- **不一致 = CI 失败**
- **Pre-commit hook**：本地也跑一次 codegen 一致性检查
- **`AUTO-GENERATED` 头部声明**：每个 codegen 文件顶部明确标注，提醒不要手改

详见 [`09-schema-codegen.md`](./09-schema-codegen.md) §6-§7。

### 11.4 监控

- CI 失败率
- 手改 codegen 输出的 PR 数（应该为 0）

### 11.5 回退条件

不需要回退；这是工程纪律问题，不是栈问题。

---

## 11a. R-11：Elixir 关键依赖维护活性下降

### 11a.1 描述

技术栈推荐了若干 Elixir 库，其中部分维护活性已下降：

| 库 | 版本 | 最近活跃 | 风险点 | 实测状态 |
|---|---|---|---|---|
| `swarm`（已移出主依赖） | 3.4 | 2019 起无主版本更新 | 原跨节点 process registry 候选，已改用 Horde | — |
| `paper_trail` | 1.1.2 | 2024-08-30 后无正式 release；2025-2026 主要是 bot / dependabot 活动 | revision audit 关键路径（替代 Hibernate Envers）| ✅ 当前栈通过（2026-04-26）：双库 8/8 断言全过，Multi rollback 不留孤立 version。风险从阻塞项降为监控项，但不能删除。详见 [`verification/paper-trail-ecto-compatibility.md`](./verification/paper-trail-ecto-compatibility.md)。 |
| ~~`instructor` (instructor_ex)~~ → `instructor_lite` | ~~0.1.0~~ → 1.2.0 | 2025-06 起 5 次 1.x release（最新 2026-02-01），活跃维护；但维护者集中度高、生态较小 | 结构化输出主依赖（intent slot / artifact / card payload）| ✅ 通过（2026-04-26 二跑实测，含 `instructor_lite` 1.2 补评）：四路径全部 normal 20/20，决策切换为 D 主 + A 副 + C fallback，`instructor_ex` 0.1.0 退场。详见 [`verification/structured-output-library-choice.md`](./verification/structured-output-library-choice.md) §7。 |
| `ex_machina` | 2.7 | 维护趋缓 | 测试 fixture 工厂，非关键但渗透测试代码 | — |
| `fuse` | 2.x | 维护稀疏 | circuit breaker（[`07-provider.md`](./07-provider.md) §9）| — |

### 11a.2 影响

- 依赖出现 bug 时无社区修复
- Elixir / OTP 升级时可能不兼容
- 安全漏洞响应慢

### 11a.3 缓解

⚠️ **替代方案 + 抽象层**：

- **默认采用 Horde**：Horde 是当前社区主流的跨节点 process registry，活跃维护中；不再把 Swarm 放入主依赖清单
- **`paper_trail`**：当前栈已实测可用（详见 [`verification/paper-trail-ecto-compatibility.md`](./verification/paper-trail-ecto-compatibility.md)），但 upstream 维护活性仍弱；保留自封装 audit log fallback，Ecto / Elixir / OTP 升级时必须复跑 spike。
- **`instructor_lite`**：业务代码经 `Provider.Gateway` 中转，不直接 `import` InstructorLite；切换到 langchain 结构化输出 / 直连 Req / 历史 `instructor` 0.1.0 的成本约 3-5 天（spike 已验证四条等价路径，函数签名差异在 Provider Gateway 内部消化）。维护者集中度高是可接受但必须监控的 bus-factor 风险；如上游停滞，优先 fork 小库或退回 Gateway 直连 Req。
- **Streaming structured output**：`instructor_lite` 不把 streaming 作为一等目标。Phase 0/1 默认采用 non-streaming finalize 生成结构化对象，再用 Phoenix Channel 流式推送进度/文本；如果后续必须做“流式结构化字段填充”，改走 Provider Gateway 直连 Req + SSE 增量解析，或重新评估 `langchain`/legacy `instructor` streaming 路径。
- **`ex_machina` → 自实现 fixture helpers**：测试工厂模式不复杂，自实现避免依赖
- **`fuse` → 自实现 circuit breaker**：基于 ETS counter + GenServer，~100 行代码

### 11a.4 监控

- 季度复查：每个关键依赖的最近 commit 时间 + 未解决 issue 数 + 维护者集中度（bus factor）
- 关注 ElixirForum / Elixir Slack 是否有"X 库已死，迁到 Y"的社区共识
- 跟踪 Hex.pm 的 weekly downloads 趋势（断崖式下降是死亡信号）

### 11a.5 回退条件

任一关键依赖（`paper_trail` / `horde` / `instructor_lite`）出现以下情况，触发立项替换：

- 公开 CVE 超过 30 天未修复
- 与 Elixir 1.19+ / OTP 28+ 不兼容
- 出现明确的 fork 接管或社区迁移共识
- `instructor_lite` 连续 2 个季度无维护响应，且项目出现 provider / schema 兼容性 bug
- 产品需求要求 streaming structured output，且 Gateway 直连 Req + SSE fallback 无法满足

不是栈级风险，是库级风险。

### 11a.6 实测复跑入口

每次 Elixir / Ecto / paper_trail / langchain / instructor_lite major 升级后，都应至少复跑一次：

```bash
cd spikes/v2_verification
mix deps.update --all
SPIKE_DB=sqlite   mix run -e 'V2Verification.Spike.PaperTrail.run(:sqlite)'
SPIKE_DB=postgres mix run -e 'V2Verification.Spike.PaperTrail.run(:postgres)'
SPIKE_DB=sqlite   mix run -e 'V2Verification.Spike.StructuredOutput.run()'
```

任何一条断言降级到 ⚠️ 或 ❌ 都要立 ADR。

---

## 12. 风险登记纪律

- 新发现风险：在本文档加新行，分配 ID
- 缓解状态变化：✅ → ⚠️ → ❌（恶化时）
- 月度 review：风险登记表是 Phase 0 + 阶段 1 月度团队会议必看项
- 回退触发：任何风险触发回退条件，必须立 ADR + 召开决策会议

---

## 13. 当前 TBD

- 具体培训计划（OTP 培训内容、时长、考核）
- Tauri 2 生产案例对比（持续跟踪 + 整理）
- Schema codegen 漂移检测的 false positive 排除策略
- Risk score 量化（严重度 × 概率 = 优先级）
- 风险升级机制（达到什么阈值触发升级到决策层）

以上 TBD 在 Phase 0 中期处理。
