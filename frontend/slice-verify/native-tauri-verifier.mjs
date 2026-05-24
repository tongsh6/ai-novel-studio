export const nativeSliceIds = [
  "workspace-runtime-state",
  "su02-work-switching",
  "su01-provider-health-model",
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
  "au10-micro-plan-entry",
  "au10-ordinary-chat-no-micro-plan",
  "au01-ordinary-chat-two-turn-roundtrip",
  "au02-candidate-continuation",
  "au02-candidate-adoption-bridge",
  "au05-adoption-safety-freshness",
  "au05-stale-conflict-cross-work-freshness",
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
  "su01-provider-health-model": [
    "channel.join.done",
    "slice_verify.ui_state.done",
  ],
  "su03-assistant-display-name": [
    "channel.join.done",
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
      (record) => record.event === "channel.user_message.start" && record.generate_micro_plan === true,
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
      (record) =>
        record.event === "channel.get_toc.done" &&
        record.work_id === resumed.work_id,
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
      turnRecords.some(
        (record) => record.event === event && hasRequiredCorrelationFields(record),
      ),
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
      turnRecords.some(
        (record) => record.event === event && hasRequiredCorrelationFields(record),
      ),
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
      record.candidate_adopt_clicked === true &&
      record.visible_adoption_result === true &&
      record.adoption_decision_type === "adopt_tentative" &&
      record.candidate_selected === true &&
      record.candidate_adopted === true &&
      record.production_write_performed === false,
  );

  if (!uiState) return null;

  const sourceTurnId = String(uiState.source_turn_id ?? "");
  const continuationTurnId = String(uiState.continuation_turn_id ?? "");
  const adoptionTurnId = String(uiState.adoption_turn_id ?? "");
  if (!sourceTurnId || !continuationTurnId || !adoptionTurnId) return null;

  const sourceRecords = records.filter((record) => record.turn_id === sourceTurnId);
  const continuationRecords = records.filter((record) => record.turn_id === continuationTurnId);
  const actionRecords = records.filter(
    (record) =>
      record.turn_id === sourceTurnId &&
      ["channel.author_action.start", "adoption.evaluate.done", "channel.author_action.done"].includes(
        record.event,
      ),
  );

  const sourceStarted = sourceRecords.some(
    (record) => record.event === "channel.user_message.start" && !record.candidate_ref,
  );
  const sourceCompleted = sourceRecords.some(
    (record) => record.event === "channel.user_message.done",
  );
  const continuationSelected = continuationRecords.some(
    (record) =>
      record.event === "channel.user_message.start" &&
      record.candidate_ref === uiState.candidate_ref &&
      record.candidate_source_turn_ref === sourceTurnId,
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
      record.event === "adoption.evaluate.done" &&
      record.decision_type === "adopt_tentative",
  );

  if (!sourceStarted || !sourceCompleted || !continuationSelected || !actionStarted) return null;
  if (!actionDone || !adopted) return null;

  return {
    slice_id: sliceId,
    turn_id: adoptionTurnId,
    turn_ids: [sourceTurnId, continuationTurnId, adoptionTurnId],
    source_turn_ref: sourceTurnId,
    continuation_turn_id: continuationTurnId,
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
    ["channel.author_action.start", "adoption.evaluate.done", "channel.author_action.done"].includes(
      record.event,
    ),
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
      record.event === "adoption.evaluate.done" &&
      record.decision_type === "require_confirmation",
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
    (record) =>
      record.event === "adoption.evaluate.done" &&
      record.decision_type === "reject",
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

function candidateAdoptionBridgeBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 3) return null;
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
  const continuationTurnId = String(uiState.continuation_turn_id ?? "");
  const candidateRef = uiState.candidate_ref;

  const sourceTurn = turnRecords.find(
    (record) => record.turn_id === sourceTurnId && record.event === "channel.user_message.start",
  );
  const continuationTurn = turnRecords.find(
    (record) =>
      record.turn_id === continuationTurnId &&
      record.event === "channel.user_message.start" &&
      record.candidate_ref === candidateRef &&
      record.candidate_source_turn_ref === sourceTurnId,
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

  if (!sourceTurn || !continuationTurn || !actionStart || !actionDone || !decision) {
    return null;
  }

  if (uiState.production_write_performed !== false) return null;
  if (uiState.candidate_selected !== true || uiState.candidate_adopted !== true) return null;
  if (options.provider === "lmstudio" && !lmstudioHasSteps(options, [sourceTurnId], ["form_frame"])) {
    return null;
  }

  return {
    slice_id: "au02-candidate-adoption-bridge",
    behavior: "candidate_selection_then_authorized_adoption_boundary",
    turn_ids: turnIds,
    source_turn_ref: sourceTurnId,
    continuation_turn_id: continuationTurnId,
    candidate_ref: candidateRef,
    candidate_set_ref: uiState.candidate_set_ref,
    assertions: [
      "candidate_panel_rendered_from_turn_result",
      "candidate_continuation_sent_candidate_selection_without_adoption",
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
  if (options.provider === "lmstudio" && !lmstudioHasSteps(options, [sourceTurnId], ["form_frame"])) {
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
  const chapterDone = turnRecords.find((record) => record.event === "channel.get_chapter_content.done");

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
    (record) => record.event === "slice_verify.ui_state.done" && record.slice_id === "au07-trace-why-entry",
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
    behavior: "workspace_runtime_state_normalizes_resume_connection_adoption_and_reading_empty_state",
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

  const previousWorkRecords = records.filter((record) => record.work_id === evidence.previous_work_id);
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

function workSessionResumeBehavior(records, evidence, options) {
  if (hasErrorEvent(records) || hasFallbackText(records)) return null;
  if (!lmstudioHasSteps(options, evidence.turn_ids ?? [evidence.turn_id], ["form_frame", "form_micro_plan"])) {
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
      turnRecords.some(
        (record) => record.event === event && hasRequiredCorrelationFields(record),
      ),
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
      turnRecords.some(
        (record) => record.event === event && hasRequiredCorrelationFields(record),
      ),
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
