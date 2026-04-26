# Phase 0 · Week 1 · 仓库脚手架 + 第一份 Schema

- 启动日期：2026-04-26
- 范围依据：`docs/design-v2/tech-stack/14-roadmap.md` §2（任务定义在那里，本文件仅跟踪状态）
- 完成标准依据：同上 §2.2

## 任务清单

引自 `14-roadmap.md` §2.1。

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | 仓库结构初始化（apps×4 + frontend + tauri + experiments + tools + config） | done | `8be29f1` | 仅空目录骨架，未注入 `mix new` / `pnpm init` |
| T2 | 工具链 setup（Homebrew 装 Elixir/Erlang/Rust，nvm 校验 Node） + 团队 onboarding 文档 | done | — | Elixir 1.19.5 / OTP 28 / Rust 1.95 / cargo 1.95 / pnpm 10.33 / Node 24.14 全到位；onboarding 文档由 12-development.md §2.0 承担 |
| T3 | Mix umbrella + 4 个 apps 的 `mix.exs` + `mix deps.get` 通过 | done | `cdf2267` | umbrella + novel_foundation/domain/persistence/web；mix compile + mix test 全通；.gitignore 修正 lib/ 通配误伤 |
| T4 | Phoenix endpoint 骨架 + `mix phx.server` + `/health` 返回 200 | done | `142c062` | phoenix 1.8 + bandit 1.5；curl 实测 200 OK + `{"status":"ok"}` |
| T5 | Frontend 骨架 + `pnpm dev` 启动 + hello world 页面 | done | `2941f9a` | Vite 8.0.10 / React 19.2 / TS 6.0.3；641ms 启动；Node 24 兼容验证通过 |
| T6 | Tauri 骨架 + `pnpm tauri dev` 加载 frontend | done | `e32a2d6` | Tauri 2.10.3 + tauri-plugin-log；首次 cargo build 4m56s（387 编译单元）；窗口加载 vite 通过；目录布局走 ADR-0016（`frontend/src-tauri/`） |
| T7 | `docs/design-v2/schemas/foundation/turn_result_v2.json`（按 ADR-0001 §1/§2） | done | `421929a` | 已落地主 schema + artifact_adoption_entry；其余 `$ref` 占位待 ADR-0002/0003/0005/0006 各自抽取 |
| T8 | Schema codegen：`mix codegen.schemas` + `pnpm codegen:schemas` | todo | — | 依赖 T3 + T7（T7 已 done） |
| T9 | GitHub Actions CI：`mix test` + `pnpm test` | done | `c099ddf` | .github/workflows/ci.yml；两个并行 job；本地 pnpm test ✅；远端运行结果待 push 后观察 |

完成标准（来自 `14-roadmap.md` §2.2）：
- 团队任意成员按 `12-development.md §2.0` 完成工具链校验后，clone + `mix deps.get` + `pnpm install` 跑得起来
- 三栈（Phoenix / Vite / Tauri）三终端都能 dev-server 启动
- CI 至少跑通一个 dummy test
- `turn_result.json` reviewed + commit

## 决策日志

倒序，最新在上。

- **2026-04-27** — T6 完成（commit `e32a2d6`，前置 ADR-0016 commit `58f5657`）：rustup-init via brew + stable rust 1.95（minimal profile）；frontend 加 @tauri-apps/api + @tauri-apps/cli；pnpm tauri init --ci 在 `frontend/src-tauri/` 生成模板；identifier 改 studio.ai-novel；首次 cargo build 拉 291 crates + 编译 387 单元 4m56s；target/debug/app 启动加载 vite，无 error/panic。~/.cargo/bin 未写入 ~/.zshrc（守 local-ai-policy §五），新 shell 需 source ~/.cargo/env。
- **2026-04-27** — ADR-0016（commit `58f5657`）：实测后修订 spec，Tauri 工程目录从顶层 `tauri/` 改为 `frontend/src-tauri/`。理由：Tauri 2 默认布局零配置 + 社区文档/CI 模板均假设此布局。同步修订 12-development.md §1 + 0000-index.md §2.1/§5；删除顶层 tauri/.gitkeep；.gitignore 加 *.iml。
- **2026-04-27** — T9 完成（commit `c099ddf`）：`.github/workflows/ci.yml` 两 job 并行（backend mix test / frontend vitest），erlef/setup-beam 1.19/OTP 28、pnpm/action-setup v4、actions/setup-node 24；frontend 配套 `pnpm add -D vitest` + smoke.test.ts dummy 测试。本地 `pnpm test` 1/1 通过；CI 远端首跑结果待 push 后 GitHub Actions 验证。
- **2026-04-27** — T4 完成（commit `142c062`）：novel_web 引入 phoenix 1.8 / phoenix_pubsub 2.1 / jason 1.4 / bandit 1.5；endpoint + router + HealthController + ErrorJSON；application.ex sup tree 注入 PubSub + Endpoint；config 走 Bandit adapter on 127.0.0.1:4000。phx.server 启动后 curl /health 实测 200 OK，404 fallthrough 正常。
- **2026-04-27** — T5 完成（commit `2941f9a`）：pnpm create vite frontend --template react-ts；实测版本 React 19.2.5 / Vite 8.0.10 / TS 6.0.3，已超 04-frontend.md 基线（模板默认升新）；pnpm dev 在 641ms 启动 http://localhost:5173/，Node 24.14 兼容验证通过——roadmap §2.0 关于 Node 24 的兼容性疑虑解除。Tailwind / Radix / Zod / TanStack Query / Zustand / phoenix npm 等 04-frontend.md §2.7 增量留待后续 T5 子项。
- **2026-04-27** — T3 完成（commit `cdf2267`）：mix new --umbrella 生成根级 mix.exs / .formatter.exs / config/config.exs；apps/ 下分别 mix new：novel_foundation / novel_persistence / novel_web 用 `--sup`（OTP supervised），novel_domain 用纯库模式。mix compile 4 app 全通，mix test 5 个 dummy/doctest 全通。
- **2026-04-27** — .gitignore 修正：原 Python 段 `lib/` 通配会误伤 `apps/*/lib/` 业务源码与 `spikes/v2_verification/lib/`；改为根级锚定 `/lib/`，并删除 spikes 例外规则（已 redundant）。追加 Elixir/Mix 段（`/_build/` `/cover/` `/deps/` `/doc/` `erl_crash.dump` `*.ez` `*.beam`）。
- **2026-04-27** — T7 完成：从 ADR-0001 §1/§2 抽取 `foundation/turn_result_v2.json` + `foundation/artifact_adoption_entry.json` 到 `docs/design-v2/schemas/`。其余 `$ref` 占位（enums / envelopes / assistant_message / ui_card）严格不在 T7 范围，由对应 ADR-0002/0003/0005/0006 等各自抽取。两份 schema 均通过 JSON 语法校验。
- **2026-04-27** — 工具链诊断：Elixir 1.19.5 / Erlang OTP 28 / pnpm 10.33 / Node 24.14.1 / Homebrew 5.1.7 均已装；仅 Rust 未装。修正 T2 状态从 todo → partial，原"本机 Elixir/Erlang 未装"信息过时。
- **2026-04-26 23:30** — 新建 `tasks/` 目录承载执行层（状态/卡点/决策日志），与 `docs/`（规划）+ `adr/`（决策）+ `.sisyphus/plans/`（一次性集中作战计划）分离。理由：会话切换时无损接力。
- **2026-04-26 23:12** — 仓库重布局完成（commit `8be29f1`）。A1（v1 Python 残留直接清掉，源码留 git 历史）+ B1（spikes/v2_verification 原位保留）。
- **2026-04-26** — 目录布局严格按 `tech-stack/12-development.md §1`，不再讨论替代方案。

## 卡点 / TBD

- **Node 24 兼容性**：T5 验证 Vite 8 + React 19 + TS 6 通过；T6 验证 @tauri-apps/cli 2.10 通过。phoenix npm client 仍待验（在 T4+ Channel 接入时确认）。
- **`~/.cargo/bin` 未在 PATH**：每次新 shell 需 `source ~/.cargo/env`，否则 `cargo` / `pnpm tauri *` 找不到。永久写入 ~/.zshrc 需用户授权（local-ai-policy §五）。
- **路线图 §11 TBD**（团队成员、prompt 设计、provider 选择、pencil 介入时机）暂未影响 Week 1 推进，留到 kick-off 会议确认。

## 下次会话恢复指引

接手者（无论是 AI 还是人）按以下顺序读取上下文：

1. `docs/design-v2/README.md` §1（总目标）+ §7（写作顺序）
2. `docs/design-v2/tech-stack/14-roadmap.md` §2（Week 1 任务源）+ §2.2（完成标准）
3. 本文件 §任务清单（当前到哪了）+ §决策日志（为什么这么走）
4. 从「任务清单」第一个 `status != done` 的任务继续

调整任务表 / 顺序前：先在「决策日志」追加一条说明，再改清单，不要静默修改。

完成一项任务 = 把对应行的 status 改 done + 填关联 commit + 把变更 commit 进 git，不积压。
