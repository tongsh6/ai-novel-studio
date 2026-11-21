defmodule NovelApplication.ChapterRevisionAuthorInput do
  @moduledoc """
  章修订的作者原话解释：修改范围、显式段/字面目标与章直接宾语。

  只消费本次原话和调用方已有事实，不读 DB、不调用模型、不选择或改写 chapter_ref。
  修改范围不等于材料覆盖；格式、局部限制、否定、条件保留既有优先级。
  新章宾语只接受肯定祈使句；“这一章”必须有同次原话中唯一明确的阅读先行词。
  引文、转述标点、问句、条件以及不能解析的表达不由新规则猜成整章。
  章号复用 ChapterDisplay，当前 work 内 seq 的唯一性由现 I-CH-3 约束保证。
  """

  @type scope :: :format_only | :whole_chapter | :target_segments

  alias NovelApplication.ChapterDisplay

  @format_only ~r/(只|仅).{0,10}(调整|调|改|做|整理).{0,10}(标点|分段|排版)|(标点|分段|排版).{0,10}(不改|不变|别改)|别改字句|字句.{0,6}(不变|别动)/u
  @format_only_negated ~r/(不是|并非|不要|别|无需).{0,8}(只|仅)?.{0,6}(标点|分段|排版)/u

  # 引用式目标：作者把“本轮读后发现的对象”指给修订，而不是直接给段号/字面。
  # 只认既有替换源 operand 内的发现/查找对象，不把泛读词或模型声明当授权。
  @replacement_verb ~r/改成|改为|替换为|替换成/u

  @discovery_source Regex.compile!(
                      "(?:发现|找出|找到|读到|看到|查到|检索出|检索到|核对出|核对到|注意到)" <>
                        "(?:到的|出的|来的|的|了|到|出|来|着)?[^，。；;]{0,16}" <>
                        "(?:写法|段落?|句子?|文字|内容|地方|部分|处|问题)",
                      "u"
                    )

  # 段号词法：授权判定（局部限制）与目标定位共用同一入口，避免两套表。
  @segment_ordinal_source "第\\s*(?:[0-9]+|[一二三四五六七八九十]+)\\s*段"

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
  @deny_modify Regex.compile!(
                 "(?:不要|别|先别|先不要|无需|不用|勿|不)(?:要|用|再)?\\s*" <>
                   "(?:#{@modify_verb}|修|处理|动笔|动)",
                 "u"
               )
  # 直接宾语共用一次解析：整章资格与章身份核验不得各选一个对象。
  @chapter_name "第\\s*(?:[0-9]+|[一二三四五六七八九十百千两]+)\\s*章(?:《[^《》\\n]+》)?"
  @chapter_body "(?:(?:(?:已经|已)保存的|的)?正文)?"
  @command_prefix "(?:(?:请|据此|先|再|并|然后|但|只|仅|需要)\\s*)*"
  @read_verb "(?:参考|阅读|读取|读完|读|通读)"
  @read_prefix "(?:#{@read_verb}(?:#{@chapter_name}|#{@whole_range})#{@chapter_body}(?:全文)?(?:后|并|再)?|通读并)?"
  @chapter_object "(#{@chapter_name}|这一章|#{@whole_range})"
  @object_before Regex.compile!(
                   "^#{@command_prefix}#{@read_prefix}#{@command_prefix}把(?:已保存的|已经保存的)?" <>
                     "#{@chapter_object}(.*?)#{@modify_verb}(.*)$",
                   "u"
                 )
  @object_after Regex.compile!(
                  "^#{@command_prefix}#{@read_prefix}#{@command_prefix}(?:#{@whole_range})?" <>
                    "#{@modify_verb}#{@chapter_object}(.*)$",
                  "u"
                )
  @whole_operand Regex.compile!("^#{@chapter_body}(?:#{@whole_range})?$", "u")
  # 成/为/得是结果或程度补语边界，不枚举输出名称、风格目标或候选措辞。
  @result_modifier Regex.compile!("^#{@chapter_body}(?:#{@whole_range})?(?:成|为|得)", "u")
  @local_operand Regex.compile!(
                   "^(?:的|正文(?:里|中)|#{@segment_ordinal_source}|开头|结尾|最后一段|" <>
                     "指定段|这句|这处|错别字|标点|分段|排版)",
                   "u"
                 )
  @read_chapters "#{@chapter_name}(?:(?:和|及|与|、)#{@chapter_name})*"
  @read_chapter Regex.compile!(
                  "^#{@command_prefix}(?:#{@read_verb}(#{@read_chapters})#{@chapter_body}(?:全文)?" <>
                    "(?:一遍|一下)?(?:$|后|并|再|(?=#{@modify_verb}|把))|" <>
                    "把(#{@read_chapters})#{@chapter_body}(?:从头到尾)?#{@read_verb}" <>
                    "(?:一遍|一下)?(?:$|后|并|再))",
                  "u"
                )
  @chapter_mentions Regex.compile!(@chapter_name, "u")
  @book_title ~r/《[^《》]*》/u
  @quoted_operand ~S/(?:"[^"]+"|「[^「」]+」|“[^“”]+”|『[^『』]+』)/
  # 先将完整引号作为词法单元，再分句；其中的标点、段号和动词都是数据。
  @clause Regex.compile!("(?:#{@quoted_operand}|[^，,。；;！!\\n])+", "u")
  @literal_command Regex.compile!(
                     "^(#{@command_prefix}(?:把|将)?(?:(?:已保存的|已经保存的)?#{@chapter_name}#{@chapter_body}(?:里|中)的?)?)" <>
                       "(#{@quoted_operand}|[^「」“”\"『』]+?)\\s*(#{Regex.source(@replacement_verb)})\\s*" <>
                       "(#{@quoted_operand}|[^「」“”\"『』]+)$",
                     "u"
                   )
  @source_control Regex.compile!(
                    "#{@modify_verb}|#{Regex.source(@replacement_verb)}|把|将|章|《",
                    "u"
                  )
  @quoted_literal Regex.compile!("^#{@quoted_operand}$", "u")
  @segment_reference "(?:#{@segment_ordinal_source}|开头(?:一段)?|结尾|最后一段)"
  @segment_mentions Regex.compile!(@segment_reference, "u")
  @segment_detail "(?:(?:里|中)的?(?:指定)?(?:句子|文字|内容))?"
  @segment_location "(?:(?:#{@chapter_name}|这一章)#{@chapter_body})?(?:的)?"
  @segment_command Regex.compile!(
                     "^#{@command_prefix}#{@read_prefix}#{@command_prefix}(?:#{@whole_range})?" <>
                       "(?:(?:#{@modify_verb}|修|处理)#{@segment_location}#{@segment_reference}#{@segment_detail}|" <>
                       "(?:把|将)?#{@segment_location}#{@segment_reference}#{@segment_detail}" <>
                       "(?:#{@modify_verb}|修|处理)(?:一下|一遍|(?:成|为|得).+)?)$",
                     "u"
                   )
  @preserve_segments Regex.compile!(
                       "^#{@command_prefix}(?:保留|保持)#{@segment_reference}" <>
                         "(?:(?:和|及|与|、)#{@segment_reference})*(?:的(?:线索|内容|文字))?(?:不变)?$",
                       "u"
                     )
  @affirmative_edit Regex.compile!(
                      "^#{@command_prefix}#{@read_prefix}#{@command_prefix}" <>
                        "(?:(?:把|将).+(?:#{@modify_verb}|修|处理)|(?:#{@modify_verb}|修|处理)).*",
                      "u"
                    )
  # 旧邻近匹配只识别未解析的范围表达，不能授予授权。
  @whole_signal Regex.compile!(
                  "#{@whole_range}[^，,。；;]{0,12}#{@modify_verb}|" <>
                    "#{@modify_verb}[^，,。；;]{0,12}#{@whole_range}",
                  "u"
                )
  @implicit_whole Regex.compile!(
                    "^#{@command_prefix}#{@read_prefix}#{@command_prefix}" <>
                      "(?:给我(?:一份)?#{@whole_range}#{@modify_verb}(?:候选|稿)|" <>
                      "(?:#{@whole_range}#{@modify_verb}|#{@modify_verb}#{@whole_range}#{@chapter_body})" <>
                      "(?:(?:成|为|得).+)?)$",
                    "u"
                  )
  @uncertain_command ~r/[「」“”"'『』\x60>：:？?]|如果|若|假如|要是|万一|一旦|如有|除非|是否|能否|要不要|吗(?:[，,。；;]|$)/u
  @denied_chapter Regex.compile!(
                    "(?:不要|别|先别|先不要|无需|不用|勿|不)(?:要|用|再)?" <>
                      "(?:把#{@chapter_object}[^，,。；;]*?#{@modify_verb}|" <>
                      "(?:#{@whole_range})?#{@modify_verb}#{@chapter_object})",
                    "u"
                  )

  @doc "原话判定的范围投影；明确拒绝与未知对象不降级成可绑定的局部授权。"
  @spec authorize(String.t() | nil) :: {:ok, scope()} | {:error, :author_scope_not_authorized}
  def authorize(text) do
    with {:ok, intent} <- author_intent(text), do: {:ok, intent.scope}
  end

  @doc "消费同一原话判定核已选章；不重新授权、不定位新章、不恢复拒绝结果。"
  def validate_target(text, %{chapter_title: title}) do
    with {:ok, intent} <- author_intent(text) do
      if intent.chapter == :implicit or chapter_target_matches?(intent.chapter, title),
        do: :ok,
        else: {:error, :author_scope_not_authorized}
    end
  end

  @doc """
  只消费安全判定产生的单一段操作数与精确替换源，不再回扫作者全文。
  段号与字面命中须一致；未知/越界段号返回 target_missing，重复命中返回
  target_ambiguous；不能完整识别的组合/排除关系拒绝授权，不回退首段。
  """
  @spec target_segment_ids([map()], String.t()) ::
          {:ok, [String.t()]}
          | {:error,
             :target_missing
             | :target_ambiguous
             | :incomplete_scope
             | :author_scope_not_authorized}
  def target_segment_ids(segments, text) do
    with {:ok, intent} <- author_intent(text),
         {:ok, ordinal} <- ordinal_target_ids(segments, intent.ordinal),
         {:ok, literal} <- locate_revision_literal(segments, intent.replacement) do
      case Enum.uniq([ordinal, literal]) |> Enum.reject(&(&1 == [])) do
        [ids] -> {:ok, ids}
        [] -> {:error, :incomplete_scope}
        _targets -> {:error, :target_ambiguous}
      end
    end
  end

  @doc "显式段或字面目标来自同一安全判定；模型选段不得覆盖作者给出的对象。"
  def explicit_target?(text),
    do: authorized?(text, &(&1.ordinal != nil or match?({:literal, _}, &1.replacement)))

  @doc "读后发现的对象仍须经 ChapterReadEvidence 核验真实页面，不从模型声明授权。"
  def reference_discovery_target?(text), do: authorized?(text, &(&1.replacement == :discovery))

  @doc "实际局部限制的投影；拒绝、引文与未知关系不能进入观察选段分支。"
  def local_target_authorized?(text), do: authorized?(text, & &1.local?)

  defp authorized?(text, predicate) do
    case author_intent(text) do
      {:ok, intent} -> predicate.(intent)
      {:error, _reason} -> false
    end
  end

  defp locate_revision_literal(_segments, replacement) when replacement in [nil, :discovery],
    do: {:ok, []}

  defp locate_revision_literal(_segments, {:literal, ""}), do: {:error, :target_missing}

  defp locate_revision_literal(segments, {:literal, literal}) do
    base = Enum.map_join(segments, & &1.raw)

    with {offset, _length} <- :binary.match(base, literal),
         :nomatch <-
           :binary.match(base, literal, scope: {offset + 1, byte_size(base) - offset - 1}),
         %{segment_id: id} <- Enum.find(segments, &String.contains?(&1.raw, literal)) do
      {:ok, [id]}
    else
      missing when missing in [:nomatch, nil] -> {:error, :target_missing}
      _match -> {:error, :target_ambiguous}
    end
  end

  defp ordinal_target_ids(_segments, nil), do: {:ok, []}

  defp ordinal_target_ids(segments, operand) do
    with number when is_integer(number) and number > 0 <-
           ordinal_number(operand, length(segments)),
         %{segment_id: id} <- Enum.at(segments, number - 1) do
      {:ok, [id]}
    else
      _missing -> {:error, :target_missing}
    end
  end

  defp ordinal_number(first, _count) when first in ["开头", "开头一段"], do: 1
  defp ordinal_number(last, count) when last in ["结尾", "最后一段"], do: count

  defp ordinal_number(ordinal, _count) do
    ordinal
    |> String.trim_leading("第")
    |> String.trim_trailing("段")
    |> String.trim()
    |> NovelFoundation.parse_ordinal()
  end

  defp decide(text, clauses, target, local?) do
    format? =
      Enum.any?(clauses, &Regex.match?(@format_only, &1)) and
        not Enum.any?(clauses, &Regex.match?(@format_only_negated, &1))

    cond do
      format? ->
        {:ok, :format_only}

      local? ->
        {:ok, :target_segments}

      match?({:ok, _, :whole_chapter}, target) ->
        {:ok, :whole_chapter}

      Regex.match?(@deny_modify, text) and Regex.match?(@read_only, text) ->
        {:error, :author_scope_not_authorized}

      true ->
        {:ok, :target_segments}
    end
  end

  defp split_clauses(text) do
    @clause
    |> Regex.scan(text, capture: :first)
    |> List.flatten()
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  # 局部限制不把“别改字句”的格式约束视为内容授权，format_only 保持优先。
  defp local_limit?(clause) do
    Regex.match?(@local_limit, clause) and not Regex.match?(@format_only, clause)
  end

  defp author_intent(text) when is_binary(text) do
    {clauses, replacements} =
      text |> split_clauses() |> Enum.map(&command_parts/1) |> Enum.unzip()

    with false <- unsafe_author_input?(clauses),
         {:ok, ordinal} <- segment_operand(clauses),
         {:ok, replacement} <- single_operand(replacements),
         direct = direct_chapter_targets(clauses),
         local? =
           ordinal != nil or replacement != nil or Enum.any?(clauses, &local_limit?/1),
         {:ok, scope} <- decide(Enum.join(clauses, "\n"), clauses, direct, local?),
         {:ok, chapter} <- resolve_author_target(direct, scope, local?, clauses) do
      {:ok,
       %{
         scope: scope,
         chapter: chapter,
         ordinal: ordinal,
         replacement: replacement,
         local?: local?
       }}
    else
      true -> {:error, :author_scope_not_authorized}
      {:error, _reason} = error -> error
    end
  end

  defp author_intent(_text), do: author_intent("")

  # 只对完整替换命令解包字面；替换结果从不参与段号、操作数或章身份判断。
  defp command_parts(clause) do
    case Regex.run(@literal_command, clause, capture: :all_but_first) do
      [prefix, source, verb, result] ->
        extra_action? =
          not Regex.match?(@quoted_literal, result) and Regex.match?(@replacement_verb, result)

        operand = if extra_action?, do: :unsafe, else: replacement_source(source, clause)
        {prefix <> verb, operand}

      _ ->
        {clause, nil}
    end
  end

  defp replacement_source(source, clause) do
    cond do
      Regex.match?(@quoted_literal, source) ->
        {:literal, String.slice(source, 1, String.length(source) - 2)}

      Regex.match?(@discovery_source, source) and Regex.match?(@affirmative_edit, clause) ->
        :discovery

      Regex.match?(@source_control, source) or Regex.match?(@uncertain_command, source) ->
        :unsafe

      true ->
        {:literal, String.trim(source)}
    end
  end

  defp single_operand(operands) do
    case Enum.reject(operands, &is_nil/1) do
      [] -> {:ok, nil}
      [operand] when operand != :unsafe -> {:ok, operand}
      _ -> {:error, :author_scope_not_authorized}
    end
  end

  # 完整单一肯定命令才产生段操作数；前缀肯定不能替整句任意尾巴授权。
  defp segment_operand(clauses) do
    operands =
      for clause <- clauses,
          context = String.replace(clause, @book_title, ""),
          Regex.match?(@segment_mentions, context),
          not Regex.match?(@preserve_segments, context) do
        segment_command_operand(context)
      end

    single_operand(operands)
  end

  defp segment_command_operand(context) do
    case Regex.scan(@segment_mentions, context, capture: :first) do
      [[operand]] ->
        if Regex.match?(@segment_command, context), do: operand, else: :unsafe

      _ ->
        :unsafe
    end
  end

  defp unsafe_author_input?(clauses) do
    context = clauses |> Enum.join("\n") |> String.replace(@book_title, "")

    Regex.match?(@uncertain_command, context) or Regex.match?(@denied_chapter, context) or
      Enum.any?(clauses, &(Regex.run(@deny_modify, &1, capture: :first) == [&1]))
  end

  # G2/显式局部或字面目标只复用原话的唯一阅读先行词；实际页/选段信用仍由
  # ChapterReadEvidence 核验，此处不把“要求读”冒充“实际已读”。
  defp resolve_author_target(:absent, scope, local?, clauses) do
    if (local? or scope == :format_only) and
         Enum.any?(clauses, &Regex.match?(@chapter_mentions, &1)) do
      target = bind_chapter_object({"这一章", :target_segments}, clauses)
      resolve_author_target(unique_chapter_target([target]), scope, local?, clauses)
    else
      {:ok, :implicit}
    end
  end

  defp resolve_author_target({:ok, chapter, _kind}, _scope, _local?, _clauses), do: {:ok, chapter}

  defp resolve_author_target(_target, _scope, _local?, _clauses),
    do: {:error, :author_scope_not_authorized}

  defp direct_chapter_targets(clauses) do
    clauses
    |> Enum.with_index()
    |> Enum.flat_map(&chapter_clause_target(&1, clauses))
    |> Enum.uniq()
    |> unique_chapter_target()
  end

  defp chapter_clause_target({clause, index}, clauses) do
    case chapter_command_object(clause) do
      nil -> []
      object -> [bind_chapter_object(object, Enum.take(clauses, index + 1))]
    end
  end

  defp implicit_chapter_object(clause) do
    named = String.replace(clause, Regex.compile!(@whole_range, "u"), "")

    cond do
      Regex.match?(@implicit_whole, clause) ->
        {"整章", :whole_chapter}

      (String.contains?(named, ["章", "《"]) and not Regex.match?(@read_chapter, clause)) or
          (Regex.match?(@whole_signal, clause) and not Regex.match?(@negated_whole_modify, clause)) ->
        :unbound

      true ->
        nil
    end
  end

  defp chapter_command_object(clause) do
    case Regex.run(@object_before, clause, capture: :all_but_first) ||
           Regex.run(@object_after, clause, capture: :all_but_first) do
      [object, operand, result] ->
        command_object(object, operand, result, :before)

      [object, tail] ->
        command_object(object, tail, "", :after)

      _ ->
        implicit_chapter_object(clause)
    end
  end

  defp command_object(object, operand, result, position) do
    tail = operand <> result

    if Regex.match?(@chapter_mentions, tail) or String.contains?(tail, "这一章"),
      do: :unbound,
      else: {object, command_scope(operand, position)}
  end

  defp command_scope(operand, position) do
    cond do
      Regex.match?(@whole_operand, operand) -> :whole_chapter
      position == :after and Regex.match?(@result_modifier, operand) -> :whole_chapter
      Regex.match?(@local_operand, operand) -> :target_segments
      true -> :unknown
    end
  end

  defp bind_chapter_object({object, kind}, clauses)
       when object in ["这一章", "整章", "全章", "整篇", "全文"] do
    reads =
      clauses
      |> Enum.flat_map(&(Regex.run(@read_chapter, &1, capture: :all_but_first) || []))
      |> Enum.reject(&(&1 == ""))
      |> Enum.uniq()

    mentions =
      @chapter_mentions
      |> Regex.scan(Enum.join(clauses, "\n"), capture: :first)
      |> List.flatten()
      |> Enum.uniq()

    case {reads, mentions} do
      {[target], [target]} -> {target, kind}
      {[], []} when object != "这一章" -> {:implicit, kind}
      _ -> :unbound
    end
  end

  defp bind_chapter_object(object, _clauses), do: object
  defp unique_chapter_target([]), do: :absent

  defp unique_chapter_target([{:implicit, kind}]) when kind in [:whole_chapter, :target_segments],
    do: {:ok, :implicit, kind}

  defp unique_chapter_target([{target, kind}]) when kind in [:whole_chapter, :target_segments] do
    case ChapterDisplay.title_number(target) do
      number when is_integer(number) and number > 0 -> {:ok, target, kind}
      _ -> :unbound
    end
  end

  defp unique_chapter_target(_targets), do: :unbound

  defp chapter_target_matches?(target, title) do
    ChapterDisplay.title_number(target) == ChapterDisplay.title_number(title) and
      case Regex.run(~r/《([^《》]+)》/u, target, capture: :all_but_first) do
        [named_title] -> named_title == ChapterDisplay.core_title(title)
        _ -> true
      end
  end
end
