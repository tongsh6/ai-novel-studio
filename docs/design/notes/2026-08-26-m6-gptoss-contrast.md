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

## 3b. 归因：模型架构差 vs 项目针对性支持（2026-08-26 作者问询补节）

**官方资料侧（速度差 22 倍的主因是架构，不是我们的代码）**：

| 维度 | gpt-oss-120b（OpenAI 官方卡） | Qwen3.8-27B（官方发布资料） |
|---|---|---|
| 架构 | MoE：117B 总参、**每 token 仅激活 5.1B**（128 专家 Top-4） | **27B dense**：每 token 全 27B 参与计算 |
| 思考 | reasoning effort 可调（low/medium/high） | 思考**默认开启**、可按请求关闭、`reasoning_effort` 调深度（对比 3.8-Max 不可关） |
| 定位 | 官方明说「high-reasoning、**agentic**、function calling、structured outputs」为设计目标 | 原生多模态 dense，主打个人硬件部署 |

Apple Silicon 上解码是访存受限的：每 token 激活参数量 5.1B vs 27B ≈ 5 倍固有速度差，
再乘思考输出长度差（qwen 默认思考、M5 实测 800 字探针思考链 7397 token）→ 22 倍完全
可由架构+运行形态解释。盘点/工具调用差距与 gpt-oss 的 agentic 训练目标一致。

**项目侧审计（无针对性代码，但有两个历史耦合，方向相反）**：

1. **产码零模型名行为分支**：全仓 grep gpt-oss/qwen 在 apps/*/lib 的非注释命中为零
   ——没有任何「见到 gpt-oss 就走特殊路径」的代码；prompt/预算按 provider 参数化
   （floor-profile 纪律）。degenerate_content? 防线甚至是「防 gpt-oss 采样退化」建的。
2. **偏 gpt-oss 的耦合（真实存在）**：prompt 体系、步预算、JSON/tool-call 输出约定
   是 M2-M4（gpt-oss 时代）标定长成的——qwen 属客场作战。
3. **偏 qwen 的耦合（同样在场）**：M5 后的 900s 超时、D3 惰性补做、D4 重试、D5 降批
   全是为 qwen 弱点建的补偿层，M6 跑时全部在场（gpt-oss 零触发）。
4. **对 qwen 的真欠账（本次考据新发现）**：M5 判例「思考不可关」用的是
   `enable_thinking:false` 与 `/no_think`——那是 Qwen3 旧代协议；3.8 官方机制是
   **可按请求关闭 + `reasoning_effort` 调深度**，而我们 LM Studio adapter 根本不传
   任何 thinking/reasoning 字段（`supports_thinking: false`，设置页该开关只对
   DeepSeek 生效）。即 M5/M6 对照中 qwen 全程按**默认思考高档**跑——速度对照对它
   不公平；盘点/planner 的失败有多少归思考重尾、多少归模型能力，现数据不可分。

**结论**：22 倍速度差主因=架构（5 倍/token × 思考长度差），非项目偏袒；但「质量差」
的对照要打折扣——公平对照需先给 LM Studio 链路接通 qwen3.8 的关思考/调 effort。

**2026-08-26 二次修正（作者问「业界都说 qwen3.8 是最强开源小模型」后核榜）**：
Artificial Analysis 公榜上 qwen3.8-27b(xhigh) Intelligence 52 / Agentic Index 51
（仅次于 Kimi K2），gpt-oss-120b(high) Intelligence 24、被压制；速度榜 gpt-oss
189 tok/s vs qwen 52.9 tok/s。即：**评测智力上 qwen 确实碾压，连 117B MoE 也不是
它对手**。这与 M6 实测的反差揭示两个此前遗漏的因子：

1. **量化不对称（疑似质量差主因）**：榜上 qwen 是 API 满精度版；我们跑的是本地
   社区量化版（16.08GB/27B ≈ 4.8 bit）。而 gpt-oss 的 MXFP4 是**官方训练原生格式**
   （63.39GB/117B，量化零损）。4bit 社区量化对结构化输出/工具调用纪律的损伤远大于
   对聊天流畅度的损伤——盘点空提案、坏 JSON 极可能主要是量化伤，不是模型能力。
2. **榜的运行形态 vs 产品的运行形态**：榜容许 xhigh 思考不限墙钟地解单题；本产品
   管线是 900s 阀+受限预算+20 步接力的严格 JSON 接力赛。qwen 的榜分是拿思考时间
   买的，产品把时间预算掐死后它的优势兑现不出来。

因此 §3 的「模型能力大于任务形态」断言**收回**，改为：M6 只证明「在当前运行形态
（本地 4bit 社区量化、思考默认档、900s 阀、agentic 严格 JSON 管线）下 gpt-oss-120b
更合适」，不证明模型本体更强。公平对照（路线 c）的价值进一步上升：关思考 + 若有
更高位宽的 qwen 量化版（Q6/Q8，~21-29GB，本机内存可容）值得一并纳入。

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

第三条路（§3b 考据后新增）：**c) 先补公平对照**——LM Studio adapter 接通 qwen3.8 的
关思考/`reasoning_effort`（新小刀，含 D6 设置页 thinking 开关对 lmstudio 放开），再跑
一次 qwen 低思考对照，之后填表。代价：一把小刀+一次 30-60 分钟狗粮；收益：写作槽的
裁决有干净数据（速度差会缩小到 ~5 倍级，质量变化未知）。

## 5. 证据路径

- `artifacts/novel-output/m6-gptoss-contrast/`（progress.jsonl / llm-calls / app-log /
  run-metrics / 导出 `tmp/exports/P1 单章正文草稿验证作品.md` 18181 字）
- `tmp/dogfood-db-m6/ai_novel_studio_test_dogfood.sqlite3`（provider_runs by
  purpose×status；注：本跑 started_at/completed_at 未落，时延取 llm-calls
  response.duration_ms 口径）
