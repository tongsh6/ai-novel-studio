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
    expect(nativeSliceIds).toContain("su01-provider-health-model");
    expect(nativeSliceIds).toContain("su01-model-provider-switching");
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
    expect(nativeSliceIds).toContain("au09-character-dossier-roundtrip");
    expect(nativeSliceIds).toContain("au09-memory-management-entry");
    expect(nativeSliceIds).toContain("au09-memory-trace-roundtrip");
    expect(nativeSliceIds).toContain("au09-cross-work-memory-isolation");
    expect(nativeSliceIds).toContain("au09-au03-session-memory-layering");
    expect(nativeSliceIds).toContain("au03-branch-from-history");
    expect(nativeSliceIds).toContain("au03-archive-session-filter");
    expect(nativeSliceIds).toContain("au03-current-work-context-ssot");
    expect(nativeSliceIds).toContain("au03-long-session-compression");
    expect(nativeSliceIds).toContain("au03-context-source-ui");
    expect(nativeSliceIds).toContain("au11-quality-diagnosis-message-envelope");
    expect(nativeSliceIds).toContain("au10-workbench-matrix-layout");
    expect(nativeSliceIds).toContain("au10-workbench-recovery-disconnect-timeout");
    expect(nativeSliceIds).toContain("au10-workbench-recovery-provider-timeout");
    expect(nativeSliceIds).toContain("au10-workbench-recovery-reconnect");
    expect(nativeSliceIds).toContain("au10-workbench-recovery-cancel-waiting");
    expect(nativeSliceIds).toContain("au10-micro-plan-entry");
    expect(nativeSliceIds).toContain("au10-ordinary-chat-no-micro-plan");
    expect(nativeSliceIds).toContain("au01-ordinary-chat-two-turn-roundtrip");
    expect(nativeSliceIds).toContain("au02-candidate-continuation");
    expect(nativeSliceIds).toContain("au02-candidate-adoption-bridge");
    expect(nativeSliceIds).toContain("au05-adoption-safety-freshness");
    expect(nativeSliceIds).toContain("au05-stale-conflict-cross-work-freshness");
    expect(nativeSliceIds).toContain("au05-conflict-cross-work-recovery");
    expect(nativeSliceIds).toContain("au05-canon-conflict-recovery");
    expect(nativeSliceIds).toContain("p1-chapter-plan-minimum");
    expect(nativeSliceIds).toContain("p1-chapter-draft-generation");
    expect(nativeSliceIds).toContain("vs00c-cp3-structured-context");
    expect(nativeSliceIds).toContain("vs00c-cp4-chapter-plan-structure");
    expect(nativeSliceIds).toContain("vs00c-cp5-reader-effect-brief");
    expect(nativeSliceIds).toContain("vs10-observability-spine");
  });

  it("accepts SU-01 provider health evidence from the real workbench badge", () => {
    const records = [
      { event: "channel.join.done", work_id: "work-su01", session_id: "session-su01" },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-provider-health-model",
        work_id: "work-su01",
        context_work_id: "work-su01",
        socket_connected: true,
        llm_connected: true,
        llm_model_label: "slice_verify",
        llm_status_text: "LLM: 已连接 · slice_verify",
      },
    ];

    const evidence = findNativeSliceEvidence("su01-provider-health-model", records);
    expect(evidence).toEqual({
      slice_id: "su01-provider-health-model",
      turn_ids: [],
      work_id: "work-su01",
      llm_status_text: "LLM: 已连接 · slice_verify",
      llm_model_label: "slice_verify",
      key_events: keyEventsForSlice("su01-provider-health-model"),
    });
    expect(findSliceBehaviorEvidence("su01-provider-health-model", records, evidence)).toEqual({
      slice_id: "su01-provider-health-model",
      behavior: "provider_health_badge_displays_backend_metadata",
      turn_ids: [],
      work_id: "work-su01",
      assertions: [
        "provider_health_requested_through_real_workbench",
        "llm_badge_connected_state_came_from_backend_health",
        "llm_badge_displays_provider_or_model_label",
        "channel_joined_current_work",
        "no_error_events",
      ],
    });
  });

  it("accepts SU-01 model provider switching only when the next turn uses the selected provider", () => {
    const records = [
      { event: "channel.join.done", work_id: "work-su01", session_id: "session-su01" },
      {
        event: "channel.user_message.start",
        turn_id: "turn-su01-switch",
        work_id: "work-su01",
        session_id: "session-su01",
      },
      {
        event: "provider_gateway.complete.done",
        turn_id: "turn-su01-switch",
        work_id: "work-su01",
        provider: "stub",
        model: "qwen/qwen3.6-35b-a3b",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-su01-switch",
        work_id: "work-su01",
        session_id: "session-su01",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-model-provider-switching",
        turn_id: "turn-su01-switch",
        work_id: "work-su01",
        context_work_id: "work-su01",
        socket_connected: true,
        provider_switch_saved: true,
        provider_switched_to: "stub",
        model_provider_button_text: "Stub",
        post_switch_message_visible: true,
        dialogue_preserved_after_switch: true,
        message_text: "SU01 模型切换后，请用一句话回复当前状态。",
      },
    ];

    const evidence = findNativeSliceEvidence("su01-model-provider-switching", records);
    expect(evidence).toEqual({
      slice_id: "su01-model-provider-switching",
      turn_id: "turn-su01-switch",
      turn_ids: ["turn-su01-switch"],
      work_id: "work-su01",
      provider_after_switch: "stub",
      model_after_switch: "qwen/qwen3.6-35b-a3b",
      model_provider_button_text: "Stub",
      message_text: "SU01 模型切换后，请用一句话回复当前状态。",
      key_events: keyEventsForSlice("su01-model-provider-switching"),
    });
    expect(findSliceBehaviorEvidence("su01-model-provider-switching", records, evidence)).toEqual({
      slice_id: "su01-model-provider-switching",
      behavior: "model_provider_switch_applies_to_next_turn",
      turn_ids: ["turn-su01-switch"],
      work_id: "work-su01",
      provider_after_switch: "stub",
      model_after_switch: "qwen/qwen3.6-35b-a3b",
      assertions: [
        "model_settings_opened_from_real_workbench",
        "provider_options_came_from_backend_registry",
        "save_switched_runtime_provider",
        "post_switch_turn_used_stub_provider_in_gateway_log",
        "dialogue_remained_visible_after_switch",
        "provider_options_and_ui_state_did_not_expose_api_key",
        "no_error_events",
      ],
    });
  });

  it("accepts AU-02 candidate continuation only when UI exposes exploration frame evidence", () => {
    const records = au02CandidateContinuationRecords("turn-source", "turn-follow");

    const evidence = findNativeSliceEvidence("au02-candidate-continuation", records);
    expect(evidence).toEqual({
      slice_id: "au02-candidate-continuation",
      turn_id: "turn-follow",
      turn_ids: ["turn-follow"],
      source_turn_ref: "turn-source",
      candidate_ref: "dir-1",
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      frame_badge_goal: "帮作者展开赛博修仙方向",
      candidate_panel_count: 1,
      key_events: keyEventsForSlice("au02-candidate-continuation"),
    });
    expect(findSliceBehaviorEvidence("au02-candidate-continuation", records, evidence)).toEqual({
      slice_id: "au02-candidate-continuation",
      behavior: "candidate_selection_continues_dialogue_without_adoption",
      turn_ids: ["turn-follow"],
      source_turn_ref: "turn-source",
      candidate_ref: "dir-1",
      assertions: [
        "candidate_ref_sent_from_real_workbench",
        "micro_plan_not_requested",
        "no_adoption_or_projection_events",
        "assistant_messages_not_fallback",
        "deterministic_provider_form_frame_called_per_turn",
      ],
    });
  });

  it("rejects AU-02 candidate evidence when the exploration frame badge is missing", () => {
    const records = au02CandidateContinuationRecords("turn-source", "turn-follow").filter(
      (record) => record.event !== "slice_verify.ui_state.done",
    );

    expect(findNativeSliceEvidence("au02-candidate-continuation", records)).toBeNull();
  });

  it("accepts AU-02 candidate adoption bridge only after authorized action reaches boundary", () => {
    const records = au02CandidateAdoptionBridgeRecords(
      "turn-source",
      "turn-follow",
      "turn-adoption",
    );

    const evidence = findNativeSliceEvidence("au02-candidate-adoption-bridge", records);
    expect(evidence).toEqual({
      slice_id: "au02-candidate-adoption-bridge",
      turn_id: "turn-adoption",
      turn_ids: ["turn-source", "turn-adoption"],
      source_turn_ref: "turn-source",
      continuation_turn_id: null,
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      key_events: keyEventsForSlice("au02-candidate-adoption-bridge"),
    });
    expect(findSliceBehaviorEvidence("au02-candidate-adoption-bridge", records, evidence)).toEqual({
      slice_id: "au02-candidate-adoption-bridge",
      behavior: "candidate_continuation_authorized_by_available_action",
      turn_ids: ["turn-source", "turn-adoption"],
      source_turn_ref: "turn-source",
      continuation_turn_id: null,
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      assertions: [
        "candidate_panel_rendered_from_turn_result",
        "candidate_continuation_sent_authorized_choose_candidate_action",
        "adoption_boundary_returned_adopt_tentative",
        "ui_rendered_candidate_adoption_result",
        "production_write_not_claimed",
        "no_legacy_artifact_adopt_endpoint_used",
        "deterministic_provider_form_frame_called_for_source_candidate_turn",
      ],
    });
  });

  it("accepts AU-05 adoption safety only when high-risk candidate requires confirmation", () => {
    const records = au05AdoptionSafetyFreshnessRecords("turn-source", "turn-confirmation");

    const evidence = findNativeSliceEvidence("au05-adoption-safety-freshness", records);
    expect(evidence).toEqual({
      slice_id: "au05-adoption-safety-freshness",
      turn_id: "turn-confirmation",
      turn_ids: ["turn-source", "turn-confirmation"],
      source_turn_ref: "turn-source",
      confirmation_turn_id: "turn-confirmation",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      candidate_risk_hint: "high",
      key_events: keyEventsForSlice("au05-adoption-safety-freshness"),
    });
    expect(findSliceBehaviorEvidence("au05-adoption-safety-freshness", records, evidence)).toEqual({
      slice_id: "au05-adoption-safety-freshness",
      behavior: "high_risk_candidate_requires_confirmation_without_production_write",
      turn_ids: ["turn-source", "turn-confirmation"],
      source_turn_ref: "turn-source",
      confirmation_turn_id: "turn-confirmation",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      assertions: [
        "high_risk_candidate_rendered_from_turn_result",
        "ui_sent_authorized_choose_candidate_action",
        "adoption_boundary_returned_require_confirmation",
        "channel_acknowledged_needs_confirmation",
        "ui_rendered_candidate_confirmation_result",
        "candidate_not_adopted",
        "production_write_not_claimed",
        "no_legacy_artifact_adopt_endpoint_used",
        "deterministic_provider_form_frame_called_for_source_candidate_turn",
      ],
    });
  });

  it("accepts AU-05 stale freshness only when restored candidate adoption is rejected", () => {
    const records = au05StaleConflictCrossWorkRecords("turn-source", "turn-rejection");

    const evidence = findNativeSliceEvidence("au05-stale-conflict-cross-work-freshness", records);
    expect(evidence).toEqual({
      slice_id: "au05-stale-conflict-cross-work-freshness",
      turn_id: "turn-rejection",
      turn_ids: ["turn-source", "turn-rejection"],
      source_turn_ref: "turn-source",
      rejection_turn_id: "turn-rejection",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      key_events: keyEventsForSlice("au05-stale-conflict-cross-work-freshness"),
    });
    expect(
      findSliceBehaviorEvidence("au05-stale-conflict-cross-work-freshness", records, evidence),
    ).toEqual({
      slice_id: "au05-stale-conflict-cross-work-freshness",
      behavior: "restored_stale_candidate_rejected_without_production_write",
      turn_ids: ["turn-source", "turn-rejection"],
      source_turn_ref: "turn-source",
      rejection_turn_id: "turn-rejection",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
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
    });
  });

  it("accepts AU-05 cross-work recovery only when candidate adoption fails without write", () => {
    const records = au05ConflictCrossWorkRecoveryRecords("turn-source", "turn-failure");

    const evidence = findNativeSliceEvidence("au05-conflict-cross-work-recovery", records);
    expect(evidence).toEqual({
      slice_id: "au05-conflict-cross-work-recovery",
      turn_id: "turn-failure",
      turn_ids: ["turn-source", "turn-failure"],
      source_turn_ref: "turn-source",
      failure_turn_id: "turn-failure",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      key_events: keyEventsForSlice("au05-conflict-cross-work-recovery"),
    });
    expect(
      findSliceBehaviorEvidence("au05-conflict-cross-work-recovery", records, evidence),
    ).toEqual({
      slice_id: "au05-conflict-cross-work-recovery",
      behavior: "cross_work_candidate_failed_with_recovery_without_production_write",
      turn_ids: ["turn-source", "turn-failure"],
      source_turn_ref: "turn-source",
      failure_turn_id: "turn-failure",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
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
    });
  });

  it("accepts AU-05 canon conflict recovery only when candidate adoption fails without write", () => {
    const records = au05CanonConflictRecoveryRecords("turn-source", "turn-failure");

    const evidence = findNativeSliceEvidence("au05-canon-conflict-recovery", records);
    expect(evidence).toEqual({
      slice_id: "au05-canon-conflict-recovery",
      turn_id: "turn-failure",
      turn_ids: ["turn-source", "turn-failure"],
      source_turn_ref: "turn-source",
      failure_turn_id: "turn-failure",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      key_events: keyEventsForSlice("au05-canon-conflict-recovery"),
    });
    expect(findSliceBehaviorEvidence("au05-canon-conflict-recovery", records, evidence)).toEqual({
      slice_id: "au05-canon-conflict-recovery",
      behavior: "canon_conflict_candidate_failed_with_recovery_without_production_write",
      turn_ids: ["turn-source", "turn-failure"],
      source_turn_ref: "turn-source",
      failure_turn_id: "turn-failure",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
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
    });
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

  it("accepts AU-03 branch-from-history evidence when source refs are preserved", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-au03",
        session_id: "session-active",
        transcript_count: 1,
      },
      { event: "channel.join.done", work_id: "work-au03", session_id: "session-active" },
      {
        event: "work_session.show.done",
        work_id: "work-au03",
        session_id: "session-history",
        read_only: true,
        transcript_count: 2,
        pending_adoption_count: 0,
      },
      {
        event: "work_session.create.done",
        work_id: "work-au03",
        session_id: "session-branch",
        source_session_ref: "session-history",
        source_turn_ref: "turn-history-1",
      },
      {
        event: "work_session.resume.done",
        work_id: "work-au03",
        session_id: "session-branch",
        transcript_count: 0,
      },
      { event: "channel.join.done", work_id: "work-au03", session_id: "session-branch" },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au03-branch-from-history",
        work_id: "work-au03",
        context_work_id: "work-au03",
        readonly_banner_visible: true,
        readonly_visible_text: "林瑶历史讨论",
        branch_source_session_ref: "session-history",
        branch_source_turn_ref: "turn-history-1",
        branch_active_session_id: "session-branch",
        branch_readonly_banner_visible: false,
        branch_message_count: 1,
        branch_visible_text: "欢迎使用 AI Novel Studio",
        branch_session_item_active: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au03-branch-from-history", records);
    expect(evidence).toEqual({
      slice_id: "au03-branch-from-history",
      turn_ids: [],
      work_id: "work-au03",
      session_id: "session-branch",
      source_session_ref: "session-history",
      source_turn_ref: "turn-history-1",
      key_events: keyEventsForSlice("au03-branch-from-history"),
    });
    expect(findSliceBehaviorEvidence("au03-branch-from-history", records, evidence)).toEqual({
      slice_id: "au03-branch-from-history",
      behavior: "historical_session_branch_created_and_switched_from_real_workbench",
      turn_ids: [],
      work_id: "work-au03",
      session_id: "session-branch",
      source_session_ref: "session-history",
      source_turn_ref: "turn-history-1",
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
    });
  });

  it("accepts AU-03 archive-session-filter evidence when archived history is hidden but searchable", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-au03",
        session_id: "session-active",
        transcript_count: 1,
      },
      { event: "channel.join.done", work_id: "work-au03", session_id: "session-active" },
      {
        event: "work_session.show.done",
        work_id: "work-au03",
        session_id: "session-history",
        read_only: true,
        transcript_count: 2,
        pending_adoption_count: 0,
      },
      {
        event: "work_session.archive.done",
        work_id: "work-au03",
        session_id: "session-history",
        status: "ARCHIVED",
      },
      {
        event: "work_session.show.done",
        work_id: "work-au03",
        session_id: "session-history",
        read_only: true,
        transcript_count: 2,
        pending_adoption_count: 0,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au03-archive-session-filter",
        work_id: "work-au03",
        context_work_id: "work-au03",
        readonly_session_id: "session-history",
        archive_button_visible: true,
        archived_hidden_default: true,
        archived_search_found: true,
        archived_banner_visible: true,
        archived_visible_text: "林瑶历史讨论",
      },
    ];

    const evidence = findNativeSliceEvidence("au03-archive-session-filter", records);
    expect(evidence).toEqual({
      slice_id: "au03-archive-session-filter",
      turn_ids: [],
      work_id: "work-au03",
      session_id: "session-history",
      key_events: keyEventsForSlice("au03-archive-session-filter"),
      transcript_count: 2,
    });
    expect(findSliceBehaviorEvidence("au03-archive-session-filter", records, evidence)).toEqual({
      slice_id: "au03-archive-session-filter",
      behavior: "historical_session_archived_hidden_from_default_list_and_searchable",
      turn_ids: [],
      work_id: "work-au03",
      session_id: "session-history",
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
    });
  });

  it("accepts AU-03 current work context SSOT evidence with LMStudio prompt layering", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-au03",
        session_id: "session-active",
        transcript_count: 2,
      },
      { event: "channel.join.done", work_id: "work-au03", session_id: "session-active" },
      {
        event: "work_session.show.done",
        work_id: "work-au03",
        session_id: "session-history",
        read_only: true,
        transcript_count: 2,
      },
      {
        event: "channel.user_message.start",
        turn_id: "turn-current",
        work_id: "work-au03",
        session_id: "session-active",
        workspace_id: "work-au03",
        outcome: "started",
        duration_ms: 0,
        generate_micro_plan: false,
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-current",
        work_id: "work-au03",
        session_id: "session-active",
        workspace_id: "work-au03",
        outcome: "success",
        duration_ms: 1,
        has_snapshot: true,
        has_conversation: true,
        context_refs_count: 2,
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-current",
        work_id: "work-au03",
        session_id: "session-active",
        workspace_id: "work-au03",
        outcome: "success",
        duration_ms: 1,
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-current",
        work_id: "work-au03",
        session_id: "session-active",
        workspace_id: "work-au03",
        outcome: "success",
        duration_ms: 2,
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-current",
        work_id: "work-au03",
        session_id: "session-active",
        workspace_id: "work-au03",
        outcome: "success",
        duration_ms: 3,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au03-current-work-context-ssot",
        turn_id: "turn-current",
        work_id: "work-au03",
        session_id: "session-active",
        workspace_id: "work-au03",
        context_work_id: "work-au03",
        readonly_session_id: "session-history",
        active_session_restored: true,
        readonly_banner_visible: false,
      },
    ];

    const llmRecords = [
      {
        turn_id: "turn-current",
        provider: "lmstudio",
        step: "form_frame",
        request: {
          method: "POST",
          url: "http://localhost:1234/v1/chat/completions",
          body: {
            messages: [
              {
                role: "system",
                content:
                  "## 当前作品上下文\n- title: 灵源纪元\n- genre: 东方奇幻\n- core_selling_point: 林澈为寻找妹妹林瑶追查灵源矿区真相\n- tone_preference: 克制、悬疑、带希望感",
              },
              { role: "user", content: "当前会话确认：主角现在叫林澈。" },
              { role: "assistant", content: "已按最新作品背景记录。" },
              { role: "user", content: "主角现在的核心动机是什么？" },
            ],
          },
        },
        response: {
          status: 200,
          body: '{"choices":[{"message":{"content":"{\\"assistant_message\\":\\"他在追查妹妹林瑶与灵源矿区真相。\\"}"}}]}',
        },
      },
    ];

    const evidence = findNativeSliceEvidence("au03-current-work-context-ssot", records);
    expect(evidence).toEqual({
      slice_id: "au03-current-work-context-ssot",
      turn_id: "turn-current",
      turn_ids: ["turn-current"],
      work_id: "work-au03",
      session_id: "session-active",
      readonly_session_id: "session-history",
      context_refs_count: 2,
      key_events: keyEventsForSlice("au03-current-work-context-ssot"),
    });
    expect(
      findSliceBehaviorEvidence("au03-current-work-context-ssot", records, evidence, {
        provider: "lmstudio",
        llmRecords,
      }),
    ).toEqual({
      slice_id: "au03-current-work-context-ssot",
      behavior: "latest_work_snapshot_and_active_session_transcript_are_layered_into_context",
      turn_ids: ["turn-current"],
      work_id: "work-au03",
      session_id: "session-active",
      readonly_session_id: "session-history",
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
    });
  });

  it("accepts AU-03 long session compression evidence with LMStudio prompt windowing", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-long",
        session_id: "session-long",
        transcript_count: 12,
      },
      { event: "channel.join.done", work_id: "work-long", session_id: "session-long" },
      {
        event: "channel.user_message.start",
        turn_id: "turn-long",
        workspace_id: "work-long",
        work_id: "work-long",
        session_id: "session-long",
        generate_micro_plan: false,
        duration_ms: 0,
        outcome: "start",
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-long",
        workspace_id: "work-long",
        work_id: "work-long",
        session_id: "session-long",
        has_conversation: true,
        has_session_summary: true,
        context_refs_count: 1,
        duration_ms: 2,
        outcome: "done",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-long",
        workspace_id: "work-long",
        work_id: "work-long",
        session_id: "session-long",
        duration_ms: 10,
        outcome: "done",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-long",
        workspace_id: "work-long",
        work_id: "work-long",
        session_id: "session-long",
        duration_ms: 20,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-long",
        workspace_id: "work-long",
        work_id: "work-long",
        session_id: "session-long",
        duration_ms: 22,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au03-long-session-compression",
        turn_id: "turn-long",
        workspace_id: "work-long",
        work_id: "work-long",
        session_id: "session-long",
        context_work_id: "work-long",
        active_session_id: "session-long",
        restored_turn_id: "turn-long",
        socket_connected: true,
        long_session_visible_text: "第12轮设定\n继续最新设定",
        duration_ms: 0,
        outcome: "done",
      },
    ];
    const llmRecords = [
      {
        turn_id: "turn-long",
        provider: "lmstudio",
        step: "form_frame",
        request: {
          method: "POST",
          url: "http://localhost:1234/v1/chat/completions",
          body: {
            messages: [
              {
                role: "system",
                content:
                  "## 当前作品上下文\n- title: AU03 Long Session Work\n- genre: 东方奇幻\n- core_selling_point: 长会话里保留最近设定，同时压缩早期讨论",
              },
              {
                role: "assistant",
                content: "会话早期摘要：作者提到「第1轮设定」；作者提到「第2轮设定」。",
              },
              { role: "user", content: "第3轮设定" },
              { role: "user", content: "第4轮设定" },
              { role: "user", content: "第5轮设定" },
              { role: "user", content: "第6轮设定" },
              { role: "user", content: "第7轮设定" },
              { role: "user", content: "第8轮设定" },
              { role: "user", content: "第9轮设定" },
              { role: "user", content: "第10轮设定" },
              { role: "user", content: "第11轮设定" },
              { role: "user", content: "第12轮设定" },
              { role: "user", content: "继续最新设定" },
            ],
          },
        },
        response: {
          status: 200,
          body: '{"choices":[{"message":{"content":"{\\"assistant_message\\":\\"我会沿用最近设定继续整理。\\"}"}}]}',
        },
      },
    ];

    const evidence = findNativeSliceEvidence("au03-long-session-compression", records);
    expect(evidence).toEqual({
      slice_id: "au03-long-session-compression",
      turn_id: "turn-long",
      turn_ids: ["turn-long"],
      work_id: "work-long",
      session_id: "session-long",
      context_refs_count: 1,
      key_events: keyEventsForSlice("au03-long-session-compression"),
    });
    expect(
      findSliceBehaviorEvidence("au03-long-session-compression", records, evidence, {
        provider: "lmstudio",
        llmRecords,
      }),
    ).toEqual({
      slice_id: "au03-long-session-compression",
      behavior: "long_active_session_context_uses_early_summary_and_recent_window",
      turn_ids: ["turn-long"],
      work_id: "work-long",
      session_id: "session-long",
      assertions: [
        "message_sent_from_real_workbench",
        "session_summary_attached_to_context",
        "old_turns_compressed_into_session_summary",
        "latest_recent_transcript_preserved_in_order",
        "planner_received_context_before_frame",
        "no_error_events",
        "assistant_messages_not_fallback",
      ],
    });
  });

  it("accepts AU-03 context source UI evidence when why panel shows author-safe sources", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-source",
        session_id: "session-source",
      },
      {
        event: "channel.join.done",
        work_id: "work-source",
        session_id: "session-source",
      },
      {
        event: "channel.user_message.start",
        turn_id: "turn-source",
        workspace_id: "work-source",
        work_id: "work-source",
        session_id: "session-source",
        generate_micro_plan: false,
        duration_ms: 0,
        outcome: "start",
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-source",
        workspace_id: "work-source",
        work_id: "work-source",
        session_id: "session-source",
        has_snapshot: true,
        has_conversation: true,
        has_memory: true,
        context_refs_count: 3,
        duration_ms: 3,
        outcome: "done",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-source",
        workspace_id: "work-source",
        work_id: "work-source",
        session_id: "session-source",
        duration_ms: 10,
        outcome: "done",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-source",
        workspace_id: "work-source",
        work_id: "work-source",
        session_id: "session-source",
        duration_ms: 20,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-source",
        workspace_id: "work-source",
        work_id: "work-source",
        session_id: "session-source",
        duration_ms: 25,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au03-context-source-ui",
        turn_id: "turn-source",
        workspace_id: "work-source",
        work_id: "work-source",
        session_id: "session-source",
        context_work_id: "work-source",
        active_session_id: "session-source",
        trace_why_dialog_open: true,
        trace_why_text:
          "自然回复 参考来源 当前作品背景 灵源纪元 / 东方奇幻 / 林烬追查灵源矿区真相 当前会话记录 上一轮围绕「林烬进入灵源矿区」展开，AI 已给出回应。 已确认设定 林瑶失踪指向灵源矿区，林烬去矿区追查线索。 解释来自本轮已保存的 trace 摘要，不会重新调用模型或改写作品。",
        trace_why_contains_raw_prompt: false,
        duration_ms: 0,
        outcome: "done",
      },
    ];

    const evidence = findNativeSliceEvidence("au03-context-source-ui", records);
    expect(evidence).toEqual({
      slice_id: "au03-context-source-ui",
      turn_id: "turn-source",
      turn_ids: ["turn-source"],
      work_id: "work-source",
      session_id: "session-source",
      context_refs_count: 3,
      key_events: keyEventsForSlice("au03-context-source-ui"),
    });
    expect(findSliceBehaviorEvidence("au03-context-source-ui", records, evidence)).toEqual({
      slice_id: "au03-context-source-ui",
      behavior: "author_visible_context_sources_render_from_trace_summary",
      turn_ids: ["turn-source"],
      work_id: "work-source",
      session_id: "session-source",
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
    });
  });

  it("accepts AU-11 quality diagnosis message envelope evidence", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-au11",
        session_id: "session-au11",
      },
      {
        event: "channel.join.done",
        work_id: "work-au11",
        session_id: "session-au11",
      },
      {
        event: "channel.user_message.start",
        turn_id: "turn-au11",
        workspace_id: "work-au11",
        work_id: "work-au11",
        session_id: "session-au11",
        generate_micro_plan: false,
        duration_ms: 1,
        outcome: "start",
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-au11",
        workspace_id: "work-au11",
        work_id: "work-au11",
        session_id: "session-au11",
        has_snapshot: true,
        has_conversation: false,
        has_memory: false,
        context_refs_count: 1,
        duration_ms: 5,
        outcome: "done",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-au11",
        workspace_id: "work-au11",
        work_id: "work-au11",
        session_id: "session-au11",
        duration_ms: 8,
        outcome: "done",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-au11",
        workspace_id: "work-au11",
        work_id: "work-au11",
        session_id: "session-au11",
        duration_ms: 15,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-au11",
        workspace_id: "work-au11",
        work_id: "work-au11",
        session_id: "session-au11",
        duration_ms: 18,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au11-quality-diagnosis-message-envelope",
        turn_id: "turn-au11",
        workspace_id: "work-au11",
        work_id: "work-au11",
        session_id: "session-au11",
        context_work_id: "work-au11",
        active_session_id: "session-au11",
        guidance_mode_quality: true,
        envelope_has_novel_layer: true,
        envelope_has_work_state: true,
        envelope_has_turn_guidance: true,
        novel_layer_has_quality_gates: true,
        work_state_has_current_work_source: true,
        work_state_chapter_summary_mentions_target: true,
        turn_guidance_focuses_quality: true,
        assistant_gives_concrete_tradeoff: true,
        no_tool_result: true,
        no_adoption_state: true,
        no_production_write: true,
        trace_why_dialog_open: true,
        trace_why_contains_raw_prompt: false,
        why_shows_quality_diagnosis: true,
        why_shows_quality_focus: true,
        why_shows_current_work_source: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au11-quality-diagnosis-message-envelope", records);
    expect(evidence).toEqual({
      slice_id: "au11-quality-diagnosis-message-envelope",
      turn_id: "turn-au11",
      turn_ids: ["turn-au11"],
      work_id: "work-au11",
      session_id: "session-au11",
      context_refs_count: 1,
      key_events: keyEventsForSlice("au11-quality-diagnosis-message-envelope"),
    });
    expect(
      findSliceBehaviorEvidence("au11-quality-diagnosis-message-envelope", records, evidence),
    ).toEqual({
      slice_id: "au11-quality-diagnosis-message-envelope",
      behavior: "quality_diagnosis_turn_records_vs00d_three_layer_envelope_without_write",
      turn_ids: ["turn-au11"],
      work_id: "work-au11",
      session_id: "session-au11",
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

  it("requires AU-09 adopted setting to be visible in the foreshadowing archive tab", () => {
    const records = [
      {
        event: "toolbox.execute.done",
        turn_id: "turn-create-setting",
        tool_outcome: "succeeded",
        tool_name: "world_building",
      },
      {
        event: "channel.author_action.done",
        turn_id: "turn-adopt-setting",
        action_type: "accept",
        action_status: "accepted",
      },
      {
        event: "channel.get_foreshadowing.done",
        work_id: "work-setting",
        item_count: 1,
      },
      {
        event: "channel.get_rules.done",
        work_id: "work-setting",
        rule_count: 1,
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-recall-setting",
        has_memory: true,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-adopt-setting-recall",
        work_id: "work-setting",
        recall_turn_id: "turn-recall-setting",
        setting_artifact_id: "setting-1",
        setting_artifact_type: "foreshadowing_seed",
        setting_chunk: "伏笔线索矿区旧",
        setting_adopted: true,
        why_shows_memory_source: true,
        archive_tab_checked: "foreshadowing,rule",
        archive_visible_after_adoption: true,
        archive_foreshadowing_count_after_adoption: 1,
        archive_rule_count_after_adoption: 1,
        archive_text_matched_adopted_setting: true,
        rule_setting_artifact_id: "rule-setting-1",
        rule_setting_artifact_type: "style_rule_seed",
        rule_setting_chunk: "风格规则后续写",
        archive_text_matched_adopted_rule: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au09-adopt-setting-recall", records);
    expect(evidence).toMatchObject({
      slice_id: "au09-adopt-setting-recall",
      turn_id: "turn-recall-setting",
      setting_artifact_type: "foreshadowing_seed",
      tool_name: "world_building",
      archive_tab_checked: "foreshadowing,rule",
      archive_foreshadowing_count_after_adoption: 1,
      archive_rule_count_after_adoption: 1,
      rule_setting_artifact_type: "style_rule_seed",
    });
    expect(findSliceBehaviorEvidence("au09-adopt-setting-recall", records, evidence)).toEqual({
      slice_id: "au09-adopt-setting-recall",
      behavior: "adopted_ai_setting_becomes_governed_memory_and_recalls",
      turn_ids: ["turn-recall-setting"],
      setting_artifact_type: "foreshadowing_seed",
      tool_name: "world_building",
      setting_chunk: "伏笔线索矿区旧",
      archive_tab_checked: "foreshadowing,rule",
      archive_foreshadowing_count_after_adoption: 1,
      archive_rule_count_after_adoption: 1,
      rule_setting_artifact_type: "style_rule_seed",
      rule_setting_chunk: "风格规则后续写",
      assertions: [
        "ai_generated_a_setting_artifact_from_real_workbench",
        "author_adopted_setting_into_confirmed_recallable_governed_memory",
        "adopted_setting_visible_in_foreshadowing_archive_tab_after_reopen",
        "adopted_rule_visible_in_rules_archive_tab_after_reopen",
        "adopted_setting_recalled_into_later_turn_context",
        "why_panel_shows_confirmed_memory_as_author_safe_source",
        "deterministic_context_assembled_with_adopted_setting",
      ],
    });
  });

  it("requires AU-09 memory management entry lifecycle evidence", () => {
    const records = [
      {
        event: "context.assemble.done",
        turn_id: "turn-locked-recall",
        has_memory: true,
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-locked-recall",
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-terminal-probe",
        has_memory: true,
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-terminal-probe",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-memory-management-entry",
        locked_recall_turn_id: "turn-locked-recall",
        terminal_recall_turn_id: "turn-terminal-probe",
        memory_nonce: "蓝焰税契",
        archived_memory_nonce: "暮钟海图",
        memory_created: true,
        memory_confirmed: true,
        memory_locked: true,
        locked_controls_disabled: true,
        locked_recalled_before_terminal_action: true,
        why_shows_locked_memory_source: true,
        memory_deprecated: true,
        archived_memory_created: true,
        archived_memory_confirmed: true,
        archived_memory_archived: true,
        terminal_context_has_memory: true,
        terminal_managed_memory_excluded: true,
        why_excludes_terminal_memory_content: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au09-memory-management-entry", records);
    expect(evidence).toEqual({
      slice_id: "au09-memory-management-entry",
      turn_id: "turn-terminal-probe",
      turn_ids: ["turn-locked-recall", "turn-terminal-probe"],
      memory_nonce: "蓝焰税契",
      archived_memory_nonce: "暮钟海图",
      locked_recall_turn_id: "turn-locked-recall",
      terminal_recall_turn_id: "turn-terminal-probe",
      key_events: keyEventsForSlice("au09-memory-management-entry"),
    });
    expect(findSliceBehaviorEvidence("au09-memory-management-entry", records, evidence)).toEqual({
      slice_id: "au09-memory-management-entry",
      behavior: "author_manages_memory_lifecycle_from_workbench_and_terminal_states_stop_recall",
      turn_ids: ["turn-locked-recall", "turn-terminal-probe"],
      memory_nonce: "蓝焰税契",
      archived_memory_nonce: "暮钟海图",
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
    });
  });

  it("requires AU-09 memory trace roundtrip lifecycle and exclusion evidence", () => {
    const records = [
      {
        event: "context.assemble.done",
        turn_id: "turn-locked-recall",
        has_memory: true,
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-locked-recall",
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-terminal-probe",
        has_memory: false,
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-terminal-probe",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-memory-trace-roundtrip",
        locked_recall_turn_id: "turn-locked-recall",
        terminal_recall_turn_id: "turn-terminal-probe",
        memory_nonce: "赤铜回声",
        archived_memory_nonce: "银沙旧律",
        lifecycle_trace_visible: true,
        create_trace_visible: true,
        confirm_trace_visible: true,
        lock_trace_visible: true,
        unlock_trace_visible: true,
        deprecate_trace_visible: true,
        archive_trace_visible: true,
        trace_explains_locked_recall: true,
        trace_explains_terminal_exclusion: true,
        locked_controls_disabled: true,
        locked_recalled_before_terminal_action: true,
        why_shows_locked_memory_source: true,
        terminal_managed_memory_excluded: true,
        why_excludes_terminal_memory_content: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au09-memory-trace-roundtrip", records);
    expect(evidence).toEqual({
      slice_id: "au09-memory-trace-roundtrip",
      turn_id: "turn-terminal-probe",
      turn_ids: ["turn-locked-recall", "turn-terminal-probe"],
      memory_nonce: "赤铜回声",
      archived_memory_nonce: "银沙旧律",
      locked_recall_turn_id: "turn-locked-recall",
      terminal_recall_turn_id: "turn-terminal-probe",
      key_events: keyEventsForSlice("au09-memory-trace-roundtrip"),
    });
    expect(findSliceBehaviorEvidence("au09-memory-trace-roundtrip", records, evidence)).toEqual({
      slice_id: "au09-memory-trace-roundtrip",
      behavior: "author_views_memory_lifecycle_trace_and_terminal_recall_exclusion",
      turn_ids: ["turn-locked-recall", "turn-terminal-probe"],
      memory_nonce: "赤铜回声",
      archived_memory_nonce: "银沙旧律",
      assertions: [
        "memory_detail_reference_view_shows_author_safe_lifecycle_trace",
        "create_confirm_lock_unlock_deprecate_archive_actions_have_visible_trace",
        "locked_memory_remains_recallable_and_trace_explains_the_lock",
        "locked_terminal_controls_are_disabled_in_real_workbench",
        "deprecated_and_archived_memories_are_excluded_from_later_dialogue_context",
        "why_panel_excludes_terminal_memory_content",
      ],
    });
  });

  it("accepts AU-09 character dossier roundtrip evidence", () => {
    const records = [
      {
        event: "channel.user_message.start",
        turn_id: "turn-char-create",
        work_id: "work-char",
        generate_micro_plan: true,
      },
      {
        event: "toolbox.execute.done",
        turn_id: "turn-char-create",
        work_id: "work-char",
        tool_name: "character_design",
        tool_outcome: "succeeded",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-char-create",
        work_id: "work-char",
      },
      {
        event: "channel.author_action.start",
        turn_id: "turn-char-create",
        work_id: "work-char",
        action_type: "accept",
      },
      {
        event: "adoption.evaluate.done",
        turn_id: "turn-char-create",
        work_id: "work-char",
        decision_type: "adopt_tentative",
      },
      {
        event: "channel.author_action.done",
        turn_id: "turn-char-create",
        work_id: "work-char",
        action_type: "accept",
        action_status: "accepted",
      },
      {
        event: "channel.get_characters.done",
        work_id: "work-char",
        character_count: 1,
      },
      {
        event: "channel.user_message.start",
        turn_id: "turn-char-context",
        work_id: "work-char",
        generate_micro_plan: true,
      },
      {
        event: "context.characters.done",
        turn_id: "turn-char-context",
        work_id: "work-char",
        character_count: 1,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-character-dossier-roundtrip",
        turn_id: "turn-char-context",
        creation_turn_id: "turn-char-create",
        adoption_turn_id: "turn-char-adopt",
        context_turn_id: "turn-char-context",
        character_artifact_id: "as-char",
        character_artifact_type: "character_seed",
        character_title: "沈砚",
        adopted_state_ref: "character-1",
        archive_character_count: 1,
        context_character_count: 1,
        character_visible_in_archive: true,
        create_entry_visible_after_character: true,
        create_prompt_is_character_design: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au09-character-dossier-roundtrip", records);
    expect(evidence).toMatchObject({
      slice_id: "au09-character-dossier-roundtrip",
      turn_id: "turn-char-context",
      character_artifact_id: "as-char",
      adopted_state_ref: "character-1",
      archive_character_count: 1,
      context_character_count: 1,
    });
    expect(
      findSliceBehaviorEvidence("au09-character-dossier-roundtrip", records, evidence),
    ).toEqual({
      slice_id: "au09-character-dossier-roundtrip",
      behavior: "character_seed_adoption_writes_character_dossier_and_reaches_next_context",
      turn_ids: ["turn-char-create", "turn-char-context"],
      character_title: "沈砚",
      adopted_state_ref: "character-1",
      assertions: [
        "archive_create_character_sends_role_design_prompt_not_foreshadowing",
        "character_design_generated_character_seed_from_real_workbench",
        "author_adopted_character_seed_through_adoption_boundary",
        "adopted_state_ref_points_to_persisted_character_state",
        "archive_character_tab_loaded_adopted_character",
        "character_tab_kept_create_entry_after_character_exists",
        "next_character_design_turn_received_character_dossier_context",
        "deterministic_context_logged_character_dossier",
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
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-memory-recall-context",
        turn_id: "turn-memory",
        workspace_id: "work-memory",
        work_id: "work-memory",
        session_id: "session-memory",
        trace_why_dialog_open: true,
        trace_why_text: "本轮解释 参考来源 已确认设定 林瑶失踪指向灵源矿区，林烬去矿区追查线索。",
        trace_why_contains_raw_prompt: false,
        duration_ms: 0,
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
        "memory_source_summary_visible_in_why_dialog",
        "planner_received_context_before_frame",
        "no_error_events",
        "assistant_messages_not_fallback",
      ],
    });
  });

  it("requires AU-09 cross-work memory isolation across archive memory recall and why", () => {
    const records = [
      { event: "work_session.resume.done", work_id: "work-b", session_id: "session-b" },
      { event: "channel.join.done", work_id: "work-a", session_id: "session-a" },
      { event: "channel.join.done", work_id: "work-b", session_id: "session-b" },
      { event: "channel.get_foreshadowing.done", work_id: "work-b", item_count: 1 },
      { event: "channel.get_rules.done", work_id: "work-b", rule_count: 1 },
      {
        event: "channel.user_message.start",
        turn_id: "turn-isolation",
        work_id: "work-b",
        session_id: "session-b",
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-isolation",
        work_id: "work-b",
        session_id: "session-b",
        has_memory: true,
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-isolation",
        work_id: "work-b",
        session_id: "session-b",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-cross-work-memory-isolation",
        turn_id: "turn-isolation",
        recall_turn_id: "turn-isolation",
        work_id: "work-b",
        current_work_id: "work-b",
        foreign_work_id: "work-a",
        joined_work_count: 2,
        switched_through_foreign_work: true,
        archive_current_only: true,
        memory_page_current_only: true,
        context_includes_current_work_memory: true,
        context_excludes_foreign_work_memory: true,
        why_shows_current_work_memory: true,
        why_excludes_foreign_work_memory: true,
        current_memory_nonce: "乙界星钥",
        foreign_memory_nonce: "甲界暮钟",
      },
    ];

    const evidence = findNativeSliceEvidence("au09-cross-work-memory-isolation", records);
    expect(evidence).toEqual({
      slice_id: "au09-cross-work-memory-isolation",
      turn_id: "turn-isolation",
      turn_ids: ["turn-isolation"],
      work_id: "work-b",
      current_work_id: "work-b",
      foreign_work_id: "work-a",
      joined_work_count: 2,
      current_memory_nonce: "乙界星钥",
      foreign_memory_nonce: "甲界暮钟",
      key_events: keyEventsForSlice("au09-cross-work-memory-isolation"),
    });
    expect(
      findSliceBehaviorEvidence("au09-cross-work-memory-isolation", records, evidence),
    ).toEqual({
      slice_id: "au09-cross-work-memory-isolation",
      behavior: "current_work_archive_memory_recall_and_why_exclude_foreign_work_memory",
      turn_ids: ["turn-isolation"],
      work_id: "work-b",
      foreign_work_id: "work-a",
      current_memory_nonce: "乙界星钥",
      foreign_memory_nonce: "甲界暮钟",
      assertions: [
        "author_switched_between_two_real_works",
        "archive_foreshadowing_and_rule_tabs_showed_current_work_only",
        "memory_management_table_showed_current_work_only",
        "dialogue_input_matched_both_work_keywords",
        "context_assembly_attached_current_work_memory_only",
        "why_panel_showed_current_memory_source_without_foreign_work_summary",
        "deterministic_context_excluded_foreign_work_memory",
      ],
    });
  });

  it("requires AU-09/AU-03 session and memory source layering in the same work", () => {
    const records = [
      { event: "work_session.resume.done", work_id: "work-layer", session_id: "session-active" },
      { event: "channel.join.done", work_id: "work-layer", session_id: "session-active" },
      {
        event: "work_session.show.done",
        work_id: "work-layer",
        session_id: "session-history",
        read_only: true,
        transcript_count: 2,
        pending_adoption_count: 0,
      },
      {
        event: "channel.user_message.start",
        turn_id: "turn-layer",
        work_id: "work-layer",
        session_id: "session-active",
        generate_micro_plan: false,
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-layer",
        work_id: "work-layer",
        session_id: "session-active",
        has_snapshot: true,
        has_conversation: true,
        has_memory: true,
        context_refs_count: 3,
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-layer",
        work_id: "work-layer",
        session_id: "session-active",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-layer",
        work_id: "work-layer",
        session_id: "session-active",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-au03-session-memory-layering",
        turn_id: "turn-layer",
        recall_turn_id: "turn-layer",
        work_id: "work-layer",
        session_id: "session-active",
        active_session_id: "session-active",
        readonly_session_id: "session-history",
        readonly_session_transcript_visible: true,
        readonly_input_disabled: true,
        active_session_restored: true,
        context_source_types: ["current_work", "session_transcript", "memory"],
        context_has_current_work: true,
        context_has_session_transcript: true,
        context_has_memory: true,
        context_excludes_conversation_fallback: true,
        context_session_summary_includes_active: true,
        context_session_summary_excludes_history: true,
        context_memory_summary_includes_memory: true,
        context_memory_summary_excludes_history: true,
        trace_why_dialog_open: true,
        trace_why_contains_raw_prompt: false,
        why_shows_current_work_source: true,
        why_shows_session_source: true,
        why_shows_memory_source: true,
        why_shows_active_session_summary: true,
        why_shows_memory_summary: true,
        why_excludes_historical_transcript: true,
        active_session_token: "当前蓝桥计划",
        memory_token: "银槐誓约",
        historical_session_token: "旧稿赤塔",
      },
    ];

    const evidence = findNativeSliceEvidence("au09-au03-session-memory-layering", records);
    expect(evidence).toEqual({
      slice_id: "au09-au03-session-memory-layering",
      turn_id: "turn-layer",
      turn_ids: ["turn-layer"],
      work_id: "work-layer",
      session_id: "session-active",
      readonly_session_id: "session-history",
      context_refs_count: 3,
      active_session_token: "当前蓝桥计划",
      memory_token: "银槐誓约",
      historical_session_token: "旧稿赤塔",
      key_events: keyEventsForSlice("au09-au03-session-memory-layering"),
    });
    expect(
      findSliceBehaviorEvidence("au09-au03-session-memory-layering", records, evidence),
    ).toEqual({
      slice_id: "au09-au03-session-memory-layering",
      behavior:
        "active_session_transcript_current_work_and_governed_memory_are_layered_without_history_leak",
      turn_ids: ["turn-layer"],
      work_id: "work-layer",
      session_id: "session-active",
      readonly_session_id: "session-history",
      active_session_token: "当前蓝桥计划",
      memory_token: "银槐誓约",
      historical_session_token: "旧稿赤塔",
      assertions: [
        "historical_session_opened_readonly_from_real_workbench",
        "readonly_history_input_was_disabled",
        "active_session_restored_before_author_message",
        "context_refs_contain_current_work_session_transcript_and_memory",
        "active_session_transcript_not_labelled_as_generic_conversation",
        "historical_session_transcript_not_in_session_or_memory_sources",
        "why_panel_separates_current_work_session_and_memory_sources",
        "deterministic_trace_refs_layered_session_and_memory_sources",
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
    const records = ordinaryTwoTurnRecords();

    expect(findNativeSliceEvidence("au01-ordinary-chat-two-turn-roundtrip", records)).toEqual({
      slice_id: "au01-ordinary-chat-two-turn-roundtrip",
      turn_id: "turn-a",
      turn_ids: ["turn-a", "turn-b"],
      user_message_count: 2,
      assistant_turn_message_count: 2,
      message_role_order: ["user", "assistant", "user", "assistant"],
      thinking_observed: true,
      thinking_visible_after_reply: false,
      key_events: [
        "channel.user_message.start",
        "dialogue_gateway.handle_input.done",
        "channel.user_message.done",
      ],
    });
  });

  it("rejects ordinary two-turn evidence if a micro plan event appears", () => {
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

    expect(findNativeSliceEvidence("au01-ordinary-chat-two-turn-roundtrip", records)).toBeNull();
  });

  it("rejects ordinary two-turn evidence without real workbench UI state", () => {
    const records = ordinaryTwoTurnRecords().filter(
      (record) => record.event !== "slice_verify.ui_state.done",
    );

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

  it("finds AU-10 workbench matrix layout evidence from aggregate UI state and correlated events", () => {
    const records = au10WorkbenchMatrixRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-matrix-layout", records);

    expect(evidence).toEqual({
      slice_id: "au10-workbench-matrix-layout",
      turn_id: "turn-au10-ordinary",
      turn_ids: [
        "turn-au10-ordinary",
        "turn-au10-candidate",
        "turn-au10-draft",
        "turn-au10-adoption",
      ],
      ordinary_turn_id: "turn-au10-ordinary",
      candidate_turn_id: "turn-au10-candidate",
      draft_turn_id: "turn-au10-draft",
      adoption_turn_id: "turn-au10-adoption",
      artifact_id: "artifact-au10",
      candidate_ref: "dir-au10",
      viewport_width: 1280,
      viewport_height: 800,
      matrix_phases: ["ordinary_turn", "candidate_action", "adoption_reading"],
      key_events: keyEventsForSlice("au10-workbench-matrix-layout"),
    });
  });

  it("rejects AU-10 matrix evidence if the ordinary turn enters micro-plan", () => {
    expect(
      findNativeSliceEvidence(
        "au10-workbench-matrix-layout",
        au10WorkbenchMatrixRecords({ ordinaryMicroPlan: true }),
      ),
    ).toBeNull();
  });

  it("accepts AU-10 matrix behavior when layout, action, why and projection all passed", () => {
    const records = au10WorkbenchMatrixRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-matrix-layout", records);

    expect(findSliceBehaviorEvidence("au10-workbench-matrix-layout", records, evidence)).toEqual({
      slice_id: "au10-workbench-matrix-layout",
      behavior: "workbench_matrix_layout_covers_core_real_ui_states",
      turn_ids: [
        "turn-au10-ordinary",
        "turn-au10-candidate",
        "turn-au10-draft",
        "turn-au10-adoption",
      ],
      viewport: "1280x800",
      artifact_id: "artifact-au10",
      candidate_ref: "dir-au10",
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
    });
  });

  it("finds AU-10 recovery task_state evidence from export-driven UI state", () => {
    const records = au10WorkbenchRecoveryTaskstateRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-taskstate", records);

    expect(evidence).toEqual({
      slice_id: "au10-workbench-recovery-taskstate",
      turn_id: "turn-au10-draft",
      turn_ids: ["turn-au10-draft", "turn-au10-adoption"],
      draft_turn_id: "turn-au10-draft",
      adoption_turn_id: "turn-au10-adoption",
      artifact_id: "artifact-au10",
      task_id: "task-export-1",
      task_type: "export_work",
      task_state_phases: ["RUNNING", "CHECKPOINT", "COMPLETED"],
      task_state_count: 3,
      key_events: keyEventsForSlice("au10-workbench-recovery-taskstate"),
    });
  });

  it("accepts AU-10 recovery task_state behavior when export streams visible lifecycle", () => {
    const records = au10WorkbenchRecoveryTaskstateRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-taskstate", records);

    expect(
      findSliceBehaviorEvidence("au10-workbench-recovery-taskstate", records, evidence),
    ).toEqual({
      slice_id: "au10-workbench-recovery-taskstate",
      behavior: "export_action_streams_task_state_lifecycle_to_real_workbench",
      turn_ids: ["turn-au10-draft", "turn-au10-adoption"],
      task_id: "task-export-1",
      task_type: "export_work",
      artifact_id: "artifact-au10",
      task_state_phases: ["RUNNING", "CHECKPOINT", "COMPLETED"],
      assertions: [
        "author_clicked_real_export_button_from_reading_mode",
        "export_action_broadcast_running_task_state",
        "export_action_broadcast_checkpoint_task_state",
        "export_action_broadcast_completed_task_state",
        "workspace_status_bar_kept_completed_task_visible_after_return",
        "task_state_was_observed_through_websocket_frames",
        "export_result_path_was_visible_to_author",
      ],
    });
  });

  it("finds AU-10 recovery provider failure evidence from failure and following turn", () => {
    const records = au10WorkbenchRecoveryDisconnectTimeoutRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-disconnect-timeout", records);

    expect(evidence).toEqual({
      slice_id: "au10-workbench-recovery-disconnect-timeout",
      turn_id: "turn-recovery",
      turn_ids: ["turn-failure", "turn-recovery"],
      failure_turn_id: "turn-failure",
      recovery_turn_id: "turn-recovery",
      failing_provider: "lmstudio",
      recovery_provider: "slice_verify",
      key_events: keyEventsForSlice("au10-workbench-recovery-disconnect-timeout"),
    });
  });

  it("accepts AU-10 recovery behavior when provider failure clears loading and recovers", () => {
    const records = au10WorkbenchRecoveryDisconnectTimeoutRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-disconnect-timeout", records);

    expect(
      findSliceBehaviorEvidence("au10-workbench-recovery-disconnect-timeout", records, evidence),
    ).toEqual({
      slice_id: "au10-workbench-recovery-disconnect-timeout",
      behavior: "provider_failure_clears_loading_and_allows_following_turn",
      turn_ids: ["turn-failure", "turn-recovery"],
      failure_turn_id: "turn-failure",
      recovery_turn_id: "turn-recovery",
      failing_provider: "lmstudio",
      recovery_provider: "slice_verify",
      assertions: [
        "provider_failure_returned_error_turn_result",
        "failure_message_told_author_no_artifact_or_production_write_happened",
        "workspace_loading_indicator_cleared_after_failure",
        "input_remained_available_after_failure",
        "author_sent_following_message_without_refresh",
        "following_turn_completed_after_provider_recovery",
      ],
    });
  });

  it("finds AU-10 provider timeout evidence from timeout and following turn", () => {
    const records = au10WorkbenchRecoveryProviderTimeoutRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-provider-timeout", records);

    expect(evidence).toEqual({
      slice_id: "au10-workbench-recovery-provider-timeout",
      turn_id: "turn-after-timeout",
      turn_ids: ["turn-timeout", "turn-after-timeout"],
      timeout_turn_id: "turn-timeout",
      recovery_turn_id: "turn-after-timeout",
      timeout_provider: "lmstudio",
      timeout_reason_code: "timeout",
      recovery_provider: "slice_verify",
      key_events: keyEventsForSlice("au10-workbench-recovery-provider-timeout"),
    });
  });

  it("accepts AU-10 provider timeout behavior when timeout clears loading and recovers", () => {
    const records = au10WorkbenchRecoveryProviderTimeoutRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-provider-timeout", records);

    expect(
      findSliceBehaviorEvidence("au10-workbench-recovery-provider-timeout", records, evidence),
    ).toEqual({
      slice_id: "au10-workbench-recovery-provider-timeout",
      behavior: "provider_timeout_clears_loading_and_allows_following_turn",
      turn_ids: ["turn-timeout", "turn-after-timeout"],
      timeout_turn_id: "turn-timeout",
      recovery_turn_id: "turn-after-timeout",
      timeout_provider: "lmstudio",
      timeout_reason_code: "timeout",
      recovery_provider: "slice_verify",
      assertions: [
        "provider_timeout_returned_timeout_fallback_turn_result",
        "timeout_message_told_author_no_artifact_or_production_write_happened",
        "workspace_loading_indicator_cleared_after_timeout",
        "input_remained_available_after_timeout",
        "author_sent_following_message_without_refresh",
        "following_turn_completed_after_provider_timeout_recovery",
      ],
    });
  });

  it("finds AU-10 websocket reconnect evidence from rejoin and following turn", () => {
    const records = au10WorkbenchRecoveryReconnectRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-reconnect", records);

    expect(evidence).toEqual({
      slice_id: "au10-workbench-recovery-reconnect",
      turn_id: "turn-after-reconnect",
      join_count_after_restore: 2,
      key_events: keyEventsForSlice("au10-workbench-recovery-reconnect"),
    });
  });

  it("accepts AU-10 reconnect behavior when offline disables input and recovery completes", () => {
    const records = au10WorkbenchRecoveryReconnectRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-reconnect", records);

    expect(
      findSliceBehaviorEvidence("au10-workbench-recovery-reconnect", records, evidence),
    ).toEqual({
      slice_id: "au10-workbench-recovery-reconnect",
      behavior: "websocket_disconnect_disables_input_and_reconnect_allows_following_turn",
      turn_id: "turn-after-reconnect",
      join_count_after_restore: 2,
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
    });
  });

  it("finds AU-10 cancel waiting evidence from cancellation and following turn", () => {
    const records = au10WorkbenchRecoveryCancelWaitingRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-cancel-waiting", records);

    expect(evidence).toEqual({
      slice_id: "au10-workbench-recovery-cancel-waiting",
      turn_id: "turn-after-cancel",
      turn_ids: ["turn-confirm", "turn-cancelled", "turn-after-cancel"],
      confirmation_turn_id: "turn-confirm",
      cancel_turn_id: "turn-cancelled",
      following_turn_id: "turn-after-cancel",
      action_id: "reject:artifact-1",
      action_type: "reject_or_cancel_confirmation",
      key_events: keyEventsForSlice("au10-workbench-recovery-cancel-waiting"),
    });
  });

  it("accepts AU-10 cancel waiting behavior when cancellation closes behavior and recovers", () => {
    const records = au10WorkbenchRecoveryCancelWaitingRecords();
    const evidence = findNativeSliceEvidence("au10-workbench-recovery-cancel-waiting", records);

    expect(
      findSliceBehaviorEvidence("au10-workbench-recovery-cancel-waiting", records, evidence),
    ).toEqual({
      slice_id: "au10-workbench-recovery-cancel-waiting",
      behavior: "cancel_waiting_closes_confirmation_without_write_and_allows_following_turn",
      turn_ids: ["turn-confirm", "turn-cancelled", "turn-after-cancel"],
      confirmation_turn_id: "turn-confirm",
      cancel_turn_id: "turn-cancelled",
      following_turn_id: "turn-after-cancel",
      action_id: "reject:artifact-1",
      action_type: "reject_or_cancel_confirmation",
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
    });
  });

  it("finds AU-12 work profile overview evidence from archive UI state", () => {
    const records = au12WorkProfileOverviewRecords();
    const evidence = findNativeSliceEvidence("au12-work-profile-overview", records);

    expect(evidence).toEqual({
      slice_id: "au12-work-profile-overview",
      work_id: "work-au12",
      work_title: "AU12档案作品",
      profile_status: "TENTATIVE",
      profile_revision: 2,
      key_events: keyEventsForSlice("au12-work-profile-overview"),
    });
  });

  it("accepts AU-12 work profile overview behavior when profile is visible and readonly", () => {
    const records = au12WorkProfileOverviewRecords();
    const evidence = findNativeSliceEvidence("au12-work-profile-overview", records);

    expect(findSliceBehaviorEvidence("au12-work-profile-overview", records, evidence)).toEqual({
      slice_id: "au12-work-profile-overview",
      behavior: "author_opens_work_profile_overview_from_real_archive",
      turn_ids: [],
      work_id: "work-au12",
      work_title: "AU12档案作品",
      profile_status: "TENTATIVE",
      profile_revision: 2,
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
    });
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
    const evidence = findLmStudioEvidence(
      ["turn-real"],
      [
        {
          turn_id: "turn-real",
          provider: "lmstudio",
          request: { method: "POST", url: "http://localhost:1234/v1/chat/completions" },
          response: { status: 200 },
        },
      ],
    );

    expect(evidence).toEqual({
      provider: "lmstudio",
      turn_ids: ["turn-real"],
      request_count: 1,
      status_codes: [200],
    });
  });

  it("rejects slice evidence without matching real LM Studio request", () => {
    const evidence = findLmStudioEvidence(
      ["turn-real"],
      [
        {
          turn_id: "turn-other",
          provider: "slice_verify",
          request: { method: "POST", url: "memory://slice-verify" },
          response: { status: 200 },
        },
      ],
    );

    expect(evidence).toBeNull();
  });

  it("accepts ordinary chat behavior only when both turns complete without micro plan or fallback", () => {
    const records = ordinaryTwoTurnRecords();
    const llmRecords = [
      lmRecord("turn-a", "form_frame", "可以，我们先聊小说创作。"),
      lmRecord("turn-b", "form_frame", "还可以从人物和世界规则继续展开。"),
    ];
    const evidence = findNativeSliceEvidence("au01-ordinary-chat-two-turn-roundtrip", records);

    expect(
      findSliceBehaviorEvidence("au01-ordinary-chat-two-turn-roundtrip", records, evidence, {
        provider: "lmstudio",
        llmRecords,
      }),
    ).toEqual({
      slice_id: "au01-ordinary-chat-two-turn-roundtrip",
      behavior: "ordinary_chat_two_turn_visible_roundtrip",
      turn_ids: ["turn-a", "turn-b"],
      assertions: [
        "two_user_turns_completed",
        "real_workbench_rendered_two_user_and_two_assistant_turns_in_order",
        "thinking_indicator_appeared_then_cleared",
        "micro_plan_not_requested",
        "no_action_candidate_or_adoption_cards_rendered",
        "no_error_events",
        "assistant_messages_not_fallback",
        "lmstudio_form_frame_called_per_turn",
      ],
    });
  });

  it("labels deterministic provider ordinary chat evidence without claiming LM Studio calls", () => {
    const records = ordinaryTwoTurnRecords();
    const evidence = findNativeSliceEvidence("au01-ordinary-chat-two-turn-roundtrip", records);

    expect(
      findSliceBehaviorEvidence("au01-ordinary-chat-two-turn-roundtrip", records, evidence, {
        provider: "slice_verify",
      })?.assertions,
    ).toContain("deterministic_provider_form_frame_called_per_turn");
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
      behavior:
        "workspace_runtime_state_normalizes_resume_connection_adoption_and_reading_empty_state",
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

    expect(
      findSliceBehaviorEvidence("au08-adoption-reading-projection", records, evidence),
    ).toEqual({
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

  it("accepts P1 chapter draft generation only when draft stays pending outside reading mode", () => {
    const records = p1ChapterDraftGenerationRecords("turn-draft");
    const evidence = findNativeSliceEvidence("p1-chapter-draft-generation", records);

    expect(evidence).toEqual({
      slice_id: "p1-chapter-draft-generation",
      turn_id: "turn-draft",
      turn_ids: ["turn-draft"],
      draft_turn_id: "turn-draft",
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      draft_body_chars: 128,
      chapter_count: 12,
      reading_chapter_count: 12,
      key_events: keyEventsForSlice("p1-chapter-draft-generation"),
    });
    expect(findSliceBehaviorEvidence("p1-chapter-draft-generation", records, evidence)).toEqual({
      slice_id: "p1-chapter-draft-generation",
      behavior: "chapter_draft_generated_from_adopted_plan_without_reading_projection",
      turn_ids: ["turn-draft"],
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      draft_body_chars: 128,
      assertions: [
        "real_archive_outline_chapter_plan_rendered",
        "chapter_draft_requested_from_visible_chapter_action",
        "micro_plan_requested_from_real_workbench",
        "prose_writing_generated_prose_fragment",
        "prose_fragment_remained_pending_for_author_adoption",
        "reading_mode_checked_before_adoption",
        "unadopted_prose_fragment_did_not_materialize_reading_projection",
        "no_adoption_event_was_sent",
        "deterministic_provider_form_frame_and_micro_plan_called",
      ],
    });
  });

  it("rejects P1 chapter draft evidence when unadopted draft leaks into reading mode", () => {
    const records = p1ChapterDraftGenerationRecords("turn-draft").map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, unadopted_draft_visible_in_reading: true }
        : record,
    );

    expect(findNativeSliceEvidence("p1-chapter-draft-generation", records)).toBeNull();
  });

  it("accepts P1 chapter expansion only when reading mode hides generated scene placeholders", () => {
    const records = p1ChapterExpansionRecords("turn-p1-expansion", "正文\n\n矿道追击\n正文");
    const evidence = findNativeSliceEvidence("p1-chapter-expansion", records);

    expect(evidence).toMatchObject({
      slice_id: "p1-chapter-expansion",
      turn_id: "turn-p1-expansion",
      scene_placeholder_titles_hidden: true,
      continuation_count: 2,
      prior_prose_context_events: 2,
    });
    expect(findSliceBehaviorEvidence("p1-chapter-expansion", records, evidence)).toMatchObject({
      slice_id: "p1-chapter-expansion",
      scene_placeholder_titles_hidden: true,
      assertions: expect.arrayContaining(["reading_mode_hides_generated_scene_placeholder_titles"]),
    });
  });

  it("rejects P1 chapter expansion when generated scene placeholder titles leak to reading mode", () => {
    const records = p1ChapterExpansionRecords("turn-p1-expansion", "正文\n场景 2\n续写正文");

    expect(findNativeSliceEvidence("p1-chapter-expansion", records)).toBeNull();
  });

  it("accepts VS-00C CP3 only when structured chapter context reaches prose writing", () => {
    const records = vs00cCp3StructuredContextRecords("turn-cp3");
    const evidence = findNativeSliceEvidence("vs00c-cp3-structured-context", records);

    expect(evidence).toEqual({
      slice_id: "vs00c-cp3-structured-context",
      turn_id: "turn-cp3",
      turn_ids: ["turn-cp3"],
      draft_turn_id: "turn-cp3",
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第02章：旧服务器里的残诀",
      chapter_seq: 2,
      previous_chapter_title: "第01章：底层灵气账单",
      next_chapter_title: "第03章",
      has_plan_summary: true,
      has_previous: true,
      has_next: true,
      draft_body_chars: 128,
      assembly_policy_id: "slice_verify",
      chapter_count: 12,
      key_events: keyEventsForSlice("vs00c-cp3-structured-context"),
    });
    expect(findSliceBehaviorEvidence("vs00c-cp3-structured-context", records, evidence)).toEqual({
      slice_id: "vs00c-cp3-structured-context",
      behavior: "structured_chapter_plan_context_reaches_prose_writing",
      turn_ids: ["turn-cp3"],
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第02章：旧服务器里的残诀",
      chapter_seq: 2,
      draft_body_chars: 128,
      assertions: [
        "real_archive_outline_second_chapter_action_clicked",
        "micro_plan_requested_from_real_workbench",
        "structured_chapter_context_emitted_for_target_chapter",
        "target_chapter_plan_summary_available_before_provider_call",
        "previous_and_next_chapter_position_available",
        "prose_writing_generated_pending_draft_without_adoption",
        "adopted_plan_remained_toc_source_before_prose_adoption",
        "deterministic_provider_form_frame_and_micro_plan_called",
      ],
    });
  });

  it("rejects VS-00C CP3 evidence when structured chapter context log is missing", () => {
    const records = vs00cCp3StructuredContextRecords("turn-cp3").filter(
      (record) => record.event !== "context.structure.done",
    );

    expect(findNativeSliceEvidence("vs00c-cp3-structured-context", records)).toBeNull();
  });

  it("accepts VS-00C CP4 only when structured chapter direction reaches prose writing", () => {
    const records = vs00cCp4ChapterPlanStructureRecords();
    const evidence = findNativeSliceEvidence("vs00c-cp4-chapter-plan-structure", records);

    expect(evidence).toEqual({
      slice_id: "vs00c-cp4-chapter-plan-structure",
      turn_id: "turn-cp4-draft",
      turn_ids: ["turn-cp4-plan", "turn-cp4-adopt", "turn-cp4-draft"],
      generation_turn_id: "turn-cp4-plan",
      adoption_turn_id: "turn-cp4-adopt",
      draft_turn_id: "turn-cp4-draft",
      outline_artifact_id: "artifact-outline-cp4",
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第02章：试炼",
      chapter_seq: 2,
      chapter_count: 12,
      has_plan_summary: true,
      has_plan_direction: true,
      draft_body_chars: 128,
      assembly_policy_id: "slice_verify",
      key_events: keyEventsForSlice("vs00c-cp4-chapter-plan-structure"),
    });

    expect(
      findSliceBehaviorEvidence("vs00c-cp4-chapter-plan-structure", records, evidence),
    ).toEqual({
      slice_id: "vs00c-cp4-chapter-plan-structure",
      behavior: "structured_chapter_direction_materializes_and_reaches_prose_writing",
      turn_ids: ["turn-cp4-plan", "turn-cp4-adopt", "turn-cp4-draft"],
      generation_turn_id: "turn-cp4-plan",
      adoption_turn_id: "turn-cp4-adopt",
      draft_turn_id: "turn-cp4-draft",
      outline_artifact_id: "artifact-outline-cp4",
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第02章：试炼",
      chapter_seq: 2,
      chapter_count: 12,
      draft_body_chars: 128,
      assertions: [
        "real_archive_outline_start_planning_clicked",
        "outline_draft_generated_with_e18_e22_direction_labels",
        "outline_draft_adopted_through_author_action_boundary",
        "chapter_plan_direction_materialized_into_chapter_structure",
        "target_chapter_direction_available_before_provider_call",
        "prose_writing_generated_pending_draft_without_adoption",
        "deterministic_provider_form_frame_and_micro_plan_called",
      ],
    });
  });

  it("rejects VS-00C CP4 evidence when plan direction is not materialized", () => {
    const records = vs00cCp4ChapterPlanStructureRecords().map((record) =>
      record.event === "context.structure.done" ? { ...record, has_plan_direction: false } : record,
    );

    expect(findNativeSliceEvidence("vs00c-cp4-chapter-plan-structure", records)).toBeNull();
  });

  it("accepts VS-00C CP5 only when reader effect and self report reach prose writing", () => {
    const records = vs00cCp5ReaderEffectBriefRecords();
    const evidence = findNativeSliceEvidence("vs00c-cp5-reader-effect-brief", records);

    expect(evidence).toMatchObject({
      slice_id: "vs00c-cp5-reader-effect-brief",
      turn_id: "turn-cp4-draft",
      generation_turn_id: "turn-cp4-plan",
      adoption_turn_id: "turn-cp4-adopt",
      draft_turn_id: "turn-cp4-draft",
      has_reader_effect_brief: true,
      reader_effect_risk_note_count: 1,
      self_report_risk_flags_count: 1,
      self_report_quality_action: "warn",
      key_events: keyEventsForSlice("vs00c-cp5-reader-effect-brief"),
    });

    expect(findSliceBehaviorEvidence("vs00c-cp5-reader-effect-brief", records, evidence)).toEqual({
      slice_id: "vs00c-cp5-reader-effect-brief",
      behavior: "reader_effect_brief_and_self_report_reach_prose_writing",
      turn_ids: ["turn-cp4-plan", "turn-cp4-adopt", "turn-cp4-draft"],
      generation_turn_id: "turn-cp4-plan",
      adoption_turn_id: "turn-cp4-adopt",
      draft_turn_id: "turn-cp4-draft",
      outline_artifact_id: "artifact-outline-cp4",
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第02章：试炼",
      chapter_seq: 2,
      chapter_count: 12,
      reader_effect_risk_note_count: 1,
      self_report_risk_flags_count: 1,
      self_report_quality_action: "warn",
      assertions: [
        "real_archive_outline_start_planning_clicked",
        "outline_draft_generated_with_e18_e22_direction_labels",
        "chapter_plan_direction_materialized_into_reader_effect_brief",
        "reader_effect_brief_available_before_provider_call",
        "prose_writing_output_carried_non_authoritative_self_report",
        "self_report_risk_flags_remain_quality_signal_not_adoption_fact",
        "deterministic_provider_form_frame_and_micro_plan_called",
      ],
    });
  });

  it("rejects VS-00C CP5 evidence when self report is absent", () => {
    const records = vs00cCp5ReaderEffectBriefRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, self_report_present: false }
        : record,
    );

    expect(findNativeSliceEvidence("vs00c-cp5-reader-effect-brief", records)).toBeNull();
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

    expect(
      findSliceBehaviorEvidence("au01-ordinary-chat-two-turn-roundtrip", records, evidence),
    ).toBeNull();
  });

  it("rejects real LM Studio behavior when assistant output is fallback text", () => {
    const records = ordinaryTwoTurnRecords();
    const evidence = findNativeSliceEvidence("au01-ordinary-chat-two-turn-roundtrip", records);

    expect(
      findSliceBehaviorEvidence("au01-ordinary-chat-two-turn-roundtrip", records, evidence, {
        provider: "lmstudio",
        llmRecords: [
          lmRecord("turn-a", "form_frame", "抱歉，我现在无法连接到创作引擎。请稍后再试。"),
          lmRecord("turn-b", "form_frame", "继续聊。"),
        ],
      }),
    ).toBeNull();
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

    expect(
      findSliceBehaviorEvidence("vs10-observability-spine", records, evidence, {
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
      }),
    ).toEqual({
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

  return [
    ...records,
    {
      event: "slice_verify.ui_state.done",
      turn_id: "turn-b",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au01-ordinary-chat-two-turn-roundtrip",
      ui_turn_ids: ["turn-a", "turn-b"],
      user_message_count: 2,
      assistant_turn_message_count: 2,
      message_role_order: ["user", "assistant", "user", "assistant"],
      thinking_observed: true,
      thinking_visible_after_reply: false,
      available_action_count: 0,
      card_action_count: 0,
      candidate_panel_count: 0,
      adoption_decision_card_count: 0,
    },
  ];
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

function au10WorkbenchMatrixRecords(options = {}) {
  const ordinaryMicroPlan = options.ordinaryMicroPlan === true;

  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-matrix-layout",
      turn_id: "turn-au10-ordinary",
      ordinary_turn_id: "turn-au10-ordinary",
      candidate_turn_id: "turn-au10-candidate",
      draft_turn_id: "turn-au10-draft",
      adoption_turn_id: "turn-au10-adoption",
      artifact_id: "artifact-au10",
      candidate_ref: "dir-au10",
      viewport_width: 1280,
      viewport_height: 800,
      layout_no_horizontal_overflow: true,
      top_bar_single_row: true,
      input_area_visible: true,
      service_status_visible: true,
      provider_status_visible: true,
      task_status_visible: true,
      ordinary_turn_completed: true,
      trace_why_dialog_open: true,
      trace_why_contains_raw_prompt: false,
      candidate_action_completed: true,
      candidate_selected: true,
      candidate_adopted: true,
      adoption_reading_completed: true,
      word_count_matches_adopted_prose: true,
      matrix_phases: ["ordinary_turn", "candidate_action", "adoption_reading"],
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-au10-ordinary",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      session_id: "session-au10",
      generate_micro_plan: false,
    },
    {
      event: "dialogue_gateway.handle_input.done",
      turn_id: "turn-au10-ordinary",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      session_id: "session-au10",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au10-ordinary",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      session_id: "session-au10",
    },
    ...(ordinaryMicroPlan
      ? [
          {
            event: "planner.form_micro_plan.done",
            turn_id: "turn-au10-ordinary",
            workspace_id: "ws-au10",
            work_id: "work-au10",
          },
        ]
      : []),
    {
      event: "channel.author_action.start",
      turn_id: "turn-au10-candidate",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      session_id: "session-au10",
      action_type: "choose_candidate",
      candidate_ref: "dir-au10",
    },
    {
      event: "adoption.evaluate.done",
      turn_id: "turn-au10-candidate",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      decision_type: "adopt_tentative",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-au10-candidate",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      action_type: "choose_candidate",
      action_status: "accepted",
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-au10-draft",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      session_id: "session-au10",
      generate_micro_plan: true,
    },
    {
      event: "toolbox.execute.done",
      turn_id: "turn-au10-draft",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      tool_name: "prose_writing",
      tool_outcome: "succeeded",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au10-draft",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      session_id: "session-au10",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn-au10-adoption",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      session_id: "session-au10",
      action_type: "accept",
      target_ref: "artifact-au10",
    },
    {
      event: "adoption.evaluate.done",
      turn_id: "turn-au10-adoption",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      decision_type: "adopt_tentative",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-au10-adoption",
      workspace_id: "ws-au10",
      work_id: "work-au10",
      action_type: "accept",
      action_status: "accepted",
    },
    {
      event: "channel.get_toc.done",
      work_id: "work-au10",
      chapter_count: 1,
    },
    {
      event: "channel.get_chapter_content.done",
      work_id: "work-au10",
      content_chars: 42,
    },
  ];
}

function au10WorkbenchRecoveryTaskstateRecords() {
  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-taskstate",
      turn_id: "turn-au10-draft",
      draft_turn_id: "turn-au10-draft",
      adoption_turn_id: "turn-au10-adoption",
      artifact_id: "artifact-au10",
      task_id: "task-export-1",
      task_type: "export_work",
      task_state_phases: ["RUNNING", "CHECKPOINT", "COMPLETED"],
      task_state_count: 3,
      task_status_after_return: "任务完成",
      export_success_visible: true,
      export_path_visible: true,
      real_export_button_clicked: true,
      real_workbench_completed_status_visible: true,
      adoption_reading_completed: true,
    },
    {
      event: "channel.task_state.done",
      task_id: "task-export-1",
      task_type: "export_work",
      phase: "RUNNING",
      status: "RUNNING",
      progress: 10,
    },
    {
      event: "channel.task_state.done",
      task_id: "task-export-1",
      task_type: "export_work",
      phase: "CHECKPOINT",
      status: "PAUSED",
      progress: 50,
    },
    {
      event: "channel.task_state.done",
      task_id: "task-export-1",
      task_type: "export_work",
      phase: "COMPLETED",
      status: "DONE",
      progress: 100,
    },
    {
      event: "channel.export_work.done",
      task_id: "task-export-1",
      work_id: "work-au10",
      chapter_count: 1,
      total_word_count: 1200,
    },
  ];
}

function au10WorkbenchRecoveryDisconnectTimeoutRecords() {
  return [
    {
      event: "provider_gateway.complete.error",
      provider: "lmstudio",
      model: "slice-verify-unreachable-model",
      turn_id: "turn-failure",
      reason_code: "connection_refused",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-failure",
    },
    {
      event: "provider_gateway.complete.done",
      provider: "slice_verify",
      model: "slice_verify",
      turn_id: "turn-recovery",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-recovery",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-disconnect-timeout",
      turn_id: "turn-recovery",
      turn_ids: ["turn-failure", "turn-recovery"],
      failure_turn_id: "turn-failure",
      recovery_turn_id: "turn-recovery",
      failing_provider: "lmstudio",
      failure_status: "conversational",
      recovery_status: "conversational",
      failure_message_visible: true,
      no_production_write_on_failure: true,
      no_artifact_adopted_on_failure: true,
      loading_cleared_after_failure: true,
      input_enabled_after_failure: true,
      following_turn_completed: true,
      can_continue_after_failure: true,
      failure_prompt_sent: true,
      recovery_prompt_sent: true,
    },
  ];
}

function au10WorkbenchRecoveryProviderTimeoutRecords() {
  return [
    {
      event: "provider_gateway.complete.error",
      provider: "lmstudio",
      model: "slice-verify-timeout-model",
      turn_id: "turn-timeout",
      reason_code: "timeout",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-timeout",
    },
    {
      event: "provider_gateway.complete.done",
      provider: "slice_verify",
      model: "slice_verify",
      turn_id: "turn-after-timeout",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-after-timeout",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-provider-timeout",
      turn_id: "turn-after-timeout",
      timeout_turn_id: "turn-timeout",
      recovery_turn_id: "turn-after-timeout",
      timeout_provider: "lmstudio",
      timeout_reason_code: "timeout",
      timeout_message_visible: true,
      no_production_write_on_timeout: true,
      no_artifact_adopted_on_timeout: true,
      loading_cleared_after_timeout: true,
      input_enabled_after_timeout: true,
      recovery_turn_completed: true,
      timeout_prompt_sent: true,
      recovery_prompt_sent: true,
    },
  ];
}

function au10WorkbenchRecoveryReconnectRecords() {
  return [
    {
      event: "channel.join.done",
      work_id: "work-au10",
      session_id: "session-au10",
    },
    {
      event: "channel.join.done",
      work_id: "work-au10",
      session_id: "session-au10",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-after-reconnect",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-reconnect",
      turn_id: "turn-after-reconnect",
      initial_join_count: 1,
      join_count_after_restore: 2,
      offline_status_visible: true,
      input_disabled_while_offline: true,
      loading_cleared_while_offline: true,
      reconnected_status_visible: true,
      input_enabled_after_reconnect: true,
      rejoin_observed: true,
      following_turn_completed: true,
      recovery_prompt_sent: true,
      service_stopped_externally: true,
      service_restarted_externally: true,
    },
  ];
}

function au10WorkbenchRecoveryCancelWaitingRecords() {
  return [
    {
      event: "channel.user_message.done",
      turn_id: "turn-confirm",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn-confirm",
      action_id: "reject:artifact-1",
      action_type: "reject_or_cancel_confirmation",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-confirm",
      action_id: "reject:artifact-1",
      action_type: "reject_or_cancel_confirmation",
      action_status: "cancelled",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-after-cancel",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au10-workbench-recovery-cancel-waiting",
      turn_id: "turn-after-cancel",
      confirmation_turn_id: "turn-confirm",
      cancel_turn_id: "turn-cancelled",
      following_turn_id: "turn-after-cancel",
      action_id: "reject:artifact-1",
      action_type: "reject_or_cancel_confirmation",
      confirmation_card_visible: true,
      cancelled_message_visible: true,
      confirmation_buttons_cleared: true,
      active_behavior_closed: true,
      no_tool_called_before_cancel: true,
      no_production_write_on_cancel: true,
      no_artifact_adopted_on_cancel: true,
      loading_cleared_after_cancel: true,
      input_enabled_after_cancel: true,
      following_turn_completed: true,
      prompt_sent: true,
      recovery_prompt_sent: true,
    },
  ];
}

function au12WorkProfileOverviewRecords() {
  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au12-work-profile-overview",
      work_id: "work-au12",
      work_title: "AU12档案作品",
      profile_status: "TENTATIVE",
      profile_revision: 2,
      profile_fields_visible: true,
      profile_status_visible: true,
      profile_request_sent: true,
      profile_reply_has_title: true,
      profile_reply_omits_id: true,
      profile_reply_omits_work_uuid: true,
      profile_ui_omits_work_uuid: true,
      profile_log_emitted: true,
      profile_log_omits_work_uuid: true,
      readonly_hint_visible: true,
      real_archive_opened: true,
      overview_tab_clicked: true,
    },
    {
      event: "channel.get_work_profile.done",
      has_title: true,
      field_count: 8,
      status: "TENTATIVE",
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

function au02CandidateContinuationRecords(sourceTurnId, followTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au02-candidate-continuation",
      restored_turn_id: sourceTurnId,
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      frame_badge_goal: "帮作者展开赛博修仙方向",
      candidate_panel_count: 1,
    },
    {
      event: "channel.user_message.start",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 27,
      generate_micro_plan: false,
      candidate_source_turn_ref: sourceTurnId,
      candidate_ref: "dir-1",
    },
    {
      event: "dialogue_gateway.handle_input.start",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "planner.form_frame.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "dialogue_gateway.handle_input.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 32,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 33,
      outcome: "ok",
    },
  ];
}

function au02CandidateAdoptionBridgeRecords(sourceTurnId, followTurnId, adoptionTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: adoptionTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au02-candidate-adoption-bridge",
      source_turn_id: sourceTurnId,
      continuation_turn_id: followTurnId,
      adoption_turn_id: adoptionTurnId,
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      candidate_panel_count: 1,
      candidate_continue_clicked: true,
      candidate_adopt_clicked: false,
      visible_adoption_result: true,
      adoption_decision_type: "adopt_tentative",
      candidate_selected: true,
      candidate_adopted: true,
      production_write_performed: false,
    },
    {
      event: "channel.user_message.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 29,
      generate_micro_plan: false,
    },
    {
      event: "dialogue_gateway.handle_input.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "planner.form_frame.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "dialogue_gateway.handle_input.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 31,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 32,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 27,
      generate_micro_plan: false,
      candidate_source_turn_ref: sourceTurnId,
      candidate_ref: "dir-1",
    },
    {
      event: "dialogue_gateway.handle_input.start",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "planner.form_frame.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "dialogue_gateway.handle_input.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 32,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 33,
      outcome: "ok",
    },
    {
      event: "channel.author_action.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
    },
    {
      event: "adoption.evaluate.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 4,
      outcome: "ok",
      decision_type: "adopt_tentative",
      reason_codes: ["candidate_adopted_as_tentative", "provenance_verified"],
    },
    {
      event: "channel.author_action.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 5,
      outcome: "ok",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      action_status: "accepted",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
    },
  ];
}

function au05AdoptionSafetyFreshnessRecords(sourceTurnId, confirmationTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: confirmationTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au05-adoption-safety-freshness",
      source_turn_id: sourceTurnId,
      confirmation_turn_id: confirmationTurnId,
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      candidate_risk_hint: "high",
      candidate_adopt_clicked: true,
      visible_confirmation_result: true,
      action_result_status: "needs_confirmation",
      adoption_decision_type: "require_confirmation",
      adoption_reason_codes: ["high_risk_candidate", "confirmation_required"],
      candidate_selected: true,
      candidate_adopted: false,
      production_write_performed: false,
    },
    {
      event: "channel.user_message.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 31,
      generate_micro_plan: false,
    },
    {
      event: "planner.form_frame.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 32,
      outcome: "ok",
    },
    {
      event: "channel.author_action.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
    },
    {
      event: "adoption.evaluate.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 4,
      outcome: "skipped",
      decision_type: "require_confirmation",
      reason_codes: ["high_risk_candidate", "confirmation_required"],
    },
    {
      event: "channel.author_action.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 5,
      outcome: "ok",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      action_status: "needs_confirmation",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
    },
  ];
}

function au05StaleConflictCrossWorkRecords(sourceTurnId, rejectionTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: rejectionTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au05-stale-conflict-cross-work-freshness",
      source_turn_id: sourceTurnId,
      rejection_turn_id: rejectionTurnId,
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      restored_stale_candidate_visible: true,
      candidate_adopt_clicked: true,
      visible_rejection_result: true,
      action_result_status: "rejected",
      adoption_decision_type: "reject",
      adoption_reason_codes: ["source_turn_stale", "stale_candidate_set"],
      candidate_selected: true,
      candidate_adopted: false,
      production_write_performed: false,
    },
    {
      event: "channel.author_action.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
    },
    {
      event: "adoption.evaluate.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 4,
      outcome: "skipped",
      decision_type: "reject",
      reason_codes: ["source_turn_stale", "stale_candidate_set"],
    },
    {
      event: "channel.author_action.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 5,
      outcome: "ok",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      action_status: "rejected",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
    },
  ];
}

function au05ConflictCrossWorkRecoveryRecords(sourceTurnId, failureTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: failureTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au05-conflict-cross-work-recovery",
      source_turn_id: sourceTurnId,
      failure_turn_id: failureTurnId,
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      cross_work_candidate_visible: true,
      candidate_adopt_clicked: true,
      visible_failure_result: true,
      action_result_status: "failed",
      adoption_decision_type: "fail_with_recovery",
      adoption_reason_codes: ["work_id_mismatch", "cross_work_adoption_rejected"],
      candidate_selected: true,
      candidate_adopted: false,
      production_write_performed: false,
    },
    {
      event: "channel.author_action.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
    },
    {
      event: "adoption.evaluate.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 4,
      outcome: "error",
      decision_type: "fail_with_recovery",
      reason_codes: ["work_id_mismatch", "cross_work_adoption_rejected"],
    },
    {
      event: "channel.author_action.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 5,
      outcome: "ok",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      action_status: "failed",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
    },
  ];
}

function au05CanonConflictRecoveryRecords(sourceTurnId, failureTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: failureTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au05-canon-conflict-recovery",
      source_turn_id: sourceTurnId,
      failure_turn_id: failureTurnId,
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      canon_conflict_candidate_visible: true,
      candidate_adopt_clicked: true,
      visible_failure_result: true,
      action_result_status: "failed",
      adoption_decision_type: "fail_with_recovery",
      adoption_reason_codes: ["canon_conflict_detected", "conflict_recovery_required"],
      candidate_selected: true,
      candidate_adopted: false,
      production_write_performed: false,
    },
    {
      event: "channel.author_action.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
    },
    {
      event: "adoption.evaluate.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 4,
      outcome: "error",
      decision_type: "fail_with_recovery",
      reason_codes: ["canon_conflict_detected", "conflict_recovery_required"],
    },
    {
      event: "channel.author_action.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 5,
      outcome: "ok",
      action_type: "choose_candidate",
      action_id: "choose_candidate:dir-1",
      action_status: "failed",
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
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

function p1ChapterDraftGenerationRecords(turnId) {
  return [
    {
      event: "work_session.resume.done",
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 4,
      outcome: "ok",
      transcript_count: 0,
      pending_adoption_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 0,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: turnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 0,
      outcome: "start",
      text_len: 43,
      message_preview: "请根据已采纳章节计划生成第01章：底层灵气账单正文草稿",
      generate_micro_plan: true,
    },
    {
      event: "context.assemble.done",
      turn_id: turnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 3,
      outcome: "ok",
      has_memory: true,
      context_refs_count: 1,
    },
    {
      event: "planner.form_frame.done",
      turn_id: turnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 11,
      outcome: "ok",
    },
    {
      event: "planner.form_micro_plan.done",
      turn_id: turnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 9,
      outcome: "ok",
    },
    {
      event: "toolbox.execute.done",
      turn_id: turnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 7,
      outcome: "ok",
      tool_name: "prose_writing",
      tool_outcome: "succeeded",
    },
    {
      event: "channel.user_message.done",
      turn_id: turnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 28,
      outcome: "ok",
    },
    {
      event: "channel.get_toc.done",
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 5,
      outcome: "ok",
      volume_count: 1,
      chapter_count: 12,
      total_word_count: 0,
    },
    {
      event: "slice_verify.ui_state.done",
      turn_id: turnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "p1-chapter-draft-generation",
      draft_turn_id: turnId,
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      draft_generated: true,
      draft_pending: true,
      draft_body_chars: 128,
      draft_card_visible: true,
      reading_plan_visible_before_adoption: true,
      unadopted_draft_visible_in_reading: false,
      adopt_event_sent: false,
      user_message_text: "请根据已采纳章节计划生成第01章：底层灵气账单正文草稿",
    },
  ];
}

function p1ChapterExpansionRecords(turnId, visibleText) {
  return [
    {
      event: "channel.user_message.start",
      turn_id: turnId,
      work_id: "work-p1",
      session_id: "session-p1",
    },
    ...[turnId, "turn-p1-cont-1", "turn-p1-cont-2"].flatMap((toolTurnId) => [
      {
        event: "toolbox.execute.done",
        turn_id: toolTurnId,
        work_id: "work-p1",
        tool_name: "prose_writing",
        tool_outcome: "succeeded",
      },
      {
        event: "channel.author_action.done",
        turn_id: `adopt-${toolTurnId}`,
        work_id: "work-p1",
        action_type: "accept",
        action_status: "accepted",
      },
    ]),
    {
      event: "turn_execution.continuation_context.done",
      turn_id: "turn-p1-cont-1",
      work_id: "work-p1",
      authoring_intent: "continuation",
      prior_prose_chars: 180,
    },
    {
      event: "turn_execution.continuation_context.done",
      turn_id: "turn-p1-cont-2",
      work_id: "work-p1",
      authoring_intent: "continuation",
      prior_prose_chars: 760,
    },
    {
      event: "channel.get_toc.done",
      work_id: "work-p1",
      chapter_count: 12,
      empty_chapter_count: 11,
      short_chapter_count: 0,
    },
    {
      event: "channel.get_chapter_content.done",
      work_id: "work-p1",
      content_chars: 1300,
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "p1-chapter-expansion",
      turn_id: turnId,
      work_id: "work-p1",
      draft_turn_id: turnId,
      chapter_title: "第01章：底层灵气账单",
      continuations_all_recognized: true,
      appended_to_single_chapter: true,
      accumulated_past_min: true,
      short_to_ok_transition: true,
      first_draft_chapter_words: 168,
      final_chapter_word_count: 1302,
      continuation_count: 2,
      continuation_intents: ["continuation", "continuation"],
      long_session_visible_text: visibleText,
    },
  ];
}

function vs00cCp3StructuredContextRecords(turnId) {
  const targetChapterTitle = "第02章：旧服务器里的残诀";
  const userMessageText = `请根据已采纳章节计划生成${targetChapterTitle}正文草稿`;

  const records = p1ChapterDraftGenerationRecords(turnId).map((record) => {
    if (record.event === "channel.user_message.start") {
      return {
        ...record,
        text_len: userMessageText.length,
        message_preview: userMessageText,
      };
    }

    if (record.event === "slice_verify.ui_state.done") {
      return {
        ...record,
        slice_id: "vs00c-cp3-structured-context",
        chapter_title: targetChapterTitle,
        previous_chapter_title: "第01章：底层灵气账单",
        next_chapter_title: "第03章",
        requested_second_chapter: true,
        user_message_text: userMessageText,
      };
    }

    return record;
  });

  const contextIndex = records.findIndex((record) => record.event === "context.assemble.done");
  const structureRecord = {
    event: "context.structure.done",
    turn_id: turnId,
    workspace_id: "work-p1",
    work_id: "work-p1",
    session_id: "session-p1",
    duration_ms: 1,
    outcome: "ok",
    source_type: "structure",
    target_chapter: targetChapterTitle,
    chapter_seq: 2,
    has_plan_summary: true,
    has_previous: true,
    has_next: true,
    assembly_policy_id: "slice_verify",
  };

  if (contextIndex < 0) return [...records, structureRecord];

  return [
    ...records.slice(0, contextIndex + 1),
    structureRecord,
    ...records.slice(contextIndex + 1),
  ];
}

function vs00cCp4ChapterPlanStructureRecords() {
  const planTurnId = "turn-cp4-plan";
  const adoptTurnId = "turn-cp4-adopt";
  const draftTurnId = "turn-cp4-draft";
  const targetChapterTitle = "第02章：试炼";
  const userMessageText = `请根据已采纳章节计划生成${targetChapterTitle}正文草稿`;

  const planningRecords = [
    {
      event: "work_session.resume.done",
      turn_id: planTurnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
    },
    {
      event: "channel.join.done",
      turn_id: planTurnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
    },
    {
      event: "channel.user_message.start",
      turn_id: planTurnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      generate_micro_plan: true,
      message_preview: "请为当前作品生成章节大纲",
    },
    {
      event: "planner.form_frame.done",
      turn_id: planTurnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
    },
    {
      event: "planner.form_micro_plan.done",
      turn_id: planTurnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
    },
    {
      event: "toolbox.execute.done",
      turn_id: planTurnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      tool_name: "plot_outline",
      tool_outcome: "succeeded",
    },
    {
      event: "channel.user_message.done",
      turn_id: planTurnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
    },
    {
      event: "channel.author_action.done",
      turn_id: planTurnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      action_type: "accept",
      action_status: "accepted",
    },
    {
      event: "turn_result",
      turn_id: adoptTurnId,
      workspace_id: "work-p1",
      work_id: "work-p1",
      session_id: "session-p1",
      truthfulness: { artifact_adopted: true },
      adoption_state: { resolved: [{ artifact_id: "artifact-outline-cp4" }] },
    },
  ];

  const draftRecords = vs00cCp3StructuredContextRecords(draftTurnId).map((record) => {
    if (record.event === "channel.user_message.start") {
      return {
        ...record,
        message_preview: userMessageText,
      };
    }

    if (record.event === "context.structure.done") {
      return {
        ...record,
        target_chapter: targetChapterTitle,
        chapter_seq: 2,
        has_plan_direction: true,
      };
    }

    if (record.event === "slice_verify.ui_state.done") {
      return {
        ...record,
        slice_id: "vs00c-cp4-chapter-plan-structure",
        generation_turn_id: planTurnId,
        adoption_turn_id: adoptTurnId,
        draft_turn_id: draftTurnId,
        outline_artifact_id: "artifact-outline-cp4",
        outline_direction_labels_present: true,
        outline_adopt_clicked: true,
        outline_adopted: true,
        reading_projection_materialized: false,
        chapter_count: 12,
        chapter_title: targetChapterTitle,
        chapter_seq: 2,
        has_plan_summary: true,
        has_plan_direction: true,
        draft_generated: true,
        draft_pending: true,
        draft_body_chars: 128,
        draft_card_visible: true,
        user_message_text: userMessageText,
      };
    }

    return record;
  });

  return [...planningRecords, ...draftRecords];
}

function vs00cCp5ReaderEffectBriefRecords() {
  const draftTurnId = "turn-cp4-draft";
  const targetChapterTitle = "第02章：试炼";
  const readerEffectRecord = {
    event: "context.reader_effect.done",
    turn_id: draftTurnId,
    workspace_id: "work-p1",
    work_id: "work-p1",
    session_id: "session-p1",
    duration_ms: 1,
    outcome: "ok",
    source_type: "reader_effect",
    target_chapter: targetChapterTitle,
    has_reader_effect_brief: true,
    intended_emotion_present: true,
    hook_target_present: true,
    payoff_or_promise_present: true,
    suspense_boundary_present: true,
    risk_note_count: 1,
    assembly_policy_id: "slice_verify",
  };

  return vs00cCp4ChapterPlanStructureRecords().flatMap((record) => {
    if (record.event === "context.structure.done") {
      return [{ ...record, has_reader_effect_brief: true }, readerEffectRecord];
    }

    if (record.event === "slice_verify.ui_state.done") {
      return [
        {
          ...record,
          slice_id: "vs00c-cp5-reader-effect-brief",
          has_reader_effect_brief: true,
          reader_effect_fields_present: true,
          reader_effect_risk_note_count: 1,
          self_report_present: true,
          self_report_intended_reader_effect_present: true,
          self_report_used_context_refs: ["target_structure", "reader_effect_brief"],
          self_report_risk_flags_count: 1,
          self_report_quality_action: "warn",
        },
      ];
    }

    return [record];
  });
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
