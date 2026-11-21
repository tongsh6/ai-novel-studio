defmodule NovelCommon.Contracts.CreativeItemAttributes do
  @moduledoc """
  Creative item field schemas and optional-attribute normalization.
  The native schema excludes application provenance and FactInventory's skeleton wrapper.
  """

  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.NarrativeRole

  @chapter_ref_pattern ~r/^chapter:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

  @doc "The model-facing fields of one creative item; application provenance is excluded."
  def schema(type, target_segments? \\ false) do
    properties =
      Map.merge(
        %{
          item_id: %{type: "string", minLength: 1},
          title: %{type: "string", minLength: 1},
          body: %{type: "string", minLength: 1},
          rationale: %{
            anyOf: [%{type: "string"}, %{type: "null"}],
            description:
              "将直接展示给作者的创作说明：解释创作取舍、作品依据及预期作用，遵守共同作者说明规则。" <>
                "材料引用身份只放 self_report.used_context_refs；无需说明时省略或为 null。"
          }
        },
        type_properties(type)
      )

    properties =
      if target_segments? do
        Map.put(properties, :target_segment_ids, %{
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: %{type: "string", minLength: 1}
        })
      else
        properties
      end

    %{
      type: "object",
      properties: properties,
      required:
        ["item_id", "title", "body"] ++ if(target_segments?, do: ["target_segment_ids"], else: []),
      additionalProperties: false
    }
  end

  defp type_properties(type) when type in [:character_seed, "character_seed"] do
    %{
      narrative_role: %{anyOf: [%{type: "string", enum: NarrativeRole.values()}, %{type: "null"}]},
      role: %{type: "string", minLength: 1},
      aliases: %{type: "array", items: %{type: "string", minLength: 1}}
    }
  end

  defp type_properties(type)
       when type in [:character_evolution_seed, "character_evolution_seed"] do
    %{
      memory_subtype: %{
        anyOf: [
          %{
            type: "string",
            enum: [
              MemoryType.character_profile(),
              MemoryType.current_state(),
              MemoryType.relationship()
            ]
          },
          %{type: "null"}
        ]
      }
    }
  end

  defp type_properties(type) when type in [:outline_draft, "outline_draft"] do
    %{
      chapter_ref: %{
        type: "string",
        minLength: 1,
        description: "当前作品已有章的 chapter:<uuid>，逐字复制可信索引；新章省略。"
      }
    }
  end

  defp type_properties(type) when type in [:foreshadowing_seed, "foreshadowing_seed"] do
    %{
      planned_reveal: %{
        anyOf: [
          %{
            type: "object",
            required: ["kind", "seq"],
            properties: %{
              kind: %{enum: ["chapter", "volume"]},
              seq: %{type: "integer", minimum: 1}
            },
            additionalProperties: false
          },
          %{
            type: "object",
            required: ["kind"],
            properties: %{kind: %{enum: ["whole_book"]}},
            additionalProperties: false
          }
        ]
      },
      resolution_target: %{
        type: "string",
        minLength: 1,
        description: "已有伏笔账面引用，形如 foreshadow_<memory_id>。"
      },
      resolved_at_seq: %{type: "integer", minimum: 1}
    }
  end

  defp type_properties(type) when type in [:prose_formatting_plan, "prose_formatting_plan"] do
    %{
      line_break_changes: %{
        type: "array",
        minItems: 1,
        items: %{
          type: "object",
          required: ["boundary_id", "lines"],
          properties: %{
            boundary_id: %{type: "string", minLength: 1},
            lines: %{type: "integer", enum: [0, 1, 2]}
          },
          additionalProperties: false
        }
      }
    }
  end

  defp type_properties(_type), do: %{}

  @doc "Reference shape checks remain with their field owner, before normalization."
  def validate_raw_references(raw) do
    target = map_get(raw, :resolution_target)

    with :ok <- validate_chapter_ref(map_get(raw, :chapter_ref)) do
      if is_nil(target) or (is_binary(target) and normalize_resolution_target(target) == target) do
        :ok
      else
        {:error,
         %{
           code: "invalid_resolution_target",
           message: "resolution_target 必须原样引用已有 foreshadow_<memory_id>，不得改写或补猜。"
         }}
      end
    end
  end

  def validate_chapter_ref(nil), do: :ok

  def validate_chapter_ref(ref) do
    if valid_chapter_ref?(ref),
      do: :ok,
      else:
        {:error,
         %{code: "invalid_chapter_ref", message: "chapter_ref 必须形如 chapter:<uuid>，新章省略该字段。"}}
  end

  def valid_chapter_ref?(ref) when is_binary(ref), do: Regex.match?(@chapter_ref_pattern, ref)
  def valid_chapter_ref?(_ref), do: false

  @spec normalize(map()) :: map()
  def normalize(raw) when is_map(raw) do
    %{} |> put_optional_fields(raw) |> put_skeleton_suggestion(raw)
  end

  # 可选结构化键统一走重建式白名单 opt-in（非 I1 约束字段，I1 只校验
  # title/body/rationale）：normalizer 返回 nil 即整键丢弃，不写空壳——
  # narrative_role（叙事角色枚举）/ memory_subtype（角色记忆子类）/
  # role（一句话身份描述）/ aliases（去空去重别称数组，AU12 CP2）。
  defp put_optional_fields(item, raw) do
    provider_call_ref = map_get(raw, :provider_call_ref)

    [
      {:provider_call_ref, if(is_binary(provider_call_ref), do: provider_call_ref)},
      {:chapter_ref, map_get(raw, :chapter_ref)},
      {:narrative_role, normalize_narrative_role(map_get(raw, :narrative_role))},
      {:memory_subtype, normalize_memory_subtype(map_get(raw, :memory_subtype))},
      {:role, normalize_character_role(map_get(raw, :role))},
      {:aliases, normalize_character_aliases(map_get(raw, :aliases))},
      {:planned_reveal, normalize_planned_reveal(map_get(raw, :planned_reveal))},
      {:resolution_target, normalize_resolution_target(map_get(raw, :resolution_target))},
      {:resolved_at_seq, normalize_reveal_seq(map_get(raw, :resolved_at_seq))}
    ]
    |> Enum.reduce(item, fn
      {_key, nil}, acc -> acc
      {key, value}, acc -> Map.put(acc, key, value)
    end)
  end

  # skeleton_field / skeleton_value（可选）：全书规划字段建议的结构化槽位
  # （VS-00G CP4d，采纳=立项字段回写）。field 仅接受立项规划三字段、value 按
  # 字段类型收敛，任一不合法则整对丢弃（不臆造字段值）。
  defp put_skeleton_suggestion(item, raw) do
    case normalize_skeleton_suggestion(
           map_get(raw, :skeleton_field),
           map_get(raw, :skeleton_value)
         ) do
      nil -> item
      {field, value} -> item |> Map.put(:skeleton_field, field) |> Map.put(:skeleton_value, value)
    end
  end

  defp normalize_character_role(role) when is_binary(role) do
    case String.trim(role) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_character_role(_role), do: nil

  defp normalize_character_aliases(aliases) when is_list(aliases) do
    normalized =
      aliases
      |> Enum.filter(&is_binary/1)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    if normalized == [], do: nil, else: normalized
  end

  defp normalize_character_aliases(_aliases), do: nil

  # planned_reveal（可选，VS00F 刀④）：伏笔的预期回收时机——预期归伏笔自己，
  # 不设全局阈值（用户拍板「有的几章就收,有的贯穿全书」）。收敛为
  # %{"kind" => chapter|volume|whole_book, "seq" => 正整数|nil}；chapter/volume
  # 必须带 seq，whole_book 不带；不合法整键丢弃（机器不发明预期）。
  @planned_reveal_kinds ~w(chapter volume whole_book)

  defp normalize_planned_reveal(raw) when is_map(raw) do
    kind = raw |> map_get(:kind) |> normalize_reveal_kind()
    seq = raw |> map_get(:seq) |> normalize_reveal_seq()

    cond do
      kind == "whole_book" -> %{"kind" => kind}
      kind in @planned_reveal_kinds and is_integer(seq) -> %{"kind" => kind, "seq" => seq}
      true -> nil
    end
  end

  defp normalize_planned_reveal(_raw), do: nil

  defp normalize_reveal_kind(kind) when is_binary(kind) do
    normalized = kind |> String.trim() |> String.downcase()
    if normalized in @planned_reveal_kinds, do: normalized
  end

  defp normalize_reveal_kind(_kind), do: nil

  defp normalize_reveal_seq(seq) when is_integer(seq) and seq > 0, do: seq

  defp normalize_reveal_seq(seq) when is_binary(seq) do
    case Integer.parse(String.trim(seq)) do
      {value, ""} when value > 0 -> value
      _ -> nil
    end
  end

  defp normalize_reveal_seq(_seq), do: nil

  # resolution_target（可选，VS00F 刀④ CP3）：伏笔回收提案指向的账面条目引用
  # （`foreshadow_<memory_id>`）——身份锚定账面，防模型臆造目标。
  defp normalize_resolution_target(target) when is_binary(target) do
    trimmed = String.trim(target)
    if String.starts_with?(trimmed, "foreshadow_") and trimmed != "foreshadow_", do: trimmed
  end

  defp normalize_resolution_target(_target), do: nil

  # 全书规划字段建议槽位规范化（VS-00G CP4d）：target_length/planned_volumes 收敛为
  # 正整数，serial_form 收敛为非空字符串；字段名不在立项规划三字段内一律丢弃。
  @spec normalize_skeleton_suggestion(term(), term()) ::
          {String.t(), pos_integer() | String.t()} | nil
  defp normalize_skeleton_suggestion(field, value) when is_binary(field) do
    case field |> String.trim() |> String.downcase() do
      numeric_field when numeric_field in ["target_length", "planned_volumes"] ->
        case coerce_positive_integer(value) do
          nil -> nil
          int -> {numeric_field, int}
        end

      "serial_form" ->
        case normalize_serial_form(value) do
          nil -> nil
          form -> {"serial_form", form}
        end

      _other ->
        nil
    end
  end

  defp normalize_skeleton_suggestion(_field, _value), do: nil

  defp normalize_serial_form(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      form -> form
    end
  end

  defp normalize_serial_form(_value), do: nil

  defp coerce_positive_integer(value) when is_integer(value) and value > 0, do: value

  defp coerce_positive_integer(value) when is_binary(value) do
    case value |> String.trim() |> Integer.parse() do
      {int, ""} when int > 0 -> int
      _ -> nil
    end
  end

  defp coerce_positive_integer(_value), do: nil

  # 把 provider 输出的叙事角色规范化到 NarrativeRole 契约枚举。
  # 接受 canonical 枚举值（大小写不敏感）与常见中文同义词；无法识别返回 nil
  # （角色不带主角标记，召回时诚实报缺口，不臆造主角）。
  @spec normalize_narrative_role(term()) :: NarrativeRole.t() | nil
  defp normalize_narrative_role(value) when is_binary(value) do
    trimmed = value |> String.trim()
    upcased = String.upcase(trimmed)

    cond do
      NarrativeRole.valid?(upcased) -> upcased
      protagonist_label?(trimmed) -> NarrativeRole.protagonist()
      antagonist_label?(trimmed) -> NarrativeRole.antagonist()
      ensemble_label?(trimmed) -> NarrativeRole.ensemble_pov()
      supporting_label?(trimmed) -> NarrativeRole.supporting()
      minor_label?(trimmed) -> NarrativeRole.minor()
      true -> nil
    end
  end

  defp normalize_narrative_role(_value), do: nil

  # 把 provider 输出的角色演化 memory_subtype 规范化到角色 MemoryType 子集
  # （CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP）。接受 canonical 值与中文同义词；
  # 无法识别返回 nil（采纳层再按内容兜底分类）。
  @spec normalize_memory_subtype(term()) :: String.t() | nil
  defp normalize_memory_subtype(value) when is_binary(value) do
    trimmed = String.trim(value)
    upcased = String.upcase(trimmed)

    cond do
      upcased in [
        MemoryType.character_profile(),
        MemoryType.current_state(),
        MemoryType.relationship()
      ] ->
        upcased

      relationship_label?(trimmed) ->
        MemoryType.relationship()

      current_state_label?(trimmed) ->
        MemoryType.current_state()

      character_profile_label?(trimmed) ->
        MemoryType.character_profile()

      true ->
        nil
    end
  end

  defp normalize_memory_subtype(_value), do: nil

  defp relationship_label?(text), do: contains_any?(text, ["关系", "结盟", "敌对", "背叛", "决裂", "联手"])

  defp current_state_label?(text),
    do: contains_any?(text, ["当前状态", "现状", "此刻", "目前", "伤势", "处境", "所在"])

  defp character_profile_label?(text),
    do: contains_any?(text, ["演化", "成长", "转变", "弧光", "黑化", "觉醒", "蜕变"])

  defp protagonist_label?(text), do: contains_any?(text, ["主角", "主人公", "男主", "女主", "第一主角"])
  defp antagonist_label?(text), do: contains_any?(text, ["反派", "反一", "反角", "大反派", "对手"])
  defp ensemble_label?(text), do: contains_any?(text, ["群像", "POV", "视角人物", "多主角"])
  defp supporting_label?(text), do: contains_any?(text, ["配角", "辅助", "帮手"])
  defp minor_label?(text), do: contains_any?(text, ["次要", "龙套", "路人", "群演"])

  defp map_get(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp contains_any?(text, terms), do: Enum.any?(terms, &String.contains?(text, &1))
end
