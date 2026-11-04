# scripts/lib/native_ui/fixtures/ — native_ui 只读测试夹具

本目录只放测试/对账使用的只读证据夹具；不进入产品路径，不启动原生窗口，也不写回任何历史批次。

| 文件 | 角色与实际消费者 |
|---|---|
| `authoring_confirmation_scenarios.mjs` | B71 §16.14 confirmation 场景夹具：真实 received/agent_event 帧、SQLite 行（JSON 文本列）、checkpoint canon、driver log 与显式 runtime 事实（`runtimeObservation`）。由 `../authoring_confirmation_evidence.test.mjs` 与 `../authoring_confirmation_batch_evidence.test.mjs` 消费；后者只复用这些数据构造临时完整批次，不改变原场景期望。artifacts 下的只读差分对账脚本也复用同一输入契约。测试只替换单一事实构造反例，不让单测读取真实机器进程/端口。 |
| `b71-pending-flat-ax-dual-candidates.json` | B71 CP4b pending 真实扁平 AX dump（89 节点，path/frame/order 保真；nonce 与派生标识脱敏）。由 `../authoring_pending_evidence.test.mjs` 消费，锁定消息块定位与兄弟候选按钮不可借用。 |
| `callrefs-03-native-id-provenance.json` | B71 §16.9 native id provenance 真实失败形状（raw 判断无 id、旧 canonical 无 `provider_call_id` 标记）。由 `../authoring_call_evidence.test.mjs` 消费，证明旧数据报 missing provenance、显式 nil 才通过。 |

索引回到 [`../README.md`](../README.md)。
