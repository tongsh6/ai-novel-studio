# Provider 映射：同一业务语义，三种原生报文

> 归档注：以下正文保留源包 `f13ff640` 的候选设计，不代表当前运行实现；后续契约差异与归属见 [归档说明](integration-notes.md)。

## 1. 本包的参考投影，不是第二适配层

`scripts/model_contracts/model_interaction/project_example.py`只供离线审查：读取派生request，输出三类**示意HTTP body**；不联网、不做认证、不写数据库。生产必须调用现有 `RequestIR.Projection` / Provider.Gateway，不能把本脚本接入产品形成平行adapter。

`fixture-model`、`fixture:SystemIdentity`、`fixture-policy-1`均是明确的合成标识，**不能原样发送生产**。投影代码中的system占位说明不替代真实SystemIdentity。真实模型参数/能力与供应商请求容忍度应由现役路由决定。

外部格式依据 [X02–X04]，业务规则依据 [S03/S08–S15]；不是用厂商通用文档覆盖项目自有语义。

## 2. 对照表

| 中立语义 | Chat Completions | Responses | Anthropic Messages |
|---|---|---|---|
| 系统规则 | messages中的system | instructions | 独立system |
| 作者原话 | user.content | input user项 | user text block |
| 工具定义 | tools[].function{name,parameters,...} | tools[]平铺type/name/parameters | tools[]{name,input_schema} |
| assistant工具调用 | tool_calls[].id/function.arguments字符串 | function_call，call_id/arguments字符串 | tool_use，id/input对象 |
| 工具结果 | role=tool，tool_call_id | function_call_output，call_id/output | 紧接下一user消息的tool_result，tool_use_id |
| 输出预算（示意） | max_completion_tokens | max_output_tokens | max_tokens |
| 流式用量 | stream_options.include_usage（仅支持时） | 原生response usage/event | 原生message usage/event |
| 空响应/失败 | finish_reason+transport状态 | response status/incomplete_details等 | stop_reason+transport状态 |

本地OpenAI-compatible入口可能使用max_tokens而非max_completion_tokens。必须按实际route能力选一种，不能为“兼容”同时发两者，更不能静默丢弃关键预算。示例使用Chat规范字段，不宣称本机Splash已测可接受。

## 3. Schema子集与strict模式

应用层JSON Schema2020-12用于完整离线结构验证，不等于供应商的受限tool schema子集。原生工具里有可选字段和开放的creative item属性；本包参考wire明确strict=false，避免把供应商对strict的默认行为当应用契约。

要使用strict=true，必须做明确schema lowering，核对additionalProperties、required/nullable和各API支持范围，测试所有原生payload。不能机械把所有字段设必填导致语义改变；不能将不可支持的验证关键字静默删掉后宣称同等严格。应用自己的Schema/effect/ref校验始终保留。当前10个工具镜像只用于复核，不得取代生产注册表。

## 4. 应用数据与tool结果如何落到原生消息

原生API通常没有application/author provenance字段。内部IR仍必须保存真实来源；wire可将应用数据放入明确标注的user数据消息，但这不把它变成作者原话。外部文本不能放进system。

参考投影把非tool-observation材料、task、最小权限/预算放在标明application provenance的数据区；真实观察只在它对应call_id的tool_result中展开。历史user/assistant/tool顺序不任意重排，当前作者消息按因果位置一次插入。

Anthropic：一条assistant含多个tool_use时，所有对应结果放到紧接的下一条user内容内，tool_result先于额外文本；不能中间插入当前作者消息/Scope去切断交换。参考脚本验证这个结构关系，但并未调用远端API测试。

Responses：保留function_call与function_call_output的call_id，不能把每一项当普通角色文本。涉及供应商私有推理/continuation对象时，必须由现役adapter保存必要opaque字段，绑定原provider/model，不给作者展示、不作为故事事实；本包不伪造这些私有字段。

## 5. 原始返回、归一化与逐字节

示例*.response.json仅是**最小原生响应片段**；省略真实供应商才会生成的id/时间/用量/细节，包含fixture标识。不是厂商完整Response Schema测试。

归一化ModelResponse保留原call_id、原arguments字符串、解析arguments、可见content、原终止原因和usage来源。不允许从结构错误输出里“猜测”修复参数后假装原输出合法。

原始网络字节hash与解析JSON字段字符串UTF-8hash是两件事。作者可见字节绑定比较后者；raw_capture_ref应指向真实原始捕获载体。本包fixture-ref-map把合成引用映射到实际样例文件及JSON Pointer，不能作为真实网络捕获记录。

## 6. Streaming与三种终止

工具arguments的delta只是字节/字符串片段，完整结束并解析+校验前不能dispatch。正文delta只是未定稿预览，不能产生已采纳事实。cancel_requested只是监督请求；actual cancelled或final_output/error才是相应终态。

ProviderEvent已有started/progress/chunk/final_output/usage_recorded/error/cancel_requested/cancelled等[S14]。本包只允许作者明确可见的叙事delta、来源字段和安全摘要，原始Prompt/secret/私有推理严禁投影。终态之后可有usage补报，不可再有新正文/进度改变已完成事实。

## 7. 验证命令与解释

```bash
python scripts/model_contracts/model_interaction/project_example.py --export
```

检查3种wire的工具定义形状、调用与结果对应、消息邻接、作者原话一次插入、观察不伪装Base、模型/运行状态不误作API顶层参数、外部文本不升为system。通过表示**参考投影对自定义映射不变量一致**，不表示真实厂商接受、不表示现役Elixir投影与本脚本字节等价。
