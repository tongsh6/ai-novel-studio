defmodule NovelApplication.AutoMaintenanceConfigTest do
  @moduledoc """
  `NOVEL_AUTO_MAINTENANCE_ENABLED` 运维开关解析：缺省/非法保持 config，
  显式 true/false/1/0 开启或关闭（回滚开关）。
  """

  use ExUnit.Case, async: true

  alias NovelApplication.AutoMaintenanceConfig

  test "缺省与非法值保持 config（产品默认不被意外改变）" do
    assert AutoMaintenanceConfig.enabled_override(nil) == :keep
    assert AutoMaintenanceConfig.enabled_override("") == :keep
    assert AutoMaintenanceConfig.enabled_override("maybe") == :keep
    assert AutoMaintenanceConfig.enabled_override("2") == :keep
    assert AutoMaintenanceConfig.enabled_override(:atom) == :keep
  end

  test "显式开启/关闭（运维与回滚开关）" do
    assert AutoMaintenanceConfig.enabled_override("true") == true
    assert AutoMaintenanceConfig.enabled_override("TRUE") == true
    assert AutoMaintenanceConfig.enabled_override("1") == true
    assert AutoMaintenanceConfig.enabled_override(" false ") == false
    assert AutoMaintenanceConfig.enabled_override("0") == false
  end
end
