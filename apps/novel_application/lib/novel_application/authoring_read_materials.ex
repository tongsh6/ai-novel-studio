defmodule NovelApplication.AuthoringReadMaterials do
  @moduledoc """
  从同次实际 Request IR 的可用读取叶派生材料元数据与具体依据。

  资格复用 RequestIR 的可见性与内容判据；不读取作品、不猜名称或完整度。
  同 ref 的各次实际来源保序保留，使命绑定和专业任务分别消费自己的投影。
  basis_label 只供应用绑定，不能直接进入 AuthoringTask 的闭合材料 schema。
  """

  alias NovelCommon.RequestIR

  @doc "每份实际读取保留独立材料；相同 ref 不表示相同版本、页段或覆盖。"
  @spec from_request(RequestIR.t() | nil) :: [map()]
  def from_request(nil), do: []

  def from_request(%RequestIR{} = request) do
    request
    |> RequestIR.usable_observations()
    |> Enum.flat_map(&observation_materials/1)
  end

  defp observation_materials(observation) do
    coverage = field(observation, :coverage) || %{}
    omissions = List.wrap(field(observation, :omissions))
    complete? = complete_read_coverage?(observation, coverage, omissions)

    observation
    |> field(:source_refs)
    |> List.wrap()
    |> Enum.flat_map(&source_material(&1, observation, coverage, complete?))
  end

  defp source_material(source, observation, coverage, complete?) do
    {ref, version} = source_identity(source)
    versions = field(observation, :versions) || %{}
    version = version || Map.get(versions, ref)
    omissions = List.wrap(field(observation, :omissions))

    if blank?(ref) do
      []
    else
      note = if complete?, do: nil, else: omission_note(observation, coverage, omissions, ref)
      basis = source_basis(observation, coverage, ref)

      [
        %{
          kind: :observation,
          ref: ref,
          version: version,
          complete?: complete?,
          omission_note: note,
          provenance: field(observation, :provenance) || "tool_result",
          basis_label: basis_label(basis, version, note)
        }
        |> Map.reject(fn {_key, value} -> is_nil(value) end)
      ]
    end
  end

  defp complete_read_coverage?(observation, coverage, omissions) do
    field(coverage, :complete?) == true and field(observation, :status) == "ok" and
      omissions == [] and is_nil(field(observation, :next_offset))
  end

  defp omission_note(observation, coverage, omissions, ref) do
    # chapter_read 首页可含章摘要来源；正文覆盖只属于章 ref，不能广播给摘要。
    chapter_read? = field(field(observation, :content), :tool) == "chapter_read"

    coverage_note =
      if not chapter_read? or field(coverage, :chapter_ref) == ref,
        do: field(coverage, :coverage_note)

    notes = Enum.reject([coverage_note | omissions], &blank?/1)

    if notes == [],
      do: "仅表示本次可见读取；未声明完整覆盖",
      else: Enum.join(notes, "；")
  end

  defp source_basis(observation, coverage, ref) do
    content = field(observation, :content) || %{}

    case {field(coverage, :kind), field(content, :tool)} do
      {"directory", _tool} ->
        named_source(content, ref)

      {_kind, "chapter_read"} ->
        chapter_basis(coverage, ref)

      {_kind, "archive_read"} ->
        archive_basis(observation, coverage, content, ref)

      {"recall", "memory_recall"} ->
        memory_preview_basis(content, ref)

      _ ->
        named_source(content, ref) || single_source_text(observation, content)
    end
  end

  defp archive_basis(observation, coverage, content, ref) do
    case field(coverage, :sources) do
      nil -> named_source(content, ref) || single_archive_basis(observation, coverage, ref)
      sources -> archive_range_basis(sources, ref)
    end
  end

  defp single_archive_basis(observation, coverage, ref) do
    with [source] <- List.wrap(field(observation, :source_refs)),
         {^ref, _version} <- source_identity(source) do
      archive_page_basis(field(coverage, :summary))
    else
      _ -> nil
    end
  end

  defp archive_range_basis(sources, ref) when is_list(sources) do
    case Enum.filter(sources, &(field(&1, :ref) == ref)) do
      [source] -> archive_page_basis(source)
      _ -> nil
    end
  end

  defp archive_range_basis(_sources, _ref), do: nil

  defp archive_page_basis(range) do
    with "unicode_grapheme" <- field(range, :offset_unit),
         offset when is_integer(offset) and offset >= 0 <- field(range, :offset),
         returned when is_integer(returned) and returned > 0 <- field(range, :returned_graphemes),
         total when is_integer(total) and offset + returned <= total <-
           field(range, :total_graphemes) do
      "档案条目原文第 #{offset + 1}–#{offset + returned} 字符 / 共 #{total} 字符"
    else
      _ -> nil
    end
  end

  defp named_source(content, ref) do
    facts = field(content, :facts) || %{}

    entries =
      List.wrap(field(facts, :chapters)) ++
        List.wrap(field(facts, :characters)) ++ List.wrap(field(facts, :character))

    case Enum.filter(entries, &((field(&1, :ref) || field(&1, :character_ref)) == ref)) do
      [entry] -> field(entry, :title) || field(entry, :name)
      _ -> nil
    end
  end

  defp single_source_text(observation, content) do
    case List.wrap(field(observation, :source_refs)) do
      [_source] -> field(content, :summary)
      _ -> nil
    end
  end

  defp memory_preview_basis(content, ref) do
    # recall_preview 的 summary 是既有 JSON 结构；只按 memory_ref 取该条实际文本。
    with summary when is_binary(summary) <- field(content, :summary),
         {:ok, %{"items" => items}} when is_list(items) <- Jason.decode(summary),
         [item] <- Enum.filter(items, &(field(&1, :memory_ref) == ref)) do
      field(item, :text)
    else
      _ -> nil
    end
  end

  defp chapter_basis(coverage, ref) do
    prose = if field(coverage, :chapter_ref) == ref, do: prose_basis(coverage)

    parts =
      [
        prose,
        preview_basis(field(coverage, :chapter_plan), ref, "章计划"),
        preview_basis(field(coverage, :chapter_summary), ref, "章摘要")
      ]
      |> Enum.reject(&blank?/1)

    if parts == [], do: nil, else: Enum.join(parts, "；")
  end

  defp prose_basis(coverage) do
    range = field(coverage, :prose_range)

    case {field(range, :start), field(range, :end), field(coverage, :prose_total_chars)} do
      {first, last, total} when is_integer(first) and is_integer(last) and is_integer(total) ->
        "正文第 #{first}–#{last} 字符 / 共 #{total} 字符"

      _ ->
        nil
    end
  end

  defp preview_basis(preview, ref, label) do
    case {
      field(preview, :source_ref),
      field(preview, :representation),
      field(preview, :status),
      field(preview, :returned_graphemes),
      field(preview, :total_graphemes)
    } do
      {^ref, "preview", "partial", returned, total}
      when is_integer(returned) and is_integer(total) ->
        "#{label}预览：已供给 #{returned} / #{total} 字符"

      _ ->
        nil
    end
  end

  defp basis_label(basis, version, note) do
    if blank?(basis) do
      nil
    else
      qualifiers =
        [if(is_nil(version), do: nil, else: "版本 #{version}"), note || "本次读取完整"]
        |> Enum.reject(&blank?/1)

      "【#{Enum.join(qualifiers, "；")}】#{basis}"
    end
  end

  defp source_identity(ref) when is_binary(ref), do: {ref, nil}

  defp source_identity(source) when is_map(source),
    do: {field(source, :ref), field(source, :version)}

  defp source_identity(_source), do: {nil, nil}

  defp field(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp field(_map, _key), do: nil
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_value), do: true
end
