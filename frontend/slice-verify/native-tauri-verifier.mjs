export const nativeSliceIds = [
  "workspace-runtime-state",
  "su02-work-switching",
  "su01-provider-health-model",
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
  "au09-memory-recall-context",
  "au03-session-history-readonly",
  "au03-branch-from-history",
  "au03-archive-session-filter",
  "au03-current-work-context-ssot",
  "au03-long-session-compression",
  "au03-context-source-ui",
  "au07-trace-why-entry",
  "au10-workbench-matrix-layout",
  "au10-micro-plan-entry",
  "au10-ordinary-chat-no-micro-plan",
  "au01-ordinary-chat-two-turn-roundtrip",
  "au02-candidate-continuation",
  "au02-candidate-adoption-bridge",
  "au05-adoption-safety-freshness",
  "au05-stale-conflict-cross-work-freshness",
  "au05-conflict-cross-work-recovery",
  "au05-canon-conflict-recovery",
  "p1-chapter-plan-minimum",
  "p1-chapter-draft-generation",
  "p1-chapter-adoption-reading",
  "p1-word-count-audit",
  "p1-chapter-edit-then-accept",
  "p1-chapter-overwrite-confirm",
  "p1-chapter-expansion",
  "p1-chapter-expansion-multichapter",
  "p1-chapter-word-count-target",
  "p1-export-minimum",
  "p1-plan-incremental",
  "au04-confirm-before-execute",
  "vs00c-cp0-missing-chapter-block",
  "vs00c-cp3-structured-context",
  "vs00c-cp4-chapter-plan-structure",
  "vs00c-cp5-reader-effect-brief",
  "au09-memory-create-recall",
  "au09-adopt-setting-recall",
  "au09-validity-window-recall",
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
  "su01-provider-health-model": ["channel.join.done", "slice_verify.ui_state.done"],
  "su01-model-provider-switching": [
    "channel.join.done",
    "channel.user_message.start",
    "provider_gateway.complete.done",
    "channel.user_message.done",
    "slice_verify.ui_state.done",
  ],
  "su03-assistant-display-name": ["channel.join.done", "slice_verify.ui_state.done"],
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
  "au09-adopt-setting-recall": [
    "channel.user_message.start",
    "toolbox.execute.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
    "context.assemble.done",
    "slice_verify.ui_state.done",
  ],
  "au09-validity-window-recall": [
    "channel.user_message.start",
    "context.assemble.done",
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
  "au10-workbench-matrix-layout": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
    "channel.author_action.start",
    "adoption.evaluate.done",
    "channel.author_action.done",
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
  "au02-candidate-continuation": [
    "channel.user_message.start",
    "dialogue_gateway.handle_input.start",
    "planner.form_frame.done",
    "dialogue_gateway.handle_input.done",
    "channel.user_message.done",
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

  if (sliceId === "su01-provider-health-model") {
    return findSu01ProviderHealthEvidence(records);
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

  if (sliceId === "au09-archive-real-data") {
    return findAu09ArchiveEvidence(records);
  }

  if (sliceId === "au09-memory-recall-context") {
    return findAu09MemoryRecallEvidence(records);
  }

  if (sliceId === "au03-session-history-readonly") {
    return findAu03SessionHistoryReadonlyEvidence(records);
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

  if (sliceId === "au10-workbench-matrix-layout") {
    return findAu10WorkbenchMatrixLayoutEvidence(records);
  }

  if (sliceId === "au10-micro-plan-entry") {
    return findAu10UserMessageEvidence(records, true, "au10-micro-plan-entry");
  }

  if (sliceId === "au10-ordinary-chat-no-micro-plan") {
    return findAu10UserMessageEvidence(records, false, "au10-ordinary-chat-no-micro-plan");
  }

  if (sliceId === "au01-ordinary-chat-two-turn-roundtrip") {
    return findOrdinaryChatTwoTurnEvidence(records);
  }

  if (sliceId === "au02-candidate-continuation") {
    return findCandidateContinuationEvidence(records);
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

  if (sliceId === "p1-chapter-word-count-target") {
    return findP1ChapterWordCountTargetEvidence(records);
  }

  if (sliceId === "au04-confirm-before-execute") {
    return findAu04ConfirmBeforeExecuteEvidence(records);
  }

  if (sliceId === "vs00c-cp0-missing-chapter-block") {
    return findVs00cMissingChapterBlockEvidence(records);
  }

  if (sliceId === "vs00c-cp3-structured-context") {
    return findVs00cCp3StructuredContextEvidence(records);
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

  if (sliceId === "au09-adopt-setting-recall") {
    return findAu09AdoptSettingRecallEvidence(records);
  }

  if (sliceId === "au09-validity-window-recall") {
    return findAu09ValidityWindowRecallEvidence(records);
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

  if (sliceId === "su01-provider-health-model") {
    return su01ProviderHealthBehavior(records, evidence, options);
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

  if (sliceId === "au09-archive-real-data") {
    return archiveRealDataBehavior(records, evidence, options);
  }

  if (sliceId === "au09-memory-recall-context") {
    return memoryRecallContextBehavior(records, evidence, options);
  }

  if (sliceId === "au03-session-history-readonly") {
    return sessionHistoryReadonlyBehavior(records, evidence, options);
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

  if (sliceId === "p1-chapter-word-count-target") {
    return p1ChapterWordCountTargetBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au04-confirm-before-execute") {
    return au04ConfirmBeforeExecuteBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "p1-export-minimum") {
    return p1ExportMinimumBehavior(turnIds, turnRecords, records, evidence, options);
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

  if (sliceId === "au09-adopt-setting-recall") {
    return au09AdoptSettingRecallBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "au09-validity-window-recall") {
    return au09ValidityWindowRecallBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "vs00c-cp0-missing-chapter-block") {
    return vs00cMissingChapterBlockBehavior(turnIds, turnRecords, records, evidence, options);
  }

  if (sliceId === "vs00c-cp3-structured-context") {
    return vs00cCp3StructuredContextBehavior(turnIds, turnRecords, records, evidence, options);
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

  if (sliceId === "au02-candidate-continuation") {
    return candidateContinuationBehavior(turnIds, turnRecords, options);
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
    if (uiState.assistant_name_in_created_work !== "AI") continue;
    if (uiState.assistant_name_after_return !== "创作助手") continue;
    if (uiState.assistant_role_after_return !== "创作助手") continue;
    if (uiState.socket_connected !== true) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: initialWorkId,
      created_work_id: createdWorkId,
      assistant_name_after_save: uiState.assistant_name_after_save,
      assistant_name_in_created_work: uiState.assistant_name_in_created_work,
      assistant_name_after_return: uiState.assistant_name_after_return,
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

function findAu09ArchiveEvidence(records) {
  const sliceId = "au09-archive-real-data";
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
    if (Number(uiState.archive_memory_items ?? 0) < 2) continue;
    if (Number(uiState.archive_drafts_accepted ?? 0) < 1) continue;
    if (uiState.archive_detail_kind !== "memory") continue;
    if (String(uiState.archive_detail_id ?? "").length < 1) continue;
    if (String(uiState.archive_detail_title ?? "").length < 1) continue;

    return {
      slice_id: sliceId,
      turn_ids: [],
      work_id: workId,
      key_events: keyEvents,
      archive_character_count: uiState.archive_character_count,
      archive_foreshadowing_count: uiState.archive_foreshadowing_count,
      archive_rule_count: uiState.archive_rule_count,
      archive_memory_items: uiState.archive_memory_items,
      archive_drafts_accepted: uiState.archive_drafts_accepted,
      archive_detail_kind: uiState.archive_detail_kind,
      archive_detail_title: uiState.archive_detail_title,
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
    if (!traceText.includes("参考来源")) continue;
    if (!traceText.includes("当前作品背景")) continue;
    if (!traceText.includes("近期对话")) continue;
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
    if (!traceText.includes("探索方向")) continue;
    if (traceText.includes("本轮解释")) continue;
    if (traceText.includes("系统判断")) continue;
    if (traceText.includes("为什么这样做")) continue;
    if (traceText.includes("本轮目标")) continue;
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

function findCandidateAdoptionBridgeEvidence(records) {
  const sliceId = "au02-candidate-adoption-bridge";
  const keyEvents = keyEventsForSlice(sliceId);
  const uiState = records.find(
    (record) =>
      record.event === "slice_verify.ui_state.done" &&
      record.slice_id === sliceId &&
      record.candidate_continue_clicked === true &&
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
    key_events: keyEvents,
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

function findAu04ConfirmBeforeExecuteEvidence(records) {
  const sliceId = "au04-confirm-before-execute";
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
      "no_tool_call_or_production_write_before_confirm",
      "confirm_action_bound_to_open_confirmation_behavior",
      "re_gate_allows_and_dispatches_prose_writing_same_turn",
      "executed_output_stays_tentative_pending_adoption",
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
    prior_prose_context_events: continuityEvents.length,
    assertions: [
      "first_chapter_draft_adopted_as_sub_1000_short_chapter",
      "natural_language_continuation_recognized_as_authoring_intent_continuation_by_planner",
      "each_continuation_appended_a_new_scene_to_the_same_chapter",
      "continuations_did_not_supersede_or_fork_a_new_chapter",
      "single_chapter_accumulated_past_p1_1000_word_minimum",
      "short_chapter_flipped_to_ok_after_accumulation",
      "each_continuation_prose_writing_received_prior_chapter_prose_for_coherent_continuation",
    ],
  };
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

  // 设定确实由某个创作工具生成（world_building/plot_outline/character_design 等），并经 accept 采纳。
  const generatedSetting = records.some(
    (record) =>
      record.event === "toolbox.execute.done" &&
      record.tool_outcome === "succeeded" &&
      record.tool_name !== "prose_writing",
  );
  if (!generatedSetting) return null;

  const adoptDone = records.find(
    (record) =>
      record.event === "channel.author_action.done" &&
      record.action_type === "accept" &&
      record.action_status === "accepted",
  );
  if (!adoptDone) return null;

  return {
    slice_id: sliceId,
    turn_id: recallTurnId,
    turn_ids: [recallTurnId],
    setting_chunk: uiState.setting_chunk,
    setting_artifact_id: uiState.setting_artifact_id,
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
    setting_chunk: uiState.setting_chunk,
    assertions: [
      "ai_generated_a_setting_artifact_from_real_workbench",
      "author_adopted_setting_into_confirmed_recallable_governed_memory",
      "adopted_setting_recalled_into_later_turn_context",
      "why_panel_shows_confirmed_memory_as_author_safe_source",
      options.provider === "lmstudio"
        ? "lmstudio_prompt_included_adopted_setting"
        : "deterministic_context_assembled_with_adopted_setting",
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
    behavior: "candidate_continuation_authorized_by_available_action",
    turn_ids: turnIds,
    source_turn_ref: sourceTurnId,
    continuation_turn_id: null,
    candidate_ref: candidateRef,
    candidate_set_ref: uiState.candidate_set_ref,
    assertions: [
      "candidate_panel_rendered_from_turn_result",
      "candidate_continuation_sent_authorized_choose_candidate_action",
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

function archiveRealDataBehavior(_records, evidence, _options) {
  if (!evidence?.work_id) return null;
  if (Number(evidence.archive_character_count ?? 0) < 1) return null;
  if (Number(evidence.archive_foreshadowing_count ?? 0) < 1) return null;
  if (Number(evidence.archive_rule_count ?? 0) < 1) return null;
  if (Number(evidence.archive_memory_items ?? 0) < 2) return null;
  if (Number(evidence.archive_drafts_accepted ?? 0) < 1) return null;
  if (evidence.archive_detail_kind !== "memory") return null;
  if (String(evidence.archive_detail_title ?? "").length < 1) return null;

  return {
    slice_id: "au09-archive-real-data",
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
  for (const expected of ["当前作品背景", "近期对话", "已确认设定", "灵源纪元", "灵源矿区"]) {
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
      "recent_dialogue_source_summary_visible",
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

function su03AssistantDisplayNameBehavior(records, evidence, _options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;

  return {
    slice_id: "su03-assistant-display-name",
    behavior: "assistant_display_name_is_work_scoped_ui_preference",
    turn_ids: [],
    work_id: evidence.work_id,
    created_work_id: evidence.created_work_id,
    assertions: [
      "assistant_name_changed_from_real_workbench_entry",
      "assistant_message_role_remained_assistant",
      "display_name_saved_for_current_work",
      "new_work_fell_back_to_default_ai_name",
      "switching_back_restored_original_work_name",
      "preference_did_not_touch_provider_or_turn_result_contract",
      "no_error_events",
    ],
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
