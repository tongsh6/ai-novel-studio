# B66：本地工作区备份与恢复

- 状态：**doing（2026-10-31 作者接受 A：profile 级快照/恢复契约；排除 secrets/logs，恢复隔离+覆盖确认；CP1 实施中，未自动备份）**。
- 类型：Desktop Data Recovery / Design Preparation Slice。
- 来源：[数据库设计 §8](../../docs/design/tech-stack/06-database.md#8-备份与恢复)、[部署设计 §5.1](../../docs/design/tech-stack/11-deployment.md#51-阶段-1) 已登记阶段 1 的本地备份/恢复，但没有作者可操作的完整产品任务承接。

## 1. 真实场景与现状

作者需要将工作区数据保存成可检查、可恢复的本地快照，并在数据损坏、设备迁移或误操作后通过真实应用入口恢复。正文 Markdown 导出、开发者数据库复制、验收证据备份各有用途，不能代替此闭环。

2026-10-30 只读核对：

- [ExportService](../../apps/novel_application/lib/novel_application/export_service.ex) 从正式阅读事实导出 Markdown；[前端导出](../../frontend/src/lib/export.ts) 选择目录并调用全书导出，不包含工作区恢复。
- [Tauri command 注册](../../frontend/src-tauri/src/lib.rs) 目前覆盖偏好/消息/模型配置与 secret，没有备份或恢复命令；产品路径/任务索引没有查到工作区快照恢复闭环，已有 backup 命中为 WIP/验收运维材料。
- 设计对自动触发写法不一：数据库设计为“每天 / 每章”，部署设计为“每天”。“复制 SQLite 与 WAL”也尚未形成经过验证的一致快照契约，不能据此直接复制正在变化的文件后宣称可恢复。
- [SU-01 当前 secret 决策](../../docs/design/acceptance/system/SU-01-model-provider.md) 使用 profile-scoped `provider-secrets.json`，备份不得默默改变其安全边界；数据包是否包含凭据/偏好/日志必须逐项明确。

## 2. 开工七问

1. **Contract**：阶段 1 SQLite 本地数据、Tauri 原生文件访问、既有作品/会话/采纳状态与 SU-01 secret 规则；快照范围、版本清单、恢复目标/覆盖方式及自动触发尚未冻结，CP0 先形成可审阅契约，不把技术栈一句话当最终 schema。
2. **Invariant**：快照内数据一致、来源与版本可核验；恢复不会把 tentative 变成 canon、重放模型或重复执行历史副作用；取消/无效包/恢复失败不破坏现有工作区；secret 纳入和恢复覆盖必须是已接受的明确策略。
3. **Boundary**：必要的 Tauri 原生文件入口、application 编排与 persistence 快照/兼容边界，web/frontend 仅消费真实进度、预检结果和作者确认。domain 不做文件 I/O；本任务不加入云同步、远程存储或数据库切换。
4. **Consumer**：真实桌面应用中的作者备份/恢复入口；恢复后原作品、会话、已采纳正文与待处理状态的消费者；不能只交付命令行运维脚本。
5. **Proof**：隔离工作区的快照一致性、完整性/版本预检、成功恢复与重开、取消/损坏/不兼容/中断回滚矩阵；校验真实数据关系和 pending/accepted 边界，hash 仅是材料完整性证据，不单独证明恢复可用。
6. **Acceptance Driver**：外部系统 UI 驱动真实 Tauri 菜单/设置入口和原生文件对话框，在隔离来源与恢复目标执行备份→预检→确认恢复→重开→阅读/会话/待处理核对。入口设计与驱动在具体契约接受后建立；产品代码验收感知逻辑 **no**，不读取或恢复作者现有数据来补测试材料。
7. **Exploration**：不新增小说要素；恢复必须保留既有作品知识和引用链，并通过当前查询/探索消费者核对可达性，不另建备份专用知识目录或恢复时自动补造内容。

## CP0 最小本地快照恢复契约准备

- 状态：**done（2026-10-31 CP0 准备完成：数据/敏感文件/一致性/恢复/自动触发选项与推荐已成文；CP1 起实施仍待作者接受契约与数据写入授权）**。
- 下一步：只读盘点当前 desktop profile 的数据库、必要持久文件、偏好/secret 与日志位置，列出现有备份/导出能力及消费者；使用虚构结构示例形成包清单、恢复前预检/确认流程和失败矩阵，不复制真实作者数据。
- 必须提交的具体取舍：
  1. 快照单位是当前 profile 的工作区还是单作品，以及跨作品引用、会话/待处理数据怎样保持完整。
  2. 一致快照机制、写入竞争/运行中任务处理、版本和完整性检查；已有 SQLite/WAL 建议须验证，不直接当实现结论。
  3. 敏感文件逐项纳入/排除：provider secret、运行 secret、偏好、日志等；**建议默认不携带 provider secret**，但本次规划不把建议冒充作者接受。
  4. 恢复到新隔离目标或覆盖当前目标、覆盖前保护与失败回滚、版本兼容和不可恢复时的反馈；不得以恢复包内内容自动授权覆盖。
  5. 首个手动备份/恢复闭环的 UI 与验收；自动备份的触发、保留、清理、资源及错误反馈选择，或明确延期与重新开放条件。不能因本任务登记就开启每日/每章后台备份。
- 完成标准：有具体、可比较的选项、推荐及影响，最小数据包/流程示例与验证方案可审阅；接受后的字段/流程写入既有 `docs/design/contracts/` 或必要 ADR 并回链。本项 done 只代表准备完成，不代表实施或数据操作获批。

## CP1 之后的实施与验收

- 状态：**blocked（等待最小快照/恢复契约、敏感文件、恢复覆盖与自动触发方案的具体接受；不阻塞上面的 CP0）**。

| CP | 完整后果与完成标准 | 状态 |
|---|---|---|
| CP1 | 按接受的契约建立一致本地快照、版本/完整性清单与真实作者导出入口；失败和取消不输出冒充成功的包，敏感文件按契约执行 | blocked：契约未接受 |
| CP2 | 恢复预检、目标/覆盖确认、兼容性与事务/切换/回滚边界；保留现有工作区，损坏/不兼容包在改变权威数据前拒绝 | blocked：依 CP1 与恢复方案 |
| CP3 | 外部真实 Tauri 完成备份与隔离恢复；重开后核对作品、正文、会话、采纳与待处理，补取消/失败/中断/并发写入的负例，无模型/历史副作用重放 | blocked：依 CP1/CP2 |
| CP4 | 自动触发及保留/清理按已接受选择落实并验收；若作者明确延期，记录唯一后续来源与条件，不把手动闭环自动写成自动备份已完成 | blocked：自动触发方案未接受 |

任何最小实现步都不能跳过预检、失败回滚、真实作者入口与重开验证。实施方案接受与**恢复作者现有工作区的数据写入授权**是不同事项；后者必须针对可审阅的来源、目标、差异和回滚计划取得具体授权，不能从本任务的规划或测试授权推导。

## 3. 依赖、条件与恢复指引

- [SU04](SU04-desktop-sidecar-packaging.md) 提供数据目录和 sidecar 生命周期；[B46](B46-persistent-adoption-inbox.md) 的 pending 读取若改变，本任务须保持对应真实状态而非从当前 UI 临时列表拼接备份。
- [B51](B51-tech-stack-current-rebase.md) 校准备份与技术栈声明；本任务不因补齐文档而安装新库、替换 secret 后端、开启云同步或自动运行备份任务。
- 原正文导出继续由原消费链负责，不将其重命名为工作区备份，也不把验收 SQLite 复制脚本直接注册为生产能力。
- 所有开发验收使用隔离数据和原生 UI；不改写历史证据。CP0 后先核作者的具体接受记录，再选择实现 checkpoint；缺少该记录时只继续准备材料。

### CP0 准备材料（2026-10-31）

**现役存储事实（只读盘点）**
- DB：`<data_dir>/ai_novel_studio.db`（SQLite，`pool_size: 1`，启动自动迁移）；`data_dir = <app_data_dir>/profiles/<AI_NOVEL_DESKTOP_PROFILE>` 或无 profile 时 app_data_dir；开发/验收用 `NOVEL_DATA_DIR` 注入。
- `<data_dir>/secret.key`：本机 secret_key_base（≥64B，权限随文件系统）。
- `<data_dir>/log/app/*.jsonl`、`<data_dir>/log/llm-calls/*.jsonl`：业务日志与 LLM 调用留痕（可能含正文/提示内容）。
- `<data_dir>/runtime/sidecar-<version>/`：release 解包运行时（可重建，不必备份）。
- 配置目录 `<app_config_dir>/profiles/<profile>/`：`preferences.json`（最近打开作品/助手显示名等）、`provider-secrets.json`（provider API key，Rust 外置文件）。
- 现有能力只有作品正文/档案导出（`export_work`）与验收用 SQLite 复制脚本；**没有工作区备份/恢复功能**。正文导出不能当工作区备份。

**必须取舍与推荐（待作者接受）**
1. **快照单位**：推荐 **profile 级工作区**（单 DB 已含全部作品、会话、采纳、pending、trace）；单作品导出会漏跨作品引用与会话/pending。若作者只要单作品，需明确跨作品引用与 pending 的降级规则。
2. **一致性**：推荐**显式静默/停写窗口 + SQLite 在线备份（`.backup`/`VACUUM INTO`）**，不直接 raw copy WAL/SHM；生成 manifest（格式版本、app version、DB schema、创建时间、文件大小/SHA-256、完整性 `PRAGMA integrity_check`）。运行中任务/写入竞争必须先停新任务或明确拒绝备份；不可用“先复制再说”。
3. **敏感文件**：推荐备份包默认包含 DB（作品事实）+ preferences，**默认排除 provider-secrets.json、secret.key 与 log/llm-calls**；日志/密钥如需纳入必须单独勾选并警告。恢复包不得自动读取或复用包内密钥；secret.key 本轮不迁移（恢复后本机生成/保留）。
4. **恢复目标**：首闭环推荐**恢复到新隔离 profile**（可审阅、可回滚），覆盖当前 profile 必须二次确认 + 恢复前自动保护快照 + 版本兼容预检 + 失败回滚；损坏/不兼容/缺清单在改权威数据前拒绝，不因包内内容自动授权覆盖。
5. **UI/自动触发**：首个手动备份/恢复入口放设置/工作区管理；**自动备份明确延期**（重新开放条件：手动闭环稳定 + 保留/清理/资源/错误反馈方案接受），不因本任务开启每日/每章后台备份。

**最小包/流程示例（虚构）**
`workspace-backup-<profile>-<utc>.zip` 含 `manifest.json`（tool_version/schema_version/app_version/files[{path,size,sha256}]/sensitive_excluded[]）、`db/ai_novel_studio.db`、`config/preferences.json`；排除 secrets/logs。恢复流程：选包→读 manifest/完整性→兼容预检→选新 profile 或覆盖（二次确认）→保护快照→事务/切换→重开核对→失败回滚。
**验证方案**：虚构 fixture/隔离 profile 的备份→恢复→重开；坏清单、版本不符、中断、并发写入、缺文件负例；外部真实 Tauri 页面手动入口与进程/文件证据。真实作者数据操作需单独授权。

**CP1–CP4**：按接受后的契约实施；本节 done 不代表实施或数据操作获批。
