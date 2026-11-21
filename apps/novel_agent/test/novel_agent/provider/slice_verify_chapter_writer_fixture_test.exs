defmodule NovelAgent.Provider.SliceVerifyChapterWriterFixtureTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelTest.TestRequestIR, as: IR

  @base_text "初稿：陈九斤二十五岁守灯楼，第七盏灯不点自亮。\n\n续写：灯楼九层，每层九盏，他数到第九层时天边泛白。"

  defp fixture_body(result) do
    [call] = result.tool_calls
    items = Map.get(call.arguments, :items) || Map.get(call.arguments, "items")
    hd(items)["body"]
  end

  defp writer_prompt(revision_heading, author_words, modification_scope, targets \\ nil) do
    targets = targets || [%{segment_id: "seg_0_source", sha256: "source-hash", text: @base_text}]

    target_context =
      if modification_scope == "target_segments",
        do: "\n\n## 本轮局部修订目标段\n" <> Jason.encode!(targets),
        else: ""

    IR.ir(
      [
        IR.system("本次你承担小说正文写作助手的角色。\n## 创作协作共同规则\n" <> revision_heading),
        IR.author(author_words),
        IR.scope(%{
          authoring_task: %{scope: %{modification_scope: modification_scope}},
          operation: %{
            capability: "prose_writing",
            artifact_type: "prose_fragment",
            creative_brief: "修订第01章正文。作者原话：" <> author_words,
            context_text:
              "第01章：夜潮当前已采纳正文（覆盖顺序：scene seq 升序，片段之间以空行分隔）：\n" <> @base_text <> target_context
          }
        })
      ],
      tools: [IR.tool("submit_tentative_artifact")],
      projection: %{tool_choice: "submit_tentative_artifact"}
    )
  end

  test "target_segments writer prompt 命中章级修订 fixture 并只落实明确改动" do
    prompt =
      writer_prompt(
        "## 指定修订片段内容修订（target_segments）",
        "把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。",
        "target_segments"
      )

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    body = fixture_body(result)

    assert body =~ "三十岁"
    refute body =~ "二十五岁"
    assert body =~ "灯楼九层，每层九盏"
    assert body =~ "第七盏灯不点自亮"
  end

  test "首个 canonical writer 保留 Base 中的修订规则，不能只取 scope 当成普通起草" do
    author = "把二十五岁改成三十岁，其余逐字不变。"
    prompt = writer_prompt("## 指定修订片段内容修订（target_segments）", author, "target_segments")

    corrections = [
      IR.assistant("前一次响应格式错误。"),
      IR.notice("【应用数据 · application_notice · 非作者原话】\n请按原任务正确输出。")
    ]

    for suffix <- [[], corrections] do
      assert {:ok, result} =
               SliceVerify.complete(
                 nil,
                 nil,
                 %{prompt | messages: prompt.messages ++ suffix},
                 %InferenceParams{}
               )

      assert [%{name: "submit_tentative_artifact", arguments: %{items: [item]}}] =
               result.tool_calls

      assert item["body"] == String.replace(@base_text, "二十五岁", "三十岁")
      assert item["target_segment_ids"] == ["seg_0_source"]
    end
  end

  test "whole_chapter content writer prompt 命中；format_only 返回基线原文" do
    content_prompt =
      writer_prompt("## 整章内容修订", "把第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。", "whole_chapter")

    assert {:ok, result} = SliceVerify.complete(nil, nil, content_prompt, %InferenceParams{})
    body = fixture_body(result)
    assert body =~ "三十岁"

    format_prompt =
      writer_prompt("## 整章仅排版修订（format_only）", "把已保存的第一章正文整理一下，只调整分段和排版，不改字句。", "format_only")

    assert {:ok, format_result} =
             SliceVerify.complete(nil, nil, format_prompt, %InferenceParams{})

    format_body = fixture_body(format_result)

    assert format_body == @base_text
  end

  test "不连续目标各自显式映射，原候选附录不混入目标 JSON" do
    targets = [
      %{segment_id: "seg_0_source", sha256: "first", text: "二十五岁守灯楼。\n\n锚句不动。"},
      %{segment_id: "seg_2_source", sha256: "last", text: "二十五岁数到第九层。"}
    ]

    prompt = writer_prompt("修订片段", "二十五岁改成三十岁。", "target_segments", targets)
    [system, author, scope] = prompt.messages
    [block] = scope.blocks
    operation = block.content["operation"]
    appendix = "\n\n## 待调整的原候选\n" <> Jason.encode!([%{body: "旧候选不作为新基线"}])

    content =
      put_in(block.content, ["operation", "context_text"], operation["context_text"] <> appendix)

    prompt = %{
      prompt
      | messages: [system, author, %{scope | blocks: [%{block | content: content}]}]
    }

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    [call] = result.tool_calls

    assert Enum.map(call.arguments.items, & &1["target_segment_ids"]) == [
             ["seg_0_source"],
             ["seg_2_source"]
           ]

    assert Enum.map(call.arguments.items, & &1["body"]) == ["三十岁守灯楼。\n\n锚句不动。", "三十岁数到第九层。"]
  end

  test "整章基线只读本次已供应的同版本完整页，缺页或错版本显式失败" do
    parts = ["二十五岁守灯楼。\r\n", "末页锚句原样保留。\n"]
    total = parts |> Enum.join() |> String.length()

    {pages, _cursor} =
      Enum.map_reduce(Enum.with_index(parts), 1, fn {text, index}, start ->
        finish = start + String.length(text) - 1

        payload = %{
          status: "ok",
          source_refs: ["chapter:one"],
          versions: %{"draft:one" => 2},
          coverage: %{
            chapter_ref: "chapter:one",
            prose_range: %{start: start, end: finish},
            prose_total_chars: total
          },
          content: %{
            tool: "chapter_read",
            source_hash: "actual-source",
            observation_ref: "observation:page-#{index}",
            summary:
              "章预览\n【正文】第 #{start}–#{finish} 字符 / 共 #{total} 字符（有效字数 20）\n#{text}\n【续读】不属于正文"
          }
        }

        {IR.observation("read-#{index}", payload), finish + 1}
      end)

    base = writer_prompt("## 整章内容修订", "二十五岁改成三十岁。", "whole_chapter")
    [system, author, scope] = base.messages
    [block] = scope.blocks

    task = %{
      scope: %{
        modification_scope: "whole_chapter",
        target_chapter_ref: "chapter:one",
        expected_base_versions: [%{ref: "draft:one", version: 2}]
      },
      materials: [%{kind: "observation", ref: "chapter:one", complete?: true}]
    }

    content =
      block.content
      |> Map.put("authoring_task", Jason.decode!(Jason.encode!(task)))
      |> put_in(["operation", "context_text"], "正文已由本次可见章页完整供应。")

    prompt = %{
      base
      | messages: [system, author] ++ pages ++ [%{scope | blocks: [%{block | content: content}]}]
    }

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    assert fixture_body(result) == "三十岁守灯楼。\r\n末页锚句原样保留。\n"
    [call] = result.tool_calls
    refute Map.has_key?(hd(call.arguments.items), "target_segment_ids")
    [first, last] = pages
    [page_block] = last.blocks
    wrong = %{last | blocks: [%{page_block | versions: %{"draft:one" => 1}}]}

    for bad_pages <- [[first], [first, wrong]] do
      bad = %{prompt | messages: [system, author] ++ bad_pages ++ [List.last(prompt.messages)]}

      assert_raise ArgumentError, fn ->
        SliceVerify.complete(nil, nil, bad, %InferenceParams{})
      end
    end
  end
end
