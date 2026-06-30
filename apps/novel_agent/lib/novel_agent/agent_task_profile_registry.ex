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

  @conversation_allowed_tools NovelCommon.CapabilityRegistry.list()
                              |> Enum.filter(&NovelCommon.CapabilityRegistry.dispatchable?/1)

  @conversation_turn_profile %{
    profile_id: "conversation_turn_v1",
    allowed_tools: @conversation_allowed_tools,
    required_observations: [],
    completion_conditions: ["turn_result_emitted"],
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

  @spec get(String.t()) :: map() | nil
  def get("character_design_with_context_v1"), do: @character_design_profile
  def get("prose_drafting_with_quality_v1"), do: @prose_drafting_profile
  def get("plot_outline_with_context_v1"), do: @plot_outline_profile
  def get("character_evolution_with_context_v1"), do: @character_evolution_profile
  def get("conversation_turn_v1"), do: @conversation_turn_profile
  def get("provider_progress_v1"), do: @provider_progress_profile
  def get("readonly_batch_context_v1"), do: @readonly_batch_context_profile
  def get(_profile_id), do: nil

  @spec allowed_tool?(String.t(), String.t()) :: boolean()
  def allowed_tool?(profile_id, tool_name) do
    case get(profile_id) do
      %{allowed_tools: tools} -> tool_name in tools
      _ -> false
    end
  end
end
