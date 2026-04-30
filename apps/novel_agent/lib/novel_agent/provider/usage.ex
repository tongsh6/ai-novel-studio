defmodule NovelAgent.Provider.Usage do
  @moduledoc """
  Provider 调用用量计量。

  统一记录每次 LLM 调用的 token 消耗和延迟。
  字段定义冻结于 08-provider-abstraction.md §5。
  """

  defstruct [:input_tokens, :output_tokens, :model, :latency_ms]

  @type t :: %__MODULE__{
          input_tokens: non_neg_integer(),
          output_tokens: non_neg_integer(),
          model: String.t(),
          latency_ms: non_neg_integer()
        }

  @doc "创建一个 Usage 记录。"
  @spec new(non_neg_integer(), non_neg_integer(), String.t(), non_neg_integer()) :: t()
  def new(input_tokens, output_tokens, model, latency_ms) do
    %__MODULE__{
      input_tokens: input_tokens,
      output_tokens: output_tokens,
      model: model,
      latency_ms: latency_ms
    }
  end
end
