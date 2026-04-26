# Phase 0 · Week 1 · 仓库脚手架 + 第一份 Schema

- 启动日期：2026-04-26
- 范围依据：`docs/design-v2/tech-stack/14-roadmap.md` §2（任务定义在那里，本文件仅跟踪状态）
- 完成标准依据：同上 §2.2

## 任务清单

引自 `14-roadmap.md` §2.1。

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | 仓库结构初始化（apps×4 + frontend + tauri + experiments + tools + config） | done | `8be29f1` | 仅空目录骨架，未注入 `mix new` / `pnpm init` |
| T2 | 工具链 setup（Homebrew 装 Elixir/Erlang/Rust，nvm 校验 Node） + 团队 onboarding 文档 | todo | — | 本机 Elixir/Erlang 未装；走 Homebrew（local-ai-policy） |
| T3 | Mix umbrella + 4 个 apps 的 `mix.exs` + `mix deps.get` 通过 | todo | — | 依赖 T2 |
| T4 | Phoenix endpoint 骨架 + `mix phx.server` + `/health` 返回 200 | todo | — | 依赖 T3 |
| T5 | Frontend 骨架 + `pnpm dev` 启动 + hello world 页面 | todo | — | 独立于 T2-T4，可并行 |
| T6 | Tauri 骨架 + `pnpm tauri dev` 加载 frontend | todo | — | 依赖 T5 + Rust 工具链 |
| T7 | `docs/design-v2/schemas/turn_result.json`（按 ADR-0001 §3） | todo | — | 独立任务，可在等 Elixir 装时做 |
| T8 | Schema codegen：`mix codegen.schemas` + `pnpm codegen:schemas` | todo | — | 依赖 T3 + T7 |
| T9 | GitHub Actions CI：`mix test` + `pnpm test` | todo | — | 依赖 T3 + T5 |

完成标准（来自 `14-roadmap.md` §2.2）：
- 团队任意成员按 `12-development.md §2.0` 完成工具链校验后，clone + `mix deps.get` + `pnpm install` 跑得起来
- 三栈（Phoenix / Vite / Tauri）三终端都能 dev-server 启动
- CI 至少跑通一个 dummy test
- `turn_result.json` reviewed + commit

## 决策日志

倒序，最新在上。

- **2026-04-26 23:30** — 新建 `tasks/` 目录承载执行层（状态/卡点/决策日志），与 `docs/`（规划）+ `adr/`（决策）+ `.sisyphus/plans/`（一次性集中作战计划）分离。理由：会话切换时无损接力。
- **2026-04-26 23:12** — 仓库重布局完成（commit `8be29f1`）。A1（v1 Python 残留直接清掉，源码留 git 历史）+ B1（spikes/v2_verification 原位保留）。
- **2026-04-26** — 目录布局严格按 `tech-stack/12-development.md §1`，不再讨论替代方案。

## 卡点 / TBD

- **T2 工具链**：本机当前未装 Elixir/Erlang。需先 `brew install elixir erlang`，已确认走 Homebrew 路径（local-ai-policy）。
- **Node 版本不一致**：本机 Node 24.14.1 vs roadmap 目标 20.x。Phase 0 第 1 周需验证 Vite 6+ / phoenix npm client / Tauri CLI 在 Node 24 是否兼容（参考 `12-development.md §2.0`）。
- **T5/T7 可并行**：等 Elixir 装时不必停工。
- **路线图 §11 TBD**（团队成员、prompt 设计、provider 选择、pencil 介入时机）暂未影响 Week 1 推进，留到 kick-off 会议确认。

## 下次会话恢复指引

接手者（无论是 AI 还是人）按以下顺序读取上下文：

1. `docs/design-v2/README.md` §1（总目标）+ §7（写作顺序）
2. `docs/design-v2/tech-stack/14-roadmap.md` §2（Week 1 任务源）+ §2.2（完成标准）
3. 本文件 §任务清单（当前到哪了）+ §决策日志（为什么这么走）
4. 从「任务清单」第一个 `status != done` 的任务继续

调整任务表 / 顺序前：先在「决策日志」追加一条说明，再改清单，不要静默修改。

完成一项任务 = 把对应行的 status 改 done + 填关联 commit + 把变更 commit 进 git，不积压。
