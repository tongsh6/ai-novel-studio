defmodule NovelApplication.AuthorContentRegistration do
  @moduledoc """
  作者原文登记的纯应用规则：选择真实来源、校验登记意图并识别已有物化。
  不读写持久状态；事务内重复登记裁决仍由 persistence 边界负责。
  """

  def author_sources(context, current_turn) do
    context
    |> Map.get(:interaction_state, %{})
    |> Map.get(:author_inputs, [])
    |> Enum.reject(&(&1.turn_ref == current_turn))
  end

  # M18：指代过去资料的语言标记 + 本条消息内显式给出原文的标记。
  # 这是“来源语义”规则，不是按案例关键词拒真原文：current 的合法含义只有
  # “本条消息本身即被登记原文”；作者指代过去材料时，除非本条消息显式给出要登记的
  # 原文片段（引号/冒号后的实质内容或足够长的材料正文），否则 current 不成立。
  @anaphoric_reference_re ~r/(之前|此前|早先|上次|上回|上一轮|上一条|前面|刚才|刚刚|上面|上文|那段|那份|那条|那篇|发你的|发给你的|给你的|刚才的|之前的)/u
  @explicit_payload_re ~r/([：:]\s*\S{8,})|([“"「][^”"」]{8,}[”"」])/u
  @min_current_material_chars 40

  @doc "原文登记的联合前置条件；只有显式来源和保真分支可以进入物化。"
  def validate_author_registration(judgment, sources, author_text \\ "") do
    result =
      if value(judgment, :action) == "author_content_registration",
        do: validate_registration_fields(judgment, sources || [], author_text),
        else: :ok

    case result do
      :ok -> :ok
      {:error, reason} -> {:error, {:author_content_registration_invalid, reason}}
    end
  end

  defp validate_registration_fields(judgment, sources, author_text) do
    source = value(judgment, :author_content_source_ref)

    cond do
      is_nil(source) or source == "" ->
        {:error, :source_required}

      source not in ["current" | sources] ->
        {:error, :source_not_available}

      source == "current" ->
        validate_current_registration_source(author_text)

      true ->
        :ok
    end
  end

  @doc false
  def anaphoric_reference?(text) when is_binary(text),
    do: Regex.match?(@anaphoric_reference_re, text)

  defp validate_current_registration_source(author_text) do
    text = to_string(author_text || "")

    cond do
      not anaphoric_reference?(text) ->
        :ok

      Regex.match?(@explicit_payload_re, text) ->
        :ok

      String.length(String.trim(text)) >= @min_current_material_chars ->
        :ok

      true ->
        {:error, :anaphoric_current_source_requires_explicit_text}
    end
  end

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
    - `current` 只表示“本条消息本身就是被登记原文”。作者用“之前/那份/上次/前面/刚才/
      发你的/上面”等指代过去资料时，current 不是合法来源；必须先取证合法来源，或让作者
      指出来源/贴出原文，不能把保存指令本身当原文登记。
    - 作者指代“之前/那份/上次/发你的”等历史原文、而当前来源清单无法确认时：若只读探索可用，
      必须先 explore（chapter_read/prose_search 找正文原文；session_adoptions 查历史候选/登记），
      探索后仍无合法来源，才用 ask_author 具体澄清是哪条消息/请作者贴出原文；不得默认先问作者。
    - 历史来源只有在“该来源的完整原文本身就是作者要保存的资料”时才能登记；历史指令、
      反馈、会话摘要、应用材料都不是原文。作者指代的对象必须完整存在于所选来源原文中：
      来源原文只是提到同一名词（例如“别改灯油设定”这类指令）、并不包含被指代的资料时，
      不得把它当作该资料的来源登记；此时应 explore 合法来源，或 ask_author 请作者指出/贴出原文。
      不能因为来源列表里有相似词就选它，也不能先登记再在回复里说明来源不含内容。
    - 原文来源必须明确：本条资料与已列出的历史资料分别引用，不能把来源缺失猜成当前
      保存指令。来源不明确时等待作者补充，不登记、不生成候选。
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

  def source_text(nil, _current_text, _context, _current_turn),
    do: {:error, {:author_content_registration_invalid, :source_required}}

  def source_text("current", current_text, _context, current_turn),
    do: {:ok, current_turn, current_text}

  def source_text(ref, _current_text, context, current_turn) do
    case Enum.find(author_sources(context, current_turn), &(&1.turn_ref == ref)) do
      %{text: text} -> {:ok, ref, text}
      _ -> {:error, {:author_content_registration_invalid, :source_not_available}}
    end
  end

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

  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
end
