# 模型契约探针索引

## VS-00M 离线设计候选

[model_interaction/](model_interaction/README.md)：Schema、合成正反例、原生格式参考映射及导航/哈希检查。用 Python 独立运行，不走下述真实 Provider 探针，不写作品数据，也不证明模型语义/页面行为。

通过 `bash scripts/probe_run.sh <script> <provider> <runs>` 执行；不写作品数据。

| 文件 | 角色 |
|---|---|
| `judgment_protocol.exs` | 生产判断协议与判断质量 MBC。 |
| `continuation_judgment.exs` | 续行判断协议 MBC。 |
| `tool_call_compliance.exs` | 计划起草单次 auto 工具调用 MBC。 |
| `single_call_compliance.exs` | B26：生产唯一性与六类普通/业务输出的单调用机制守卫；真实 provider 参数继续运行生产判断 MBC。历史两段式仅留既有原始报告/隔离快照，不再链接生产。 |
| B26 CP0 冻结对照证据 | `artifacts/model-contracts/b26-cp0/` 的原始案例与双臂快照只读保留，可继续核验既有报告。跨版本执行器已于 B87 R02 退役；当前生产探针只接原生 Scope，不重解释旧文本上下文。 |
| `b27_semantic_eval.exs` | B27 CP4 双臂 episode 运行器：`--arm old` 回放 CP0 冻结快照、`--arm integrated` 走当前生产入口（`DialoguePlanningService.plan_agent_run/3` + 判断循环 + 真实 provider，provider 边界采集），落逐 episode 证据到 `artifacts/model-contracts/b27-cp4/`；`--check-snapshots` 校验 20/20。 |
| `b27_episode_support.exs` | `b27_semantic_eval.exs --arm integrated` 的私有支撑：隔离 test DB + Sandbox、合成夹具 seed（与 CP0 同源确定性 UUID）、生产 planner step 驱动到 complete、provider 边界采集读取。不修改产品代码。 |
| `b27_semantic_score.exs` | B27 CP4 rubric 判卷与门槛聚合：`--gen-templates` 生成隐藏 arm 的逐例判定模板、`--score` 按 §6.1 全门槛聚合 PASS/FAIL、`--self-test` 用合成判定做正/反例自测；不自动判卷、不调用模型。 |
| `b27_blind_judge.exs` | B27 CP4 盲评 judge 驱动：用**不同于被评臂**的外部模型（默认 LM Studio，拒绝 `iq3_s`）逐 episode 判卷；隐藏 arm 标签，原始 prompt/响应/usage 落 `judge/`，judgments 落 `judgments/`；judge 不可用 BLOCKED 留证，不伪造判定。 |
| `execution_self_eval.exs` | 执行自评形态的历史实验证据。 |
| `prompt_prefix_live.exs` | 真实厂商缓存基线入口，支持 Gateway 注册的真实 Provider。 |
| `prompt_prefix_probe.exs` | 生产单调用判断 + 逐请求原生 HTTP/SSE、usage、纠错计数与同请求控制报告。 |
| `request_cost_baseline.mjs` | B87 R01 薄 CLI：只做参数/命令/退出码，调用 `lib/native_ui/request_cost_capture.mjs`；`rebuild-snapshot`/`restore-snapshot`/`preflight`/`analyze`/`prepare`/`capture`/`verify`，以及 batch 数据读取 `manifest-field`/`runtime-env` 与 `verify-runtime-facts`（不把 manifest require 成 JS）；R05 `analyze-pairs <recipe> --before <dir> --after <dir> --out <dir>` 直接调用 `lib/native_ui/request_cost_pairs_evidence.mjs`，复用既有单请求字节 owner，只比较成立的七对构造请求。 |
| `request_cost_capture.test.mjs` | capture 纯规则：prefix、manifest 未冻结/错误 source hash/错 lengths、调用身份、pcall、`rebuildSnapshot` 错误源在任何 provenance/文件读取前拒绝（fs 边界负控制）、按 step 请求参数；不申请 run scope、不建目录/DB。 |
| `request_cost_capture_io.test.mjs` | capture 真实 IO/CLI 编排：历史 analyze 与 native preflight/prepare/capture/verify/薄 CLI；固定作者日志、20 表源/完整快照、native 声明、初始 batch 四个只读资产经同一 `materializeFixture` 只在首个需要的 case 物化（3 个所有权域 + 1 个极小声明），普通 case 只读共享 manifest、只复制可写 batch；唯一篡改 native manifest 的 preflight 例和 history 日志/manifest 用各自工作副本。保留原正反例（未冻结/错误 hash/application 头作者/错 turn join/缺 usage/cached>input/作者篡改/完整副本恢复/新 session/setup 内容变化/启动前调用/旧 pcall 复用/capture 不覆盖/缺 driver/缺 turns/空 outDir/独立 out 不改原件），并独立核对 capture 初始/末态实际计数。 |
| `request_cost_baseline_cli.test.mjs` | 薄 CLI 的纯参数与退出码契约：未知/缺参命令 fail closed，不启动外部进程。 |
| `request_cost_construct.exs` | R05 七对请求构造 driver：同一冻结 recipe、源码身份与一致初态 DB，经当前 checkout 的 DPS/AgentRun/Gateway/Splash 真实通路截获请求；transport 固定响应只结束构造，不是实模、Token、耗时或质量证据；同一冻结 driver 按实际判断工具 schema 选择唯一已声明的作者说明字符串 `reason`/`author_reasoning`，并在 schema 声明范围时供应固定 `whole_chapter`；不依赖根 required 或按 arm 猜测。固定文本与空工具 content 不变，实际脚本响应及新增字段随请求原样记录。输出仅在 `artifacts/slice-verify/b87-r05-20261118/`；DB/checkout 由外部准备。 |
| `request_cost_pairs.test.mjs` | R05 配对 IO 独立反例：合法不同 run/call 身份、错作者来源/初态/transport/canonical 配对、7000 字正文中段/目标/版本、冻结 hash 与固定响应 usage 排除；直接调用现 `analyze-pairs` 的 `request_cost_pairs_evidence.mjs` owner，保留合法 parent:agent:N 与错 run/pcall/prun/source、全部调用同序/阶段反例，不造字节分析器。 |
| `request_cost_baseline_cli_io.test.mjs` | 薄 CLI 的真实 Node 子进程边界：相对/含空格路径的 manifest 数据读取、runtime-env 数据行、runtime facts 拒绝反例及 usage 输出；复用合成只读 manifest，篡改例取独立工作副本，不读真实作者数据、不启动模型。 |
| `request_cost_runtime_bootstrap_check.sh` | 无模型 bootstrap 核对：一次性测试库+临时端口启动现有 `slice_verify_server.exs`，采集同进程白名单 runtime facts，核对后只清理本任务进程；不启动 GUI、不发 generation。 |
| `request_cost_splash_body_check.sh` | 无模型 Splash 请求体核对：从 runtime recipe 注入 env，经现役 adapter 的 test-only eventsource 边界输出 model/reasoning_effort/has_thinking；不连网络。 |
| `request_cost_reference_source_check.mjs` | 真实冻结 full 只读核对：240 条 `memory_reference_logs` 的 id/memory_id 16 字节 SQL 事实、唯一 reader 240 条全解析、canon/业务内容签名，源 SHA 前后不变；不写源/快照。 |
| `prompt_prefix_probe_test.exs` | 探针证据判定回归，防止重复/隐藏请求、错来源或缺失缓存字段被算作成功。 |

## 缓存基线

`PREFIX_PROBE_PROFILE_DIR` 显式指定既有桌面 profile 目录，仅在当前 BEAM 内存使用其中的
Provider 设置和凭据，不修改文件。未提供凭据的通道记 blocked；不加载或切换本地模型。
`PREFIX_PROBE_LABEL=baseline` 指定标签，结果在 `artifacts/model-contracts/prefix-live/<label>/`。
默认顺序是生产单调用、更换作者输入、更换稳定前缀、独立样本的同请求复测；
`PREFIX_PROBE_MODE=single` 仅执行首个生产调用（纠错单列）。缓存 miss 是基线事实，不等于协议失败；
缺字段记 unobservable，非流式耗时不冒充 TTFT。原始证据不含认证头。

自测：`MIX_ENV=test mix run scripts/model_contracts/prompt_prefix_probe_test.exs`。
