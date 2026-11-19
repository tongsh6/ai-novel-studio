defmodule NovelApplication.CharacterProfile do
  @moduledoc """
  B29 CP1：已有角色主档案字段修订（首闭环 narrative_role）的对象绑定与候选事实组装。

  边界：
  - 身份 = character_ref；name/aliases 仅展示与同名/别名消歧，不参与身份。
  - 只读既有角色持久事实与完整指纹；不写库、不新建角色、不写记忆。
  - 候选只提议目标角色的白名单字段变更；「唯一主角/替换原主角」把其它角色变化放入
    other_character_changes 供作者裁决，不默认清空/改写其它角色。
  """

  alias NovelApplication.AuthorVisible.Presenter
  alias NovelFoundation.Enums.{AdoptionStatus, NarrativeRole}
  alias NovelPersistence.AdoptionRepository

  @role_keywords %{
    "主角" => "PROTAGONIST",
    "反派" => "ANTAGONIST",
    "配角" => "SUPPORTING",
    "次要" => "MINOR",
    "群像" => "ENSEMBLE_POV"
  }

  @allowed_fields ["narrative_role"]
  @effects ["character_field_update"]

  @bindable_statuses [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]
  @target_fields ~w(character_ref name aliases role summary narrative_role status updated_at base_fingerprint)a
  @observed_fields @target_fields -- [:summary]

  @doc "同作品已采纳角色的真实持久事实；不合成版本，也不降级到缺失指纹的投影。"
  def targets(work_id) when is_binary(work_id) do
    with {:ok, %{characters: characters}} <- AdoptionRepository.character_profile_context(work_id) do
      {:ok,
       Enum.flat_map(characters, fn character ->
         case normalize_target(character) do
           nil -> []
           target -> [target]
         end
       end)}
    end
  end

  def targets(_work_id), do: {:error, :target_missing}

  @doc "精确读取同作品已采纳角色；目录读取与修订绑定共用同一状态/真实指纹规则。"
  def target(work_id, "character:" <> _ = ref) when is_binary(work_id) do
    with {:ok, character} <- AdoptionRepository.character_profile_context(work_id, ref),
         %{} = target <- normalize_target(character) do
      {:ok, target}
    else
      nil -> {:error, :target_missing}
      {:error, _} = error -> error
      _ -> {:error, :target_missing}
    end
  end

  def target(_work_id, _ref), do: {:error, :target_missing}

  @doc """
  绑定本次实际请求可见的 canonical 详情。目录、原始探索缓存和猜中的 ref 不授予
  修订资格；所需字段须完整，摘要可分页。返回选中的原叶供派发重核同一指纹。
  """
  def observed_target(work_id, ref, observations) when is_list(observations) do
    with {:ok, current} <- target(work_id, ref),
         %{} = observed <- latest_detail(observations, ref),
         :ok <- validate_observed(observed, current, work_id) do
      {:ok, current, observed}
    else
      nil -> {:error, :not_observed}
      {:error, _} = error -> error
    end
  end

  def observed_target(_work_id, _ref, _observations), do: {:error, :not_observed}

  defp latest_detail(observations, ref) do
    observations
    |> Enum.reverse()
    |> Enum.find(fn
      %{
        content: %{"tool" => "archive_read"},
        coverage: %{"kind" => "detail", "facet" => "characters", "ref" => ^ref}
      } ->
        true

      _ ->
        false
    end)
  end

  defp validate_observed(observed, current, work_id) do
    coverage = observed.coverage
    fields = Map.get(coverage, "complete_fields")
    facts = Map.get(observed.content, "facts")
    actual = if is_map(facts), do: Map.get(facts, "character")
    versions = Map.get(observed, :versions)
    version = if is_map(versions), do: Map.get(versions, current.character_ref)

    with :ok <- validate_observation_scope(coverage, work_id),
         :ok <-
           validate_observation_shape(observed, current.character_ref, actual, fields, version),
         :ok <- validate_complete_fields(actual, fields) do
      validate_observation_freshness(actual, version, current)
    end
  end

  defp validate_observation_scope(coverage, work_id) do
    if Map.get(coverage, "work_id") == work_id,
      do: :ok,
      else: {:error, :cross_work_scope}
  end

  defp validate_observation_shape(observed, ref, actual, fields, version) do
    valid =
      Map.get(observed, :status) in ["ok", "partial"] and
        Map.get(observed, :source_refs) == [ref] and is_map(actual) and
        is_list(fields) and is_binary(version) and version != ""

    if valid, do: :ok, else: {:error, :incomplete_observation}
  end

  defp validate_complete_fields(actual, fields) do
    complete =
      Enum.all?(@observed_fields, fn key ->
        name = Atom.to_string(key)
        name in fields and Map.has_key?(actual, name)
      end)

    if complete, do: :ok, else: {:error, :incomplete_observation}
  end

  defp validate_observation_freshness(actual, version, current) do
    matches =
      version == current.base_fingerprint and
        Enum.all?(@observed_fields, fn key ->
          Map.get(actual, Atom.to_string(key)) == Map.fetch!(current, key)
        end)

    if matches, do: :ok, else: {:error, :stale_base}
  end

  @doc "以实际供应的 canonical 观察绑定角色修订；作者目标与当前持久指纹共同决定资格。"
  @spec bind_judgment(map(), String.t(), [map()]) :: {:ok, map()} | {:error, term()}
  def bind_judgment(
        %{action: "execute", capability: "revise_character_profile"} = judgment,
        work_id,
        visible_payloads
      ) do
    desired_role = narrative_role_from_text(judgment.author_input)

    if is_nil(desired_role) do
      {:error, :invalid_character_role}
    else
      with {:ok, target, observation} <-
             observed_target(work_id, judgment.character_ref, visible_payloads),
           {:ok, roster} <- targets(work_id),
           :ok <-
             validate_presentation(
               target,
               desired_role,
               judgment.author_input,
               roster
             ) do
        {:ok, Map.put(judgment, :character_observation, observation)}
      else
        {:error, reason} -> {:error, {:character_profile_invalid, reason}}
      end
    end
  end

  def bind_judgment(judgment, _work_id, _visible_payloads), do: {:ok, judgment}

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

      # B48 CP1（C04=A）：old==new 是合法无变化出口，不生成候选/修订；
      # 由调用方转为普通说明，不把无变化当成错误路由。
      Map.get(target, :narrative_role) == desired_role ->
        {:no_change,
         %{
           character_ref: Map.get(target, :character_ref),
           character_name: Map.get(target, :name),
           old_role: desired_role,
           desired_role: desired_role
         }}

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

  @doc "用实际投影验证本次目标及建议对象可辨认；判断接收与派发共用，不持久化展示身份。"
  @spec validate_presentation(map(), String.t(), String.t(), [map()]) :: :ok | {:error, term()}
  def validate_presentation(target, desired_role, author_text, roster) do
    result =
      case build_candidate(target, desired_role, author_text, roster) do
        {:ok, payload} ->
          Presenter.character_profile_candidate(payload, target, roster)

        {:no_change, facts} ->
          Presenter.character_profile_no_change(facts, target, roster)

        {:error, _} = error ->
          error
      end

    case result do
      {:ok, _presentation} -> :ok
      {:error, _} = error -> error
    end
  end

  defp normalize_target(
         %{
           character_ref: "character:" <> _,
           name: name,
           aliases: aliases,
           status: status,
           base_fingerprint: fingerprint
         } = character
       )
       when status in @bindable_statuses and is_binary(name) and name != "" and
              is_list(aliases) and is_binary(fingerprint) and fingerprint != "" do
    if Enum.all?(@target_fields, &Map.has_key?(character, &1)) and
         Enum.all?(aliases, &is_binary/1),
       do: Map.take(character, @target_fields),
       else: nil
  end

  defp normalize_target(_character), do: nil

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
