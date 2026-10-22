defmodule NovelAgent.Provider.Usage do
  @moduledoc """
  Provider 调用用量计量。

  统一记录每次 LLM 调用的 token 消耗和延迟，是所有 provider usage 的**唯一表示**：
  每个 adapter 都必须把各家原生 usage 归一化成本结构体，下游（日志、trace）只认这一种形态。
  字段定义冻结于 08-provider-abstraction.md §5。
  """

  @derive Jason.Encoder
  defstruct [:input_tokens, :output_tokens, :model, :latency_ms, :cached_tokens, :ttft_ms]

  @type t :: %__MODULE__{
          input_tokens: non_neg_integer(),
          output_tokens: non_neg_integer(),
          model: String.t() | nil,
          latency_ms: non_neg_integer(),
          cached_tokens: non_neg_integer() | nil,
          ttft_ms: non_neg_integer() | nil
        }

  @doc "创建一个 Usage 记录。所有构造最终收敛到这里。"
  @spec new(
          non_neg_integer(),
          non_neg_integer(),
          String.t() | nil,
          non_neg_integer(),
          non_neg_integer() | nil,
          non_neg_integer() | nil
        ) :: t()
  def new(input_tokens, output_tokens, model, latency_ms, cached_tokens \\ nil, ttft_ms \\ nil) do
    %__MODULE__{
      input_tokens: input_tokens,
      output_tokens: output_tokens,
      model: model,
      latency_ms: latency_ms,
      cached_tokens: cached_tokens,
      ttft_ms: ttft_ms
    }
  end

  @doc "补写首 token 延迟；流式路径在首个 delta 到达时设置。"
  @spec put_ttft(t(), non_neg_integer() | nil) :: t()
  def put_ttft(%__MODULE__{} = usage, nil), do: usage
  def put_ttft(%__MODULE__{} = usage, ttft_ms), do: %{usage | ttft_ms: ttft_ms}

  @doc """
  从 OpenAI 兼容响应体构造（`usage.prompt_tokens` / `usage.completion_tokens`）。

  LM Studio / DeepSeek / OpenAI 兼容矩阵共用此入口。缓存命中优先读
  `prompt_tokens_details.cached_tokens`（OpenAI / LM Studio），兼容
  `prompt_cache_hit_tokens`（DeepSeek）。
  """
  @spec from_openai_response(map(), String.t() | nil, non_neg_integer()) :: t()
  def from_openai_response(resp_body, fallback_model, latency_ms) when is_map(resp_body) do
    usage = resp_body["usage"] || %{}

    new(
      usage["prompt_tokens"] || 0,
      usage["completion_tokens"] || 0,
      resp_body["model"] || fallback_model,
      latency_ms,
      usage["prompt_tokens_details"]["cached_tokens"] ||
        usage["prompt_cache_hit_tokens"] ||
        usage["cached_tokens"]
    )
  end

  @doc "从 Anthropic 响应体构造（`usage.input_tokens` / `usage.output_tokens`）。"
  @spec from_anthropic_response(map(), String.t() | nil, non_neg_integer()) :: t()
  def from_anthropic_response(resp_body, fallback_model, latency_ms) when is_map(resp_body) do
    usage = resp_body["usage"] || %{}

    new(
      usage["input_tokens"] || 0,
      usage["output_tokens"] || 0,
      resp_body["model"] || fallback_model,
      latency_ms,
      usage["cache_read_input_tokens"]
    )
  end

  @doc "转为可序列化 map（`nil` → `%{}`）。日志 / trace 边界用。"
  @spec to_map(t() | nil) :: map()
  def to_map(%__MODULE__{} = usage), do: Map.from_struct(usage)
  def to_map(_usage), do: %{}
end
