defmodule NovelApplication.ChapterSummaryGenerator do
  @moduledoc """
  章摘要默认生成器（VS-00C CP2.1 / contract §6.3）。

  走既有 CreativeProvider 通道（`Gateway.complete/1`）产出四栏摘要文本，再解析回四栏 map
  交给 `ChapterSummaryMaintenance` 渲染为 canonical `summary_text`。这是一条**独立摘要 prompt**，
  不复用、不触碰 prose_writing 的 real.ex 三锚点模板（契约 §6 边界）。

  CP2.1 从本次采纳的正文 `prose_text` 生成；按全章已采纳正文生成（append 连续性）属 CP2.2。
  生成失败一律返回 `{:error, reason}`，由 maintenance 降级，不抛错。
  """

  alias NovelAgent.Provider.Gateway
  alias NovelCommon.LogContext
  alias NovelDomain.ChapterSummary

  @doc "从 maintenance 输入生成四栏摘要 map；失败返回 `{:error, reason}`。"
  @spec generate(map()) :: {:ok, map()} | {:error, term()}
  def generate(input) when is_map(input) do
    prose = input |> Map.get(:prose_text) |> normalize()

    if prose == "" do
      {:error, :empty_prose}
    else
      LogContext.with_step("chapter_summary", fn ->
        prose
        |> build_prompt()
        |> Gateway.complete()
        |> handle_completion(prose)
      end)
    end
  end

  defp handle_completion({:ok, %{content: text}}, prose) when is_binary(text),
    do: {:ok, parse_sections(text, prose)}

  defp handle_completion({:ok, text}, prose) when is_binary(text),
    do: {:ok, parse_sections(text, prose)}

  defp handle_completion({:error, reason}, _prose), do: {:error, reason}
  defp handle_completion(other, _prose), do: {:error, {:unexpected_provider_result, other}}

  defp build_prompt(prose) do
    labels = ChapterSummary.section_labels()

    sections_spec =
      Enum.map_join(ChapterSummary.section_order(), "\n", fn key ->
        "【#{labels[key]}】<这一栏的内容>"
      end)

    """
    你是连续性维护助手。请把下面这一章的已采纳正文，压缩成高信息密度的“写后摘要”，
    供后续续写衔接与跨章连续性使用。目标 200~400 字。

    严格按以下四栏输出，每栏一行，保留方括号标签，不要输出正文原句、不要加额外说明：
    #{sections_spec}

    已采纳正文：
    #{prose}
    """
  end

  # 按四栏标签解析模型输出；任一栏缺失则该栏留空（render 时补「（无）」）。
  # 完全解析不到四栏时，把整段输出归入“情节推进”，避免丢失内容。
  defp parse_sections(text, prose) do
    by_label =
      ChapterSummary.section_labels()
      |> Map.new(fn {key, label} -> {label, key} end)

    sections =
      text
      |> String.split("【", trim: true)
      |> Enum.reduce(%{}, fn chunk, acc -> merge_section(acc, chunk, by_label) end)

    if map_size(sections) == 0 do
      %{plot: text |> normalize() |> fallback(prose)}
    else
      sections
    end
  end

  defp merge_section(acc, chunk, by_label) do
    case String.split(chunk, "】", parts: 2) do
      [label, body] ->
        case Map.get(by_label, String.trim(label)) do
          nil -> acc
          key -> Map.put(acc, key, String.trim(body))
        end

      _ ->
        acc
    end
  end

  defp fallback("", prose), do: prose
  defp fallback(text, _prose), do: text

  defp normalize(value) when is_binary(value), do: String.trim(value)
  defp normalize(_), do: ""
end
