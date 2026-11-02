defmodule NovelAgent.Test.Support.PendingDialogueInput do
  @moduledoc """
  仅测试支持：把模型实际收到的判断请求规范化为“当前操作材料视图”。

  判断 prompt 有两类待采纳信息来源：

    * 当前原生 scope：`NovelApplication.DialoguePlanningService.pending_candidate_line/1`
      渲染的 `## 待采纳候选` 目录；
    * 显式旧格式：当前 scope（无 scope 时为本轮请求）的
      `## 消息处置与已有产物` 段内 JSON 的 `pending_adoptions[].body_preview`。

  这里只读模型实际收到的 prompt，不读 DB 或应用 ctx，也不补造 prompt 里没有的字段。
  关键边界：

    * 候选和旧格式状态只从“当前操作”的当前 scope 读取；旧 scope 只作历史，
      当前 scope 缺目录/空目录时绝不回退到旧 scope；
    * 当前作者原话与当前 scope 分开读取，不用 scope 里的旧用户片段代替作者消息；
    * native scope 内旧格式 JSON 只认明确的 `## 消息处置与已有产物` 段；
      资料原文等其它材料里的 JSON 不构成授权状态；只有明确无 scope 的当前请求
      才兼容作者段之前的裸 facts JSON；
    * 原生目录优先；旧格式只与同一当前 scope、同一 ref 的目录项合并
      `revision_of`，不跨 scope 补，也不把缺失当原稿。

  状态区分：`candidate_state` 为 `:parsed` / `:explicit_empty` / `:missing` /
  `:bad_format`，调用方对坏格式或歧义应诚实询问作者。

  `material_state/1` 在同一个当前 scope 视图上汇总“本轮实际供给”的待采纳与
  已处置条目：目录/旧格式 pending 取规范化候选，resolved 只取当前明确状态段
  JSON。它不跨 scope 回退，也不读 DB/ctx；`supplied?` 为 false 时调用方必须
  如实说明状态未知，不能用历史材料或章节统计补状态。
  """

  @author_heading ~r/##\s*作者输入\s*\n/u
  @author_section ~r/##\s*作者输入\s*\n(.*?)(?:\n##|\z)/su
  @directory_heading "## 待采纳候选"
  @facts_heading "## 消息处置与已有产物"
  @scope_marker "【应用数据 · scope_update"
  @application_marker "【应用数据"
  @author_placeholder "（本轮作者原话见独立 user 消息）"
  @empty_session_state ~r/会话候选处置[：:]\s*pending\s*0/u
  @directory_line ~r/^- ref=(?<ref>[^|]+?)\s*\|\s*type=(?<type>[^|]*?)\s*\|\s*status=(?<status>[^|]*?)\s*\|\s*title=(?<title>.*?)\s*\|\s*operations=(?<operations>[^|]*?)\s*\|\s*body_preview=(?<body_preview>.*)$/su

  @type candidate :: %{
          ref: String.t(),
          artifact_type: String.t() | nil,
          status: String.t() | nil,
          title: String.t() | nil,
          operations: [String.t()],
          body_preview: String.t() | nil,
          revision_of: String.t() | nil,
          origin: :native_directory | :legacy_message_state
        }

  @type candidate_state :: :parsed | :explicit_empty | :missing | :bad_format

  @type material_entry :: %{
          ref: String.t() | nil,
          status: String.t() | nil,
          title: String.t() | nil,
          body_preview: String.t() | nil,
          source: :candidate | :resolved_facts
        }

  @type material_state :: %{
          state: candidate_state(),
          supplied?: boolean(),
          pending: [material_entry()],
          resolved: [material_entry()],
          pending_count: non_neg_integer(),
          resolved_count: non_neg_integer(),
          omitted_count: non_neg_integer()
        }

  @type normalized :: %{
          author_text: String.t(),
          candidates: [candidate()],
          request_scope: :native | :legacy | :none,
          candidate_source: :native_directory | :legacy_message_state | :none,
          candidate_state: candidate_state(),
          message_state_facts: map()
        }

  @spec normalize(NovelAgent.Provider.prompt()) :: normalized()
  def normalize(prompt) do
    view = current_view(prompt)
    directory = directory_candidates(view.state_text)
    facts = message_state_facts_from_text(view.state_text, view.native_scope?)
    legacy = legacy_candidates(facts.map)
    candidates = merge_candidates(directory.candidates, legacy)

    %{
      author_text: view.author_text,
      candidates: candidates,
      request_scope: request_scope(view, directory, facts),
      candidate_source: candidate_source(directory.candidates, legacy),
      candidate_state: candidate_state(view, directory, facts, candidates),
      message_state_facts: facts.map
    }
  end

  @spec material_state(NovelAgent.Provider.prompt()) :: material_state()
  def material_state(prompt) do
    normalized = normalize(prompt)
    facts = normalized.message_state_facts

    pending = Enum.map(normalized.candidates, &material_entry_from_candidate/1)

    resolved =
      facts
      |> Map.get("resolved_adoptions")
      |> List.wrap()
      |> Enum.flat_map(&material_entry_from_facts/1)

    %{
      state: normalized.candidate_state,
      supplied?: material_facts_supplied?(normalized, facts),
      pending: pending,
      resolved: resolved,
      pending_count: count_from_facts(facts, "pending_adoption_count", length(pending)),
      resolved_count: count_from_facts(facts, "resolved_adoption_count", length(resolved)),
      omitted_count: count_from_facts(facts, "omitted_adoptions", 0)
    }
  end

  @doc """
  返回只含当前操作材料的文本视图：当前 scope（或本轮无 scope 请求）+ 当前作者原话。
  供真实 consumer 消费，避免把整段历史扁平化后再搜索授权状态。
  """
  @spec material_text(NovelAgent.Provider.prompt(), String.t()) :: String.t()
  def material_text(prompt, fallback \\ nil)

  def material_text(prompt, _fallback) when is_binary(prompt), do: prompt

  def material_text(prompt, _fallback) when is_map(prompt) or is_list(prompt) do
    view = current_view(prompt)
    state_text = String.trim_trailing(view.state_text)

    case String.trim(view.author_text) do
      "" ->
        state_text

      author ->
        case explicit_author_section(state_text) do
          ^author -> state_text
          _ -> state_text <> "\n## 作者输入\n" <> author
        end
    end
  end

  def material_text(_prompt, fallback), do: fallback || ""

  @spec author_text(NovelAgent.Provider.prompt()) :: String.t()
  def author_text(prompt), do: normalize(prompt).author_text

  @spec candidates(NovelAgent.Provider.prompt()) :: [candidate()]
  def candidates(prompt), do: normalize(prompt).candidates

  @spec message_state_facts(NovelAgent.Provider.prompt()) :: map()
  def message_state_facts(prompt), do: normalize(prompt).message_state_facts

  @spec request_scope(NovelAgent.Provider.prompt()) :: :native | :legacy | :none
  def request_scope(prompt), do: normalize(prompt).request_scope

  @spec candidate_state(NovelAgent.Provider.prompt()) :: candidate_state()
  def candidate_state(prompt), do: normalize(prompt).candidate_state

  # ── 当前操作材料：结构优先，文本只在无结构时作为本轮请求读取 ────────────────

  defp current_view(prompt) when is_binary(prompt) do
    %{
      state_text: text_before_author(prompt),
      author_text: author_text_from_text(prompt),
      # 与 map 分支同一来源判定：material_text 重新解析时仍能识别原生应用材料，
      # 不会因为丢掉了结构就退回扫描裸 JSON。
      native_scope?: String.contains?(prompt, @application_marker)
    }
  end

  defp current_view(prompt) when is_map(prompt) or is_list(prompt) do
    messages = NovelAgent.Provider.normalize_messages(prompt)
    operation_text = operation_text(prompt)
    state_text = text_before_author(operation_text)

    author =
      author_from_messages(messages) ||
        explicit_author_section(operation_text) ||
        String.trim(state_text)

    %{
      state_text: state_text,
      author_text: author,
      native_scope?:
        not is_nil(NovelAgent.Provider.latest_scope_text(prompt)) or
          String.contains?(operation_text, @application_marker)
    }
  end

  defp operation_text(prompt) do
    case NovelAgent.Provider.latest_scope_text(prompt) do
      nil -> NovelAgent.Provider.prompt_text(prompt)
      _scope -> NovelAgent.Provider.operation_prompt_text(prompt)
    end
  end

  # 当前作者消息是当前 operation 最后一个非应用 user 消息（scope 之前）。
  # 旧轮作者消息位于更早位置，不能拿来当本轮原话。
  defp author_from_messages(messages) do
    scope_index = last_scope_index(messages)

    messages
    |> Enum.with_index()
    |> Enum.filter(fn {_message, index} -> is_nil(scope_index) or index < scope_index end)
    |> Enum.reverse()
    |> Enum.find_value(fn {message, _index} -> author_message_text(message) end)
  end

  defp last_scope_index(messages) do
    messages
    |> Enum.with_index()
    |> Enum.reverse()
    |> Enum.find_value(fn {message, index} -> if scope_message?(message), do: index end)
  end

  defp scope_message?(%{role: "user", content: content}) when is_binary(content),
    do: String.starts_with?(content, @scope_marker)

  defp scope_message?(_message), do: false

  defp author_message_text(%{role: "user", content: content}) when is_binary(content) do
    if String.starts_with?(content, @application_marker) or
         String.contains?(content, @author_placeholder) do
      nil
    else
      case String.trim(content) do
        "" -> nil
        trimmed -> explicit_author_section(trimmed) || trimmed
      end
    end
  end

  defp author_message_text(_message), do: nil

  # 作者段在 prompt 末尾；状态只读它之前的当前 scope 材料。
  # 用字符串切分而不是正则字节索引：中文多字节偏移与 grapheme 索引不同。
  defp text_before_author(text) do
    case String.split(text, @author_heading, parts: 2) do
      [before, _after] -> String.trim_trailing(before)
      _ -> text
    end
  end

  defp author_text_from_text(text) do
    explicit_author_section(text) || String.trim(text)
  end

  defp explicit_author_section(text) do
    case Regex.run(@author_section, text) do
      [_, section] ->
        section = String.trim(section)
        if section == "", do: nil, else: section

      _ ->
        nil
    end
  end

  # ── 原生目录 ────────────────────────────────────────────────────────────────

  defp directory_candidates(state_text) do
    case prompt_section(state_text, @directory_heading) do
      nil ->
        %{candidates: [], state: :missing}

      section ->
        lines =
          section
          |> String.split("\n")
          |> Enum.map(&String.trim/1)
          |> Enum.filter(&String.starts_with?(&1, "- ref="))

        parsed = Enum.map(lines, &parse_directory_line/1)
        candidates = for {:ok, candidate} <- parsed, do: candidate

        state =
          cond do
            Enum.any?(parsed, &(&1 == :error)) -> :bad
            candidates == [] -> :empty
            true -> :ok
          end

        %{candidates: if(state == :bad, do: [], else: candidates), state: state}
    end
  end

  defp parse_directory_line(line) do
    case Regex.run(@directory_line, line) do
      [_, ref, type, status, title, operations, body_preview] ->
        {:ok, build_candidate(ref, type, status, title, operations, body_preview)}

      _ ->
        :error
    end
  end

  defp build_candidate(ref, type, status, title, operations, body_preview) do
    %{
      ref: String.trim(ref),
      artifact_type: blank_to_nil(type),
      status: blank_to_nil(status),
      title: blank_to_nil(title, "（无标题）"),
      operations:
        operations
        |> String.split("/", trim: true)
        |> Enum.map(&String.trim/1)
        |> Enum.reject(&(&1 == "")),
      body_preview: preview_or_nil(body_preview),
      revision_of: nil,
      origin: :native_directory
    }
  end

  # ── 显式旧格式：明确 section，或明确无 scope 的当前请求 ─────────────────────

  # 唯一来源决策：明确状态段始终优先；只有明确无 scope 的当前请求才允许裸 facts JSON。
  # native scope 没有明确状态段时保持 missing，不把资料原文等材料里的 JSON 当授权。
  defp message_state_facts_from_text(state_text, native_scope?) do
    case prompt_section(state_text, @facts_heading) do
      nil ->
        if native_scope? do
          %{map: %{}, state: :missing}
        else
          # 无 scope 的明确旧格式：状态 JSON 可以裸行出现在当前请求、作者段之前；
          # 作者段（text_before_author 已切掉）和历史 scope 都不参与。
          legacy_facts_from_state_region(state_text)
        end

      section ->
        case facts_from_section(section) do
          {:ok, facts} -> %{map: facts, state: :ok}
          :empty -> %{map: %{}, state: :empty}
          :bad -> %{map: %{}, state: :bad}
        end
    end
  end

  defp legacy_facts_from_state_region(state_text) do
    case Enum.find_value(String.split(state_text, "\n"), &facts_line/1) do
      nil -> %{map: %{}, state: :missing}
      facts -> %{map: facts, state: :ok}
    end
  end

  defp facts_line(line) do
    case Jason.decode(String.trim(line)) do
      {:ok, %{} = map} -> if facts_map?(map), do: map
      _ -> nil
    end
  end

  defp facts_from_section(section) do
    case section |> String.split("\n") |> Enum.find_value(&facts_line/1) do
      nil -> if String.trim(section) == "", do: :empty, else: :bad
      facts -> {:ok, facts}
    end
  end

  defp facts_map?(map) do
    is_list(Map.get(map, "author_inputs")) or is_list(Map.get(map, "pending_adoptions"))
  end

  defp legacy_candidates(facts) do
    facts
    |> Map.get("pending_adoptions")
    |> List.wrap()
    |> Enum.flat_map(&legacy_candidate/1)
  end

  defp legacy_candidate(candidate) when is_map(candidate) do
    ref = Map.get(candidate, "artifact_ref") || Map.get(candidate, "artifact_id")

    if is_binary(ref) and String.trim(ref) != "" do
      [
        %{
          ref: String.trim(ref),
          artifact_type: blank_to_nil(Map.get(candidate, "artifact_type")),
          status: blank_to_nil(Map.get(candidate, "status")),
          title: blank_to_nil(Map.get(candidate, "title"), "（无标题）"),
          operations:
            candidate
            |> Map.get("available_operations")
            |> List.wrap()
            |> Enum.map(&to_string/1)
            |> Enum.map(&String.trim/1)
            |> Enum.reject(&(&1 == "")),
          body_preview: preview_or_nil(Map.get(candidate, "body_preview")),
          revision_of: blank_to_nil(Map.get(candidate, "revision_of")),
          origin: :legacy_message_state
        }
      ]
    else
      []
    end
  end

  defp legacy_candidate(_candidate), do: []

  # 只在同一当前 scope 的目录与旧格式之间、按同一 ref 合并 revision_of。
  defp merge_candidates([], legacy), do: legacy

  defp merge_candidates(directory, legacy) do
    legacy_by_ref = Map.new(legacy, &{&1.ref, &1})

    Enum.map(directory, fn candidate ->
      case Map.get(legacy_by_ref, candidate.ref) do
        nil ->
          candidate

        legacy_entry ->
          %{candidate | revision_of: candidate.revision_of || legacy_entry.revision_of}
      end
    end)
  end

  # ── 状态汇总 ────────────────────────────────────────────────────────────────

  defp request_scope(view, directory, facts) do
    cond do
      view.native_scope? -> :native
      directory.state != :missing -> :native
      facts.state != :missing -> :legacy
      true -> :none
    end
  end

  defp candidate_source([], []), do: :none
  defp candidate_source([], _legacy), do: :legacy_message_state
  defp candidate_source(_directory, _legacy), do: :native_directory

  defp candidate_state(view, directory, facts, candidates) do
    cond do
      directory.state == :bad or facts.state == :bad ->
        :bad_format

      candidates != [] ->
        :parsed

      directory.state == :empty or facts.state == :empty or explicit_empty_facts?(facts.map) ->
        :explicit_empty

      Regex.match?(@empty_session_state, view.state_text) ->
        :explicit_empty

      true ->
        :missing
    end
  end

  defp explicit_empty_facts?(%{"pending_adoptions" => []}), do: true
  defp explicit_empty_facts?(_facts), do: false

  # ── 当前 scope 的实际材料供给 ────────────────────────────────────────────────

  defp material_facts_supplied?(normalized, facts) do
    normalized.candidate_state != :missing or
      Enum.any?(
        [
          "pending_adoptions",
          "resolved_adoptions",
          "pending_adoption_count",
          "resolved_adoption_count"
        ],
        &Map.has_key?(facts, &1)
      )
  end

  defp material_entry_from_candidate(candidate) do
    %{
      ref: candidate.ref,
      status: candidate.status,
      title: candidate.title,
      body_preview: candidate.body_preview,
      source: :candidate
    }
  end

  defp material_entry_from_facts(entry) when is_map(entry) do
    ref = Map.get(entry, "artifact_ref") || Map.get(entry, "artifact_id")

    [
      %{
        ref: blank_to_nil(ref),
        status: blank_to_nil(Map.get(entry, "status")),
        title: blank_to_nil(Map.get(entry, "title"), "（无标题）"),
        body_preview: preview_or_nil(Map.get(entry, "body_preview")),
        source: :resolved_facts
      }
    ]
  end

  defp material_entry_from_facts(_entry), do: []

  defp count_from_facts(facts, key, default) do
    case Map.get(facts, key) do
      count when is_integer(count) and count >= 0 -> count
      _ -> default
    end
  end

  defp prompt_section(text, heading) do
    case String.split(text, heading, parts: 2) do
      [_before, rest] ->
        rest
        |> String.split(~r/\n##\s/u, parts: 2)
        |> List.first()
        |> to_string()
        |> String.trim()

      _ ->
        nil
    end
  end

  defp preview_or_nil(nil), do: nil

  defp preview_or_nil(preview) do
    preview = preview |> to_string() |> String.trim()

    cond do
      preview == "" -> nil
      String.starts_with?(preview, "（空：") -> nil
      true -> preview
    end
  end

  defp blank_to_nil(nil), do: nil
  defp blank_to_nil(value), do: blank_to_nil(value, nil)

  defp blank_to_nil(value, blank_marker) do
    value = value |> to_string() |> String.trim()

    if value == "" or value == blank_marker do
      nil
    else
      value
    end
  end
end
