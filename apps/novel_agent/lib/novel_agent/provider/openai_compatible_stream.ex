defmodule NovelAgent.Provider.OpenAICompatibleStream do
  @moduledoc """
  Adapter-owned OpenAI-compatible event-stream execution.

  This module is intentionally below `Provider.Gateway`: it handles wire-level
  SSE chunks for adapters, while Gateway and application callers still consume
  the single ProviderExecution fact stream.

  B71 R2：取消/静默窗口/总时长/终止物化统一由 `NovelAgent.Provider.SSEStream`
  负责；本模块只绑定 Chat Completions decoder（正文增量 + tool_calls 分片累积）。
  """

  alias NovelAgent.Provider.SSEStream
  alias NovelAgent.Provider.SSEStream.ChatDecoder

  @type meta :: %{
          required(:vendor) => String.t(),
          required(:label) => String.t()
        }

  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())

  @doc false
  @spec execute(meta(), struct(), String.t(), map(), keyword(), AdapterExecution.context()) ::
          AdapterExecution.execution_result()
  def execute(meta, state, url, body, request_opts, ctx),
    do: execute(meta, state, url, body, request_opts, ctx, [])

  @doc false
  @spec execute(
          meta(),
          struct(),
          String.t(),
          map(),
          keyword(),
          AdapterExecution.context(),
          keyword()
        ) :: AdapterExecution.execution_result()
  def execute(meta, state, url, body, request_opts, ctx, opts) do
    SSEStream.execute(
      %{
        label: meta.label,
        provider: meta.vendor,
        log_vendor: meta.vendor,
        state: state,
        url: url,
        body: body,
        request_opts: request_opts,
        ctx: ctx,
        provider_state_fun: Keyword.get(opts, :provider_state_fun)
      },
      ChatDecoder
    )
  end
end
