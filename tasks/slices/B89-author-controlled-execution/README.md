# B89 · 单次 AI 编码会话执行约束（A01–A08 共享）

> 本文件没有执行状态；唯一状态源是 [B89 总任务](../B89-author-controlled-execution.md)。共享设计仍为 [VS-00M](../../../docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md)，不另建一套授权契约。A01–A08 对应原 B87 R09–R16，旧编号只用于追溯。

任务卡：[A01](A01.md) · [A02](A02.md) · [A03](A03.md) · [A04](A04.md) · [A05](A05.md) · [A06](A06.md) · [A07](A07.md) · [A08](A08.md)。各卡目标及依赖见总任务的批次映射。

## 1. 开工与范围

每批以本 README + 当前一张 Axx 卡启动独立会话，自行读取仓库原文与真实消费者。先核 B89 当前状态；deferred 期间不得因卡片存在或 B87 批次已结束自动实施。

1. 核最新分支、HEAD、工作树与他人 WIP，读取 AGENTS.md、tasks/README.md、tasks/NEXT.md、项目画像、B89 总任务、当前卡、必要前置与 Frozen 契约。愿景 → 元原则 → 设计 → 任务规划 → 实现；不以现役代码或既有测试自动证明设计正确。
2. 回答 Contract/Invariant/Boundary/Consumer/Proof/Acceptance Driver/Exploration 七问；逐一列新增模块、字段、表、Schema、工具、事件和配置的现存等价物、真实消费者及 reuse/refactor-and-retire/truly-new/reject 裁决，无新增也写 none。
3. 固定可触及/禁止触及范围、原始失败、验收判据和恢复点；产品语义与 Frozen 冲突先裁决，不用本任务迁移或旧实施授权替代尚缺的模式/委托/采纳决策。
4. 真正实施前运行 `bash scripts/task_done.sh --begin artifacts/slice-verify/<本批唯一目录>/scope.json --task tasks/slices/B89-author-controlled-execution/Axx.md`；替换实际目录与卡号。不得追造 scope，也不得借 B87 原 scope 签新任务。

## 2. 实施与保护边界

- 项目未发布；按实际范围迁移所有现役消费者并删除旧 API/字段/配置/适配和无消费者测试，不做双写、dual parse 或 legacy fallback。保留作者真实内容、原始证据及必要错误恢复/事务回滚。
- SRP/SoC、单向依赖、DRY/KISS/YAGNI 与适度工程落实到真实消费者；Elixir 复用纯函数、模块组合与 behaviour，不因“授权治理”新建包办一切的中心或复制现有风险引擎。
- 能力 effect、权限、风险、版本、来源与回执保持唯一权威事实。越权/跨作品先拒绝，合法高风险才进入确认；模型不得签发授权。
- full 模式仍需独立、有效、绑定对象和范围的作者委托；写入前重验目标/版本/预算/撤销/到期并经现有采纳事务。现有人工确认与采纳权威不因本任务新功能而放宽。
- Prompt、UI 展示、模型建议和测试替身均不能代替实际 Gate、数据库结果与系统回执。必要正文、事实与专业创作材料不能为缩 Token 被截断。

## 3. 验收与交付

遵循 [quality-gates](../../../docs/engineering/quality-gates.md)、[AGENTS](../../../AGENTS.md) 与当前卡的完整适用门禁；复用现役 scripts/quality_accept.sh、scenario_invariants、真实外部 Tauri/Provider 驱动及任务完成扫描，不复制另一套验收框架。

- 同批交付真实首个消费者、异常/负例/并发/版本/撤销/恢复、所有受影响消费者迁移、旧入口删除和必要文档/测试/代码；不能把必要验收甩给下一批。
- 后端权限/采纳变化也须从真实工作台入口取证；模型行为有原生 Provider 原件，确定性测试只证明机制。三个 wire、I1/I2/I3/N-NARR/I-CACHE 及前端检查按实际影响执行。
- 所有本批源码完成后，以开工时的真实 scope 执行完整 `bash scripts/task_done.sh --scope "$TASK_SCOPE"`（TASK_SCOPE 指向本批开工记录）；有 UI 变化按规范关联真实 slice/ui-binding。不可手造结果、使用 skip/quick 代签或把无 scope 扫描当完成。
- PASS 必须有完整本卡证据、适用工程门禁与可回溯提交；任一必选缺失为 FAIL/BLOCKED，保留失败/缺证和恢复条件。工程通过不自动代签模型、文学质量或页面。
- 报告分支/完整 SHA/WIP、七问与查重裁决、实际变化、负例矩阵、命令/退出码、原件路径及未闭环后果；状态只回写 B89 总任务。NEXT 仅实际调度改变时更新。

A01–A08 局部 PASS 之后，还须完成 B89 总任务 §4 的自身清理和最终集成验收；B87 R17–R19 的证据不能代签本任务后续新增功能。
