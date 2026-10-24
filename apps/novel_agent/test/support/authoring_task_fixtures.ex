defmodule NovelAgent.TestSupport.AuthoringTaskFixtures do
  @moduledoc """
  CP3d 测试用 AuthoringTask fixture（不依赖 application builder；agent app 独立）。

  角色/设定/大纲的 output_contract.artifact_type 与运行时 ToolOutputContract 校验同源。
  """

  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask

  @prose_contract %{
    kind: :json,
    schema_ref: "prose_writing_v1",
    artifact_type: :prose_fragment,
    required_keys: ["items", "item_id", "title", "body"],
    allow_companions: true
  }

  @role_contracts %{
    outline: %{
      kind: :json,
      schema_ref: "tentative_artifact_v1",
      artifact_type: :outline_draft,
      required_keys: ["items", "item_id", "title", "body"],
      allow_companions: false
    },
    character_design: %{
      kind: :json,
      schema_ref: "tentative_artifact_v1",
      artifact_type: :character_seed,
      required_keys: ["items", "item_id", "title", "body"],
      allow_companions: false
    },
    character_evolution: %{
      kind: :json,
      schema_ref: "tentative_artifact_v1",
      artifact_type: :character_evolution_seed,
      required_keys: ["items", "item_id", "title", "body"],
      allow_companions: false
    },
    world_building: %{
      kind: :json,
      schema_ref: "tentative_artifact_v1",
      artifact_type: :world_setting,
      required_keys: ["items", "item_id", "title", "body"],
      allow_companions: false
    },
    quality_evaluation: %{
      kind: :json,
      schema_ref: "quality_evaluation_v1",
      required_keys: ["findings"],
      allow_companions: false
    }
  }

  @doc "构造一个合法 AuthoringTask fixture；attrs 覆盖默认字段。"
  def task(kind, attrs \\ %{}) do
    base = %AuthoringTask{
      kind: kind,
      author_goal: "写出一版可采纳的候选",
      author_words: "作者原话 NONCE42",
      scope: scope_for(kind),
      materials: materials_for(kind),
      preserve: if(kind == :revision, do: ["未要求修改的内容逐字保留"], else: []),
      operation_effect: effect_for(kind),
      output_contract: contract_for(kind),
      source_refs: ["turn:test"],
      semantic_version: AuthoringSemantics.version()
    }

    struct!(base, attrs)
  end

  def prose_task(attrs \\ %{}) do
    task(:first_draft, attrs)
  end

  def quality_evaluation_task(attrs \\ %{}) do
    task(
      :quality_evaluation,
      Map.merge(
        %{
          author_goal: "评审本轮生成的正文候选",
          materials: [
            %{kind: :prose, ref: "as_1", complete?: false, omission_note: "仅本轮生成候选，非整章"}
          ],
          scope: %{refs: ["as_1"], coverage: :single}
        },
        attrs
      )
    )
  end

  def contract_for(kind) when kind in [:first_draft, :continuation, :rewrite, :revision],
    do: @prose_contract

  def contract_for(:outline), do: Map.fetch!(@role_contracts, :outline)
  def contract_for(:character_design), do: Map.fetch!(@role_contracts, :character_design)
  def contract_for(:character_evolution), do: Map.fetch!(@role_contracts, :character_evolution)
  def contract_for(:world_building), do: Map.fetch!(@role_contracts, :world_building)
  def contract_for(:quality_evaluation), do: Map.fetch!(@role_contracts, :quality_evaluation)
  def contract_for(_kind), do: %{kind: :json, required_keys: ["items"], allow_companions: false}

  def effect_for(:character_design), do: :design_object
  def effect_for(:revision), do: :revise_candidate
  def effect_for(_kind), do: :create_candidate

  def scope_for(:revision) do
    %{refs: ["as_1"], coverage: :single, base_ref: "as_1"}
  end

  def scope_for(kind) when kind in [:outline], do: %{refs: ["work:test"], coverage: :multi}
  def scope_for(_kind), do: %{refs: ["work:test"], coverage: :chapter}

  def materials_for(:revision) do
    [%{kind: :baseline_body, ref: "as_1", complete?: true}]
  end

  def materials_for(_kind) do
    [%{kind: :target_structure, ref: "target_structure:test", complete?: true}]
  end
end
