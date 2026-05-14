export const nativeSliceIds = [
  "au03c-work-session-resume",
  "au05-adoption-boundary",
  "au05-discard-boundary",
  "au05-modify-draft-boundary",
  "au10-micro-plan-entry",
  "au10-ordinary-chat-no-micro-plan",
  "au01-ordinary-chat-two-turn-roundtrip",
  "vs10-observability-spine",
];

const sliceKeyEvents = {
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
  if (sliceId === "au03c-work-session-resume") {
    return findAu03cWorkSessionResumeEvidence(records);
  }

  if (sliceId === "au05-adoption-boundary") {
    return findAu05ActionEvidence(records, sliceId, "channel.adopt.done");
  }

  if (sliceId === "au05-discard-boundary") {
    return findAu05ActionEvidence(records, sliceId, "channel.discard.done");
  }

  if (sliceId === "au05-modify-draft-boundary") {
    return findAu05ActionEvidence(records, sliceId, "channel.modify_draft.done");
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

  if (sliceId === "vs10-observability-spine") {
    return findVs10LogSpineEvidence(records);
  }

  throw new Error(`Unknown native Tauri slice id: ${sliceId}`);
}

export function findSliceBehaviorEvidence(sliceId, records, evidence, options = {}) {
  if (!evidence) return null;

  if (sliceId === "au03c-work-session-resume") {
    return workSessionResumeBehavior(records, evidence, options);
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

  if (sliceId === "au05-adoption-boundary") {
    return adoptionBoundaryBehavior(sliceId, turnIds, turnRecords, options);
  }

  if (sliceId === "au05-discard-boundary") {
    return discardBoundaryBehavior(turnIds, turnRecords, options);
  }

  if (sliceId === "au05-modify-draft-boundary") {
    return modifyDraftBoundaryBehavior(turnIds, turnRecords, options);
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
        (record) => record.event === event && hasRequiredCorrelationFields(record),
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
