# B70：作者行为语料生成与状态探索验证体系

- 状态：**doing（2026-10-30 CP0 登记；目标模板、冻结语料、oracle、覆盖报告与复用边界待冻结）**。
- 类型：验证基础设施；仓内管理、运行时外挂、证据内生、判卷外部，不新增生产验收感知能力。
- 来源：作者指出现有真实页面验收多为从历史日志提取的固定输入与操作剧本，覆盖过窄；独立开发阶段不能依赖持续人工创作生产语料。作者确认采用“少量人工目标模板 + 离线生成与冻结 + 自动状态探索 + 失败驱动回归”的方向，并同意先登记任务再开始 CP0。
- 关联：[B27](B27-systematic-prompt-and-intent-integration.md) 自然语言语义与 20 例案例、[B34](B34-author-intent-corpus-validation.md) 历史语料与覆盖矩阵、[B37](B37-acceptance-wait-supervision.md) 外部运行监督、[B40](B40-judgment-era-acceptance-reanchor.md) 场景重锚、[B41](B41-quality-evidence-foundation.md) manifest/verdict、[B42](B42-model-behavior-evidence-tier.md) 机制/模型行为证据分层。

## 1. 问题与目标

现有体系能够证明固定剧本穿过真实主链并留下可信证据，但不能充分证明不同自然表达、作品状态和操作顺序下仍具有正确行为。I1/I2/I3 证明内容来源与输入贯通，不证明语义理解和作者行为覆盖。

本任务建立一套低人工维护成本的验证体系：

1. 人工只维护少量作者目标、状态、允许结果与禁止行为，不逐条编写长期 UI 剧本。
2. 离线生成并冻结多表达、多上下文语料，记录来源、版本、开发/回归/保留/探索分组；日常测试不重复调用生成模型。
3. 数据驱动回放与状态驱动随机探索共用外部真实 UI 主链；每步检查全局硬不变量。
4. 自动保存种子、轨迹和证据，失败去重并尽可能缩化为最小复现，修复后沉淀永久回归。
5. 结果进入既有 B41/B42 证据与分层体系；确定性机制、真实模型行为、文学质量不得互相代签。

## 2. 范围与非目标

### 范围

- `quality/acceptance/` 中的目标模板、案例、状态与判卷/覆盖契约及场景注册。
- `scripts/` 中的离线生成、校验、选择、运行、oracle、覆盖统计和失败缩化工具。
- `frontend/slice-verify/` 中产品之外的共享 UI 动作、观察与证据采集能力。
- test/support 或外部 harness 的隔离 fixture/seed；不得注册进生产 runtime。
- PR 小子集、后台/夜间探索、真实模型语义子集的执行分层。

### 非目标

- 不在 `apps/*/lib` 或 `frontend/src` 增加验收开关、自动操作、slice 识别、专用 DOM hook 或上报事件。
- 不重建 B41 verdict、B42 evidence chain、native manifest 或另一套任务/文档目录。
- 不用 LLM 生成器自行定义并自行签署正确性；语义未知可记 `unknown`，不得硬判 PASS。
- 不把模型合成语料冒充广泛真实用户代表性，不把文学质量并入机制 PASS。
- 不一次性重写全部既有固定场景；它们继续作为机制回归，新能力先与少量代表场景交叉验证。

## 3. 开工七问

1. **Contract**：消费 B27 `b27-semantic-cases-v1` 的自然输入/夹具/允许路径/禁行为/保留集思想，B34 历史语料与覆盖矩阵，B41 `quality-verdict/v2`、manifest/退出码，B42 evidence requirements/evidence chain/release layer。CP0 冻结作者目标模板、冻结案例、状态、oracle、provenance/split、覆盖报告五类格式及版本策略；如需改变生产 contract，必须另列承接，不在验证工具中暗改。
2. **Invariant**：未授权/未采纳零 canon 写入；不得操作错误作品、对象或版本；重复动作不得产生重复副作用；页面完成声明必须有持久事实；supplied≠used；缺证据/旧 HEAD/blocked/unknown 不得 PASS；保留集不得按具体措辞调词；确定性替身不代签真实模型行为。
3. **Boundary**：只改 `quality/`、`scripts/`、外部 `frontend/slice-verify/`、测试专用 fixture/support 与本任务文档。生产 `apps/`、`frontend/src` 默认不改；任何真实产品观测缺口须证明其用户/审计价值并另行接受。
4. **Consumer**：首个消费者是开发者经 `scripts/quality_accept.sh` / `scripts/tauri_slice_verify.sh` 驱动的当前 `WorkspaceChat` 真实工作台；后续消费者为 B27/B39/B42 的语义与求证验证及 PR/nightly/release 审核。
5. **Proof**：格式/生成器/oracle/选择器有自动化正反例；同一模板实际产生不同表达与状态；负例必须能被抓到，不能只证明 happy path；最小数据驱动闭环必须由外部脚本操作真实页面并保存网络/日志/持久化证据；状态探索失败必须可按种子复现。
6. **Acceptance Driver**：复用现有 `quality_accept.sh`、`tauri_slice_verify.sh` 与 native allowlist，新增的数据驱动场景必须登记 manifest，由产品外 driver 输入、点击、确认、拒绝或采纳并读取外部证据。产品新增验收感知逻辑：**no**。
7. **Exploration**：本任务不新增产品作品知识供给或固定 prompt packet；涉及模型声称使用作品事实的案例，复用现有只读探索目录和 B42 Base→Observation→后续真实请求→used refs 证据链。语料生成模型不获得作者私有作品事实，除非另有明确授权与脱敏边界。

## 4. 目标结构

```text
人工目标模板（少量）
→ 离线生成/去重/过滤/分组
→ 冻结语料与状态矩阵
→ 数据驱动回放 或 状态驱动探索
→ 真实 UI / socket / application / persistence
→ 外部硬不变量 + 语义允许集合 + 覆盖统计
→ B41 verdict / B42 证据分层 / artifacts
```

硬事实自动判定；语义按允许结果集合与禁行为判定；文学质量仍归独立真实模型/人工评价。作者模拟器或生成模型不得给自己判分。

## 5. Checkpoint 与完整闭环

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 盘点 B27/B34、现有 UI driver、dogfood/native runner、B41/B42 的可复用边界；冻结目标模板、案例、oracle、provenance/split、覆盖报告格式与执行分层；确定首批代表场景和负例 | **doing**：任务与边界已登记，格式和资产映射待完成 |
| CP1 | 最小数据驱动闭环：至少 3 个作者目标族，包含多表达、多状态及同句异境/歧义负例；共享外部 UI driver 穿过真实主链；自动硬断言与证据 verdict；生成器/oracle 正反例通过 | todo |
| CP2 | 状态驱动探索：动作选择、随机种子、全局不变量、状态/转移覆盖、失败轨迹保存与缩化；至少一个非固定操作顺序场景由外部真实页面闭环 | todo |
| CP3 | 覆盖扩展与分层：按 B34/新发现缺口扩展目标族；PR 受影响子集、后台/夜间探索、真实模型语义子集入口；失败转回归、完整门禁与文档索引；真实模型语义结论仍归对应产品/B42 流程，不以 stub 代签 | todo |

CP1 只是最小实现 checkpoint，不替代 CP2 状态探索和 CP3 覆盖/分层后果；全部计划内范围未闭环前不得将 B70 标 done。

## 6. CP0 工作清单

- [ ] 核对现有案例/fixture/场景格式，明确哪些直接复用、哪些 additive 扩展，避免第二套 verdict 或语义语料真源。
- [ ] 核对 `external-ui-driver.mjs`、`dogfood-runner.mjs`、native verifier 的动作、观察、等待与证据边界，确定共享抽取点；不把新语料继续堆进大型场景分支。
- [ ] 冻结目标模板、冻结案例、状态/oracle、来源与分组、覆盖报告格式；保留集与生成集版本不可混淆。
- [ ] 冻结低成本执行策略：生成一次长期复用、PR 按影响选择、后台跑扩展、真实模型只跑语义子集。
- [ ] 选择 CP1 代表目标与负例，定义如何证明自动判卷能拒绝错误对象、越权写入、重复副作用和虚假完成。
- [ ] 明确真实日志/作品的使用边界：默认使用合成样书；真实材料须授权、脱敏，生成模型不得默认读取。

## 7. 验证与恢复

- 文档/排期：`node scripts/next_task_check.mjs`；差距来源变化时按规则运行 `bash scripts/gap_ledger.sh`。
- 工具局部：`node --test scripts/lib/quality/*.test.mjs` 及新增格式的既有测试入口；本机 PyYAML/Bash 依赖问题必须如实记录，不能跳过 manifest 后声称全绿。
- 真实页面：`bash scripts/quality_accept.sh <scenario-id>` 或 `bash scripts/tauri_slice_verify.sh <scenario-id>`，证据落 `artifacts/slice-verify/`。
- 完成实现后执行项目规定的后端/前端门禁、I1/I2/I3、静态扫描闭环；只改验证工具也不能省略其覆盖范围内的检查。
- 恢复时先读本任务 CP 状态与关联 manifest，再从对应 artifact/seed 恢复；不得从历史 PASS 推断当前 HEAD 通过。

## 8. 当前未闭环与下一步

当前只有任务登记和方向确认，尚无新语料格式、生成器、共享状态探索器或新场景 PASS。下一步完成 CP0 资产映射与格式冻结，再进入 CP1 最小真实页面闭环；不先建设独立仓库、大型语料平台或生产内嵌验收功能。
