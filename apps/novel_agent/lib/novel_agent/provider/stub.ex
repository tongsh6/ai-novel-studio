defmodule NovelAgent.Provider.Stub do
  @moduledoc """
  Stub provider — 返回固定回显响应。

  根据 08-provider-abstraction.md §2.4，stub 是正式 provider 实现，用于：
  - greenfield 开发期间离线验证
  - 契约测试
  - Provider Gateway 骨架调试
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.Result

  defstruct []

  @type t :: %__MODULE__{}

  @impl true
  def complete(_state, _model, prompt, _params) do
    {:ok, Result.new("[stub] echo: #{prompt}")}
  end

  @impl true
  def name, do: "stub"
end
