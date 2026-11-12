# B86 · 模型材料与返回结构化：内部标识泄漏（历史任务、范围已归并）

**状态**：**superseded（2026-11-13 任务责任归并；原问题**未解决**，禁止以 superseded 冒充 done）**。

> **唯一后续执行与验收归属**：[B87 R06](B87-model-interaction-request-projection/R06.md) / [B87 唯一任务状态源](B87-model-interaction-request-projection.md)。架构契约：[VS-00M §5–6](../../docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md)。B86 不再作为独立排队任务，不维护重复 checkpoint 或执行状态；保留为历史失败问题/作者裁决与迁移映射入口。

## 1. 已发生的产品问题（不得销账）

B81 CP5 真实 Strata 批次 `cp5-real-05` 的作者可见页面出现内部标识 `chapter:<uuid>`。已登记的 AX/text 证据中有 20 次标识命中：模型自然叙事把 `chapter:...` 当作正文可复述内容，观察回执也以内部编号称呼章节。另一真实场景 `b82-g2-observed-target-04` 表明判断器的原生工具参数 `reason` 可夹带内部 ref，并逐字进入作者可见创作活动。

根因不是单纯显示组件缺少过滤：
- 章节列表 `ChapterListBudget.entry_line` 等把内部 `chapter_ref` 与标题/正文文字拼入同一叙事段；
- Native Tool Calling 虽有 JSON Schema，但作者可见 `body/prose/reason` 未有明确禁止内部标识的语义校验；
- `JudgmentProtocol.tool_narrative` 使用模型的工具字段作为作者可见内容；若直接在 UI 后处理，破坏 I1/N-NARR 字节来源契约。

原实现尝试 **`2785c2c9` / `36fe5c52` 已撤销**（revert `3a084fcf` / `72f8fb7d`）：不能以“之前写过”认定当前 HEAD 已实现或获证。

## 2. 为什么转入 B87，不再两套任务并行

B87 的根目标包含请求语义/材料来源、原生模型工具输出、系统验证和作者可见面。B86 的 C9 问题恰好贯穿这条主链，单独维持 B86 状态会形成两个任务同时修改同一 RequestIR/Prompt/ToolContract/Visible consumer 的双归属。

**本次属于任务责任迁移**，而非功能取消或降级。B87 R06 对以下后果承担不可减少的完整 DoD：
1. **模型输入结构化**：内部 ref 只位于专用引用字段，自然语言摘要/章节标题不夹裸 `chapter:<uuid>`；仍可用真实 ref 调用工具。
2. **返回字段校验**：模型写给作者的文本含内部标识 → 同一 call_id 的验证失败、反馈与受界重试；不让应用改写原文以伪造干净输出。
3. **作者可见单字段字节因果**：`AgentNarrativeSource`、`NovelCommon.AuthorVisible.Text`、I1/N-NARR 同源；系统状态另由系统来源给出，不参与模型字节等价。
4. **真实页面 + 实模**：以 `cp5-real-05` 和 `b82-g2-observed-target-04` 作为回归正反例；真实工作台可见标识命中必须为 0；工具标识仍能完成正确业务定位。
5. **无新平行过滤/事实源**：必须先审查现存实体，尽量复用现有 RequestIR/ToolContract/Presenter，不新建隐藏式 UI 文本过滤器。

## 3. 已记录的用户与设计决策

- 对话工作面必须让作者看到小说语言而不是软件内部 ID；
- 模型材料/工具输出应当结构化，保持 Ref 与可见文案的源头分离；
- 模型原生叙事字段的作者可见字节保持不变（N-NARR）；不做展示层后处理字节替换；
- 用户 2026-11-13 授权彻底重审设计/任务；项目未发布、不做旧接口兼容、不新增未经存在性审核的实体；
- 方案仍在 VS-00M Proposed/未来 R00 核验阶段，**不能将此任务的历史意图冒充已完成实现**。

## 4. 验收/恢复入口

- 实施唯一入口：[B87 R06](B87-model-interaction-request-projection/R06.md)，与 R02（结构化请求）、R07（工具校验）、R19（最终实模/原生验收）关联。
- 测试应保留原 B81/B82 失败记录并在有效当前 HEAD 运行同类真实页面场景；不能仅通过静态扫描或人为删掉 ID 文本宣告通过。
- B81 的历史任务文档可保留“当时由 B86 跟踪”的事实，当前责任以本页和 B87 为准。无新的 B86 状态/任务批次。
