defmodule NovelAgent.CreativeProvider do
  @moduledoc """
  Behaviour for provider-backed creative generation.
  """

  alias NovelCommon.Contracts.CreativeProviderResult
  alias NovelCommon.Contracts.CreativeRequest

  @callback generate(CreativeRequest.t(), (String.t() -> tuple())) :: CreativeProviderResult.t()
end
