# NovelTest

跨 umbrella app 共享的**测试 helper app**。仅 `MIX_ENV=test` 下被依赖与编译；生产
release（`mix release sidecar`）不包含本 app。

## 边界

- 只依赖 `novel_common`（canonical 纯契约），不得依赖任何生产运行时 app
  （`novel_agent` / `novel_application` / `novel_domain` / `novel_persistence` /
  `novel_web` / `novel_e2e`）。`scripts/arch_check.exs` 有对应机器门禁。
- 不含生产逻辑、不注册运行时 provider、不发起网络/DB I/O；只做真实请求材料的
  只读解析与 canonical Request IR 测试夹具构造。
- **依赖 agent 运行时实现的测试替身**（`Stub` / `SliceVerify` 等）仍留在
  `novel_agent/test/support`：它们实现 `NovelAgent.Provider` behaviour 并依赖
  `AdapterExecution`/`Result`，反向放进 novel_test 会形成
  `novel_agent →(test) novel_test → novel_agent` 编译环。跨 app 引用面由
  `scripts/arch_check.exs` 的白名单显式登记，不允许继续扩散。

## 依赖方向

```text
novel_test → novel_common → novel_foundation

novel_agent          (only: :test) → novel_test
novel_application    (only: :test) → novel_test
novel_web            (only: :test) → novel_test
```

`novel_test` 不得被生产 `lib` 引用（arch_check 规则）。

## 文件索引

- [lib/novel_test.ex](lib/novel_test.ex)：app 入口与定位说明。
- [lib/novel_test/test_request_ir.ex](lib/novel_test/test_request_ir.ex)：canonical
  Request IR 测试夹具构造器（Base/scope/作者/assistant/tool call/observation/
  validation）；只构造契约数据，不经过 wire 投影。
- [lib/novel_test/test_provider_prompt.ex](lib/novel_test/test_provider_prompt.ex)：离线
  替身请求材料唯一语义读取 helper。`%NovelCommon.RequestIR{}` 直接读 canonical
  `role/provenance/blocks`；普通 binary / 真实 system/user list 只读实际
  `role/content` 文本，不解释旧桥标记、不解析工具历史字符串、不合成 canonical。
- [test/novel_test_app_smoke_test.exs](test/novel_test_app_smoke_test.exs)：app 可加载
  smoke test（保证 umbrella 根 `mix test` 信号不因空测试面退化）。

## 相关设计/契约

- [VS-00L](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)：
  Request IR v1 契约。
- [B71 Provider 消息保真](../../tasks/slices/B71-provider-message-fidelity.md)：裁决 4 C
  依赖图下沉与测试 helper 迁移（本 app 承载纯契约 helper；wire 投影与能力事实留在
  `novel_agent` 执行边界）。
