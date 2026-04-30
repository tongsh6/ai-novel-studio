defmodule NovelFoundation.UpstreamError do
  @moduledoc """
  标准化上游服务错误（Provider Error）。

  按 `docs/design-v2/08-provider-abstraction.md` §6 分类，覆盖本地 provider 错误
  并为云端 provider 预留错误类型。

  所有 provider adapter 返回的 error 必须使用本模块的 error type，确保上层
  (TurnService / Gateway) 可以统一处理。
  """

  @type error_type ::
          :connection_refused
          | :timeout
          | :invalid_response
          | :model_not_loaded
          | :auth
          | :rate_limit
          | :content_filter
          | :provider_internal
          | :parse

  @type t :: %__MODULE__{
          type: error_type(),
          message: String.t(),
          provider: String.t(),
          retryable: boolean(),
          details: map()
        }

  @enforce_keys [:type, :message, :provider]
  defstruct [:type, :message, :provider, retryable: false, details: %{}]

  @doc "创建标准化 provider error。"
  @spec new(error_type(), String.t(), String.t()) :: t()
  def new(type, message, provider_name) when is_binary(provider_name) do
    %__MODULE__{
      type: type,
      message: message,
      provider: provider_name,
      retryable: retryable?(type)
    }
  end

  @doc "创建带 details 的 provider error。"
  @spec new(error_type(), String.t(), String.t(), map()) :: t()
  def new(type, message, provider_name, details) when is_map(details) do
    %__MODULE__{new(type, message, provider_name) | details: details}
  end

  @doc "检查错误是否可重试。"
  @spec retryable?(error_type()) :: boolean()
  def retryable?(:connection_refused), do: true
  def retryable?(:timeout), do: true
  def retryable?(:rate_limit), do: true
  def retryable?(:provider_internal), do: true
  def retryable?(:invalid_response), do: false
  def retryable?(:model_not_loaded), do: false
  def retryable?(:auth), do: false
  def retryable?(:content_filter), do: false
  def retryable?(:parse), do: false

  @doc "转换为上层可消费的 error map。"
  @spec to_error_tuple(t()) :: {:error, map()}
  def to_error_tuple(%__MODULE__{} = error) do
    {:error,
     %{
       type: error.type,
       message: error.message,
       provider: error.provider,
       retryable: error.retryable
     }}
  end
end
