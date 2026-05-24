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
    expect(nativeSliceIds).toContain("au03-branch-from-history");
    expect(nativeSliceIds).toContain("au03-archive-session-filter");
    expect(nativeSliceIds).toContain("au03-current-work-context-ssot");
    expect(nativeSliceIds).toContain("au03-long-session-compression");
    expect(nativeSliceIds).toContain("au03-context-source-ui");
    expect(nativeSliceIds).toContain("au10-micro-plan-entry");
    expect(nativeSliceIds).toContain("au10-ordinary-chat-no-micro-plan");
    expect(nativeSliceIds).toContain("au01-ordinary-chat-two-turn-roundtrip");
    expect(nativeSliceIds).toContain("au02-candidate-continuation");
    expect(nativeSliceIds).toContain("au02-candidate-adoption-bridge");
    expect(nativeSliceIds).toContain("au05-adoption-safety-freshness");
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
      turn_ids: ["turn-source", "turn-follow", "turn-adoption"],
      source_turn_ref: "turn-source",
      continuation_turn_id: "turn-follow",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      key_events: keyEventsForSlice("au02-candidate-adoption-bridge"),
    });
    expect(findSliceBehaviorEvidence("au02-candidate-adoption-bridge", records, evidence)).toEqual({
      slice_id: "au02-candidate-adoption-bridge",
      behavior: "candidate_selection_then_authorized_adoption_boundary",
      turn_ids: ["turn-source", "turn-follow", "turn-adoption"],
      source_turn_ref: "turn-source",
      continuation_turn_id: "turn-follow",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      assertions: [
        "candidate_panel_rendered_from_turn_result",
        "candidate_continuation_sent_candidate_selection_without_adoption",
        "candidate_adoption_sent_authorized_choose_candidate_action",
        "adoption_boundary_returned_adopt_tentative",
        "ui_rendered_candidate_adoption_result",
        "production_write_not_claimed",
        "no_legacy_artifact_adopt_endpoint_used",
        "deterministic_provider_form_frame_called_for_source_candidate_turn",
      ],
    });
  });

  it("accepts AU-05 adoption safety only when high-risk candidate requires confirmation", () => {
    const records = au05AdoptionSafetyFreshnessRecords(
      "turn-source",
      "turn-confirmation",
    );

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
      { event: "work_session.resume.done", work_id: "work-au03", session_id: "session-active", transcript_count: 1 },
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
      { event: "work_session.resume.done", work_id: "work-au03", session_id: "session-branch", transcript_count: 0 },
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
      { event: "work_session.resume.done", work_id: "work-au03", session_id: "session-active", transcript_count: 1 },
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
      { event: "work_session.resume.done", work_id: "work-au03", session_id: "session-active", transcript_count: 2 },
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
          body:
            '{"choices":[{"message":{"content":"{\\"assistant_message\\":\\"他在追查妹妹林瑶与灵源矿区真相。\\"}"}}]}',
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
    expect(findSliceBehaviorEvidence("au03-current-work-context-ssot", records, evidence, {
      provider: "lmstudio",
      llmRecords,
    })).toEqual({
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
      { event: "work_session.resume.done", work_id: "work-long", session_id: "session-long", transcript_count: 12 },
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
          body:
            '{"choices":[{"message":{"content":"{\\"assistant_message\\":\\"我会沿用最近设定继续整理。\\"}"}}]}',
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
    expect(findSliceBehaviorEvidence("au03-long-session-compression", records, evidence, {
      provider: "lmstudio",
      llmRecords,
    })).toEqual({
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
          "自然回复 参考来源 当前作品背景 灵源纪元 / 东方奇幻 / 林烬追查灵源矿区真相 近期对话 上一轮围绕「林烬进入灵源矿区」展开，AI 已给出回应。 已确认设定 林瑶失踪指向灵源矿区，林烬去矿区追查线索。 解释来自本轮已保存的 trace 摘要，不会重新调用模型或改写作品。",
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
        "recent_dialogue_source_summary_visible",
        "confirmed_memory_source_summary_visible",
        "raw_prompt_provider_debug_not_visible",
        "planner_received_context_before_frame",
        "no_error_events",
        "assistant_messages_not_fallback",
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

    expect(findSliceBehaviorEvidence("au01-ordinary-chat-two-turn-roundtrip", records, evidence, {
      provider: "slice_verify",
    })?.assertions).toContain("deterministic_provider_form_frame_called_per_turn");
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
      candidate_adopt_clicked: true,
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
