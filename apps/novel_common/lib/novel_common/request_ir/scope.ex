defmodule NovelCommon.RequestIR.Scope do
  @moduledoc """
  canonical Scope 的纯结构、来源绑定与更新边界（VS-00M / B87 R02）。

  只验证已供应值、消息归属与运行身份的一致性；不读取作品、不授予权限，
  不从关联引用补造 Base。RequestIR 组合本模块与其它块/调用契约的验证顺序。
  """

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction
  alias NovelCommon.RequestIR.Projection

  @doc "当前应用范围的纯结构值；事实来源校验仍由读取它们的应用 owner 负责。"
  def block(content) when is_map(content) do
    content = RequestIR.json_value(content)

    projected =
      case Map.fetch(content, "goal") do
        {:ok, supplied_goal} -> Map.put(content, "goal", goal(supplied_goal))
        :error -> content
      end

    %{type: "scope", content: projected}
  end

  @doc "显式绑定作者输入的目标只投影来源；无绑定的应用解释保留原有内容。"
  def goal(content) when is_map(content) do
    content = RequestIR.json_value(content)
    source_ref = Map.get(content, "source_ref")

    if valid_source_id?(source_ref) do
      content
      |> Map.take(["version", "provenance"])
      |> Map.put("source_input_ref", source_ref)
    else
      content
    end
  end

  def goal(content), do: content

  def validate_owner(%{role: role, provenance: provenance, blocks: blocks} = message) do
    types = Enum.map(blocks, &Map.fetch!(&1, :type))
    base_refs = Map.get(message, :base_refs, [])

    cond do
      not scope_source_refs?(base_refs) ->
        {:error, :invalid_base_binding}

      base_refs != [] and
          (role not in ["application_base", "scope_update"] or provenance != "application") ->
        {:error, :invalid_base_binding_owner}

      base_refs != [] and invalid_base_binding_content?(role, types, blocks) ->
        {:error, :invalid_base_binding_content}

      true ->
        validate_scope_owner(role, provenance, types)
    end
  end

  def validate_block(%{content: content}) when is_map(content) do
    valid? =
      scope_json?(content) and scope_sections?(content) and
        scope_coverage?(Map.get(content, "coverage", %{})) and
        scope_omissions?(Map.get(content, "omissions", []))

    if valid?, do: :ok, else: {:error, :invalid_scope_content}
  end

  def validate_block(_block), do: {:error, :invalid_scope_content}

  defp invalid_base_binding_content?(role, types, blocks) do
    types == [] or
      (role == "application_base" and
         (Enum.any?(types, &(&1 != "text")) or String.trim(Projection.text_of(blocks)) == ""))
  end

  defp validate_scope_owner(role, provenance, types) do
    cond do
      "scope" in types and {role, provenance, types} != {"scope_update", "application", ["scope"]} ->
        {:error, :invalid_scope_owner}

      role == "scope_update" and provenance != "application" ->
        {:error, :invalid_scope_owner}

      role == "scope_update" and Enum.any?(types, &(&1 not in ["text", "scope"])) ->
        {:error, :invalid_scope_owner}

      true ->
        :ok
    end
  end

  defp scope_json?(%_{}), do: false

  defp scope_json?(value) when is_map(value),
    do:
      Enum.all?(value, fn {key, item} ->
        is_binary(key) and String.valid?(key) and scope_json?(item)
      end)

  defp scope_json?(value) when is_list(value), do: Enum.all?(value, &scope_json?/1)
  defp scope_json?(value) when is_binary(value), do: String.valid?(value)
  defp scope_json?(value), do: is_nil(value) or is_boolean(value) or is_number(value)

  defp scope_sections?(content) do
    map_keys = ~w(facts goal context authoring_task operation)

    Enum.all?(map_keys, &(not Map.has_key?(content, &1) or is_map(content[&1]))) and
      optional_scope_work_id?(Map.get(content, "work_id")) and
      scope_fact_shapes?(Map.get(content, "facts", %{}))
  end

  defp optional_scope_work_id?(nil), do: true
  defp optional_scope_work_id?(work_id), do: valid_source_id?(work_id)

  defp scope_fact_shapes?(facts) do
    Enum.all?(facts, fn
      {"work", record} ->
        is_map(record)

      {key, records} when key in ["chapters", "characters"] ->
        is_list(records) and Enum.all?(records, &is_map/1)

      _ ->
        true
    end)
  end

  defp scope_omissions?(omissions) when is_list(omissions),
    do: Enum.all?(omissions, &scope_omission?/1)

  defp scope_omissions?(_omissions), do: false

  defp scope_omission?(%{"source" => source, "reason" => reason}),
    do: valid_source_id?(source) and valid_source_id?(reason)

  defp scope_omission?(_omission), do: false

  defp scope_coverage?(coverage) when is_map(coverage) do
    Enum.all?(coverage, fn {_source, value} ->
      is_map(value) and
        field(value, :status) in ["complete", "partial", "not_read", "unavailable", "stale"] and
        scope_coverage_counts?(value)
    end)
  end

  defp scope_coverage?(_coverage), do: false

  defp scope_coverage_counts?(coverage) do
    counts = Enum.map([:count, :returned, :total], &field(coverage, &1))
    known? = Enum.any?(counts, &(not is_nil(&1)))

    Enum.all?(counts, &valid_scope_count?/1) and
      (not known? or field(coverage, :status) in ["complete", "partial", "stale"]) and
      valid_scope_count_range?(coverage)
  end

  defp valid_scope_count?(nil), do: true
  defp valid_scope_count?(count), do: is_integer(count) and count >= 0

  defp valid_scope_count_range?(%{
         "status" => "complete",
         "returned" => returned,
         "total" => total
       })
       when is_integer(returned) and is_integer(total), do: returned == total

  defp valid_scope_count_range?(%{"returned" => returned, "total" => total})
       when is_integer(returned) and is_integer(total), do: returned <= total

  defp valid_scope_count_range?(_coverage), do: true

  @doc "本次可见材料消息的显式 Base 绑定；累计目录只用于核对登记，不恢复隐藏材料。"
  @spec usable_refs(RequestIR.t()) :: [map() | String.t()]
  def usable_refs(%{messages: messages, refs: refs}) do
    registered = refs |> Map.get(:base_refs, []) |> MapSet.new(&ref_key/1)

    messages
    |> Compaction.project()
    |> Enum.flat_map(fn
      %{role: role, provenance: "application"} = message
      when role in ["application_base", "scope_update"] ->
        Map.get(message, :base_refs, [])

      _ ->
        []
    end)
    |> Enum.filter(&MapSet.member?(registered, ref_key(&1)))
    |> Enum.uniq()
  end

  def validate_bindings(%{refs: refs} = ir) when is_map(refs) do
    with :ok <- validate_base_bindings(ir) do
      for message <- ir.messages,
          %{type: "scope", content: content} <- message.blocks,
          reduce: :ok do
        :ok -> validate_scope_binding(ir, message, content)
        error -> error
      end
    end
  end

  def validate_bindings(_ir), do: {:error, :invalid_refs}

  defp validate_base_bindings(%{messages: messages, refs: refs}) do
    base_refs = Map.get(refs, :base_refs, [])

    if scope_source_refs?(base_refs) do
      registered = MapSet.new(base_refs, &ref_key/1)

      unregistered =
        messages
        |> Enum.flat_map(&Map.get(&1, :base_refs, []))
        |> Enum.map(&ref_key/1)
        |> Enum.reject(&MapSet.member?(registered, &1))
        |> Enum.uniq()

      if unregistered == [],
        do: :ok,
        else: {:error, {:base_binding_not_registered, unregistered}}
    else
      {:error, :invalid_refs}
    end
  end

  defp validate_scope_binding(ir, message, content) do
    with :ok <- validate_scope_metadata(message, ir.refs),
         :ok <- validate_scope_work(content, ir.run),
         :ok <- validate_scope_facts(content, message, ir.refs) do
      validate_scope_work_version(content, Map.get(message, :versions, %{}))
    end
  end

  defp validate_scope_metadata(message, refs) do
    valid? =
      scope_source_refs?(Map.get(message, :source_refs, [])) and
        scope_source_refs?(Map.get(refs, :base_refs, [])) and
        is_map(Map.get(message, :versions, %{})) and
        scope_json?(Map.get(message, :versions, %{}))

    if valid?, do: :ok, else: {:error, :invalid_scope_metadata}
  end

  defp scope_source_refs?(refs) when is_list(refs),
    do: Enum.all?(refs, &valid_source_id?(ref_key(&1)))

  defp scope_source_refs?(_refs), do: false

  defp validate_scope_work(content, run) do
    if Map.get(content, "work_id") == field(run, :work_id),
      do: :ok,
      else: {:error, :scope_work_mismatch}
  end

  defp validate_scope_facts(content, message, ir_refs) do
    facts = scope_fact_records(Map.get(content, "facts", %{}))
    refs = Enum.map(facts, &Map.get(&1, "ref"))
    work_id = Map.get(content, "work_id")

    cond do
      not Enum.all?(refs, &valid_source_id?/1) ->
        {:error, :invalid_scope_fact_ref}

      Enum.any?(facts, &(Map.get(&1, "work_id") not in [nil, work_id])) ->
        {:error, :scope_fact_work_mismatch}

      length(refs) != length(Enum.uniq(refs)) ->
        {:error, :duplicate_scope_fact}

      true ->
        validate_scope_fact_sources(refs, message, ir_refs)
    end
  end

  defp validate_scope_fact_sources(refs, message, ir_refs) do
    supplied = Enum.map(Map.get(message, :source_refs, []), &ref_key/1)
    base = Enum.map(Map.get(ir_refs, :base_refs, []), &ref_key/1)

    cond do
      Enum.any?(refs, &(&1 not in supplied)) -> {:error, :scope_fact_without_source}
      Enum.any?(refs, &(&1 not in base)) -> {:error, :scope_source_not_supplied}
      true -> :ok
    end
  end

  # 只读取事实记录自身的身份；其嵌套关系/来源里的 ref 不是第二个事实实体。
  defp scope_fact_records(facts) do
    Enum.flat_map(facts, fn
      {"work", record} -> [record]
      {key, records} when key in ["chapters", "characters"] -> records
      {_key, value} -> scope_named_fact_records(value)
    end)
  end

  defp scope_named_fact_records(%{"ref" => _ref} = record), do: [record]

  defp scope_named_fact_records(records) when is_list(records),
    do: Enum.flat_map(records, &scope_named_fact_records/1)

  defp scope_named_fact_records(_value), do: []

  defp validate_scope_work_version(content, versions) do
    version = get_in(content, ["facts", "work", "version"])

    if version == field(versions, :work),
      do: :ok,
      else: {:error, :scope_work_version_mismatch}
  end

  @doc "按最近一次 scope 计算下一个 revision，与消息数量无关。"
  @spec next_revision(map()) :: pos_integer()
  def next_revision(ir) when is_map(ir) do
    ir.messages
    |> Enum.reverse()
    |> Enum.find_value(1, fn message ->
      if message.role == "scope_update" do
        versions = Map.get(message, :versions, %{})
        Map.get(versions, "scope_revision", Map.get(versions, :scope_revision, 0)) + 1
      end
    end)
  end

  @doc "追加当前运行事实并绑定实际供应的 Base；旧 Scope 与累计目录只保留为历史证据。"
  @spec append_update(map(), map(), map(), [map()], [map()]) :: map()
  def append_update(ir, content, versions, source_refs, base_refs)
      when is_map(ir) and is_map(content) and is_list(base_refs) do
    message =
      RequestIR.message(:scope_update, :application, [block(content)], %{
        versions: versions,
        source_refs: source_refs,
        base_refs: base_refs
      })

    %{
      ir
      | messages: ir.messages ++ [message],
        refs: Map.update(ir.refs, :base_refs, base_refs, &Enum.uniq(&1 ++ base_refs))
    }
  end

  defp valid_source_id?(id) when is_binary(id), do: String.valid?(id) and String.trim(id) != ""
  defp valid_source_id?(_id), do: false

  defp ref_key(ref) when is_binary(ref), do: ref
  defp ref_key(ref) when is_map(ref), do: Map.get(ref, :ref) || Map.get(ref, "ref")
  defp ref_key(_ref), do: nil

  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, to_string(key)))
  defp field(_map, _key), do: nil
end
