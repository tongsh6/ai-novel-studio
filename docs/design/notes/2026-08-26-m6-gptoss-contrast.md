# M6 对照狗粮报告：gpt-oss-120b vs qwen3.8-27b（2026-08-26）

> 目的：D6 按用途分模型路由（`tasks/slices/D6-purpose-model-routing.md`）落地后，
> 队首④「切 gpt-oss-120b 对照取数再填路由表」的取数报告。同任务同刻度同 runner，
> 唯一变量=模型（`NOVEL_LMSTUDIO_MODEL` env 覆盖，零产品代码改动）。**不授权实现**。

## 1. 跑法

- M5 同刻度：`--chapters 15 --min-words 1000 --target-words 18000`，seed 12 章计划。
- 新分区库 `tmp/dogfood-db-m6`、新证据目录 `artifacts/novel-output/m6-gptoss-contrast/`
  （不覆盖 M5 证据）；B8/B8b 预检通过（contextLength=32768、模型一致）。
- 本跑是 D6「purpose 同源修复」后的第一跑：provider_runs 的 purpose 归因自此来自
  Gateway 本体（此前 writer/evaluator 落默认 :conversation，归因靠投影器旁路）。

## 2. 对照表（同口径）

| 靶 | M5（qwen3.8-27b，思考型） | M6（gpt-oss-120b） |
|---|---|---|
| 收官 | 16 章 19339 字，8 次启动（3 次标定失败），数小时 | 12 章 18181 字，**1 次启动 30 分 13 秒收官** |
| writer 单调用 | 成功 21 次中位 532s、>600s 占 5/21、思考重尾撞 900s 阀率 ~24%、成功率 72% | **25 次全成中位 24.2s、max 33.9s**（22 倍快，零撞阀） |
| judgment | ~30s | 50 次中位 4.5s |
| 章推进 turn（端到端） | — | 23 次中位 74s、max 92s |
| HTTP 调用 | 坏 JSON/超时/取消混杂 | **201 次全 200** |
| provider_runs | 失败/取消混杂 | **全 completed**（writer 26/planner 76/evaluator 25/author_reasoning 51） |
| planner 坏草稿 | ~1/4 章次（D4 由此立项） | 零 retry 事件、零 run 报废 |
| 盘点节拍 | **3/3 全败**（退化 627s+空提案×2，D5 由此立项） | **1/1 成功**：16 提案（角色 6），主角陆沉舟采纳建档、骨架 3 字段回写 |
| chapter_mission | 20/20 全成功（慢） | derived.done 25 次，零失败 |
| 「主角」元词泄漏 | 41 处/5 章（D1 由此立项） | **0 处**（D1 修复 + 盘点建档有名阵容双因子） |
| runner 侧插曲 | 九针修复史 | 2 次续写坐标回退（overwrite 确认，runner 显式处理）+ 1 次 B9 元泄漏拦截后显式确认——均非产品失败 |

## 3. 分析

1. **gpt-oss-120b 在本项目全部四类 purpose 上全面占优**：不仅「更友好」，而是
   快 5-22 倍且零失败。M5 登记的 D4（planner 重试）/D5（盘点降批）在 M6 下一次
   都没触发——这两把刀是为思考型模型的弱点建的韧性层，换模型后成为静默保险。
- 2. **盘点回路的模型敏感性实锤**：同一 prompt 同一材料，qwen 3/3 败、gpt-oss 1/1 成
   且提案质量高（6 角色+骨架回写）。D5 的「稳定退化=任务形态问题」判断在 qwen 侧
   成立，但根因权重上「模型能力」大于「任务形态」。
3. **元词泄漏归零是双因子**：D1 真空守则修复 + 盘点成功建档让阵容 carry 有名可用，
   无法归因单侧；但作者可感知的结果是干净的。
4. **qwen 仅存的防守理由=文学质感**（业界口碑其写作更佳）。本报告不测文学质量；
   两书样章人工盲评（M5 书 vs M6 书）是填「写作」槽前的唯一缺口。

## 4. 路由表填表建议（待作者拍板）

D6 设置区四槽（当前全部「跟随全局」，全局=qwen3.8-27b）：

| 槽 | 建议 | 依据 |
|---|---|---|
| 设定盘点 | **gpt-oss-120b** | 3/3 败 → 1/1 成，无悬念 |
| 规划 | **gpt-oss-120b** | 坏草稿 1/4 → 零，且 5-10 倍快 |
| 质量评审 | **gpt-oss-120b** | 25 次全成中位数秒级 |
| 正文写作 | **待盲评**：M5 书 vs M6 书样章对比后定 | 速度 22 倍差 vs 文学质感口碑，作者裁决 |

操作即设置对话框两个下拉（LM Studio 同时挂双模型，D6 机制已就绪）；或全局直切
gpt-oss-120b（若盲评也偏向它，连「写作」一起切，回到全局单模型零表）。

## 5. 证据路径

- `artifacts/novel-output/m6-gptoss-contrast/`（progress.jsonl / llm-calls / app-log /
  run-metrics / 导出 `tmp/exports/P1 单章正文草稿验证作品.md` 18181 字）
- `tmp/dogfood-db-m6/ai_novel_studio_test_dogfood.sqlite3`（provider_runs by
  purpose×status；注：本跑 started_at/completed_at 未落，时延取 llm-calls
  response.duration_ms 口径）
