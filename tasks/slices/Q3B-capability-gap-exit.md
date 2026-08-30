# Q3b 能力缺口出口：判断协议给「做不到」一个结构化说法

- 状态：done（2026-08-31，`q3b-capability-gap-honest-reply` 真实 Tauri PASS + au02 探索帧回归 PASS + 全门禁绿）
- 类型：D8 病灶收口第二刀（R2，`docs/design/notes/2026-08-30-stage-session-archive-loop.md` §5 根 2）
- 上游：Q3a 语义对账（d4443b57）拦下「矛盾动作」；本刀给拦下之后的意图一个诚实出口
- 队列：NEXT Q3b（用户 2026-08-30 批「按顺序开始执行」）

## 0. 选型（为什么是 reply 子型而不是新 action）

R2 原文给两条路：「决策枚举增加 capability_gap」或「reply 的结构化子型」。选后者：

- 缺口出口的本质是**诚实回复**——告诉作者「这个我做不到，最近的路是 X」。它不
  执行、不计划、不等待澄清，行为学上就是 reply。
- 新 action 牵动 actions enum/dispatch/频道分派全链（KISS 违约）；frame_type 子型
  只扩一个枚举值，前后端对未知 frame_type 均有兜底（framePresentation fallback
  badge / reply_frame_type→casual_reply），扩展是安全侧的。
- 结构化载体零新字段（第四纪律）：缺口事实=frame_type 本身；缺什么=narrative
  （模型的话，归模型）+ dialogue_goal（一句话概括）；最近可行路径=
  candidate_directions（S1 既有结构，Q1b 判例已教模型「有候选引导采纳」）。

## 1. 开工检查（七问）

- **Contract**：VS-00 reply-only contract pack §2.2 两个枚举子集各扩一行——
  `frame_type` + `capability_gap`（作者意图当前无能力承接时的诚实缺口回复）、
  `tool_need.reason_code` + `capability_gap`（缺口即本轮不需要/不能用工具的理由）。
  judgment call2 schema 的 frame_type enum 同源扩展（@reply_frame_types）。
- **Invariant**：**缺口诚实律**（README 原则 13）——能力缺口不得硬选最近邻；
  作者要求系统无能力承接的动作时，得到的是显式承认 + 最近可行路径，而不是只读
  调用冒充写入（D8）或泛化拒绝。既有不变量不破坏：capability_gap 判定零写入、
  零 tool_result、无采纳决策（与 au02 no-production-write 同款）。
- **Boundary**：`novel_domain`（DialogueFrame frame_type/reason_code 枚举各扩一值
  ——domain 校验层锁枚举，纯数据扩展无行为改动）；`novel_application`
  （judgment_protocol 判别规则+枚举、dialogue_planning_service frame 转换，planner
  无改）；`frontend`（framePresentation badge 条目 + copy.ts 文案）；替身
  `apps/novel_agent/test/support/provider/slice_verify.ex` 教新判定。不动
  persistence/web channel。
- **Consumer**：真实作者的「存档/导出类无承接意图」对话轮（stage D8 型）；
  前端 frame badge 呈现；后续 Q3c 作者内容物化落地后，模型可在 capability_gap
  的 candidate_directions 里引导「把你的内容登记为候选」。
- **Proof**：judgment_protocol 单测（capability_gap 进 reply frame 白名单、判别
  prompt 含缺口规则）；dialogue_planning_service frame 转换测试（capability_gap
  → :capability_gap + reason_code :capability_gap）；全量门禁 + I3/I1/I2。
- **Acceptance Driver**：新场景 `q3b-capability-gap-honest-reply`（外部 Tauri
  驱动真实工作台：作者发「把这份大纲存档」且无写入承接 → 自然回复显式承认缺口
  并给路径、候选卡可见、无执行卡/确认卡、planner.form_frame.done
  frame_type=capability_gap、零生产写入）。产品零验收感知（判别规则是真实产品
  语义，服务真实作者，非验收钩子）。
- **Exploration**：不新增要素物化，探索面不适用。

## 2. 任务清单

| # | 任务 | Status |
|---|---|---|
| T1 | judgment_protocol：@reply_frame_types 扩 capability_gap + call2 判别规则行（意图无承接→reply 子型+候选路径；与 Q3a 重试提示、Q1b 判例三方一致） | done（单测 12/12 含白名单用例） |
| T2 | dialogue_planning_service：reply_frame_type/reason_code 子句 + domain 枚举扩值 + **探索强转让位**（见决策日志） | done（planning 单测 18/18） |
| T3 | 前端 framePresentation badge + copy.ts 文案 | done（typecheck/lint/vitest 450 绿） |
| T4 | VS-00 §2.2 两表扩行 + 注记 | done |
| T5 | slice_verify 替身教「存档→capability_gap+路径候选」判定 + 新场景 yml/driver/verifier + 五处注册（索引/README/allowlist×2/nativeSliceIds/keyEvents/case） | done |
| T6 | 门禁 + 场景 Tauri PASS（q3b 新场景 + au02 探索帧回归） | done（两场景 PASS；compile -W/全测/xref/arch/I3/I1/I2/前端三门全绿；扫描 0 touched） |

## 3. 决策日志

- 2026-08-31 — 零新字段：gap_summary 之类结构化字段 YAGNI——narrative 归模型、
  frame_type 归机器、路径归 candidate_directions，三者已覆盖 R2 的「缺什么+最近
  可行路径」。若后续 UI 需要独立渲染缺口原因，再按第四纪律走升级阶梯。
- 2026-08-31 — reason_code 也扩：capability_gap 轮的 tool_need.reason_code 用既有
  四值都不准（insufficient_execution_target 语义是「目标不明」，而缺口轮目标明确
  只是无能力），枚举与 frame_type 同步扩一行，语义精确。
- 2026-08-31 — **探索强转对显式缺口让位**（首跑 RC=1 实锤）：`judgment_frame` 的
  旧规则「有候选⇒creative_exploration」把 capability_gap（带 1 条路径候选）改判
  探索帧，缺口事实在 frame 层蒸发。修=frame 转换 cond 中 capability_gap 优先于
  候选强转；判据：路径候选承载「最近可行路径」（Q3b 契约），不是创作方向探索——
  同一载体（candidate_directions）两种语义，按显式 frame_type 分流而非按载体在场
  与否推断（与 D7「不从缺省推断意图」同判据族）。单测钉住（planning service
  「capability_gap 帧不被候选强转」）。
