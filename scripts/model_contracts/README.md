# 模型契约探针索引

通过 `bash scripts/probe_run.sh <script> <provider> <runs>` 执行；不写作品数据。

| 文件 | 角色 |
|---|---|
| `judgment_protocol.exs` | 生产判断协议与判断质量 MBC。 |
| `continuation_judgment.exs` | 续行判断协议 MBC。 |
| `tool_call_compliance.exs` | 计划起草强制工具调用 MBC。 |
| `single_call_compliance.exs` | B26 CP0：单调用 `tool_choice: auto`（judgment_decision + ask_author 草案）与现行两段式基线的逐用例对照；切换前风险登记，不设阈值闸门。报告 `artifacts/model-contracts/single-call/<provider>.{json,md}`。 |
| `execution_self_eval.exs` | 执行自评形态的历史实验证据。 |
| `prompt_prefix_live.exs` | 真实厂商缓存基线入口，支持 Gateway 注册的真实 Provider。 |
| `prompt_prefix_probe.exs` | 生产判断协议 + 逐请求原生 HTTP/SSE、usage 与调用对报告。 |
| `prompt_prefix_probe_test.exs` | 探针证据判定回归，防止重复 call1 或缺失缓存字段被算作成功。 |

## 缓存基线

`PREFIX_PROBE_PROFILE_DIR` 显式指定既有桌面 profile 目录，仅在当前 BEAM 内存使用其中的
Provider 设置和凭据，不修改文件。未提供凭据的通道记 blocked；不加载或切换本地模型。
`PREFIX_PROBE_LABEL=baseline` 指定标签，结果在 `artifacts/model-contracts/prefix-live/<label>/`。
默认顺序是实际调用对、更换作者输入、更换稳定前缀、独立样本的同请求复测；
`PREFIX_PROBE_MODE=pair` 仅执行第一个调用对。缓存 miss 是基线事实，不等于协议失败；
缺字段记 unobservable，非流式耗时不冒充 TTFT。原始证据不含认证头。

自测：`MIX_ENV=test mix run scripts/model_contracts/prompt_prefix_probe_test.exs`。
