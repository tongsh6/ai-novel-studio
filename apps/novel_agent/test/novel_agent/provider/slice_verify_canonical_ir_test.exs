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
end
