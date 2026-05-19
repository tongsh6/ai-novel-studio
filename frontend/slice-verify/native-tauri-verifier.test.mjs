import { describe, expect, it } from "vitest";

import {
  findLmStudioEvidence,
  findNativeSliceEvidence,
  findSliceBehaviorEvidence,
  keyEventsForSlice,
  nativeSliceIds,
} from "./native-tauri-verifier.mjs";

describe("native Tauri slice verifier", () => {
  it("lists native slice ids including AU-10 micro plan entry", () => {
    expect(nativeSliceIds).toContain("workspace-runtime-state");
    expect(nativeSliceIds).toContain("su02-work-switching");
    expect(nativeSliceIds).toContain("su03-assistant-display-name");
    expect(nativeSliceIds).toContain("stage-startup-context-contract");
    expect(nativeSliceIds).toContain("au03c-work-session-resume");
    expect(nativeSliceIds).toContain("au05-adoption-boundary");
    expect(nativeSliceIds).toContain("au05-adoption-followup-routing");
    expect(nativeSliceIds).toContain("au05-discard-boundary");
    expect(nativeSliceIds).toContain("au05-modify-draft-boundary");
    expect(nativeSliceIds).toContain("au08-adoption-reading-projection");
    expect(nativeSliceIds).toContain("au09-archive-real-data");
    expect(nativeSliceIds).toContain("au09-memory-recall-context");
    expect(nativeSliceIds).toContain("au10-micro-plan-entry");
    expect(nativeSliceIds).toContain("au10-ordinary-chat-no-micro-plan");
    expect(nativeSliceIds).toContain("au01-ordinary-chat-two-turn-roundtrip");
    expect(nativeSliceIds).toContain("vs10-observability-spine");
  });

  it("accepts SU-03 assistant display name evidence as work-scoped UI state", () => {
    const records = [
      { event: "channel.join.done", work_id: "work-a", session_id: "session-a" },
      { event: "channel.join.done", work_id: "work-b", session_id: "session-b" },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su03-assistant-display-name",
        work_id: "work-a",
        context_work_id: "work-a",
        initial_work_id: "work-a",
        created_work_id: "work-b",
        socket_connected: true,
        assistant_name_after_save: "创作助手",
        assistant_role_after_save: "创作助手",
        assistant_name_in_created_work: "AI",
        assistant_name_after_return: "创作助手",
        assistant_role_after_return: "创作助手",
      },
    ];

    const evidence = findNativeSliceEvidence("su03-assistant-display-name", records);
    expect(evidence).toEqual({
      slice_id: "su03-assistant-display-name",
      turn_ids: [],
      work_id: "work-a",
      created_work_id: "work-b",
      assistant_name_after_save: "创作助手",
      assistant_name_in_created_work: "AI",
      assistant_name_after_return: "创作助手",
      key_events: keyEventsForSlice("su03-assistant-display-name"),
    });
    expect(findSliceBehaviorEvidence("su03-assistant-display-name", records, evidence)).toEqual({
      slice_id: "su03-assistant-display-name",
      behavior: "assistant_display_name_is_work_scoped_ui_preference",
      turn_ids: [],
      work_id: "work-a",
      created_work_id: "work-b",
      assertions: [
        "assistant_name_changed_from_real_workbench_entry",
        "assistant_message_role_remained_assistant",
        "display_name_saved_for_current_work",
        "new_work_fell_back_to_default_ai_name",
        "switching_back_restored_original_work_name",
        "preference_did_not_touch_provider_or_turn_result_contract",
        "no_error_events",
      ],
    });
  });

  it("accepts AU-09 archive evidence from real scoped archive records", () => {
    const records = [
      { event: "channel.join.done", work_id: "work-au09", session_id: "session-au09" },
      { event: "channel.get_characters.done", work_id: "work-au09", character_count: 1 },
      { event: "channel.get_foreshadowing.done", work_id: "work-au09", item_count: 1 },
      { event: "channel.get_rules.done", work_id: "work-au09", rule_count: 1 },
      {
        event: "channel.get_work_stats.done",
        work_id: "work-au09",
        volumes: 1,
        chapters: 1,
        memory_items: 2,
        drafts_accepted: 1,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-archive-real-data",
        work_id: "work-au09",
        context_work_id: "work-au09",
        archive_character_count: 1,
        archive_foreshadowing_count: 1,
        archive_rule_count: 1,
        archive_volumes: 1,
        archive_memory_items: 2,
        archive_drafts_accepted: 1,
        archive_detail_kind: "memory",
        archive_detail_id: "mem-au09",
        archive_detail_title: "林澈背后的旧伤",
      },
    ];

    const evidence = findNativeSliceEvidence("au09-archive-real-data", records);
    expect(evidence).toMatchObject({
      slice_id: "au09-archive-real-data",
      work_id: "work-au09",
      archive_character_count: 1,
      archive_foreshadowing_count: 1,
      archive_rule_count: 1,
      archive_detail_kind: "memory",
      archive_detail_title: "林澈背后的旧伤",
    });
    expect(findSliceBehaviorEvidence("au09-archive-real-data", records, evidence)).toEqual({
      slice_id: "au09-archive-real-data",
      behavior: "archive_panel_reads_real_scoped_work_facts_and_detail",
      work_id: "work-au09",
      assertions: [
        "archive_panel_opened_from_real_workbench",
        "characters_loaded_from_channel",
        "foreshadowing_loaded_from_confirmed_memory",
        "rules_loaded_from_confirmed_memory",
        "stats_loaded_from_persistence",
        "foreshadowing_detail_opened_from_archive_list",
        "no_fixed_mock_archive_items",
      ],
    });
  });

  it("accepts AU-09 memory recall evidence when a workbench turn attaches memory context", () => {
    const records = [
      {
        event: "channel.user_message.start",
        turn_id: "turn-memory",
        workspace_id: "work-memory",
        work_id: "work-memory",
        session_id: "session-memory",
        generate_micro_plan: false,
        duration_ms: 0,
        outcome: "start",
      },
      {
        event: "dialogue_gateway.handle_input.start",
        turn_id: "turn-memory",
        workspace_id: "work-memory",
        work_id: "work-memory",
        session_id: "session-memory",
        duration_ms: 0,
        outcome: "start",
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-memory",
        workspace_id: "work-memory",
        work_id: "work-memory",
        session_id: "session-memory",
        has_memory: true,
        context_refs_count: 1,
        duration_ms: 3,
        outcome: "done",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-memory",
        workspace_id: "work-memory",
        work_id: "work-memory",
        session_id: "session-memory",
        duration_ms: 10,
        outcome: "done",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-memory",
        workspace_id: "work-memory",
        work_id: "work-memory",
        session_id: "session-memory",
        duration_ms: 20,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-memory",
        workspace_id: "work-memory",
        work_id: "work-memory",
        session_id: "session-memory",
        duration_ms: 25,
        outcome: "done",
      },
    ];

    const evidence = findNativeSliceEvidence("au09-memory-recall-context", records);
    expect(evidence).toEqual({
      slice_id: "au09-memory-recall-context",
      turn_id: "turn-memory",
      turn_ids: ["turn-memory"],
      work_id: "work-memory",
      session_id: "session-memory",
      context_refs_count: 1,
      key_events: keyEventsForSlice("au09-memory-recall-context"),
    });
    expect(findSliceBehaviorEvidence("au09-memory-recall-context", records, evidence)).toEqual({
      slice_id: "au09-memory-recall-context",
      behavior: "confirmed_memory_recalled_into_dialogue_context",
      turn_ids: ["turn-memory"],
      work_id: "work-memory",
      assertions: [
        "message_sent_from_real_workbench",
        "micro_plan_not_requested",
        "confirmed_recallable_memory_attached_to_context",
        "planner_received_context_before_frame",
        "no_error_events",
        "assistant_messages_not_fallback",
      ],
    });
  });

  it("finds startup context evidence after resume UI reports connected work/session state", () => {
    const evidence = findNativeSliceEvidence(
      "stage-startup-context-contract",
      stageStartupContextRecords(),
    );

    expect(evidence).toEqual({
      slice_id: "stage-startup-context-contract",
      turn_id: "turn-au03c",
      turn_ids: ["turn-au03c"],
      work_id: "work-au03c",
      session_id: "session-au03c",
      transcript_count: 2,
      pending_adoption_count: 1,
      context_work_title: "Slice Verify Work",
      key_events: keyEventsForSlice("stage-startup-context-contract"),
    });
  });

  it("finds workspace runtime state evidence after resume and reading empty probe", () => {
    const evidence = findNativeSliceEvidence(
      "workspace-runtime-state",
      workspaceRuntimeStateRecords(),
    );

    expect(evidence).toEqual({
      slice_id: "workspace-runtime-state",
      turn_id: "turn-au03c",
      turn_ids: ["turn-au03c"],
      work_id: "work-au03c",
      session_id: "session-au03c",
      transcript_count: 2,
      pending_adoption_count: 1,
      decision_card_count: 1,
      reading_chapter_count: 0,
      context_work_title: "Slice Verify Work",
      reading_title: "Slice Verify Work",
      key_events: keyEventsForSlice("workspace-runtime-state"),
    });
  });

  it("finds SU-02 work switching evidence after creating a second work", () => {
    const records = su02WorkSwitchingRecords();
    const evidence = findNativeSliceEvidence("su02-work-switching", records);

    expect(evidence).toEqual({
      slice_id: "su02-work-switching",
      turn_id: "turn-work-a",
      turn_ids: ["turn-work-a"],
      work_id: "work-b",
      previous_work_id: "work-a",
      session_id: "session-b",
      joined_work_count: 2,
      message_count_after_switch: 1,
      key_events: keyEventsForSlice("su02-work-switching"),
    });

    expect(findSliceBehaviorEvidence("su02-work-switching", records, evidence)).toEqual({
      slice_id: "su02-work-switching",
      behavior: "runtime_work_switch_rejoins_channel_and_ignores_stale_pending_result",
      turn_ids: ["turn-work-a"],
      work_id: "work-b",
      previous_work_id: "work-a",
      session_id: "session-b",
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
    });
  });

  it("rejects startup context evidence when the restored UI inserted a welcome message", () => {
    const records = stageStartupContextRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, welcome_message_count: 1 }
        : record,
    );

    expect(findNativeSliceEvidence("stage-startup-context-contract", records)).toBeNull();
  });

  it("finds AU-03C evidence only after same session is resumed with transcript and pending adoption", () => {
    const records = au03cResumeRecords();

    expect(findNativeSliceEvidence("au03c-work-session-resume", records)).toEqual({
      slice_id: "au03c-work-session-resume",
      turn_id: "turn-au03c",
      turn_ids: ["turn-au03c"],
      work_id: "work-au03c",
      session_id: "session-au03c",
      transcript_count: 2,
      pending_adoption_count: 1,
      key_events: keyEventsForSlice("au03c-work-session-resume"),
    });
  });

  it("rejects AU-03C resume if pending adoption was not restored", () => {
    const records = au03cResumeRecords().map((record) =>
      record.event === "work_session.resume.done"
        ? { ...record, pending_adoption_count: 0 }
        : record,
    );

    expect(findNativeSliceEvidence("au03c-work-session-resume", records)).toBeNull();
  });

  it("requires AU-05 adoption evidence to include persisted mutation", () => {
    const records = au05AdoptionRecords("turn-adopt", false);

    expect(findNativeSliceEvidence("au05-adoption-boundary", records)).toBeNull();
  });

  it("finds AU-05 adoption evidence from generated artifact through persisted adopt", () => {
    const evidence = findNativeSliceEvidence(
      "au05-adoption-boundary",
      au05AdoptionRecords("turn-adopt", true),
    );

    expect(evidence).toEqual({
      slice_id: "au05-adoption-boundary",
      turn_id: "turn-adopt",
      key_events: keyEventsForSlice("au05-adoption-boundary"),
      mutation_id: "mutation-1",
    });
  });

  it("finds AU-05 follow-up routing evidence for setting adoption without reading entry", () => {
    const evidence = findNativeSliceEvidence(
      "au05-adoption-followup-routing",
      au05FollowupRoutingRecords("turn-routing"),
    );

    expect(evidence).toEqual({
      slice_id: "au05-adoption-followup-routing",
      turn_id: "turn-routing",
      key_events: keyEventsForSlice("au05-adoption-followup-routing"),
      mutation_id: "mutation-1",
      artifact_type: "character_seed",
      reading_projection_materialized: false,
      decision_card_count: 1,
      open_reading_action_count: 0,
      reading_chapter_count: 0,
    });
  });

  it("rejects AU-05 follow-up routing if a setting adoption exposes reading entry", () => {
    const records = au05FollowupRoutingRecords("turn-routing").map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, open_reading_action_count: 1 }
        : record,
    );

    expect(findNativeSliceEvidence("au05-adoption-followup-routing", records)).toBeNull();
  });

  it("finds AU-08 reading evidence after adoption loads TOC and chapter content", () => {
    const evidence = findNativeSliceEvidence(
      "au08-adoption-reading-projection",
      au08ReadingProjectionRecords("turn-reading"),
    );

    expect(evidence).toEqual({
      slice_id: "au08-adoption-reading-projection",
      turn_id: "turn-reading",
      key_events: keyEventsForSlice("au08-adoption-reading-projection"),
      mutation_id: "mutation-1",
      chapter_count: 1,
      content_chars: 12,
    });
  });

  it("finds AU-05 discard evidence from generated artifact through discard action", () => {
    const evidence = findNativeSliceEvidence(
      "au05-discard-boundary",
      au05DiscardRecords("turn-discard"),
    );

    expect(evidence).toEqual({
      slice_id: "au05-discard-boundary",
      turn_id: "turn-discard",
      key_events: keyEventsForSlice("au05-discard-boundary"),
    });
  });

  it("finds AU-05 modify evidence from generated artifact through edited acceptance", () => {
    const evidence = findNativeSliceEvidence(
      "au05-modify-draft-boundary",
      au05ModifyDraftRecords("turn-modify"),
    );

    expect(evidence).toEqual({
      slice_id: "au05-modify-draft-boundary",
      turn_id: "turn-modify",
      key_events: keyEventsForSlice("au05-modify-draft-boundary"),
    });
  });

  it("does not accept AU-10 micro plan evidence from only a channel start log", () => {
    const evidence = findNativeSliceEvidence("au10-micro-plan-entry", [
      {
        event: "channel.user_message.start",
        turn_id: "turn-1",
        workspace_id: "ws-1",
        work_id: "work-1",
        duration_ms: 0,
        outcome: "start",
        text_len: 27,
        generate_micro_plan: true,
      },
    ]);

    expect(evidence).toBeNull();
  });

  it("finds AU-10 micro plan evidence from the completed UI journey", () => {
    const evidence = findNativeSliceEvidence(
      "au10-micro-plan-entry",
      microPlanTurnRecords("turn-1"),
    );

    expect(evidence).toEqual({
      slice_id: "au10-micro-plan-entry",
      turn_id: "turn-1",
      key_events: [
        "channel.user_message.start",
        "dialogue_gateway.handle_input.start",
        "planner.form_frame.done",
        "planner.form_micro_plan.done",
        "dialogue_gateway.handle_input.done",
        "channel.user_message.done",
      ],
    });
  });

  it("requires two ordinary chat turns without micro plan events", () => {
    const records = ["turn-a", "turn-b"].flatMap((turnId) => [
      {
        event: "channel.user_message.start",
        turn_id: turnId,
        workspace_id: "ws-chat",
        work_id: "work-chat",
        duration_ms: 0,
        outcome: "start",
        text_len: 24,
        generate_micro_plan: false,
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: turnId,
        workspace_id: "ws-chat",
        work_id: "work-chat",
        duration_ms: 12,
        outcome: "ok",
      },
      {
        event: "channel.user_message.done",
        turn_id: turnId,
        workspace_id: "ws-chat",
        work_id: "work-chat",
        duration_ms: 14,
        outcome: "ok",
      },
    ]);

    expect(findNativeSliceEvidence("au01-ordinary-chat-two-turn-roundtrip", records)).toEqual({
      slice_id: "au01-ordinary-chat-two-turn-roundtrip",
      turn_id: "turn-a",
      turn_ids: ["turn-a", "turn-b"],
      key_events: [
        "channel.user_message.start",
        "dialogue_gateway.handle_input.done",
        "channel.user_message.done",
      ],
    });
  });

  it("rejects ordinary two-turn evidence if a micro plan event appears", () => {
    const records = [
      ...["turn-a", "turn-b"].flatMap((turnId) => [
        {
          event: "channel.user_message.start",
          turn_id: turnId,
          workspace_id: "ws-chat",
          work_id: "work-chat",
          duration_ms: 0,
          outcome: "start",
          text_len: 24,
          generate_micro_plan: false,
        },
        {
          event: "dialogue_gateway.handle_input.done",
          turn_id: turnId,
          workspace_id: "ws-chat",
          work_id: "work-chat",
          duration_ms: 12,
          outcome: "ok",
        },
        {
          event: "channel.user_message.done",
          turn_id: turnId,
          workspace_id: "ws-chat",
          work_id: "work-chat",
          duration_ms: 14,
          outcome: "ok",
        },
      ]),
      {
        event: "planner.form_micro_plan.done",
        turn_id: "turn-b",
        workspace_id: "ws-chat",
        work_id: "work-chat",
        duration_ms: 7,
        outcome: "ok",
      },
    ];

    expect(findNativeSliceEvidence("au01-ordinary-chat-two-turn-roundtrip", records)).toBeNull();
  });

  it("finds ordinary chat evidence only when micro plan is not requested", () => {
    const evidence = findNativeSliceEvidence(
      "au10-ordinary-chat-no-micro-plan",
      ordinarySingleTurnRecords("turn-ordinary"),
    );

    expect(evidence).toEqual({
      slice_id: "au10-ordinary-chat-no-micro-plan",
      turn_id: "turn-ordinary",
      key_events: [
        "channel.user_message.start",
        "dialogue_gateway.handle_input.start",
        "planner.form_frame.done",
        "dialogue_gateway.handle_input.done",
        "channel.user_message.done",
      ],
    });
  });

  it("rejects AU-10 ordinary evidence if micro plan is accidentally triggered", () => {
    const records = [
      ...ordinarySingleTurnRecords("turn-ordinary"),
      {
        event: "planner.form_micro_plan.done",
        turn_id: "turn-ordinary",
        workspace_id: "ws-ordinary",
        work_id: "work-ordinary",
        duration_ms: 5,
        outcome: "ok",
      },
    ];

    expect(findNativeSliceEvidence("au10-ordinary-chat-no-micro-plan", records)).toBeNull();
  });

  it("requires all VS-10 key events on one turn", () => {
    const records = keyEventsForSlice("vs10-observability-spine").map((event) => ({
      event,
      turn_id: "turn-2",
      workspace_id: "ws-2",
      work_id: "work-2",
      duration_ms: 1,
      outcome: event.endsWith(".start") ? "start" : "ok",
    }));

    expect(findNativeSliceEvidence("vs10-observability-spine", records)).toEqual({
      slice_id: "vs10-observability-spine",
      turn_id: "turn-2",
      key_events: keyEventsForSlice("vs10-observability-spine"),
    });
  });

  it("matches real LM Studio chat completion logs by turn id", () => {
    const evidence = findLmStudioEvidence(["turn-real"], [
      {
        turn_id: "turn-real",
        provider: "lmstudio",
        request: { method: "POST", url: "http://localhost:1234/v1/chat/completions" },
        response: { status: 200 },
      },
    ]);

    expect(evidence).toEqual({
      provider: "lmstudio",
      turn_ids: ["turn-real"],
      request_count: 1,
      status_codes: [200],
    });
  });

  it("rejects slice evidence without matching real LM Studio request", () => {
    const evidence = findLmStudioEvidence(["turn-real"], [
      {
        turn_id: "turn-other",
        provider: "slice_verify",
        request: { method: "POST", url: "memory://slice-verify" },
        response: { status: 200 },
      },
    ]);

    expect(evidence).toBeNull();
  });

  it("accepts ordinary chat behavior only when both turns complete without micro plan or fallback", () => {
    const records = ordinaryTwoTurnRecords();
    const llmRecords = [
      lmRecord("turn-a", "form_frame", "可以，我们先聊小说创作。"),
      lmRecord("turn-b", "form_frame", "还可以从人物和世界规则继续展开。"),
    ];
    const evidence = findNativeSliceEvidence("au01-ordinary-chat-two-turn-roundtrip", records);

    expect(findSliceBehaviorEvidence("au01-ordinary-chat-two-turn-roundtrip", records, evidence, {
      provider: "lmstudio",
      llmRecords,
    })).toEqual({
      slice_id: "au01-ordinary-chat-two-turn-roundtrip",
      behavior: "ordinary_chat_two_turn_roundtrip",
      turn_ids: ["turn-a", "turn-b"],
      assertions: [
        "two_user_turns_completed",
        "micro_plan_not_requested",
        "no_error_events",
        "assistant_messages_not_fallback",
        "lmstudio_form_frame_called_per_turn",
      ],
    });
  });

  it("accepts AU-05 behavior only when adoption boundary persisted a mutation", () => {
    const records = au05AdoptionRecords("turn-adopt", true);
    const evidence = findNativeSliceEvidence("au05-adoption-boundary", records);

    expect(findSliceBehaviorEvidence("au05-adoption-boundary", records, evidence)).toEqual({
      slice_id: "au05-adoption-boundary",
      behavior: "artifact_adoption_persisted_and_projection_stale",
      turn_ids: ["turn-adopt"],
      mutation_id: "mutation-1",
      assertions: [
        "tentative_artifact_generated",
        "author_clicked_accept_from_workbench",
        "adoption_boundary_adopted_tentative",
        "adoption_persisted_as_mutation",
        "no_error_events",
        "assistant_messages_not_fallback",
      ],
    });
  });

  it("accepts AU-05 follow-up behavior when setting adoption renders decision card without reading projection", () => {
    const records = au05FollowupRoutingRecords("turn-routing");
    const evidence = findNativeSliceEvidence("au05-adoption-followup-routing", records);

    expect(findSliceBehaviorEvidence("au05-adoption-followup-routing", records, evidence)).toEqual({
      slice_id: "au05-adoption-followup-routing",
      behavior: "setting_adoption_resolves_card_without_reading_followup",
      turn_ids: ["turn-routing"],
      mutation_id: "mutation-1",
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
    });
  });

  it("accepts startup context behavior only when UI and resume evidence agree", () => {
    const records = stageStartupContextRecords();
    const evidence = findNativeSliceEvidence("stage-startup-context-contract", records);

    expect(findSliceBehaviorEvidence("stage-startup-context-contract", records, evidence)).toEqual({
      slice_id: "stage-startup-context-contract",
      behavior: "startup_context_resumes_same_work_session_without_welcome_or_disconnected_state",
      turn_ids: ["turn-au03c"],
      work_id: "work-au03c",
      session_id: "session-au03c",
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
    });
  });

  it("accepts workspace runtime state behavior from UI-derived runtime evidence", () => {
    const records = workspaceRuntimeStateRecords();
    const evidence = findNativeSliceEvidence("workspace-runtime-state", records);

    expect(findSliceBehaviorEvidence("workspace-runtime-state", records, evidence)).toEqual({
      slice_id: "workspace-runtime-state",
      behavior: "workspace_runtime_state_normalizes_resume_connection_adoption_and_reading_empty_state",
      turn_ids: ["turn-au03c"],
      work_id: "work-au03c",
      session_id: "session-au03c",
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
    });
  });

  it("accepts AU-05 discard behavior when workbench discard resolves the artifact", () => {
    const records = au05DiscardRecords("turn-discard");
    const evidence = findNativeSliceEvidence("au05-discard-boundary", records);

    expect(findSliceBehaviorEvidence("au05-discard-boundary", records, evidence)).toEqual({
      slice_id: "au05-discard-boundary",
      behavior: "artifact_discarded_from_workbench",
      turn_ids: ["turn-discard"],
      assertions: [
        "tentative_artifact_generated",
        "author_clicked_discard_from_workbench",
        "discard_resolved_without_channel_crash",
        "no_error_events",
        "assistant_messages_not_fallback",
      ],
    });
  });

  it("accepts AU-05 modify behavior when workbench edit then accept resolves the artifact", () => {
    const records = au05ModifyDraftRecords("turn-modify");
    const evidence = findNativeSliceEvidence("au05-modify-draft-boundary", records);

    expect(findSliceBehaviorEvidence("au05-modify-draft-boundary", records, evidence)).toEqual({
      slice_id: "au05-modify-draft-boundary",
      behavior: "artifact_modified_then_accepted_from_workbench",
      turn_ids: ["turn-modify"],
      assertions: [
        "tentative_artifact_generated",
        "author_clicked_edit_then_accept_from_workbench",
        "edited_artifact_passed_adoption_boundary",
        "no_error_events",
        "assistant_messages_not_fallback",
      ],
    });
  });

  it("accepts AU-08 behavior only when reading mode loads accepted content", () => {
    const records = au08ReadingProjectionRecords("turn-reading");
    const evidence = findNativeSliceEvidence("au08-adoption-reading-projection", records);

    expect(findSliceBehaviorEvidence("au08-adoption-reading-projection", records, evidence)).toEqual({
      slice_id: "au08-adoption-reading-projection",
      behavior: "accepted_artifact_visible_in_reading_mode_projection",
      turn_ids: ["turn-reading"],
      mutation_id: "mutation-1",
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
    });
  });

  it("rejects AU-08 evidence when reading TOC is still empty", () => {
    const records = au08ReadingProjectionRecords("turn-reading").map((record) =>
      record.event === "channel.get_toc.done" ? { ...record, chapter_count: 0 } : record,
    );

    expect(findNativeSliceEvidence("au08-adoption-reading-projection", records)).toBeNull();
  });

  it("rejects ordinary chat behavior when a micro plan event appears", () => {
    const records = [
      ...ordinaryTwoTurnRecords(),
      {
        event: "planner.form_micro_plan.done",
        turn_id: "turn-b",
        workspace_id: "ws-chat",
        work_id: "work-chat",
        duration_ms: 7,
        outcome: "ok",
      },
    ];
    const evidence = {
      slice_id: "au01-ordinary-chat-two-turn-roundtrip",
      turn_id: "turn-a",
      turn_ids: ["turn-a", "turn-b"],
      key_events: keyEventsForSlice("au01-ordinary-chat-two-turn-roundtrip"),
    };

    expect(findSliceBehaviorEvidence("au01-ordinary-chat-two-turn-roundtrip", records, evidence))
      .toBeNull();
  });

  it("rejects real LM Studio behavior when assistant output is fallback text", () => {
    const records = ordinaryTwoTurnRecords();
    const evidence = findNativeSliceEvidence("au01-ordinary-chat-two-turn-roundtrip", records);

    expect(findSliceBehaviorEvidence("au01-ordinary-chat-two-turn-roundtrip", records, evidence, {
      provider: "lmstudio",
      llmRecords: [
        lmRecord("turn-a", "form_frame", "抱歉，我现在无法连接到创作引擎。请稍后再试。"),
        lmRecord("turn-b", "form_frame", "继续聊。"),
      ],
    })).toBeNull();
  });

  it("accepts VS-10 behavior only when frame and micro-plan both complete", () => {
    const records = keyEventsForSlice("vs10-observability-spine").map((event) => ({
      event,
      turn_id: "turn-vs10",
      workspace_id: "ws-vs10",
      work_id: "work-vs10",
      duration_ms: event.endsWith(".done") ? 12 : 0,
      outcome: event.endsWith(".start") ? "start" : "ok",
      generate_micro_plan: event === "channel.user_message.start" ? true : undefined,
    }));
    const evidence = findNativeSliceEvidence("vs10-observability-spine", records);

    expect(findSliceBehaviorEvidence("vs10-observability-spine", records, evidence, {
      provider: "lmstudio",
      llmRecords: [
        lmRecord("turn-vs10", "form_frame", "我会先判断这个请求的创作意图。"),
        lmRecord("turn-vs10", "form_micro_plan", "这里是下一步计划。"),
        {
          turn_id: "turn-vs10",
          step: "unknown",
          provider: "lmstudio",
          request: {
            method: "POST",
            url: "http://localhost:1234/v1/chat/completions",
          },
          response: {
            status: 200,
            body: JSON.stringify({
              choices: [{ message: { content: "工具执行完成，已生成可查看的草案。" } }],
            }),
          },
        },
      ],
    })).toEqual({
      slice_id: "vs10-observability-spine",
      behavior: "observability_spine_with_micro_plan",
      turn_ids: ["turn-vs10"],
      assertions: [
        "micro_plan_requested",
        "frame_and_micro_plan_completed",
        "no_error_events",
        "assistant_messages_not_fallback",
        "lmstudio_frame_and_micro_plan_called",
      ],
    });
  });
});

function ordinaryTwoTurnRecords() {
  return ["turn-a", "turn-b"].flatMap((turnId) => [
    {
      event: "channel.user_message.start",
      turn_id: turnId,
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 0,
      outcome: "start",
      text_len: 24,
      generate_micro_plan: false,
    },
    {
      event: "planner.form_frame.done",
      turn_id: turnId,
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 12,
      outcome: "ok",
      candidate_count: 0,
    },
    {
      event: "dialogue_gateway.handle_input.done",
      turn_id: turnId,
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 12,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: turnId,
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 14,
      outcome: "ok",
    },
  ]);
}

function ordinarySingleTurnRecords(turnId) {
  return [
    {
      event: "channel.user_message.start",
      turn_id: turnId,
      workspace_id: "ws-ordinary",
      work_id: "work-ordinary",
      duration_ms: 0,
      outcome: "start",
      text_len: 24,
      generate_micro_plan: false,
    },
    {
      event: "dialogue_gateway.handle_input.start",
      turn_id: turnId,
      workspace_id: "ws-ordinary",
      work_id: "work-ordinary",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "planner.form_frame.done",
      turn_id: turnId,
      workspace_id: "ws-ordinary",
      work_id: "work-ordinary",
      duration_ms: 12,
      outcome: "ok",
    },
    {
      event: "dialogue_gateway.handle_input.done",
      turn_id: turnId,
      workspace_id: "ws-ordinary",
      work_id: "work-ordinary",
      duration_ms: 14,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: turnId,
      workspace_id: "ws-ordinary",
      work_id: "work-ordinary",
      duration_ms: 15,
      outcome: "ok",
    },
  ];
}

function su02WorkSwitchingRecords() {
  return [
    {
      event: "work_session.resume.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a",
      duration_ms: 3,
      outcome: "ok",
      transcript_count: 0,
      pending_adoption_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a",
      duration_ms: 1,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-work-a",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a",
      duration_ms: 0,
      outcome: "start",
      text_len: 21,
      generate_micro_plan: false,
    },
    {
      event: "work_session.resume.done",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b",
      duration_ms: 2,
      outcome: "ok",
      transcript_count: 0,
      pending_adoption_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b",
      duration_ms: 1,
      outcome: "ok",
    },
    {
      event: "slice_verify.ui_state.done",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b",
      duration_ms: 0,
      outcome: "ok",
      slice_id: "su02-work-switching",
      context_work_id: "work-b",
      context_work_title: "未命名作品",
      active_session_id: "session-b",
      restored_turn_id: null,
      socket_connected: true,
      message_count: 1,
      welcome_message_count: 1,
      pending_adoption_count: 0,
      first_message_text: "欢迎使用 AI Novel Studio",
      service_status_text: "服务: 已连接",
      title_text: "未命名作品",
    },
  ];
}

function microPlanTurnRecords(turnId) {
  return [
    {
      event: "channel.user_message.start",
      turn_id: turnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 27,
      generate_micro_plan: true,
    },
    {
      event: "dialogue_gateway.handle_input.start",
      turn_id: turnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "planner.form_frame.done",
      turn_id: turnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "planner.form_micro_plan.done",
      turn_id: turnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      duration_ms: 10,
      outcome: "ok",
    },
    {
      event: "dialogue_gateway.handle_input.done",
      turn_id: turnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      duration_ms: 32,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: turnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      duration_ms: 33,
      outcome: "ok",
    },
  ];
}

function au05AdoptionRecords(turnId, persisted) {
  return [
    {
      event: "channel.user_message.start",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 0,
      outcome: "start",
      text_len: 27,
      generate_micro_plan: true,
    },
    {
      event: "dialogue_gateway.handle_input.start",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "planner.form_frame.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "planner.form_micro_plan.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 10,
      outcome: "ok",
    },
    {
      event: "toolbox.execute.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 8,
      outcome: "ok",
    },
    {
      event: "dialogue_gateway.handle_input.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 32,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 33,
      outcome: "ok",
    },
    {
      event: "channel.adopt.start",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 0,
      outcome: "start",
      artifact_id: "as-1",
    },
    {
      event: "adoption.evaluate.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 4,
      outcome: "ok",
      decision_type: "adopt_tentative",
    },
    {
      event: "channel.adopt.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 7,
      outcome: "ok",
      action_status: "accepted",
      persisted,
      mutation_id: persisted ? "mutation-1" : null,
      artifact_type: "character_seed",
      reading_projection_materialized: false,
    },
  ];
}

function au05FollowupRoutingRecords(turnId) {
  return [
    ...au05AdoptionRecords(turnId, true),
    {
      event: "slice_verify.ui_state.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au05-adoption-followup-routing",
      context_work_id: "work-adopt",
      context_work_title: "Slice Verify Work",
      active_session_id: "session-adopt",
      restored_turn_id: turnId,
      socket_connected: true,
      message_count: 3,
      welcome_message_count: 0,
      pending_adoption_count: 0,
      first_message_text: "请生成一个角色设定草案",
      service_status_text: "服务: 已连接",
      title_text: "Slice Verify Work",
      adoption_status: "ACCEPTED",
      artifact_type: "character_seed",
      decision_card_count: 1,
      open_reading_action_count: 0,
      reading_chapter_count: 0,
    },
  ];
}

function au05DiscardRecords(turnId) {
  return [
    ...au05BaseRecords(turnId),
    {
      event: "channel.discard.start",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 0,
      outcome: "start",
      artifact_id: "as-1",
    },
    {
      event: "channel.discard.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 7,
      outcome: "ok",
      action_status: "discarded",
    },
  ];
}

function au05ModifyDraftRecords(turnId) {
  return [
    ...au05BaseRecords(turnId),
    {
      event: "channel.modify_draft.start",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 0,
      outcome: "start",
      artifact_id: "as-1",
    },
    {
      event: "adoption.evaluate.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 4,
      outcome: "ok",
      decision_type: "adopt_tentative",
    },
    {
      event: "channel.modify_draft.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 7,
      outcome: "ok",
      action_status: "accepted",
    },
  ];
}

function au05BaseRecords(turnId) {
  return au05AdoptionRecords(turnId, true).filter(
    (record) =>
      record.event !== "channel.adopt.start" &&
      record.event !== "adoption.evaluate.done" &&
      record.event !== "channel.adopt.done",
  );
}

function au08ReadingProjectionRecords(turnId) {
  return [
    ...au05AdoptionRecords(turnId, true),
    {
      event: "channel.get_toc.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 5,
      outcome: "ok",
      volume_count: 1,
      chapter_count: 1,
    },
    {
      event: "channel.get_chapter_content.done",
      turn_id: turnId,
      workspace_id: "ws-adopt",
      work_id: "work-adopt",
      duration_ms: 5,
      outcome: "ok",
      chapter_id: "chapter-1",
      scene_count: 1,
      content_chars: 12,
    },
  ];
}

function au03cResumeRecords() {
  return [
    {
      event: "work_session.resume.done",
      workspace_id: "work-au03c",
      work_id: "work-au03c",
      session_id: "session-au03c",
      duration_ms: 3,
      outcome: "ok",
      transcript_count: 0,
      pending_adoption_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-au03c",
      work_id: "work-au03c",
      session_id: "session-au03c",
      duration_ms: 0,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-au03c",
      workspace_id: "work-au03c",
      work_id: "work-au03c",
      session_id: "session-au03c",
      duration_ms: 0,
      outcome: "start",
      text_len: 21,
      generate_micro_plan: true,
    },
    {
      event: "toolbox.execute.done",
      turn_id: "turn-au03c",
      workspace_id: "work-au03c",
      work_id: "work-au03c",
      session_id: "session-au03c",
      duration_ms: 12,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au03c",
      workspace_id: "work-au03c",
      work_id: "work-au03c",
      session_id: "session-au03c",
      duration_ms: 18,
      outcome: "ok",
    },
    {
      event: "work_session.resume.done",
      workspace_id: "work-au03c",
      work_id: "work-au03c",
      session_id: "session-au03c",
      duration_ms: 4,
      outcome: "ok",
      transcript_count: 2,
      pending_adoption_count: 1,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-au03c",
      work_id: "work-au03c",
      session_id: "session-au03c",
      duration_ms: 0,
      outcome: "ok",
    },
  ];
}

function stageStartupContextRecords() {
  return [
    ...au03cResumeRecords(),
    {
      event: "slice_verify.ui_state.done",
      workspace_id: "lobby",
      work_id: "work-au03c",
      session_id: "session-au03c",
      duration_ms: 0,
      outcome: "ok",
      slice_id: "stage-startup-context-contract",
      context_work_id: "work-au03c",
      context_work_title: "Slice Verify Work",
      active_session_id: "session-au03c",
      restored_turn_id: "turn-au03c",
      socket_connected: true,
      message_count: 2,
      welcome_message_count: 0,
      pending_adoption_count: 1,
      decision_card_count: 1,
      first_message_text: "帮我创作角色设定",
      service_status_text: "服务: 已连接",
      title_text: "Slice Verify Work",
    },
  ];
}

function workspaceRuntimeStateRecords() {
  return [
    ...au03cResumeRecords(),
    {
      event: "channel.get_toc.done",
      workspace_id: "work-au03c",
      work_id: "work-au03c",
      duration_ms: 3,
      outcome: "ok",
      volume_count: 0,
      chapter_count: 0,
    },
    {
      event: "slice_verify.ui_state.done",
      workspace_id: "lobby",
      work_id: "work-au03c",
      session_id: "session-au03c",
      duration_ms: 0,
      outcome: "ok",
      slice_id: "workspace-runtime-state",
      context_work_id: "work-au03c",
      context_work_title: "Slice Verify Work",
      active_session_id: "session-au03c",
      restored_turn_id: "turn-au03c",
      socket_connected: true,
      message_count: 2,
      welcome_message_count: 0,
      pending_adoption_count: 1,
      decision_card_count: 1,
      first_message_text: "帮我创作角色设定",
      service_status_text: "服务: 已连接",
      title_text: "Slice Verify Work",
      reading_chapter_count: 0,
    },
  ];
}

function lmRecord(turnId, step, assistantMessage) {
  return {
    turn_id: turnId,
    step,
    provider: "lmstudio",
    request: {
      method: "POST",
      url: "http://localhost:1234/v1/chat/completions",
    },
    response: {
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                frame_type: "casual_reply",
                dialogue_goal_summary: "验证行为",
                needs_tool: false,
                no_tool_reason: "no_tool_needed",
                execution_readiness: "not_applicable",
                assistant_message: assistantMessage,
                candidate_directions: [],
                context_used: false,
                uncertainty: [],
              }),
            },
          },
        ],
      }),
    },
  };
}
