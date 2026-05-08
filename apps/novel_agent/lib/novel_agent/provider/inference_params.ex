defmodule NovelAgent.Provider.InferenceParams do
  @moduledoc """
  跨 Provider 的通用推理参数。各 adapter 在构建请求体时映射为自己的 API 字段名。

  nil 值表示不传入请求体，让服务端使用默认值。
  """

  defstruct [:temperature, :max_tokens, :top_p, :stop]

  @type t :: %__MODULE__{
          temperature: float() | nil,
          max_tokens: pos_integer() | nil,
          top_p: float() | nil,
          stop: [String.t()] | nil
        }

  @doc "使用默认值创建（temperature 0.7，其余 nil）。可通过 keyword 覆盖。"
  @spec new(keyword()) :: t()
  def new(overrides \\ []) do
    defaults = [temperature: 0.7, max_tokens: nil, top_p: nil, stop: nil]
    struct!(%__MODULE__{}, Keyword.merge(defaults, overrides))
  end
end
