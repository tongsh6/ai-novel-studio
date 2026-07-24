defmodule NovelApplication.JudgmentProtocolTest do
  @moduledoc """
  判断①协议解析的业务规则单测（ADR-0025 CP1）。

  锚定兜底候选语义的协议侧前提：候选结构坏了不丢探索意图
  （`candidate_directions_present`），由消费层降级为应用兜底候选。
  端到端降级行为由场景验收 au02-candidate-fallback-ui 驱动真实页面证明。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.JudgmentProtocol
  alias NovelCommon.Contracts.ProviderOutput

  @narrative "你想探索方向；我先给你两个候选切入。"

  defp fake_execution(decision_arguments) do
    %Execution{
      result_fn: fn prompt ->
        text = prompt_text(prompt)

        if String.contains?(text, JudgmentProtocol.tool_name()) do
          {:ok,
           %{
             content: "",
             tool_calls: [
               %{name: JudgmentProtocol.tool_name(), arguments: decision_arguments}
             ],
             provider_output: provider_output("")
           }}
        else
          {:ok,
           %{
             content: @narrative,
             provider_output: provider_output(@narrative)
           }}
        end
      end
    }
  end

  defp provider_output(text) do
    %ProviderOutput{
      provider_run_ref: "prun-test",
      provider_call_ref: "pcall-test",
      status: :ok,
      content: %{text: text}
    }
  end

  defp prompt_text(%{messages: messages}) do
    Enum.map_join(messages, "\n", fn m -> m[:content] || m["content"] || "" end)
  end

  defp prompt_text(prompt) when is_binary(prompt), do: prompt
  defp prompt_text(_), do: ""

  defp request(arguments, options \\ []) do
    JudgmentProtocol.request_judgment(fake_execution(arguments), %{}, %{
      author_text: "想写赛博修仙，给我几个方向",
      context_block: "（无上下文）",
      options: options
    })
  end

  test "explore_request 归一：tool+query 齐全成立，任一缺失为 nil（不猜）" do
    assert {:ok, judgment} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "missing_facts",
                 "explore_request" => %{"tool" => "prose_search", "query" => "灵气账单"}
               },
               explore: true
             )

    assert judgment.action == "explore"
    assert judgment.explore_request == %{tool: "prose_search", query: "灵气账单"}

    assert {:ok, missing_query} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "missing_facts",
                 "explore_request" => %{"tool" => "prose_search", "query" => "  "}
               },
               explore: true
             )

    assert missing_query.explore_request == nil

    assert {:ok, absent} = request(%{"action" => "reply", "reason" => "ok"})
    assert absent.explore_request == nil
  end

  test "capability 目录约束（M0 狗粮缺陷回归）：execute 越界重试后诚实失败，plan 不连坐，enum 进 schema" do
    capabilities = ~w(prose_writing character_design)

    # execute + 目录外能力名 → 重试仍坏 → S7 诚实失败（不放行到 dispatch）
    assert {:error, {:judgment_decision_unparseable, _frag}} =
             request(
               %{"action" => "execute", "reason" => "go", "capability" => "text_generation"},
               capabilities: capabilities
             )

    # execute + 目录内能力名 → 通过
    assert {:ok, ok_judgment} =
             request(
               %{"action" => "execute", "reason" => "go", "capability" => "prose_writing"},
               capabilities: capabilities
             )

    assert ok_judgment.capability == "prose_writing"

    # plan + 占位能力名（live 实测形态）→ 不连坐（dispatch 忽略 plan 的 capability）
    assert {:ok, plan_judgment} =
             request(
               %{"action" => "plan", "reason" => "multi", "capability" => "planning"},
               capabilities: capabilities
             )

    assert plan_judgment.action == "plan"

    # execute + capability=null 同样越界（M2 缺陷八：null 洞——execute 必填）
    assert {:error, {:judgment_decision_unparseable, _}} =
             request(
               %{"action" => "execute", "reason" => "go", "capability" => nil},
               capabilities: capabilities
             )

    # 目录未传入 → 保持向后兼容不拦
    assert {:ok, _} =
             request(%{
               "action" => "execute",
               "reason" => "go",
               "capability" => "text_generation"
             })
  end

  test "call2 prompt 注入目录（T4 M2 误路由回归）：传目录时列出实名，未传保持旧措辞" do
    # M2 实锤（2026-07-20）：目录只放 schema enum（anyOf 内层）对模型不可见，
    # 全天 15 次首调 0 命中（自造名/null/被约束解码顶替成任意合法值）；顶替值
    # 合法导致越界重试网被绕过。目录名必须出现在 call2 prompt 正文里。
    input = %{
      author_text: "接着写正文",
      options: [
        explore: true,
        capabilities: ~w(character_design prose_writing),
        explore_tools: ~w(prose_search chapter_read)
      ]
    }

    text = input |> JudgmentProtocol.decision_prompt(@narrative) |> prompt_text()

    assert text =~ "capability 只能取 character_design / prose_writing，不得自造能力名"
    assert text =~ "tool 只能取 prose_search / chapter_read，不得自造工具名"

    bare_text =
      %{author_text: "接着写正文", options: []}
      |> JudgmentProtocol.decision_prompt(@narrative)
      |> prompt_text()

    assert bare_text =~ "capability 填能力目录中的能力名（只能取目录名）"
    assert bare_text =~ "tool 从「探索目录」选择"
  end

  test "call2 schema 要求 provider 明确给出 reply frame 语义" do
    prompt =
      JudgmentProtocol.decision_prompt(
        %{author_text: "为什么这一章张力不足？", options: []},
        @narrative
      )

    [%{input_schema: schema}] = prompt.tools

    assert "frame_type" in schema.required
    assert "dialogue_goal" in schema.required

    frame_type_schema = schema.properties.frame_type

    assert %{type: "string", enum: frame_types} =
             Enum.find(frame_type_schema.anyOf, &(&1[:type] == "string"))

    assert frame_types == ~w(casual_reply creative_exploration question_answer meta_discussion)
  end

  test "call2 回显双端保留（M2 达标跑缺陷回归）：长叙事保头尾，结论不被剪，短叙事原样" do
    # M2 实锤（2026-07-21）：扩章批摘要变长后 call1 叙事超 240 字符，旧头部截断
    # 剪掉尾部"单动作执行"结论 → call2 只见意图复述误判 reply（97/112 次重试）。
    head = String.duplicate("述", 300)
    conclusion = "因此本轮判定为单动作执行。"
    long_narrative = head <> conclusion

    text =
      %{author_text: "写第21章", options: []}
      |> JudgmentProtocol.decision_prompt(long_narrative)
      |> prompt_text()

    assert text =~ String.duplicate("述", 120)
    assert text =~ "…（中略）…"
    assert text =~ conclusion
    refute text =~ String.duplicate("述", 121)

    short_narrative = "判断说明很短。判定为直接回复。"

    short_text =
      %{author_text: "写第21章", options: []}
      |> JudgmentProtocol.decision_prompt(short_narrative)
      |> prompt_text()

    assert short_text =~ short_narrative
    refute short_text =~ "（中略）"
  end

  test "explore 工具目录约束（judgment-explore-internal 场景验收实测缺陷回归）：目录外工具名重试后诚实失败，enum 进 schema" do
    tools = ~w(prose_search chapter_read archive_read memory_recall)

    # explore + 目录外工具名（live 实测形态："text_search" 不存在）→ 重试仍坏 → 诚实失败
    assert {:error, {:judgment_decision_unparseable, _frag}} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "need_facts",
                 "explore_request" => %{"tool" => "text_search", "query" => "灵气账单"}
               },
               explore: true,
               explore_tools: tools
             )

    # explore + 目录内工具名 → 通过
    assert {:ok, ok_judgment} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "need_facts",
                 "explore_request" => %{"tool" => "prose_search", "query" => "灵气账单"}
               },
               explore: true,
               explore_tools: tools
             )

    assert ok_judgment.explore_request == %{tool: "prose_search", query: "灵气账单"}

    # 非 explore action 不连坐（目录校验只管 explore）
    assert {:ok, reply_judgment} =
             request(
               %{"action" => "reply", "reason" => "ok"},
               explore: true,
               explore_tools: tools
             )

    assert reply_judgment.action == "reply"

    # 目录未传入 → 保持向后兼容不拦（与 capability 同款语义）
    assert {:ok, _} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "need_facts",
                 "explore_request" => %{"tool" => "text_search", "query" => "灵气账单"}
               },
               explore: true
             )
  end

  test "正常候选列表：解析为候选，present 为真" do
    {:ok, judgment} =
      request(%{
        "action" => "reply",
        "reply_included" => true,
        "candidate_directions" => [
          %{"title" => "矛盾切入", "pitch" => "从冲突进入", "tone_tags" => ["冲突"]}
        ]
      })

    assert judgment.action == "reply"
    assert [%{"title" => "矛盾切入"}] = judgment.candidate_directions
    assert judgment.candidate_directions_present
  end

  test "坏候选结构（对象而非数组）：候选归空但探索意图不丢" do
    {:ok, judgment} =
      request(%{
        "action" => "reply",
        "reply_included" => true,
        "candidate_directions" => %{"title" => "", "pitch" => ""}
      })

    assert judgment.candidate_directions == []
    assert judgment.candidate_directions_present
  end

  test "无候选字段：候选为空且无探索意图" do
    {:ok, judgment} = request(%{"action" => "reply", "reply_included" => true})

    assert judgment.candidate_directions == []
    refute judgment.candidate_directions_present
  end

  test "reply frame type 与 dialogue goal 从判断结构原样归一" do
    assert {:ok, judgment} =
             request(%{
               "action" => "reply",
               "reason" => "answer_author_question",
               "reply_included" => true,
               "frame_type" => "question_answer",
               "dialogue_goal" => "解释胜利过轻削弱张力的原因"
             })

    assert judgment.frame_type == "question_answer"
    assert judgment.dialogue_goal == "解释胜利过轻削弱张力的原因"

    assert {:ok, invalid} =
             request(%{
               "action" => "reply",
               "reason" => "bad_frame",
               "frame_type" => "execution_candidate",
               "dialogue_goal" => "  "
             })

    assert invalid.frame_type == nil
    assert invalid.dialogue_goal == nil
  end
end
