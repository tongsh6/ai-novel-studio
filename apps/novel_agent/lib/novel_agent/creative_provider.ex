defmodule NovelAgent.CreativeProvider do
  @moduledoc """
  Behaviour for provider-backed creative generation.
  """

  alias NovelCommon.Contracts.CreativeProviderResult
  alias NovelCommon.Contracts.CreativeRequest

  @callback generate(CreativeRequest.t(), NovelAgent.Provider.Execution.dependency()) ::
              CreativeProviderResult.t()
end
