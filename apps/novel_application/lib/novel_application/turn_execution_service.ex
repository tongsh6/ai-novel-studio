defmodule NovelApplication.TurnExecutionService do
  @moduledoc """
  Application service for the tool execution portion of a v3 turn.

  DialogueGateway delegates approved tool execution here. The service constructs
  ToolRequest, invokes the agent toolbox, assembles tentative artifacts, records
  trace, and builds the final TurnResult.
  """

  alias NovelAgent.Toolbox
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.Planner
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @creative_tools ~w(world_building character_design plot_outline prose_writing)

  @type execution_input :: %{
          required(:frame) => DialogueFrame.t(),
          required(:plan) => MicroPlan.t(),
          required(:decision) => OrchestratorDecision.t(),
          optional(:candidates) => list(),
          optional(:context) => term(),
          optional(:author_input) => map(),
          optional(:complete_fn) => function(),
          optional(:idempotency_suffix) => String.t()
        }

  @spec execute(execution_input()) :: {map(), NovelDomain.DecisionTrace.t()}
  def execute(%{frame: frame, plan: plan, decision: decision} = input) do
    req = build_tool_request(frame, plan, decision, input)
    tool_result = dispatch_tool(req, input[:complete_fn])
    artifact_set = assemble_artifact(tool_result, frame.turn_id, plan)

    {trace, trace_summary} =
      TraceWriter.record_with_tool(
        frame,
        plan,
        decision,
        req,
        tool_result,
        %{turn_id: frame.turn_id},
        input[:context]
      )

    assistant_message = narrate(tool_result, input[:complete_fn])

    turn_result =
      TurnResultBuilder.build(
        frame,
        trace_summary,
        input[:candidates] || [],
        decision,
        tool_result,
        artifact_set
      )
      |> Map.put(:assistant_message, %{text: assistant_message})

    {turn_result, trace}
  end

  defp build_tool_request(frame, plan, decision, input) do
    action = hd(plan.proposed_actions)
    tool_name = action[:target_ref] || action[:capability_name] || "text_analysis"
    entry = CapabilityRegistry.get(tool_name)

    %ToolRequest{
      tool_request_id: "tq_#{System.unique_integer([:positive, :monotonic])}",
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_ref: decision.decision_id,
      tool_name: tool_name,
      tool_version: (entry && entry.tool_version) || "unknown",
      input: tool_input(frame, action, input[:author_input], input[:context]),
      read_scope_grants: (entry && entry.read_scopes) || [],
      write_scope_grants: [],
      idempotency_key: "idem_#{frame.turn_id}_#{tool_name}#{input[:idempotency_suffix] || ""}",
      trace_policy: %{level: "standard"},
      created_at: DateTime.utc_now()
    }
  end

  defp tool_input(frame, action, author_input, context) do
    text =
      case author_input do
        %{text: text} when is_binary(text) -> text
        %{"text" => text} when is_binary(text) -> text
        _ -> frame.author_visible_draft.message
      end

    context_text = tool_context_text(context, text)

    %{
      "text" => text,
      "creative_brief" =>
        [action_summary(action), text] |> Enum.reject(&blank?/1) |> Enum.join("\n"),
      "context_text" => context_text
    }
  end

  defp tool_context_text(%NovelDomain.DialogueContext{} = context, text) do
    [NovelDomain.DialogueContext.to_prompt_text(context), "## 当前作者输入\n#{text}"]
    |> Enum.reject(&blank?/1)
    |> Enum.join("\n\n")
  end

  defp tool_context_text(_context, text), do: text

  defp action_summary(action) when is_map(action) do
    Map.get(action, :summary) || Map.get(action, "summary")
  end

  defp action_summary(_), do: nil

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""

  defp dispatch_tool(%ToolRequest{tool_name: tool_name} = req, complete_fn)
       when tool_name in @creative_tools do
    Toolbox.execute(req, complete_fn)
  end

  defp dispatch_tool(%ToolRequest{} = req, _complete_fn), do: Toolbox.execute(req)

  defp assemble_artifact(%ToolResult{tool_name: tool_name} = result, turn_id, plan)
       when tool_name in @creative_tools do
    case ArtifactAssembler.assemble(result, turn_id, plan_provenance(plan)) do
      {:ok, artifact_set} -> artifact_set
      {:error, _reason} -> nil
    end
  end

  defp assemble_artifact(_result, _turn_id, _plan), do: nil

  # 把本轮 MicroPlan 的生成意图（续写/重写 + 目标章）作为 provenance 传给 artifact 创建边界。
  defp plan_provenance(%MicroPlan{proposed_actions: [action | _]}) when is_map(action) do
    %{
      authoring_intent: Map.get(action, :authoring_intent),
      target_chapter: Map.get(action, :target_chapter)
    }
  end

  defp plan_provenance(_), do: %{}

  defp narrate(%ToolResult{status: :succeeded} = tool_result, complete_fn)
       when is_function(complete_fn, 1) do
    Planner.narrate_tool_result(tool_result, complete_fn)
  end

  defp narrate(%ToolResult{status: :succeeded}, _complete_fn) do
    "已生成一组待确认的创作材料。它们尚未采纳，也没有写入作品事实。"
  end

  defp narrate(%ToolResult{status: :failed} = tool_result, _complete_fn) do
    reason =
      tool_result.errors
      |> List.wrap()
      |> List.first(%{message: "工具执行失败"})
      |> Map.get(:message)

    "这次没有生成创作草稿，工具执行失败：#{reason}。未创建待采纳内容，也没有写入作品事实。"
  end

  defp narrate(_tool_result, _complete_fn) do
    "工具执行未完成。未创建待采纳内容，也没有写入作品事实。"
  end
end
