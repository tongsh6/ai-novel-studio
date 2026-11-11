defmodule NovelFoundation do
  @moduledoc """
  Shared Kernel —— 项目内所有 app 共享的基础能力。

  本 app 是无业务语义的纯工具库。禁止包含：
  - OTP 进程（GenServer / Supervisor / Registry / DynamicSupervisor）
  - 业务概念（Workspace / Author / Agent / Work / Chapter）
  - 外部依赖（Ecto / Phoenix / Provider）

  需要时按 YAGNI 原则在此添加模块，不提前占位。
  """

  @cn_digits %{
    "一" => 1,
    "二" => 2,
    "两" => 2,
    "三" => 3,
    "四" => 4,
    "五" => 5,
    "六" => 6,
    "七" => 7,
    "八" => 8,
    "九" => 9
  }

  @doc """
  解析十进制或汉字序号（1–99，以及单字“百”）；无法解析返回 nil。

  只保留既有能力：汉字支持个位、十位与单字“百”，不扩展到百位以上组合。
  调用方负责先限定可接受的词法范围（如“第N段”），再在这里做唯一数字解读。
  """
  @spec parse_ordinal(String.t()) :: integer() | nil
  def parse_ordinal(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {n, ""} -> n
      _ -> chinese_ordinal(raw)
    end
  end

  def parse_ordinal(_raw), do: nil

  defp chinese_ordinal("十"), do: 10
  defp chinese_ordinal("百"), do: 100

  defp chinese_ordinal(raw) do
    case Regex.run(~r/^([一二三四五六七八九两]?)十([一二三四五六七八九]?)$/u, raw) do
      [_, tens, ones] ->
        if(tens == "", do: 1, else: Map.get(@cn_digits, tens, 1)) * 10 +
          if ones == "", do: 0, else: Map.get(@cn_digits, ones, 0)

      _ ->
        Map.get(@cn_digits, raw)
    end
  end
end
