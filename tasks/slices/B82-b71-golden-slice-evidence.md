# B82：B71 G2/G3/G5 黄金切片证据补证（Responses/Anthropic 实模 + 逐片真实证据）

- 状态：**doing（作者已授权实模验证，G2 首批已执行并判未通过，见下）**
- 来源：
  - 作者 2026-11-08 同意：B71 后续候选「G2–G6 切片补证」需独立任务文档、新冻结预注册后执行（原记录见 [B71](B71-provider-message-fidelity.md) 与 [NEXT](../NEXT.md)）。
  - B71 2026-11-08 实模批次 `b71-first-consumer-live-cp4b2-iq3s-01` 的 required_mechanism 8/8 通过。后续原生批次的实模报文复核与待补证项见 [B71 完成度复核](B71-provider-message-fidelity.md#2026-11-11-b81-交付后的完成度复核)。
- 边界与承接：
  - **G6 不由本任务承接**：ADR-0035/B81 落地后，压缩后真实请求应在真实多轮会话中取证（[B81](B81-session-canonical-authoring-history.md) CP5）；本任务不构造异常路径或单 run 多回合场景。
  - 本任务承接 G2/G3/G5 的真实证据补证，以及 Responses/Anthropic 官方凭证到位后的实模矩阵（与[B83](B83-vendor-stream-options-matrix.md)区分：B83 是 `stream_options.include_usage` 接受度矩阵，本任务是黄金切片请求字节/流式/缓存/多轮证据）。
- 范围（每个切片独立预注册、独立批次、如实登记）：
  - G2：成功的工具观察以同一 call ID 进入下一次实际请求，核对来源、版本、覆盖及该次请求的 used refs 边界（真实模型、真实页面）。
  - G3：失败的校验以同一 call ID 和 reason code 进入下一次实际请求，核对作者原话未被追加伪纠错，修正受预算和权限门控制。能力门、有限模式和路由拒绝另按 VS-00L §6 取证。
  - G5：实际采纳/放弃后的处置事实与后续请求逐项对账，核对新 run 的授权边界、历史调用的处理和 canon 变更（已有确定性真实页面证据）。
  - Responses/Anthropic 实模：凭证到位后按冻结预注册执行，记录真实 body/usage/流式终止。
- 非目标：不重跑换分、不调判据/窗口/K、不把确定性证据冒充实模、不代签 I10；不在本任务修改产品代码（若发现问题另立修复）。
- 验收：每个切片有冻结预注册 + 批次证据 + PASS/FAIL 判定；失败按纪律只读保留并登记根因；真实模型/页面/机制分层报告。
- 依赖/阻塞：G2/G3/G5 各自按冻结预注册使用真实模型与页面驱动窗口。Responses 实模需官方凭证。作者确认当前没有 Anthropic 账号，Anthropic 官方实模保留为条件项，待有可授权的账号和凭证后复验。三类 wire 的确定性证据仍按各自已验证范围记录。
- 恢复入口：`tasks/NEXT.md` → 本任务；批次证据在 `artifacts/`；B71 原任务保留历史上下文。

## 正式预注册准备

沿用 [VS-00L §7](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md#7-六类黄金请求)、`native_b71_batch.sh` 及各既有场景判据。每批冻结 provider/model、入口、作品种子、作者动作、最大调用与重试预算、证据目录和结果条件。模型未触发目标行为、页面未推进或证据缺项均按实记账。

| 批次 | 入口和可复用证据 | 正式判据 |
|---|---|---|
| G2 | 沿用已采纳正文分页场景及现有 Tauri 工作台。B81 已取到 revision 2、范围 1–6000 的观察报文。 | 从作者发送与 ACK 定位同一 run，以 Provider start 的 run/call 引用定位请求。取模型工具调用、同 ID 成功观察及其首次进入的下一请求，并与 canonical 的来源、版本、覆盖和内容核对。声明使用的 refs 必须在该次实际报文的 Base 或已进入的观察中找到。整批 refs 并集、仅持久化事件或历史回放均不足以成立。 |
| G3 | 复用原生创作/质量修订入口。B81 已取到判断与质量复核的失败校验报文。 | 一次真实模型结果触发既有产品校验。按同一 run/call 链定位下一请求的原生 `validation_result`、失败原因和逐字一致的作者消息，并核对实际修正次数、工具门及终局。若模型未触发失败或未产生后续请求，登记缺证。 |
| G5 | 复用 pending journey 已有采纳、放弃和 follow-up 驱动与判据。 | 每个动作绑定其实际候选、ACK 和 receipt。新请求绑定新的 run/权限快照，最新 scope 的处置必须与回执逐项匹配。核对旧调用未跨授权边界复执行、放弃零 canon 写、采纳后写入的正文与被采纳稿一致。 |
| Responses / Anthropic | 复用现有 Request IR、adapter 原生投影和真实页面证据入口。当前 B71 Tauri runner 仅有确定性替身及 Strata 模式，凭证到位后先核对接入与证据读取路径。 | 各自检查实际原生 body 的工具调用/结果 ID、流式终止及 usage。缓存可观测时记录命中数据，作者预览按实际 writer 增量和同一回合页面采样核对。 |

当前段是取证准备。正式批次启动前按上述要求冻结实际值。Strata 历史日志的 SSE 响应占位符只能佐证使用了流式传输，G2/G3 的逐调用响应来源需另有同源证据。页面、请求、模型行为与作者可见结果分别核对。

### G2 批次输入对账

2026-11-11 12:05 CST 只读检查本机 Strata。模型列表返回 `iq3_s`，原生接口报告 `mode=real`、`loaded=null`。此结果只用于预注册准备，批次开始前需再次核验。

`b71-first-consumer` 的现有种子创建两章同名章节。第 01 章只有计划，第 02 章才有已采纳正文。当前实模驱动的默认输入指向第 01 章，适合原有创作场景。G2 专项保留现有种子和工作台，预注册输入明确指向第 02 章，先核对已采纳正文，再给出待采纳的改写候选。

拟用作者输入：「请先读第02章《灰烬中的手印》已经保存的正文，前后都核对一下，再把发现的重复写法改成一段候选给我看，先不要保存。」若作者输入、选章、读取到的正文版本或分页覆盖不满足预注册条件，该批只保留实际证据。成功观察进入请求、该次调用的模型自报、以及候选仍待采纳分别记录。

外部 runner 通过 `B71_LIVE_PREREGISTRATION` 读取现有 B71 JSON 形状。单场景的 `scenarios[0].message` 保存作者原文，`scenarios[0].evidence.dir` 与本批目标目录一致，`model.provider` 和 `model.model` 与本批 Strata 配置相符。runner 在启动前一次读取并校验源文件，随后将同一快照封存为批次内的 `preregistration.json`。发送前和验收时复核保存的模型、原文与 SHA-256，现有发送帧与 ACK 判据继续绑定实际输入。原有实模创作场景沿用其默认输入。

隔离 shell 验证覆盖两条路径。启动期间把预注册源的第 02 章改为第 99 章，封存副本仍逐字等于启动前原文。单槽返回空模型列表时，冻结批次在 runner 启动前退出。证据见 `artifacts/b71-audit/2026-11-11-frozen-input-shell-proof.jsonl`。正式 G2 的预算、场景判据和批次启动授权另按上表办理。

#### G2 专项验收边界

12:48 CST 再次只读核对 Strata，`/v1/models` 仅列出 `iq3_s`，原生单槽为 `mode=real`、`loaded=null`。启动时仍由 runner 复查该条件。

现有 live 入口在模型未调用工具时会将观察相关判据记为 `null`，通用机制报告仍可通过。专项 G2 要求成功分页观察实际发生，并把同一次 Provider 执行的响应、canonical 工具 ID、紧接的下一请求和使用声明关联。已有确定性全章核对的工具交换和续页读取判据可复用。它要求的固定探索收尾属于原场景，专项 G2 仍以作者请求中的待采纳改写候选为出口。

第 02 章的已采纳稿由既有种子建立，7000 字符分别覆盖 1–6000 和 6001–7000。两页按实际落库的 draft 版本、范围和报文正文对账。模型只声明章节引用且该引用同时存在于 Base 时，可以核对引用边界，页级观察使用仍需页对应的证据。

冻结 live 入口复用 `bindNativeCalls`。它以 ACK 对应 run 的完整归属读取 ProviderRun、canonical 和日志，逐调用核验原生 ID 与参数字节，并只把已绑定的本 run 记录交给机制判据。报告中 `measured.native_call` 记录执行引用和 SSE 工具对账数量。占位、缺响应、错属和带 Strata 标签的替身记录均不能满足该入口。分页、候选与页级使用的独立核对见下。

#### G2 首批实模结果（2026-11-11）

作者明确允许实模验证后，冻结 `artifacts/model-contracts/b82/b82-g2-iq3s-01-preregistration.json` 并执行一批 Strata `iq3_s`。原始批次为 `artifacts/slice-verify/b71-first-consumer-live-b82-g2-iq3s-01/`，独立判定为 **G2 未通过**。通用机制报告 10/10，其中两次实际 SSE 工具响应和 canonical、ProviderRun 全部对账，作者未采纳且 canon 保持原样。

- **页面时序**。Tauri 输入等待 994 ms，投递原话用时 1886 ms，发送至 ACK 26 ms，ACK 至后端终局 8929 ms，等待账无错误。发送后截图显示「进行中 · 创作」及任务调整区。最终截图和 AX 显示「失败」、顶部「无任务」、普通输入区和无候选，未出现待作者回答控件。欢迎文案仍提到 LM Studio，实际 Provider 由本次 Strata 请求和单槽证据确认。
- **查询与回流**。模型第一次以标题查询 `chapter_read`，遗漏已知章序，产品返回两个同名目标的歧义观察。该观察以同一个 call ID 原样进入紧接的第二个请求。它携带匹配信息，合格正文页数为 0。
- **目标授权**。第二次模型绑定正确第 02 章并请求 `revise_adopted_content`，同时将其解释为整章替换。按原始作者文本复算，`ChapterRevisionScope` 仅授予 `:target_segments`。现有字面目标解析把「发现的重复写法」当作待定位原文，因未命中返回 `:target_missing`，writer 未启动。页面只提示核对当前候选，作者看不到应补充什么目标。该缺口沿 [B28](B28-whole-chapter-revision.md) 的章级修订边界处理，保持作者授权约束。

两次 Provider 调用低于本 run 的 33 次预算，页级自报、正文分页及待采纳候选均缺证。Strata 已卸载，窗口进程已清理。本批原始文件保持只读，逐项判定、时间戳和清理结果见 `artifacts/b71-audit/2026-11-11-b82-g2-iq3s-01-verdict.json`。

#### 分页判据的归属对照

复核三份现有档案。确定性原生批次 `b81-snapshot-versions-final` 两页均与 revision 2 采纳稿和紧接的 Provider 请求等值。历史实模批次 `b81-c7-c8-03` 的第一页来自该 run 的第 4 次 Provider 启动，前面还有问答和探索。两页的正文和紧接请求均能对账，版本字段缺失。B82 首批无目标正文页。逐项对照见 `artifacts/b71-audit/2026-11-11-g2-archive-page-facts.jsonl`。

原生执行的工具名为 `judgment_decision`，观察内容才标记 `chapter_read`。按每页的 canonical call ID 定位在先 assistant，再用其 Provider run/call 双键查找实际 started 和下一次请求。此前问答的调用保留在顺序中，页序本身不承担调用身份。

冻结场景 `b82-g2` 现已启用这一页级门禁。场景 ID 来自哈希核验后的预注册，目标章和唯一采纳稿取自隔离库。门禁失败时保留现有报告和逐页原因，再让专项验收退出。复验两页同源正例、实模档案的版本缺失、B82 首批无页，以及从紧邻请求删掉观察而仅留下后续回放的反例，见 `artifacts/b71-audit/2026-11-11-g2-page-gate-archive-proof.jsonl`。报告明确标记只核验分页，模型页级使用与作者可见候选仍须独立验收。

首批冻结文本将种子传入的 revision 1 误记为落库版本。实际 SQLite 中第 02 章唯一采纳稿是 revision 2，因为 `Draft.changeset` 经过现有的 `optimistic_lock(:revision)`。原始预注册保留原值，首批未通过结论保持。后续批次按已持久化的版本冻结预期。读侧从该版本核对同一页的 canonical 和下一实际请求。对账见 `artifacts/b71-audit/2026-11-11-b82-g2-seed-actual-revision.json`。

#### G2 局部候选的终局与可见证据

冻结入口复用作者输入的同一 ACK 事实，只检查该 run、作品、会话的完成帧。候选以本 run 的持久待采纳 ID 收窄，再核对目标章、`TENTATIVE`、`target_segments` 与 `replace_segments`。现有 `writerArtifactMatch` 逐字对账同次 writer 的标题、正文和理由。最终可见文本必须出现对应 item，输入前已有同一 item 或缺输入前采样时记缺证。

B28 历史原生档案中，候选文本在后续页面仍可见，单凭文字出现会错签后续回合，见 `artifacts/b71-audit/2026-11-11-g2-candidate-visible-baseline.jsonl`。用 B82 首批原始 ACK、终局和 AX 文本离线复验，候选判据返回 `run_not_completed`，见 `artifacts/b71-audit/2026-11-11-g2-candidate-actual-failed-run.json`。writer 新日志的字节匹配由确定性回归验证，正式实模正例仍待取证。

#### G2 页级使用与 writer 自报

页证据附带已核对的 canonical call ID 与原生 `content.observation_ref`。候选证据给出本 run 的 writer 调用引用。专项从该次 writer 已按 Provider 双键绑定的自报中，逐页核对引用和实际请求中同一个原生 tool 结果的 call ID。仅出现在 Base 或 scope 文本的引用、另一次 writer 的自报、对应其他 call ID 的观察都不足以成立。

计划内读取也进入页级判据。每页用自己的版本、范围、正文和观察身份对账。一个计划里的两页可共用实际父调用 ID，紧邻请求须带有完整且等值的聚合结果。部分成功的聚合按各子观察状态取证。确定性反例覆盖缺版、错版、紧邻请求改写、不可用子观察和父调用绑定错误。

缺页、缺候选或缺页级使用时专项在保留报告后退出。上述补证覆盖确定性机制，首批实模仍为未通过。正式 G2 仍需在真实页面完成合格分页、同次 writer 的页级使用和作者可见候选。修订目标定位沿 [B28](B28-whole-chapter-revision.md) 继续。

### G3 既有批次预算对账

对 [B71 已登记的两次回流](B71-provider-message-fidelity.md#2026-11-11-b81-交付后的完成度复核)，SQLite 中的 canonical assistant 消息均以 `provider_call_ref` 和 `provider_run_ref` 精确匹配上一条 Strata 调用；失败结果按同一 canonical call ID 紧随其后。两次 run 均正常完成，Provider 实际调用数与持久化消耗分别为 5、6，低于各自上限 33、13。独立 G3 批次仍需核验修正授权和预算触顶后的终止行为。

## 变更记录

- 2026-11-08：立项（承接 B71 后续候选；G6 明确移交 B81 CP5）。
- 2026-11-11：按 VS-00L §7 更正 G3 范围，复用 B81 实模报文对账，并登记各批次预注册准备。
