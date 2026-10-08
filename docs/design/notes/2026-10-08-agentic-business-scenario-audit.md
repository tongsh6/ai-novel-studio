# 从作者使用场景审计 Agentic、App 与业务闭环

> 日期：2026-10-08；代码基线：`08cfe014`。
> 用户要求将重点从超时/参数调整转向使用场景与代码正确性。
> §§1–5 保留审计时事实；后续修复状态见文末追记，不能将历史反例视作当前修复结论。

## 1. 结论

当前短会话正常路径成立，但不能据此认为业务闭环完整。主要问题是**操作语义、来源校验、
业务状态真源和真实入口身份关联没有完全接通**。即使模型更快返回，仍可能生成错误候选、
丢失未完成事项或重复启动处理。

现有 AgentRun 的判断/探索/计划/执行机制确实存在；问题不在于“有没有循环”，而在于模型
选择的动作是否符合作者业务目标、App 是否拒绝非法组合，以及下一轮和恢复页面是否看到完整业务事实。
本次没有引入第六账、通用义务机或新框架的依据。

## 2. 场景对账

| 作者场景 | 应有行为 | 当前证据 | 判断 |
|---|---|---|---|
| 提供资料，明确先记录、不存档 | 保存消息，不创建候选或作品事实 | Q1b 当前 Qwen 实模第 1 轮 | 已通过该正常路径 |
| 下一轮要求原文存档，来源完整 | 引用原消息字节，先候选、后作者采纳 | Q1b 第 2 轮与 q3d 正常场景 | 已通过该正常路径 |
| 登记信号为真，但来源缺失 | 停止物化并要求补足来源，不能猜成当前指令 | 本次真实页面负例 | **失败：指令本身成为候选正文** |
| 模型同时说登记原文和执行创作 | App 拒绝互斥组合或要求重新判断 | 本次生产解析器局部反例、分发代码 | **接受矛盾组合，执行路径绕过原文登记** |
| 暂不采纳，继续对话 20 轮后刷新 | 未处理候选仍在工作台待办中 | 本次外部真实页面负例 | **失败：恢复 pending=0** |
| 更长会话后问还有什么未处理 | 基于完整待办状态，预算只影响展示 | 独立库局部反例 | **80 条窗口外的候选从 Agent 投影消失，omitted=0** |
| 采纳前后追问是否已保存 | 回答与实际事实一致，不能因 run completed 就称已入档 | Q1b 第 3/4 轮、只读 SQLite 事实检查 | 已通过该正常路径 |
| 发出后断线、回执丢失再重发 | 同一消息身份复用，回执/结果可恢复 | 实际页面网络帧与前后端入口代码 | **端到端身份未接通；尚未做丢包页面故障注入** |

Q1b 四轮八次真实调用的通过，只证明这些输入和状态组合；不覆盖上述缺字段、矛盾组合、
长会话和交付故障。之前 Q3d 的 done 口径因此需要收紧为“正常路径已验证，反例收口未完成”。

## 3. 已确认的问题

### BIZ-01 / P1：来源缺失被解释成“当前消息”，可把保存指令当作正文

- 入口：`judgment_protocol.ex:280` 的来源白名单允许 nil。
- 落点：`turn_interaction_service.ex:121` 的 `source_text(nil, ...)` 返回当前消息及当前 turn。
- 后果：`dialogue_planning_service.ex:739` 接受这个结果，机械物化为候选。

实际页面先输入资料，再要求“把上一条资料原文保存为作品设定”。只在现有 test/support
提供者里把来源字段设为 JSON null，登记信号保持 true；生产代码及原页面断言未改。
页面最终显示的候选正文就是 **“把上一条资料原文保存为作品设定。”**，来源也指向保存指令的 turn。
外部 driver 在字节断言处失败，尚未点击采纳，没有把错误候选写成作品事实。

这违反 ADR-0027 D4 的“缺失/不明确来源不得回退保存指令”。候选字段可以格式合法、字节来源也确实
是某条作者消息，但仍完成了错误的业务动作。原文字节不变量需要与**正确的业务来源**联合验收。

修复方向：启用登记时来源必须显式成立；只有明确的 `current` 才表示当前原文。缺失来源走
可恢复失败/澄清，不能由 App 猜测；继续保留作用域、来源白名单与字节复制约束。

### BIZ-02 / P1：原文登记与创作执行缺少跨字段业务互斥

局部反例向当前 `JudgmentProtocol.request_judgment/3` 提交：

```text
action=execute
capability=world_building
author_content_registration=true
author_content_source_ref=已列出的历史来源
```

解析器返回成功。`dialogue_planning_service.ex:677` 的 execute 分支直接切到创作 profile；
原文物化只在 reply/await_author 的 finalize 分支里执行（`:692`、`:739`）。因此登记信号
与实际派发可以脱节。这里确认的是解析/分发缺口，未声称本次已完整跑过错误创作并采纳。

另有真实 Q1b 证据：call1 对作者说选择“单动作执行、设定整理能力”，call2 最终却选择原文登记。
代码中也存在直接冲突：`judgment_protocol.ex:619` 要求无候选时单动作执行，`:676` 又规定
作者原文登记必须 reply/capability_gap；一般映射仍要求照 call1 的形态词填 action。

修复方向：先定义并校验业务操作合法组合，再分发。可以先保留现有字段和接口补联合校验，不要求立即扩 action 枚举或增加框架。原文登记必须走保真路径，不能同时切入
创作重写；call1/call2 消费同一套业务规则。面向作者的“拟做什么”和最终实际操作须有一致性或
明确的修正反馈，不能只要求第二次模型自行消解矛盾。

### BIZ-03 / P1：聊天分页/上下文预算被当成业务待办状态

- `work_session_service.ex:13–34` 仅从最近 30 条 transcript 生成恢复用 pending/resolved。
- `interaction_lifecycle.ex:12,60` 仅取最近 80 条 Interaction 后再计算 Agent 的 pending/resolved。
- `turn_interaction_service.ex:82` 的 omitted_adoptions 只计算这个已截断集合的展示裁剪，
  不反映被 SQL 窗口丢掉的未处理事项。

独立库反例的观测：

| 时点 | UI 恢复 pending | Agent pending | 数据是否仍在 |
|---|---:|---:|---|
| 初始一份未采纳候选 | 1 | 1 | 在 |
| 后续 32 条交互 | 0 | 1 | 在 |
| 后续 84 条交互 | 0 | 0，提示 omitted=0 | 全量 Channel 恢复仍能取到候选 |

真实页面也已复现：正常创建候选，保留未采纳状态，通过输入框继续对话 20 轮，然后刷新。
恢复接口返回 transcript=30、has_more_before=true、pending=0，原候选不在恢复待办中。
加载更早聊天可能重新带回候选，但**业务待办不应由用户展开了多少聊天决定**。

Agent 的探索目录（`exploration_service.ex:34–58`）覆盖正文、章节、作品档案、治理记忆，
没有会话原文/待采纳事项的检索面。超出上下文预算后，目前也缺少按需找回这类对象的明确路径。

修复方向：完整业务状态先由 App 计算，聊天分页和模型预算只裁剪展示；保留稳定对象引用、
真实省略数量及按需查询入口。优先复用既有对象/投影，不因此引入通用义务账。

### BIZ-04 / P2：服务端消息幂等没有接到真实 App 入口

`WorkspaceChat.tsx:2051` 创建 clientMessageId，但只用于本地显示/运行锚定；
`socket.ts:55` 的 sendMessage 没有把它或 turn_id 发到服务端。
`workspace_channel.ex:202` 在缺 turn_id 时为每次请求生成新 turn。

Q1b 的四个真实 user_message 网络帧中，携带 turn_id 的为 0，携带 client_message_id 的也为 0；
四个 ack 均由服务端返回新 turn_id。现有服务端“相同 scope/turn 去重”的局部正确性，
因此不能作为断线重传端到端已闭环的证明。并非要求把作者主动发出的相同文字都合并。

修复方向：为一次发送建立稳定业务消息身份，传输重试复用、作者新输入另建身份；同时检查
`agent_run_service.ex:59` 的重复回执复用，确保已失败/已完成/重启后无 runtime 的请求返回真实状态，
不让前端仅凭 run_id 构造新的 running 表象。后半项是待验证风险，不记为本次已复现的重复写入。

## 4. 模型、App、UI 各自应承担什么

- **模型**：理解作者意图、选择资料来源和下一步业务操作、解释/生成创作内容；可以提出计划与探索请求。
- **App**：提供真实业务能力与状态；校验来源、目标、动作组合和权限；执行与记录确定性结果。
  用户未采纳就不能写 canon、未知来源不能默认换成另一条消息、未完成候选不能随聊天窗口消失。
- **UI**：区分运行结束、候选待确认和正式入档；提供能完成当前诉求的真实操作，保留稳定发送身份及恢复入口。

原文登记是 App 的一个实际业务操作，不能只作为“普通回复额外带一个布尔位”存在，而没有联合前置条件。
“不能由 AI 自动采纳”也应与“App 不具备保存能力”区分。现有机制可以继续复用，先收口操作语义和后置条件。

另一个需要明确的产品边界：当前原文登记整条消息，并固定生成 world_setting；这符合 Q3c 的最小约定，
但不能外推为已支持任意片段、角色档案或章节正文的原文登记。扩展这些使用场景前，应明确保存对象与落位，
避免把聊天指令当创作资料、把所有作者资料都当世界设定。本次不把未承诺能力标为已实现，也不自行扩大范围。

## 5. 已成立的部分与建议顺序

已成立：输入先记录再 ack；成功结果先落库再发布；作者采纳是 canon 写入门；
消息处理完成与入档状态分开；正常历史来源按字节物化；弃置不等于已采纳，原文可重新提案。
其中最后一项本轮为代码复核，未新增真实页面放弃矩阵；Q1b/Q3d 正常页面证据继续保留。

下一步先修 BIZ-01/02 的原文登记业务边界，再修 BIZ-03 的完整待办投影，最后补 BIZ-04 的
真实入口身份/重试矩阵。每步都回到“来源缺失/矛盾、长会话、采纳/放弃、重发/刷新”这些用户场景验证。
不以调超时、增加上下文或换模型作为业务正确性修复。

## 6. 证据与诚实边界

- 局部反例：`artifacts/project-analysis/agentic-scenario-audit/local-repro.json`、`local-repro.log`；
  独立 SQLite 分区，Sandbox 事务结束后回滚，未调用真实模型。
- 原文来源真实页面负例：`artifacts/slice-verify/q3d-message-outcome-roundtrip-tauri-audit-missing-source/`。
- 长会话真实页面负例：`artifacts/slice-verify/q3d-message-outcome-roundtrip-tauri-audit-long-session/`，
  含 `long-session-resume.json`、`ui-frames.json` 和 `external-ui-failure.png`。
- 临时改动分别限于 test/support 提供者与外部 driver；差分存于审计证据目录。已恢复源文件并重新编译；
  `git diff -- apps frontend` 为空。既有正常 q3d 证据已归回原目录。
- 消息身份取证：同审计目录 `message-identity.json`，来自 Q1b 实际页面网络帧。
- 页面负例启动 Tauri，并由外部 Playwright 操作同一真实 App/WorkspaceChat；确定性异常响应
  只用于验证 App 边界，不代表真实模型出现该错误的概率，也不是原生 WebView 内部驱动。
- 前面的参数对照在用户纠正重点后停止，样本不足，不作为方案裁决。试跑超时修正仅属于临时
  测量客户端；探针代码已撤出工作树，未改变生产 HTTP 超时或模型配置，快照保存在审计证据目录。

以上是业务正确性审计，不是修复完成报告。静态扫描通过也不能覆盖这些场景性缺陷。


收尾检查：`mix compile`、临时测试代码恢复后的 `MIX_ENV=test mix compile`、
`node scripts/next_task_check.mjs`、`git diff --check` 均通过。
`bash scripts/ai_static_scan.sh --top 10` 完整扫描为 17 PASS / 2 既有 FAIL，
3 条已有处置、0 touched、0 blocking。剩余项：Pencil fileToken 为 false_positive；
其他分支历史 config 为 accepted_risk（由原维护方处理凭证/历史）；ChapterSummary 嵌套为 deferred
（下次修改解析器时处理）。本轮没有新增静态问题需要修复，但本文业务缺陷仍未修复。


## 6. BIZ-01/02 修复追记（2026-10-08）

用户认可顺序后实施首个 checkpoint：来源必须显式成立；登记与创作执行联合校验；
两阶段共用原文/采纳规则。解析提供一次定向纠正机会，派发前复核，失败沿 AgentRun 现有
生命周期保存并回填输入；没有新增义务账、动作枚举、生产 UI 钩子或超时参数。

`q3d-author-registration-guards` 已从真实工作台输入三种异常响应，确认无候选、无创作派发、
无作品写入，刷新保留失败；第四次请求经模型纠正后引用原文，作者采纳才形成唯一 CONFIRMED。
错误响应只由 test/support 提供；Tauri 已启动，外部 Playwright 驱动实际 App/WorkspaceChat 页面，
并非直接操作 native WebView。此证据验证 App 边界，不代表重新完成 Qwen 的自然语言质量验收。
BIZ-03/04 仍未闭环，下一 checkpoint 为完整待采纳业务状态；实施与门禁记录见 Q3D slice。


## 7. BIZ-03 完整业务状态修复追记（2026-10-08）

待采纳/已解决候选现由持久化层同一投影汇总，独立于 UI 的 30 条聊天分页和 Agent 的 80 条
近期消息窗口；同 artifact 去重、终态覆盖旧 pending。上下文仍只展示每类 12 项，但提供真实
总数与省略数，超出部分可经 session_adoptions 工具按可信会话作用域检索/分页。

页面恢复还必须携带候选所属回合的 available_actions：仅补候选列表会使旧卡片没有可用操作。
新增 pending_adoption_turn_results，由 TanStack Query 按作品/会话缓存；前端复用原授权动作，
不将旧候选回合塞回最近聊天页，不绕开后端采纳检查。

完整验收 `q3d-long-session-adoption-state` 已通过：15 份候选、45 轮后查询采纳、再 45 轮终态恢复及作品隔离均成立；完整门禁见 Q3D slice。仍保留 BIZ-04 的真实发送身份与重传缺口。


## 8. BIZ-04 投递闭环追记（2026-10-08）

主消息及运行中引导已接通本机持久投递身份；同身份重传复用原运行/目标版本，回执消费真实
状态和落盘结果。外部代理实际丢弃回执、断连、刷新和重启测试服务后，原输入与运行均不重复；
引导版本保持 2。明确拒绝时原文留存且不会自动重试。Q3D 反例收口已完成，完整证据见 Q3D slice。
下一步 Q1b 对当前 BIZ-01–04 版本进行真实模型语义回归，仍不进行超时参数优化。


## 9. 当前版本实模复验：BIZ-05（P2，未修复）

代码 77bf8389；Qwen 四回合九次真实调用，原文/采纳/刷新数据链通过，但整个业务语义验收未通过。
证据与完整边界见 Q1B slice，不能把自动脚本 PASS 外推为所有输出都符合作者要求。

| 场景 | 实际输出 | 问题 |
|---|---|---|
| 仅记录资料，暂不生成候选 | public narrative 声称不生成；call2 声明 meta_discussion 却给 3 个方向，App 改判 creative_exploration | 显式输出约束没有覆盖所有候选类型，程序把多余候选升级为探索，而非核对矛盾 |
| 要求原文存档 | 真实 artifact 之外，采纳/修改/丢弃建议获得“设为后续方向”按钮 | 流程选项被错误授予创作方向选择动作 |
| 采纳后查状态 | 正确回答已保存，但“只读查看作品档案”也成为方向候选 | 操作建议与创作内容方向仍混在同一载体 |

已核实链路：

1. JudgmentProtocol 对 capability_gap 明确要求用 candidate_directions 携带最近路径；普通回复也允许方向。
2. DialoguePlanningService 的 judgment_exploratory?/judgment_reply_frame 根据候选非空强转帧；本轮原始
   meta_discussion / question_answer 被转成 creative_exploration，候选的业务用途没有被区分。
3. AvailableActionBuilder.candidate_actions 对任意非空候选列表发放 choose_candidate。
4. DialogueGateway 将这些条目默认映射到 work_direction；局部重放真实载荷中的“丢弃候选”得到
   “已将「丢弃候选」设为后续创作方向”，truthfulness.artifact_adopted=true，但 production_write=false。

本轮没有点击错误按钮写作品事实，不能声称已经污染作品；确认的是错误的可用动作和接受语义。
BIZ-01–04 的已完成证据仍有效；新增问题归 Q3D/BIZ-05，属于真实场景发现的新缺口。

修复方向：先明确“本轮仅记录”“创作方向”“协作/操作建议”的契约边界，再联动判断输出、
App 校验、available_actions 和 UI 消费。操作建议不得被当作创作方向采用，已有 artifact 的真实
accept/discard/edit 动作应准确承接；不能仅改中文文案、匹配关键词或隐藏错误结果。
同批补验收：首轮不允许 pending artifact 或 candidate_directions；状态/流程选项不得授予
choose_candidate；正常创作方向的讨论/采用与真正 artifact 的采纳/放弃/修改仍需回归。
登记轮发生一次 frame_type 纠正，现有守卫安全拦截后恢复；是否需要进一步解耦呈现分类与业务操作，
应结合上述边界审视，不能借本次观测放宽来源/写入保护。

证据：`artifacts/slice-verify/q1b-live-archive-roundtrip-tauri-lmstudio/01-source.png`、`02-save-request.png`、
`live-turn-results.json`；`artifacts/project-analysis/q1b-biz-operation-direction-repro.json` 及可复跑脚本。
