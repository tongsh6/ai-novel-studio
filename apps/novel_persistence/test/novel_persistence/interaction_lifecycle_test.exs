defmodule NovelPersistence.InteractionLifecycleTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelDomain.DialogueContext
  alias NovelPersistence.{InteractionLifecycle, MemoryLog, Repo, WorkRepo, WorkSessionRepo}

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkRepo.create(%{title: "消息闭环"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})

    %{
      work: work,
      session: session,
      attrs: %{
        workspace_id: work.id,
        session_id: session.id,
        turn_id: "input-1",
        run_id: "run-1",
        text: "  作者原文\n第二行  ",
        status: :running
      }
    }
  end

  test "按 work/session/run/turn 精确读取当前 receipt，保留 Unicode 与空白", %{attrs: attrs} do
    raw = "\t 作者答复 Ω é\n第二行  "
    current = %{attrs | turn_id: "input-1:steer:2", text: raw}
    assert {:ok, _} = InteractionLifecycle.call(:receive, attrs)
    assert {:ok, _} = InteractionLifecycle.call(:receive, current)

    assert {:ok, %{turn_id: "input-1:steer:2", text: ^raw}} =
             InteractionLifecycle.call(:input, current)

    assert {:ok, %{text: original}} = InteractionLifecycle.call(:input, attrs)
    assert original == attrs.text

    for overrides <- [
          %{workspace_id: "other-work"},
          %{session_id: "other-session"},
          %{run_id: "other-run"},
          %{turn_id: "input-missing"}
        ] do
      assert {:error, :received_input_not_found} =
               InteractionLifecycle.call(:input, Map.merge(current, overrides))
    end
  end

  test "当前 receipt 读取不受最近 80 条历史窗口或 600 字预览影响", %{attrs: attrs} do
    raw = "  " <> String.duplicate("原文 Ω\n", 220) <> "尾部  "
    current = %{attrs | text: raw}
    assert {:ok, _} = InteractionLifecycle.call(:receive, current)

    for n <- 1..81 do
      assert {:ok, _} =
               InteractionLifecycle.call(
                 :receive,
                 %{attrs | turn_id: "later-#{n}", run_id: "later-run-#{n}", text: "后续消息 #{n}"}
               )
    end

    context = InteractionLifecycle.context(attrs.workspace_id, attrs.session_id)
    refute Enum.any?(context.author_inputs, &(&1.turn_ref == attrs.turn_id))
    assert {:ok, %{text: ^raw}} = InteractionLifecycle.call(:input, current)
  end

  test "接收保留字节，同身份重传复用运行，不同内容拒绝", %{attrs: attrs} do
    assert {:ok, %{run_id: "run-1", duplicate?: false}} =
             InteractionLifecycle.call(:receive, attrs)

    assert {:ok, %{run_id: "run-1", duplicate?: true}} =
             InteractionLifecycle.call(:receive, %{attrs | run_id: "run-2"})

    assert {:error, :input_identity_conflict} =
             InteractionLifecycle.call(:receive, %{attrs | text: "替换原文"})

    assert [entry] = MemoryLog.transcript(attrs.session_id)
    assert entry.content["text"] == attrs.text
    assert entry.content["message_handling"]["status"] == "created"
  end

  test "结果去重与终态回填不覆盖作者原文", %{attrs: attrs} do
    assert {:ok, _} = InteractionLifecycle.call(:receive, attrs)

    result = %{
      turn_id: "result-1",
      assistant_message: %{text: "读取完成，没有写入。"},
      truthfulness: %{production_write_performed: false}
    }

    result_attrs = Map.put(attrs, :turn_result, result)
    assert {:ok, :recorded} = InteractionLifecycle.call(:result, result_attrs)
    assert {:ok, :recorded} = InteractionLifecycle.call(:result, result_attrs)
    assert {:ok, :recorded} = InteractionLifecycle.call(:status, %{attrs | status: :completed})
    assert [user, assistant] = MemoryLog.transcript(attrs.session_id)
    assert user.content["text"] == attrs.text
    assert user.content["message_handling"]["result_turn_refs"] == ["result-1"]
    assert is_binary(user.content["message_handling"]["processed_at"])
    assert assistant.content["turn_result"]["truthfulness"]["production_write_performed"] == false
    context = InteractionLifecycle.context(attrs.workspace_id, attrs.session_id)
    assert [%{text: "读取完成，没有写入。"}] = context.recent_results
  end

  test "已接收的本轮输入不在最近对话中重复注入，但来源投影始终可查", %{attrs: attrs} do
    assert {:ok, _} = InteractionLifecycle.call(:receive, attrs)
    fetcher = NovelPersistence.WorkspaceContext.context_fetcher_with_query()

    assert {:ok, %DialogueContext{conversation_summary: nil, interaction_state: state}} =
             fetcher.(attrs.workspace_id, attrs.text, attrs.session_id)

    assert [%{text: text}] = state.author_inputs
    assert text == attrs.text
    assert {:ok, _} = InteractionLifecycle.call(:status, %{attrs | status: :completed})

    assert {:ok, %DialogueContext{conversation_summary: summary}} =
             fetcher.(attrs.workspace_id, "下一句", attrs.session_id)

    assert summary =~ attrs.text
  end

  test "失败和取消仍能恢复收到的消息", %{attrs: attrs} do
    for status <- [:failed, :cancelled] do
      attrs = %{attrs | turn_id: "input-#{status}", run_id: "run-#{status}"}
      assert {:ok, _} = InteractionLifecycle.call(:receive, attrs)
      assert {:ok, _} = InteractionLifecycle.call(:status, %{attrs | status: status})
    end

    assert entries = MemoryLog.transcript(attrs.session_id)

    assert Enum.map(entries, & &1.content["message_handling"]["status"]) == [
             "failed",
             "cancelled"
           ]

    assert Enum.all?(entries, &(&1.content["text"] == attrs.text))
  end

  test "steer 后的新回应不会覆盖先前回应或倒置消息顺序", %{attrs: attrs} do
    assert {:ok, _} = InteractionLifecycle.call(:receive, attrs)
    result = %{turn_id: attrs.turn_id, assistant_message: %{text: "请补充。"}}

    assert {:ok, _} =
             InteractionLifecycle.call(
               :result,
               Map.merge(attrs, %{turn_result: result, goal_version: 1})
             )

    assert {:ok, _} =
             InteractionLifecycle.call(:receive, %{
               attrs
               | turn_id: "input-1:steer:2",
                 text: "补充内容"
             })

    result = put_in(result, [:assistant_message, :text], "已回应补充内容。")
    result_attrs = Map.merge(attrs, %{turn_result: result, goal_version: 2})
    assert {:ok, _} = InteractionLifecycle.call(:result, result_attrs)
    assert {:ok, _} = InteractionLifecycle.call(:result, result_attrs)

    assert Enum.map(MemoryLog.transcript(attrs.session_id), & &1.content["text"]) ==
             [attrs.text, "请补充。", "补充内容", "已回应补充内容。"]

    assert [%{"assistant_message" => %{"text" => "已回应补充内容。"}}] =
             InteractionLifecycle.receipt_results(
               attrs.workspace_id,
               attrs.session_id,
               attrs.run_id
             )
  end

  test "运行完成和追问不清除待采纳，作者采纳回执才改变投影", %{attrs: attrs} do
    assert {:ok, _} = InteractionLifecycle.call(:receive, attrs)

    pending = %{
      artifact_id: "artifact-1",
      adoption_status: "tentative",
      payload: %{source_tool_result_ref: "author_input:input-1"}
    }

    result = %{
      turn_id: "result-1",
      assistant_message: %{text: "等待作者采纳。"},
      adoption_state: %{pending: [pending], resolved: []}
    }

    assert {:ok, _} = InteractionLifecycle.call(:result, Map.put(attrs, :turn_result, result))
    assert {:ok, _} = InteractionLifecycle.call(:status, %{attrs | status: :completed})

    assert [%{"adoption_status" => "TENTATIVE"}] =
             InteractionLifecycle.context(attrs.workspace_id, attrs.session_id).pending_adoptions

    resolved =
      put_in(result, [:adoption_state], %{
        pending: [],
        resolved: [%{pending | adoption_status: "accepted"}]
      })

    assert {:ok, _} =
             MemoryLog.record(%{
               workspace_id: attrs.workspace_id,
               session_id: attrs.session_id,
               turn_id: "adoption-1",
               role: "assistant",
               content: %{text: "已采纳", turn_result: resolved}
             })

    context = InteractionLifecycle.context(attrs.workspace_id, attrs.session_id)
    assert context.pending_adoptions == []

    assert [%{"artifact_id" => "artifact-1", "adoption_status" => "ACCEPTED"}] =
             context.resolved_adoptions
  end

  test "相同 turn 编号按作品和会话隔离", %{attrs: attrs} do
    assert {:ok, _} = InteractionLifecycle.call(:receive, attrs)
    {:ok, other_work} = WorkRepo.create(%{title: "另一作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id})
    other = %{attrs | workspace_id: other_work.id, session_id: other_session.id, text: "另一原文"}
    assert {:ok, %{duplicate?: false}} = InteractionLifecycle.call(:receive, other)
    assert InteractionLifecycle.context(attrs.workspace_id, other_session.id) == %{}

    assert [%{text: "另一原文"}] =
             InteractionLifecycle.context(other_work.id, other_session.id).author_inputs

    {:ok, same_work_session} = WorkSessionRepo.create(%{work_id: attrs.workspace_id})

    assert InteractionLifecycle.context(attrs.workspace_id, same_work_session.id).author_inputs ==
             []
  end
end
