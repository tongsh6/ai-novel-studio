defmodule NovelAgent.AgentTaskProfileRegistry do
  @moduledoc """
  Agent-owned task profile registry.

  Profiles constrain which tools an AgentRun may use. They are intentionally
  narrower than the global capability registry.
  """

  @character_design_profile %{
    profile_id: "character_design_with_context_v1",
    allowed_tools: ["character_roster", "character_design"],
    required_observations: ["character_roster"],
    completion_conditions: ["tentative_character_seed_created"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  # CP4（ADR-0025 决策 2）：判断①判"复杂"时的跨能力真计划 profile——
  # 能力目录为可选目标集，计划由模型制定并维护（N-PLAN）。
  @judgment_plan_profile %{
    profile_id: "judgment_plan_v1",
    allowed_tools: [
      "character_roster",
      "character_design",
      "character_evolution",
      "plot_outline",
      "world_building",
      "prose_writing"
    ],
    required_observations: [],
    completion_conditions: ["planned_steps_completed"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  @prose_drafting_profile %{
    profile_id: "prose_drafting_with_quality_v1",
    allowed_tools: ["prose_writing"],
    required_observations: [],
    completion_conditions: ["tentative_prose_fragment_created", "quality_review_recorded"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  @plot_outline_profile %{
    profile_id: "plot_outline_with_context_v1",
    allowed_tools: ["plot_outline"],
    required_observations: [],
    completion_conditions: ["tentative_outline_draft_created"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  @character_evolution_profile %{
    profile_id: "character_evolution_with_context_v1",
    allowed_tools: ["character_evolution"],
    required_observations: [],
    completion_conditions: ["tentative_character_evolution_seed_created"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  @world_building_profile %{
    profile_id: "world_building_with_context_v1",
    allowed_tools: ["world_building"],
    required_observations: [],
    completion_conditions: ["tentative_world_setting_created"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  @prose_revision_profile %{
    profile_id: "prose_revision_from_findings_v1",
    allowed_tools: ["prose_writing"],
    required_observations: ["revision_source_loaded", "revision_orchestrator_decision_recorded"],
    completion_conditions: ["tentative_revision_fragment_created"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  @provider_progress_profile %{
    profile_id: "provider_progress_v1",
    allowed_tools: ["provider_complete"],
    required_observations: [],
    completion_conditions: ["provider_progress_recorded"],
    pause_conditions: [
      "target_work_missing",
      "run_budget_exhausted",
      "provider_execution_cancel_requested"
    ],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  @readonly_batch_context_profile %{
    profile_id: "readonly_batch_context_v1",
    allowed_tools: ["readonly_batch"],
    required_observations: [],
    completion_conditions: ["readonly_batch_observations_exist"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  # 全书审读 profile（VS-00F CP4c-2）：readonly 只读纪律 + 恰一 tentative 审读报告
  # （repo 物化）；规则判定机械（I-L4），模型只起草计划。
  @ledger_reconciliation_profile %{
    profile_id: "ledger_reconciliation_v1",
    allowed_tools: ["ledger_reconcile"],
    required_observations: [],
    completion_conditions: ["ledger_reconcile_observation_exists"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  # 判断循环入口 profile（ADR-0025 CP1）：路由语义已并入判断①，能力=判断本身。
  @judgment_loop_profile %{
    profile_id: "judgment_loop_v1",
    allowed_tools: ["judgment"],
    required_observations: [],
    completion_conditions: ["judgment_settled"],
    pause_conditions: ["target_work_missing", "run_budget_exhausted", "no_progress"],
    run_policy_ref: "bounded_small_v1",
    durable_eligible: false
  }

  @spec get(String.t()) :: map() | nil
  def get("judgment_loop_v1"), do: @judgment_loop_profile
  def get("character_design_with_context_v1"), do: @character_design_profile
  def get("judgment_plan_v1"), do: @judgment_plan_profile
  def get("prose_drafting_with_quality_v1"), do: @prose_drafting_profile
  def get("plot_outline_with_context_v1"), do: @plot_outline_profile
  def get("character_evolution_with_context_v1"), do: @character_evolution_profile
  def get("world_building_with_context_v1"), do: @world_building_profile
  def get("prose_revision_from_findings_v1"), do: @prose_revision_profile
  def get("provider_progress_v1"), do: @provider_progress_profile
  def get("readonly_batch_context_v1"), do: @readonly_batch_context_profile
  def get("ledger_reconciliation_v1"), do: @ledger_reconciliation_profile
  def get(_profile_id), do: nil

  @spec allowed_tool?(String.t(), String.t()) :: boolean()
  def allowed_tool?(profile_id, tool_name) do
    case get(profile_id) do
      %{allowed_tools: tools} -> tool_name in tools
      _ -> false
    end
  end
end
