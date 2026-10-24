defmodule NovelApplication.ChapterDisplay do
  @moduledoc """
  B30 CP3-P（Q06/Q07）：章节展示口径的 application 单一 helper。

  - 身份 = chapter_ref；真实章号 = 当前 `seq`；`title` 仅展示。
  - 展示章号由当前 seq 生成；标题里历史的「第NN章：」前缀不参与身份/匹配，
    展示时剥掉前缀，避免与 seq 形成双重编号。
  - 不改写存储 title；历史原文/旧 trace 保留原样。
  """

  @prefix ~r/^\s*第\s*[0-9一二三四五六七八九十百千两]+\s*[章回节][:：\-—\s]*/u

  @doc "剥掉标题开头的历史章号前缀；无前缀时返回 trim 后的标题。"
  def core_title(title) when is_binary(title),
    do: title |> String.replace(@prefix, "", global: false) |> String.trim()

  def core_title(_title), do: ""

  @doc """
  展示标题：真实章号=当前 seq；历史 title 前缀仅在**与当前 seq 一致**时保留原文
  （避免给一致数据制造无意义 diff），不一致时剥掉旧编号、用当前 seq 重新生成。
  无 seq 时退回 core（无前缀原始标题）。
  """
  def display_title(chapter) when is_map(chapter) do
    seq = Map.get(chapter, :seq) || Map.get(chapter, "seq")
    title = to_string(Map.get(chapter, :title) || Map.get(chapter, "title") || "")

    display_title(seq, title, core_title(title), title_number(title))
  end

  def display_title(_chapter), do: ""

  defp display_title(seq, title, _core, embedded)
       when is_integer(seq) and is_integer(embedded) and embedded == seq and title != "",
       do: title

  defp display_title(seq, _title, core, _embedded) when is_integer(seq) and core != "",
    do: "第#{seq}章：#{core}"

  defp display_title(seq, _title, _core, _embedded) when is_integer(seq),
    do: "第#{seq}章"

  defp display_title(_seq, _title, core, _embedded), do: core

  @doc "作者原话/模型查询里的显式章号（第N章）；无则 nil。"
  def chapter_number(text) when is_binary(text) do
    case Regex.run(~r/第\s*(\d+)\s*章/u, text) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  def chapter_number(_text), do: nil

  @doc "标题内嵌历史章号（第NN章/第二章）；无则 nil。"
  def title_number(title) when is_binary(title) do
    case Regex.run(~r/^\s*第\s*([0-9]+|[一二三四五六七八九十百千两]+)\s*章/u, title) do
      [_, raw] -> parse_number(raw)
      _ -> nil
    end
  end

  def title_number(_title), do: nil

  defp parse_number(raw) do
    case Integer.parse(raw) do
      {n, ""} -> n
      _ -> chinese_number(raw)
    end
  end

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

  defp chinese_number("十"), do: 10
  defp chinese_number("百"), do: 100

  defp chinese_number(raw) do
    case Regex.run(~r/^([一二三四五六七八九两]?)十([一二三四五六七八九]?)$/u, raw) do
      [_, tens, ones] ->
        if(tens == "", do: 1, else: Map.get(@cn_digits, tens, 1)) * 10 +
          if ones == "", do: 0, else: Map.get(@cn_digits, ones, 0)

      _ ->
        Map.get(@cn_digits, raw)
    end
  end

  @doc """
  文本是否指向该章（仅用于人类可读的候选匹配，最终身份仍用 ref）。

  规则：文本显式 `第N章` 时按当前 seq 匹配（N==seq）；否则按展示标题/core title
  唯一包含匹配。历史标题前缀不参与匹配。
  """
  def text_matches?(chapter, text) when is_map(chapter) and is_binary(text) do
    case chapter_number(text) do
      number when is_integer(number) -> seq_matches_number?(chapter, number)
      nil -> title_mentions_chapter?(chapter, text)
    end
  end

  def text_matches?(_chapter, _text), do: false

  defp seq_matches_number?(chapter, number) do
    seq = Map.get(chapter, :seq) || Map.get(chapter, "seq")
    is_integer(seq) and seq == number
  end

  defp title_mentions_chapter?(chapter, text) do
    display = display_title(chapter)
    core = core_title(Map.get(chapter, :title) || Map.get(chapter, "title") || "")

    (display != "" and (String.contains?(text, display) or String.contains?(display, text))) or
      (String.length(core) >= 2 and String.contains?(text, core))
  end
end
