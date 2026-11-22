defmodule NovelApplication.AuthorContentRegistration do
  @moduledoc """
  作者原文登记的纯来源规则：绑定实际供应的完整作者消息并识别已有物化。
  意图与来源选择由 Judgment 承担；本模块不读写持久状态。
  """

  alias NovelApplication.SessionMessageRead
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.{Compaction, MessageCoverage}

  @doc "从当前真实请求派生作者来源资格；目录、摘要和未读完整的页不授信。"
  @spec author_sources(RequestIR.t()) :: {:ok, [map()]} | {:error, term()}
  def author_sources(%RequestIR{} = request) do
    direct = canonical_sources(request)
    pages = read_pages(request)

    with {:ok, _consistent} <- merge_sources(direct ++ Enum.map(pages, &source_binding/1)),
         {:ok, reads} <- complete_read_sources(pages),
         {:ok, sources} <- merge_sources(direct ++ reads) do
      {:ok, sources}
    else
      {:error, reason} -> invalid(reason)
    end
  end

  @doc "接收时只由实际 RequestIR 绑定来源；内部绑定不是模型返回字段。"
  @spec bind_judgment(map(), RequestIR.t()) :: {:ok, map()} | {:error, term()}
  def bind_judgment(judgment, %RequestIR{} = request) do
    if value(judgment, :action) == "author_content_registration" do
      with {:ok, sources} <- author_sources(request),
           {:ok, ref} <- selected_ref(value(judgment, :author_content_source_ref), request),
           %{} = source <- Enum.find(sources, &(&1.ref == ref)) do
        {:ok, Map.put(judgment, :author_content_source, source)}
      else
        nil -> invalid(:source_not_available)
        {:error, {:author_content_registration_invalid, _}} = error -> error
        {:error, reason} -> invalid(reason)
      end
    else
      {:ok, judgment}
    end
  end

  defp selected_ref(nil, _request), do: {:error, :source_required}
  defp selected_ref("", _request), do: {:error, :source_required}
  defp selected_ref("current", request), do: current_source_ref(request)
  defp selected_ref(ref, _request) when is_binary(ref), do: {:ok, ref}
  defp selected_ref(_ref, _request), do: {:error, :source_required}

  defp current_source_ref(request) do
    scope =
      request.messages
      |> Compaction.project()
      |> Enum.reverse()
      |> Enum.find(&(&1.role == "scope_update"))

    with %{provenance: "application", canonical_ref: owner, blocks: blocks} <- scope,
         true <- same_scope?(owner, request.run),
         true <- value(owner, :run_id) == value(request.run, :run_id),
         %{content: content} <- Enum.find(blocks, &(&1.type == "scope")),
         ref when is_binary(ref) <- value(value(content, :goal), :source_input_ref),
         true <-
           Enum.any?(request.messages, fn message ->
             value(value(message, :canonical_ref), :run_id) == value(request.run, :run_id) and
               match?(%{ref: ^ref}, canonical_source(message, request.run))
           end) do
      {:ok, ref}
    else
      _ -> {:error, :source_not_available}
    end
  end

  defp canonical_sources(request) do
    request.messages
    |> Compaction.project()
    |> Enum.flat_map(fn message ->
      case canonical_source(message, request.run) do
        nil -> []
        source -> [source]
      end
    end)
  end

  defp canonical_source(%{role: "user", provenance: "author"} = message, run) do
    with true <- same_scope?(value(message, :canonical_ref), run),
         %{} <- MessageCoverage.identity(message),
         ref when is_binary(ref) <- single_ref(value(message, :source_refs)),
         {:ok, text} <- original_text(value(message, :blocks)) do
      %{ref: ref, source_hash: source_hash(text)}
    else
      _ -> nil
    end
  end

  defp canonical_source(_message, _run), do: nil

  defp original_text([_ | _] = blocks) do
    if Enum.all?(blocks, &match?(%{type: "text", text: text} when is_binary(text), &1)) do
      text = Enum.map_join(blocks, "", & &1.text)
      if nonblank?(text) and String.valid?(text), do: {:ok, text}, else: :unavailable
    else
      :unavailable
    end
  end

  defp original_text(_blocks), do: :unavailable

  defp same_scope?(source, run) do
    Enum.all?([:workspace_id, :work_id, :session_id], fn key ->
      actual = value(source, key)
      nonblank?(actual) and actual == value(run, key)
    end)
  end

  defp single_ref([source]) do
    ref = value(source, :ref)
    if nonblank?(ref), do: ref
  end

  defp single_ref(_sources), do: nil

  defp read_pages(request) do
    request
    |> RequestIR.usable_observations()
    |> Enum.flat_map(fn observation ->
      case read_page(observation, request.run) do
        nil -> []
        page -> [page]
      end
    end)
  end

  defp read_page(%{status: status, content: content} = observation, run)
       when status in ["ok", "partial"] do
    facts = value(content, :facts)
    coverage = value(observation, :coverage)

    with "session_message_read" <- value(content, :tool),
         "user" <- value(facts, :role),
         "author" <- value(facts, :provenance),
         true <- same_scope?(facts, run),
         ref when is_binary(ref) <- single_ref(value(facts, :source_refs)),
         {:ok, locator} <- SessionMessageRead.parse_query(value(content, :query)),
         true <- locator.run_id == value(facts, :run_id),
         true <- locator.run_sequence == value(facts, :run_sequence),
         %{ref: message_ref, version: version} <- MessageCoverage.source_ref(locator),
         true <- value(observation, :source_refs) == [message_ref],
         true <- value(observation, :versions) == %{message_ref => version},
         "unicode_grapheme" <- value(coverage, :offset_unit) do
      page = %{
        ref: ref,
        source_hash: value(content, :source_hash),
        message_ref: message_ref,
        text: value(content, :summary),
        start_byte: value(value(coverage, :byte_range), :start),
        end_byte: value(value(coverage, :byte_range), :end_exclusive),
        total_bytes: value(coverage, :total_bytes),
        start_grapheme: value(value(coverage, :range), :start),
        end_grapheme: value(value(coverage, :range), :end_exclusive),
        total_graphemes: value(coverage, :total_graphemes)
      }

      if valid_page?(page, observation) and page.start_grapheme == locator.offset, do: page
    else
      _ -> nil
    end
  end

  defp read_page(_observation, _run), do: nil

  defp valid_page?(page, observation) do
    page_content_valid?(page) and page_ranges_valid?(page) and page_status?(page, observation)
  end

  defp page_content_valid?(page) do
    is_binary(page.text) and String.valid?(page.text) and
      is_binary(page.source_hash) and byte_size(page.source_hash) == 64
  end

  defp page_ranges_valid?(page) do
    counts = [
      page.start_byte,
      page.end_byte,
      page.total_bytes,
      page.start_grapheme,
      page.end_grapheme,
      page.total_graphemes
    ]

    Enum.all?(counts, &(is_integer(&1) and &1 >= 0)) and
      page.start_byte <= page.end_byte and page.end_byte <= page.total_bytes and
      page.start_grapheme <= page.end_grapheme and page.end_grapheme <= page.total_graphemes and
      byte_size(page.text) == page.end_byte - page.start_byte and
      String.length(page.text) == page.end_grapheme - page.start_grapheme
  end

  defp page_status?(page, observation) do
    full? = page.start_byte == 0 and page.end_byte == page.total_bytes
    omissions = value(observation, :omissions)
    expected_next = if page.end_grapheme < page.total_graphemes, do: page.end_grapheme

    truthful_status? =
      if full?,
        do: value(observation, :status) == "ok" and omissions == [],
        else: value(observation, :status) == "partial" and is_list(omissions) and omissions != []

    value(observation, :next_offset) == expected_next and truthful_status?
  end

  defp complete_read_sources(pages) do
    pages
    |> Enum.group_by(& &1.ref)
    |> Enum.sort_by(&elem(&1, 0))
    |> Enum.reduce_while({:ok, []}, fn {_ref, source_pages}, {:ok, sources} ->
      case complete_read_source(source_pages) do
        {:ok, source} -> {:cont, {:ok, sources ++ [source]}}
        :incomplete -> {:cont, {:ok, sources}}
        {:error, _} = error -> {:halt, error}
      end
    end)
  end

  defp complete_read_source([first | _] = pages) do
    identity = Map.take(first, [:message_ref, :source_hash, :total_bytes, :total_graphemes])

    with true <- Enum.all?(pages, &(Map.take(&1, Map.keys(identity)) == identity)),
         {:ok, text} <- pages |> Enum.sort_by(& &1.start_byte) |> join_pages() do
      complete_read_binding(text, pages)
    else
      false -> {:error, :source_identity_conflict}
      other -> other
    end
  end

  defp complete_read_binding(text, [first | _] = pages) do
    cond do
      byte_size(text) != first.total_bytes or String.length(text) != first.total_graphemes ->
        :incomplete

      source_hash(text) != first.source_hash or not Enum.all?(pages, &page_bytes?(text, &1)) ->
        {:error, :source_content_mismatch}

      true ->
        {:ok, source_binding(first)}
    end
  end

  defp join_pages(pages), do: Enum.reduce_while(pages, {:ok, ""}, &join_page/2)

  defp join_page(%{start_byte: start_byte}, {:ok, text}) when start_byte > byte_size(text),
    do: {:halt, :incomplete}

  defp join_page(page, {:ok, text}) do
    overlap = min(byte_size(text) - page.start_byte, byte_size(page.text))

    if binary_part(text, page.start_byte, overlap) == binary_part(page.text, 0, overlap) do
      tail = binary_part(page.text, overlap, byte_size(page.text) - overlap)
      {:cont, {:ok, text <> tail}}
    else
      {:halt, {:error, :source_content_mismatch}}
    end
  end

  defp page_bytes?(text, page) do
    byte_size(String.slice(text, 0, page.start_grapheme)) == page.start_byte and
      String.slice(text, page.start_grapheme, page.end_grapheme - page.start_grapheme) ==
        page.text
  end

  defp source_binding(source), do: Map.take(source, [:ref, :source_hash])

  # 同一作者消息可同时被 canonical 历史和回查证明；冲突证据不能覆盖已有事实。
  defp merge_sources(sources) do
    sources
    |> Enum.reduce_while({%{}, []}, fn source, {known, ordered} ->
      case Map.fetch(known, source.ref) do
        :error -> {:cont, {Map.put(known, source.ref, source), [source | ordered]}}
        {:ok, ^source} -> {:cont, {known, ordered}}
        {:ok, _conflict} -> {:halt, {:error, :source_identity_conflict}}
      end
    end)
    |> case do
      {:error, _} = error -> error
      {_known, ordered} -> {:ok, Enum.reverse(ordered)}
    end
  end

  defp source_hash(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
  defp nonblank?(text), do: is_binary(text) and String.trim(text) != ""
  defp invalid(reason), do: {:error, {:author_content_registration_invalid, reason}}

  @doc "判断与执行共用的业务规则；登记作者原文与生成新内容是不同操作。"
  def author_registration_rules do
    """
    ## 原文登记与采纳规则（优先于一般形态映射）
    - 作者只要求把资料留在本次对话、暂不展开或生成候选时，只确认收到，不登记原文、不产方向或产物。
      对话中已留存原输入不等于作品档案已入档；后续作者明确要求登记或生成候选时再处理。
    - 作者明确要求把具体原文登记进作品档案或物化为待采纳候选时，调用 register_author_content 并填明确来源，原文将成为
      待采纳的作品设定候选；应用按来源逐字复制，不调用创作能力重写，也不直接写入档案。
      这里的原文是被引用消息的完整文本，包括同条消息中的指令性前缀；系统不会自动抽取资料段或删去前缀，
      不能在回复中声称会剔除它们。若作者希望只保留资料内容，应修订现有候选或在“修改后保存”中编辑全文。
    - author_content_source_ref 使用当前 Scope.operation.author_content_sources 中的 ref；
      current 表示本轮完整作者消息本身就是要登记的原文。source_hash 是应用提供的来源证据，不是工具参数。
      选择依据是作者真实意图和完整原文，不由某个指代词、句长或标点决定。
    - 历史来源必须是实际供应的完整作者消息，其原文本身就是作者要登记的具体内容；
      目录、摘要、同名提及或模型答复不能替代该原文，也不能将本轮保存指令冒充历史资料。
      需要补足来源时，可用 session_message_read 按真实消息坐标读取；部分页需继续读取直到来源完整。
      无法确定指代对象或缺少定位事实时，用 ask_author 具体澄清，不猜来源。
    - 同一来源已有待采纳候选时，引导作者采纳；已经采纳时据实际事实回答，不重复生成。
      状态追问不重开创作，运行完成不等于已保存，只有采纳/实际写入事实支持已入档的说法。
      不要建议重新登记已有待采纳/已采纳来源；需要修改时修订实际对象，不以重新登记代替修改。
    - 作者要求修改已有候选：选择 revise_pending_artifact 并引用该候选；生成独立修订稿，
      原候选保留、修订不自动采纳。明确放弃选择 discard_pending_artifact，执行后才算放弃。
      对象不明确先询问，不默认选最新一份。只讨论修改思路时直接回复，不执行。
      修改后保存按钮表示作者编辑全文并入档，不能把普通修改请求当作采纳授权。
    - 同来源的候选全部已放弃时，作者再次明确登记可生成新候选；放弃本身不会自动重新登记。
      已修改后保存表示保存了编辑版本，不应宣称原文逐字入档。
    - 只有作者确实要求生成或改写新内容时，才选择创作执行；不能把原文登记转成创作重写。
    """
  end

  @doc "业务校验失败后的作者安全说明，不暴露机器编号或模型原始载荷。"
  def author_registration_failure_message(reason)
      when reason in [:source_required, :source_not_available],
      do: "这次未能确定要保存的原文来源，没有生成候选或写入档案。请明确指出要保存哪条资料，或重新提供原文。"

  def author_registration_failure_message(:already_materialized),
    do: "这份原文已有待采纳或已采纳版本，本次没有重复生成或写入。请处理现有候选；需要修改时可以直接说明修改要求。"

  def author_registration_failure_message(_reason),
    do: "这次原文登记的处理方式未通过校验，已停止，没有改写原文、生成候选或写入档案。请明确要保留哪份原文后再试。"

  @doc "物化前核对持久层实际作者身份与原字节；不从目录或摘要重建内容。"
  @spec source_text(map() | nil, String.t() | nil, String.t() | nil) ::
          {:ok, String.t(), String.t()} | {:error, term()}
  def source_text(nil, _actual_ref, _actual_text), do: invalid(:source_required)

  def source_text(%{ref: ref, source_hash: hash}, actual_ref, actual_text) do
    cond do
      not is_binary(actual_ref) or not is_binary(actual_text) ->
        invalid(:source_not_available)

      ref != actual_ref ->
        invalid(:source_identity_mismatch)

      source_hash(actual_text) != hash ->
        invalid(:source_content_mismatch)

      true ->
        {:ok, actual_ref, actual_text}
    end
  end

  def source_text(_binding, _actual_ref, _actual_text), do: invalid(:source_required)

  def materialized_source?(context, source_ref) do
    materialized_entries(context)
    |> Enum.any?(&(author_source_ref(&1) == "author_input:#{source_ref}"))
  end

  def registered_sources(context) do
    materialized_entries(context)
    |> Enum.map(&author_source_ref/1)
    |> Enum.filter(&(is_binary(&1) and String.starts_with?(&1, "author_input:")))
    |> Enum.map(&String.replace_prefix(&1, "author_input:", ""))
    |> Enum.uniq()
  end

  defp materialized_entries(context) do
    state = Map.get(context, :interaction_state, %{})

    accepted =
      Enum.filter(
        Map.get(state, :resolved_adoptions, []),
        &(value(&1, :adoption_status) in NovelDomain.AdoptionStatus.canon_statuses())
      )

    Map.get(state, :pending_adoptions, []) ++ accepted
  end

  def author_source_ref(entry) do
    payload = value(entry, :payload) || %{}

    value(payload, :registration_source_ref) ||
      case value(payload, :items) do
        [item | _] -> value(entry, :source_tool_result_ref) || value(item, :provider_call_ref)
        _ -> value(entry, :source_tool_result_ref)
      end
  end

  defp value(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp value(_map, _key), do: nil
end
