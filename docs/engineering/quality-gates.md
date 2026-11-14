# v3 质量门禁护栏

> 状态：试行护栏（2026-05-08）
>
> 角色：定义 v3 从设计进入实现时必须通过的质量门禁。本文不替代 `AGENTS.md`、`docs/coding-standards/` 或 v2 小说质量门禁；它把这些已有规则按 v3 的实现顺序收口。

---

## 1. 门禁分层

v3 的质量门禁分三层：

| 层级 | 目的 | 主要来源 |
|---|---|---|
| 工程门禁 | 代码能编译、边界没破、测试通过、静态扫描闭环 | `AGENTS.md`、`scripts/ai_static_scan.sh`、`docs/coding-standards/` |
| slice 门禁 | 每个承重竖切面有契约、不变量、边界、消费者、证明 | `docs/engineering/vertical-slice.md`、`tasks/slices/v3/DAG.md` |
| 小说质量门禁 | AI 产出的创作材料能被检查、警告、确认、采纳或阻断 | `docs/design/quality/31-novel-quality-gates.md`、`docs/design/quality/32-human-approval-policy.md`、v3 contract packs |

这三层不能互相替代：

- 工程检查通过，不等于创作语义正确。
- 小说质量判断存在，不等于代码边界合格。
- UI 看起来能用，不等于 slice 不变量成立。

---

## 2. 工程门禁

### 2.1 通用后端门禁

所有涉及 Elixir 后端的实现计划，必须列出并执行：

```bash
mix compile --warnings-as-errors
mix test
mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs
```

要求：

1. 编译零警告。
2. 测试全通过。
3. 无编译期循环依赖。
4. `arch_check` 无架构违规。
5. 新增模块必须有测试；修改核心逻辑必须更新测试。

如果本地环境导致命令无法完成，例如数据库未启动，最终汇报必须写明：

- 哪条命令失败。
- 失败原因是否是环境问题。
- 哪些子命令已经通过。
- 还需要谁在什么环境复跑。

### 2.2 通用前端门禁

所有涉及 frontend 的实现计划，必须列出并执行：

```bash
cd frontend && pnpm typecheck && pnpm lint && pnpm test
bash scripts/frontend_audit.sh
bash scripts/check_design_trace.sh
```

要求：

1. 不手写 schema 类型，类型来自 Zod / codegen。
2. 不使用内联样式。
3. 用户可见文案集中管理。
4. 组件文件头部有设计文档和原型追溯。
5. Tauri-first 约束不破坏：不直接使用浏览器专用 API 替代 Tauri API。

### 2.3 AI 静态扫描闭环

每次功能实现完成后，必须执行：

```bash
bash scripts/ai_static_scan.sh --top 10
```

快速本地检查可先跑：

```bash
bash scripts/ai_static_scan.sh --top 10 --quick
```

闭环规则：

1. 优先处理 P0 / P1 问题。
2. 本次改动文件里的 P2 问题必须处理或解释。
3. 不能安全处理的问题必须进入处置说明，说明原因、影响范围、后续归属。
4. 处理后必须复跑扫描。
5. 最终汇报必须包含剩余 Top 10 的处置状态。

现有处置来源：

- `artifacts/static-scan/top10.md`
- `artifacts/static-scan/report.json`
- `artifacts/static-scan/disposition.md`
- `reports/static-scan/dispositions.json`

### 2.4 文档变更门禁

只改文档时，至少执行：

```bash
git diff --check
rg -n "TO""DO|TB""D|占位""符|下一步需要冻""结|仍未进入 Pro""posed" docs tasks
rg -n "VS-00"" 至 VS-06|VS-01"" 至 VS-06|VS-00 / VS-00A / VS-00B / VS-01"" 至 VS-06" docs/design tasks/slices/v3
```

如果新增工程文档，还必须确认：

1. `docs/engineering/README.md` 已接入。
2. 相关 v3 阅读地图已接入。
3. 新文档没有重写已有规则，而是引用已有来源。

---

### 2.5 测试环境作用域与 fixture 生命周期（2026-11-13 设计）

本节是全项目测试环境的统一设计，实施与证据以 [B84](../../tasks/slices/B84-web-slow-tests-and-arch-debt.md) 为准。**设计已形成不等于入口已经改造。** 目标是消除没有必要的环境重建，同时保留用例独立性和完整验收；不是仅在退出时补一次删除，也不是引入新的测试框架。

#### 2.5.1 现役归属与统一边界

继续使用 ExUnit/Ecto SQL Sandbox、Node `node:test`、Vitest、Rust 内置测试以及已有外部页面驱动。`mix test`、`pnpm test`、CI、质量检查、场景批次和变异测试遵循同一生命周期契约；各框架仍负责发现用例、执行断言和报告结果。

作用域参数仅由测试支撑、测试配置和外部驱动消费；不得让生产路径读取case/slice标志、注册验收替身或感知自动化。真实页面仍由外部驱动用户可见入口。

已有实现的归属如下，迁移必须先复用再收敛，不另起服务或配置树：

| 现有 owner | 继续承担的职责 | 需要补齐的边界 |
|---|---|---|
| `scripts/lib/test_env.sh` | 目录/测试 DB 前置、迁移、HTTP 就绪、端口预检 | 从只有前置扩展为运行作用域的申请、嵌套借用和退出；按实际需要初始化，不给纯测试建库 |
| 根 `mix.exs`、各 app `test_helper.exs`、`NovelPersistence.DataCase` | 后端入口、事务与测试进程隔离 | 初始化归运行/worker，Case 只拿事务和所需数据；子进程先结束，Sandbox owner 后退出 |
| `scripts/lib/test_env.test.mjs` 中已有 `tempDir(t, prefix)` 模式及各域 fixture helper | Node 测试上下文绑定、领域合成数据 | 把已有机制提取为薄适配，迁移重复实现；不从测试文件导入而触发额外测试，不造 fixture DSL |
| `frontend/vite.config.ts`、现有 Vitest hooks | 前端测试集合与 mock/store/timer 状态隔离 | 公共只读前置与每例状态复位分开，不为普通组件/纯函数测试启动后端或 Tauri |
| `scripts/lib/process_tree.sh`、`native_app_ownership.mjs` | 子孙进程/进程组及原生实例归属 | 复用精确归属，不能仅凭同名进程或陈旧 PID 清理；把退出失败交回上层结果 |
| `quality_accept.sh`、`slice_verify.sh`、`tauri_slice_verify.sh`、各 native batch | 场景调度、真实页面与证据 | 外层批次拥有运行作用域，内层只借用；统一唯一证据批次，保留真实失败与恢复材料 |
| `probe_run.sh`、既有 dogfood 入口 | 探针参数、构建路径与真实 Provider 调度 | 接入同一作用域；共享的作者模型服务是借用资源，退出不得停止或改配置 |
| `quality/` 与既有 gate/manifest | 检查集合、分层与证据要求 | 维护执行选择及资源要求；不再建立另一套任务状态或测试结果注册表 |

`novel_test` 已是只依赖 `novel_common` 的纯测试契约 app，不能把 Repo、文件、进程或资源调度塞进去。数据库生命周期继续归 persistence 的测试支撑；跨语言统一的是责任和协议，不是把所有实现堆进一个模块。

#### 2.5.2 作用域与所有权

| 作用域 | 初始化内容 | 可共享内容 | 必须隔离的内容 | 退出责任 |
|---|---|---|---|---|
| 一次验证运行（invocation） | 选定的验证集合、资源需求、运行身份、scratch/证据位置、预算 | 同一运行中已准备的不可变基准和构建产物 | 与其他并行验证运行的目录、端口、可变状态 | 最外层入口；子入口借用时不得结束父作用域 |
| fixture 规格（运行内） | schema/迁移 + 合成种子 + 相关配置决定的不可变模板 | 相同规格的只读数据；相同源码/配置的构建缓存 | 不同 schema/种子/配置的基准；真实作者源不可改写 | 模板由运行 owner 持有，不由每个 case 重新生成 |
| worker/框架进程 | 实际需要的 DB 连接/分区、server/browser、局部配置 | 只读模板与代码构建产物 | SQLite 写入者、Application env、Registry、mock、store、计时器、端口 | worker owner；终止其活动后才释放底层资源 |
| case/独立场景 | 最小数据差异、事务、必要的可写副本或浏览器上下文 | 已声明的只读基准 | 本例会修改的状态；独立场景的应用状态 | 框架 hooks/RAII；异常时外层 owner 兜底 |

Suite 是组织用例和依赖的边界，不能仅凭 `beforeAll/setup_all` 的名字把它当成整次运行。变异工具每次重启 Node 子进程时，子进程内的 `beforeAll` 仍会重复执行；昂贵的不可变基准必须由**变异外层运行**准备并向子进程提供。

独立性不等于从零建库。后端优先沿用 Sandbox 事务；只读测试复用只读模板；只有文件损坏、迁移、备份恢复、跨进程写入等确实不能用事务隔离的行为，才申请独立可写副本。一个多轮 UI 场景的各步共享该场景状态，不能在每轮之间重置；不同独立场景仍须隔离。

#### 2.5.3 初始化与 fixture 复用

1. 先选择要证明的契约及测试集合，再计算其资源需求。纯判定/序列化/分类测试的业务 fixture 不创建 DB、server、浏览器、原生窗口或 Provider；代码加载和报告写出不冒充业务 fixture。
2. 最外层入口创建运行作用域，嵌套检查继承同一身份。没有父作用域的直接框架入口也必须在**入口层**完成申请；禁止让 case 自行补建全局环境。Shell、BEAM、Node、Rust 适配只负责接入各自框架，不复制另一套 fixture 选择策略。
3. 同一运行、同一 fixture 规格只成功初始化一次。规格由实际 schema/迁移、builder/seed 和影响数据的配置确定；未提交源码也要纳入指纹，不能只用 HEAD。默认只在本次运行内复用，不先设计跨日数据库缓存。
4. 初始化失败不能发布半成品模板；并发需求由一个 owner 完成初始化，其余等待同一结果。只有确需该资源的测试集合才触发初始化。
5. 模板封存后只读。消费者拿到数据/路径及租用范围，不能修改模板；需要写的 case 使用事务或受控工作副本。复用前核对规格和内容，不把旧数据“存在”当成“可复用”。
6. `NOVEL_TEST_DB_DIR`、构建路径、测试 profile 等沿现有接口传递；是否由当前运行创建、可否重置/删除须有明确归属。外部传入路径默认是借用资源，不能仅因设置了 `--reset` 或位于系统临时目录就获得删除权限。

真实Provider缓存及外部服务状态不因本地scope自动隔离。实验须声明并发/参数与已观察的外部状态，不能把配置期望写成运行观察，也不能擅自重启作者服务或清缓存来获得“干净环境”。

新增运行元数据只限现有入口实际需要的运行身份、owner/进程身份、规范路径、fixture 指纹和保留类别；附着于现有运行上下文/证据。它不是新的产品 `AgentRun`、数据库表、全局资源服务或平行任务台账。具体字段与薄适配须在 B84 实施 checkpoint 再逐项对账现有载体。

#### 2.5.4 验证集合与变异粒度

纯规则、IO 边界、跨 app 集成、真实页面、真实模型是不同证明层。纯规则已存在独立 owner 时，变异测试使用能判别该规则的纯测试；IO 编排只验证真实的读写/缺证/失败传播边界。不能为一个纯分支变异执行整组数据库构造和完整桌面流程。

测试与真实消费者的对应关系优先沿已有模块/邻接测试/导入关系维护；不能仅用相似文件名猜测，也不能重复建立一份不断漂移的全仓用例清单。混合测试文件先按职责迁移到已有测试族，保留原证明义务；不要通过过滤名字、跳过用例或降低门槛制造高分。所选集合为空或未命中预期测试，视为选择错误。

完整回归与主链场景仍按原门禁执行，但属于独立阶段，不嵌入每个变异点。复跑理由必须对应源码/依赖/fixture/配置变化、真实失败或尚未证明的契约；已验证且依赖未变的结果不重复生成。变异存活按真实 producer/consumer 值域审查，不制造不可达输入，也不增加无消费者兼容分支。

当变异目标本身改变文件或数据库时，必要的可变状态重置仍然存在；目标是避免重复生成**不可变基础环境**，不是牺牲隔离让所有变异共用被污染的库。创建次数与资源峰值应与测试的真实依赖相符。

#### 2.5.5 退出、证据与异常

资源按用途区分，不能统一做“失败就保留整个目录”或“退出就删 artifacts”：

| 类别 | 处理 |
|---|---|
| 借用的作者数据、服务、profile、外部目录 | 只释放本运行的连接/租用；不删除、不停止、不改全局设置 |
| 运行内不可变模板及 case scratch | 不作正式证据时由所属 owner 回收；不能遗留在共享系统临时目录中 |
| 构建缓存 | 继续按现有构建工具管理，按指纹复用；不当成业务状态共享 |
| 原始场景/模型证据 | 按已登记批次保留，失败样本不覆盖；真实作品源和必要 DB 证据不能当合成测试残留删除 |
| 变异/单测诊断 | 保留源码/fixture 标识、变异、命令、结果与必要的小反例；预期的 killed 不意味着保留每个完整临时库 |
| latest 汇总/索引 | 可按既有 SSOT 规则重算，不能据汇总覆盖或丢掉必要原始证据 |

正常退出与可捕获异常均按同一顺序收口：停止派发 → 结束本作用域的任务/订阅/计时器 → 关闭页面、socket、server 与 DB 连接 → 回滚/复位 case 状态 → 归档必要证据 → 回收拥有的可变资源和 scratch → 写明退出结果。后端须先等拥有的 AgentRun/后台写入退出，再停止 Sandbox owner；不能靠全局遍历等待其他用例的任务，也不能超时后返回成功。

超时/取消由作用域外的父 owner 终止并回收其子进程，复用 `process_tree.sh` 和原生精确归属机制；不能按全局进程名清理。SIGKILL/宿主崩溃无法保证同进程 hook 执行，下一次入口只在**已登记的测试运行命名空间**检查遗留 owner 和身份，再处置可证明已失去 owner 的 scratch；不扫描整个 `/private/var/folders` 按前缀盲删。身份或归属不明时保留并报错。

断言失败、产品/模型行为失败、基础设施失败和退出失败必须区分。ENOSPC、运行环境不可用或清理未完成不能计作有效 mutation killed，也不能因为某个退出码被吞掉而签 PASS；保留原始失败及附加退出失败，停止依赖该环境的后续执行。

#### 2.5.6 实施验收，不以“清理后盘够用”代替

- 对纯规则集合，业务 DB/服务/GUI/Provider 初始化数为 0。
- 同一验证运行内，相同 fixture 规格的基础初始化数为 1；增加纯变异点不能增加基础库构造次数。必要的可写副本/事务重置单列，解释为何需要，不能混成“又初始化一次”。
- 并行 worker 不串库、端口或全局配置；两个修改同名对象的 case 仍独立。只读模板前后指纹不变。
- 正常、断言失败、初始化失败、超时、取消及子进程被杀均有受控验收；已退出作用域没有未归属的临时目录、子进程或监听端口。宿主被杀的恢复路径另验，不能假称同步回收。
- 连续两次相同有界验证，初始化次数符合相同依赖关系，退出后无净增加的 owned scratch；先测峰值再确定资源预算，不拍脑袋调大并发或磁盘配额。
- 必要原始证据与借用资源保持不变；基础设施失败不变成有效通过或有效击杀。
- 全部原有业务/隔离/失败矩阵与受影响的真实页面场景保留。只证明生命周期机制不能代签模型语义或整项 B84 完成。

#### 2.5.7 已构造文件资产的最小扩展（2026-11-14 设计，实施见B84）

现有 `materializeFixture({name, files}, {scope})` 已承接文本模板；SQLite必须先执行构造，不能让每个消费者先建库再把结果交给缓存。继续使用这一owner，在同一入口增加当前需要的构造形式 `{name, inputs, build}`：`inputs`是参与指纹的文本键值（实际builder源码/依赖、schema、seed与影响输出的配置），同步 `build(stagingDir)` 只在获得唯一初始化权后运行，返回本次声明的相对payload文件路径。两种形式共享claim、失败传播、发布、复用、工作副本和退出逻辑，不建第二个数据库池或fixture注册器。

调用者必须从实际输入派生指纹材料，包含未提交的builder变化；不能手写一个版本标签代替，也不能在申请前运行建库/快照操作。inputs集合及文本key非空，value为字符串并允许空值（例如空seed SQL）；空值与缺键不是同一个输入。schema/seed的owner仍是已有领域fixture构造器，通用scope不理解作品表、不执行迁移器、不替领域输入设计“完美数据”。文本形式仍按原字面值核对payload，构造形式核对声明路径、完整文件集合与实际字节哈希；二者不混成业务正确性证明，业务期望仍须独立于被测实现。

已完成的文件清单与指纹记录必须和payload在同一staging目录封存后原子发布。复用时先核规格和文件事实；owner在发布后退出仍能读取完整结果，发布前失败不能被当作可用模板。由此替换现有外置ready记录的发布窗口，不保留两套运行时格式兼容；旧失败/原始证据只读保留。控制记录不进入case工作副本；只接收拥有的普通文件，不跟随symlink对借用文件做chmod或归档。正常可写副本继续复用现有 `createWorkingCopy`，不改为各case重新执行builder。

SQLite的“只读连接”不等于目录没有写入：本机合成实验中，WAL库在 `readOnly:true` 打开后生成并保留 `-wal/-shm`，主文件哈希不变；DELETE模式在相同实验中无辅助文件。证据为 `artifacts/b84-test-system/20261114/a2-node-fixtures/sqlite-readonly-probe.json`，与 [SQLite WAL只读说明](https://www.sqlite.org/wal.html)一致。因此可共享的合成SQLite模板必须在builder内关闭连接并封存为无可变辅助文件的形式；专门验证WAL/写入的case使用自己的可变副本。这不授权改作者源库的journal模式，也不授权对活动数据库使用immutable读取。

首个实际消费者是逐调用证据的SQLite读边界；该case会追加反例行，故需要一份可写副本。先在此证明串行/并行消费者只执行一次builder、模板不变、case写入隔离、失败后不发布半成品与完整退出，再迁移confirmation及R01等后续族。当前不提前增加选择性复制、共享Schema生成器、跨日缓存或异步builder接口。

confirmation迁移的真实双故障反例进一步要求同步副本使用的出口一致：现有 `createWorkingCopy` 仍用于向TestContext/调用者交付副本；同一owner增加 `withWorkingCopy(fixture, use, options)`，为当前同步消费者组合“创建→回调使用→cleanup”。回调失败与cleanup失败必须同时保留，复用已有错误组合逻辑；单失败原样抛出，正常返回回调结果。两个副本可组合嵌套调用，不新建资源池/登记器或通用资源框架；不在此引入无消费者的异步回调协议。批次/reader测试消费这一出口，停止各自维护会遮掉主因的finally。

API 语义参考：[Node 24.19 测试执行模型与 hooks](https://nodejs.org/download/release/v24.19.0/docs/api/test.html#test-runner-execution-model)、[Vitest globalSetup](https://vitest.dev/config/globalsetup.html)。Node 的测试文件进程隔离与 Vitest 的 globalSetup 全局空间不同，均不能据“global/beforeAll”名称推断跨外层变异运行的共享范围；本仓实现仍以锁定版本、现有配置和实测为准。

---

## 3. slice 门禁

### 3.1 开工五问

每个 v3 slice 进入实现计划前，必须回答：

| 问题 | 必须达到的硬度 |
|---|---|
| Contract | 引用具体 ADR、contract pack、schema、状态字段或 TurnResult 结构 |
| Invariant | 指向 `docs/design/00c-state-and-contract-atlas.md` 的全局不变量 |
| Boundary | 列出会切过哪些 app，以及哪些 app 明确不应修改 |
| Consumer | 写出第一个真实消费者，不能只写“未来会用” |
| Proof | 写出测试或命令，不能只写人工检查 |

这五问来自 `docs/engineering/vertical-slice.md`，v3 不另起一套。

### 3.2 v3 首批 slice 验收重点

| Slice | 第一质量目标 | 不合格信号 |
|---|---|---|
| VS-00 | reply-only 也有 DialogueFrame / TurnResult / trace | 普通回复绕过 frame 或 trace |
| VS-00A | 模糊想法自然探索，不自动表单化 | “缺字段”直接打开 slot 表单 |
| VS-00B | 回应受当前小说上下文约束 | 无上下文时编造作品事实 |
| VS-01 | MicroPlan 不能批准自己 | Planner 输出被直接执行 |
| VS-02 | 工具有 request / result / trace | 工具调用无来源、无回放依据 |
| VS-02A | AI 能产出小说草稿，但默认待采纳 | 草稿被说成正式角色、正式大纲或正文 |
| VS-03 | clarification / confirmation 有生命周期 | 前端 modal 关闭就当后端状态结束 |
| VS-04 | 选择候选不等于采纳 | choose_candidate 直接写 production state |
| VS-05 | UI 只能提交系统给出的 action | 前端发明 action_type |
| VS-06 | trace summary 脱敏，replay 不重调 provider | 回放时重新调用 LLM 补历史 |

### 3.3 禁止交付形态

以下内容不能单独作为 v3 slice 完成：

- 只建表、schema、migration。
- 只写 controller / channel。
- 只搭 UI 壳。
- 只加 provider、repository、service 抽象。
- 只创建未来会用的模块。
- 只有 happy path，没有拒绝、降级、确认、采纳或 trace 证明。

---

## 4. 小说质量门禁复用

v3 不重新发明小说质量体系。v2 已经定义了小说层质量门禁，v3 只做两件事：

1. 把质量判断接入 Dialogue-first 主链。
2. 分阶段引入，不把完整质量体系塞进首批 slice。

### 4.1 可复用的 v2 质量门目录

| 质量门 | v3 用途 |
|---|---|
| 设定冲突 | 检查草稿是否违反已采纳世界观 |
| 人物逻辑 | 检查角色动机、行为、关系是否可信 |
| 时间线与状态 | 检查事件顺序、伤势、地点、能力状态 |
| 伏笔 | 检查新伏笔、回收、误用 |
| 信息越界 | 检查角色或读者是否过早知道信息 |
| 节奏 | 检查章节推进、情绪密度、信息密度 |
| 爽点 | 检查压抑、铺垫、兑现是否成立 |
| Hook | 检查章节尾继续阅读动力 |
| 战力膨胀 | 检查能力、资源、代价是否失衡 |
| 网文留存 | 检查黄金三章、付费点、连续追读动机 |

来源：`docs/design/quality/31-novel-quality-gates.md`。

### 4.2 v3 首批只接入最小质量证明

首批 v3 slice 不要求完整运行全部小说质量门。首批只要求：

| 场景 | 最小质量证明 |
|---|---|
| VS-00A 自然探索 | 不能把模糊想法强行表单化；候选方向必须可继续讨论 |
| VS-00B 上下文回应 | 不编造当前作品事实；引用上下文要可追溯 |
| VS-02A 创作草稿 | 草稿标为待采纳；来源、上下文和工具结果可追溯 |
| VS-04 采纳边界 | 未经选择和采纳，不写正式作品事实 |
| VS-06 回放 | 解释草稿来源时不重新调用 provider |

完整小说质量门禁应在后续 creative quality slice 中逐步进入，不能抢在 v3 主链稳定前铺开。

### 4.3 质量发现不能直接改状态

复用 v2 的关键原则：

```text
quality finding
→ policy decision
→ warn / retry / confirm / block / adoption review
→ TurnResult / AvailableAction
```

质量发现不能直接：

- 修改草稿。
- 采纳作品事实。
- 关闭 behavior。
- 刷新阅读投影。
- 替作者选择候选。

---

## 5. 人工确认与采纳门禁

v3 继续复用 v2 的作者主导原则：

| 动作 | v3 默认处理 |
|---|---|
| 生成候选方向 | 可以自动，但必须标为候选 |
| 生成角色 / 剧情 / 大纲 / 片段草稿 | 可以自动，但默认待采纳 |
| 写入正式设定 | 必须进入采纳边界 |
| 修改已影响下游的核心设定 | 必须确认或 checkpoint |
| 启动高预算长任务 | 必须确认 |
| 批量采纳或生产写入 | 必须确认、trace、audit |

来源：

- `docs/design/quality/32-human-approval-policy.md`
- `docs/design/foundation/10-security-and-budget.md`
- `docs/design/adr/ADR-0010-state-adoption-boundary-v3.md`

---

## 6. trace / replay 门禁

v3 每条主链都必须能回答：

1. 作者输入是什么。
2. 使用了哪些上下文。
3. 形成了什么 `DialogueFrame`。
4. 是否提出了 `MicroPlan`。
5. 执行裁决是什么。
6. 是否调用了工具。
7. 产生了哪些草稿、候选、等待态或采纳结果。
8. 为什么这些结果可以展示给作者。
9. 回放时是否没有重新调用 provider。

最低要求：

| 对象 | 必须留痕 |
|---|---|
| `DialogueFrame` | frame 类型、目标、依据 |
| `MicroPlan` | 建议动作、风险提示、是否只放行下一步 |
| `OrchestratorDecision` | decision type、first blocking gate、reason |
| `ToolRequest` / `ToolResult` | 工具名、输入摘要、输出摘要、来源 |
| `TentativeArtifactSet` | 草稿来源、上下文引用、待采纳状态 |
| `BehaviorState` | open / close / resolution |
| `AdoptionDecision` | 候选来源、作者动作、采纳结果 |
| `TraceSummaryView` | 作者可见摘要必须脱敏 |
| `ReplayReport` | 开发可见回放不得重调 provider |

来源：

- `docs/design/foundation/09-observability-and-audit.md`
- `docs/design/06-memory-context-and-trace.md`
- `docs/design/adr/ADR-0013-decision-trace-v3.md`
- `docs/design/adr/ADR-0017-replay-report-v3.md`

### 6.1 求证式创作的附加证据门（2026-10-27，VS-00K Proposed）

涉及作品求证的 slice，除上述问题外还必须回答：

1. 初始 Base 实际包含什么，模型何时发现信息缺口并提出查询；Base 已足够时是否允许不探索。
2. 查询实际返回什么 Observation，其来源、权威性、版本、覆盖和结果分类是什么。
3. 哪次后续 provider 请求真实包含了该观察或安全投影；只有工具日志不得判定证据闭环。
4. `used_context_refs` 是否全部属于本次可见 Base refs ∪ 实际观察 refs；未返回是否记 unknown，越界 ref 如何处置。
5. 缺口最终如何结束：继续求证、replan、降级、询问作者或预算耗尽；不得伪装 goal_satisfied。
6. 恢复与 replay 是否从持久观察重建，而非依赖旧 prompt 或重调 provider。

最低新增留痕（由对应 CP 逐步实现，未实现前不得宣称现有场景已覆盖）：

| 对象 | 必须留痕 |
|---|---|
| Requested Observation | model request / query、source refs、work/authority/source revision、coverage、freshness、outcome |
| Evidence Consumption | observation_ref → later provider_call_ref 的输入投影与版本 |
| Evidence Usage | used_context_refs、unbound refs、unknown、对应 provider call 与处置 |
| Preparation / Gap | ready / continue / replan / degrade / ask_author / budget_exhausted 的真实原因与结果 |

来源增加：

- `docs/design/contracts/VS-00K-evidence-seeking-authoring-contract-pack.md`
- `docs/design/acceptance/author/AU-15-evidence-seeking-authoring.md`

---

## 7. 复用 v2 实现经验的验收要求

v3 implementation plan 如果复用或改造 v2 已实现代码，必须额外说明：

| 检查 | 通过标准 |
|---|---|
| 旧 proof 是否仍有效 | 能指出旧测试或旧 slice 证明了什么，不能只说“之前跑通过” |
| v3 语义是否补齐 | 新 proof 覆盖 DialogueFrame、MicroPlan、OrchestratorDecision、DecisionTrace 中相关对象 |
| 旧 Router-first 是否被剥离 | 没有把 Router / intent 当成 v3 第一认知节点 |
| 旧 TurnResult 是否升级 | UI 出口能消费 v3 TurnResultViewModel / TraceSummaryView |
| 旧 tentative / adoption 是否守住 | AI 草稿、ToolResult、candidate 不会直接变成正式事实 |
| 旧代码边界是否仍合规 | 通过 `mix xref` 和 `scripts/arch_check.exs` 验证 |

优先复用的不是旧代码形状，而是旧 slice 的证明习惯：

1. 端到端闭环优先。
2. 每个状态变化都有测试。
3. UI action 回到后端重新校验。
4. tentative 和 adopted 明确分开。
5. trace / audit 不靠普通日志猜。

---

## 8. 实现计划验收模板

每个 v3 implementation plan 的验收段必须包含：

```md
## 验收门禁

### 工程门禁
- [ ] mix compile --warnings-as-errors
- [ ] mix test
- [ ] mix xref graph --format cycles --label compile-connected --fail-above 0
- [ ] mix run scripts/arch_check.exs
- [ ] bash scripts/ai_static_scan.sh --top 10

### 前端门禁（若涉及 frontend）
- [ ] cd frontend && pnpm typecheck && pnpm lint && pnpm test
- [ ] bash scripts/frontend_audit.sh
- [ ] bash scripts/check_design_trace.sh

### slice 门禁
- [ ] Contract 已引用 ADR / contract pack / schema
- [ ] Invariant 已指向 00c 全局不变量
- [ ] Boundary 已列出涉及和禁止修改的 app
- [ ] Consumer 是真实消费者
- [ ] Proof 已写成测试或命令

### v3 愿景门禁
- [ ] 作者面对 AI 创作伙伴，不退回 Router-first / slot-first
- [ ] AI 产物默认待采纳
- [ ] 正式作品事实必须经过采纳边界
- [ ] trace / replay 能解释为什么这样做

### 复用门禁
- [ ] 已引用 AGENTS.md / engineering / coding standards
- [ ] 已说明复用了哪些 v2 设计
- [ ] 已说明复用了哪些 v2 已实现 slice / 代码经验
- [ ] 已说明哪些 v2 设计不能直接搬用
```

如果某条命令因为环境无法运行，不能勾选，只能在实现计划或最终汇报里说明阻塞原因。

---

## 9. 自审清单

评审 v3 质量时按以下顺序：

1. **先看最终愿景**：有没有把作者重新放到 AI 创作伙伴面前。
2. **再看 v3 设计**：有没有经过 DialogueFrame、MicroPlan、OrchestratorDecision、TurnResult、DecisionTrace。
3. **再看复用**：有没有复用 v2 的质量、审批、安全、审计经验，以及现有工程脚本。
4. **最后看命令**：有没有真实运行能证明的检查。

如果 1 不成立，即使 4 全绿，也不合格。

如果 4 不成立，即使设计讲得通，也不能宣称实现完成。
