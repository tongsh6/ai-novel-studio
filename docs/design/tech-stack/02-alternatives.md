# 候选集与透明剔除

> 状态：草案
>
> 目的：把所有评估过的技术栈候选与剔除理由记录下来，让外部读者能完整重现决策推理，避免决策黑箱。本文不替代 [`01-decision-rationale.md`](./01-decision-rationale.md) 的"为什么是 Elixir"，而是回答"别的为什么不行"。

---

## 1. 完整候选集（18 个）

按"理论上能做这个项目后端"枚举，**不预过滤**：

| # | 候选 | 一句话定位 |
|---|---|---|
| 1 | Python 3.12+ | LLM 生态金牌，v1 沿用 |
| 2 | TypeScript (Node/Bun/Deno) | 全栈一致性，schema 工具链好 |
| 3 | Java 21+ | sealed/record + Loom + Spring AI |
| 4 | Kotlin (JVM) | Java 优势 + 现代语法 + 协程早熟 |
| 5 | C# / .NET 9 | record + Semantic Kernel + 内置 OTel |
| 6 | Go | 部署单二进制，goroutine 简单 |
| 7 | Rust | 类型 + 性能顶配 |
| 8 | Elixir (BEAM/OTP) | actor model + supervision tree |
| 9 | Scala 3 | ADT/typeclass 表达力顶配 |
| 10 | Clojure | REPL 驱动开发 + JVM 互通 |
| 11 | F# (.NET) | 函数式 + .NET 互通 |
| 12 | Ruby | Rails 生态 |
| 13 | PHP 8.3+ | Laravel 生态 |
| 14 | Swift (server-side) | Apple 阵营 |
| 15 | Crystal | "像 Ruby 但编译" |
| 16 | Nim | "像 Python 但编译" |
| 17 | Zig | 系统编程 |
| 18 | OCaml / ReScript | 函数式 + 类型 |

---

## 2. 第一轮剔除：11 个候选

### Tier 4：边缘候选（一句话剔除）

| # | 候选 | 剔除理由 |
|---|---|---|
| 12 | Ruby | LLM 生态薄；ADR-0001 sealed hierarchy 表达力弱（无原生 sum type）|
| 13 | PHP 8.3 | 长跑 / 异步 / 状态机模型与本项目契合度差；LLM 生态边缘 |
| 14 | Swift server | 生态主要在 Apple 平台；server-side 社区小 |
| 15 | Crystal | 社区规模 + LLM 生态都不足；语言活跃度风险 |
| 16 | Nim | 同 Crystal，社区更小 |
| 17 | Zig | 系统语言，定位错配 |
| 18 | OCaml/ReScript | 类型表达力够，但 LLM 生态几乎为零；招人极难 |

### Tier 3：架构活跃但有显著短板

| # | 候选 | 剔除理由 |
|---|---|---|
| 9 | Scala 3 | ADT/sealed 表达力顶配但**复杂度成本高**，团队学习曲线 + Java 互操作的复杂度 |
| 10 | Clojure | REPL 实验体感很好但 ADR-0001 14+5 字段静态保证弱（动态类型）；招人困难 |
| 11 | F# (.NET) | ADT/sum type 表达力顶配但社区比 C# 小一个数量级；Semantic Kernel 主语言是 C# |
| 6 | Go | **核心硬伤：无 sum type，没有 sealed hierarchy**。ADR-0001 14+5 字段 + ADR-0002 状态机用 Go 写要堆大量样板 |
| 7 | Rust | sum type 表达力顶配 + 性能强，**但 schema 演化期开发速度跟不上**。14 个 ADR 还在迭代 |

**剔除小结**：18 → 7（保留 Python / TS / Java / Kotlin / C# / Elixir + Rust 作为"后期可拆"备注）

---

## 3. Short-list：5 + 1

**5 个主流候选**：Python / Java / Kotlin / C# / TypeScript  
**1 个 dark horse**：Elixir（架构契合度异常高）

详细 10 维对比矩阵见本目录 §4。

---

## 4. 短名单 10 维深度对比

每行一个评估维度，每列一个候选。文字描述胜负，不假装数字精度。

### 4.1 Schema 表达力（ADR-0001 + ADR-0002）

| 候选 | 评估 |
|---|---|
| Python | Pydantic v2 + `Literal` + discriminated union 够用，**运行时校验**，IDE 推断中等 |
| Java 21 | `record` + `sealed interface` + pattern matching，**编译期穷尽性检查** |
| Kotlin | `data class` + `sealed class` + `when` 表达式，比 Java 更紧凑 |
| C# 9 | `record` + pattern matching，**discriminated union 还是 preview** |
| TypeScript | Zod / Effect Schema 顶配，**编译期 + 运行时双重** |
| Elixir | 动态类型，Dialyxir 静态分析有限 |

**胜方**：Kotlin ≈ Java ≈ TypeScript（Zod 派系）；Python / C# 居中；Elixir 弱

### 4.2 LLM Provider 生态

| 候选 | 评估 |
|---|---|
| Python | openai / anthropic / litellm / instructor / DSPy / PydanticAI，**金牌且实验工具最多** |
| Java | **Spring AI 1.0 GA** + LangChain4j 完整 |
| Kotlin | 全套 Spring AI / LangChain4j 可用 |
| C# | **Semantic Kernel 1.0+** + AutoGen.NET |
| TypeScript | **Vercel AI SDK** + Mastra + LangChain.js |
| Elixir | langchain_elixir + instructor_ex + Bumblebee，**够用但是二线** |

**胜方**：Python 实验速度领先；其他几个 production-grade 持平；Elixir 弱

### 4.3 长跑 / 多 Agent / 一致性

| 候选 | 评估 |
|---|---|
| Python | asyncio + multiprocessing 够用，但要自拼骨架 |
| Java 21+ | **Virtual Threads (Loom) + StructuredTaskScope** |
| Kotlin | **协程 + structured concurrency**（比 Loom 早成熟 5 年）|
| C# | async/await + Channels + TaskScheduler |
| TypeScript | 单线程事件循环，**多核要 Worker / Cluster** |
| Elixir | **OTP supervision tree + GenServer + Process 隔离** |

**胜方**：**Elixir > Kotlin > Java > C# > Python > TypeScript**

### 4.4 持久化纪律

| 候选 | 评估 |
|---|---|
| Python | SQLAlchemy 2 + Alembic |
| Java | **JPA + Hibernate Envers** + Flyway/Liquibase |
| Kotlin | 同 Java + Exposed |
| C# | **EF Core + EFCore.Temporal** + FluentMigrator |
| TypeScript | Prisma / Drizzle |
| Elixir | Ecto + paper_trail |

**胜方**：Java/Kotlin（Envers）；其他居中

### 4.5 Event Bus

| 候选 | 评估 |
|---|---|
| Python | 进程内 asyncio Queue + 外部 broker 客户端 |
| Java | **Spring `ApplicationEventPublisher` + Kafka/NATS 一等集成** |
| Kotlin | 同 Java |
| C# | **MediatR / MassTransit** |
| TypeScript | 自拼或 EventEmitter |
| Elixir | **`Phoenix.PubSub` + `GenStage` + `Broadway`** |

**胜方**：**Elixir > Java/Kotlin/C# > Python/TS**

### 4.6 Observability

| 候选 | 评估 |
|---|---|
| Python | opentelemetry-python 中等成熟 |
| Java | **OTel-java auto-instrumentation 顶配** |
| Kotlin | 同 Java |
| C# | **OTel-dotnet + ASP.NET 内置** |
| TypeScript | OTel-js 中等 |
| Elixir | opentelemetry-erlang + Phoenix.Telemetry |

**胜方**：Java/Kotlin/C#（auto-instrumentation 优势）

### 4.7 开发速度

| 候选 | 评估 |
|---|---|
| Python | **Jupyter + IPython 顶配** |
| Java | REPL (jshell) 弱 |
| Kotlin | Jupyter Kotlin kernel + IDE 顶配 |
| C# | dotnet csi + Polyglot Notebooks |
| TypeScript | ts-node REPL + Bun REPL |
| Elixir | **`IEx` 顶配 REPL** |

**胜方**：**Python ≈ Elixir > TS ≈ C# > Kotlin > Java**

### 4.8 运维 / 部署

| 候选 | 评估 |
|---|---|
| Python | venv/uv + Docker |
| Java | JAR / GraalVM Native，**JVM 起步 200-400MB** |
| Kotlin | 同 Java + Native |
| C# | **dotnet publish + AOT 单二进制** |
| TypeScript | Bun single binary / pkg |
| Elixir | **Mix Release 单二进制 + 热升级** |

**胜方**：**Elixir ≈ C# (AOT) ≈ TS (Bun) > Python > Java/Kotlin**

### 4.9 生态健康度

| 候选 | 评估 |
|---|---|
| Python | LLM 圈最热，但 web 框架碎片化 |
| Java | 30 年长期主义 |
| Kotlin | JetBrains + Google Android |
| C# | Microsoft 长期投入 |
| TypeScript | 现代 web 主语言，变迁快 |
| Elixir | 小但稳定 |

### 4.10 团队 / 招人

| 候选 | 评估 |
|---|---|
| Python | 招人池最大 |
| Java | 招人池极大 |
| Kotlin | 中等 |
| C# | 中等 |
| TypeScript | 招人池大 |
| Elixir | **招人困难** |

---

## 5. 决赛：Multi-Agent 三需求联合杀手条件

加入"两阶段共享"和"Multi-Agent process-isolated"两个权重约束后，所有候选重新过滤：

### 5.1 三个产品需求逐项验证

| 需求 | TS 全栈 | Python | TS+Workers | Java/Kotlin Loom | C# + Orleans | **Elixir OTP** |
|---|---|---|---|---|---|---|
| **后台 24x7 持续干活** | ❌ orchestrator 函数死了就没了 | ⚠️ asyncio Task 能跑，但单事件循环 + GIL | ⚠️ worker_threads 启动重 (50-100ms)、IPC 复杂 | ⚠️ Loom virtual threads 长期 alive 没问题 | ✅ Grain 永久 virtual actor | ✅ GenServer 是基因 |
| **独立取消** | ❌ Promise 取消污染调用链 | ⚠️ task.cancel() 状态清理要手工 | ⚠️ Worker.terminate() 粗暴 | ⚠️ Thread interrupt 是 cooperative | ✅ Grain deactivate | ✅ Process.exit 干净 |
| **Crash isolation** | ❌ uncaught exception 单进程传染 | ❌ 进程级 OOM 全死 | ⚠️ Worker crash 隔离但调度复杂 | ❌ Thread crash → JVM 不挂但 thread-local 污染 | ✅ Grain crash 不影响 silo | ✅ "let it crash" 是哲学 |
| **判定** | ❌ 全挂 | ❌ 1.5/3 | ❌ 1/3 | ❌ 1/3 | ✅ 3/3 | ✅ 3/3 |

剩下两强：**C# + Orleans** 和 **Elixir + OTP**。

### 5.2 决赛：Elixir vs C# Orleans

| 维度 | C# + Orleans | Elixir + OTP |
|---|---|---|
| **单机包体积** | dotnet AOT ~80MB + Orleans runtime | Mix Release ~30MB |
| **单机启动时间** | ~1-3s + Orleans silo 启动 | ~1-2s |
| **设计意图** | **Cluster-first**，单机是 degraded 模式 | **Single-node 等于 cluster degenerate** |
| **阶段 1 → 2 切换** | 单机 silo → 多 silo cluster 要配置 + Azure Storage / ADO 后端 | 启动 libcluster 节点发现，**业务代码 0 改动** |
| **Grain vs Process** | Grain 是 virtual actor（按需激活、空闲 deactivate），状态外存 | Process 是真实存在的 actor，state 在 process heap |
| **学习曲线** | C# 阵营熟，但 Orleans 抽象（Grain / Reminder / Stream / Persistence Provider）非平凡 | Elixir 语法 + OTP 模型，6-12 周到 productive |
| **LLM 生态** | Semantic Kernel 微软自家，强 | langchain_elixir + instructor_ex，二线 |
| **桌面应用** | Blazor WASM 包体积大、性能一般；要么 Avalonia/MAUI（额外学习） | React/TS + Tauri 标准方案 |

**Orleans 的根本问题**：它是为"云上分布式微服务"设计的，单机长期场景下**架构过度**。Elixir 是为"电信交换机 24x7 不停机"设计的，**单机长期就是它的本主场**。

加上桌面应用形态：Blazor WASM 不如 React/TS + Tauri 干净 → **Elixir 全面胜出**。

---

## 6. 已被否决但值得记录的方案

### 方案 A：Python + Ray Actor

- **思路**：用 Ray 框架在 Python 上做 actor model
- **否决理由**：Ray 是为 ML 训练 / 推理设计的，actor lifecycle 与本项目 Multi-Agent 长跑语义不直接对应；Ray 集群部署对单机桌面应用是过度

### 方案 B：Akka.NET / Akka Scala

- **思路**：JVM 阵营的 actor model
- **否决理由**：Akka 已经是 BSL 商业许可（Lightbend），开源项目使用有不确定性；JVM 单机底盘 200-400MB 内存仍然是真问题

### 方案 C：Pony Language

- **思路**：actor model + capability-based security 的设计型语言
- **否决理由**：太小众，社区 < 1000 活跃用户，LLM 生态接近零

### 方案 D：Rust + actix / ractor

- **思路**：Rust 的 actor 框架
- **否决理由**：actix 已废弃，ractor 不成熟，schema 演化期 Rust 开发速度跟不上 ADR 迭代频率

### 方案 E：Compose Multiplatform Web (Kotlin)

- **思路**：Kotlin 全栈，前端用 Compose for Web
- **否决理由**：Compose Multiplatform Web 仍在 alpha 阶段，社区小，桌面 + Web 双形态稳定性不及 React

---

## 7. 决策矩阵汇总

| 候选 | Schema | LLM | 长跑/Multi-Agent | 桌面轻 | 阶段 1→2 平滑 | Multi-Agent 三需求 | 招人 | 综合 |
|---|---|---|---|---|---|---|---|---|
| Python | ◯ | ◎ | ◯ | ◯ | ◯ | △ | ◎ | 不及格在 Multi-Agent 三需求 |
| TypeScript | ◎ | ◯ | △ | ◎ | ◎ | ✗ | ◎ | 不及格在 Multi-Agent 三需求 |
| Java | ◎ | ◯ | ◯ | ✗ | ◯ | △ | ◎ | 不及格在桌面轻 |
| Kotlin | ◎ | ◯ | ◯ | ✗ | ◯ | △ | ◯ | 不及格在桌面轻 |
| C# Orleans | ◯ | ◯ | ◎ | △ | ◯ | ◎ | ◯ | 决赛输给 Elixir 在桌面 + 部署轻 |
| **Elixir** | ◯ | △ | **◎** | ◎ | **◎** | **◎** | ✗ | **唯一全部约束满足** |

图例：◎ 优秀 / ◯ 良好 / △ 及格 / ✗ 不及格

---

## 8. 决策不可逆性

技术栈选型决策属于**强路径依赖**：

- 一旦开始写 Elixir 代码 + OTP 设计，半年后切换到别的栈成本极高
- 但 v2 README §1 明确"代码可以从头开始"——本目录建立时还没有任何代码，是真正的"零成本切换窗口"

**结论**：现在锁定 Elixir 是合理的决策时机。开始 Phase 0 前是最后的"零成本切换窗口"。

如果在 Phase 0 实际编码 4 周后发现栈选型错误，需要按 [`13-risks.md`](./13-risks.md) 的"early warning indicators"判断，触发回退流程。
