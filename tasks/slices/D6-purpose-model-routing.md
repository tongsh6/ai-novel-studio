# D6 按用途分模型：purpose→model 路由表与 route_hint 细化通道

- 状态：done（2026-08-25）
- 类型：M5 狗粮产品债 D6 收口（`docs/design/notes/2026-08-25-m5-dogfood-observations.md` §3，新刀）
- 启动日期：2026-08-25
- 拍板（2026-08-25 用户「直接开①+③，目前的实现目标还是全局一个模型」）：落地路由机制
  （①同 provider 内 purpose→model 表 + ③route_hint 轻量键细化），**默认态=表空全跟随
  全局单模型**，不切多模型运行；②跨供应商路由不做；④对照狗粮取数另行拍板。

## 1. 开工检查（七问）

- **Contract**：SU-01 模型供应商契约扩展（provider config 新增可选 `purpose_models`
  表；「模型名不由作者手输」立场不变——覆盖控件同全局模型一样吃供应商模型列表）；
  ProviderRun.purpose 冻结枚举**零改动**（粒度细化走 dependency `route_hint` 新读取
  通道，慎重新增实体阶梯第三级）。
- **Invariant**：表空/键缺失/未知键=严格跟随全局默认模型（默认行为零变化）；显式
  `model` 参数仍最高优先；路由只改模型选择，不改 purpose 归因/日志/体温计口径；
  provider_gateway 日志与 ProviderRun.model 如实记录路由后模型（不谎报）。
- **Boundary**：`novel_agent`（Gateway 路由查表 + Execution route_hint + 配置归一）、
  `novel_application`（盘点铸造点挂 route_hint 一处）、`novel_web` 零改动（configure
  params 透传）、frontend（设置对话框覆盖区 + modelProvider 存取链）、Rust（偏好
  持久化）。不动 ProviderRun 契约、persistence、replay。
- **Consumer**：模型设置对话框（作者按用途覆盖）；Gateway.execute 全部调用（funnel
  单点，调用面零改动）；狗粮/走查（按用途指认模型）。
- **Proof**：gateway 单测（表命中/表空跟随/route_hint 先于 purpose/未知键忽略/显式
  model 最高优先/configure 归一白名单）；execution 单测（with_route_hint 重建闭包）；
  modelProvider.ts 单测（payload/存取归一带 purpose_models）；真实 Tauri 场景（下）。
- **Acceptance Driver**：新场景 `d6-purpose-model-routing`——外部 driver 经公开
  `PUT /api/provider/config` 注入 writer 覆盖（su01-lmstudio-disconnected-health
  判例：config API 属外部公开面），随后**像用户一样**在真实工作台发创作消息，
  以 app JSONL `provider_gateway.complete.start` 证明该 turn 的 writer 调用用了
  覆盖模型、其余调用仍走全局模型；并打开模型设置对话框断言「按用途指定模型」区
  真实可见。产品零验收感知逻辑。**诚实边界**：覆盖 select 在 stub 下无模型列表
  （stub 无 list_models），UI 全链选择→保存→路由需真实 LM Studio 双模型观察，
  登记为下次狗粮/走查观察项。
- **Exploration**：不新增要素/数据物化，探索面不适用（模型路由是运行时配置）。

## 2. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | Gateway：purpose_models 查表（route_hint 先于 purpose、白名单、跟随全局兜底）+ configure 归一 + 单测 | done | gateway 6 例（命中/hint 先于 purpose/显式 model 最高/空表兜底/归一白名单/无表零键）；入口日志补 purpose/route_hint |
| T2 | Execution：route_hint 字段与 with_route_hint 重建 + 盘点铸造点挂钩 + 单测 | done | 重建闭包携带 route_hint；fact_inventory funnel 挂 :fact_inventory |
| T3 | 前端+Rust：偏好结构、payload、启动重放、设置对话框「按用途指定模型」区（select 吃模型列表）+ 单测 | done | modelProvider 全链归一/透传；vitest 449 + verifier 201；cargo test 绿 |
| T4 | 场景 d6-purpose-model-routing 真实 Tauri + 门禁 + task_done + 收口 | done | 真实 Tauri PASS（writer 1 次命中覆盖、其余 6 次全局）+ 门禁全绿 |

## 3. 决策日志

- 2026-08-25 — 路由表寄生在既有 provider config keyword（`purpose_models` 键），不给
  RuntimeConfig 加新状态字段：配置进出走同一条 configure 链，清理/切 provider 语义
  自然继承（慎重新增实体）。
- 2026-08-25 — 路由键白名单 `writer/planner/evaluator/fact_inventory` 四键起步：前三
  个是既有 purpose 枚举独立键，盘点靠 route_hint 细化（purpose=:tool 共键考据见
  slice 分析）；未知键忽略而非报错——配置是偏好不是命令。
- 2026-08-25 — 覆盖控件为 select 而非自由输入：SU-01 冻结立场「模型名不由作者手输」。

## 4. 试行反馈

- **顺带修既有真缺陷（purpose 裸穿）**：生产注入的 provider 依赖此前只有 fallback 构造
  带 purpose，注入路径 writer/evaluator 到 Gateway 一直是默认 :conversation——M5 体温计
  的 writer 归因其实来自投影器 stage 旁路，不经 Gateway。flow funnel 统一
  `Execution.with_purpose` 后，ProviderRun 归因与按用途路由才真正同源。修后场景证据：
  7 次 gateway 调用 purpose 分布 writer×1（命中覆盖模型）/planner×3/evaluator×1/
  author_reasoning×2（全局模型）。
- **driver 判例**：模型设置入口按钮的可访问名是健康态文本（模型已连接/未连接），不含
  「模型设置」——getByRole name 匹配超时；改用 `[class*="modelStatusButton"]` class 选择
  器（su01-provider-health-model 同款）。
- **观测增强**：`provider_gateway.complete.start` 日志补 purpose/route_hint 字段，
  按用途路由自此在 app JSONL 直接可证。
- **诚实边界**：UI 内 select→保存→路由全链在 stub 下不可驱动（无模型列表），需真实
  LM Studio 双模型观察，登记为狗粮/走查观察项；跨供应商路由（purpose→provider）未实现、
  未承诺；路由表当前默认为空=全局单模型（拍板要求），填表动作待对照取数后另行拍板。
