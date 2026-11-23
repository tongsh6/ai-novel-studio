defmodule NovelCommon.RequestIR.ResponseValidationTest do
  use ExUnit.Case, async: true

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.{MessageCoverage, Projection}

  @author_text "把沈砚的年龄改成三十岁"

  defp base_refs, do: [%{ref: "work:work-1", version: 3}]

  defp tools,
    do: [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}]

  defp message(role, provenance, blocks, extra \\ %{}) do
    RequestIR.message(role, provenance, blocks, extra)
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp ir(messages, opts \\ []) do
    RequestIR.new(%{
      run: %{run_id: "run-g1", work_id: "work-1", goal: %{text: "读取作品事实后给出候选"}},
      system:
        RequestIR.system_envelope(
          instructions: "你是创作 run，只在作者授权边界内行动。",
          run_role: "creation_run"
        ),
      messages: messages,
      tools: Keyword.get(opts, :tools, tools()),
      projection:
        %{usage_streaming: false} |> maybe_put(:finite_mode, Keyword.get(opts, :finite_mode)),
      refs:
        Keyword.get(opts, :refs, %{base_refs: base_refs(), observation_refs: [], used_refs: []})
    })
  end

  defp g1_messages do
    [
      message(
        :application_base,
        :application,
        [RequestIR.text_block("run goal: 读取作品事实并生成 tentative 候选")],
        %{source_refs: base_refs()}
      ),
      message(:user, :author, [RequestIR.text_block(@author_text)], %{
        source_refs: [%{ref: "author_turn:turn-1"}]
      })
    ]
  end

  @r08_response_fact "本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n"

  describe "R08 无工具响应拒收的同源 union" do
    @tag :r08_response_rejection
    test "原始结构接受有正文及空 blocks 的真实拒收，不生成工具结果或调用" do
      for blocks <- [[RequestIR.text_block("  未接收的首稿。\r\n")], []] do
        request = r08_rejected_request(blocks)
        before = request.messages
        assert :ok = RequestIR.validate(request)
        assert {:ok, []} = RequestIR.pending_call_ids(request)
        assert RequestIR.call_ids(request.messages) == []
        assert {:ok, prepared} = RequestIR.prepare_request(request)
        assert prepared.messages == before
        assert List.last(before).role == "application_notice"
        refute Map.has_key?(hd(List.last(before).blocks), :call_id)
      end
    end

    @tag :r08_response_rejection
    test "同 run 第二条真实作者输入不等于 parent_turn_ref，未注解 live 拒收仍合法" do
      request = r08_rejected_request()
      [base, first_author, assistant, notice] = request.messages

      second_author =
        message(:user, :author, [RequestIR.text_block("沿刚才的资料继续分析。")], %{
          source_refs: [%{ref: "author_turn:turn-2"}]
        })

      resumed = %{request | messages: [base, first_author, second_author, assistant, notice]}
      assert resumed.run.parent_turn_ref == "author_turn:turn-1"
      assert :ok = RequestIR.validate(resumed)
      assert {:ok, ready} = RequestIR.prepare_request(resumed)
      assert ready.messages == resumed.messages
      assert {:ok, []} = RequestIR.pending_call_ids(ready)
    end

    @tag :r08_response_rejection
    test "现 append API 按主体区分响应拒收与原生工具结果，纠错事实只组装一次" do
      expected = r08_rejected_request()
      initial = %{expected | messages: Enum.drop(expected.messages, -1)}

      actual =
        RequestIR.append_validation_result(
          initial,
          r08_response_refs(),
          "failed",
          "native_tool_call_required",
          %{message: "请保留原目标并调用实际工具。", reason: "missing_tool"},
          %{
            retryable: true,
            budget_after: %{exchange: %{provider_call_budget: 2, provider_call_count: 1}}
          }
        )

      assert actual == expected
      assert :ok = RequestIR.validate(actual)

      native =
        ir(
          g1_messages() ++
            [
              message(:assistant, :model, [
                RequestIR.tool_call_block("read_character", %{}, "native-r08")
              ])
            ]
        )
        |> RequestIR.append_validation_result(
          "native-r08",
          "failed",
          "invalid_tool_arguments",
          %{message: "只纠正原参数。"},
          %{
            retryable: false,
            budget_after: %{exchange: %{provider_call_budget: 2, provider_call_count: 2}}
          }
        )

      assert :ok = RequestIR.validate(native)
      assert List.last(native.messages).role == "tool"
      assert [native_receipt] = List.last(native.messages).blocks
      assert native_receipt.call_id == "native-r08"
      assert native_receipt.detail == %{"message" => "只纠正原参数。"}
      assert RequestIR.call_ids(native.messages) == ["native-r08"]
      assert {:ok, []} = RequestIR.pending_call_ids(native)
    end

    @tag :r08_response_rejection
    test "响应与回执两端都必须有完整有效且逐字相等的 pcall/prun" do
      valid = r08_rejected_request()

      for index <- [-2, -1],
          field <- [:provider_call_ref, :provider_run_ref],
          bad <- [:missing, nil, "", " \n ", 17, %{}, <<255>>] do
        invalid =
          List.update_at(valid.messages, index, fn message ->
            if bad == :missing, do: Map.delete(message, field), else: Map.put(message, field, bad)
          end)

        assert {:error, _} = RequestIR.validate(%{valid | messages: invalid})
      end

      for field <- [:provider_call_ref, :provider_run_ref] do
        invalid = List.update_at(valid.messages, -1, &Map.put(&1, field, "another-real-response"))
        assert {:error, _} = RequestIR.validate(%{valid | messages: invalid})
      end
    end

    @tag :r08_response_rejection
    test "拒收只绑定紧前真实响应，不能越过新作者、成功助手或普通通知" do
      valid = r08_rejected_request()
      [base, author, assistant, notice] = valid.messages

      next_author =
        message(:user, :author, [RequestIR.text_block("这是另一条输入。")], %{
          source_refs: [%{ref: "author-next"}]
        })

      later = %{assistant | provider_call_ref: "pcall-later", provider_run_ref: "prun-later"}
      ordinary = message(:application_notice, :application, [RequestIR.text_block("职责续行。")])

      for messages <- [
            [base, author, assistant, next_author, notice],
            [base, author, assistant, later, notice],
            [base, author, assistant, ordinary, notice],
            [base, author, notice],
            [base, assistant, notice],
            [base, %{author | source_refs: []}, assistant, notice]
          ] do
        assert {:error, _} = RequestIR.validate(%{valid | messages: messages})
      end
    end

    @tag :r08_response_rejection
    test "有持久坐标时另核同 run/作品/会话/作者归属，合法旧 run 拒收仍可组合" do
      valid = r08_rejected_request()
      [base, author, assistant, notice] = valid.messages
      old_run = %{valid.run | run_id: "old-r08", parent_turn_ref: "old-author"}

      old =
        [Map.put(author, :source_refs, [%{ref: "old-author"}]), assistant, notice]
        |> Enum.with_index(1)
        |> Enum.map(fn {message, sequence} ->
          Map.put(
            message,
            :canonical_ref,
            Map.merge(old_run, %{run_sequence: sequence, run_status: "completed"})
          )
        end)

      composed = %{valid | messages: [base] ++ old ++ [author]}
      assert :ok = RequestIR.validate(composed)

      for field <- [:run_id, :workspace_id, :work_id, :session_id, :parent_turn_ref] do
        invalid =
          List.update_at(composed.messages, 3, fn message ->
            put_in(message, [:canonical_ref, field], "different-owner")
          end)

        assert {:error, _} = RequestIR.validate(%{composed | messages: invalid})
      end
    end

    @tag :r08_response_rejection
    test "重复实际响应引用或重复回执不能用同文、最后命中或去重掩盖" do
      valid = r08_rejected_request()
      [base, author, assistant, notice] = valid.messages

      for repeated <- [
            assistant,
            %{assistant | provider_call_ref: "pcall-other"},
            %{assistant | provider_run_ref: "prun-other"}
          ] do
        assert {:error, _} =
                 RequestIR.validate(%{
                   valid
                   | messages: [base, author, repeated, assistant, notice]
                 })
      end

      assert {:error, _} =
               RequestIR.validate(%{valid | messages: valid.messages ++ [notice]})
    end

    @tag :r08_response_rejection
    test "响应主体只允许单个 failed validation，call_id/内部 refs/双主体均拒绝" do
      valid = r08_rejected_request()
      notice = List.last(valid.messages)
      [block] = notice.blocks

      invalid_notices = [
        %{notice | blocks: [Map.put(block, :call_id, nil)]},
        %{notice | blocks: [Map.put(block, :call_id, "native-r08")]},
        %{notice | blocks: [Map.put(block, :provider_call_ref, "internal-leak")]},
        %{notice | blocks: [Map.put(block, :provider_run_ref, "internal-leak")]},
        %{notice | blocks: [%{block | status: "passed"}]},
        %{notice | blocks: [block, block]},
        %{notice | blocks: [RequestIR.text_block("第二条解释"), block]},
        %{notice | role: "tool", provenance: "tool_result"},
        %{notice | provenance: "model"}
      ]

      for invalid <- invalid_notices do
        assert {:error, _} =
                 RequestIR.validate(%{
                   valid
                   | messages: List.replace_at(valid.messages, -1, invalid)
                 })
      end

      mixed =
        List.update_at(valid.messages, -2, fn message ->
          %{
            message
            | blocks:
                message.blocks ++ [RequestIR.tool_call_block("read_character", %{}, "native-r08")]
          }
        end)

      assert {:error, _} = RequestIR.validate(%{valid | messages: mixed})
    end

    @tag :r08_response_rejection
    test "响应回执不吞掉真实工具待处理项，也不能让缺 call_id 工具结果通过" do
      rejected = r08_rejected_request()

      pending =
        message(:assistant, :model, [
          RequestIR.tool_call_block("read_character", %{}, "pending-r08")
        ])

      request = %{rejected | messages: rejected.messages ++ [pending]}
      assert :ok = RequestIR.validate(request)
      assert {:error, {:pending_tool_calls, ["pending-r08"]}} = RequestIR.prepare_request(request)

      native_result =
        message(:tool, :tool_result, [
          RequestIR.validation_result_block("pending-r08", "failed", "invalid")
        ])

      assert :ok = RequestIR.validate(%{request | messages: request.messages ++ [native_result]})

      for bad_id <- [:missing, nil, "not-the-pending-call"] do
        [block] = native_result.blocks

        bad =
          if bad_id == :missing,
            do: Map.delete(block, :call_id),
            else: Map.put(block, :call_id, bad_id)

        assert {:error, _} =
                 RequestIR.validate(%{
                   request
                   | messages: request.messages ++ [%{native_result | blocks: [bad]}]
                 })
      end
    end
  end

  @r08_task_fact "本次响应未通过接收，未作为任务回复发布；仍在处理原任务。\n"
  @r08_task_raw "  这份评审没有调用规定的工具。\r\n"
  @r08_task_correction "请只返回本次任务要求的实际工具结果。"

  describe "R08 既有无作者应用任务的响应拒收" do
    @tag :r08_response_rejection
    @tag :r08_application_task_rejection
    test "request_id 独立归属与完整运行均保留真实正文或空响应，不制造作者或工具" do
      for run <- r08_application_runs(),
          blocks <- [[RequestIR.text_block(@r08_task_raw)], []] do
        request = r08_application_request(run, blocks)
        before = request.messages
        [base, scope, source, notice] = before

        assert :ok = RequestIR.validate(request)
        [block] = notice.blocks
        assert {:ok, ^block} = MessageCoverage.response_validation(before, 2, run)
        assert {:ok, []} = RequestIR.pending_call_ids(request)
        assert RequestIR.call_ids(before) == []
        assert {:ok, prepared} = RequestIR.prepare_request(request)
        assert prepared.messages == [base, scope, source, notice]
        assert source.blocks == blocks
        assert source.provider_state == %{"reasoning_content" => "private-application-task"}
        refute Enum.any?(before, &(&1.role == "user" or &1.provenance == "author"))
        refute Enum.any?(before, &(&1.role == "tool"))
        refute Map.has_key?(block, :call_id)
      end

      persisted = r08_application_runs() |> List.last() |> r08_application_request()
      persisted = %{persisted | messages: r08_task_coordinates(persisted.messages, persisted.run)}
      assert :ok = RequestIR.validate(persisted)

      assert {:ok, _block} =
               MessageCoverage.response_validation(persisted.messages, 2, persisted.run)
    end

    @tag :r08_response_rejection
    @tag :r08_application_task_rejection
    @tag :r08_application_task_rejection_time
    test "后来真实作者不改写先前应用任务拒收，源前坏作者仍不能降级" do
      request = r08_application_request(List.last(r08_application_runs()))

      later =
        message(:user, :author, [RequestIR.text_block("请继续讨论刚才的结果。")], %{
          source_refs: [%{ref: "author-after-task"}]
        })

      messages = r08_task_coordinates(request.messages ++ [later], request.run)
      continued = %{request | messages: messages}
      before = Enum.take(messages, 4)
      [receipt] = List.last(before).blocks

      assert :ok = RequestIR.validate(continued)
      assert {:ok, ^receipt} = MessageCoverage.response_validation(messages, 2, request.run)
      assert {:ok, prepared} = RequestIR.prepare_request(continued)
      assert Enum.take(prepared.messages, 4) == before
      assert receipt.detail["message"] == @r08_task_fact <> @r08_task_correction
      assert List.last(prepared.messages).source_refs == [%{ref: "author-after-task"}]
      refute receipt.detail["message"] =~ "原作者输入"

      for kind <- [:bad_ref, :foreign_owner] do
        prior =
          message(:user, :author, [RequestIR.text_block("源响应之前的作者。")], %{
            source_refs: if(kind == :bad_ref, do: [], else: [%{ref: "foreign-author"}])
          })

        invalid = r08_task_coordinates([prior | request.messages] ++ [later], request.run)

        invalid =
          if kind == :foreign_owner,
            do: List.update_at(invalid, 0, &put_in(&1, [:canonical_ref, :run_id], "foreign-run")),
            else: invalid

        r08_assert_invalid_application_request(%{request | messages: invalid})
      end
    end

    @tag :r08_response_rejection
    @tag :r08_application_task_rejection
    test "现 append 对无作者任务只加一次中性事实，应用来源引用不生成作者关系" do
      for run <- r08_application_runs() do
        expected = r08_application_request(run)

        expected = %{
          expected
          | messages:
              List.update_at(expected.messages, 1, fn scope ->
                [block] = scope.blocks

                content =
                  Map.put(block.content, "goal", %{"source_input_ref" => "task-source-only"})

                %{scope | blocks: [%{block | content: content}]}
              end)
        }

        initial = %{expected | messages: Enum.drop(expected.messages, -1)}
        before = initial.messages

        actual =
          RequestIR.append_validation_result(
            initial,
            r08_application_refs(),
            "failed",
            "native_tool_call_required",
            %{message: @r08_task_correction, reason: "missing_tool"},
            %{
              retryable: true,
              budget_after: %{exchange: %{provider_call_budget: 2, provider_call_count: 1}}
            }
          )

        assert actual == expected
        assert Enum.take(actual.messages, length(before)) == before
        assert :ok = RequestIR.validate(actual)
        [receipt] = List.last(actual.messages).blocks
        assert receipt.detail["message"] == @r08_task_fact <> @r08_task_correction
        refute receipt.detail["message"] =~ "原作者输入"
        refute Enum.any?(actual.messages, &(&1.role == "user" or &1.provenance == "author"))
      end
    end

    @tag :r08_response_rejection
    @tag :r08_application_task_rejection
    test "三 wire 投影同一七字段任务回执，失败原文与空响应边界不变且不泄漏执行引用" do
      for blocks <- [[RequestIR.text_block(@r08_task_raw)], []],
          target <- ~w(chat_completions responses_api anthropic_messages) do
        request = r08_application_request(hd(r08_application_runs()), blocks)
        before = request.messages
        assert {:ok, body} = Projection.project(request, target)
        units = r08_application_wire_units(body, target)
        header = "【应用数据 · application_notice · 非作者原话】\n"
        assert {"user", text} = List.last(units)
        assert String.starts_with?(text, header)

        assert text |> String.replace_prefix(header, "") |> Jason.decode!() ==
                 r08_application_payload()

        expected_assistants =
          cond do
            blocks != [] -> [{"assistant", @r08_task_raw}]
            target == "chat_completions" -> [{"assistant", ""}]
            true -> []
          end

        assert Enum.filter(units, &(elem(&1, 0) == "assistant")) == expected_assistants
        assert request.messages == before
        encoded = Jason.encode!(body)

        for internal <- [
              "pcall-r08-task",
              "prun-r08-task",
              "provider_call_ref",
              "provider_run_ref",
              "private-application-task"
            ] do
          refute encoded =~ internal
        end

        for native_type <- [
              "\"tool_calls\"",
              "\"tool_result\"",
              "\"function_call\"",
              "\"function_call_output\""
            ] do
          refute encoded =~ native_type
        end
      end
    end

    @tag :r08_response_rejection
    @tag :r08_application_task_rejection
    test "无作者任务必须在响应前真实供应 Base 再供应 Scope，缺失或颠倒均不能补证" do
      request = r08_application_request(List.last(r08_application_runs()))
      [base, scope, source, notice] = request.messages

      for messages <- [
            [scope, source, notice],
            [base, source, notice],
            [scope, base, source, notice],
            [scope, source, notice, base],
            [base, source, notice, scope]
          ] do
        r08_assert_invalid_application_request(%{request | messages: messages})
      end
    end

    @tag :r08_response_rejection
    @tag :r08_application_task_rejection
    test "任务 Base 与 Scope 坐标必须同 owner 且顺序真实，Scope 作品不能借另一运行" do
      request = r08_application_request(List.last(r08_application_runs()))
      request = %{request | messages: r08_task_coordinates(request.messages, request.run)}

      for index <- [0, 1],
          field <- [:run_id, :workspace_id, :work_id, :session_id, :parent_turn_ref] do
        messages =
          List.update_at(request.messages, index, fn message ->
            put_in(message, [:canonical_ref, field], "foreign-task-owner")
          end)

        r08_assert_invalid_application_request(%{request | messages: messages})
      end

      for {index, sequence} <- [{0, 3}, {1, 1}, {1, 5}] do
        messages =
          List.update_at(request.messages, index, fn message ->
            put_in(message, [:canonical_ref, :run_sequence], sequence)
          end)

        r08_assert_invalid_application_request(%{request | messages: messages})
      end

      for run <- r08_application_runs() do
        initial = r08_application_request(run)

        messages =
          List.update_at(initial.messages, 1, fn scope ->
            [block] = scope.blocks

            %{
              scope
              | blocks: [%{block | content: Map.put(block.content, "work_id", "other-work")}]
            }
          end)

        r08_assert_invalid_application_request(%{initial | messages: messages})
      end
    end

    @tag :r08_response_rejection
    @tag :r08_application_task_rejection
    test "存在坏作者或外 run 作者时不得降级成无作者任务" do
      request = r08_application_request(List.last(r08_application_runs()))
      [base, scope, source, notice] = request.messages

      for refs <- [:missing, [], [%{ref: ""}], [%{ref: " \n "}]] do
        author = message(:user, :author, [RequestIR.text_block("这是真实作者消息。")])
        author = if refs == :missing, do: author, else: Map.put(author, :source_refs, refs)

        r08_assert_invalid_application_request(%{
          request
          | messages: [base, author, scope, source, notice]
        })
      end

      author =
        message(:user, :author, [RequestIR.text_block("另一运行的作者原话。")], %{
          source_refs: [%{ref: "foreign-author"}],
          canonical_ref:
            Map.merge(request.run, %{
              run_id: "foreign-run",
              parent_turn_ref: "foreign-author",
              run_sequence: 1,
              run_status: "completed"
            })
        })

      [base, scope, source, notice] = r08_task_coordinates(request.messages, request.run)

      r08_assert_invalid_application_request(%{
        request
        | messages: [base, author, scope, source, notice]
      })
    end

    @tag :r08_response_rejection
    @tag :r08_application_task_rejection
    test "应用任务拒收仍要求真实响应引用唯一且回执紧邻，不能靠任务 Scope 兜底" do
      request = r08_application_request(hd(r08_application_runs()))

      for index <- [2, 3], field <- [:provider_call_ref, :provider_run_ref] do
        for bad <- [:missing, "", " \n ", "another-execution"] do
          messages =
            List.update_at(request.messages, index, fn message ->
              if bad == :missing,
                do: Map.delete(message, field),
                else: Map.put(message, field, bad)
            end)

          r08_assert_invalid_application_request(%{request | messages: messages})
        end
      end

      [base, scope, source, notice] = request.messages
      ordinary = message(:application_notice, :application, [RequestIR.text_block("职责续行。")])

      for messages <- [
            [base, scope, source, ordinary, notice],
            [base, scope, source, source, notice],
            [base, scope, source, notice, notice]
          ] do
        r08_assert_invalid_application_request(%{request | messages: messages})
      end
    end
  end

  defp r08_application_runs do
    [
      %{run_id: "qer-r08-task"},
      %{
        run_id: "run-r08-task",
        workspace_id: "ws-r08-task",
        work_id: "work-r08-task",
        session_id: "session-r08-task",
        parent_turn_ref: "task-origin-r08"
      }
    ]
  end

  defp r08_application_refs do
    %{provider_call_ref: "pcall-r08-task", provider_run_ref: "prun-r08-task"}
  end

  defp r08_application_request(run, blocks \\ [RequestIR.text_block(@r08_task_raw)]) do
    material_refs = [%{ref: "prose:r08-task", version: 2}]

    base =
      message(:application_base, :application, [RequestIR.text_block("应用供应的正文评审材料。")], %{
        source_refs: material_refs
      })

    scope =
      message(
        :scope_update,
        :application,
        [
          %{
            type: "scope",
            content: %{
              "work_id" => Map.get(run, :work_id),
              "operation" => %{
                "role" => "quality_evaluation",
                "prose_text" => "  河灯停在桥下。\r\n"
              }
            }
          }
        ],
        %{
          source_refs: material_refs,
          base_refs: material_refs,
          versions: %{"scope_revision" => 1, "change_reason" => "quality_evaluation"}
        }
      )

    source =
      message(
        :assistant,
        :model,
        blocks,
        Map.put(r08_application_refs(), :provider_state, %{
          "reasoning_content" => "private-application-task"
        })
      )

    receipt = %{
      type: "validation_result",
      status: "failed",
      reason_code: "native_tool_call_required",
      detail: %{"message" => @r08_task_fact <> @r08_task_correction, "reason" => "missing_tool"},
      retryable: true,
      budget_after: %{"exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}}
    }

    request =
      ir(
        [
          base,
          scope,
          source,
          message(:application_notice, :application, [receipt], r08_application_refs())
        ],
        tools: [],
        refs: %{base_refs: material_refs, observation_refs: [], used_refs: []}
      )

    %{
      request
      | run: run,
        system:
          RequestIR.system_envelope(
            instructions: "只评审本次供应的正文材料，返回任务要求的结构化结果。",
            run_role: "quality_evaluation"
          )
    }
  end

  defp r08_task_coordinates(messages, run) do
    messages
    |> Enum.with_index(1)
    |> Enum.map(fn {message, sequence} ->
      Map.put(
        message,
        :canonical_ref,
        Map.merge(run, %{
          run_sequence: sequence,
          run_status: "completed"
        })
      )
    end)
  end

  defp r08_assert_invalid_application_request(request) do
    index = Enum.find_index(request.messages, &(&1.role == "assistant"))
    assert {:error, _} = RequestIR.validate(request)

    assert {:error, _} =
             MessageCoverage.response_validation(request.messages, index, request.run)
  end

  defp r08_application_payload do
    %{
      "ok" => false,
      "data" => %{
        "type" => "validation_result",
        "status" => "failed",
        "reason_code" => "native_tool_call_required",
        "detail" => %{
          "message" => @r08_task_fact <> @r08_task_correction,
          "reason" => "missing_tool"
        }
      },
      "error_code" => "native_tool_call_required",
      "message" => @r08_task_fact <> @r08_task_correction,
      "retryable" => true,
      "observation_ref" => nil,
      "budget_after" => %{
        "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}
      }
    }
  end

  defp r08_application_wire_units(body, "chat_completions"),
    do: for(%{role: role, content: text} <- body.messages, is_binary(text), do: {role, text})

  defp r08_application_wire_units(body, target)
       when target in ["responses_api", "anthropic_messages"] do
    for message <- Map.get(body, :input, Map.get(body, :messages, [])),
        %{type: type, text: text} <- Map.get(message, :content, []),
        type in ["text", "input_text", "output_text"],
        do: {message.role, text}
  end

  defp r08_response_refs do
    %{provider_call_ref: "pcall-r08-response", provider_run_ref: "prun-r08-response"}
  end

  defp r08_rejected_request(blocks \\ [RequestIR.text_block("  未接收的首稿。\r\n")]) do
    initial = ir(g1_messages())

    initial = %{
      initial
      | run:
          Map.merge(initial.run, %{
            workspace_id: "ws-1",
            session_id: "session-1",
            parent_turn_ref: "author_turn:turn-1"
          })
    }

    assistant =
      message(
        :assistant,
        :model,
        blocks,
        Map.put(r08_response_refs(), :provider_state, %{"reasoning_content" => "private-r08"})
      )

    block = %{
      type: "validation_result",
      status: "failed",
      reason_code: "native_tool_call_required",
      detail: %{"message" => @r08_response_fact <> "请保留原目标并调用实际工具。", "reason" => "missing_tool"},
      retryable: true,
      budget_after: %{"exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}}
    }

    notice = message(:application_notice, :application, [block], r08_response_refs())
    %{initial | messages: initial.messages ++ [assistant, notice]}
  end
end
