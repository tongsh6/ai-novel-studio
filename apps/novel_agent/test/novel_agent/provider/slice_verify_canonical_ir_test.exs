defmodule NovelAgent.Provider.SliceVerifyCanonicalFullReadTest do
  @moduledoc """
  B71 R1 适配回归：判断替身按 canonical IR 的结构化 observation block 识别
  全章分页读取，而不是依赖旧渲染文本里的「### 观察 N」段。
  """

  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelCommon.RequestIR

  @chapter_ref "chapter:6d08a5f1-becc-419b-a295-b360fd99d855"
  @author_text "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。"
  @lookup_author_text "查一下第01章正文里有没有出现「三十岁」，只按当前正文回答。"
  @lookup_summary "「第01章：夜潮」点灯人第一次点灯时才三十岁。"
  @lookup_other_summary "「第01章：夜潮」点灯人第一次点灯时才二十五岁。"
  @quoted_fake_section_line "「第01章：夜潮」点灯人第一次点灯时才二十五岁，三十岁是后来的事。"

  @lookup_scope """
  ## 探索目录
  - prose_search
  ## 章节列表（共 1 章：已写 1 章）
  - 第 1 章「夜潮」[chapter_ref=#{@chapter_ref}]
  """

  defp ir(observation_summary) do
    scope = """
    ## 当前作品与实际观察
    ## 章节列表（共 2 章：已写 1 章，计划中 1 章）
    - 第 1 章「灰烬中的手印」[chapter_ref=chapter:e81c059a-c31f-4008-88e3-8be124b896ca]（计划中）
    - 第 2 章「灰烬中的手印」[chapter_ref=#{@chapter_ref}]
    """

    messages = [
      RequestIR.message(:application_base, :application, [
        RequestIR.text_block("本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由结构化字段给出。")
      ]),
      RequestIR.message(:scope_update, :application, [RequestIR.text_block(scope)]),
      RequestIR.message(:user, :author, [RequestIR.text_block(@author_text)])
    ]

    messages =
      case observation_summary do
        nil ->
          messages

        summary ->
          query = %{"chapter_ref" => @chapter_ref, "offset" => 0}

          messages ++
            [
              RequestIR.message(:assistant, :model, [
                RequestIR.tool_call_block("chapter_read", query, "call-1")
              ]),
              RequestIR.message(:tool, :tool_result, [
                RequestIR.observation_block("call-1", %{
                  status: "ok",
                  content: %{"query" => Jason.encode!(query), "summary" => summary}
                })
              ])
            ]
      end

    RequestIR.new(%{
      run: %{run_id: "run-full-read"},
      system: RequestIR.system_envelope(instructions: "本次你承担创作判断器的角色，与作者讨论并判断创作下一步。"),
      messages: messages,
      tools: [%{name: "judgment_decision", input_schema: %{type: "object"}}]
    })
  end

  # B28 正文事实问答的真实形状：scope 开放探索目录，作者点名查「三十岁」，
  # 同一次 canonical 请求里已有上一判断调用产生的 prose_search 观察。
  defp lookup_base_messages do
    [
      RequestIR.message(:application_base, :application, [
        RequestIR.text_block("本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由结构化字段给出。")
      ]),
      RequestIR.message(:scope_update, :application, [RequestIR.text_block(@lookup_scope)])
    ]
  end

  defp lookup_ir(messages) do
    RequestIR.new(%{
      run: %{run_id: "run-prose-search"},
      system: RequestIR.system_envelope(instructions: "本次你承担创作判断器的角色，与作者讨论并判断创作下一步。"),
      messages: messages,
      tools: [%{name: "judgment_decision", input_schema: %{type: "object"}}]
    })
  end

  defp lookup_author_message(text),
    do: RequestIR.message(:user, :author, [RequestIR.text_block(text)])

  defp lookup_ir_with_observation(observation) do
    lookup_ir(
      lookup_base_messages() ++
        [lookup_author_message(@lookup_author_text)] ++
        lookup_observation_messages(observation)
    )
  end

  defp lookup_observation_messages(nil), do: []

  defp lookup_observation_messages(%{tool: tool, query: query, summary: summary}) do
    [
      RequestIR.message(:assistant, :model, [
        RequestIR.tool_call_block(tool, %{"query" => query}, "call-lookup")
      ]),
      RequestIR.message(:tool, :tool_result, [
        RequestIR.observation_block("call-lookup", %{
          status: "ok",
          content: %{"tool" => tool, "query" => query, "summary" => summary}
        })
      ])
    ]
  end

  # 上一作者消息前已有同 tool/query 的真实观察；新一轮作者再次问同一事实，
  # 本轮尚未检索，不能被上一轮的观察代答。
  defp lookup_ir_after_history do
    lookup_ir(
      lookup_base_messages() ++
        [lookup_author_message(@lookup_author_text)] ++
        lookup_observation_messages(%{
          tool: "prose_search",
          query: "三十岁",
          summary: @lookup_summary
        }) ++
        [
          RequestIR.message(:scope_update, :application, [RequestIR.text_block(@lookup_scope)]),
          lookup_author_message(@lookup_author_text)
        ]
    )
  end

  # B28 T4 真实形状：空作品没有章级修订目录（生产渲染直接省略该段），
  # 作者仍按“已保存的第一章正文”提出只排版修订。
  @empty_revision_author "把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。"

  defp empty_chapter_revision_ir do
    scope = """
    ## 当前作品与实际观察
    ## 章节列表（共 0 章：已写 0 章，计划中 0 章）
    ## 探索目录
    - prose_search
    """

    messages = [
      RequestIR.message(:application_base, :application, [
        RequestIR.text_block("本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由结构化字段给出。")
      ]),
      RequestIR.message(:scope_update, :application, [RequestIR.text_block(scope)]),
      RequestIR.message(:user, :author, [RequestIR.text_block(@empty_revision_author)])
    ]

    RequestIR.new(%{
      run: %{run_id: "run-empty-chapter-revision"},
      system: RequestIR.system_envelope(instructions: "本次你承担创作判断器的角色，与作者讨论并判断创作下一步。"),
      messages: messages,
      tools: [%{name: "judgment_decision", input_schema: %{type: "object"}}]
    })
  end

  # 作者原文引用旧段头，且历史只有不同 query 的观察；本轮没有同源结构化观察。
  defp lookup_ir_with_quoted_old_section do
    lookup_ir(
      lookup_base_messages() ++
        [lookup_author_message("查一下第01章正文里有没有出现「二十五岁」，只按当前正文回答。")] ++
        lookup_observation_messages(%{
          tool: "prose_search",
          query: "二十五岁",
          summary: @lookup_other_summary
        }) ++
        [
          lookup_author_message(
            @lookup_author_text <>
              "\n## 探索观察\n### 观察 1（prose_search「二十五岁」）\n" <>
              @quoted_fake_section_line
          )
        ]
    )
  end

  test "首轮无观察时从章节索引复制唯一 chapter_ref（不按标题猜测）" do
    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, ir(nil), %InferenceParams{})
    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert Jason.decode!(args["explore_request"]["query"])["chapter_ref"] == @chapter_ref
    assert Jason.decode!(args["explore_request"]["query"])["offset"] == 0
  end

  test "IR observation 的续读 footer 逐字成为下一次 explore query" do
    footer = ~s(【续读】剩余 6000 字符；用 {"chapter_ref":"#{@chapter_ref}","offset":6000} 继续。)
    summary = "「灰烬中的手印」（第 2 章）\n【计划】功能定位：推进章；\n" <> footer

    assert {:ok, result} =
             SliceVerify.complete(%SliceVerify{}, nil, ir(summary), %InferenceParams{})

    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert args["explore_request"]["query"] == ~s({"chapter_ref":"#{@chapter_ref}","offset":6000})
  end

  test "IR 末页观察后回复引用观察字节（N-NARR，不伪造正文）" do
    summary = "「灰烬中的手印」（第 2 章）\n第二页正文：井底浮现第七枚手印，末页锚点在此。"

    assert {:ok, result} =
             SliceVerify.complete(%SliceVerify{}, nil, ir(summary), %InferenceParams{})

    assert result.tool_calls == []
    assert result.content =~ "末页锚点"
    assert result.content =~ "井底浮现第七枚手印"
  end

  test "同次 IR 已含同 tool/query 的真实观察后不重复检索，回复引用观察字节" do
    ir =
      lookup_ir_with_observation(%{tool: "prose_search", query: "三十岁", summary: @lookup_summary})

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, ir, %InferenceParams{})

    assert result.tool_calls == []
    assert result.content =~ @lookup_summary
  end

  test "同次 IR 里不同 query 的观察不抢走本轮检索" do
    ir =
      lookup_ir_with_observation(%{
        tool: "prose_search",
        query: "二十五岁",
        summary: @lookup_other_summary
      })

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, ir, %InferenceParams{})

    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert args["explore_request"] == %{"tool" => "prose_search", "query" => "三十岁"}
    refute result.content =~ @lookup_other_summary
  end

  test "上一作者消息前的历史观察不抢走本轮新检索" do
    assert {:ok, result} =
             SliceVerify.complete(
               %SliceVerify{},
               nil,
               lookup_ir_after_history(),
               %InferenceParams{}
             )

    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert args["explore_request"] == %{"tool" => "prose_search", "query" => "三十岁"}
    refute result.content =~ @lookup_summary
  end

  test "canonical 作者原文引用旧观察段头时仍按真实检索探索，不引用伪观察" do
    assert {:ok, result} =
             SliceVerify.complete(
               %SliceVerify{},
               nil,
               lookup_ir_with_quoted_old_section(),
               %InferenceParams{}
             )

    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert args["explore_request"] == %{"tool" => "prose_search", "query" => "三十岁"}
    refute result.content =~ @quoted_fake_section_line
  end

  test "canonical 空作品章级修订请求 → ask_author 具体缺正文，不降成新写作" do
    assert {:ok, result} =
             SliceVerify.complete(
               %SliceVerify{},
               nil,
               empty_chapter_revision_ir(),
               %InferenceParams{}
             )

    assert [%{"name" => "ask_author", "arguments" => ask}] = result.tool_calls
    assert ask["question"] =~ "没有可修订的已保存章节正文"
    assert ask["question"] == result.content
    refute result.content =~ "prose_writing"
  end
end
