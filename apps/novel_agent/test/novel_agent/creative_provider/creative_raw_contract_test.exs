defmodule NovelAgent.CreativeProvider.CreativeRawContractTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.TestSupport.AuthoringTaskFixtures
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.RequestIR

  @item %{
    "item_id" => "raw-item",
    "title" => " 雨夜 Ω ",
    "body" => " \r\n雨滴落在桌沿。\n\n沈砚收回了手。\t\r\n",
    "rationale" => "让迟疑落在动作上。\n保留停顿。"
  }
  @arguments %{"items" => [@item]}
  @character %{
    "artifact_type" => "character_seed",
    "item_id" => "raw-character",
    "title" => "沈砚",
    "body" => "身份：借住账房的抄书人。",
    "rationale" => nil
  }
  @foreshadowing %{
    "artifact_type" => "foreshadowing_seed",
    "item_id" => "raw-foreshadowing",
    "title" => "缺角铜钱",
    "body" => "旧铜钱的缺口与门锁上的划痕相合。",
    "rationale" => nil
  }

  setup do
    request = %CreativeRequest{
      request_id: "raw-contract-request",
      run: %{run_id: "raw-contract-run", work_id: "raw-contract-work"},
      tool_name: "prose_writing",
      artifact_type: :prose_fragment,
      creative_brief: "让沈砚的迟疑落在动作上。",
      source_turn_ref: "turn:raw-contract",
      source_input_ref: "turn:raw-author",
      task:
        AuthoringTaskFixtures.prose_task(%{
          source: %{kind: :author_action, ref: "turn:raw-author"},
          source_refs: ["turn:raw-author"],
          materials: [
            %{kind: :target_structure, ref: "chapter:raw-base", version: 4, complete?: true}
          ]
        })
    }

    {:ok, request: request}
  end

  for {label, arguments} <- [
        {"根未知字段", Map.put(@arguments, "canon_adopted", true)},
        {"item 未知字段", %{"items" => [Map.put(@item, "overwrite_canon", true)]}},
        {"模型伪造应用溯源", %{"items" => [Map.put(@item, "provider_call_ref", "forged-call")]}},
        {"self_report 非对象", Map.put(@arguments, "self_report", 42)},
        {"self_report 布尔值", Map.put(@arguments, "self_report", false)},
        {"self_report 未知字段",
         Map.put(@arguments, "self_report", %{"quality_action" => "proceed"})},
        {"assumptions 元素类型", Map.put(@arguments, "self_report", %{"assumptions" => ["保留雨夜", 1]})},
        {"risk_flags 元素类型", Map.put(@arguments, "self_report", %{"risk_flags" => [false]})},
        {"intended_reader_effect 类型",
         Map.put(@arguments, "self_report", %{"intended_reader_effect" => 7})},
        {"companion 未知字段",
         Map.put(@arguments, "companion_artifacts", [
           Map.put(@character, "canon_adopted", true)
         ])},
        {"narrative_role 非枚举",
         Map.put(@arguments, "companion_artifacts", [
           Map.put(@character, "narrative_role", "UNDECLARED_ROLE")
         ])},
        {"role 类型", Map.put(@arguments, "companion_artifacts", [Map.put(@character, "role", 7)])},
        {"aliases 元素类型",
         Map.put(@arguments, "companion_artifacts", [Map.put(@character, "aliases", ["阿砚", 7])])},
        {"planned_reveal 未知嵌套字段",
         Map.put(@arguments, "companion_artifacts", [
           Map.put(@foreshadowing, "planned_reveal", %{
             "kind" => "chapter",
             "seq" => 8,
             "force_publish" => true
           })
         ])},
        {"planned_reveal 不能把字符串强转为序号",
         Map.put(@arguments, "companion_artifacts", [
           Map.put(@foreshadowing, "planned_reveal", %{"kind" => "chapter", "seq" => "8"})
         ])},
        {"world_rule 不能冒充 FactInventory 的 skeleton 包装",
         Map.put(@arguments, "companion_artifacts", [
           %{
             "artifact_type" => "world_rule_seed",
             "item_id" => "forged-skeleton",
             "title" => "篇幅建议",
             "body" => "预计十万字。",
             "skeleton_field" => "target_length",
             "skeleton_value" => 100_000
           }
         ])},
        {"resolution_target 非伏笔引用",
         Map.put(@arguments, "companion_artifacts", [
           Map.put(@foreshadowing, "resolution_target", "chapter:unrelated-target")
         ])},
        {"prose 不得携带 outline 章绑定",
         %{
           "items" => [
             Map.put(@item, "chapter_ref", "chapter:11111111-1111-1111-1111-111111111111")
           ]
         }}
      ] do
    test "原始候选 #{label} 在重建前整体拒绝，原调用保留且全部闭合", %{request: request} do
      arguments = unquote(Macro.escape(arguments))

      execution = %Execution{
        result_fn: fn _ir ->
          {:ok,
           %{
             content: "",
             tool_calls: [
               %{id: "raw-invalid", name: "submit_tentative_artifact", arguments: arguments}
             ]
           }}
        end
      }

      assert {%{status: :error, items: [], errors: [_ | _]}, session} =
               Real.generate_with_session(request, execution)

      assert session.provider_call_count == 2
      assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

      original_arguments =
        for %{role: "assistant", blocks: blocks} <- session.request_ir.messages,
            %{type: "tool_call", arguments: raw} <- blocks,
            do: raw

      assert original_arguments == [arguments, arguments]

      failed_calls =
        for %{role: "tool", blocks: blocks} <- session.request_ir.messages,
            %{type: "validation_result", call_id: call_id, status: "failed"} <- blocks,
            do: call_id

      assert failed_calls == ["raw-invalid", "raw-invalid:2"]
    end
  end

  test "content 与 native 候选不能双写，纯空白也不能被静默清除", %{request: request} do
    for content <- ["已保存到正文。", " \t\n"] do
      execution = %Execution{
        result_fn: fn _ir ->
          {:ok,
           %{
             content: content,
             tool_calls: [
               %{id: "double-body", name: "submit_tentative_artifact", arguments: @arguments}
             ]
           }}
        end
      }

      assert {%{status: :error, items: [], errors: [_ | _]}, session} =
               Real.generate_with_session(request, execution)

      assert session.provider_call_count == 2
      assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

      assert 2 ==
               Enum.count(session.request_ir.messages, fn message ->
                 Enum.any?(message.blocks, fn block ->
                   block.type == "validation_result" and block.status == "failed"
                 end)
               end)
    end
  end

  test "nil 或空 content 的合法工具调用保留 title body rationale 的原字节", %{request: request} do
    for content <- [nil, ""] do
      execution = %Execution{
        result_fn: fn _ir ->
          {:ok,
           %{
             content: content,
             tool_calls: [
               %{id: "raw-valid", name: "submit_tentative_artifact", arguments: @arguments}
             ]
           }}
        end
      }

      assert {%{status: :ok, items: [item]}, session} =
               Real.generate_with_session(request, execution)

      assert item.item_id == "raw-item"
      assert item.title == " 雨夜 Ω "
      assert item.body == " \r\n雨滴落在桌沿。\n\n沈砚收回了手。\t\r\n"
      assert item.rationale == "让迟疑落在动作上。\n保留停顿。"
      assert session.provider_call_count == 1
      assert {:ok, ["raw-valid"]} = RequestIR.pending_call_ids(session.request_ir)
    end
  end

  test "有效 optional 字段与四种 companion 不因闭合合同而丢失", %{request: request} do
    arguments = %{
      "items" => [@item],
      "self_report" => %{
        "assumptions" => ["沿用雨夜"],
        "intended_reader_effect" => "感到迟疑",
        "used_context_refs" => ["chapter:raw-base"],
        "risk_flags" => []
      },
      "companion_artifacts" => [
        Map.merge(@character, %{
          "narrative_role" => "SUPPORTING",
          "role" => "抄书人",
          "aliases" => ["阿砚"]
        }),
        Map.merge(@foreshadowing, %{
          "planned_reveal" => %{"kind" => "chapter", "seq" => 8},
          "resolution_target" => "foreshadow_previous",
          "resolved_at_seq" => 4
        }),
        %{
          "artifact_type" => "world_rule_seed",
          "item_id" => "raw-world",
          "title" => "夜间光源",
          "body" => "城内日落后只允许使用封闭油灯。"
        },
        %{
          "artifact_type" => "constraint_seed",
          "item_id" => "raw-constraint",
          "title" => "视角约束",
          "body" => "本章只呈现沈砚能够看到的事。"
        }
      ]
    }

    execution = %Execution{
      result_fn: fn _ir ->
        {:ok,
         %{
           content: "",
           tool_calls: [
             %{id: "raw-optional", name: "submit_tentative_artifact", arguments: arguments}
           ]
         }}
      end
    }

    assert {%{status: :ok, companion_artifacts: [character, foreshadowing, world, constraint]},
            session} = Real.generate_with_session(request, execution)

    assert character.narrative_role == "SUPPORTING"
    assert character.role == "抄书人"
    assert character.aliases == ["阿砚"]
    assert foreshadowing.planned_reveal == %{"kind" => "chapter", "seq" => 8}
    assert foreshadowing.resolution_target == "foreshadow_previous"
    assert foreshadowing.resolved_at_seq == 4
    assert world.artifact_type == :world_rule_seed
    assert world.body == "城内日落后只允许使用封闭油灯。"
    refute Map.has_key?(world, :skeleton_field)
    refute Map.has_key?(world, :skeleton_value)
    assert constraint.artifact_type == :constraint_seed
    assert session.provider_call_count == 1
  end

  test "第一次 raw 拒收后只采信实际纠正的第二次调用", %{request: request} do
    invalid = Map.put(@arguments, "canon_adopted", true)

    results = [
      %{
        content: "",
        tool_calls: [
          %{id: "raw-first", name: "submit_tentative_artifact", arguments: invalid}
        ]
      },
      %{
        content: "",
        tool_calls: [
          %{
            id: "raw-corrected",
            name: "submit_tentative_artifact",
            arguments: %{
              "items" => [
                %{"item_id" => "corrected", "title" => "再停一息", "body" => "沈砚没有追问。"}
              ]
            }
          }
        ]
      }
    ]

    {execution, calls} = captured_provider(results)

    assert {%{status: :ok, items: [%{item_id: "corrected", body: "沈砚没有追问。"}]}, session} =
             Real.generate_with_session(request, execution)

    assert session.provider_call_count == 2
    assert [first_request, corrected_request] = calls.()
    assert first_request.refs == corrected_request.refs

    assert [
             %{type: "validation_result", call_id: "raw-first", status: "failed"}
           ] =
             for(
               %{role: "tool", blocks: blocks} <- corrected_request.messages,
               block <- blocks,
               block.type == "validation_result",
               do: block
             )

    assert {:ok, ["raw-corrected"]} = RequestIR.pending_call_ids(session.request_ir)
  end

  test "同一候选的结构与引用错误一次回流，修正后才交付原字节", %{request: request} do
    invalid = %{
      "items" => [Map.delete(@item, "title")],
      "self_report" => %{"used_context_refs" => ["chapter:raw-base", "turn:raw-author"]}
    }

    corrected = Map.put(@arguments, "self_report", %{"used_context_refs" => ["chapter:raw-base"]})

    {execution, calls} =
      captured_provider([
        native_response("compound-first", invalid),
        native_response("compound-corrected", corrected)
      ])

    parent = self()

    validator = fn result ->
      send(parent, {:application_validated, result.items})
      :ok
    end

    assert {%{status: :ok, items: [item]}, session} =
             Real.generate_with_session(request, execution, validate_result: validator)

    assert session.provider_call_count == 2
    assert [first, second] = calls.()
    assert first.refs == second.refs
    assert raw_arguments(second, "compound-first") == invalid
    assert [receipt] = failed_receipts(second)
    assert receipt.call_id == "compound-first"
    assert receipt.reason_code == "provider_response_invalid"
    assert receipt.retryable == true

    assert receipt.budget_after["exchange"] == %{
             "provider_call_budget" => 2,
             "provider_call_count" => 1
           }

    assert [
             %{"code" => "provider_response_invalid"},
             %{"code" => "used_context_refs_invalid"}
           ] = receipt.detail["errors"]

    assert receipt.detail["message"] =~ "原始候选参数不符合本次工具 schema"
    assert receipt.detail["message"] =~ "used_context_refs 必须来自本次实际供应的 Base 或 Observation"
    assert item.title == " 雨夜 Ω "
    assert item.body == " \r\n雨滴落在桌沿。\n\n沈砚收回了手。\t\r\n"
    assert item.rationale == "让迟疑落在动作上。\n保留停顿。"
    assert_receive {:application_validated, [^item]}
    refute_receive {:application_validated, _}
    assert {:ok, ["compound-corrected"]} = RequestIR.pending_call_ids(session.request_ir)
  end

  for {label, second_item, expected_codes} <- [
        {"只修标题", @item, ["used_context_refs_invalid"]},
        {"两项仍错", Map.delete(@item, "title"),
         ["provider_response_invalid", "used_context_refs_invalid"]}
      ] do
    test "复合错误的第二次输出#{label}仍整体拒收且不增加预算", %{request: request} do
      first_arguments = %{
        "items" => [Map.delete(@item, "title")],
        "self_report" => %{"used_context_refs" => ["chapter:raw-base", "turn:raw-author"]}
      }

      second_arguments = %{
        "items" => [unquote(Macro.escape(second_item))],
        "self_report" => %{"used_context_refs" => ["chapter:raw-base", "turn:raw-author"]}
      }

      {execution, calls} =
        captured_provider([
          native_response("compound-first", first_arguments),
          native_response("compound-last", second_arguments)
        ])

      parent = self()
      validator = fn _result -> send(parent, :invalid_application_dispatch) end

      assert {%{status: :error, items: [], companion_artifacts: [], errors: errors}, session} =
               Real.generate_with_session(request, execution, validate_result: validator)

      assert Enum.map(errors, & &1.code) == unquote(expected_codes)
      assert session.provider_call_count == 2
      assert [_first, second] = calls.()
      assert raw_arguments(second, "compound-first") == first_arguments
      assert raw_arguments(session.request_ir, "compound-last") == second_arguments
      assert [first_receipt, last_receipt] = failed_receipts(session.request_ir)

      assert [
               %{"code" => "provider_response_invalid"},
               %{"code" => "used_context_refs_invalid"}
             ] = first_receipt.detail["errors"]

      assert last_receipt.call_id == "compound-last"
      assert last_receipt.reason_code == hd(unquote(expected_codes))
      assert last_receipt.retryable == false

      assert last_receipt.budget_after["exchange"] == %{
               "provider_call_budget" => 2,
               "provider_call_count" => 2
             }

      assert Enum.map(last_receipt.detail["errors"], & &1["code"]) == unquote(expected_codes)
      assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)
      refute_receive :invalid_application_dispatch
    end
  end

  test "坏报告或引用形状不被过滤或猜成独立的引用资格错误", %{request: request} do
    for {report, expected_code} <- [
          {42, "provider_response_invalid"},
          {false, "provider_response_invalid"},
          {[], "provider_response_invalid"},
          {nil, "provider_response_invalid"},
          {%{"used_context_refs" => nil}, "invalid_used_context_refs"},
          {%{"used_context_refs" => false}, "invalid_used_context_refs"},
          {%{"used_context_refs" => "turn:raw-author"}, "invalid_used_context_refs"},
          {%{"used_context_refs" => %{"ref" => "turn:raw-author"}}, "invalid_used_context_refs"},
          {%{"used_context_refs" => ["chapter:raw-base", nil]}, "invalid_used_context_refs"},
          {%{"used_context_refs" => ["turn:raw-author", " \t"]}, "invalid_used_context_refs"}
        ] do
      arguments = %{"items" => [Map.delete(@item, "title")], "self_report" => report}
      {execution, _calls} = captured_provider([native_response("bad-shape", arguments)])
      parent = self()
      validator = fn _result -> send(parent, :invalid_application_dispatch) end

      assert {%{status: :error, errors: [%{code: ^expected_code}]}, session} =
               Real.generate_with_session(request, execution,
                 validate_result: validator,
                 max_provider_calls: 1
               )

      assert raw_arguments(session.request_ir, "bad-shape") == arguments
      assert [receipt] = failed_receipts(session.request_ir)
      assert receipt.reason_code == expected_code
      refute receipt.detail["message"] =~ "used_context_refs 必须来自"
      assert receipt.retryable == false
      refute_receive :invalid_application_dispatch
    end
  end

  test "发给模型的 root item self_report 与接收边界使用闭合字段", %{request: request} do
    assert {:ok, ir} = Real.request_ir(request)
    assert [%{input_schema: schema}] = RequestIR.Tools.tool_specs(ir)

    assert schema["additionalProperties"] == false
    assert schema["properties"]["items"]["items"]["additionalProperties"] == false

    self_report = schema["properties"]["self_report"]
    assert self_report["additionalProperties"] == false

    assert Enum.sort(Map.keys(self_report["properties"])) ==
             ["assumptions", "intended_reader_effect", "risk_flags", "used_context_refs"]

    refute Map.has_key?(schema["properties"]["items"]["items"]["properties"], "provider_call_ref")
  end

  defp native_response(id, arguments) do
    %{
      content: "",
      tool_calls: [%{id: id, name: "submit_tentative_artifact", arguments: arguments}]
    }
  end

  defp captured_provider(results) do
    state = start_supervised!({Agent, fn -> {results, []} end}, id: make_ref())

    execution = %Execution{
      result_fn: fn ir ->
        Agent.get_and_update(state, fn
          {[result | remaining], calls} -> {{:ok, result}, {remaining, calls ++ [ir]}}
          {[], calls} -> {{:error, :unexpected_extra_call}, {[], calls ++ [ir]}}
        end)
      end
    }

    {execution, fn -> Agent.get(state, fn {_remaining, calls} -> calls end) end}
  end

  defp raw_arguments(ir, id) do
    [arguments] =
      for %{role: "assistant", blocks: blocks} <- ir.messages,
          %{type: "tool_call", call_id: ^id, arguments: arguments} <- blocks,
          do: arguments

    arguments
  end

  defp failed_receipts(ir) do
    for %{role: "tool", blocks: blocks} <- ir.messages,
        %{type: "validation_result", status: "failed"} = receipt <- blocks,
        do: receipt
  end
end
