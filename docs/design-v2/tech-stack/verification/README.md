# 技术验证任务目录

> 状态：草案
>
> 目的：把 tech-stack 文档中“需要实测后才能锁定”的工程假设拆成独立、可执行、可验收的 spike 任务。本目录不新增 v2 contract，只验证技术栈落地风险。

---

## 1. 定位

`docs/design-v2/tech-stack/` 回答“推荐用什么技术栈”。

`docs/design-v2/tech-stack/verification/` 回答“这些技术栈假设是否已经被实测验证”。

技术验证任务的输出不是产品功能，而是以下三类结论之一：

| 结论 | 含义 | 后续动作 |
|---|---|---|
| ✅ 通过 | 当前技术选型可以进入 Phase 0 实施 | 把结论回填到对应 tech-stack 文档 |
| ⚠️ 有条件通过 | 可用，但需要约束、fallback 或后续监控 | 更新风险登记 / 路线图 |
| ❌ 不通过 | 当前技术选型不适合作为基线 | 立 ADR 或修改 tech-stack 决策 |

---

## 2. 当前验证任务

| 任务 | 验证对象 | 阻塞范围 | 目标完成时间 | 实测状态 |
|---|---|---|---|---|
| [`paper-trail-ecto-compatibility.md`](./paper-trail-ecto-compatibility.md) | `paper_trail` + Ecto 3.13 + SQLite/PostgreSQL | revision audit / adoption boundary | Phase 0 第 2 周前 | ✅ 通过（2026-04-26） |
| [`structured-output-library-choice.md`](./structured-output-library-choice.md) | `langchain_elixir` structured output vs `instructor_ex` / `instructor_lite` | intent slot / artifact / card payload 结构化输出 | Phase 0 第 3 周前 | ✅ 通过（2026-04-26 二跑，含 `instructor_lite` 1.2 补评，决策：D 主 + A 副 + C fallback） |

实测脚手架在仓库 `spikes/v2_verification/`（独立 mix 工程，自带 README）。一键复跑命令请见各任务文档的"实测脚手架"小节。

---

## 3. 验证任务模板

每个验证任务必须包含：

1. **背景**：为什么不能只靠文档判断。
2. **验证问题**：要回答的具体技术问题。
3. **最小实验**：最小可运行代码或命令。
4. **通过标准**：明确可判定，不使用“看起来可以”。
5. **失败处理**：失败时切换到哪个方案。
6. **结果记录**：实测日期、环境、结论、证据。

---

## 4. 修改纪律

- 本目录可以随 Phase 0 实测快速更新。
- 验证结果若改变技术栈主结论，必须同步更新 `../README.md`、`../13-risks.md`、`../14-roadmap.md`。
- 验证失败不等于立即推翻技术栈；只有影响 Foundation / Domain 核心能力时才升级为 ADR。
