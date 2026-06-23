# AU12 Profile Read Failure Degrade / 作品档案读取失败降级

- 状态：done
- 类型：Acceptance Slice + UI Projection Slice
- 日期：2026-06-22
- 所属验收：`docs/design/acceptance/author/AU-12-work-profile.md` `SC-AU12-B3`

## 1. 目标

关闭 AU-12 二轮剩余 P1：作品档案读取失败时，真实工作台必须诚实显示失败状态，而不是把失败折叠成「状态未明」或空字段「暂未填写」。作者能看到可恢复的「重试读取」，服务恢复后重新读取真实作品档案字段；失败和重试期间不产生 `user_message`、`author_action`、adoption、tool 或 production write。

## 2. 开工检查

- **Contract**：`AU-12-work-profile.md` `SC-AU12-B3`；`docs/design/ui/43-structure-panel.md` §3/§5；Channel `get_work_profile`；`StructurePanel` 概览 profile read model。
- **Invariant**：AU12-I2 档案只读 no-write；AU12-I6 缺字段或读取失败必须诚实显示，不编造、不静默空白。
- **Boundary**：真实 Tauri Workbench UI -> `StructurePanel` -> Phoenix Channel `get_work_profile` -> `WorkArchiveService.profile/1`。只改前端错误投影与外部验收 driver；不改 provider/runtime，不新增 slice id/env/query/localStorage/DOM hook。
- **Consumer**：作者打开作品档案「概览」，在同步失败时看到读取失败说明和重试动作；服务恢复后点击「重试读取」核对真实 works 立项字段。
- **Proof**：`bash scripts/quality_accept.sh au12-profile-read-failure-degrade --surface tauri`；`frontend/slice-verify/native-tauri-verifier.test.mjs`；`frontend/src/lib/__tests__/structure_panel.test.ts`；`node --check` / `bash -n`。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh au12-profile-read-failure-degrade`。外部 driver 创建真实作品、打开真实 Tauri 工作台、停止 slice Phoenix 服务、打开作品档案触发失败态、恢复服务并点击可见「重试读取」。产品代码不感知验收场景。
- **Primary Acceptance File**：`docs/design/acceptance/author/AU-12-work-profile.md`
- **Affected Acceptance Files**：`docs/design/acceptance/README.md`；`docs/design/acceptance/SCENARIO-BLUEPRINT.md`
- **Dependency Reason**：该 P1 阻塞 AU-12 文件级二轮退出；依赖 UI projection 与 acceptance driver。无需提前处理其他 blueprint 文件。

## 3. 实现

- `StructurePanel` 区分 `profileLoadFailed` 与空字段：失败时显示「作品档案读取失败」和「重试读取」，隐藏 profile 状态 badge、字段行和「提出立项修订」入口，避免把故障伪装成空档案。
- `copy.ts` 集中新增读取失败文案。
- `external-ui-driver.mjs` 新增 `au12-profile-read-failure-degrade`：使用已有 Phoenix service controller 外部停/启服务；通过可见文案、role 和真实日志断言失败态、重试恢复、no-write。
- `native-tauri-verifier.mjs` 新增 evidence/behavior 规则，要求外部停服、失败态可见、空档案字段隐藏、rejoin、retry 后 `get_work_profile.done`、真实字段恢复、全程 no-write/no author_action。
- quality scenario / runner / README 挂入新 slice。

## 4. 真实验收证据

- `artifacts/slice-verify/au12-profile-read-failure-degrade-tauri/summary.json`
- behavior：`work_profile_read_failure_degrades_honestly_and_recovers_on_retry`
- key events：`channel.join.done`、`channel.get_work_profile.done`、`slice_verify.ui_state.done`
- 关键断言：
  - `external_driver_stopped_slice_phoenix_service`
  - `real_archive_overview_showed_profile_read_failure`
  - `failure_state_did_not_render_unknown_status_or_empty_profile_rows`
  - `failure_copy_stated_no_fabricated_profile_content`
  - `external_driver_restarted_slice_phoenix_service`
  - `author_clicked_visible_retry_action`
  - `retry_loaded_real_work_profile_fields`
  - `failure_state_cleared_after_retry`
  - `profile_failure_and_retry_stayed_readonly`
  - `no_user_message_or_author_action_frame_sent`

## 5. 验证

- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `bash -n scripts/tauri_slice_verify.sh`
- [x] `pnpm --dir frontend exec vitest run src/lib/__tests__/structure_panel.test.ts slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh --list`
- [x] `bash scripts/quality_accept.sh au12-profile-read-failure-degrade --surface tauri`

## 6. 收口结论

`SC-AU12-B3` 从「空字段已验收、读取失败 P1 缺口」推进为已验收。AU-12 当前剩余缺口不再包含 P1；A2 同轮 provider prompt proof、accepted `world_setting` 物化 works 字段和更丰富立项要素扩展继续作为 P2 后续。
