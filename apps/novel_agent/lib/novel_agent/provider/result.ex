defmodule NovelAgent.Provider.Result do
  @moduledoc """
  Provider 调用统一结果。

  所有 adapter 必须返回此 struct。
  """

  alias NovelAgent.Provider.Usage

  defstruct [:content, :usage]

  @type t :: %__MODULE__{
          content: String.t(),
          usage: Usage.t() | nil
        }

  @doc "创建一个 Result。"
  @spec new(String.t(), Usage.t() | nil) :: t()
  def new(content, usage \\ nil) do
    %__MODULE__{content: content, usage: usage}
  end
end
