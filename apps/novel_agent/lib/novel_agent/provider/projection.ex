defmodule NovelAgent.Provider.Projection do
  @moduledoc """
  B71 CP2：Request IR v1 → Provider HTTP body 的投影入口（VS-00L §6）。

  规则（VS-00L §6.4）：
  - 投影无损；能力不足必须显式 `finite_mode` 或 `reject`，不得静默丢字段后宣称完整 AgentRun。
  - Provider 私有回放状态不进入 run 事实或默认 wire；只有来源 adapter 可按来源绑定回投。
  - `tentative_artifact` / `author_exit` 是应用侧事实，不直接投影为 provider 消息；
    其 refs 由 application_base 的 base_refs 承载（VS-00L §3.5/G4）。
  """

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.SystemEnvelope

  @targets %{
    "chat_completions" => NovelAgent.Provider.Projection.ChatCompletions,
    "anthropic_messages" => NovelAgent.Provider.Projection.AnthropicMessages,
    "responses_api" => NovelAgent.Provider.Projection.ResponsesAPI
  }

  @doc """
  按实际 adapter 的 wire 目标显式投影；target 由 adapter state 决定，不做默认 route 查询。
  """
  @spec project(RequestIR.t(), String.t(), keyword()) ::
          {:ok, map()} | {:error, term()}
  def project(ir, target, opts \\ [])

  def project(%RequestIR{} = ir, target, opts) do
    module = Map.fetch!(@targets, target)

    case module.project(ir, opts) do
      {:error, _reason} = error -> error
      body when is_map(body) -> {:ok, body}
    end
  end

  # ── 投影公共语义（三个 provider 共用，不改变字节/顺序）────────────────────────

  @doc """
  稳定 system 前缀；唯一实现在 `NovelCommon.RequestIR.SystemEnvelope.system_text/1`。

  wire 投影只消费 canonical system 事实，不在投影层重写身份、规则或版本。
  """
  defdelegate system_text(system), to: SystemEnvelope

  @doc "拼接消息中的文本块（作者消息保持原字节；不插入分隔符）。"
  def text_of(blocks) when is_list(blocks) do
    blocks
    |> Enum.filter(&(Map.get(&1, :type) == "text"))
    |> Enum.map_join("", &Map.get(&1, :text, ""))
  end

  def text_of(_blocks), do: ""

  @doc "非作者消息投影时的 provenance 标记（VS-00L §6.1：作者原话永远独立）。"
  def provenance_header(kind), do: "【应用数据 · #{kind} · 非作者原话】\n"

  @doc "所有 Provider 共用的版本化 scope 文本；旧版本仅作为历史证据。"
  def scope_update_text(message) do
    "【应用数据 · scope_update · 以最新版本为准】\n" <>
      "版本：" <>
      Jason.encode!(json_value(Map.get(message, :versions, %{}))) <>
      "\n" <> text_of(Map.get(message, :blocks, []))
  end

  @doc """
  压缩 checkpoint 投影文本：显式携带覆盖范围与省略声明（I-ART-7），
  不把不可见截断当成正常历史。
  """
  def checkpoint_text(blocks) when is_list(blocks) do
    case Enum.find(blocks, &(Map.get(&1, :type) == "checkpoint")) do
      nil ->
        text_of(blocks)

      block ->
        covers = block |> Map.fetch!(:covers) |> json_value() |> Jason.encode!()

        omissions =
          case Map.get(block, :omissions, []) do
            [] -> ""
            list -> "省略：" <> Enum.join(list, "; ") <> "\n"
          end

        evidence =
          "来源：" <>
            Jason.encode!(json_value(Map.get(block, :source_refs, []))) <>
            "\n版本：" <>
            Jason.encode!(json_value(Map.get(block, :versions, %{}))) <> "\n"

        "【应用数据 · checkpoint · 覆盖 #{covers}】\n" <>
          evidence <> omissions <> Map.get(block, :summary, "")
    end
  end

  def checkpoint_text(_blocks), do: ""

  @doc "observation/validation 的 content 投影：类型、status、refs 与版本均可辨识。"
  def structured_content(block), do: Jason.encode!(json_value(block))

  @doc "IR 的 JSON 值边界；单一实现在 `RequestIR.json_value/1`，投影不复制。"
  defdelegate json_value(value), to: RequestIR

  def usage_streaming?(ir), do: Map.get(ir.projection, :usage_streaming, false) == true

  def tool_name(tool), do: Map.get(tool, :name) || Map.get(tool, "name")

  def tool_description(tool) do
    to_string(Map.get(tool, :description) || Map.get(tool, "description") || "")
  end

  def tool_schema(tool) do
    (Map.get(tool, :input_schema) || Map.get(tool, "input_schema") || %{})
    |> json_value()
  end
end
