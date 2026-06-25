export const nativeSliceIds = [
  "workspace-runtime-state",
  "su02-work-switching",
  "su02-artifact-projection-trace-isolation",
  "su02-empty-start-unnamed-work",
  "su02-pending-result-work-isolation",
  "su02-work-lifecycle-management",
  "su02-work-restart-recovery",
  "su01-provider-health-model",
  "su01-lmstudio-disconnected-health",
  "su01-provider-endpoint-validation",
  "su01-provider-model-list-success",
  "su01-provider-test-failure-ui",
  "su01-api-key-secret-redaction",
  "su01-provider-vendor-matrix",
  "su01-local-secret-file-roundtrip",
  "su01-model-provider-switching",
  "stage-startup-context-contract",
  "au03c-work-session-resume",
  "su03-assistant-display-name",
  "au05-adoption-boundary",
  "au05-adoption-followup-routing",
  "au05-discard-boundary",
  "au05-modify-draft-boundary",
  "au08-adoption-reading-projection",
  "au09-archive-real-data",
  "au09-archive-stats-current",
  "au09-memory-recall-context",
  "au03-session-history-readonly",
  "au03-session-new-active",
  "au03-branch-from-history",
  "au03-archive-session-filter",
  "au03-current-work-context-ssot",
  "au03-long-session-compression",
  "au03-context-source-ui",
  "au07-trace-why-entry",
  "au07-gate-reason-why",
  "au07-persisted-trace-query",
  "au07-partial-replay-ui",
  "au07-trace-query-scope-negative-matrix",
  "au07-tooltrace-registry-redacted-io",
  "au07-state-trace-adoption-replay",
  "au07-behavior-trace-terminal-replay",
  "au10-workbench-matrix-layout",
  "au10-workbench-recovery-taskstate",
  "au10-workbench-recovery-disconnect-timeout",
  "au10-workbench-recovery-provider-timeout",
  "au10-workbench-recovery-reconnect",
  "au10-workbench-recovery-cancel-waiting",
  "au10-micro-plan-entry",
  "au10-ordinary-chat-no-micro-plan",
  "e2e-01-downgrade-real-page",
  "e2e-01-readonly-tool-trace",
  "e2e-01-replay-report",
  "e2e-01-channel-action-security",
  "au01-ordinary-chat-two-turn-roundtrip",
  "au01-empty-message-guard",
  "au01-garbage-json-recovery",
  "au01-frame-validation-friendly-error",
  "au01-turnresult-recorder-ui-consistency",
  "au02-natural-exploration-no-slot-form",
  "au02-candidate-fallback-ui",
  "au02-candidate-continuation",
  "au02-candidate-multiturn-context",
  "au02-freeform-followup-after-candidate",
  "au02-unadopted-candidate-no-reading-fact",
  "au02-candidate-adoption-bridge",
  "au05-adoption-safety-freshness",
  "au05-stale-conflict-cross-work-freshness",
  "au05-conflict-cross-work-recovery",
  "au05-canon-conflict-recovery",
  "au05-discard-author-action",
  "p1-chapter-plan-minimum",
  "p1-chapter-draft-generation",
  "p1-prose-execution-brief",
  "p1-chapter-adoption-reading",
  "p1-word-count-audit",
  "p1-chapter-edit-then-accept",
  "p1-chapter-overwrite-confirm",
  "p1-chapter-expansion",
  "p1-chapter-expansion-multichapter",
  "p1-chapter-word-count-target",
  "p1-export-minimum",
  "au08-reading-readonly-no-write",
  "au08-reading-return-context",
  "p1-plan-incremental",
  "au04-confirm-before-execute",
  "au04-confirmation-tool-failure-recovery",
  "au04-confirm-idempotency-ui",
  "au04-stale-confirmation-ui",
  "au06-single-active-confirmation",
  "au04-confirmation-ttl-ui",
  "au04-disabled-confirmation-action-ui",
  "au04-history-confirmation-readonly",
  "au04-cross-work-confirmation-guard",
  "au04-latest-context-rebase-confirmation",
  "vs00c-cp0-missing-chapter-block",
  "vs00c-cp3-structured-context",
  "vs00c-cp4-chapter-plan-structure",
  "vs00c-cp5-reader-effect-brief",
  "au09-memory-create-recall",
  "au09-memory-management-entry",
  "au09-memory-management-filter-matrix",
  "au09-memory-trace-roundtrip",
  "au09-adopt-setting-recall",
  "au09-character-dossier-roundtrip",
  "au09-character-role-taxonomy-protagonist-policy",
  "au09-character-candidate-per-item-adoption",
  "au12-archive-concurrent-model-run-read-snapshot",
  "au09-memory-taxonomy-write-policy",
  "au09-memory-list-ux-redesign",
  "au09-validity-window-recall",
  "au09-cross-work-memory-isolation",
  "au09-au03-session-memory-layering",
  "au11-quality-diagnosis-message-envelope",
  "au11-missing-workstate-policy",
  "au12-profile-read-failure-degrade",
  "au12-correction-intent-roundtrip",
  "vs10-observability-spine",
];

const sliceKeyEvents = {
  "workspace-runtime-state": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.get_toc.done",
    "slice_verify.ui_state.done",
  ],
  "su02-work-switching": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "slice_verify.ui_state.done",
  ],
  "su02-artifact-projection-trace-isolation": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "slice_verify.ui_state.done",
  ],
  "su02-empty-start-unnamed-work": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "su02-pending-result-work-isolation": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "su02-work-lifecycle-management": [
    "work_session.resume.done",
    "channel.join.done",
    "slice_verify.ui_state.done",
  ],
  "su02-work-restart-recovery": [
    "work_session.resume.done",
    "channel.join.done",
    "slice_verify.ui_state.done",
  ],
  "su01-provider-health-model": ["channel.join.done", "slice_verify.ui_state.done"],
  "su01-lmstudio-disconnected-health": ["channel.join.done", "slice_verify.ui_state.done"],
  "su01-provider-endpoint-validation": ["channel.join.done", "slice_verify.ui_state.done"],
  "su01-provider-model-list-success": ["channel.join.done", "slice_verify.ui_state.done"],
  "su01-provider-test-failure-ui": ["channel.join.done", "slice_verify.ui_state.done"],
  "su01-api-key-secret-redaction": ["channel.join.done", "slice_verify.ui_state.done"],
  "su01-provider-vendor-matrix": ["channel.join.done", "slice_verify.ui_state.done"],
  "su01-local-secret-file-roundtrip": ["channel.join.done", "slice_verify.ui_state.done"],
  "su01-model-provider-switching": [
    "channel.join.done",
    "channel.user_message.start",
    "provider_gateway.complete.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "su03-assistant-display-name": [
    "channel.join.done",
    "channel.user_message.start",
    "provider_gateway.complete.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "stage-startup-context-contract": [
    "work_session.resume.done",
    "channel.join.done",
    "slice_verify.ui_state.done",
  ],
  "au03c-work-session-resume": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
  ],
  "au05-adoption-boundary": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "channel.adopt.start",
    "adoption.evaluate.done",
    "channel.adopt.done",
  ],
  "au05-adoption-followup-routing": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "channel.adopt.start",
    "adoption.evaluate.done",
    "channel.adopt.done",
    "slice_verify.ui_state.done",
  ],
  "au05-adoption-safety-freshness": [
    "channel.user_message.start",
    "planner.form_frame.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "slice_verify.ui_state.done",
  ],
  "au05-stale-conflict-cross-work-freshness": [
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "slice_verify.ui_state.done",
  ],
  "au05-conflict-cross-work-recovery": [
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "slice_verify.ui_state.done",
  ],
  "au05-canon-conflict-recovery": [
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "slice_verify.ui_state.done",
  ],
  "p1-chapter-plan-minimum": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "slice_verify.ui_state.done",
  ],
  "p1-chapter-draft-generation": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.get_toc.done",
    "slice_verify.ui_state.done",
  ],
  "p1-prose-execution-brief": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "context.assemble.done",
    "context.structure.done",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "creative_decision_packet.built.done",
    "prose_execution_brief.built.done",
    "toolbox.execute.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "p1-chapter-adoption-reading": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "slice_verify.ui_state.done",
  ],
  "au07-state-trace-adoption-replay": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "slice_verify.ui_state.done",
  ],
  "au05-discard-author-action": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "slice_verify.ui_state.done",
  ],
  "p1-word-count-audit": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "slice_verify.ui_state.done",
  ],
  "p1-chapter-edit-then-accept": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "slice_verify.ui_state.done",
  ],
  "p1-chapter-overwrite-confirm": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "slice_verify.ui_state.done",
  ],
  "p1-chapter-expansion": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "slice_verify.ui_state.done",
  ],
  "p1-chapter-expansion-multichapter": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "slice_verify.ui_state.done",
  ],
  "au04-confirm-before-execute": [
    "channel.user_message.start",
    "channel.user_message.done",
    "orchestrator.decide.done",
    "channel.author_action.start",
    "channel.author_action.done",
    "toolbox.execute.done",
    "slice_verify.ui_state.done",
  ],
  "au04-confirm-idempotency-ui": [
    "channel.user_message.start",
    "channel.user_message.done",
    "orchestrator.decide.done",
    "channel.author_action.start",
    "channel.author_action.done",
    "toolbox.execute.done",
    "slice_verify.ui_state.done",
  ],
  "au04-confirmation-tool-failure-recovery": [
    "channel.user_message.start",
    "channel.user_message.done",
    "orchestrator.decide.done",
    "channel.author_action.start",
    "channel.author_action.done",
    "provider_gateway.complete.error",
    "toolbox.execute.error",
    "slice_verify.ui_state.done",
  ],
  "au04-stale-confirmation-ui": [
    "channel.user_message.start",
    "channel.user_message.done",
    "orchestrator.decide.done",
    "channel.author_action.start",
    "channel.author_action.error",
    "slice_verify.ui_state.done",
  ],
  "au06-single-active-confirmation": [
    "channel.user_message.start",
    "channel.user_message.done",
    "orchestrator.decide.done",
    "channel.author_action.error",
    "channel.author_action.start",
    "channel.author_action.done",
    "toolbox.execute.done",
    "slice_verify.ui_state.done",
  ],
  "au04-confirmation-ttl-ui": [
    "channel.join.done",
    "channel.author_action.start",
    "channel.author_action.error",
    "slice_verify.ui_state.done",
  ],
  "au04-disabled-confirmation-action-ui": [
    "work_session.resume.done",
    "channel.join.done",
    "slice_verify.ui_state.done",
  ],
  "au04-history-confirmation-readonly": [
    "work_session.resume.done",
    "channel.join.done",
    "work_session.show.done",
    "slice_verify.ui_state.done",
  ],
  "au04-cross-work-confirmation-guard": [
    "work_session.resume.done",
    "channel.join.done",
    "slice_verify.ui_state.done",
  ],
  "au04-latest-context-rebase-confirmation": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.author_action.start",
    "channel.author_action.done",
    "toolbox.execute.done",
    "slice_verify.ui_state.done",
  ],
  // CP0：续写不存在的章 → 执行前 block。要求坐标与缺失决策业务日志出现，
  // 且不要求 toolbox.execute（block 短路不调 provider，由 driver 断言 tool_called=false）。
  "vs00c-cp0-missing-chapter-block": [
    "channel.user_message.start",
    "channel.user_message.done",
    "turn_execution.writing_coordinate.done",
    "turn_execution.missing_policy.done",
    "slice_verify.ui_state.done",
  ],
  "vs00c-cp3-structured-context": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "context.assemble.done",
    "context.structure.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.get_toc.done",
    "slice_verify.ui_state.done",
  ],
  "vs00c-cp4-chapter-plan-structure": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "channel.author_action.done",
    "context.assemble.done",
    "context.structure.done",
    "channel.user_message.done",
    "channel.get_toc.done",
    "slice_verify.ui_state.done",
  ],
  "vs00c-cp5-reader-effect-brief": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "channel.author_action.done",
    "context.assemble.done",
    "context.structure.done",
    "context.reader_effect.done",
    "channel.user_message.done",
    "channel.get_toc.done",
    "slice_verify.ui_state.done",
  ],
  "p1-export-minimum": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.export_work.done",
    "slice_verify.ui_state.done",
  ],
  "au08-reading-readonly-no-write": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "channel.export_work.done",
    "slice_verify.ui_state.done",
  ],
  "au08-reading-return-context": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "channel.user_message.start",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "p1-plan-incremental": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.done",
    "adoption.evaluate.done",
    "channel.get_toc.done",
    "slice_verify.ui_state.done",
  ],
  "p1-chapter-word-count-target": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "turn_execution.target_word_count.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
    "slice_verify.ui_state.done",
  ],
  "au09-memory-create-recall": [
    "channel.user_message.start",
    "context.assemble.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au09-memory-management-entry": [
    "channel.user_message.start",
    "context.assemble.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au09-memory-management-filter-matrix": ["slice_verify.ui_state.done"],
  "au09-memory-trace-roundtrip": [
    "channel.user_message.start",
    "context.assemble.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au09-adopt-setting-recall": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_foreshadowing.done",
    "channel.get_rules.done",
    "context.assemble.done",
    "slice_verify.ui_state.done",
  ],
  "au09-character-dossier-roundtrip": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_characters.done",
    "context.characters.done",
    "slice_verify.ui_state.done",
  ],
  "au09-character-role-taxonomy-protagonist-policy": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_characters.done",
    "slice_verify.ui_state.done",
  ],
  "au09-character-candidate-per-item-adoption": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "channel.get_characters.done",
    "slice_verify.ui_state.done",
  ],
  "au12-archive-concurrent-model-run-read-snapshot": [
    "channel.user_message.start",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au09-memory-taxonomy-write-policy": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "slice_verify.ui_state.done",
  ],
  "au09-memory-list-ux-redesign": ["slice_verify.ui_state.done"],
  "au09-validity-window-recall": [
    "channel.user_message.start",
    "context.assemble.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au09-cross-work-memory-isolation": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.get_foreshadowing.done",
    "channel.get_rules.done",
    "channel.user_message.start",
    "context.assemble.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au09-au03-session-memory-layering": [
    "work_session.resume.done",
    "channel.join.done",
    "work_session.show.done",
    "channel.user_message.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au11-quality-diagnosis-message-envelope": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au11-missing-workstate-policy": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au05-discard-boundary": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "channel.discard.start",
    "channel.discard.done",
  ],
  "au05-modify-draft-boundary": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "channel.modify_draft.start",
    "adoption.evaluate.done",
    "channel.modify_draft.done",
  ],
  "au08-adoption-reading-projection": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "toolbox.execute.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "channel.adopt.start",
    "adoption.evaluate.done",
    "channel.adopt.done",
    "channel.get_toc.done",
    "channel.get_chapter_content.done",
  ],
  "au09-archive-real-data": [
    "channel.join.done",
    "channel.get_characters.done",
    "channel.get_foreshadowing.done",
    "channel.get_rules.done",
    "channel.get_work_stats.done",
    "slice_verify.ui_state.done",
  ],
  "au09-archive-stats-current": [
    "channel.join.done",
    "channel.get_characters.done",
    "channel.get_foreshadowing.done",
    "channel.get_rules.done",
    "channel.get_work_stats.done",
    "slice_verify.ui_state.done",
  ],
  "au09-memory-recall-context": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au03-session-history-readonly": [
    "work_session.resume.done",
    "channel.join.done",
    "work_session.show.done",
    "slice_verify.ui_state.done",
  ],
  "au03-session-new-active": [
    "work_session.resume.done",
    "channel.join.done",
    "work_session.create.done",
    "work_session.show.done",
    "channel.user_message.start",
    "context.assemble.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au03-branch-from-history": [
    "work_session.resume.done",
    "channel.join.done",
    "work_session.show.done",
    "work_session.create.done",
    "slice_verify.ui_state.done",
  ],
  "au03-archive-session-filter": [
    "work_session.resume.done",
    "channel.join.done",
    "work_session.show.done",
    "work_session.archive.done",
    "slice_verify.ui_state.done",
  ],
  "au03-current-work-context-ssot": [
    "work_session.resume.done",
    "channel.join.done",
    "work_session.show.done",
    "channel.user_message.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au03-long-session-compression": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au03-context-source-ui": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au07-trace-why-entry": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au07-gate-reason-why": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "orchestrator.decide.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au07-persisted-trace-query": [
    "work_session.resume.done",
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au07-partial-replay-ui": [
    "work_session.resume.done",
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au07-trace-query-scope-negative-matrix": [
    "work_session.resume.done",
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au10-workbench-matrix-layout": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "slice_verify.ui_state.done",
  ],
  "au10-workbench-recovery-taskstate": [
    "channel.task_state.done",
    "channel.export_work.done",
    "slice_verify.ui_state.done",
  ],
  "au10-workbench-recovery-disconnect-timeout": [
    "provider_gateway.complete.error",
    "channel.user_message.done",
    "provider_gateway.complete.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au10-workbench-recovery-provider-timeout": [
    "provider_gateway.complete.error",
    "channel.user_message.done",
    "provider_gateway.complete.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au10-workbench-recovery-reconnect": [
    "channel.join.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au10-workbench-recovery-cancel-waiting": [
    "channel.user_message.done",
    "channel.author_action.start",
    "channel.author_action.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au07-behavior-trace-terminal-replay": [
    "channel.user_message.done",
    "channel.author_action.start",
    "channel.author_action.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au12-work-profile-overview": ["channel.get_work_profile.done", "slice_verify.ui_state.done"],
  "au12-work-profile-status-isolation": [
    "channel.get_work_profile.done",
    "slice_verify.ui_state.done",
  ],
  "au12-profile-read-failure-degrade": [
    "channel.join.done",
    "channel.get_work_profile.done",
    "slice_verify.ui_state.done",
  ],
  "au12-correction-intent-roundtrip": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "orchestrator.decide.done",
    "toolbox.execute.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au10-micro-plan-entry": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ],
  "e2e-01-downgrade-real-page": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "orchestrator.decide.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "e2e-01-readonly-tool-trace": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "orchestrator.decide.done",
    "context.characters.done",
    "toolbox.execute.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "e2e-01-replay-report": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "orchestrator.decide.done",
    "context.characters.done",
    "toolbox.execute.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au07-tooltrace-registry-redacted-io": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "orchestrator.decide.done",
    "context.characters.done",
    "toolbox.execute.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "e2e-01-channel-action-security": [
    "channel.join.done",
    "channel.user_message.start",
    "channel.user_message.done",
    "channel.author_action.start",
    "channel.author_action.error",
    "slice_verify.ui_state.done",
  ],
  "au10-ordinary-chat-no-micro-plan": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ],
  "au01-ordinary-chat-two-turn-roundtrip": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ],
  "au01-empty-message-guard": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ],
  "au01-garbage-json-recovery": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ],
  "au01-frame-validation-friendly-error": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.error",
    "channel.user_message.error",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ],
  "au01-turnresult-recorder-ui-consistency": [
    "work_session.resume.done",
    "channel.join.done",
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "work_session.show.done",
    "slice_verify.ui_state.done",
  ],
  "au02-natural-exploration-no-slot-form": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au02-candidate-fallback-ui": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au02-candidate-continuation": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ],
  "au02-candidate-multiturn-context": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "au02-freeform-followup-after-candidate": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ],
  "au02-unadopted-candidate-no-reading-fact": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "channel.get_toc.done",
    "slice_verify.ui_state.done",
  ],
  "au02-candidate-adoption-bridge": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "slice_verify.ui_state.done",
  ],
  "vs10-observability-spine": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "planner.form_micro_plan.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ],
};

export function keyEventsForSlice(sliceId) {
  return sliceKeyEvents[sliceId] ?? [];
}

export function findLmStudioEvidence(turnIds, records) {
  const requiredTurnIds = new Set(turnIds.filter(Boolean));
  if (requiredTurnIds.size === 0) return null;

  const matching = records.filter((record) => {
    if (!requiredTurnIds.has(record.turn_id)) return false;
    if (record.provider !== "lmstudio") return false;
    if (record.request?.method !== "POST") return false;
    if (!String(record.request?.url ?? "").includes("/chat/completions")) return false;

    const status = Number(record.response?.status ?? 0);
    return status >= 200 && status < 300;
  });

  if (matching.length === 0) return null;

  const matchedTurnIds = [...new Set(matching.map((record) => record.turn_id))];
  const missingTurn = [...requiredTurnIds].some((turnId) => !matchedTurnIds.includes(turnId));
  if (missingTurn) return null;

  return {
    provider: "lmstudio",
    turn_ids: [...requiredTurnIds],
    request_count: matching.length,
    status_codes: [...new Set(matching.map((record) => Number(record.response.status)))],
  };
}

export function findNativeSliceEvidence(sliceId, records) {
  if (sliceId === "workspace-runtime-state") {
    return findWorkspaceRuntimeStateEvidence(records);
  }

  if (sliceId === "su02-work-switching") {
    return findSu02WorkSwitchingEvidence(records);
  }

  if (sliceId === "su02-artifact-projection-trace-isolation") {
    return findSu02ArtifactProjectionTraceIsolationEvidence(records);
  }

  if (sliceId === "su02-empty-start-unnamed-work") {
    return findSu02EmptyStartUnnamedWorkEvidence(records);
  }

  if (sliceId === "su02-pending-result-work-isolation") {
    return findSu02PendingResultWorkIsolationEvidence(records);
  }

  if (sliceId === "su02-work-lifecycle-management") {
    return findSu02WorkLifecycleManagementEvidence(records);
  }

  if (sliceId === "su02-work-restart-recovery") {
    return findSu02WorkRestartRecoveryEvidence(records);
  }

  if (sliceId === "su01-provider-health-model") {
    return findSu01ProviderHealthEvidence(records);
  }

  if (sliceId === "su01-lmstudio-disconnected-health") {
    return findSu01LmstudioDisconnectedHealthEvidence(records);
  }

  if (sliceId === "su01-provider-endpoint-validation") {
    return findSu01ProviderEndpointValidationEvidence(records);
  }

  if (sliceId === "su01-provider-model-list-success") {
    return findSu01ProviderModelListSuccessEvidence(records);
  }

  if (sliceId === "su01-provider-test-failure-ui") {
    return findSu01ProviderTestFailureUiEvidence(records);
  }

  if (sliceId === "su01-api-key-secret-redaction") {
    return findSu01ApiKeySecretRedactionEvidence(records);
  }

  if (sliceId === "su01-provider-vendor-matrix") {
    return findSu01ProviderVendorMatrixEvidence(records);
  }

  if (sliceId === "su01-local-secret-file-roundtrip") {
    return findSu01LocalSecretFileRoundtripEvidence(records);
  }

  if (sliceId === "su01-model-provider-switching") {
    return findSu01ModelProviderSwitchingEvidence(records);
  }

  if (sliceId === "su03-assistant-display-name") {
    return findSu03AssistantDisplayNameEvidence(records);
  }

  if (sliceId === "stage-startup-context-contract") {
    return findStageStartupContextEvidence(records);
  }

  if (sliceId === "au03c-work-session-resume") {
    return findAu03cWorkSessionResumeEvidence(records);
  }

  if (sliceId === "au05-adoption-boundary") {
    return findAu05ActionEvidence(records, sliceId, "channel.adopt.done");
  }

  if (sliceId === "au05-adoption-followup-routing") {
    return findAu05FollowupRoutingEvidence(records);
  }

  if (sliceId === "au05-discard-boundary") {
    return findAu05ActionEvidence(records, sliceId, "channel.discard.done");
  }

  if (sliceId === "au05-modify-draft-boundary") {
    return findAu05ActionEvidence(records, sliceId, "channel.modify_draft.done");
  }

  if (sliceId === "au08-adoption-reading-projection") {
    return findAu08ReadingProjectionEvidence(records);
  }

  if (sliceId === "au09-archive-real-data" || sliceId === "au09-archive-stats-current") {
    return findAu09ArchiveEvidence(records, sliceId);
  }

  if (sliceId === "au09-memory-recall-context") {
    return findAu09MemoryRecallEvidence(records);
  }

  if (sliceId === "au03-session-history-readonly") {
    return findAu03SessionHistoryReadonlyEvidence(records);
  }

  if (sliceId === "au03-session-new-active") {
    return findAu03SessionNewActiveEvidence(records);
  }

  if (sliceId === "au03-branch-from-history") {
    return findAu03BranchFromHistoryEvidence(records);
  }

  if (sliceId === "au03-archive-session-filter") {
    return findAu03ArchiveSessionFilterEvidence(records);
  }

  if (sliceId === "au03-current-work-context-ssot") {
    return findAu03CurrentWorkContextSsotEvidence(records);
  }

  if (sliceId === "au03-long-session-compression") {
    return findAu03LongSessionCompressionEvidence(records);
  }

  if (sliceId === "au03-context-source-ui") {
    return findAu03ContextSourceUiEvidence(records);
  }

  if (sliceId === "au07-trace-why-entry") {
    return findAu07TraceWhyEvidence(records);
  }

  if (sliceId === "au07-gate-reason-why") {
    return findAu07GateReasonWhyEvidence(records);
  }

  if (sliceId === "au07-persisted-trace-query") {
    return findAu07PersistedTraceQueryEvidence(records);
  }

  if (sliceId === "au07-partial-replay-ui") {
    return findAu07PartialReplayUiEvidence(records);
  }

  if (sliceId === "au07-trace-query-scope-negative-matrix") {
    return findAu07TraceQueryScopeNegativeMatrixEvidence(records);
  }

  if (sliceId === "au10-workbench-matrix-layout") {
    return findAu10WorkbenchMatrixLayoutEvidence(records);
  }

  if (sliceId === "au10-workbench-recovery-taskstate") {
    return findAu10WorkbenchRecoveryTaskstateEvidence(records);
  }

  if (sliceId === "au10-workbench-recovery-disconnect-timeout") {
    return findAu10WorkbenchRecoveryDisconnectTimeoutEvidence(records);
  }

  if (sliceId === "au10-workbench-recovery-provider-timeout") {
    return findAu10WorkbenchRecoveryProviderTimeoutEvidence(records);
  }

  if (sliceId === "au10-workbench-recovery-reconnect") {
    return findAu10WorkbenchRecoveryReconnectEvidence(records);
  }

  if (sliceId === "au10-workbench-recovery-cancel-waiting") {
    return findAu10WorkbenchRecoveryCancelWaitingEvidence(records);
  }

  if (sliceId === "au07-behavior-trace-terminal-replay") {
    return findAu07BehaviorTraceTerminalReplayEvidence(records);
  }

  if (sliceId === "au12-work-profile-overview") {
    return findAu12WorkProfileOverviewEvidence(records);
  }

  if (sliceId === "au12-work-profile-status-isolation") {
    return findAu12WorkProfileStatusIsolationEvidence(records);
  }

  if (sliceId === "au12-profile-read-failure-degrade") {
    return findAu12ProfileReadFailureDegradeEvidence(records);
  }

  if (sliceId === "au12-correction-intent-roundtrip") {
    return findAu12CorrectionIntentRoundtripEvidence(records);
  }

  if (sliceId === "au10-micro-plan-entry") {
    return findAu10UserMessageEvidence(records, true, "au10-micro-plan-entry");
  }

  if (sliceId === "e2e-01-downgrade-real-page") {
    return findE2E01DowngradeRealPageEvidence(records);
  }

  if (sliceId === "e2e-01-readonly-tool-trace") {
    return findE2E01ReadonlyToolTraceEvidence(records);
  }

  if (sliceId === "e2e-01-replay-report") {
    return findE2E01ReplayReportEvidence(records);
  }

  if (sliceId === "au07-tooltrace-registry-redacted-io") {
    return findAu07TooltraceRegistryRedactedIoEvidence(records);
  }

  if (sliceId === "e2e-01-channel-action-security") {
    return findE2E01ChannelActionSecurityEvidence(records);
  }

  if (sliceId === "au10-ordinary-chat-no-micro-plan") {
    return findAu10UserMessageEvidence(records, false, "au10-ordinary-chat-no-micro-plan");
  }

  if (sliceId === "au01-ordinary-chat-two-turn-roundtrip") {
    return findOrdinaryChatTwoTurnEvidence(records);
  }

  if (sliceId === "au01-empty-message-guard") {
    return findAu01EmptyMessageGuardEvidence(records);
  }

  if (sliceId === "au01-garbage-json-recovery") {
    return findAu01GarbageJsonRecoveryEvidence(records);
  }

  if (sliceId === "au01-frame-validation-friendly-error") {
    return findAu01FrameValidationFriendlyErrorEvidence(records);
  }

  if (sliceId === "au01-turnresult-recorder-ui-consistency") {
    return findAu01TurnresultRecorderUiConsistencyEvidence(records);
  }

  if (sliceId === "au02-natural-exploration-no-slot-form") {
    return findNaturalExplorationNoSlotFormEvidence(records);
  }

  if (sliceId === "au02-candidate-fallback-ui") {
    return findCandidateFallbackUiEvidence(records);
  }

  if (sliceId === "au02-candidate-continuation") {
    return findCandidateContinuationEvidence(records);
  }

  if (sliceId === "au02-candidate-multiturn-context") {
    return findCandidateMultiturnContextEvidence(records);
  }

  if (sliceId === "au02-freeform-followup-after-candidate") {
    return findCandidateFreeformFollowupEvidence(records);
  }

  if (sliceId === "au02-unadopted-candidate-no-reading-fact") {
    return findUnadoptedCandidateNoReadingFactEvidence(records);
  }

  if (sliceId === "au02-candidate-adoption-bridge") {
    return findCandidateAdoptionBridgeEvidence(records);
  }

  if (sliceId === "au05-adoption-safety-freshness") {
    return findAdoptionSafetyFreshnessEvidence(records);
  }

  if (sliceId === "au05-stale-conflict-cross-work-freshness") {
    return findStaleConflictCrossWorkEvidence(records);
  }

  if (sliceId === "au05-conflict-cross-work-recovery") {
    return findConflictCrossWorkRecoveryEvidence(records);
  }

  if (sliceId === "au05-canon-conflict-recovery") {
    return findCanonConflictRecoveryEvidence(records);
  }

  if (sliceId === "p1-chapter-plan-minimum") {
    return findP1ChapterPlanMinimumEvidence(records);
  }

  if (sliceId === "p1-chapter-draft-generation") {
    return findP1ChapterDraftGenerationEvidence(records);
  }

  if (sliceId === "p1-word-count-audit") {
    return findP1WordCountAuditEvidence(records);
  }

  if (sliceId === "p1-chapter-adoption-reading") {
    return findP1ChapterAdoptionReadingEvidence(records);
  }

  if (sliceId === "au07-state-trace-adoption-replay") {
    return findAu07StateTraceAdoptionReplayEvidence(records);
  }

  if (sliceId === "au05-discard-author-action") {
    return findAu05DiscardAuthorActionEvidence(records);
  }

  if (sliceId === "p1-chapter-word-count-target") {
    return findP1ChapterWordCountTargetEvidence(records);
  }

  if (sliceId === "au04-confirm-before-execute") {
    return findAu04ConfirmBeforeExecuteEvidence(records);
  }

  if (sliceId === "au04-confirmation-tool-failure-recovery") {
    return findAu04ConfirmationToolFailureRecoveryEvidence(records);
  }

  if (sliceId === "au04-confirm-idempotency-ui") {
    return findAu04ConfirmIdempotencyUiEvidence(records);
  }

  if (sliceId === "au04-stale-confirmation-ui") {
    return findAu04StaleConfirmationUiEvidence(records);
  }

  if (sliceId === "au06-single-active-confirmation") {
    return findAu06SingleActiveConfirmationEvidence(records);
  }

  if (sliceId === "au04-confirmation-ttl-ui") {
    return findAu04ConfirmationTtlUiEvidence(records);
  }

  if (sliceId === "au04-disabled-confirmation-action-ui") {
    return findAu04DisabledConfirmationActionUiEvidence(records);
  }

  if (sliceId === "au04-history-confirmation-readonly") {
    return findAu04HistoryConfirmationReadonlyEvidence(records);
  }

  if (sliceId === "au04-cross-work-confirmation-guard") {
    return findAu04CrossWorkConfirmationGuardEvidence(records);
  }

  if (sliceId === "au04-latest-context-rebase-confirmation") {
    return findAu04LatestContextRebaseConfirmationEvidence(records);
  }

  if (sliceId === "vs00c-cp0-missing-chapter-block") {
    return findVs00cMissingChapterBlockEvidence(records);
  }

  if (sliceId === "vs00c-cp3-structured-context") {
    return findVs00cCp3StructuredContextEvidence(records);
  }

  if (sliceId === "p1-prose-execution-brief") {
    return findP1ProseExecutionBriefEvidence(records);
  }

  if (sliceId === "vs00c-cp4-chapter-plan-structure") {
    return findVs00cCp4ChapterPlanStructureEvidence(records);
  }

  if (sliceId === "vs00c-cp5-reader-effect-brief") {
    return findVs00cCp5ReaderEffectBriefEvidence(records);
  }

  if (sliceId === "p1-export-minimum") {
    return findP1ExportMinimumEvidence(records);
  }

  if (sliceId === "au08-reading-readonly-no-write") {
    return findAu08ReadingReadonlyNoWriteEvidence(records);
  }

  if (sliceId === "au08-reading-return-context") {
    return findAu08ReadingReturnContextEvidence(records);
  }

  if (sliceId === "p1-plan-incremental") {
    return findP1PlanIncrementalEvidence(records);
  }

  if (sliceId === "p1-chapter-edit-then-accept") {
    return findP1ChapterEditThenAcceptEvidence(records);
  }

  if (sliceId === "p1-chapter-overwrite-confirm") {
    return findP1ChapterOverwriteConfirmEvidence(records);
  }

  if (sliceId === "p1-chapter-expansion") {
    return findP1ChapterExpansionEvidence(records);
  }

  if (sliceId === "p1-chapter-expansion-multichapter") {
    return findP1ChapterExpansionMultichapterEvidence(records);
  }

  if (sliceId === "au09-memory-create-recall") {
    return findAu09MemoryCreateRecallEvidence(records);
  }

  if (sliceId === "au09-memory-management-entry") {
    return findAu09MemoryManagementEntryEvidence(records);
  }

  if (sliceId === "au09-memory-management-filter-matrix") {
    return findAu09MemoryManagementFilterMatrixEvidence(records);
  }

  if (sliceId === "au09-memory-trace-roundtrip") {
    return findAu09MemoryTraceRoundtripEvidence(records);
  }

  if (sliceId === "au09-adopt-setting-recall") {
    return findAu09AdoptSettingRecallEvidence(records);
  }

  if (sliceId === "au09-character-dossier-roundtrip") {
    return findAu09CharacterDossierRoundtripEvidence(records);
  }

  if (sliceId === "au09-character-role-taxonomy-protagonist-policy") {
    return findAu09CharacterRoleTaxonomyEvidence(records);
  }

  if (sliceId === "au09-character-candidate-per-item-adoption") {
    return findAu09CharacterCandidatePerItemAdoptionEvidence(records);
  }

  if (sliceId === "au12-archive-concurrent-model-run-read-snapshot") {
    return findAu12ArchiveConcurrentModelRunReadSnapshotEvidence(records);
  }

  if (sliceId === "au09-memory-taxonomy-write-policy") {
    return findAu09MemoryTaxonomyWritePolicyEvidence(records);
  }

  if (sliceId === "au09-memory-list-ux-redesign") {
    return findAu09MemoryListUxRedesignEvidence(records);
  }

  if (sliceId === "au09-validity-window-recall") {
    return findAu09ValidityWindowRecallEvidence(records);
  }

  if (sliceId === "au09-cross-work-memory-isolation") {
    return findAu09CrossWorkMemoryIsolationEvidence(records);
  }

  if (sliceId === "au09-au03-session-memory-layering") {
    return findAu09Au03SessionMemoryLayeringEvidence(records);
  }

  if (sliceId === "au11-quality-diagnosis-message-envelope") {
    return findAu11QualityDiagnosisMessageEnvelopeEvidence(records);
  }

  if (sliceId === "au11-missing-workstate-policy") {
    return findAu11MissingWorkstatePolicyEvidence(records);
  }

  if (sliceId === "vs10-observability-spine") {
    return findVs10LogSpineEvidence(records);
  }

  throw new Error(`Unknown native Tauri slice id: ${sliceId}`);
}

export function findSliceBehaviorEvidence(sliceId, records, evidence, options = {}) {
  if (!evidence) return null;

  if (sliceId === "workspace-runtime-state") {
    return workspaceRuntimeStateBehavior(records, evidence, options);
  }

  if (sliceId === "su02-work-switching") {
    return su02WorkSwitchingBehavior(records, evidence, options);
  }

  if (sliceId === "su02-artifact-projection-trace-isolation") {
    return su02ArtifactProjectionTraceIsolationBehavior(records, evidence, options);
  }

  if (sliceId === "su02-empty-start-unnamed-work") {
    return su02EmptyStartUnnamedWorkBehavior(records, evidence, options);
  }

  if (sliceId === "su02-pending-result-work-isolation") {
    return su02PendingResultWorkIsolationBehavior(records, evidence, options);
  }

  if (sliceId === "su02-work-lifecycle-management") {
    return su02WorkLifecycleManagementBehavior(records, evidence, options);
  }

  if (sliceId === "su02-work-restart-recovery") {
    return su02WorkRestartRecoveryBehavior(records, evidence, options);
  }

  if (sliceId === "su01-provider-health-model") {
    return su01ProviderHealthBehavior(records, evidence, options);
  }

  if (sliceId === "su01-lmstudio-disconnected-health") {
    return su01LmstudioDisconnectedHealthBehavior(records, evidence, options);
  }

  if (sliceId === "su01-provider-endpoint-validation") {
    return su01ProviderEndpointValidationBehavior(records, evidence, options);
  }

  if (sliceId === "su01-provider-model-list-success") {
    return su01ProviderModelListSuccessBehavior(records, evidence, options);
  }

  if (sliceId === "su01-provider-test-failure-ui") {
    return su01ProviderTestFailureUiBehavior(records, evidence, options);
  }

  if (sliceId === "su01-api-key-secret-redaction") {
    return su01ApiKeySecretRedactionBehavior(records, evidence, options);
  }

  if (sliceId === "su01-provider-vendor-matrix") {
    return su01ProviderVendorMatrixBehavior(records, evidence, options);
  }

  if (sliceId === "su01-local-secret-file-roundtrip") {
    return su01LocalSecretFileRoundtripBehavior(records, evidence, options);
  }

  if (sliceId === "su01-model-provider-switching") {
    return su01ModelProviderSwitchingBehavior(records, evidence, options);
  }

  if (sliceId === "su03-assistant-display-name") {
    return su03AssistantDisplayNameBehavior(records, evidence, options);
  }

  if (sliceId === "stage-startup-context-contract") {
    return stageStartupContextBehavior(records, evidence, options);
  }

  if (sliceId === "au03c-work-session-resume") {
    return workSessionResumeBehavior(records, evidence, options);
  }

  if (sliceId === "au09-archive-real-data" || sliceId === "au09-archive-stats-current") {
    return archiveRealDataBehavior(records, evidence, options, sliceId);
  }

  if (sliceId === "au09-memory-recall-context") {
    return memoryRecallContextBehavior(records, evidence, options);
  }

  if (sliceId === "au03-session-history-readonly") {
    return sessionHistoryReadonlyBehavior(records, evidence, options);
  }

  if (sliceId === "au03-session-new-active") {
    return sessionNewActiveBehavior(records, evidence, options);
  }

  if (sliceId === "au03-branch-from-history") {
    return branchFromHistoryBehavior(records, evidence, options);
  }

  if (sliceId === "au03-archive-session-filter") {
    return archiveSessionFilterBehavior(records, evidence, options);
  }

  if (sliceId === "au03-current-work-context-ssot") {
    return currentWorkContextSsotBehavior(records, evidence, options);
  }

  if (sliceId === "au03-long-session-compression") {
    return longSessionCompressionBehavior(records, evidence, options);
  }

  if (sliceId === "au03-context-source-ui") {
    return contextSourceUiBehavior(records, evidence, options);
  }

  if (sliceId === "au07-trace-why-entry") {
    return traceWhyEntryBehavior(records, evidence, options);
  }

  if (sliceId === "au07-gate-reason-why") {
    return gateReasonWhyBehavior(records, evidence, options);
  }

  if (sliceId === "au07-persisted-trace-query") {
    return persistedTraceQueryBehavior(records, evidence, options);
  }

  if (sliceId === "au07-partial-replay-ui") {
    return partialReplayUiBehavior(records, evidence, options);
  }

  if (sliceId === "au07-trace-query-scope-negative-matrix") {
    return traceQueryScopeNegativeMatrixBehavior(records, evidence, options);
  }

  const turnIds = evidence.turn_ids ?? [evidence.turn_id];
  const turnRecords = records.filter((record) => turnIds.includes(record.turn_id));

  if (sliceId === "au05-conflict-cross-work-recovery") {
    return conflictCrossWorkRecoveryBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au05-canon-conflict-recovery") {
    return canonConflictRecoveryBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au10-workbench-matrix-layout") {
    return au10WorkbenchMatrixLayoutBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au10-workbench-recovery-taskstate") {
    return au10WorkbenchRecoveryTaskstateBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au10-workbench-recovery-disconnect-timeout") {
    return au10WorkbenchRecoveryDisconnectTimeoutBehavior(records, evidence, options);
  }

  if (sliceId === "au10-workbench-recovery-provider-timeout") {
    return au10WorkbenchRecoveryProviderTimeoutBehavior(records, evidence, options);
  }

  if (sliceId === "au10-workbench-recovery-reconnect") {
    return au10WorkbenchRecoveryReconnectBehavior(records, evidence, options);
  }

  if (sliceId === "au10-workbench-recovery-cancel-waiting") {
    return au10WorkbenchRecoveryCancelWaitingBehavior(records, evidence, options);
  }

  if (sliceId === "au07-behavior-trace-terminal-replay") {
    return au07BehaviorTraceTerminalReplayBehavior(records, evidence, options);
  }

  if (sliceId === "au12-work-profile-overview") {
    return au12WorkProfileOverviewBehavior(records, evidence, options);
  }

  if (sliceId === "au12-work-profile-status-isolation") {
    return au12WorkProfileStatusIsolationBehavior(records, evidence, options);
  }

  if (sliceId === "au12-profile-read-failure-degrade") {
    return au12ProfileReadFailureDegradeBehavior(records, evidence, options);
  }

  if (sliceId === "au12-correction-intent-roundtrip") {
    return au12CorrectionIntentRoundtripBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au01-garbage-json-recovery") {
    return garbageJsonRecoveryBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au01-frame-validation-friendly-error") {
    return frameValidationFriendlyErrorBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au01-turnresult-recorder-ui-consistency") {
    return turnresultRecorderUiConsistencyBehavior(
      turnIds,
      turnRecords,
      records,
      evidence,
      options,
    );
  }

  if (sliceId === "au02-natural-exploration-no-slot-form") {
    return naturalExplorationNoSlotFormBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au02-candidate-fallback-ui") {
    return candidateFallbackUiBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au04-stale-confirmation-ui") {
    return au04StaleConfirmationUiBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au06-single-active-confirmation") {
    return au06SingleActiveConfirmationBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au04-confirmation-tool-failure-recovery") {
    return au04ConfirmationToolFailureRecoveryBehavior(
      turnIds,
      turnRecords,
      records,
      evidence,
      options,
    );
  }

  if (sliceId === "au04-confirmation-ttl-ui") {
    return au04ConfirmationTtlUiBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au04-disabled-confirmation-action-ui") {
    return au04DisabledConfirmationActionUiBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au04-history-confirmation-readonly") {
    return au04HistoryConfirmationReadonlyBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au04-cross-work-confirmation-guard") {
    return au04CrossWorkConfirmationGuardBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au04-latest-context-rebase-confirmation") {
    return au04LatestContextRebaseConfirmationBehavior(
      turnIds,
      turnRecords,
      records,
      evidence,
      options,
    );
  }

  if (sliceId === "e2e-01-channel-action-security") {
    return e2e01ChannelActionSecurityBehavior(records, evidence, options);
  }

  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;

  if (sliceId === "au02-candidate-adoption-bridge") {
    return candidateAdoptionBridgeBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au05-adoption-safety-freshness") {
    return adoptionSafetyFreshnessBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au05-stale-conflict-cross-work-freshness") {
    return staleConflictCrossWorkBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "p1-chapter-plan-minimum") {
    return p1ChapterPlanMinimumBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-chapter-draft-generation") {
    return p1ChapterDraftGenerationBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-word-count-audit") {
    return p1WordCountAuditBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-chapter-adoption-reading") {
    return p1ChapterAdoptionReadingBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au07-state-trace-adoption-replay") {
    return au07StateTraceAdoptionReplayBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au05-discard-author-action") {
    return au05DiscardAuthorActionBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-chapter-word-count-target") {
    return p1ChapterWordCountTargetBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au04-confirm-before-execute") {
    return au04ConfirmBeforeExecuteBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au04-confirm-idempotency-ui") {
    return au04ConfirmIdempotencyUiBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-export-minimum") {
    return p1ExportMinimumBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au08-reading-readonly-no-write") {
    return au08ReadingReadonlyNoWriteBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au08-reading-return-context") {
    return au08ReadingReturnContextBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-plan-incremental") {
    return p1PlanIncrementalBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-chapter-edit-then-accept") {
    return p1ChapterEditThenAcceptBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-chapter-overwrite-confirm") {
    return p1ChapterOverwriteConfirmBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-chapter-expansion") {
    return p1ChapterExpansionBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-chapter-expansion-multichapter") {
    return p1ChapterExpansionMultichapterBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-memory-create-recall") {
    return au09MemoryCreateRecallBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-memory-management-entry") {
    return au09MemoryManagementEntryBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-memory-management-filter-matrix") {
    return au09MemoryManagementFilterMatrixBehavior(records, evidence);
  }

  if (sliceId === "au09-memory-trace-roundtrip") {
    return au09MemoryTraceRoundtripBehavior(turnIds, turnRecords, records, evidence);
  }

  if (sliceId === "au09-adopt-setting-recall") {
    return au09AdoptSettingRecallBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-character-dossier-roundtrip") {
    return au09CharacterDossierRoundtripBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-character-role-taxonomy-protagonist-policy") {
    return au09CharacterRoleTaxonomyBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-character-candidate-per-item-adoption") {
    return au09CharacterCandidatePerItemAdoptionBehavior(
      turnIds,
      turnRecords,
      records,
      evidence,
      options,
    );
  }

  if (sliceId === "au12-archive-concurrent-model-run-read-snapshot") {
    return au12ArchiveConcurrentModelRunReadSnapshotBehavior(
      turnIds,
      turnRecords,
      records,
      evidence,
      options,
    );
  }

  if (sliceId === "au09-memory-taxonomy-write-policy") {
    return au09MemoryTaxonomyWritePolicyBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-memory-list-ux-redesign") {
    return au09MemoryListUxRedesignBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-validity-window-recall") {
    return au09ValidityWindowRecallBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-cross-work-memory-isolation") {
    return au09CrossWorkMemoryIsolationBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-au03-session-memory-layering") {
    return au09Au03SessionMemoryLayeringBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au11-quality-diagnosis-message-envelope") {
    return au11QualityDiagnosisMessageEnvelopeBehavior(turnIds, turnRecords, records, evidence);
  }

  if (sliceId === "au11-missing-workstate-policy") {
    return au11MissingWorkstatePolicyBehavior(turnIds, turnRecords, records, evidence);
  }

  if (sliceId === "vs00c-cp0-missing-chapter-block") {
    return vs00cMissingChapterBlockBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "vs00c-cp3-structured-context") {
    return vs00cCp3StructuredContextBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-prose-execution-brief") {
    return p1ProseExecutionBriefBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "vs00c-cp4-chapter-plan-structure") {
    return vs00cCp4ChapterPlanStructureBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "vs00c-cp5-reader-effect-brief") {
    return vs00cCp5ReaderEffectBriefBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (!assistantMessagesAreValid(options.provider, turnIds, options.llmRecords ?? [])) {
    return null;
  }

  if (sliceId === "au01-ordinary-chat-two-turn-roundtrip") {
    return ordinaryChatBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au01-empty-message-guard") {
    return emptyMessageGuardBehavior(turnIds, turnRecords, evidence, options);
  }

  if (sliceId === "au02-candidate-continuation") {
    return candidateContinuationBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au02-candidate-multiturn-context") {
    return candidateMultiturnContextBehavior(turnIds, turnRecords, evidence, options);
  }

  if (sliceId === "au02-freeform-followup-after-candidate") {
    return candidateFreeformFollowupBehavior(turnIds, turnRecords, evidence, options);
  }

  if (sliceId === "au02-unadopted-candidate-no-reading-fact") {
    return unadoptedCandidateNoReadingFactBehavior(
      turnIds,
      turnRecords,
      records,
      evidence,
      options,
    );
  }

  if (sliceId === "au05-adoption-boundary") {
    return adoptionBoundaryBehavior(sliceId, turnIds, turnRecords, options);
  }

  if (sliceId === "au05-adoption-followup-routing") {
    return adoptionFollowupRoutingBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au05-discard-boundary") {
    return discardBoundaryBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au05-modify-draft-boundary") {
    return modifyDraftBoundaryBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au08-adoption-reading-projection") {
    return readingProjectionBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au10-ordinary-chat-no-micro-plan") {
    return ordinarySingleTurnBehavior(sliceId, turnIds, turnRecords, options);
  }

  if (sliceId === "au10-micro-plan-entry") {
    return microPlanBehavior(sliceId, turnIds, turnRecords, options, "micro_plan_entry");
  }

  if (sliceId === "e2e-01-downgrade-real-page") {
    return e2e01DowngradeRealPageBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "e2e-01-readonly-tool-trace") {
    return e2e01ReadonlyToolTraceBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "e2e-01-replay-report") {
    return e2e01ReadonlyToolTraceBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au07-tooltrace-registry-redacted-io") {
    return au07TooltraceRegistryRedactedIoBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "vs10-observability-spine") {
    return microPlanBehavior(
      sliceId,
      turnIds,
      turnRecords,
      options,
      "observability_spine_with_micro_plan",
    );
  }

  return null;
}

function findVs00cMissingChapterBlockEvidence(records) {
  const sliceId = "vs00c-cp0-missing-chapter-block";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find(
      (record) =>
        record.event === "channel.user_message.start" && String(record.text_len ?? "") !== "0",
    );
    if (!start) continue;

    const coordinate = turnRecords.find(
      (record) =>
        record.event === "turn_execution.writing_coordinate.done" &&
        record.requested_chapter === "第99章" &&
        record.matched_chapter === "" &&
        record.missing_severity === "block",
    );
    if (!coordinate) continue;

    const missing = turnRecords.find(
      (record) =>
        record.event === "turn_execution.missing_policy.done" &&
        record.severity === "block" &&
        String(record.missing ?? "").includes("第99章"),
    );
    if (!missing) continue;

    if (turnRecords.some((record) => record.event === "toolbox.execute.done")) continue;

    const uiState = turnRecords.find(
      (record) =>
        record.event === "slice_verify.ui_state.done" &&
        record.slice_id === sliceId &&
        record.missing_chapter_blocked === true &&
        record.honest_not_found_message === true,
    );
    if (!uiState) continue;

    const hasRequiredEvents = keyEvents.every((event) =>
      turnRecords.some(
        (record) =>
          record.event === event &&
          (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
      ),
    );
    if (!hasRequiredEvents) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      work_id: start.work_id,
      session_id: start.session_id,
      requested_chapter: coordinate.requested_chapter,
      key_events: keyEvents,
    };
  }

  return null;
}

function vs00cMissingChapterBlockBehavior(_turnIds, turnRecords, _records, evidence, _options) {
  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "vs00c-cp0-missing-chapter-block",
  );
  if (!uiState) return null;
  if (uiState.missing_chapter_blocked !== true) return null;
  if (uiState.honest_not_found_message !== true) return null;
  if (uiState.tool_called !== false) return null;
  if (uiState.no_adoption_artifact !== true) return null;
  if (uiState.no_tool_result !== true) return null;
  if (uiState.creative_card_absent !== true) return null;
  if (uiState.no_toolbox_execute_event !== true) return null;

  const missing = turnRecords.find(
    (record) =>
      record.event === "turn_execution.missing_policy.done" &&
      record.severity === "block" &&
      String(record.missing ?? "").includes("第99章"),
  );
  if (!missing) return null;
  if (turnRecords.some((record) => record.event === "toolbox.execute.done")) return null;

  return {
    slice_id: "vs00c-cp0-missing-chapter-block",
    behavior: "missing_chapter_blocks_before_provider_dispatch",
    turn_ids: [evidence.turn_id],
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    requested_chapter: evidence.requested_chapter,
    assertions: [
      "real_workbench_sent_missing_chapter_request",
      "writing_coordinate_recorded_requested_chapter_without_match",
      "missing_policy_blocked_before_tool_dispatch",
      "ui_rendered_honest_chapter_not_found_reply",
      "toolbox_execute_not_called",
      "no_creative_or_adoption_card_rendered",
    ],
  };
}

function findVs00cCp3StructuredContextEvidence(records) {
  const sliceId = "vs00c-cp3-structured-context";
  const keyEvents = keyEventsForSlice(sliceId);
  const targetChapterTitle = "第02章：旧服务器里的残诀";

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.draft_generated === true &&
      record.draft_pending === true &&
      record.draft_card_visible === true &&
      record.requested_second_chapter === true &&
      record.artifact_type === "prose_fragment" &&
      record.chapter_title === targetChapterTitle &&
      record.adopt_event_sent === false &&
      Number(record.draft_body_chars ?? 0) >= 80,
  );
  if (!uiState) return null;

  const draftTurnId = String(uiState.draft_turn_id ?? "");
  if (!draftTurnId) return null;

  const draftRecords = records.filter((record) => record.turn_id === draftTurnId);
  const start = draftRecords.find(
    (record) =>
      record.event === "channel.user_message.start" &&
      record.generate_micro_plan === true &&
      String(uiState.user_message_text ?? "").includes(targetChapterTitle) &&
      String(uiState.user_message_text ?? "").includes("正文草稿"),
  );
  if (!start) return null;

  if (!draftRecords.some((record) => record.event === "context.assemble.done")) return null;

  const structure = draftRecords.find(
    (record) =>
      record.event === "context.structure.done" &&
      record.source_type === "structure" &&
      record.target_chapter === targetChapterTitle &&
      Number(record.chapter_seq ?? 0) === 2 &&
      record.has_plan_summary === true &&
      record.has_previous === true &&
      record.has_next === true,
  );
  if (!structure) return null;

  const generatedByTool = draftRecords.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  if (!generatedByTool) return null;

  if (!draftRecords.some((record) => record.event === "channel.user_message.done")) return null;

  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) >= 10 &&
      Number(record.total_word_count ?? -1) === 0,
  );
  if (!tocRead) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnId,
    turn_ids: [draftTurnId],
    draft_turn_id: draftTurnId,
    artifact_id: uiState.artifact_id,
    artifact_type: uiState.artifact_type,
    chapter_title: uiState.chapter_title,
    chapter_seq: Number(structure.chapter_seq),
    previous_chapter_title: uiState.previous_chapter_title,
    next_chapter_title: uiState.next_chapter_title,
    has_plan_summary: structure.has_plan_summary,
    has_previous: structure.has_previous,
    has_next: structure.has_next,
    draft_body_chars: uiState.draft_body_chars,
    assembly_policy_id: structure.assembly_policy_id,
    chapter_count: tocRead.chapter_count,
    key_events: keyEvents,
  };
}

function findP1ProseExecutionBriefEvidence(records) {
  const sliceId = "p1-prose-execution-brief";
  const keyEvents = keyEventsForSlice(sliceId);
  const targetChapterTitle = "第02章：旧服务器里的残诀";

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.draft_generated === true &&
      record.draft_pending === true &&
      record.execution_brief_built === true &&
      record.execution_brief_degraded === false &&
      typeof record.execution_brief_ref === "string" &&
      record.execution_brief_ref.startsWith("brief:") &&
      record.brief_in_draft_body === false &&
      record.adopt_event_sent === false &&
      record.chapter_title === targetChapterTitle,
  );
  if (!uiState) return null;

  const draftTurnId = String(uiState.turn_id ?? "");
  if (!draftTurnId) return null;

  const draftRecords = records.filter((record) => record.turn_id === draftTurnId);

  const start = draftRecords.find(
    (record) =>
      record.event === "channel.user_message.start" &&
      record.generate_micro_plan === true &&
      String(uiState.user_message_text ?? "").includes(targetChapterTitle) &&
      String(uiState.user_message_text ?? "").includes("正文草稿"),
  );
  if (!start) return null;

  if (!draftRecords.some((record) => record.event === "context.assemble.done")) return null;

  const structure = draftRecords.find(
    (record) =>
      record.event === "context.structure.done" &&
      record.target_chapter === targetChapterTitle &&
      record.has_plan_direction === true,
  );
  if (!structure) return null;

  const briefBuilt = draftRecords.find(
    (record) =>
      record.event === "prose_execution_brief.built.done" &&
      record.degraded === false &&
      typeof record.brief_ref === "string" &&
      record.brief_ref.startsWith("brief:") &&
      Number(record.scene_unit_count ?? 0) >= 1,
  );
  if (!briefBuilt) return null;

  const generatedByTool = draftRecords.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  if (!generatedByTool) return null;

  if (!draftRecords.some((record) => record.event === "channel.user_message.done")) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnId,
    turn_ids: [draftTurnId],
    draft_turn_id: draftTurnId,
    artifact_type: "prose_fragment",
    chapter_title: targetChapterTitle,
    brief_ref: briefBuilt.brief_ref,
    scene_unit_count: Number(briefBuilt.scene_unit_count ?? 0),
    has_plan_direction: structure.has_plan_direction,
    key_events: keyEvents,
  };
}

function vs00cCp3StructuredContextBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan([evidence.draft_turn_id], turnRecords, true)) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "context.assemble.done")) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "context.structure.done")) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "planner.form_micro_plan.done")) {
    return null;
  }
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "toolbox.execute.done")) return null;
  if (hasEventPrefix(turnRecords, "channel.adopt.")) return null;
  if (!lmstudioHasSteps(options, [evidence.draft_turn_id], ["form_frame", "form_micro_plan"])) {
    return null;
  }

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "vs00c-cp3-structured-context" &&
      record.draft_turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;
  if (uiState.adopt_event_sent !== false) return null;

  const structure = turnRecords.find(
    (record) =>
      record.event === "context.structure.done" &&
      record.target_chapter === evidence.chapter_title &&
      Number(record.chapter_seq ?? 0) === 2 &&
      record.has_plan_summary === true &&
      record.has_previous === true &&
      record.has_next === true,
  );
  if (!structure) return null;

  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) >= 10 &&
      Number(record.total_word_count ?? -1) === 0,
  );
  if (!tocRead) return null;

  return {
    slice_id: "vs00c-cp3-structured-context",
    behavior: "structured_chapter_plan_context_reaches_prose_writing",
    turn_ids: turnIds,
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    chapter_title: evidence.chapter_title,
    chapter_seq: evidence.chapter_seq,
    draft_body_chars: Number(uiState.draft_body_chars ?? 0),
    assertions: [
      "real_archive_outline_second_chapter_action_clicked",
      "micro_plan_requested_from_real_workbench",
      "structured_chapter_context_emitted_for_target_chapter",
      "target_chapter_plan_summary_available_before_provider_call",
      "previous_and_next_chapter_position_available",
      "prose_writing_generated_pending_draft_without_adoption",
      "adopted_plan_remained_toc_source_before_prose_adoption",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_and_micro_plan_called"
        : "deterministic_provider_form_frame_and_micro_plan_called",
    ],
  };
}

function p1ProseExecutionBriefBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan([evidence.draft_turn_id], turnRecords, true)) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "context.assemble.done")) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "context.structure.done")) return null;
  if (
    !turnsHaveEvent([evidence.draft_turn_id], turnRecords, "prose_execution_brief.built.done")
  ) {
    return null;
  }
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "toolbox.execute.done")) return null;
  if (hasEventPrefix(turnRecords, "channel.adopt.")) return null;
  if (!lmstudioHasSteps(options, [evidence.draft_turn_id], ["form_frame", "form_micro_plan"])) {
    return null;
  }

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "p1-prose-execution-brief" &&
      record.turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;
  if (uiState.adopt_event_sent !== false) return null;
  if (uiState.execution_brief_degraded !== false) return null;
  if (uiState.brief_in_draft_body !== false) return null;

  const briefBuilt = turnRecords.find(
    (record) =>
      record.event === "prose_execution_brief.built.done" &&
      record.degraded === false &&
      typeof record.brief_ref === "string" &&
      record.brief_ref.startsWith("brief:"),
  );
  if (!briefBuilt) return null;

  const structure = turnRecords.find(
    (record) =>
      record.event === "context.structure.done" &&
      record.target_chapter === evidence.chapter_title &&
      record.has_plan_direction === true,
  );
  if (!structure) return null;

  return {
    slice_id: "p1-prose-execution-brief",
    behavior: "chapter_direction_projected_into_scene_execution_brief_for_prose_writing",
    turn_ids: turnIds,
    artifact_type: evidence.artifact_type,
    chapter_title: evidence.chapter_title,
    brief_ref: briefBuilt.brief_ref,
    scene_unit_count: Number(briefBuilt.scene_unit_count ?? 0),
    assertions: [
      "real_archive_outline_chapter_2_draft_action_clicked",
      "micro_plan_requested_from_real_workbench",
      "structured_chapter_direction_read_has_plan_direction",
      "scene_execution_brief_built_non_degraded_with_stable_ref",
      "execution_brief_entered_prose_request_and_trace",
      "execution_brief_not_written_as_production_fact",
      "prose_writing_generated_pending_draft_without_adoption",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_and_micro_plan_called"
        : "deterministic_provider_form_frame_and_micro_plan_called",
    ],
  };
}

function findAu05ActionEvidence(records, sliceId, actionDoneEvent) {
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== true) continue;

    const hasAllEvents = keyEvents.every((event) =>
      turnRecords.some(
        (record) =>
          record.event === event &&
          (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
      ),
    );
    if (!hasAllEvents) continue;

    const actionDone = turnRecords.find((record) => record.event === actionDoneEvent);
    if (!actionDone) continue;

    if (sliceId === "au05-adoption-boundary") {
      if (!actionDone.persisted || !actionDone.mutation_id) continue;

      const decision = turnRecords.find((record) => record.event === "adoption.evaluate.done");
      if (decision?.decision_type !== "adopt_tentative") continue;
    }

    if (sliceId === "au05-discard-boundary" && actionDone.action_status !== "discarded") {
      continue;
    }

    if (sliceId === "au05-modify-draft-boundary") {
      if (actionDone.action_status !== "accepted") continue;
      const decision = turnRecords.find((record) => record.event === "adoption.evaluate.done");
      if (decision?.decision_type !== "adopt_tentative") continue;
    }

    return {
      slice_id: sliceId,
      turn_id: turnId,
      key_events: keyEvents,
      ...(actionDone.mutation_id ? { mutation_id: actionDone.mutation_id } : {}),
    };
  }

  return null;
}

function findSu03AssistantDisplayNameEvidence(records) {
  const sliceId = "su03-assistant-display-name";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const initialWorkId = String(uiState.initial_work_id ?? "");
    const createdWorkId = String(uiState.created_work_id ?? "");
    if (!initialWorkId || !createdWorkId || initialWorkId === createdWorkId) continue;

    const joinedInitial = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === initialWorkId,
    );
    const joinedCreated = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === createdWorkId,
    );
    if (!joinedInitial || !joinedCreated) continue;

    if (uiState.context_work_id !== initialWorkId) continue;
    if (uiState.assistant_name_after_save !== "创作助手") continue;
    if (uiState.assistant_role_after_save !== "创作助手") continue;
    if (uiState.assistant_label_after_turn !== "创作助手") continue;
    if (uiState.assistant_name_in_created_work !== "AI") continue;
    if (uiState.assistant_name_after_return !== "创作助手") continue;
    if (uiState.assistant_role_after_return !== "创作助手") continue;
    if (uiState.socket_connected !== true) continue;
    if (uiState.sent_payload_includes_display_name !== false) continue;
    if (uiState.turn_result_contract_has_assistant_message !== true) continue;
    if (uiState.turn_result_has_display_name_key !== false) continue;

    const turnId = String(uiState.turn_id ?? "");
    if (!turnId) continue;

    const turnRecords = records.filter((record) => record.turn_id === turnId);
    if (!turnRecords.some((record) => record.event === "channel.user_message.start")) continue;
    if (!turnRecords.some((record) => record.event === "channel.user_message.done")) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      turn_ids: [turnId],
      work_id: initialWorkId,
      created_work_id: createdWorkId,
      assistant_name_after_save: uiState.assistant_name_after_save,
      assistant_name_in_created_work: uiState.assistant_name_in_created_work,
      assistant_name_after_return: uiState.assistant_name_after_return,
      sent_payload_includes_display_name: uiState.sent_payload_includes_display_name,
      turn_result_contract_has_assistant_message:
        uiState.turn_result_contract_has_assistant_message,
      turn_result_has_display_name_key: uiState.turn_result_has_display_name_key,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu01ProviderHealthEvidence(records) {
  const sliceId = "su01-provider-health-model";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
    );
    if (!joined) continue;
    if (uiState.socket_connected !== true) continue;
    if (uiState.llm_connected !== true) continue;

    const statusText = String(uiState.llm_status_text ?? "");
    const modelLabel = String(uiState.llm_model_label ?? "");
    if (!statusText.includes("LLM: 已连接")) continue;
    if (!modelLabel || !statusText.includes(modelLabel)) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      llm_status_text: statusText,
      llm_model_label: modelLabel,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu01LmstudioDisconnectedHealthEvidence(records) {
  const sliceId = "su01-lmstudio-disconnected-health";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
    );
    if (!joined) continue;
    if (uiState.socket_connected !== true) continue;
    if (uiState.llm_connected !== false) continue;
    if (uiState.provider !== "lmstudio") continue;
    if (uiState.disconnected_visible !== true) continue;
    if (uiState.disconnected_reason_visible !== true) continue;
    if (!String(uiState.message ?? "").includes("LM Studio 未启动")) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      provider: uiState.provider,
      model: uiState.model,
      message: uiState.message,
      detail: uiState.detail,
      model_button_text: uiState.model_button_text,
      model_button_title: uiState.model_button_title,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu01ProviderEndpointValidationEvidence(records) {
  const sliceId = "su01-provider-endpoint-validation";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
    );
    if (!joined) continue;
    if (uiState.socket_connected !== true) continue;
    if (uiState.provider_selected !== "lmstudio") continue;
    if (uiState.invalid_endpoint !== "localhost:1234/v1") continue;
    if (uiState.endpoint_invalid_visible !== true) continue;
    if (uiState.refresh_models_disabled !== true) continue;
    if (uiState.test_connection_disabled !== true) continue;
    if (uiState.save_disabled !== true) continue;
    if (uiState.models_request_after_invalid_count !== 0) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      provider_selected: uiState.provider_selected,
      invalid_endpoint: uiState.invalid_endpoint,
      invalid_endpoint_hint_text: uiState.invalid_endpoint_hint_text,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu01ProviderModelListSuccessEvidence(records) {
  const sliceId = "su01-provider-model-list-success";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
    );
    if (!joined) continue;
    if (uiState.socket_connected !== true) continue;
    if (uiState.deepseek_model_selected !== "deepseek-slice-model-list") continue;
    if (uiState.anthropic_model_selected !== "claude-slice-sonnet") continue;
    if (uiState.lmstudio_model_selected !== "local-slice-model") continue;
    if (uiState.deepseek_models_loaded !== true) continue;
    if (uiState.anthropic_models_loaded !== true) continue;
    if (uiState.lmstudio_models_loaded !== true) continue;
    if (uiState.models_came_from_backend !== true) continue;
    if (uiState.model_inputs_allowed_selection !== true) continue;
    if (uiState.visible_text_omits_api_keys !== true) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      deepseek_model_selected: uiState.deepseek_model_selected,
      anthropic_model_selected: uiState.anthropic_model_selected,
      lmstudio_model_selected: uiState.lmstudio_model_selected,
      lmstudio_fixture_endpoint: uiState.lmstudio_fixture_endpoint,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu01ProviderTestFailureUiEvidence(records) {
  const sliceId = "su01-provider-test-failure-ui";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
    );
    if (!joined) continue;
    if (uiState.socket_connected !== true) continue;
    if (uiState.provider_selected !== "lmstudio") continue;
    if (uiState.model_selected_before_failure !== "local-slice-failure-recovery") continue;
    if (uiState.failing_endpoint !== "http://127.0.0.1:1/v1") continue;
    if (uiState.failure_message_visible !== true) continue;
    if (uiState.failure_reason_visible !== true) continue;
    if (uiState.dialog_stayed_open_after_failure !== true) continue;
    if (uiState.provider_draft_preserved_after_failure !== true) continue;
    if (uiState.endpoint_draft_preserved_after_failure !== true) continue;
    if (uiState.recovery_test_succeeded !== true) continue;
    if (uiState.no_turn_events_created_by_test_connection !== true) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      provider_selected: uiState.provider_selected,
      model_selected_before_failure: uiState.model_selected_before_failure,
      failing_endpoint: uiState.failing_endpoint,
      recovered_endpoint: uiState.recovered_endpoint,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu01ProviderVendorMatrixEvidence(records) {
  const sliceId = "su01-provider-vendor-matrix";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
    );
    if (!joined) continue;
    if (uiState.socket_connected !== true) continue;
    if (uiState.vendor_matrix_listed !== true) continue;
    if (uiState.subscription_hint_visible !== true) continue;
    if (uiState.provider_selected !== "openai") continue;
    if (uiState.test_failure_message_visible !== true) continue;
    if (uiState.dialog_stayed_open_after_failure !== true) continue;
    if (uiState.provider_draft_preserved_after_failure !== true) continue;
    if (uiState.runtime_unchanged_after_failure !== true) continue;
    if (uiState.no_turn_events_created_by_test_connection !== true) continue;
    if (uiState.provider_switch_saved !== true) continue;
    if (uiState.provider_options_api_key_configured !== true) continue;
    if (uiState.auth_methods_distinct !== true) continue;
    if (uiState.provider_options_omits_api_key !== true) continue;
    if (uiState.browser_settings_omits_api_key !== true) continue;
    if (uiState.visible_text_omits_api_key !== true) continue;
    if (uiState.app_log_omits_api_key !== true) continue;
    if (uiState.backend_log_omits_api_key !== true) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      provider_selected: uiState.provider_selected,
      model_selected: uiState.model_selected,
      listed_vendor_ids: uiState.listed_vendor_ids,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu01ApiKeySecretRedactionEvidence(records) {
  const sliceId = "su01-api-key-secret-redaction";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
    );
    if (!joined) continue;
    if (uiState.socket_connected !== true) continue;
    if (uiState.provider_selected !== "deepseek") continue;
    if (uiState.model_selected !== "deepseek-slice-keychain") continue;
    if (uiState.test_connection_succeeded !== true) continue;
    if (uiState.provider_switch_saved !== true) continue;
    if (uiState.provider_options_api_key_configured !== true) continue;
    if (uiState.provider_options_omits_api_key !== true) continue;
    if (uiState.browser_settings_omits_api_key !== true) continue;
    if (uiState.visible_text_omits_api_key !== true) continue;
    if (uiState.app_log_omits_api_key !== true) continue;
    if (uiState.backend_log_omits_api_key !== true) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      provider_selected: uiState.provider_selected,
      model_selected: uiState.model_selected,
      model_provider_button_text: uiState.model_provider_button_text,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu01LocalSecretFileRoundtripEvidence(records) {
  const sliceId = "su01-local-secret-file-roundtrip";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
    );
    if (!joined) continue;
    if (uiState.socket_connected !== true) continue;
    if (uiState.driver !== "macos-cgevent") continue;
    if (uiState.provider_selected !== "deepseek") continue;
    if (uiState.model_selected !== "deepseek-slice-local-file") continue;
    if (uiState.provider_switch_saved !== true) continue;
    if (uiState.webview_reload_performed !== true) continue;
    if (uiState.runtime_reset_before_reload !== true) continue;
    if (uiState.post_reload_provider !== "deepseek") continue;
    if (uiState.post_reload_api_key_configured !== true) continue;
    if (uiState.secret_storage_kind !== "local_file") continue;
    if (uiState.provider_secrets_file_exists !== true) continue;
    if (uiState.provider_secrets_file_mode !== "600") continue;
    if (uiState.provider_secrets_file_contains_expected_key !== true) continue;
    if (uiState.preferences_file_exists !== true) continue;
    if (uiState.preferences_selected_provider !== true) continue;
    if (uiState.preferences_model_saved !== true) continue;
    if (uiState.preferences_omits_api_key !== true) continue;
    if (uiState.provider_options_omits_api_key !== true) continue;
    if (uiState.app_log_omits_api_key !== true) continue;
    if (uiState.backend_log_omits_api_key !== true) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      provider_selected: uiState.provider_selected,
      model_selected: uiState.model_selected,
      driver: uiState.driver,
      secret_storage_kind: uiState.secret_storage_kind,
      provider_secrets_file_mode: uiState.provider_secrets_file_mode,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu01ModelProviderSwitchingEvidence(records) {
  const sliceId = "su01-model-provider-switching";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.provider_switch_saved === true &&
      record.provider_switched_to === "stub" &&
      record.post_switch_message_visible === true &&
      record.dialogue_preserved_after_switch === true &&
      record.turn_id,
  );

  for (const uiState of uiStates) {
    const turnRecords = byTurn.get(uiState.turn_id) ?? [];
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
    );
    if (!joined) continue;
    if (uiState.socket_connected !== true) continue;

    const hasAllEvents = keyEvents.every((event) =>
      event === "channel.join.done" ? true : turnRecords.some((record) => record.event === event),
    );
    if (!hasAllEvents) continue;

    const providerDone = turnRecords.find(
      (record) =>
        record.event === "provider_gateway.complete.done" &&
        record.provider === "stub" &&
        typeof record.model === "string" &&
        record.model.length > 0,
    );
    if (!providerDone) continue;

    return {
      slice_id: sliceId,
      turn_id: uiState.turn_id,
      turn_ids: [uiState.turn_id],
      work_id: uiState.work_id,
      provider_after_switch: providerDone.provider,
      model_after_switch: providerDone.model,
      model_provider_button_text: uiState.model_provider_button_text,
      message_text: uiState.message_text,
      key_events: keyEvents,
    };
  }

  return null;
}

function findAu05FollowupRoutingEvidence(records) {
  const sliceId = "au05-adoption-followup-routing";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== true) continue;

    const hasAllEvents = keyEvents.every((event) =>
      turnRecords.some(
        (record) =>
          record.event === event &&
          (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
      ),
    );
    if (!hasAllEvents) continue;

    const actionDone = turnRecords.find((record) => record.event === "channel.adopt.done");
    if (!actionDone?.persisted || !actionDone.mutation_id) continue;
    if (actionDone.artifact_type !== "character_seed") continue;
    if (actionDone.reading_projection_materialized !== false) continue;

    const uiState = turnRecords.find(
      (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
    );
    if (!uiState) continue;
    if (uiState.artifact_type !== "character_seed") continue;
    if (uiState.adoption_status !== "ACCEPTED") continue;
    if (Number(uiState.decision_card_count ?? 0) < 1) continue;
    if (Number(uiState.open_reading_action_count ?? -1) !== 0) continue;
    if (Number(uiState.pending_adoption_count ?? -1) !== 0) continue;
    if (Number(uiState.reading_chapter_count ?? -1) !== 0) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      key_events: keyEvents,
      mutation_id: actionDone.mutation_id,
      artifact_type: actionDone.artifact_type,
      reading_projection_materialized: actionDone.reading_projection_materialized,
      decision_card_count: uiState.decision_card_count,
      open_reading_action_count: uiState.open_reading_action_count,
      reading_chapter_count: uiState.reading_chapter_count,
    };
  }

  return null;
}

function findAu08ReadingProjectionEvidence(records) {
  const sliceId = "au08-adoption-reading-projection";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== true) continue;

    const hasAllEvents = keyEvents.every((event) =>
      turnRecords.some(
        (record) =>
          record.event === event &&
          (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
      ),
    );
    if (!hasAllEvents) continue;

    const actionDone = turnRecords.find((record) => record.event === "channel.adopt.done");
    if (!actionDone?.persisted || !actionDone.mutation_id) continue;

    const tocDone = turnRecords.find((record) => record.event === "channel.get_toc.done");
    if (!tocDone || Number(tocDone.chapter_count ?? 0) < 1) continue;

    const chapterDone = turnRecords.find(
      (record) => record.event === "channel.get_chapter_content.done",
    );
    if (!chapterDone || Number(chapterDone.content_chars ?? 0) < 1) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      key_events: keyEvents,
      mutation_id: actionDone.mutation_id,
      chapter_count: tocDone.chapter_count,
      content_chars: chapterDone.content_chars,
    };
  }

  return null;
}

function findAu09ArchiveEvidence(records, sliceId = "au09-archive-real-data") {
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const workId = uiState.work_id;
    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === workId,
    );
    if (!joined) continue;

    const characters = records.find(
      (record) => record.event === "channel.get_characters.done" && record.work_id === workId,
    );
    const foreshadowing = records.find(
      (record) => record.event === "channel.get_foreshadowing.done" && record.work_id === workId,
    );
    const rules = records.find(
      (record) => record.event === "channel.get_rules.done" && record.work_id === workId,
    );
    const stats = records.find(
      (record) => record.event === "channel.get_work_stats.done" && record.work_id === workId,
    );

    if (!characters || !foreshadowing || !rules || !stats) continue;
    if (Number(characters.character_count ?? 0) < 1) continue;
    if (Number(foreshadowing.item_count ?? 0) < 1) continue;
    if (Number(rules.rule_count ?? 0) < 1) continue;
    if (Number(stats.volumes ?? 0) < 1) continue;
    if (Number(stats.chapters ?? 0) < 1) continue;
    if (Number(stats.memory_items ?? 0) < 2) continue;
    if (Number(stats.drafts_accepted ?? 0) < 1) continue;

    if (Number(uiState.archive_character_count ?? 0) < 1) continue;
    if (Number(uiState.archive_foreshadowing_count ?? 0) < 1) continue;
    if (Number(uiState.archive_rule_count ?? 0) < 1) continue;
    if (Number(uiState.archive_volumes ?? 0) < 1) continue;
    if (Number(uiState.archive_chapters ?? 0) < 1) continue;
    if (Number(uiState.archive_memory_items ?? 0) < 2) continue;
    if (Number(uiState.archive_drafts_total ?? 0) < 1) continue;
    if (Number(uiState.archive_drafts_accepted ?? 0) < 1) continue;
    if (uiState.archive_detail_kind !== "memory") continue;
    if (String(uiState.archive_detail_id ?? "").length < 1) continue;
    if (String(uiState.archive_detail_title ?? "").length < 1) continue;
    if (sliceId === "au09-archive-stats-current" && uiState.archive_foreign_excluded !== true) {
      continue;
    }

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      key_events: keyEvents,
      archive_character_count: uiState.archive_character_count,
      archive_foreshadowing_count: uiState.archive_foreshadowing_count,
      archive_rule_count: uiState.archive_rule_count,
      archive_volumes: uiState.archive_volumes,
      archive_chapters: uiState.archive_chapters,
      archive_memory_items: uiState.archive_memory_items,
      archive_drafts_total: uiState.archive_drafts_total,
      archive_drafts_accepted: uiState.archive_drafts_accepted,
      archive_detail_kind: uiState.archive_detail_kind,
      archive_detail_title: uiState.archive_detail_title,
      archive_foreign_excluded: uiState.archive_foreign_excluded === true,
    };
  }

  return null;
}

function findAu09MemoryRecallEvidence(records) {
  const sliceId = "au09-memory-recall-context";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== false) continue;
    if (!hasRequiredCorrelationFields(start)) continue;

    const hasAllEvents = keyEvents.every((event) =>
      turnRecords.some(
        (record) =>
          record.event === event &&
          (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
      ),
    );
    if (!hasAllEvents) continue;

    const contextDone = turnRecords.find((record) => record.event === "context.assemble.done");
    if (contextDone?.has_memory !== true) continue;
    if (Number(contextDone.context_refs_count ?? 0) < 1) continue;
    const uiState = turnRecords.find(
      (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
    );
    if (!uiState?.trace_why_dialog_open) continue;
    if (uiState.trace_why_contains_raw_prompt === true) continue;
    const traceText = String(uiState.trace_why_text ?? "");
    if (!traceText.includes("已确认设定")) continue;
    if (!traceText.includes("灵源矿区")) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      turn_ids: [turnId],
      work_id: start.work_id,
      session_id: start.session_id,
      context_refs_count: contextDone.context_refs_count,
      key_events: keyEvents,
    };
  }

  return null;
}

function findAu03SessionHistoryReadonlyEvidence(records) {
  const sliceId = "au03-session-history-readonly";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const workId = uiState.work_id;
    const readonlySessionId = String(uiState.readonly_session_id ?? "");
    if (!readonlySessionId) continue;

    const joined = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === workId,
    );
    const resumed = records.find(
      (record) => record.event === "work_session.resume.done" && record.work_id === workId,
    );
    const shown = records.find(
      (record) =>
        record.event === "work_session.show.done" &&
        record.work_id === workId &&
        record.session_id === readonlySessionId &&
        record.read_only === true,
    );
    if (!joined || !resumed || !shown) continue;
    if (Number(shown.pending_adoption_count ?? -1) !== 0) continue;
    if (Number(shown.transcript_count ?? 0) < 2) continue;
    if (uiState.readonly_banner_visible !== true) continue;
    if (uiState.readonly_input_disabled !== true) continue;
    if (uiState.readonly_send_disabled !== true) continue;
    if (uiState.active_session_restored !== true) continue;
    const visibleText = String(uiState.readonly_visible_text ?? "");
    if (!visibleText.includes("林瑶")) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      session_id: readonlySessionId,
      key_events: keyEvents,
      transcript_count: shown.transcript_count,
      pending_adoption_count: shown.pending_adoption_count,
    };
  }

  return null;
}

function findAu03SessionNewActiveEvidence(records) {
  const sliceId = "au03-session-new-active";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const workId = uiState.work_id;
    const previousSessionId = String(uiState.previous_active_session_id ?? "");
    const newSessionId = String(uiState.new_active_session_id ?? "");
    const turnId = String(uiState.turn_id ?? "");
    if (!previousSessionId || !newSessionId || !turnId) continue;
    if (previousSessionId === newSessionId) continue;

    const previousResume = records.find(
      (record) =>
        record.event === "work_session.resume.done" &&
        record.work_id === workId &&
        record.session_id === previousSessionId,
    );
    if (!previousResume || Number(previousResume.transcript_count ?? 0) < 2) continue;

    const created = records.find(
      (record) =>
        record.event === "work_session.create.done" &&
        record.work_id === workId &&
        record.session_id === newSessionId,
    );
    if (!created) continue;

    const newResume = records.find(
      (record) =>
        record.event === "work_session.resume.done" &&
        record.work_id === workId &&
        record.session_id === newSessionId &&
        Number(record.transcript_count ?? -1) === 0,
    );
    if (!newResume) continue;

    const joinedNew = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === workId &&
        record.session_id === newSessionId,
    );
    if (!joinedNew) continue;

    const shownPrevious = records.find(
      (record) =>
        record.event === "work_session.show.done" &&
        record.work_id === workId &&
        record.session_id === previousSessionId &&
        record.read_only === true,
    );
    if (!shownPrevious || Number(shownPrevious.transcript_count ?? 0) < 2) continue;

    const userStart = records.find(
      (record) =>
        record.event === "channel.user_message.start" &&
        record.work_id === workId &&
        record.session_id === newSessionId &&
        record.turn_id === turnId,
    );
    const contextDone = records.find(
      (record) =>
        record.event === "context.assemble.done" &&
        record.turn_id === turnId &&
        record.has_conversation === false,
    );
    const userDone = records.find(
      (record) =>
        record.event === "channel.user_message.done" &&
        record.work_id === workId &&
        record.session_id === newSessionId &&
        record.turn_id === turnId,
    );
    if (!userStart || !contextDone || !userDone) continue;

    if (uiState.previous_active_status_after_create !== "EXITED") continue;
    if (uiState.new_session_transcript_empty !== true) continue;
    if (uiState.new_session_input_enabled !== true) continue;
    if (uiState.new_session_send_enabled !== true) continue;
    if (uiState.old_active_visible_initial !== true) continue;
    if (uiState.old_active_absent_after_create !== true) continue;
    if (uiState.previous_active_readonly_opened !== true) continue;
    if (uiState.previous_active_readonly_banner_visible !== true) continue;
    if (uiState.previous_active_input_disabled !== true) continue;
    if (uiState.previous_active_send_disabled !== true) continue;
    if (uiState.previous_active_transcript_visible_readonly !== true) continue;
    if (uiState.active_session_restored !== true) continue;
    if (uiState.user_message_session_id !== newSessionId) continue;
    if (uiState.user_message_work_id !== workId) continue;
    if (uiState.new_session_message_visible !== true) continue;
    if (uiState.old_active_text_in_new_session !== false) continue;
    if (uiState.first_turn_context_has_conversation !== false) continue;

    return {
      slice_id: sliceId,
      turn_ids: [turnId],
      work_id: workId,
      session_id: newSessionId,
      previous_session_id: previousSessionId,
      key_events: keyEvents,
      transcript_count: newResume.transcript_count,
      previous_transcript_count: shownPrevious.transcript_count,
      first_turn_context_refs_count: contextDone.context_refs_count,
    };
  }

  return null;
}

function findAu03BranchFromHistoryEvidence(records) {
  const sliceId = "au03-branch-from-history";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const workId = uiState.work_id;
    const sourceSessionRef = String(uiState.branch_source_session_ref ?? "");
    const sourceTurnRef = String(uiState.branch_source_turn_ref ?? "");
    const branchSessionId = String(uiState.branch_active_session_id ?? "");
    if (!sourceSessionRef || !sourceTurnRef || !branchSessionId) continue;
    if (sourceSessionRef === branchSessionId) continue;

    const shown = records.find(
      (record) =>
        record.event === "work_session.show.done" &&
        record.work_id === workId &&
        record.session_id === sourceSessionRef &&
        record.read_only === true,
    );
    if (!shown || Number(shown.transcript_count ?? 0) < 2) continue;

    const created = records.find(
      (record) =>
        record.event === "work_session.create.done" &&
        record.work_id === workId &&
        record.session_id === branchSessionId &&
        record.source_session_ref === sourceSessionRef &&
        record.source_turn_ref === sourceTurnRef,
    );
    if (!created) continue;

    const joinedBranch = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === workId &&
        record.session_id === branchSessionId,
    );
    if (!joinedBranch) continue;

    const branchResume = records.find(
      (record) =>
        record.event === "work_session.resume.done" &&
        record.work_id === workId &&
        record.session_id === branchSessionId &&
        Number(record.transcript_count ?? -1) === 0,
    );
    if (!branchResume) continue;

    if (uiState.readonly_banner_visible !== true) continue;
    if (uiState.branch_readonly_banner_visible !== false) continue;
    if (uiState.branch_session_item_active !== true) continue;
    if (Number(uiState.branch_message_count ?? -1) !== 1) continue;
    const readonlyText = String(uiState.readonly_visible_text ?? "");
    const branchText = String(uiState.branch_visible_text ?? "");
    if (!readonlyText.includes("林瑶")) continue;
    if (branchText.includes("林瑶的失踪可以作为第三章")) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      session_id: branchSessionId,
      source_session_ref: sourceSessionRef,
      source_turn_ref: sourceTurnRef,
      key_events: keyEvents,
    };
  }

  return null;
}

function findAu03ArchiveSessionFilterEvidence(records) {
  const sliceId = "au03-archive-session-filter";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id,
  );

  for (const uiState of uiStates) {
    const workId = uiState.work_id;
    const sessionId = String(uiState.readonly_session_id ?? "");
    if (!sessionId) continue;

    const shownBeforeArchive = records.find(
      (record) =>
        record.event === "work_session.show.done" &&
        record.work_id === workId &&
        record.session_id === sessionId &&
        record.read_only === true,
    );
    if (!shownBeforeArchive || Number(shownBeforeArchive.transcript_count ?? 0) < 2) continue;

    const archived = records.find(
      (record) =>
        record.event === "work_session.archive.done" &&
        record.work_id === workId &&
        record.session_id === sessionId &&
        record.status === "ARCHIVED",
    );
    if (!archived) continue;

    const shownAfterArchive = records.find(
      (record) =>
        record.event === "work_session.show.done" &&
        record.work_id === workId &&
        record.session_id === sessionId &&
        record.read_only === true &&
        records.indexOf(record) > records.indexOf(archived),
    );
    if (!shownAfterArchive || Number(shownAfterArchive.transcript_count ?? 0) < 2) continue;

    if (uiState.archive_button_visible !== true) continue;
    if (uiState.archived_hidden_default !== true) continue;
    if (uiState.archived_search_found !== true) continue;
    if (uiState.archived_banner_visible !== true) continue;
    const archivedText = String(uiState.archived_visible_text ?? "");
    if (!archivedText.includes("林瑶")) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      session_id: sessionId,
      key_events: keyEvents,
      transcript_count: shownAfterArchive.transcript_count,
    };
  }

  return null;
}

function findAu03CurrentWorkContextSsotEvidence(records) {
  const sliceId = "au03-current-work-context-ssot";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== false) continue;
    if (!hasRequiredCorrelationFields(start)) continue;

    const uiState = turnRecords.find(
      (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
    );
    if (!uiState) continue;
    if (uiState.context_work_id !== start.work_id) continue;
    if (uiState.active_session_restored !== true) continue;
    if (uiState.readonly_banner_visible === true) continue;
    if (!String(uiState.readonly_session_id ?? "")) continue;

    const showHistory = records.find(
      (record) =>
        record.event === "work_session.show.done" &&
        record.work_id === start.work_id &&
        record.session_id === uiState.readonly_session_id &&
        record.read_only === true,
    );
    if (!showHistory) continue;

    const contextDone = turnRecords.find((record) => record.event === "context.assemble.done");
    if (!contextDone?.has_snapshot) continue;
    if (!contextDone?.has_conversation) continue;
    if (Number(contextDone.context_refs_count ?? 0) < 2) continue;

    const hasAllEvents = keyEvents.every((event) => {
      if (event === "work_session.resume.done" || event === "channel.join.done") {
        return records.some(
          (record) =>
            record.event === event &&
            record.work_id === start.work_id &&
            record.session_id === start.session_id,
        );
      }

      if (event === "work_session.show.done") return Boolean(showHistory);

      return turnRecords.some(
        (record) =>
          record.event === event &&
          (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
      );
    });
    if (!hasAllEvents) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      turn_ids: [turnId],
      work_id: start.work_id,
      session_id: start.session_id,
      readonly_session_id: uiState.readonly_session_id,
      context_refs_count: contextDone.context_refs_count,
      key_events: keyEvents,
    };
  }

  return null;
}

function findAu03LongSessionCompressionEvidence(records) {
  const sliceId = "au03-long-session-compression";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== false) continue;
    if (!hasRequiredCorrelationFields(start)) continue;

    const uiState = turnRecords.find(
      (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
    );
    if (!uiState) continue;
    if (uiState.context_work_id !== start.work_id) continue;
    if (uiState.active_session_id !== start.session_id) continue;

    const contextDone = turnRecords.find((record) => record.event === "context.assemble.done");
    if (!contextDone?.has_conversation) continue;
    if (contextDone?.has_session_summary !== true) continue;
    if (Number(contextDone.context_refs_count ?? 0) < 1) continue;

    const hasAllEvents = keyEvents.every((event) => {
      if (event === "work_session.resume.done" || event === "channel.join.done") {
        return records.some(
          (record) =>
            record.event === event &&
            record.work_id === start.work_id &&
            record.session_id === start.session_id,
        );
      }

      return turnRecords.some(
        (record) =>
          record.event === event &&
          (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
      );
    });
    if (!hasAllEvents) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      turn_ids: [turnId],
      work_id: start.work_id,
      session_id: start.session_id,
      context_refs_count: contextDone.context_refs_count,
      key_events: keyEvents,
    };
  }

  return null;
}

function findAu03ContextSourceUiEvidence(records) {
  const sliceId = "au03-context-source-ui";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== false) continue;
    if (!hasRequiredCorrelationFields(start)) continue;

    const uiState = turnRecords.find(
      (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
    );
    if (!uiState) continue;
    if (uiState.context_work_id !== start.work_id) continue;
    if (uiState.active_session_id !== start.session_id) continue;
    if (uiState.trace_why_dialog_open !== true) continue;
    if (uiState.trace_why_contains_raw_prompt === true) continue;

    const traceText = String(uiState.trace_why_text ?? "");
    const hasSessionOrRecentDialogueSource =
      traceText.includes("当前会话记录") || traceText.includes("近期对话");
    if (!traceText.includes("参考来源")) continue;
    if (!traceText.includes("当前作品背景")) continue;
    if (!hasSessionOrRecentDialogueSource) continue;
    if (!traceText.includes("已确认设定")) continue;
    if (!traceText.includes("灵源纪元")) continue;
    if (!traceText.includes("灵源矿区")) continue;

    const contextDone = turnRecords.find((record) => record.event === "context.assemble.done");
    if (!contextDone?.has_snapshot) continue;
    if (!contextDone?.has_conversation) continue;
    if (!contextDone?.has_memory) continue;
    if (Number(contextDone.context_refs_count ?? 0) < 3) continue;

    const hasAllEvents = keyEvents.every((event) => {
      if (event === "work_session.resume.done" || event === "channel.join.done") {
        return records.some(
          (record) =>
            record.event === event &&
            record.work_id === start.work_id &&
            record.session_id === start.session_id,
        );
      }

      return turnRecords.some(
        (record) =>
          record.event === event &&
          (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
      );
    });
    if (!hasAllEvents) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      turn_ids: [turnId],
      work_id: start.work_id,
      session_id: start.session_id,
      context_refs_count: contextDone.context_refs_count,
      key_events: keyEvents,
    };
  }

  return null;
}

function findAu07TraceWhyEvidence(records) {
  const sliceId = "au07-trace-why-entry";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== false) continue;
    if (!hasRequiredCorrelationFields(start)) continue;

    const hasAllEvents = keyEvents.every((event) =>
      turnRecords.some(
        (record) =>
          record.event === event &&
          (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
      ),
    );
    if (!hasAllEvents) continue;

    const uiState = turnRecords.find(
      (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
    );
    if (!uiState?.trace_why_dialog_open) continue;
    if (uiState.trace_why_contains_raw_prompt === true) continue;
    const traceText = String(uiState.trace_why_text ?? "");
    if (!traceText.includes("自然回复") && !traceText.includes("探索方向")) continue;
    if (traceText.includes("raw prompt")) continue;
    if (traceText.includes("provider raw")) continue;
    if (traceText.includes("hidden policy")) continue;
    if (traceText.includes("debug")) continue;
    if (traceText.includes("trace_")) continue;
    if (traceText.includes("ctx_")) continue;
    if (!traceText.includes("不会重新调用模型")) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      turn_ids: [turnId],
      work_id: start.work_id,
      session_id: start.session_id,
      key_events: keyEvents,
    };
  }

  return null;
}

function findAu07GateReasonWhyEvidence(records) {
  const sliceId = "au07-gate-reason-why";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.generate_micro_plan === true &&
      record.downgrade_decision_received === true &&
      record.decision_type === "downgrade_to_dialogue" &&
      record.first_blocking_gate === "action_scope" &&
      record.execution_blocked === true &&
      record.tool_called === false &&
      record.production_write_performed === false &&
      record.action_scope_reason_present === true &&
      record.no_toolbox_execute_event === true &&
      record.no_author_action_sent === true &&
      record.no_execution_controls_visible === true &&
      record.downgrade_badge_visible === true &&
      record.generation_badge_absent === true &&
      record.trace_why_dialog_open === true &&
      record.trace_why_contains_raw_prompt === false &&
      record.why_shows_downgrade_decision === true &&
      record.why_shows_action_scope_gate === true &&
      record.why_shows_micro_plan_evaluated === true &&
      record.why_shows_no_provider_replay === true &&
      record.why_hides_internal_gate_code === true &&
      record.replay_provider_called === false,
  );
  if (!uiState?.turn_id) return null;

  const turnRecords = records.filter((record) => record.turn_id === uiState.turn_id);
  if (
    !eventsPresentWithCorrelation(
      turnRecords,
      keyEvents.filter((event) => event !== "slice_verify.ui_state.done"),
    )
  ) {
    return null;
  }

  const start = turnRecords.find((record) => record.event === "channel.user_message.start");
  if (!start || start.generate_micro_plan !== true) return null;

  const decision = turnRecords.find(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      record.decision_type === "downgrade_to_dialogue",
  );
  if (!decision) return null;

  const traceText = String(uiState.trace_why_text ?? "");
  if (!traceText.includes("降级为对话")) return null;
  if (!traceText.includes("当前请求超出本轮可执行范围")) return null;
  if (!traceText.includes("系统先评估了执行计划")) return null;
  if (!traceText.includes("不会重新调用模型")) return null;
  if (
    /raw prompt|provider raw|hidden policy|debug|trace_|ctx_|multi-step plan requires downgrade|downgrade_to_dialogue|action_scope/i.test(
      traceText,
    )
  ) {
    return null;
  }

  return {
    slice_id: sliceId,
    turn_id: uiState.turn_id,
    turn_ids: [uiState.turn_id],
    work_id: start.work_id,
    session_id: start.session_id,
    decision_type: uiState.decision_type,
    first_blocking_gate: uiState.first_blocking_gate,
    key_events: keyEvents,
  };
}

function findAu07PersistedTraceQueryEvidence(records) {
  const sliceId = "au07-persisted-trace-query";

  for (const uiState of records) {
    if (uiState.event !== "slice_verify.ui_state.done" || uiState.slice_id !== sliceId) continue;
    if (uiState.trace_why_dialog_open !== true) continue;
    if (uiState.trace_why_contains_raw_prompt === true) continue;
    if (uiState.persisted_trace_query_status !== 200) continue;
    if (uiState.persisted_trace_query_scoped !== true) continue;
    if (uiState.restored_after_reload !== true) continue;
    if (uiState.replay_report_provider_called === true) continue;
    if (uiState.replay_summary_provider_called === true) continue;
    if (uiState.persisted_replay_detail_visible !== true) continue;
    if (uiState.replay_no_provider_visible !== true) continue;
    if (uiState.production_write_performed === true || uiState.tool_called === true) continue;

    const traceText = String(uiState.trace_why_text ?? "");
    if (!traceText.includes("持久 trace")) continue;
    if (!traceText.includes("不会重新调用模型")) continue;
    if (/raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i.test(traceText)) continue;

    return {
      slice_id: sliceId,
      turn_id: uiState.turn_id,
      turn_ids: uiState.turn_ids ?? [uiState.turn_id],
      work_id: uiState.work_id,
      session_id: uiState.session_id,
      replay_report_result_status: uiState.replay_report_result_status,
      key_events: keyEventsForSlice(sliceId),
    };
  }

  return null;
}

function findAu07PartialReplayUiEvidence(records) {
  const sliceId = "au07-partial-replay-ui";

  for (const uiState of records) {
    if (uiState.event !== "slice_verify.ui_state.done" || uiState.slice_id !== sliceId) continue;
    if (uiState.trace_why_dialog_open !== true) continue;
    if (uiState.trace_why_contains_raw_prompt === true) continue;
    if (uiState.persisted_trace_query_status !== 200) continue;
    if (uiState.persisted_trace_query_scoped !== true) continue;
    if (uiState.restored_after_reload !== true) continue;
    if (uiState.replay_report_provider_called === true) continue;
    if (uiState.replay_summary_provider_called === true) continue;
    if (uiState.replay_report_result_status !== "partial") continue;
    if (!Array.isArray(uiState.replay_report_missing_trace_refs)) continue;
    if (uiState.replay_report_missing_trace_refs.length === 0) continue;
    if (uiState.replay_partial_visible !== true) continue;
    if (uiState.replay_no_provider_visible !== true) continue;
    if (uiState.production_write_performed === true || uiState.tool_called === true) continue;

    const traceText = String(uiState.trace_why_text ?? "");
    if (!traceText.includes("trace 不完整")) continue;
    if (!traceText.includes("不会重新调用模型")) continue;
    if (/raw prompt|provider raw|hidden policy|debug|trace_|ctx_/i.test(traceText)) continue;

    return {
      slice_id: sliceId,
      turn_id: uiState.turn_id,
      turn_ids: uiState.turn_ids ?? [uiState.turn_id],
      work_id: uiState.work_id,
      session_id: uiState.session_id,
      replay_report_result_status: uiState.replay_report_result_status,
      replay_report_missing_trace_refs: uiState.replay_report_missing_trace_refs,
      key_events: keyEventsForSlice(sliceId),
    };
  }

  return null;
}

function findAu07TraceQueryScopeNegativeMatrixEvidence(records) {
  const sliceId = "au07-trace-query-scope-negative-matrix";

  for (const uiState of records) {
    if (uiState.event !== "slice_verify.ui_state.done" || uiState.slice_id !== sliceId) continue;
    if (uiState.valid_replay_status !== 200) continue;
    if (uiState.valid_replay_scoped !== true) continue;
    if (uiState.valid_replay_provider_called === true) continue;
    if (uiState.restored_after_reload !== true) continue;
    if (uiState.cross_work_replay_rejected !== true) continue;
    if (uiState.cross_session_replay_rejected !== true) continue;
    if (uiState.same_work_other_session_replay_rejected !== true) continue;
    if (uiState.missing_turn_replay_rejected !== true) continue;
    if (uiState.negative_errors_hidden_from_ui !== true) continue;
    if (uiState.negative_responses_leaked_trace === true) continue;
    if (uiState.production_write_performed === true || uiState.tool_called === true) continue;

    const matrix = uiState.negative_replay_matrix ?? {};
    const expected = [
      ["foreign_work_with_source_session", "session_not_found"],
      ["source_work_with_foreign_session", "session_not_found"],
      ["source_work_with_same_work_other_session", "trace_not_found"],
      ["source_scope_with_missing_turn", "trace_not_found"],
    ];

    const matrixOk = expected.every(([key, error]) => {
      const item = matrix[key] ?? {};
      return (
        item.status === 404 &&
        item.error === error &&
        item.leaked_trace_summary !== true &&
        item.leaked_replay_report !== true
      );
    });
    if (!matrixOk) continue;

    return {
      slice_id: sliceId,
      turn_id: uiState.turn_id,
      turn_ids: uiState.turn_ids ?? [uiState.turn_id],
      work_id: uiState.work_id,
      session_id: uiState.session_id,
      foreign_work_id: uiState.foreign_work_id,
      foreign_session_id: uiState.foreign_session_id,
      same_work_other_session_id: uiState.same_work_other_session_id,
      negative_replay_matrix: matrix,
      key_events: keyEventsForSlice(sliceId),
    };
  }

  return null;
}

function findAu03cWorkSessionResumeEvidence(records) {
  const sliceId = "au03c-work-session-resume";
  const keyEvents = keyEventsForSlice(sliceId);
  const resumes = records.filter(
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id &&
      record.session_id &&
      typeof record.transcript_count === "number",
  );

  for (const resumed of resumes) {
    if (resumed.transcript_count < 2 || resumed.pending_adoption_count < 1) continue;

    const joins = records.filter(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === resumed.work_id &&
        record.session_id === resumed.session_id,
    );
    if (joins.length < 2) continue;

    const sessionTurnRecords = records.filter(
      (record) =>
        record.work_id === resumed.work_id &&
        record.session_id === resumed.session_id &&
        record.turn_id,
    );
    const start = sessionTurnRecords.find(
      (record) =>
        record.event === "channel.user_message.start" && record.generate_micro_plan === true,
    );
    if (!start) continue;

    const sameTurnRecords = records.filter((record) => record.turn_id === start.turn_id);
    const hasTool = sameTurnRecords.some(
      (record) => record.turn_id === start.turn_id && record.event === "toolbox.execute.done",
    );
    const hasDone = sessionTurnRecords.some(
      (record) => record.turn_id === start.turn_id && record.event === "channel.user_message.done",
    );
    if (!hasTool || !hasDone) continue;

    return {
      slice_id: sliceId,
      turn_id: start.turn_id,
      turn_ids: [start.turn_id],
      work_id: resumed.work_id,
      session_id: resumed.session_id,
      transcript_count: resumed.transcript_count,
      pending_adoption_count: resumed.pending_adoption_count,
      key_events: keyEvents,
    };
  }

  return null;
}

function findStageStartupContextEvidence(records) {
  const sliceId = "stage-startup-context-contract";
  const keyEvents = keyEventsForSlice(sliceId);
  const resumes = records.filter(
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id &&
      record.session_id &&
      Number(record.transcript_count ?? 0) >= 2 &&
      Number(record.pending_adoption_count ?? 0) >= 1,
  );

  for (const resumed of resumes) {
    const joined = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === resumed.work_id &&
        record.session_id === resumed.session_id,
    );
    if (!joined) continue;

    const uiState = records.find(
      (record) =>
        record.event === "slice_verify.ui_state.done" &&
        record.slice_id === sliceId &&
        record.work_id === resumed.work_id &&
        record.session_id === resumed.session_id &&
        record.context_work_id === resumed.work_id &&
        record.active_session_id === resumed.session_id &&
        record.restored_turn_id,
    );
    if (!uiState) continue;

    if (uiState.socket_connected !== true) continue;
    if (Number(uiState.message_count ?? 0) < resumed.transcript_count) continue;
    if (Number(uiState.pending_adoption_count ?? 0) < resumed.pending_adoption_count) continue;
    if (Number(uiState.welcome_message_count ?? 0) !== 0) continue;

    const titleText = String(uiState.title_text ?? uiState.context_work_title ?? "");
    if (titleText.trim() === "" || titleText.includes("未连接") || titleText.includes("加载失败")) {
      continue;
    }

    const serviceStatusText = String(uiState.service_status_text ?? "");
    if (!serviceStatusText.includes("已连接")) continue;

    return {
      slice_id: sliceId,
      turn_id: uiState.restored_turn_id,
      turn_ids: [uiState.restored_turn_id],
      work_id: resumed.work_id,
      session_id: resumed.session_id,
      transcript_count: resumed.transcript_count,
      pending_adoption_count: resumed.pending_adoption_count,
      context_work_title: uiState.context_work_title,
      key_events: keyEvents,
    };
  }

  return null;
}

function findWorkspaceRuntimeStateEvidence(records) {
  const sliceId = "workspace-runtime-state";
  const keyEvents = keyEventsForSlice(sliceId);
  const resumes = records.filter(
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id &&
      record.session_id &&
      Number(record.transcript_count ?? 0) >= 2 &&
      Number(record.pending_adoption_count ?? 0) >= 1,
  );

  for (const resumed of resumes) {
    const joined = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === resumed.work_id &&
        record.session_id === resumed.session_id,
    );
    if (!joined) continue;

    const tocDone = records.find(
      (record) => record.event === "channel.get_toc.done" && record.work_id === resumed.work_id,
    );
    if (!tocDone) continue;

    const uiState = records.find(
      (record) =>
        record.event === "slice_verify.ui_state.done" &&
        record.slice_id === sliceId &&
        record.work_id === resumed.work_id &&
        record.session_id === resumed.session_id &&
        record.context_work_id === resumed.work_id &&
        record.active_session_id === resumed.session_id &&
        record.restored_turn_id,
    );
    if (!uiState) continue;

    if (uiState.socket_connected !== true) continue;
    if (Number(uiState.message_count ?? 0) < resumed.transcript_count) continue;
    if (Number(uiState.welcome_message_count ?? 0) !== 0) continue;
    if (Number(uiState.pending_adoption_count ?? -1) !== 1) continue;
    if (Number(uiState.decision_card_count ?? 0) < 1) continue;

    const workTitle = String(uiState.context_work_title ?? "");
    const readingTitle = String(uiState.title_text ?? "");
    if (!authorFacingTitle(workTitle) || !authorFacingTitle(readingTitle)) continue;

    const serviceStatusText = String(uiState.service_status_text ?? "");
    if (!serviceStatusText.includes("已连接")) continue;
    if (Number(uiState.reading_chapter_count ?? -1) !== 0) continue;
    if (Number(tocDone.chapter_count ?? -1) !== 0) continue;

    return {
      slice_id: sliceId,
      turn_id: uiState.restored_turn_id,
      turn_ids: [uiState.restored_turn_id],
      work_id: resumed.work_id,
      session_id: resumed.session_id,
      transcript_count: resumed.transcript_count,
      pending_adoption_count: uiState.pending_adoption_count,
      decision_card_count: uiState.decision_card_count,
      reading_chapter_count: uiState.reading_chapter_count,
      context_work_title: uiState.context_work_title,
      reading_title: uiState.title_text,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu02WorkSwitchingEvidence(records) {
  const sliceId = "su02-work-switching";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id &&
      record.socket_connected === true,
  );

  for (const uiState of uiStates) {
    const joinedWorks = records
      .filter((record) => record.event === "channel.join.done" && record.work_id)
      .map((record) => record.work_id);
    const distinctJoinedWorks = [...new Set(joinedWorks)];
    if (distinctJoinedWorks.length < 2) continue;

    const previousWorkMessage = records.find(
      (record) =>
        record.event === "channel.user_message.start" &&
        record.work_id &&
        record.work_id !== uiState.work_id,
    );
    if (!previousWorkMessage) continue;

    const resumedCurrent = records.find(
      (record) =>
        record.event === "work_session.resume.done" &&
        record.work_id === uiState.work_id &&
        record.session_id === uiState.session_id,
    );
    if (!resumedCurrent) continue;

    const joinedCurrent = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === uiState.work_id &&
        record.session_id === uiState.session_id,
    );
    if (!joinedCurrent) continue;

    const serviceStatusText = String(uiState.service_status_text ?? "");
    if (!serviceStatusText.includes("已连接")) continue;

    const titleText = String(uiState.title_text ?? uiState.context_work_title ?? "");
    if (!authorFacingTitle(titleText)) continue;

    if (Number(uiState.message_count ?? 0) > 2) continue;

    return {
      slice_id: sliceId,
      turn_id: previousWorkMessage.turn_id,
      turn_ids: [previousWorkMessage.turn_id].filter(Boolean),
      work_id: uiState.work_id,
      previous_work_id: previousWorkMessage.work_id,
      session_id: uiState.session_id,
      joined_work_count: distinctJoinedWorks.length,
      message_count_after_switch: uiState.message_count,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu02ArtifactProjectionTraceIsolationEvidence(records) {
  const sliceId = "su02-artifact-projection-trace-isolation";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.source_work_id &&
      record.target_work_id &&
      record.source_work_id !== record.target_work_id &&
      record.work_id === record.target_work_id &&
      record.context_work_id === record.target_work_id &&
      record.socket_connected === true,
  );

  for (const uiState of uiStates) {
    if (uiState.source_pending_visible_before_switch !== true) continue;
    if (uiState.pending_artifact_visible_in_target !== false) continue;
    if (uiState.target_projection_empty_before_source_adoption !== true) continue;
    if (uiState.pending_restored_in_source !== true) continue;
    if (uiState.artifact_adopted_in_source !== true) continue;
    if (uiState.source_projection_populated_after_adoption !== true) continue;
    if (uiState.target_projection_empty_after_source_adoption !== true) continue;
    if (uiState.target_trace_excludes_source_artifact !== true) continue;
    if (uiState.target_why_excludes_source_artifact !== true) continue;
    if (uiState.source_artifact_visible_in_target_after_trace !== false) continue;
    if (!uiState.artifact_id || uiState.artifact_type !== "prose_fragment") continue;
    if (!uiState.source_trace_ref || !uiState.target_trace_ref) continue;

    const sourceJoin = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.source_work_id,
    );
    const targetJoin = records.find(
      (record) => record.event === "channel.join.done" && record.work_id === uiState.target_work_id,
    );
    if (!sourceJoin || !targetJoin) continue;

    const draftTurnId = String(uiState.draft_turn_id ?? "");
    const targetTraceTurnId = String(uiState.target_trace_turn_id ?? "");
    if (!draftTurnId || !targetTraceTurnId) continue;

    const draftRecords = records.filter((record) => record.turn_id === draftTurnId);
    const sourceStart = draftRecords.find(
      (record) =>
        record.event === "channel.user_message.start" &&
        record.work_id === uiState.source_work_id &&
        record.generate_micro_plan === true,
    );
    if (!sourceStart) continue;

    const generatedByTool = draftRecords.some(
      (record) =>
        record.event === "toolbox.execute.done" &&
        record.work_id === uiState.source_work_id &&
        record.tool_name === "prose_writing" &&
        record.tool_outcome === "succeeded",
    );
    if (!generatedByTool) continue;

    const sourceAdoptDone = records.find(
      (record) =>
        record.event === "channel.author_action.done" &&
        record.work_id === uiState.source_work_id &&
        record.turn_id === draftTurnId &&
        record.action_type === "accept" &&
        record.action_status === "accepted",
    );
    if (!sourceAdoptDone) continue;

    const sourceToc = records.find(
      (record) =>
        record.event === "channel.get_toc.done" &&
        record.work_id === uiState.source_work_id &&
        Number(record.chapter_count ?? 0) >= 1 &&
        Number(record.total_word_count ?? 0) > 0,
    );
    if (!sourceToc) continue;

    const sourceChapterContent = records.find(
      (record) =>
        record.event === "channel.get_chapter_content.done" &&
        record.work_id === uiState.source_work_id &&
        Number(record.content_chars ?? 0) > 0,
    );
    if (!sourceChapterContent) continue;

    const targetEmptyTocReads = records.filter(
      (record) =>
        record.event === "channel.get_toc.done" &&
        record.work_id === uiState.target_work_id &&
        Number(record.chapter_count ?? -1) === 0 &&
        Number(record.total_word_count ?? -1) === 0,
    );
    if (targetEmptyTocReads.length < 2) continue;

    const targetTraceRecords = records.filter((record) => record.turn_id === targetTraceTurnId);
    const targetTraceStart = targetTraceRecords.find(
      (record) =>
        record.event === "channel.user_message.start" &&
        record.work_id === uiState.target_work_id &&
        record.generate_micro_plan === false,
    );
    if (!targetTraceStart) continue;

    const targetTraceDone = targetTraceRecords.find(
      (record) =>
        record.event === "channel.user_message.done" && record.work_id === uiState.target_work_id,
    );
    if (!targetTraceDone) continue;

    return {
      slice_id: sliceId,
      turn_id: draftTurnId,
      turn_ids: [draftTurnId, uiState.adopt_turn_id, targetTraceTurnId].filter(Boolean),
      draft_turn_id: draftTurnId,
      adopt_turn_id: uiState.adopt_turn_id,
      target_trace_turn_id: targetTraceTurnId,
      source_work_id: uiState.source_work_id,
      target_work_id: uiState.target_work_id,
      work_id: uiState.target_work_id,
      artifact_id: uiState.artifact_id,
      artifact_type: uiState.artifact_type,
      chapter_title: uiState.chapter_title,
      source_trace_ref: uiState.source_trace_ref,
      target_trace_ref: uiState.target_trace_ref,
      source_chapter_count: sourceToc.chapter_count,
      source_content_chars: sourceChapterContent.content_chars,
      target_empty_toc_reads: targetEmptyTocReads.length,
      joined_work_count: uiState.joined_work_count,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu02EmptyStartUnnamedWorkEvidence(records) {
  const sliceId = "su02-empty-start-unnamed-work";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id &&
      record.socket_connected === true,
  );

  for (const uiState of uiStates) {
    if (uiState.work_id === "lobby") continue;
    if (uiState.backend_default_seed_skipped !== true) continue;
    if (uiState.seed_script_none !== true) continue;
    if (uiState.initial_join_work_id !== uiState.work_id) continue;
    if (uiState.initial_work_title !== "未命名作品") continue;
    if (Number(uiState.works_after_start_count ?? 0) !== 1) continue;
    if (uiState.sent_frame_work_id !== uiState.work_id) continue;
    if (uiState.turn_done_work_id !== uiState.work_id) continue;
    if (uiState.renamed_work_id !== uiState.work_id) continue;
    if (!String(uiState.renamed_title ?? "").startsWith("SU02空库改名-")) continue;
    if (uiState.message_visible_after_rename !== true) continue;
    if (Number(uiState.duplicate_unnamed_count ?? 0) < 2) continue;
    if (uiState.duplicate_unnamed_labels_visible !== true) continue;
    if (uiState.second_unnamed_work_id === uiState.third_unnamed_work_id) continue;

    const initialJoin = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === uiState.work_id &&
        record.session_id === uiState.session_id,
    );
    if (!initialJoin) continue;

    const initialResume = records.find(
      (record) =>
        record.event === "work_session.resume.done" &&
        record.work_id === uiState.work_id &&
        record.session_id === uiState.session_id,
    );
    if (!initialResume) continue;

    const turnStart = records.find(
      (record) =>
        record.event === "channel.user_message.start" &&
        record.turn_id === uiState.turn_id &&
        record.work_id === uiState.work_id,
    );
    if (!turnStart) continue;

    const turnDone = records.find(
      (record) =>
        record.event === "channel.user_message.done" &&
        record.turn_id === uiState.turn_id &&
        record.work_id === uiState.work_id,
    );
    if (!turnDone) continue;

    const serviceStatusText = String(uiState.service_status_text ?? "");
    if (!serviceStatusText.includes("已连接")) continue;

    const titleText = String(uiState.title_text ?? "");
    if (!titleText.includes("未命名作品")) continue;

    return {
      slice_id: sliceId,
      turn_id: uiState.turn_id,
      turn_ids: [uiState.turn_id].filter(Boolean),
      work_id: uiState.work_id,
      session_id: uiState.session_id,
      renamed_title: uiState.renamed_title,
      duplicate_unnamed_count: uiState.duplicate_unnamed_count,
      duplicate_unnamed_work_ids: uiState.duplicate_unnamed_work_ids,
      second_unnamed_work_id: uiState.second_unnamed_work_id,
      third_unnamed_work_id: uiState.third_unnamed_work_id,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu02PendingResultWorkIsolationEvidence(records) {
  const sliceId = "su02-pending-result-work-isolation";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.source_work_id &&
      record.target_work_id &&
      record.context_work_id === record.source_work_id &&
      record.socket_connected === true,
  );

  for (const uiState of uiStates) {
    if (uiState.work_id !== uiState.source_work_id) continue;
    if (uiState.source_work_id === uiState.target_work_id) continue;
    if (uiState.sent_frame_work_id !== uiState.source_work_id) continue;
    if (uiState.source_turn_completed_work_id !== uiState.source_work_id) continue;
    if (uiState.target_visible_after_source_done !== true) continue;
    if (uiState.target_loading_after_source_done !== false) continue;
    if (uiState.source_user_visible_in_target !== false) continue;
    if (uiState.source_assistant_visible_in_target !== false) continue;
    if (uiState.source_user_visible_after_return !== true) continue;
    if (uiState.source_assistant_visible_after_return !== true) continue;
    if (Number(uiState.source_return_transcript_count ?? 0) < 1) continue;

    const sourceStart = records.find(
      (record) =>
        record.event === "channel.user_message.start" &&
        record.turn_id === uiState.turn_id &&
        record.work_id === uiState.source_work_id,
    );
    if (!sourceStart) continue;

    const sourceDone = records.find(
      (record) =>
        record.event === "channel.user_message.done" &&
        record.turn_id === uiState.turn_id &&
        record.work_id === uiState.source_work_id,
    );
    if (!sourceDone) continue;

    const targetJoin = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === uiState.target_work_id &&
        record.session_id === uiState.target_session_id,
    );
    if (!targetJoin) continue;

    const sourceReturnResume = records.find(
      (record) =>
        record.event === "work_session.resume.done" &&
        record.work_id === uiState.source_work_id &&
        record.session_id === uiState.session_id &&
        Number(record.transcript_count ?? 0) >= 1,
    );
    if (!sourceReturnResume) continue;

    const sourceReturnJoin = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === uiState.source_work_id &&
        record.session_id === uiState.session_id,
    );
    if (!sourceReturnJoin) continue;

    const serviceStatusText = String(uiState.service_status_text ?? "");
    if (!serviceStatusText.includes("已连接")) continue;

    const titleText = String(uiState.title_text ?? "");
    if (!authorFacingTitle(titleText)) continue;

    return {
      slice_id: sliceId,
      turn_id: uiState.turn_id,
      turn_ids: [uiState.turn_id].filter(Boolean),
      work_id: uiState.source_work_id,
      source_work_id: uiState.source_work_id,
      target_work_id: uiState.target_work_id,
      session_id: uiState.session_id,
      source_session_id: uiState.source_session_id,
      target_session_id: uiState.target_session_id,
      source_return_transcript_count: uiState.source_return_transcript_count,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu02WorkLifecycleManagementEvidence(records) {
  const sliceId = "su02-work-lifecycle-management";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id &&
      record.socket_connected === true,
  );

  for (const uiState of uiStates) {
    if (!uiState.created_work_id || !uiState.renamed_work_id || !uiState.discarded_work_id) {
      continue;
    }
    if (uiState.created_work_id !== uiState.renamed_work_id) continue;
    if (uiState.renamed_work_id !== uiState.discarded_work_id) continue;
    if (uiState.discarded_status !== "DISCARDED") continue;
    if (uiState.discarded_hidden_from_default_list !== true) continue;
    if (uiState.delete_confirmation_included_title !== true) continue;
    if (uiState.fallback_is_source_work !== true) continue;
    if (uiState.fallback_work_id !== uiState.source_work_id) continue;
    if (uiState.work_id === uiState.discarded_work_id) continue;

    const joinedWorks = records
      .filter((record) => record.event === "channel.join.done" && record.work_id)
      .map((record) => record.work_id);
    const distinctJoinedWorks = [...new Set(joinedWorks)];
    if (!distinctJoinedWorks.includes(uiState.source_work_id)) continue;
    if (!distinctJoinedWorks.includes(uiState.created_work_id)) continue;
    if (distinctJoinedWorks.length < 2) continue;

    const resumedFallback = records.find(
      (record) =>
        record.event === "work_session.resume.done" &&
        record.work_id === uiState.work_id &&
        record.session_id === uiState.session_id,
    );
    if (!resumedFallback) continue;

    const joinedFallback = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === uiState.work_id &&
        record.session_id === uiState.session_id,
    );
    if (!joinedFallback) continue;

    const serviceStatusText = String(uiState.service_status_text ?? "");
    if (!serviceStatusText.includes("已连接")) continue;

    const titleText = String(uiState.title_text ?? "");
    if (!titleText.includes(String(uiState.source_work_title ?? ""))) continue;
    if (titleText.includes(String(uiState.renamed_title ?? ""))) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      source_work_id: uiState.source_work_id,
      source_work_title: uiState.source_work_title,
      created_work_id: uiState.created_work_id,
      renamed_work_id: uiState.renamed_work_id,
      discarded_work_id: uiState.discarded_work_id,
      session_id: uiState.session_id,
      fallback_work_id: uiState.fallback_work_id,
      discarded_status: uiState.discarded_status,
      visible_work_ids: uiState.visible_work_ids,
      key_events: keyEvents,
    };
  }

  return null;
}

function findSu02WorkRestartRecoveryEvidence(records) {
  const sliceId = "su02-work-restart-recovery";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiStates = records.filter(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.work_id &&
      record.context_work_id === record.work_id &&
      record.socket_connected === true,
  );

  for (const uiState of uiStates) {
    if (!uiState.first_restored_work_id || !uiState.stale_last_opened_work_id) continue;
    if (!uiState.discarded_work_id || !uiState.fallback_work_id) continue;
    if (uiState.discarded_status !== "DISCARDED") continue;
    if (uiState.first_restored_work_id !== uiState.stale_last_opened_work_id) continue;
    if (uiState.work_id !== uiState.fallback_work_id) continue;
    if (uiState.work_id === uiState.stale_last_opened_work_id) continue;
    if (uiState.work_id === "lobby") continue;
    if (uiState.visible_work_ids?.includes?.(uiState.discarded_work_id)) continue;
    if (uiState.restored_existing_work_after_reload !== true) continue;
    if (uiState.ignored_discarded_last_opened_after_reload !== true) continue;
    if (uiState.fallback_is_real_work !== true) continue;
    if (uiState.stale_preference_replaced_after_reload !== true) continue;

    const joinedRestored = records.find(
      (record) =>
        record.event === "channel.join.done" && record.work_id === uiState.first_restored_work_id,
    );
    if (!joinedRestored) continue;

    const joinedFallback = records.find(
      (record) =>
        record.event === "channel.join.done" &&
        record.work_id === uiState.fallback_work_id &&
        record.session_id === uiState.session_id,
    );
    if (!joinedFallback) continue;

    const resumedFallback = records.find(
      (record) =>
        record.event === "work_session.resume.done" &&
        record.work_id === uiState.fallback_work_id &&
        record.session_id === uiState.session_id,
    );
    if (!resumedFallback) continue;

    const serviceStatusText = String(uiState.service_status_text ?? "");
    if (!serviceStatusText.includes("已连接")) continue;

    const titleText = String(uiState.title_text ?? "");
    if (!titleText.includes(String(uiState.fallback_work_title ?? ""))) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: uiState.work_id,
      source_work_id: uiState.source_work_id,
      first_restored_work_id: uiState.first_restored_work_id,
      stale_last_opened_work_id: uiState.stale_last_opened_work_id,
      discarded_work_id: uiState.discarded_work_id,
      fallback_work_id: uiState.fallback_work_id,
      fallback_work_title: uiState.fallback_work_title,
      session_id: uiState.session_id,
      discarded_status: uiState.discarded_status,
      visible_work_ids: uiState.visible_work_ids,
      key_events: keyEvents,
    };
  }

  return null;
}

function findAu10UserMessageEvidence(records, generateMicroPlan, sliceId) {
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== generateMicroPlan) continue;
    if (!hasRequiredCorrelationFields(start)) continue;

    const hasAllEvents = keyEvents.every((event) =>
      turnRecords.some((record) => record.event === event && hasRequiredCorrelationFields(record)),
    );
    if (!hasAllEvents) continue;

    const hasMicroPlanEvent = turnRecords.some((record) =>
      record.event?.startsWith("planner.form_micro_plan."),
    );
    if (!generateMicroPlan && hasMicroPlanEvent) continue;

    return {
      slice_id: sliceId,
      turn_id: turnId,
      key_events: keyEvents,
    };
  }

  return null;
}

function findE2E01DowngradeRealPageEvidence(records) {
  const sliceId = "e2e-01-downgrade-real-page";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.generate_micro_plan === true &&
      record.downgrade_decision_received === true &&
      record.decision_type === "downgrade_to_dialogue" &&
      record.first_blocking_gate === "action_scope" &&
      record.execution_blocked === true &&
      record.tool_called === false &&
      record.production_write_performed === false &&
      record.action_scope_reason_present === true &&
      record.no_toolbox_execute_event === true &&
      record.no_author_action_sent === true &&
      record.no_execution_controls_visible === true &&
      record.downgrade_badge_visible === true &&
      record.generation_badge_absent === true,
  );
  if (!uiState?.turn_id) return null;

  const turnRecords = records.filter((record) => record.turn_id === uiState.turn_id);
  if (
    !eventsPresentWithCorrelation(
      turnRecords,
      keyEvents.filter((event) => event !== "slice_verify.ui_state.done"),
    )
  ) {
    return null;
  }

  const start = turnRecords.find((record) => record.event === "channel.user_message.start");
  if (!start || start.generate_micro_plan !== true) return null;

  const decision = turnRecords.find(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      record.decision_type === "downgrade_to_dialogue",
  );
  if (!decision) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.turn_id,
    turn_ids: [uiState.turn_id],
    decision_type: uiState.decision_type,
    first_blocking_gate: uiState.first_blocking_gate,
    user_message_text: uiState.user_message_text,
    key_events: keyEvents,
  };
}

function findE2E01ReadonlyToolTraceEvidence(records) {
  const sliceId = "e2e-01-readonly-tool-trace";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.decision_type === "allow_tool" &&
      record.tool_name === "character_roster" &&
      record.tool_status === "succeeded" &&
      record.tool_called === true &&
      record.production_write_performed === false &&
      record.artifact_adopted === false &&
      record.execution_blocked === false &&
      record.accepted_character_visible === true &&
      record.tentative_character_absent === true &&
      record.foreign_character_absent === true &&
      record.no_write_statement_visible === true &&
      record.no_state_delta === true &&
      record.no_artifact_refs === true &&
      record.no_author_action_sent === true &&
      record.no_adoption_event === true &&
      record.no_execution_controls_visible === true &&
      record.trace_query_has_tool_trace_ref === true &&
      hasToolTraceRef(record.trace_query_tool_trace_refs),
  );
  if (!uiState?.turn_id) return null;

  const turnRecords = records.filter((record) => record.turn_id === uiState.turn_id);
  if (
    !eventsPresentWithCorrelation(
      turnRecords,
      keyEvents.filter((event) => event !== "slice_verify.ui_state.done"),
    )
  ) {
    return null;
  }

  const start = turnRecords.find((record) => record.event === "channel.user_message.start");
  if (!start || start.generate_micro_plan !== false) return null;

  const decision = turnRecords.find(
    (record) => record.event === "orchestrator.decide.done" && record.decision_type === "allow_tool",
  );
  if (!decision) return null;

  const contextCharacters = turnRecords.find(
    (record) =>
      record.event === "context.characters.done" &&
      record.source_type === "character_dossier" &&
      Number(record.character_count ?? 0) >= 1,
  );
  if (!contextCharacters) return null;

  const toolbox = turnRecords.find(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_roster" &&
      record.tool_outcome === "succeeded",
  );
  if (!toolbox) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.turn_id,
    turn_ids: [uiState.turn_id],
    decision_type: uiState.decision_type,
    tool_name: uiState.tool_name,
    trace_query_tool_trace_refs: uiState.trace_query_tool_trace_refs,
    character_names: uiState.character_names,
    key_events: keyEvents,
	  };
	}

function findE2E01ReplayReportEvidence(records) {
  const sliceId = "e2e-01-replay-report";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.decision_type === "allow_tool" &&
      record.tool_name === "character_roster" &&
      record.tool_status === "succeeded" &&
      record.tool_called === true &&
      record.production_write_performed === false &&
      record.artifact_adopted === false &&
      record.execution_blocked === false &&
      record.trace_query_has_tool_trace_ref === true &&
      hasToolTraceRef(record.trace_query_tool_trace_refs) &&
      record.replay_report_provider_called === false &&
      record.replay_report_result_status === "complete" &&
      record.replay_report_required_question_count === 6 &&
      record.replay_report_all_required_questions_answered === true &&
      record.replay_report_tool_question_answered === true &&
      record.replay_report_adoption_boundary_answered === true &&
      record.replay_report_has_frame_plan_decision_tool_turn_result === true &&
      Array.isArray(record.replay_report_missing_trace_refs) &&
      record.replay_report_missing_trace_refs.length === 0 &&
      Array.isArray(record.replay_report_chain_steps) &&
      ["frame", "plan", "decision", "tool_trace", "turn_result"].every((step) =>
        record.replay_report_chain_steps.includes(step),
      ),
  );
  if (!uiState?.turn_id) return null;

  const turnRecords = records.filter((record) => record.turn_id === uiState.turn_id);
  if (
    !eventsPresentWithCorrelation(
      turnRecords,
      keyEvents.filter((event) => event !== "slice_verify.ui_state.done"),
    )
  ) {
    return null;
  }

  return {
    slice_id: sliceId,
    turn_id: uiState.turn_id,
    turn_ids: [uiState.turn_id],
    decision_type: uiState.decision_type,
    tool_name: uiState.tool_name,
    trace_query_tool_trace_refs: uiState.trace_query_tool_trace_refs,
    replay_report_chain_steps: uiState.replay_report_chain_steps,
    replay_report_question_statuses: uiState.replay_report_question_statuses,
    key_events: keyEvents,
  };
}

function findAu07TooltraceRegistryRedactedIoEvidence(records) {
  const sliceId = "au07-tooltrace-registry-redacted-io";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.decision_type === "allow_tool" &&
      record.tool_name === "character_roster" &&
      record.tool_status === "succeeded" &&
      record.tool_called === true &&
      record.production_write_performed === false &&
      record.artifact_adopted === false &&
      record.execution_blocked === false &&
      record.trace_query_has_tool_trace_ref === true &&
      hasToolTraceRef(record.trace_query_tool_trace_refs) &&
      record.tool_trace_registry_snapshot_complete === true &&
      record.tool_trace_redacted_io_no_raw_payload === true &&
      record.replay_report_tool_trace_carries_registry_snapshot === true &&
      record.au07_tooltrace_registry_snapshot_closed === true &&
      record.au07_tooltrace_redacted_io_closed === true &&
      record.au07_tooltrace_replay_report_chain_closed === true &&
      record.tool_trace_registry_snapshot?.tool_name === "character_roster" &&
      record.tool_trace_registry_snapshot?.tool_version === "1.0.0" &&
      record.tool_trace_registry_snapshot?.status === "active" &&
      record.tool_trace_registry_snapshot?.tool_layer === "memory" &&
      record.tool_trace_contract_refs?.input_contract_ref === "character_roster_query_v1" &&
      record.tool_trace_contract_refs?.output_contract_ref === "character_roster_result_v1" &&
      record.tool_trace_grant_summary?.grants_within_registry === true &&
      Array.isArray(record.tool_trace_grant_summary?.requested_read_scopes) &&
      record.tool_trace_grant_summary.requested_read_scopes.includes("character_list") &&
      Array.isArray(record.tool_trace_grant_summary?.requested_write_scopes) &&
      record.tool_trace_grant_summary.requested_write_scopes.length === 0 &&
      record.tool_trace_request_summary?.payload_stored === false &&
      record.tool_trace_result_summary?.payload_stored === false &&
      record.tool_trace_io_redaction?.input_payload_stored === false &&
      record.tool_trace_io_redaction?.output_payload_stored === false &&
      record.replay_report_provider_called === false &&
      record.replay_report_result_status === "complete" &&
      record.replay_report_tool_question_answered === true,
  );
  if (!uiState?.turn_id) return null;

  const turnRecords = records.filter((record) => record.turn_id === uiState.turn_id);
  if (
    !eventsPresentWithCorrelation(
      turnRecords,
      keyEvents.filter((event) => event !== "slice_verify.ui_state.done"),
    )
  ) {
    return null;
  }

  return {
    slice_id: sliceId,
    turn_id: uiState.turn_id,
    turn_ids: [uiState.turn_id],
    decision_type: uiState.decision_type,
    tool_name: uiState.tool_name,
    trace_query_tool_trace_refs: uiState.trace_query_tool_trace_refs,
    tool_trace_registry_snapshot: uiState.tool_trace_registry_snapshot,
    tool_trace_contract_refs: uiState.tool_trace_contract_refs,
    tool_trace_grant_summary: uiState.tool_trace_grant_summary,
    tool_trace_request_summary: uiState.tool_trace_request_summary,
    tool_trace_result_summary: uiState.tool_trace_result_summary,
    tool_trace_io_redaction: uiState.tool_trace_io_redaction,
    replay_report_chain_steps: uiState.replay_report_chain_steps,
    replay_report_question_statuses: uiState.replay_report_question_statuses,
    key_events: keyEvents,
  };
}

function findE2E01ChannelActionSecurityEvidence(records) {
  const sliceId = "e2e-01-channel-action-security";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.real_page_anchor_visible === true &&
      record.current_turn_advanced === true &&
      record.invented_action_rejected === true &&
      record.stale_action_rejected === true &&
      record.client_source_turn_result_ignored === true &&
      record.forged_stale_source_rejected === true &&
      Number(record.author_action_error_count ?? 0) >= 2 &&
      Number(record.action_result_broadcast_count_after_rejections ?? -1) === 0 &&
      Number(record.author_action_done_count_for_forged_actions ?? -1) === 0 &&
      record.no_action_result_broadcast_after_rejections === true &&
      record.no_author_action_done_for_forged_actions === true &&
      record.product_acceptance_logic_added === false &&
      Array.isArray(record.turn_ids) &&
      record.turn_ids.length === 2,
  );
  if (!uiState?.turn_id) return null;

  const turnIds = uiState.turn_ids;
  const actionIds = [uiState.invented_action_id, uiState.stale_action_id].filter(Boolean);
  if (actionIds.length !== 2) return null;

  const matchingJoins = records.filter(
    (record) =>
      record.event === "channel.join.done" &&
      record.work_id === uiState.work_id &&
      record.session_id === uiState.session_id,
  );
  if (matchingJoins.length < 2) return null;

  const userDoneCount = records.filter(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.work_id === uiState.work_id &&
      record.session_id === uiState.session_id &&
      turnIds.includes(record.turn_id),
  ).length;
  if (userDoneCount < 2) return null;

  const errorRecords = records.filter(
    (record) =>
      record.event === "channel.author_action.error" &&
      record.work_id === uiState.work_id &&
      record.session_id === uiState.session_id &&
      actionIds.includes(record.action_id),
  );
  if (errorRecords.length < 2) return null;
  if (!errorRecords.some((record) => String(record.outcome_detail ?? "").includes("invented"))) {
    return null;
  }
  if (!errorRecords.some((record) => String(record.outcome_detail ?? "").includes("stale"))) {
    return null;
  }

  const doneRecords = records.filter(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.work_id === uiState.work_id &&
      record.session_id === uiState.session_id &&
      actionIds.includes(record.action_id),
  );
  if (doneRecords.length > 0) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.turn_id,
    turn_ids: turnIds,
    work_id: uiState.work_id,
    session_id: uiState.session_id,
    invented_action_id: uiState.invented_action_id,
    stale_action_id: uiState.stale_action_id,
    invented_error_reason: uiState.invented_error_reason,
    stale_error_reason: uiState.stale_error_reason,
    author_action_error_count: Number(uiState.author_action_error_count ?? 0),
    key_events: keyEvents,
  };
}

function findAu10WorkbenchMatrixLayoutEvidence(records) {
  const sliceId = "au10-workbench-matrix-layout";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      Array.isArray(record.matrix_phases) &&
      record.layout_no_horizontal_overflow === true &&
      record.top_bar_single_row === true &&
      record.input_area_visible === true &&
      record.service_status_visible === true &&
      record.provider_status_visible === true &&
      record.task_status_visible === true &&
      record.ordinary_turn_completed === true &&
      record.trace_why_dialog_open === true &&
      record.trace_why_contains_raw_prompt !== true &&
      record.candidate_action_completed === true &&
      record.candidate_selected === true &&
      record.candidate_adopted === true &&
      record.adoption_reading_completed === true &&
      record.word_count_matches_adopted_prose === true,
  );
  if (!uiState) return null;
  if (Number(uiState.viewport_width ?? 0) !== 1280) return null;
  if (Number(uiState.viewport_height ?? 0) !== 800) return null;

  const ordinaryTurnId = String(uiState.ordinary_turn_id ?? "");
  const candidateTurnId = String(uiState.candidate_turn_id ?? "");
  const draftTurnId = String(uiState.draft_turn_id ?? "");
  const adoptionTurnId = String(uiState.adoption_turn_id ?? "");
  const turnIds = [ordinaryTurnId, candidateTurnId, draftTurnId, adoptionTurnId].filter(Boolean);
  if (turnIds.length < 4) return null;

  const ordinaryRecords = records.filter((record) => record.turn_id === ordinaryTurnId);
  const ordinaryStart = ordinaryRecords.find(
    (record) =>
      record.event === "channel.user_message.start" && record.generate_micro_plan === false,
  );
  if (!ordinaryStart) return null;
  if (ordinaryRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }

  const chooseCandidateAction = records.find(
    (record) =>
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === uiState.candidate_ref,
  );
  if (!chooseCandidateAction) return null;

  const acceptActionDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (!acceptActionDone) return null;

  const tocRead = records.find(
    (record) => record.event === "channel.get_toc.done" && Number(record.chapter_count ?? 0) >= 1,
  );
  const chapterRead = records.find(
    (record) =>
      record.event === "channel.get_chapter_content.done" && Number(record.content_chars ?? 0) >= 1,
  );
  if (!tocRead || !chapterRead) return null;

  return {
    slice_id: sliceId,
    turn_id: ordinaryTurnId,
    turn_ids: turnIds,
    ordinary_turn_id: ordinaryTurnId,
    candidate_turn_id: candidateTurnId,
    draft_turn_id: draftTurnId,
    adoption_turn_id: adoptionTurnId,
    artifact_id: uiState.artifact_id,
    candidate_ref: uiState.candidate_ref,
    viewport_width: uiState.viewport_width,
    viewport_height: uiState.viewport_height,
    matrix_phases: uiState.matrix_phases,
    key_events: keyEvents,
  };
}

function findAu10WorkbenchRecoveryTaskstateEvidence(records) {
  const sliceId = "au10-workbench-recovery-taskstate";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      Array.isArray(record.task_state_phases),
  );
  if (!uiState) return null;

  const phases = uiState.task_state_phases;
  for (const phase of ["RUNNING", "CHECKPOINT", "COMPLETED"]) {
    if (!phases.includes(phase)) return null;
  }
  if (!uiState.task_id) return null;
  if (uiState.export_success_visible !== true) return null;
  if (uiState.real_workbench_completed_status_visible !== true) return null;
  if (uiState.adoption_reading_completed !== true) return null;

  const turnIds = [uiState.draft_turn_id, uiState.adoption_turn_id].filter(Boolean);
  if (turnIds.length < 2) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.draft_turn_id,
    turn_ids: turnIds,
    draft_turn_id: uiState.draft_turn_id,
    adoption_turn_id: uiState.adoption_turn_id,
    artifact_id: uiState.artifact_id,
    task_id: uiState.task_id,
    task_type: uiState.task_type,
    task_state_phases: phases,
    task_state_count: Number(uiState.task_state_count ?? phases.length),
    key_events: keyEvents,
  };
}

function findAu10WorkbenchRecoveryDisconnectTimeoutEvidence(records) {
  const sliceId = "au10-workbench-recovery-disconnect-timeout";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.failure_turn_id &&
      record.recovery_turn_id,
  );
  if (!uiState) return null;
  if (uiState.failure_message_visible !== true) return null;
  if (uiState.no_production_write_on_failure !== true) return null;
  if (uiState.no_artifact_adopted_on_failure !== true) return null;
  if (uiState.loading_cleared_after_failure !== true) return null;
  if (uiState.input_enabled_after_failure !== true) return null;
  if (uiState.can_continue_after_failure !== true) return null;
  if (uiState.following_turn_completed !== true) return null;

  const providerFailure = records.find(
    (record) =>
      record.event === "provider_gateway.complete.error" &&
      record.provider === "lmstudio" &&
      record.turn_id === uiState.failure_turn_id,
  );
  const channelFailure = records.find(
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === uiState.failure_turn_id,
  );
  const providerRecovery = records.find(
    (record) =>
      record.event === "provider_gateway.complete.done" &&
      record.provider === "slice_verify" &&
      record.turn_id === uiState.recovery_turn_id,
  );
  const channelRecovery = records.find(
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === uiState.recovery_turn_id,
  );
  if (!providerFailure || !channelFailure || !providerRecovery || !channelRecovery) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.recovery_turn_id,
    turn_ids: [uiState.failure_turn_id, uiState.recovery_turn_id],
    failure_turn_id: uiState.failure_turn_id,
    recovery_turn_id: uiState.recovery_turn_id,
    failing_provider: providerFailure.provider,
    recovery_provider: providerRecovery.provider,
    key_events: keyEvents,
  };
}

function findAu10WorkbenchRecoveryProviderTimeoutEvidence(records) {
  const sliceId = "au10-workbench-recovery-provider-timeout";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.timeout_turn_id &&
      record.recovery_turn_id,
  );
  if (!uiState) return null;
  if (uiState.timeout_message_visible !== true) return null;
  if (uiState.no_production_write_on_timeout !== true) return null;
  if (uiState.no_artifact_adopted_on_timeout !== true) return null;
  if (uiState.loading_cleared_after_timeout !== true) return null;
  if (uiState.input_enabled_after_timeout !== true) return null;
  if (uiState.recovery_turn_completed !== true) return null;
  if (uiState.timeout_prompt_sent !== true) return null;
  if (uiState.recovery_prompt_sent !== true) return null;

  const providerTimeout = records.find(
    (record) =>
      record.event === "provider_gateway.complete.error" &&
      record.provider === "lmstudio" &&
      record.turn_id === uiState.timeout_turn_id &&
      record.reason_code === "timeout",
  );
  const channelTimeout = records.find(
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === uiState.timeout_turn_id,
  );
  const providerRecovery = records.find(
    (record) =>
      record.event === "provider_gateway.complete.done" &&
      record.provider === "slice_verify" &&
      record.turn_id === uiState.recovery_turn_id,
  );
  const channelRecovery = records.find(
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === uiState.recovery_turn_id,
  );
  if (!providerTimeout || !channelTimeout || !providerRecovery || !channelRecovery) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.recovery_turn_id,
    turn_ids: [uiState.timeout_turn_id, uiState.recovery_turn_id],
    timeout_turn_id: uiState.timeout_turn_id,
    recovery_turn_id: uiState.recovery_turn_id,
    timeout_provider: providerTimeout.provider,
    timeout_reason_code: providerTimeout.reason_code,
    recovery_provider: providerRecovery.provider,
    key_events: keyEvents,
  };
}

function findAu10WorkbenchRecoveryReconnectEvidence(records) {
  const sliceId = "au10-workbench-recovery-reconnect";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.turn_id,
  );
  if (!uiState) return null;
  if (uiState.offline_status_visible !== true) return null;
  if (uiState.input_disabled_while_offline !== true) return null;
  if (uiState.loading_cleared_while_offline !== true) return null;
  if (uiState.reconnected_status_visible !== true) return null;
  if (uiState.input_enabled_after_reconnect !== true) return null;
  if (uiState.rejoin_observed !== true) return null;
  if (uiState.following_turn_completed !== true) return null;
  if (uiState.recovery_prompt_sent !== true) return null;
  if (uiState.service_stopped_externally !== true) return null;
  if (uiState.service_restarted_externally !== true) return null;

  const joinRecords = records.filter((record) => record.event === "channel.join.done");
  if (joinRecords.length < 2) return null;
  const channelDone = records.find(
    (record) => record.event === "channel.user_message.done" && record.turn_id === uiState.turn_id,
  );
  if (!channelDone) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.turn_id,
    join_count_after_restore: uiState.join_count_after_restore,
    key_events: keyEvents,
  };
}

function findAu10WorkbenchRecoveryCancelWaitingEvidence(records) {
  const sliceId = "au10-workbench-recovery-cancel-waiting";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.confirmation_turn_id &&
      record.cancel_turn_id &&
      record.following_turn_id,
  );
  if (!uiState) return null;
  if (uiState.confirmation_card_visible !== true) return null;
  if (uiState.cancelled_message_visible !== true) return null;
  if (uiState.confirmation_buttons_cleared !== true) return null;
  if (uiState.active_behavior_closed !== true) return null;
  if (uiState.no_tool_called_before_cancel !== true) return null;
  if (uiState.no_production_write_on_cancel !== true) return null;
  if (uiState.no_artifact_adopted_on_cancel !== true) return null;
  if (uiState.loading_cleared_after_cancel !== true) return null;
  if (uiState.input_enabled_after_cancel !== true) return null;
  if (uiState.following_turn_completed !== true) return null;
  if (uiState.prompt_sent !== true) return null;
  if (uiState.recovery_prompt_sent !== true) return null;

  const promptDone = records.find(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.turn_id === uiState.confirmation_turn_id,
  );
  const actionStart = records.find(
    (record) =>
      record.event === "channel.author_action.start" &&
      record.turn_id === uiState.confirmation_turn_id &&
      record.action_type === "reject_or_cancel_confirmation",
  );
  const actionDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.turn_id === uiState.confirmation_turn_id &&
      record.action_status === "cancelled",
  );
  const followingDone = records.find(
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === uiState.following_turn_id,
  );
  if (!promptDone || !actionStart || !actionDone || !followingDone) {
    return null;
  }

  return {
    slice_id: sliceId,
    turn_id: uiState.following_turn_id,
    turn_ids: [uiState.confirmation_turn_id, uiState.cancel_turn_id, uiState.following_turn_id],
    confirmation_turn_id: uiState.confirmation_turn_id,
    cancel_turn_id: uiState.cancel_turn_id,
    following_turn_id: uiState.following_turn_id,
    action_id: uiState.action_id,
    action_type: uiState.action_type,
    key_events: keyEvents,
  };
}

function findAu07BehaviorTraceTerminalReplayEvidence(records) {
  const sliceId = "au07-behavior-trace-terminal-replay";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.confirmation_turn_id &&
      record.cancel_turn_id &&
      record.following_turn_id,
  );
  if (!uiState) return null;
  if (uiState.confirmation_card_visible !== true) return null;
  if (uiState.cancelled_message_visible !== true) return null;
  if (uiState.confirmation_buttons_cleared !== true) return null;
  if (uiState.active_behavior_closed !== true) return null;
  if (uiState.no_tool_called_before_cancel !== true) return null;
  if (uiState.no_production_write_on_cancel !== true) return null;
  if (uiState.no_artifact_adopted_on_cancel !== true) return null;
  if (uiState.loading_cleared_after_cancel !== true) return null;
  if (uiState.input_enabled_after_cancel !== true) return null;
  if (uiState.following_turn_completed !== true) return null;
  if (uiState.prompt_sent !== true) return null;
  if (uiState.recovery_prompt_sent !== true) return null;
  if (uiState.behavior_trace_refs_count < 1) return null;
  if (String(uiState.behavior_trace_ref ?? "") === "") return null;
  if (uiState.behavior_trace_event_type !== "close") return null;
  if (uiState.behavior_trace_next_status !== "CANCELLED") return null;
  if (uiState.behavior_trace_event_turn_ref !== uiState.cancel_turn_id) return null;
  if (uiState.behavior_trace_resolution_ref !== `behavior_resolution:${uiState.cancel_turn_id}`) {
    return null;
  }
  if (uiState.cancel_trace_ref !== `trace:${uiState.cancel_turn_id}`) return null;

  const promptDone = records.find(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.turn_id === uiState.confirmation_turn_id,
  );
  const actionStart = records.find(
    (record) =>
      record.event === "channel.author_action.start" &&
      record.turn_id === uiState.confirmation_turn_id &&
      record.action_type === "reject_or_cancel_confirmation",
  );
  const actionDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.turn_id === uiState.confirmation_turn_id &&
      record.action_status === "cancelled",
  );
  const followingDone = records.find(
    (record) =>
      record.event === "channel.user_message.done" && record.turn_id === uiState.following_turn_id,
  );
  if (!promptDone || !actionStart || !actionDone || !followingDone) {
    return null;
  }

  return {
    slice_id: sliceId,
    turn_id: uiState.cancel_turn_id,
    turn_ids: [uiState.confirmation_turn_id, uiState.cancel_turn_id, uiState.following_turn_id],
    confirmation_turn_id: uiState.confirmation_turn_id,
    cancel_turn_id: uiState.cancel_turn_id,
    following_turn_id: uiState.following_turn_id,
    action_id: uiState.action_id,
    action_type: uiState.action_type,
    cancel_trace_ref: uiState.cancel_trace_ref,
    behavior_trace_ref: uiState.behavior_trace_ref,
    behavior_trace_event_type: uiState.behavior_trace_event_type,
    behavior_trace_next_status: uiState.behavior_trace_next_status,
    behavior_trace_event_turn_ref: uiState.behavior_trace_event_turn_ref,
    behavior_trace_resolution_ref: uiState.behavior_trace_resolution_ref,
    key_events: keyEvents,
  };
}

function findAu12WorkProfileOverviewEvidence(records) {
  const sliceId = "au12-work-profile-overview";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.profile_fields_visible === true &&
      record.profile_status_visible === true &&
      record.profile_request_sent === true &&
      record.profile_reply_has_title === true &&
      record.profile_reply_omits_id === true &&
      record.profile_reply_omits_work_uuid === true &&
      record.profile_ui_omits_work_uuid === true &&
      record.profile_log_emitted === true &&
      record.profile_log_omits_work_uuid === true &&
      record.readonly_hint_visible === true &&
      record.real_archive_opened === true &&
      record.overview_tab_clicked === true,
  );
  if (!uiState) return null;
  if (!uiState.work_id || !uiState.work_title) return null;

  const profileLog = records.find(
    (record) =>
      record.event === "channel.get_work_profile.done" &&
      record.has_title === true &&
      record.status === uiState.profile_status,
  );
  if (!profileLog) return null;

  return {
    slice_id: sliceId,
    work_id: uiState.work_id,
    work_title: uiState.work_title,
    profile_status: uiState.profile_status,
    profile_revision: uiState.profile_revision,
    key_events: keyEvents,
  };
}

function findAu12WorkProfileStatusIsolationEvidence(records) {
  const sliceId = "au12-work-profile-status-isolation";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.accepted_profile_status === "ACCEPTED" &&
      record.empty_profile_status === "TENTATIVE" &&
      record.accepted_status_visible === true &&
      record.tentative_status_visible === true &&
      Number(record.empty_fields_visible_count ?? 0) >= 4 &&
      record.accepted_profile_fields_visible === true &&
      record.empty_profile_excludes_accepted_fields === true &&
      record.accepted_character_visible_before_switch === true &&
      record.accepted_foreshadowing_visible_before_switch === true &&
      record.accepted_rule_visible_before_switch === true &&
      record.empty_archive_excludes_accepted_character === true &&
      record.empty_archive_excludes_accepted_foreshadowing === true &&
      record.empty_archive_excludes_accepted_rule === true &&
      record.overview_navigation_verified === true &&
      record.outline_navigation_verified === true &&
      record.character_navigation_verified === true &&
      record.foreshadowing_navigation_verified === true &&
      record.rule_navigation_verified === true &&
      record.accepted_profile_reply_omits_id === true &&
      record.empty_profile_reply_omits_id === true &&
      record.profile_replies_omit_work_uuid === true &&
      record.profile_logs_omit_work_uuid === true &&
      record.profile_ui_omits_work_uuid === true &&
      record.readonly_no_write_logs === true &&
      record.readonly_no_author_action_frames === true &&
      record.real_archive_opened === true &&
      record.real_work_switch_performed === true,
  );
  if (!uiState) return null;
  if (!uiState.accepted_work_id || !uiState.empty_work_id) return null;

  const acceptedLog = records.find(
    (record) =>
      record.event === "channel.get_work_profile.done" &&
      record.has_title === true &&
      record.status === "ACCEPTED",
  );
  const tentativeLog = records.find(
    (record) =>
      record.event === "channel.get_work_profile.done" &&
      record.has_title === true &&
      record.status === "TENTATIVE",
  );
  if (!acceptedLog || !tentativeLog) return null;

  return {
    slice_id: sliceId,
    accepted_work_id: uiState.accepted_work_id,
    accepted_work_title: uiState.accepted_work_title,
    empty_work_id: uiState.empty_work_id,
    empty_work_title: uiState.empty_work_title,
    accepted_profile_status: uiState.accepted_profile_status,
    empty_profile_status: uiState.empty_profile_status,
    empty_fields_visible_count: Number(uiState.empty_fields_visible_count ?? 0),
    key_events: keyEvents,
  };
}

function findAu12ProfileReadFailureDegradeEvidence(records) {
  const sliceId = "au12-profile-read-failure-degrade";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.profile_read_failure_visible === true &&
      record.profile_retry_visible === true &&
      record.profile_failure_copy_honest === true &&
      record.profile_failure_rows_hidden === true &&
      record.service_stopped_externally === true &&
      record.offline_status_visible === true &&
      record.service_restarted_externally === true &&
      record.rejoin_observed === true &&
      record.reconnected_status_visible === true &&
      record.retry_clicked === true &&
      record.profile_retry_log_emitted === true &&
      record.profile_retry_recovered_fields === true &&
      record.failure_cleared_after_retry === true &&
      record.readonly_no_write_logs === true &&
      record.readonly_no_author_action_frames === true &&
      record.real_archive_opened === true &&
      record.overview_tab_clicked === true,
  );
  if (!uiState) return null;
  if (!uiState.work_id || !uiState.work_title) return null;

  const rejoin = records.find(
    (record) => record.event === "channel.join.done" && record.work_id === uiState.work_id,
  );
  const retryLog = records.find(
    (record) =>
      record.event === "channel.get_work_profile.done" &&
      record.has_title === true &&
      record.status === "TENTATIVE",
  );
  if (!rejoin || !retryLog) return null;

  return {
    slice_id: sliceId,
    work_id: uiState.work_id,
    work_title: uiState.work_title,
    key_events: keyEvents,
  };
}

function findAu12CorrectionIntentRoundtripEvidence(records) {
  const sliceId = "au12-correction-intent-roundtrip";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.correction_intent_sent_from_profile === true &&
      record.generate_micro_plan === true &&
      record.decision_type === "allow_tool" &&
      record.tool_name === "world_building" &&
      record.tool_status === "succeeded" &&
      record.pending_artifact_type === "world_setting" &&
      record.pending_artifact_requires_adoption === true &&
      record.available_accept_action === true &&
      record.available_edit_action === true &&
      record.available_discard_action === true &&
      record.production_write_performed === false &&
      record.tool_called === true &&
      record.no_author_action_sent === true &&
      record.no_adoption_event_before_author_choice === true &&
      record.pending_card_visible === true &&
      record.real_archive_opened === true &&
      record.overview_tab_clicked === true,
  );
  if (!uiState) return null;
  if (!uiState.turn_id || !uiState.work_id) return null;

  const toolbox = records.find(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === uiState.turn_id &&
      record.tool_name === "world_building" &&
      record.tool_outcome === "succeeded",
  );
  const done = records.find(
    (record) => record.event === "channel.user_message.done" && record.turn_id === uiState.turn_id,
  );
  if (!toolbox || !done) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.turn_id,
    turn_ids: [uiState.turn_id],
    work_id: uiState.work_id,
    work_title: uiState.work_title,
    pending_artifact_type: uiState.pending_artifact_type,
    tool_name: uiState.tool_name,
    decision_type: uiState.decision_type,
    key_events: keyEvents,
  };
}

function findNaturalExplorationNoSlotFormEvidence(records) {
  const sliceId = "au02-natural-exploration-no-slot-form";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.frame_type === "creative_exploration" &&
      record.natural_reply_visible === true &&
      Number(record.candidate_panel_rendered ?? 0) > 0 &&
      record.slot_form_visible === false &&
      record.forbidden_slot_fields_absent === true &&
      record.execution_card_visible === false,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? uiState.turn_id ?? "");
  if (!sourceTurnId) return null;

  const turnRecords = byTurn.get(sourceTurnId) ?? [];
  const start = turnRecords.find((record) => record.event === "channel.user_message.start");
  if (!start || start.generate_micro_plan !== false) return null;
  if (start.candidate_ref || start.candidate_source_turn_ref) return null;
  if (!hasRequiredCorrelationFields(start)) return null;

  const frame = turnRecords.find(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) > 0,
  );
  if (!frame) return null;

  for (const event of [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ]) {
    if (
      !turnRecords.some((record) => record.event === event && hasRequiredCorrelationFields(record))
    ) {
      return null;
    }
  }

  if (turnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }

  if (uiState.durable_clarification_opened !== false) return null;
  if (uiState.tool_result_present !== false) return null;
  if (uiState.adoption_decision_present !== false) return null;
  if (uiState.candidate_selected !== false) return null;
  if (uiState.candidate_adopted !== false) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_action_result_received !== true) return null;
  const lmstudioQualityChecksRequired = uiState.lmstudio_quality_checks_required === true;
  if (lmstudioQualityChecksRequired) {
    if (uiState.natural_reply_chinese !== true) return null;
    if (uiState.natural_reply_no_json_code !== true) return null;
    if (uiState.candidates_no_json_code !== true) return null;
    if (uiState.candidate_semantically_relevant !== true) return null;
  }

  return {
    slice_id: sliceId,
    turn_id: sourceTurnId,
    turn_ids: [sourceTurnId],
    work_id: uiState.work_id,
    source_turn_ref: sourceTurnId,
    frame_type: uiState.frame_type,
    candidate_count: Number(uiState.candidate_count),
    candidate_ref: uiState.candidate_ref,
    candidate_titles: uiState.candidate_titles ?? [],
    candidate_pitches: uiState.candidate_pitches ?? [],
    candidate_set_ref: uiState.candidate_set_ref,
    natural_reply_visible: uiState.natural_reply_visible,
    lmstudio_quality_checks_required: lmstudioQualityChecksRequired,
    natural_reply_chinese: uiState.natural_reply_chinese === true,
    natural_reply_no_json_code: uiState.natural_reply_no_json_code === true,
    candidates_no_json_code: uiState.candidates_no_json_code === true,
    candidate_semantically_relevant: uiState.candidate_semantically_relevant === true,
    candidate_panel_rendered: Number(uiState.candidate_panel_rendered),
    slot_form_visible: uiState.slot_form_visible,
    forbidden_slot_fields_absent: uiState.forbidden_slot_fields_absent,
    execution_card_visible: uiState.execution_card_visible,
    generate_micro_plan: uiState.generate_micro_plan,
    tool_result_present: uiState.tool_result_present,
    adoption_decision_present: uiState.adoption_decision_present,
    candidate_selected: uiState.candidate_selected,
    candidate_adopted: uiState.candidate_adopted,
    production_write_performed: uiState.production_write_performed,
    no_author_action_sent: uiState.no_author_action_sent,
    no_action_result_received: uiState.no_action_result_received,
    key_events: keyEvents,
  };
}

function findCandidateFallbackUiEvidence(records) {
  const sliceId = "au02-candidate-fallback-ui";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.provider_candidate_payload === "malformed_candidates" &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_panel_rendered ?? 0) > 0 &&
      Number(record.turn_result_candidate_count ?? 0) >= 2 &&
      record.fallback_candidate_visible === true &&
      record.has_known_fallback_candidate === true &&
      record.candidate_fields_nonempty === true &&
      record.candidate_statuses_not_adopted === true,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? uiState.turn_id ?? "");
  if (!sourceTurnId) return null;

  const turnRecords = byTurn.get(sourceTurnId) ?? [];
  const start = turnRecords.find((record) => record.event === "channel.user_message.start");
  if (!start || start.generate_micro_plan !== false) return null;
  if (start.candidate_ref || start.candidate_source_turn_ref) return null;
  if (!hasRequiredCorrelationFields(start)) return null;

  const frame = turnRecords.find(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) >= 2,
  );
  if (!frame) return null;

  for (const event of [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ]) {
    if (
      !turnRecords.some((record) => record.event === event && hasRequiredCorrelationFields(record))
    ) {
      return null;
    }
  }

  if (turnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }

  if (uiState.malformed_candidate_prompt_sent !== true) return null;
  if (uiState.tool_result_present !== false) return null;
  if (uiState.adoption_decision_present !== false) return null;
  if (uiState.candidate_selected !== false) return null;
  if (uiState.candidate_adopted !== false) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_action_result_received !== true) return null;

  return {
    slice_id: sliceId,
    turn_id: sourceTurnId,
    turn_ids: [sourceTurnId],
    work_id: uiState.work_id,
    source_turn_ref: sourceTurnId,
    provider_candidate_payload: uiState.provider_candidate_payload,
    frame_type: uiState.frame_type,
    frame_candidate_count: Number(uiState.frame_candidate_count),
    turn_result_candidate_count: Number(uiState.turn_result_candidate_count),
    fallback_candidate_titles: uiState.fallback_candidate_titles,
    fallback_candidate_visible: uiState.fallback_candidate_visible,
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    candidate_panel_rendered: Number(uiState.candidate_panel_rendered),
    candidate_fields_nonempty: uiState.candidate_fields_nonempty,
    candidate_statuses_not_adopted: uiState.candidate_statuses_not_adopted,
    generate_micro_plan: uiState.generate_micro_plan,
    tool_result_present: uiState.tool_result_present,
    adoption_decision_present: uiState.adoption_decision_present,
    candidate_selected: uiState.candidate_selected,
    candidate_adopted: uiState.candidate_adopted,
    production_write_performed: uiState.production_write_performed,
    no_author_action_sent: uiState.no_author_action_sent,
    no_action_result_received: uiState.no_action_result_received,
    key_events: keyEvents,
  };
}

function findCandidateContinuationEvidence(records) {
  const sliceId = "au02-candidate-continuation";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.frame_badge_kind === "exploration" &&
      record.frame_badge_label &&
      Number(record.candidate_panel_count ?? 0) > 0,
  );

  if (!uiState) return null;

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== false) continue;
    if (!start.candidate_ref || !start.candidate_source_turn_ref) continue;
    if (!hasRequiredCorrelationFields(start)) continue;

    const hasAllEvents = keyEvents.every((event) =>
      turnRecords.some((record) => record.event === event && hasRequiredCorrelationFields(record)),
    );
    if (!hasAllEvents) continue;

    if (turnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
      continue;
    }

    return {
      slice_id: sliceId,
      turn_id: turnId,
      turn_ids: [turnId],
      source_turn_ref: start.candidate_source_turn_ref,
      candidate_ref: start.candidate_ref,
      frame_badge_label: uiState.frame_badge_label,
      frame_badge_kind: uiState.frame_badge_kind,
      frame_badge_goal: uiState.frame_badge_goal,
      candidate_panel_count: Number(uiState.candidate_panel_count ?? 0),
      key_events: keyEvents,
    };
  }

  return null;
}

function findCandidateMultiturnContextEvidence(records) {
  const sliceId = "au02-candidate-multiturn-context";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.context_nonce &&
      record.candidate_title_visible === true &&
      record.continuation_candidate_selection_sent === true &&
      record.followup_plain_user_message_sent === true &&
      record.followup_context_has_conversation === true &&
      record.followup_context_has_session_summary === true &&
      record.followup_reply_contains_context_nonce === true &&
      record.followup_message_visible === true &&
      record.followup_reply_visible === true,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const continuationTurnId = String(uiState.continuation_turn_id ?? "");
  const followupTurnId = String(uiState.followup_turn_id ?? uiState.turn_id ?? "");
  if (!sourceTurnId || !continuationTurnId || !followupTurnId) return null;

  const sourceRecords = byTurn.get(sourceTurnId) ?? [];
  const continuationRecords = byTurn.get(continuationTurnId) ?? [];
  const followupRecords = byTurn.get(followupTurnId) ?? [];

  const sourceFrame = sourceRecords.find(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) > 0,
  );
  if (!sourceFrame) return null;

  const continuationStart = continuationRecords.find(
    (record) => record.event === "channel.user_message.start",
  );
  if (
    !continuationStart ||
    continuationStart.generate_micro_plan !== false ||
    continuationStart.candidate_source_turn_ref !== sourceTurnId ||
    continuationStart.candidate_ref !== uiState.candidate_ref
  ) {
    return null;
  }

  const followupStart = followupRecords.find(
    (record) => record.event === "channel.user_message.start",
  );
  if (!followupStart || followupStart.generate_micro_plan !== false) return null;
  if (followupStart.candidate_ref || followupStart.candidate_source_turn_ref) return null;

  const contextDone = followupRecords.find(
    (record) =>
      record.event === "context.assemble.done" &&
      record.has_conversation === true &&
      record.has_session_summary === true,
  );
  if (!contextDone) return null;

  for (const event of keyEvents.filter((item) => item !== "slice_verify.ui_state.done")) {
    if (
      !followupRecords.some(
        (record) => record.event === event && hasRequiredCorrelationFields(record),
      )
    ) {
      return null;
    }
  }

  if (records.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_action_result_received !== true) return null;
  if (uiState.tool_result_present !== false) return null;
  if (uiState.adoption_decision_present !== false) return null;
  if (uiState.candidate_selected !== false) return null;
  if (uiState.candidate_adopted !== false) return null;
  if (uiState.production_write_performed !== false) return null;

  return {
    slice_id: sliceId,
    turn_id: followupTurnId,
    turn_ids: [sourceTurnId, continuationTurnId, followupTurnId],
    source_turn_ref: sourceTurnId,
    continuation_turn_id: continuationTurnId,
    followup_turn_id: followupTurnId,
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    context_nonce: uiState.context_nonce,
    candidate_title_visible: uiState.candidate_title_visible,
    continuation_candidate_selection_sent: uiState.continuation_candidate_selection_sent,
    followup_plain_user_message_sent: uiState.followup_plain_user_message_sent,
    followup_context_has_conversation: uiState.followup_context_has_conversation,
    followup_context_has_session_summary: uiState.followup_context_has_session_summary,
    followup_reply_contains_context_nonce: uiState.followup_reply_contains_context_nonce,
    generate_micro_plan: uiState.generate_micro_plan,
    tool_result_present: uiState.tool_result_present,
    adoption_decision_present: uiState.adoption_decision_present,
    candidate_selected: uiState.candidate_selected,
    candidate_adopted: uiState.candidate_adopted,
    production_write_performed: uiState.production_write_performed,
    no_author_action_sent: uiState.no_author_action_sent,
    no_action_result_received: uiState.no_action_result_received,
    key_events: keyEvents,
  };
}

function findCandidateFreeformFollowupEvidence(records) {
  const sliceId = "au02-freeform-followup-after-candidate";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.frame_badge_kind === "exploration" &&
      record.frame_badge_label === "探索方向" &&
      Number(record.candidate_panel_count_after_source ?? 0) > 0,
  );

  if (!uiState) return null;

  const freeformTurnId = uiState.freeform_turn_id ?? uiState.turn_id;
  if (!freeformTurnId) return null;

  const turnRecords = byTurn.get(freeformTurnId) ?? [];
  const start = turnRecords.find((record) => record.event === "channel.user_message.start");
  if (!start || start.generate_micro_plan !== false) return null;
  if (start.candidate_ref || start.candidate_source_turn_ref) return null;
  if (!hasRequiredCorrelationFields(start)) return null;

  const hasAllEvents = keyEvents.every((event) =>
    turnRecords.some((record) => record.event === event && hasRequiredCorrelationFields(record)),
  );
  if (!hasAllEvents) return null;

  if (turnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }

  if (uiState.input_enabled_after_candidate !== true) return null;
  if (uiState.freeform_user_message_sent !== true) return null;
  if (uiState.candidate_selection_sent !== false) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_action_result_received !== true) return null;
  if (uiState.adoption_decision_present !== false) return null;
  if (uiState.freeform_message_visible !== true) return null;
  if (uiState.freeform_assistant_reply_visible !== true) return null;

  return {
    slice_id: sliceId,
    turn_id: freeformTurnId,
    turn_ids: [freeformTurnId],
    source_turn_ref: uiState.source_turn_ref,
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    frame_badge_label: uiState.frame_badge_label,
    frame_badge_kind: uiState.frame_badge_kind,
    candidate_panel_count_after_source: Number(uiState.candidate_panel_count_after_source),
    input_enabled_after_candidate: uiState.input_enabled_after_candidate,
    candidate_selection_sent: uiState.candidate_selection_sent,
    no_author_action_sent: uiState.no_author_action_sent,
    no_action_result_received: uiState.no_action_result_received,
    candidate_selected: uiState.candidate_selected,
    candidate_adopted: uiState.candidate_adopted,
    production_write_performed: uiState.production_write_performed,
    key_events: keyEvents,
  };
}

function findUnadoptedCandidateNoReadingFactEvidence(records) {
  const sliceId = "au02-unadopted-candidate-no-reading-fact";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.frame_badge_kind === "exploration" &&
      record.frame_badge_label === "探索方向" &&
      record.candidate_panel_rendered_before_reading === true &&
      record.reading_mode_opened === true &&
      record.reading_empty_state_visible === true,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? uiState.turn_id ?? "");
  if (!sourceTurnId) return null;

  const turnRecords = byTurn.get(sourceTurnId) ?? [];
  const start = turnRecords.find((record) => record.event === "channel.user_message.start");
  if (!start || start.generate_micro_plan !== false) return null;
  if (start.candidate_ref || start.candidate_source_turn_ref) return null;
  if (!hasRequiredCorrelationFields(start)) return null;

  for (const event of [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ]) {
    if (
      !turnRecords.some((record) => record.event === event && hasRequiredCorrelationFields(record))
    ) {
      return null;
    }
  }

  if (turnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }

  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? -1) === 0 &&
      Number(record.total_word_count ?? -1) === 0,
  );
  if (!tocRead) return null;

  if (Number(uiState.reading_toc_chapter_count ?? -1) !== 0) return null;
  if (Number(uiState.reading_total_word_count ?? -1) !== 0) return null;
  if (uiState.candidate_title_visible_in_reading !== false) return null;
  if (uiState.candidate_pitch_visible_in_reading !== false) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_action_result_received !== true) return null;
  if (uiState.no_projection_events !== true) return null;
  if (uiState.adoption_decision_present !== false) return null;
  if (uiState.candidate_selected !== false) return null;
  if (uiState.candidate_adopted !== false) return null;
  if (uiState.production_write_performed !== false) return null;

  return {
    slice_id: sliceId,
    turn_id: sourceTurnId,
    turn_ids: [sourceTurnId],
    work_id: uiState.work_id,
    source_turn_ref: sourceTurnId,
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    frame_badge_label: uiState.frame_badge_label,
    frame_badge_kind: uiState.frame_badge_kind,
    reading_mode_opened: uiState.reading_mode_opened,
    reading_empty_state_visible: uiState.reading_empty_state_visible,
    reading_toc_chapter_count: Number(uiState.reading_toc_chapter_count),
    reading_total_word_count: Number(uiState.reading_total_word_count),
    candidate_title_visible_in_reading: uiState.candidate_title_visible_in_reading,
    candidate_pitch_visible_in_reading: uiState.candidate_pitch_visible_in_reading,
    candidate_selected: uiState.candidate_selected,
    candidate_adopted: uiState.candidate_adopted,
    production_write_performed: uiState.production_write_performed,
    no_author_action_sent: uiState.no_author_action_sent,
    no_action_result_received: uiState.no_action_result_received,
    no_projection_events: uiState.no_projection_events,
    key_events: keyEvents,
  };
}

function findCandidateAdoptionBridgeEvidence(records) {
  const sliceId = "au02-candidate-adoption-bridge";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.candidate_adopt_clicked === true &&
      record.visible_adoption_result === true &&
      record.adoption_decision_type === "adopt_tentative" &&
      record.candidate_selected === true &&
      record.candidate_adopted === true &&
      record.production_write_performed === false,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const adoptionTurnId = String(uiState.adoption_turn_id ?? "");
  if (!sourceTurnId || !adoptionTurnId) return null;

  const sourceRecords = records.filter((record) => record.turn_id === sourceTurnId);
  const actionRecords = records.filter(
    (record) =>
      record.turn_id === sourceTurnId &&
      [
        "channel.author_action.start",
        "adoption.evaluate.done",
        "channel.author_action.done",
      ].includes(record.event),
  );

  const sourceStarted = sourceRecords.some(
    (record) => record.event === "channel.user_message.start" && !record.candidate_ref,
  );
  const sourceCompleted = sourceRecords.some(
    (record) => record.event === "channel.user_message.done",
  );
  const actionStarted = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === uiState.candidate_ref,
  );
  const actionDone = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "accepted",
  );
  const adopted = actionRecords.some(
    (record) =>
      record.event === "adoption.evaluate.done" && record.decision_type === "adopt_tentative",
  );

  if (!sourceStarted || !sourceCompleted || !actionStarted) return null;
  if (!actionDone || !adopted) return null;

  return {
    slice_id: sliceId,
    turn_id: adoptionTurnId,
    turn_ids: [sourceTurnId, adoptionTurnId],
    source_turn_ref: sourceTurnId,
    continuation_turn_id: null,
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    key_events: keyEvents,
  };
}

function findAdoptionSafetyFreshnessEvidence(records) {
  const sliceId = "au05-adoption-safety-freshness";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.candidate_adopt_clicked === true &&
      record.visible_confirmation_result === true &&
      record.candidate_risk_hint === "high" &&
      record.adoption_decision_type === "require_confirmation" &&
      record.action_result_status === "needs_confirmation" &&
      record.candidate_selected === true &&
      record.candidate_adopted === false &&
      record.production_write_performed === false,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const confirmationTurnId = String(uiState.confirmation_turn_id ?? "");
  if (!sourceTurnId || !confirmationTurnId) return null;

  const sourceRecords = records.filter((record) => record.turn_id === sourceTurnId);
  const actionRecords = sourceRecords.filter((record) =>
    [
      "channel.author_action.start",
      "adoption.evaluate.done",
      "channel.author_action.done",
    ].includes(record.event),
  );

  const sourceStarted = sourceRecords.some(
    (record) => record.event === "channel.user_message.start" && !record.candidate_ref,
  );
  const sourceCompleted = sourceRecords.some(
    (record) => record.event === "channel.user_message.done",
  );
  const actionStarted = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === uiState.candidate_ref,
  );
  const actionDone = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "needs_confirmation",
  );
  const confirmationRequired = actionRecords.some(
    (record) =>
      record.event === "adoption.evaluate.done" && record.decision_type === "require_confirmation",
  );

  if (!sourceStarted || !sourceCompleted || !actionStarted || !actionDone) return null;
  if (!confirmationRequired) return null;

  return {
    slice_id: sliceId,
    turn_id: confirmationTurnId,
    turn_ids: [sourceTurnId, confirmationTurnId],
    source_turn_ref: sourceTurnId,
    confirmation_turn_id: confirmationTurnId,
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    candidate_risk_hint: uiState.candidate_risk_hint,
    key_events: keyEvents,
  };
}

function findStaleConflictCrossWorkEvidence(records) {
  const sliceId = "au05-stale-conflict-cross-work-freshness";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.restored_stale_candidate_visible === true &&
      record.candidate_adopt_clicked === true &&
      record.visible_rejection_result === true &&
      record.adoption_decision_type === "reject" &&
      record.action_result_status === "rejected" &&
      record.candidate_selected === true &&
      record.candidate_adopted === false &&
      record.production_write_performed === false,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const rejectionTurnId = String(uiState.rejection_turn_id ?? "");
  if (!sourceTurnId || !rejectionTurnId) return null;

  const actionRecords = records.filter((record) => record.turn_id === sourceTurnId);
  const actionStarted = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === uiState.candidate_ref,
  );
  const actionDone = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "rejected",
  );
  const rejected = actionRecords.some(
    (record) => record.event === "adoption.evaluate.done" && record.decision_type === "reject",
  );

  if (!actionStarted || !actionDone || !rejected) return null;

  return {
    slice_id: sliceId,
    turn_id: rejectionTurnId,
    turn_ids: [sourceTurnId, rejectionTurnId],
    source_turn_ref: sourceTurnId,
    rejection_turn_id: rejectionTurnId,
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    key_events: keyEvents,
  };
}

function findConflictCrossWorkRecoveryEvidence(records) {
  const sliceId = "au05-conflict-cross-work-recovery";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.cross_work_candidate_visible === true &&
      record.candidate_adopt_clicked === true &&
      record.visible_failure_result === true &&
      record.adoption_decision_type === "fail_with_recovery" &&
      record.action_result_status === "failed" &&
      record.candidate_selected === true &&
      record.candidate_adopted === false &&
      record.production_write_performed === false,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const failureTurnId = String(uiState.failure_turn_id ?? "");
  if (!sourceTurnId || !failureTurnId) return null;

  const actionRecords = records.filter((record) => record.turn_id === sourceTurnId);
  const actionStarted = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === uiState.candidate_ref,
  );
  const actionDone = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "failed",
  );
  const failedWithRecovery = actionRecords.some(
    (record) =>
      record.event === "adoption.evaluate.done" && record.decision_type === "fail_with_recovery",
  );

  if (!actionStarted || !actionDone || !failedWithRecovery) return null;

  return {
    slice_id: sliceId,
    turn_id: failureTurnId,
    turn_ids: [sourceTurnId, failureTurnId],
    source_turn_ref: sourceTurnId,
    failure_turn_id: failureTurnId,
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    key_events: keyEvents,
  };
}

function findCanonConflictRecoveryEvidence(records) {
  const sliceId = "au05-canon-conflict-recovery";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.canon_conflict_candidate_visible === true &&
      record.candidate_adopt_clicked === true &&
      record.visible_failure_result === true &&
      record.adoption_decision_type === "fail_with_recovery" &&
      record.action_result_status === "failed" &&
      record.candidate_selected === true &&
      record.candidate_adopted === false &&
      record.production_write_performed === false,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const failureTurnId = String(uiState.failure_turn_id ?? "");
  if (!sourceTurnId || !failureTurnId) return null;

  const actionRecords = records.filter((record) => record.turn_id === sourceTurnId);
  const actionStarted = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === uiState.candidate_ref,
  );
  const actionDone = actionRecords.some(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "failed",
  );
  const failedWithRecovery = actionRecords.some(
    (record) =>
      record.event === "adoption.evaluate.done" && record.decision_type === "fail_with_recovery",
  );

  if (!actionStarted || !actionDone || !failedWithRecovery) return null;

  return {
    slice_id: sliceId,
    turn_id: failureTurnId,
    turn_ids: [sourceTurnId, failureTurnId],
    source_turn_ref: sourceTurnId,
    failure_turn_id: failureTurnId,
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    key_events: keyEvents,
  };
}

function findP1ChapterPlanMinimumEvidence(records) {
  const sliceId = "p1-chapter-plan-minimum";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.outline_adopt_clicked === true &&
      record.outline_adopted === true &&
      record.chapter_plan_visible === true &&
      record.first_chapter_visible === true &&
      record.final_chapter_visible === true &&
      // 章数是 AI 生成产物，只要求长篇计划下限（>= 8），不再写死「恰好 12」或上限。
      Number(record.chapter_count ?? 0) >= 8 &&
      record.reading_projection_materialized === false,
  );

  if (!uiState) return null;

  const generationTurnId = String(uiState.generation_turn_id ?? "");
  const adoptionTurnId = String(uiState.adoption_turn_id ?? "");
  if (!generationTurnId || !adoptionTurnId) return null;

  const generationRecords = records.filter((record) => record.turn_id === generationTurnId);
  const generatedByTool = generationRecords.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "plot_outline" &&
      record.tool_outcome === "succeeded",
  );
  const microPlanStarted = generationRecords.some(
    (record) =>
      record.event === "channel.user_message.start" && record.generate_micro_plan === true,
  );
  // 采纳走当前模型 author_action accept（channel adopt handler 已是遗留、前端不用）。
  // 持久化/未物化阅读投影由 uiState 门（reading_projection_materialized===false）保证。
  const adopted = generationRecords.some(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  // 采纳的章节计划物化为可读卷/章结构（get_toc 单一数据源，不再有 get_chapter_plans）。
  const chapterStructureRead = records.some(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) >= 8,
  );

  if (!generatedByTool || !microPlanStarted || !adopted || !chapterStructureRead) return null;

  return {
    slice_id: sliceId,
    turn_id: generationTurnId,
    turn_ids: [generationTurnId],
    generation_turn_id: generationTurnId,
    adoption_turn_id: adoptionTurnId,
    artifact_id: uiState.artifact_id,
    chapter_count: uiState.chapter_count,
    key_events: keyEvents,
  };
}

function findP1ChapterDraftGenerationEvidence(records) {
  const sliceId = "p1-chapter-draft-generation";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.draft_generated === true &&
      record.draft_pending === true &&
      record.draft_card_visible === true &&
      record.artifact_type === "prose_fragment" &&
      record.reading_plan_visible_before_adoption === true &&
      record.unadopted_draft_visible_in_reading === false &&
      record.adopt_event_sent === false &&
      Number(record.draft_body_chars ?? 0) >= 80,
  );

  if (!uiState) return null;

  const draftTurnId = String(uiState.draft_turn_id ?? "");
  if (!draftTurnId) return null;

  const draftRecords = records.filter((record) => record.turn_id === draftTurnId);
  const start = draftRecords.find(
    (record) =>
      record.event === "channel.user_message.start" && record.generate_micro_plan === true,
  );
  if (!start) return null;
  if (!String(uiState.user_message_text ?? "").includes("正文草稿")) return null;

  const contextDone = draftRecords.find((record) => record.event === "context.assemble.done");
  if (!contextDone || Number(contextDone.context_refs_count ?? 0) < 1) return null;

  const generatedByTool = draftRecords.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  if (!generatedByTool) return null;

  const done = draftRecords.find((record) => record.event === "channel.user_message.done");
  if (!done) return null;

  // 采纳的章节计划已成正式目录：阅读 toc 显示计划全章（>=10），但还没有已采纳正文（全书 0 字）。
  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) >= 10 &&
      Number(record.total_word_count ?? -1) === 0,
  );
  if (!tocRead) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnId,
    turn_ids: [draftTurnId],
    draft_turn_id: draftTurnId,
    artifact_id: uiState.artifact_id,
    artifact_type: uiState.artifact_type,
    chapter_title: uiState.chapter_title,
    draft_body_chars: uiState.draft_body_chars,
    chapter_count: tocRead.chapter_count,
    reading_chapter_count: tocRead.chapter_count,
    key_events: keyEvents,
  };
}

function ordinaryChatBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 2) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "dialogue_gateway.handle_input.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.user_message.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  const uiState = ordinaryChatUiState(turnIds, turnRecords);
  if (!uiState) return null;

  return {
    slice_id: "au01-ordinary-chat-two-turn-roundtrip",
    behavior: "ordinary_chat_two_turn_visible_roundtrip",
    turn_ids: turnIds,
    assertions: [
      "two_user_turns_completed",
      "real_workbench_rendered_two_user_and_two_assistant_turns_in_order",
      "thinking_indicator_appeared_then_cleared",
      "micro_plan_not_requested",
      "no_action_candidate_or_adoption_cards_rendered",
      "no_error_events",
      "assistant_messages_not_fallback",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_per_turn"
        : "deterministic_provider_form_frame_called_per_turn",
    ],
  };
}

function naturalExplorationNoSlotFormBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (hasEventPrefix(turnRecords, "channel.author_action.")) return null;
  if (hasEventPrefix(turnRecords, "adoption.evaluate.")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  const frame = turnRecords.find(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) > 0,
  );
  if (!frame) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au02-natural-exploration-no-slot-form" &&
      record.source_turn_id === turnIds[0],
  );
  if (!uiState) return null;

  if (uiState.natural_reply_visible !== true) return null;
  if (Number(uiState.candidate_panel_rendered ?? 0) <= 0) return null;
  if (uiState.slot_form_visible !== false) return null;
  if (uiState.forbidden_slot_fields_absent !== true) return null;
  if (uiState.durable_clarification_opened !== false) return null;
  if (uiState.execution_card_visible !== false) return null;
  if (uiState.tool_result_present !== false) return null;
  if (uiState.adoption_decision_present !== false) return null;
  if (uiState.candidate_selected !== false) return null;
  if (uiState.candidate_adopted !== false) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_action_result_received !== true) return null;
  const lmstudioQualityChecksRequired = uiState.lmstudio_quality_checks_required === true;
  if (lmstudioQualityChecksRequired) {
    if (uiState.natural_reply_chinese !== true) return null;
    if (uiState.natural_reply_no_json_code !== true) return null;
    if (uiState.candidates_no_json_code !== true) return null;
    if (uiState.candidate_semantically_relevant !== true) return null;
  }

  return {
    slice_id: "au02-natural-exploration-no-slot-form",
    behavior: "fuzzy_idea_gets_natural_exploration_without_slot_form_or_execution",
    turn_ids: turnIds,
    source_turn_ref: turnIds[0],
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    assertions: [
      "real_workbench_sent_fuzzy_creative_input",
      "planner_returned_creative_exploration_frame",
      "natural_assistant_reply_visible",
      "candidate_panel_rendered_from_turn_result",
      "required_slot_fields_absent",
      "mechanical_slot_form_not_rendered",
      "durable_clarification_not_opened",
      "micro_plan_not_requested",
      "no_tool_confirmation_or_adoption_cards",
      "candidate_not_selected_or_adopted",
      "production_write_not_claimed",
      ...(lmstudioQualityChecksRequired
        ? [
            "lmstudio_reply_is_chinese_and_not_json",
            "lmstudio_candidates_are_semantically_relevant",
          ]
        : []),
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_for_source_candidate_turn"
        : "deterministic_provider_form_frame_called_for_source_candidate_turn",
    ],
  };
}

function candidateFallbackUiBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (hasEventPrefix(turnRecords, "channel.author_action.")) return null;
  if (hasEventPrefix(turnRecords, "adoption.evaluate.")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  const frame = turnRecords.find(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) >= 2,
  );
  if (!frame) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au02-candidate-fallback-ui" &&
      record.source_turn_id === turnIds[0],
  );
  if (!uiState) return null;

  if (uiState.provider_candidate_payload !== "malformed_candidates") return null;
  if (uiState.malformed_candidate_prompt_sent !== true) return null;
  if (uiState.fallback_candidate_visible !== true) return null;
  if (uiState.has_known_fallback_candidate !== true) return null;
  if (uiState.candidate_fields_nonempty !== true) return null;
  if (uiState.candidate_statuses_not_adopted !== true) return null;
  if (Number(uiState.candidate_panel_rendered ?? 0) <= 0) return null;
  if (uiState.tool_result_present !== false) return null;
  if (uiState.adoption_decision_present !== false) return null;
  if (uiState.candidate_selected !== false) return null;
  if (uiState.candidate_adopted !== false) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_action_result_received !== true) return null;

  return {
    slice_id: "au02-candidate-fallback-ui",
    behavior: "malformed_candidate_payload_renders_fallback_candidate_cards",
    turn_ids: turnIds,
    source_turn_ref: turnIds[0],
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    fallback_candidate_titles: uiState.fallback_candidate_titles,
    assertions: [
      "real_workbench_sent_malformed_candidate_prompt",
      "planner_returned_creative_exploration_frame",
      "malformed_provider_candidates_were_replaced",
      "fallback_candidate_cards_visible",
      "candidate_fields_are_nonempty",
      "candidate_statuses_remain_not_adopted",
      "micro_plan_not_requested",
      "no_tool_confirmation_or_adoption_cards",
      "production_write_not_claimed",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_for_candidate_fallback"
        : "deterministic_provider_form_frame_called_for_candidate_fallback",
    ],
  };
}

function candidateContinuationBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (hasEventPrefix(turnRecords, "channel.adopt.")) return null;
  if (hasEventPrefix(turnRecords, "channel.discard.")) return null;
  if (hasEventPrefix(turnRecords, "channel.modify_draft.")) return null;
  if (hasEventPrefix(turnRecords, "channel.get_toc.")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  const start = turnRecords.find((record) => record.event === "channel.user_message.start");
  if (!start?.candidate_ref || !start?.candidate_source_turn_ref) return null;

  return {
    slice_id: "au02-candidate-continuation",
    behavior: "candidate_selection_continues_dialogue_without_adoption",
    turn_ids: turnIds,
    source_turn_ref: start.candidate_source_turn_ref,
    candidate_ref: start.candidate_ref,
    assertions: [
      "candidate_ref_sent_from_real_workbench",
      "micro_plan_not_requested",
      "no_adoption_or_projection_events",
      "assistant_messages_not_fallback",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_per_turn"
        : "deterministic_provider_form_frame_called_per_turn",
    ],
  };
}

function candidateMultiturnContextBehavior(turnIds, turnRecords, evidence, options) {
  if (turnIds.length !== 3) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (hasEventPrefix(turnRecords, "channel.author_action.")) return null;
  if (hasEventPrefix(turnRecords, "adoption.evaluate.")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  const [sourceTurnId, continuationTurnId, followupTurnId] = turnIds;
  const sourceRecords = turnRecords.filter((record) => record.turn_id === sourceTurnId);
  const continuationRecords = turnRecords.filter((record) => record.turn_id === continuationTurnId);
  const followupRecords = turnRecords.filter((record) => record.turn_id === followupTurnId);

  const sourceFrame = sourceRecords.find(
    (record) =>
      record.event === "planner.form_frame.done" &&
      record.frame_type === "creative_exploration" &&
      Number(record.candidate_count ?? 0) > 0,
  );
  if (!sourceFrame) return null;

  const continuationStart = continuationRecords.find(
    (record) => record.event === "channel.user_message.start",
  );
  if (
    !continuationStart?.candidate_ref ||
    continuationStart.candidate_source_turn_ref !== sourceTurnId ||
    continuationStart.generate_micro_plan !== false
  ) {
    return null;
  }

  const followupStart = followupRecords.find(
    (record) => record.event === "channel.user_message.start",
  );
  if (!followupStart || followupStart.generate_micro_plan !== false) return null;
  if (followupStart.candidate_ref || followupStart.candidate_source_turn_ref) return null;

  const followupContext = followupRecords.find(
    (record) =>
      record.event === "context.assemble.done" &&
      record.has_conversation === true &&
      record.has_session_summary === true,
  );
  if (!followupContext) return null;

  if (evidence.followup_reply_contains_context_nonce !== true) return null;
  if (evidence.followup_plain_user_message_sent !== true) return null;
  if (evidence.continuation_candidate_selection_sent !== true) return null;
  if (evidence.tool_result_present !== false) return null;
  if (evidence.adoption_decision_present !== false) return null;
  if (evidence.no_author_action_sent !== true) return null;
  if (evidence.no_action_result_received !== true) return null;
  if (evidence.candidate_selected !== false) return null;
  if (evidence.candidate_adopted !== false) return null;
  if (evidence.production_write_performed !== false) return null;

  return {
    slice_id: "au02-candidate-multiturn-context",
    behavior: "candidate_context_survives_continuation_and_plain_followup",
    turn_ids: turnIds,
    source_turn_ref: sourceTurnId,
    continuation_turn_id: continuationTurnId,
    followup_turn_id: followupTurnId,
    candidate_ref: evidence.candidate_ref,
    context_nonce: evidence.context_nonce,
    assertions: [
      "source_turn_rendered_nonce_candidate",
      "candidate_continuation_sent_candidate_selection",
      "plain_followup_did_not_send_candidate_selection",
      "followup_context_assembled_session_conversation",
      "assistant_reply_reflected_prior_candidate_context",
      "micro_plan_not_requested",
      "no_author_action_or_adoption_events",
      "production_write_not_claimed",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_for_multiturn_context"
        : "deterministic_provider_form_frame_called_for_multiturn_context",
    ],
  };
}

function candidateFreeformFollowupBehavior(turnIds, turnRecords, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (hasEventPrefix(turnRecords, "channel.author_action.")) return null;
  if (hasEventPrefix(turnRecords, "adoption.evaluate.")) return null;
  if (hasEventPrefix(turnRecords, "projection.")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  const start = turnRecords.find((record) => record.event === "channel.user_message.start");
  if (start?.candidate_ref || start?.candidate_source_turn_ref) return null;
  if (evidence.input_enabled_after_candidate !== true) return null;
  if (evidence.candidate_selection_sent !== false) return null;
  if (evidence.no_author_action_sent !== true) return null;
  if (evidence.no_action_result_received !== true) return null;
  if (evidence.candidate_selected !== false) return null;
  if (evidence.candidate_adopted !== false) return null;
  if (evidence.production_write_performed !== false) return null;

  return {
    slice_id: "au02-freeform-followup-after-candidate",
    behavior: "candidate_panel_allows_freeform_followup_without_adoption",
    turn_ids: turnIds,
    source_turn_ref: evidence.source_turn_ref,
    candidate_ref: evidence.candidate_ref,
    assertions: [
      "candidate_panel_rendered_before_freeform_followup",
      "chat_input_remained_enabled_with_candidate_panel",
      "freeform_followup_sent_plain_user_message",
      "candidate_selection_not_sent",
      "author_action_not_sent",
      "no_adoption_or_projection_events",
      "production_write_not_claimed",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_for_freeform_followup"
        : "deterministic_provider_form_frame_called_for_freeform_followup",
    ],
  };
}

function unadoptedCandidateNoReadingFactBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (hasEventPrefix(turnRecords, "channel.author_action.")) return null;
  if (hasEventPrefix(turnRecords, "adoption.evaluate.")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au02-unadopted-candidate-no-reading-fact" &&
      record.source_turn_id === turnIds[0],
  );
  if (!uiState) return null;

  if (uiState.reading_mode_opened !== true) return null;
  if (uiState.reading_empty_state_visible !== true) return null;
  if (Number(uiState.reading_toc_chapter_count ?? -1) !== 0) return null;
  if (Number(uiState.reading_total_word_count ?? -1) !== 0) return null;
  if (uiState.candidate_title_visible_in_reading !== false) return null;
  if (uiState.candidate_pitch_visible_in_reading !== false) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_action_result_received !== true) return null;
  if (uiState.no_projection_events !== true) return null;
  if (uiState.adoption_decision_present !== false) return null;
  if (uiState.candidate_selected !== false) return null;
  if (uiState.candidate_adopted !== false) return null;
  if (uiState.production_write_performed !== false) return null;

  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? -1) === 0 &&
      Number(record.total_word_count ?? -1) === 0,
  );
  if (!tocRead) return null;

  return {
    slice_id: "au02-unadopted-candidate-no-reading-fact",
    behavior: "unadopted_candidate_stays_out_of_reading_and_work_facts",
    turn_ids: turnIds,
    source_turn_ref: turnIds[0],
    candidate_ref: uiState.candidate_ref,
    candidate_set_ref: uiState.candidate_set_ref,
    assertions: [
      "candidate_panel_rendered_from_turn_result",
      "author_did_not_click_candidate_actions",
      "reading_mode_loaded_empty_toc",
      "candidate_title_not_visible_in_reading_mode",
      "candidate_pitch_not_visible_in_reading_mode",
      "no_author_action_or_action_result",
      "no_adoption_decision_or_projection_events",
      "candidate_not_selected_or_adopted",
      "production_write_not_claimed",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_for_source_candidate_turn"
        : "deterministic_provider_form_frame_called_for_source_candidate_turn",
    ],
  };
}

function p1ChapterPlanMinimumBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan([evidence.generation_turn_id], turnRecords, true)) return null;
  if (!turnsHaveEvent([evidence.generation_turn_id], turnRecords, "planner.form_micro_plan.done")) {
    return null;
  }
  if (!turnsHaveEvent([evidence.generation_turn_id], turnRecords, "toolbox.execute.done"))
    return null;
  if (!turnsHaveEvent([evidence.generation_turn_id], turnRecords, "channel.author_action.done"))
    return null;
  if (
    !lmstudioHasSteps(options, [evidence.generation_turn_id], ["form_frame", "form_micro_plan"])
  ) {
    return null;
  }

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "p1-chapter-plan-minimum" &&
      record.generation_turn_id === evidence.generation_turn_id,
  );
  if (!uiState) return null;

  // 采纳的章节计划成正式目录：从 get_toc 读到计划全章（>= 8），单一数据源，无 get_chapter_plans。
  const chapterStructureRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) >= 8,
  );
  if (!chapterStructureRead) return null;

  return {
    slice_id: "p1-chapter-plan-minimum",
    behavior: "chapter_plan_generated_adopted_and_read_from_structure",
    turn_ids: turnIds,
    chapter_count: Number(uiState.chapter_count ?? 0),
    assertions: [
      "real_archive_outline_start_planning_clicked",
      "micro_plan_requested_from_real_workbench",
      "plot_outline_generated_outline_draft",
      "outline_draft_adopted_through_adoption_boundary",
      "outline_draft_did_not_materialize_reading_projection",
      "adopted_plan_materialized_chapter_structure_read_via_toc",
      "real_ui_rendered_first_and_final_chapter_titles",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_and_micro_plan_called"
        : "deterministic_provider_form_frame_and_micro_plan_called",
    ],
  };
}

function p1ChapterDraftGenerationBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan([evidence.draft_turn_id], turnRecords, true)) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "context.assemble.done")) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "planner.form_micro_plan.done")) {
    return null;
  }
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "toolbox.execute.done")) return null;
  if (hasEventPrefix(turnRecords, "channel.adopt.")) return null;
  if (!lmstudioHasSteps(options, [evidence.draft_turn_id], ["form_frame", "form_micro_plan"])) {
    return null;
  }

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "p1-chapter-draft-generation" &&
      record.draft_turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;

  // 阅读目录显示已采纳计划的全章（>=10）但还没有正文（全书 0 字）：计划即目录，正文未采纳不进阅读。
  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) >= 10 &&
      Number(record.total_word_count ?? -1) === 0,
  );
  if (!tocRead) return null;

  return {
    slice_id: "p1-chapter-draft-generation",
    behavior: "chapter_draft_generated_from_adopted_plan_without_reading_projection",
    turn_ids: turnIds,
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    chapter_title: evidence.chapter_title,
    draft_body_chars: Number(uiState.draft_body_chars ?? 0),
    assertions: [
      "real_archive_outline_chapter_plan_rendered",
      "chapter_draft_requested_from_visible_chapter_action",
      "micro_plan_requested_from_real_workbench",
      "prose_writing_generated_prose_fragment",
      "prose_fragment_remained_pending_for_author_adoption",
      "reading_mode_checked_before_adoption",
      "unadopted_prose_fragment_did_not_materialize_reading_projection",
      "no_adoption_event_was_sent",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_and_micro_plan_called"
        : "deterministic_provider_form_frame_and_micro_plan_called",
    ],
  };
}

function findP1WordCountAuditEvidence(records) {
  // 复用采纳到阅读的主链证据查找，再叠加短章审计断言。
  const base = findP1ChapterAdoptionReadingEvidence(records, "p1-word-count-audit");
  if (!base) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "p1-word-count-audit" &&
      record.short_chapter_marked === true &&
      record.milestone_met === false,
  );
  if (!uiState) return null;

  return {
    ...base,
    slice_id: "p1-word-count-audit",
    short_chapter_marked: true,
    milestone_met: false,
  };
}

function findP1ChapterAdoptionReadingEvidence(
  records,
  sliceId = "p1-chapter-adoption-reading",
  expectMicroPlan = true,
) {
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.accept_event_sent === true &&
      record.accept_button_cleared_after_adoption === true &&
      record.artifact_adopted === true &&
      record.reading_mode_populated_after_adoption === true &&
      record.word_count_matches_adopted_prose === true &&
      record.projection_refresh_status === "STALE" &&
      record.projection_stale_banner_visible === true &&
      record.projection_refresh_button_visible === true &&
      Number(record.total_word_count ?? 0) > 0 &&
      Number(record.chapter_word_count ?? 0) > 0,
  );
  if (!uiState) return null;

  const draftTurnId = String(uiState.draft_turn_id ?? "");
  if (!draftTurnId) return null;
  if (!String(uiState.user_message_text ?? "").includes("正文草稿")) return null;

  const draftRecords = records.filter((record) => record.turn_id === draftTurnId);

  // 生成草稿按钮路径要求 generate_micro_plan=true；对话框自然语言创作路径为 false
  // （仍经 planner 判定走工具）。expectMicroPlan 区分两条真实入口。
  const start = draftRecords.find(
    (record) =>
      record.event === "channel.user_message.start" &&
      record.generate_micro_plan === expectMicroPlan,
  );
  if (!start) return null;

  const generatedByTool = draftRecords.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  if (!generatedByTool) return null;

  // accept author_action 闭环：作者点击「确认创建」后进入采纳边界并被接受。
  const acceptDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (!acceptDone) return null;

  // 采纳后阅读投影物化：TOC 至少 1 章，章节正文有效字符 >= 1。
  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) >= 1,
  );
  if (!tocRead) return null;

  const chapterRead = records.find(
    (record) =>
      record.event === "channel.get_chapter_content.done" &&
      record.work_id === uiState.work_id &&
      Number(record.content_chars ?? 0) >= 1,
  );
  if (!chapterRead) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnId,
    turn_ids: [draftTurnId],
    draft_turn_id: draftTurnId,
    adopt_turn_id: uiState.adopt_turn_id,
    artifact_id: uiState.artifact_id,
    artifact_type: uiState.artifact_type,
    chapter_title: uiState.chapter_title,
    chapter_count: tocRead.chapter_count,
    content_chars: chapterRead.content_chars,
    total_word_count: uiState.total_word_count,
    chapter_word_count: uiState.chapter_word_count,
    expected_word_count: uiState.expected_word_count,
    projection_refresh_status: uiState.projection_refresh_status,
    projection_stale_banner_visible: uiState.projection_stale_banner_visible,
    projection_refresh_button_visible: uiState.projection_refresh_button_visible,
    key_events: keyEvents,
  };
}

function findAu07StateTraceAdoptionReplayEvidence(records) {
  const sliceId = "au07-state-trace-adoption-replay";
  const base = findP1ChapterAdoptionReadingEvidence(records, sliceId, true);
  if (!base) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.draft_turn_id === base.draft_turn_id,
  );
  if (!uiState) return null;

  const stateTraceRef = String(uiState.state_trace_ref ?? "");
  if (!stateTraceRef) return null;
  if (uiState.resolved_state_trace_ref !== stateTraceRef) return null;
  if (uiState.projection_source_state_trace_ref !== stateTraceRef) return null;
  if (Number(uiState.trace_summary_state_trace_refs_count ?? 0) < 1) return null;
  if (Number(uiState.projection_refs_count ?? 0) < 1) return null;
  if (String(uiState.adoption_trace_ref ?? "") !== `trace:${uiState.adopt_turn_id}`) return null;

  return {
    ...base,
    slice_id: sliceId,
    turn_id: uiState.adopt_turn_id,
    turn_ids: [base.draft_turn_id, uiState.adopt_turn_id],
    state_trace_ref: stateTraceRef,
    adoption_trace_ref: uiState.adoption_trace_ref,
    projection_source_state_trace_ref: uiState.projection_source_state_trace_ref,
    key_events: keyEventsForSlice(sliceId),
  };
}

function findP1ChapterWordCountTargetEvidence(records) {
  const sliceId = "p1-chapter-word-count-target";
  // 复用采纳-阅读链路证据：作者请求生成 → 工具产出 → accept 采纳 → 阅读投影字数自洽。
  // 走对话框自然语言创作（非"生成草稿"按钮），故 expectMicroPlan=false。
  const base = findP1ChapterAdoptionReadingEvidence(records, sliceId, false);
  if (!base) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.draft_turn_id === base.draft_turn_id,
  );
  if (!uiState) return null;

  const requested = Number(uiState.target_word_count_requested ?? 0);
  if (requested <= 0) return null;
  if (uiState.word_count_meets_target !== true) return null;

  // 数据流证明：作者篇幅诉求经 Planner 识别后进入执行链（turn_execution observability 事件，
  // 事件里的 target_word_count 必须与作者请求一致）。
  const wordCountEvent = records.find(
    (record) =>
      record.event === "turn_execution.target_word_count.done" &&
      Number(record.target_word_count ?? 0) === requested,
  );
  if (!wordCountEvent) return null;

  // 产出响应证明：采纳章的有效字数（阅读投影 + 后端持久化正文）贴近目标，下限容差
  // 兼顾真实 LLM 不精确（确定性 provider 会产 >= 目标）。
  const lowerBound = Math.floor(requested * 0.5);
  if (Number(base.chapter_word_count ?? 0) < lowerBound) return null;
  if (Number(base.content_chars ?? 0) < lowerBound) return null;

  return {
    ...base,
    slice_id: sliceId,
    target_word_count_requested: requested,
    target_word_count_event: Number(wordCountEvent.target_word_count ?? 0),
    word_count_lower_bound: lowerBound,
    key_events: keyEventsForSlice(sliceId),
  };
}

function findAu05DiscardAuthorActionEvidence(records) {
  const sliceId = "au05-discard-author-action";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.discard_action_sent === true &&
      record.discard_action_type === "discard" &&
      record.action_result_status === "discarded" &&
      record.artifact_discarded === true &&
      record.artifact_adopted === false &&
      record.production_write_performed === false &&
      record.discard_button_cleared_after_discard === true &&
      record.reading_mode_empty_after_discard === true &&
      record.draft_not_visible_in_reading === true,
  );
  if (!uiState) return null;

  const draftTurnId = String(uiState.draft_turn_id ?? "");
  if (!draftTurnId) return null;
  if (!String(uiState.user_message_text ?? "").includes("正文草稿")) return null;

  const draftRecords = records.filter((record) => record.turn_id === draftTurnId);

  const start = draftRecords.find(
    (record) =>
      record.event === "channel.user_message.start" && record.generate_micro_plan === true,
  );
  if (!start) return null;

  const generatedByTool = draftRecords.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  if (!generatedByTool) return null;

  const discardDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "discard" &&
      record.action_status === "discarded",
  );
  if (!discardDone) return null;

  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.total_word_count ?? -1) === 0 &&
      Number(record.empty_chapter_count ?? 0) >= 1,
  );
  if (!tocRead) return null;

  const chapterRead = records.find(
    (record) =>
      record.event === "channel.get_chapter_content.done" &&
      record.work_id === uiState.work_id &&
      Number(record.content_chars ?? -1) === 0,
  );
  if (!chapterRead) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnId,
    turn_ids: [draftTurnId],
    draft_turn_id: draftTurnId,
    discard_turn_id: uiState.discard_turn_id,
    artifact_id: uiState.artifact_id,
    artifact_type: uiState.artifact_type,
    chapter_title: uiState.chapter_title,
    chapter_count_after_discard: Number(tocRead.chapter_count ?? 0),
    total_word_count_after_discard: Number(tocRead.total_word_count ?? 0),
    empty_chapter_count_after_discard: Number(tocRead.empty_chapter_count ?? 0),
    content_chars_after_discard: Number(chapterRead.content_chars ?? 0),
    key_events: keyEvents,
  };
}

function findAu04ConfirmBeforeExecuteEvidence(records) {
  const sliceId = "au04-confirm-before-execute";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.confirmation_card_received === true &&
      r.confirmation_card_visible === true &&
      r.confirmation_card_detail_visible === true &&
      r.confirmation_card_target_visible === true &&
      r.confirmation_card_no_write_visible === true &&
      r.confirmation_card_re_gate_visible === true &&
      r.plan_carried_over_wire === true &&
      r.tool_called_before_confirm === false &&
      r.production_write_before_confirm === false &&
      r.confirm_action_sent === true &&
      r.confirmed_dispatch === true &&
      r.artifact_pending_after_confirm === true &&
      String(r.confirm_action_behavior_ref ?? "") !== "",
  );
  if (!uiState) return null;

  const confirmTurnId = String(uiState.confirm_turn_id ?? "");
  if (!confirmTurnId) return null;

  const turnRecords = records.filter((r) => String(r.turn_id ?? "") === confirmTurnId);

  // 对话框自然语言路径（非按钮）发起。
  const start = turnRecords.find(
    (r) => r.event === "channel.user_message.start" && r.generate_micro_plan === false,
  );
  if (!start) return null;

  // 同一 turn 上 Orchestrator 两次裁决：先 require_confirmation 拦下，确认后 re-gate 放行。
  const decisions = turnRecords.filter((r) => r.event === "orchestrator.decide.done");
  const blockedFirst = decisions.some((r) => r.decision_type === "require_confirmation");
  const allowedAfterConfirm = decisions.some((r) => r.decision_type === "allow_tool");
  if (!blockedFirst || !allowedAfterConfirm) return null;

  // 确认动作经 author_action 闭环。
  const confirmDone = records.find(
    (r) =>
      r.event === "channel.author_action.done" &&
      r.action_type === "confirm_before_execute" &&
      r.action_status === "accepted",
  );
  if (!confirmDone) return null;

  // 确认后才执行：prose_writing 在同一 turn 成功产出。
  const executed = turnRecords.find(
    (r) =>
      r.event === "toolbox.execute.done" &&
      r.tool_name === "prose_writing" &&
      r.tool_outcome === "succeeded",
  );
  if (!executed) return null;

  return {
    slice_id: sliceId,
    turn_id: confirmTurnId,
    turn_ids: [confirmTurnId],
    confirm_turn_id: confirmTurnId,
    executed_turn_id: uiState.executed_turn_id,
    artifact_id: uiState.artifact_id,
    artifact_type: uiState.artifact_type,
    confirm_action_behavior_ref: uiState.confirm_action_behavior_ref,
    confirmation_card_detail_visible: uiState.confirmation_card_detail_visible,
    confirmation_card_target_visible: uiState.confirmation_card_target_visible,
    confirmation_card_no_write_visible: uiState.confirmation_card_no_write_visible,
    confirmation_card_re_gate_visible: uiState.confirmation_card_re_gate_visible,
    key_events: keyEvents,
  };
}

function findAu04ConfirmIdempotencyUiEvidence(records) {
  const sliceId = "au04-confirm-idempotency-ui";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.confirmation_card_received === true &&
      r.plan_carried_over_wire === true &&
      r.tool_called_before_confirm === false &&
      r.production_write_before_confirm === false &&
      r.confirm_double_click_attempted === true &&
      r.confirm_action_sent === true &&
      Number(r.sent_confirm_action_count ?? 0) >= 1 &&
      Number(r.non_duplicate_author_action_done_count ?? 0) === 1 &&
      r.duplicate_suppressed_or_deduped === true &&
      r.confirmed_dispatch === true &&
      Number(r.toolbox_execute_count ?? 0) === 1 &&
      r.no_duplicate_tool_dispatch === true &&
      Number(r.pending_prose_fragment_count ?? 0) === 1 &&
      r.single_pending_artifact_after_confirm === true &&
      r.artifact_pending_after_confirm === true &&
      String(r.confirm_action_behavior_ref ?? "") !== "",
  );
  if (!uiState) return null;

  const confirmTurnId = String(uiState.confirm_turn_id ?? "");
  if (!confirmTurnId) return null;

  const turnRecords = records.filter((r) => String(r.turn_id ?? "") === confirmTurnId);

  const start = turnRecords.find(
    (r) => r.event === "channel.user_message.start" && r.generate_micro_plan === false,
  );
  if (!start) return null;

  const decisions = turnRecords.filter((r) => r.event === "orchestrator.decide.done");
  const blockedFirst = decisions.some((r) => r.decision_type === "require_confirmation");
  const allowedAfterConfirm = decisions.some((r) => r.decision_type === "allow_tool");
  if (!blockedFirst || !allowedAfterConfirm) return null;

  const confirmDoneRecords = records.filter(
    (r) =>
      r.event === "channel.author_action.done" &&
      r.turn_id === confirmTurnId &&
      r.action_type === "confirm_before_execute" &&
      r.action_status === "accepted",
  );
  const nonDuplicateDoneRecords = confirmDoneRecords.filter((r) => r.duplicate !== true);
  if (nonDuplicateDoneRecords.length !== 1) return null;

  const executedRecords = turnRecords.filter(
    (r) =>
      r.event === "toolbox.execute.done" &&
      r.tool_name === "prose_writing" &&
      r.tool_outcome === "succeeded",
  );
  if (executedRecords.length !== 1) return null;

  return {
    slice_id: sliceId,
    turn_id: confirmTurnId,
    turn_ids: [confirmTurnId],
    confirm_turn_id: confirmTurnId,
    executed_turn_id: uiState.executed_turn_id,
    artifact_id: uiState.artifact_id,
    artifact_type: uiState.artifact_type,
    confirm_action_behavior_ref: uiState.confirm_action_behavior_ref,
    confirm_action_id: uiState.confirm_action_id,
    confirm_action_idempotency_key: uiState.confirm_action_idempotency_key,
    sent_confirm_action_count: Number(uiState.sent_confirm_action_count ?? 0),
    author_action_done_count: Number(uiState.author_action_done_count ?? 0),
    duplicate_author_action_done_count: Number(uiState.duplicate_author_action_done_count ?? 0),
    duplicate_action_result_count: Number(uiState.duplicate_action_result_count ?? 0),
    toolbox_execute_count: Number(uiState.toolbox_execute_count ?? 0),
    pending_prose_fragment_count: Number(uiState.pending_prose_fragment_count ?? 0),
    key_events: keyEvents,
  };
}

function findAu04ConfirmationToolFailureRecoveryEvidence(records) {
  const sliceId = "au04-confirmation-tool-failure-recovery";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.confirmation_card_received === true &&
      r.plan_carried_over_wire === true &&
      r.tool_called_before_confirm === false &&
      r.production_write_before_confirm === false &&
      r.confirm_action_sent === true &&
      r.confirm_action_acknowledged === true &&
      r.confirmed_dispatch_attempted === true &&
      r.confirmed_turn_failed === true &&
      r.failure_message_visible === true &&
      r.no_pending_artifact_after_failure === true &&
      r.no_production_write_after_failure === true &&
      r.no_successful_tool_dispatch_after_failure === true &&
      Number(r.provider_error_count ?? 0) >= 1 &&
      Number(r.toolbox_execute_error_count ?? 0) >= 1 &&
      Number(r.toolbox_execute_success_count ?? -1) === 0 &&
      Number(r.pending_prose_fragment_after_failure_count ?? -1) === 0 &&
      String(r.confirm_action_behavior_ref ?? "") !== "",
  );
  if (!uiState) return null;

  const confirmTurnId = String(uiState.confirm_turn_id ?? "");
  const failedTurnId = String(uiState.failed_turn_id ?? "");
  if (!confirmTurnId || !failedTurnId) return null;

  const turnRecords = records.filter((r) => String(r.turn_id ?? "") === confirmTurnId);

  const start = turnRecords.find(
    (r) => r.event === "channel.user_message.start" && r.generate_micro_plan === false,
  );
  if (!start) return null;

  const decisions = turnRecords.filter((r) => r.event === "orchestrator.decide.done");
  const blockedFirst = decisions.some((r) => r.decision_type === "require_confirmation");
  const allowedAfterConfirm = decisions.some((r) => r.decision_type === "allow_tool");
  if (!blockedFirst || !allowedAfterConfirm) return null;

  const confirmDone = records.find(
    (r) =>
      r.event === "channel.author_action.done" &&
      r.turn_id === confirmTurnId &&
      r.action_type === "confirm_before_execute" &&
      r.action_status === "accepted",
  );
  if (!confirmDone) return null;

  const providerError = turnRecords.find(
    (r) =>
      r.event === "provider_gateway.complete.error" &&
      r.provider === "slice_verify" &&
      String(r.outcome_detail ?? "").includes("AU04FAILTOOL fixture provider failure"),
  );
  if (!providerError) return null;

  const toolboxError = turnRecords.find(
    (r) =>
      r.event === "toolbox.execute.error" &&
      r.tool_name === "prose_writing" &&
      String(r.tool_outcome ?? "").includes("failed") &&
      r.reason_code === "provider_error",
  );
  if (!toolboxError) return null;

  return {
    slice_id: sliceId,
    turn_id: confirmTurnId,
    turn_ids: [confirmTurnId],
    confirm_turn_id: confirmTurnId,
    failed_turn_id: failedTurnId,
    confirm_action_behavior_ref: uiState.confirm_action_behavior_ref,
    confirm_action_id: uiState.confirm_action_id,
    failed_tool_name: uiState.failed_tool_name,
    failed_tool_status: uiState.failed_tool_status,
    provider_error_count: Number(uiState.provider_error_count ?? 0),
    toolbox_execute_error_count: Number(uiState.toolbox_execute_error_count ?? 0),
    pending_prose_fragment_after_failure_count: Number(
      uiState.pending_prose_fragment_after_failure_count ?? 0,
    ),
    key_events: keyEvents,
  };
}

function findAu04StaleConfirmationUiEvidence(records) {
  const sliceId = "au04-stale-confirmation-ui";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.confirmation_card_received === true &&
      r.plan_carried_over_wire === true &&
      r.tool_called_before_confirm === false &&
      r.production_write_before_confirm === false &&
      r.followup_turn_completed === true &&
      r.followup_advanced_current_turn === true &&
      r.stale_confirm_prevented === true &&
      r.no_tool_dispatch_after_stale === true &&
      r.no_pending_artifact_after_stale === true &&
      Number(r.toolbox_execute_after_stale_count ?? 0) === 0 &&
      Number(r.pending_prose_fragment_after_stale_count ?? 0) === 0 &&
      String(r.confirm_action_behavior_ref ?? "") !== "",
  );
  if (!uiState) return null;

  const confirmTurnId = String(uiState.confirm_turn_id ?? "");
  const followupTurnId = String(uiState.followup_turn_id ?? "");
  if (!confirmTurnId || !followupTurnId || confirmTurnId === followupTurnId) return null;

  const turnRecords = records.filter((r) => String(r.turn_id ?? "") === confirmTurnId);
  const start = turnRecords.find(
    (r) => r.event === "channel.user_message.start" && r.generate_micro_plan === false,
  );
  if (!start) return null;

  const decisions = turnRecords.filter((r) => r.event === "orchestrator.decide.done");
  const blockedFirst = decisions.some((r) => r.decision_type === "require_confirmation");
  if (!blockedFirst) return null;

  const preventedByUi =
    uiState.stale_confirm_visible === false || uiState.stale_confirm_disabled === true;
  const rejectedByChannel = records.some(
    (r) =>
      r.event === "channel.author_action.error" &&
      r.turn_id === confirmTurnId &&
      r.action_type === "confirm_before_execute" &&
      String(r.outcome_detail ?? "").includes("stale"),
  );
  if (!preventedByUi && !rejectedByChannel) return null;

  return {
    slice_id: sliceId,
    turn_id: confirmTurnId,
    turn_ids: [confirmTurnId, followupTurnId],
    confirm_turn_id: confirmTurnId,
    followup_turn_id: followupTurnId,
    confirm_action_behavior_ref: uiState.confirm_action_behavior_ref,
    stale_confirm_visible: uiState.stale_confirm_visible,
    stale_confirm_disabled: uiState.stale_confirm_disabled,
    stale_confirm_click_attempted: uiState.stale_confirm_click_attempted,
    stale_confirm_action_sent: uiState.stale_confirm_action_sent,
    stale_confirm_rejected: uiState.stale_confirm_rejected,
    author_action_error_count: Number(uiState.author_action_error_count ?? 0),
    toolbox_execute_after_stale_count: Number(uiState.toolbox_execute_after_stale_count ?? 0),
    pending_prose_fragment_after_stale_count: Number(
      uiState.pending_prose_fragment_after_stale_count ?? 0,
    ),
    key_events: keyEvents,
  };
}

function findAu06SingleActiveConfirmationEvidence(records) {
  const sliceId = "au06-single-active-confirmation";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.distinct_behavior_refs === true &&
      r.first_tool_called_before_confirm === false &&
      r.first_production_write_before_confirm === false &&
      r.second_tool_called_before_confirm === false &&
      r.second_production_write_before_confirm === false &&
      r.second_confirmation_advanced_current_turn === true &&
      r.old_confirm_prevented === true &&
      r.no_tool_dispatch_after_old === true &&
      r.no_pending_artifact_after_old === true &&
      r.latest_confirm_action_sent === true &&
      r.latest_confirm_dispatched === true &&
      Number(r.latest_toolbox_execute_count ?? 0) === 1 &&
      r.latest_pending_artifact_after_confirm === true &&
      String(r.first_confirm_action_behavior_ref ?? "") !== "" &&
      String(r.second_confirm_action_behavior_ref ?? "") !== "" &&
      r.second_turn_behavior_context_ref_visible === true &&
      r.second_turn_behavior_context_author_safe === true &&
      String(r.second_turn_behavior_context_summary ?? "") !== "" &&
      (String(r.second_turn_behavior_context_source_id ?? "") === "behavior_summary" ||
        String(r.second_turn_behavior_context_ref ?? "") !== ""),
  );
  if (!uiState) return null;

  const firstTurnId = String(uiState.first_confirm_turn_id ?? "");
  const secondTurnId = String(uiState.second_confirm_turn_id ?? "");
  if (!firstTurnId || !secondTurnId || firstTurnId === secondTurnId) return null;

  const firstRecords = records.filter((r) => String(r.turn_id ?? "") === firstTurnId);
  const secondRecords = records.filter((r) => String(r.turn_id ?? "") === secondTurnId);

  const firstBlocked = firstRecords.some(
    (r) => r.event === "orchestrator.decide.done" && r.decision_type === "require_confirmation",
  );
  const secondBlocked = secondRecords.some(
    (r) => r.event === "orchestrator.decide.done" && r.decision_type === "require_confirmation",
  );
  if (!firstBlocked || !secondBlocked) return null;

  const oldRejectedByChannel = records.some(
    (r) =>
      r.event === "channel.author_action.error" &&
      r.turn_id === firstTurnId &&
      r.action_type === "confirm_before_execute" &&
      String(r.outcome_detail ?? "").includes("stale"),
  );
  const oldPreventedByUi =
    uiState.confirm_button_count_after_second === 1 || uiState.old_confirm_disabled === true;
  if (!oldRejectedByChannel && !oldPreventedByUi) return null;

  const behaviorContextSummary = String(uiState.second_turn_behavior_context_summary ?? "");
  const firstBehaviorRef = String(uiState.first_confirm_action_behavior_ref ?? "");
  const firstActionId = String(uiState.first_confirm_action_id ?? "");
  if (firstBehaviorRef !== "" && behaviorContextSummary.includes(firstBehaviorRef)) {
    return null;
  }
  if (firstActionId !== "" && behaviorContextSummary.includes(firstActionId)) {
    return null;
  }

  const latestConfirmed = records.some(
    (r) =>
      r.event === "channel.author_action.done" &&
      r.turn_id === secondTurnId &&
      r.action_type === "confirm_before_execute" &&
      r.action_status === "accepted",
  );
  if (!latestConfirmed) return null;

  return {
    slice_id: sliceId,
    turn_id: secondTurnId,
    turn_ids: [firstTurnId, secondTurnId],
    first_confirm_turn_id: firstTurnId,
    second_confirm_turn_id: secondTurnId,
    latest_executed_turn_id: uiState.latest_executed_turn_id,
    artifact_id: uiState.artifact_id,
    artifact_type: uiState.artifact_type,
    first_confirm_action_behavior_ref: uiState.first_confirm_action_behavior_ref,
    second_confirm_action_behavior_ref: uiState.second_confirm_action_behavior_ref,
    second_turn_behavior_context_ref_visible: uiState.second_turn_behavior_context_ref_visible,
    second_turn_behavior_context_author_safe: uiState.second_turn_behavior_context_author_safe,
    second_turn_behavior_context_summary: uiState.second_turn_behavior_context_summary,
    second_turn_behavior_context_redaction_level:
      uiState.second_turn_behavior_context_redaction_level,
    second_turn_behavior_context_ref: uiState.second_turn_behavior_context_ref,
    second_turn_behavior_context_source_id: uiState.second_turn_behavior_context_source_id,
    old_confirm_prevented: uiState.old_confirm_prevented,
    old_confirm_rejected: uiState.old_confirm_rejected,
    old_author_action_error_count: Number(uiState.old_author_action_error_count ?? 0),
    toolbox_execute_after_old_count: Number(uiState.toolbox_execute_after_old_count ?? 0),
    pending_prose_fragment_after_old_count: Number(
      uiState.pending_prose_fragment_after_old_count ?? 0,
    ),
    latest_toolbox_execute_count: Number(uiState.latest_toolbox_execute_count ?? 0),
    key_events: keyEvents,
  };
}

function findAu04ConfirmationTtlUiEvidence(records) {
  const sliceId = "au04-confirmation-ttl-ui";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.confirmation_card_restored === true &&
      r.confirmation_card_visible === true &&
      r.expired_confirm_click_attempted === true &&
      r.expired_confirm_action_sent === true &&
      r.expired_confirm_rejected === true &&
      r.no_tool_dispatch_after_expired === true &&
      r.no_pending_artifact_after_expired === true &&
      Number(r.toolbox_execute_after_expired_count ?? 0) === 0 &&
      Number(r.pending_prose_fragment_after_expired_count ?? 0) === 0,
  );
  if (!uiState) return null;

  const turnId = String(uiState.turn_id ?? "");
  if (!turnId) return null;

  const rejectedByChannel = records.some(
    (r) =>
      r.event === "channel.author_action.error" &&
      r.turn_id === turnId &&
      r.action_type === "confirm_before_execute" &&
      String(r.outcome_detail ?? "").includes("expired action"),
  );
  if (!rejectedByChannel) return null;

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    expired_confirm_action_sent: uiState.expired_confirm_action_sent,
    expired_confirm_rejected: uiState.expired_confirm_rejected,
    author_action_error_count: Number(uiState.author_action_error_count ?? 0),
    toolbox_execute_after_expired_count: Number(uiState.toolbox_execute_after_expired_count ?? 0),
    pending_prose_fragment_after_expired_count: Number(
      uiState.pending_prose_fragment_after_expired_count ?? 0,
    ),
    key_events: keyEvents,
  };
}

function findAu04DisabledConfirmationActionUiEvidence(records) {
  const sliceId = "au04-disabled-confirmation-action-ui";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.confirmation_card_restored === true &&
      r.confirmation_card_visible === true &&
      r.disabled_confirm_visible === true &&
      r.disabled_confirm_disabled === true &&
      r.disabled_reason_visible_via_title === true &&
      r.reject_action_still_enabled === true &&
      r.disabled_click_blocked_by_browser === true &&
      r.no_author_action_sent === true &&
      r.no_channel_author_action_log === true &&
      r.no_tool_dispatch_after_disabled_attempt === true &&
      r.no_pending_artifact_after_disabled_attempt === true &&
      Number(r.author_action_sent_count ?? -1) === 0 &&
      Number(r.disabled_confirm_action_sent_count ?? -1) === 0 &&
      Number(r.channel_author_action_log_count ?? -1) === 0 &&
      Number(r.toolbox_execute_after_disabled_attempt_count ?? -1) === 0 &&
      Number(r.pending_prose_fragment_after_disabled_attempt_count ?? -1) === 0,
  );
  if (!uiState) return null;

  const workId = String(uiState.work_id ?? "");
  const sessionId = String(uiState.session_id ?? "");
  const turnId = String(uiState.turn_id ?? "");
  if (!workId || !sessionId || !turnId) return null;

  const joined = records.some(
    (r) => r.event === "channel.join.done" && r.work_id === workId && r.session_id === sessionId,
  );
  if (!joined) return null;

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    work_id: workId,
    session_id: sessionId,
    disabled_confirm_button_count: Number(uiState.disabled_confirm_button_count ?? 0),
    reject_button_count: Number(uiState.reject_button_count ?? 0),
    disabled_confirm_title: uiState.disabled_confirm_title,
    author_action_sent_count: Number(uiState.author_action_sent_count ?? 0),
    channel_author_action_log_count: Number(uiState.channel_author_action_log_count ?? 0),
    toolbox_execute_after_disabled_attempt_count: Number(
      uiState.toolbox_execute_after_disabled_attempt_count ?? 0,
    ),
    pending_prose_fragment_after_disabled_attempt_count: Number(
      uiState.pending_prose_fragment_after_disabled_attempt_count ?? 0,
    ),
    key_events: keyEvents,
  };
}

function findAu04HistoryConfirmationReadonlyEvidence(records) {
  const sliceId = "au04-history-confirmation-readonly";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.readonly_opened_from_real_workbench === true &&
      r.history_confirmation_transcript_visible === true &&
      r.history_confirmation_actions_hidden === true &&
      r.readonly_input_disabled === true &&
      r.readonly_send_disabled === true &&
      r.no_author_action_sent === true &&
      r.no_channel_author_action_log === true &&
      r.no_tool_dispatch_from_history === true &&
      r.no_pending_artifact_from_history === true &&
      r.active_session_restored === true &&
      Number(r.history_confirmation_confirm_button_count ?? -1) === 0 &&
      Number(r.history_confirmation_reject_button_count ?? -1) === 0 &&
      Number(r.author_action_sent_count ?? -1) === 0 &&
      Number(r.channel_author_action_log_count ?? -1) === 0 &&
      Number(r.toolbox_execute_after_history_open_count ?? -1) === 0 &&
      Number(r.pending_prose_fragment_after_history_open_count ?? -1) === 0,
  );
  if (!uiState) return null;

  const workId = String(uiState.work_id ?? "");
  const readonlySessionId = String(uiState.readonly_session_id ?? "");
  const turnId = String(uiState.turn_id ?? "");
  if (!workId || !readonlySessionId || !turnId) return null;

  const shown = records.find(
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === workId &&
      record.session_id === readonlySessionId &&
      record.read_only === true &&
      Number(record.transcript_count ?? 0) >= 2,
  );
  if (!shown) return null;

  const authorActionRecords = records.filter((record) =>
    String(record.event ?? "").startsWith("channel.author_action."),
  );
  if (authorActionRecords.length > 0) return null;

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    work_id: workId,
    session_id: readonlySessionId,
    readonly_transcript_count: shown.transcript_count,
    history_confirmation_actions_hidden: uiState.history_confirmation_actions_hidden,
    no_author_action_sent: uiState.no_author_action_sent,
    no_tool_dispatch_from_history: uiState.no_tool_dispatch_from_history,
    no_pending_artifact_from_history: uiState.no_pending_artifact_from_history,
    key_events: keyEvents,
  };
}

function findAu04CrossWorkConfirmationGuardEvidence(records) {
  const sliceId = "au04-cross-work-confirmation-guard";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.source_confirmation_visible_before_switch === true &&
      r.target_work_selected_from_real_menu === true &&
      r.target_transcript_visible === true &&
      r.source_confirmation_hidden_in_target === true &&
      r.no_author_action_sent_after_cross_work_switch === true &&
      r.no_channel_author_action_log_after_cross_work_switch === true &&
      r.no_tool_dispatch_after_cross_work_switch === true &&
      r.no_pending_artifact_after_cross_work_switch === true &&
      r.source_confirmation_restored_after_return === true &&
      Number(r.target_confirm_button_count ?? -1) === 0 &&
      Number(r.target_reject_button_count ?? -1) === 0 &&
      Number(r.author_action_sent_count ?? -1) === 0 &&
      Number(r.channel_author_action_log_count ?? -1) === 0 &&
      Number(r.toolbox_execute_after_cross_work_switch_count ?? -1) === 0 &&
      Number(r.pending_prose_fragment_after_cross_work_switch_count ?? -1) === 0,
  );
  if (!uiState) return null;

  const turnId = String(uiState.turn_id ?? "");
  const sourceWorkId = String(uiState.source_work_id ?? "");
  const targetWorkId = String(uiState.target_work_id ?? "");
  if (!turnId || !sourceWorkId || !targetWorkId || sourceWorkId === targetWorkId) return null;

  const joinedSource = records.some(
    (record) => record.event === "channel.join.done" && record.work_id === sourceWorkId,
  );
  const joinedTarget = records.some(
    (record) => record.event === "channel.join.done" && record.work_id === targetWorkId,
  );
  if (!joinedSource || !joinedTarget) return null;

  const authorActionRecords = records.filter((record) =>
    String(record.event ?? "").startsWith("channel.author_action."),
  );
  if (authorActionRecords.length > 0) return null;

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    work_id: sourceWorkId,
    source_work_id: sourceWorkId,
    target_work_id: targetWorkId,
    source_session_id: uiState.source_session_id,
    target_session_id: uiState.target_session_id,
    source_confirmation_hidden_in_target: uiState.source_confirmation_hidden_in_target,
    target_confirm_button_count: Number(uiState.target_confirm_button_count ?? 0),
    target_reject_button_count: Number(uiState.target_reject_button_count ?? 0),
    author_action_sent_count: Number(uiState.author_action_sent_count ?? 0),
    toolbox_execute_after_cross_work_switch_count: Number(
      uiState.toolbox_execute_after_cross_work_switch_count ?? 0,
    ),
    pending_prose_fragment_after_cross_work_switch_count: Number(
      uiState.pending_prose_fragment_after_cross_work_switch_count ?? 0,
    ),
    key_events: keyEvents,
  };
}

function findAu04LatestContextRebaseConfirmationEvidence(records) {
  const sliceId = "au04-latest-context-rebase-confirmation";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.real_work_renamed_before_confirm === true &&
      r.confirm_action_sent === true &&
      r.binding_ref_includes_source_work === true &&
      r.binding_ref_includes_latest_revision === true &&
      r.gate_result_ref_present === true &&
      r.trace_context_includes_renamed_title === true &&
      r.reason_codes_include_rebased_ref === true &&
      r.reason_codes_include_gate_ref === true &&
      r.confirmed_dispatch === true &&
      r.artifact_pending_after_confirm === true &&
      r.artifact_type === "character_seed" &&
      Number(r.toolbox_execute_count ?? 0) >= 1 &&
      Number(r.pending_character_seed_count ?? 0) >= 1,
  );
  if (!uiState) return null;

  const turnId = String(uiState.turn_id ?? "");
  const workId = String(uiState.work_id ?? "");
  const renamedTitle = String(uiState.renamed_title ?? "");
  const renamedRevision = Number(uiState.renamed_revision ?? 0);
  const bindingRef = String(uiState.confirmation_binding_ref ?? "");
  if (!turnId || !workId || !renamedTitle || renamedRevision <= 0 || !bindingRef) return null;

  const joined = records.some(
    (record) => record.event === "channel.join.done" && record.work_id === workId,
  );
  if (!joined) return null;

  const confirmed = records.some(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.turn_id === turnId &&
      record.action_type === "confirm_before_execute" &&
      record.action_status === "accepted",
  );
  if (!confirmed) return null;

  const toolExecuted = records.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.turn_id === turnId &&
      record.work_id === workId &&
      record.tool_name === "character_design" &&
      record.tool_outcome === "succeeded",
  );
  if (!toolExecuted) return null;

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    work_id: workId,
    session_id: uiState.session_id,
    renamed_title: renamedTitle,
    renamed_revision: renamedRevision,
    confirmation_binding_ref: bindingRef,
    trace_current_work_summary: uiState.trace_current_work_summary,
    toolbox_execute_count: Number(uiState.toolbox_execute_count ?? 0),
    pending_character_seed_count: Number(uiState.pending_character_seed_count ?? 0),
    key_events: keyEvents,
  };
}

function findP1PlanIncrementalEvidence(records) {
  const sliceId = "p1-plan-incremental";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.new_titles_disjoint === true &&
      r.originals_intact === true &&
      r.appended_in_seq_order === true &&
      Number(r.baseline_chapter_count ?? 0) >= 10 &&
      Number(r.appended_chapter_count ?? 0) >= 5 &&
      Number(r.total_chapter_count_after ?? 0) ===
        Number(r.baseline_chapter_count ?? 0) + Number(r.appended_chapter_count ?? 0),
  );
  if (!uiState) return null;

  const planTurnId = String(uiState.plan_turn_id ?? "");
  if (!planTurnId) return null;

  const turnRecords = records.filter((r) => String(r.turn_id ?? "") === planTurnId);

  // 对话框自然语言发起（非按钮路径），经 plot_outline 真实产出。
  const start = turnRecords.find(
    (r) => r.event === "channel.user_message.start" && r.generate_micro_plan === false,
  );
  if (!start) return null;

  const generated = turnRecords.find(
    (r) =>
      r.event === "toolbox.execute.done" &&
      r.tool_name === "plot_outline" &&
      r.tool_outcome === "succeeded",
  );
  if (!generated) return null;

  const accepted = records.find(
    (r) =>
      r.event === "channel.author_action.done" &&
      r.action_type === "accept" &&
      r.action_status === "accepted",
  );
  if (!accepted) return null;

  // 采纳后投影含追加章（>= baseline + appended）。
  const tocRead = records.find(
    (r) =>
      r.event === "channel.get_toc.done" &&
      r.work_id === uiState.work_id &&
      Number(r.chapter_count ?? 0) >= Number(uiState.total_chapter_count_after ?? 0),
  );
  if (!tocRead) return null;

  return {
    slice_id: sliceId,
    turn_id: planTurnId,
    turn_ids: [planTurnId],
    plan_turn_id: planTurnId,
    artifact_id: uiState.artifact_id,
    baseline_chapter_count: uiState.baseline_chapter_count,
    appended_chapter_count: uiState.appended_chapter_count,
    total_chapter_count_after: uiState.total_chapter_count_after,
    key_events: keyEvents,
  };
}

function p1PlanIncrementalBehavior(turnIds, turnRecords, records, evidence, _options) {
  if (!turnsHaveEvent([evidence.plan_turn_id], turnRecords, "toolbox.execute.done")) return null;

  const uiState = records.find(
    (r) => r.event === "slice_verify.ui_state.done" && r.slice_id === "p1-plan-incremental",
  );
  if (!uiState) return null;
  if (uiState.new_titles_disjoint !== true) return null;
  if (uiState.originals_intact !== true) return null;
  if (uiState.appended_in_seq_order !== true) return null;

  return {
    slice_id: "p1-plan-incremental",
    behavior: "incremental_outline_adoption_appends_new_planned_chapters_without_touching_existing",
    turn_ids: turnIds,
    baseline_chapter_count: evidence.baseline_chapter_count,
    appended_chapter_count: evidence.appended_chapter_count,
    assertions: [
      "natural_language_request_generates_continuing_outline",
      "adoption_appends_new_planned_chapters_with_continuing_seq",
      "existing_chapters_title_seq_word_count_untouched",
      "new_titles_do_not_collide_with_existing_chapters",
    ],
  };
}

function findVs00cCp4ChapterPlanStructureEvidence(
  records,
  sliceId = "vs00c-cp4-chapter-plan-structure",
) {
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.outline_direction_labels_present === true &&
      record.outline_adopt_clicked === true &&
      record.outline_adopted === true &&
      record.reading_projection_materialized === false &&
      record.draft_generated === true &&
      record.draft_pending === true &&
      record.draft_card_visible === true &&
      record.has_plan_summary === true &&
      record.has_plan_direction === true &&
      record.artifact_type === "prose_fragment" &&
      Number(record.chapter_count ?? 0) >= 8 &&
      Number(record.draft_body_chars ?? 0) >= 80,
  );
  if (!uiState) return null;

  const generationTurnId = String(uiState.generation_turn_id ?? "");
  const adoptionTurnId = String(uiState.adoption_turn_id ?? "");
  const draftTurnId = String(uiState.draft_turn_id ?? "");
  if (!generationTurnId || !adoptionTurnId || !draftTurnId) return null;

  const generationRecords = records.filter((record) => record.turn_id === generationTurnId);
  const draftRecords = records.filter((record) => record.turn_id === draftTurnId);

  const generatedOutline = generationRecords.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "plot_outline" &&
      record.tool_outcome === "succeeded",
  );
  if (!generatedOutline) return null;

  const adopted = generationRecords.some(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (!adopted) return null;

  const structure = draftRecords.find(
    (record) =>
      record.event === "context.structure.done" &&
      record.source_type === "structure" &&
      record.target_chapter === uiState.chapter_title &&
      record.has_plan_summary === true &&
      record.has_plan_direction === true,
  );
  if (!structure) return null;

  const generatedDraft = draftRecords.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  if (!generatedDraft) return null;

  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) >= Number(uiState.chapter_count ?? 0),
  );
  if (!tocRead) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnId,
    turn_ids: [generationTurnId, adoptionTurnId, draftTurnId],
    generation_turn_id: generationTurnId,
    adoption_turn_id: adoptionTurnId,
    draft_turn_id: draftTurnId,
    outline_artifact_id: uiState.outline_artifact_id,
    artifact_id: uiState.artifact_id,
    artifact_type: uiState.artifact_type,
    chapter_title: uiState.chapter_title,
    chapter_seq: Number(structure.chapter_seq ?? uiState.chapter_seq ?? 0),
    chapter_count: Number(uiState.chapter_count ?? 0),
    has_plan_summary: structure.has_plan_summary,
    has_plan_direction: structure.has_plan_direction,
    draft_body_chars: Number(uiState.draft_body_chars ?? 0),
    assembly_policy_id: structure.assembly_policy_id,
    key_events: keyEvents,
  };
}

function findVs00cCp5ReaderEffectBriefEvidence(records) {
  const sliceId = "vs00c-cp5-reader-effect-brief";
  const evidence = findVs00cCp4ChapterPlanStructureEvidence(records, sliceId);
  if (!evidence) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.has_reader_effect_brief === true &&
      record.reader_effect_fields_present === true &&
      Number(record.reader_effect_risk_note_count ?? 0) >= 1 &&
      record.self_report_present === true &&
      record.self_report_intended_reader_effect_present === true &&
      Array.isArray(record.self_report_used_context_refs) &&
      record.self_report_used_context_refs.includes("reader_effect_brief") &&
      Number(record.self_report_risk_flags_count ?? 0) >= 1,
  );
  if (!uiState) return null;

  const readerEffect = records.find(
    (record) =>
      record.event === "context.reader_effect.done" &&
      record.turn_id === evidence.draft_turn_id &&
      record.target_chapter === evidence.chapter_title &&
      record.has_reader_effect_brief === true &&
      record.intended_emotion_present === true &&
      record.hook_target_present === true &&
      record.payoff_or_promise_present === true &&
      record.suspense_boundary_present === true &&
      Number(record.risk_note_count ?? 0) >= 1,
  );
  if (!readerEffect) return null;

  return {
    ...evidence,
    slice_id: sliceId,
    has_reader_effect_brief: true,
    reader_effect_risk_note_count: Number(readerEffect.risk_note_count ?? 0),
    self_report_risk_flags_count: Number(uiState.self_report_risk_flags_count ?? 0),
    self_report_quality_action: uiState.self_report_quality_action,
    key_events: keyEventsForSlice(sliceId),
  };
}

function vs00cCp4ChapterPlanStructureBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 3) return null;
  if (!turnIds.includes(evidence.generation_turn_id)) return null;
  if (!turnIds.includes(evidence.draft_turn_id)) return null;
  if (
    !turnsHaveGenerateMicroPlan(
      [evidence.generation_turn_id, evidence.draft_turn_id],
      turnRecords,
      true,
    )
  ) {
    return null;
  }
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "context.assemble.done")) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "context.structure.done")) return null;
  if (
    !turnsHaveEvent(
      [evidence.generation_turn_id, evidence.draft_turn_id],
      turnRecords,
      "toolbox.execute.done",
    )
  ) {
    return null;
  }
  if (
    !lmstudioHasSteps(
      options,
      [evidence.generation_turn_id, evidence.draft_turn_id],
      ["form_frame", "form_micro_plan"],
    )
  ) {
    return null;
  }

  const structure = turnRecords.find(
    (record) =>
      record.event === "context.structure.done" &&
      record.turn_id === evidence.draft_turn_id &&
      record.target_chapter === evidence.chapter_title &&
      record.has_plan_summary === true &&
      record.has_plan_direction === true,
  );
  if (!structure) return null;

  return {
    slice_id: "vs00c-cp4-chapter-plan-structure",
    behavior: "structured_chapter_direction_materializes_and_reaches_prose_writing",
    turn_ids: turnIds,
    generation_turn_id: evidence.generation_turn_id,
    adoption_turn_id: evidence.adoption_turn_id,
    draft_turn_id: evidence.draft_turn_id,
    outline_artifact_id: evidence.outline_artifact_id,
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    chapter_title: evidence.chapter_title,
    chapter_seq: evidence.chapter_seq,
    chapter_count: evidence.chapter_count,
    draft_body_chars: evidence.draft_body_chars,
    assertions: [
      "real_archive_outline_start_planning_clicked",
      "outline_draft_generated_with_e18_e22_direction_labels",
      "outline_draft_adopted_through_author_action_boundary",
      "chapter_plan_direction_materialized_into_chapter_structure",
      "target_chapter_direction_available_before_provider_call",
      "prose_writing_generated_pending_draft_without_adoption",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_and_micro_plan_called"
        : "deterministic_provider_form_frame_and_micro_plan_called",
    ],
  };
}

function vs00cCp5ReaderEffectBriefBehavior(turnIds, turnRecords, records, evidence, options) {
  const base = vs00cCp4ChapterPlanStructureBehavior(
    turnIds,
    turnRecords,
    records,
    evidence,
    options,
  );
  if (!base) return null;

  const readerEffect = turnRecords.find(
    (record) =>
      record.event === "context.reader_effect.done" &&
      record.turn_id === evidence.draft_turn_id &&
      record.target_chapter === evidence.chapter_title &&
      record.has_reader_effect_brief === true,
  );
  if (!readerEffect) return null;

  return {
    slice_id: "vs00c-cp5-reader-effect-brief",
    behavior: "reader_effect_brief_and_self_report_reach_prose_writing",
    turn_ids: turnIds,
    generation_turn_id: evidence.generation_turn_id,
    adoption_turn_id: evidence.adoption_turn_id,
    draft_turn_id: evidence.draft_turn_id,
    outline_artifact_id: evidence.outline_artifact_id,
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    chapter_title: evidence.chapter_title,
    chapter_seq: evidence.chapter_seq,
    chapter_count: evidence.chapter_count,
    reader_effect_risk_note_count: evidence.reader_effect_risk_note_count,
    self_report_risk_flags_count: evidence.self_report_risk_flags_count,
    self_report_quality_action: evidence.self_report_quality_action,
    assertions: [
      "real_archive_outline_start_planning_clicked",
      "outline_draft_generated_with_e18_e22_direction_labels",
      "chapter_plan_direction_materialized_into_reader_effect_brief",
      "reader_effect_brief_available_before_provider_call",
      "prose_writing_output_carried_non_authoritative_self_report",
      "self_report_risk_flags_remain_quality_signal_not_adoption_fact",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_and_micro_plan_called"
        : "deterministic_provider_form_frame_and_micro_plan_called",
    ],
  };
}

function findP1ExportMinimumEvidence(records) {
  const sliceId = "p1-export-minimum";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.exported_file_exists === true &&
      r.toc_complete === true &&
      r.toc_in_order === true &&
      r.adopted_prose_in_file === true &&
      Number(r.unwritten_placeholder_count ?? -1) === 11 &&
      r.export_notice_visible === true &&
      String(r.export_path ?? "") !== "",
  );
  if (!uiState) return null;

  const draftTurnId = String(uiState.draft_turn_id ?? "");
  if (!draftTurnId) return null;

  // 导出经真实后端用例：channel.export_work.done 携带与页面一致的路径和完整目录规模。
  const exportDone = records.find(
    (r) =>
      r.event === "channel.export_work.done" &&
      r.format === "markdown" &&
      Number(r.chapter_count ?? 0) >= 10 &&
      Number(r.total_word_count ?? 0) > 0 &&
      String(r.export_path ?? "") === String(uiState.export_path),
  );
  if (!exportDone) return null;

  // 导出的正文来自已采纳事实：本链先有 prose_writing 产出 + accept 采纳。
  const generated = records.find(
    (r) =>
      r.event === "toolbox.execute.done" &&
      r.tool_name === "prose_writing" &&
      r.tool_outcome === "succeeded" &&
      String(r.turn_id ?? "") === draftTurnId,
  );
  if (!generated) return null;

  const accepted = records.find(
    (r) =>
      r.event === "channel.author_action.done" &&
      r.action_type === "accept" &&
      r.action_status === "accepted",
  );
  if (!accepted) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnId,
    turn_ids: [draftTurnId],
    draft_turn_id: draftTurnId,
    export_path: uiState.export_path,
    export_chapter_count: exportDone.chapter_count,
    export_total_word_count: exportDone.total_word_count,
    key_events: keyEvents,
  };
}

function findAu08ReadingReadonlyNoWriteEvidence(records) {
  const sliceId = "au08-reading-readonly-no-write";
  const keyEvents = keyEventsForSlice(sliceId);
  const base = findP1ChapterAdoptionReadingEvidence(records, sliceId);
  if (!base) return null;

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.reading_mode_visible_before_export === true &&
      r.reading_write_controls_hidden === true &&
      r.chat_input_absent_in_reading === true &&
      r.real_export_button_clicked === true &&
      r.export_done === true &&
      r.no_author_action_sent_during_reading === true &&
      r.no_user_message_sent_during_reading === true &&
      r.no_channel_author_action_log_during_reading === true &&
      r.no_adoption_event_during_reading === true &&
      r.no_tool_dispatch_during_reading === true &&
      r.no_production_write_claim_during_reading === true &&
      r.returned_to_workbench === true &&
      r.chat_input_enabled_after_return === true &&
      r.send_button_enabled_after_return === true,
  );
  if (!uiState) return null;

  const exportDone = records.find(
    (r) =>
      r.event === "channel.export_work.done" &&
      String(r.export_path ?? "") === String(uiState.export_path ?? "") &&
      Number(r.chapter_count ?? 0) >= 1,
  );
  if (!exportDone) return null;

  return {
    ...base,
    slice_id: sliceId,
    export_path: uiState.export_path,
    export_chapter_count: exportDone.chapter_count,
    reading_write_control_count: Number(uiState.reading_write_control_count ?? 0),
    author_action_sent_count_during_reading: Number(
      uiState.author_action_sent_count_during_reading ?? -1,
    ),
    user_message_sent_count_during_reading: Number(
      uiState.user_message_sent_count_during_reading ?? -1,
    ),
    toolbox_execute_count_during_reading: Number(
      uiState.toolbox_execute_count_during_reading ?? -1,
    ),
    key_events: keyEvents,
  };
}

function findAu08ReadingReturnContextEvidence(records) {
  const sliceId = "au08-reading-return-context";
  const keyEvents = keyEventsForSlice(sliceId);
  const base = findP1ChapterAdoptionReadingEvidence(records, sliceId);
  if (!base) return null;

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.returned_to_workbench === true &&
      r.workbench_visible_after_return === true &&
      r.chat_input_enabled_after_return === true &&
      r.send_button_enabled_after_return === true &&
      r.no_author_action_sent_on_return === true &&
      r.no_user_message_sent_on_return === true &&
      r.followup_user_message_sent === true &&
      r.followup_turn_result_received === true &&
      r.followup_channel_done_same_scope === true &&
      r.followup_visible_in_transcript === true &&
      r.work_id_preserved_after_return === true &&
      r.session_id_preserved_after_return === true,
  );
  if (!uiState) return null;

  const followupTurnId = String(uiState.followup_turn_id ?? "");
  const workId = String(uiState.work_id ?? "");
  const sessionId = String(uiState.session_id ?? "");
  if (!followupTurnId || !workId || !sessionId) return null;

  const followupStart = records.find(
    (r) =>
      r.event === "channel.user_message.start" &&
      r.turn_id === followupTurnId &&
      r.work_id === workId &&
      r.session_id === sessionId,
  );
  if (!followupStart) return null;

  const followupDone = records.find(
    (r) =>
      r.event === "channel.user_message.done" &&
      r.turn_id === followupTurnId &&
      r.work_id === workId &&
      r.session_id === sessionId,
  );
  if (!followupDone) return null;

  return {
    ...base,
    slice_id: sliceId,
    turn_id: followupTurnId,
    turn_ids: [base.draft_turn_id, base.adopt_turn_id, followupTurnId].filter(Boolean),
    work_id: workId,
    session_id: sessionId,
    draft_turn_id: base.draft_turn_id,
    adopt_turn_id: base.adopt_turn_id,
    followup_turn_id: followupTurnId,
    followup_user_message_text: uiState.followup_user_message_text,
    key_events: keyEvents,
  };
}

function p1ExportMinimumBehavior(turnIds, turnRecords, records, evidence, _options) {
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "toolbox.execute.done")) return null;

  const uiState = records.find(
    (r) => r.event === "slice_verify.ui_state.done" && r.slice_id === "p1-export-minimum",
  );
  if (!uiState) return null;
  if (uiState.toc_complete !== true) return null;
  if (uiState.toc_in_order !== true) return null;
  if (uiState.adopted_prose_in_file !== true) return null;
  if (Number(uiState.unwritten_placeholder_count ?? -1) !== 11) return null;

  return {
    slice_id: "p1-export-minimum",
    behavior: "full_book_markdown_export_with_ordered_toc_and_honest_placeholders",
    turn_ids: turnIds,
    export_path: evidence.export_path,
    export_chapter_count: evidence.export_chapter_count,
    assertions: [
      "export_button_in_reading_mode_produces_real_markdown_file",
      "exported_toc_lists_all_planned_chapters_in_seq_order",
      "adopted_chapter_prose_present_in_exported_file",
      "unwritten_chapters_get_honest_placeholders_not_fabricated_prose",
      "export_reads_accepted_work_facts_only",
    ],
  };
}

function au08ReadingReadonlyNoWriteBehavior(turnIds, turnRecords, records, evidence, _options) {
  const base = p1ChapterAdoptionReadingBehavior(
    turnIds,
    turnRecords,
    records,
    evidence,
    _options,
    "au08-reading-readonly-no-write",
  );
  if (!base) return null;

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === "au08-reading-readonly-no-write",
  );
  if (!uiState) return null;
  if (uiState.reading_write_controls_hidden !== true) return null;
  if (uiState.chat_input_absent_in_reading !== true) return null;
  if (uiState.no_author_action_sent_during_reading !== true) return null;
  if (uiState.no_user_message_sent_during_reading !== true) return null;
  if (uiState.no_adoption_event_during_reading !== true) return null;
  if (uiState.no_tool_dispatch_during_reading !== true) return null;
  if (uiState.no_production_write_claim_during_reading !== true) return null;
  if (uiState.returned_to_workbench !== true) return null;

  return {
    slice_id: "au08-reading-readonly-no-write",
    behavior: "reading_mode_view_export_and_return_stay_readonly_without_write_controls",
    turn_ids: turnIds,
    draft_turn_id: evidence.draft_turn_id,
    adopt_turn_id: evidence.adopt_turn_id,
    export_path: evidence.export_path,
    export_chapter_count: evidence.export_chapter_count,
    assertions: [
      ...(base.assertions ?? []),
      "reading_mode_exposes_no_adoption_confirmation_or_chat_write_controls",
      "reading_mode_export_uses_readonly_export_work_channel",
      "reading_mode_export_and_return_emit_no_author_action_or_user_message",
      "reading_mode_export_and_return_do_not_trigger_adoption_or_tool_execution",
      "reading_mode_export_and_return_do_not_claim_production_write",
      "workbench_context_returns_with_input_enabled_after_reading",
    ],
  };
}

function au08ReadingReturnContextBehavior(turnIds, turnRecords, records, evidence, _options) {
  const base = p1ChapterAdoptionReadingBehavior(
    turnIds,
    turnRecords,
    records,
    evidence,
    _options,
    "au08-reading-return-context",
  );
  if (!base) return null;

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === "au08-reading-return-context",
  );
  if (!uiState) return null;
  if (uiState.returned_to_workbench !== true) return null;
  if (uiState.work_id_preserved_after_return !== true) return null;
  if (uiState.session_id_preserved_after_return !== true) return null;
  if (uiState.followup_channel_done_same_scope !== true) return null;

  return {
    slice_id: "au08-reading-return-context",
    behavior: "reading_return_preserves_workbench_work_and_session_for_followup_turn",
    turn_ids: turnIds,
    draft_turn_id: evidence.draft_turn_id,
    adopt_turn_id: evidence.adopt_turn_id,
    followup_turn_id: evidence.followup_turn_id,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      ...(base.assertions ?? []),
      "reading_mode_return_button_restores_real_workbench",
      "return_to_workbench_emits_no_author_action_or_user_message",
      "followup_message_after_return_uses_same_work_id",
      "followup_message_after_return_uses_same_session_id",
      "followup_turn_result_received_in_same_session",
      "return_does_not_create_new_work_or_session",
    ],
  };
}

function au04ConfirmBeforeExecuteBehavior(turnIds, turnRecords, records, evidence, _options) {
  if (!turnsHaveEvent([evidence.confirm_turn_id], turnRecords, "toolbox.execute.done")) {
    return null;
  }

  const uiState = records.find(
    (r) => r.event === "slice_verify.ui_state.done" && r.slice_id === "au04-confirm-before-execute",
  );
  if (!uiState) return null;
  if (uiState.tool_called_before_confirm !== false) return null;
  if (uiState.production_write_before_confirm !== false) return null;
  if (uiState.confirmation_card_detail_visible !== true) return null;
  if (uiState.confirmation_card_target_visible !== true) return null;
  if (uiState.confirmation_card_no_write_visible !== true) return null;
  if (uiState.confirmation_card_re_gate_visible !== true) return null;
  if (uiState.confirmed_dispatch !== true) return null;
  if (uiState.artifact_pending_after_confirm !== true) return null;

  return {
    slice_id: "au04-confirm-before-execute",
    behavior: "high_risk_user_turn_requires_confirmation_then_binding_re_gate_executes_tentatively",
    turn_ids: turnIds,
    artifact_id: evidence.artifact_id,
    confirm_action_behavior_ref: evidence.confirm_action_behavior_ref,
    assertions: [
      "high_risk_rewrite_blocked_with_confirmation_card_over_real_wire",
      "confirmation_card_explains_target_no_write_and_re_gate_in_real_workbench",
      "no_tool_call_or_production_write_before_confirm",
      "confirm_action_bound_to_open_confirmation_behavior",
      "re_gate_allows_and_dispatches_prose_writing_same_turn",
      "executed_output_stays_tentative_pending_adoption",
    ],
  };
}

function au04ConfirmIdempotencyUiBehavior(turnIds, turnRecords, records, evidence, _options) {
  if (!turnsHaveEvent([evidence.confirm_turn_id], turnRecords, "toolbox.execute.done")) {
    return null;
  }

  const uiState = records.find(
    (r) => r.event === "slice_verify.ui_state.done" && r.slice_id === "au04-confirm-idempotency-ui",
  );
  if (!uiState) return null;
  if (uiState.confirm_double_click_attempted !== true) return null;
  if (uiState.duplicate_suppressed_or_deduped !== true) return null;
  if (Number(uiState.non_duplicate_author_action_done_count ?? 0) !== 1) return null;
  if (Number(uiState.toolbox_execute_count ?? 0) !== 1) return null;
  if (Number(uiState.pending_prose_fragment_count ?? 0) !== 1) return null;
  if (uiState.no_duplicate_tool_dispatch !== true) return null;
  if (uiState.single_pending_artifact_after_confirm !== true) return null;

  return {
    slice_id: "au04-confirm-idempotency-ui",
    behavior: "rapid_confirm_click_is_suppressed_or_deduped_without_duplicate_execution",
    turn_ids: turnIds,
    artifact_id: evidence.artifact_id,
    confirm_action_behavior_ref: evidence.confirm_action_behavior_ref,
    sent_confirm_action_count: evidence.sent_confirm_action_count,
    duplicate_author_action_done_count: evidence.duplicate_author_action_done_count,
    duplicate_action_result_count: evidence.duplicate_action_result_count,
    assertions: [
      "real_workbench_attempted_rapid_confirm_from_visible_confirmation_card",
      "action_boundary_accepted_exactly_one_non_duplicate_confirmation",
      "duplicate_confirm_was_suppressed_or_reported_as_duplicate",
      "re_gate_dispatched_prose_writing_exactly_once",
      "executed_output_stayed_single_tentative_pending_artifact",
    ],
  };
}

function au04StaleConfirmationUiBehavior(turnIds, _turnRecords, records, evidence, _options) {
  const uiState = records.find(
    (r) => r.event === "slice_verify.ui_state.done" && r.slice_id === "au04-stale-confirmation-ui",
  );
  if (!uiState) return null;
  if (uiState.followup_advanced_current_turn !== true) return null;
  if (uiState.stale_confirm_prevented !== true) return null;
  if (uiState.no_tool_dispatch_after_stale !== true) return null;
  if (uiState.no_pending_artifact_after_stale !== true) return null;
  if (Number(uiState.toolbox_execute_after_stale_count ?? 0) !== 0) return null;
  if (Number(uiState.pending_prose_fragment_after_stale_count ?? 0) !== 0) return null;

  return {
    slice_id: "au04-stale-confirmation-ui",
    behavior: "stale_confirmation_after_context_change_cannot_execute_tool_or_create_draft",
    turn_ids: turnIds,
    confirm_action_behavior_ref: evidence.confirm_action_behavior_ref,
    stale_confirm_visible: evidence.stale_confirm_visible,
    stale_confirm_click_attempted: evidence.stale_confirm_click_attempted,
    stale_confirm_action_sent: evidence.stale_confirm_action_sent,
    stale_confirm_rejected: evidence.stale_confirm_rejected,
    author_action_error_count: evidence.author_action_error_count,
    assertions: [
      "real_workbench_received_high_risk_confirmation_card",
      "a_followup_user_message_advanced_the_current_turn_before_confirmation",
      "old_confirmation_was_hidden_disabled_or_rejected_as_stale",
      "stale_confirmation_did_not_dispatch_prose_writing",
      "stale_confirmation_did_not_create_pending_prose_fragment",
    ],
  };
}

function au06SingleActiveConfirmationBehavior(turnIds, _turnRecords, records, evidence, _options) {
  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === "au06-single-active-confirmation",
  );
  if (!uiState) return null;
  if (uiState.distinct_behavior_refs !== true) return null;
  if (uiState.second_confirmation_advanced_current_turn !== true) return null;
  if (uiState.old_confirm_prevented !== true) return null;
  if (uiState.no_tool_dispatch_after_old !== true) return null;
  if (uiState.no_pending_artifact_after_old !== true) return null;
  if (uiState.latest_confirm_dispatched !== true) return null;
  if (uiState.second_turn_behavior_context_ref_visible !== true) return null;
  if (uiState.second_turn_behavior_context_author_safe !== true) return null;
  if (String(uiState.second_turn_behavior_context_summary ?? "") === "") return null;
  if (
    String(uiState.second_turn_behavior_context_source_id ?? "") !== "behavior_summary" &&
    String(uiState.second_turn_behavior_context_ref ?? "") === ""
  ) {
    return null;
  }
  if (Number(uiState.toolbox_execute_after_old_count ?? 0) !== 0) return null;
  if (Number(uiState.pending_prose_fragment_after_old_count ?? 0) !== 0) return null;
  if (Number(uiState.latest_toolbox_execute_count ?? 0) !== 1) return null;

  return {
    slice_id: "au06-single-active-confirmation",
    behavior: "new_confirmation_supersedes_old_author_blocking_behavior_without_old_execution",
    turn_ids: turnIds,
    first_confirm_action_behavior_ref: evidence.first_confirm_action_behavior_ref,
    second_confirm_action_behavior_ref: evidence.second_confirm_action_behavior_ref,
    second_turn_behavior_context_ref_visible: evidence.second_turn_behavior_context_ref_visible,
    second_turn_behavior_context_author_safe: evidence.second_turn_behavior_context_author_safe,
    second_turn_behavior_context_summary: evidence.second_turn_behavior_context_summary,
    second_turn_behavior_context_redaction_level:
      evidence.second_turn_behavior_context_redaction_level,
    second_turn_behavior_context_ref: evidence.second_turn_behavior_context_ref,
    second_turn_behavior_context_source_id: evidence.second_turn_behavior_context_source_id,
    old_confirm_prevented: evidence.old_confirm_prevented,
    old_confirm_rejected: evidence.old_confirm_rejected,
    old_author_action_error_count: evidence.old_author_action_error_count,
    latest_toolbox_execute_count: evidence.latest_toolbox_execute_count,
    assertions: [
      "first_high_risk_turn_opened_confirmation_in_real_workbench",
      "second_high_risk_turn_advanced_to_a_distinct_active_confirmation",
      "old_confirmation_was_hidden_disabled_or_rejected_as_stale",
      "old_confirmation_did_not_dispatch_tool_or_create_pending_draft",
      "latest_confirmation_remained_actionable_and_executed_once",
      "second_turn_received_author_safe_behavior_context_ref",
    ],
  };
}

function au04ConfirmationTtlUiBehavior(turnIds, _turnRecords, records, evidence, _options) {
  const uiState = records.find(
    (r) => r.event === "slice_verify.ui_state.done" && r.slice_id === "au04-confirmation-ttl-ui",
  );
  if (!uiState) return null;
  if (uiState.confirmation_card_restored !== true) return null;
  if (uiState.expired_confirm_click_attempted !== true) return null;
  if (uiState.expired_confirm_action_sent !== true) return null;
  if (uiState.expired_confirm_rejected !== true) return null;
  if (uiState.no_tool_dispatch_after_expired !== true) return null;
  if (uiState.no_pending_artifact_after_expired !== true) return null;
  if (Number(uiState.toolbox_execute_after_expired_count ?? 0) !== 0) return null;
  if (Number(uiState.pending_prose_fragment_after_expired_count ?? 0) !== 0) return null;

  return {
    slice_id: "au04-confirmation-ttl-ui",
    behavior: "expired_confirmation_cannot_execute_tool_or_create_draft",
    turn_ids: turnIds,
    expired_confirm_action_sent: evidence.expired_confirm_action_sent,
    expired_confirm_rejected: evidence.expired_confirm_rejected,
    author_action_error_count: evidence.author_action_error_count,
    assertions: [
      "expired_confirmation_card_restored_in_real_workbench",
      "real_workbench_sent_expired_confirm_author_action",
      "action_boundary_rejected_expired_confirmation",
      "expired_confirmation_did_not_dispatch_prose_writing",
      "expired_confirmation_did_not_create_pending_prose_fragment",
    ],
  };
}

function au04ConfirmationToolFailureRecoveryBehavior(
  turnIds,
  _turnRecords,
  records,
  evidence,
  _options,
) {
  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === "au04-confirmation-tool-failure-recovery",
  );
  if (!uiState) return null;
  if (uiState.confirmation_card_received !== true) return null;
  if (uiState.confirm_action_sent !== true) return null;
  if (uiState.confirm_action_acknowledged !== true) return null;
  if (uiState.confirmed_dispatch_attempted !== true) return null;
  if (uiState.confirmed_turn_failed !== true) return null;
  if (uiState.failure_message_visible !== true) return null;
  if (uiState.no_pending_artifact_after_failure !== true) return null;
  if (uiState.no_production_write_after_failure !== true) return null;
  if (uiState.no_successful_tool_dispatch_after_failure !== true) return null;
  if (Number(uiState.provider_error_count ?? 0) < 1) return null;
  if (Number(uiState.toolbox_execute_error_count ?? 0) < 1) return null;
  if (Number(uiState.pending_prose_fragment_after_failure_count ?? 0) !== 0) return null;

  return {
    slice_id: "au04-confirmation-tool-failure-recovery",
    behavior: "confirmed_tool_failure_recovers_without_pending_draft_or_production_write",
    turn_ids: turnIds,
    confirm_action_behavior_ref: evidence.confirm_action_behavior_ref,
    failed_tool_name: evidence.failed_tool_name,
    failed_tool_status: evidence.failed_tool_status,
    provider_error_count: evidence.provider_error_count,
    toolbox_execute_error_count: evidence.toolbox_execute_error_count,
    assertions: [
      "real_workbench_received_high_risk_confirmation_card",
      "confirm_before_execute_was_sent_as_author_action",
      "confirmation_re_gate_attempted_tool_dispatch",
      "provider_failure_returned_failed_tool_result",
      "ui_rendered_author_readable_failure_message",
      "failed_confirmation_execution_created_no_pending_draft",
      "failed_confirmation_execution_claimed_no_production_write",
    ],
  };
}

function au04DisabledConfirmationActionUiBehavior(
  turnIds,
  _turnRecords,
  records,
  evidence,
  _options,
) {
  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === "au04-disabled-confirmation-action-ui",
  );
  if (!uiState) return null;
  if (uiState.confirmation_card_restored !== true) return null;
  if (uiState.disabled_confirm_visible !== true) return null;
  if (uiState.disabled_confirm_disabled !== true) return null;
  if (uiState.disabled_reason_visible_via_title !== true) return null;
  if (uiState.reject_action_still_enabled !== true) return null;
  if (uiState.disabled_click_blocked_by_browser !== true) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_channel_author_action_log !== true) return null;
  if (uiState.no_tool_dispatch_after_disabled_attempt !== true) return null;
  if (uiState.no_pending_artifact_after_disabled_attempt !== true) return null;
  if (Number(uiState.author_action_sent_count ?? 0) !== 0) return null;
  if (Number(uiState.toolbox_execute_after_disabled_attempt_count ?? 0) !== 0) return null;
  if (Number(uiState.pending_prose_fragment_after_disabled_attempt_count ?? 0) !== 0) return null;

  return {
    slice_id: "au04-disabled-confirmation-action-ui",
    behavior: "disabled_confirmation_action_is_visible_but_not_submittable",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    disabled_confirm_title: evidence.disabled_confirm_title,
    assertions: [
      "restored_confirmation_card_visible_in_real_workbench",
      "confirm_before_execute_button_was_visible_but_disabled",
      "disabled_reason_was_exposed_on_the_user_visible_action",
      "reject_action_remained_available",
      "disabled_confirm_attempt_did_not_send_author_action",
      "disabled_confirm_attempt_did_not_reach_channel_action_boundary",
      "disabled_confirm_attempt_did_not_dispatch_tool",
      "disabled_confirm_attempt_did_not_create_pending_draft",
    ],
  };
}

function au04HistoryConfirmationReadonlyBehavior(
  turnIds,
  _turnRecords,
  records,
  evidence,
  _options,
) {
  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === "au04-history-confirmation-readonly",
  );
  if (!uiState) return null;
  if (uiState.readonly_opened_from_real_workbench !== true) return null;
  if (uiState.history_confirmation_transcript_visible !== true) return null;
  if (uiState.history_confirmation_actions_hidden !== true) return null;
  if (uiState.readonly_input_disabled !== true) return null;
  if (uiState.readonly_send_disabled !== true) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_channel_author_action_log !== true) return null;
  if (uiState.no_tool_dispatch_from_history !== true) return null;
  if (uiState.no_pending_artifact_from_history !== true) return null;
  if (uiState.active_session_restored !== true) return null;

  return {
    slice_id: "au04-history-confirmation-readonly",
    behavior: "history_confirmation_readonly_cannot_execute_tool_or_create_draft",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    readonly_transcript_count: evidence.readonly_transcript_count,
    assertions: [
      "historical_confirmation_transcript_opened_from_real_workbench",
      "exited_session_opened_as_read_only",
      "confirmation_actions_hidden_in_history_view",
      "readonly_history_did_not_send_author_action",
      "readonly_history_did_not_dispatch_tool",
      "readonly_history_did_not_create_pending_draft",
      "active_session_view_can_be_restored",
    ],
  };
}

function au04CrossWorkConfirmationGuardBehavior(
  turnIds,
  _turnRecords,
  records,
  evidence,
  _options,
) {
  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === "au04-cross-work-confirmation-guard",
  );
  if (!uiState) return null;
  if (uiState.source_confirmation_visible_before_switch !== true) return null;
  if (uiState.target_work_selected_from_real_menu !== true) return null;
  if (uiState.source_confirmation_hidden_in_target !== true) return null;
  if (uiState.no_author_action_sent_after_cross_work_switch !== true) return null;
  if (uiState.no_channel_author_action_log_after_cross_work_switch !== true) return null;
  if (uiState.no_tool_dispatch_after_cross_work_switch !== true) return null;
  if (uiState.no_pending_artifact_after_cross_work_switch !== true) return null;
  if (uiState.source_confirmation_restored_after_return !== true) return null;

  return {
    slice_id: "au04-cross-work-confirmation-guard",
    behavior: "cross_work_switch_hides_source_confirmation_without_action_or_draft",
    turn_ids: turnIds,
    source_work_id: evidence.source_work_id,
    target_work_id: evidence.target_work_id,
    assertions: [
      "source_work_confirmation_card_visible_before_switch",
      "target_work_selected_through_real_work_menu",
      "source_confirmation_not_visible_or_actionable_in_target_work",
      "cross_work_switch_did_not_send_author_action",
      "cross_work_switch_did_not_dispatch_tool",
      "cross_work_switch_did_not_create_pending_draft",
      "source_confirmation_restored_when_returning_to_source_work",
    ],
  };
}

function au04LatestContextRebaseConfirmationBehavior(
  turnIds,
  turnRecords,
  records,
  evidence,
  _options,
) {
  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === "au04-latest-context-rebase-confirmation",
  );
  if (!uiState) return null;
  if (uiState.real_work_renamed_before_confirm !== true) return null;
  if (uiState.binding_ref_includes_latest_revision !== true) return null;
  if (uiState.trace_context_includes_renamed_title !== true) return null;
  if (uiState.reason_codes_include_rebased_ref !== true) return null;
  if (uiState.reason_codes_include_gate_ref !== true) return null;
  if (uiState.confirmed_dispatch !== true) return null;
  if (uiState.artifact_pending_after_confirm !== true) return null;
  if (!turnsHaveEvent([evidence.turn_id], turnRecords, "toolbox.execute.done")) return null;

  return {
    slice_id: "au04-latest-context-rebase-confirmation",
    behavior: "confirmation_re_gate_rebases_against_latest_work_snapshot",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    renamed_title: evidence.renamed_title,
    renamed_revision: evidence.renamed_revision,
    confirmation_binding_ref: evidence.confirmation_binding_ref,
    assertions: [
      "real_workbench_restored_confirmation_card",
      "work_was_renamed_through_real_work_menu_before_confirmation",
      "confirmation_binding_ref_included_latest_work_revision",
      "confirmed_turn_trace_current_work_summary_included_renamed_title",
      "confirmed_turn_reason_codes_recorded_rebased_snapshot_and_gate_ref",
      "re_gate_dispatched_tool_and_left_output_pending_adoption",
    ],
  };
}

function p1ChapterWordCountTargetBehavior(turnIds, turnRecords, records, evidence, options) {
  const base = p1ChapterAdoptionReadingBehavior(
    turnIds,
    turnRecords,
    records,
    evidence,
    options,
    "p1-chapter-word-count-target",
    false,
  );
  if (!base) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "p1-chapter-word-count-target" &&
      record.draft_turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;
  if (uiState.word_count_meets_target !== true) return null;

  return {
    ...base,
    slice_id: "p1-chapter-word-count-target",
    behavior: "author_target_word_count_recognized_and_chapter_length_approaches_target",
    target_word_count_requested: evidence.target_word_count_requested,
    chapter_word_count: evidence.chapter_word_count,
    assertions: [
      ...(base.assertions ?? []),
      "author_target_word_count_flows_into_execution_chain",
      "adopted_chapter_effective_word_count_approaches_requested_target",
    ],
  };
}

function p1WordCountAuditBehavior(turnIds, turnRecords, records, evidence, options) {
  const base = p1ChapterAdoptionReadingBehavior(
    turnIds,
    turnRecords,
    records,
    evidence,
    options,
    "p1-word-count-audit",
  );
  if (!base) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "p1-word-count-audit" &&
      record.draft_turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;
  if (uiState.short_chapter_marked !== true) return null;
  if (uiState.milestone_met !== false) return null;

  return {
    ...base,
    slice_id: "p1-word-count-audit",
    behavior: "sub_minimum_adopted_chapter_marked_short_and_milestone_not_met",
    short_chapter_marked: true,
    milestone_met: false,
    assertions: [
      ...(base.assertions ?? []),
      "sub_1000_word_chapter_marked_short_in_toc",
      "p1_milestone_progress_visible_not_met",
    ],
  };
}

function p1ChapterAdoptionReadingBehavior(
  turnIds,
  turnRecords,
  records,
  evidence,
  _options,
  sliceId = "p1-chapter-adoption-reading",
  expectMicroPlan = true,
) {
  if (!turnsHaveGenerateMicroPlan([evidence.draft_turn_id], turnRecords, expectMicroPlan)) {
    return null;
  }
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "toolbox.execute.done")) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.draft_turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;
  if (uiState.word_count_matches_adopted_prose !== true) return null;
  if (Number(uiState.chapter_word_count ?? 0) !== Number(uiState.expected_word_count ?? -1)) {
    return null;
  }
  if (Number(uiState.total_word_count ?? 0) !== Number(uiState.chapter_word_count ?? -1)) {
    return null;
  }

  return {
    slice_id: sliceId,
    behavior: "adopted_prose_materializes_reading_projection_with_effective_word_counts",
    turn_ids: turnIds,
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    chapter_title: evidence.chapter_title,
    total_word_count: Number(uiState.total_word_count ?? 0),
    chapter_word_count: Number(uiState.chapter_word_count ?? 0),
    expected_word_count: Number(uiState.expected_word_count ?? 0),
    content_chars: evidence.content_chars,
    assertions: [
      "chapter_draft_generated_from_adopted_plan",
      "author_clicked_accept_from_real_workbench",
      "accept_author_action_routed_through_adoption_boundary",
      "accept_button_cleared_after_adoption_no_resubmit",
      "adopted_prose_materialized_reading_projection",
      "reading_mode_loaded_toc_and_chapter_content_from_channel",
      "book_total_effective_word_count_visible_and_positive",
      "chapter_effective_word_count_visible_and_positive",
      "displayed_word_count_equals_effective_count_of_adopted_prose",
      "projection_ref_emitted_with_stale_refresh_status",
      "reading_mode_stale_projection_banner_visible",
      "reading_mode_refresh_button_visible",
    ],
  };
}

function au07StateTraceAdoptionReplayBehavior(turnIds, turnRecords, records, evidence, options) {
  const base = p1ChapterAdoptionReadingBehavior(
    turnIds,
    turnRecords,
    records,
    evidence,
    options,
    "au07-state-trace-adoption-replay",
    true,
  );
  if (!base) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au07-state-trace-adoption-replay" &&
      record.draft_turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;

  return {
    ...base,
    slice_id: "au07-state-trace-adoption-replay",
    behavior: "adoption_and_reading_projection_replayable_from_state_trace_refs",
    turn_ids: evidence.turn_ids,
    adopt_turn_id: evidence.adopt_turn_id,
    state_trace_ref: evidence.state_trace_ref,
    adoption_trace_ref: evidence.adoption_trace_ref,
    projection_source_state_trace_ref: evidence.projection_source_state_trace_ref,
    assertions: [
      ...(base.assertions ?? []),
      "adoption_turn_trace_summary_recorded_state_trace_ref",
      "resolved_adoption_entry_references_same_state_trace",
      "projection_ref_references_same_source_state_trace",
      "state_trace_ref_is_bound_to_action_turn_trace_ref",
    ],
  };
}

function au05DiscardAuthorActionBehavior(turnIds, turnRecords, records, evidence, _options) {
  if (!turnsHaveGenerateMicroPlan([evidence.draft_turn_id], turnRecords, true)) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "toolbox.execute.done")) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au05-discard-author-action" &&
      record.draft_turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;
  if (uiState.discard_action_sent !== true) return null;
  if (uiState.action_result_status !== "discarded") return null;
  if (uiState.artifact_discarded !== true) return null;
  if (uiState.artifact_adopted !== false) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.discard_button_cleared_after_discard !== true) return null;
  if (uiState.reading_mode_empty_after_discard !== true) return null;
  if (uiState.draft_not_visible_in_reading !== true) return null;

  return {
    slice_id: "au05-discard-author-action",
    behavior: "discard_author_action_resolves_pending_artifact_without_production_write",
    turn_ids: turnIds,
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    chapter_title: evidence.chapter_title,
    chapter_count_after_discard: evidence.chapter_count_after_discard,
    total_word_count_after_discard: evidence.total_word_count_after_discard,
    content_chars_after_discard: evidence.content_chars_after_discard,
    assertions: [
      "chapter_draft_generated_from_adopted_plan",
      "author_clicked_discard_from_real_workbench",
      "discard_author_action_routed_through_adoption_boundary",
      "discard_resolved_artifact_as_discarded",
      "discard_did_not_adopt_artifact_or_write_production_state",
      "discard_button_cleared_after_resolution_no_resubmit",
      "discarded_draft_did_not_materialize_reading_projection",
      "reading_mode_loaded_planned_chapter_without_adopted_content_after_discard",
    ],
  };
}

function au10WorkbenchMatrixLayoutBehavior(_turnIds, _turnRecords, records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au10-workbench-matrix-layout" &&
      Array.isArray(record.matrix_phases),
  );
  if (!uiState) return null;
  if (Number(uiState.viewport_width ?? 0) !== 1280) return null;
  if (Number(uiState.viewport_height ?? 0) !== 800) return null;
  if (uiState.layout_no_horizontal_overflow !== true) return null;
  if (uiState.top_bar_single_row !== true) return null;
  if (uiState.input_area_visible !== true) return null;
  if (uiState.service_status_visible !== true) return null;
  if (uiState.provider_status_visible !== true) return null;
  if (uiState.task_status_visible !== true) return null;
  if (uiState.trace_why_dialog_open !== true) return null;
  if (uiState.trace_why_contains_raw_prompt === true) return null;
  if (uiState.candidate_selected !== true || uiState.candidate_adopted !== true) return null;
  if (uiState.adoption_reading_completed !== true) return null;
  if (uiState.word_count_matches_adopted_prose !== true) return null;

  const phases = uiState.matrix_phases ?? [];
  for (const phase of ["ordinary_turn", "candidate_action", "adoption_reading"]) {
    if (!phases.includes(phase)) return null;
  }

  return {
    slice_id: "au10-workbench-matrix-layout",
    behavior: "workbench_matrix_layout_covers_core_real_ui_states",
    turn_ids: evidence.turn_ids,
    viewport: `${uiState.viewport_width}x${uiState.viewport_height}`,
    artifact_id: evidence.artifact_id,
    candidate_ref: evidence.candidate_ref,
    assertions: [
      "real_workbench_rendered_at_1280x800_without_horizontal_overflow",
      "top_status_bar_stayed_single_row",
      "input_area_and_structure_rail_remained_visible",
      "ordinary_chat_completed_without_micro_plan",
      "author_opened_trace_why_dialog_without_raw_prompt_leak",
      "candidate_action_used_server_authorized_author_action",
      "candidate_selection_did_not_write_production_content",
      "prose_draft_accept_used_adoption_boundary",
      "reading_projection_loaded_adopted_prose_and_word_counts",
      "task_status_baseline_visible_in_first_viewport",
    ],
  };
}

function au10WorkbenchRecoveryTaskstateBehavior(
  _turnIds,
  _turnRecords,
  records,
  evidence,
  _options,
) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au10-workbench-recovery-taskstate" &&
      record.task_id === evidence.task_id,
  );
  if (!uiState) return null;
  if (uiState.export_success_visible !== true) return null;
  if (uiState.export_path_visible !== true) return null;
  if (uiState.real_export_button_clicked !== true) return null;
  if (uiState.real_workbench_completed_status_visible !== true) return null;

  const phases = uiState.task_state_phases ?? [];
  for (const phase of ["RUNNING", "CHECKPOINT", "COMPLETED"]) {
    if (!phases.includes(phase)) return null;
  }

  return {
    slice_id: "au10-workbench-recovery-taskstate",
    behavior: "export_action_streams_task_state_lifecycle_to_real_workbench",
    turn_ids: evidence.turn_ids,
    task_id: evidence.task_id,
    task_type: evidence.task_type,
    artifact_id: evidence.artifact_id,
    task_state_phases: phases,
    assertions: [
      "author_clicked_real_export_button_from_reading_mode",
      "export_action_broadcast_running_task_state",
      "export_action_broadcast_checkpoint_task_state",
      "export_action_broadcast_completed_task_state",
      "workspace_status_bar_kept_completed_task_visible_after_return",
      "task_state_was_observed_through_websocket_frames",
      "export_result_path_was_visible_to_author",
    ],
  };
}

function au10WorkbenchRecoveryDisconnectTimeoutBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au10-workbench-recovery-disconnect-timeout" &&
      record.failure_turn_id === evidence.failure_turn_id &&
      record.recovery_turn_id === evidence.recovery_turn_id,
  );
  if (!uiState) return null;
  if (uiState.failure_message_visible !== true) return null;
  if (uiState.no_production_write_on_failure !== true) return null;
  if (uiState.no_artifact_adopted_on_failure !== true) return null;
  if (uiState.loading_cleared_after_failure !== true) return null;
  if (uiState.input_enabled_after_failure !== true) return null;
  if (uiState.following_turn_completed !== true) return null;
  if (uiState.failure_prompt_sent !== true) return null;
  if (uiState.recovery_prompt_sent !== true) return null;

  return {
    slice_id: "au10-workbench-recovery-disconnect-timeout",
    behavior: "provider_failure_clears_loading_and_allows_following_turn",
    turn_ids: evidence.turn_ids,
    failure_turn_id: evidence.failure_turn_id,
    recovery_turn_id: evidence.recovery_turn_id,
    failing_provider: evidence.failing_provider,
    recovery_provider: evidence.recovery_provider,
    assertions: [
      "provider_failure_returned_error_turn_result",
      "failure_message_told_author_no_artifact_or_production_write_happened",
      "workspace_loading_indicator_cleared_after_failure",
      "input_remained_available_after_failure",
      "author_sent_following_message_without_refresh",
      "following_turn_completed_after_provider_recovery",
    ],
  };
}

function au10WorkbenchRecoveryProviderTimeoutBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au10-workbench-recovery-provider-timeout" &&
      record.timeout_turn_id === evidence.timeout_turn_id &&
      record.recovery_turn_id === evidence.recovery_turn_id,
  );
  if (!uiState) return null;
  if (uiState.timeout_message_visible !== true) return null;
  if (uiState.no_production_write_on_timeout !== true) return null;
  if (uiState.no_artifact_adopted_on_timeout !== true) return null;
  if (uiState.loading_cleared_after_timeout !== true) return null;
  if (uiState.input_enabled_after_timeout !== true) return null;
  if (uiState.recovery_turn_completed !== true) return null;
  if (uiState.timeout_prompt_sent !== true) return null;
  if (uiState.recovery_prompt_sent !== true) return null;

  return {
    slice_id: "au10-workbench-recovery-provider-timeout",
    behavior: "provider_timeout_clears_loading_and_allows_following_turn",
    turn_ids: evidence.turn_ids,
    timeout_turn_id: evidence.timeout_turn_id,
    recovery_turn_id: evidence.recovery_turn_id,
    timeout_provider: evidence.timeout_provider,
    timeout_reason_code: evidence.timeout_reason_code,
    recovery_provider: evidence.recovery_provider,
    assertions: [
      "provider_timeout_returned_timeout_fallback_turn_result",
      "timeout_message_told_author_no_artifact_or_production_write_happened",
      "workspace_loading_indicator_cleared_after_timeout",
      "input_remained_available_after_timeout",
      "author_sent_following_message_without_refresh",
      "following_turn_completed_after_provider_timeout_recovery",
    ],
  };
}

function au10WorkbenchRecoveryReconnectBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au10-workbench-recovery-reconnect" &&
      record.turn_id === evidence.turn_id,
  );
  if (!uiState) return null;
  if (uiState.offline_status_visible !== true) return null;
  if (uiState.input_disabled_while_offline !== true) return null;
  if (uiState.loading_cleared_while_offline !== true) return null;
  if (uiState.reconnected_status_visible !== true) return null;
  if (uiState.input_enabled_after_reconnect !== true) return null;
  if (uiState.rejoin_observed !== true) return null;
  if (uiState.following_turn_completed !== true) return null;
  if (uiState.recovery_prompt_sent !== true) return null;
  if (uiState.service_stopped_externally !== true) return null;
  if (uiState.service_restarted_externally !== true) return null;

  return {
    slice_id: "au10-workbench-recovery-reconnect",
    behavior: "websocket_disconnect_disables_input_and_reconnect_allows_following_turn",
    turn_id: evidence.turn_id,
    join_count_after_restore: evidence.join_count_after_restore,
    assertions: [
      "phoenix_service_was_stopped_by_external_driver",
      "service_disconnect_changed_workbench_status_to_offline",
      "input_was_disabled_while_socket_was_offline",
      "loading_indicator_was_not_left_running_while_offline",
      "phoenix_service_was_restarted_by_external_driver",
      "websocket_rejoin_was_observed_after_service_recovery",
      "input_was_enabled_after_reconnect",
      "author_sent_following_message_after_reconnect",
      "following_turn_completed_after_reconnect",
    ],
  };
}

function au10WorkbenchRecoveryCancelWaitingBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au10-workbench-recovery-cancel-waiting" &&
      record.confirmation_turn_id === evidence.confirmation_turn_id &&
      record.cancel_turn_id === evidence.cancel_turn_id &&
      record.following_turn_id === evidence.following_turn_id,
  );
  if (!uiState) return null;
  if (uiState.confirmation_card_visible !== true) return null;
  if (uiState.cancelled_message_visible !== true) return null;
  if (uiState.confirmation_buttons_cleared !== true) return null;
  if (uiState.active_behavior_closed !== true) return null;
  if (uiState.no_tool_called_before_cancel !== true) return null;
  if (uiState.no_production_write_on_cancel !== true) return null;
  if (uiState.no_artifact_adopted_on_cancel !== true) return null;
  if (uiState.loading_cleared_after_cancel !== true) return null;
  if (uiState.input_enabled_after_cancel !== true) return null;
  if (uiState.following_turn_completed !== true) return null;
  if (uiState.prompt_sent !== true) return null;
  if (uiState.recovery_prompt_sent !== true) return null;

  const actionDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.turn_id === evidence.confirmation_turn_id &&
      record.action_status === "cancelled",
  );
  if (!actionDone) return null;

  return {
    slice_id: "au10-workbench-recovery-cancel-waiting",
    behavior: "cancel_waiting_closes_confirmation_without_write_and_allows_following_turn",
    turn_ids: evidence.turn_ids,
    confirmation_turn_id: evidence.confirmation_turn_id,
    cancel_turn_id: evidence.cancel_turn_id,
    following_turn_id: evidence.following_turn_id,
    action_id: evidence.action_id,
    action_type: evidence.action_type,
    assertions: [
      "confirmation_waiting_state_was_visible_in_real_workbench",
      "author_clicked_visible_reject_or_cancel_action",
      "cancel_action_used_server_authorized_author_action",
      "cancel_action_result_returned_cancelled",
      "cancelled_turn_result_closed_active_behavior",
      "cancel_waiting_did_not_call_tool_or_write_production_state",
      "workspace_loading_indicator_cleared_after_cancel",
      "input_was_enabled_after_cancel",
      "author_sent_following_message_after_cancel",
      "following_turn_completed_after_cancel",
    ],
  };
}

function au07BehaviorTraceTerminalReplayBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au07-behavior-trace-terminal-replay" &&
      record.confirmation_turn_id === evidence.confirmation_turn_id &&
      record.cancel_turn_id === evidence.cancel_turn_id &&
      record.following_turn_id === evidence.following_turn_id,
  );
  if (!uiState) return null;
  if (uiState.confirmation_card_visible !== true) return null;
  if (uiState.cancelled_message_visible !== true) return null;
  if (uiState.confirmation_buttons_cleared !== true) return null;
  if (uiState.active_behavior_closed !== true) return null;
  if (uiState.no_tool_called_before_cancel !== true) return null;
  if (uiState.no_production_write_on_cancel !== true) return null;
  if (uiState.no_artifact_adopted_on_cancel !== true) return null;
  if (uiState.behavior_trace_refs_count < 1) return null;
  if (uiState.behavior_trace_event_type !== "close") return null;
  if (uiState.behavior_trace_next_status !== "CANCELLED") return null;
  if (uiState.behavior_trace_event_turn_ref !== evidence.cancel_turn_id) return null;
  if (uiState.behavior_trace_resolution_ref !== `behavior_resolution:${evidence.cancel_turn_id}`) {
    return null;
  }
  if (uiState.cancel_trace_ref !== `trace:${evidence.cancel_turn_id}`) return null;

  const actionDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.turn_id === evidence.confirmation_turn_id &&
      record.action_status === "cancelled",
  );
  if (!actionDone) return null;

  return {
    slice_id: "au07-behavior-trace-terminal-replay",
    behavior: "terminal_behavior_replayable_from_recorded_close_resolution_refs",
    turn_ids: evidence.turn_ids,
    confirmation_turn_id: evidence.confirmation_turn_id,
    cancel_turn_id: evidence.cancel_turn_id,
    following_turn_id: evidence.following_turn_id,
    action_id: evidence.action_id,
    action_type: evidence.action_type,
    cancel_trace_ref: evidence.cancel_trace_ref,
    behavior_trace_ref: evidence.behavior_trace_ref,
    behavior_trace_event_type: evidence.behavior_trace_event_type,
    behavior_trace_next_status: evidence.behavior_trace_next_status,
    behavior_trace_resolution_ref: evidence.behavior_trace_resolution_ref,
    assertions: [
      "confirmation_waiting_state_was_visible_in_real_workbench",
      "author_clicked_visible_reject_or_cancel_action",
      "cancel_action_used_server_authorized_author_action",
      "cancelled_turn_result_closed_active_behavior",
      "cancel_turn_result_recorded_behavior_trace_ref",
      "behavior_trace_ref_is_terminal_close_event",
      "behavior_trace_ref_carries_resolution_ref",
      "cancel_waiting_did_not_call_tool_or_write_production_state",
      "following_turn_completed_after_cancel",
    ],
  };
}

function au12WorkProfileOverviewBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au12-work-profile-overview" &&
      record.work_id === evidence.work_id,
  );
  if (!uiState) return null;
  if (uiState.profile_fields_visible !== true) return null;
  if (uiState.profile_status_visible !== true) return null;
  if (uiState.profile_reply_omits_id !== true) return null;
  if (uiState.profile_reply_omits_work_uuid !== true) return null;
  if (uiState.profile_ui_omits_work_uuid !== true) return null;
  if (uiState.profile_log_omits_work_uuid !== true) return null;
  if (uiState.readonly_hint_visible !== true) return null;

  return {
    slice_id: "au12-work-profile-overview",
    behavior: "author_opens_work_profile_overview_from_real_archive",
    turn_ids: [],
    work_id: evidence.work_id,
    work_title: evidence.work_title,
    profile_status: evidence.profile_status,
    profile_revision: evidence.profile_revision,
    assertions: [
      "real_work_created_with_profile_fields",
      "author_opened_real_workbench_archive",
      "author_clicked_profile_overview_tab",
      "profile_fields_rendered_from_get_work_profile",
      "profile_status_distinguishes_tentative_work",
      "profile_dto_omitted_internal_work_id",
      "profile_ui_did_not_show_internal_work_uuid",
      "profile_log_did_not_emit_work_uuid",
      "profile_view_remained_readonly",
    ],
  };
}

function au12WorkProfileStatusIsolationBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au12-work-profile-status-isolation" &&
      record.accepted_work_id === evidence.accepted_work_id &&
      record.empty_work_id === evidence.empty_work_id,
  );
  if (!uiState) return null;
  if (uiState.accepted_profile_status !== "ACCEPTED") return null;
  if (uiState.empty_profile_status !== "TENTATIVE") return null;
  if (Number(uiState.empty_fields_visible_count ?? 0) < 4) return null;
  if (uiState.readonly_no_write_logs !== true) return null;
  if (uiState.readonly_no_author_action_frames !== true) return null;

  return {
    slice_id: "au12-work-profile-status-isolation",
    behavior: "author_checks_profile_status_missing_fields_and_cross_work_archive_isolation",
    turn_ids: [],
    accepted_work_id: evidence.accepted_work_id,
    accepted_work_title: evidence.accepted_work_title,
    empty_work_id: evidence.empty_work_id,
    empty_work_title: evidence.empty_work_title,
    accepted_profile_status: evidence.accepted_profile_status,
    empty_profile_status: evidence.empty_profile_status,
    empty_fields_visible_count: evidence.empty_fields_visible_count,
    assertions: [
      "accepted_profile_status_visible_as_confirmed",
      "tentative_profile_status_visible_as_pending",
      "missing_profile_fields_show_explicit_empty_value",
      "archive_tabs_navigate_from_real_structure_panel",
      "cross_work_profile_fields_are_isolated",
      "cross_work_character_foreshadowing_and_rule_items_are_isolated",
      "profile_dto_and_logs_omit_internal_work_uuid",
      "archive_viewing_does_not_emit_author_action_user_message_or_write_events",
    ],
  };
}

function au12ProfileReadFailureDegradeBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au12-profile-read-failure-degrade" &&
      record.work_id === evidence.work_id,
  );
  if (!uiState) return null;
  if (uiState.profile_read_failure_visible !== true) return null;
  if (uiState.profile_retry_visible !== true) return null;
  if (uiState.profile_failure_copy_honest !== true) return null;
  if (uiState.profile_failure_rows_hidden !== true) return null;
  if (uiState.service_stopped_externally !== true) return null;
  if (uiState.service_restarted_externally !== true) return null;
  if (uiState.rejoin_observed !== true) return null;
  if (uiState.profile_retry_recovered_fields !== true) return null;
  if (uiState.failure_cleared_after_retry !== true) return null;
  if (uiState.readonly_no_write_logs !== true) return null;
  if (uiState.readonly_no_author_action_frames !== true) return null;

  return {
    slice_id: "au12-profile-read-failure-degrade",
    behavior: "work_profile_read_failure_degrades_honestly_and_recovers_on_retry",
    turn_ids: [],
    work_id: evidence.work_id,
    work_title: evidence.work_title,
    assertions: [
      "external_driver_stopped_slice_phoenix_service",
      "real_archive_overview_showed_profile_read_failure",
      "failure_state_did_not_render_unknown_status_or_empty_profile_rows",
      "failure_copy_stated_no_fabricated_profile_content",
      "external_driver_restarted_slice_phoenix_service",
      "author_clicked_visible_retry_action",
      "retry_loaded_real_work_profile_fields",
      "failure_state_cleared_after_retry",
      "profile_failure_and_retry_stayed_readonly",
      "no_user_message_or_author_action_frame_sent",
    ],
  };
}

function au12CorrectionIntentRoundtripBehavior(turnIds, turnRecords, records, evidence, _options) {
  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, true)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_micro_plan.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "orchestrator.decide.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "toolbox.execute.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "dialogue_gateway.handle_input.done")) return null;
  if (hasEventPrefix(turnRecords, "channel.author_action.")) return null;
  if (hasEventPrefix(turnRecords, "adoption.evaluate.")) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au12-correction-intent-roundtrip" &&
      record.turn_id === turnIds[0],
  );
  if (!uiState) return null;
  if (uiState.correction_intent_sent_from_profile !== true) return null;
  if (uiState.decision_type !== "allow_tool") return null;
  if (uiState.tool_name !== "world_building") return null;
  if (uiState.tool_status !== "succeeded") return null;
  if (uiState.pending_artifact_type !== "world_setting") return null;
  if (uiState.pending_artifact_requires_adoption !== true) return null;
  if (uiState.available_accept_action !== true) return null;
  if (uiState.available_edit_action !== true) return null;
  if (uiState.available_discard_action !== true) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.tool_called !== true) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_adoption_event_before_author_choice !== true) return null;
  if (uiState.pending_card_visible !== true) return null;

  return {
    slice_id: "au12-correction-intent-roundtrip",
    behavior: "work_profile_correction_intent_returns_to_dialogue_and_adoption_boundary",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    work_title: evidence.work_title,
    decision_type: evidence.decision_type,
    tool_name: evidence.tool_name,
    pending_artifact_type: evidence.pending_artifact_type,
    assertions: [
      "author_clicked_visible_profile_correction_action",
      "real_workbench_sent_user_message_with_generate_micro_plan",
      "planner_frame_and_micro_plan_completed",
      "orchestrator_allowed_world_building_tool",
      "world_building_created_pending_world_setting_artifact",
      "pending_artifact_requires_author_adoption",
      "accept_edit_and_discard_actions_available",
      "no_author_action_sent_before_author_choice",
      "no_adoption_evaluation_before_author_choice",
      "no_direct_production_write_from_profile_panel",
    ],
  };
}

function findP1ChapterExpansionEvidence(records) {
  const sliceId = "p1-chapter-expansion";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.continuations_all_recognized === true &&
      record.appended_to_single_chapter === true &&
      record.accumulated_past_min === true &&
      record.short_to_ok_transition === true &&
      Number(record.first_draft_chapter_words ?? 0) > 0 &&
      Number(record.first_draft_chapter_words ?? 0) < 1000 &&
      Number(record.final_chapter_word_count ?? 0) >= 1000 &&
      Number(record.continuation_count ?? 0) >= 2,
  );
  if (!uiState) return null;

  // 续写意图必须由 Planner（AI）在 plan 阶段识别为 continuation，而不是按钮/关键字开关。
  const intents = Array.isArray(uiState.continuation_intents) ? uiState.continuation_intents : [];
  if (intents.length < 2) return null;
  if (!intents.every((intent) => intent === "continuation")) return null;
  if (containsGeneratedScenePlaceholderLine(uiState.long_session_visible_text)) return null;

  const draftTurnId = String(uiState.draft_turn_id ?? "");
  if (!draftTurnId) return null;

  // 工具链：初稿 + 至少 2 次续写都经 prose_writing 成功产出（共 >= 3 次）。
  const proseRuns = records.filter(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  if (proseRuns.length < 3) return null;

  // 采纳闭环：初稿 + 每轮续写都经 accept author_action 被采纳（共 >= 3 次）。
  const accepts = records.filter(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (accepts.length < 3) return null;

  // checkpoint 2 续写连贯：每轮续写的 prose_writing 上下文都带入了"本章已采纳正文"，
  // 由后端 observability 事件 turn_execution.continuation_context.done 证明（prior_prose_chars > 0）。
  const continuityEvents = records.filter(
    (record) =>
      record.event === "turn_execution.continuation_context.done" &&
      record.authoring_intent === "continuation" &&
      Number(record.prior_prose_chars ?? 0) > 0,
  );
  if (continuityEvents.length < 2) return null;

  // 续写落同一章：累积后目录里恰好 1 章有正文（其余为计划空章），且该章正文有效字符 >= 1000。
  // 注意：计划章现在都在目录里（chapter_count 含待写计划章），所以判「恰好 1 章有正文」=
  // ok 章数（总章 - 空章 - 短章）=== 1，而不是「目录只有 1 章」。
  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) -
        Number(record.empty_chapter_count ?? 0) -
        Number(record.short_chapter_count ?? 0) ===
        1,
  );
  if (!tocRead) return null;

  const writtenChapterCount =
    Number(tocRead.chapter_count ?? 0) -
    Number(tocRead.empty_chapter_count ?? 0) -
    Number(tocRead.short_chapter_count ?? 0);

  const chapterRead = records.find(
    (record) =>
      record.event === "channel.get_chapter_content.done" &&
      record.work_id === uiState.work_id &&
      Number(record.content_chars ?? 0) >= 1000,
  );
  if (!chapterRead) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnId,
    turn_ids: [draftTurnId],
    draft_turn_id: draftTurnId,
    chapter_title: uiState.chapter_title,
    chapter_count: writtenChapterCount,
    content_chars: chapterRead.content_chars,
    first_draft_chapter_words: uiState.first_draft_chapter_words,
    final_chapter_word_count: uiState.final_chapter_word_count,
    continuation_count: uiState.continuation_count,
    continuation_intents: intents,
    scene_placeholder_titles_hidden: true,
    prior_prose_context_events: continuityEvents.length,
    key_events: keyEvents,
  };
}

function findP1ChapterExpansionMultichapterEvidence(records) {
  const sliceId = "p1-chapter-expansion-multichapter";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === sliceId &&
      r.all_adopted === true &&
      r.all_chapters_have_prose === true &&
      r.chapter_order_correct === true &&
      r.chapter_navigation_verified === true &&
      r.empty_chapter_empty_state_visible === true &&
      Number(r.written_chapter_count ?? 0) >= 3 &&
      Array.isArray(r.draft_turn_ids) &&
      r.draft_turn_ids.length >= 3,
  );
  if (!uiState) return null;

  const draftTurnIds = uiState.draft_turn_ids.map(String);

  // 每章首稿都经 prose_writing 成功产出（>= 3，对应 3 章）。
  const proseRuns = records.filter(
    (r) =>
      r.event === "toolbox.execute.done" &&
      r.tool_name === "prose_writing" &&
      r.tool_outcome === "succeeded" &&
      draftTurnIds.includes(String(r.turn_id)),
  );
  if (proseRuns.length < 3) return null;

  // 每章都经 accept author_action 采纳（>= 3）。
  const accepts = records.filter(
    (r) =>
      r.event === "channel.author_action.done" &&
      r.action_type === "accept" &&
      r.action_status === "accepted",
  );
  if (accepts.length < 3) return null;

  // 阅读投影：完整计划 + 非空章数 >= 3（多章各归各章、不堆单章）。
  const tocReads = records.filter(
    (r) => r.event === "channel.get_toc.done" && r.work_id === uiState.work_id,
  );
  const finalToc = tocReads[tocReads.length - 1];
  if (!finalToc) return null;
  const writtenInToc =
    Number(finalToc.chapter_count ?? 0) - Number(finalToc.empty_chapter_count ?? 0);
  if (writtenInToc < 3) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnIds[draftTurnIds.length - 1],
    turn_ids: draftTurnIds,
    draft_turn_ids: draftTurnIds,
    written_chapter_count: uiState.written_chapter_count,
    target_chapter_titles: uiState.target_chapter_titles,
    total_chapter_count: finalToc.chapter_count,
    written_in_toc: writtenInToc,
    key_events: keyEvents,
  };
}

function p1ChapterExpansionMultichapterBehavior(turnIds, turnRecords, records, evidence, _options) {
  // 每章首稿 turn 都经工具产出（对话框自然语言路径，generate_micro_plan=false）。
  if (!turnsHaveEvent(evidence.draft_turn_ids, turnRecords, "toolbox.execute.done")) return null;

  const uiState = records.find(
    (r) =>
      r.event === "slice_verify.ui_state.done" &&
      r.slice_id === "p1-chapter-expansion-multichapter",
  );
  if (!uiState) return null;
  if (uiState.all_chapters_have_prose !== true) return null;
  if (uiState.chapter_order_correct !== true) return null;
  if (uiState.chapter_navigation_verified !== true) return null;
  if (uiState.empty_chapter_empty_state_visible !== true) return null;
  if (Number(uiState.written_chapter_count ?? 0) < 3) return null;

  return {
    slice_id: "p1-chapter-expansion-multichapter",
    behavior: "consecutive_multichapter_each_filed_to_own_planned_chapter_in_order",
    turn_ids: evidence.draft_turn_ids,
    written_chapter_count: evidence.written_chapter_count,
    target_chapter_titles: evidence.target_chapter_titles,
    assertions: [
      "three_chapters_drafted_via_prose_writing",
      "each_chapter_adopted_via_author_action_accept",
      "each_target_chapter_has_own_prose_no_cross_contamination",
      "reading_toc_shows_full_plan_with_three_written_chapters_in_order",
      "author_clicked_toc_chapters_and_loaded_each_target_chapter_content",
      "unwritten_chapter_shows_honest_empty_state",
    ],
  };
}

function p1ChapterExpansionBehavior(turnIds, turnRecords, records, evidence, _options) {
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "toolbox.execute.done")) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "p1-chapter-expansion" &&
      record.draft_turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;
  if (uiState.continuations_all_recognized !== true) return null;
  if (uiState.appended_to_single_chapter !== true) return null;
  if (uiState.accumulated_past_min !== true) return null;
  if (uiState.short_to_ok_transition !== true) return null;
  if (!(Number(uiState.first_draft_chapter_words ?? 0) < 1000)) return null;
  if (Number(uiState.final_chapter_word_count ?? 0) < 1000) return null;

  const intents = Array.isArray(uiState.continuation_intents) ? uiState.continuation_intents : [];
  if (intents.length < 2 || !intents.every((intent) => intent === "continuation")) return null;
  if (containsGeneratedScenePlaceholderLine(uiState.long_session_visible_text)) return null;

  // checkpoint 2：每轮续写都把本章已采纳正文喂进 prose_writing 上下文（基于前文衔接）。
  const continuityEvents = records.filter(
    (record) =>
      record.event === "turn_execution.continuation_context.done" &&
      record.authoring_intent === "continuation" &&
      Number(record.prior_prose_chars ?? 0) > 0,
  );
  if (continuityEvents.length < 2) return null;

  return {
    slice_id: "p1-chapter-expansion",
    behavior:
      "ai_recognized_continuation_appends_scenes_and_single_chapter_accumulates_past_p1_minimum",
    turn_ids: turnIds,
    chapter_title: evidence.chapter_title,
    first_draft_chapter_words: Number(uiState.first_draft_chapter_words ?? 0),
    final_chapter_word_count: Number(uiState.final_chapter_word_count ?? 0),
    continuation_count: Number(uiState.continuation_count ?? 0),
    continuation_intents: intents,
    scene_placeholder_titles_hidden: true,
    prior_prose_context_events: continuityEvents.length,
    assertions: [
      "first_chapter_draft_adopted_as_sub_1000_short_chapter",
      "natural_language_continuation_recognized_as_authoring_intent_continuation_by_planner",
      "each_continuation_appended_a_new_scene_to_the_same_chapter",
      "continuations_did_not_supersede_or_fork_a_new_chapter",
      "single_chapter_accumulated_past_p1_1000_word_minimum",
      "short_chapter_flipped_to_ok_after_accumulation",
      "each_continuation_prose_writing_received_prior_chapter_prose_for_coherent_continuation",
      "reading_mode_hides_generated_scene_placeholder_titles",
    ],
  };
}

function containsGeneratedScenePlaceholderLine(value) {
  const text = String(value ?? "");

  return text
    .split(/\r?\n/u)
    .some((line) =>
      /^(?:场景\s*[0-9一二三四五六七八九十百]+|第\s*(?:[0-9]+|[一二三四五六七八九十百]+)\s*场)$/u.test(
        line.trim(),
      ),
    );
}

function findP1ChapterEditThenAcceptEvidence(records) {
  const sliceId = "p1-chapter-edit-then-accept";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.edit_then_accept_event_sent === true &&
      record.artifact_edited_accepted === true &&
      record.edited_text_shown_in_reading === true &&
      record.edit_button_cleared_after_adoption === true &&
      record.word_count_matches_edited_prose === true &&
      Number(record.total_word_count ?? 0) > 0 &&
      Number(record.chapter_word_count ?? 0) > 0,
  );
  if (!uiState) return null;

  const draftTurnId = String(uiState.draft_turn_id ?? "");
  if (!draftTurnId) return null;
  if (!String(uiState.user_message_text ?? "").includes("正文草稿")) return null;

  const draftRecords = records.filter((record) => record.turn_id === draftTurnId);

  const start = draftRecords.find(
    (record) =>
      record.event === "channel.user_message.start" && record.generate_micro_plan === true,
  );
  if (!start) return null;

  const generatedByTool = draftRecords.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "prose_writing" &&
      record.tool_outcome === "succeeded",
  );
  if (!generatedByTool) return null;

  // edit_then_accept author_action 闭环：作者编辑后采纳被接受。
  const editDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "edit_then_accept" &&
      record.action_status === "accepted",
  );
  if (!editDone) return null;

  const tocRead = records.find(
    (record) =>
      record.event === "channel.get_toc.done" &&
      record.work_id === uiState.work_id &&
      Number(record.chapter_count ?? 0) >= 1,
  );
  if (!tocRead) return null;

  const chapterRead = records.find(
    (record) =>
      record.event === "channel.get_chapter_content.done" &&
      record.work_id === uiState.work_id &&
      Number(record.content_chars ?? 0) >= 1,
  );
  if (!chapterRead) return null;

  return {
    slice_id: sliceId,
    turn_id: draftTurnId,
    turn_ids: [draftTurnId],
    draft_turn_id: draftTurnId,
    adopt_turn_id: uiState.adopt_turn_id,
    artifact_id: uiState.artifact_id,
    artifact_type: uiState.artifact_type,
    chapter_title: uiState.chapter_title,
    chapter_count: tocRead.chapter_count,
    content_chars: chapterRead.content_chars,
    total_word_count: uiState.total_word_count,
    chapter_word_count: uiState.chapter_word_count,
    expected_word_count: uiState.expected_word_count,
    key_events: keyEvents,
  };
}

function p1ChapterEditThenAcceptBehavior(turnIds, turnRecords, records, evidence, _options) {
  if (!turnsHaveGenerateMicroPlan([evidence.draft_turn_id], turnRecords, true)) return null;
  if (!turnsHaveEvent([evidence.draft_turn_id], turnRecords, "toolbox.execute.done")) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "p1-chapter-edit-then-accept" &&
      record.draft_turn_id === evidence.draft_turn_id,
  );
  if (!uiState) return null;
  if (uiState.word_count_matches_edited_prose !== true) return null;
  if (uiState.edited_text_shown_in_reading !== true) return null;
  if (Number(uiState.chapter_word_count ?? 0) !== Number(uiState.expected_word_count ?? -1)) {
    return null;
  }
  if (Number(uiState.total_word_count ?? 0) !== Number(uiState.chapter_word_count ?? -1)) {
    return null;
  }

  return {
    slice_id: "p1-chapter-edit-then-accept",
    behavior: "author_edited_prose_replaces_draft_and_materializes_reading_projection",
    turn_ids: turnIds,
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    chapter_title: evidence.chapter_title,
    total_word_count: Number(uiState.total_word_count ?? 0),
    chapter_word_count: Number(uiState.chapter_word_count ?? 0),
    expected_word_count: Number(uiState.expected_word_count ?? 0),
    content_chars: evidence.content_chars,
    assertions: [
      "chapter_draft_generated_from_adopted_plan",
      "author_opened_edit_dialog_and_rewrote_prose",
      "edit_then_accept_author_action_carried_edited_content",
      "edit_then_accept_routed_through_adoption_boundary_as_edited_accepted",
      "edit_button_cleared_after_adoption_no_resubmit",
      "edited_prose_visible_in_reading_mode",
      "reading_mode_loaded_toc_and_chapter_content_from_channel",
      "displayed_word_count_equals_effective_count_of_edited_prose",
    ],
  };
}

function findP1ChapterOverwriteConfirmEvidence(records) {
  const sliceId = "p1-chapter-overwrite-confirm";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.cycle1_adopted === true &&
      record.cycle2_required_confirmation === true &&
      record.confirmation_behavior_opened === true &&
      record.no_write_before_confirmation === true &&
      record.confirmed_overwrite_adopted === true,
  );
  if (!uiState) return null;

  // 确认动作真实经过 author_action 闭环
  const confirmDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "confirm_before_execute" &&
      record.action_status === "accepted",
  );
  if (!confirmDone) return null;

  // 覆盖采纳后阅读投影里「有正文的章」仍恰好 1 章（同一章就地替换，而非堆出重复章）。
  // toc 语义已归正为完整卷/章结构（含空计划章），故判「有正文章 = 1」=
  // 非空章数（chapter_count - empty_chapter_count）=== 1，而不是「目录只有 1 章」。
  // 覆盖正文不校验字数门槛（不扣 short_chapter_count）：若错误堆出重复章，非空章会变成 2。
  const tocReads = records.filter(
    (record) => record.event === "channel.get_toc.done" && record.work_id === uiState.work_id,
  );
  const finalToc = tocReads[tocReads.length - 1];
  if (!finalToc) return null;
  const writtenChapterCount =
    Number(finalToc.chapter_count ?? 0) - Number(finalToc.empty_chapter_count ?? 0);
  if (writtenChapterCount !== 1) return null;

  // turn_ids 只放生成 turn：lmstudio 证据要求每个 turn 都有 LLM 调用，而采纳/确认
  // turn 不调 LLM。覆盖采纳的因果在 behavior 函数里按全量 records 校验。
  const turnIds = [uiState.first_generate_turn_id, uiState.second_generate_turn_id].filter(
    (id) => typeof id === "string" && id !== "",
  );

  return {
    slice_id: sliceId,
    turn_id: String(uiState.second_generate_turn_id ?? uiState.turn_id ?? ""),
    turn_ids: turnIds,
    first_artifact_id: uiState.first_artifact_id,
    second_artifact_id: uiState.second_artifact_id,
    final_chapter_count: writtenChapterCount,
    key_events: keyEvents,
  };
}

function p1ChapterOverwriteConfirmBehavior(turnIds, _turnRecords, records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "p1-chapter-overwrite-confirm",
  );
  if (!uiState) return null;
  if (uiState.cycle1_adopted !== true) return null;
  if (uiState.cycle2_required_confirmation !== true) return null;
  if (uiState.no_write_before_confirmation !== true) return null;
  if (uiState.confirmed_overwrite_adopted !== true) return null;
  if (Number(evidence.final_chapter_count ?? 0) !== 1) return null;

  return {
    slice_id: "p1-chapter-overwrite-confirm",
    behavior: "overwriting_accepted_chapter_requires_confirmation_then_replaces_in_place",
    turn_ids: turnIds,
    first_artifact_id: evidence.first_artifact_id,
    second_artifact_id: evidence.second_artifact_id,
    final_chapter_count: evidence.final_chapter_count,
    assertions: [
      "first_chapter_prose_adopted",
      "re_adopting_same_chapter_detected_as_overwrite_required_confirmation",
      "confirmation_behavior_opened_with_no_write_before_confirm",
      "author_confirmed_execute_then_re_gated_and_adopted",
      "reading_projection_replaced_in_place_single_chapter_no_duplicate",
    ],
  };
}

function findAu09MemoryCreateRecallEvidence(records) {
  const sliceId = "au09-memory-create-recall";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.memory_created === true &&
      record.memory_confirmed === true &&
      record.why_shows_memory_source === true,
  );
  if (!uiState) return null;

  const recallTurnId = String(uiState.recall_turn_id ?? "");
  if (!recallTurnId) return null;

  const turnRecords = records.filter((record) => record.turn_id === recallTurnId);

  // 召回命中：上下文装配把记忆纳入（has_memory=true）。
  const contextDone = turnRecords.find(
    (record) => record.event === "context.assemble.done" && record.has_memory === true,
  );
  if (!contextDone) return null;

  if (!turnRecords.some((record) => record.event === "channel.user_message.done")) return null;

  return {
    slice_id: sliceId,
    turn_id: recallTurnId,
    turn_ids: [recallTurnId],
    memory_nonce: uiState.memory_nonce,
    key_events: keyEvents,
  };
}

function au09MemoryCreateRecallBehavior(turnIds, _turnRecords, records, evidence, options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-memory-create-recall",
  );
  if (!uiState) return null;
  if (uiState.why_shows_memory_source !== true) return null;

  const nonce = String(uiState.memory_nonce ?? "");

  // lmstudio：额外证明召回的设定真正进入了 LLM prompt（含 nonce）。
  if (options.provider === "lmstudio") {
    const promptHasMemory = (options.llmRecords ?? []).some(
      (record) =>
        record.turn_id === evidence.turn_id &&
        JSON.stringify(record.request?.body ?? "").includes(nonce),
    );
    if (!promptHasMemory) return null;
  }

  return {
    slice_id: "au09-memory-create-recall",
    behavior: "author_created_memory_confirmed_recalled_into_prompt_and_shown_in_why",
    turn_ids: turnIds,
    memory_nonce: nonce,
    assertions: [
      "author_opened_memory_page_from_real_workbench",
      "author_created_and_confirmed_governed_memory",
      "confirmed_memory_recalled_into_dialogue_context",
      "why_panel_shows_confirmed_memory_as_author_safe_source",
      options.provider === "lmstudio"
        ? "lmstudio_prompt_included_recalled_memory"
        : "deterministic_context_assembled_with_memory",
    ],
  };
}

function findAu09MemoryManagementEntryEvidence(records) {
  const sliceId = "au09-memory-management-entry";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.memory_created === true &&
      record.memory_confirmed === true &&
      record.memory_locked === true &&
      record.locked_controls_disabled === true &&
      record.locked_recalled_before_terminal_action === true &&
      record.why_shows_locked_memory_source === true &&
      record.memory_deprecated === true &&
      record.archived_memory_created === true &&
      record.archived_memory_confirmed === true &&
      record.archived_memory_archived === true &&
      record.terminal_managed_memory_excluded === true &&
      record.why_excludes_terminal_memory_content === true,
  );
  if (!uiState) return null;

  const lockedRecallTurnId = String(uiState.locked_recall_turn_id ?? "");
  const terminalRecallTurnId = String(uiState.terminal_recall_turn_id ?? "");
  if (!lockedRecallTurnId || !terminalRecallTurnId) return null;

  const lockedContext = records.find(
    (record) =>
      record.turn_id === lockedRecallTurnId &&
      record.event === "context.assemble.done" &&
      record.has_memory === true,
  );
  if (!lockedContext) return null;

  const terminalContext = records.find(
    (record) => record.turn_id === terminalRecallTurnId && record.event === "context.assemble.done",
  );
  if (!terminalContext) return null;

  const completedTurns = new Set(
    records
      .filter((record) => record.event === "channel.user_message.done")
      .map((record) => String(record.turn_id ?? "")),
  );
  if (!completedTurns.has(lockedRecallTurnId) || !completedTurns.has(terminalRecallTurnId)) {
    return null;
  }

  return {
    slice_id: sliceId,
    turn_id: terminalRecallTurnId,
    turn_ids: [lockedRecallTurnId, terminalRecallTurnId],
    memory_nonce: uiState.memory_nonce,
    archived_memory_nonce: uiState.archived_memory_nonce,
    locked_recall_turn_id: lockedRecallTurnId,
    terminal_recall_turn_id: terminalRecallTurnId,
    key_events: keyEvents,
  };
}

function au09MemoryManagementEntryBehavior(turnIds, _turnRecords, records, evidence) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-memory-management-entry",
  );
  if (!uiState) return null;
  if (uiState.terminal_managed_memory_excluded !== true) return null;
  if (uiState.why_excludes_terminal_memory_content !== true) return null;

  return {
    slice_id: "au09-memory-management-entry",
    behavior: "author_manages_memory_lifecycle_from_workbench_and_terminal_states_stop_recall",
    turn_ids: turnIds,
    memory_nonce: evidence.memory_nonce,
    archived_memory_nonce: evidence.archived_memory_nonce,
    assertions: [
      "author_opened_memory_page_from_real_workbench",
      "author_created_and_confirmed_governed_memory",
      "locked_memory_remained_recallable_before_terminal_action",
      "locked_memory_terminal_actions_were_disabled_until_unlock",
      "author_deprecated_memory_and_ui_marked_it_non_recallable",
      "author_archived_memory_and_ui_marked_it_non_recallable",
      "deprecated_and_archived_managed_memories_excluded_from_later_dialogue_context",
      "why_panel_excludes_deprecated_and_archived_managed_memory_content",
    ],
  };
}

function findAu09MemoryManagementFilterMatrixEvidence(records) {
  const sliceId = "au09-memory-management-filter-matrix";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.memory_page_opened_from_workbench === true &&
      record.keyword_filter_isolated_alpha === true &&
      record.type_filter_isolated_beta === true &&
      record.scope_filter_isolated_beta === true &&
      record.status_filter_isolated_beta === true &&
      record.locked_filter_isolated_beta === true &&
      record.combined_filter_isolated_beta === true &&
      record.draft_unlocked_filter_isolated_gamma === true &&
      record.request_carried_keyword_filter === true &&
      record.request_carried_combined_filter === true,
  );
  if (!uiState) return null;

  const requestCount = Number(uiState.memory_list_request_count ?? 0);
  if (requestCount < 6) return null;

  return {
    slice_id: sliceId,
    turn_id: null,
    turn_ids: [],
    work_id: uiState.work_id ?? uiState.context_work_id ?? null,
    session_id: uiState.session_id ?? uiState.active_session_id ?? null,
    alpha_nonce: uiState.alpha_nonce,
    beta_nonce: uiState.beta_nonce,
    gamma_nonce: uiState.gamma_nonce,
    memory_list_request_count: requestCount,
    key_events: keyEvents,
  };
}

function au09MemoryManagementFilterMatrixBehavior(records, evidence) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-memory-management-filter-matrix",
  );
  if (!uiState) return null;

  if (uiState.combined_filter_isolated_beta !== true) return null;
  if (uiState.draft_unlocked_filter_isolated_gamma !== true) return null;

  return {
    slice_id: "au09-memory-management-filter-matrix",
    behavior: "author_filters_current_work_memory_list_by_keyword_type_scope_status_and_locked_state",
    turn_ids: [],
    work_id: evidence.work_id,
    alpha_nonce: evidence.alpha_nonce,
    beta_nonce: evidence.beta_nonce,
    gamma_nonce: evidence.gamma_nonce,
    memory_list_request_count: evidence.memory_list_request_count,
    assertions: [
      "author_opened_memory_page_from_real_workbench",
      "author_created_distinct_current_work_memories_from_real_ui",
      "keyword_filter_isolated_matching_memory",
      "type_scope_status_and_locked_filters_isolated_matching_memory",
      "combined_filter_matrix_kept_only_the_matching_memory",
      "draft_unlocked_filter_kept_only_the_matching_memory",
      "memory_list_requests_carried_visible_filter_values",
    ],
  };
}

function findAu09MemoryTraceRoundtripEvidence(records) {
  const sliceId = "au09-memory-trace-roundtrip";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.lifecycle_trace_visible === true &&
      record.create_trace_visible === true &&
      record.confirm_trace_visible === true &&
      record.lock_trace_visible === true &&
      record.unlock_trace_visible === true &&
      record.deprecate_trace_visible === true &&
      record.archive_trace_visible === true &&
      record.trace_explains_locked_recall === true &&
      record.trace_explains_terminal_exclusion === true &&
      record.locked_controls_disabled === true &&
      record.locked_recalled_before_terminal_action === true &&
      record.terminal_managed_memory_excluded === true &&
      record.why_excludes_terminal_memory_content === true,
  );
  if (!uiState) return null;

  const lockedRecallTurnId = String(uiState.locked_recall_turn_id ?? "");
  const terminalRecallTurnId = String(uiState.terminal_recall_turn_id ?? "");
  if (!lockedRecallTurnId || !terminalRecallTurnId) return null;

  const lockedContext = records.find(
    (record) =>
      record.turn_id === lockedRecallTurnId &&
      record.event === "context.assemble.done" &&
      record.has_memory === true,
  );
  if (!lockedContext) return null;

  const terminalContext = records.find(
    (record) => record.turn_id === terminalRecallTurnId && record.event === "context.assemble.done",
  );
  if (!terminalContext) return null;

  const completedTurns = new Set(
    records
      .filter((record) => record.event === "channel.user_message.done")
      .map((record) => String(record.turn_id ?? "")),
  );
  if (!completedTurns.has(lockedRecallTurnId) || !completedTurns.has(terminalRecallTurnId)) {
    return null;
  }

  return {
    slice_id: sliceId,
    turn_id: terminalRecallTurnId,
    turn_ids: [lockedRecallTurnId, terminalRecallTurnId],
    memory_nonce: uiState.memory_nonce,
    archived_memory_nonce: uiState.archived_memory_nonce,
    locked_recall_turn_id: lockedRecallTurnId,
    terminal_recall_turn_id: terminalRecallTurnId,
    key_events: keyEvents,
  };
}

function au09MemoryTraceRoundtripBehavior(turnIds, _turnRecords, records, evidence) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-memory-trace-roundtrip",
  );
  if (!uiState) return null;
  if (uiState.lifecycle_trace_visible !== true) return null;
  if (uiState.trace_explains_locked_recall !== true) return null;
  if (uiState.trace_explains_terminal_exclusion !== true) return null;
  if (uiState.terminal_managed_memory_excluded !== true) return null;

  return {
    slice_id: "au09-memory-trace-roundtrip",
    behavior: "author_views_memory_lifecycle_trace_and_terminal_recall_exclusion",
    turn_ids: turnIds,
    memory_nonce: evidence.memory_nonce,
    archived_memory_nonce: evidence.archived_memory_nonce,
    assertions: [
      "memory_detail_reference_view_shows_author_safe_lifecycle_trace",
      "create_confirm_lock_unlock_deprecate_archive_actions_have_visible_trace",
      "locked_memory_remains_recallable_and_trace_explains_the_lock",
      "locked_terminal_controls_are_disabled_in_real_workbench",
      "deprecated_and_archived_memories_are_excluded_from_later_dialogue_context",
      "why_panel_excludes_terminal_memory_content",
    ],
  };
}

function findAu09AdoptSettingRecallEvidence(records) {
  const sliceId = "au09-adopt-setting-recall";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.setting_adopted === true &&
      record.why_shows_memory_source === true,
  );
  if (!uiState) return null;

  const recallTurnId = String(uiState.recall_turn_id ?? "");
  if (!recallTurnId) return null;

  // 召回轮：上下文装配纳入记忆。
  const contextDone = records.find(
    (record) =>
      record.turn_id === recallTurnId &&
      record.event === "context.assemble.done" &&
      record.has_memory === true,
  );
  if (!contextDone) return null;

  if (uiState.setting_artifact_type !== "foreshadowing_seed") return null;
  if (
    !["world_rule_seed", "style_rule_seed", "constraint_seed"].includes(
      uiState.rule_setting_artifact_type,
    )
  ) {
    return null;
  }

  // 设定确实由 world_building 生成，并经 accept 采纳。
  const generatedSetting = records.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_outcome === "succeeded" &&
      record.tool_name === "world_building",
  );
  if (!generatedSetting) return null;

  const adoptDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (!adoptDone) return null;

  const archiveLoaded = records.find(
    (record) =>
      record.event === "channel.get_foreshadowing.done" && Number(record.item_count ?? 0) >= 1,
  );
  if (!archiveLoaded) return null;
  const rulesLoaded = records.find(
    (record) => record.event === "channel.get_rules.done" && Number(record.rule_count ?? 0) >= 1,
  );
  if (!rulesLoaded) return null;
  if (uiState.archive_visible_after_adoption !== true) return null;
  if (Number(uiState.archive_foreshadowing_count_after_adoption ?? 0) < 1) return null;
  if (Number(uiState.archive_rule_count_after_adoption ?? 0) < 1) return null;
  if (uiState.archive_text_matched_adopted_setting !== true) return null;
  if (uiState.archive_text_matched_adopted_rule !== true) return null;
  if (uiState.setting_artifact_type !== "foreshadowing_seed") return null;
  if (
    !["world_rule_seed", "style_rule_seed", "constraint_seed"].includes(
      uiState.rule_setting_artifact_type,
    )
  ) {
    return null;
  }

  return {
    slice_id: sliceId,
    turn_id: recallTurnId,
    turn_ids: [recallTurnId],
    setting_chunk: uiState.setting_chunk,
    setting_artifact_id: uiState.setting_artifact_id,
    setting_artifact_type: uiState.setting_artifact_type,
    tool_name: "world_building",
    archive_tab_checked: uiState.archive_tab_checked,
    archive_foreshadowing_count_after_adoption: uiState.archive_foreshadowing_count_after_adoption,
    archive_rule_count_after_adoption: uiState.archive_rule_count_after_adoption,
    rule_setting_artifact_id: uiState.rule_setting_artifact_id,
    rule_setting_artifact_type: uiState.rule_setting_artifact_type,
    rule_setting_chunk: uiState.rule_setting_chunk,
    key_events: keyEvents,
  };
}

function au09AdoptSettingRecallBehavior(turnIds, _turnRecords, records, evidence, options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-adopt-setting-recall",
  );
  if (!uiState) return null;
  if (uiState.setting_adopted !== true) return null;
  if (uiState.why_shows_memory_source !== true) return null;
  if (uiState.archive_visible_after_adoption !== true) return null;
  if (Number(uiState.archive_foreshadowing_count_after_adoption ?? 0) < 1) return null;
  if (Number(uiState.archive_rule_count_after_adoption ?? 0) < 1) return null;
  if (uiState.archive_text_matched_adopted_setting !== true) return null;
  if (uiState.archive_text_matched_adopted_rule !== true) return null;

  // lmstudio：证明被采纳的设定内容真正进入召回轮的 LLM prompt。
  if (options.provider === "lmstudio") {
    const chunk = String(uiState.setting_chunk ?? "");
    const promptHasSetting =
      chunk.length > 0 &&
      (options.llmRecords ?? []).some(
        (record) =>
          record.turn_id === evidence.turn_id &&
          JSON.stringify(record.request?.body ?? "").includes(chunk),
      );
    if (!promptHasSetting) return null;
  }

  return {
    slice_id: "au09-adopt-setting-recall",
    behavior: "adopted_ai_setting_becomes_governed_memory_and_recalls",
    turn_ids: turnIds,
    setting_artifact_type: uiState.setting_artifact_type,
    tool_name: "world_building",
    setting_chunk: uiState.setting_chunk,
    archive_tab_checked: uiState.archive_tab_checked,
    archive_foreshadowing_count_after_adoption: uiState.archive_foreshadowing_count_after_adoption,
    archive_rule_count_after_adoption: uiState.archive_rule_count_after_adoption,
    rule_setting_artifact_type: uiState.rule_setting_artifact_type,
    rule_setting_chunk: uiState.rule_setting_chunk,
    assertions: [
      "ai_generated_a_setting_artifact_from_real_workbench",
      "author_adopted_setting_into_confirmed_recallable_governed_memory",
      "adopted_setting_visible_in_foreshadowing_archive_tab_after_reopen",
      "adopted_rule_visible_in_rules_archive_tab_after_reopen",
      "adopted_setting_recalled_into_later_turn_context",
      "why_panel_shows_confirmed_memory_as_author_safe_source",
      options.provider === "lmstudio"
        ? "lmstudio_prompt_included_adopted_setting"
        : "deterministic_context_assembled_with_adopted_setting",
    ],
  };
}

function findAu09CharacterDossierRoundtripEvidence(records) {
  const sliceId = "au09-character-dossier-roundtrip";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.character_artifact_type === "character_seed" &&
      record.create_prompt_is_character_design === true &&
      record.character_visible_in_archive === true &&
      record.create_entry_visible_after_character === true &&
      String(record.adopted_state_ref ?? "").length > 0 &&
      Number(record.archive_character_count ?? 0) >= 1 &&
      Number(record.context_character_count ?? 0) >= 1,
  );
  if (!uiState) return null;

  const turnIds = [uiState.creation_turn_id, uiState.context_turn_id].filter(Boolean);
  if (turnIds.length < 2) return null;

  const characterGenerated = records.some(
    (record) =>
      record.turn_id === uiState.creation_turn_id &&
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_design" &&
      record.tool_outcome === "succeeded",
  );
  if (!characterGenerated) return null;

  const adopted = records.some(
    (record) =>
      record.turn_id === uiState.creation_turn_id &&
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (!adopted) return null;

  const charactersLoaded = records.some(
    (record) =>
      record.event === "channel.get_characters.done" && Number(record.character_count ?? 0) >= 1,
  );
  if (!charactersLoaded) return null;

  const charactersInContext = records.some(
    (record) =>
      record.turn_id === uiState.context_turn_id &&
      record.event === "context.characters.done" &&
      Number(record.character_count ?? 0) >= 1,
  );
  if (!charactersInContext) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.context_turn_id,
    turn_ids: turnIds,
    character_artifact_id: uiState.character_artifact_id,
    character_title: uiState.character_title,
    adoption_turn_id: uiState.adoption_turn_id,
    adopted_state_ref: uiState.adopted_state_ref,
    archive_character_count: uiState.archive_character_count,
    context_character_count: uiState.context_character_count,
    key_events: keyEvents,
  };
}

function au09CharacterDossierRoundtripBehavior(turnIds, _turnRecords, records, evidence, options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-character-dossier-roundtrip",
  );
  if (!uiState) return null;
  if (uiState.character_artifact_type !== "character_seed") return null;
  if (uiState.create_prompt_is_character_design !== true) return null;
  if (uiState.character_visible_in_archive !== true) return null;
  if (uiState.create_entry_visible_after_character !== true) return null;
  if (Number(uiState.archive_character_count ?? 0) < 1) return null;
  if (Number(uiState.context_character_count ?? 0) < 1) return null;
  if (String(uiState.adopted_state_ref ?? "").length === 0) return null;

  if (options.provider === "lmstudio") {
    const title = String(uiState.character_title ?? "");
    const promptIncludedCharacter =
      title.length > 0 &&
      (options.llmRecords ?? []).some(
        (record) =>
          record.turn_id === evidence.turn_id &&
          JSON.stringify(record.request?.body ?? "").includes(title),
      );
    if (!promptIncludedCharacter) return null;
  }

  return {
    slice_id: "au09-character-dossier-roundtrip",
    behavior: "character_seed_adoption_writes_character_dossier_and_reaches_next_context",
    turn_ids: turnIds,
    character_title: uiState.character_title,
    adopted_state_ref: uiState.adopted_state_ref,
    assertions: [
      "archive_create_character_sends_role_design_prompt_not_foreshadowing",
      "character_design_generated_character_seed_from_real_workbench",
      "author_adopted_character_seed_through_adoption_boundary",
      "adopted_state_ref_points_to_persisted_character_state",
      "archive_character_tab_loaded_adopted_character",
      "character_tab_kept_create_entry_after_character_exists",
      "next_character_design_turn_received_character_dossier_context",
      options.provider === "lmstudio"
        ? "lmstudio_prompt_included_adopted_character_context"
        : "deterministic_context_logged_character_dossier",
    ],
  };
}

function findAu09CharacterRoleTaxonomyEvidence(records) {
  const sliceId = "au09-character-role-taxonomy-protagonist-policy";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.pre_design_answer_honest_missing === true &&
      record.pre_query_no_write === true &&
      record.designed_narrative_role === "PROTAGONIST" &&
      record.post_design_answer_names_protagonist === true &&
      record.post_query_no_write === true &&
      record.archive_shows_protagonist_label === true &&
      String(record.adopted_state_ref ?? "").length > 0 &&
      Number(record.archive_character_count ?? 0) >= 1,
  );
  if (!uiState) return null;

  const turnIds = [
    uiState.pre_query_turn_id,
    uiState.design_turn_id,
    uiState.adoption_turn_id,
    uiState.post_query_turn_id,
  ].filter(Boolean);
  if (turnIds.length < 4) return null;

  // 设计轮真实调用 character_design 工具。
  const designGenerated = records.some(
    (record) =>
      record.turn_id === uiState.design_turn_id &&
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_design" &&
      record.tool_outcome === "succeeded",
  );
  if (!designGenerated) return null;

  // 两次"主角是谁"都走只读 character_roster 工具。
  const preQueryReadOnly = records.some(
    (record) =>
      record.turn_id === uiState.pre_query_turn_id &&
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_roster" &&
      record.tool_outcome === "succeeded",
  );
  const postQueryReadOnly = records.some(
    (record) =>
      record.turn_id === uiState.post_query_turn_id &&
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_roster" &&
      record.tool_outcome === "succeeded",
  );
  if (!preQueryReadOnly || !postQueryReadOnly) return null;

  // 采纳经采纳边界写入。
  const adopted = records.some(
    (record) =>
      record.turn_id === uiState.design_turn_id &&
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (!adopted) return null;

  const charactersLoaded = records.some(
    (record) =>
      record.event === "channel.get_characters.done" && Number(record.character_count ?? 0) >= 1,
  );
  if (!charactersLoaded) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.post_query_turn_id,
    turn_ids: turnIds,
    protagonist_name: uiState.protagonist_name,
    designed_narrative_role: uiState.designed_narrative_role,
    adopted_state_ref: uiState.adopted_state_ref,
    archive_character_count: uiState.archive_character_count,
    key_events: keyEvents,
  };
}

function au09CharacterRoleTaxonomyBehavior(turnIds, _turnRecords, records, _evidence, options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-character-role-taxonomy-protagonist-policy",
  );
  if (!uiState) return null;
  if (uiState.pre_design_answer_honest_missing !== true) return null;
  if (uiState.designed_narrative_role !== "PROTAGONIST") return null;
  if (uiState.post_design_answer_names_protagonist !== true) return null;
  if (uiState.archive_shows_protagonist_label !== true) return null;
  if (uiState.pre_query_no_write !== true) return null;
  if (uiState.post_query_no_write !== true) return null;

  return {
    slice_id: "au09-character-role-taxonomy-protagonist-policy",
    behavior:
      "protagonist_query_honest_when_missing_then_answered_after_structured_narrative_role_designed_and_adopted",
    turn_ids: turnIds,
    protagonist_name: uiState.protagonist_name,
    designed_narrative_role: uiState.designed_narrative_role,
    adopted_state_ref: uiState.adopted_state_ref,
    assertions: [
      "protagonist_query_before_design_honestly_reports_missing_protagonist",
      "protagonist_query_before_design_performs_no_production_write",
      "protagonist_design_produces_structured_narrative_role_protagonist_character_seed",
      "adoption_boundary_writes_protagonist_into_character_dossier",
      "archive_character_tab_shows_structured_protagonist_label",
      "protagonist_query_after_design_answers_protagonist_name",
      "protagonist_query_after_design_performs_no_production_write",
      options.provider === "lmstudio"
        ? "lmstudio_real_provider_drove_protagonist_taxonomy_roundtrip"
        : "deterministic_provider_drove_protagonist_taxonomy_roundtrip",
    ],
  };
}

function findAu09MemoryListUxRedesignEvidence(records) {
  const sliceId = "au09-memory-list-ux-redesign";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.statuses_as_labels === true &&
      record.types_as_labels === true &&
      record.recall_shown === true &&
      record.terminal_row_styled === true &&
      record.no_row_overlap === true &&
      record.light_theme === true,
  );
  if (!uiState) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.turn_id,
    turn_ids: [],
    container_bg: uiState.container_bg,
    row_count: uiState.row_count,
    key_events: keyEvents,
  };
}

function au09MemoryListUxRedesignBehavior(_turnIds, _turnRecords, records, _evidence, options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-memory-list-ux-redesign",
  );
  if (!uiState) return null;
  if (uiState.statuses_as_labels !== true) return null;
  if (uiState.types_as_labels !== true) return null;
  if (uiState.recall_shown !== true) return null;
  if (uiState.terminal_row_styled !== true) return null;
  if (uiState.no_row_overlap !== true) return null;
  if (uiState.light_theme !== true) return null;

  return {
    slice_id: "au09-memory-list-ux-redesign",
    behavior: "memory_list_uses_global_light_tokens_with_scannable_semantic_status_type_and_recall",
    turn_ids: [],
    container_bg: uiState.container_bg,
    assertions: [
      "memory_list_on_global_light_theme_not_off_theme_dark",
      "status_shown_as_semantic_label_not_raw_enum",
      "memory_type_shown_as_label",
      "recall_value_shown_per_row",
      "terminal_memory_row_visually_de_emphasized",
      "rows_readable_without_overlap",
      options.provider === "lmstudio"
        ? "lmstudio_real_provider_session"
        : "deterministic_provider_session",
    ],
  };
}

function findAu09MemoryTaxonomyWritePolicyEvidence(records) {
  const sliceId = "au09-memory-taxonomy-write-policy";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.seed_artifact_type === "character_seed" &&
      record.evolution_artifact_type === "character_evolution_seed" &&
      record.character_dossier_visible === true &&
      record.no_character_memory_after_seed === true &&
      record.evolution_memory_written === true &&
      record.evolution_memory_type_shown === true &&
      String(record.adopted_state_ref ?? "").length > 0,
  );
  if (!uiState) return null;

  const turnIds = [uiState.design_turn_id, uiState.evolution_turn_id].filter(Boolean);
  if (turnIds.length < 2) return null;

  // 角色主体设计走 character_design 工具。
  const designedViaCharacterDesign = records.some(
    (record) =>
      record.turn_id === uiState.design_turn_id &&
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_design" &&
      record.tool_outcome === "succeeded",
  );
  if (!designedViaCharacterDesign) return null;

  // 角色演化走 character_evolution 工具。
  const evolvedViaCharacterEvolution = records.some(
    (record) =>
      record.turn_id === uiState.evolution_turn_id &&
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_evolution" &&
      record.tool_outcome === "succeeded",
  );
  if (!evolvedViaCharacterEvolution) return null;

  // 演化采纳经采纳边界。
  const adopted = records.some(
    (record) =>
      record.turn_id === uiState.evolution_turn_id &&
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (!adopted) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.adoption_turn_id,
    turn_ids: turnIds,
    evolution_nonce: uiState.evolution_nonce,
    adopted_state_ref: uiState.adopted_state_ref,
    key_events: keyEvents,
  };
}

function au09MemoryTaxonomyWritePolicyBehavior(turnIds, _turnRecords, records, _evidence, options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-memory-taxonomy-write-policy",
  );
  if (!uiState) return null;
  if (uiState.no_character_memory_after_seed !== true) return null;
  if (uiState.evolution_memory_written !== true) return null;
  if (uiState.evolution_memory_type_shown !== true) return null;
  if (uiState.character_dossier_visible !== true) return null;

  return {
    slice_id: "au09-memory-taxonomy-write-policy",
    behavior:
      "character_dossier_writes_no_memory_while_character_evolution_adoption_writes_typed_character_memory",
    turn_ids: turnIds,
    evolution_nonce: uiState.evolution_nonce,
    assertions: [
      "character_seed_adoption_wrote_character_dossier_not_memory",
      "memory_page_had_no_character_memory_after_character_seed",
      "character_evolution_adoption_wrote_typed_character_memory",
      "adopted_character_memory_shown_with_current_state_type",
      "adopted_character_memory_preserved_input_nonce",
      options.provider === "lmstudio"
        ? "lmstudio_real_provider_drove_memory_write_policy"
        : "deterministic_provider_drove_memory_write_policy",
    ],
  };
}

function findAu12ArchiveConcurrentModelRunReadSnapshotEvidence(records) {
  const sliceId = "au12-archive-concurrent-model-run-read-snapshot";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.snapshot_visible_during_execution === true &&
      record.loading_indicator_during_execution === true &&
      record.turn_in_flight_when_opened === true &&
      record.archive_refreshed_after_execution === true &&
      Number(record.user_messages_sent ?? 0) === 1 &&
      Number(record.author_actions_sent ?? 0) === 0,
  );
  if (!uiState) return null;

  const turnId = String(uiState.turn_id ?? "");
  if (!turnId) return null;

  // 慢对话 turn 真实跑过主链（start/done），不是被档案读取替代。
  const turnStarted = records.some(
    (record) => record.turn_id === turnId && record.event === "channel.user_message.start",
  );
  const turnDone = records.some(
    (record) => record.turn_id === turnId && record.event === "channel.user_message.done",
  );
  if (!turnStarted || !turnDone) return null;

  // 执行/刷新期间真实发生过只读档案读取（get_work_profile），证明是只读读取而非写入。
  // 注：该 channel 读取按当前作品上下文记录 work_id（"current_work"），不带 work UUID。
  const archiveRead = records.some(
    (record) => record.event === "channel.get_work_profile.done",
  );
  if (!archiveRead) return null;

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    work_id: uiState.work_id,
    profile_genre: uiState.profile_genre,
    profile_selling_point: uiState.profile_selling_point,
    key_events: keyEvents,
  };
}

function au12ArchiveConcurrentModelRunReadSnapshotBehavior(
  turnIds,
  _turnRecords,
  records,
  _evidence,
  options,
) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au12-archive-concurrent-model-run-read-snapshot",
  );
  if (!uiState) return null;
  if (uiState.snapshot_visible_during_execution !== true) return null;
  if (uiState.loading_indicator_during_execution !== true) return null;
  if (uiState.turn_in_flight_when_opened !== true) return null;
  if (uiState.archive_refreshed_after_execution !== true) return null;
  if (Number(uiState.user_messages_sent ?? 0) !== 1) return null;
  if (Number(uiState.author_actions_sent ?? 0) !== 0) return null;

  return {
    slice_id: "au12-archive-concurrent-model-run-read-snapshot",
    behavior:
      "opening_work_archive_during_model_execution_keeps_last_known_snapshot_with_honest_loading_and_no_write",
    turn_ids: turnIds,
    work_id: uiState.work_id,
    assertions: [
      "archive_overview_kept_work_profile_snapshot_during_in_flight_turn",
      "archive_showed_honest_loading_or_refresh_indicator_during_execution",
      "model_turn_was_still_in_flight_when_archive_opened",
      "archive_refreshed_to_full_snapshot_after_turn_completed",
      "opening_archive_during_execution_sent_no_extra_user_message",
      "opening_archive_during_execution_sent_no_author_action",
      options.provider === "lmstudio"
        ? "lmstudio_real_provider_drove_concurrent_archive_read"
        : "deterministic_provider_drove_concurrent_archive_read",
    ],
  };
}

function findAu09CharacterCandidatePerItemAdoptionEvidence(records) {
  const sliceId = "au09-character-candidate-per-item-adoption";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      Number(record.candidate_count ?? 0) >= 2 &&
      Number(record.accept_button_count ?? 0) >= 2 &&
      record.archive_has_adopted === true &&
      record.archive_excludes_unadopted === true &&
      record.unadopted_still_pending === true &&
      record.adopted_button_gone === true &&
      Number(record.archive_character_count ?? 0) === 1 &&
      String(record.adopted_state_ref ?? "").length > 0,
  );
  if (!uiState) return null;

  const turnIds = [uiState.design_turn_id, uiState.adoption_turn_id].filter(Boolean);
  if (turnIds.length < 2) return null;

  // 设计轮真实调用 character_design 工具产出候选。
  const designGenerated = records.some(
    (record) =>
      record.turn_id === uiState.design_turn_id &&
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_design" &&
      record.tool_outcome === "succeeded",
  );
  if (!designGenerated) return null;

  // 采纳经采纳边界（author_action accept accepted）。
  const adopted = records.some(
    (record) =>
      record.turn_id === uiState.design_turn_id &&
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (!adopted) return null;

  return {
    slice_id: sliceId,
    turn_id: uiState.adoption_turn_id,
    turn_ids: turnIds,
    candidate_count: uiState.candidate_count,
    accept_button_count: uiState.accept_button_count,
    adopted_candidate_name: uiState.adopted_candidate_name,
    unadopted_candidate_name: uiState.unadopted_candidate_name,
    adopted_state_ref: uiState.adopted_state_ref,
    archive_character_count: uiState.archive_character_count,
    key_events: keyEvents,
  };
}

function au09CharacterCandidatePerItemAdoptionBehavior(
  turnIds,
  _turnRecords,
  records,
  _evidence,
  options,
) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-character-candidate-per-item-adoption",
  );
  if (!uiState) return null;
  if (Number(uiState.candidate_count ?? 0) < 2) return null;
  if (Number(uiState.accept_button_count ?? 0) < 2) return null;
  if (uiState.archive_has_adopted !== true) return null;
  if (uiState.archive_excludes_unadopted !== true) return null;
  if (uiState.unadopted_still_pending !== true) return null;
  if (Number(uiState.archive_character_count ?? 0) !== 1) return null;

  return {
    slice_id: "au09-character-candidate-per-item-adoption",
    behavior:
      "each_character_candidate_has_its_own_adopt_action_and_adopting_one_writes_only_that_character",
    turn_ids: turnIds,
    adopted_candidate_name: uiState.adopted_candidate_name,
    unadopted_candidate_name: uiState.unadopted_candidate_name,
    assertions: [
      "character_design_returned_two_independent_candidates",
      "each_candidate_has_its_own_adopt_button",
      "adopting_one_candidate_resolves_only_that_candidate",
      "unadopted_candidate_keeps_its_adopt_button",
      "adopted_candidate_written_to_character_dossier",
      "unadopted_candidate_excluded_from_character_dossier",
      "only_one_character_persisted_to_production_fact",
      options.provider === "lmstudio"
        ? "lmstudio_real_provider_drove_per_item_adoption"
        : "deterministic_provider_drove_per_item_adoption",
    ],
  };
}

function findAu09ValidityWindowRecallEvidence(records) {
  const sliceId = "au09-validity-window-recall";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.why_shows_in_window === true &&
      record.why_excludes_out_of_window === true,
  );
  if (!uiState) return null;

  const recallTurnId = String(uiState.recall_turn_id ?? "");
  if (!recallTurnId) return null;

  // 召回轮纳入了（窗口内）记忆。
  const contextDone = records.find(
    (record) =>
      record.turn_id === recallTurnId &&
      record.event === "context.assemble.done" &&
      record.has_memory === true,
  );
  if (!contextDone) return null;

  return {
    slice_id: sliceId,
    turn_id: recallTurnId,
    turn_ids: [recallTurnId],
    in_window_phrase: uiState.in_window_phrase,
    out_of_window_phrase: uiState.out_of_window_phrase,
    key_events: keyEvents,
  };
}

function au09ValidityWindowRecallBehavior(turnIds, _turnRecords, records, evidence, options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-validity-window-recall",
  );
  if (!uiState) return null;
  if (uiState.why_shows_in_window !== true) return null;
  if (uiState.why_excludes_out_of_window !== true) return null;

  // lmstudio：召回轮的真实 prompt 含窗口内设定、不含窗口外设定（仅序章设定）。
  if (options.provider === "lmstudio") {
    const inPhrase = String(uiState.in_window_phrase ?? "");
    const outPhrase = String(uiState.out_of_window_phrase ?? "");
    const recallLlm = (options.llmRecords ?? []).filter(
      (record) => record.turn_id === evidence.turn_id,
    );
    const promptIncludesInWindow =
      inPhrase.length > 0 &&
      recallLlm.some((record) => JSON.stringify(record.request?.body ?? "").includes(inPhrase));
    const promptExcludesOutOfWindow =
      outPhrase.length > 0 &&
      recallLlm.every((record) => !JSON.stringify(record.request?.body ?? "").includes(outPhrase));
    if (!promptIncludesInWindow || !promptExcludesOutOfWindow) return null;
  }

  return {
    slice_id: "au09-validity-window-recall",
    behavior: "validity_window_keeps_in_window_memory_and_excludes_out_of_window_from_recall",
    turn_ids: turnIds,
    in_window_phrase: uiState.in_window_phrase,
    out_of_window_phrase: uiState.out_of_window_phrase,
    assertions: [
      "current_position_is_latest_accepted_chapter",
      "in_window_memory_recalled_and_shown_in_why",
      "out_of_window_memory_excluded_from_recall_and_why",
      options.provider === "lmstudio"
        ? "lmstudio_prompt_included_in_window_excluded_out_of_window"
        : "deterministic_why_panel_reflected_window_filtering",
    ],
  };
}

function findAu09CrossWorkMemoryIsolationEvidence(records) {
  const sliceId = "au09-cross-work-memory-isolation";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.switched_through_foreign_work === true &&
      record.archive_current_only === true &&
      record.memory_page_current_only === true &&
      record.context_includes_current_work_memory === true &&
      record.context_excludes_foreign_work_memory === true &&
      record.why_shows_current_work_memory === true &&
      record.why_excludes_foreign_work_memory === true,
  );
  if (!uiState) return null;

  const recallTurnId = String(uiState.recall_turn_id ?? "");
  const currentWorkId = String(uiState.current_work_id ?? uiState.work_id ?? "");
  const foreignWorkId = String(uiState.foreign_work_id ?? "");
  if (!recallTurnId || !currentWorkId || !foreignWorkId || currentWorkId === foreignWorkId) {
    return null;
  }

  const joinedWorkIds = new Set(
    records
      .filter((record) => record.event === "channel.join.done" && record.work_id)
      .map((record) => String(record.work_id)),
  );
  if (!joinedWorkIds.has(currentWorkId) || !joinedWorkIds.has(foreignWorkId)) return null;

  const contextDone = records.find(
    (record) =>
      record.turn_id === recallTurnId &&
      record.event === "context.assemble.done" &&
      record.work_id === currentWorkId &&
      record.has_memory === true,
  );
  if (!contextDone) return null;

  const userDone = records.find(
    (record) =>
      record.turn_id === recallTurnId &&
      record.event === "channel.user_message.done" &&
      record.work_id === currentWorkId,
  );
  if (!userDone) return null;

  const archiveLoaded = records.find(
    (record) =>
      record.event === "channel.get_foreshadowing.done" &&
      record.work_id === currentWorkId &&
      Number(record.item_count ?? 0) >= 1,
  );
  if (!archiveLoaded) return null;

  const rulesLoaded = records.find(
    (record) =>
      record.event === "channel.get_rules.done" &&
      record.work_id === currentWorkId &&
      Number(record.rule_count ?? 0) >= 1,
  );
  if (!rulesLoaded) return null;

  return {
    slice_id: sliceId,
    turn_id: recallTurnId,
    turn_ids: [recallTurnId],
    work_id: currentWorkId,
    current_work_id: currentWorkId,
    foreign_work_id: foreignWorkId,
    joined_work_count: joinedWorkIds.size,
    current_memory_nonce: uiState.current_memory_nonce,
    foreign_memory_nonce: uiState.foreign_memory_nonce,
    key_events: keyEvents,
  };
}

function au09CrossWorkMemoryIsolationBehavior(turnIds, _turnRecords, records, evidence, options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-cross-work-memory-isolation",
  );
  if (!uiState) return null;
  if (uiState.archive_current_only !== true) return null;
  if (uiState.memory_page_current_only !== true) return null;
  if (uiState.context_includes_current_work_memory !== true) return null;
  if (uiState.context_excludes_foreign_work_memory !== true) return null;
  if (uiState.why_excludes_foreign_work_memory !== true) return null;
  if (String(uiState.current_work_id ?? "") !== evidence.current_work_id) return null;
  if (String(uiState.foreign_work_id ?? "") !== evidence.foreign_work_id) return null;

  if (options.provider === "lmstudio") {
    const promptRecords = (options.llmRecords ?? []).filter(
      (record) => record.turn_id === evidence.turn_id,
    );
    const promptText = promptRecords
      .map((record) => JSON.stringify(record.request?.body ?? ""))
      .join("\n");
    if (!promptText.includes("只属于乙作品")) return null;
    if (promptText.includes("只属于甲作品")) return null;
  }

  return {
    slice_id: "au09-cross-work-memory-isolation",
    behavior: "current_work_archive_memory_recall_and_why_exclude_foreign_work_memory",
    turn_ids: turnIds,
    work_id: evidence.current_work_id,
    foreign_work_id: evidence.foreign_work_id,
    current_memory_nonce: evidence.current_memory_nonce,
    foreign_memory_nonce: evidence.foreign_memory_nonce,
    assertions: [
      "author_switched_between_two_real_works",
      "archive_foreshadowing_and_rule_tabs_showed_current_work_only",
      "memory_management_table_showed_current_work_only",
      "dialogue_input_matched_both_work_keywords",
      "context_assembly_attached_current_work_memory_only",
      "why_panel_showed_current_memory_source_without_foreign_work_summary",
      options.provider === "lmstudio"
        ? "lmstudio_prompt_included_current_summary_excluded_foreign_summary"
        : "deterministic_context_excluded_foreign_work_memory",
    ],
  };
}

function findAu09Au03SessionMemoryLayeringEvidence(records) {
  const sliceId = "au09-au03-session-memory-layering";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.readonly_session_transcript_visible === true &&
      record.readonly_input_disabled === true &&
      record.active_session_restored === true &&
      record.context_has_current_work === true &&
      record.context_has_session_transcript === true &&
      record.context_has_memory === true &&
      record.context_excludes_conversation_fallback === true &&
      record.context_session_summary_includes_active === true &&
      record.context_session_summary_excludes_history === true &&
      record.context_memory_summary_includes_memory === true &&
      record.context_memory_summary_excludes_history === true &&
      record.why_shows_session_source === true &&
      record.why_shows_memory_source === true &&
      record.why_excludes_historical_transcript === true,
  );
  if (!uiState) return null;

  const turnId = String(uiState.recall_turn_id ?? uiState.turn_id ?? "");
  const workId = String(uiState.work_id ?? uiState.context_work_id ?? "");
  const activeSessionId = String(uiState.session_id ?? uiState.active_session_id ?? "");
  const readonlySessionId = String(uiState.readonly_session_id ?? "");
  if (!turnId || !workId || !activeSessionId || !readonlySessionId) return null;
  if (activeSessionId === readonlySessionId) return null;

  const showDone = records.find(
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === workId &&
      record.session_id === readonlySessionId &&
      record.read_only === true,
  );
  if (!showDone) return null;

  const contextDone = records.find(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnId &&
      record.work_id === workId &&
      record.session_id === activeSessionId &&
      record.has_snapshot === true &&
      record.has_conversation === true &&
      record.has_memory === true,
  );
  if (!contextDone) return null;
  if (Number(contextDone.context_refs_count ?? 0) < 3) return null;

  const userDone = records.find(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.turn_id === turnId &&
      record.work_id === workId &&
      record.session_id === activeSessionId,
  );
  if (!userDone) return null;

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    work_id: workId,
    session_id: activeSessionId,
    readonly_session_id: readonlySessionId,
    context_refs_count: Number(contextDone.context_refs_count ?? 0),
    active_session_token: uiState.active_session_token,
    memory_token: uiState.memory_token,
    historical_session_token: uiState.historical_session_token,
    key_events: keyEvents,
  };
}

function au09Au03SessionMemoryLayeringBehavior(turnIds, _turnRecords, records, evidence, options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au09-au03-session-memory-layering",
  );
  if (!uiState) return null;
  if (uiState.readonly_session_transcript_visible !== true) return null;
  if (uiState.readonly_input_disabled !== true) return null;
  if (uiState.active_session_restored !== true) return null;
  if (uiState.context_has_current_work !== true) return null;
  if (uiState.context_has_session_transcript !== true) return null;
  if (uiState.context_has_memory !== true) return null;
  if (uiState.context_excludes_conversation_fallback !== true) return null;
  if (uiState.context_session_summary_includes_active !== true) return null;
  if (uiState.context_session_summary_excludes_history !== true) return null;
  if (uiState.context_memory_summary_includes_memory !== true) return null;
  if (uiState.context_memory_summary_excludes_history !== true) return null;
  if (uiState.why_shows_current_work_source !== true) return null;
  if (uiState.why_shows_session_source !== true) return null;
  if (uiState.why_shows_memory_source !== true) return null;
  if (uiState.why_shows_active_session_summary !== true) return null;
  if (uiState.why_shows_memory_summary !== true) return null;
  if (uiState.why_excludes_historical_transcript !== true) return null;
  if (uiState.trace_why_contains_raw_prompt === true) return null;
  if (String(uiState.readonly_session_id ?? "") !== evidence.readonly_session_id) return null;

  if (options.provider === "lmstudio") {
    const promptRecords = (options.llmRecords ?? []).filter(
      (record) => record.turn_id === evidence.turn_id,
    );
    const promptText = promptRecords
      .map((record) => JSON.stringify(record.request?.body ?? ""))
      .join("\n");
    if (!promptText.includes(String(evidence.active_session_token ?? ""))) return null;
    if (!promptText.includes(String(evidence.memory_token ?? ""))) return null;
    if (promptText.includes(String(evidence.historical_session_token ?? ""))) return null;
  }

  return {
    slice_id: "au09-au03-session-memory-layering",
    behavior:
      "active_session_transcript_current_work_and_governed_memory_are_layered_without_history_leak",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    readonly_session_id: evidence.readonly_session_id,
    active_session_token: evidence.active_session_token,
    memory_token: evidence.memory_token,
    historical_session_token: evidence.historical_session_token,
    assertions: [
      "historical_session_opened_readonly_from_real_workbench",
      "readonly_history_input_was_disabled",
      "active_session_restored_before_author_message",
      "context_refs_contain_current_work_session_transcript_and_memory",
      "active_session_transcript_not_labelled_as_generic_conversation",
      "historical_session_transcript_not_in_session_or_memory_sources",
      "why_panel_separates_current_work_session_and_memory_sources",
      options.provider === "lmstudio"
        ? "lmstudio_prompt_included_active_session_and_memory_excluded_history"
        : "deterministic_trace_refs_layered_session_and_memory_sources",
    ],
  };
}

function findAu11QualityDiagnosisMessageEnvelopeEvidence(records) {
  const sliceId = "au11-quality-diagnosis-message-envelope";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.guidance_mode_quality === true &&
      record.envelope_has_novel_layer === true &&
      record.envelope_has_work_state === true &&
      record.envelope_has_turn_guidance === true &&
      record.novel_layer_has_quality_gates === true &&
      record.work_state_has_current_work_source === true &&
      record.work_state_chapter_summary_mentions_target === true &&
      record.turn_guidance_focuses_quality === true &&
      record.assistant_gives_concrete_tradeoff === true &&
      record.no_tool_result === true &&
      record.no_adoption_state === true &&
      record.no_production_write === true &&
      record.trace_why_dialog_open === true &&
      record.trace_why_contains_raw_prompt !== true &&
      record.why_shows_quality_diagnosis === true &&
      record.why_shows_quality_focus === true &&
      record.why_shows_current_work_source === true,
  );
  if (!uiState) return null;

  const turnId = String(uiState.turn_id ?? "");
  const workId = String(uiState.work_id ?? uiState.context_work_id ?? "");
  const sessionId = String(uiState.session_id ?? uiState.active_session_id ?? "");
  if (!turnId || !workId || !sessionId) return null;

  const contextDone = records.find(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnId &&
      record.work_id === workId &&
      record.session_id === sessionId &&
      record.has_snapshot === true,
  );
  if (!contextDone) return null;

  const userDone = records.find(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.turn_id === turnId &&
      record.work_id === workId &&
      record.session_id === sessionId,
  );
  if (!userDone) return null;

  const hasAllEvents = keyEvents.every((event) => {
    if (event === "work_session.resume.done" || event === "channel.join.done") {
      return records.some(
        (record) =>
          record.event === event && record.work_id === workId && record.session_id === sessionId,
      );
    }

    return records.some(
      (record) =>
        record.event === event &&
        record.turn_id === turnId &&
        (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
    );
  });
  if (!hasAllEvents) return null;

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    work_id: workId,
    session_id: sessionId,
    context_refs_count: Number(contextDone.context_refs_count ?? 0),
    key_events: keyEvents,
  };
}

function au11QualityDiagnosisMessageEnvelopeBehavior(turnIds, _turnRecords, records, evidence) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au11-quality-diagnosis-message-envelope",
  );
  if (!uiState) return null;
  if (uiState.guidance_mode_quality !== true) return null;
  if (uiState.envelope_has_novel_layer !== true) return null;
  if (uiState.envelope_has_work_state !== true) return null;
  if (uiState.envelope_has_turn_guidance !== true) return null;
  if (uiState.novel_layer_has_quality_gates !== true) return null;
  if (uiState.work_state_has_current_work_source !== true) return null;
  if (uiState.work_state_chapter_summary_mentions_target !== true) return null;
  if (uiState.turn_guidance_focuses_quality !== true) return null;
  if (uiState.assistant_gives_concrete_tradeoff !== true) return null;
  if (uiState.no_tool_result !== true) return null;
  if (uiState.no_adoption_state !== true) return null;
  if (uiState.no_production_write !== true) return null;
  if (uiState.trace_why_dialog_open !== true) return null;
  if (uiState.trace_why_contains_raw_prompt === true) return null;
  if (uiState.why_shows_quality_diagnosis !== true) return null;
  if (uiState.why_shows_quality_focus !== true) return null;
  if (uiState.why_shows_current_work_source !== true) return null;
  if (String(uiState.work_id ?? uiState.context_work_id ?? "") !== evidence.work_id) return null;
  if (String(uiState.session_id ?? uiState.active_session_id ?? "") !== evidence.session_id) {
    return null;
  }

  return {
    slice_id: "au11-quality-diagnosis-message-envelope",
    behavior: "quality_diagnosis_turn_records_vs00d_three_layer_envelope_without_write",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "message_sent_from_real_workbench",
      "planner_prompt_and_trace_mark_guidance_mode_quality",
      "novel_layer_records_quality_gates",
      "work_state_layer_references_current_work_and_chapter_summary",
      "turn_guidance_layer_records_quality_focus",
      "assistant_response_contains_concrete_tradeoffs",
      "why_panel_shows_quality_diagnosis_without_internal_trace_or_prompt",
      "no_tool_no_adoption_no_production_write",
    ],
  };
}

function findAu11MissingWorkstatePolicyEvidence(records) {
  const sliceId = "au11-missing-workstate-policy";
  const keyEvents = keyEventsForSlice(sliceId);

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.guidance_mode_quality === true &&
      record.work_state_snapshot_mentions_work === true &&
      record.work_state_chapter_state_missing === true &&
      record.work_state_chapter_summary_missing === true &&
      record.work_state_prior_prose_missing === true &&
      record.work_state_character_state_missing === true &&
      record.turn_guidance_records_missing_questions === true &&
      record.assistant_asks_for_target_material === true &&
      record.assistant_claims_read_chapter !== true &&
      record.assistant_fabricates_seeded_chapter_fact !== true &&
      record.no_tool_result === true &&
      record.no_adoption_state === true &&
      record.no_production_write === true &&
      record.trace_why_dialog_open === true &&
      record.trace_why_contains_raw_prompt !== true &&
      record.why_shows_quality_diagnosis === true &&
      record.why_shows_work_state_missing === true &&
      record.why_shows_missing_limit === true,
  );
  if (!uiState) return null;

  const turnId = String(uiState.turn_id ?? "");
  const workId = String(uiState.work_id ?? uiState.context_work_id ?? "");
  const sessionId = String(uiState.session_id ?? uiState.active_session_id ?? "");
  if (!turnId || !workId || !sessionId) return null;

  const contextDone = records.find(
    (record) =>
      record.event === "context.assemble.done" &&
      record.turn_id === turnId &&
      record.work_id === workId &&
      record.session_id === sessionId &&
      record.has_snapshot === true,
  );
  if (!contextDone) return null;

  const userDone = records.find(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.turn_id === turnId &&
      record.work_id === workId &&
      record.session_id === sessionId,
  );
  if (!userDone) return null;

  const hasAllEvents = keyEvents.every((event) => {
    if (event === "work_session.resume.done" || event === "channel.join.done") {
      return records.some(
        (record) =>
          record.event === event && record.work_id === workId && record.session_id === sessionId,
      );
    }

    return records.some(
      (record) =>
        record.event === event &&
        record.turn_id === turnId &&
        (event === "slice_verify.ui_state.done" || hasRequiredCorrelationFields(record)),
    );
  });
  if (!hasAllEvents) return null;

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    work_id: workId,
    session_id: sessionId,
    context_refs_count: Number(contextDone.context_refs_count ?? 0),
    key_events: keyEvents,
  };
}

function au11MissingWorkstatePolicyBehavior(turnIds, _turnRecords, records, evidence) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au11-missing-workstate-policy",
  );
  if (!uiState) return null;
  if (uiState.guidance_mode_quality !== true) return null;
  if (uiState.work_state_snapshot_mentions_work !== true) return null;
  if (uiState.work_state_chapter_state_missing !== true) return null;
  if (uiState.work_state_chapter_summary_missing !== true) return null;
  if (uiState.work_state_prior_prose_missing !== true) return null;
  if (uiState.work_state_character_state_missing !== true) return null;
  if (uiState.turn_guidance_records_missing_questions !== true) return null;
  if (uiState.assistant_asks_for_target_material !== true) return null;
  if (uiState.assistant_claims_read_chapter === true) return null;
  if (uiState.assistant_fabricates_seeded_chapter_fact === true) return null;
  if (uiState.no_tool_result !== true) return null;
  if (uiState.no_adoption_state !== true) return null;
  if (uiState.no_production_write !== true) return null;
  if (uiState.trace_why_dialog_open !== true) return null;
  if (uiState.trace_why_contains_raw_prompt === true) return null;
  if (uiState.why_shows_quality_diagnosis !== true) return null;
  if (uiState.why_shows_work_state_missing !== true) return null;
  if (uiState.why_shows_missing_limit !== true) return null;
  if (String(uiState.work_id ?? uiState.context_work_id ?? "") !== evidence.work_id) return null;
  if (String(uiState.session_id ?? uiState.active_session_id ?? "") !== evidence.session_id) {
    return null;
  }

  return {
    slice_id: "au11-missing-workstate-policy",
    behavior: "quality_diagnosis_missing_workstate_records_explicit_gaps_without_fabrication",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "message_sent_from_real_workbench",
      "selected_real_work_has_snapshot_but_missing_chapter_material",
      "work_state_layer_marks_missing_chapter_summary_prose_and_character_state",
      "turn_guidance_records_missing_target_chapter_and_prose_questions",
      "assistant_asks_for_target_material_without_claiming_to_have_read_the_chapter",
      "why_panel_shows_quality_mode_missing_workstate_and_missing_prose_limit",
      "no_tool_no_adoption_no_production_write",
    ],
  };
}

function candidateAdoptionBridgeBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 2) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (hasEventPrefix(turnRecords, "channel.adopt.")) return null;
  if (hasEventPrefix(turnRecords, "channel.discard.")) return null;
  if (hasEventPrefix(turnRecords, "channel.modify_draft.")) return null;

  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au02-candidate-adoption-bridge",
  );
  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const candidateRef = uiState.candidate_ref;

  const sourceTurn = turnRecords.find(
    (record) => record.turn_id === sourceTurnId && record.event === "channel.user_message.start",
  );
  const actionStart = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === candidateRef,
  );
  const actionDone = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "accepted",
  );
  const decision = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "adoption.evaluate.done" &&
      record.decision_type === "adopt_tentative",
  );

  if (!sourceTurn || !actionStart || !actionDone || !decision) {
    return null;
  }

  if (uiState.production_write_performed !== false) return null;
  if (uiState.candidate_selected !== true || uiState.candidate_adopted !== true) return null;
  if (
    options.provider === "lmstudio" &&
    !lmstudioHasSteps(options, [sourceTurnId], ["form_frame"])
  ) {
    return null;
  }

  return {
    slice_id: "au02-candidate-adoption-bridge",
    behavior: "candidate_adoption_authorized_by_available_action",
    turn_ids: turnIds,
    source_turn_ref: sourceTurnId,
    continuation_turn_id: null,
    candidate_ref: candidateRef,
    candidate_set_ref: uiState.candidate_set_ref,
    assertions: [
      "candidate_panel_rendered_from_turn_result",
      "candidate_adoption_sent_authorized_choose_candidate_action",
      "adoption_boundary_returned_adopt_tentative",
      "ui_rendered_candidate_adoption_result",
      "production_write_not_claimed",
      "no_legacy_artifact_adopt_endpoint_used",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_for_source_candidate_turn"
        : "deterministic_provider_form_frame_called_for_source_candidate_turn",
    ],
  };
}

function adoptionSafetyFreshnessBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 2) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (hasEventPrefix(turnRecords, "channel.adopt.")) return null;
  if (hasEventPrefix(turnRecords, "channel.discard.")) return null;
  if (hasEventPrefix(turnRecords, "channel.modify_draft.")) return null;

  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au05-adoption-safety-freshness",
  );
  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const confirmationTurnId = String(uiState.confirmation_turn_id ?? "");
  const candidateRef = uiState.candidate_ref;

  const sourceTurn = turnRecords.find(
    (record) => record.turn_id === sourceTurnId && record.event === "channel.user_message.start",
  );
  const actionStart = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === candidateRef,
  );
  const actionDone = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "needs_confirmation",
  );
  const decision = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "adoption.evaluate.done" &&
      record.decision_type === "require_confirmation",
  );
  const confirmationUi = turnRecords.find(
    (record) =>
      record.turn_id === confirmationTurnId &&
      record.event === "slice_verify.ui_state.done" &&
      record.visible_confirmation_result === true,
  );

  if (!sourceTurn || !actionStart || !actionDone || !decision || !confirmationUi) return null;
  if (uiState.candidate_risk_hint !== "high") return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.candidate_selected !== true || uiState.candidate_adopted !== false) return null;
  if (!Array.isArray(uiState.adoption_reason_codes)) return null;
  if (!uiState.adoption_reason_codes.includes("high_risk_candidate")) return null;
  if (
    options.provider === "lmstudio" &&
    !lmstudioHasSteps(options, [sourceTurnId], ["form_frame"])
  ) {
    return null;
  }

  return {
    slice_id: "au05-adoption-safety-freshness",
    behavior: "high_risk_candidate_requires_confirmation_without_production_write",
    turn_ids: turnIds,
    source_turn_ref: sourceTurnId,
    confirmation_turn_id: confirmationTurnId,
    candidate_ref: candidateRef,
    candidate_set_ref: uiState.candidate_set_ref,
    assertions: [
      "high_risk_candidate_rendered_from_turn_result",
      "ui_sent_authorized_choose_candidate_action",
      "adoption_boundary_returned_require_confirmation",
      "channel_acknowledged_needs_confirmation",
      "ui_rendered_candidate_confirmation_result",
      "candidate_not_adopted",
      "production_write_not_claimed",
      "no_legacy_artifact_adopt_endpoint_used",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_for_source_candidate_turn"
        : "deterministic_provider_form_frame_called_for_source_candidate_turn",
    ],
  };
}

function staleConflictCrossWorkBehavior(turnIds, turnRecords, _options) {
  if (turnIds.length !== 2) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (hasEventPrefix(turnRecords, "channel.adopt.")) return null;
  if (hasEventPrefix(turnRecords, "channel.discard.")) return null;
  if (hasEventPrefix(turnRecords, "channel.modify_draft.")) return null;

  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au05-stale-conflict-cross-work-freshness",
  );
  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const rejectionTurnId = String(uiState.rejection_turn_id ?? "");
  const candidateRef = uiState.candidate_ref;

  const actionStart = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === candidateRef,
  );
  const actionDone = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "rejected",
  );
  const decision = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "adoption.evaluate.done" &&
      record.decision_type === "reject",
  );
  const rejectionUi = turnRecords.find(
    (record) =>
      record.turn_id === rejectionTurnId &&
      record.event === "slice_verify.ui_state.done" &&
      record.visible_rejection_result === true,
  );

  if (!actionStart || !actionDone || !decision || !rejectionUi) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.candidate_selected !== true || uiState.candidate_adopted !== false) return null;
  if (!Array.isArray(uiState.adoption_reason_codes)) return null;
  if (!uiState.adoption_reason_codes.includes("source_turn_stale")) return null;

  return {
    slice_id: "au05-stale-conflict-cross-work-freshness",
    behavior: "restored_stale_candidate_rejected_without_production_write",
    turn_ids: turnIds,
    source_turn_ref: sourceTurnId,
    rejection_turn_id: rejectionTurnId,
    candidate_ref: candidateRef,
    candidate_set_ref: uiState.candidate_set_ref,
    assertions: [
      "restored_stale_candidate_visible_in_real_workbench",
      "ui_sent_authorized_choose_candidate_action",
      "adoption_boundary_returned_reject",
      "channel_acknowledged_rejected",
      "ui_rendered_candidate_rejection_result",
      "candidate_not_adopted",
      "production_write_not_claimed",
      "no_legacy_artifact_adopt_endpoint_used",
    ],
  };
}

function conflictCrossWorkRecoveryBehavior(turnIds, turnRecords, _options) {
  if (turnIds.length !== 2) return null;
  if (hasFallbackText(turnRecords)) return null;
  if (hasEventPrefix(turnRecords, "channel.adopt.")) return null;
  if (hasEventPrefix(turnRecords, "channel.discard.")) return null;
  if (hasEventPrefix(turnRecords, "channel.modify_draft.")) return null;

  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au05-conflict-cross-work-recovery",
  );
  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const failureTurnId = String(uiState.failure_turn_id ?? "");
  const candidateRef = uiState.candidate_ref;

  const actionStart = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === candidateRef,
  );
  const actionDone = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "failed",
  );
  const decision = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "adoption.evaluate.done" &&
      record.decision_type === "fail_with_recovery",
  );
  const failureUi = turnRecords.find(
    (record) =>
      record.turn_id === failureTurnId &&
      record.event === "slice_verify.ui_state.done" &&
      record.visible_failure_result === true,
  );

  if (!actionStart || !actionDone || !decision || !failureUi) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.candidate_selected !== true || uiState.candidate_adopted !== false) return null;
  if (!Array.isArray(uiState.adoption_reason_codes)) return null;
  if (!uiState.adoption_reason_codes.includes("work_id_mismatch")) return null;
  if (!uiState.adoption_reason_codes.includes("cross_work_adoption_rejected")) return null;

  return {
    slice_id: "au05-conflict-cross-work-recovery",
    behavior: "cross_work_candidate_failed_with_recovery_without_production_write",
    turn_ids: turnIds,
    source_turn_ref: sourceTurnId,
    failure_turn_id: failureTurnId,
    candidate_ref: candidateRef,
    candidate_set_ref: uiState.candidate_set_ref,
    assertions: [
      "cross_work_candidate_visible_in_real_workbench",
      "ui_sent_authorized_choose_candidate_action",
      "adoption_boundary_returned_fail_with_recovery",
      "channel_acknowledged_failed",
      "ui_rendered_candidate_failure_result",
      "candidate_not_adopted",
      "production_write_not_claimed",
      "no_legacy_artifact_adopt_endpoint_used",
    ],
  };
}

function canonConflictRecoveryBehavior(turnIds, turnRecords, _options) {
  if (turnIds.length !== 2) return null;
  if (hasFallbackText(turnRecords)) return null;
  if (hasEventPrefix(turnRecords, "channel.adopt.")) return null;
  if (hasEventPrefix(turnRecords, "channel.discard.")) return null;
  if (hasEventPrefix(turnRecords, "channel.modify_draft.")) return null;

  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au05-canon-conflict-recovery",
  );
  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const failureTurnId = String(uiState.failure_turn_id ?? "");
  const candidateRef = uiState.candidate_ref;

  const actionStart = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.start" &&
      record.action_type === "choose_candidate" &&
      record.candidate_ref === candidateRef,
  );
  const actionDone = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "channel.author_action.done" &&
      record.action_type === "choose_candidate" &&
      record.action_status === "failed",
  );
  const decision = turnRecords.find(
    (record) =>
      record.turn_id === sourceTurnId &&
      record.event === "adoption.evaluate.done" &&
      record.decision_type === "fail_with_recovery",
  );
  const failureUi = turnRecords.find(
    (record) =>
      record.turn_id === failureTurnId &&
      record.event === "slice_verify.ui_state.done" &&
      record.visible_failure_result === true,
  );

  if (!actionStart || !actionDone || !decision || !failureUi) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.candidate_selected !== true || uiState.candidate_adopted !== false) return null;
  if (!Array.isArray(uiState.adoption_reason_codes)) return null;
  if (!uiState.adoption_reason_codes.includes("canon_conflict_detected")) return null;
  if (!uiState.adoption_reason_codes.includes("conflict_recovery_required")) return null;

  return {
    slice_id: "au05-canon-conflict-recovery",
    behavior: "canon_conflict_candidate_failed_with_recovery_without_production_write",
    turn_ids: turnIds,
    source_turn_ref: sourceTurnId,
    failure_turn_id: failureTurnId,
    candidate_ref: candidateRef,
    candidate_set_ref: uiState.candidate_set_ref,
    assertions: [
      "canon_conflict_candidate_visible_in_real_workbench",
      "ui_sent_authorized_choose_candidate_action",
      "adoption_boundary_returned_fail_with_recovery",
      "channel_acknowledged_failed",
      "ui_rendered_candidate_failure_result",
      "candidate_not_adopted",
      "production_write_not_claimed",
      "no_legacy_artifact_adopt_endpoint_used",
    ],
  };
}

function ordinarySingleTurnBehavior(sliceId, turnIds, turnRecords, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  return {
    slice_id: sliceId,
    behavior: "ordinary_chat_no_micro_plan",
    turn_ids: turnIds,
    assertions: [
      "one_user_turn_completed",
      "micro_plan_not_requested",
      "no_error_events",
      "assistant_messages_not_fallback",
      "lmstudio_form_frame_called_per_turn",
    ],
  };
}

function microPlanBehavior(sliceId, turnIds, turnRecords, options, behavior) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, true)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_micro_plan.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "dialogue_gateway.handle_input.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame", "form_micro_plan"])) return null;

  return {
    slice_id: sliceId,
    behavior,
    turn_ids: turnIds,
    assertions: [
      "micro_plan_requested",
      "frame_and_micro_plan_completed",
      "no_error_events",
      "assistant_messages_not_fallback",
      "lmstudio_frame_and_micro_plan_called",
    ],
  };
}

function e2e01DowngradeRealPageBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, true)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_micro_plan.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "orchestrator.decide.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "dialogue_gateway.handle_input.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame", "form_micro_plan"])) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "e2e-01-downgrade-real-page" &&
      record.turn_id === turnIds[0],
  );
  if (!uiState) return null;
  if (uiState.decision_type !== "downgrade_to_dialogue") return null;
  if (uiState.first_blocking_gate !== "action_scope") return null;
  if (uiState.execution_blocked !== true) return null;
  if (uiState.tool_called !== false) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.action_scope_reason_present !== true) return null;
  if (uiState.no_toolbox_execute_event !== true) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_execution_controls_visible !== true) return null;
  if (uiState.downgrade_badge_visible !== true) return null;
  if (uiState.generation_badge_absent !== true) return null;
  if (hasEventPrefix(turnRecords, "toolbox.execute.")) return null;
  if (hasEventPrefix(turnRecords, "channel.author_action.")) return null;
  if (hasEventPrefix(turnRecords, "adoption.evaluate.")) return null;

  const decision = turnRecords.find(
    (record) =>
      record.event === "orchestrator.decide.done" &&
      record.decision_type === "downgrade_to_dialogue",
  );
  if (!decision) return null;

  return {
    slice_id: "e2e-01-downgrade-real-page",
    behavior: "real_page_multi_step_micro_plan_downgrades_without_execution",
    turn_ids: turnIds,
    decision_type: evidence.decision_type,
    first_blocking_gate: evidence.first_blocking_gate,
    assertions: [
      "real_workbench_sent_micro_plan_request_from_visible_archive_action",
      "planner_form_frame_and_micro_plan_completed",
      "orchestrator_downgraded_multi_step_plan_at_action_scope",
      "turn_result_reported_execution_blocked",
      "no_toolbox_execute_event",
      "no_author_action_sent",
      "no_adoption_or_execution_controls_visible",
      "downgrade_badge_visible_without_generation_badge",
      options.provider === "lmstudio"
        ? "lmstudio_frame_and_micro_plan_called_for_downgrade_turn"
        : "deterministic_provider_frame_and_micro_plan_called_for_downgrade_turn",
    ],
  };
}

function e2e01ReadonlyToolTraceBehavior(turnIds, turnRecords, records, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_micro_plan.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "orchestrator.decide.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "context.characters.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "toolbox.execute.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "dialogue_gateway.handle_input.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame", "form_micro_plan"])) return null;
  if (hasEventPrefix(turnRecords, "channel.author_action.")) return null;
  if (hasEventPrefix(turnRecords, "adoption.evaluate.")) return null;

	  const uiState = records.find(
	    (record) =>
	      record.event === "slice_verify.ui_state.done" &&
	      record.slice_id === evidence.slice_id &&
	      record.turn_id === turnIds[0],
	  );
  if (!uiState) return null;
  if (uiState.decision_type !== "allow_tool") return null;
  if (uiState.tool_name !== "character_roster") return null;
  if (uiState.tool_status !== "succeeded") return null;
  if (uiState.tool_called !== true) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.artifact_adopted !== false) return null;
  if (uiState.execution_blocked !== false) return null;
  if (uiState.accepted_character_visible !== true) return null;
  if (uiState.tentative_character_absent !== true) return null;
  if (uiState.foreign_character_absent !== true) return null;
  if (uiState.no_write_statement_visible !== true) return null;
  if (uiState.no_state_delta !== true) return null;
  if (uiState.no_artifact_refs !== true) return null;
  if (uiState.no_author_action_sent !== true) return null;
  if (uiState.no_adoption_event !== true) return null;
  if (uiState.no_execution_controls_visible !== true) return null;
  if (uiState.trace_query_has_tool_trace_ref !== true) return null;

  const decision = turnRecords.find(
    (record) => record.event === "orchestrator.decide.done" && record.decision_type === "allow_tool",
  );
  if (!decision) return null;

  const toolbox = turnRecords.find(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_name === "character_roster" &&
      record.tool_outcome === "succeeded",
  );
  if (!toolbox) return null;

  const replayReportEvidence =
    evidence.slice_id === "e2e-01-replay-report"
      ? {
          replay_report_chain_steps: evidence.replay_report_chain_steps,
          replay_report_question_statuses: evidence.replay_report_question_statuses,
        }
      : {};

  return {
    slice_id: evidence.slice_id,
    behavior:
      evidence.slice_id === "e2e-01-replay-report"
        ? "real_page_trace_builds_complete_six_question_replay_report"
        : "real_page_readonly_character_roster_tool_persists_queryable_trace",
    turn_ids: turnIds,
    decision_type: evidence.decision_type,
    tool_name: evidence.tool_name,
    trace_query_tool_trace_refs: evidence.trace_query_tool_trace_refs,
    ...replayReportEvidence,
    assertions: [
      "real_workbench_sent_readonly_character_roster_request_from_visible_chat_input",
      "frame_tool_need_triggered_micro_plan_without_product_acceptance_hook",
      "orchestrator_allowed_low_risk_character_roster_tool",
      "toolbox_executed_character_roster_successfully",
      "accepted_character_visible_without_tentative_or_foreign_character_leakage",
      "turn_result_reported_tool_called_without_adoption_or_production_write",
      "no_author_action_adoption_or_execution_controls_visible",
      "trace_repository_list_by_turn_returned_tool_trace_ref",
      ...(evidence.slice_id === "e2e-01-replay-report"
        ? [
            "replay_report_built_from_persisted_trace_without_provider_call",
            "replay_report_answered_vs06_six_required_questions",
            "replay_report_chain_includes_frame_plan_decision_tool_and_turn_result",
          ]
        : []),
      options.provider === "lmstudio"
        ? "lmstudio_frame_and_micro_plan_called_for_readonly_tool_turn"
        : "deterministic_provider_frame_and_micro_plan_called_for_readonly_tool_turn",
    ],
  };
}

function au07TooltraceRegistryRedactedIoBehavior(turnIds, turnRecords, records, evidence, options) {
  const base = e2e01ReadonlyToolTraceBehavior(turnIds, turnRecords, records, evidence, options);
  if (!base) return null;
  if (evidence.tool_trace_registry_snapshot?.tool_name !== "character_roster") return null;
  if (evidence.tool_trace_registry_snapshot?.tool_version !== "1.0.0") return null;
  if (evidence.tool_trace_registry_snapshot?.status !== "active") return null;
  if (evidence.tool_trace_registry_snapshot?.tool_layer !== "memory") return null;
  if (evidence.tool_trace_contract_refs?.input_contract_ref !== "character_roster_query_v1") {
    return null;
  }
  if (evidence.tool_trace_contract_refs?.output_contract_ref !== "character_roster_result_v1") {
    return null;
  }
  if (evidence.tool_trace_grant_summary?.grants_within_registry !== true) return null;
  if (evidence.tool_trace_request_summary?.payload_stored !== false) return null;
  if (evidence.tool_trace_result_summary?.payload_stored !== false) return null;
  if (evidence.tool_trace_io_redaction?.input_payload_stored !== false) return null;
  if (evidence.tool_trace_io_redaction?.output_payload_stored !== false) return null;

  return {
    ...base,
    behavior: "real_page_tooltrace_carries_registry_snapshot_and_redacted_io",
    tool_trace_registry_snapshot: evidence.tool_trace_registry_snapshot,
    tool_trace_contract_refs: evidence.tool_trace_contract_refs,
    tool_trace_grant_summary: evidence.tool_trace_grant_summary,
    tool_trace_request_summary: evidence.tool_trace_request_summary,
    tool_trace_result_summary: evidence.tool_trace_result_summary,
    tool_trace_io_redaction: evidence.tool_trace_io_redaction,
    replay_report_chain_steps: evidence.replay_report_chain_steps,
    replay_report_question_statuses: evidence.replay_report_question_statuses,
    assertions: [
      ...base.assertions,
      "tool_trace_recorded_registry_snapshot_name_version_status_layer",
      "tool_trace_recorded_input_output_contract_refs",
      "tool_trace_recorded_grants_within_registry_without_write_grants",
      "tool_trace_recorded_redacted_request_result_summaries_without_raw_payload",
      "replay_report_tool_trace_chain_preserved_registry_and_redaction_boundary",
      "replay_report_built_from_persisted_trace_without_provider_call",
    ],
  };
}

function e2e01ChannelActionSecurityBehavior(records, evidence) {
  const turnIds = evidence.turn_ids ?? [];
  if (turnIds.length !== 2) return null;

  const actionIds = [evidence.invented_action_id, evidence.stale_action_id].filter(Boolean);
  if (actionIds.length !== 2) return null;

  const userDoneCount = records.filter(
    (record) =>
      record.event === "channel.user_message.done" &&
      record.work_id === evidence.work_id &&
      record.session_id === evidence.session_id &&
      turnIds.includes(record.turn_id),
  ).length;
  if (userDoneCount < 2) return null;

  const errorRecords = records.filter(
    (record) =>
      record.event === "channel.author_action.error" &&
      record.work_id === evidence.work_id &&
      record.session_id === evidence.session_id &&
      actionIds.includes(record.action_id),
  );
  if (errorRecords.length < 2) return null;
  if (!String(evidence.invented_error_reason ?? "").includes("invented")) return null;
  if (!String(evidence.stale_error_reason ?? "").includes("stale")) return null;

  const doneRecords = records.filter(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.work_id === evidence.work_id &&
      record.session_id === evidence.session_id &&
      actionIds.includes(record.action_id),
  );
  if (doneRecords.length > 0) return null;

  return {
    slice_id: "e2e-01-channel-action-security",
    behavior: "external_protocol_forged_author_actions_rejected_by_server_held_turn_result",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    invented_action_id: evidence.invented_action_id,
    stale_action_id: evidence.stale_action_id,
    assertions: [
      "real_tauri_page_joined_before_protocol_fuzzing",
      "external_protocol_socket_joined_same_work_session",
      "protocol_user_messages_established_server_held_turn_results",
      "client_supplied_source_turn_result_did_not_authorize_invented_action",
      "stale_source_turn_ref_rejected_after_current_turn_advanced",
      "forged_author_actions_emitted_channel_author_action_error",
      "forged_author_actions_did_not_broadcast_action_result",
      "forged_author_actions_did_not_log_author_action_done",
      "no_product_acceptance_logic_added",
    ],
  };
}

function adoptionBoundaryBehavior(sliceId, turnIds, turnRecords, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, true)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "toolbox.execute.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "adoption.evaluate.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.adopt.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame", "form_micro_plan"])) return null;

  const adoptDone = turnRecords.find((record) => record.event === "channel.adopt.done");
  if (!adoptDone?.persisted || !adoptDone?.mutation_id) return null;

  return {
    slice_id: sliceId,
    behavior: "artifact_adoption_persisted_and_projection_stale",
    turn_ids: turnIds,
    mutation_id: adoptDone.mutation_id,
    assertions: [
      "tentative_artifact_generated",
      "author_clicked_accept_from_workbench",
      "adoption_boundary_adopted_tentative",
      "adoption_persisted_as_mutation",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function discardBoundaryBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, true)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "toolbox.execute.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.discard.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame", "form_micro_plan"])) return null;

  const discardDone = turnRecords.find((record) => record.event === "channel.discard.done");
  if (discardDone?.action_status !== "discarded") return null;

  return {
    slice_id: "au05-discard-boundary",
    behavior: "artifact_discarded_from_workbench",
    turn_ids: turnIds,
    assertions: [
      "tentative_artifact_generated",
      "author_clicked_discard_from_workbench",
      "discard_resolved_without_channel_crash",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function modifyDraftBoundaryBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, true)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "toolbox.execute.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "adoption.evaluate.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.modify_draft.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame", "form_micro_plan"])) return null;

  const modifyDone = turnRecords.find((record) => record.event === "channel.modify_draft.done");
  if (modifyDone?.action_status !== "accepted") return null;

  return {
    slice_id: "au05-modify-draft-boundary",
    behavior: "artifact_modified_then_accepted_from_workbench",
    turn_ids: turnIds,
    assertions: [
      "tentative_artifact_generated",
      "author_clicked_edit_then_accept_from_workbench",
      "edited_artifact_passed_adoption_boundary",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function readingProjectionBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, true)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "toolbox.execute.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "adoption.evaluate.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.adopt.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.get_toc.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.get_chapter_content.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame", "form_micro_plan"])) return null;

  const adoptDone = turnRecords.find((record) => record.event === "channel.adopt.done");
  const tocDone = turnRecords.find((record) => record.event === "channel.get_toc.done");
  const chapterDone = turnRecords.find(
    (record) => record.event === "channel.get_chapter_content.done",
  );

  if (!adoptDone?.persisted || !adoptDone?.mutation_id) return null;
  if (Number(tocDone?.chapter_count ?? 0) < 1) return null;
  if (Number(chapterDone?.content_chars ?? 0) < 1) return null;

  return {
    slice_id: "au08-adoption-reading-projection",
    behavior: "accepted_artifact_visible_in_reading_mode_projection",
    turn_ids: turnIds,
    mutation_id: adoptDone.mutation_id,
    assertions: [
      "tentative_artifact_generated_from_real_workbench",
      "author_clicked_accept_from_workbench",
      "adoption_persisted_as_mutation",
      "accepted_content_materialized_as_reading_projection",
      "reading_mode_loaded_toc_from_channel",
      "reading_mode_loaded_chapter_content_from_channel",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function archiveRealDataBehavior(_records, evidence, _options, sliceId = "au09-archive-real-data") {
  if (!evidence?.work_id) return null;
  if (Number(evidence.archive_character_count ?? 0) < 1) return null;
  if (Number(evidence.archive_foreshadowing_count ?? 0) < 1) return null;
  if (Number(evidence.archive_rule_count ?? 0) < 1) return null;
  if (Number(evidence.archive_volumes ?? 0) < 1) return null;
  if (Number(evidence.archive_chapters ?? 0) < 1) return null;
  if (Number(evidence.archive_memory_items ?? 0) < 2) return null;
  if (Number(evidence.archive_drafts_total ?? 0) < 1) return null;
  if (Number(evidence.archive_drafts_accepted ?? 0) < 1) return null;
  if (evidence.archive_detail_kind !== "memory") return null;
  if (String(evidence.archive_detail_title ?? "").length < 1) return null;
  if (sliceId === "au09-archive-stats-current" && evidence.archive_foreign_excluded !== true) {
    return null;
  }

  return {
    slice_id: sliceId,
    behavior: "archive_panel_reads_real_scoped_work_facts_and_detail",
    work_id: evidence.work_id,
    assertions: [
      "archive_panel_opened_from_real_workbench",
      "characters_loaded_from_channel",
      "foreshadowing_loaded_from_confirmed_memory",
      "rules_loaded_from_confirmed_memory",
      "stats_loaded_from_persistence",
      "foreshadowing_detail_opened_from_archive_list",
      "no_fixed_mock_archive_items",
      ...(sliceId === "au09-archive-stats-current"
        ? ["foreign_work_archive_items_excluded"]
        : []),
    ],
  };
}

function memoryRecallContextBehavior(records, evidence, options) {
  const turnIds = evidence.turn_ids ?? [evidence.turn_id];
  const turnRecords = records.filter((record) => turnIds.includes(record.turn_id));

  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "context.assemble.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  const contextDone = turnRecords.find((record) => record.event === "context.assemble.done");
  if (contextDone?.has_memory !== true) return null;
  if (Number(contextDone.context_refs_count ?? 0) < 1) return null;

  return {
    slice_id: "au09-memory-recall-context",
    behavior: "confirmed_memory_recalled_into_dialogue_context",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    assertions: [
      "message_sent_from_real_workbench",
      "micro_plan_not_requested",
      "confirmed_recallable_memory_attached_to_context",
      "memory_source_summary_visible_in_why_dialog",
      "planner_received_context_before_frame",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function sessionHistoryReadonlyBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au03-session-history-readonly" &&
      record.readonly_session_id === evidence.session_id,
  );
  if (!uiState) return null;

  const showDone = records.find(
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === evidence.work_id &&
      record.session_id === evidence.session_id,
  );
  if (!showDone || showDone.read_only !== true) return null;
  if (Number(showDone.pending_adoption_count ?? -1) !== 0) return null;
  if (uiState.readonly_banner_visible !== true) return null;
  if (uiState.readonly_input_disabled !== true) return null;
  if (uiState.readonly_send_disabled !== true) return null;
  if (uiState.active_session_restored !== true) return null;

  return {
    slice_id: "au03-session-history-readonly",
    behavior: "historical_session_transcript_opened_readonly_from_real_workbench",
    turn_ids: [],
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "session_search_started_from_real_workbench",
      "history_session_snapshot_loaded_through_web_application_persistence",
      "exited_session_opened_as_read_only",
      "old_pending_adoptions_not_restored",
      "chat_input_and_send_disabled_while_viewing_history",
      "active_session_view_can_be_restored",
    ],
  };
}

function sessionNewActiveBehavior(records, evidence, _options) {
  const turnIds = evidence.turn_ids ?? [];
  const turnRecords = records.filter((record) => turnIds.includes(record.turn_id));
  if (hasErrorEvent(turnRecords)) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au03-session-new-active" &&
      record.new_active_session_id === evidence.session_id &&
      record.previous_active_session_id === evidence.previous_session_id,
  );
  if (!uiState) return null;

  const created = records.find(
    (record) =>
      record.event === "work_session.create.done" &&
      record.work_id === evidence.work_id &&
      record.session_id === evidence.session_id,
  );
  if (!created) return null;

  const shownPrevious = records.find(
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === evidence.work_id &&
      record.session_id === evidence.previous_session_id &&
      record.read_only === true,
  );
  if (!shownPrevious) return null;

  const contextDone = records.find(
    (record) =>
      record.event === "context.assemble.done" &&
      turnIds.includes(record.turn_id) &&
      record.has_conversation === false,
  );
  if (!contextDone) return null;

  if (uiState.previous_active_status_after_create !== "EXITED") return null;
  if (uiState.new_session_transcript_empty !== true) return null;
  if (uiState.old_active_absent_after_create !== true) return null;
  if (uiState.previous_active_readonly_opened !== true) return null;
  if (uiState.previous_active_input_disabled !== true) return null;
  if (uiState.previous_active_send_disabled !== true) return null;
  if (uiState.previous_active_transcript_visible_readonly !== true) return null;
  if (uiState.active_session_restored !== true) return null;
  if (uiState.user_message_session_id !== evidence.session_id) return null;
  if (uiState.new_session_message_visible !== true) return null;
  if (uiState.old_active_text_in_new_session !== false) return null;

  return {
    slice_id: "au03-session-new-active",
    behavior: "new_active_session_created_and_previous_active_reopened_readonly",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    previous_session_id: evidence.previous_session_id,
    assertions: [
      "new_session_action_started_from_real_workbench",
      "new_active_session_created_through_web_application_persistence",
      "previous_active_session_exited_after_create",
      "workbench_rejoined_new_active_session",
      "new_active_session_started_with_empty_transcript",
      "previous_active_session_reopened_as_read_only_history",
      "next_user_message_scoped_to_new_session",
      "first_new_session_turn_has_empty_conversation_context",
      "old_active_transcript_not_copied_into_new_session",
      "no_error_events",
    ],
  };
}

function branchFromHistoryBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au03-branch-from-history" &&
      record.branch_active_session_id === evidence.session_id,
  );
  if (!uiState) return null;

  const created = records.find(
    (record) =>
      record.event === "work_session.create.done" &&
      record.work_id === evidence.work_id &&
      record.session_id === evidence.session_id &&
      record.source_session_ref === evidence.source_session_ref &&
      record.source_turn_ref === evidence.source_turn_ref,
  );
  if (!created) return null;

  if (uiState.branch_readonly_banner_visible !== false) return null;
  if (uiState.branch_session_item_active !== true) return null;
  if (Number(uiState.branch_message_count ?? -1) !== 1) return null;

  return {
    slice_id: "au03-branch-from-history",
    behavior: "historical_session_branch_created_and_switched_from_real_workbench",
    turn_ids: [],
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    source_session_ref: evidence.source_session_ref,
    source_turn_ref: evidence.source_turn_ref,
    assertions: [
      "history_session_opened_readonly_before_branching",
      "branch_action_started_from_real_workbench_banner",
      "new_session_created_through_web_application_persistence",
      "branch_session_records_source_session_ref",
      "branch_session_records_source_turn_ref",
      "workbench_rejoined_new_active_session",
      "old_history_transcript_not_copied_into_branch",
      "no_error_events",
    ],
  };
}

function archiveSessionFilterBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au03-archive-session-filter" &&
      record.readonly_session_id === evidence.session_id,
  );
  if (!uiState) return null;

  const archiveDone = records.find(
    (record) =>
      record.event === "work_session.archive.done" &&
      record.work_id === evidence.work_id &&
      record.session_id === evidence.session_id &&
      record.status === "ARCHIVED",
  );
  if (!archiveDone) return null;

  if (uiState.archive_button_visible !== true) return null;
  if (uiState.archived_hidden_default !== true) return null;
  if (uiState.archived_search_found !== true) return null;
  if (uiState.archived_banner_visible !== true) return null;

  return {
    slice_id: "au03-archive-session-filter",
    behavior: "historical_session_archived_hidden_from_default_list_and_searchable",
    turn_ids: [],
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "archive_action_started_from_real_workbench_session_list",
      "session_archived_through_web_application_persistence",
      "archived_session_hidden_from_default_session_list",
      "archived_session_still_found_by_explicit_search",
      "archived_transcript_reopens_read_only_after_search",
      "archived_transcript_and_trace_not_deleted",
      "ordinary_context_filter_covered_by_application_test",
      "no_error_events",
    ],
  };
}

function currentWorkContextSsotBehavior(records, evidence, options) {
  const turnIds = evidence.turn_ids ?? [evidence.turn_id];
  const turnRecords = records.filter((record) => turnIds.includes(record.turn_id));
  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "context.assemble.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;
  if (!assistantMessagesAreValid(options.provider, turnIds, options.llmRecords ?? [])) return null;

  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au03-current-work-context-ssot",
  );
  if (!uiState) return null;
  if (uiState.active_session_restored !== true) return null;
  if (uiState.readonly_banner_visible === true) return null;

  const contextDone = turnRecords.find((record) => record.event === "context.assemble.done");
  if (!contextDone?.has_snapshot || !contextDone?.has_conversation) return null;
  if (Number(contextDone.context_refs_count ?? 0) < 2) return null;

  const requestMessages = lmstudioRequestMessages(options, turnIds[0]);
  if (options.provider === "lmstudio") {
    if (!requestMessages) return null;
    if (!messagesContainLatestWorkSnapshot(requestMessages)) return null;
    if (!messagesContainActiveSessionTranscript(requestMessages)) return null;
    if (messagesContainHistoricalSessionTranscript(requestMessages)) return null;
  }

  return {
    slice_id: "au03-current-work-context-ssot",
    behavior: "latest_work_snapshot_and_active_session_transcript_are_layered_into_context",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    readonly_session_id: evidence.readonly_session_id,
    assertions: [
      "history_session_opened_readonly_before_next_turn",
      "active_session_restored_before_author_message",
      "context_assembler_attached_current_work_snapshot",
      "context_assembler_attached_active_session_transcript",
      "planner_received_context_before_frame",
      "historical_session_transcript_did_not_replace_current_work_facts",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function longSessionCompressionBehavior(records, evidence, options) {
  const turnIds = evidence.turn_ids ?? [evidence.turn_id];
  const turnRecords = records.filter((record) => turnIds.includes(record.turn_id));
  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "context.assemble.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;
  if (!assistantMessagesAreValid(options.provider, turnIds, options.llmRecords ?? [])) return null;

  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au03-long-session-compression",
  );
  if (!uiState) return null;
  if (uiState.context_work_id !== evidence.work_id) return null;
  if (uiState.active_session_id !== evidence.session_id) return null;

  const contextDone = turnRecords.find((record) => record.event === "context.assemble.done");
  if (!contextDone?.has_conversation) return null;
  if (contextDone?.has_session_summary !== true) return null;
  if (Number(contextDone.context_refs_count ?? 0) < 1) return null;

  const requestMessages = lmstudioRequestMessages(options, turnIds[0]);
  if (options.provider === "lmstudio") {
    if (!requestMessages) return null;
    if (!messagesContainLongSessionSummary(requestMessages)) return null;
    if (!messagesContainLatestLongSessionWindow(requestMessages)) return null;
    if (messagesContainRawOldLongSessionTurns(requestMessages)) return null;
  }

  return {
    slice_id: "au03-long-session-compression",
    behavior: "long_active_session_context_uses_early_summary_and_recent_window",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "message_sent_from_real_workbench",
      "session_summary_attached_to_context",
      "old_turns_compressed_into_session_summary",
      "latest_recent_transcript_preserved_in_order",
      "planner_received_context_before_frame",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function contextSourceUiBehavior(records, evidence, options) {
  const turnIds = evidence.turn_ids ?? [evidence.turn_id];
  const turnRecords = records.filter((record) => turnIds.includes(record.turn_id));

  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "context.assemble.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;
  if (!assistantMessagesAreValid(options.provider, turnIds, options.llmRecords ?? [])) return null;

  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" && record.slice_id === "au03-context-source-ui",
  );
  if (!uiState?.trace_why_dialog_open) return null;
  if (uiState.trace_why_contains_raw_prompt === true) return null;
  if (uiState.context_work_id !== evidence.work_id) return null;
  if (uiState.active_session_id !== evidence.session_id) return null;

  const contextDone = turnRecords.find((record) => record.event === "context.assemble.done");
  if (!contextDone?.has_snapshot) return null;
  if (!contextDone?.has_conversation) return null;
  if (!contextDone?.has_memory) return null;
  if (Number(contextDone.context_refs_count ?? 0) < 3) return null;

  const traceText = String(uiState.trace_why_text ?? "");
  const hasSessionOrRecentDialogueSource =
    traceText.includes("当前会话记录") || traceText.includes("近期对话");
  if (!hasSessionOrRecentDialogueSource) return null;

  for (const expected of ["当前作品背景", "已确认设定", "灵源纪元", "灵源矿区"]) {
    if (!traceText.includes(expected)) return null;
  }

  return {
    slice_id: "au03-context-source-ui",
    behavior: "author_visible_context_sources_render_from_trace_summary",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "message_sent_from_real_workbench",
      "current_work_session_and_memory_context_attached",
      "why_entry_clicked_in_message_stream",
      "current_work_source_summary_visible",
      "session_or_recent_dialogue_source_summary_visible",
      "confirmed_memory_source_summary_visible",
      "raw_prompt_provider_debug_not_visible",
      "planner_received_context_before_frame",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function traceWhyEntryBehavior(records, evidence, options) {
  const turnIds = evidence.turn_ids ?? [evidence.turn_id];
  const turnRecords = records.filter((record) => turnIds.includes(record.turn_id));

  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" && record.slice_id === "au07-trace-why-entry",
  );
  if (!uiState?.trace_why_dialog_open) return null;
  if (uiState.trace_why_contains_raw_prompt === true) return null;

  return {
    slice_id: "au07-trace-why-entry",
    behavior: "author_opens_trace_why_dialog_from_real_workbench_message",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    assertions: [
      "message_sent_from_real_workbench",
      "trace_summary_returned_with_turn_result",
      "why_entry_clicked_in_message_stream",
      "author_safe_dialog_rendered",
      "decision_type_used_as_dialog_title",
      "audit_style_trace_labels_not_visible",
      "raw_prompt_provider_debug_not_visible",
      "explanation_does_not_call_provider_or_write_state",
    ],
  };
}

function gateReasonWhyBehavior(records, evidence, options) {
  const turnIds = evidence.turn_ids ?? [evidence.turn_id];
  const turnRecords = records.filter((record) => turnIds.includes(record.turn_id));

  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, true)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_micro_plan.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "orchestrator.decide.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "dialogue_gateway.handle_input.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame", "form_micro_plan"])) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au07-gate-reason-why" &&
      record.turn_id === turnIds[0],
  );
  if (!uiState) return null;
  if (uiState.decision_type !== "downgrade_to_dialogue") return null;
  if (uiState.first_blocking_gate !== "action_scope") return null;
  if (uiState.execution_blocked !== true) return null;
  if (uiState.tool_called !== false) return null;
  if (uiState.production_write_performed !== false) return null;
  if (uiState.trace_why_dialog_open !== true) return null;
  if (uiState.trace_why_contains_raw_prompt === true) return null;
  if (uiState.why_shows_downgrade_decision !== true) return null;
  if (uiState.why_shows_action_scope_gate !== true) return null;
  if (uiState.why_shows_micro_plan_evaluated !== true) return null;
  if (uiState.why_shows_no_provider_replay !== true) return null;
  if (uiState.why_hides_internal_gate_code !== true) return null;
  if (uiState.replay_provider_called === true) return null;
  if (hasEventPrefix(turnRecords, "toolbox.execute.")) return null;
  if (hasEventPrefix(turnRecords, "channel.author_action.")) return null;
  if (hasEventPrefix(turnRecords, "adoption.evaluate.")) return null;

  return {
    slice_id: "au07-gate-reason-why",
    behavior: "gate_downgrade_why_explains_action_scope_without_raw_leak",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    decision_type: evidence.decision_type,
    first_blocking_gate: evidence.first_blocking_gate,
    assertions: [
      "real_workbench_sent_multi_step_micro_plan_request",
      "orchestrator_downgraded_at_action_scope",
      "author_clicked_visible_why_on_downgraded_message",
      "why_dialog_explained_downgrade_decision",
      "why_dialog_explained_action_scope_boundary",
      "why_dialog_explained_micro_plan_evaluation",
      "replay_did_not_call_provider_or_write_state",
      "raw_prompt_provider_debug_and_internal_gate_codes_not_visible",
    ],
  };
}

function persistedTraceQueryBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au07-persisted-trace-query" &&
      record.turn_id === evidence.turn_id,
  );
  if (!uiState) return null;
  if (uiState.trace_why_dialog_open !== true) return null;
  if (uiState.trace_why_contains_raw_prompt === true) return null;
  if (uiState.persisted_trace_query_status !== 200) return null;
  if (uiState.persisted_trace_query_scoped !== true) return null;
  if (uiState.restored_after_reload !== true) return null;
  if (uiState.replay_report_provider_called === true) return null;
  if (uiState.replay_summary_provider_called === true) return null;
  if (uiState.persisted_replay_detail_visible !== true) return null;
  if (uiState.replay_no_provider_visible !== true) return null;
  if (uiState.production_write_performed === true || uiState.tool_called === true) return null;

  return {
    slice_id: "au07-persisted-trace-query",
    behavior: "old_turn_why_uses_scoped_persisted_replay_query",
    turn_ids: evidence.turn_ids ?? [evidence.turn_id],
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    replay_report_result_status: evidence.replay_report_result_status,
    assertions: [
      "message_sent_from_real_workbench",
      "assistant_turn_persisted_to_session_transcript",
      "workbench_reloaded_and_restored_old_turn",
      "author_clicked_visible_why_on_restored_message",
      "product_api_queried_replay_by_work_session_turn_scope",
      "persisted_replay_rendered_author_safe_summary",
      "replay_did_not_call_provider_or_write_state",
      "raw_prompt_provider_debug_not_visible",
    ],
  };
}

function partialReplayUiBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au07-partial-replay-ui" &&
      record.turn_id === evidence.turn_id,
  );
  if (!uiState) return null;
  if (uiState.trace_why_dialog_open !== true) return null;
  if (uiState.trace_why_contains_raw_prompt === true) return null;
  if (uiState.persisted_trace_query_status !== 200) return null;
  if (uiState.persisted_trace_query_scoped !== true) return null;
  if (uiState.restored_after_reload !== true) return null;
  if (uiState.replay_report_provider_called === true) return null;
  if (uiState.replay_summary_provider_called === true) return null;
  if (uiState.replay_report_result_status !== "partial") return null;
  if (!Array.isArray(uiState.replay_report_missing_trace_refs)) return null;
  if (uiState.replay_report_missing_trace_refs.length === 0) return null;
  if (uiState.replay_partial_visible !== true) return null;
  if (uiState.replay_no_provider_visible !== true) return null;
  if (uiState.production_write_performed === true || uiState.tool_called === true) return null;

  return {
    slice_id: "au07-partial-replay-ui",
    behavior: "old_turn_partial_replay_is_rendered_honestly_without_provider_or_write",
    turn_ids: evidence.turn_ids ?? [evidence.turn_id],
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    replay_report_result_status: evidence.replay_report_result_status,
    replay_report_missing_trace_refs: evidence.replay_report_missing_trace_refs,
    assertions: [
      "message_sent_from_real_workbench",
      "assistant_turn_persisted_to_session_transcript",
      "external_harness_inserted_incomplete_trace_for_same_scope",
      "workbench_reloaded_and_restored_old_turn",
      "author_clicked_visible_why_on_restored_message",
      "product_api_returned_partial_replay_with_missing_refs",
      "partial_replay_warning_rendered_in_author_safe_dialog",
      "replay_did_not_call_provider_or_write_state",
      "raw_prompt_provider_debug_not_visible",
    ],
  };
}

function traceQueryScopeNegativeMatrixBehavior(records, evidence, _options) {
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au07-trace-query-scope-negative-matrix" &&
      record.turn_id === evidence.turn_id,
  );
  if (!uiState) return null;
  if (uiState.valid_replay_status !== 200) return null;
  if (uiState.valid_replay_scoped !== true) return null;
  if (uiState.valid_replay_provider_called === true) return null;
  if (uiState.restored_after_reload !== true) return null;
  if (uiState.cross_work_replay_rejected !== true) return null;
  if (uiState.cross_session_replay_rejected !== true) return null;
  if (uiState.same_work_other_session_replay_rejected !== true) return null;
  if (uiState.missing_turn_replay_rejected !== true) return null;
  if (uiState.negative_errors_hidden_from_ui !== true) return null;
  if (uiState.negative_responses_leaked_trace === true) return null;
  if (uiState.production_write_performed === true || uiState.tool_called === true) return null;

  return {
    slice_id: "au07-trace-query-scope-negative-matrix",
    behavior: "trace_replay_query_rejects_cross_scope_without_trace_leak",
    turn_ids: evidence.turn_ids ?? [evidence.turn_id],
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    foreign_work_id: evidence.foreign_work_id,
    foreign_session_id: evidence.foreign_session_id,
    same_work_other_session_id: evidence.same_work_other_session_id,
    negative_replay_matrix: evidence.negative_replay_matrix,
    assertions: [
      "message_sent_from_real_workbench",
      "assistant_turn_persisted_to_session_transcript",
      "workbench_reloaded_and_restored_old_turn",
      "valid_replay_query_succeeded_for_original_work_session_turn",
      "foreign_work_with_source_session_was_rejected",
      "source_work_with_foreign_session_was_rejected",
      "same_work_other_session_with_source_turn_was_rejected",
      "missing_turn_in_valid_scope_was_rejected",
      "negative_responses_did_not_include_trace_summary_or_replay_report",
      "negative_errors_did_not_surface_in_product_ui",
      "replay_did_not_call_provider_or_write_state",
    ],
  };
}

function adoptionFollowupRoutingBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 1) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, true)) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "toolbox.execute.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "adoption.evaluate.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.adopt.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "slice_verify.ui_state.done")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame", "form_micro_plan"])) return null;

  const adoptDone = turnRecords.find((record) => record.event === "channel.adopt.done");
  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au05-adoption-followup-routing",
  );

  if (!adoptDone?.persisted || !adoptDone?.mutation_id) return null;
  if (adoptDone.artifact_type !== "character_seed") return null;
  if (adoptDone.reading_projection_materialized !== false) return null;
  if (uiState?.open_reading_action_count !== 0) return null;
  if (uiState?.reading_chapter_count !== 0) return null;

  return {
    slice_id: "au05-adoption-followup-routing",
    behavior: "setting_adoption_resolves_card_without_reading_followup",
    turn_ids: turnIds,
    mutation_id: adoptDone.mutation_id,
    assertions: [
      "character_artifact_generated_from_real_workbench",
      "author_clicked_accept_from_workbench",
      "adoption_persisted_as_mutation",
      "resolved_decision_card_rendered",
      "setting_adoption_did_not_materialize_reading_projection",
      "setting_decision_card_did_not_show_reading_followup",
      "pending_adoption_count_cleared",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function workspaceRuntimeStateBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  return {
    slice_id: "workspace-runtime-state",
    behavior:
      "workspace_runtime_state_normalizes_resume_connection_adoption_and_reading_empty_state",
    turn_ids: evidence.turn_ids,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "restored_transcript_did_not_insert_welcome",
      "work_ready_title_not_disconnected",
      "connection_state_separate_from_work_state",
      "pending_adoption_count_derived_from_runtime_state",
      "resolved_adoption_card_rendered_as_decision_record",
      "reading_mode_title_author_facing",
      "reading_projection_empty_state_has_no_fake_chapters",
      "no_error_events",
    ],
  };
}

function su02WorkSwitchingBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  const previousWorkRecords = records.filter(
    (record) => record.work_id === evidence.previous_work_id,
  );
  const currentWorkRecords = records.filter((record) => record.work_id === evidence.work_id);
  if (previousWorkRecords.length === 0 || currentWorkRecords.length === 0) return null;

  return {
    slice_id: "su02-work-switching",
    behavior: "runtime_work_switch_rejoins_channel_and_ignores_stale_pending_result",
    turn_ids: evidence.turn_ids,
    work_id: evidence.work_id,
    previous_work_id: evidence.previous_work_id,
    session_id: evidence.session_id,
    assertions: [
      "message_sent_from_previous_work_before_switch",
      "work_switcher_created_second_persisted_work",
      "channel_rejoined_with_new_workspace_topic",
      "ui_context_matches_new_channel_work_id",
      "new_work_message_stream_did_not_include_previous_pending_result",
      "last_opened_not_written_for_lobby_fallback",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function su02ArtifactProjectionTraceIsolationBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;
  if (evidence.source_work_id === evidence.target_work_id) return null;
  if (evidence.artifact_type !== "prose_fragment") return null;
  if (Number(evidence.source_chapter_count ?? 0) < 1) return null;
  if (Number(evidence.source_content_chars ?? 0) < 1) return null;
  if (Number(evidence.target_empty_toc_reads ?? 0) < 2) return null;

  const sourceRecords = records.filter((record) => record.work_id === evidence.source_work_id);
  const targetRecords = records.filter((record) => record.work_id === evidence.target_work_id);
  if (sourceRecords.length === 0 || targetRecords.length === 0) return null;

  return {
    slice_id: "su02-artifact-projection-trace-isolation",
    behavior: "artifact_projection_and_trace_are_scoped_to_current_work",
    turn_ids: evidence.turn_ids,
    draft_turn_id: evidence.draft_turn_id,
    adopt_turn_id: evidence.adopt_turn_id,
    target_trace_turn_id: evidence.target_trace_turn_id,
    work_id: evidence.work_id,
    source_work_id: evidence.source_work_id,
    target_work_id: evidence.target_work_id,
    artifact_id: evidence.artifact_id,
    artifact_type: evidence.artifact_type,
    source_trace_ref: evidence.source_trace_ref,
    target_trace_ref: evidence.target_trace_ref,
    assertions: [
      "source_pending_artifact_visible_before_switch",
      "target_work_did_not_render_source_pending_artifact",
      "target_reading_projection_empty_before_source_adoption",
      "switching_back_restored_source_pending_artifact",
      "source_accept_action_used_source_workspace_topic",
      "source_adoption_materialized_source_reading_projection",
      "target_reading_projection_remained_empty_after_source_adoption",
      "target_trace_and_why_excluded_source_artifact_context",
      "source_and_target_work_ids_are_distinct",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function su02EmptyStartUnnamedWorkBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;
  if (evidence.work_id === "lobby") return null;
  if (Number(evidence.duplicate_unnamed_count ?? 0) < 2) return null;
  if (evidence.second_unnamed_work_id === evidence.third_unnamed_work_id) return null;

  const workRecords = records.filter((record) => record.work_id === evidence.work_id);
  if (workRecords.length === 0) return null;

  return {
    slice_id: "su02-empty-start-unnamed-work",
    behavior: "empty_database_bootstrap_creates_renamable_unnamed_work",
    turn_ids: evidence.turn_ids,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    renamed_title: evidence.renamed_title,
    assertions: [
      "default_seed_and_seed_script_skipped_for_empty_start",
      "empty_start_created_single_persisted_unnamed_work",
      "auto_created_work_joined_real_workspace_channel",
      "message_after_empty_start_used_auto_created_work_id",
      "rename_preserved_auto_created_work_id",
      "message_remained_visible_after_rename",
      "duplicate_unnamed_works_have_visible_disambiguation",
      "lobby_not_used_as_current_work",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function su02PendingResultWorkIsolationBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  const sourceWorkRecords = records.filter((record) => record.work_id === evidence.source_work_id);
  const targetWorkRecords = records.filter((record) => record.work_id === evidence.target_work_id);
  if (sourceWorkRecords.length === 0 || targetWorkRecords.length === 0) return null;
  if (evidence.source_work_id === evidence.target_work_id) return null;
  if (Number(evidence.source_return_transcript_count ?? 0) < 1) return null;

  return {
    slice_id: "su02-pending-result-work-isolation",
    behavior: "slow_source_turn_result_does_not_pollute_target_work_and_restores_on_return",
    turn_ids: evidence.turn_ids,
    work_id: evidence.work_id,
    source_work_id: evidence.source_work_id,
    target_work_id: evidence.target_work_id,
    session_id: evidence.session_id,
    assertions: [
      "slow_message_sent_from_source_work",
      "target_work_joined_while_source_turn_pending",
      "source_turn_completed_under_original_work_id",
      "source_user_message_not_visible_in_target_work",
      "source_assistant_result_not_visible_in_target_work",
      "target_loading_not_polluted_by_source_completion",
      "switching_back_to_source_restored_completed_turn",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function su02WorkLifecycleManagementBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  const sourceWorkRecords = records.filter((record) => record.work_id === evidence.source_work_id);
  const createdWorkRecords = records.filter(
    (record) => record.work_id === evidence.created_work_id,
  );
  if (sourceWorkRecords.length === 0 || createdWorkRecords.length === 0) return null;
  if (evidence.work_id !== evidence.source_work_id) return null;
  if (evidence.discarded_status !== "DISCARDED") return null;
  if (evidence.visible_work_ids?.includes?.(evidence.discarded_work_id)) return null;

  return {
    slice_id: "su02-work-lifecycle-management",
    behavior: "work_lifecycle_named_create_rename_and_safe_discard",
    turn_ids: [],
    work_id: evidence.work_id,
    source_work_id: evidence.source_work_id,
    source_work_title: evidence.source_work_title,
    created_work_id: evidence.created_work_id,
    discarded_work_id: evidence.discarded_work_id,
    session_id: evidence.session_id,
    assertions: [
      "named_work_creation_started_from_visible_work_menu",
      "created_work_joined_real_workspace_channel",
      "rename_preserved_work_id",
      "delete_confirmation_included_author_visible_work_title",
      "safe_delete_marked_work_discarded_without_physical_delete",
      "discarded_work_hidden_from_default_work_list",
      "deleting_current_work_switched_to_source_work",
      "last_opened_not_restored_to_discarded_work",
      "no_product_acceptance_hooks",
      "no_error_events",
    ],
  };
}

function su02WorkRestartRecoveryBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;
  if (evidence.first_restored_work_id !== evidence.stale_last_opened_work_id) return null;
  if (evidence.work_id !== evidence.fallback_work_id) return null;
  if (evidence.work_id === evidence.discarded_work_id) return null;
  if (evidence.work_id === "lobby") return null;
  if (evidence.visible_work_ids?.includes?.(evidence.discarded_work_id)) return null;

  return {
    slice_id: "su02-work-restart-recovery",
    behavior: "work_restart_restores_existing_last_opened_and_skips_discarded",
    turn_ids: [],
    work_id: evidence.work_id,
    source_work_id: evidence.source_work_id,
    first_restored_work_id: evidence.first_restored_work_id,
    discarded_work_id: evidence.discarded_work_id,
    fallback_work_id: evidence.fallback_work_id,
    session_id: evidence.session_id,
    assertions: [
      "reload_restored_existing_last_opened_work",
      "discarded_last_opened_work_was_not_restored",
      "fallback_joined_real_workspace_channel",
      "fallback_replaced_stale_last_opened_preference",
      "discarded_work_hidden_from_default_work_list",
      "lobby_not_used_as_recovery_work",
      "no_error_events",
    ],
  };
}

function su03AssistantDisplayNameBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;
  if (evidence.sent_payload_includes_display_name !== false) return null;
  if (evidence.turn_result_contract_has_assistant_message !== true) return null;
  if (evidence.turn_result_has_display_name_key !== false) return null;

  const assertions = [
    "assistant_name_changed_from_real_workbench_entry",
    "assistant_message_role_remained_assistant",
    "turn_result_preserved_assistant_message_contract",
    "wire_payload_did_not_include_ui_display_name",
    "display_name_saved_for_current_work",
    "new_work_fell_back_to_default_ai_name",
    "switching_back_restored_original_work_name",
    "preference_did_not_touch_provider_or_turn_result_contract",
    "no_error_events",
  ];

  if (_options.provider === "lmstudio") {
    const turnIds = evidence.turn_ids ?? [];
    const relevant = (_options.llmRecords ?? []).filter(
      (record) =>
        turnIds.includes(record.turn_id) &&
        record.provider === "lmstudio" &&
        record.request?.method === "POST" &&
        Number(record.response?.status ?? 0) >= 200 &&
        Number(record.response?.status ?? 0) < 300,
    );
    if (relevant.length === 0) return null;
    if (
      relevant.some((record) =>
        JSON.stringify(record.request?.body ?? {}).includes(evidence.assistant_name_after_save),
      )
    ) {
      return null;
    }
    assertions.splice(4, 0, "lmstudio_request_did_not_include_ui_display_name");
  }

  return {
    slice_id: "su03-assistant-display-name",
    behavior: "assistant_display_name_is_work_scoped_ui_preference",
    turn_ids: evidence.turn_ids,
    work_id: evidence.work_id,
    created_work_id: evidence.created_work_id,
    assertions,
  };
}

function su01ProviderHealthBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  return {
    slice_id: "su01-provider-health-model",
    behavior: "provider_health_badge_displays_backend_metadata",
    turn_ids: [],
    work_id: evidence.work_id,
    assertions: [
      "provider_health_requested_through_real_workbench",
      "llm_badge_connected_state_came_from_backend_health",
      "llm_badge_displays_provider_or_model_label",
      "channel_joined_current_work",
      "no_error_events",
    ],
  };
}

function su01LmstudioDisconnectedHealthBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;
  if (evidence.provider !== "lmstudio") return null;
  if (!String(evidence.message ?? "").includes("LM Studio 未启动")) return null;

  return {
    slice_id: "su01-lmstudio-disconnected-health",
    behavior: "lmstudio_disconnected_health_is_visible_and_author_readable",
    turn_ids: [],
    work_id: evidence.work_id,
    provider: evidence.provider,
    model: evidence.model,
    assertions: [
      "provider_health_requested_through_real_workbench",
      "lmstudio_runtime_config_used_for_health_check",
      "visible_badge_showed_model_disconnected",
      "disconnected_reason_was_author_readable",
      "channel_joined_current_work",
      "no_error_events",
    ],
  };
}

function su01ProviderEndpointValidationBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  return {
    slice_id: "su01-provider-endpoint-validation",
    behavior: "invalid_provider_endpoint_is_blocked_before_runtime_request",
    turn_ids: [],
    work_id: evidence.work_id,
    provider_selected: evidence.provider_selected,
    invalid_endpoint: evidence.invalid_endpoint,
    assertions: [
      "model_settings_opened_from_real_workbench",
      "invalid_endpoint_hint_was_visible",
      "refresh_models_test_and_save_were_disabled",
      "invalid_endpoint_did_not_trigger_provider_models_request",
      "channel_joined_current_work",
      "no_error_events",
    ],
  };
}

function su01ProviderModelListSuccessBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  return {
    slice_id: "su01-provider-model-list-success",
    behavior: "provider_model_lists_load_through_backend_adapter_boundaries",
    turn_ids: [],
    work_id: evidence.work_id,
    deepseek_model_selected: evidence.deepseek_model_selected,
    anthropic_model_selected: evidence.anthropic_model_selected,
    lmstudio_model_selected: evidence.lmstudio_model_selected,
    assertions: [
      "model_settings_opened_from_real_workbench",
      "deepseek_model_list_loaded_through_adapter_http_boundary",
      "anthropic_model_list_loaded_through_adapter_http_boundary",
      "lmstudio_model_list_loaded_from_openai_compatible_endpoint",
      "models_were_selectable_in_the_visible_dialog",
      "api_keys_were_not_exposed_in_visible_text",
      "channel_joined_current_work",
      "no_error_events",
    ],
  };
}

function su01ProviderTestFailureUiBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  return {
    slice_id: "su01-provider-test-failure-ui",
    behavior: "provider_test_connection_failure_keeps_draft_and_recovers",
    turn_ids: [],
    work_id: evidence.work_id,
    provider_selected: evidence.provider_selected,
    model_selected_before_failure: evidence.model_selected_before_failure,
    assertions: [
      "model_settings_opened_from_real_workbench",
      "failed_test_connection_showed_author_readable_reason",
      "provider_and_endpoint_draft_were_preserved_after_failure",
      "dialog_remained_open_for_correction",
      "test_connection_did_not_create_turn_or_switch_runtime",
      "corrected_endpoint_test_connection_succeeded",
      "channel_joined_current_work",
      "no_error_events",
    ],
  };
}

function su01ProviderVendorMatrixBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  const serialized = JSON.stringify(records);
  if (serialized.includes("sk-vendor-matrix")) return null;

  return {
    slice_id: "su01-provider-vendor-matrix",
    behavior: "openai_compatible_vendor_matrix_distinguishes_auth_methods_and_redacts_secret",
    turn_ids: [],
    work_id: evidence.work_id,
    provider_selected: evidence.provider_selected,
    model_selected: evidence.model_selected,
    listed_vendor_ids: evidence.listed_vendor_ids,
    assertions: [
      "openai_minimax_zhipu_kimi_gemini_listed_from_backend_registry",
      "openai_subscription_auth_method_hint_visible",
      "failing_test_connection_kept_runtime_unchanged_and_created_no_turn",
      "save_switched_runtime_to_openai",
      "openai_api_key_and_subscription_are_distinct_entries",
      "provider_options_marked_api_key_configured_without_returning_secret",
      "visible_ui_browser_settings_business_logs_and_backend_logs_did_not_expose_api_key",
      "no_error_events",
    ],
  };
}

function su01ApiKeySecretRedactionBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  const serialized = JSON.stringify(records);
  if (serialized.includes("sk-slice-redaction")) return null;

  return {
    slice_id: "su01-api-key-secret-redaction",
    behavior: "provider_api_key_flow_redacts_secret_from_user_visible_and_plain_logs",
    turn_ids: [],
    work_id: evidence.work_id,
    provider_selected: evidence.provider_selected,
    model_selected: evidence.model_selected,
    assertions: [
      "model_settings_opened_from_real_workbench",
      "deepseek_model_list_loaded_through_adapter_http_boundary",
      "test_connection_succeeded_before_save",
      "provider_options_marked_api_key_configured_without_returning_secret",
      "provider_options_did_not_expose_api_key",
      "browser_fallback_settings_did_not_expose_api_key",
      "visible_ui_business_logs_and_backend_logs_did_not_expose_api_key",
      "no_error_events",
    ],
  };
}

function su01LocalSecretFileRoundtripBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  const serialized = JSON.stringify(records);
  if (serialized.includes("sk-slice-local-secret-file")) return null;

  return {
    slice_id: "su01-local-secret-file-roundtrip",
    behavior: "local_secret_file_write_read_roundtrip_from_real_tauri_webview",
    turn_ids: [],
    work_id: evidence.work_id,
    provider_selected: evidence.provider_selected,
    model_selected: evidence.model_selected,
    driver: evidence.driver,
    assertions: [
      "model_settings_opened_from_real_tauri_webview_by_external_cgevent_driver",
      "deepseek_api_key_saved_through_tauri_webview_command",
      "provider_secrets_file_written_with_owner_only_permissions",
      "backend_runtime_was_reset_then_webview_restart_restored_provider_from_local_secret_file",
      "provider_options_marked_api_key_configured_after_reload_without_returning_secret",
      "preferences_saved_non_secret_provider_state_without_api_key",
      "application_and_backend_logs_did_not_expose_api_key",
      "product_code_added_no_acceptance_hooks",
      "no_error_events",
    ],
  };
}

function su01ModelProviderSwitchingBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  const unsafe =
    JSON.stringify(records).includes("api_key") || JSON.stringify(records).includes("secret");
  if (unsafe) return null;

  return {
    slice_id: "su01-model-provider-switching",
    behavior: "model_provider_switch_applies_to_next_turn",
    turn_ids: evidence.turn_ids,
    work_id: evidence.work_id,
    provider_after_switch: evidence.provider_after_switch,
    model_after_switch: evidence.model_after_switch,
    assertions: [
      "model_settings_opened_from_real_workbench",
      "provider_options_came_from_backend_registry",
      "save_switched_runtime_provider",
      "post_switch_turn_used_stub_provider_in_gateway_log",
      "dialogue_remained_visible_after_switch",
      "provider_options_and_ui_state_did_not_expose_api_key",
      "no_error_events",
    ],
  };
}

function workSessionResumeBehavior(records, evidence, options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;
  if (
    !lmstudioHasSteps(options, evidence.turn_ids ?? [evidence.turn_id], [
      "form_frame",
      "form_micro_plan",
    ])
  ) {
    return null;
  }

  return {
    slice_id: "au03c-work-session-resume",
    behavior: "work_session_resume_restores_transcript_and_pending_adoption",
    turn_ids: evidence.turn_ids,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "reopened_same_work_session",
      "complete_transcript_restored_from_persistence",
      "pending_adoption_restored_to_workbench",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function authorFacingTitle(title) {
  const text = String(title ?? "").trim();
  if (!text) return false;
  if (text.includes("未连接") || text.includes("加载失败")) return false;
  if (/^as_\d+$/i.test(text)) return false;
  if (/^artifact[_-]/i.test(text)) return false;
  if (/^mock[_-]?work/i.test(text)) return false;
  return true;
}

function stageStartupContextBehavior(records, evidence, options) {
  const baseBehavior = workSessionResumeBehavior(records, evidence, options);
  if (!baseBehavior) return null;

  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "stage-startup-context-contract" &&
      record.work_id === evidence.work_id &&
      record.session_id === evidence.session_id,
  );
  if (!uiState) return null;

  return {
    slice_id: "stage-startup-context-contract",
    behavior: "startup_context_resumes_same_work_session_without_welcome_or_disconnected_state",
    turn_ids: evidence.turn_ids,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "reopened_same_work_session",
      "channel_join_matched_startup_work_and_session",
      "workspace_title_visible_after_resume",
      "service_status_connected",
      "welcome_message_not_inserted_after_restored_transcript",
      "pending_adoption_restored_to_workbench",
      "no_error_events",
      "assistant_messages_not_fallback",
    ],
  };
}

function hasErrorEvent(records) {
  return records.some((record) => record.outcome === "error" || record.event?.endsWith(".error"));
}

function hasFallbackText(records) {
  return records.some((record) => fallbackText(JSON.stringify(record)));
}

function fallbackText(text) {
  return (
    text.includes("无法连接") ||
    text.includes("格式不符合工作台契约") ||
    text.includes("这次处理失败") ||
    text.includes("请稍后再试")
  );
}

function assistantMessagesAreValid(provider, turnIds, llmRecords) {
  if (provider !== "lmstudio") return true;

  const relevant = llmRecords.filter(
    (record) =>
      turnIds.includes(record.turn_id) &&
      record.provider === "lmstudio" &&
      Number(record.response?.status ?? 0) >= 200 &&
      Number(record.response?.status ?? 0) < 300,
  );

  if (relevant.length === 0) return false;

  return relevant.every((record) => {
    const assistantMessage = assistantMessageFromLmStudioRecord(record);
    return assistantMessage && !fallbackText(assistantMessage);
  });
}

function lmstudioRequestMessages(options, turnId) {
  if (options.provider !== "lmstudio") return null;

  const record = (options.llmRecords ?? []).find(
    (candidate) =>
      candidate.turn_id === turnId &&
      candidate.provider === "lmstudio" &&
      candidate.step === "form_frame" &&
      Number(candidate.response?.status ?? 0) >= 200 &&
      Number(candidate.response?.status ?? 0) < 300,
  );

  const messages = record?.request?.body?.messages;
  return Array.isArray(messages) ? messages : null;
}

function messageContent(message) {
  return String(message?.content ?? "");
}

function messagesContainLatestWorkSnapshot(messages) {
  const system = messages.find((message) => message.role === "system");
  const content = messageContent(system);

  return (
    content.includes("## 当前作品上下文") &&
    content.includes("灵源纪元") &&
    content.includes("东方奇幻") &&
    content.includes("林澈为寻找妹妹林瑶追查灵源矿区真相") &&
    content.includes("克制、悬疑、带希望感")
  );
}

function messagesContainActiveSessionTranscript(messages) {
  return messages.some(
    (message) =>
      message.role === "user" &&
      messageContent(message).includes("当前会话确认") &&
      messageContent(message).includes("林澈"),
  );
}

function messagesContainHistoricalSessionTranscript(messages) {
  return messages.some(
    (message) =>
      messageContent(message).includes("主角当时叫林烬") ||
      messageContent(message).includes("旧讨论") ||
      messageContent(message).includes("离开故乡"),
  );
}

function messagesContainLongSessionSummary(messages) {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      messageContent(message).includes("会话早期摘要") &&
      (messageContent(message).includes("第1轮设定") ||
        messageContent(message).includes("第2轮设定")),
  );
}

function messagesContainLatestLongSessionWindow(messages) {
  const userContents = messages
    .filter((message) => message.role === "user")
    .map((message) => messageContent(message));
  const index3 = userContents.findIndex((content) => content.includes("第3轮设定"));
  const index12 = userContents.findIndex((content) => content.includes("第12轮设定"));

  return index3 >= 0 && index12 > index3;
}

function messagesContainRawOldLongSessionTurns(messages) {
  return messages.some(
    (message) =>
      message.role === "user" &&
      (messageContent(message).includes("第1轮设定") ||
        messageContent(message).includes("第2轮设定")),
  );
}

function assistantMessageFromLmStudioRecord(record) {
  try {
    const responseBody = JSON.parse(record.response.body);
    const content = responseBody?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") return "";

    if (record.step !== "form_frame" && record.step !== "form_micro_plan") {
      return content;
    }

    const parsed = JSON.parse(extractJson(content));
    return String(parsed.assistant_message ?? parsed.fallback_message ?? content);
  } catch {
    return "";
  }
}

function extractJson(content) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) return content.slice(start, end + 1);
  return content;
}

function turnsHaveEvent(turnIds, records, event) {
  return turnIds.every((turnId) =>
    records.some((record) => record.turn_id === turnId && record.event === event),
  );
}

function turnsHaveGenerateMicroPlan(turnIds, records, expected) {
  return turnIds.every((turnId) =>
    records.some(
      (record) =>
        record.turn_id === turnId &&
        record.event === "channel.user_message.start" &&
        record.generate_micro_plan === expected,
    ),
  );
}

function hasEventPrefix(records, prefix) {
  return records.some((record) => record.event?.startsWith(prefix));
}

function lmstudioHasSteps(options, turnIds, steps) {
  if (options.provider !== "lmstudio") return true;

  return turnIds.every((turnId) =>
    steps.every((step) =>
      (options.llmRecords ?? []).some(
        (record) =>
          record.turn_id === turnId &&
          record.provider === "lmstudio" &&
          record.step === step &&
          String(record.request?.url ?? "").includes("/chat/completions") &&
          Number(record.response?.status ?? 0) >= 200 &&
          Number(record.response?.status ?? 0) < 300,
      ),
    ),
  );
}

function findVs10LogSpineEvidence(records) {
  const keyEvents = keyEventsForSlice("vs10-observability-spine");
  const byTurn = groupByTurn(records);

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const hasAllEvents = keyEvents.every((event) =>
      turnRecords.some((record) => record.event === event && hasRequiredCorrelationFields(record)),
    );

    if (!hasAllEvents) continue;

    return {
      slice_id: "vs10-observability-spine",
      turn_id: turnId,
      key_events: keyEvents,
    };
  }

  return null;
}

function findOrdinaryChatTwoTurnEvidence(records) {
  const sliceId = "au01-ordinary-chat-two-turn-roundtrip";
  const keyEvents = keyEventsForSlice(sliceId);
  const byTurn = groupByTurn(records);
  const matchingTurnIds = [];

  for (const [turnId, turnRecords] of byTurn.entries()) {
    const start = turnRecords.find((record) => record.event === "channel.user_message.start");
    if (!start || start.generate_micro_plan !== false) continue;

    const hasRequiredEvents = keyEvents.every((event) =>
      turnRecords.some((record) => record.event === event && hasRequiredCorrelationFields(record)),
    );
    if (!hasRequiredEvents) continue;

    const hasMicroPlanEvent = turnRecords.some((record) =>
      record.event?.startsWith("planner.form_micro_plan."),
    );
    if (hasMicroPlanEvent) continue;

    matchingTurnIds.push(turnId);
  }

  if (matchingTurnIds.length < 2) return null;
  const turnIds = matchingTurnIds.slice(0, 2);
  const uiState = ordinaryChatUiState(
    turnIds,
    records.filter((record) => turnIds.includes(record.turn_id)),
  );
  if (!uiState) return null;

  return {
    slice_id: sliceId,
    turn_id: turnIds[0],
    turn_ids: turnIds,
    user_message_count: Number(uiState.user_message_count),
    assistant_turn_message_count: Number(uiState.assistant_turn_message_count),
    message_role_order: uiState.message_role_order,
    thinking_observed: uiState.thinking_observed,
    thinking_visible_after_reply: uiState.thinking_visible_after_reply,
    key_events: keyEvents,
  };
}

function ordinaryChatUiState(turnIds, turnRecords) {
  const uiState = turnRecords.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === "au01-ordinary-chat-two-turn-roundtrip" &&
      Array.isArray(record.ui_turn_ids) &&
      turnIds.every((turnId) => record.ui_turn_ids.includes(turnId)),
  );

  if (!uiState) return null;
  if (Number(uiState.user_message_count ?? 0) < 2) return null;
  if (Number(uiState.assistant_turn_message_count ?? 0) < 2) return null;
  if (uiState.thinking_observed !== true) return null;
  if (uiState.thinking_visible_after_reply !== false) return null;
  if (Number(uiState.available_action_count ?? 0) !== 0) return null;
  if (Number(uiState.card_action_count ?? 0) !== 0) return null;
  if (Number(uiState.candidate_panel_count ?? 0) !== 0) return null;
  if (Number(uiState.adoption_decision_card_count ?? 0) !== 0) return null;
  if (!containsRoleOrder(uiState.message_role_order, ["user", "assistant", "user", "assistant"])) {
    return null;
  }

  return uiState;
}

function findAu01EmptyMessageGuardEvidence(records) {
  const sliceId = "au01-empty-message-guard";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
  );
  if (!uiState) return null;

  const recoveryTurnId = uiState.recovery_turn_id ?? uiState.turn_id;
  if (!recoveryTurnId) return null;

  const recoveryRecords = records.filter((record) => record.turn_id === recoveryTurnId);
  const hasRequiredEvents = keyEvents.every((event) =>
    recoveryRecords.some(
      (record) => record.event === event && hasRequiredCorrelationFields(record),
    ),
  );
  if (!hasRequiredEvents) return null;

  const start = recoveryRecords.find((record) => record.event === "channel.user_message.start");
  if (!start || start.generate_micro_plan !== false) return null;
  if (recoveryRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }

  if (uiState.blank_attempted !== true) return null;
  if (Number(uiState.blank_user_message_frame_count ?? -1) !== 0) return null;
  if (uiState.message_count_unchanged_after_blank !== true) return null;
  if (uiState.input_enabled_after_blank !== true) return null;
  if (uiState.thinking_visible_after_blank !== false) return null;
  if (uiState.recovery_message_visible !== true) return null;
  if (uiState.recovery_assistant_reply_visible !== true) return null;
  if (uiState.recovery_generate_micro_plan !== false) return null;

  return {
    slice_id: sliceId,
    turn_id: recoveryTurnId,
    turn_ids: [recoveryTurnId],
    recovery_turn_id: recoveryTurnId,
    blank_user_message_frame_count: Number(uiState.blank_user_message_frame_count),
    message_count_unchanged_after_blank: uiState.message_count_unchanged_after_blank,
    input_enabled_after_blank: uiState.input_enabled_after_blank,
    thinking_visible_after_blank: uiState.thinking_visible_after_blank,
    recovery_message_visible: uiState.recovery_message_visible,
    recovery_assistant_reply_visible: uiState.recovery_assistant_reply_visible,
    key_events: keyEvents,
  };
}

function findAu01GarbageJsonRecoveryEvidence(records) {
  const sliceId = "au01-garbage-json-recovery";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
  );
  if (!uiState) return null;

  const garbageTurnId = uiState.garbage_turn_id;
  const recoveryTurnId = uiState.recovery_turn_id;
  if (!garbageTurnId || !recoveryTurnId || garbageTurnId === recoveryTurnId) return null;

  const turnIds = [garbageTurnId, recoveryTurnId];
  const allTurnRecords = records.filter((record) => turnIds.includes(record.turn_id));

  for (const turnId of turnIds) {
    const currentTurnRecords = allTurnRecords.filter((record) => record.turn_id === turnId);
    const hasRequiredEvents = keyEvents.every((event) =>
      currentTurnRecords.some(
        (record) => record.event === event && hasRequiredCorrelationFields(record),
      ),
    );
    if (!hasRequiredEvents) return null;

    const start = currentTurnRecords.find(
      (record) => record.event === "channel.user_message.start",
    );
    if (!start || start.generate_micro_plan !== false) return null;
    if (currentTurnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
      return null;
    }
  }

  if (uiState.fallback_message_visible !== true) return null;
  if (uiState.raw_provider_payload_visible !== false) return null;
  if (uiState.input_enabled_after_garbage !== true) return null;
  if (uiState.thinking_visible_after_garbage !== false) return null;
  if (uiState.channel_connected_after_garbage !== true) return null;
  if (uiState.garbage_generate_micro_plan !== false) return null;
  if (uiState.recovery_generate_micro_plan !== false) return null;
  if (uiState.recovery_message_visible !== true) return null;
  if (uiState.recovery_assistant_reply_visible !== true) return null;
  if (uiState.recovery_assistant_is_fallback !== false) return null;

  return {
    slice_id: sliceId,
    turn_id: garbageTurnId,
    turn_ids: turnIds,
    garbage_turn_id: garbageTurnId,
    recovery_turn_id: recoveryTurnId,
    fallback_message_visible: uiState.fallback_message_visible,
    raw_provider_payload_visible: uiState.raw_provider_payload_visible,
    input_enabled_after_garbage: uiState.input_enabled_after_garbage,
    thinking_visible_after_garbage: uiState.thinking_visible_after_garbage,
    channel_connected_after_garbage: uiState.channel_connected_after_garbage,
    recovery_message_visible: uiState.recovery_message_visible,
    recovery_assistant_reply_visible: uiState.recovery_assistant_reply_visible,
    recovery_assistant_is_fallback: uiState.recovery_assistant_is_fallback,
    key_events: keyEvents,
  };
}

function emptyMessageGuardBehavior(turnIds, turnRecords, evidence, options) {
  if (turnIds.length !== 1) return null;
  if (Number(evidence.blank_user_message_frame_count ?? -1) !== 0) return null;
  if (evidence.message_count_unchanged_after_blank !== true) return null;
  if (evidence.input_enabled_after_blank !== true) return null;
  if (evidence.thinking_visible_after_blank !== false) return null;
  if (evidence.recovery_message_visible !== true) return null;
  if (evidence.recovery_assistant_reply_visible !== true) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "dialogue_gateway.handle_input.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.user_message.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  return {
    slice_id: "au01-empty-message-guard",
    behavior: "empty_message_does_not_create_turn_and_recovery_chat_works",
    turn_ids: turnIds,
    assertions: [
      "blank_input_sent_no_user_message_frame",
      "blank_input_did_not_append_visible_messages",
      "blank_input_left_thinking_hidden",
      "input_remained_available_after_blank",
      "following_valid_chat_completed_without_micro_plan",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_for_recovery_turn"
        : "deterministic_provider_form_frame_called_for_recovery_turn",
    ],
  };
}

function garbageJsonRecoveryBehavior(turnIds, turnRecords, _records, evidence, options) {
  if (turnIds.length !== 2) return null;
  if (evidence.fallback_message_visible !== true) return null;
  if (evidence.raw_provider_payload_visible !== false) return null;
  if (evidence.input_enabled_after_garbage !== true) return null;
  if (evidence.thinking_visible_after_garbage !== false) return null;
  if (evidence.channel_connected_after_garbage !== true) return null;
  if (evidence.recovery_message_visible !== true) return null;
  if (evidence.recovery_assistant_reply_visible !== true) return null;
  if (evidence.recovery_assistant_is_fallback !== false) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "dialogue_gateway.handle_input.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.user_message.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (turnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }

  return {
    slice_id: "au01-garbage-json-recovery",
    behavior: "malformed_provider_json_falls_back_without_leaking_payload_and_recovers",
    turn_ids: turnIds,
    assertions: [
      "malformed_provider_json_rendered_friendly_fallback",
      "raw_provider_payload_not_visible",
      "input_remained_available_after_malformed_json",
      "channel_remained_connected_after_malformed_json",
      "following_valid_chat_completed_without_micro_plan",
      options.provider === "lmstudio"
        ? "lmstudio_recovery_turn_completed"
        : "deterministic_provider_recovery_turn_completed",
    ],
  };
}

function findAu01FrameValidationFriendlyErrorEvidence(records) {
  const sliceId = "au01-frame-validation-friendly-error";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
  );
  if (!uiState) return null;

  const invalidTurnId = uiState.invalid_frame_turn_id;
  const recoveryTurnId = uiState.recovery_turn_id;
  if (!invalidTurnId || !recoveryTurnId || invalidTurnId === recoveryTurnId) return null;

  const invalidRecords = records.filter((record) => record.turn_id === invalidTurnId);
  const recoveryRecords = records.filter((record) => record.turn_id === recoveryTurnId);

  const invalidRequiredEvents = [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.error",
    "channel.user_message.error",
  ];
  const recoveryRequiredEvents = [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
  ];

  if (!eventsPresentWithCorrelation(invalidRecords, invalidRequiredEvents)) return null;
  if (!eventsPresentWithCorrelation(recoveryRecords, recoveryRequiredEvents)) return null;

  const invalidStart = invalidRecords.find(
    (record) => record.event === "channel.user_message.start",
  );
  const recoveryStart = recoveryRecords.find(
    (record) => record.event === "channel.user_message.start",
  );
  if (!invalidStart || invalidStart.generate_micro_plan !== false) return null;
  if (!recoveryStart || recoveryStart.generate_micro_plan !== false) return null;
  if (
    [...invalidRecords, ...recoveryRecords].some((record) =>
      record.event?.startsWith("planner.form_micro_plan."),
    )
  ) {
    return null;
  }

  if (uiState.fallback_message_visible !== true) return null;
  if (uiState.internal_validation_reason_visible !== false) return null;
  if (uiState.internal_validation_reason_in_turn_result !== false) return null;
  if (uiState.input_enabled_after_invalid_frame !== true) return null;
  if (uiState.thinking_visible_after_invalid_frame !== false) return null;
  if (uiState.channel_connected_after_invalid_frame !== true) return null;
  if (uiState.invalid_frame_generate_micro_plan !== false) return null;
  if (uiState.recovery_generate_micro_plan !== false) return null;
  if (uiState.recovery_message_visible !== true) return null;
  if (uiState.recovery_assistant_reply_visible !== true) return null;
  if (uiState.recovery_assistant_is_fallback !== false) return null;

  return {
    slice_id: sliceId,
    turn_id: invalidTurnId,
    turn_ids: [invalidTurnId, recoveryTurnId],
    invalid_frame_turn_id: invalidTurnId,
    recovery_turn_id: recoveryTurnId,
    fallback_message_visible: uiState.fallback_message_visible,
    internal_validation_reason_visible: uiState.internal_validation_reason_visible,
    internal_validation_reason_in_turn_result: uiState.internal_validation_reason_in_turn_result,
    input_enabled_after_invalid_frame: uiState.input_enabled_after_invalid_frame,
    thinking_visible_after_invalid_frame: uiState.thinking_visible_after_invalid_frame,
    channel_connected_after_invalid_frame: uiState.channel_connected_after_invalid_frame,
    recovery_message_visible: uiState.recovery_message_visible,
    recovery_assistant_reply_visible: uiState.recovery_assistant_reply_visible,
    recovery_assistant_is_fallback: uiState.recovery_assistant_is_fallback,
    key_events: keyEvents,
  };
}

function frameValidationFriendlyErrorBehavior(turnIds, turnRecords, _records, evidence, options) {
  if (turnIds.length !== 2) return null;
  const [invalidTurnId, recoveryTurnId] = turnIds;
  const invalidRecords = turnRecords.filter((record) => record.turn_id === invalidTurnId);
  const recoveryRecords = turnRecords.filter((record) => record.turn_id === recoveryTurnId);

  if (evidence.fallback_message_visible !== true) return null;
  if (evidence.internal_validation_reason_visible !== false) return null;
  if (evidence.internal_validation_reason_in_turn_result !== false) return null;
  if (evidence.input_enabled_after_invalid_frame !== true) return null;
  if (evidence.thinking_visible_after_invalid_frame !== false) return null;
  if (evidence.channel_connected_after_invalid_frame !== true) return null;
  if (evidence.recovery_message_visible !== true) return null;
  if (evidence.recovery_assistant_reply_visible !== true) return null;
  if (evidence.recovery_assistant_is_fallback !== false) return null;
  if (
    !eventsPresentWithCorrelation(invalidRecords, [
      "dialogue_gateway.handle_input.error",
      "channel.user_message.error",
    ])
  ) {
    return null;
  }
  if (
    !eventsPresentWithCorrelation(recoveryRecords, [
      "dialogue_gateway.handle_input.done",
      "channel.user_message.done",
    ])
  ) {
    return null;
  }
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (turnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }

  return {
    slice_id: "au01-frame-validation-friendly-error",
    behavior: "forbidden_frame_semantics_are_blocked_without_leaking_internal_reason",
    turn_ids: turnIds,
    assertions: [
      "forbidden_frame_semantics_blocked_at_gateway",
      "author_visible_fallback_is_friendly",
      "internal_validation_reason_not_visible",
      "internal_validation_reason_not_in_turn_result",
      "input_remained_available_after_frame_validation_failure",
      "following_valid_chat_completed_without_micro_plan",
      options.provider === "lmstudio"
        ? "lmstudio_recovery_turn_completed"
        : "deterministic_provider_recovery_turn_completed",
    ],
  };
}

function findAu01TurnresultRecorderUiConsistencyEvidence(records) {
  const sliceId = "au01-turnresult-recorder-ui-consistency";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === sliceId,
  );
  if (!uiState) return null;

  const turnId = uiState.turn_id;
  const workId = uiState.work_id;
  const sessionId = uiState.session_id;
  if (!turnId || !workId || !sessionId) return null;

  const turnRecords = records.filter((record) => record.turn_id === turnId);
  if (
    !eventsPresentWithCorrelation(turnRecords, [
      "channel.user_message.start",
      "dialogue_gateway.handle_input.done",
      "channel.user_message.done",
    ])
  ) {
    return null;
  }

  const joined = records.find(
    (record) =>
      record.event === "channel.join.done" &&
      record.work_id === workId &&
      record.session_id === sessionId,
  );
  const shown = records.find(
    (record) =>
      record.event === "work_session.show.done" &&
      record.work_id === workId &&
      record.session_id === sessionId &&
      record.read_only === false,
  );
  const resumed = records.find(
    (record) =>
      record.event === "work_session.resume.done" &&
      record.work_id === workId &&
      record.session_id === sessionId &&
      Number(record.transcript_count ?? 0) >= Number(uiState.reload_resume_transcript_count ?? 0),
  );
  if (!joined || !shown || !resumed) return null;
  if (Number(shown.transcript_count ?? 0) < 2) return null;

  if (uiState.current_ui_user_message_visible !== true) return null;
  if (uiState.current_ui_assistant_visible !== true) return null;
  if (uiState.transcript_user_row_found !== true) return null;
  if (uiState.transcript_assistant_row_found !== true) return null;
  if (uiState.transcript_user_text_matches_ui !== true) return null;
  if (uiState.transcript_assistant_text_matches_ui !== true) return null;
  if (uiState.transcript_turn_result_turn_id_matches_websocket !== true) return null;
  if (uiState.transcript_turn_result_assistant_text_matches_websocket !== true) return null;
  if (uiState.session_snapshot_read_only !== false) return null;
  if (uiState.restored_ui_user_message_visible !== true) return null;
  if (uiState.restored_ui_assistant_visible !== true) return null;
  if (uiState.restored_input_enabled !== true) return null;
  if (uiState.restored_send_enabled !== true) return null;
  if (uiState.generate_micro_plan !== false) return null;
  if (turnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }

  return {
    slice_id: sliceId,
    turn_id: turnId,
    turn_ids: [turnId],
    work_id: workId,
    session_id: sessionId,
    transcript_count: shown.transcript_count,
    reload_resume_transcript_count: uiState.reload_resume_transcript_count,
    current_ui_assistant_visible: uiState.current_ui_assistant_visible,
    transcript_assistant_text_matches_ui: uiState.transcript_assistant_text_matches_ui,
    transcript_turn_result_assistant_text_matches_websocket:
      uiState.transcript_turn_result_assistant_text_matches_websocket,
    restored_ui_assistant_visible: uiState.restored_ui_assistant_visible,
    key_events: keyEvents,
  };
}

function turnresultRecorderUiConsistencyBehavior(
  turnIds,
  turnRecords,
  _records,
  evidence,
  options,
) {
  if (turnIds.length !== 1) return null;
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (turnRecords.some((record) => record.event?.startsWith("planner.form_micro_plan."))) {
    return null;
  }
  if (evidence.current_ui_assistant_visible !== true) return null;
  if (evidence.transcript_assistant_text_matches_ui !== true) return null;
  if (evidence.transcript_turn_result_assistant_text_matches_websocket !== true) return null;
  if (evidence.restored_ui_assistant_visible !== true) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  return {
    slice_id: "au01-turnresult-recorder-ui-consistency",
    behavior: "turn_result_assistant_message_matches_recorder_transcript_and_restored_ui",
    turn_ids: turnIds,
    work_id: evidence.work_id,
    session_id: evidence.session_id,
    assertions: [
      "ordinary_chat_sent_from_real_workbench",
      "visible_assistant_text_came_from_websocket_turn_result",
      "interaction_recorder_persisted_user_and_assistant_rows",
      "assistant_transcript_text_matches_visible_ui",
      "assistant_transcript_turn_result_matches_websocket_turn_result",
      "active_session_snapshot_loaded_through_web_application_persistence",
      "webview_reload_restored_the_same_transcript_text",
      "ordinary_chat_did_not_request_micro_plan",
      options.provider === "lmstudio"
        ? "lmstudio_form_frame_called_for_recorder_turn"
        : "deterministic_provider_form_frame_called_for_recorder_turn",
    ],
  };
}

function eventsPresentWithCorrelation(records, events) {
  return events.every((event) =>
    records.some((record) => record.event === event && hasRequiredCorrelationFields(record)),
  );
}

function hasToolTraceRef(refs) {
  return Array.isArray(refs) && refs.some(isToolTraceRef);
}

function isToolTraceRef(ref) {
  if (typeof ref === "string") return ref.startsWith("tool_trace:");
  if (!ref || typeof ref !== "object") return false;

  return Boolean(ref.tool_name && ref.tool_request_ref && ref.tool_result_ref);
}

function containsRoleOrder(actual, expected) {
  if (!Array.isArray(actual)) return false;

  let offset = 0;
  for (const role of actual) {
    if (role === expected[offset]) offset += 1;
    if (offset === expected.length) return true;
  }

  return false;
}

function groupByTurn(records) {
  const byTurn = new Map();

  for (const record of records) {
    if (!record.turn_id) continue;
    const turnRecords = byTurn.get(record.turn_id) ?? [];
    turnRecords.push(record);
    byTurn.set(record.turn_id, turnRecords);
  }

  return byTurn;
}

function hasRequiredCorrelationFields(record) {
  return (
    Boolean(record.turn_id) &&
    Boolean(record.workspace_id) &&
    Boolean(record.work_id) &&
    typeof record.duration_ms === "number" &&
    Boolean(record.outcome)
  );
}
