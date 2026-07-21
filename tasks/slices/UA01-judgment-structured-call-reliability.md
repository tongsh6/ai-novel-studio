# UA01 判断结构化调用可靠性（call2 病灶收口）

- 状态：T1-T2 结构性收口完成（2026-07-20）；**T4 已收口（2026-07-21）**——根因=T2b 撤目录致 call2 失明（非长上下文/非服务端状态），修复=目录注入 call2 prompt+探针首调体温计，干净实例 A/B 实证 execute 命中 0/7→4/4，见"T4 收口"节。M2 可重启。
- 类型：Prompt Protocol Slice / MBC 测量 Slice
- 父：`ADR-0025`（判断两段式协议）、`SI-model-behavior-contracts`（MBC 体系）
- 来源：M0 五跑一日复盘 + 用户统筹提醒（"不能头疼治头脚痛医脚"）

## 1. 病灶陈述（不是四个缺陷，是一个病的四种症状）

M0 期间被当作独立缺陷逐个修掉的四项，共享同一结构性根因——**两段式协议的
call2（强制 native tool call 产结构）在 gpt-oss-120b 上系统性退化**：

| 症状 | 表现 | 已打的钉（症状级，全部保留） |
|---|---|---|
| 自造枚举值 | capability="text_generation"/"planning" | schema enum 收紧 + 越界重试（live 21/21） |
| 枚举当自由文本 | authoring_intent 填中文短语 | prompt 枚举语义 + 解析校验重试（live 3/3） |
| 协议指令误读为请求 | "把判断结构化"被判 reply | preamble 锚定 + runner 秒级快速失败 |
| 参数信封套娃 | arguments 里再包 {name, arguments} | 确定性解套（判断/起草双防护） |

结构性共因：call2 的 prompt 同时承载"元任务说明（登记结构化）+ 作者输入 +
call1 叙事回显 + 输出格式规约"，模型注意力在多重上下文间漂移；且 LM Studio
的 forced tool call 对嵌套 schema 的约束执行不完整（enum 生效但结构自由度仍高）。

**残余现状（症状钉之后）**：误路由/坐标摆动仍以未测量的频率发生（五跑轶事计数
约每跑 2-4 次），被 runner 秒级重试吸收——**能跑 ≠ 病愈**，重试率就是病灶的
体温计，目前没有体温计。

## 2. 收口方向（按纠正律：测量先于设计）

1. **T1 测量先行（MBC 扩展）**：judgment 探针加"in-run 形态上下文"变体（会话
   摘要 + 章节列表 + 前轮采纳事实——复现生产 prompt 形态而非探针裸上下文），
   N≥10 轮跑出 call2 各症状的**残余率基线**，落 artifacts/model-contracts 台账。
   狗粮 runner 的 retry 计数进 summary.json（每跑体温计）。
2. **T2 协议形态复审（基于 T1 数据设计，禁止先设计）**：候选方向按数据取舍——
   call2 极小化（prompt 只留作者输入 + 单句元任务，叙事回显移除或摘要化）；
   call2 合并进 call1 尾部结构块（ADR-0025 §5 预留的回退形态，需重测流式体验）；
   分模型 profile（对结构化可靠的模型走单段）。
3. **T3 阈值门禁**：残余率纳入 MBC 硬闸门（如 call2 症状率 < 5%），nightly 探针
   看护，防退化静默回潮。

## 3. 边界

- 症状级钉（enum/校验/解套/锚定/runner 守卫）**全部保留**——它们是防线，不是
  病根治疗；本 slice 不回退任何已落防线。
- 与 M1（章级设计结构化）的关系：判断协议是所有领域功能的通路，本 slice 属
  A 轨机制层但**被全领域拉动**（领域拉动判据成立）；T1 测量成本小可与 M1 并行，
  T2 协议改动需独立 CP 且过全场景回归。


## T1 基线（2026-07-20，lmstudio/gpt-oss-120b，7 用例 × 2 形态 × 3 轮 = 42 试验）

- **protocol 双形态 1.0**：四类 call2 症状（自造枚举/自由文本枚举/指令误读/套娃）
  修钉后 **0/42 复发**——症状级防线实测够住。
- judgment 方向准确率：bare 0.952 / in_run 0.905——in_run 负载（会话摘要+12 章
  列表+采纳事实）折损约 5pp，失败全部集中在"多步复合请求判 execute"（plan 判界
  方差，ADR-0025 预算 backstop 兜底范畴），**非协议指令误读**。
- 狗粮 retry 体温计已进 summary.json（by_category 分类计数）。
- **T2 裁决（按数据）**：协议形态重构暂缓——症状率 0 且残余属判界方差；T2 降级为
  观察项（体温计连续两跑异常再启动）。T3 阈值门禁生效：probe protocol=1.0 硬闸门
  + judgment ≥0.85 双形态（当前探针已按此判定）。


## T2 启动（2026-07-20，触发条件命中：连续两跑异常）

M2 长跑数据推翻 T1 的"暂缓"裁决：T1 基线（12 章形态）症状 0/42，扩章至 17 章后
新形态高频复发（execute capability=null，缺陷八，连续两跑 ×3+ 每章）——病灶模型
升级为 **call2 可靠性随上下文长度递减**，与 P1/P2 章数增长结构性对撞。症状钉
（null 洞校验重试）已落作防线，T2 结构性收口启动：

- **T2a 判断上下文预算化（主刀）**：判断 prompt "已写章节"段随章数无界增长违反
  08 §2.2 教义（dump 与窗口大小无关地错误）；改为预算化投影——章节总数 + 最近
  N 章全名 + 目标章邻域精确全名。这是 P2-P4 千章规模本来必需的设计（领域拉动
  成立），弱模型只是提前逼出它。
- **T2b call2 极小化（辅刀）**：结构化调用 prompt 砍到最小自由度——作者输入 +
  单句元任务；叙事回显摘要化；目录不进 call2（约束由 schema enum 承载）。
- **T2c 测量闭环**：探针加长上下文变体（17/50 章形态），修复前后各测，症状率
  进阈值门禁。
- 当前 M2 三跑带 null 重试钉继续运行充当体温计（重试提示恢复率=数据）。

## T2d 输出上限（2026-07-20 追加，缺陷九：无界生成）

T2 落地后的验证烟测（42 调用）跑 53 分钟零产出，LM Studio 侧抓到实锤：单个请求
`n_decoded = 183,065` token 仍在生成（57 t/s）——**失控生成**。根因：`InferenceParams`
默认 `max_tokens: nil`，HTTP 层只在非 nil 时传参 → 所有本地 provider 调用无输出上限；
地板级模型不吐停止符时单调用时延无界。回溯解释：39 分钟"假挂"探针（两次误杀的
那只其实也在慢跑失控调用）、M2 run 5-10 分钟占框死亡螺旋、盲等蒸发。

- 教训脚本化：探针统一入口 `scripts/probe_run.sh`（PHX_SERVER=false / _build 隔离 /
  原始输出全量 tee / 并发探针预警——四条全是本轮真实事故的机械化）。

**第一版上限（估算值，已被数据推翻）**：全局 6000 + 判断用途收窄 1500/800——按
"最终内容长度"估算，忽略了 gpt-oss 推理链 token 同计入 max_tokens。烟测实证塌方：
judgment 0.952→0.429，call2 语法栈 HTTP 400（约束解码中途截停）、叙事空响应——
**结构合法但思考被掐（有形无神）**。教训：上限收进合法分布内部 = 新病灶。

**第二版上限（实测定位，已被证伪）**：LM Studio 日志三天 438 请求按 task 取
终值算出的"空带 8000"看似合理，实为伪证据——**这批日志里没有一条真正跑通的
`purpose: :writer` 样本**：全仓 grep 出 `Execution.execute/2` 唯一的默认值
funnel `Keyword.get(opts, :params, %InferenceParams{})` 用的是裸 struct（字段
全 nil），而 `with_params/2` 全仓只在 judgment_protocol.ex 调用过两次——也就是
说正文起草/质量评估/人物设计/情节大纲/世界观/角色演化**全部经过这唯一 funnel
却从未被止血阀盖住**，8000 这版数字实际只测了判断/裁决这类短产出，从未验证过
真正的写作调用。直接用生产 prompt 形态测 `purpose: :writer`（目标仅 2000
字）：8000 与 24000 两版都在同一处"@"损坏截断——**加大预算本身对不上症状**。

**根因定位（现场实测，2026-07-20）**：追查"@"损坏挖出两个独立缺陷，而不是
一个数字问题：

1. **缺陷九·真根因**：默认值 funnel 不是 `InferenceParams.new/1`（我最初以为
   的收口点），而是 `Gateway.execute/4`、`Gateway.complete/3`、
   `Execution.execute/2` 三处裸 `%InferenceParams{}` 字面量——全仓仅这 3 处，
   已改为 `InferenceParams.new()`，使止血阀真正覆盖所有调用路径（写作/评估/
   判断/对话规划/…），而不只是我最初误改的 judgment_protocol.ex 两行。
2. **缺陷十·"@"损坏的真身（首版定位错误，已用重载实验纠正）**：与 token 上限
   无关，但**根因不是 gpt-oss/LM Studio 的结构性缺陷，是本次会话的服务端状态
   被我自己的高强度压测搞坏了**。排查过程：
   - 直接 curl 复测，同一句极简 prompt（"写一句话介绍你自己"要求 JSON 输出）
     稳定复现"@"（token id 31）无限重复；换 `response_format: json_schema`
     强约束则复现 LM Studio 日志里的
     "Unexpected empty grammar stack after accepting piece: @ (31)" HTTP 400。
     一度误判为 llama.cpp/gpt-oss Harmony 格式与语法引擎不兼容的结构性缺陷、
     不可修，需要用户决策升级/换模型——**这个判断是错的**，被用户当场指出两点
     反证：本项目历史上已多次成功用 gpt-oss 跑出正文（2026-06-11 日志实锤：
     `finish_reason: "stop"`、reasoning_tokens 54-68、正文完整通顺），且应先查
     公开信息而非直接下结论。
   - 查证：LM Studio 官方 bug tracker 确有 gpt-oss + Harmony 格式相关的已知
     issue（#1555/#1105，`response_format: json_schema` 强约束下语法采样器
     拦截 Harmony 控制 token 导致乱码/崩溃），但**本项目 `json_mode` 默认
     `false`，从未走强约束路径**，所以那两个 issue 不能解释本次故障。
   - 决定性验证：用 `lms unload openai/gpt-oss-120b && lms load
     openai/gpt-oss-120b` 清空模型会话状态后，**同一个曾经必现退化的 prompt
     立刻恢复正常**（`finish_reason: "stop"`，输出格式完全正确）。这证明退化
     是**服务端瞬时状态损坏**（很可能是本 session 内那次 18.3 万 token 失控
     生成 + 多次强制语法崩溃 + 数十次连续压测请求共同造成的 slot/缓存异常），
     不是模型或版本组合的固有缺陷，模型重载即可恢复，不需要升级/换模型的
     用户决策。
   - **教训**：这是本 slice 里第二次犯"孤立现象直接下结构性结论"的错——第一次
     是把"空带 8000"当真证据（其实批日志里没有真样本），这次是把"复测三次都
     复现"当成"结构性必现"（其实是同一个已被我搞坏的会话反复复测，样本不独立）。
     纠正律：怀疑结构性缺陷前，先查该组件是否有更简单的状态类解释（重启/
     重载/清缓存），且复测要跨会话/跨进程做，不能在同一个可能已被污染的
     服务实例里反复测。

**结构性收口（三道防线，互不替代，已落地+全量测试绿）**：

- **防线一·provider 级 max_tokens**：不再由跨 provider 通用模块（
  `InferenceParams.new/1`）放字面量默认值——那是"某个模型推理链 verbosity"
  的现测属性，换模型就失效，放在通用模块本身就是错误定位。改为每个 provider
  自己配置（`config :novel_agent, NovelAgent.Provider.LMStudio, max_tokens:
  ...` 等，`NOVEL_LMSTUDIO_MAX_TOKENS`/`NOVEL_DEEPSEEK_MAX_TOKENS` env 可覆盖），
  adapter 构建请求体时自己垫底（LMStudio/DeepSeek 各 32000/16000；
  `OpenAICompatible` 共享宏同步覆盖 OpenAI/Minimax/智谱/Kimi/Gemini 七个云厂商
  适配器）——换模型 = 改配置，不是改代码。
- **防线二·挂钟时长（模型无关，真正的止血阀）**：`OpenAICompatibleStream` /
  `AnthropicStream` 新增总时长判定，复用各 provider 自己配置的 `timeout`。
  这才是唯一不随模型换代改变含义的尺子——token 数是消耗量的代理指标，且对
  流式请求 `receive_timeout` 只挡"两 chunk 间隔"挡不住持续吐字符但停不下来
  的调用（这正是无界生成能悄悄跑 53 分钟不报错的另一半原因）。触发时归类为
  可重试 `:timeout`，复用既有 provider 错误契约。
- **防线三·内容退化检测（缺陷十的直接对策）**：`NovelAgent.Provider.
  degenerate_content?/1`——内容长度 ≥40 且唯一字符占比 <5% 判定为退化，跨
  adapter 共享，接入 3 个内容有效性判定点（`openai_compatible_stream.ex`
  streaming / `anthropic_stream.ex` streaming / `lm_studio.ex` 非流式+call2）。
  HTTP 200 但内容是低熵刷屏时归类可重试 `:invalid_response`，与"内容为空"
  同一优先级，防止垃圾内容冒充成功结果下传。

**结论修正**：gpt-oss-120b + 当前 LM Studio（0.4.16）组合对 `purpose: :writer`
结构化正文起草**是可靠的**（历史日志与重载后复测均证实），不存在需要用户决策
升级/换模型的结构性缺陷。三道防线的定位相应调整——不是"给一个坏模型兜底"，
是"给任何 provider 都可能发生的瞬时服务端异常（长时间运行后状态劣化、单次
异常请求波及后续请求）兜底"，这对哪个模型都成立，价值不因今天的具体诱因是
"自己搞坏的"而减少。

**遗留（运维知识，非代码缺陷）**：LM Studio 长时间运行/高强度调用（尤其是
曾经发生过失控生成或强约束语法崩溃）后，若单次调用反常退化，`lms unload
<model> && lms load <model>` 是已验证的低成本恢复手段，先于怀疑模型/版本
不可用。是否要把"内容退化检测触发 N 次后自动建议/触发模型重载"做成自动化
运维动作，留作后续独立评估——涉及本仓库代码去控制外部应用生命周期，范围
比本 slice 大，需要单独设计与用户确认，不在本次顺手做。

## T2c 干净基线（2026-07-20，T2 全套 + 挂钟修正后，lmstudio/gpt-oss-120b，7 用例 × 3 形态 × 3 轮 = 63 试验）

发现并修正挂钟阀门自身的缺陷后（见上）重跑：探针跑在 `MIX_ENV=test` 但打真实
模型，`config/test.exs` 的 LMStudio timeout 硬编码 5s（本意给纯单测 stub 快速
失败），挂钟止血阀复用了这个字段做判定基准——首次复测 21 个用例里 4-6 个被
误杀，数据整批作废。改为 env 可覆盖（`NOVEL_LMSTUDIO_TIMEOUT_MS`，
`probe_run.sh`/`dogfood_run.sh` 显式设 300000）后干净重跑：

- **protocol=1.0 / form=1.0 / blocked=0/21，三种上下文形态（bare/in_run/
  long_run）完全一致**——T2a（章节列表有界投影）+ T2b（call2 回显封顶）+
  T2d（provider 级 max_tokens + 挂钟时长 + 内容退化检测）落地后，call2
  结构化可靠性在长上下文形态下不再退化，硬闸门干净通过。
- judgment 准确率 bare 0.952 / in_run 0.857 / long_run 1.0，失败全部是
  "expected=plan|explore got=reply"/"expected=explore got=reply"——已知的
  plan 判界方差（ADR-0025 预算 backstop 兜底范畴），非协议指令误读，与
  T1 基线（bare 0.952/in_run 0.905）同类且量级一致。
- **T2 裁决**：结构性收口到此完成，症状率 0、体温计 0，T3 阈值门禁（protocol
  1.0 硬闸门 + judgment ≥0.85）双形态达标。

## T4 新症状：capability 与 reason 自相矛盾（2026-07-20，M2 长跑实测）

**接手摘要（2026-07-20，M2 已暂停，用户将切换新会话处理，先读这段再读下面
详细证据链）**：

- **现象**：call2 判断执行类请求时，`capability` 字段与同一次调用里 `reason`
  自然语言描述的意图不一致——reason 说"要写第N章正文"，capability 却填了
  `character_design`/`world_building`/`character_evolution` 等无关值。值
  本身合法（在目录内），enum 校验拦不住。
- **根因假说（有原始日志实锤支持，非空想）**：模型隐藏推理链原文显示它其实
  决定用一个目录外的自造名（如 `"creative_writing"`），但最终写进 tool call
  的却是另一个合法目录值——推理链决定的值与实际序列化输出的值是两个不同
  字符串。判断是 LM Studio/llama.cpp 强制工具调用的语法约束解码阶段把无效
  自造名**静默顶替**成了任意合法目录值，不是模型语义理解错了。
- **规模**：不是偶发——同一长会话内连续 4 次执行类判断 0 命中 `prose_writing`
  （第13章 3 次 + 第14章 1 次），每次顶替到的错误值都不同，接近随机。诱因
  疑似"该 work/session 被 `--resume` 持续累积的总上下文过长"，但仅一个 run
  一份样本，未跨会话验证。
- **对 M2 的影响**：M2 在这个缺陷下无法产出任何新章节——每章两次误路由后
  跳章，字数完全不涨（重启后 51 分钟 0 增长）。用户已决定停止 M2、登记本
  病灶、切换新会话处理，不再继续在当前会话里烧时间等它自愈。
- **遗留脏数据**：工作区里有一个孤立的"郑果"角色设定待采纳草稿（第13章
  误路由产物之一），未清理，下次开工前视情况处理（不影响正文/章节数据，
  只是一张不相关的待采纳卡片）。
- **下一步方向（未做，留给下次会话判断优先级）**：①先验证诱因假说——换一个
  全新 work/session（不带累积历史）重跑同样的第13/14章请求，看是否恢复正常，
  以此判断是否真是"总上下文过长"而非其它成因；②若假说成立，考虑 M2 长跑
  是否需要阶段性换新 session/work 而非无限 `--resume` 累积同一份历史；③
  reason/capability 一致性校验方向已提出但未设计，需要更多样本再动手，避免
  凭一次实锤直接实现启发式规则。

---

T2 裁决"症状率 0"后，M2 重启第一个 run 就实测到一个新症状，且比已收口的四种
更隐蔽——**call2 输出的 `capability` 字段与同一次调用里 `reason` 字段的自然语言
描述直接矛盾**，不是自造目录外枚举值（schema enum 拦不住，因为选中的值本身
合法）：

```
作者输入（goal.text，无歧义）："请根据已采纳章节计划生成第13章：暗网的逆流：
  ……正文草稿，保持为待采纳草稿。"
judgment.decided：
  reason_code = "根据作者请求，需要依据已采纳的章节计划创作第13章正文草稿，
                 属于单动作执行。"
  action      = "execute"
  capability  = "character_design"   ← 与 reason 描述的"创作第13章正文草稿"矛盾
```

结果：路由进 `character_design_with_context_v1`，读取角色阵容后设计了一个全新
角色"郑果"，与第13章正文毫无关系，UI 呈现"已完成·创作执行·1份草稿待采纳"——
**系统认为自己成功了，产出内容却与作者请求完全无关**。这与此前四症状（自造
枚举值/枚举当自由文本/协议误读/参数信封）都不同——那四种要么结构不合法、
要么能通过内容与上下文比对识破；这次 `capability` 是合法值，`reason` 读起来
完全正确，唯独两者互相对不上，无法用"目录校验"或"结构合法性校验"拦截，需要
**同一次调用内部的字段间一致性校验**（reason 提到的动作类型/对象 vs
capability 选择是否一致）。

**残余风险（未修复，先登记）**：
- 触发条件未定位——是否与本 session 反复观察到的"同一章节长期在 in_run/
  long_run 累积上下文中反复重试"有关（第13章此前已在本次 M2 里失败 5+ 次），
  还是独立于上下文长度的随机漂移，需要更多样本才能下结论，不能凭这一次实锤
  就断言成因。
- runner 侧影响：`classifyChapterAttemptFrame` 只认 `tool_result.tool_name
  === "prose_writing"` 为 `prose_ready`，`character_design` 成功不会被误采纳
  （不匹配任何已识别结局），但也不会被识别为"这次尝试其实该重试"——会一直
  等到 600s 超时才继续，即多耗一轮空等，且工作区里多了一个孤立、不相关的
  "郑果" 待采纳草稿需要人工清理（本次未清理，先如实登记現状）。
- 修法方向（未设计，只记方向）：这类"字段间语义一致性"问题结构上和
  capability 枚举校验是两个维度——枚举校验回答"这个值在不在目录里"，这里
  需要回答"这个值和判断自己给出的理由是否指向同一件事"，可能需要在
  `judgment_protocol.ex` 的解析层加一层"reason 与 capability 弱一致性检查"
  （如 reason 出现"正文/章节/写作"而 capability 选中非 prose_writing 类目
  即判不合法、走既有越界重试路径），但这类文本层启发式本身容易误伤，需要
  先收集更多样本再设计，不能凭一例现场实锤直接实现。

**追加实锤（同一 run 内连续 3 次重试，2026-07-20 14:06）**：同一个第13章写作请求，
连续三次重试各自路由到三个不同的错误能力，一次都没落到 `prose_writing`：

| 时间 | 路由到的能力 | 产出 |
|---|---|---|
| 13:46 | `character_design` | 新角色"郑果"设定草稿 |
| 13:56 | `world_building` | 世界设定/伏笔/规则草稿 |
| 14:06 | `character_evolution` | 角色演化上下文 |

三次都是合法枚举值、reason 读起来都"像"正确理解了请求，但 capability 每次
都不一样、都是错的——不是卡在某个固定的错误值上，接近随机漂移。第13章在本次
M2 里已经反复失败重试多次（10:53/11:14/13:21 均为 prose_drafting 路由但
JSON 解析失败），本次是"路由本身"开始失效，时间点与该 run 长期累积重试历史
吻合，与本 slice 已确认的"call2 可靠性随上下文长度递减"disease model 同源
可能性上升——但样本仍只来自一个 run 的一章，不能仅凭这次升级结论，需要更多
run/章节的样本才能确认是否是同一成因。

**关键升级（2026-07-20 14:16，第14章复现）**：误路由不是第13章专属——同一个
长会话继续跑到第14章，第一次尝试又路由到 `character_design_with_context_v1`
（读取角色阵容），仍未落到 `prose_writing`。至此同一会话内连续 **4 次**执行类
判断全部误路由（第13章 3 次 + 第14章 1 次），换了章节问题依旧存在——说明诱因
更可能是**本次长会话累积的总上下文量**（M0/M1/M2 多轮跑下来，同一 work/session
记录被 `--resume` 持续复用，历史极长），而不是"第13章反复失败留下的局部脏历史"。
与本 slice 病灶模型"call2 可靠性随上下文长度递减"高度吻合，且这次是该病灶
目前观察到最严重的形态——不是准确率打折扣（T1/T2c 的 0.85-1.0 区间波动），
是**接近系统性失效**（连续 4 次 0 命中）。是否需要新起 session/work（而非
继续 `--resume` 累积同一份超长历史）作为止损手段，留给下一步讨论，本条先如实
记录现象与假说，不擅自决定止损动作。

**根因定位（2026-07-20，LM Studio 原始日志实锤）——从"字段矛盾"精确到"解码层顶替"**：

用户截图直接抓到了这次判断调用的隐藏推理链原文（call2 的 chain-of-thought，
非最终输出）：

```
...It says capability 填能力目录中的能力名（只能取目录名）. Assume "creative_writing". Use that.
...
Let's call function.
```

紧接着的实际 tool call：

```json
{"reason":"作者请求生成第14章正文草稿，属于单动作执行的创作任务，需要直接进行文本写作。",
 "action":"execute","capability":"character_design", ...}
```

**模型自己决定要用的值（`creative_writing`）和它实际写进结构化输出的值
（`character_design`）是两个不同的字符串**——不是语义层面"理解错了"，是推理链
的决定和最终序列化输出之间发生了不一致。且 `creative_writing` 本身就不在
能力目录（`character_design/character_evolution/prose_writing/plot_outline/
world_building/work_archive_read`）里，与本 slice 最早收口的"自造能力名"
（M0 缺陷一：capability="text_generation"）是同一个模型癖好——差别是这次
自造的名字没有出现在最终输出里浮出水面被 enum 校验拦住，而是在 LM Studio/
llama.cpp 的强制工具调用语法约束解码阶段被**静默顶替**成了另一个合法但无关
的目录值。应用层（Elixir）拿到的 JSON 本来就是合法的 `character_design`，
现有的 enum 校验、reason 一致性校验都无法识别这类"顶替"——因为顶替后的值
本身找不出任何结构或语义层面的破绽，只有对照同一次调用的隐藏推理链原文才能
发现。

这解释了为什么连续 4 次误路由每次落在不同的错误能力上（character_design/
world_building/character_evolution/character_design）：不是模型稳定"相信"
某个错误答案，是约束解码器每次把模型想说的无效名随机顶替到目录内某个合法
成员，顶替目标本身是任意的。

**影响判断**：这类"解码层顶替"如果确实存在且频繁，意味着 enum 校验从
"防止自造名浮出水面"这个原始设计目的上看已经不够——校验的是顶替*之后*的
值，而顶替本身已经把"作者到底要什么"这个信息丢了。真正的收口方向可能需要
校验 reason 与 capability 的语义一致性（本文档前一节已提议但未设计），或者
从根源上降低模型产生"creative_writing"这类越界冲动的概率（如 prompt 里
更早、更醒目地重申目录，或换一个对 forced tool call 更服帖的模型/profile）。
仍然只是假说与方向记录，未实现、未验证。

## T4 收口（2026-07-21，根因定位 + 修复 + 干净实例 A/B 实证）

**裁决：两个候选假说双双出局，真根因是 T2b 自己引入的 call2 目录失明。**

1. **"累积上下文过长"不成立**：复核 M2 全天 llm-calls 日志，call2 prompt 恒定
   ~1116 字符 / ~800 input token（T2a/T2b 预算化正常工作），健康轮与误路由轮
   逐字节同尺寸——误路由与上下文长度无关。
2. **"服务端状态损坏"（缺陷十同款）不成立**：TTL 卸载后全新加载的干净实例上
   逐字节重放 L757 原始请求 10 次，`prose_writing` **0/10**——误路由在干净
   实例上完全复现，且"推理链自造名→输出被顶替成合法值"的原始截图现场
   （`creative_writing`→`character_design`）重放复现 2 次。

**真根因**：T2b 极小化把能力目录撤出 call2 prompt（"目录不进 call2，约束由
schema enum 承载"），但 enum 包在 `anyOf` 内层，经 LM Studio/Harmony 模板
渲染后对模型**不可见**——M2 全天 **15 次 call2 首调 0 命中 prose_writing**
（8 次自造名原样浮出 / 1 次 null / 6 次被约束解码静默顶替成任意合法值），
多条隐藏推理链明说"目录列表未给出，只能猜"。对照组：直挂 enum 的 `action`
字段全天 100% 合法——失明的是 anyOf 内层，不是所有 enum。

**"前半天正常"是重试网假象**：首调从来没对过。16:36 加载、被连续压测 5 小时
的旧实例约束执行劣化，自造名原样浮出 → enum 校验拦住 → 带目录的重试 prompt
纠正（全天重试 8/9 命中；1 次仍自造走诚实失败）。21:45:52 请求触发 JIT 重新
加载（前一实例已卸载），新实例约束执行正常 → 自造名被**静默顶替成合法值** →
重试网被绕过 → 误路由直通执行。瘟疫起点=新实例第一个判断调用（21:46:14），
与上下文增长无关。T1/T2c 探针全绿同为假绿：探针把 request_judgment 当黑盒，
内部重试把首调失明完全遮住（NEXT.md 反补丁自检条款的活教材）。

**修复（已落地）**：
- `judgment_protocol.ex`：`capability_help/1`、`explore_tool_help/1` 把能力
  目录六名 + 探索工具四名注入 call2 prompt 正文（措辞逐字复用 retry hint 的
  实证写法；目录未传保持旧措辞向后兼容）。enum schema/越界重试/null 校验全部
  保留（防顶替的末道网）。
- 探针 `judgment_protocol.exs`：新增 call2 体温计 `call2_first_try_rate` /
  `call2_retries`（用 judgment.provider_call_count=2 判首调成功），阈值暂不
  入闸门（测量先于设计）；probe options 补 `explore_tools`（此前与生产不同形，
  镜像修正）。

**干净实例 A/B 重放（L757 逐字节重放，各 10 次，2026-07-21）**：

| 指标 | Arm A 旧 prompt | Arm B 新 prompt |
|---|---|---|
| 推理链自造能力名 | 7/10 | **0/10** |
| 判 execute 时 capability 命中 prose_writing | 0/7（3 顶替 + 4 null） | **4/4** |
| capability null 洞（缺陷八形态） | 4/10 | 0/10 |

证据：`artifacts/model-contracts/lmstudio/t4-replay-ab-2026-07-21.json`。

**廉价梯队全绿**：mix compile --warnings-as-errors / 全量 1208 测试 0 失败
（新增 call2 目录注入回归单测）/ stub 探针 call2_first_try=1.0 / xref 无环 /
arch_check / I1 I2 I3 三条不变量 3/3。

**live 探针复跑（修复后，lmstudio/gpt-oss-120b，7 用例 × 3 形态 × 3 轮 = 63
试验，2026-07-21）**：三形态 **call2_first_try=1.0 / call2_retries=0**（对照
M2 生产首调 0/15）；protocol=1.0 / form=1.0 / blocked=0 三形态一致（T3 硬
闸门通过）；judgment bare 0.905 / in_run 0.952 / long_run 1.0（阈值 0.85
达标，与 T1/T2c 基线同量级，失败全为已知 plan/reply 判界方差）——**目录
注入没有推高 plan 误判**，A/B 重放里 Arm B 的 plan 占比观察据此按"既有判界
方差内"关闭，runner 长措辞收短仍留 B7 顺手项。

**M2 达标跑实测追补（2026-07-21，101,421 字/75 章/5.28h 全新跑）**：T4 修复
在产品级长跑中**零复发**——112 次重试无一 capability 错值。但暴露 T5 级新病灶
**clip_echo 头部截断**：扩章批章节摘要变长 → call1 叙事超 240 字符 → 头部
截断剪掉尾部"单动作执行"结论 → call2 只见意图复述、回落"登记"元指令误判
reply。体温计：wrong_route_reply **97 次**、随章数单调递增（前 17 章 0 次，
18 章起高发），8 章反复失败被跳过；tool_failed 12 次（其中第 13 章 2 次为
上下文 8192 截断所致，重载 32k 后消失）；coordinate_regression 3 次。修复
已实现：`clip_echo` 改头 120+尾 120 双端保留（保意图起点+裁决结论/内联回复
尾），**未 live 验证**——探针 battery 叙事全短于 240 覆盖不到，需长摘要形态
端到端判断验证（下一会话）。证据：`artifacts/novel-output/p1-100k-dogfood/
summary.json`（retry_thermometer 首次全量数据）。

**残余登记（不在本次收口范围）**：
- **plan 判界方差在长复合措辞下的占比**：A/B 重放的作者输入是 runner 的四子句
  长措辞（"生成第13章：…；…；…；…"），Arm B 有 6/10 判 plan/reply（Arm A
  3/10）——样本不足以定性是目录列出后的副作用还是既有 plan 判界方差（ADR-0025
  预算 backstop 范畴）。探针阵列（无歧义用例）的 judgment 准确率做裁决数据；
  另 runner 章节请求措辞可考虑收短（B 轨）。
- **探针 call1 目录陈旧**：`capability_catalog_section` 仍是 5 项旧目录（含
  已不存在的 search_work_facts，缺 character_evolution/work_archive_read）——
  与生产 judgment_context_block 背离；为保 T2c 基线可比性本轮未动，登记待修。
- **会话摘要注水**：M2 会话摘要里"已通过采纳边界，采纳内容已进入已决状态。"
  逐字重复 ×10 进 call1 上下文——压缩层对同质 assistant 消息无去重（B 轨）。
- **reason↔capability 语义一致性校验方向关闭**：根因已修，文本启发式易误伤，
  不再需要。
- 郑果孤立草稿：M2 重启前在工作台人工废弃即可（不影响正文/章节数据）。
