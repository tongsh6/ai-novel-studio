defmodule NovelFoundation.ID do
  @moduledoc """
  唯一 ID 生成。

  Phase 0：随机 hex + 简单 UUID 格式。
  """

  @doc "生成一个 v4 UUID 格式字符串。"
  @spec uuid() :: String.t()
  def uuid do
    hex = :crypto.strong_rand_bytes(16) |> Base.encode16(case: :lower)

    # 8-4-4-4-12 UUID 格式，version 4
    <<p1::binary-size(8), p2::binary-size(4), _v::binary-size(1), p3::binary-size(3),
      p4::binary-size(1), p5::binary-size(3), p6::binary-size(12)>> = hex

    "#{p1}-#{p2}-4#{p3}-8#{p4}#{p5}-#{p6}"
  end
end
