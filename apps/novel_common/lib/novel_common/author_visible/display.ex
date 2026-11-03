defmodule NovelCommon.AuthorVisible.Display do
  @moduledoc """
  作者可见展示名的唯一查询入口（VS-00L / 47 §2.2–§2.3）。

  数据来源是 codegen 生成的 `NovelCommon.AuthorVisible.DisplayNames`（SSOT：
  `docs/design/schemas/author_visible/display_names.json`）。作者可见面不得直接
  拼接内部 code；本模块对未登记 code 返回作者安全的 domain 兜底文案，**绝不返回
  内部 code 本身**。

  新增 tool/status/provider/model/artifact_type/action/error/frame 时只改 SSOT，
  然后重新生成两端（缺登记会让生成失败）。
  """

  alias NovelCommon.AuthorVisible.DisplayNames

  @type kind ::
          :tool
          | :capability
          | :status
          | :run_status
          | :provider
          | :model
          | :artifact_type
          | :action
          | :error_code
          | :frame_type
          | :reason_code
          | :gate
          | String.t()

  @doc "作者可见显示名；未登记 code 返回 domain 兜底文案（不返回 code）。"
  @spec label(kind(), term()) :: String.t()
  def label(kind, code) do
    kind = normalize_kind(kind)
    code = normalize_code(code)

    case get_in(DisplayNames.domains(), [kind, code]) do
      text when is_binary(text) and text != "" -> text
      _other -> fallback(kind)
    end
  end

  @doc "按给定顺序拼接多个 code 的显示名（顿号分隔）；空列表返回空串。"
  @spec labels(kind(), [term()]) :: String.t()
  def labels(kind, codes) when is_list(codes) do
    codes
    |> Enum.map(&label(kind, &1))
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("、")
  end

  @doc "domain 兜底文案（作者安全，不含内部 code）。"
  @spec fallback(kind()) :: String.t()
  def fallback(kind) do
    case Map.get(DisplayNames.fallbacks(), normalize_kind(kind)) do
      text when is_binary(text) and text != "" -> text
      _other -> "处理中"
    end
  end

  @doc "该 domain 是否登记了 code（供内部判断 / 测试使用，不用于作者可见决策）。"
  @spec known?(kind(), term()) :: boolean()
  def known?(kind, code) do
    case get_in(DisplayNames.domains(), [normalize_kind(kind), normalize_code(code)]) do
      text when is_binary(text) and text != "" -> true
      _other -> false
    end
  end

  @doc "已绑定的 domain 列表（SSOT 中出现的全部 domain）。"
  @spec kinds() :: [String.t()]
  def kinds, do: DisplayNames.domains() |> Map.keys() |> Enum.sort()

  @doc "作者可见禁止 token（协议 code / 内部术语 / 内部标识 / ref 模式 / 白名单）。"
  @spec forbidden_tokens() :: %{String.t() => [String.t()]}
  def forbidden_tokens, do: DisplayNames.forbidden_tokens()

  @doc "SSOT 内容哈希；前后端生成物必须一致。"
  @spec source_hash() :: String.t()
  def source_hash, do: DisplayNames.source_hash()

  defp normalize_kind(kind) when is_atom(kind), do: Atom.to_string(kind)
  defp normalize_kind(kind) when is_binary(kind), do: kind
  defp normalize_kind(_kind), do: "unknown"

  defp normalize_code(code) when is_binary(code), do: code
  defp normalize_code(code) when is_atom(code) and not is_nil(code), do: Atom.to_string(code)
  defp normalize_code(_code), do: ""
end
