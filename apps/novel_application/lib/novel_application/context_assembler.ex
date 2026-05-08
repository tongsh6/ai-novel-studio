defmodule NovelApplication.ContextAssembler do
  @moduledoc """
  对话上下文组装。从各来源收集上下文片段，组装为 DialogueContext。

  VS-00B 使用可配置的 fetcher 回调（测试中 stub，生产中读 persistence）。
  Planner 只接收已组装好的 DialogueContext，不直接访问 Repo。
  """

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
    {:ok, snapshot, conv_summary, mem_summary, behavior_summary} = fetcher.(workspace_id)

    refs = build_refs(snapshot, conv_summary, mem_summary, behavior_summary)

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

  defp build_refs(snapshot, conv_summary, mem_summary, behavior_summary) do
    []
    |> maybe_add_ref(snapshot, :current_work, "current_work_snapshot")
    |> maybe_add_ref(conv_summary, :conversation, "conversation_summary")
    |> maybe_add_ref(mem_summary, :memory, "memory_summary")
    |> maybe_add_ref(behavior_summary, :behavior, "behavior_summary")
  end

  defp maybe_add_ref(refs, nil, _type, _id), do: refs

  defp maybe_add_ref(refs, _value, type, id) do
    ref = %ContextSourceRef{
      context_ref: "ctx_#{System.unique_integer([:positive, :monotonic])}",
      source_type: type,
      source_id: id,
      summary: "context from #{type}",
      redaction_level: :author_safe
    }

    [ref | refs]
  end
end
