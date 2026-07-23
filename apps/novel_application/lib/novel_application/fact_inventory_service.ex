defmodule NovelApplication.FactInventoryService do
  @moduledoc """
  设定盘点提炼引擎（VS-00G CP4b / §3.3）：读作品现状材料（正文/摘要）→ 模型提炼
  "事实上已存在"的设定 → 结构化提案（角色/世界规则/伏笔）。

  提炼可行性经 live 探针实证（`scripts/vs00g_inventory_probe.exs`，2026-07-23：
  真实 LM Studio 从百章标本正文提炼主角+配角+世界规则+伏笔全带依据章）。

  `provider_execution` 可注入（生产=真实 provider，测试=确定性提案）；坏 JSON 携带
  失败片段重试一次（与 Planner/CreativeProvider.Real 同模式，解 gpt-oss 偶发格式瑕疵）。
  提案是 tentative 材料，落位走既有 seed 采纳边界（06 §4.5.2），本服务不写权威层。
  """

  alias NovelAgent.Provider.Execution

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
    prompt = inventory_prompt(build_material_text(materials), length(materials))

    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        do_extract(prompt, result_fn, _retry? = true)

      _ ->
        {:error, :provider_execution_missing}
    end
  end

  # 携带失败片段重试一次，再失败才报错（real.ex 坏 JSON 同模式）。
  defp do_extract(prompt, result_fn, retry?) do
    case result_fn.(prompt) do
      {:ok, %{content: content}} ->
        case parse_proposal(content) do
          {:ok, proposal} ->
            {:ok, proposal}

          {:error, _} when retry? ->
            do_extract(correction_prompt(prompt, content), result_fn, false)

          {:error, reason} ->
            {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc "从 provider 原文解析提案（宽松抽 JSON 对象；缺字段补空列表）。"
  @spec parse_proposal(String.t()) :: {:ok, proposal()} | {:error, term()}
  def parse_proposal(content) when is_binary(content) do
    with [json | _] <- Regex.run(~r/\{.*\}/su, content),
         {:ok, decoded} <- Jason.decode(json) do
      {:ok,
       %{
         characters: List.wrap(decoded["characters"]),
         world_rules: List.wrap(decoded["world_rules"]),
         foreshadowings: List.wrap(decoded["foreshadowings"])
       }}
    else
      nil -> {:error, :no_json}
      {:error, reason} -> {:error, reason}
    end
  end

  def parse_proposal(_content), do: {:error, :invalid_content}

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

    只返回 JSON 对象，不要附加任何额外文字：
    {
      "characters": [{"name": "", "narrative_role": "", "summary": "", "basis": "第N章"}],
      "world_rules": [{"rule": "", "basis": "第N章"}],
      "foreshadowings": [{"content": "", "basis": "第N章"}]
    }

    正文摘录：
    #{material_text}
    """
  end

  defp correction_prompt(original_prompt, failed_content) do
    """
    你上一次的输出不是合法 JSON。请严格重新输出一个 JSON 对象（含 characters / world_rules /
    foreshadowings 三个数组），不要输出 JSON 以外的任何文字。

    #{original_prompt}

    上次的错误输出（供参考，请修正为合法 JSON）：
    #{String.slice(failed_content, 0, 500)}
    """
  end
end
