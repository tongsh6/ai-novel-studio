# 44 个完整正例

返回 [样例索引](../README.md)；

| 文件或目录 | 职责 |
|---|---|
| [01-statistics.json](01-statistics.json) | 统计直答，不读取角色或正文 |
| [02-discussion.json](02-discussion.json) | 讨论异常，不提前执行或声称已迁移 |
| [03-capability-gap.json](03-capability-gap.json) | 明确目标但能力确实缺失 |
| [04-explore-loop.json](04-explore-loop.json) | 读取正文→真实观察→再次判断 |
| [05-full-local-revision.json](05-full-local-revision.json) | 完整写作请求：情绪因果、只改目标段、候选待采纳 |
| [06-first_draft.json](06-first_draft.json) | 初稿 |
| [07-continuation.json](07-continuation.json) | 续写 |
| [08-rewrite.json](08-rewrite.json) | 整章重写 |
| [09-character_design.json](09-character_design.json) | 角色设计 |
| [10-character_evolution.json](10-character_evolution.json) | 角色演化候选 |
| [11-outline.json](11-outline.json) | 卷纲规划 |
| [12-world_building.json](12-world_building.json) | 世界规则 |
| [13-format-only.json](13-format-only.json) | 仅排版：输出边界换行计划，不让模型重抄全文 |
| [14-quality-review.json](14-quality-review.json) | 独立评审：发现不是canon，也不是修订授权 |
| [15-quality-unavailable.json](15-quality-unavailable.json) | 评审不可用，不能伪装零发现=通过 |
| [16-chapter_summary.json](16-chapter_summary.json) | 独立维护操作：chapter_summary，不捏造run/session/作者 |
| [17-fact_inventory.json](17-fact_inventory.json) | 独立维护操作：fact_inventory，不捏造run/session/作者 |
| [18-ledger_reconcile.json](18-ledger_reconcile.json) | 独立维护操作：ledger_reconcile，不捏造run/session/作者 |
| [19-chapter_mission.json](19-chapter_mission.json) | 独立维护操作：chapter_mission，不捏造run/session/作者 |
| [20-narration.json](20-narration.json) | 真实结果叙述，不把无关统计变成质量结论 |
| [21-plan-pair.json](21-plan-pair.json) | 同一响应成对计划工具；计划本身不授予执行 |
| [22-clarify.json](22-clarify.json) | 真歧义需要作者裁决，不猜对象 |
| [23-register-original.json](23-register-original.json) | 原文登记不重写；实际抽取范围仍需来源校验 |
| [24-directions.json](24-directions.json) | 内容方向不是保存/查看的流程菜单 |
| [25-profile-revision.json](25-profile-revision.json) | 作品立项字段候选，不直接写works |
| [26-partial-read.json](26-partial-read.json) | 部分观察只支持部分结论，保留续读游标 |
| [27-author-asset.json](27-author-asset.json) | 素材→创作参考；不推断长期偏好或自动canon |
| [28-author-adoption.json](28-author-adoption.json) | 作者明确采纳候选：真正系统事务回执 |
| [29-full-delegation.json](29-full-delegation.json) | 有效full委托→重新检查→自动采纳（目标设计） |
| [30-revoked-delegation.json](30-revoked-delegation.json) | 委托撤销：full模式不能继续写canon |
| [31-critical-confirmation.json](31-critical-confirmation.json) | Critical由系统门禁确认：模型提议不能充当授权 |
| [32-cancellation.json](32-cancellation.json) | 取消确认后结束；仅cancel_requested不能假称cancelled |
| [33-budget-stop.json](33-budget-stop.json) | 预算耗尽：明确范围，不假装读完 |
| [34-explicit-checkpoint.json](34-explicit-checkpoint.json) | 合法覆盖目标设计：摘要不是canon，未完成义务仍保留 |
| [35-retry-scope.json](35-retry-scope.json) | 有界重试的合法结果仍为原只读目标，失败原报文见negative目录 |
| [36-unknown-side-effect.json](36-unknown-side-effect.json) | 连接丢失不等于未执行；先对账再重试 |
| [37-truncated-output.json](37-truncated-output.json) | 流式截断：不执行半个工具调用或提交半篇候选 |
| [38-pending-revision.json](38-pending-revision.json) | 修订已有候选：新版本仍待采纳，不覆盖已采纳正文 |
| [39-author-reject.json](39-author-reject.json) | 拒绝与确认是作者动作，不是模型自填授权 |
| [40-paged-read-quality.json](40-paged-read-quality.json) | 分页读取→精确覆盖合并→独立评审 |
| [41-untrusted-reference.json](41-untrusted-reference.json) | 低信任内容仅为材料，不进入系统指令 |
| [42-quality-author-revision.json](42-quality-author-revision.json) | 独立评审→作者选择发现→局部修订候选（无自动采纳） |
| [43-steer-goal-version.json](43-steer-goal-version.json) | 作者明确改方向：保留旧讨论、新goal版本与新原话，不复活旧授权 |
| [44-pause-resume.json](44-pause-resume.json) | 暂停回执后，作者恢复并发出新问题；无自动修改与伪造作者消息 |
