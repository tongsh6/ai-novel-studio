defmodule NovelAgent.Tools.WorldBuildingAdapter do
  @moduledoc false

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.ToolOutputContract
  alias NovelCommon.Contracts.ToolRequest

  @spec execute(ToolRequest.t(), Execution.dependency()) ::
          NovelCommon.Contracts.ToolResult.t()
  def execute(%ToolRequest{} = req, provider_execution),
    do: CreativeToolAdapter.execute(req, artifact_type(req), provider_execution, Real)

  # B27 CP3d：设定草稿类型是任务语义的一部分，由 application 组装进
  # AuthoringTask.output_contract.artifact_type；adapter 不再持有第二份关键词表。
  # 缺失/非法时返回 :world_setting，CreativeToolAdapter 会因 task 缺失/非法返回 failed。
  defp artifact_type(%ToolRequest{input: input}) when is_map(input) do
    with %{} = map <- Map.get(input, "authoring_task") || Map.get(input, :authoring_task),
         %AuthoringTask{} = task <- AuthoringTask.from_map(map),
         type when not is_nil(type) <- artifact_type_from_task(task),
         {:ok, artifact_type} <- ToolOutputContract.normalize_artifact_type(type) do
      artifact_type
    else
      _ -> :world_setting
    end
  end

  defp artifact_type(_req), do: :world_setting

  defp artifact_type_from_task(%AuthoringTask{output_contract: contract}) when is_map(contract) do
    Map.get(contract, :artifact_type) || Map.get(contract, "artifact_type")
  end

  defp artifact_type_from_task(_task), do: nil
end
