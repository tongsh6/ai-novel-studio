# Agentic 模式下的测试验证体系：现状梳理与演进方案（探索）

> 状态：讨论备忘（不冻结 schema、不授权实现）。结论需升级为 `docs/engineering/` 规范 + `quality/` 运行体系扩展 + slice 后方可实施。
>
> 来源：2026-07-05 测试验证体系调研（对话记录）；实证输入：2026-07-04 狗粮长跑暴露的僵尸 run（stub 全绿/真实模型违约）、ADR-0023 CP 迁移引发的数十个 verifier 口径重写、CP4 意图规则静默丢失、live tool calling 零验证缺口。
>
> 原则约束：本方案**扩展**既有 `quality/` 五层模型与 SSOT 落点，不新建平行体系（AGENTS.md 禁止自建孤岛）。场景化验收红线（外部自动化、产品零验收感知、证据为本）全部保留。

---

## 1. 现状盘点（调研结论）

### 1.1 既有资产（相当扎实的底座）

| 层（quality/README 五层模型） | 现状 | 规模/入口 |
|---|---|---|
| L1 Spec/Design | 设计→ADR→contract pack→slice 六问追踪链 | `docs/design/`, `tasks/slices/` |
| L2 Architecture Guard | 编译零警告、xref 循环、arch_check、frontend_audit、design_trace、enum lint、ADR trace、schema/enum codegen drift、credo、dialyzer | CI 全接线 |
| L3 Runtime Invariant | I1 因果绑定 / I2 输入差异 / I3 种子贯通（CI 强制）+ N-NARR 叙事字节溯源 | `scripts/scenario_invariants/` |
| L4 Scenario Acceptance | **155 个场景（151 Tauri surface）**，外部 Playwright 驱动真实工作台，确定性 slice_verify 替身 + live provider 变体；tiers：pr-smoke / nightly / known-gap / **release、release-real-llm（已定义、空置）** | `quality/acceptance/`, `scripts/quality_accept.sh` |
| L5 Evidence/Report | evidence-schema.json、summary.json、app-log JSONL、llm-calls HTTP log、websocket 帧、截图、静态扫描处置台账 | `artifacts/`, `reports/` |

层外资产：后端 1200 / 前端 384 单测；狗粮长跑（重型门，需用户批准）；`walkthroughs/` 人工走查；task_done manifest。

### 1.2 Agentic 化之后暴露的结构性缺口（全部有实证）

**G1 确定性替身与真实模型的行为鸿沟（最核心）**。slice_verify stub 永远守约：按提示词返回合法 JSON、artifact 后乖乖 done、强制 tool_choice 时给非空 content。真实模型三者都违约过：僵尸 run（完成信号被无视，狗粮实锤）、坏 JSON（10 万字长跑反哺的重试）、空 content 风险（CP4 未验证）。**现体系在「stub 全绿」和「45 分钟狗粮」之间没有任何一层测量真实模型的行为契约**——所有真实模型行为问题都要等到最贵的一层才暴露。

**G2 点断言口径脆弱**。verifier 大量断言精确 provider_calls 数（conversation=3、prose=4…）。ADR-0023 一次架构迁移重写了数十个场景断言；下一次架构演进还会再来一遍。对 agentic 系统，**精确轨迹断言天然与非确定性冲突**——真正稳定的是不变量（预算上界、门在写之前、计划版本单调、叙事可溯源），不是轨迹。

**G3 live 矩阵近乎空置**。release-real-llm tier 定义了但零场景登记；LM Studio live 证据停在 tool calling 之前；DeepSeek 凭据阻塞。真实模型验证的制度化位置存在但没有内容。

**G4 纵向验证只有重型档**。单场景 Tauri（分钟级）与狗粮（45 分钟+）之间无中间档；跨轮次不变量（字数单调累积、跨 turn 帧不串、记忆召回一致性）只有狗粮能验。

**G5 解析器对真实输出的鲁棒性无回归资产**。llm-calls 日志和 ProviderRunLog 里躺着大量真实模型输出（含引发过事故的），但没有语料化——每次解析器加固靠事故驱动，修完就丢。

**G6 故障注入零散**。evaluator-degrade、provider-error、cancel 等诚实降级场景存在但按事故逐个生长，没有「故障类型 × 调用点」的系统矩阵。

**G7 创作质量不在体系内**。I10 人工盲评悬空；prose-ai-taste 分析性度量（对白密度等）原型验证过但未制度化。体系度量「链路诚实」，不度量「写得好不好」。

**G8 工程卫生**：狗粮共用 test DB（本会话两次撞污染）；driver 超时/重试策略各自为政。

## 2. 方案设计：Agentic 验证金字塔（扩展五层模型）

核心原则一句话：**对非确定性系统，断言不变量而非轨迹；对模型行为，统计验收而非单次验收；每次真实失败沉淀为语料**。

```text
L7 创作质量评估      人工盲评 + 分析性趋势遥测（非门禁）        ← 新
L6 纵向长跑          mini-dogfood（release-real-llm 层）+ 狗粮   ← 补中间档
L5 Evidence/Report   （保留，增断言分级标签）
L4 Scenario 验收      断言三分级改造 + 故障矩阵系统化            ← 改造
L3c 语料回放回归      真实模型输出语料 → 解析器离线回归           ← 新
L3b 模型行为契约      MBC probes：统计式行为验收（live 小探针）   ← 新（补 G1）
L3a Runtime 不变量    I1/I2/I3/N-NARR/N-PLAN（保留）
L2 Architecture Guard（保留）
L1 Spec/Design       （保留）
```

### 2.1 L3b 模型行为契约（MBC probes）——填最大的洞

**是什么**：一组廉价、独立、可统计的 live 探针，直接测「这个 provider 上的这个模型是否遵守 loop 依赖的行为假设」。不走 UI、不起 Tauri，直接打 provider 层，单探针秒级。

| 探针 | 验证的行为契约 | 曾经的事故 |
|---|---|---|
| tool-call-compliance | 强制 tool_choice 时返回合法 tool call **且** content 非空 | CP4 空 content 风险（未测） |
| plan-schema-validity | 计划起草 N 次的 schema 合法率 ≥ 阈值 | 坏 JSON 灭 run |
| completion-compliance | 观察含 artifact_created 时 done 率 ≥ 阈值 | 僵尸 run |
| intent-classification | 标注小语料（10-20 条真实输入：续写/重写/首稿/点名不存在章）分类准确率 | 整章覆盖回归、G13 |
| routing-accuracy | 路由小语料命中率 | 「答非所问」误路由 |

**统计口径**：每探针 N 次（如 N=10），pass-rate 阈值按 provider 档位定（floor 档阈值可低但必须显式）。产物落 `artifacts/model-contracts/<provider>/summary.json`，趋势可比。

**落点**：`quality/model-contracts/`（manifest+语料）+ `scripts/model_contracts/run.exs`；nightly 在本地/自托管 runner 对 LM Studio 跑（tiers.md 已有「真实 LLM gate 在本地 runner」先例）。**这一层让「换模型/换 provider/改 prompt」有了小时级的行为回归信号**，prompt 变更（如 CP4 那次）不再裸奔到狗粮才暴露。

### 2.2 L3c 真实输出语料回放——把事故变资产

从 llm-calls 日志、ProviderRunLog、狗粮产物中**筛选真实模型输出**（尤其引发过解析失败/误判的）存为 fixtures（`quality/acceptance/fixtures/model-corpus/`，按调用类型分目录：plan-draft / plan-revision / creative-json / evaluator / routing）。纯离线单测逐条回放过解析器，零 provider 成本。规则：**每次 live 事故的原始输出必须入语料**（类比 static-scan 的处置台账纪律）。解析器加固从事故驱动变为语料驱动。

### 2.3 L4 改造一：断言三分级（治 G2 口径脆弱）

场景 verifier 断言分三类并在 scenario yml 打标签：

| 级别 | 内容 | 稳定性预期 |
|---|---|---|
| A 结构不变量 | 门在写前、adoption 前无生产写、计划版本单调、replan ≤ 预算、叙事有 provenance、pending 候选 ≤ 预算 | 跨架构演进稳定，**默认断言形态** |
| B 经济学口径 | 精确 provider_calls / steps 数 | 有意义但易变；**收拢进独立「经济学清单」**，架构变更时一处集中迁移并作为成本回归报表 |
| C 内容/叙事 | 逐字可见、字节溯源、种子贯通 | 由 I 系/N 系不变量框架承载 |

改造后再有 ADR-0023 级别的架构迁移，A/C 类断言零改动，只有 B 类清单一处集中更新——把这次「数十个 verifier 重写」的成本降一个量级。

### 2.4 L4 改造二：故障注入矩阵（系统化 G6）

把零散的降级场景整编为矩阵：**故障类型**（坏 tool call / 空 content / 超时 / SSE 截断 / 中途取消 / 5xx）×**调用点**（路由 / 计划起草 / 修订 / writer / evaluator），每格断言「诚实降级」不变量（不伪装成功、不伪造发现、tentative 不丢、run 终态诚实、作者可见文案诚实）。注入全部在 harness 侧（slice_verify provider 故障模式），产品零感知。已有场景（evaluator-degrade 等）归位入矩阵，缺格补齐——矩阵本身就是覆盖率报表。

### 2.5 L6 纵向中间档：mini-dogfood 入 release-real-llm 层

2-3 章、6-10 分钟、真实 LM Studio 的缩微长跑，登记进**空置的 release-real-llm tier**（复用 dogfood runner 的 `--chapters 2`，加纵向不变量断言：字数单调累积、0 runner retry、无 awaiting_author 僵尸终态、无跨 turn 帧误配）。定位：比狗粮便宜一个量级、比单场景多验「跨轮次」维度；仍属重型档，**按既有纪律经用户批准运行**，但批准成本低到可以跟随每个主链 CP。全量狗粮保留为里程碑级验证。

### 2.6 L7 创作质量评估（I10 制度化，非门禁）

- **人工盲评协议**：定期（里程碑级）从导出作品抽样 → 盲评打分表（连贯性/人物一致性/AI 味）→ 报告落 `walkthroughs/<date>/`（既有落点），结论按 project-ledger 规则登记。
- **分析性趋势遥测**：把 prose-ai-taste 验证过的可测指标（对白密度、句长分布、真实指纹词频——注意用本地模型真实指纹而非照搬外部黑名单）做成对狗粮/mini-dogfood 产物的自动报表，落 `artifacts/novel-output/*/quality-metrics.json`。**趋势可见即可，不做 gate**（地板模型阶段 gate 化会误伤）。
- LLM-as-judge 延后：需要强模型凭据，登记为 blocked 扩展。

### 2.7 工程卫生（G8）

- 狗粮/mini-dogfood 独立 DB（env 注入路径），与 mix test / 验收 harness 隔离——消除本会话两次撞到的污染类失败。
- driver 超时/重试策略集中为共享常量（现状各驱动各写）；flake 隔离标签（known-gap 机制已有，补 flaky 语义）。

## 3. CI/运行节奏映射

| 节奏 | 内容 | 现状差异 |
|---|---|---|
| PR | L1/L2 + I1/I2/I3 + 全量单测 + pr-smoke | 不变 |
| Nightly（本地/自托管 runner） | Tauri active 集 + **MBC probes（lmstudio）** + N-NARR | +MBC |
| 每主链 CP（经批准） | **mini-dogfood** + 语料回放全量 | 新增 |
| 里程碑 | 全量狗粮 + 人工盲评 + 质量趋势报表 | I10 落地 |

## 4. 分期落地建议（CP 切分）

| CP | 内容 | 回报 |
|---|---|---|
| CP0 | 断言三分级改造 + 经济学清单收拢（§2.3） | 最大 ROI：下次架构演进省数十 verifier 重写 |
| CP1 | MBC probes MVP：tool-call-compliance + completion-compliance + intent 语料，LM Studio（§2.1） | 填 G1；prompt-hardening slice 的 T2 live 验证可直接复用此框架 |
| CP2 | 语料回放 harness + 首批语料（从既有 llm-calls/狗粮产物回填）（§2.2） | 解析器回归零成本化 |
| CP3 | 故障矩阵整编补格（§2.4）+ mini-dogfood 入 release-real-llm（§2.5）+ 狗粮 DB 隔离 | 纵向与降级系统化 |
| CP4 | I10 盲评协议 + 质量趋势遥测（§2.6） | 产品价值进入测量 |

## 5. 与既有体系的关系声明（防孤岛）

- 五层模型不推翻：L3b/L3c 是 L3 的兄弟层，L6/L7 是 L4/L5 之上的运行节奏层；全部落点在 `quality/`、`scripts/`、`artifacts/`、`walkthroughs/` 既有目录。
- tiers.md 的 release/release-real-llm 空置层被 §2.5 填充，不新造 tier。
- 场景化验收红线、承重 slice 六问、狗粮重型门纪律（用户批准）全部继承。
- 与在册 slice 的衔接：`UA01-agentic-loop-prompt-hardening` T2（live 双通道验证）= CP1 的第一个消费者；`UA01-bounded-run-single-candidate-termination` T5（狗粮 0 retry）= §2.5 mini-dogfood 的首个纵向断言。

## 6. 未决问题（实施前需拍板）

1. MBC probes 的 pass-rate 阈值按 provider 档位定值（floor 档多少算「可接受的不守约率」）。
2. mini-dogfood 的批准粒度：逐次批准 vs 「每主链 CP 自动附带」的一揽子授权。
3. 经济学清单（B 类断言）保留多少精确口径 vs 全部改上界。
4. 语料入库的脱敏/体积治理（llm-calls 原文含创作内容）。
