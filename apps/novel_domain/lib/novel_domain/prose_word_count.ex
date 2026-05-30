defmodule NovelDomain.ProseWordCount do
  @moduledoc """
  正文有效字数统计（确定性纯函数）。

  口径冻结于 `docs/product/novel-output-milestones.md` §2：

  - 只统计正文文字本身；标点和空白默认不计入有效字数。
  - 统计必须确定性，不能使用 LLM 自报。

  实现采用正向定义：有效字数 = 文本中属于「字母 / 表意文字」(`\\p{L}`) 或
  「数字」(`\\p{N}`) 的字符个数。这样可以自然排除标点、空白、控制符与符号，
  且对中文（每个汉字计 1 字）与拉丁/数字（每个字符计 1）都给出确定结果。

  注意：本函数只负责"怎么数一段文字"。"数哪些文字"（仅已采纳正文、排除大纲/
  设定/笔记/工具日志）是调用方（reading projection / work archive）的边界职责。
  """

  @effective_char ~r/[^\p{L}\p{N}]/u

  @doc """
  统计单段文本的正文有效字数。`nil` 记为 0。
  """
  @spec count(String.t() | nil) :: non_neg_integer()
  def count(nil), do: 0

  def count(text) when is_binary(text) do
    @effective_char
    |> Regex.replace(text, "")
    |> String.length()
  end

  @doc """
  统计多段文本的有效字数之和。非字符串元素（含 `nil`）记为 0。
  """
  @spec sum([String.t() | nil]) :: non_neg_integer()
  def sum(texts) when is_list(texts) do
    texts
    |> Enum.map(&count/1)
    |> Enum.sum()
  end
end
