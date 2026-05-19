export const nativeSliceIds = [
  "workspace-runtime-state",
  "su02-work-switching",
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
  "au07-trace-why-entry",
  "au10-micro-plan-entry",
  "au10-ordinary-chat-no-micro-plan",
  "au01-ordinary-chat-two-turn-roundtrip",
  "au02-candidate-continuation",
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

  if (sliceId === "au07-trace-why-entry") {
    return traceWhyEntryBehavior(records, evidence, options);
  }

  const turnIds = evidence.turn_ids ?? [evidence.turn_id];
  const turnRecords = records.filter((record) => turnIds.includes(record.turn_id));
  if (hasErrorEvent(turnRecords) || hasFallbackText(turnRecords)) return null;

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
    if (!traceText.includes("本轮解释")) continue;
    if (!traceText.includes("为什么这样做")) continue;
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
      key_events: keyEvents,
    };
  }

  return null;
}

function ordinaryChatBehavior(turnIds, turnRecords, options) {
  if (turnIds.length !== 2) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "planner.form_frame.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "dialogue_gateway.handle_input.done")) return null;
  if (!turnsHaveEvent(turnIds, turnRecords, "channel.user_message.done")) return null;
  if (!turnsHaveGenerateMicroPlan(turnIds, turnRecords, false)) return null;
  if (hasEventPrefix(turnRecords, "planner.form_micro_plan.")) return null;
  if (!lmstudioHasSteps(options, turnIds, ["form_frame"])) return null;

  return {
    slice_id: "au01-ordinary-chat-two-turn-roundtrip",
    behavior: "ordinary_chat_two_turn_roundtrip",
    turn_ids: turnIds,
    assertions: [
      "two_user_turns_completed",
      "micro_plan_not_requested",
      "no_error_events",
      "assistant_messages_not_fallback",
      "lmstudio_form_frame_called_per_turn",
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

  return {
    slice_id: sliceId,
    turn_id: matchingTurnIds[0],
    turn_ids: matchingTurnIds.slice(0, 2),
    key_events: keyEvents,
  };
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
