# scripts/lib/native_ui/fixtures/ — native_ui 只读测试夹具

本目录只放测试/对账使用的只读证据夹具；不进入产品路径，不启动原生窗口，也不写回任何历史批次。

| 文件 | 角色与实际消费者 |
|---|---|
| `authoring_request_ir.mjs` | 测试专用canonical IR夹具构造器：把既有native wire测试消息显式映射为fixture producer实际写出的`authoring-request-ir/v1` body（application marker→application_base/scope_update provenance、assistant tool_calls→tool_call blocks、tool JSON→observation/validation_result blocks）。只被Node正反例测试消费，生产reader不反向使用；不修改真实旧批次fixture。 |
| `authoring_confirmation_scenarios.mjs` | B71 §16.14 confirmation 场景夹具：真实 received/agent_event 帧、SQLite 行（JSON 文本列）、checkpoint canon、driver log 与显式 runtime 事实（`runtimeObservation`）。由 `../authoring_confirmation_evidence.test.mjs` 与 `../authoring_confirmation_batch_evidence.test.mjs` 消费；后者只复用这些数据构造临时完整批次，不改变原场景期望。artifacts 下的只读差分对账脚本也复用同一输入契约。测试只替换单一事实构造反例，不让单测读取真实机器进程/端口。 |
| `b71-pending-flat-ax-dual-candidates.json` | B71 CP4b pending 真实扁平 AX dump（89 节点，path/frame/order 保真；nonce 与派生标识脱敏）。由 `../authoring_pending_evidence.test.mjs` 消费，锁定消息块定位与兄弟候选按钮不可借用。 |
| `callrefs-03-native-id-provenance.json` | B71 §16.9 native id provenance 真实失败形状（raw 判断无 id、旧 canonical 无 `provider_call_id` 标记）。由 `../authoring_call_evidence.test.mjs` 用 Node 标准 JSON 模块消费（纯 join 的静态输入加载，不建 DB/目录、不触发业务 IO）：historical record 首判断必须报 retired/unsupported；同一真实响应/旧 canonical 语义再用现役 IR 记录复验，证明旧数据报 missing provenance、显式 nil 才通过。 |
| `authoring_call_fixture.mjs` | B71 §16.9 逐调用证据纯数据 owner：`RUN/WORK/WORKSPACE/SESSION/PARENT`、`scope/pair/call/exchange/assistant/base` 与 SSE/native-id 纯构造；被 `../authoring_call_evidence.test.mjs`、`../authoring_call_evidence_io.test.mjs` 与邻接 `authoring_call_db_fixture.mjs` 消费，不 import 被测 SUT，不读文件、不加载 SQLite。 |
| `authoring_call_db_fixture.mjs` | 上者邻接的 SQLite 构造规格：按真实 producer 的 1 表 9 个被消费列与 2 行 owned/foreign seed 生成 `{name, inputs, build}`；`inputs` 显式含 DDL、seed、DELETE journal 配置（同一 `JOURNAL_PRAGMAS` 驱动实际 PRAGMA 执行和指纹，不维护第二份声明）、真实 builder/纯 fixture 源码与 `process.versions` 的 node/sqlite 版本；builder 用 `DatabaseSync` 文件方式创建并在 finally 关闭；只给 `../authoring_call_evidence_io.test.mjs` 使用，不 import 被测 reader/join，不把最小查询投影称为生产完整 Schema。 |

索引回到 [`../README.md`](../README.md)。
