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

  defp outline_chapter_items(brief, context) do
    fingerprint =
      [brief, context] |> Enum.reject(&(&1 == "")) |> Enum.join("\n") |> :erlang.phash2() |> Integer.to_string(36)

    @outline_chapter_themes
    |> Enum.with_index(1)
    |> Enum.map(fn {theme, n} ->
      seq = n |> Integer.to_string() |> String.pad_leading(2, "0")

      %{
        item_id: "slice_outline_#{fingerprint}_#{n}",
        title: "第#{seq}章：#{theme}",
        body: "第#{seq}章梗概：围绕「#{theme}」推进主线第 #{n} 阶段。",
        rationale: nil
      }
    end)
  end

  defp plan_response(prompt) do
    author_text = author_input_text(prompt)
    tool_name = tool_name_for_prompt(author_text)
    {authoring_intent, target_chapter} = authoring_intent_for(prompt, author_text)
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

  # 续写/重写意图识别（确定性）：仅当 plan prompt 已带「作品章节」列表时才可能续写/重写。
  # 作者「接着/继续/续写/往下写」→ continuation；「推翻/重写/改写」→ rewrite。
  # target_chapter 精确取自 prompt 的作品章节列表（与真实 LLM「精确复制」规则一致）。
  defp authoring_intent_for(prompt, author_text) do
    case accepted_chapters_in_prompt(prompt) do
      [] ->
        {nil, nil}

      chapters ->
        cond do
          contains_any?(author_text, ["推翻", "重写", "改写", "重新写"]) ->
            {"rewrite", target_chapter_for(chapters)}

          contains_any?(author_text, ["接着", "继续", "续写", "往下写", "再写", "补一段", "补写"]) ->
            {"continuation", target_chapter_for(chapters)}

          true ->
            {nil, nil}
        end
    end
  end

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
    if continuation_brief?(brief),
      do: continuation_body(brief, context),
      else: opening_body(brief, context)
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
