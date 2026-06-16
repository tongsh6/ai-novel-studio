defmodule NovelAgent.Test.Provider.SliceVerify do
  @moduledoc """
  Deterministic provider for local slice verification.

  It returns planner-compatible JSON so Tauri slice journeys can verify the
  product chain without depending on an external LLM or the echo-only stub.
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.Result

  defstruct []

  @impl true
  def complete(_state, _model, prompt, _params) do
    prompt_text = prompt_text(prompt)

    content =
      cond do
        creative_items_prompt?(prompt_text) ->
          creative_items_response(prompt_text) |> Jason.encode!()

        plan_prompt?(prompt_text) ->
          plan_response(prompt_text) |> Jason.encode!()

        tool_narration_prompt?(prompt_text) ->
          tool_narration_response(prompt_text)

        true ->
          frame_response(prompt) |> Jason.encode!()
      end

    {:ok, Result.new(content)}
  end

  @impl true
  def health_check(_state), do: :ok

  @impl true
  def name, do: "slice_verify"

  defp plan_prompt?(prompt) do
    String.contains?(prompt, "plan_goal_summary") or String.contains?(prompt, "proposed_actions")
  end

  defp creative_items_prompt?(prompt) do
    String.contains?(prompt, "JSON 数组") and String.contains?(prompt, "artifact_type：")
  end

  defp tool_narration_prompt?(prompt) do
    String.contains?(prompt, "## 工具执行结果") and
      String.contains?(prompt, "请用 1-2 句自然中文")
  end

  defp frame_response(prompt) do
    exploratory = exploratory_prompt?(prompt)

    %{
      frame_type: if(exploratory, do: "creative_exploration", else: "casual_reply"),
      dialogue_goal_summary: "验证工作台对话主链",
      needs_tool: false,
      no_tool_reason: if(exploratory, do: "exploratory_only", else: "no_tool_needed"),
      execution_readiness: "not_applicable",
      assistant_message: frame_message(exploratory),
      candidate_directions: candidate_directions(exploratory, prompt),
      context_used: false,
      uncertainty: []
    }
  end

  defp exploratory_prompt?(prompt) do
    text = author_input_text(prompt)
    Enum.any?(["生成", "角色", "方向", "怎么切入", "小说创作"], &String.contains?(text, &1))
  end

  defp frame_message(true),
    do: "可以先从人物动机、核心冲突和世界规则三个方向拆开看。"

  defp frame_message(false), do: "可以，我们先围绕小说创作方向聊下去。"

  defp candidate_directions(true, prompt) do
    author_text = author_input_text(prompt)
    high_risk? = contains_any?(author_text, ["高风险", "覆盖主线", "重写设定", "推翻设定"])

    first =
      if high_risk? do
        %{
          title: "高风险主线覆盖",
          pitch: "直接覆盖既有主线设定，需要作者再次确认后才能采用。",
          tone_tags: ["主线", "高风险"],
          risk_hint: "high"
        }
      else
        %{
          title: "人物动机",
          pitch: "从主角最想得到但最难承受的东西切入。",
          tone_tags: ["人物", "冲突"],
          risk_hint: "low"
        }
      end

    [
      first,
      %{
        title: "世界规则",
        pitch: "先确定一个会持续制造选择压力的规则。",
        tone_tags: ["设定", "推进"],
        risk_hint: "low"
      }
    ]
  end

  defp candidate_directions(false, _prompt), do: []

  defp tool_narration_response(prompt) do
    cond do
      String.contains?(prompt, "character_design") ->
        "已生成角色设定草案，你可以查看内容后选择采纳、放弃或修改。"

      String.contains?(prompt, "prose_writing") ->
        "已生成正文草稿，请先审阅，采纳后才会进入阅读模式。"

      String.contains?(prompt, "plot_outline") ->
        "已生成大纲草案，你可以审阅后决定是否纳入作品结构。"

      true ->
        "已生成创作草稿，你可以继续查看、采纳或修改。"
    end
  end

  # 章节计划主题（确定性、稳定、可支撑长篇），用于 outline_draft 多章生成。
  @outline_chapter_themes ~w(觉醒 试炼 盟约 裂隙 暗流 突围 真相 背叛 抉择 决战 余烬 新生)

  defp creative_items_response(prompt) do
    {brief, context} = creative_prompt_parts(prompt)

    # 章节计划（plot_outline -> outline_draft）确定性产出多章，让 plan-minimum 等 slice
    # 在离线 provider 下也能演练「生成结构化章节计划」；其余 artifact_type 仍单条。
    if outline_plan_prompt?(prompt) do
      outline_chapter_items(brief, context)
    else
      text = [brief, context] |> Enum.reject(&(&1 == "")) |> Enum.join("\n")
      fingerprint = text |> :erlang.phash2() |> Integer.to_string(36)

      [
        %{
          item_id: "slice_item_#{fingerprint}_1",
          title: creative_title(brief, fingerprint),
          body: creative_body(brief, context),
          rationale: creative_rationale(brief)
        }
      ]
    end
  end

  defp outline_plan_prompt?(prompt), do: String.contains?(prompt, "artifact_type：outline_draft")

  # 章节计划生成具备增量感知（与真实 LLM 行为对称）：上下文里已有 N 章时，
  # 新计划从第 N+1 章接续编号（标题不与既有章相撞 → 采纳物化按 title 幂等追加）。
  defp outline_chapter_items(brief, context) do
    fingerprint =
      [brief, context]
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n")
      |> :erlang.phash2()
      |> Integer.to_string(36)

    start = existing_chapter_count(context) + 1

    @outline_chapter_themes
    |> Enum.with_index(start)
    |> Enum.map(fn {theme, n} ->
      seq = n |> Integer.to_string() |> String.pad_leading(2, "0")

      %{
        item_id: "slice_outline_#{fingerprint}_#{n}",
        title: "第#{seq}章：#{theme}",
        body: outline_chapter_body(theme, n),
        rationale: nil
      }
    end)
  end

  defp outline_chapter_body(theme, n) do
    """
    章功能定位：#{outline_chapter_role(n)}
    情节推进：围绕「#{theme}」推进主线第 #{n} 阶段。
    人物变化：主角在「#{theme}」压力下完成一次选择升级。
    信息释放：释放与「#{theme}」相关的新线索。
    伏笔动作：埋下「#{theme}」后续回收点。
    情绪定位：紧张、期待。
    章首拉力：以「#{theme}」相关异常开场。
    章尾断章：在「#{theme}」线索刚要揭晓时切断。
    字数与场次：约 3000 字，2 场。
    """
    |> String.trim()
  end

  defp outline_chapter_role(n) when rem(n, 5) == 0, do: "高潮章"
  defp outline_chapter_role(n) when rem(n, 3) == 0, do: "转折章"
  defp outline_chapter_role(_n), do: "推进章"

  # creative 上下文（DialogueContext.to_prompt_text）的「## 已采纳章节」段行数。
  defp existing_chapter_count(context) do
    case Regex.run(~r/##\s*已采纳章节[^\n]*\n(.*?)(?:\n##|\z)/su, context) do
      [_, block] ->
        block |> String.split("\n") |> Enum.count(&String.match?(&1, ~r/^\s*-\s+/))

      _ ->
        0
    end
  end

  defp plan_response(prompt) do
    author_text = author_input_text(prompt)
    tool_name = tool_name_for_prompt(author_text)

    {authoring_intent, target_chapter, requested_chapter_raw} =
      authoring_intent_for(prompt, author_text)

    target_word_count = target_word_count_from_text(author_text)
    rewrite? = authoring_intent == "rewrite"

    action =
      %{
        action_id: "act-slice-verify",
        action_type: "capability_invocation",
        summary: action_summary(tool_name),
        target_ref: tool_name,
        write_intent: if(rewrite?, do: "production_candidate", else: "tentative"),
        risk_hint: if(rewrite?, do: "high", else: "low")
      }
      |> maybe_put_authoring(authoring_intent, target_chapter)
      |> maybe_put_requested_chapter_raw(requested_chapter_raw)
      |> maybe_put_target_word_count(target_word_count)

    %{
      plan_goal_summary: "验证工作台 micro plan 入口",
      risk_hint: if(rewrite?, do: "high", else: "low"),
      requires_confirmation_hint: false,
      proposed_actions: [action],
      state_changes_requested: [],
      required_capabilities: [tool_name],
      fallback_message: "如果暂时不能生成，就先继续用对话收束方向。"
    }
  end

  defp maybe_put_authoring(action, nil, _chapter), do: action

  defp maybe_put_authoring(action, intent, chapter) do
    action
    |> Map.put(:authoring_intent, intent)
    |> Map.put(:target_chapter, chapter)
  end

  defp maybe_put_requested_chapter_raw(action, nil), do: action

  defp maybe_put_requested_chapter_raw(action, raw),
    do: Map.put(action, :requested_chapter_raw, raw)

  defp maybe_put_target_word_count(action, nil), do: action
  defp maybe_put_target_word_count(action, n), do: Map.put(action, :target_word_count, n)

  # 目标字数识别（确定性）：作者文本里的"约 N 字 / N 字"。与真实 LLM 的篇幅识别对称。
  defp target_word_count_from_text(text) do
    case Regex.run(~r/(\d+)\s*字/u, text) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  # 续写/重写意图识别（确定性）：仅当 plan prompt 已带「作品章节」列表时才可能续写/重写。
  # 作者「接着/继续/续写/往下写」→ continuation；「推翻/重写/改写」→ rewrite。
  # target_chapter 精确取自 prompt 的作品章节列表（与真实 LLM「精确复制」规则一致）。
  defp authoring_intent_for(prompt, author_text) do
    case accepted_chapters_in_prompt(prompt) do
      [] ->
        {nil, nil, nil}

      chapters ->
        intent =
          cond do
            contains_any?(author_text, ["推翻", "重写", "改写", "重新写"]) ->
              "rewrite"

            contains_any?(author_text, ["接着", "继续", "续写", "往下写", "再写", "补一段", "补写"]) ->
              "continuation"

            true ->
              nil
          end

        resolve_chapter_refs(intent, author_text, chapters)
    end
  end

  # 返回 {intent, target_chapter（planner 匹配到列表的全名，未匹配为 nil）, requested_chapter_raw（作者点名原文）}。
  # 与真实 LLM「精确匹配列表标题或置空」对称：按章号把作者点名的章对到列表全名。
  defp resolve_chapter_refs(nil, _author_text, _chapters), do: {nil, nil, nil}

  defp resolve_chapter_refs(intent, author_text, chapters) do
    case named_chapter_token(author_text) do
      nil ->
        # 未点名具体章（如"接着往下写"）：维持既有"默认归首章"行为，不报缺失。
        {intent, target_chapter_for(chapters), nil}

      token ->
        num = chapter_num(token)
        matched = num && Enum.find(chapters, fn title -> chapter_num(title) == num end)

        # 点名但匹配不到列表 → target_chapter=nil（block 信号）；匹配到 → 列表全名。
        {intent, matched, token}
    end
  end

  defp named_chapter_token(text) do
    case Regex.run(~r/第\s*[0-9零一二三四五六七八九十百两]+\s*章/u, text) do
      [token] -> String.replace(token, ~r/\s+/, "")
      _ -> nil
    end
  end

  @cn_digits %{
    "零" => 0,
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

  # 从"第N章"提取章号（Arabic 或中文 1-99），匹配不出为 nil。
  defp chapter_num(nil), do: nil

  defp chapter_num(text) when is_binary(text) do
    cond do
      match = Regex.run(~r/第\s*(\d+)\s*章/u, text) ->
        match |> Enum.at(1) |> String.to_integer()

      match = Regex.run(~r/第\s*([零一二三四五六七八九十百两]+)\s*章/u, text) ->
        cn_numeral(Enum.at(match, 1))

      true ->
        nil
    end
  end

  defp cn_numeral(s) do
    cond do
      s == "十" -> 10
      String.starts_with?(s, "十") -> 10 + cn_digit(String.slice(s, 1, 8))
      String.contains?(s, "十") -> cn_tens(s)
      true -> cn_digit(s)
    end
  end

  defp cn_tens(s) do
    [tens, ones] = String.split(s, "十", parts: 2)
    cn_digit(tens) * 10 + if(ones == "", do: 0, else: cn_digit(ones))
  end

  defp cn_digit(""), do: 0
  defp cn_digit(s), do: Map.get(@cn_digits, s, 0)

  defp accepted_chapters_in_prompt(prompt) do
    # planner 段头为「## 作品章节（…含已规划但还没写正文的章）」，正文章节列表取自此段。
    case Regex.run(~r/##\s*作品章节[^\n]*\n(.*?)(?:\n##|\z)/su, prompt) do
      [_, block] ->
        ~r/^\s*-\s*(.+?)\s*$/mu
        |> Regex.scan(block)
        |> Enum.map(fn [_, title] -> title end)
        |> Enum.reject(&(&1 == ""))

      _ ->
        []
    end
  end

  # checkpoint 1 单章续写：默认归第一章（与 driver 续写第 1 章一致）。
  defp target_chapter_for(chapters), do: List.first(chapters)

  defp tool_name_for_prompt(prompt) do
    cond do
      contains_any?(prompt, ["正文", "片段", "开场"]) ->
        "prose_writing"

      contains_any?(prompt, ["角色", "人物", "主角"]) ->
        "character_design"

      contains_any?(prompt, ["大纲", "章节"]) ->
        "plot_outline"

      true ->
        "world_building"
    end
  end

  defp action_summary("prose_writing"), do: "生成一段正文草稿"
  defp action_summary("character_design"), do: "生成一个角色设定草案"
  defp action_summary("plot_outline"), do: "生成一份大纲草案"
  defp action_summary("world_building"), do: "生成一组世界设定草案"
  defp action_summary(_), do: "生成一组可供作者继续选择的创作方向"

  defp contains_any?(text, terms) do
    Enum.any?(terms, &String.contains?(text, &1))
  end

  defp author_input_text(prompt) do
    prompt
    |> current_user_message()
    |> case do
      nil -> author_input_text_from_prompt(prompt_text(prompt))
      text -> text
    end
  end

  defp current_user_message(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.reverse()
    |> Enum.find_value(fn
      %{role: "user", content: content} -> content
      _message -> nil
    end)
  end

  defp current_user_message(_prompt), do: nil

  defp author_input_text_from_prompt(prompt) do
    case Regex.run(~r/用户消息：\s*(.*?)\s*$/s, prompt) do
      [_, text] ->
        text

      _ ->
        case Regex.run(~r/## 用户输入\s*(.*?)\s*## 输出格式/s, prompt) do
          [_, text] -> text
          _ -> prompt
        end
    end
  end

  defp creative_prompt_parts(prompt) do
    case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt) do
      [_, brief, context] ->
        {String.trim(brief), String.trim(context)}

      _ ->
        {author_input_text_from_prompt(prompt), ""}
    end
  end

  # 章节正文 item 标题取章节计划标题（"第N章：标题"，止于下一个分隔符），让采纳后的章节名
  # 是真实章名而非占位。无法识别章号时回退占位标题。
  defp creative_title(brief, fingerprint) do
    case Regex.run(~r/第\d+章[：:]\s*[^：:。\n]+/u, brief) do
      [chapter_title] -> String.trim(chapter_title)
      _ -> "待确认正文草稿 #{fingerprint}"
    end
  end

  defp creative_body(brief, context) do
    case {continuation_brief?(brief), target_word_count_in_brief(brief)} do
      {true, _} -> continuation_body(brief, context)
      {false, n} when is_integer(n) -> length_targeted_body(n, brief, context)
      {false, _} -> opening_body(brief, context)
    end
  end

  # 目标字数槽（Slice B）：作者明确篇幅诉求时，确定性产出有效字数贴近 N 的正文。
  # 以 opening_body 为骨架（含 nonce 句，保 I3），再用带序号的填充句补到 >= N；
  # 序号让句子字节互不相同（不靠重复同句注水）。有效字数落在 [N, N + 一句] 区间。
  defp length_targeted_body(target, brief, context) do
    base = opening_body(brief, context)
    fill_to_word_count([base], effective_count(base), target, 1)
  end

  defp fill_to_word_count(acc, count, target, _idx) when count >= target do
    acc |> Enum.reverse() |> Enum.join("\n")
  end

  defp fill_to_word_count(acc, count, target, idx) do
    line = filler_line(idx)
    fill_to_word_count([line | acc], count + effective_count(line), target, idx + 1)
  end

  defp filler_line(idx) do
    "他在第#{idx}道阵纹前停下脚步，指尖缓缓描过冷硬的刻痕，把这一处岔路的走向与气味默默记进心里。"
  end

  # 从创作简述里取作者篇幅诉求（turn_execution 注入的"目标字数：约 N 字"）。
  defp target_word_count_in_brief(brief) do
    case Regex.run(~r/目标字数：约\s*(\d+)\s*字/u, brief) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  # 有效字数口径与 NovelDomain.ProseWordCount 对齐（字母/表意文字/数字），
  # novel_agent 不依赖 novel_domain，故在此本地实现同口径正则。
  defp effective_count(text) do
    ~r/[^\p{L}\p{N}]/u |> Regex.replace(text, "") |> String.length()
  end

  defp continuation_brief?(brief) do
    contains_any?(brief, ["接着", "继续", "续写", "往下写", "再写", "补一段", "补写", "推翻", "重写", "改写"])
  end

  defp opening_body(brief, context) do
    subject = creative_subject(brief)
    nonce_text = context |> random_identifier_tokens() |> Enum.take(3) |> Enum.join("、")

    nonce_sentence =
      if nonce_text == "", do: "", else: "档案暗码 #{nonce_text} 像冷光一样贴在他的视野边缘，提醒这不是幻觉。"

    [
      "夜色压在#{subject}上，灵气账单从屋檐下垂落，像一串即将燃尽的符纸。",
      "主角停在巷口，听见远处公司巡检车的低鸣，也听见自己腕骨里那枚旧阵芯正在倒数。",
      nonce_sentence,
      "他没有立刻逃跑，而是把欠费记录折进袖中，反手扣住最后一张护身符，朝最黑的楼梯口走去。"
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  # 续写正文：单段约 500 有效字，2 轮续写叠加初稿（约 168）即可越过 P1 单章 1000 字门槛。
  # 各句互不相同（不靠重复段落注水）；fingerprint 让相邻续写不字节相同。
  defp continuation_body(brief, context) do
    fingerprint = [brief, context] |> Enum.join("|") |> :erlang.phash2() |> Integer.to_string(36)
    nonce_text = context |> random_identifier_tokens() |> Enum.take(2) |> Enum.join("、")

    nonce_line =
      if nonce_text == "",
        do: "矿道深处的旧阵芯仍在倒数，他听得见自己的心跳与符纸燃烧的细响交叠在一起。",
        else: "档案暗码 #{nonce_text} 在视野边缘明灭，像替这条矿道标好了退路与陷阱。"

    [
      "林澈把欠费记录折进袖口，借着护身符的微光辨认岔路，脚下碎石被踩出一连串闷响。",
      "矿道越往里越窄，潮湿的灵气贴着石壁缓缓流动，凝成一层会呼吸的薄霜。",
      "他想起母亲临走前的叮嘱，把翻涌的恐惧压回胸腔，逼自己一步一步丈量这片黑暗。",
      nonce_line,
      "前方传来金属摩擦的声响，像有什么东西在缓慢苏醒，又像巡检傀儡在重新校准刃口。",
      "他屏住呼吸贴着石壁挪动，指尖触到一道被人为凿开的暗槽，里面嵌着半枚冷却的阵钉。",
      "阵钉残留的纹路与他腕骨里的旧阵芯隐隐共鸣，刺痛顺着血管一路爬上后颈。",
      "他咬牙拔出阵钉，黑暗骤然裂开一线幽蓝，照亮墙上密密麻麻、尚未结清的灵气欠条。",
      "那一刻他才真正明白，这座矿区埋着的从来不是矿石，而是无数被账单困住的活人。",
      "身后的脚步声不紧不慢地逼近，他没有回头，只把阵钉攥得更紧，朝幽蓝走得更深。",
      "通道尽头是一扇半塌的阵门，门缝漏出的光像水一样在地面铺开，又被黑暗一点点吞回。",
      "他蹲下身，用阵钉在门槛上刻下一个只有自己看得懂的记号，给将来的退路留一道凭证。",
      "远处的低鸣忽然停了，整条矿道陷入令人牙酸的寂静，连灵气流动的声音都听得清楚。",
      "林澈知道，这种安静往往意味着对方已经发现了他，正等着他先露出破绽。",
      "他缓缓吐出一口浊气，把最后一张护身符贴在心口，做好了随时把命押上去的准备。",
      "黑暗里那串编号 #{fingerprint} 又一次在他脑海里亮起，提醒他记住走过的每一个拐角。"
    ]
    |> Enum.join("\n")
  end

  defp creative_subject(brief) do
    case Regex.run(~r/第\d+章[：:]\s*([^：:\n。]+?)(?:：|正文草稿|$)/u, brief) do
      [_, subject] ->
        String.trim(subject)

      _ ->
        "这座赛博修仙城市"
    end
  end

  defp creative_rationale(brief) do
    if String.contains?(brief, "正文草稿") do
      "根据作者指定章节生成待确认正文片段，未写入作品事实。"
    else
      "根据本次作者输入生成待确认创作素材，未写入作品事实。"
    end
  end

  defp random_identifier_tokens(text) do
    ~r/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b/u
    |> Regex.scan(text)
    |> Enum.map(fn [token] -> token end)
    |> Enum.uniq()
  end

  defp prompt_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_text(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.map_join("\n", fn message -> "#{message.role}: #{message.content}" end)
  end
end
