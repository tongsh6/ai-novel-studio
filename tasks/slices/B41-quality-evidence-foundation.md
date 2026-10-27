# B41：质量证据地基——YAML、blocked 分层与 verdict 契约

- 状态：**todo（全量对账确认的 P0 验收基建缺口，未开工）**。
- 登记日期：2026-10-27；来源：3 个 manifest 语法损坏、`ids-by-tier` 未排除 blocked、E2E 聚合器硬写已验收、evidence schema 不能表达真实结果。
- 上游：[全量对账](../2026-10-27-design-to-execution-reconciliation.md)、[known-gaps](../../quality/acceptance/known-gaps.md)、[evidence-schema](../../quality/acceptance/evidence-schema.json)、[B40](B40-judgment-era-acceptance-reanchor.md)。

## 1. 为什么必须先做

当前质量链存在四类根问题：

1. `agentic-loop-budget-deviation-replan`、`au13-review-adjudication-roundtrip`、`b27-prompt-lifecycle-consistency` 三个 YAML 不能被标准解析器解析，但注册为 active/nightly。
2. `quality_manifest_check.sh` / `quality_accept.sh` 主要用正则提取字段，无法可靠识别非法 YAML、重复 ID、缺键和证据词表漂移。
3. `ids-by-tier` 不按 blocked 过滤，nightly 遇到 blocked 后以 65 中止；pass/fail/skipped/not_run/evidence_missing 没有区分。
4. E2E 聚合器只按旧 summary 和硬编码状态写“已验收”，没有 blocked/freshness 判断，可能把 blocked 的 E4 继续写成 PASS。

在这些问题未解决前，后续场景重锚、B39 实模求证和“已完成”声明都缺少可靠证据地基。

## 2. 开工七问

1. **Contract**：现有 quality manifest、evidence schema、known-gaps 分类、E2E 聚合结果和 VS-00K/AU-15 的证据需求。新增 verdict 必须先冻结版本与兼容策略，不另建平行 manifest。
2. **Invariant**：非法 YAML 不得进入运行；必需场景 blocked 时聚合不得 PASS；证据缺失不得默认 PASS；stub/实模、browser/native、历史/current 必须可区分；失败证据不得删除。
3. **Boundary**：`quality/**`、`scripts/quality_*`、`scripts/e2e_01_*`、必要测试与文档。生产 `apps/` 不改；不引入未经检查的依赖或第二套验收框架。
4. **Consumer**：CI/nightly/PR 审核者、后续 B40/B42/B39 的 verifier 与证据索引。
5. **Proof**：3 个损坏文件可被标准解析器读取；故意非法 manifest 被 gate 拒绝；blocked tier 不再当普通失败或 PASS；E2E 必需 blocked 时聚合失败；缺 summary 为 evidence_missing；回归现有 active 场景。
6. **Acceptance Driver**：先以 manifest/CLI/脚本级自动化和负例为主，再选一条真实 Tauri 场景验证端到端 verdict 与报告索引。产品验收感知逻辑 **no**。
7. **Exploration**：不物化作品要素；输出只含验收证据、来源、版本、状态与链接，供后续审计和 replay 查询。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 固定三个 YAML；登记受控解析方案、现有依赖、兼容迁移与负例矩阵；若 verdict/schema 的新字段或枚举属于 C1 contract，先完成对应 ADR，再进入实现 | 未开工 |
| CP1 | 真正 YAML parse 总表/单表、id/tier/surface/entrypoint/必需键/重复项/anti-hooks/证据词表校验；非法文件和未注册场景失败 | 未开工 |
| CP2 | tier 与状态分层：active-only 执行；blocked=skipped+reason；失败=fail；无证据=evidence_missing；未运行=not_run；整批不得因 skipped 变 PASS。单独调用 blocked 必须返回专用非零/not_run 退出码，批量执行只在汇总中记 skipped+reason，不能把跳过当成功，也不能让夜间批次在首个 blocked 处意外中止 | 未开工 |
| CP3 | E2E 聚合器增加 blocked/freshness/来源检查；E4 blocked 时不能写已验收；当前/历史/局部/缺失证据分开 | 未开工 |
| CP4 | evidence verdict schema 与真实消费者：status、reason、artifact links、surface/driver/provider/model/attempts/timeouts/git_head、mechanism/model_behavior、final/failure/scoped 索引；生成与读取同源，旧字段有迁移 | 未开工 |
| CP5 | 全量 manifest/schema/CLI 回归与 B40/B42 交接；known-gaps 增加 retired/driver_stale/evidence_missing/implementation_missing 等可区分类型 | 未开工 |

## 4. 非目标

- 不借修基建批量改 active/blocked 状态；场景重锚归 B40。
- 不用正则在另一个文件重新实现“更聪明的 YAML 解析”。
- 不把 `summary.json` 存在当作 PASS，不把 `final.json` 与 `failure.json` 并存当作全通过。
- 不把实模、原生、浏览器、历史 scoped 证据合并成单一 PASS。
- 不修改产品代码来适配证据格式，不清理失败批次。

## 5. 验证与恢复

- 标准 YAML 解析器读取三文件成功，故意非法/重复/缺键/未注册文件被硬失败。
- `ids-by-tier` 不返回 blocked；批次汇总分别报告 pass/fail/skipped/not_run/evidence_missing。
- E2E 必需 blocked 时 aggregate 不 PASS；旧 E4 重锚或退役后按新结果计算。
- verdict 缺 status 时不能默认 PASS；final/failure/scoped 证据都可定位，浏览器与原生 driver 不混淆。
- 恢复时先读 B40/B42 的场景与证据需求，保持词表一致；缺真实凭据只标 blocked，不改写 verdict。
