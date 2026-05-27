# PR Checklist

- [ ] Slice 的 Contract / Invariant / Boundary / Consumer / Proof / Acceptance Driver 已写清。
- [ ] 没有在产品代码中新增验收专用 env、slice id、DOM hook、Channel/API event 或 provider 注册。
- [ ] Manifest 已登记到 `quality/acceptance/scenarios.yml`。
- [ ] 单场景 manifest 包含 evidence、assertions 和 anti_hooks。
- [ ] `bash scripts/quality_manifest_check.sh` 通过。
- [ ] I1 / I2 / I3 没有被删除、跳过或弱化。
- [ ] artifacts 未作为源码提交。
- [ ] PR 说明区分局部测试、运行时不变量和真实 UI 场景化验收。

