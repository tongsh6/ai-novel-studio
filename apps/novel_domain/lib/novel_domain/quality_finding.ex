defmodule NovelDomain.QualityFinding do
  @moduledoc """
  正文质量评估发现项（VS-00E §7.3）。

  由独立质量服务（确定性 validator 或语义 evaluator）产出，描述正文的一个可改进/可疑问题：
  关联 quality gate / validator、正文证据片段、对应 brief 字段、置信度、建议修订策略。

  **不是作品事实**（ADR-0020 I2）：finding 进入 TurnResult / UI 供作者审阅，不直接修改
  artifact、作品事实或采纳状态。纯 struct + 纯函数，无 I/O。
  """

  @actions [:warn, :adoption_review, :block, :confirm]
  @severities [:info, :warn, :high]
  @source_types [:prose_fragment, :scene_draft, :chapter_draft]
  @scopes [:local, :paragraph, :chapter]

  @type t :: %__MODULE__{
          quality_finding_id: String.t() | nil,
          quality_gate_ref: String.t(),
          validator_ref: String.t(),
          source_ref: String.t() | nil,
          source_type: atom() | nil,
          source_turn_ref: String.t() | nil,
          severity: atom(),
          action: atom(),
          summary: String.t(),
          reasoning: String.t(),
          confidence: float(),
          evidence_spans: [map()],
          impact_scope: atom(),
          revision_scope: atom(),
          brief_field_refs: [String.t()],
          suggested_revision: map() | nil,
          can_override: boolean(),
          created_at: String.t() | nil
        }

  defstruct quality_finding_id: nil,
            quality_gate_ref: nil,
            validator_ref: nil,
            source_ref: nil,
            source_type: nil,
            source_turn_ref: nil,
            severity: :warn,
            action: :warn,
            summary: "",
            reasoning: "",
            confidence: 0.5,
            evidence_spans: [],
            impact_scope: :local,
            revision_scope: :local,
            brief_field_refs: [],
            suggested_revision: nil,
            can_override: true,
            created_at: nil

  @doc "合法 action 取值集合。"
  @spec actions() :: [atom()]
  def actions, do: @actions

  @doc "合法 severity 取值集合。"
  @spec severities() :: [atom()]
  def severities, do: @severities

  @doc """
  从 map 构造并清洗。string / atom 键皆可。

  - `quality_gate_ref` / `validator_ref` / `summary` 缺失视为非法 → 返回 `nil`。
  - `action` 非法默认 `:warn`；`severity` 非法默认 `:warn`。
  - 文学类发现默认 `can_override: true`；只有 `:block` 默认不可越过（高置信事实/认知冲突）。
  """
  @spec new(map() | nil) :: t() | nil
  def new(nil), do: nil

  def new(attrs) when is_map(attrs) do
    gate = clean(get_any(attrs, [:quality_gate_ref, "quality_gate_ref"]))
    validator = clean(get_any(attrs, [:validator_ref, "validator_ref"]))
    summary = clean(get_any(attrs, [:summary, "summary"]))

    if is_nil(gate) or is_nil(validator) or is_nil(summary) do
      nil
    else
      action = normalize_action(get_any(attrs, [:action, "action"]))

      %__MODULE__{
        quality_finding_id:
          clean(get_any(attrs, [:quality_finding_id, "quality_finding_id"])) ||
            stable_id(gate, validator, summary, attrs),
        quality_gate_ref: gate,
        validator_ref: validator,
        source_ref: clean(get_any(attrs, [:source_ref, "source_ref"])),
        source_type: normalize_source_type(get_any(attrs, [:source_type, "source_type"])),
        source_turn_ref: clean(get_any(attrs, [:source_turn_ref, "source_turn_ref"])),
        severity: normalize_severity(get_any(attrs, [:severity, "severity"])),
        action: action,
        summary: summary,
        reasoning:
          clean(get_any(attrs, [:reasoning, "reasoning"])) ||
            "该判断基于正文证据与质量规则形成，建议结合原句复核。",
        confidence: normalize_confidence(get_any(attrs, [:confidence, "confidence"])) || 0.5,
        evidence_spans: normalize_spans(get_any(attrs, [:evidence_spans, "evidence_spans"])),
        impact_scope: normalize_scope(get_any(attrs, [:impact_scope, "impact_scope"])),
        revision_scope:
          normalize_scope(
            get_any(attrs, [:revision_scope, "revision_scope"]) ||
              get_any(attrs, [:impact_scope, "impact_scope"])
          ),
        brief_field_refs: clean_list(get_any(attrs, [:brief_field_refs, "brief_field_refs"])),
        suggested_revision:
          normalize_map(get_any(attrs, [:suggested_revision, "suggested_revision"])),
        can_override:
          normalize_can_override(get_any(attrs, [:can_override, "can_override"]), action),
        created_at: clean(get_any(attrs, [:created_at, "created_at"]))
      }
    end
  end

  @doc "序列化为 plain map（trace / TurnResult / 持久化用）。"
  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = f) do
    %{
      "quality_finding_id" => f.quality_finding_id,
      "quality_gate_ref" => f.quality_gate_ref,
      "validator_ref" => f.validator_ref,
      "source_ref" => f.source_ref,
      "source_type" => f.source_type && Atom.to_string(f.source_type),
      "source_turn_ref" => f.source_turn_ref,
      "severity" => Atom.to_string(f.severity),
      "action" => Atom.to_string(f.action),
      "summary" => f.summary,
      "reasoning" => f.reasoning,
      "confidence" => f.confidence,
      "evidence_spans" => f.evidence_spans,
      "impact_scope" => Atom.to_string(f.impact_scope),
      "revision_scope" => Atom.to_string(f.revision_scope),
      "brief_field_refs" => f.brief_field_refs,
      "suggested_revision" => f.suggested_revision,
      "can_override" => f.can_override
    }
  end

  @doc """
  作者可见摘要（TurnResult / UI 用）：暴露作者做决定所需的证据、位置、理由、范围与置信度。
  """
  @spec author_safe_summary(t()) :: map()
  def author_safe_summary(%__MODULE__{} = f) do
    %{
      "quality_finding_id" => f.quality_finding_id,
      "quality_gate" => f.quality_gate_ref,
      "validator" => f.validator_ref,
      "severity" => Atom.to_string(f.severity),
      "action" => Atom.to_string(f.action),
      "summary" => f.summary,
      "reasoning" => f.reasoning,
      "confidence" => f.confidence,
      "evidence_spans" => f.evidence_spans,
      "impact_scope" => Atom.to_string(f.impact_scope),
      "revision_scope" => Atom.to_string(f.revision_scope),
      "brief_field_refs" => f.brief_field_refs,
      "suggested_revision" => f.suggested_revision,
      "can_override" => f.can_override
    }
  end

  # ── normalization ──────────────────────────────────

  defp normalize_action(value) do
    case to_existing_atom(value) do
      action when action in @actions -> action
      _ -> :warn
    end
  end

  defp normalize_severity(value) do
    case to_existing_atom(value) do
      severity when severity in @severities -> severity
      _ -> :warn
    end
  end

  defp normalize_source_type(value) do
    case to_existing_atom(value) do
      type when type in @source_types -> type
      _ -> nil
    end
  end

  # block 默认不可越过（高置信事实/认知冲突）；其余文学类默认可越过。显式传值优先。
  defp normalize_can_override(value, action) do
    case value do
      v when is_boolean(v) -> v
      _ -> action != :block
    end
  end

  defp normalize_confidence(value) when is_float(value) and value >= 0.0 and value <= 1.0,
    do: value

  defp normalize_confidence(value) when is_integer(value) and value in 0..1, do: value / 1
  defp normalize_confidence(_value), do: nil

  defp normalize_scope(value) do
    case to_existing_atom(value) do
      scope when scope in @scopes -> scope
      _ -> :local
    end
  end

  defp normalize_spans(list) when is_list(list), do: Enum.filter(list, &is_map/1)
  defp normalize_spans(_list), do: []

  defp normalize_map(map) when is_map(map), do: map
  defp normalize_map(_map), do: nil

  defp to_existing_atom(value) when is_atom(value) and not is_nil(value), do: value

  defp to_existing_atom(value) when is_binary(value) do
    String.to_existing_atom(value)
  rescue
    ArgumentError -> nil
  end

  defp to_existing_atom(_value), do: nil

  defp get_any(map, keys), do: Enum.find_value(keys, fn k -> Map.get(map, k) end)

  defp clean(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp clean(_value), do: nil

  defp clean_list(list) when is_list(list),
    do: list |> Enum.map(&clean/1) |> Enum.reject(&is_nil/1)

  defp clean_list(_list), do: []

  defp stable_id(gate, validator, summary, attrs) do
    evidence = get_any(attrs, [:evidence_spans, "evidence_spans"])
    seed = :erlang.term_to_binary({gate, validator, summary, evidence})

    "qf_" <>
      (:crypto.hash(:sha256, seed)
       |> Base.encode16(case: :lower)
       |> String.slice(0, 16))
  end
end
