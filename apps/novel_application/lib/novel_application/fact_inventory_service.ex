defmodule NovelApplication.FactInventoryService do
  @moduledoc """
  设定盘点提炼引擎（VS-00G CP4b / §3.3）：读作品现状材料（正文/摘要）→ 模型提炼
  "事实上已存在"的设定 → 结构化提案（角色/世界规则/伏笔）。

  提炼可行性经 live 探针实证（`scripts/vs00g_inventory_probe.exs`，2026-07-23：
  真实 LM Studio 从百章标本正文提炼主角+配角+世界规则+伏笔全带依据章）。

  `provider_execution` 可注入（生产=真实 provider，测试=确定性提案）；坏 JSON 携带
  失败片段重试一次（与 Planner/CreativeProvider.Real 同模式，解 gpt-oss 偶发格式瑕疵）。
  Provider 直接返回既有 creative item canonical 字段（item_id/title/body/rationale），
  application 只按 artifact_type 分组，不修补创作字节（I1 因果绑定）。
  提案是 tentative 材料，落位走既有 seed 采纳边界（06 §4.5.2），本服务不写权威层。
  """

  alias NovelAgent.Provider.Execution
  alias NovelCommon.Contracts.ToolOutputContract
  alias NovelDomain.TentativeArtifactSet

  @type material_item :: %{seq: non_neg_integer(), title: String.t(), prose: String.t()}
  @type proposal :: %{
          characters: [map()],
          world_rules: [map()],
          foreshadowings: [map()],
          skeleton_suggestions: [map()]
        }

  @material_prose_clip 700
  @skeleton_fields ~w(target_length planned_volumes serial_form)

  @doc false
  def skeleton_fields, do: @skeleton_fields

  @doc """
  盘点提炼：材料 → 提案。`materials` 为 `[%{seq, title, prose}]`（application 装配
  时从章正文读端口读取并截断）。返回结构化提案或错误。
  """
  @spec inventory([material_item()], Execution.dependency(), keyword()) ::
          {:ok, proposal()} | {:error, term()}
  def inventory(materials, provider_execution, opts \\ []) when is_list(materials) do
    case inventory_with_meta(materials, provider_execution, opts) do
      {:ok, proposal, _meta} -> {:ok, proposal}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  与 `inventory/3` 相同，但同时返回本次提炼真实消耗的 provider 调用数。

  AgentRun 依赖此口径执行预算核算；首轮合法 JSON 为 1，坏 JSON 修正后成功为 2。

  `opts[:missing_skeleton_fields]`（VS-00G CP4d）：当前作品缺位的全书规划字段
  （target_length/planned_volumes/serial_form 子集）。非空时提炼额外产出
  `work_skeleton_suggestion` 建议（每字段一条，采纳=立项字段回写）；只建议
  缺位字段，不覆盖作者已立值。
  """
  @spec inventory_with_meta([material_item()], Execution.dependency(), keyword()) ::
          {:ok, proposal(), %{provider_call_count: pos_integer()}} | {:error, term()}
  def inventory_with_meta(materials, provider_execution, opts \\ []) when is_list(materials) do
    missing_fields = normalize_missing_fields(Keyword.get(opts, :missing_skeleton_fields, []))
    known_characters = normalize_known_characters(Keyword.get(opts, :known_characters, []))

    prompt =
      inventory_prompt(
        build_material_text(materials),
        length(materials),
        missing_fields,
        known_characters
      )

    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        do_extract(prompt, result_fn, _retry? = true, _attempt = 1)

      _ ->
        {:error, :provider_execution_missing}
    end
  end

  # 已在档角色名单（M4 实锤）：盘点材料此前只有正文，模型看不到档案已有谁，
  # 每次盘点都把已在档角色当「新发现」重提，采纳后堆出重复档案行。盘点的语义是
  # 补全缺口——已经有的不算缺口。
  defp normalize_known_characters(names) when is_list(names) do
    names
    |> Enum.map(fn
      name when is_binary(name) -> String.trim(name)
      %{} = character -> character |> Map.get(:name, Map.get(character, "name", "")) |> to_string() |> String.trim()
      other -> other |> to_string() |> String.trim()
    end)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp normalize_known_characters(_names), do: []

  defp normalize_missing_fields(fields) when is_list(fields) do
    fields
    |> Enum.map(&to_string/1)
    |> Enum.filter(&(&1 in @skeleton_fields))
    |> Enum.uniq()
  end

  defp normalize_missing_fields(_fields), do: []

  # 携带失败片段重试一次，再失败才报错（real.ex 坏 JSON 同模式）。
  defp do_extract(prompt, result_fn, retry?, attempt) do
    case result_fn.(prompt) do
      {:ok, %{content: content} = result} ->
        case parse_proposal(content, provider_call_ref(result)) do
          {:ok, proposal} ->
            {:ok, proposal, %{provider_call_count: attempt}}

          {:error, _} when retry? ->
            do_extract(correction_prompt(prompt, content), result_fn, false, attempt + 1)

          {:error, reason} ->
            {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  从 provider 原文解析提案。顶层是 canonical item 数组，每项用 `artifact_type`
  指向既有 seed 家族；title/body/rationale 原样保留，只补 provider_call_ref。
  """
  @spec parse_proposal(String.t()) :: {:ok, proposal()} | {:error, term()}
  def parse_proposal(content), do: parse_proposal(content, nil)

  @doc false
  @spec parse_proposal(String.t(), String.t() | nil) :: {:ok, proposal()} | {:error, term()}
  def parse_proposal(content, provider_call_ref) when is_binary(content) do
    with [json | _] <- Regex.run(~r/\[.*\]/su, content),
         {:ok, decoded} when is_list(decoded) <- Jason.decode(json),
         {:ok, grouped} <- validate_and_group(decoded, provider_call_ref) do
      {:ok, grouped}
    else
      nil -> {:error, :no_json}
      {:ok, _other} -> {:error, :invalid_proposal_shape}
      {:error, reason} -> {:error, reason}
    end
  end

  def parse_proposal(_content, _provider_call_ref), do: {:error, :invalid_content}

  @doc """
  把盘点提案按既有 seed 家族分成 TentativeArtifactSet。只分组并加运行期 envelope，
  item_id/title/body/rationale/provider_call_ref 原样保留，不生成新 artifact 类型。
  """
  @spec artifact_sets(proposal(), map()) :: [TentativeArtifactSet.t()]
  def artifact_sets(proposal, attrs) when is_map(proposal) and is_map(attrs) do
    [
      {:character_seed, Map.get(proposal, :characters, [])},
      {:world_rule_seed, Map.get(proposal, :world_rules, [])},
      {:foreshadowing_seed, Map.get(proposal, :foreshadowings, [])},
      {:work_skeleton_suggestion, Map.get(proposal, :skeleton_suggestions, [])}
    ]
    |> Enum.reject(fn {_type, items} -> items == [] end)
    |> Enum.map(fn {artifact_type, items} ->
      %TentativeArtifactSet{
        artifact_set_id: NovelFoundation.ID.unique("as_inventory"),
        artifact_type: artifact_type,
        items: items,
        source_turn_ref: Map.fetch!(attrs, :source_turn_ref),
        source_tool_result_ref: Map.fetch!(attrs, :source_tool_result_ref),
        context_refs: List.wrap(Map.get(attrs, :context_refs)),
        adoption_status: :tentative
      }
    end)
  end

  @doc false
  @spec build_material_text([material_item()]) :: String.t()
  def build_material_text(materials) do
    Enum.map_join(materials, "\n\n", fn %{seq: seq, title: title, prose: prose} ->
      "【第#{seq}章 #{title}】\n#{String.slice(to_string(prose), 0, @material_prose_clip)}"
    end)
  end

  @doc false
  @spec inventory_prompt(String.t(), non_neg_integer(), [String.t()], [String.t()]) :: String.t()
  def inventory_prompt(
        material_text,
        chapter_count,
        missing_skeleton_fields \\ [],
        known_characters \\ []
      ) do
    """
    你是小说设定盘点助手。下面是一部作品前 #{chapter_count} 章的正文摘录。请从正文中反向提炼出
    作品"事实上已经存在"的设定，整理成结构化提案供作者采纳登记。
    #{known_characters_section(known_characters)}
    要求：
    - 只提炼正文中实际出现的设定，不发明正文里没有的内容。
    - 主角：找出正文的核心视角人物/主角（可多个），narrative_role 取 PROTAGONIST/SUPPORTING/ANTAGONIST/MINOR 之一。
    - 世界规则：正文反复出现、支撑剧情的世界观规则或设定。
    - 伏笔：正文埋下但尚未回收的线索。
    - 每项标注依据（出现的章）。
    #{skeleton_prompt_section(missing_skeleton_fields)}
    只返回 JSON 数组，不要附加任何额外文字。每项必须包含：
    - "artifact_type"：只能是 character_seed / world_rule_seed / foreshadowing_seed#{skeleton_type_hint(missing_skeleton_fields)}
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：角色名、规则短名或伏笔短名
    - "body"：从正文提炼出的具体设定
    - "rationale"：依据章节；没有则 null
    - character_seed 另带 "narrative_role"：
      PROTAGONIST / SUPPORTING / ANTAGONIST / MINOR / ENSEMBLE_POV 之一

    示例形状：
    [
      {"artifact_type":"character_seed","item_id":"char_x","title":"人物名",
       "body":"人物设定","rationale":"依据第N章","narrative_role":"PROTAGONIST"},
      {"artifact_type":"world_rule_seed","item_id":"rule_x","title":"规则短名",
       "body":"规则内容","rationale":"依据第N章"},
      {"artifact_type":"foreshadowing_seed","item_id":"foreshadow_x","title":"伏笔短名",
       "body":"伏笔内容","rationale":"依据第N章"}#{skeleton_prompt_example(missing_skeleton_fields)}
    ]

    正文摘录：
    #{material_text}
    """
  end

  # 已在档角色段：盘点=补全缺口，已登记的角色不该被当成新发现重提（M4 实锤：
  # 同一主角被反复提案采纳，档案堆出 4 行重复）。同名不同人是创作判断，仍由
  # 采纳边界交作者裁决，此处只消除「系统自己制造的重复」。
  defp known_characters_section([]), do: ""

  defp known_characters_section(names) do
    """

    ## 作品档案中已登记的角色（不要重复提案）
    #{Enum.map_join(names, "、", & &1)}

    上列角色已在档案中，**不要再作为新角色提案**。如果正文里有关于他们的重要新信息，
    也不要重复提交同名角色——本次只提案档案中尚未登记的角色。
    """
  end

  # 全书规划建议指令段（VS-00G CP4d）：只在存在缺位字段时出现，且只列缺位字段——
  # 作者已立的规划值不重复建议、不覆盖。
  defp skeleton_prompt_section([]), do: ""

  defp skeleton_prompt_section(missing_fields) do
    field_lines =
      Enum.map_join(missing_fields, "\n", fn
        "target_length" ->
          "  - target_length：目标总字数（正整数，skeleton_value 填数字）"

        "planned_volumes" ->
          "  - planned_volumes：预计卷数（正整数，skeleton_value 填数字）"

        "serial_form" ->
          "  - serial_form：连载形态（如 连载 / 买断 / 短篇集，skeleton_value 填文本）"
      end)

    """
    - 全书规划：这本书还没有登记以下规划字段。请按已写正文的体量、节奏和结构推断合理值，
      每个字段产出一条 work_skeleton_suggestion（不要建议下面列表以外的字段）：
    #{field_lines}
      每条另带 "skeleton_field"（字段名）与 "skeleton_value"（建议值）；title 用字段的
      中文名（目标体量/预计卷数/连载形态），body 写建议值与推断说明。
    """
  end

  defp skeleton_type_hint([]), do: ""
  defp skeleton_type_hint(_missing_fields), do: " / work_skeleton_suggestion"

  defp skeleton_prompt_example([]), do: ""

  defp skeleton_prompt_example(_missing_fields) do
    """
    ,
      {"artifact_type":"work_skeleton_suggestion","item_id":"skeleton_target_length",
       "title":"目标体量","body":"按已写节奏推断全书约 30 万字","rationale":"依据前 N 章体量",
       "skeleton_field":"target_length","skeleton_value":300000}
    """
    |> String.trim_trailing()
  end

  defp correction_prompt(original_prompt, failed_content) do
    """
    你上一次的输出不是合法 JSON 提案。请严格重新输出一个 JSON 数组；每项都要带
    artifact_type / item_id / title / body / rationale，不要输出 JSON 以外的任何文字。

    #{original_prompt}

    上次的错误输出（供参考，请修正为合法 JSON）：
    #{String.slice(failed_content, 0, 500)}
    """
  end

  defp validate_and_group(decoded, provider_call_ref) do
    decoded
    |> Enum.reduce_while(
      %{characters: [], world_rules: [], foreshadowings: [], skeleton_suggestions: []},
      fn raw, grouped ->
        with {:ok, bucket} <- proposal_bucket(raw),
             {:ok, [item]} <- ToolOutputContract.validate_creative_items([raw]),
             {:ok, item} <- ensure_skeleton_slots(bucket, item) do
          item = maybe_put_provider_call_ref(item, provider_call_ref)
          {:cont, Map.update!(grouped, bucket, &(&1 ++ [item]))}
        else
          {:error, reason} -> {:halt, {:error, reason}}
        end
      end
    )
    |> case do
      {:error, _reason} = error ->
        error

      %{characters: [], world_rules: [], foreshadowings: [], skeleton_suggestions: []} ->
        {:error, :empty_proposal}

      grouped ->
        {:ok, grouped}
    end
  end

  # 全书规划建议必须带合法结构化槽位（字段名+可落库的值），否则视为坏输出走重试——
  # 不静默丢弃、不代模型补值（I1：结构化槽位与创作字节同样不修补）。
  defp ensure_skeleton_slots(:skeleton_suggestions, item) do
    if is_binary(Map.get(item, :skeleton_field)) and Map.has_key?(item, :skeleton_value) do
      {:ok, item}
    else
      {:error, :invalid_skeleton_suggestion}
    end
  end

  defp ensure_skeleton_slots(_bucket, item), do: {:ok, item}

  @proposal_buckets %{
    "character_seed" => :characters,
    "world_rule_seed" => :world_rules,
    "foreshadowing_seed" => :foreshadowings,
    "work_skeleton_suggestion" => :skeleton_suggestions
  }

  defp proposal_bucket(raw) when is_map(raw) do
    type = Map.get(raw, "artifact_type") || Map.get(raw, :artifact_type)

    case Map.fetch(@proposal_buckets, to_string(type || "")) do
      {:ok, bucket} -> {:ok, bucket}
      :error -> {:error, {:unsupported_inventory_artifact_type, type}}
    end
  end

  defp proposal_bucket(_raw), do: {:error, :invalid_inventory_item}

  defp provider_call_ref(result) when is_map(result) do
    Map.get(result, :provider_call_ref) || Map.get(result, "provider_call_ref") ||
      Map.get(result, :provider_call_id) || Map.get(result, "provider_call_id")
  end

  defp provider_call_ref(_result), do: nil

  defp maybe_put_provider_call_ref(item, ref) when is_binary(ref),
    do: Map.put(item, :provider_call_ref, ref)

  defp maybe_put_provider_call_ref(item, _ref), do: item
end
