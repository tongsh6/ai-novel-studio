defmodule NovelApplication.ProseQualityService do
  @moduledoc """
  正文生成后的独立质量评估服务（VS-00E CP2）。

  与正文 writer **逻辑分离**：writer 写正文，本服务只读地评估正文是否实现目标，产出
  `QualityFinding` 并汇总 `ProseQualityPolicy`。不修改 artifact / 作品事实（ADR-0020 I2）。

  两类 validator：
  - 确定性（非 LLM）：`ProseQualityValidators`，总是运行。
  - 语义（独立 evaluator，LLM）：通过可注入 `semantic_fn` 解耦——
    `semantic_fn.(prose_text, ctx) :: {:ok, [finding_map]} | {:error, reason}`。
    失败时 `review_status: :unavailable`，**绝不伪造通过**（I3）；确定性发现仍保留。
  无 `semantic_fn` 时为确定性评估，`review_status: :completed`。
  """

  alias NovelApplication.ProseFormCandidateAnalyzer
  alias NovelApplication.ProseQualityPolicy
  alias NovelApplication.ProseQualityValidators
  alias NovelDomain.QualityFinding

  @type result :: %{
          findings: [QualityFinding.t()],
          form_candidates: [map()],
          review_status: :completed | :unavailable,
          evaluator_provider_call_ref: String.t() | nil,
          policy: ProseQualityPolicy.t()
        }

  @doc """
  评估正文文本。`ctx`：`%{source_ref, source_turn_ref, source_type}`，多场正文时
  额外带 `scenes: [%{index, title, start_offset, end_offset}]`（B11D：一件 artifact
  多条 items 的场边界），findings 按证据偏移归因到具体场。
  `opts[:semantic_fn]`：可选语义 evaluator。
  """
  @spec evaluate(String.t() | nil, map(), keyword()) :: result()
  def evaluate(prose_text, ctx \\ %{}, opts \\ []) do
    deterministic = ProseQualityValidators.evaluate(prose_text, ctx)
    form_candidates = ProseFormCandidateAnalyzer.detect(prose_text)
    semantic_ctx = Map.put(ctx, :form_candidates, form_candidates)

    {semantic, review_status, evaluator_provider_call_ref} =
      run_semantic(Keyword.get(opts, :semantic_fn), prose_text, semantic_ctx)

    scenes = normalize_scenes(Map.get(ctx, :scenes))
    scene_units = normalize_scene_units(Map.get(ctx, :scene_units))

    findings =
      deterministic
      |> Kernel.++(semantic)
      # 场归属只由服务端按真实 brief/场边界推导；evaluator 自报的场字段一律不采信。
      |> strip_scene_fields()
      |> attach_scene_attribution(prose_text, scenes)
      |> attach_brief_scene_refs(scene_units)

    policy = ProseQualityPolicy.decide(findings, review_status: review_status)

    %{
      findings: findings,
      form_candidates: form_candidates,
      review_status: review_status,
      evaluator_provider_call_ref: evaluator_provider_call_ref,
      policy: policy
    }
  end

  # B11D：多场正文（items > 1）时把 finding 归因到证据所在场；单 item 保持旧章级
  # 行为（scene_index/scene_title 均为 nil，wire 语义逐字节不变）。
  defp normalize_scenes(scenes) when is_list(scenes), do: Enum.filter(scenes, &valid_scene?/1)
  defp normalize_scenes(_scenes), do: []

  defp valid_scene?(scene) when is_map(scene) do
    is_integer(Map.get(scene, :start_offset)) and is_integer(Map.get(scene, :end_offset)) and
      is_integer(Map.get(scene, :index))
  end

  defp valid_scene?(_scene), do: false

  # B11D（质量场粒度）：复用 VS-00E 已冻结的 brief_field_refs 作为场级引用来源——
  # evaluator 指向具体场时写 `scene_2.emotion_transition`；服务端只按真实 brief 场次
  # 白名单归因（自造场 id 不采信，保持 scene_index/title 为 nil），不扩 scope 枚举。
  defp normalize_scene_units(units) when is_list(units) do
    units
    |> Enum.map(&normalize_scene_unit/1)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_scene_units(_units), do: []

  defp normalize_scene_unit(unit) when is_map(unit) do
    unit_id = clean_string(Map.get(unit, "unit_id") || Map.get(unit, :unit_id))
    title = clean_string(Map.get(unit, "scene_title") || Map.get(unit, :scene_title))

    if unit_id do
      %{unit_id: unit_id, scene_title: title, scene_number: scene_number(unit_id)}
    else
      nil
    end
  end

  defp normalize_scene_unit(_unit), do: nil

  defp scene_number(unit_id) do
    case Regex.run(~r/^scene_(\d+)/, unit_id) do
      [_, number] -> String.to_integer(number)
      _ -> nil
    end
  end

  defp attach_brief_scene_refs(findings, []), do: findings

  defp attach_brief_scene_refs(findings, scene_units) do
    Enum.map(findings, fn finding ->
      case brief_scene_unit(finding, scene_units) do
        nil -> finding
        unit -> %{finding | scene_index: unit.scene_number, scene_title: unit.scene_title}
      end
    end)
  end

  defp brief_scene_unit(%QualityFinding{brief_field_refs: refs}, scene_units) do
    Enum.find_value(refs, fn ref -> scene_unit_for_ref(ref, scene_units) end)
  end

  defp scene_unit_for_ref(ref, scene_units) do
    case Regex.run(~r/^scene_(\d+)(?:\.|$)/, to_string(ref)) do
      [_, number] -> find_scene_unit(scene_units, number)
      _ -> nil
    end
  end

  defp find_scene_unit(scene_units, number) do
    Enum.find(scene_units, fn unit ->
      unit.scene_number == String.to_integer(number) or unit.unit_id == "scene_#{number}"
    end)
  end

  defp clean_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp clean_string(_value), do: nil

  defp strip_scene_fields(findings) do
    Enum.map(findings, fn finding -> %{finding | scene_index: nil, scene_title: nil} end)
  end

  defp attach_scene_attribution(findings, _text, scenes) when length(scenes) < 2, do: findings

  defp attach_scene_attribution(findings, text, scenes) do
    Enum.map(findings, fn finding ->
      case scene_for_finding(finding, text, scenes) do
        nil -> finding
        scene -> %{finding | scene_index: scene.index, scene_title: scene.title}
      end
    end)
  end

  defp scene_for_finding(%QualityFinding{evidence_spans: spans}, text, scenes) do
    Enum.find_value(spans, fn span ->
      offset = span_offset(span, text)

      if is_integer(offset),
        do: Enum.find(scenes, &(offset >= &1.start_offset && offset < &1.end_offset))
    end)
  end

  defp span_offset(span, text) when is_map(span) do
    explicit = Map.get(span, "start_offset") || Map.get(span, :start_offset)

    if is_integer(explicit) and explicit >= 0 do
      explicit
    else
      span_text_offset(span, text)
    end
  end

  defp span_offset(_span, _text), do: nil

  # 语义 evaluator 只给 sentence_start/文本时，退化为在拼接正文中做确定性字节定位。
  defp span_text_offset(span, text) when is_binary(text) do
    case Map.get(span, "text") || Map.get(span, :text) do
      value when is_binary(value) and value != "" ->
        case :binary.match(text, value) do
          {offset, _length} -> offset
          :nomatch -> nil
        end

      _ ->
        nil
    end
  end

  defp span_text_offset(_span, _text), do: nil

  defp run_semantic(nil, _text, _ctx), do: {[], :completed, nil}

  defp run_semantic(fun, text, ctx) when is_function(fun, 2) do
    case safe_call(fun, text, ctx) do
      {:ok, finding_maps, provider_call_ref} when is_list(finding_maps) ->
        {normalize_findings(finding_maps, ctx), :completed, provider_call_ref}

      {:ok, %{findings: finding_maps, provider_call_ref: provider_call_ref}}
      when is_list(finding_maps) ->
        {normalize_findings(finding_maps, ctx), :completed, provider_call_ref}

      {:ok, finding_maps} when is_list(finding_maps) ->
        {normalize_findings(finding_maps, ctx), :completed, nil}

      _ ->
        # evaluator 失败/非法返回 → 质量复核未完成，不伪造通过
        {[], :unavailable, nil}
    end
  end

  defp run_semantic(_fun, _text, _ctx), do: {[], :completed, nil}

  defp normalize_findings(finding_maps, ctx) do
    finding_maps
    |> Enum.map(fn map -> QualityFinding.new(decorate(map, ctx)) end)
    |> Enum.reject(&is_nil/1)
  end

  defp safe_call(fun, text, ctx) do
    fun.(text, ctx)
  rescue
    _ -> {:error, :evaluator_raised}
  catch
    _, _ -> {:error, :evaluator_threw}
  end

  # 语义 evaluator 只给质量判断，溯源字段由服务用 ctx 补齐。
  defp decorate(map, ctx) when is_map(map) do
    map
    |> attach_candidate_evidence(Map.get(ctx, :form_candidates, []))
    |> Map.put_new("source_ref", Map.get(ctx, :source_ref))
    |> Map.put_new("source_turn_ref", Map.get(ctx, :source_turn_ref))
    |> Map.put_new("source_type", Map.get(ctx, :source_type, :prose_fragment))
  end

  defp decorate(map, _ctx), do: map

  defp attach_candidate_evidence(map, candidates) do
    candidate_id = Map.get(map, "candidate_id") || Map.get(map, :candidate_id)

    case Enum.find(candidates, &(&1["candidate_id"] == candidate_id)) do
      nil ->
        map

      candidate ->
        map
        |> Map.put_new("quality_finding_id", "qf_#{candidate_id}")
        |> Map.put_new("evidence_spans", candidate["evidence_spans"])
        |> Map.put_new("impact_scope", "local")
        |> Map.put_new("revision_scope", "local")
    end
  end
end
