defmodule NovelApplication.CharacterProfile do
  @moduledoc """
  B29 CP1：已有角色主档案字段修订（首闭环 narrative_role）的对象绑定与候选事实组装。

  边界：
  - 身份 = character_ref；name/aliases 仅展示与同名/别名消歧，不参与身份。
  - 只读既有角色事实（aux task-72 读端口；不可用时降级到 WorkArchive 角色面只读）；
    不写库、不新建角色、不写记忆。
  - 候选只提议目标角色的白名单字段变更；「唯一主角/替换原主角」把其它角色变化放入
    other_character_changes 供作者裁决，不默认清空/改写其它角色。
  """

  alias NovelFoundation.Enums.{AdoptionStatus, NarrativeRole}

  @role_keywords %{
    "主角" => "PROTAGONIST",
    "反派" => "ANTAGONIST",
    "配角" => "SUPPORTING",
    "次要" => "MINOR",
    "群像" => "ENSEMBLE_POV"
  }

  @allowed_fields ["narrative_role"]
  @effects ["character_field_update"]

  @doc "判断输入/候选所需的目标角色事实（读端口优先 aux，降级 WorkArchive 只读）。"
  def targets(work_id) when is_binary(work_id) do
    case aux_character_context(work_id) do
      {:ok, %{characters: characters}} ->
        {:ok, normalize_targets(characters)}

      {:ok, %{character_ref: _} = character} ->
        {:ok, List.wrap(normalize_target(character))}

      {:error, _reason} ->
        fallback_targets(work_id)
    end
  end

  def targets(_work_id), do: []

  @doc """
  解析目标角色：模型 ref 优先且必须在 roster 内；无 ref 时按作者原话
  name/aliases 唯一匹配；0 命中 target_missing，多命中 target_ambiguous。
  """
  def resolve_target(author_text, targets, model_ref \\ nil)
      when is_list(targets) do
    if is_binary(model_ref) and model_ref != "" do
      case Enum.find(targets, &(&1.character_ref == model_ref)) do
        nil -> {:error, :target_missing}
        target -> {:ok, target}
      end
    else
      resolve_by_text(author_text, targets)
    end
  end

  defp resolve_by_text(author_text, targets) do
    case by_text_matches(author_text, targets) do
      [target] -> {:ok, target}
      [] -> {:error, :target_missing}
      _ -> {:error, :target_ambiguous}
    end
  end

  @doc "作者原话里要改成的叙事角色（白名单值）；识别不了返回 nil。"
  def narrative_role_from_text(text) when is_binary(text) do
    # 优先「从配角改为主角」这类目标语序：目标角色在“改为/设为/指定/确立…”之后。
    case Regex.run(
           ~r/(?:改为|改判为|改判|设为|定为|设成|改成|确立为|确立|指定为|指定|作为|当作)(主角|反派|配角|次要|群像)/u,
           text
         ) do
      [_, keyword] ->
        Map.get(@role_keywords, keyword)

      _ ->
        first_role_keyword(text)
    end
  end

  def narrative_role_from_text(_text), do: nil

  defp first_role_keyword(text) do
    Enum.find_value(@role_keywords, fn {keyword, value} ->
      if String.contains?(text, keyword), do: value
    end)
  end

  @doc "是否「唯一主角/替换原主角/只保留一个主角」——需要把其它角色变化列给作者裁决。"
  def exclusive_protagonist_intent?(text) when is_binary(text) do
    String.contains?(text, ["唯一", "替换原", "替换当前", "只保留", "只能有一个", "唯一主角"])
  end

  def exclusive_protagonist_intent?(_text), do: false

  @doc """
  组装候选 payload（纯函数）。target 来自读端口；desired_role 必须来自 NarrativeRole。
  返回 {:ok, payload} | {:error, reason}。
  """
  def build_candidate(target, desired_role, author_text, roster) do
    cond do
      not is_map(target) ->
        {:error, :target_missing}

      desired_role not in NarrativeRole.values() ->
        {:error, :invalid_character_role}

      true ->
        old = Map.get(target, :narrative_role)
        changes = [%{field: "narrative_role", old: old, new: desired_role}]

        {:ok,
         %{
           object_kind: "character_profile_revision",
           character_ref: Map.get(target, :character_ref),
           character_name: Map.get(target, :name),
           base_fingerprint: Map.get(target, :base_fingerprint),
           changes: changes,
           effects: @effects,
           # 采纳 payload 首闭环只改目标角色；其它角色变化仅作作者裁决建议展示，
           # 不塞进同一采纳 payload（aux 采纳侧要求 other_character_changes=[]）。
           other_character_changes: [],
           suggested_other_character_changes:
             other_character_changes(target, desired_role, author_text, roster),
           adoption_effect: %{
             mode: "character_field_update",
             character_ref: Map.get(target, :character_ref)
           }
         }}
    end
  end

  @doc "字段白名单校验（首闭环仅 narrative_role）。"
  def validate_changes(%{changes: [change], effects: effects}) when is_list(effects) do
    cond do
      Map.get(change, :field) not in @allowed_fields -> {:error, :unsupported_field}
      not Map.has_key?(change, :old) -> {:error, :unsupported_field}
      Map.get(change, :new) not in NarrativeRole.values() -> {:error, :invalid_character_role}
      effects != @effects -> {:error, :unsupported_effect}
      true -> :ok
    end
  end

  def validate_changes(_payload), do: {:error, :unsupported_field}

  @doc "展示标题与差异正文（候选卡复用既有卡，不新增卡片类型）。"
  def candidate_title(payload), do: "#{payload.character_name} · 叙事身份修订"

  def candidate_body(payload) do
    change =
      Enum.map_join(payload.changes, "\n", fn change ->
        "- #{change.field}：#{change.old || "（未设置）"} → #{change.new}"
      end)

    other =
      case Map.get(payload, :suggested_other_character_changes, []) do
        [] ->
          []

        changes ->
          ["", "其它角色（需作者逐项裁决，未默认应用）："] ++
            Enum.map(changes, fn c ->
              "- #{c.character_name}（#{c.character_ref}）：当前 #{c.current_narrative_role || "未设置"}；未自动修改"
            end)
      end

    Enum.join([change | other], "\n")
  end

  @doc "把读端口指纹/事实注入 payload 前校验目标 ref 与 work 一致性由读端口负责。"
  def fingerprint(%{base_fingerprint: fp}) when is_binary(fp) and fp != "", do: fp

  def fingerprint(character) do
    seed =
      Enum.map_join(
        [
          Map.get(character, :character_ref) || Map.get(character, :id),
          Map.get(character, :name),
          Map.get(character, :narrative_role)
        ],
        "|",
        &to_string/1
      )

    :sha256 |> :crypto.hash(seed) |> Base.encode16(case: :lower)
  end

  # ── 读端口 ─────────────────────────────────────────────

  defp aux_character_context(work_id) do
    cond do
      Code.ensure_loaded?(NovelPersistence.AdoptionRepository) and
          function_exported?(NovelPersistence.AdoptionRepository, :character_profile_context, 1) ->
        safe_apply(NovelPersistence.AdoptionRepository, :character_profile_context, [work_id])

      Code.ensure_loaded?(NovelPersistence.AdoptionRepository) and
          function_exported?(NovelPersistence.AdoptionRepository, :character_profile_context, 2) ->
        safe_apply(NovelPersistence.AdoptionRepository, :character_profile_context, [work_id, nil])

      true ->
        {:error, :unavailable}
    end
  end

  defp safe_apply(module, function, args) do
    apply(module, function, args)
  rescue
    UndefinedFunctionError -> {:error, :unavailable}
  end

  # 仅由 targets/1 的 is_binary(work_id) 分支调用；非 binary 分支不可达（B60）。
  defp fallback_targets(work_id) when is_binary(work_id) do
    case NovelApplication.persistence_character_reader() do
      reader when is_function(reader, 1) ->
        case reader.(work_id) do
          characters when is_list(characters) -> normalize_targets(characters)
          _ -> []
        end

      _ ->
        []
    end
  rescue
    _ -> []
  end

  @bindable_statuses [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]

  defp normalize_targets(characters) do
    characters
    |> Enum.filter(&(is_map(&1) and bindable_status?(&1)))
    |> Enum.map(&normalize_target/1)
    |> Enum.reject(&is_nil/1)
  end

  defp bindable_status?(character) do
    status = Map.get(character, :status)
    is_nil(status) or to_string(status) in @bindable_statuses
  end

  defp normalize_target(character) when is_map(character) do
    with ref when is_binary(ref) and ref != "" <- character_ref(character),
         name when is_binary(name) and name != "" <- Map.get(character, :name) do
      %{
        character_ref: ref,
        name: name,
        aliases: List.wrap(Map.get(character, :aliases)) |> Enum.filter(&is_binary/1),
        role: Map.get(character, :role),
        summary: Map.get(character, :summary),
        narrative_role: Map.get(character, :narrative_role),
        status: Map.get(character, :status),
        updated_at: Map.get(character, :updated_at),
        base_fingerprint: Map.get(character, :base_fingerprint) || fingerprint(character)
      }
    else
      _ -> nil
    end
  end

  defp normalize_target(_character), do: nil

  defp character_ref(character) do
    Map.get(character, :character_ref) ||
      case Map.get(character, :id) do
        id when is_binary(id) and id != "" -> "character:#{id}"
        _ -> nil
      end
  end

  defp by_text_matches(text, targets) when is_binary(text) and text != "" do
    Enum.filter(targets, fn target ->
      names = [target.name | target.aliases] |> Enum.reject(&(&1 in [nil, ""]))

      Enum.any?(names, fn name -> String.contains?(text, name) end)
    end)
  end

  defp by_text_matches(_text, _targets), do: []

  defp other_character_changes(target, "PROTAGONIST", author_text, roster) do
    if exclusive_protagonist_intent?(author_text) do
      roster
      |> List.wrap()
      |> Enum.filter(&other_protagonist?(&1, target))
      |> Enum.map(&other_protagonist_suggestion/1)
    else
      []
    end
  end

  defp other_character_changes(_target, _desired_role, _author_text, _roster), do: []

  defp other_protagonist?(character, target) do
    character.character_ref != target.character_ref and
      character.narrative_role == "PROTAGONIST"
  end

  defp other_protagonist_suggestion(character) do
    %{
      character_ref: character.character_ref,
      character_name: character.name,
      current_narrative_role: "PROTAGONIST",
      reason: "作者要求唯一/替换主角；是否调整需作者逐项裁决，未默认修改"
    }
  end
end
