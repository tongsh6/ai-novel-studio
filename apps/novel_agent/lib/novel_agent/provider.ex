defmodule NovelAgent.Provider do
  @moduledoc """
  Provider behaviour — LLM 能力提供者的统一抽象。

  Adapter 统一接入 provider execution stream。底层供应商即使只提供 final
  response，也必须在 adapter execution boundary 物化为同一套 ProviderRun /
  ProviderEvent / ProviderOutput 事实。兼容 `complete/3` 只能消费 stream 的
  final Result；应用层不应直接把 adapter callback 当作第二套执行体系。
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result

  @type message :: %{required(:role) => String.t(), required(:content) => String.t()}
  @type prompt :: String.t() | [message()]
  @type model :: String.t()
  @type model_option :: %{
          required(:id) => String.t(),
          optional(:label) => String.t(),
          optional(:owned_by) => String.t()
        }

  @type result :: {:ok, Result.t()} | {:error, reason :: term()}

  @doc """
  一次性请求并返回完整结果。

  params 为跨 provider 通用的推理参数，各 adapter 负责映射为自身 API 字段。
  该回调是 final-only adapter 的底层实现细节，不是应用层 provider 执行入口。
  """
  @callback complete(
              state :: term(),
              model :: model(),
              prompt :: prompt(),
              params :: InferenceParams.t()
            ) :: result()

  @doc """
  通过 provider execution stream 执行一次 provider 调用。

  支持底层分段事件的 adapter 可以实现该回调；final-only adapter 不实现时，
  Gateway 会通过 `NovelAgent.Provider.AdapterExecution.execute/6` 将 `complete/4`
  的终态结果投影进同一 execution stream。
  """
  @callback execute(
              state :: term(),
              model :: model() | nil,
              prompt :: prompt(),
              params :: InferenceParams.t(),
              ctx :: AdapterExecution.context()
            ) :: AdapterExecution.execution_result()

  @doc """
  轻量健康检查——不调用 LLM，不消耗 token。

  LM Studio: GET /v1/models
  Anthropic: 仅检查 API key 是否配置
  Stub: 始终 :ok
  """
  @callback health_check(state :: term()) :: :ok | {:error, term()}

  @doc """
  返回 provider 当前可用模型列表。

  云端 provider 必须实时调用供应商模型列表 API；本地 provider 调本地服务
  可见模型列表。该回调不应返回硬编码模型名。
  """
  @callback list_models(state :: term()) :: {:ok, [model_option()]} | {:error, term()}

  @doc """
  返回 provider 名称（用于日志和 audit）。
  """
  @callback name() :: String.t()

  @optional_callbacks list_models: 1, execute: 5

  @doc """
  Normalize legacy string prompts and chat prompts into OpenAI-compatible
  message maps.
  """
  @spec normalize_messages(prompt()) :: [message()]
  def normalize_messages(prompt) when is_binary(prompt), do: [%{role: "user", content: prompt}]

  def normalize_messages(messages) when is_list(messages) do
    Enum.map(messages, fn message ->
      role = Map.get(message, :role) || Map.get(message, "role")
      content = Map.get(message, :content) || Map.get(message, "content")

      %{role: to_string(role || "user"), content: to_string(content || "")}
    end)
  end
end
