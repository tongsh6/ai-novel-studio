defmodule NovelAgent.Tools.CreativeToolAdapterTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.ToolRequest

  alias NovelAgent.TestSupport.AuthoringTaskFixtures

  defmodule SelfReportProvider do
    @behaviour NovelAgent.CreativeProvider

    alias NovelCommon.Contracts.CreativeProviderResult

    @impl true
    def generate(%{provider_hints: %{"items" => items}}, _result_fn) do
      %CreativeProviderResult{status: :ok, items: items}
    end

    def generate(_request, _result_fn) do
      %CreativeProviderResult{
        status: :ok,
        items: [
          %{
            item_id: "item-1",
            title: "正文草稿",
            body: "正文内容",
            rationale: nil
          }
        ],
        self_report: %{
          assumptions: ["按 ReaderEffectBrief 生成"],
          intended_reader_effect: "紧张、期待",
          used_context_refs: ["reader_effect_brief"],
          risk_flags: ["章尾钩子需作者确认"],
          quality_action: :confirm
        }
      }
    end
  end

  defmodule ExecutionBackedProvider do
    @behaviour NovelAgent.CreativeProvider

    alias NovelAgent.Provider.Execution
    alias NovelCommon.Contracts.CreativeProviderResult

    @impl true
    def generate(_request, provider_execution) do
      result_fn = Execution.result_fn(provider_execution)
      {:ok, result} = result_fn.("creative tool prompt")

      %CreativeProviderResult{
        status: :ok,
        provider_call_ref: result.provider_call_ref,
        items: [
          %{
            item_id: "item-exec",
            title: "正文草稿",
            body: "正文内容",
            rationale: nil,
            provider_call_ref: result.provider_call_ref
          }
        ]
      }
    end
  end

  defmodule CompanionProvider do
    @behaviour NovelAgent.CreativeProvider

    alias NovelCommon.Contracts.CreativeProviderResult

    @impl true
    def generate(_request, _provider_execution) do
      %CreativeProviderResult{
        status: :ok,
        items: [
          %{item_id: "prose", title: "正文", body: "正文内容", rationale: nil}
        ],
        companion_artifacts: [
          %{
            artifact_type: :world_rule_seed,
            item_id: "rule",
            title: "世界规则",
            body: "规则内容",
            rationale: "正文依据"
          },
          %{
            artifact_type: :character_seed,
            item_id: "character",
            title: "新角色",
            body: "角色内容",
            rationale: "正文依据"
          }
        ]
      }
    end
  end

  defmodule DuplicateCompanionProvider do
    @behaviour NovelAgent.CreativeProvider

    alias NovelCommon.Contracts.CreativeProviderResult

    @impl true
    def generate(_request, _provider_execution) do
      %CreativeProviderResult{
        status: :ok,
        items: [%{item_id: "shared", title: "正文", body: "正文内容", rationale: nil}],
        companion_artifacts: [
          %{
            artifact_type: :character_seed,
            item_id: "shared",
            title: "重复角色",
            body: "角色内容",
            rationale: nil
          }
        ]
      }
    end
  end

  @tag :source_interval_mapping
  test "adapter 恢复真实任务后保留区间映射及原正文，输出采用 v2" do
    task = AuthoringTaskFixtures.task(:revision)
    task = %{task | scope: Map.put(task.scope, :modification_scope, :target_segments)}
    body = " \r\n第一段。\n\n第二段。\t\r\n"
    ids = ["seg_1_source", "seg_2_source"]
    item = %{item_id: "interval", title: "修订", body: body, target_segment_ids: ids}

    result =
      CreativeToolAdapter.execute(
        request(task, [item]),
        :prose_fragment,
        %Execution{result_fn: fn _ -> flunk("fixture must not call transport") end},
        SelfReportProvider
      )

    assert result.status == :succeeded
    assert [accepted] = result.output.items
    assert Map.get(accepted, :target_segment_ids) == ids
    assert accepted.body == body
    assert result.output.output_contract_ref == "tentative_artifact_v2"
  end

  @tag :source_interval_mapping
  test "非原生 provider 也不能向非 target 任务夹带映射" do
    item = %{item_id: "plain", title: "正文", body: "正文保留。"}

    for ids <- [nil, ["seg_1_source"]] do
      result =
        CreativeToolAdapter.execute(
          request(AuthoringTaskFixtures.prose_task(), [Map.put(item, :target_segment_ids, ids)]),
          :prose_fragment,
          %Execution{result_fn: fn _ -> flunk("fixture must not call transport") end},
          SelfReportProvider
        )

      assert result.status == :failed
      assert result.artifact_refs == []
      assert result.state_delta == []
    end
  end

  test "passes creative self_report as observation and non-authoritative warning" do
    result =
      CreativeToolAdapter.execute(
        request(),
        :prose_fragment,
        fn _prompt -> {:ok, %{content: "unused"}} end,
        SelfReportProvider
      )

    assert result.status == :succeeded
    assert result.output.self_report.intended_reader_effect == "紧张、期待"

    assert Enum.any?(
             result.state_delta,
             &match?(%{type: :observation, key: "creative_output_self_report"}, &1)
           )

    assert [
             %{
               code: "creative_output_self_report",
               quality_action: :confirm,
               risk_flags: ["章尾钩子需作者确认"]
             }
           ] = result.warnings
  end

  test "passes provider execution dependency through creative tool adapter" do
    provider_execution = %Execution{
      result_fn: fn _prompt ->
        {:ok, %ProviderResult{content: "unused", provider_call_ref: "pcall-tool-execution"}}
      end
    }

    result =
      CreativeToolAdapter.execute(
        request(),
        :prose_fragment,
        provider_execution,
        ExecutionBackedProvider
      )

    assert result.status == :succeeded
    assert [%{provider_call_ref: "pcall-tool-execution"}] = result.output.items
  end

  test "projects prose companions into grouped ToolResult state without production writes" do
    result =
      CreativeToolAdapter.execute(
        request(),
        :prose_fragment,
        %Execution{result_fn: fn _ -> {:ok, %{content: "unused"}} end},
        CompanionProvider
      )

    assert result.status == :succeeded
    assert result.artifact_refs == ["prose", "rule", "character"]
    assert result.output.companion_item_count == 2

    assert Enum.map(result.output.companion_artifacts, & &1.artifact_type) == [
             :character_seed,
             :world_rule_seed
           ]

    assert Enum.map(result.state_delta, & &1.artifact_type) == [
             :prose_fragment,
             :character_seed,
             :world_rule_seed
           ]

    refute Enum.any?(result.state_delta, &(&1.type == :production_write))
  end

  test "rejects duplicate primary and companion item ids at the tool adapter boundary" do
    result =
      CreativeToolAdapter.execute(
        request(),
        :prose_fragment,
        %Execution{result_fn: fn _ -> {:ok, %{content: "unused"}} end},
        DuplicateCompanionProvider
      )

    assert result.status == :failed
    assert [%{code: "duplicate_item_id"}] = result.errors
    assert result.artifact_refs == []
    assert result.state_delta == []
  end

  defp request(task \\ AuthoringTaskFixtures.prose_task(), items \\ nil) do
    %ToolRequest{
      tool_request_id: "tool-1",
      turn_id: "turn-1",
      frame_ref: "frame-1",
      decision_ref: "decision-1",
      tool_name: "prose_writing",
      tool_version: "1.0",
      input: %{
        "creative_brief" => "写第一章",
        "context_text" => "ReaderEffectBrief",
        "authoring_task" => AuthoringTask.to_map(task),
        "provider_hints" => if(is_nil(items), do: %{}, else: %{"items" => items})
      }
    }
  end

  test "plot_outline 原生响应经 Real 和 Adapter 保留已有章引用，新章不填" do
    execution = %Execution{
      result_fn: fn _ir ->
        {:ok,
         %{
           content: "",
           tool_calls: [
             %{
               id: "outline-native",
               name: "submit_tentative_artifact",
               arguments: %{
                 "items" => [
                   %{
                     "item_id" => "ch-ref",
                     "title" => "第2章：外门名册上的空白",
                     "body" => "章功能定位：推进章",
                     "rationale" => nil,
                     "chapter_ref" => "chapter:11111111-1111-1111-1111-111111111111"
                   },
                   %{
                     "item_id" => "ch-new",
                     "title" => "第3章：新章",
                     "body" => "章功能定位：铺垫章",
                     "rationale" => nil
                   }
                 ]
               }
             }
           ]
         }}
      end
    }

    {result, session} =
      CreativeToolAdapter.execute_with_session(
        outline_request(),
        :outline_draft,
        execution,
        NovelAgent.CreativeProvider.Real
      )

    assert result.status == :succeeded
    assert session.provider_call_count == 1
    [first, second] = result.output.items
    assert Map.get(first, :chapter_ref) == "chapter:11111111-1111-1111-1111-111111111111"
    refute Map.has_key?(second, :chapter_ref)
  end

  test "plot_outline 原生非法或重复 chapter_ref 必须拒收，不能先丢字段再通过" do
    for refs <- [
          ["chapter:not-a-uuid"],
          [
            "chapter:22222222-2222-2222-2222-222222222222",
            "chapter:22222222-2222-2222-2222-222222222222"
          ]
        ] do
      items =
        refs
        |> Enum.with_index()
        |> Enum.map(fn {ref, index} ->
          %{
            "item_id" => "outline-#{index}",
            "title" => "第#{index + 2}章",
            "body" => "章功能定位：推进章",
            "chapter_ref" => ref
          }
        end)

      execution = %Execution{
        result_fn: fn _ir ->
          {:ok,
           %{
             content: "",
             tool_calls: [
               %{
                 id: "outline-invalid",
                 name: "submit_tentative_artifact",
                 arguments: %{"items" => items}
               }
             ]
           }}
        end
      }

      {result, session} =
        CreativeToolAdapter.execute_with_session(
          outline_request(),
          :outline_draft,
          execution,
          NovelAgent.CreativeProvider.Real
        )

      assert result.status == :failed
      assert result.artifact_refs == []
      assert session.provider_call_count == 2
      assert {:ok, []} = NovelCommon.RequestIR.pending_call_ids(session.request_ir)
    end
  end

  defp outline_request do
    %ToolRequest{
      tool_request_id: "tool-outline",
      turn_id: "turn-1",
      frame_ref: "frame-1",
      decision_ref: "decision-1",
      tool_name: "plot_outline",
      tool_version: "1.0",
      input: %{
        "creative_brief" => "规划下面几章",
        "source_input_ref" => "turn:test",
        "context_text" =>
          "## 作品章节\n- 第 2 章「外门名册上的空白」[chapter_ref=chapter:11111111-1111-1111-1111-111111111111]",
        "authoring_task" =>
          AuthoringTask.to_map(
            AuthoringTaskFixtures.task(:outline, %{
              output_contract: AuthoringTaskFixtures.contract_for(:outline)
            })
          )
      }
    }
  end
end
