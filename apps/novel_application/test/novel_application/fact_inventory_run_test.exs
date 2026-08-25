defmodule NovelApplication.FactInventoryRunTest do
  @moduledoc """
  VS-00G CP4b-2：`fact_inventory_v1` 从作品材料到多 seed tentative 提案的 AgentRun。
  """
  use ExUnit.Case, async: false

  alias NovelAgent.AgentTaskProfileRegistry
  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.TestAgenticLoopFixtures

  # D5：全量退化 → 降批两半各自成功 → 提案合并去重（batch_fallback 事件留痕）。
  test "全量盘点退化 → 降批重试合并提案（D5）" do
    parent = self()
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    eight = Enum.map(1..8, &%{seq: &1, title: "第0#{&1}章", prose: "第#{&1}章正文素材。"})

    provider_execution = %Execution{
      result_fn: fn prompt ->
        prompt_text = TestAgenticLoopFixtures.prompt_text(prompt)

        if String.contains?(prompt_text, "设定盘点助手") do
          n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})

          cond do
            n == 1 ->
              {:error, %{type: :invalid_response, message: "响应内容退化", retryable: false}}

            String.contains?(prompt_text, "第01章") ->
              {:ok,
               %{
                 content:
                   ~s([{"artifact_type":"character_seed","item_id":"cl","title":"左半角色","body":"来自前半。","rationale":null,"evidence_chapters":[1]}]),
                 provider_call_ref: "pcall-left"
               }}

            true ->
              {:ok,
               %{
                 content:
                   ~s([{"artifact_type":"world_rule_seed","item_id":"wr","title":"右半规则","body":"来自后半。","rationale":null,"evidence_chapters":[5]}]),
                 provider_call_ref: "pcall-right"
               }}
          end
        else
          {:ok, plan_draft()}
        end
      end
    }

    input = %{
      text: "从现有正文盘点角色、世界规则和伏笔，只生成待采纳提案。",
      workspace_id: "ws-d5-batch",
      work_id: "work-d5-batch",
      session_id: "session-d5-batch",
      turn_id: "turn-d5-batch",
      material_reader: fn "work-d5-batch" -> eight end,
      skeleton_reader: fn "work-d5-batch" -> [] end
    }

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :fact_inventory,
        input,
        nil,
        provider_execution
      )

    assert {:ok, _run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :artifact_created, artifact_event}, 2_000
    assert_receive {:agent_event, :run_completed, _}, 2_000

    turn_result = artifact_event.payload.turn_result
    pending_types = turn_result.adoption_state.pending |> Enum.map(& &1.artifact_type)
    assert :character_seed in pending_types
    assert :world_rule_seed in pending_types

    # 降批实证：1 次全量失败 + 左右两半各 1 次 = 恰 3 次盘点调用。
    # 不再断言全局 jsonl 文件——log_jsonl env 是全局的，全量套件下被并发测试翻动致 flaky。
    assert Agent.get(counter, & &1) == 3
  end

  test "盘点 run 同批产角色/规则/伏笔，并保持逐项 tentative 与零 production write" do
    parent = self()

    provider_execution = %Execution{
      result_fn: fn prompt ->
        prompt_text = TestAgenticLoopFixtures.prompt_text(prompt)

        if String.contains?(prompt_text, "设定盘点助手") do
          send(parent, {:inventory_prompt, prompt_text})

          {:ok,
           %{
             content: proposal_json(),
             provider_call_ref: "pcall-fact-inventory"
           }}
        else
          {:ok, plan_draft()}
        end
      end
    }

    input = %{
      text: "从现有正文盘点角色、世界规则和伏笔，只生成待采纳提案。",
      workspace_id: "ws-fact-inventory",
      work_id: "work-fact-inventory",
      session_id: "session-fact-inventory",
      turn_id: "turn-fact-inventory",
      material_reader: fn "work-fact-inventory" -> materials() end,
      # CP4d：这本书 target_length 缺位 → 盘点应同批产全书规划建议（其余字段已立不建议）
      skeleton_reader: fn "work-fact-inventory" -> ["target_length"] end,
      # CP5b：主角是 required 事实 → PROTAGONIST 候选应物化为暂定角色（自动激活）
      assumption_writer: fn attrs ->
        send(parent, {:assumption_materialized, attrs})
        {:ok, %{id: "char-assumption", name: attrs.name}}
      end
    }

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :fact_inventory,
        input,
        nil,
        provider_execution
      )

    assert spec.run_attrs.profile_ref == "fact_inventory_v1"
    assert spec.run_attrs.budget.max_provider_calls == 7
    assert AgentTaskProfileRegistry.allowed_tool?("fact_inventory_v1", "fact_inventory")
    refute spec.run_attrs.authority_scope.production_write

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}, 500
    assert_receive {:inventory_prompt, prompt}, 1_000
    assert prompt =~ "第1章 灵气账单"
    assert prompt =~ "\"item_id\""
    # CP4d：只对缺位字段请求全书规划建议
    assert prompt =~ "work_skeleton_suggestion"
    assert prompt =~ "target_length：目标总字数"
    refute prompt =~ "serial_form：连载形态"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 1_000
    assert_receive {:agent_event, :run_completed, _}, 1_000

    # CP5b：主角候选被物化为暂定角色（required 自动激活），作者收到即时通知
    assert_receive {:assumption_materialized, assumption_attrs}, 500
    assert assumption_attrs.name == "沈砚"
    assert assumption_attrs.narrative_role == "PROTAGONIST"
    assert assumption_attrs.work_id == "work-fact-inventory"

    turn_result = artifact_event.payload.turn_result
    assert turn_result.assistant_message.text =~ "【暂定】"
    assert turn_result.assistant_message.text =~ "确认或否决"

    assert Enum.map(turn_result.ui_cards, & &1.artifact_type) == [
             :character_seed,
             :world_rule_seed,
             :foreshadowing_seed,
             :work_skeleton_suggestion
           ]

    assert Enum.map(turn_result.adoption_state.pending, & &1.artifact_type) == [
             :character_seed,
             :character_seed,
             :world_rule_seed,
             :foreshadowing_seed,
             :work_skeleton_suggestion
           ]

    skeleton_pending =
      Enum.find(
        turn_result.adoption_state.pending,
        &(&1.artifact_type == :work_skeleton_suggestion)
      )

    assert skeleton_pending.payload.title == "全书规划建议"
    assert [skeleton_item] = skeleton_pending.payload.items
    assert skeleton_item.skeleton_field == "target_length"
    assert skeleton_item.skeleton_value == 300_000

    assert length(turn_result.available_actions) == 15
    assert turn_result.truthfulness.tool_called
    refute turn_result.truthfulness.artifact_adopted
    refute turn_result.truthfulness.production_write_performed

    assert Enum.all?(
             turn_result.adoption_state.pending,
             &(&1.adoption_status == :tentative)
           )

    assert Enum.all?(
             turn_result.tool_result.output.items,
             &(&1.provider_call_ref == "pcall-fact-inventory")
           )

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :completed
    assert run.consumed_budget.steps == 1
    assert run.consumed_budget.tool_calls == 1
    assert run.consumed_budget.provider_calls == 3
    assert length(run.pending_artifact_refs) == 5
  end

  defp plan_draft do
    TestAgenticLoopFixtures.plan_tool_call_result(
      "读取作品材料并整理一次设定盘点提案。",
      [
        TestAgenticLoopFixtures.plan_step(
          "fact_inventory",
          "fact_inventory",
          "读取作品材料并整理待采纳的角色、规则与伏笔提案。",
          kind: "act",
          write_intent: "tentative",
          success_criteria: ["fact_inventory_artifacts_created"]
        )
      ],
      reason_codes: ["agent_plan_drafted", "fact_inventory_plan_drafted"]
    )
  end

  defp materials do
    [
      %{seq: 1, title: "灵气账单", prose: "沈砚发现灵气被公司按频段计费。"},
      %{seq: 2, title: "残诀", prose: "云栖交给沈砚一部缺失后半卷的残诀。"}
    ]
  end

  defp proposal_json do
    Jason.encode!([
      %{
        artifact_type: "character_seed",
        item_id: "char-shenyan",
        title: "沈砚",
        body: "追查灵气账单的核心视角人物。",
        rationale: "依据第1章",
        narrative_role: "PROTAGONIST"
      },
      %{
        artifact_type: "character_seed",
        item_id: "char-yunqi",
        title: "云栖",
        body: "向主角交付残诀的关键配角。",
        rationale: "依据第2章",
        narrative_role: "SUPPORTING"
      },
      %{
        artifact_type: "world_rule_seed",
        item_id: "rule-frequency",
        title: "灵气按频段计费",
        body: "灵气使用会被公司按频段计费。",
        rationale: "依据第1章"
      },
      %{
        artifact_type: "foreshadowing_seed",
        item_id: "foreshadow-manual",
        title: "残诀后半卷",
        body: "残诀缺失的后半卷尚未揭示。",
        rationale: "依据第2章"
      },
      %{
        artifact_type: "work_skeleton_suggestion",
        item_id: "skeleton_target_length",
        title: "目标体量",
        body: "按前两章节奏推断全书约 30 万字。",
        rationale: "依据前2章体量",
        skeleton_field: "target_length",
        skeleton_value: 300_000
      }
    ])
  end
end
