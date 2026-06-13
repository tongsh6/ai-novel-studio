# 承重竖切面试行规则

> 状态：试行
>
> 目的：约束 AI 和人类开发者在项目初期按真实运行链路打地基，避免横向铺层和轻薄 demo。
>
> 上层蓝图：`docs/engineering/architecture-operating-system.md`

---

## 1. 定义

本项目的竖切面不是“尽快端到端跑通一个功能”，而是**打实一段未来会长期承载功能的运行链路**。

一个承重竖切面必须同时具备：

| 承重件 | 含义 |
|---|---|
| Contract | 固化或消费一个已定义契约，例如 JSON Schema、ADR、状态字段、card/action schema |
| Invariant | 保护至少一个系统不变量，例如终态不可逆、tentative 不进 reading projection |
| Boundary | 切穿真实 app 边界，且不破坏 umbrella 依赖方向 |
| Consumer | 有第一个真实消费者，而不是孤立基础设施 |
| Proof | 有测试或命令证明链路和不变量成立 |

如果一个任务缺少其中任意一项，默认不视为承重竖切面。

### 1.1 外部驱动真实页面验收原则

每完成一个 slice，默认必须能由外部自动化驱动真实页面完成场景化验收。这不是额外 UI 要求，而是判断 slice 是否真正切穿产品主链的标准。

- “真实页面”指当前用户实际进入的产品入口，例如 Tauri 工作台和 `App.tsx -> WorkspaceChat`，不是旁路 demo、Storybook、孤立组件、脚本专用页面或只在测试里构造的 helper。
- “外部自动化”指 Playwright/Tauri/系统 UI 驱动等位于产品代码之外的脚本。脚本可以启动服务、打开真实页面、输入文本、点击按钮、观察网络帧、截图和读取日志，但产品代码不得知道正在被验收。
- 场景化验收必须像用户一样操作 UI，并穿过真实主链：Frontend 用户操作 → socket/API 请求 → web/channel/controller → application 编排 → domain/agent/persistence → TurnResult / task_state / projection / trace → 前端可见反馈。
- 后端单测、Channel 测试、API helper 测试、组件类型测试都可以作为 Proof 的局部证据，但不能单独证明 slice 完成。
- 直接调用后端模块、直接 push Channel payload、只测 socket helper、只测组件 render、只用 mock 文档描述，都不算完成场景化验收。
- 产品内置自动输入/自动点击/自动采纳、验收专用 env 开关、验收专用 DOM hook、验收专用 Channel/API 事件、生产 runtime 注册验收 provider，都不算外部自动化，属于嵌入式验收钩子。
- 自动化可以使用 Playwright 或 Tauri 脚本；人工 walkthrough 可以作为临时证据，但长期应沉淀为 `scripts/slice_verify.sh <slice-id>` 这类可重复脚本，并输出截图、日志、网络帧到 `artifacts/slice-verify/<slice-id>/`。接手新会话时先运行 `bash scripts/slice_verify.sh --list` 查看已有可复跑场景。
- Proof 必须写清外部脚本如何触发：输入什么、点击什么、切换什么、确认/采纳什么，以及前端应看到的状态变化。
- 如果因为缺入口、缺事件、缺状态投影或缺 UI 自动化，暂时不能由外部自动化驱动真实页面验收，该 slice 只能标为“已实现，未闭环”或“局部证据”，不能标 done。

### 1.2 最小实现步不是交付范围

允许把一个承重 slice 拆成多个最小实现步，但最小实现步只能是执行 checkpoint，不能重新定义或缩小 slice 的完成语义。

每个最小实现步必须同时满足：

- 来源必须是既有规划、acceptance 文档、GAP 编号或 slice 任务清单中的明确缺口，不能由执行者现场发明范围。
- 必须声明它所属的完整闭环，例如“AU-05 采纳闭环：生成 tentative → 点击采纳 → adoption boundary → persistence / state trace → projection stale → UI 可见反馈”。
- 必须写清当前 checkpoint 已覆盖哪些计划内后果、尚未覆盖哪些计划内后果；未覆盖部分不能被表述为“本次不做”或“范围外”，只能表述为“下一 checkpoint”或“未闭环缺口”。
- 如果该 checkpoint 没有外部自动化驱动真实页面的场景化验收，只能标“局部证据”，不能标 slice done。
- 如果该 checkpoint 只接入 handler/helper/service，而没有 persistence、trace、projection、UI feedback 等规划内后果，必须继续推进到完整闭环后再评估完成状态。

最小实现步的作用是降低一次改动风险，不是降低验收标准。任何“最小步完成”都不得覆盖或替代对应 AU/SU/GAP 文档里的完整场景要求。

---

## 2. 本项目承重主链

默认按以下运行链路识别 slice：

```text
Turn 输入
→ intent / policy / capability 判定
→ turn phase/status 状态推进
→ application 编排
→ agent / domain / persistence 边界调用
→ TurnResult / TurnResultViewModel 输出
→ ui_card / action / adoption / projection 消费
→ memory / audit / replay 留痕
```

slice 不要求一次覆盖完整主链，但必须覆盖一段连续链路，并形成可执行闭环。

---

## 3. 首选 slice 类型

试行期优先使用以下 6 类 slice。新类型可以出现，但必须说明为什么现有类型不适用。

| 类型 | 目标 | 常见承重契约 |
|---|---|---|
| Turn Slice | 打实一类 turn 从输入到 TurnResult 的状态推进 | `turn_result_v2`、turn phase/status |
| Behavior Slice | 打实 clarification / confirmation / cancellation 等等待用户行为 | behavior state、card/action |
| Artifact Slice | 打实 tentative artifact 到 adoption 的边界 | `requires_adoption`、adoption lifecycle |
| Projection Slice | 打实 accepted source 到 projection stale/rebuild/fresh 的链路 | `source_revision_refs`、projection status |
| Memory Slice | 打实 turn / artifact / decision 写入与检索路径 | workspace 分区、retention tier |
| UI Contract Slice | 打实 TurnResult / card / action 在 Tauri workbench 中的消费 | `docs/design/contracts/VS-05-ui-roundtrip-contract-pack.md`、UI design trace |

---

## 4. 任务命名

任务名应描述链路，不应描述横向技术层。

推荐：

```text
VS-001 TurnResult Contract Spine
VS-002 Clarification Card Loop
VS-003 Confirmation Before Execute Loop
VS-004 Tentative Artifact Adoption Boundary
VS-005 Accepted Artifact Marks Projection Stale
VS-006 Turn Memory Write-Through
```

不推荐：

```text
实现记忆系统
实现 Provider
实现项目管理接口
搭建大纲页面
新增数据库表
```

---

## 5. 开工检查

每个 slice 开始编码前必须写清：

```md
## 开工检查

- Contract:
- Invariant:
- Boundary:
- Consumer:
- Proof:
- Acceptance Driver:
```

检查标准：

- `Contract` 必须引用 `docs/design/`、ADR、schema 或既有代码契约。
- `Invariant` 必须能写成测试断言或明确的非法路径。
- `Boundary` 必须列出涉及的 umbrella app 和禁止触碰的 app。
- `Consumer` 必须是真实调用者，不能写“未来 UI 会用”。
- `Proof` 必须包含至少一个测试、编译或脚本验证。
- `Proof` 必须包含外部自动化驱动真实页面的场景化验收路径；如果暂缺，必须明确记录“未闭环”及缺失项。
- `Acceptance Driver` 必须写清脚本入口、真实页面入口、使用的用户可见操作，以及产品代码是否新增验收感知逻辑。默认答案应为“不新增”；如需新增，必须证明它是真实产品能力而非验收钩子。

---

## 6. 禁止形态

以下任务默认不允许单独交付：

- 只建表、schema、migration
- 只写 controller/channel
- 只搭 UI 壳
- 只加 provider/repository/service 抽象
- 只创建未来会用的模块
- 只增加 enum / state / field，但当前 slice 无法到达或消费
- 只实现 happy path，但没有契约、状态或不变量测试

允许基础设施建设，但必须同时满足：

- 当前 slice 会真实调用它
- 有明确 contract 或 invariant
- 有测试保护关键行为
- 不引入当前 slice 不消费的扩展点
- 不绕过 umbrella app 依赖方向

---

## 7. 试行期纪律

试行期先靠文档和 code review 约束，不急于加入 CI 门禁。

每完成一个 slice，需要在对应 `tasks/slices/VS-*.md` 记录：

- 实际修改范围
- 打实的 contract / invariant / boundary / consumer / proof
- 外部自动化驱动真实页面的场景化验收路径：脚本从哪个真实页面、通过什么用户可见操作触发本 slice
- 验证命令
- 发现的规则缺口

如果连续多个 slice 都需要同一条检查规则，再考虑把它固化为脚本或 CI 门禁。
