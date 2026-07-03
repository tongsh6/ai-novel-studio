defmodule NovelFoundation.ID do
  @moduledoc """
  唯一 ID 生成。

  Phase 0：随机 hex + 简单 UUID 格式。
  """

  @doc "生成一个 v4 UUID 格式字符串。"
  @spec uuid() :: String.t()
  def uuid do
    hex = :crypto.strong_rand_bytes(16) |> Base.encode16(case: :lower)

    <<p1::binary-size(8), p2::binary-size(4), _v::binary-size(1), p3::binary-size(3),
      _variant::binary-size(1), p4::binary-size(3), p5::binary-size(12)>> = hex

    "#{p1}-#{p2}-4#{p3}-8#{p4}-#{p5}"
  end

  @doc """
  生成带前缀的全局唯一短 ID：`<prefix>_<毫秒时间戳36进制>_<进程计数器36进制>`。

  `System.unique_integer` 只在单次 BEAM 生命周期内唯一，重启后从头计数；
  毫秒时间戳段保证跨重启不重复。会被持久化、或用于会话恢复关联的 ID
  （turn/run/trace/mutation 等）必须经此生成，不得裸用 `System.unique_integer`。
  """
  @spec unique(String.t()) :: String.t()
  def unique(prefix) when is_binary(prefix) do
    millis = System.system_time(:millisecond) |> Integer.to_string(36) |> String.downcase()

    counter =
      System.unique_integer([:positive, :monotonic]) |> Integer.to_string(36) |> String.downcase()

    "#{prefix}_#{millis}_#{counter}"
  end
end
