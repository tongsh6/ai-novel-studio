defmodule NovelApplication.ArtifactAssembler do
  @moduledoc """
  Converts successful creative ToolResult facts into TentativeArtifactSet.

  The assembler is the only boundary that creates tentative creative artifacts
  from tool output. Unknown artifact types and failed/empty outputs are
  validation failures, never fallbacks.
  """

  alias NovelCommon.Contracts.ToolOutputContract
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.TentativeArtifactSet

  # provenance（可选）：调用方（知道本轮 MicroPlan 意图）传入 :authoring_intent + :target_chapter，
  # 作为 artifact 生成来源记录，顺现有 artifact -> pending -> 采纳 流转到采纳层。默认空（非续写/重写）。
  @spec assemble(ToolResult.t(), String.t(), map()) ::
          {:ok, TentativeArtifactSet.t()} | {:error, map()}
  def assemble(tool_result, turn_ref, provenance \\ %{})

  def assemble(
        %ToolResult{status: :succeeded, output: output} = tool_result,
        turn_ref,
        provenance
      )
      when is_map(output) do
    with {:ok, artifact_type} <-
           ToolOutputContract.normalize_artifact_type(output[:artifact_type]),
         {:ok, items} <- ToolOutputContract.validate_creative_items(output[:items]) do
      {:ok,
       %TentativeArtifactSet{
         artifact_set_id: NovelFoundation.ID.unique("as"),
         artifact_type: artifact_type,
         items: items,
         source_turn_ref: turn_ref,
         source_tool_result_ref: tool_result.tool_result_id,
         authoring_intent: normalize_authoring_intent(Map.get(provenance, :authoring_intent)),
         target_chapter: normalize_target_chapter(Map.get(provenance, :target_chapter)),
         revision_base: normalize_target_chapter(Map.get(provenance, :revision_base)),
         revision_reason: normalize_target_chapter(Map.get(provenance, :revision_reason)),
         quality_finding_refs: normalize_refs(Map.get(provenance, :quality_finding_refs)),
         adoption_status: :tentative
       }}
    end
  end

  def assemble(%ToolResult{status: status}, _turn_ref, _provenance) when status != :succeeded do
    {:error,
     %{code: "tool_result_not_succeeded", message: "failed tool result cannot create artifact"}}
  end

  def assemble(%ToolResult{}, _turn_ref, _provenance) do
    {:error, %{code: "invalid_tool_output", message: "creative tool output is missing"}}
  end

  @doc """
  Assemble a creative ToolResult that may contain one primary artifact group
  plus prose companion groups. The primary group keeps chapter/revision
  provenance; companion seeds keep only the shared turn/tool source.
  """
  @spec assemble_all(ToolResult.t(), String.t(), map()) ::
          {:ok, [TentativeArtifactSet.t()]} | {:error, map()}
  def assemble_all(tool_result, turn_ref, provenance \\ %{})

  def assemble_all(
        %ToolResult{status: :succeeded, output: output} = tool_result,
        turn_ref,
        provenance
      )
      when is_map(output) do
    with {:ok, primary} <- assemble(tool_result, turn_ref, provenance),
         {:ok, companions} <- assemble_companions(tool_result, turn_ref, output) do
      {:ok, [primary | companions]}
    end
  end

  def assemble_all(%ToolResult{} = tool_result, turn_ref, provenance),
    do: assemble(tool_result, turn_ref, provenance) |> wrap_primary()

  defp assemble_companions(tool_result, turn_ref, output) do
    case Map.get(output, :companion_artifacts, []) do
      groups when is_list(groups) ->
        groups
        |> Enum.reduce_while([], &assemble_companion(&1, &2, tool_result, turn_ref))
        |> finalize_companions()

      _other ->
        {:error,
         %{
           code: "invalid_companion_artifacts",
           message: "creative tool companion_artifacts must be a list"
         }}
    end
  end

  defp assemble_companion(group, acc, tool_result, turn_ref) do
    companion_result = %{tool_result | output: group}

    case assemble(companion_result, turn_ref, %{}) do
      {:ok, artifact_set} -> {:cont, [artifact_set | acc]}
      {:error, reason} -> {:halt, {:error, reason}}
    end
  end

  defp finalize_companions({:error, _reason} = error), do: error
  defp finalize_companions(artifact_sets), do: {:ok, Enum.reverse(artifact_sets)}

  defp wrap_primary({:ok, primary}), do: {:ok, [primary]}
  defp wrap_primary({:error, _reason} = error), do: error

  defp normalize_authoring_intent(:continuation), do: :continuation
  defp normalize_authoring_intent(:rewrite), do: :rewrite
  defp normalize_authoring_intent("continuation"), do: :continuation
  defp normalize_authoring_intent("rewrite"), do: :rewrite
  defp normalize_authoring_intent(_), do: nil

  defp normalize_target_chapter(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_target_chapter(_), do: nil

  defp normalize_refs(list) when is_list(list) do
    list
    |> Enum.map(&normalize_target_chapter/1)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_refs(_), do: []
end
