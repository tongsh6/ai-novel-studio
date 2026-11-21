defmodule NovelApplication.ChapterRevisionScope do
  @moduledoc """
  章修订的机械范围证据：原候选声明、当前 accepted 基线复核和真实观察绑定。

  作者原话解释由 ChapterRevisionAuthorInput 唯一承担；本模块不重新解释作者意图，
  不扩大原范围。ChapterReadEvidence 核真实章页，LocalizedRevision 核源区间应用；
  完整基线的已供应资格仍由 PendingArtifactWorkflow 独立消费。
  """

  alias NovelApplication.ChapterReadEvidence
  alias NovelApplication.ChapterRevisionAuthorInput
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
  decode 成功后、accepted 回执前，把模型提议的目标段绑定到本轮真实观察。

  `target_segment_ids` 只接受 execute + revise_adopted_content + 章级 ref；
  作者显式段号/字面目标优先，模型提议不覆盖。引用式目标必须按同一正文的
  chapter_read 页逐段证明完整覆盖；结果只含 target_segment_ids/source_hash/
  versions，writer 前再由 Pending 与当前章事实复核。
  """
  @spec bind_observed_targets(map(), RequestIR.t()) ::
          {:ok, map()} | {:error, {:target_segments, atom()}}
  def bind_observed_targets(
        %{
          action: "execute",
          capability: "revise_adopted_content",
          adopted_content_ref: "chapter:" <> _
        } = judgment,
        %RequestIR{} = request
      ) do
    ids = normalize_bound_ids(Map.get(judgment, :target_segment_ids))
    author_text = Map.get(judgment, :author_input) || ""

    cond do
      ids == :invalid ->
        {:error, {:target_segments, :invalid_selection}}

      # 作者显式段号/字面目标，以及整章/仅排版/只读等既有范围判定优先于模型选段。
      ChapterRevisionAuthorInput.explicit_target?(author_text) or
          ChapterRevisionAuthorInput.authorize(author_text) != {:ok, :target_segments} ->
        {:ok, clear_bound_targets(judgment)}

      ChapterRevisionAuthorInput.reference_discovery_target?(author_text) or
          ChapterRevisionAuthorInput.local_target_authorized?(author_text) ->
        bind_observed_selection(judgment, request, ids)

      ids == [] ->
        {:ok, clear_bound_targets(judgment)}

      true ->
        {:error, {:target_segments, :selection_not_authorized}}
    end
  end

  def bind_observed_targets(judgment, %RequestIR{}) when is_map(judgment) do
    if normalize_bound_ids(Map.get(judgment, :target_segment_ids)) == [],
      do: {:ok, judgment},
      else: {:error, {:target_segments, :not_allowed}}
  end

  defp normalize_bound_ids(ids) when is_list(ids) do
    if Enum.all?(ids, &(is_binary(&1) and String.trim(&1) != "")) and ids == Enum.uniq(ids),
      do: ids,
      else: :invalid
  end

  defp normalize_bound_ids(nil), do: []
  defp normalize_bound_ids(_ids), do: :invalid

  defp clear_bound_targets(judgment) do
    judgment
    |> Map.put(:target_segment_ids, [])
    |> Map.delete(:observed_targets)
  end

  defp bind_observed_selection(judgment, request, ids) do
    case ChapterReadEvidence.bind_target_segments(request, judgment.adopted_content_ref, ids) do
      {:ok, binding} ->
        {:ok,
         judgment
         |> Map.put(:target_segment_ids, ids)
         |> Map.put(:observed_targets, binding)}

      {:error, reason} ->
        {:error, {:target_segments, reason}}
    end
  end
end
