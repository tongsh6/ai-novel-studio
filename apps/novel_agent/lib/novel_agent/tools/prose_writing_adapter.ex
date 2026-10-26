defmodule NovelAgent.Tools.ProseWritingAdapter do
  @moduledoc false

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.Contracts.ToolRequest

  @spec execute(ToolRequest.t(), Execution.dependency()) ::
          NovelCommon.Contracts.ToolResult.t()
  def execute(%ToolRequest{} = req, provider_execution) do
    type =
      if req.input["artifact_type"] == "prose_formatting_plan",
        do: :prose_formatting_plan,
        else: :prose_fragment

    CreativeToolAdapter.execute(req, type, provider_execution, Real)
  end
end
