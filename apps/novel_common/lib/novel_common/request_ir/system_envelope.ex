defmodule NovelCommon.RequestIR.SystemEnvelope do
  @moduledoc """
  canonical request IR 的 system 事实边界（VS-00L §3.2/§4、§19.1）。

  产品身份只认 `SystemIdentity` 真值；run 角色规则/输出协议与版本引用由调用方提供，
  由本模块的 `system_text/1` 形成稳定 system 前缀（2026-11-06 作者裁决 A）。wire
  投影属于 Provider 执行边界，只消费该稳定前缀。
  """

  alias NovelCommon.SystemIdentity

  @system_text_fields [
    :instructions,
    :run_role,
    :constitution_version,
    :output_protocol_version,
    :output_schema_ref
  ]

  @spec envelope(keyword()) :: map()
  def envelope(opts \\ []) do
    %{identity_ref: SystemIdentity.identity_ref()}
    |> put_optional(:run_role, Keyword.get(opts, :run_role))
    |> put_optional(:instructions, Keyword.get(opts, :instructions))
    |> put_optional(:constitution_version, Keyword.get(opts, :constitution_version))
    |> put_optional(:output_protocol_version, Keyword.get(opts, :output_protocol_version))
    |> put_optional(:output_schema_ref, Keyword.get(opts, :output_schema_ref))
  end

  @spec application_base_text() :: String.t()
  def application_base_text do
    "本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由本消息的结构化字段与后续 " <>
      "scope_update 给出；作者原话在独立 user 消息中。角色规则与输出协议见 system。"
  end

  @doc """
  稳定 system 前缀：产品身份 + 版本引用 + 本次运行角色规则。

  身份原文来自唯一来源 `SystemIdentity`；角色规则优先使用 canonical instructions，
  否则按 run_role 生成最小规则。IR 的 canonical messages 不插入 wire system 消息。
  """
  @spec system_text(map()) :: String.t()
  def system_text(system) when is_map(system) do
    [SystemIdentity.content(), version_lines(system), role_rules(system)]
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.join("\n\n")
  end

  def system_text(_system), do: SystemIdentity.content()

  # VS-00L §3.2/§4：宪法/输出协议版本引用进入稳定 system 前缀，值来自各自唯一真源。
  defp version_lines(system) do
    [
      version_line("constitution_version", system),
      version_line("output_protocol_version", system),
      version_line("output_schema_ref", system)
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
  end

  defp version_line(key, system) do
    case Map.get(system, String.to_existing_atom(key)) do
      value when is_binary(value) and value != "" -> "#{key}: #{value}"
      _ -> nil
    end
  end

  defp role_rules(system) do
    case Map.get(system, :instructions) do
      text when is_binary(text) and text != "" ->
        text

      _ ->
        role = Map.get(system, :run_role, "authoring_run")

        "run_role: #{role}\n" <>
          "你只能在作者授权边界内读取、计划、创作 tentative 候选、提问或报告缺口；" <>
          "不存在采纳/写入 canon 的工具。"
    end
  end

  @spec validate(map()) :: :ok | {:error, term()}
  def validate(system) when is_map(system) do
    if Map.get(system, :identity_ref) == SystemIdentity.identity_ref() do
      case Enum.find(@system_text_fields, &invalid_text_field?(system, &1)) do
        nil -> :ok
        field -> {:error, {:invalid_system_field, field}}
      end
    else
      {:error, :missing_system_identity_ref}
    end
  end

  def validate(_system), do: {:error, :missing_system_identity_ref}

  # 可选 system 事实存在时必须是非空文本；不存在表示该 run 不携带该事实。
  defp invalid_text_field?(system, field) do
    case Map.get(system, field) do
      nil -> false
      value when is_binary(value) -> String.trim(value) == ""
      _other -> true
    end
  end

  defp put_optional(map, _key, nil), do: map
  defp put_optional(map, key, value), do: Map.put(map, key, value)
end
