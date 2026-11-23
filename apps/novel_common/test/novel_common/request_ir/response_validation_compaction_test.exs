defmodule NovelCommon.RequestIR.ResponseValidationCompactionTest do
  use ExUnit.Case, async: true

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction
  alias NovelCommon.RequestIR.MessageCoverage
  alias NovelCommon.RequestIR.Projection

  @author "  先保留两种方案。\r\n等我确定视角再比较代价。  "
  @promise "等你确定视角后，我还会把第二方案与第三方案的代价逐项比较。"
  @old_text "这段早期长答的逐字论证不再常驻请求。\n" <> @promise
  @targets ~w(chat_completions anthropic_messages responses_api)

  @tag :r08_response_rejection
  test "R08 已拒稿不具讨论来源资格，同文不同真实响应只排除确切失败者" do
    messages = response_rejection_history()
    refs = response_history_refs()
    assert :ok = RequestIR.validate(ir(messages))
    assert {:ok, [failed, later]} = MessageCoverage.resolve(messages, refs)
    refute MessageCoverage.eligible?(failed, messages, "current")
    assert MessageCoverage.eligible?(later, messages, "current")

    assert MessageCoverage.discussion_sources(messages, [failed, later]) == [
             %{
               source_index: 0,
               source: %{run_id: "old", run_sequence: 6},
               text: @old_text,
               author_text: @author
             }
           ]

    assert {:ok, []} = Compaction.discussion_sources(messages, %{message_refs: [hd(refs)]})
    assert Compaction.project(messages) == messages
  end

  @tag :r08_response_rejection
  test "R08 checkpoint 不得覆盖已拒稿，合法覆盖其他讨论仍留下失败原文和回执" do
    originals = response_rejection_history()
    [failed_ref, later_ref] = response_history_refs()

    assert {:error, :checkpoint_protected_or_repeated_message} =
             RequestIR.validate(ir(originals ++ [checkpoint([failed_ref])]))

    valid = originals ++ [checkpoint([later_ref])]
    assert :ok = RequestIR.validate(ir(valid))
    projected = Compaction.project(valid)

    assert Enum.find(
             projected,
             &(&1[:canonical_ref][:run_id] == "old" and &1[:canonical_ref][:run_sequence] == 4)
           ) ==
             Enum.at(originals, 3)

    assert Enum.find(
             projected,
             &(&1[:canonical_ref][:run_id] == "old" and &1[:canonical_ref][:run_sequence] == 5)
           ) ==
             Enum.at(originals, 4)

    refute Enum.any?(
             projected,
             &(&1[:canonical_ref][:run_id] == "old" and &1[:canonical_ref][:run_sequence] == 6)
           )

    for target <- @targets do
      assert {:ok, body} = Projection.project(ir(valid), target)
      assert @old_text in wire_texts(body)
      assert Enum.any?(wire_texts(body), &String.contains?(&1, "未作为作者回复发布"))
      refute Jason.encode!(body) =~ "pcall-r08-rejected-history"
      refute Jason.encode!(body) =~ "prun-r08-rejected-history"
    end
  end

  @tag :r08_response_rejection
  test "R08 旧无回执与普通 notice 不按拒收字样取消原有来源资格" do
    originals = history()

    notice =
      RequestIR.message(
        :application_notice,
        :application,
        [
          RequestIR.text_block("旧纠错或引用：未通过接收不等于这里存在结构拒收事实。")
        ],
        %{canonical_ref: coordinate("old", 5, "completed")}
      )

    for messages <- [originals, List.insert_at(originals, 4, notice)] do
      assert :ok = RequestIR.validate(ir(messages))

      reference = %{
        run_id: "old",
        run_sequence: 4,
        role: "assistant",
        source_refs: [],
        versions: %{}
      }

      assert {:ok, [source]} = MessageCoverage.resolve(messages, [reference])
      assert MessageCoverage.eligible?(source, messages, "current")

      assert [%{text: @old_text, author_text: @author}] =
               MessageCoverage.discussion_sources(messages, [source])
    end
  end

  @tag :r08_response_rejection
  @tag :r08_response_rejection_direct
  test "R08 helper-direct 拒收源空 text 是坏形状，真实空 blocks 仍合法" do
    messages = response_rejection_history()
    empty_text = List.update_at(messages, 3, &%{&1 | blocks: [RequestIR.text_block("")]})
    assert {:error, _} = MessageCoverage.response_validation(empty_text, 3, run())

    empty_response = List.update_at(messages, 3, &%{&1 | blocks: []})
    [receipt] = Enum.at(messages, 4).blocks
    assert {:ok, ^receipt} = MessageCoverage.response_validation(empty_response, 3, run())
  end

  @tag :r08_response_rejection
  @tag :r08_response_rejection_direct
  test "R08 helper-direct 缺失或空白拒收说明必须失败，不能由调用者绕过 IR 前门" do
    messages = response_rejection_history()

    for value <- [:missing, "", " \t\r\n "] do
      invalid =
        List.update_at(messages, 4, fn notice ->
          [block] = notice.blocks

          detail =
            if value == :missing,
              do: Map.delete(block.detail, "message"),
              else: Map.put(block.detail, "message", value)

          %{notice | blocks: [%{block | detail: detail}]}
        end)

      assert {:error, _} = MessageCoverage.response_validation(invalid, 3, run())
    end
  end

  defp response_history_refs do
    for sequence <- [4, 6],
        do: %{
          run_id: "old",
          run_sequence: sequence,
          role: "assistant",
          source_refs: [],
          versions: %{}
        }
  end

  defp response_rejection_history do
    messages = history()

    refs = %{
      provider_call_ref: "pcall-r08-rejected-history",
      provider_run_ref: "prun-r08-rejected-history"
    }

    rejected = Enum.at(messages, 3) |> Map.merge(refs)

    block = %{
      type: "validation_result",
      status: "failed",
      reason_code: "invalid_narrative",
      detail: %{"message" => "本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n请纠正本次说明。"},
      retryable: true,
      budget_after: %{"exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}}
    }

    notice =
      RequestIR.message(
        :application_notice,
        :application,
        [block],
        Map.put(refs, :canonical_ref, coordinate("old", 5, "completed"))
      )

    later =
      text_message("old", 6, "assistant", "model", @old_text, "completed")
      |> Map.merge(%{
        provider_call_ref: "pcall-r08-later-history",
        provider_run_ref: "prun-r08-later-history"
      })

    Enum.take(messages, 3) ++ [rejected, notice, later] ++ Enum.drop(messages, 4)
  end

  defp run do
    %{
      run_id: "current",
      workspace_id: "ws",
      work_id: "work",
      session_id: "session",
      parent_turn_ref: "turn-current"
    }
  end

  defp ir(messages) do
    RequestIR.new(%{
      run: run(),
      system: RequestIR.system_envelope(instructions: "基于真实历史继续作者目标。", run_role: "creation_run"),
      messages: messages,
      tools: [],
      refs: %{base_refs: [], observation_refs: [], used_refs: []}
    })
  end

  defp history do
    [
      text_message("current", 1, "application_base", "application", "稳定应用来源", "running"),
      scope("old", 2, "completed", 1, "旧范围完整正文"),
      text_message("old", 3, "user", "author", @author, "completed", [%{ref: "turn-old"}]),
      text_message("old", 4, "assistant", "model", @old_text, "completed"),
      scope("active", 2, "awaiting_author", 1, "另一个活动任务范围"),
      text_message("active", 3, "user", "author", "请先问我视角。", "awaiting_author", [
        %{ref: "turn-active"}
      ]),
      text_message("active", 4, "assistant", "model", "我还在等作者回答，不能用整理关闭这个问题。", "awaiting_author"),
      scope("current", 2, "running", 1, "当前范围事实"),
      text_message("current", 3, "user", "author", "我选第三人称，现在继续未完成的比较。", "running", [
        %{ref: "turn-current"}
      ]),
      text_message("current", 4, "assistant", "model", "当前回复保持原文。", "running")
    ]
  end

  defp text_message(id, sequence, role, provenance, text, status, refs \\ []) do
    RequestIR.message(role, provenance, [RequestIR.text_block(text)], %{
      source_refs: refs,
      canonical_ref: coordinate(id, sequence, status)
    })
  end

  defp scope(id, sequence, status, version, label) do
    RequestIR.message(
      :scope_update,
      :application,
      [RequestIR.scope_block(%{work_id: "work", facts: %{label: label}})],
      %{
        source_refs: [%{ref: "scope:" <> id, version: version}],
        versions: %{"scope_revision" => version},
        canonical_ref: coordinate(id, sequence, status)
      }
    )
  end

  defp coordinate(id, sequence, status) do
    %{
      run_id: id,
      run_sequence: sequence,
      work_id: "work",
      workspace_id: "ws",
      session_id: "session",
      parent_turn_ref: "turn-" <> id,
      run_status: status
    }
  end

  defp covers(refs),
    do: %{call_ids: [], message_refs: refs, turn_range: "turn-old"}

  defp checkpoint(refs) do
    # 字面来源表由预注册 Canonical fixture 指定，不调用被测 evidence/selector。
    source_refs =
      Enum.flat_map(refs, fn ref ->
        ref.source_refs ++
          [%{ref: "session_message:#{ref.run_id}:#{ref.run_sequence}", version: 1}]
      end)

    block =
      RequestIR.checkpoint_block(
        covers(refs),
        source_refs,
        %{},
        ["旧 Scope 与讨论正文可从原文回查，义务不因摘要解除。"],
        "整理了旧资料。",
        discussion()
      )

    RequestIR.message(:checkpoint, :application, [block], %{
      canonical_ref: coordinate("current", 5, "running")
    })
  end

  defp discussion(raw \\ nil) do
    raw =
      raw ||
        Jason.encode!(%{
          version: "authoring-discussion-summary/v1",
          entries: [
            %{source_index: 0, summary: "讨论两种方案；比较尚未履行。", retained_obligations: [@promise]}
          ]
        })

    %{
      response_text: raw,
      response_sha256: :crypto.hash(:sha256, raw) |> Base.encode16(case: :lower),
      provider_call_ref: "pcall-summary",
      provider_run_ref: "prun-summary"
    }
  end

  defp wire_texts(body) do
    for message <- Map.get(body, :messages, Map.get(body, :input, [])),
        block <- List.wrap(Map.get(message, :content, [])),
        text = if(is_binary(block), do: block, else: Map.get(block, :text)),
        is_binary(text),
        do: text
  end
end
