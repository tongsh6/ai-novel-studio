# B34 作者意图语料与验证覆盖（stage 运行日志 2026-06 起）

- 状态：pending / CP0 设计登记（2026-10-25，用户指令：从既有 stage 日志分析更多作者意图，完善验证体系）
- 类型：验证体系/意图覆盖（不新增产品能力；把真实历史作者意图沉淀为可回归的验证资产）
- 来源：`log/llm-calls/stage/*.jsonl`（2026-06-17 起，23 文件约 13MB）+ `log/app/stage/*.jsonl`（约 5.2MB）；另 P1 canonical/实模证据
- 关联：B26 单调用判断协议、B27 任务语义/调用矩阵、B33 动作意图有界纠错、P1-AUTHORING-DOGFOOD、D15

## 1. 目标

1. 从 stage 历史日志抽取**真实作者输入**（作者原话）与系统实际判断/执行结果（frame/action/capability/对象/结果）；建立意图分类与频次。
2. 与当前验证覆盖对照（`slice_verify` 判断 fixture、B26/B27 语义案例、AU/验收场景、B33 复验案例集），输出**覆盖缺口矩阵**。
3. 把高频/高风险真实意图沉淀为验证资产：确定性 fixture/test-support 分支、验收场景用例、真实模型 scoped case；不把日志做成一次性报告。
4. 只读分析历史日志，不改历史证据；不引入平行 harness/知识体系。

## 2. 日志事实与抽取口径（CP0）

- 格式跨版本：6 月为旧 planner frame JSON；7–8 月出现 profile router/判断器；10 月为 B26/B27 后新协议；抽取器需按版本兼容，不硬编码单一年份格式。
- 作者输入优先取 prompt 中 `## 作者输入` 块；无该块时取最后一条 user content 的短文本（≤阈值）并标注来源类型。
- 系统结果从 llm-call response（frame_type/action/capability/tool call）与 app 日志（judgment.decided/action/能力/对象）按时间/会话关联；无法关联的样本标 `outcome=unknown`，不猜。
- 去重按（归一化文本, 意图类, 结果）聚类；保留原文件/行号/时间戳溯源。
- 隐私/长度：只分析仓库内 stage 日志；长输入截断仅用于展示，语料保留必要上下文摘要。

## 3. 意图分类（初版，CP0 校准）

写章首稿/续写/重写；整章修订（排版/内容）；章节结构（重编号/增删/卷）；角色设计/改判/演化/归并；设定/伏笔/世界观；章节计划/大纲；查询（进度/主角/关系/事实）；讨论/方向探索；采纳/放弃/恢复候选；导出/审读；闲聊/元讨论；能力缺口/澄清。

## 4. CP 计划

| CP | 工作 | 证据 |
|---|---|---|
| CP0 | 日志盘点+抽取器+语料+频次+结果关联+覆盖缺口矩阵 | `artifacts/model-contracts/b34-cp0/` |
| CP1 | 冻结验证契约：意图类→期望 route/capability/ask/gap/no-write；top-N 验收用例与 fixture 规格 | slice 更新 |
| CP2 | test-support fixture/验收场景覆盖扩展 + 确定性测试；不新增产品钩子 | fixture/test 代码 |
| CP3 | 真实模型 scoped 验证（抽样意图，单槽；与 B33 复验合并或独立标注） | 模型证据 |
| CP4 | P1 复验/收口引用（验证体系覆盖报告） | 证据索引 |

## 5. 边界

- 不改产品/frontend/src/tasks；不跑整批 dogfood 换分；历史日志只读。
- 不新建平行 plans/specs/notes；语料/报告落 artifacts，验证契约落本 slice 与既有 `quality/`/fixture 体系。
- 真实模型调用仅在 CP3、单槽、有预算上限；模型生命周期用户硬约束（用完卸载；native iq3_s 常驻不额外加载）。
- 不把历史日志中的错误当 canon；只作为意图/验证样本。
