# M5 节拍狗粮观察报告（2026-08-25）

> 首次 qwen3.8-27b（思考型本地模型）真实长跑。产物：16 章 / 19339 有效字 / 14 章达标 /
> 导出全书 ✓（`artifacts/novel-output/m5-dogfood/`，标本库 `tmp/dogfood-db-m5`）。
> 跑了 8 次启动（3 次标定失败 + 5 次推进），排查出产品缺陷 3 个（全部当夜修复提交）、
> runner 标定与韧性缺陷 9 处（3 个提交）。提交：39496e28 / 0252536a / 0a78e895 / 52b37c3e。

## 1. 观察清单销账

| 观察项 | 结论 |
|---|---|
| chapter_mission 工具调用稳定性 | **20/20 全成功、全 source=model、零依据越界事故**；每次 90-210s（思考型） |
| planning_mission 推导/降级/复用 | 3 成功 + 1 空响应 I-M4 降级继续（prompt 不变 ✓）；扩章链首通（+4 章由模型按缺口自定规模） |
| 判断循环探索翼 | 扩章请求实测先 explore（chapter_read 补第 12 章事实）再 execute——judgment 两路由真实开火 |
| carry 三分日志 | 28 次调用全程三分诚实；**四大 empty 告警**（roster/facts/style/skeleton 28/28）精确照出 seed 结构真空；prior_summaries 仅首章 empty→真实主链摘要维护健康（对照 ca03 seed 断链判例） |
| 伴生产物（R2） | 采纳面 0 条（仅 prose×14+outline×2）；runner 只点正文采纳按钮、伴生候选随 turn 丢弃——**模型是否产出未甄别**，归 runner 行为边界观察 |
| 五本账运转 | emotion_curve 14 条（6 DEVIATED）/ information 16 条（14 REVEALED）/ conflict 1 / 审读报告 1 份 |
| 盘点节拍 | 3 次尝试全失败：1 次内容退化 627s（缺陷九检测正确开火）+ 2 次空提案——思考型模型下盘点回路是弱点 |
| writer 时延分布 | 成功 21 次：392-878s，中位 532s，>600s 占 5/21；失败 7+取消 1 → 成功率 72%，思考重尾撞 900s 阀率 ~24% |
| 「主角」元词泄漏（作者现场抓到） | 正文 41 处/5 章、全书 0 具名角色。因果链：seed 计划 30 处「主角」+ characters=0 + R5 缺席守则禁止另立主角 → 模型无名可用；单次 writer prompt 61 处「主角」；B9 词表只管工作流元词不含叙事层元词 → 静默过门 |

## 2. 当夜修复（已提交）

1. `Gateway.default_model()` 陈腐硬编码致日志谎报模型名（39496e28，误导排查半程）
2. 狗粮 900s 阀重标定（同批；缺陷九注释「换模型须复核」首次真实兑现）
3. runner 节拍窗/回执窗/阅读模式陷阱（0252536a）
4. plan 值二次编码原位解码——M0 套娃判例 M5 变体（0a78e895，产品修）
5. runner 扩章规模断言、恢复路径包裹、尸检倾印、导出自适应（52b37c3e）

## 3. 产品债登记（待作者拍板，按疑似价值排序）

| # | 债 | 证据 | 候选方向 |
|---|---|---|---|
| D1 | 角色档案真空→「主角」写进正文 | 41 处/0 具名 | 结构解=Order 8 刀②链（档案有名→阵容 carry）；辅以「先起角色」产品引导或盘点自动建档 |
| D2 | B9 词表缺叙事层元词 | 「主角」静默过门 | 词表扩「主角/反派/配角」，升 require_confirmation |
| D3 | accept 同步跑摘要维护模型调用（197.8s）阻塞整个 channel | 采纳 3 分 18 秒才回执；get_toc 排队超时引发连锁 | 摘要维护异步化（AU-10 channel 串行债的最痛实例） |
| D4 | planner 思考重尾无重试 | 空步/超时即整 run 报废，靠外层整链重试（每次 5-25 分钟） | ADR-0023 CP0 planner 重试实装（本跑真实数据：坏草稿率约 1/4 章次） |
| D5 | 盘点回路思考型模型下 3/3 失败 | 退化 627s + 空提案×2 | 盘点 prompt/预算适配思考型；或非思考 purpose 分层 |
| D6 | 按 purpose 分模型（长期） | writer 中位 532s vs judgment 30s | provider profile 分层（强/快模型按用途路由）——新刀 |

## 4. 判例沉淀（工程侧）

- 换思考型模型必须全套重标：provider 阀、runner 节拍窗/回执窗/投影窗全家（快模型标定全数失效）
- qwen3.8-27b 思考不可关（enable_thinking:false 与 /no_think 实测均无效）；LM Studio PARALLEL=4 生成期实测串行
- runner 韧性债共性：恢复动作自身失败被 `.catch(()=>{})` 吞掉 → UI 残留态（阅读模式/档案面板）永卡——恢复路径必须「复原状态否则如实上抛」
- 排查阶梯：progress.jsonl → app-log 事件分布 → llm-calls status → 狗粮库 sqlite 按 purpose×status 聚合；日志 model 字段 start 与 done 不一致=解析有诈
