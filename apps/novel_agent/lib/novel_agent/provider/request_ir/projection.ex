defmodule NovelAgent.Provider.RequestIR.Projection do
  @moduledoc """
  B71 CP2：Request IR v1 → Provider HTTP body 的投影入口（VS-00L §6）。

  规则（VS-00L §6.4）：
  - 投影无损；能力不足必须显式 `finite_mode` 或 `reject`，不得静默丢字段后宣称完整 AgentRun。
  - Provider 私有字段只允许出现在 `provider_session` / `projection`，不进入 run 事实。
  - `tentative_artifact` / `author_exit` 是应用侧事实，不直接投影为 provider 消息；
    其 refs 由 application_base 的 base_refs 承载（VS-00L §3.5/G4）。
  """

  alias NovelAgent.Provider.RequestIR

  @targets %{
    "chat_completions" => NovelAgent.Provider.RequestIR.Projection.ChatCompletions,
    "anthropic_messages" => NovelAgent.Provider.RequestIR.Projection.AnthropicMessages,
    "responses_api" => NovelAgent.Provider.RequestIR.Projection.ResponsesAPI
  }

  @spec project(RequestIR.t()) ::
          {:ok, map()} | {:finite_mode, map(), map()} | {:error, term()}
  def project(%RequestIR{} = ir) do
    with :ok <- RequestIR.validate(ir) do
      target = get_in(ir.projection, [:target])
      module = Map.get(@targets, target)
      missing = RequestIR.missing_capabilities(Map.get(ir.projection, :capability_profile, %{}))
      body = module.project(ir)

      cond do
        missing == [] ->
          {:ok, body}

        finite_mode = Map.get(ir.projection, :finite_mode) ->
          {:finite_mode, body, %{missing: missing, finite_mode: finite_mode}}

        true ->
          {:error, {:unsupported_capability, missing}}
      end
    end
  end

  def project(other), do: {:error, {:invalid_ir, other}}

  # ── 投影公共语义（三个 provider 共用，不改变字节/顺序）────────────────────────

  @doc "稳定 system 文本：identity + 宪法/输出协议（可用 instructions 覆盖）。"
  def system_text(system) when is_map(system) do
    case Map.get(system, :instructions) do
      text when is_binary(text) and text != "" ->
        text

      _ ->
        identity = Map.get(system, :identity_ref, "identity:default")
        role = Map.get(system, :run_role, "authoring_run")

        "identity_ref: #{identity}\nrun_role: #{role}\n" <>
          "你只能在作者授权边界内读取、计划、创作 tentative 候选、提问或报告缺口；" <>
          "不存在采纳/写入 canon 的工具。"
    end
  end

  def system_text(_system), do: ""

  @doc "拼接消息中的文本块（作者消息保持原字节；不插入分隔符）。"
  def text_of(blocks) when is_list(blocks) do
    blocks
    |> Enum.filter(&(Map.get(&1, :type) == "text"))
    |> Enum.map_join("", &Map.get(&1, :text, ""))
  end

  def text_of(_blocks), do: ""

  @doc "非作者消息投影时的 provenance 标记（VS-00L §6.1：作者原话永远独立）。"
  def provenance_header(kind), do: "【应用数据 · #{kind} · 非作者原话】\n"

  @doc """
  压缩 checkpoint 投影文本：显式携带覆盖范围与省略声明（I-ART-7），
  不把不可见截断当成正常历史。
  """
  def checkpoint_text(blocks) when is_list(blocks) do
    case Enum.find(blocks, &(Map.get(&1, :type) == "checkpoint")) do
      nil ->
        text_of(blocks)

      block ->
        covers = get_in(block, [:covers, :turn_range]) || "unknown"

        omissions =
          case Map.get(block, :omissions, []) do
            [] -> ""
            list -> "省略：" <> Enum.join(list, "; ") <> "\n"
          end

        "【应用数据 · checkpoint · 覆盖 #{covers}】\n" <> omissions <> Map.get(block, :summary, "")
    end
  end

  def checkpoint_text(_blocks), do: ""

  @doc "observation/validation 的 content 投影：JSON 文本，保留 status/refs/版本。"
  def structured_content(block) do
    block
    |> Map.drop([:type])
    |> Jason.encode!()
  end

  def usage_streaming?(ir), do: Map.get(ir.projection, :usage_streaming, false) == true

  def tool_name(tool), do: Map.get(tool, :name) || Map.get(tool, "name")

  def tool_description(tool) do
    to_string(Map.get(tool, :description) || Map.get(tool, "description") || "")
  end

  def tool_schema(tool) do
    Map.get(tool, :input_schema) || Map.get(tool, "input_schema") || %{}
  end
end
