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

  @spec assemble(ToolResult.t(), String.t()) ::
          {:ok, TentativeArtifactSet.t()} | {:error, map()}
  def assemble(%ToolResult{status: :succeeded, output: output} = tool_result, turn_ref)
      when is_map(output) do
    with {:ok, artifact_type} <-
           ToolOutputContract.normalize_artifact_type(output[:artifact_type]),
         {:ok, items} <- ToolOutputContract.validate_creative_items(output[:items]) do
      {:ok,
       %TentativeArtifactSet{
         artifact_set_id: "as_#{System.unique_integer([:positive, :monotonic])}",
         artifact_type: artifact_type,
         items: items,
         source_turn_ref: turn_ref,
         source_tool_result_ref: tool_result.tool_result_id,
         adoption_status: :tentative
       }}
    end
  end

  def assemble(%ToolResult{status: status}, _turn_ref) when status != :succeeded do
    {:error,
     %{code: "tool_result_not_succeeded", message: "failed tool result cannot create artifact"}}
  end

  def assemble(%ToolResult{}, _turn_ref) do
    {:error, %{code: "invalid_tool_output", message: "creative tool output is missing"}}
  end
end
