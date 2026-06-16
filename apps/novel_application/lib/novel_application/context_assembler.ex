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

  fetcher 是一个函数，返回 5 元组（基础上下文）、6 元组（+章节标题）或 7 元组（+结构化章节条目）。
  测试中可注入 stub fetcher。
  """
  # fetcher 可返回 5 元组（无章节，向后兼容既有 stub）、6 元组（末位为已采纳章节标题列表）
  # 或 7 元组（标题列表 + 结构化章节条目，VS-00C CP3）。
  @type fetcher_return ::
          {:ok, map() | nil, String.t() | nil, String.t() | nil, String.t() | nil}
          | {:ok, map() | nil, String.t() | nil, String.t() | nil, String.t() | nil, [String.t()]}
          | {:ok, map() | nil, String.t() | nil, String.t() | nil, String.t() | nil, [String.t()],
             [map()]}
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

    # CP1（关 G10 / AU-03 SC-B3）：fetcher 异常/非 ok 时不让整轮崩溃，降级为**明确**空上下文
    # 并留痕（context.assemble.fallback），后续 Planner 在空上下文下诚实说明读不到，而不是编造。
    {:ok, snapshot, conv_summary, mem_summary, behavior_summary, chapters, structured_chapters} =
      safe_fetch(fetcher, workspace_id, author_text, Keyword.get(opts, :session_id))

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
      current_chapters: chapters,
      structured_chapters: structured_chapters,
      context_refs: refs,
      # CP1：组装策略由 application 在边界解析后传入并挂到 envelope（`06` §5.3）；
      # 未传则回落地板档默认，保证 floor 行为不变。
      assembly_policy: Keyword.get(opts, :assembly_policy, NovelDomain.AssemblyPolicy.default()),
      assembled_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp default_fetch(_workspace_id), do: {:ok, nil, nil, nil, nil}

  # 明确空上下文（fetcher 失败时的降级形态）。
  @empty_fetch {:ok, nil, nil, nil, nil, [], []}

  # fetcher 异常或返回非 {:ok, ...} 时降级为明确空上下文 + 留痕，不让整轮崩溃（G10 / AU-03 SC-B3）。
  defp safe_fetch(fetcher, workspace_id, author_text, session_id) do
    fetcher
    |> call_fetcher(workspace_id, author_text, session_id)
    |> normalize_fetch_result()
  rescue
    error ->
      emit_fetch_fallback(workspace_id, Exception.message(error))
      @empty_fetch
  catch
    kind, reason ->
      emit_fetch_fallback(workspace_id, "#{kind}: #{inspect(reason)}")
      @empty_fetch
  end

  defp emit_fetch_fallback(workspace_id, reason) do
    LogEmit.emit(:context, :assemble, :error, %{
      workspace_id: workspace_id,
      reason: reason,
      degraded_to: "empty_context"
    })
  end

  # fetcher 可返回 5 或 6 元组；统一补齐为带章节列表的 6 元组（缺省空列表）。非 ok 返回也降级为空。
  defp normalize_fetch_result({:ok, snapshot, conv, mem, behavior, chapters, structured_chapters}) do
    {titles, entries} = normalize_chapter_payload(chapters, structured_chapters)
    {:ok, snapshot, conv, mem, behavior, titles, entries}
  end

  defp normalize_fetch_result({:ok, snapshot, conv, mem, behavior, chapters}),
    do: normalize_six_tuple(snapshot, conv, mem, behavior, chapters)

  defp normalize_fetch_result({:ok, snapshot, conv, mem, behavior}),
    do: {:ok, snapshot, conv, mem, behavior, [], []}

  defp normalize_fetch_result(_other), do: @empty_fetch

  defp normalize_six_tuple(snapshot, conv, mem, behavior, chapters) do
    cond do
      structured_chapter_list?(chapters) ->
        entries = normalize_structured_chapters(chapters)
        {:ok, snapshot, conv, mem, behavior, titles_from_structured(entries), entries}

      is_list(chapters) ->
        {:ok, snapshot, conv, mem, behavior, normalize_chapters(chapters), []}

      true ->
        {:ok, snapshot, conv, mem, behavior, [], []}
    end
  end

  defp normalize_chapter_payload(chapters, structured_chapters) do
    entries = normalize_structured_chapters(structured_chapters)

    titles =
      case normalize_chapters(chapters) do
        [] -> titles_from_structured(entries)
        titles -> titles
      end

    {titles, entries}
  end

  defp normalize_chapters(chapters) when is_list(chapters) do
    chapters
    |> Enum.filter(&is_binary/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp normalize_chapters(_), do: []

  defp structured_chapter_list?([first | _]), do: is_map(first)
  defp structured_chapter_list?(_), do: false

  defp normalize_structured_chapters(chapters) when is_list(chapters) do
    chapters
    |> Enum.map(&normalize_structured_chapter/1)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_structured_chapters(_), do: []

  defp normalize_structured_chapter(chapter) when is_map(chapter) do
    title = chapter |> get_any([:title, "title"]) |> normalize_text()

    if title == "" do
      nil
    else
      %{
        title: title,
        seq: chapter |> get_any([:seq, "seq"]) |> normalize_integer(),
        summary: chapter |> get_any([:summary, "summary"]) |> normalize_text(),
        has_prose:
          chapter
          |> get_any([:has_prose, "has_prose", :word_count, "word_count"])
          |> normalize_has_prose()
      }
    end
  end

  defp normalize_structured_chapter(_), do: nil

  defp titles_from_structured(entries), do: Enum.map(entries, & &1.title)

  defp get_any(map, keys) do
    Enum.reduce_while(keys, nil, fn key, _acc ->
      if Map.has_key?(map, key), do: {:halt, Map.get(map, key)}, else: {:cont, nil}
    end)
  end

  defp normalize_text(value) when is_binary(value), do: String.trim(value)
  defp normalize_text(_), do: ""

  defp normalize_integer(value) when is_integer(value), do: value

  defp normalize_integer(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} -> n
      :error -> nil
    end
  end

  defp normalize_integer(_), do: nil

  defp normalize_has_prose(value) when is_boolean(value), do: value
  defp normalize_has_prose(value) when is_integer(value), do: value > 0
  defp normalize_has_prose(_), do: false

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
      Map.get(value, "core_selling_point") || Map.get(value, :core_selling_point),
      Map.get(value, "target_reader") || Map.get(value, :target_reader),
      Map.get(value, "tone_preference") || Map.get(value, :tone_preference),
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
