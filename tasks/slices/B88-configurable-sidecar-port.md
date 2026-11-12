# B88：sidecar 端口可配置

- 状态：**todo（2026-11-13 作者提出；产品功能，非验收钩子；未设计冻结/未实现）**
- 来源：B65 release 打包 Origin 采集受阻——`frontend/src-tauri/src/lib.rs` 硬编码 `SIDECAR_PORT = "4658"`，release app 无法在不改产品的情况下用代理占位转发；作者裁定“端口可配置应该成为一个产品功能”。
- 关联：[B65](B65-local-http-websocket-origin-boundary.md)（release Origin 采集受益，但不是本任务目的）、[SU04](SU04-desktop-sidecar-packaging.md)（release 生命周期/端口冲突）、[B71](B71-provider-message-fidelity.md)（多实例/调试互不干扰）。

## 1. 目标

把 sidecar 端口从编译期常量变成运行时配置，默认保持 4658；支持端口冲突回退或作者显式配置；前端 API/WS、CSP 与来源策略跟随同一端口。仍只绑 `127.0.0.1`，不扩远程监听。

## 2. 现状（只读盘点）

| 位置 | 现状 |
|---|---|
| `frontend/src-tauri/src/lib.rs` | `const SIDECAR_PORT: &str = "4658"`；启动 sidecar 注入 `PHOENIX_PORT=4658`；`wait_for_sidecar_port(4658)` 硬编码 |
| `config/runtime.exs` | `PHOENIX_PORT` 默认 4658（release sidecar） |
| `config/dev.exs` / `config/config.exs` | dev endpoint 默认 4657 |
| `frontend/src/lib/env.ts` | Tauri 默认 `ws://localhost:4657/socket`，API endpoint 从 env/默认读取 |
| `frontend/src-tauri/tauri.conf.json` | CSP `connect-src` 写死 4657/4658 |
| `scripts/` / e2e / 测试 | 多处默认 4657/4658 |

## 3. 设计要点（待冻结）

1. **端口来源单一**：Tauri 启动时决定端口（显式配置 > 自动选空闲 > 默认 4658），注入 sidecar `PHOENIX_PORT`；前端通过 Tauri bootstrap 读取同一值，不各自写死。
2. **冲突策略**：端口被占用时，要么自动探测下一个空闲端口并记录实际值，要么如实报错并给作者可见提示；不能静默失败。
3. **CSP**：`connect-src` 需要覆盖配置端口。Tauri CSP 是静态配置，需确认能否运行时注入或生成；若只能放宽到 `http://localhost:*` / `ws://localhost:*`，必须评估来源放宽的安全影响，并保持 `OriginPolicy` 的 loopback 精确匹配。
4. **OriginPolicy**：允许列表的 host 仍只限 Tauri/localhost，端口跟随实际配置；不允许任意来源。
5. **前端**：`env.ts` 的 API/WS 默认值改为从 Tauri bootstrap 读取；浏览器 dev 仍用 `VITE_*` env。
6. **多实例/调试**：不同实例用不同端口互不干扰；B65 可用“代理占原端口、sidecar 用配置端口”采集 release Origin。
7. **默认兼容**：默认 4658，现有脚本/测试不需要一次性全改；但新增代码不得再硬编码端口。

## 4. 边界

- 只改端口来源与跟随，不改变来源策略、身份/作品隔离、adoption 边界。
- 不把端口可配置做成验收专用开关；它是真实产品能力（冲突处理、多实例、调试）。
- 仍只监听 `127.0.0.1`；不引入远程监听/多用户部署。
- 不改 sidecar 协议与 Tauri 安全模型。

## 5. 验收

- 默认 4658 启动回归；
- 自定义端口（如 4668）release 启动，前端 HTTP/WS 连接正常；
- 端口冲突时按冻结策略回退或报错，不静默失败；
- 多实例不同端口互不干扰；
- B65 可用代理占原端口采集 release Origin（作为受益验证，不作为本任务唯一目的）。

## 6. 待设计点

- CSP 动态化方案（Tauri 2 是否支持运行时 CSP；否则评估通配端口的风险）。
- 端口选择策略（固定回退范围 vs 系统分配）。
- 配置入口（应用设置/环境变量/配置文件）与优先级。
