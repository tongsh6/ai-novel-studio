defmodule NovelApplication.AutoMaintenanceConfig do
  @moduledoc """
  安全点自动维护的运维开关解析（VS-00L §16.16 第 2 类入口）。

  产品默认：生产开启（`config/config.exs`）、测试关闭（`config/test.exs`）。
  批次/运维可用环境变量 `NOVEL_AUTO_MAINTENANCE_ENABLED`（`true/false/1/0`）显式
  开启或关闭（关 = 回滚开关）；缺省或非法值保持 config 值。

  本模块只解析布尔开关，不读取任何验收/场景标识，属纯产品运行策略配置。
  """

  @doc """
  解析 `NOVEL_AUTO_MAINTENANCE_ENABLED`。

  返回 `true` / `false`；缺省（nil）或非法值返回 `:keep`（保持 config 值）。
  """
  @spec enabled_override(String.t() | nil | term()) :: boolean() | :keep
  def enabled_override(nil), do: :keep

  def enabled_override(value) when is_binary(value) do
    case value |> String.trim() |> String.downcase() do
      "true" -> true
      "1" -> true
      "false" -> false
      "0" -> false
      _other -> :keep
    end
  end

  def enabled_override(_other), do: :keep
end
