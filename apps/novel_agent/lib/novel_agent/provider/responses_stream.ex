defmodule NovelAgent.Provider.ResponsesStream do
  @moduledoc """
  Adapter-owned OpenAI Responses API event-stream execution（B71 R2）。

  Responses SSE 同时承载正文增量、工具参数增量、output item 生命周期与
  `response.completed` 终止事实。取消/静默窗口/总时长/终止物化统一由
  `NovelAgent.Provider.SSEStream` 负责；本模块只绑定 Responses decoder，
  最终事实由 `NovelAgent.Provider.ResponsesWire` 与非流式响应共用同一解析。
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.SSEStream
  alias NovelAgent.Provider.SSEStream.ResponsesDecoder

  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())

  @doc false
  @spec execute(map(), struct(), String.t(), map(), keyword(), AdapterExecution.context()) ::
          AdapterExecution.execution_result()
  def execute(meta, state, url, body, request_opts, ctx) do
    SSEStream.execute(
      %{
        label: meta.label,
        provider: meta.vendor,
        log_vendor: meta.vendor,
        state: state,
        url: url,
        body: body,
        request_opts: request_opts,
        ctx: ctx
      },
      ResponsesDecoder
    )
  end
end
