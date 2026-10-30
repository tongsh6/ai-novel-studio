# B65：本地 HTTP / WebSocket 来源边界

- 状态：**doing（2026-10-31 CP0/CP1 完成，CP2 HTTP/配置矩阵完成、WS 握手待补；CP3 外部真实页面/隔离来源待做）**。
- 类型：Desktop Boundary / Security / Acceptance Slice。
- 来源：阶段 1 的本机桌面通信边界与本次设计→代码对账；独立于 [B57](B57-sec-injection-boundary.md) 的提示注入防线和 [B58](B58-human-approval-policy-unification.md) 的作者批准语义。

## 1. 场景与已核实事实

作者在真实 Tauri 工作台读写作品、配置模型时，本机后端应按明确的桌面来源规则接收 HTTP/WS。绑定 loopback、浏览器 CORS、连接身份及业务授权各自解决不同问题，不能相互代签。

2026-10-30 只读核对：

1. [部署设计 §1.4](../../docs/design/tech-stack/11-deployment.md#14-网络) 限定本地通信；[CORSPlug](../../apps/novel_web/lib/novel_web/plugs/cors_plug.ex) 第 54–66 行声明仅放行 Tauri/localhost，却以 `String.starts_with?` 匹配来源。
2. 对同一表达式的纯 Elixir 离线求值显示：`https://localhost.example.invalid`、`http://127.0.0.1.example.invalid`、`https://tauri.localhost.example.invalid` 均返回 `true`。没有发送网络请求、运行服务或利用产品；这是**静态来源判定不符合其声明**，不是已发生攻击的证据。
3. [现有 CORS 测试](../../apps/novel_web/test/novel_web/plugs/cors_plug_test.exs) 仅覆盖合法 Tauri/loopback、普通非本机域名及无 Origin，没有伪本机后缀反例。
4. [prod 配置](../../config/prod.exs) 第 92–99 行设置 `check_origin: false`；[release runtime 配置](../../config/runtime.exs) 第 65–69 行覆写 ip/url/secret/server，没有覆写 Origin 策略；[UserSocket.connect](../../apps/novel_web/lib/novel_web/channels/user_socket.ex) 直接接受连接。须连同实际打包/启动配置验证，不能只修 HTTP 字符串比较便宣布 WS 同样受保护。
5. [Router](../../apps/novel_web/lib/novel_web/router.ex) 的 API pipeline 只有 JSON accepts。CORS 头不构成身份认证；旧技术栈的 Device key/Bearer 表述也不是现役认证已实现的证据。

## 2. 开工七问

1. **Contract**：阶段 1 loopback 部署、Tauri 实际 Origin、当前 HTTP/WS 接入契约与现有业务授权；CP0 冻结允许来源及 dev/stage/release 差异。新增设备令牌或鉴权机制必须另行冻结，不从旧技术栈示例直接恢复。
2. **Invariant**：主机名相似不等于受信任本机来源；HTTP 与 WS 使用明确、可验证的边界；来源检查不替代作品/会话隔离或 author_action/adoption 门禁；拒绝的预检/连接不得进入业务执行；合法 Tauri 与已约定的本地开发调用保持可用。
3. **Boundary**：`novel_web` HTTP/WS 入口、Endpoint/runtime 配置及必要的 Tauri/env 端点声明、对应测试与外部驱动。`novel_domain`/`novel_agent`/persistence 业务规则不因来源修复改变；不扩远程监听或多用户部署。
4. **Consumer**：真实 Tauri 工作台的设置/读取/创作请求，Phoenix Channel 连接，以及已登记的本地开发与运维调用者。
5. **Proof**：精确 scheme/host/port 与 malformed/null/无 Origin、后缀伪装等矩阵；生产配置与 dev 配置分别验证；HTTP 预检/实际请求与 WS 握手分别取证；合法请求回归、被拒绝路径无 provider/tool/canon 副作用。
6. **Acceptance Driver**：沿既有外部 Tauri 驱动验证正常工作台链；另在隔离测试环境由外部浏览器/HTTP/WS 客户端构造非信任来源，核对握手/响应与业务零副作用。正式场景名称、manifest 与隔离资源在 CP0 冻结，不能只把一段字符串测试当产品验收。产品验收感知逻辑 **no**。
7. **Exploration**：不新增作品要素或知识获取通道；探索请求仍经现有 Channel/application 权限链，本项只保护其传输入口，不增加网络探索工具。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 核对真实 Tauri 各平台来源、dev/stage/release 最终配置及本地调用者；冻结 scheme/host/port、无 Origin/null/错误形状和 HTTP/WS 拒绝语义，预注册正反例与驱动；区分来源修复和新增鉴权 | **done（2026-10-31，§6）**：冻结 Tauri 三来源 + dev 5768/隔离验收 5769 精确端口；发现并修正 tauri devUrl 5769 vs Vite 5768 不一致；禁止前缀匹配；Origin≠认证 |
| CP1 | 依据 CP0 修复精确来源判定与配置接线；同源策略或有依据的平台差异只有一个 owner；合法 loopback/Tauri 路径兼容，后缀伪装不被视为本机 | **done（2026-10-31，§6）**：新增 `NovelWeb.OriginPolicy` 唯一 owner；CORSPlug 委托精确判定；dev/prod/runtime 三处 `check_origin` 从 false 改为 policy MFA；devUrl/端口单一化 |
| CP2 | 补 HTTP OPTIONS/实际请求、WS 握手/连接、配置覆盖、缺失/畸形来源与合法客户端矩阵；证据明确服务端拒绝、浏览器阻止和仅无 CORS 头的不同后果 | **partial（2026-10-31，§6）**：HTTP 端点 GET/OPTIONS、合法/伪本机/null/错误端口、配置覆盖矩阵通过；WS 真实握手（非信任 Origin 403/无业务副作用）待 CP3 外部 probe |
| CP3 | 外部真实 Tauri 设置/创作正常，隔离非信任来源请求按冻结策略被拒且无业务副作用；恢复/重连回归与文档/配置同步，保留失败证据 | 未开工 |

CP1/CP2 只能证明局部边界；完整 slice 要有真实客户端与最终运行配置证据。不能用 HTTP 通过替代 WS、用 dev 通过替代 release，或用 loopback 地址替代来源/身份判断。

## 6. CP0/CP1/CP2 记录（2026-10-31）

### 6.1 真实来源与配置核对（CP0）

- Tauri 打包来源：`tauri://localhost`（macOS/Linux 自定义协议）、`http://tauri.localhost` / `https://tauri.localhost`（Windows）；来自 `docs/design/tech-stack/11-deployment.md` 与 Tauri 2 约定。
- 开发来源：`frontend/.env` 单一来源为 `VITE_DEV_PORT=5768`；`scripts/dev.sh`/Vite 默认 5768；但 `frontend/src-tauri/tauri.conf.json` 的 `devUrl` 曾硬编码 5769、`before-tauri-dev.sh` fallback 5769，与 `.env`/Vite 不一致。已在 CP1 统一为 5768（tauri.conf/beforeDev 同步），隔离验收 `tauri_slice_verify.sh` 仍用 5769 并允许其作为精确 dev/test 来源。
- 配置现状：`config/dev.exs`/`config/prod.exs` 原 `check_origin: false`，`config/runtime.exs` 未覆盖 Origin 策略；`UserSocket.connect` 不自行校验。CP1 三处统一改为 `{NovelWeb.OriginPolicy, :allowed_uri?, []}`，无第二 owner。
- 本地调用者：Tauri webview（HTTP fetch/WS）、Vite dev 浏览器调试、隔离验收 driver；stage/release 仍只监听 127.0.0.1，不扩大远程监听。
- 冻结拒绝语义：Origin 精确匹配允许列表才回 CORS 头/接受 WS；无 Origin 的本地非浏览器客户端不因 CORS 被拒（CORS 只服务浏览器跨源），WS 无 Origin 仍由 Phoenix 默认语义处理；null/畸形/后缀伪装/错误端口一律不信任。Origin/CORS **不是身份认证**，不替代作品/会话/adoption 门禁；不新增设备令牌或远程鉴权。

### 6.2 CP1 实现

- `apps/novel_web/lib/novel_web/origin_policy.ex`（新增）：`trusted_origins/0`、`allowed_origin?/1`（CORS header 字符串精确匹配）、`allowed_uri?/1`（Phoenix socket `check_origin` MFA，URI→精确字符串）。
- `CORSPlug` 改为委托 `OriginPolicy`，删除 `String.starts_with?` 前缀匹配；非允许来源不加 CORS 头、不 halt；允许的 OPTIONS 仍 204。
- `config/dev.exs`/`config/prod.exs`/`config/runtime.exs` 的 `check_origin: false` → `{NovelWeb.OriginPolicy, :allowed_uri?, []}`；`tauri.conf.json` devUrl、`before-tauri-dev.sh` 统一 5768。

### 6.3 CP2 HTTP/配置矩阵（WS 待补）

- `origin_policy_test.exs`：合法 Tauri 三来源 + dev 5768/5769；拒绝后缀伪装（localhost.example.invalid 等）、错误 scheme/端口、null、路径、非字符串。
- `cors_plug_test.exs`：允许来源回显/OPTIONS 204；错误端口/前缀伪装/null 无 CORS 头且不 halt；无 Origin no-op。
- `cors_endpoint_test.exs`：真实 endpoint pipeline `/health` GET 合法/伪本机/null/错误端口；允许 OPTIONS 204；dev/prod/runtime 三配置断言 policy MFA 且不再 false。
- 未覆盖：真实 WS handshake（非信任 Origin 应被拒绝、合法 Tauri/dev Origin 可通过）需外部 probe；CP3 与真实 Tauri 页面一起做，不能用 HTTP 通过替代 WS。

## 4. 依赖与不授权范围

- [SU04](SU04-desktop-sidecar-packaging.md) 提供真实打包端点/生命周期，[B51](B51-tech-stack-current-rebase.md) 校准技术栈声明；本项不等待所有技术文档收口才核对来源。
- 设备令牌、身份校验、无 Origin 本地客户端的可信范围若超出现契约，先提交具体设计取舍；**CORS 不是完整认证**，Origin 也不是本机进程不可伪造的身份。
- 不更换已接受的 provider secret local-file 机制，不泄露凭据、不启用远程端口、不搭建 OAuth/多租户系统。
- 不向作者真实工作区发送破坏性请求；负例使用隔离环境和外部可控客户端，不在产品中添加测试开关、隐藏钩子或伪调用。

## 5. 验证与恢复

开工先保存当前配置与待测 origin 清单，按原入口复现静态判定，再完成对应局部和真实页面验证。修复应可回滚到受审阅的代码/配置版本，不能通过重新放宽来源、关闭 WS Origin 检查或修改验收断言来换取通过。最终分别报告静态表达式、单元/连接测试、真实 Tauri 与隔离浏览器证据，不夸大为所有本机访问已获认证。
