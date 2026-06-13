# 当前设计文档入口

> 状态：当前唯一设计真源
>
> 适用范围：AI Novel Studio 当前产品、架构、contract、ADR、验收设计、UI 设计与 schema/codegen 追溯。

`docs/design/` 是本仓库当前唯一设计文档体系。主阅读路径不再保留 `design` / `design` 两套并行目录；历史版本标签只允许出现在必要的迁移背景、文件名兼容或测试命名中，不能作为当前设计入口。

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
