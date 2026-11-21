defmodule NovelCommon.RequestIR.ToolResultProjectionTest do
  use ExUnit.Case, async: true

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelTest.TestRequestIR

  describe "R07 七字段原生工具结果" do
    test "三种 wire 保留观察五态与覆盖，只使用真实观察身份" do
      budget = %{
        exploration: %{
          open?: false,
          normal_open?: false,
          continuation_open?: false,
          continuation_only?: false,
          continuation: nil,
          total: 2
        }
      }

      for status <- ~w(ok partial truncated unavailable stale) do
        block =
          RequestIR.observation_block("call-result", %{
            status: status,
            source_refs: [%{ref: "character:1", version: 2}],
            versions: %{"character:1" => 2},
            coverage: %{read: 3, total: 8},
            omissions: ["其余五段未供应"],
            next_offset: 3,
            content: %{
              summary: "原始观察\n  保留空白",
              observation_ref: "observation:actual-read"
            },
            retryable: false,
            budget_after: budget
          })

        request = result_request(block)
        successful? = status in ~w(ok partial truncated)

        expected = %{
          "ok" => successful?,
          "data" => %{
            "type" => "observation",
            "status" => status,
            "source_refs" => [%{"ref" => "character:1", "version" => 2}],
            "versions" => %{"character:1" => 2},
            "coverage" => %{"read" => 3, "total" => 8},
            "omissions" => ["其余五段未供应"],
            "next_offset" => 3,
            "content" => %{
              "summary" => "原始观察\n  保留空白",
              "observation_ref" => "observation:actual-read"
            }
          },
          "error_code" => if(successful?, do: nil, else: status),
          "message" => if(successful?, do: nil, else: "原始观察\n  保留空白"),
          "retryable" => false,
          "observation_ref" => "observation:actual-read",
          "budget_after" => %{
            "exploration" => %{
              "open?" => false,
              "normal_open?" => false,
              "continuation_open?" => false,
              "continuation_only?" => false,
              "continuation" => nil,
              "total" => 2
            }
          }
        }

        for target <- ~w(chat_completions responses_api anthropic_messages) do
          assert result_payload(request, target) == expected
        end
      end
    end

    test "校验通过只证明校验，原授权与 Canon 标记仍留在 typed data" do
      block =
        RequestIR.validation_result_block(
          "call-result",
          "passed",
          "judgment_validated",
          %{execution_authorized: false, canon_written: false},
          %{
            retryable: false,
            budget_after: %{exchange: %{provider_call_budget: 2, provider_call_count: 1}}
          }
        )

      expected = %{
        "ok" => true,
        "data" => %{
          "type" => "validation_result",
          "status" => "passed",
          "reason_code" => "judgment_validated",
          "detail" => %{"execution_authorized" => false, "canon_written" => false}
        },
        "error_code" => nil,
        "message" => nil,
        "retryable" => false,
        "observation_ref" => nil,
        "budget_after" => %{
          "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}
        }
      }

      for target <- ~w(chat_completions responses_api anthropic_messages) do
        assert result_payload(result_request(block), target) == expected
      end
    end

    test "失败只取原 reason/message，后续 Scope 不改变当时窗口或补出观察身份" do
      block =
        RequestIR.validation_result_block(
          "call-result",
          "failed",
          "invalid_tool_arguments",
          %{message: "保留原目标，只纠正字段", observation_ref: "observation:not-a-read"},
          %{
            retryable: true,
            budget_after: %{exchange: %{provider_call_budget: 2, provider_call_count: 1}}
          }
        )

      before = result_request(block)

      after_scope =
        RequestIR.append_scope_update(before, %{
          work_id: "work-1",
          operation: %{
            runtime: %{budget: %{provider_calls: 99}, consumed_budget: %{provider_calls: 88}}
          }
        })

      assert :ok = RequestIR.validate(before)
      assert :ok = RequestIR.validate(after_scope)

      for target <- ~w(chat_completions responses_api anthropic_messages) do
        payload = result_payload(before, target)
        assert payload == result_payload(after_scope, target)

        assert Map.keys(payload) |> Enum.sort() ==
                 ~w(budget_after data error_code message observation_ref ok retryable)

        assert payload["ok"] == false
        assert payload["error_code"] == "invalid_tool_arguments"
        assert payload["message"] == "保留原目标，只纠正字段"
        assert payload["retryable"] == true
        assert payload["observation_ref"] == nil
        assert payload["data"]["detail"]["observation_ref"] == "observation:not-a-read"

        assert payload["budget_after"] == %{
                 "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}
               }
      end
    end

    test "没有当时恢复事实保持 null，不从最新 Scope 或 call_id 填值" do
      blocks = [
        RequestIR.validation_result_block("call-result", "failed", "unknown_budget"),
        RequestIR.observation_block("call-result", %{status: "unavailable", content: %{}})
      ]

      for block <- blocks, target <- ~w(chat_completions responses_api anthropic_messages) do
        request =
          block
          |> result_request()
          |> RequestIR.append_scope_update(%{
            work_id: "work-1",
            operation: %{
              runtime: %{budget: %{provider_calls: 2}, consumed_budget: %{provider_calls: 1}}
            }
          })

        assert :ok = RequestIR.validate(request)
        payload = result_payload(request, target)
        assert payload["retryable"] == nil
        assert payload["budget_after"] == nil
        assert payload["observation_ref"] == nil
        assert payload["message"] == nil
        assert payload["ok"] == false
      end
    end
  end

  defp result_request(block) do
    base_refs = [%{ref: "work:work-1", version: 3}]

    TestRequestIR.ir(
      [
        RequestIR.message(
          :application_base,
          :application,
          [RequestIR.text_block("run goal: 读取作品事实并生成 tentative 候选")],
          %{source_refs: base_refs}
        ),
        TestRequestIR.author("把沈砚的年龄改成三十岁", "author_turn:turn-1"),
        TestRequestIR.assistant("", [
          TestRequestIR.tool_call("read_character", %{}, "call-result")
        ]),
        RequestIR.message(:tool, :tool_result, [block])
      ],
      run: %{run_id: "run-g1", work_id: "work-1", goal: %{text: "读取作品事实后给出候选"}},
      system:
        RequestIR.system_envelope(
          instructions: "你是创作 run，只在作者授权边界内行动。",
          run_role: "creation_run"
        ),
      tools: [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}],
      projection: %{usage_streaming: false},
      refs: %{base_refs: base_refs, observation_refs: [], used_refs: []}
    )
  end

  defp result_payload(request, "chat_completions") do
    assert {:ok, body} = Projection.project(request, "chat_completions")

    assert [%{tool_call_id: "call-result", content: content}] =
             Enum.filter(body.messages, &(&1.role == "tool"))

    Jason.decode!(content)
  end

  defp result_payload(request, "responses_api") do
    assert {:ok, body} = Projection.project(request, "responses_api")

    assert [%{call_id: "call-result", output: output}] =
             Enum.filter(body.input, &(&1.type == "function_call_output"))

    Jason.decode!(output)
  end

  defp result_payload(request, "anthropic_messages") do
    assert {:ok, body} = Projection.project(request, "anthropic_messages")

    results =
      for message <- body.messages,
          block <- message.content,
          block.type == "tool_result",
          do: block

    assert [%{tool_use_id: "call-result", content: content}] = results
    Jason.decode!(content)
  end
end
