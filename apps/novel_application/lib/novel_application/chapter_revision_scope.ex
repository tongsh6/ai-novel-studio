defmodule NovelApplication.ChapterRevisionScope do
  @moduledoc """
  B28 §元原则整改 CP1：章级修订的**作者授权范围**判定（纯函数，不读 DB/不调模型）。

  范围表达“作者授权修改什么”，不是“给模型读多少材料”：
  - 读取/通读/检查/全文等词只说明材料覆盖，不单独授予整章修改；
  - 否定、局部限制、条件不得被词面命中扩大为整章授权；
  - `:whole_chapter` 仅用于明确、无条件、无局部限制的整章修改授权；
  - 其余保守为 `:target_segments`（目标解析不到由既有 target_segments 解析给出
    `:incomplete_scope`/`:target_missing`/`:target_ambiguous`，禁止回退整章）；
  - 明确“只读/不改”且无修改授权时返回 `{:error, :author_scope_not_authorized}`，
    由调用方零写入拒绝，不生成候选。

  不新增 schema/字段/阈值；writer 内容与 writer/adoption 数据完整性守卫仍由既有链路负责。

  B82 G2：成功 `chapter_read` 观察可派生页内既有 B36 段坐标；判断层只把模型提议绑定到
  本轮当前作者输入之后真实成功读取页，作者显式段号/字面目标优先。绑定失败走有界协议纠错，
  不回退整章，也不把内部段编号变成向作者追问的问题。
  """

  @type scope :: :format_only | :whole_chapter | :target_segments

  alias NovelCommon.RequestIR

  @format_only ~r/(只|仅).{0,10}(调整|调|改|做|整理).{0,10}(标点|分段|排版)|(标点|分段|排版).{0,10}(不改|不变|别改)|别改字句|字句.{0,6}(不变|别动)/u
  @format_only_negated ~r/(不是|并非|不要|别|无需).{0,8}(只|仅)?.{0,6}(标点|分段|排版)/u

  # 引用式目标：作者把“本轮读后发现的对象”指给修订，而不是直接给段号/字面。
  # 只认既有替换源 operand 内的发现/查找对象，不把泛读词或模型声明当授权。
  @replacement_verb ~r/改成|改为|替换为|替换成/u
  @quoted_replacement ~r/[「“"『](.+?)[」”"』]\s*(?:改成|改为|替换为|替换成)/su

  @discovery_source Regex.compile!(
                      "(?:发现|找出|找到|读到|看到|查到|检索出|检索到|核对出|核对到|注意到)" <>
                        "(?:到的|出的|来的|的|了|到|出|来|着)?[^，。；;]{0,16}" <>
                        "(?:写法|段落?|句子?|文字|内容|地方|部分|处|问题)",
                      "u"
                    )

  # 段号词法：授权判定（局部限制）与目标定位共用同一入口，避免两套表。
  @segment_ordinal_source "第\\s*([0-9]+|[一二三四五六七八九十]+)\\s*段"
  @segment_ordinal Regex.compile!(@segment_ordinal_source, "u")
  @explicit_target Regex.compile!("开头|结尾|" <> @segment_ordinal_source, "u")

  # 局部限制词：只改第N段/开头/结尾/最后一段/指定段；其余/其他段落别动/逐字保留。
  @local_limit Regex.compile!(
                 "(只|仅).{0,8}(改|修|调整|修改|处理|整理).{0,8}(" <>
                   @segment_ordinal_source <>
                   "|开头|结尾|最后一段|指定段|这句|这处)|(其他|其它|其余|剩下|剩余).{0,10}(别|不要|不动|逐字|保持|不变)|除.{0,12}(外|之外).{0,12}(都|全).{0,8}(别|不要|不动)|其余(.{0,4})逐字",
                 "u"
               )

  @whole_range "(?:整章|全章|整篇|全文)"
  @modify_verb "(?:重写|改写|润色|修订|修改|整理|优化|调整|改)"
  @negated_whole_modify ~r/(不要|别|先别|先不要|无需|不用|勿)(要|用|再)?[^，,。；;]{0,6}(整章|全章|整篇|全文)[^，,。；;]{0,10}(重写|改写|润色|修订|修改|整理|优化|调整|改)|(不要|别|先别|先不要|无需|不用|勿)(要|用|再)?[^，,。；;]{0,6}(重写|改写|润色|修订|修改|整理|优化|调整|改)[^，,。；;]{0,10}(整章|全章|整篇|全文)/u

  # 读取/检查类语境：与“别改/不要改”同时出现时，说明作者只要结果不要写。
  @read_only ~r/(只读|读一遍|读一下|通读|检查|看一遍|核对|告诉我|回我|说明)/u
  # 修改否定：不要改/别改/先别动笔/无需修改…
  @deny_modify ~r/(不要|别|先别|先不要|无需|不用|勿|不)(要|用|再)?\s*(改|修改|重写|修订|润色|整理|动笔|动)/u
  # 条件句：条件未判定前不得把整章词当无条件授权。
  @conditional ~r/(如果|若|假如|要是|万一|一旦|如有).{0,30}(就|则|再|便|才)/u

  @doc """
  判定作者原话的修改授权范围。

  返回 `{:ok, scope}` 或 `{:error, :author_scope_not_authorized}`（明确只读/不改且无修改授权）。
  """
  @spec authorize(String.t() | nil) :: {:ok, scope()} | {:error, :author_scope_not_authorized}
  def authorize(text) when is_binary(text) do
    if String.trim(text) == "", do: {:ok, :target_segments}, else: decide(text)
  end

  def authorize(_text), do: {:ok, :target_segments}

  @doc """
  按作者原话定位章级修订的目标段 id（纯函数，段由既有 B36 分段给出）。

  明确序号/开头/结尾/最后一段优先；精确字词替换只认唯一命中，重复或与明确序号
  不一致时拒绝。未知或越界的明确序号返回 `:target_missing`，绝不回退首段。
  """
  @spec target_segment_ids([map()], String.t()) ::
          {:ok, [String.t()]}
          | {:error, :target_missing | :target_ambiguous | :incomplete_scope}
  def target_segment_ids(segments, text) when is_binary(text) do
    ordinal =
      cond do
        Regex.match?(~r/开头|第一段/u, text) -> first_id(segments)
        Regex.match?(~r/最后一段|结尾/u, text) -> last_id(segments)
        true -> ordinal_target_ids(segments, text)
      end

    if ordinal == [] and Regex.match?(@explicit_target, text) do
      {:error, :target_missing}
    else
      reconcile_revision_target(ordinal, literal_revision_target(segments, text))
    end
  end

  def target_segment_ids(_segments, _text), do: {:error, :incomplete_scope}

  @doc "章级已采纳正文的规范 ref；判断/候选/绑定共用同一身份口径。"
  @spec chapter_ref?(term()) :: boolean()
  def chapter_ref?(ref) when is_binary(ref), do: String.starts_with?(ref, "chapter:")
  def chapter_ref?(_ref), do: false

  @doc """
  作者是否给出了显式目标（段号/开头/结尾/明确字面替换）。

  显式目标优先走既有 B28 定位；模型提议的段 id 不得覆盖作者写出的对象。
  """
  @spec explicit_target?(String.t() | nil) :: boolean()
  def explicit_target?(text) when is_binary(text) do
    Regex.match?(@explicit_target, text) or explicit_literal_target?(text)
  end

  def explicit_target?(_text), do: false

  @doc """
  作者是否把本轮读取后发现的对象指给修订（引用式目标）。

  例如“把发现的重复写法改成一段候选”“把你找出的重复段落替换为……”。
  显式段号/开头/结尾、引号字面或普通字面替换都不是引用式目标；仅在既有
  替换源 operand 内识别明确发现/查找对象，泛读词或模型声明不授权。
  """
  @spec reference_discovery_target?(String.t() | nil) :: boolean()
  def reference_discovery_target?(text) when is_binary(text) do
    Regex.match?(@replacement_verb, text) and
      not Regex.match?(@quoted_replacement, text) and
      Regex.match?(@discovery_source, revision_literal(text))
  end

  def reference_discovery_target?(_text), do: false

  @doc """
  decode 成功后、accepted 回执前，把模型提议的目标段绑定到本轮真实观察。

  `target_segment_ids` 只接受 execute + revise_adopted_content + 章级 ref；
  作者显式段号/字面目标优先，模型提议不覆盖。引用式目标必须按同一正文的
  chapter_read 页逐段证明完整覆盖；结果只含 target_segment_ids/source_hash/
  versions，writer 前再由 Pending 与当前章事实复核。
  """
  @spec bind_observed_targets(map(), RequestIR.t()) ::
          {:ok, map()} | {:error, {:target_segments, atom()}}
  def bind_observed_targets(
        %{
          action: "execute",
          capability: "revise_adopted_content",
          adopted_content_ref: "chapter:" <> _
        } = judgment,
        %RequestIR{} = request
      ) do
    ids = normalize_bound_ids(Map.get(judgment, :target_segment_ids))
    author_text = Map.get(judgment, :author_input) || ""

    cond do
      # 作者显式段号/字面目标，以及整章/仅排版/只读等既有范围判定优先于模型选段。
      explicit_target?(author_text) or authorize(author_text) != {:ok, :target_segments} ->
        {:ok, clear_bound_targets(judgment)}

      reference_discovery_target?(author_text) or local_target_authorized?(author_text) ->
        bind_observed_selection(judgment, request, ids)

      ids == [] ->
        {:ok, clear_bound_targets(judgment)}

      true ->
        {:error, {:target_segments, :selection_not_authorized}}
    end
  end

  def bind_observed_targets(judgment, %RequestIR{}) when is_map(judgment) do
    if normalize_bound_ids(Map.get(judgment, :target_segment_ids)) == [],
      do: {:ok, judgment},
      else: {:error, {:target_segments, :not_allowed}}
  end

  defp explicit_literal_target?(text) do
    Regex.match?(@replacement_verb, text) and
      not reference_discovery_target?(text) and
      revision_literal(text) != ""
  end

  # 既有局部限制（如“只改有问题的部分，其余别动”）也是实际局部授权。
  defp local_target_authorized?(text),
    do: text |> split_clauses() |> Enum.any?(&local_limit?/1)

  defp normalize_bound_ids(ids) when is_list(ids),
    do: ids |> Enum.map(&to_string/1) |> Enum.uniq()

  defp normalize_bound_ids(_ids), do: []

  defp clear_bound_targets(judgment) do
    judgment
    |> Map.put(:target_segment_ids, [])
    |> Map.delete(:observed_targets)
  end

  # 只读本轮实际发出的 prepared RequestIR：当前作者输入之后的成功 chapter_read 叶。
  defp bind_observed_selection(judgment, request, ids) do
    pages = same_chapter_pages(request, judgment.adopted_content_ref)

    cond do
      ids == [] and pages == [] -> {:error, {:target_segments, :read_required}}
      ids == [] -> {:error, {:target_segments, :ids_required}}
      pages == [] -> {:error, {:target_segments, :not_observed}}
      true -> bind_segments(judgment, pages, ids)
    end
  end

  defp bind_segments(judgment, pages, ids) do
    with {:ok, source_hash} <- single_source_hash(pages),
         {:ok, versions} <- merged_versions(pages),
         :ok <- cover_all(pages, ids) do
      {:ok,
       judgment
       |> Map.put(:target_segment_ids, ids)
       |> Map.put(:observed_targets, %{
         target_segment_ids: ids,
         source_hash: source_hash,
         versions: versions
       })}
    else
      {:error, reason} -> {:error, {:target_segments, reason}}
    end
  end

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
  defp chapter_page(%{
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
       })
       when is_binary(source_hash) and is_list(segments) and is_map(versions) do
    [
      %{
        chapter_ref: chapter_ref,
        source_hash: source_hash,
        versions: versions,
        start_byte: start_byte,
        end_byte: end_byte,
        segments: segments
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

  defp reconcile_revision_target(ordinal, literal_target) do
    case literal_target do
      :none when ordinal != [] -> {:ok, ordinal}
      :none -> {:error, :incomplete_scope}
      {:ok, ids} when ordinal == [] or ordinal == ids -> {:ok, ids}
      {:ok, _ids} -> {:error, :target_ambiguous}
      {:error, _} = error -> error
    end
  end

  # 精确字词替换只认一个明确源文本；不截取近似后缀、不在重复命中里猜第一处。
  defp literal_revision_target(segments, text) do
    case Regex.scan(~r/改成|改为|替换为|替换成/u, text) do
      [] -> :none
      [_] -> locate_revision_literal(segments, revision_literal(text))
      _ -> {:error, :target_ambiguous}
    end
  end

  defp revision_literal(text) do
    case Regex.run(~r/[「“"『](.+?)[」”"』]\s*(?:改成|改为|替换为|替换成)/su, text) do
      [_, literal] ->
        literal

      _ ->
        text
        |> String.split(~r/改成|改为|替换为|替换成/u, parts: 2)
        |> hd()
        |> String.split(~r/[，,；;。！？!?\n]/u)
        |> List.last()
        |> String.trim()
        |> String.replace(~r/^(?:(?:把|将)\s*)?.*?(?:正文|文本)(?:里|中)的?/u, "")
        |> String.replace(~r/^(?:把|将)\s*/u, "")
        |> String.trim()
    end
  end

  defp locate_revision_literal(_segments, ""), do: {:error, :target_missing}

  defp locate_revision_literal(segments, literal) do
    base = Enum.map_join(segments, & &1.raw)

    case :binary.match(base, literal) do
      :nomatch ->
        {:error, :target_missing}

      {offset, _length} ->
        remaining = {offset + 1, byte_size(base) - offset - 1}

        case :binary.match(base, literal, scope: remaining) do
          :nomatch -> unique_literal_segment(segments, literal)
          _ -> {:error, :target_ambiguous}
        end
    end
  end

  defp unique_literal_segment(segments, literal) do
    case Enum.filter(segments, &String.contains?(&1.raw, literal)) do
      [segment] -> {:ok, [segment.segment_id]}
      [] -> {:error, :target_missing}
      _ -> {:error, :target_ambiguous}
    end
  end

  defp first_id([%{segment_id: id} | _]), do: [id]
  defp first_id(_segments), do: []

  defp last_id(segments) do
    case List.last(segments) do
      nil -> []
      %{segment_id: id} -> [id]
    end
  end

  defp ordinal_target_ids(segments, text) do
    case Regex.run(@segment_ordinal, text) do
      [_, raw] ->
        case NovelFoundation.parse_ordinal(raw) do
          nil -> []
          number -> ordinal_id_at(segments, number - 1)
        end

      _ ->
        []
    end
  end

  defp ordinal_id_at(segments, index) when index >= 0 do
    case Enum.at(segments, index) do
      nil -> []
      segment -> [segment.segment_id]
    end
  end

  defp ordinal_id_at(_segments, _index), do: []

  defp decide(text) do
    clauses = split_clauses(text)

    flags = %{
      format_only: Enum.any?(clauses, &Regex.match?(@format_only, &1)),
      format_negated: Enum.any?(clauses, &Regex.match?(@format_only_negated, &1)),
      local_limit: Enum.any?(clauses, &local_limit?/1),
      deny_modify: Enum.any?(clauses, &Regex.match?(@deny_modify, &1)),
      whole_modify: Enum.any?(clauses, &whole_modify?/1),
      read_only: Regex.match?(@read_only, text),
      conditional: Regex.match?(@conditional, text)
    }

    decision(flags)
  end

  defp decision(%{format_only: true, format_negated: false}), do: {:ok, :format_only}
  defp decision(%{local_limit: true}), do: {:ok, :target_segments}

  defp decision(%{deny_modify: true, read_only: true, whole_modify: false}),
    do: {:error, :author_scope_not_authorized}

  defp decision(%{deny_modify: true, whole_modify: false}), do: {:ok, :target_segments}
  defp decision(%{whole_modify: true, conditional: false}), do: {:ok, :whole_chapter}
  defp decision(_flags), do: {:ok, :target_segments}

  defp split_clauses(text) do
    text
    |> String.split(~r/[，,。；;！!？?\n]+/u, trim: true)
    |> Enum.map(&String.trim/1)
  end

  # 局部限制：只改第N段/开头/结尾…，或“其他段落别动/其余逐字不变”。
  defp local_limit?(clause) do
    Regex.match?(@local_limit, clause) and not format_only_only?(clause)
  end

  # “别改字句”属于仅排版限制，不是局部内容限制（format_only 优先，避免互相误判）。
  defp format_only_only?(clause), do: Regex.match?(@format_only, clause)

  # 整章修改授权：整章词与修改动词在同一子句内靠近，且同一子句没有否定整章修改。
  defp whole_modify?(clause) do
    Regex.match?(whole_modify_regex(), clause) and not Regex.match?(@negated_whole_modify, clause)
  end

  defp whole_modify_regex do
    range = @whole_range
    verb = @modify_verb
    ~r/#{range}[^，,。；;]{0,12}#{verb}|#{verb}[^，,。；;]{0,12}#{range}/u
  end
end
