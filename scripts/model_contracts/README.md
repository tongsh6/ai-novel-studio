# 模型契约探针索引

通过 `bash scripts/probe_run.sh <script> <provider> <runs>` 执行；不写作品数据。

| 文件 | 角色 |
|---|---|
| `judgment_protocol.exs` | 生产判断协议与判断质量 MBC。 |
| `continuation_judgment.exs` | 续行判断协议 MBC。 |
| `tool_call_compliance.exs` | 计划起草单次 auto 工具调用 MBC。 |
| `single_call_compliance.exs` | B26：生产唯一性与六类普通/业务输出的单调用机制守卫；真实 provider 参数继续运行生产判断 MBC。历史两段式仅留既有原始报告/隔离快照，不再链接生产。 |
| `b26_cp0_arm_probe.exs` | B26 CP0 隔离对照臂探针：固定案例集真实 provider 请求快照（旧两段式只在隔离 worktree 运行；新臂在当前工作区运行），输出 `artifacts/model-contracts/b26-cp0/`。不写作品数据、不把旧协议链接回生产。 |
| `b27_semantic_eval.exs` | B27 CP4 双臂 episode 运行器：`--arm old` 回放 CP0 冻结快照、`--arm integrated` 走当前生产入口（`DialoguePlanningService.plan_agent_run/3` + 判断循环 + 真实 provider，provider 边界采集），落逐 episode 证据到 `artifacts/model-contracts/b27-cp4/`；`--check-snapshots` 校验 20/20。 |
| `b27_episode_support.exs` | `b27_semantic_eval.exs --arm integrated` 的私有支撑：隔离 test DB + Sandbox、合成夹具 seed（与 CP0 同源确定性 UUID）、生产 planner step 驱动到 complete、provider 边界采集读取。不修改产品代码。 |
| `b27_semantic_score.exs` | B27 CP4 rubric 判卷与门槛聚合：`--gen-templates` 生成隐藏 arm 的逐例判定模板、`--score` 按 §6.1 全门槛聚合 PASS/FAIL、`--self-test` 用合成判定做正/反例自测；不自动判卷、不调用模型。 |
| `execution_self_eval.exs` | 执行自评形态的历史实验证据。 |
| `prompt_prefix_live.exs` | 真实厂商缓存基线入口，支持 Gateway 注册的真实 Provider。 |
| `prompt_prefix_probe.exs` | 生产单调用判断 + 逐请求原生 HTTP/SSE、usage、纠错计数与同请求控制报告。 |
| `prompt_prefix_probe_test.exs` | 探针证据判定回归，防止重复/隐藏请求、错来源或缺失缓存字段被算作成功。 |

## 缓存基线

`PREFIX_PROBE_PROFILE_DIR` 显式指定既有桌面 profile 目录，仅在当前 BEAM 内存使用其中的
Provider 设置和凭据，不修改文件。未提供凭据的通道记 blocked；不加载或切换本地模型。
`PREFIX_PROBE_LABEL=baseline` 指定标签，结果在 `artifacts/model-contracts/prefix-live/<label>/`。
默认顺序是生产单调用、更换作者输入、更换稳定前缀、独立样本的同请求复测；
`PREFIX_PROBE_MODE=single` 仅执行首个生产调用（纠错单列）。缓存 miss 是基线事实，不等于协议失败；
缺字段记 unobservable，非流式耗时不冒充 TTFT。原始证据不含认证头。

自测：`MIX_ENV=test mix run scripts/model_contracts/prompt_prefix_probe_test.exs`。
