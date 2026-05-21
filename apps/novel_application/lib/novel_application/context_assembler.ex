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
    assemble_for_input(workspace_id, nil, fetcher, [])
  end

  @doc """
  为当前作者输入组装 DialogueContext。

  新 fetcher 可实现 `(workspace_id, author_text -> fetcher_return)` 以支持相关记忆召回；
  也可实现 `(workspace_id, author_text, session_id -> fetcher_return)` 以支持会话内对话召回；
  旧的一参 fetcher 继续兼容，用于既有测试和不需要 query 的调用点。
  """
  @spec assemble_for_input(String.t(), String.t() | nil, function(), keyword()) ::
          DialogueContext.t()
  def assemble_for_input(workspace_id, author_text, fetcher \\ &default_fetch/1, opts \\ []) do
    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:context, :assemble, :start, %{})

    {:ok, snapshot, conv_summary, mem_summary, behavior_summary} =
      call_fetcher(fetcher, workspace_id, author_text, Keyword.get(opts, :session_id))

    refs = build_refs(snapshot, conv_summary, mem_summary, behavior_summary)

    duration = System.monotonic_time(:millisecond) - t0

    LogEmit.emit(:context, :assemble, :done, %{
      context_refs_count: length(refs),
      has_snapshot: snapshot != nil,
      has_conversation: conv_summary != nil,
      has_session_summary: session_summary?(conv_summary),
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

  defp session_summary?(summary) when is_binary(summary),
    do: String.contains?(summary, "会话早期摘要")

  defp session_summary?(_summary), do: false

  defp call_fetcher(fetcher, workspace_id, author_text, session_id) when is_function(fetcher) do
    case :erlang.fun_info(fetcher, :arity) do
      {:arity, 3} -> fetcher.(workspace_id, author_text, session_id)
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
    case summarize_context(value, type) do
      nil ->
        refs

      "" ->
        refs

      summary ->
        ref = %ContextSourceRef{
          context_ref: "ctx_#{System.unique_integer([:positive, :monotonic])}",
          source_type: type,
          source_id: id,
          summary: summary,
          redaction_level: :author_safe
        }

        [ref | refs]
    end
  end

  defp summarize_context(value, :current_work) when is_map(value) do
    title = Map.get(value, "title") || Map.get(value, :title)
    context_parts = current_work_context_parts(value)
    current_work_summary(title, context_parts)
  end

  defp summarize_context(value, :conversation) when is_binary(value) do
    summarize_conversation(value) || normalize_summary(value)
  end

  defp summarize_context(value, :memory) when is_binary(value) do
    value
    |> String.split("\n")
    |> Enum.map_join("\n", &String.replace(&1, ~r/^\s*-\s*\[[^\]]+\]\s*/, ""))
    |> normalize_summary()
  end

  defp summarize_context(value, _type) when is_binary(value) do
    normalize_summary(value)
  end

  defp summarize_context(_value, :current_work), do: nil
  defp summarize_context(_value, :memory), do: "已确认设定"
  defp summarize_context(_value, :conversation), do: "近期对话"
  defp summarize_context(_value, :behavior), do: "当前待处理动作"
  defp summarize_context(_value, _type), do: "安全上下文摘要"

  defp current_work_context_parts(value) do
    [
      Map.get(value, "genre") || Map.get(value, :genre),
      Map.get(value, "protagonist") || Map.get(value, :protagonist),
      Map.get(value, "protagonist_goal") || Map.get(value, :protagonist_goal),
      Map.get(value, "current_chapter") || Map.get(value, :current_chapter),
      Map.get(value, "world_setting") || Map.get(value, :world_setting)
    ]
    |> Enum.map(&normalize_part/1)
    |> Enum.reject(&is_nil/1)
  end

  defp current_work_summary(title, context_parts) do
    title = normalize_part(title)

    cond do
      context_parts == [] ->
        nil

      unnamed_work_title?(title) ->
        context_parts
        |> Enum.take(3)
        |> Enum.join(" / ")
        |> normalize_summary()

      true ->
        [title | context_parts]
        |> Enum.reject(&is_nil/1)
        |> Enum.take(4)
        |> Enum.join(" / ")
        |> normalize_summary()
    end
  end

  defp summarize_conversation(value) do
    normalized = normalize_summary(value)
    author_text = latest_role_text(normalized, "user")
    assistant_text = latest_role_text(normalized, "assistant")

    cond do
      author_text && assistant_text ->
        "上一轮围绕「#{author_text}」展开，AI 已给出回应。"

      author_text ->
        "上一轮作者提到「#{author_text}」。"

      assistant_text ->
        "上一轮 AI 已给出回应。"

      true ->
        nil
    end
  end

  defp latest_role_text(nil, _role), do: nil

  defp latest_role_text(value, role) do
    pattern = ~r/(?:^|\s)#{role}:\s*(.*?)(?=\s(?:user|assistant):|$)/u

    pattern
    |> Regex.scan(value)
    |> List.last()
    |> case do
      [_, text] ->
        text
        |> String.trim()
        |> String.slice(0, 48)

      _ ->
        nil
    end
  end

  defp normalize_part(value) when is_binary(value) do
    value
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> case do
      "" -> nil
      normalized -> normalized
    end
  end

  defp normalize_part(_value), do: nil

  defp unnamed_work_title?(nil), do: true

  defp unnamed_work_title?(title) do
    title in ["未命名作品", "Unnamed Work", "Untitled", "untitled"]
  end

  defp normalize_summary(nil), do: nil

  defp normalize_summary(value) do
    value
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> String.slice(0, 180)
    |> case do
      "" -> nil
      summary -> summary
    end
  end
end
