defmodule NovelAgent.CreativeProvider.RealCreativeRoleTaskTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.TestSupport.AuthoringTaskFixtures
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.RequestIR
  alias NovelTest.TestProviderPrompt

  defp captured_prompt(request) do
    assert {:ok, ir} = Real.request_ir(request)
    assert :ok = RequestIR.validate(ir)
    scope = TestProviderPrompt.scope_content(ir)

    assert scope["authoring_task"] ==
             request.task
             |> AuthoringTask.to_map()
             |> Map.drop(["author_words", "goal_source_ref"])
             |> Jason.encode!()
             |> Jason.decode!()

    assert scope["operation"]["creative_brief"] == request.creative_brief
    assert scope["operation"]["context_text"] == request.context_text
    assert scope["operation"]["revision"] == request.revision
    assert TestProviderPrompt.author_text(ir) == request.task.author_words
    ir
  end

  defp request(tool, artifact_type, task) do
    %CreativeRequest{
      request_id: "req-#{tool}",
      tool_name: tool,
      artifact_type: artifact_type,
      creative_brief: "用户创作简述占位",
      context_text: "上下文占位",
      source_turn_ref: "turn-1",
      source_input_ref: task.source.ref,
      task: task,
      provider_hints: %{}
    }
  end

  defp assert_task_prompt(ir, task, operation_marker) do
    prompt = AuthoringTaskFixtures.prompt_text(ir)
    assert String.split(prompt, AuthoringSemantics.static_block(task)) |> length() == 2
    assert String.split(prompt, "## 创作协作共同规则") |> length() == 2
    assert prompt =~ operation_marker
    assert TestProviderPrompt.author_text(ir) == task.author_words

    assert TestProviderPrompt.scope_content(ir)["authoring_task"]["author_goal"] ==
             task.author_goal

    assert prompt =~ "submit_tentative_artifact"
    refute prompt =~ "只返回 JSON 数组"
    refute prompt =~ "本次你承担创作助手的角色"
    refute prompt =~ "用户创作简述："
    refute Map.has_key?(TestProviderPrompt.scope_content(ir)["authoring_task"], "author_words")
  end

  test "plot_outline creation prompt keeps outline domain schema and shared semantics" do
    task = AuthoringTaskFixtures.task(:outline)
    ir = captured_prompt(request("plot_outline", :outline_draft, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为结构规划")
    assert prompt =~ "章功能定位："
    assert prompt =~ "场次：场名｜目标："
    assert prompt =~ "本次你承担章计划助手的角色"
    assert prompt =~ ~s("chapter_ref"（可选）)
    assert prompt =~ "逐字复制"
    assert prompt =~ "新规划的章不填/留空"
    assert prompt =~ "不得自行编造、改写 ref"
    assert prompt =~ "不得把 ref 拼进 title 或 body"
  end

  test "plot_outline revision prompt uses revision operation and preserve" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        output_contract: AuthoringTaskFixtures.contract_for(:outline),
        preserve: ["未要求修改的内容逐字保留"]
      })

    ir = captured_prompt(request("plot_outline", :outline_draft, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为修订")

    assert TestProviderPrompt.scope_content(ir)["authoring_task"]["preserve"] ==
             ["未要求修改的内容逐字保留"]

    assert prompt =~ "本次你承担章计划修订助手的角色"
  end

  test "character_design creation prompt keeps narrative_role/domain schema" do
    task = AuthoringTaskFixtures.task(:character_design)
    ir = captured_prompt(request("character_design", :character_seed, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为角色设计")
    assert prompt =~ "narrative_role"
    assert prompt =~ "PROTAGONIST"
    assert prompt =~ "本次你承担小说角色设计助手的角色"
  end

  test "character_design revision prompt keeps role schema with revision semantics" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        output_contract: AuthoringTaskFixtures.contract_for(:character_design)
      })

    ir = captured_prompt(request("character_design", :character_seed, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为修订")
    assert prompt =~ "narrative_role"
    assert prompt =~ "本次你承担小说角色设定修订助手的角色"
  end

  test "character_evolution prompt keeps memory_subtype schema" do
    task = AuthoringTaskFixtures.task(:character_evolution)
    ir = captured_prompt(request("character_evolution", :character_evolution_seed, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为角色演化记录")
    assert prompt =~ "memory_subtype"
    assert prompt =~ "CHARACTER_PROFILE"
    assert prompt =~ "只记录演化事件，不重建主档案"
  end

  test "world_building creation prompt keeps artifact_type-specific domain schema" do
    task =
      AuthoringTaskFixtures.task(:world_building, %{
        output_contract:
          AuthoringTaskFixtures.task(:world_building).output_contract
          |> Map.put(:artifact_type, :foreshadowing_seed)
      })

    ir = captured_prompt(request("world_building", "foreshadowing_seed", task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为世界观/设定提案")
    assert prompt =~ "本次草稿类型：foreshadowing_seed"
    assert prompt =~ "伏笔标题"
    assert prompt =~ "伏笔线索 / 首次出现位置"
    assert prompt =~ "本次你承担小说设定与连续性设计助手的角色"
  end

  test "world_building revision prompt does not reuse new-create template columns" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        output_contract:
          AuthoringTaskFixtures.task(:revision).output_contract
          |> Map.put(:artifact_type, :world_setting)
      })

    ir = captured_prompt(request("world_building", "world_setting", task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为修订")
    assert prompt =~ "本次修订类型：world_setting"
    refute prompt =~ "逐行包含：设定内容"
    refute prompt =~ "待作者确认处"
    assert prompt =~ "本次你承担小说设定修订助手的角色"
  end

  test "unsupported creative tool fails explicitly" do
    request = request("creative_generation", :world_setting, AuthoringTaskFixtures.prose_task())

    execution = %Execution{
      result_fn: fn _ -> flunk("unsupported tool must not call provider") end
    }

    result = Real.generate(request, execution)
    assert result.status == :error
    assert [%{code: "unsupported_creative_tool"}] = result.errors
  end

  test "prose revision prompt carries baseline/scope discipline (task-24/29)" do
    task = AuthoringTaskFixtures.task(:revision)

    request = %{
      request("prose_writing", :prose_fragment, task)
      | revision: "本轮修订已有候选。必须输出完整修订稿。\n\n目标段定位：作者要求修改第2段。\n第二段原文。"
    }

    ir = captured_prompt(request)
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert prompt =~ "本轮为修订"
    assert prompt =~ "## 修订基线纪律"
    assert prompt =~ "保留原稿的段落边界与未要求修改段落的字句"
    assert prompt =~ "作者指定段落"
    assert prompt =~ "不得写成续写或“继续往后写”"
    assert prompt =~ "不得新增或删除段落/空行"
    assert prompt =~ "明确改动（如“七成改六成”"
    assert prompt =~ "目标段定位"
    assert prompt =~ "必须输出完整修订稿"
    assert prompt =~ "原样返回基线原文视为未执行修订"
    assert prompt =~ "## 创作协作共同规则"
    assert prompt =~ "submit_tentative_artifact"
    refute prompt =~ "只返回 JSON 数组"
  end

  test "B28: format_only chapter revision renders ordered coverage + no continuation" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        scope: %{
          refs: ["draft:d1", "draft:d2"],
          coverage: :complete,
          target_chapter_ref: "chapter:ch01",
          object_kind: :chapter_prose,
          modification_scope: :format_only,
          expected_base_versions: [%{ref: "draft:d1", version: 2}]
        }
      })

    ir = captured_prompt(request("prose_writing", :prose_fragment, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert prompt =~ "## 整章仅排版修订（format_only）"
    scope = TestProviderPrompt.scope_content(ir)["authoring_task"]["scope"]
    assert scope["refs"] == ["draft:d1", "draft:d2"]
    assert scope["target_chapter_ref"] == "chapter:ch01"
    assert scope["modification_scope"] == "format_only"
    assert prompt =~ "按任务给出的覆盖顺序完整输出"
    assert prompt =~ "只允许调整分段、标点、排版与空白；不改变任何字句"
    assert prompt =~ "不得写成续写或“继续往后写”"
    refute prompt =~ "系统当前没有保证字句不变的独立排版能力"
    refute prompt =~ ~r/(请|可以)继续往后写/
  end

  test "B28: whole_chapter content revision renders full replacement + preserve others" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        scope: %{
          refs: ["draft:d1", "draft:d2"],
          coverage: :complete,
          target_chapter_ref: "chapter:ch01",
          object_kind: :chapter_prose,
          modification_scope: :whole_chapter,
          expected_base_versions: [%{ref: "draft:d1", version: 1}]
        }
      })

    ir = captured_prompt(request("prose_writing", :prose_fragment, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert prompt =~ "## 整章内容修订"
    assert prompt =~ "按任务给出的覆盖顺序输出整章的完整替换稿"
    assert prompt =~ "不得只返回修改片段、摘要或旧稿对照"
    assert prompt =~ "其余段落/片段逐字保留"
    assert prompt =~ "不得写成续写或“继续往后写”"

    assert TestProviderPrompt.scope_content(ir)["authoring_task"]["scope"]["modification_scope"] ==
             "whole_chapter"

    refute prompt =~ ~r/(请|可以)继续往后写/
  end

  test "B28/B36: target_segments revision only asks for target replacement text (replacement-only)" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        scope: %{
          refs: ["draft:d1"],
          coverage: :complete,
          target_chapter_ref: "chapter:ch01",
          object_kind: :chapter_prose,
          modification_scope: :target_segments
        }
      })

    ir = captured_prompt(request("prose_writing", :prose_fragment, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert prompt =~ "## 指定片段/段落内容修订（target_segments）"
    assert prompt =~ "只输出目标段落的完整替换文本"
    assert prompt =~ "不要输出整章"
    assert prompt =~ "不要复述其他段落"
    assert prompt =~ "未指定段落由系统逐字保留"
    assert prompt =~ "body 只放目标段的替换文本"
    refute prompt =~ "不得只返回修改片段"
    refute prompt =~ "按任务给出的覆盖顺序输出指定片段/段落的完整替换稿"
    # 整章/format_only 的旧语义不应出现在 target_segments guidance 中。
    refute prompt =~ "## 整章内容修订"
    refute prompt =~ "## 整章仅排版修订（format_only）"
  end

  test "B36 CP3 real wording: target_segments prompt carries 改第一段/其余段落别动 and replacement-only contract" do
    cp3_wording =
      "把第03章：黑市调频师的正文第一段改得更紧张，只改这一段，其他段落别动。"

    task =
      AuthoringTaskFixtures.task(:revision, %{
        scope: %{
          refs: ["draft:d1"],
          coverage: :complete,
          target_chapter_ref: "chapter:ch01",
          object_kind: :chapter_prose,
          modification_scope: :target_segments
        }
      })

    base_request = request("prose_writing", :prose_fragment, task)
    ir = captured_prompt(%{base_request | creative_brief: cp3_wording})
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert TestProviderPrompt.scope_content(ir)["operation"]["creative_brief"] == cp3_wording
    assert prompt =~ "只输出目标段落的完整替换文本"
    assert prompt =~ "不要输出整章"
    assert prompt =~ "不要复述其他段落"
    refute prompt =~ "不得只返回修改片段"
    refute prompt =~ "输出整章完整替换稿"
  end
end
