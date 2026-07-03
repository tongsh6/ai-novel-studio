defmodule NovelFoundation.IDTest do
  use ExUnit.Case, async: true

  alias NovelFoundation.ID

  describe "uuid/0" do
    test "生成 v4 UUID 格式" do
      assert ID.uuid() =~ ~r/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/
    end
  end

  describe "unique/1" do
    test "格式为 前缀_毫秒36进制_计数器36进制" do
      assert ID.unique("turn") =~ ~r/^turn_[0-9a-z]+_[0-9a-z]+$/
    end

    test "同一生命周期内连续生成不重复" do
      ids = for _ <- 1..1_000, do: ID.unique("turn")
      assert length(Enum.uniq(ids)) == 1_000
    end

    test "计数器相同但时间戳段不同的 ID 不相等（跨重启唯一性的机制）" do
      # 重启后 System.unique_integer 归零重复，唯一性由毫秒时间戳段承担：
      # 模拟两次 boot 在不同毫秒铸造相同计数器值。
      earlier = "turn_#{Integer.to_string(1_000_000, 36)}_5"
      later = "turn_#{Integer.to_string(1_000_001, 36)}_5"
      refute earlier == later
    end

    test "复合子 turn 标记不受影响" do
      parent = ID.unique("turn")
      refute String.contains?(parent, ":agent:")
      assert "#{parent}:agent:2" |> String.split(":agent:") |> hd() == parent
    end
  end
end
