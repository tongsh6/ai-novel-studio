defmodule NovelApplication.CandidateAdoptionEffect do
  @moduledoc """
  B70 行为覆盖：作者可见候选 payload 的采纳效果 echo（additive，档位 A append-only）。

  单一职责：把创建 `TentativeArtifactSet` 时已确定的应用侧语义（artifact_type +
  authoring_intent + 目标章 ref）翻译成作者可见 pending payload 的 `adoption_effect`，
  供行为判据读取真实采纳效果；与 `AdoptionWorkflow.b28_effect_attrs/1` 同契约
  （`payload.adoption_effect.mode`），本模块不改变任何采纳分支。

  档位 A 只 echo 可证明且不改变既有采纳行为的 `append`：
  - 记忆/档案类候选（world_setting / character_seed / ...）：采纳=向作品档案追加事实；
  - 章节正文（prose_fragment / scene_draft）仅在非 rewrite 且目标章 ref 已解析时 append。

  rewrite / 修订 / 排版 / 大纲等场景由各自 B28/B36 流程或后续 Phase 2 负责；
  这里缺失即 unknown，不猜、不伪造。
  """

  alias NovelDomain.TentativeArtifactSet

  @append_memory_types ~w(character_seed character_evolution_seed plot_direction
                          world_setting foreshadowing_seed world_rule_seed
                          style_rule_seed constraint_seed)a

  @prose_types ~w(prose_fragment scene_draft)a

  @doc """
  把本候选的 adoption_effect 合并进 pending payload；无可证明 effect 时原样返回。
  """
  @spec merge_payload(map(), TentativeArtifactSet.t()) :: map()
  def merge_payload(payload, %TentativeArtifactSet{} = artifact_set) do
    case adoption_effect(artifact_set) do
      nil -> payload
      effect -> Map.put(payload, :adoption_effect, effect)
    end
  end

  defp adoption_effect(%TentativeArtifactSet{} = artifact_set) do
    cond do
      TentativeArtifactSet.revision?(artifact_set) -> nil
      type_in?(artifact_set.artifact_type, @append_memory_types) -> %{mode: "append"}
      type_in?(artifact_set.artifact_type, @prose_types) -> prose_effect(artifact_set)
      true -> nil
    end
  end

  defp prose_effect(%TentativeArtifactSet{} = artifact_set) do
    if artifact_set.authoring_intent in [nil, :continuation, "continuation"] and
         chapter_ref?(artifact_set.target_chapter_ref) do
      %{mode: "append"}
    end
  end

  # 与 AdoptionWorkflow.adoption_chapter_ref/1 同口径：合法章节 ref 才 echo，
  # 否则采纳校验不会要求 target 的假设不成立，不能标 append（保持 unknown）。
  defp chapter_ref?("chapter:" <> uuid) do
    match?({:ok, _}, Ecto.UUID.cast(uuid))
  end

  defp chapter_ref?(_ref), do: false

  defp type_in?(type, types) when is_atom(type), do: type in types

  defp type_in?(type, types) when is_binary(type),
    do: Enum.any?(types, &(Atom.to_string(&1) == type))

  defp type_in?(_type, _types), do: false
end
