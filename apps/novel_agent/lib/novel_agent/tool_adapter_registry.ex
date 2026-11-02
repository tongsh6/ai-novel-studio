defmodule NovelAgent.ToolAdapterRegistry do
  @moduledoc """
  Agent-side adapter registry for dispatchable tools.
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.NativeToolExchange
  alias NovelAgent.Tools.CharacterDesignAdapter
  alias NovelAgent.Tools.CharacterEvolutionAdapter
  alias NovelAgent.Tools.CharacterRosterAdapter
  alias NovelAgent.Tools.PlotOutlineAdapter
  alias NovelAgent.Tools.ProseWritingAdapter
  alias NovelAgent.Tools.TextAnalysisAdapter
  alias NovelAgent.Tools.WorldBuildingAdapter
  alias NovelCommon.Contracts.ToolResult

  @creative_adapters [
    CharacterDesignAdapter,
    CharacterEvolutionAdapter,
    PlotOutlineAdapter,
    ProseWritingAdapter,
    WorldBuildingAdapter
  ]

  @spec adapter_for(String.t()) :: module() | nil
  def adapter_for("text_analysis"), do: TextAnalysisAdapter
  def adapter_for("character_roster"), do: CharacterRosterAdapter
  def adapter_for("character_design"), do: CharacterDesignAdapter
  def adapter_for("character_evolution"), do: CharacterEvolutionAdapter
  def adapter_for("plot_outline"), do: PlotOutlineAdapter
  def adapter_for("prose_writing"), do: ProseWritingAdapter
  def adapter_for("world_building"), do: WorldBuildingAdapter
  def adapter_for(_tool_name), do: nil

  @spec creative_adapter?(module()) :: boolean()
  def creative_adapter?(adapter), do: adapter in @creative_adapters

  @spec execute_with_session(
          String.t(),
          NovelCommon.Contracts.ToolRequest.t(),
          Execution.dependency(),
          keyword()
        ) ::
          {NovelCommon.Contracts.ToolResult.t(), map()}
  def execute_with_session(tool_name, req, provider_execution, opts \\ []) do
    adapter = adapter_for(tool_name)

    if is_nil(adapter) do
      {failed(req, "no_handler", "no adapter registered for tool"), %{tool_call_count: 0}}
    else
      case validate_options(adapter, opts) do
        :ok ->
          tool_name
          |> execute_for(req, provider_execution, opts)
          |> record_dispatch()

        {:error, code, message} ->
          {failed(req, code, message), %{tool_call_count: 0}}
      end
    end
  end

  # 统一选项边界：validate_result 只能是 nil 或 arity 1；max_provider_calls 必须是
  # 非负整数。非 creative 工具不支持这两类限制时在派发前明确拒绝，不静默忽略。
  defp validate_options(adapter, opts) do
    with {:ok, _max_provider_calls} <- NativeToolExchange.validate_options(opts) do
      validate_supported_options(adapter, opts)
    end
  end

  defp validate_supported_options(adapter, opts) do
    cond do
      creative_adapter?(adapter) ->
        :ok

      Keyword.get(opts, :validate_result) != nil ->
        {:error, "unsupported_validator_option",
         "validate_result is only supported for creative tools"}

      Keyword.has_key?(opts, :max_provider_calls) ->
        {:error, "unsupported_provider_call_option",
         "max_provider_calls is only supported for creative tools"}

      true ->
        :ok
    end
  end

  # 只有真正进入 adapter 派发才记 1；registry/授权/grant/选项前置拒绝均为 0。
  defp record_dispatch({result, session}) when is_map(session),
    do: {result, Map.put(session, :tool_call_count, 1)}

  defp record_dispatch({result, _session}), do: {result, %{tool_call_count: 1}}

  defp execute_for("character_design", req, provider_execution, opts),
    do: CharacterDesignAdapter.execute_with_session(req, provider_execution, opts)

  defp execute_for("character_evolution", req, provider_execution, opts),
    do: CharacterEvolutionAdapter.execute_with_session(req, provider_execution, opts)

  defp execute_for("plot_outline", req, provider_execution, opts),
    do: PlotOutlineAdapter.execute_with_session(req, provider_execution, opts)

  defp execute_for("prose_writing", req, provider_execution, opts),
    do: ProseWritingAdapter.execute_with_session(req, provider_execution, opts)

  defp execute_for("world_building", req, provider_execution, opts),
    do: WorldBuildingAdapter.execute_with_session(req, provider_execution, opts)

  defp execute_for(tool_name, req, provider_execution, _opts),
    do: {execute(tool_name, req, provider_execution), %{}}

  defp failed(req, code, message) do
    %ToolResult{
      tool_result_id: NovelFoundation.ID.unique("tr"),
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :failed,
      output: nil,
      errors: [%{code: code, message: message}],
      artifact_refs: [],
      state_delta: [],
      completed_at: DateTime.utc_now()
    }
  end

  @spec execute(String.t(), NovelCommon.Contracts.ToolRequest.t(), Execution.dependency()) ::
          NovelCommon.Contracts.ToolResult.t()
  def execute("text_analysis", req, provider_execution),
    do: TextAnalysisAdapter.execute(req, provider_execution)

  def execute("character_roster", req, provider_execution),
    do: CharacterRosterAdapter.execute(req, provider_execution)

  def execute("character_design", req, provider_execution),
    do: CharacterDesignAdapter.execute(req, provider_execution)

  def execute("character_evolution", req, provider_execution),
    do: CharacterEvolutionAdapter.execute(req, provider_execution)

  def execute("plot_outline", req, provider_execution),
    do: PlotOutlineAdapter.execute(req, provider_execution)

  def execute("prose_writing", req, provider_execution),
    do: ProseWritingAdapter.execute(req, provider_execution)

  def execute("world_building", req, provider_execution),
    do: WorldBuildingAdapter.execute(req, provider_execution)
end
