defmodule NovelDomain.CanonFreshness do
  @moduledoc """
  B47：对象级 canon freshness 判定（纯函数，无 I/O）。

  「候选是否还基于当前持久 canon」必须由结构化基线版本事实与当前 canon 快照比较得出；
  输入不接受 LLM 文案、候选自报 `canon_conflicts` 或文本相似度。当前 canon 快照由
  persistence 读端口提供（`AdoptionRepository.canon_snapshot/2`），application 负责编排。

  首批对象（B47 §6.2 冻结）：

  - `:chapter_prose`：章正文修订候选（B28 replace_scope / B36 replace_segments /
    ADR-0029 format_paragraphs）。版本单位 = 当前 accepted prose draft 的
    `draft:<uuid>` → 单调 `revision`；format plan 另比对 base 正文 `source_hash`。
  - `:character_profile`：角色叙事身份修订候选（B29）。版本单位 = 整对象 fingerprint
    + 被改字段旧值。

  判定状态：

  - `:fresh` — 候选基线与当前 canon 一致，可继续既有 gate。
  - `:stale` — 候选基于的版本已变化/目标 canon 缺失；必须重新生成，零写入。
  - `:conflict` — 当前持久 canon 与候选前提矛盾（多出未覆盖对象/字段值被取代）；
    进入恢复或人工裁决，零写入。
  - `:missing` / `:unavailable` — 读端口找不到目标 / 不可用；零写入。

  本模块只回答「是否还新鲜」；错误码、决策类型、回执与事务重校验由上层负责。
  """

  @type object :: :chapter_prose | :character_profile

  @type status :: :fresh | :stale | :conflict | :missing | :unavailable

  @type verdict :: %{
          object: object(),
          status: status(),
          reason_codes: [String.t()],
          expected: map() | nil,
          current: map() | nil
        }

  @stale_base_version ["stale_base_version", "candidate_base_outdated"]
  @stale_base_fingerprint ["stale_base", "candidate_base_outdated"]
  @conflict_uncovered [
    "canon_conflict_detected",
    "incomplete_scope",
    "canon_changed_after_candidate"
  ]
  @conflict_content ["canon_conflict_detected", "canon_content_changed"]
  @conflict_value ["canon_conflict_detected", "persisted_canon_differs"]

  @doc """
  比较候选基线（declared）与当前持久 canon（current），返回 verdict。

  declared/current 形状由对象类型决定，见 `@moduledoc` 与 B47 §6；未知对象返回
  `{:error, :unsupported_canon_object}`，不猜测、不降级成「新鲜」。
  """
  @spec assess(object(), map() | nil, map() | nil) ::
          verdict() | {:error, :unsupported_canon_object}
  def assess(:chapter_prose, declared, current), do: chapter_verdict(declared, current)
  def assess(:character_profile, declared, current), do: character_verdict(declared, current)
  def assess(_object, _declared, _current), do: {:error, :unsupported_canon_object}

  @doc "目标对象缺失/歧义时构造零写入 verdict（expected 保留候选基线供回执解释）。"
  @spec missing(object(), map() | nil, String.t()) :: verdict()
  def missing(object, declared, reason_code \\ "target_missing") when is_binary(reason_code) do
    verdict(object, :missing, [reason_code], declared, nil)
  end

  @doc "当前 canon 读端口不可用时构造零写入 verdict（fail closed，不假装新鲜）。"
  @spec unavailable(object(), map() | nil) :: verdict()
  def unavailable(object, declared) do
    verdict(object, :unavailable, ["canon_freshness_unavailable"], declared, nil)
  end

  @doc "verdict 是否允许继续采纳 gate。"
  @spec fresh?(verdict()) :: boolean()
  def fresh?(%{status: :fresh}), do: true
  def fresh?(_verdict), do: false

  # ── chapter prose（O1） ─────────────────────────────────────────

  defp chapter_verdict(declared, nil), do: missing(:chapter_prose, declared)

  defp chapter_verdict(declared, current) when is_map(declared) do
    declared_versions = versions(declared)
    current_versions = versions(current)

    cond do
      current_versions == %{} ->
        verdict(:chapter_prose, :stale, @stale_base_version, declared, current)

      base_outdated?(declared_versions, current_versions) ->
        verdict(:chapter_prose, :stale, @stale_base_version, declared, current)

      uncovered?(declared_versions, current_versions) ->
        verdict(:chapter_prose, :conflict, @conflict_uncovered, declared, current)

      content_changed?(declared, current) ->
        verdict(:chapter_prose, :conflict, @conflict_content, declared, current)

      true ->
        verdict(:chapter_prose, :fresh, [], declared, current)
    end
  end

  defp chapter_verdict(declared, current),
    do: verdict(:chapter_prose, :missing, ["target_missing"], declared, current)

  defp versions(map) when is_map(map) do
    case Map.get(map, :versions) do
      %{} = versions -> versions
      _ -> %{}
    end
  end

  defp versions(_map), do: %{}

  defp base_outdated?(declared_versions, current_versions) do
    Enum.any?(declared_versions, fn {ref, version} ->
      Map.get(current_versions, ref) != version
    end)
  end

  defp uncovered?(declared_versions, current_versions) do
    Enum.any?(Map.keys(current_versions), &(not Map.has_key?(declared_versions, &1)))
  end

  defp content_changed?(declared, current) do
    declared_digest = Map.get(declared, :digest)
    current_digest = Map.get(current, :digest)

    is_binary(declared_digest) and is_binary(current_digest) and
      declared_digest != current_digest
  end

  # ── character profile（O2） ────────────────────────────────────

  defp character_verdict(declared, nil), do: missing(:character_profile, declared)

  defp character_verdict(declared, current) when is_map(declared) do
    cond do
      value_conflict?(declared, current) ->
        verdict(:character_profile, :conflict, @conflict_value, declared, current)

      fingerprint_outdated?(declared, current) ->
        verdict(:character_profile, :stale, @stale_base_fingerprint, declared, current)

      true ->
        verdict(:character_profile, :fresh, [], declared, current)
    end
  end

  defp character_verdict(declared, current),
    do: verdict(:character_profile, :missing, ["target_missing"], declared, current)

  defp value_conflict?(declared, current) do
    Map.get(current, :value) != Map.get(declared, :old_value)
  end

  defp fingerprint_outdated?(declared, current) do
    declared_fingerprint = Map.get(declared, :fingerprint)

    is_binary(declared_fingerprint) and declared_fingerprint != "" and
      Map.get(current, :fingerprint) != declared_fingerprint
  end

  defp verdict(object, status, reason_codes, expected, current) do
    %{
      object: object,
      status: status,
      reason_codes: reason_codes,
      expected: expected,
      current: current
    }
  end
end
