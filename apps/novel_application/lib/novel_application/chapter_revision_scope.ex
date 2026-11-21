defmodule NovelApplication.ChapterRevisionScope do
  @moduledoc """
  章修订的机械范围证据：原候选声明、当前 accepted 基线复核和真实观察绑定。

  作者原话由既有 Judgment 解释为修改范围与真实选段提议；本模块只验证结构和证据，
  不将引用真实性当作意图正确证明。ChapterReadEvidence 核真实章页，LocalizedRevision 核源区间应用；
  完整基线的已供应资格仍由 PendingArtifactWorkflow 独立消费。
  """

  alias NovelApplication.ChapterReadEvidence
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.RequestIR

  @doc "识别原 payload 的章级范围声明，只选择严格接收分支，不证明授权或补齐缺项。"
  @spec declares_revision_scope?(term()) :: boolean()
  def declares_revision_scope?(payload) when is_map(payload) do
    value(payload, :modification_scope) in ["target_segments", "whole_chapter"] or
      value(value(payload, :scope), :kind) in ["target_segments", "whole_chapter"] or
      value(value(payload, :adoption_effect), :mode) in ["replace_segments", "replace_scope"] or
      Enum.any?(List.wrap(value(payload, :items)), fn item ->
        is_map(item) and
          (Map.has_key?(item, :target_segment_ids) or Map.has_key?(item, "target_segment_ids"))
      end)
  end

  def declares_revision_scope?(_payload), do: false

  @doc "复核既有章级候选的授权及 accepted 基线；不重判作者意图，不扩大原范围。"
  def revalidate_payload(payload, facts) when is_map(payload) and is_map(facts) do
    scope = value(payload, :scope)
    effect = value(payload, :adoption_effect)
    kind = value(payload, :modification_scope)
    base = value(facts, :base_text)
    items = value(payload, :items)
    segments = if is_binary(base), do: NovelPersistence.LocalizedRevision.segment(base), else: []

    with true <- kind in ["target_segments", "whole_chapter"],
         true <- value(scope, :kind) == kind,
         true <-
           value(effect, :mode) ==
             if(kind == "target_segments", do: "replace_segments", else: "replace_scope"),
         true <- value(facts, :coverage) in [:complete, "complete"] and segments != [],
         true <- value(payload, :target_chapter_ref) == value(facts, :target_chapter_ref),
         true <- value(scope, :target_chapter_ref) == value(facts, :target_chapter_ref),
         false <- Map.has_key?(payload, :content) or Map.has_key?(payload, "content"),
         :ok <- revalidate_baseline(scope, effect, kind, facts, segments),
         {:ok, _text, _receipt} <-
           apply_candidate(kind, segments, value(scope, :target_segment_ids), items) do
      {:ok, payload}
    else
      {:error, _reason} = error -> error
      _ -> {:error, :incomplete_scope}
    end
  end

  def revalidate_payload(_payload, _facts), do: {:error, :incomplete_scope}

  defp revalidate_baseline(scope, effect, kind, facts, segments) do
    versions = version_pairs(value(facts, :expected_base_versions))
    covered = Enum.map(versions, fn {ref, version} -> "#{ref}:#{version}" end)
    ids = value(scope, :target_segment_ids)
    targets = Enum.filter(segments, &(&1.segment_id in List.wrap(ids)))
    hashes = Enum.map(targets, &{&1.segment_id, &1.sha256})
    first = List.first(value(facts, :materials) || []) || %{}

    common? = common_baseline_matches?(scope, effect, versions, covered, first, hashes)

    exact? =
      if kind == "target_segments" do
        target_baseline_matches?(scope, effect, versions, ids, hashes)
      else
        whole_baseline_matches?(effect, versions, ids, segments)
      end

    if common? and exact?, do: :ok, else: {:error, :stale_base_version}
  end

  defp common_baseline_matches?(scope, effect, versions, covered, first, hashes) do
    versions != [] and value(scope, :covered) == covered and
      value(scope, :covered_refs) == covered and value(effect, :covered) == covered and
      value(scope, :base_draft_ref) == value(first, :ref) and
      value(scope, :base_version) == value(first, :version) and
      hash_pairs(value(scope, :expected_segment_hashes)) == hashes
  end

  defp target_baseline_matches?(scope, effect, versions, ids, hashes) do
    version_pairs(value(scope, :base_versions)) == versions and
      version_pairs(value(effect, :base_versions)) == versions and
      value(effect, :target_segment_ids) == ids and
      value(effect, :base_draft_ref) == value(scope, :base_draft_ref) and
      value(effect, :base_version) == value(scope, :base_version) and
      hash_pairs(value(effect, :expected_segment_hashes)) == hashes
  end

  defp whole_baseline_matches?(effect, versions, ids, segments) do
    value(effect, :coverage) == "complete" and
      version_pairs(value(effect, :expected_base_versions)) == versions and
      ids == Enum.map(segments, & &1.segment_id)
  end

  defp apply_candidate("target_segments", segments, ids, items),
    do: NovelPersistence.LocalizedRevision.replace_segments(segments, ids, items)

  defp apply_candidate("whole_chapter", segments, _ids, items),
    do: NovelPersistence.LocalizedRevision.replace_scope(segments, items)

  defp version_pairs(items) when is_list(items),
    do: Enum.map(items, &{value(&1, :ref), value(&1, :version)})

  defp version_pairs(_items), do: []

  defp hash_pairs(items) when is_list(items),
    do: Enum.map(items, &{value(&1, :segment_id), value(&1, :sha256)})

  defp hash_pairs(_items), do: []

  defp value(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
  defp value(_map, _key), do: nil

  @doc "章级已采纳正文的规范 ref；判断/候选/绑定共用同一身份口径。"
  @spec chapter_ref?(term()) :: boolean()
  def chapter_ref?(ref) when is_binary(ref), do: String.starts_with?(ref, "chapter:")
  def chapter_ref?(_ref), do: false

  @doc """
  验证既有判断结果的章范围字段；只核结构，不重新解释作者原话。

  章级修订必须声明现有 modification_scope；局部范围必须给出非空唯一选段。
  整章、仅换行及非章动作不得夹带局部选段；不存在隐式章目标或默认修改范围。
  判断接收和执行前复核共用本边界。
  """
  @spec validate_judgment_scope(map()) :: {:ok, atom() | nil} | {:error, {atom(), atom()}}
  def validate_judgment_scope(
        %{
          action: "execute",
          capability: "revise_adopted_content",
          adopted_content_ref: "chapter:" <> _
        } = judgment
      ) do
    raw_scope = Map.get(judgment, :modification_scope)

    scope =
      Enum.find(AuthoringTask.modification_scopes(), fn scope ->
        raw_scope == scope or raw_scope == Atom.to_string(scope)
      end)

    case {raw_scope, scope} do
      {nil, _scope} ->
        {:error, {:modification_scope, :required}}

      {_raw_scope, nil} ->
        {:error, {:modification_scope, :invalid}}

      {_raw_scope, scope} ->
        validate_target_fields(scope, judgment)
    end
  end

  def validate_judgment_scope(judgment) when is_map(judgment) do
    if is_nil(Map.get(judgment, :modification_scope)),
      do: validate_target_fields(nil, judgment),
      else: {:error, {:modification_scope, :not_allowed}}
  end

  defp validate_target_fields(:target_segments, judgment) do
    ids = Map.get(judgment, :target_segment_ids)

    cond do
      ids in [nil, []] ->
        {:error, {:target_segments, :ids_required}}

      normalize_bound_ids(ids) == :invalid ->
        {:error, {:target_segments, :invalid_selection}}

      true ->
        {:ok, :target_segments}
    end
  end

  defp validate_target_fields(scope, judgment) do
    if is_nil(Map.get(judgment, :target_segment_ids)) and
         is_nil(Map.get(judgment, :observed_targets)),
       do: {:ok, scope},
       else: {:error, {:target_segments, :not_allowed}}
  end

  @doc """
  decode 成功后、accepted 回执前，把局部修订提议绑定到本轮真实观察。

  所有自然语言定位均由既有 Judgment 表达为 target_segment_ids；按同一正文的
  chapter_read 页逐段证明完整覆盖。结果只含 target_segment_ids/source_hash/
  versions，writer 前再由 Pending 与当前章事实复核；这些证据不代签语义正确。
  """
  @spec bind_observed_targets(map(), RequestIR.t()) ::
          {:ok, map()} | {:error, {atom(), atom()}}
  def bind_observed_targets(judgment, %RequestIR{} = request) when is_map(judgment) do
    case validate_judgment_scope(judgment) do
      {:ok, :target_segments} ->
        judgment
        |> Map.put(:modification_scope, :target_segments)
        |> bind_observed_selection(request, Map.fetch!(judgment, :target_segment_ids))

      {:ok, nil} ->
        {:ok, judgment}

      {:ok, scope} ->
        {:ok, Map.put(judgment, :modification_scope, scope)}

      {:error, _reason} = error ->
        error
    end
  end

  defp normalize_bound_ids(ids) when is_list(ids) do
    if Enum.all?(ids, &(is_binary(&1) and String.trim(&1) != "")) and ids == Enum.uniq(ids),
      do: ids,
      else: :invalid
  end

  defp normalize_bound_ids(_ids), do: :invalid

  defp bind_observed_selection(judgment, request, ids) do
    case ChapterReadEvidence.bind_target_segments(request, judgment.adopted_content_ref, ids) do
      {:ok, binding} ->
        {:ok, Map.put(judgment, :observed_targets, binding)}

      {:error, reason} ->
        {:error, {:target_segments, reason}}
    end
  end
end
