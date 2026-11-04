defmodule NovelAgent.Provider.RequestIR.Projection do
  @moduledoc """
  B71 CP2：Request IR v1 → Provider HTTP body 的投影入口（VS-00L §6）。

  规则（VS-00L §6.4）：
  - 投影无损；能力不足必须显式 `finite_mode` 或 `reject`，不得静默丢字段后宣称完整 AgentRun。
  - Provider 私有回放状态不进入 run 事实或默认 wire；只有来源 adapter 可按来源绑定回投。
  - `tentative_artifact` / `author_exit` 是应用侧事实，不直接投影为 provider 消息；
    其 refs 由 application_base 的 base_refs 承载（VS-00L §3.5/G4）。
  """

  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.SystemIdentity

  @targets %{
    "chat_completions" => NovelAgent.Provider.RequestIR.Projection.ChatCompletions,
    "anthropic_messages" => NovelAgent.Provider.RequestIR.Projection.AnthropicMessages,
    "responses_api" => NovelAgent.Provider.RequestIR.Projection.ResponsesAPI
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
  稳定 system 前缀：现有产品身份 + 本次运行角色规则。

  身份原文来自唯一来源 `SystemIdentity`；角色规则优先使用 canonical instructions，
  否则按 run_role 生成最小规则。IR 的 canonical messages 不插入 wire system 消息。
  """
  def system_text(system) when is_map(system) do
    role_rules =
      case Map.get(system, :instructions) do
        text when is_binary(text) and text != "" ->
          text

        _ ->
          role = Map.get(system, :run_role, "authoring_run")

          "run_role: #{role}\n" <>
            "你只能在作者授权边界内读取、计划、创作 tentative 候选、提问或报告缺口；" <>
            "不存在采纳/写入 canon 的工具。"
      end

    SystemIdentity.content() <> "\n\n" <> role_rules
  end

  def system_text(_system), do: SystemIdentity.content()

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

  @doc """
  统一 JSON 值边界：对象键规范为字符串，数组逐项保留，标量/结构体原样传递。

  opaque observation content/coverage、工具参数与版本数据只在 producer 与
  序列化边界经过这里；恢复不再把领域键误认为 canonical 结构键。
  """
  @spec json_value(term()) :: term()
  def json_value(%_{} = struct), do: struct

  def json_value(value) when is_map(value),
    do: Map.new(value, fn {key, item} -> {json_key(key), json_value(item)} end)

  def json_value(value) when is_list(value), do: Enum.map(value, &json_value/1)
  def json_value(value), do: value

  defp json_key(key) when is_atom(key), do: Atom.to_string(key)
  defp json_key(key) when is_binary(key), do: key
  defp json_key(key) when is_integer(key), do: Integer.to_string(key)
  defp json_key(key) when is_float(key), do: :erlang.float_to_binary(key, [:compact])
  defp json_key(key), do: key

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
