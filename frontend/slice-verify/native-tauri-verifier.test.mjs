import { describe, expect, it } from "vitest";

import {
  findLiveProviderEvidence,
  findLmStudioEvidence,
  findNativeSliceEvidence,
  findSliceBehaviorEvidence,
  keyEventsForSlice,
  nativeSliceIds,
} from "./native-tauri-verifier.mjs";

describe("native Tauri slice verifier", () => {
  it("lists native slice ids including AU-04 confirmation idempotency UI", () => {
    expect(nativeSliceIds).toContain("workspace-runtime-state");
    expect(nativeSliceIds).toContain("su02-work-switching");
    expect(nativeSliceIds).toContain("su02-artifact-projection-trace-isolation");
    expect(nativeSliceIds).toContain("su02-empty-start-unnamed-work");
    expect(nativeSliceIds).toContain("su01-provider-health-model");
    expect(nativeSliceIds).toContain("su01-api-key-secret-redaction");
    expect(nativeSliceIds).toContain("su01-local-secret-file-roundtrip");
    expect(nativeSliceIds).toContain("su01-provider-model-list-success");
    expect(nativeSliceIds).toContain("su01-provider-test-failure-ui");
    expect(nativeSliceIds).toContain("su01-model-provider-switching");
    expect(nativeSliceIds).toContain("su03-assistant-display-name");
    expect(nativeSliceIds).toContain("agent-awaiting-author-steer-resume");
    expect(nativeSliceIds).toContain("agent-awaiting-author-input-required");
    expect(nativeSliceIds).toContain("agent-bounded-refresh-live-resume");
    expect(nativeSliceIds).toContain("agent-dead-bounded-run-expiry");
    expect(nativeSliceIds).toContain("stage-startup-context-contract");
    expect(nativeSliceIds).toContain("au03c-work-session-resume");
    expect(nativeSliceIds).toContain("au05-adoption-boundary");
    expect(nativeSliceIds).toContain("au05-adoption-followup-routing");
    expect(nativeSliceIds).toContain("au05-discard-boundary");
    expect(nativeSliceIds).toContain("au05-modify-draft-boundary");
    expect(nativeSliceIds).toContain("au05-discard-author-action");
    expect(nativeSliceIds).toContain("au08-adoption-reading-projection");
    expect(nativeSliceIds).toContain("au09-archive-real-data");
    expect(nativeSliceIds).toContain("au09-archive-stats-current");
    expect(nativeSliceIds).toContain("au09-memory-recall-context");
    expect(nativeSliceIds).toContain("au09-character-dossier-roundtrip");
    expect(nativeSliceIds).toContain("au09-memory-management-entry");
    expect(nativeSliceIds).toContain("au09-memory-management-filter-matrix");
    expect(nativeSliceIds).toContain("au09-memory-trace-roundtrip");
    expect(nativeSliceIds).toContain("au09-cross-work-memory-isolation");
    expect(nativeSliceIds).toContain("au09-au03-session-memory-layering");
    expect(nativeSliceIds).toContain("au03-session-history-readonly");
    expect(nativeSliceIds).toContain("au03-session-new-active");
    expect(nativeSliceIds).toContain("au03-branch-from-history");
    expect(nativeSliceIds).toContain("au03-archive-session-filter");
    expect(nativeSliceIds).toContain("au03-current-work-context-ssot");
    expect(nativeSliceIds).toContain("au03-long-session-compression");
    expect(nativeSliceIds).toContain("au03-context-source-ui");
    expect(nativeSliceIds).toContain("au07-trace-why-entry");
    expect(nativeSliceIds).toContain("au07-gate-reason-why");
    expect(nativeSliceIds).toContain("au07-persisted-trace-query");
    expect(nativeSliceIds).toContain("au07-partial-replay-ui");
    expect(nativeSliceIds).toContain("au07-trace-query-scope-negative-matrix");
    expect(nativeSliceIds).toContain("au07-tooltrace-registry-redacted-io");
    expect(nativeSliceIds).toContain("au07-state-trace-adoption-replay");
    expect(nativeSliceIds).toContain("au07-behavior-trace-terminal-replay");
    expect(nativeSliceIds).toContain("au11-quality-diagnosis-message-envelope");
    expect(nativeSliceIds).toContain("au11-missing-workstate-policy");
    expect(nativeSliceIds).toContain("au12-profile-read-failure-degrade");
    expect(nativeSliceIds).toContain("au10-workbench-matrix-layout");
    expect(nativeSliceIds).toContain("au10-workbench-recovery-disconnect-timeout");
    expect(nativeSliceIds).toContain("au10-workbench-recovery-provider-timeout");
    expect(nativeSliceIds).toContain("au10-workbench-recovery-reconnect");
    expect(nativeSliceIds).toContain("au10-workbench-recovery-cancel-waiting");
    expect(nativeSliceIds).toContain("au10-micro-plan-entry");
    expect(nativeSliceIds).toContain("au10-ordinary-chat-no-micro-plan");
    expect(nativeSliceIds).toContain("e2e-01-readonly-tool-trace");
    expect(nativeSliceIds).toContain("e2e-01-replay-report");
    expect(nativeSliceIds).toContain("e2e-01-channel-action-security");
    expect(nativeSliceIds).toContain("au01-ordinary-chat-two-turn-roundtrip");
    expect(nativeSliceIds).toContain("gap-wt04-non-exploration-frame-badges");
    expect(nativeSliceIds).toContain("au01-empty-message-guard");
    expect(nativeSliceIds).toContain("au01-garbage-json-recovery");
    expect(nativeSliceIds).toContain("au01-frame-validation-friendly-error");
    expect(nativeSliceIds).toContain("au01-turnresult-recorder-ui-consistency");
    expect(nativeSliceIds).toContain("au02-natural-exploration-no-slot-form");
    expect(nativeSliceIds).toContain("au02-candidate-fallback-ui");
    expect(nativeSliceIds).toContain("au02-candidate-continuation");
    expect(nativeSliceIds).toContain("au02-candidate-multiturn-context");
    expect(nativeSliceIds).toContain("au02-freeform-followup-after-candidate");
    expect(nativeSliceIds).toContain("au02-unadopted-candidate-no-reading-fact");
    expect(nativeSliceIds).toContain("au02-candidate-adoption-bridge");
    expect(nativeSliceIds).toContain("au05-adoption-safety-freshness");
    expect(nativeSliceIds).toContain("au05-stale-conflict-cross-work-freshness");
    expect(nativeSliceIds).toContain("au05-conflict-cross-work-recovery");
    expect(nativeSliceIds).toContain("au05-canon-conflict-recovery");
    expect(nativeSliceIds).toContain("p1-chapter-plan-minimum");
    expect(nativeSliceIds).toContain("p1-chapter-draft-generation");
    expect(nativeSliceIds).toContain("agentic-loop-plan-replan-reasoning");
    expect(nativeSliceIds).toContain("agentic-loop-no-deviation-direct");
    expect(nativeSliceIds).toContain("agent-plan-native-tool-calling-protocol");
    expect(nativeSliceIds).toContain("agentic-loop-budget-deviation-replan");
    expect(nativeSliceIds).toContain("agentic-loop-tool-failure-replan");
    expect(nativeSliceIds).toContain("agentic-loop-quality-deviation-replan");
    expect(nativeSliceIds).toContain("agentic-loop-gate-deviation-replan");
    expect(nativeSliceIds).toContain("agentic-loop-deterministic-gap-replan");
    expect(nativeSliceIds).toContain("agent-world-building-with-context");
    expect(nativeSliceIds).toContain("agent-world-building-style-rule-with-context");
    expect(nativeSliceIds).toContain("au08-reading-readonly-no-write");
    expect(nativeSliceIds).toContain("au08-reading-return-context");
    expect(nativeSliceIds).toContain("au04-confirm-before-execute");
    expect(nativeSliceIds).toContain("au04-confirmation-tool-failure-recovery");
    expect(nativeSliceIds).toContain("au04-confirm-idempotency-ui");
    expect(nativeSliceIds).toContain("au04-stale-confirmation-ui");
    expect(nativeSliceIds).toContain("au04-confirmation-ttl-ui");
    expect(nativeSliceIds).toContain("au04-disabled-confirmation-action-ui");
    expect(nativeSliceIds).toContain("au04-history-confirmation-readonly");
    expect(nativeSliceIds).toContain("au04-cross-work-confirmation-guard");
    expect(nativeSliceIds).toContain("au04-latest-context-rebase-confirmation");
    expect(nativeSliceIds).toContain("au14-fact-inventory-roundtrip");
    expect(nativeSliceIds).toContain("au14-finding-inventory-arc-loop");
    expect(nativeSliceIds).toContain("au14-assumption-confirm-roundtrip");
    expect(nativeSliceIds).toContain("au14-assumption-provisional-injection");
    expect(nativeSliceIds).toContain("vs00c-cp3-structured-context");
    expect(nativeSliceIds).toContain("vs00c-cp4-chapter-plan-structure");
    expect(nativeSliceIds).toContain("vs00c-cp5-reader-effect-brief");
    expect(nativeSliceIds).toContain("vs10-observability-spine");
  });

  it("requires selective adoption evidence for AU-14 fact inventory", () => {
    const records = [
      {
        event: "channel.author_action.done",
        action_type: "start_fact_inventory",
        run_id: "run-au14",
      },
      {
        event: "adoption.evaluate.done",
        decision_type: "adopt_tentative",
        outcome: "ok",
      },
      {
        event: "adoption.evaluate.done",
        decision_type: "adopt_tentative",
        outcome: "ok",
      },
      {
        event: "channel.get_characters.done",
        character_count: 1,
      },
      {
        event: "channel.get_rules.done",
        rule_count: 1,
      },
      {
        event: "channel.get_foreshadowing.done",
        item_count: 0,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au14-fact-inventory-roundtrip",
        profile_ref: "fact_inventory_v1",
        run_id: "run-au14",
        inventory_turn_id: "turn-inventory",
        character_adoption_turn_id: "turn-character",
        rule_adoption_turn_id: "turn-rule",
        skeleton_adoption_turn_id: "turn-skeleton",
        pending_count: 6,
        pending_character_count: 2,
        pending_rule_count: 1,
        pending_foreshadow_count: 1,
        pending_skeleton_count: 2,
        available_action_count: 18,
        skeleton_field: "target_length",
        skeleton_value: 300000,
        skeleton_candidate_accept_label: "采纳方案 A 为全书规划",
        duplicate_confirm_message:
          "作品档案里已经有名为「沈砚」的已确认角色。同名可能是同一个人、别名或改名，也可能确实是两个同名角色——这需要你判断。确认后会新增一条角色档案；当前未写入作品事实。",
        duplicate_rows_before_confirm: 1,
        duplicate_rows_after_confirm: 2,
        duplicate_write_blocked_before_confirm: true,
        duplicate_needs_confirmation_logged: true,
        work_planning_value_absent_before_adoption: true,
        work_planning_visible_after_adoption: true,
        assumption_candidate_produced: true,
        assumption_notice_visible: true,
        assumption_count_logged: 1,
        assumption_section_visible: true,
        assumption_consumed_by_adoption: true,
        proposed_without_write: true,
        adopted_character_id: "as-character::shen",
        adopted_rule_id: "as-rule",
        adopted_skeleton_id: "as-skeleton",
        unadopted_foreshadow_id: "as-foreshadow",
        unadopted_items_remain_pending: true,
        consumed_steps: 1,
        consumed_tool_calls: 1,
        consumed_provider_calls: 3,
        archive_character_count: 1,
        archive_rule_count: 1,
        archive_foreshadowing_count: 0,
        archive_character_visible: true,
        archive_rule_visible: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au14-fact-inventory-roundtrip", records);
    expect(evidence).toEqual({
      slice_id: "au14-fact-inventory-roundtrip",
      turn_id: "turn-inventory",
      turn_ids: ["turn-inventory", "turn-character", "turn-rule"],
      run_id: "run-au14",
      profile_ref: "fact_inventory_v1",
      adopted_character_id: "as-character::shen",
      adopted_rule_id: "as-rule",
      unadopted_foreshadow_id: "as-foreshadow",
      key_events: keyEventsForSlice("au14-fact-inventory-roundtrip"),
    });
    expect(findSliceBehaviorEvidence("au14-fact-inventory-roundtrip", records, evidence)).toEqual({
      slice_id: "au14-fact-inventory-roundtrip",
      behavior: "archive_action_runs_fact_inventory_then_adopts_only_selected_existing_seed_items",
      run_id: "run-au14",
      profile_ref: "fact_inventory_v1",
      assertions: [
        "real_archive_action_started_fact_inventory_agent_run",
        "accepted_material_produced_existing_character_rule_foreshadow_seed_families",
        "proposal_included_work_skeleton_suggestion_for_missing_planning_field",
        "proposal_created_six_independent_pending_units_without_write",
        "inventory_materialized_provisional_assumption_with_visible_notice_and_section",
        "author_adopted_one_character_one_rule_and_planning_suggestion_through_existing_boundary",
        "skeleton_candidate_labeled_as_work_plan",
        "planning_adoption_wrote_back_work_target_length_visible_in_profile",
        "same_name_adoption_consumed_assumption_in_place",
        "duplicate_character_required_author_adjudication",
        "unadopted_character_and_foreshadowing_remained_pending",
        "archive_projections_contained_only_adopted_items",
      ],
    });

    const leakedForeshadowRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, archive_foreshadowing_count: 1 }
        : record,
    );
    expect(
      findNativeSliceEvidence("au14-fact-inventory-roundtrip", leakedForeshadowRecords),
    ).toBeNull();

    // 负例①：候选组采纳按钮退回通用的「保存方案 X 到作品档案」——规划建议写的是
    // works 立项字段而非档案对象，文案语义错误必须判失败。
    const archiveWordedSkeletonRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, skeleton_candidate_accept_label: "保存方案 A 到作品档案" }
        : record,
    );
    expect(
      findNativeSliceEvidence("au14-fact-inventory-roundtrip", archiveWordedSkeletonRecords),
    ).toBeNull();
    expect(
      findSliceBehaviorEvidence(
        "au14-fact-inventory-roundtrip",
        archiveWordedSkeletonRecords,
        evidence,
      ),
    ).toBeNull();

    // 负例②：确认前档案里已经出现第二行同名角色——说明同名采纳没被拦住。
    const unblockedDuplicateRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, duplicate_rows_before_confirm: 2 }
        : record,
    );
    expect(
      findNativeSliceEvidence("au14-fact-inventory-roundtrip", unblockedDuplicateRecords),
    ).toBeNull();
    expect(
      findSliceBehaviorEvidence(
        "au14-fact-inventory-roundtrip",
        unblockedDuplicateRecords,
        evidence,
      ),
    ).toBeNull();

    // 负例③：确认卡不说明理由（只说撞名不给裁决材料）——作者无法判断。
    const uninformativeConfirmRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, duplicate_confirm_message: "这段草稿需要你进一步确认后才能采纳。" }
        : record,
    );
    expect(
      findNativeSliceEvidence("au14-fact-inventory-roundtrip", uninformativeConfirmRecords),
    ).toBeNull();
  });

  it("requires the review roundtrip to report the premature-finale design debt with progress and chapter", () => {
    const sliceId = "au13-review-adjudication-roundtrip";
    const uiState = {
      event: "slice_verify.ui_state.done",
      slice_id: sliceId,
      design_turn_id: "turn-design",
      prose_turn_id: "turn-prose",
      review_report_id: "report-au13-b1",
      review_finding_count: 5,
      adjudicated_count: 5,
      dispositions: ["accept_drift", "dismiss", "revise_design", "revise_prose"],
      dismiss_evidence_logged: true,
      design_intent_text: "审读报告发现「韩晟 自第1章后未再出场（停滞阈值超限）」，我选择修订设定：…",
      prose_intent_text: "审读报告发现「白露 自第1章后未再出场（停滞阈值超限）」，我选择修订正文：…",
      report_fully_dispositioned: true,
      premature_finale_visible: true,
      premature_finale_chapter_seq: 4,
      premature_finale_progress_percent: 1,
      premature_finale_signal:
        "全书进度约 1%，但近期章计划已出现终局/收官定位（第 4 章）——距目标体量尚远，建议调整规划；如确要收束请明示确认。 证据：chapter_plan:4",
      premature_finale_intent_text:
        "审读报告发现「全书进度约 1%，但近期章计划已出现终局/收官定位（第 4 章）——距目标体量尚远…」，我选择修订设定：…",
      premature_finale_turn_id: "turn-finale",
      review_rules: { arc_stalled: 4, premature_finale: 1 },
    };
    const records = [
      {
        event: "ledger.report.done",
        report_id: "report-au13-b1",
        finding_count: 5,
        rules: { arc_stalled: 4, premature_finale: 1 },
      },
      { event: "ledger.adjudicate.done", disposition: "accept_drift" },
      { event: "ledger.adjudicate.done", disposition: "dismiss" },
      { event: "ledger.dismiss.done", rule: "arc_stalled" },
      { event: "ledger.adjudicate.done", disposition: "revise_design" },
      { event: "ledger.adjudicate.done", disposition: "revise_prose" },
      { event: "ledger.adjudicate.done", disposition: "revise_design", rule: "premature_finale" },
      uiState,
    ];

    const evidence = findNativeSliceEvidence(sliceId, records);
    expect(evidence).toEqual({
      slice_id: sliceId,
      turn_id: "turn-design",
      turn_ids: ["turn-design", "turn-prose", "turn-finale"],
      review_report_id: "report-au13-b1",
      review_finding_count: 5,
      adjudicated_count: 5,
      dispositions: ["accept_drift", "dismiss", "revise_design", "revise_prose"],
      premature_finale_chapter_seq: 4,
      premature_finale_progress_percent: 1,
      review_rules: { arc_stalled: 4, premature_finale: 1 },
      key_events: keyEventsForSlice(sliceId),
    });
    expect(findSliceBehaviorEvidence(sliceId, records, evidence)).toEqual({
      slice_id: sliceId,
      adjudication_roundtrip: true,
      dispositions: ["accept_drift", "dismiss", "revise_design", "revise_prose"],
      dismiss_evidence: true,
      correction_intents_via_user_message: true,
      premature_finale_reported_with_progress_and_chapter: true,
      premature_finale_chapter_seq: 4,
      premature_finale_progress_percent: 1,
    });

    const withoutFinaleOnPage = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, premature_finale_visible: false }
        : record,
    );
    expect(findNativeSliceEvidence(sliceId, withoutFinaleOnPage)).toBeNull();

    const withoutFinaleRule = records.map((record) => {
      if (record.event === "ledger.report.done") {
        return { ...record, finding_count: 4, rules: { arc_stalled: 4 } };
      }
      if (record.event === "slice_verify.ui_state.done") {
        return { ...record, review_rules: { arc_stalled: 4 } };
      }
      return record;
    });
    expect(findNativeSliceEvidence(sliceId, withoutFinaleRule)).toBeNull();
  });

  it("requires a bound protagonist finding, protagonist adoption, and next-prose arc update", () => {
    const records = [
      {
        event: "ledger.report.done",
        report_id: "report-au14-a1",
        finding_count: 1,
        rules: { protagonist_undermaterialized: 1 },
      },
      {
        event: "ledger.adjudicate.done",
        report_id: "report-au14-a1",
        rule: "protagonist_undermaterialized",
        disposition: "revise_design",
        report_status: "ACCEPTED",
      },
      {
        event: "channel.author_action.done",
        action_type: "start_fact_inventory",
        run_id: "run-au14-a1",
        trigger_type: "finding",
        trigger_report_id: "report-au14-a1",
        trigger_finding_index: 0,
        trigger_rule: "protagonist_undermaterialized",
      },
      {
        event: "adoption.evaluate.done",
        decision_type: "adopt_tentative",
        outcome: "ok",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-prose",
      },
      {
        event: "adoption.evaluate.done",
        decision_type: "adopt_tentative",
        outcome: "ok",
      },
      {
        event: "ledger.update.done",
        ledger: "arc",
        sighted: 1,
        roster: 1,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au14-finding-inventory-arc-loop",
        review_report_id: "report-au14-a1",
        review_finding_count: 1,
        finding_rule: "protagonist_undermaterialized",
        finding_action_label: "发起盘点",
        finding_binding_sent: true,
        finding_binding_logged: true,
        finding_disposition_recorded: true,
        report_resolved: true,
        run_id: "run-au14-a1",
        profile_ref: "fact_inventory_v1",
        inventory_turn_id: "turn-inventory",
        protagonist_adoption_turn_id: "turn-character",
        prose_turn_id: "turn-prose",
        prose_adoption_turn_id: "turn-prose-adopt",
        protagonist_artifact_id: "as-character::shenyan",
        protagonist_role: "PROTAGONIST",
        protagonist_visible_as_role: true,
        inventory_proposed_without_write: true,
        next_prose_contains_protagonist: true,
        arc_ledger_sighted: 1,
        arc_ledger_visible: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au14-finding-inventory-arc-loop", records);
    expect(evidence).toEqual({
      slice_id: "au14-finding-inventory-arc-loop",
      turn_id: "turn-prose-adopt",
      turn_ids: ["turn-inventory", "turn-character", "turn-prose", "turn-prose-adopt"],
      run_id: "run-au14-a1",
      profile_ref: "fact_inventory_v1",
      review_report_id: "report-au14-a1",
      protagonist_artifact_id: "as-character::shenyan",
      key_events: keyEventsForSlice("au14-finding-inventory-arc-loop"),
    });
    expect(findSliceBehaviorEvidence("au14-finding-inventory-arc-loop", records, evidence)).toEqual(
      {
        slice_id: "au14-finding-inventory-arc-loop",
        behavior:
          "protagonist_debt_finding_starts_bound_inventory_then_next_prose_adoption_starts_arc_ledger",
        run_id: "run-au14-a1",
        profile_ref: "fact_inventory_v1",
        assertions: [
          "real_full_review_materialized_protagonist_undermaterialized_finding",
          "finding_primary_action_bound_report_index_and_rule_to_fact_inventory",
          "existing_revise_design_disposition_resolved_the_report",
          "fact_inventory_proposed_protagonist_without_production_write",
          "author_adopted_protagonist_through_existing_per_item_boundary",
          "next_real_prose_draft_wove_the_adopted_protagonist",
          "next_prose_adoption_started_the_protagonist_arc_ledger_without_history_backfill",
        ],
      },
    );
  });

  it("requires the assumption confirm roundtrip to end with exactly one accepted character", () => {
    const records = [
      {
        event: "channel.author_action.done",
        action_type: "start_fact_inventory",
        run_id: "run-au14-a3",
      },
      {
        event: "channel.get_assumptions.done",
        assumption_count: 1,
      },
      {
        event: "channel.author_action.done",
        action_type: "confirm_assumption",
        assumption_status: "ACCEPTED",
      },
      {
        event: "channel.get_characters.done",
        character_count: 1,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au14-assumption-confirm-roundtrip",
        run_id: "run-au14-a3",
        profile_ref: "fact_inventory_v1",
        inventory_turn_id: "turn-inventory",
        inventory_activated_assumption: true,
        assumption_count: 1,
        assumption_section_visible: true,
        assumption_badge_visible: true,
        confirm_action_sent: true,
        confirmed_character_ref: "character-shenyan",
        assumption_status_after_confirm: "ACCEPTED",
        assumption_section_cleared_after_confirm: true,
        archive_character_count: 1,
        confirmed_character_visible: true,
        no_duplicate_character_rows: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au14-assumption-confirm-roundtrip", records);
    expect(evidence).toEqual({
      slice_id: "au14-assumption-confirm-roundtrip",
      turn_id: "turn-inventory",
      turn_ids: ["turn-inventory"],
      run_id: "run-au14-a3",
      profile_ref: "fact_inventory_v1",
      confirmed_character_ref: "character-shenyan",
      key_events: keyEventsForSlice("au14-assumption-confirm-roundtrip"),
    });
    expect(
      findSliceBehaviorEvidence("au14-assumption-confirm-roundtrip", records, evidence),
    ).toEqual({
      slice_id: "au14-assumption-confirm-roundtrip",
      behavior:
        "inventory_activated_assumption_confirmed_in_place_into_exactly_one_accepted_character",
      run_id: "run-au14-a3",
      profile_ref: "fact_inventory_v1",
      assertions: [
        "fact_inventory_completion_announced_the_activated_provisional_protagonist",
        "overview_assumption_section_rendered_badge_row_and_decision_actions",
        "confirm_assumption_carried_the_character_ref_and_replied_accepted",
        "assumption_section_disappeared_after_confirm",
        "confirmed_protagonist_entered_the_character_archive_exactly_once",
      ],
    });

    // 负例翻转：角色 tab 出现重复行（两条确认路径插了重复角色）→ 证据不成立。
    const duplicatedRowRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, no_duplicate_character_rows: false }
        : record,
    );
    expect(
      findNativeSliceEvidence("au14-assumption-confirm-roundtrip", duplicatedRowRecords),
    ).toBeNull();
  });

  it("requires assumption-backed presence first and absence directive restoration after discard", () => {
    const records = [
      {
        event: "channel.author_action.done",
        action_type: "start_fact_inventory",
        run_id: "run-au14-a2",
      },
      {
        event: "context.fact_completeness.done",
        capability: "prose_writing",
        assumption_active: 1,
        design_missing: [],
      },
      {
        event: "channel.author_action.done",
        action_type: "discard_assumption",
        assumption_status: "DISCARDED",
      },
      {
        event: "context.fact_completeness.done",
        capability: "prose_writing",
        assumption_active: 0,
        design_missing: ["protagonist"],
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au14-assumption-provisional-injection",
        run_id: "run-au14-a2",
        profile_ref: "fact_inventory_v1",
        inventory_turn_id: "turn-inventory",
        inventory_activated_assumption: true,
        first_prose_turn_id: "turn-prose-1",
        assumption_active_during_first_prose: 1,
        protagonist_present_with_assumption: true,
        provisional_marker_in_prompt: true,
        discard_action_sent: true,
        discarded_character_ref: "character-shenyan",
        assumption_status_after_discard: "DISCARDED",
        assumption_section_cleared_after_discard: true,
        assumption_active_after_discard: 0,
        absence_directive_restored: true,
        prompt_marker_evidence: "fact_completeness_only",
      },
    ];

    const evidence = findNativeSliceEvidence("au14-assumption-provisional-injection", records);
    expect(evidence).toEqual({
      slice_id: "au14-assumption-provisional-injection",
      turn_id: "turn-prose-1",
      turn_ids: ["turn-inventory", "turn-prose-1"],
      run_id: "run-au14-a2",
      profile_ref: "fact_inventory_v1",
      discarded_character_ref: "character-shenyan",
      prompt_marker_evidence: "fact_completeness_only",
      key_events: keyEventsForSlice("au14-assumption-provisional-injection"),
    });
    expect(
      findSliceBehaviorEvidence("au14-assumption-provisional-injection", records, evidence),
    ).toEqual({
      slice_id: "au14-assumption-provisional-injection",
      behavior:
        "active_assumption_satisfies_protagonist_presence_until_discard_restores_absence_directive",
      run_id: "run-au14-a2",
      profile_ref: "fact_inventory_v1",
      prompt_marker_evidence: "fact_completeness_only",
      assertions: [
        "fact_inventory_activated_the_provisional_protagonist_without_author_decision",
        "first_prose_mechanical_preparation_counted_the_active_assumption_as_protagonist_presence",
        "provisional_marker_evidence_source_recorded_honestly",
        "author_discard_replied_discarded_and_cleared_the_assumption_section",
        "second_prose_mechanical_preparation_restored_the_protagonist_absence_directive",
      ],
    });

    // 负例翻转：否决后 fact_completeness 仍不含 protagonist（缺席守则没有回归）→ 证据不成立。
    const absenceNotRestoredRecords = records.map((record) =>
      record.event === "context.fact_completeness.done" && record.assumption_active === 0
        ? { ...record, design_missing: [] }
        : record,
    );
    expect(
      findNativeSliceEvidence("au14-assumption-provisional-injection", absenceNotRestoredRecords),
    ).toBeNull();
  });

  it("requires the judgment chain for ordinary conversation turns (ADR-0025 CP1)", () => {
    const records = [
      {
        event: "channel.user_message.done",
        run_id: "run-conversation",
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-conversation-turn",
        turn_id: "turn-conversation",
        parent_turn_id: "turn-conversation",
        final_turn_id: "turn-conversation",
        run_id: "run-conversation",
        plain_input_sent_from_real_workbench: true,
        parent_fast_ack_before_final_turn_result: true,
        run_mode: "bounded",
        profile_ref: "judgment_loop_v1",
        final_turn_broadcast: true,
        no_tool_called: true,
        no_auto_adoption: true,
        no_production_write: true,
        ui_agent_immediate_feedback_visible: true,
        mechanical_context_first: true,
        judgment_decided_visible: true,
        judgment_action: "reply",
        judgment_narrative_source_type: "provider_output",
        judgment_after_narrative: true,
        turn_result_ready_visible: true,
        inline_reply_carries_narrative_prefix: true,
        author_reasoning_delta_event_count: 3,
        author_reasoning_delta_payload_key: "author_narrative_delta",
        ui_author_reasoning_delta_visible: true,
        ui_author_reasoning_cumulative_delta_visible: true,
        ui_author_reasoning_stream_grew: true,
        consumed_steps: 2,
        consumed_tool_calls: 0,
        consumed_provider_calls: 2,
        consumed_replans: 0,
        persisted_provider_facts_matched_budget: true,
        persisted_provider_purposes: ["author_reasoning", "planner"],
        ui_agentic_loop_reasoning_visible: true,
        ui_agentic_loop_result_visible: true,
        ui_agent_panel_visible: true,
        ui_agent_completed_visible: true,
        log_sync_turn_count: 0,
        log_toolbox_execute_count: 0,
      },
    ];

    const evidence = findNativeSliceEvidence("agent-conversation-turn", records);
    expect(evidence).toMatchObject({
      slice_id: "agent-conversation-turn",
      run_id: "run-conversation",
      profile_ref: "judgment_loop_v1",
      judgment_action: "reply",
      consumed_provider_calls: 2,
    });
    expect(findSliceBehaviorEvidence("agent-conversation-turn", records, evidence)).toMatchObject({
      slice_id: "agent-conversation-turn",
      behavior: "plain_conversation_judged_reply_inline_with_two_provider_calls",
      assertions: expect.arrayContaining([
        "mechanical_context_assembled_before_any_model_narrative",
        "judgment_narrative_streamed_author_visible_before_structure",
        "judgment_decided_reply_with_provider_bound_narrative_source",
        "inline_reply_turn_result_byte_carried_streamed_narrative_prefix",
        "simple_conversation_consumed_exactly_two_provider_calls",
      ]),
    });

    // 判断结构缺失 → 不算证据
    const missingJudgmentRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, judgment_decided_visible: false }
        : record,
    );
    expect(findNativeSliceEvidence("agent-conversation-turn", missingJudgmentRecords)).toBeNull();

    // 内联回复未字节携带叙事前缀 → 不算证据（N-NARR）
    const missingInlineRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, inline_reply_carries_narrative_prefix: false }
        : record,
    );
    expect(findNativeSliceEvidence("agent-conversation-turn", missingInlineRecords)).toBeNull();

    // 调用数不是恰 2 → 不算证据（简单对话经济学）
    const extraCallRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, consumed_provider_calls: 3 }
        : record,
    );
    expect(findNativeSliceEvidence("agent-conversation-turn", extraCallRecords)).toBeNull();
  });

  it("requires design-state plan citation evidence for judgment-explore-chapter-plan (ADR-0025 CP5b)", () => {
    const records = [
      { event: "channel.user_message.start", turn_id: "turn-plan-q" },
      { event: "judgment.decided.done", turn_id: "turn-plan-q", action: "explore" },
      { event: "judgment.decided.done", turn_id: "turn-plan-q", action: "reply" },
      { event: "channel.user_message.done", turn_id: "turn-plan-q" },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "judgment-explore-chapter-plan",
        explore_turn_id: "turn-plan-q:agent:2",
        explore_question_text: "「第02章」按计划要写什么？",
        explore_reply_text:
          "我检索了正文中与「第02章」相关的段落，依据如下：\n\n「第02章：旧服务器里的残诀」\n【计划】主角从废弃服务器中找到残缺功法，并第一次突破底层限制。",
        explore_reply_cites_plan: true,
        explore_reply_cites_chapter: true,
        exploration_visible_in_run_feedback: true,
        explore_no_pending_artifacts: true,
      },
    ];

    const evidence = findNativeSliceEvidence("judgment-explore-chapter-plan", records);
    expect(evidence).toMatchObject({
      slice_id: "judgment-explore-chapter-plan",
      explore_turn_id: "turn-plan-q:agent:2",
      judgment_explore_count: 1,
    });

    expect(
      findSliceBehaviorEvidence("judgment-explore-chapter-plan", records, evidence),
    ).toMatchObject({
      behavior: "judgment_explores_chapter_plan_design_state_then_replies_with_cited_plan",
      fact_term: "第02章",
      assertions: expect.arrayContaining([
        "author_question_names_a_design_state_only_fact",
        "chapter_plan_retrieved_readonly_without_toolbox_dispatch",
        "reply_cites_plan_content_and_chapter",
      ]),
    });

    // 计划引用位缺失 → 不算证据
    const uncited = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, explore_reply_cites_plan: false }
        : record,
    );
    expect(findNativeSliceEvidence("judgment-explore-chapter-plan", uncited)).toBeNull();
  });

  it("requires explore-then-cited-reply evidence for judgment-explore-internal (ADR-0025 CP5a)", () => {
    const records = [
      { event: "channel.user_message.start", turn_id: "turn-explore" },
      { event: "judgment.decided.done", turn_id: "turn-explore", action: "explore" },
      { event: "judgment.decided.done", turn_id: "turn-explore", action: "reply" },
      { event: "channel.user_message.done", turn_id: "turn-explore" },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "judgment-explore-internal",
        draft_turn_id: "turn-seed:agent:4",
        adopt_turn_id: "turn-adopt",
        explore_turn_id: "turn-explore:agent:2",
        explore_question_text: "查一下正文里「灵气账单」是怎么写的",
        explore_reply_text:
          "我检索了正文中与「灵气账单」相关的段落，依据如下：\n\n「第01章：底层灵气账单」夜色压在底层灵气账单上…",
        explore_reply_cites_fact: true,
        explore_reply_cites_chapter: true,
        exploration_visible_in_run_feedback: true,
        explore_no_pending_artifacts: true,
      },
    ];

    const evidence = findNativeSliceEvidence("judgment-explore-internal", records);
    expect(evidence).toMatchObject({
      slice_id: "judgment-explore-internal",
      explore_turn_id: "turn-explore:agent:2",
      judgment_explore_count: 1,
    });

    expect(findSliceBehaviorEvidence("judgment-explore-internal", records, evidence)).toMatchObject(
      {
        behavior: "judgment_explores_adopted_prose_then_replies_with_cited_facts",
        fact_term: "灵气账单",
        assertions: expect.arrayContaining([
          "judgment_decided_explore_before_reply_on_same_turn",
          "exploration_ran_readonly_without_toolbox_dispatch",
          "reply_cites_fact_term_and_source_chapter",
        ]),
      },
    );

    // 判断链缺 explore（只有 reply）→ 不算证据
    const noExplore = records.filter(
      (record) => !(record.event === "judgment.decided.done" && record.action === "explore"),
    );
    expect(findNativeSliceEvidence("judgment-explore-internal", noExplore)).toBeNull();

    // 顺序颠倒（reply 先于 explore）→ 不算证据
    const reversed = records.map((record) => {
      if (record.event !== "judgment.decided.done") return record;
      return { ...record, action: record.action === "explore" ? "reply" : "explore" };
    });
    expect(findNativeSliceEvidence("judgment-explore-internal", reversed)).toBeNull();

    // 回复未引用事实 → 不算证据
    const uncited = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, explore_reply_cites_fact: false }
        : record,
    );
    expect(findNativeSliceEvidence("judgment-explore-internal", uncited)).toBeNull();

    // 探索 turn 出现 toolbox dispatch → behavior 不成立（只读检索不经 Toolbox）
    const withToolbox = [
      ...records,
      {
        event: "toolbox.execute.done",
        turn_id: "turn-explore:agent:2",
        tool_name: "prose_writing",
      },
    ];
    const toolboxEvidence = findNativeSliceEvidence("judgment-explore-internal", withToolbox);
    expect(toolboxEvidence).not.toBeNull();
    expect(
      findSliceBehaviorEvidence("judgment-explore-internal", withToolbox, toolboxEvidence),
    ).toBeNull();
  });

  it("requires judgment-loop direct reply evidence for the no-deviation scenario (ADR-0025 CP1)", () => {
    const records = [
      {
        event: "channel.user_message.done",
        run_id: "run-direct",
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agentic-loop-no-deviation-direct",
        turn_id: "turn-direct",
        parent_turn_id: "turn-direct",
        final_turn_id: "turn-direct",
        run_id: "run-direct",
        plain_input_sent_from_real_workbench: true,
        parent_fast_ack_before_final_turn_result: true,
        run_mode: "bounded",
        profile_ref: "judgment_loop_v1",
        final_turn_broadcast: true,
        no_tool_called: true,
        no_auto_adoption: true,
        no_production_write: true,
        ui_agent_immediate_feedback_visible: true,
        mechanical_context_first: true,
        judgment_decided_visible: true,
        judgment_action: "reply",
        judgment_narrative_source_type: "provider_output",
        judgment_after_narrative: true,
        turn_result_ready_visible: true,
        inline_reply_carries_narrative_prefix: true,
        author_reasoning_delta_event_count: 2,
        author_reasoning_delta_payload_key: "author_narrative_delta",
        ui_author_reasoning_delta_visible: true,
        ui_author_reasoning_cumulative_delta_visible: true,
        ui_author_reasoning_stream_grew: true,
        consumed_steps: 2,
        consumed_tool_calls: 0,
        consumed_provider_calls: 2,
        consumed_replans: 0,
        persisted_provider_facts_matched_budget: true,
        persisted_provider_purposes: ["author_reasoning", "planner"],
        ui_agentic_loop_reasoning_visible: true,
        ui_agentic_loop_result_visible: true,
        ui_agent_panel_visible: true,
        ui_agent_completed_visible: true,
        log_sync_turn_count: 0,
        log_toolbox_execute_count: 0,
      },
    ];

    const evidence = findNativeSliceEvidence("agentic-loop-no-deviation-direct", records);
    expect(evidence).toMatchObject({
      slice_id: "agentic-loop-no-deviation-direct",
      run_id: "run-direct",
      profile_ref: "judgment_loop_v1",
      consumed_provider_calls: 2,
    });

    expect(
      findSliceBehaviorEvidence("agentic-loop-no-deviation-direct", records, evidence),
    ).toMatchObject({
      slice_id: "agentic-loop-no-deviation-direct",
      behavior: "judgment_loop_direct_reply_without_replan",
      assertions: expect.arrayContaining(["no_replan_was_consumed_on_the_direct_path"]),
    });

    // 消耗了修订 → 不算直通证据
    const replanRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done" ? { ...record, consumed_replans: 1 } : record,
    );
    expect(findNativeSliceEvidence("agentic-loop-no-deviation-direct", replanRecords)).toBeNull();
  });

  it("requires D6 plan revision evidence before completing an exhausted conversation plan", () => {
    // 判断纪元（迁移账⑤）：D6 短计划诱导于 prose 创作 profile。
    const records = [
      {
        event: "channel.user_message.start",
        turn_id: "turn-d6",
        workspace_id: "ws-1",
        work_id: "work-1",
        duration_ms: 0,
        outcome: "start",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agentic-loop-plan-replan-reasoning",
        turn_id: "turn-d6",
        final_turn_id: "turn-d6",
        run_id: "run-d6",
        profile_ref: "prose_drafting_with_quality_v1",
        short_plan_step_count: 1,
        judgment_continuation_observed: true,
        consumed_replans: 1,
        prose_artifact_pending: 1,
      },
    ];

    const evidence = findNativeSliceEvidence("agentic-loop-plan-replan-reasoning", records);
    expect(evidence).toMatchObject({
      slice_id: "agentic-loop-plan-replan-reasoning",
      run_id: "run-d6",
      consumed_replans: 1,
      short_plan_step_count: 1,
    });

    expect(
      findSliceBehaviorEvidence("agentic-loop-plan-replan-reasoning", records, evidence),
    ).toMatchObject({
      slice_id: "agentic-loop-plan-replan-reasoning",
      assertions: expect.arrayContaining([
        "judgment_continuation_continued_after_exhausted_short_plan",
      ]),
    });

    const missingReplanRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, judgment_continuation_observed: false }
        : record,
    );

    expect(
      findNativeSliceEvidence("agentic-loop-plan-replan-reasoning", missingReplanRecords),
    ).toBeNull();
  });

  it("requires native tool-call telemetry for AgentPlan draft and revision", () => {
    // 判断纪元（迁移账⑤）：D6 prose 基座上验证 native tool call 协议遥测。
    const records = [
      {
        event: "channel.user_message.start",
        turn_id: "turn-native-plan",
        workspace_id: "ws-1",
        work_id: "work-1",
        duration_ms: 0,
        outcome: "start",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-plan-native-tool-calling-protocol",
        turn_id: "turn-native-plan",
        final_turn_id: "turn-native-plan",
        run_id: "run-native-plan",
        profile_ref: "prose_drafting_with_quality_v1",
        short_plan_step_count: 1,
        judgment_continuation_observed: true,
        consumed_replans: 1,
        prose_artifact_pending: 1,
        provider_activity_api_status: 200,
        native_tool_call_final_output_count: 2,
        native_tool_call_names: ["agent_plan_draft", "continuation_decision"],
        native_tool_call_draft_projected: true,
        native_tool_call_continuation_projected: true,
        native_tool_call_arguments_leaked: false,
      },
    ];

    const evidence = findNativeSliceEvidence("agent-plan-native-tool-calling-protocol", records);
    expect(evidence).toMatchObject({
      slice_id: "agent-plan-native-tool-calling-protocol",
      run_id: "run-native-plan",
      consumed_replans: 1,
    });

    expect(
      findSliceBehaviorEvidence("agent-plan-native-tool-calling-protocol", records, evidence),
    ).toMatchObject({
      slice_id: "agent-plan-native-tool-calling-protocol",
      assertions: expect.arrayContaining([
        "agent_plan_draft_structure_came_from_native_tool_call",
        "judgment_continuation_structure_came_from_native_tool_call",
      ]),
    });

    const leakedRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, native_tool_call_arguments_leaked: true }
        : record,
    );

    expect(
      findNativeSliceEvidence("agent-plan-native-tool-calling-protocol", leakedRecords),
    ).toBeNull();
  });

  it("requires D5 budget deviation plan revision evidence before awaiting author", () => {
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: "turn-d5",
        run_id: "run-d5",
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agentic-loop-budget-deviation-replan",
        turn_id: "turn-d5",
        parent_turn_id: "turn-d5",
        run_id: "run-d5",
        plain_input_sent_from_real_workbench: true,
        parent_fast_ack_before_terminal: true,
        run_mode: "bounded",
        profile_ref: "conversation_turn_v1",
        plan_revised_visible: true,
        plan_revised_event_count: 1,
        plan_revised_reason_codes: [
          "agent_plan_revised",
          "conversation_plan_drafted",
          "agentic_deviation",
          "agentic_deviation:D5",
        ],
        plan_revised_target_tool_ref: "context_assemble",
        plan_revised_plan_version: 2,
        plan_revised_revision_reason: "D5 偏离信号：剩余 step 预算不足以走完当前计划。",
        plan_revised_evaluation_plan_holds: false,
        plan_revised_author_narrative_source_type: "provider_output",
        context_result_visible: true,
        awaiting_event_type: "awaiting_author",
        terminal_status: "awaiting_author",
        consumed_steps: 1,
        consumed_tool_calls: 0,
        consumed_provider_calls: 2,
        consumed_replans: 1,
        final_turn_result_arrived: false,
        log_sync_turn_count: 0,
        log_toolbox_execute_count: 0,
      },
    ];

    const evidence = findNativeSliceEvidence("agentic-loop-budget-deviation-replan", records);
    expect(evidence).toEqual({
      slice_id: "agentic-loop-budget-deviation-replan",
      turn_id: "turn-d5",
      turn_ids: ["turn-d5"],
      parent_turn_id: "turn-d5",
      run_id: "run-d5",
      profile_ref: "conversation_turn_v1",
      consumed_steps: 1,
      consumed_tool_calls: 0,
      consumed_provider_calls: 2,
      consumed_replans: 1,
      plan_revised_plan_version: 2,
      plan_revised_revision_reason: "D5 偏离信号：剩余 step 预算不足以走完当前计划。",
      key_events: keyEventsForSlice("agentic-loop-budget-deviation-replan"),
    });
    expect(
      findSliceBehaviorEvidence("agentic-loop-budget-deviation-replan", records, evidence),
    ).toMatchObject({
      slice_id: "agentic-loop-budget-deviation-replan",
      behavior: "budget_shortfall_triggers_provider_sourced_replan_before_awaiting_author",
      assertions: expect.arrayContaining([
        "d5_budget_shortfall_promoted_to_provider_sourced_plan_revised",
        "runtime_consumed_one_replan_budget",
        "run_waited_for_author_without_final_turn_or_tool_execution",
      ]),
    });

    const wrongProviderBudgetRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, consumed_provider_calls: 3 }
        : record,
    );
    expect(
      findNativeSliceEvidence("agentic-loop-budget-deviation-replan", wrongProviderBudgetRecords),
    ).toBeNull();

    const missingD5Records = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, plan_revised_reason_codes: ["agent_plan_revised"] }
        : record,
    );
    expect(
      findNativeSliceEvidence("agentic-loop-budget-deviation-replan", missingD5Records),
    ).toBeNull();
  });

  it.each([
    [
      "agentic-loop-tool-failure-replan",
      {
        signal: "D1",
        mode: "await",
        steps: 4,
        toolCalls: 1,
        providerCalls: 8,
        behavior: "tool_failure_settles_awaiting_author_after_judgment_continuation",
        headAssertion: "d1_tool_failure_observed_by_judgment_continuation",
      },
    ],
    [
      "agentic-loop-quality-deviation-replan",
      {
        signal: "D2",
        mode: "improve",
        steps: 5,
        toolCalls: 2,
        providerCalls: 10,
        artifactEvents: 2,
        supersededEvents: 1,
        allowCandidateTurnResult: true,
        behavior: "quality_finding_improves_draft_through_judgment_continuation",
        headAssertion: "intermediate_draft_superseded_by_improved_draft",
      },
    ],
    [
      "agentic-loop-gate-deviation-replan",
      {
        signal: "D4",
        mode: "await",
        steps: 4,
        toolCalls: 0,
        providerCalls: 6,
        gateDecisionType: "require_confirmation",
        gateFirstBlockingGate: "authority",
        behavior: "gate_deny_settles_awaiting_author_after_judgment_continuation",
        headAssertion: "d4_gate_deny_observed_by_judgment_continuation",
      },
    ],
    [
      "agentic-loop-deterministic-gap-replan",
      {
        signal: "D7",
        mode: "await",
        steps: 4,
        toolCalls: 0,
        providerCalls: 6,
        behavior: "deterministic_gap_settles_awaiting_author_after_judgment_continuation",
        headAssertion: "d7_deterministic_gap_observed_by_judgment_continuation",
      },
    ],
  ])("requires %s prose deviation replan evidence", (sliceId, expected) => {
    const improve = expected.mode === "improve";
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: `turn-${expected.signal}`,
        run_id: `run-${expected.signal}`,
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: sliceId,
        turn_id: `turn-${expected.signal}`,
        parent_turn_id: `turn-${expected.signal}`,
        run_id: `run-${expected.signal}`,
        plain_input_sent_from_real_workbench: true,
        parent_fast_ack_before_terminal: true,
        run_mode: "bounded",
        profile_ref: "prose_drafting_with_quality_v1",
        continuation_mode: expected.mode,
        judgment_continuation_observed: true,
        deviation_signal_observed: true,
        artifact_superseded_event_count: expected.supersededEvents ?? 0,
        terminal_event_type: improve ? "run_completed" : "awaiting_author",
        terminal_status: improve ? "completed" : "awaiting_author",
        consumed_steps: expected.steps,
        consumed_tool_calls: expected.toolCalls,
        consumed_provider_calls: expected.providerCalls,
        consumed_replans: improve ? 1 : 0,
        final_turn_result_arrived: improve || expected.allowCandidateTurnResult === true,
        final_turn_result_agent_run_status: improve
          ? "completed"
          : expected.allowCandidateTurnResult === true
            ? "awaiting_author"
            : null,
        final_turn_result_pending_artifact_count:
          improve || expected.allowCandidateTurnResult === true ? 1 : 0,
        final_turn_result_quality_policy_action:
          !improve && expected.allowCandidateTurnResult === true ? "confirm" : null,
        gate_decision_type: expected.gateDecisionType ?? null,
        gate_first_blocking_gate: expected.gateFirstBlockingGate ?? null,
        artifact_event_count: expected.artifactEvents ?? 0,
        tool_started_event_count: 0,
        log_sync_turn_count: 0,
      },
    ];

    const evidence = findNativeSliceEvidence(sliceId, records);
    expect(evidence).toMatchObject({
      slice_id: sliceId,
      turn_id: `turn-${expected.signal}`,
      run_id: `run-${expected.signal}`,
      profile_ref: "prose_drafting_with_quality_v1",
      signal: expected.signal,
      continuation_mode: expected.mode,
      consumed_steps: expected.steps,
      consumed_provider_calls: expected.providerCalls,
      consumed_replans: improve ? 1 : 0,
      key_events: keyEventsForSlice(sliceId),
    });

    expect(findSliceBehaviorEvidence(sliceId, records, evidence)).toMatchObject({
      slice_id: sliceId,
      behavior: expected.behavior,
      assertions: expect.arrayContaining([
        "judgment_continuation_narrative_was_provider_sourced",
        expected.headAssertion,
      ]),
    });

    const missingContinuationRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, judgment_continuation_observed: false }
        : record,
    );
    expect(findNativeSliceEvidence(sliceId, missingContinuationRecords)).toBeNull();
  });
  it("accepts agent steer replan evidence from the active-run main input", () => {
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: "turn-steer",
        run_id: "run-steer",
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-steer-replan",
        parent_turn_id: "turn-steer",
        run_id: "run-steer",
        run_mode: "bounded",
        command: "steer",
        command_sent_from_main_input: true,
        no_second_user_message_for_steer: true,
        main_input_steer_placeholder_visible: true,
        active_run_work_state_visible_after_steer: true,
        active_run_terminal_work_state_visible_after_steer: true,
        terminal_status: "completed",
        main_input_steer_text_visible_after_submit: true,
        command_ack_received: true,
        command_target_bound_to_active_run: true,
        no_cross_run_command: true,
        plan_adjusted_event_type: "plan_adjusted",
        consumed_replans: 0,
        adjusted_goal_version: 2,
      },
    ];

    const evidence = findNativeSliceEvidence("agent-steer-replan", records);

    expect(evidence).toMatchObject({
      turn_id: "turn-steer",
      run_id: "run-steer",
      command_source: "main_input",
      adjusted_goal_version: 2,
      consumed_replans: 0,
    });
    expect(findSliceBehaviorEvidence("agent-steer-replan", records, evidence)).toMatchObject({
      behavior: "main_input_steer_updates_bounded_agent_run_goal_for_mechanical_flow",
      command_source: "main_input",
      assertions: expect.arrayContaining([
        "active_agent_run_switches_main_input_to_steering_placeholder",
        "main_input_steer_text_stayed_visible_as_local_author_message",
        "active_agent_run_work_state_remained_visible_after_main_input_steer",
        "active_agent_run_terminal_work_state_stayed_visible_after_main_input_steer",
        "main_chat_input_text_was_sent_as_agent_command_steer",
        "steer_replan_consumed_one_replan_budget",
      ]),
    });
  });

  it("accepts awaiting-author steer evidence only when the same run resumes and stale prompt stays singular", () => {
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: "turn-awaiting-steer",
        run_id: "run-awaiting-steer",
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-awaiting-author-steer-resume",
        parent_turn_id: "turn-awaiting-steer",
        run_id: "run-awaiting-steer",
        run_mode: "bounded",
        awaiting_status: "awaiting_author",
        terminal_status: "completed",
        command: "steer",
        command_ack_received: true,
        command_target_bound_to_active_run: true,
        plan_adjusted_event_type: "plan_adjusted",
        run_resumed_event_type: "run_resumed",
        run_resumed_reason_codes: ["steer_requested", "resume_after_steer"],
        adjusted_goal_version: 2,
        steer_text_visible_after_submit: true,
        no_second_user_message_for_steer: true,
        no_second_run_after_steer: true,
        stale_awaiting_prompt_total_count: 1,
        stale_awaiting_prompt_not_repeated: true,
        final_result_visible_after_adjustment: true,
        final_result_child_of_same_parent: true,
      },
    ];

    const evidence = findNativeSliceEvidence("agent-awaiting-author-steer-resume", records);

    expect(evidence).toMatchObject({
      turn_id: "turn-awaiting-steer",
      run_id: "run-awaiting-steer",
      command_source: "awaiting_author_task_input",
      awaiting_status: "awaiting_author",
      terminal_status: "completed",
      adjusted_goal_version: 2,
      stale_awaiting_prompt_total_count: 1,
    });
    expect(
      findSliceBehaviorEvidence("agent-awaiting-author-steer-resume", records, evidence),
    ).toMatchObject({
      behavior: "awaiting_author_adjustment_resumes_and_completes_the_same_agent_run",
      assertions: expect.arrayContaining([
        "plan_adjusted_and_run_resumed_were_broadcast_for_the_same_run",
        "original_awaiting_prompt_remained_once_and_was_not_repeated",
      ]),
    });

    const duplicatedPromptRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? {
            ...record,
            stale_awaiting_prompt_total_count: 2,
            stale_awaiting_prompt_not_repeated: false,
          }
        : record,
    );
    expect(
      findNativeSliceEvidence("agent-awaiting-author-steer-resume", duplicatedPromptRecords),
    ).toBeNull();
  });

  it("accepts DS03 awaiting-input evidence only when the required-input surface holds and reload keeps single copies", () => {
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: "turn-awaiting-input",
        run_id: "run-awaiting-input",
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-awaiting-author-input-required",
        parent_turn_id: "turn-awaiting-input",
        run_id: "run-awaiting-input",
        run_mode: "bounded",
        awaiting_status: "awaiting_author",
        terminal_status: "completed",
        command: "steer",
        command_ack_received: true,
        command_target_bound_to_active_run: true,
        bare_resume_absent_while_awaiting: true,
        awaiting_input_hint_visible: true,
        awaiting_placeholder_visible: true,
        empty_send_disabled_while_awaiting: true,
        same_run_resumed_after_input: true,
        run_resumed_reason_codes: ["steer_requested", "resume_after_steer"],
        steer_text_restored_after_reload: true,
        steer_text_reload_occurrence_count: 1,
        stale_awaiting_prompt_after_reload_count: 1,
        no_failure_bubble: true,
      },
    ];

    const evidence = findNativeSliceEvidence("agent-awaiting-author-input-required", records);

    expect(evidence).toMatchObject({
      turn_id: "turn-awaiting-input",
      run_id: "run-awaiting-input",
      command_source: "awaiting_author_task_input",
      awaiting_status: "awaiting_author",
      terminal_status: "completed",
      steer_text_reload_occurrence_count: 1,
      stale_awaiting_prompt_after_reload_count: 1,
    });
    expect(
      findSliceBehaviorEvidence("agent-awaiting-author-input-required", records, evidence),
    ).toMatchObject({
      behavior:
        "awaiting_author_requires_concrete_input_and_survives_reload_without_duplicates",
      assertions: expect.arrayContaining([
        "awaiting_author_dock_exposed_no_bare_resume_action",
        "empty_input_kept_the_send_adjustment_action_disabled",
        "steer_message_was_persisted_and_restored_once_after_reload",
      ]),
    });

    const bareResumeRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, bare_resume_absent_while_awaiting: false }
        : record,
    );
    expect(
      findNativeSliceEvidence("agent-awaiting-author-input-required", bareResumeRecords),
    ).toBeNull();
  });

  it("accepts DS03 live refresh-resume evidence only when the same run reconnects and resumes in place", () => {
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: "turn-live-resume",
        run_id: "run-live-resume",
        run_mode: "bounded",
      },
      {
        event: "channel.agent_run_reconnect.done",
        run_id: "run-live-resume",
        run_mode: "bounded",
        runtime_live: true,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-bounded-refresh-live-resume",
        parent_turn_id: "turn-live-resume",
        run_id: "run-live-resume",
        run_mode: "bounded",
        paused_status: "paused",
        reconnect_recovered: true,
        reconnect_runtime_live: true,
        resume_command_bound_to_same_run: true,
        run_resumed_reason_codes: ["resume_requested"],
        no_second_run_after_reload: true,
        no_run_restart_after_reload: true,
        completed_steps_preserved: true,
        terminal_status: "completed",
      },
    ];

    const evidence = findNativeSliceEvidence("agent-bounded-refresh-live-resume", records);

    expect(evidence).toMatchObject({
      turn_id: "turn-live-resume",
      run_id: "run-live-resume",
      command: "resume",
      command_source: "reconnected_control_dock",
      paused_status: "paused",
      terminal_status: "completed",
    });
    expect(
      findSliceBehaviorEvidence("agent-bounded-refresh-live-resume", records, evidence),
    ).toMatchObject({
      behavior: "page_refresh_reconnects_the_live_bounded_run_and_resumes_it_in_place",
      assertions: expect.arrayContaining([
        "channel_logged_agent_run_reconnect_for_the_same_run_id",
        "reconnect_state_carried_recovered_and_runtime_live",
        "no_second_run_or_run_restart_appeared_after_reload",
      ]),
    });

    const deadRuntimeRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, reconnect_runtime_live: false }
        : record,
    );
    expect(
      findNativeSliceEvidence("agent-bounded-refresh-live-resume", deadRuntimeRecords),
    ).toBeNull();
  });

  it("accepts DS03 dead-run expiry evidence only when the dead run degrades honestly into a new run", () => {
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: "turn-dead-run",
        run_id: "run-dead",
        run_mode: "bounded",
      },
      {
        event: "channel.agent_run_expired.done",
        run_id: "run-dead",
        run_mode: "bounded",
        runtime_live: false,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-dead-bounded-run-expiry",
        parent_turn_id: "turn-dead-run",
        run_id: "run-dead",
        run_mode: "bounded",
        dead_state_runtime_live: false,
        expired_title_visible: true,
        expired_detail_visible: true,
        restart_action_visible: true,
        bare_resume_absent_for_dead_run: true,
        terminate_absent_for_dead_run: true,
        no_failure_bubble: true,
        restart_prefill_matches_goal: true,
        send_label_is_normal_send: true,
        new_run_id: "run-restarted",
        new_run_differs_from_dead_run: true,
        no_agent_command_to_dead_run: true,
      },
    ];

    const evidence = findNativeSliceEvidence("agent-dead-bounded-run-expiry", records);

    expect(evidence).toMatchObject({
      turn_id: "turn-dead-run",
      run_id: "run-dead",
      new_run_id: "run-restarted",
      dead_state_runtime_live: false,
    });
    expect(
      findSliceBehaviorEvidence("agent-dead-bounded-run-expiry", records, evidence),
    ).toMatchObject({
      behavior: "dead_bounded_run_degrades_honestly_and_restarts_as_a_new_run",
      assertions: expect.arrayContaining([
        "backend_restart_broadcast_runtime_live_false_for_the_dead_run",
        "no_resume_pause_or_terminate_action_remained_for_the_dead_run",
        "no_agent_command_targeted_the_dead_run_after_reload",
      ]),
    });

    const commandToDeadRunRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, no_agent_command_to_dead_run: false }
        : record,
    );
    expect(
      findNativeSliceEvidence("agent-dead-bounded-run-expiry", commandToDeadRunRecords),
    ).toBeNull();
  });

  it("rejects main-input steer evidence when the terminal work state disappears after the latest user message", () => {
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: "turn-steer",
        run_id: "run-steer",
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-natural-language-steer",
        parent_turn_id: "turn-steer",
        run_id: "run-steer",
        run_mode: "bounded",
        command: "steer",
        command_sent_from_main_input: true,
        no_second_user_message_for_steer: true,
        main_input_steer_placeholder_visible: true,
        active_run_work_state_visible_after_steer: true,
        active_run_terminal_work_state_visible_after_steer: false,
        terminal_status: "completed",
        main_input_steer_text_visible_after_submit: true,
        command_ack_received: true,
        command_target_bound_to_active_run: true,
        no_cross_run_command: true,
        plan_adjusted_event_type: "plan_adjusted",
        plan_revised_event_type: "plan_revised",
        plan_revised_author_narrative_source_type: "provider_output",
        plan_revised_evaluation_plan_holds: false,
        consumed_replans: 1,
        adjusted_goal_version: 2,
      },
    ];

    expect(findNativeSliceEvidence("agent-natural-language-steer", records)).toBeNull();
  });

  it("rejects agent steer evidence when replan budget was unexpectedly consumed", () => {
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: "turn-steer",
        run_id: "run-steer",
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-steer-replan",
        parent_turn_id: "turn-steer",
        run_id: "run-steer",
        run_mode: "bounded",
        command: "steer",
        command_sent_from_main_input: true,
        no_second_user_message_for_steer: true,
        main_input_steer_placeholder_visible: true,
        active_run_work_state_visible_after_steer: true,
        active_run_terminal_work_state_visible_after_steer: true,
        terminal_status: "completed",
        main_input_steer_text_visible_after_submit: true,
        command_ack_received: true,
        command_target_bound_to_active_run: true,
        no_cross_run_command: true,
        plan_adjusted_event_type: "plan_adjusted",
        plan_revised_event_type: "plan_revised",
        plan_revised_author_narrative_source_type: "provider_output",
        plan_revised_evaluation_plan_holds: false,
        // CP2b：机械 flow 的 steer 不消耗 replan——出现消耗即为非法证据。
        consumed_replans: 1,
        adjusted_goal_version: 2,
      },
    ];

    expect(findNativeSliceEvidence("agent-steer-replan", records)).toBeNull();
  });

  it("rejects agent steer replan evidence without the active-run main input placeholder", () => {
    const records = [
      {
        event: "channel.user_message.done",
        turn_id: "turn-steer",
        run_id: "run-steer",
        run_mode: "bounded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-steer-replan",
        parent_turn_id: "turn-steer",
        run_id: "run-steer",
        run_mode: "bounded",
        command: "steer",
        command_sent_from_main_input: true,
        no_second_user_message_for_steer: true,
        command_ack_received: true,
        command_target_bound_to_active_run: true,
        no_cross_run_command: true,
        plan_adjusted_event_type: "plan_adjusted",
        plan_revised_event_type: "plan_revised",
        plan_revised_author_narrative_source_type: "provider_output",
        plan_revised_evaluation_plan_holds: false,
        consumed_replans: 1,
        adjusted_goal_version: 2,
      },
    ];

    expect(findNativeSliceEvidence("agent-steer-replan", records)).toBeNull();
  });

  it("requires AgentRun world building profile to create a tentative foreshadowing seed", () => {
    const records = [
      {
        event: "channel.user_message.done",
        run_id: "run-world",
        run_mode: "bounded",
      },
      {
        event: "orchestrator.decide.done",
        decision_type: "allow_tool",
      },
      {
        event: "toolbox.execute.done",
        tool_name: "world_building",
        tool_outcome: "succeeded",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-world-building-with-context",
        turn_id: "turn-world-final",
        parent_turn_id: "turn-world-parent",
        final_turn_id: "turn-world-final",
        run_id: "run-world",
        world_building_request_sent_from_real_workbench: true,
        parent_fast_ack_before_final_turn_result: true,
        run_mode: "bounded",
        profile_ref: "world_building_with_context_v1",
        final_turn_broadcast: true,
        final_tool_name: "world_building",
        final_tool_status: "succeeded",
        pending_artifact_id: "artifact-world",
        pending_artifact_type: "foreshadowing_seed",
        expected_artifact_type: "foreshadowing_seed",
        pending_artifact_requires_adoption: true,
        pending_artifact_tentative: true,
        pending_item_preserved_nonce: true,
        no_auto_adoption: true,
        no_production_write: true,
        agent_stage_events_visible: true,
        context_step_visible: true,
        context_event_visible: true,
        context_observation_visible: true,
        plan_drafted_event_count: 0,
        gate_event_visible: true,
        world_step_visible: true,
        tool_started_visible: true,
        tool_completed_visible: true,
        tool_observation_visible: true,
        finalization_step_visible: true,
        artifact_observation_visible: true,
        artifact_event_visible: true,
        ui_context_step_visible: true,
        ui_world_step_visible: true,
        ui_finalization_step_visible: true,
        completed_step_count: 4,
        consumed_steps: 4,
        consumed_tool_calls: 1,
        consumed_provider_calls: 3,
        ui_agent_panel_visible: true,
        ui_agent_completed_visible: true,
        ui_world_building_draft_visible: true,
        ui_profile_selection_visible: true,
        ui_profile_selection_source_visible: true,
        ui_profile_selection_reason_visible: true,
        ui_profile_selection_terms_visible: true,
        ui_profile_selection_path_visible: true,
        ui_execution_brief_path_visible: true,
        log_sync_turn_count: 0,
        log_allow_tool_count: 1,
        log_world_building_tool_done: true,
        world_building_nonce: "WORLD123",
      },
    ];

    const evidence = findNativeSliceEvidence("agent-world-building-with-context", records);
    expect(evidence).toEqual({
      slice_id: "agent-world-building-with-context",
      turn_id: "turn-world-final",
      turn_ids: ["turn-world-parent", "turn-world-final"],
      parent_turn_id: "turn-world-parent",
      final_turn_id: "turn-world-final",
      run_id: "run-world",
      profile_ref: "world_building_with_context_v1",
      pending_artifact_id: "artifact-world",
      pending_artifact_type: "foreshadowing_seed",
      world_building_nonce: "WORLD123",
      consumed_steps: 4,
      consumed_tool_calls: 1,
      consumed_provider_calls: 3,
      ui_profile_selection_visible: true,
      ui_profile_selection_terms_visible: true,
      ui_profile_selection_path_visible: true,
      ui_execution_brief_path_visible: true,
      key_events: keyEventsForSlice("agent-world-building-with-context"),
    });
    expect(
      findSliceBehaviorEvidence("agent-world-building-with-context", records, evidence),
    ).toMatchObject({
      slice_id: "agent-world-building-with-context",
      behavior: "bounded_agent_run_world_building_profile_generates_tentative_foreshadowing_seed",
      assertions: expect.arrayContaining([
        "world_building_profile_selection_causality_was_proven_by_state_transition",
        "world_building_tool_step_followed_model_drafted_plan_and_reentered_orchestrator_gate",
        "world_building_tool_produced_tentative_foreshadowing_seed",
        "world_building_artifact_remained_unadopted_without_production_write",
      ]),
    });

    const wrongArtifactRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, pending_artifact_type: "world_setting" }
        : record,
    );

    expect(
      findNativeSliceEvidence("agent-world-building-with-context", wrongArtifactRecords),
    ).toBeNull();

    const styleRuleRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? {
            ...record,
            slice_id: "agent-world-building-style-rule-with-context",
            pending_artifact_id: "artifact-style",
            pending_artifact_type: "style_rule_seed",
            expected_artifact_type: "style_rule_seed",
            world_building_nonce: "STYLE123",
          }
        : record,
    );
    const styleRuleEvidence = findNativeSliceEvidence(
      "agent-world-building-style-rule-with-context",
      styleRuleRecords,
    );
    expect(styleRuleEvidence).toMatchObject({
      slice_id: "agent-world-building-style-rule-with-context",
      pending_artifact_id: "artifact-style",
      pending_artifact_type: "style_rule_seed",
      world_building_nonce: "STYLE123",
      key_events: keyEventsForSlice("agent-world-building-style-rule-with-context"),
    });
    expect(
      findSliceBehaviorEvidence(
        "agent-world-building-style-rule-with-context",
        styleRuleRecords,
        styleRuleEvidence,
      ),
    ).toMatchObject({
      slice_id: "agent-world-building-style-rule-with-context",
      behavior: "bounded_agent_run_world_building_profile_generates_tentative_style_rule_seed",
      assertions: expect.arrayContaining([
        "world_building_tool_produced_tentative_style_rule_seed",
      ]),
    });
  });

  it("requires middle provider execution progress for unified provider stream", () => {
    const records = [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-provider-execution-stream-unified",
        turn_id: "turn-provider-stream",
        parent_turn_id: "turn-provider-stream",
        final_turn_id: "turn-provider-stream",
        run_id: "run-provider-stream",
        plain_input_sent_from_real_workbench: true,
        ui_agent_immediate_feedback_visible: true,
        parent_fast_ack_before_final_turn_result: true,
        profile_ref: "judgment_loop_v1",
        final_turn_broadcast: true,
        final_turn_result_run_id: "run-provider-stream",
        provider_activity_api_status: 200,
        provider_activity_api_agent_run_count: 1,
        provider_progress_event_count: 30,
        provider_progress_reason_codes: [
          "provider_execution_stream",
          "provider_started",
          "provider_request_prepared",
          "provider_request_dispatched",
          "provider_response_received",
          "provider_chunk",
          "provider_final_output",
        ],
        provider_progress_visibility_developer: true,
        provider_progress_has_step_ref: true,
        provider_started_projected: true,
        provider_final_output_projected: true,
        provider_request_prepared_projected: true,
        provider_request_dispatched_projected: true,
        provider_response_received_projected: true,
        provider_chunk_projected: true,
        provider_chunk_payload_has_lengths: true,
        provider_execution_stream_projected: true,
        provider_progress_raw_content_leaked: false,
        provider_chunk_raw_content_leaked: false,
        author_reasoning_delta_event_count: 3,
        author_reasoning_delta_payload_key: "author_narrative_delta",
        mechanical_context_first: true,
        judgment_decided_visible: true,
        judgment_after_narrative: true,
        ui_author_reasoning_delta_visible: true,
        ui_author_reasoning_cumulative_delta_visible: true,
        ui_author_reasoning_stream_sample_count: 3,
        ui_author_reasoning_stream_grew: true,
        persisted_provider_facts_matched_budget: true,
        provider_run_refs: ["prun-planner", "prun-conversation"],
        provider_call_refs: ["pcall-planner", "pcall-conversation"],
        provider_purposes: ["author_reasoning", "planner"],
        consumed_provider_calls: 2,
      },
    ];

    const evidence = findNativeSliceEvidence("agent-provider-execution-stream-unified", records);

    expect(evidence).toMatchObject({
      slice_id: "agent-provider-execution-stream-unified",
      run_id: "run-provider-stream",
      provider_progress_event_count: 30,
    });
    expect(
      findSliceBehaviorEvidence("agent-provider-execution-stream-unified", records, evidence),
    ).toMatchObject({
      assertions: expect.arrayContaining([
        "assistant_work_state_was_visible_immediately_after_send",
        "provider_execution_developer_telemetry_loaded_from_scoped_agent_run_activity_api",
        "provider_execution_request_prepared_progress_was_projected",
        "provider_execution_request_dispatched_progress_was_projected",
        "provider_execution_response_received_progress_was_projected",
        "provider_execution_chunk_events_were_projected",
        "provider_execution_chunk_payload_was_redacted_telemetry_metadata",
        "author_reasoning_provider_deltas_streamed_before_first_plan",
        "ui_reasoning_area_grew_from_multiple_provider_deltas",
        "provider_execution_flow_rendered_live_phase_summary_in_dialogue_flow",
      ]),
    });

    const missingMiddleProgress = records.map((record) => ({
      ...record,
      provider_request_dispatched_projected: false,
    }));

    expect(
      findNativeSliceEvidence("agent-provider-execution-stream-unified", missingMiddleProgress),
    ).toBeNull();

    const missingChunkProgress = records.map((record) => ({
      ...record,
      provider_chunk_projected: false,
    }));

    expect(
      findNativeSliceEvidence("agent-provider-execution-stream-unified", missingChunkProgress),
    ).toBeNull();

    // Order 62 CP3 语义迁移：flow 摘要 UI 已移除，对应负例改为持久化 ProviderRun
    // 事实与预算不一致时不得放行。
    const mismatchedPersistedFacts = records.map((record) => ({
      ...record,
      persisted_provider_facts_matched_budget: false,
    }));

    expect(
      findNativeSliceEvidence("agent-provider-execution-stream-unified", mismatchedPersistedFacts),
    ).toBeNull();

    const missingReasoningStream = records.map((record) => ({
      ...record,
      author_reasoning_delta_event_count: 1,
    }));

    expect(
      findNativeSliceEvidence("agent-provider-execution-stream-unified", missingReasoningStream),
    ).toBeNull();
  });

  it("requires ProviderRun activity API evidence for restored provider execution activity", () => {
    const records = [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-provider-execution-activity-restored",
        turn_id: "turn-provider-activity",
        parent_turn_id: "turn-provider-activity",
        final_turn_id: "turn-provider-activity",
        run_id: "run-provider-activity",
        plain_input_sent_from_real_workbench: true,
        profile_ref: "conversation_turn_v1",
        final_turn_broadcast: true,
        final_turn_result_run_id: "run-provider-activity",
        restored_after_reload: true,
        transcript_agent_run_summary_only: true,
        transcript_agent_run_activity_loaded: false,
        transcript_agent_run_event_count: 0,
        transcript_provider_run_summary_count: 0,
        agent_run_activity_api_status: 200,
        agent_run_activity_api_run_count: 1,
        agent_run_activity_api_event_count: 6,
        agent_run_activity_api_provider_event_count: 4,
        agent_run_activity_api_started_restored: true,
        agent_run_activity_api_final_output_restored: true,
        agent_run_activity_api_provider_run_refs: ["prun-planner", "prun-conversation"],
        agent_run_activity_api_provider_call_refs: ["pcall-planner", "pcall-conversation"],
        agent_run_activity_api_raw_content_leaked: false,
        restored_ui_reasoning_restored: true,
        restored_ui_agent_flow_visible: true,
        restored_ui_provider_run_replay_raw_content_leaked: false,
        provider_run_activity_api_status: 200,
        provider_run_activity_api_count: 3,
        provider_run_activity_api_refs: ["prun-planner", "prun-conversation"],
        provider_run_activity_api_call_refs: ["pcall-planner", "pcall-conversation"],
        provider_run_activity_api_purposes: ["author_reasoning", "conversation"],
        provider_run_activity_api_total_tokens: 42,
        provider_run_activity_api_raw_content_leaked: false,
        reload_resume_transcript_count: 2,
      },
    ];

    const evidence = findNativeSliceEvidence("agent-provider-execution-activity-restored", records);
    expect(evidence).toMatchObject({
      slice_id: "agent-provider-execution-activity-restored",
      turn_id: "turn-provider-activity",
      run_id: "run-provider-activity",
      profile_ref: "conversation_turn_v1",
      provider_run_activity_api_count: 3,
      provider_run_activity_api_refs: ["prun-planner", "prun-conversation"],
      provider_run_activity_api_call_refs: ["pcall-planner", "pcall-conversation"],
      provider_run_activity_api_purposes: ["author_reasoning", "conversation"],
      provider_run_activity_api_total_tokens: 42,
    });
    expect(
      findSliceBehaviorEvidence("agent-provider-execution-activity-restored", records, evidence),
    ).toMatchObject({
      slice_id: "agent-provider-execution-activity-restored",
      behavior: "provider_execution_activity_lazy_loaded_from_persisted_agent_run_events",
      provider_run_activity_api_count: 3,
      assertions: expect.arrayContaining([
        "session_restore_kept_agent_run_activity_summary_only",
        "agent_run_activity_api_returned_author_safe_events_without_provider_recall",
        "restored_message_rehydrated_dialogue_flow_from_persisted_events_without_author_action",
        "provider_run_activity_api_returned_author_safe_usage_without_provider_recall",
        "persisted_provider_run_event_sequences_were_restored_via_activity_api",
        "reloaded_workbench_showed_plan_and_reasoning_inside_the_same_assistant_dialogue_flow",
      ]),
    });

    const missingApiRecords = records.map((record) => ({
      ...record,
      provider_run_activity_api_status: 404,
    }));
    expect(
      findNativeSliceEvidence("agent-provider-execution-activity-restored", missingApiRecords),
    ).toBeNull();
  });

  it("accepts session transcript lazy page evidence only after older page load", () => {
    const records = [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "agent-session-transcript-lazy-page",
        turn_id: "turn-latest",
        turn_ids: ["turn-latest"],
        work_id: "work-lazy",
        session_id: "session-lazy",
        sent_turn_count: 16,
        persisted_first_page_count: 30,
        persisted_first_page_has_more_before: true,
        persisted_first_page_before_id_present: true,
        older_transcript_api_status: 200,
        older_transcript_api_count: 2,
        older_transcript_api_first_message_visible: true,
        older_assistant_turn_id: "turn-oldest",
        older_transcript_agent_run_summary_only: true,
        older_agent_run_activity_api_status: 200,
        older_agent_run_activity_api_run_count: 1,
        older_provider_run_activity_api_event_count: 4,
        older_provider_run_activity_api_count: 3,
        older_provider_run_activity_api_purposes: ["author_reasoning", "conversation"],
        older_agent_run_activity_api_raw_content_leaked: false,
        reload_resume_transcript_count: 30,
        restored_latest_message_visible: true,
        restored_oldest_message_hidden_before_load: true,
        load_older_button_visible: true,
        older_message_visible_after_load: true,
        load_older_button_hidden_after_exhausted: true,
        provider_recalled_during_load_older: false,
        older_ui_agent_flow_visible: true,
        older_ui_provider_run_replay_raw_content_leaked: false,
        provider_recalled_during_older_activity_expand: false,
      },
    ];

    const evidence = findNativeSliceEvidence("agent-session-transcript-lazy-page", records);
    expect(evidence).toMatchObject({
      slice_id: "agent-session-transcript-lazy-page",
      turn_id: "turn-latest",
      work_id: "work-lazy",
      session_id: "session-lazy",
      persisted_first_page_count: 30,
      older_transcript_api_count: 2,
      older_assistant_turn_id: "turn-oldest",
      older_provider_run_activity_api_event_count: 4,
      older_provider_run_activity_api_count: 3,
      provider_recalled_during_load_older: false,
      provider_recalled_during_older_activity_expand: false,
    });
    expect(
      findSliceBehaviorEvidence("agent-session-transcript-lazy-page", records, evidence),
    ).toMatchObject({
      slice_id: "agent-session-transcript-lazy-page",
      behavior: "session_transcript_restored_as_latest_page_and_older_page_loaded_on_author_action",
      assertions: expect.arrayContaining([
        "session_resume_returned_latest_transcript_page_only",
        "older_transcript_page_was_loaded_by_author_visible_action",
        "loading_older_transcript_did_not_recall_provider",
        "older_assistant_activity_loaded_from_scoped_agent_run_activity_api",
        "older_assistant_work_details_expanded_inside_same_dialogue_flow",
        "expanding_older_assistant_activity_did_not_recall_provider",
      ]),
    });

    const providerRecallRecords = records.map((record) => ({
      ...record,
      provider_recalled_during_load_older: true,
    }));
    expect(
      findNativeSliceEvidence("agent-session-transcript-lazy-page", providerRecallRecords),
    ).toBeNull();

    const missingOlderActivityRecords = records.map((record) => ({
      ...record,
      older_agent_run_activity_api_status: 404,
    }));
    expect(
      findNativeSliceEvidence("agent-session-transcript-lazy-page", missingOlderActivityRecords),
    ).toBeNull();

    const providerRecallOnExpandRecords = records.map((record) => ({
      ...record,
      provider_recalled_during_older_activity_expand: true,
    }));
    expect(
      findNativeSliceEvidence("agent-session-transcript-lazy-page", providerRecallOnExpandRecords),
    ).toBeNull();
  });

  it("accepts AU-04 confirm-before-execute only when the real confirmation card explains the boundary", () => {
    const records = au04ConfirmBeforeExecuteRecords();

    const evidence = findNativeSliceEvidence("au04-confirm-before-execute", records);
    expect(evidence).toMatchObject({
      slice_id: "au04-confirm-before-execute",
      turn_id: "turn-au04-confirm",
      confirm_turn_id: "turn-au04-confirm",
      executed_turn_id: "turn-au04-confirm",
      artifact_id: "artifact-au04-confirm",
      artifact_type: "prose_fragment",
      confirm_action_behavior_ref: "behavior-au04-confirm",
      confirmation_card_detail_visible: true,
      confirmation_card_target_visible: true,
      confirmation_card_no_write_visible: true,
      confirmation_card_re_gate_visible: true,
      key_events: keyEventsForSlice("au04-confirm-before-execute"),
    });
    expect(findSliceBehaviorEvidence("au04-confirm-before-execute", records, evidence)).toEqual({
      slice_id: "au04-confirm-before-execute",
      behavior:
        "high_risk_user_turn_requires_confirmation_then_binding_re_gate_executes_tentatively",
      turn_ids: ["turn-au04-confirm"],
      artifact_id: "artifact-au04-confirm",
      confirm_action_behavior_ref: "behavior-au04-confirm",
      assertions: [
        "high_risk_rewrite_blocked_with_confirmation_card_over_real_wire",
        "confirmation_card_explains_target_no_write_and_re_gate_in_real_workbench",
        "no_tool_call_or_production_write_before_confirm",
        "confirm_action_bound_to_open_confirmation_behavior",
        "re_gate_allows_and_dispatches_prose_writing_same_turn",
        "executed_output_stays_tentative_pending_adoption",
      ],
    });
  });

  it("accepts AU-07 why entry when the current author-safe dialog opens without internal trace text", () => {
    const records = [
      {
        event: "channel.user_message.start",
        turn_id: "turn-au07",
        workspace_id: "work-au07",
        work_id: "work-au07",
        session_id: "session-au07",
        generate_micro_plan: false,
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "dialogue_gateway.handle_input.start",
        turn_id: "turn-au07",
        workspace_id: "work-au07",
        work_id: "work-au07",
        session_id: "session-au07",
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-au07",
        workspace_id: "work-au07",
        work_id: "work-au07",
        session_id: "session-au07",
        duration_ms: 3,
        outcome: "done",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-au07",
        workspace_id: "work-au07",
        work_id: "work-au07",
        session_id: "session-au07",
        duration_ms: 10,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-au07",
        workspace_id: "work-au07",
        work_id: "work-au07",
        session_id: "session-au07",
        duration_ms: 12,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au07-trace-why-entry",
        turn_id: "turn-au07",
        workspace_id: "work-au07",
        work_id: "work-au07",
        session_id: "session-au07",
        trace_why_dialog_open: true,
        trace_why_text:
          "AI 回应 你提出的是讨论或解释请求，系统没有执行写入动作。参考来源 当前会话记录 解释来自本轮已保存的 trace 摘要，不会重新调用模型或改写作品。",
        trace_why_contains_raw_prompt: false,
        replay_provider_called: false,
        production_write_performed: false,
        tool_called: false,
      },
    ];

    const evidence = findNativeSliceEvidence("au07-trace-why-entry", records);
    expect(evidence).toEqual({
      slice_id: "au07-trace-why-entry",
      turn_id: "turn-au07",
      turn_ids: ["turn-au07"],
      work_id: "work-au07",
      session_id: "session-au07",
      key_events: keyEventsForSlice("au07-trace-why-entry"),
    });
    expect(findSliceBehaviorEvidence("au07-trace-why-entry", records, evidence)).toEqual({
      slice_id: "au07-trace-why-entry",
      behavior: "author_opens_trace_why_dialog_from_real_workbench_message",
      turn_ids: ["turn-au07"],
      work_id: "work-au07",
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
    });
  });

  it("accepts AU-07 gate reason why only when downgrade explanation is author-safe", () => {
    const records = [
      {
        event: "channel.user_message.start",
        turn_id: "turn-au07-gate",
        workspace_id: "work-au07-gate",
        work_id: "work-au07-gate",
        session_id: "session-au07-gate",
        generate_micro_plan: true,
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "dialogue_gateway.handle_input.start",
        turn_id: "turn-au07-gate",
        workspace_id: "work-au07-gate",
        work_id: "work-au07-gate",
        session_id: "session-au07-gate",
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-au07-gate",
        workspace_id: "work-au07-gate",
        work_id: "work-au07-gate",
        session_id: "session-au07-gate",
        duration_ms: 4,
        outcome: "done",
      },
      {
        event: "planner.form_micro_plan.done",
        turn_id: "turn-au07-gate",
        workspace_id: "work-au07-gate",
        work_id: "work-au07-gate",
        session_id: "session-au07-gate",
        duration_ms: 5,
        outcome: "done",
      },
      {
        event: "orchestrator.decide.done",
        turn_id: "turn-au07-gate",
        workspace_id: "work-au07-gate",
        work_id: "work-au07-gate",
        session_id: "session-au07-gate",
        decision_type: "downgrade_to_dialogue",
        first_blocking_gate: "action_scope",
        duration_ms: 1,
        outcome: "done",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-au07-gate",
        workspace_id: "work-au07-gate",
        work_id: "work-au07-gate",
        session_id: "session-au07-gate",
        duration_ms: 20,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-au07-gate",
        workspace_id: "work-au07-gate",
        work_id: "work-au07-gate",
        session_id: "session-au07-gate",
        duration_ms: 21,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au07-gate-reason-why",
        turn_id: "turn-au07-gate",
        workspace_id: "work-au07-gate",
        work_id: "work-au07-gate",
        session_id: "session-au07-gate",
        generate_micro_plan: true,
        downgrade_decision_received: true,
        decision_type: "downgrade_to_dialogue",
        first_blocking_gate: "action_scope",
        execution_blocked: true,
        tool_called: false,
        production_write_performed: false,
        action_scope_reason_present: true,
        no_toolbox_execute_event: true,
        no_author_action_sent: true,
        no_execution_controls_visible: true,
        downgrade_badge_visible: true,
        generation_badge_absent: true,
        trace_why_dialog_open: true,
        trace_why_text:
          "降级为对话 当前请求超出本轮可执行范围。系统先评估了执行计划，再按权限和范围决定是否继续。参考来源 当前会话记录 回放只读取已保存记录，不会重新调用模型。",
        trace_why_contains_raw_prompt: false,
        why_shows_downgrade_decision: true,
        why_shows_action_scope_gate: true,
        why_shows_micro_plan_evaluated: true,
        why_shows_no_provider_replay: true,
        why_hides_internal_gate_code: true,
        replay_provider_called: false,
      },
    ];

    const evidence = findNativeSliceEvidence("au07-gate-reason-why", records);
    expect(evidence).toEqual({
      slice_id: "au07-gate-reason-why",
      turn_id: "turn-au07-gate",
      turn_ids: ["turn-au07-gate"],
      work_id: "work-au07-gate",
      session_id: "session-au07-gate",
      decision_type: "downgrade_to_dialogue",
      first_blocking_gate: "action_scope",
      key_events: keyEventsForSlice("au07-gate-reason-why"),
    });
    expect(findSliceBehaviorEvidence("au07-gate-reason-why", records, evidence)).toEqual({
      slice_id: "au07-gate-reason-why",
      behavior: "gate_downgrade_why_explains_action_scope_without_raw_leak",
      turn_ids: ["turn-au07-gate"],
      work_id: "work-au07-gate",
      session_id: "session-au07-gate",
      decision_type: "downgrade_to_dialogue",
      first_blocking_gate: "action_scope",
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
    });
  });

  it("accepts AU-07 persisted trace query only with scoped replay API evidence", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-au07-replay",
        session_id: "session-au07-replay",
        transcript_count: 2,
      },
      {
        event: "channel.user_message.start",
        turn_id: "turn-au07-replay",
        workspace_id: "work-au07-replay",
        work_id: "work-au07-replay",
        session_id: "session-au07-replay",
        generate_micro_plan: false,
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-au07-replay",
        workspace_id: "work-au07-replay",
        work_id: "work-au07-replay",
        session_id: "session-au07-replay",
        duration_ms: 10,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-au07-replay",
        workspace_id: "work-au07-replay",
        work_id: "work-au07-replay",
        session_id: "session-au07-replay",
        duration_ms: 12,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au07-persisted-trace-query",
        turn_id: "turn-au07-replay",
        turn_ids: ["turn-au07-replay"],
        workspace_id: "work-au07-replay",
        work_id: "work-au07-replay",
        session_id: "session-au07-replay",
        persisted_trace_query_status: 200,
        persisted_trace_query_scoped: true,
        restored_after_reload: true,
        replay_report_provider_called: false,
        replay_summary_provider_called: false,
        replay_report_result_status: "complete",
        persisted_replay_detail_visible: true,
        replay_no_provider_visible: true,
        trace_why_dialog_open: true,
        trace_why_text:
          "AI 回应 已从持久 trace 生成结构化回放。回放只读取已保存记录，不会重新调用模型。参考来源 当前会话记录",
        trace_why_contains_raw_prompt: false,
        production_write_performed: false,
        tool_called: false,
      },
    ];

    const evidence = findNativeSliceEvidence("au07-persisted-trace-query", records);
    expect(evidence).toMatchObject({
      slice_id: "au07-persisted-trace-query",
      turn_id: "turn-au07-replay",
      turn_ids: ["turn-au07-replay"],
      work_id: "work-au07-replay",
      session_id: "session-au07-replay",
      replay_report_result_status: "complete",
      key_events: keyEventsForSlice("au07-persisted-trace-query"),
    });
    expect(findSliceBehaviorEvidence("au07-persisted-trace-query", records, evidence)).toEqual({
      slice_id: "au07-persisted-trace-query",
      behavior: "old_turn_why_uses_scoped_persisted_replay_query",
      turn_ids: ["turn-au07-replay"],
      work_id: "work-au07-replay",
      session_id: "session-au07-replay",
      replay_report_result_status: "complete",
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
    });

    const unsafeRecords = records.map((record) =>
      record.slice_id === "au07-persisted-trace-query"
        ? { ...record, persisted_trace_query_scoped: false }
        : record,
    );
    expect(findNativeSliceEvidence("au07-persisted-trace-query", unsafeRecords)).toBeNull();
  });

  it("accepts AU-07 partial replay UI only when the old-turn dialog renders partial status", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-au07-partial",
        session_id: "session-au07-partial",
        transcript_count: 2,
      },
      {
        event: "channel.user_message.start",
        turn_id: "turn-au07-partial",
        workspace_id: "work-au07-partial",
        work_id: "work-au07-partial",
        session_id: "session-au07-partial",
        generate_micro_plan: false,
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-au07-partial",
        workspace_id: "work-au07-partial",
        work_id: "work-au07-partial",
        session_id: "session-au07-partial",
        duration_ms: 10,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-au07-partial",
        workspace_id: "work-au07-partial",
        work_id: "work-au07-partial",
        session_id: "session-au07-partial",
        duration_ms: 12,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au07-partial-replay-ui",
        turn_id: "turn-au07-partial",
        turn_ids: ["turn-au07-partial"],
        workspace_id: "work-au07-partial",
        work_id: "work-au07-partial",
        session_id: "session-au07-partial",
        persisted_trace_query_status: 200,
        persisted_trace_query_scoped: true,
        restored_after_reload: true,
        replay_report_provider_called: false,
        replay_summary_provider_called: false,
        replay_report_result_status: "partial",
        replay_report_missing_trace_refs: ["turn_result_ref", "tool_trace_refs"],
        replay_partial_visible: true,
        replay_no_provider_visible: true,
        trace_why_dialog_open: true,
        trace_why_text:
          "AI 回应 这轮 trace 不完整，只展示已保存的部分解释。回放只读取已保存记录，不会重新调用模型。参考来源 当前会话记录",
        trace_why_contains_raw_prompt: false,
        production_write_performed: false,
        tool_called: false,
      },
    ];

    const evidence = findNativeSliceEvidence("au07-partial-replay-ui", records);
    expect(evidence).toMatchObject({
      slice_id: "au07-partial-replay-ui",
      turn_id: "turn-au07-partial",
      turn_ids: ["turn-au07-partial"],
      work_id: "work-au07-partial",
      session_id: "session-au07-partial",
      replay_report_result_status: "partial",
      replay_report_missing_trace_refs: ["turn_result_ref", "tool_trace_refs"],
      key_events: keyEventsForSlice("au07-partial-replay-ui"),
    });
    expect(findSliceBehaviorEvidence("au07-partial-replay-ui", records, evidence)).toEqual({
      slice_id: "au07-partial-replay-ui",
      behavior: "old_turn_partial_replay_is_rendered_honestly_without_provider_or_write",
      turn_ids: ["turn-au07-partial"],
      work_id: "work-au07-partial",
      session_id: "session-au07-partial",
      replay_report_result_status: "partial",
      replay_report_missing_trace_refs: ["turn_result_ref", "tool_trace_refs"],
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
    });

    const unsafeRecords = records.map((record) =>
      record.slice_id === "au07-partial-replay-ui"
        ? { ...record, replay_report_missing_trace_refs: [] }
        : record,
    );
    expect(findNativeSliceEvidence("au07-partial-replay-ui", unsafeRecords)).toBeNull();
  });

  it("accepts AU-07 trace query scope negative matrix only when cross-scope requests are rejected", () => {
    const negativeMatrix = {
      foreign_work_with_source_session: {
        status: 404,
        error: "session_not_found",
        leaked_trace_summary: false,
        leaked_replay_report: false,
      },
      source_work_with_foreign_session: {
        status: 404,
        error: "session_not_found",
        leaked_trace_summary: false,
        leaked_replay_report: false,
      },
      source_work_with_same_work_other_session: {
        status: 404,
        error: "trace_not_found",
        leaked_trace_summary: false,
        leaked_replay_report: false,
      },
      source_scope_with_missing_turn: {
        status: 404,
        error: "trace_not_found",
        leaked_trace_summary: false,
        leaked_replay_report: false,
      },
    };
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-au07-scope",
        session_id: "session-au07-scope",
        transcript_count: 2,
      },
      {
        event: "channel.user_message.start",
        turn_id: "turn-au07-scope",
        workspace_id: "work-au07-scope",
        work_id: "work-au07-scope",
        session_id: "session-au07-scope",
        generate_micro_plan: false,
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-au07-scope",
        workspace_id: "work-au07-scope",
        work_id: "work-au07-scope",
        session_id: "session-au07-scope",
        duration_ms: 10,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-au07-scope",
        workspace_id: "work-au07-scope",
        work_id: "work-au07-scope",
        session_id: "session-au07-scope",
        duration_ms: 12,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au07-trace-query-scope-negative-matrix",
        turn_id: "turn-au07-scope",
        turn_ids: ["turn-au07-scope"],
        workspace_id: "work-au07-scope",
        work_id: "work-au07-scope",
        session_id: "session-au07-scope",
        valid_replay_status: 200,
        valid_replay_scoped: true,
        valid_replay_provider_called: false,
        restored_after_reload: true,
        cross_work_replay_rejected: true,
        cross_session_replay_rejected: true,
        same_work_other_session_replay_rejected: true,
        missing_turn_replay_rejected: true,
        negative_errors_hidden_from_ui: true,
        negative_responses_leaked_trace: false,
        negative_replay_matrix: negativeMatrix,
        foreign_work_id: "work-au07-foreign",
        foreign_session_id: "session-au07-foreign",
        same_work_other_session_id: "session-au07-other",
        production_write_performed: false,
        tool_called: false,
      },
    ];

    const evidence = findNativeSliceEvidence("au07-trace-query-scope-negative-matrix", records);
    expect(evidence).toMatchObject({
      slice_id: "au07-trace-query-scope-negative-matrix",
      turn_id: "turn-au07-scope",
      turn_ids: ["turn-au07-scope"],
      work_id: "work-au07-scope",
      session_id: "session-au07-scope",
      foreign_work_id: "work-au07-foreign",
      foreign_session_id: "session-au07-foreign",
      same_work_other_session_id: "session-au07-other",
      negative_replay_matrix: negativeMatrix,
      key_events: keyEventsForSlice("au07-trace-query-scope-negative-matrix"),
    });
    expect(
      findSliceBehaviorEvidence("au07-trace-query-scope-negative-matrix", records, evidence),
    ).toEqual({
      slice_id: "au07-trace-query-scope-negative-matrix",
      behavior: "trace_replay_query_rejects_cross_scope_without_trace_leak",
      turn_ids: ["turn-au07-scope"],
      work_id: "work-au07-scope",
      session_id: "session-au07-scope",
      foreign_work_id: "work-au07-foreign",
      foreign_session_id: "session-au07-foreign",
      same_work_other_session_id: "session-au07-other",
      negative_replay_matrix: negativeMatrix,
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
    });

    const unsafeRecords = records.map((record) =>
      record.slice_id === "au07-trace-query-scope-negative-matrix"
        ? { ...record, negative_responses_leaked_trace: true }
        : record,
    );
    expect(
      findNativeSliceEvidence("au07-trace-query-scope-negative-matrix", unsafeRecords),
    ).toBeNull();
  });

  it("accepts AU-04 rapid confirm click evidence only when execution stays single-shot", () => {
    const records = au04ConfirmIdempotencyUiRecords();

    const evidence = findNativeSliceEvidence("au04-confirm-idempotency-ui", records);
    expect(evidence).toMatchObject({
      slice_id: "au04-confirm-idempotency-ui",
      turn_id: "turn-au04-idem",
      confirm_turn_id: "turn-au04-idem",
      artifact_id: "artifact-au04-idem",
      artifact_type: "prose_fragment",
      confirm_action_behavior_ref: "behavior-au04-idem",
      confirm_action_id: "confirm-au04-idem",
      confirm_action_idempotency_key: "idem-au04-idem",
      sent_confirm_action_count: 2,
      author_action_done_count: 2,
      duplicate_author_action_done_count: 1,
      duplicate_action_result_count: 1,
      toolbox_execute_count: 1,
      pending_prose_fragment_count: 1,
      key_events: keyEventsForSlice("au04-confirm-idempotency-ui"),
    });
    expect(findSliceBehaviorEvidence("au04-confirm-idempotency-ui", records, evidence)).toEqual({
      slice_id: "au04-confirm-idempotency-ui",
      behavior: "rapid_confirm_click_is_suppressed_or_deduped_without_duplicate_execution",
      turn_ids: ["turn-au04-idem"],
      artifact_id: "artifact-au04-idem",
      confirm_action_behavior_ref: "behavior-au04-idem",
      sent_confirm_action_count: 2,
      duplicate_author_action_done_count: 1,
      duplicate_action_result_count: 1,
      assertions: [
        "real_workbench_attempted_rapid_confirm_from_visible_confirmation_card",
        "action_boundary_accepted_exactly_one_non_duplicate_confirmation",
        "duplicate_confirm_was_suppressed_or_reported_as_duplicate",
        "re_gate_dispatched_prose_writing_exactly_once",
        "executed_output_stayed_single_tentative_pending_artifact",
      ],
    });
  });

  it("accepts AU-04 confirmation tool failure evidence only when recovery is visible and no draft is produced", () => {
    const records = au04ConfirmationToolFailureRecoveryRecords();

    const evidence = findNativeSliceEvidence("au04-confirmation-tool-failure-recovery", records);
    expect(evidence).toMatchObject({
      slice_id: "au04-confirmation-tool-failure-recovery",
      turn_id: "turn-au04-tool-failure",
      confirm_turn_id: "turn-au04-tool-failure",
      failed_turn_id: "turn-au04-tool-failure",
      confirm_action_behavior_ref: "behavior-au04-tool-failure",
      confirm_action_id: "confirm-au04-tool-failure",
      failed_tool_name: "prose_writing",
      failed_tool_status: "failed",
      provider_error_count: 1,
      toolbox_execute_error_count: 1,
      pending_prose_fragment_after_failure_count: 0,
      key_events: keyEventsForSlice("au04-confirmation-tool-failure-recovery"),
    });
    expect(
      findSliceBehaviorEvidence("au04-confirmation-tool-failure-recovery", records, evidence),
    ).toEqual({
      slice_id: "au04-confirmation-tool-failure-recovery",
      behavior: "confirmed_tool_failure_recovers_without_pending_draft_or_production_write",
      turn_ids: ["turn-au04-tool-failure"],
      confirm_action_behavior_ref: "behavior-au04-tool-failure",
      failed_tool_name: "prose_writing",
      failed_tool_status: "failed",
      provider_error_count: 1,
      toolbox_execute_error_count: 1,
      assertions: [
        "real_workbench_received_high_risk_confirmation_card",
        "confirm_before_execute_was_sent_as_author_action",
        "confirmation_re_gate_attempted_tool_dispatch",
        "provider_failure_returned_failed_tool_result",
        "ui_rendered_author_readable_failure_message",
        "failed_confirmation_execution_created_no_pending_draft",
        "failed_confirmation_execution_claimed_no_production_write",
      ],
    });
  });

  it("accepts AU-04 stale confirmation evidence only when old confirm cannot execute", () => {
    const records = au04StaleConfirmationUiRecords();

    const evidence = findNativeSliceEvidence("au04-stale-confirmation-ui", records);
    expect(evidence).toMatchObject({
      slice_id: "au04-stale-confirmation-ui",
      turn_id: "turn-au04-stale-confirm",
      confirm_turn_id: "turn-au04-stale-confirm",
      followup_turn_id: "turn-au04-followup",
      confirm_action_behavior_ref: "behavior-au04-stale",
      stale_confirm_visible: true,
      stale_confirm_click_attempted: true,
      stale_confirm_action_sent: true,
      stale_confirm_rejected: true,
      author_action_error_count: 1,
      toolbox_execute_after_stale_count: 0,
      pending_prose_fragment_after_stale_count: 0,
      key_events: keyEventsForSlice("au04-stale-confirmation-ui"),
    });
    expect(findSliceBehaviorEvidence("au04-stale-confirmation-ui", records, evidence)).toEqual({
      slice_id: "au04-stale-confirmation-ui",
      behavior: "stale_confirmation_after_context_change_cannot_execute_tool_or_create_draft",
      turn_ids: ["turn-au04-stale-confirm", "turn-au04-followup"],
      confirm_action_behavior_ref: "behavior-au04-stale",
      stale_confirm_visible: true,
      stale_confirm_click_attempted: true,
      stale_confirm_action_sent: true,
      stale_confirm_rejected: true,
      author_action_error_count: 1,
      assertions: [
        "real_workbench_received_high_risk_confirmation_card",
        "a_followup_user_message_advanced_the_current_turn_before_confirmation",
        "old_confirmation_was_hidden_disabled_or_rejected_as_stale",
        "stale_confirmation_did_not_dispatch_prose_writing",
        "stale_confirmation_did_not_create_pending_prose_fragment",
      ],
    });
  });

  it("accepts AU-06 single active confirmation evidence only when the old behavior cannot execute", () => {
    const records = au06SingleActiveConfirmationRecords();

    const evidence = findNativeSliceEvidence("au06-single-active-confirmation", records);
    expect(evidence).toMatchObject({
      slice_id: "au06-single-active-confirmation",
      turn_id: "turn-au06-second-confirm",
      first_confirm_turn_id: "turn-au06-first-confirm",
      second_confirm_turn_id: "turn-au06-second-confirm",
      first_confirm_action_behavior_ref: "behavior-au06-first",
      second_confirm_action_behavior_ref: "behavior-au06-second",
      second_turn_behavior_context_ref_visible: true,
      second_turn_behavior_context_author_safe: true,
      second_turn_behavior_context_summary:
        "当前有待作者确认的操作：章节正文草稿；确认或取消前不能执行工具或写入作品事实。",
      second_turn_behavior_context_redaction_level: "author_safe",
      second_turn_behavior_context_ref: "ctx-au06-behavior",
      second_turn_behavior_context_source_id: "",
      old_confirm_prevented: true,
      old_confirm_rejected: true,
      old_author_action_error_count: 1,
      toolbox_execute_after_old_count: 0,
      pending_prose_fragment_after_old_count: 0,
      latest_toolbox_execute_count: 1,
      key_events: keyEventsForSlice("au06-single-active-confirmation"),
    });
    expect(findSliceBehaviorEvidence("au06-single-active-confirmation", records, evidence)).toEqual(
      {
        slice_id: "au06-single-active-confirmation",
        behavior: "new_confirmation_supersedes_old_author_blocking_behavior_without_old_execution",
        turn_ids: ["turn-au06-first-confirm", "turn-au06-second-confirm"],
        first_confirm_action_behavior_ref: "behavior-au06-first",
        second_confirm_action_behavior_ref: "behavior-au06-second",
        second_turn_behavior_context_ref_visible: true,
        second_turn_behavior_context_author_safe: true,
        second_turn_behavior_context_summary:
          "当前有待作者确认的操作：章节正文草稿；确认或取消前不能执行工具或写入作品事实。",
        second_turn_behavior_context_redaction_level: "author_safe",
        second_turn_behavior_context_ref: "ctx-au06-behavior",
        second_turn_behavior_context_source_id: "",
        old_confirm_prevented: true,
        old_confirm_rejected: true,
        old_author_action_error_count: 1,
        latest_toolbox_execute_count: 1,
        assertions: [
          "first_high_risk_turn_opened_confirmation_in_real_workbench",
          "second_high_risk_turn_advanced_to_a_distinct_active_confirmation",
          "old_confirmation_was_hidden_disabled_or_rejected_as_stale",
          "old_confirmation_did_not_dispatch_tool_or_create_pending_draft",
          "latest_confirmation_remained_actionable_and_executed_once",
          "second_turn_received_author_safe_behavior_context_ref",
        ],
      },
    );
  });

  it("accepts AU-04 expired confirmation evidence only when it cannot execute", () => {
    const records = au04ConfirmationTtlUiRecords();

    const evidence = findNativeSliceEvidence("au04-confirmation-ttl-ui", records);
    expect(evidence).toMatchObject({
      slice_id: "au04-confirmation-ttl-ui",
      turn_id: "turn_au04_expired_confirmation_seed",
      expired_confirm_action_sent: true,
      expired_confirm_rejected: true,
      author_action_error_count: 1,
      toolbox_execute_after_expired_count: 0,
      pending_prose_fragment_after_expired_count: 0,
      key_events: keyEventsForSlice("au04-confirmation-ttl-ui"),
    });
    expect(findSliceBehaviorEvidence("au04-confirmation-ttl-ui", records, evidence)).toEqual({
      slice_id: "au04-confirmation-ttl-ui",
      behavior: "expired_confirmation_cannot_execute_tool_or_create_draft",
      turn_ids: ["turn_au04_expired_confirmation_seed"],
      expired_confirm_action_sent: true,
      expired_confirm_rejected: true,
      author_action_error_count: 1,
      assertions: [
        "expired_confirmation_card_restored_in_real_workbench",
        "real_workbench_sent_expired_confirm_author_action",
        "action_boundary_rejected_expired_confirmation",
        "expired_confirmation_did_not_dispatch_prose_writing",
        "expired_confirmation_did_not_create_pending_prose_fragment",
      ],
    });
  });

  it("accepts AU-04 disabled confirmation evidence only when UI blocks submission", () => {
    const records = au04DisabledConfirmationActionUiRecords();

    const evidence = findNativeSliceEvidence("au04-disabled-confirmation-action-ui", records);
    expect(evidence).toMatchObject({
      slice_id: "au04-disabled-confirmation-action-ui",
      turn_id: "turn_au04_disabled_confirmation_seed",
      work_id: "work-au04-disabled",
      session_id: "session-au04-disabled",
      disabled_confirm_button_count: 1,
      reject_button_count: 1,
      author_action_sent_count: 0,
      channel_author_action_log_count: 0,
      toolbox_execute_after_disabled_attempt_count: 0,
      pending_prose_fragment_after_disabled_attempt_count: 0,
      key_events: keyEventsForSlice("au04-disabled-confirmation-action-ui"),
    });
    expect(
      findSliceBehaviorEvidence("au04-disabled-confirmation-action-ui", records, evidence),
    ).toEqual({
      slice_id: "au04-disabled-confirmation-action-ui",
      behavior: "disabled_confirmation_action_is_visible_but_not_submittable",
      turn_ids: ["turn_au04_disabled_confirmation_seed"],
      work_id: "work-au04-disabled",
      session_id: "session-au04-disabled",
      disabled_confirm_title: "当前作品状态已变化，请重新生成计划后再确认。",
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
    });
  });

  it("accepts AU-04 history confirmation evidence only when readonly cannot execute", () => {
    const records = au04HistoryConfirmationReadonlyRecords();

    const evidence = findNativeSliceEvidence("au04-history-confirmation-readonly", records);
    expect(evidence).toMatchObject({
      slice_id: "au04-history-confirmation-readonly",
      turn_id: "turn_au04_history_confirmation_seed",
      work_id: "work-au04",
      session_id: "session-history-au04",
      readonly_transcript_count: 2,
      history_confirmation_actions_hidden: true,
      no_author_action_sent: true,
      no_tool_dispatch_from_history: true,
      no_pending_artifact_from_history: true,
      key_events: keyEventsForSlice("au04-history-confirmation-readonly"),
    });
    expect(
      findSliceBehaviorEvidence("au04-history-confirmation-readonly", records, evidence),
    ).toEqual({
      slice_id: "au04-history-confirmation-readonly",
      behavior: "history_confirmation_readonly_cannot_execute_tool_or_create_draft",
      turn_ids: ["turn_au04_history_confirmation_seed"],
      work_id: "work-au04",
      session_id: "session-history-au04",
      readonly_transcript_count: 2,
      assertions: [
        "historical_confirmation_transcript_opened_from_real_workbench",
        "exited_session_opened_as_read_only",
        "confirmation_actions_hidden_in_history_view",
        "readonly_history_did_not_send_author_action",
        "readonly_history_did_not_dispatch_tool",
        "readonly_history_did_not_create_pending_draft",
        "active_session_view_can_be_restored",
      ],
    });
  });

  it("accepts AU-04 cross-work confirmation evidence only when target work cannot execute source action", () => {
    const records = au04CrossWorkConfirmationGuardRecords();

    const evidence = findNativeSliceEvidence("au04-cross-work-confirmation-guard", records);
    expect(evidence).toMatchObject({
      slice_id: "au04-cross-work-confirmation-guard",
      turn_id: "turn_au04_cross_work_confirmation_seed",
      source_work_id: "work-au04-source",
      target_work_id: "work-au04-target",
      source_confirmation_hidden_in_target: true,
      target_confirm_button_count: 0,
      target_reject_button_count: 0,
      author_action_sent_count: 0,
      toolbox_execute_after_cross_work_switch_count: 0,
      pending_prose_fragment_after_cross_work_switch_count: 0,
      key_events: keyEventsForSlice("au04-cross-work-confirmation-guard"),
    });
    expect(
      findSliceBehaviorEvidence("au04-cross-work-confirmation-guard", records, evidence),
    ).toEqual({
      slice_id: "au04-cross-work-confirmation-guard",
      behavior: "cross_work_switch_hides_source_confirmation_without_action_or_draft",
      turn_ids: ["turn_au04_cross_work_confirmation_seed"],
      source_work_id: "work-au04-source",
      target_work_id: "work-au04-target",
      assertions: [
        "source_work_confirmation_card_visible_before_switch",
        "target_work_selected_through_real_work_menu",
        "source_confirmation_not_visible_or_actionable_in_target_work",
        "cross_work_switch_did_not_send_author_action",
        "cross_work_switch_did_not_dispatch_tool",
        "cross_work_switch_did_not_create_pending_draft",
        "source_confirmation_restored_when_returning_to_source_work",
      ],
    });
  });

  it("accepts AU-04 latest-context rebase evidence only when confirm consumes renamed work snapshot", () => {
    const records = au04LatestContextRebaseConfirmationRecords();

    const evidence = findNativeSliceEvidence("au04-latest-context-rebase-confirmation", records);
    expect(evidence).toMatchObject({
      slice_id: "au04-latest-context-rebase-confirmation",
      turn_id: "turn_au04_latest_context_rebase_seed",
      work_id: "work-au04-rebase",
      renamed_title: "AU04 最新上下文已改名",
      renamed_revision: 2,
      confirmation_binding_ref:
        "state_snapshot:work-au04-rebase:session-au04-rebase:revision:2:turn_au04_latest_context_rebase_seed:plan_au04_latest_context_rebase:in_1",
      toolbox_execute_count: 1,
      pending_character_seed_count: 1,
      key_events: keyEventsForSlice("au04-latest-context-rebase-confirmation"),
    });
    expect(
      findSliceBehaviorEvidence("au04-latest-context-rebase-confirmation", records, evidence),
    ).toEqual({
      slice_id: "au04-latest-context-rebase-confirmation",
      behavior: "confirmation_re_gate_rebases_against_latest_work_snapshot",
      turn_ids: ["turn_au04_latest_context_rebase_seed"],
      work_id: "work-au04-rebase",
      renamed_title: "AU04 最新上下文已改名",
      renamed_revision: 2,
      confirmation_binding_ref:
        "state_snapshot:work-au04-rebase:session-au04-rebase:revision:2:turn_au04_latest_context_rebase_seed:plan_au04_latest_context_rebase:in_1",
      assertions: [
        "real_workbench_restored_confirmation_card",
        "work_was_renamed_through_real_work_menu_before_confirmation",
        "confirmation_binding_ref_included_latest_work_revision",
        "confirmed_turn_trace_current_work_summary_included_renamed_title",
        "confirmed_turn_reason_codes_recorded_rebased_snapshot_and_gate_ref",
        "re_gate_dispatched_tool_and_left_output_pending_adoption",
      ],
    });
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

  it("accepts SU-01 API key redaction evidence only when secret surfaces stay clean", () => {
    const records = [
      { event: "channel.join.done", work_id: "work-su01-key", session_id: "session-su01-key" },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-api-key-secret-redaction",
        work_id: "work-su01-key",
        context_work_id: "work-su01-key",
        socket_connected: true,
        provider_selected: "deepseek",
        model_selected: "deepseek-slice-keychain",
        test_connection_succeeded: true,
        provider_switch_saved: true,
        provider_options_api_key_configured: true,
        provider_options_omits_api_key: true,
        browser_settings_omits_api_key: true,
        visible_text_omits_api_key: true,
        app_log_omits_api_key: true,
        backend_log_omits_api_key: true,
        model_provider_button_text: "DeepSeek · deepseek-slice-keychain",
      },
    ];

    const evidence = findNativeSliceEvidence("su01-api-key-secret-redaction", records);
    expect(evidence).toEqual({
      slice_id: "su01-api-key-secret-redaction",
      turn_ids: [],
      work_id: "work-su01-key",
      provider_selected: "deepseek",
      model_selected: "deepseek-slice-keychain",
      model_provider_button_text: "DeepSeek · deepseek-slice-keychain",
      key_events: keyEventsForSlice("su01-api-key-secret-redaction"),
    });
    expect(findSliceBehaviorEvidence("su01-api-key-secret-redaction", records, evidence)).toEqual({
      slice_id: "su01-api-key-secret-redaction",
      behavior: "provider_api_key_flow_redacts_secret_from_user_visible_and_plain_logs",
      turn_ids: [],
      work_id: "work-su01-key",
      provider_selected: "deepseek",
      model_selected: "deepseek-slice-keychain",
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
    });

    const leakingRecords = [...records, { event: "debug", message: "sk-slice-redaction-leaked" }];
    expect(
      findSliceBehaviorEvidence("su01-api-key-secret-redaction", leakingRecords, evidence),
    ).toBeNull();
  });

  it("accepts SU-01 local secret file roundtrip only with native driver and restart evidence", () => {
    const records = [
      { event: "channel.join.done", work_id: "work-su01-secret-file", session_id: "session-su01" },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-local-secret-file-roundtrip",
        work_id: "work-su01-secret-file",
        context_work_id: "work-su01-secret-file",
        session_id: "session-su01",
        socket_connected: true,
        driver: "macos-cgevent",
        provider_selected: "deepseek",
        model_selected: "deepseek-slice-local-file",
        provider_switch_saved: true,
        webview_reload_performed: true,
        runtime_reset_before_reload: true,
        post_reload_provider: "deepseek",
        post_reload_api_key_configured: true,
        secret_storage_kind: "local_file",
        provider_secrets_file_exists: true,
        provider_secrets_file_mode: "600",
        provider_secrets_file_contains_expected_key: true,
        preferences_file_exists: true,
        preferences_selected_provider: true,
        preferences_model_saved: true,
        preferences_omits_api_key: true,
        provider_options_omits_api_key: true,
        app_log_omits_api_key: true,
        backend_log_omits_api_key: true,
      },
    ];

    const evidence = findNativeSliceEvidence("su01-local-secret-file-roundtrip", records);
    expect(evidence).toEqual({
      slice_id: "su01-local-secret-file-roundtrip",
      turn_ids: [],
      work_id: "work-su01-secret-file",
      provider_selected: "deepseek",
      model_selected: "deepseek-slice-local-file",
      driver: "macos-cgevent",
      secret_storage_kind: "local_file",
      provider_secrets_file_mode: "600",
      key_events: keyEventsForSlice("su01-local-secret-file-roundtrip"),
    });
    expect(
      findSliceBehaviorEvidence("su01-local-secret-file-roundtrip", records, evidence),
    ).toEqual({
      slice_id: "su01-local-secret-file-roundtrip",
      behavior: "local_secret_file_write_read_roundtrip_from_real_tauri_webview",
      turn_ids: [],
      work_id: "work-su01-secret-file",
      provider_selected: "deepseek",
      model_selected: "deepseek-slice-local-file",
      driver: "macos-cgevent",
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
    });

    const browserOnlyRecords = [
      {
        ...records[1],
        driver: "playwright-browser",
      },
    ];
    expect(
      findNativeSliceEvidence("su01-local-secret-file-roundtrip", browserOnlyRecords),
    ).toBeNull();
  });

  it("accepts SU-01 provider model list evidence only when provider models are selectable", () => {
    const records = [
      {
        event: "channel.join.done",
        work_id: "work-su01-models",
        session_id: "session-su01-models",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-provider-model-list-success",
        work_id: "work-su01-models",
        context_work_id: "work-su01-models",
        socket_connected: true,
        deepseek_models_loaded: true,
        deepseek_model_selected: "deepseek-slice-model-list",
        anthropic_models_loaded: true,
        anthropic_model_selected: "claude-slice-sonnet",
        lmstudio_models_loaded: true,
        lmstudio_model_selected: "local-slice-model",
        lmstudio_fixture_endpoint: "http://127.0.0.1:5555/v1",
        models_came_from_backend: true,
        model_inputs_allowed_selection: true,
        visible_text_omits_api_keys: true,
      },
    ];

    const evidence = findNativeSliceEvidence("su01-provider-model-list-success", records);
    expect(evidence).toEqual({
      slice_id: "su01-provider-model-list-success",
      turn_ids: [],
      work_id: "work-su01-models",
      deepseek_model_selected: "deepseek-slice-model-list",
      anthropic_model_selected: "claude-slice-sonnet",
      lmstudio_model_selected: "local-slice-model",
      lmstudio_fixture_endpoint: "http://127.0.0.1:5555/v1",
      key_events: keyEventsForSlice("su01-provider-model-list-success"),
    });
    expect(
      findSliceBehaviorEvidence("su01-provider-model-list-success", records, evidence),
    ).toEqual({
      slice_id: "su01-provider-model-list-success",
      behavior: "provider_model_lists_load_through_backend_adapter_boundaries",
      turn_ids: [],
      work_id: "work-su01-models",
      deepseek_model_selected: "deepseek-slice-model-list",
      anthropic_model_selected: "claude-slice-sonnet",
      lmstudio_model_selected: "local-slice-model",
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
    });
  });

  it("accepts SU-01 provider test failure evidence only when the draft is preserved and recoverable", () => {
    const records = [
      {
        event: "channel.join.done",
        work_id: "work-su01-test-failure",
        session_id: "session-su01-test-failure",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su01-provider-test-failure-ui",
        work_id: "work-su01-test-failure",
        context_work_id: "work-su01-test-failure",
        socket_connected: true,
        provider_selected: "lmstudio",
        model_selected_before_failure: "local-slice-failure-recovery",
        failing_endpoint: "http://127.0.0.1:1/v1",
        recovered_endpoint: "http://127.0.0.1:5555/v1",
        failure_message_visible: true,
        failure_reason_visible: true,
        dialog_stayed_open_after_failure: true,
        provider_draft_preserved_after_failure: true,
        endpoint_draft_preserved_after_failure: true,
        recovery_test_succeeded: true,
        no_turn_events_created_by_test_connection: true,
      },
    ];

    const evidence = findNativeSliceEvidence("su01-provider-test-failure-ui", records);
    expect(evidence).toEqual({
      slice_id: "su01-provider-test-failure-ui",
      turn_ids: [],
      work_id: "work-su01-test-failure",
      provider_selected: "lmstudio",
      model_selected_before_failure: "local-slice-failure-recovery",
      failing_endpoint: "http://127.0.0.1:1/v1",
      recovered_endpoint: "http://127.0.0.1:5555/v1",
      key_events: keyEventsForSlice("su01-provider-test-failure-ui"),
    });
    expect(findSliceBehaviorEvidence("su01-provider-test-failure-ui", records, evidence)).toEqual({
      slice_id: "su01-provider-test-failure-ui",
      behavior: "provider_test_connection_failure_keeps_draft_and_recovers",
      turn_ids: [],
      work_id: "work-su01-test-failure",
      provider_selected: "lmstudio",
      model_selected_before_failure: "local-slice-failure-recovery",
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
    });

    const incompleteRecords = [
      {
        ...records[1],
        endpoint_draft_preserved_after_failure: false,
      },
    ];
    expect(findNativeSliceEvidence("su01-provider-test-failure-ui", incompleteRecords)).toBeNull();
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
      candidate_panel_width: 686.390625,
      candidate_panel_aligned_to_assistant_rail: true,
      candidate_panel_surface_defined: true,
      candidate_card_boundary_visible: true,
      candidate_actions_match_prototype: true,
      candidate_panel_collapsed_after_continue: true,
      candidate_panel_collapsed_after_reload: true,
      candidate_panel_reexpanded: true,
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
        "source_candidate_panel_collapsed_after_accept",
        "candidate_panel_collapse_restored_after_reload",
        "restored_candidate_panel_remains_expandable",
        "no_adoption_or_projection_events",
        "assistant_messages_not_fallback",
        "deterministic_provider_judgment_called_per_turn",
      ],
    });
  });

  it("rejects AU-02 candidate evidence when the exploration frame badge is missing", () => {
    const records = au02CandidateContinuationRecords("turn-source", "turn-follow").filter(
      (record) => record.event !== "slice_verify.ui_state.done",
    );

    expect(findNativeSliceEvidence("au02-candidate-continuation", records)).toBeNull();
  });

  it("accepts AU-02 candidate multi-turn context evidence", () => {
    const records = au02CandidateMultiturnContextRecords(
      "turn-source",
      "turn-continuation",
      "turn-followup",
    );

    const evidence = findNativeSliceEvidence("au02-candidate-multiturn-context", records);
    expect(evidence).toEqual({
      slice_id: "au02-candidate-multiturn-context",
      turn_id: "turn-followup",
      turn_ids: ["turn-source", "turn-continuation", "turn-followup"],
      source_turn_ref: "turn-source",
      continuation_turn_id: "turn-continuation",
      followup_turn_id: "turn-followup",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      context_nonce: "AU02CTX123456",
      candidate_title_visible: true,
      continuation_candidate_selection_sent: true,
      followup_plain_user_message_sent: true,
      followup_context_has_conversation: true,
      followup_context_has_session_summary: true,
      followup_reply_contains_context_nonce: true,
      generate_micro_plan: false,
      tool_result_present: false,
      adoption_decision_present: false,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
      no_author_action_sent: true,
      no_action_result_received: true,
      key_events: keyEventsForSlice("au02-candidate-multiturn-context"),
    });
    expect(
      findSliceBehaviorEvidence("au02-candidate-multiturn-context", records, evidence),
    ).toEqual({
      slice_id: "au02-candidate-multiturn-context",
      behavior: "candidate_context_survives_continuation_and_plain_followup",
      turn_ids: ["turn-source", "turn-continuation", "turn-followup"],
      source_turn_ref: "turn-source",
      continuation_turn_id: "turn-continuation",
      followup_turn_id: "turn-followup",
      candidate_ref: "dir-1",
      context_nonce: "AU02CTX123456",
      assertions: [
        "source_turn_rendered_nonce_candidate",
        "candidate_continuation_sent_candidate_selection",
        "plain_followup_did_not_send_candidate_selection",
        "followup_context_assembled_session_conversation",
        "assistant_reply_reflected_prior_candidate_context",
        "micro_plan_not_requested",
        "no_author_action_or_adoption_events",
        "production_write_not_claimed",
        "deterministic_provider_form_frame_called_for_multiturn_context",
      ],
    });
  });

  it("rejects AU-02 candidate multi-turn context without nonce-backed reply", () => {
    const records = au02CandidateMultiturnContextRecords(
      "turn-source",
      "turn-continuation",
      "turn-followup",
    ).map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, followup_reply_contains_context_nonce: false }
        : record,
    );

    expect(findNativeSliceEvidence("au02-candidate-multiturn-context", records)).toBeNull();
  });

  it("accepts AU-02 freeform follow-up after candidate without candidate selection", () => {
    const records = au02CandidateFreeformFollowupRecords("turn-source", "turn-freeform");

    const evidence = findNativeSliceEvidence("au02-freeform-followup-after-candidate", records);
    expect(evidence).toEqual({
      slice_id: "au02-freeform-followup-after-candidate",
      turn_id: "turn-freeform",
      turn_ids: ["turn-freeform"],
      source_turn_ref: "turn-source",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      candidate_panel_count_after_source: 1,
      input_enabled_after_candidate: true,
      candidate_selection_sent: false,
      no_author_action_sent: true,
      no_action_result_received: true,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
      key_events: keyEventsForSlice("au02-freeform-followup-after-candidate"),
    });
    expect(
      findSliceBehaviorEvidence("au02-freeform-followup-after-candidate", records, evidence),
    ).toEqual({
      slice_id: "au02-freeform-followup-after-candidate",
      behavior: "candidate_panel_allows_freeform_followup_without_adoption",
      turn_ids: ["turn-freeform"],
      source_turn_ref: "turn-source",
      candidate_ref: "dir-1",
      assertions: [
        "candidate_panel_rendered_before_freeform_followup",
        "chat_input_remained_enabled_with_candidate_panel",
        "freeform_followup_sent_plain_user_message",
        "candidate_selection_not_sent",
        "author_action_not_sent",
        "no_adoption_or_projection_events",
        "production_write_not_claimed",
        "deterministic_provider_form_frame_called_for_freeform_followup",
      ],
    });
  });

  it("rejects AU-02 freeform follow-up if the sent message carries candidate_selection", () => {
    const records = au02CandidateFreeformFollowupRecords("turn-source", "turn-freeform").map(
      (record) => {
        if (record.event === "channel.user_message.start") {
          return {
            ...record,
            candidate_source_turn_ref: "turn-source",
            candidate_ref: "dir-1",
          };
        }
        return record.event === "slice_verify.ui_state.done"
          ? { ...record, candidate_selection_sent: true }
          : record;
      },
    );

    expect(findNativeSliceEvidence("au02-freeform-followup-after-candidate", records)).toBeNull();
  });

  it("accepts AU-02 natural exploration without slot form evidence", () => {
    const records = au02NaturalExplorationNoSlotFormRecords("turn-source");

    const evidence = findNativeSliceEvidence("au02-natural-exploration-no-slot-form", records);
    expect(evidence).toEqual({
      slice_id: "au02-natural-exploration-no-slot-form",
      turn_id: "turn-source",
      turn_ids: ["turn-source"],
      work_id: "work-1",
      source_turn_ref: "turn-source",
      frame_type: "creative_exploration",
      candidate_count: 2,
      candidate_ref: "dir-1",
      candidate_titles: ["数字灵根", "机甲道场"],
      candidate_pitches: ["灵根芯片与云端神祇", "机甲炼体与数据心法"],
      candidate_set_ref: "candidate_set:turn-source",
      natural_reply_visible: true,
      lmstudio_quality_checks_required: false,
      natural_reply_chinese: true,
      natural_reply_no_json_code: true,
      candidates_no_json_code: true,
      candidate_semantically_relevant: true,
      candidate_panel_rendered: 1,
      slot_form_visible: false,
      forbidden_slot_fields_absent: true,
      execution_card_visible: false,
      generate_micro_plan: false,
      tool_result_present: false,
      adoption_decision_present: false,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
      no_author_action_sent: true,
      no_action_result_received: true,
      key_events: keyEventsForSlice("au02-natural-exploration-no-slot-form"),
    });
    expect(
      findSliceBehaviorEvidence("au02-natural-exploration-no-slot-form", records, evidence),
    ).toEqual({
      slice_id: "au02-natural-exploration-no-slot-form",
      behavior: "fuzzy_idea_gets_natural_exploration_without_slot_form_or_execution",
      turn_ids: ["turn-source"],
      source_turn_ref: "turn-source",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
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
        "deterministic_provider_form_frame_called_for_source_candidate_turn",
      ],
    });
  });

  it("rejects AU-02 natural exploration if a slot form is visible", () => {
    const records = au02NaturalExplorationNoSlotFormRecords("turn-source").map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, slot_form_visible: true }
        : record,
    );

    expect(findNativeSliceEvidence("au02-natural-exploration-no-slot-form", records)).toBeNull();
  });

  it("rejects AU-02 natural exploration in LM Studio mode if quality checks fail", () => {
    const records = au02NaturalExplorationNoSlotFormRecords("turn-source").map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? {
            ...record,
            lmstudio_quality_checks_required: true,
            candidate_semantically_relevant: false,
          }
        : record,
    );

    expect(findNativeSliceEvidence("au02-natural-exploration-no-slot-form", records)).toBeNull();
  });

  it("accepts AU-02 candidate fallback UI evidence from malformed provider candidates", () => {
    const records = au02CandidateFallbackUiRecords("turn-source");

    const evidence = findNativeSliceEvidence("au02-candidate-fallback-ui", records);
    expect(evidence).toEqual({
      slice_id: "au02-candidate-fallback-ui",
      turn_id: "turn-source",
      turn_ids: ["turn-source"],
      work_id: "work-1",
      source_turn_ref: "turn-source",
      provider_candidate_payload: "malformed_candidates",
      frame_type: "creative_exploration",
      frame_candidate_count: 3,
      turn_result_candidate_count: 3,
      fallback_candidate_titles: ["矛盾切入", "人物切入", "世界规则切入"],
      fallback_candidate_visible: true,
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      candidate_panel_rendered: 1,
      candidate_fields_nonempty: true,
      candidate_statuses_not_adopted: true,
      generate_micro_plan: false,
      tool_result_present: false,
      adoption_decision_present: false,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
      no_author_action_sent: true,
      no_action_result_received: true,
      key_events: keyEventsForSlice("au02-candidate-fallback-ui"),
    });
    expect(findSliceBehaviorEvidence("au02-candidate-fallback-ui", records, evidence)).toEqual({
      slice_id: "au02-candidate-fallback-ui",
      behavior: "malformed_candidate_payload_renders_fallback_candidate_cards",
      turn_ids: ["turn-source"],
      source_turn_ref: "turn-source",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      fallback_candidate_titles: ["矛盾切入", "人物切入", "世界规则切入"],
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
        "deterministic_provider_form_frame_called_for_candidate_fallback",
      ],
    });
  });

  it("rejects AU-02 candidate fallback UI evidence if fallback fields are empty", () => {
    const records = au02CandidateFallbackUiRecords("turn-source").map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, candidate_fields_nonempty: false }
        : record,
    );

    expect(findNativeSliceEvidence("au02-candidate-fallback-ui", records)).toBeNull();
  });

  it("accepts AU-02 unadopted candidate reading/fact exclusion evidence", () => {
    const records = au02UnadoptedCandidateNoReadingFactRecords("turn-source");

    const evidence = findNativeSliceEvidence("au02-unadopted-candidate-no-reading-fact", records);
    expect(evidence).toEqual({
      slice_id: "au02-unadopted-candidate-no-reading-fact",
      turn_id: "turn-source",
      turn_ids: ["turn-source"],
      work_id: "work-1",
      source_turn_ref: "turn-source",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      reading_mode_opened: true,
      reading_empty_state_visible: true,
      reading_toc_chapter_count: 0,
      reading_total_word_count: 0,
      candidate_title_visible_in_reading: false,
      candidate_pitch_visible_in_reading: false,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
      no_author_action_sent: true,
      no_action_result_received: true,
      no_projection_events: true,
      key_events: keyEventsForSlice("au02-unadopted-candidate-no-reading-fact"),
    });
    expect(
      findSliceBehaviorEvidence("au02-unadopted-candidate-no-reading-fact", records, evidence),
    ).toEqual({
      slice_id: "au02-unadopted-candidate-no-reading-fact",
      behavior: "unadopted_candidate_stays_out_of_reading_and_work_facts",
      turn_ids: ["turn-source"],
      source_turn_ref: "turn-source",
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
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
        "deterministic_provider_form_frame_called_for_source_candidate_turn",
      ],
    });
  });

  it("rejects AU-02 unadopted candidate evidence if candidate text leaks into reading", () => {
    const records = au02UnadoptedCandidateNoReadingFactRecords("turn-source").map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, candidate_title_visible_in_reading: true }
        : record,
    );

    expect(findNativeSliceEvidence("au02-unadopted-candidate-no-reading-fact", records)).toBeNull();
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
      behavior: "candidate_adoption_authorized_by_available_action",
      turn_ids: ["turn-source", "turn-adoption"],
      source_turn_ref: "turn-source",
      continuation_turn_id: null,
      candidate_ref: "dir-1",
      candidate_set_ref: "candidate_set:turn-source",
      assertions: [
        "candidate_panel_rendered_from_turn_result",
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
      { event: "channel.user_message.start", turn_id: "turn-su03", work_id: "work-a" },
      { event: "channel.user_message.done", turn_id: "turn-su03", work_id: "work-a" },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "su03-assistant-display-name",
        work_id: "work-a",
        context_work_id: "work-a",
        initial_work_id: "work-a",
        created_work_id: "work-b",
        turn_id: "turn-su03",
        socket_connected: true,
        assistant_name_after_save: "创作助手",
        assistant_role_after_save: "创作助手",
        assistant_label_after_turn: "创作助手",
        assistant_name_in_created_work: "AI",
        assistant_name_after_return: "创作助手",
        assistant_role_after_return: "创作助手",
        sent_payload_includes_display_name: false,
        turn_result_contract_has_assistant_message: true,
        turn_result_has_display_name_key: false,
      },
    ];

    const evidence = findNativeSliceEvidence("su03-assistant-display-name", records);
    expect(evidence).toEqual({
      slice_id: "su03-assistant-display-name",
      turn_id: "turn-su03",
      turn_ids: ["turn-su03"],
      work_id: "work-a",
      created_work_id: "work-b",
      assistant_name_after_save: "创作助手",
      assistant_name_in_created_work: "AI",
      assistant_name_after_return: "创作助手",
      sent_payload_includes_display_name: false,
      turn_result_contract_has_assistant_message: true,
      turn_result_has_display_name_key: false,
      key_events: keyEventsForSlice("su03-assistant-display-name"),
    });
    expect(findSliceBehaviorEvidence("su03-assistant-display-name", records, evidence)).toEqual({
      slice_id: "su03-assistant-display-name",
      behavior: "assistant_display_name_is_work_scoped_ui_preference",
      turn_ids: ["turn-su03"],
      work_id: "work-a",
      created_work_id: "work-b",
      assertions: [
        "assistant_name_changed_from_real_workbench_entry",
        "assistant_message_role_remained_assistant",
        "turn_result_preserved_assistant_message_contract",
        "wire_payload_did_not_include_ui_display_name",
        "display_name_saved_for_current_work",
        "new_work_fell_back_to_default_ai_name",
        "switching_back_restored_original_work_name",
        "preference_did_not_touch_provider_or_turn_result_contract",
        "no_error_events",
      ],
    });

    expect(
      findSliceBehaviorEvidence("su03-assistant-display-name", records, evidence, {
        provider: "lmstudio",
        llmRecords: [
          {
            turn_id: "turn-su03",
            provider: "lmstudio",
            request: {
              method: "POST",
              body: { messages: [{ role: "user", content: "SU03显示名边界" }] },
            },
            response: { status: 200 },
          },
        ],
      }),
    ).toEqual({
      slice_id: "su03-assistant-display-name",
      behavior: "assistant_display_name_is_work_scoped_ui_preference",
      turn_ids: ["turn-su03"],
      work_id: "work-a",
      created_work_id: "work-b",
      assertions: [
        "assistant_name_changed_from_real_workbench_entry",
        "assistant_message_role_remained_assistant",
        "turn_result_preserved_assistant_message_contract",
        "wire_payload_did_not_include_ui_display_name",
        "lmstudio_request_did_not_include_ui_display_name",
        "display_name_saved_for_current_work",
        "new_work_fell_back_to_default_ai_name",
        "switching_back_restored_original_work_name",
        "preference_did_not_touch_provider_or_turn_result_contract",
        "no_error_events",
      ],
    });

    expect(
      findSliceBehaviorEvidence("su03-assistant-display-name", records, evidence, {
        provider: "lmstudio",
        llmRecords: [
          {
            turn_id: "turn-su03",
            provider: "lmstudio",
            request: {
              method: "POST",
              body: { messages: [{ role: "system", content: "你叫创作助手" }] },
            },
            response: { status: 200 },
          },
        ],
      }),
    ).toBeNull();
  });

  it("accepts AU-03 session history readonly evidence when an exited session is opened safely", () => {
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
        pending_adoption_count: 0,
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au03-session-history-readonly",
        work_id: "work-au03",
        context_work_id: "work-au03",
        readonly_session_id: "session-history",
        readonly_banner_visible: true,
        readonly_input_disabled: true,
        readonly_send_disabled: true,
        readonly_visible_text: "林瑶留下的旧线索应该藏在矿区档案室。",
        active_session_restored: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au03-session-history-readonly", records);
    expect(evidence).toEqual({
      slice_id: "au03-session-history-readonly",
      turn_ids: [],
      work_id: "work-au03",
      session_id: "session-history",
      key_events: keyEventsForSlice("au03-session-history-readonly"),
      transcript_count: 2,
      pending_adoption_count: 0,
    });
    expect(findSliceBehaviorEvidence("au03-session-history-readonly", records, evidence)).toEqual({
      slice_id: "au03-session-history-readonly",
      behavior: "historical_session_transcript_opened_readonly_from_real_workbench",
      turn_ids: [],
      work_id: "work-au03",
      session_id: "session-history",
      assertions: [
        "session_search_started_from_real_workbench",
        "history_session_snapshot_loaded_through_web_application_persistence",
        "exited_session_opened_as_read_only",
        "old_pending_adoptions_not_restored",
        "chat_input_and_send_disabled_while_viewing_history",
        "active_session_view_can_be_restored",
      ],
    });
  });

  it("accepts AU-03 new active session evidence when the previous active becomes readonly history", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-au03",
        session_id: "session-previous-active",
        transcript_count: 2,
      },
      {
        event: "work_session.create.done",
        work_id: "work-au03",
        session_id: "session-new-active",
      },
      {
        event: "work_session.resume.done",
        work_id: "work-au03",
        session_id: "session-new-active",
        transcript_count: 0,
      },
      { event: "channel.join.done", work_id: "work-au03", session_id: "session-new-active" },
      {
        event: "work_session.show.done",
        work_id: "work-au03",
        session_id: "session-previous-active",
        read_only: true,
        transcript_count: 2,
        pending_adoption_count: 0,
      },
      {
        event: "channel.user_message.start",
        work_id: "work-au03",
        session_id: "session-new-active",
        turn_id: "turn-new-active-1",
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-new-active-1",
        has_snapshot: true,
        has_conversation: false,
        context_refs_count: 1,
      },
      {
        event: "channel.user_message.done",
        work_id: "work-au03",
        session_id: "session-new-active",
        turn_id: "turn-new-active-1",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au03-session-new-active",
        turn_id: "turn-new-active-1",
        turn_ids: ["turn-new-active-1"],
        work_id: "work-au03",
        context_work_id: "work-au03",
        previous_active_session_id: "session-previous-active",
        new_active_session_id: "session-new-active",
        previous_active_status_after_create: "EXITED",
        new_session_transcript_empty: true,
        new_session_input_enabled: true,
        new_session_send_enabled: true,
        old_active_visible_initial: true,
        old_active_absent_after_create: true,
        previous_active_readonly_opened: true,
        previous_active_readonly_banner_visible: true,
        previous_active_input_disabled: true,
        previous_active_send_disabled: true,
        previous_active_transcript_visible_readonly: true,
        active_session_restored: true,
        user_message_session_id: "session-new-active",
        user_message_work_id: "work-au03",
        new_session_message_visible: true,
        old_active_text_in_new_session: false,
        first_turn_context_has_conversation: false,
      },
    ];

    const evidence = findNativeSliceEvidence("au03-session-new-active", records);
    expect(evidence).toEqual({
      slice_id: "au03-session-new-active",
      turn_ids: ["turn-new-active-1"],
      work_id: "work-au03",
      session_id: "session-new-active",
      previous_session_id: "session-previous-active",
      key_events: keyEventsForSlice("au03-session-new-active"),
      transcript_count: 0,
      previous_transcript_count: 2,
      first_turn_context_refs_count: 1,
    });
    expect(findSliceBehaviorEvidence("au03-session-new-active", records, evidence)).toEqual({
      slice_id: "au03-session-new-active",
      behavior: "new_active_session_created_and_previous_active_reopened_readonly",
      turn_ids: ["turn-new-active-1"],
      work_id: "work-au03",
      session_id: "session-new-active",
      previous_session_id: "session-previous-active",
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
          "AI 回应 参考来源 当前作品背景 灵源纪元 / 东方奇幻 / 林烬追查灵源矿区真相 当前会话记录 上一轮围绕「林烬进入灵源矿区」展开，AI 已给出回应。 已确认设定 林瑶失踪指向灵源矿区，林烬去矿区追查线索。 解释来自本轮已保存的 trace 摘要，不会重新调用模型或改写作品。",
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

  it("accepts AU-11 missing WorkState policy evidence", () => {
    const records = [
      {
        event: "work_session.resume.done",
        work_id: "work-au11-missing",
        session_id: "session-au11-missing",
      },
      {
        event: "channel.join.done",
        work_id: "work-au11-missing",
        session_id: "session-au11-missing",
      },
      {
        event: "channel.user_message.start",
        turn_id: "turn-au11-missing",
        workspace_id: "work-au11-missing",
        work_id: "work-au11-missing",
        session_id: "session-au11-missing",
        generate_micro_plan: false,
        duration_ms: 1,
        outcome: "start",
      },
      {
        event: "context.assemble.done",
        turn_id: "turn-au11-missing",
        workspace_id: "work-au11-missing",
        work_id: "work-au11-missing",
        session_id: "session-au11-missing",
        has_snapshot: true,
        has_conversation: false,
        has_memory: false,
        context_refs_count: 0,
        duration_ms: 5,
        outcome: "done",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-au11-missing",
        workspace_id: "work-au11-missing",
        work_id: "work-au11-missing",
        session_id: "session-au11-missing",
        duration_ms: 8,
        outcome: "done",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-au11-missing",
        workspace_id: "work-au11-missing",
        work_id: "work-au11-missing",
        session_id: "session-au11-missing",
        duration_ms: 15,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-au11-missing",
        workspace_id: "work-au11-missing",
        work_id: "work-au11-missing",
        session_id: "session-au11-missing",
        duration_ms: 18,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au11-missing-workstate-policy",
        turn_id: "turn-au11-missing",
        workspace_id: "work-au11-missing",
        work_id: "work-au11-missing",
        session_id: "session-au11-missing",
        context_work_id: "work-au11-missing",
        active_session_id: "session-au11-missing",
        guidance_mode_quality: true,
        work_state_snapshot_mentions_work: true,
        work_state_chapter_state_missing: true,
        work_state_chapter_summary_missing: true,
        work_state_prior_prose_missing: true,
        work_state_character_state_missing: true,
        turn_guidance_records_missing_questions: true,
        assistant_asks_for_target_material: true,
        assistant_claims_read_chapter: false,
        assistant_fabricates_seeded_chapter_fact: false,
        no_tool_result: true,
        no_adoption_state: true,
        no_production_write: true,
        trace_why_dialog_open: true,
        trace_why_contains_raw_prompt: false,
        why_shows_quality_diagnosis: true,
        why_shows_work_state_missing: true,
        why_shows_missing_limit: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au11-missing-workstate-policy", records);
    expect(evidence).toEqual({
      slice_id: "au11-missing-workstate-policy",
      turn_id: "turn-au11-missing",
      turn_ids: ["turn-au11-missing"],
      work_id: "work-au11-missing",
      session_id: "session-au11-missing",
      context_refs_count: 0,
      key_events: keyEventsForSlice("au11-missing-workstate-policy"),
    });
    expect(findSliceBehaviorEvidence("au11-missing-workstate-policy", records, evidence)).toEqual({
      slice_id: "au11-missing-workstate-policy",
      behavior: "quality_diagnosis_missing_workstate_records_explicit_gaps_without_fabrication",
      turn_ids: ["turn-au11-missing"],
      work_id: "work-au11-missing",
      session_id: "session-au11-missing",
      assertions: [
        "message_sent_from_real_workbench",
        "selected_real_work_has_snapshot_but_missing_chapter_material",
        "work_state_layer_marks_missing_chapter_summary_prose_and_character_state",
        "turn_guidance_records_missing_target_chapter_and_prose_questions",
        "assistant_asks_for_target_material_without_claiming_to_have_read_the_chapter",
        "why_panel_shows_quality_mode_missing_workstate_and_missing_prose_limit",
        "no_tool_no_adoption_no_production_write",
      ],
    });
  });

  it("accepts AU-09 archive evidence from real scoped archive records", () => {
    for (const sliceId of ["au09-archive-real-data", "au09-archive-stats-current"]) {
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
          slice_id: sliceId,
          work_id: "work-au09",
          context_work_id: "work-au09",
          archive_character_count: 1,
          archive_foreshadowing_count: 1,
          archive_rule_count: 1,
          archive_volumes: 1,
          archive_chapters: 1,
          archive_memory_items: 2,
          archive_drafts_total: 2,
          archive_drafts_accepted: 1,
          archive_detail_kind: "memory",
          archive_detail_id: "mem-au09",
          archive_detail_title: "林澈背后的旧伤",
          archive_foreign_excluded: true,
        },
      ];

      const evidence = findNativeSliceEvidence(sliceId, records);
      expect(evidence).toMatchObject({
        slice_id: sliceId,
        work_id: "work-au09",
        archive_character_count: 1,
        archive_foreshadowing_count: 1,
        archive_rule_count: 1,
        archive_volumes: 1,
        archive_chapters: 1,
        archive_drafts_total: 2,
        archive_detail_kind: "memory",
        archive_detail_title: "林澈背后的旧伤",
      });
      expect(findSliceBehaviorEvidence(sliceId, records, evidence)).toEqual({
        slice_id: sliceId,
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
          ...(sliceId === "au09-archive-stats-current"
            ? ["foreign_work_archive_items_excluded"]
            : []),
        ],
      });
    }
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

  it("accepts AU-09 memory management filter matrix evidence", () => {
    const records = [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-memory-management-filter-matrix",
        work_id: "work-filter",
        session_id: "session-filter",
        memory_page_opened_from_workbench: true,
        alpha_nonce: "筛矩灵印",
        beta_nonce: "筛矩锁印",
        gamma_nonce: "筛矩外印",
        baseline_row_count: 3,
        keyword_filter_visible_count: 1,
        type_filter_visible_count: 1,
        scope_filter_visible_count: 1,
        status_filter_visible_count: 1,
        locked_filter_visible_count: 1,
        combined_filter_visible_count: 1,
        draft_unlocked_filter_visible_count: 1,
        keyword_filter_isolated_alpha: true,
        type_filter_isolated_beta: true,
        scope_filter_isolated_beta: true,
        status_filter_isolated_beta: true,
        locked_filter_isolated_beta: true,
        combined_filter_isolated_beta: true,
        draft_unlocked_filter_isolated_gamma: true,
        memory_list_request_count: 8,
        request_carried_keyword_filter: true,
        request_carried_combined_filter: true,
      },
    ];

    const evidence = findNativeSliceEvidence("au09-memory-management-filter-matrix", records);
    expect(evidence).toEqual({
      slice_id: "au09-memory-management-filter-matrix",
      turn_id: null,
      turn_ids: [],
      work_id: "work-filter",
      session_id: "session-filter",
      alpha_nonce: "筛矩灵印",
      beta_nonce: "筛矩锁印",
      gamma_nonce: "筛矩外印",
      memory_list_request_count: 8,
      key_events: keyEventsForSlice("au09-memory-management-filter-matrix"),
    });
    expect(
      findSliceBehaviorEvidence("au09-memory-management-filter-matrix", records, evidence),
    ).toEqual({
      slice_id: "au09-memory-management-filter-matrix",
      behavior:
        "author_filters_current_work_memory_list_by_keyword_type_scope_status_and_locked_state",
      turn_ids: [],
      work_id: "work-filter",
      alpha_nonce: "筛矩灵印",
      beta_nonce: "筛矩锁印",
      gamma_nonce: "筛矩外印",
      memory_list_request_count: 8,
      assertions: [
        "author_opened_memory_page_from_real_workbench",
        "author_created_distinct_current_work_memories_from_real_ui",
        "keyword_filter_isolated_matching_memory",
        "type_scope_status_and_locked_filters_isolated_matching_memory",
        "combined_filter_matrix_kept_only_the_matching_memory",
        "draft_unlocked_filter_kept_only_the_matching_memory",
        "memory_list_requests_carried_visible_filter_values",
      ],
    });
  });

  it("rejects AU-09 memory management filter matrix when a filter does not isolate rows", () => {
    const records = [
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au09-memory-management-filter-matrix",
        memory_page_opened_from_workbench: true,
        keyword_filter_isolated_alpha: true,
        type_filter_isolated_beta: true,
        scope_filter_isolated_beta: true,
        status_filter_isolated_beta: false,
        locked_filter_isolated_beta: true,
        combined_filter_isolated_beta: true,
        draft_unlocked_filter_isolated_gamma: true,
        memory_list_request_count: 8,
        request_carried_keyword_filter: true,
        request_carried_combined_filter: true,
      },
    ];

    expect(findNativeSliceEvidence("au09-memory-management-filter-matrix", records)).toBeNull();
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

  it("finds SU-02 artifact/projection/trace isolation evidence", () => {
    const records = su02ArtifactProjectionTraceIsolationRecords();
    const evidence = findNativeSliceEvidence("su02-artifact-projection-trace-isolation", records);

    expect(evidence).toEqual({
      slice_id: "su02-artifact-projection-trace-isolation",
      turn_id: "turn-draft-a",
      turn_ids: ["turn-draft-a", "turn-adopt-a", "turn-trace-b"],
      draft_turn_id: "turn-draft-a",
      adopt_turn_id: "turn-adopt-a",
      target_trace_turn_id: "turn-trace-b",
      source_work_id: "work-a",
      target_work_id: "work-b",
      work_id: "work-b",
      artifact_id: "artifact-prose-a",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      source_trace_ref: "trace-source-draft",
      target_trace_ref: "trace-target-b",
      source_chapter_count: 1,
      source_content_chars: 42,
      target_empty_toc_reads: 2,
      joined_work_count: 2,
      key_events: keyEventsForSlice("su02-artifact-projection-trace-isolation"),
    });

    expect(
      findSliceBehaviorEvidence("su02-artifact-projection-trace-isolation", records, evidence),
    ).toEqual({
      slice_id: "su02-artifact-projection-trace-isolation",
      behavior: "artifact_projection_and_trace_are_scoped_to_current_work",
      turn_ids: ["turn-draft-a", "turn-adopt-a", "turn-trace-b"],
      draft_turn_id: "turn-draft-a",
      adopt_turn_id: "turn-adopt-a",
      target_trace_turn_id: "turn-trace-b",
      work_id: "work-b",
      source_work_id: "work-a",
      target_work_id: "work-b",
      artifact_id: "artifact-prose-a",
      artifact_type: "prose_fragment",
      source_trace_ref: "trace-source-draft",
      target_trace_ref: "trace-target-b",
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
    });
  });

  it("finds SU-02 pending result work isolation evidence after returning to source", () => {
    const records = su02PendingResultWorkIsolationRecords();
    const evidence = findNativeSliceEvidence("su02-pending-result-work-isolation", records);

    expect(evidence).toEqual({
      slice_id: "su02-pending-result-work-isolation",
      turn_id: "turn-slow-a",
      turn_ids: ["turn-slow-a"],
      work_id: "work-a",
      source_work_id: "work-a",
      target_work_id: "work-b",
      session_id: "session-a-return",
      source_session_id: "session-a",
      target_session_id: "session-b",
      source_return_transcript_count: 1,
      key_events: keyEventsForSlice("su02-pending-result-work-isolation"),
    });

    expect(
      findSliceBehaviorEvidence("su02-pending-result-work-isolation", records, evidence),
    ).toEqual({
      slice_id: "su02-pending-result-work-isolation",
      behavior: "slow_source_turn_result_does_not_pollute_target_work_and_restores_on_return",
      turn_ids: ["turn-slow-a"],
      work_id: "work-a",
      source_work_id: "work-a",
      target_work_id: "work-b",
      session_id: "session-a-return",
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
    });
  });

  it("finds SU-02 empty start unnamed work evidence", () => {
    const records = su02EmptyStartUnnamedWorkRecords();
    const evidence = findNativeSliceEvidence("su02-empty-start-unnamed-work", records);

    expect(evidence).toEqual({
      slice_id: "su02-empty-start-unnamed-work",
      turn_id: "turn-empty-start",
      turn_ids: ["turn-empty-start"],
      work_id: "work-auto",
      session_id: "session-auto",
      renamed_title: "SU02空库改名-123",
      duplicate_unnamed_count: 2,
      duplicate_unnamed_work_ids: ["work-unnamed-1", "work-unnamed-2"],
      second_unnamed_work_id: "work-unnamed-1",
      third_unnamed_work_id: "work-unnamed-2",
      key_events: keyEventsForSlice("su02-empty-start-unnamed-work"),
    });

    expect(findSliceBehaviorEvidence("su02-empty-start-unnamed-work", records, evidence)).toEqual({
      slice_id: "su02-empty-start-unnamed-work",
      behavior: "empty_database_bootstrap_creates_renamable_unnamed_work",
      turn_ids: ["turn-empty-start"],
      work_id: "work-auto",
      session_id: "session-auto",
      renamed_title: "SU02空库改名-123",
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
    });
  });

  it("finds SU-02 restart recovery evidence for last opened work fallback", () => {
    const records = su02WorkRestartRecoveryRecords();
    const evidence = findNativeSliceEvidence("su02-work-restart-recovery", records);

    expect(evidence).toEqual({
      slice_id: "su02-work-restart-recovery",
      turn_ids: [],
      work_id: "work-a",
      source_work_id: "work-a",
      first_restored_work_id: "work-b",
      stale_last_opened_work_id: "work-b",
      discarded_work_id: "work-b",
      fallback_work_id: "work-a",
      fallback_work_title: "SU02恢复甲",
      session_id: "session-a-reload",
      discarded_status: "DISCARDED",
      visible_work_ids: ["work-a"],
      key_events: keyEventsForSlice("su02-work-restart-recovery"),
    });

    expect(findSliceBehaviorEvidence("su02-work-restart-recovery", records, evidence)).toEqual({
      slice_id: "su02-work-restart-recovery",
      behavior: "work_restart_restores_existing_last_opened_and_skips_discarded",
      turn_ids: [],
      work_id: "work-a",
      source_work_id: "work-a",
      first_restored_work_id: "work-b",
      discarded_work_id: "work-b",
      fallback_work_id: "work-a",
      session_id: "session-a-reload",
      assertions: [
        "reload_restored_existing_last_opened_work",
        "discarded_last_opened_work_was_not_restored",
        "fallback_joined_real_workspace_channel",
        "fallback_replaced_stale_last_opened_preference",
        "discarded_work_hidden_from_default_work_list",
        "lobby_not_used_as_recovery_work",
        "no_error_events",
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
      message_text_indexes: [
        { snippet: "first user", index: 0, role: "user" },
        { snippet: "first assistant", index: 1, role: "assistant" },
        { snippet: "second user", index: 2, role: "user" },
        { snippet: "second assistant", index: 3, role: "assistant" },
      ],
      message_text_order_anchored: true,
      agent_run_activity_indexes: [],
      agent_run_activity_count: 0,
      second_agent_run_activity_anchored: false,
      agent_run_activity_observed: true,
      terminal_agent_run_activity_cleared: true,
      thinking_visible_after_reply: false,
      key_events: [
        "channel.user_message.start",
        "judgment.decided.done",
        "channel.user_message.done",
      ],
    });
  });

  it("requires visible question-answer and meta-discussion frame badges", () => {
    const records = gapWt04NonExplorationFrameRecords();

    expect(findNativeSliceEvidence("gap-wt04-non-exploration-frame-badges", records)).toEqual({
      slice_id: "gap-wt04-non-exploration-frame-badges",
      turn_id: "turn-question",
      turn_ids: ["turn-question", "turn-meta"],
      question_turn_id: "turn-question",
      meta_turn_id: "turn-meta",
      question_frame_type: "question_answer",
      meta_frame_type: "meta_discussion",
      question_badge: {
        label: "回答问题",
        title: "回答问题：诊断章节爽感不足和胜利过轻",
        background_color: "rgba(32, 118, 110, 0.08)",
        border_color: "rgba(32, 118, 110, 0.35)",
        color: "rgb(20, 83, 77)",
        width: 64,
        height: 24,
        within_assistant_message: true,
      },
      meta_badge: {
        label: "创作讨论",
        title: "创作讨论：约定先讨论方案再决定是否生成的协作方式",
        background_color: "rgba(97, 84, 170, 0.08)",
        border_color: "rgba(97, 84, 170, 0.32)",
        color: "rgb(71, 63, 145)",
        width: 64,
        height: 24,
        within_assistant_message: true,
      },
      semantic_tones_distinct: true,
      production_write_performed: false,
      key_events: [
        "channel.user_message.start",
        "judgment.decided.done",
        "channel.user_message.done",
        "slice_verify.ui_state.done",
      ],
    });
  });

  it("accepts AU-01 empty message guard evidence with a recovery turn", () => {
    const records = emptyMessageGuardRecords();

    expect(findNativeSliceEvidence("au01-empty-message-guard", records)).toEqual({
      slice_id: "au01-empty-message-guard",
      turn_id: "turn-recovery",
      turn_ids: ["turn-recovery"],
      recovery_turn_id: "turn-recovery",
      blank_user_message_frame_count: 0,
      message_count_unchanged_after_blank: true,
      input_enabled_after_blank: true,
      thinking_visible_after_blank: false,
      recovery_message_visible: true,
      recovery_assistant_reply_visible: true,
      key_events: ["channel.user_message.start", "channel.user_message.done"],
    });
  });

  it("rejects AU-01 empty message guard if blank input sent a frame", () => {
    const records = emptyMessageGuardRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, blank_user_message_frame_count: 1 }
        : record,
    );

    expect(findNativeSliceEvidence("au01-empty-message-guard", records)).toBeNull();
  });

  it("accepts AU-01 empty message behavior only when recovery chat completes", () => {
    const records = emptyMessageGuardRecords();
    const evidence = findNativeSliceEvidence("au01-empty-message-guard", records);

    expect(
      findSliceBehaviorEvidence("au01-empty-message-guard", records, evidence, {
        provider: "slice_verify",
      }),
    ).toEqual({
      slice_id: "au01-empty-message-guard",
      behavior: "empty_message_does_not_create_turn_and_recovery_chat_works",
      turn_ids: ["turn-recovery"],
      assertions: [
        "blank_input_sent_no_user_message_frame",
        "blank_input_did_not_append_visible_messages",
        "blank_input_left_thinking_hidden",
        "input_remained_available_after_blank",
        "following_valid_chat_completed_without_micro_plan",
        "deterministic_provider_judgment_called_for_recovery_turn",
      ],
    });
  });

  it("accepts AU-01 garbage JSON recovery evidence with fallback and recovery turns", () => {
    const records = garbageJsonRecoveryRecords();

    expect(findNativeSliceEvidence("au01-garbage-json-recovery", records)).toEqual({
      slice_id: "au01-garbage-json-recovery",
      turn_id: "turn-garbage",
      turn_ids: ["turn-garbage", "turn-recovery"],
      garbage_turn_id: "turn-garbage",
      recovery_turn_id: "turn-recovery",
      fallback_message_visible: true,
      raw_provider_payload_visible: false,
      input_enabled_after_garbage: true,
      thinking_visible_after_garbage: false,
      channel_connected_after_garbage: true,
      recovery_message_visible: true,
      recovery_assistant_reply_visible: true,
      recovery_assistant_is_fallback: false,
      key_events: [
        "channel.user_message.start",
        "context.assemble.done",
        "channel.user_message.done",
      ],
    });
  });

  it("accepts AU-01 garbage JSON recovery behavior only when the following chat completes", () => {
    const records = garbageJsonRecoveryRecords();
    const evidence = findNativeSliceEvidence("au01-garbage-json-recovery", records);

    expect(
      findSliceBehaviorEvidence("au01-garbage-json-recovery", records, evidence, {
        provider: "slice_verify",
      }),
    ).toEqual({
      slice_id: "au01-garbage-json-recovery",
      behavior: "malformed_provider_json_falls_back_without_leaking_payload_and_recovers",
      turn_ids: ["turn-garbage", "turn-recovery"],
      assertions: [
        "malformed_provider_json_rendered_friendly_fallback",
        "garbage_judgment_structure_settled_as_safe_failure",
        "raw_provider_payload_not_visible",
        "input_remained_available_after_malformed_json",
        "channel_remained_connected_after_malformed_json",
        "following_valid_chat_completed_without_micro_plan",
        "deterministic_provider_recovery_turn_completed",
      ],
    });
  });

  it("rejects AU-01 garbage JSON recovery if raw provider payload is visible", () => {
    const records = garbageJsonRecoveryRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, raw_provider_payload_visible: true }
        : record,
    );

    expect(findNativeSliceEvidence("au01-garbage-json-recovery", records)).toBeNull();
  });

  it("accepts AU-01 frame validation friendly error evidence with recovery turn", () => {
    const records = frameValidationFriendlyErrorRecords();

    expect(findNativeSliceEvidence("au01-frame-validation-friendly-error", records)).toEqual({
      slice_id: "au01-frame-validation-friendly-error",
      turn_id: "turn-invalid-frame",
      turn_ids: ["turn-invalid-frame", "turn-recovery"],
      invalid_frame_turn_id: "turn-invalid-frame",
      recovery_turn_id: "turn-recovery",
      fallback_message_visible: true,
      internal_validation_reason_visible: false,
      internal_validation_reason_in_turn_result: false,
      input_enabled_after_invalid_frame: true,
      thinking_visible_after_invalid_frame: false,
      channel_connected_after_invalid_frame: true,
      recovery_message_visible: true,
      recovery_assistant_reply_visible: true,
      recovery_assistant_is_fallback: false,
      key_events: [
        "channel.user_message.start",
        "context.assemble.done",
        "channel.user_message.done",
      ],
    });
  });

  it("accepts AU-01 frame validation friendly error behavior only when recovery chat completes", () => {
    const records = frameValidationFriendlyErrorRecords();
    const evidence = findNativeSliceEvidence("au01-frame-validation-friendly-error", records);

    expect(
      findSliceBehaviorEvidence("au01-frame-validation-friendly-error", records, evidence, {
        provider: "slice_verify",
      }),
    ).toEqual({
      slice_id: "au01-frame-validation-friendly-error",
      behavior: "invalid_judgment_structure_settles_safely_without_leaking_internal_reason",
      turn_ids: ["turn-invalid-frame", "turn-recovery"],
      assertions: [
        "invalid_judgment_action_settled_as_safe_failure",
        "author_visible_fallback_is_friendly",
        "internal_validation_reason_not_visible",
        "internal_validation_reason_not_in_turn_result",
        "input_remained_available_after_frame_validation_failure",
        "following_valid_chat_completed_without_micro_plan",
        "deterministic_provider_recovery_turn_completed",
      ],
    });
  });

  it("rejects AU-01 frame validation evidence if internal reason leaks into turn result", () => {
    const records = frameValidationFriendlyErrorRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, internal_validation_reason_in_turn_result: true }
        : record,
    );

    expect(findNativeSliceEvidence("au01-frame-validation-friendly-error", records)).toBeNull();
  });

  it("accepts AU-01 turn result recorder UI consistency evidence", () => {
    const records = turnresultRecorderUiConsistencyRecords();

    expect(findNativeSliceEvidence("au01-turnresult-recorder-ui-consistency", records)).toEqual({
      slice_id: "au01-turnresult-recorder-ui-consistency",
      turn_id: "turn-recorder",
      turn_ids: ["turn-recorder"],
      work_id: "work-chat",
      session_id: "session-chat",
      transcript_count: 4,
      reload_resume_transcript_count: 4,
      current_ui_assistant_visible: true,
      transcript_assistant_text_matches_ui: true,
      transcript_turn_result_assistant_text_matches_websocket: true,
      restored_ui_assistant_visible: true,
      key_events: [
        "work_session.resume.done",
        "channel.join.done",
        "channel.user_message.start",
        "judgment.decided.done",
        "channel.user_message.done",
        "work_session.show.done",
        "slice_verify.ui_state.done",
      ],
    });
  });

  it("accepts AU-01 turn result recorder UI behavior when transcript and restored UI match", () => {
    const records = turnresultRecorderUiConsistencyRecords();
    const evidence = findNativeSliceEvidence("au01-turnresult-recorder-ui-consistency", records);

    expect(
      findSliceBehaviorEvidence("au01-turnresult-recorder-ui-consistency", records, evidence, {
        provider: "slice_verify",
      }),
    ).toEqual({
      slice_id: "au01-turnresult-recorder-ui-consistency",
      behavior: "turn_result_assistant_message_matches_recorder_transcript_and_restored_ui",
      turn_ids: ["turn-recorder"],
      work_id: "work-chat",
      session_id: "session-chat",
      assertions: [
        "ordinary_chat_sent_from_real_workbench",
        "visible_assistant_text_came_from_websocket_turn_result",
        "interaction_recorder_persisted_user_and_assistant_rows",
        "assistant_transcript_text_matches_visible_ui",
        "assistant_transcript_turn_result_matches_websocket_turn_result",
        "active_session_snapshot_loaded_through_web_application_persistence",
        "webview_reload_restored_the_same_transcript_text",
        "ordinary_chat_did_not_request_micro_plan",
        "deterministic_provider_form_frame_called_for_recorder_turn",
      ],
    });
  });

  it("rejects AU-01 recorder consistency evidence if transcript turn_result diverges", () => {
    const records = turnresultRecorderUiConsistencyRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, transcript_turn_result_assistant_text_matches_websocket: false }
        : record,
    );

    expect(findNativeSliceEvidence("au01-turnresult-recorder-ui-consistency", records)).toBeNull();
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

  it("rejects ordinary two-turn evidence when a completed AgentRun summary remains visible", () => {
    const records = ordinaryTwoTurnRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? {
            ...record,
            agent_run_activity_indexes: [{ index: 1, role: "assistant", hasActivity: true }],
            agent_run_activity_count: 1,
            second_agent_run_activity_anchored: false,
            terminal_agent_run_activity_cleared: false,
          }
        : record,
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

  it("accepts E2E-01 readonly tool trace when character_roster is allowed and queryable by turn", () => {
    const toolTraceRef = {
      tool_name: "character_roster",
      tool_request_ref: "tq-e2e-tool",
      tool_result_ref: "tr-e2e-tool",
      tool_status: "succeeded",
    };
    const records = [
      {
        event: "channel.user_message.start",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        generate_micro_plan: false,
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "dialogue_gateway.handle_input.start",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        duration_ms: 3,
        outcome: "done",
      },
      {
        event: "planner.form_micro_plan.done",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        duration_ms: 5,
        outcome: "done",
      },
      {
        event: "orchestrator.decide.done",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        decision_type: "allow_tool",
        duration_ms: 1,
        outcome: "done",
      },
      {
        event: "context.characters.done",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        source_type: "character_dossier",
        character_count: 1,
        duration_ms: 1,
        outcome: "done",
      },
      {
        event: "toolbox.execute.done",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        tool_name: "character_roster",
        tool_outcome: "succeeded",
        duration_ms: 2,
        outcome: "done",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        duration_ms: 12,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        duration_ms: 13,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "e2e-01-readonly-tool-trace",
        turn_id: "turn-e2e-tool",
        workspace_id: "work-e2e-tool",
        work_id: "work-e2e-tool",
        session_id: "session-e2e-tool",
        decision_type: "allow_tool",
        tool_name: "character_roster",
        tool_status: "succeeded",
        tool_called: true,
        production_write_performed: false,
        artifact_adopted: false,
        execution_blocked: false,
        accepted_character_visible: true,
        tentative_character_absent: true,
        foreign_character_absent: true,
        no_write_statement_visible: true,
        no_state_delta: true,
        no_artifact_refs: true,
        no_author_action_sent: true,
        no_adoption_event: true,
        no_execution_controls_visible: true,
        trace_query_has_tool_trace_ref: true,
        trace_query_tool_trace_refs: [toolTraceRef],
        character_names: ["林澈"],
      },
    ];

    const evidence = findNativeSliceEvidence("e2e-01-readonly-tool-trace", records);
    expect(evidence).toEqual({
      slice_id: "e2e-01-readonly-tool-trace",
      turn_id: "turn-e2e-tool",
      turn_ids: ["turn-e2e-tool"],
      decision_type: "allow_tool",
      tool_name: "character_roster",
      trace_query_tool_trace_refs: [toolTraceRef],
      character_names: ["林澈"],
      key_events: keyEventsForSlice("e2e-01-readonly-tool-trace"),
    });
    expect(findSliceBehaviorEvidence("e2e-01-readonly-tool-trace", records, evidence)).toEqual({
      slice_id: "e2e-01-readonly-tool-trace",
      behavior: "real_page_readonly_character_roster_tool_persists_queryable_trace",
      turn_ids: ["turn-e2e-tool"],
      decision_type: "allow_tool",
      tool_name: "character_roster",
      trace_query_tool_trace_refs: [toolTraceRef],
      assertions: [
        "real_workbench_sent_readonly_character_roster_request_from_visible_chat_input",
        "frame_tool_need_triggered_micro_plan_without_product_acceptance_hook",
        "orchestrator_allowed_low_risk_character_roster_tool",
        "toolbox_executed_character_roster_successfully",
        "accepted_character_visible_without_tentative_or_foreign_character_leakage",
        "turn_result_reported_tool_called_without_adoption_or_production_write",
        "no_author_action_adoption_or_execution_controls_visible",
        "trace_repository_list_by_turn_returned_tool_trace_ref",
        "deterministic_provider_frame_and_micro_plan_called_for_readonly_tool_turn",
      ],
    });
  });

  it("accepts E2E-01 replay report when persisted trace answers the required six questions", () => {
    const toolTraceRef = {
      tool_name: "character_roster",
      tool_request_ref: "tq-e2e-replay",
      tool_result_ref: "tr-e2e-replay",
      tool_status: "succeeded",
    };
    const replayQuestionStatuses = {
      decision_reason: "answered",
      planner_vs_decision: "answered",
      tool_approval: "answered",
      adoption_boundary: "answered",
      behavior_lifecycle: "not_applicable",
      turn_result_surface: "answered",
    };
    const replayChainSteps = ["frame", "plan", "decision", "tool_trace", "turn_result"];
    const records = [
      {
        event: "channel.user_message.start",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        generate_micro_plan: false,
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "dialogue_gateway.handle_input.start",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        duration_ms: 0,
        outcome: "started",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        duration_ms: 3,
        outcome: "done",
      },
      {
        event: "planner.form_micro_plan.done",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        duration_ms: 5,
        outcome: "done",
      },
      {
        event: "orchestrator.decide.done",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        decision_type: "allow_tool",
        duration_ms: 1,
        outcome: "done",
      },
      {
        event: "context.characters.done",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        source_type: "character_dossier",
        character_count: 1,
        duration_ms: 1,
        outcome: "done",
      },
      {
        event: "toolbox.execute.done",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        tool_name: "character_roster",
        tool_outcome: "succeeded",
        duration_ms: 2,
        outcome: "done",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        duration_ms: 12,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        duration_ms: 13,
        outcome: "done",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "e2e-01-replay-report",
        turn_id: "turn-e2e-replay",
        workspace_id: "work-e2e-replay",
        work_id: "work-e2e-replay",
        session_id: "session-e2e-replay",
        decision_type: "allow_tool",
        tool_name: "character_roster",
        tool_status: "succeeded",
        tool_called: true,
        production_write_performed: false,
        artifact_adopted: false,
        execution_blocked: false,
        accepted_character_visible: true,
        tentative_character_absent: true,
        foreign_character_absent: true,
        no_write_statement_visible: true,
        no_state_delta: true,
        no_artifact_refs: true,
        no_author_action_sent: true,
        no_adoption_event: true,
        no_execution_controls_visible: true,
        trace_query_has_tool_trace_ref: true,
        trace_query_tool_trace_refs: [toolTraceRef],
        replay_report_provider_called: false,
        replay_report_result_status: "complete",
        replay_report_missing_trace_refs: [],
        replay_report_chain_steps: replayChainSteps,
        replay_report_required_question_count: 6,
        replay_report_question_statuses: replayQuestionStatuses,
        replay_report_all_required_questions_answered: true,
        replay_report_tool_question_answered: true,
        replay_report_adoption_boundary_answered: true,
        replay_report_has_frame_plan_decision_tool_turn_result: true,
        character_names: ["林澈"],
      },
    ];

    const evidence = findNativeSliceEvidence("e2e-01-replay-report", records);
    expect(evidence).toEqual({
      slice_id: "e2e-01-replay-report",
      turn_id: "turn-e2e-replay",
      turn_ids: ["turn-e2e-replay"],
      decision_type: "allow_tool",
      tool_name: "character_roster",
      trace_query_tool_trace_refs: [toolTraceRef],
      replay_report_chain_steps: replayChainSteps,
      replay_report_question_statuses: replayQuestionStatuses,
      key_events: keyEventsForSlice("e2e-01-replay-report"),
    });
    expect(findSliceBehaviorEvidence("e2e-01-replay-report", records, evidence)).toEqual({
      slice_id: "e2e-01-replay-report",
      behavior: "real_page_trace_builds_complete_six_question_replay_report",
      turn_ids: ["turn-e2e-replay"],
      decision_type: "allow_tool",
      tool_name: "character_roster",
      trace_query_tool_trace_refs: [toolTraceRef],
      replay_report_chain_steps: replayChainSteps,
      replay_report_question_statuses: replayQuestionStatuses,
      assertions: [
        "real_workbench_sent_readonly_character_roster_request_from_visible_chat_input",
        "frame_tool_need_triggered_micro_plan_without_product_acceptance_hook",
        "orchestrator_allowed_low_risk_character_roster_tool",
        "toolbox_executed_character_roster_successfully",
        "accepted_character_visible_without_tentative_or_foreign_character_leakage",
        "turn_result_reported_tool_called_without_adoption_or_production_write",
        "no_author_action_adoption_or_execution_controls_visible",
        "trace_repository_list_by_turn_returned_tool_trace_ref",
        "replay_report_built_from_persisted_trace_without_provider_call",
        "replay_report_answered_vs06_six_required_questions",
        "replay_report_chain_includes_frame_plan_decision_tool_and_turn_result",
        "deterministic_provider_frame_and_micro_plan_called_for_readonly_tool_turn",
      ],
    });
  });

  it("accepts AU-07 ToolTrace registry snapshot and redacted IO evidence", () => {
    const toolTraceRef = {
      tool_name: "character_roster",
      tool_request_ref: "tq-au07-tooltrace",
      tool_result_ref: "tr-au07-tooltrace",
      tool_status: "succeeded",
      registry_snapshot: {
        tool_name: "character_roster",
        tool_version: "1.0.0",
        status: "active",
        tool_layer: "memory",
      },
      contract_refs: {
        input_contract_ref: "character_roster_query_v1",
        output_contract_ref: "character_roster_result_v1",
      },
      grant_summary: {
        requested_read_scopes: ["character_list"],
        requested_write_scopes: [],
        grants_within_registry: true,
      },
      request_summary: { payload_stored: false, keys: ["characters"] },
      result_summary: { payload_stored: false, keys: ["character_count", "characters"] },
      io_redaction: { input_payload_stored: false, output_payload_stored: false },
    };
    const registrySnapshot = toolTraceRef.registry_snapshot;
    const contractRefs = toolTraceRef.contract_refs;
    const grantSummary = toolTraceRef.grant_summary;
    const requestSummary = toolTraceRef.request_summary;
    const resultSummary = toolTraceRef.result_summary;
    const ioRedaction = toolTraceRef.io_redaction;
    const replayQuestionStatuses = {
      decision_reason: "answered",
      planner_vs_decision: "answered",
      tool_approval: "answered",
      adoption_boundary: "answered",
      behavior_lifecycle: "not_applicable",
      turn_result_surface: "answered",
    };
    const replayChainSteps = ["frame", "plan", "decision", "tool_trace", "turn_result"];
    const records = [
      {
        event: "channel.user_message.start",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
        generate_micro_plan: false,
      },
      {
        event: "dialogue_gateway.handle_input.start",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
      },
      {
        event: "planner.form_frame.done",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
      },
      {
        event: "planner.form_micro_plan.done",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
      },
      {
        event: "orchestrator.decide.done",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
        decision_type: "allow_tool",
      },
      {
        event: "context.characters.done",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
        source_type: "character_dossier",
        character_count: 1,
      },
      {
        event: "toolbox.execute.done",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
        tool_name: "character_roster",
        tool_outcome: "succeeded",
      },
      {
        event: "dialogue_gateway.handle_input.done",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "au07-tooltrace-registry-redacted-io",
        turn_id: "turn-au07-tooltrace",
        workspace_id: "work-au07-tooltrace",
        work_id: "work-au07-tooltrace",
        session_id: "session-au07-tooltrace",
        decision_type: "allow_tool",
        tool_name: "character_roster",
        tool_status: "succeeded",
        tool_called: true,
        production_write_performed: false,
        artifact_adopted: false,
        execution_blocked: false,
        accepted_character_visible: true,
        tentative_character_absent: true,
        foreign_character_absent: true,
        no_write_statement_visible: true,
        no_state_delta: true,
        no_artifact_refs: true,
        no_author_action_sent: true,
        no_adoption_event: true,
        no_execution_controls_visible: true,
        trace_query_has_tool_trace_ref: true,
        trace_query_tool_trace_refs: [toolTraceRef],
        tool_trace_registry_snapshot: registrySnapshot,
        tool_trace_contract_refs: contractRefs,
        tool_trace_grant_summary: grantSummary,
        tool_trace_request_summary: requestSummary,
        tool_trace_result_summary: resultSummary,
        tool_trace_io_redaction: ioRedaction,
        tool_trace_registry_snapshot_complete: true,
        tool_trace_redacted_io_no_raw_payload: true,
        replay_report_tool_trace_carries_registry_snapshot: true,
        replay_report_provider_called: false,
        replay_report_result_status: "complete",
        replay_report_missing_trace_refs: [],
        replay_report_chain_steps: replayChainSteps,
        replay_report_required_question_count: 6,
        replay_report_question_statuses: replayQuestionStatuses,
        replay_report_all_required_questions_answered: true,
        replay_report_tool_question_answered: true,
        replay_report_adoption_boundary_answered: true,
        replay_report_has_frame_plan_decision_tool_turn_result: true,
        au07_tooltrace_registry_snapshot_closed: true,
        au07_tooltrace_redacted_io_closed: true,
        au07_tooltrace_replay_report_chain_closed: true,
      },
    ];

    const correlatedRecords = records.map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? record
        : { duration_ms: 1, outcome: "done", ...record },
    );

    const evidence = findNativeSliceEvidence(
      "au07-tooltrace-registry-redacted-io",
      correlatedRecords,
    );
    expect(evidence).toEqual({
      slice_id: "au07-tooltrace-registry-redacted-io",
      turn_id: "turn-au07-tooltrace",
      turn_ids: ["turn-au07-tooltrace"],
      decision_type: "allow_tool",
      tool_name: "character_roster",
      trace_query_tool_trace_refs: [toolTraceRef],
      tool_trace_registry_snapshot: registrySnapshot,
      tool_trace_contract_refs: contractRefs,
      tool_trace_grant_summary: grantSummary,
      tool_trace_request_summary: requestSummary,
      tool_trace_result_summary: resultSummary,
      tool_trace_io_redaction: ioRedaction,
      replay_report_chain_steps: replayChainSteps,
      replay_report_question_statuses: replayQuestionStatuses,
      key_events: keyEventsForSlice("au07-tooltrace-registry-redacted-io"),
    });
    expect(
      findSliceBehaviorEvidence("au07-tooltrace-registry-redacted-io", correlatedRecords, evidence),
    ).toEqual({
      slice_id: "au07-tooltrace-registry-redacted-io",
      behavior: "real_page_tooltrace_carries_registry_snapshot_and_redacted_io",
      turn_ids: ["turn-au07-tooltrace"],
      decision_type: "allow_tool",
      tool_name: "character_roster",
      trace_query_tool_trace_refs: [toolTraceRef],
      tool_trace_registry_snapshot: registrySnapshot,
      tool_trace_contract_refs: contractRefs,
      tool_trace_grant_summary: grantSummary,
      tool_trace_request_summary: requestSummary,
      tool_trace_result_summary: resultSummary,
      tool_trace_io_redaction: ioRedaction,
      replay_report_chain_steps: replayChainSteps,
      replay_report_question_statuses: replayQuestionStatuses,
      assertions: [
        "real_workbench_sent_readonly_character_roster_request_from_visible_chat_input",
        "frame_tool_need_triggered_micro_plan_without_product_acceptance_hook",
        "orchestrator_allowed_low_risk_character_roster_tool",
        "toolbox_executed_character_roster_successfully",
        "accepted_character_visible_without_tentative_or_foreign_character_leakage",
        "turn_result_reported_tool_called_without_adoption_or_production_write",
        "no_author_action_adoption_or_execution_controls_visible",
        "trace_repository_list_by_turn_returned_tool_trace_ref",
        "deterministic_provider_frame_and_micro_plan_called_for_readonly_tool_turn",
        "tool_trace_recorded_registry_snapshot_name_version_status_layer",
        "tool_trace_recorded_input_output_contract_refs",
        "tool_trace_recorded_grants_within_registry_without_write_grants",
        "tool_trace_recorded_redacted_request_result_summaries_without_raw_payload",
        "replay_report_tool_trace_chain_preserved_registry_and_redaction_boundary",
        "replay_report_built_from_persisted_trace_without_provider_call",
      ],
    });
  });

  it("accepts E2E-01 channel action security when forged protocol actions are rejected", () => {
    const records = [
      {
        event: "channel.join.done",
        workspace_id: "work-e2e-sec",
        work_id: "work-e2e-sec",
        session_id: "session-e2e-sec",
      },
      {
        event: "channel.join.done",
        workspace_id: "work-e2e-sec",
        work_id: "work-e2e-sec",
        session_id: "session-e2e-sec",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-e2e-sec-1",
        workspace_id: "work-e2e-sec",
        work_id: "work-e2e-sec",
        session_id: "session-e2e-sec",
        duration_ms: 10,
        outcome: "done",
      },
      {
        event: "channel.user_message.done",
        turn_id: "turn-e2e-sec-2",
        workspace_id: "work-e2e-sec",
        work_id: "work-e2e-sec",
        session_id: "session-e2e-sec",
        duration_ms: 11,
        outcome: "done",
      },
      {
        event: "channel.author_action.start",
        turn_id: "turn-e2e-sec-1",
        workspace_id: "work-e2e-sec",
        work_id: "work-e2e-sec",
        session_id: "session-e2e-sec",
        action_id: "act-forged-sec",
        action_type: "confirm_before_execute",
      },
      {
        event: "channel.author_action.error",
        turn_id: "turn-e2e-sec-1",
        workspace_id: "work-e2e-sec",
        work_id: "work-e2e-sec",
        session_id: "session-e2e-sec",
        action_id: "act-forged-sec",
        action_type: "confirm_before_execute",
        reason_code: "dialogue_gateway_rejected",
        outcome_detail:
          "invented action: confirm_before_execute:act-forged-sec not in available actions",
      },
      {
        event: "channel.author_action.start",
        turn_id: "turn-e2e-sec-1",
        workspace_id: "work-e2e-sec",
        work_id: "work-e2e-sec",
        session_id: "session-e2e-sec",
        action_id: "act-stale-sec",
        action_type: "confirm_before_execute",
      },
      {
        event: "channel.author_action.error",
        turn_id: "turn-e2e-sec-1",
        workspace_id: "work-e2e-sec",
        work_id: "work-e2e-sec",
        session_id: "session-e2e-sec",
        action_id: "act-stale-sec",
        action_type: "confirm_before_execute",
        reason_code: "dialogue_gateway_rejected",
        outcome_detail: "stale action: source_turn_ref turn-e2e-sec-1 != current turn-e2e-sec-2",
      },
      {
        event: "slice_verify.ui_state.done",
        slice_id: "e2e-01-channel-action-security",
        turn_id: "turn-e2e-sec-2",
        turn_ids: ["turn-e2e-sec-1", "turn-e2e-sec-2"],
        workspace_id: "work-e2e-sec",
        work_id: "work-e2e-sec",
        session_id: "session-e2e-sec",
        real_page_anchor_visible: true,
        current_turn_advanced: true,
        invented_action_id: "act-forged-sec",
        stale_action_id: "act-stale-sec",
        invented_action_rejected: true,
        stale_action_rejected: true,
        invented_error_reason:
          "invented action: confirm_before_execute:act-forged-sec not in available actions",
        stale_error_reason:
          "stale action: source_turn_ref turn-e2e-sec-1 != current turn-e2e-sec-2",
        client_source_turn_result_ignored: true,
        forged_stale_source_rejected: true,
        author_action_error_count: 2,
        action_result_broadcast_count_after_rejections: 0,
        author_action_done_count_for_forged_actions: 0,
        no_action_result_broadcast_after_rejections: true,
        no_author_action_done_for_forged_actions: true,
        product_acceptance_logic_added: false,
      },
    ];

    const evidence = findNativeSliceEvidence("e2e-01-channel-action-security", records);
    expect(evidence).toEqual({
      slice_id: "e2e-01-channel-action-security",
      turn_id: "turn-e2e-sec-2",
      turn_ids: ["turn-e2e-sec-1", "turn-e2e-sec-2"],
      work_id: "work-e2e-sec",
      session_id: "session-e2e-sec",
      invented_action_id: "act-forged-sec",
      stale_action_id: "act-stale-sec",
      invented_error_reason:
        "invented action: confirm_before_execute:act-forged-sec not in available actions",
      stale_error_reason: "stale action: source_turn_ref turn-e2e-sec-1 != current turn-e2e-sec-2",
      author_action_error_count: 2,
      key_events: keyEventsForSlice("e2e-01-channel-action-security"),
    });
    expect(findSliceBehaviorEvidence("e2e-01-channel-action-security", records, evidence)).toEqual({
      slice_id: "e2e-01-channel-action-security",
      behavior: "external_protocol_forged_author_actions_rejected_by_server_held_turn_result",
      turn_ids: ["turn-e2e-sec-1", "turn-e2e-sec-2"],
      work_id: "work-e2e-sec",
      session_id: "session-e2e-sec",
      invented_action_id: "act-forged-sec",
      stale_action_id: "act-stale-sec",
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
    });
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

  it("accepts AU-07 behavior terminal replay only with recorded close resolution refs", () => {
    const records = au07BehaviorTraceTerminalReplayRecords();
    const evidence = findNativeSliceEvidence("au07-behavior-trace-terminal-replay", records);

    expect(evidence).toEqual({
      slice_id: "au07-behavior-trace-terminal-replay",
      turn_id: "turn-cancelled",
      turn_ids: ["turn-confirm", "turn-cancelled", "turn-after-cancel"],
      confirmation_turn_id: "turn-confirm",
      cancel_turn_id: "turn-cancelled",
      following_turn_id: "turn-after-cancel",
      action_id: "reject:artifact-1",
      action_type: "reject_or_cancel_confirmation",
      cancel_trace_ref: "trace:turn-cancelled",
      behavior_trace_ref: "bh-terminal",
      behavior_trace_event_type: "close",
      behavior_trace_next_status: "CANCELLED",
      behavior_trace_event_turn_ref: "turn-cancelled",
      behavior_trace_resolution_ref: "behavior_resolution:turn-cancelled",
      key_events: keyEventsForSlice("au07-behavior-trace-terminal-replay"),
    });

    expect(
      findSliceBehaviorEvidence("au07-behavior-trace-terminal-replay", records, evidence),
    ).toEqual({
      slice_id: "au07-behavior-trace-terminal-replay",
      behavior: "terminal_behavior_replayable_from_recorded_close_resolution_refs",
      turn_ids: ["turn-confirm", "turn-cancelled", "turn-after-cancel"],
      confirmation_turn_id: "turn-confirm",
      cancel_turn_id: "turn-cancelled",
      following_turn_id: "turn-after-cancel",
      action_id: "reject:artifact-1",
      action_type: "reject_or_cancel_confirmation",
      cancel_trace_ref: "trace:turn-cancelled",
      behavior_trace_ref: "bh-terminal",
      behavior_trace_event_type: "close",
      behavior_trace_next_status: "CANCELLED",
      behavior_trace_resolution_ref: "behavior_resolution:turn-cancelled",
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
    });
  });

  it("rejects AU-07 behavior terminal replay without a resolution ref", () => {
    const records = au07BehaviorTraceTerminalReplayRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, behavior_trace_resolution_ref: "" }
        : record,
    );

    expect(findNativeSliceEvidence("au07-behavior-trace-terminal-replay", records)).toBeNull();
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

  it("finds AU-12 work profile status and isolation evidence", () => {
    const records = au12WorkProfileStatusIsolationRecords();
    const evidence = findNativeSliceEvidence("au12-work-profile-status-isolation", records);

    expect(evidence).toEqual({
      slice_id: "au12-work-profile-status-isolation",
      accepted_work_id: "work-accepted",
      accepted_work_title: "AU12已确认档案作品",
      empty_work_id: "work-empty",
      empty_work_title: "AU12空字段档案作品",
      accepted_profile_status: "ACCEPTED",
      empty_profile_status: "TENTATIVE",
      empty_fields_visible_count: 4,
      key_events: keyEventsForSlice("au12-work-profile-status-isolation"),
    });
  });

  it("accepts AU-12 status isolation behavior when archive viewing stays readonly", () => {
    const records = au12WorkProfileStatusIsolationRecords();
    const evidence = findNativeSliceEvidence("au12-work-profile-status-isolation", records);

    expect(
      findSliceBehaviorEvidence("au12-work-profile-status-isolation", records, evidence),
    ).toEqual({
      slice_id: "au12-work-profile-status-isolation",
      behavior: "author_checks_profile_status_missing_fields_and_cross_work_archive_isolation",
      turn_ids: [],
      accepted_work_id: "work-accepted",
      accepted_work_title: "AU12已确认档案作品",
      empty_work_id: "work-empty",
      empty_work_title: "AU12空字段档案作品",
      accepted_profile_status: "ACCEPTED",
      empty_profile_status: "TENTATIVE",
      empty_fields_visible_count: 4,
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
    });
  });

  it("finds AU-12 profile read failure degradation evidence", () => {
    const records = au12ProfileReadFailureDegradeRecords();
    const evidence = findNativeSliceEvidence("au12-profile-read-failure-degrade", records);

    expect(evidence).toEqual({
      slice_id: "au12-profile-read-failure-degrade",
      work_id: "work-au12-read-failure",
      work_title: "AU12读取失败作品",
      key_events: keyEventsForSlice("au12-profile-read-failure-degrade"),
    });
  });

  it("accepts AU-12 profile read failure behavior only after visible retry recovers real fields", () => {
    const records = au12ProfileReadFailureDegradeRecords();
    const evidence = findNativeSliceEvidence("au12-profile-read-failure-degrade", records);

    expect(
      findSliceBehaviorEvidence("au12-profile-read-failure-degrade", records, evidence),
    ).toEqual({
      slice_id: "au12-profile-read-failure-degrade",
      behavior: "work_profile_read_failure_degrades_honestly_and_recovers_on_retry",
      turn_ids: [],
      work_id: "work-au12-read-failure",
      work_title: "AU12读取失败作品",
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
    });
  });

  it("rejects AU-12 profile read failure evidence when the failure renders as empty fields", () => {
    const records = au12ProfileReadFailureDegradeRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? { ...record, profile_failure_rows_hidden: false }
        : record,
    );

    expect(findNativeSliceEvidence("au12-profile-read-failure-degrade", records)).toBeNull();
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
      urls: ["http://localhost:1234/v1/chat/completions"],
    });
  });

  it("matches real DeepSeek chat completion logs by turn id", () => {
    const evidence = findLiveProviderEvidence(
      "deepseek",
      ["turn-deepseek"],
      [
        {
          turn_id: "turn-deepseek",
          provider: "deepseek",
          request: { method: "POST", url: "https://api.deepseek.com/chat/completions" },
          response: { status: 200 },
        },
      ],
    );

    expect(evidence).toEqual({
      provider: "deepseek",
      turn_ids: ["turn-deepseek"],
      request_count: 1,
      status_codes: [200],
      urls: ["https://api.deepseek.com/chat/completions"],
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
      lmRecord("turn-a", "judgment", "可以，我们先聊小说创作。"),
      lmRecord("turn-b", "judgment", "还可以从人物和世界规则继续展开。"),
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
        "agent_run_activity_appeared_during_each_turn_and_legacy_thinking_cleared",
        "trivial_completed_agent_run_summaries_cleared_after_reply",
        "micro_plan_not_requested",
        "no_action_candidate_or_adoption_cards_rendered",
        "no_error_events",
        "assistant_messages_not_fallback",
        "lmstudio_judgment_called_per_turn",
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
    ).toContain("deterministic_provider_judgment_called_per_turn");
  });

  it("accepts non-exploration frame behavior without action or write semantics", () => {
    const records = gapWt04NonExplorationFrameRecords();
    const evidence = findNativeSliceEvidence(
      "gap-wt04-non-exploration-frame-badges",
      records,
    );

    expect(
      findSliceBehaviorEvidence(
        "gap-wt04-non-exploration-frame-badges",
        records,
        evidence,
        { provider: "slice_verify" },
      ),
    ).toEqual({
      slice_id: "gap-wt04-non-exploration-frame-badges",
      behavior: "non_exploration_frames_are_visibly_distinct_without_execution",
      turn_ids: ["turn-question", "turn-meta"],
      assertions: [
        "question_answer_frame_rendered_as_answer_badge",
        "meta_discussion_frame_rendered_as_discussion_badge",
        "semantic_badge_tones_are_distinct",
        "badges_remain_inside_assistant_messages",
        "micro_plan_not_requested",
        "no_action_candidate_adoption_or_production_write",
        "assistant_messages_not_fallback",
        "deterministic_provider_judgment_called_per_turn",
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

  it("accepts AU-05 discard author_action behavior when discard does not write reading projection", () => {
    const records = au05DiscardAuthorActionRecords("turn-discard-source");
    const evidence = findNativeSliceEvidence("au05-discard-author-action", records);

    expect(evidence).toEqual({
      slice_id: "au05-discard-author-action",
      turn_id: "turn-discard-source",
      turn_ids: ["turn-discard-source"],
      draft_turn_id: "turn-discard-source",
      discard_turn_id: "turn-discard-result",
      artifact_id: "as-1",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      chapter_count_after_discard: 12,
      total_word_count_after_discard: 0,
      empty_chapter_count_after_discard: 12,
      content_chars_after_discard: 0,
      key_events: keyEventsForSlice("au05-discard-author-action"),
    });

    expect(findSliceBehaviorEvidence("au05-discard-author-action", records, evidence)).toEqual({
      slice_id: "au05-discard-author-action",
      behavior: "discard_author_action_resolves_pending_artifact_without_production_write",
      turn_ids: ["turn-discard-source"],
      artifact_id: "as-1",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      chapter_count_after_discard: 12,
      total_word_count_after_discard: 0,
      content_chars_after_discard: 0,
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

  it("accepts AU-08 reading readonly no-write when export and return stay readonly", () => {
    const records = au08ReadingReadonlyNoWriteRecords();
    const evidence = findNativeSliceEvidence("au08-reading-readonly-no-write", records);

    expect(evidence).toMatchObject({
      slice_id: "au08-reading-readonly-no-write",
      turn_id: "turn-au08-readonly-draft",
      draft_turn_id: "turn-au08-readonly-draft",
      export_path: "/tmp/au08-readonly.md",
      export_chapter_count: 1,
      reading_write_control_count: 0,
      author_action_sent_count_during_reading: 0,
      user_message_sent_count_during_reading: 0,
      toolbox_execute_count_during_reading: 0,
      key_events: keyEventsForSlice("au08-reading-readonly-no-write"),
    });
    expect(
      findSliceBehaviorEvidence("au08-reading-readonly-no-write", records, evidence),
    ).toMatchObject({
      slice_id: "au08-reading-readonly-no-write",
      behavior: "reading_mode_view_export_and_return_stay_readonly_without_write_controls",
      turn_ids: ["turn-au08-readonly-draft"],
      export_path: "/tmp/au08-readonly.md",
      assertions: expect.arrayContaining([
        "reading_mode_exposes_no_adoption_confirmation_or_chat_write_controls",
        "reading_mode_export_and_return_emit_no_author_action_or_user_message",
        "reading_mode_export_and_return_do_not_trigger_adoption_or_tool_execution",
        "reading_mode_export_and_return_do_not_claim_production_write",
        "workbench_context_returns_with_input_enabled_after_reading",
      ]),
    });
  });

  it("rejects AU-08 reading readonly evidence when reading emits author action", () => {
    const records = au08ReadingReadonlyNoWriteRecords().map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? {
            ...record,
            no_author_action_sent_during_reading: false,
            author_action_sent_count_during_reading: 1,
          }
        : record,
    );

    expect(findNativeSliceEvidence("au08-reading-readonly-no-write", records)).toBeNull();
  });

  it("accepts AU-08 reading return context when follow-up stays in the same work/session", () => {
    const records = au08ReadingReturnContextRecords();
    const evidence = findNativeSliceEvidence("au08-reading-return-context", records);

    expect(evidence).toMatchObject({
      slice_id: "au08-reading-return-context",
      turn_id: "turn-au08-return-followup",
      draft_turn_id: "turn-au08-readonly-draft",
      adopt_turn_id: "turn-au08-readonly-adopt",
      followup_turn_id: "turn-au08-return-followup",
      work_id: "work-au08-readonly",
      session_id: "session-au08-readonly",
      key_events: keyEventsForSlice("au08-reading-return-context"),
    });
    expect(
      findSliceBehaviorEvidence("au08-reading-return-context", records, evidence),
    ).toMatchObject({
      slice_id: "au08-reading-return-context",
      behavior: "reading_return_preserves_workbench_work_and_session_for_followup_turn",
      followup_turn_id: "turn-au08-return-followup",
      work_id: "work-au08-readonly",
      session_id: "session-au08-readonly",
      assertions: expect.arrayContaining([
        "reading_mode_return_button_restores_real_workbench",
        "followup_message_after_return_uses_same_work_id",
        "followup_message_after_return_uses_same_session_id",
        "followup_turn_result_received_in_same_session",
      ]),
    });
  });

  it("rejects AU-08 reading return context when follow-up switches session", () => {
    const records = au08ReadingReturnContextRecords().map((record) =>
      record.event === "channel.user_message.done" && record.turn_id === "turn-au08-return-followup"
        ? { ...record, session_id: "session-other" }
        : record,
    );

    expect(findNativeSliceEvidence("au08-reading-return-context", records)).toBeNull();
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

  it("accepts AU-07 state trace adoption replay only when adoption and projection share state trace", () => {
    const records = au07StateTraceAdoptionReplayRecords("turn-au07-draft", "turn-au07-adopt");
    const evidence = findNativeSliceEvidence("au07-state-trace-adoption-replay", records);

    expect(evidence).toEqual({
      slice_id: "au07-state-trace-adoption-replay",
      turn_id: "turn-au07-adopt",
      turn_ids: ["turn-au07-draft", "turn-au07-adopt"],
      draft_turn_id: "turn-au07-draft",
      adopt_turn_id: "turn-au07-adopt",
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      chapter_count: 12,
      content_chars: 64,
      total_word_count: 24,
      chapter_word_count: 24,
      expected_word_count: 24,
      state_trace_ref: "state_trace:ad-au07",
      adoption_trace_ref: "trace:turn-au07-adopt",
      projection_source_state_trace_ref: "state_trace:ad-au07",
      projection_refresh_status: "STALE",
      projection_stale_banner_visible: true,
      projection_refresh_button_visible: true,
      key_events: keyEventsForSlice("au07-state-trace-adoption-replay"),
    });

    expect(
      findSliceBehaviorEvidence("au07-state-trace-adoption-replay", records, evidence),
    ).toEqual({
      slice_id: "au07-state-trace-adoption-replay",
      behavior: "adoption_and_reading_projection_replayable_from_state_trace_refs",
      turn_ids: ["turn-au07-draft", "turn-au07-adopt"],
      artifact_id: "artifact-prose-1",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      total_word_count: 24,
      chapter_word_count: 24,
      expected_word_count: 24,
      content_chars: 64,
      adopt_turn_id: "turn-au07-adopt",
      state_trace_ref: "state_trace:ad-au07",
      adoption_trace_ref: "trace:turn-au07-adopt",
      projection_source_state_trace_ref: "state_trace:ad-au07",
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
        "adoption_turn_trace_summary_recorded_state_trace_ref",
        "resolved_adoption_entry_references_same_state_trace",
        "projection_ref_references_same_source_state_trace",
        "state_trace_ref_is_bound_to_action_turn_trace_ref",
      ],
    });
  });

  it("rejects AU-07 state trace replay when projection does not point to state trace", () => {
    const records = au07StateTraceAdoptionReplayRecords("turn-au07-draft", "turn-au07-adopt").map(
      (record) =>
        record.event === "slice_verify.ui_state.done"
          ? { ...record, projection_source_state_trace_ref: "state_trace:other" }
          : record,
    );

    expect(findNativeSliceEvidence("au07-state-trace-adoption-replay", records)).toBeNull();
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

  it("accepts AU-08 volume structured planning only when the adopted plan renders two volumes", () => {
    const records = au08VolumeStructuredPlanningRecords();
    const evidence = findNativeSliceEvidence("au08-volume-structured-planning", records);

    expect(evidence).toEqual({
      slice_id: "au08-volume-structured-planning",
      turn_id: "turn-au08:agent:4",
      turn_ids: ["turn-au08", "turn-au08:agent:4"],
      generation_turn_id: "turn-au08:agent:4",
      parent_turn_id: "turn-au08",
      adoption_turn_id: "turn-au08-adopt",
      artifact_id: "artifact-outline-au08",
      chapter_count: 12,
      volume_headers: ["第一卷·觉醒 · 5章", "第二卷·裂变 · 7章"],
      volume_chapter_counts: [5, 7],
      chapter_titles_by_volume: [au08VolumeOneChapters(), au08VolumeTwoChapters()],
      reading_toc_volume_headers: ["第一卷·觉醒", "第二卷·裂变"],
      key_events: keyEventsForSlice("au08-volume-structured-planning"),
    });

    expect(
      findSliceBehaviorEvidence("au08-volume-structured-planning", records, evidence, {
        provider: "slice_verify",
      }),
    ).toEqual({
      slice_id: "au08-volume-structured-planning",
      behavior: "chapter_plan_materialized_into_declared_volumes_and_read_by_volume",
      turn_ids: ["turn-au08", "turn-au08:agent:4"],
      chapter_count: 12,
      volume_headers: ["第一卷·觉醒 · 5章", "第二卷·裂变 · 7章"],
      volume_chapter_counts: [5, 7],
      assertions: [
        "real_archive_outline_start_planning_clicked",
        "micro_plan_requested_from_real_workbench",
        "plot_outline_capability_selected_by_judgment_and_run_bounded",
        "plot_outline_generated_outline_draft_with_per_chapter_volume_assignment",
        "outline_draft_adopted_through_adoption_boundary",
        "plan_materialized_into_multiple_volumes",
        "archive_outline_rendered_two_volume_headers_with_chapter_counts",
        "volume_chapter_membership_matches_adopted_plan_assignment",
        "reading_toc_grouped_by_volume",
        "toc_projection_returned_two_volumes",
      ],
    });
  });

  it("rejects AU-08 volume evidence when the outline still renders a single volume", () => {
    const records = au08VolumeStructuredPlanningRecords({
      uiStateOverrides: {
        volume_headers: ["第一卷·觉醒 · 12章"],
        volume_chapter_counts: [12],
        chapter_titles_by_volume: [[...au08VolumeOneChapters(), ...au08VolumeTwoChapters()]],
        reading_toc_volume_headers: ["第一卷·觉醒"],
      },
      tocOverrides: { volume_count: 1 },
    });

    expect(findNativeSliceEvidence("au08-volume-structured-planning", records)).toBeNull();
  });

  it("rejects AU-08 volume evidence when a chapter is rendered under the wrong volume", () => {
    const volumeOne = au08VolumeOneChapters();
    const volumeTwo = au08VolumeTwoChapters();
    // 章数与卷表头都不变，只把一章挪到隔壁卷：分组与采纳的计划标注不再一致。
    const swappedOne = [...volumeOne.slice(0, 4), volumeTwo[0]];
    const swappedTwo = [volumeOne[4], ...volumeTwo.slice(1)];

    const records = au08VolumeStructuredPlanningRecords({
      uiStateOverrides: { chapter_titles_by_volume: [swappedOne, swappedTwo] },
    });

    expect(findNativeSliceEvidence("au08-volume-structured-planning", records)).toBeNull();
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
      event: "judgment.decided.done",
      turn_id: turnId,
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 12,
      outcome: "ok",
      candidate_count: 0,
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
      message_text_indexes: [
        { snippet: "first user", index: 0, role: "user" },
        { snippet: "first assistant", index: 1, role: "assistant" },
        { snippet: "second user", index: 2, role: "user" },
        { snippet: "second assistant", index: 3, role: "assistant" },
      ],
      message_text_order_anchored: true,
      agent_run_activity_indexes: [],
      agent_run_activity_count: 0,
      second_agent_run_activity_anchored: false,
      agent_run_activity_observed: true,
      terminal_agent_run_activity_cleared: true,
      thinking_visible_after_reply: false,
      available_action_count: 0,
      card_action_count: 0,
      candidate_panel_count: 0,
      adoption_decision_card_count: 0,
    },
  ];
}

function gapWt04NonExplorationFrameRecords() {
  const records = [
    ["turn-question", "question_answer"],
    ["turn-meta", "meta_discussion"],
  ].flatMap(([turnId, frameType]) => [
    {
      event: "channel.user_message.start",
      turn_id: turnId,
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 0,
      outcome: "start",
      text_len: 32,
      generate_micro_plan: false,
    },
    {
      event: "judgment.decided.done",
      turn_id: turnId,
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 12,
      outcome: "ok",
      frame_type: frameType,
      candidate_count: 0,
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
      turn_id: "turn-meta",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "gap-wt04-non-exploration-frame-badges",
      ui_turn_ids: ["turn-question", "turn-meta"],
      question_frame_type: "question_answer",
      meta_frame_type: "meta_discussion",
      question_badge: {
        label: "回答问题",
        title: "回答问题：诊断章节爽感不足和胜利过轻",
        background_color: "rgba(32, 118, 110, 0.08)",
        border_color: "rgba(32, 118, 110, 0.35)",
        color: "rgb(20, 83, 77)",
        width: 64,
        height: 24,
        within_assistant_message: true,
      },
      meta_badge: {
        label: "创作讨论",
        title: "创作讨论：约定先讨论方案再决定是否生成的协作方式",
        background_color: "rgba(97, 84, 170, 0.08)",
        border_color: "rgba(97, 84, 170, 0.32)",
        color: "rgb(71, 63, 145)",
        width: 64,
        height: 24,
        within_assistant_message: true,
      },
      semantic_tones_distinct: true,
      question_answer_visible: true,
      meta_discussion_visible: true,
      available_action_count: 0,
      candidate_panel_count: 0,
      no_author_action_sent: true,
      no_action_result_received: true,
      production_write_performed: false,
    },
  ];
}

function emptyMessageGuardRecords() {
  return [
    {
      event: "channel.user_message.start",
      turn_id: "turn-recovery",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 0,
      outcome: "start",
      text_len: 23,
      generate_micro_plan: false,
    },
    {
      event: "judgment.decided.done",
      turn_id: "turn-recovery",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 12,
      outcome: "ok",
      candidate_count: 0,
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-recovery",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 14,
      outcome: "ok",
    },
    {
      event: "slice_verify.ui_state.done",
      turn_id: "turn-recovery",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au01-empty-message-guard",
      recovery_turn_id: "turn-recovery",
      blank_attempted: true,
      blank_user_message_frame_count: 0,
      message_count_unchanged_after_blank: true,
      input_enabled_after_blank: true,
      thinking_visible_after_blank: false,
      recovery_message_visible: true,
      recovery_assistant_reply_visible: true,
      recovery_generate_micro_plan: false,
    },
  ];
}

function garbageJsonRecoveryRecords() {
  // 判断纪元（ADR-0025）：垃圾 turn 判断未落地（无 judgment.decided.done，S7 安全
  // 终局）；恢复 turn 判断落地。
  const records = ["turn-garbage", "turn-recovery"].flatMap((turnId) => [
    {
      event: "channel.user_message.start",
      turn_id: turnId,
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 0,
      outcome: "start",
      text_len: turnId === "turn-garbage" ? 36 : 22,
      generate_micro_plan: false,
    },
    {
      event: "context.assemble.done",
      turn_id: turnId,
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 8,
      outcome: "ok",
    },
    ...(turnId === "turn-recovery"
      ? [
          {
            event: "judgment.decided.done",
            turn_id: turnId,
            workspace_id: "ws-chat",
            work_id: "work-chat",
            duration_ms: 12,
            outcome: "ok",
            action: "reply",
            frame_type: "casual_reply",
            candidate_count: 0,
          },
        ]
      : []),
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
      turn_id: "turn-garbage",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au01-garbage-json-recovery",
      garbage_turn_id: "turn-garbage",
      recovery_turn_id: "turn-recovery",
      fallback_message_visible: true,
      raw_provider_payload_visible: false,
      input_enabled_after_garbage: true,
      thinking_visible_after_garbage: false,
      channel_connected_after_garbage: true,
      garbage_generate_micro_plan: false,
      recovery_generate_micro_plan: false,
      recovery_message_visible: true,
      recovery_assistant_reply_visible: true,
      recovery_assistant_is_fallback: false,
    },
  ];
}

function frameValidationFriendlyErrorRecords() {
  return [
    {
      event: "channel.user_message.start",
      turn_id: "turn-invalid-frame",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 0,
      outcome: "start",
      text_len: 42,
      generate_micro_plan: false,
    },
    {
      event: "context.assemble.done",
      turn_id: "turn-invalid-frame",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 8,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-invalid-frame",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 14,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-recovery",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 0,
      outcome: "start",
      text_len: 24,
      generate_micro_plan: false,
    },
    {
      event: "context.assemble.done",
      turn_id: "turn-recovery",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 8,
      outcome: "ok",
    },
    {
      event: "judgment.decided.done",
      turn_id: "turn-recovery",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 12,
      outcome: "ok",
      action: "reply",
      frame_type: "casual_reply",
      candidate_count: 0,
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-recovery",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 14,
      outcome: "ok",
    },
    {
      event: "slice_verify.ui_state.done",
      turn_id: "turn-invalid-frame",
      workspace_id: "ws-chat",
      work_id: "work-chat",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au01-frame-validation-friendly-error",
      invalid_frame_turn_id: "turn-invalid-frame",
      recovery_turn_id: "turn-recovery",
      fallback_message_visible: true,
      internal_validation_reason_visible: false,
      internal_validation_reason_in_turn_result: false,
      input_enabled_after_invalid_frame: true,
      thinking_visible_after_invalid_frame: false,
      channel_connected_after_invalid_frame: true,
      invalid_frame_generate_micro_plan: false,
      recovery_generate_micro_plan: false,
      recovery_message_visible: true,
      recovery_assistant_reply_visible: true,
      recovery_assistant_is_fallback: false,
    },
  ];
}

function turnresultRecorderUiConsistencyRecords() {
  return [
    {
      event: "work_session.resume.done",
      workspace_id: "work-chat",
      work_id: "work-chat",
      session_id: "session-chat",
      transcript_count: 2,
      pending_adoption_count: 0,
      duration_ms: 8,
      outcome: "ok",
    },
    {
      event: "channel.join.done",
      workspace_id: "work-chat",
      work_id: "work-chat",
      session_id: "session-chat",
      duration_ms: 3,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-recorder",
      workspace_id: "work-chat",
      work_id: "work-chat",
      duration_ms: 0,
      outcome: "start",
      text_len: 30,
      generate_micro_plan: false,
    },
    {
      event: "judgment.decided.done",
      turn_id: "turn-recorder",
      workspace_id: "work-chat",
      work_id: "work-chat",
      duration_ms: 0,
      outcome: "ok",
      text_len: 30,
      generate_micro_plan: false,
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-recorder",
      workspace_id: "work-chat",
      work_id: "work-chat",
      duration_ms: 14,
      outcome: "ok",
    },
    {
      event: "work_session.show.done",
      workspace_id: "work-chat",
      work_id: "work-chat",
      session_id: "session-chat",
      read_only: false,
      transcript_count: 4,
      pending_adoption_count: 0,
      duration_ms: 5,
      outcome: "ok",
    },
    {
      event: "work_session.resume.done",
      workspace_id: "work-chat",
      work_id: "work-chat",
      session_id: "session-chat",
      transcript_count: 4,
      pending_adoption_count: 0,
      duration_ms: 7,
      outcome: "ok",
    },
    {
      event: "channel.join.done",
      workspace_id: "work-chat",
      work_id: "work-chat",
      session_id: "session-chat",
      duration_ms: 3,
      outcome: "ok",
    },
    {
      event: "slice_verify.ui_state.done",
      turn_id: "turn-recorder",
      turn_ids: ["turn-recorder"],
      workspace_id: "work-chat",
      work_id: "work-chat",
      context_work_id: "work-chat",
      session_id: "session-chat",
      active_session_id: "session-chat",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au01-turnresult-recorder-ui-consistency",
      sent_message_text: "请只和我聊雨夜悬疑开场的氛围，不写正文也不改设定。",
      assistant_text: "可以，我们先把雨夜开场的悬疑气质定成潮湿、克制、慢慢逼近。",
      current_ui_user_message_visible: true,
      current_ui_assistant_visible: true,
      transcript_user_row_found: true,
      transcript_assistant_row_found: true,
      transcript_user_text_matches_ui: true,
      transcript_assistant_text_matches_ui: true,
      transcript_turn_result_turn_id_matches_websocket: true,
      transcript_turn_result_assistant_text_matches_websocket: true,
      transcript_turn_result_assistant_text:
        "可以，我们先把雨夜开场的悬疑气质定成潮湿、克制、慢慢逼近。",
      transcript_count: 4,
      session_snapshot_read_only: false,
      reload_resume_transcript_count: 4,
      restored_ui_user_message_visible: true,
      restored_ui_assistant_visible: true,
      restored_input_enabled: true,
      restored_send_enabled: true,
      generate_micro_plan: false,
      thinking_observed: true,
      socket_connected: true,
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

function au07BehaviorTraceTerminalReplayRecords() {
  return au10WorkbenchRecoveryCancelWaitingRecords().map((record) => {
    if (record.event !== "slice_verify.ui_state.done") return record;

    return {
      ...record,
      slice_id: "au07-behavior-trace-terminal-replay",
      turn_id: "turn-after-cancel",
      cancel_trace_ref: "trace:turn-cancelled",
      behavior_trace_ref: "bh-terminal",
      behavior_trace_event_type: "close",
      behavior_trace_next_status: "CANCELLED",
      behavior_trace_event_turn_ref: "turn-cancelled",
      behavior_trace_resolution_ref: "behavior_resolution:turn-cancelled",
      behavior_trace_refs_count: 1,
    };
  });
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

function au12WorkProfileStatusIsolationRecords() {
  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au12-work-profile-status-isolation",
      accepted_work_id: "work-accepted",
      accepted_work_title: "AU12已确认档案作品",
      empty_work_id: "work-empty",
      empty_work_title: "AU12空字段档案作品",
      accepted_profile_status: "ACCEPTED",
      empty_profile_status: "TENTATIVE",
      accepted_status_visible: true,
      tentative_status_visible: true,
      empty_fields_visible_count: 4,
      accepted_profile_fields_visible: true,
      empty_profile_excludes_accepted_fields: true,
      accepted_archive_modules_visible: true,
      accepted_character_visible_before_switch: true,
      accepted_foreshadowing_visible_before_switch: true,
      accepted_rule_visible_before_switch: true,
      empty_archive_excludes_accepted_character: true,
      empty_archive_excludes_accepted_foreshadowing: true,
      empty_archive_excludes_accepted_rule: true,
      overview_navigation_verified: true,
      outline_navigation_verified: true,
      character_navigation_verified: true,
      foreshadowing_navigation_verified: true,
      rule_navigation_verified: true,
      accepted_profile_reply_omits_id: true,
      empty_profile_reply_omits_id: true,
      profile_replies_omit_work_uuid: true,
      profile_logs_omit_work_uuid: true,
      profile_ui_omits_work_uuid: true,
      readonly_no_write_logs: true,
      readonly_no_author_action_frames: true,
      real_archive_opened: true,
      real_work_switch_performed: true,
    },
    {
      event: "channel.get_work_profile.done",
      has_title: true,
      field_count: 8,
      status: "ACCEPTED",
    },
    {
      event: "channel.get_work_profile.done",
      has_title: true,
      field_count: 4,
      status: "TENTATIVE",
    },
  ];
}

function au12ProfileReadFailureDegradeRecords() {
  return [
    {
      event: "channel.join.done",
      work_id: "work-au12-read-failure",
      outcome: "ok",
    },
    {
      event: "channel.get_work_profile.done",
      has_title: true,
      field_count: 8,
      status: "TENTATIVE",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au12-profile-read-failure-degrade",
      work_id: "work-au12-read-failure",
      work_title: "AU12读取失败作品",
      profile_read_failure_visible: true,
      profile_retry_visible: true,
      profile_failure_copy_honest: true,
      profile_failure_rows_hidden: true,
      service_stopped_externally: true,
      offline_status_visible: true,
      service_restarted_externally: true,
      rejoin_observed: true,
      reconnected_status_visible: true,
      retry_clicked: true,
      profile_retry_log_emitted: true,
      profile_retry_recovered_fields: true,
      failure_cleared_after_retry: true,
      readonly_no_write_logs: true,
      readonly_no_author_action_frames: true,
      real_archive_opened: true,
      overview_tab_clicked: true,
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

function su02ArtifactProjectionTraceIsolationRecords() {
  return [
    {
      event: "work_session.resume.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a",
      transcript_count: 0,
      pending_adoption_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a",
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-draft-a",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a",
      generate_micro_plan: true,
    },
    {
      event: "toolbox.execute.done",
      turn_id: "turn-draft-a",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a",
      tool_name: "prose_writing",
      tool_outcome: "succeeded",
    },
    {
      event: "work_session.resume.done",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b",
      transcript_count: 0,
      pending_adoption_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b",
    },
    {
      event: "channel.get_toc.done",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b",
      chapter_count: 0,
      total_word_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a-return",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-draft-a",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a-return",
      action_type: "accept",
      action_status: "accepted",
    },
    {
      event: "channel.get_toc.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a-return",
      chapter_count: 1,
      total_word_count: 42,
    },
    {
      event: "channel.get_chapter_content.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a-return",
      content_chars: 42,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b-return",
    },
    {
      event: "channel.get_toc.done",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b-return",
      chapter_count: 0,
      total_word_count: 0,
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-trace-b",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b-return",
      generate_micro_plan: false,
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-trace-b",
      workspace_id: "work-b",
      work_id: "work-b",
      session_id: "session-b-return",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "su02-artifact-projection-trace-isolation",
      turn_id: "turn-draft-a",
      turn_ids: ["turn-draft-a", "turn-adopt-a", "turn-trace-b"],
      draft_turn_id: "turn-draft-a",
      adopt_turn_id: "turn-adopt-a",
      target_trace_turn_id: "turn-trace-b",
      workspace_id: "work-b",
      work_id: "work-b",
      context_work_id: "work-b",
      source_work_id: "work-a",
      target_work_id: "work-b",
      source_session_id: "session-a",
      target_session_id: "session-b-return",
      joined_work_count: 2,
      socket_connected: true,
      artifact_id: "artifact-prose-a",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      source_trace_ref: "trace-source-draft",
      target_trace_ref: "trace-target-b",
      source_pending_visible_before_switch: true,
      pending_artifact_visible_in_target: false,
      target_projection_empty_before_source_adoption: true,
      pending_restored_in_source: true,
      artifact_adopted_in_source: true,
      source_projection_populated_after_adoption: true,
      target_projection_empty_after_source_adoption: true,
      target_trace_excludes_source_artifact: true,
      target_why_excludes_source_artifact: true,
      source_artifact_visible_in_target_after_trace: false,
      service_status_text: "服务: 已连接",
      title_text: "SU02隔离乙",
    },
  ];
}

function su02PendingResultWorkIsolationRecords() {
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
      turn_id: "turn-slow-a",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a",
      duration_ms: 0,
      outcome: "start",
      text_len: 35,
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
      event: "channel.user_message.done",
      turn_id: "turn-slow-a",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a",
      duration_ms: 2510,
      outcome: "ok",
    },
    {
      event: "work_session.resume.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a-return",
      duration_ms: 2,
      outcome: "ok",
      transcript_count: 1,
      pending_adoption_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a-return",
      duration_ms: 1,
      outcome: "ok",
    },
    {
      event: "slice_verify.ui_state.done",
      workspace_id: "work-a",
      work_id: "work-a",
      context_work_id: "work-a",
      source_work_id: "work-a",
      target_work_id: "work-b",
      session_id: "session-a-return",
      source_session_id: "session-a",
      target_session_id: "session-b",
      duration_ms: 0,
      outcome: "ok",
      slice_id: "su02-pending-result-work-isolation",
      turn_id: "turn-slow-a",
      socket_connected: true,
      sent_frame_work_id: "work-a",
      source_turn_completed_work_id: "work-a",
      target_visible_after_source_done: true,
      target_loading_after_source_done: false,
      source_user_visible_in_target: false,
      source_assistant_visible_in_target: false,
      source_user_visible_after_return: true,
      source_assistant_visible_after_return: true,
      source_return_transcript_count: 1,
      service_status_text: "服务: 已连接",
      title_text: "SU02慢回复甲",
    },
  ];
}

function su02EmptyStartUnnamedWorkRecords() {
  return [
    {
      event: "work_session.resume.done",
      workspace_id: "work-auto",
      work_id: "work-auto",
      session_id: "session-auto",
      duration_ms: 3,
      outcome: "ok",
      transcript_count: 0,
      pending_adoption_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-auto",
      work_id: "work-auto",
      session_id: "session-auto",
      duration_ms: 1,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-empty-start",
      workspace_id: "work-auto",
      work_id: "work-auto",
      session_id: "session-auto",
      duration_ms: 0,
      outcome: "start",
      text_len: 32,
      generate_micro_plan: false,
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-empty-start",
      workspace_id: "work-auto",
      work_id: "work-auto",
      session_id: "session-auto",
      duration_ms: 80,
      outcome: "ok",
    },
    {
      event: "channel.join.done",
      workspace_id: "work-unnamed-1",
      work_id: "work-unnamed-1",
      session_id: "session-unnamed-1",
      duration_ms: 1,
      outcome: "ok",
    },
    {
      event: "channel.join.done",
      workspace_id: "work-unnamed-2",
      work_id: "work-unnamed-2",
      session_id: "session-unnamed-2",
      duration_ms: 1,
      outcome: "ok",
    },
    {
      event: "slice_verify.ui_state.done",
      workspace_id: "work-auto",
      work_id: "work-auto",
      context_work_id: "work-auto",
      session_id: "session-auto",
      duration_ms: 0,
      outcome: "ok",
      slice_id: "su02-empty-start-unnamed-work",
      turn_id: "turn-empty-start",
      socket_connected: true,
      backend_default_seed_skipped: true,
      seed_script_none: true,
      initial_join_work_id: "work-auto",
      initial_work_title: "未命名作品",
      works_after_start_count: 1,
      sent_frame_work_id: "work-auto",
      turn_done_work_id: "work-auto",
      renamed_work_id: "work-auto",
      renamed_title: "SU02空库改名-123",
      message_visible_after_rename: true,
      duplicate_unnamed_count: 2,
      duplicate_unnamed_labels_visible: true,
      duplicate_unnamed_work_ids: ["work-unnamed-1", "work-unnamed-2"],
      second_unnamed_work_id: "work-unnamed-1",
      third_unnamed_work_id: "work-unnamed-2",
      service_status_text: "服务: 已连接",
      title_text: "未命名作品",
    },
  ];
}

function su02WorkRestartRecoveryRecords() {
  return [
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
      event: "work_session.resume.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a-reload",
      duration_ms: 2,
      outcome: "ok",
      transcript_count: 0,
      pending_adoption_count: 0,
    },
    {
      event: "channel.join.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a-reload",
      duration_ms: 1,
      outcome: "ok",
    },
    {
      event: "slice_verify.ui_state.done",
      workspace_id: "work-a",
      work_id: "work-a",
      session_id: "session-a-reload",
      duration_ms: 0,
      outcome: "ok",
      slice_id: "su02-work-restart-recovery",
      context_work_id: "work-a",
      source_work_id: "work-a",
      first_restored_work_id: "work-b",
      stale_last_opened_work_id: "work-b",
      discarded_work_id: "work-b",
      discarded_status: "DISCARDED",
      fallback_work_id: "work-a",
      fallback_work_title: "SU02恢复甲",
      visible_work_ids: ["work-a"],
      restored_existing_work_after_reload: true,
      ignored_discarded_last_opened_after_reload: true,
      fallback_is_real_work: true,
      stale_preference_replaced_after_reload: true,
      socket_connected: true,
      service_status_text: "服务: 已连接",
      title_text: "SU02恢复甲",
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
      candidate_panel_width: 686.390625,
      candidate_panel_aligned_to_assistant_rail: true,
      candidate_panel_surface_defined: true,
      candidate_card_boundary_visible: true,
      candidate_actions_match_prototype: true,
      candidate_panel_collapsed_after_continue: true,
      candidate_panel_collapsed_after_reload: true,
      candidate_panel_reexpanded: true,
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
      event: "context.assemble.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "judgment.decided.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 20,
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

function au02CandidateMultiturnContextRecords(sourceTurnId, continuationTurnId, followupTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: followupTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au02-candidate-multiturn-context",
      source_turn_id: sourceTurnId,
      continuation_turn_id: continuationTurnId,
      followup_turn_id: followupTurnId,
      candidate_ref: "dir-1",
      candidate_title: "人物动机 AU02CTX123456",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      context_nonce: "AU02CTX123456",
      candidate_title_visible: true,
      continuation_candidate_selection_sent: true,
      followup_plain_user_message_sent: true,
      followup_context_has_conversation: true,
      followup_context_has_session_summary: true,
      followup_reply_contains_context_nonce: true,
      followup_message_visible: true,
      followup_reply_visible: true,
      generate_micro_plan: false,
      tool_result_present: false,
      adoption_decision_present: false,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
      no_author_action_sent: true,
      no_action_result_received: true,
    },
    {
      event: "channel.user_message.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 45,
      generate_micro_plan: false,
    },
    {
      event: "judgment.decided.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      frame_type: "creative_exploration",
      candidate_count: 2,
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 33,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: continuationTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 33,
      generate_micro_plan: false,
      candidate_source_turn_ref: sourceTurnId,
      candidate_ref: "dir-1",
    },
    {
      event: "judgment.decided.done",
      turn_id: continuationTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      frame_type: "casual_reply",
      candidate_count: 0,
      duration_ms: 18,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: continuationTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 25,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: followupTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 30,
      generate_micro_plan: false,
    },
    {
      event: "context.assemble.done",
      turn_id: followupTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "context.assemble.done",
      turn_id: followupTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 4,
      outcome: "ok",
      has_conversation: true,
      has_session_summary: true,
    },
    {
      event: "judgment.decided.done",
      turn_id: followupTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      frame_type: "casual_reply",
      candidate_count: 0,
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: followupTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 33,
      outcome: "ok",
    },
  ];
}

function au02CandidateFreeformFollowupRecords(sourceTurnId, followTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au02-freeform-followup-after-candidate",
      source_turn_ref: sourceTurnId,
      freeform_turn_id: followTurnId,
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      candidate_panel_count_after_source: 1,
      input_enabled_after_candidate: true,
      freeform_user_message_sent: true,
      candidate_selection_sent: false,
      no_author_action_sent: true,
      no_action_result_received: true,
      adoption_decision_present: false,
      freeform_message_visible: true,
      freeform_assistant_reply_visible: true,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
    },
    {
      event: "channel.user_message.start",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 31,
      generate_micro_plan: false,
    },
    {
      event: "context.assemble.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "judgment.decided.done",
      turn_id: followTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 20,
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

function au02NaturalExplorationNoSlotFormRecords(sourceTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au02-natural-exploration-no-slot-form",
      source_turn_id: sourceTurnId,
      frame_type: "creative_exploration",
      candidate_count: 2,
      candidate_ref: "dir-1",
      candidate_titles: ["数字灵根", "机甲道场"],
      candidate_pitches: ["灵根芯片与云端神祇", "机甲炼体与数据心法"],
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      natural_reply_visible: true,
      lmstudio_quality_checks_required: false,
      natural_reply_chinese: true,
      natural_reply_no_json_code: true,
      candidates_no_json_code: true,
      candidate_semantically_relevant: true,
      candidate_panel_rendered: 1,
      slot_form_visible: false,
      forbidden_slot_fields_absent: true,
      durable_clarification_opened: false,
      execution_card_visible: false,
      generate_micro_plan: false,
      tool_result_present: false,
      adoption_decision_present: false,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
      no_author_action_sent: true,
      no_action_result_received: true,
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
      event: "context.assemble.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "judgment.decided.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      frame_type: "creative_exploration",
      candidate_count: 2,
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 33,
      outcome: "ok",
    },
  ];
}

function au02CandidateFallbackUiRecords(sourceTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au02-candidate-fallback-ui",
      source_turn_id: sourceTurnId,
      provider_candidate_payload: "malformed_candidates",
      frame_type: "creative_exploration",
      frame_candidate_count: 3,
      turn_result_candidate_count: 3,
      fallback_candidate_titles: ["矛盾切入", "人物切入", "世界规则切入"],
      fallback_candidate_pitches: [
        "先抓住作品里最有冲突感的设定，让主角从压力中心进入故事。",
        "从一个有强烈欲望或困境的角色出发，用他的选择带出世界观。",
        "先定义一个反常但有吸引力的世界规则，再让剧情围绕它展开。",
      ],
      fallback_candidate_visible: true,
      has_known_fallback_candidate: true,
      candidate_fields_nonempty: true,
      candidate_statuses_not_adopted: true,
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      candidate_panel_rendered: 1,
      malformed_candidate_prompt_sent: true,
      generate_micro_plan: false,
      tool_result_present: false,
      adoption_decision_present: false,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
      no_author_action_sent: true,
      no_action_result_received: true,
    },
    {
      event: "channel.user_message.start",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
      text_len: 55,
      generate_micro_plan: false,
    },
    {
      event: "context.assemble.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "judgment.decided.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      frame_type: "creative_exploration",
      candidate_count: 3,
      duration_ms: 20,
      outcome: "ok",
    },
    {
      event: "channel.user_message.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 33,
      outcome: "ok",
    },
  ];
}

function au02UnadoptedCandidateNoReadingFactRecords(sourceTurnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 1,
      outcome: "ok",
      slice_id: "au02-unadopted-candidate-no-reading-fact",
      source_turn_id: sourceTurnId,
      candidate_ref: "dir-1",
      candidate_set_ref: `candidate_set:${sourceTurnId}`,
      frame_badge_label: "探索方向",
      frame_badge_kind: "exploration",
      candidate_panel_rendered_before_reading: true,
      reading_mode_opened: true,
      reading_empty_state_visible: true,
      reading_toc_chapter_count: 0,
      reading_total_word_count: 0,
      candidate_title_visible_in_reading: false,
      candidate_pitch_visible_in_reading: false,
      candidate_selected: false,
      candidate_adopted: false,
      production_write_performed: false,
      adoption_decision_present: false,
      no_author_action_sent: true,
      no_action_result_received: true,
      no_projection_events: true,
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
      event: "context.assemble.done",
      turn_id: sourceTurnId,
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      duration_ms: 0,
      outcome: "start",
    },
    {
      event: "judgment.decided.done",
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
      duration_ms: 33,
      outcome: "ok",
    },
    {
      event: "channel.get_toc.done",
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      chapter_count: 0,
      total_word_count: 0,
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
      candidate_continue_clicked: false,
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

function au05DiscardAuthorActionRecords(turnId) {
  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au05-discard-author-action",
      turn_id: turnId,
      draft_turn_id: turnId,
      discard_turn_id: "turn-discard-result",
      workspace_id: "work-adopt",
      work_id: "work-adopt",
      session_id: "session-adopt",
      duration_ms: 1,
      outcome: "ok",
      artifact_id: "as-1",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      discard_action_sent: true,
      discard_action_type: "discard",
      action_result_status: "discarded",
      artifact_discarded: true,
      artifact_adopted: false,
      production_write_performed: false,
      discard_button_cleared_after_discard: true,
      reading_mode_empty_after_discard: true,
      draft_not_visible_in_reading: true,
      user_message_text: "生成正文草稿",
    },
    {
      event: "channel.user_message.start",
      turn_id: turnId,
      workspace_id: "work-adopt",
      work_id: "work-adopt",
      session_id: "session-adopt",
      duration_ms: 0,
      outcome: "start",
      generate_micro_plan: true,
    },
    {
      event: "toolbox.execute.done",
      turn_id: turnId,
      workspace_id: "work-adopt",
      work_id: "work-adopt",
      session_id: "session-adopt",
      duration_ms: 8,
      outcome: "ok",
      tool_name: "prose_writing",
      tool_outcome: "succeeded",
    },
    {
      event: "channel.user_message.done",
      turn_id: turnId,
      workspace_id: "work-adopt",
      work_id: "work-adopt",
      session_id: "session-adopt",
      duration_ms: 33,
      outcome: "ok",
    },
    {
      event: "channel.author_action.start",
      turn_id: turnId,
      workspace_id: "work-adopt",
      work_id: "work-adopt",
      session_id: "session-adopt",
      duration_ms: 0,
      outcome: "start",
      action_type: "discard",
    },
    {
      event: "channel.author_action.done",
      turn_id: turnId,
      workspace_id: "work-adopt",
      work_id: "work-adopt",
      session_id: "session-adopt",
      duration_ms: 7,
      outcome: "ok",
      action_type: "discard",
      action_status: "discarded",
      artifact_id: "as-1",
    },
    {
      event: "channel.get_toc.done",
      turn_id: "turn-toc",
      workspace_id: "work-adopt",
      work_id: "work-adopt",
      session_id: "session-adopt",
      duration_ms: 4,
      outcome: "ok",
      total_word_count: 0,
      empty_chapter_count: 12,
      chapter_count: 12,
    },
    {
      event: "channel.get_chapter_content.done",
      turn_id: "turn-toc",
      workspace_id: "work-adopt",
      work_id: "work-adopt",
      session_id: "session-adopt",
      duration_ms: 4,
      outcome: "ok",
      chapter_id: "chapter-1",
      content_chars: 0,
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

function au08ReadingReadonlyNoWriteRecords() {
  return [
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au08-reading-readonly-no-write",
      turn_id: "turn-au08-readonly-draft",
      draft_turn_id: "turn-au08-readonly-draft",
      adopt_turn_id: "turn-au08-readonly-adopt",
      workspace_id: "work-au08-readonly",
      work_id: "work-au08-readonly",
      session_id: "session-au08-readonly",
      artifact_id: "artifact-au08-readonly",
      artifact_type: "prose_fragment",
      chapter_title: "第01章：底层灵气账单",
      accept_event_sent: true,
      accept_button_cleared_after_adoption: true,
      artifact_adopted: true,
      reading_mode_populated_after_adoption: true,
      total_word_count: 120,
      chapter_word_count: 120,
      expected_word_count: 120,
      word_count_matches_adopted_prose: true,
      projection_refresh_status: "STALE",
      projection_stale_banner_visible: true,
      projection_refresh_button_visible: true,
      user_message_text: "请根据已采纳章节计划生成第01章：底层灵气账单正文草稿",
      reading_mode_visible_before_export: true,
      reading_export_button_visible: true,
      reading_back_button_visible: true,
      chat_input_absent_in_reading: true,
      reading_write_control_count: 0,
      reading_write_controls_hidden: true,
      real_export_button_clicked: true,
      export_path: "/tmp/au08-readonly.md",
      export_done: true,
      export_chapter_count: 1,
      author_action_sent_count_during_reading: 0,
      user_message_sent_count_during_reading: 0,
      channel_author_action_log_count_during_reading: 0,
      adoption_event_count_during_reading: 0,
      toolbox_execute_count_during_reading: 0,
      production_write_claim_count_during_reading: 0,
      no_author_action_sent_during_reading: true,
      no_user_message_sent_during_reading: true,
      no_channel_author_action_log_during_reading: true,
      no_adoption_event_during_reading: true,
      no_tool_dispatch_during_reading: true,
      no_production_write_claim_during_reading: true,
      returned_to_workbench: true,
      chat_input_enabled_after_return: true,
      send_button_enabled_after_return: true,
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-au08-readonly-draft",
      workspace_id: "work-au08-readonly",
      work_id: "work-au08-readonly",
      session_id: "session-au08-readonly",
      generate_micro_plan: true,
    },
    {
      event: "toolbox.execute.done",
      turn_id: "turn-au08-readonly-draft",
      workspace_id: "work-au08-readonly",
      work_id: "work-au08-readonly",
      tool_name: "prose_writing",
      tool_outcome: "succeeded",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au08-readonly-draft",
      workspace_id: "work-au08-readonly",
      work_id: "work-au08-readonly",
      session_id: "session-au08-readonly",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-au08-readonly-adopt",
      workspace_id: "work-au08-readonly",
      work_id: "work-au08-readonly",
      action_type: "accept",
      action_status: "accepted",
    },
    {
      event: "channel.get_toc.done",
      work_id: "work-au08-readonly",
      chapter_count: 1,
    },
    {
      event: "channel.get_chapter_content.done",
      work_id: "work-au08-readonly",
      content_chars: 120,
    },
    {
      event: "channel.export_work.done",
      work_id: "work-au08-readonly",
      export_path: "/tmp/au08-readonly.md",
      chapter_count: 1,
      total_word_count: 120,
    },
  ];
}

function au08ReadingReturnContextRecords() {
  const followupTurnId = "turn-au08-return-followup";
  const followupText = "从阅读返回后，请继续聊第01章开场的读者压力，不要写正文。";
  const records = au08ReadingReadonlyNoWriteRecords()
    .filter((record) => record.event !== "channel.export_work.done")
    .map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? {
            ...record,
            slice_id: "au08-reading-return-context",
            turn_id: followupTurnId,
            followup_turn_id: followupTurnId,
            original_work_id: "work-au08-readonly",
            original_session_id: "session-au08-readonly",
            returned_to_workbench: true,
            workbench_visible_after_return: true,
            chat_input_enabled_after_return: true,
            send_button_enabled_after_return: true,
            no_author_action_sent_on_return: true,
            no_user_message_sent_on_return: true,
            welcome_count_before_return: 1,
            welcome_count_after_return: 1,
            no_new_welcome_after_return: true,
            followup_user_message_sent: true,
            followup_turn_result_received: true,
            followup_channel_done_same_scope: true,
            followup_visible_in_transcript: true,
            followup_user_message_text: followupText,
            work_id_preserved_after_return: true,
            session_id_preserved_after_return: true,
            followup_done_work_id: "work-au08-readonly",
            followup_done_session_id: "session-au08-readonly",
          }
        : record,
    );

  return [
    ...records,
    {
      event: "channel.user_message.start",
      turn_id: followupTurnId,
      workspace_id: "work-au08-readonly",
      work_id: "work-au08-readonly",
      session_id: "session-au08-readonly",
      generate_micro_plan: false,
      text: followupText,
    },
    {
      event: "channel.user_message.done",
      turn_id: followupTurnId,
      workspace_id: "work-au08-readonly",
      work_id: "work-au08-readonly",
      session_id: "session-au08-readonly",
    },
  ];
}

function au08VolumeOneChapters() {
  return ["第01章：觉醒", "第02章：试炼", "第03章：盟约", "第04章：裂隙", "第05章：暗流"];
}

function au08VolumeTwoChapters() {
  return [
    "第06章：突围",
    "第07章：真相",
    "第08章：背叛",
    "第09章：抉择",
    "第10章：决战",
    "第11章：余烬",
    "第12章：新生",
  ];
}

function au08VolumeStructuredPlanningRecords({ uiStateOverrides = {}, tocOverrides = {} } = {}) {
  // 规划走 bounded AgentRun：channel 级留痕落父 turn，工具执行/采纳落 `:agent:N` 子 turn，
  // toolbox.execute.done 不带 turn_id，只能靠 decision_id 与执行子 turn 绑定。
  const parentTurnId = "turn-au08";
  const generationTurnId = "turn-au08:agent:4";
  const adoptionTurnId = "turn-au08-adopt";
  const decisionId = "decision-au08";
  const workId = "work-au08";

  return [
    {
      event: "work_session.resume.done",
      workspace_id: workId,
      work_id: workId,
      session_id: "session-au08",
      duration_ms: 4,
      outcome: "ok",
    },
    {
      event: "channel.join.done",
      workspace_id: workId,
      work_id: workId,
      session_id: "session-au08",
      duration_ms: 0,
      outcome: "ok",
    },
    {
      event: "channel.user_message.start",
      turn_id: parentTurnId,
      workspace_id: workId,
      work_id: workId,
      session_id: "session-au08",
      outcome: "start",
      generate_micro_plan: true,
      message_preview: "请基于当前作品规划卷章结构，并生成章节大纲。",
    },
    {
      event: "judgment.decided.done",
      turn_id: parentTurnId,
      work_id: workId,
      session_id: "session-au08",
      outcome: "ok",
      frame_type: "judgment_execute",
      capability: "plot_outline",
      reason_code: "single_capability_satisfies_request",
    },
    {
      event: "channel.user_message.done",
      turn_id: parentTurnId,
      work_id: workId,
      session_id: "session-au08",
      outcome: "ok",
      run_mode: "bounded",
      run_id: "run-au08",
    },
    {
      event: "context.fact_completeness.done",
      turn_id: generationTurnId,
      decision_id: decisionId,
      outcome: "ok",
      capability: "plot_outline",
    },
    {
      event: "toolbox.execute.done",
      decision_id: decisionId,
      outcome: "ok",
      tool_name: "plot_outline",
      tool_outcome: "succeeded",
    },
    {
      event: "channel.author_action.start",
      turn_id: generationTurnId,
      work_id: workId,
      session_id: "session-au08",
      action_type: "accept",
      target_ref: "artifact-outline-au08",
    },
    {
      event: "adoption.evaluate.done",
      turn_id: generationTurnId,
      work_id: workId,
      session_id: "session-au08",
      decision_type: "adopt_tentative",
    },
    {
      event: "channel.author_action.done",
      turn_id: generationTurnId,
      work_id: workId,
      session_id: "session-au08",
      action_type: "accept",
      action_status: "accepted",
    },
    {
      event: "channel.get_toc.done",
      work_id: workId,
      session_id: "session-au08",
      outcome: "ok",
      volume_count: 2,
      chapter_count: 12,
      total_word_count: 0,
      ...tocOverrides,
    },
    {
      event: "slice_verify.ui_state.done",
      turn_id: generationTurnId,
      workspace_id: workId,
      work_id: workId,
      session_id: "session-au08",
      outcome: "ok",
      slice_id: "au08-volume-structured-planning",
      generation_turn_id: generationTurnId,
      parent_turn_id: parentTurnId,
      adoption_turn_id: adoptionTurnId,
      artifact_id: "artifact-outline-au08",
      artifact_type: "outline_draft",
      chapter_count: 12,
      chapter_plan_visible: true,
      outline_adopt_clicked: true,
      outline_adopted: true,
      plan_volume_titles: ["第一卷·觉醒", "第二卷·裂变"],
      plan_chapter_titles_by_volume: [au08VolumeOneChapters(), au08VolumeTwoChapters()],
      volume_headers: ["第一卷·觉醒 · 5章", "第二卷·裂变 · 7章"],
      volume_chapter_counts: [5, 7],
      chapter_titles_by_volume: [au08VolumeOneChapters(), au08VolumeTwoChapters()],
      volume_grouping_matches_plan: true,
      reading_toc_volume_headers: ["第一卷·觉醒", "第二卷·裂变"],
      reading_toc_grouped_by_volume: true,
      toc_volume_count: 2,
      toc_frame_volume_count: 2,
      reading_projection_materialized: false,
      ...uiStateOverrides,
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

function au07StateTraceAdoptionReplayRecords(draftTurnId, adoptTurnId) {
  const stateTraceRef = "state_trace:ad-au07";

  return [
    ...p1ChapterDraftGenerationRecords(draftTurnId).map((record) =>
      record.event === "slice_verify.ui_state.done"
        ? {
            ...record,
            slice_id: "au07-state-trace-adoption-replay",
            draft_turn_id: draftTurnId,
            adopt_turn_id: adoptTurnId,
            accept_event_sent: true,
            accept_action_type: "accept",
            accept_button_cleared_after_adoption: true,
            artifact_adopted: true,
            reading_mode_populated_after_adoption: true,
            total_word_count: 24,
            chapter_word_count: 24,
            expected_word_count: 24,
            word_count_matches_adopted_prose: true,
            adoption_trace_ref: `trace:${adoptTurnId}`,
            state_trace_ref: stateTraceRef,
            resolved_state_trace_ref: stateTraceRef,
            projection_source_state_trace_ref: stateTraceRef,
            projection_refresh_status: "STALE",
            projection_stale_banner_visible: true,
            projection_refresh_button_visible: true,
            trace_summary_state_trace_refs_count: 1,
            projection_refs_count: 1,
          }
        : record,
    ),
    {
      event: "channel.author_action.start",
      turn_id: draftTurnId,
      work_id: "work-p1",
      session_id: "session-p1",
      action_type: "accept",
      target_ref: "artifact-prose-1",
    },
    {
      event: "adoption.evaluate.done",
      turn_id: draftTurnId,
      work_id: "work-p1",
      session_id: "session-p1",
      decision_type: "adopt_tentative",
      reason_codes: ["candidate_adopted_as_tentative", "provenance_verified"],
    },
    {
      event: "channel.author_action.done",
      turn_id: draftTurnId,
      work_id: "work-p1",
      session_id: "session-p1",
      action_type: "accept",
      action_status: "accepted",
    },
    {
      event: "channel.get_toc.done",
      work_id: "work-p1",
      session_id: "session-p1",
      chapter_count: 12,
      total_word_count: 24,
    },
    {
      event: "channel.get_chapter_content.done",
      work_id: "work-p1",
      session_id: "session-p1",
      chapter_id: "chapter-1",
      content_chars: 64,
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

function au04ConfirmBeforeExecuteRecords() {
  return [
    {
      event: "channel.user_message.start",
      turn_id: "turn-au04-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      generate_micro_plan: false,
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au04-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      decision_type: "require_confirmation",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au04-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn-au04-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "confirm-au04-confirm",
      action_type: "confirm_before_execute",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-au04-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "confirm-au04-confirm",
      action_type: "confirm_before_execute",
      action_status: "accepted",
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au04-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      decision_type: "allow_tool",
    },
    {
      event: "toolbox.execute.done",
      turn_id: "turn-au04-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      tool_name: "prose_writing",
      tool_outcome: "succeeded",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au04-confirm-before-execute",
      turn_id: "turn-au04-confirm",
      confirm_turn_id: "turn-au04-confirm",
      executed_turn_id: "turn-au04-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      artifact_id: "artifact-au04-confirm",
      artifact_type: "prose_fragment",
      confirmation_card_received: true,
      confirmation_card_visible: true,
      confirmation_card_detail_visible: true,
      confirmation_card_target_visible: true,
      confirmation_card_no_write_visible: true,
      confirmation_card_re_gate_visible: true,
      plan_carried_over_wire: true,
      confirm_action_behavior_ref: "behavior-au04-confirm",
      tool_called_before_confirm: false,
      production_write_before_confirm: false,
      confirm_action_sent: true,
      confirmed_dispatch: true,
      artifact_pending_after_confirm: true,
    },
  ];
}

function au04ConfirmIdempotencyUiRecords() {
  return [
    {
      event: "channel.user_message.start",
      turn_id: "turn-au04-idem",
      work_id: "work-au04",
      session_id: "session-au04",
      generate_micro_plan: false,
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au04-idem",
      work_id: "work-au04",
      session_id: "session-au04",
      decision_type: "require_confirmation",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au04-idem",
      work_id: "work-au04",
      session_id: "session-au04",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn-au04-idem",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "confirm-au04-idem",
      action_type: "confirm_before_execute",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-au04-idem",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "confirm-au04-idem",
      action_type: "confirm_before_execute",
      action_status: "accepted",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-au04-idem",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "confirm-au04-idem",
      action_type: "confirm_before_execute",
      action_status: "accepted",
      duplicate: true,
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au04-idem",
      work_id: "work-au04",
      session_id: "session-au04",
      decision_type: "allow_tool",
    },
    {
      event: "toolbox.execute.done",
      turn_id: "turn-au04-idem",
      work_id: "work-au04",
      session_id: "session-au04",
      tool_name: "prose_writing",
      tool_outcome: "succeeded",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au04-confirm-idempotency-ui",
      turn_id: "turn-au04-idem",
      confirm_turn_id: "turn-au04-idem",
      executed_turn_id: "turn-au04-idem",
      work_id: "work-au04",
      session_id: "session-au04",
      artifact_id: "artifact-au04-idem",
      artifact_type: "prose_fragment",
      confirmation_card_received: true,
      confirmation_card_visible: true,
      plan_carried_over_wire: true,
      confirm_action_behavior_ref: "behavior-au04-idem",
      confirm_action_id: "confirm-au04-idem",
      confirm_action_idempotency_key: "idem-au04-idem",
      tool_called_before_confirm: false,
      production_write_before_confirm: false,
      confirm_double_click_attempted: true,
      confirm_action_sent: true,
      sent_confirm_action_count: 2,
      author_action_done_count: 2,
      non_duplicate_author_action_done_count: 1,
      duplicate_author_action_done_count: 1,
      duplicate_action_result_count: 1,
      duplicate_suppressed_or_deduped: true,
      confirmed_dispatch: true,
      toolbox_execute_count: 1,
      pending_prose_fragment_count: 1,
      no_duplicate_tool_dispatch: true,
      single_pending_artifact_after_confirm: true,
      artifact_pending_after_confirm: true,
    },
  ];
}

function au04ConfirmationToolFailureRecoveryRecords() {
  return [
    {
      event: "channel.user_message.start",
      turn_id: "turn-au04-tool-failure",
      work_id: "work-au04",
      session_id: "session-au04",
      generate_micro_plan: false,
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au04-tool-failure",
      work_id: "work-au04",
      session_id: "session-au04",
      decision_type: "require_confirmation",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au04-tool-failure",
      work_id: "work-au04",
      session_id: "session-au04",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn-au04-tool-failure",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "confirm-au04-tool-failure",
      action_type: "confirm_before_execute",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-au04-tool-failure",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "confirm-au04-tool-failure",
      action_type: "confirm_before_execute",
      action_status: "accepted",
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au04-tool-failure",
      work_id: "work-au04",
      session_id: "session-au04",
      decision_type: "allow_tool",
    },
    {
      event: "provider_gateway.complete.error",
      turn_id: "turn-au04-tool-failure",
      work_id: "work-au04",
      session_id: "session-au04",
      provider: "slice_verify",
      reason_code: "provider_error",
      outcome_detail: "AU04FAILTOOL fixture provider failure",
    },
    {
      event: "toolbox.execute.error",
      turn_id: "turn-au04-tool-failure",
      work_id: "work-au04",
      session_id: "session-au04",
      tool_name: "prose_writing",
      tool_outcome: "failed",
      reason_code: "provider_error",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au04-confirmation-tool-failure-recovery",
      turn_id: "turn-au04-tool-failure",
      confirm_turn_id: "turn-au04-tool-failure",
      failed_turn_id: "turn-au04-tool-failure",
      work_id: "work-au04",
      session_id: "session-au04",
      confirmation_card_received: true,
      confirmation_card_visible: true,
      plan_carried_over_wire: true,
      confirm_action_behavior_ref: "behavior-au04-tool-failure",
      confirm_action_id: "confirm-au04-tool-failure",
      confirm_action_sent: true,
      confirm_action_acknowledged: true,
      tool_called_before_confirm: false,
      production_write_before_confirm: false,
      confirmed_dispatch_attempted: true,
      confirmed_turn_failed: true,
      failed_tool_name: "prose_writing",
      failed_tool_status: "failed",
      truthfulness_tool_status: "failed",
      production_write_after_failure: false,
      pending_prose_fragment_after_failure_count: 0,
      provider_error_count: 1,
      toolbox_execute_error_count: 1,
      toolbox_execute_success_count: 0,
      failure_message_visible: true,
      no_pending_artifact_after_failure: true,
      no_successful_tool_dispatch_after_failure: true,
      no_production_write_after_failure: true,
    },
  ];
}

function au04StaleConfirmationUiRecords() {
  return [
    {
      event: "channel.user_message.start",
      turn_id: "turn-au04-stale-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      generate_micro_plan: false,
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au04-stale-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      decision_type: "require_confirmation",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au04-stale-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-au04-followup",
      work_id: "work-au04",
      session_id: "session-au04",
      generate_micro_plan: false,
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au04-followup",
      work_id: "work-au04",
      session_id: "session-au04",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn-au04-stale-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "confirm-au04-stale",
      action_type: "confirm_before_execute",
    },
    {
      event: "channel.author_action.error",
      turn_id: "turn-au04-stale-confirm",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "confirm-au04-stale",
      action_type: "confirm_before_execute",
      reason_code: "dialogue_gateway_rejected",
      outcome_detail: "stale action source_turn_ref",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au04-stale-confirmation-ui",
      turn_id: "turn-au04-stale-confirm",
      confirm_turn_id: "turn-au04-stale-confirm",
      followup_turn_id: "turn-au04-followup",
      work_id: "work-au04",
      session_id: "session-au04",
      confirmation_card_received: true,
      confirmation_card_visible: true,
      plan_carried_over_wire: true,
      confirm_action_behavior_ref: "behavior-au04-stale",
      tool_called_before_confirm: false,
      production_write_before_confirm: false,
      followup_turn_completed: true,
      followup_advanced_current_turn: true,
      stale_confirm_visible: true,
      stale_confirm_disabled: false,
      stale_confirm_click_attempted: true,
      stale_confirm_action_sent: true,
      stale_confirm_rejected: true,
      stale_confirm_prevented: true,
      author_action_error_count: 1,
      toolbox_execute_after_stale_count: 0,
      pending_prose_fragment_after_stale_count: 0,
      no_tool_dispatch_after_stale: true,
      no_pending_artifact_after_stale: true,
      action_failure_visible: true,
    },
  ];
}

function au06SingleActiveConfirmationRecords() {
  return [
    {
      event: "channel.user_message.start",
      turn_id: "turn-au06-first-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      generate_micro_plan: false,
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au06-first-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      decision_type: "require_confirmation",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au06-first-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
    },
    {
      event: "channel.user_message.start",
      turn_id: "turn-au06-second-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      generate_micro_plan: false,
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au06-second-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      decision_type: "require_confirmation",
    },
    {
      event: "channel.user_message.done",
      turn_id: "turn-au06-second-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn-au06-first-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      action_id: "confirm-au06-first",
      action_type: "confirm_before_execute",
    },
    {
      event: "channel.author_action.error",
      turn_id: "turn-au06-first-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      action_id: "confirm-au06-first",
      action_type: "confirm_before_execute",
      reason_code: "dialogue_gateway_rejected",
      outcome_detail: "stale action source_turn_ref",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn-au06-second-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      action_id: "confirm-au06-second",
      action_type: "confirm_before_execute",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn-au06-second-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      action_id: "confirm-au06-second",
      action_type: "confirm_before_execute",
      action_status: "accepted",
    },
    {
      event: "orchestrator.decide.done",
      turn_id: "turn-au06-second-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      decision_type: "allow_tool",
    },
    {
      event: "toolbox.execute.done",
      turn_id: "turn-au06-second-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      tool_name: "prose_writing",
      tool_outcome: "succeeded",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au06-single-active-confirmation",
      turn_id: "turn-au06-second-confirm",
      first_confirm_turn_id: "turn-au06-first-confirm",
      second_confirm_turn_id: "turn-au06-second-confirm",
      latest_executed_turn_id: "turn-au06-second-confirm",
      work_id: "work-au06",
      session_id: "session-au06",
      artifact_id: "artifact-au06-second",
      artifact_type: "prose_fragment",
      first_confirm_action_id: "confirm-au06-first",
      second_confirm_action_id: "confirm-au06-second",
      first_confirm_action_behavior_ref: "behavior-au06-first",
      second_confirm_action_behavior_ref: "behavior-au06-second",
      second_turn_behavior_context_ref_visible: true,
      second_turn_behavior_context_author_safe: true,
      second_turn_behavior_context_summary:
        "当前有待作者确认的操作：章节正文草稿；确认或取消前不能执行工具或写入作品事实。",
      second_turn_behavior_context_redaction_level: "author_safe",
      second_turn_behavior_context_ref: "ctx-au06-behavior",
      second_turn_behavior_context_source_id: "",
      distinct_behavior_refs: true,
      first_tool_called_before_confirm: false,
      first_production_write_before_confirm: false,
      second_tool_called_before_confirm: false,
      second_production_write_before_confirm: false,
      second_confirmation_advanced_current_turn: true,
      confirm_button_count_after_second: 2,
      old_confirm_visible: true,
      old_confirm_disabled: false,
      old_confirm_click_attempted: true,
      old_confirm_action_sent: true,
      old_confirm_rejected: true,
      old_confirm_prevented: true,
      old_author_action_error_count: 1,
      toolbox_execute_after_old_count: 0,
      pending_prose_fragment_after_old_count: 0,
      no_tool_dispatch_after_old: true,
      no_pending_artifact_after_old: true,
      latest_confirm_action_sent: true,
      latest_confirm_dispatched: true,
      latest_toolbox_execute_count: 1,
      latest_pending_artifact_after_confirm: true,
    },
  ];
}

function au04ConfirmationTtlUiRecords() {
  return [
    {
      event: "channel.join.done",
      turn_id: "turn_au04_expired_confirmation_seed",
      work_id: "work-au04",
      session_id: "session-au04",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn_au04_expired_confirmation_seed",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "act_au04_expired_confirm",
      action_type: "confirm_before_execute",
    },
    {
      event: "channel.author_action.error",
      turn_id: "turn_au04_expired_confirmation_seed",
      work_id: "work-au04",
      session_id: "session-au04",
      action_id: "act_au04_expired_confirm",
      action_type: "confirm_before_execute",
      reason_code: "dialogue_gateway_rejected",
      outcome_detail: "expired action: action expired at 2000-01-01T00:00:00Z",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au04-confirmation-ttl-ui",
      turn_id: "turn_au04_expired_confirmation_seed",
      work_id: "work-au04",
      session_id: "session-au04",
      confirmation_card_restored: true,
      confirmation_card_visible: true,
      expired_confirm_click_attempted: true,
      expired_confirm_action_sent: true,
      expired_confirm_rejected: true,
      author_action_error_count: 1,
      toolbox_execute_after_expired_count: 0,
      pending_prose_fragment_after_expired_count: 0,
      no_tool_dispatch_after_expired: true,
      no_pending_artifact_after_expired: true,
      action_failure_visible: true,
    },
  ];
}

function au04DisabledConfirmationActionUiRecords() {
  return [
    {
      event: "work_session.resume.done",
      work_id: "work-au04-disabled",
      session_id: "session-au04-disabled",
      transcript_count: 2,
    },
    {
      event: "channel.join.done",
      work_id: "work-au04-disabled",
      session_id: "session-au04-disabled",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au04-disabled-confirmation-action-ui",
      turn_id: "turn_au04_disabled_confirmation_seed",
      turn_ids: ["turn_au04_disabled_confirmation_seed"],
      work_id: "work-au04-disabled",
      workspace_id: "work-au04-disabled",
      session_id: "session-au04-disabled",
      confirmation_card_restored: true,
      confirmation_card_visible: true,
      disabled_confirm_button_count: 1,
      reject_button_count: 1,
      disabled_confirm_visible: true,
      disabled_confirm_disabled: true,
      disabled_confirm_title: "当前作品状态已变化，请重新生成计划后再确认。",
      disabled_reason_visible_via_title: true,
      reject_action_still_enabled: true,
      disabled_click_attempted: true,
      disabled_click_blocked_by_browser: true,
      author_action_sent_count: 0,
      disabled_confirm_action_sent_count: 0,
      channel_author_action_log_count: 0,
      toolbox_execute_after_disabled_attempt_count: 0,
      pending_prose_fragment_after_disabled_attempt_count: 0,
      no_author_action_sent: true,
      no_channel_author_action_log: true,
      no_tool_dispatch_after_disabled_attempt: true,
      no_pending_artifact_after_disabled_attempt: true,
    },
  ];
}

function au04HistoryConfirmationReadonlyRecords() {
  return [
    {
      event: "work_session.resume.done",
      work_id: "work-au04",
      session_id: "session-active-au04",
      transcript_count: 2,
    },
    {
      event: "channel.join.done",
      work_id: "work-au04",
      session_id: "session-active-au04",
    },
    {
      event: "work_session.show.done",
      work_id: "work-au04",
      session_id: "session-history-au04",
      read_only: true,
      transcript_count: 2,
      pending_adoption_count: 0,
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au04-history-confirmation-readonly",
      turn_id: "turn_au04_history_confirmation_seed",
      work_id: "work-au04",
      context_work_id: "work-au04",
      session_id: "session-active-au04",
      readonly_session_id: "session-history-au04",
      readonly_session_status: "EXITED",
      readonly_opened_from_real_workbench: true,
      readonly_transcript_count: 2,
      readonly_banner_visible: true,
      history_confirmation_transcript_visible: true,
      history_confirmation_confirm_button_count: 0,
      history_confirmation_reject_button_count: 0,
      history_confirmation_actions_hidden: true,
      readonly_input_disabled: true,
      readonly_send_disabled: true,
      author_action_sent_count: 0,
      channel_author_action_log_count: 0,
      toolbox_execute_after_history_open_count: 0,
      pending_prose_fragment_after_history_open_count: 0,
      no_author_action_sent: true,
      no_channel_author_action_log: true,
      no_tool_dispatch_from_history: true,
      no_pending_artifact_from_history: true,
      active_session_restored: true,
      active_input_enabled_after_restore: true,
      active_send_enabled_after_restore: true,
    },
  ];
}

function au04CrossWorkConfirmationGuardRecords() {
  return [
    {
      event: "work_session.resume.done",
      work_id: "work-au04-source",
      session_id: "session-source-au04",
      transcript_count: 2,
    },
    {
      event: "work_session.resume.done",
      work_id: "work-au04-target",
      session_id: "session-target-au04",
      transcript_count: 2,
    },
    {
      event: "channel.join.done",
      work_id: "work-au04-source",
      session_id: "session-source-au04",
    },
    {
      event: "channel.join.done",
      work_id: "work-au04-target",
      session_id: "session-target-au04",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au04-cross-work-confirmation-guard",
      turn_id: "turn_au04_cross_work_confirmation_seed",
      work_id: "work-au04-source",
      context_work_id: "work-au04-source",
      session_id: "session-source-au04",
      source_work_id: "work-au04-source",
      target_work_id: "work-au04-target",
      source_session_id: "session-source-au04",
      target_session_id: "session-target-au04",
      source_confirmation_visible_before_switch: true,
      source_confirm_button_count_before_switch: 1,
      source_reject_button_count_before_switch: 1,
      target_work_selected_from_real_menu: true,
      target_transcript_visible: true,
      source_confirmation_hidden_in_target: true,
      target_confirm_button_count: 0,
      target_reject_button_count: 0,
      author_action_sent_count: 0,
      channel_author_action_log_count: 0,
      toolbox_execute_after_cross_work_switch_count: 0,
      pending_prose_fragment_after_cross_work_switch_count: 0,
      no_author_action_sent_after_cross_work_switch: true,
      no_channel_author_action_log_after_cross_work_switch: true,
      no_tool_dispatch_after_cross_work_switch: true,
      no_pending_artifact_after_cross_work_switch: true,
      source_confirmation_restored_after_return: true,
    },
  ];
}

function au04LatestContextRebaseConfirmationRecords() {
  return [
    {
      event: "work_session.resume.done",
      work_id: "work-au04-rebase",
      session_id: "session-au04-rebase",
      transcript_count: 2,
    },
    {
      event: "channel.join.done",
      work_id: "work-au04-rebase",
      session_id: "session-au04-rebase",
    },
    {
      event: "channel.author_action.start",
      turn_id: "turn_au04_latest_context_rebase_seed",
      work_id: "work-au04-rebase",
      session_id: "session-au04-rebase",
      action_id: "act_au04_latest_context_confirm",
      action_type: "confirm_before_execute",
    },
    {
      event: "channel.author_action.done",
      turn_id: "turn_au04_latest_context_rebase_seed",
      work_id: "work-au04-rebase",
      session_id: "session-au04-rebase",
      action_id: "act_au04_latest_context_confirm",
      action_type: "confirm_before_execute",
      action_status: "accepted",
    },
    {
      event: "toolbox.execute.done",
      turn_id: "turn_au04_latest_context_rebase_seed",
      work_id: "work-au04-rebase",
      session_id: "session-au04-rebase",
      tool_name: "character_design",
      tool_outcome: "succeeded",
    },
    {
      event: "slice_verify.ui_state.done",
      slice_id: "au04-latest-context-rebase-confirmation",
      turn_id: "turn_au04_latest_context_rebase_seed",
      work_id: "work-au04-rebase",
      context_work_id: "work-au04-rebase",
      session_id: "session-au04-rebase",
      source_work_id: "work-au04-rebase",
      original_title: "AU04 最新上下文确认源作品",
      renamed_title: "AU04 最新上下文已改名",
      original_revision: 1,
      renamed_revision: 2,
      real_work_renamed_before_confirm: true,
      confirm_action_sent: true,
      confirmation_binding_ref:
        "state_snapshot:work-au04-rebase:session-au04-rebase:revision:2:turn_au04_latest_context_rebase_seed:plan_au04_latest_context_rebase:in_1",
      binding_ref_includes_source_work: true,
      binding_ref_includes_latest_revision: true,
      gate_result_refs: [
        "gate_result:confirmation_re_gate:turn_au04_latest_context_rebase_seed:plan_au04_latest_context_rebase:act_au04_latest_context_confirm",
      ],
      gate_result_ref_present: true,
      trace_context_includes_renamed_title: true,
      trace_current_work_summary:
        "AU04 最新上下文已改名 / 赛博修仙 / 确认前修改作品名后，确认执行必须重新读取最新作品快照",
      reason_codes_include_rebased_ref: true,
      reason_codes_include_gate_ref: true,
      confirmed_dispatch: true,
      artifact_pending_after_confirm: true,
      artifact_type: "character_seed",
      toolbox_execute_count: 1,
      pending_character_seed_count: 1,
    },
  ];
}
