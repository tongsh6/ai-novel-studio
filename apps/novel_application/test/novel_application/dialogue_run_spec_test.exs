defmodule NovelApplication.DialogueRunSpecTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AgentRun
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "legacy 最多一步 text no longer caps budget without structured author_limits" do
    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "先看看现有角色阵容，然后设计一个反派，最多一步",
          workspace_id: "ws-budget",
          work_id: "work-budget",
          session_id: "session-budget",
          turn_id: "turn-budget-legacy-text"
        },
        nil,
        fn _ -> {:ok, %{content: "[]"}} end
      )

    assert spec.run_attrs.budget.max_steps > 1
    refute Map.has_key?(spec.run_attrs.budget, :author_max_steps)
  end

  test "one-step budget 收窄显式 profile 的 bounded run budget" do
    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "先看看现有角色阵容，然后设计一个反派",
          author_limits: %{max_steps: 1},
          workspace_id: "ws-budget",
          work_id: "work-budget",
          session_id: "session-budget",
          turn_id: "turn-budget"
        },
        nil,
        fn _ -> {:ok, %{content: "[]"}} end
      )

    assert spec.run_attrs.budget.max_steps == 1
    assert spec.run_attrs.budget.author_max_steps == 1
  end

  test "run_spec_for_profile 直接为显式 profile 构建 spec（不经判帧）" do
    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "设计一个反派",
          workspace_id: "ws-direct",
          work_id: "work-direct",
          session_id: "session-direct",
          turn_id: "turn-direct"
        },
        nil,
        fn _ -> {:ok, %{content: "[]"}} end
      )

    assert spec.run_attrs.profile_ref == "character_design_with_context_v1"
    assert spec.run_attrs.workspace_id == "ws-direct"
    assert spec.run_attrs.work_id == "work-direct"
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
  end

  test "run_spec_for_profile leaves missing work_id for the Domain to reject" do
    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "设计一个反派",
          workspace_id: "workspace-without-work",
          session_id: "session-without-work",
          turn_id: "turn-without-work"
        },
        nil,
        %Execution{result_fn: fn _ -> flunk("invalid run must not call provider") end}
      )

    assert spec.run_attrs.workspace_id == "workspace-without-work"
    assert is_nil(spec.run_attrs.work_id)
    assert {:error, errors} = AgentRun.new(spec.run_attrs)
    assert "work_id is required" in errors
  end

  test "修订动作显式 profile 构建 revision AgentRun spec" do
    spec =
      DialoguePlanningService.run_spec_for_profile(
        :prose_revision_from_findings,
        %{
          text: "按质量发现重写正文草稿",
          workspace_id: "ws-revision",
          work_id: "work-revision",
          session_id: "session-revision",
          turn_id: "turn-source",
          source_turn_result: %{},
          action_input: nil,
          trigger: %{
            kind: "author_action",
            receipt_id: "receipt-revision",
            action_type: "revise_from_findings",
            source_turn_ref: "turn-source"
          }
        },
        nil,
        fn _ -> {:ok, %{content: "{}"}} end
      )

    assert spec.run_attrs.profile_ref == "prose_revision_from_findings_v1"
    assert spec.run_attrs.parent_turn_ref == "turn-source"
    assert spec.run_attrs.trigger.receipt_id == "receipt-revision"
    assert spec.run_attrs.trigger.action_type == "revise_from_findings"
    assert spec.run_attrs.budget.max_steps == 6
    assert spec.run_attrs.budget.max_provider_calls == 8
    assert spec.run_attrs.authority_scope.allowed_tools == ["prose_writing"]
    assert is_function(spec.next_step_planner, 3)
    refute Map.has_key?(spec, :steps)
  end
end
