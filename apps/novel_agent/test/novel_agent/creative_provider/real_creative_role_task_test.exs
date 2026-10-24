defmodule NovelAgent.CreativeProvider.RealCreativeRoleTaskTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.TestSupport.AuthoringTaskFixtures
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.CreativeRequest

  @good_json Jason.encode!([
               %{item_id: "i1", title: "候选", body: "候选正文", rationale: nil}
             ])

  defp captured_prompt(request) do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    execution = %Execution{
      result_fn: fn prompt ->
        Agent.update(agent, fn _ -> prompt end)
        {:ok, %{content: @good_json}}
      end
    }

    assert Real.generate(request, execution).status == :ok
    Agent.get(agent, & &1)
  end

  defp request(tool, artifact_type, task) do
    %CreativeRequest{
      request_id: "req-#{tool}",
      tool_name: tool,
      artifact_type: artifact_type,
      creative_brief: "用户创作简述占位",
      context_text: "上下文占位",
      source_turn_ref: "turn-1",
      task: task,
      provider_hints: %{}
    }
  end

  defp assert_task_prompt(prompt, task, operation_marker) do
    assert String.split(prompt, AuthoringSemantics.static_block(task)) |> length() == 2
    assert String.split(prompt, "## 创作协作共同规则") |> length() == 2
    assert prompt =~ operation_marker
    assert prompt =~ "作者原话（逐字保留、可追溯）：作者原话 NONCE42"
    assert prompt =~ "本轮目标（应用据作者输入与已验证上下文归纳，来源可追溯）"
    assert prompt =~ "只返回 JSON 数组"
    refute prompt =~ "本次你承担创作助手的角色"
    assert prompt =~ "用户创作简述："
    assert prompt =~ "上下文："
    assert prompt =~ "重要："
  end

  test "plot_outline creation prompt keeps outline domain schema and shared semantics" do
    task = AuthoringTaskFixtures.task(:outline)
    prompt = captured_prompt(request("plot_outline", :outline_draft, task))

    assert_task_prompt(prompt, task, "本轮为结构规划")
    assert prompt =~ "章功能定位："
    assert prompt =~ "场次：场名｜目标："
    assert prompt =~ "本次你承担章计划助手的角色"
  end

  test "plot_outline revision prompt uses revision operation and preserve" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        output_contract: AuthoringTaskFixtures.contract_for(:outline),
        preserve: ["未要求修改的内容逐字保留"]
      })

    prompt = captured_prompt(request("plot_outline", :outline_draft, task))

    assert_task_prompt(prompt, task, "本轮为修订")
    assert prompt =~ "## 必须保留"
    assert prompt =~ "未要求修改的内容逐字保留"
    assert prompt =~ "本次你承担章计划修订助手的角色"
  end

  test "character_design creation prompt keeps narrative_role/domain schema" do
    task = AuthoringTaskFixtures.task(:character_design)
    prompt = captured_prompt(request("character_design", :character_seed, task))

    assert_task_prompt(prompt, task, "本轮为角色设计")
    assert prompt =~ "narrative_role"
    assert prompt =~ "PROTAGONIST"
    assert prompt =~ "本次你承担小说角色设计助手的角色"
  end

  test "character_design revision prompt keeps role schema with revision semantics" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        output_contract: AuthoringTaskFixtures.contract_for(:character_design)
      })

    prompt = captured_prompt(request("character_design", :character_seed, task))

    assert_task_prompt(prompt, task, "本轮为修订")
    assert prompt =~ "narrative_role"
    assert prompt =~ "本次你承担小说角色设定修订助手的角色"
  end

  test "character_evolution prompt keeps memory_subtype schema" do
    task = AuthoringTaskFixtures.task(:character_evolution)
    prompt = captured_prompt(request("character_evolution", :character_evolution_seed, task))

    assert_task_prompt(prompt, task, "本轮为角色演化记录")
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

    prompt = captured_prompt(request("world_building", "foreshadowing_seed", task))

    assert_task_prompt(prompt, task, "本轮为世界观/设定提案")
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

    prompt = captured_prompt(request("world_building", "world_setting", task))

    assert_task_prompt(prompt, task, "本轮为修订")
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
end
