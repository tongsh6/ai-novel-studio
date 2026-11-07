defmodule NovelAgent.Provider.AnthropicStream do
  @moduledoc """
  Adapter-owned Anthropic event-stream execution.

  Anthropic Messages streaming uses named SSE events rather than the
  OpenAI-compatible `choices.delta` shape. This parser stays below Gateway so
  callers still consume the single ProviderExecution fact stream.

  B71 R2：取消/静默窗口/总时长/终止物化统一由 `NovelAgent.Provider.SSEStream`
  负责；本模块只绑定 Anthropic decoder（正文增量 + tool_use input_json 分片）。
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.SSEStream
  alias NovelAgent.Provider.SSEStream.AnthropicDecoder

  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())

  @doc false
  @spec execute(struct(), String.t(), map(), keyword(), AdapterExecution.context()) ::
          AdapterExecution.execution_result()
  def execute(state, url, body, request_opts, ctx) do
    SSEStream.execute(
      %{
        label: "Anthropic API",
        provider: "anthropic",
        log_vendor: "anthropic",
        state: state,
        url: url,
        body: body,
        request_opts: request_opts,
        ctx: ctx
      },
      AnthropicDecoder
    )
  end
end
