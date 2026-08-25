# D5 盘点回路思考型适配：摘要材料、退化降批与瞬态重试

- 状态：done（2026-08-25）
- 类型：M5 狗粮产品债 D5 收口（`docs/design/notes/2026-08-25-m5-dogfood-observations.md` §3）
- 启动日期：2026-08-25
- 拍板（2026-08-25 用户「同意」）：A 输入换四栏摘要（缺失回退正文截断，与 D3 摘要供给链闭环）+ B 退化自动降批重试（提案合并去重）+ C 瞬态族单次重试（退化 retryable:false 排除）；D prompt nudge 不做；E 治本归 D6。

## 1. 开工检查（七问）

- **Contract**：VS-00G 盘点提炼引擎语义不变（提案→作者采纳）；材料源从正文摘录扩为
  「治理摘要优先、正文回退」（材料仍 `[%{seq,title,prose}]` 形状，零契约变更）；
  新事件 `fact_inventory.batch_fallback.start`（ADR-0018 口径）。
- **Invariant**：提案只源于材料（不发明）；降批合并不产重复 item_id；两级仍败诚实失败；
  同步测试环境行为可控（材料读端口可注入不变）。
- **Boundary**：`novel_persistence`（材料读端口改摘要优先）、`novel_application`
  （service 瞬态重试 + flow 降批循环与合并）；不动 web/frontend/替身。
- **Consumer**：盘点 run（真实模型），作者采纳链；狗粮观察（退化率/降批率）。
- **Proof**：材料读端口单测（摘要优先/缺失回退）；service 瞬态重试单测（D4 同款三例式）；
  flow 降批单测（首调退化→降批两批成功→提案合并去重）；`au14-fact-inventory-roundtrip`
  真实 Tauri 复跑（盘点主链回归）。**诚实边界**：退化→降批的页面级自愈只能真实模型观察
  （替身不退化），记入下次狗粮观察项。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh au14-fact-inventory-roundtrip`（回归载体）；产品零验收感知。
- **Exploration**：材料换源不改探索面；提案落位既有采纳链——不适用新增。

## 2. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 材料读端口：四栏摘要优先、缺失回退正文截断（persistence）+ 单测 | done | A′ 考据反转：逐章混合（摘要按 seq 对位替换、缺失章回退正文），非整书 all-or-nothing；repo 单测 16/16 |
| T2 | service 瞬态族单次重试（retryable:false 排除）+ 单测 | done | 退化直退不盲重；service 单测 20/20 |
| T3 | flow 退化降批（减半分批、提案合并去重、batch_fallback 事件）+ 单测 | done | 减半至最小批 3、提案 item_id 去重合并；flow 单测 2/2（真实 harness 起 run） |
| T4 | au14 回归 + 门禁 + task_done + 收口 | done | au14 真实 Tauri PASS + 门禁全绿 |

## 3. 决策日志

- 2026-08-25 — 降批循环放 flow 层（service 保持纯提炼函数）：材料切批与提案合并是编排
  语义；最小批 3 章，减半至最小批仍败则整体失败（诚实）。
- 2026-08-25 — 摘要优先的语义依据：四栏摘要是治理层为下游消费建的提炼产物（信息密度
  高于正文截断 700 字符），盘点目标=承重事实，四栏（情节/人物/伏笔/情绪）足以承载；
  D3 惰性补做保障摘要几乎总在，缺失章诚实回退正文。

## 4. 试行反馈

- **考据反转（A→A′）**：拍板文案是「摘要优先、缺失回退正文」，落地考据发现整书
  all-or-nothing 语义会让一章缺摘要拖全书降级回正文截断；实现反转为**逐章混合**——
  摘要按 seq 对位替换该章正文材料，缺失章各自回退，材料形状与消费端零变更。
- **flaky 判例**：flow 降批单测最初断言全局 `log_jsonl` env 落盘文件含
  `fact_inventory.batch_fallback`——单文件绿、全量套件红（该 env 是全局 Application env，
  被并发测试翻动致文件空）。改为确定性 provider 调用计数断言（1 次全量失败 + 左右两半
  各 1 次 = 恰 3 次）。事件留痕的存在性由代码路径与 au14 回归覆盖。
- **测试助手坑**：`insert_reading_chain` 硬编码章 seq=1，两章混合断言若走它则摘要
  seq 映射互相覆盖；须直插不同 seq 的 Volume/Chapter/Scene/Draft。
- **诚实边界**：退化→降批的页面级自愈只能真实模型观察（替身不退化），已记入下次
  狗粮观察项。
