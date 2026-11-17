# ADR-0036：同源流式接管与只读 Markdown 展示

- 状态：Accepted（2026-11-17 作者批准方案并授权开工；实现/验收状态见 B87 §14.10）
- 责任层：作者可见事件投影、前端运行投影与只读内容渲染
- 上位目标：[愿景](../00-vision-and-engineering-roadmap.md)、[UI 46 §9.5](../ui/46-state-and-feedback.md#95-文档流化移除常驻计划面板与卡片容器2026-07-15-用户拍板)
- 实施归属：[B87 §14.10](../../../tasks/slices/B87-model-interaction-request-projection.md#1410-流式内容保真同源接管与-markdown-展示2026-11-17)

## 问题与独立判据

作者应只看到同一次输出的一份内容；内容生成时可连续阅读，交付后保留最终回复，独立过程仍可回查。标题、中文强调、列表、引用、表格和代码块应呈现为可读结构，而不是语法符号。保存的作者原文、Provider 原文、canonical、正文及导出不因渲染改变。

真实三轮反例见 B87 §14.10：Provider 原始增量含纯空白，但摘要校验忽略了整条事件，导致 WebSocket 丢换行；流式副本和最终文字随后被两个位置展示。按文字去重只是在掩盖两个独立缺陷。

## 决策

1. **内容与摘要分责**。ProviderActivityProjector 的 chunk summary 是结构事实，不复用增量正文。author_narrative_delta/author_content_delta 保留所有非空原字节，包括纯空格、换行和缩进。AgentRunServer 的非空摘要规则不放宽；事件 schema/身份/传输主链不变。
2. **按来源交付接管**。复用现役 trace_summary.reply_record.provider_call_ref、agent_run.run_id 与事件的 Provider 来源。已交付回复只接管同 run、同调用的临时叙事；不等整个 run 终止。其它调用/运行即使文字相同也必须保留。没有来源证明不能猜测为同一输出。退役文本相似/空白归一去重及相邻同文本折叠。 以既有 response_kind=plain_text 为资格；structured_tool 的字段与公开文本是不同通道，不按同调用整组隐藏，独立过程仍保留。
3. **唯一只读渲染边界**。前端首次引入 Streamdown 2.7.1 与 @streamdown/cjk 1.0.4（npm 实际元数据、React 19 peer 已核对）。新增一个薄 MarkdownText 组件，供助手讨论/独立过程叙事共用；不拥有 WS、数据库、运行状态或采纳。作者输入及小说正文继续遵循原始文本/正文排版契约。
4. **临时补全不回写**。只有实际生成中的内容使用 streaming/incomplete 模式；完成、取消及历史读取按收到的原文静态解释。模型私有思考不进入此组件。组件不改写输入、不把解析产物存回消息。
5. **安全与桌面边界**。不执行 HTML/MDX；保留 sanitizer。拒绝危险协议与自动外部图片。当前没有已授权的桌面外链打开 owner，链接以可读文本及 URL 展示，不让 WebView 导航或执行自定义协议；不为本任务再引入外链插件/跨平台命令。禁用库的下载/复制/全屏控件，避免旁路桌面 IO。代码块、表格局部横向滚动，不撑宽工作台。
6. **比例适度**。不引入 AI SDK、编辑器、第二消息模型、额外 Provider 调用、Mermaid/数学/高亮插件或验收专用产品 hook。Streamdown 默认通用行为不代表本产品安全策略。

## 已有实体与消费者审查

| 已有 owner | 裁决及当前消费者 |
|---|---|
| ProviderActivityProjector / AgentRunServer | 只修结构摘要与增量载荷的责任混淆；现役 stage sink/WS 为消费者 |
| TraceWriter / reply_record | 已持久化调用身份；不增加 MessageID、事件或事实表；前端正式消费既有调用绑定 |
| agentRunTimeline | 收敛来源接管与独立叙事保留；WorkspaceChat 为真实消费者 |
| WorkspaceChat / agentEvents | 保留唯一事件视图；流式到交付只改变呈现所有权，不另存文字副本 |
| MarkdownText（新增） | 全仓未有 Markdown 渲染 owner；仅解析、样式及安全展示，有上述两个即时消费者 |
| 46 §9.5 / tech-stack 04 / 本 ADR | 分别负责可见效果、依赖及架构裁决，不平行建立新设计/任务树 |

## 替代方案

react-markdown + remark-gfm 能动态更新，但需另行承担不完整流式语法；此项目已有流式中文消费者，选择 Streamdown。自写正则解析、dangerouslySetInnerHTML、全局删除空白、run 终态后一刀切隐藏所有过程均不采用。

## 验证

预注册独立输入覆盖纯空白 chunk、分段中文强调/列表/表格/围栏、同文本不同调用、同源交付但 run 仍在维护、取消无交付、重放与恢复。安全反例覆盖脚本/事件属性、javascript/data/file/custom 协议、远程图片、恶意 HTML。组件/单测不能代替真实 Tauri 工作台入口的外部验收。原失败保留，不改变 R03 其它场景的输入、阈值或结论。

## enforced_by

- `apps/novel_application/lib/novel_application/provider_activity_projector.ex`
- `apps/novel_application/test/novel_application/provider_activity_projector_test.exs`
- `frontend/src/lib/agentRunTimeline.ts`
- `frontend/src/components/WorkspaceChat.tsx`
- `frontend/src/components/WorkspaceChat.agentRunTimeline.test.tsx`
- `frontend/src/components/MarkdownText.tsx`
- `frontend/src/components/MarkdownText.test.tsx`

## enforcement_gaps

开工时本决策尚未实施、未验收；进度、证据与最终处置仅在 B87 §14.10 维护。Accepted 表示作者已批准目标与方案，不代表功能完成。
