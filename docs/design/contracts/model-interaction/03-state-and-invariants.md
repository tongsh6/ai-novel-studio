# 状态转换、运行时不变量与证明边界

## 1. 分开维护的状态机

| 对象 | 状态与允许迁移 | 明确禁止 |
|---|---|---|
| Provider attempt | created→started→streaming→completed/tool_calls/incomplete/refused/failed/cancelled；取消先request后ack | 用partial arguments执行；在终态后重新开始相同调用 |
| Tool call | proposed→schema_validated→gate_allowed/denied/confirmation_required→executing→succeeded/failed/unknown | schema_validated即写入；修改原call_id把失败抹掉 |
| Agent run | created/running/pausing/paused/awaiting_author/cancelling/completed/failed/cancelled，沿现役run状态机 | 结束一次Provider就完成全目标；等待时无作者回答强行继续 |
| Creative artifact | 模型原文→系统物化TENTATIVE→作者决定或有效委托→ACCEPTED/拒绝/撤回，依现役AdoptionStatus | 模型直接输出ACCEPTED使之成为事实 |
| Canon写入回执 | not_attempted/not_written/committed/rolled_back/unknown | unknown改成false；只凭内容生成成功推定committed |
| Delegation（提案） | 作者签发→在scope/time/version内有效→撤销/到期；写前再次检查 | prompt里的旧授权复活；全局full覆盖所有作品 |
| Checkpoint | 真实覆盖选择→完整校验→原子追加/commit→后续投影消费 | 先删消息再记checkpoint；覆盖活动问题或半组call |

author_action产生新的授权边界；是否延续同run/新子run按现役AuthorActionAdmission/ConfirmationBinding，而不是在本离线协议新增run调度器。

## 2. 核心跨字段不变量

| ID | 要求 | 本包能证明的部分 / 生产额外要求 |
|---|---|---|
| P01 来源分离 | Base/作者/模型/观察/系统状态区分 | JSON字段和样例引用；真实存储身份仍需端口验证 |
| P02 原文保真 | 作者原文与目标外正文UTF-8不变 | hash、段字节范围、合成替换结果；真实I1/N-NARR由仓库门禁 |
| P03 观察存在 | 真实call→tool_result→后续请求 | fixture中call/result配对、无伪Observation；实际工具执行要原生日志 |
| P04 used refs | 使用声明仅能来自实际可见Base/Observation | 集合包含；“真正理解并使用”不能只靠声明 |
| P05 版本覆盖 | 同版本连续页才能合成完整正文 | 对象版本、区间连贯；数据库并发快照另证 |
| P06 权限不是风险 | 先隔离/合法性，再风险 | 错work/目标负例；真实身份来源不能自报 |
| P07 模型无采纳权 | 模型只提交候选/建议 | 系统字段拒绝、forbidden工具；真实dispatch不可绕过Gate |
| P08 授权后也重门 | 目标/effect/版本/预算/委托仍有效 | 样例对账；写事务中的并发撤销/TOCTOU需集成测试 |
| P09 已写必须有回执 | 改Canon要版本推进、事务回执、合法决定 | fixture一致性；实际commit和rollback必须DB取证 |
| P10 不知即未知 | lost response不能当未写 | unknown/null/reconcile_before_retry；实际幂等读取接口要实现 |
| P11 全语义预算 | Provider/工具/重试分别扣减 | request零预算拒绝；生产原子扣减、包括错误重试全部算入 |
| P12 可见字节来源 | 模型字段精确投影，系统状态独立 | pointer/hash和已知ref泄漏检查；任意隐式标识/文学内容需更强语义门 |
| P13 事件因果 | sequence单调，cancel ack，终态不再产正文 | fixture事件序；乱序网络缓冲/重连重放须产品验证 |
| P14 文学与形式不同 | 情绪状态/因果/评审证据不等于评分通过 | Shape校验+原句存在；独立实模/人工盲评 |
| P15 来源不可升权 | 外部素材不是system，不自动canon | 字段/projection检查；注入防御实模对抗另测 |
| P16 历史连续 | 真实义务/作者意图跨轮保留 | 覆盖引用+未答集合；摘要语义正确性不由JSON保证 |

## 3. 几类必须有的时间线

### A. 同一次作者回合内读取后继续

作者输入 → 模型explore工具调用(call1) → 系统只读成功 → tool_result(call1, observation1) → 同回合下一次模型请求包含这一观察 → 回复或提出进一步执行。作者原文只在其因果位置出现一次。错误/部分读取同样回流，不能编造complete。

### B. 写作—评估—修订—采纳

作者目标 → Writer submit_tentative_artifact → 系统物化候选 → evaluator读取同版本候选和design brief → report_quality_findings → 作者选择finding与修订范围 → Writer生成sibling候选并记录revision_base → 作者接受或拒绝 → 已有AdoptionWorkflow更新Canon并返回版本回执。evaluator不得顺手改正文。

### C. Critical确认

模型建议 → 身份/对象/能力/版本合法 → 系统判定critical → 绑定对象/版本/effect/后果的真实确认 → 作者confirm/reject → 再Gate → 执行或停止。不能让作者确认一个不存在的删除能力。若候选还没生成，确认不等于未来所有生成文本自动采纳。

### D. 暂停、引导与恢复

pause是Agent控制，不需要另调模型“同意暂停”。到安全点提交真实状态；resume读取同run/目标/权限版本。steer产生有来源的新goal.version，旧计划依赖需标失效再规划，旧作者授权不能自动覆盖新目标。题目/确认通过question/confirmation ref精确绑定，不答错旧题。

### E. 取消与未知写入

cancel_requested→运行监督发停请求→实际确认cancelled；如果工具或采纳事务可能已提交，独立先查回执。可以出现Provider已取消而Canon已先提交，必须按不同事实如实展示，不可用一个cancelled覆盖所有后果。

## 4. 错误分类和恢复动作

| 错误族 | 例子 | 合法恢复 |
|---|---|---|
| 数据/Schema | 未声明字段、畸形JSON、不完整SSE参数 | 原call_id校验结果、有界纠错，不扩大目标 |
| 证据不足 | 未读全文、部分分页、stale | 只读补足或明确缺口，不硬生成 |
| 能力/授权 | 无effect、存在但不可用、跨作品 | 区分gap/deny/confirmation，不用近似操作冒充 |
| 人工裁决 | 同名目标、方向选择、critical | ask_author/确认机制；作者未回答则等待 |
| Provider | 拒绝、超时、连接断、截断 | 保留真实状态；不能把失败改“质量已通过” |
| 持久化 | 版本冲突、幂等冲突、事务失败 | rebase/reject/原子回滚；未知先对账 |
| 预算 | tool/provider/retry用完 | 停止、诚实已覆盖范围；扩预算需用户事实 |

## 5. Schema不是安全证明

本包JSON Schema验证类型、枚举、分支与部分shape；verify.py进一步验证有限的跨对象、来源、范围和结果关系。它不能识别所有语义谎言，不能证明真实user身份，不能测试实际授权撤销竞争，不能确保自然语言讨论一定不触发执行。所有这些仍是生产门禁/实模验收义务，禁止以离线PASS关闭对应工程任务。
