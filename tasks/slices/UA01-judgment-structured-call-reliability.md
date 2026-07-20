# UA01 判断结构化调用可靠性（call2 病灶收口）

- 状态：T1-T2 结构性收口完成（2026-07-20）；T3 nightly 阈值门禁常态化为后续项
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
