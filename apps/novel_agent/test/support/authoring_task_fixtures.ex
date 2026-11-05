defmodule NovelAgent.TestSupport.AuthoringTaskFixtures do
  @moduledoc """
  CP3d 测试用 AuthoringTask fixture（不依赖 application builder；agent app 独立）。

  角色/设定/大纲的 output_contract.artifact_type 与运行时 ToolOutputContract 校验同源。
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.RequestIR.Projection
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask

  def provider_execution(result_fn, tool_name) do
    %Execution{
      result_fn: fn prompt ->
        prompt
        |> prompt_text()
        |> result_fn.()
        |> native_response(tool_name)
      end
    }
  end

  def prompt_text(prompt) when is_binary(prompt), do: prompt

  # 离线替身看到的材料与真实模型在 wire 上收到的同形：文本块按原字节读，
  # 工具调用、观察与校验结果按结构化 block 的 JSON 读（tool result 的真实形状），
  # 不从拼接文本猜测。
  def prompt_text(%RequestIR{messages: messages, tools: tools} = ir) do
    # 离线替身看到的材料与真实模型在 wire 上收到的同形：稳定 system 前缀（身份/版本/
    # 角色规则）+ canonical 消息材料 + 工具结构（2026-11-06 裁决 A：规则进入 system）。
    messages_text =
      Enum.map_join(messages, "\n", fn message ->
        Enum.map_join(message.blocks, "\n", &render_block/1) <>
          "\n关联：" <> linked_call_ids(message.blocks)
      end)

    [Projection.system_text(ir.system), messages_text, "工具结构：" <> Jason.encode!(tools)]
    |> Enum.join("\n")
  end

  defp render_block(%{type: "text", text: text}) when is_binary(text), do: text

  defp render_block(block) do
    case Jason.encode(block) do
      {:ok, json} -> json
      _ -> inspect(block)
    end
  end

  defp linked_call_ids(blocks) do
    blocks
    |> Enum.map(&Map.get(&1, :call_id))
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
    |> Enum.join(",")
  end

  defp native_response({:ok, result}, tool_name) when is_map(result) do
    content = Map.get(result, :content) || Map.get(result, "content")

    if is_binary(content) and Map.get(result, :tool_calls) in [nil, []] do
      arguments =
        case {Jason.decode(content), tool_name} do
          {{:ok, decoded}, _} when is_map(decoded) ->
            decoded

          {{:ok, decoded}, "submit_tentative_artifact"} when is_list(decoded) ->
            %{items: decoded}

          {{:ok, decoded}, "report_quality_findings"} when is_list(decoded) ->
            %{findings: decoded}

          _ ->
            content
        end

      {:ok,
       result
       |> Map.put(:tool_calls, [%{id: "fixture-native-1", name: tool_name, arguments: arguments}])}
    else
      {:ok, result}
    end
  end

  defp native_response(other, _tool_name), do: other

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
