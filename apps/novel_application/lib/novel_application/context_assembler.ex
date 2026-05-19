defmodule NovelApplication.ContextAssembler do
  @moduledoc """
  对话上下文组装。从各来源收集上下文片段，组装为 DialogueContext。

  VS-00B 使用可配置的 fetcher 回调（测试中 stub，生产中读 persistence）。
  Planner 只接收已组装好的 DialogueContext，不直接访问 Repo。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelDomain.ContextSourceRef
  alias NovelDomain.DialogueContext

  @doc """
  为给定 workspace 组装 DialogueContext。

  fetcher 是一个函数 `(workspace_id -> {:ok, snapshot, conv_summary, mem_summary, behavior_summary})`。
  测试中可注入 stub fetcher。
  """
  @type fetcher_return :: {:ok, map() | nil, String.t() | nil, String.t() | nil, String.t() | nil}
  @spec assemble(String.t(), (String.t() -> fetcher_return())) :: DialogueContext.t()
  def assemble(workspace_id, fetcher \\ &default_fetch/1) do
    assemble_for_input(workspace_id, nil, fetcher)
  end

  @doc """
  为当前作者输入组装 DialogueContext。

  新 fetcher 可实现 `(workspace_id, author_text -> fetcher_return)` 以支持相关记忆召回；
  旧的一参 fetcher 继续兼容，用于既有测试和不需要 query 的调用点。
  """
  @spec assemble_for_input(String.t(), String.t() | nil, function()) :: DialogueContext.t()
  def assemble_for_input(workspace_id, author_text, fetcher \\ &default_fetch/1) do
    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:context, :assemble, :start, %{})

    {:ok, snapshot, conv_summary, mem_summary, behavior_summary} =
      call_fetcher(fetcher, workspace_id, author_text)

    refs = build_refs(snapshot, conv_summary, mem_summary, behavior_summary)

    duration = System.monotonic_time(:millisecond) - t0

    LogEmit.emit(:context, :assemble, :done, %{
      context_refs_count: length(refs),
      has_snapshot: snapshot != nil,
      has_memory: mem_summary != nil,
      duration_ms: duration
    })

    %DialogueContext{
      workspace_id: workspace_id,
      current_work_snapshot: snapshot,
      conversation_summary: conv_summary,
      memory_summary: mem_summary,
      open_behavior_summary: behavior_summary,
      context_refs: refs,
      assembled_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp default_fetch(_workspace_id), do: {:ok, nil, nil, nil, nil}

  defp call_fetcher(fetcher, workspace_id, author_text) when is_function(fetcher) do
    case :erlang.fun_info(fetcher, :arity) do
      {:arity, 2} -> fetcher.(workspace_id, author_text)
      {:arity, 1} -> fetcher.(workspace_id)
    end
  end

  defp build_refs(snapshot, conv_summary, mem_summary, behavior_summary) do
    []
    |> maybe_add_ref(snapshot, :current_work, "current_work_snapshot")
    |> maybe_add_ref(conv_summary, :conversation, "conversation_summary")
    |> maybe_add_ref(mem_summary, :memory, "memory_summary")
    |> maybe_add_ref(behavior_summary, :behavior, "behavior_summary")
  end

  defp maybe_add_ref(refs, nil, _type, _id), do: refs

  defp maybe_add_ref(refs, value, type, id) do
    ref = %ContextSourceRef{
      context_ref: "ctx_#{System.unique_integer([:positive, :monotonic])}",
      source_type: type,
      source_id: id,
      summary: summarize_context(value, type),
      redaction_level: :author_safe
    }

    [ref | refs]
  end

  defp summarize_context(value, :current_work) when is_map(value) do
    title = Map.get(value, "title") || Map.get(value, :title)
    protagonist = Map.get(value, "protagonist") || Map.get(value, :protagonist)

    [title, protagonist]
    |> Enum.reject(&is_nil/1)
    |> Enum.join(" / ")
    |> case do
      "" -> "当前作品背景"
      summary -> summary
    end
  end

  defp summarize_context(value, :memory) when is_binary(value) do
    value
    |> String.split("\n")
    |> Enum.map_join("\n", &String.replace(&1, ~r/^\s*-\s*\[[^\]]+\]\s*/, ""))
    |> normalize_summary()
  end

  defp summarize_context(value, :conversation) when is_binary(value) do
    value
    |> String.replace(~r/\buser:/, "作者：")
    |> String.replace(~r/\bassistant:/, "AI：")
    |> normalize_summary()
  end

  defp summarize_context(value, _type) when is_binary(value) do
    normalize_summary(value)
  end

  defp summarize_context(_value, :memory), do: "已确认设定"
  defp summarize_context(_value, :conversation), do: "近期对话"
  defp summarize_context(_value, :behavior), do: "当前待处理动作"
  defp summarize_context(_value, _type), do: "安全上下文摘要"

  defp normalize_summary(value) do
    value
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> String.slice(0, 180)
  end
end
