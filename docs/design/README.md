# 当前设计文档入口

> 状态：当前唯一设计真源
>
> 适用范围：AI Novel Studio 当前产品、架构、contract、ADR、验收设计、UI 设计与 schema/codegen 追溯。

`docs/design/` 是本仓库当前唯一设计文档体系。主阅读路径不再保留 `design-v2` / `design-v3` 两套并行目录；历史版本标签只允许出现在必要的迁移背景、文件名兼容或测试命名中，不能作为当前设计入口。

新增或修改设计时，优先更新本目录下的对应子目录；不要新建版本化设计目录。

## 目录

| 目录 | 角色 | 典型消费者 |
|---|---|---|
| `00*.md` / `01*.md` ... | 当前主链、运行时、状态、工作台、小说要素设计 | 架构评审、slice 规划、实现前读图 |
| `adr/` | 当前唯一 ADR 目录 | implementation plan、代码注释、contract pack |
| `contracts/` | 当前唯一 contract pack 目录 | backend/application/domain/frontend contract 对齐 |
| `acceptance/` | 当前唯一验收设计目录 | scenario acceptance、slice 验收、质量台账 |
| `ui/` | 当前唯一 UI 设计、Pencil 原型与追溯目录 | 前端组件头部追溯、`scripts/check_design_trace.sh` |
| `schemas/` | 当前 JSON Schema / enum SSOT | codegen、schema 漂移检查、兼容层 |
| `tech-stack/` | 当前技术栈、Tauri、前端、数据库、部署与开发约束 | AGENTS、审计脚本、开发者 |
| `domain/` | 小说领域模型、上下文组装、阅读投影、创作生命周期 | application/domain/frontend 消费者 |
| `quality/` | 小说质量门禁、人审与 adoption 原则 | 质量体系、验收 manifest、UI action/adoption |
| `foundation/` | Provider、审计、安全预算、基础架构和 contract glossary | gateway、trace、security、cross-app contract |
| `notes/` | 讨论材料和运行经验 | 背景输入；不能直接授权实现 |

## 整合原则：以 v3 为主体，吸取 v2

目录合并只是把文件归到一处；**实质整合是单向的——以 v3 为指导和原则，对 v2 内容进行吸取**。v2 不是一个与 v3 并立的永久权威层，而是"待吸取的材料源"：有价值且符合 v3 原则的内容被吸收进 v3 体系并归 v3 治理，被 v3 推翻的内容标 superseded，与 v3 原则冲突的内容淘汰。终态是**一个由 v3 组织、按 v3 原则运转的单一体系**，"v2" 作为来源概念逐步消解。

任何 AI 读到看似"两个时代"的文档（如顶层 `06` 与 `domain/26`）时，一律以 v3 为判断标准，而不是按文件标题里的 `v2`/`v3` 字样判断权威。

### v3 指导原则（判定 v2 内容的尺，详见 `00`§2/§5/§10、`01`§3）

1. Dialogue-first / Agent-native，不再 Router-first。
2. 会话结构是 Agent 内核；prompt 只是其在某 provider 上的投影，真正契约是 AIMessageEnvelope/DialogueFrame/ContextPacket/MicroPlan/ToolInput/ToolResult/TurnResult/Trace。
3. AI 引导式创作三层契约（小说层 / 当前作品层 / 本轮引导层）投影到每次 AI 调用的 message layer。
4. Contract-first，系统约束不藏进 prompt；意图用 AI 语义判断，不前台化 slot、不靠关键字。
5. Planner 提建议，Execution Orchestrator 掌执行权；Planner 不能批准自己的执行。
6. Workbench 是工具箱，不是作者前台流程。
7. 写入默认 tentative，经 adoption / confirmation / policy 放行。
8. 可审计可回放；replay 默认不重调 LLM。
9. 上下文最小可解释（Context 不是全量 dump，省略要可解释）。
10. 领域建模骨架是要素 × 层级 × 三态（设计态/实现态/进度态，见 `08`）。
11. 改动按承重垂直切面，回答 Contract / Invariant / Boundary / Consumer / Proof。

### 对 v2 每块内容的吸取判定

| v2 内容相对 v3 | 处置 |
|---|---|
| v3 已表述 | v2 对应内容标 superseded → 指向 v3，不再作为权威 |
| v3 未表述、符合 v3 原则、仍有价值 | 吸取：上提进 v3 主链/contract，或作为 v3 体系的领域层明确归 v3 治理 |
| v3 未表述、纯领域知识（如对象/连续性/风格细节） | 保留，但重新定位为"v3 体系的领域层"，服从 v3 原则，不再以"v2 遗产"身份存在 |
| 与 v3 原则冲突 | 淘汰 / 标废弃 |

### 目录角色（整合后）

| 层 | 目录 | 角色 |
|---|---|---|
| 主链（v3 主体） | `00*`–`08*` | 架构、交互模型、对话协议、执行编排、状态机、记忆/上下文/trace、UI 契约、小说要素模型 |
| 领域层（归 v3 治理） | `domain/`、`foundation/` | 小说领域细节与横切契约；按上表逐篇吸取，服从 v3 原则 |
| 冻结层 | `adr/`、`contracts/`、`schemas/` | 决策、契约、schema 冻结点 |
| 验证层 | `acceptance/`、`quality/` | 场景化验收口径与质量门禁设计 |
| 资产层 | `ui/`、`tech-stack/`、`notes/` | UI 设计/原型、技术栈、讨论材料 |

> 整合状态（2026-06-14）：路径与交叉链接已统一到 `docs/design/...`；本节确立"以 v3 吸取 v2"的整合原则与判定尺；各领域层文档的逐篇吸取（重新定位、superseded 标注、上提）按 `tasks/` 中的整合台账推进。

## 当前入口

建议阅读顺序：

1. `00a-reading-map.md`：按角色选择阅读路径。
2. `00c-state-and-contract-atlas.md`：查状态、contract、ADR 和 slice 入口。
3. `00d-runtime-architecture.md`：确认运行时边界。
4. `adr/README.md`：确认当前冻结决策。
5. `contracts/`：查具体 contract pack。
6. `acceptance/README.md` 与 `acceptance/SCENARIO-BLUEPRINT.md`：查场景化验收口径。
7. `ui/README.md` 与 `ui/traceability/screen-to-doc-map.md`：查 UI 实现追溯。

## 合并来源

本目录整合了原两套设计体系中仍有效的内容：

- 当前主链、ADR、contract pack、验收设计、运行时架构来自原当前设计主干。
- Tauri / frontend / schema codegen / UI 原型与追溯来自旧技术栈与 UI 资产。
- 小说领域模型、阅读投影、质量门禁、human approval / adoption、Provider、安全预算、审计等仍有效原则已并入对应子目录。

未迁入的旧 phase roadmap、旧 Router-first 设计、旧版本 ADR、历史 review 与过期状态说明已从主文档路径删除，避免继续误导 AI 或开发者。

## 写作规则

1. 当前设计引用必须使用 `docs/design/...`。
2. ADR 必须落在 `docs/design/adr/`，contract pack 必须落在 `docs/design/contracts/`。
3. UI 组件追溯必须指向 `docs/design/ui/...`，并通过 `bash scripts/check_design_trace.sh`。
4. JSON Schema / enum SSOT 必须指向 `docs/design/schemas/...`。
5. 若材料只剩考古价值，不放回主阅读路径；除非当前设计明确引用，否则删除。
6. 任何会改变产品、contract、验收或代码边界的文档调整，都要同步 `docs/project-ledger.md`、`tasks/NEXT.md` 或 `quality/` 中相关事实入口。
