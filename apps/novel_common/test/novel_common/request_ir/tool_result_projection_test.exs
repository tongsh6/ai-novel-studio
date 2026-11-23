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

  @r08_rejection_fact "本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n"
  @r08_raw "  首稿原文字节。\r\n末行  "

  describe "R08 无工具拒收沿同一七字段投影" do
    @tag :r08_response_rejection
    test "三 wire 同时保留原始 assistant 和完整拒收事实，不泄漏内部身份或伪造工具" do
      request = response_rejection_request()
      assert :ok = RequestIR.validate(request)
      expected = response_rejection_payload()

      for target <- ~w(chat_completions responses_api anthropic_messages) do
        assert {:ok, body} = Projection.project(request, target)
        units = response_wire_units(body, target)

        assert Enum.filter(units, fn {role, _} -> role == "assistant" end) == [
                 {"assistant", @r08_raw}
               ]

        assert response_notice_payload(units) == expected

        assert Map.keys(response_notice_payload(units)) |> Enum.sort() ==
                 ~w(budget_after data error_code message observation_ref ok retryable)

        encoded = Jason.encode!(body)

        for private <- [
              "pcall-r08-wire",
              "prun-r08-wire",
              "private-r08-reasoning",
              "\"call_id\"",
              "\"tool_call_id\"",
              "\"tool_use_id\""
            ] do
          refute encoded =~ private
        end

        refute encoded =~ "\"function_call\""
        refute encoded =~ "\"function_call_output\""
        refute encoded =~ "\"tool_result\""
      end
    end

    @tag :r08_response_rejection
    test "普通 text notice 保持逐字投影，即使正文引用未通过接收也不生成状态" do
      request = response_rejection_request()
      text = "  职责续行：原文中的「未通过接收」只是讨论材料。\r\n"
      notice = RequestIR.message(:application_notice, :application, [RequestIR.text_block(text)])
      request = %{request | messages: List.replace_at(request.messages, -1, notice)}
      assert :ok = RequestIR.validate(request)

      for target <- ~w(chat_completions responses_api anthropic_messages) do
        assert {:ok, body} = Projection.project(request, target)

        assert List.last(response_wire_units(body, target)) ==
                 {"user", "【应用数据 · application_notice · 非作者原话】\n" <> text}

        refute Jason.encode!(body) =~ "\"validation_result\""
      end
    end

    @tag :r08_response_rejection
    test "共存的原生结果仍有唯一 call_id，后来 Scope 不重写响应拒收的实际窗口" do
      request = response_rejection_request()

      {request, _} =
        RequestIR.append_assistant_result(request, %{
          content: "",
          tool_calls: [%{id: "call-result", name: "read_character", arguments: %{}}],
          provider_call_ref: "pcall-real-tool",
          provider_run_ref: "prun-real-tool"
        })

      request =
        request
        |> RequestIR.append_validation_result(
          "call-result",
          "passed",
          "judgment_validated",
          %{execution_authorized: false},
          %{retryable: false}
        )
        |> RequestIR.append_scope_update(%{
          work_id: "work-1",
          operation: %{runtime: %{budget: %{provider_calls: 99}}}
        })

      assert :ok = RequestIR.validate(request)
      assert RequestIR.call_ids(request.messages) == ["call-result"]
      assert {:ok, []} = RequestIR.pending_call_ids(request)

      for target <- ~w(chat_completions responses_api anthropic_messages) do
        assert {:ok, body} = Projection.project(request, target)

        assert response_notice_payload(response_wire_units(body, target)) ==
                 response_rejection_payload()

        native = result_payload(request, target)
        assert native["ok"] == true
        assert native["data"]["detail"] == %{"execution_authorized" => false}
        assert native["retryable"] == false
        assert native["budget_after"] == nil
      end
    end
  end

  defp response_rejection_request do
    base = result_request(RequestIR.validation_result_block("call-result", "passed", "unused"))
    refs = %{provider_call_ref: "pcall-r08-wire", provider_run_ref: "prun-r08-wire"}
    payload = response_rejection_payload()

    block = %{
      type: "validation_result",
      status: "failed",
      reason_code: payload["error_code"],
      detail: payload["data"]["detail"],
      retryable: payload["retryable"],
      budget_after: payload["budget_after"]
    }

    %{
      base
      | run:
          Map.merge(base.run, %{
            workspace_id: "ws-1",
            session_id: "session-1",
            parent_turn_ref: "author_turn:turn-1"
          }),
        messages:
          Enum.take(base.messages, 2) ++
            [
              RequestIR.message(
                :assistant,
                :model,
                [RequestIR.text_block(@r08_raw)],
                Map.put(refs, :provider_state, %{"reasoning_content" => "private-r08-reasoning"})
              ),
              RequestIR.message(:application_notice, :application, [block], refs)
            ]
    }
  end

  defp response_rejection_payload do
    message = @r08_rejection_fact <> "只纠正本次协议，不改变作者目标。"

    %{
      "ok" => false,
      "data" => %{
        "type" => "validation_result",
        "status" => "failed",
        "reason_code" => "native_tool_call_required",
        "detail" => %{"message" => message, "reason" => "missing_tool"}
      },
      "error_code" => "native_tool_call_required",
      "message" => message,
      "retryable" => true,
      "observation_ref" => nil,
      "budget_after" => %{
        "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}
      }
    }
  end

  defp response_notice_payload(units) do
    prefix = "【应用数据 · application_notice · 非作者原话】\n"

    assert [{"user", text}] =
             Enum.filter(units, fn {_role, text} -> String.starts_with?(text, prefix) end)

    text |> String.replace_prefix(prefix, "") |> Jason.decode!()
  end

  defp response_wire_units(body, "chat_completions"),
    do: for(%{role: role, content: text} <- body.messages, is_binary(text), do: {role, text})

  defp response_wire_units(body, target) when target in ["responses_api", "anthropic_messages"] do
    for message <- Map.get(body, :input, Map.get(body, :messages, [])),
        %{type: type, text: text} <- Map.get(message, :content, []),
        type in ["text", "input_text", "output_text"],
        do: {message.role, text}
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
