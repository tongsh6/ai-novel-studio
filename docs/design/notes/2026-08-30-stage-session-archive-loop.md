# Stage 真实使用分析：「存档」意图五连击死循环（2026-08-30）

> 作者在 stage 环境真实创作（2026-08-28 本地凌晨，作品《诸天之上：始皇重生》立项），
> 遇到问题后要求分析应用日志与模型对话日志。本报告全部结论有逐环日志证据。
> **不授权实现**——修向候选见 §4，待作者拍板。

## 1. 会话现场（log/app/stage + log/llm-calls/stage，UTC 16:00-16:32）

作者流程：character_design 立角色 → world_building 补全档案（16:02 成功产出待采纳
设定候选）→ 然后连续五次要求存档，全部落空：

| 时刻 | 作者输入 | judgment 判定 | 实际发生 |
|---|---|---|---|
| 16:05 | 把大纲存档为作品设定 | execute + **work_archive_read（只读）** | readonly_batch 只读快照，零写入 |
| 16:07 | （追问是否完成） | reply / meta_discussion | 文字答复 |
| 16:08 | 存档 | execute + work_archive_read | 同上，plan_revision 空转 |
| 16:13 | （反馈档案是空的） | reply / meta_discussion | 解释并「给出下一步选项」 |
| 16:17 | 现在存档 | execute + work_archive_read | 同上 |
| 16:21 | 继续 | execute + work_archive_read | 同上 |
| 16:29 | 现在存档 | execute + work_archive_read | 同上，会话终 |

**judgment 的语义理解全程正确**——reason 原话：「把《诸天之上：始皇重生》完整大纲
作为作品设定**实际写入档案**」「**正式保存进作品档案**」。理解对、动作反：它每次都
选了唯一带「档案」字样的能力 `work_archive_read`，而那是只读的。

## 2. 三层缺陷（D8 族）

- **D8a 能力真空**：judgment 能力表 = 5 个「产出待采纳候选」+ 1 个只读
  `work_archive_read`。「把已讨论定稿的内容写入档案」这一高频作者意图**没有任何
  承接路径**——产品的写入语义是「候选→作者采纳」，但作者说「存档」时若无候选在场
  （或不知道要去采纳），链路就断。
- **D8b 命名诱导**：`work_archive_read` 的「archive」与「存档」字面撞车。模型在
  「明知要写入、可选项里没有写入」时选择了名字最像的只读能力——与 MBC 判例同构
  （能力语义靠名字传达给模型，名字错位=判定错位）。
- **D8c 静默失败 + 引导复踏**：execute 轮 run 只读跑完即完成，**没有向作者承认
  「我没有写入能力」**；16:29 的 reply 甚至说「说明尚未执行**并提示可随时触发存档**」
  ——把作者引回同一个坑。谎报族行为学新例：承诺执行 → 实际只读 → 不认账 → 劝再试。

另注：16:02 的 world_building 候选一直挂着待采纳——作者「存档」的正确出路
（引导采纳该候选）三次 meta_discussion 均未指出，`candidate_directions` 全程为空。

## 3. 历史错误族（已修确认，非本次问题）

- `persist_trace.error「trace_id has already been taken」×49`：止于 07-01，与
  turn_id 跨重启撞号 P0 修复（8e3d8e97）时间线吻合，此后零复发 ✓
- DeepSeek 400（thinking×tool_choice / reasoning 反序列化）×7：止于 07-05，与
  SI-model-behavior-contracts 能力整形修复吻合 ✓
- 08-21 会话（审读+续写）行为正常，无同类问题。

## 4. 修向候选（待拍板）

| # | 刀 | 内容 |
|---|---|---|
| ① | prompt 小刀（最小） | 能力表里 `work_archive_read` 描述追加「**不能保存/存档/写入任何内容**」；并加判例行：「作者要求保存/存档设定 → 若有待采纳候选，回复引导采纳；若无，选 world_building 产出候选」 |
| ② | 诚实反馈 | 判成 meta_discussion/reply 的存档追问，回复必须指出「写入=采纳候选」并列出当前待采纳候选（candidate_directions 带上） |
| ③ | 结构刀 | 新增「采纳引导」能力或让 judgment 可直接产出「跳到待采纳候选」动作——作者说「存档」时一键到位 |

推荐 ①+②起步（零结构变更，直接治本次死循环）；③视 ①② 实效再议。
