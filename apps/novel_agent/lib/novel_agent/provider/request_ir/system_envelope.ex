defmodule NovelAgent.Provider.RequestIR.SystemEnvelope do
  @moduledoc """
  canonical request IR 的 system 事实边界（VS-00L §3.2/§4、§19.1）。

  产品身份只认 `SystemIdentity` 真值；run 角色规则/输出协议与版本引用由调用方提供，
  投影时由 `Projection.system_text/1` 形成稳定 system 前缀（2026-11-06 作者裁决 A）。
  """

  alias NovelAgent.Provider.SystemIdentity

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
