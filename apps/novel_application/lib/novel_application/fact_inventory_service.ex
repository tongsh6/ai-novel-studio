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
          foreshadowings: [map()]
        }

  @material_prose_clip 700

  @doc """
  盘点提炼：材料 → 提案。`materials` 为 `[%{seq, title, prose}]`（application 装配
  时从章正文读端口读取并截断）。返回结构化提案或错误。
  """
  @spec inventory([material_item()], Execution.dependency()) ::
          {:ok, proposal()} | {:error, term()}
  def inventory(materials, provider_execution) when is_list(materials) do
    case inventory_with_meta(materials, provider_execution) do
      {:ok, proposal, _meta} -> {:ok, proposal}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  与 `inventory/2` 相同，但同时返回本次提炼真实消耗的 provider 调用数。

  AgentRun 依赖此口径执行预算核算；首轮合法 JSON 为 1，坏 JSON 修正后成功为 2。
  """
  @spec inventory_with_meta([material_item()], Execution.dependency()) ::
          {:ok, proposal(), %{provider_call_count: pos_integer()}} | {:error, term()}
  def inventory_with_meta(materials, provider_execution) when is_list(materials) do
    prompt = inventory_prompt(build_material_text(materials), length(materials))

    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        do_extract(prompt, result_fn, _retry? = true, _attempt = 1)

      _ ->
        {:error, :provider_execution_missing}
    end
  end

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
      {:foreshadowing_seed, Map.get(proposal, :foreshadowings, [])}
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
  @spec inventory_prompt(String.t(), non_neg_integer()) :: String.t()
  def inventory_prompt(material_text, chapter_count) do
    """
    你是小说设定盘点助手。下面是一部作品前 #{chapter_count} 章的正文摘录。请从正文中反向提炼出
    作品"事实上已经存在"的设定，整理成结构化提案供作者采纳登记。

    要求：
    - 只提炼正文中实际出现的设定，不发明正文里没有的内容。
    - 主角：找出正文的核心视角人物/主角（可多个），narrative_role 取 PROTAGONIST/SUPPORTING/ANTAGONIST/MINOR 之一。
    - 世界规则：正文反复出现、支撑剧情的世界观规则或设定。
    - 伏笔：正文埋下但尚未回收的线索。
    - 每项标注依据（出现的章）。

    只返回 JSON 数组，不要附加任何额外文字。每项必须包含：
    - "artifact_type"：只能是 character_seed / world_rule_seed / foreshadowing_seed
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
       "body":"伏笔内容","rationale":"依据第N章"}
    ]

    正文摘录：
    #{material_text}
    """
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
      %{characters: [], world_rules: [], foreshadowings: []},
      fn raw, grouped ->
        with {:ok, bucket} <- proposal_bucket(raw),
             {:ok, [item]} <- ToolOutputContract.validate_creative_items([raw]) do
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

      %{characters: [], world_rules: [], foreshadowings: []} ->
        {:error, :empty_proposal}

      grouped ->
        {:ok, grouped}
    end
  end

  defp proposal_bucket(raw) when is_map(raw) do
    case Map.get(raw, "artifact_type") || Map.get(raw, :artifact_type) do
      "character_seed" -> {:ok, :characters}
      :character_seed -> {:ok, :characters}
      "world_rule_seed" -> {:ok, :world_rules}
      :world_rule_seed -> {:ok, :world_rules}
      "foreshadowing_seed" -> {:ok, :foreshadowings}
      :foreshadowing_seed -> {:ok, :foreshadowings}
      other -> {:error, {:unsupported_inventory_artifact_type, other}}
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
