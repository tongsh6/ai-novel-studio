# VS-11 Desktop Stage Process Ownership

> 状态：done（2026-05-18）
>
> 角色：收束桌面 dev/stage 启停所有权，避免关闭窗口时由前端 HTTP、Tauri 端口扫描、shell trap 三处同时抢 Phoenix 生命周期。

## 1. Contract

| Contract | 用途 |
|---|---|
| `docs/design/tech-stack/05-desktop.md` §2 / §4 | Tauri 是桌面壳，生产形态由主进程管理 sidecar；当前 dev/stage 形态下 shell launcher 临时承担进程 owner |
| `docs/design/README.md` §3 退出时数据安全 | 退出必须走可控 shutdown，不能靠误杀端口 |
| `scripts/stage.sh` / `scripts/dev.sh` | 当前 dev/stage 启动契约：谁启动 Phoenix/Vite/Tauri，谁负责清理 |

## 2. Invariant

1. Launcher script 必须保留父进程身份，不能用 `exec pnpm tauri dev` 让 `EXIT` trap 失效。
2. 关闭 Tauri 窗口只退出 Tauri app；Phoenix/Vite 由启动它们的 script 依据 PID 清理。
3. 清理只能作用于本次启动记录的 PID，不按端口扫描杀进程，避免误杀用户已有服务。
4. 临时修改 `tauri.conf.json` 必须在退出时恢复，且备份不写入仓库工作区。

## 3. Boundary

| Area | 是否涉及 | 说明 |
|---|---|---|
| `scripts/stage.sh` | yes | Stage owner：Phoenix + Tauri dev CLI；web 模式 Phoenix + Vite preview |
| `scripts/dev.sh` | yes | Dev owner：Phoenix + Tauri dev CLI；web 模式 Phoenix + Vite dev |
| `frontend/src-tauri/src/lib.rs` | yes | 关闭窗口只退出 Tauri，不再按端口 kill Phoenix |
| `frontend/src/main.tsx` | yes | 前端不再拦截窗口关闭去调用 `/api/system/shutdown` |
| `novel_web` | no | 保留 `/api/system/shutdown` 兼容端点，不作为当前桌面关闭主链 |
| domain/application/persistence/agent | no | 不触碰业务主链 |

## 4. Consumer

- 开发者 / reviewer 运行 `bash scripts/stage.sh` 或 `bash scripts/dev.sh`。
- 作者点击 Tauri 窗口关闭按钮后，Tauri CLI 退出，launcher script 执行 cleanup。

## 5. Proof

| Proof | 命令 / 路径 | 预期 |
|---|---|---|
| Shell 语法 | `bash -n scripts/stage.sh scripts/dev.sh` | 语法通过 |
| Rust 编译 | `cd frontend/src-tauri && cargo check` | Tauri glue 无未使用 import / 编译错误 |
| 前端编译 | `pnpm --dir frontend typecheck && pnpm --dir frontend lint && pnpm --dir frontend test` | 移除 close hook 后无 TS/lint/test 回归 |
| 后端质量 | `mix compile --warnings-as-errors && mix test && mix xref ... && mix run scripts/arch_check.exs` | 未破坏 umbrella 和后端门禁 |
| Stage 生命周期 | `bash scripts/tauri_slice_verify.sh desktop-stage-process-ownership` | 启动真实 stage Tauri，Tauri 退出后 launcher 清理 Phoenix 并恢复配置 |
| 静态扫描 | `bash scripts/ai_static_scan.sh --top 10` | 无 P0/P1；本次文件无未处置 P2 |

> 前端发起验证：真实路径是 `bash scripts/stage.sh` 启动 Tauri 工作台后点击窗口关闭按钮，预期 Tauri 退出触发 script cleanup 并释放 Phoenix/Vite。自动化 `tauri_slice_verify.sh desktop-stage-process-ownership` 先覆盖同一 Tauri 退出后果：真实 stage + 原生 Tauri app 启动，终止 Tauri launcher 后验证 cleanup。它证明 owner 模型成立；仍不声称覆盖生产 sidecar 生命周期。

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 移除前端关闭窗口时调用 `/api/system/shutdown` 的 owner 抢占 | done | 前端不再负责后端生命周期 |
| T2 | 移除 Tauri Rust 按端口 kill Phoenix | done | 避免误杀非本次启动进程 |
| T3 | `stage.sh` 保留父进程、PID cleanup、临时配置恢复 | done | 不再 `exec`，备份写 `/tmp` |
| T4 | `dev.sh` 与 stage 使用同一 owner 模型 | done | 避免 dev/stage 语义分叉 |
| T5 | 增加 stage owner 自动化证据 | done | `scripts/verify_stage_process_ownership.sh` |
| T6 | 执行质量门禁与自审 | done | 静态扫描 Top 10 复跑 0 finding |

## 7. 决策日志

- 2026-05-18 — 选择此任务而不是继续扩 AU-05/AU-09：台账明确标为未解决且当前是“补丁缓解”；根因是生命周期 owner 不清，属于长期维护风险。该任务风险范围小、可局部验证，并能降低后续 stage/walkthrough 的环境噪声。
- 2026-05-18 — 完成 owner 收束：前端和 Tauri Rust 不再关闭 Phoenix；`stage.sh` / `dev.sh` 保留父进程并按 PID cleanup；`tauri_slice_verify.sh desktop-stage-process-ownership` 生成 Tauri surface 证据。未覆盖生产 sidecar 进程管理，后续 release slice 仍需按 `05-desktop.md` 实现 sidecar handle。
