defmodule NovelApplication.B11ACp3VolumeScopeTest do
  @moduledoc """
  B11A CP3（VS-00J §3.2 形态 A）：开新卷动作的机械规划范围进入规划 prompt。

  - `TurnExecutionService` 收到 run 级 `:volume_scope` 时，仅在 plot_outline 动作上注入
    「本轮规划范围（机械给定，不得改）」段（work_skeleton 之后、current_volume_blueprint
    之前），并用 scope 版分卷指令替换全书卷数版指令；
  - 无 scope / 非法 scope / 非 plot_outline 能力 → prompt 与既有行为逐字节等价。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision
  alias NovelPersistence.ChapterPlanParser

  @work "work-b11a-cp3"
  @scope NovelDomain.VolumeScope

  @valid_scope %{
    next_seq: 3,
    current_volume_seq: 2,
    current_volume_title: "第二卷·裂变",
    next_chapter_seq: 8,
    existing_volume_count: 2,
    existing_chapter_count: 7
  }

  @scope_title "## 本轮规划范围（机械给定，不得改）"

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_work_snapshot: %{target_length: 140_000, planned_volumes: 3},
      current_chapters: ["第01章：起"],
      structured_chapters: [
        %{title: "第01章：起", seq: 1, summary: "", has_prose: true}
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end

  describe "plot_outline prompt 携带本轮规划范围" do
    test "合法 scope：scope 段注入 + scope 版分卷指令替换全书卷数指令 + 顺序正确" do
      prompt = run("plot_outline", %{volume_scope: @valid_scope})

      assert prompt =~ @scope_title
      assert prompt =~ "本轮只规划下一卷：第 3 卷"
      assert prompt =~ "当前已有 2 卷"
      assert prompt =~ "当前卷《第二卷·裂变》"
      assert prompt =~ "下一章号从 8 开始"
      assert prompt =~ "不要重规划已有卷/已有章"
      assert prompt =~ "必须为该卷产出一条「卷蓝图：卷标题｜序号：3｜…」行"
      assert prompt =~ "为该卷开篇章节标注「所属卷：卷标题」"

      # work_skeleton 里的分卷指令也换成 scope 版（不再说「全书分 3 卷」）。
      assert prompt =~ "本轮只规划第 3 卷"
      refute prompt =~ "全书分 3 卷"

      # 顺序：全书规划（work_skeleton）→ 本轮规划范围 → 当前卷蓝图（无卷时省略）。
      assert :binary.match(prompt, "## 全书规划（连载参照）") != :nomatch
      skeleton_at = index(prompt, "## 全书规划（连载参照）")
      scope_at = index(prompt, @scope_title)
      assert skeleton_at < scope_at
    end

    test "无 scope / scope=nil / 非法 scope：prompt 逐字节等价（既有行为不变）" do
      without_scope = run("plot_outline", %{})
      explicit_nil = run("plot_outline", %{volume_scope: nil})
      invalid = run("plot_outline", %{volume_scope: %{next_seq: 0}})
      junk = run("plot_outline", %{volume_scope: "bad"})

      assert explicit_nil == without_scope
      assert invalid == without_scope
      assert junk == without_scope

      refute without_scope =~ @scope_title
      # 既有全书卷数指令仍在（无 scope 的旧行为）。
      assert without_scope =~ "全书分 3 卷"
    end

    test "非 plot_outline 能力即使带 scope 也不注入（scope 只服务规划动作）" do
      prompt = run("prose_writing", %{volume_scope: @valid_scope})

      refute prompt =~ @scope_title
      refute prompt =~ "本轮只规划第 3 卷"
      refute prompt =~ "本轮只规划下一卷"
    end
  end

  describe "VolumeScope.render_section/1 与执行层口径一致" do
    test "执行层注入的段与纯函数渲染一致（同一真源）" do
      prompt = run("plot_outline", %{volume_scope: @valid_scope})
      assert prompt =~ @scope.render_section(@valid_scope)
    end
  end

  # ── ⑥ 测试替身：真实 prompt 文本驱动（不认 slice id / env）────────────────

  describe "测试替身 scope 行为（真实产品文本驱动）" do
    test "判断 call2：真实作者文本「请规划下一卷…」→ execute plot_outline" do
      prompt = %{
        messages: [
          %{role: "system", content: "你是创作判断器，只输出判断 JSON。"},
          %{
            role: "user",
            content: "## 作者输入\n请规划下一卷（第3卷）的卷蓝图与该卷开篇章节大纲。"
          }
        ],
        tools: [%{name: "judgment_decision", description: "", input_schema: %{}}],
        tool_choice: "judgment_decision"
      }

      assert {:ok, result} =
               SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

      assert [%{"arguments" => arguments}] = result.tool_calls
      assert arguments["action"] == "execute"
      assert arguments["capability"] == "plot_outline"
    end

    test "scoped outline 产出：1 条卷蓝图 + 3 章；production parser 可解析（章号续排/所属卷）" do
      prompt = """
      你是一个创作助手，只输出 JSON 数组。
      artifact_type：outline_draft
      用户创作简述：请规划下一卷（第3卷）的卷蓝图与该卷开篇章节大纲。
      上下文：## 本轮规划范围（机械给定，不得改）
      - 本轮只规划下一卷：第 3 卷
      - 当前已有 2 卷，当前卷《第二卷·裂变》，已有 4 章
      - 下一章号从 5 开始（全书章号全局续排，不得重排已有章）
      重要：只输出 JSON 数组，不要解释。
      """

      assert {:ok, result} =
               SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

      items = Jason.decode!(result.content)
      assert length(items) == 3
      assert Enum.map(items, & &1["title"]) == ["第05章：觉醒", "第06章：试炼", "第07章：盟约"]

      parsed = items |> stub_items_to_content() |> ChapterPlanParser.parse_with_volumes()

      assert [blueprint] = parsed.volume_blueprints
      assert blueprint.seq == 3
      assert blueprint.title == "第三卷·归墟"
      assert blueprint.blueprint["goal_conflict"] == "推进第3卷的核心冲突"

      assert length(parsed.chapters) == 3

      assert Enum.map(parsed.chapters, & &1.title) == ["第05章：觉醒", "第06章：试炼", "第07章：盟约"]

      assert Enum.map(parsed.chapters, & &1.volume_title) ==
               ["第三卷·归墟", "第三卷·归墟", "第三卷·归墟"]
    end

    test "无 scope 文本 → 既有全量产出（12 章、无卷蓝图行），且确定性（两次调用逐字节一致）" do
      prompt = """
      你是一个创作助手，只输出 JSON 数组。
      artifact_type：outline_draft
      用户创作简述：规划接下来十二章章节大纲。
      上下文：## 已采纳章节
      - 第01章：起点
      重要：只输出 JSON 数组，不要解释。
      """

      assert {:ok, first} =
               SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

      assert {:ok, second} =
               SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

      assert second.content == first.content

      items = Jason.decode!(first.content)
      assert length(items) == 12

      parsed = items |> stub_items_to_content() |> ChapterPlanParser.parse_with_volumes()
      assert parsed.volume_blueprints == []
      assert length(parsed.chapters) == 12
      # 无 scope 时不产「本轮规划范围」相关的额外行为。
      refute first.content =~ "卷蓝图"
    end
  end

  # 复刻生产 `adoption_workflow.items_to_content/2` 的非正文类拼接：`title: body` 换行连接。
  defp stub_items_to_content(items) do
    Enum.map_join(items, "\n", fn item -> "#{item["title"]}: #{item["body"]}" end)
  end

  defp run(target_ref, overrides) do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "c1", "title" => "第1章", "body" => "正文", "rationale" => nil}
           ])
       }}
    end

    input =
      %{
        frame: frame(),
        plan: plan(target_ref),
        decision: allow_decision(),
        context: context(),
        author_input: %{text: "创作"},
        provider_execution: %Execution{result_fn: complete}
      }
      |> Map.merge(overrides)

    {_turn_result, _trace} = TurnExecutionService.execute(input)
    agent |> Agent.get(& &1) |> Enum.join("\n\n")
  end

  defp index(text, needle), do: :binary.match(text, needle) |> elem(0)

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-b11a-cp3",
      turn_id: "turn-b11a-cp3",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "创作"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "创作"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan(target_ref) do
    %MicroPlan{
      plan_id: "plan-b11a-cp3",
      turn_id: "turn-b11a-cp3",
      frame_ref: "frame-b11a-cp3",
      plan_goal: %{summary: "创作"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-b11a-cp3",
          action_type: :capability_invocation,
          summary: "创作",
          target_ref: target_ref,
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: nil
        }
      ]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-b11a-cp3",
      turn_id: "turn-b11a-cp3",
      frame_ref: "frame-b11a-cp3",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed"]
    }
  end
end
