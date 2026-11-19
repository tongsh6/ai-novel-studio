defmodule NovelApplication.ChapterReadEvidence do
  @moduledoc """
  已供应章读页的身份、版本和范围证据（纯函数，不读 DB、不调模型）。

  ChapterRevisionScope 在作者授权之后，用当前作者输入之后的原生读页绑定模型选段；
  PendingArtifactWorkflow 用本次请求全部可见的读页核对 fresh accepted 完整基线。
  两个观察时点分别保留，同一章页解析、hash/版本合并及连续范围算法只在本模块定义。

  不读取作者措辞、不扩大修改授权、不生成 Task 材料，也不改变 canonical 原件或 provenance。
  正文分段和分页仍由既有 LocalizedRevision/ExplorationService 生产。
  """

  alias NovelCommon.RequestIR
  alias NovelDomain.ProseFormatting

  @doc "按当前作者输入之后真实读取的章页绑定目标段，不借旧回合材料证明本轮发现。"
  @spec bind_target_segments(RequestIR.t(), String.t(), [String.t()]) ::
          {:ok, map()} | {:error, atom()}
  def bind_target_segments(%RequestIR{} = request, chapter_ref, ids) do
    pages = same_chapter_pages(request, chapter_ref)

    cond do
      ids == [] and pages == [] -> {:error, :read_required}
      ids == [] -> {:error, :ids_required}
      pages == [] -> {:error, :not_observed}
      true -> bind_segments(pages, ids)
    end
  end

  defp bind_segments(pages, ids) do
    with {:ok, source_hash} <- single_source_hash(pages),
         {:ok, versions} <- merged_versions(pages),
         :ok <- cover_all(pages, ids) do
      {:ok, %{target_segment_ids: ids, source_hash: source_hash, versions: versions}}
    end
  end

  @doc """
  核对当前可见章页是否已经完整供应这一次 fresh accepted 正文。

  复用段绑定的页/hash/版本/连续范围算法；正文资格另核真实来源与页字节。
  隐藏历史、目录引用、旧版本或不完整页不授信，也不改变作者修改授权。
  """
  @spec supplied_baseline?(RequestIR.t() | nil, map()) :: boolean()
  def supplied_baseline?(
        %RequestIR{} = request,
        %{base_text: text, target_chapter_ref: _chapter_ref, expected_base_versions: expected} =
          facts
      )
      when is_binary(text) and text != "" and is_list(expected) do
    source_hash = ProseFormatting.source_hash(text)
    versions = Map.new(expected, &{&1.ref, &1.version})

    pages =
      request
      |> RequestIR.visible_observations()
      |> Enum.flat_map(&chapter_page/1)
      |> Enum.filter(&current_baseline_page?(&1, facts, source_hash, versions))

    with {:ok, ^source_hash} <- single_source_hash(pages),
         {:ok, ^versions} <- merged_versions(pages),
         true <- pages |> Enum.sort_by(& &1.start_byte) |> contiguous_cover?(0, byte_size(text)) do
      true
    else
      _not_complete -> false
    end
  end

  def supplied_baseline?(_request, _facts), do: false

  defp current_baseline_page?(page, facts, source_hash, versions) do
    page.chapter_ref == facts.target_chapter_ref and page.source_hash == source_hash and
      page_source?(page.observation, facts.target_chapter_ref) and
      current_page_versions?(page.versions, versions) and
      current_page_text?(page, facts.base_text)
  end

  defp page_source?(observation, chapter_ref) do
    Enum.any?(Map.get(observation, :source_refs, []), fn
      ^chapter_ref -> true
      %{ref: ^chapter_ref} -> true
      %{"ref" => ^chapter_ref} -> true
      _ref -> false
    end)
  end

  defp current_page_versions?(page_versions, expected) do
    map_size(page_versions) > 0 and
      Enum.all?(page_versions, fn {ref, version} -> Map.fetch(expected, ref) == {:ok, version} end)
  end

  # 首页的设计预览 omissions 不否定正文页；完整性由同一 fresh 正文的真实范围与字节证明。
  defp current_page_text?(
         %{
           observation: %{
             content: %{"summary" => summary},
             coverage: %{
               "prose_range" => %{"start" => start, "end" => finish},
               "prose_total_chars" => total
             }
           }
         } = page,
         text
       )
       when is_binary(summary) and is_integer(start) and is_integer(finish) do
    with true <- total == String.length(text),
         true <- start > 0 and finish >= start and finish <= total,
         page_text = String.slice(text, start - 1, finish - start + 1),
         true <- page.start_byte == byte_size(String.slice(text, 0, start - 1)),
         true <- page.end_byte == page.start_byte + byte_size(page_text) do
      String.contains?(summary, page_text)
    else
      _not_current -> false
    end
  end

  defp current_page_text?(_page, _text), do: false

  defp same_chapter_pages(request, chapter_ref) do
    request
    |> current_turn_chapter_pages()
    |> Enum.filter(&(&1.chapter_ref == chapter_ref))
  end

  defp current_turn_chapter_pages(%RequestIR{messages: messages}) do
    messages
    |> Enum.reverse()
    |> Enum.take_while(&(&1.role != "user"))
    |> Enum.reverse()
    |> Enum.flat_map(&observation_leaves/1)
    |> Enum.flat_map(&chapter_page/1)
  end

  defp observation_leaves(%{blocks: blocks}) when is_list(blocks) do
    Enum.flat_map(blocks, fn
      %{type: "observation"} = block -> RequestIR.observation_payloads(block)
      _block -> []
    end)
  end

  defp observation_leaves(_message), do: []

  # canonical 观察：顶层原子键、content/coverage 为 JSON 字符串键；producer 已给真实段坐标。
  defp chapter_page(
         %{
           status: "ok",
           content: %{
             "tool" => "chapter_read",
             "source_hash" => source_hash,
             "target_segments" => segments
           },
           coverage: %{
             "chapter_ref" => chapter_ref,
             "prose_byte_range" => %{"start" => start_byte, "end" => end_byte}
           },
           versions: versions
         } = observation
       )
       when is_binary(source_hash) and is_list(segments) and is_map(versions) do
    [
      %{
        chapter_ref: chapter_ref,
        source_hash: source_hash,
        versions: versions,
        start_byte: start_byte,
        end_byte: end_byte,
        segments: segments,
        observation: observation
      }
    ]
  end

  defp chapter_page(_leaf), do: []

  defp single_source_hash(pages) do
    case pages |> Enum.map(& &1.source_hash) |> Enum.uniq() do
      [source_hash] -> {:ok, source_hash}
      _other -> {:error, :source_mismatch}
    end
  end

  # 同一 ref 在不同页出现不同版本即冲突；相同 {ref, version} 可跨页去重。
  defp merged_versions(pages) do
    pairs =
      for page <- pages, {ref, version} <- page.versions, do: {to_string(ref), version}

    versions = Map.new(pairs)

    if length(Enum.uniq(pairs)) == map_size(versions),
      do: {:ok, versions},
      else: {:error, :version_mismatch}
  end

  defp cover_all(pages, ids) do
    Enum.reduce_while(ids, :ok, fn id, :ok ->
      case cover_segment(pages, id) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp cover_segment(pages, id) do
    segment =
      Enum.find_value(pages, fn page ->
        Enum.find(page.segments, &match?(%{"segment_id" => ^id}, &1))
      end)

    case segment do
      %{"byte_start" => start_byte, "byte_end" => end_byte}
      when is_integer(start_byte) and is_integer(end_byte) and end_byte > start_byte ->
        pages
        |> Enum.filter(&overlaps?(&1, start_byte, end_byte))
        |> Enum.sort_by(& &1.start_byte)
        |> contiguous_cover?(start_byte, end_byte)
        |> case do
          true -> :ok
          false -> {:error, :incomplete_page_coverage}
        end

      _ ->
        {:error, :not_observed}
    end
  end

  defp overlaps?(page, start_byte, end_byte),
    do: page.start_byte < end_byte and page.end_byte > start_byte

  # 按页起点推进连续游标，只有覆盖到段末才算完整观察。
  defp contiguous_cover?(pages, start_byte, end_byte) do
    pages
    |> Enum.reduce_while(start_byte, fn page, cursor ->
      cond do
        page.end_byte <= cursor -> {:cont, cursor}
        page.start_byte > cursor -> {:halt, :gap}
        page.end_byte >= end_byte -> {:halt, :covered}
        true -> {:cont, page.end_byte}
      end
    end)
    |> Kernel.==(:covered)
  end
end
